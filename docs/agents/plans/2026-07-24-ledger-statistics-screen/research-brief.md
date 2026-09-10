# Research Brief

## Scope Sketch

- **GUI API Backend** — `mcp-server/gui/` — new handler file + route builder for statistics endpoints
- **GUI Frontend** — `mcp-server/gui/public/` — new view file, nav link, route entry for statistics screen
- **Storage Layer** — `mcp-server/src/storage/ledger-store.ts` — existing `listAllProjects()` plus direct file reads for WP detail aggregation
- **Schemas** — `mcp-server/src/schema/` — existing schemas define all available data fields; no schema changes needed
- **Tests** — `mcp-server/tests/gui/` — new test file(s) for statistics handler

## Area: Storage Data Structure

### Verified References

- `ledger-storage/store/` — 16 repositories, 284 projects, ~1,786 WP files
- `.meta.json` (L1–L20): Contains `slug`, `plan_path`, `status`, `date_created`, `last_updated`, `total_work_packages`, `pending_work_packages`, optional `runner`, `runner_client`, `runner_version`, `progress_pct`, `repository_name`, `outcome_summary`, `project_summary`, `title`
- `project-ledger.json` (L1–L30): Contains `plan_file`, `date_created`, `last_updated`, `status`, `total_work_packages`, `pending_work_packages`, `work_packages[]`, `project_comments[]`, `synthesis_generated`, `synthesis_generated_at`, optional `runner`, `ledger_version`, `server_version`, `outcome_summary`
- `WP-###.json` (L1–L50): Contains `work_package_id`, `status`, `assigned_to`, `dependencies[]`, `acceptance_criteria[]`, `active_pipeline_stages[]`, `revision`, `pipelines[]`, optional `rework_count`, `rework_counts`, `status_changed_at`, `last_updated`, `handoff_notes[]`
- Pipeline objects: `type`, `status` (PASS/FAIL), `started_at`, `completed_at`, optional `duration_ms`, `summary[]`, `artifacts`, `metrics`, `comments[]`, `auto_cancelled`
- `.repositories.json` (L1–L40): Only 3 of 16 repos have entries (ai-insights, application-framework, starfield-load-order-manager)

### Data Coverage & Field Evolution

| Field | Legacy (Feb 2026) | Mid-era (Apr-May) | Modern (Jun-Jul) |
|-------|-------|---------|--------|
| `runner` | absent | present | present |
| `progress_pct` | absent | sometimes | present |
| `repository_name` | absent | present | present |
| `synthesis_generated` | absent | present | present |
| Pipeline `duration_ms` | absent | present (~1,154/1,786 WPs) | present |
| WP `status_changed_at` | absent | present (~1,641/1,786 WPs) | present |

### Available Duration Sources
- **Project duration**: `last_updated - date_created` (available on ALL 284 projects)
- **Pipeline duration**: `duration_ms` field (1,154 WPs) OR computed `completed_at - started_at` (all pipelines)
- **WP duration**: first pipeline `started_at` to last pipeline `completed_at` (derivable from all WP files)

### Runner Distribution
| Runner | Count |
|--------|-------|
| none (legacy) | 117 |
| vscode | 83 |
| orchestrator | 65 |
| standalone | 18 |
| unknown | 1 |

### Status Distribution
| Status | Count |
|--------|-------|
| ARCHIVED | 267 |
| COMPLETE | 15 |
| IN_PROGRESS | 2 |

### Knowledge Store
- 92 global insights + 20 repo-specific insights = 112 total
- 6 repo-specific insight files
- Categories: architecture (47), testing (18), workflow (12), security (10), tooling (5)

### Patterns & Conventions
- All dates are ISO 8601 strings; legacy projects may lack `Z` suffix
- Standalone projects have minimal pipeline data (1 implementation stage, no metrics/comments/handoffs)
- Orchestrator projects may have CANCELLED WPs and `auto_cancelled` pipelines (crash recovery)
- Pipeline stage types: `implementation`, `qa`, `security-audit`, `code-review`, `release-engineering`, `documentation`

## Area: GUI API Backend

