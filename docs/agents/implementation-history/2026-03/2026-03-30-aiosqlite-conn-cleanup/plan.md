# Plan

## Summary

Close the `aiosqlite` database connection explicitly before the asyncio event loop shuts down. Currently, `build_graph()` and the dry-run path in `_build_graph_for_run()` open an `aiosqlite.connect()` connection for the `AsyncSqliteSaver` checkpointer but never close it. When the event loop terminates, `aiosqlite`'s background worker thread tries to signal via `call_soon_threadsafe` on the already-closed loop, producing a noisy `RuntimeError: Event loop is closed` traceback on stderr after every orchestrator run.

## Architectural Context

The orchestrator builds a LangGraph `StateGraph` with an async SQLite checkpointer for run resumability:

- **`orchestrator/src/graph.py`** — `build_graph()` opens `aiosqlite.connect()`, creates `AsyncSqliteSaver(conn)`, calls `checkpointer.setup()`, and returns the compiled graph. The `conn` reference is consumed by the checkpointer but never exposed to the caller for cleanup.
- **`orchestrator/src/cli.py`** — `_build_graph_for_run()` has a parallel dry-run code path (lines ~270–296) that duplicates the same pattern: opens a connection, creates a checkpointer, compiles a graph, and returns it without exposing `conn`.
- **`orchestrator/src/cli.py`** — `_run_orchestrator()` (lines ~493–670) receives the compiled graph and runs it inside a `try/finally` that cleans up the process lock and run logger, but has **no** cleanup for the database connection.
- **`orchestrator/tests/test_graph.py`** — Existing tests verify graph topology, node count, and async checkpointer type. Tests also open connections via `build_graph()` without explicitly closing them (tolerated in test runners but worth fixing for symmetry).

The `aiosqlite.Connection` object spawns a daemon thread (`_connection_worker_thread`) that communicates with the event loop via `call_soon_threadsafe`. When the loop closes before `conn.close()` is awaited, the thread's pending result-signaling calls fail with `RuntimeError`.

## Approach / Architecture

Change `build_graph()` to return a tuple `(compiled_graph, aiosqlite_conn)` instead of just the compiled graph. The caller (`_run_orchestrator` via `_build_graph_for_run`) receives the connection handle and closes it in the `finally` block after the graph run completes. The dry-run path in `_build_graph_for_run()` gets the same treatment.

The change is small and scoped to the graph-build → graph-run → cleanup lifecycle.

## Rationale

- **Minimal change surface:** Returning the connection alongside the graph is the simplest approach — no new abstractions, no context managers wrapping the graph compilation.
- **Explicit resource management:** Relying on garbage collection or daemon thread teardown for database connections is fragile, especially under Python 3.14 where asyncio cleanup ordering may differ from earlier versions.
- **Cosmetic but professional:** The traceback prints after the run summary and is the last thing the user sees. Eliminating it improves the orchestrator's perceived reliability.

## Detailed Steps

### Step 1: Update `build_graph()` return type

In `orchestrator/src/graph.py`:

1. Change the return type annotation from `CompiledGraph` to `tuple[CompiledGraph, aiosqlite.Connection]`.
2. Update the docstring's `Returns` section to document the tuple.
3. Change `return builder.compile(...)` to `return builder.compile(...), conn`.

### Step 2: Update `_build_graph_for_run()` in `cli.py`

In `orchestrator/src/cli.py`, function `_build_graph_for_run()`:

1. **Dry-run path:** Change the return to `return builder.compile(...), conn`.
2. **Normal path:** Unpack the result from `build_graph()` and pass it through: `graph, conn = await build_graph(...); return graph, conn`.
3. Update the return type annotation to `tuple[CompiledGraph, aiosqlite.Connection]`.

### Step 3: Close the connection in `_run_orchestrator()`

In `orchestrator/src/cli.py`, function `_run_orchestrator()`:

1. Unpack the result: `graph, db_conn = await _build_graph_for_run(...)`.
2. Wrap the graph execution in a `try/finally` that calls `await db_conn.close()` in the `finally` block. Place this inside the existing `async with MCPToolkit.from_config(config)` block, after the `_build_graph_for_run` call, ensuring the connection is closed before the MCP toolkit context exits.

