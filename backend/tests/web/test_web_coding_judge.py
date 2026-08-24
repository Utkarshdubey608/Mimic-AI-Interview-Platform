"""The judge adapter and the grader.

No Judge0 instance is contacted. Every request the adapter would make is captured
and asserted against, which is the only way to pin the four details that were
learned the hard way from a live instance — because each of them is invisible in a
happy-path integration test and fatal in production:

  base64_encoded=true      omit it and the GET FAILS on any compile error
  no wait=true             403 on official hosts, and does not scale
  enable_network: False    Judge0 defaults to letting the CALLER turn it on
  token in a header        Judge0's own security guidance

And the one that is not about Judge0 at all: with nothing configured, no request
is made and nothing runs.
"""

from __future__ import annotations

import asyncio
import base64

import pytest

from app.config import Settings
from app.web.services import coding_judge as judge
from app.web.services import coding_scoring as scoring

CASE = {"id": "t1", "input": "2 3", "expectedOutput": "5", "hidden": False, "points": 4}


class FakeResponse:
    def __init__(self, payload: dict, status_code: int = 200) -> None:
        self._payload = payload
        self.status_code = status_code

    def json(self) -> dict:
        return self._payload


class FakeClient:
    """Records every call, and returns a scripted sequence of GET payloads."""

    def __init__(self, get_payloads: list[dict], post_payload: dict | None = None) -> None:
        self.posts: list[dict] = []
        self.gets: list[dict] = []
        self._get_payloads = list(get_payloads)
        self._post_payload = post_payload or {"token": "tok-1"}

    async def post(self, url, *, params=None, headers=None, json=None):  # noqa: A002
        self.posts.append({"url": url, "params": params or {}, "headers": headers or {}, "json": json or {}})
        return FakeResponse(self._post_payload, 201)

    async def get(self, url, *, params=None, headers=None):
        self.gets.append({"url": url, "params": params or {}, "headers": headers or {}})
        payload = self._get_payloads.pop(0) if self._get_payloads else {"status": {"id": 3}}
        return FakeResponse(payload)


def _install(monkeypatch, client: FakeClient) -> None:
    monkeypatch.setattr(judge, "http_client", lambda: client)


def _settings(**kw) -> Settings:
    return Settings(judge0_url="http://judge.internal:2358", judge0_token="tok-secret", **kw)


def _accepted(**extra) -> dict:
    return {"status": {"id": 3}, "time": "0.011", "memory": 3360, **extra}


# ── nothing configured means nothing runs ─────────────────────────────────────


def test_with_no_judge_configured_nothing_is_executed(monkeypatch) -> None:
    """The non-negotiable. There is deliberately no local fallback, because the
    local fallback IS the vulnerability."""
    client = FakeClient([])
    _install(monkeypatch, client)

    with pytest.raises(judge.JudgeNotConfigured):
        asyncio.run(
            judge.run_case(
                Settings(judge0_url=""),
                source="print(1)",
                language_id=71,
                stdin="",
                expected_output="1",
                time_limit_ms=1000,
                memory_mb=128,
            )
        )

    assert client.posts == [], "a request was made with no judge configured"


def test_configured_reports_the_truth() -> None:
    assert judge.configured(Settings(judge0_url="")) is False
    assert judge.configured(_settings()) is True


# ── the four hard-won request details ─────────────────────────────────────────


def test_base64_encoded_is_always_true_on_both_calls(monkeypatch) -> None:
    """Omit this and the GET fails outright on any compile error — which is the
    single most likely result during an interview."""
    client = FakeClient([_accepted()])
    _install(monkeypatch, client)
    asyncio.run(judge.run_case(_settings(), source="x", language_id=71, stdin="",
                               expected_output="1", time_limit_ms=1000, memory_mb=128))

    assert client.posts[0]["params"]["base64_encoded"] == "true"
    assert client.gets[0]["params"]["base64_encoded"] == "true"


