# Plan

## Plan Audit Cycles
- Audits: 2 — Plan Auditor v1.5.0
- Architectural Reviews: none — Plan Architect Reviewer v1.6.0

## Prior Project Context

This is the second rework of the `2026-06-05-gui-project-detail-auto-update` project
series. The first rework (`rework-1`) delivered shared `makeProject()` fixtures, source
cleanup, health badge consolidation, and `renderRunsList` extraction across 4 WPs (16/16
pipeline stages PASS, 0 FAIL, 0 rework cycles). Its synthesis identified 8 deferred items
and 4 follow-up recommendations, all of which are addressed by this plan. The repository's
strategic vision emphasises low-friction developer onboarding — improving DX of test
fixtures and reducing cognitive load in large source files aligns directly with the
short-term goal.

## Summary

This rework addresses all 8 deferred items and 4 follow-up recommendations from the
`2026-06-05-gui-project-detail-auto-update-rework-1` synthesis. It delivers four scoped
improvements: (1) a micro-cleanup batch documenting edge cases, adding defensive
null checks, and simplifying guards in `project-detail.js`; (2) strict typing for `MakeProjectOpts` to catch
root-level key typos at compile time; (3) splitting the 1479-line
`project-detail-runs.test.ts` into three focused test files; and (4) decomposing the
1886-line `project-detail.js` into four sub-modules with clear responsibility boundaries.
No new product features are added. All changes are pure internal improvements —
code documentation, defensive guards, type-safety uplift, test organisation, and source
modularisation.

## Architectural Context

All changes are confined to the MCP Server GUI sub-project:

| Path | Role |
|------|------|
| `mcp-server/gui/public/views/project-detail.js` | Primary view: 1886 lines, WPs 1 and 4 touch this file |
| `mcp-server/gui/public/index.html` | Script tag loading order for view files (WP-004) |
| `mcp-server/tests/gui/project-detail-runs.test.ts` | 1479-line test file: WP-003 splits it |
| `mcp-server/tests/gui/helpers/make-project.ts` | Shared fixture factory: WP-002 changes its type |
| `mcp-server/tests/gui/README.md` | Documents helper conventions (WP-002 updates advisory) |
| `mcp-server/tests/gui/project-detail-helpers.test.ts` | Tests for `_findScrollAnchor` and `renderRunsList` |
| `mcp-server/tests/gui/project-detail-*.test.ts` (×7) | All GUI view test files that load `project-detail.js` via `vm.runInThisContext` |

Patterns in use:
- Browser-side view scripts are non-ESM `.js` files loaded via `<script>` tags in
  `index.html`. Functions are accessible via the global scope.
- Test files load view scripts via `vm.runInThisContext(readFileSync(...))` in `beforeAll`.
  Each test file independently loads the scripts it needs.
- Shared test helpers live in `mcp-server/tests/gui/helpers/` (existing pattern:
  `create-namespaced-project.ts`, `make-project.ts`).
- Module-level helpers are exposed via `globalThis` for direct test access (established
  pattern for `_findScrollAnchor`, `renderRunsList`).

## Approach / Architecture

**WP-001 — Source micro-cleanup batch:**
Perform four targeted edits in `project-detail.js`:
(a) Document the inner `!row.querySelector('.synthesis-link')` guard in
`_patchSynthesisLink` (line 415) as a live code path. When `synthesis_generated` is
`false`, `renderProjectDetail` pre-renders `#synthesis-link-row` as an empty hidden div
(no `.synthesis-link` anchor). The guard fires when a poll cycle detects synthesis became
available and populates the anchor. Add a JSDoc comment explaining this edge case.
(b) Add an `if (cleanup)` guard before `_pdLogPreviewCleanups.push(cleanup)` at line 883
to protect against a null/undefined return from `OrchestratorWidgets.renderLogPreview`.
(c) Remove the redundant `scrollAnchor ?` null guard at line 837 in `renderRunsList` —
`_findScrollAnchor` always returns a non-null `Element` (falls back to
`document.documentElement`). Replace the conditional with a direct assignment.
(d) Verify whether the redundant outer `_pdLogPreviewCleanups` drain referenced in
synthesis item #2 (originally at the pollQueue structural-change branch) still exists.
Current codebase shows only 2 drain sites (line 832 inside `renderRunsList`, line 890
at the start of `renderProjectDetail`). If no redundant drain is found, document the
drain invariant with a JSDoc comment confirming the two drain sites and their
responsibilities.

