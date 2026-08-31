"""Resolving the language dropdown against a REAL judge's language list.

`judge0_languages.fixture.json` is the actual response from a live Judge0 instance
— 71 languages, seven variants of C, five of C++, six of Python. It is a fixture
rather than a hand-written sample precisely because the awkward cases here are the
real ones: two Java toolchains, GCC alongside Clang, Python 2 sitting next to
Python 3, and a Node version numbered "22.08.0" that sorts wrongly as text.

The test that matters most is `test_it_picks_modern_versions`. The hard-coded ids
this replaced were all VALID and all pointed at 2019 releases — Python 3.8, Node
12, Java 13, Rust 1.40, TypeScript 3.7 — which is the kind of bug that produces
syntax errors a candidate reads as their own mistake.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.web.services.coding_languages import CANONICAL, _version_of, resolve

FIXTURE = json.loads((Path(__file__).parent / "judge0_languages.fixture.json").read_text())


def _by_key() -> dict[str, dict]:
    return {entry["key"]: entry for entry in resolve(FIXTURE)}


def test_all_nine_canonical_languages_resolve() -> None:
    """A language the product offers must map to something the judge can run."""
    resolved = _by_key()
    assert set(resolved) == {key for key, _, _ in CANONICAL}
    assert len(resolved) == 9


def test_it_picks_modern_versions() -> None:
    """THE test. The ids this replaced were valid and ancient.

    Asserted on the judge's own version string rather than the id, because the id
    is meaningless without the instance and the version is the thing a candidate
    actually experiences.
    """
    resolved = _by_key()
    assert resolved["python"]["version"] == "Python (3.14.0)"
    assert resolved["javascript"]["version"] == "JavaScript (Node.js 22.08.0)"
    assert resolved["typescript"]["version"] == "TypeScript (5.6.2)"
    assert resolved["java"]["version"] == "Java (JDK 17.0.6)"
    assert resolved["go"]["version"] == "Go (1.23.5)"
    assert resolved["rust"]["version"] == "Rust (1.85.0)"


def test_node_22_08_beats_node_20_despite_the_leading_zero() -> None:
    """"22.08.0" sorts before "20.17.0" as text. Compared as integers it does not.

    Called out on its own because a text sort would silently hand every candidate
    an older Node and nothing would look wrong.
    """
    assert _version_of("JavaScript (Node.js 22.08.0)") == (22, 8, 0)
    assert _version_of("JavaScript (Node.js 22.08.0)") > _version_of("JavaScript (Node.js 20.17.0)")


def test_python_2_is_never_offered() -> None:
    """The fixture contains Python (2.7.17). Offering it in a hiring assessment
    would be a trap rather than a choice."""
    assert "2.7" not in _by_key()["python"]["version"]


def test_c_does_not_match_csharp() -> None:
    """`C` and `C#` are different languages whose names share a prefix. The
    fixture has both, so this is a real collision and not a hypothetical."""
    resolved = _by_key()
    assert resolved["c"]["version"].startswith("C (")
    assert resolved["csharp"]["version"].startswith("C# (")
    assert resolved["c"]["id"] != resolved["csharp"]["id"]


def test_toolchain_preference_is_explicit_not_a_version_race() -> None:
    """The fixture offers C++ under GCC 14.1.0 and Clang 19.1.7. 19 > 14 says
    nothing useful across toolchains, so the order in CANONICAL decides — GCC
    first — rather than whichever number happens to be larger."""
    resolved = _by_key()
    assert resolved["cpp"]["version"] == "C++ (GCC 14.1.0)"
    assert resolved["c"]["version"] == "C (GCC 14.1.0)"


def test_every_resolved_id_exists_on_the_judge() -> None:
    """The whole point: no dropdown entry the judge cannot run."""
    real_ids = {entry["id"] for entry in FIXTURE}
    for entry in resolve(FIXTURE):
        assert entry["id"] in real_ids, f"{entry['key']} resolved to a non-existent id"


def test_a_language_the_judge_lacks_is_omitted_not_offered_broken() -> None:
    """A judge built without Rust should not show Rust in the dropdown at all.

    Omission rather than a disabled entry, because a recruiter authoring a problem
    must not be able to require a language their candidates cannot use.
    """
    without_rust = [lang for lang in FIXTURE if not lang["name"].startswith("Rust")]
    keys = {entry["key"] for entry in resolve(without_rust)}
    assert "rust" not in keys
    assert len(keys) == 8


def test_resolution_is_deterministic() -> None:
    """Same input, same answer — a score must be reproducible, and the language a
    candidate ran on is part of that record."""
    assert resolve(FIXTURE) == resolve(FIXTURE)


def test_malformed_entries_are_skipped_rather_than_crashing() -> None:
    """The judge is an external service; its response is not our schema."""
    messy = FIXTURE + [{"id": None, "name": "Broken"}, {"name": "No id"}, "not even a dict"]
    assert len(resolve(messy)) == 9


@pytest.mark.parametrize(
    "name,expected",
    [
        ("Python (3.14.0)", (3, 14, 0)),
        ("Java (JDK 17.0.6)", (17, 0, 6)),
        ("C# (Mono 6.6.0.161)", (6, 6, 0, 161)),
        ("Assembly (NASM 2.14.02)", (2, 14, 2)),
        ("Bash (5.0.0)", (5, 0, 0)),
        ("Plain Text", ()),
    ],
)
def test_version_extraction(name: str, expected: tuple[int, ...]) -> None:
    assert _version_of(name) == expected


# ── starter code ─────────────────────────────────────────────────────────────


def test_every_offered_language_has_a_starter() -> None:
    """A language in the dropdown with a blank editor makes the candidate spend
    their first minutes remembering how to read stdin, which is not what is being
    assessed."""
    from app.web.services.coding_starters import STARTERS

    for key, _, _ in CANONICAL:
        assert STARTERS.get(key), f"no starter for {key}"


def test_starters_read_stdin_and_nothing_more() -> None:
    """Each starter must actually consume stdin — that is its whole job — and must
    not contain a partial solution for the candidate to reverse-engineer."""
    from app.web.services.coding_starters import STARTERS

    reads_stdin = {
        "python": "sys.stdin",
        "javascript": "readFileSync(0",
        "typescript": "readFileSync(0",
        "java": "System.in",
        "cpp": "cin",
        "c": "scanf",
        "csharp": "Console.ReadLine",
        "go": "os.Stdin",
        "rust": "io::stdin",
    }
    for key, needle in reads_stdin.items():
        assert needle in STARTERS[key], f"{key} starter does not read stdin"


def test_the_typescript_starter_declares_require() -> None:
    """It did not, and it did not COMPILE — every candidate who chose TypeScript
    would have got a Compilation Error on the untouched starter.

    Judge0 CE runs `tsc` with no @types/node, so a bare `require(...)` is TS2304
    "Cannot find name require". Nothing in a Python test suite can compile
    TypeScript, so this pins the one line that makes it compile rather than the
    outcome. It was found by running judge0-verify.sh against the live judge; the
    test exists so it is not found that way twice.
    """
    from app.web.services.coding_starters import STARTERS

    starter = STARTERS["typescript"]
    assert "require(" in starter, "fixture no longer proves anything"
    assert "declare const require" in starter


def test_with_starters_attaches_without_losing_the_resolution() -> None:
    from app.web.services.coding_starters import with_starters

    resolved = resolve(FIXTURE)
    attached = with_starters(resolved)
    assert len(attached) == len(resolved)
    assert all(entry["starter"] for entry in attached)
    # The resolution itself is untouched.
    assert [e["id"] for e in attached] == [e["id"] for e in resolved]
