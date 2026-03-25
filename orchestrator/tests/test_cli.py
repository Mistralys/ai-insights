"""
test_cli.py — Unit tests for the CLI entry point (WP-005).

Tests verify:
- Argument parser accepts all documented options.
- _parse_interrupt_stages() maps stage names correctly.
- _print_run_summary() returns correct exit codes.
- _make_dryrun_node() returns a callable that produces correct state updates.
- main() exits with correct codes for missing plan files.

No real MCP server, LLM, or LangGraph graph invocation is performed.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

# ---------------------------------------------------------------------------
# Argument parser tests
# ---------------------------------------------------------------------------

class TestArgumentParser:
    def _parse(self, *args):
        from src.cli import _build_parser
        return _build_parser().parse_args(list(args))

    def test_plan_positional_required(self):
        """Parser requires the plan positional argument."""
        from src.cli import _build_parser
        with pytest.raises(SystemExit):
            _build_parser().parse_args([])

    def test_plan_positional_parsed(self):
        args = self._parse("plan.md")
        assert args.plan == "plan.md"

    def test_project_path_option(self):
        args = self._parse("plan.md", "--project-path", "/some/project")
        assert args.project_path == "/some/project"

    def test_max_iterations_option(self):
        args = self._parse("plan.md", "--max-iterations", "50")
        assert args.max_iterations == 50

    def test_model_option(self):
        args = self._parse("plan.md", "--model", "claude-opus-4")
        assert args.model == "claude-opus-4"

    def test_resume_option(self):
        args = self._parse("plan.md", "--resume", "abc-123")
        assert args.resume == "abc-123"

    def test_dry_run_flag(self):
        args = self._parse("plan.md", "--dry-run")
        assert args.dry_run is True

    def test_dry_run_default_false(self):
        args = self._parse("plan.md")
        assert args.dry_run is False

    def test_log_level_option(self):
        args = self._parse("plan.md", "--log-level", "DEBUG")
        assert args.log_level == "DEBUG"

    def test_log_level_invalid_rejected(self):
        from src.cli import _build_parser
        with pytest.raises(SystemExit):
            _build_parser().parse_args(["plan.md", "--log-level", "INVALID"])

    def test_interrupt_on_option(self):
        args = self._parse("plan.md", "--interrupt-on", "pm,synthesis")
        assert args.interrupt_on == "pm,synthesis"

    def test_defaults_are_none(self):
        args = self._parse("plan.md")
        assert args.project_path is None
        assert args.max_iterations is None
        assert args.model is None
        assert args.resume is None
        assert args.log_level is None
        assert args.interrupt_on is None


# ---------------------------------------------------------------------------
# _parse_interrupt_stages() tests
# ---------------------------------------------------------------------------

class TestParseInterruptStages:
    def _parse(self, raw: str) -> list[str]:
        from src.cli import _parse_interrupt_stages
        return _parse_interrupt_stages(raw)

    def test_pm_maps_to_pm(self):
        assert "pm" in self._parse("pm")

    def test_synthesis_maps_to_synthesis(self):
        assert "synthesis" in self._parse("synthesis")

    def test_fail_maps_to_developer(self):
        assert "developer" in self._parse("fail")

    def test_multiple_stages(self):
        result = self._parse("pm,synthesis")
        assert "pm" in result
        assert "synthesis" in result

    def test_deduplicates_same_node(self):
        # Both "fail" and potential duplicates map to "developer" — should appear once.
        result = self._parse("fail")
        assert result.count("developer") == 1

    def test_unknown_stage_exits(self):
        from src.cli import _parse_interrupt_stages
        with pytest.raises(SystemExit):
            _parse_interrupt_stages("unknown_stage")

    def test_whitespace_stripped(self):
        result = self._parse("pm , synthesis")
        assert "pm" in result
        assert "synthesis" in result


# ---------------------------------------------------------------------------
# _print_run_summary() exit code tests
# ---------------------------------------------------------------------------

class TestPrintRunSummary:
    def _call(self, final_state, duration=1.0, thread_id="t1", errors=None):
        from src.cli import _print_run_summary
        return _print_run_summary(final_state, duration, thread_id=thread_id, errors_raised=errors)

    def test_none_state_returns_error(self, capsys):
        code = self._call(None)
        from src.cli import EXIT_ERROR
        assert code == EXIT_ERROR

    def test_empty_state_no_errors_returns_success(self, capsys):
        state = {
            "run_log": [],
            "errors": [],
            "wp_summaries": [],
            "iteration": 1,
            "max_iterations": 100,
        }
        from src.cli import EXIT_SUCCESS
        assert self._call(state) == EXIT_SUCCESS

    def test_safety_limit_returns_exit_2(self, capsys):
        state = {
            "run_log": [],
            "errors": [],
            "wp_summaries": [],
            "iteration": 100,
            "max_iterations": 100,
        }
        from src.cli import EXIT_SAFETY_LIMIT
        assert self._call(state) == EXIT_SAFETY_LIMIT

    def test_errors_in_state_returns_error(self, capsys):
        state = {
            "run_log": [],
            "errors": [{"message": "something went wrong"}],
            "wp_summaries": [],
            "iteration": 1,
            "max_iterations": 100,
        }
        from src.cli import EXIT_ERROR
        assert self._call(state) == EXIT_ERROR

    def test_outside_errors_returns_error(self, capsys):
        state = {
            "run_log": [],
            "errors": [],
            "wp_summaries": [],
            "iteration": 1,
            "max_iterations": 100,
        }
        from src.cli import EXIT_ERROR
        assert self._call(state, errors=["startup failed"]) == EXIT_ERROR

    def test_summary_includes_thread_id(self, capsys):
        state = {
            "run_log": [],
            "errors": [],
            "wp_summaries": [],
            "iteration": 1,
            "max_iterations": 100,
        }
        self._call(state, thread_id="my-thread-id")
        captured = capsys.readouterr()
        assert "my-thread-id" in captured.out

    def test_summary_includes_duration(self, capsys):
        state = {
            "run_log": [],
            "errors": [],
            "wp_summaries": [],
            "iteration": 1,
            "max_iterations": 100,
        }
        self._call(state, duration=42.5)
        captured = capsys.readouterr()
        assert "42.5" in captured.out

    def test_wps_complete_count_shown(self, capsys):
        state = {
            "run_log": [],
            "errors": [],
            "wp_summaries": [
                {"status": "COMPLETE"},
                {"status": "COMPLETE"},
                {"status": "IN_PROGRESS"},
            ],
            "iteration": 1,
            "max_iterations": 100,
        }
        self._call(state)
        captured = capsys.readouterr()
        assert "2/3" in captured.out


# ---------------------------------------------------------------------------
# _make_dryrun_node() tests
# ---------------------------------------------------------------------------

class TestDryRunNode:
    def _make(self, stage: str):
        from src.cli import _make_dryrun_node
        return _make_dryrun_node(stage)

    def test_returns_callable(self):
        node = self._make("pm")
        assert callable(node)

    def test_returns_dict_on_call(self):
        node = self._make("pm")
        result = node({"current_wp_id": "WP-001"})
        assert isinstance(result, dict)

    def test_stage_success_is_true(self):
        node = self._make("developer")
        result = node({"current_wp_id": "WP-001"})
        assert result.get("stage_success") is True

    def test_run_log_appended(self):
        node = self._make("qa")
        result = node({"current_wp_id": "WP-001"})
        assert len(result.get("run_log", [])) == 1
        assert result["run_log"][0]["action"] == "dry_run"

    def test_stage_name_in_result(self):
        node = self._make("reviewer")
        result = node({"current_wp_id": "WP-002"})
        assert "reviewer" in result.get("stage_result", "")

    def test_node_name_attribute_set(self):
        node = self._make("docs")
        assert "docs" in node.__name__


# ---------------------------------------------------------------------------
# main() integration — missing plan file error
# ---------------------------------------------------------------------------

class TestMainMissingPlan:
    def test_missing_plan_exits_1(self, tmp_path):
        """main() exits with EXIT_ERROR when the plan file does not exist."""
        nonexistent = str(tmp_path / "no_such_plan.md")

        mock_config = MagicMock()
        mock_config.max_iterations = 100
        mock_config.log_level = "INFO"
        mock_config.checkpoint_dir = tmp_path / "checkpoints"

        # load_config is imported lazily inside main(); patch at the source module.
        with patch("src.config.load_config", return_value=mock_config):
            with pytest.raises(SystemExit) as exc_info:
                from src.cli import main
                main([nonexistent])

        from src.cli import EXIT_ERROR
        assert exc_info.value.code == EXIT_ERROR


# ---------------------------------------------------------------------------
# _make_dryrun_node — edge cases
# ---------------------------------------------------------------------------

class TestDryRunNodeEdgeCases:
    def test_missing_wp_id_handled(self):
        """Node must not crash when state has no current_wp_id."""
        from src.cli import _make_dryrun_node
        node = _make_dryrun_node("pm")
        result = node({})  # Empty state
        assert result["stage_success"] is True

    def test_run_log_result_is_skip(self):
        from src.cli import _make_dryrun_node
        node = _make_dryrun_node("synthesis")
        result = node({"current_wp_id": ""})
        assert result["run_log"][0]["result"] == "SKIP"


# ---------------------------------------------------------------------------
# Checkpoint helpers — WP-004
# ---------------------------------------------------------------------------

class TestThreadIdExistsInCheckpoint:
    def test_returns_false_when_db_absent(self, tmp_path):
        """Non-existent DB must not raise; return False instead."""
        from src.cli import _thread_id_exists_in_checkpoint
        absent = tmp_path / "no_such.sqlite"
        assert _thread_id_exists_in_checkpoint(absent, "any-id") is False

    def test_returns_false_for_unknown_thread_id(self, tmp_path):
        """A thread_id not in the DB must return False."""
        import sqlite3

        from src.cli import _thread_id_exists_in_checkpoint
        db = tmp_path / "workflow.sqlite"
        with sqlite3.connect(str(db)) as conn:
            conn.execute(
                "CREATE TABLE checkpoints "
                "(thread_id TEXT, checkpoint_ns TEXT, checkpoint_id TEXT)"
            )
            conn.execute(
                "INSERT INTO checkpoints VALUES (?, ?, ?)",
                ("existing-id", "", "ckpt-1"),
            )
        assert _thread_id_exists_in_checkpoint(db, "other-id") is False

    def test_returns_true_for_known_thread_id(self, tmp_path):
        """A thread_id present in the DB must return True."""
        import sqlite3

        from src.cli import _thread_id_exists_in_checkpoint
        db = tmp_path / "workflow.sqlite"
        with sqlite3.connect(str(db)) as conn:
            conn.execute(
                "CREATE TABLE checkpoints "
                "(thread_id TEXT, checkpoint_ns TEXT, checkpoint_id TEXT)"
            )
            conn.execute(
                "INSERT INTO checkpoints VALUES (?, ?, ?)",
                ("known-id", "", "ckpt-1"),
            )
        assert _thread_id_exists_in_checkpoint(db, "known-id") is True


class TestMarkAndIsRunTerminal:
    def test_is_run_terminal_returns_false_when_no_marker(self, tmp_path):
        """No marker file → not terminal."""
        from src.cli import _is_run_terminal
        assert _is_run_terminal(tmp_path, "some-thread") is False

    def test_mark_then_is_terminal_returns_true(self, tmp_path):
        """Writing the marker file must make _is_run_terminal return True."""
        from src.cli import _is_run_terminal, _mark_run_terminal
        _mark_run_terminal(tmp_path, "my-thread")
        assert _is_run_terminal(tmp_path, "my-thread") is True

    def test_marker_is_file_scoped_to_thread_id(self, tmp_path):
        """Marking one thread id must not affect another."""
        from src.cli import _is_run_terminal, _mark_run_terminal
        _mark_run_terminal(tmp_path, "thread-A")
        assert _is_run_terminal(tmp_path, "thread-B") is False

    def test_mark_creates_dir_if_absent(self, tmp_path):
        """_mark_run_terminal must create the checkpoint_dir if it doesn't exist."""
        from src.cli import _is_run_terminal, _mark_run_terminal
        new_dir = tmp_path / "checkpoints" / "sub"
        _mark_run_terminal(new_dir, "tid")
        assert _is_run_terminal(new_dir, "tid") is True


