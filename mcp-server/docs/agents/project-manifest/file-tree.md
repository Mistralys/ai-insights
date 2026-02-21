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
│       └── {slug}/              # Per-project subfolder — runtime-generated
│           ├── .meta.json       # Project metadata (slug, status, timestamps)
│           ├── .lock            # Lock file for concurrent-write protection
│           ├── project-ledger.json  # Root index
│           └── WP-001.json      # Work package detail files
│
├── src/                         # Source code
│   ├── index.ts                 # MCP server entry point and tool registration
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
│   │   ├── help.ts              # ledger_help (inline documentation for all tools)
│   │   ├── observations.ts      # ledger_add_observation, ledger_add_project_comment
│   │   ├── pipeline.ts          # ledger_start_pipeline, ledger_complete_pipeline, ledger_cancel_pipeline, ledger_update_pipeline_progress
│   │   ├── project-lifecycle.ts # ledger_detect_project, ledger_get_project_status, ledger_initialize_project, ledger_list_projects
│   │   ├── work-package.ts      # WP CRUD tools (get, list, create, claim, update_status)
│   │   └── workflow.ts          # ledger_get_next_action, ledger_get_next_actions, ledger_get_handoff_status
│   │
│   └── utils/                   # Utility functions
│       ├── agent-registry.ts    # Discovers VS Code agent handles by scanning *.agent.md files; exports discoverAgents(), getAgentHandle(), isRegistryLoaded(), resetRegistry()
│       ├── constants.ts         # Shared string constants and AGENT_ROLES
│       ├── if-defined.ts        # ifDefined() type guard helper
│       ├── ledger-root.ts       # resolveLedgerRoot(), projectSlugFromPath(), inferProjectRootFromPlanPath() — central ledger location and plan-path utilities
│       ├── path-validator.ts    # Project path validation; exports planFolderBasename(), validatePlanPath(), validatePlanPathOrError()
│       ├── pipeline-maps.ts     # Shared routing constants (PIPELINE_PREREQUISITES, PIPELINE_AGENT_MAP, NEXT_AGENT_MAP, AGENT_PIPELINE_MAP)
│       ├── timestamp.ts         # Timestamp formatting — now() returns ISO 8601 T-separator (YYYY-MM-DDTHH:MM:SS); parseTimestamp() handles legacy space format
│       └── wp-id.ts             # Work package ID formatting (WP-###)
│
└── tests/                       # Test suites
    ├── helpers/                 # Shared test utilities (NEVER write to production storage)
    │   └── create-temp-store.ts # createTempStore() / cleanupTempStore() helpers
    │
    ├── integration/             # End-to-end workflow tests
    │   ├── auto-handoff.test.ts
    │   └── full-workflow.test.ts
    │
    ├── schema/                  # Schema validation tests
    │   └── validators.test.ts
    │
    ├── storage/                 # Storage layer tests
    │   ├── ledger-store.test.ts
    │   └── project-meta.test.ts
    │
    ├── tools/                   # Tool-level tests
    │   ├── pipeline.test.ts
    │   ├── work-package.test.ts
    │   └── workflow-handoff.test.ts
    │
    └── utils/                   # Utility function tests
        ├── agent-registry.test.ts
        ├── if-defined.test.ts
        ├── ledger-root.test.ts
        ├── path-validator.test.ts
        ├── timestamp.test.ts
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

### `tests/`

Vitest test suites organized by layer (helpers, integration, schema, storage, tools, utils). Tests run with `npm test` or `npm run test:watch`.

`tests/helpers/create-temp-store.ts` provides `createTempStore(planPath)` and `cleanupTempStore(handle)` — a shared factory that always injects a `mkdtemp` ledger root, enforcing the test isolation contract (see Constraint 20).

---

## Generated/Ignored Directories

The following directories are not version-controlled:

- `node_modules/` — npm dependencies
- `dist/` — TypeScript compilation output (when built)
- `storage/ledger/{slug}/` — per-project ledger runtime data (excluded via `.gitignore`; only `storage/ledger/.gitkeep` is committed)

> **Note:** Plan folders (e.g. `docs/agents/plans/2026-02-16-feature/`) contain only human-authored Markdown files. No machine-generated JSON is ever written inside a plan folder.
