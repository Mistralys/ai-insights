"""
test_revision.py — Unit tests for orchestrator/src/utils/_revision.py.

All filesystem operations use pytest's ``tmp_path`` fixture for
platform-agnostic temp directories.
"""

from __future__ import annotations

from pathlib import Path

from src.utils._revision import next_revision


class TestNextRevisionEmpty:
    """next_revision returns 0 when no matching files exist."""

    def test_empty_directory(self, tmp_path: Path) -> None:
        assert next_revision(tmp_path, "WP-001", "developer", ".jsonl") == 0

    def test_empty_directory_md(self, tmp_path: Path) -> None:
        assert next_revision(tmp_path, "WP-001", "developer", ".md") == 0

    def test_non_matching_files_ignored(self, tmp_path: Path) -> None:
        (tmp_path / "WP-002-developer-r0.jsonl").write_text("{}\n")
        (tmp_path / "WP-001-qa-r0.jsonl").write_text("{}\n")
        assert next_revision(tmp_path, "WP-001", "developer", ".jsonl") == 0


class TestNextRevisionIncrement:
    """next_revision returns max(existing) + 1."""

    def test_single_existing_file(self, tmp_path: Path) -> None:
        (tmp_path / "WP-001-developer-r0.jsonl").write_text("{}\n")
        assert next_revision(tmp_path, "WP-001", "developer", ".jsonl") == 1

    def test_two_existing_files(self, tmp_path: Path) -> None:
        (tmp_path / "WP-001-developer-r0.jsonl").write_text("{}\n")
        (tmp_path / "WP-001-developer-r1.jsonl").write_text("{}\n")
        assert next_revision(tmp_path, "WP-001", "developer", ".jsonl") == 2

    def test_gap_in_revisions(self, tmp_path: Path) -> None:
        """If existing files are r0 and r3, next revision should be r4."""
        (tmp_path / "WP-001-developer-r0.jsonl").write_text("{}\n")
        (tmp_path / "WP-001-developer-r3.jsonl").write_text("{}\n")
        assert next_revision(tmp_path, "WP-001", "developer", ".jsonl") == 4

    def test_md_extension(self, tmp_path: Path) -> None:
        (tmp_path / "WP-001-developer-r0.md").write_text("# Dialogue\n")
        (tmp_path / "WP-001-developer-r1.md").write_text("# Dialogue\n")
        assert next_revision(tmp_path, "WP-001", "developer", ".md") == 2


class TestNextRevisionEdgeCases:
    """Edge cases: malformed filenames, mixed extensions."""

    def test_malformed_filename_ignored(self, tmp_path: Path) -> None:
        """Files that match the glob but have non-integer revision are ignored."""
        (tmp_path / "WP-001-developer-rfoo.jsonl").write_text("{}\n")
        assert next_revision(tmp_path, "WP-001", "developer", ".jsonl") == 0

    def test_only_matching_extension_counted(self, tmp_path: Path) -> None:
        """Files with a different extension are not counted."""
        (tmp_path / "WP-001-developer-r5.md").write_text("# Dialogue\n")
        assert next_revision(tmp_path, "WP-001", "developer", ".jsonl") == 0

    def test_different_wp_id_not_counted(self, tmp_path: Path) -> None:
        (tmp_path / "WP-999-developer-r10.jsonl").write_text("{}\n")
        assert next_revision(tmp_path, "WP-001", "developer", ".jsonl") == 0

    def test_different_stage_not_counted(self, tmp_path: Path) -> None:
        (tmp_path / "WP-001-qa-r10.jsonl").write_text("{}\n")
        assert next_revision(tmp_path, "WP-001", "developer", ".jsonl") == 0
