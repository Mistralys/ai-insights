"""
test_slug_dir.py — Unit tests for _derive_slug_dir() and the ledger log copy
path derivation in cli.py.

Verifies that _derive_slug_dir() constructs repository-namespaced ledger paths of
the form ``{workspace_root}/mcp-server/storage/ledger/{repo_name}/{slug}``.

Also covers the ``_derive_ledger_log_dir()`` function extracted from ``cli.py``
(``TestLedgerLogCopyPath``), which uses the same ``plan_dir.parents[3].name or "unknown"``
pattern.

Also covers ``_infer_project_root()`` (``TestInferProjectRoot``), which infers
the target project root from a plan directory using the ``parents[3]``
convention with a ``docs/agents/plans/`` sanity check.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from src.cli import _derive_ledger_log_dir, _infer_project_root
from src.nodes import _derive_slug_dir

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

WORKSPACE = Path("/workspaces/ai-insights")
LEDGER_BASE = WORKSPACE / "mcp-server" / "storage" / "ledger"


@pytest.fixture(autouse=True)
def patch_store_resolution(monkeypatch: pytest.MonkeyPatch) -> None:
    """Isolate all tests in this module from the user's ~/.ai-insights/stores.json.

    Both _derive_slug_dir() (src.nodes) and _derive_ledger_log_dir() (src.cli)
    now call resolve_store_for_repo() to support multi-store mode.  On a
    developer machine that has stores registered, that function returns a real
    store path rather than the workspace-based default, which breaks tests that
    assert on hard-coded LEDGER_BASE paths.

    This fixture patches the two imported names so that every call returns the
    default single-store path (workspace_root / "mcp-server" / "storage" /
    "ledger"), equivalent to the behaviour when no stores.json is present.
    """
    def _default(repo_name: str, workspace_root: Path, _stores_config_path: Path | None = None) -> Path:
        return workspace_root / "mcp-server" / "storage" / "ledger"

    monkeypatch.setattr("src.nodes.resolve_store_for_repo", _default)
    monkeypatch.setattr("src.cli.resolve_store_for_repo", _default)


# ---------------------------------------------------------------------------
# _derive_slug_dir() — namespaced path
# ---------------------------------------------------------------------------

class TestDeriveSlugDirNamespace:
    """_derive_slug_dir() returns a two-level namespaced path."""

    def test_returns_repo_namespaced_path(self) -> None:
        # project_path hierarchy: .../ai-insights/docs/agents/plans/<slug>
        #   parents[0] = plans/, parents[1] = agents/, parents[2] = docs/
        #   parents[3] = ai-insights/  ← repo root
        project_path = "/workspaces/ai-insights/docs/agents/plans/2026-05-27-my-feature"
        result = _derive_slug_dir(project_path, WORKSPACE)

        assert result is not None
        assert result == LEDGER_BASE / "ai-insights" / "2026-05-27-my-feature"

    def test_slug_is_last_path_segment(self) -> None:
        project_path = "/workspaces/ai-insights/docs/agents/plans/my-slug"
        result = _derive_slug_dir(project_path, WORKSPACE)

        assert result is not None
        assert result.name == "my-slug"

    def test_repo_name_is_fourth_ancestor(self) -> None:
        project_path = "/workspaces/ai-persona-builder/docs/agents/plans/some-slug"
        result = _derive_slug_dir(project_path, WORKSPACE)

        assert result is not None
        # parents[3] of the project_path is "ai-persona-builder"
        assert result.parent.name == "ai-persona-builder"

    def test_uses_pathlib_for_construction(self) -> None:
        project_path = "/workspaces/ai-insights/docs/agents/plans/2026-05-27-feature"
        result = _derive_slug_dir(project_path, WORKSPACE)

        assert isinstance(result, Path)


# ---------------------------------------------------------------------------
# _derive_slug_dir() — fallback to 'unknown'
# ---------------------------------------------------------------------------

class TestDeriveSlugDirFallback:
    """repo_name falls back to 'unknown' when the path is too short."""

    def test_path_with_three_ancestors_uses_unknown(self) -> None:
        # Only 3 ancestors: /a/b/slug → parents[0]=b, parents[1]=a, parents[2]=/ → IndexError
        project_path = "/a/b/slug"
        result = _derive_slug_dir(project_path, WORKSPACE)

        assert result is not None
        assert result == LEDGER_BASE / "unknown" / "slug"

    def test_single_segment_path_uses_unknown(self) -> None:
        project_path = "/slug-only"
        result = _derive_slug_dir(project_path, WORKSPACE)

        assert result is not None
        assert result == LEDGER_BASE / "unknown" / "slug-only"

    def test_two_segment_path_uses_unknown(self) -> None:
        project_path = "/parent/slug"
        result = _derive_slug_dir(project_path, WORKSPACE)

        assert result is not None
        assert result == LEDGER_BASE / "unknown" / "slug"


# ---------------------------------------------------------------------------
# _derive_slug_dir() — None on invalid input
# ---------------------------------------------------------------------------

class TestDeriveSlugDirInvalidInput:
    """_derive_slug_dir() returns None for falsy or degenerate inputs."""

    def test_empty_string_returns_none(self) -> None:
        assert _derive_slug_dir("", WORKSPACE) is None

    def test_root_path_returns_none(self) -> None:
        # Path("/").name == "" — empty slug
        assert _derive_slug_dir("/", WORKSPACE) is None


# ---------------------------------------------------------------------------
# Ledger log copy path derivation (_derive_ledger_log_dir from cli.py)
# ---------------------------------------------------------------------------


class TestLedgerLogCopyPath:
    """
    Parametrized tests for the ledger log copy path derivation used in cli.py.

    The derivation extracts repo_name as plan_dir.parents[3].name and falls
    back to "unknown" when the path is too shallow (IndexError) or the name
    component is empty.
    """

    # -------------------------------------------------------------------------
    # repo_name derivation — deep paths (≥4 parent components)
    # -------------------------------------------------------------------------

    @pytest.mark.parametrize("plan_dir_str, expected_repo", [
        (
            "/workspaces/ai-insights/docs/agents/plans/2026-05-27-my-feature",
            "ai-insights",
        ),
        (
            "/workspaces/ai-persona-builder/docs/agents/plans/2026-01-01-rework",
            "ai-persona-builder",
        ),
        (
            "/home/user/repos/my-project/docs/agents/plans/2026-03-15-feature-x",
            "my-project",
        ),
    ])
    def test_repo_name_is_fourth_ancestor(
        self, plan_dir_str: str, expected_repo: str
    ) -> None:
        """repo_name equals plan_dir.parents[3].name for paths with ≥4 parents."""
        plan_dir = Path(plan_dir_str)
        result = _derive_ledger_log_dir(plan_dir, WORKSPACE)
        # The repo_name segment sits right after "ledger/" in the path.
        ledger_base = WORKSPACE / "mcp-server" / "storage" / "ledger"
        repo_segment = result.relative_to(ledger_base).parts[0]
        assert repo_segment == expected_repo

    # -------------------------------------------------------------------------
    # repo_name derivation — shallow paths (<4 parent components → "unknown")
    # -------------------------------------------------------------------------

    @pytest.mark.parametrize("plan_dir_str", [
        "/a/b/slug",          # parents: [b, a, /]         — 3 parents, IndexError
        "/parent/slug",       # parents: [parent, /]        — 2 parents, IndexError
        "/slug-only",         # parents: [/]                — 1 parent, IndexError
    ])
    def test_repo_name_falls_back_to_unknown_for_shallow_path(
        self, plan_dir_str: str
    ) -> None:
        """repo_name is 'unknown' when plan_dir has fewer than 4 parent components."""
        plan_dir = Path(plan_dir_str)
        result = _derive_ledger_log_dir(plan_dir, WORKSPACE)
        ledger_base = WORKSPACE / "mcp-server" / "storage" / "ledger"
        repo_segment = result.relative_to(ledger_base).parts[0]
        assert repo_segment == "unknown"

    # -------------------------------------------------------------------------
    # Full ledger_log_dir shape — orchestrator/logs suffix
    # -------------------------------------------------------------------------

    def test_full_path_shape_deep(self) -> None:
        """
        For a deep path the full ledger_log_dir ends with
        …/ledger/{repo}/{slug}/orchestrator/logs.
        """
        plan_dir = Path(
            "/workspaces/ai-insights/docs/agents/plans/2026-05-27-my-feature"
        )
        result = _derive_ledger_log_dir(plan_dir, WORKSPACE)

        expected = (
            WORKSPACE
            / "mcp-server"
            / "storage"
            / "ledger"
            / "ai-insights"
            / "2026-05-27-my-feature"
            / "orchestrator"
            / "logs"
        )
        assert result == expected

    def test_full_path_shape_shallow_fallback(self) -> None:
        """
        For a shallow path the full ledger_log_dir ends with
        …/ledger/unknown/{slug}/orchestrator/logs.
        """
        plan_dir = Path("/a/b/my-slug")
        result = _derive_ledger_log_dir(plan_dir, WORKSPACE)

        expected = (
            WORKSPACE
            / "mcp-server"
            / "storage"
            / "ledger"
            / "unknown"
            / "my-slug"
            / "orchestrator"
            / "logs"
        )
        assert result == expected

    def test_path_ends_with_orchestrator_logs(self) -> None:
        """The last two segments are always 'orchestrator/logs'."""
        plan_dir = Path(
            "/workspaces/ai-insights/docs/agents/plans/2026-05-27-my-feature"
        )
        result = _derive_ledger_log_dir(plan_dir, WORKSPACE)
        assert result.parts[-1] == "logs"
        assert result.parts[-2] == "orchestrator"

# ---------------------------------------------------------------------------
# _infer_project_root() — project root inference from plan path
# ---------------------------------------------------------------------------


class TestInferProjectRoot:
    """
    Unit tests for _infer_project_root().

    Uses ``tmp_path`` fixtures so the ``is_dir()`` sanity check has a real
    filesystem to probe.
    """

    def test_standard_plan_path_returns_inferred_root(self, tmp_path: Path) -> None:
        """Returns the inferred project root when docs/agents/plans/ exists."""
        # Build:  <tmp_path>/docs/agents/plans/<slug>
        slug_dir = tmp_path / "docs" / "agents" / "plans" / "2026-07-04-my-feature"
        slug_dir.mkdir(parents=True)
        result = _infer_project_root(slug_dir)
        assert result == tmp_path

    def test_sanity_check_fails_returns_none(self, tmp_path: Path) -> None:
        """Returns None when docs/agents/plans/ does NOT exist at the inferred root."""
        # Build a plan path at the right depth but without the sanity-check dir.
        slug_dir = tmp_path / "some" / "other" / "path" / "my-slug"
        slug_dir.mkdir(parents=True)
        # tmp_path/docs/agents/plans/ does NOT exist.
        result = _infer_project_root(slug_dir)
        assert result is None

    def test_shallow_path_returns_none(self, tmp_path: Path) -> None:
        """Returns None when the plan directory has fewer than 4 ancestors."""
        # Only 3 ancestors: tmp_path / a / b / slug → parents[3] raises IndexError.
        slug_dir = tmp_path / "a" / "b" / "slug"
        slug_dir.mkdir(parents=True)
        result = _infer_project_root(slug_dir)
        assert result is None

    def test_same_project_returns_workspace_root(self, tmp_path: Path) -> None:
        """Same-project plans: inferred root equals the workspace root."""
        # tmp_path acts as the workspace root.
        slug_dir = tmp_path / "docs" / "agents" / "plans" / "2026-07-04-same-project"
        slug_dir.mkdir(parents=True)
        result = _infer_project_root(slug_dir)
        assert result == tmp_path