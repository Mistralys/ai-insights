# Project Manifest: Project Ledger MCP Server

**Version:** 1.1.0  
**Last Updated:** 2026-05-30  
**Purpose:** MCP server for Project Ledger workflow coordination

---

## Overview

The **Project Ledger MCP Server** is a TypeScript-based Model Context Protocol (MCP) server that provides typed tools for managing project ledgers in AI agent workflows. It eliminates dual-file desync bugs by wrapping ledger operations with validation, atomicity, and consistency guarantees.

The server manages two types of JSON files:
- **Root Index** (`.ledger/project-ledger.json`): Project-level metadata and work package summaries
- **Work Package Details** (`.ledger/WP-###.json`): Per-work-package implementation details, pipelines, and acceptance criteria

---

## Manifest Sections

| Section | Description |
|---------|-------------|
| [Tech Stack & Patterns](tech-stack.md) | Runtime, frameworks, libraries, and architectural patterns |
| [File Tree](file-tree.md) | Visual directory structure with annotations |
| [Public API Surface](api-surface.md) | MCP tools, classes, types, and public methods |
| [Key Data Flows](data-flows.md) | Main interaction paths through the system |
| [Constraints & Conventions](constraints.md) | Established rules, conventions, and gotchas |

---

## Usage Context

This server is designed to be invoked via the MCP protocol over STDIO transport. It is used by AI agents following a 9-stage workflow (Planner, Project Manager, Developer, QA, Security Auditor, Reviewer, Release Engineer, Documentation, Synthesis) to maintain consistency across multi-agent sessions.

---

## Development Commands

**Version Management:**
```bash
npm run sync-version   # Sync version from changelog.md to package.json
```

**Development:**
```bash
npm run dev           # Run server (auto-syncs version via predev hook)
npm test              # Run all tests
npm run test:watch    # Run tests in watch mode
```

**Important:** The version in `changelog.md` is the **source of truth**. When releasing a new version:
1. Update `changelog.md` first (add new version header at top)
2. Run `npm run sync-version` to update `package.json`
3. The MCP server displays its version at startup: `[project-ledger-mcp] Server v1.21.1 started successfully`

See [constraints.md](constraints.md#development--build-constraints) for more details.

---

## Related Documentation

- **Ledger Schema:** `/personas/ledger/project-ledger-schema.md`
- **Workflow Plans:** `/docs/agents/plans/`
- **Agent Personas:** `/personas/ledger/`
