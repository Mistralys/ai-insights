# AI Agents Operating System — AI Insights Workspace

> **Purpose:** This document is the authoritative entry point for AI agents entering the **ai-insights** workspace. It defines how agents discover, navigate, and interact with the two sub-projects and their shared infrastructure to ensure architectural integrity and token efficiency.

---

## Workspace Architecture

This is a **monorepo-style workspace** containing two distinct sub-projects and shared root-level tooling:

| Sub-Project | Path | Language | Purpose |
|-------------|------|----------|---------|
| **Project Ledger MCP Server** | `mcp-server/` | TypeScript (ESM) | MCP server that provides typed tools for managing project ledgers in AI agent workflows |
| **Ledger Personas Build System** | `personas/` | JavaScript (CJS) | Template engine that assembles 7 ledger persona Markdown files from YAML/Markdown sources |
| **Orchestrator** | `orchestrator/` | Python (3.11+) | LangGraph + Deep Agents headless pipeline executor — deterministic alternative to IDE-based agent workflows |

The `scripts/` directory contains cross-project scripts that orchestrate persona deployment and role-parity checks.

> **Key relationship:** The personas sub-project generates agent instructions that reference MCP tools exposed by the mcp-server sub-project. The `AGENT_ROLES` constant in `mcp-server/src/utils/constants.ts` must stay in sync with `KNOWN_ROLES` in `scripts/sync-personas.js` and the `role` values in persona YAML metadata.

---

## 📚 Project Manifests — Start Here!

**Core Philosophy:** The Project Manifests are the canonical documentation of this codebase. If implementation code contradicts a manifest, the **code is likely wrong**.

This workspace has **two independent manifests** — one per sub-project.

### MCP Server Manifest

**Location:** `mcp-server/docs/agents/project-manifest/`

| # | Document | Purpose |
|---|----------|---------|
| 1 | [README.md](mcp-server/docs/agents/project-manifest/README.md) | Project overview, MCP server purpose, development commands |
| 2 | [tech-stack.md](mcp-server/docs/agents/project-manifest/tech-stack.md) | TypeScript runtime, Zod, MCP SDK, architectural patterns |
| 3 | [constraints.md](mcp-server/docs/agents/project-manifest/constraints.md) | Atomic writes, file locking, STDIO discipline, schema rules |
| 4 | [file-tree.md](mcp-server/docs/agents/project-manifest/file-tree.md) | Annotated directory structure for mcp-server/ |
| 5 | [api-surface.md](mcp-server/docs/agents/project-manifest/api-surface.md) | 19 MCP tools, LedgerStore class, utility functions |
| 6 | [data-flows.md](mcp-server/docs/agents/project-manifest/data-flows.md) | Initialization, pipeline execution, handoff, detection flows |

### Personas Manifest

**Location:** `personas/docs/agents/project-manifest/`

| # | Document | Purpose |
|---|----------|---------|
| 1 | [README.md](personas/docs/agents/project-manifest/README.md) | Build system overview, quick reference commands |
| 2 | [tech-stack.md](personas/docs/agents/project-manifest/tech-stack.md) | Node.js runtime, js-yaml, template engine patterns |
| 3 | [constraints.md](personas/docs/agents/project-manifest/constraints.md) | Source editing rules, template limitations, naming conventions |
| 4 | [file-tree.md](personas/docs/agents/project-manifest/file-tree.md) | Template sources, output directories, standalone personas |
| 5 | [api-surface.md](personas/docs/agents/project-manifest/api-surface.md) | Build script functions, template syntax, metadata schema |
| 6 | [data-flows.md](personas/docs/agents/project-manifest/data-flows.md) | Build pipeline, sync pipeline, template resolution |

### Sub-Project AGENTS.md

The MCP server sub-project has its own detailed `AGENTS.md`:

- [mcp-server/AGENTS.md](mcp-server/AGENTS.md) — Comprehensive agent operating system specific to the MCP server codebase (efficiency rules, failure protocol, critical constraints, navigation reference).

