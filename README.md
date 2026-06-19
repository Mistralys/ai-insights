# AI Insights

AI coding agents forget everything between chat sessions. AI Insights fixes that — it gives agents persistent memory, defined roles, and a repeatable pipeline so complex projects survive across sessions without losing context.

---

## What's Inside

### Agent Personas

**Are you here to make your own personas?** [Start Here](https://mistralys.github.io/ai-insights/)

Each persona is a carefully crafted prompt file that turns a general-purpose AI into a specialist — a code reviewer, a security auditor, a release engineer. Load one in your IDE (VS Code / Claude Code) and the agent knows its job, its boundaries, and how to hand off to the next stage. The system prioritizes robust persona reliability over complex, constantly changing toolsets.

The following persona suites are available:

| Suite | Description | Docs |
|-------|-------------|------|
| **Ledger** | Full 9-stage workflow (Planner → PM → Developer → QA → Security → Reviewer → Release → Docs → Synthesis) with persistent state via the MCP server | [personas/ledger/README.md](personas/ledger/README.md) |
| **Ledger Support** | Utility agents that extend the ledger workflow — PM sub-agents, ledger doctor, orchestrator runner, and more | [personas/ledger-support/README.md](personas/ledger-support/README.md) |
| **Standalone** | Drop-in agents with no dependencies — pick one and go | [personas/standalone/](personas/standalone/) |

### The Project Ledger

The reason agents can pick up where the last one left off. This [MCP server](https://modelcontextprotocol.io/) stores project state — work packages, progress, handoff notes — so every agent in the pipeline sees the full history. A built-in knowledge store captures insights across runs, giving your agents institutional memory that grows over time.

→ [mcp-server/README.md](mcp-server/README.md)

### The Orchestrator

Run the entire 9-stage pipeline from the command line — no IDE required. Built on **LangGraph** + **Deep Agents**, the orchestrator executes the same MCP-backed workflow headlessly. Useful for automation, CI integration, or when you want to kick off a pipeline and walk away.

→ [orchestrator/README.md](orchestrator/README.md)

---

## Requirements

- **Node.js** >= 18
- **Python 3.11+** (only for the orchestrator)

---

## 🚀 Quick Start

Everything runs through a single interactive menu:

```bash
./menu.sh          # macOS / Linux
menu.cmd           # Windows
```

On **first launch**, the menu walks you through setup automatically — installing dependencies, building the MCP server, syncing personas to your IDE, and registering everything globally. No manual steps required.

After that, the menu monitors your workspace for stale builds and configuration drift. Just open it — it keeps itself current.

→ [docs/references/menu-guide.md](docs/references/menu-guide.md) — full menu reference and direct commands

---

## 📚 Learn More

**Getting started:**

| Resource | Description |
|----------|-------------|
| [Project Overview](docs/references/project-overview.md) | Philosophy, workflow design, and architecture |
| [Ledger Workflow Guide](personas/ledger/README.md) | The 9-stage pipeline: setup, stages, best practices |
| [Visual Workflow Guide](docs/agents/references/ledger-workflow-visual-guide.md) | End-to-end diagrams: handoffs, sub-agents, knowledge flow |

**Going deeper:**

| Resource | Description |
|----------|-------------|
| [MCP Server](mcp-server/README.md) | Server architecture, tool reference, GUI, troubleshooting |
| [Orchestrator](orchestrator/README.md) | Headless runner: setup, configuration, CLI |
| [Developer Guide](docs/references/development.md) | Workspace layout, CI, scripts, changelog workflow |
| [Reference Docs Hub](docs/agents/references/README.md) | Workflow diagrams, CTX config, Deep Agents patterns |
| [Key Learnings](docs/history/key-learnings.md) | Lessons learned across the project |
| [Discussions](docs/discussions/) | Design notes and LLM conversation archive |
