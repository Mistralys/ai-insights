# Plan

## Plan Audit Cycles
- Audits: none — Plan Auditor v1.7.0
- Architectural Reviews: none — Plan Architect Reviewer v2.2.0

## Prior Project Context
The ai-insights repository has a rich project history (142+ projects in the ledger store) but no mechanism to surface aggregate metrics from this data. The existing GUI has five top-level views (Projects, Knowledge, Orchestrator, Strategy, Configuration), each following the same architectural pattern: domain-specific API handler file + route builder on the backend, view function + nav link on the frontend.

## Summary
Add a Statistics screen to the MCP Server GUI that extracts and displays aggregate metrics from the ledger storage data. The backend computes all metrics server-side via a single `GET /api/statistics` endpoint that scans `.meta.json` files for project-level data and reads `project-ledger.json` + `WP-###.json` files for deeper pipeline/stage analytics. The frontend presents the data in a dedicated "Statistics" view with clearly grouped sections: overview, project metrics, temporal trends, work package metrics, pipeline stage metrics, repository breakdown, and trivia.

## Architectural Context
- **GUI Server:** `mcp-server/gui/server.ts` — HTTP server with declarative `Route[]` table composed from domain-specific sub-builders (`buildConfigRoutes`, `buildRepoRoutes`, etc.). The `buildRoutes()` function spreads all sub-builders.
- **API Handlers:** Each domain gets its own file (`api.ts`, `api-repos.ts`, `api-knowledge.ts`, `api-models.ts`) exporting handler functions. Each file also exports a `build{Domain}Routes()` function returning `Route[]`.
- **LedgerStore:** `mcp-server/src/storage/ledger-store.ts` — `listAllProjects(ledgerRoot)` scans all `.meta.json` files across all repo namespaces. `readRootIndex()` and `readWorkPackage(wpId)` provide per-project/WP detail access.
- **Frontend Views:** Vanilla JS SPA with hash routing. Views are plain functions receiving the `app` DOM element. IIFE module pattern. `API` namespace for fetch wrappers. `UI` namespace for shared component helpers.
- **Data:** 284 projects across 16 repositories, ~1,786 WP files. Project-level timestamps available on all projects. Pipeline `duration_ms` available on ~65% of WPs; `completed_at - started_at` computable for all pipelines.

## Approach / Architecture

### Backend: Single Aggregation Endpoint

A new `api-statistics.ts` handler file with a single `GET /api/statistics` endpoint. The handler:

1. Calls `LedgerStore.listAllProjects(ledgerRoot)` to get all `.meta.json` data (fast — no deep reads).
2. For deeper metrics (WP durations, pipeline stage breakdown), reads `project-ledger.json` and `WP-###.json` files. Uses `readFile` + `JSON.parse` directly (bypassing Zod validation) for maximum throughput — the statistics endpoint only reads data, and malformed files are silently skipped rather than crashing the response.
3. Returns a typed `StatisticsEnvelope` JSON response containing all pre-computed metrics.

**Performance consideration:** With 284 projects and ~1,786 WP files, the full scan involves ~2,000+ file reads. On SSD this takes 1–3 seconds. The endpoint computes everything on each request (no caching layer in v1). This is acceptable for a dashboard page that loads once per navigation. If performance becomes a concern later, a caching layer can be added without changing the API shape.

### Frontend: Statistics View

A new `views/statistics.js` file implementing `renderStatistics(app)`. The view:

1. Calls `API.getStatistics()` to fetch the metrics envelope.
2. Renders grouped metric sections as cards with key-value tables and summary numbers.
3. Uses the existing CSS classes (`.card`, `.data-table`, `.badge`) for consistency.
4. Temporal data (projects per month) is rendered as a simple HTML bar chart using inline CSS widths — no charting library dependency.

