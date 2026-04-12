# Orchestrator - Utilities
_SOURCE: Utility modules: tool wrappers, persona loader, plan parser, JSONL logger_
# Utility modules: tool wrappers, persona loader, plan parser, JSONL logger
```
// Structure of documents
└── orchestrator/
    └── src/
        └── utils/
            └── __init__.py
            └── chunk_writer.py
            └── dialogue_writer.py
            └── filelock.py
            └── logging.py
            └── mcp_parse.py
            └── persona.py
            └── persona_models.py
            └── plan_parser.py
            └── subagents.py
            └── subprocess_encoding.py
            └── tool_wrappers.py

```
###  Path: `/orchestrator/src/utils/__init__.py`

```py
"""
utils — shared helper utilities.
"""

```
###  Path: `/orchestrator/src/utils/chunk_writer.py`

```py
"""
chunk_writer.py — Utility class for writing raw LangGraph stream chunks to JSONL files.

Public API
----------
ChunkWriter(slug_dir, wp_id, stage)
    Opens (or creates) a JSONL file at
    ``{slug_dir}/orchestrator/chunks/{wp_id}-{stage}-r{N}.jsonl``,
    writing a version-header line as the very first entry.

    Revision numbering mirrors :func:`~src.utils.dialogue_writer.write_dialogue`:
    glob ``{wp_id}-{stage}-r*.jsonl`` and take ``max(revisions) + 1`` (or 0
    when no prior files exist).

Usage::

    from pathlib import Path
    from src.utils.chunk_writer import ChunkWriter

    with ChunkWriter(slug_dir=Path("/storage/my-project"), wp_id="WP-001", stage="developer") as cw:
        for chunk in stream:
            cw.write_chunk(chunk)

    # path property exposes the file that was written
    print(cw.path)

JSONL file layout
-----------------
Line 0 (header)::

    {"chunk_format": 1, "stream_mode": "messages", "langgraph_stream_version": "v2"}

Lines 1-N (chunks)::

    {"type": "ai", "content": "…", …}

.. note:: Cross-language coupling
    The subdirectory path ``orchestrator/chunks`` is intentionally parallel to
    ``orchestrator/dialogues`` used by :func:`~src.utils.dialogue_writer.write_dialogue`.
    If the root path ever changes both modules must be updated together.

.. warning:: _CHUNK_HEADER is a private implementation detail
    ``_CHUNK_HEADER`` is a module-level mutable dict.  Do **not** mutate it
    from outside this module — external mutation silently corrupts the header
    line written to every subsequently opened chunk file.  It is exposed at
    the module level solely so that tests can assert on its contents.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from types import MappingProxyType
from typing import IO, Any

from src.utils._revision import next_revision

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Header written as the first line of every chunk file
# ---------------------------------------------------------------------------

# DO NOT MUTATE — this mapping is a module-level singleton shared across all
# ChunkWriter instances.  It is wrapped in MappingProxyType to enforce
# immutability at runtime.  External mutation would silently corrupt the header
# line of every subsequently opened chunk file.  If you need a different
# header, subclass ChunkWriter or construct the dict locally.
_CHUNK_HEADER: MappingProxyType[str, Any] = MappingProxyType({
    "chunk_format": 1,
    "stream_mode": "messages",
    "langgraph_stream_version": "v2",
})


# ---------------------------------------------------------------------------
# ChunkWriter
# ---------------------------------------------------------------------------


class ChunkWriter:
    """Write raw LangGraph stream chunks to a JSONL file with immediate flush.

    Parameters
    ----------
    slug_dir:
        Root directory for the project's ledger storage
        (e.g. ``{workspace_root}/mcp-server/storage/ledger/{slug}``).
    wp_id:
        Work-package identifier (e.g. ``"WP-001"``).
    stage:
        Pipeline stage name (e.g. ``"developer"``).

    Raises
    ------
    OSError
        If the chunks directory cannot be created or the file cannot be
        opened.  Errors during :meth:`write_chunk` are **not** raised —
        they are logged at ``DEBUG`` and silently swallowed.
    """

    def __init__(self, slug_dir: Path, wp_id: str, stage: str) -> None:
        self._slug_dir = Path(slug_dir)
        self._wp_id = wp_id
        self._stage = stage
        self._closed: bool = False
        self._fh: IO[str] | None = None

        chunks_dir = self._slug_dir / "orchestrator" / "chunks"
        chunks_dir.mkdir(parents=True, exist_ok=True)

        revision = next_revision(chunks_dir, wp_id, stage, ".jsonl")
        filename = f"{wp_id}-{stage}-r{revision}.jsonl"
        dest = chunks_dir / filename
        self._path: Path = dest

        self._fh = dest.open("w", encoding="utf-8")
        # Write the version header as the first line.
        # dict() conversion is needed because json.dumps does not natively
        # serialise MappingProxyType.
        self._fh.write(json.dumps(dict(_CHUNK_HEADER), ensure_ascii=False) + "\n")
        self._fh.flush()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    @property
    def path(self) -> Path:
        """Absolute path to the JSONL file being written."""
        return self._path

    def write_chunk(self, chunk: dict[str, Any]) -> None:
        """Append *chunk* as a JSON line and flush immediately.

        If a file I/O error or JSON serialisation error occurs, the exception
        is logged at ``DEBUG`` level and silently swallowed — the caller is
        never interrupted.

        Both :class:`OSError` (file I/O failures) and :class:`TypeError`
        (non-serialisable values such as ``set``, custom objects, ``bytes``)
        are caught and suppressed.

        Parameters
        ----------
        chunk:
            A dict representing a single LangGraph stream chunk.  All
            values should be JSON-serialisable; non-serialisable values
            are silently skipped.
        """
        if self._closed or self._fh is None:
            return
        try:
            self._fh.write(json.dumps(chunk, ensure_ascii=False) + "\n")
            self._fh.flush()
        except (OSError, TypeError) as exc:
            log.debug(
                "ChunkWriter.write_chunk: error writing to %s — %s",
                self._path,
                exc,
            )

    def close(self) -> None:
        """Close the underlying file handle.

        This method is idempotent — calling it more than once is safe and
        will not raise.
        """
        if self._closed:
            return
        self._closed = True
        if self._fh is not None:
            try:
                self._fh.close()
            except OSError as exc:
                log.debug("ChunkWriter.close: error closing %s — %s", self._path, exc)
            finally:
                self._fh = None

    # ------------------------------------------------------------------
    # Context manager protocol
    # ------------------------------------------------------------------

    def __enter__(self) -> ChunkWriter:
        return self

    def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        self.close()

```
###  Path: `/orchestrator/src/utils/dialogue_writer.py`

