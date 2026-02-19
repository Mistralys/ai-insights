# Research Report

## Problem Statement

Review the handoff workflow logic in the Project Ledger MCP Server — the system that tracks project state and coordinates work between agents in a 7-stage pipeline (Planner → PM → Developer → QA → Reviewer → Documentation → Synthesis). Assess whether the flow is sound, identify logic gaps or fallacies, highlight what's missing, and recognize what's done well.

## Problem Decomposition

1. **State machine correctness** — Are WP status transitions and pipeline lifecycle rules internally consistent?
2. **Handoff logic accuracy** — Do `get_next_action` and `get_handoff_status` correctly route work across the 7 agents?
3. **Edge case resilience** — How does the system handle abandoned pipelines, rework loops, dependency chains, and partial completion?
4. **Enforcement scope** — What is enforced by the MCP server versus left to agent convention?
5. **Completeness** — Are there missing capabilities that the workflow needs but doesn't have?

## Context & Constraints

- The MCP server exposes 14 tools over STDIO, consumed by AI coding agents (Claude, etc.) in separate chat sessions
- Storage is flat JSON on disk (`.ledger/` directory), with atomic writes and file locking
- The server has been used in production for multiple projects and is considered stable
- The 7-agent workflow is documented in persona files; agents are invoked by pasting persona prompts into new chat sessions
- Agents are stateless across sessions; the ledger is the sole source of continuity

## Prior Art & Known Patterns

### Pattern 1: Linear Pipeline with Gate-Keeping

- **Description:** Each pipeline stage (implementation → QA → review → docs) must pass before the next begins. Only the Documentation agent can mark a WP as COMPLETE.
- **Where used:** This server's core workflow design
- **Strengths:** Clear separation of concerns; prevents premature completion; ensures full quality chain
- **Weaknesses:** Strictly sequential — no ability for later-stage agents to flag issues directly to earlier-stage agents through the server
- **Fit:** Well-suited. This is the right pattern for the problem.

### Pattern 2: Dual-File Sync with Atomic Writer

- **Description:** Root index (lightweight summaries) and WP detail files are always written together within a single lock
- **Where used:** `LedgerStore.updateWorkPackageWithSync()`
- **Strengths:** Eliminates the most dangerous class of bugs (desync between root index and WP files); guaranteed consistency
- **Weaknesses:** Performance cost of locking (negligible at current scale)
- **Fit:** Excellent — this is the server's strongest design decision.

### Pattern 3: Self-Healing Counters

- **Description:** `get_project_status` recomputes `total_work_packages` and `pending_work_packages` from the actual array on every call
- **Where used:** `project-lifecycle.ts`
- **Strengths:** Fault-tolerant; silently corrects drift without manual intervention
- **Weaknesses:** Minor — writes on every read if counters are wrong
- **Fit:** Good defensive design.

## What's Done Well

These are the strengths of the current system. They should be preserved.

| Area | Assessment |
|------|------------|
| **Atomic dual-file sync** | The `updateWorkPackageWithSync` pattern is the cornerstone of correctness. Every mutating operation uses it. Excellent. |
| **Zod validation on all I/O** | Every read validates against schemas, every write validates before writing. Prevents corruption from both bugs and manual editing. |
| **Status transition state machine** | Clear, well-documented transitions with explicit enforcement. The error messages include the valid transitions, which helps agents self-correct. |
| **COMPLETE gating by Documentation agent** | Enforcing that only the Documentation agent can mark WPs COMPLETE is a clever workflow invariant. It guarantees the full pipeline chain is respected. |
| **Acceptance criteria enforcement** | Cannot mark COMPLETE without all criteria met. Prevents premature closure. |
| **Dependency ordering on WP creation** | WPs with unmet dependencies start as BLOCKED automatically. No manual intervention needed. |
| **Revision tracking** | `COMPLETE → IN_PROGRESS` increments revision. Provides an audit trail for rework cycles. |
| **Help system** | `ledger_help` provides comprehensive tool reference, workflow order, and common mistake guidance. Well-designed for weaker models. |
| **BLOCKED detection nuance** | Handoff's BLOCKED check only fires when ALL WPs are blocked — avoids false alarms when some WPs can still be processed. |
| **Forgotten-COMPLETE failsafe** | `getDocumentationAction` detects WPs with all PASS pipelines but still IN_PROGRESS status. Excellent defensive measure. |
| **Error messages** | Detailed, actionable error messages that tell agents exactly what went wrong and what to do instead. |

## Issues Found

### Issue 1: FAIL Pipeline Detection Bug (Logic Error)

