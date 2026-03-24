# Plan

## Summary

Three of four errors from the 2026-03-24 orchestrator run stem from LLM agents calling MCP tools with wrong or missing parameters. Two are real bugs (errors 2 and 3); one is expected behavior (error 1). This plan hardens the orchestrator's `tool_wrappers.py` safety net and tightens persona-level instructions to prevent recurrence.

| # | Error | Root Cause | Fix Location |
|---|-------|-----------|--------------|
| 1 | `ledger_list_work_packages` → "Root index not found" | Expected — supervisor probes ledger before PM initializes it | None (working as designed) |
| 2 | `ledger_detect_project` → `cwd_path` Required | `tool_wrappers.py` strips `cwd_path` but never injects it; `detect_project` schema requires `cwd_path`, not `project_path` | `orchestrator/src/utils/tool_wrappers.py` |
| 3 | `ledger_begin_work` → "Cannot start pipeline 'qa'" | Developer LLM chose wrong pipeline type despite persona instructions | `orchestrator/src/nodes/developer.py` |

## Architectural Context

### Orchestrator tool wrapper ([orchestrator/src/utils/tool_wrappers.py](../../../../../../orchestrator/src/utils/tool_wrappers.py))

`inject_project_path()` wraps every MCP tool's `ainvoke` to auto-inject `project_path` when the LLM omits it. It also strips `cwd_path` (an IDE-agent convenience param) and replaces it with `project_path`. The current logic:

```python
if "cwd_path" in target:
    del target["cwd_path"]
target.setdefault("project_path", _proj)
```

**Problem:** `ledger_detect_project` only accepts `cwd_path` (required), not `project_path`. The wrapper strips `cwd_path` and never injects it, leaving the tool call with no `cwd_path` → schema validation failure.

### MCP tool schemas

Most MCP tools accept `project_path` (primary) and `cwd_path` (optional auto-detect fallback). However, `ledger_detect_project` accepts **only** `cwd_path` (required). Zod schemas silently strip unknown keys, so injecting both `project_path` and `cwd_path` into every call is safe — tools will accept what they need and ignore the rest.

### Developer node ([orchestrator/src/nodes/developer.py](../../../../../../orchestrator/src/nodes/developer.py))

The developer user-turn prompt provides `project_path` and `wp_id` but does NOT specify which pipeline type to start. The persona system prompt says to start `implementation`, but the LLM didn't follow that instruction and called `ledger_begin_work(type="qa")` instead.

## Approach / Architecture

### Fix 1: Inject both `cwd_path` and `project_path` in the tool wrapper

Extend `inject_project_path()` so it injects **both** `project_path` and `cwd_path` using the authoritative project path. This satisfies all MCP tool schemas regardless of which parameter they require:

```python
if "cwd_path" in target:
    del target["cwd_path"]
target.setdefault("project_path", _proj)
target.setdefault("cwd_path", _proj)
```

Zod strips unknown keys before validation, so tools that only accept `project_path` will ignore `cwd_path` and vice versa. This is a belt-and-suspenders approach that eliminates this class of error entirely.

### Fix 2: Inject pipeline type into the developer user prompt

Add the recommended pipeline type (`implementation`) to the developer's user-turn prompt so the LLM doesn't have to infer it:

```python
return (
    f"**Project path:** {project_path}\n"
    f"**Work package:** {wp_id}\n"
    f"**Pipeline to start:** `implementation`\n\n"
    f"**CRITICAL — …**\n"
)
```

This supplements (not replaces) the persona system prompt guidance and gives the LLM an explicit, per-invocation instruction.

## Rationale

- **Fix 1** targets the root cause at Layer 2 (the safety-net wrapper). Even if persona prompts are improved, LLMs can always hallucinate wrong parameter names. The wrapper should guarantee that ALL path-based parameters an MCP tool might require are present. This is a one-line change with no semantic risk because Zod strips unknown keys.

- **Fix 2** addresses a prompt design gap. The system prompt says "start the implementation pipeline" but the user-turn prompt — which carries more weight in LLM attention — omits the pipeline type. Making it explicit in both locations reduces the chance of the LLM inventing a different pipeline type to `ledger_begin_work`.

