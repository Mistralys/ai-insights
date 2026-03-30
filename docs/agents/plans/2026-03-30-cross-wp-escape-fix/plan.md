# Plan

## Summary

Implement post-completion `get_next_action` interception (Approach A from the [cross-WP escape research](research.md)) to prevent orchestrator stage agents from escaping their assigned work package after completing a pipeline. When `ledger_complete_pipeline` succeeds for the active WP, all subsequent `ledger_get_next_action` calls within the same stage turn are intercepted and return a synthetic `WAIT` response, causing the agent to cleanly exit via its handoff step. Additionally, suppress the spurious pipeline-rollback warning that fires when the error handler tries to cancel an already-completed pipeline. Document Approach B (user-turn prompt WP-scoping) as an explicitly rejected pattern.

## Architectural Context

The orchestrator creates one Deep Agent per stage turn, scoped to a single work package via `current_wp_id`. Four defensive wrapper layers are applied to MCP tools inside `create_stage_node` (`orchestrator/src/nodes/__init__.py`):

1. `inject_project_path` — auto-injects `project_path` into every call
2. `restrict_to_wp` — guards against cross-WP write calls (soft-fail + hard kill)
3. `_install_begin_work_tracker` — wraps `ledger_begin_work` to record invocation state for error-path rollback
4. `log_tool_calls` — outermost wrapper; emits JSONL events

The `_install_begin_work_tracker` function in `orchestrator/src/nodes/__init__.py` (lines 52–93) is the established pattern for wrapping a specific tool to observe state transitions. It uses `object.__setattr__` (via `_patch_tool` in `tool_wrappers.py`) to monkeypatch `ainvoke`, stores a mutable tracker dict, and includes idempotency guards via sentinel attributes.

`_READ_ONLY_TOOLS` in `orchestrator/src/utils/tool_wrappers.py` exempts `ledger_get_next_action` from the cross-WP guard, which is correct for reads but means the agent receives cross-WP routing instructions after completing its assigned WP.

Tests live in `orchestrator/tests/test_tool_wrappers.py` (2197 lines) using plain `_SimpleTool` stubs and `pytest` async tests.

## Approach / Architecture

### Core fix: Two new wrapper functions in `orchestrator/src/nodes/__init__.py`

1. **`_install_complete_pipeline_tracker`** — Wraps `ledger_complete_pipeline`'s `ainvoke` to flip a `{"completed": True}` flag when the call succeeds for the active WP. Follows the exact same pattern as `_install_begin_work_tracker`: mutable dict tracker, sentinel attribute to prevent double-wrapping, `object.__setattr__` via the existing `_patch_tool` helper.

2. **`_install_post_completion_guard`** — Wraps `ledger_get_next_action`'s `ainvoke` to check the completion tracker flag. If `completed` is `True`, returns a synthetic `ToolMessage` response:
   ```json
   {
     "action": "WAIT",
     "reason": "Pipeline completed for the active work package. The orchestrator will route the next work package."
   }
   ```
   If `completed` is `False`, delegates to the original `ainvoke` transparently.

### Integration into the wrapper chain

Both wrappers are installed in `create_stage_node`'s `node_fn`, between `_install_begin_work_tracker` (layer 3) and `log_tool_calls` (layer 4):

```
1. inject_project_path
2. restrict_to_wp
3. _install_begin_work_tracker       (existing)
4. _install_complete_pipeline_tracker (NEW)
5. _install_post_completion_guard     (NEW)
6. log_tool_calls                     (existing — outermost)
```

### Rollback suppression

In the `except` block of `create_stage_node`, add a condition: skip the pipeline-rollback attempt when `_complete_pipeline_state["completed"]` is `True`. If the pipeline already completed successfully, there is no orphaned IN_PROGRESS pipeline to cancel.

### Rejected pattern: document Approach B

Add an architecture decision record (ADR) section to the research document and reference it from `orchestrator/docs/agents/project-manifest/constraints.md` — explicitly stating that user-turn prompt WP-scoping must not be implemented, with rationale.

## Rationale

- **Follows existing patterns:** The `_install_begin_work_tracker` pattern is proven and well-tested. Replicating it for two more tools is low-risk.
- **Programmatic guarantee:** Unlike prompt-based approaches, interception cannot be ignored by the LLM.
- **Zero persona impact:** No changes to persona templates or persona build system required.
- **Zero extra tokens:** The synthetic response is a simple JSON object; no additional prompt tokens are injected.
- **Addresses root cause:** The problem is that `ledger_get_next_action` returns cross-WP routing after pipeline completion. Intercepting this response at the source prevents the entire cross-WP call cascade.

## Detailed Steps

