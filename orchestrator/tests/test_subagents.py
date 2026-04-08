"""Unit tests for orchestrator/src/utils/subagents.py.

Covers:
  - Known stage with subagent → returns populated list.
  - Unknown stage → returns [].
  - Cache hit → second call re-uses cached content.
  - Cache clear → subsequent call re-reads file.
  - Missing persona file → FileNotFoundError.
  - Path traversal guard → ValueError.
"""

from __future__ import annotations

import textwrap
from pathlib import Path
from unittest.mock import patch

import pytest

from src.utils.subagents import clear_cache, load_subagents


@pytest.fixture(autouse=True)
def _clean_cache():
    """Ensure a clean subagent cache before and after each test."""
    clear_cache()
    yield
    clear_cache()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _write_persona(tmp_path: Path, rel_path: str, content: str) -> Path:
    """Write a persona file under *tmp_path* at *rel_path* and return its full path."""
    full = tmp_path / rel_path
    full.parent.mkdir(parents=True, exist_ok=True)
    full.write_text(content, encoding="utf-8")
    return full


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestLoadSubagentsHappyPath:
    """Known stage with a configured subagent returns a populated list."""

    def test_returns_list_with_expected_keys(self, tmp_path: Path):
        persona_content = "# WP Decomposer\n\nI decompose work packages."
        _write_persona(tmp_path, "personas/standalone/deep-agents/wp-decomposer.md", persona_content)

        # Patch STAGE_SUBAGENT_FILES to point at our temp file
        stage_files = {
            "pm": [
                {
                    "persona_file": "personas/standalone/deep-agents/wp-decomposer.md",
                    "name": "WP Decomposer",
                    "description": "Analyze a plan and decompose it.",
                },
            ],
        }

        with patch("src.config.STAGE_SUBAGENT_FILES", stage_files):
            result = load_subagents("pm", workspace_root=tmp_path)

        assert len(result) == 1
        entry = result[0]
        assert entry["name"] == "WP Decomposer"
        assert entry["description"] == "Analyze a plan and decompose it."
        assert entry["system_prompt"] == persona_content


class TestUnknownStage:
    """Stage with no subagent config returns an empty list."""

    def test_returns_empty_list(self, tmp_path: Path):
        with patch("src.config.STAGE_SUBAGENT_FILES", {}):
            result = load_subagents("developer", workspace_root=tmp_path)

        assert result == []


class TestCacheHit:
    """Second call returns cached content without re-reading the file."""

    def test_second_call_uses_cache(self, tmp_path: Path):
        persona_content = "Cached persona content."
        _write_persona(tmp_path, "agents/persona.md", persona_content)

        stage_files = {
            "pm": [
                {
                    "persona_file": "agents/persona.md",
                    "name": "Helper",
                    "description": "A helper.",
                },
            ],
        }

        with patch("src.config.STAGE_SUBAGENT_FILES", stage_files):
            first = load_subagents("pm", workspace_root=tmp_path)
            # Overwrite the file on disk — the cache should still return the old content
            (tmp_path / "agents/persona.md").write_text("CHANGED", encoding="utf-8")
            second = load_subagents("pm", workspace_root=tmp_path)

        assert first[0]["system_prompt"] == persona_content
        assert second[0]["system_prompt"] == persona_content


class TestCacheClear:
    """After clear_cache(), the next load re-reads the file."""

    def test_clear_causes_reread(self, tmp_path: Path):
        _write_persona(tmp_path, "agents/persona.md", "v1")

        stage_files = {
            "pm": [
                {
                    "persona_file": "agents/persona.md",
                    "name": "Helper",
                    "description": "A helper.",
                },
            ],
        }

        with patch("src.config.STAGE_SUBAGENT_FILES", stage_files):
            first = load_subagents("pm", workspace_root=tmp_path)
            assert first[0]["system_prompt"] == "v1"

            # Write new content and clear the cache
            (tmp_path / "agents/persona.md").write_text("v2", encoding="utf-8")
            clear_cache()

            second = load_subagents("pm", workspace_root=tmp_path)
            assert second[0]["system_prompt"] == "v2"


class TestMissingPersonaFile:
    """Configured persona file that doesn't exist raises FileNotFoundError."""

    def test_raises_file_not_found(self, tmp_path: Path):
        stage_files = {
            "pm": [
                {
                    "persona_file": "nonexistent/missing.md",
                    "name": "Ghost",
                    "description": "Does not exist.",
                },
            ],
        }

        with patch("src.config.STAGE_SUBAGENT_FILES", stage_files):
            with pytest.raises(FileNotFoundError, match="missing.md"):
                load_subagents("pm", workspace_root=tmp_path)


class TestPathTraversalGuard:
    """Persona file path that escapes workspace root raises ValueError."""

    def test_raises_value_error_for_traversal(self, tmp_path: Path):
        # Create a nested workspace root so the traversal target stays within tmp_path
        workspace = tmp_path / "workspace"
        workspace.mkdir()

        # Place the file one level above the workspace root but still inside tmp_path
        outside = tmp_path / "outside.md"
        outside.write_text("escaped", encoding="utf-8")

        stage_files = {
            "pm": [
                {
                    "persona_file": "../outside.md",
                    "name": "Escaped",
                    "description": "Path traversal attempt.",
                },
            ],
        }

        with patch("src.config.STAGE_SUBAGENT_FILES", stage_files):
            with pytest.raises(ValueError, match="escapes workspace root"):
                load_subagents("pm", workspace_root=workspace)