def test_wait_is_never_requested(monkeypatch) -> None:
    """Judge0 returns 403 for wait=true on official hosts and says it does not
    scale. The adapter polls instead."""
    client = FakeClient([_accepted()])
    _install(monkeypatch, client)
    asyncio.run(judge.run_case(_settings(), source="x", language_id=71, stdin="",
                               expected_output="1", time_limit_ms=1000, memory_mb=128))

    assert "wait" not in client.posts[0]["params"]
    assert "wait" not in client.gets[0]["params"]


def test_network_is_explicitly_disabled_on_every_submission(monkeypatch) -> None:
    """Judge0 DEFAULTS to letting the API caller enable network access. The server
    must forbid it; the request says so too, so neither alone is load-bearing."""
    client = FakeClient([_accepted()])
    _install(monkeypatch, client)
    asyncio.run(judge.run_case(_settings(), source="x", language_id=71, stdin="",
                               expected_output="1", time_limit_ms=1000, memory_mb=128))

    assert client.posts[0]["json"]["enable_network"] is False


def test_the_token_travels_in_a_header_and_never_in_the_query(monkeypatch) -> None:
    client = FakeClient([_accepted()])
    _install(monkeypatch, client)
    asyncio.run(judge.run_case(_settings(), source="x", language_id=71, stdin="",
                               expected_output="1", time_limit_ms=1000, memory_mb=128))

    assert client.posts[0]["headers"]["X-Auth-Token"] == "tok-secret"
    assert "tok-secret" not in str(client.posts[0]["params"])
    assert "tok-secret" not in client.posts[0]["url"]
    assert client.gets[0]["headers"]["X-Auth-Token"] == "tok-secret"


# ── the payload ───────────────────────────────────────────────────────────────


def test_source_stdin_and_expected_output_are_base64(monkeypatch) -> None:
    client = FakeClient([_accepted()])
    _install(monkeypatch, client)
    asyncio.run(judge.run_case(_settings(), source="print(2+3)", language_id=71, stdin="2 3",
                               expected_output="5", time_limit_ms=1000, memory_mb=128))

    body = client.posts[0]["json"]
    assert base64.b64decode(body["source_code"]).decode() == "print(2+3)"
    assert base64.b64decode(body["stdin"]).decode() == "2 3"
    assert base64.b64decode(body["expected_output"]).decode() == "5"


def test_limits_are_converted_to_judge0_units(monkeypatch) -> None:
    """Judge0 takes CPU time in SECONDS and memory in KILOBYTES. Getting either
    wrong by a factor of 1000 is a silently permissive sandbox."""
    client = FakeClient([_accepted()])
    _install(monkeypatch, client)
    asyncio.run(judge.run_case(_settings(), source="x", language_id=71, stdin="",
                               expected_output="1", time_limit_ms=2500, memory_mb=128))

    body = client.posts[0]["json"]
    assert body["cpu_time_limit"] == 2.5
    assert body["memory_limit"] == 128 * 1024
    # A wall limit above the CPU limit, because a CPU limit alone does not stop
    # a program that sleeps rather than spins.
    assert body["wall_time_limit"] > body["cpu_time_limit"]


# ── reading the result ────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "status_id,expected",
    [
        (3, scoring.ACCEPTED),
        (4, scoring.WRONG_ANSWER),
        (5, scoring.TIME_LIMIT),
        (6, scoring.COMPILE_ERROR),
        (7, scoring.RUNTIME_ERROR),
        (11, scoring.RUNTIME_ERROR),
        (12, scoring.RUNTIME_ERROR),
        (13, scoring.INTERNAL_ERROR),
        (14, scoring.INTERNAL_ERROR),
    ],
)
def test_every_judge0_status_maps_to_our_vocabulary(monkeypatch, status_id, expected) -> None:
    client = FakeClient([{"status": {"id": status_id}}])
    _install(monkeypatch, client)
    verdict = asyncio.run(judge.run_case(_settings(), source="x", language_id=71, stdin="",
                                         expected_output="1", time_limit_ms=1000, memory_mb=128))
    assert verdict["status"] == expected


