# AI Insights

A toolkit for structured, multi-agent AI development workflows. It gives AI coding agents a shared memory, a defined set of roles, and a headless execution path — so complex projects can be tackled across multiple chat sessions without losing context.

---

## 🧩 What's Inside

### Agent Personas

Pre-built prompt files that assign a specific role to an AI agent in your IDE (VS Code / Claude Code). Two suites are available:

| Suite | Description | Docs |
|-------|-------------|------|
| **Ledger-Enabled** | 9-stage workflow (Planner → PM → Developer → QA → Security Auditor → Reviewer → Release Engineer → Docs → Synthesis) backed by the MCP server for persistent state | [personas/ledger/README.md](personas/ledger/README.md) |
| **Standalone** | Single-purpose agents with no MCP dependency — drop in and use | [personas/standalone/](personas/standalone/) |

### Project Ledger MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io/) server that gives agents structured, persistent project state. It exposes tools for managing work packages, tracking progress, and coordinating handoffs — with atomic writes and schema validation to prevent data corruption.

→ [mcp-server/README.md](mcp-server/README.md)

### Orchestrator

A headless, IDE-free alternative to the ledger workflow. Built on **LangGraph** + **Deep Agents**, it runs the same MCP-server-backed pipeline entirely from the command line — useful for automation, CI pipelines, or working outside an AI IDE.

→ [orchestrator/README.md](orchestrator/README.md)

---

## Requirements

- **Node.js** >= 18
- **Python 3.11+** (only for the orchestrator component)

---

## 🚀 Quick Start

Everything is driven through a single interactive menu:

```bash
./menu.sh          # macOS / Linux
menu.cmd           # Windows
```

On **first launch**, the menu detects that nothing is configured yet and automatically enters the setup wizard — installing all dependencies, building the MCP server, syncing personas to your IDE, and registering the MCP server globally. No manual `npm install` or `npm run build` required.

Every time the menu opens, it displays a **live health dashboard** showing whether the MCP server dist is built and up to date, the orchestrator venv exists, git hooks are installed, and sibling libraries are compiled. If anything is stale, the status line tells you exactly what to fix — or you can re-run setup to repair it.

When you launch an orchestrator run, the menu **automatically rebuilds** the MCP server if its source has changed since the last build. You never need to remember to rebuild manually.

### What You Can Do

| Menu Item | What It Does |
|-----------|-------------|
| **First-time setup** | Installs everything: MCP server, personas, orchestrator venv, global MCP registration, git hooks |
| **Sync personas** | Build + deploy persona files to your IDE |
| **Install MCP (Global)** | Register the MCP server in VS Code / Claude Code user config |
| **Launch GUI** | Open the MCP dashboard — monitor projects, start orchestrator runs, browse dialogues |
| **Pre-flight checks** | Verify orchestrator readiness (venv, API keys, dist freshness) |
| **Doctor** | Full environment health check across all tiers |
| **Build & Maintain** | Sync versions, build personas, generate context docs |

### Direct Commands (Non-Interactive)

You can also invoke any menu action directly without entering the interactive mode:

```bash
./menu.sh sync-personas          # build + deploy personas to IDE
./menu.sh gui                    # launch MCP GUI dashboard
./menu.sh orchestrator plan.md   # run orchestrator pipeline
./menu.sh doctor                 # run all health checks
./menu.sh help                   # list all available commands
```

---

## 📚 Learn More

| Resource | Description |
|----------|-------------|
| [docs/references/project-overview.md](docs/references/project-overview.md) | High-level project overview: philosophy, workflow, architecture, and open questions |
| [docs/references/development.md](docs/references/development.md) | Developer guide: workspace layout, CI, scripts, changelog workflow |
| [docs/agents/references/README.md](docs/agents/references/README.md) | Reference docs hub for workflow diagrams, CTX configuration, and Deep Agents subagent patterns |
| [personas/ledger/README.md](personas/ledger/README.md) | Full ledger workflow guide (9 stages, MCP setup, best practices) |
| [docs/agents/references/ledger-workflow-visual-guide.md](docs/agents/references/ledger-workflow-visual-guide.md) | Visual reference for the ledger workflow: end-to-end ASCII diagrams, handoffs, sub-agents, and knowledge flow |
| [mcp-server/README.md](mcp-server/README.md) | MCP server architecture, tools reference, GUI, troubleshooting |
| [orchestrator/README.md](orchestrator/README.md) | Orchestrator setup, configuration, CLI reference, troubleshooting |
| [discussions/](discussions/) | LLM discussion archive and design notes |
| [history/key-learnings.md](history/key-learnings.md) | Lessons learned across the project |