**Severity:** Medium
**Location:** `getDeveloperAction`, `getQaAction`, `getReviewerAction`, `getDocumentationAction` in `workflow.ts`

Each agent's `get_next_action` handler searches for FAIL pipelines to recommend rework:

```typescript
const failedImplPipeline = wpDetail.pipelines
    .filter((p) => p.type === 'implementation')
    .reverse()
    .find((p) => p.status === 'FAIL');
```

This finds **any** FAIL pipeline of the given type — including historical ones. If a WP has pipelines `[impl:FAIL, impl:PASS]` (i.e., it was reworked and now passes), the code still finds the old FAIL and recommends REWORK, even though the WP has been successfully reworked.

**Root cause:** `.filter().reverse().find(status === 'FAIL')` keeps searching backwards past a more recent PASS.

**Fix:** Check only the most recent pipeline of each type:

```typescript
const latestImplPipeline = wpDetail.pipelines
    .filter((p) => p.type === 'implementation')
    .at(-1); // most recent
if (latestImplPipeline?.status === 'FAIL') { /* recommend rework */ }
```

This bug exists in all four agent action handlers.

---

### Issue 2: No Automatic Unblocking of Dependent WPs

**Severity:** Medium
**Location:** `updateWorkPackageStatus` in `work-package.ts`

When WP-001 is marked COMPLETE and WP-002 depends on WP-001 (status: BLOCKED), WP-002's status is **never automatically updated** to READY. The dependency check happens:

- At creation time (to set initial status)
- At claim time (to prevent claiming blocked WPs)

But there is no propagation step that transitions downstream WPs from BLOCKED → READY when their dependencies are satisfied.

**Impact:** After completing a WP, the PM or another agent must manually call `ledger_update_work_package_status` to unblock dependent WPs. If no one does this, the `get_next_action` for Developer correctly avoids recommending dependency-blocked WPs (via `hasDependencyBlocked()`), but the BLOCKED status in the ledger is misleading — it stays BLOCKED even though the dependency is satisfied.

**Fix:** Add a propagation step in `updateWorkPackageStatus` when transitioning to COMPLETE: scan all WPs that depend on the completed WP, and if all their dependencies are now COMPLETE, transition them from BLOCKED → READY.

---

### Issue 3: No Recovery for Abandoned IN_PROGRESS Pipelines

**Severity:** Low-Medium
**Location:** `get_next_action` handlers, `get_handoff_status` handlers

If an agent starts a pipeline (`ledger_start_pipeline`) but never completes it (session crash, user abandons chat), the pipeline stays IN_PROGRESS forever. The workflow logic doesn't detect or handle this:

- `get_next_action` for the relevant agent will see the existing pipeline and won't recommend starting a new one (duplicate prevention)
- `get_next_action` won't recommend rework (it only looks for FAIL)
- The WP effectively becomes stuck

**Impact:** The WP is silently stuck until a user manually investigates.

**Potential fixes:**
1. Add a "stale pipeline" detector in `get_next_action` — if a pipeline has been IN_PROGRESS for longer than a configurable duration, recommend completing or restarting it
2. Add a tool to cancel/abort an IN_PROGRESS pipeline
3. At minimum, `get_next_action` should report when it detects an orphaned IN_PROGRESS pipeline so the agent can take action

---

### Issue 4: Project-Level Status Never Reaches COMPLETE

**Severity:** Low
**Location:** Root index `status` field, Synthesis agent workflow

The project root index has a `status` field (`READY`, `IN_PROGRESS`, `COMPLETE`, `BLOCKED`), but:

- `READY → IN_PROGRESS` happens automatically when the first WP is created
- No tool or workflow step ever sets the project status to `COMPLETE`
- The Synthesis agent's handoff in `getHandoffStatus` returns `status: 'COMPLETE'` as a response, but doesn't actually update the root index

**Impact:** The project ledger never reflects that the project is finished. All completed projects show `status: 'IN_PROGRESS'` forever.

**Fix:** Either:
1. Add logic to automatically set project status to COMPLETE when all WPs are COMPLETE and Synthesis is done
2. Give the Synthesis agent a tool to finalize the project
3. Add a check in `get_project_status` that auto-heals the project status (similar to counter self-healing)

---

### Issue 5: `assigned_to` Not Updated During Pipeline Handoffs

**Severity:** Low
**Location:** `start_pipeline` in `pipeline.ts`, `claim_work_package` in `work-package.ts`

When a QA agent starts a QA pipeline on a WP, the WP's `assigned_to` field (and the root index summary's `assigned_to`) still shows the Developer who originally claimed it. Only `claim_work_package` updates `assigned_to`.

