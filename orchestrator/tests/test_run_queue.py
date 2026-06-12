"""Unit tests for orchestrator/src/utils/run_queue.py."""
from __future__ import annotations

import json
import uuid
from pathlib import Path
from unittest.mock import patch

import src.utils.run_queue as rq

# ---------------------------------------------------------------------------
# register() — creates file, appends entry, returns UUID
# ---------------------------------------------------------------------------


class TestRegisterCreatesFile:
    def test_creates_queue_file_when_missing(self, tmp_path: Path) -> None:
        with patch.object(rq, "QUEUE_FILE", tmp_path / ".run-queue.json"), \
             patch.object(rq, "_LOCK_FILE", tmp_path / ".run-queue.lock"), \
             patch.object(rq, "_LOGS_DIR", tmp_path):

            entry_id = rq.register(
                pid=1, plan_path="/p/plan.md", slug="2026-05-05-feat",
                started_at="2026-05-05T10:00:00Z",
            )

        assert (tmp_path / ".run-queue.json").exists()
        data = json.loads((tmp_path / ".run-queue.json").read_text())
        assert len(data) == 1
        assert data[0]["id"] == entry_id

    def test_entry_shape_is_correct(self, tmp_path: Path) -> None:
        with patch.object(rq, "QUEUE_FILE", tmp_path / ".run-queue.json"), \
             patch.object(rq, "_LOCK_FILE", tmp_path / ".run-queue.lock"), \
             patch.object(rq, "_LOGS_DIR", tmp_path):

            entry_id = rq.register(
                pid=99, plan_path="/abs/plan.md", slug="my-slug",
                started_at="2026-01-01T00:00:00Z",
            )

        data = json.loads((tmp_path / ".run-queue.json").read_text())
        entry = data[0]
        assert entry["id"] == entry_id
        assert entry["pid"] == 99
        assert entry["planPath"] == "/abs/plan.md"
        assert entry["expectedSlug"] == "my-slug"
        assert entry["startedAt"] == "2026-01-01T00:00:00Z"
        assert entry["status"] == "pending"
        # expectedRepo defaults to None when repo_name is not supplied.
        assert "expectedRepo" in entry
        assert entry["expectedRepo"] is None

    def test_entry_shape_with_repo_name(self, tmp_path: Path) -> None:
        with patch.object(rq, "QUEUE_FILE", tmp_path / ".run-queue.json"), \
             patch.object(rq, "_LOCK_FILE", tmp_path / ".run-queue.lock"), \
             patch.object(rq, "_LOGS_DIR", tmp_path):

            entry_id = rq.register(
                pid=7, plan_path="/ws/repo/docs/agents/plans/2026-01-01-feat/plan.md",
                slug="2026-01-01-feat", started_at="2026-01-01T00:00:00Z",
                repo_name="my-repo",
            )

        data = json.loads((tmp_path / ".run-queue.json").read_text())
        entry = data[0]
        assert entry["id"] == entry_id
        assert entry["expectedSlug"] == "2026-01-01-feat"
        assert entry["expectedRepo"] == "my-repo"

    def test_returns_uuid_string(self, tmp_path: Path) -> None:
        with patch.object(rq, "QUEUE_FILE", tmp_path / ".run-queue.json"), \
             patch.object(rq, "_LOCK_FILE", tmp_path / ".run-queue.lock"), \
             patch.object(rq, "_LOGS_DIR", tmp_path):

            entry_id = rq.register(pid=1, plan_path="/p/plan.md", slug="s", started_at="t")

        # Should parse as a valid UUID4 without raising ValueError.
        parsed = uuid.UUID(entry_id, version=4)
        assert str(parsed) == entry_id


# ---------------------------------------------------------------------------
# register() — preserves existing entries
# ---------------------------------------------------------------------------


