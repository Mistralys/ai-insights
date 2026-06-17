# Plan

## Plan Audit Cycles
- Audits: 1 — Plan Auditor v1.5.0
- Architectural Reviews: none — Plan Architect Reviewer v1.6.0

## Prior Project Context

The previous project (`2026-06-05-gui-project-detail-auto-update`) delivered a fully
dynamic GUI project detail page via 5-second polling, a snapshot/diff engine, and
compare-and-swap DOM patching. The synthesis identified six actionable follow-up items,
grouped into four coherent work areas addressed by this rework. The highest-priority item
is extracting a shared `makeProject()` fixture module to resolve helper divergence that
has accumulated across 6 test files. The prior synthesis also flagged `buildRunBadges`
raw badge strings, a dead injection branch in `_patchSynthesisLink`, a duplicated health
badge render block in the initial render path, and a deeply nested `renderRunsList`
closure that cannot be unit-tested in isolation.

## Summary

This rework addresses all actionable recommendations and medium/low-priority deferred
items from the `2026-06-05-gui-project-detail-auto-update` synthesis. It delivers four
scoped improvements across the GUI source and test suite: (1) a shared `makeProject()`
fixture helper replacing six independent and divergent copies; (2) a source cleanup
batch removing dead code in `_patchSynthesisLink`, migrating `buildRunBadges` raw badge
strings to `UI.badge()`, and documenting the `_pdLogPreviewCleanups` drain invariant;
(3) health badge consolidation so the initial render delegates to `_patchHealthBadge`
instead of duplicating inline logic; and (4) extraction of `renderRunsList` as a
module-level function with a testable `_findScrollAnchor` helper. No external
dependencies are added. The E2E browser test is out of scope.

## Architectural Context

All changes are confined to the MCP Server GUI sub-project:

| Path | Role |
|------|------|
| `mcp-server/gui/public/views/project-detail.js` | Primary view: all four WPs touch this file |
| `mcp-server/tests/gui/project-detail-*.test.ts` (×6) | View test files: all use local `makeProject()` |
| `mcp-server/tests/gui/helpers/` | Existing shared helpers directory (1 file today) |
| `mcp-server/tests/gui/helpers/create-namespaced-project.ts` | Pattern for shared fixture helpers |
| `mcp-server/gui/public/components.js` | `UI.badge(type, label)` — target for buildRunBadges migration |
| `mcp-server/tests/gui/README.md` | Documents helper conventions and setup-file loading order |

Patterns in use:
- Shared test helpers live in `mcp-server/tests/gui/helpers/` and are imported by test
  files. The existing `create-namespaced-project.ts` is the reference implementation.
- `UI.badge(type, label)` is loaded by `setup-gui-globals.ts` before every jsdom test.
- `project-detail.js` uses module-level patch functions (`_patchHealthBadge`,
  `_patchSynthesisLink`, `_patchWpRow`, …) that perform fresh `getElementById` queries
  per invocation with compare-and-swap guards.

## Approach / Architecture

**WP-001 — Shared `makeProject()` fixture helper:**  
Create `mcp-server/tests/gui/helpers/make-project.ts` exporting a `makeProject(opts)`
function whose API cleanly separates meta overrides from root overrides via a
destructured `opts` shape: `{ meta?, work_packages?, synthesis_generated?, timing?,
...rootOverrides }`. This eliminates the leakage where top-level keys (e.g.
`synthesis_generated`, `_metaOverrides`) were spreading into `meta`. All 6 test files
import and use the shared helper; the `_metaOverrides`/`_rootOverrides` escape-hatch
call sites are migrated to the new `{ meta: {...} }` shape. While editing
`project-detail-runs.test.ts`, also fix the cosmetic `beforeEach` mock-ordering issue
(D-12).

**WP-002 — Source cleanup batch (project-detail.js):**  
Three small, independent changes to `project-detail.js`:
1. Remove the injection fallback branch from `_patchSynthesisLink` (the `else if`
   block that injects a new row before `.card-title`). Add a JSDoc note documenting
   the pre-render contract: `#synthesis-link-row` is always pre-rendered by
   `renderProjectDetail`, so this branch is unreachable.
2. Replace the two raw badge strings in `buildRunBadges` with `UI.badge()` calls:
   `UI.badge('in-progress', 'Running')` and `UI.badge('dry-run', 'Dry Run')`.
