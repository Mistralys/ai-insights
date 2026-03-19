# File Tree

```
mcp-server/
├── .gitignore                   # Gitignore (excludes storage/ledger/ runtime data)
├── .npmrc                       # npm configuration
├── package.json                 # Project metadata and dependencies
├── tsconfig.json                # TypeScript compiler configuration
├── vitest.config.ts             # Vitest test framework configuration
│
├── storage/                     # Runtime-generated data (gitignored except .gitkeep)
│   └── ledger/
│       ├── .gitkeep             # Ensures directory is tracked in version control
│       ├── gui-config.json      # Runtime-generated GUI config (auto_handoff_enabled, max_handoff_depth, ledger_root) — created on first GUI or MCP server start
│       └── {slug}/              # Per-project subfolder — runtime-generated
│           ├── .meta.json       # Project metadata (slug, status, timestamps)
│           ├── .lock            # Lock file for concurrent-write protection
│           ├── project-ledger.json  # Root index
│           ├── WP-001.json      # Work package detail files
│           ├── plan.md          # Archived copy of the project plan (created by ledger_initialize_project; read by GET /api/projects/:slug/plan) — optional; absent when source was missing at init time
│           └── synthesis.md     # Archived copy of the synthesis report (created by ledger_complete_synthesis; optional, absent until synthesis runs and synthesis.md exists in the plan folder)
│
├── gui/                         # GUI server process code (separate STDIO-safe HTTP server)
│   ├── api.ts               # REST API route handlers (handleListProjects, handleGetProject, handleListWorkPackages, handleGetWorkPackage, handleGetWorkPackageOverview, handleGetPlanDocument, handleDeleteProject, handleGetConfig, handleUpdateConfig, …)
│   ├── server.ts            # Standalone Node.js HTTP server (node:http); routes /api/* to api.ts handlers, serves static files from gui/public/; started via `npm run gui`
│   └── public/              # Static assets served by gui/server.ts
│       ├── index.html       # Dashboard SPA shell — nav header (#theme-toggle), main#app, FOUC-prevention inline <script> in <head>; loads scripts in dependency order: libs/marked.min.js → api-client.js → theme.js → router.js → utils.js → views/*.js → app.js
│       ├── styles.css       # Full CSS: :root custom properties, [data-theme="dark"] override block, status badges (.badge-archived — grey, light + dark variants), tables, cards, forms, loading/error states, plan-content/plan-synopsis, hardcoded-hex dark overrides for badges/banners/health, tr[data-status="ARCHIVED"] opacity rule (muted rows), .info-banner with light/dark variants (archive banner in detail view), sortable column header rules block (placed immediately after tbody tr.clickable in the table section): th.sortable cursor+user-select+transition(color 0.15s ease), th.sortable:hover color, th.sort-asc::after / th.sort-desc::after arrow indicators; pipeline stage badge block: .pipeline-track, .stage-badge, .stage-pending, .stage-in-progress, .stage-pass, .stage-fail, .rework-indicator (with [data-theme="dark"] overrides)
│       ├── api-client.js    # API IIFE — all fetch helpers (getProjects, getProject, getWorkPackage, getWorkPackageOverview, getPlanDocument, deleteProject, archiveProject, unarchiveProject, getConfig, updateConfig, getInsightsStats); buildQueryString(params) helper used by getProjects
│       ├── theme.js         # Theme IIFE — localStorage key 'mcp-theme'; defaults dark; init() applies saved theme and wires #theme-toggle button
│       ├── router.js        # Router IIFE — hash-based routing; dispatches to renderProjectList, renderPlan, renderSynthesis, renderProjectDetail, renderWorkPackageDetail, renderConfig, renderInsights globals
│       ├── utils.js         # Shared helpers: escapeHtml, formatDate, statusBadge, showLoading, showError
│       ├── app.js           # Bootstrap entry point (~7 lines): Theme.init(); Router.init()
│       ├── views/
│       │   ├── project-list.js    # renderProjectList — status filter, search, sortable columns (sortProjects(), localStorage keys 'mcp-sort-key'/'mcp-sort-dir'), archive/unarchive/delete row buttons, pagination, 10 s polling; searchRaw preserves verbatim input; th headers tabindex+role+keydown for keyboard accessibility; localeCompare sort
│       │   ├── project-detail.js  # extractSynopsis, renderPlan, renderSynthesis, renderProjectDetail; STAGE_ABBREV (stage type → abbreviated label), buildPipelineTrack (WpOverviewEntry → .pipeline-track HTML); PIPELINE_STAGES constant; showResetModal (includes markCompleteMode toggle — Mark All as Complete button force-completes all non-CANCELLED WPs via API.markProjectComplete; cancel override reverts to normal reset mode); archive banner with inline unarchive action
│       │   ├── work-package.js    # WP_DEFAULT_STAGES (fallback stage list when active_pipeline_stages absent), buildWpDetailBar (wp → Pipeline Progression .pipeline-track card HTML), renderWorkPackageDetail
│       │   ├── config.js          # renderConfig — auto_handoff_enabled, max_handoff_depth, auto_archive_days inputs; PUT via API.updateConfig
│       │   └── insights.js        # renderInsights — project health stats; 15 s polling
│       └── libs/
│           └── marked.min.js  # Vendored Markdown parser (marked v15.0.12, ~40 KB); loaded first; used by plan/synthesis viewers
│
├── src/                         # Source code
│   ├── index.ts                 # MCP server entry point and tool registration
│   │
│   ├── gui/                     # Shared GUI/config module (also used by the HTTP GUI server process)
│   │   ├── auto-archive.ts      # Auto-archive service: runAutoArchive(), startAutoArchiveTimer(), stopAutoArchiveTimer(), _resetTimerForTesting()
│   │   └── config.ts            # Runtime config: GuiConfigSchema, getConfig(), readConfigFromDisk(), writeConfig(), startConfigWatcher(), stopConfigWatcher()
│   │
│   ├── schema/                  # Zod schemas and type definitions
│   │   ├── enums.ts             # Status enums derived from shared/workflow-manifest.json (ProjectStatus, WorkPackageStatus, PipelineStatus, BlockerType)
│   │   ├── project-meta.ts      # ProjectMetaSchema / ProjectMeta — per-project .meta.json
│   │   ├── root-index.ts        # RootIndex schema (storage/ledger/{slug}/project-ledger.json structure)
│   │   ├── validators.ts        # Business rule validators (status transitions, dependencies)
│   │   ├── workflow-manifest-schema.ts  # Zod schema for shared/workflow-manifest.json; exports AgentRoleEnum (z.enum with 9 role names), ManifestSchema (full schema), workflowManifest (parsed singleton), and inferred types AgentRole + Manifest
│   │   └── work-package.ts      # WorkPackageDetail schema (storage/ledger/{slug}/WP-###.json structure)
│   │
│   ├── storage/                 # File I/O abstractions
│   │   ├── atomic-writer.ts     # Atomic write-to-temp-then-rename implementation
│   │   ├── file-lock.ts         # File locking with proper-lockfile
│   │   └── ledger-store.ts      # Central storage abstraction (reads, writes, dual-file sync)
│   │
│   ├── tools/                   # MCP tool implementations
│   │   ├── help.ts              # ledger_help — thin handler (schema + register); static strings live in help-content.ts
│   │   ├── help-content.ts      # TOOL_HELP: static documentation strings for all 20 MCP tools
│   │   ├── observations.ts      # ledger_add_observation, ledger_add_project_comment
│   │   ├── pipeline.ts          # ledger_start_pipeline, ledger_complete_pipeline, ledger_cancel_pipeline, ledger_update_pipeline_progress
│   │   ├── project-lifecycle.ts # ledger_detect_project, ledger_get_project_status, ledger_initialize_project, ledger_list_projects, ledger_complete_synthesis
│   │   ├── work-package.ts      # WP CRUD tools (get, list, create, claim, update_status)
│   │   ├── workflow.ts          # Thin aggregator — delegates register() to the three sub-modules; re-exports backward-compat symbols
│   │   ├── workflow-handoff.ts              # ledger_get_handoff_status
│   │   ├── workflow-next-action.ts          # ledger_get_next_action (per-role single-action logic)
│   │   └── workflow-next-action-batch.ts    # Batch/collector sub-module: embedHandoffStatusInWait, buildBatchNextSteps, getNextActionsCollector
│   │
│   └── utils/                   # Utility functions
│       ├── workflow-helpers.ts  # Shared constants and stateless helpers used by all three workflow tool sub-modules; exports STALE_PIPELINE_HOURS and MAX_REWORK_COUNT (both derived from shared/workflow-manifest.json constants), getMaxHandoffDepth() (reads from GUI config cache; falls back to manifest default), effectiveMaxDepth() (scales handoff ceiling by project size using manifest handoff_depth_multiplier), clearSynthesisState(rootIndex) (centralised synthesis field reset)
│       ├── agent-registry.ts    # Discovers VS Code agent handles and IDs by scanning *.agent.md files; exports discoverAgents(), getAgentHandle(), getAgentId(), isRegistryLoaded(), resetRegistry()
│       ├── constants.ts         # Shared constants derived from shared/workflow-manifest.json (AGENT_ROLES, ROLE_IDS, SPEC_VERSION, ORCHESTRATING_ROLES)
│       ├── if-defined.ts        # ifDefined() type guard helper
│       ├── ledger-root.ts       # resolveLedgerRoot(), projectSlugFromPath(), inferProjectRootFromPlanPath() — central ledger location and plan-path utilities
│       ├── path-validator.ts    # Project path validation; exports planFolderBasename(), validatePlanPath(), resolveProjectPath()
│       ├── pipeline-maps.ts     # Shared routing constants (PIPELINE_PREREQUISITES, PIPELINE_AGENT_MAP, NEXT_AGENT_MAP, FAIL_ROUTING_MAP, AGENT_PIPELINE_MAP) and utility functions (getDownstreamTypes, getUpstreamTypes, getOrderedActiveStages, firstActiveStage, lastActiveStage, validateActiveStages)
│       ├── project-reset.ts     # Semi-intelligent project reset — analysis (pure) + mutation; exports analyzeProjectForReset(), applyProjectReset(), and interfaces WpResetDiagnosis, ProjectResetDiagnosis, WpDecision, ProjectResetResult
│       ├── timestamp.ts         # Timestamp formatting — now() returns UTC ISO 8601 YYYY-MM-DDTHH:MM:SSZ; parseTimestamp() handles legacy space format
│       └── wp-id.ts             # Work package ID formatting (WP-###)
│
└── tests/                       # Test suites
    ├── helpers/                 # Shared test utilities (NEVER write to production storage)
    │   ├── create-temp-store.ts # createTempStore() / cleanupTempStore() helpers
    │   ├── fixtures.ts          # makeWorkPackageDetail(), makePipeline() (positional or overrides), makeWorkPackageSummary() — spec-compliant fixture factories (revision: 0 default)
    │   └── test-utils.ts        # injectLedgerDir() — injects --ledger-dir argv before a test; nowFloor() — returns current timestamp truncated to second precision
    │
    ├── gui/                     # GUI and config module tests
    │   ├── auto-archive.test.ts # Unit tests for src/gui/auto-archive.ts — all 8 ACs: old COMPLETE archived, fresh skipped, non-COMPLETE statuses skipped, maxAgeDays=0 no-op, empty ledger, error isolation, multi-project scan, timer idempotency/stop (14 tests)
    │   ├── api-reset.test.ts    # Integration tests for handleResetProject — dry_run, apply decisions, cancel, skip, error cases (13 tests)
    │   ├── api-wp-overview.test.ts  # Unit tests for handleGetWorkPackageOverview — happy path, fallback stages, custom active_pipeline_stages ordering, all pipeline statuses, rework entry selection, agent mapping, AC progress, rework_counts propagation, blocked_by propagation, corrupt file skip, STDIO discipline, empty project (21 tests)
    │   ├── config.test.ts       # Unit tests for src/gui/config.ts (cache, read, write, watcher lifecycle)
    │   ├── api.test.ts          # Unit tests for gui/api.ts (all handlers, NOT_FOUND / FORBIDDEN / VALIDATION_ERROR guards); includes handleRenameProject (7 cases: success, empty, max-length boundary, NOT_FOUND, path-traversal, persistence round-trip), handleListProjects repository_name and title-priority assertions
    │   └── handoff-config-integration.test.ts  # Integration: runtime config changes affect buildHandoffResponse at runtime
    │
    ├── integration/             # End-to-end workflow tests
    │   ├── auto-handoff.test.ts
    │   └── full-workflow.test.ts
    │
    ├── schema/                  # Schema validation tests
    │   ├── root-index.test.ts   # RootIndexSchema and WorkPackageSummarySchema field-level parse/reject tests — synthesis_generated_at (string|null|absent), ledger_version (string|absent), active_pipeline_stages on summary (array|null|absent), backward compatibility with legacy ledgers (20 tests)
    │   ├── validators.test.ts
    │   └── work-package-schema.test.ts  # Zod parse-level tests for PipelineSchema and WorkPackageDetailSchema new fields including last_updated (present/absent) (24 tests)
    │
    ├── storage/                 # Storage layer tests
    │   ├── ledger-store.test.ts # LedgerStore unit tests; includes updateTitle() — sets title, updates last_updated, persists to disk, overwrites previous title
    │   └── project-meta.test.ts
    │
    ├── tools/                   # Tool-level tests
    │   ├── cancelled-status.test.ts  # CANCELLED status transitions and dependency satisfaction
    │   ├── cascade-reblock.test.ts  # Cascade-block on COMPLETE → IN_PROGRESS reopen
    │   ├── claim-guard.test.ts  # Assignment guard for ledger_claim_work_package
    │   ├── pipeline.test.ts     # Pipeline tool tests; includes cross-WP staleness advisory checks (positive and negative cases)
    │   ├── project-lifecycle.test.ts  # ledger_complete_synthesis, self-healing with synthesis_generated; initializeProject ledger_version assignment; synthesis_generated_at lifecycle across completeSynthesis and reset paths
    │   ├── rework-circuit-breaker.test.ts  # Circuit breaker on MAX_REWORK_COUNT    ├── schema-integrity.test.ts  # Regression guard: all 22 registered tool schemas produce non-empty JSON Schema properties (guards against .refine()/.transform() on outer ZodObject — see Constraint 63)    │   ├── synthesis-terminal.test.ts  # Synthesis terminal state and project COMPLETE transition
    │   ├── work-package.test.ts  # WP tool tests; includes synthesis_generated_at clearing on WP status changes, active_pipeline_stages propagation to WP summary on creation
    │   ├── workflow-handoff.test.ts
    │   ├── workflow-next-action.test.ts  # REWORK routing, Documentation FAIL routing, BLOCK_FOR_REWORK_LIMIT
    │   └── workflow-rework-loop.test.ts  # End-to-end rework loop covering FAIL → REWORK → PASS cycles
    │
    └── utils/                   # Utility function tests
        ├── agent-registry.test.ts
        ├── if-defined.test.ts
        ├── ledger-root.test.ts
        ├── path-validator.test.ts
        ├── pipeline-maps.test.ts  # Tests for getDownstreamTypes, getUpstreamTypes, resolvePrerequisite, resolveNextAgent, resolveFailAgent, getOrderedActiveStages, describePipelineTypes (drift-detection), firstActiveStage, lastActiveStage, validateActiveStages (hard/soft guardrails)
        ├── project-reset.test.ts  # Unit tests for analyzeProjectForReset() — all WP status branches, auto-cancelled exclusion, most-recent-wins, mixed project scenarios; synthesis_generated_at clearing on project reset
        ├── timestamp.test.ts    # UTC ISO 8601 formatting by now()
        ├── workflow-helpers.test.ts  # MAX_REWORK_COUNT, isTerminalStatus, hasNewUpstreamPassSince, clearSynthesisState
        ├── workflow-manifest.test.ts  # Structural invariants for shared/workflow-manifest.json: 9 roles (unique id/name/number, id pattern ^[a-z][a-z0-9_]*$), pipeline-to-role ownership, default_stages subsequence, canonical_order ↔ prerequisites ↔ fail_routing coverage, fail_routing → valid role IDs, DAG (no cycles via Kahn's algorithm), non-empty status arrays, positive constants; also verifies derived-constant parity (AGENT_ROLES, ORCHESTRATING_ROLES, PIPELINE_TYPES, DEFAULT_PIPELINE_STAGES, PIPELINE_AGENT_MAP, MAX_REWORK_COUNT, STALE_PIPELINE_HOURS, SPEC_VERSION) — 34 tests
        └── wp-id.test.ts        # WP ID generation: variable-width, max-based incrementing
```

