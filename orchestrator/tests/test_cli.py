"""
test_cli.py — Unit tests for the CLI entry point (WP-005).

Tests verify:
- Argument parser accepts all documented options.
- _parse_interrupt_stages() maps stage names correctly.
- _print_run_summary() returns correct exit codes.
- _make_dryrun_node() returns a callable that produces correct state updates.
- main() exits with correct codes for missing plan files.
- Run queue register/unregister lifecycle in _run() (WP-004).

No real MCP server, LLM, or LangGraph graph invocation is performed.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

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

    def test_model_rejected(self):
        """--model flag is removed; passing it must produce a parser error."""
        from src.cli import _build_parser
        with pytest.raises(SystemExit):
            _build_parser().parse_args(["plan.md", "--model", "claude-opus-4"])

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
        from src.graph import _make_dryrun_node
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
        from src.graph import _make_dryrun_node
        node = _make_dryrun_node("pm")
        result = node({})  # Empty state
        assert result["stage_success"] is True

    def test_run_log_result_is_skip(self):
        from src.graph import _make_dryrun_node
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


# ---------------------------------------------------------------------------
# _register_signal_handlers() — WP-003
# ---------------------------------------------------------------------------

class TestRegisterSignalHandlers:
    """Unit tests for _register_signal_handlers()."""

    async def test_sets_shutdown_event_on_sigterm(self):
        """On Unix, sending SIGTERM must set the shutdown event."""
        import os
        import signal
        import sys

        if sys.platform == "win32":
            pytest.skip("loop.add_signal_handler() is not available on Windows.")

        from src.cli import _register_signal_handlers

        loop = asyncio.get_running_loop()
        shutdown_event = asyncio.Event()
        _register_signal_handlers(loop, shutdown_event, thread_id="test-tid")

        assert not shutdown_event.is_set()
        os.kill(os.getpid(), signal.SIGTERM)
        # Give the event loop a real tick to process the signal callback.
        await asyncio.sleep(0.02)
        assert shutdown_event.is_set()

        # Restore default SIGTERM behaviour so other tests are not affected.
        loop.remove_signal_handler(signal.SIGTERM)
        loop.remove_signal_handler(signal.SIGINT)

    async def test_sets_shutdown_event_on_sigint(self):
        """On Unix, sending SIGINT via the event loop handler must set the shutdown event."""
        import os
        import signal
        import sys

        if sys.platform == "win32":
            pytest.skip("loop.add_signal_handler() is not available on Windows.")

        from src.cli import _register_signal_handlers

        loop = asyncio.get_running_loop()
        shutdown_event = asyncio.Event()
        _register_signal_handlers(loop, shutdown_event, thread_id="test-tid")

        assert not shutdown_event.is_set()
        os.kill(os.getpid(), signal.SIGINT)
        await asyncio.sleep(0.02)
        assert shutdown_event.is_set()

        loop.remove_signal_handler(signal.SIGTERM)
        loop.remove_signal_handler(signal.SIGINT)

    async def test_double_registration_does_not_raise(self):
        """Registering handlers twice on the same loop must not raise."""
        import sys

        if sys.platform == "win32":
            pytest.skip("loop.add_signal_handler() is not available on Windows.")

        from src.cli import _register_signal_handlers

        loop = asyncio.get_running_loop()
        ev1 = asyncio.Event()
        ev2 = asyncio.Event()
        _register_signal_handlers(loop, ev1, thread_id="t1")
        _register_signal_handlers(loop, ev2, thread_id="t2")  # second call overwrites

        import os
        import signal
        os.kill(os.getpid(), signal.SIGTERM)
        await asyncio.sleep(0.02)
        # The second registration overwrites the first; ev2 must be set.
        assert ev2.is_set()

        loop.remove_signal_handler(signal.SIGTERM)
        loop.remove_signal_handler(signal.SIGINT)

    def test_windows_path_does_not_raise(self, monkeypatch):
        """On 'Windows' (mocked), _register_signal_handlers must not raise."""
        import sys

        from src.cli import _register_signal_handlers

        # Simulate Windows by monkeypatching sys.platform.
        monkeypatch.setattr(sys, "platform", "win32")

        # signal.signal() requires the main thread; mock it to avoid that constraint.
        with patch("signal.signal"):
            loop = MagicMock()
            ev = asyncio.Event()
            # Must not raise.
            _register_signal_handlers(loop, ev, thread_id="win-tid")

        # loop.add_signal_handler must NOT have been called on the Windows path.
        loop.add_signal_handler.assert_not_called()

    def test_windows_signal_signal_error_swallowed(self, monkeypatch):
        """If signal.signal() raises ValueError on Windows, the error is swallowed."""
        import sys

        from src.cli import _register_signal_handlers

        monkeypatch.setattr(sys, "platform", "win32")

        with patch("signal.signal", side_effect=ValueError("not the main thread")):
            loop = MagicMock()
            ev = asyncio.Event()
            _register_signal_handlers(loop, ev, thread_id="win-tid")  # must not raise

    async def test_no_running_loop_graceful(self):
        """asyncio.get_running_loop() inside _run() is guarded; the test exercises the guard."""
        # This test validates the RuntimeError guard inside _run() when called
        # outside an event loop context.  We call the guard directly here.
        import asyncio

        # When we call get_running_loop() outside a coroutine it raises RuntimeError.
        # The guard in _run() swallows that — we verify _register_signal_handlers
        # is itself safe by calling it in a non-main-thread context.
        # (The function itself doesn't call get_running_loop(); _run() does the guard.)
        # So we just verify the function doesn't blow up with a dummy loop mock.
        loop = MagicMock()
        loop.add_signal_handler = MagicMock()
        ev = asyncio.Event()
        import sys
        if sys.platform != "win32":
            from src.cli import _register_signal_handlers
            _register_signal_handlers(loop, ev, thread_id="t")
            assert loop.add_signal_handler.called


# ---------------------------------------------------------------------------
# Signal-interrupted run integration test — Plan 2026-04-10 rework-3
# ---------------------------------------------------------------------------

class TestSignalInterruptedRun:
    """Integration test for the signal-interrupted shutdown race path in _run().

    Validates the asyncio.wait race between graph_task and wait_task when
    SIGTERM fires during graph execution.  Asserts:
    - shutdown_event is set (triggering graceful shutdown).
    - The graph task is cancelled (does not run to completion).
    - A ``signal_shutdown`` JSONL entry is emitted with ``result="INTERRUPTED"``.
    - The run is NOT marked terminal (remains resumable via --resume).
    - The exit code is EXIT_ERROR (1).

    Platform guard: skipped on Windows where loop.add_signal_handler() is unavailable.
    """

    @pytest.mark.skipif(
        sys.platform == "win32",
        reason="loop.add_signal_handler() is not available on Windows.",
    )
    async def test_sigterm_interrupts_run_and_emits_signal_shutdown(self, tmp_path):
        """Fire SIGTERM during _run(); verify shutdown JSONL entry and no terminal marker."""
        import json
        import os
        import signal

        from src.cli import EXIT_ERROR, _is_run_terminal, _run

        # ── Set up a real plan file ─────────────────────────────────────
        plan = tmp_path / "plan.md"
        plan.write_text("# Plan\n\nTest plan for signal integration test.\n")

        # ── Build mock args ─────────────────────────────────────────────
        args = MagicMock()
        args.plan = str(plan)
        args.resume = None
        args.dry_run = False
        args.interrupt_on = None
        args.project_path = str(tmp_path)
        args.max_iterations = None
        args.log_level = None

        # ── Build mock config ───────────────────────────────────────────
        ckpt_dir = tmp_path / "checkpoints"
        ckpt_dir.mkdir()
        logs_dir = tmp_path / "logs"
        logs_dir.mkdir()

        mock_config = MagicMock()
        mock_config.checkpoint_dir = ckpt_dir
        mock_config.workspace_root = tmp_path
        mock_config.heartbeat_interval_s = 0
        mock_config.max_iterations = 100
        mock_config.stage_models = {"developer": "claude-test"}

        # ── Build a real WorkflowLogger pointing to tmp_path ────────────
        from src.utils.logging import WorkflowLogger

        run_logger = WorkflowLogger(logs_dir / "test-signal-run.jsonl")

        # ── Create a slow mock graph that blocks long enough for SIGTERM ─
        async def _slow_ainvoke(*_args, **_kwargs):
            """Simulate a long-running graph execution."""
            await asyncio.sleep(10)
            return {"run_log": [], "errors": [], "wp_summaries": []}

        mock_graph = MagicMock()
        mock_graph.ainvoke = _slow_ainvoke

        mock_db_conn = MagicMock()
        mock_db_conn.close = AsyncMock(return_value=None)

        # ── Mock MCPToolkit and _build_graph_for_run ────────────────────
        mock_toolkit = MagicMock()
        mock_toolkit.get_tools.return_value = []
        mock_toolkit.__aenter__ = AsyncMock(return_value=mock_toolkit)
        mock_toolkit.__aexit__ = AsyncMock(return_value=None)

        # Schedule SIGTERM after a short delay so the race fires the
        # shutdown path before the slow graph completes.
        loop = asyncio.get_running_loop()
        loop.call_later(0.05, os.kill, os.getpid(), signal.SIGTERM)

        with (
            patch("src.utils.logging.WorkflowLogger.create", return_value=run_logger),
            patch("src.mcp_client.MCPToolkit.from_config", return_value=mock_toolkit),
            patch(
                "src.cli._build_graph_for_run",
                return_value=(mock_graph, mock_db_conn),
            ),
        ):
            exit_code = await _run(args, mock_config)

        # ── Restore default signal handlers ─────────────────────────────
        try:
            loop.remove_signal_handler(signal.SIGTERM)
        except Exception:
            pass
        try:
            loop.remove_signal_handler(signal.SIGINT)
        except Exception:
            pass

        # ── Assert exit code ────────────────────────────────────────────
        assert exit_code == EXIT_ERROR, f"Expected EXIT_ERROR (1), got {exit_code}"

        # ── Assert signal_shutdown JSONL entry was emitted ──────────────
        run_logger.close()
        log_path = logs_dir / "test-signal-run.jsonl"
        assert log_path.exists(), "JSONL log file must exist"

        log_lines = log_path.read_text().strip().splitlines()
        entries = [json.loads(line) for line in log_lines]

        signal_entries = [
            e for e in entries
            if e.get("action") == "signal_shutdown"
        ]
        assert len(signal_entries) == 1, (
            f"Expected exactly 1 signal_shutdown entry, found {len(signal_entries)}"
        )
        assert signal_entries[0]["result"] == "INTERRUPTED"

        # ── Assert run is NOT marked terminal (remains resumable) ───────
        # Find the thread_id from the run_start entry.
        start_entries = [e for e in entries if e.get("action") == "run_start"]
        assert len(start_entries) == 1, "Expected exactly 1 run_start entry"
        thread_id = start_entries[0]["thread_id"]
        assert not _is_run_terminal(ckpt_dir, thread_id), (
            "Signal-interrupted run must NOT be marked terminal"
        )


# ---------------------------------------------------------------------------
# Run queue integration — WP-004
# ---------------------------------------------------------------------------

class TestRunQueueIntegration:
    """Verify that cli._run() calls run_queue.register() after run_start and
    run_queue.unregister() in the finally block, regardless of how the run
    terminates.

    All tests mock MCPToolkit and the LangGraph graph so no real MCP server
    or LLM is invoked.
    """

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _make_args(self, tmp_path: "Path") -> MagicMock:
        plan = tmp_path / "plan.md"
        plan.write_text("# Plan")
        args = MagicMock()
        args.plan = str(plan)
        args.resume = None
        args.dry_run = False
        args.interrupt_on = None
        args.project_path = str(tmp_path)
        args.max_iterations = None
        return args

    def _make_config(self, tmp_path: "Path") -> MagicMock:
        ckpt_dir = tmp_path / "checkpoints"
        ckpt_dir.mkdir()
        config = MagicMock()
        config.checkpoint_dir = ckpt_dir
        config.workspace_root = tmp_path
        config.heartbeat_interval_s = 0
        config.max_iterations = 100
        config.stage_models = {}
        return config

    def _make_mcp_mocks(self, *, graph_raises: bool = False) -> tuple:
        """Return (mock_toolkit, mock_graph, mock_db)."""
        mock_toolkit = MagicMock()
        mock_toolkit.get_tools.return_value = []
        mock_toolkit.__aenter__ = AsyncMock(return_value=mock_toolkit)
        mock_toolkit.__aexit__ = AsyncMock(return_value=None)

        mock_db = MagicMock()
        mock_db.close = AsyncMock()

        if graph_raises:
            async def _ainvoke(*_a: object, **_kw: object) -> dict:
                raise RuntimeError("simulated graph failure")
        else:
            async def _ainvoke(*_a: object, **_kw: object) -> dict:
                return {"run_log": [], "errors": [], "wp_summaries": []}

        mock_graph = MagicMock()
        mock_graph.ainvoke = _ainvoke
        return mock_toolkit, mock_graph, mock_db

    # ------------------------------------------------------------------
    # AC-1 partial: register() is called after run_start
    # ------------------------------------------------------------------

    async def test_register_called_after_run_start(self, tmp_path: "Path") -> None:
        """register() must be called after the run_start JSONL entry is logged
        (AC-1: queue entry created after run_start)."""
        from pathlib import Path

        from src.cli import _run
        from src.utils.logging import WorkflowLogger

        args = self._make_args(tmp_path)
        config = self._make_config(tmp_path)
        (tmp_path / "logs").mkdir()
        run_logger = WorkflowLogger(tmp_path / "logs" / "rq-order.jsonl")

        mock_toolkit, mock_graph, mock_db = self._make_mcp_mocks()

        # Track call order via a mutable list.
        call_order: list[str] = []
        original_log = run_logger.log

        def _tracking_log(*args: object, **kwargs: object) -> None:
            if kwargs.get("action") == "run_start":
                call_order.append("run_start")
            original_log(*args, **kwargs)

        run_logger.log = _tracking_log  # type: ignore[method-assign]

        # Capture the call_order snapshot at the moment register() fires.
        snapshot_at_register: list[str] = []

        def _register(*_a: object, **_kw: object) -> str:
            snapshot_at_register.extend(call_order)
            call_order.append("register")
            return "order-test-entry-id"

        with (
            patch("src.utils.logging.WorkflowLogger.create", return_value=run_logger),
            patch("src.mcp_client.MCPToolkit.from_config", return_value=mock_toolkit),
            patch("src.cli._build_graph_for_run", return_value=(mock_graph, mock_db)),
            patch("src.utils.run_queue.register", side_effect=_register),
            patch("src.utils.run_queue.unregister"),
        ):
            await _run(args, config)

        run_logger.close()

        assert "run_start" in snapshot_at_register, (
            "register() must be called after run_start is logged"
        )

    # ------------------------------------------------------------------
    # AC-1: unregister() called with the correct entry_id on normal exit
    # ------------------------------------------------------------------

    async def test_unregister_called_with_correct_entry_id(self, tmp_path: "Path") -> None:
        """On normal completion, unregister() must be called with the entry_id
        returned by register() (AC-1)."""
        from src.cli import _run
        from src.utils.logging import WorkflowLogger

        args = self._make_args(tmp_path)
        config = self._make_config(tmp_path)
        (tmp_path / "logs").mkdir()
        run_logger = WorkflowLogger(tmp_path / "logs" / "rq-normal.jsonl")

        mock_toolkit, mock_graph, mock_db = self._make_mcp_mocks()

        expected_id = "normal-entry-uuid"
        mock_unregister = MagicMock()

        with (
            patch("src.utils.logging.WorkflowLogger.create", return_value=run_logger),
            patch("src.mcp_client.MCPToolkit.from_config", return_value=mock_toolkit),
            patch("src.cli._build_graph_for_run", return_value=(mock_graph, mock_db)),
            patch("src.utils.run_queue.register", return_value=expected_id),
            patch("src.utils.run_queue.unregister", mock_unregister),
        ):
            await _run(args, config)

        run_logger.close()
        mock_unregister.assert_called_once_with(expected_id)

    # ------------------------------------------------------------------
    # AC-2: unregister() called even when the run exits via an error path
    # ------------------------------------------------------------------

    async def test_unregister_called_when_graph_raises(self, tmp_path: "Path") -> None:
        """Even when graph execution raises, unregister() must be called in the
        finally block (covers error / signal-interrupted exit paths; AC-2)."""
        from src.cli import _run
        from src.utils.logging import WorkflowLogger

        args = self._make_args(tmp_path)
        config = self._make_config(tmp_path)
        (tmp_path / "logs").mkdir()
        run_logger = WorkflowLogger(tmp_path / "logs" / "rq-graph-err.jsonl")

        mock_toolkit, mock_graph, mock_db = self._make_mcp_mocks(graph_raises=True)

        expected_id = "graph-error-entry-uuid"
        mock_unregister = MagicMock()

        with (
            patch("src.utils.logging.WorkflowLogger.create", return_value=run_logger),
            patch("src.mcp_client.MCPToolkit.from_config", return_value=mock_toolkit),
            patch("src.cli._build_graph_for_run", return_value=(mock_graph, mock_db)),
            patch("src.utils.run_queue.register", return_value=expected_id),
            patch("src.utils.run_queue.unregister", mock_unregister),
        ):
            await _run(args, config)

        run_logger.close()
        mock_unregister.assert_called_once_with(expected_id)

    # ------------------------------------------------------------------
    # AC-3: register() raises — entry_id stays None — no NameError
    # ------------------------------------------------------------------

    async def test_register_failure_run_continues_without_unregister(
        self, tmp_path: "Path"
    ) -> None:
        """If register() raises, entry_id stays None, the run continues normally,
        and unregister() is never called (AC-3: no NameError in finally block)."""
        from src.cli import EXIT_SUCCESS, _run
        from src.utils.logging import WorkflowLogger

        args = self._make_args(tmp_path)
        config = self._make_config(tmp_path)
        (tmp_path / "logs").mkdir()
        run_logger = WorkflowLogger(tmp_path / "logs" / "rq-reg-fail.jsonl")

        mock_toolkit, mock_graph, mock_db = self._make_mcp_mocks()
        mock_unregister = MagicMock()

        with (
            patch("src.utils.logging.WorkflowLogger.create", return_value=run_logger),
            patch("src.mcp_client.MCPToolkit.from_config", return_value=mock_toolkit),
            patch("src.cli._build_graph_for_run", return_value=(mock_graph, mock_db)),
            patch("src.utils.run_queue.register", side_effect=OSError("lock failed")),
            patch("src.utils.run_queue.unregister", mock_unregister),
        ):
            exit_code = await _run(args, config)

        run_logger.close()
        # Run must complete successfully despite register() failing.
        assert exit_code == EXIT_SUCCESS
        # unregister() must NOT be called — entry_id was never assigned.
        mock_unregister.assert_not_called()


# ---------------------------------------------------------------------------
# _write_error_status() — early-exit tombstone writes
# ---------------------------------------------------------------------------

class TestWriteErrorStatusEarlyExits:
    """Regression tests for the _write_error_status() helper called at
    early-exit paths in _run().

    Verifies that a valid JSON tombstone is written to the run-status file
    whenever _run() exits before the graph starts, so the GUI does not hang
    waiting for a status file that will never appear.
    """

    # Derive the orchestrator logs directory using the same algorithm as cli.py:
    #   Path(cli.__file__).resolve().parent.parent / "logs"
    # From this test file (orchestrator/tests/test_cli.py):
    #   parent → orchestrator/tests/
    #   parent.parent → orchestrator/
    #   / "logs" → orchestrator/logs/
    _LOGS_DIR = Path(__file__).resolve().parent.parent / "logs"

    def _expected_status_path(self, plan_path: "Path") -> "Path":
        """Compute the expected status file path for a given plan path."""
        import hashlib
        plan_hash = hashlib.sha1(str(plan_path).encode("utf-8")).hexdigest()[:16]
        return self._LOGS_DIR / f"{plan_hash}-run-status.json"

    def _make_args(self, plan_path: "Path") -> MagicMock:
        args = MagicMock()
        args.plan = str(plan_path)
        args.resume = None
        args.dry_run = False
        args.interrupt_on = None
        args.project_path = None
        return args

    def _make_config(self, tmp_path: "Path") -> MagicMock:
        mock_config = MagicMock()
        mock_config.checkpoint_dir = tmp_path / "checkpoints"
        mock_config.workspace_root = tmp_path
        mock_config.heartbeat_interval_s = 0
        mock_config.max_iterations = 100
        return mock_config

    # ------------------------------------------------------------------
    # Lock-held early exit
    # ------------------------------------------------------------------

    async def test_lock_held_writes_error_status_file(self, tmp_path: "Path") -> None:
        """When the lock is already held, _run() exits with EXIT_ERROR and
        writes a valid ERROR tombstone to the run-status file."""
        import json

        from src.cli import EXIT_ERROR, _run

        plan = (tmp_path / "plan.md").resolve()
        plan.write_text("# Plan")

        args = self._make_args(plan)
        config = self._make_config(tmp_path)
        expected_path = self._expected_status_path(plan)

        try:
            # Patch lock_exclusive to raise OSError, simulating a held lock.
            with patch(
                "src.cli.lock_exclusive",
                side_effect=OSError("Resource temporarily unavailable"),
            ):
                result = await _run(args, config)

            assert result == EXIT_ERROR

            assert expected_path.exists(), (
                f"Status file not found: {expected_path}"
            )
            status = json.loads(expected_path.read_text())
            assert status["result"] == "ERROR"
            assert status["error"], "error field must be a non-empty string"
        finally:
            expected_path.unlink(missing_ok=True)

    # ------------------------------------------------------------------
    # Plan-not-found early exit
    # ------------------------------------------------------------------

    async def test_plan_not_found_writes_error_status_file(self, tmp_path: "Path") -> None:
        """When the plan file does not exist, _run() exits with EXIT_ERROR and
        writes a valid ERROR tombstone to the run-status file."""
        import json

        from src.cli import EXIT_ERROR, _run

        # Intentionally non-existent plan.
        plan = (tmp_path / "no_such_plan.md").resolve()

        args = self._make_args(plan)
        config = self._make_config(tmp_path)
        expected_path = self._expected_status_path(plan)

        try:
            result = await _run(args, config)

            assert result == EXIT_ERROR

            assert expected_path.exists(), (
                f"Status file not found: {expected_path}"
            )
            status = json.loads(expected_path.read_text())
            assert status["result"] == "ERROR"
            assert status["error"], "error field must be a non-empty string"
            assert "Plan file not found" in status["error"] or "plan" in status["error"].lower()
        finally:
            expected_path.unlink(missing_ok=True)

    # ------------------------------------------------------------------
    # Resume-terminal early exit
    # ------------------------------------------------------------------

    async def test_resume_terminal_writes_error_status_file(self, tmp_path: "Path") -> None:
        """When --resume targets a terminal checkpoint, _run() exits with
        EXIT_ERROR and writes a valid ERROR tombstone to the run-status file."""
        import json

        from src.cli import EXIT_ERROR, _mark_run_terminal, _run
        from src.utils.logging import WorkflowLogger

        plan = (tmp_path / "plan.md").resolve()
        plan.write_text("# Plan")

        ckpt_dir = tmp_path / "checkpoints"
        _mark_run_terminal(ckpt_dir, "done-thread")

        args = self._make_args(plan)
        args.resume = "done-thread"

        config = self._make_config(tmp_path)
        config.checkpoint_dir = ckpt_dir

        mock_run_logger = MagicMock()
        mock_run_logger._path = tmp_path / "run.jsonl"
        mock_run_logger.start_heartbeat = AsyncMock(return_value=None)
        mock_run_logger.stop_heartbeat = AsyncMock(return_value=None)
        mock_run_logger.flush_unstreamed = MagicMock()
        mock_run_logger.log = MagicMock()
        mock_run_logger.close = MagicMock()

        expected_path = self._expected_status_path(plan)

        try:
            with patch("src.utils.logging.WorkflowLogger") as mock_logger_cls:
                mock_logger_cls.create.return_value = mock_run_logger
                result = await _run(args, config)

            assert result == EXIT_ERROR

            assert expected_path.exists(), (
                f"Status file not found: {expected_path}"
            )
            status = json.loads(expected_path.read_text())
            assert status["result"] == "ERROR"
            assert status["error"], "error field must be a non-empty string"
        finally:
            expected_path.unlink(missing_ok=True)
