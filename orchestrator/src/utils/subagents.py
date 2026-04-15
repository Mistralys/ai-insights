"""
utils/subagents.py — Subagent definition loader.

Builds SubAgent spec dicts for stages that delegate sub-tasks to specialised
sub-agents.  Called by the node factory in :mod:`src.nodes` before
``create_deep_agent()`` so that only stages with a ``subagents`` list in their
ledger persona YAML receive a subagent list.

The subagent slugs are declared in the ledger persona YAML for each stage
(e.g. ``personas/ledger/src/meta/2-project-manager.yaml``).  For each slug,
this module resolves:

- **name** — the kebab-case slug itself
- **description** — from ``personas/standalone/src/meta/{slug}.yaml``
- **system_prompt** — from ``personas/standalone/deep-agents/{slug}.md``

Example::

    subs = load_subagents("pm", workspace_root=config.workspace_root)
    # → [
    #     {"name": "ledger-wp-decomposer", "description": "...", "system_prompt": "..."},
    #     {"name": "ledger-dependency-sequencer", "description": "...", ...},
    #     ...
    # ]

    subs = load_subagents("developer", workspace_root=config.workspace_root)
    # → []
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from src.utils.persona_models import (
    _extract_yaml_list,
    _extract_yaml_scalar,
    find_ledger_yaml_for_stage,
)

log = logging.getLogger(__name__)

# Paths relative to workspace root.
_STANDALONE_META_RELATIVE = Path("personas") / "standalone" / "src" / "meta"
_STANDALONE_DEEP_AGENTS_RELATIVE = Path("personas") / "standalone" / "deep-agents"

# Module-level in-memory cache: (stage, slug) → (description, system_prompt).
# workspace_root is intentionally excluded from the cache key — single-workspace assumption.
_CACHE: dict[tuple[str, str], tuple[str, str]] = {}


def load_subagents(
    stage: str,
    workspace_root: Path | str,
) -> list[dict[str, Any]]:
    """
    Build and return SubAgent spec dicts for *stage*.

    Reads the ``subagents`` list from the ledger persona YAML for *stage*
    (via :func:`~src.utils.persona_models.find_ledger_yaml_for_stage`), then
    resolves each slug against the standalone persona metadata YAML
    (``personas/standalone/src/meta/{slug}.yaml``) and the standalone
    deep-agents persona file (``personas/standalone/deep-agents/{slug}.md``).

    Returns an empty list for stages that have no ``subagents`` key in their
    ledger persona YAML, or for unknown stage IDs.  Results are cached per
    ``(stage, slug)`` pair for the process lifetime so repeated calls within
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
        List of SubAgent TypedDict-compatible dicts with ``name``,
        ``description``, and ``system_prompt`` keys.  ``name`` is the
        kebab-case slug declared in the ledger YAML.

    Raises
    ------
    FileNotFoundError
        If any declared slug has no matching standalone YAML or deep-agents
        file.
    ValueError
        If a standalone YAML for a declared slug is missing the ``description``
        field.
    """
    workspace_root = Path(workspace_root)

    # 1. Locate the ledger YAML for this stage and extract the subagents list.
    #    Guard against test fixtures or incomplete workspaces that lack the
    #    workflow manifest — return [] rather than propagating a FileNotFoundError
    #    from the manifest lookup itself.  Errors from missing slug files (raised
    #    below, after we already have *found*) still propagate as expected.
    try:
        found = find_ledger_yaml_for_stage(stage, workspace_root)
    except (FileNotFoundError, OSError):
        log.debug(
            "Workflow manifest or ledger YAML not accessible for stage %r "
            "(workspace_root: %s); returning no subagents.",
            stage,
            workspace_root,
        )
        return []
    if found is None:
        return []

    _, ledger_yaml_text = found
    slugs = _extract_yaml_list(ledger_yaml_text, "subagents")
    if not slugs:
        return []

    subagents: list[dict[str, Any]] = []

    for slug in slugs:
        cache_key = (stage, slug)

        if cache_key in _CACHE:
            description, system_prompt = _CACHE[cache_key]
            log.debug("Cache hit for subagent %r (stage %r).", slug, stage)
        else:
            # 2. Load description from standalone YAML.
            standalone_yaml_path = (
                workspace_root / _STANDALONE_META_RELATIVE / f"{slug}.yaml"
            )
            if not standalone_yaml_path.exists():
                raise FileNotFoundError(
                    f"Standalone persona YAML for subagent slug {slug!r} "
                    f"(stage {stage!r}) not found at: {standalone_yaml_path}"
                )
            standalone_yaml_text = standalone_yaml_path.read_text(encoding="utf-8")
            description = _extract_yaml_scalar(standalone_yaml_text, "description")
            if description is None:
                raise ValueError(
                    f"Standalone persona YAML for subagent slug {slug!r} at "
                    f"{standalone_yaml_path} is missing the 'description' field."
                )

            # 3. Load system_prompt from standalone deep-agents file.
            deep_agents_path = (
                workspace_root / _STANDALONE_DEEP_AGENTS_RELATIVE / f"{slug}.md"
            )
            if not deep_agents_path.exists():
                raise FileNotFoundError(
                    f"Deep-agents persona file for subagent slug {slug!r} "
                    f"(stage {stage!r}) not found at: {deep_agents_path}"
                )
            system_prompt = deep_agents_path.read_text(encoding="utf-8")

            _CACHE[cache_key] = (description, system_prompt)
            log.debug(
                "Loaded subagent %r for stage %r "
                "(description: %d chars, system_prompt: %d chars).",
                slug,
                stage,
                len(description),
                len(system_prompt),
            )

        subagents.append({
            "name": slug,
            "description": description,
            "system_prompt": system_prompt,
        })

    return subagents


def clear_cache() -> None:
    """Clear the in-memory subagent persona cache.  Useful in tests."""
    _CACHE.clear()