3. Add an inline comment at the `_pdLogPreviewCleanups` drain site inside
   `renderRunsList` documenting the defensive invariant: the drain is redundant when
   callers already drain before calling, but is kept as a defensive guard.

**WP-003 — Health badge consolidation:**  
In the initial render's `API.getProjectHealth().then()` callback (lines ~1242-1255 of
`project-detail.js`), replace the inline DOM-write logic with a call to
`_patchHealthBadge(health)`. The `catch` block that removes the badge on failure is
kept. This makes the initial render path and the poll path use the same render
function, establishing a single source of truth.

**WP-004 — `renderRunsList` extraction + `_findScrollAnchor` helper:**  
Extract the IIFE scroll-ancestor walk inside `renderRunsList` into a new module-level
function `_findScrollAnchor(el, _getStyle)` where `_getStyle` is an optional
injectable callback (defaulting to `window.getComputedStyle`). Then extract
`renderRunsList` itself from its closure inside `API.getRunLogs().then()` into a
named module-level function `renderRunsList(runsEl, sorted, repo, slug,
activeFilename, matchingQueueEntry)`. All callers within the `getRunLogs().then()`
callback are updated to pass the explicit parameters. New unit tests are added for
`_findScrollAnchor` (using an injectable `getStyle` stub to avoid jsdom's empty
`getComputedStyle`), and for `renderRunsList` directly (bypassing the outer
`getRunLogs()` async chain).

## Rationale

The `makeProject()` extraction eliminates a concretely documented smell (6 diverged
implementations; leakage of root-level sentinel keys into `meta`) and makes future
test authoring safe. The structured `opts` API is strictly cleaner than the old flat
overrides spread. The source-cleanup batch items (WP-002) are all low-risk,
zero-test changes — removing dead code and aligning with existing conventions. The
health badge consolidation (WP-003) is a small two-line change that eliminates
duplication and will naturally be exercised by existing tests that cover the initial
render path. Extracting `renderRunsList` and `_findScrollAnchor` (WP-004) is the
highest-complexity WP but directly enables jsdom-testable isolation of the scroll and
patch logic — a long-standing blocker identified in the prior project.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| `makeProject` API shape | Structured destructured opts: `{ meta?, ...rootOverrides }` | (a) Keep flat `Record<string, unknown>` overrides with `_metaOverrides` escape hatch; (b) Two-arg form `makeProject(metaOverrides, rootOverrides)` | Structured opts is the cleanest TypeScript idiom, is self-documenting, and avoids magic sentinel keys entirely. The escape-hatch pattern requires documenting a non-obvious convention. Two-arg form is less readable at call sites. |
| `_patchSynthesisLink` dead branch | Remove the injection fallback, add JSDoc documenting the contract | Keep dead code silently; add a comment only | Removal keeps the function surface minimal and avoids maintainers questioning whether the fallback is reachable. JSDoc on the function explains the pre-render invariant without cluttering the body. |
| `_findScrollAnchor` injection | Optional `_getStyle` parameter (defaults to `window.getComputedStyle`) | Full DI via constructor; no injection at all | Optional parameter is the lightest-weight approach for a private helper function. It avoids framework overhead while enabling jsdom testing. |
| `renderRunsList` extraction scope | Module-level function (all params explicit) | Keep as closure; extract to immediately-invoked class | Module-level named function is idiomatic for this codebase's vanilla-JS style and allows direct testing via `vm.runInThisContext`. Classes would be overkill for a single function. |

## Pattern Alignment

| Pattern | Status |
|---------|--------|
| Shared helpers in `tests/gui/helpers/` — `create-namespaced-project.ts` is the reference | Followed — `make-project.ts` mirrors the same structure and export style |
| Module-level private patch functions with underscore prefix — `_patchWpRow`, `_patchHealthBadge`, etc. | Followed — `_findScrollAnchor` adopts the same prefix and naming convention |
| `UI.badge(type, label)` for all badge rendering in view files | Followed — WP-002 aligns `buildRunBadges` with this convention |
| Compare-and-swap guards in patch functions (no-op when content unchanged) | Not applicable to WP-003 — `_patchHealthBadge` already has these guards |
| JSDoc on all module-level functions in `project-detail.js` | Followed — new functions receive JSDoc blocks |

## Detailed Steps

### WP-001: Shared `makeProject()` fixture helper

