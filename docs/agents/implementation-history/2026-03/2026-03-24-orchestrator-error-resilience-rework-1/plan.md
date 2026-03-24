# Plan — Orchestrator Error Resilience (Rework 1)

## Summary

The second orchestrator run on the `2026-03-24-orchestrator-error-resilience` plan completed all 3 WPs but produced 5 errors from three distinct root causes: (A) the developer LLM completed implementation work without properly starting a pipeline first, (B) the QA LLM passed `handoff_notes` as a bare string instead of `string[]`, and (C) the reviewer LLM operated on WPs it wasn't dispatched for. This plan addresses all three with targeted fixes across the MCP server schema, orchestrator node prompts, and tool wrapper layer.

| # | Error | Stage | WP | Root Cause | Category |
|---|-------|-------|----|------------|----------|
| 1 | No IN_PROGRESS `implementation` pipeline for WP-001 | developer | WP-001 | Developer completed work without calling `ledger_begin_work` / `ledger_start_pipeline` first; then tried to complete a pipeline that was never started | A |
| 2 | No IN_PROGRESS `qa` pipeline for WP-001 | qa | WP-001 | Cascade from error 1 — QA could not complete a QA pipeline that was never started (implementation never PASSed, so QA had nothing to complete) | A (cascade) |
| 3 | `handoff_notes`: Expected array, received string | qa | WP-002 | LLM passed `handoff_notes: "some string"` instead of `handoff_notes: ["some string"]`; `summary` has lenient normalization but `handoff_notes` does not | B |
| 4 | No IN_PROGRESS `qa` pipeline for WP-003 | reviewer (dispatched for WP-001) | WP-003 | Reviewer dispatched for WP-001 called `ledger_complete_pipeline(work_package_id: "WP-003")` — cross-WP contamination | C |
| 5 | Cannot begin work on WP-001 (COMPLETE) | reviewer (dispatched for WP-003) | WP-001 | Reviewer dispatched for WP-003 called `ledger_begin_work(work_package_id: "WP-001")` — cross-WP contamination | C |

## Architectural Context

### MCP server `ledger_complete_pipeline` schema ([mcp-server/src/tools/pipeline.ts](../../../../mcp-server/src/tools/pipeline.ts))

The `CompletePipelineSchema` defines `handoff_notes` as `z.array(z.string()).optional()`. Unlike `summary` — which uses `z.union([z.string(), z.array(z.string())])` and is normalized in the `completePipeline` function (line ~356) — `handoff_notes` has no lenient input handling. When an LLM passes a bare string, Zod rejects the call with `-32602 Input validation error`.

### Orchestrator developer node ([orchestrator/src/nodes/developer.py](../../../../orchestrator/src/nodes/developer.py))

`_build_developer_prompt()` provides `project_path`, `wp_id`, and `pipeline_type: implementation`. However, the prompt does not explicitly instruct the LLM to call `ledger_begin_work` first. The persona system prompt contains this guidance, but it competes with hundreds of lines of other instructions. The developer LLM skipped the `ledger_begin_work` call and jumped straight to implementation + `ledger_complete_pipeline`.

### Orchestrator reviewer node ([orchestrator/src/nodes/reviewer.py](../../../../orchestrator/src/nodes/reviewer.py))

`_build_reviewer_prompt()` provides `project_path` and `wp_id`. However, the prompt uses `**Work package:** {wp_id}` without explicitly stating "ONLY operate on this work package." The reviewer LLM — seeing the ledger state for all WPs — decided to operate on other WPs it found in the ledger (WP-003 when dispatched for WP-001, and WP-001 when dispatched for WP-003).

### Orchestrator QA node ([orchestrator/src/nodes/qa.py](../../../../orchestrator/src/nodes/qa.py))

Same pattern as the reviewer: provides `wp_id` but no explicit single-WP guardrail.

### Stage error handling ([orchestrator/src/nodes/__init__.py](../../../../orchestrator/src/nodes/__init__.py))

When a Deep Agent call raises an exception (e.g., an MCP validation error), `create_stage_node` catches it and returns `stage_success: False`. The supervisor increments the consecutive-failure counter. After 3 consecutive failures for the same WP, the circuit breaker halts that WP. The errors in this run did not trigger the circuit breaker because WPs alternated between successes and failures.

## Approach / Architecture

### Fix A: Reinforce `ledger_begin_work` call in developer prompt

Add explicit first-step instruction to the developer's user-turn prompt. The user-turn prompt has the strongest LLM attention — placing the workflow step-1 instruction there (not just in the persona) prevents the LLM from skipping the pipeline start.

### Fix B: Normalize `handoff_notes` in `completePipeline`

Apply the same lenient-input pattern already used for `summary`: accept `z.union([z.string(), z.array(z.string())])` and normalize a bare string to a single-element array in the `completePipeline` function body. This is consistent with the existing `summary` normalization and eliminates an entire class of LLM-caused validation failures.

