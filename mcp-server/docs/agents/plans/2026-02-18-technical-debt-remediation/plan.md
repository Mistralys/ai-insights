# Plan

## Summary

Address all 12 technical debt items identified in the Workflow Hardening synthesis report ([synthesis.md](../2026-02-18-workflow-hardening/synthesis.md)), ordered from high to low priority. The work spans constant consolidation, timestamp format standardization, test hygiene, DRY refactoring of action handlers, documentation of concurrency patterns, and a series of minor code-quality improvements. The goal is to eliminate divergence risks in routing logic, improve spec compliance, and reduce maintenance burden across the codebase.

## Approach / Architecture

The remediation is organized into three priority tiers matching the synthesis report's classification:

1. **High Priority (must address before next release)** — Items that carry production-risk: cross-module constant duplication and timestamp format coupling.
2. **Medium Priority (cleanup recommended)** — Items that improve maintainability: test constant imports, DRY action handlers, and concurrency documentation.
3. **Low Priority (defer to future cleanup)** — Seven minor items that improve readability and edge-case resilience but carry no immediate risk.

The architectural change is a new shared module `src/utils/pipeline-maps.ts` that becomes the single source of truth for all pipeline routing constants. All other changes are localized refactors within existing modules.

### Dependency Graph

```
Step 1 (Constants Consolidation)
  └── Step 3 (Test Constant Imports) — depends on Step 1 exporting constants
Step 2 (Timestamp Standardization) — independent
Step 4 (DRY Action Handlers) — independent
Step 5 (Two-Lock Documentation) — independent
Steps 6–12 (Low Priority) — independent, can be done in any order
```

## Rationale

- **Constants first:** The pipeline routing maps (`PIPELINE_PREREQUISITES`, `PIPELINE_AGENT_MAP`, `NEXT_AGENT_MAP`) are duplicated between `pipeline.ts` and `workflow.ts` (via `PIPELINE_TYPE_MAP` and inlined `prerequisiteMap` in `getNextActions`). Divergence here causes silent routing bugs in production. This is the highest-risk item.
- **Timestamps second:** The `now()` utility produces `'YYYY-MM-DD HH:MM:SS'` format (space-separated), which `isStalePipeline` then parses via `new Date()`. This works on V8 but is not guaranteed by the ECMAScript spec. Standardizing to ISO 8601 eliminates portability risk without adding dependencies.
- **Test imports third:** Depends on Step 1 completing the `_internal` export surface. Currently only `workflow.ts` exports `_internal`; `pipeline.ts` does not. Test files in `pipeline.test.ts` and `workflow-handoff.test.ts` inline their own copies of constants.
- **DRY action handlers:** The four `get*Action` functions in `workflow.ts` share identical structure (~110 lines each) differing only by pipeline type string and action name. Extracting shared logic reduces the maintenance surface.
- **Low-priority items:** Each is a targeted, low-risk improvement that can be tackled independently.

## Detailed Steps

### HIGH PRIORITY

#### Step 1: Constants Consolidation