### Step 4: Update `test_graph.py`

In `orchestrator/tests/test_graph.py`:

1. Update all test functions that call `build_graph()` to unpack the tuple: `graph, conn = await build_graph(...)`.
2. Add `await conn.close()` in each test (or add a shared fixture/teardown) to ensure clean connection closure in the test suite as well.
3. Add one new test `test_conn_is_aiosqlite_connection` that asserts the second return value is an `aiosqlite.Connection` instance.

### Step 5: Validate

1. Run `python3 -m pytest tests/test_graph.py -v` — all existing + new tests pass.
2. Run `python3 -m pytest tests/test_cli.py -v` — no regressions in CLI tests.
3. Run a dry-run orchestrator execution and verify no `RuntimeError: Event loop is closed` traceback appears on stderr.

## Dependencies

- None. This is a self-contained change within the orchestrator sub-project.

## Required Components

- `orchestrator/src/graph.py` — modify return value
- `orchestrator/src/cli.py` — modify `_build_graph_for_run()` and `_run_orchestrator()`
- `orchestrator/tests/test_graph.py` — update test unpacking + new test

## Assumptions

- `aiosqlite.Connection.close()` is idempotent and safe to call even if the connection was already closed by a different code path.
- The compiled graph does not retain exclusive use of the connection after `ainvoke()` returns — closing it post-run is safe.
- No other code path outside `_run_orchestrator()` calls `build_graph()` directly in production (confirmed: only `_build_graph_for_run()` calls it, and only `_run_orchestrator()` calls that).

## Constraints

- Must follow the orchestrator's existing patterns: no new abstractions, no new dependencies.
- Must not change the graph topology, node behaviour, or checkpointer type.
- Cross-platform: `aiosqlite` is pure-Python and cross-platform; `conn.close()` works identically on all platforms.

## Out of Scope

- Refactoring the checkpointer into a context manager pattern (e.g., `async with AsyncSqliteSaver.from_conn_string(...)`) — this would be a larger change better suited for a future LangGraph API migration.
- Addressing the duplicated graph-build logic between `_build_graph_for_run()` dry-run path and `build_graph()` — that's a separate refactoring concern.
- Upgrading `aiosqlite` or `langgraph-checkpoint-sqlite` versions.

## Acceptance Criteria

- `build_graph()` returns `(CompiledGraph, aiosqlite.Connection)`.
- `_build_graph_for_run()` returns `(CompiledGraph, aiosqlite.Connection)` in both dry-run and normal paths.
- `_run_orchestrator()` awaits `conn.close()` in a `finally` block after graph execution.
- All existing tests in `test_graph.py` and `test_cli.py` pass with the updated signature.
- One new test verifies the second return value is an `aiosqlite.Connection`.
- No `RuntimeError: Event loop is closed` traceback appears after a dry-run orchestrator execution.

## Testing Strategy

- **Unit tests (`test_graph.py`):** Update existing tests to unpack the new return tuple. Add a test asserting the connection type. Ensure proper cleanup with `await conn.close()` in each test.
- **CLI tests (`test_cli.py`):** Run the existing test suite to confirm no regressions from the signature change (these tests mock `build_graph`/`_build_graph_for_run`, so the actual return type change should be transparent if mocks are updated).
- **Manual verification:** Run `node scripts/cli.js orchestrate -- --dry-run --plan <any-plan>` and confirm clean exit without `RuntimeError` on stderr.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Existing tests break from tuple unpacking** | Mechanical update — every call site simply adds `, conn` to the unpacking. Low risk. |
| **CLI tests mock `_build_graph_for_run`** | Update mock return values to return `(mock_graph, mock_conn)` tuples. |
| **`conn.close()` called while graph is still using it** | Not possible — `conn.close()` is in the `finally` after `graph.ainvoke()` completes or raises. The graph is fully done before cleanup runs. |
| **Double-close if LangGraph closes the connection internally** | `aiosqlite.Connection.close()` is safe to call multiple times (second call is a no-op). |
