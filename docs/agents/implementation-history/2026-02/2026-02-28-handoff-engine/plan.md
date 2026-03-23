# Plan

## Summary

Phase 5 of the Ledger Specification Alignment project updates all per-agent handoff functions in `workflow-handoff.ts` to match the specification's §13.1 logic, adds temporal guards borrowed from the Phase 2/4 algorithms, corrects the auto-handoff depth counter lifecycle, and fixes the dependency-blocked WP detection invariant defined in §21.54. The result is a handoff engine that accurately routes agents — including the tricky re-engagement scenarios after upstream rework — without stalling auto-handoff chains.

## Architectural Context

The handoff system lives in a single file: `mcp-server/src/tools/workflow-handoff.ts` (812 lines). It exports:

- `getHandoffStatus` — the registered MCP tool (`ledger_get_handoff_status`)
- Per-agent functions: `getPlannerHandoff`, `getProjectManagerHandoff`, `getDeveloperHandoff`, `getQaHandoff`, `getReviewerHandoff`, `getDocumentationHandoff`
- `buildHandoffResponse` — assembles the JSON payload and handles auto-handoff chain depth tracking
- `nextAgentFromStatus` — maps handoff status strings to agent role names

All stateless algorithms used by handoff functions live in `mcp-server/src/utils/workflow-helpers.ts`. Phase 2 and Phase 4 added the following helpers that Phase 5 must now invoke:

| Helper | Source | Phase Added |
|--------|--------|-------------|
| `hasDownstreamReengagedSince` | `workflow-helpers.ts` | Phase 2 |
| `hasNewUpstreamPassSince` | `workflow-helpers.ts` | Phase 2 |
| `isMostRecentPipelineFail` (auto-cancelled-aware) | `workflow-helpers.ts` | Phase 2 |
| `isBlockedByDependencies` | `workflow-helpers.ts` | Existing |
| `isTerminalStatus` | `schema/validators.ts` | Existing |

The auto-handoff depth counter is tracked in `root.auto_handoff_depth` on `RootIndex`. Currently it is reset inside `updateWorkPackageStatus` whenever a WP reaches COMPLETE. Per §18.4 this reset must move to `completeSynthesis` only. The `updateWorkPackageStatus` function is in `mcp-server/src/tools/work-package.ts`. The synthesis function is in `mcp-server/src/tools/project-lifecycle.ts`.

The dependency-blocked detection currently uses two helpers: `hasDependencyBlocked` (uses `RootIndex` summaries) and `isBlockedByDependencies` (uses full `WorkPackageDetail[]` arrays). Both check whether listed dependencies are all terminal. Per §21.54, the canonical definition is metadata-based: `wp.status === 'BLOCKED' && (wp.blocked_by?.type === 'dependency' || wp.blocked_by == null)`. The handoff functions use `isBlockedByDependencies`, which is the array-based variant.

The test suite for this module is `mcp-server/tests/tools/workflow-handoff.test.ts` (1,559 lines).

## Approach / Architecture

All changes are within `workflow-handoff.ts`, `workflow-helpers.ts` (minor additions), and `work-package.ts` (depth counter reset removal). No new MCP tools are created. No schema changes are needed (all schema additions happened in Phase 1).

Changes follow the spec's §13.1 per-agent algorithm descriptions verbatim, applying them top-to-bottom with short-circuit semantics.

The approach for each agent function is:

1. **Replace the structural logic** — re-order conditions to match spec priority order
2. **Inject temporal guards** — use Phase 2 helpers where the spec calls for them
3. **Add READY_FOR_SYNTHESIS terminal exit** — all agent functions must check whether all WPs are terminal and exit to synthesis if so
4. **Fix dependency-blocked exclusion** — use metadata-based check where required by §21.54

## Rationale

The handoff functions are the auto-handoff chain's routing layer. If they return incorrect statuses, the chain stalls (e.g., returning `READY_FOR_DEVELOPER` when the Developer has already delivered a fix), wastes cycles (e.g., returning `IN_PROGRESS` for Developer when it should be `READY_FOR_QA`), or never terminates (e.g., missing `READY_FOR_SYNTHESIS` exit). The temporal guards added in Phase 2 are only useful if the handoff engine also uses them — Phase 4 wired them into the recommendation engine; Phase 5 wires them into the handoff engine.

