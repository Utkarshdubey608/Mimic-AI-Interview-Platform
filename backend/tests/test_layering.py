"""The web surface must stay separable.

`/api/web/*` is a transitional namespace: at some point its routes merge into the
common surface and the duplicates (two-way, Gemini generate, Tavus, Deepgram)
collapse. That consolidation is only a refactor rather than a rewrite while the
boundary holds, and a boundary that is only a convention does not hold.

Three rules, each with a test:

1. Nothing outside `app/web/` imports from it — so the surface stays deletable.
2. `app/web/` never imports `app.routers.*` — the mobile/desktop API. Sharing
   goes through the kernel, never sideways between the two surfaces.
3. `app/web/` only imports kernel modules from `app.*`, never the common
   surface's domain logic — otherwise a change made for the web breaks mobile.
"""

from __future__ import annotations

import ast
from pathlib import Path

APP = Path(__file__).resolve().parent.parent / "app"

# The shared kernel: configuration, auth, Firestore bootstrap, rate limiting and
# the vendor clients. Both surfaces build on these, so a change here is reviewed
# against both. Anything in `app.*` NOT listed is the common surface's own domain
# logic and is off limits to the web package.
#
# The bare package name `app` is deliberately absent: listing it would make the
# prefix test below match every `app.*` module and whitelist the whole codebase.
# `from app import providers` is handled by expanding it to `app.providers` in
# `_imports`, so the submodule is what gets checked.
KERNEL = {
    "app.config",
    "app.security",
    "app.firebase",
    "app.ratelimit",
    "app.providers",
    # Mail transport is shared deliberately, not by accident. `app.mailer` was
    # rewritten as a generic SMTP sender precisely so one implementation serves both
    # surfaces: the web invite flow needs a per-send From, a reply-to and the
    # X-Mailin-custom header, and mobile needs none of them but is unharmed by their
    # existing. A second copy in app/web/ would be two things to keep in sync on the
    # one path where a mistake means a candidate never hears from anyone.
    #
    # The consequence: a change to app/mailer.py is a change to the MOBILE contract
    # too, so it is reviewed against `/api/emails/send` — see tests/test_mailer_modes.py.
    "app.mailer",
    # The `interviews` collection is the ONE record both clients read and write, so
    # the module that knows its field names has to be shared — not copied. It was
    # copied: `app/web/services/interview_invite.py` carried its own
    # `INTERVIEWS_COLLECTION`, its own `type`-from-`mode` mapping and its own spelling
    # of every frozen field. Two modules independently knowing one schema is how the
    # web and mobile clients drifted apart, and a convention was never going to hold
    # them together.
    #
    # The consequence, and it is the same bargain as app.mailer: a change to
    # app/interviews.py is a change to the MOBILE contract. Field names here are read
    # by `interview.dart` and cannot be renamed. Review against both surfaces, and
    # against `contracts/interview_document.fixtures.json`, which exists so a change
    # that would break the other client fails a test instead of a candidate's
    # interview.
    "app.interviews",
    # A report IS the result of one interview, and BOTH clients display reports. While
    # it lived in `web_reports` the mobile app was structurally unable to show one for
    # an interview taken in a browser, and the web sessions list showed no score for
    # one taken on a phone. Same bargain as the two above: a change here is a change to
    # what the mobile app can read.
    "app.reports",
    # Scoring an interview. Promoted so BOTH surfaces run the same scorer: a failed
    # scoring run used to be terminal in the browser, purely because the orchestration
    # lived inside `app/routers/evaluations.py` and rule 2 (correctly) keeps the web
    # package out of the mobile surface. A second implementation would have been a
    # second set of results for the same interview.
    #
    # Same bargain again: a change here changes what the MOBILE app stores on an
    # interview, so it is reviewed against tests/test_evaluations.py as well.
    "app.evaluation",
    # Invite and notification email templates. `email_templates` is now the ONE store
    # for them: the web surface kept its own `web_invite_email_templates`, so a
    # recruiter's saved template was invisible on the other client — while the
    # RENDERING was already unified against a golden fixture. Storage was the half
    # that had not caught up.
    #
    # Same bargain: a change here is a change to `/api/templates`, the mobile
    # surface's frozen route, so it is reviewed against both.
    "app.templates_store",
    # The built-in templates the store falls back to. Shared for the same reason.
    "app.templating",
    # A test's timeline. BOTH clients grew a multi-round feature and neither knew about
    # the other's — mobile's `tests/{id}/rounds` against the web's `web_pipelines` — so
    # a candidate advanced on one was invisible on the other. This is mobile's model,
    # promoted, because it derives round state from the clock (nothing to go stale),
    # copies the window onto each assignment (the candidate's device cannot read round
    # documents) and stamps ranks (so a re-score elsewhere does not shift somebody's
    # position under them).
    #
    # Same bargain: field names here are read by `interview_round.dart` and cannot be
    # renamed.
    "app.rounds",
    # The writes that go with it — window propagation and stamped ranks. Same
    # bargain again.
    "app.rounds_writer",
    # What a candidate thought of the interview. This was `web_feedback`, so the prompt
    # existed only in the browser and a candidate who interviewed on the phone was
    # never asked — on the only channel the product has for hearing from candidates.
    "app.feedback",
    # MCQ scoring and the PUBLIC question projection.
    #
    # MCQ is the only track whose questions contain the answers, so the allow-list in
    # `mcq_public_question` is not a formatting concern — it is the thing standing
    # between a stored answer key and a candidate's device. One implementation, shared,
    # rather than one per client.
    #
    # Pure: it imports nothing but the standard library, which is what made the move
    # free.
    "app.mcq_scoring",
    # Where a paper lives and where an attempt at one lives. An MCQ attempt used to be
    # part of a `web_session` — with the resolved paper and its ANSWER KEY inside it —
    # which is precisely what welded the runtime to the web surface and stopped MCQ
    # reaching the other client.
    "app.mcq",
    # Sitting a paper: resolve, autosave, submit. The runtime both clients call.
    "app.mcq_runtime",
    # Authoring a paper: cleaning, validation, and what stands between a draft and a
    # usable assessment. Pure. Shared so a paper authored on a phone and one authored in
    # a browser are the same document under the same rules, rather than two validators
    # that agree until one of them is changed.
    "app.mcq_authoring",
    # Writing a paper: prompts, response schemas, and the normalisation that decides
    # what counts as a usable generated question. Pure — the two surfaces call two
    # different Gemini clients (see app/web/services/mcq_gen.py on why), so sharing
    # this is what stops the same request producing two different papers.
    "app.mcq_gen",
    # Classifying a spreadsheet's raw role string into a standard category. Shared so
    # a role classified during import reads the same way whether the recruiter is on
    # the web or the phone — neither client re-implements the keyword matching.
    "app.role_classification",
    # Reusable per-role interview pipeline templates (`roleConfigs/{id}`). Shared and
    # unprefixed for the same reason `app.rounds` is: a pipeline authored on one
    # client must be usable on the other through the same document.
    "app.role_configs",
    # The Candidates Kanban's read model — aggregating a recruiter's interviews by
    # candidate. Shared kernel because it reads the same `interviews` collection
    # `app.interviews`/`app.rounds_writer` already own; kept out of the web package
    # so the aggregation logic has exactly one home.
    "app.candidates",
}