**Impact:** The root index summary doesn't reflect who is currently working on a WP. If a PM calls `list_work_packages` filtered by `assigned_to`, they get stale information.

**Design question:** Is `assigned_to` meant to track "who owns this WP" (the claimer) or "who is currently working on it" (the latest pipeline agent)? The current behavior tracks ownership, but the name suggests active assignment.

**Options:**
1. Keep current behavior but rename field to `owned_by` for clarity
2. Update `assigned_to` when starting a pipeline (more useful for visibility)
3. Add a separate `current_agent` field

---

### Issue 6: Pipeline READY Status Is Dead Code

**Severity:** Informational
**Location:** `PipelineStatus` enum in `enums.ts`

The `PipelineStatus` enum includes `READY`, but pipelines are always created with `IN_PROGRESS` status in `start_pipeline`. The READY status for pipelines is never used anywhere in the codebase.

**Impact:** No functional issue, but it's confusing — it suggests a two-step pipeline lifecycle (READY → IN_PROGRESS → PASS/FAIL) that doesn't exist.

**Fix:** Either remove `READY` from `PipelineStatus`, or document why it's reserved for future use.

---

### Issue 7: Documentation Handoff Doesn't Distinguish Dependency Blocks

**Severity:** Low
**Location:** `getDocumentationHandoff` in `workflow.ts`

When all reviewed WPs have docs, `getDocumentationHandoff` checks for `wpsNotYetReviewed` and returns `READY_FOR_DEVELOPER` if any exist. But unlike the QA and Reviewer handoff functions, it **doesn't check `isBlockedByDependencies`** to distinguish between:

- WPs blocked by dependencies (can proceed to Synthesis for current batch)
- WPs genuinely waiting for earlier stages (need Developer work)

**Impact:** If some WPs are blocked by dependencies, the Documentation handoff incorrectly sends work back to Developer instead of proceeding to Synthesis for the completed batch.

**Fix:** Apply the same `isBlockedByDependencies` check used in `getQaHandoff` and `getReviewerHandoff`.

---

### Issue 8: No Pipeline Ordering Enforcement

**Severity:** Low (by design, but worth noting)
**Location:** `start_pipeline` in `pipeline.ts`

The MCP server does not enforce that pipelines follow the expected order (implementation → QA → review → docs). Any agent can start any pipeline type at any time, as long as the WP is IN_PROGRESS.

**Impact:** The pipeline ordering is enforced entirely by convention (persona prompts and handoff logic). A misconfigured or confused agent could start a `code-review` pipeline before QA runs, and the server would accept it.

**Assessment:** This is a deliberate tradeoff — flexibility over strictness. The `get_next_action` and `get_handoff_status` tools guide agents to the right sequence, and enforcing order in the tool itself might create problems for edge cases (e.g., skipping QA for trivial changes). **No change recommended**, but document this as an intentional design choice.

---

### Issue 9: WP ID Generation Assumes Sequential Array

**Severity:** Informational (no current risk)
**Location:** `createWorkPackage` in `work-package.ts`

```typescript
const nextWpNumber = rootIndex.work_packages.length + 1;
```

WP IDs are generated from the array length. If WP deletion is ever supported, this would generate duplicate IDs (e.g., after deleting WP-002, the next WP would also be WP-002).

**Current risk:** None — WPs are never deleted.

**Forward-looking fix:** Use `Math.max(...existing WP numbers) + 1` instead of `array.length + 1`.

## Missing Capabilities

### Missing 1: Rework Cycle Tracking

When a WP goes through FAIL → rework → PASS cycles, the rework history is captured implicitly via multiple pipeline entries. But there's no summary field that says "this WP required N rework cycles" or "total time in rework." This information could be valuable for the Synthesis report and for identifying process bottlenecks.

### Missing 2: Partial Progress Within a Pipeline

A pipeline is either IN_PROGRESS or PASS/FAIL. There's no way for an agent to record partial progress (e.g., "3 of 5 acceptance criteria verified"). If a session ends mid-pipeline, all progress context is lost. The `summary` field is only set at completion.

**Potential improvement:** Allow updating the `summary` field on an IN_PROGRESS pipeline as a progress log.

### Missing 3: Inter-Agent Communication Channel

When QA finds an issue, it can only record it in the pipeline comments. There's no mechanism to alert the Developer agent about what specifically needs to be reworked. The Developer has to read the QA pipeline entry to understand what went wrong. This works, but a dedicated "rework instructions" or "handoff notes" field could streamline the flow.

### Missing 4: Batch Handoff for Multiple WPs

The `get_next_action` tool returns a single WP recommendation. For projects with many independent WPs, a batch mode that returns multiple actionable WPs could reduce tool-call overhead.

