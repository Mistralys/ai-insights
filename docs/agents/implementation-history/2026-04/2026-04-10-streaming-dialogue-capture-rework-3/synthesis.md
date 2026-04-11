## Synthesis

### Completion Status
- Status: COMPLETE
- Completed by: Standalone Developer Agent

### Implementation Summary
- Added `TestSignalInterruptedRun` integration test class to `orchestrator/tests/test_cli.py` — the sole remaining gap from the streaming dialogue capture synthesis (recommendation #7).
- The test fires a real `SIGTERM` via `loop.call_later()` during a mock `_run()` execution, exercising the `asyncio.wait` race between `graph_task` and `wait_task`.
- Asserts: exit code is `EXIT_ERROR` (1), a `signal_shutdown` JSONL entry is emitted with `result="INTERRUPTED"`, and the run is NOT marked terminal (remains resumable via `--resume`).
- Test is platform-guarded (`@pytest.mark.skipif(sys.platform == "win32")`) and restores default signal handlers in teardown.
- Added `signal_shutdown` event to the CLI events table in `orchestrator/docs/agents/project-manifest/api-surface.md` — this event was previously undocumented.

### Documentation Updates
- Updated `orchestrator/docs/agents/project-manifest/api-surface.md`: added `signal_shutdown` row to the CLI events table with full field reference and integration test cross-reference.

### Verification Summary
- Tests run: `pytest` (full suite) — 871 passed, 6 skipped, 0 failures.
- New test: `TestSignalInterruptedRun::test_sigterm_interrupts_run_and_emits_signal_shutdown` — PASSED.
- Static analysis: `ruff check tests/test_cli.py` — 0 violations (all checks passed). Pre-existing violations in other files (`test_nodes.py`, `test_revision.py`, `test_subagents.py`) are unchanged and out-of-scope.
- Result: PASS

### Code Insights
- [low] (improvement) `orchestrator/tests/test_cli.py`: The `TestTerminalResumeGuard.test_resume_terminal_thread_exits_error` test at line ~400 uses the deprecated `asyncio.coroutine` pattern indirectly via `AsyncMock` from `unittest.mock` — however it works on Python 3.14. No action needed currently, but worth monitoring if older test patterns surface similar issues.
- [low] (debt) `orchestrator/tests/test_revision.py`: Has an unused `import pytest` flagged by ruff (`F401`). Pre-existing; not introduced by this change.
- [low] (debt) `orchestrator/tests/test_subagents.py`: Has an unused `import textwrap` flagged by ruff (`F401`) and one line exceeding 100 chars (`E501`). Pre-existing; not introduced by this change.
- [low] (debt) `orchestrator/tests/test_nodes.py`: Has pre-existing `E402` (import not at top) and `E501` (line too long) violations. Not introduced by this change.

### Additional Comments
- The test uses `AsyncMock` for `mock_db_conn.close` and the `MCPToolkit` context manager methods, which is the correct pattern for Python 3.14 where `asyncio.coroutine` has been removed.
- The SIGTERM delay of 50ms (`call_later(0.05)`) proved reliable across test runs. The slow mock graph sleeps for 10s, providing ample margin for the race to resolve deterministically.
- Running the full suite twice consecutively confirmed no signal handler leakage between tests.
