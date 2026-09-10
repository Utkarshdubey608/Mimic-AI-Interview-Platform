"""Reusable per-role interview pipelines — `GET/POST/PUT/DELETE /role-configs`.

A `RoleConfig` is a TEMPLATE a recruiter builds once per role category (SDE,
Consulting, ...) and reuses across every spreadsheet import for that role. See
`app.role_configs` for the shared, unprefixed collection both web and mobile read, and
`app.web.services.interview_invite.materialise_role_pipeline` for where a template
turns into a real `tests/{id}/rounds` timeline for one batch of candidates.

Owner-scoped exactly like `mcq_sets`: 404, not 403, on a mismatch — this surface never
confirms another recruiter's pipeline exists.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Request, Response, status

from app import role_classification, role_configs
from app.security import AuthedUser
from app.web.deps import WebUser, settings_of
from app.web.store import get_store

logger = logging.getLogger("web.role_configs")

router = APIRouter(prefix="/role-configs", tags=["web:role-configs"])


@router.get("/categories", summary="Known role categories")
async def list_categories() -> list[dict]:
    """The classifier's category table, for populating a picker. Never role-specific."""
    return role_classification.known_categories()


@router.get("", summary="Every role pipeline this recruiter owns")
async def list_configs(request: Request, user: AuthedUser = WebUser) -> list[dict]:
    store = get_store(settings_of(request))
    found = await store.role_configs.owned_by(user.uid)
    return sorted(found, key=lambda c: str(c.get("displayName") or "").lower())


@router.get("/{config_id}", summary="One role pipeline")
async def get_config(
    config_id: str, request: Request, user: AuthedUser = WebUser
) -> dict:
    store = get_store(settings_of(request))
    found = await store.role_configs.get(config_id)
    if not found or str(found.get("recruiterId") or "") != user.uid:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Role pipeline not found")
    return found


@router.post("", status_code=status.HTTP_201_CREATED, summary="Create a role pipeline")
async def create_config(
    body: dict, request: Request, user: AuthedUser = WebUser
) -> dict:
    settings = settings_of(request)
    store = get_store(settings)

    role_category = str((body or {}).get("roleCategory") or "").strip()
    if not role_category:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "A role category is required")

    display_name = str((body or {}).get("displayName") or "").strip() or role_classification.category_display_name(role_category)
    rounds = (body or {}).get("rounds")
    if rounds is not None and (not isinstance(rounds, list) or len(rounds) > role_configs.MAX_ROUNDS):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"A pipeline holds at most {role_configs.MAX_ROUNDS} rounds.",
        )

    created = role_configs.build_create(
        recruiter_id=user.uid,
        role_category=role_category,
        display_name=display_name,
        rounds=rounds,
    )
    await store.role_configs.put(created)
    logger.info("role pipeline %s created for %s (%s)", created["id"], user.uid, role_category)
    return created


@router.put("/{config_id}", summary="Edit a role pipeline")
async def update_config(
    config_id: str, body: dict, request: Request, user: AuthedUser = WebUser
) -> dict:
    store = get_store(settings_of(request))
    existing = await store.role_configs.get(config_id)
    if not existing or str(existing.get("recruiterId") or "") != user.uid:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Role pipeline not found")

    body = body or {}
    try:
        updated = role_configs.build_update(
            existing,
            display_name=body.get("displayName"),
            rounds=body.get("rounds") if "rounds" in body else None,
        )
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc

    await store.role_configs.put(updated)
    return updated


@router.post(
    "/{config_id}/duplicate",
    status_code=status.HTTP_201_CREATED,
    summary="Copy a role pipeline",
)
async def duplicate_config(
    config_id: str, request: Request, user: AuthedUser = WebUser
) -> dict:
    store = get_store(settings_of(request))
    source = await store.role_configs.get(config_id)
    if not source or str(source.get("recruiterId") or "") != user.uid:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Role pipeline not found")

    copy = role_configs.build_create(
        recruiter_id=user.uid,
        role_category=str(source.get("roleCategory") or ""),
        display_name=f"{source.get('displayName')} (copy)",
        rounds=source.get("rounds"),
    )
    await store.role_configs.put(copy)
    return copy


@router.delete(
    "/{config_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete a role pipeline"
)
async def delete_config(
    config_id: str, request: Request, user: AuthedUser = WebUser
) -> Response:
    store = get_store(settings_of(request))
    existing = await store.role_configs.get(config_id)
    if existing and str(existing.get("recruiterId") or "") == user.uid:
        await store.role_configs.delete(config_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
