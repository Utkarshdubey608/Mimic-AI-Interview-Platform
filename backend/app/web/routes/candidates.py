"""The Candidates Kanban's data — `GET /candidates/board`.

A read-only aggregation of the recruiter's own interviews, grouped into one card per
candidate. See `app.candidates.board_for_recruiter` for the grouping itself; this route
is a thin, owner-scoped wrapper around it.
"""

from __future__ import annotations

from fastapi import APIRouter, Request

from app import candidates as candidates_kernel
from app.security import AuthedUser
from app.web.deps import WebUser, settings_of

router = APIRouter(prefix="/candidates", tags=["web:candidates"])


@router.get("/board", summary="Candidates grouped by current round")
async def board(
    request: Request,
    roleCategory: str | None = None,
    status: str | None = None,
    search: str | None = None,
    user: AuthedUser = WebUser,
) -> dict:
    settings = settings_of(request)
    cards = await candidates_kernel.board_for_recruiter(
        settings,
        recruiter_id=user.uid,
        role_category=roleCategory or None,
        status=status or None,
        search=search or None,
    )
    return {"cards": cards}
