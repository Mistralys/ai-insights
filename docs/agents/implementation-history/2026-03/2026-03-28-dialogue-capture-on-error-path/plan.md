# Plan

## Summary

Fix the orchestrator's dialogue capture system so that agent conversations are preserved even when a stage fails. Currently, dialogue capture lives exclusively in the success path of `create_stage_node`; all 26 stage errors in a recent run produced zero dialogue files despite the agents running for up to 14 minutes each. Two complementary changes are needed: (1) convert the `restrict_to_wp` guard from a hard exception to a tool-error response so the agent can self-correct, and (2) add error-path dialogue capture as a safety net for all other exception types.

## Architectural Context

The orchestrator executes pipeline stages via `create_stage_node` in `orchestrator/src/nodes/__init__.py`. Each stage:

1. Prepares tool wrappers (`inject_project_path` → `restrict_to_wp` → `_install_begin_work_tracker` → `log_tool_calls`).
2. Calls `agent.ainvoke()` (the DeepAgent runs, makes tool calls, etc.).
3. **On success:** extracts `result["messages"]`, captures dialogue, logs `stage_complete`.
4. **On error:** catches the exception, logs `stage_error`, attempts pipeline rollback. **No dialogue capture.**

The `restrict_to_wp` wrapper in `orchestrator/src/utils/tool_wrappers.py` raises `ValueError` when the agent sends a tool call targeting a WP different from the active one. This exception propagates out of `agent.ainvoke()` and hits the outer `except` block, bypassing dialogue capture entirely.

**Key files:**
- `orchestrator/src/nodes/__init__.py` — `create_stage_node` factory (lines 100–420)
- `orchestrator/src/utils/tool_wrappers.py` — `restrict_to_wp` function (lines 187–275)
- `orchestrator/src/utils/dialogue_writer.py` — `serialize_messages_to_markdown`, `write_dialogue`
- `orchestrator/tests/test_nodes.py` — Stage node unit tests
- `orchestrator/tests/test_tool_wrappers.py` — Tool wrapper unit tests

**Key patterns:**
- Tool wrappers are idempotent (sentinel attributes prevent stacking).
- Dialogue capture is optional and non-fatal (exceptions are caught and logged at DEBUG).
- Pipeline rollback already exists in the `except` block (cancels orphaned IN_PROGRESS pipelines).
- Tests use `_SimpleTool` plain-class stubs (not `MagicMock`) to avoid sentinel issues.

## Approach / Architecture

Two independent changes that are complementary:

### Change A: Soft-fail `restrict_to_wp` (return error to agent instead of raising)

Convert the `ValueError` in `restrict_to_wp`'s `_guarded_ainvoke` to return a structured error string to the agent. This keeps the agent alive — it receives the error as a tool result and can self-correct by retrying with the correct WP ID. A **strike counter** (max 2 per tool call) prevents infinite retry loops: after 2 returned errors for the same tool invocation context, the guard raises `ValueError` as before to terminate the stage.

This approach:
- Preserves the safety guarantee (agents still cannot write to foreign WPs).
- Gives the agent a chance to self-correct (most cross-WP errors are simple hallucination of the wrong ID).
- Allows dialogue capture to proceed normally on success.
- Matches the LangChain/LangGraph tool-error pattern (returning error strings from tools is a documented approach).

### Change B: Error-path dialogue capture in `create_stage_node`

Add a `finally`-like dialogue capture attempt after the `except` block. The challenge is that `result` (and `_msgs`) are not assigned when `agent.ainvoke()` raises. However, we can:

1. Declare `_msgs: list = []` before the `try` block.
2. In the `except` block, attempt to extract partial messages from the agent's internal state if available (best-effort; may not be possible with the current DeepAgent API).
3. If partial messages are available, call `serialize_messages_to_markdown` and `write_dialogue` in the `except` block.
4. If partial messages are not recoverable, skip gracefully (the stage already had no dialogue capture, so this is no worse than today).

Since the DeepAgent/LangGraph checkpointer internals are not guaranteed to be accessible, this change provides value primarily when combined with Change A — but even on its own, it establishes the structural pattern for future improvements.

## Rationale

- **Change A is the primary fix.** 21 of 26 errors (81%) were cross-WP contamination. Converting these from hard-kill to soft-fail means the agent gets to finish its work and dialogue capture proceeds normally.
- **Change B is defense in depth.** Other error types (MCP validation errors, network issues, DeepAgent internal errors) will still bypass the success path. Having error-path dialogue capture means any messages collected before the crash are preserved.
- **Strike counter prevents infinite loops.** Without a counter, a stubbornly confused agent could retry the wrong WP ID indefinitely. The 2-strike limit gives one chance to self-correct, then kills the stage as today.

