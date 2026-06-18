# AI Insights

A toolkit for structured, multi-agent AI development workflows. It gives AI coding agents a shared memory, a defined set of roles, and a headless execution path — so complex projects can be tackled across multiple chat sessions without losing context.

---

## 🧩 What's Inside

### Agent Personas

Pre-built prompt files that assign a specific role to an AI agent in your IDE (VS Code / Claude Code). Two suites are available:

| Suite | Description | Docs |
|-------|-------------|------|
| **Ledger-Enabled** | 9-stage workflow (Planner → PM → Developer → QA → Security Auditor → Reviewer → Release Engineer → Docs → Synthesis) backed by the MCP server for persistent state | [personas/ledger/README.md](personas/ledger/README.md) |
| **Ledger Support** | Utility agents for the ledger workflow (PM sub-agents, ledger doctor, orchestrator runner, etc.) — MCP-dependent | [personas/ledger-support/README.md](personas/ledger-support/README.md) |
| **Standalone** | Single-purpose agents with no MCP dependency — drop in and use | [personas/standalone/](personas/standalone/) |

### Project Ledger MCP Server

An [MCP](https://modelcontextprotocol.io/) server that gives agents structured, persistent project state. It exposes tools for managing work packages, tracking progress, and coordinating handoffs — with atomic writes and schema validation to prevent data corruption. A built-in knowledge store lets agents record and search project insights across runs, building institutional memory over time.

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

On every subsequent launch, the menu checks for stale builds and configuration drift and tells you exactly what (if anything) needs attention. Just open the menu — it keeps itself current.

→ [docs/references/menu-guide.md](docs/references/menu-guide.md) — full menu reference and direct command list

---

## 📚 Learn More

| Resource | Description |
|----------|-------------|
| [docs/references/menu-guide.md](docs/references/menu-guide.md) | Menu reference: all items, direct commands, and health dashboard |
| [docs/references/project-overview.md](docs/references/project-overview.md) | High-level project overview: philosophy, workflow, architecture, and open questions |
| [docs/references/development.md](docs/references/development.md) | Developer guide: workspace layout, CI, scripts, changelog workflow |
| [docs/agents/references/README.md](docs/agents/references/README.md) | Reference docs hub for workflow diagrams, CTX configuration, and Deep Agents subagent patterns |
| [personas/ledger/README.md](personas/ledger/README.md) | Full ledger workflow guide (9 stages, MCP setup, best practices) |
| [docs/agents/references/ledger-workflow-visual-guide.md](docs/agents/references/ledger-workflow-visual-guide.md) | Visual reference for the ledger workflow: end-to-end ASCII diagrams, handoffs, sub-agents, and knowledge flow |
| [mcp-server/README.md](mcp-server/README.md) | MCP server architecture, tools reference, GUI, troubleshooting |
| [orchestrator/README.md](orchestrator/README.md) | Orchestrator setup, configuration, CLI reference, troubleshooting |
| [docs/discussions/](docs/discussions/) | LLM discussion archive and design notes |
| [docs/history/key-learnings.md](docs/history/key-learnings.md) | Lessons learned across the project |
