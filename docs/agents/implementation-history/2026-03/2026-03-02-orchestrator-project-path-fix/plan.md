# Plan

## Summary

After the WP-005 `detect-project-by-path` MCP server update, **all** ledger tools now require either `project_path` or `cwd_path`. The orchestrator's six stage-node prompts (`pm`, `developer`, `qa`, `reviewer`, `docs`, `synthesis`) only include `project_path` in the **first** tool-call instruction of each procedure. All subsequent tool calls — `ledger_create_work_package`, `ledger_claim_work_package`, `ledger_start_pipeline`, `ledger_complete_pipeline`, etc. — are written without `project_path`, causing LLM agents to omit the parameter. This triggers a `ToolException: Error: Either project_path or cwd_path is required.` inside LangGraph's ToolNode, which re-raises the exception and crashes the entire `agent.ainvoke()` call. A two-layer fix is required: (1) update all six node prompts to include `project_path` in every tool-call step as defensive instruction, and (2) add a `project_path`-injecting tool wrapper as a safety net so correct behaviour is guaranteed regardless of LLM compliance.

A secondary fix addresses the `docs.py` node prompt, which still instructs the agent to call `ledger_update_work_package_status` to transition the WP to `COMPLETE`. The WP-006 auto-finalize feature makes this unnecessary (and it can fail with "Invalid transition" if `ledger_complete_pipeline` already auto-transitioned the WP). That step should be removed.

A **critical architectural fix** is also required: the supervisor's `_route_for_wp()` function re-implements the pipeline-ordering decision tree in Python, duplicating logic that already lives in `ledger_get_next_action` on the MCP server (the server's `§14.1–§14.5` priority algorithms). This means the orchestrator and the ledger can drift out of sync silently — new routing logic added to the server (rework limits, stale-pipeline detection, dependency unblocking, `CONTINUE_PIPELINE`, etc.) is invisible to the supervisor. The supervisor must be refactored to delegate its per-WP routing decision entirely to `ledger_get_next_action`, making the ledger the single source of truth for workflow logic.

---

## Architectural Context

### Affected files

| File | Role |
|------|------|
| `orchestrator/src/nodes/__init__.py` | Generic `create_stage_node` factory — calls `create_deep_agent(tools=mcp_tools)` |
| `orchestrator/src/nodes/pm.py` | PM prompt builder (`_build_pm_prompt`) |
| `orchestrator/src/nodes/developer.py` | Developer prompt builder (`_build_developer_prompt`) |
| `orchestrator/src/nodes/qa.py` | QA prompt builder (`_build_qa_prompt`) |
| `orchestrator/src/nodes/reviewer.py` | Reviewer prompt builder (`_build_reviewer_prompt`) |
| `orchestrator/src/nodes/docs.py` | Documentation prompt builder (`_build_docs_prompt`) |
| `orchestrator/src/nodes/synthesis.py` | Synthesis prompt builder (`_build_synthesis_prompt`) |
| `orchestrator/src/utils/` | Utilities directory; contains `persona.py`, `plan_parser.py`, `logging.py` |

| `orchestrator/src/supervisor.py` | Supervisor routing node — refactored in Layer 4 to delegate routing to `ledger_get_next_action` |

### New file

| File | Role |
|------|------|
| `orchestrator/src/utils/tool_wrappers.py` | (New) Auto-injects `project_path` into every tool `ainvoke` call when neither `project_path` nor `cwd_path` is present |

### Existing patterns
- `nodes/__init__.py`'s `create_stage_node` receives `mcp_tools: list[Any]` and passes them unmodified to `create_deep_agent`.
- `WorkflowState["project_path"]` always holds the absolute plan-directory path as set by the CLI at startup.
- The MCP server (WP-005) maps `project_path` (the plan-folder path) to the centralized storage slug. No changes to the MCP server are required.

---

## Approach / Architecture

### Layer 1 — Prompt updates (6 node files)

For each node, add a **"CRITICAL"** reminder block immediately after the `**Project path:**` header and rewrite every tool-call step to include `project_path={project_path!r}` (or `work_package_id` companion params where applicable). This directly instructs the LLM and is the primary fix.