```py
"""
dialogue_writer.py — Utilities for serialising agent dialogues to Markdown files.

.. note::
   **Manual-use only.**  This module is retained for scripted/manual inspection
   of agent message histories.  As of the streaming-dialogue rework (rework-1,
   2026-04-10) the automated pipeline no longer calls ``write_dialogue()``;
   chunk JSONL files produced by
   :class:`~src.utils.chunk_writer.ChunkWriter` are the sole durable output
   from each stage run.

Public API
----------
serialize_messages_to_markdown(messages, stage, wp_id, timestamp) -> str
    Convert a LangChain message list to a human-readable Markdown document.

write_dialogue(content, slug_dir, wp_id, stage) -> Path
    Persist *content* to ``{slug_dir}/orchestrator/dialogues/{wp_id}-{stage}-r{N}.md``,
    auto-incrementing the revision number *N* when prior revisions exist.

Supported message roles
-----------------------
The following LangChain message types are recognised by ``_msg_role()``:

* ``HumanMessage`` (``type="human"``) → **Human**
* ``AIMessage`` (``type="ai"``) → **Assistant**
* ``ToolMessage`` (``type="tool"``) → **Tool Result**
* ``SystemMessage`` (``type="system"``) → **System**
* Any other type falls back to a capitalised form of the type name.
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from src.utils._revision import next_revision

# ---------------------------------------------------------------------------
# Message serialisation
# ---------------------------------------------------------------------------

def _msg_role(message: Any) -> str:
    """Return the canonical role string for *message*."""
    # LangChain message objects expose a ``type`` attribute (``"human"``,
    # ``"ai"``, ``"tool"``, etc.).  We fall back to class-name sniffing for
    # objects that only quack like messages.
    msg_type = getattr(message, "type", None) or type(message).__name__.lower()
    if msg_type in ("human", "humanmessage"):
        return "Human"
    if msg_type in ("ai", "aimessage"):
        return "Assistant"
    if msg_type in ("tool", "toolmessage"):
        return "Tool Result"
    if msg_type in ("system", "systemmessage"):
        return "System"
    return msg_type.replace("message", "").capitalize() or "Message"


def _render_content(content: Any) -> str:
    """Return *content* as a plain string suitable for Markdown body text.

    LangChain's Anthropic and OpenAI adapters can return ``AIMessage.content``
    as a **list of content blocks** rather than a plain string.  Each block is
    a dict with a ``"type"`` key (e.g. ``{"type": "text", "text": "…"}`` or
    ``{"type": "tool_use", …}``).  Only ``"text"`` blocks are rendered as plain
    text; all other block types (``"tool_use"``, ``"image"``, etc.) are
    serialised as compact JSON fences so no information is silently lost.

    Empty-string parts produced by content blocks are intentionally discarded
    (they would produce blank ``\\n\\n`` gaps in the Markdown output).
    """
    if isinstance(content, str):
        return content
    # Anthropic / OpenAI provider adapters may return a list of content blocks.
    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict):
                btype = block.get("type", "")
                if btype == "text":
                    parts.append(block.get("text", ""))
                else:
                    # Non-text blocks (tool_use, image, …) rendered as JSON.
                    parts.append(f"```json\n{json.dumps(block, indent=2)}\n```")
            else:
                parts.append(str(block))
        return "\n\n".join(p for p in parts if p)
    return str(content) if content is not None else ""


def _render_tool_calls(tool_calls: list[dict[str, Any]]) -> str:
    """Render *tool_calls* as fenced Markdown code blocks."""
    blocks: list[str] = []
    for tc in tool_calls:
        name = tc.get("name", "unknown_tool")
        args = tc.get("args", {})
        tc_id = tc.get("id", "")
        header = f"**Tool call:** `{name}`" + (f" (id: `{tc_id}`)" if tc_id else "")
        body = f"```json\n{json.dumps(args, indent=2)}\n```"
        blocks.append(f"{header}\n\n{body}")
    return "\n\n".join(blocks)


def _collect_usage(messages: Sequence[Any]) -> dict[str, int] | None:
    """
    Aggregate ``usage_metadata`` from all messages in *messages*.

    Returns a merged dict or ``None`` when no usage data is present.
    """
    totals: dict[str, int] = {}
    for msg in messages:
        meta = getattr(msg, "usage_metadata", None)
        if meta and isinstance(meta, dict):
            for key, value in meta.items():
                if isinstance(value, (int, float)):
                    totals[key] = totals.get(key, 0) + int(value)
    return totals if totals else None


def serialize_messages_to_markdown(
    messages: Sequence[Any],
    stage: str,
    wp_id: str,
    timestamp: str | None = None,
) -> str:
    """
    Serialise *messages* to a Markdown string.

    Parameters
    ----------
    messages:
        Sequence of LangChain message objects (HumanMessage, AIMessage,
        ToolMessage, …) or any objects with a ``type`` attribute.
    stage:
        Pipeline stage name (e.g. ``"developer"``).
    wp_id:
        Work-package identifier (e.g. ``"WP-001"``).
    timestamp:
        ISO 8601 timestamp string.  Defaults to the current UTC time when
        ``None``.

    Returns
    -------
    str
        A Markdown document with a header, per-message sections, and an
        optional token-usage footer.
    """
    if timestamp is None:
        timestamp = datetime.now(UTC).isoformat(timespec="seconds")

    lines: list[str] = [
        f"# Dialogue — {stage} / {wp_id}",
        "",
        "| Field | Value |",
        "| ----- | ----- |",
        f"| Stage | `{stage}` |",
        f"| WP ID | `{wp_id}` |",
        f"| Captured | {timestamp} |",
        "",
    ]

    if not messages:
        lines.append("*No messages recorded.*")
        return "\n".join(lines) + "\n"

    for idx, msg in enumerate(messages, start=1):
        role = _msg_role(msg)
        lines.append(f"## {role}")
        lines.append("")

        # Render tool calls for AI messages first.
        tool_calls: list[dict[str, Any]] = getattr(msg, "tool_calls", None) or []
        content_str = _render_content(getattr(msg, "content", ""))

        if content_str:
            lines.append(content_str)
            lines.append("")

        if tool_calls:
            lines.append(_render_tool_calls(tool_calls))
            lines.append("")

    # Token-usage footer.
    usage = _collect_usage(messages)
    if usage:
        lines.append("---")
        lines.append("")
        lines.append("## Token Usage")
        lines.append("")
        lines.append("| Metric | Count |")
        lines.append("| ------ | ----- |")
        for key, value in sorted(usage.items()):
            lines.append(f"| {key.replace('_', ' ').title()} | {value} |")
        lines.append("")

    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------------------
# File persistence
# ---------------------------------------------------------------------------

def write_dialogue(
    content: str,
    slug_dir: Path,
    wp_id: str,
    stage: str,
) -> Path:
    """
    Write *content* to ``{slug_dir}/orchestrator/dialogues/{wp_id}-{stage}-r{N}.md``.

    The revision number *N* is determined by globbing existing
    ``{wp_id}-{stage}-r*.md`` files inside ``{slug_dir}/orchestrator/dialogues/``.
    The first call writes ``r0``; subsequent calls for the same
    ``wp_id``/``stage`` pair increment the revision.

    .. note:: Cross-language coupling
        The subdirectory path ``orchestrator/dialogues`` is intentionally kept
        in sync with the MCP server's ``DIALOGUES_DIR`` constant defined in
        ``mcp-server/src/utils/constants.ts``.  If this value ever needs to
        change, both files must be updated together.

    Parameters
    ----------
    content:
        Markdown string to write.
    slug_dir:
        Root directory for the project's ledger storage
        (e.g. ``{workspace_root}/mcp-server/storage/ledger/{slug}``).
    wp_id:
        Work-package identifier (e.g. ``"WP-001"``).
    stage:
        Pipeline stage name (e.g. ``"developer"``).

    Returns
    -------
    Path
        Absolute path to the file that was written.
    """
    dialogues_dir = slug_dir / "orchestrator" / "dialogues"
    dialogues_dir.mkdir(parents=True, exist_ok=True)

    # Determine next revision number.
    revision = next_revision(dialogues_dir, wp_id, stage, ".md")

    filename = f"{wp_id}-{stage}-r{revision}.md"
    dest = dialogues_dir / filename
    dest.write_text(content, encoding="utf-8")
    return dest

```
###  Path: `/orchestrator/src/utils/filelock.py`

```py
"""Cross-platform file locking (Unix fcntl / Windows msvcrt)."""
from __future__ import annotations

import sys

if sys.platform == "win32":
    import msvcrt

    def lock_exclusive(fd: int) -> None:
        """Acquire a non-blocking exclusive lock. Raises OSError on contention.

        Windows note: ``msvcrt.locking`` locks 1 byte at the *current file
        pointer position*.  The caller must ensure the file pointer stays at 0
        (e.g. open the lock file in ``'w'`` mode and never write to it) so that
        the locked byte is identical for every acquire/release cycle.

        Not re-entrant: calling this twice on the same fd without an intervening
        ``unlock`` raises ``OSError`` (EACCES / errno 13).
        """
        msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)

    def unlock(fd: int) -> None:
        """Release the lock. Silently swallows ``OSError`` if the fd is not locked."""
        try:
            msvcrt.locking(fd, msvcrt.LK_UNLCK, 1)
        except OSError:
            pass

else:
    import fcntl

    def lock_exclusive(fd: int) -> None:
        """Acquire a non-blocking exclusive lock. Raises OSError on contention."""
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)

    def unlock(fd: int) -> None:
        """Release the lock. Silently swallows ``OSError`` if the fd is not locked."""
        try:
            fcntl.flock(fd, fcntl.LOCK_UN)
        except OSError:
            pass

```
###  Path: `/orchestrator/src/utils/logging.py`

