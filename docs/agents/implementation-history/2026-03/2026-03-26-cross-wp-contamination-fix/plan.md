
# Plan

## Summary

Fix cross-work-package contamination errors in the orchestrator. Two root causes were identified: (1) a deterministic bug where the supervisor fails to clear `current_wp_id` when routing to the synthesis stage, causing `restrict_to_wp` to activate with a stale WP ID; (2) LLM hallucination of adjacent WP IDs in QA, Reviewer, Developer, and Documentation stages, where agents read dependency data from tool responses and attempt to operate on related work packages. This plan addresses both issues through code fixes, improved prompt scoping, test coverage, and a missing scope restriction in the docs node.

## Architectural Context

The orchestrator is a LangGraph StateGraph with a hub-and-spoke topology. A deterministic `supervisor` node reads ledger state via MCP tools and routes to pipeline stage nodes (`pm`, `developer`, `qa`, `reviewer`, `docs`, `security_auditor`, `release_engineer`, `synthesis`) via `Command(goto=<stage>, update={...})`. Each stage node creates a fresh Deep Agent with no message carryover.

Key modules:
- `orchestrator/src/supervisor.py` — deterministic routing logic; two code paths route to synthesis (all-WPs-terminal at line ~491 and all-roles-WAIT at line ~682)
- `orchestrator/src/nodes/__init__.py` — `create_stage_node()` generic factory; reads `current_wp_id` from state and activates `restrict_to_wp` guard when non-empty
- `orchestrator/src/nodes/synthesis.py` — `_build_synthesis_prompt()` intentionally omits `wp_id`; synthesis is project-scoped
- `orchestrator/src/utils/tool_wrappers.py` — `restrict_to_wp()` raises `ValueError` on cross-WP tool calls; skips wrapping when `wp_id` is empty string
- `orchestrator/src/nodes/qa.py`, `reviewer.py`, `developer.py` — include `SCOPE RESTRICTION` text in prompts
- `orchestrator/src/nodes/docs.py` — **missing** `SCOPE RESTRICTION` text (only has generic `_WP_SCOPE_REMINDER` from `build_stage_prompt`)
- `orchestrator/tests/test_supervisor.py` — existing synthesis routing tests assert `goto == "synthesis"` but do not assert `current_wp_id == ""`
- `orchestrator/tests/test_tool_wrappers.py` — existing `restrict_to_wp` tests

## Approach / Architecture

Three coordinated changes:

1. **Fix the synthesis routing bug** — add `"current_wp_id": ""` to both synthesis routing paths in `supervisor.py`. This is a 2-line code change that eliminates the deterministic synthesis failure.

2. **Strengthen prompt scoping** — enhance the `SCOPE RESTRICTION` text in QA, Reviewer, Developer, and Docs node prompts with an explicit negative example that tells the LLM not to target dependency WPs seen in tool responses. Also add the missing `SCOPE RESTRICTION` block to the docs node prompt, which currently relies only on the generic `_WP_SCOPE_REMINDER`.

3. **Add test coverage** — add test assertions to the existing synthesis routing tests to verify `current_wp_id` is cleared. Add a new test verifying that when `current_wp_id` was non-empty before synthesis routing, the update clears it.

## Rationale

- **Approach A (clear WP ID)** is the only correct fix for Root Cause 1. The synthesis stage's documented intent is to operate across all WPs; the `restrict_to_wp` guard was never meant to activate for synthesis; the stale state is a plain bug.
- **Approach D (stronger prompts)** is the lowest-risk mitigation for Root Cause 2. It cannot fully eliminate LLM hallucination but reduces its frequency. The alternatives (silent replacement, response filtering) either mask bugs or add fragile filtering logic.
- **Adding docs scope restriction** is a gap fix — the docs node was the only stage missing the explicit `SCOPE RESTRICTION` text, despite being susceptible to the same LLM hallucination.
- **Test coverage** ensures the synthesis routing fix is protected against regression.

## Detailed Steps

1. **Fix synthesis routing — all-WPs-terminal path** (`orchestrator/src/supervisor.py`, line ~493)
   - In the `update` dict of the `Command(goto=_DEST_SYNTHESIS, ...)` return inside the `if all(...)` block, add `"current_wp_id": ""` after `"current_stage": _DEST_SYNTHESIS`.

2. **Fix synthesis routing — all-roles-WAIT path** (`orchestrator/src/supervisor.py`, line ~685)
   - In the `update` dict of the `Command(goto=_DEST_SYNTHESIS, ...)` return at the end of `supervisor_node`, add `"current_wp_id": ""` after `"current_stage": _DEST_SYNTHESIS`.

