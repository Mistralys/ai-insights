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
