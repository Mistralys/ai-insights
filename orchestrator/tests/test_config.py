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
    "ANTHROPIC_API_KEY": "sk-test",
}


def _load(extra_env: dict | None = None):
    """Call load_config() with a clean environment plus *extra_env* overrides."""
    env = {**_BASE_ENV, **(extra_env or {})}
    # Remove CAPTURE_DIALOGUES from the base environment so tests start clean.
    # Setting to empty string means "use default" (True).
    env.setdefault("CAPTURE_DIALOGUES", "false")
    with patch.dict(os.environ, env, clear=True):
        return load_config()


class TestCaptureDialogues:
    """Tests for Config.capture_dialogues and CAPTURE_DIALOGUES env var parsing."""

    # ------------------------------------------------------------------
    # Default / truthy values (capture_dialogues defaults to True)
    # ------------------------------------------------------------------

    def test_default_is_true_when_env_var_unset(self):
        """capture_dialogues defaults to True when CAPTURE_DIALOGUES is absent."""
        env = {**_BASE_ENV}
        with patch.dict(os.environ, env, clear=True):
            cfg = load_config()
        assert cfg.capture_dialogues is True
    def test_true_when_env_var_is_empty_string(self):
        assert _load({"CAPTURE_DIALOGUES": ""}).capture_dialogues is True

    def test_true_when_env_var_is_arbitrary_value(self):
        assert _load({"CAPTURE_DIALOGUES": "maybe"}).capture_dialogues is True

    # ------------------------------------------------------------------
    # Explicit falsy values
    # ------------------------------------------------------------------

    def test_false_when_env_var_is_false(self):
        assert _load({"CAPTURE_DIALOGUES": "false"}).capture_dialogues is False

    def test_false_when_env_var_is_zero(self):
        assert _load({"CAPTURE_DIALOGUES": "0"}).capture_dialogues is False

    def test_false_when_env_var_is_no(self):
        assert _load({"CAPTURE_DIALOGUES": "no"}).capture_dialogues is False

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


# ---------------------------------------------------------------------------
# Tests: Config.stage_models and Config.resolve_model_for_stage
# ---------------------------------------------------------------------------

class TestStageModels:
    """Tests for Config.stage_models populated from persona metadata."""

    def test_stage_models_is_dict(self):
        cfg = _load()
        assert isinstance(cfg.stage_models, dict)

    def test_stage_models_non_empty(self):
        cfg = _load()
        assert len(cfg.stage_models) > 0

    def test_stage_models_contains_developer(self):
        cfg = _load()
        assert "developer" in cfg.stage_models

    def test_stage_models_contains_planner(self):
        cfg = _load()
        assert "planner" in cfg.stage_models

    def test_stage_models_contains_all_nine_stages(self):
        """All 9 non-orchestrating stages must have a model slug."""
        cfg = _load()
        # Non-orchestrating stages from the manifest (planner and synthesis are
        # orchestrating but still present in stage_models from persona metadata).
        expected = {
            "planner", "pm", "developer", "qa", "security_auditor",
            "reviewer", "release_engineer", "docs", "synthesis",
        }
        assert expected.issubset(cfg.stage_models.keys()), (
            f"Missing stages: {expected - cfg.stage_models.keys()}"
        )

    def test_stage_models_values_are_strings(self):
        cfg = _load()
        for stage, slug in cfg.stage_models.items():
            assert isinstance(slug, str), f"stage_models[{stage!r}] must be a str"
            assert slug, f"stage_models[{stage!r}] must not be empty"

    def test_planner_has_opus_slug(self):
        """Planner has a model_slug override in persona metadata."""
        cfg = _load()
        assert cfg.stage_models["planner"] == "claude-opus-4-6"

    def test_pm_has_opus_slug(self):
        """Project Manager has a model_slug override in persona metadata."""
        cfg = _load()
        assert cfg.stage_models["pm"] == "claude-opus-4-6"

    def test_developer_has_default_slug(self):
        """Developer inherits default_model_slug."""
        cfg = _load()
        assert cfg.stage_models["developer"] == "claude-sonnet-4-6"


class TestResolveModelForStage:
    """Tests for Config.resolve_model_for_stage()."""

    def test_returns_correct_slug_for_known_stage(self):
        cfg = _load()
        slug = cfg.resolve_model_for_stage("developer")
        assert slug == cfg.stage_models["developer"]

    def test_returns_correct_slug_for_planner(self):
        cfg = _load()
        assert cfg.resolve_model_for_stage("planner") == "claude-opus-4-6"

    def test_raises_key_error_for_unknown_stage(self):
        cfg = _load()
        with pytest.raises(KeyError):
            cfg.resolve_model_for_stage("nonexistent_stage")


