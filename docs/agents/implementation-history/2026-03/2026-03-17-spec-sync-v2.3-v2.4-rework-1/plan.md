# Plan — Spec Sync v2.3-v2.4 Rework: Synthesis Recommendations & Technical Debt

## Summary

Address the 5 strategic recommendations and 3 technical debt items identified by the synthesis report for the "Spec Sync v2.3 to v2.4" project. These range from medium-priority lock consolidation and schema additions to low-priority code hygiene improvements. None of the items change user-facing behavior; they harden internals, reduce I/O contention on legacy first-reads, and eliminate minor code smells.

## Architectural Context

All changes target the same modules modified in the original project:

- **Self-healing path:** [mcp-server/src/tools/project-lifecycle.ts](mcp-server/src/tools/project-lifecycle.ts) lines 330-450 — `getProjectStatus()` currently acquires 3 sequential `withLock()` calls when self-healing fires: (1) field repair + forward-compat, (2) pipeline ordering warnings, (3) synthesis timestamp repair comment. Each lock re-reads and re-writes the root index.
- **Staleness comparison:** [mcp-server/src/tools/pipeline.ts](mcp-server/src/tools/pipeline.ts) line 490 — `depLastModified > pipeline.started_at` uses lexicographic string comparison on ISO 8601 Z-terminated timestamps.
- **Semver comparison:** [mcp-server/src/tools/project-lifecycle.ts](mcp-server/src/tools/project-lifecycle.ts) line 345 — `.split('.').map(Number)` on the ledger_version string. Pre-release segments like `"2.5.0-beta"` would produce `NaN`.
- **Synthesis state clearing:** Five sites across [mcp-server/src/tools/project-lifecycle.ts](mcp-server/src/tools/project-lifecycle.ts) line 375, [mcp-server/src/tools/work-package.ts](mcp-server/src/tools/work-package.ts) lines 408/873/1104, and [mcp-server/src/utils/project-reset.ts](mcp-server/src/utils/project-reset.ts) line 435 — each repeats `synthesis_generated = false; synthesis_generated_at = null`.
- **Dual imports:** [mcp-server/src/tools/project-lifecycle.ts](mcp-server/src/tools/project-lifecycle.ts) lines 4 and 12 — two separate `import` statements from `../utils/constants.js`.
- **WorkPackageDetail schema:** [mcp-server/src/schema/work-package.ts](mcp-server/src/schema/work-package.ts) lines 116-132 — no `last_updated` field. The staleness check in pipeline.ts (line 404-408) uses a composite proxy: `max(status_changed_at, latest pipeline completed_at)`.
- **jsdom test:** [mcp-server/tests/gui/client-rendering.test.ts](mcp-server/tests/gui/client-rendering.test.ts) — uses `@vitest-environment jsdom` directive. `jsdom` is declared in [mcp-server/package.json](mcp-server/package.json) devDependencies (line 26) but not installed in `node_modules/`.
- **Constants:** [mcp-server/src/utils/constants.ts](mcp-server/src/utils/constants.ts) — shared constants module.
- **Pipeline maps:** [mcp-server/src/utils/pipeline-maps.ts](mcp-server/src/utils/pipeline-maps.ts) — pipeline routing utilities.

## Approach / Architecture

Group the 8 items into 4 logical work packages by affinity:

1. **WP-001 — Lock consolidation + TOCTOU symmetry** (Medium priority): Collapse the 3 sequential locks in `getProjectStatus()` self-healing into a single lock scope. Within that scope, also make the synthesis timestamp repair follow the same pre-lock + in-lock deduplication pattern as the forward-compat check, fixing the asymmetry. These two items are tightly coupled since they both operate in the same lock region.