## Rationale
- **Single endpoint:** All metrics are served from one request to avoid waterfall loading. The response is structured so the frontend can render sections independently.
- **Server-side computation:** All aggregation happens in the backend to keep the frontend simple and avoid shipping raw data over the wire.
- **Direct file reads (no Zod):** The statistics endpoint is read-only analytics. Zod validation overhead on 1,786 WP files is unnecessary — graceful error handling (skip malformed files, use fallback values) is more appropriate than strict validation for an analytics context.
- **No caching in v1:** The dataset is small enough (~2K files) that per-request computation is fast. Adding a cache introduces invalidation complexity without measurable user-facing benefit at current scale.
- **No charting library:** A simple HTML bar chart for the temporal distribution avoids adding a dependency. The visual is informational, not interactive.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Endpoint granularity | Single `/api/statistics` returning all metrics | Multiple endpoints per section (`/statistics/overview`, `/statistics/pipelines`, etc.) | Single endpoint avoids waterfall and keeps the API surface minimal; the payload is small enough (~5–10 KB) that splitting would add complexity with no bandwidth benefit |
| Computation strategy | On-demand per request | Pre-computed cache (file or in-memory) with invalidation | The dataset is ~2K files on SSD; pre-computation adds invalidation complexity (when do you recompute?) for a screen that's loaded occasionally, not continuously |
| Pipeline duration source | `completed_at - started_at` with `duration_ms` as preferred source when available | Use only `duration_ms` (skip legacy WPs) | Fallback computation ensures all 284 projects contribute to metrics; excluding legacy data would undercount by ~40% |
| Project duration end-time | `synthesis_generated_at` with `last_updated` fallback | Always use `last_updated` | `last_updated` is modified by post-project operations (archiving, imports) and inflates durations; `synthesis_generated_at` captures the true completion moment. Fallback needed for ~48% of projects that lack the field |
| Temporal visualization | HTML/CSS bar chart (inline widths) | Chart.js, D3.js, or similar library | No new dependency; the temporal chart is a simple horizontal bar chart showing project counts per month, not a complex interactive visualization |
| WP file reading strategy | Direct `readFile` + `JSON.parse`, skip on error | `LedgerStore.readWorkPackage()` with Zod validation | Direct reads are ~2x faster for bulk analytics; errors are counted and reported in the response rather than throwing |

## Pattern Alignment
- **Domain handler file pattern** — follows `api-repos.ts`, `api-knowledge.ts` established pattern: JSDoc header, typed exports, helper functions, `build{Domain}Routes()` — `mcp-server/gui/api-repos.ts`
- **Route builder composition** — `buildStatisticsRoutes()` spreads into `buildRoutes()` — `mcp-server/gui/server.ts` L1202–L1220
- **View function pattern** — `renderStatistics(app)` with `showLoading`/`showError`/`refresh` — `mcp-server/gui/public/views/knowledge.js`
- **API client method** — `API.getStatistics()` added to the `API` IIFE — `mcp-server/gui/public/api-client.js`
- **Navigation addition** — `<a href="#/statistics">` in `<nav>` + route dispatch in `router.js` — `mcp-server/gui/public/index.html`, `mcp-server/gui/public/router.js`
- **No departure from existing patterns.** The statistics screen follows every established convention.

## Detailed Steps

### Step 1: Define the Statistics Response Type

Create `mcp-server/gui/api-statistics.ts` with the `StatisticsEnvelope` interface and all sub-types. This is a GUI-only type (not an MCP tool schema), so it lives alongside the other `api-*.ts` files.

The response type encodes the following metric groups:

```typescript
interface StatisticsEnvelope {
  generated_at: string;           // ISO timestamp of computation
  scan_errors: number;            // count of files that could not be read

  overview: {
    total_projects: number;
    total_repositories: number;
    total_work_packages: number;
    total_pipelines_executed: number;
    total_insights: number;
    first_project_date: string | null;   // earliest date_created
    latest_project_date: string | null;  // latest date_created
    operational_span_days: number;
    total_cumulative_duration_ms: number; // sum of all project durations
  };

  project_metrics: {
    duration_median_ms: number;
    duration_average_ms: number;
    duration_min_ms: number;
    duration_max_ms: number;
    average_wps_per_project: number;
    by_runner: Record<string, { count: number; duration_median_ms: number }>;
    by_status: Record<string, number>;
  };

  temporal: {
    projects_per_month: Array<{ month: string; count: number }>;  // "2026-02", "2026-03", ...
    average_per_day: number;
    average_per_week: number;
    average_per_month: number;
    busiest_month: { month: string; count: number } | null;
    busiest_week: { week: string; count: number } | null;  // "2026-W12" format
  };

  work_package_metrics: {
    total_completed: number;
    total_cancelled: number;
    total_with_rework: number;
    rework_rate_pct: number;           // % of WPs that had at least one pipeline FAIL
    duration_median_ms: number;
    duration_average_ms: number;
    acceptance_criteria_total: number;
    acceptance_criteria_met: number;
  };

  pipeline_metrics: {
    by_stage: Record<string, {
      total_runs: number;
      pass_count: number;
      fail_count: number;
      pass_rate_pct: number;
      duration_median_ms: number;
      duration_average_ms: number;
    }>;
    most_common_failure_stage: string | null;
  };

  repository_breakdown: Array<{
    name: string;
    project_count: number;
    wp_count: number;
  }>;

  trivia: {
    longest_project: { slug: string; repo: string; duration_ms: number } | null;
    shortest_project: { slug: string; repo: string; duration_ms: number } | null;
    most_wps_project: { slug: string; repo: string; wp_count: number } | null;
    total_files_modified: number;       // from artifacts.files_modified across all pipelines
    total_pipeline_comments: number;    // total code-review/qa observations
    total_handoff_notes: number;
  };
}
```

