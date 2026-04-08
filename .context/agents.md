# AI Insights - Agent Operating System
_SOURCE: Authoritative entry point for AI agents entering this workspace_
# Authoritative entry point for AI agents entering this workspace
```
// Structure of documents
└── AGENTS.md
└── mcp-server/
    └── AGENTS.md

```
###  Path: `AGENTS.md`

```md
# AI Agents Operating System — AI Insights Workspace

> **Purpose:** This document is the authoritative entry point for AI agents entering the **ai-insights** workspace. It defines how agents discover, navigate, and interact with the two sub-projects and their shared infrastructure to ensure architectural integrity and token efficiency.

---

## Workspace Architecture

This is a **monorepo-style workspace** containing two distinct sub-projects and shared root-level tooling:

| Sub-Project | Path | Language | Purpose |
|-------------|------|----------|---------|
| **Project Ledger MCP Server** | `mcp-server/` | TypeScript (ESM) | MCP server that provides typed tools for managing project ledgers in AI agent workflows |
| **Ledger Personas Build System** | `personas/` | JavaScript (CJS) | Template engine that assembles 9 ledger persona Markdown files from YAML/Markdown sources |
| **Orchestrator** | `orchestrator/` | Python (3.11+) | LangGraph + Deep Agents headless pipeline executor — deterministic alternative to IDE-based agent workflows |

The `scripts/` directory contains cross-project scripts that orchestrate persona deployment and role-parity checks.

> **Key relationship:** The personas sub-project generates agent instructions that reference MCP tools exposed by the mcp-server sub-project. All three consumers of agent role names — `AGENT_ROLES` in `mcp-server/src/utils/constants.ts`, `KNOWN_ROLES` in `scripts/sync-personas.js`, and the `role` values in persona YAML metadata — now derive from or are validated against `shared/workflow-manifest.json`. The manifest is the single source of truth; adding a role there propagates automatically to `AGENT_ROLES` and `KNOWN_ROLES`. Persona YAML `role` fields are validated by `scripts/build-personas.js` against manifest role names.

---

## 📚 Project Manifests — Start Here!

**Core Philosophy:** The Project Manifests are the canonical documentation of this codebase. If implementation code contradicts a manifest, the **code is likely wrong**.

**Unified entry point:** [`docs/agents/project-manifest/`](docs/agents/project-manifest/README.md) — links to all three module manifests, cross-system dependencies, shared infrastructure reference, and navigation guide.

Each sub-project maintains its own detailed manifest:

| Module | Manifest Location |
|--------|-------------------|
| **MCP Server** | [`mcp-server/docs/agents/project-manifest/`](mcp-server/docs/agents/project-manifest/README.md) |
| **Personas** | [`personas/docs/agents/project-manifest/`](personas/docs/agents/project-manifest/README.md) |
| **Orchestrator** | [`orchestrator/docs/agents/project-manifest/`](orchestrator/docs/agents/project-manifest/README.md) |

**See also:** [Workflow Specification](mcp-server/docs/agents/workflow-specification/README.md) — state machines, routing, handoffs, and edge cases (MCP server scope).

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
| Add/remove template partial | `api-surface.md` |
| Add/remove feature flag | `api-surface.md` (metadata schema + feature flag table) |
| Change template syntax | `api-surface.md` (template syntax section) |
| Add/remove persona | `data-flows.md`, `constraints.md` (directory layout table if new directory) |
| Change build script function | `api-surface.md` |
| Add/remove dependency | `tech-stack.md` |
| Change naming convention | `constraints.md` |
| Modify sync script behavior | `constraints.md`, `data-flows.md` |

### Root-Level / Cross-Project

| Change Made | Documents to Update |
|-------------|---------------------|
| Add/modify agent role | `mcp-server/` → `constraints.md`, `personas/` → `constraints.md` |
| Add OS-specific code or dependency | This `AGENTS.md` → Cross-Platform Policy; affected sub-project's `constraints.md` |
| Change `.mcp.json` server key | `personas/` → `constraints.md` (mcp_server_name reference) |
| Add root-level script | Root `README.md` |
| Restructure workspace | `mcp-server/…/file-tree.md`, this `AGENTS.md`, regenerate `.context/` |
| Change workflow logic (state machines, routing, handoffs, edge cases) | `mcp-server/docs/agents/workflow-specification/` **first**, then implementation code, then tests, then `mcp-server/docs/agents/project-manifest/constraints.md` |
| Change changelog convention | This `AGENTS.md` → Changelog Convention section; Changelog Curator persona source |

---

## ⚡ Efficiency Rules — Search Smart, Read Less

**Token efficiency is critical. Follow this search hierarchy:**

| What You Need | Search Here FIRST | Then Here | Read Source LAST |
|---------------|-------------------|-----------|------------------|
| Find a file location | Relevant `file-tree.md` (mcp-server) or `.context/` auto-generated tree (personas) | grep/file search | Never needed |
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
| `personas/ledger/vs-code/*.agent.md`, `personas/ledger/claude-code/*.md` (generated output) | Personas manifest — **never edit these directly** |
| `personas/standalone/vs-code/*.agent.md`, `personas/standalone/claude-code/*.md` (generated output) | Personas manifest — **never edit these directly** |
| `scripts/sync-personas.js`, `scripts/build-personas.js`, other `scripts/` | Both manifests + root `README.md` |
| `orchestrator/src/`, `orchestrator/tests/` | [Orchestrator manifest](orchestrator/docs/agents/project-manifest/README.md) |

### Anti-Patterns

| ❌ Inefficient | ✅ Efficient |
|---------------|-------------|
| Grep entire workspace for a tool name | Search `mcp-server/…/api-surface.md` |
| Read generated persona files to understand template logic | Read `personas/…/api-surface.md` + `data-flows.md` |
| Read 10 source files to understand status transitions | Read `mcp-server/…/constraints.md` |
| Search code to find where a file lives | Check `file-tree.md` (mcp-server) or `.context/` tree (personas) |
| Get a full module overview (API + source + tests) | Read `.context/{module}/` generated docs | Manifest `api-surface.md` | Source code |

### Generated Context Docs (`.context/`)

The [CTX Generator](https://github.com/context-hub/generator) produces Markdown snapshots of the entire codebase. Run `node scripts/cli.js ctx-generate` to regenerate. Output lives in `.context/` (tracked in VCS).

| Path | Contents |
|------|----------|
| `.context/README.md` | Workspace overview (mirrors root `README.md`) |
| `.context/agents.md` | Root `AGENTS.md` content |
| `.context/workspace-structure.md` | Top-level directory tree (depth 3) |
| `.context/scripts.md` | All workspace scripts source |
| `.context/shared-manifest.md` | `workflow-manifest.json` + schema |
| `.context/project-manifest.md` | Root manifest hub (module links, cross-system deps) |
| `.context/mcp-server/overview.md` | MCP server README |
| `.context/mcp-server/manifest.md` | MCP server project manifest (all 6 docs) |
| `.context/mcp-server/workflow-specification.md` | Workflow spec docs |
| `.context/mcp-server/source-tools.md` | Tool handler source |
| `.context/mcp-server/source-storage.md` | LedgerStore + schema source |
| `.context/mcp-server/source-utils.md` | Utility module source |
| `.context/mcp-server/tests.md` | Test suite source |
| `.context/mcp-server/file-structure.md` | MCP server directory tree |
| `.context/orchestrator/overview.md` | Orchestrator README |
| `.context/orchestrator/documentation.md` | Architecture, routing, log schema, public API docs |
| `.context/orchestrator/manifest.md` | Orchestrator project manifest |
| `.context/orchestrator/source-core.md` | Core modules (CLI, config, graph, state, supervisor) |
| `.context/orchestrator/source-nodes.md` | Pipeline stage node factories |
| `.context/orchestrator/source-utils.md` | Utility modules (tool wrappers, persona loader, etc.) |
| `.context/orchestrator/tests.md` | Test suite source |
| `.context/orchestrator/file-structure.md` | Orchestrator directory tree |
| `.context/personas/overview.md` | Personas README |
| `.context/personas/manifest.md` | Personas project manifest |
| `.context/personas/ledger-suite.md` | Ledger workflow user guide |
| `.context/personas/standalone-suite.md` | Standalone personas guide |
| `.context/personas/shared-partials.md` | Cross-suite Markdown partials |
| `.context/personas/ledger-metadata.md` | Ledger persona YAML metadata |
| `.context/personas/standalone-metadata.md` | Standalone persona YAML metadata |
| `.context/personas/file-structure.md` | Personas directory tree |

> **Tip:** These files are ideal for feeding into LLMs or external tools (e.g. NotebookLM) that need a full codebase snapshot without cloning the repo.

---

## 🚨 Failure Protocol & Decision Matrix

| Scenario | Action | Priority |
|----------|--------|----------|
| **Manifest vs. code conflict** | Trust manifest. Flag code for correction. | MUST |
| **Ambiguous requirement** | Use most restrictive interpretation. Document assumption. | MUST |
| **Missing manifest documentation** | Flag gap. Do not invent facts. Draft entry for review. | MUST |
| **Untested code path** | Proceed with caution. Add test recommendation. | SHOULD |
| **Cross-project role mismatch** | Both `AGENT_ROLES` and `KNOWN_ROLES` derive from `shared/workflow-manifest.json` — run `node scripts/validate-workflow-manifest.js` to verify the manifest is self-consistent. Verify persona YAML `role` fields are valid manifest role names (validated automatically by `build-personas.js`). Flag any divergence. | MUST |
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
| Agent role names | `shared/workflow-manifest.json` → `roles[].name` | `mcp-server/src/utils/constants.ts` → `AGENT_ROLES` (auto-derived); `scripts/sync-personas.js` → `KNOWN_ROLES` (auto-derived); persona YAML → `role` field (validated by `build-personas.js`) |
| MCP server name | `personas/ledger/src/meta/_shared.yaml` → `mcp_server_name` | `.mcp.json` → server key (default: `central_pm`) |
| Persona `vs_file_name` | Per-persona YAML (`personas/ledger/src/meta/N-name.yaml`) | Agent Registry scan pattern (`*.agent.md`) in `mcp-server/src/utils/agent-registry.ts` |
| Version (MCP server) | `mcp-server/changelog.md` | `mcp-server/package.json` (via `npm run sync-version`) |
| Version (Personas) | `personas/changelog.md` | `personas/ledger/src/meta/_shared.yaml` → `default_version` |
| Orchestrator MCP server command | `orchestrator/.env` → `MCP_SERVER_CMD` (or default in `config.py`) | Matches `mcp-server/` build output (`dist/index.js`) |
| Orchestrator persona files | `orchestrator/src/config.py` → `PERSONA_FILES` dict | `personas/ledger/claude-code/` generated output filenames |
| Orchestrator model slugs | `personas/ledger/src/meta/_shared.yaml` → `default_model_slug`; per-persona `N-*.yaml` → `model_slug` | `orchestrator/src/utils/persona_models.py` → `extract_persona_model_slugs()` (reads YAML at startup); `orchestrator/src/config.py` → `Config.stage_models` (populated by loader); per-stage `model` field in `stage_start`, `stage_complete`, `stage_error` JSONL entries |
| Workflow logic (state machines, routing maps, handoff logic, edge cases) | `mcp-server/docs/agents/workflow-specification/` | `mcp-server/src/` (TypeScript implementation), `orchestrator/src/` (Python implementation), `mcp-server/tests/` (test assertions) |
| `security-audit` pipeline → Security Auditor role | `mcp-server/src/utils/pipeline-maps.ts` → `PIPELINE_AGENT_MAP['security-audit']` | `personas/ledger/src/meta/5-security-auditor.yaml` → `role: Security Auditor`; `mcp-server/src/utils/constants.ts` → `AGENT_ROLES` |
| `release-engineering` pipeline → Release Engineer role | `mcp-server/src/utils/pipeline-maps.ts` → `PIPELINE_AGENT_MAP['release-engineering']` | `personas/ledger/src/meta/7-release-engineer.yaml` → `role: Release Engineer`; `mcp-server/src/utils/constants.ts` → `AGENT_ROLES` |
| Changelogs | Root `changelog.md` (Git-tagged releases) | `mcp-server/changelog.md`, `orchestrator/changelog.md`, `personas/changelog.md` (module-level detail, not tagged). Root entry references module versions via `> mcp vX · personas vY · orchestrator vZ`. |

### Validation Scripts

| Script | Purpose | Run From |
|--------|---------|----------|
| `node scripts/validate-workflow-manifest.js` | Validate `shared/workflow-manifest.json` structure and semantics | Workspace root |
| `node scripts/check-known-roles.js` | Delegates to `validate-workflow-manifest.js` (previously compared `KNOWN_ROLES` ↔ `AGENT_ROLES`; now both are manifest-derived) | Workspace root |
| `node scripts/build-personas.js --check` | Detect stale generated persona output | Workspace root |

---

## �️ Cross-Platform Policy

**Supported platforms:** Windows, macOS, and Linux. All sub-projects (MCP server, orchestrator, personas build system, root-level scripts) must work correctly on all three.

### Rules

1. **No OS-specific APIs without a cross-platform fallback.** When platform-specific code is unavoidable (e.g., file locking), provide per-platform implementations gated by runtime detection (`process.platform` / `sys.platform`) and document the invariants for each OS. Prefer stdlib-only solutions over third-party wrappers when the stdlib covers all three targets.
2. **Use framework path utilities — never hardcode separators.** Use `path.join()` / `path.resolve()` (Node.js) and `pathlib.Path` / `os.path.join()` (Python). Never assume `/` or `\` as a path separator in string literals.
3. **Shell commands must be cross-platform.** Root-level `scripts/` run on Node.js and must not rely on Unix-only utilities (e.g., `grep`, `sed`). Use Node.js built-in APIs or npm packages instead. When a script delegates to a shell, document any OS-specific invocation difference (e.g., venv activation).
4. **File locking must work on all platforms.** The MCP server uses `proper-lockfile` (cross-platform). The orchestrator uses `src/utils/filelock.py` (`msvcrt` on Windows, `fcntl` on Unix). Any new locking mechanism must support all three OSs.
5. **Tests must be platform-agnostic.** Avoid hardcoded Unix paths (`/tmp/…`) in test fixtures. Use the language's temp-directory API (`os.tmpdir()` / `tempfile.mkdtemp()`). Do not assert path separators — compare via `path.resolve()` or `pathlib` equivalents.
6. **Line endings:** Rely on Git's `core.autocrlf` / `.gitattributes` for normalization. Never assume `\n` when reading user-edited files; use language-level line-splitting APIs.

### Existing Cross-Platform Implementations

| Component | Mechanism | Reference |
|-----------|-----------|----------|
| MCP server file locking | `proper-lockfile` (npm) | `mcp-server/src/storage/file-lock.ts` |
| Orchestrator file locking | `msvcrt` (Win) / `fcntl` (Unix) | `orchestrator/src/utils/filelock.py` |
| Root scripts | Node.js `fs`, `path`, `child_process` — no Unix shell deps | `scripts/` |
| Personas build | Node.js CJS — inherently cross-platform | `scripts/build-personas.js` |

> **Rationale:** The MCP server runs alongside the user's IDE on their desktop OS. The orchestrator is a developer tool that must work on contributor machines across all major platforms. Failing on any OS is a shipping bug.

---

## �📝 Changelog Convention

This workspace uses a **hub-and-spoke changelog model**: each sub-project maintains its own detailed changelog, and the root changelog aggregates the highlights into versioned releases.

### File Locations

| File | Scope | Versioning |
|------|-------|------------|
| `changelog.md` (root) | Workspace-wide release summary | SemVer, tagged in Git (`v1.9.0`, …) |
| `mcp-server/changelog.md` | MCP server changes only | Own SemVer (`v1.14.0`, …), **not** Git-tagged |
| `orchestrator/changelog.md` | Orchestrator changes only | Own SemVer (`v0.5.0`, …), **not** Git-tagged |
| `personas/changelog.md` | Persona build system changes only | Own SemVer (`v3.9.1`, …), **not** Git-tagged |

### Rules

1. **Only the root changelog triggers Git tags/releases.** Module changelogs track internal history but have no corresponding Git tags.
2. **Module changelogs come first.** When preparing a release, update each affected module changelog before writing the root entry.
3. **Root entries reference module versions.** Use the blockquote line format to link back: `> mcp v1.14.0 · personas v3.9.1 · orchestrator v0.4.0`. Omit modules that had no changes.
4. **Root entries summarize, not duplicate.** Each root bullet condenses multiple module-level bullets into one outcome-oriented line. Implementation detail stays in the module changelog.
5. **House style applies everywhere.** All changelogs follow the Changelog Curator's house style: flat bullet list with category prefixes, no `### Added/Changed/Fixed` sub-headers, ≤ 100-char lines.
6. **Version bumps:** Root version follows SemVer based on the most significant change across all modules. Module versions are incremented independently.
7. **`scripts/extract-changelog-entry.js`** parses the topmost root changelog entry for CI/GitHub Actions release automation.

### Two-Step Workflow

```
Step 1 — Module changelogs
    For each module with changes since the last Git tag:
      → Run git log / diff for that module's directory
      → Add a new entry to {module}/changelog.md

Step 2 — Root changelog
    → Read the new module entries
    → Write a single new root entry summarizing the highlights
    → Assign the next SemVer version
```

### Prompt Template

See the root [README.md → Changelog Workflow](README.md) section for the copy-paste prompt template.

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
| **Prod Dependencies** | 3 (`@modelcontextprotocol/sdk`, `zod`, `proper-lockfile`) | 1 (`js-yaml`) | 6 core (`langgraph`, `langgraph-checkpoint-sqlite`, `deepagents`, `langchain-mcp-adapters`, `langchain-core`, `python-dotenv`); optional extras: `anthropic`, `google` |
| **Dev Dependencies** | 4 (`tsx`, `vitest`, `typescript`, `@types/node`) | 0 | 3 (`pytest`, `pytest-asyncio`, `ruff`) |

### Root-Level Tooling

| File | Purpose |
|------|---------|  
| `scripts/cli.js` | **Interactive command center + direct CLI** for all workspace operations. Replaces `setup-orchestrator.js` as the user-facing entry point. |
| `scripts/sync-personas.js` | Build personas + deploy to VS Code prompts directory and/or Claude Code `~/.claude/agents/` + validate frontmatter |
| `scripts/build-personas.js` | Assemble 48 persona files (9 ledger + 15 standalone × 2 IDE targets) from `personas/ledger/src/` and `personas/standalone/src/` templates |
| `scripts/check-known-roles.js` | Manifest validation delegate (previously `KNOWN_ROLES` ↔ `AGENT_ROLES` drift check; superseded by `validate-workflow-manifest.js` now that both derive from the manifest) |
| `scripts/check-version-sync.js` | Compares each module's changelog version against its package manifest version. Exits 1 on mismatch. Called by the pre-commit hook (blocking) and available via `node scripts/cli.js check-versions`. |
| `scripts/bundle-docs.js` | Bundle workspace docs (NotebookLM + Workflow Spec) into `build/` |
| `scripts/preflight-orchestrator.js` | Pre-flight readiness checks for the orchestrator: validates venv, `.env` config, MCP server dist freshness, and absence of conflicting processes. Supports `--plan <path>` and `--json`. Invokable via `node scripts/cli.js preflight`. |
| `scripts/read-log.js` | Structured JSONL log reader for orchestrator runs: renders entries as human-readable colored output (default) or raw JSON array (`--format json`). Supports `--errors` to filter to error events only. |
| `scripts/kill-orchestrator.js` | Finds and terminates stale orchestrator processes, cleans up lock files. Supports `--force` (kill without prompting), `--json` (list processes as JSON without killing), and `--depth N` (scan last N log files for lock cleanup; default 20). |
| `scripts/install-hooks.js` | One-time setup: sets `git config core.hooksPath .githooks` to activate the pre-commit guard (persona freshness, version sync, ruff lint, CTX staleness warning, changelog drift warning) |
| `shared/workflow-manifest.json` | **Single source of truth** for specification-derived constructs: 9 agent roles, 6 pipeline types, status enums (project/WP/pipeline/blocker), and workflow constants. All sub-projects derive their constants from this file. Validated by `shared/workflow-manifest.schema.json`. |
| `shared/workflow-manifest.schema.json` | JSON Schema (Draft-07) enforcing structural constraints on `workflow-manifest.json`. Semantic cross-reference checks (unique IDs, fail_routing references, default_stages subset) are enforced by `scripts/validate-workflow-manifest.js`. |
| `context.yaml` | [CTX Generator](https://github.com/context-hub/generator) root config. Imports `**/module-context.yaml` and defines workspace-wide documents. Run via `node scripts/cli.js ctx-generate` (requires `ctx` on PATH). Output goes to `.context/` (tracked in VCS). |
| `.mcp.dist.json` | Template MCP server configuration (copy to `.mcp.json` and update paths) |

---

## 🧭 Navigation Quick Reference

| I Need To… | Go Here |
|------------|---------|
| Understand the whole workspace | [README.md](README.md) |
| See all project manifests | [docs/agents/project-manifest/](docs/agents/project-manifest/README.md) |
| Work on the MCP server | [mcp-server/AGENTS.md](mcp-server/AGENTS.md) → then its manifest |
| Work on persona templates | [personas/docs/agents/project-manifest/](personas/docs/agents/project-manifest/) |
| Work on the orchestrator | [orchestrator/docs/agents/project-manifest/](orchestrator/docs/agents/project-manifest/README.md) |
| Look up an MCP tool signature | [mcp-server/…/api-surface.md](mcp-server/docs/agents/project-manifest/api-surface.md) |
| Look up template syntax | [personas/…/api-surface.md](personas/docs/agents/project-manifest/api-surface.md) |
| Find a file in mcp-server | [mcp-server/…/file-tree.md](mcp-server/docs/agents/project-manifest/file-tree.md) |
| Find a file in personas | `.context/personas/file-structure.md` (auto-generated) |
| See MCP server constraints | [mcp-server/…/constraints.md](mcp-server/docs/agents/project-manifest/constraints.md) |
| See persona system constraints | [personas/…/constraints.md](personas/docs/agents/project-manifest/constraints.md) |
| Understand the 9-agent workflow | [personas/ledger/README.md](personas/ledger/README.md) |
| Understand workflow logic (state machines, routing, handoffs) | [Workflow Specification](mcp-server/docs/agents/workflow-specification/README.md) |
| Review past discussions | [discussions/](discussions/) |
| Review error history | [history/error-ledger.md](history/error-ledger.md) |
| Review key learnings | [history/key-learnings.md](history/key-learnings.md) |
| Get a full codebase snapshot for LLMs | `.context/` (run `node scripts/cli.js ctx-generate` to regenerate) |
| Understand changelog workflow | Changelog Convention section (this file) |

---

**Version:** 1.0.0
**Last Updated:** 2026-03-22
**Maintained By:** AGENTS.md Curator Agent

```
###  Path: `/mcp-server/AGENTS.md`