### Fix C: Add single-WP guardrail to all stage prompts

Add an explicit `**SCOPE RESTRICTION**` line to all stage user-turn prompts (developer, qa, reviewer) that tells the LLM it must ONLY operate on the specified WP and must NOT call any MCP tool with a different `work_package_id`. This is a prompt-level defense. A code-level defense (wrapper that rejects cross-WP tool calls) is more invasive and is proposed as a future enhancement.

### Fix C (enhanced): Tool wrapper WP-scope guard (recommended)

Add a `restrict_to_wp()` wrapper in `tool_wrappers.py` that — similar to `inject_project_path()` — intercepts every MCP tool call and, if a `work_package_id` argument is present, validates it matches the active WP. If it doesn't match, the wrapper raises an error instead of forwarding the call to the MCP server. This is a defense-in-depth measure that prevents cross-WP contamination regardless of LLM behavior.

## Rationale

- **Fix A** targets the strongest-attention zone in the prompt. The persona system prompt already says to start a pipeline, but the user-turn prompt's concise, direct instructions carry more weight. Adding "Step 1: call `ledger_begin_work`" at the user-turn level should prevent the LLM from skipping it.

- **Fix B** follows the established precedent set by `summary` normalization. LLMs reliably produce wrong types for array-of-string fields (passing a bare string ~20% of the time). The `summary` normalization has been working perfectly since it was added; applying the same pattern to `handoff_notes` is zero-risk.

- **Fix C** (prompt guardrail) is a lightweight, immediate mitigation. LLMs respect explicit scope restrictions in user-turn prompts with high reliability when stated clearly.

- **Fix C enhanced** (tool wrapper guard) provides defense-in-depth. Even if the LLM ignores the prompt guardrail, the wrapper prevents the cross-WP call from reaching the MCP server. The error message will also be more informative (telling the LLM exactly what went wrong), increasing the chance the LLM self-corrects on retry.

## Detailed Steps

### Fix A — Developer prompt: explicit `ledger_begin_work` instruction

1. **Modify `_build_developer_prompt()` in `orchestrator/src/nodes/developer.py`**:
   - Add an explicit "Step 1" instruction to call `ledger_begin_work` before doing any implementation work.
   - Add text: `**Step 1 — BEFORE writing any code:** Call \`ledger_begin_work\` with work_package_id={wp_id}, type="implementation", agent_role="Developer".`

### Fix B — Normalize `handoff_notes` in `completePipeline`

2. **Modify `CompletePipelineSchema` in `mcp-server/src/tools/pipeline.ts`**:
   - Change `handoff_notes` from `z.array(z.string()).optional()` to `z.union([z.string(), z.array(z.string())]).optional()`
   - This allows both `"some note"` and `["note1", "note2"]` at the schema level.

3. **Add normalization in `completePipeline()` function** (same file, around line 358):
   - After the existing `summary` normalization block, add:
     ```typescript
     // handoff_notes: coerce a bare string to a single-element array
     const normalizedHandoffNotes: string[] | undefined =
       typeof rawArgs.handoff_notes === 'string'
         ? [rawArgs.handoff_notes]
         : rawArgs.handoff_notes;
     ```
   - Add `handoff_notes: normalizedHandoffNotes` to the `args` spread object.

4. **Add a unit test** in the existing `mcp-server/tests/tools/pipeline.test.ts` (or the relevant test file for `complete_pipeline`):
   - Test that calling `ledger_complete_pipeline` with `handoff_notes: "some string"` succeeds and produces a proper handoff note entry.

### Fix C — Single-WP scope guardrail in stage prompts

5. **Modify `_build_developer_prompt()` in `orchestrator/src/nodes/developer.py`**:
   - Add scope restriction text: `**SCOPE RESTRICTION — You must ONLY operate on work package {wp_id}. Do NOT call any MCP tool with a different work_package_id.**`

6. **Modify `_build_qa_prompt()` in `orchestrator/src/nodes/qa.py`**:
   - Add identical scope restriction text.

7. **Modify `_build_reviewer_prompt()` in `orchestrator/src/nodes/reviewer.py`**:
   - Add identical scope restriction text.

### Fix C Enhanced — Tool wrapper WP-scope guard

8. **Add `restrict_to_wp()` function in `orchestrator/src/utils/tool_wrappers.py`**:
   - Similar to `inject_project_path()`, wrap each tool's `ainvoke`.
   - If the tool call arguments contain `work_package_id` and it doesn't match the active WP, raise a `ValueError` with a clear message: `"Tool call rejected: work_package_id '{called_wp}' does not match the active work package '{active_wp}'. You must only operate on the work package you were dispatched for."`
   - If no `work_package_id` is present in the arguments, pass through (not all tools require it).

9. **Integrate `restrict_to_wp()` in `create_stage_node()`** in `orchestrator/src/nodes/__init__.py`:
   - After calling `inject_project_path()`, call `restrict_to_wp(wrapped_tools, _wp_id)` to apply the WP scope guard.
   - Only apply when `_wp_id` is non-empty (synthesis stage may not have a WP).