### Step 2: Implement the Statistics Handler

In `api-statistics.ts`, implement `handleGetStatistics(ledgerRoot: string): Promise<StatisticsEnvelope>`.

**Algorithm:**

1. **Phase 1 — Project-level scan (fast).** Call `LedgerStore.listAllProjects(ledgerRoot)`. From `.meta.json` data, compute:
   - Overview counters (total projects, first/latest dates, status/runner distributions)
   - Temporal distribution (projects per month)
   - Repository breakdown (group by parent directory of the storage path)

2. **Phase 2 — Deep scan (parallel).** For each project, read `project-ledger.json` to get the WP list, then read each `WP-###.json` file. From project-ledger.json and WP data, compute:
   - Project durations (using `synthesis_generated_at` from the root index as the end timestamp; fall back to `last_updated` only for older projects that lack this field — see Duration Computation Strategy below)
   - WP totals (completed, cancelled, rework)
   - WP durations (first pipeline `started_at` to last pipeline `completed_at`)
   - Pipeline stage metrics (durations, pass/fail rates per stage type)
   - Trivia (files modified, comments, handoff notes)
   - Acceptance criteria counts

   Use `Promise.all` with per-project parallelism. Wrap each file read in try/catch to skip corrupt files and increment `scan_errors`.

3. **Phase 3 — Compute derived metrics.** From the raw arrays:
   - Compute medians (sort + pick middle)
   - Compute averages
   - Find extremes (longest/shortest project, most WPs)
   - Compute rates (rework rate, pass rate per stage)

4. **Phase 4 — Knowledge store count.** Read the `.knowledge/` directory to count insight files and sum insight counts.

**Duration computation strategy:**
- **Pipeline duration:** Use `duration_ms` when present. Otherwise compute `new Date(completed_at).getTime() - new Date(started_at).getTime()`. Skip pipelines where either timestamp is missing or produces `NaN`.
- **WP duration:** `max(pipeline.completed_at) - min(pipeline.started_at)` across all pipelines in the WP. Skip WPs with no valid pipeline timestamps.
- **Project duration:** Use `synthesis_generated_at` from `project-ledger.json` as the project end-time when available: `new Date(synthesis_generated_at).getTime() - new Date(date_created).getTime()`. Fall back to `new Date(last_updated).getTime() - new Date(date_created).getTime()` only for older projects that lack `synthesis_generated_at`. **Rationale:** `last_updated` can be modified by post-project operations (archiving, status changes, imports) well after the project actually completed; `synthesis_generated_at` captures the true completion moment. Available on ~52% of projects (73/142 in the ai-insights repo); the fallback covers the rest.

**Repository name derivation for breakdown:** The `listAllProjects` scan traverses `{ledgerRoot}/{repoName}/{slug}/.meta.json`. The repo name is the parent directory of the slug. For legacy flat-layout projects (detected by `.meta.json` at depth 1), the directory name itself is the repo name. The `repository_name` field in `.meta.json` is used when available; otherwise fall back to directory structure.

### Step 3: Implement the Route Builder

In `api-statistics.ts`, export `buildStatisticsRoutes(ledgerRoot: string): Route[]` returning a single route:

```typescript
export function buildStatisticsRoutes(ledgerRoot: string): Route[] {
  return [
    {
      method: 'GET' as const,
      path: /^\/api\/statistics$/,
      noBody: true,
      handler: async () => handleGetStatistics(ledgerRoot),
    },
  ];
}
```