class TestApiKeyValidation:
    """Tests for per-model API key presence validation in load_config()."""

    def test_raises_when_no_api_keys_set(self):
        """load_config() must raise OSError when no API keys are present."""
        with patch.dict(os.environ, {"CAPTURE_DIALOGUES": "false"}, clear=True):
            with pytest.raises(OSError):
                load_config()

    def test_passes_with_anthropic_key_only(self):
        """load_config() succeeds when all stages use Anthropic and key is set."""
        cfg = _load()
        assert cfg.stage_models  # populated successfully

    def test_missing_google_key_when_google_slug_used(self):
        """OSError raised when a Google model slug is used but GOOGLE_API_KEY is absent."""
        from unittest.mock import patch as _patch

        fake_stage_models = {
            "planner": "claude-opus-4-6", "pm": "claude-opus-4-6",
            "developer": "gemini-2.5-pro", "qa": "claude-sonnet-4-6",
            "security_auditor": "claude-sonnet-4-6", "reviewer": "claude-sonnet-4-6",
            "release_engineer": "claude-sonnet-4-6", "docs": "claude-sonnet-4-6",
            "synthesis": "claude-sonnet-4-6",
        }
        with _patch(
            "src.utils.persona_models.extract_persona_model_slugs",
            return_value=fake_stage_models,
        ):
            env = {"ANTHROPIC_API_KEY": "sk-test", "CAPTURE_DIALOGUES": "false"}
            with patch.dict(os.environ, env, clear=True):
                with pytest.raises(OSError, match="GOOGLE_API_KEY"):
                    load_config()

    def test_model_name_env_var_is_ignored(self):
        """MODEL_NAME in the environment must not cause a crash or affect stage_models."""
        env = {**_BASE_ENV, "MODEL_NAME": "some-old-model", "CAPTURE_DIALOGUES": "false"}
        with patch.dict(os.environ, env, clear=True):
            cfg = load_config()
        # stage_models must be populated from persona metadata, not MODEL_NAME.
        assert cfg.stage_models
        # developer should still have the persona-metadata slug.
        assert cfg.stage_models.get("developer") == "claude-sonnet-4-6"

    def test_raises_when_stage_models_incomplete(self):
        """load_config() must raise OSError when persona YAML files are missing."""
        from unittest.mock import patch as _patch

        # Only 2 of 9 stages — the count guard must fire.
        partial_models = {"planner": "claude-opus-4-6", "developer": "claude-sonnet-4-6"}
        with _patch(
            "src.utils.persona_models.extract_persona_model_slugs",
            return_value=partial_models,
        ):
            env = {"ANTHROPIC_API_KEY": "sk-test", "CAPTURE_DIALOGUES": "false"}
            with patch.dict(os.environ, env, clear=True):
                with pytest.raises(OSError, match="Expected 9 stage model slugs"):
                    load_config()


# ---------------------------------------------------------------------------
# Tests: Config.stream_max_retries and Config.stream_retry_base_delay_s
# ---------------------------------------------------------------------------


class TestStreamRetryConfig:
    """Tests for stream retry configuration fields and env-var parsing (WP-003)."""

    # ------------------------------------------------------------------
    # AC-1: correct defaults
    # ------------------------------------------------------------------

    def test_stream_max_retries_default(self):
        """stream_max_retries defaults to 2 when STREAM_MAX_RETRIES is unset."""
        cfg = _load()
        assert cfg.stream_max_retries == 2

    def test_stream_retry_base_delay_default(self):
        """stream_retry_base_delay_s defaults to 10.0 when STREAM_RETRY_BASE_DELAY_S is unset."""
        cfg = _load()
        assert cfg.stream_retry_base_delay_s == 10.0

    def test_stream_max_retries_is_int(self):
        cfg = _load()
        assert isinstance(cfg.stream_max_retries, int)

    def test_stream_retry_base_delay_is_float(self):
        cfg = _load()
        assert isinstance(cfg.stream_retry_base_delay_s, float)

    # ------------------------------------------------------------------
    # AC-2: env vars are parsed correctly
    # ------------------------------------------------------------------

    def test_stream_max_retries_env_var(self):
        cfg = _load({"STREAM_MAX_RETRIES": "5"})
        assert cfg.stream_max_retries == 5

    def test_stream_max_retries_zero_disables_retry(self):
        cfg = _load({"STREAM_MAX_RETRIES": "0"})
        assert cfg.stream_max_retries == 0

    def test_stream_retry_base_delay_env_var(self):
        cfg = _load({"STREAM_RETRY_BASE_DELAY_S": "30.0"})
        assert cfg.stream_retry_base_delay_s == 30.0

    def test_stream_retry_base_delay_integer_string(self):
        """An integer string like "20" must be accepted as a valid float."""
        cfg = _load({"STREAM_RETRY_BASE_DELAY_S": "20"})
        assert cfg.stream_retry_base_delay_s == 20.0

    # ------------------------------------------------------------------
    # AC-3: missing or non-numeric values fall back to defaults
    # ------------------------------------------------------------------

    def test_stream_max_retries_non_numeric_falls_back(self):
        cfg = _load({"STREAM_MAX_RETRIES": "not-a-number"})
        assert cfg.stream_max_retries == 2

    def test_stream_max_retries_empty_string_falls_back(self):
        cfg = _load({"STREAM_MAX_RETRIES": ""})
        assert cfg.stream_max_retries == 2

    def test_stream_retry_base_delay_non_numeric_falls_back(self):
        cfg = _load({"STREAM_RETRY_BASE_DELAY_S": "not-a-number"})
        assert cfg.stream_retry_base_delay_s == 10.0

    def test_stream_retry_base_delay_empty_string_falls_back(self):
        cfg = _load({"STREAM_RETRY_BASE_DELAY_S": ""})
        assert cfg.stream_retry_base_delay_s == 10.0

    def test_stream_max_retries_negative_falls_back(self):
        """Negative value is invalid; must fall back to the default."""
        cfg = _load({"STREAM_MAX_RETRIES": "-1"})
        assert cfg.stream_max_retries == 2

    def test_stream_retry_base_delay_negative_falls_back(self):
        """Negative delay is invalid; must fall back to the default."""
        cfg = _load({"STREAM_RETRY_BASE_DELAY_S": "-5.0"})
        assert cfg.stream_retry_base_delay_s == 10.0

