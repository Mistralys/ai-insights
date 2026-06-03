"""
test_run_metadata.py — Unit tests for _write_run_metadata() and its call sites (WP-001).

Tests verify:
- _write_run_metadata() creates .orchestrator-run.json with all required fields.
- result, error, and duration_s are null when the run is in progress (no value passed).
- result is set to "SUCCESS", "INTERRUPTED", or "ERROR" correctly.
- The write is atomic: no .tmp file is left behind after a successful write.
- is_resume reflects whether --resume was used.
- OSError during write is silently swallowed (best-effort helper).
- The _is_run_terminal early-exit path writes the metadata file with result="ERROR"
  before returning EXIT_ERROR.

No real MCP server, LangGraph graph invocation, or filesystem I/O outside tmp_path
is performed.
"""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

# ---------------------------------------------------------------------------
# _write_run_metadata() — direct unit tests
# ---------------------------------------------------------------------------

class TestWriteRunMetadata:
    """Tests for the _write_run_metadata() helper."""

    def _call(
        self,
        plan_dir: Path,
        *,
        thread_id: str = "tid-123",
        plan_path: Path | None = None,
        started_at: str = "2026-01-01T00:00:00+00:00",
        is_resume: bool = False,
        dry_run: bool = False,
        log_filename: str = "run.jsonl",
        pid: int = 1234,
        result: str | None = None,
        error: str | None = None,
        duration_s: float | None = None,
    ) -> None:
        from src.cli import _write_run_metadata

        _write_run_metadata(
            plan_dir,
            thread_id=thread_id,
            plan_path=plan_path or plan_dir / "plan.md",
            started_at=started_at,
            is_resume=is_resume,
            dry_run=dry_run,
            log_filename=log_filename,
            pid=pid,
            result=result,
            error=error,
            duration_s=duration_s,
        )

    def _read(self, plan_dir: Path) -> dict:
        return json.loads((plan_dir / ".orchestrator-run.json").read_text())

    # ── File creation ────────────────────────────────────────────────────────

    def test_creates_file_in_plan_dir(self, tmp_path: Path) -> None:
        """The metadata file must be written inside plan_dir."""
        self._call(tmp_path)
        assert (tmp_path / ".orchestrator-run.json").exists()

    def test_no_tmp_file_after_write(self, tmp_path: Path) -> None:
        """Atomic write must not leave a .tmp file behind."""
        self._call(tmp_path)
        assert not (tmp_path / ".orchestrator-run.json.tmp").exists()

    # ── Null result fields when in progress ─────────────────────────────────

    def test_result_is_null_when_not_provided(self, tmp_path: Path) -> None:
        self._call(tmp_path)
        data = self._read(tmp_path)
        assert data["result"] is None

    def test_error_is_null_when_not_provided(self, tmp_path: Path) -> None:
        self._call(tmp_path)
        data = self._read(tmp_path)
        assert data["error"] is None

    def test_duration_s_is_null_when_not_provided(self, tmp_path: Path) -> None:
        self._call(tmp_path)
        data = self._read(tmp_path)
        assert data["duration_s"] is None

    # ── Result values ────────────────────────────────────────────────────────

    def test_result_success(self, tmp_path: Path) -> None:
        self._call(tmp_path, result="SUCCESS", duration_s=10.5)
        data = self._read(tmp_path)
        assert data["result"] == "SUCCESS"

    def test_result_interrupted(self, tmp_path: Path) -> None:
        self._call(tmp_path, result="INTERRUPTED", duration_s=3.2)
        data = self._read(tmp_path)
        assert data["result"] == "INTERRUPTED"

    def test_result_error_with_message(self, tmp_path: Path) -> None:
        self._call(tmp_path, result="ERROR", error="something went wrong")
        data = self._read(tmp_path)
        assert data["result"] == "ERROR"
        assert data["error"] == "something went wrong"

    def test_duration_s_stored_as_provided(self, tmp_path: Path) -> None:
        self._call(tmp_path, result="SUCCESS", duration_s=42.7)
        data = self._read(tmp_path)
        assert data["duration_s"] == 42.7

    # ── is_resume field ──────────────────────────────────────────────────────

    def test_is_resume_true(self, tmp_path: Path) -> None:
        self._call(tmp_path, is_resume=True)
        data = self._read(tmp_path)
        assert data["is_resume"] is True

    def test_is_resume_false(self, tmp_path: Path) -> None:
        self._call(tmp_path, is_resume=False)
        data = self._read(tmp_path)
        assert data["is_resume"] is False

    # ── dry_run field ────────────────────────────────────────────────────────

    def test_dry_run_true(self, tmp_path: Path) -> None:
        self._call(tmp_path, dry_run=True)
        data = self._read(tmp_path)
        assert data["dry_run"] is True

    def test_dry_run_false(self, tmp_path: Path) -> None:
        self._call(tmp_path, dry_run=False)
        data = self._read(tmp_path)
        assert data["dry_run"] is False

    # ── All required fields ──────────────────────────────────────────────────

    def test_all_required_fields_present(self, tmp_path: Path) -> None:
        """Every field documented in the WP spec must be present in the output."""
        plan_path = tmp_path / "plan.md"
        self._call(
            tmp_path,
            thread_id="tid-abc",
            plan_path=plan_path,
            started_at="2026-05-31T10:00:00+00:00",
            is_resume=False,
            dry_run=False,
            log_filename="my-run.jsonl",
            pid=9999,
        )
        data = self._read(tmp_path)
        for field in (
            "thread_id",
            "plan_path",
            "slug",
            "started_at",
            "is_resume",
            "dry_run",
            "log_filename",
            "pid",
            "result",
            "error",
            "duration_s",
        ):
            assert field in data, f"Missing field: {field!r}"

    def test_thread_id_stored(self, tmp_path: Path) -> None:
        self._call(tmp_path, thread_id="my-thread-id")
        data = self._read(tmp_path)
        assert data["thread_id"] == "my-thread-id"

    def test_slug_is_plan_dir_name(self, tmp_path: Path) -> None:
        plan_dir = tmp_path / "2026-01-01-my-feature"
        plan_dir.mkdir()
        self._call(plan_dir)
        data = self._read(plan_dir)
        assert data["slug"] == "2026-01-01-my-feature"

    def test_plan_path_stored_as_string(self, tmp_path: Path) -> None:
        plan_path = tmp_path / "plan.md"
        self._call(tmp_path, plan_path=plan_path)
        data = self._read(tmp_path)
        assert data["plan_path"] == str(plan_path)

    def test_log_filename_stored(self, tmp_path: Path) -> None:
        self._call(tmp_path, log_filename="specific-log.jsonl")
        data = self._read(tmp_path)
        assert data["log_filename"] == "specific-log.jsonl"

    def test_pid_stored(self, tmp_path: Path) -> None:
        self._call(tmp_path, pid=5678)
        data = self._read(tmp_path)
        assert data["pid"] == 5678

    def test_started_at_stored(self, tmp_path: Path) -> None:
        ts = "2026-05-31T12:34:56+00:00"
        self._call(tmp_path, started_at=ts)
        data = self._read(tmp_path)
        assert data["started_at"] == ts

    # ── Overwrite behaviour ──────────────────────────────────────────────────

    def test_overwrite_existing_file(self, tmp_path: Path) -> None:
        """A second call must overwrite the first write."""
        self._call(tmp_path, result=None)
        self._call(tmp_path, result="SUCCESS", duration_s=5.0)
        data = self._read(tmp_path)
        assert data["result"] == "SUCCESS"
        assert data["duration_s"] == 5.0

    # ── Error resilience ─────────────────────────────────────────────────────

    def test_oserror_silently_swallowed(self, tmp_path: Path) -> None:
        """If the write fails (e.g. directory is read-only), no exception must propagate."""
        from src.cli import _write_run_metadata

        # Pass a non-existent nested path without creating it.
        bad_dir = tmp_path / "no" / "such" / "dir"
        # _write_run_metadata must not raise.
        _write_run_metadata(
            bad_dir,
            thread_id="t",
            plan_path=bad_dir / "plan.md",
            started_at="2026-01-01T00:00:00+00:00",
            is_resume=False,
            dry_run=False,
            log_filename="x.jsonl",
            pid=1,
        )


