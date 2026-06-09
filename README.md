# AI Insights

A toolkit for structured, multi-agent AI development workflows. It gives AI coding agents a shared memory, a defined set of roles, and a headless execution path — so complex projects can be tackled across multiple chat sessions without losing context.

---

## 🧩 Tools

### Agent Personas

Pre-built prompt files that assign a specific role to an AI agent in your IDE (VS Code / Claude Code). Two suites are available:

| Suite | Description | Docs |
|-------|-------------|------|
| **Ledger-Enabled** | 9-stage workflow (Planner → PM → Developer → QA → Security Auditor → Reviewer → Release Engineer → Docs → Synthesis) backed by the MCP server for persistent state | [personas/ledger/README.md](personas/ledger/README.md) |
| **Standalone** | Single-purpose agents with no MCP dependency — drop in and use | [personas/standalone/](personas/standalone/) |

### Project Ledger MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io/) server that gives agents structured, persistent project state. It exposes 25 tools for managing work packages, tracking progress, and coordinating handoffs — with atomic writes and schema validation to prevent data corruption.

→ [mcp-server/README.md](mcp-server/README.md)

### Orchestrator

A headless, IDE-free alternative to the ledger workflow. Built on **LangGraph** + **Deep Agents**, it runs the same MCP-server-backed pipeline entirely from the command line — useful for automation, CI pipelines, or working outside an AI IDE.

→ [orchestrator/README.md](orchestrator/README.md)

---

## Requirements

- **Node.js** >= 18
- **Python 3.11+** (only for the orchestrator component)

## 🚀 Quick Start

```bash
node scripts/cli.js
```

This opens an interactive menu where you can set up the workspace, sync personas, launch the GUI, run the orchestrator, and more — all from one place.

Or run the full setup non-interactively:

```bash
node scripts/cli.js setup --all
```

Common commands:

```bash
node scripts/cli.js sync-personas          # build + deploy personas to IDE
node scripts/cli.js gui                    # launch MCP GUI dashboard
node scripts/cli.js orchestrator plan.md  # run orchestrator pipeline
node scripts/cli.js doctor                 # run all health checks
node scripts/cli.js help                  # list all commands
```

---

## 📚 Learn More

| Resource | Description |
|----------|-------------|
| [docs/development.md](docs/development.md) | Workspace layout, CI, pre-commit hooks, key scripts, changelog workflow |
| [personas/ledger/README.md](personas/ledger/README.md) | Full ledger workflow guide (9 stages, MCP setup, best practices) |
| [mcp-server/README.md](mcp-server/README.md) | MCP server architecture, tools reference, GUI, development |
| [orchestrator/README.md](orchestrator/README.md) | Orchestrator setup, configuration, CLI reference, troubleshooting |
| [discussions/](discussions/) | LLM discussion archive and design notes |
| [history/key-learnings.md](history/key-learnings.md) | Lessons learned across the project |
| [AGENTS.md](AGENTS.md) | Agent operating instructions (for AI agents entering this workspace) |
| `.context/` | Auto-generated codebase snapshots via [CTX Generator](https://github.com/context-hub/generator) — run `node scripts/cli.js ctx-generate` |
