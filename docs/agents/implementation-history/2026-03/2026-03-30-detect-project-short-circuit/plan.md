# Plan

## Summary

Short-circuit the `ledger_detect_project` MCP tool call in the orchestrator's `inject_project_path` wrapper so that when an agent calls this IDE-facing auto-detection tool, it receives an immediate synthetic response with the known `project_path` — eliminating the MCP round-trip and the validation error that currently causes a stage failure + retry cycle.

## Architectural Context

The orchestrator wraps all MCP tools through a layered wrapper chain in `orchestrator/src/utils/tool_wrappers.py`:

1. **`inject_project_path`** — auto-injects `project_path` and strips `cwd_path` from all tool calls
2. **`restrict_to_wp`** — guards against cross-WP writes with a strike counter
3. **`log_tool_calls`** — emits `tool_call` JSONL events

The `inject_project_path` wrapper (lines 134–198) currently:
- Strips any `cwd_path` the agent supplies (lines 192–193)
- Injects `project_path` via `setdefault` (line 194)

The MCP tool `ledger_detect_project` is defined in `mcp-server/src/tools/project-lifecycle.ts` (lines 28–38) with a Zod schema requiring only `cwd_path` (no `project_path` parameter). It's designed for IDE agents that don't know which project they're in — the tool cross-references `cwd_path` against stored project roots.

In the orchestrator, `project_path` is **always** known (passed in `WorkflowState`), making `ledger_detect_project` redundant. However, the PM agent sometimes calls it during project initialization (following its persona instructions designed for IDE use), triggering the validation failure.