**Per-node gaps to fill:**

| Node | Missing parameters on tool calls |
|------|-------------------------------|
| `pm` | `project_path` missing on `ledger_create_work_package` (step 3) and `ledger_get_project_status` (step 4) |
| `developer` | `project_path` and `work_package_id` missing on `ledger_claim_work_package` + `ledger_start_pipeline` — replaced by `ledger_begin_work` (§ Layer 3); `project_path` missing on `ledger_complete_pipeline` (step 5) |
| `qa` | `project_path` and `work_package_id` missing on bare `ledger_start_pipeline` — replaced by `ledger_begin_work` (§ Layer 3); `project_path` missing on `ledger_complete_pipeline` (step 4) |
| `reviewer` | `project_path` and `work_package_id` missing on bare `ledger_start_pipeline` — replaced by `ledger_begin_work` (§ Layer 3); `project_path` missing on `ledger_complete_pipeline` (step 4) |
| `docs` | `project_path` and `work_package_id` missing on bare `ledger_start_pipeline` — replaced by `ledger_begin_work` (§ Layer 3); `project_path` missing on `ledger_complete_pipeline` (step 4); `ledger_update_work_package_status` (step 5 — **remove** entirely per WP-006 auto-finalize) |
| `synthesis` | `project_path` missing on `ledger_get_work_package` (step 2); `ledger_complete_synthesis` (step 4 — to be added) |

**CRITICAL notice block template (insert after project_path header):**
```
**CRITICAL — EVERY MCP TOOL CALL MUST include `project_path={project_path!r}`.**
Omitting `project_path` from any tool call will cause it to fail immediately.
```

### Layer 2 — Tool wrapper (safety net)

Create `orchestrator/src/utils/tool_wrappers.py` with a single public function:

```python
def inject_project_path(tools: list, project_path: str) -> list:
    """
    Return the same tool list with each tool's ainvoke monkeypatched
    to auto-inject `project_path` when neither `project_path` nor
    `cwd_path` is present in the call arguments.
    """
```

The wrapper monkeypatches each tool's `ainvoke` using a closure that captures the original method and the `project_path` string. It only injects when both lookup keys are absent, so explicit calls (from the supervisor or prompt-following agents) are not affected.

In `nodes/__init__.py`, call `inject_project_path(mcp_tools, project_path)` to create a wrapped list before passing to `create_deep_agent`:

```python
from src.utils.tool_wrappers import inject_project_path

async def node_fn(state: "WorkflowState") -> dict:
    project_path: str = state["project_path"]
    # Wrap tools to auto-inject project_path as a safety net.
    wrapped_tools = inject_project_path(mcp_tools, project_path)
    agent = create_deep_agent(..., tools=wrapped_tools)
```

### Layer 3 — Replace two-step claim+start with `ledger_begin_work` (developer, qa, reviewer, docs)

The personas were updated to use `ledger_begin_work` (v1.8.1 changelog) as a single atomic tool that combines `ledger_claim_work_package` + `ledger_start_pipeline`. The v1.8.1 fix specifically improved `ledger_begin_work`'s cross-agent handoff guard so QA, Reviewer, and Documentation agents can start their respective pipelines on a Developer-assigned WP without a claim error (`claimed: false` is returned when the WP is already IN_PROGRESS and the caller is the legitimate pipeline-type owner).

The current orchestrator prompts are misaligned:
- `developer.py` uses the explicit two-step `ledger_claim_work_package` + `ledger_start_pipeline`.
- `qa.py`, `reviewer.py`, `docs.py` call `ledger_start_pipeline` directly **without first claiming the WP** — this fails when the WP is still `READY` (needs a claim transition first). `ledger_begin_work` resolves this atomically.
- Using `ledger_begin_work` reduces tool call count and aligns with the current API contract.

