# Plan

## Summary

Add a live Orchestrator Run Log viewer to the GUI dashboard, accessible as a subpage from the project detail view. When a project was (or is being) executed by the orchestrator, a new "Run Log" link appears in the project detail view. The subpage streams JSONL log entries in near-real-time via polling, rendering them as a structured, auto-updating timeline that surfaces agent stages, WP status transitions, progress snapshots, errors, and run lifecycle events — eliminating the need to tail log files manually.

## Architectural Context

### GUI Stack (Vanilla JS SPA)
- **Server:** [mcp-server/gui/server.ts](mcp-server/gui/server.ts) — standalone Node.js HTTP server (`node:http`), route dispatch via `matchRoute()`, all responses JSON. Knows `ledgerRoot` (path to `mcp-server/storage/ledger/`) and `__dirname` (path to `mcp-server/gui/`).
- **API handlers:** [mcp-server/gui/api.ts](mcp-server/gui/api.ts) — stateless functions that read from `LedgerStore` and return JSON.
- **Router:** [mcp-server/gui/public/router.js](mcp-server/gui/public/router.js) — hash-based SPA router with `_setPolling(fn, ms)` / `_clearPolling()` for auto-refresh.
- **Views:** [mcp-server/gui/public/views/](mcp-server/gui/public/views/) — each file exports a `render*()` function that mutates `#app`. Project detail is in [project-detail.js](mcp-server/gui/public/views/project-detail.js).
- **Utilities:** [mcp-server/gui/public/utils.js](mcp-server/gui/public/utils.js) — `escapeHtml()`, `formatDate()`, `formatDuration()`, `statusBadge()`, `showLoading()`, `showError()`.
- **API client:** [mcp-server/gui/public/api-client.js](mcp-server/gui/public/api-client.js) — thin fetch wrapper.
- **Existing polling pattern:** The insights view already uses `Router._setPolling()` with a 15-second interval for live feed updates.

### Orchestrator JSONL Logs
- **Location:** `orchestrator/logs/{timestamp}-{slug}.jsonl` — each run generates one append-only file.
- **Slug derivation:** Slugified plan directory name, truncated to ≤40 chars. Matches the project slug in the ledger.
- **Entry format:** Each line is a JSON object with core fields: `timestamp`, `stage`, `wp_id`, `action` (16 types), `result`, `level`, `tokens_used`, `destination`, plus action-specific fields.
- **Key action types for the viewer:** `run_start`, `run_end`, `run_error`, `stage_start`, `stage_complete`, `stage_error`, `pipeline_result`, `wp_status_change`, `wp_complete`, `progress_snapshot`, `route`, `rework_detected`, `halt`, `safety_limit`, `halted_repeated_failure`, `mcp_error`.
- **Streaming:** Entries are flush-written immediately by the orchestrator — the file grows in real-time as the run progresses.

### Linkage: Project ↔ Log Files
- The project's `.meta.json` contains `slug` (plan folder basename) and `runner` (set to `'orchestrator'` when running from the orchestrator).
- The JSONL filename contains the same slug (after the timestamp prefix).
- The `run_start` entry contains `plan` (absolute path to plan.md), from which the slug can also be extracted.
- **Discovery:** Glob `orchestrator/logs/*-{slug}*.jsonl` (may match multiple runs for the same project).

### Key Constraint
The GUI server currently only knows `ledgerRoot` and `__dirname`. To read orchestrator logs, it needs to know the orchestrator logs directory. Since both the GUI server and the orchestrator live in the same workspace, the logs directory can be derived from `__dirname` (which points to `mcp-server/gui/`) by walking to the workspace root and descending into `orchestrator/logs/`. Alternatively, a new config field `orchestrator_logs_dir` can be added.

## Approach / Architecture

### Backend (3 new API endpoints + 1 config addition)