1. Create `mcp-server/tests/gui/helpers/make-project.ts` with a clean structured API:
   ```ts
   export function makeProject(opts: {
     meta?: Partial<Record<string, unknown>>;
     work_packages?: unknown[];
     synthesis_generated?: boolean;
     timing?: unknown;
     [key: string]: unknown;
   } = {}) {
     const { meta: metaOverrides = {}, work_packages, synthesis_generated, timing, ...rootOverrides } = opts;
     return {
       meta: {
         status: 'IN_PROGRESS',
         title: 'Test Project',
         plan_path: '/some/path',
         date_created: '2026-01-01T00:00:00Z',
         last_updated: '2026-01-01T00:00:00Z',
         ...metaOverrides,
       },
       work_packages: work_packages ?? [],
       project_comments: [],
       project_name: 'Test Project',
       timing: timing ?? null,
       server_version: null,
       ledger_version: null,
       synthesis_generated: synthesis_generated ?? false,
       ...rootOverrides,
     };
   }
   ```
2. In each of the 6 test files, remove the local `function makeProject(...)` definition
   and add an import of the shared helper:
   ```ts
   import { makeProject } from './helpers/make-project.js';
   ```
   Files to update: `project-detail-snapshot.test.ts`, `project-detail-diff.test.ts`,
   `project-detail-poll.test.ts`, `project-detail-scroll.test.ts`,
   `project-detail-runs.test.ts`, `project-detail-auto-update.test.ts`.
3. Migrate all `makeProject(...)` call sites that used the old flat-override pattern to
   the new structured API (e.g. `makeProject({ status: 'COMPLETE' })` →
   `makeProject({ meta: { status: 'COMPLETE' } })`; calls using `_metaOverrides` escape
   hatch → `makeProject({ meta: {...} })`; calls using `_rootOverrides` escape hatch →
   `makeProject({ ...rootOverrides })`).
4. Fix the `beforeEach` mock-ordering bug in `project-detail-runs.test.ts` (D-12):
   move `vi.clearAllMocks()` to before the mock implementations are installed, matching
   the correct order used in `project-detail-auto-update.test.ts`.
5. Run the full GUI test suite (`npm test` from `mcp-server/`) to confirm 0 failures.

### WP-002: Source cleanup batch (`project-detail.js`)

6. **`_patchSynthesisLink` dead branch removal:** Remove the `else if (repo && slug)`
   block (approximately lines 419-427) that injects a new `#synthesis-link-row` before
   `.card-title`. Update the JSDoc block to document the pre-render contract:
   `#synthesis-link-row` is always present in the DOM after `renderProjectDetail`
   completes the initial HTML render; the injection fallback is therefore unreachable
   under normal operation and is removed.
7. **`buildRunBadges` → `UI.badge()` migration:** Replace the two raw badge string
   literals with `UI.badge()` calls:
   - `'<span class="badge badge-in-progress">Running</span>'` →
     `UI.badge('in-progress', 'Running')`
   - `'<span class="badge badge-dry-run">Dry Run</span>'` →
     `UI.badge('dry-run', 'Dry Run')`
8. **`_pdLogPreviewCleanups` double-drain documentation:** At the drain site inside
   `renderRunsList` (the `_pdLogPreviewCleanups.forEach` at the top of the function
   body), add an inline comment explaining the defensive nature of the drain: callers
   that perform a structural rebuild (pollQueue's structural path, `onKillDone`, the
   catch handler) also drain before calling `renderRunsList`; the internal drain is
   kept as a defensive guard in case future callers omit it.
9. Run the full GUI test suite to confirm 0 failures (no functional changes — tests
   asserting badge output will still pass because `UI.badge('in-progress', 'Running')`
   produces an identical HTML string).

### WP-003: Health badge consolidation

10. In `renderProjectDetail`, locate the `API.getProjectHealth` callback block (lines
    ~1241-1255). Replace the inline DOM-write logic inside `.then(function(health) {...})`
    with a single call to `_patchHealthBadge(health)`. The `catch` handler that removes
    the badge element on failure is unchanged:
    ```js
    // Before (inline logic):
    API.getProjectHealth(repo, slug).then(function (health) {
      if (health.work_packages_needing_reset === 0) {
        healthBadge.textContent = '…';
        healthBadge.className = 'health-badge healthy';
      } else {
        healthBadge.textContent = '…';
        healthBadge.className = 'health-badge attention';
      }
    }).catch(function () { ... });

    // After (delegating):
    API.getProjectHealth(repo, slug).then(function (health) {
      _patchHealthBadge(health);
    }).catch(function () { ... });
    ```