2. **WP-002 — WorkPackageDetail.last_updated field** (Medium priority): Add `last_updated: z.string().optional()` to `WorkPackageDetailSchema`, populate it on all write paths (status changes, pipeline completions, claim), and simplify the staleness check in `pipeline.ts` to use this field directly instead of the composite proxy. Also switch the staleness comparison from lexicographic string comparison to `Date`-based comparison (technical debt item 1).

3. **WP-003 — Code hygiene: clearSynthesisState helper, import consolidation, semver guard** (Low priority): Extract a `clearSynthesisState(rootIndex)` helper into a shared utility module and replace all 5 call sites. Consolidate the dual `constants.ts` imports in `project-lifecycle.ts` into a single import statement. Add an `isFinite()` guard to the semver comparison in the forward-compat check.

4. **WP-004 — Install jsdom and verify GUI test suite** (Low priority): Run `npm install` in the mcp-server directory to install the declared-but-missing jsdom dependency. Verify that `tests/gui/client-rendering.test.ts` loads and passes. If it fails for reasons beyond the missing dependency, document the findings.

## Rationale

- **WP-001 and WP-002 are medium priority** because they address I/O contention and data model precision respectively. The lock consolidation reduces 3 sequential lock-unlock-reread-rewrite cycles to 1 on legacy ledger first-reads. The `last_updated` field removes a heuristic that could miss modification signals.
- **WP-003 groups three small code hygiene items** that each take <5 minutes individually. They share no behavioral change — purely DRY, import cleanliness, and defensive coding.
- **WP-004 is isolated** because it involves a package installation step and a pre-existing test issue outside the core MCP server logic.
- **Lock consolidation + TOCTOU are coupled:** the TOCTOU asymmetry exists in the same code region (lines 358-437) that the lock consolidation rewrites, so they must be addressed together to avoid merge conflicts and ensure the final pattern is clean.
- **Date-based staleness comparison is bundled with WP-002** because adding `last_updated` to the WP detail schema removes the composite proxy, making it the natural moment to also fix the comparison method.

## Detailed Steps

### WP-001: Lock Consolidation + TOCTOU Symmetry

#### Step 1 — Merge the 3 sequential locks into a single lock scope

**File:** `mcp-server/src/tools/project-lifecycle.ts` (lines 358-437)

Restructure the self-healing write path so that a single `withLock()` call performs:
1. Re-read root index under lock
2. Re-compute healed status
3. Apply field corrections (status, counters, synthesis corruption)
4. Apply legacy synthesis_generated_at repair
5. Apply legacy ledger_version backfill
6. Apply forward-compat warning comment
7. Run pipeline ordering validation and apply warnings
8. Apply synthesis timestamp repair comment
9. Single `writeRootIndex()` call
10. Unlock

The pipeline ordering validation (`validatePipelineOrdering()`) currently reads WP detail files. This must remain inside the lock scope or be pre-computed before the lock with results applied inside. Since it only reads WP details (not the root index), pre-computing is safe — the WP detail files are not modified by self-healing.

#### Step 2 — Add pre-lock deduplication for synthesis timestamp repair

Within the consolidated lock scope, add a deduplication check for the synthesis timestamp repair comment, mirroring the pattern used for the forward-compat warning: check `project_comments.some(c => c.note === repairNote)` before pushing.

#### Step 3 — Update tests

**File:** `mcp-server/tests/tools/project-lifecycle.test.ts`

Update or add tests that verify:
- Self-healing fires exactly one `writeRootIndex()` call when multiple repairs are needed
- The synthesis timestamp repair comment is deduplicated (does not appear twice on repeated `getProjectStatus()` calls)
- All repair operations (field corrections, version backfill, ordering warnings, timestamp repair) are applied atomically

### WP-002: WorkPackageDetail.last_updated Field + Date-Based Staleness

#### Step 4 — Add `last_updated` to `WorkPackageDetailSchema`

**File:** `mcp-server/src/schema/work-package.ts`

Add `last_updated: z.string().optional()` to the schema (line 131, before the closing `}`). This is backward-compatible — existing WP detail files without the field will parse without error.