**Note on `ledger_get_next_action` in stage agents:** The personas use `ledger_get_next_action` as their primary task-discovery mechanism because they wake up cold and must ask the ledger "what should I do next?". In the orchestrator, the supervisor handles this role — it calls `ledger_get_next_action` per agent role, extracts the `work_package_id`, and injects it into `WorkflowState` via `current_wp_id`. Stage agents are therefore told exactly which WP to act on; they do **not** need to call `ledger_get_next_action` themselves.

### Layer 4 — Replace `_route_for_wp` with `ledger_get_next_action` in `supervisor.py`

**Current problem:** `_route_for_wp()` reimplements the pipeline-ordering decision tree in Python (checking `impl_status`, `qa_status`, `cr_status`, `doc_status` directly). As of v1.8.0, the MCP server's `ledger_get_next_action` incorporates a much richer algorithm: stale-pipeline detection (`RESUME_OR_CANCEL`), `CONTINUE_PIPELINE` (active non-stale pipeline), rework-cycle circuit breakers (`BLOCK_FOR_REWORK_LIMIT`), upstream rework-limit propagation (`WAIT_FOR_UPSTREAM_REWORK_LIMIT`), downstream re-engagement timing (`WAIT_FOR_DOWNSTREAM`), auto-finalize conditions (`FINALIZE_WP` / `UPDATE_CRITERIA`), blocked WP repair (`REPAIR_ORPHAN_BLOCKED`), and abandoned WP detection (`REVIEW_ABANDONED`). None of these are currently visible to the supervisor — they will cause silent routing errors.

**New supervisor flow:**

```
1. ledger_get_project_status → seed base_update state (observability)
2. ledger_list_work_packages → detect no-WP case → route to PM
3. If all WPs terminal → route to synthesis
4. Apply consecutive-failures circuit breaker (orchestrator-internal, unchanged)
5. For each role in priority order [Project Manager, Developer, QA, Reviewer, Documentation]:
   a. If role has a tripped circuit-breaker WP: skip (prevents re-dispatch)
   b. Call ledger_get_next_action(agent_role=role, project_path=...)
   c. If action != WAIT → extract work_package_id, map action → stage, return Command
6. All roles returned WAIT → route to synthesis
```

**Action → stage mapping:**

| `agent_role` | Actions that mean "route to this stage" |
|---|---|
| `Project Manager` | `UNBLOCK_WP`, `REVIEW_REWORK_LIMIT`, `REVIEW_STALE`, `REVIEW_ABANDONED`, `REPAIR_ORPHAN_BLOCKED` → `pm` |
| `Developer` | `IMPLEMENT`, `REWORK`, `CLAIM_WP`, `CONTINUE_PIPELINE`, `RESUME_OR_CANCEL` → `developer` |
| `QA` | `RUN_QA`, `REWORK_QA`, `CLAIM_WP`, `CONTINUE_PIPELINE`, `RESUME_OR_CANCEL` → `qa` |
| `Reviewer` | `RUN_REVIEW`, `CLAIM_WP`, `CONTINUE_PIPELINE`, `RESUME_OR_CANCEL` → `reviewer` |
| `Documentation` | `WRITE_DOCS`, `REWORK`, `FINALIZE_WP`, `UPDATE_CRITERIA`, `CLAIM_WP`, `CONTINUE_PIPELINE`, `RESUME_OR_CANCEL` → `docs` |
| Any | `WAIT`, `WAIT_FOR_REWORK`, `WAIT_FOR_DOWNSTREAM`, `WAIT_FOR_UPSTREAM_REWORK_LIMIT`, `BLOCK_FOR_REWORK_LIMIT` → skip this role |

Any unrecognised action string should be treated as a WAIT (skip) with a warning log, so that future server additions do not crash the supervisor.

**What is removed:**
- `_route_for_wp()` function entirely.
- `_get_latest_pipeline()` helper (only used by `_route_for_wp`).
- `_SKIP_IN_FLIGHT` sentinel (the server now handles in-flight detection via `CONTINUE_PIPELINE` / `RESUME_OR_CANCEL`).
- The per-WP `ledger_get_work_package` calls inside the supervisor loop (the server reads WP details internally during `ledger_get_next_action`).

