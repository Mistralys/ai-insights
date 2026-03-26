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
