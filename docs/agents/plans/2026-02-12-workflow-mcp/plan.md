# Plan: Project Ledger MCP Server

## Context

The ai-insights repo contains a mature 7-stage agent workflow (Planner → PM → Developer → QA → Reviewer → Docs → Synthesis) that tracks state via JSON files on disk. The split-file ledger architecture (v2.2.0) works well structurally, but agents interact with it via raw file I/O — leading to dual-file desync bugs, invalid status transitions, malformed pipeline entries, and incorrect handoff calculations. The most recent commits (`568389a`, `4021bd9`) were both fixes for exactly these problems.

An MCP server that wraps the ledger operations gives agents typed tools instead of raw JSON manipulation, enforcing consistency, validation, and atomicity at the server level.

## Tech Stack

- **TypeScript + Node.js** (MCP SDK is TypeScript-first)
- **@modelcontextprotocol/sdk** — official MCP SDK
- **zod** — input validation (also MCP SDK peer dependency)
- **proper-lockfile** — battle-tested file locking
- **vitest** — test runner
- **tsx** — dev runner (no build step needed for Claude Code)
- **Transport**: STDIO (local Claude Code usage)

## Project Structure

```
ai-insights/
└── mcp-server/
    ├── package.json
    ├── tsconfig.json
    ├── src/
    │   ├── index.ts                  ← entry point: McpServer + StdioServerTransport
    │   ├── storage/
    │   │   ├── file-lock.ts          ← proper-lockfile wrapper
    │   │   ├── atomic-writer.ts      ← write-to-temp-then-rename
    │   │   └── ledger-store.ts       ← read/write root index + WP files
    │   ├── schema/
    │   │   ├── enums.ts              ← status, pipeline type, comment type enums
    │   │   ├── root-index.ts         ← Zod schema matching project-ledger.json
    │   │   ├── work-package.ts       ← Zod schema matching ledger/WP-###.json
    │   │   └── validators.ts         ← status transitions, dependency checks
    │   ├── tools/
    │   │   ├── project-lifecycle.ts   ← initialize_project, get_project_status
    │   │   ├── work-package.ts        ← CRUD + claim + status update
    │   │   ├── pipeline.ts            ← start_pipeline, complete_pipeline
    │   │   ├── observations.ts        ← add_observation, add_project_comment
    │   │   └── workflow.ts            ← get_next_action, get_handoff_status
    │   └── utils/
    │       ├── timestamp.ts           ← "YYYY-MM-DD HH:MM:SS" format (matches schema)
    │       └── wp-id.ts              ← WP-### formatting/parsing
    └── tests/
        ├── fixtures/                  ← known-good JSON project states
        ├── storage/
        ├── schema/
        └── tools/
```

## MCP Tools (13 total)

### Project Lifecycle

| Tool | Description | Key Behavior |
|------|-------------|--------------|
| `initialize_project` | Create ledger structure for a new plan | Creates `project-ledger.json` + `ledger/` dir. Requires plan folder to exist. Rejects if ledger already exists. |
| `get_project_status` | Read project overview | Returns root index. Recomputes `pending_work_packages` from actual WP statuses (self-healing). |

### Work Package Management

| Tool | Description | Key Behavior |
|------|-------------|--------------|
| `create_work_package` | Add a new WP (PM agent) | Creates `ledger/WP-###.json` AND appends to root index atomically. Increments counters. |
| `claim_work_package` | Assign WP to agent | Validates all dependencies are COMPLETE before allowing READY → IN_PROGRESS. |
| `update_work_package_status` | Change WP status | Enforces legal transitions (see table below). Updates both files atomically. |
| `get_work_package` | Read full WP detail | Returns full `ledger/WP-###.json` content with validation. |
| `list_work_packages` | List WPs with filters | Filter by status and/or assigned_to from root index. |

### Pipeline Management

| Tool | Description | Key Behavior |
|------|-------------|--------------|
| `start_pipeline` | Begin a pipeline stage | Appends IN_PROGRESS pipeline entry. WP must be IN_PROGRESS. No duplicate in-progress pipelines. |
| `complete_pipeline` | Record pipeline result | Sets PASS/FAIL, summary, artifacts, metrics, comments. Can update acceptance criteria. |

### Observations