```md
# AI Agents Operating System — Project Ledger MCP Server

> **Purpose:** This document is the authoritative "Source of Truth" and "Operating System" for AI agents entering this codebase. It defines how agents interact with the project to ensure architectural integrity, token efficiency, and consistent quality.

---

## 📚 Project Manifest — The Source of Truth

**Core Philosophy:** The Project Manifest is the canonical documentation of this codebase. If implementation code contradicts the manifest, the **code is likely wrong**.

### 🎯 Manifest Location

All manifest documents are located in:

```
/docs/agents/project-manifest/
```

### 📖 Manifest Documents (Read in Order)

| # | Document | Purpose | When to Consult |
|---|----------|---------|-----------------|
| 0 | [Workflow Specification](docs/agents/workflow-specification/README.md) | Authoritative specification of all workflow logic — state machines, routing, handoffs, edge cases | **Before modifying any pipeline, routing, status, handoff, or recommendation logic** |
| 1 | [README.md](docs/agents/project-manifest/README.md) | Project overview, purpose, and context | **FIRST** — Before any work |
| 2 | [tech-stack.md](docs/agents/project-manifest/tech-stack.md) | Runtime, frameworks, libraries, architectural patterns | Understanding system design |
| 3 | [constraints.md](docs/agents/project-manifest/constraints.md) | Critical rules, gotchas, and conventions | **MANDATORY** — Before making changes |
| 4 | [file-tree.md](docs/agents/project-manifest/file-tree.md) | Visual directory structure with annotations | Finding files and modules |
| 5 | [api-surface.md](docs/agents/project-manifest/api-surface.md) | Public constructors, methods, and signatures | Understanding interfaces before reading implementations |
| 6 | [data-flows.md](docs/agents/project-manifest/data-flows.md) | Main interaction paths through the system | Tracing execution paths |

---

## 🚀 Quick Start Workflow — Agent Ingestion Path

**Follow this sequence when entering the codebase:**

```
┌─────────────────────────────────────────────────────────────┐
│  STEP 1: Read README.md                                     │
│  → Understand: Project purpose, problem, solution           │
└────────────────────────┬────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  STEP 2: Read tech-stack.md                                 │
│  → Understand: Runtime, language version, patterns          │
└────────────────────────┬────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  STEP 3: Read constraints.md                                │
│  → Internalize: MANDATORY rules, anti-patterns, gotchas     │
│  ⚠️  CRITICAL — These rules are non-negotiable              │
└────────────────────────┬────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  STEP 4: Consult file-tree.md + api-surface.md             │
│  → Search: Find relevant modules and their public APIs      │
└────────────────────────┬────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  STEP 5: Read Implementation Code (Only When Necessary)     │
│  → Read: Specific files/functions identified in Step 4      │
└─────────────────────────────────────────────────────────────┘
```

**Time Budget (Estimated):**
- Steps 1-3: ~10 minutes (high-level understanding)
- Step 4: ~5 minutes per module (targeted search)
- Step 5: Only read source code when you need implementation details

---

## 📝 Manifest Maintenance Rules

**When you modify the codebase, you MUST update the manifest accordingly.**

| Change Made | Manifest Documents to Update | Notes |
|-------------|------------------------------|-------|
| **Add new MCP tool** | `api-surface.md`, `file-tree.md` (if new file), `data-flows.md` (if new flow) | Document signature, parameters, and data flow |
| **Add new class/service** | `api-surface.md`, `file-tree.md` | Document public constructors, properties, and methods |
| **Add new dependency** | `tech-stack.md` | Add to Production or Development dependencies table |
| **Add new file/directory** | `file-tree.md` | Add to tree structure with brief annotation |
| **Change architectural pattern** | `tech-stack.md`, `README.md` | Update pattern description and rationale |
| **Add new constraint/convention** | `constraints.md` | Document rule, anti-pattern, and enforcement mechanism |
| **Change data flow** | `data-flows.md` | Update or add flow diagram and description |
| **Modify public method signature** | `api-surface.md` | Update signature (do NOT include implementation) |
| **Rename/move file** | `file-tree.md`, `api-surface.md` (if public) | Update paths and references |
| **Add new status transition** | `constraints.md`, `data-flows.md` | Document rule and update transition table |
| **Change schema/validation** | `constraints.md`, `tech-stack.md` (if pattern), `api-surface.md` (if signature) | Document new validation rules |

**Enforcement:** Before completing any work package, verify you have updated ALL relevant manifest documents.

---

## ⚡ Efficiency Rules — Search Smart, Read Less

**Token efficiency is critical. Follow this search hierarchy:**

### 🔍 Search Hierarchy (Mandatory Order)

| What You Need | Search Here FIRST | Search Here SECOND | Read Source Code LAST |
|---------------|-------------------|--------------------|-----------------------|
| **Understand workflow behavior** | [Workflow Specification](docs/agents/workflow-specification/README.md) | `constraints.md` | Only for implementation details |
| **Find a file location** | `file-tree.md` | grep/file search | Never needed |
| **Understand a method signature** | `api-surface.md` | Source code | Only for implementation logic |
| **Trace how data flows** | `data-flows.md` | Source code | Only for edge cases |
| **Check if rule exists** | `constraints.md` | Source code comments | Only if ambiguous |
| **Identify dependencies** | `tech-stack.md` | `package.json` | Never needed |
| **Understand patterns** | `tech-stack.md` | Source code | Only for complex logic |

### 🛑 Anti-Patterns (Do NOT Do This)

| ❌ Inefficient | ✅ Efficient |
|---------------|-------------|
| Grep entire codebase for "LedgerStore" | Search `api-surface.md` for "LedgerStore" |
| Read 10 files to find "atomicWriteJson" | Search `file-tree.md` for "atomic-writer.ts" |
| Read source code to understand status transitions | Read `constraints.md` §8 "Status Transitions Are Enforced" |
| Clone the repo and run grep on all TS files | Read `data-flows.md` to trace execution path |

**Rationale:** Reading manifest documents consumes ~1/10th the tokens of reading source code. Use the manifest as your index.

---

## 🚨 Failure Protocol & Decision Matrix

**When you encounter ambiguity, missing documentation, or errors, follow this protocol:**

### Decision Matrix

| Scenario | Action | Priority | Example |
|----------|--------|----------|---------|
| **Manifest vs. Code Conflict** | Trust manifest. Flag code for correction. If unsafe, pause and ask user. | **MUST** | `api-surface.md` says method returns `Promise<void>`, code returns `Promise<string>` → Code is wrong |
| **Ambiguous Requirement** | Use most restrictive interpretation. Document assumption in work notes. | **MUST** | "Update status" unclear → Assume full validation required (stricter) |
| **Missing Manifest Documentation** | Pause work. Read source code. Create draft manifest entry. Request review. | **MUST** | New tool not in `api-surface.md` → Draft signature and request manifest update |
| **Untested Code Path** | Write test first. Do not ship code without tests. | **MUST** | Adding new validator → Write test in `tests/schema/validators.test.ts` |
| **Unclear Constraints** | Search for similar constraints in `constraints.md`. Apply same pattern. | **SHOULD** | Unsure of logging discipline → See §4 "STDIO Logging Discipline" |
| **Breaking Change Proposal** | Document change in work package. Flag for review. Never implement silently. | **MUST** | Changing MCP tool signature → Document breaking change + migration path |
| **Dependency Not in Tech Stack** | Check if dependency is transitive. If new, justify in work notes before adding. | **SHOULD** | Need `lodash` → Justify vs. native JS; update `tech-stack.md` if added |
| **Performance Concern** | Measure first. Optimize only if needed. Document tradeoffs. | **SHOULD** | Atomic writes feel slow → Measure latency before optimizing |
| **Legacy Code with No Tests** | Add characterization tests before modifying. Do not assume it works. | **SHOULD** | Modifying `file-lock.ts` → Add test to capture current behavior first |
| **Unclear Architecture Decision** | Search `tech-stack.md` for pattern rationale. Follow existing pattern. | **SHOULD** | Should I use class or function? → Check "Architectural Patterns" section |

### 🚦 Escalation Path

```
Issue Detected
    ↓
