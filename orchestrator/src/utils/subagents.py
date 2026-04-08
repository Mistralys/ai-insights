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
