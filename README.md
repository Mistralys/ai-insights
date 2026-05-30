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

A [Model Context Protocol](https://modelcontextprotocol.io/) server that gives agents structured, persistent project state. It exposes 20 tools for managing work packages, tracking progress, and coordinating handoffs — with atomic writes and schema validation to prevent data corruption.

→ [mcp-server/README.md](mcp-server/README.md)

### Orchestrator

A headless, IDE-free alternative to the ledger workflow. Built on **LangGraph** + **Deep Agents**, it runs the same MCP-server-backed pipeline entirely from the command line — useful for automation, CI pipelines, or working outside an AI IDE.

→ [orchestrator/README.md](orchestrator/README.md)

---

## 🚀 Quick Start

```bash
node scripts/cli.js
```

This opens an interactive menu where you can set up the workspace, sync personas, launch the GUI, run the orchestrator, and more — all from one place.

Or run the full setup non-interactively:

```bash
node scripts/cli.js setup --all
```

You can also run any task directly:

```bash
node scripts/cli.js sync-personas          # build + deploy personas to IDE
node scripts/cli.js gui                    # launch MCP GUI dashboard
node scripts/cli.js orchestrator plan.md  # run orchestrator pipeline
node scripts/cli.js ctx-generate          # generate context documentation
node scripts/cli.js check-versions        # verify changelog vs manifest versions
node scripts/cli.js doctor                 # run all health checks; exits 1 on any failure
node scripts/cli.js install-mcp            # register central_pm in VS Code user-level MCP config
node scripts/cli.js install-mcp --dry-run  # preview MCP config changes without writing
node scripts/cli.js read-log               # tail and query orchestrator logs
node scripts/cli.js kill-orchestrator      # terminate stale orchestrator processes
node scripts/cli.js kill-orchestrator --depth 5  # scan only 5 log files for lock cleanup
node scripts/cli.js help                  # list all commands, grouped by category
```

> Commands are grouped in the help output by category: **Setup & Configuration** (includes `install-mcp`), **Validation & Utilities** (includes `doctor`, `check-versions`), **Personas**, **MCP Server**, and **Orchestrator**. `read-log` and `kill-orchestrator` are available via direct dispatch but are not listed in the interactive help.

> **Prerequisites:** Node.js >= 18. Python 3.11+ is only required for the orchestrator component. The `cli-menu` repository must be cloned as a sibling directory — see [Workspace directory layout](#workspace-directory-layout).

Full setup and options for each sub-project:
- [personas/ledger/README.md](personas/ledger/README.md) — Persona workflow guide
- [mcp-server/README.md](mcp-server/README.md) — MCP server architecture and GUI
- [orchestrator/README.md](orchestrator/README.md) — Orchestrator setup, CLI reference

---

## 🛠 Development

### Workspace directory layout

The root `package.json` references `@mistralys/cli-menu` via a local `file:` path:

```json
"@mistralys/cli-menu": "file:../cli-menu"
```

This requires the `cli-menu` repository to be cloned as a **sibling directory** alongside `ai-insights/`:

```
parent/
├── ai-insights/   ← this repository
└── cli-menu/      ← required sibling
```

Running `npm install` inside `ai-insights/` will fail if `../cli-menu` does not exist. Clone or place the repository at that path before running any install or build steps.

> **After `@mistralys/cli-menu` is published to npm:** update the dependency in
> `package.json` from `"file:../cli-menu"` to `"^0.1.0"`, then run `npm install`.
> Once updated, the sibling `cli-menu/` directory is no longer required.

### Install the pre-commit hook

```bash
node scripts/install-hooks.js
```

This enables a pre-commit guard that fails the commit if any generated persona file is stale (out of sync with its source template).

### Use the `ai-insights` CLI globally (optional)

The root `package.json` declares a `bin` entry that maps the `ai-insights` command to
`scripts/cli.js`. Running `npm link` from the repository root registers a global symlink,
letting you invoke the CLI from any directory without specifying the full path:

```bash
npm link          # register symlink (run once, from the ai-insights/ root)
ai-insights       # opens the interactive menu
ai-insights sync-personas
ai-insights doctor
ai-insights install-mcp --dry-run
```

This is equivalent to `node scripts/cli.js <command>` in every respect.
To remove the global symlink, run `npm unlink` from the `ai-insights/` root.

### CI — Automated Quality Gate

A GitHub Actions workflow (`.github/workflows/ci.yml`) runs on every push and pull request to `main`. It runs five independent jobs:

| Job | What it checks |
|-----|---------------|
| `mcp-server-tests` | MCP server Vitest suite (Node.js 20) |
| `orchestrator-tests` | Orchestrator pytest suite (Python 3.11) |
| `ruff` | Orchestrator source linting (`ruff check src/`) |
| `manifest-validation` | `shared/workflow-manifest.json` schema + semantic checks |
| `persona-build-check` | Detects stale generated persona output (`build-personas.js --check`) |

Each job fails independently. npm and pip dependencies are cached to reduce cold-start times. All GitHub Actions refs are pinned to SHA digests (with inline version-tag comments) for supply-chain hardening. No deployment, artifact publishing, or release steps are included.

### Shared manifest

`shared/workflow-manifest.json` is the single source of truth for the workflow specification: all 9 agent roles, 6 pipeline types, status enums, and workflow constants. All sub-projects derive their constant definitions from this file. It is validated by `shared/workflow-manifest.schema.json`.

### Key scripts

| Script | Purpose |
|--------|---------|  
| `node scripts/cli.js` | **Interactive command center** — menu-driven or direct CLI for all workspace operations |
| `node scripts/sync-personas.js` | Build + deploy personas; validate frontmatter |
| `node scripts/build-personas.js` | Build personas only (no deploy) |
| `node scripts/build-personas.js --check` | Detect stale persona output (non-zero if stale) |
| `node scripts/check-known-roles.js` | Verify role parity between personas and MCP server |
| `node scripts/package-personas.js` | Package standalone personas into distributable ZIPs |
| `node scripts/bundle-docs.js` | Compile project docs into bundles (e.g. for NotebookLM) |
| `node scripts/cli.js ctx-generate` | Generate context documentation via [CTX Generator](https://github.com/context-hub/generator) |
| `node scripts/cli.js doctor` | Run all 9 health checks (all tiers including async); exits 1 on any failure; fix hints shown per failing check |
| `node scripts/cli.js install-mcp` | Register `central_pm` in VS Code user-level `mcp.json` via stable shim; `--dry-run` previews changes without writing |
| `node scripts/run-gui.js` | Launch the MCP server GUI dashboard |
| `node scripts/preflight-orchestrator.js` | Pre-flight readiness checks (venv, `.env`, dist, conflicts) |
| `node scripts/run-orchestrator.js` | Launch the orchestrator (rebuilds MCP server if stale) |
| `node scripts/kill-orchestrator.js` | Detect and terminate stale orchestrator processes; cleans up `.orchestrator.lock` files |
| `node scripts/read-log.js` | Structured JSONL log reader — query, filter, and summarize orchestrator run logs |

---

## 📝 Changelog Workflow

This workspace uses a **hub-and-spoke changelog model**: each sub-project (`mcp-server/`, `orchestrator/`, `personas/`) has its own `changelog.md`, and the root `changelog.md` summarizes the highlights into versioned, Git-tagged releases. See the Changelog Convention section in [AGENTS.md](AGENTS.md) for the full rules.

When preparing a release, run the [changelog prompt](.github/prompts/changelog.prompt.md) — it invokes the **Changelog Curator** agent to generate entries from Git history and update all four changelog files.

---

## 📚 Learn More

| Resource | Description |
|----------|-------------|
| [personas/ledger/README.md](personas/ledger/README.md) | Full ledger workflow guide (9 stages, MCP setup, best practices) |
| [mcp-server/README.md](mcp-server/README.md) | MCP server architecture, tools reference, GUI, development |
| [orchestrator/README.md](orchestrator/README.md) | Orchestrator setup, configuration, CLI reference, troubleshooting |
| [discussions/](discussions/) | LLM discussion archive and design notes |
| [history/key-learnings.md](history/key-learnings.md) | Lessons learned across the project |
| [AGENTS.md](AGENTS.md) | Agent operating instructions (for AI agents entering this workspace) |
| `.context/` | Auto-generated codebase snapshots via [CTX Generator](https://github.com/context-hub/generator) — run `node scripts/cli.js ctx-generate` |