1. **Config extension:** Add `orchestrator_logs_dir` (optional string) to `GuiConfigSchema` in [mcp-server/src/gui/config.ts](mcp-server/src/gui/config.ts). Defaults to auto-derived path: `path.resolve(__dirname, '../../orchestrator/logs')` (from the GUI server's `__dirname` which is `mcp-server/gui/`). This makes the path configurable for non-standard layouts while keeping zero-config for the standard monorepo.

2. **Log discovery endpoint:** `GET /api/projects/:slug/runs` → Returns an array of available run log files for the project, sorted by timestamp descending. Each entry includes: `{ filename, timestamp, size_bytes, entry_count? }`. Discovery: scan the configured logs directory for files matching `*-{slug}*.jsonl`. Safe slug validation via `assertSafeSlug()`.

3. **Log streaming endpoint:** `GET /api/projects/:slug/runs/:filename` → Returns JSONL entries as a JSON array. Supports `?after=N` query parameter (line offset) for incremental polling — the client sends the last-seen line count and only receives new entries. The `filename` parameter is validated against `assertSafeSlug()`-style checks (alphanumeric, hyphens, dots, ends with `.jsonl`, no path separators). File access is scoped to the configured logs directory to prevent path traversal.

4. **Run summary endpoint (optional optimization):** `GET /api/projects/:slug/runs/:filename/summary` → Reads only the first entry (`run_start`) and last few entries to produce a quick summary: `{ status, started, ended, total_duration_s, total_wps, wps_completed, thread_id }`. Avoids parsing the full JSONL for the run list view.

### Frontend (1 new view + project detail integration)

1. **Run Log view** (`mcp-server/gui/public/views/run-log.js` — **new file**):
   - Route: `#/projects/:slug/runs/:filename`
   - Renders a structured timeline of orchestrator events.
   - Uses `Router._setPolling()` to poll for new entries every 5 seconds (only while the run is in progress — stops polling after seeing `run_end` or `run_error`).
   - Incremental fetch: tracks `lastLineCount` and passes `?after=N` to only fetch new entries, appending them to the DOM without re-rendering the full list.
   - **Layout sections:**
     - **Header:** Run metadata (from `run_start` entry): plan, thread ID, start time, elapsed time (computed client-side from `run_start_ts`), overall status badge (running/completed/error).
     - **Progress bar:** Derived from the most recent `progress_snapshot`: `wps_completed / total_wps`.
     - **Timeline:** Vertical event list, newest at bottom (natural chronological reading). Each entry is a card with:
       - Timestamp (relative or absolute, using existing `formatDate()`).
       - Stage badge (agent name, color-coded).
       - Action-specific rendering (see "Event Rendering" below).
       - Level indicator (INFO/WARNING/ERROR — error entries get red accent).
     - **Filtering (optional v2):** Checkbox filters by action type, stage, WP ID. Deferred to keep v1 simple.

2. **Event Rendering (per action type):**
   - `run_start` → "Run started" + plan path + dry_run flag.
   - `run_end` → "Run completed" + total duration + result badge.
   - `run_error` → "Run error" + error message (red).
   - `stage_start` → "{stage} started on {wp_id}" + iteration number.
   - `stage_complete` → "{stage} completed on {wp_id}" + result badge + duration + token count.
   - `stage_error` → "{stage} failed on {wp_id}" + error message + duration (red).
   - `pipeline_result` → Pipeline badge (type + status) + files modified list + summary bullets + metrics.
   - `wp_status_change` → "{wp_id}: {old_status} → {new_status}" with status badges.
   - `wp_complete` → "{wp_id} completed" (green accent).
   - `progress_snapshot` → Mini progress card: bar + "3/8 WPs complete, iteration 5, elapsed 2m 30s".
   - `route` → Subtle routing info: "→ {destination}" + previous stage context.
   - `rework_detected` → "{wp_id} rework ({pipeline_type})" + rework count (amber).
   - `halt` / `safety_limit` / `halted_repeated_failure` → Warning/error card with details.
   - `mcp_error` → MCP error details (red).

3. **Project detail integration:** In `renderProjectDetail()` ([project-detail.js](mcp-server/gui/public/views/project-detail.js)):
   - After rendering existing sections (metadata, WP table, comments), add a "Run Log" section.
   - If the project's `runner` is `'orchestrator'`, call `GET /api/projects/:slug/runs` and display a list of available runs (timestamp, status, duration).
   - Each run links to `#/projects/:slug/runs/:filename`.
   - If no runs found, display "No orchestrator run logs found."
   - If the project's runner is not `'orchestrator'`, omit the section entirely.

4. **Router update:** Add route `#/projects/:slug/runs/:filename` → `renderRunLog(app, slug, filename)` in [router.js](mcp-server/gui/public/router.js).

5. **index.html update:** Add `<script>` tag for the new `views/run-log.js` file.

## Rationale

- **Polling over SSE/WebSocket:** The GUI already uses polling for the insights view. Adding SSE would introduce a new transport mechanism and complicate the zero-dependency server. Polling at 5s intervals is simple, has no connection management overhead, and the incremental `?after=N` parameter ensures each poll is lightweight (only new lines, not the full file).
- **Incremental read with line offset:** JSONL files can grow to thousands of lines. Re-reading the full file on every poll is wasteful. Reading from a byte/line offset gives the client only new entries. The server can implement this efficiently with line counting or byte offset tracking.
- **Config-based logs directory:** Hardcoding the path relationship (`../../orchestrator/logs`) would break for non-standard directory layouts. Making it configurable (with a sensible default derived from `__dirname`) keeps zero-config for the standard monorepo while supporting custom setups.
- **Separate view file:** The run log is a distinct feature with its own rendering logic and polling lifecycle. Keeping it in a separate file (`run-log.js`) follows the existing pattern where each major view has its own file.
- **No framework additions:** The GUI is intentionally vanilla JS with zero build steps. This feature follows the same pattern: plain DOM manipulation, `fetch()` API calls, CSS custom properties.

## Detailed Steps

1. **Add `orchestrator_logs_dir` to GUI config schema** in [mcp-server/src/gui/config.ts](mcp-server/src/gui/config.ts):
   - Add optional field to `GuiConfigSchema`: `orchestrator_logs_dir: z.string().optional()`.
   - Do NOT add it to `GuiConfigPartialSchema` (it should be read-only in the GUI, like `ledger_root`).
   - The server will resolve the default at startup (not in the schema default, since it depends on `__dirname`).

2. **Add log resolution utility function** in a new file [mcp-server/gui/log-resolver.ts](mcp-server/gui/log-resolver.ts) (or inline in `api.ts`):
   - `resolveOrchestratorLogsDir(configValue?: string): string` — returns the configured path or the default derived from `__dirname`.
   - `findRunLogs(logsDir: string, slug: string): RunLogEntry[]` — scans the directory for matching JSONL files, returns metadata (filename, timestamp parsed from filename, file size).
   - `readLogEntries(logsDir: string, filename: string, afterLine?: number): { entries: object[], totalLines: number }` — reads the JSONL file, optionally skipping the first N lines, parses each line as JSON, returns entries + total line count.
   - **Security:** Validate `filename` against a strict pattern (`/^[0-9T]+-[a-z0-9-]+\.jsonl$/`). Reject any filename containing path separators, `..`, or other traversal characters. Resolve the full path and verify it's within the logs directory.

3. **Add API endpoints** in [mcp-server/gui/api.ts](mcp-server/gui/api.ts):
   - `handleListRunLogs(logsDir: string, slug: string)` — calls `findRunLogs()`, returns array.
   - `handleGetRunLog(logsDir: string, slug: string, filename: string, afterLine: number)` — calls `readLogEntries()`, returns `{ entries, totalLines }`.
   - Both handlers guard with `assertSafeSlug(slug)`.

4. **Register routes** in [mcp-server/gui/server.ts](mcp-server/gui/server.ts):
   - `GET /api/projects/:slug/runs` → `handleListRunLogs`.
   - `GET /api/projects/:slug/runs/:filename` → `handleGetRunLog`.
   - The server resolves `orchestratorLogsDir` once at startup (from config or default) and passes it to handlers.

5. **Add API client methods** in [mcp-server/gui/public/api-client.js](mcp-server/gui/public/api-client.js):
   - `API.getRunLogs(slug)` → `GET /api/projects/{slug}/runs`.
   - `API.getRunLogEntries(slug, filename, afterLine)` → `GET /api/projects/{slug}/runs/{filename}?after={afterLine}`.

6. **Create the Run Log view** as [mcp-server/gui/public/views/run-log.js](mcp-server/gui/public/views/run-log.js) (**new file**):
   - `renderRunLog(app, slug, filename)` — main entry point.
   - Initial load: fetch all entries (`?after=0`), render header + progress + timeline.
   - Start polling via `Router._setPolling()` at 5s intervals: fetch `?after={lastLineCount}`, append new entries to timeline DOM, update progress bar and header status.
   - Stop polling when a `run_end` or `run_error` entry is received.
   - Event card rendering: switch on `entry.action`, produce appropriate HTML per type.

7. **Add CSS styles** to [mcp-server/gui/public/styles.css](mcp-server/gui/public/styles.css):
   - `.run-timeline` — vertical timeline container.
   - `.run-event` — individual event card (left border color by level: INFO=blue, WARNING=amber, ERROR=red).
   - `.run-event-header` — timestamp + stage badge + action label.
   - `.run-event-body` — action-specific content.
   - `.run-progress` — progress bar for WP completion.
   - `.run-header` — run metadata section.
   - Stage badge colors: reuse existing `.stage-badge` classes where applicable.

8. **Integrate into project detail** in [mcp-server/gui/public/views/project-detail.js](mcp-server/gui/public/views/project-detail.js):
   - In `renderProjectDetail()`, after the comments section, add a conditional "Orchestrator Runs" section.
   - If `meta.runner === 'orchestrator'`, call `API.getRunLogs(slug)` (add to the existing `Promise.all`).
   - Render a list of runs with timestamp, status (derived from last entry's action), duration, and a link to `#/projects/{slug}/runs/{filename}`.
   - If no runs found, show "No orchestrator run logs available."

9. **Update router** in [mcp-server/gui/public/router.js](mcp-server/gui/public/router.js):
   - Add route match for `#/projects/:slug/runs/:filename` → `renderRunLog(app, slug, filename)`.
   - Place it before the generic `#/projects/:slug` match to avoid ambiguity.

10. **Update index.html** in [mcp-server/gui/public/index.html](mcp-server/gui/public/index.html):
    - Add `<script src="views/run-log.js"></script>` after the other view scripts.

## Dependencies

- The orchestrator must be installed and its `logs/` directory must be accessible from the GUI server process (same filesystem).
- The JSONL log format (16 action types) as documented in [orchestrator/docs/jsonl-log-schema.md](orchestrator/docs/jsonl-log-schema.md) is the contract. Changes to the schema would require viewer updates.
- Existing GUI utilities: `escapeHtml()`, `formatDate()`, `formatDuration()`, `statusBadge()`, `showLoading()`, `showError()`.

## Required Components

- [mcp-server/src/gui/config.ts](mcp-server/src/gui/config.ts) — add `orchestrator_logs_dir` field (existing file, modify)
- [mcp-server/gui/api.ts](mcp-server/gui/api.ts) — add 2 handler functions + log resolution logic (existing file, modify)
- [mcp-server/gui/server.ts](mcp-server/gui/server.ts) — register 2 new routes + resolve logs dir at startup (existing file, modify)
- [mcp-server/gui/public/api-client.js](mcp-server/gui/public/api-client.js) — add 2 API methods (existing file, modify)
- [mcp-server/gui/public/router.js](mcp-server/gui/public/router.js) — add 1 route (existing file, modify)
- [mcp-server/gui/public/views/run-log.js](mcp-server/gui/public/views/run-log.js) — **new file**, run log timeline view
- [mcp-server/gui/public/views/project-detail.js](mcp-server/gui/public/views/project-detail.js) — add orchestrator runs section (existing file, modify)
- [mcp-server/gui/public/styles.css](mcp-server/gui/public/styles.css) — add timeline and event card styles (existing file, modify)
- [mcp-server/gui/public/index.html](mcp-server/gui/public/index.html) — add script tag (existing file, modify)

## Assumptions

- The orchestrator's JSONL log directory is co-located in the same workspace as the GUI server (standard monorepo layout). For non-standard layouts, the user configures `orchestrator_logs_dir` in `gui-config.json`.
- JSONL files are small enough to read in full on initial load (typical runs produce hundreds to low thousands of lines). For very large files, the `?after=N` incremental parameter keeps subsequent polls lightweight.
- The JSONL log format is stable and follows the schema in [orchestrator/docs/jsonl-log-schema.md](orchestrator/docs/jsonl-log-schema.md).
- The orchestrator flushes entries to disk immediately (no buffering), making polling effective for near-real-time updates.
- Only projects with `runner === 'orchestrator'` will show run logs. Projects run from VS Code or Claude Code won't have JSONL logs to display.

## Constraints

- **No new dependencies:** The GUI server must remain zero-dependency (beyond what the MCP server already uses). No Express, no socket.io, no SSE library.
- **No build step:** The frontend remains vanilla JS with no transpilation.
- **Path traversal prevention:** All filename and slug parameters must be strictly validated before constructing file paths. The log reader must verify resolved paths are within the configured logs directory.
- **Read-only:** The GUI only reads JSONL files — it never writes to or modifies them.
- **Cross-platform paths:** Use `path.join()` / `path.resolve()` for all path construction. Do not hardcode `/` or `\`.

## Out of Scope

- **Filtering/search within the log viewer:** v1 shows all events. Filtering by action type, stage, or WP ID is a natural follow-up but not included here.
- **Log file management** (deletion, rotation, archival): The viewer is strictly read-only.
- **Launching orchestrator runs from the GUI:** This feature only surfaces existing run data.
- **SSE or WebSocket transport:** The polling approach is sufficient for the initial implementation.
- **Run comparison view:** Comparing multiple runs side-by-side is out of scope.
- **Token cost aggregation:** While `tokens_used` is displayed per-stage in the timeline, a total cost summary view is deferred.

## Acceptance Criteria

- For a project with `runner === 'orchestrator'`, the project detail view shows an "Orchestrator Runs" section listing available JSONL log files.
- Clicking a run opens `#/projects/:slug/runs/:filename`, rendering the full timeline.
- While the orchestrator is running, the view auto-updates every 5 seconds, appending new events without full re-render.
- After the run completes (`run_end` or `run_error`), polling stops automatically.
- Each of the 16 action types renders with an appropriate visual treatment.
- The progress bar reflects the latest `progress_snapshot` data.
- Error events (`stage_error`, `run_error`, `mcp_error`, `halt`, `safety_limit`, `halted_repeated_failure`) are visually distinct (red/amber accents).
- No path traversal is possible through the slug or filename parameters.
- The feature works on macOS, Linux, and Windows.
- The feature degrades gracefully: if no log files exist or the logs directory is inaccessible, the UI shows appropriate empty/error states without breaking.

## Testing Strategy

- **API endpoint tests** (Vitest): Test `handleListRunLogs` and `handleGetRunLog` with fixture JSONL files. Verify correct filtering by slug, incremental read via `after` parameter, path traversal rejection, and graceful handling of missing/empty directories.
- **Security tests:** Verify that filenames like `../../etc/passwd.jsonl`, `../secret.jsonl`, and slugs with path separators are rejected.
- **Manual testing:** Start an orchestrator run, open the GUI, navigate to the project detail, click a run link, and verify live updates appear as the run progresses.
- **Edge cases:** Empty JSONL file, malformed JSON lines (should be skipped gracefully), very long runs (1000+ entries), multiple runs for the same project.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Large JSONL files slow down polling** | Incremental read via `?after=N` ensures polls only fetch new lines. Initial load reads the full file once; if performance becomes an issue, paginate the initial load in v2. |
| **Orchestrator logs directory not co-located** | Configurable `orchestrator_logs_dir` in gui-config.json with sensible default. Display clear error message if directory doesn't exist. |
| **JSONL format changes break the viewer** | The viewer should gracefully handle unknown action types (render raw JSON fallback). Known types get rich rendering; unknown types display a generic card. |
| **Multiple concurrent runs for same project** | The run list endpoint returns all matching files sorted by timestamp. Each run is a separate timeline view. |
| **Path traversal via filename parameter** | Strict regex validation + resolved-path containment check. Only `.jsonl` extension allowed. |
| **Stale poll after navigating away** | `Router._clearPolling()` is called on every route change (existing behavior). The polling interval is tied to the router lifecycle. |