### Step 4: Wire the Route Builder into `server.ts`

In `mcp-server/gui/server.ts`:

1. Import `buildStatisticsRoutes` from `./api-statistics.js`.
2. Add `...buildStatisticsRoutes(ledgerRoot)` to the `buildRoutes()` function's return array, before `buildProjectRoutes` (project routes contain catch-all patterns that must come last).

### Step 5: Add the API Client Method

In `mcp-server/gui/public/api-client.js`, add to the `API` IIFE's return object:

```javascript
getStatistics: function() { return request('GET', '/statistics'); },
```

### Step 6: Create the Statistics View

Create `mcp-server/gui/public/views/statistics.js` implementing `renderStatistics(app)`.

**View structure:**

```
Statistics
├── Overview section (total projects, repos, WPs, pipelines, insights, operational span)
├── Project Metrics section (duration stats, by-runner breakdown, by-status breakdown)
├── Temporal section (projects per month bar chart, averages, busiest periods)
├── Work Package Metrics section (totals, durations, rework rate, acceptance criteria)
├── Pipeline Stage Metrics section (per-stage table with runs, pass rate, durations)
├── Repository Breakdown section (table ranked by project count)
└── Trivia section (records, totals)
```

**Rendering approach:**
- Each section is a `.card` with an `<h2>` header.
- Numeric metrics use key-value layout: `<dt>`/`<dd>` pairs inside a CSS grid.
- Tables use `.data-table` class.
- Temporal bar chart: each month is a row with `<span>` of proportional CSS `width` (percentage of max count). Background color uses CSS custom property `--accent`.
- Duration values are formatted to human-readable strings (e.g., "2h 15m", "45m 30s", "3d 6h").
- All user-visible strings are `escapeHtml()`'d.

**Duration formatting helper** (inline in the view file):
```javascript
function formatDuration(ms) {
  if (!ms || ms <= 0) return '—';
  var sec = Math.floor(ms / 1000);
  var min = Math.floor(sec / 60); sec %= 60;
  var hr  = Math.floor(min / 60); min %= 60;
  var day = Math.floor(hr / 24);  hr  %= 24;
  if (day > 0) return day + 'd ' + hr + 'h';
  if (hr > 0)  return hr + 'h ' + min + 'm';
  if (min > 0) return min + 'm ' + sec + 's';
  return sec + 's';
}
```

### Step 7: Add Navigation and Routing

1. **`index.html`:** Add `<a href="#/statistics">Statistics</a>` to the `<nav>` element, between "Strategy" and "Configuration".
2. **`index.html`:** Add `<script src="/views/statistics.js?v=1"></script>` before `stale-check.js`.
3. **`router.js`:** Add a route match in the singleton routes block:
   ```javascript
   if (path === '/statistics') {
     renderStatistics(app);
     return;
   }
   ```

### Step 8: Add CSS for Statistics-Specific Elements

In `mcp-server/gui/public/styles.css`, add styles for:
- `.stat-grid` — CSS grid for key-value metric display (2 columns: label + value)
- `.bar-chart` — Simple horizontal bar chart container
- `.bar-chart-row` — Row with label, bar, and count
- `.bar-chart-bar` — The filled bar element with proportional width

Keep the styles minimal and consistent with the existing design language (CSS custom properties for colors, `var(--card-bg)`, `var(--accent)`, etc.).

### Step 9: Write Backend Tests

Create `mcp-server/tests/gui/api-statistics.test.ts` testing `handleGetStatistics`:

1. **Empty ledger:** Returns zero-value envelope with no errors.
2. **Single project:** Returns correct overview counts, project duration, repository breakdown.
3. **Multiple projects across repos:** Verifies aggregation, median computation, per-stage breakdown.
4. **Malformed files are skipped:** A project with corrupt JSON in a WP file increments `scan_errors` but doesn't crash the response.
5. **Legacy projects (no runner/duration_ms):** Verifies fallback duration computation and runner categorization.
6. **Temporal distribution:** Verifies projects-per-month grouping with known dates.
7. **Pipeline pass/fail rates:** Verifies stage-level pass rate and failure stage identification.
8. **Rework detection:** Verifies WPs with FAIL pipelines are counted in rework metrics.