10. **Add tests for `restrict_to_wp()`** in `orchestrator/tests/test_tool_wrappers.py`:
    - Test: tool call with matching WP → passes through.
    - Test: tool call with mismatching WP → raises `ValueError`.
    - Test: tool call with no `work_package_id` → passes through.
    - Test: guard not applied when active WP is empty string → all calls pass through.

11. **Run the full test suite**:
    - `cd mcp-server && npx vitest run` for Fix B
    - `cd orchestrator && pytest tests/` for Fixes A, C, C-enhanced

## Dependencies

- Fix B (MCP server schema change) is independent of the orchestrator fixes.
- Fixes A and C (prompt changes) are independent of each other.
- Fix C-enhanced (tool wrapper guard) depends on understanding the `inject_project_path()` pattern but is implementation-independent from the other fixes.

## Required Components

- `orchestrator/src/nodes/developer.py` — prompt enhancement (Fix A + Fix C)
- `orchestrator/src/nodes/qa.py` — prompt enhancement (Fix C)
- `orchestrator/src/nodes/reviewer.py` — prompt enhancement (Fix C)
- `mcp-server/src/tools/pipeline.ts` — `handoff_notes` schema + normalization (Fix B)
- `orchestrator/src/utils/tool_wrappers.py` — WP-scope guard function (Fix C-enhanced)
- `orchestrator/src/nodes/__init__.py` — integrate WP-scope guard (Fix C-enhanced)
- `orchestrator/tests/test_tool_wrappers.py` — new tests (Fix C-enhanced)
- MCP server test file for `complete_pipeline` — new test (Fix B)

## Assumptions

- The `z.union([z.string(), z.array(z.string())])` pattern for `handoff_notes` is safe because `completePipeline` normalizes before use, matching the existing `summary` pattern.
- The `restrict_to_wp()` wrapper will not break tools that don't use `work_package_id` (they pass through).
- The synthesis stage should NOT have the WP restriction applied (it operates across all WPs by design).

## Constraints

- `tool_wrappers.py` must remain idempotent — repeated wrapping must not stack closures (existing sentinel pattern handles this; the new `restrict_to_wp()` should follow the same pattern).
- The MCP server schema change must maintain backward compatibility — existing callers passing `string[]` must still work.
- Prompt changes must not exceed reasonable length — keep additions concise and high-signal.

## Out of Scope

- Retrying failed stage turns within the same supervisor iteration (the current design is: fail → log error → return to supervisor → supervisor routes next).
- Adding a `ledger_begin_work` call automatically in the tool wrapper (too invasive — implicit state transitions are worse than explicit ones).
- Filtering available MCP tools per stage (e.g., giving QA only QA-relevant tools) — more invasive and could break legitimate cross-tool use cases.

## Acceptance Criteria

- `npx vitest run` in `mcp-server/` passes, including a new test for `handoff_notes` as bare string.
- `pytest tests/` in `orchestrator/` passes, including new tests for `restrict_to_wp()`.
- Developer user-turn prompt contains explicit `ledger_begin_work` instruction.
- QA, developer, and reviewer user-turn prompts contain explicit single-WP scope restriction.
- `restrict_to_wp()` function exists in `tool_wrappers.py` and is integrated into `create_stage_node()`.
- Manual verification: next orchestrator run produces zero cross-WP errors and zero `handoff_notes` type errors.

## Testing Strategy

- **Unit tests (MCP server):** Verify `ledger_complete_pipeline` accepts `handoff_notes` as a bare string and normalizes it to an array.
- **Unit tests (orchestrator):** Verify `restrict_to_wp()` blocks cross-WP calls, passes matching-WP calls, and passes calls without `work_package_id`.
- **Existing test suites:** Full runs of both `vitest` (mcp-server) and `pytest` (orchestrator) to catch regressions.
- **Integration:** Next orchestrator run on a new plan should produce zero instances of these error categories.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **`restrict_to_wp()` blocks legitimate cross-WP reads** (e.g., `ledger_list_work_packages`) | The guard only activates when the tool call includes a `work_package_id` argument. Read-all tools like `ledger_list_work_packages` don't take this parameter. |
| **Prompt additions make the user-turn too long, reducing LLM attention to critical parts** | Keep additions to 2-3 lines max per prompt. Use bold formatting for visual salience. |
| **LLM still skips `ledger_begin_work` despite user-turn instruction** | The `restrict_to_wp()` guard and the MCP server's own validation prevent state corruption. The stage will fail and be caught by the circuit breaker. |
| **`handoff_notes` normalization changes behavior for existing callers** | No — existing callers pass `string[]` (or omit the field), which continues to work. Only bare-string inputs are newly accepted. |
| **`restrict_to_wp()` sentinel pattern increases wrapper complexity** | Follow the identical pattern used by `inject_project_path()` — already proven safe in production. |
