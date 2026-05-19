# Plan

## Plan Audit Cycles
- Audits: none — Plan Auditor v1.3.0
- Architectural Reviews: 1 (findings applied) — Plan Architect Reviewer v1.4.0

## Summary

Polish the orchestrator GUI run queue view with five targeted fixes: (1) hide the "View Project" button until the project ledger actually exists, (2) clear the launch success banner once the run appears in the queue, (3) display human-friendly labels in the log preview instead of raw JSONL action names (including tool names in `tool_call` entries), (4) reverse the log preview order so most recent entries appear on top, and (5) preserve scroll position across queue refresh cycles so the page doesn't jump back to the top every 5 seconds.

## Architectural Context

The orchestrator GUI is a vanilla-JS single-page application served by the MCP server's HTTP layer:

- **Frontend views:** `mcp-server/gui/public/views/orchestrator.js` — renders the "Start New Run" form and "Run Queue" table.
- **Shared widgets:** `mcp-server/gui/public/js/orchestrator-widgets.js` — `OrchestratorWidgets` namespace providing `renderProgressBadge()`, `renderLogPreview()`, action buttons, etc.
- **Backend queue:** `mcp-server/src/gui/queue/get-queue.ts` — reads `.run-queue.json`, enriches entries with `effectiveStatus`, `progress`, `lastAction`, and `logFilename`.
- **Progress formatting:** `mcp-server/src/gui/queue/format-progress-entry.ts` — maps JSONL entries to human-readable strings (used for the progress column).
- **Queue entry type:** `mcp-server/src/gui/queue/types.ts` — `QueueEntry` interface returned by the `/api/orchestrator/queue` endpoint.

The "View Project" button is rendered client-side when `effectiveStatus === 'started'` and `entry.expectedSlug` is truthy (orchestrator.js line ~253). However, `effectiveStatus` can transition to `'started'` before the project ledger exists (when process is alive + has stage activity), leading to a broken link.

The log preview (expandable row) polls `/api/projects/:slug/runs/:filename?after=N` and renders each JSONL entry's raw `action` field as text.

## Approach / Architecture

Four independent frontend changes, one minor backend addition:

1. **Backend:** Add a `projectExists` boolean to `QueueEntry` so the frontend can condition the "View Project" button on actual ledger existence rather than inferring it from `effectiveStatus`.

2. **Frontend — "View Project" button:** Gate the button on `entry.projectExists === true` (new field) instead of `status === 'started'`.

3. **Frontend — launch banner:** After each `refreshQueue()` call, check whether the queue contains an entry whose `id` or `planPath` matches the just-launched run. If found, clear the success banner. Alternatively, always clear the banner on the first successful queue render that contains at least one entry (simpler, no ID tracking needed).

4. **Frontend — log preview labels:** Add a `formatLogAction(entry)` helper in `orchestrator-widgets.js` that maps raw JSONL objects to human-friendly strings (reusing the same logic as `format-progress-entry.ts` but client-side). The log preview rendering loop will call this helper instead of displaying `entry.action` verbatim. The tool_call case will include `entry.tool_name` when available. This helper is scoped to the log preview only — the progress badge retains its current raw action string because the adjacent `entry.progress` text already provides human-friendly context.

5. **Frontend — preserve scroll position:** The `renderQueueTable` function currently sets `container.innerHTML = html` on every 5-second polling cycle, which destroys the entire DOM tree and resets the page scroll position to the top. Fix by capturing `window.scrollY` before the innerHTML replacement and restoring it with `window.scrollTo(0, savedY)` immediately after. Note: `#orch-queue-container` has no `overflow` or `max-height` CSS — the document viewport is the scrolling context, so `window.scrollY` is the correct target. This remains a 2-line, zero-risk change.

## Rationale

