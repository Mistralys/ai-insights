# Plan: Work Package Agent Assignments in the Ledger GUI

## Summary

Extend the Ledger GUI's project detail screen to show the full agent pipeline lineup for each work package, replacing the current minimal table (WP ID, duplicate Title, single Assigned To, Status) with a richer visualization. A new API endpoint provides enriched work-package data — including `active_pipeline_stages`, per-stage pipeline status, agent names, acceptance-criteria progress, and rework counts — so the frontend can render a pipeline stage progression for every WP without N+1 client-side fetches.

## Architectural Context

### Current GUI state

The project detail view ([mcp-server/gui/public/views/project-detail.js](mcp-server/gui/public/views/project-detail.js)) renders a work-packages table with four columns:

| WP ID | Title | Assigned To | Status |
|-------|-------|-------------|--------|

- **Title** is a dead column — it just repeats the WP ID verbatim.
- **Assigned To** shows only the *currently* assigned agent role (a single string).
- The data source is `WorkPackageSummary` from the root index (schema: [mcp-server/src/schema/root-index.ts](mcp-server/src/schema/root-index.ts)), which contains only: `work_package_id`, `status`, `assigned_to`, `dependencies`, `file`.

### Data gap

`active_pipeline_stages` — the key to knowing which agents will work on a WP — lives only in the `WorkPackageDetail` files (schema: [mcp-server/src/schema/work-package.ts](mcp-server/src/schema/work-package.ts)), not in the summary. Pipeline execution history (`pipelines[]`) is also only in the detail files.

### Existing pattern for reading all WP details

Both `handleGetProjectHealth` and `handleResetProject` in [mcp-server/gui/api.ts](mcp-server/gui/api.ts) already iterate over all WP summaries and read every detail file. This is an established, tested pattern.

### Pipeline-to-agent mapping

`PIPELINE_AGENT_MAP` in [mcp-server/src/utils/pipeline-maps.ts](mcp-server/src/utils/pipeline-maps.ts) is the canonical map from pipeline type → agent role. `DEFAULT_PIPELINE_STAGES` provides the fallback 4-stage lineup when `active_pipeline_stages` is absent.

### Work package detail view

The existing WP detail view ([mcp-server/gui/public/views/work-package.js](mcp-server/gui/public/views/work-package.js)) already shows pipelines, acceptance criteria, and handoff notes — but only after navigating into a specific WP. The goal here is to surface the most important information one level up, on the project overview.

## Approach / Architecture

### 1. New API endpoint: `GET /api/projects/:slug/work-packages/overview`

A dedicated endpoint reads all `WorkPackageDetail` files and returns an enriched summary array. Each item includes the existing summary fields plus:

- `active_pipeline_stages` — the WP's specific stage lineup (or the default)
- `pipeline_progress` — array of `{ type, status, agent }` objects showing the resolved status of each active stage
- `acceptance_criteria_progress` — `{ met, total }` counts
- `rework_counts` — the per-pipeline rework counter object (if present)

This keeps the existing `handleGetProject` and `handleListWorkPackages` endpoints untouched.

### 2. Frontend enrichment on the project detail screen

The project detail view adds a parallel fetch for the new overview endpoint (alongside the existing project + plan fetches). The work-packages table is redesigned:

| WP ID | Pipeline Stages | Assigned To | Status |
|-------|----------------|-------------|--------|

The **Pipeline Stages** column replaces the dead "Title" column and renders a row of small stage badges (colored by pipeline status: grey=pending, blue=in-progress, green=pass, red=fail). Each badge shows the agent's abbreviated name. Hovering shows the full stage name and agent role.

### 3. Additional workflow information

Beyond the pipeline progression, the enriched data enables showing:
- **Rework indicator**: a small counter badge on stages that have rework > 0
- **AC progress**: a compact "3/5 AC" label showing acceptance criteria completion
- **Blocked indicator**: if a WP is blocked, show a warning icon with the blocker description in a tooltip

## Rationale

- **New endpoint over schema change**: Adding `active_pipeline_stages` to `WorkPackageSummary` would require updating every MCP tool that writes the root index (high risk, wide blast radius). A server-side enrichment endpoint is contained and non-breaking.
- **New endpoint over client N+1**: Having the GUI fetch each WP detail individually creates poor UX on projects with many WPs. Server-side aggregation is the established pattern (see health/reset handlers).
- **Replacing "Title" column**: The current column is useless (duplicates WP ID). Pipeline stages are significantly more valuable in that space.
- **Compact stage badges**: Full agent names don't fit in a table column when there are 4–6 stages. Abbreviated badges with tooltips balance information density and readability.