- **Error 1 (no fix needed):** The supervisor's pre-PM probe of `ledger_list_work_packages` is intentional — it uses the "Root index not found" error to determine that the PM stage must run first. The code already handles this gracefully at `supervisor.py` L295-310.

## Detailed Steps

1. **Modify `inject_project_path()` in `tool_wrappers.py`** to also inject `cwd_path`:
   - In the `_wrapped_ainvoke` function, after `target.setdefault("project_path", _proj)`, add: `target.setdefault("cwd_path", _proj)`
   - Update the inline comment to explain why both are injected

2. **Update `tool_wrappers.py` tests** to cover the new `cwd_path` injection:
   - Add a test: tool called with no `cwd_path` → verify `cwd_path` is auto-injected
   - Add a test: tool called with explicit `cwd_path` that was stripped → verify `cwd_path` is re-injected
   - Verify existing tests still pass (the `cwd_path`-stripping tests should be updated: `cwd_path` is now re-injected with the authoritative value rather than simply deleted)

3. **Modify `_build_developer_prompt()` in `developer.py`** to include the pipeline type:
   - Add `**Pipeline to start:** \`implementation\`` to the prompt string

4. **Run the test suite** (`pytest orchestrator/tests/`) to verify no regressions

## Dependencies

- None — both changes are internal to the orchestrator and do not affect MCP server code or persona templates

## Required Components

- `orchestrator/src/utils/tool_wrappers.py` — inject `cwd_path` alongside `project_path`
- `orchestrator/tests/test_tool_wrappers.py` — update/add test cases
- `orchestrator/src/nodes/developer.py` — add pipeline type to user prompt

## Assumptions

- Zod silently strips unknown keys from tool call arguments (confirmed: MCP server uses `z.object({…})` without `.strict()`, and Zod's default behavior is to strip unknown keys)
- The MCP SDK does not independently reject unknown parameters before Zod validation (confirmed: the error format in the logs is native Zod, meaning Zod is the validation layer)

## Constraints

- `tool_wrappers.py` must remain idempotent — repeated wrapping must not stack closures (existing sentinel pattern handles this)
- The developer pipeline type is hardcoded to `implementation` because the developer persona is architecturally bound to the implementation pipeline (per `workflow-manifest.json` and persona YAML)

## Out of Scope

- **Error 1** (Root index not found) — working as designed, no fix needed
- Persona template changes — the fixes target the orchestrator layer (Layer 2 safety net + user-turn prompts), not persona system prompts
- Removing `ledger_detect_project` from the orchestrator's available tools — filtering tools is more invasive and less resilient than injecting correct parameters

## Acceptance Criteria

- `pytest orchestrator/tests/test_tool_wrappers.py` passes with new test cases covering `cwd_path` injection
- `pytest orchestrator/tests/` passes with no regressions
- Manual verification: the `inject_project_path` wrapper injects both `project_path` and `cwd_path` when neither is present in the tool call arguments
- The developer node's user-turn prompt includes the string `implementation`

## Testing Strategy

- **Unit tests** in `test_tool_wrappers.py`: verify `cwd_path` auto-injection, verify existing `cwd_path`-stripping tests are updated to reflect the new "strip then re-inject" behavior
- **Existing test suite**: full `pytest` run to catch regressions
- **Integration**: next orchestrator run should produce zero `cwd_path Required` errors and zero `Cannot start pipeline 'qa'` errors

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Injecting `cwd_path` into tools that don't expect it causes unexpected behavior** | Zod strips unknown keys by default; MCP SDK uses Zod for validation. Confirmed tools do not use `.strict()`. |
| **Hardcoding `implementation` pipeline in developer prompt is too rigid** | The developer persona is architecturally bound to `implementation` pipeline. If this changes, the node factory already needs updating for the routing logic. |
| **LLM still calls wrong pipeline type despite prompt improvement** | The MCP server's `begin-work.ts` validation (L168-176) is the hard guard. The prompt improvement reduces frequency; the guard prevents incorrect state transitions. |
