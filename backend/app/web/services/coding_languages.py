"""Which languages a candidate may answer in, resolved from the judge itself.

WHY THIS FILE EXISTS AT ALL, because a hard-coded list looked fine and was not.

Judge0 identifies languages by NUMERIC ID, and the ids are per-instance: they
depend on which Judge0 build is running and which language packs it carries. The
first version of this feature hard-coded nine ids taken from documentation. All
nine resolve against a real instance — and they resolve to **Python 3.8.1, Node
12, Java 13, Rust 1.40 and TypeScript 3.7**, because those are the legacy ids. The
same instance also offers Python 3.14, Node 22, Java 17, Rust 1.85 and TS 5.6
under different ids.

That is not a cosmetic problem. A candidate writing modern Python or TypeScript
against a 2019 interpreter gets syntax errors that look like their own mistake,
during a graded assessment. And a hard-coded id that does not exist on the judge
you happen to self-host means a dropdown entry that silently fails.

So the list is DISCOVERED. `GET /languages` on the configured judge is the source
of truth, and this file's job is to map that instance's names onto the nine
canonical languages the product offers.

── How the mapping is decided, and why not "the newest version" ─────────────
Version numbers are only comparable WITHIN a toolchain. "C++ (GCC 14.1.0)" and
"C++ (Clang 19.1.7)" are both current; 19 > 14 says nothing useful. So each
canonical language names its preferred toolchains IN ORDER, the first one present
wins, and the newest version within that toolchain is chosen. Explicit and
deterministic, with no cleverness to debug at three in the morning.

Python 2 is excluded by requiring the `Python (3` prefix — offering it in a hiring
assessment in 2026 would be a trap rather than a choice.
"""

from __future__ import annotations

import logging
import re
import time

import httpx

from app.config import Settings
from app.providers.base import http_client

logger = logging.getLogger("web.coding.languages")

# The nine languages the product offers, each with the toolchain prefixes it will
# accept, most preferred first. A prefix is matched against the judge's own
# `name`, so `"C ("` cannot accidentally match `"C# (Mono …)"` or `"C3 (…)"`.
CANONICAL: tuple[tuple[str, str, tuple[str, ...]], ...] = (
    ("python", "Python 3", ("Python (3",)),
    ("javascript", "JavaScript (Node)", ("JavaScript (Node.js",)),
    ("typescript", "TypeScript", ("TypeScript (",)),
    ("java", "Java", ("Java (JDK", "Java (OpenJDK")),
    ("cpp", "C++", ("C++ (GCC", "C++ (Clang")),
    ("c", "C", ("C (GCC", "C (Clang")),
    ("csharp", "C#", ("C# (Mono", "C# (")),
    ("go", "Go", ("Go (",)),
    ("rust", "Rust", ("Rust (",)),
)

# How long a resolved mapping is trusted. The judge's language set changes only
# when the judge is rebuilt, so an hour is generous; the point of the TTL is that
# a rebuilt judge is picked up without redeploying the backend.
CACHE_TTL_SECONDS = 3600

_cache: dict[str, object] = {"at": 0.0, "languages": None}


def _version_of(name: str) -> tuple[int, ...]:
    """The version in a judge language name, as a comparable tuple.

    Takes the LAST dotted number in the string, which is where the version sits in
    every Judge0 name observed: "C++ (GCC 14.1.0)", "Java (JDK 17.0.6)",
    "JavaScript (Node.js 22.08.0)". Leading zeros are handled by int(), so
    Node "22.08.0" compares as (22, 8, 0) rather than sorting as text — which is
    the bug that would otherwise put 22.08 behind 22.9.
    """
    matches = re.findall(r"\d+(?:\.\d+)*", name)
    if not matches:
        return ()
    return tuple(int(part) for part in matches[-1].split("."))


def resolve(judge_languages: list[dict]) -> list[dict]:
    """Map a judge's own language list onto the nine canonical languages. Pure.

    Returns one entry per canonical language the judge can actually serve, in the
    product's own order. A canonical language the judge cannot serve is OMITTED
    rather than returned as unavailable — a dropdown should not offer something
    that cannot run, and a recruiter authoring a problem should not be able to
    require it.
    """
    by_name = [
        {"id": int(entry["id"]), "name": str(entry["name"])}
        for entry in judge_languages
        if isinstance(entry, dict) and entry.get("id") is not None and entry.get("name")
    ]

    out: list[dict] = []
    for key, label, prefixes in CANONICAL:
        for prefix in prefixes:
            candidates = [lang for lang in by_name if lang["name"].startswith(prefix)]
            if not candidates:
                continue
            best = max(candidates, key=lambda lang: _version_of(lang["name"]))
            out.append(
                {
                    "key": key,
                    "label": label,
                    "id": best["id"],
                    # The judge's own name, carried through so a recruiter can see
                    # exactly which interpreter their candidates will face. "Python
                    # 3" is what they pick; "Python (3.14.0)" is what they get.
                    "version": best["name"],
                }
            )
            break
    return out


async def available(settings: Settings) -> tuple[list[dict], str]:
    """The languages this deployment can offer, and where the answer came from.

    Returns `(languages, source)` where source is one of:
      "judge"     resolved from the configured judge — authoritative
      "fallback"  no judge configured, so the canonical list with NO ids, because
                  an id without a judge to run it on is a guess
      "stale"     the judge is configured but did not answer; a previously
                  resolved list is being reused rather than showing nothing

    A judge that is configured but unreachable is deliberately distinguished from
    one that is absent. They need different words in the UI: "not set up on this
    deployment" is a message for the recruiter, "temporarily unavailable" is a
    message for the candidate.
    """
    url = (settings.judge0_url or "").strip().rstrip("/")
    if not url:
        return (
            [
                {"key": key, "label": label, "id": None, "version": None}
                for key, label, _ in CANONICAL
            ],
            "fallback",
        )

    now = time.time()
    cached = _cache.get("languages")
    if cached and now - float(_cache["at"]) < CACHE_TTL_SECONDS:  # type: ignore[arg-type]
        return list(cached), "judge"  # type: ignore[arg-type]

    headers = {}
    if token := (settings.judge0_token or "").strip():
        headers["X-Auth-Token"] = token

    try:
        response = await http_client().get(f"{url}/languages", headers=headers, timeout=10.0)
        response.raise_for_status()
        resolved = resolve(response.json() or [])
    except (httpx.HTTPError, ValueError) as exc:
        logger.warning("could not read languages from the judge: %s", exc)
        if cached:
            return list(cached), "stale"  # type: ignore[arg-type]
        return (
            [
                {"key": key, "label": label, "id": None, "version": None}
                for key, label, _ in CANONICAL
            ],
            "stale",
        )

    _cache["languages"] = resolved
    _cache["at"] = now
    logger.info("resolved %d languages from the judge", len(resolved))
    return list(resolved), "judge"


def clear_cache() -> None:
    """For tests, and for a redeploy that should not trust a previous resolution."""
    _cache["languages"] = None
    _cache["at"] = 0.0