Can I resolve with manifest + constraints?
    ↓ YES → Proceed
    ↓ NO
    ↓
Is this a breaking change or architectural decision?
    ↓ YES → Pause and request user input
    ↓ NO
    ↓
Is this a missing manifest entry?
    ↓ YES → Draft entry + request Manifest Curator review
    ↓ NO
    ↓
Is this a bug or inconsistency?
    ↓ YES → Document in work package + flag for review
    ↓ NO
    ↓
Unclear → Pause and request user clarification
```

---

## 📊 Project Statistics

| Property | Value |
|----------|-------|
| **Project Name** | Project Ledger MCP Server |
| **Language** | TypeScript 5.7.2 (ES2022 target) |
| **Runtime** | Node.js (ESM) |
| **Architecture** | MCP Server with Repository Pattern |
| **Primary Pattern** | Schema-First Design (Zod) + Atomic Writes + File Locking |
| **Lines of Code** | ~2,000 (src/) |
| **Test Coverage** | ~85% (unit + integration) |
| **MCP Tools** | 22 registered tools |
| **Pipeline Types** | 6 (`implementation`, `qa`, `security-audit`, `code-review`, `release-engineering`, `documentation`) |
| **Agent Roles** | 9 (`Planner`, `Project Manager`, `Developer`, `QA`, `Security Auditor`, `Reviewer`, `Release Engineer`, `Documentation`, `Synthesis`) |
| **Dependencies** | 3 production, 4 development |

---

## 🔐 Critical Constraints (Know Before Coding)

These constraints are **non-negotiable**. Violating them will cause bugs or protocol failures.

| # | Constraint | Consequence of Violation |
|---|------------|--------------------------|
| 1 | All file I/O must use `atomicWriteJson()` | Readers see corrupt JSON / partial writes |
| 2 | Dual-file updates require `withLock()` | Race conditions + dual-file desync |
| 3 | `project_path` must be absolute | Server cannot resolve relative paths |
| 4 | Never log to `stdout` (use `stderr` only) | Breaks MCP protocol communication |
| 5 | Work package IDs match `/^WP-\d{3,}$/` | Schema validation fails |
| 6 | Timestamps use `now()` utility (YYYY-MM-DD HH:MM:SS) | Inconsistent format + parsing errors |
| 7 | JSON must be pretty-printed (2-space indent + newline) | Ugly diffs + manual editing pain |
| 8 | Status transitions follow legal transition table | Business rule violation + data corruption |
| 9 | `COMPLETE` requires all acceptance criteria met | Premature completion + false positives |
| 10 | Pipelines require `IN_PROGRESS` work package | Starting work before claiming |
| 11 | Pre-mutation state passed out of `updateWorkPackageWithSync` must use outer-scope `let` | TS2304 compile error + runtime ReferenceError at call site |
| 12 | All workflow logic must implement the Workflow Specification exactly | Spec drift → behavioral divergence → test false positives → production bugs |

**Memorize these constraints.** Reference [constraints.md](docs/agents/project-manifest/constraints.md) for full details.

---

## 🧭 Navigation Quick Reference

| I Need To... | Go Here |
|--------------|---------|
| Understand what this project does | [README.md](docs/agents/project-manifest/README.md) |
| Find where a file is located | [file-tree.md](docs/agents/project-manifest/file-tree.md) |
| Look up a method signature | [api-surface.md](docs/agents/project-manifest/api-surface.md) |
| Understand how data flows through system | [data-flows.md](docs/agents/project-manifest/data-flows.md) |
| Check architectural patterns | [tech-stack.md](docs/agents/project-manifest/tech-stack.md) |
| Verify a rule or constraint | [constraints.md](docs/agents/project-manifest/constraints.md) |
| See previous implementation notes | [docs/agents/implementation-history/](docs/agents/implementation-history/) |
| Understand workflow logic (state machines, routing, handoffs) | [Workflow Specification](docs/agents/workflow-specification/README.md) |

---

## 🤖 Agent-Specific Guidance

If you are operating in a **specific agent role**, consult the relevant persona document:

| Agent Role | VS Code Persona | Claude Code Persona | Focus |
|------------|-----------------|---------------------|-------|
| Planner | `/personas/ledger/vs-code/1-planner.md` | `/personas/ledger/claude-code/1-planner.md` | Breaking user requests into work packages |
| Project Manager | `/personas/ledger/vs-code/2-project-manager.md` | `/personas/ledger/claude-code/2-project-manager.md` | Creating work packages + dependency management |
| Developer | `/personas/ledger/vs-code/3-developer.md` | `/personas/ledger/claude-code/3-developer.md` | Implementation + pipeline execution |
| Validator (QA) | `/personas/ledger/vs-code/4-qa.md` | `/personas/ledger/claude-code/4-qa.md` | Testing + quality assurance |
| Security Auditor | `/personas/ledger/vs-code/5-security-auditor.md` | `/personas/ledger/claude-code/5-security-auditor.md` | Security review (stub — full content in Plan 2) |
| Reviewer | `/personas/ledger/vs-code/6-reviewer.md` | `/personas/ledger/claude-code/6-reviewer.md` | Code review + architecture validation |
| Release Engineer | `/personas/ledger/vs-code/7-release-engineer.md` | `/personas/ledger/claude-code/7-release-engineer.md` | Release validation (stub — full content in Plan 2) |
| Documentation | `/personas/ledger/vs-code/8-documentation.md` | `/personas/ledger/claude-code/8-documentation.md` | Manifest maintenance + README updates |
| Synthesis | `/personas/ledger/vs-code/9-synthesis.md` | `/personas/ledger/claude-code/9-synthesis.md` | Cross-session coordination + handoff |

---

**Version:** 1.0.0  
**Last Updated:** 2026-02-23  
**Maintained By:** Manifest Curator Agent
```