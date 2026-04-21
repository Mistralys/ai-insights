# Project Synthesis Report
**Plan:** `2026-04-21-pm-pipeline-routing`
**Date:** 2026-04-21
**Status:** ✅ COMPLETE

---

## Executive Summary

This session closed a critical auto-handoff gap in the Project Manager agent. Previously, when all work packages were `IN_PROGRESS` and a pipeline stage completed (e.g., implementation PASS), the PM's handoff and recommendation engine would return `WAIT` — stalling orchestration because no dispatch signal was emitted for the next pipeline agent (e.g., QA). The root cause was that the PM was the **only** agent whose routing logic operated exclusively at the WP-level (READY/BLOCKED/COMPLETE/IN_PROGRESS), blind to intra-WP pipeline state.

The fix inserts a new **Step 2b** routing block into both core PM dispatch mechanisms — `getProjectManagerHandoff()` and `getProjectManagerAction()` — that scans IN_PROGRESS WPs for pending pipeline stages and routes to the owning agent. A complementary documentation pass updated the workflow specification (v2.4.2 → v2.4.3), project manifest, and CTX context files to keep the full corpus in sync.

**Four work packages were delivered across a single session.** All pipelines passed. Zero regressions.

---

## Work Packages Delivered

| WP | Scope | Stages | Result |
|----|-------|--------|--------|
| WP-001 | Workflow Specification update (handoff.md, recommendations.md, edge-cases.md, README.md v2.4.3) | documentation | ✅ PASS |
| WP-002 | PM recommendation engine — `getProjectManagerAction()` ROUTE_PIPELINE_AGENT (Priority 3d) | impl → qa → code-review → documentation | ✅ PASS |
| WP-003 | PM handoff function — `getProjectManagerHandoff()` Step 2b routing loop | impl → qa → code-review → documentation | ✅ PASS |
| WP-004 | Project manifest documentation — api-surface.md, data-flows.md, constraints.md (Constraint 22b) | documentation | ✅ PASS |

---

## Metrics

| Metric | Value |
|--------|-------|
| Total test suite (post-change) | **1,863 tests** |
| Tests passed | **1,863** |
| Tests failed | **0** |
| New test cases added | **15** (11 for WP-003 handoff, 4 for WP-002 recommendation engine) |
| TypeScript compilation | ✅ Clean (`--noEmit`) |
| Files modified (source) | 4 |
| Files modified (docs/spec) | 7 |
| Files regenerated (CTX) | 31+ context documents |
| Workflow spec version | 2.4.2 → **2.4.3** |
| Rework cycles | 0 |

---

## What Was Built

### Core Logic: Two Routing Loops (WP-002, WP-003)

**`workflow-handoff.ts` — `getProjectManagerHandoff()` Step 2b**

