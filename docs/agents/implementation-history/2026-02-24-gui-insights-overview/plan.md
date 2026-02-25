# Plan

## Summary

Add an **Insights view** to the Ledger GUI that surfaces all project-level comments — the strategic recommendations, synthesis notes, incident records, and decisions that agents register via `ledger_add_project_comment` — in a single browsable, filterable overview. Additionally, expose those same comments inside the per-project detail page so they are visible without leaving the project context.

---

## Architectural Context

### Existing data structure

`project_comments` is an array of `ProjectComment` objects stored inside each project's `project-ledger.json` (the `RootIndex`). Its shape:

```typescript
interface ProjectComment {
  type: string;          // open string: "note", "incident", "decision", …
  priority: 'low' | 'medium' | 'high';
  timestamp: string;
  agent: string;
  note: string;
  context?: IncidentContext;
}
```

Real comment types observed in existing ledger data: `note`, `incident`. Agents may also use `decision` or any free-form type via `ledger_add_project_comment`.

### API layer — `gui/api.ts`

One handler per REST route; pure async functions decoupled from HTTP plumbing. New handlers are added here and wired up in `gui/server.ts`. The `handleListProjects` function already calls `LedgerStore.listAllProjects()` which returns all `ProjectMeta` objects (including slug and status). `handleGetProject` returns `RootIndex & { meta: ProjectMeta }`, which already includes the `project_comments` array — **no schema change is needed**.

### HTTP router — `gui/server.ts`

Routes are matched in `matchRoute()` for standard `GET/DELETE` endpoints. Config routes are handled as special cases before `matchRoute()`. New routes follow the same structural pattern.

### Frontend — `gui/public/app.js` and `index.html`

A vanilla-JS SPA. The `API` object contains one method per endpoint. `Router.dispatch()` pattern-matches the current hash to a render function. Each render function writes directly to `app.innerHTML`. The `index.html` `<nav>` lists hard-coded links.

### Styles — `gui/public/styles.css`

Existing badge and card patterns (`badge`, `badge-*`, `card`, `card-title`, `pipeline-item`) define the visual language. New components should match this vocabulary.

---

## Approach / Architecture

### 1. New backend endpoint: `GET /api/insights`

A single endpoint that loads all projects and aggregates their `project_comments` into one flat response. Each comment entry is annotated with the project slug and status it comes from so the frontend can link back and filter.

Response shape:
```typescript
interface InsightEntry {
  project_slug: string;
  project_status: ProjectStatus;
  type: string;
  priority: 'low' | 'medium' | 'high';
  timestamp: string;
  agent: string;
  note: string;
  context?: IncidentContext;
}
```

This avoids multiple sequential round-trips from the browser (N projects × 1 request each) and keeps filtering logic in the frontend.

### 2. Per-project comments section (Project Detail view)

The `project_comments` data is **already returned** by `GET /api/projects/:slug` (it is part of `RootIndex` which is spread into the `ProjectDetail` type). The frontend simply needs to render it — no backend change is required for this part.

### 3. New frontend Insights page (`/insights`)

A new route and render function. Supports client-side filtering by:
- **Type** (all / note / incident / decision / ...)
- **Priority** (all / high / medium / low)
- **Project** (all / one specific slug)

Comments are sorted newest-first. Each comment is rendered as a card showing: project link, agent, type badge, priority indicator, timestamp, and note text.

### 4. Navigation link

A third link ("Insights") is added to the `<nav>` in `index.html`.

---

## Rationale

- **Single aggregated endpoint** keeps the frontend simple — one API call instead of N; the backend iterates projects once.
- **No schema changes** — `project_comments` is already in `RootIndex`; the per-project section requires zero backend work.
- **Client-side filtering** is appropriate for the expected data volume (tens to low hundreds of comments across all projects).
- **Consistent UI vocabulary** — reuses existing badge, card, and filter-bar patterns from the project list, keeping the visual language coherent.

---

## Detailed Steps

1. **`gui/api.ts`** — Add `InsightEntry` type and `handleGetInsights(ledgerRoot)` handler:
   - Call `LedgerStore.listAllProjects(ledgerRoot)` to get all `ProjectMeta[]`.
   - For each project, instantiate `LedgerStore` and call `store.readRootIndex()`.
   - Flat-map all `project_comments` into an array of `InsightEntry`, annotating each with `project_slug` and `project_status`.
   - Sort by timestamp descending.
   - Return the array (empty array if no projects or no comments).

2. **`gui/server.ts`** — Wire `GET /api/insights`:
   - Import `handleGetInsights` from `./api.js`.
   - Add a matching branch inside `matchRoute()` for `GET` + `rest[0] === 'insights'` + `rest.length === 1`.

3. **`gui/public/app.js`** — Add `getInsights()` to the `API` object:
   ```javascript
   getInsights: function () { return request('GET', '/insights'); }
   ```

4. **`gui/public/app.js`** — Add `renderInsights(app)` function (new view `4e`):
   - `showLoading(app)`; call `API.getInsights()`.
   - Build filter controls: type select (populated dynamically from distinct types in the fetched data), priority select, project select.
   - Render comments as cards (sorted newest-first by default).
   - Wire filter `change` events to re-render the visible subset.
   - Auto-refresh every 15 seconds via `Router._setPolling`.