11. Run the full GUI test suite to confirm 0 failures. Because `_patchHealthBadge` does
    an independent `getElementById` query, the refactored path is functionally identical
    to the previous inline block.

### WP-004: `renderRunsList` extraction + `_findScrollAnchor` helper

12. **Extract `_findScrollAnchor`:** Move the IIFE scroll-ancestor walk (lines
    ~1319-1328) into a new module-level function placed near the other `_patch*`
    helpers:
    ```js
    /**
     * Walk up from el to find the nearest scrollable ancestor, or fall back
     * to document.documentElement.
     * @param {Element} el           - Starting element.
     * @param {Function} [_getStyle] - Injectable style resolver for testing
     *   (defaults to window.getComputedStyle). In jsdom, getComputedStyle
     *   returns empty objects, so tests inject a stub instead.
     * @returns {Element}
     */
    function _findScrollAnchor(el, _getStyle) {
      var getStyle = _getStyle || (window.getComputedStyle
        ? function (node) { return window.getComputedStyle(node); }
        : function () { return null; });
      var cur = el;
      while (cur && cur !== document.documentElement) {
        var style = getStyle(cur);
        if (style && (style.overflowY === 'auto' || style.overflowY === 'scroll')) {
          return cur;
        }
        cur = cur.parentElement;
      }
      return document.documentElement;
    }
    ```
    Replace the IIFE inside `renderRunsList` with a call to `_findScrollAnchor(runsEl)`.
13. **Extract `renderRunsList`:** Convert the nested closure function at line 1312 into
    a module-level named function that accepts explicit parameters:
    ```js
    function renderRunsList(runsEl, sorted, repo, slug, activeFilename, matchingQueueEntry) {
      // same body, using parameters instead of closed-over variables
    }
    ```
    Remove the `function renderRunsList(matchingQueueEntry)` closure from inside the
    `getRunLogs().then()` callback. Add a JSDoc block documenting all parameters.
14. **Update all callers:** Update the 5 call sites inside the `getRunLogs().then()`
    callback (lines ~1426, ~1454, ~1467, ~1477, ~1497) from `renderRunsList(x)` to
    `renderRunsList(runsEl, sorted, repo, slug, activeFilename, x)`.
15. **Add tests for `_findScrollAnchor`** in a new test file
    `mcp-server/tests/gui/project-detail-helpers.test.ts`:
    - A test that returns the first ancestor with `overflowY: scroll` using a stub
      `getStyle` that returns `{ overflowY: 'scroll' }` for a specific element.
    - A test that returns `document.documentElement` when no scrollable ancestor is
      found.
    - A test that the function correctly walks past non-scrollable ancestors.
16. **Expose `_findScrollAnchor` for testing** by assigning it to `globalThis` (matching
    the pattern used for `_pollProjectDetail`, `_snapshotProjectState`, etc. in
    `project-detail.js`). This enables `vm.runInThisContext`-loaded test access.
17. **Add tests for `renderRunsList`** directly in
    `mcp-server/tests/gui/project-detail-helpers.test.ts` (or extend
    `project-detail-scroll.test.ts`):
    - A test that `renderRunsList` builds expected HTML for a single run item.
    - A test that `renderRunsList` invokes `_pdLogPreviewCleanups` drain before DOM rebuild.
    - A test that scroll position is restored after the DOM rebuild.
18. Run the full GUI test suite to confirm 0 failures.

## Dependencies

- WP-001 is independent and should run first (unblocks cleaner test edits in later WPs).
- WP-002 and WP-003 are independent of each other and can run concurrently after WP-001.
- WP-004 depends on no prior WP but is highest complexity; order after WP-002/003 to
  avoid merge conflicts on `project-detail.js` if any.

## Required Components

**New files:**
- `mcp-server/tests/gui/helpers/make-project.ts` — shared fixture factory (WP-001)
- `mcp-server/tests/gui/project-detail-helpers.test.ts` — unit tests for
  `_findScrollAnchor` and the extracted `renderRunsList` (WP-004)

