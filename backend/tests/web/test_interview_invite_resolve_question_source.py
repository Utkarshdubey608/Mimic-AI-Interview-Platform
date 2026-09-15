"""`interview_invite.resolve_question_source` — the one place tailor/set/mixed question
sources are resolved, shared by a manual invite and a round-2+ assignment. Exercises
Mixed mode's validation (AC15/AC16) and the insufficient-question-set edge case.
"""

from __future__ import annotations

import pytest

from app.web.services import interview_invite
from tests.web.conftest import FakeCollection


class _Store:
    def __init__(self) -> None:
        self.question_sets = FakeCollection("web_question_sets")


@pytest.mark.asyncio
async def test_tailor_builds_screening_with_no_questions() -> None:
    questions, screening = await interview_invite.resolve_question_source(
        _Store(), mode="chat", source="tailor", config={"style": "mix", "techCount": 3}
    )
    assert questions == []
    assert screening["source"] == "tailor"
    assert screening["style"] == "mix"


@pytest.mark.asyncio
async def test_set_requires_a_question_set_id() -> None:
    with pytest.raises(Exception) as exc:
        await interview_invite.resolve_question_source(
            _Store(), mode="chat", source="set", config={}
        )
    assert "question set" in str(exc.value).lower()


@pytest.mark.asyncio
async def test_mixed_valid_counts_split_fixed_then_resume() -> None:
    """AC15: total=8, fixed=5, resume=3 — the 5 fixed texts resolve in order."""
    store = _Store()
    store.question_sets.docs["qs1"] = {
        "id": "qs1",
        "questions": [{"text": f"Q{i}"} for i in range(1, 8)],  # 7 questions available
    }
    questions, screening = await interview_invite.resolve_question_source(
        store,
        mode="chat",
        source="mixed",
        config={},
        mixed_config={
            "totalQuestions": 8,
            "fixedQuestionCount": 5,
            "resumeQuestionCount": 3,
            "questionSetId": "qs1",
        },
    )
    assert questions == ["Q1", "Q2", "Q3", "Q4", "Q5"]
    assert screening["source"] == "mixed"
    assert screening["mixedConfig"] == {
        "totalQuestions": 8,
        "fixedQuestionCount": 5,
        "resumeQuestionCount": 3,
        "questionSetId": "qs1",
    }


@pytest.mark.asyncio
async def test_mixed_rejects_counts_that_do_not_add_up() -> None:
    """AC16: total=8, fixed=6, resume=3 -> INVALID."""
    with pytest.raises(Exception) as exc:
        await interview_invite.resolve_question_source(
            _Store(),
            mode="chat",
            source="mixed",
            config={},
            mixed_config={"totalQuestions": 8, "fixedQuestionCount": 6, "resumeQuestionCount": 3},
        )
    assert "add up" in str(exc.value).lower()


@pytest.mark.asyncio
async def test_mixed_rejects_insufficient_question_set_size() -> None:
    """A question set with fewer questions than the fixed count must not fabricate the
    rest — the recruiter must adjust the configuration instead."""
    store = _Store()
    store.question_sets.docs["small"] = {
        "id": "small",
        "questions": [{"text": "Only one"}],
    }
    with pytest.raises(Exception) as exc:
        await interview_invite.resolve_question_source(
            store,
            mode="chat",
            source="mixed",
            config={},
            mixed_config={
                "totalQuestions": 5,
                "fixedQuestionCount": 3,
                "resumeQuestionCount": 2,
                "questionSetId": "small",
            },
        )
    assert "only 1 question" in str(exc.value).lower()


@pytest.mark.asyncio
async def test_mixed_supports_ad_hoc_fixed_questions_with_no_question_set() -> None:
    """3E: fixed questions can be created on the spot instead of selecting a set.

    `fixedQuestions` is read from `config`, NOT from `mixed_config` — every real
    caller (a manual invite's request body, a RoleConfig round's stored config)
    sends it as a SIBLING of `mixedConfig`, never nested inside it. A test that put
    it inside `mixed_config` here would pass while the actual route always rejected
    a correctly-filled-in ad-hoc Mixed invite with "N fixed question(s) are
    required." — exactly the gap `test_web_invites_from_role_pipeline.py` and
    `test_web_invites_mode_source_validation.py` exist to catch, by calling the
    route instead of this function directly.
    """
    questions, screening = await interview_invite.resolve_question_source(
        _Store(),
        mode="chat",
        source="mixed",
        config={"fixedQuestions": ["Tell me about yourself", "Why this role?"]},
        mixed_config={"totalQuestions": 4, "fixedQuestionCount": 2, "resumeQuestionCount": 2},
    )
    assert questions == ["Tell me about yourself", "Why this role?"]
    assert "questionSetId" not in screening["mixedConfig"]


@pytest.mark.asyncio
async def test_mixed_allows_zero_fixed_or_zero_resume() -> None:
    """Zero-fixed and zero-resume are both valid Mixed configurations."""
    _, screening_zero_fixed = await interview_invite.resolve_question_source(
        _Store(),
        mode="chat",
        source="mixed",
        config={"fixedQuestions": []},
        mixed_config={"totalQuestions": 3, "fixedQuestionCount": 0, "resumeQuestionCount": 3},
    )
    assert screening_zero_fixed["mixedConfig"]["fixedQuestionCount"] == 0

    questions, screening_zero_resume = await interview_invite.resolve_question_source(
        _Store(),
        mode="chat",
        source="mixed",
        config={"fixedQuestions": ["A", "B", "C"]},
        mixed_config={"totalQuestions": 3, "fixedQuestionCount": 3, "resumeQuestionCount": 0},
    )
    assert questions == ["A", "B", "C"]
    assert screening_zero_resume["mixedConfig"]["resumeQuestionCount"] == 0


@pytest.mark.asyncio
async def test_two_way_and_mcq_are_untouched() -> None:
    questions, screening = await interview_invite.resolve_question_source(
        _Store(), mode="two_way", source=None, config={}
    )
    assert questions == []
    assert screening == {}