## Detailed Steps

### Step 1: Define the enriched WP overview response type

Create a new TypeScript interface in the GUI API layer (in `mcp-server/gui/api.ts` or a new types file) for the enriched work-package overview:

```typescript
interface WpPipelineStage {
  type: string;        // e.g. "implementation"
  agent: string;       // e.g. "Developer"
  status: 'pending' | 'in-progress' | 'pass' | 'fail';
  rework_count: number;
}

interface WpOverviewEntry {
  work_package_id: string;
  status: string;              // WP-level status
  assigned_to: string | null;  // current agent
  dependencies: string[];
  pipeline_stages: WpPipelineStage[];
  acceptance_criteria: { met: number; total: number };
  blocked_by?: { type: string; description: string };
}
```

### Step 2: Implement `handleGetWorkPackageOverview` in `mcp-server/gui/api.ts`

Add a new exported handler that:
1. Reads the root index to get WP summaries
2. Reads each WP detail file (with error tolerance, same try/catch pattern as `handleGetProjectHealth`)
3. For each WP, resolves `active_pipeline_stages` (falling back to `DEFAULT_PIPELINE_STAGES`)
4. Builds `pipeline_stages` by cross-referencing the WP's `pipelines[]` array with the active stages, using `PIPELINE_AGENT_MAP` for agent names
5. Computes acceptance criteria progress from `acceptance_criteria[]`
6. Returns the array of enriched entries

Import `PIPELINE_AGENT_MAP`, `DEFAULT_PIPELINE_STAGES`, and `CANONICAL_PIPELINE_ORDERING` from `mcp-server/src/utils/pipeline-maps.ts`.

### Step 3: Register the new route in `mcp-server/gui/server.ts`

Add a route for `GET /api/projects/:slug/work-packages/overview` that calls `handleGetWorkPackageOverview`.

### Step 4: Add the API client method in `mcp-server/gui/public/api-client.js`

Add:
```javascript
getWorkPackageOverview: function (slug) {
  return request('GET', '/projects/' + encodeURIComponent(slug) + '/work-packages/overview');
}
```

### Step 5: Redesign the work-packages table in `mcp-server/gui/public/views/project-detail.js`

1. Add a third parallel fetch for `API.getWorkPackageOverview(slug)` in the `Promise.all` block.
2. Replace the current WP row rendering with the new layout:
   - **WP ID** — clickable link (unchanged)
   - **Pipeline Stages** — render a `<div class="pipeline-track">` containing one badge per active stage. Each badge:
     - Shows a 2–3 character abbreviation (DEV, QA, SEC, REV, REL, DOC)
     - Has a CSS class based on status: `stage-pending`, `stage-in-progress`, `stage-pass`, `stage-fail`
     - Has a `title` attribute with the full stage name + agent role
     - If `rework_count > 0`, overlay a small rework count badge
   - **Assigned To** — current agent (unchanged)
   - **Status** — badge (unchanged)
3. Below the table (or inline), show a legend mapping badge abbreviations to full agent names.

### Step 6: Add CSS styles in `mcp-server/gui/public/styles.css`

Add styles for:
- `.pipeline-track` — flexbox row with gap
- `.stage-badge` — small inline-block with rounded corners, fixed width
- `.stage-pending`, `.stage-in-progress`, `.stage-pass`, `.stage-fail` — color variants
- `.rework-indicator` — small superscript counter badge
- `.ac-progress` — compact acceptance criteria counter
- `.blocked-indicator` — warning icon style

### Step 7: Enhance the WP detail view with agent lineup header

In `mcp-server/gui/public/views/work-package.js`, add a small pipeline progression bar above the existing pipelines section. This uses the same stage badge pattern for visual consistency. The data is already available from the WP detail endpoint (`active_pipeline_stages` + `pipelines[]`).

### Step 8: Write tests for the new API endpoint

Add a test file `mcp-server/tests/gui/api-wp-overview.test.ts` covering:
- Returns enriched data for a project with multiple WPs
- Falls back to `DEFAULT_PIPELINE_STAGES` when `active_pipeline_stages` is absent
- Correctly maps pipeline statuses (pending for stages not yet reached, in-progress/pass/fail for existing pipelines)
- Computes acceptance criteria progress correctly
- Handles corrupted/missing WP detail files gracefully (skip with warning)
- Returns empty array for project with no WPs

