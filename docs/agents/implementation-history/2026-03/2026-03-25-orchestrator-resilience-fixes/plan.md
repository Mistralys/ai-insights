# Plan

## Summary

Fix five systemic reliability issues in the orchestrator and MCP server that caused the `2026-03-25-persona-build-core-library` run to require 10 restarts over 5 hours. The failures fall into three categories: (A) orphaned pipelines after stage errors, (B) stale LangGraph checkpoint replay on resume, and (C) cross-WP contamination by confused agents. A fourth issue — the GUI reset not clearing per-WP pipeline arrays — exacerbated all of the above. A fifth issue — synthesis dispatched to a halted WP context — is a routing gap in the supervisor.

## Architectural Context

### Orchestrator (Python, LangGraph)

- **Graph** (`orchestrator/src/graph.py`): Builds a LangGraph `StateGraph` with checkpointing via `AsyncSqliteSaver` (SQLite). Each run is keyed by `thread_id`.
- **CLI** (`orchestrator/src/cli.py`): Entry point. Generates `thread_id = uuid4()` for new runs, or reuses the provided `--resume THREAD_ID`. Invokes `graph.ainvoke(initial_state | None, run_config)`.
- **Supervisor** (`orchestrator/src/supervisor.py`): Routes WPs to stage nodes. Implements a circuit breaker: 3 consecutive failures on a WP → `halted_repeated_failure`, WP is skipped for the rest of the run.
- **Stage nodes** (`orchestrator/src/nodes/__init__.py`, `developer.py`, etc.): Generic factory that wraps a Deep Agent invocation. On error, catches the exception and returns `stage_success: False` — **no rollback of MCP mutations**.
- **Tool wrappers** (`orchestrator/src/utils/tool_wrappers.py`): `restrict_to_wp()` injects a guard that rejects tool calls targeting a different `work_package_id`. Applied only when `_wp_id` is truthy.

### MCP Server (TypeScript)

- **Pipeline lifecycle**: `ledger_begin_work` creates an `IN_PROGRESS` pipeline on the WP. `ledger_complete_pipeline` sets it to `PASS`/`FAIL`. If the agent errors between these two calls, the pipeline is orphaned in `IN_PROGRESS`.
- **Pipeline status enum** (`mcp-server/src/schema/enums.ts`): `PipelineStatus = z.enum(['IN_PROGRESS', 'PASS', 'FAIL'])`. There is no `CANCELLED` value; cancellation is tracked via the boolean `auto_cancelled` flag on the pipeline object.
- **Pipeline cancellation tool**: `ledger_cancel_pipeline` already exists (`mcp-server/src/tools/pipeline.ts`). It finds the most recent `IN_PROGRESS` pipeline of a given type, sets `status = 'FAIL'` and `summary = ['Cancelled: {reason}']`. However, it does **not** set `auto_cancelled = true`, meaning crash-recovery cancellations would incorrectly count toward the rework budget (§11.2). This tool is also **not documented in the workflow specification** — it exists only in implementation.
- **GUI reset** (`mcp-server/src/utils/project-reset.ts`, `mcp-server/gui/api.ts`): `analyzeProjectForReset()` + `applyResetMutations()` reset WP status to `IN_PROGRESS`, clear acceptance criteria, and clear blockers — but **do not touch `wp.pipelines[]`**. Orphaned `IN_PROGRESS` pipelines survive the reset, causing immediate `begin_work` failures on the next run.

### Cross-WP Contamination Guard

`restrict_to_wp()` in `tool_wrappers.py` wraps each tool's `ainvoke` to check `work_package_id` in the tool call arguments. If the agent passes a different WP ID, the call is rejected. However:
- The guard only fires when the tool call **explicitly includes** `work_package_id`.
- The synthesis stage intentionally omits `_wp_id`, so its tools are never wrapped.

## Approach / Architecture

Five targeted fixes, each addressing a distinct failure mode observed in the logs:

