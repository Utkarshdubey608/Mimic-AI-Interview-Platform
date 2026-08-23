"""Nothing is persisted to the server's filesystem.

Every durable thing this service owns lives in Firestore (documents) or Firebase Storage
(binary objects). That is not a style preference — a local write is silently broken in
three ways at once:

* **Deploys lose it.** A container's filesystem is ephemeral, so a cache or an upload on
  disk vanishes on the next release.
* **Workers disagree.** With more than one process, each keeps its own copy and misses
  what the others wrote. The Express `voiceJobs` map failed exactly this way — a job
  created by one worker read as FAILED from another.
* **Clients cannot reach it.** A mail client loading an invite logo, or a `<video>` tag
  loading a replica preview, cannot fetch from our disk at all.

The Express server wrote `db.json`, a face-disk cache and in-memory job state. None of
that survives here, and this test is what keeps it from creeping back.

Reads are fine — the service account JSON and `.env` are read at startup. Only WRITES
are flagged.
"""

from __future__ import annotations

import ast
from pathlib import Path

APP = Path(__file__).resolve().parent.parent / "app"

# Unambiguous filesystem writes. Checked by name because these have no non-filesystem
# meaning — unlike `.replace()`, which is `str.replace` far more often than `Path.replace`.
WRITE_CALLS = {
    "write_bytes",
    "write_text",
    "mkdir",
    "makedirs",
    "touch",
    "unlink",
    "rmtree",
    "copyfile",
    "copytree",
    "move",
    "NamedTemporaryFile",
    "TemporaryDirectory",
    "TemporaryFile",
    "mkstemp",
    "mkdtemp",
}

# Modules whose whole purpose is local files. Importing one in the web surface is the
# signal, since the writing call may be indirect.
FILESYSTEM_MODULES = {"shutil", "tempfile"}

# `open()` modes that create or modify a file. A bare `open(path)` reads and is allowed.
WRITE_MODES = set("wax+")


def _python_files() -> list[Path]:
    return sorted(APP.rglob("*.py"))


def _label(path: Path) -> str:
    return str(path.relative_to(APP))


def _write_mode(node: ast.Call) -> bool:
    """Does this `open()` call write?

    A missing mode means read. A non-literal mode is treated as a write, because it
    cannot be ruled out and a false positive here is cheap to resolve.
    """
    mode_arg = None
    if len(node.args) >= 2:
        mode_arg = node.args[1]
    for keyword in node.keywords:
        if keyword.arg == "mode":
            mode_arg = keyword.value

    if mode_arg is None:
        return False
    if isinstance(mode_arg, ast.Constant) and isinstance(mode_arg.value, str):
        return bool(WRITE_MODES & set(mode_arg.value))
    return True


def _offenders(path: Path) -> list[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    found: list[str] = []

    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            name = None
            if isinstance(node.func, ast.Attribute):
                name = node.func.attr
            elif isinstance(node.func, ast.Name):
                name = node.func.id

            if name in WRITE_CALLS:
                found.append(f"{_label(path)}:{node.lineno} calls {name}()")
            elif name == "open" and _write_mode(node):
                found.append(f"{_label(path)}:{node.lineno} opens a file for writing")

        elif isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name.split(".")[0] in FILESYSTEM_MODULES:
                    found.append(f"{_label(path)}:{node.lineno} imports {alias.name}")

        elif isinstance(node, ast.ImportFrom):
            if node.module and node.module.split(".")[0] in FILESYSTEM_MODULES:
                found.append(f"{_label(path)}:{node.lineno} imports from {node.module}")

    return found


def test_the_web_surface_never_writes_to_disk() -> None:
    """The rule that matters most: this surface owns the high-write data."""
    offenders = [
        offender
        for path in _python_files()
        if "web" in path.relative_to(APP).parts
        for offender in _offenders(path)
    ]
    assert not offenders, (
        "the web surface writes to the local filesystem, which is lost on deploy and "
        "invisible to other workers. Use app.web.store (Firestore) for documents or "
        "app.web.services.storage (Firebase Storage) for binary objects:\n  "
        + "\n  ".join(offenders)
    )


def test_the_common_surface_never_writes_to_disk() -> None:
    """Same rule, same reasons — and this half serves the mobile app."""
    offenders = [
        offender
        for path in _python_files()
        if "web" not in path.relative_to(APP).parts
        for offender in _offenders(path)
    ]
    assert not offenders, (
        "the service writes to the local filesystem:\n  " + "\n  ".join(offenders)
    )


def test_the_web_store_knows_the_high_write_collections() -> None:
    """A sanity check that the durable things really are collections.

    If a future change moves sessions or reports out of the store, the write path has
    gone somewhere — and the only somewhere left is disk or memory.
    """
    from app.web.store import PREFIX, WebStore

    store = WebStore(client=object())
    for name in ("sessions", "reports", "voice_jobs", "leads", "settings"):
        collection = getattr(store, name, None)
        assert collection is not None, name
        # `reports` is the shared collection now, not `web_reports` — both clients
        # display reports, so a web-only store made the mobile app unable to show one
        # for an interview taken in a browser. What this test actually cares about is
        # unchanged: it is a Firestore collection, so the write path is not disk.
        if name != "reports":
            assert collection.name.startswith(PREFIX), name