class TestRegisterPreservesExistingEntries:
    def test_appends_without_overwriting(self, tmp_path: Path) -> None:
        queue_file = tmp_path / ".run-queue.json"
        lock_file = tmp_path / ".run-queue.lock"
        existing = [
            {"id": "aaa", "pid": 1, "planPath": "/old", "expectedSlug": "old",
             "startedAt": "t", "status": "pending"},
        ]
        queue_file.write_text(json.dumps(existing), encoding="utf-8")

        with patch.object(rq, "QUEUE_FILE", queue_file), \
             patch.object(rq, "_LOCK_FILE", lock_file), \
             patch.object(rq, "_LOGS_DIR", tmp_path):

            new_id = rq.register(pid=2, plan_path="/new", slug="new", started_at="t2")

        data = json.loads(queue_file.read_text())
        assert len(data) == 2
        assert data[0]["id"] == "aaa"
        assert data[1]["id"] == new_id

    def test_multiple_registers_accumulate(self, tmp_path: Path) -> None:
        queue_file = tmp_path / ".run-queue.json"
        lock_file = tmp_path / ".run-queue.lock"

        with patch.object(rq, "QUEUE_FILE", queue_file), \
             patch.object(rq, "_LOCK_FILE", lock_file), \
             patch.object(rq, "_LOGS_DIR", tmp_path):

            id1 = rq.register(pid=1, plan_path="/a", slug="a", started_at="t")
            id2 = rq.register(pid=2, plan_path="/b", slug="b", started_at="t")
            id3 = rq.register(pid=3, plan_path="/c", slug="c", started_at="t")

        data = json.loads(queue_file.read_text())
        ids = [e["id"] for e in data]
        assert ids == [id1, id2, id3]


# ---------------------------------------------------------------------------
# unregister() — removes only the matching entry
# ---------------------------------------------------------------------------


class TestUnregisterRemovesCorrectEntry:
    def test_removes_entry_by_id(self, tmp_path: Path) -> None:
        queue_file = tmp_path / ".run-queue.json"
        lock_file = tmp_path / ".run-queue.lock"
        entries = [
            {"id": "aaa", "pid": 1, "planPath": "/a", "expectedSlug": "a",
             "startedAt": "t", "status": "pending"},
            {"id": "bbb", "pid": 2, "planPath": "/b", "expectedSlug": "b",
             "startedAt": "t", "status": "pending"},
        ]
        queue_file.write_text(json.dumps(entries), encoding="utf-8")

        with patch.object(rq, "QUEUE_FILE", queue_file), \
             patch.object(rq, "_LOCK_FILE", lock_file), \
             patch.object(rq, "_LOGS_DIR", tmp_path):

            rq.unregister("aaa")

        data = json.loads(queue_file.read_text())
        assert len(data) == 1
        assert data[0]["id"] == "bbb"

    def test_does_not_remove_other_entries(self, tmp_path: Path) -> None:
        queue_file = tmp_path / ".run-queue.json"
        lock_file = tmp_path / ".run-queue.lock"
        entries = [
            {"id": "aaa", "pid": 1, "planPath": "/a", "expectedSlug": "a",
             "startedAt": "t", "status": "pending"},
            {"id": "bbb", "pid": 2, "planPath": "/b", "expectedSlug": "b",
             "startedAt": "t", "status": "pending"},
            {"id": "ccc", "pid": 3, "planPath": "/c", "expectedSlug": "c",
             "startedAt": "t", "status": "pending"},
        ]
        queue_file.write_text(json.dumps(entries), encoding="utf-8")

        with patch.object(rq, "QUEUE_FILE", queue_file), \
             patch.object(rq, "_LOCK_FILE", lock_file), \
             patch.object(rq, "_LOGS_DIR", tmp_path):

            rq.unregister("bbb")

        data = json.loads(queue_file.read_text())
        ids = [e["id"] for e in data]
        assert ids == ["aaa", "ccc"]

    def test_removing_last_entry_leaves_empty_list(self, tmp_path: Path) -> None:
        queue_file = tmp_path / ".run-queue.json"
        lock_file = tmp_path / ".run-queue.lock"
        entries = [
            {"id": "only", "pid": 1, "planPath": "/p", "expectedSlug": "p",
             "startedAt": "t", "status": "pending"},
        ]
        queue_file.write_text(json.dumps(entries), encoding="utf-8")

        with patch.object(rq, "QUEUE_FILE", queue_file), \
             patch.object(rq, "_LOCK_FILE", lock_file), \
             patch.object(rq, "_LOGS_DIR", tmp_path):

            rq.unregister("only")

        data = json.loads(queue_file.read_text())
        assert data == []