**What is preserved:**
- `ledger_get_project_status` call (observability — seeds `project_status` in state).
- `ledger_list_work_packages` call (fast no-WP and all-terminal detection before spending 4-5 `ledger_get_next_action` calls).
- `consecutive_failures` circuit breaker — this is an **orchestrator-internal** counter tracking stage-node crashes within the current run. It is distinct from the server's `rework_counts` (which tracks pipeline-level FAIL cycles). When a WP has hit the circuit breaker threshold, skip it before calling `ledger_get_next_action` for the relevant role and inject the WP ID into the skip list.
- All `Command`/`goto` routing, `base_update` state construction, logging, and safety-limit logic.

**Circuit breaker integration:** The existing circuit breaker (halt after 3 consecutive stage failures for the same WP) must continue to work. Since we no longer iterate WPs in Python, the integration point changes: after `ledger_get_next_action` returns a non-WAIT action for a role, check whether the returned `work_package_id` has hit the circuit breaker threshold before routing. If it has, skip it and continue to the next role.

**Changes per node:**

| Node | Before | After |
|------|--------|-------|
| `developer` | `ledger_get_work_package` → `ledger_claim_work_package` → `ledger_start_pipeline` | `ledger_get_work_package` → `ledger_begin_work` |
| `qa` | `ledger_get_work_package` → `ledger_start_pipeline` | `ledger_get_work_package` → `ledger_begin_work` |
| `reviewer` | `ledger_get_work_package` → `ledger_start_pipeline` | `ledger_get_work_package` → `ledger_begin_work` |
| `docs` | `ledger_get_work_package` → `ledger_start_pipeline` | `ledger_get_work_package` → `ledger_begin_work` |

All `ledger_begin_work` calls must include `project_path={project_path!r}`, `work_package_id={wp_id!r}`, the appropriate `type`, and the matching `agent_role`.

---

### docs.py — WP-006 auto-finalize cleanup

Remove step 5 (`ledger_update_work_package_status` with `status='COMPLETE'`). Per the MCP API surface (WP-006 auto-finalize), when the Documentation agent calls `ledger_complete_pipeline` with `status='PASS'` and all acceptance criteria are met, the WP is transitioned to `COMPLETE` automatically within the same lock scope. Adding a manual `COMPLETE` transition after this point will either be a no-op or raise an "Invalid transition" error.

Update the `_build_docs_prompt` step sequence to 4 steps (removing step 5) and note that the WP will be auto-completed when the pipeline PASS is recorded with all criteria met.

---

## Rationale

- **Prompt fix first:** The LLM is the first line of defence. Explicit per-step `project_path` instructions dramatically reduce the likelihood of the LLM omitting them and avoids unnecessary wrapper overhead for the happy path.
- **Tool wrapper as safety net:** LLMs are not deterministic. A `project_path`-injecting wrapper makes the orchestrator robust against model variation, prompt compression, or future persona changes that might not carry the project_path reminder. The wrapper is transparent to the agent and requires no schema changes.
- **WP-006 cleanup:** Keeping the stale `ledger_update_work_package_status` step risks generating a hard error on successful runs (when auto-finalize transitions the WP before the manual call arrives). Removing it aligns the orchestrator with the current API contract.
- **No MCP server changes required:** The API is correct as of WP-005/WP-006; the issue is entirely on the orchestrator side.

---

## Detailed Steps

1. **Create `orchestrator/src/utils/tool_wrappers.py`**  
   Implement `inject_project_path(tools, project_path)` that:
   - Iterates over each tool in the list.
   - Stores the original `ainvoke` method in a closure variable.
   - Replaces `tool.ainvoke` with an async wrapper that calls `dict.setdefault("project_path", project_path)` on the input dict before delegating to the original.
   - Returns the (mutated) tool list.
   - Include a module docstring explaining the purpose and the WP-005 context.

