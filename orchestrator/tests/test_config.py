"""Snapshot tests for manifest-derived constants in orchestrator/src/config.py.

Catches silent regressions when manifest field names change or the derivation
logic is accidentally broken.  Tests assert structural properties (type,
non-emptiness, key membership) rather than exact exhaustive values, so they
remain valid if the manifest gains new roles or pipeline types in the future.
"""

from __future__ import annotations

import os
from pathlib import Path
from unittest.mock import patch

import pytest

from src.config import (
    FAIL_ROUTING_AGENT_MAP,
    PERSONA_FILES,
    PIPELINE_AGENT_MAP,
    PIPELINE_ROLE_NAMES,
    PIPELINE_TYPES,
    ROLE_IDS,
    VALID_STAGES,
    WP_TERMINAL_STATUSES,
    load_config,
)


class TestWPTerminalStatuses:
    def test_is_frozenset(self):
        assert isinstance(WP_TERMINAL_STATUSES, frozenset)

    def test_non_empty(self):
        assert len(WP_TERMINAL_STATUSES) > 0

    def test_contains_complete(self):
        assert "COMPLETE" in WP_TERMINAL_STATUSES

    def test_contains_cancelled(self):
        assert "CANCELLED" in WP_TERMINAL_STATUSES


class TestValidStages:
    def test_is_frozenset(self):
        assert isinstance(VALID_STAGES, frozenset)

    def test_non_empty(self):
        assert len(VALID_STAGES) > 0

    def test_contains_developer(self):
        assert "developer" in VALID_STAGES

    def test_contains_qa(self):
        assert "qa" in VALID_STAGES

    def test_contains_reviewer(self):
        assert "reviewer" in VALID_STAGES

    def test_does_not_contain_planner(self):
        # planner is orchestrating and must be excluded
        assert "planner" not in VALID_STAGES

    def test_does_not_contain_synthesis(self):
        # synthesis is orchestrating and must be excluded
        assert "synthesis" not in VALID_STAGES


class TestPipelineTypes:
    def test_is_tuple(self):
        assert isinstance(PIPELINE_TYPES, tuple)

    def test_non_empty(self):
        assert len(PIPELINE_TYPES) > 0

    def test_contains_implementation(self):
        assert "implementation" in PIPELINE_TYPES

    def test_contains_qa(self):
        assert "qa" in PIPELINE_TYPES

    def test_contains_documentation(self):
        assert "documentation" in PIPELINE_TYPES

    def test_implementation_is_first(self):
        assert PIPELINE_TYPES[0] == "implementation"

    def test_documentation_is_last(self):
        assert PIPELINE_TYPES[-1] == "documentation"


class TestRoleIDs:
    def test_is_dict(self):
        assert isinstance(ROLE_IDS, dict)

    def test_non_empty(self):
        assert len(ROLE_IDS) > 0

    def test_developer_maps_to_developer_id(self):
        assert ROLE_IDS.get("Developer") == "developer"

    def test_qa_maps_to_qa_id(self):
        assert ROLE_IDS.get("QA") == "qa"

    def test_release_engineer_maps_to_correct_id(self):
        assert ROLE_IDS.get("Release Engineer") == "release_engineer"


class TestPipelineRoleNames:
    def test_is_list(self):
        assert isinstance(PIPELINE_ROLE_NAMES, list)

    def test_non_empty(self):
        assert len(PIPELINE_ROLE_NAMES) > 0

    def test_contains_developer(self):
        assert "Developer" in PIPELINE_ROLE_NAMES

    def test_contains_documentation(self):
        assert "Documentation" in PIPELINE_ROLE_NAMES

    def test_does_not_contain_planner(self):
        # planner is orchestrating — excluded by the derivation filter
        assert "Planner" not in PIPELINE_ROLE_NAMES

    def test_does_not_contain_synthesis(self):
        assert "Synthesis" not in PIPELINE_ROLE_NAMES


class TestPipelineAgentMap:
    def test_is_dict(self):
        assert isinstance(PIPELINE_AGENT_MAP, dict)

    def test_non_empty(self):
        assert len(PIPELINE_AGENT_MAP) > 0

    def test_all_pipeline_types_are_keys(self):
        """Every pipeline type must have an owning agent in PIPELINE_AGENT_MAP."""
        for ptype in PIPELINE_TYPES:
            assert ptype in PIPELINE_AGENT_MAP, (
                f"Pipeline type {ptype!r} is missing from PIPELINE_AGENT_MAP"
            )

    def test_all_values_are_valid_role_names(self):
        """All owning agent entries must be valid non-orchestrating role names."""
        for ptype, role_name in PIPELINE_AGENT_MAP.items():
            assert role_name in PIPELINE_ROLE_NAMES, (
                f"PIPELINE_AGENT_MAP[{ptype!r}] = {role_name!r} is not in "
                f"PIPELINE_ROLE_NAMES"
            )

    def test_implementation_maps_to_developer(self):
        assert PIPELINE_AGENT_MAP["implementation"] == "Developer"

    def test_release_engineering_maps_to_release_engineer(self):
        assert PIPELINE_AGENT_MAP["release-engineering"] == "Release Engineer"