The depth counter lifecycle change (5.7) is also in this phase because it pairs with the handoff engine and affects auto-handoff chain behavior.

## Detailed Steps

### 5.1 Fix Developer Handoff (`getDeveloperHandoff`)

**File:** `mcp-server/src/tools/workflow-handoff.ts`

**Current problems:**
- Checks for "any impl FAIL" without temporal guard — returns `IN_PROGRESS` even when Developer already delivered a fix that downstream hasn't validated yet
- Does not check for "needs QA" using `hasNewUpstreamPassSince`, so it never routes to `READY_FOR_QA` after a rework cycle
- Does not exclude dependency-blocked WPs from FAIL detection
- Missing all-terminal exit to `READY_FOR_SYNTHESIS`
- Fallback `IN_PROGRESS` (for `assigned_to == "Developer"`) is missing

**Required algorithm (per §13.1):**
```
// 1. Temporal-guarded FAIL check
if any non-terminal, non-dependency-blocked WP:
  mostRecentImpl is FAIL (for downstream types routed to Developer, excluding auto-cancelled)
  AND hasDownstreamReengagedSince(wp.pipelines, "implementation") is true:
  return IN_PROGRESS  ("Developer must rework")

// 2. Needs QA
if any non-terminal, non-dependency-blocked WP:
  has PASS implementation AND (no QA started yet OR hasNewUpstreamPassSince("implementation", "qa")):
  return READY_FOR_QA

// 3. All terminal
if all WPs are terminal:
  return READY_FOR_SYNTHESIS

// 4. Active work fallback
if any WP is IN_PROGRESS with assigned_to == "Developer":
  return IN_PROGRESS  ("Developer has active work")

return WAIT
```

**Notes:**
- For the "FAIL routed to Developer" condition, use `isMostRecentPipelineFail` on `implementation`, `qa`, or `code-review` (all types whose FAIL routes to Developer via `FAIL_ROUTING_MAP`). Documentation FAIL is excluded.
- The "needs QA" condition covers both first-run (no QA yet) and re-engagement after rework (`hasNewUpstreamPassSince`). Note: `hasNewUpstreamPassSince` returns `true` when no downstream pipeline exists, so the "no QA yet" check and `hasNewUpstreamPassSince` can be unified as just `hasNewUpstreamPassSince("implementation", "qa")`. However, retaining the explicit "PASS implementation" guard is important — do not route to `READY_FOR_QA` if there's no implementation PASS yet.
- Dependency-blocked WPs are excluded using `isBlockedByDependencies(wp, wpDetails)`.

### 5.2 Fix QA Handoff (`getQaHandoff`)

**File:** `mcp-server/src/tools/workflow-handoff.ts`

**Current problems:**
- Does not check for re-engagement (Developer re-PASSed since QA FAIL) before the FAIL short-circuit
- The `READY_FOR_REVIEW` condition checks `pipelines.some(p.type === 'qa' && p.status === 'PASS')` but doesn't include re-engagement ("has PASS qa but review needs re-run after upstream rework")
- Does not exclude dependency-blocked WPs from actionability checks properly (partial — some paths exclude BLOCKED WPs, others do not)
- Missing all-terminal exit to `READY_FOR_SYNTHESIS`
- Missing fallback `IN_PROGRESS` for `assigned_to == "QA"`

**Required algorithm (per §13.1):**
```
// 1. Re-engagement check (BEFORE FAIL short-circuit)
if any non-terminal, non-dependency-blocked WP:
  has FAIL qa pipeline (isMostRecentPipelineFail)
  AND hasNewUpstreamPassSince(wp.pipelines, "implementation", "qa") is true:
  return IN_PROGRESS  (QA should re-engage)

// 2. FAIL short-circuit
if any non-terminal, non-dependency-blocked WP has FAIL qa (not caught above):
  return READY_FOR_DEVELOPER

// 3. READY_FOR_REVIEW
readyForReview = non-terminal WPs with PASS qa AND (
  no code-review pipeline yet OR hasNewUpstreamPassSince("qa", "code-review")
)
if readyForReview is not empty:
  if all readyForReview are dependency-blocked: skip (fall through)
  else: return READY_FOR_REVIEW

// 4. All terminal
if all WPs are terminal:
  return READY_FOR_SYNTHESIS

// 5. Active work fallback
if any WP is IN_PROGRESS with assigned_to == "QA":
  return IN_PROGRESS

return WAIT
```

