"""The input half of the MCQ paper golden contract.

Kept as code rather than JSON so each case carries the reason it exists. The OUTPUTS
live in `contracts/mcq_paper.fixtures.json`, asserted by BOTH
`backend/tests/test_mcq_contract.py` and
`mobile_desktop_app_version/test/mcq_contract_test.dart`.

**Why this exists.** MCQ is the only track whose questions contain the answers. Every
other contract in `contracts/` pins field NAMES so two clients agree on a shape; this one
pins an ABSENCE. `correctOptionIds` and `correctPairs` must not appear in the public
projection, and "must not" is only true if something fails when it stops being true.

The stored questions below are deliberately over-stuffed: every one carries its key, an
explanation, an internal note and a difficulty rating. If the projection ever changes
from an allow-list to a strip, one of those fields lands in the fixture and the diff is
a reviewable line in a pull request.

Regenerate with `REGENERATE_MCQ_FIXTURES=1 pytest tests/test_mcq_contract.py` and update
the Dart side in the same commit.
"""

from __future__ import annotations

# A single seed for every case, so the fixtures pin the SHUFFLE too. Option order is
# derived from it deterministically; a change to `_shuffled` that reorders a paper under
# a candidate mid-attempt shows up here rather than as answers that no longer line up.
SEED = "interview-fixture-1"

# Everything a stored question can carry. `correctOptionIds`, `explanation` and
# `internalNote` are all recruiter-side, and none may travel.
PAPER = {
    "id": "set-fixture-1",
    "name": "Backend Screening",
    "recruiterId": "uid-recruiter",
    "sections": [
        {
            "id": "aptitude",
            "name": "Aptitude",
            "instructions": "No calculator.",
            "passage": "A train leaves Mumbai at 09:00.",
        },
        {"id": "role", "name": "Role-based"},
    ],
    "questions": [
        {
            "id": "q-single",
            "sectionId": "aptitude",
            "type": "single",
            "text": "Which is a prime number?",
            "topic": "Numbers",
            "points": 1,
            "difficulty": "easy",
            "explanation": "7 has no divisors other than 1 and itself.",
            "internalNote": "swap this one next cycle",
            "options": [
                {"id": "a", "text": "4"},
                {"id": "b", "text": "7"},
                {"id": "c", "text": "9"},
                {"id": "d", "text": "21"},
            ],
            "correctOptionIds": ["b"],
        },
        {
            "id": "q-multi",
            "sectionId": "role",
            "type": "multi",
            "text": "Which of these are idempotent HTTP methods?",
            "topic": "HTTP",
            "points": 2,
            "options": [
                {"id": "get", "text": "GET"},
                {"id": "post", "text": "POST"},
                {"id": "put", "text": "PUT"},
                {"id": "patch", "text": "PATCH"},
            ],
            "correctOptionIds": ["get", "put"],
            "explanation": "PATCH is not required to be idempotent.",
        },
        {
            "id": "q-code",
            "sectionId": "role",
            "type": "single",
            "text": "What does this print?",
            # A code-reading question. The snippet is visible BY NECESSITY — the
            # question is unanswerable without it — and carries no key.
            "code": "print(len([1, 2, 3][1:]))",
            "topic": "Python",
            "points": 1,
            "options": [
                {"id": "a", "text": "1"},
                {"id": "b", "text": "2"},
                {"id": "c", "text": "3"},
            ],
            "correctOptionIds": ["b"],
        },
        {
            "id": "q-match",
            "sectionId": "role",
            "type": "match",
            "text": "Pair each status code with its meaning.",
            "topic": "HTTP",
            "points": 3,
            "prompts": [
                {"id": "p200", "text": "200"},
                {"id": "p404", "text": "404"},
                {"id": "p500", "text": "500"},
            ],
            "matches": [
                {"id": "m-ok", "text": "OK"},
                {"id": "m-missing", "text": "Not Found"},
                {"id": "m-broken", "text": "Server Error"},
            ],
            # The pairing IS the key. Its ABSENCE from the projection is the property
            # this whole file exists to pin — and so is the fact that column B comes
            # back unaligned, because authored order alone would give it away.
            "correctPairs": {"p200": "m-ok", "p404": "m-missing", "p500": "m-broken"},
        },
        {
            # No section. It must still be published — an unsectioned question is one
            # somebody has to answer — and it sorts LAST.
            "id": "q-unsectioned",
            "type": "single",
            "text": "Any final comments?",
            "options": [
                {"id": "y", "text": "Yes"},
                {"id": "n", "text": "No"},
            ],
            "correctOptionIds": ["y"],
        },
    ],
}

# What a candidate submits, and what it must score. Pinned so a change to the scorer
# that would silently regrade a stored attempt fails here.
SUBMISSIONS = [
    {
        "name": "submission/all-correct",
        "why": "the ceiling: every point available, and passed against a threshold",
        "answers": {
            "q-single": ["b"],
            "q-multi": ["get", "put"],
            "q-code": ["b"],
            "q-match": {"p200": "m-ok", "p404": "m-missing", "p500": "m-broken"},
            "q-unsectioned": ["y"],
        },
        "config": {"passThreshold": 60},
    },
    {
        "name": "submission/partial",
        "why": (
            "multi-select is ALL-OR-NOTHING by default, so one right and one missing "
            "scores zero on that question — the single most surprising rule in the "
            "scorer, and the one most likely to be 'fixed' by somebody who did not "
            "know it was deliberate"
        ),
        "answers": {
            "q-single": ["b"],
            "q-multi": ["get"],
            "q-match": {"p200": "m-ok", "p404": "m-broken", "p500": "m-missing"},
        },
        "config": {"passThreshold": 60},
    },
    {
        "name": "submission/nothing-answered",
        "why": (
            "an unanswered question is scored WRONG, not skipped. Dropping it from the "
            "denominator would let somebody raise their percentage by answering less."
        ),
        "answers": {},
        "config": {},
    },
    {
        "name": "submission/unknown-ids-are-dropped",
        "why": (
            "a client sending an option this question does not have is a bug, not an "
            "answer; storing it would make the report unexplainable to the recruiter"
        ),
        "answers": {
            "q-single": ["b", "not-an-option"],
            "q-nonexistent": ["a"],
            "q-match": {"p200": "m-ok", "ghost": "m-broken"},
        },
        "config": {},
    },
]