def _module_name(path: Path) -> str:
    """`app/web/store/db.py` -> `app.web.store.db`."""
    rel = path.relative_to(APP.parent).with_suffix("")
    parts = [p for p in rel.parts if p != "__init__"]
    return ".".join(parts)


def _imports(path: Path) -> set[str]:
    """Absolute module names imported by a file.

    Two details make this accurate enough to be worth trusting:

    * Relative imports are resolved against the file's own package, so
      `from .db import WebStore` inside `app/web/store/` is seen as
      `app.web.store.db` rather than skipped.
    * `from <pkg> import a, b` also yields `<pkg>.a` and `<pkg>.b`. Without that,
      `from app import interviews` would be recorded only as `app` and every rule
      below would miss it — the imported name IS the module in that form.
    """
    tree = ast.parse(path.read_text(encoding="utf-8"))
    own = _module_name(path)
    package = own.rsplit(".", 1)[0] if "." in own else own

    names: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            if node.level == 0:
                base = node.module or ""
            elif node.level == 1:
                base = f"{package}.{node.module}" if node.module else package
            else:
                trimmed = package.rsplit(".", node.level - 1)[0]
                base = f"{trimmed}.{node.module}" if node.module else trimmed
            if not base:
                continue
            names.add(base)
            # `from app import providers` -> also record `app.providers`.
            names.update(f"{base}.{alias.name}" for alias in node.names)
    return names


def _python_files(*, inside_web: bool) -> list[Path]:
    return [
        path
        for path in sorted(APP.rglob("*.py"))
        if ("web" in path.relative_to(APP).parts) is inside_web
    ]


def _is_kernel(name: str) -> bool:
    return name in KERNEL or any(name.startswith(f"{k}.") for k in KERNEL)


# `app/main.py` is the ONE designated consumer: it calls `web.install(app)`. That
# single call is the mount point the whole design rests on, and
# `test_main_installs_the_web_surface_exactly_once` pins it to exactly one. Every
# other module importing the web surface is a leak.
MOUNT_POINT = "main.py"


def test_nothing_outside_the_web_package_imports_it() -> None:
    """Rule 1 — the web surface has one consumer, so it can be removed."""
    offenders = [
        f"{path.relative_to(APP)} imports {name}"
        for path in _python_files(inside_web=False)
        if path.name != MOUNT_POINT
        for name in _imports(path)
        if name == "app.web" or name.startswith("app.web.")
    ]
    assert not offenders, (
        "the web surface has leaked into the common surface and is no longer "
        "removable:\n  " + "\n  ".join(offenders)
    )


def test_the_web_package_never_imports_the_common_routers() -> None:
    """Rule 2 — no sideways coupling between the two API surfaces."""
    offenders = [
        f"{path.relative_to(APP)} imports {name}"
        for path in _python_files(inside_web=True)
        for name in _imports(path)
        if name == "app.routers" or name.startswith("app.routers.")
    ]
    assert not offenders, (
        "the web surface reaches into the mobile/desktop API; share through the "
        "kernel instead:\n  " + "\n  ".join(offenders)
    )


def test_the_web_package_only_imports_kernel_modules() -> None:
    """Rule 3 — the web surface builds on the kernel, not on mobile's domain logic."""
    offenders = [
        f"{path.relative_to(APP)} imports {name}"
        for path in _python_files(inside_web=True)
        for name in _imports(path)
        # `app` alone carries no information — `_imports` expands the names it
        # brought in, and those are what get judged.
        if name != "app"
        and name.startswith("app")
        and not name.startswith("app.web")
        and not _is_kernel(name)
    ]
    assert not offenders, (
        "the web surface imports common-surface domain logic. Either it belongs "
        "in the kernel (add it to KERNEL here, and review the change against the "
        "mobile API) or the web surface needs its own copy:\n  "
        + "\n  ".join(offenders)
    )


def test_main_installs_the_web_surface_exactly_once() -> None:
    """The single mount point — two edits to remove the surface, not a hunt."""
    source = (APP / "main.py").read_text(encoding="utf-8")
    assert source.count("web.install(app)") == 1