A new routing loop inserted between step 2 (READY WPs) and step 3 (all terminal) scans each non-terminal, non-dependency-blocked IN_PROGRESS WP's `active_pipeline_stages` in canonical order. For the first stage that is not yet PASS, it applies four guards:
1. **FAIL guard** — skip WP (downstream agent's own FAIL routing handles it)
2. **Current-stage IN_PROGRESS guard** — skip WP (stage already being worked on)
3. **Upstream IN_PROGRESS guard** — skip WP (premature routing prevention)
4. **Dependency-blocked exclusion** — already filtered at the WP level

If all guards pass, the PM routes to `PIPELINE_AGENT_MAP[stage]`.

**`workflow-next-action.ts` — `getProjectManagerAction()` Priority 3d: ROUTE_PIPELINE_AGENT**

An identical logic block was inserted as Priority 3d in the PM recommendation engine — after `REPAIR_ORPHAN_BLOCKED` (3c) and before the `Final Fallback: WAIT`. Both functions now emit routing signals under the same guard conditions, ensuring consistent behavior regardless of which dispatch path the orchestrator uses.

**Zero-pipeline (freshly-claimed WP) coverage**

Both loops correctly handle WPs that were claimed but have not yet started any pipelines. When no pipelines exist, the first active stage has no PASS, FAIL, or IN_PROGRESS — so the algorithm falls through to route to `PIPELINE_AGENT_MAP[firstActiveStage(wp)]`. This bootstraps the WP without requiring a separate recovery path.

### Specification: v2.4.3 (WP-001)

Four workflow specification documents were updated prior to implementation:
- **handoff.md §13.1** — Step 2b pseudocode + two design notes (PM blindness explanation, freshly-claimed WP coverage)
- **recommendations.md §14.1.2** — Priority 3d ROUTE_PIPELINE_AGENT entry with full pseudocode
- **edge-cases.md §21.70** — New edge case covering both routing scenarios and all four guards
- **README.md** — Version bump to 2.4.3 with detailed changelog entry

### Project Manifest & Context (WP-003 docs, WP-004)

- **api-surface.md** — `getProjectManagerAction()` entry updated with P3d ROUTE_PIPELINE_AGENT; `getProjectManagerHandoff()` JSDoc updated to document step 2b; stale §5.5 cross-reference corrected to §13.1
- **data-flows.md** — Flow 7 PM algorithm updated from "5-priority" to "6-priority"; P3d inserted; ROUTE_PIPELINE_AGENT added to action type union with `next_agent` and `pipeline_type` field notes
- **constraints.md** — New Constraint 22b "PM Handoff Detects Pending Pipeline Stages on IN_PROGRESS WPs" documenting the step 2b invariant, all four guards, two coverage scenarios, rationale, and implementation cross-references
- **CTX files** — 31+ context documents regenerated via `ctx generate`

### Fix-Forward Items Applied by Reviewer (non-behavioral)

- **workflow-next-action.ts line 506** — `"Priority 4 / Fallback: WAIT"` renamed to `"Final Fallback: WAIT"` (the label became misleading after inserting sub-priorities 3, 3b, 3c, 3d)
- **workflow-handoff.test.ts test 2b.9** — Title corrected from "upstream IN_PROGRESS guard" to "current-stage IN_PROGRESS guard" (the test exercises the current-stage guard, not the upstream one)
- **workflow-handoff.ts JSDoc** — `getProjectManagerHandoff()` function comment updated to document step 2b in the priority-ordered algorithm

---

## Strategic Recommendations (Gold Nuggets)

### 1. Extract `latestNonCancelledPipeline()` Helper — Medium-Term Refactor

The pattern `wp.pipelines.filter(p => p.type === stage && !p.auto_cancelled).at(-1)` now appears in **four** locations:
- `workflow-handoff.ts` step 2b (twice — current stage and upstream stage)
- `workflow-next-action.ts` ROUTE_PIPELINE_AGENT block (twice)
- `workflow-next-action.ts` REVIEW_ABANDONED block

A shared private helper (e.g., `latestNonCancelledPipeline(pipelines: Pipeline[], type: string)`) analogous to the existing `isMostRecentPipelineFail` should be promoted to `workflow-helpers.ts`. This is a clean, bounded refactor with zero behavioral risk. Recommended for the next maintenance WP.

### 2. The Upstream IN_PROGRESS Guard is Logically Unreachable (By Design)

Both QA and the Reviewer independently confirmed that the upstream IN_PROGRESS guard (step 2b, lines 397–402 in `workflow-handoff.ts`; lines 484–488 in `workflow-next-action.ts`) is **effectively unreachable** in standard linear pipeline flow. The inner loop breaks on the upstream stage's own IN_PROGRESS before the current stage is evaluated.

**However, the guard should be retained.** It provides a safety net for non-linear stage graphs, and its presence is consistent with the parallel block in the other file. Future contributors should understand *why* it exists — the expanded Priority 3d block comment (added during the documentation pass) now makes this explicit. No action required, but engineers touching this area should be aware.

### 3. Stale §5.5 JSDoc Cross-Reference in `workflow-handoff.ts`

`workflow-handoff.ts` line 320 still references `(§5.5)` — a stale section number from before the workflow spec was reorganized into separate files. The correct reference is `§13.1` in `handoff.md`. The project manifest docs were updated (out-of-scope for Documentation), but the **source file JSDoc** was not changed during this session. A Developer should fix this in a future pass alongside other JSDoc cleanup.

### 4. PM Recommendation Engine Comment Numbering is Now Consistent

The `"Priority 4 / Fallback: WAIT"` → `"Final Fallback: WAIT"` rename (applied by the Reviewer as a Fix-Forward) resolves the ambiguity introduced by having sub-priorities 3, 3b, 3c, and 3d. The comment system should use either strict sequential integers or labeled names — mixing both caused confusion. If additional PM priorities are added in the future, prefer labeled names (`"Final Fallback"`) over numeric progression to avoid this pattern recurring.

### 5. `makeWp` Test Helper Could Accept `assigned_to` Override

In `workflow-handoff.test.ts`, the `makeWp` helper hardcodes `assigned_to: 'Developer'`. Tests that need a different assignee must spread and override. This is low-priority pre-existing debt, but a simple optional parameter or second factory function would make intent explicit in test call sites.

---

## Incident Report

| Severity | Tool | Description | Resolved? |
|----------|------|-------------|-----------|
| Medium | `ledger_begin_work` / `ledger_claim_work_package` | WP-004 claim rejected with "active work package is WP-003" guard error, even though WP-003 was already COMPLETE. The guard appeared to read a stale cached state. Resolved via retry on subsequent tool call. | ✅ (workaround) |

> The ledger guard appears to have a transient caching issue where a just-completed WP's status is not immediately visible to the claim guard. This should be investigated in the `central_pm` MCP server — if the `active_wp` field is cached at session start and not refreshed on COMPLETE transitions, a race condition exists for back-to-back completions.

---

## Next Steps

1. **Refactor: Extract `latestNonCancelledPipeline()` helper** — low-risk, high-value cleanup. Creates a single source of truth for the filter+at(-1) pattern now duplicated across both PM dispatch files.
2. **Fix stale §5.5 JSDoc in `workflow-handoff.ts`** — correct the cross-reference to §13.1 in a future Developer pass.
3. **Investigate ledger claim guard caching** — the WP-004 claim rejection suggests a potential staleness issue in the `central_pm` MCP server's active WP guard. Reproduce and fix to prevent future orchestration stalls.
4. **Monitor PM routing in production** — now that both dispatch paths emit ROUTE_PIPELINE_AGENT, verify in live runs that the orchestrator correctly acts on the `next_agent` field and initiates the pipeline stage handoff as expected.