```py
"""
utils/logging.py — Structured logging for the AI Insights Orchestrator.

Provides :class:`WorkflowLogger` which writes:

- **JSONL file log** — one JSON object per line to
  ``orchestrator/logs/{timestamp}-{slug}.jsonl``.  The directory is created
  automatically.
- **Human-readable console log** — progress messages to stderr via the
  standard Python :mod:`logging` module.

Each JSONL entry has the schema::

    {
        "timestamp": "2026-02-25T08:00:00.000000+00:00",
        "stage": "developer",
        "wp_id": "WP-003",
        "action": "start_pipeline",
        "result": "PASS",
        "tokens_used": 1234
    }

Additional keyword arguments passed to :meth:`WorkflowLogger.log` are
included in the JSONL entry verbatim.

Usage::

    with WorkflowLogger.create(label="my-project") as logger:
        logger.log(stage="developer", wp_id="WP-003", action="claim_wp")
        logger.log(stage="developer", wp_id="WP-003", action="complete",
                   result="PASS", tokens_used=850)
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import sys
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Console logging configuration
# ---------------------------------------------------------------------------

def configure_console_logging(log_level: str = "INFO") -> None:
    """
    Configure the root logger to emit human-readable messages to stderr.

    This function is idempotent — calling it more than once will not add
    duplicate handlers.  It should be called once at application startup
    (e.g. in :mod:`src.cli`).

    Parameters
    ----------
    log_level:
        Standard Python logging level string (``"DEBUG"``, ``"INFO"``,
        ``"WARNING"``, ``"ERROR"``, ``"CRITICAL"``).
    """
    root = logging.getLogger()
    # Avoid adding a duplicate stderr handler.
    if any(
        isinstance(h, logging.StreamHandler) and h.stream is sys.stderr
        for h in root.handlers
    ):
        return

    handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(
        logging.Formatter(
            fmt="%(asctime)s [%(levelname)-8s] %(name)s  %(message)s",
            datefmt="%H:%M:%S",
        )
    )
    root.setLevel(log_level)
    root.addHandler(handler)


# ---------------------------------------------------------------------------
# JSONL WorkflowLogger
# ---------------------------------------------------------------------------

_SLUG_RE = re.compile(r"[^a-z0-9]+")


def _slugify(text: str, max_len: int = 80) -> str:
    """Convert *text* to a filesystem-safe lowercase slug, capped at *max_len*."""
    # Strip hyphens AFTER truncation so a hyphen landing exactly at max_len
    # does not produce a filename ending with '-'.
    return _SLUG_RE.sub("-", text.lower())[:max_len].strip("-")


def _format_duration(seconds: float | None) -> str:
    """Format *seconds* as a human-readable duration string.

    Examples::

        _format_duration(None)   == ""
        _format_duration(0)      == "0s"
        _format_duration(45)     == "45s"
        _format_duration(204)    == "3m 24s"
        _format_duration(4320)   == "1h 12m"
    """
    if seconds is None:
        return ""
    secs = round(seconds)
    if secs < 60:
        return f"{secs}s"
    minutes, remaining_secs = divmod(secs, 60)
    if minutes < 60:
        return f"{minutes}m {remaining_secs}s"
    hours, remaining_mins = divmod(minutes, 60)
    return f"{hours}h {remaining_mins}m"


def _build_stream_console_line(entry: dict[str, Any]) -> str:
    """Build a human-readable console line for a streamed log entry.

    Produces rich, structured output for the event types introduced in
    WP-002 and WP-003.  Falls back to the generic ``action → result``
    format for all other event types so that existing output is unchanged.
    """
    stage = entry.get("stage") or ""
    wp_id = entry.get("wp_id") or ""
    action = entry.get("action") or ""
    prefix = f"[{stage}]" if stage else "[—]"

    if action == "stage_start":
        parts = [prefix]
        if wp_id:
            parts.append(wp_id)
        parts.append("▶ stage_start")
        model = entry.get("model") or ""
        if model:
            parts.append(f"[{model}]")
        return " ".join(parts)

    if action == "stage_complete":
        result = entry.get("result") or ""
        duration = _format_duration(entry.get("duration_s"))
        tokens = entry.get("tokens_used")
        parts = [prefix]
        if wp_id:
            parts.append(wp_id)
        parts.append("stage_complete")
        if result:
            parts.append(f"→ {result}")
        detail: list[str] = []
        if duration:
            detail.append(duration)
        if tokens is not None:
            detail.append(f"{tokens} tokens")
        if detail:
            parts.append(f"({', '.join(detail)})")
        return " ".join(parts)

    if action == "wp_status_change":
        old_st = entry.get("old_status") or ""
        new_st = entry.get("new_status") or ""
        parts = [prefix]
        if wp_id:
            parts.append(wp_id)
        parts.append(f"status: {old_st} → {new_st}")
        return " ".join(parts)

    if action == "wp_complete":
        parts = [prefix, "✓"]
        if wp_id:
            parts.append(wp_id)
        parts.append("COMPLETE")
        return " ".join(parts)

    if action == "progress_snapshot":
        total = entry.get("total_wps") or 0
        breakdown: dict[str, int] = entry.get("status_breakdown") or {}
        completed = breakdown.get("COMPLETE", 0)
        in_progress = breakdown.get("IN_PROGRESS", 0)
        iteration = entry.get("iteration") or 0
        max_iter = entry.get("max_iterations") or 0
        elapsed = _format_duration(entry.get("elapsed_s"))
        line = f"{prefix} Progress: {completed}/{total} WPs done"
        if in_progress:
            line += f" · {in_progress} in-progress"
        if max_iter:
            line += f" · iter {iteration}/{max_iter}"
        if elapsed:
            line += f" · {elapsed} elapsed"
        return line

    if action == "pipeline_result":
        pipeline_status = entry.get("pipeline_status") or entry.get("result") or ""
        files: list = entry.get("files_modified") or []
        duration = _format_duration(entry.get("duration_s"))
        parts = [prefix]
        if wp_id:
            parts.append(wp_id)
        detail_parts: list[str] = []
        if pipeline_status:
            detail_parts.append(pipeline_status)
        if files:
            detail_parts.append(f"{len(files)} files modified")
        if duration:
            detail_parts.append(duration)
        detail_str = " · ".join(detail_parts) if detail_parts else "pipeline_result"
        parts.append(f"pipeline: {detail_str}")
        return " ".join(parts)

    if action == "dialogue_captured":
        file_path = entry.get("file_path") or ""
        filename = file_path.split("/")[-1] if file_path else ""
        parts = [prefix]
        if wp_id:
            parts.append(wp_id)
        parts.append(f"dialogue saved → {filename}" if filename else "dialogue saved")
        return " ".join(parts)

    if action == "heartbeat":
        silence = _format_duration(entry.get("silence_s"))
        line = f"{prefix} ♥ alive"
        if silence:
            line += f" (quiet for {silence})"
        return line

    if action == "rework_detected":
        rework_count = entry.get("rework_count")
        pipeline_type = entry.get("pipeline_type") or ""
        agent_role = entry.get("agent_role") or ""
        agent_stage = agent_role.lower().replace(" ", "_")
        parts = [prefix, "⟳"]
        if wp_id:
            parts.append(wp_id)
        rework_label = f"rework #{rework_count}" if rework_count is not None else "rework"
        if pipeline_type and agent_stage:
            rework_label += f" ({pipeline_type} → {agent_stage})"
        parts.append(rework_label)
        return " ".join(parts)

    if action == "tool_call":
        tool_name = entry.get("tool_name") or ""
        tool_wp_id = entry.get("tool_wp_id") or ""
        parts = [prefix]
        if wp_id:
            parts.append(wp_id)
        parts.append(f"🔧 {tool_name}" if tool_name else "🔧")
        if tool_wp_id:
            parts.append(f"({tool_wp_id})")
        return " ".join(parts)

    # ── Default fallback (preserves existing behavior for all other events) ──
    result = entry.get("result") or ""
    tokens = entry.get("tokens_used")
    parts = [prefix]
    if wp_id:
        parts.append(wp_id)
    parts.append(action)
    if result:
        parts.append(f"→ {result}")
    if tokens is not None:
        parts.append(f"({tokens} tokens)")
    return " ".join(parts)


class WorkflowLogger:
    """
    Structured JSONL logger for a single orchestrator run.

    Instantiate via the :meth:`create` factory method rather than calling the
    constructor directly.

    Parameters
    ----------
    log_path:
        Absolute path to the ``.jsonl`` log file.  Parent directories are
        created automatically.
    """

    def __init__(self, log_path: Path) -> None:
        log_path.parent.mkdir(parents=True, exist_ok=True)
        self._path = log_path
        self._fh = log_path.open("a", encoding="utf-8")
        self._closed = False
        self._console = logging.getLogger("workflow")
        self._last_emit: float = time.monotonic()
        self._heartbeat_task: asyncio.Task[None] | None = None
        self._streamed_count: int = 0  # entries written via stream_entry

    # ------------------------------------------------------------------
    # Factory
    # ------------------------------------------------------------------

    @classmethod
    def create(
        cls,
        *,
        logs_dir: Path | str | None = None,
        label: str = "run",
    ) -> WorkflowLogger:
        """
        Create a new :class:`WorkflowLogger` with an auto-timestamped file name.

        The file name format is ``{timestamp}-{slug}.jsonl``, where
        *timestamp* is a UTC ISO-8601 compact string (``20260225T080000``) and
        *slug* is derived from *label*.

        Parameters
        ----------
        logs_dir:
            Directory for the JSONL file.  Defaults to
            ``orchestrator/logs/`` (inferred from this module's location).
        label:
            Short label embedded in the file name (e.g. the plan slug).

        Returns
        -------
        WorkflowLogger
            Ready to use.
        """
        if logs_dir is None:
            # utils/logging.py → utils/ → src/ → orchestrator/ → logs/
            logs_dir = Path(__file__).resolve().parent.parent.parent / "logs"

        logs_dir = Path(logs_dir)
        timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%S")
        slug = _slugify(label)
        file_name = f"{timestamp}-{slug}.jsonl"
        return cls(logs_dir / file_name)

    # ------------------------------------------------------------------
    # Logging API
    # ------------------------------------------------------------------

    def log(
        self,
        *,
        stage: str = "",
        wp_id: str = "",
        action: str,
        result: str = "",
        tokens_used: int | None = None,
        **extra: Any,
    ) -> None:
        """
        Write a structured log entry to the JSONL file and emit a
        human-readable line via the Python :mod:`logging` module.

        Parameters
        ----------
        stage:
            Current graph stage (e.g. ``"developer"``).
        wp_id:
            Current work-package ID (e.g. ``"WP-003"``).
        action:
            Short description of the action (e.g. ``"start_pipeline"``).
        result:
            Outcome string (e.g. ``"PASS"``, ``"FAIL"``, ``"ERROR"``).
        tokens_used:
            Token count for the associated LLM call, if available.
        **extra:
            Additional key/value pairs included verbatim in the JSONL entry.
        """
        entry: dict[str, Any] = {
            "timestamp": datetime.now(UTC).isoformat(),
            "stage": stage,
            "wp_id": wp_id,
            "action": action,
            "result": result,
            "tokens_used": tokens_used,
        }
        entry.update(extra)

        # --- JSONL output ---
        self._fh.write(json.dumps(entry, ensure_ascii=False) + "\n")
        self._fh.flush()

        self._last_emit = time.monotonic()

        # --- Human-readable console output ---
        parts = [f"[{stage}]" if stage else "[—]"]
        if wp_id:
            parts.append(wp_id)
        parts.append(action)
        if result:
            parts.append(f"→ {result}")
        if tokens_used is not None:
            parts.append(f"({tokens_used} tokens)")
        self._console.info(" ".join(parts))

    # ------------------------------------------------------------------
    # Streaming helper — write a pre-built log-entry dict immediately
    # ------------------------------------------------------------------

    def stream_entry(self, entry: dict[str, Any]) -> None:
        """
        Write a pre-built log-entry dict to the JSONL file immediately.

        This is used by graph nodes that build their own log-entry dicts
        (for LangGraph state ``run_log``) and also want them persisted to
        the JSONL file in real time — before the graph finishes.

        Parameters
        ----------
        entry:
            A dict matching the JSONL schema (must contain at least
            ``"action"``).  A ``"timestamp"`` is added if missing.
        """
        if "timestamp" not in entry:
            entry["timestamp"] = datetime.now(UTC).isoformat()
        self._fh.write(json.dumps(entry, ensure_ascii=False) + "\n")
        self._fh.flush()

        self._last_emit = time.monotonic()
        self._streamed_count += 1

        # Also emit a console line so stderr stays in sync.
        self._console.info(_build_stream_console_line(entry))

    def flush_unstreamed(self, run_log: list[dict[str, Any]]) -> None:
        """Write any *run_log* entries that were NOT already streamed.

        Graph nodes accumulate log entries in the LangGraph state
        ``run_log`` list.  Ideally every entry is also streamed in real
        time via :meth:`stream_entry`.  When that path is unavailable
        (e.g. the ``run_logger`` was not reachable inside graph nodes),
        calling this method after the graph completes ensures the JSONL
        file still contains every event.

        Entries already written via :meth:`stream_entry` are skipped by
        comparing the count of streamed entries against the total
        ``run_log`` length — works because ``run_log`` is append-only
        (LangGraph ``operator.add`` reducer) and entries are streamed in
        order.

        Parameters
        ----------
        run_log:
            The ``run_log`` list from the final LangGraph state.
        """
        if not run_log:
            return
        unstreamed = run_log[self._streamed_count:]
        if not unstreamed:
            return
        log.info(
            "Flushing %d un-streamed run_log entries to JSONL.", len(unstreamed)
        )
        for entry in unstreamed:
            self.stream_entry(entry)

    # ------------------------------------------------------------------
    # Heartbeat — periodic "I'm alive" console + JSONL message
    # ------------------------------------------------------------------

    async def start_heartbeat(self, interval_s: int = 120) -> None:
        """Start a background task that emits a heartbeat if no other
        log line has been written within *interval_s* seconds.

        Parameters
        ----------
        interval_s:
            Minimum quiet period (in seconds) before a heartbeat fires.
            Set to ``0`` to disable heartbeat entirely.
        """
        if interval_s <= 0:
            return
        self._heartbeat_task = asyncio.create_task(
            self._heartbeat_loop(interval_s),
        )

    async def stop_heartbeat(self) -> None:
        """Cancel the heartbeat background task, if running."""
        task = self._heartbeat_task
        if task is None or task.done():
            return
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
        self._heartbeat_task = None

    async def _heartbeat_loop(self, interval_s: int) -> None:
        """Internal loop: sleep, check last-emit, emit if quiet."""
        try:
            while not self._closed:
                await asyncio.sleep(interval_s)
                if self._closed:
                    break
                silence = time.monotonic() - self._last_emit
                if silence >= interval_s:
                    self.stream_entry({
                        "stage": "heartbeat",
                        "action": "heartbeat",
                        "level": "INFO",
                        "silence_s": round(silence, 1),
                    })
        except asyncio.CancelledError:
            return

    # ------------------------------------------------------------------
    # Resource management
    # ------------------------------------------------------------------

    def close(self) -> None:
        """Flush and close the underlying JSONL file handle."""
        if self._closed:
            return
        self._closed = True
        try:
            self._fh.flush()
            self._fh.close()
        except OSError:
            pass

    def __enter__(self) -> WorkflowLogger:
        return self

    def __exit__(self, *_: Any) -> None:
        self.close()

    def __del__(self) -> None:
        # Best-effort cleanup if close() was not called explicitly.
        self.close()


# ---------------------------------------------------------------------------
# LangGraph config helper
# ---------------------------------------------------------------------------

def get_run_logger(config: Any) -> WorkflowLogger | None:
    """
    Extract the :class:`WorkflowLogger` from a LangGraph ``RunnableConfig``.

    Returns ``None`` if the config is missing or does not contain a logger,
    so callers can safely do ``if logger: logger.stream_entry(entry)``.

    Parameters
    ----------
    config:
        The LangGraph ``RunnableConfig`` dict passed to node functions.
    """
    if config is None:
        log.debug("get_run_logger: config is None")
        return None
    configurable = config.get("configurable") or {}
    logger = configurable.get("run_logger")
    if logger is None:
        log.warning(
            "get_run_logger: run_logger not found in configurable. "
            "Keys present: %s",
            sorted(configurable.keys()),
        )
    return logger

```
###  Path: `/orchestrator/src/utils/mcp_parse.py`

