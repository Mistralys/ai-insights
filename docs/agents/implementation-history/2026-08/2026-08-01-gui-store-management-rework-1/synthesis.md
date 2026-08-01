# Synthesis Report — GUI Store Management Rework 1

**Project:** `2026-08-01-gui-store-management-rework-1`
**Date:** 2026-08-01
**Status:** COMPLETE
**Agent:** Head of Operations (Synthesis)

---

## Executive Summary

This rework plan addressed nine tracked items carried forward from the parent project
`2026-08-01-gui-store-management`: five deferred items and four out-of-scope observations.
All nine work packages were completed in a single cycle with zero regressions and zero
rework iterations. The changes collectively close the last known quality gaps in the
newly-delivered Stores tab — improving WCAG 2.1 accessibility compliance, UI reliability,
backend code cleanliness, test coverage, and manifest documentation.

**Files touched:**

| File | WPs |
|------|-----|
| `mcp-server/gui/public/views/config-stores.js` | WP-001, WP-002, WP-003, WP-006 |
| `mcp-server/gui/api-stores.ts` | WP-007 |
| `mcp-server/src/storage/store-context.ts` | WP-008 |
| `mcp-server/tests/gui/api-stores.test.ts` | WP-004 |
| `mcp-server/tests/gui/route-table.test.ts` | WP-005 |
| `mcp-server/tests/storage/store-context-reload.test.ts` | WP-008 |
| `mcp-server/docs/agents/project-manifest/api-surface.md` | WP-009 |
| `mcp-server/gui/docs/agents/project-manifest/ui-components.md` | WP-009 |

---

## Metrics

| Metric | Value |
|--------|-------|
| Work packages total | 9 |
| Work packages complete | 9 |
| Pipeline stages executed | 25 (8 × implementation + 8 × QA + 8 × code-review + 1 × documentation) |
| Stages passed | 25 |
| Stages failed | 0 |
| Rework iterations | 0 |
| Tests at cycle start (inherited) | 3,944 |
| New tests added | 3 (WP-004, WP-005, WP-008) |
| Tests at cycle end | 3,947 |
| Test failures | 0 |
| Regressions | 0 |
| Fix-Forwards applied by Reviewer | 2 (WP-001: state comment; WP-008: JSDoc) |

---

## Work Package Outcomes

### WP-001 — Modal Focus Restoration (WCAG 2.1 SC 3.2.2)

Introduced `csTriggerElement` module-level state in `config-stores.js`. `csRenderStoreModal()`
now captures `document.activeElement` as its first statement; `csCloseModal()` restores
focus to that element (guarded with `typeof .focus === 'function'`) then nulls the reference.
Covers both Add and Edit modal flows. The Reviewer applied a Fix-Forward: added the missing
`csTriggerElement` description to the module-level state comment block.

### WP-002 — Label "(optional)" Hint — Mode-Aware Rendering

The label field hint in `csRenderStoreModal()` is now computed via a `labelHint` pre-computed
variable using `(isAdd || !(store && store.label))`. The hint is shown in add mode and edit
mode without an existing label, and omitted in edit mode with an existing label. The
pre-computed variable separates mode logic from template string construction — clean ES5
pattern consistent with the rest of the module.

### WP-003 — Reorder-Mode Error Target

Added `<div id="cs-reorder-error"></div>` to `csRenderReorderView()` output.
`csShowTableError()` now uses an OR-fallback: `getElementById('cs-table-error') ||
getElementById('cs-reorder-error')`, making it view-agnostic. The `csMoveStore()` catch
block was corrected: it now reverts the optimistic array swap, re-renders the reorder view
(creating the error target), and calls `csShowTableError()` — with `csRefreshTab()` removed.
The ordering comment inside the catch block explicitly documents the DOM-dependency invariant.

### WP-004 — Absent-Label Schema Validation Test