# ---------------------------------------------------------------------------
# register() — error recovery (corrupt / missing queue file)
# ---------------------------------------------------------------------------


class TestRegisterEdgeCases:
    def test_corrupt_file_treated_as_empty(self, tmp_path: Path) -> None:
        """register() should recover from a corrupt queue file."""
        queue_file = tmp_path / ".run-queue.json"
        lock_file = tmp_path / ".run-queue.lock"
        queue_file.write_text("NOT JSON {{{{", encoding="utf-8")

        with patch.object(rq, "QUEUE_FILE", queue_file), \
             patch.object(rq, "_LOCK_FILE", lock_file), \
             patch.object(rq, "_LOGS_DIR", tmp_path):

            entry_id = rq.register(pid=1, plan_path="/p", slug="s", started_at="t")

        data = json.loads(queue_file.read_text())
        assert len(data) == 1
        assert data[0]["id"] == entry_id


# ---------------------------------------------------------------------------
# unregister() — silent no-op cases
# ---------------------------------------------------------------------------


class TestUnregisterNoOp:
    def test_missing_file_is_silent(self, tmp_path: Path) -> None:
        with patch.object(rq, "QUEUE_FILE", tmp_path / ".run-queue.json"), \
             patch.object(rq, "_LOCK_FILE", tmp_path / ".run-queue.lock"), \
             patch.object(rq, "_LOGS_DIR", tmp_path):

            # Must not raise
            rq.unregister("unknown-id")

    def test_unknown_id_is_silent(self, tmp_path: Path) -> None:
        queue_file = tmp_path / ".run-queue.json"
        lock_file = tmp_path / ".run-queue.lock"
        queue_file.write_text(json.dumps([{"id": "aaa"}]), encoding="utf-8")

        with patch.object(rq, "QUEUE_FILE", queue_file), \
             patch.object(rq, "_LOCK_FILE", lock_file), \
             patch.object(rq, "_LOGS_DIR", tmp_path):

            rq.unregister("not-here")  # Must not raise

        # File is unchanged
        data = json.loads(queue_file.read_text())
        assert data[0]["id"] == "aaa"


# ---------------------------------------------------------------------------
# Atomic write — no partial content
# ---------------------------------------------------------------------------


class TestAtomicWrite:
    def test_tmp_file_not_present_after_write(self, tmp_path: Path) -> None:
        queue_file = tmp_path / ".run-queue.json"
        lock_file = tmp_path / ".run-queue.lock"

        with patch.object(rq, "QUEUE_FILE", queue_file), \
             patch.object(rq, "_LOCK_FILE", lock_file), \
             patch.object(rq, "_LOGS_DIR", tmp_path):

            rq.register(pid=1, plan_path="/p", slug="s", started_at="t")

        tmp_file = tmp_path / ".run-queue.json.tmp"
        assert not tmp_file.exists(), ".tmp file should be cleaned up after rename"

    def test_queue_file_is_valid_json_after_write(self, tmp_path: Path) -> None:
        queue_file = tmp_path / ".run-queue.json"
        lock_file = tmp_path / ".run-queue.lock"

        with patch.object(rq, "QUEUE_FILE", queue_file), \
             patch.object(rq, "_LOCK_FILE", lock_file), \
             patch.object(rq, "_LOGS_DIR", tmp_path):

            rq.register(pid=42, plan_path="/q", slug="q", started_at="now")

        # Must parse as valid JSON and be a list
        parsed = json.loads(queue_file.read_text(encoding="utf-8"))
        assert isinstance(parsed, list)