2. **Update `orchestrator/src/nodes/__init__.py`**  
   - Import `inject_project_path` from `src.utils.tool_wrappers`.
   - In `node_fn` (inside the async function body, where imports are lazily resolved), after the existing `target_path` extraction, extract `project_path: str = state["project_path"]`.
   - Call `wrapped_tools = inject_project_path(list(mcp_tools), project_path)` — note: `project_path` is the plan-directory path used by ledger tools, **not** `target_project_path` (which is the codebase root used by `LocalShellBackend`).
   - Pass `wrapped_tools` to `create_deep_agent` instead of `mcp_tools`.

3. **Update `orchestrator/src/nodes/pm.py`**  
   In `_build_pm_prompt`:
   - Add the CRITICAL project_path reminder block after `**Project path:**`.
   - Step 3: Add `project_path={project_path!r}` to the `ledger_create_work_package` call instruction.
   - Step 4: Add `project_path={project_path!r}` to the `ledger_get_project_status` call instruction.

4. **Update `orchestrator/src/nodes/developer.py`**  
   In `_build_developer_prompt`:
   - Add the CRITICAL reminder block.
   - Replace the two-step `ledger_claim_work_package` + `ledger_start_pipeline` instructions with a single `ledger_begin_work` step including `project_path={project_path!r}`, `work_package_id={wp_id!r}`, `type='implementation'`, `agent_role='Developer'`.
   - Renumber remaining steps; add `project_path={project_path!r}` to `ledger_complete_pipeline`.

5. **Update `orchestrator/src/nodes/qa.py`**  
   In `_build_qa_prompt`:
   - Add the CRITICAL reminder block.
   - Replace the bare `ledger_start_pipeline` step with `ledger_begin_work` including `project_path={project_path!r}`, `work_package_id={wp_id!r}`, `type='qa'`, `agent_role='QA'`.
   - Add `project_path={project_path!r}` to `ledger_complete_pipeline`.

6. **Update `orchestrator/src/nodes/reviewer.py`**  
   In `_build_reviewer_prompt`:
   - Add the CRITICAL reminder block.
   - Replace the bare `ledger_start_pipeline` step with `ledger_begin_work` including `project_path={project_path!r}`, `work_package_id={wp_id!r}`, `type='code-review'`, `agent_role='Reviewer'`.
   - Add `project_path={project_path!r}` to `ledger_complete_pipeline`.

7. **Update `orchestrator/src/nodes/docs.py`**  
   In `_build_docs_prompt`:
   - Add the CRITICAL reminder block.
   - Replace the bare `ledger_start_pipeline` step with `ledger_begin_work` including `project_path={project_path!r}`, `work_package_id={wp_id!r}`, `type='documentation'`, `agent_role='Documentation'`.
   - Add `project_path={project_path!r}` to `ledger_complete_pipeline`.
   - **Remove step 5** (`ledger_update_work_package_status`). Replace with a note explaining WP-006 auto-finalize behaviour.

8. **Update `orchestrator/src/nodes/synthesis.py`**  
   In `_build_synthesis_prompt`:
   - Add the CRITICAL reminder block.
   - Step 2: Add `project_path={project_path!r}` to the `ledger_get_work_package` call instruction.
   - Step 4: Add a new sub-step instructing the agent to call `ledger_complete_synthesis` with `project_path={project_path!r}` and `agent_role='Synthesis'` after saving `synthesis.md`.

9. **Refactor `orchestrator/src/supervisor.py`**
   - Remove `_get_latest_pipeline()`, `_route_for_wp()`, and `_SKIP_IN_FLIGHT`.
   - Define a new `_ACTION_STAGE_MAP: dict[str, str]` module-level constant mapping every non-WAIT action string to a graph stage name (see Layer 4 mapping table).
   - Define `_SKIP_ACTIONS: frozenset[str]` for WAIT-class actions that mean "nothing to do for this role".
   - Inside `supervisor_node`, after the all-terminal and no-WP checks, iterate roles in order `["Project Manager", "Developer", "QA", "Reviewer", "Documentation"]`.
   - For each role, call `ledger_get_next_action(agent_role=role, project_path=project_path)`. Extract `action` and `work_package_id` from the response.
   - If `action` is in `_SKIP_ACTIONS`, continue to next role.
   - If `action` is unrecognised, log a warning and continue (forward-compatibility).
   - If `work_package_id` is present and its consecutive failure count ≥ 3, skip it and continue.
   - Otherwise extract the destination from `_ACTION_STAGE_MAP`, construct the `Command`, and return.
   - If all roles return WAIT → route to synthesis.
   - Remove the `ledger_get_work_package` calls from the supervisor loop (they no longer occur here).
   - Remove the `actionable` WP list construction and the `wps_done_count` / `skip_count` loop variables.
   - Update the module docstring to reflect the new ledger-driven approach.
   - Retain `ledger_get_project_status` and `ledger_list_work_packages` calls with their existing error handling.

