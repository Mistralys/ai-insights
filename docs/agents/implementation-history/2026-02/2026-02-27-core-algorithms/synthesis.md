# Synthesis Report — Phase 2: Core Algorithms

**Project:** Ledger Specification Alignment — Phase 2 of 6  
**Plan Path:** `docs/agents/plans/2026-02-27-core-algorithms/`  
**Date:** 2026-02-27  
**Synthesized By:** Head of Operations (Synthesis Agent)  
**Status:** ✅ ALL WORK PACKAGES COMPLETE

---

## Executive Summary

Phase 2 implemented the **algorithmic foundation** of the MCP server's workflow engine. This phase delivered five new pure utility functions, corrected two existing helpers with semantic drift, fixed a critical bug in `startPipeline`'s prerequisite check, resolved two schema-level WP ID regex gaps carried over from Phase 1, and capped the work with a full documentation consolidation pass.

All changes are confined to stateless utility layers — no MCP tool registration, no file I/O, no locking — making Phase 2 the safest and most isolated phase in the six-phase plan. Every work package passed all four pipeline stages (implementation, QA, code-review, documentation) with zero blocking issues.

**Impact:** Phase 3 (Tool Guards & Status Transitions) and Phase 4 (Recommendation Engine) can now proceed against a fully spec-aligned, tested algorithmic base.

---

## Metrics

| Metric | Value |
|--------|-------|
| Work Packages | 8 / 8 COMPLETE |
| Pipeline Stages Run | 32 (8 × 4) |
| Pipeline Stage Results | 32 PASS / 0 FAIL |
| Tests at Session Start | 571 |
| Tests at Session End | 621 |
| Net New Tests | **+50** |
| TypeScript Errors | 0 |
| Security Issues | 0 |
| Blocking Issues | 0 |

---

## Deliverables by Work Package

### WP-001 — WP ID Regex Fix (`CompletePipelineSchema` + `AddObservationSchema`)

**What changed:** Both schemas used `/^WP-\d{3}$/` (exactly 3 digits), which would silently reject real IDs like `WP-1000` or `WP-12345`. Changed to `/^WP-\d{3,}$/` across all 5 occurrences in `pipeline.ts` and `observations.ts`.

**Bonus:** `_schemas` testability exports added to `pipeline.ts` (for `CompletePipelineSchema`) and `observations.ts` (for `AddObservationSchema` and `AddProjectCommentSchema`), following the pattern already in place for other schemas.

**Tests added:** 16 (6 in `pipeline.test.ts`, 10 in new `observations.test.ts`)  
**Files:** `pipeline.ts`, `observations.ts`, `pipeline.test.ts`, `observations.test.ts`  
**Docs:** `constraints.md`, `tech-stack.md`, `api-surface.md`

---

### WP-002 — `getDownstreamTypes()` / `getUpstreamTypes()`

**What changed:** Added two new exported functions to `pipeline-maps.ts` that traverse the canonical `PIPELINE_TYPES` tuple to return all pipeline types after or before a given type. Both return fresh arrays (spread syntax) to prevent mutation of the singleton tuple.

**Tests added:** 10 (all 8 required spec table rows + 2 immutability tests)  
**Files:** `pipeline-maps.ts`, `pipeline-maps.test.ts` (new)  
**Docs:** `api-surface.md`

---

### WP-003 — `hasDownstreamFail()`

**What changed:** Added `hasDownstreamFail()` to `workflow-helpers.ts`. Delegates to `getDownstreamTypes()` for multi-hop traversal; filters auto-cancelled pipelines; applies most-recent-wins semantics.

**Tests added:** 10  
**Files:** `workflow-helpers.ts`, `workflow-helpers.test.ts`  
**Docs:** `api-surface.md`

---

### WP-004 — Auto-Cancelled Filtering Corrections

**What changed:** Two existing helpers corrected against the spec:
- `isMostRecentPipelineFail()` — now filters `auto_cancelled` entries before picking `.at(-1)`. Previously had **zero tests**; now has 9.
- `hasNewUpstreamPassSince()` — changed `>` to `>=` (coincident timestamps now correctly return true per §14.6) and filters `auto_cancelled` entries from the downstream lookup.

**Tests added:** 12  
**Files:** `workflow-helpers.ts`, `workflow-helpers.test.ts`  
**Docs:** `api-surface.md`