3. **Enhance WP scope reminder** (`orchestrator/src/nodes/__init__.py`, line ~42)
   - Update `_WP_SCOPE_REMINDER` to include a concrete negative example about dependency WPs:
   ```python
   _WP_SCOPE_REMINDER = (
       "CRITICAL: Every MCP tool call MUST use `work_package_id={wp_id}`. "
       "Do NOT reference or operate on any other work package. "
       "Even if tool responses show dependencies or related WPs (e.g. "
       "WP-004 depends on {wp_id}), you must NOT call any tool targeting "
       "those other WP IDs."
   )
   ```

4. **Add docs node scope restriction** (`orchestrator/src/nodes/docs.py`, line ~38)
   - Update `_build_docs_prompt` to include the same `SCOPE RESTRICTION` extra text used by QA, Reviewer, and Developer:
   ```python
   def _build_docs_prompt(state: WorkflowState) -> str:
       wp_id = state.get("current_wp_id", "")
       extra = (
           f"**SCOPE RESTRICTION — You must ONLY operate on work package {wp_id}. "
           "Do NOT call any MCP tool with a different work_package_id.**"
       )
       return build_stage_prompt(
           state["project_path"],
           wp_id=wp_id,
           extra=extra,
       )
   ```

5. **Add synthesis routing test assertions** (`orchestrator/tests/test_supervisor.py`)
   - In `test_all_complete_routes_to_synthesis`: add `assert cmd.update.get("current_wp_id") == ""`.
   - In `test_routes_to_synthesis_when_all_wps_mix_of_complete_and_cancelled`: add same assertion.
   - In `test_all_pipelines_pass_routes_to_synthesis`: add same assertion.
   - Add a **new test** `test_synthesis_clears_stale_wp_id` that sets `current_wp_id` to `"WP-003"` in the input state, triggers the all-WPs-terminal synthesis route, and asserts the update clears it to `""`.
   - Add a **new test** `test_synthesis_via_all_wait_clears_stale_wp_id` that triggers the all-roles-WAIT synthesis route with a stale `current_wp_id` and asserts it is cleared. This requires configuring all roles to return WAIT actions.

6. **Run existing test suite** to confirm no regressions.

## Dependencies

- None — all changes are within the orchestrator sub-project.

## Required Components

- `orchestrator/src/supervisor.py` (modify — 2 lines)
- `orchestrator/src/nodes/__init__.py` (modify — update `_WP_SCOPE_REMINDER` constant)
- `orchestrator/src/nodes/docs.py` (modify — add scope restriction to prompt builder)
- `orchestrator/tests/test_supervisor.py` (modify — add assertions and new tests)

## Assumptions

- The synthesis stage should never have `restrict_to_wp` active — it must be free to query any WP in the project.
- LLM hallucination of adjacent WP IDs is a prompt-level issue, not a code bug — stronger prompts reduce but cannot eliminate it.
- The `_WP_SCOPE_REMINDER` in `build_stage_prompt` is the shared scope text injected into every stage with a `wp_id`; the per-stage `SCOPE RESTRICTION` in the `extra` field provides additional emphasis.

## Constraints

- Cross-platform policy: no platform-specific code introduced.
- No new dependencies.
- Orchestrator uses pytest + pytest-asyncio for testing.

## Out of Scope

- LLM response filtering (Approach C from research) — deferred pending frequency data.
- Silent WP ID injection (Approaches B/E) — rejected as unsafe.
- Persona system prompt changes — the scope restriction is an orchestrator-level concern, not a persona template change.
- Investigation of which specific MCP tool responses expose sibling WP IDs (noted as open question).

## Acceptance Criteria

- Synthesis routing paths in `supervisor.py` both include `"current_wp_id": ""` in their update dicts.
- All existing orchestrator tests pass without modification.
- New tests assert `current_wp_id` is cleared in synthesis routing for both code paths, including with a stale WP ID in input state.
- `_WP_SCOPE_REMINDER` includes a concrete negative example about dependency WPs.
- `_build_docs_prompt` includes the `SCOPE RESTRICTION` extra block, matching the pattern in QA, Reviewer, and Developer.

## Testing Strategy

- Run `python3 -m pytest orchestrator/tests/test_supervisor.py -v` to verify the new assertions and tests pass.
- Run `python3 -m pytest orchestrator/tests/ -v` for full regression.
- Manual verification: review the two `Command` return statements in `supervisor.py` to confirm `current_wp_id` is present.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Enhanced prompt increases token count** | Increase is ~20 tokens per stage prompt — negligible vs. the ~50K tokens per stage invocation |
| **Negative example in prompt causes over-restriction** | The example is specifically about not targeting *other* WP IDs in tool calls, not about reading dependency data; agents still see full context |
| **Clearing `current_wp_id` breaks synthesis node logic** | Synthesis node already handles empty `current_wp_id` — `_build_synthesis_prompt` never uses it, and `restrict_to_wp` explicitly skips wrapping when wp_id is empty |