10. **Run unit tests**  
    Execute `pytest orchestrator/tests/` to verify no regressions. Specifically check `test_nodes.py` and `test_supervisor.py`. Add new supervisor tests that mock `ledger_get_next_action` responses covering each action type, the circuit breaker skip path, and the all-WAIT → synthesis path.

---

## Dependencies

- `orchestrator/src/nodes/__init__.py` (step 2) depends on `tool_wrappers.py` (step 1).
- Steps 3–8 are independent of each other and of steps 1–2.

---

## Required Components

- `orchestrator/src/utils/tool_wrappers.py` — **new file**
- `orchestrator/src/nodes/__init__.py` — modified
- `orchestrator/src/nodes/pm.py` — modified
- `orchestrator/src/nodes/developer.py` — modified
- `orchestrator/src/nodes/qa.py` — modified
- `orchestrator/src/nodes/reviewer.py` — modified
- `orchestrator/src/nodes/docs.py` — modified
- `orchestrator/src/nodes/synthesis.py` — modified
- `orchestrator/src/supervisor.py` — modified (Layer 4 refactor)
- `orchestrator/tests/test_supervisor.py` — modified (new routing tests)
- `orchestrator/tests/test_nodes.py` — modified (wrapper integration tests)

---

## Assumptions

- `create_deep_agent` from `deepagents` accepts a `tools` list of LangChain `BaseTool` instances. Replacing the list with the same instances (with monkeypatched `ainvoke`) does not break tool discovery or schema introspection.
- The `project_path` stored in `WorkflowState` is always an absolute path set correctly by the CLI at startup — no changes to `cli.py` or `state.py` are required.
- `ledger_initialize_project` is excluded from `inject_project_path`'s concern because its `project_path` argument is always already provided explicitly in the PM prompt and the supervisor does not call it.
- `ledger_help`, `ledger_detect_project`, and `ledger_list_projects` do not require `project_path` so injecting it is a safe no-op (Zod will simply ignore unknown optional fields, or the parameter is accepted and silently unused).

---

## Constraints

- Do not modify the MCP server (`mcp-server/src/`).
- Do not alter `WorkflowState` or `Config` — the project_path is already propagated correctly there.
- The wrapper must not override an explicitly provided `project_path` or `cwd_path` — use `setdefault` semantics, not assignment.
- The `docs.py` cleanup must not accidentally remove the `acceptance_criteria_updates` guidance from the `ledger_complete_pipeline` instruction.

---

## Out of Scope

- Adding `ledger_get_next_action` to **stage-agent prompts**. The supervisor calls it for routing; agents receive the result already resolved via `current_wp_id` in state.
- Changes to personas or the MCP server codebase.
- Parallelising `ledger_get_next_action` calls across roles (a future optimisation — sequential is correct and simpler for now).

---

## Acceptance Criteria

- Running the orchestrator against a fresh plan with no existing ledger initialises the project and creates work packages without `ToolException: Either project_path or cwd_path is required.`
- All tool calls from all six stage agents reliably include `project_path`, confirmed by either MCP server logs or test assertions.
- `orchestrator/tests/` passes with no regressions.
- Developer, QA, Reviewer, and Documentation agents use `ledger_begin_work` instead of the two-step `ledger_claim_work_package` + `ledger_start_pipeline` sequence.
- The `docs` stage no longer attempts to call `ledger_update_work_package_status` after `ledger_complete_pipeline`.
- The synthesis stage calls `ledger_complete_synthesis` after writing `synthesis.md`.
- `supervisor.py` contains no `_route_for_wp`, `_get_latest_pipeline`, or `_SKIP_IN_FLIGHT` — all routing decisions are delegated to `ledger_get_next_action`.
- The supervisor correctly routes when `ledger_get_next_action` returns `RESUME_OR_CANCEL`, `CONTINUE_PIPELINE`, `BLOCK_FOR_REWORK_LIMIT`, and `REPAIR_ORPHAN_BLOCKED` (actions invisible to the old implementation).

