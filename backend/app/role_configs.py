"""Reusable per-role interview pipelines — the shared model both clients read.

`roleConfigs/{id}` — a top-level, UNPREFIXED collection, deliberately not
`web_`-prefixed: a pipeline authored on the web must be usable the moment a recruiter
imports a spreadsheet on their phone, and vice versa. This mirrors why `tests` and
`interviews` are unprefixed too (see `app.web.store.db`'s module docstring) — anything
both clients must see through the same document cannot live behind the web-only prefix.

A `RoleConfig` is a TEMPLATE, not a live pipeline: it has no candidates, no lifecycle,
no window. Materialising one into a real `tests/{id}/rounds` timeline for a batch of
candidates happens in `app.web.services.interview_invite` — this module only owns the
template's shape and its Firestore collection name.

`rounds` is stored as an embedded array on the document, not a subcollection: unlike a
real round, a template round is never read independently, never has its own security
boundary, and a pipeline is small (a handful of rounds) — an embedded array needs no
extra composite index and keeps one document per pipeline.

Owner-scoped like `mcq_sets`: a `recruiterId` filter on every query, enforced again in
the route layer with the 404-not-403 pattern used everywhere else in `app.web.routes`.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from app import rounds as rounds_kernel

# Shared, unprefixed — see the module docstring.
ROLE_CONFIGS_COLLECTION = "roleConfigs"

# A pipeline is a timeline a recruiter can reason about, not a workflow engine.
MAX_ROUNDS = 20


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalise_round_spec(raw: object, order: int) -> dict:
    """One template round, defensively parsed. Tolerant of missing fields.

    Field names mirror `app.rounds.Round.to_create_map()` (minus the per-test
    lifecycle fields a template does not have — id, opensAt/closesAt/closedAt/closedBy)
    so materialising a spec into a real round is close to a straight copy.
    """
    data = raw if isinstance(raw, dict) else {}
    return {
        "order": order,
        "title": str(data.get("title") or f"Round {order + 1}").strip() or f"Round {order + 1}",
        "kind": rounds_kernel.kind_from_wire(data.get("kind")),
        # Mode-specific: {"source": "tailor"|"set"|"mixed", "questionSetId"?,
        # "mixedConfig"?, "fixedQuestions"?, ...}. Opaque here — resolved at
        # materialisation time by interview_invite.resolve_question_source.
        "config": data.get("config") if isinstance(data.get("config"), dict) else {},
        "criteria": rounds_kernel.Criteria.from_map(data.get("criteria")).to_map(),
    }


def normalise_rounds(raw: object) -> list[dict]:
    if not isinstance(raw, list):
        return []
    return [normalise_round_spec(item, index) for index, item in enumerate(raw)]


def build_create(*, recruiter_id: str, role_category: str, display_name: str, rounds: object) -> dict:
    now = _now()
    return {
        "id": str(uuid.uuid4()),
        "recruiterId": recruiter_id,
        "roleCategory": role_category,
        "displayName": display_name,
        "rounds": normalise_rounds(rounds),
        "createdAt": now,
        "updatedAt": now,
    }


def build_update(existing: dict, *, display_name: object = None, rounds: object = None) -> dict:
    """Editable fields only. `roleCategory` is identity, not content — never changed here."""
    updated = dict(existing)
    if display_name is not None:
        updated["displayName"] = str(display_name).strip() or existing.get("displayName")
    if rounds is not None:
        if not isinstance(rounds, list) or len(rounds) > MAX_ROUNDS:
            raise ValueError(f"A pipeline holds at most {MAX_ROUNDS} rounds.")
        updated["rounds"] = normalise_rounds(rounds)
    updated["updatedAt"] = _now()
    return updated