```py
"""
mcp_parse — Shared MCP tool response parser.

Handles the multiple response formats returned by
``langchain-mcp-adapters`` when invoking MCP tools, providing a
unified parsed output for callers.

Formats handled
---------------
- **List of content blocks** (``langchain-mcp-adapters`` 0.1.0 format):
  ``[{"type": "text", "text": "<json-string>"}]``
- **JSON string**: parsed via ``json.loads``; falls back to raw string if
  not valid JSON.
- **ToolMessage-like** (LangChain): object with a ``.content`` attribute
  is unwrapped before applying the above rules.
- **Direct dict** or any other object: returned as-is.

This logic was originally inlined in ``supervisor.py``'s ``_call_tool``.
Extracting it here allows both the supervisor and the node factory to
share the same response-parsing behaviour without duplication.
"""

from __future__ import annotations

import json
from typing import Any


def parse_tool_response(raw: Any) -> dict | list | str | None:
    """
    Parse an MCP tool response into a usable Python object.

    Parameters
    ----------
    raw:
        The raw value returned by ``tool.ainvoke()``.

    Returns
    -------
    dict | list | str | None
        - ``dict`` — successfully JSON-parsed object.
        - ``list``  — raw list when no parseable text block found.
        - ``str``   — raw string when JSON parsing fails.
        - ``None``  — when *raw* is ``None``.
    """
    if raw is None:
        return None

    # Unwrap ToolMessage-like objects (LangChain ``ToolMessage`` etc.)
    # that expose their payload via a ``.content`` attribute.
    if hasattr(raw, "content") and not isinstance(raw, (dict, list)):
        raw = raw.content

    # langchain-mcp-adapters 0.1.0 returns a list of content objects:
    # [{"type": "text", "text": "<json-string>"}]
    if isinstance(raw, list):
        for block in raw:
            if isinstance(block, dict) and block.get("type") == "text":
                text = block["text"]
                try:
                    return json.loads(text)
                except json.JSONDecodeError:
                    return text
        # No parseable text block found; return the raw list.
        return raw

    if isinstance(raw, str):
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return raw

    # Direct dict or any other object.
    return raw

```
###  Path: `/orchestrator/src/utils/persona.py`