## Comparative Evaluation

| Criterion | Current State | After Recommended Fixes |
|-----------|--------------|------------------------|
| **Correctness** | FAIL pipeline detection bug causes incorrect rework recommendations | All handoff decisions based on most-recent pipeline state |
| **Resilience** | Abandoned pipelines cause silent stalls; blocked WPs stay blocked | Stale pipeline detection; automatic dependency propagation |
| **Completeness** | Project never reaches COMPLETE status | Full lifecycle from READY to COMPLETE |
| **Visibility** | `assigned_to` stale during pipeline handoffs | Current agent always visible |
| **Consistency** | Documentation handoff missing dependency check | All handoff functions use same logic pattern |

## Recommendation

The system is well-architected. The atomic dual-file sync, Zod validation, and status transition enforcement are the strongest aspects and should not be touched. The issues found are refinements, not architectural problems.

**Priority order for fixes:**

1. **Fix the FAIL pipeline detection bug** (Issue 1) — This is a correctness issue that will produce wrong recommendations in rework scenarios. Small code change, high impact.
2. **Add automatic dependency unblocking** (Issue 2) — Without this, dependent WPs silently stay BLOCKED after their dependencies complete. Medium code change, high practical impact.
3. **Fix Documentation handoff dependency check** (Issue 7) — Copy the pattern from QA/Reviewer handoffs. Small change, eliminates inconsistency.
4. **Add stale pipeline detection** (Issue 3) — At minimum, report orphaned IN_PROGRESS pipelines in `get_next_action`. Medium effort.
5. **Add project-level COMPLETE** (Issue 4) — Small addition that closes the lifecycle loop.
6. **Address `assigned_to` semantics** (Issue 5) — Decide on the intended semantic and document or fix accordingly.
7. **Clean up dead `READY` pipeline status** (Issue 6) — Trivial cleanup.

### Proof-of-Concept Outline

For the top-priority fix (Issue 1 — FAIL pipeline detection):

1. In each agent action handler (`getDeveloperAction`, `getQaAction`, `getReviewerAction`, `getDocumentationAction`), replace the FAIL pipeline search:
   ```typescript
   // Before (buggy)
   const failedPipeline = wpDetail.pipelines
       .filter((p) => p.type === 'implementation')
       .reverse()
       .find((p) => p.status === 'FAIL');

   // After (correct)
   const implPipelines = wpDetail.pipelines.filter((p) => p.type === 'implementation');
   const latestImplPipeline = implPipelines.at(-1);
   const isLatestFailed = latestImplPipeline?.status === 'FAIL';
   ```
2. Update existing unit tests in `workflow-handoff.test.ts` to cover the [FAIL, PASS] scenario
3. Run `npm test` to verify no regressions

For Issue 2 (automatic unblocking):

1. In `updateWorkPackageStatus`, after setting a WP to COMPLETE, scan all WPs for dependencies on the completed WP
2. For each dependent WP with status BLOCKED, check if ALL dependencies are now COMPLETE
3. If yes, transition to READY and update the root index summary
4. All of this happens within the existing lock in `updateWorkPackageWithSync`

## Open Questions

- **Should pipeline ordering ever be enforced?** Currently any agent can start any pipeline type. Is this flexibility valued, or has it ever caused problems in practice?
- **Is WP deletion a future requirement?** If so, the WP ID generation should be hardened now.
- **Should `assigned_to` track ownership or current activity?** The answer affects whether the field should be updated during pipeline operations.
- **Is there a need for cross-project queries?** The current design is strictly per-project. If agents need to reference patterns or lessons from past projects, a cross-project index might be valuable.

## References

- Source: `mcp-server/src/tools/workflow.ts` — Core handoff and next-action logic (1486 lines)
- Source: `mcp-server/src/tools/pipeline.ts` — Pipeline start/complete tools
- Source: `mcp-server/src/tools/work-package.ts` — WP CRUD and status management
- Source: `mcp-server/src/tools/project-lifecycle.ts` — Project init and status
- Source: `mcp-server/src/schema/validators.ts` — Status transition and completion validators
- Source: `mcp-server/src/storage/ledger-store.ts` — Dual-file sync storage abstraction
- Source: `mcp-server/docs/agents/project-manifest/constraints.md` — Business rules
- Source: `mcp-server/docs/agents/project-manifest/data-flows.md` — Data flow documentation
- Source: `mcp-server/tests/tools/workflow-handoff.test.ts` — Handoff unit tests
- Source: `mcp-server/tests/integration/full-workflow.test.ts` — End-to-end workflow tests
- Source: `personas/ledger/README.md` — Workflow documentation and agent descriptions
