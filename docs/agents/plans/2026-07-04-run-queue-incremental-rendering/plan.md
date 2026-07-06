# Plan

## Plan Audit Cycles
- Audits: none — Plan Auditor v1.5.0
- Architectural Reviews: none — Plan Architect Reviewer v1.6.0

## Prior Project Context
No prior projects directly address GUI rendering strategy. The existing in-place patching pattern in `project-detail-orch.js` (`_orchRunsStructureKey` / `_patchOrchStatusCard`) provides the closest precedent — this plan supersedes that bespoke approach for the queue table with a general-purpose DOM morphing utility.

## Summary

Replace the full innerHTML-rebuild rendering strategy in the orchestrator run queue view (`views/orchestrator.js`) with a **morphdom-based DOM morphing approach combined with event delegation**. The current implementation rebuilds the entire `<table>` on every 5-second poll tick, causing screen flickering, scroll position loss, admin menu closure, and log preview widget restarts. The new approach vendors [morphdom](https://github.com/patrick-steele-idem/morphdom) (~10 KB minified, 0 dependencies, MIT) and replaces `_bindQueueActions` with a single delegated click handler on the table element, eliminating all bespoke diff/patch code and the post-render event binding pattern for this view.

This plan is informed by the research report at `docs/agents/research/2026-07-04-run-queue-incremental-rendering.md`, which evaluated five rendering strategies and recommended morphdom + event delegation as the best engineering solution when the zero-dependency stance can flex.

## Architectural Context

The GUI is a vanilla ES5 SPA with no build step, no frameworks, and IIFE module namespaces (constraints §1–§3 in `mcp-server/gui/docs/agents/project-manifest/constraints.md`). All rendering uses string concatenation → `innerHTML` assignment → post-render event binding (constraint §13).

The orchestrator view (`views/orchestrator.js`) renders a "Run Queue" table via polling:

1. `Router._setPolling(refreshQueue, 5000)` fires every 5 seconds.
2. `refreshQueue()` drains all `_orchLogPreviewCleanups`, fetches `API.orchestratorGetQueue()`, and calls `renderQueueTable()`.
3. `renderQueueTable()` saves `window.scrollY`, replaces `container.innerHTML` with `_buildQueueHtml()` output, then calls `_bindQueueActions()` and `_mountLogPreviews()`, and restores scroll.

The `libs/` directory already contains one vendored library (`marked.min.js`), establishing precedent for bundling small, zero-dependency utilities.

The `project-detail-orch.js` module implements a bespoke variant of incremental rendering using structure keys and manual `innerHTML` patching. morphdom would simplify that module too (future work, out of scope for this plan).

### Current action button rendering

`_bindQueueActions` iterates entries post-render and uses `OrchestratorWidgets.renderKillButton()`, `renderDismissButton()`, and `renderAdminMenu()` to create DOM elements with event listeners already attached, then appends them to the actions `<td>`. This pattern is incompatible with morphdom because morphdom operates on HTML strings and cannot preserve dynamically-created DOM subtrees with attached listeners. Event delegation solves this by moving all listener logic to a single table-level handler.

## Approach / Architecture

**Two changes working together:**

### 1. morphdom for DOM diffing

Instead of replacing `container.innerHTML` and destroying all DOM state, the new approach:
- Builds the new HTML string as before via `_buildQueueHtml()` (the existing function, extended to include action button markup inline).
- Creates a temporary `<div>`, assigns the HTML, and calls `morphdom(existingTable, newTable, options)`.
- morphdom diffs the real DOM against the new HTML and applies minimal patches — unchanged elements, their CSS classes, focus state, and scroll position survive automatically.
- The `getNodeKey` option uses `data-entry-id` attributes to match rows by identity, not position.
- The `onBeforeElUpdated` hook skips updating admin menus that have the `is-open` class and log preview containers that have active widgets.

### 2. Event delegation for action buttons

Instead of attaching individual listeners to each button post-render:
- `_buildQueueHtml()` is extended to render action buttons as static HTML with `data-action` and `data-entry-id` attributes.
- A single click handler is attached to the `#orch-queue-container` element once (at view init time, not per-render).
- The handler inspects `event.target.closest('[data-action]')` to determine which action was clicked.
- This eliminates `_bindQueueActions()` entirely and means morphdom can freely morph action cells without losing listeners.

### First-render fallback

On the very first render (or when morphing from the empty-state message to a table), there is no existing `<table>` to morph. The code detects this and falls back to a plain `innerHTML` assignment. Subsequent ticks use morphdom.

## Rationale

- **Eliminates bespoke diff code.** No `_patchQueueRow`, `_patchQueueTable`, or `_queueStructureKey` functions. No dual render/patch paths that must be kept in sync. Adding a new column means changing only `_buildQueueHtml()`.
- **Handles all edge cases automatically.** Row additions, removals, reordering, mixed content changes, empty↔non-empty transitions are handled by morphdom's tree-diffing algorithm.
- **Proven library.** morphdom is used by Phoenix LiveView, htmx, and Marko for the exact same use case (live DOM patching from server-rendered HTML). 562K weekly npm downloads, MIT license, v2.7.8 stable.
- **Small, vendorable, zero-dependency.** ~10 KB minified, ~4 KB gzipped. Ships as a UMD file loadable via `<script>` tag. No build step required. ES5-compatible internally.
- **Event delegation is simpler.** One handler replaces four per-entry binding loops. The handler naturally works on new/changed buttons without re-binding.
- **Precedent exists.** `libs/marked.min.js` is already vendored. This is the second client-side utility, not the first.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| DOM update strategy | morphdom library diffing | (A) Per-cell bespoke patching (original plan); (B) Coarse two-tier fingerprint + elapsed-only fast path; (C) WebSocket push | (A) high maintenance burden with dual render/patch paths; (B) solves 95% of ticks but still flickers on status changes; (C) requires server-side SSE/WS infrastructure (constraint §15) |
| Event binding | Table-level event delegation | (A) Post-render per-button binding (current pattern); (B) morphdom `onElUpdated` hook re-binding | (A) incompatible with morphdom since createElement'd buttons lose listeners on morph; (B) complex and fragile — delegation is simpler and more maintainable |
| Action button rendering | Inline HTML with data- attributes | (A) DOM-created elements via OrchestratorWidgets (current) | (A) requires post-render binding step; inline HTML is morphdom-compatible and delegation-friendly |

## Pattern Alignment

- **Vendored library convention:** Follows the established pattern of `libs/marked.min.js` — small, zero-dependency UMD file loaded via `<script>` tag.
- **ES5 IIFE pattern:** All new application code uses `var`, `function` declarations, string concatenation (constraint §2). morphdom's UMD bundle is ES5 internally.
- **HTML generation convention:** `_buildQueueHtml()` continues to build HTML via string concatenation and `escapeHtml()` (constraint §13). Departure: action buttons are now rendered as HTML strings inside `_buildQueueHtml()` rather than DOM-created elements appended post-render. This is a simplification, not a violation — inline HTML is the standard pattern in every other cell.
- **Polling convention:** Retains `Router._setPolling(refreshQueue, 5000)` (constraint §11).
- **Cleanup drain pattern:** `_orchLogPreviewCleanups` drain occurs only when morphdom cannot match a log preview row (row removed). On data-only ticks, morphdom's `onBeforeElUpdated` hook preserves log preview containers, so no drain is needed.

## Detailed Steps

### Step 1: Vendor morphdom

Download `morphdom-umd.min.js` (v2.7.8) from the [npm registry](https://unpkg.com/morphdom@2.7.8/dist/morphdom-umd.min.js) and save it to `mcp-server/gui/public/libs/morphdom-umd.min.js`.

### Step 2: Add morphdom script tag to index.html

Add `<script src="/libs/morphdom-umd.min.js?v=1"></script>` to `mcp-server/gui/public/index.html`, before the `orchestrator-widgets.js` script tag (so `morphdom` is available as a global when `orchestrator.js` loads). Increment the `?v=N` parameter on `views/orchestrator.js`.

### Step 3: Extend `_buildQueueHtml()` to render action buttons inline

Currently `_buildQueueHtml()` emits an empty `<td class="orch-actions-cell">` and `_bindQueueActions()` populates it post-render. Change `_buildQueueHtml()` to emit the action button HTML directly inside the actions cell:

- **Kill button** (when `status === 'pending'`): `<button type="button" class="btn btn-danger btn-sm orchestrator-kill-btn" data-action="kill" data-entry-id="…">Kill</button>`
- **Dismiss button** (when `status === 'dead'`): `<button type="button" class="btn btn-secondary btn-sm orch-queue-action-btn orchestrator-dismiss-btn" data-action="dismiss" data-entry-id="…">Dismiss</button>`
- **View Project link** (when `entry.projectExists && entry.expectedRepo && entry.expectedSlug`): `<a href="#/projects/…" class="btn btn-sm btn-secondary orch-queue-action-btn">View Project</a>`
- **Admin menu** (always): Render the kebab menu as static HTML with `data-action="admin-toggle"` on the trigger button and `data-action="admin-delete"` on the delete item, plus `data-entry-id` on the wrapper. The menu wrapper gets `class="action-menu-wrapper orch-admin-menu-wrapper"` and the menu body gets `class="action-menu orch-admin-menu"`.

The branch priority for action buttons mirrors the existing `_bindQueueActions` logic: pending → Kill, dead → Dismiss, projectExists → View Project.

### Step 4: Add table-level event delegation handler

Create a new closure-scoped function `_bindQueueDelegation(container)` that attaches a single click handler to the `#orch-queue-container` element. This is called once from `renderOrchestrator()`, not per-render.

The handler uses `event.target.closest('[data-action]')` to dispatch:

| `data-action` | Behavior |
|---|---|
| `"kill"` | `window.confirm()` → `API.orchestratorKill(entryId)` → `refreshQueue()` |
| `"dismiss"` | `API.orchestratorDismiss(entryId)` → `refreshQueue()` |
| `"admin-toggle"` | Toggle `is-open` class on the closest `.orch-admin-menu-wrapper`; close other open menus; `e.stopPropagation()` |
| `"admin-delete"` | Close menu → `window.confirm()` → `API.orchestratorDelete(entryId)` → `refreshQueue()` |

Row toggle clicks are handled separately via `event.target.closest('.orch-row-toggle')` → toggle `expandedIds[id]` → `refreshQueue()`.

The outside-click handler for admin menus is attached once on `document` within `_bindQueueDelegation` and simply removes `is-open` from all `.orch-admin-menu-wrapper.is-open` elements.

### Step 5: Modify `refreshQueue()` and `renderQueueTable()` to use morphdom

Replace the innerHTML rebuild in `renderQueueTable()` with morphdom diffing:

```javascript
function renderQueueTable(container, entries) {
  if (!entries.length) {
    // Drain log previews when transitioning to empty.
    _drainAllLogPreviews();
    container.innerHTML =
      '<p class="text-muted orch-empty-queue">No active runs in the queue.</p>';
    return;
  }

  _clearSuccessBanner();
  var newHtml = _buildQueueHtml(entries);
  var existingTable = container.querySelector('.orch-queue-table');

  if (existingTable) {
    // Morph path: diff existing table against new HTML.
    var temp = document.createElement('div');
    temp.innerHTML = newHtml;
    var newTable = temp.firstChild;
    morphdom(existingTable, newTable, {
      getNodeKey: function (node) {
        return node.getAttribute && node.getAttribute('data-entry-id');
      },
      onBeforeElUpdated: function (fromEl, toEl) {
        // Preserve open admin menus.
        if (fromEl.classList && fromEl.classList.contains('is-open')) {
          return false;
        }
        // Preserve active log preview containers.
        if (fromEl.getAttribute && fromEl.getAttribute('data-preview-active') === '1') {
          return false;
        }
        return true;
      },
      onBeforeNodeDiscarded: function (node) {
        // When a log preview row is being removed, drain its cleanup.
        if (node.classList && node.classList.contains('orch-log-row')) {
          var entryId = node.getAttribute('data-entry-id');
          if (entryId) _drainLogPreviewForEntry(entryId);
        }
        return true;
      }
    });
  } else {
    // First render or transition from empty state: no existing table.
    container.innerHTML = newHtml;
  }

  _mountLogPreviews(container, entries);
}
```

Remove the bulk `_orchLogPreviewCleanups` drain from the top of `refreshQueue()`. The bulk drain in `renderOrchestrator()` (full view re-render on route entry) remains unchanged.

### Step 6: Convert `_orchLogPreviewCleanups` to a keyed map

Replace the flat `_orchLogPreviewCleanups` array with an object `_orchLogPreviewCleanupMap = {}` keyed by entry ID. This enables targeted cleanup when morphdom discards a single row.

- `_mountLogPreviews()` stores `_orchLogPreviewCleanupMap[entryId] = cleanup`.
- `_drainLogPreviewForEntry(entryId)` invokes and deletes the entry's cleanup.
- `_drainAllLogPreviews()` invokes all cleanups and resets the map (used by `renderOrchestrator()` and the empty-state transition).
- `_mountLogPreviews()` must be idempotent: skip mounting if `_orchLogPreviewCleanupMap[entryId]` already exists.

The module-level `_orchLogPreviewCleanups` array is replaced. All existing drain sites (`renderOrchestrator()` full view re-render) are updated to call `_drainAllLogPreviews()`.

### Step 7: Remove `_bindQueueActions()`

Delete the `_bindQueueActions()` function entirely. Its responsibilities are now split between:
- `_buildQueueHtml()` (action button HTML rendering)
- `_bindQueueDelegation()` (event handling via delegation)

Remove the scroll save/restore (`window.scrollY` / `window.scrollTo`) from `renderQueueTable()` — morphdom preserves scroll position automatically since the DOM is not destroyed.

### Step 8: Update version bust parameter

Increment the `?v=N` query parameter for `views/orchestrator.js` in `mcp-server/gui/public/index.html`.

### Step 9: Update GUI manifest documentation

- Update `mcp-server/gui/docs/agents/project-manifest/data-flows.md` to add a new section documenting the queue table's morphdom-based rendering strategy.
- Update `mcp-server/gui/docs/agents/project-manifest/constraints.md` §11 (Polling Convention) to reference the queue table's morphdom-based incremental update pattern.
- Update `mcp-server/gui/docs/agents/project-manifest/constraints.md` to add a new constraint documenting the vendored-library policy (morphdom is the second vendored lib after marked.min.js; document the criteria: zero-dependency, UMD, MIT, < 20 KB minified).
- Update `mcp-server/gui/docs/agents/project-manifest/file-tree.md` to add the `libs/morphdom-umd.min.js` entry.

## Dependencies

- **morphdom v2.7.8** — vendored as `libs/morphdom-umd.min.js` (~10 KB minified, 0 dependencies, MIT license). Downloaded from npm/unpkg, not installed via npm.
- No backend API changes.
- No new npm/pip dependencies in `package.json`.

## Required Components

- `mcp-server/gui/public/libs/morphdom-umd.min.js` — **new file** (vendored library)
- `mcp-server/gui/public/views/orchestrator.js` — main implementation changes (steps 3–7)
- `mcp-server/gui/public/index.html` — add morphdom script tag + version bust (steps 2, 8)
- `mcp-server/gui/docs/agents/project-manifest/data-flows.md` — documentation (step 9)
- `mcp-server/gui/docs/agents/project-manifest/constraints.md` — documentation (step 9)
- `mcp-server/gui/docs/agents/project-manifest/file-tree.md` — documentation (step 9)

## Assumptions

- Queue entry `id` fields are stable UUIDs that persist across poll ticks for the lifetime of the entry.
- The entry ordering returned by the API is deterministic (same entries in same order between ticks unless a structural change occurred).
- The number of concurrent queue entries is small (typically 1–5), so morphdom's tree diff is negligible cost.
- morphdom v2.7.8 UMD bundle is ES5-compatible (verified: the library targets IE9+).
- `window.morphdom` is available as a global after the UMD script loads (standard UMD behavior).

## Constraints

- ES5-compatible JavaScript only for application code (constraint §2). morphdom's UMD bundle is ES5 internally.
- No build tools (constraint §1). morphdom is loaded via `<script>` tag from the vendored file.
- All user text must pass through `escapeHtml()` (constraint §13).
- Must work with the existing `Router._setPolling` lifecycle (constraint §11).

## Out of Scope

- Applying morphdom to other views (`project-detail-orch.js`, `project-list.js`, `insights.js`). The pattern can be reused later but is not part of this plan.
- Refactoring `OrchestratorWidgets.renderKillButton()`, `renderDismissButton()`, or `renderAdminMenu()` — these functions still exist and are used by `project-detail-orch.js`. The queue table simply no longer calls them.
- WebSocket-based push notifications.
- Refactoring the log preview widget's own polling mechanism.
- Changes to the backend queue API response format.

## Acceptance Criteria

1. When the queue has active entries and the poll fires, the page does not visually flicker.
2. The admin kebab menu (⋮) remains open across poll ticks when no structural change occurs.
3. The scroll position within the page is preserved across poll ticks without the save/restore workaround.
4. Log preview widgets in expanded rows continue uninterrupted across poll ticks (no visible restart or re-fetch of already-displayed entries).
5. The elapsed time column updates on every tick.
6. Status, progress, and action cells update correctly when their underlying data changes.
7. When an entry is added or removed from the queue, the table updates correctly (morphdom handles additions/removals).
8. Row expand/collapse toggle still works correctly.
9. Kill, Dismiss, Delete, and View Project actions still function.
10. The "No active runs" empty state renders correctly when the queue transitions to empty.
11. morphdom library file is vendored (not fetched from CDN at runtime).

## Testing Strategy

Manual testing with a running orchestrator instance, verifying each acceptance criterion visually. The GUI has no automated frontend test suite (known limitation), so testing focuses on interactive verification across the key scenarios.

## Test Plan

- **Manual: Flicker test** — Start an orchestrator run, observe the queue table across multiple poll cycles; confirm no visible flicker or flash of content — covers AC 1.
- **Manual: Admin menu persistence** — Open the admin kebab menu on a running entry, wait for 2+ poll ticks; confirm the menu stays open — covers AC 2.
- **Manual: Scroll preservation** — Scroll down on the orchestrator page, wait for poll ticks; confirm scroll position is stable without visible jumps — covers AC 3.
- **Manual: Log preview continuity** — Expand a running entry's log preview, observe across poll ticks; confirm log entries are not re-fetched and the preview continues appending new entries smoothly — covers AC 4.
- **Manual: Elapsed update** — Observe the elapsed column while a run is active; confirm it updates every ~5 seconds — covers AC 5.
- **Manual: Status transition** — Kill a running entry; confirm the status badge changes to "Dead" and the action button changes from Kill to Dismiss — covers AC 6.
- **Manual: Entry addition** — Start a new orchestrator run while viewing the queue; confirm the new row appears correctly — covers AC 7.
- **Manual: Entry removal** — Dismiss a dead entry; confirm it disappears from the table — covers AC 7.
- **Manual: Row toggle** — Click expand/collapse on a row; confirm it works and persists across poll ticks — covers AC 8.
- **Manual: Action buttons** — Test Kill, Dismiss, Delete, View Project buttons; confirm each works — covers AC 9.
- **Manual: Empty state** — Dismiss all entries; confirm "No active runs" message appears — covers AC 10.
- **Manual: Verify morphdom loaded** — Open browser DevTools console, confirm `window.morphdom` is a function — covers AC 11.

## Documentation Updates

- `mcp-server/gui/docs/agents/project-manifest/data-flows.md` — Add new section documenting the queue table's morphdom-based rendering strategy (morphdom call, event delegation, log preview preservation hooks).
- `mcp-server/gui/docs/agents/project-manifest/constraints.md` — Extend §11 (Polling Convention) to reference the queue table's morphdom-based incremental update pattern. Add new constraint documenting the vendored-library policy.
- `mcp-server/gui/docs/agents/project-manifest/file-tree.md` — Add `libs/morphdom-umd.min.js` entry.

## Deferred Items

| # | Deferred Item | Origin | Reason Deferred | Notes |
|---|---------------|--------|-----------------|-------|
| 1 | Apply morphdom to `project-detail-orch.js` | Research report, Pattern 2 evaluation | Scope containment — prove the pattern on the queue table first | Would replace `_orchRunsStructureKey` / `_patchOrchStatusCard` with a single morphdom call; worth evaluating after queue table ships |
| 2 | Decouple elapsed timer from polling | Research report, "Elapsed Timer via requestAnimationFrame" | Orthogonal optimization — can be layered on later | A local 1-second timer updating elapsed cells via `textContent` would mean polls only fetch server-derived data; when nothing server-side changed, morphdom produces zero patches |
| 3 | Conditional fetch (ETag / If-None-Match) | Research report, Pattern 5 | Complementary server-side optimization, out of scope for frontend rendering | Reduces network overhead for idle queues; does not solve DOM destruction |

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **morphdom mismatches keyed elements** — Rows could be matched by position instead of identity if `data-entry-id` is missing or empty. | The `getNodeKey` callback extracts `data-entry-id` from `<tr>` elements. `_buildQueueHtml()` always sets this attribute. Empty IDs fall through to positional matching, which is correct for the `<thead>` row. |
| **Admin menu loses `is-open` state** — morphdom could overwrite the menu wrapper's class list. | The `onBeforeElUpdated` hook returns `false` for elements with the `is-open` class, skipping them entirely. When the menu is closed, morphdom can freely update it. |
| **Log preview widgets restart on morph** — morphdom could replace the preview container's contents. | `_mountLogPreviews()` marks active containers with `data-preview-active="1"`. The `onBeforeElUpdated` hook skips elements with this attribute, preserving the live widget. Targeted cleanup via `onBeforeNodeDiscarded` handles row removal. |
| **Event delegation misses dynamically-created elements** — If a widget creates DOM outside the delegated pattern. | All interactive elements in the queue table are now rendered as static HTML by `_buildQueueHtml()`. No widget creates interactive DOM outside this path. The admin menu's open/close is handled by the delegation handler. |
| **morphdom version drift** — Vendored file becomes outdated. | Pin to v2.7.8 in the filename comment and the constraints doc. The library is stable (last major release in 2016, maintenance releases only). |
| **New dependency resistance** — morphdom is the first client-side logic dependency (marked is a formatting utility). | morphdom is MIT, zero-dependency, 10 KB, and solves the problem categorically. The alternative (bespoke per-cell patching) has higher maintenance cost and bug risk as documented in the research report. |