## Dependencies

- `PIPELINE_AGENT_MAP`, `DEFAULT_PIPELINE_STAGES`, `CANONICAL_PIPELINE_ORDERING` from `mcp-server/src/utils/pipeline-maps.ts`
- `LedgerStore.readWorkPackage()` from `mcp-server/src/storage/ledger-store.ts`
- Existing GUI infrastructure: `api-client.js`, `utils.js`, `styles.css`

## Required Components

### Modified files
- `mcp-server/gui/api.ts` — new handler `handleGetWorkPackageOverview`
- `mcp-server/gui/server.ts` — new route registration
- `mcp-server/gui/public/api-client.js` — new API method
- `mcp-server/gui/public/views/project-detail.js` — redesigned WP table
- `mcp-server/gui/public/views/work-package.js` — pipeline lineup header
- `mcp-server/gui/public/styles.css` — new stage badge styles

### New files
- `mcp-server/tests/gui/api-wp-overview.test.ts` — tests for the new endpoint

## Assumptions

- The number of WPs per project is small enough (typically < 20) that reading all detail files server-side is acceptable. This matches the existing pattern used by the health and reset endpoints.
- `active_pipeline_stages`, when absent, defaults to the 4-stage legacy set (`DEFAULT_PIPELINE_STAGES`). This is the established convention in `pipeline-maps.ts`.
- The GUI is a vanilla JS SPA (no framework). New code follows the same ES5-compatible function style used throughout the GUI codebase.

## Constraints

- **No schema migration**: The `WorkPackageSummary` and `RootIndex` schemas must NOT be modified. All enrichment happens at the API layer.
- **No new dependencies**: The GUI uses only vanilla JS + `marked.min.js`. No new libraries.
- **STDIO discipline**: The API handler must never write to `process.stdout` (MCP server constraint).
- **ES5-compatible JS**: GUI JavaScript must remain ES5-compatible with `var` declarations and `function` keyword (matching existing codebase style).

## Out of Scope

- Extracting or displaying actual WP titles from work-package markdown files
- Real-time updates / WebSocket push for pipeline status changes
- Reordering or drag-and-drop of pipeline stages in the GUI
- Modifying `active_pipeline_stages` from the GUI
- Changes to the MCP tool layer or the `WorkPackageSummary` schema

## Acceptance Criteria

- The project detail screen shows a pipeline stage progression for each work package
- Each stage badge is colored by its status (pending/in-progress/pass/fail)
- Each stage badge shows which agent role owns it (via abbreviation + tooltip)
- Rework counts > 0 are visible on the relevant stage badge
- The WP detail view shows the same pipeline progression bar for visual consistency
- The redundant "Title" column is replaced with the pipeline stage visualization
- A new API endpoint returns enriched WP data without modifying existing endpoints or schemas
- Tests cover the new API endpoint with standard and edge cases
- Graceful degradation: if the overview fetch fails, the table falls back to the current summary-based rendering

## Testing Strategy

- **Unit tests**: `api-wp-overview.test.ts` tests the `handleGetWorkPackageOverview` handler with fixture data, covering:
  - Happy path with custom `active_pipeline_stages`
  - Fallback to default stages when field is absent
  - Pipeline status resolution from `pipelines[]` array
  - AC progress computation
  - Missing/corrupted WP detail file handling
- **Manual testing**: Run the GUI server (`npm run gui`) and verify:
  - Stage badges render correctly for projects with varying pipeline configurations
  - Tooltips show full agent names
  - Rework badges appear only when count > 0
  - Clicking WP rows still navigates to WP detail
  - WP detail view shows the pipeline progression bar
  - Dark/light theme compatibility for the new badge colors

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Reading all WP detail files adds latency** | This is the same pattern used by the health/reset endpoints. For typical project sizes (< 20 WPs) it's sub-50ms. Add a latency log (to stderr) if concerned. |
| **Pipeline status resolution logic is complex** | Resolve from the `pipelines[]` array with clear precedence: find the latest pipeline entry for each stage type, use its status. Stages with no pipeline entry are "pending". Well-defined, testable logic. |
| **Stage abbreviations may be confusing** | Include a legend below the table. Use tooltips on every badge. The abbreviations (DEV, QA, SEC, REV, REL, DOC) are intuitive for the target audience (developers using the agent workflow). |
| **Existing tests may need updating** | The change is additive (new endpoint + new route + new UI code). No existing API contracts change. Existing tests should not be affected. |
