# Plan

## Plan Audit Cycles
- Audits: 1 — Plan Auditor v1.3.0
- Architectural Reviews: none — Plan Architect Reviewer v1.4.0

## Summary

Address all actionable items identified in the sprint synthesis report for `2026-05-19-orchestrator-gui-polish`. Six items span test coverage gaps, type-safety improvements, minor code hygiene, a comment fix, a validator tightening, and a `renderQueueTable` refactor to reduce accumulated complexity.

## Architectural Context

All changes target the MCP server GUI layer:

- **Frontend view:** `mcp-server/gui/public/views/orchestrator.js` — renders the orchestrator view (start panel + queue table + CLI reference). Contains `renderQueueTable` (~130 lines), `statusPollTimer` setup in the Start Run handler (lines 140–161), and the banner-clearing logic.
- **Frontend widgets:** `mcp-server/gui/public/js/orchestrator-widgets.js` — `OrchestratorWidgets` IIFE with `formatLogAction()`, `renderLogPreview()`, etc.
- **Backend queue:** `mcp-server/src/gui/queue/get-queue.ts` — reads/parses `.run-queue.json`, validates entries with `isRawQueueEntry()`, enriches with `getProjectLedgerStatus()`.
- **Types:** `mcp-server/src/gui/queue/types.ts` — `QueueEntry` interface (extends `RawQueueEntry`).
- **View tests:** `mcp-server/tests/gui/orchestrator-view.test.ts` — uses a `makeEntry()` factory typed as `Record<string, unknown>` (the source of the anti-pattern).
- **Widget tests:** `mcp-server/tests/gui/orchestrator-widgets.test.ts` — 59+ tests; header comment on line 13 says `"appends new events"` (outdated after WP-004 reversed the order).

## Approach / Architecture

Six independent improvements, none requiring new dependencies or architectural changes:

1. **Banner-clearing test coverage** — Add 3 dedicated unit tests to `orchestrator-view.test.ts` validating the banner-clearing behaviour added in WP-001.
2. **`makeEntry()` type safety** — Convert the factory in `orchestrator-view.test.ts` from `Record<string, unknown>` to `Partial<QueueEntry>` so the compiler catches missing required fields.
3. **Comment fix** — Change line 13 of `orchestrator-widgets.test.ts` from `"appends new events"` to `"prepends new events (most-recent-first ordering)"`.
4. **`statusPollTimer` cleanup** — Register the interval ID in `_orchLogPreviewCleanups` so it's cleared on view teardown.
5. **`renderQueueTable` extraction** — Extract three helpers (`_buildQueueHtml`, `_bindQueueActions`, `_mountLogPreviews`) to reduce `renderQueueTable` to a coordinating shell.
6. **`isRawQueueEntry` validator tightening** — Add an empty-string guard for `expectedSlug`.

## Rationale

- Items 1–4 are direct gap closures identified by QA and Security Auditor agents during the sprint. Leaving them unaddressed creates test-regression risk and resource-leak debt.
- Item 5 is a readability refactor; three agents independently flagged `renderQueueTable` complexity. Extracting helpers keeps each function under 40 lines and makes unit-testing individual steps feasible in future.
- Item 6 hardens the backend validator to reject structurally invalid entries that the UI would silently ignore anyway; it's a one-line addition with no behavioural impact.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| `makeEntry()` typing | `Partial<QueueEntry>` with spread defaults | Import raw `QueueEntry` type and require full objects; use `as unknown as QueueEntry` casts | `Partial<>` gives compile-time checks without forcing tests to specify every field; remains ergonomic for overrides |
| `statusPollTimer` cleanup | Push into existing `_orchLogPreviewCleanups` array | Create a separate `_orchTimerCleanups` array; use AbortController | The existing array already drains on re-render — reusing it is the minimal change and follows the established pattern |
| `renderQueueTable` refactor | Extract 3 named helpers inside the same function scope (IIFE-local) | Move to separate files; use a class; leave as-is | File-level extraction adds complexity for vanilla JS (no modules); class adds unnecessary ceremony; extraction within the same scope keeps locality while improving readability |

## Pattern Alignment

- `mcp-server/gui/public/views/orchestrator.js` — existing pattern: module-scoped `_orchLogPreviewCleanups` array drained on each `renderOrchestrator()` call. The `statusPollTimer` cleanup follows this exact pattern.
- `mcp-server/tests/gui/orchestrator-view.test.ts` — existing pattern: `makeEntry()` factory returns a plain object with spread overrides. The type-safety change preserves this shape but adds compiler enforcement.
- `mcp-server/src/gui/queue/get-queue.ts` — existing pattern: `isRawQueueEntry()` checks `typeof` + constraint predicates for each field. Adding `.length > 0` follows the same style.

