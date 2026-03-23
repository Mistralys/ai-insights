# Orchestrator - Utilities
_SOURCE: Utility modules: tool wrappers, persona loader, plan parser, JSONL logger_
# Utility modules: tool wrappers, persona loader, plan parser, JSONL logger
```
// Structure of documents
└── orchestrator/
    └── src/
        └── utils/
            └── __init__.py
            └── dialogue_writer.py
            └── filelock.py
            └── logging.py
            └── mcp_parse.py
            └── persona.py
            └── plan_parser.py
            └── tool_wrappers.py

```
###  Path: `/orchestrator/src/utils/__init__.py`

```py
"""
utils — shared helper utilities.
"""

```
###  Path: `/orchestrator/src/utils/dialogue_writer.py`

```py
"""
dialogue_writer.py — Utilities for serialising agent dialogues to Markdown files.

Public API
----------
serialize_messages_to_markdown(messages, stage, wp_id, timestamp) -> str
    Convert a LangChain message list to a human-readable Markdown document.

write_dialogue(content, slug_dir, wp_id, stage) -> Path
    Persist *content* to ``{slug_dir}/dialogues/{wp_id}-{stage}-r{N}.md``,
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
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Sequence


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
        timestamp = datetime.now(timezone.utc).isoformat(timespec="seconds")

    lines: list[str] = [
        f"# Dialogue — {stage} / {wp_id}",
        "",
        f"| Field | Value |",
        f"| ----- | ----- |",
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
    Write *content* to ``{slug_dir}/dialogues/{wp_id}-{stage}-r{N}.md``.

    The revision number *N* is determined by globbing existing
    ``{wp_id}-{stage}-r*.md`` files inside ``{slug_dir}/dialogues/``.
    The first call writes ``r0``; subsequent calls for the same
    ``wp_id``/``stage`` pair increment the revision.

    .. note:: Cross-language coupling
        The subdirectory name ``"dialogues"`` is intentionally kept in sync
        with the MCP server's ``DIALOGUES_DIR`` constant defined in
        ``mcp-server/src/utils/constants.ts``.  If this value ever needs to
        change, both files must be updated together.

    Parameters
    ----------
    content:
        Markdown string to write.
    slug_dir:
        Parent directory (e.g. the plan/project directory).
    wp_id:
        Work-package identifier (e.g. ``"WP-001"``).
    stage:
        Pipeline stage name (e.g. ``"developer"``).

    Returns
    -------
    Path
        Absolute path to the file that was written.
    """
    dialogues_dir = slug_dir / "dialogues"
    dialogues_dir.mkdir(parents=True, exist_ok=True)

    # Determine next revision number.
    pattern = f"{wp_id}-{stage}-r*.md"
    existing: list[Path] = sorted(dialogues_dir.glob(pattern))

    revision = 0
    if existing:
        # Extract the revision number from the last (highest) filename.
        for candidate in existing:
            stem = candidate.stem  # e.g. "WP-001-developer-r3"
            # The revision part is everything after the last "-r".
            try:
                rev_str = stem.rsplit("-r", 1)[1]
                rev_num = int(rev_str)
                revision = max(revision, rev_num + 1)
            except (IndexError, ValueError):
                pass

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


def _slugify(text: str, max_len: int = 40) -> str:
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
        log.warning("get_run_logger: config is None")
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
###  Path: `/orchestrator/src/utils/tool_wrappers.py`

```py
"""
tool_wrappers — MCP tool call safety-net utilities.

This module provides :func:`inject_project_path`, a defensive wrapper that
auto-injects ``project_path`` into every MCP tool call when the argument is
absent.  It acts as a **Layer 2 safety net**: even if an LLM-driven agent
ignores the explicit prompt instructions that ask it to supply ``project_path``,
this wrapper guarantees the argument reaches the MCP server.

Design notes
------------
- A sentinel attribute ``_orig_ainvoke`` is stored on the tool object the first
  time it is wrapped.  Subsequent calls to :func:`inject_project_path` on the
  same tool objects (e.g. because ``list(mcp_tools)`` is a shallow copy and the
  same tool instances are re-used across node invocations) always delegate to
  the *original* ``ainvoke``, making the function **idempotent** and preventing
  unbounded wrapper stacking.
- Only ``ainvoke`` is monkeypatched; all other attributes (``name``,
  ``description``, ``args_schema``, etc.) remain untouched so that tool
  discovery and schema introspection work as normal.
- Injection uses ``setdefault`` semantics: an explicitly-provided
  ``project_path`` is never overwritten.  If the LLM passes ``cwd_path``
  (following persona instructions meant for IDE agents), the wrapper
  strips it and falls through to ``project_path`` injection.
- The wrapper handles both dict-style and plain-string input gracefully — if
  the input is not a dict no injection is attempted.

Context
-------
Tests for this module live in ``orchestrator/tests/test_tool_wrappers.py``
(WP-005).
"""

from __future__ import annotations

from typing import Any


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
        arguments do not already contain ``project_path`` or ``cwd_path``.

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
            object.__setattr__(tool, "_orig_ainvoke", tool.ainvoke)
        _original_ainvoke = tool._orig_ainvoke  # type: ignore[attr-defined]

        async def _wrapped_ainvoke(
            input: Any,
            *args: Any,
            _orig: Any = _original_ainvoke,
            _proj: str = project_path,
            **kwargs: Any,
        ) -> Any:
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
                # replace it with the authoritative project_path.
                if "cwd_path" in target:
                    del target["cwd_path"]
                target.setdefault("project_path", _proj)
            return await _orig(input, *args, **kwargs)

        object.__setattr__(tool, "ainvoke", _wrapped_ainvoke)

    return tools


```