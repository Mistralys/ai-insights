"""
test_plan_parser.py — Unit tests for the plan document parser.

Verifies:
- parse_plan() extracts title and summary from a standard plan document.
- YAML frontmatter is stripped before parsing.
- Missing files raise FileNotFoundError.
- Documents with no H1 return empty title and summary.
- PlanMetadata carries the absolute file path and raw content.
"""

from __future__ import annotations

import textwrap
from pathlib import Path

import pytest

from src.utils.plan_parser import PlanMetadata, parse_plan


@pytest.fixture
def tmp_plan(tmp_path: Path):
    """Factory fixture: writes Markdown content to a temp file and returns its path."""
    def _write(content: str, filename: str = "plan.md") -> Path:
        p = tmp_path / filename
        p.write_text(textwrap.dedent(content), encoding="utf-8")
        return p
    return _write


class TestStandardPlan:
    """Tests for a normal plan document with title and body paragraph."""

    CONTENT = """
        # LangGraph Orchestrator

        Implements a LangGraph-based orchestrator that drives the AI agent workflow.

        ## Architecture

        Uses a StateGraph with supervisor routing.
    """

    def test_extracts_title(self, tmp_plan):
        path = tmp_plan(self.CONTENT)
        meta = parse_plan(str(path))
        assert meta.title == "LangGraph Orchestrator"

    def test_extracts_summary(self, tmp_plan):
        path = tmp_plan(self.CONTENT)
        meta = parse_plan(str(path))
        assert meta.summary == (
            "Implements a LangGraph-based orchestrator that drives the AI agent workflow."
        )

    def test_returns_absolute_file_path(self, tmp_plan):
        path = tmp_plan(self.CONTENT)
        meta = parse_plan(str(path))
        assert meta.file_path == str(path)

    def test_raw_content_preserved(self, tmp_plan):
        path = tmp_plan(self.CONTENT)
        raw = path.read_text(encoding="utf-8")
        meta = parse_plan(str(path))
        assert meta.raw_content == raw

    def test_returns_plan_metadata_instance(self, tmp_plan):
        path = tmp_plan(self.CONTENT)
        meta = parse_plan(str(path))
        assert isinstance(meta, PlanMetadata)


class TestFrontmatterStripping:
    """Tests for documents that begin with YAML frontmatter."""

    CONTENT = """\
---
title: My Plan
author: Agent
---

# Frontmatter Plan

First paragraph after frontmatter.
"""

    def test_title_extracted_after_frontmatter(self, tmp_plan):
        path = tmp_plan(self.CONTENT)
        meta = parse_plan(str(path))
        assert meta.title == "Frontmatter Plan"

    def test_summary_extracted_after_frontmatter(self, tmp_plan):
        path = tmp_plan(self.CONTENT)
        meta = parse_plan(str(path))
        assert meta.summary == "First paragraph after frontmatter."


class TestEdgeCases:
    """Edge-case and missing-content scenarios."""

    def test_no_h1_returns_empty_title(self, tmp_plan):
        path = tmp_plan("## Only a second-level heading\n\nSome text.")
        meta = parse_plan(str(path))
        assert meta.title == ""

    def test_no_body_paragraph_returns_empty_summary(self, tmp_plan):
        path = tmp_plan("# Title Only\n")
        meta = parse_plan(str(path))
        assert meta.summary == ""

    def test_heading_after_title_is_skipped(self, tmp_plan):
        content = "# Title\n\n## Section Heading\n\nActual summary paragraph."
        path = tmp_plan(content)
        meta = parse_plan(str(path))
        assert meta.summary == "Actual summary paragraph."

    def test_relative_path_resolved(self, tmp_plan):
        """Passing a relative path should still produce an absolute file_path."""
        import os
        path = tmp_plan("# Relative\n\nSummary.")
        original_cwd = os.getcwd()
        try:
            os.chdir(str(path.parent))
            meta = parse_plan(path.name)
            assert Path(meta.file_path).is_absolute()
            assert meta.title == "Relative"
        finally:
            os.chdir(original_cwd)

    def test_missing_file_raises_file_not_found(self):
        with pytest.raises(FileNotFoundError, match="Plan file not found"):
            parse_plan("/nonexistent/path/plan.md")

    def test_multiline_paragraph_collapsed_to_single_line(self, tmp_plan):
        content = "# Title\n\nLine one\nLine two\nLine three.\n"
        path = tmp_plan(content)
        meta = parse_plan(str(path))
        assert meta.summary == "Line one Line two Line three."