---

## Directory Annotations

### `src/schema/`

Centralized data structure definitions using Zod. All schemas are validated at runtime on reads and writes. TypeScript types are inferred from schemas, ensuring type/schema consistency.

### `src/storage/`

File I/O layer with atomicity and locking guarantees. `LedgerStore` is the primary abstraction — all tools should use it rather than reading/writing files directly.

### `src/tools/`

Each file exports a `register(server: McpServer)` function that registers one or more MCP tools. Tools are grouped by functional category (lifecycle, work packages, pipelines, observations, workflow).

The workflow tools are split across four files: `workflow.ts` (thin aggregator), `workflow-next-action.ts` (per-role single-action logic for `ledger_get_next_action`), `workflow-next-action-batch.ts` (batch/collector sub-module: `embedHandoffStatusInWait`, `buildBatchNextSteps`, `getNextActionsCollector`), and `workflow-handoff.ts` (`ledger_get_handoff_status`). Shared constants and pure helpers live in `src/utils/workflow-helpers.ts`.

### `tests/`

Vitest test suites organized by layer (helpers, integration, schema, storage, tools, utils). Tests run with `npm test` or `npm run test:watch`.

`tests/helpers/create-temp-store.ts` provides `createTempStore(planPath)` and `cleanupTempStore(handle)` — a shared factory that always injects a `mkdtemp` ledger root, enforcing the test isolation contract (see Constraint 20).