def test_an_unknown_status_is_an_internal_error_not_a_pass(monkeypatch) -> None:
    """A status this adapter does not recognise must never be read as success."""
    client = FakeClient([{"status": {"id": 99}}])
    _install(monkeypatch, client)
    verdict = asyncio.run(judge.run_case(_settings(), source="x", language_id=71, stdin="",
                                         expected_output="1", time_limit_ms=1000, memory_mb=128))
    assert verdict["status"] == scoring.INTERNAL_ERROR


def test_it_polls_past_in_queue_and_processing(monkeypatch) -> None:
    client = FakeClient([{"status": {"id": 1}}, {"status": {"id": 2}}, _accepted()])
    _install(monkeypatch, client)
    verdict = asyncio.run(judge.run_case(_settings(), source="x", language_id=71, stdin="",
                                         expected_output="1", time_limit_ms=1000, memory_mb=128))
    assert verdict["status"] == scoring.ACCEPTED
    assert len(client.gets) == 3


def test_timings_are_absent_rather_than_zero_when_the_judge_reports_none(monkeypatch) -> None:
    """A reported 0ms is a claim; absent is the truth. Compile errors have no
    timings at all."""
    client = FakeClient([{"status": {"id": 6}, "compile_output": base64.b64encode(b"error: x").decode()}])
    _install(monkeypatch, client)
    verdict = asyncio.run(judge.run_case(_settings(), source="x", language_id=71, stdin="",
                                         expected_output="1", time_limit_ms=1000, memory_mb=128))
    assert verdict["timeMs"] is None
    assert verdict["memoryKb"] is None
    assert verdict["compileOutput"] == "error: x"


def test_compiler_output_with_invalid_utf8_still_arrives(monkeypatch) -> None:
    """The exact reason base64 is mandatory: compiler diagnostics carry bytes that
    are not valid UTF-8. They must degrade to a readable string, not lose the
    whole result."""
    raw = base64.b64encode(b"error: bad \xff byte").decode()
    client = FakeClient([{"status": {"id": 6}, "compile_output": raw}])
    _install(monkeypatch, client)
    verdict = asyncio.run(judge.run_case(_settings(), source="x", language_id=71, stdin="",
                                         expected_output="1", time_limit_ms=1000, memory_mb=128))
    assert "error: bad" in verdict["compileOutput"]


def test_a_judge_that_never_finishes_is_an_internal_error(monkeypatch) -> None:
    """Bounded, because the caller is a background task on Cloud Run where CPU is
    throttled between requests — an unbounded wait may simply never resume."""
    client = FakeClient([{"status": {"id": 2}} for _ in range(40)])
    _install(monkeypatch, client)
    # The real schedule sums to ~20s, and sleeping through it would make every run
    # of this suite 20 seconds slower to prove a bound that is about the SHAPE of
    # the loop, not its duration.
    monkeypatch.setattr(judge, "_BACKOFF", (0.0, 0.0, 0.0))
    verdict = asyncio.run(judge.run_case(_settings(), source="x", language_id=71, stdin="",
                                         expected_output="1", time_limit_ms=1000, memory_mb=128))
    assert verdict["status"] == scoring.INTERNAL_ERROR


def test_a_case_that_fails_to_run_gets_a_verdict_rather_than_vanishing(monkeypatch) -> None:
    """The denominator must not depend on how much of the run survived."""

    class Broken(FakeClient):
        async def post(self, url, *, params=None, headers=None, json=None):  # noqa: A002
            raise RuntimeError("judge is down")

    _install(monkeypatch, Broken([]))
    got = asyncio.run(
        judge.run_cases(_settings(), source="x", language_id=71,
                        cases=[CASE, {**CASE, "id": "t2"}], time_limit_ms=1000, memory_mb=128)
    )
    assert set(got) == {"t1", "t2"}
    assert all(v["status"] == scoring.INTERNAL_ERROR for v in got.values())