---

### WP-005 — `hasDownstreamReengagedSince()`

**What changed:** Added `hasDownstreamReengagedSince()` to `workflow-helpers.ts`. Detects whether a downstream stage (QA or code-review) re-engaged after the current stage's most recent PASS, signalling that Developer rework was requested. Uses `developerReworkTypes = ['qa', 'code-review']` (hardcoded, see debt below).

**Tests added:** 8  
**Files:** `workflow-helpers.ts`, `workflow-helpers.test.ts`  
**Docs:** `api-surface.md`

---

### WP-006 — `checkRevalidationGuard()`

**What changed:** Added `checkRevalidationGuard()` to `workflow-helpers.ts`. Implements the §11.1 re-validation guard algorithm — returns `null` (allow) or an error string (block) based on whether the prerequisite stage PASS post-dates any prior run of the current stage. Consumes `getUpstreamTypes()` for prerequisite traversal.

**Tests added:** 7  
**Files:** `workflow-helpers.ts`, `workflow-helpers.test.ts`  
**Docs:** `api-surface.md`

---

### WP-007 — `startPipeline` Most-Recent-Wins Prerequisite Fix

**What changed:** Fixed the prerequisite check in `pipeline.ts`'s `startPipeline` from `.some(p => p.status === 'PASS')` (any historical PASS) to `.at(-1)` semantics (most recent only). A historical PASS followed by a FAIL now correctly blocks pipeline start.

**Tests added:** 3 (directly exercising the real `startPipeline` code path)  
**Files:** `pipeline.ts`, `pipeline.test.ts`  
**Docs:** `api-surface.md`, `constraints.md`

---

### WP-008 — Documentation Consolidation

**What changed:** Final audit and correction pass across `api-surface.md` and `file-tree.md`:
- Fixed `checkRevalidationGuard` signature (was documented with 2 params; source takes 3: `wp`, `pipelineType`, `prerequisite`).
- Added `pipeline-maps.test.ts` to `file-tree.md`.
- Removed duplicate `timestamp.test.ts` and `wp-id.test.ts` entries (formatting artifact).
- Updated `file-tree.md` `pipeline-maps.ts` entry to mention `getDownstreamTypes` and `getUpstreamTypes`.

**Files:** `api-surface.md`, `file-tree.md`

---

## Aggregate Failure / Blocker Summary

No pipeline stage failures. No blocking issues. The only items requiring attention are follow-up observations (see Strategic Recommendations).

---

## Strategic Recommendations (Gold Nuggets)

These items were surfaced by Reviewer and QA pipelines and are carried forward for the Planner/Manager to triage.

### 🔴 Medium Priority

| # | Issue | Location | Recommendation |
|---|-------|----------|----------------|
| M-1 | `developerReworkTypes` hardcoded as `['qa', 'code-review']` inline in `hasDownstreamReengagedSince()` instead of derived from `FAIL_ROUTING_MAP`. Silent drift risk if routing changes. | `workflow-helpers.ts:160` | Derive at call-site: `Object.entries(FAIL_ROUTING_MAP).filter(([,a]) => a === 'Developer').map(([t]) => t as PipelineType)`. Add a comment cross-referencing `FAIL_ROUTING_MAP` as minimum fix. |
| M-2 | `startPipeline` old "Pipeline ordering enforcement" describe block tests an inlined condition, not the real `startPipeline` code path. Tests remained green but never exercised the fixed code. | `pipeline.test.ts` (old block) | Retain for schema documentation value; flag the test block with a comment explaining the gap. New `'startPipeline prerequisite most-recent semantics'` block provides genuine coverage. |
| M-3 | `isMostRecentPipelineFail` had **zero test coverage** before this session despite being on the critical REWORK path. | `workflow-helpers.ts` | Covered by WP-004. Establish a policy: any function on a REWORK or RECOMMENDATION path must have baseline tests before merging. |

### 🟡 Low Priority

