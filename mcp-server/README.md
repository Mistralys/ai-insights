# Project Ledger MCP Server

**A Model Context Protocol server that keeps AI coding agents in sync across sessions.**

---

## What Is This?

The Project Ledger MCP Server manages persistent project state for multi-agent AI workflows. It acts as a shared "source of truth" so agents can track progress, coordinate handoffs, and preserve context — even when you start a new chat session.

### The Problem It Solves

- **Context loss** — each new chat session starts from scratch
- **Duplicate work** — agents redo completed tasks or miss dependencies
- **Data corruption** — manual JSON editing causes schema violations
- **Race conditions** — multiple agents editing the same files simultaneously

### How It Helps

- **Persists state** as validated JSON on disk across sessions
- **Prevents corruption** with atomic writes and file locking
- **Coordinates agents** by telling each one what to do next
- **Tracks knowledge** across projects for future planning

---

## Quick Start

From the workspace root, use the interactive menu:

```bash
./menu.sh          # macOS / Linux
menu.cmd           # Windows
```

On first launch the menu auto-detects missing components and runs the setup wizard — this installs dependencies, builds the MCP server, and registers it in your IDE. **No manual `npm install` or `npm run build` needed.**

The menu also displays a live health status showing whether the MCP server dist is current. If source files have changed, the orchestrator launcher will rebuild automatically before starting a run.

### Registering the Server in Your IDE

The first-time setup wizard handles this automatically. To re-register later:

```bash
./menu.sh install-mcp              # register in VS Code + Claude Code
./menu.sh install-mcp --dry-run    # preview without writing
```

This installs a stable shim at `~/.ai-insights/bin/launch-server.js` and registers the `central_pm` server in your IDE's user-level MCP configuration. No manual path editing required.

### Launching the GUI Dashboard

```bash
./menu.sh gui
```

Opens [http://localhost:3420](http://localhost:3420) — a web dashboard for monitoring projects, viewing work packages, browsing orchestrator dialogues, managing the knowledge base, and **launching orchestrator runs** directly from the browser.

---

## Features

- **28 MCP tools** for complete project lifecycle management
- **Atomic operations** — write-to-temp-then-rename prevents partial writes
- **File locking** — distributed locks with stale detection and retry logic
- **Schema validation** — all data validated with Zod on every read/write
- **Auto-handoff** — agents are automatically routed to the next stage
- **Infinite-loop protection** — depth counter prevents runaway handoff chains
- **Knowledge base** — persistent cross-project insights with full-text search
- **Strategic vision** — repository-level planning with three-horizon goals
- **Self-healing counters** — auto-corrects counter drift on status queries
- **GUI dashboard** — web UI for monitoring, search, filtering, dark mode

---

## Setup

### Prerequisites

- **Node.js** >= 18 (ESM-compatible)
- **npm** or compatible package manager

### Installation

The CLI menu handles installation automatically (see Quick Start above). For standalone or CI use:

```bash
cd mcp-server
npm install
npm run build
```

### Manual IDE Configuration (Advanced)

If you prefer to configure your IDE manually rather than using `./menu.sh install-mcp`:

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

**Optional: Custom agents directory** — to enable auto-handoff, pass `--agents-dir`:

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

By default the server auto-detects the VS Code User prompts folder for the current platform.

---

## Available Tools

The server exposes **28 MCP tools** organized by category:

| Category | Tools |
|----------|-------|
| **Project Lifecycle** | `ledger_get_project_status`, `ledger_initialize_project`, `ledger_list_projects`, `ledger_detect_project`, `ledger_complete_synthesis` |
| **Repository Context** | `ledger_get_repository_context` |
| **Work Packages** | `ledger_get_work_package`, `ledger_list_work_packages`, `ledger_create_work_package`, `ledger_claim_work_package`, `ledger_update_work_package_status`, `ledger_reset_rework_count`, `ledger_reopen_cancelled_wp`, `ledger_update_acceptance_criteria` |
| **Pipelines** | `ledger_begin_work`, `ledger_start_pipeline`, `ledger_complete_pipeline`, `ledger_cancel_pipeline`, `ledger_update_pipeline_progress` |
| **Knowledge** | `ledger_add_insight`, `ledger_search_insights`, `ledger_list_insights`, `ledger_update_insight` |
| **Observations** | `ledger_add_observation`, `ledger_add_project_comment` |
| **Workflow** | `ledger_get_next_action`, `ledger_get_handoff_status` |
| **Help** | `ledger_help` |

For detailed API signatures and parameters, see the [API Surface](docs/agents/project-manifest/api-surface.md).

---

## Troubleshooting

### "MCP server unavailable"

1. Verify `.mcp.json` exists and points to the correct path
2. Ensure dependencies are installed: `cd mcp-server && npm install`
3. Restart your AI IDE to reload MCP configuration

### MCP Tool Call Fails

1. Check that `project_path` arguments are absolute paths
2. Verify ledger files haven't been manually edited or corrupted
3. Look for schema validation errors in the error message

### Lock Acquisition Timeout

1. Another process may be holding the lock — wait and retry
2. If a process crashed, delete the `.lock` file inside `storage/ledger/{slug}/`
3. Use `./menu.sh kill-orchestrator` to clean up stale processes

---

## Development

### Running Tests

```bash
cd mcp-server
npm test              # run all tests once
npm run test:watch    # run tests in watch mode
```

### Building

```bash
npm run build         # compile TypeScript to dist/
npm run dev           # run server with tsx (auto-reload)
```

### Versioning

This project uses `changelog.md` as the source of truth. After updating the changelog:

```bash
npm run sync-version  # extracts version from changelog → package.json
```

### npm Scripts

| Script | Description |
|--------|-------------|
| `npm run build` | Compile TypeScript source to `dist/` |
| `npm run dev` | Run server with `tsx` (auto-reload) |
| `npm test` | Run all tests once |
| `npm run test:watch` | Run tests in watch mode |
| `npm run sync-version` | Sync version from `changelog.md` to `package.json` |
| `npm run gui` | Start the GUI server (advanced — prefer `./menu.sh gui` from root) |

---

## Technical Documentation

For developers who want to understand the internals:

| Resource | Description |
|----------|-------------|
| [Project Manifest](docs/agents/project-manifest/) | Comprehensive technical documentation hub |
| [Tech Stack & Patterns](docs/agents/project-manifest/tech-stack.md) | Runtime, frameworks, architectural patterns |
| [Public API Surface](docs/agents/project-manifest/api-surface.md) | All tool signatures and parameters |
| [Data Flows](docs/agents/project-manifest/data-flows.md) | How data moves through the system |
| [Constraints](docs/agents/project-manifest/constraints.md) | Architectural invariants and conventions |
| [GUI internals](docs/agents/project-manifest/api-surface.md) | GUI backend modules, frontend views, API handlers |

---

## Related

- [Ledger-Enabled Agent Workflow](../personas/ledger/) — How to use this server with AI agents
- [Agent Personas](../personas/ledger/) — The 9 agents that use this server
- [Orchestrator](../orchestrator/) — Headless pipeline executor