**Key note:** The re-engagement check (step 1) must come before the FAIL short-circuit (step 2) per §13.2. After `qa-1 FAIL → impl-2 PASS`, step 1 fires (`hasNewUpstreamPassSince` is true), returning `IN_PROGRESS` for QA rather than routing back to Developer.

### 5.3 Fix Reviewer Handoff (`getReviewerHandoff`)

**File:** `mcp-server/src/tools/workflow-handoff.ts`

Identical structural fix to QA handoff, applied to `code-review` pipelines:

```
// 1. Re-engagement check (BEFORE FAIL short-circuit)
if any non-terminal, non-dependency-blocked WP:
  has FAIL code-review pipeline
  AND hasNewUpstreamPassSince(wp.pipelines, "qa", "code-review") is true:
  return IN_PROGRESS  (Reviewer should re-engage)

// 2. FAIL short-circuit
if any non-terminal, non-dependency-blocked WP has FAIL code-review (not caught above):
  return READY_FOR_DEVELOPER

// 3. READY_FOR_DOCUMENTATION
readyForDocs = non-terminal WPs with PASS code-review AND (
  no documentation pipeline yet OR hasNewUpstreamPassSince("code-review", "documentation")
)
if readyForDocs is not empty:
  if all readyForDocs are dependency-blocked: skip (fall through)
  else: return READY_FOR_DOCUMENTATION

// 4. All terminal
if all WPs are terminal:
  return READY_FOR_SYNTHESIS

// 5. Active work fallback
if any WP is IN_PROGRESS with assigned_to == "Reviewer":
  return IN_PROGRESS

return WAIT
```

### 5.4 Fix Documentation Handoff (`getDocumentationHandoff`)

**File:** `mcp-server/src/tools/workflow-handoff.ts`

**Current problems:**
- The FAIL check (`documentation FAIL`) and the "needs docs" check share the same condition, obscuring the spec's intended priority order
- "readyForDocs" does not use `hasNewUpstreamPassSince("code-review", "documentation")` — it only checks `pipelines.some(p.type === 'documentation')` being absent, missing re-engagement after upstream rework
- Missing all-terminal exit to `READY_FOR_SYNTHESIS`

**Required algorithm (per §13.1):**
```
// 1. Ready-for-docs check (NEW DOCS OR RE-ENGAGEMENT — before FAIL)
readyForDocs = non-terminal WPs where:
  has PASS code-review AND (
    no documentation pipeline yet (first run)
    OR hasNewUpstreamPassSince("code-review", "documentation")
  )
if readyForDocs is not empty:
  if all readyForDocs are dependency-blocked: skip (fall through)
  else: return IN_PROGRESS  (Documentation continues documenting)

// 2. FAIL → self-rework
if any non-terminal, non-dependency-blocked WP has FAIL documentation (isMostRecentPipelineFail):
  return IN_PROGRESS  (Documentation self-reworks)

// 3. Upstream work still needed
needsUpstreamWork = non-terminal, non-blocked WPs without PASS code-review
if needsUpstreamWork is not empty:
  if all needsUpstreamWork are dependency-blocked: return WAIT
  else: return READY_FOR_DEVELOPER

// 4. All terminal
if all WPs are terminal:
  return READY_FOR_SYNTHESIS

return WAIT
```

**Note:** The spec puts ready-for-docs BEFORE FAIL self-rework in the handoff (unlike the recommendation engine where FAIL comes first). This is intentional per §14.5 design note: handoff has new-work-first bias while recommendation has fix-failures-first bias.

### 5.5 Rewrite Project Manager Handoff (`getProjectManagerHandoff`)

**File:** `mcp-server/src/tools/workflow-handoff.ts`

**Current state:** The current implementation only checks if any WP lacks an implementation pipeline and routes accordingly. This is entirely inconsistent with the spec.

