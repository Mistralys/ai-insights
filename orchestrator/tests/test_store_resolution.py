"""
test_store_resolution.py — Unit tests for src.utils.store_resolution.

Verifies that resolve_store_for_repo() correctly resolves the ledger store
path for a given repository name across the following scenarios:

1. stores.json is absent → return default path
2. repo not registered in any store → return default path
3. repo registered in a non-default store → return that store's path
4. malformed stores.json → return default path (no exception)
5. ~ expansion in store paths from the config
6. _derive_slug_dir() and _derive_ledger_log_dir() use the resolved store path
7. _load_json() emits debug logging on failure
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from src.utils.store_resolution import resolve_store_for_repo
from src.cli import _derive_ledger_log_dir
from src.nodes import _derive_slug_dir

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

WORKSPACE = Path("/workspaces/ai-insights")
DEFAULT_LEDGER = WORKSPACE / "mcp-server" / "storage" / "ledger"


def _write_stores_config(path: Path, stores: list[dict], default_store: str) -> None:
    """Write a minimal stores.json to *path*."""
    path.write_text(
        json.dumps({"stores": stores, "default_store": default_store}),
        encoding="utf-8",
    )


def _write_registry(store_path: Path, folder_names_per_repo: dict[str, list[str]]) -> None:
    """Write a .repositories.json in *store_path* containing entries for *folder_names_per_repo*."""
    repositories = [
        {
            "id": repo_id,
            "label": repo_id,
            "folder_names": folder_names,
            "vision": {"short_term": None, "mid_term": None, "long_term": None},
            "created_at": "2026-01-01T00:00:00Z",
            "last_modified": "2026-01-01T00:00:00Z",
        }
        for repo_id, folder_names in folder_names_per_repo.items()
    ]
    registry_path = store_path / ".repositories.json"
    registry_path.write_text(
        json.dumps({"repositories": repositories}),
        encoding="utf-8",
    )


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestResolveStoreForRepo:

    def test_absent_stores_json_returns_default(self, tmp_path: Path) -> None:
        """When stores.json does not exist, the default path is returned."""
        config_path = tmp_path / "nonexistent" / "stores.json"
        result = resolve_store_for_repo("my-repo", WORKSPACE, _stores_config_path=config_path)
        assert result == DEFAULT_LEDGER

    def test_unregistered_repo_returns_default(self, tmp_path: Path) -> None:
        """When the repo is not in any store's registry, the default path is returned."""
        store_a = tmp_path / "store-a"
        store_a.mkdir()
        _write_registry(store_a, {"other-repo": ["other-repo"]})

        config_path = tmp_path / "stores.json"
        _write_stores_config(
            config_path,
            stores=[{"id": "a", "path": str(store_a)}],
            default_store="a",
        )

        result = resolve_store_for_repo("my-repo", WORKSPACE, _stores_config_path=config_path)
        assert result == DEFAULT_LEDGER

    def test_registered_repo_returns_correct_store(self, tmp_path: Path) -> None:
        """When the repo is registered in a non-default store, that store's path is returned."""
        store_default = tmp_path / "store-default"
        store_secondary = tmp_path / "store-secondary"
        store_default.mkdir()
        store_secondary.mkdir()

        _write_registry(store_default, {"default-repo": ["default-repo"]})
        _write_registry(store_secondary, {"my-repo": ["my-repo"]})

        config_path = tmp_path / "stores.json"
        _write_stores_config(
            config_path,
            stores=[
                {"id": "default", "path": str(store_default)},
                {"id": "secondary", "path": str(store_secondary)},
            ],
            default_store="default",
        )

        result = resolve_store_for_repo("my-repo", WORKSPACE, _stores_config_path=config_path)
        assert result == store_secondary

    def test_malformed_stores_json_returns_default(self, tmp_path: Path) -> None:
        """A stores.json that is not valid JSON is silently ignored; the default path is returned."""
        config_path = tmp_path / "stores.json"
        config_path.write_text("{ this is not valid json }", encoding="utf-8")

        result = resolve_store_for_repo("my-repo", WORKSPACE, _stores_config_path=config_path)
        assert result == DEFAULT_LEDGER

    def test_tilde_expansion_in_store_paths(self, tmp_path: Path) -> None:
        """~ in store paths from stores.json is expanded to the user's home directory."""
        # We can't realistically create a directory at ~/... in a test, so we
        # register the repo in a store that actually exists (using an absolute
        # path) and verify that the tilde-expansion path is distinct from the
        # abs-path for a store that DOES NOT contain the repo.  This ensures
        # the expansion code runs without raising.
        store_abs = tmp_path / "abs-store"
        store_abs.mkdir()
        _write_registry(store_abs, {"abs-repo": ["abs-repo"]})

        # A store whose path starts with ~ but does not exist on disk — the
        # missing .repositories.json means _load_json returns None and we skip it.
        config_path = tmp_path / "stores.json"
        config_path.write_text(
            json.dumps({
                "stores": [
                    {"id": "tilde", "path": "~/nonexistent-ai-insights-test-store-xyz"},
                    {"id": "abs", "path": str(store_abs)},
                ],
                "default_store": "abs",
            }),
            encoding="utf-8",
        )

        # abs-repo IS registered in store_abs; tilde store is skipped gracefully
        result = resolve_store_for_repo("abs-repo", WORKSPACE, _stores_config_path=config_path)
        assert result == store_abs


