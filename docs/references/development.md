---
title: Development Guide
---

# Development Guide

## Workspace Directory Layout

The root `package.json` depends on `@mistralys/cli-menu` (currently `^1.1.0` from npm).

For **local development** of `cli-menu` alongside `ai-insights`, clone it as a sibling directory and switch the dependency to a `file:` path:

```
parent/
├── ai-insights/   ← this repository
└── cli-menu/      ← optional sibling for local dev
```

The preflight bootstrap script (`scripts/preflight-bootstrap.js`) handles sibling linking automatically when both repos are present.

## Pre-Commit Hook

```bash
node scripts/install-hooks.js
```

This enables a pre-commit guard that fails the commit if any generated persona file is stale (out of sync with its source template).

## Global CLI (Optional)

The root `package.json` declares a `bin` entry that maps the `ai-insights` command to `scripts/cli.js`. Running `npm link` from the repository root registers a global symlink, letting you invoke the CLI from any directory:

```bash
npm link          # register symlink (run once, from the ai-insights/ root)
ai-insights       # opens the interactive menu
ai-insights sync-personas
ai-insights doctor
ai-insights install-mcp --dry-run
```

This is equivalent to `node scripts/cli.js <command>` in every respect.
To remove the global symlink, run `npm unlink` from the `ai-insights/` root.

## CI — Automated Quality Gate

A GitHub Actions workflow (`.github/workflows/ci.yml`) runs on every push and pull request to `main`. It runs five independent jobs:

| Job | What it checks |
|-----|---------------|
| `mcp-server-tests` | MCP server Vitest suite (Node.js 20) |
| `orchestrator-tests` | Orchestrator pytest suite (Python 3.11) |
| `ruff` | Orchestrator source linting (`ruff check src/`) |
| `manifest-validation` | `shared/workflow-manifest.json` schema + semantic checks |
| `persona-build-check` | Detects stale generated persona output (`build-personas.js --check`) |

Each job fails independently. npm and pip dependencies are cached to reduce cold-start times. All GitHub Actions refs are pinned to SHA digests (with inline version-tag comments) for supply-chain hardening. No deployment, artifact publishing, or release steps are included.

## Shared Manifest

`shared/workflow-manifest.json` is the single source of truth for the workflow specification: all 9 agent roles, 6 pipeline types, status enums, and workflow constants. All sub-projects derive their constant definitions from this file. It is validated by `shared/workflow-manifest.schema.json`.

## Key Scripts (Advanced)

> **For most operations, prefer the CLI menu:** `./menu.sh` (macOS/Linux) or `menu.cmd` (Windows). The table below documents the underlying `node` commands for CI, scripting, and advanced use.

| Script | Menu Equivalent | Purpose |
|--------|----------------|---------|
| `node scripts/cli.js` | `./menu.sh` | Interactive command center — menu-driven or direct CLI |
| `node scripts/sync-personas.js` | `./menu.sh sync-personas` | Build + deploy personas; validate frontmatter |
| `node scripts/build-personas.js` | (part of setup/build) | Build personas only (no deploy) |
| `node scripts/build-personas.js --check` | — | Detect stale persona output (non-zero if stale) |
| `node scripts/check-known-roles.js` | — | Verify role parity between personas and MCP server |
| `node scripts/package-personas.js` | `./menu.sh package-personas` | Package standalone personas into distributable ZIPs |
| `node scripts/bundle-docs.js` | `./menu.sh bundle-docs` | Compile project docs into bundles (e.g. for NotebookLM) |
| `node scripts/cli.js ctx-generate` | `./menu.sh ctx-generate` | Generate context documentation via [CTX Generator](https://github.com/context-hub/generator) |
| `node scripts/cli.js doctor` | `./menu.sh doctor` | Run all health checks; exits 1 on any failure |
| `node scripts/cli.js install-mcp` | `./menu.sh install-mcp` | Register `central_pm` in VS Code user-level `mcp.json` via stable shim |
| `node scripts/run-gui.js` | `./menu.sh gui` | Launch the MCP server GUI dashboard |
| `node scripts/preflight-orchestrator.js` | `./menu.sh preflight` | Pre-flight readiness checks (venv, `.env`, dist, conflicts) |
| `node scripts/run-orchestrator.js` | `./menu.sh orchestrator` | Launch the orchestrator (rebuilds MCP server if stale) |
| `node scripts/kill-orchestrator.js` | `./menu.sh kill-orchestrator` | Detect and terminate stale orchestrator processes |
| `node scripts/read-log.js` | `./menu.sh read-log` | Structured JSONL log reader — query, filter, and summarize orchestrator run logs |

## Changelog Workflow

This workspace uses a **hub-and-spoke changelog model**: each sub-project (`mcp-server/`, `orchestrator/`, `personas/`) has its own `changelog.md`, and the root `changelog.md` summarizes the highlights into versioned, Git-tagged releases. See the Changelog Convention section in [AGENTS.md](../AGENTS.md) for the full rules.

When preparing a release, run the [changelog prompt](../.github/prompts/changelog.prompt.md) — it invokes the **Changelog Curator** agent to generate entries from Git history and update all four changelog files.