1. **Create `src/utils/pipeline-maps.ts`** with the following exports:
   - `PIPELINE_PREREQUISITES: Record<string, string | null>` — pipeline ordering map (currently at [pipeline.ts L13–18](../../../src/tools/pipeline.ts#L13))
   - `PIPELINE_AGENT_MAP: Record<string, string>` — pipeline-type → agent-role mapping (currently at [pipeline.ts L24–29](../../../src/tools/pipeline.ts#L24))
   - `NEXT_AGENT_MAP: Record<string, string>` — pipeline-type → next-agent routing (currently at [pipeline.ts L35–40](../../../src/tools/pipeline.ts#L35))
   - `AGENT_PIPELINE_MAP: Record<string, string>` — inverse of `PIPELINE_AGENT_MAP` (agent → pipeline type), replacing `PIPELINE_TYPE_MAP` in [workflow.ts L26–31](../../../src/tools/workflow.ts#L26)

2. **Update `src/tools/pipeline.ts`:**
   - Remove local definitions of `PIPELINE_PREREQUISITES`, `PIPELINE_AGENT_MAP`, `NEXT_AGENT_MAP` (lines 13–40)
   - Add import from `../utils/pipeline-maps.js`

3. **Update `src/tools/workflow.ts`:**
   - Remove local `PIPELINE_TYPE_MAP` (lines 26–31)
   - Import `AGENT_PIPELINE_MAP` (or `PIPELINE_AGENT_MAP` + invert at use site) from `../utils/pipeline-maps.js`
   - In `getNextActions` (around line 1757): replace inlined `prerequisiteMap` with imported `PIPELINE_PREREQUISITES`
   - Remove any other inlined agent/pipeline maps (`agentNameMap`, `actionNameMap`, `reworkActionMap` around lines 1807–1819) — evaluate if these can be derived from the shared maps or should remain local (they contain action-name strings, not routing logic, so they may stay local)

4. **Export via `_internal`** from `pipeline-maps.ts` for test consumption (or export directly since it's a utility module)

5. **Update existing tests** that import from `_internal` to verify constants are still accessible

6. **Verify:** Run `npm test` — all 129 tests pass with zero regressions

#### Step 2: Timestamp Standardization

1. **Update `src/utils/timestamp.ts`:**
   - Change `now()` to return ISO 8601 format: `'YYYY-MM-DDTHH:MM:SS'` (replace the space with `'T'`)
   - Remove the `.replace('T', ' ')` logic currently baked into the function
   - The function currently manually constructs the string, so simply change the template literal separator from `' '` to `'T'`

2. **Update `src/tools/workflow.ts` — `isStalePipeline`:**
   - The function at line 44 already uses `new Date(pipeline.started_at)` which parses ISO 8601 natively — no change needed here
   - Verify no other code depends on the space-separated format via grep for timestamp parsing patterns

3. **Audit all timestamp consumers:**
   - `LedgerStore` reads/writes timestamps — these flow through `now()` and are stored in JSON; the format change is transparent to JSON serialization
   - `tests/utils/timestamp.test.ts` — update expected format assertion from `'YYYY-MM-DD HH:MM:SS'` to `'YYYY-MM-DDTHH:MM:SSZ'` or `'YYYY-MM-DDTHH:MM:SS'`
   - Search for any regex or string matching on timestamp format in tests or source

4. **Migration consideration:** Existing ledger JSON files in the wild contain space-separated timestamps. Two options:
   - **Option A (recommended):** Make `isStalePipeline` and any other parsers tolerant of both formats. `new Date()` already handles ISO 8601 natively, and V8 handles the space format. Add a normalizer function `parseTimestamp(ts: string): Date` that replaces space with `'T'` before parsing.
   - **Option B:** Write a migration script. Heavier; less practical since ledger files are ephemeral project artifacts.

5. **Verify:** Run `npm test` — all tests pass

### MEDIUM PRIORITY

#### Step 3: Test File Constant Imports

*Depends on Step 1 completion.*

1. **Update `src/tools/pipeline.ts`:**
   - Add `_internal` export containing references to the imported constants from `pipeline-maps.ts`, plus any pure helper functions used in tests
   - Pattern: `export const _internal = { PIPELINE_PREREQUISITES, PIPELINE_AGENT_MAP, NEXT_AGENT_MAP };`

2. **Refactor `tests/tools/pipeline.test.ts`:**
   - Remove inlined `PIPELINE_PREREQUISITES` (line 19) and `PIPELINE_AGENT_MAP` (line 26)
   - Import from `../../src/tools/pipeline.js` via `_internal`
   - Update all test references to use imported constants

3. **Refactor `tests/tools/workflow-handoff.test.ts`:**
   - Remove inlined `PIPELINE_AGENT_MAP_LOCAL` (line 425) and `NEXT_AGENT_MAP_LOCAL` (line 431)
   - Import from `../../src/tools/workflow.js` via `_internal` (which should re-export from `pipeline-maps.ts`)
   - Update all test references

4. **Verify:** Run `npm test` — all tests pass, no inlined constant copies remain in test files

#### Step 4: DRY Refactor — Action Handlers

1. **In `src/tools/workflow.ts`, create two higher-order helper functions:**

   ```typescript
   function extractStalePipelineAction(
     wpDetail: WorkPackageDetail,
     pipelineType: string,
     wpId: string
   ): ActionResult | null
   ```
   - Encapsulates the `wpDetail.pipelines.find(p => p.type === pipelineType && isStalePipeline(p))` pattern
   - Returns the `RESUME_OR_CANCEL` action object or `null`

   ```typescript
   function extractReworkAction(
     wpDetail: WorkPackageDetail,
     pipelineType: string,
     reworkActionName: string,
     wpId: string
   ): ActionResult | null
   ```
   - Encapsulates the `isMostRecentPipelineFail(wpDetail.pipelines, pipelineType)` check
   - Returns the appropriate REWORK action object or `null`

2. **Refactor all four action handlers** (`getDeveloperAction` at L290, `getQaAction` at L404, `getReviewerAction` at L514, `getDocumentationAction` at L626) to call these helpers instead of inlining the logic

3. **Preserve unique per-handler logic:** `getDeveloperAction` uses `hasDependencyBlocked` while the others check for prerequisite PASS pipeline — this differentiation must remain

4. **Export both helpers via `_internal`** for testability

5. **Verify:** Run `npm test` — all tests pass

#### Step 5: Two-Lock Pattern Documentation

1. **In `src/tools/work-package.ts`**, add an inline comment above the `propagateDependencyUnblock` call at line 472 (inside `updateWorkPackageStatus`):

   ```typescript
   // DESIGN NOTE: propagateDependencyUnblock acquires its own lock separately
   // from the updateWorkPackageWithSync lock above. This is intentional:
   // - The first lock (updateWorkPackageWithSync) covers the WP status transition
   // - The second lock (inside propagateDependencyUnblock) covers the cascade unblock
   // - Keeping them as two sequential locks avoids holding a lock during the
   //   potentially slow cascade read of multiple WP detail files
   // - The gap between locks is safe because propagateDependencyUnblock is
   //   idempotent: re-running it on an already-unblocked WP is a no-op
   ```

2. **No functional changes** — documentation only

### LOW PRIORITY

#### Step 6: Consolidate `hasDependencyBlocked` / `isBlockedByDependencies`

1. **In `src/tools/workflow.ts`:**
   - `hasDependencyBlocked` (L805) operates on `RootIndex` summaries
   - `isBlockedByDependencies` (L963) operates on `WorkPackageDetail[]`
   - Choose one canonical implementation. Since `isBlockedByDependencies` is used 12 times vs 2 times for `hasDependencyBlocked`, keep `isBlockedByDependencies`
   - Refactor `hasDependencyBlocked` call sites (L332, L1783) to use `isBlockedByDependencies` instead, loading full WP details where needed, OR create an adapter that converts summaries to the expected interface
   - Alternatively, keep both but add a comment explaining why both exist (different parameter granularity)

2. **Verify:** Run `npm test`

#### Step 7: Guard `Math.max(...)` for Large WP Lists

1. **In `src/tools/work-package.ts`** (inside `createWorkPackage`, around line 170):
   - Replace `Math.max(...existingNumbers)` with a loop-based max or `Array.reduce`
   - Current code: `const nextWpNumber = existingNumbers.length > 0 ? Math.max(...existingNumbers) + 1 : 1;`
   - This hits `RangeError` if spread exceeds ~65k arguments (theoretical for this tool, but cheap to fix)

   ```typescript
   const nextWpNumber = existingNumbers.length > 0
     ? existingNumbers.reduce((max, n) => Math.max(max, n), 0) + 1
     : 1;
   ```

2. **Verify:** Run `npm test`

#### Step 8: End-to-End WP ID Test via `createWorkPackage`

1. **In `tests/utils/wp-id.test.ts`:**
   - Add an integration-style test that calls `createWorkPackage` (or its internal logic) and verifies the generated WP ID
   - Verify gap-resilience: create WP-001, WP-002, delete WP-002 entry, create again → expect WP-003

2. **Verify:** Run `npm test`

#### Step 9: Comment on `getDeveloperHandoff` / `isMostRecentPipelineFail`

1. **In `src/tools/workflow.ts`** at `getDeveloperHandoff` (L1029):
   - Add a comment explaining why it does not use `isMostRecentPipelineFail` (e.g., because it handles REWORK differently at the Developer level, or because it checks implementation pipeline status directly)

2. **No functional changes**

#### Step 10: Replace `.reverse().find()` with `.findLast()`

1. **In `src/tools/pipeline.ts`** at lines 227, 340, and 405:
   - Replace `[...wp.pipelines].reverse().find(...)` with `wp.pipelines.findLast(...)` (available in ES2023+ / Node 18+)
   - Alternatively, use `.filter(...).at(-1)` if targeting older Node versions
   - Eliminates unnecessary array copy + reverse

2. **Verify:** Run `npm test`

#### Step 11: Comment on `continue` in `getNextActions`

1. **In `src/tools/workflow.ts`** at line 1775 (inside `getNextActions`):
   - Add inline comment explaining why `continue` skips further action evaluation after detecting a stale pipeline:

   ```typescript
   // A stale pipeline takes priority — skip new-work and rework checks for
   // this WP so the agent focuses on resolving the stale pipeline first.
   continue;
   ```

2. **No functional changes**

#### Step 12: Auto-List Registered Tools in `index.ts`

1. **In `src/index.ts`** (around line 65):
   - The stderr log currently lists tools manually. Consider replacing with dynamic tool listing from the MCP server's registered tool set after all `register()` calls complete
   - If the MCP SDK does not expose a `listTools()` method, keep the manual list but add a comment noting it should be updated when tools are added/removed
   - Low value — the manual list was already updated in WP-005

2. **Verify:** Build succeeds

## Dependencies

- Step 3 depends on Step 1 (constants must be exported before tests can import them)
- All other steps are independent and can be executed in parallel or any order within their priority tier
- No external dependencies or new packages required (ISO 8601 change avoids `date-fns`)

## Required Components

### New Files
- `src/utils/pipeline-maps.ts` — shared pipeline routing constants (Step 1)

### Modified Files
- `src/tools/pipeline.ts` — remove local constants, add import, add `_internal` export (Steps 1, 3, 10)
- `src/tools/workflow.ts` — remove `PIPELINE_TYPE_MAP`, import shared constants, extract action handler helpers, add comments (Steps 1, 4, 6, 9, 11)
- `src/tools/work-package.ts` — add two-lock comment, guard `Math.max` (Steps 5, 7)
- `src/utils/timestamp.ts` — change format to ISO 8601 (Step 2)
- `src/index.ts` — optional: dynamic tool listing (Step 12)
- `tests/tools/pipeline.test.ts` — import constants from `_internal` (Step 3)
- `tests/tools/workflow-handoff.test.ts` — import constants from `_internal` (Step 3)
- `tests/utils/timestamp.test.ts` — update expected timestamp format (Step 2)
- `tests/utils/wp-id.test.ts` — add end-to-end WP ID test (Step 8)

## Assumptions

- The project targets Node.js 18+ (required for `.findLast()` in Step 10; if not, use `.filter(...).at(-1)`)
- Existing ledger JSON files with space-separated timestamps are ephemeral project artifacts; backward-compatible parsing (Option A in Step 2) is sufficient — no migration script needed
- The `_internal` export pattern established in `workflow.ts` is the project standard for exposing internals to tests
- The MCP SDK does not provide a `server.listTools()` API for dynamic tool listing (verifiable at implementation time)

## Constraints

- All changes must maintain 100% test pass rate (currently 129 tests)
- No new runtime dependencies may be added (per project convention)
- All file I/O must continue using `atomicWriteJson()` and `withLock()` patterns
- STDIO discipline: no `stdout` logging
- Backward compatibility: ledger JSON files created with v1.3.0 timestamps must remain parseable

## Out of Scope

- New MCP tools or features
- API surface changes (all changes are internal refactoring)
- Performance optimization beyond the `Math.max` guard
- Dependency cycle detection (mentioned in synthesis as future consideration)
- `assigned_to` consistency self-healing (mentioned in synthesis as future consideration)
- Generalizing the agent handoff pattern to other workflows

## Acceptance Criteria

### Step 1: Constants Consolidation
- `src/utils/pipeline-maps.ts` exists and exports `PIPELINE_PREREQUISITES`, `PIPELINE_AGENT_MAP`, `NEXT_AGENT_MAP`, and `AGENT_PIPELINE_MAP`
- `pipeline.ts` and `workflow.ts` import from `pipeline-maps.ts` — no local constant definitions remain
- Inlined `prerequisiteMap` in `getNextActions` is replaced with imported constant
- All 129+ tests pass

### Step 2: Timestamp Standardization
- `now()` returns ISO 8601 format (`'YYYY-MM-DDTHH:MM:SS'`)
- A `parseTimestamp()` helper exists that handles both old (space) and new (T) formats
- `isStalePipeline` uses `parseTimestamp()` for robust parsing
- `timestamp.test.ts` updated to expect new format
- All tests pass

### Step 3: Test Constant Imports
- `pipeline.ts` exports `_internal` with routing constants
- `pipeline.test.ts` imports constants from `_internal` — no inlined copies
- `workflow-handoff.test.ts` imports constants from `_internal` — no inlined copies
- All tests pass

### Step 4: DRY Action Handlers
- `extractStalePipelineAction()` and `extractReworkAction()` helpers exist in `workflow.ts`
- All four `get*Action` functions use these helpers
- Handler-specific logic (e.g., dependency checks in `getDeveloperAction`) is preserved
- Both helpers exported via `_internal`
- All tests pass

### Step 5: Two-Lock Documentation
- Inline comment exists above `propagateDependencyUnblock` call in `updateWorkPackageStatus`
- Comment explains the sequential lock pattern, why it's safe (idempotency), and why it's preferred (avoids holding lock during cascade)

### Steps 6–12
- Each step's code change is applied
- All tests pass after each step
- No functional behavior changes (except Step 7's `Math.max` guard and Step 10's `findLast` optimization)

## Testing Strategy

- **Unit tests:** All existing 129 tests must continue passing after every step
- **Step 1:** Verify that importing from `pipeline-maps.ts` produces identical constant values to the previously inlined versions
- **Step 2:** Update `timestamp.test.ts` format assertion; add test for `parseTimestamp()` accepting both formats; verify `isStalePipeline` with both timestamp formats
- **Step 3:** Tests continue to pass after switching from inlined constants to imports — if a constant value drifts, the test will now catch it automatically
- **Step 4:** Existing action handler tests in `workflow-handoff.test.ts` and `pipeline.test.ts` validate that extracted helpers produce identical results
- **Step 7:** Add test for WP ID generation with >100 work packages (loop-based max)
- **Step 8:** Add integration test for WP ID generation through `createWorkPackage`
- **Step 10:** Existing pipeline tests cover the `.findLast()` behavior change
- **Regression:** Run full `npm test` after every step to catch unintended breakage

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Constants refactor breaks import paths** | Run full test suite after Step 1; TypeScript compiler will catch missing imports at build time |
| **Timestamp format change breaks existing ledger files** | Implement `parseTimestamp()` that handles both formats (Option A); old files remain parseable |
| **`.findLast()` not available on target Node version** | Verify Node version in CI; fall back to `.filter(...).at(-1)` if Node < 18 |
| **Action handler extraction changes subtle behavior** | Existing tests for `getNextAction` and `getNextActions` cover all handler code paths; run before and after |
| **Two test files import from `_internal` which is not a stable API** | Document `_internal` as test-only; prefix with underscore convention already signals this |
| **Inlined maps in `getNextActions` (action names, rework names) are mistakenly extracted** | Only extract routing/prerequisite constants; keep action-name/rework-name maps local since they contain display strings, not routing logic |
