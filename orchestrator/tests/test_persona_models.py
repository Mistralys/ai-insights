"""
tests/test_persona_models.py — Tests for utils/persona_models.

Covers:
- extract_persona_model_slugs() returns {stage: model_slug} for all 9 roles
- Per-persona model_slug overrides default_model_slug
- Missing metadata directory raises OSError
- Inline YAML comments are stripped correctly
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from src.utils.persona_models import (
    _extract_yaml_scalar,
    _strip_inline_comment,
    extract_persona_model_slugs,
)

# Workspace root: two levels above orchestrator/tests/.
_WORKSPACE_ROOT = Path(__file__).resolve().parents[2]

# -------------------------------------------------------------------
# Minimal manifest used in unit-test fixtures (3 roles for brevity).
# -------------------------------------------------------------------
_FIXTURE_MANIFEST = {
    "roles": [
        {"id": "planner", "number": 1, "name": "Planner"},
        {"id": "developer", "number": 2, "name": "Developer"},
        {"id": "synthesis", "number": 3, "name": "Synthesis"},
    ]
}


# ---------------------------------------------------------------------------
# Fixture helpers
# ---------------------------------------------------------------------------

def _build_workspace(
    tmp_path: Path,
    personas: list[tuple[int, str | None]],
    *,
    default_slug: str = "claude-sonnet-4-6",
    manifest: dict | None = None,
) -> Path:
    """Create a minimal workspace tree under *tmp_path*.

    *personas* is a list of ``(number, model_slug_or_None)`` tuples.
    One YAML file named ``{number}-persona.yaml`` is created per entry.
    When *model_slug* is ``None`` the persona YAML has no ``model_slug``
    field, mirroring a persona that inherits the default.
    """
    meta_dir = tmp_path / "personas" / "ledger" / "src" / "meta"
    meta_dir.mkdir(parents=True)
    shared_dir = tmp_path / "shared"
    shared_dir.mkdir()

    (meta_dir / "_shared.yaml").write_text(
        f'default_model_slug: "{default_slug}"\n',
        encoding="utf-8",
    )

    m = manifest if manifest is not None else _FIXTURE_MANIFEST
    (shared_dir / "workflow-manifest.json").write_text(
        json.dumps(m),
        encoding="utf-8",
    )

    for number, model_slug in personas:
        lines = [f"number: {number}\n"]
        if model_slug is not None:
            lines.append(f'model_slug: "{model_slug}"\n')
        (meta_dir / f"{number}-persona.yaml").write_text(
            "".join(lines),
            encoding="utf-8",
        )

    return tmp_path


# ---------------------------------------------------------------------------
# Unit tests — internal helpers
# ---------------------------------------------------------------------------

class TestStripInlineComment:
    def test_no_comment_unchanged(self):
        assert _strip_inline_comment('"claude-sonnet-4-6"') == '"claude-sonnet-4-6"'

    def test_comment_after_quoted_value_stripped(self):
        raw = '"claude-sonnet-4-6"  # API-compatible slug'
        assert _strip_inline_comment(raw) == '"claude-sonnet-4-6"'

    def test_hash_inside_double_quotes_not_stripped(self):
        raw = '"model#name"'
        assert _strip_inline_comment(raw) == '"model#name"'

    def test_hash_inside_single_quotes_not_stripped(self):
        raw = "'model#name'"
        assert _strip_inline_comment(raw) == "'model#name'"

    def test_unquoted_value_with_comment(self):
        raw = "3  # number"
        assert _strip_inline_comment(raw) == "3"

    def test_empty_string(self):
        assert _strip_inline_comment("") == ""


class TestExtractYamlScalar:
    def test_double_quoted_value(self):
        text = 'default_model_slug: "claude-sonnet-4-6"\n'
        assert _extract_yaml_scalar(text, "default_model_slug") == "claude-sonnet-4-6"

    def test_single_quoted_value(self):
        text = "model_slug: 'claude-opus-4-6'\n"
        assert _extract_yaml_scalar(text, "model_slug") == "claude-opus-4-6"

    def test_unquoted_integer(self):
        text = "number: 3\n"
        assert _extract_yaml_scalar(text, "number") == "3"

    def test_missing_key_returns_none(self):
        text = "role: Developer\n"
        assert _extract_yaml_scalar(text, "model_slug") is None

    def test_inline_comment_stripped(self):
        text = 'default_model_slug: "claude-sonnet-4-6"  # some comment\n'
        assert _extract_yaml_scalar(text, "default_model_slug") == "claude-sonnet-4-6"

    def test_comment_lines_skipped(self):
        text = "# model_slug: should-be-ignored\nmodel_slug: \"target\"\n"
        assert _extract_yaml_scalar(text, "model_slug") == "target"

    def test_first_match_returned(self):
        text = 'key: "first"\nkey: "second"\n'
        assert _extract_yaml_scalar(text, "key") == "first"


# ---------------------------------------------------------------------------
# Unit tests — extract_persona_model_slugs (tmp_path fixtures)
# ---------------------------------------------------------------------------

class TestExtractPersonaModelSlugs:
    def test_returns_dict(self, tmp_path):
        ws = _build_workspace(tmp_path, [(1, None), (2, None), (3, None)])
        result = extract_persona_model_slugs(ws)
        assert isinstance(result, dict)

    def test_all_fixture_stages_present(self, tmp_path):
        """Result contains exactly the stage IDs from the fixture manifest."""
        ws = _build_workspace(tmp_path, [(1, None), (2, None), (3, None)])
        result = extract_persona_model_slugs(ws)
        assert set(result.keys()) == {"planner", "developer", "synthesis"}

    def test_default_slug_used_when_no_override(self, tmp_path):
        """A persona without model_slug falls back to default_model_slug."""
        ws = _build_workspace(
            tmp_path,
            [(1, None), (2, None), (3, None)],
            default_slug="claude-sonnet-4-6",
        )
        result = extract_persona_model_slugs(ws)
        assert result["developer"] == "claude-sonnet-4-6"
        assert result["synthesis"] == "claude-sonnet-4-6"

    def test_per_persona_override_takes_precedence(self, tmp_path):
        """A persona with model_slug uses it instead of the default."""
        ws = _build_workspace(
            tmp_path,
            [(1, "claude-opus-4-6"), (2, None), (3, None)],
            default_slug="claude-sonnet-4-6",
        )
        result = extract_persona_model_slugs(ws)
        assert result["planner"] == "claude-opus-4-6"

    def test_override_does_not_bleed_into_other_stages(self, tmp_path):
        """An override for one stage does not affect sibling stages."""
        ws = _build_workspace(
            tmp_path,
            [(1, "claude-opus-4-6"), (2, None), (3, "claude-opus-4-6")],
            default_slug="claude-sonnet-4-6",
        )
        result = extract_persona_model_slugs(ws)
        assert result["planner"] == "claude-opus-4-6"
        assert result["developer"] == "claude-sonnet-4-6"
        assert result["synthesis"] == "claude-opus-4-6"

    def test_all_values_are_non_empty_strings(self, tmp_path):
        ws = _build_workspace(
            tmp_path,
            [(1, "claude-opus-4-6"), (2, None), (3, None)],
        )
        result = extract_persona_model_slugs(ws)
        for stage, slug in result.items():
            assert isinstance(slug, str), f"Stage {stage!r}: expected str, got {type(slug)}"
            assert slug, f"Stage {stage!r}: slug is empty"

    def test_missing_meta_dir_raises_os_error(self, tmp_path):
        """OSError is raised when the persona metadata directory is absent."""
        (tmp_path / "shared").mkdir()
        (tmp_path / "shared" / "workflow-manifest.json").write_text(
            json.dumps(_FIXTURE_MANIFEST),
            encoding="utf-8",
        )
        # No personas/ledger/src/meta/ directory created.
        with pytest.raises(OSError, match="Persona metadata directory not found"):
            extract_persona_model_slugs(tmp_path)

    def test_inline_comment_in_shared_yaml_does_not_corrupt_value(self, tmp_path):
        """Inline comment in _shared.yaml (as in the real file) is ignored."""
        meta_dir = tmp_path / "personas" / "ledger" / "src" / "meta"
        meta_dir.mkdir(parents=True)
        shared_dir = tmp_path / "shared"
        shared_dir.mkdir()
        # Mirrors the real _shared.yaml comment style.
        (meta_dir / "_shared.yaml").write_text(
            'default_model_slug: "claude-sonnet-4-6"  '
            "# API-compatible slug; override per-persona via `model_slug:` field\n",
            encoding="utf-8",
        )
        (shared_dir / "workflow-manifest.json").write_text(
            json.dumps(_FIXTURE_MANIFEST),
            encoding="utf-8",
        )
        (meta_dir / "1-persona.yaml").write_text("number: 1\n", encoding="utf-8")
        result = extract_persona_model_slugs(tmp_path)
        assert result["planner"] == "claude-sonnet-4-6"

    def test_accepts_path_string(self, tmp_path):
        """workspace_root may be passed as a str, not only a Path."""
        ws = _build_workspace(tmp_path, [(1, None)])
        result = extract_persona_model_slugs(str(ws))
        assert "planner" in result


# ---------------------------------------------------------------------------
# Integration tests — real workspace files
# ---------------------------------------------------------------------------

class TestRealWorkspace:
    """Validate against the committed persona metadata in the repository."""

    def test_all_nine_stages_present(self):
        """The real metadata produces exactly the 9 roles from the manifest."""
        result = extract_persona_model_slugs(_WORKSPACE_ROOT)
        expected = {
            "planner",
            "pm",
            "developer",
            "qa",
            "security_auditor",
            "reviewer",
            "release_engineer",
            "docs",
            "synthesis",
        }
        assert set(result.keys()) == expected

    def test_planner_uses_opus_slug(self):
        """1-planner.yaml carries model_slug: claude-opus-4-6 (set by WP-001)."""
        result = extract_persona_model_slugs(_WORKSPACE_ROOT)
        assert result["planner"] == "claude-opus-4-6"

    def test_pm_uses_opus_slug(self):
        """2-project-manager.yaml carries model_slug: claude-opus-4-6 (set by WP-001)."""
        result = extract_persona_model_slugs(_WORKSPACE_ROOT)
        assert result["pm"] == "claude-opus-4-6"

    def test_remaining_stages_use_default_sonnet_slug(self):
        """Stages without an explicit model_slug fall back to claude-sonnet-4-6."""
        result = extract_persona_model_slugs(_WORKSPACE_ROOT)
        default_stages = (
            "developer",
            "qa",
            "security_auditor",
            "reviewer",
            "release_engineer",
            "docs",
            "synthesis",
        )
        for stage in default_stages:
            assert result[stage] == "claude-sonnet-4-6", (
                f"Stage {stage!r}: expected 'claude-sonnet-4-6', got {result[stage]!r}"
            )

    def test_all_slugs_are_non_empty_strings(self):
        result = extract_persona_model_slugs(_WORKSPACE_ROOT)
        for stage, slug in result.items():
            assert isinstance(slug, str) and slug, (
                f"Stage {stage!r} has invalid slug: {slug!r}"
            )
