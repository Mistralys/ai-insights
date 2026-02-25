# Project Manifest: Ledger Personas Build System

**Version:** 1.1.0  
**Last Updated:** 2026-02-23  
**Purpose:** Templated build system for generating the 7 ledger-enabled AI agent persona files

---

## Overview

The **Ledger Personas Build System** is a Node.js-based template engine that assembles the 7 ledger persona Markdown files from structured YAML metadata and Markdown content/partial templates. The generated personas define the behaviour of AI agents in a multi-agent software development workflow backed by the [Project Ledger MCP Server](../../../../mcp-server/README.md).

Generated persona files are consumed in two ways:
- **Directly** — users copy-paste persona content into AI IDE chat sessions
- **Via sync** — `sync-personas.js` copies generated files to VS Code's User prompts directory (using `vs_file_name` frontmatter) and/or Claude Code's `~/.claude/agents/` directory (using `name` frontmatter)

---

## Manifest Sections

| Section | Description |
|---------|-------------|
| [Tech Stack & Patterns](tech-stack.md) | Runtime, dependencies, build tools, and architectural patterns |
| [File Tree](file-tree.md) | Visual directory structure with annotations |
| [Public API Surface](api-surface.md) | Build script functions, template syntax, and metadata schema |
| [Key Data Flows](data-flows.md) | Build pipeline, template resolution, and sync flows |
| [Constraints & Conventions](constraints.md) | Established rules, conventions, and gotchas |

---

## Quick Reference

**Build ledger suite (default — backward compat):**
```bash
node scripts/build-personas.js
```

**Build a specific suite:**
```bash
node scripts/build-personas.js --suite standalone
```

**Build multiple suites (comma-separated or shorthand):**
```bash
node scripts/build-personas.js --suite ledger,standalone
node scripts/build-personas.js --suite all       # ledger + standalone
```

**Build for a specific target only:**
```bash
node scripts/build-personas.js --target vscode
node scripts/build-personas.js --target claude-code
```

**Flags can be combined:**
```bash
node scripts/build-personas.js --suite standalone --target vscode
```

**Check for stale output (CI-friendly):**
```bash
node scripts/build-personas.js --check
node scripts/build-personas.js --suite all --check
```

**Preview without writing:**
```bash
node scripts/build-personas.js --dry-run
```

**Validate generated output for unresolved markers (strict mode):**
```bash
node scripts/build-personas.js --strict
node scripts/build-personas.js --strict --suite all
```

Passes exit 0 if all markers resolved; exits 1 with `[STRICT]` log line(s) on any unresolved `{{variable}}` or `{{> partial}}` markers. Use in CI pipelines or pre-commit hooks to gate on zero unresolved markers. Safe to combine with `--suite` and `--target`.

**Build + sync to both IDEs (VS Code + Claude Code):**
```bash
node scripts/sync-personas.js
```

**Build + sync to a specific IDE only:**
```bash
node scripts/sync-personas.js --target vscode
node scripts/sync-personas.js --target claude-code
```