```py
"""
utils/persona.py — Persona prompt loader.

Provides :func:`load_persona` which reads the Markdown persona file for a
given graph stage and caches the result in memory.  Paths are resolved
relative to the workspace root using the :data:`~src.config.PERSONA_FILES`
mapping from ``config.py``.

Example::

    content = load_persona("developer")
    # → full Markdown text of personas/ledger/vs-code/3-developer.md
"""

from __future__ import annotations

import logging
from pathlib import Path

log = logging.getLogger(__name__)

# Module-level in-memory cache: stage name → file content.
_CACHE: dict[str, str] = {}


def load_persona(stage: str, workspace_root: Path | str | None = None) -> str:
    """
    Return the Markdown content of the persona file for *stage*.

    Results are cached in memory for the lifetime of the process so repeated
    calls (e.g. when the same agent node handles multiple work-packages) do
    not repeatedly read the file system.

    Parameters
    ----------
    stage:
        One of the valid graph stage names: ``"pm"``, ``"developer"``,
        ``"qa"``, ``"reviewer"``, ``"docs"``, ``"synthesis"``.
    workspace_root:
        Override the workspace root path.  When ``None`` (default) the root
        is determined via :func:`~src.config.load_config`.  Pass an explicit
        path in tests to avoid requiring environment variables.

    Returns
    -------
    str
        Full Markdown content of the persona file.

    Raises
    ------
    KeyError
        If *stage* is not a recognised stage name.
    FileNotFoundError
        If the persona file does not exist on disk.
    """
    if stage in _CACHE:
        return _CACHE[stage]

    # Local import to avoid circular dependencies at module level.
    from src.config import PERSONA_FILES, load_config  # noqa: PLC0415

    if stage not in PERSONA_FILES:
        raise KeyError(
            f"Unknown stage {stage!r}. "
            f"Valid stages: {sorted(PERSONA_FILES)}"
        )

    if workspace_root is None:
        cfg = load_config()
        workspace_root = cfg.workspace_root

    relative_path = PERSONA_FILES[stage]
    full_path = Path(workspace_root) / relative_path

    if not full_path.exists():
        raise FileNotFoundError(
            f"Persona file for stage {stage!r} not found at: {full_path}"
        )

    content = full_path.read_text(encoding="utf-8")
    _CACHE[stage] = content
    log.debug("Loaded persona for stage %r (%d chars).", stage, len(content))
    return content


def clear_cache() -> None:
    """Clear the in-memory persona cache.  Useful in tests to force a re-read."""
    _CACHE.clear()

```
###  Path: `/orchestrator/src/utils/persona_models.py`

```py
"""
utils/persona_models.py — Per-stage model slug extractor.

Reads persona YAML metadata files from ``personas/ledger/src/meta/`` and
returns the API-compatible model identifier for each orchestrator stage.

Example::

    slugs = extract_persona_model_slugs(workspace_root)
    # → {"planner": "claude-opus-4-6", "developer": "claude-sonnet-4-6", ...}
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

log = logging.getLogger(__name__)

# Paths relative to workspace root.
_META_DIR_RELATIVE = Path("personas") / "ledger" / "src" / "meta"
_MANIFEST_RELATIVE = Path("shared") / "workflow-manifest.json"


# ---------------------------------------------------------------------------
# Internal YAML helpers (stdlib-only — handles only simple scalar fields)
# ---------------------------------------------------------------------------

def _strip_inline_comment(raw: str) -> str:
    """Remove a YAML inline comment from *raw*, respecting quoted values.

    Scans *raw* left-to-right.  A ``#`` character that is not enclosed in
    single or double quotes terminates the value; everything from that ``#``
    onward (including surrounding whitespace) is discarded.
    """
    in_quote: str | None = None
    for i, ch in enumerate(raw):
        if ch in ('"', "'"):
            if in_quote is None:
                in_quote = ch
            elif in_quote == ch:
                in_quote = None
        elif ch == "#" and in_quote is None:
            return raw[:i].rstrip()
    return raw


def _extract_yaml_scalar(text: str, key: str) -> str | None:
    """Return the top-level scalar value for *key* from simple YAML *text*.

    Returns ``None`` if the key is absent.  Only top-level ``key: value``
    lines are considered; nested structures, multi-line values, and YAML
    anchors are not supported — the persona metadata files only use simple
    scalars for the fields this module needs.

    Inline comments and surrounding quotes (single or double) are stripped
    from the returned value.
    """
    prefix = f"{key}:"
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if stripped.startswith(prefix):
            raw = stripped[len(prefix):].strip()
            raw = _strip_inline_comment(raw).strip()
            # Strip surrounding quotes.
            if len(raw) >= 2 and raw[0] in ('"', "'") and raw[-1] == raw[0]:
                raw = raw[1:-1]
            return raw
    return None


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def extract_persona_model_slugs(workspace_root: Path | str) -> dict[str, str]:
    """Read persona YAML metadata and return ``{stage_id: model_slug}``.

    The ``model_slug`` for each stage is resolved as follows:

    1. Use the per-persona ``model_slug`` field if present.
    2. Fall back to ``default_model_slug`` from ``_shared.yaml``.

    Parameters
    ----------
    workspace_root:
        Path to the monorepo workspace root.  The metadata directory
        ``personas/ledger/src/meta/`` and the shared manifest
        ``shared/workflow-manifest.json`` are resolved relative to this path.

    Returns
    -------
    dict[str, str]
        Mapping of stage ID (e.g. ``"developer"``) → API model slug (e.g.
        ``"claude-sonnet-4-6"``).  Contains one entry per role defined in the
        shared workflow manifest that has a matching persona YAML file.

    Raises
    ------
    OSError
        If the persona metadata directory does not exist.
    FileNotFoundError
        If ``_shared.yaml`` or ``workflow-manifest.json`` is missing.
    ValueError
        If ``default_model_slug`` is absent from ``_shared.yaml``.

    Notes
    -----
    The glob pattern ``[1-9]-*.yaml`` only matches files with a **single-digit**
    numeric prefix (i.e. role numbers 1–9). If a tenth role is ever added with a
    two-digit prefix (e.g. ``10-new-role.yaml``), it will be **silently skipped**
    by this function. Update the pattern in ``_META_DIR_RELATIVE`` glob call if
    the total number of roles exceeds 9.
    """
    workspace_root = Path(workspace_root)
    meta_dir = workspace_root / _META_DIR_RELATIVE

    if not meta_dir.is_dir():
        raise OSError(
            f"Persona metadata directory not found: {meta_dir}. "
            "Ensure the workspace is fully checked out."
        )

    # ------------------------------------------------------------------
    # 1. Load default_model_slug from _shared.yaml.
    # ------------------------------------------------------------------
    shared_path = meta_dir / "_shared.yaml"
    shared_text = shared_path.read_text(encoding="utf-8")
    default_slug = _extract_yaml_scalar(shared_text, "default_model_slug")
    if default_slug is None:
        raise ValueError(
            f"'default_model_slug' not found in {shared_path}. "
            "Ensure WP-001 persona metadata changes are in place."
        )

    # ------------------------------------------------------------------
    # 2. Build number → stage_id from the shared workflow manifest.
    # ------------------------------------------------------------------
    manifest_path = workspace_root / _MANIFEST_RELATIVE
    manifest_data = json.loads(manifest_path.read_text(encoding="utf-8"))
    if "roles" not in manifest_data:
        raise ValueError(
            f"'roles' key missing from {manifest_path}. "
            "Ensure shared/workflow-manifest.json is valid."
        )
    number_to_id: dict[int, str] = {
        r["number"]: r["id"] for r in manifest_data["roles"]
    }

    # ------------------------------------------------------------------
    # 3. Scan per-persona YAML files (e.g. 1-planner.yaml … 9-synthesis.yaml).
    # ------------------------------------------------------------------
    result: dict[str, str] = {}
    for yaml_file in sorted(meta_dir.glob("[1-9]-*.yaml")):
        text = yaml_file.read_text(encoding="utf-8")

        number_str = _extract_yaml_scalar(text, "number")
        if number_str is None:
            log.warning("Skipping %s: no 'number' field found.", yaml_file.name)
            continue
        try:
            number = int(number_str)
        except ValueError:
            log.warning(
                "Skipping %s: 'number' is not an integer: %r.",
                yaml_file.name,
                number_str,
            )
            continue

        stage_id = number_to_id.get(number)
        if stage_id is None:
            log.warning(
                "Skipping %s: number %d not in workflow manifest.",
                yaml_file.name,
                number,
            )
            continue

        model_slug = _extract_yaml_scalar(text, "model_slug") or default_slug
        result[stage_id] = model_slug
        log.debug(
            "Stage %r → model slug %r (from %s).",
            stage_id,
            model_slug,
            yaml_file.name,
        )

    return result

```
###  Path: `/orchestrator/src/utils/plan_parser.py`