#### Step 5 — Populate `last_updated` on all WP write paths

**Files:** `mcp-server/src/tools/work-package.ts`, `mcp-server/src/tools/pipeline.ts`

Set `wp.last_updated = now()` in every callback that modifies and writes a WP detail file:
- `updateWorkPackageStatus()` — status transitions
- `claimWorkPackage()` / `beginWork()` — claim operations
- `completePipeline()` / `startPipeline()` — pipeline operations
- `cancelPipeline()` — pipeline cancellation
- `createWorkPackage()` — initial creation (set to `date_created` equivalent)
- `propagateDependencyReblock()` / `propagateDependencyUnblock()` — cascade operations
- Any `updateWorkPackageWithSync()` callback

The `LedgerStore.updateWorkPackageWithSync()` method is the choke point for most WP writes. If all writes go through it, adding `wp.last_updated = now()` inside the store method itself (after the callback) would be the most robust approach. Evaluate whether this is feasible; if so, it eliminates the need to touch every individual call site.

#### Step 6 — Simplify staleness check in `completePipeline()`

**File:** `mcp-server/src/tools/pipeline.ts` (lines 399-414)

Replace the composite proxy:
```typescript
// Before (composite proxy)
const candidates: string[] = [];
if (depWp.status_changed_at) candidates.push(depWp.status_changed_at);
const lastPipelineEnd = depWp.pipelines.filter((p) => p.completed_at).at(-1)?.completed_at;
if (lastPipelineEnd) candidates.push(lastPipelineEnd);
if (candidates.length > 0) {
  depStalenessMap.set(depId, [...candidates].sort().at(-1));
}
```

With the direct field:
```typescript
// After (direct field)
if (depWp.last_updated) {
  depStalenessMap.set(depId, depWp.last_updated);
}
```

#### Step 7 — Switch to Date-based comparison

**File:** `mcp-server/src/tools/pipeline.ts` (line 490)

Replace lexicographic comparison:
```typescript
// Before
if (depLastModified && depLastModified > pipeline.started_at) {
```

With Date-based comparison:
```typescript
// After
if (depLastModified && new Date(depLastModified).getTime() > new Date(pipeline.started_at).getTime()) {
```

Alternatively, use the existing `parseTimestamp()` utility from `mcp-server/src/utils/timestamp.ts` if it returns a comparable value.

#### Step 8 — Add tests for last_updated lifecycle

**Files:** `mcp-server/tests/schema/work-package.test.ts` (or new), `mcp-server/tests/tools/pipeline.test.ts`

- Schema test: `last_updated` parses when present, absent field still parses
- Integration test: create WP -> claim -> start pipeline -> complete pipeline -> verify `last_updated` is set at each stage
- Staleness test: verify the simplified check uses `last_updated` directly and the Date-based comparison works correctly with edge-case timestamps

### WP-003: Code Hygiene (clearSynthesisState, Import Consolidation, Semver Guard)

#### Step 9 — Extract `clearSynthesisState()` helper

**File:** `mcp-server/src/utils/workflow-helpers.ts` (NEW export, existing file)

Add a helper function:
```typescript
export function clearSynthesisState(rootIndex: RootIndex): void {
  rootIndex.synthesis_generated = false;
  rootIndex.synthesis_generated_at = null;
}
```

#### Step 10 — Replace all 5 inline clearing sites with the helper

**Files:**
- `mcp-server/src/tools/project-lifecycle.ts` line 375-376
- `mcp-server/src/tools/work-package.ts` lines 408-409, 873-874, 1104-1105
- `mcp-server/src/utils/project-reset.ts` lines 435-436

Replace each `synthesis_generated = false; synthesis_generated_at = null;` pair with `clearSynthesisState(rootIndex)` (adjusting the variable name as needed per call site).

#### Step 11 — Consolidate dual constants.ts imports