**Required algorithm (per §13.1):**
```
// 1. Non-dependency blockers → PM action needed
for each non-terminal WP with status == "BLOCKED":
  if wp.blocked_by?.type in ["decision", "external", "technical"]:
    return IN_PROGRESS  (PM has actionable blocked WP)

// 2. READY WPs → route to assigned agent
for each WP with status == "READY":
  if wp.assigned_to is not null:
    return readyStatusForAgent(wp.assigned_to)  // e.g. READY_FOR_QA if assigned to "QA"
  else:
    return READY_FOR_DEVELOPER  (unassigned → Developer starts first pipeline)

// 3. All terminal
if all WPs are terminal:
  return READY_FOR_SYNTHESIS

// 4. WPs in-flight (IN_PROGRESS or dependency-BLOCKED)
return WAIT
```

**`readyStatusForAgent` helper:** Map agent roles to handoff statuses:
- `"Developer"` → `"READY_FOR_DEVELOPER"`
- `"QA"` → `"READY_FOR_QA"`
- `"Reviewer"` → `"READY_FOR_REVIEW"`
- `"Documentation"` → `"READY_FOR_DOCUMENTATION"`
- Anything else → `"READY_FOR_DEVELOPER"` (fallback)

This is a small private function added in `workflow-handoff.ts`. It does not need to be exported.

### 5.6 Dynamic Auto-Handoff Depth Ceiling (`buildHandoffResponse`)

**File:** `mcp-server/src/tools/workflow-handoff.ts` and `mcp-server/src/utils/workflow-helpers.ts`

**Current code:** `buildHandoffResponse` calls `getMaxHandoffDepth()` which returns a static value from config (defaulting to `10`).

**Required change (per §18.2.1):** The effective maximum must scale with project size:
```typescript
function effectiveMaxDepth(totalWorkPackages: number): number {
  const staticFloor = getMaxHandoffDepth(); // from config, default 50
  return Math.max(staticFloor, totalWorkPackages * 20);
}
```

**Implementation steps:**
1. Add `effectiveMaxDepth(totalWorkPackages: number): number` to `workflow-helpers.ts` (or inline in `buildHandoffResponse`)
2. Update `buildHandoffResponse` to read `root.total_work_packages` from the root index (already available in the function — `root` is read for `auto_handoff_depth`) and pass to `effectiveMaxDepth`
3. Replace `currentDepth < getMaxHandoffDepth()` with `currentDepth < effectiveMaxDepth(root.total_work_packages ?? 0)`
4. When the depth limit is reached, emit a warning project comment using the store (§18.5): `store.addProjectComment({ type: 'warning', priority: 'medium', text: 'Auto-handoff depth limit reached. Manual intervention required to continue.' })` — but only if the store has a method for this; otherwise log to stderr as a fallback.

**Config default:** The spec's default for `max_handoff_depth` is 50 (not 10). Check `mcp-server/gui/config.ts` for the DEFAULT_CONFIG. If the default is still 10, update it to 50 as part of this step.

### 5.7 Move Auto-Handoff Depth Reset to `completeSynthesis`

**Files:**
- `mcp-server/src/tools/work-package.ts` — remove reset
- `mcp-server/src/tools/project-lifecycle.ts` — add reset

**Current code (in `work-package.ts`):** When a WP transitions to COMPLETE, the code resets `auto_handoff_depth` to 0 in the root index. The in-code comment in `buildHandoffResponse` says:
> `// (auto_handoff_depth is reset at WP-completion time inside updateWorkPackageStatus, ...)`

**Required change (per §18.4):** The depth counter must ONLY be reset inside `completeSynthesis`, not on individual WP completions. Find the `auto_handoff_depth: 0` reset in `updateWorkPackageStatus` and remove it. Then, in `completeSynthesis` (step 6 of §19.1), add `auto_handoff_depth: 0` to the root index write atomically with the synthesis completion.

**Note:** Also update the in-code comment in `buildHandoffResponse` to reflect the new reset location.

### 5.8 Fix Dependency-Blocked Detection to Use Metadata (§21.54)

**File:** `mcp-server/src/utils/workflow-helpers.ts`