Added `rejects absent label field with VALIDATION_ERROR` test to the `handleUpdateStore()`
describe block in `api-stores.test.ts`, positioned immediately after the existing
whitespace-only label test. Closes a real coverage gap: tests a genuinely distinct schema
path (absent required field vs. present-but-invalid field).

### WP-005 — Route Dispatch Ordering Test

Added route ordering assertion to `route-table.test.ts`: `PUT /api/stores/order` (literal)
must appear before `PUT /api/stores/:storeId` (regex) in the route descriptor table. Uses
a dual-presence-guard pattern (`>= 0` assertions before `toBeLessThan`) to prevent
silent false-positive passes if either route is removed. Inline comment documents the
failure mode (shadowing bug) so future contributors understand the test's purpose.

### WP-006 — Banner Dedup + Sync Popover Overflow Fix

Two independent fixes to `config-stores.js`:
1. **Banner dedup:** `csRefreshWithStores()` now removes any existing `#cs-notification-banner`
   before injecting a new one — ensures at most one banner in the DOM regardless of what
   `renderStoresTab()` renders.
2. **Popover overflow:** `mouseenter`/`focus` badge handlers now call `getBoundingClientRect()`
   after `classList.add` (visible popover), then flip `left→auto / right→0` if the popover
   would overflow the right viewport edge. `mouseleave`/`blur` handlers reset both inline
   styles unconditionally, making the hide path idempotent.

### WP-007 — Git Helper Cleanup

Removed redundant `-C storePath` arguments from both `runGit()` calls in `detectGitStatus()`
in `api-stores.ts`. The `{ cwd: storePath }` option on `execFileAsync` already sets the
working directory — having both was a redundant, misleading duplication. Purely subtractive
change; no behavioral difference.

### WP-008 — `reloadStoreContext()` Concurrency Coalescing Guard

Added module-level `_pendingReload: Promise<StoresConfig | null> | null = null` to
`store-context.ts`. The outer function is a **non-async** plain function that returns
the existing promise when a reload is already inflight — ensuring concurrent callers receive
the same `Promise` object by reference. The IIFE handles async semantics internally and
clears `_pendingReload` in `finally` on both success and failure. The Reviewer applied
a Fix-Forward: extended the JSDoc to document the coalescing invariant and the
non-async constraint (adding `async` would create a new `Promise` wrapper per call,
breaking reference equality). A new concurrency test asserts `p1 === p2` (same Promise)
and `r1 === r2` (same resolved value).

### WP-009 — Documentation

Updated `api-surface.md`: `csCloseModal()` focus restoration, `csShowTableError()`
dual-target behavior, corrected `csMoveStore()` error-path, removed stale WCAG 2.1
accessibility gap note (resolved by WP-001). Updated `ui-components.md`: added
`#cs-reorder-error` to the reorder sub-view table with ordering-invariant note; added
`.cs-sync-popover` / `.cs-sync-popover-visible` to the badge classes table including
the flip-left behavior. Regenerated `.context/` snapshots via `node scripts/cli.js ctx-generate`.

---

## Strategic Recommendations (Gold Nuggets)

**1. Non-async outer function for concurrency coalescing (WP-008)**
The pattern `function f() { if (_pending) return _pending; _pending = (async () => { ... })(); return _pending; }` is the correct idiom for a "share one inflight promise" guard in TypeScript. Adding `async` to the outer function wraps the return in a new `Promise` each time, silently breaking reference equality. Any future singleton reload, debounce, or dedup pattern should follow this model. The JSDoc update in WP-008 now documents this invariant.

**2. Dual-presence-guard pattern for ordering tests (WP-005)**
When asserting that route A appears before route B in a route table, always verify both routes exist (`findIndex >= 0`) before asserting ordering. Without guards, `findIndex(-1) < findIndex(5)` silently passes when a route is deleted. This pattern should be applied to any future route-ordering regression tests.

