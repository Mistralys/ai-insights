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
├── gui/                         # GUI server process code
│   ├── api.ts               # REST API route handlers; runner_counts: Record-string-number; handleListProjects normalizes runner to unknown, supports sorting by runner
│   ├── server.ts            # Standalone Node.js HTTP server (node:http); routes /api/* to api.ts handlers, serves static files from gui/public/
│   └── public/              # Static assets served by gui/server.ts
│       ├── index.html       # Dashboard SPA shell
│       ├── styles.css       # Full CSS; runner badge block: .badge-runner base class, .badge-runner-orchestrator, .badge-runner-vscode, .badge-runner-claude-code, .badge-runner-unknown with dark-mode overrides
│       ├── api-client.js    # API IIFE; buildQueryString(params) helper used by getProjects
│       ├── theme.js         # Theme IIFE; localStorage key mcp-theme; init() applies saved theme
│       ├── router.js        # Router IIFE; hash-based routing
│       ├── utils.js         # Shared helpers: escapeHtml, formatDate, statusBadge, showLoading, showError
│       ├── app.js           # Bootstrap entry point: Theme.init(); Router.init()
│       ├── views/
│   │   ├── project-list.js    # renderProjectList — status filter, search, sortable columns, archive/unarchive/delete row buttons, pagination, 10s polling; runner filter dropdown (RUNNER_STORAGE key mcp-runner-filter, buildRunnerOptions() dynamically filters runner_counts to count only — fixed: previously hardcoded all 4 types; preserves stale localStorage selections as zero-count entry); runnerBadge() renders .badge.badge-runner.badge-runner-{type} — fixed: previously emitted badge-unknown instead of badge-runner-unknown; runnerLabel() unused — cleanup candidate; sortable Runner column
│   │   ├── project-detail.js  # extractSynopsis, renderPlan, renderSynthesis, renderProjectDetail; STAGE_ABBREV, buildPipelineTrack; showResetModal; archive banner
│   │   ├── work-package.js    # WP_DEFAULT_STAGES, buildWpDetailBar, renderWorkPackageDetail
│   │   ├── config.js          # renderConfig — auto_handoff_enabled, max_handoff_depth, auto_archive_days
│   │   └── insights.js        # renderInsights — project health stats; 15 s polling
│       └── libs/
│           └── marked.min.js  # Vendored Markdown parser (marked v15.0.12, ~40 KB)
│
├── src/                         # Source code
│   ├── index.ts                 # MCP server entry point and tool registration
│   │
│   ├── gui/                     # Shared GUI/config module
│   │   ├── auto-archive.ts      # Auto-archive service
│   │   └── config.ts            # Runtime config: GuiConfigSchema, getConfig(), readConfigFromDisk(), writeConfig()
│   │
│   ├── schema/                  # Zod schemas and type definitions
│   │   ├── enums.ts             # Status enums derived from shared/workflow-manifest.json
│   │   ├── project-meta.ts      # ProjectMetaSchema / ProjectMeta — per-project .meta.json
│   │   ├── root-index.ts        # RootIndex schema
│   │   ├── validators.ts        # Business rule validators
│   │   ├── workflow-manifest-schema.ts  # Zod schema for shared/workflow-manifest.json
│   │   └── work-package.ts      # WorkPackageDetail schema
│   │
│   ├── storage/                 # File I/O abstractions
│   │   ├── atomic-writer.ts     # Atomic write-to-temp-then-rename
│   │   ├── file-lock.ts         # File locking with proper-lockfile
│   │   └── ledger-store.ts      # Central storage abstraction
│   │
│   ├── tools/                   # MCP tool implementations
│   │   ├── help.ts              # ledger_help
│   │   ├── help-content.ts      # TOOL_HELP: static documentation strings for all 20 MCP tools
│   │   ├── observations.ts      # ledger_add_observation, ledger_add_project_comment
│   │   ├── pipeline.ts          # ledger_start_pipeline, ledger_complete_pipeline, ledger_cancel_pipeline, ledger_update_pipeline_progress
│   │   ├── project-lifecycle.ts # ledger_detect_project, ledger_get_project_status, ledger_initialize_project, ledger_list_projects, ledger_complete_synthesis
│   │   ├── work-package.ts      # WP CRUD tools
│   │   ├── workflow.ts          # Thin aggregator
│   │   ├── workflow-handoff.ts              # ledger_get_handoff_status
│   │   ├── workflow-next-action.ts          # ledger_get_next_action
│   │   └── workflow-next-action-batch.ts    # Batch/collector sub-module
│   │
│   └── utils/                   # Utility functions
│       ├── workflow-helpers.ts  # Shared constants and stateless helpers
│       ├── agent-registry.ts    # Discovers VS Code agent handles and IDs
│       ├── constants.ts         # Shared constants derived from shared/workflow-manifest.json
│       ├── if-defined.ts        # ifDefined() type guard helper
│       ├── ledger-root.ts       # resolveLedgerRoot(), projectSlugFromPath(), inferProjectRootFromPlanPath()
│       ├── path-validator.ts    # Project path validation
│       ├── pipeline-maps.ts     # Shared routing constants and utility functions
│       ├── project-reset.ts     # Semi-intelligent project reset
│       ├── timestamp.ts         # Timestamp formatting
│       ├── runner.ts            # classifyRunner(clientInfo) — normalises raw MCP clientInfo.name into a stable RunnerType enum; exports RunnerType, RunnerInfo, ClientInfo types; used by initializeProject to stamp runner metadata on new projects
│       └── wp-id.ts             # Work package ID formatting (WP-###)
│
└── tests/                       # Test suites
    ├── helpers/                 # Shared test utilities (NEVER write to production storage)
    │   ├── create-temp-store.ts # createTempStore() / cleanupTempStore() helpers
    │   ├── fixtures.ts          # makeWorkPackageDetail(), makePipeline(), makeWorkPackageSummary()
    │   └── test-utils.ts        # injectLedgerDir(), nowFloor()
    │
    ├── gui/                     # GUI and config module tests
    │   ├── auto-archive.test.ts # Unit tests for src/gui/auto-archive.ts (14 tests)
    │   ├── api-reset.test.ts    # Integration tests for handleResetProject (13 tests)
    │   ├── api-wp-overview.test.ts  # Unit tests for handleGetWorkPackageOverview (21 tests)
    │   ├── config.test.ts       # Unit tests for src/gui/config.ts
    │   ├── api.test.ts          # Unit tests for gui/api.ts; includes 6 handleListProjects runner filter tests (WP-005 verification of WP-003 ACs): runner field present and 'unknown' default for projects without stored runner (AC1), runner_counts object shape and values (AC1), runner=orchestrator filter returns only matching projects (AC2), runner_counts unaffected by active runner filter (AC3), runner:'unknown' filter returns projects with no stored runner field (AC4), unrecognized runner query returns empty set without 500 error (AC5), and combined status+runner filter
    │   └── handoff-config-integration.test.ts  # Integration: runtime config changes affect buildHandoffResponse
    │
    ├── integration/             # End-to-end workflow tests
    │   ├── auto-handoff.test.ts
    │   └── full-workflow.test.ts
    │
    ├── schema/                  # Schema validation tests
    │   ├── project-meta-runner.test.ts  # 10 backward-compatibility tests (WP-005 verification of WP-001 AC5): ProjectMetaSchema and RootIndexSchema accept runner fields when present (orchestrator, vscode, claude-code), accept empty strings for runner_client/runner_version, reject invalid enum values, and parse cleanly without runner fields (legacy fixture and full real-world legacy project-ledger.json simulation)
    │   ├── root-index.test.ts   # RootIndexSchema and WorkPackageSummarySchema tests (20 tests)
    │   ├── validators.test.ts
    │   └── work-package-schema.test.ts  # Zod parse-level tests (24 tests)
    │
    ├── storage/                 # Storage layer tests
    │   ├── ledger-store.test.ts # LedgerStore unit tests
    │   └── project-meta.test.ts
    │
    ├── tools/                   # Tool-level tests
    │   ├── cancelled-status.test.ts
    │   ├── cascade-reblock.test.ts
    │   ├── claim-guard.test.ts
    │   ├── pipeline.test.ts
    │   ├── project-lifecycle.test.ts
    │   ├── rework-circuit-breaker.test.ts
    │   ├── schema-integrity.test.ts
    │   ├── synthesis-terminal.test.ts
    │   ├── work-package.test.ts
    │   ├── workflow-handoff.test.ts
    │   ├── workflow-next-action.test.ts
    │   ├── runner-integration.test.ts  # 9 integration tests (WP-005 verification of WP-002 ACs): runner fields in root index response and on disk (AC1), runner fields in .meta.json (AC2), graceful 'unknown' default when getClientInfo() returns undefined (AC3), no runner info written to stdout (AC5); uses vi.mock hoisting to control getClientInfo() return value per test group; covers all four runner types (orchestrator, vscode, claude-code, unknown)
    │   └── workflow-rework-loop.test.ts
    │
    └── utils/                   # Utility function tests
        ├── agent-registry.test.ts
        ├── if-defined.test.ts
        ├── ledger-root.test.ts
        ├── path-validator.test.ts
        ├── pipeline-maps.test.ts
        ├── project-reset.test.ts
        ├── runner.test.ts       # 10 unit tests for classifyRunner() (WP-005 verification of WP-001 ACs): all four output variants (vscode, claude-code, orchestrator, unknown), undefined input without throw, empty-string name, unrecognized client name, case-insensitive substring matching (vscode keyword, Claude uppercase, langchain variants), and raw runner_client/runner_version value preservation
        ├── timestamp.test.ts
        ├── workflow-helpers.test.ts
        ├── workflow-manifest.test.ts  # Structural invariants (34 tests)
        └── wp-id.test.ts
```

---

## Directory Annotations

### `src/schema/`

Centralized data structure definitions using Zod. All schemas are validated at runtime on reads and writes. TypeScript types are inferred from schemas, ensuring type/schema consistency.

### `src/storage/`

File I/O layer with atomicity and locking guarantees. `LedgerStore` is the primary abstraction — all tools should use it rather than reading/writing files directly.

### `src/tools/`

Each file exports a `register(server: McpServer)` function that registers one or more MCP tools. Tools are grouped by functional category (lifecycle, work packages, pipelines, observations, workflow).

The workflow tools are split across four files: `workflow.ts` (thin aggregator), `workflow-next-action.ts` (per-role single-action logic for `ledger_get_next_action`), `workflow-next-action-batch.ts` (batch/collector sub-module), and `workflow-handoff.ts` (`ledger_get_handoff_status`). Shared constants and pure helpers live in `src/utils/workflow-helpers.ts`.

## Generated/Ignored Directories

The following directories are not version-controlled:
- node_modules/ — npm dependencies
- dist/ — TypeScript compilation output
- storage/ledger/{slug}/ — per-project ledger runtime data

