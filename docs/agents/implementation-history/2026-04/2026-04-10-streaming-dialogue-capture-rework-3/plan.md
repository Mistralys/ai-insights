# Plan

## Summary

Follow-up plan addressing the seven strategic recommendations from the `2026-04-10-streaming-dialogue-capture` synthesis document. A thorough codebase review reveals that **six of the seven recommendations were already implemented** during the original session (or the subsequent rework cycles). The single remaining gap — an end-to-end integration test for the signal-interrupted shutdown path — is the sole deliverable of this plan.

## Architectural Context

The streaming dialogue capture system spans two sub-projects:

- **Orchestrator** (`orchestrator/src/`): Python LangGraph pipeline containing `cli.py` (signal handling + `asyncio.wait` race), `nodes/__init__.py` (astream loop + ChunkWriter), and `utils/chunk_writer.py`.
- **MCP Server GUI** (`mcp-server/gui/`): TypeScript API handlers and frontend JS that fetch and render chunk data.

Signal handling lives in `_register_signal_handlers()` ([orchestrator/src/cli.py](orchestrator/src/cli.py#L94-L155)), which sets an `asyncio.Event` on SIGTERM/SIGINT. The `_run()` function races `graph_task` against `wait_task` via `asyncio.wait(return_when=FIRST_COMPLETED)` ([orchestrator/src/cli.py](orchestrator/src/cli.py#L647-L655)). When the signal fires first, the graph task is cancelled and a `signal_shutdown` JSONL entry is emitted.

Existing unit tests for signal handling live in `TestRegisterSignalHandlers` ([orchestrator/tests/test_cli.py](orchestrator/tests/test_cli.py#L458)) — 6 tests covering handler registration, event-setting, and platform fallbacks. No test exercises the race path at the `_run()` level.

## Synthesis Recommendation Verification Results

| # | Recommendation | Status | Evidence |
|---|---|---|---|
| 1 | Shared Revision-Numbering Helper | **DONE** | `next_revision()` extracted to [orchestrator/src/utils/_revision.py](orchestrator/src/utils/_revision.py). Both `chunk_writer.py` and `dialogue_writer.py` import from it. Tests in [orchestrator/tests/test_revision.py](orchestrator/tests/test_revision.py). |
| 2 | `_CHUNK_HEADER` Mutation Risk | **DONE** | Wrapped in `types.MappingProxyType` at [orchestrator/src/utils/chunk_writer.py](orchestrator/src/utils/chunk_writer.py#L65-L69). `dict()` conversion added for `json.dumps` compatibility (line 121). |
| 3 | `write_chunk()` TypeError Suppression | **DONE** | `except (OSError, TypeError)` clause at [orchestrator/src/utils/chunk_writer.py](orchestrator/src/utils/chunk_writer.py#L148-L153). Docstring updated to document both exception types. |
| 4 | `AIMessageChunk` with `id=None` Silent Drop | **DONE** | `log.debug` warning emitted at [orchestrator/src/nodes/__init__.py](orchestrator/src/nodes/__init__.py#L417-L422). Chunks with `None` ID are dropped during message reconstruction by the `if _msg_id` guard. |
| 5 | Frontend Chunk-Priority Test Gap | **DONE** | `describe('Chunk-priority path (useChunks=true)')` block at [mcp-server/tests/gui/dialogue-qa.test.ts](mcp-server/tests/gui/dialogue-qa.test.ts#L709) with 3 tests: data source selection, click-renders-chunk, and priority-over-dialogues. |
| 6 | `getChunks()`/`getDialogues()` Stale `wpId` Guard | **DONE** | Both functions use `buildQueryString({ wp: wpId })` which filters `undefined`. Tests at [mcp-server/tests/gui/dialogue-qa.test.ts](mcp-server/tests/gui/dialogue-qa.test.ts#L810-L840) verify no `?wp=undefined` reaches the URL. |
| 7 | Signal-Interrupted Runs Integration Test | **OPEN** | Only unit tests exist. No test fires a real SIGTERM against the `asyncio.wait` race in `_run()`. |

### Additional Next-Step Verification

| Next-Step Item | Status | Evidence |
|---|---|---|
| Disable Phase 1 Markdown render | **DONE** | `write_dialogue` is no longer called from `nodes/__init__.py`. `dialogue_writer.py` docstring confirms: "the automated pipeline no longer calls `write_dialogue()`". |
| Add `@vitest/coverage-v8` | **DONE** | Already in `mcp-server/package.json` devDependencies; `test:coverage` script present. |
| Chunk replay tooling | **DEFERRED** | Speculative / long-term. No implementation needed now. |

## Approach / Architecture

The sole remaining work is an **integration test for the signal-interrupted shutdown path** in `orchestrator/tests/test_cli.py`. This test should:

1. Start a mock graph execution via `_run()` (or a close proxy) with a slow/blocking mock agent.
2. Fire `SIGTERM` (or set `shutdown_event` directly) after the graph task starts.
3. Assert: `shutdown_event.is_set()`, graph task is cancelled, `signal_shutdown` JSONL entry is emitted with `result="INTERRUPTED"`, and exit code is `1`.
4. Assert: the run is **not** marked terminal (remains resumable).

The test should use existing test infrastructure (`conftest.py` fixtures, mock config/state) and a synthetic `AsyncIterator` agent to avoid real LLM calls. It should be platform-guarded (`pytest.mark.skipif(sys.platform == "win32")`) since `loop.add_signal_handler()` is Unix-only.

## Rationale

- This is the last untested happy path from the streaming dialogue capture delivery.
- The `asyncio.wait` race between `graph_task` and `wait_task` is the most complex control-flow section in `cli.py`. An integration-level test validates the interaction between signal registration, event propagation, task cancellation, and JSONL logging — none of which the existing unit tests cover together.
- Since all other synthesis recommendations are already resolved, this plan is intentionally narrow in scope.

## Detailed Steps

1. **Add a new test class** `TestSignalInterruptedRun` in [orchestrator/tests/test_cli.py](orchestrator/tests/test_cli.py) (or a dedicated `test_signal_integration.py` if the file is too large).
2. **Create a mock slow agent** — an `AsyncIterator` that yields `AIMessageChunk` fragments with controlled delays, long enough for the signal to fire before completion.
3. **Create a mock config** — use `_StreamCaptureConfig` or similar from `conftest.py` with `max_iterations=1`, a temp `slug_dir`, and a temp `checkpoint_dir`.
4. **Wire a mock graph** — patch `build_graph()` to return a compilable LangGraph that invokes the slow agent via `create_stage_node`.
5. **Fire SIGTERM during execution** — use `asyncio.get_event_loop().call_later()` to send `os.kill(os.getpid(), signal.SIGTERM)` after a short delay, or directly set the `shutdown_event` to test the race path.
6. **Assert correctness:**
   - `shutdown_event.is_set()` after the run.
   - The graph task did not complete normally (was cancelled).
   - The run log JSONL contains a `signal_shutdown` entry with `result="INTERRUPTED"`.
   - The terminal marker file does **not** exist (run remains resumable).
   - Exit code is `1` (if testing the CLI entry point).
7. **Platform guard** — mark the test with `@pytest.mark.skipif(sys.platform == "win32", reason="add_signal_handler unavailable on Windows")`.
8. **Run the full test suite** (`pytest`) to confirm no regressions.
9. **Update [orchestrator/docs/agents/project-manifest/api-surface.md](orchestrator/docs/agents/project-manifest/api-surface.md)** to note the integration test coverage of the signal path.

## Dependencies

- Existing `conftest.py` test fixtures and mock infrastructure.
- `asyncio` signal handling (Unix-only — test will be skipped on Windows).

## Required Components

- [orchestrator/tests/test_cli.py](orchestrator/tests/test_cli.py) — new test class (or new file `test_signal_integration.py`).
- [orchestrator/src/cli.py](orchestrator/src/cli.py) — read-only reference; `_run()` internals at lines 640-700.
- [orchestrator/tests/conftest.py](orchestrator/tests/conftest.py) — existing mock config/state fixtures.
- [orchestrator/docs/agents/project-manifest/api-surface.md](orchestrator/docs/agents/project-manifest/api-surface.md) — documentation update.

## Assumptions

- The `asyncio.wait` race path in `_run()` is testable without a real MCP server by mocking `build_graph()` and the MCP tool provider.
- `os.kill(os.getpid(), signal.SIGTERM)` inside a pytest session is safe when signal handlers are properly restored in teardown.
- The existing `TestRegisterSignalHandlers` cleanup pattern (removing signal handlers after each test) is sufficient to isolate the new test.

## Constraints

- Test must be Unix-only (skip on Windows) due to `loop.add_signal_handler()` limitation.
- No real LLM or MCP server calls — all interactions must be mocked.
- Must not leave orphan signal handlers that affect other tests.
- Cross-platform policy: the test itself is platform-specific, but it must use `pytest.mark.skipif` rather than failing on Windows.

## Out of Scope

- Recommendations #1–6 from the synthesis (all verified resolved).
- Chunk replay tooling (deferred to future work).
- Windows signal integration testing (not feasible due to `add_signal_handler` limitation).
- Phase 1 Markdown render removal (already done).
- Vitest coverage configuration (already done).

## Acceptance Criteria

- A new integration test fires a signal against the `_run()` race path and asserts: shutdown event is set, graph task is cancelled, `signal_shutdown` JSONL entry is emitted, run is not marked terminal.
- The test is platform-guarded (`skipif win32`).
- The test properly cleans up signal handlers in teardown.
- All existing tests pass (`pytest` — 837+ tests, 0 failures).
- Ruff reports 0 violations.
- The `api-surface.md` manifest is updated to reflect the new test coverage.

## Testing Strategy

The deliverable **is** a test. Validation is:

1. Run `pytest orchestrator/tests/test_cli.py -v` (or the new file) — new test passes.
2. Run `pytest` (full suite) — all tests pass, no regressions.
3. Run `ruff check orchestrator/` — 0 violations.
4. Manual review: confirm signal handler teardown does not leak into subsequent tests by running the full suite twice consecutively.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **`os.kill(SIGTERM)` disrupts pytest session** | Restore default signal handlers in test teardown (proven pattern from existing `TestRegisterSignalHandlers`). Alternatively, set `shutdown_event` directly to test the race path without sending a real signal. |
| **Flaky timing in `asyncio.wait` race** | Use `loop.call_soon()` or `call_later(0)` for deterministic ordering rather than relying on wall-clock delays. |
| **Mock graph complexity** | Keep the mock minimal — a single-node graph with a slow `asyncio.sleep` coroutine is sufficient. |
| **Test isolation** | Use a fresh event loop per test (`@pytest.mark.asyncio`) and ensure `shutdown_event` is a new `asyncio.Event` instance. |
