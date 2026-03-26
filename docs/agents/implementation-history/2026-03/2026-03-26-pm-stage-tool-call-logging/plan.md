# Plan

## Summary

Add real-time MCP tool-call activity logging to the orchestrator so that every stage — but most critically the PM stage — emits a lightweight `tool_call` JSONL event each time the Deep Agent invokes an MCP tool. This replaces the current "silent gap" between `stage_start` and `stage_complete` (filled only by heartbeats) with a stream of granular activity signals that the Orchestrator Runner persona and human operators can use to track progress.

## Architectural Context

The orchestrator's stage execution pipeline is built around these components:

- **`orchestrator/src/nodes/__init__.py`** — `create_stage_node()` is the generic LangGraph node factory used by all stages. It emits `stage_start` and `stage_complete`/`stage_error` JSONL events, but nothing in between.
- **`orchestrator/src/nodes/pm.py`** — PM-specific node that produces a prompt with the plan document and delegates to `create_stage_node()`.
- **`orchestrator/src/utils/tool_wrappers.py`** — Contains `inject_project_path()` and `restrict_to_wp()`, both implemented as `ainvoke` monkeypatches on LangChain tool objects. Uses sentinel attributes (`_orig_ainvoke`, `_orig_ainvoke_wp`) to prevent wrapper stacking.
- **`orchestrator/src/utils/logging.py`** — `WorkflowLogger` writes JSONL + console output. `stream_entry()` is the real-time write path. `_build_stream_console_line()` renders human-readable console lines per event type. `get_run_logger()` extracts the logger from LangGraph's `RunnableConfig`.
- **`orchestrator/docs/jsonl-log-schema.md`** — Canonical schema reference for all JSONL event types.
- **`scripts/read-log.js`** — JSONL log reader; renders events with color-coded console output. Falls back to a generic `action → result` format for unknown event types.

The existing wrapper pattern in `tool_wrappers.py` provides a proven model: wrap `ainvoke`, use a sentinel to prevent stacking, and keep the original chain accessible. The new tool-call logger follows the same architecture.

## Approach / Architecture

Add a new `log_tool_calls()` wrapper function in `tool_wrappers.py` that intercepts every MCP `ainvoke` call and emits a `tool_call` JSONL event **before** forwarding to the underlying tool. The wrapper:

1. Extracts the tool name and (optionally) the `work_package_id` from the call arguments.
2. Emits a lightweight `tool_call` event via `run_logger.stream_entry()`.
3. Forwards the call to the original `ainvoke` and returns the result unchanged.

This wrapper is applied in `create_stage_node()` after the existing `inject_project_path()` and `restrict_to_wp()` wrappers, so tool-call logging captures the fully-resolved arguments (with `project_path` injected and WP guard applied).

The `WorkflowLogger` gets a new console line format for `tool_call` events, and the JSONL log schema doc is updated to describe the new event type.

### Event Schema

```json
{
  "timestamp": "2026-03-26T10:05:32.000000+00:00",
  "stage": "pm",
  "wp_id": "",
  "action": "tool_call",
  "tool_name": "ledger_create_work_package",
  "tool_wp_id": "WP-003",
  "level": "DEBUG"
}
```

- `stage` / `wp_id`: inherit from the current node context (for PM, `wp_id` is always `""`).
- `tool_name`: the MCP tool name string.
- `tool_wp_id`: the `work_package_id` argument from the tool call, if present (empty string otherwise). This gives the Runner immediate visibility into which WP the PM is creating/configuring.
- `level`: `DEBUG` — these are high-frequency events that can be filtered out when not needed.

### Console Format

```
[pm]  🔧 ledger_create_work_package (WP-003)
[pm]  🔧 ledger_begin_work (WP-003)
[developer] WP-003 🔧 ledger_complete_pipeline
```

## Rationale

- **Wrapper pattern reuse**: The existing `inject_project_path()` and `restrict_to_wp()` wrappers prove the `ainvoke` monkeypatch approach is reliable and idempotent. Adding a third wrapper in the same pattern is low-risk.
- **Logger available at wrapper site**: In `create_stage_node()`, `run_logger` is already resolved from the LangGraph config before tools are wrapped. Passing it into the wrapper closure is straightforward.
- **All stages benefit**: While PM is the most visible bottleneck, developer, QA, and reviewer stages also have significant gaps. Tool-call logging provides universal visibility.
- **DEBUG level avoids noise**: Tool-call events use `DEBUG` level so they don't clutter default console output. The `read-log.js` script can filter by action type for focused debugging.
- **No argument logging**: Tool call arguments are intentionally excluded from the JSONL event to avoid logging sensitive plan content, file contents, or large payloads. Only the tool name and WP ID are captured.

## Detailed Steps

1. **Add `log_tool_calls()` to `orchestrator/src/utils/tool_wrappers.py`**
   - New function with signature: `log_tool_calls(tools: list[Any], stage: str, wp_id: str, logger: WorkflowLogger | None) -> list[Any]`
   - Follows existing sentinel pattern (`_orig_ainvoke_log`) to prevent stacking
   - Extracts `tool.name` and `work_package_id` from call arguments
   - Calls `logger.stream_entry()` with a `tool_call` event before forwarding
   - Returns the tool list (in-place mutation, like existing wrappers)

