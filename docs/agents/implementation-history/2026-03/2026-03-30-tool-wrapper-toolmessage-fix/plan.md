# Plan

## Summary

Fix a `TypeError` in the orchestrator's tool wrappers that crashes pipeline stages when short-circuit return paths produce plain strings instead of `ToolMessage` objects. The `langchain-core` 1.2.22 upgrade (in v0.12.0) changed `BaseTool.ainvoke()` to wrap tool output in `ToolMessage` via `_format_output()`, and LangGraph 1.0.9's `_execute_tool_async` now enforces a strict `isinstance(response, ToolMessage)` check on the return value. Two wrapper functions in `tool_wrappers.py` bypass the original `ainvoke` on short-circuit paths — returning raw strings — which triggers the `TypeError`.

The error manifests as: `Tool ledger_begin_work returned unexpected type: <class 'str'>` and causes the stage to fail with a `FAIL` result and a pipeline rollback attempt.

## Architectural Context

### Affected module

`orchestrator/src/utils/tool_wrappers.py` — three wrapper functions (`inject_project_path`, `restrict_to_wp`, `log_tool_calls`) that monkeypatch `tool.ainvoke` via `object.__setattr__` on LangChain `StructuredTool` instances.

### Key integration points

- **LangGraph ToolNode** (`langgraph.prebuilt.tool_node`) — calls `tool.ainvoke(call_args, config)` and enforces `isinstance(response, ToolMessage)` at `_execute_tool_async` lines 91–96.
- **LangChain BaseTool** (`langchain_core.tools.base`) — `ainvoke()` → `arun()` → `_format_output()` now wraps raw tool output into a `ToolMessage` when `tool_call_id` is present.
- **Node factory** (`orchestrator/src/nodes/__init__.py`, ~line 210) — applies wrappers in order: `inject_project_path` → `restrict_to_wp` → `log_tool_calls`.
- **Deep Agents middleware** (`deepagents.middleware.subagents`) — spawns subagents that invoke tools through the same LangGraph ToolNode path, triggering the same type check.

### Root cause in detail

When `_execute_tool_async` calls `tool.ainvoke(call_args, config)`:

- **Normal path:** Our wrapper delegates to `_orig(input, *args, **kwargs)` → original `BaseTool.ainvoke` → `arun()` → `_format_output()` → returns `ToolMessage` → passes the `isinstance` check.
- **Short-circuit path (broken):** Our wrapper returns a plain `str` directly → bypasses `_format_output()` → `isinstance(response, ToolMessage)` is `False` → `TypeError` raised.

Two short-circuit return sites exist:

| Wrapper | Condition | Current return | Line |
|---------|-----------|----------------|------|
| `inject_project_path` | `_tool_name == "ledger_detect_project"` | `json.dumps({...})` (str) | ~178 |
| `restrict_to_wp` | Cross-WP soft-fail (violations 1–2) | `"ERROR: ..."` (str) | ~321 |

### Trigger scenario (from the error log)

1. QA agent for WP-002 finishes its QA pipeline.
2. Agent calls `ledger_get_next_action` → learns WP-001 is available.
3. Agent calls `ledger_begin_work(WP-001)` — a cross-WP write.
4. `restrict_to_wp` guard detects mismatch (active WP is WP-002).
5. Guard returns `"ERROR: Tool call targets work_package_id='WP-001' ..."` (plain string).
6. LangGraph's `_execute_tool_async` rejects the string → `TypeError`.
7. Stage crashes, pipeline rollback fails (pipeline already completed).

## Approach / Architecture