> When working **exclusively** inside `mcp-server/`, prefer that file for detailed guidance. This root-level document provides workspace-wide orientation and cross-project rules.

---

## 🚀 Quick Start Workflow — Agent Ingestion Path

### Step 1: Determine Your Scope

```
Am I working on…
  ├─ The MCP server?        → Read mcp-server manifest (start with its README.md)
  ├─ The persona system?    → Read personas manifest (start with its README.md)
  ├─ The orchestrator?      → Read orchestrator/README.md
  ├─ Cross-project work?    → Read BOTH manifests + this file's cross-project rules
  └─ Root-level scripts?    → Read this file + the root README.md
```

### Step 2: Ingest the Relevant Manifest

Follow this sequence for whichever sub-project you're entering:

1. **Read README.md** — Understand project purpose and context
2. **Read tech-stack.md** — Understand runtime, frameworks, and patterns
3. **Read constraints.md** — MANDATORY before making any changes
4. **Consult file-tree.md + api-surface.md** — Find files and public interfaces
5. **Read source code** — Only when implementation details are needed

### Step 3: Check Cross-Project Rules (below)

If your work touches both sub-projects or root-level scripts, review the Manifest Maintenance Rules and Cross-System Dependencies sections in this document.

---

## 📝 Manifest Maintenance Rules

### MCP Server (`mcp-server/docs/agents/project-manifest/`)

| Change Made | Documents to Update |
|-------------|---------------------|
| Add new MCP tool | `api-surface.md`, `file-tree.md` (if new file), `data-flows.md` (if new flow) |
| Add new class/service | `api-surface.md`, `file-tree.md` |
| Add/remove dependency | `tech-stack.md` |
| Add new file/directory | `file-tree.md` |
| Change architectural pattern | `tech-stack.md`, `README.md` |
| Add constraint/convention | `constraints.md` |
| Change data flow | `data-flows.md` |
| Modify public method signature | `api-surface.md` |
| Rename/move file | `file-tree.md`, `api-surface.md` (if public) |

### Personas (`personas/docs/agents/project-manifest/`)

| Change Made | Documents to Update |
|-------------|---------------------|
| Add/remove template partial | `file-tree.md`, `api-surface.md` |
| Add/remove feature flag | `api-surface.md` (metadata schema + feature flag table) |
| Change template syntax | `api-surface.md` (template syntax section) |
| Add/remove persona | `file-tree.md`, `data-flows.md` |
| Change build script function | `api-surface.md` |
| Add/remove dependency | `tech-stack.md` |
| Change naming convention | `constraints.md` |
| Modify sync script behavior | `constraints.md`, `data-flows.md` |

### Root-Level / Cross-Project

| Change Made | Documents to Update |
|-------------|---------------------|
| Add/modify agent role | `mcp-server/` → `constraints.md`, `personas/` → `constraints.md` |
| Change `.mcp.json` server key | `personas/` → `constraints.md` (mcp_server_name reference) |
| Add root-level script | Root `README.md` |
| Restructure workspace | Both `file-tree.md` files, this `AGENTS.md` |

---

## ⚡ Efficiency Rules — Search Smart, Read Less

**Token efficiency is critical. Follow this search hierarchy:**

| What You Need | Search Here FIRST | Then Here | Read Source LAST |
|---------------|-------------------|-----------|------------------|
| Find a file location | Relevant `file-tree.md` | grep/file search | Never needed |
| Understand a method/tool | Relevant `api-surface.md` | Source code | Only for implementation logic |
| Trace data flow | Relevant `data-flows.md` | Source code | Only for edge cases |
| Check a rule or convention | Relevant `constraints.md` | Source comments | Only if ambiguous |
| Identify dependencies | Relevant `tech-stack.md` | `package.json` | Never needed |
| Understand patterns | Relevant `tech-stack.md` | Source code | Only for complex logic |

### Which Manifest?