**Current state:** `isBlockedByDependencies` checks whether any ID in `wp.dependencies` has a non-terminal status. `hasDependencyBlocked` does the same against `RootIndex` summaries. Both derive "blocked by dependency" purely from the dependency list state.

**Spec §21.54 definition:** A WP is classified as "blocked by dependencies" canonically when:
```
wp.status === 'BLOCKED' && (wp.blocked_by?.type === 'dependency' || wp.blocked_by == null)
```

**Rationale:** The metadata (the `blocked_by` field on the WP) is the ground truth set during `propagateDependencyReblock` (§15.5) and `updateWorkPackageStatus`. The dependency-array liveness check can drift: if a WP is manually blocked with a non-dependency blocker but happens to also have dependencies that aren't terminal, the array check misclassifies it as "dependency-blocked."

**Required changes:**

Update `isBlockedByDependencies` to use the metadata-based check:
```typescript
export function isBlockedByDependencies(
  wp: WorkPackageDetail,
): boolean {
  if (wp.status !== 'BLOCKED') return false;
  return wp.blocked_by == null || wp.blocked_by.type === 'dependency';
}
```

The second parameter (`allWpDetails: WorkPackageDetail[]`) becomes unused and should be removed. Update all call sites in `workflow-handoff.ts` accordingly (the call sites pass `wpDetails` as the second argument — remove those arguments).

Update `hasDependencyBlocked` identically (it will no longer need `rootIndex`):
```typescript
export function hasDependencyBlocked(
  wpDetail: WorkPackageDetail,
): boolean {
  if (wpDetail.status !== 'BLOCKED') return false;
  return wpDetail.blocked_by == null || wpDetail.blocked_by.type === 'dependency';
}
```

**Impact:** Any call sites in `workflow-next-action.ts` and `workflow-batch-actions.ts` that pass the second parameter must be updated. Grep for `hasDependencyBlocked` and `isBlockedByDependencies` across the codebase to find all call sites.

**Important check:** Verify that the `WorkPackageDetail` type includes `blocked_by` (it should, as a `BlockedBy | null` field set in Phase 1/3). If the field is optional rather than nullable, the null check should use `blocked_by == null` (covers both `undefined` and `null`).

## Dependencies

- Phase 1 (schema changes: `auto_cancelled`, nullable `assigned_to`, `status_changed_at`): complete
- Phase 2 (algorithm helpers: `hasDownstreamReengagedSince`, `hasNewUpstreamPassSince`, `isMostRecentPipelineFail` with auto-cancelled exclusion): complete
- Phase 3 (`propagateDependencyReblock` sets `auto_cancelled` on cascade-reblocked pipelines, `updateWorkPackageStatus` sets `status_changed_at`): must be complete before step 5.7 depth-reset deletion is safe to test end-to-end
- Phase 4 (recommendation engine): complete; the handoff engine is an independent parallel concern but shares the same helper functions

## Required Components

**Modified files:**
- `mcp-server/src/tools/workflow-handoff.ts` — all per-agent handoff function rewrites (5.1–5.5), depth ceiling logic (5.6)
- `mcp-server/src/utils/workflow-helpers.ts` — `effectiveMaxDepth` addition (5.6), `isBlockedByDependencies` / `hasDependencyBlocked` signature update (5.8)
- `mcp-server/src/tools/work-package.ts` — remove `auto_handoff_depth` reset from `updateWorkPackageStatus` (5.7)
- `mcp-server/src/tools/project-lifecycle.ts` — add `auto_handoff_depth: 0` in `completeSynthesis` (5.7)
- `mcp-server/gui/config.ts` `DEFAULT_CONFIG` — verify/update default `max_handoff_depth` to 50 (5.6)

**Modified test files:**
- `mcp-server/tests/tools/workflow-handoff.test.ts` — major expansion (see Testing Strategy)
- `mcp-server/tests/utils/workflow-helpers.test.ts` — tests for updated helper signatures (5.8)

## Assumptions

