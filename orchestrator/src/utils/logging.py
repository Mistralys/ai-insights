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

import json
import logging
import re
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

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

        # Also emit a console line so stderr stays in sync.
        stage = entry.get("stage", "")
        wp_id = entry.get("wp_id", "")
        action = entry.get("action", "")
        result = entry.get("result", "")
        parts = [f"[{stage}]" if stage else "[—]"]
        if wp_id:
            parts.append(wp_id)
        parts.append(action)
        if result:
            parts.append(f"→ {result}")
        tokens = entry.get("tokens_used")
        if tokens is not None:
            parts.append(f"({tokens} tokens)")
        self._console.info(" ".join(parts))

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
        return None
    configurable = config.get("configurable") or {}
    return configurable.get("run_logger")
