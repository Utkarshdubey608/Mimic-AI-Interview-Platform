"""The MCQ paper golden contract, Python side.

Pins two things against `contracts/mcq_paper.fixtures.json`:

* **the public paper** — what a candidate's device receives, which is the shape the
  Flutter and React runtimes both render;
* **the scores** — so a change to the scorer that would regrade a stored attempt fails
  here rather than moving somebody's result after the fact.

And one property the fixtures cannot express on their own: `correctOptionIds` and
`correctPairs` appear NOWHERE in the serialised response. Asserted on the JSON bytes
rather than on the projected dict, because bytes are what would actually reach someone.

Regenerate with:

    REGENERATE_MCQ_FIXTURES=1 .venv/bin/python -m pytest tests/test_mcq_contract.py

and update `mobile_desktop_app_version/test/mcq_contract_test.dart` in the same commit.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from app import mcq, mcq_runtime
from tests.mcq_paper_cases import PAPER, SEED, SUBMISSIONS

FIXTURES = (
    Path(__file__).resolve().parent.parent.parent / "contracts" / "mcq_paper.fixtures.json"
)

README = (
    "Golden contract for the PUBLIC MCQ paper — what a candidate's device is allowed to "
    "receive — and for the scores a submission produces. Generated from backend/app/mcq.py "
    "and backend/app/mcq_scoring.py; asserted by BOTH backend/tests/test_mcq_contract.py "
    "and mobile_desktop_app_version/test/mcq_contract_test.dart. The property being pinned "
    "is an ABSENCE: correctOptionIds and correctPairs must never appear here. Regenerate "
    "with REGENERATE_MCQ_FIXTURES=1 and update both sides in the same commit. NOTE: the "
    "`scores` block DOES contain the key — it is the RECRUITER's report, which is what "
    "makes a result reviewable. Only `publicPaper` is what a candidate's device receives."
)

# Every field name that is part of the answer key, in either shape. Listed rather than
# inferred: this is the thing being defended, and it should cost a line to change.
KEY_FIELDS = ("correctOptionIds", "correctPairs", "explanation", "internalNote")


def _build() -> dict:
    return {
        "_readme": README,
        "seed": SEED,
        "publicPaper": {
            "sections": mcq.public_sections(PAPER),
            "questions": mcq.public_paper(PAPER, seed=SEED),
        },
        "scores": {
            case["name"]: mcq_runtime.score(
                mcq.questions_of(PAPER),
                mcq.clean_answers(case["answers"], mcq.questions_of(PAPER)),
                config=case["config"],
                paper=PAPER,
            )
            for case in SUBMISSIONS
        },
    }


def _regenerate_if_asked(current: dict) -> None:
    if os.environ.get("REGENERATE_MCQ_FIXTURES") != "1":
        return
    FIXTURES.parent.mkdir(parents=True, exist_ok=True)
    FIXTURES.write_text(
        json.dumps(current, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )


@pytest.fixture(scope="module")
def golden() -> dict:
    current = _build()
    _regenerate_if_asked(current)
    assert FIXTURES.exists(), (
        f"{FIXTURES} is missing. Generate it with "
        "REGENERATE_MCQ_FIXTURES=1 pytest tests/test_mcq_contract.py"
    )
    return json.loads(FIXTURES.read_text(encoding="utf-8"))


# ── the public paper ──────────────────────────────────────────────────────────


def test_the_public_paper_matches_the_contract(golden: dict) -> None:
    assert mcq.public_paper(PAPER, seed=SEED) == golden["publicPaper"]["questions"]


def test_the_section_manifest_matches_the_contract(golden: dict) -> None:
    assert mcq.public_sections(PAPER) == golden["publicPaper"]["sections"]


def test_the_answer_key_is_absent_from_the_serialised_paper() -> None:
    """The property, asserted on BYTES.

    Not on the projected dict, and the difference matters: a dict comparison checks the
    top level of each question, while a key could reach a candidate nested inside an
    option, inside a section, or inside a field somebody added last week. The bytes are
    what would actually leave the server.
    """
    payload = json.dumps(
        {
            "sections": mcq.public_sections(PAPER),
            "questions": mcq.public_paper(PAPER, seed=SEED),
        }
    )
    for field in KEY_FIELDS:
        assert field not in payload, f"{field} reached the candidate's paper"

    # And the VALUES, not only the field names — a key renamed on the way out would
    # slip past the check above while leaking exactly as much.
    for question in PAPER["questions"]:
        for option_id in question.get("correctOptionIds") or []:
            # The id itself legitimately appears (it names an option the candidate
            # picks from), so what is checked is that it is not marked out.
            assert f'"correct": "{option_id}"' not in payload
        assert json.dumps(question.get("correctPairs") or {}) not in payload or not (
            question.get("correctPairs")
        )


def test_every_stored_question_is_published() -> None:
    """Including the unsectioned one.

    Dropping a question the candidate is expected to answer scores them zero on it, and
    the failure is invisible: the paper simply looks shorter than the recruiter built.
    """
    published = {q["id"] for q in mcq.public_paper(PAPER, seed=SEED)}
    assert published == {q["id"] for q in PAPER["questions"]}


def test_unsectioned_questions_sort_last() -> None:
    order = [q["id"] for q in mcq.public_paper(PAPER, seed=SEED)]
    assert order[-1] == "q-unsectioned"
    assert order.index("q-single") < order.index("q-multi"), (
        "section order defines the order a candidate meets questions in"
    )


def _paired_row_by_row(question: dict, pairing: dict) -> bool:
    """Would pairing column A with column B, row by row, score full marks?"""
    return [pairing.get(p["id"]) for p in question["prompts"]] == [
        m["id"] for m in question["matches"]
    ]


def test_the_match_column_is_never_published_in_the_answer_order() -> None:
    """For a pairing, the authored order IS the answer.

    Publishing column B as stored lets anybody who notices solve the question by reading
    straight down the list — full marks, with no key ever leaving the server.
    `_unaligned` is what prevents it, and this pins that it ran.

    The property is that the WHOLE column is not the pairing, not that no single row
    happens to line up. A partial coincidence is what a shuffle looks like and tells a
    candidate nothing: they cannot know which row it was. Requiring a full derangement
    would be a stronger claim than the code makes, and asserting it here would have the
    test fail on a seed rather than on a defect.
    """
    stored = next(q for q in PAPER["questions"] if q["id"] == "q-match")
    pairing = stored["correctPairs"]
    for seed in (SEED, "another-interview", "third", None):
        match = next(q for q in mcq.public_paper(PAPER, seed=seed) if q["id"] == "q-match")
        assert not _paired_row_by_row(match, pairing), (
            f"with seed {seed!r} the paper hands over the whole pairing"
        )


def test_the_shuffle_is_stable_for_one_candidate_and_differs_between_two() -> None:
    """A refresh must not reorder the options under somebody mid-decision, and the next
    candidate must not inherit "it's the third one"."""
    once = mcq.public_paper(PAPER, seed=SEED)
    again = mcq.public_paper(PAPER, seed=SEED)
    other = mcq.public_paper(PAPER, seed="a-different-interview")
    assert once == again
    assert once != other


def test_shuffling_off_keeps_authored_option_order_but_still_unaligns_a_pairing() -> None:
    """`shuffleOptions: false` is for a paper whose options are ordered meaningfully —
    "all of the above", or a sequence. It is NOT permission to publish a pairing in the
    order it was authored, because there the order is the key itself."""
    seed = mcq.shuffle_seed_for({"shuffleOptions": False}, attempt_key="whatever")
    assert seed is None

    plain = mcq.public_paper(PAPER, seed=seed)
    single = next(q for q in plain if q["id"] == "q-single")
    assert [o["id"] for o in single["options"]] == ["a", "b", "c", "d"]

    match = next(q for q in plain if q["id"] == "q-match")
    stored = next(q for q in PAPER["questions"] if q["id"] == "q-match")
    assert not _paired_row_by_row(match, stored["correctPairs"])


# ── scoring ───────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("case", SUBMISSIONS, ids=lambda c: c["name"])
def test_a_submission_scores_as_the_contract_says(case: dict, golden: dict) -> None:
    expected = golden["scores"].get(case["name"])
    assert expected is not None, f"no fixture for {case['name']} — regenerate"
    questions = mcq.questions_of(PAPER)
    scored = mcq_runtime.score(
        questions,
        mcq.clean_answers(case["answers"], questions),
        config=case["config"],
        paper=PAPER,
    )
    assert scored == expected, case["why"]


def test_scoring_is_the_same_whichever_surface_ran_it() -> None:
    """11b.5, asserted rather than assumed.

    `app/web/routes/sessions_mcq.py` and `app/routers/mcq.py` both call
    `mcq_runtime.score`. If somebody reintroduces a second scorer for either surface,
    the same paper starts producing two numbers depending on the device a candidate
    happened to use — which is exactly the class of drift this whole phase exists to
    remove.
    """
    import inspect

    from app.routers import mcq as shared_routes
    from app.web.routes import sessions_mcq as web_routes

    for module in (shared_routes, web_routes):
        source = inspect.getsource(module)
        assert "score_submission(" not in source, (
            f"{module.__name__} scores a paper itself; call mcq_runtime.score so both "
            "surfaces cannot disagree"
        )
    assert "mcq_runtime.score(" in inspect.getsource(web_routes)


def test_an_unscoreable_paper_has_no_percentage() -> None:
    """None, not zero. A paper with nothing scoreable in it has no percentage, and a
    zero would read as a candidate who got everything wrong."""
    scored = mcq_runtime.score([], {}, config={}, paper={"questions": []})
    assert scored["percent"] is None
    summary = mcq_runtime.result_summary(scored, paper={"name": "Empty"})
    assert summary["overallScore"] == 0
    assert "could be scored" in summary["summary"]


def test_the_candidate_result_carries_no_key() -> None:
    """Showing somebody their score is not the same as publishing the answers.

    The STORED result holds `correctOptionIds` per question, because that is what makes
    the recruiter's report reviewable. Returning it verbatim to a candidate whose
    recruiter enabled `showScoreToCandidate` would hand over the whole key.
    """
    questions = mcq.questions_of(PAPER)
    scored = mcq_runtime.score(questions, {"q-single": ["b"]}, config={}, paper=PAPER)
    payload = json.dumps(mcq_runtime.candidate_result(scored))
    for field in KEY_FIELDS:
        assert field not in payload, f"{field} reached the candidate's result"
    assert "correctCount" in payload, "the candidate still learns how they did"


def test_the_result_summary_is_shaped_for_the_frozen_dart_reader() -> None:
    """MCQ writes `interviews.result` in the same shape every other track does, because
    a recruiter reads it on the same screens and `interview.dart` reads these names."""
    from app import reports

    questions = mcq.questions_of(PAPER)
    scored = mcq_runtime.score(questions, {}, config={}, paper=PAPER)
    summary = mcq_runtime.result_summary(scored, paper=PAPER)

    ai_shape = set(reports.build_result_summary({}))
    assert set(summary) == ai_shape, (
        "MCQ's flat result must carry the same fields as an AI-scored one; the mobile "
        "model reads them directly and a missing field renders as an empty badge"
    )
    # Except for who did the scoring, which is deliberately different: nothing
    # generated this number, so a recruiter must not be offered a re-score for it.
    assert summary["evaluatedBy"] == "mcq"
    assert "resultPublished" not in summary, (
        "releasing a result to the candidate is a recruiter action"
    )