| Working in… | Consult… |
|-------------|----------|
| `mcp-server/src/`, `mcp-server/tests/` | MCP Server manifest |
| `personas/ledger/src/`, `scripts/build-personas.js` | Personas manifest |
| `personas/standalone/src/` | Personas manifest |
| `personas/ledger/vs-code/*.md`, `personas/ledger/claude-code/*.md` (generated output) | Personas manifest — **never edit these directly** |
| `personas/standalone/vs-code/*.md`, `personas/standalone/claude-code/*.md` (generated output) | Personas manifest — **never edit these directly** |
| `scripts/sync-personas.js`, `scripts/build-personas.js`, other `scripts/` | Both manifests + root `README.md` |
| `orchestrator/src/`, `orchestrator/tests/` | [orchestrator/README.md](orchestrator/README.md) |

### Anti-Patterns

| ❌ Inefficient | ✅ Efficient |
|---------------|-------------|
| Grep entire workspace for a tool name | Search `mcp-server/…/api-surface.md` |
| Read generated persona files to understand template logic | Read `personas/…/api-surface.md` + `data-flows.md` |
| Read 10 source files to understand status transitions | Read `mcp-server/…/constraints.md` |
| Search code to find where a file lives | Check the relevant `file-tree.md` |

---

## 🚨 Failure Protocol & Decision Matrix

| Scenario | Action | Priority |
|----------|--------|----------|
| **Manifest vs. code conflict** | Trust manifest. Flag code for correction. | MUST |
| **Ambiguous requirement** | Use most restrictive interpretation. Document assumption. | MUST |
| **Missing manifest documentation** | Flag gap. Do not invent facts. Draft entry for review. | MUST |
| **Untested code path** | Proceed with caution. Add test recommendation. | SHOULD |
| **Cross-project role mismatch** | Verify `AGENT_ROLES`, `KNOWN_ROLES`, and persona YAML are aligned. Flag any divergence. | MUST |
| **Unclear which manifest applies** | If change touches both sub-projects, consult both. When in doubt, default to the MCP server manifest. | SHOULD |
| **Generated file needs change** | Never edit generated persona files. Trace back to the relevant suite source (`personas/ledger/src/` or `personas/standalone/src/`) and change the template source. | MUST |
| **Breaking change proposed** | Document in work package. Flag for review. Never implement silently. | MUST |
| **Dependency not in tech stack** | Justify before adding. Update relevant `tech-stack.md`. | SHOULD |

### Escalation Path

```
Issue Detected
    ↓
Can I resolve with manifest + constraints?
    ↓ YES → Proceed
    ↓ NO  →
Is it a cross-project concern?
    ↓ YES → Consult BOTH manifests + cross-project rules above
    ↓ NO  →
Is it a breaking change or architectural decision?
    ↓ YES → Pause and request user input
    ↓ NO  →
Is it a missing manifest entry?
    ↓ YES → Draft entry + request Manifest Curator review
    ↓ NO  →
Unclear → Pause and request user clarification
```

---

## 🔗 Cross-System Dependencies

These are the critical synchronization points between sub-projects. Breaking any of these causes silent failures:

| Dependency | Source of Truth | Must Stay In Sync With |
|------------|----------------|------------------------|
| Agent role names | `mcp-server/src/utils/constants.ts` → `AGENT_ROLES` | `scripts/sync-personas.js` → `KNOWN_ROLES`; persona YAML → `role` field |
| MCP server name | `personas/ledger/src/meta/_shared.yaml` → `mcp_server_name` | `.mcp.json` → server key (default: `central_pm`) |
| Persona `vs_file_name` | Per-persona YAML (`personas/ledger/src/meta/N-name.yaml`) | Agent Registry scan pattern (`*.agent.md`) in `mcp-server/src/utils/agent-registry.ts` |
| Version (MCP server) | `mcp-server/changelog.md` | `mcp-server/package.json` (via `npm run sync-version`) |
| Version (Personas) | `personas/changelog.md` | `personas/ledger/src/meta/_shared.yaml` → `default_version` |
| Orchestrator MCP server command | `orchestrator/.env` → `MCP_SERVER_CMD` (or default in `config.py`) | Matches `mcp-server/` build output (`dist/index.js`) |
| Orchestrator persona files | `orchestrator/src/config.py` → `PERSONA_FILES` dict | `personas/ledger/vs-code/` generated output filenames |

