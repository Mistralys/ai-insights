# Plan

## Summary

Add visual identification of dry-run orchestrator runs throughout the GUI: a "Dry Run" badge in the run list on the project detail page, a header-level indicator on the run log detail page, and explicit rendering of dry-run-specific log actions (`dry_run`, `dry_run_no_ledger`, `dry_run_complete`) in the timeline.

## Architectural Context

The dry-run flag is **already emitted** by the orchestrator as `dry_run: true` on the `run_start` JSONL event (always the first line of every log file). Three dry-run-specific actions (`dry_run`, `dry_run_no_ledger`, `dry_run_complete`) are also emitted during dry runs but currently fall through to the generic event renderer.

**Relevant files and modules:**

| File | Role |
|------|------|
| `mcp-server/src/gui/log-resolver.ts` | `RunLogEntry` interface + `findRunLogs()` + `isRunActive()` — reads JSONL first/last lines |
| `mcp-server/src/gui/handlers/run-log-handlers.ts` | `handleListRunLogs()` + `handleGetRunLog()` — API handlers |
| `mcp-server/gui/public/views/project-detail.js` | Renders the run list items (Run #N, date, Running badge) |
| `mcp-server/gui/public/views/run-log.js` | `buildRunEventContent()` switch — renders individual timeline cards |
| `mcp-server/gui/public/styles.css` | Badge CSS classes (`.badge-*`), run event styles |
| `mcp-server/tests/gui/log-resolver.test.ts` | Tests for `findRunLogs`, `isRunActive`, etc. |
| `mcp-server/tests/gui/run-log-handlers.test.ts` | Tests for the API handlers |
| `mcp-server/tests/gui/project-detail-runs.test.ts` | Tests for run list rendering |
| `mcp-server/tests/gui/client-rendering.test.ts` | Tests for `buildRunEventContent` |

**Data flow:**
1. Orchestrator writes `{ action: "run_start", dry_run: true, ... }` as first JSONL line
2. `findRunLogs()` reads log files to determine `is_active` (from last line) — currently ignores first line
3. `handleListRunLogs()` returns `RunLogEntry[]` to the API caller
4. `project-detail.js` renders each entry as a run list item
5. `run-log.js` renders each JSONL event as a timeline card

## Approach / Architecture

**Three-layer approach — backend enrichment → frontend badge → timeline rendering:**

### Layer 1: Backend — Enrich `RunLogEntry` with `is_dry_run`

Extend `RunLogEntry` to include `is_dry_run: boolean`. In `findRunLogs()`, read the first JSONL line of each file to extract the `dry_run` field from the `run_start` event. This mirrors the existing pattern of reading the file to determine `is_active` — we simply also parse the first line.

### Layer 2: Run list — "Dry Run" badge

In `project-detail.js`, when `item.is_dry_run` is truthy, render a "Dry Run" badge next to the run number (similar to how the "Running" badge is rendered for active runs). Both badges can coexist (a dry run can also be active/in-progress).

### Layer 3: Run log detail — Header indicator + dedicated event renderers

- In `run-log.js`, enhance the `run_start` case in `buildRunEventContent()` to show a "Dry Run" badge when `entry.dry_run` is truthy.
- Add explicit `case` handlers for `dry_run`, `dry_run_no_ledger`, and `dry_run_complete` actions so they render with meaningful labels instead of falling through to the generic renderer.

### CSS

Add a `.badge-dry-run` class with a distinctive style (dashed border, muted purple/grey) to visually distinguish dry runs from real runs without drawing disproportionate attention.

## Rationale

- **First-line parsing** is cheap: the file is already opened in `isRunActive()` to read the last line. We can extract both pieces of information in one read or a closely coupled helper.
- **Backend enrichment** (vs. frontend-only detection): Sending `is_dry_run` from the API means the project detail page doesn't need to fetch every log file's content to determine which runs are dry runs. This maintains the current pattern where the run list is rendered from the listing endpoint alone.
- **Explicit event renderers** for dry-run actions provide clearer UX than the generic fallback.

## Detailed Steps

### Step 1: Extend `RunLogEntry` interface

In `mcp-server/src/gui/log-resolver.ts`:

- Add `is_dry_run: boolean` to the `RunLogEntry` interface.
- Create a new helper `isDryRun(filePath: string): Promise<boolean>` that reads the first non-empty JSONL line, parses it, and returns `true` if `entry.action === 'run_start' && entry.dry_run === true`.
- In `findRunLogs()`, call `isDryRun()` alongside `isRunActive()` when building each entry. Both can run in the same `Promise.all` per file.

### Step 2: Add `.badge-dry-run` CSS class

In `mcp-server/gui/public/styles.css`, add a `.badge-dry-run` class near the existing badge definitions. Use a muted purple/grey style with a dashed border to convey "simulated" without looking like an error or success:

```css
.badge-dry-run {
  background: #f3e8ff;
  color: #7c3aed;
  border: 1px dashed #c4b5fd;
}
```

Also add a dark-mode variant in the `[data-theme="dark"]` section.

### Step 3: Render "Dry Run" badge in the run list

In `mcp-server/gui/public/views/project-detail.js`, in the run list rendering block (around line 505), add a "Dry Run" badge when `item.is_dry_run` is truthy. Place it before the "Running" badge or the run number:

```javascript
var dryBadge = item.is_dry_run
  ? '<span class="badge badge-dry-run" style="margin-right:6px">Dry Run</span>'
  : '';
```

Include `dryBadge` in the HTML template alongside the existing `badge` variable.

### Step 4: Enhance `run_start` card in run-log.js

In `mcp-server/gui/public/views/run-log.js`, in the `case 'run_start'` block of `buildRunEventContent()`, add a "Dry Run" badge when `entry.dry_run` is truthy:

```javascript
var dryRunBadge = entry.dry_run
  ? ' <span class="badge badge-dry-run">Dry Run</span>'
  : '';
// Append dryRunBadge after the "Run started" strong tag
```

### Step 5: Add explicit event renderers for dry-run actions

In `mcp-server/gui/public/views/run-log.js`, add three new cases to the `buildRunEventContent()` switch before the `default` case:

```javascript
case 'dry_run': {
  var wpId = entry.wp_id ? escapeHtml(String(entry.wp_id)) : '';
  var stg = entry.stage ? escapeHtml(String(entry.stage).replace(/_/g, ' ')) : '';
  return '<span class="badge badge-dry-run">Dry Run</span> ' +
    '<strong>Stage skipped</strong>' +
    (stg ? ' &mdash; <em>' + stg + '</em>' : '') +
    (wpId ? ' for <strong>' + wpId + '</strong>' : '');
}
case 'dry_run_no_ledger': {
  var detail = entry.detail ? escapeHtml(String(entry.detail)) : '';
  return '<span class="badge badge-dry-run">Dry Run</span> ' +
    '<strong>No ledger</strong>' +
    (detail ? ' &mdash; <span class="text-muted">' + detail + '</span>' : '');
}
case 'dry_run_complete': {
  var reason = entry.reason ? escapeHtml(String(entry.reason)) : '';
  return '<span class="badge badge-dry-run">Dry Run</span> ' +
    '<strong>Dry run complete</strong>' +
    (reason ? ' <span class="text-muted">(' + reason + ')</span>' : '');
}
```

### Step 6: Update `runEventSeverity()` for dry-run actions

In `mcp-server/gui/public/views/run-log.js`, add dry-run actions to `runEventSeverity()` so they get an appropriate visual treatment. Map them to `run-event--info` (the default) — no change needed since they already fall through, but explicitly adding them improves clarity. Optionally `dry_run_complete` could map to `run-event--success`.

### Step 7: Update tests

- **log-resolver tests** (`mcp-server/tests/gui/log-resolver.test.ts`): Add test for `isDryRun()` returning `true` when first line has `dry_run: true`, and `false` otherwise. Add test for `findRunLogs()` returning `is_dry_run` on each entry.
- **run-log-handlers tests** (`mcp-server/tests/gui/run-log-handlers.test.ts`): Verify `handleListRunLogs` passes through `is_dry_run`.
- **client-rendering tests** (`mcp-server/tests/gui/client-rendering.test.ts`): Add test cases for `dry_run`, `dry_run_no_ledger`, and `dry_run_complete` event rendering; verify `run_start` with `dry_run: true` shows badge.
- **project-detail-runs tests** (`mcp-server/tests/gui/project-detail-runs.test.ts`): Add test that `is_dry_run: true` run items render the "Dry Run" badge.

## Dependencies

- The `dry_run` field in `run_start` events — already emitted by the orchestrator (no orchestrator changes needed).
- Existing CSS badge infrastructure and dark mode support.

## Required Components

- `mcp-server/src/gui/log-resolver.ts` — modify `RunLogEntry` interface + add `isDryRun()` helper + update `findRunLogs()`
- `mcp-server/gui/public/views/project-detail.js` — add dry-run badge in run list
- `mcp-server/gui/public/views/run-log.js` — enhance `run_start` card + add 3 new case handlers + update severity map
- `mcp-server/gui/public/styles.css` — add `.badge-dry-run` class (light + dark mode)
- `mcp-server/tests/gui/log-resolver.test.ts` — new tests
- `mcp-server/tests/gui/run-log-handlers.test.ts` — new tests
- `mcp-server/tests/gui/client-rendering.test.ts` — new tests
- `mcp-server/tests/gui/project-detail-runs.test.ts` — new tests

## Assumptions

- The `run_start` event is always the first non-empty line in a JSONL log file (confirmed by orchestrator implementation).
- The `dry_run` field is a boolean (`true` for dry runs, `false` or absent for real runs).
- No orchestrator-side changes are needed — the metadata is already emitted.

## Constraints

- The `isDryRun()` helper must be resilient: return `false` for unreadable/empty/malformed files (same defensive pattern as `isRunActive()`).
- Badge styling must work in both light and dark mode.
- Cross-platform: file reading uses existing Node.js `fs` APIs — no OS-specific concerns.

## Out of Scope

- Filtering or hiding dry runs in the run list (could be a future enhancement).
- Changes to the orchestrator's JSONL emission.
- Changes to the JSONL log schema documentation (dry_run is already documented).
- Adding dry-run metadata to the run log detail page header (the `run_start` card badge is sufficient).

## Acceptance Criteria

- A "Dry Run" badge is visible in the project detail run list for dry-run log files.
- The "Dry Run" badge coexists with the "Running" badge for active dry runs.
- The `run_start` timeline card in the run log viewer shows a "Dry Run" badge when `dry_run: true`.
- `dry_run`, `dry_run_no_ledger`, and `dry_run_complete` actions render with explicit, meaningful labels (not the generic fallback).
- The badge is visually distinct (muted purple, dashed border) in both light and dark mode.
- All new and existing tests pass.

## Testing Strategy

- **Unit tests**: Test `isDryRun()` with dry-run and non-dry-run log files, empty files, and malformed files.
- **Integration tests**: Verify `findRunLogs()` includes `is_dry_run` in results.
- **Rendering tests**: Verify `buildRunEventContent()` renders the correct HTML for all dry-run actions and the enriched `run_start` card.
- **Run list rendering tests**: Verify the badge appears for `is_dry_run: true` entries and doesn't appear for `is_dry_run: false`.
- **Visual verification**: Manual check in the GUI with a dry-run log file (existing logs in `orchestrator/logs/` can be used).

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Performance: reading first line of every log file** | `findRunLogs()` already reads every file to determine `is_active`. Combining both reads into a single file open (or closely coupled calls) adds negligible overhead. |
| **Empty or corrupted log files** | `isDryRun()` returns `false` on any parse error, matching the defensive pattern of `isRunActive()`. |
| **Stale cached responses** | The API doesn't cache run log listings — each request scans disk. No cache invalidation needed. |
