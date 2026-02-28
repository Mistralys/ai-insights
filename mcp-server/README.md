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

The server exposes **20 MCP tools** that agents invoke to manage project state:

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
         │ storage/ledger/      │
         │   {slug}/             │ ← Per-project subfolder
         │     .meta.json        │ ← Project metadata
         │     project-ledger.json│ ← Root index
         │     WP-001.json       │ ← Work package 1
         │     WP-002.json       │ ← Work package 2
         │     ...               │
         └──────────────────────┘
```

> Ledger files are stored at `{mcp-server}/storage/ledger/{slug}/`, **not** inside plan folders.
> Plan folders remain purely human-readable Markdown. Use `ledger_list_projects` to enumerate all tracked projects.

### Data Model

The server manages three types of files, all stored under the centralized ledger root:

1. **Project Metadata** (`storage/ledger/{slug}/.meta.json`): Lightweight per-project summary
   - Slug, original plan path, current status, timestamps
   - Written automatically whenever the root index is updated
   - Used by `ledger_list_projects` to enumerate all projects without loading full root indexes

2. **Root Index** (`storage/ledger/{slug}/project-ledger.json`): High-level project metadata
   - Project status (READY, IN_PROGRESS, COMPLETE, BLOCKED)
   - Work package summaries (status, assigned agent, dependencies)
   - Project-level comments and incidents
   - Auto-handoff loop-guard counter (`auto_handoff_depth`, server-managed, max 10 before fallback to manual routing)
   - Synthesis completion flag (`synthesis_generated`, set by `ledger_complete_synthesis`)

3. **Work Package Details** (`storage/ledger/{slug}/WP-###.json`): Per-task implementation details
   - Acceptance criteria and completion status
   - Pipeline history (implementation, QA, review, documentation)
   - Artifacts (files modified, commit hashes, test results)
   - Observations and technical debt notes

All three file types are kept in sync automatically — when an agent updates a work package, the server updates both JSON files and the `.meta.json` in a single atomic operation.

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

   **Optional: Custom agents directory**

   To enable auto-handoff, the server needs to locate your `*.agent.md` persona files. By default it auto-detects the VS Code User prompts folder for the current platform:

   | Platform | Default path |
   |---|---|
   | macOS | `~/Library/Application Support/Code/User/prompts/` |
   | Linux | `~/.config/Code/User/prompts/` |
   | Windows | `%APPDATA%/Code/User/prompts/` |

   If your persona files live elsewhere, pass `--agents-dir` explicitly:

   ```json
   {
     "mcpServers": {
       "project-ledger": {
         "command": "npx",
         "args": [
           "tsx",
           "/absolute/path/to/ai-insights/mcp-server/src/index.ts",
           "--agents-dir",
           "/absolute/path/to/your/prompts"
         ]
       }
     }
   }
   ```

   If the directory is missing or contains no `*.agent.md` files, the server logs a warning and starts normally — auto-handoff is disabled but all other tools continue to work.

3. **Restart your AI IDE** to load the MCP server

4. **Verify**:
   - The server starts automatically when Claude Code/Desktop launches
   - Agents will perform a pre-flight check (`ledger_get_project_status`) before starting work
   - If the server is unreachable, agents will report configuration errors
   - On startup, the server logs agent discovery results to stderr:
     - ✅ Success: `[project-ledger-mcp] Agent registry: 7 agents discovered from /path/to/prompts`
     - ⚠️ Not found: `[project-ledger-mcp] agents_dir not found: /path. Auto-handoff disabled.`

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

   `ledger_get_handoff_status` may return an `auto_handoff` object:
   ```json
   {
     "current_agent": "Developer",
     "next_agent": "QA",
     "status": "HANDOFF",
     "auto_handoff": {
       "agent_name": "4-qa.agent.md",
       "prompt": "Project path: /path/to/plan"
     }
   }
   ```
   When present, the IDE can invoke the next agent automatically without human routing. When absent, use the standard `CURRENT AGENT / NEXT AGENT / STATUS` block for manual routing.

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