```py
"""
utils/plan_parser.py — Plan document parser.

Provides :func:`parse_plan` which extracts the plan title, summary, and full
content from a Markdown plan document, and :class:`PlanMetadata` which holds
the result.

Parsing rules
-------------
- YAML frontmatter (delimited by ``---``) is stripped before heading
  extraction.
- The **title** is the first top-level heading (``# Title``).
- The **summary** is the first non-empty paragraph that follows the title
  (headings, horizontal rules, and image-only lines are skipped).

Example::

    meta = parse_plan("docs/agents/plans/2026-02-24-langgraph-orchestrator/plan.md")
    print(meta.title)    # "LangGraph Orchestrator"
    print(meta.summary)  # first body paragraph
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class PlanMetadata:
    """
    Structured metadata extracted from a plan Markdown document.

    Attributes
    ----------
    title:
        The plan's primary heading (first ``# …`` line), or an empty string
        if no H1 heading is found.
    summary:
        The first body paragraph after the title.  Provides the LLM with a
        concise overview of the plan.  Empty string if not found.
    file_path:
        Absolute path to the source file on disk.
    raw_content:
        Full Markdown content of the file (including any frontmatter).
    """

    title: str
    summary: str
    file_path: str
    raw_content: str = field(repr=False)


# ---------------------------------------------------------------------------
# Compiled regex patterns
# ---------------------------------------------------------------------------

_FRONTMATTER_RE = re.compile(r"^---\s*\n.*?\n---\s*\n", re.DOTALL)
_H1_RE = re.compile(r"^#\s+(.+)$", re.MULTILINE)
_BLANK_LINE_RE = re.compile(r"\n{2,}")


def parse_plan(plan_file: str) -> PlanMetadata:
    """
    Parse a Markdown plan document and return structured :class:`PlanMetadata`.

    Parameters
    ----------
    plan_file:
        Path to the plan Markdown file.  Both absolute and relative paths are
        accepted; relative paths are resolved from the current working
        directory.

    Returns
    -------
    PlanMetadata
        Extracted title, summary, absolute file path, and raw content.

    Raises
    ------
    FileNotFoundError
        If *plan_file* does not exist on disk.
    """
    path = Path(plan_file).resolve()
    if not path.exists():
        raise FileNotFoundError(f"Plan file not found: {plan_file}")

    raw_content = path.read_text(encoding="utf-8")

    # Strip YAML frontmatter if present.
    body = _FRONTMATTER_RE.sub("", raw_content).strip()

    # Extract title from the first H1 heading.
    title_match = _H1_RE.search(body)
    title = title_match.group(1).strip() if title_match else ""

    # Extract summary: first substantive paragraph after the title.
    summary = _extract_summary(body, title_match)

    return PlanMetadata(
        title=title,
        summary=summary,
        file_path=str(path),
        raw_content=raw_content,
    )


def _extract_summary(body: str, title_match: re.Match[str] | None) -> str:
    """
    Return the first non-empty paragraph that follows the title heading.

    Headings (``#``), horizontal rules (``---``/``===``), and image-only lines
    are skipped so that the returned text is always a narrative paragraph.
    """
    start = title_match.end() if title_match else 0
    remainder = body[start:].strip()

    for block in _BLANK_LINE_RE.split(remainder):
        block = block.strip()
        if not block:
            continue
        # Skip headings.
        if block.startswith("#"):
            continue
        # Skip horizontal rules.
        if re.match(r"^(-{3,}|={3,})\s*$", block):
            continue
        # Skip badge / image-only lines.
        if block.startswith("!["):
            continue
        # Collapse internal newlines to a single space for a clean summary.
        return " ".join(line.strip() for line in block.splitlines() if line.strip())

    return ""

```
###  Path: `/orchestrator/src/utils/subagents.py`

```py
"""
utils/subagents.py — Subagent definition loader.

Builds SubAgent spec dicts for stages that delegate sub-tasks to specialised
sub-agents.  Called by the node factory in :mod:`src.nodes` before
``create_deep_agent()`` so that only the stages listed in
:data:`~src.config.STAGE_SUBAGENT_FILES` receive a subagent list.

Example::

    subs = load_subagents("pm", workspace_root=config.workspace_root)
    # → [{"name": "WP Decomposer", "description": "...", "system_prompt": "..."}]

    subs = load_subagents("developer", workspace_root=config.workspace_root)
    # → []
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)

# Module-level in-memory cache: (stage, subagent_name) → persona file content.
_CACHE: dict[tuple[str, str], str] = {}


def load_subagents(
    stage: str,
    workspace_root: Path | str,
) -> list[dict[str, Any]]:
    """
    Build and return SubAgent spec dicts for *stage*.

    Returns an empty list for stages that have no subagent configuration in
    :data:`~src.config.STAGE_SUBAGENT_FILES`.  Results are cached per
    ``(stage, name)`` pair for the process lifetime so repeated calls within
    a single run (e.g. when the PM stage handles multiple plans) do not
    re-read the file system.

    Parameters
    ----------
    stage:
        Graph stage name (e.g. ``"pm"``, ``"developer"``).
    workspace_root:
        Absolute path to the ai-insights workspace root (parent of
        ``orchestrator/``).

    Returns
    -------
    list[dict[str, Any]]
        List of SubAgent TypedDict-compatible dicts with at least
        ``name``, ``description``, and ``system_prompt`` keys.

    Raises
    ------
    FileNotFoundError
        If a configured subagent persona file does not exist on disk.
    """
    from src.config import STAGE_SUBAGENT_FILES  # noqa: PLC0415

    spec_list = STAGE_SUBAGENT_FILES.get(stage, [])
    if not spec_list:
        return []

    workspace_root = Path(workspace_root)
    subagents: list[dict[str, Any]] = []

    for spec in spec_list:
        name: str = spec["name"]
        cache_key = (stage, name)

        if cache_key in _CACHE:
            content = _CACHE[cache_key]
        else:
            persona_file = spec["persona_file"]
            full_path = workspace_root / persona_file
            if not full_path.resolve().is_relative_to(workspace_root.resolve()):
                raise ValueError(
                    f"Subagent persona file path escapes workspace root "
                    f"({workspace_root!r}): {full_path}"
                )
            if not full_path.exists():
                raise FileNotFoundError(
                    f"Subagent persona file for stage {stage!r} "
                    f"({name!r}) not found at: {full_path}"
                )
            content = full_path.read_text(encoding="utf-8")
            _CACHE[cache_key] = content
            log.debug(
                "Loaded subagent persona %r for stage %r (%d chars).",
                name,
                stage,
                len(content),
            )

        subagents.append({
            "name": name,
            "description": spec["description"],
            "system_prompt": content,
        })

    return subagents


def clear_cache() -> None:
    """Clear the in-memory subagent persona cache.  Useful in tests."""
    _CACHE.clear()

```
###  Path: `/orchestrator/src/utils/subprocess_encoding.py`

```py
"""
subprocess_encoding — Windows subprocess text-mode encoding fix.

On Windows, ``subprocess.Popen(text=True)`` defaults to the system codepage
(e.g. CP1252) with ``errors='strict'``.  When the child process outputs bytes
that are invalid in that codepage — or invalid UTF-8 when ``PYTHONUTF8=1`` is
set — the internal ``_readerthread`` used by ``Popen.communicate()`` crashes
with ``UnicodeDecodeError``, silently breaking the communication pipe.

This module monkeypatches ``subprocess.Popen.__init__`` to inject
``errors='replace'`` whenever text mode is requested and no explicit ``errors``
parameter was provided.  This ensures undecodable bytes are replaced with the
Unicode replacement character (U+FFFD) instead of crashing the reader thread.

The patch is **idempotent** and **no-op on non-Windows** platforms.

Typical usage — import once at the top of the CLI entry point::

    import src.utils.subprocess_encoding  # noqa: F401  # side-effect: patches subprocess
"""

from __future__ import annotations

import subprocess
import sys

_PATCHED = False


def _apply_patch() -> None:
    """Monkeypatch ``subprocess.Popen.__init__`` with safe text-mode defaults."""
    global _PATCHED  # noqa: PLW0603
    if _PATCHED or sys.platform != "win32":
        return

    _orig_init = subprocess.Popen.__init__

    def _patched_init(self: subprocess.Popen, *args: object, **kwargs: object) -> None:  # type: ignore[type-arg]
        # Only inject errors='replace' when text mode is active and no
        # explicit errors= was provided by the caller.
        text_mode = kwargs.get("text") or kwargs.get("universal_newlines")
        encoding = kwargs.get("encoding")
        # text=True, OR an explicit encoding= both enable text mode in Popen.
        if (text_mode or encoding is not None) and "errors" not in kwargs:
            kwargs["errors"] = "replace"
        _orig_init(self, *args, **kwargs)  # type: ignore[arg-type]

    subprocess.Popen.__init__ = _patched_init  # type: ignore[assignment]
    _PATCHED = True


# Apply the patch on import.
_apply_patch()

```
###  Path: `/orchestrator/src/utils/tool_wrappers.py`

