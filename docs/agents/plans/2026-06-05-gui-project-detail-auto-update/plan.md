# Plan

## Plan Audit Cycles
- Audits: none — Plan Auditor v1.5.0
- Architectural Reviews: none — Plan Architect Reviewer v1.6.0

## Summary
Make the GUI project detail page fully dynamic by adding periodic polling for all project-related data (WP statuses, synthesis availability, project status, health badge) and fix the orchestrator runs section to update without flicker or scroll position loss by using targeted DOM patching instead of full innerHTML rebuilds.

## Architectural Context

The GUI is a vanilla-JS SPA served by `mcp-server/gui/server.ts`. Key architecture:

- **Router** (`gui/public/router.js`): Hash-based routing with a single `_setPolling(fn, delay)` / `_clearPolling()` mechanism — only one interval per view.
- **Project Detail** (`gui/public/views/project-detail.js`): `renderProjectDetail(app, repo, slug)` fetches all data in a single `Promise.all` call, builds the entire DOM via `innerHTML`, then attaches event listeners. No auto-refresh for the main content section.
- **Orchestrator Runs subsection**: Loaded asynchronously after the main render. When an active run exists, it uses `Router._setPolling(pollQueue, 5000)` which calls `renderRunsList(match)` — a full `innerHTML` rebuild of the runs list every 5 seconds.
- **Log Preview Widget** (`js/orchestrator-widgets.js`): `renderLogPreview()` correctly uses incremental append (prepends new entries) and maintains its own interval separately from the router polling.
- **Project List** (`views/project-list.js`): Uses full `innerHTML` rebuilds with 10s polling — the current pattern, but unsuitable for detail pages with more complex interactive state.

Relevant files:
- `mcp-server/gui/public/views/project-detail.js` — primary target
- `mcp-server/gui/public/router.js` — polling infrastructure
- `mcp-server/gui/public/api-client.js` — API calls
- `mcp-server/gui/public/js/orchestrator-widgets.js` — shared widgets
- `mcp-server/gui/public/utils.js` — shared helpers (`statusBadge`, `formatDate`)

## Approach / Architecture

### 1. Project Detail Polling (Auto-Update)

Add a periodic poll (every 8 seconds) that re-fetches the project data and updates only the changed DOM elements in-place, rather than rebuilding the entire page. This selective update approach:
- Preserves interactive state (open modals, inline edits, scroll position)
- Avoids re-attaching event listeners
- Is lightweight (compare-and-swap on text content / attributes)

The poll function will:
1. Fetch `getProject()`, `getWorkPackageOverview()`, and `getSynthesisDocument()` (HEAD-like, just checking availability)
2. Compare the response against the last-known state
3. Patch only the DOM nodes that changed (WP status badges, pipeline track badges, synthesis link visibility, project status badge, health badge, timing info)

When a **structural change** occurs that cannot be patched incrementally (e.g., new WP added, WP removed, project status transitions to COMPLETE/ARCHIVED), perform a full re-render — this is acceptable since structural changes are rare.

### 2. Orchestrator Runs — Flicker-Free Updates

Replace the `renderRunsList(match)` innerHTML rebuild with a targeted DOM-patching strategy:
- Keep the runs list container stable across polls
- Update only the status card, elapsed time, badges, and progress text in-place
- When the list of runs itself changes (new run appears or run transitions from active to inactive), do a one-time structural re-render but preserve scroll position by saving/restoring `scrollTop` on the nearest scrollable ancestor.

## Rationale

- **Targeted DOM patching over full rebuild**: Full `innerHTML` rebuilds cause flicker because the browser must tear down and recreate all DOM nodes, re-layout, and repaint. Targeted updates only touch changed attributes/text, producing zero visual disruption.
- **8-second poll interval for main data**: Balances responsiveness with server load. Pipeline stages typically take minutes; 8s latency is imperceptible to users.
- **Structural re-render as fallback**: Handling every possible structural mutation incrementally would add disproportionate complexity. A full re-render for rare structural changes (WP additions/removals) is the pragmatic choice.
- **No WebSocket/SSE**: The GUI server is a minimal `node:http` server with no WebSocket infrastructure. Polling is the established pattern and sufficient for the update frequencies involved.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Update mechanism | Periodic polling + DOM patching | WebSocket/SSE push | Polling is the established SPA pattern here; adding WS infrastructure for a single page is disproportionate |
| DOM update strategy | Compare-and-swap on specific elements | Virtual DOM / morphdom library | Zero-dependency constraint for GUI assets; targeted updates on known DOM structure are simpler and sufficient |
| Poll scope | Re-fetch full project + overview per poll | Etag/conditional GET, delta API | Server has no etag support; full re-fetch of small JSON payloads (~2-5 KB) is negligible |
| Structural change handling | Full re-render with scroll preservation | Incremental insert/remove of rows | Row-level incremental DOM ops add complexity for a rare event (WP added mid-run); full re-render is cleaner |

