"""Cross-platform run queue management for the AI Insights Orchestrator.

Provides two functions called by cli.py to self-register and self-unregister
the current orchestrator process in the shared queue file.

Queue file
----------
``orchestrator/logs/.run-queue.json`` — a JSON array of queue entries.  Each
entry has the shape::

    {
        "id":           "<uuid4>",
        "pid":          12345,
        "planPath":     "/abs/path/to/plan.md",
        "expectedSlug": "2026-05-05-feature",
        "expectedRepo": "my-repo",
        "startedAt":    "2026-05-05T10:00:00.000000+00:00",
        "status":       "pending"
    }

``expectedRepo`` is the repository name derived from the plan directory path
(``plan_dir.parents[3].name``).  It is ``None`` for legacy queue entries
produced by older orchestrator versions that did not include this field.

Lock file
---------
``orchestrator/logs/.run-queue.lock`` — exclusive file lock acquired before
every read/write operation so that two processes starting simultaneously do
not race on the shared queue file.

Atomic writes
-------------
The queue file is written to a ``.tmp`` sibling and renamed into place so
that no partial content is ever visible to readers.
"""
from __future__ import annotations

import json
import os
import uuid
from pathlib import Path

from src.utils.filelock import lock_exclusive, unlock

# ---------------------------------------------------------------------------
# Paths (resolved from this file's location)
# ---------------------------------------------------------------------------

# utils/run_queue.py → utils/ → src/ → orchestrator/ → logs/
_LOGS_DIR: Path = Path(__file__).resolve().parent.parent.parent / "logs"
QUEUE_FILE: Path = _LOGS_DIR / ".run-queue.json"
_LOCK_FILE: Path = _LOGS_DIR / ".run-queue.lock"


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def register(
    pid: int,
    plan_path: str,
    slug: str,
    started_at: str,
    repo_name: str | None = None,
) -> str:
    """Append a new entry to the run queue and return its UUID.

    Creates the queue file (and the logs directory) if either does not exist.
    Acquires an exclusive lock on the lock file before reading or writing.

    Parameters
    ----------
    pid:
        OS process ID of the current orchestrator process.
    plan_path:
        Absolute path to the plan ``.md`` file (or directory) being executed.
    slug:
        The plan directory's base name (used as ``expectedSlug`` for GUI
        lifecycle tracking and log file look-ups).
    started_at:
        ISO 8601 timestamp string captured at run start (``run_start_ts``).
    repo_name:
        Repository name derived from ``plan_dir.parents[3].name``.  Written as
        ``expectedRepo`` in the queue entry.  The GUI uses this value together
        with ``expectedSlug`` to build namespaced project links of the form
        ``#/projects/{repo_name}/{slug}`` — for example,
        ``#/projects/my-repo/2026-05-05-feature``.  Without ``expectedRepo``
        the GUI cannot route to the correct project in a multi-root workspace.
        Pass ``None`` (or omit) when the repo name cannot be determined; the
        field is written as ``null`` in that case so consumers can detect legacy
        entries and fall back gracefully (e.g. flat link or no project link).

    Returns
    -------
    str
        The UUID v4 assigned to the new queue entry.
    """
    _LOGS_DIR.mkdir(parents=True, exist_ok=True)

    # Normalise empty string to None so consumers always see str | None, never "".
    repo_name = repo_name or None

    entry_id = str(uuid.uuid4())
    entry: dict = {
        "id": entry_id,
        "pid": pid,
        "planPath": plan_path,
        "expectedSlug": slug,
        "expectedRepo": repo_name,
        "startedAt": started_at,
        "status": "pending",
    }

    lock_fd = os.open(str(_LOCK_FILE), os.O_CREAT | os.O_WRONLY)
    try:
        lock_exclusive(lock_fd)
        entries = _read_queue()
        entries.append(entry)
        _write_queue(entries)
    finally:
        unlock(lock_fd)
        os.close(lock_fd)

    return entry_id


def unregister(entry_id: str) -> None:
    """Remove the queue entry with the given ID.

    Silent no-op when the queue file does not exist or the entry is not found.
    Acquires an exclusive lock before reading or writing.

    Parameters
    ----------
    entry_id:
        The UUID returned by a previous :func:`register` call.
    """
    if not QUEUE_FILE.exists():
        return

    lock_fd = os.open(str(_LOCK_FILE), os.O_CREAT | os.O_WRONLY)
    try:
        lock_exclusive(lock_fd)
        entries = _read_queue()
        filtered = [e for e in entries if e.get("id") != entry_id]
        if len(filtered) == len(entries):
            # Entry not found — no-op, but still release lock cleanly.
            return
        _write_queue(filtered)
    finally:
        unlock(lock_fd)
        os.close(lock_fd)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _read_queue() -> list[dict]:
    """Read and parse the queue file.  Returns ``[]`` on missing or corrupt file."""
    if not QUEUE_FILE.exists():
        return []
    try:
        text = QUEUE_FILE.read_text(encoding="utf-8")
        data = json.loads(text)
        if isinstance(data, list):
            return data
    except (OSError, json.JSONDecodeError):
        pass
    return []


def _write_queue(entries: list[dict]) -> None:
    """Write *entries* to the queue file atomically (write-to-tmp + rename)."""
    tmp_path = QUEUE_FILE.with_suffix(".json.tmp")
    payload = json.dumps(entries, indent=2, ensure_ascii=False)
    tmp_path.write_text(payload, encoding="utf-8")
    tmp_path.replace(QUEUE_FILE)