```py
"""
tool_wrappers — MCP tool call safety-net utilities.

This module provides three defensive wrapper functions (compatible with
langchain-core >= 1.2.x and LangGraph >= 1.0.x, which require ``ainvoke``
to return ``ToolMessage`` objects when invoked via ``ToolNode``):

:func:`inject_project_path`
    Auto-injects ``project_path`` into every MCP tool call when the argument is
    absent.  It acts as a **Layer 2 safety net**: even if an LLM-driven agent
    ignores the explicit prompt instructions that ask it to supply
    ``project_path``, this wrapper guarantees the argument reaches the MCP
    server.

:func:`restrict_to_wp`
    Guards against hallucinated cross-WP tool calls using a **soft-fail with
    strike counter**.  The first two cross-WP write attempts return a
    descriptive ``"ERROR: …"`` string to the agent (giving it a chance to
    self-correct); the third violation raises :class:`ValueError` (hard kill).
    This is a **Layer 3 safety net** that prevents a confused LLM from
    accidentally operating on a different work package.

:func:`log_tool_calls`
    Emits a ``tool_call`` JSONL event (via :class:`~src.utils.logging.WorkflowLogger`)
    before forwarding every ``ainvoke`` call to the underlying MCP tool.  Provides
    real-time visibility into which tools each pipeline stage is invoking and which
    work package each call targets, without logging argument payloads (privacy
    constraint).

Internal architecture
---------------------
**Frozen dataclass contexts:** Each wrapper defines a frozen ``@dataclass``
(``_InjectCtx``, ``_GuardCtx``, ``_LogCtx``) that groups the per-tool
closure state previously captured via multiple default-argument parameters.
This pattern is more readable, enables IDE autocompletion, and makes it easy
to add state without changing the closure signature.

**``_patch_tool()`` helper:** LangChain tools extend Pydantic ``BaseModel``,
which validates ``__setattr__``.  All attribute monkeypatching in this module
is funnelled through :func:`_patch_tool`, the **only** function that calls
``object.__setattr__``.  This centralises the bypass for auditing and future
migration.

Design notes — :func:`inject_project_path`
-------------------------------------------
- **Idempotent:** A sentinel attribute ``_orig_ainvoke`` prevents wrapper
  stacking when the same tool objects are passed multiple times.
- Only ``ainvoke`` is monkeypatched; all other attributes remain untouched.
- Injection uses ``setdefault`` semantics: an explicitly-provided
  ``project_path`` is never overwritten.  ``cwd_path`` (IDE-only) is
  stripped — ``project_path`` takes precedence.
- ``ledger_detect_project`` is short-circuited with a synthetic response
  (no MCP round-trip) because ``project_path`` is always known.
- Both dict-style and plain-string input are handled gracefully.

Design notes — :func:`restrict_to_wp`
--------------------------------------
- **Idempotent:** A ``_wp_guard_ref`` sentinel prevents double-stacking.
  If inner wrappers were re-applied since the last call, the delegation
  target is updated to the fresh inner chain.
- Empty ``wp_id`` → no wrapping (stages without an active WP).
- **Read-only tools are exempt** (``_READ_ONLY_TOOLS``).
- Missing ``work_package_id`` → auto-injected with the active WP ID.
- Mismatched ``work_package_id`` → soft-fail (violations 1–2 return an
  error string); hard kill on violation 3+ (:class:`ValueError`).
- The strike counter (``_GuardCtx.counter``) is a ``list[int]`` shared
  across all tool closures; it resets on each :func:`restrict_to_wp` call.
- Both flat-dict and ``{"args": {...}}`` ToolCall structures are inspected.
- **Shared-tool-instance safe:** sentinels are overwritten on every call.

Design notes — :func:`log_tool_calls`
--------------------------------------
- **Idempotent:** A ``_log_wrapper_ref`` sentinel prevents double-stacking,
  mirroring the pattern in :func:`restrict_to_wp`.
- ``logger is None`` → no wrapping (unit tests, loggerless stages).
- Only ``tool.name`` and ``work_package_id`` are captured; the full
  argument payload is deliberately **excluded** (privacy constraint).
- Both flat-dict and ``{"args": {...}}`` ToolCall structures are inspected.
- Events use ``level: "DEBUG"`` for filtering.

Context
-------
Tests for this module live in ``orchestrator/tests/test_tool_wrappers.py``.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from langchain_core.messages import ToolMessage

if TYPE_CHECKING:
    from src.utils.logging import WorkflowLogger

# MCP tools that perform read-only operations.  These are exempt from
# the cross-WP guard in :func:`restrict_to_wp` so that agents can read
# other work packages for context (pipeline comments, handoff notes, etc.)
# without triggering a stage-level error.
_READ_ONLY_TOOLS: frozenset[str] = frozenset({
    "ledger_get_work_package",
    "ledger_list_work_packages",
    "ledger_get_next_action",
    "ledger_get_project_status",
    "ledger_get_handoff_status",
    "ledger_detect_project",  # also short-circuited by inject_project_path
    "ledger_list_projects",
    "ledger_help",
})


def _patch_tool(tool: Any, **attrs: Any) -> None:
    """Set attributes on a tool object, bypassing Pydantic's ``__setattr__``.

    LangChain tools extend Pydantic ``BaseModel`` which validates attribute
    assignment.  This helper centralises the ``object.__setattr__`` bypass
    so the pattern appears exactly once in the module and can be audited
    (or migrated) in a single place.
    """
    for name, value in attrs.items():
        object.__setattr__(tool, name, value)


# ---------------------------------------------------------------------------
# Frozen dataclass contexts — one per wrapper — group the per-tool closure
# state that was previously captured via multiple default-argument parameters.
# ---------------------------------------------------------------------------

@dataclass(frozen=True, slots=True)
class _InjectCtx:
    """Per-tool closure state for :func:`inject_project_path`."""

    orig: Any
    project_path: str
    tool_name: str


@dataclass(frozen=True, slots=True)
class _GuardCtx:
    """Per-tool closure state for :func:`restrict_to_wp`."""

    orig: Any
    active_wp: str
    counter: list[int] = field(hash=False)
    max_soft: int
    tool_name: str


@dataclass(frozen=True, slots=True)
class _LogCtx:
    """Per-tool closure state for :func:`log_tool_calls`."""

    orig: Any
    tool_name: str
    stage: str
    wp_id: str
    logger: Any


def _make_tool_response(
    content: str,
    input: Any,
    tool_name: str,
    status: str = "error",
) -> ToolMessage | str:
    """Wrap *content* in a ``ToolMessage`` when running inside LangGraph's ToolNode.

    LangGraph >= 1.0.9 enforces ``isinstance(response, ToolMessage)`` on the
    return value of ``tool.ainvoke``.  Short-circuit return paths that bypass
    the normal ``BaseTool.ainvoke → _format_output`` chain must therefore
    produce a ``ToolMessage`` when a ``tool_call_id`` (input dict key ``"id"``)
    is present.

    When the input is a plain dict without ``"id"`` (unit tests, direct
    invocations), the raw string is returned for backward compatibility.
    """
    if isinstance(input, dict):
        tool_call_id = input.get("id")
        if tool_call_id is not None:
            return ToolMessage(
                content=content,
                tool_call_id=tool_call_id,
                name=tool_name,
                status=status,
            )
    return content


def inject_project_path(tools: list[Any], project_path: str) -> list[Any]:
    """Wrap each tool's ``ainvoke`` to auto-inject ``project_path``.

    The function is **idempotent**: calling it multiple times on the same tool
    objects (e.g. because ``list(mcp_tools)`` produces a shallow copy) will
    not stack closures.  A sentinel attribute (``_orig_ainvoke``) is set on
    each tool on the first wrap; subsequent calls reuse that sentinel as the
    original so the wrapper chain never grows beyond one level.

    Parameters
    ----------
    tools:
        A list of LangChain ``BaseTool`` instances (typically MCP-backed
        ``StructuredTool`` objects obtained from
        :class:`~src.mcp_client.MCPToolkit`).
    project_path:
        The ledger project-directory path to inject when the tool call
        arguments do not already contain ``project_path``.

    Returns
    -------
    list[Any]
        The same list with each tool's ``ainvoke`` replaced by the wrapper.
        Mutation is in-place; the original list reference is also returned for
        convenience.  Repeated calls on already-wrapped tools are idempotent.
    """
    for tool in tools:
        # Retrieve (or establish) the true original ainvoke via sentinel.
        # This prevents wrapper stacking when the same tool object is passed
        # to inject_project_path more than once (shallow-copy scenario).
        if not hasattr(tool, "_orig_ainvoke"):
            _patch_tool(tool, _orig_ainvoke=tool.ainvoke)
        _original_ainvoke = tool._orig_ainvoke  # type: ignore[attr-defined]

        ctx = _InjectCtx(
            orig=_original_ainvoke,
            project_path=project_path,
            tool_name=tool.name,
        )

        async def _wrapped_ainvoke(
            input: Any,
            *args: Any,
            _ctx: _InjectCtx = ctx,
            **kwargs: Any,
        ) -> Any:
            # Short-circuit: ledger_detect_project is an IDE-facing tool that
            # cross-references cwd_path against stored project roots.  In the
            # orchestrator, project_path is always known, so we return a
            # synthetic response immediately — no MCP round-trip needed.
            if _ctx.tool_name == "ledger_detect_project":
                slug = _ctx.project_path.rstrip("/").rsplit("/", 1)[-1]
                title = slug.replace("-", " ").replace("_", " ").title()
                payload = json.dumps({
                    "plan_path": _ctx.project_path,
                    "slug": slug,
                    "title": title,
                    "status": "active",
                    "note": "Short-circuited by orchestrator — project_path is already known.",
                })
                return _make_tool_response(payload, input, _ctx.tool_name, status="success")
            if isinstance(input, dict):
                # LangGraph ToolNode passes a ToolCall dict with args nested
                # inside input["args"], while direct invocations pass a flat
                # dict of tool arguments.  Handle both structures.
                if "args" in input and isinstance(input["args"], dict):
                    # ToolCall structure: {"name": ..., "args": {...}, ...}
                    target = input["args"]
                else:
                    # Flat dict of tool arguments
                    target = input

                # In the orchestrator context we always know the exact
                # project_path, so cwd_path-based auto-detection is never
                # needed.  If the LLM agent followed persona instructions
                # meant for interactive IDE agents and passed cwd_path,
                # strip it — project_path takes precedence when both are
                # present, but removing it avoids unnecessary ambiguity.
                if "cwd_path" in target:
                    del target["cwd_path"]
                target.setdefault("project_path", _ctx.project_path)
            return await _ctx.orig(input, *args, **kwargs)

        _patch_tool(tool, ainvoke=_wrapped_ainvoke)

    return tools


def restrict_to_wp(tools: list[Any], wp_id: str) -> list[Any]:
    """Wrap each tool's ``ainvoke`` to guard against cross-WP write calls.

    When a tool call includes a ``work_package_id`` argument that does not
    match *wp_id*, the guard applies a **soft-fail with strike counter**:

    * **Violations 1–2** — returns a descriptive ``"ERROR: …"`` string so the
      agent can self-correct without aborting the stage.
    * **Violation 3+** — raises :class:`ValueError` (hard kill) to prevent
      infinite retry loops.

    The strike counter is shared across *all* tools wrapped in a single call
    so any two cross-WP violations in the same stage trigger the hard kill.

    Tool calls that do not include ``work_package_id`` are passed through
    unmodified; the active WP ID is auto-injected instead.

    The function is **idempotent**: a sentinel attribute ``_orig_ainvoke_wp``
    prevents closure stacking when the same tool objects are wrapped more than
    once.

    Parameters
    ----------
    tools:
        A list of tool objects (typically already wrapped by
        :func:`inject_project_path`).
    wp_id:
        The active work-package identifier (e.g. ``"WP-001"``).
        When this is an **empty string**, the function returns *tools* unchanged
        so that stages without an active WP (e.g. synthesis) are not affected.

    Returns
    -------
    list[Any]
        The same list with each tool's ``ainvoke`` replaced by the guard
        wrapper.  Mutation is in-place; the original list reference is also
        returned for convenience.
    """
    if not wp_id:
        return tools

    # Shared strike counter for all tools in this restrict_to_wp invocation.
    # A single-element list acts as a mutable counter so each closure can
    # increment it without a ``nonlocal`` statement.  The counter resets
    # automatically when restrict_to_wp is called again for a new stage
    # (a fresh list is created on each call).
    _strikes: list[int] = [0]
    _MAX_SOFT_FAILS: int = 2

    for tool in tools:
        # Read-only tools are exempt from the guard — agents need to read
        # other WPs for context (pipeline comments, handoff notes, etc.).
        tool_name = getattr(tool, "name", "")
        if tool_name in _READ_ONLY_TOOLS:
            continue

        # If the current ainvoke is our own guard from a previous call
        # (identity check), reuse the saved delegation target (idempotent
        # double-call scenario).  Otherwise the inner layers were re-wrapped
        # since our last call — capture the fresh inner wrapper.
        _prev = getattr(tool, "_wp_guard_ref", None)
        if _prev is not None and tool.ainvoke is _prev:
            _original_ainvoke_wp = tool._orig_ainvoke_wp  # type: ignore[attr-defined]
        else:
            _patch_tool(tool, _orig_ainvoke_wp=tool.ainvoke)
            _original_ainvoke_wp = tool.ainvoke

        ctx = _GuardCtx(
            orig=_original_ainvoke_wp,
            active_wp=wp_id,
            counter=_strikes,
            max_soft=_MAX_SOFT_FAILS,
            tool_name=tool_name,
        )

        async def _guarded_ainvoke(
            input: Any,
            *args: Any,
            _ctx: _GuardCtx = ctx,
            **kwargs: Any,
        ) -> Any:
            if isinstance(input, dict):
                # Handle both flat-dict and ToolCall {"args": {...}} structures.
                if "args" in input and isinstance(input["args"], dict):
                    target = input["args"]
                else:
                    target = input

                call_wp_id = target.get("work_package_id")
                if call_wp_id is None:
                    # Inject the active WP ID when the agent omits it.  This
                    # prevents cross-WP contamination from forgotten parameters
                    # without raising an error — tools that don't use WP IDs
                    # will simply ignore the extra argument.
                    target["work_package_id"] = _ctx.active_wp
                elif call_wp_id != _ctx.active_wp:
                    _ctx.counter[0] += 1
                    if _ctx.counter[0] <= _ctx.max_soft:
                        # Soft-fail: return an error message so the agent can
                        # self-correct without aborting the stage.
                        error_msg = (
                            f"ERROR: Tool call targets work_package_id={call_wp_id!r} "
                            f"but the active work package is {_ctx.active_wp!r}. "
                            f"You MUST retry this call with "
                            f"work_package_id={_ctx.active_wp!r}. "
                            f"(violation {_ctx.counter[0]} of {_ctx.max_soft} "
                            f"allowed before hard abort)"
                        )
                        return _make_tool_response(error_msg, input, _ctx.tool_name)
                    # Hard kill — third+ violation; prevent infinite retry loops.
                    raise ValueError(
                        f"Tool call targets work_package_id={call_wp_id!r} but "
                        f"the active work package is {_ctx.active_wp!r}. "
                        "Refusing to forward this call to prevent cross-WP contamination."
                    )
            return await _ctx.orig(input, *args, **kwargs)

        _patch_tool(tool, ainvoke=_guarded_ainvoke, _wp_guard_ref=_guarded_ainvoke)

    return tools


def log_tool_calls(
    tools: list[Any],
    stage: str,
    wp_id: str,
    logger: WorkflowLogger | None,
) -> list[Any]:
    """Wrap each tool's ``ainvoke`` to emit a ``tool_call`` JSONL event.

    Before forwarding each call to the underlying MCP server, the wrapper
    emits a lightweight ``tool_call`` event via ``logger.stream_entry()``.
    The event records the current stage, the stage-level work-package ID,
    the tool name, and the ``work_package_id`` extracted from the call
    arguments — but **not** the full argument payload (privacy constraint).

    The function is **idempotent**: a sentinel attribute
    ``_orig_ainvoke_log`` prevents closure stacking when the same tool
    objects are wrapped more than once (e.g. across node re-invocations
    that reuse the same tool instances).

    When *logger* is ``None`` the function returns *tools* unchanged so
    that stages without a live :class:`~src.utils.logging.WorkflowLogger`
    (e.g. unit tests) are not affected.

    Parameters
    ----------
    tools:
        A list of tool objects (typically already wrapped by
        :func:`inject_project_path` and :func:`restrict_to_wp`).
    stage:
        The current pipeline stage name (e.g. ``"pm"``, ``"developer"``).
        Forwarded verbatim into the emitted event's ``stage`` field.
    wp_id:
        The active work-package identifier (e.g. ``"WP-001"``), or an
        empty string for stages without a targeted WP.  Forwarded into
        the event's ``wp_id`` field.
    logger:
        A live :class:`~src.utils.logging.WorkflowLogger` instance, or
        ``None``.  When ``None``, no wrapping is performed and the tool
        list is returned unchanged.

    Returns
    -------
    list[Any]
        The same list with each tool's ``ainvoke`` replaced by the logging
        wrapper.  Mutation is in-place; the original list reference is also
        returned for convenience.  Repeated calls on already-wrapped tools
        are idempotent.
    """
    if logger is None:
        return tools

    for tool in tools:
        # If the current ainvoke is our own log wrapper from a previous call
        # (identity check), reuse the saved delegation target.  Otherwise
        # the inner layers were re-wrapped — capture the fresh inner wrapper.
        _prev_log = getattr(tool, "_log_wrapper_ref", None)
        if _prev_log is not None and tool.ainvoke is _prev_log:
            _original_ainvoke_log = tool._orig_ainvoke_log  # type: ignore[attr-defined]
        else:
            _patch_tool(tool, _orig_ainvoke_log=tool.ainvoke)
            _original_ainvoke_log = tool.ainvoke

        ctx = _LogCtx(
            orig=_original_ainvoke_log,
            tool_name=getattr(tool, "name", ""),
            stage=stage,
            wp_id=wp_id,
            logger=logger,
        )

        async def _logged_ainvoke(
            input: Any,
            *args: Any,
            _ctx: _LogCtx = ctx,
            **kwargs: Any,
        ) -> Any:
            # Extract work_package_id from the call arguments without
            # capturing the full argument payload (privacy constraint).
            # Handle both flat-dict and ToolCall {"args": {...}} structures.
            tool_wp_id: str = ""
            if isinstance(input, dict):
                if "args" in input and isinstance(input["args"], dict):
                    # ToolCall structure: {"name": ..., "args": {...}, ...}
                    tool_wp_id = input["args"].get("work_package_id", "") or ""
                else:
                    # Flat dict of tool arguments
                    tool_wp_id = input.get("work_package_id", "") or ""

            _ctx.logger.stream_entry({
                "stage": _ctx.stage,
                "wp_id": _ctx.wp_id,
                "action": "tool_call",
                "tool_name": _ctx.tool_name,
                "tool_wp_id": tool_wp_id,
                "level": "DEBUG",
            })
            return await _ctx.orig(input, *args, **kwargs)

        _patch_tool(tool, ainvoke=_logged_ainvoke, _log_wrapper_ref=_logged_ainvoke)

    return tools


```