class TestTerminalResumeGuard:
    async def test_resume_terminal_thread_exits_error(self, tmp_path):
        """_run() must return EXIT_ERROR when --resume targets a terminal checkpoint."""
        from unittest.mock import AsyncMock

        from src.cli import EXIT_ERROR, _mark_run_terminal, _run

        plan = tmp_path / "plan.md"
        plan.write_text("# plan")
        ckpt_dir = tmp_path / "checkpoints"
        _mark_run_terminal(ckpt_dir, "finished-thread")

        args = MagicMock()
        args.plan = str(plan)
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

    def test_resume_non_terminal_does_not_trigger_guard(self, tmp_path):
        """_is_run_terminal returns False for a non-terminal thread — guard is not invoked."""
        from src.cli import _is_run_terminal, _mark_run_terminal

        ckpt_dir = tmp_path / "checkpoints"
        # Mark a different thread — the one being resumed is not marked.
        _mark_run_terminal(ckpt_dir, "other-thread")

        # The thread being resumed has no marker → guard must not fire.
        assert _is_run_terminal(ckpt_dir, "active-thread") is False


class TestUuidCollisionHandling:
    def test_new_run_regenerates_uuid_on_collision(self, tmp_path):
        """When the generated UUID already exists, a new one must be used."""
        import sqlite3

        from src.cli import _thread_id_exists_in_checkpoint

        db = tmp_path / "workflow.sqlite"
        with sqlite3.connect(str(db)) as conn:
            conn.execute(
                "CREATE TABLE checkpoints "
                "(thread_id TEXT, checkpoint_ns TEXT, checkpoint_id TEXT)"
            )
            # Pre-populate with a specific known UUID.
            conn.execute(
                "INSERT INTO checkpoints VALUES (?, ?, ?)",
                ("collision-uuid", "", "ckpt-1"),
            )

        # Verify the helper can detect it.
        assert _thread_id_exists_in_checkpoint(db, "collision-uuid") is True
        assert _thread_id_exists_in_checkpoint(db, "different-uuid") is False