**File:** `mcp-server/src/tools/project-lifecycle.ts` (lines 4 and 12)

Merge:
```typescript
import { PLAN_ARCHIVE_FILENAME, SYNTHESIS_ARCHIVE_FILENAME, SPEC_VERSION } from '../utils/constants.js';
// ... (line 12)
import { AGENT_ROLES } from '../utils/constants.js';
```

Into a single import:
```typescript
import { PLAN_ARCHIVE_FILENAME, SYNTHESIS_ARCHIVE_FILENAME, SPEC_VERSION, AGENT_ROLES } from '../utils/constants.js';
```

#### Step 12 — Add `isFinite()` guard to semver comparison

**File:** `mcp-server/src/tools/project-lifecycle.ts` (line 345)

Guard the parsed segments:
```typescript
const [lMaj, lMin, lPat] = rootIndex.ledger_version.split('.').map(Number);
const [sMaj, sMin, sPat] = SPEC_VERSION.split('.').map(Number);
// Guard against malformed versions (e.g., "2.5.0-beta" -> NaN)
if (![lMaj, lMin, lPat, sMaj, sMin, sPat].every(isFinite)) {
  // Treat malformed version as not-newer — skip forward-compat warning
} else {
  // ... existing comparison logic
}
```

#### Step 13 — Add tests for the new helper and guard

**Files:** `mcp-server/tests/utils/workflow-helpers.test.ts`, `mcp-server/tests/tools/project-lifecycle.test.ts`

- `clearSynthesisState()` unit test: verify both fields are set correctly
- Semver guard test: verify `"2.5.0-beta"` does not trigger a false forward-compat warning and does not throw
- Semver guard test: verify `"3.0.0"` still correctly triggers the forward-compat warning

### WP-004: Install jsdom and Verify GUI Tests

#### Step 14 — Run npm install to sync declared dependencies

**Directory:** `mcp-server/`

Run `npm install` to install the declared-but-missing `jsdom` dependency from `package.json` devDependencies.

#### Step 15 — Verify client-rendering.test.ts passes

Run `npx vitest run tests/gui/client-rendering.test.ts` and confirm it loads and passes. If it fails for reasons beyond the missing dependency (e.g., incompatible jsdom version, missing DOM APIs), document findings and fix if within scope.

#### Step 16 — Run full test suite to confirm no regressions

Run `npx vitest run` and confirm the full suite passes including the previously-failing GUI test.

## Dependencies

- WP-001 (lock consolidation) is independent — no dependencies
- WP-002 (last_updated field) is independent — no dependencies
- WP-003 (code hygiene) is independent — no dependencies
- WP-004 (jsdom install) is independent — no dependencies
- All 4 WPs can be executed in parallel

## Required Components

- `mcp-server/src/tools/project-lifecycle.ts` — lock consolidation, import merge, semver guard (WP-001, WP-003)
- `mcp-server/src/schema/work-package.ts` — `last_updated` field addition (WP-002)
- `mcp-server/src/tools/pipeline.ts` — staleness simplification + Date comparison (WP-002)
- `mcp-server/src/tools/work-package.ts` — `last_updated` population, clearSynthesisState calls (WP-002, WP-003)
- `mcp-server/src/utils/workflow-helpers.ts` — `clearSynthesisState()` helper (WP-003)
- `mcp-server/src/utils/project-reset.ts` — clearSynthesisState call (WP-003)
- `mcp-server/src/utils/constants.ts` — no changes needed (already correct)
- `mcp-server/package.json` — no changes needed (jsdom already declared) (WP-004)
- Test files across `mcp-server/tests/` (all WPs)

## Assumptions