- Adding `projectExists` to the API response is trivial since the backend already computes this value (in `getQueue`); it just isn't currently exposed. This avoids heuristic guessing on the frontend.
- Clearing the banner on the first queue render that shows entries is the simplest approach — no run ID tracking or cross-component state needed.
- Duplicating the label map client-side (rather than having the backend format log entries) is justified because the log entries API returns raw JSONL objects, and the formatting must happen per-entry as they stream in. The frontend formatter is a small, self-contained map.
- Scroll-position preservation via `window.scrollY` save/restore is preferred over incremental DOM updates because: (a) it's a 2-line change, (b) it has no behavioural risk, and (c) the queue table is small enough that full re-rendering is not a performance concern. The viewport (not the container) is the scrolling element since `#orch-queue-container` has no overflow CSS.
- The `formatLogAction` helper is scoped to the log preview only — not the progress badge. The progress column already displays server-formatted `entry.progress` text (with tool names, stage names, etc.) next to the badge. The badge's purpose is a colour-coded category indicator; duplicating the adjacent label would add visual noise and require interface changes to `renderProgressBadge` (which takes a string, not a full entry object).

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| "View Project" gating | Expose `projectExists` flag from backend | Infer from `effectiveStatus` alone; poll project API on frontend | Direct flag is authoritative and zero-cost (already computed) |
| Banner clearing | Clear on first non-empty queue render | Track launched run ID and match it | Simpler; edge case of stale banner from prior launch is acceptable since page refresh resets |
| Log label formatting | Client-side map in `orchestrator-widgets.js` | Server-side pre-formatting; shared isomorphic module | Client-side map keeps the log entries API generic and raw; avoids duplication with `format-progress-entry.ts` which serves a different purpose (summary column) |
| Scroll preservation | Save/restore `window.scrollY` around innerHTML | `container.scrollTop` (wrong — container isn't scrollable); incremental DOM diffing; virtual DOM library | `window.scrollY` targets the actual scrolling element (viewport); save/restore is 2 lines, zero-risk, and performant for a table with < 20 rows; incremental DOM adds disproportionate complexity for this use case |
| Badge label formatting | Keep raw action string in badge (no change) | Pass full entry object to `renderProgressBadge` and use `formatLogAction` | The progress column already shows human-friendly `entry.progress` text next to the badge — the badge serves a different UX purpose (colour-coded category icon). Duplicating the label adds visual noise and requires interface surgery for no new information. |

## Pattern Alignment

- `mcp-server/src/gui/queue/types.ts` — existing pattern of extending `QueueEntry` with computed fields (`effectiveStatus`, `progress`, `lastAction`, `logFilename`). Adding `projectExists` follows this pattern exactly.
- `mcp-server/gui/public/js/orchestrator-widgets.js` — existing pattern of static helper functions inside the `OrchestratorWidgets` IIFE. Adding `formatLogAction` follows this pattern.
- `mcp-server/gui/public/views/orchestrator.js` — existing pattern of inline DOM manipulation in `renderQueueTable`. The banner-clearing logic fits inside the existing `refreshQueue` flow.

## Detailed Steps

1. **Add `projectExists` to `QueueEntry` type** — Add `projectExists: boolean` field to the `QueueEntry` interface in `mcp-server/src/gui/queue/types.ts`.

2. **Populate `projectExists` in `getQueue()`** — In `mcp-server/src/gui/queue/get-queue.ts`, set `projectExists: projectStatus.exists` when constructing the enriched result object.

3. **Gate "View Project" button on `projectExists`** — In `mcp-server/gui/public/views/orchestrator.js`, change the condition for rendering the "View Project" link from `status === 'started' && entry.expectedSlug` to `entry.projectExists && entry.expectedSlug`.

4. **Clear launch banner when run appears in queue** — In `mcp-server/gui/public/views/orchestrator.js`, after `renderQueueTable` renders a non-empty queue, clear the `#orch-preflight-results` element if it contains the success banner.

5. **Add `formatLogAction(entry)` to widgets** — In `mcp-server/gui/public/js/orchestrator-widgets.js`, add a function that maps a JSONL log entry object to a human-friendly string. Map:
   - `run_start` → `"Starting the run"`
   - `stage_start` → `"Starting stage: {stage}"` (include stage name if available)
   - `stage_complete` → `"Stage complete: {stage}"`
   - `progress_snapshot` → `"Progress snapshot"`
   - `tool_call` → `"Tool call: {tool_name}"` (fall back to `"Tool call"` if no name)
   - `wp_complete` → `"Work package complete: {wp_id}"`
   - `wp_status_change` → `"WP status → {new_status}"`
   - `run_end` → `"Run ended"`
   - `run_error` → `"Run error"`
   - `signal_shutdown` → `"Interrupted by signal"`
   - `heartbeat` → `"Heartbeat"`
   - `mcp_error` → `"MCP error"`
   - `route` → `"Routing decision"`
   - Default/unknown → title-case the raw action or show JSON

6. **Use `formatLogAction` in log preview rendering** — In `orchestrator-widgets.js` `renderLogPreview`, replace `div.textContent = action || JSON.stringify(entry)` with `div.textContent = formatLogAction(entry)`.

7. **Reverse log preview order (most recent on top)** — In `orchestrator-widgets.js` `renderLogPreview`, prepend new entries to the container (`container.insertBefore(div, container.firstChild)`) instead of appending them. This ensures the most recent log event is always visible at the top without scrolling.

8. **Preserve scroll position in `renderQueueTable`** — In `mcp-server/gui/public/views/orchestrator.js`, in the `renderQueueTable` function, before the `container.innerHTML = html` line, save `var scrollPos = window.scrollY;`. After the innerHTML assignment (and after all post-render DOM manipulation such as injecting action buttons and attaching event listeners), restore with `window.scrollTo(0, scrollPos);`. Note: `#orch-queue-container` has no overflow CSS — the viewport is the scrolling context.

9. **Update tests** — Update `format-progress-entry.test.ts` if the module interface changes (it doesn't — this is client-side only). Add/adjust the test for the new `projectExists` field in the queue test.

## Dependencies

- None — all changes are within the MCP server GUI sub-project.

## Required Components

- `mcp-server/src/gui/queue/types.ts` — add `projectExists` field
- `mcp-server/src/gui/queue/get-queue.ts` — populate new field
- `mcp-server/gui/public/views/orchestrator.js` — banner clearing + button gating
- `mcp-server/gui/public/js/orchestrator-widgets.js` — `formatLogAction` helper + usage in `renderLogPreview`
- `mcp-server/tests/gui/queue/resolve-progress.test.ts` or `get-queue` test — verify `projectExists` in output

## Assumptions

- The `projectExists` value computed in `get-queue.ts` (line 155: `projectStatus.exists`) accurately reflects whether navigating to the project detail view would succeed.
- Log entries returned by `/api/projects/:slug/runs/:filename` are raw JSONL objects with an `action` field and optional contextual fields (`tool_name`, `stage`, `wp_id`, `new_status`, `result`).
- The success banner is the only child of `#orch-preflight-results` after a successful launch.

## Constraints

- No new npm dependencies.
- Must work across all browsers supported by the dashboard (evergreen browsers — no legacy IE).
- Pure vanilla JS in the frontend (no build step, no modules).

## Out of Scope

- Restyling or redesigning the queue table layout.
- Adding WebSocket-based real-time updates (current 5s polling is retained).
- Localization / i18n of the human-friendly labels.
- Server-side formatting of log entries.

## Acceptance Criteria

- AC-1: "View Project" button is NOT shown when `projectExists` is `false`, even if `effectiveStatus` is `'started'`.
- AC-2: "View Project" button IS shown when `projectExists` is `true` and `effectiveStatus` is `'started'`.
- AC-3: The "Waiting for the run to appear in the queue below…" success banner is automatically cleared once the queue table renders with at least one entry.
- AC-4: Log preview entries display human-friendly labels (e.g. "Starting the run", "Tool call: ledger_help") instead of raw action names.
- AC-5: `tool_call` entries in the log preview include the tool name (e.g. "Tool call: ledger_help").
- AC-6: Log preview entries are ordered most-recent-first (newest at the top).
- AC-7: Scrolling position within the queue table is preserved across 5-second refresh cycles — the view does not jump back to the top.

## Testing Strategy

- **Unit test:** Verify `projectExists` is correctly populated in the queue output by testing `getQueue()` with mocked filesystem data.
- **Manual test:** Launch an orchestrator run from the GUI and verify: (a) banner clears when run appears, (b) "View Project" button only appears once the project ledger is created, (c) log preview shows human-friendly labels with tool names, (d) scrolling down the page and waiting for a refresh cycle does not reset the scroll position.

## Test Plan

- `mcp-server/tests/gui/queue/get-queue.test.ts` (or relevant test file) — Assert that `QueueEntry` objects returned by `getQueue()` include `projectExists: true` when ledger exists, and `projectExists: false` when it does not. — AC-1, AC-2
- `mcp-server/tests/gui/queue/format-progress-entry.test.ts` — No changes needed (backend formatter is unchanged).
- Manual verification via `http://localhost:3420/#/orchestrator` — AC-1 through AC-7.

## Documentation Updates

- `mcp-server/docs/agents/project-manifest/api-surface.md` — Add `projectExists: boolean` to `QueueEntry` interface documentation (if `QueueEntry` is documented there).

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Banner clearing fires too early (before the user's run appears)** | The banner is only set after a successful start, and queue polling runs every 5s. Even if a stale run is already in the queue, clearing the banner is acceptable because the user sees their run appearing. |
| **`projectExists` always true for started runs** | The backend distinction is clear: `projectExists` is `false` when the ledger file doesn't exist on disk. The effective status can be `'started'` purely from process liveness + stage activity without a ledger file. Verified in `compute-effective-status.ts`. |
| **Label map goes stale if new JSONL action types are added** | The `formatLogAction` function has a fallback for unknown actions (title-case the raw action). New actions gracefully degrade to readable format. |
| **Scroll restore fails if row count changes significantly** | If entries are added/removed between cycles, the absolute `scrollY` pixel value might not point at the same row. In practice the queue rarely changes membership during a session — this is acceptable. A future enhancement could scroll-to-ID instead of using absolute pixels. |