## Detailed Steps

### Step 1: Add soft-fail mode to `restrict_to_wp` with strike counter

**File:** `orchestrator/src/utils/tool_wrappers.py`

1. In `_guarded_ainvoke` inside `restrict_to_wp`, replace the immediate `raise ValueError(...)` with:
   - Increment a per-stage strike counter (using a mutable closure variable, e.g. a `dict` keyed by tool name or a simple integer).
   - If strikes < 2: return a descriptive error string to the agent (e.g. `"ERROR: Tool call targets work_package_id='WP-002' but the active work package is 'WP-001'. You MUST retry this call with work_package_id='WP-001'."`).
   - If strikes ≥ 2: raise `ValueError` as before (hard kill).
2. The strike counter should be scoped to the entire `restrict_to_wp` invocation (shared across all tools in the same stage run), not per-tool. This means any 2 cross-WP violations in the same stage trigger the hard kill.

### Step 2: Add error-path dialogue capture to `create_stage_node`

**File:** `orchestrator/src/nodes/__init__.py`

1. Declare `_msgs: list = []` before the `try` block (alongside `_begin_work_state` and `wrapped_tools`).
2. After `result = await agent.ainvoke(...)`, assign `_msgs = result.get("messages") or []` (currently already done, but now `_msgs` is accessible outside the `try`).
3. In the `except Exception as exc` block, after the `stage_error` log entry and pipeline rollback, add a dialogue capture block:
   ```python
   # ── error-path dialogue capture (best-effort) ──────────
   if _app_config.capture_dialogues and _wp_id and _msgs:
       try:
           project_path_obj = state["project_path"]
           slug = Path(project_path_obj).name
           slug_dir = (
               _app_config.workspace_root
               / "mcp-server" / "storage" / "ledger" / slug
           )
           ts_str = stage_start_time.isoformat()
           content = serialize_messages_to_markdown(_msgs, stage, _wp_id, ts_str)
           written_path = write_dialogue(content, slug_dir, _wp_id, stage)
           err_dialogue_entry = {
               "timestamp": datetime.now(UTC).isoformat(),
               "action": "dialogue_captured",
               "stage": stage,
               "wp_id": _wp_id,
               "file_path": str(written_path),
               "level": "INFO",
               "partial": True,
           }
           if run_logger:
               run_logger.stream_entry(err_dialogue_entry)
           rollback_log_entries.append(err_dialogue_entry)
       except Exception:
           log.debug("Error-path dialogue capture failed for %s", stage, exc_info=True)
   ```
4. Note: the `partial: True` field distinguishes error-path dialogues from success-path ones in the log. This is informational only and does not affect any downstream processing.

### Step 3: Refactor success-path dialogue capture to use shared `_msgs`

**File:** `orchestrator/src/nodes/__init__.py`

Since `_msgs` is now declared before the `try` block, the success-path dialogue capture code (lines ~218–248) continues to work as-is — the only change is that the variable declaration moves earlier. Verify no scoping issues.

### Step 4: Update unit tests for soft-fail `restrict_to_wp`

**File:** `orchestrator/tests/test_tool_wrappers.py`

1. **Existing test updates:** Any existing test that expects `ValueError` on the first cross-WP call must be updated to expect an error string return value instead.
2. **New test: first cross-WP call returns error string.** Verify that a tool call with a wrong WP ID returns a string containing `"ERROR"` instead of raising.
3. **New test: second cross-WP call still returns error string.** Verify the second violation also returns an error string (strike 2 of 2 allowed).
4. **New test: third cross-WP call raises ValueError.** Verify that the third cross-WP violation raises `ValueError` (strike counter exceeded).
5. **New test: counter is shared across tools.** Verify that violations from different tools in the same stage all count toward the same counter.
6. **New test: correct calls don't increment counter.** Verify that successful tool calls (matching WP ID) don't affect the strike counter.

### Step 5: Update unit tests for error-path dialogue capture

**File:** `orchestrator/tests/test_nodes.py`

1. **New test: `dialogue_captured` on error path when `_msgs` is populated.** Simulate an exception that occurs *after* `agent.ainvoke()` returns (e.g., in the pipeline result read-back). Verify `dialogue_captured` appears in `run_log` with `"partial": True`.
2. **New test: no dialogue on error path when `_msgs` is empty.** Simulate an exception before `agent.ainvoke()` (e.g., `load_persona` raises). Verify no `dialogue_captured` entry appears.
3. **New test: error-path dialogue failure is non-fatal.** Mock `write_dialogue` to raise in the `except` path. Verify the stage still returns `stage_success=False` without crashing.