### Step 1: Add `_install_complete_pipeline_tracker` to `orchestrator/src/nodes/__init__.py`

Create a new function after `_install_begin_work_tracker` (after line ~93):

- **Signature:** `_install_complete_pipeline_tracker(tools: list[Any], tracker: dict) -> None`
- **Behaviour:** Iterate `tools`, find `ledger_complete_pipeline`, wrap its `ainvoke` to set `tracker["completed"] = True` after a successful (non-exception) delegation to the original. Use the same sentinel/idempotency pattern as `_install_begin_work_tracker` (sentinel attribute `_tracking_complete_pipeline`).
- **Important:** The tracker flag must be set *after* the original `ainvoke` completes successfully (i.e., `await _orig(...)` first, then set the flag). If the MCP call fails, the flag stays `False`.

### Step 2: Add `_install_post_completion_guard` to `orchestrator/src/nodes/__init__.py`

Create a new function after `_install_complete_pipeline_tracker`:

- **Signature:** `_install_post_completion_guard(tools: list[Any], completion_tracker: dict) -> None`
- **Behaviour:** Iterate `tools`, find `ledger_get_next_action`, wrap its `ainvoke`:
  - If `completion_tracker["completed"]` is `True`, return a synthetic response using `_make_tool_response` from `tool_wrappers.py` with a JSON payload `{"action": "WAIT", "reason": "Pipeline completed for the active work package. The orchestrator will route the next work package."}` and `status="success"`.
  - Otherwise, delegate to the original `ainvoke`.