5. **`gui/public/app.js`** — Update `renderProjectDetail(app, slug)`:
   - After the work-packages table, render a "Project Comments" section using `project.project_comments` (already present in the API response).
   - Sort comments newest-first; render each as a compact comment card.
   - Show "No comments yet." when the array is empty.

6. **`gui/public/app.js`** — Update `Router.dispatch()`:
   - Add branch: `if (path === '/insights') { renderInsights(app); return; }`.

7. **`gui/public/index.html`** — Add `<a href="#/insights">Insights</a>` to the `<nav>`.

8. **`gui/public/styles.css`** — Add styles:
   - `.comment-card` — card variant for individual comment entries (border-left accent by priority).
   - `.comment-meta` — small secondary line showing agent, type badge, timestamp.
   - `.priority-high`, `.priority-medium`, `.priority-low` — left-border accent colors (red / amber / grey).
   - `.comment-type` — inline pill badge for the comment type string.
   - `.insights-filters` — horizontal filter bar (re-uses `.filter-bar` pattern where possible).

---

## Dependencies

- `LedgerStore.listAllProjects()` — existing method in `src/storage/ledger-store.ts`, already used by `handleListProjects`.
- `store.readRootIndex()` — existing method, already used by multiple handlers.
- No new npm dependencies.

---

## Required Components

**Modified:**
- `mcp-server/gui/api.ts` — new `handleGetInsights` handler + exported `InsightEntry` type
- `mcp-server/gui/server.ts` — new route branch in `matchRoute()`
- `mcp-server/gui/public/app.js` — API client method, new `renderInsights` view, updated `renderProjectDetail`, updated `Router.dispatch`
- `mcp-server/gui/public/index.html` — nav link
- `mcp-server/gui/public/styles.css` — comment card styles

**Not modified:**
- `src/schema/root-index.ts` — no schema changes needed
- `src/storage/ledger-store.ts` — no changes needed
- Any MCP tool source files

---

## Assumptions

- Comment types are free-form strings; the type filter is populated dynamically from actual data rather than being a hard-coded enum.
- The total number of project comments across all projects is small enough that a full in-memory load on every page visit is acceptable (no pagination needed in this iteration).
- The per-project comments section is rendered below the work-packages table in the Project Detail view.

---

## Constraints

- STDIO discipline: the GUI server (`gui/server.ts`) may write to `stdout`/`stderr`; the MCP server (`src/index.ts`) must not. The new handler lives in `gui/api.ts` so this constraint is not at risk.
- `handleGetInsights` must handle `readRootIndex()` failures per-project gracefully (catch and skip), because a corrupted or partially-written ledger file should not crash the entire insights endpoint.
- The frontend remains plain JavaScript (no ES modules, no frameworks) — consistent with the existing `app.js` architecture.

---

## Out of Scope

- Modifying or deleting project comments from the GUI.
- Filtering pipeline-level observations (those live on individual work packages and are already shown in the WP detail view).
- Pagination or virtual scrolling for large comment volumes.
- New or changed MCP tools.
- Any changes to manifest documents (structural change only; manifest updates are deferred to the Documentation agent's step).

---

## Acceptance Criteria

- `GET /api/insights` returns a JSON array of `InsightEntry` objects, one per project comment across all projects, with `project_slug` and `project_status` annotated on each entry.
- The Insights page is reachable via the nav link and renders all cross-project comments in a card layout.
- The Insights page type, priority, and project filters correctly show/hide cards without a page reload.
- The Project Detail page renders a "Project Comments" section showing all comments for that project.
- Both views show "No comments." / "No insights found." gracefully when no comments exist.
- Priority-based left-border accent colors are applied to comment cards: red for `high`, amber for `medium`, grey/muted for `low`.
- The page auto-refreshes on the Insights view (≤ 15 s polling interval), consistent with the Project List view.

---

## Testing Strategy

The QA agent should verify:
- **Unit tests** for `handleGetInsights` in `tests/gui/` covering: empty ledger (no projects), projects with no comments, projects with mixed comment types/priorities, one project with corrupted ledger (graceful skip).
- **Integration / browser smoke test**: start the GUI server against the existing `mcp-server/storage/ledger/` test data and manually confirm the Insights page renders correctly and the filters work.
- Existing GUI handler tests must continue to pass (no regressions in `handleListProjects`, `handleGetProject`).

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **`readRootIndex()` throws for a corrupted ledger** | Wrap per-project reads in `try/catch` inside `handleGetInsights`; skip and continue on error |
| **Many projects with many comments causes slow page load** | Acceptable for now given small expected volume; pagination can be added in a follow-up if needed |
| **Dynamically-populated type filter shows inconsistent/misspelled types** | Type filter uses `Set` of actual values from data; normalise to lowercase for display, no hard-coded list needed |
| **Comment type string variety makes the filter noisy** | Filter is an opt-in refinement; the default "All types" view shows everything without confusion |
