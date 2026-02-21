# Project Manifest: Ledger Personas Build System

**Version:** 1.0.0  
**Last Updated:** 2026-02-21  
**Purpose:** Templated build system for generating the 7 ledger-enabled AI agent persona files

---

## Overview

The **Ledger Personas Build System** is a Node.js-based template engine that assembles the 7 ledger persona Markdown files from structured YAML metadata and Markdown content/partial templates. The generated personas define the behaviour of AI agents in a multi-agent software development workflow backed by the [Project Ledger MCP Server](../../../../mcp-server/README.md).

Generated persona files are consumed in two ways:
- **Directly** — users copy-paste persona content into AI IDE chat sessions
- **Via sync** — `sync-personas.js` copies generated files to VS Code's User prompts directory using each persona's `vs_file_name` frontmatter field

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

**Build all personas:**
```bash
cd personas
node build-personas.js
```

**Check for stale output (CI-friendly):**
```bash
node build-personas.js --check
```

**Preview without writing:**
```bash
node build-personas.js --dry-run
```

**Build + sync to VS Code:**
```bash
# From workspace root
node sync-personas.js
```