Use the existing `createNamespacedProject` test helper from `mcp-server/tests/gui/helpers/create-namespaced-project.ts` to create fixture projects with controlled data.

### Step 10: Write Route Integration Test

Add a test case to the existing `mcp-server/tests/gui/` suite verifying the `GET /api/statistics` route is registered, returns 200, and the response shape matches `StatisticsEnvelope`.

## Dependencies
- Step 2 depends on Step 1 (types defined first)
- Step 4 depends on Steps 2–3 (handler and route builder must exist before wiring)
- Step 6 depends on Step 5 (view needs the API client method)
- Step 7 depends on Step 6 (routing needs the view function)
- Step 8 can be done in parallel with Step 6
- Steps 9–10 depend on Steps 1–4 (backend must be complete)

## Required Components
- `mcp-server/gui/api-statistics.ts` — new handler file
- `mcp-server/gui/server.ts` — modification (import + compose)
- `mcp-server/gui/public/api-client.js` — modification (add method)
- `mcp-server/gui/public/views/statistics.js` — new view file
- `mcp-server/gui/public/index.html` — modification (nav link + script tag)
- `mcp-server/gui/public/router.js` — modification (add route)
- `mcp-server/gui/public/styles.css` — modification (add styles)
- `mcp-server/tests/gui/api-statistics.test.ts` — new test file

## Assumptions
- All project data is accessible via `LedgerStore.listAllProjects()` and direct file reads from the ledger root.
- The `.meta.json` enrichment cache provides `total_work_packages`, `pending_work_packages`, `runner`, `repository_name` for modern projects; legacy projects will have some fields missing but `date_created`/`last_updated` are always present.
- Pipeline timestamps (`started_at`, `completed_at`) are always present on completed pipelines; `duration_ms` is present on ~65% of WPs and is the preferred duration source.
- The ~2,000 file reads for a full scan complete in under 3 seconds on SSD, which is acceptable for a page load.

## Constraints
- **No new dependencies.** The statistics screen uses only existing CSS patterns and vanilla JS.
- **STDIO discipline.** The handler file must not write to `process.stdout` (existing convention for all GUI handler files).
- **Error isolation.** Individual file read failures must not crash the endpoint — increment `scan_errors` and continue.
- **Cross-platform.** All file path construction must use `path.join()` / `path.resolve()`.

## Out of Scope
- **Caching layer.** Statistics are computed per-request. A caching mechanism can be added later if response times become problematic.
- **Real-time updates / polling.** The statistics view loads once per navigation; no auto-refresh.
- **Interactive charts / charting libraries.** The temporal bar chart is pure HTML/CSS.
- **Date range filtering.** The endpoint returns metrics across all time; filtering by date range can be added as a future enhancement.
- **Export functionality.** No CSV/JSON export button.
- **MCP tool.** The statistics endpoint is GUI-only; no corresponding MCP tool is added.

## Acceptance Criteria

- AC-01: `GET /api/statistics` returns a valid `StatisticsEnvelope` JSON response with all metric groups populated.
- AC-02: The Statistics view is accessible via a "Statistics" nav link in the GUI header and renders at `#/statistics`.
- AC-03: Overview section displays total projects, repositories, WPs, pipelines, insights, operational span, and cumulative duration.
- AC-04: Project metrics section displays median/average/min/max duration, by-runner breakdown, by-status breakdown, and average WPs per project.
- AC-05: Temporal section displays projects-per-month bar chart and average/busiest period metrics.
- AC-06: Work package metrics section displays completed/cancelled/rework totals, duration statistics, rework rate, and acceptance criteria counts.
- AC-07: Pipeline metrics section displays per-stage run counts, pass/fail rates, and duration statistics.
- AC-08: Repository breakdown section displays a ranked table of repositories by project count and WP count.
- AC-09: Trivia section displays longest/shortest project, most WPs, total files modified, total comments, and total handoff notes.
- AC-10: Malformed or unreadable files are silently skipped and counted in `scan_errors` without crashing the endpoint.
- AC-11: Backend tests cover empty ledger, single project, multi-repo aggregation, malformed file handling, legacy project handling, and pipeline metric computation.
- AC-12: The statistics view uses the existing GUI design language (card layout, data tables, badges, CSS custom properties, dark mode support).

