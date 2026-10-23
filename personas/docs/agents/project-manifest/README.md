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
- **Via sync** — `sync-personas.js` copies VS Code and Claude Code output to VS Code agents directory (`~/.copilot/agents/`) (using `vs_file_name` frontmatter) and/or Claude Code's `~/.claude/agents/` directory (using `name` frontmatter)
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
| [Generated Artefacts](../../../../docs/agents/project-manifest/generated-artefacts.md) | Hub document, shared with the whole repository: tracked files a build command writes (name mapping, CTX output, overview and audit status), their generators, and when discarding each is safe |
| [Curation Log](curation-log.md) | Standing decisions and the dated history of manifest curation passes |

---

## Quick Reference

**Build all suites and targets (default):**
```bash
node scripts/build-personas.js
```

> Suite and target selection is controlled by `personas/persona-build.config.js`, not by CLI flags. The wrapper always builds all three suites (`ledger`, `standalone`, `ledger-support`) for all three targets (`vscode`, `claude-code`, `deep-agents`).

**Validate sources without writing (CI-friendly; renders in memory, fails on validation errors, does not compare against files on disk):**
```bash
node scripts/build-personas.js --check
```

**Same as `--check` (alias):**
```bash
node scripts/build-personas.js --dry-run
```

**Also fail on library warnings (strict mode):**
```bash
node scripts/build-personas.js --strict
```

Exits 1 on the library's warning-severity validation results as well as its errors. Unresolved `{{variable}}` or `{{> partial}}` markers only print a `[WARN]` line and never fail the build, even under `--strict`; the wrapper's own warn-severity checks stay non-fatal too. Add `--check` to run it without writing.

**Build + sync to both IDEs (VS Code + Claude Code):**
```bash
node scripts/sync-personas.js
```

**Build everything + sync to a specific IDE only (`--target` selects deploy steps, not what is built; `claude-code` also syncs `.claude/skills/`):**
```bash
node scripts/sync-personas.js --target vscode
node scripts/sync-personas.js --target claude-code
```