# ── grading ───────────────────────────────────────────────────────────────────


def _problem() -> dict:
    return {
        "testCases": [
            {"id": "a", "hidden": False, "points": 2},
            {"id": "b", "hidden": True, "points": 3},
            {"id": "c", "hidden": True, "points": 5},
        ]
    }


def test_partial_credit_is_the_default() -> None:
    """An interview is distinguishing a candidate who missed an edge case from one
    who wrote nothing that runs. Collapsing both to 0 throws away the useful signal."""
    result = scoring.score_submission(
        _problem(),
        {"a": {"status": scoring.ACCEPTED}, "b": {"status": scoring.WRONG_ANSWER},
         "c": {"status": scoring.ACCEPTED}},
    )
    assert result["score"] == 7
    assert result["maxScore"] == 10
    assert result["percent"] == 70.0
    assert result["passed"] == 2
    assert result["total"] == 3


def test_a_compile_error_scores_zero_by_arithmetic_not_by_rule() -> None:
    result = scoring.score_submission(
        _problem(), {k: {"status": scoring.COMPILE_ERROR} for k in ("a", "b", "c")}
    )
    assert result["score"] == 0
    assert result["compileFailed"] is True


def test_a_missing_verdict_is_not_run_and_still_counts_in_the_denominator() -> None:
    result = scoring.score_submission(_problem(), {"a": {"status": scoring.ACCEPTED}})
    assert result["score"] == 2
    assert result["maxScore"] == 10
    assert [c["status"] for c in result["cases"]] == [
        scoring.ACCEPTED, scoring.NOT_RUN, scoring.NOT_RUN
    ]


def test_a_judge_fault_is_flagged_separately_from_a_wrong_answer() -> None:
    """A submission full of these is an incident, not a score."""
    result = scoring.score_submission(_problem(), {"a": {"status": scoring.INTERNAL_ERROR}})
    assert result["judgeFaulted"] is True


def test_only_accepted_earns_points() -> None:
    for status in (scoring.WRONG_ANSWER, scoring.TIME_LIMIT, scoring.RUNTIME_ERROR,
                   scoring.COMPILE_ERROR, scoring.INTERNAL_ERROR, scoring.NOT_RUN):
        result = scoring.score_submission({"testCases": [{"id": "a", "points": 5}]},
                                          {"a": {"status": status}})
        assert result["score"] == 0, status


# ── what the candidate sees of their own result ───────────────────────────────


def test_a_hidden_case_reports_pass_fail_and_nothing_else() -> None:
    """Telling a candidate "4 of 7 passed" without which ones is uselessly vague.
    Showing a hidden case's status leaks a hint about its input's size, and its
    stdout would leak the input itself to a program that prints its own stdin."""
    graded = scoring.score_submission(
        _problem(),
        {"a": {"status": scoring.ACCEPTED, "timeMs": 11},
         "b": {"status": scoring.TIME_LIMIT, "timeMs": 2000},
         "c": {"status": scoring.WRONG_ANSWER, "timeMs": 9}},
    )
    view = scoring.candidate_view(graded)

    visible, hidden_1, hidden_2 = view["cases"]
    assert visible["status"] == scoring.ACCEPTED and visible["timeMs"] == 11
    for line in (hidden_1, hidden_2):
        assert line["hidden"] is True
        assert line["status"] is None, "a hidden case's status hints at its input"
        assert line["timeMs"] is None
    assert hidden_1["passed"] is False and hidden_2["passed"] is False


def test_the_candidate_view_carries_no_stdout_or_expected_output() -> None:
    graded = scoring.score_submission(_problem(), {"a": {"status": scoring.ACCEPTED}})
    payload = str(scoring.candidate_view(graded))
    for leak in ("expectedOutput", "stdout", "stderr", "points", "awarded"):
        assert leak not in payload, leak
