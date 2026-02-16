# Project Manifest: Project Ledger MCP Server

**Version:** 1.0.0  
**Last Updated:** 2026-02-16  
**Purpose:** MCP server for Project Ledger workflow coordination

---

## Overview

The **Project Ledger MCP Server** is a TypeScript-based Model Context Protocol (MCP) server that provides typed tools for managing project ledgers in AI agent workflows. It eliminates dual-file desync bugs by wrapping ledger operations with validation, atomicity, and consistency guarantees.

The server manages two types of JSON files:
- **Root Index** (`project-ledger.json`): Project-level metadata and work package summaries
- **Work Package Details** (`ledger/WP-###.json`): Per-work-package implementation details, pipelines, and acceptance criteria

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

This server is designed to be invoked via the MCP protocol over STDIO transport. It is used by AI agents following a 7-stage workflow (Planner, Project Manager, Developer, QA, Reviewer, Documentation, Synthesis) to maintain consistency across multi-agent sessions.

---

## Related Documentation

- **Ledger Schema:** `/personas/ledger/project-ledger-schema.md`
- **Workflow Plans:** `/docs/agents/plans/`
- **Agent Personas:** `/personas/ledger/`
