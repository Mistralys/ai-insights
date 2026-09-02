# Project Manifest: Ledger Personas Build System

**Purpose:** Templated build system for generating persona files across the ledger, standalone, and ledger-support suites

---

## Overview

The **Ledger Personas Build System** is a Node.js-based template engine that assembles persona Markdown files from structured YAML metadata and Markdown content/partial templates, across three suites:

- **Ledger** (`ledger/`) — 9 personas for the multi-agent software development workflow backed by the [Project Ledger MCP Server](../../../../mcp-server/README.md)
- **Standalone** (`standalone/`) — special-purpose personas with no ledger dependency
- **Ledger-Support** (`ledger-support/`) — MCP-dependent utility sub-agents invoked as delegates from ledger personas

Each suite is built for three output targets: **VS Code** (`.agent.md`), **Claude Code** (plain `.md`), and **Deep Agents** (plain `.md`, consumed directly by the orchestrator).

Generated persona files are consumed in three ways:
- **Directly** — users copy-paste persona content into AI IDE chat sessions
- **Via sync** — `sync-personas.js` copies VS Code and Claude Code output to VS Code's User prompts directory (using `vs_file_name` frontmatter) and/or Claude Code's `~/.claude/agents/` directory (using `name` frontmatter)
- **Via the orchestrator** — the Deep Agents output is read directly off disk by `orchestrator/src/config.py`, with no sync step

---

## Manifest Sections

| Section | Description |
|---------|-------------|
| [Tech Stack & Patterns](tech-stack.md) | Runtime, dependencies, build tools, and architectural patterns |
| [Public API Surface](api-surface.md) | CLI interface, config shape, template syntax, metadata schema, and MCP tool allocation matrix |
| [Template Variables](variables.md) | Complete reference of all variables available in persona content templates |
| [Key Data Flows](data-flows.md) | Build pipeline (wrapper → library → plugin hooks → output), template resolution, and sync flows |
| [File Tree](file-tree.md) | Annotated directory structure — source templates, generated output, and build scripts |
| [Constraints & Conventions](constraints.md) | Core rules: source editing, naming, versioning, and safety guards |
| [Build System Constraints](constraints-build-system.md) | Template engine behavior, build flags, log conventions, and sync script rules |
| [Cross-System Constraints](constraints-cross-system.md) | Synchronization contracts with the MCP server, Agent Registry, and historical differences |
| [Curation Log](curation-log.md) | Standing decisions and the dated history of manifest curation passes |

---

## Quick Reference

**Build all suites and targets (default):**
```bash
node scripts/build-personas.js
```

> Suite and target selection is controlled by `personas/persona-build.config.js`, not by CLI flags. The wrapper always builds all three suites (`ledger`, `standalone`, `ledger-support`) for all three targets (`vscode`, `claude-code`, `deep-agents`).

**Check for stale output (CI-friendly):**
```bash
node scripts/build-personas.js --check
```

**Preview without writing:**
```bash
node scripts/build-personas.js --dry-run
```

**Validate generated output for unresolved markers (strict mode):**
```bash
node scripts/build-personas.js --strict
```

Passes exit 0 if all markers resolved; exits 1 with `[STRICT]` log line(s) on any unresolved `{{variable}}` or `{{> partial}}` markers. Use in CI pipelines or pre-commit hooks to gate on zero unresolved markers.

**Build + sync to both IDEs (VS Code + Claude Code):**
```bash
node scripts/sync-personas.js
```

**Build + sync to a specific IDE only:**
```bash
node scripts/sync-personas.js --target vscode
node scripts/sync-personas.js --target claude-code
```