**WP-002 — MakeProjectOpts strict typing:**
Replace the `[key: string]: unknown` index signature in `MakeProjectOpts` with an
explicit union of known root-level fields from the fixture shape. The current fixture
factory returns a fixed set of root keys (`meta`, `work_packages`, `project_comments`,
`project_name`, `timing`, `server_version`, `ledger_version`, `synthesis_generated`).
The new type lists these explicitly, making typos like `makeProject({ statues: 'COMPLETE' })`
a compile-time error. Update the JSDoc and `tests/gui/README.md` to remove the
type-safety advisory that was added as an interim mitigation.

**WP-003 — Test file split: project-detail-runs.test.ts:**
Split the 1479-line file into three focused test files, each with its own
`beforeAll`/`beforeEach` setup (following the established pattern in other
`project-detail-*.test.ts` files):

| New File | Describe Blocks Moved | Approx Lines |
|----------|----------------------|--------------|
| `project-detail-runs.test.ts` (trimmed) | "Orchestrator Runs section" + "queue-aware active run" | ~550 |
| `project-detail-resume.test.ts` (new) | "showResumeError helper" + "Resume Run button" | ~380 |
| `project-detail-poll-modes.test.ts` (new) | "Inline edit survives poll ticks" + "Single-interval invariant" + "Modal and archive/unarchive under polling" | ~400 |

Each file independently loads `project-detail.js` via `vm.runInThisContext` and sets up
the same global stubs (`API`, `marked`, `OrchestratorWidgets`, `Router`, `UI`). The
`renderWithAPI` helper is duplicated in each file (it's test-file-specific and small;
extracting it to a shared module adds more coupling than value at this scale). The
`declare global` block is also duplicated per file (TypeScript requires it per-file for
`var` declarations in the global scope).

**WP-004 — project-detail.js module decomposition:**
Split the 1886-line monolith into four files loaded in dependency order via `<script>`
tags. The split follows the file's existing section comment boundaries:

| New File | Contents | Approx Lines |
|----------|----------|-------------|
| `project-detail-helpers.js` | `extractSynopsis`, `STAGE_ABBREV`, `buildPipelineTrack`, `buildRunBadges`, `_findScrollAnchor`, `_snapshotProjectState`, `_diffProjectState` | ~250 |
| `project-detail-orch.js` | `renderOrchToolbar` (145 lines), `renderRunsList` (56 lines), `_orchRunsStructureKey`, `_patchOrchStatusCard` | ~270 |
| `project-detail-modal.js` | `PIPELINE_STAGES`, `showResetModal` (340 lines) | ~350 |
| `project-detail.js` (trimmed) | Module header + `_pdLogPreviewCleanups` var, `renderPlan`, `renderSynthesis`, patch functions (`_patchProjectStatus`, `_patchWpRow`, `_patchSynthesisLink`, `_patchHealthBadge`, `_patchTimingInfo`), `_pollProjectDetail`, `renderProjectDetail`, `globalThis` exports | ~1020 |

Shared module-scoped state:
- `_pdLogPreviewCleanups` is initialised in `project-detail.js` (main) and promoted to
  `globalThis._pdLogPreviewCleanups`. The orch module reads/writes exclusively via the
  `globalThis` binding. To preserve array identity across drain sites (preventing the
  main and orch modules from diverging after a drain), all drain sites use
  `_pdLogPreviewCleanups.length = 0` (in-place mutation) instead of `= []`
  (reassignment). This ensures both the local var in main and the `globalThis` reference
  in orch always point to the same array instance.