**Error flow:**
1. PM agent calls `ledger_detect_project` with or without `cwd_path`
2. Wrapper strips `cwd_path`, injects `project_path` (which `DetectProjectSchema` doesn't accept)
3. MCP server returns `-32602` (input validation error: `cwd_path` required)
4. `langchain_mcp_adapters` raises `ToolException`
5. Deep Agent's `ToolNode` (`handle_tool_errors` = default re-raise) propagates exception
6. Outer `node_fn` except block marks stage as `FAIL`
7. Supervisor retries (costing ~2 minutes of wasted LLM time/tokens)
8. PM succeeds on retry (without calling `ledger_detect_project`)

## Approach / Architecture

Add a **short-circuit check** at the top of the `_wrapped_ainvoke` closure inside `inject_project_path`. When the tool being called is `ledger_detect_project`, return a synthetic `ToolMessage`-compatible response immediately — mirroring the JSON structure the real tool would return — without forwarding to the MCP server.

This approach:
- Eliminates the error without changing error handling semantics elsewhere
- Saves an MCP round-trip even when the call wouldn't error
- Uses the tool's name (already available via `tool.name` in the `for` loop) captured in a closure variable
- Follows the existing wrapper pattern of intercepting calls before they reach the MCP server

## Rationale

**Why short-circuit, not downgrade to warning?** The error is not a benign intermittent issue — it's a deterministic bug where the wrapper actively removes the parameter the tool needs. Downgrading to a warning would mask the root cause and still waste an MCP round-trip. Short-circuiting fixes the cause.

**Why not remove the tool from the agent's tool list?** The agent's persona may reference `ledger_detect_project`. Removing it would cause a different LLM confusion. Keeping it available but returning useful data is the least-surprise approach.

**Why not fix `detect_project` to also accept `project_path`?** That would mix two different lookup strategies in one tool and complicate the MCP server's clean schema design. The orchestrator wrapper is the right place for this orchestrator-specific concern.

## Detailed Steps

1. **Capture `tool.name` in the wrapper closure** — In `inject_project_path`, capture `tool.name` as a default argument in `_wrapped_ainvoke` (same pattern already used for `_orig` and `_proj`).

2. **Add short-circuit logic at the top of `_wrapped_ainvoke`** — Before the existing `isinstance(input, dict)` block, check if `_tool_name == "ledger_detect_project"`. If so, derive the project slug from `_proj` (last path segment) and return a synthetic response string matching the real tool's output format:
   ```python
   if _tool_name == "ledger_detect_project":
       slug = _proj.rstrip("/").rsplit("/", 1)[-1]
       return json.dumps({
           "plan_path": _proj,
           "slug": slug,
           "note": "Short-circuited by orchestrator — project_path is already known.",
       })
   ```

3. **Add `import json`** at the top of `tool_wrappers.py` (if not already present).

4. **Update existing tests** — Modify the `test_cwd_path_removed_and_project_path_injected` test (and related tests) to account for the short-circuit behavior when the tool name is `ledger_detect_project`.

5. **Add a new test** — `test_detect_project_short_circuited`: verify that when a tool named `ledger_detect_project` is wrapped by `inject_project_path`, calling `ainvoke` returns a synthetic JSON response containing the known `plan_path` without invoking the original `ainvoke`.

6. **Add a ToolCall-structure test** — `test_detect_project_short_circuited_toolcall_structure`: verify the short-circuit also works when input has the `{"name": ..., "args": {...}}` ToolCall structure.

## Dependencies

- None — the change is self-contained within the orchestrator's tool wrapper layer.

## Required Components

- `orchestrator/src/utils/tool_wrappers.py` — add short-circuit logic to `inject_project_path`
- `orchestrator/tests/test_tool_wrappers.py` — add new test cases

## Assumptions

- The PM agent's call to `ledger_detect_project` is the only tool call affected by the `cwd_path` stripping bug. No other tool uses `cwd_path` as its sole required parameter.
- The synthetic response format (JSON with `plan_path`, `slug`, `note`) is sufficient for the PM agent to proceed — it matches the structure of the real `FOUND` response from the MCP tool.

## Constraints

- Must maintain the existing wrapper stacking/idempotency guarantees documented in `tool_wrappers.py`.
- The short-circuit must work for both flat-dict and ToolCall input structures.
- Must not change error handling behavior for other tools — this is a targeted fix for `ledger_detect_project` only.

## Out of Scope

- Changing the MCP server's `DetectProjectSchema` to accept `project_path`.
- Modifying Deep Agent's `ToolNode` error handling (e.g. `handle_tool_errors=True`).
- Filtering `ledger_detect_project` out of the tool list entirely.
- Changes to persona instructions to discourage calling `ledger_detect_project`.

## Acceptance Criteria

- When the PM agent calls `ledger_detect_project` during an orchestrator run, it receives a valid JSON response containing the known project path — no MCP validation error, no stage failure.
- The short-circuit works for both flat-dict and ToolCall input structures.
- Existing `inject_project_path` tests continue to pass.
- New test coverage validates the short-circuit behavior.
- The wrapper remains idempotent (no stacking regressions).

## Testing Strategy

Unit tests in `orchestrator/tests/test_tool_wrappers.py`:
1. Mock a tool with `name = "ledger_detect_project"`, wrap it with `inject_project_path`, call `ainvoke` → assert the original `ainvoke` was **not** called and the returned string is valid JSON with the expected `plan_path`.
2. Same test but with ToolCall structure input.
3. Verify that tools with other names still delegate to the original `ainvoke` as before.

Run: `python3 -m pytest tests/test_tool_wrappers.py -v`

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Synthetic response format doesn't match what the PM agent expects** | Mirror the exact JSON structure returned by the real `detectProject` function's FOUND branch: `{plan_path, slug, title, status}`. The `title` and `status` fields can be omitted — the PM agent only needs `plan_path` to proceed. |
| **Future MCP tools also use only `cwd_path`** | The short-circuit is scoped to `ledger_detect_project` by name. If new `cwd_path`-only tools are added, they'd need their own handling — but the pattern is now established. |
| **Short-circuit masks a deeper issue with the PM agent calling unnecessary tools** | This is acceptable — the agent is following persona instructions designed for both IDE and orchestrator contexts. The wrapper layer is the correct place to handle orchestrator-specific optimizations. |