## Testing Strategy
Backend tests exercise the handler function directly with fixture projects created using the existing `createNamespacedProject` test helper. Fixtures cover the data shape spectrum: legacy projects (no runner, no duration_ms), modern VS Code projects (full data), orchestrator projects (CANCELLED WPs, auto_cancelled pipelines), and standalone projects (single implementation stage). Edge cases include empty ledger, corrupt files, and projects with no WPs.

Frontend testing is visual — the view is a pure rendering function with no complex state management or user interactions that require automated testing.

## Test Plan

- `mcp-server/tests/gui/api-statistics.test.ts` — `handleGetStatistics returns zero envelope for empty ledger` — verifies all counters are 0, arrays empty, no errors — AC-01, AC-10
- `mcp-server/tests/gui/api-statistics.test.ts` — `handleGetStatistics computes correct metrics for single project` — creates one project with 3 WPs and known durations; verifies overview, project metrics, temporal, WP metrics, pipeline metrics, and repository breakdown — AC-01, AC-03, AC-04, AC-06, AC-07, AC-08
- `mcp-server/tests/gui/api-statistics.test.ts` — `handleGetStatistics aggregates across multiple repositories` — creates projects in two different repos; verifies repository breakdown ranking, total counts, cross-repo aggregation — AC-01, AC-08
- `mcp-server/tests/gui/api-statistics.test.ts` — `handleGetStatistics skips malformed WP files` — creates a project with a valid root index but corrupted WP JSON; verifies scan_errors incremented and other metrics computed — AC-10
- `mcp-server/tests/gui/api-statistics.test.ts` — `handleGetStatistics handles legacy projects without duration_ms` — creates projects without duration_ms on pipelines; verifies fallback to completed_at - started_at — AC-01, AC-07
- `mcp-server/tests/gui/api-statistics.test.ts` — `handleGetStatistics computes temporal distribution correctly` — creates projects with specific date_created values; verifies projects_per_month grouping and busiest_month — AC-05
- `mcp-server/tests/gui/api-statistics.test.ts` — `handleGetStatistics computes pipeline pass/fail rates` — creates WPs with PASS and FAIL pipelines; verifies per-stage pass_rate_pct and most_common_failure_stage — AC-07
- `mcp-server/tests/gui/api-statistics.test.ts` — `handleGetStatistics detects rework from FAIL pipelines` — creates a WP with a FAIL followed by a PASS; verifies rework count and rate — AC-06
- `mcp-server/tests/gui/api-statistics.test.ts` — `GET /api/statistics route returns 200` — integration test hitting the route via the server; verifies response shape — AC-01

## Documentation Updates

- `mcp-server/docs/agents/project-manifest/api-surface.md` — add `handleGetStatistics()` function signature and `StatisticsEnvelope` type; add `buildStatisticsRoutes()` function; add `GET /api/statistics` endpoint
- `mcp-server/docs/agents/project-manifest/file-tree.md` — add `gui/api-statistics.ts`, `gui/public/views/statistics.js`, `tests/gui/api-statistics.test.ts`
- `mcp-server/docs/agents/project-manifest/data-flows.md` — add statistics data flow (scan → aggregate → render)

## Risks & Mitigations
| Risk | Mitigation |
|------|------------|
| **Full scan takes too long (>5s) at scale** | Acceptable at current scale (284 projects, ~2K files). Monitor response time. A caching layer with file-mtime invalidation can be added as a follow-up without changing the API shape. |
| **Corrupt/unexpected data shapes crash aggregation** | Every file read and parse is wrapped in try/catch. Unknown fields are ignored. Missing fields use fallback defaults (0, null). `scan_errors` counter surfaces the problem without hiding it. |
| **Legacy projects skew metrics** | Legacy projects contribute to project-level metrics (date, duration) but may be absent from pipeline-level metrics where timestamps are missing. The `overview.total_projects` vs pipeline-level denominators will naturally differ — this is expected and not misleading. |
| **Median computation on empty arrays** | Guard all median/average computations: return 0 when the input array is empty. |

## Recommended Workflow
- **Workflow:** ledger
- **Rationale:** This is a multi-file, multi-layer feature (backend handler + route wiring + frontend view + CSS + tests + manifest updates) touching 8+ files across 3 concerns, well-suited for the structured pipeline with QA and code review stages.