## Pattern Alignment

- **Router polling pattern** (`router.js` → `_setPolling`): This plan follows the existing single-interval-per-view pattern. The project detail will register one combined poll function.
- **Incremental log preview** (`orchestrator-widgets.js` → `renderLogPreview`): The log preview already demonstrates the prepend-only incremental update pattern. The runs section will follow a similar approach for its status card.
- **Full innerHTML rebuild** (`project-list.js` → `render()`): This plan **departs** from the project-list's full-rebuild pattern because the project detail page has richer interactive state (inline edits, modals, log preview widgets) that cannot survive a full DOM rebuild. Justification: the project-list has minimal interactive state (only search focus), so full rebuilds are tolerable there.

## Detailed Steps

### Step 1: Extract State Snapshot Helper

Create a helper function `_snapshotProjectState(project, overviewResult)` that extracts a comparable state object from the API responses:
```js
{ 
  status, last_updated, synthesis_generated, 
  wpStatuses: { [wpId]: { status, pipelineStages: [...] } },
  health: null | { work_packages_needing_reset }
}
```

### Step 2: Add DOM Patch Functions

Create targeted update functions within `project-detail.js`:

- `_patchProjectStatus(newStatus)` — updates the status badge in the page header
- `_patchWpRow(wpId, newStatus, newPipelineTrack)` — updates a single WP row's status badge and pipeline track cells in-place
- `_patchSynthesisLink(visible)` — shows/hides the synthesis link row
- `_patchHealthBadge(health)` — updates the health badge text and class
- `_patchTimingInfo(timing)` — updates the timing display

### Step 3: Implement the Poll Function

Add `_pollProjectDetail(app, repo, slug, lastState)` that:
1. Fetches `getProject(repo, slug)` and `getWorkPackageOverview(repo, slug)` in parallel
2. Builds a new state snapshot
3. Compares against `lastState`
4. If only data values changed → call targeted DOM patch functions
5. If structural change detected (WP count differs, project transitioned to ARCHIVED) → call `renderProjectDetail(app, repo, slug)` for a full re-render
6. Returns the new state for next comparison

### Step 4: Register Polling After Initial Render

At the end of `renderProjectDetail`, after the orchestrator runs section is set up:
1. Build the initial state snapshot from the already-fetched data
2. Store it in a module-scoped variable (`_lastDetailState`)
3. Register a combined poll function via `Router._setPolling` that handles both:
   - The main project data refresh (every cycle)
   - The orchestrator queue refresh (only when an active run exists)

**Important**: This replaces the current separate `Router._setPolling(pollQueue, 5000)` in the orchestrator runs section. The combined poll will run at 5s to maintain the existing orchestrator responsiveness, with the main data check occurring every cycle (the overhead of one additional API call per 5s is negligible).

### Step 5: Fix Orchestrator Runs — Scroll Preservation

Modify the `renderRunsList(matchingQueueEntry)` function:
1. Before rebuilding, save `scrollTop` of the `#orchestrator-runs-section` element (or nearest scrollable ancestor)
2. After rebuilding, restore `scrollTop`

### Step 6: Fix Orchestrator Runs — Status Card In-Place Update

Refactor the active-run section update path:
1. On first render, tag the status card container with a known ID (`orch-status-card-container`)
2. On subsequent polls, if the runs list structure hasn't changed (same filenames, same active run):
   - Update the status card HTML in-place via `innerHTML` on just the card container
   - Update badge text (Running/elapsed time) directly
   - Do NOT rebuild the runs list or log preview
3. If the runs list structure HAS changed (new run appeared, or active run became inactive):
   - Do the full `renderRunsList` rebuild with scroll preservation (Step 5)

### Step 7: Detect Run Completion and Show Synthesis

When the poll detects:
- The project status changed from `IN_PROGRESS` to `COMPLETE`
- OR `synthesis_generated` becomes `true`

