# File Tree

```
mcp-server/
├── .npmrc                       # npm configuration
├── package.json                 # Project metadata and dependencies
├── tsconfig.json                # TypeScript compiler configuration
├── vitest.config.ts             # Vitest test framework configuration
│
├── src/                         # Source code
│   ├── index.ts                 # MCP server entry point and tool registration
│   │
│   ├── schema/                  # Zod schemas and type definitions
│   │   ├── enums.ts             # Status enums (ProjectStatus, WorkPackageStatus, etc.)
│   │   ├── root-index.ts        # RootIndex schema (.ledger/project-ledger.json structure)
│   │   ├── validators.ts        # Business rule validators (status transitions, dependencies)
│   │   └── work-package.ts      # WorkPackageDetail schema (.ledger/WP-###.json structure)
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
│   │   ├── project-lifecycle.ts # ledger_get_project_status, ledger_initialize_project
│   │   ├── work-package.ts      # WP CRUD tools (get, list, create, claim, update_status)
│   │   └── workflow.ts          # ledger_get_next_action, ledger_get_next_actions, ledger_get_handoff_status
│   │
│   └── utils/                   # Utility functions
│       ├── path-validator.ts    # Project path validation (absolute path checks)
│       ├── pipeline-maps.ts     # Shared routing constants (PIPELINE_PREREQUISITES, PIPELINE_AGENT_MAP, NEXT_AGENT_MAP, AGENT_PIPELINE_MAP)
│       ├── timestamp.ts         # Timestamp formatting — now() returns ISO 8601 T-separator (YYYY-MM-DDTHH:MM:SS); parseTimestamp() handles legacy space format
│       └── wp-id.ts             # Work package ID formatting (WP-###)
│
└── tests/                       # Test suites
    ├── integration/             # End-to-end workflow tests
    │   └── full-workflow.test.ts
    │
    ├── schema/                  # Schema validation tests
    │   └── validators.test.ts
    │
    ├── storage/                 # Storage layer tests
    │   └── ledger-store.test.ts
    │
    ├── tools/                   # Tool-level tests
    │   ├── pipeline.test.ts
    │   ├── work-package.test.ts
    │   └── workflow-handoff.test.ts
    │
    └── utils/                   # Utility function tests
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

Vitest test suites organized by layer (integration, schema, storage, utils). Tests run with `npm test` or `npm run test:watch`.

---

## Generated/Ignored Directories

The following directories are not version-controlled:

- `node_modules/` — npm dependencies
- `dist/` — TypeScript compilation output (when built)