### Step 6: Update orchestrator constraints doc

**File:** `orchestrator/docs/agents/project-manifest/constraints.md`

Add a new constraint entry documenting:
- The `restrict_to_wp` soft-fail behavior (2-strike counter before hard kill).
- The error-path dialogue capture pattern.

### Step 7: Run full test suite

Run `pytest orchestrator/tests/` to verify all existing and new tests pass.

## Dependencies

- No new runtime dependencies required.
- No changes to the MCP server, personas, or root-level scripts.
- The soft-fail behavior depends on LangChain/LangGraph treating returned strings from tool wrappers as tool error messages that the agent can reason about. This is a documented LangChain pattern.

## Required Components

- `orchestrator/src/utils/tool_wrappers.py` — Modify `restrict_to_wp`
- `orchestrator/src/nodes/__init__.py` — Modify `create_stage_node`
- `orchestrator/tests/test_tool_wrappers.py` — Add/update tests
- `orchestrator/tests/test_nodes.py` — Add tests
- `orchestrator/docs/agents/project-manifest/constraints.md` — Add constraint entry

## Assumptions

- LangChain/LangGraph's tool execution pipeline treats a returned string from a tool's `ainvoke` as a tool-result message that the agent can see and reason about. If the agent receives `"ERROR: ..."` as a tool result, it can act on it (retry, adjust parameters, etc.).
- The DeepAgent does not store recoverable partial messages when `ainvoke()` raises. If it does, the error-path capture could extract them — but the plan does not depend on this.
- The 2-strike counter is sufficient. If real-world usage shows agents repeatedly failing, the threshold can be made configurable later.

## Constraints

- The safety guarantee of `restrict_to_wp` must be preserved: agents must never be able to write to a foreign WP. The soft-fail is a *delayed* enforcement, not a removal.
- Dialogue capture must remain optional and non-fatal on both success and error paths.
- No new runtime dependencies.
- Cross-platform compatibility (Windows, macOS, Linux) must be maintained.

## Out of Scope

- Investigating DeepAgent internals to recover partial messages from inside `agent.ainvoke()` after an exception. This is a potential future enhancement.
- Making the strike counter configurable via environment variable. Can be added later.
- Addressing the root cause of why agents hallucinate wrong WP IDs (this is a prompt/model quality issue).
- Changing the dialogue file naming convention or storage location.

## Acceptance Criteria

1. **AC1:** When `restrict_to_wp` detects a cross-WP tool call, the first two violations return an error string to the agent instead of raising. The third violation raises `ValueError`.
2. **AC2:** When a stage fails with `stage_error` and `_msgs` contains messages, a dialogue file is written with the partial conversation and a `dialogue_captured` entry (with `partial: true`) appears in `run_log`.
3. **AC3:** When a stage fails before `agent.ainvoke()` returns (empty `_msgs`), no dialogue file is written.
4. **AC4:** Error-path dialogue capture failure does not crash the stage or change the error return value.
5. **AC5:** All existing tests continue to pass.
6. **AC6:** New tests cover the soft-fail counter progression (1st/2nd/3rd violation behavior).
7. **AC7:** New tests cover error-path dialogue capture (messages available / not available / write failure).

## Testing Strategy

- **Unit tests (Step 4):** Test `restrict_to_wp` in isolation using `_SimpleTool` stubs. Verify return values and exception behavior at each strike count.
- **Unit tests (Step 5):** Test `create_stage_node` with mocked `agent.ainvoke()` that both succeeds and fails. Verify `run_log` contents and dialogue file paths.
- **Regression:** Run full `pytest orchestrator/tests/` to verify no regressions.
- **Manual validation (optional):** Re-run the orchestrator against a project known to trigger cross-WP contamination and verify dialogue files appear for both successful and failed stages.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Agent enters infinite retry loop on soft-fail** | Strike counter (2 soft-fail → hard kill) prevents indefinite retries. |
| **Returned error string confuses agent** | Error message includes an explicit instruction to retry with the correct WP ID. If the agent cannot self-correct, the hard kill triggers after 2 attempts. |
| **Error-path dialogue capture writes corrupt/incomplete files** | The `serialize_messages_to_markdown` function handles empty or partial message lists gracefully. Files are marked with `partial: True` in log entries. |
| **Strike counter leaks state across stages** | Counter is scoped to one `restrict_to_wp` invocation (closure variable inside `_guarded_ainvoke`). Each stage creates a new wrapper chain, resetting the counter. |
| **Soft-fail changes existing test expectations** | Step 4 explicitly addresses updating existing tests that assert `ValueError` on first violation. |
