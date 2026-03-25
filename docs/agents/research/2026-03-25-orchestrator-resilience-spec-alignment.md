# Research Report

## Problem Statement

The [orchestrator resilience fixes plan](../plans/2026-03-25-orchestrator-resilience-fixes/plan.md) proposes five fixes for systemic reliability issues observed during the `2026-03-25-persona-build-core-library` orchestrator run. The question is: which of these issues represent **gaps in the workflow specification** that need to be addressed there first, versus **implementation-level bugs** where the orchestrator/MCP server code has diverged from what the specification already prescribes?

## Problem Decomposition

1. **Fix 1 (Orphaned Pipeline Rollback):** Is the spec silent on what should happen when an agent crashes between `begin_work` and `complete_pipeline`?
2. **Fix 2 (GUI Reset Clears Orphaned Pipelines):** Does the spec define project reset behavior, or is the GUI reset an implementation-only concern?
3. **Fix 3 (Stale Checkpoint Detection):** Is checkpoint management within the spec's scope at all?
4. **Fix 4 (Cross-WP Tool Guard Hardening):** Does the spec address cross-WP contamination or tool-call scoping?
5. **Fix 5 (Synthesis Routing for Halted WPs):** Does the spec define how synthesis interacts with circuit-broken WPs?

## Context & Constraints

- The [Workflow Specification v2.4.1](../../mcp-server/docs/agents/workflow-specification/README.md) is the authoritative reference for all workflow behavior.
- The specification is **language-agnostic** — it defines state machines, guards, and invariants that apply to any implementation (MCP server TypeScript, orchestrator Python).
- The orchestrator is one implementation consumer of the spec; the MCP server is the canonical implementation.
- Per workspace rules: if code contradicts the spec, the **code is likely wrong**.

## Analysis

### Fix 1: Orphaned Pipeline Rollback — SPEC GAP + IMPLEMENTATION GAP

**What the spec says:**
- §7.2 defines `IN_PROGRESS` as the only non-terminal pipeline status; `PASS` and `FAIL` are terminal.
- §11.1 (`startPipeline`) has a "duplicate IN_PROGRESS" guard that rejects a new pipeline of the same type if one is already `IN_PROGRESS`.
- §21.14b explicitly covers pipeline cancellation when a WP transitions to `BLOCKED` or `CANCELLED` — setting orphaned `IN_PROGRESS` pipelines to `FAIL` with `auto_cancelled = true`.
- §21.27 defines `auto_cancelled` semantics extensively.
- §21.19 mentions stale pipeline detection (24-hour threshold) and the PM's `RESUME_OR_CANCEL` action.
- §20.4 discusses crash recovery for the lock gap scenario.