- All functions in helper/orch/modal files are implicitly global (non-ESM `<script>` tag
  loading). No additional export mechanism is needed.

HTML loading order in `index.html`:
```html
<script src="/views/project-detail-helpers.js?v=1"></script>
<script src="/views/project-detail-orch.js?v=1"></script>
<script src="/views/project-detail-modal.js?v=1"></script>
<script src="/views/project-detail.js?v=3"></script>
```

Test files must be updated to load all four scripts via `vm.runInThisContext` in the
correct dependency order within their `beforeAll` blocks.

## Rationale

- **Micro-cleanups first (WP-001):** Resolves all low-hanging deferred items before the
  structural changes in WP-003/004. Avoids carrying dead code into the new module
  structure.
- **Strict typing (WP-002):** The `[key: string]: unknown` escape hatch was an intentional
  DX tradeoff when the fixture API was new. Now that all 7 test files use the shared
  helper, the strictness benefit outweighs the minor ergonomic cost of listing extra keys
  explicitly.
- **Test file split before source split (WP-003 → WP-004):** Splitting the test file first
  means WP-004 updates smaller, focused test files instead of patching one 1479-line
  monolith. Each split test file gets the multi-script loading update independently.
- **Module decomposition (WP-004):** The file's section comments already delineate four
  clear responsibility boundaries. The split formalises them as separate files without
  changing any function signatures, DOM contracts, or test assertions.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Module split granularity | 4 files (helpers, orch, modal, main) | 2 files (main + helpers only); 6 files (one per section comment) | 4 files matches natural responsibility boundaries without over-fragmentation; 2 files still leaves a ~1300-line main; 6 files creates unnecessary load-order complexity |
| `_pdLogPreviewCleanups` sharing | Promote to `globalThis._pdLogPreviewCleanups` + in-place drain via `.length = 0` | Keep in main + pass as parameter; Create a shared state module; globalThis promotion with `= []` reassignment | In-place drain (`.length = 0`) preserves array identity so the local var in main and the `globalThis` reference in orch never diverge; `= []` reassignment would break the drain invariant by creating a new array that the other module doesn't see; parameter-passing requires signature changes across 3 call sites; a state module is over-engineering for a single array |
| `renderWithAPI` sharing across split test files | Duplicate per file | Extract to `tests/gui/helpers/render-with-api.ts` | At ~50 lines the helper is small enough that duplication is lower-cost than an import dependency that couples all test files; each file can evolve its stub shape independently |
| MakeProjectOpts strictness | Explicit known-key union | Branded type + runtime check; Keep index signature + lint rule | Explicit keys give compile-time feedback with zero runtime cost; branded type adds unnecessary runtime overhead; lint rule is unenforceable for the index signature pattern |

## Pattern Alignment

- **Shared test helpers in `tests/gui/helpers/`:** Followed. WP-002 modifies the existing
  `make-project.ts` helper.
- **`vm.runInThisContext` script loading per test file:** Followed. WP-003 splits test
  files but each retains its own `beforeAll` loading block.
- **`globalThis` exposure for testable helpers:** Followed. WP-004 promotes
  `_pdLogPreviewCleanups` to `globalThis` following the same pattern used for
  `_findScrollAnchor` and `renderRunsList`.
- **`<script>` tag loading order in `index.html`:** Followed. WP-004 adds 3 new script
  tags before the existing `project-detail.js` tag, following the dependency-first
  convention used by `components.js`, `api-client.js`, etc.
- **Section comment boundaries in view files:** Followed. The split aligns with existing
  `/* ---- §N ---- */` section markers.

## Detailed Steps

### WP-001 — Source micro-cleanup batch