Smoothly reveal the synthesis link row (it's pre-rendered as hidden, or inject it if absent). This ensures the user sees the synthesis appear automatically when the orchestrator run completes.

## Dependencies
- No new npm dependencies
- No changes to the API server or endpoints
- All changes confined to `mcp-server/gui/public/views/project-detail.js`

## Required Components
- `mcp-server/gui/public/views/project-detail.js` — all implementation changes
- `mcp-server/gui/public/router.js` — no changes needed (existing `_setPolling` is sufficient)

## Assumptions
- The API responses for `getProject` and `getWorkPackageOverview` are cheap enough to call every 5 seconds without concern for server performance (they read from local JSON files with no network I/O).
- The DOM structure of the WP table rows and status badges is stable and can be targeted by index or data attributes.
- The orchestrator runs section's `renderRunsList` closure can be refactored to separate structural changes from data-only changes without breaking the kill/dismiss button handlers.

## Constraints
- No external libraries may be added to `gui/public/` (zero-dependency SPA constraint).
- All JS must remain ES5-compatible IIFE/function style (no ES modules, no build step).
- The `Router._setPolling` mechanism supports only one interval per view — the poll function must be a single combined handler.
- CSP enforces `script-src 'self'` — no inline scripts.

## Out of Scope
- WebSocket or Server-Sent Events infrastructure
- Changes to the API server endpoints or response schemas
- Auto-update for other views (project-list already has 10s polling; knowledge page is human-curated)
- Work package detail page auto-update (separate concern)

## Acceptance Criteria
1. Work package pipeline stage badges update automatically when stages progress (within 5-8 seconds)
2. The synthesis link row appears automatically when a synthesis document becomes available
3. The project status badge updates automatically when the project status changes
4. The health badge refreshes automatically to reflect current project health
5. The orchestrator runs section updates without visible flicker (no full-page flash)
6. Scroll position in the orchestrator runs section is preserved across poll updates
7. Inline edit mode (title rename, slug rename) is NOT disrupted by background polls
8. Log preview widgets continue to function correctly alongside the new polling
9. Navigating away and back still works correctly (cleanup on route change)
10. No regressions in the reset modal, archive/unarchive flow, or resume button

## Testing Strategy

Manual testing via the GUI with an active orchestrator run:
1. Start an orchestrator run and observe the project detail page — verify WP stages animate through states in real-time
2. Let a run complete — verify the synthesis link appears without manual refresh
3. Scroll down in the orchestrator runs section — verify scroll position is maintained across updates
4. Open the inline title editor during an active poll — verify the editor is not destroyed
5. Verify browser DevTools shows no console errors during polling
6. Verify no observable flicker in the runs list during updates

Automated tests (Vitest):
- Unit test the `_snapshotProjectState` helper with mock data
- Unit test the diff logic (detect structural vs. data-only changes)
- Unit test `buildPipelineTrack` still produces correct output (regression guard)

## Test Plan

- `mcp-server/tests/gui/project-detail-snapshot.test.ts` — Tests `_snapshotProjectState` correctly extracts comparable state from project + overview API responses — covers AC 1-4
- `mcp-server/tests/gui/project-detail-diff.test.ts` — Tests the diff/comparison logic: detects data-only changes vs. structural changes (WP count change, status transitions); exercises the decision between targeted patch and full re-render — covers AC 1-4, 7
- `mcp-server/tests/gui/project-detail-scroll.test.ts` — Tests scroll preservation logic: saves and restores scrollTop around innerHTML rebuild — covers AC 5-6

## Documentation Updates

- `mcp-server/docs/agents/project-manifest/file-tree.md` — No new files being created (all changes to existing `project-detail.js`); no update needed
- `mcp-server/docs/agents/project-manifest/api-surface.md` — No API changes; no update needed
- `mcp-server/changelog.md` — Add entry documenting the auto-update feature and flicker fix

## Risks & Mitigations
| Risk | Mitigation |
|------|------------|
| **Polling races with user actions** (e.g., user clicks Reset during a poll response) | Poll function checks for open modals / active inline edits and skips DOM patching when interactive state is active |
| **Stale DOM references after full re-render** | All DOM queries are performed fresh inside each patch function (no cached element references across polls) |
| **Memory leaks from orphaned intervals** | Combined poll uses the existing `Router._setPolling` which auto-clears on route change; log preview cleanups are drained before each structural re-render |
| **Increased server load from polling** | The payloads are small JSON files served from disk; 5s interval for a single client is negligible |
| **Race between orchestrator poll and main data poll** | Unified into a single combined poll function — eliminates the possibility of interleaved DOM mutations |