# ---------------------------------------------------------------------------
# _is_run_terminal early-exit path — integration with _run()
# ---------------------------------------------------------------------------

class TestTerminalResumeMetadata:
    """Verify that _run() writes metadata when the _is_run_terminal guard fires."""

    async def test_terminal_resume_writes_error_metadata(self, tmp_path: Path) -> None:
        """_run() must write .orchestrator-run.json with result='ERROR' before returning."""
        from src.cli import EXIT_ERROR, _mark_run_terminal, _run

        plan_dir = tmp_path / "2026-01-01-test"
        plan_dir.mkdir()
        plan_file = plan_dir / "plan.md"
        plan_file.write_text("# Plan")

        ckpt_dir = tmp_path / "checkpoints"
        _mark_run_terminal(ckpt_dir, "finished-thread")

        args = MagicMock()
        args.plan = str(plan_file)
        args.resume = "finished-thread"
        args.dry_run = False
        args.interrupt_on = None
        args.project_path = None

        mock_config = MagicMock()
        mock_config.checkpoint_dir = ckpt_dir
        mock_config.workspace_root = tmp_path
        mock_config.heartbeat_interval_s = 0

        mock_run_logger = MagicMock()
        mock_run_logger._path = tmp_path / "run.jsonl"
        mock_run_logger.start_heartbeat = AsyncMock(return_value=None)
        mock_run_logger.stop_heartbeat = AsyncMock(return_value=None)
        mock_run_logger.flush_unstreamed = MagicMock()
        mock_run_logger.log = MagicMock()
        mock_run_logger.close = MagicMock()

        with patch("src.utils.logging.WorkflowLogger") as mock_logger_cls:
            mock_logger_cls.create.return_value = mock_run_logger
            result = await _run(args, mock_config)

        assert result == EXIT_ERROR
        meta_file = plan_dir / ".orchestrator-run.json"
        assert meta_file.exists(), "Metadata file must be written on terminal-resume exit."
        data = json.loads(meta_file.read_text())
        assert data["result"] == "ERROR"

    async def test_terminal_resume_metadata_error_contains_thread_id(
        self, tmp_path: Path
    ) -> None:
        """The error field must mention the thread_id."""
        from src.cli import _mark_run_terminal, _run

        plan_dir = tmp_path / "2026-01-01-test"
        plan_dir.mkdir()
        plan_file = plan_dir / "plan.md"
        plan_file.write_text("# Plan")

        ckpt_dir = tmp_path / "checkpoints"
        _mark_run_terminal(ckpt_dir, "done-thread")

        args = MagicMock()
        args.plan = str(plan_file)
        args.resume = "done-thread"
        args.dry_run = False
        args.interrupt_on = None
        args.project_path = None

        mock_config = MagicMock()
        mock_config.checkpoint_dir = ckpt_dir
        mock_config.workspace_root = tmp_path
        mock_config.heartbeat_interval_s = 0

        mock_run_logger = MagicMock()
        mock_run_logger._path = tmp_path / "run.jsonl"
        mock_run_logger.start_heartbeat = AsyncMock(return_value=None)
        mock_run_logger.stop_heartbeat = AsyncMock(return_value=None)
        mock_run_logger.flush_unstreamed = MagicMock()
        mock_run_logger.log = MagicMock()
        mock_run_logger.close = MagicMock()

        with patch("src.utils.logging.WorkflowLogger") as mock_logger_cls:
            mock_logger_cls.create.return_value = mock_run_logger
            await _run(args, mock_config)

        data = json.loads((plan_dir / ".orchestrator-run.json").read_text())
        assert "done-thread" in data["error"], (
            "error field must contain the thread_id."
        )

    async def test_terminal_resume_metadata_is_resume_true(self, tmp_path: Path) -> None:
        """is_resume must be True in the metadata written by the terminal-resume guard."""
        from src.cli import _mark_run_terminal, _run

        plan_dir = tmp_path / "2026-01-01-test"
        plan_dir.mkdir()
        plan_file = plan_dir / "plan.md"
        plan_file.write_text("# Plan")

        ckpt_dir = tmp_path / "checkpoints"
        _mark_run_terminal(ckpt_dir, "done-thread")

        args = MagicMock()
        args.plan = str(plan_file)
        args.resume = "done-thread"
        args.dry_run = False
        args.interrupt_on = None
        args.project_path = None

        mock_config = MagicMock()
        mock_config.checkpoint_dir = ckpt_dir
        mock_config.workspace_root = tmp_path
        mock_config.heartbeat_interval_s = 0

        mock_run_logger = MagicMock()
        mock_run_logger._path = tmp_path / "run.jsonl"
        mock_run_logger.start_heartbeat = AsyncMock(return_value=None)
        mock_run_logger.stop_heartbeat = AsyncMock(return_value=None)
        mock_run_logger.flush_unstreamed = MagicMock()
        mock_run_logger.log = MagicMock()
        mock_run_logger.close = MagicMock()

        with patch("src.utils.logging.WorkflowLogger") as mock_logger_cls:
            mock_logger_cls.create.return_value = mock_run_logger
            await _run(args, mock_config)

        data = json.loads((plan_dir / ".orchestrator-run.json").read_text())
        assert data["is_resume"] is True