---

## Testing Strategy

- **Unit tests** (`orchestrator/tests/test_nodes.py`): Mock `create_deep_agent` and assert that `create_stage_node` wraps tools with `inject_project_path` before passing them to the agent. Assert each wrapped tool's `ainvoke` injects `project_path` when missing and preserves it when present.
- **Unit tests** (`orchestrator/tests/`): Add a test for `tool_wrappers.inject_project_path` that verifies: (a) `project_path` is injected when absent, (b) existing `project_path` is not overridden, (c) existing `cwd_path` is not overridden.
- **Unit tests** (`orchestrator/tests/test_supervisor.py`): Extend the existing supervisor test suite with mock `ledger_get_next_action` responses covering:
  - Each non-WAIT action type for each role routes to the correct graph stage.
  - `WAIT` from all roles routes to synthesis.
  - Circuit breaker: a WP with consecutive failures ≥ 3 is skipped even when `ledger_get_next_action` recommends it.
  - Unrecognised action string is treated as WAIT (no crash).
  - `RESUME_OR_CANCEL`, `CONTINUE_PIPELINE`, `BLOCK_FOR_REWORK_LIMIT`, `REPAIR_ORPHAN_BLOCKED` all route correctly.
- **Lightweight integration**: Manually run the orchestrator against the `2026-03-02-perceval-category-graceful-failure` plan (once the project is re-initialized) and confirm the PM stage creates work packages without error.

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **`create_deep_agent` uses tool identity checks** — if it detects that `ainvoke` was monkeypatched and rejects the tool | Scope monkeypatching to only `ainvoke`; other attributes (`name`, `description`, `args_schema`, etc.) remain unchanged. If `BaseTool` subclass identity is checked, create a minimal `BaseTool` subclass proxy instead. |
| **QA/Reviewer/Docs fail with `READY` WPs even after `ledger_begin_work` migration** — if `agent_role` value passed doesn't match `PIPELINE_AGENT_MAP` | Confirm exact role strings used: `'Developer'`, `'QA'`, `'Reviewer'`, `'Documentation'` (capitalised, matching constants in MCP server). A wrong string causes `ledger_begin_work` to reject with a role-mismatch error. |
| **LLM ignores explicit project_path prompts** | The Layer 2 wrapper is the fallback — even if the LLM ignores the prompt, `project_path` is injected at the Python level before the call reaches the MCP server. |
| **`docs.py` prompt removal of step 5 breaks WPs where not all criteria are met** | Per WP-006, when criteria are NOT all met, `ledger_complete_pipeline PASS` does NOT auto-finalize — the WP stays `IN_PROGRESS`. The Documentation agent should be instructed to re-run until all criteria pass. This behaviour is unchanged; we're only removing the now-incorrect explicit COMPLETE transition. |
| **Synthesis stage currently lacks `ledger_complete_synthesis` call** | Adding it (step 8) aligns the synthesis prompt with the required MCP tool call to mark the project COMPLETE. This was a pre-existing gap; fixing it here closes it. |
| **New `ledger_get_next_action` response shape adds fields or renames `action`** | Extract `action` and `work_package_id` defensively with `.get()`; treat any missing or unrecognised `action` as WAIT with a warning log. This guarantees forward-compatibility with future server changes. |
| **`ledger_get_next_action` for PM returns WAIT when there are no WPs but the project is uninitialized** | The `ledger_list_work_packages` early check is retained — it fires before the `ledger_get_next_action` loop and routes to PM when the WP list is empty, regardless of what the PM action would say. |