### Verified References
- `mcp-server/gui/server.ts` (L1202–L1220): `buildRoutes()` composes domain-specific sub-builder functions (`buildConfigRoutes`, `buildOrchestratorRoutes`, `buildRepoRoutes`, `buildKnowledgeRoutes`, `buildModelRoutes`, `buildProjectRoutes`)
- `mcp-server/gui/api.ts` (L257–L400): `handleListProjects()` already computes `status_counts` and `runner_counts` as in-flight aggregations from the full project list
- `mcp-server/gui/api-repos.ts` (L1–L80): Domain handler file pattern — JSDoc header, imports, helper functions, exported handler functions
- `mcp-server/gui/api-knowledge.ts`: Another domain handler file following the same pattern
- `mcp-server/gui/api-models.ts`: Another domain handler file following the same pattern
- `mcp-server/src/storage/ledger-store.ts`: `LedgerStore.listAllProjects()` scans all `.meta.json` files; `readRootIndex()` reads root index; `readWorkPackage()` reads WP detail
- Route type: `{ method: HttpMethod; pattern: RegExp; handler: Function; noBody?: boolean }` — defined in `server.ts`

### Patterns & Conventions
- Each API domain gets its own handler file (`api-{domain}.ts`) imported from `server.ts`
- Each domain has a `build{Domain}Routes()` function returning `Route[]`
- Handlers receive `(ledgerRoot, ...)` and use `LedgerStore` for data access
- Error responses use `ApiError` class with `code` + `message`
- STDIO discipline: handler files never write to `process.stdout`

## Area: GUI Frontend

### Verified References
- `mcp-server/gui/public/index.html` (L1–L55): SPA shell with `<nav>` links and `<script>` tags; hash-based routing
- `mcp-server/gui/public/router.js` (L1–L80): `Router` IIFE with `dispatch(hash)` using regex matching; `updateNavActive(path)` toggles `.active` class
- `mcp-server/gui/public/api-client.js`: `API` IIFE with ~40 `request()` wrapper methods
- `mcp-server/gui/public/views/knowledge.js` (L1–L60): Example view pattern — `renderKnowledge(app)` function with closure state, `showLoading(app)`, API fetch, `buildHtml()` + `refresh()` + `wireEvents()` inner functions
- `mcp-server/gui/public/views/project-list.js`: Projects list view
- `mcp-server/gui/public/styles.css`: Custom CSS with CSS Custom Properties for theming; dark mode support; key classes: `.card`, `.badge`, `.filter-bar`, `.data-table`
- `mcp-server/gui/public/utils.js`: Shared utility functions (escapeHtml, formatDate, etc.)
- `mcp-server/gui/public/components.js`: Shared UI component functions

### Navigation
Nav links hardcoded in `index.html`: Projects, Knowledge, Orchestrator, Strategy, Configuration. Adding a new nav tab requires:
1. Add `<a>` to `<nav>` in `index.html`
2. Add route regex match in `router.js`
3. Create view function JS file in `views/`
4. Add `<script>` tag in `index.html`

### Patterns & Conventions
- Views are plain functions (no class interface) receiving the `app` DOM element
- IIFE module pattern (no ES modules in the browser — vanilla JS)
- `showLoading(app)` / `showError(app, message)` helper functions for loading/error states
- Filter bars use `.filter-bar` class with inline controls
- Tables use `.data-table` class
- Cards use `.card` class

## Area: Tests

### Verified References
- `mcp-server/tests/gui/` — 20+ test files covering GUI handler domains
- `mcp-server/tests/gui/helpers/make-project.ts` — shared fixture factory for project data
- `mcp-server/tests/gui/helpers/create-namespaced-project.ts` — helper for creating real on-disk LedgerStore fixtures
- `mcp-server/tests/gui/helpers/api-stubs.ts` — API stub helpers
- Test pattern: Vitest with `describe`/`it` blocks, temporary directories for ledger fixtures

## Strategic Context

The ai-insights repository vision emphasizes ease of use and developer experience (short-term), public documentation and awareness (mid-term), and iterative persona improvement with operational reliability (long-term). A statistics screen directly supports the operational insight aspect — understanding project throughput, agent stage performance, and system health over time enables data-driven improvement of the agentic workflow.