7. After QA, review, and documentation pipelines pass, the Documentation Agent calls
   ledger_update_work_package_status(status="COMPLETE", agent="Documentation Agent")
   └─ Updates: WP-003 status to COMPLETE (if all criteria met)
```

### For Manual Inspection

You can read the ledger files directly — they're human-readable JSON:

```bash
# View project overview
cat storage/ledger/2026-02-11-feature-name/project-ledger.json

# View work package details
cat storage/ledger/2026-02-11-feature-name/WP-001.json

# View project metadata
cat storage/ledger/2026-02-11-feature-name/.meta.json
```

**Warning**: Never edit ledger files manually. Always let agents use MCP tools to ensure consistency.

---

## GUI Dashboard

A lightweight web dashboard for monitoring and managing projects tracked in the ledger.

**Start the GUI server:**
```sh
npm run gui
```
Then open [http://localhost:3420](http://localhost:3420) in your browser.

**Custom port or ledger directory:**
```sh
npx tsx gui/server.ts --port 4000 --ledger-dir /path/to/ledger
```

**Features:**
- View all projects and their current status
- **Project name column** — resolves the human-readable name from `package.json`, `composer.json`, or `pyproject.toml` in the project root; shows `—` when none is found
- **% Done column** — compact inline progress bar + percentage derived from `(done / total) × 100`; shows `—` for projects with no work packages
- **Slug display** — date prefix (`YYYY-MM-DD-`) stripped in the cell; full slug accessible via browser tooltip (hover the link)
- **Fulltext search** — text input in the filter bar instantly filters rows by slug or project name (combined with the status dropdown, case-insensitive)
- Drill down into project and work package details
- View project-level comments and incidents (sorted newest-first) on the Project Detail page
- **View archived plan** — **View full plan →** link on the Project Detail page (shown when a plan synopsis is available); renders as formatted HTML at `#/projects/:slug/plan`
- **View archived synthesis** — **View synthesis →** link on the Project Detail page (shown when `synthesis_generated === true`); renders the final synthesis report as formatted HTML at `#/projects/:slug/synthesis`
- Browse all project comments across every project on the **Insights page** (`#/insights`) — filter by type, priority, or project; auto-refreshes every 15 seconds
- Delete completed projects permanently
- Toggle auto-handoff and adjust the max handoff depth at runtime (no restart required)

> The GUI server is a **separate process** from the MCP server. Both can run simultaneously and share the same ledger directory. The MCP server monitors `gui-config.json` for configuration changes via `fs.watch()` — changes take effect immediately without restarting.

---

## Available Tools

The server exposes 20 MCP tools organized by category:

### Project Lifecycle
- `ledger_get_project_status` — Read project overview
- `ledger_initialize_project` — Create new ledger
- `ledger_list_projects` — List all tracked projects (optionally filter by status)
- `ledger_detect_project` — Auto-detect project from a workspace path
- `ledger_complete_synthesis` — Mark synthesis as generated; transitions project to COMPLETE if all WPs are done

### Work Packages
- `ledger_get_work_package` — Read full WP details
- `ledger_list_work_packages` — List/filter work packages
- `ledger_create_work_package` — Create new work package
- `ledger_claim_work_package` — Start working on a WP
- `ledger_update_work_package_status` — Update WP status

### Pipelines
- `ledger_start_pipeline` — Begin implementation/QA/review/docs phase
- `ledger_complete_pipeline` — Record results and artifacts
- `ledger_cancel_pipeline` — Cancel a stale IN_PROGRESS pipeline (marks it FAIL)
- `ledger_update_pipeline_progress` — Update summary of an IN_PROGRESS pipeline without completing it

### Observations
- `ledger_add_observation` — Add comment to pipeline
- `ledger_add_project_comment` — Add project-level comment

### Workflow Coordination
- `ledger_get_next_action` — Ask "what should I do next?" (includes stale pipeline detection)
- `ledger_get_next_actions` — Batch version returning all actionable WPs for an agent role
- `ledger_get_handoff_status` — Compute handoff status for current agent