2. **Wire `log_tool_calls()` into `create_stage_node()` in `orchestrator/src/nodes/__init__.py`**
   - Import `log_tool_calls` from `tool_wrappers`
   - Call it after `inject_project_path()` and `restrict_to_wp()` (and after `_install_begin_work_tracker()`), passing `stage`, `_wp_id`, and `run_logger`
   - This ensures the logger captures the fully-resolved arguments

3. **Add console rendering for `tool_call` events in `orchestrator/src/utils/logging.py`**
   - Add a new `if action == "tool_call":` branch in `_build_stream_console_line()`
   - Format: `[stage] (wp_id) 🔧 tool_name (tool_wp_id)`

4. **Update JSONL log schema documentation in `orchestrator/docs/jsonl-log-schema.md`**
   - Add `tool_call` event entry with field descriptions
   - Note `DEBUG` level and filtering guidance

5. **Add unit tests in `orchestrator/tests/`**
   - Test `log_tool_calls()` wrapper: verify it emits `tool_call` events, extracts `tool_wp_id`, handles both dict and ToolCall input structures, is idempotent (sentinel prevents stacking)
   - Test console line rendering for `tool_call` events in existing logging tests
   - Test that `log_tool_calls` with `logger=None` is a no-op (no crash)

6. **Update `orchestrator/changelog.md`** with the new feature

## Dependencies

- No new external dependencies required
- Reuses existing `WorkflowLogger.stream_entry()` API
- Reuses existing `ainvoke` wrapper pattern from `tool_wrappers.py`

## Required Components

- `orchestrator/src/utils/tool_wrappers.py` — new `log_tool_calls()` function
- `orchestrator/src/nodes/__init__.py` — wire in wrapper call
- `orchestrator/src/utils/logging.py` — new console format branch
- `orchestrator/docs/jsonl-log-schema.md` — schema documentation update
- `orchestrator/tests/test_tool_wrappers.py` — new tests for `log_tool_calls()`
- `orchestrator/tests/test_logging.py` — new test for `tool_call` console rendering (if this file exists; otherwise add to the appropriate test file)

## Assumptions

- The `run_logger` is consistently available in `create_stage_node()` via `get_run_logger(config)`. If it's `None`, the wrapper is a no-op (no crash).
- Tool objects have a `.name` attribute (guaranteed by LangChain `BaseTool`).
- The sentinel-based idempotency pattern used by existing wrappers is correct and does not need to change.

## Constraints

- **No argument logging**: Tool call arguments MUST NOT be written to JSONL to avoid sensitive data leakage (plan content, file contents, etc.). Only tool name and WP ID.
- **No performance impact**: The wrapper must add negligible overhead. A single `stream_entry()` call per tool invocation (dict serialization + file write + flush) is acceptable.
- **Cross-platform**: No OS-specific APIs. Pure Python file I/O through existing `WorkflowLogger`.
- **Backward compatible**: Existing log consumers (Orchestrator Runner persona, `read-log.js`) must not break. Unknown event types already fall through to the generic console renderer.

## Out of Scope

- Token-level streaming from the LLM agent (would require Deep Agents library changes)
- Tool call argument logging or response logging (privacy/size concerns)
- Changes to heartbeat interval or behavior
- Changes to `read-log.js` rendering (it already handles unknown events gracefully via fall-through; a dedicated renderer can be added later if desired)
- Changes to the Orchestrator Runner persona (it will naturally benefit from the new log events)

## Acceptance Criteria

- During a PM stage, each MCP tool call emits a `tool_call` JSONL event with `tool_name` and `tool_wp_id` fields
- Console output shows `🔧 tool_name` lines between `stage_start` and `stage_complete`
- Events use `level: "DEBUG"` to distinguish from operational events
- `log_tool_calls()` is idempotent (calling twice on the same tools does not stack wrappers)
- `log_tool_calls()` with `logger=None` does not crash
- All existing tests pass without modification
- New unit tests cover: event emission, WP ID extraction, idempotency, null logger, console rendering

## Testing Strategy

- **Unit tests** for `log_tool_calls()` in `orchestrator/tests/test_tool_wrappers.py`:
  - Mock tool objects with `.name` and `.ainvoke`
  - Mock `WorkflowLogger` to capture `stream_entry()` calls
  - Verify emitted event structure (fields, values)
  - Verify both flat-dict and ToolCall `{"args": {...}}` input structures
  - Verify sentinel prevents double-wrapping
  - Verify `None` logger is safe
- **Unit test** for `_build_stream_console_line()` with a `tool_call` event dict
- **Integration**: Run a dry-run orchestrator execution and verify `tool_call` events appear in the JSONL output between `stage_start` and `stage_complete`

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Wrapper stacking**: Calling `log_tool_calls` multiple times on the same tool objects | Same sentinel pattern (`_orig_ainvoke_log`) as existing wrappers; proven in production |
| **Logger unavailable**: `get_run_logger()` returns `None` in some edge case | Wrapper checks `logger is not None` before calling `stream_entry()`; no-op otherwise |
| **High event volume in JSONL**: PM creates many WPs, each with multiple tool calls | `level: "DEBUG"` allows filtering; events are tiny (~200 bytes each); no argument payloads |
| **Ordering with existing wrappers**: New wrapper must not interfere with `inject_project_path` / `restrict_to_wp` / `_install_begin_work_tracker` | Applied *after* all other wrappers; reads resolved arguments; does not modify input |
| **Deep Agents library changes `ainvoke` signature**: Future library update changes how tools are called | Wrapper delegates to `_orig` via closure; same risk profile as existing wrappers that are already in production |
