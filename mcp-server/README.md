# Project Ledger MCP Server

**A Model Context Protocol server that keeps AI coding agents in sync across sessions**

---

## What Is This?

The **Project Ledger MCP Server** is a specialized backend service that manages persistent project state for multi-agent AI workflows. It acts as a "source of truth" that agents can read from and write to, ensuring that work progress, decisions, and context are preserved across chat sessions.

Think of it as a **structured database for AI agents**, where each agent can:
- Check what work has been completed
- See what's currently in progress
- Understand dependencies between tasks
- Record their findings and observations
- Coordinate handoffs to the next agent in the workflow

---

## Why Does This Exist?

### The Problem

When building complex features with AI agents across multiple sessions, you face these challenges:

1. **Context Loss**: Each new chat session starts from scratch. Agents can't remember what happened before.
2. **Duplicate Work**: Without coordination, agents might redo completed tasks or miss dependencies.
3. **Inconsistent State**: Manual JSON editing leads to typos, schema violations, and file corruption.
4. **Race Conditions**: Multiple agents editing the same files simultaneously can cause conflicts.

### The Solution

The MCP server solves these problems by:

- **Persisting State**: Maintains a structured JSON ledger on disk that survives between sessions
- **Enforcing Validation**: Uses strict schemas (Zod) to prevent invalid data from being written
- **Preventing Corruption**: Uses atomic writes and file locking to ensure data consistency
- **Providing Coordination**: Offers workflow tools that tell agents what to do next based on project state

---

## How It Works

### Architecture

The server exposes **13 MCP tools** that agents invoke to manage project state:

```
┌─────────────────────────────────────────────────┐
│          AI Agent (Developer/QA/etc.)           │
└──────────────────┬──────────────────────────────┘
                   │ MCP Protocol (STDIO)
                   │
┌──────────────────▼──────────────────────────────┐
│         Project Ledger MCP Server               │
│  ┌─────────────────────────────────────────┐    │
│  │  Tools: create_work_package,            │    │
│  │         start_pipeline,                 │    │
│  │         get_next_action, etc.           │    │
│  └─────────────────┬───────────────────────┘    │
│                    │                            │
│  ┌─────────────────▼───────────────────────┐    │
│  │  LedgerStore: Atomic I/O + Validation   │    │
│  └─────────────────┬───────────────────────┘    │
└────────────────────┼────────────────────────────┘
                     │
         ┌───────────┴──────────┐
         │   JSON Files on Disk │
         ├──────────────────────┤
         │ .ledger/             │
         │   project-ledger.json│ ← Root index
         │   WP-001.json        │ ← Work package 1
         │   WP-002.json        │ ← Work package 2
         │   ...                │
         └──────────────────────┘
```

### Data Model

The server manages two types of files:

1. **Root Index** (`.ledger/project-ledger.json`): High-level project metadata
   - Project status (READY, IN_PROGRESS, COMPLETE, BLOCKED)
   - Work package summaries (status, assigned agent, dependencies)
   - Project-level comments and incidents

2. **Work Package Details** (`.ledger/WP-###.json`): Per-task implementation details
   - Acceptance criteria and completion status
   - Pipeline history (implementation, QA, review, documentation)
   - Artifacts (files modified, commit hashes, test results)
   - Observations and technical debt notes

Both files are kept in sync automatically — when an agent updates a work package, the server updates both files in a single atomic operation.

---

## Setup

### Prerequisites

- **Node.js** (ESM-compatible version)
- **npm** or compatible package manager

### Installation

1. **Install dependencies**:
   ```bash
   cd mcp-server
   npm install
   ```

2. **Configure Claude Desktop or Claude Code**:
   
   Add the server to your `.mcp.json` (or MCP configuration file):

   ```json
   {
     "mcpServers": {
       "project-ledger": {
         "command": "npx",
         "args": ["tsx", "/absolute/path/to/ai-insights/mcp-server/src/index.ts"]
       }
     }
   }
   ```

   **Important**: Use the **absolute path** to the `src/index.ts` file on your system.

3. **Restart your AI IDE** to load the MCP server

4. **Verify**:
   - The server starts automatically when Claude Code/Desktop launches
   - Agents will perform a pre-flight check (`ledger_get_project_status`) before starting work
   - If the server is unreachable, agents will report configuration errors

---

## Usage

### For Agent Workflows

The MCP server is designed to work with the [Ledger-Enabled Agent Workflow](../personas/ledger/README.md). Agents use the server automatically — you don't need to invoke tools manually.

**Typical Agent Session:**

1. **Agent checks project status** via `ledger_get_project_status`
2. **Agent reads work package details** via `ledger_get_work_package`
3. **Agent performs work** (writes code, runs tests, etc.)
4. **Agent updates ledger** via MCP tools:
   - `ledger_start_pipeline` — Begins implementation/QA/review
   - `ledger_complete_pipeline` — Records results and artifacts
   - `ledger_add_observation` — Notes technical debt or improvements
   - `ledger_update_work_package_status` — Marks tasks complete

5. **Agent asks for next action** via `ledger_get_next_action` or `ledger_get_handoff_status`

### Example: Developer Agent Flow

```
User: "Implement WP-003"

Agent:
1. Calls ledger_get_work_package(WP-003)
   └─ Reads: Acceptance criteria, dependencies, current status

2. Validates dependencies are complete

3. Calls ledger_claim_work_package(WP-003, agent="Developer")
   └─ Updates: Status READY → IN_PROGRESS

4. Calls ledger_start_pipeline(type="implementation")
   └─ Creates: New pipeline entry with status IN_PROGRESS

5. Implements the feature (writes code)

6. Calls ledger_complete_pipeline(
     status="PASS",
     summary=["Added authentication middleware", "Updated routes"],
     artifacts={files_modified: ["src/auth.ts", "src/routes.ts"]},
     acceptance_criteria_updates=[{criterion: "Auth required", met: true}]
   )
   └─ Updates: Pipeline status, artifacts, acceptance criteria

7. Calls ledger_update_work_package_status(status="COMPLETE")
   └─ Updates: WP-003 status to COMPLETE (if all criteria met)
```