`tests/helpers/fixtures.ts` provides `makeWorkPackageDetail()`, `makePipeline()`, and `makeWorkPackageSummary()` — lightweight fixture factories with spec-compliant defaults (`revision: 0`, `assigned_to: 'Developer'`). `makePipeline` supports two calling conventions: positional `(type, status, started_at?, completed_at?)` and overrides `(Partial<Pipeline>)`. All factories accept an `overrides` partial to customize individual fields. Use these instead of inline fixtures to reduce churn when schema fields are added in future phases.

`tests/helpers/test-utils.ts` provides `injectLedgerDir(dir)` — injects `--ledger-dir <dir>` into `process.argv` before a test and returns a cleanup function to restore the original state — and `nowFloor()` — returns the current UTC timestamp truncated to second precision (matching ledger timestamp format). Both utilities are available for adoption in any test file that needs ledger-dir injection or precise timestamp comparison.

---

## Generated/Ignored Directories

The following directories are not version-controlled:

- `node_modules/` — npm dependencies
- `dist/` — TypeScript compilation output (when built)
- `storage/ledger/{slug}/` — per-project ledger runtime data (excluded via `.gitignore`; only `storage/ledger/.gitkeep` is committed)

> **Note:** Plan folders (e.g. `docs/agents/plans/2026-02-16-feature/`) contain only human-authored Markdown files. No machine-generated JSON is ever written inside a plan folder.