## Detailed Steps

### Step 1 — Add banner-clearing unit tests

In `mcp-server/tests/gui/orchestrator-view.test.ts`, add a new `describe` block after the existing AC-3 section:

```
describe('renderOrchestrator — banner clearing', () => {
  test 1: Success banner is removed when renderQueueTable renders non-empty entries.
  test 2: Error banner is NOT removed when renderQueueTable renders non-empty entries.
  test 3: Banner remains intact when queue is empty.
});
```

Each test must follow this order (the DOM is created fresh on each `renderOrchestrator` call, so the banner must be injected after the call, not before):
1. Mock `API.orchestratorGetQueue` to return entries (tests 1, 2) or empty (test 3).
2. Call `renderOrchestrator(app)` — this replaces `app.innerHTML` entirely, creating a fresh empty `#orch-preflight-results`.
3. Inject the banner synchronously into `document.getElementById('orch-preflight-results')` (before promises resolve).
4. `await flushPromises()` — resolves the queue API call so `renderQueueTable` runs the banner-clearing logic.
5. Assert presence/absence of the banner.

### Step 2 — Convert `makeEntry()` to `Partial<QueueEntry>`

In `mcp-server/tests/gui/orchestrator-view.test.ts`:

1. Add an import: `import type { QueueEntry } from '../../src/gui/queue/types.js';`
2. Change the `makeEntry` signature from `(overrides: Record<string, unknown> = {}): Record<string, unknown>` to `(overrides: Partial<QueueEntry> = {}): QueueEntry`.
3. Add `status: 'pending' as const` to the base object returned by `makeEntry()`. `QueueEntry` extends `RawQueueEntry`, which requires the `status` literal field — omitting it causes a TypeScript compile error. No existing test passes `status` as an override, so this addition is non-breaking.

### Step 3 — Fix AC-4 header comment

In `mcp-server/tests/gui/orchestrator-widgets.test.ts`, line 13–14:

Change:
```
 *   AC-4: renderLogPreview auto-polls API.getRunLogEntries() and
 *         appends new events. Returns a cleanup function that stops polling.
```
To:
```
 *   AC-4: renderLogPreview auto-polls API.getRunLogEntries() and
 *         prepends new events (most-recent-first ordering). Returns a cleanup function that stops polling.
```

### Step 4 — Register `statusPollTimer` for cleanup

In `mcp-server/gui/public/views/orchestrator.js`, after the closing `, 2000);` terminator of the `setInterval(...)` call — still inside the `if (runStatusFilename) {}` block, approximately line 162 before the block's closing `}` — add:

```javascript
_orchLogPreviewCleanups.push(function () { clearInterval(statusPollTimer); });
```

This ensures that when `renderOrchestrator()` is re-invoked (view re-render), the orphaned interval is drained alongside log-preview cleanup callbacks.

### Step 5 — Extract helpers from `renderQueueTable`

In `mcp-server/gui/public/views/orchestrator.js`, refactor `renderQueueTable` by extracting:

1. `_buildQueueHtml(entries)` — Takes the entries array and returns the HTML string (the `<table>` construction loop). ~50 lines.
2. `_bindQueueActions(container, entries)` — Injects DOM-based action buttons (kill/dismiss/view-project) and attaches toggle listeners. ~40 lines.
3. `_mountLogPreviews(container, entries)` — Starts log previews for expanded rows and pushes cleanup callbacks. ~15 lines.

`renderQueueTable` becomes a ~20-line coordinator:
```javascript
function renderQueueTable(container, entries) {
  var savedScrollY = window.scrollY;
  if (!entries.length) { /* empty state */ return; }
  _clearSuccessBanner();
  container.innerHTML = _buildQueueHtml(entries);
  _bindQueueActions(container, entries);
  _mountLogPreviews(container, entries);
  window.scrollTo(0, savedScrollY);
}
```

### Step 6 — Tighten `isRawQueueEntry` validator

In `mcp-server/src/gui/queue/get-queue.ts`, change:

```typescript
typeof e['expectedSlug'] === 'string' &&
```

To:

```typescript
typeof e['expectedSlug'] === 'string' && (e['expectedSlug'] as string).length > 0 &&
```

## Dependencies

- None. All changes are within the MCP server sub-project and independent of each other.
- Steps 1 and 2 both touch `orchestrator-view.test.ts` and should be applied in sequence.

## Required Components

- `mcp-server/tests/gui/orchestrator-view.test.ts` — steps 1, 2
- `mcp-server/tests/gui/orchestrator-widgets.test.ts` — step 3
- `mcp-server/gui/public/views/orchestrator.js` — steps 4, 5
- `mcp-server/src/gui/queue/get-queue.ts` — step 6