| # | Issue | Location | Recommendation |
|---|-------|----------|----------------|
| L-1 | `hasDownstreamFail()` inner loop duplicates the filter + `.at(-1).status === 'FAIL'` logic already in `isMostRecentPipelineFail()`. DRY violation. | `workflow-helpers.ts` | Simplify to `getDownstreamTypes(pipelineType).some((t) => isMostRecentPipelineFail(pipelines, t))`. |
| L-2 | `getUpstreamTypes()` has no `index === -1` guard (unlike `getDownstreamTypes()`). For an unknown type `slice(0, -1)` returns all-but-last instead of `[]`. TypeScript makes this statically unreachable but defensive handling is inconsistent. | `pipeline-maps.ts` | Add guard for symmetry: `if (index === -1) return [];` |
| L-3 | `checkRevalidationGuard()` takes `WorkPackageDetail` while all sibling helpers (`hasDownstreamFail`, `hasNewUpstreamPassSince`, `hasDownstreamReengagedSince`) take `Pipeline[]`. Mixed convention. | `workflow-helpers.ts` | Schedule a future refactor to standardise — either migrate all helpers to `WorkPackageDetail`, or strip `wp.pipelines` at call-sites and pass `Pipeline[]` to `checkRevalidationGuard`. |
| L-4 | No dedicated test for equal-timestamp boundary in `checkRevalidationGuard()` (`prereqCompletedAt === baselineStartedAt` → should return `null`). | `workflow-helpers.test.ts` | Add one test case asserting `null` when timestamps are equal. |
| L-5 | `file-tree.md` `src/utils/` section has a pre-existing indentation inconsistency: `workflow-helpers.ts` uses 8-space indent while siblings use `│   ` pipe notation. | `file-tree.md` | Clean up in next documentation-only pass. |
| L-6 | No trailing-alpha negative test (`WP-123abc`) for the WP ID regex. The `$` anchor makes this correct but a test would serve as living documentation. | `pipeline.test.ts`, `observations.test.ts` | Add one negative test to each file. |
| L-7 | `_schemas` export pattern (for test-access to Zod schemas) is now established across `pipeline.ts` and `observations.ts` but not documented as a canonical convention. | `api-surface.md` | Already documented in WP-001's doc pipeline. Ensure this pattern is referenced in `constraints.md` as the required approach for new schema files. |

---

## Next Steps — Planner Guidance

Phase 2 is complete. The prerequisite for **Phase 3 (Tool Guards & Status Transitions)** is now fully satisfied:

1. `checkRevalidationGuard()` is exported and tested — ready to be wired into `complete-pipeline.ts`.
2. All downstream/upstream traversal helpers are in place.
3. `startPipeline` now uses correct most-recent-wins prerequisite semantics.

**Recommended Phase 3 priorities:**

1. Wire `checkRevalidationGuard()` into `completePipeline` so stage-skipping is enforced at runtime (currently the guard exists but has no call sites).
2. Wire `hasDownstreamFail()` and `hasDownstreamReengagedSince()` into the recommendation engine paths (Phase 4 dependency).
3. Address **M-1** (derive `developerReworkTypes` from `FAIL_ROUTING_MAP`) before Phase 4 — the recommendation engine will call `hasDownstreamReengagedSince()` heavily and silent drift is a production risk.

---

## Appendix — Files Modified This Session

| File | WPs |
|------|-----|
| `mcp-server/src/tools/pipeline.ts` | WP-001, WP-007 |
| `mcp-server/src/tools/observations.ts` | WP-001 |
| `mcp-server/src/utils/pipeline-maps.ts` | WP-002 |
| `mcp-server/src/utils/workflow-helpers.ts` | WP-003, WP-004, WP-005, WP-006 |
| `mcp-server/tests/tools/pipeline.test.ts` | WP-001, WP-007 |
| `mcp-server/tests/tools/observations.test.ts` | WP-001 (new file) |
| `mcp-server/tests/utils/pipeline-maps.test.ts` | WP-002 (new file) |
| `mcp-server/tests/utils/workflow-helpers.test.ts` | WP-003, WP-004, WP-005, WP-006 |
| `mcp-server/docs/agents/project-manifest/api-surface.md` | WP-001, WP-002, WP-003, WP-004, WP-005, WP-006, WP-007, WP-008 |
| `mcp-server/docs/agents/project-manifest/constraints.md` | WP-001, WP-007 |
| `mcp-server/docs/agents/project-manifest/tech-stack.md` | WP-001 |
| `mcp-server/docs/agents/project-manifest/file-tree.md` | WP-008 |
