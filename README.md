# AI Insights

A toolkit for structured, multi-agent AI development workflows. It gives AI coding agents a shared memory, a defined set of roles, and a headless execution path — so complex projects can be tackled across multiple chat sessions without losing context.

---

## 🧩 Tools

### Agent Personas

Pre-built prompt files that assign a specific role to an AI agent in your IDE (VS Code / Claude Code). Two suites are available:

| Suite | Description | Docs |
|-------|-------------|------|
| **Ledger-Enabled** | 7-stage workflow (Planner → PM → Developer → QA → Reviewer → Docs → Synthesis) backed by the MCP server for persistent state | [personas/ledger/README.md](personas/ledger/README.md) |
| **Standalone** | Single-purpose agents with no MCP dependency — drop in and use | [personas/standalone/](personas/standalone/) |

### Project Ledger MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io/) server that gives agents structured, persistent project state. It exposes 20 tools for managing work packages, tracking progress, and coordinating handoffs — with atomic writes and schema validation to prevent data corruption.

→ [mcp-server/README.md](mcp-server/README.md)

### Orchestrator

A headless, IDE-free alternative to the ledger workflow. Built on **LangGraph** + **Deep Agents**, it runs the same MCP-server-backed pipeline entirely from the command line — useful for automation, CI pipelines, or working outside an AI IDE.

→ [orchestrator/README.md](orchestrator/README.md)

---

## 🚀 Quick Start

### 1 — Deploy Personas to Your IDE

```bash
# Install dependencies (first time only)
cd personas && npm install && cd ..

# Build and deploy to both VS Code and Claude Code
node scripts/sync-personas.js
```

A clean run prints:
```
✓ All 7 VS Code persona file(s) passed frontmatter validation
✓ All 7 Claude Code persona file(s) passed frontmatter validation
```

> Deploy to only one target: `--target vscode` or `--target claude-code`.
> Preview without copying: `--dry-run`.
> Full options: see [personas/ledger/README.md](personas/ledger/README.md).

---

### 2 — Set Up the MCP Server (ledger workflow)

```bash
cd mcp-server
npm install
npm run build
```

Then add the server to your IDE's `.mcp.json` (see [mcp-server/README.md](mcp-server/README.md) for config).

Launch the GUI dashboard at any time:

```bash
node scripts/run-gui.js
```

---

### 3 — Run the Orchestrator (headless)

```bash
# One-shot setup: creates venv, installs deps, scaffolds .env
node scripts/setup-orchestrator.js

# Edit orchestrator/.env with your API key, then run a plan:
node scripts/run-orchestrator.js path/to/plan.md
```

`run-orchestrator.js` rebuilds a stale MCP server automatically before launching.
Full setup and options: [orchestrator/README.md](orchestrator/README.md).

---

## 🛠 Development

### Install the pre-commit hook

```bash
node scripts/install-hooks.js
```

This enables a pre-commit guard that fails the commit if any generated persona file is stale (out of sync with its source template).

### Key scripts

| Script | Purpose |
|--------|---------|
| `node scripts/sync-personas.js` | Build + deploy personas; validate frontmatter |
| `node scripts/build-personas.js` | Build personas only (no deploy) |
| `node scripts/build-personas.js --check` | Detect stale persona output (non-zero if stale) |
| `node scripts/check-known-roles.js` | Verify role parity between personas and MCP server |
| `node scripts/package-personas.js` | Package standalone personas into distributable ZIPs |
| `node scripts/bundle-docs.js` | Compile project docs into bundles (e.g. for NotebookLM) |
| `node scripts/run-gui.js` | Launch the MCP server GUI dashboard |
| `node scripts/run-orchestrator.js` | Launch the orchestrator (rebuilds MCP server if stale) |

---

## 📚 Learn More

| Resource | Description |
|----------|-------------|
| [personas/ledger/README.md](personas/ledger/README.md) | Full ledger workflow guide (7 stages, MCP setup, best practices) |
| [mcp-server/README.md](mcp-server/README.md) | MCP server architecture, tools reference, GUI, development |
| [orchestrator/README.md](orchestrator/README.md) | Orchestrator setup, configuration, CLI reference, troubleshooting |
| [discussions/](discussions/) | LLM discussion archive and design notes |
| [history/key-learnings.md](history/key-learnings.md) | Lessons learned across the project |
| [AGENTS.md](AGENTS.md) | Agent operating instructions (for AI agents entering this workspace) |