- `WorkPackageDetail.blocked_by` exists on the schema with type `{ type: string; ... } | null | undefined` — set in Phase 1/3. If it's truly absent from the schema, a Phase 1 fix is a prerequisite blocker.
- `WorkPackageDetail.assigned_to` is nullable (Phase 1 change). The PM handoff's `wp.assigned_to` null check is correct.
- Phase 2 helpers (`hasDownstreamReengagedSince`, `hasNewUpstreamPassSince`, `isMostRecentPipelineFail`) are implemented and passing — Phase 5 only calls them, does not reimplement.
- `store.addProjectComment` exists or can be approximated. If not available, the depth-limit warning (§18.5) can be emitted to stderr only. This is a SHOULD-level requirement.

## Constraints

- No new MCP tools in this phase.
- No schema changes — all are Phase 1 concerns.
- `buildHandoffResponse` signature must not change (it is called from many test sites and the main tool handler).
- `isBlockedByDependencies` removal of the second parameter is a breaking API change to this file. All call sites must be updated atomically with the signature change.
- The depth counter change (5.7) touches `work-package.ts` which is also modified in Phase 3. If Phase 3 is not yet complete, coordinate carefully to avoid merge conflicts in `updateWorkPackageStatus`.

## Out of Scope

- PM recommendation engine updates — covered in Phase 4 (`REVIEW_ABANDONED`, `REPAIR_ORPHAN_BLOCKED`).
- Synthesis agent handoff logic (currently hardcodes `COMPLETE`) — no spec-documented change required.
- Planner handoff changes — the spec's Planner logic matches the current implementation.
- New PM tools (`resetReworkCount`, `updateAcceptanceCriteria`) — Phase 6.
- Self-healing rules — Phase 6.

## Acceptance Criteria

- All 5 per-agent handoff functions match §13.1 priority-ordered algorithms exactly
- `getDeveloperHandoff` returns `READY_FOR_QA` after `impl-1 PASS` (no QA yet) and after `qa-1 FAIL → impl-2 PASS` (re-engagement needed)
- `getDeveloperHandoff` returns `READY_FOR_SYNTHESIS` when all WPs are COMPLETE/CANCELLED
- `getDeveloperHandoff` does NOT return `IN_PROGRESS` when Developer already delivered a fix that downstream hasn't yet validated (`hasDownstreamReengagedSince` is false)
- `getQaHandoff` returns `IN_PROGRESS` (re-engagement) when QA FAIL exists but Developer has since re-PASSed implementation
- `getQaHandoff` returns `READY_FOR_DEVELOPER` only when latest impl is not re-PASSed since QA FAIL
- `getReviewerHandoff` returns `IN_PROGRESS` (re-engagement) when review FAIL exists but QA has since re-PASSed
- `getDocumentationHandoff` routes to `IN_PROGRESS` for re-engagement docs (new upstream PASS after previous doc run) before checking FAIL
- `getProjectManagerHandoff` returns `IN_PROGRESS` for non-dependency blockers, routes READY WPs to correct agent by `assigned_to`, returns `READY_FOR_SYNTHESIS` when all terminal
- Auto-handoff depth resets only in `completeSynthesis`, not in `updateWorkPackageStatus`
- `isBlockedByDependencies` uses metadata-based check (`blocked_by` field), all call sites updated
- All existing passing tests remain green after changes
- New tests for temporal guard scenarios pass

## Testing Strategy

### New test scenarios (grouped by function)

**`getDeveloperHandoff`:**
- `impl-1 PASS, no QA` → `READY_FOR_QA`
- `qa-1 FAIL, impl-2 PASS, no QA re-engagement` → NOT `IN_PROGRESS` ("Developer must rework") — returns `READY_FOR_QA` (QA re-engagement path) or `WAIT`
- `qa-1 FAIL, impl-1 still PASS, QA has re-engaged (qa-2 in progress)` → `READY_FOR_QA` (if hasDownstreamReengagedSince is true and impl PASS still most recent... this one needs careful scenario construction per §14.13 table)
- `all WPs COMPLETE/CANCELLED` → `READY_FOR_SYNTHESIS`
- `WP IN_PROGRESS assigned_to == "Developer", no pipeline` → `IN_PROGRESS` (active work fallback)