## Assumptions

- The `QueueEntry` type is importable from the test file's relative path (`../../src/gui/queue/types.js`).
- The `_orchLogPreviewCleanups` array is the correct cleanup mechanism for intervals that should not outlive a view lifecycle.
- The `renderQueueTable` function has no external callers beyond `refreshQueue()` in `orchestrator.js`, so extracting internal helpers has no API surface impact.

## Constraints

- No new npm dependencies.
- Frontend code remains vanilla JS (no modules, no build step).
- Refactored helpers are module-scoped (not added to any global namespace).
- All existing 2,201 tests must continue to pass.

## Out of Scope

- Adding WebSocket-based real-time updates.
- Scroll-to-ID enhancement (pixel-based restore is sufficient per synthesis).
- The ledger mapping anomaly (PM process issue, not code).
- Further CTX context additions (already resolved in the sprint).

## Acceptance Criteria

- AC-1: Three new tests in `orchestrator-view.test.ts` verify banner-clearing: success banner removed on non-empty queue, error banner preserved, banner untouched on empty queue.
- AC-2: `makeEntry()` in `orchestrator-view.test.ts` is typed `(overrides: Partial<QueueEntry>) => QueueEntry` and its base object includes `status: 'pending' as const`; existing tests compile and pass.
- AC-3: The AC-4 comment in `orchestrator-widgets.test.ts` reads `"prepends new events (most-recent-first ordering)"`.
- AC-4: `statusPollTimer` is cleared when `renderOrchestrator()` re-renders (verified by a unit test or by code inspection showing the interval is pushed to `_orchLogPreviewCleanups`).
- AC-5: `renderQueueTable` delegates to `_buildQueueHtml`, `_bindQueueActions`, and `_mountLogPreviews`; each helper is ≤ 50 lines.
- AC-6: `isRawQueueEntry()` rejects entries with an empty-string `expectedSlug`.
- AC-7: All 2,201+ existing tests pass after all changes.

## Testing Strategy

- **Unit tests (steps 1, 2, 6):** New and modified tests run via `npm test` in the `mcp-server/` directory.
- **Regression (all steps):** Full test suite must remain green (2,201 tests).
- **Manual verification (steps 4, 5):** Load `http://localhost:3420/#/orchestrator`, start a run, verify no behavioural regression (banner clears, scroll stable, log preview works, actions correct).

## Test Plan

- `mcp-server/tests/gui/orchestrator-view.test.ts` — **New:** "success banner cleared on non-empty render" — asserts `.success-banner` is removed when entries are present — AC-1
- `mcp-server/tests/gui/orchestrator-view.test.ts` — **New:** "error banner NOT cleared on non-empty render" — asserts `.error-banner` persists when entries are present — AC-1
- `mcp-server/tests/gui/orchestrator-view.test.ts` — **New:** "banner preserved when queue is empty" — asserts `.success-banner` remains when queue returns `[]` — AC-1
- `mcp-server/tests/gui/orchestrator-view.test.ts` — **Modified:** `makeEntry()` type change — all existing tests must still compile and pass — AC-2
- `mcp-server/tests/gui/queue/get-queue.test.ts` — **New:** "rejects entry with empty expectedSlug" — asserts that an entry with `expectedSlug: ''` is filtered out by `getQueue()` — AC-6
- Full test suite (`npm test` from `mcp-server/`) — all 2,201+ tests pass — AC-7

## Documentation Updates

- `mcp-server/docs/agents/project-manifest/api-surface.md` — Update the `killQueueEntry` JSDoc note that references `isRawQueueEntry` (currently reads "PID validation: isRawQueueEntry() rejects zero, negative, and float PIDs") to also document the new constraint: append "Slug validation: also rejects entries with an empty-string `expectedSlug`.".
- No other documentation changes required — this is a test/hygiene rework with no public API surface changes.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **`Partial<QueueEntry>` import fails in jsdom/vm test context** | The import is type-only (`import type`), which is erased at runtime. The test file already uses `import` statements for vitest — adding a type import has zero runtime impact. |
| **`_buildQueueHtml` extraction changes timing of DOM operations** | The refactor is purely structural — the same statements execute in the same order. Existing tests serve as regression guard. |
| **Empty-slug validator change rejects previously-accepted entries** | The Python orchestrator always writes a non-empty `expectedSlug` (derived from the plan filename). An empty slug would already cause broken UI links. This is a defence-in-depth measure. |
| **Banner-clearing tests rely on DOM structure of `resultsEl`** | Tests mirror the exact class names used in `orchestrator.js` (`success-banner`, `error-banner`). If these change, both prod code and tests break together — acceptable coupling. |