**Modified files:**
- `mcp-server/gui/public/views/project-detail.js` — WP-002, WP-003, WP-004
- `mcp-server/tests/gui/project-detail-snapshot.test.ts` — WP-001
- `mcp-server/tests/gui/project-detail-diff.test.ts` — WP-001
- `mcp-server/tests/gui/project-detail-poll.test.ts` — WP-001
- `mcp-server/tests/gui/project-detail-scroll.test.ts` — WP-001
- `mcp-server/tests/gui/project-detail-runs.test.ts` — WP-001 (+ D-12 fix)
- `mcp-server/tests/gui/project-detail-auto-update.test.ts` — WP-001

**Documentation files:**
- `mcp-server/tests/gui/README.md` — document the `make-project.ts` shared helper
  convention (WP-001)
- `mcp-server/docs/agents/project-manifest/file-tree.md` — add entries for the new
  `make-project.ts` and `project-detail-helpers.test.ts` files

## Assumptions

- The pre-render contract for `#synthesis-link-row` holds: `renderProjectDetail` always
  renders this element in the initial HTML string before any `_patchSynthesisLink` call.
  This is confirmed by the existing tests in `project-detail-auto-update.test.ts` that
  query `#synthesis-link-row` after `renderAndSettle`.
- `UI.badge()` escapes HTML in the label; "Running" and "Dry Run" are safe constant
  strings, so the output is identical to the current raw string.
- All 6 `makeProject` call sites in the test files use compatible shapes that can be
  migrated to the structured API without silent behavioral changes. Leakage of top-level
  keys into `meta` was cosmetic (no tests asserted on unexpected meta properties).
- `_findScrollAnchor` and `renderRunsList` should be exposed on `globalThis` for test
  access, consistent with the convention used for `_pollProjectDetail` and
  `_snapshotProjectState`.

## Constraints

- No new npm dependencies.
- All changes must remain within `mcp-server/gui/public/views/project-detail.js` and
  `mcp-server/tests/gui/` — no changes to other files beyond documentation.
- The `_pdLogPreviewCleanups` module-level variable remains as-is; `renderRunsList`
  continues to reference it directly (it is module-level, not a parameter).
- `_findScrollAnchor` must not call `window.getComputedStyle` if not present (for
  non-browser environments) — the existing null-guard pattern covers this.
- TypeScript strict mode: `make-project.ts` must pass `tsc --noEmit` with 0 errors.

## Out of Scope

- E2E browser test (Recommendation §6): requires Playwright or Cypress infrastructure
  not present in the repo. This is a non-trivial new dependency and separate project.
- D-03: `s.rework_count || 0` null coercion in `_snapshotProjectState` — deferred.
- D-04: No test for WP with `null work_package_id` — deferred.
- D-06: `settleResumePolling` network error recovery — deferred.
- D-07: `_diffProjectState` null-guard on `prev` — deferred.
- D-08: Interactive-state TOCTOU window during fetch — deferred.
- D-09: `renderOrchToolbar` full-rebuild on every poll tick — deferred.
- D-10: `getProjectHealth` over-fetch on non-health-relevant diffs — deferred.
- Renaming `renderRunsList` or moving it to a separate module file — out of scope
  (extraction to module-level within the same file is sufficient).

## Acceptance Criteria

- **AC-1:** A single `make-project.ts` file in `tests/gui/helpers/` exports `makeProject`.
  No `function makeProject` definition exists in any of the 6 test files.
- **AC-2:** All `makeProject` call sites compile without TypeScript errors.
- **AC-3:** The `_patchSynthesisLink` injection fallback (`else if (repo && slug)` DOM
  insertion block) is absent from `project-detail.js`. The function's JSDoc documents
  the pre-render contract.
- **AC-4:** `buildRunBadges` contains no raw `<span class="badge ...">` strings;
  both badges use `UI.badge(...)`.
- **AC-5:** The `_pdLogPreviewCleanups` drain at the top of `renderRunsList` has an
  inline comment documenting the defensive invariant.
- **AC-6:** The `API.getProjectHealth(...).then()` callback inside `renderProjectDetail`
  contains no inline DOM-write logic; it calls `_patchHealthBadge(health)` only.
- **AC-7:** `_findScrollAnchor(el, _getStyle)` exists as a module-level function and
  is exposed on `globalThis` for test access.
- **AC-8:** `renderRunsList(runsEl, sorted, repo, slug, activeFilename,
  matchingQueueEntry)` exists as a module-level function; no `function renderRunsList`
  closure exists inside `getRunLogs().then()`.
