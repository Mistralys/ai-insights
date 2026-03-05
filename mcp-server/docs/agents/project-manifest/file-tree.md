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
│   ├── api.ts               # REST API route handlers (handleListProjects, handleGetProject, handleGetWorkPackage, handleGetPlanDocument, handleDeleteProject, handleGetConfig, handleUpdateConfig)
│   ├── server.ts            # Standalone Node.js HTTP server (node:http); routes /api/* to api.ts handlers, serves static files from gui/public/; started via `npm run gui`
│   └── public/              # Static assets served by gui/server.ts
│       ├── index.html       # Dashboard SPA shell — nav header, main#app, loads styles.css + libs/marked.min.js + app.js
│       ├── styles.css       # Full CSS: custom properties, status badges, tables, cards, forms, loading/error states, plan-content/plan-synopsis
│       ├── app.js           # Vanilla JS SPA: API client, hash-based Router, 6 views (project list, project detail, plan viewer, WP detail, config, insights)
│       └── libs/
│           └── marked.min.js  # Vendored Markdown parser (marked v15.0.12, ~40 KB); loaded before app.js; used by the plan viewer
│
├── src/                         # Source code
│   ├── index.ts                 # MCP server entry point and tool registration
│   │
│   ├── gui/                     # Shared GUI/config module (also used by the HTTP GUI server process)
│   │   └── config.ts            # Runtime config: GuiConfigSchema, getConfig(), readConfigFromDisk(), writeConfig(), startConfigWatcher(), stopConfigWatcher()
│   │
│   ├── schema/                  # Zod schemas and type definitions
│   │   ├── enums.ts             # Status enums (ProjectStatus, WorkPackageStatus, etc.)
│   │   ├── project-meta.ts      # ProjectMetaSchema / ProjectMeta — per-project .meta.json
│   │   ├── root-index.ts        # RootIndex schema (storage/ledger/{slug}/project-ledger.json structure)
│   │   ├── validators.ts        # Business rule validators (status transitions, dependencies)
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
│       ├── workflow-helpers.ts  # Shared constants and stateless helpers used by all three workflow tool sub-modules; exports getMaxHandoffDepth() (reads from GUI config cache)
│       ├── agent-registry.ts    # Discovers VS Code agent handles and IDs by scanning *.agent.md files; exports discoverAgents(), getAgentHandle(), getAgentId(), isRegistryLoaded(), resetRegistry()
│       ├── constants.ts         # Shared string constants and AGENT_ROLES
│       ├── if-defined.ts        # ifDefined() type guard helper
│       ├── ledger-root.ts       # resolveLedgerRoot(), projectSlugFromPath(), inferProjectRootFromPlanPath() — central ledger location and plan-path utilities
│       ├── path-validator.ts    # Project path validation; exports planFolderBasename(), validatePlanPath(), resolveProjectPath()
│       ├── pipeline-maps.ts     # Shared routing constants (PIPELINE_PREREQUISITES, PIPELINE_AGENT_MAP, NEXT_AGENT_MAP, FAIL_ROUTING_MAP, AGENT_PIPELINE_MAP) and utility functions (getDownstreamTypes, getUpstreamTypes)
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
    │   ├── config.test.ts       # Unit tests for src/gui/config.ts (cache, read, write, watcher lifecycle)
    │   ├── api.test.ts          # Unit tests for gui/api.ts (all handlers, NOT_FOUND / FORBIDDEN / VALIDATION_ERROR guards)
    │   └── handoff-config-integration.test.ts  # Integration: runtime config changes affect buildHandoffResponse at runtime
    │
    ├── integration/             # End-to-end workflow tests
    │   ├── auto-handoff.test.ts
    │   └── full-workflow.test.ts
    │
    ├── schema/                  # Schema validation tests
    │   ├── validators.test.ts
    │   └── work-package-schema.test.ts  # Zod parse-level tests for PipelineSchema and WorkPackageDetailSchema new fields (22 tests)
    │
    ├── storage/                 # Storage layer tests
    │   ├── ledger-store.test.ts
    │   └── project-meta.test.ts
    │
    ├── tools/                   # Tool-level tests
    │   ├── cancelled-status.test.ts  # CANCELLED status transitions and dependency satisfaction
    │   ├── cascade-reblock.test.ts  # Cascade-block on COMPLETE → IN_PROGRESS reopen
    │   ├── claim-guard.test.ts  # Assignment guard for ledger_claim_work_package
    │   ├── pipeline.test.ts
    │   ├── project-lifecycle.test.ts  # ledger_complete_synthesis, self-healing with synthesis_generated
    │   ├── rework-circuit-breaker.test.ts  # Circuit breaker on MAX_REWORK_COUNT    ├── schema-integrity.test.ts  # Regression guard: all 22 registered tool schemas produce non-empty JSON Schema properties (guards against .refine()/.transform() on outer ZodObject — see Constraint 63)    │   ├── synthesis-terminal.test.ts  # Synthesis terminal state and project COMPLETE transition
    │   ├── work-package.test.ts
    │   ├── workflow-handoff.test.ts
    │   ├── workflow-next-action.test.ts  # REWORK routing, Documentation FAIL routing, BLOCK_FOR_REWORK_LIMIT
    │   └── workflow-rework-loop.test.ts  # End-to-end rework loop covering FAIL → REWORK → PASS cycles
    │
    └── utils/                   # Utility function tests
        ├── agent-registry.test.ts
        ├── if-defined.test.ts
        ├── ledger-root.test.ts
        ├── path-validator.test.ts
        ├── pipeline-maps.test.ts  # Tests for getDownstreamTypes, getUpstreamTypes
        ├── timestamp.test.ts    # UTC ISO 8601 formatting by now()
        ├── workflow-helpers.test.ts  # MAX_REWORK_COUNT, isTerminalStatus, hasNewUpstreamPassSince
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