### Help & Documentation
- `ledger_help` — Get usage documentation, examples, and required parameters for all tools (pass no args for overview, or `tool_name` for a specific tool)

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

### ✅ Agent Auto-Discovery

At startup the server scans the configured agents directory for `*.agent.md` files:
- Reads each file's front-matter to extract the agent role name
- Populates an in-process registry used by `ledger_get_handoff_status` to route automatic handoffs
- Controlled via `--agents-dir <path>` or platform-specific defaults (see [Setup](#setup))
- If discovery fails or the directory is missing, auto-handoff is silently disabled and all other tools continue to work normally

### ✅ Infinite-Loop Protection

`ledger_get_handoff_status` tracks how many consecutive automatic handoffs have been emitted:
- `auto_handoff_depth` is stored in the root index and incremented on every `auto_handoff` emission
- The ceiling is `MAX_HANDOFF_DEPTH = 10`; once reached, `auto_handoff` is omitted and the IDE falls back to manual routing
- Reaching project `COMPLETE` resets the counter to `0` for the next planning cycle
- The counter is server-managed — no agent needs to pass or track it

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

**Symptoms**: "Failed to acquire lock after 50 retries"

**Solutions**:
1. Another process may be holding the lock — wait and retry
2. If a process crashed, manually delete the `.lock` file inside `storage/ledger/{slug}/`
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

### npm Scripts

| Script | Description |
|---|---|
| `npm run build` | Compile TypeScript source to `dist/` |
| `npm run dev` | Run server with `tsx` (auto-reload) |
| `npm test` | Run all tests once |
| `npm run test:watch` | Run tests in watch mode |
| `npm run sync-version` | Sync version from `changelog.md` to `package.json` |
| `npm run check:roles` | Assert `KNOWN_ROLES` / `AGENT_ROLES` parity (see below) |

### Checking Role Parity

`scripts/sync-personas.js` maintains a hard-coded `KNOWN_ROLES` array that must stay in sync with `AGENT_ROLES` in `src/utils/constants.ts`. Run the parity check after adding or renaming any agent role:

```bash
# Build first (outputs to dist/)
npm run build

# Then check
npm run check:roles
```

`check:roles` computes the symmetric difference between the two arrays. A clean run prints:

```
[check-known-roles] OK: KNOWN_ROLES and AGENT_ROLES are in sync.
```

If the arrays diverge it exits 1 with a labelled diff:

```
[check-known-roles] FAIL: KNOWN_ROLES / AGENT_ROLES are out of sync.

  Missing from KNOWN_ROLES (present in AGENT_ROLES):
    - "NewRole"
  Extra in KNOWN_ROLES (not in AGENT_ROLES):
    - "OldRole"
```

The script lives at `scripts/check-known-roles.js` in the workspace root and has no npm dependencies beyond Node.js built-ins.

### Running Tests

```bash
npm test              # Run all tests once
npm run test:watch   # Run tests in watch mode
```

The test suite includes unit tests for all modules and **integration tests** for the auto-handoff chain. Integration tests use real `LedgerStore` instances against temp directories and a mock agents directory — no real VS Code installation or filesystem paths are required.

Key integration test file: `tests/integration/auto-handoff.test.ts` (23 tests covering the full PM → Developer → QA → Reviewer → Documentation → Synthesis chain, depth limit enforcement, rework cycles, and graceful degradation without an agent registry).

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

---

## TODO

- UI for the ledger
- Centralize the ledger files

- Review: 

Yes — there was a gap in my execution. Here's what happened:

My ledger_get_handoff_status returned an auto_handoff pointing to the Developer agent, which I correctly invoked.
The Developer completed WP-001 and returned a manual routing block (NEXT AGENT: QA) instead of triggering its own auto-handoff to QA.
At that point I should have re-called ledger_get_handoff_status (or directly invoked the QA subagent) based on the "NEXT AGENT: QA" signal — but I just relayed the block to you instead.
The missing instruction on my end: after a subagent returns with a NEXT AGENT signal, I should continue the chain rather than surfacing the manual block to the user. The Developer agent also bears partial responsibility for not calling ledger_get_handoff_status itself before returning.