| Tool | Description | Key Behavior |
|------|-------------|--------------|
| `add_observation` | Add comment to a pipeline | Appends to pipeline's comments array with auto-timestamp. |
| `add_project_comment` | Add project-level comment | Appends to root index `project_comments`. Requires `agent` field. Requires `context` for incidents. |

### Workflow Intelligence

| Tool | Description | Key Behavior |
|------|-------------|--------------|
| `get_next_action` | What should this agent do next? | Examines WP statuses and pipelines to recommend next step per agent role. |
| `get_handoff_status` | Compute correct STATUS: line | Returns the exact `AGENT:` / `STATUS:` handoff block based on current project state. |

## Status Transition Rules (enforced by server)

| From | To | Conditions |
|------|----|------------|
| READY | IN_PROGRESS | All dependencies COMPLETE |
| READY | BLOCKED | `blocked_by` required |
| IN_PROGRESS | COMPLETE | All acceptance_criteria `met: true` |
| IN_PROGRESS | BLOCKED | `blocked_by` required |
| BLOCKED | IN_PROGRESS | Clears `blocked_by` |
| COMPLETE | IN_PROGRESS | Increments `revision` |

All other transitions are rejected with an actionable error message.

## Storage Layer Design

- **All reads/writes go through `LedgerStore`** — single abstraction for file I/O
- **`withLock()` pattern** — acquires lockfile, buffers writes, commits atomically, releases in `finally`
- **Atomic writes** — write to `{file}.tmp.{pid}`, then `fs.rename` (POSIX-atomic)
- **Dual-file sync** — every WP mutation updates both the detail file and root index summary within the same lock
- **Self-healing reads** — `get_project_status` recomputes counters from actual WP data, correcting drift from any prior manual edits
- **Lock file**: `{project_path}/.ledger.lock` via `proper-lockfile` (10s stale timeout, 5 retries)

## Implementation Order (4 waves)

### Wave 1: Foundation + Read Tools
1. Project scaffolding (package.json, tsconfig, index.ts boilerplate)
2. Zod schemas matching existing `project-ledger-schema.md` exactly
3. Storage layer (LedgerStore, AtomicWriter, FileLock)
4. Read tools: `get_project_status`, `get_work_package`, `list_work_packages`

**Value**: Agents can query ledgers via MCP with schema validation. Catches malformed JSON early.

### Wave 2: Core Write Operations
5. Status transition validators
6. `initialize_project`
7. `create_work_package`
8. `claim_work_package`
9. `update_work_package_status`

**Value**: Dual-file sync and status transition bugs eliminated.

### Wave 3: Pipeline & Comments
10. `start_pipeline` + `complete_pipeline`
11. `add_observation`
12. `add_project_comment`

**Value**: Complex nested JSON structures handled entirely by the server.

### Wave 4: Workflow Intelligence
13. `get_next_action`
14. `get_handoff_status`

**Value**: Agents no longer miscalculate handoffs.

## Claude Code Registration

```bash
claude mcp add project-ledger -- npx tsx /path/to/ai-insights/mcp-server/src/index.ts
```

Register in each consuming project's settings. Single server instance handles all projects via the `project_path` parameter on every tool.

## Migration Path

- **Zero schema change** — reads/writes the exact same JSON format as today
- **Existing projects** work immediately — no migration command needed
- **Mixed mode safe** — if agents write JSON directly, next MCP read picks it up
- **Gradual adoption**: start with read tools (Wave 1), then add write tools as confidence grows
- **Persona updates** (future pass): update persona prompts to reference MCP tools instead of direct JSON manipulation

## Verification

1. **Unit tests**: Zod schemas parse real ledger files correctly; transition validator accepts/rejects each combination
2. **Integration tests**: Create temp project dirs, run tool handlers, verify file system state
3. **Manual smoke test**: Register in Claude Code, use `get_project_status` against an existing project ledger, verify output matches direct file read
4. **End-to-end**: Run a small 2-WP project through the full workflow using MCP tools exclusively

## Key Files to Reference During Implementation

- `personas/ledger/project-ledger-schema.md` — authoritative schema (Zod schemas must match exactly)
- `personas/ledger/3-developer.md` — example of how agents currently interact with ledger
- `personas/changelog.md` — version history context
- `history/error-ledger.md` — known agent failure patterns to guard against