### For Manual Inspection

You can read the ledger files directly — they're human-readable JSON:

```bash
# View project overview
cat docs/agents/plans/2026-02-11-feature-name/.ledger/project-ledger.json

# View work package details
cat docs/agents/plans/2026-02-11-feature-name/.ledger/WP-001.json
```

**Warning**: Never edit ledger files manually. Always let agents use MCP tools to ensure consistency.

---

## Available Tools

The server exposes 13 MCP tools organized by category:

### Project Lifecycle
- `ledger_get_project_status` — Read project overview
- `ledger_initialize_project` — Create new ledger

### Work Packages
- `ledger_get_work_package` — Read full WP details
- `ledger_list_work_packages` — List/filter work packages
- `ledger_create_work_package` — Create new work package
- `ledger_claim_work_package` — Start working on a WP
- `ledger_update_work_package_status` — Update WP status

### Pipelines
- `ledger_start_pipeline` — Begin implementation/QA/review/docs phase
- `ledger_complete_pipeline` — Record results and artifacts

### Observations
- `ledger_add_observation` — Add comment to pipeline
- `ledger_add_project_comment` — Add project-level comment

### Workflow Coordination
- `ledger_get_next_action` — Ask "what should I do next?"
- `ledger_get_handoff_status` — Compute handoff status for current agent

For detailed API signatures and parameters, see the [API Surface](docs/agents/project-manifest/api-surface.md).

---

## Key Features

### ✅ Atomic Operations

All writes use the **write-to-temp-then-rename** pattern:
- Prevents readers from seeing partial writes
- Ensures JSON files are never corrupted

### ✅ File Locking

Distributed file locking with `proper-lockfile`:
- Prevents race conditions when multiple agents run concurrently
- Automatic stale lock detection (10 second timeout)
- Retry logic with exponential backoff

### ✅ Schema Validation

All data validated with Zod before reading or writing:
- Catches schema violations early
- TypeScript types inferred from schemas
- Runtime validation on every I/O operation

### ✅ Dual-File Sync

Work package updates are atomic across both files:
- Root index and WP detail always stay consistent
- Single lock protects both files during update
- No possibility of split-brain state

### ✅ Self-Healing Counters

`ledger_get_project_status` automatically corrects counter drift:
- Recomputes totals from actual work package data
- Silently fixes inconsistencies
- Provides fault tolerance against bugs

---

## Troubleshooting

### "MCP server unavailable"

**Symptoms**: Agents report they cannot reach the server

**Solutions**:
1. Verify `.mcp.json` exists and points to correct path
2. Ensure dependencies are installed: `cd mcp-server && npm install`
3. Check the path uses forward slashes or proper escaping
4. Restart your AI IDE to reload MCP configuration

### MCP Tool Call Fails

**Symptoms**: Error messages from server during operation

**Solutions**:
1. Check that `project_path` arguments are absolute paths
2. Verify ledger files haven't been manually edited or corrupted
3. Look for schema validation errors in the error message
4. Check file permissions (server needs write access)

### Lock Acquisition Timeout

**Symptoms**: "Failed to acquire lock after 5 retries"

**Solutions**:
1. Another process may be holding the lock — wait and retry
2. If a process crashed, manually delete `.ledger.lock` file
3. Check that lock timeout (10s) hasn't been exceeded

---

## Development

### Versioning

This project uses **`changelog.md` as the source of truth** for versioning:

1. **When releasing a new version**, update the changelog first:
   ```markdown
   ## v1.0.2 - 2026-02-20
   
   ### Added
   - New feature...
   ```

2. **Sync the version** to `package.json`:
   ```bash
   npm run sync-version
   ```
   This script extracts the version from `changelog.md` and updates `package.json` automatically.

3. **The MCP server displays its version** at startup in STDERR:
   ```
   [project-ledger-mcp] Server v1.0.2 started successfully
   ```

The `sync-version` script runs automatically before `npm run dev` via the `predev` hook.

### Running Tests

```bash
npm test              # Run all tests once
npm run test:watch   # Run tests in watch mode
```

### Development Mode

```bash
npm run dev          # Run server with tsx (auto-reload)
```

### Project Structure

See [File Tree](docs/agents/project-manifest/file-tree.md) for detailed structure.

Key directories:
- `src/schema/` — Zod schemas and validators
- `src/storage/` — File I/O and locking
- `src/tools/` — MCP tool implementations
- `tests/` — Unit and integration tests

---

## Technical Documentation

For developers and curious users who want to understand the internals:

- **[Project Manifest](docs/agents/project-manifest/)** — Comprehensive technical documentation
  - [Tech Stack & Patterns](docs/agents/project-manifest/tech-stack.md)
  - [Public API Surface](docs/agents/project-manifest/api-surface.md)
  - [Key Data Flows](docs/agents/project-manifest/data-flows.md)
  - [Constraints & Conventions](docs/agents/project-manifest/constraints.md)

---

## Related Documentation

- **[Ledger-Enabled Agent Workflow](../personas/ledger/)** — How to use this server with AI agents
- **[Ledger Schema Reference](../personas/ledger/project-ledger-schema.md)** — JSON structure specification
- **[Agent Personas](../personas/ledger/)** — The 7 agents that use this server

---

## License

Same as the parent ai-insights project.