### Validation Scripts

| Script | Purpose | Run From |
|--------|---------|----------|
| `node scripts/check-known-roles.js` | Verify `KNOWN_ROLES` ↔ `AGENT_ROLES` parity | Workspace root |
| `node scripts/build-personas.js --check` | Detect stale generated persona output | Workspace root |

---

## 📊 Project Statistics

| Property | MCP Server | Personas | Orchestrator |
|----------|-----------|----------|--------------|
| **Language** | TypeScript 5.7.2 (ES2022) | JavaScript (ES2020+, CJS) | Python 3.11+ |
| **Runtime** | Node.js (ESM) | Node.js (CommonJS) | CPython |
| **Architecture** | MCP Server + Repository Pattern | Template Engine (3-Phase Pipeline) | LangGraph StateGraph + Deep Agents |
| **Package Manager** | npm | npm | pip |
| **Test Framework** | Vitest | — (manual `--check` flag) | pytest |
| **Build Tool** | `tsc` | `build-personas.js` (self-contained) | — (source install) |
| **Prod Dependencies** | 3 (`@modelcontextprotocol/sdk`, `zod`, `proper-lockfile`) | 1 (`js-yaml`) | 5 core (`langgraph`, `deepagents`, `langchain-mcp-adapters`, `langchain-core`, `python-dotenv`); optional extras: `anthropic`, `google`, `checkpoint` |
| **Dev Dependencies** | 4 (`tsx`, `vitest`, `typescript`, `@types/node`) | 0 | 3 (`pytest`, `pytest-asyncio`, `ruff`) |

### Root-Level Tooling

| File | Purpose |
|------|---------|
| `scripts/sync-personas.js` | Build personas + deploy to VS Code prompts directory and/or Claude Code `~/.claude/agents/` + validate frontmatter |
| `scripts/build-personas.js` | Assemble 7 ledger persona files from `personas/ledger/src/` templates |
| `scripts/check-known-roles.js` | Drift check between `KNOWN_ROLES` and `AGENT_ROLES` |
| `scripts/bundle-docs.js` | Bundle workspace docs (NotebookLM + Workflow Spec) into `build/` |
| `context.yaml` | Context Hub configuration for documentation generation |
| `.mcp.dist.json` | Template MCP server configuration (copy to `.mcp.json` and update paths) |

---

## 🧭 Navigation Quick Reference

| I Need To… | Go Here |
|------------|---------|
| Understand the whole workspace | [README.md](README.md) |
| Work on the MCP server | [mcp-server/AGENTS.md](mcp-server/AGENTS.md) → then its manifest |
| Work on persona templates | [personas/docs/agents/project-manifest/](personas/docs/agents/project-manifest/) |
| Work on the orchestrator | [orchestrator/README.md](orchestrator/README.md) |
| Look up an MCP tool signature | [mcp-server/…/api-surface.md](mcp-server/docs/agents/project-manifest/api-surface.md) |
| Look up template syntax | [personas/…/api-surface.md](personas/docs/agents/project-manifest/api-surface.md) |
| Find a file in mcp-server | [mcp-server/…/file-tree.md](mcp-server/docs/agents/project-manifest/file-tree.md) |
| Find a file in personas | [personas/…/file-tree.md](personas/docs/agents/project-manifest/file-tree.md) |
| See MCP server constraints | [mcp-server/…/constraints.md](mcp-server/docs/agents/project-manifest/constraints.md) |
| See persona system constraints | [personas/…/constraints.md](personas/docs/agents/project-manifest/constraints.md) |
| Understand the 7-stage workflow | [personas/ledger/README.md](personas/ledger/README.md) |
| Review past discussions | [discussions/](discussions/) |
| Review error history | [history/error-ledger.md](history/error-ledger.md) |
| Review key learnings | [history/key-learnings.md](history/key-learnings.md) |

---

**Version:** 1.0.0
**Last Updated:** 2026-02-22
**Maintained By:** AGENTS.md Curator Agent