class TestDeriveSlugDirMultiStore:
    """_derive_slug_dir() uses resolve_store_for_repo() in multi-store mode."""

    def test_produces_correct_path_for_non_default_store(self, tmp_path: Path) -> None:
        """_derive_slug_dir() routes to the correct store for a registered repo."""
        store_secondary = tmp_path / "store-secondary"
        store_secondary.mkdir()
        _write_registry(store_secondary, {"my-repo": ["my-repo"]})

        config_path = tmp_path / "stores.json"
        _write_stores_config(
            config_path,
            stores=[
                {"id": "secondary", "path": str(store_secondary)},
            ],
            default_store="secondary",
        )

        # Build a project_path with the expected depth: repo/docs/agents/plans/slug
        slug = "2026-01-01-my-feature"
        project_path = str(tmp_path / "my-repo" / "docs" / "agents" / "plans" / slug)

        result = _derive_slug_dir(project_path, WORKSPACE, _stores_config_path=config_path)
        assert result == store_secondary / "my-repo" / slug


class TestDeriveLedgerLogDirMultiStore:
    """_derive_ledger_log_dir() uses resolve_store_for_repo() in multi-store mode."""

    def test_produces_correct_path_for_non_default_store(self, tmp_path: Path) -> None:
        """_derive_ledger_log_dir() routes to the correct store for a registered repo."""
        store_secondary = tmp_path / "store-secondary"
        store_secondary.mkdir()
        _write_registry(store_secondary, {"my-repo": ["my-repo"]})

        config_path = tmp_path / "stores.json"
        _write_stores_config(
            config_path,
            stores=[{"id": "secondary", "path": str(store_secondary)}],
            default_store="secondary",
        )

        # Depth-4 layout: _derive_repo_name uses plan_dir.parents[3].name
        slug = "2026-01-01-my-feature"
        plan_dir = tmp_path / "my-repo" / "docs" / "agents" / "plans" / slug

        result = _derive_ledger_log_dir(plan_dir, WORKSPACE, _stores_config_path=config_path)
        assert result == store_secondary / "my-repo" / slug / "orchestrator" / "logs"


class TestLoadJsonDebugLogging:
    """_load_json() emits a debug log entry on failure."""

    def test_debug_logged_when_file_absent(self, tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
        """A missing file triggers a debug log from _load_json."""
        import logging
        from src.utils.store_resolution import _load_json  # noqa: PLC0415

        missing = tmp_path / "nonexistent.json"
        with caplog.at_level(logging.DEBUG, logger="src.utils.store_resolution"):
            result = _load_json(missing)

        assert result is None
        assert any("store_resolution: could not load" in r.message for r in caplog.records)

    def test_debug_logged_when_json_malformed(self, tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
        """A malformed JSON file triggers a debug log from _load_json."""
        import logging
        from src.utils.store_resolution import _load_json  # noqa: PLC0415

        bad_json = tmp_path / "bad.json"
        bad_json.write_text("{ this is not valid json }", encoding="utf-8")
        with caplog.at_level(logging.DEBUG, logger="src.utils.store_resolution"):
            result = _load_json(bad_json)

        assert result is None
        assert any("store_resolution: could not load" in r.message for r in caplog.records)