**What the spec does NOT say:**
- The spec does not address **agent-level crash recovery** — i.e., what happens when a stage agent (e.g., the orchestrator's Deep Agent wrapper) crashes or errors between calling `ledger_begin_work` (which calls `startPipeline` internally) and calling `ledger_complete_pipeline`. In this case:
  - The WP remains `IN_PROGRESS`.
  - The pipeline remains `IN_PROGRESS`.
  - No WP status transition occurs (so §21.14b auto-cancellation does not fire).
  - The only recovery path in the spec is the **24-hour stale pipeline detection** (§21.19), which is far too slow for automated orchestration.
- The spec's `RESUME_OR_CANCEL` recommendation (§14.x, priority 2) is reactive and slow — it relies on the PM polling `getNextAction`.

**Verdict:** This is primarily a **specification gap**. The spec defines what happens when WP *status* transitions cause orphaned pipelines (§21.14b), but is silent on agent-crash-orphaned pipelines at the *orchestrator* level. The spec should either:
  - (a) Define an explicit `cancelPipeline` operation (note: the MCP server already implements `ledger_cancel_pipeline` — see api-surface.md — but the **spec** does not document this operation), or
  - (b) Specify that orchestrator implementations MUST roll back orphaned pipelines when a stage invocation fails, referencing the existing pipeline cancellation semantics.

**Implementation note:** The `ledger_cancel_pipeline` MCP tool already exists in implementation but is **not documented in the workflow specification**. It sets `status = 'FAIL'` and `summary = ['Cancelled: {reason}']` but does **not** set `auto_cancelled = true`. The plan's Fix 1 should use this existing tool. However, the absence of `auto_cancelled = true` means that a pipeline cancelled via this tool would be treated as a quality FAIL (counting toward rework budget per §11.2), which is incorrect for a crash-recovery cancellation. The spec should address this.

### Fix 2: GUI Reset Clears Orphaned Pipelines — IMPLEMENTATION GAP (not spec-scoped)

**What the spec says:**
- The workflow specification does not define a "project reset" operation. There is no §-section for it. Project reset is a **GUI-only** operational tool outside the formal state machine.
- The spec defines all the building blocks: `updateWorkPackageStatus` (§10b.1), pipeline auto-cancellation on `IN_PROGRESS → BLOCKED` (§21.14b), and self-healing (§17).

**What the implementation does:**
- `applyProjectReset` in `project-reset.ts` resets WP status but does not touch `wp.pipelines[]`. Orphaned `IN_PROGRESS` pipelines survive the reset.

**Verdict:** This is purely an **implementation gap** in the GUI reset utility. The spec does not need to change — the reset tool is an operational convenience that should compose existing spec-defined operations correctly. The fix is straightforward: the reset function should cancel `IN_PROGRESS` pipelines on reset WPs, consistent with §21.14b semantics (set `status = 'FAIL'`, `auto_cancelled = true`, add `completed_at` and summary).

### Fix 3: Stale Checkpoint Detection — OUTSIDE SPEC SCOPE (orchestrator-only)

**What the spec says:** Nothing. LangGraph checkpointing is an orchestrator implementation detail. The spec defines workflow state machines, not orchestrator infrastructure.

**What the spec DOES cover adjacently:**
- §19.2 (Synthesis idempotency) discusses crash recovery for the Synthesis agent — but in terms of the binary `synthesis_generated` flag, not orchestrator checkpoints.
- §17 (Self-Healing) repairs project-level status drift — but again, this is ledger state, not orchestrator state.

**Verdict:** This is **entirely outside the spec's scope**. Checkpoint management is an orchestrator infrastructure concern. The fix belongs purely in `orchestrator/src/cli.py` and does not require any specification change. This is correct — the spec is language-agnostic and should not address LangGraph-specific concepts.

### Fix 4: Cross-WP Tool Guard Hardening — OUTSIDE SPEC SCOPE (orchestrator-only)

**What the spec says:**
- §20 (Concurrency Model) defines file locking and atomic writes — but focuses on concurrent access to the same ledger, not on preventing an agent from calling tools for the wrong WP.
- §11.1 (`startPipeline`) validates `agentRole` but not `work_package_id` correctness relative to what the agent "should" be working on.
- The spec delegates WP-scoping to the orchestrator/caller — it trusts that the agent passes the correct `work_package_id`.

**What the orchestrator does:**
- `restrict_to_wp()` in `tool_wrappers.py` wraps each tool to reject calls with a mismatched `work_package_id`, but does not inject missing IDs.

**Verdict:** This is **entirely outside the spec's scope**. The MCP server tools accept a `work_package_id` parameter and operate on whatever WP is specified — they have no concept of a "current session WP." Cross-WP contamination prevention is an orchestrator-specific concern (guarding against LLM hallucination). The fix belongs purely in the orchestrator's tool wrapper layer.

### Fix 5: Synthesis Routing for Halted WPs — SPEC GAP (partial)

**What the spec says:**
- §19.1 (`completeSynthesis`) requires all WPs to be terminal. There is no concept of a "halted" WP in the spec — the circuit breaker (§16.3) blocks `startPipeline` from accepting new pipeline starts for that type, but does not change WP status.
- The circuit breaker is per-pipeline-type (§16.3), not per-WP. A WP with `rework_counts.implementation = 5` still has status `IN_PROGRESS`; it's just that no new `implementation` pipeline can start.
- §14.1.2 priority 2 (`REVIEW_REWORK_LIMIT`) surfaces circuit-broken WPs to the PM for manual intervention (cancel or restructure).
- The Synthesis handoff function (§13.1) returns `READY_FOR_SYNTHESIS` only when `pending == 0 AND total > 0` — i.e., all WPs are terminal. A circuit-broken WP that is still `IN_PROGRESS` blocks this condition.

**What the orchestrator does:**
- The supervisor has its own separate circuit breaker: 3 consecutive failures on a WP → `halted_repeated_failure`. This is distinct from the spec's per-pipeline-type `MAX_REWORK_COUNT` (default 5). This is orchestrator-specific logic not in the spec.
- When all remaining actionable WPs are halted, the supervisor falls through to synthesis routing — even though the WPs are not terminal in the ledger.

**The real issue:** The orchestrator's circuit breaker ("3 consecutive failures → halt") is a separate concept from the spec's circuit breaker ("per-pipeline rework count reaches MAX_REWORK_COUNT"). The orchestrator halts WPs that are still `IN_PROGRESS` in the ledger, then routes to synthesis — but `completeSynthesis` (§19.1) will **reject** the call because `pending_work_packages > 0`. This means Fix 5 is addressing a routing decision that can never succeed anyway, unless the orchestrator also cancels the halted WPs first.

**Verdict:** This is a **partial spec gap + orchestrator design issue:**
- **Spec gap:** The spec does not address what should happen when a WP's pipeline is circuit-broken and the PM does not intervene. In automated orchestration without a human PM, the PM's `REVIEW_REWORK_LIMIT` action action has no handler. The spec should acknowledge that automated pipelines may need a mechanism to transition circuit-broken WPs to `CANCELLED` (or `BLOCKED` with a `technical` blocker) to allow the project to proceed to synthesis.
- **Orchestrator design issue:** The supervisor dispatching synthesis with a specific `wp_id` of a halted WP is an orchestrator-level routing bug. The synthesis agent operates at project level (§19), not WP level — passing a WP scope to synthesis is an orchestrator implementation choice that the spec does not prescribe.

## Comparative Evaluation

| Fix | Spec Gap? | Implementation Gap? | Orchestrator-Only? | Spec Change Needed? |
|-----|-----------|--------------------|--------------------|---------------------|
| **1 — Orphaned Pipeline Rollback** | Yes | Yes (tool exists but not spec'd) | No | Yes — add pipeline cancellation operation to spec; address `auto_cancelled` semantics for crash-recovery cancellation |
| **2 — GUI Reset Pipelines** | No | Yes | No (MCP server) | No — reset is outside spec scope |
| **3 — Stale Checkpoint** | No | Yes | Yes | No |
| **4 — Cross-WP Guard** | No | Yes | Yes | No |
| **5 — Synthesis Routing** | Partial | Yes | Partially | Yes — address automated circuit-breaker-to-terminal escalation |

## Recommendation

### 1. Specification Changes Required (Fix 1 + Fix 5)

**Fix 1 — Add §12.5 "Pipeline Cancellation" to the spec:**
- Document the `cancelPipeline` operation formally (it already exists in implementation as `ledger_cancel_pipeline`).
- Define it as: finds the most recent `IN_PROGRESS` pipeline of the given type, sets `status = 'FAIL'`, `completed_at = now()`, `summary = ['Cancelled: {reason}']`.
- **Critical addition:** Specify that crash-recovery cancellations SHOULD set `auto_cancelled = true` so they do not consume rework budget (consistent with §21.27 semantics for pipeline closures caused by external interruptions, not quality failures). The current implementation does NOT set `auto_cancelled`— this is a gap.
- Add a §21 edge case (e.g., §21.67) documenting the agent-crash orphaned pipeline scenario and prescribed recovery.

**Fix 5 — Add orchestrator guidance for circuit-broken WP terminal escalation:**
- Add a note in §16.3 or §21.53 that automated orchestrators without an interactive PM SHOULD transition circuit-broken WPs to `CANCELLED` (or `BLOCKED` with a `technical` blocker) when no PM intervention is available, to allow the project to reach synthesis.
- This is a SHOULD recommendation, not a state-machine change — the PM (or orchestrator acting as PM) already has authority to cancel WPs.

### 2. Pure Implementation Fixes (Fix 2, Fix 3, Fix 4)

These require no spec changes. Implement as described in the plan:

- **Fix 2:** Extend `applyProjectReset()` to cancel `IN_PROGRESS` pipelines with `auto_cancelled = true`.
- **Fix 3:** Add checkpoint state validation to `orchestrator/src/cli.py`.
- **Fix 4:** Add WP ID auto-injection to `restrict_to_wp()`.

### 3. Plan Corrections

The plan contains two factual inaccuracies that should be corrected before implementation:

1. **Plan states** "There is no `CANCELLED` value" for `PipelineStatus` — **correct**, but the plan also implies `ledger_cancel_pipeline` does not exist. The tool **does** exist (`mcp-server/src/tools/pipeline.ts`, registered as `ledger_cancel_pipeline`) — it sets `status = 'FAIL'` and `summary = ['Cancelled: {reason}']`. Fix 1 can use this existing tool rather than implementing a new one.

2. **Plan's Fix 5** proposes dispatching synthesis "without a WP ID" for halted WPs. But the real issue is that synthesis cannot complete while `IN_PROGRESS` WPs exist (§19.1 guard). The fix should first transition halted WPs to a terminal status, then route to synthesis — not just change the synthesis dispatch scope.

### Proof-of-Concept Outline

1. Draft spec additions for §12.5 (cancelPipeline) and §21.67 (agent-crash orphaned pipeline recovery).
2. Update `ledger_cancel_pipeline` implementation to accept an optional `auto_cancelled` parameter (defaulting to `false` for backward compatibility).
3. Add spec note in §16.3/§21.53 for automated circuit-breaker escalation.
4. Implement Fixes 2–4 as described in the plan (no spec changes needed).
5. Revise Fix 5 to cancel halted WPs before routing to synthesis.

## Open Questions

- **Should `ledger_cancel_pipeline` set `auto_cancelled = true` by default?** The current implementation does not set it at all. For crash-recovery use cases (Fix 1), it should. For manual PM cancellation, the semantics are less clear — the PM may be cancelling a pipeline as a quality judgment, which should count toward rework. A parameter-driven approach (caller specifies `auto_cancelled`) is probably cleanest.
- **Should the orchestrator's per-WP circuit breaker (3 consecutive failures) be reconciled with the spec's per-pipeline-type circuit breaker (`MAX_REWORK_COUNT = 5`)?** These are currently independent mechanisms with different semantics. The spec's circuit breaker is finer-grained (per pipeline type) and more generous (5 attempts). The orchestrator's is coarser (per WP) and stricter (3 attempts). The plan does not address this divergence.
- **Should the spec formally define a "project reset" operation?** Currently the GUI reset composes ad-hoc mutations outside the formal state machine. Formalizing it would ensure all implementations reset consistently, but it adds complexity to a spec that is already 21+ edge cases deep.

## References

- [Workflow Specification v2.4.1](../../mcp-server/docs/agents/workflow-specification/README.md)
- [Operations — §11 startPipeline, §12 completePipeline](../../mcp-server/docs/agents/workflow-specification/operations.md)
- [Auxiliary Systems — §17 Self-Healing, §18 Auto-Handoff, §19 Synthesis](../../mcp-server/docs/agents/workflow-specification/auxiliary-systems.md)
- [Edge Cases — §21.14b, §21.27, §21.53](../../mcp-server/docs/agents/workflow-specification/edge-cases.md)
- [MCP Server API Surface — ledger_cancel_pipeline](../../mcp-server/docs/agents/project-manifest/api-surface.md)
- [Orchestrator resilience fixes plan](../plans/2026-03-25-orchestrator-resilience-fixes/plan.md)