1. Open `mcp-server/gui/public/views/project-detail.js`.
2. **Document live guard in `_patchSynthesisLink`:** Examine lines 410–427. The inner
   `if (!row.querySelector('.synthesis-link') && repo && slug)` guard (lines 415–418) is
   a live code path: when `synthesis_generated` is `false`, `renderProjectDetail`
   pre-renders `#synthesis-link-row` as an empty hidden div (`<div id="synthesis-link-row"
   style="display:none"></div>`) with no `.synthesis-link` anchor. When a poll cycle
   detects synthesis became available, `_patchSynthesisLink(true, repo, slug)` fires and
   the guard populates the anchor. Add a JSDoc comment above the guard explaining this
   edge case and the empty-div pre-render path.
3. **Null guard on cleanup push:** At line 883 (`_pdLogPreviewCleanups.push(cleanup)`),
   wrap in `if (cleanup) { _pdLogPreviewCleanups.push(cleanup); }`.
4. **Simplify scroll anchor guard:** At line 837, replace
   `var savedScrollTop = scrollAnchor ? scrollAnchor.scrollTop : 0;` with
   `var savedScrollTop = scrollAnchor.scrollTop;` (and update the restore line at ~875 to
   remove `if (scrollAnchor)` since the value is always non-null).
5. **Drain invariant documentation:** Verify only 2 drain sites exist (line 832 inside
   `renderRunsList`, line 890 at start of `renderProjectDetail`). Add a JSDoc comment at
   line 70 above `var _pdLogPreviewCleanups = []` documenting the two drain sites and
   their responsibilities (pre-innerHTML-rebuild and pre-full-render).
6. Run `npm test` inside `mcp-server/` — all GUI tests must pass.

### WP-002 — MakeProjectOpts strict typing

1. Open `mcp-server/tests/gui/helpers/make-project.ts`.
2. Replace the `MakeProjectOpts` interface:
   - Remove `[key: string]: unknown`.
   - Add explicit optional fields for all root-level keys that the factory returns:
     `project_comments?: unknown[]`, `project_name?: string`, `server_version?: unknown`,
     `ledger_version?: unknown`.
3. Update the JSDoc block: remove the "Type-safety tradeoff" section (lines 49–55) and
   replace with a note confirming full type coverage.
4. Open `mcp-server/tests/gui/README.md` and remove the type-safety advisory that was
   added in rework-1.
5. Run `npm run typecheck` inside `mcp-server/` to confirm no type errors across all
   7 test files that import `makeProject`.
6. Run `npm test` inside `mcp-server/` — all tests must pass.

### WP-003 — Test file split: project-detail-runs.test.ts

1. Create `mcp-server/tests/gui/project-detail-resume.test.ts`:
   - Copy the file header comment, imports, `beforeAll`, `beforeEach`, `declare global`
     block, and `renderWithAPI` helper from `project-detail-runs.test.ts`.
   - Move the following describe blocks from `project-detail-runs.test.ts`:
     - `'renderProjectDetail — WP-004: showResumeError helper'` (line 709)
     - `'Resume Run button'` (line 903)
   - Verify the file is self-contained and runs independently.

2. Create `mcp-server/tests/gui/project-detail-poll-modes.test.ts`:
   - Copy the same shared setup infrastructure.
   - Move the following describe blocks from `project-detail-runs.test.ts`:
     - `'WP-005 — Inline edit survives data-only poll ticks (AC-5)'` (line 1082)
     - `'WP-005 — Single-interval invariant across combined↔resume mode transitions (AC-6)'` (line 1244)
     - `'WP-005 — Modal and archive/unarchive remain functional under active polling'` (line 1380)
   - Verify the file is self-contained and runs independently.

3. Trim `project-detail-runs.test.ts`:
   - Remove the moved describe blocks.
   - Verify the remaining file contains only:
     - `'renderProjectDetail — Orchestrator Runs section'` (line 169)
     - `'renderProjectDetail — WP-013: queue-aware active run (AC-1 to AC-5)'` (line 457)
   - Update the file header comment to reflect the narrowed scope.

4. Run `npm test` inside `mcp-server/` — all tests must pass, total test count unchanged.