- **AC-9:** All 5 callers inside `getRunLogs().then()` pass the explicit parameter list.
- **AC-10:** New tests for `_findScrollAnchor` pass, covering: scrollable ancestor found,
  no scrollable ancestor (falls back to `document.documentElement`), multi-level walk.
- **AC-11:** New tests for `renderRunsList` pass, covering: DOM built correctly, drain
  fires before rebuild, scroll position restored.
- **AC-12:** Full test suite: `npm test` from `mcp-server/` passes with 0 failures and
  no regressions against the 1,339 baseline passing tests.

## Testing Strategy

- **WP-001:** No new tests. The existing 6 test files are the tests. Correct migration is
  verified by `npm test` passing.
- **WP-002:** No new tests. `buildRunBadges` is exercised by integration tests in
  `project-detail-runs.test.ts` that assert on the rendered badge HTML.
- **WP-003:** No new tests. The existing tests that render `renderProjectDetail` and then
  assert on health badge state cover the refactored path.
- **WP-004:** New tests in `project-detail-helpers.test.ts` for `_findScrollAnchor`
  (using an injectable `getStyle` stub) and for `renderRunsList` (using a constructed
  `runsEl` DOM element with explicit parameter inputs).

## Test Plan

- `project-detail-helpers.test.ts` — `_findScrollAnchor`: ancestor with overflowY scroll
  is returned — AC-7, AC-10
- `project-detail-helpers.test.ts` — `_findScrollAnchor`: falls back to
  `document.documentElement` when no ancestor matches — AC-7, AC-10
- `project-detail-helpers.test.ts` — `_findScrollAnchor`: walks past non-scrollable
  ancestors to find a deeper match — AC-10
- `project-detail-helpers.test.ts` — `renderRunsList`: renders expected HTML for a
  single run item (run number, date, view link) — AC-8, AC-11
- `project-detail-helpers.test.ts` — `renderRunsList`: drains `_pdLogPreviewCleanups`
  before rebuilding the DOM — AC-5, AC-11
- `project-detail-helpers.test.ts` — `renderRunsList`: restores scroll position on
  `scrollAnchor` after DOM rebuild — AC-11
- `project-detail-runs.test.ts` (existing, must remain green) — exercises
  `buildRunBadges` badge output — AC-4, AC-12
- `project-detail-auto-update.test.ts` (existing) — exercises synthesis auto-reveal via
  `_patchSynthesisLink` — AC-3, AC-12
- All 6 test files (existing) — exercise `makeProject` through `renderProjectDetail` or
  `_pollProjectDetail` paths — AC-1, AC-2, AC-12

## Documentation Updates

- `mcp-server/tests/gui/README.md` — Add a "Shared Fixture Helpers" section documenting
  `make-project.ts`: exports, usage examples, the structured `meta` opts pattern, and
  a note explaining the decision to avoid flat-spread overrides.
- `mcp-server/docs/agents/project-manifest/file-tree.md` — Add entries for:
  `tests/gui/helpers/make-project.ts` and `tests/gui/project-detail-helpers.test.ts`.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **`makeProject` call site migration misses an edge case** — a call site passes a key intended for `meta` without the `meta:{}` wrapper, silently changing its destination. | The TypeScript compiler will catch most mismatches. After migration, run the full test suite; any broken assertion reveals a missed migration. The Developer should grep all `makeProject(` call sites across the 6 files before starting. |
| **`renderRunsList` extraction breaks an existing test** — a test was relying on the function being closure-scoped and not accessible via `globalThis`. | Review all 6 test files for any direct reference to `renderRunsList` before extraction. The synthesis notes no existing tests directly access the closure; tests exercise it via `renderProjectDetail`. Post-extraction, `globalThis.renderRunsList` is available for direct access. |
| **`_patchSynthesisLink` injection branch removal causes a regression** if there is an edge case where `#synthesis-link-row` is absent from the DOM when `_patchSynthesisLink(true, ...)` fires. | Confirmed safe by: (a) the synthesis confirms the row is always pre-rendered; (b) the `project-detail-auto-update.test.ts` synthesis auto-reveal tests confirm the row exists after `renderAndSettle`. If a future caller omits the row, `row.style.display = ''` is simply a no-op (the `if (row)` guard remains). |
| **`UI.badge()` escapes HTML differently** than the raw string for badge labels with special characters. | "Running" and "Dry Run" contain no special characters. Output is identical. |