# ---------------------------------------------------------------------------
# register() — expectedRepo field
# ---------------------------------------------------------------------------


class TestRegisterExpectedRepo:
    """Tests for the expectedRepo field introduced by WP-002."""

    def test_expected_repo_written_when_supplied(self, tmp_path: Path) -> None:
        with patch.object(rq, "QUEUE_FILE", tmp_path / ".run-queue.json"), \
             patch.object(rq, "_LOCK_FILE", tmp_path / ".run-queue.lock"), \
             patch.object(rq, "_LOGS_DIR", tmp_path):

            rq.register(
                pid=1, plan_path="/p", slug="s", started_at="t",
                repo_name="ai-insights",
            )

        entry = json.loads((tmp_path / ".run-queue.json").read_text())[0]
        assert entry["expectedRepo"] == "ai-insights"

    def test_expected_repo_is_null_when_omitted(self, tmp_path: Path) -> None:
        """Omitting repo_name must still write the key with a null value."""
        with patch.object(rq, "QUEUE_FILE", tmp_path / ".run-queue.json"), \
             patch.object(rq, "_LOCK_FILE", tmp_path / ".run-queue.lock"), \
             patch.object(rq, "_LOGS_DIR", tmp_path):

            rq.register(pid=1, plan_path="/p", slug="s", started_at="t")

        entry = json.loads((tmp_path / ".run-queue.json").read_text())[0]
        assert "expectedRepo" in entry
        assert entry["expectedRepo"] is None

    def test_expected_repo_null_when_passed_none_explicitly(self, tmp_path: Path) -> None:
        with patch.object(rq, "QUEUE_FILE", tmp_path / ".run-queue.json"), \
             patch.object(rq, "_LOCK_FILE", tmp_path / ".run-queue.lock"), \
             patch.object(rq, "_LOGS_DIR", tmp_path):

            rq.register(pid=1, plan_path="/p", slug="s", started_at="t", repo_name=None)

        entry = json.loads((tmp_path / ".run-queue.json").read_text())[0]
        assert entry["expectedRepo"] is None

    def test_slug_field_retains_bare_slug_semantics(self, tmp_path: Path) -> None:
        """The slug field must equal the bare plan-directory name, unchanged."""
        with patch.object(rq, "QUEUE_FILE", tmp_path / ".run-queue.json"), \
             patch.object(rq, "_LOCK_FILE", tmp_path / ".run-queue.lock"), \
             patch.object(rq, "_LOGS_DIR", tmp_path):

            rq.register(
                pid=1, plan_path="/ws/repo/docs/agents/plans/2026-05-01-feat/plan.md",
                slug="2026-05-01-feat", started_at="t",
                repo_name="my-repo",
            )

        entry = json.loads((tmp_path / ".run-queue.json").read_text())[0]
        # slug (stored as expectedSlug) must be the bare directory name.
        assert entry["expectedSlug"] == "2026-05-01-feat"
        # Repo is separate.
        assert entry["expectedRepo"] == "my-repo"

    def test_both_slug_and_repo_present_in_entry(self, tmp_path: Path) -> None:
        """Queue entry must contain both expectedSlug and expectedRepo keys."""
        with patch.object(rq, "QUEUE_FILE", tmp_path / ".run-queue.json"), \
             patch.object(rq, "_LOCK_FILE", tmp_path / ".run-queue.lock"), \
             patch.object(rq, "_LOGS_DIR", tmp_path):

            rq.register(
                pid=2, plan_path="/p/plan.md", slug="my-plan", started_at="t",
                repo_name="my-repo",
            )

        entry = json.loads((tmp_path / ".run-queue.json").read_text())[0]
        assert "expectedSlug" in entry
        assert "expectedRepo" in entry
