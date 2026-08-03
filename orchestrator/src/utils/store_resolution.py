"""store_resolution.py — Python mirror of the TypeScript multi-store resolution logic.

Reads ``~/.ai-insights/stores.json`` and the per-store ``.repositories.json``
files to resolve which store owns a given repository name.  Used by the
orchestrator's path-derivation helpers so that log files and slug directories
are written to the correct store in multi-store mode.

All I/O is synchronous and uses only stdlib modules (``pathlib``, ``json``).
No new dependencies are introduced.

Public API
----------
resolve_store_for_repo(repo_name, workspace_root, _stores_config_path=None) -> Path
    Return the ledger store root Path for *repo_name*, or the default
    single-store path when stores.json is absent or the repo is unregistered.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Internal constants
# ---------------------------------------------------------------------------

_STORES_CONFIG_FILENAME: str = "stores.json"
_AI_INSIGHTS_DIR: Path = Path.home() / ".ai-insights"
_REPOSITORIES_FILENAME: str = ".repositories.json"

_logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def resolve_store_for_repo(
    repo_name: str,
    workspace_root: Path,
    _stores_config_path: Path | None = None,
) -> Path:
    """Return the ledger store root for *repo_name*.

    Resolution algorithm
    --------------------
    1. Locate ``stores.json`` at ``_stores_config_path`` (test override) or
       ``~/.ai-insights/stores.json`` (production default).
    2. If the file is absent or malformed, fall back to the default path
       ``workspace_root / "mcp-server" / "storage" / "ledger"``.
    3. Iterate the ``stores`` array in config order.  For each store, read its
       ``.repositories.json`` and check whether *repo_name* matches any entry's
       ``folder_names`` list.
    4. Return the path of the first matching store.  If no store claims the
       repo, return the default path.

    Parameters
    ----------
    repo_name:
        The repository name to resolve (e.g. ``"ai-insights"``).  Compared
        case-insensitively against ``folder_names`` entries.
    workspace_root:
        The workspace root directory.  Used only to build the default fallback
        path.
    _stores_config_path:
        Optional override for the ``stores.json`` path.  Intended for unit
        tests that want to inject a temp-dir config without mutating the real
        user config.

    Returns
    -------
    Path
        The resolved store root directory (not normalised — callers append
        ``/{repo_name}/{slug}/...`` themselves), or the default
        ``workspace_root / "mcp-server" / "storage" / "ledger"`` when no
        multi-store config is found or the repo is unregistered.
    """
    default = workspace_root / "mcp-server" / "storage" / "ledger"
    config_path = _stores_config_path or (_AI_INSIGHTS_DIR / _STORES_CONFIG_FILENAME)

    # --- Step 1: load stores.json ---
    config: dict[str, Any] | None = _load_json(config_path)
    if config is None:
        return default

    stores: list[dict[str, Any]] = config.get("stores") or []
    if not stores:
        return default

    # --- Step 2: search stores in config order ---
    repo_lower = repo_name.lower()
    for store_entry in stores:
        store_path_raw: str | None = store_entry.get("path")
        if not store_path_raw:
            continue
        store_path = Path(store_path_raw).expanduser()
        registry = _load_json(store_path / _REPOSITORIES_FILENAME)
        if registry is None:
            continue
        repositories: list[dict[str, Any]] = registry.get("repositories") or []
        for repo_entry in repositories:
            folder_names: list[str] = repo_entry.get("folder_names") or []
            if any(fn.lower() == repo_lower for fn in folder_names):
                return store_path

    # --- Step 3: repo not found in any store — return default ---
    return default


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------


def _load_json(path: Path) -> dict[str, Any] | None:
    """Load and parse a JSON file.  Returns None on any failure (absent, unreadable, malformed)."""
    try:
        text = path.read_text(encoding="utf-8")
        return json.loads(text)  # type: ignore[return-value]
    except Exception:  # noqa: BLE001 — broad catch is intentional: file absent, perms, malformed JSON
        _logger.debug("store_resolution: could not load %s", path, exc_info=True)
        return None