### WP-004 — project-detail.js module decomposition

1. **Create `mcp-server/gui/public/views/project-detail-helpers.js`:**
   - Move functions: `extractSynopsis`, `STAGE_ABBREV` (constant), `buildPipelineTrack`,
     `buildRunBadges`, `_findScrollAnchor`, `_snapshotProjectState`, `_diffProjectState`.
   - Add a file header comment documenting its role as pure utility functions with no DOM
     side effects (except `_findScrollAnchor` which traverses but doesn't mutate).

2. **Create `mcp-server/gui/public/views/project-detail-orch.js`:**
   - Move functions: `renderOrchToolbar`, `_orchRunsStructureKey`, `_patchOrchStatusCard`,
     `renderRunsList`.
   - `renderRunsList` references `_pdLogPreviewCleanups` — change references to read/write
     `globalThis._pdLogPreviewCleanups` instead of a local var. Change the drain site
     from `_pdLogPreviewCleanups = []` to `globalThis._pdLogPreviewCleanups.length = 0`
     (in-place mutation preserves array identity with the main module's local var).
   - Add a file header comment documenting its role as orchestrator-section rendering.

3. **Create `mcp-server/gui/public/views/project-detail-modal.js`:**
   - Move: `PIPELINE_STAGES` constant and `showResetModal` function.
   - Add a file header comment.

4. **Trim `project-detail.js`:**
   - Remove all moved functions and constants.
   - Change `var _pdLogPreviewCleanups = [];` to also assign to globalThis:
     `var _pdLogPreviewCleanups = []; globalThis._pdLogPreviewCleanups = _pdLogPreviewCleanups;`
   - Change the drain site in `renderProjectDetail` from `_pdLogPreviewCleanups = []` to
     `_pdLogPreviewCleanups.length = 0` (in-place mutation preserves array identity with
     the orch module's `globalThis` reference).
   - Keep: file header comment (update to reference sub-modules), `renderPlan`,
     `renderSynthesis`, patch functions, `_pollProjectDetail`, `renderProjectDetail`,
     `globalThis` exports block.
   - Update `globalThis` exports block to include any newly exposed helpers.
   - Update the file header's DOM Contract documentation to reference which sub-module
     owns which functions.

5. **Update `mcp-server/gui/public/index.html`:**
   - Add three `<script>` tags before the existing `project-detail.js` tag:
     ```html
     <script src="/views/project-detail-helpers.js?v=1"></script>
     <script src="/views/project-detail-orch.js?v=1"></script>
     <script src="/views/project-detail-modal.js?v=1"></script>
     ```
   - Bump the existing `project-detail.js` cache-buster version.

6. **Update all GUI test files that load `project-detail.js`:**
   - In each `project-detail-*.test.ts` file's `beforeAll`, add `readFileSync` and
     `vm.runInThisContext` calls for the three new files, executed before
     `project-detail.js`:
     ```ts
     const helpersJs = readFileSync(join(publicDir, 'views/project-detail-helpers.js'), 'utf-8');
     const orchJs    = readFileSync(join(publicDir, 'views/project-detail-orch.js'),    'utf-8');
     const modalJs   = readFileSync(join(publicDir, 'views/project-detail-modal.js'),   'utf-8');
     // ...existing project-detail.js load...
     
     beforeAll(() => {
       // ...existing stubs...
       vm.runInThisContext(helpersJs);
       vm.runInThisContext(orchJs);
       vm.runInThisContext(modalJs);
       vm.runInThisContext(projectDetailJs);
     });
     ```
   - Files to update (9 total): `project-detail-snapshot.test.ts`,
     `project-detail-diff.test.ts`, `project-detail-poll.test.ts`,
     `project-detail-scroll.test.ts`, `project-detail-runs.test.ts`,
     `project-detail-resume.test.ts` (new from WP-003),
     `project-detail-poll-modes.test.ts` (new from WP-003),
     `project-detail-auto-update.test.ts`, `project-detail-helpers.test.ts`.

7. Run `npm test` inside `mcp-server/` — all tests must pass, total count unchanged.

## Dependencies

- WP-001: no dependencies
- WP-002: no dependencies
- WP-003: no dependencies
- WP-004: depends on WP-001 (both modify `project-detail.js`; WP-001's cleanups should
  land before the file is decomposed) and WP-003 (test files should be split before
  updating their script-loading blocks to avoid patching a 1479-line file)

## Required Components

- `mcp-server/gui/public/views/project-detail.js` — modified (WP-001, WP-004)
- `mcp-server/gui/public/views/project-detail-helpers.js` — **new** (WP-004)
- `mcp-server/gui/public/views/project-detail-orch.js` — **new** (WP-004)
- `mcp-server/gui/public/views/project-detail-modal.js` — **new** (WP-004)
- `mcp-server/gui/public/index.html` — modified (WP-004)
- `mcp-server/tests/gui/helpers/make-project.ts` — modified (WP-002)
- `mcp-server/tests/gui/README.md` — modified (WP-002)
- `mcp-server/tests/gui/project-detail-runs.test.ts` — modified (WP-003, WP-004)
- `mcp-server/tests/gui/project-detail-resume.test.ts` — **new** (WP-003)
- `mcp-server/tests/gui/project-detail-poll-modes.test.ts` — **new** (WP-003)
- `mcp-server/tests/gui/project-detail-*.test.ts` (×9) — modified (WP-004, script loading)

## Assumptions

- When `synthesis_generated` is `false`, `renderProjectDetail` pre-renders
  `#synthesis-link-row` as an empty hidden div with no `.synthesis-link` anchor. The inner
  guard in `_patchSynthesisLink` is therefore a live code path that fires when a poll cycle
  detects synthesis became available. WP-001 step 2 documents this edge case with a JSDoc
  comment instead of removing the guard.
- All existing call sites of `makeProject()` use only the named fields (`meta`,
  `work_packages`, `synthesis_generated`, `timing`) plus standard root-level overrides.
  No call site relies on the `[key: string]: unknown` escape hatch for non-standard keys.
- The `<script>` tag loading order in `index.html` is the sole mechanism for dependency
  resolution between view files — no dynamic `import()` or module bundler is used.

## Constraints

- All changes are confined to `mcp-server/gui/` and `mcp-server/tests/gui/`.
- No production behaviour changes — all edits are internal refactoring.
- Test count must remain unchanged (currently 3214 across 107 files) or increase. No test
  may be removed.
- The `globalThis._pdLogPreviewCleanups` promotion in WP-004 is the only new global
  variable introduced.

## Out of Scope

- E2E browser testing (deferred from the original project series).
- Adding new product features or UI changes.
- Splitting other large view files (e.g., `project-list.js`) — scoped to
  `project-detail.js` only.
- Changing the GUI from non-ESM `<script>` loading to an ESM bundler.
- `var healthBadge` cleanup (synthesis item #6) — the variable is still referenced in both
  the `if (healthBadge)` guard and the `.catch()` handler; it is not dead code.

## Acceptance Criteria

- AC-1: All 4 micro-cleanup edits from WP-001 are applied; live `_patchSynthesisLink`
  guard is documented with a JSDoc comment explaining the empty-div pre-render edge case;
  cleanup push is guarded; scroll anchor guard is simplified; drain invariant is
  documented.
- AC-2: `MakeProjectOpts` has no index signature; TypeScript rejects unknown keys at
  compile time; all 7 importing test files pass typecheck.
- AC-3: `project-detail-runs.test.ts` is split into 3 files; each file runs independently;
  total test count is unchanged.
- AC-4: `project-detail.js` is decomposed into 4 files; `index.html` loads them in correct
  order; all GUI tests pass with the multi-script loading pattern.
- AC-5: Full test suite passes (`npm test` in `mcp-server/`) with zero failures after each
  WP.
- AC-6: No new production dependencies added.

## Testing Strategy

Each WP is validated by running the existing test suite (`npm test` inside `mcp-server/`).
No new test files are created for WP-001 (existing tests cover the affected functions).
WP-002 is validated by `npm run typecheck` (compile-time strictness) and `npm test`
(runtime correctness). WP-003 creates 2 new test files by moving existing tests — test
count remains constant. WP-004 validates that all 9 GUI test files correctly load the
split scripts by running the full suite.

## Test Plan

- `mcp-server/tests/gui/project-detail-helpers.test.ts` — existing `_findScrollAnchor`
  tests validate WP-001 scroll guard simplification — AC-1
- `mcp-server/tests/gui/project-detail-auto-update.test.ts` — existing auto-update tests
  validate that `_patchSynthesisLink` still works after guard documentation — AC-1
- `mcp-server/tests/gui/project-detail-runs.test.ts` — existing `renderRunsList` tests
  validate cleanup push guard and drain behaviour — AC-1
- `npm run typecheck` (mcp-server) — validates strict `MakeProjectOpts` rejects unknown
  keys across all 7 importing test files — AC-2
- `mcp-server/tests/gui/project-detail-resume.test.ts` — **new file** containing moved
  describe blocks; all tests must pass independently — AC-3
- `mcp-server/tests/gui/project-detail-poll-modes.test.ts` — **new file** containing moved
  describe blocks; all tests must pass independently — AC-3
- `mcp-server/tests/gui/project-detail-runs.test.ts` (trimmed) — remaining 2 describe
  blocks must pass independently — AC-3
- All 9 `project-detail-*.test.ts` files — must successfully load 4 split scripts via
  `vm.runInThisContext` in correct order and pass all assertions — AC-4
- Full suite `npm test` — 3214+ tests passing, 0 failures — AC-5

## Documentation Updates

- `mcp-server/tests/gui/README.md` — remove `MakeProjectOpts` type-safety advisory
  (WP-002); add note about multi-script loading pattern for split view files (WP-004)
- `mcp-server/docs/agents/project-manifest/file-tree.md` — add entries for
  `project-detail-helpers.js`, `project-detail-orch.js`, `project-detail-modal.js`
  (WP-004); add entries for `project-detail-resume.test.ts`,
  `project-detail-poll-modes.test.ts` (WP-003); update `project-detail.js` annotation
  (WP-004)
- `mcp-server/docs/agents/project-manifest/api-surface.md` — update the
  `views/project-detail.js` entry to reflect the new file→function mapping after
  decomposition: `renderPlan` and `renderSynthesis` stay in `project-detail.js`;
  `extractSynopsis` moves to `project-detail-helpers.js`; `showResetModal` moves to
  `project-detail-modal.js` (WP-004)

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **`_patchSynthesisLink` inner guard edge case missed during documentation** | The guard is confirmed live (fires when `synthesis_generated` changes from `false` to `true` during polling). WP-001 step 2 documents this with a JSDoc comment. If additional edge cases surface during implementation, extend the JSDoc rather than removing the guard. |
| **`makeProject` call sites use unknown keys** | Run `npm run typecheck` after the type change. Any call site using non-standard keys will produce a compile error that guides the fix. |
| **Script load order bugs after decomposition** | WP-004 step 7 runs the full test suite. The `vm.runInThisContext` pattern in tests mirrors the `<script>` tag order in `index.html`, so any missing dependency surfaces immediately as a ReferenceError. |
| **`_pdLogPreviewCleanups` globalThis promotion causes array identity divergence** | All drain sites use `.length = 0` (in-place mutation) instead of `= []` (reassignment). This ensures the local var in main and the `globalThis` reference in orch always point to the same array instance. Existing tests that mock `_pdLogPreviewCleanups` directly will continue to work because the local var is never reassigned. |
| **Test file split introduces subtle import/setup differences** | Each new test file copies setup verbatim from the original. The first validation step for each new file is running it independently to catch any missing stubs. |