- Use the same sentinel/idempotency pattern (sentinel attribute `_post_completion_guard`).
- Import `_make_tool_response` from `src.utils.tool_wrappers` (it is already imported in the module's import block — verify and add if missing).

### Step 3: Integrate wrappers into `create_stage_node` in `orchestrator/src/nodes/__init__.py`

In the `node_fn` body, after the existing `_install_begin_work_tracker` call (line ~214):

1. Declare `_complete_pipeline_state: dict = {"completed": False}` alongside the existing `_begin_work_state` declaration (before the `try` block, around line ~175).
2. After `_install_begin_work_tracker(wrapped_tools, _begin_work_state)`, add:
   ```python
   _install_complete_pipeline_tracker(wrapped_tools, _complete_pipeline_state)
   _install_post_completion_guard(wrapped_tools, _complete_pipeline_state)
   ```
   Both are guarded by the same `if _wp_id:` condition as the existing tracker.

### Step 4: Suppress spurious pipeline rollback

In the `except` block of `node_fn` (around line ~380), modify the rollback condition from:
```python
if _begin_work_state["called"] and _wp_id and wrapped_tools:
```
to:
```python
if _begin_work_state["called"] and not _complete_pipeline_state["completed"] and _wp_id and wrapped_tools:
```

This skips rollback when the pipeline already completed successfully — there is no orphaned IN_PROGRESS pipeline to cancel.

### Step 5: Add unit tests

Add a new test class in `orchestrator/tests/test_tool_wrappers.py` (or a new test file `orchestrator/tests/test_post_completion_guard.py` if the existing file is already large). Tests should cover:

1. **Post-completion interception:** After `ledger_complete_pipeline` is called and succeeds, `ledger_get_next_action` returns the synthetic WAIT response.
2. **Pre-completion passthrough:** Before `ledger_complete_pipeline` is called, `ledger_get_next_action` delegates to the real tool and returns its response.
3. **Failed completion does not trigger interception:** If `ledger_complete_pipeline` raises an exception, the tracker flag stays `False` and `ledger_get_next_action` continues to delegate normally.
4. **Synthetic response shape:** The intercepted response is valid JSON with `"action": "WAIT"` and a `"reason"` key.
5. **Idempotency:** Calling the install functions multiple times on the same tools does not stack wrappers.
6. **Rollback suppression:** When `_complete_pipeline_state["completed"]` is `True`, the rollback path is skipped (test by verifying `ledger_cancel_pipeline` is not invoked).

### Step 6: Document rejected Approach B

Add a new constraint entry to `orchestrator/docs/agents/project-manifest/constraints.md`:

> **Rejected pattern: User-turn prompt WP-scoping.** Do not add `wp_id` template variables or explicit WP-scope instructions to stage prompts. Both the supervisor and implementing agent use the ledger to determine the current work package — they are always in sync. Prior experience with WP-scoping in prompts created agent confusion without providing meaningful safety. The programmatic post-completion guard in `nodes/__init__.py` is the authoritative mechanism for preventing cross-WP escape.

### Step 7: Update module changelog

Add an entry to `orchestrator/changelog.md` documenting the fix.

## Dependencies

- `_make_tool_response` from `orchestrator/src/utils/tool_wrappers.py` — needed by the post-completion guard to create `ToolMessage` responses. Verify it is importable from `nodes/__init__.py`.
- No new external dependencies required.

## Required Components

- `orchestrator/src/nodes/__init__.py` — Two new functions + integration into `create_stage_node` + rollback suppression
- `orchestrator/tests/test_tool_wrappers.py` (or new `orchestrator/tests/test_post_completion_guard.py`) — Unit tests
- `orchestrator/docs/agents/project-manifest/constraints.md` — Rejected pattern documentation
- `orchestrator/changelog.md` — Changelog entry

## Assumptions

- `_make_tool_response` is suitable for creating synthetic `ToolMessage` responses from within `nodes/__init__.py` (it handles both ToolCall-dict and plain-dict inputs).
- The `ledger_complete_pipeline` MCP tool fires exactly once per successful pipeline completion within a stage turn.
- A FAIL completion also triggers the guard — when any pipeline completes (PASS or FAIL), the orchestrator supervisor (not the agent) should decide whether to re-run the stage. The agent should not self-route to the next WP regardless of the completion outcome.

## Constraints

- **No persona changes.** The fix must be entirely within the orchestrator codebase. Persona templates are shared between IDE and orchestrator workflows.
- **Idempotent wrappers.** All new wrappers must follow the sentinel-based idempotency pattern to prevent closure stacking.
- **Cross-platform.** The implementation uses only Python stdlib + existing dependencies. No OS-specific code.
- **Privacy constraint.** The synthetic WAIT response must not leak information about other work packages.

## Out of Scope

- Changes to the MCP server's `ledger_get_next_action` tool behaviour.
- Changes to persona templates or the persona build system.
- Changes to the `restrict_to_wp` guard or `_READ_ONLY_TOOLS` set.
- Rework-within-stage scenarios (the research Open Question notes this edge case; the current design correctly intercepts on any completion, which is the safe default).

## Acceptance Criteria

- After `ledger_complete_pipeline` succeeds, any subsequent `ledger_get_next_action` call within the same stage turn returns `{"action": "WAIT", ...}` without hitting the MCP server.
- Before `ledger_complete_pipeline` is called, `ledger_get_next_action` behaves normally (full passthrough).
- The `restrict_to_wp` hard-kill path is never reached in the cross-WP escape scenario (the interception prevents the agent from receiving cross-WP routing).
- No spurious "Cannot cancel pipeline" rollback warnings when a stage errors after the pipeline already completed.
- All existing tests continue to pass.
- New tests cover the six scenarios listed in Step 5.
- `orchestrator/docs/agents/project-manifest/constraints.md` contains the rejected-pattern entry for Approach B.

## Testing Strategy

Unit tests using the existing `_SimpleTool` stub pattern. Create tool stubs for `ledger_complete_pipeline` and `ledger_get_next_action`, install both trackers, then assert:

- **Happy path:** Call `complete_pipeline` → call `get_next_action` → assert synthetic WAIT returned.
- **Pre-completion:** Call `get_next_action` without prior `complete_pipeline` → assert real response returned.
- **Failed completion:** Make `complete_pipeline` raise → call `get_next_action` → assert real response returned.
- **Response shape:** Parse the synthetic response as JSON; assert `action == "WAIT"` and `reason` key exists.
- **Idempotency:** Install wrappers twice; assert behaviour is unchanged (no double-interception artifacts).
- **Rollback suppression:** Simulate error path with `_complete_pipeline_state["completed"] = True`; assert `ledger_cancel_pipeline` is not called.

Run with: `python3 -m pytest tests/test_post_completion_guard.py -v`

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Rework-within-stage blocked:** If a stage legitimately needs to re-attempt work after a FAIL completion, the guard would block the second `get_next_action` call. | The orchestrator supervisor handles rework routing — a stage agent should never self-route after any completion (PASS or FAIL). The guard fires on any completion, which is the correct behaviour. |
| **Import coupling:** `_make_tool_response` is imported from `tool_wrappers.py` into `nodes/__init__.py`. | This is a lightweight utility function with no side effects. The coupling is minimal and the function is already part of the module's public-ish API (used by `restrict_to_wp`). |
| **Wrapper ordering sensitivity:** If wrappers are installed in the wrong order, the completion tracker might not see the real `ainvoke` result. | The integration step specifies the exact ordering. The docstring for `create_stage_node` already documents the canonical wrapper order — update it to include the two new layers. |
| **Synthetic response format mismatch:** If the persona's WAIT-handling code expects a different response shape, the agent might not exit cleanly. | The synthetic response matches the shape returned by the real `ledger_get_next_action` tool when it returns WAIT. Verify by inspecting the MCP server's response format. |