Add a private helper function `_make_tool_response()` in `tool_wrappers.py` that conditionally wraps a content string in a `ToolMessage` when a `tool_call_id` is present in the input (i.e., when called from LangGraph's ToolNode). When `tool_call_id` is absent (plain dict calls, unit tests with simple dicts), the plain string is returned for backward compatibility.

Both short-circuit sites call this helper instead of returning raw strings.

```python
from langchain_core.messages import ToolMessage

def _make_tool_response(
    content: str,
    input: Any,
    tool_name: str,
    status: str = "error",
) -> ToolMessage | str:
    if isinstance(input, dict):
        tool_call_id = input.get("id")
        if tool_call_id is not None:
            return ToolMessage(
                content=content,
                tool_call_id=tool_call_id,
                name=tool_name,
                status=status,
            )
    return content
```

## Rationale

- **Minimal change surface.** A single helper function encapsulates the conversion logic; both affected return sites call it with one additional line.
- **Backward compatible.** When `tool_call_id` is absent (unit tests using plain dicts, any non-LangGraph callers), the function returns the same plain string as before, so existing tests that use flat dicts pass without modification.
- **Matches LangGraph's contract.** The `ToolMessage` includes `tool_call_id`, `name`, and `status` — the same fields `_execute_tool_async` would produce for a handled error (see its own error path at lines 80–85).
- **`status="error"` for soft-fail, `status="success"` for detect short-circuit.** This preserves the semantic intent of each short-circuit path.

## Detailed Steps

### 1. Add `ToolMessage` import to `tool_wrappers.py`

Add `from langchain_core.messages import ToolMessage` to the existing imports in `orchestrator/src/utils/tool_wrappers.py`.

### 2. Add `_make_tool_response` helper function

Add a private module-level function after the `_READ_ONLY_TOOLS` constant and before `inject_project_path`. The function accepts `content`, `input`, `tool_name`, and `status` (default `"error"`), extracts `tool_call_id` from the input dict's `"id"` key, and returns a `ToolMessage` when the ID is present or a plain string otherwise.

### 3. Fix the `inject_project_path` short-circuit for `ledger_detect_project`

In the `_wrapped_ainvoke` closure inside `inject_project_path`, replace the `return json.dumps({...})` with:
```python
return _make_tool_response(json.dumps({...}), input, _tool_name, status="success")
```

### 4. Fix the `restrict_to_wp` soft-fail return

In the `_guarded_ainvoke` closure inside `restrict_to_wp`:

a. Capture the tool name in the closure's default arguments: add `_tool_name: str = tool_name` to the function signature.

b. Replace the `return (f"ERROR: ...")` with:
```python
error_msg = (
    f"ERROR: Tool call targets work_package_id={call_wp_id!r} "
    f"but the active work package is {_active_wp!r}. "
    f"You MUST retry this call with work_package_id={_active_wp!r}. "
    f"(violation {_counter[0]} of {_max_soft} allowed before hard abort)"
)
return _make_tool_response(error_msg, input, _tool_name)
```

### 5. Update existing tests that use ToolCall dicts with `id` field

In `orchestrator/tests/test_tool_wrappers.py`, the following test calls `restrict_to_wp` soft-fail with a ToolCall dict containing `"id"`:

- `test_toolcall_structure_first_violation_returns_error_string` — currently asserts `isinstance(result, str)`. After the fix, when `id` is present, the result is a `ToolMessage`. Update the assertion to:
  ```python
  from langchain_core.messages import ToolMessage
  assert isinstance(result, ToolMessage)
  assert result.status == "error"
  assert "ERROR" in result.content
  ```

### 6. Add new tests for the `_make_tool_response` helper

Add a new test class `TestMakeToolResponse` covering:

- Plain dict input (no `id` key) → returns plain string.
- ToolCall dict input (with `id` key) → returns `ToolMessage` with correct `tool_call_id`, `name`, `status`, and `content`.
- Non-dict input → returns plain string.
- `status` parameter is forwarded correctly (test both `"error"` and `"success"`).

### 7. Add a test for `inject_project_path` ledger_detect_project short-circuit

Add a test class `TestLedgerDetectProjectShortCircuit` with:

- A test using a ToolCall dict (with `id`) calling a tool named `ledger_detect_project` → verify the result is a `ToolMessage` with `status="success"` and content is valid JSON with `plan_path`, `slug`, `title`, `status` keys.
- A test using a flat dict → verify the result is a plain string (JSON).

### 8. Add an integration-style test for restrict_to_wp with ToolCall

Add a test that calls `restrict_to_wp` soft-fail with a ToolCall dict containing `"id"`, verifying:

- First violation returns `ToolMessage` (not `str`).
- `ToolMessage.status == "error"`.
- `ToolMessage.content` contains the `"ERROR"` prefix.
- `ToolMessage.tool_call_id` matches the input `id`.
- `ToolMessage.name` matches the tool name.

### 9. Update module docstring

Add a note to the `tool_wrappers.py` module docstring explaining the `ToolMessage` wrapping requirement and referencing langchain-core ≥ 1.2.x / LangGraph ≥ 1.0.x compatibility.

## Dependencies

- `langchain-core` (already installed, ≥ 1.2.22) — provides `ToolMessage`.
- No new dependencies required.

## Required Components

- `orchestrator/src/utils/tool_wrappers.py` — **modify**: add import, helper function, fix two return sites, capture tool name in restrict_to_wp closure.
- `orchestrator/tests/test_tool_wrappers.py` — **modify**: update one existing test assertion, add new test classes for the helper and both short-circuit paths.

## Assumptions

- The `input` dict passed by LangGraph's ToolNode always contains `"id"` (the tool call ID). Confirmed by reading `_execute_tool_async`: `call_args = {**injected_call, "type": "tool_call"}` where `injected_call` is derived from the tool call which has an `id` field.
- `ToolMessage(content=str, tool_call_id=str, name=str, status=str)` is the stable constructor API in langchain-core ≥ 1.2.x.
- The `log_tool_calls` wrapper does NOT have any short-circuit return paths and is not affected by this bug.

## Constraints

- Must maintain backward compatibility for callers that pass plain dicts without `"id"` (all existing unit tests use this pattern).
- Cross-platform: Python stdlib + langchain-core only — no OS-specific code.
- The `restrict_to_wp` hard-kill path (violation 3+) raises `ValueError`, which is caught by LangGraph's error handler and converted to a `ToolMessage` with `status="error"` by `_execute_tool_async` itself — no change needed there.

## Out of Scope

- Upgrading LangGraph or langchain-core versions.
- Refactoring the monkeypatch approach to use a different mechanism (e.g. subclassing, middleware).
- Fixing the workflow-level issue of agents trying to work on wrong WPs (that's a prompt/persona concern, not a tooling bug).
- The `log_tool_calls` wrapper (it always delegates to the underlying `ainvoke` and never short-circuits).

## Acceptance Criteria

- `TypeError: Tool ledger_begin_work returned unexpected type: <class 'str'>` no longer occurs when `restrict_to_wp` returns a soft-fail.
- `TypeError: Tool ledger_detect_project returned unexpected type: <class 'str'>` no longer occurs when `inject_project_path` short-circuits.
- Soft-fail error message content is preserved in the `ToolMessage.content` field so the LLM agent can still self-correct.
- All existing tests in `test_tool_wrappers.py` pass (with the updated assertion for the ToolCall test).
- New tests for `_make_tool_response`, `ledger_detect_project` short-circuit, and `restrict_to_wp` ToolCall soft-fail all pass.
- Full test suite runs green: `python3 -m pytest tests/test_tool_wrappers.py`.

## Testing Strategy

- **Unit tests** for `_make_tool_response` covering all input shapes (dict with `id`, dict without `id`, non-dict) and both status values.
- **Unit tests** for the `ledger_detect_project` short-circuit with both flat and ToolCall inputs.
- **Updated unit test** for `restrict_to_wp` ToolCall soft-fail asserting `ToolMessage` type.
- **New unit test** for `restrict_to_wp` ToolCall soft-fail verifying `tool_call_id`, `name`, `status`, and `content` fields.
- **Regression**: run the full `test_tool_wrappers.py` suite to confirm no existing behavior is broken.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **`ToolMessage` constructor API changes in future langchain-core versions** | Pin to `>=1.2.22` in requirements; `ToolMessage` is a stable core class. |
| **Tests asserting `isinstance(result, str)` for flat-dict soft-fail calls break** | The helper returns plain strings when `tool_call_id` is absent — flat-dict tests are unaffected. Only the ToolCall-dict test needs updating. |
| **Deep Agents subagent passes tools differently, bypassing our wrapper** | Confirmed via traceback: the error occurs inside the subagent's ToolNode, which calls the same wrapped `tool.ainvoke`. The fix makes the wrapper return the correct type regardless of call depth. |
| **`inject_project_path` ledger_detect_project short-circuit was previously untested** | Adding dedicated tests for this path in step 7 closes the coverage gap. |