- The `validatePipelineOrdering()` function in project-lifecycle.ts reads WP detail files but does not modify the root index, making it safe to pre-compute before the consolidated lock
- `LedgerStore.updateWorkPackageWithSync()` is the primary choke point for WP detail writes; if `last_updated` can be set there, individual call sites do not need modification
- The `jsdom` dependency failure is solely due to `npm install` not having been run (the package is already declared in package.json)
- The `now()` utility from `mcp-server/src/utils/timestamp.ts` always returns Z-terminated ISO 8601 strings

## Constraints

- All schema changes must remain backward-compatible (`.optional()`)
- Lock consolidation must preserve the same observable behavior: all the same comments, repairs, and backfills must still fire
- The `clearSynthesisState()` helper must be imported from a utility module, not defined inline in multiple files
- The `last_updated` field on WP details is purely additive — existing WP files without it must continue to parse
- No behavioral changes to any PASS/FAIL pipeline outcomes

## Out of Scope

- GUI dashboard changes to display the new `last_updated` field
- Replacing all string timestamp comparisons across the entire codebase with Date-based (only the staleness check is targeted)
- Adding `last_updated` to `WorkPackageSummarySchema` (root index) — this is a heavier change that would require updating all summary write paths
- Upgrading the jsdom version if the declared version works
- Manifest document updates (deferred to the Documentation pipeline stage)

## Acceptance Criteria

1. `getProjectStatus()` self-healing acquires at most 1 lock (down from 3) when multiple repairs are needed
2. The synthesis timestamp repair comment is deduplicated using the same pre-lock + in-lock pattern as the forward-compat warning
3. `WorkPackageDetailSchema` includes `last_updated: z.string().optional()`
4. `last_updated` is populated on every WP detail write path
5. The staleness check in `completePipeline()` uses `wp.last_updated` directly instead of the composite proxy
6. The staleness comparison uses `Date`-based comparison instead of lexicographic string comparison
7. `clearSynthesisState()` is exported from `workflow-helpers.ts` and used at all 5 synthesis-clearing sites
8. The dual `constants.ts` imports in `project-lifecycle.ts` are consolidated into a single import
9. The semver comparison in the forward-compat check handles pre-release segments (e.g., `"2.5.0-beta"`) gracefully without producing false results
10. `jsdom` is installed and `tests/gui/client-rendering.test.ts` loads successfully
11. All existing tests continue to pass
12. New tests cover: single-lock self-healing, synthesis repair deduplication, last_updated lifecycle, Date-based staleness comparison, clearSynthesisState helper, semver guard edge cases

## Testing Strategy

- **Unit tests:** `clearSynthesisState()` helper, semver `isFinite()` guard with pre-release and valid versions, `last_updated` schema parsing
- **Integration tests:** `getProjectStatus()` self-healing with a spy/counter on `writeRootIndex` to verify single write; `completePipeline()` staleness check with `last_updated` field; full lifecycle confirming `last_updated` is set at each stage
- **Regression tests:** Full test suite run including the previously-failing GUI test
- **Edge case tests:** `"2.5.0-beta"` semver, timestamps at the boundary of Date precision, WP detail files without `last_updated` (backward compat)

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Lock consolidation changes self-healing behavior** | The same operations are performed in the same order, just within a single lock scope. All existing self-healing tests must continue to pass. Add a write-count assertion. |
| **`last_updated` population misses a write path** | Evaluate setting `last_updated` inside `updateWorkPackageWithSync()` as a single choke point. If not feasible, enumerate all WP write call sites systematically. |
| **`clearSynthesisState()` import adds a dependency cycle** | `workflow-helpers.ts` is already imported by the target files. The helper takes a `RootIndex` type param — ensure the import does not create a cycle by importing the type only. |
| **jsdom installation pulls unexpected transitive deps** | The dependency is already declared in package.json with a pinned major version (`^29.0.0`). A standard `npm install` is safe. |
| **Date-based comparison introduces timezone issues** | The `now()` utility guarantees Z-terminated UTC strings. `new Date()` correctly parses ISO 8601 with Z suffix. No timezone ambiguity. |