**3. OR-fallback for view-agnostic error display (WP-003)**
`getElementById('cs-table-error') || getElementById('cs-reorder-error')` is a clean, forward-compatible way to make `csShowTableError()` work across multiple view states without adding a parameter. Any future view state that needs error injection simply needs to add an element with a matching ID — no changes to the shared function required.

**4. DOM measurement ordering for viewport-overflow popovers (WP-006)**
The correct sequence is: `classList.add` → `getBoundingClientRect()` → conditional style flip. Measuring before the element is visible gives incorrect (often zero) dimensions. The unconditional style reset on hide ensures the next show always starts from the default (left-aligned) position. This pattern applies to any future popover or tooltip that needs viewport-edge awareness.

---

## Deferred & Follow-Up Items

### Deferred (intentionally postponed)

| # | Source | Agent | Description | Priority |
|---|--------|-------|-------------|----------|
| D1 | WP-001 code-review | Reviewer | `csClickHandler` is absent from the module-level state comment block in `config-stores.js` (predates this WP). Add a brief description alongside the other variable entries. | Low |
| D2 | WP-002 code-review | Reviewer | Save-handler error text 'Provide a new label or leave the current one' is slightly misleading — the current label is already pre-filled in the input. Future UX pass could update to e.g. 'Label cannot be empty — clear the field to remove it, or leave the existing value'. | Low |
| D3 | WP-006 code-review | Reviewer | The four sync badge event handlers (mouseenter/mouseleave/focus/blur) within each IIFE duplicate popover-lookup-and-act logic. When the module is modernised, factor into `showSyncPopover(popover)` and `hideSyncPopover(popover)` helper functions. | Low |

### Out-of-Scope (beyond this plan's boundaries)

| # | Source | Agent | Description | Priority |
|---|--------|-------|-------------|----------|
| O1 | WP-001 QA | QA | `config-stores.js` has no automated JSDOM-based tests (frontend-only ES5). Focus-restoration behavior was verified by code inspection only. A future task could add JSDOM unit tests for `csRenderStoreModal()` / `csCloseModal()` focus behavior. | Low |
| O2 | WP-003 QA | QA | No automated tests cover `csMoveStore()` failure paths. JSDOM tests simulating API failures in the reorder flow would close this gap. | Low |
| O3 | WP-006 QA | QA | No automated tests cover `csRefreshWithStores()` banner dedup or the popover flip logic. JSDOM-based tests would require mocking `getBoundingClientRect()` and `window.innerWidth`. | Low |
| O4 | WP-008 code-review | Reviewer | The concurrency coalescing guard ignores `configPath` differences — all concurrent callers receive the result of the first caller's `configPath`. Correct in production (all callers use `undefined`); worth monitoring if the test interface evolves to pass distinct `configPath` values. | Low |
| O5 | WP-003 implementation | Developer | Move buttons remain enabled after a csMoveStore() failure in reorder mode (the in-flight disable-all-buttons pattern is not mirrored in the error-recovery path). Minor DX gap — users can immediately retry. | Low |

---

## Next Steps

1. **Planner:** This rework plan is fully closed — no open blockers or critical deferred items. The Stores tab is now considered stable. The deferred items (D1–D3, O1–O5) are all low-priority and can be batched into a future housekeeping cycle or addressed opportunistically during the next Stores-tab feature development.

2. **Developer (next feature):** When adding new view states to the Stores tab, follow the `#cs-{view}-error` naming convention established in WP-003 to benefit automatically from the OR-fallback in `csShowTableError()`.

3. **Developer (future JSDOM test cycle):** The three coverage gaps (O1–O3) share a common requirement: JSDOM test harness for `config-stores.js`. Establishing a single test file for the module's pure rendering functions would close all three gaps efficiently.

4. **MCP Server Release:** With the Stores tab now stable and fully documented, this is a clean point for a patch or minor release of the MCP Server if the parent project's changes have not yet been shipped.