**`getQaHandoff`:**
- `qa-1 FAIL, then impl-2 PASS` → `IN_PROGRESS` (re-engagement fires before FAIL short-circuit)
- `qa-1 FAIL, no impl re-pass` → `READY_FOR_DEVELOPER`
- `qa-1 PASS, review needs re-engagement (hasNewUpstreamPassSince("qa", "code-review") true)` → `READY_FOR_REVIEW`
- `all WPs COMPLETE/CANCELLED` → `READY_FOR_SYNTHESIS`
- `WP IN_PROGRESS assigned_to == "QA"` → `IN_PROGRESS`

**`getReviewerHandoff`:**
- `review-1 FAIL, then qa-2 PASS` → `IN_PROGRESS` (re-engagement)
- `review-1 FAIL, no qa re-pass` → `READY_FOR_DEVELOPER`
- `review-1 PASS, docs needs re-engagement` → `READY_FOR_DOCUMENTATION`
- `all WPs COMPLETE/CANCELLED` → `READY_FOR_SYNTHESIS`

**`getDocumentationHandoff`:**
- `code-review PASS, no docs yet` → `IN_PROGRESS` (ready-for-docs path)
- `code-review PASS, doc-1 PASS, then code-review 2 PASS (new upstream)` → `IN_PROGRESS` (re-engagement)
- `code-review PASS, doc-1 FAIL` → `IN_PROGRESS` (ready-for-docs fires BEFORE FAIL self-rework if there's an upstream PASS newer than the doc FAIL — careful: if no new upstream PASS, fall through to FAIL check)
- `code-review PASS, doc-1 FAIL, no new upstream` → `IN_PROGRESS` (FAIL self-rework path)
- `all WPs COMPLETE/CANCELLED` → `READY_FOR_SYNTHESIS`

**`getProjectManagerHandoff`:**
- WP BLOCKED with `blocked_by.type === "technical"` → `IN_PROGRESS`
- WP BLOCKED with `blocked_by.type === "dependency"` → falls through (not PM concern)
- WP READY with `assigned_to === "QA"` → `READY_FOR_QA`
- WP READY with `assigned_to === null` → `READY_FOR_DEVELOPER`
- `all WPs COMPLETE/CANCELLED` → `READY_FOR_SYNTHESIS`
- Mix of IN_PROGRESS and dependency-BLOCKED, no READY → `WAIT`

**Depth lifecycle (integration):**
- Completing a WP does NOT reset `auto_handoff_depth`
- Calling `completeSynthesis` DOES reset `auto_handoff_depth` to 0

**`isBlockedByDependencies` after refactor:**
- WP BLOCKED with `blocked_by.type === "dependency"` → `true`
- WP BLOCKED with `blocked_by === null` → `true`
- WP BLOCKED with `blocked_by.type === "technical"` → `false`
- WP READY (not BLOCKED) → `false`

### Regression guarding

Before modifying each function, verify that the existing tests for that function still structure correctly after the rewrite. The 1,559-line test file has substantial coverage — preserve all existing test names and add new ones for the missing scenarios.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **`isBlockedByDependencies` signature change breaks call sites silently** | Grep for all usages before and after. TypeScript will catch extra-argument calls with `strict` mode. Run full test suite immediately after signature change. |
| **`hasDownstreamReengagedSince` call in Developer handoff is subtle — first-FAIL scenario** | The spec's §14.13 table is the canonical truth. Add all four table rows as test cases. The key: `impl-1 PASS → qa-1 FAIL (no further activity)` → `true` (QA validated current impl and failed; Developer must rework). |
| **Documentation handoff priority order (readyForDocs before FAIL) differs from recommendation engine** | Clearly document with a comment quoting §14.5 design note. Do not attempt to unify the ordering. |
| **Depth reset removal from `updateWorkPackageStatus` could interact with Phase 3 not-yet-merged changes** | If Phase 3 isn't merged, note the conflict point. The removal is a single line — low-risk. |
| **`effectiveMaxDepth` default config value** | Check current `DEFAULT_CONFIG.max_handoff_depth`. If it is 10, the change to 50 will increase auto-handoff chain length significantly. This is intentional per spec but should be noted to the reviewer. |
| **Project Manager handoff regression** | The current PM handoff logic is structurally wrong (checks for "needsImplementation"). Any tests that depend on the old behavior will need to be updated to match the new spec-compliant behavior. This is expected regression cleanup. |
