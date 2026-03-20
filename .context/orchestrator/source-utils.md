# Orchestrator - Utilities
_SOURCE: Utility modules: tool wrappers, persona loader, plan parser, JSONL logger_
# Utility modules: tool wrappers, persona loader, plan parser, JSONL logger
```
// Structure of documents
└── orchestrator/
    └── src/
        └── utils/
            └── __init__.py
            └── logging.py
            └── persona.py
            └── plan_parser.py
            └── tool_wrappers.py

```
###  Path: `\orchestrator\src\utils/__init__.py`

```py
"""
utils — shared helper utilities.
"""

```
###  Path: `\orchestrator\src\utils/logging.py`

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

```
###  Path: `\orchestrator\src\utils/persona.py`

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
###  Path: `\orchestrator\src\utils/plan_parser.py`

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
###  Path: `\orchestrator\src\utils/tool_wrappers.py`

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
  ``project_path`` (or a ``cwd_path`` used by ``ledger_detect_project``)
  is never overwritten.
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
            tool._orig_ainvoke = tool.ainvoke  # type: ignore[attr-defined]
        _original_ainvoke = tool._orig_ainvoke  # type: ignore[attr-defined]

        async def _wrapped_ainvoke(
            input: Any,
            *args: Any,
            _orig: Any = _original_ainvoke,
            _proj: str = project_path,
            **kwargs: Any,
        ) -> Any:
            if isinstance(input, dict):
                # Only inject when neither project_path nor cwd_path is present.
                if "cwd_path" not in input:
                    input.setdefault("project_path", _proj)
            return await _orig(input, *args, **kwargs)

        tool.ainvoke = _wrapped_ainvoke  # type: ignore[method-assign]

    return tools


```