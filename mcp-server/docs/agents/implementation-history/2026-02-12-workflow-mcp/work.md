# Work Packages: Project Ledger MCP Server

## Overview

This project implements an MCP (Model Context Protocol) server that wraps the split-file ledger architecture, giving agents typed tools instead of raw JSON manipulation. The server enforces consistency, validation, and atomicity at the server level, eliminating desync bugs and invalid status transitions.

**Total Work Packages**: 7
**Implementation Waves**: 4

## Work Package Index

| ID | Title | Wave | Dependencies | Status | Detail File |
|----|-------|------|--------------|--------|-------------|
| WP-001 | Project Scaffolding | Wave 1 | None | READY | [work/WP-001.md](work/WP-001.md) |
| WP-002 | Zod Schemas | Wave 1 | WP-001 | READY | [work/WP-002.md](work/WP-002.md) |
| WP-003 | Storage Layer | Wave 1 | WP-001, WP-002 | READY | [work/WP-003.md](work/WP-003.md) |
| WP-004 | Read Tools | Wave 1 | WP-001, WP-002, WP-003 | READY | [work/WP-004.md](work/WP-004.md) |
| WP-005 | Core Write Tools | Wave 2 | WP-001, WP-002, WP-003, WP-004 | READY | [work/WP-005.md](work/WP-005.md) |
| WP-006 | Pipeline and Observation Tools | Wave 3 | WP-001, WP-002, WP-003, WP-005 | READY | [work/WP-006.md](work/WP-006.md) |
| WP-007 | Workflow Intelligence Tools | Wave 4 | WP-001, WP-002, WP-003, WP-004, WP-006 | READY | [work/WP-007.md](work/WP-007.md) |

## Dependency Graph

```
WP-001 (Scaffolding)
  |
  v
WP-002 (Zod Schemas)
  |
  v
WP-003 (Storage Layer)
  |
  +---> WP-004 (Read Tools) --+
  |                            |
  |                            v
  +---> WP-005 (Core Write Tools)
                  |
                  v
          WP-006 (Pipeline & Observation Tools)
                  |
                  v
          WP-007 (Workflow Intelligence Tools)
```

## Wave Breakdown

### Wave 1: Foundation + Read Tools (WP-001 through WP-004)
Establishes the project, schemas, storage layer, and read-only MCP tools. After this wave, agents can query ledgers via MCP with schema validation.

### Wave 2: Core Write Operations (WP-005)
Adds project initialization, work package CRUD, and status management with enforced transition rules and dual-file atomicity.

### Wave 3: Pipeline & Comments (WP-006)
Adds pipeline lifecycle management and comment/observation tools for both pipeline-level and project-level annotations.

### Wave 4: Workflow Intelligence (WP-007)
Adds the high-level workflow tools that recommend next actions and compute correct handoff status lines.

## MCP Tool Coverage

| MCP Tool | Work Package |
|----------|-------------|
| `get_project_status` | WP-004 |
| `get_work_package` | WP-004 |
| `list_work_packages` | WP-004 |
| `initialize_project` | WP-005 |
| `create_work_package` | WP-005 |
| `claim_work_package` | WP-005 |
| `update_work_package_status` | WP-005 |
| `start_pipeline` | WP-006 |
| `complete_pipeline` | WP-006 |
| `add_observation` | WP-006 |
| `add_project_comment` | WP-006 |
| `get_next_action` | WP-007 |
| `get_handoff_status` | WP-007 |