class TestFailRoutingAgentMap:
    def test_is_dict(self):
        assert isinstance(FAIL_ROUTING_AGENT_MAP, dict)

    def test_non_empty(self):
        assert len(FAIL_ROUTING_AGENT_MAP) > 0

    def test_all_pipeline_types_are_keys(self):
        """Every pipeline type must have a FAIL-routing target."""
        for ptype in PIPELINE_TYPES:
            assert ptype in FAIL_ROUTING_AGENT_MAP, (
                f"Pipeline type {ptype!r} is missing from FAIL_ROUTING_AGENT_MAP"
            )

    def test_all_values_are_valid_role_names(self):
        """All FAIL-routing targets must be valid non-orchestrating role names."""
        for ptype, role_name in FAIL_ROUTING_AGENT_MAP.items():
            assert role_name in PIPELINE_ROLE_NAMES, (
                f"FAIL_ROUTING_AGENT_MAP[{ptype!r}] = {role_name!r} is not in "
                f"PIPELINE_ROLE_NAMES"
            )

    def test_release_engineering_routes_to_release_engineer(self):
        """Non-obvious mapping: release-engineering FAIL → Release Engineer."""
        assert FAIL_ROUTING_AGENT_MAP["release-engineering"] == "Release Engineer"

    def test_documentation_routes_to_documentation(self):
        """Non-obvious mapping: documentation FAIL → Documentation."""
        assert FAIL_ROUTING_AGENT_MAP["documentation"] == "Documentation"


class TestPersonaFilesExist:
    """Validate that every persona_file entry in the manifest points to an
    actual file on disk.  This catches stale paths whenever the persona build
    system renames its output files."""

    # Workspace root is two levels above the orchestrator package.
    _WORKSPACE_ROOT = Path(__file__).resolve().parents[2]

    def test_persona_files_is_dict(self):
        assert isinstance(PERSONA_FILES, dict)

    def test_persona_files_non_empty(self):
        assert len(PERSONA_FILES) > 0

    @pytest.mark.parametrize("stage,relative_path", list(PERSONA_FILES.items()))
    def test_persona_file_exists(self, stage: str, relative_path: str):
        """Every stage's persona file must exist on the local filesystem."""
        full_path = self._WORKSPACE_ROOT / relative_path
        assert full_path.exists(), (
            f"Persona file for stage {stage!r} not found at: {full_path}\n"
            f"  Manifest says: {relative_path}\n"
            f"  Check shared/workflow-manifest.json persona_file entries."
        )


# ---------------------------------------------------------------------------
# Helpers shared by TestCaptureDialogues
# ---------------------------------------------------------------------------

# Minimum valid env required by load_config() so we can isolate the flag.
_BASE_ENV = {
    "MODEL_NAME": "claude-test",
    "ANTHROPIC_API_KEY": "sk-test",
}


def _load(extra_env: dict | None = None) -> "Config":  # noqa: F821 – forward ref ok
    """Call load_config() with a clean environment plus *extra_env* overrides."""
    env = {**_BASE_ENV, **(extra_env or {})}
    # Remove CAPTURE_DIALOGUES from the base environment so tests start clean.
    env.setdefault("CAPTURE_DIALOGUES", "")
    with patch.dict(os.environ, env, clear=True):
        return load_config()


class TestCaptureDialogues:
    """Tests for Config.capture_dialogues and CAPTURE_DIALOGUES env var parsing."""

    # ------------------------------------------------------------------
    # Default / falsy values
    # ------------------------------------------------------------------

    def test_default_is_false_when_env_var_unset(self):
        """capture_dialogues defaults to False when CAPTURE_DIALOGUES is absent."""
        env = {**_BASE_ENV}
        with patch.dict(os.environ, env, clear=True):
            cfg = load_config()
        assert cfg.capture_dialogues is False

    def test_false_when_env_var_is_empty_string(self):
        assert _load({"CAPTURE_DIALOGUES": ""}).capture_dialogues is False

    def test_false_when_env_var_is_false(self):
        assert _load({"CAPTURE_DIALOGUES": "false"}).capture_dialogues is False

    def test_false_when_env_var_is_zero(self):
        assert _load({"CAPTURE_DIALOGUES": "0"}).capture_dialogues is False

    def test_false_when_env_var_is_no(self):
        assert _load({"CAPTURE_DIALOGUES": "no"}).capture_dialogues is False

    def test_false_when_env_var_is_arbitrary_value(self):
        assert _load({"CAPTURE_DIALOGUES": "maybe"}).capture_dialogues is False

    # ------------------------------------------------------------------
    # Truthy values
    # ------------------------------------------------------------------

    def test_true_when_env_var_is_lowercase_true(self):
        assert _load({"CAPTURE_DIALOGUES": "true"}).capture_dialogues is True

    def test_true_when_env_var_is_titlecase_True(self):
        assert _load({"CAPTURE_DIALOGUES": "True"}).capture_dialogues is True

    def test_true_when_env_var_is_uppercase_TRUE(self):
        assert _load({"CAPTURE_DIALOGUES": "TRUE"}).capture_dialogues is True

    def test_true_when_env_var_is_one(self):
        assert _load({"CAPTURE_DIALOGUES": "1"}).capture_dialogues is True

    def test_true_when_env_var_is_yes(self):
        assert _load({"CAPTURE_DIALOGUES": "yes"}).capture_dialogues is True

    def test_true_when_env_var_is_YES(self):
        assert _load({"CAPTURE_DIALOGUES": "YES"}).capture_dialogues is True

    # ------------------------------------------------------------------
    # Type check
    # ------------------------------------------------------------------

    def test_field_is_bool_type(self):
        """capture_dialogues must be a plain Python bool, not a truthy string."""
        cfg = _load({"CAPTURE_DIALOGUES": "true"})
        assert isinstance(cfg.capture_dialogues, bool)

    def test_field_is_bool_type_when_false(self):
        cfg = _load()
        assert isinstance(cfg.capture_dialogues, bool)