1. **Orphaned pipeline cleanup** — Add rollback logic in the stage node factory: when a stage errors after `begin_work` was called, automatically cancel the orphaned pipeline via `ledger_cancel_pipeline`.
2. **GUI reset: clear orphaned pipelines** — Extend `applyResetMutations()` to auto-cancel any `IN_PROGRESS` pipelines on WPs being reset.
3. **Stale checkpoint detection** — When a non-`--resume` run starts, detect if the generated `thread_id` collides with an existing checkpoint and warn/fail-fast. Also, when `--resume` is used and the checkpoint is in a terminal state, detect this and advise the user to start a fresh run instead.
4. **Cross-WP contamination: harden the guard** — Make the `restrict_to_wp` guard inject the correct `work_package_id` into tool calls that omit it, rather than relying on the agent to pass the right one. Additionally, add a pre-invocation scope reminder in the prompt for agents working on specific WPs.
5. **Supervisor: cancel halted WPs before synthesis** — When all remaining actionable WPs are halted, the supervisor must first transition those WPs to a terminal status (`CANCELLED`) before routing to synthesis. Without this, `completeSynthesis` (§19.1) rejects the call because `pending_work_packages > 0` — halted WPs are still `IN_PROGRESS` in the ledger.

## Rationale

- **Fix 1 (orphaned pipelines)** is the highest-impact fix. Every single restart in this run was ultimately caused by an orphaned `IN_PROGRESS` pipeline blocking subsequent `begin_work` calls. The current error-handling architecture treats MCP tool calls as side-effect-free, but `begin_work` is a mutation that creates durable state. Rollback is the correct pattern.
- **Fix 2 (GUI reset)** is a defense-in-depth measure. Even with Fix 1, manual intervention via the GUI should produce a clean slate.
- **Fix 3 (stale checkpoint)** prevents the 1-second "false completion" runs (#3, #4 in the logs) where the orchestrator loaded an old checkpoint, replayed its terminal state, and exited without doing any work.
- **Fix 4 (cross-WP guard)** addresses 3 of the 10 runs failing due to the agent calling tools with the wrong WP ID (WP-003→WP-001, WP-003→WP-005, WP-006→WP-007). This is an LLM hallucination issue, but the tooling can compensate.
- **Fix 5 (synthesis routing)** addresses the edge case where synthesis was dispatched with `wp_id=WP-003` and then tried to call tools targeting WP-005, triggering the cross-WP guard. The deeper issue is that `completeSynthesis` (§19.1) requires all WPs to be terminal — halted WPs that are still `IN_PROGRESS` in the ledger block this guard entirely. The fix must cancel halted WPs before routing to synthesis.

## Detailed Steps

### Prerequisite: Workflow Specification Updates

The research analysis identified two specification gaps that should be addressed **before** implementation to ensure the code aligns with the spec rather than diverging further.

1. **Add §12.5 "Pipeline Cancellation" to the workflow specification** (`mcp-server/docs/agents/workflow-specification/operations.md`):
   - Document the `cancelPipeline` operation formally (it already exists in implementation as `ledger_cancel_pipeline` but is not spec'd).
   - Define it as: finds the most recent `IN_PROGRESS` pipeline of the given type, sets `status = 'FAIL'`, `completed_at = now()`, `summary = ['Cancelled: {reason}']`.
   - **Critical addition:** Specify that crash-recovery cancellations SHOULD set `auto_cancelled = true` so they do not consume rework budget (consistent with §21.27 semantics for pipeline closures caused by external interruptions, not quality failures).

2. **Add §21.67 edge case** (`mcp-server/docs/agents/workflow-specification/edge-cases.md`):
   - Document the agent-crash orphaned pipeline scenario and prescribed recovery: when an agent crashes between `begin_work` and `complete_pipeline`, the orchestrator MUST cancel the orphaned pipeline with `auto_cancelled = true`.

3. **Add orchestrator guidance in §16.3** (`mcp-server/docs/agents/workflow-specification/auxiliary-systems.md`):
   - Add a note that automated orchestrators without an interactive PM SHOULD transition circuit-broken WPs to `CANCELLED` when no PM intervention is available, to allow the project to reach synthesis.

### Fix 1: Orphaned Pipeline Rollback in Stage Nodes

1. **Update `ledger_cancel_pipeline`** in `mcp-server/src/tools/pipeline.ts`:
   - Add an optional `auto_cancelled` parameter (defaulting to `false` for backward compatibility).
   - When `auto_cancelled = true`, set the `auto_cancelled` flag on the pipeline object so the cancellation does not count toward rework budget (per new §12.5).
2. In `orchestrator/src/nodes/__init__.py`, in the generic stage node factory's `except` block (around line 250):
   - After catching the exception, check if `begin_work` was called during this stage invocation by inspecting the Deep Agent's tool call history or tracking it via a flag.
   - If yes, call the existing `ledger_cancel_pipeline` MCP tool with `auto_cancelled = true` to cancel the orphaned pipeline before returning the error state.
   - Log this rollback action as an `INFO` event with `action: "pipeline_rollback"`.
3. To track whether `begin_work` was called, add a lightweight wrapper around the tool list that sets a flag when `ledger_begin_work` is invoked. This avoids modifying the Deep Agent internals.
4. The rollback call should use the same MCP tool session that the stage node already has access to.

### Fix 2: GUI Reset Clears Orphaned Pipelines

1. In `mcp-server/src/utils/project-reset.ts`, in the `applyResetMutations()` function (around line 367):
   - After resetting the WP status, iterate over `wp.pipelines[]` and set `auto_cancelled = true` and `status = 'FAIL'` on any pipeline with `status === 'IN_PROGRESS'`.
   - Add a `completed_at` timestamp and a comment explaining the auto-cancellation: `"Auto-cancelled by project reset"`.
2. Update the `analyzeProjectForReset()` diagnosis to report orphaned pipelines as part of its output, so the GUI can show the user what will be cleaned up.

### Fix 3: Stale Checkpoint Detection

1. In `orchestrator/src/cli.py`, after generating the `thread_id` (around line 496):
   - For **new runs** (no `--resume`): Query the checkpoint DB for the new `thread_id`. If a checkpoint exists (UUID collision, near-impossible but defensive), log an error and generate a new UUID.
   - For **resumed runs** (`--resume`): Query the checkpoint DB for the thread's last state. If the graph state is terminal (i.e., `run_end` was reached, or `iteration` equals `max_iterations`), log a warning: `"Checkpoint is in terminal state — resume will not make progress. Start a fresh run instead."` and exit with a non-zero code.
2. The checkpoint query can use `AsyncSqliteSaver.aget(config)` or `aget_tuple(config)` to load the last checkpoint metadata.

### Fix 4: Harden Cross-WP Tool Guard

1. In `orchestrator/src/utils/tool_wrappers.py`, in the `restrict_to_wp()` function (around line 125):
   - Change the guard from "reject if wrong WP ID" to "inject correct WP ID if missing, reject if explicitly wrong":
     - If `work_package_id` is absent from the tool call args, inject the active `_wp_id`.
     - If `work_package_id` is present but differs from `_wp_id`, still reject (current behavior).
   - This auto-correction prevents the agent from accidentally targeting the wrong WP when it forgets to include the parameter.
2. In `orchestrator/src/nodes/__init__.py`, in the prompt-building functions for WP-scoped stages:
   - Add a stronger scope reminder at the end of the prompt: `"CRITICAL: Every MCP tool call MUST use work_package_id={wp_id}. Do NOT reference or operate on any other work package."`.

### Fix 5: Cancel Halted WPs Before Synthesis Routing

The core issue: `completeSynthesis` (§19.1) requires all WPs to be terminal (`DONE` or `CANCELLED`). The orchestrator's circuit breaker halts WPs that are still `IN_PROGRESS` in the ledger — so synthesis will always be rejected while halted WPs exist. Simply dispatching synthesis "without a WP ID" does not solve this.

Additionally, the orchestrator's per-WP circuit breaker (3 consecutive failures → halt) is a separate, stricter mechanism from the spec's per-pipeline-type circuit breaker (`MAX_REWORK_COUNT = 5`). This divergence is noted but not reconciled in this plan.

1. In `orchestrator/src/supervisor.py`, when all remaining actionable WPs are halted:
   - **Before routing to synthesis**, iterate over halted WPs and call `ledger_update_work_package_status` to transition each to `CANCELLED` with a reason like `"Cancelled: exceeded orchestrator failure threshold (3 consecutive failures)"`.
   - This makes the ledger state consistent with §19.1's precondition (`pending_work_packages == 0`).
2. After cancelling halted WPs, dispatch synthesis at project level (no WP scope) — synthesis operates at the project level per §19, not per-WP.
3. Log each cancellation as a `WARNING` event: `"Cancelling halted WP {wp_id} to allow synthesis to proceed."`
4. If the PM has already cancelled the WPs manually (e.g., via the GUI), the status update should be idempotent — `ledger_update_work_package_status` on an already-`CANCELLED` WP should be a no-op or handled gracefully.

## Dependencies

- **Prerequisite spec changes** must be completed before Fixes 1 and 5 to maintain spec-first development.
- Fix 1 depends on:
  - The spec update (§12.5 cancelPipeline, §21.67 orphaned pipeline recovery).
  - The `auto_cancelled` parameter addition to `ledger_cancel_pipeline`.
  - The MCP tool session being accessible in the stage node's error-handling path.
- Fix 2 is independent (MCP server only).
- Fix 3 is independent (orchestrator CLI only).
- Fix 4 is independent (orchestrator tool wrappers only).
- Fix 5 depends on the spec update (§16.3 automated circuit-breaker escalation note).
- Fixes 2, 3, and 4 can be implemented in parallel with each other and with the spec changes.
- Fixes 1 and 5 can be implemented in parallel with each other, after the spec changes.

## Required Components

### Workflow Specification (Markdown)
- `mcp-server/docs/agents/workflow-specification/operations.md` — Add §12.5 cancelPipeline (Prerequisite)
- `mcp-server/docs/agents/workflow-specification/edge-cases.md` — Add §21.67 agent-crash orphaned pipeline (Prerequisite)
- `mcp-server/docs/agents/workflow-specification/auxiliary-systems.md` — Add §16.3 note on automated circuit-breaker escalation (Prerequisite)

### MCP Server (TypeScript)
- `mcp-server/src/tools/pipeline.ts` — Add `auto_cancelled` parameter to `ledger_cancel_pipeline` (Fix 1)
- `mcp-server/src/utils/project-reset.ts` — Pipeline cleanup in reset (Fix 2)

### Orchestrator (Python)
- `orchestrator/src/nodes/__init__.py` — Stage node factory error handling (Fix 1)
- `orchestrator/src/cli.py` — Checkpoint state detection on startup (Fix 3)
- `orchestrator/src/utils/tool_wrappers.py` — Cross-WP guard hardening (Fix 4)
- `orchestrator/src/supervisor.py` — Cancel halted WPs + synthesis routing (Fix 5)

### Tests
- `mcp-server/tests/` — Unit tests for Fix 1 (`auto_cancelled` parameter) and Fix 2
- `orchestrator/tests/` — Unit tests for Fixes 1, 3, 4, 5

## Assumptions

- The MCP tool session (via `langchain-mcp-adapters`) remains usable in the stage node's error-handling path — i.e., the MCP server hasn't crashed even if the LLM call failed.
- `AsyncSqliteSaver` supports querying checkpoint state without invoking the full graph.
- The `restrict_to_wp` guard patching (`_orig_ainvoke_wp`) is robust enough to also inject missing `work_package_id` parameters.
- The existing `ledger_cancel_pipeline` MCP tool accepts the same `project_path` and `work_package_id` parameters that were used for `begin_work`.
- The `ledger_update_work_package_status` MCP tool can transition halted WPs to `CANCELLED` (Fix 5).

## Constraints

- Must not break existing `--resume` functionality for legitimate resume cases (non-terminal checkpoints).
- Pipeline rollback (Fix 1) must be idempotent — calling `ledger_cancel_pipeline` on an already-cancelled pipeline should be safe.
- GUI reset (Fix 2) must preserve completed (`PASS`/`FAIL`) pipelines — only `IN_PROGRESS` ones are auto-cancelled.
- Cross-platform: all fixes must work on Windows, macOS, and Linux per the workspace cross-platform policy.
- Workflow specification changes must be completed before the corresponding implementation changes (spec-first development per workspace rules).
- The `auto_cancelled` parameter for `ledger_cancel_pipeline` must default to `false` for backward compatibility.

## Out of Scope

- Fixing the LLM hallucination that causes agents to target the wrong WP (root cause of cross-WP contamination). Fix 4 is a mitigation, not a cure.
- Improving the Anthropic API 500 error resilience (transient — already handled by the retry circuit breaker).
- Redesigning the `begin_work`/`complete_pipeline` two-phase lifecycle to be atomic (would require significant MCP server changes).
- Adding a GUI indicator for orphaned pipelines (useful but out of scope).
- Rethinking the LangGraph checkpoint strategy (e.g., switching checkpoint backends or state serialization).
- Reconciling the orchestrator's per-WP circuit breaker (3 consecutive failures) with the spec's per-pipeline-type circuit breaker (`MAX_REWORK_COUNT = 5`). These are currently independent mechanisms with different granularity and thresholds.
- Formally defining a "project reset" operation in the workflow specification (currently GUI-only, outside the formal state machine).

## Acceptance Criteria

- A stage node that errors after calling `begin_work` automatically cancels the orphaned pipeline via `ledger_cancel_pipeline`.
- GUI project reset clears all `IN_PROGRESS` pipelines (sets `status: 'FAIL'`, `auto_cancelled: true`).
- Resuming a run with a terminal checkpoint prints a clear warning and exits non-zero.
- Tool calls from WP-scoped stages that omit `work_package_id` have it auto-injected.
- Tool calls explicitly targeting a different WP are still rejected.
- Halted WPs are transitioned to `CANCELLED` in the ledger before synthesis is routed.
- Synthesis is dispatched at project level (no WP scope), and `completeSynthesis` succeeds because all WPs are terminal.
- All existing tests pass.
- New unit tests cover each fix.

## Testing Strategy

| Fix | Test Approach |
|-----|---------------|
| **1 — Pipeline rollback** | Unit test: mock a stage that calls `begin_work` then throws. Verify `ledger_cancel_pipeline` is called with `auto_cancelled = true` in the error handler. MCP server unit test: verify `ledger_cancel_pipeline` sets `auto_cancelled` flag when parameter is provided. |
| **2 — GUI reset** | Unit test: create a WP with an `IN_PROGRESS` pipeline, call `applyResetMutations()`, verify the pipeline has `status: 'FAIL'` and `auto_cancelled: true`. |
| **3 — Stale checkpoint** | Unit test: seed a checkpoint DB with a terminal state, call CLI with `--resume`, verify it exits with a warning. |
| **4 — Cross-WP guard** | Unit test: call a tool without `work_package_id` via a wrapped tool, verify it's auto-injected. Call with a wrong WP ID, verify rejection. |
| **5 — Synthesis routing** | Unit test: set a WP as halted in supervisor state, verify WP is cancelled via `ledger_update_work_package_status` before synthesis dispatch. Verify synthesis is dispatched at project level (no WP scope). |

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Pipeline rollback fails** (MCP server unreachable in error path) | Wrap the rollback call in try/except; log a WARNING if rollback fails but don't mask the original error. The orphaned pipeline can still be cleaned up by GUI reset (Fix 2). |
| **Auto-injecting WP ID changes tool semantics** | Only inject when `work_package_id` is absent AND the tool's schema requires it. Tools that don't take `work_package_id` are unaffected. |
| **Checkpoint query API changes** | Pin LangGraph version; use the documented `aget_tuple` API. |
| **GUI reset auto-cancellation is too aggressive** | Only cancel `IN_PROGRESS` pipelines; `PASS`/`FAIL` pipelines are preserved. Add the auto-cancellation to the dry-run diagnosis output so users can preview it. |
| **Synthesis routing change causes WPs to never get synthesized** | Halted WPs are already failures — they need manual intervention or a re-run, not synthesis. By cancelling them explicitly, synthesis can still run for the WPs that succeeded. Log clearly when a halted WP is cancelled to unblock synthesis. |
| **Cancelling halted WPs is too aggressive** | The orchestrator's 3-failure threshold is already a quality signal. Cancelled WPs are clearly marked with the reason. Users can re-run those WPs in a subsequent orchestrator invocation. |
| **`auto_cancelled` backward compatibility** | The parameter defaults to `false`, so existing callers of `ledger_cancel_pipeline` are unaffected. Only the orchestrator's crash-recovery path passes `true`. |
