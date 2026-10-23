# AI Insights - Project Manifest Hub
<INSTRUCTION>
# AI Insights - Project Manifest Hub
Unified entry point linking all three module manifests (MCP server, personas, orchestrator), cross-system dependencies, shared infrastructure reference, and navigation guide.

</INSTRUCTION>
------------------------------------------------------------
_SOURCE: Unified entry point linking all module manifests, cross-system dependencies, and shared infrastructure_
# Unified entry point linking all module manifests, cross-system dependencies, and shared infrastructure
```
// Structure of documents
└── docs/
    └── agents/
        └── project-manifest/
            └── README.md
            └── cross-system-dependencies.md
            └── curation-log.md
            └── generated-artefacts.md
            └── root-tooling.md

```
###  Path: `/docs/agents/project-manifest/README.md`

```md
# Project Manifest — AI Insights Workspace

> **This is the unified entry point for understanding the AI Insights codebase.** Each sub-project maintains its own detailed manifest; this document provides workspace-level context and links everything together.

---

## Workspace Overview

AI Insights is a **monorepo-style workspace** containing three sub-projects and shared root-level tooling that together provide a multi-agent software development workflow:

| Sub-Project | Path | Language | Purpose |
|-------------|------|----------|---------|
| **Project Ledger MCP Server** | `mcp-server/` | TypeScript (ESM) | MCP server providing typed tools for managing project ledgers in AI agent workflows |
| **Ledger Personas Build System** | `personas/` | JavaScript (CJS) | Template engine that assembles persona Markdown files from YAML/Markdown sources |
| **Orchestrator** | `orchestrator/` | Python 3.11+ | LangGraph + Deep Agents headless pipeline executor — deterministic alternative to IDE-based workflows |

Root-level `scripts/` orchestrate cross-project operations. `shared/workflow-manifest.json` is the single source of truth for roles, pipelines, and status enums.

---

## Hub Documents

Documents that belong to the workspace hub itself, beside this index.

| Document | Purpose |
|----------|---------|
| [cross-system-dependencies.md](cross-system-dependencies.md) | Synchronisation points between sub-projects, root scripts and shared files, plus the validation commands that check them |
| [root-tooling.md](root-tooling.md) | Root-level scripts, shared libraries and shared configuration (`scripts/`, `shared/`, `context.yaml`) |
| [generated-artefacts.md](generated-artefacts.md) | Tracked and ignored generated files across the repository, what writes each, and when a modified copy can be discarded |
| [curation-log.md](curation-log.md) | Standing decisions about how this hub manifest is arranged, plus the dated trail of curation passes |

---

## Module Manifests

Each sub-project has its own detailed manifest following a consistent structure:

### MCP Server

**Location:** [`mcp-server/docs/agents/project-manifest/`](../../../mcp-server/docs/agents/project-manifest/README.md)

| Document | Purpose |
|----------|---------|
| [README.md](../../../mcp-server/docs/agents/project-manifest/README.md) | Project overview, MCP server purpose, development commands |
| [tech-stack.md](../../../mcp-server/docs/agents/project-manifest/tech-stack.md) | TypeScript runtime, Zod, MCP SDK, architectural patterns |
| [constraints.md](../../../mcp-server/docs/agents/project-manifest/constraints.md) | **Core** — atomic writes, file locking, STDIO discipline, schema rules, manifest authoring |
| [constraints-workflow.md](../../../mcp-server/docs/agents/project-manifest/constraints-workflow.md) | Status transitions, claiming, pipelines, handoffs, workflow gotchas |
| [constraints-testing.md](../../../mcp-server/docs/agents/project-manifest/constraints-testing.md) | Test isolation, fixtures, helper mandate, mocking policy |
| [constraints-code-style.md](../../../mcp-server/docs/agents/project-manifest/constraints-code-style.md) | Naming, loops, compiler strictness, JSDoc, Zod schema shape |
| [constraints-storage.md](../../../mcp-server/docs/agents/project-manifest/constraints-storage.md) | Knowledge store, multi-store architecture, known limitations |
| [file-tree.md](../../../mcp-server/docs/agents/project-manifest/file-tree.md) | Annotated directory structure for mcp-server/ |
| [api-surface.md](../../../mcp-server/docs/agents/project-manifest/api-surface.md) | MCP tools, LedgerStore class, utility functions |
| [data-flows.md](../../../mcp-server/docs/agents/project-manifest/data-flows.md) | Initialization, pipeline execution, handoff, detection flows |

**See also:** [Workflow Specification](../../../mcp-server/docs/agents/workflow-specification/README.md) — state machines, routing, handoffs, and edge cases.

### MCP Server GUI

**Location:** [`mcp-server/gui/docs/agents/project-manifest/`](../../../mcp-server/gui/docs/agents/project-manifest/README.md)

The GUI maintains its own manifest for the vanilla-JS frontend and the standalone HTTP server.
Changes under `mcp-server/gui/` are documented here, not in the MCP server manifest.

| Document | Purpose |
|----------|---------|
| [README.md](../../../mcp-server/gui/docs/agents/project-manifest/README.md) | GUI manifest hub |
| [constraints.md](../../../mcp-server/gui/docs/agents/project-manifest/constraints.md) | No-build-step rule, ES5 frontend, routing, security headers, route table, port convention |
| [api-surface.md](../../../mcp-server/gui/docs/agents/project-manifest/api-surface.md) | REST routes and handler signatures |
| [data-flows.md](../../../mcp-server/gui/docs/agents/project-manifest/data-flows.md) | Request dispatch, polling, rendering flows |
| [ui-components.md](../../../mcp-server/gui/docs/agents/project-manifest/ui-components.md) | View and widget inventory |
| [file-tree.md](../../../mcp-server/gui/docs/agents/project-manifest/file-tree.md) | Annotated directory structure for gui/ |

### Personas

**Location:** [`personas/docs/agents/project-manifest/`](../../../personas/docs/agents/project-manifest/README.md)

| Document | Purpose |
|----------|---------|
| [README.md](../../../personas/docs/agents/project-manifest/README.md) | Build system overview, quick reference commands |
| [tech-stack.md](../../../personas/docs/agents/project-manifest/tech-stack.md) | Node.js runtime, js-yaml, template engine patterns |
| [api-surface.md](../../../personas/docs/agents/project-manifest/api-surface.md) | Build script functions, template syntax, metadata schema, MCP tool allocation matrix |
| [data-flows.md](../../../personas/docs/agents/project-manifest/data-flows.md) | Build pipeline, sync pipeline, template resolution |
| [constraints.md](../../../personas/docs/agents/project-manifest/constraints.md) | Core rules: source editing, naming, versioning, safety guards |
| [constraints-build-system.md](../../../personas/docs/agents/project-manifest/constraints-build-system.md) | Template engine, build flags, log conventions, sync script rules |
| [constraints-cross-system.md](../../../personas/docs/agents/project-manifest/constraints-cross-system.md) | Synchronization contracts with MCP server and Agent Registry |

### Orchestrator

**Location:** [`orchestrator/docs/agents/project-manifest/`](../../../orchestrator/docs/agents/project-manifest/README.md)

| Document | Purpose |
|----------|---------|
| [README.md](../../../orchestrator/docs/agents/project-manifest/README.md) | Orchestrator manifest hub — links to topic-specific docs |
| [constraints.md](../../../orchestrator/docs/agents/project-manifest/constraints.md) | Prompt architecture, supervisor routing, LangGraph specifics, storage paths |
| [decisions.md](../../../orchestrator/docs/agents/project-manifest/decisions.md) | Rejected alternatives and IDE/orchestrator divergences |
| [architecture.md](../../../orchestrator/docs/architecture.md) | Stage nodes, MCP tool wrapping, workflow state management |
| [supervisor-routing.md](../../../orchestrator/docs/supervisor-routing.md) | Deterministic supervisor dispatch model |
| [public-api.md](../../../orchestrator/docs/public-api.md) | CLI, graph construction, supervisor, and utility entry points |
| [jsonl-log-schema.md](../../../orchestrator/docs/jsonl-log-schema.md) | Run log field reference |
| [smoke-testing.md](../../../orchestrator/docs/smoke-testing.md) | Dispatch loop verification runbook |

---

## Cross-System Dependencies

The synchronisation points that span sub-projects, and the validation scripts that check them, are in [cross-system-dependencies.md](cross-system-dependencies.md). Breaking any of them causes silent failures.

---

## Shared Infrastructure

The root-level scripts, `shared/workflow-manifest.json` and its schema, and `context.yaml` are inventoried in [root-tooling.md](root-tooling.md).

---

## Generated Context (`.context/`)

The `.context/` directory contains auto-generated Markdown snapshots of the entire codebase, produced by the CTX Generator via `node scripts/cli.js ctx-generate`. These files are tracked in VCS and ideal for feeding into LLMs or external tools.

| Path | Contents |
|------|----------|
| `.context/README.md` | Workspace overview |
| `.context/workspace-structure.md` | Top-level directory tree |
| `.context/scripts.md` | All workspace scripts source |
| `.context/shared-manifest.md` | `workflow-manifest.json` + schema |
| `.context/mcp-server/…` | MCP server overview, manifest, source, tests, file tree |
| `.context/orchestrator/…` | Orchestrator overview, docs, source, tests, file tree |
| `.context/personas/…` | Personas overview, manifest, metadata, partials, file tree |

---

## Navigation Quick Reference

| I Need To… | Go Here |
|------------|---------|
| Understand the whole workspace | [README.md](../../../README.md) |
| Look up a cross-system sync point | [Cross-System Dependencies](cross-system-dependencies.md) |
| Find a root-level script | [Root-Level Tooling](root-tooling.md) |
| Understand how agents should operate | [AGENTS.md](../../../AGENTS.md) |
| Look up an MCP tool signature | [MCP server api-surface.md](../../../mcp-server/docs/agents/project-manifest/api-surface.md) |
| Look up template syntax | [Personas api-surface.md](../../../personas/docs/agents/project-manifest/api-surface.md) |
| Find a file in mcp-server | [MCP server file-tree.md](../../../mcp-server/docs/agents/project-manifest/file-tree.md) |
| Understand workflow state machines | [Workflow Specification](../../../mcp-server/docs/agents/workflow-specification/README.md) |
| Understand orchestrator routing | [Supervisor Routing](../../../orchestrator/docs/supervisor-routing.md) |
| Browse agent reference docs | [References Index](../references/README.md) |
| Understand the ledger agent workflow | [Ledger Suite Guide](../../../personas/ledger/README.md) |
| See an end-to-end visual workflow map | [Ledger Workflow Visual Guide](../references/ledger-workflow-visual-guide.md) |
| Review deferred implementation decisions | [Deferred Topics](../deferred-topics.md) |
| Get a full codebase snapshot | `.context/` (run `node scripts/cli.js ctx-generate`) |

```
###  Path: `/docs/agents/project-manifest/cross-system-dependencies.md`

```md
# Cross-System Dependencies

The synchronisation points that span sub-projects, root-level scripts and shared files. Each row names a source of truth and the places that must stay aligned with it. Breaking any of them causes silent failures: nothing crashes at the point of the change, and the divergence surfaces later as a wrong agent name, a missing file or a stale schema.

This document describes the dependencies. The binding rules for the module that owns each side live in that module's `constraints*.md`, linked from the [hub index](README.md).

## Dependency Table

| Dependency | Source of Truth | Must Stay In Sync With |
|------------|----------------|------------------------|
| Agent role names | `shared/workflow-manifest.json` → `roles[].name` | `mcp-server/src/utils/constants.ts` → `AGENT_ROLES` (auto-derived); `scripts/sync-personas.js` → `KNOWN_ROLES` (auto-derived); persona YAML → `role` field (validated by `build-personas.js`) |
| MCP server name | `personas/ledger/src/meta/_shared.yaml` → `mcp_server_name` | `scripts/install-mcp-global.js` → `central_pm` hardcoded in VS Code merge, Claude Code `mcp add`, and `uninstall` calls; changing the server name requires updating this script |
| Persona `vs_file_name` | Per-persona YAML (`personas/ledger/src/meta/N-name.yaml`) | Agent Registry scan pattern (`*.agent.md`) in `mcp-server/src/utils/agent-registry.ts` |
| Agent name mapping | Persona YAML of all three suites, read by `scripts/lib/name-mapping.js`: ledger `personas/ledger/src/meta/` (`N-*.yaml` → `role`, `number`, `id`, `changelog` (version source — `version` and `last_updated` are auto-derived from its first entry; never add standalone `version:` or `last_updated:` fields), `cc_file_name`, `vs_file_name`, `da_file_name`; `_shared.yaml` → `default_version` (fallback for personas without a `changelog` entry) and the default model); the `standalone` and `ledger-support` `src/meta/` directories (each with an optional `_shared.yaml` supplying `default_model_slug`); plus the model registry in `personas/model-registry/` (model fields) | `personas/name-mapping.json` (written by `writeNameMapping()` in `scripts/lib/name-mapping.js`, which `scripts/build-personas.js` calls after every real build — never under `--check` / `--dry-run`; entry fields per [`api-surface.md` → `name-mapping.json` — All Suites](personas/docs/agents/project-manifest/api-surface.md#name-mappingjson--all-suites); must be regenerated when persona YAML naming fields change; checked into Git — staleness is visible in diffs); consumed by `mcp-server/src/utils/constants.ts` → `AGENT_NAMES` constant at startup |
| Version (MCP server) | `mcp-server/changelog.md` | `mcp-server/package.json` (via `npm run sync-version`) |
| Version (Personas) | `personas/changelog.md` | `personas/ledger/src/meta/_shared.yaml` → `default_version` |
| Version (Workspace root) | `changelog.md` (root) | Root `package.json` → `version` field, synced by `syncRootVersion()` in `scripts/cli.js` (runs during `node scripts/cli.js build-maintain`); validated by `scripts/check-version-sync.js` (`root` module entry) |
| Orchestrator MCP server command | `orchestrator/src/config.py` → `load_config()` → `mcp_server_cmd` (hardcoded default `node <workspace>/mcp-server/dist/index.js`; no environment-variable override) | Matches `mcp-server/` build output (`dist/index.js`) |
| Orchestrator persona files | `orchestrator/src/config.py` → `PERSONA_FILES` dict | `personas/ledger/deep-agents/` generated output filenames (via `persona_file_deep_agents` in `shared/workflow-manifest.json` roles) |
| Orchestrator subagent files | Ledger persona YAML `subagents` field (e.g. `personas/ledger/src/meta/2-project-manager.yaml`) | `personas/ledger-support/src/meta/{slug}.yaml` first, then `personas/standalone/src/meta/{slug}.yaml` (for `description`); similarly `personas/ledger-support/deep-agents/{slug}.md` first, then `personas/standalone/deep-agents/{slug}.md` (for `system_prompt`); derived at startup by `load_subagents()` in `orchestrator/src/utils/subagents.py` — no manual config needed |
| Orchestrator model slugs | `personas/ledger/src/meta/_shared.yaml` → `default_model_slug`; per-persona `N-*.yaml` → `model_slug` | `orchestrator/src/utils/persona_models.py` → `extract_persona_model_slugs()` (reads YAML at startup); `orchestrator/src/config.py` → `Config.stage_models` (populated by loader); per-stage `model` field in `stage_start`, `stage_complete`, `stage_error` JSONL entries |
| Deep Agents tool availability | `deepagents` built-in suite (`create_deep_agent()`) + the `tools=` argument at `orchestrator/src/nodes/__init__.py` | **Not** persona YAML `tools:` / `cc_tools:` / `da_tools:` — those govern VS Code and Claude Code only. The `deep-agents` frontmatter template emits no tools field. Changing a persona's declared tools has zero effect on the Deep Agents target. See `orchestrator/docs/architecture.md` § Built-in Tool Suite. |
| Workflow logic (state machines, routing maps, handoff logic, edge cases) | `mcp-server/docs/agents/workflow-specification/` | `mcp-server/src/` (TypeScript implementation), `orchestrator/src/` (Python implementation), `mcp-server/tests/` (test assertions) |
| `security-audit` pipeline → Security Auditor role | `mcp-server/src/utils/pipeline-maps.ts` → `PIPELINE_AGENT_MAP['security-audit']` | `personas/ledger/src/meta/5-security-auditor.yaml` → `role: Security Auditor`; `mcp-server/src/utils/constants.ts` → `AGENT_ROLES` |
| `release-engineering` pipeline → Release Engineer role | `mcp-server/src/utils/pipeline-maps.ts` → `PIPELINE_AGENT_MAP['release-engineering']` | `personas/ledger/src/meta/7-release-engineer.yaml` → `role: Release Engineer`; `mcp-server/src/utils/constants.ts` → `AGENT_ROLES` |
| Storage layout version | `mcp-server/src/storage/migrate-namespaced.ts` → `STORAGE_VERSION` constant | `mcp-server/src/storage/ledger-store.ts` (`LedgerStore`) — reads/writes `{ledgerRoot}/{repoName}/{slug}/`; `mcp-server/gui/api.ts` — `handleListProjects`, `handleGetProject`, and related handlers; `mcp-server/gui/server.ts` — static-file serving for ledger artefacts; `mcp-server/src/gui/handlers/run-log-handlers.ts` — constructs run-log paths; `orchestrator/src/cli.py` — log-copy path (`plan_dir.parents[3].name or "unknown"` → `{repo_name}/{slug}/orchestrator/logs/`) |
| `.orchestrator-run.json` sidecar | `orchestrator/src/cli.py` → `_write_run_metadata()` | `mcp-server/gui/api.ts` → `handleGetRunMetadata()` (reads the file and returns it as JSON); `mcp-server/gui/public/api-client.js` → `getRunMetadata(slug)` (client-side consumer); `mcp-server/gui/public/views/project-detail.js` (resume-button rendering and click handler); fields: `thread_id`, `plan_path`, `slug`, `started_at`, `is_resume`, `dry_run`, `log_filename`, `pid`, `result` (null while running → SUCCESS/INTERRUPTED/ERROR), `error`, `duration_s` |
| Changelogs | Root `changelog.md` (Git-tagged releases) | `mcp-server/changelog.md`, `orchestrator/changelog.md`, `personas/changelog.md` (module-level detail, not tagged). Root entry references module versions via `> mcp vX · personas vY · orchestrator vZ`. |
| Published artifacts (external consumers) | `personas/docs/persona-design-guide.md` (carries a `**License:**` / `**Author:**` / `**Source:**` header); `personas/standalone/src/content/persona-curator.md` | Fetched over HTTPS by unrelated downstream projects — `nexus-personas` (`scripts/sync-persona-design-guide.js` + a scheduled Gitea Actions workflow), with local copies in `hcp-editor` and `nexus-plugins`. Downstream overwrites its copy on every sync and treats it as read-only, so project-specific content added here cannot be removed downstream. Downstream suites cover non-coding domains, so both files stay domain-neutral; this project's own principle vocabulary and conventions live in `personas/docs/agents/project-manifest/constraints.md` (C5c, C5d). Top-level headings are an anchor contract — `nexus-personas` injects a partial keyed on the literal `\n\n## Operating Philosophy\n` and hard-errors when it is absent. |
| Knowledge Collection (Synthesis persona) | `personas/shared/partials/synthesis-knowledge-collection.md` | `mcp-server/src/tools/knowledge.ts` → `ledger_add_insight`, `ledger_search_insights` (tools the Synthesis persona calls); `personas/ledger/src/meta/9-synthesis.yaml` → `mcp_tools` array (must list both tools for IDE persona tool tables). The `.knowledge/` store lives at `{ledgerRoot}/.knowledge/` — same ledger root as all other ledger operations. Insights use `scope: 'global'` (cross-repository knowledge) or `scope: 'repository'` (codebase-level knowledge stored in `{repository_name}-insights.json`). There is no `'project'` scope. |
| Model Registry | `personas/model-registry/` files: `default.json` (shipped defaults, Git-tracked), `local.json` (user-registered models, gitignored, auto-created on first access), `assignments.json` (per-persona UUID assignments + default model, gitignored, auto-created on first access) | GUI API (`mcp-server/gui/api-models.ts`) — CRUD handlers for models, assignments, replace-model, and persona rebuild; `mcp-server/src/gui/model-registry.ts` — file I/O layer (`readModels`, `writeModels`, `readAssignments`, `writeAssignments`, `loadDefaults`, `getResolvedAssignments`); Orchestrator consumption (`orchestrator/src/utils/persona_models.py` → `extract_persona_model_slugs()` reads YAML at startup for per-stage model selection); build system consumption (`scripts/build-personas.js` generates `personas/name-mapping.json` which `PUT /api/model-assignments` validates persona IDs against). UUID-based assignment keys ensure slug renames do not cascade into `assignments.json`. |
| `project_summary` field | `ledger_initialize_project` → `InitializeProjectSchema.project_summary` (tool parameter, `z.string().trim().min(1).optional()`); `ledger_import_standalone` → `ImportStandaloneSchema.project_summary` (same constraints — optional, trim().min(1), key-presence semantics) | `mcp-server/src/tools/project-lifecycle.ts` → spreads into root index + `writeProjectMeta()` enrichment call; `mcp-server/src/tools/standalone-import.ts` → key-presence spread through `importStandalone()` → `LedgerStore.importStandaloneProject()` → root index and auto-synced to `.meta.json` via `writeRootIndex()`; `mcp-server/src/schema/root-index.ts` → `RootIndexSchema.project_summary` (storage, `.nullable().optional()`); `mcp-server/src/schema/project-meta.ts` → `ProjectMetaSchema.project_summary` (storage, `.nullable().optional()`); `mcp-server/gui/public/views/project-detail.js` → `.plan-synopsis` IIFE prefers `project_summary` over `extractSynopsis()` when set. `personas/ledger-support/src/content/ledger-bootstrapper.md` → Step 2 of the Bootstrapping Protocol (the agent-side implementation: reads the plan's `## Summary` section, crafts a 2–3 sentence plain-text summary, and passes it as `project_summary` to `ledger_initialize_project`; changing the field's constraints — min length, formatting rules — requires updating this step). `personas/ledger-support/src/content/ledger-synthesis-maintainer.md` → Workflow — Archive Mode, Step 1 (the equivalent agent-side implementation for standalone imports: reads the plan's `## Summary` section, crafts a 2–3 sentence plain-text summary, and passes it as `project_summary` to `ledger_import_standalone`; skip guards apply when `## Summary` is absent or too brief; changing the field's constraints requires updating this step as well). |
| `outcome_summary` field | `ledger_import_standalone` → `ImportStandaloneSchema.outcome_summary` and `ledger_update_synthesis` → `UpdateSynthesisSchema.outcome_summary` (tool parameters, `z.string().trim().min(10).optional()`); `ledger_complete_synthesis` → `CompleteSynthesisSchema.outcome_summary` (required, `.min(10)`) for ledger-workflow projects | `mcp-server/src/tools/standalone-import.ts` → `importStandalone()` resolves `args.outcome_summary ?? parseOutcomeSummary(synthesisContent)`, while `updateSynthesis()` adds a third term inside its lock — `… ?? rootIndex.outcome_summary ?? null` — so a refresh can set or replace a summary but never clears one it cannot replace; a supplied value is stored verbatim in both and the document is only parsed as a fallback; `mcp-server/src/utils/synthesis-parser.ts` → `parseOutcomeSummary()` (the fallback — matches an `Outcome Summary` heading, then the first `Implementation Summary` bullet, else `null`); `mcp-server/src/schema/root-index.ts` → `RootIndexSchema.outcome_summary` (storage, `.nullable().optional()`); `mcp-server/src/schema/project-meta.ts` → `ProjectMetaSchema.outcome_summary` (storage, auto-synced by `writeRootIndex()`); `scripts/import-standalone.js` → batch imports with no agent in the loop, which is why the parameter must stay optional. `personas/ledger-support/src/content/ledger-synthesis-maintainer.md` and `personas/ledger/src/content/9-synthesis.md` → the agent-side implementations that compose the value; the heading a synthesis document uses is no longer a contract, so summary length and content are tuned in the persona sources rather than in the parser. Changing the 10-character floor requires updating both persona files and `ledger_complete_synthesis`, which writes the same stored field. |
| `title` field (project display title) | `ledger_initialize_project` → `InitializeProjectSchema.title` (tool parameter, `z.string().trim().min(1).max(200).optional()`); `ledger_import_standalone` → `ImportStandaloneSchema.title` (same constraints) | `mcp-server/src/schema/root-index.ts` → `RootIndexSchema.title` (storage, `.nullable().optional()`, same shape as `project_summary`) — this is now the primary write path; `mcp-server/src/storage/ledger-store.ts` → `writeRootIndex()` auto-syncs `validated.title` into `.meta.json` via `MetaCacheUpdates.title?: string` (non-nullable; uses `!== undefined` semantics, not `'key' in cacheUpdates` — no "clear title" use case; a theoretical `null` from the nullable root-index field is coalesced to `undefined`, i.e. skipped, at the sync call site); `initializeProject()` spreads `title` into the root index object (plus the pre-existing enrichment-cache `writeProjectMeta()` call, kept for parity with `project_summary`); `importStandaloneProject()` spreads `title` into the root index object — the dedicated `updateTitle()` call after `writeRootIndex()` was removed, since the auto-sync now covers it (the ordering constraint this comment used to describe no longer applies to standalone import; `updateTitle()` remains in use only by the GUI rename flow, `handleRenameProject`); `mcp-server/src/schema/project-meta.ts` → `ProjectMetaSchema.title` (storage, `z.string().optional()`); `mcp-server/gui/api.ts` → `handleListProjects` / `handleGetProject`: `meta.title` takes precedence over slug-derived title-casing when set. Persona agents (Ledger Bootstrapper, Synthesis Maintainer) should pass a curated `title` alongside `project_summary` when calling these tools — the title should be a human-readable label like `"API: Split GetTenants"` or `"Cross-Platform Plugin Phase 3B"` that no slug pattern-matcher could generate. Changing the field's constraints (min/max) requires updating both persona instructions. |
| Agents overview document | Persona YAML overview fields (`identity`, `use_when`, `key_behavior`, `modes`, `inputs`, `outputs`, `notes`) across all three suites | `docs/references/agents-overview.md` — generated by `scripts/generate-agents-overview.js`; must be regenerated after changing any overview field. Field `identity` is required in every persona YAML (all suites). Fields `use_when` (standalone/support), `inputs`/`outputs` (ledger), `key_behavior` and `modes` (where applicable) must be kept current with the persona's actual behavior. `scripts/templates/agents-overview-header.md` contains the static intro text prepended to every generated document. |
| Insight mutation ownership | `personas/shared/partials/knowledge-ownership.md` | `mcp-server/src/tools/knowledge.ts` → `ledger_update_insight`, `ledger_delete_insight` (granted only to the Knowledge Curator) and `ledger_add_insight` (granted only to the Knowledge Archiver). Consuming personas: `personas/ledger/src/content/1-planner.md`, `personas/ledger/src/content/9-synthesis.md`, `personas/standalone/src/content/developer.md`. The Planner emits a `## Knowledge Base Reconciliation` plan section (template in `personas/shared/partials/planner-output-template.md`, gated on `has_mcp`); the Synthesis and Standalone Developer personas dispatch `ledger-knowledge-curator` in Targeted Reconciliation mode against it, and both declare it in their YAML `subagents`. `personas/ledger-support/src/content/ledger-synthesis-maintainer.md` carries the matching decline-and-redirect constraint. Granting an insight-write tool to any further persona requires updating this partial and the Curator's mode table. |
| `insight_agent` / `role` coupling | Per-persona YAML `insight_agent` field (standalone: `personas/standalone/src/meta/*.yaml`) | `role` field in the same YAML (identity check exempt for standalone personas without `role`); `personas/shared/partials/insight-capture.md` → `{{insight_agent}}` substitution; `personas/shared/partials/insight-compilation.md` → `{{insight_agent}}` filter; `insight_report_target` must be declared as a pair with `insight_agent`. Validated by `scripts/build-personas.js` via `scripts/lib/insight-validation.js`. Ledger personas (agents 3–6, 8) no longer use `insight_agent` — they use `insight_pipeline_type` with `personas/shared/partials/mcp-insight-capture.md` instead, routing observations through `ledger_add_observation`. |
| `stores.json` location | `~/.ai-insights/stores.json` (user-level) | `mcp-server/src/storage/store-registry.ts` → `resolveStoresConfigPath()` (defines the path); `mcp-server/src/index.ts` and `gui/server.ts` → `loadStoresConfig()` at startup (each process loads independently); `scripts/lib/store-commands.js` → CLI `store` subcommands read/write this file; `orchestrator/src/utils/store_resolution.py` → `resolve_store_for_repo()` reads `stores.json` at call time to determine the owning store path for each repository (stdlib-only; no server dependency); changing the file name or location requires updating all callers. Absence of this file activates backward-compatible single-store mode — no error, no migration. |
| Per-store `.repositories.json` | Each configured store's `{storePath}/.repositories.json` | `mcp-server/src/storage/repository-registry.ts` → `loadRegistry(storePath)` / `saveRegistry(storePath, data)` (all reads and writes pass an explicit `storePath`); `mcp-server/gui/api-repos.ts` → `handleCreateRepo()`, `handleGetRepo()`, `handleUpdateRepo()`, `handleDeleteRepo()`, `handleMoveRepo()` (`handleMoveRepo()` moves an entry between two stores via atomic source-remove + target-add — multi-store only, rejects in single-store mode; all others use `findEntryInStores()` to locate the owning store in multi-store mode); `mcp-server/src/storage/store-router.ts` → `resolveStoreForWrite()` (reads every store's registry to determine ownership via store-order priority); `mcp-server/src/storage/multi-store-manager.ts` → `getMergedRegistry()` / `getRegistryConflicts()` (reads all stores' registries for collation); `orchestrator/src/utils/store_resolution.py` → `resolve_store_for_repo()` reads each store's `.repositories.json` to find the owning store for a given repo name (same store-order priority logic as `StoreRouter.resolveStoreForWrite()`); in legacy single-store mode this file lives at `{ledgerRoot}/.repositories.json` — unchanged from before the multi-store plan. |

## Validation Scripts

Commands that check some of the dependencies above.

| Script | Purpose | Run From |
|--------|---------|----------|
| `node scripts/validate-workflow-manifest.js` | Validate `shared/workflow-manifest.json` structure and semantics | Workspace root |
| `node scripts/check-known-roles.js` | Delegates to `validate-workflow-manifest.js` (previously compared `KNOWN_ROLES` ↔ `AGENT_ROLES`; now both are manifest-derived) | Workspace root |
| `node scripts/build-personas.js --check` (`--dry-run` is an alias) | Render every persona in memory and write nothing; fails only on error-severity validation results. It never compares against files on disk, so it does not detect stale generated output | Workspace root |

```
###  Path: `/docs/agents/project-manifest/curation-log.md`

```md
# Curation Log

Why this manifest looks the way it does, and when it was last verified.
Read freely — Standing Decisions explains the deliberate gaps and conventions.
Written by the Manifest Curator only; no other agent edits this file.

This log covers the workspace hub manifest (`docs/agents/project-manifest/`) only. Each module manifest keeps its own log beside it.

## Standing Decisions

| Date | Decision | Rationale |
|---|---|---|
| 2026-10-16 | The workspace hub manifest is treated as its own tool and keeps its own `curation-log.md`, separate from the personas manifest's log. Before this log existed, hub edits were recorded in the personas log. | Decided by the user (recorded in `docs/agents/projects/personas-snapshot.md`). The hub spans every sub-project, so its verification history cannot be inferred from any one module's log. |
| 2026-10-23 | The rule that a commit outside a feature branch opens with a fresh Build & Maintain run (`node scripts/cli.js build-maintain`) is a project-level constraint of this repository. It is deliberately kept out of the Git Committer persona (`personas/standalone/src/content/git-committer.md`), which does not enforce it and stays the authority for the feature-branch practice only. The rule is recorded in Purpose and Branch Policy of the hub's `generated-artefacts.md` (formerly also in a personas copy, since merged; see the 2026-10-23 consolidation decision). | Decided by the owner. The Git Committer persona is used in other workspaces where a build-first step does not apply, so the rule lives in this project's documents instead. |
| 2026-10-23 | Generated-artefact documentation for the repository is one file, the hub's `docs/agents/project-manifest/generated-artefacts.md`. The personas manifest no longer carries its own copy; its `README.md` and `constraints.md` link to the hub file, and its `constraints.md` → Generated Artefacts section stays as the binding rules. Each table carries a *Source* column naming the owning module, and the former *Source* column (the inputs a file is built from) is now *Derived from*. The `mcp-server` and `orchestrator` manifests no longer keep module-scoped documents either; see the 2026-10-23 decision on module copies below. | Decided by the owner. Two documents that were meant to agree needed every edit made twice and drifted; a single file is cheaper to keep correct. |
| 2026-10-23 | The hub's `generated-artefacts.md` also covers the MCP server and the orchestrator; neither `mcp-server/docs/agents/project-manifest/` nor `orchestrator/docs/agents/project-manifest/` holds a copy, and their `README.md` and `constraints.md` link to the hub file. The `mcp-server/coverage/**` Vitest report is a temporary file that is not meant to be tracked; its row records that and that the repository still tracks it until the owner untracks it. The *Source* / *Derived from* column split is approved. | Decided by the owner, who had assumed the unification included every file. One document per repository avoids edits made in several places; the coverage report is regenerated output that nothing reads. |
| 2026-10-23 | `mcp-server/coverage/` (Vitest's HTML, clover and JSON coverage report) is untracked and ignored through the root `.gitignore` entry `/mcp-server/coverage/`. It is listed under Ignored Generated Artefacts in `generated-artefacts.md` and carries no Known Contradictions entry. This supersedes the clause in the preceding decision that the repository still tracks it. | Decided by the owner, who untracked the folder and added the ignore rule: the report is a temporary file, regenerated by `npm run test:coverage`, and nothing reads it. |

## History

### 2026-10-23 · Update · Curator v1.8.0

**Scope:** Narrow, by instruction: the owner's untracking of `mcp-server/coverage/`, in `generated-artefacts.md` and the module manifests. Not a full reconcile.
**Commit:** 2d4220a3 (working tree held uncommitted changes, including earlier same-day manifest edits)
**Changes:** Moved the `mcp-server/coverage/` row from Tracked Generated Artefacts to Ignored Generated Artefacts (Source MCP Server, regenerate with `npm run test:coverage`; Vitest's default HTML, clover and JSON report). Removed the coverage Known Contradictions entry. The `npm run test:coverage` command row now says it rewrites the ignored tree. Removed the coverage example from the `mcp-server` `constraints.md` → Generated Artefacts drift bullet. Added a Standing Decision.
**Notes:** Verified: `git ls-files mcp-server/coverage` returns nothing and `git check-ignore -v` matches `.gitignore:3`. A grep of all module manifests found no other text claiming the report is tracked, apart from older History entries, which are left as written. Findings for later stages: root `AGENTS.md` and its Project Statistics need no change (they do not mention the report); `.context/` output is stale for the changed hub document and `mcp-server/docs/agents/project-manifest/constraints.md` and needs regeneration by the CTX stage (owner: CTX Architect, stage 4 still to come; not run here). The reverted-decision search, changed-code intersection and adjacent-document check were not run, by the brief's scope.

### 2026-10-23 · Update · Curator v1.8.0

**Scope:** Narrow, by instruction: merge the `mcp-server` and `orchestrator` `generated-artefacts.md` into the hub document, delete both module copies, and repoint links. Not a full reconcile.
**Commit:** 2d4220a3 (working tree held uncommitted changes, including earlier same-day manifest edits)
**Changes:** The hub `generated-artefacts.md` now covers the whole repository. Added the `mcp-server/package.json` and `orchestrator/pyproject.toml` version-field runtime-coupled rows; kept the `mcp-server/coverage/**` row and rewrote its verdict (temporary report, owner does not intend it to be tracked; discard always, unsafe never for content). Merged the module ignored-artefact rows (MCP dist and node_modules, orchestrator checkpoints, logs, run queue, plan-directory run metadata, ledger storage copy, venv and caches) into a table that now has a *Source* column. Merged the module hand-maintained neighbours and the `npm test`, `npm run dev`, `npm run test:coverage`, `orchestrate` and `pytest` command rows. Added a Known Contradictions entry for the tracked coverage report and a note that module `.context/**` output follows the `.context/**` row. Rewrote the intro to name the three constraints sections as the binding rules. Deleted both module copies; repointed the module `README.md` index rows and `constraints.md` preambles and bullets. Hub `README.md` and `root-tooling.md` links already pointed at the hub file and needed no change.
**Notes:** Verified against `git ls-files` and `.gitignore`: `mcp-server/coverage/` is tracked and neither the root nor `mcp-server/.gitignore` ignores it; no ignore rule was added. The `mcp-server/package.json` and `orchestrator/pyproject.toml` rows carried over from the module documents without re-derivation beyond the `.gitignore` checks. Two `TODO: verify` markers remain in the hub document (`orchestrator/requirements.txt` origin, `pytest` test isolation). The reverted-decision search, changed-code intersection and adjacent-document check were not run, by the brief's scope. Findings for later stages: root `AGENTS.md` (owner: AGENTS.md Curator, stage 2 still to come) should state that the hub document covers the MCP server and orchestrator too and that the module manifests hold no copy, and its Manifest Maintenance rows for those modules need no `generated-artefacts.md` entry; `context.yaml` and `mcp-server/module-context.yaml` / `orchestrator/module-context.yaml` (owner: CTX Architect, stage 4 still to come) may import the deleted module files, so the generated `.context/mcp-server/` and `.context/orchestrator/` manifest bundles should be checked and regenerated; `.context/` is not yet regenerated. No persona source under `personas/standalone/src/` names the removed module files by path. The coverage report's untracking is an owner action for a later commit.

### 2026-10-23 · Update · Curator v1.8.0

**Scope:** Narrow, by instruction: merge the personas `generated-artefacts.md` into the hub `generated-artefacts.md`, delete the personas copy, and repoint manifest links. Not a full reconcile.
**Commit:** 2d4220a3 (working tree held uncommitted changes, including earlier same-day manifest edits)
**Changes:** The hub `generated-artefacts.md` is now the single document. Carried over from the personas copy: the richer name-mapping row (writer, inputs, loader, branch verdicts), the branch-scoped `.context/**` verdicts, the full pre-commit hook description, the personas-only hand-maintained neighbours (`.gitkeep` files, suite READMEs, `personas/package.json`), the `build-personas.js` command row and the `package-personas` and `sync-personas` details, and the full Known Contradictions text. Added a *Source* column naming the owning module to both tracked tables and renamed the old *Source* column *Derived from*. Removed the "two documents are meant to agree" wording and pointed the intro at the personas `constraints.md` → Generated Artefacts section. Conflicts were settled against the code: the pre-commit hook text against `.githooks/pre-commit`, the skills sync against `scripts/sync-personas.js` (`.claude/skills/` to `~/.claude/skills/`), and the `TARGETS` list against `scripts/package-personas.js`. Added the consolidation Standing Decision and reworded the build-first Standing Decision, which named a personas copy that no longer exists.
**Notes:** The reverted-decision search, changed-code intersection and adjacent-document check were not run, by the brief's scope. Findings for later stages: root `AGENTS.md` (owner: AGENTS.md Curator, stage 2 still to come) should route generated-file questions to the hub document only and no longer mention a personas copy; `context.yaml` and the module `module-context.yaml` files (owner: CTX Architect, stage 4 still to come) should be checked because `.context/personas/manifest.md` and sibling bundles import the deleted personas `generated-artefacts.md`, and `.context/` is not yet regenerated. The `mcp-server` and `orchestrator` generated-artefacts documents were left in place and their links to the hub still resolve.

### 2026-10-23 · Update · Curator v1.8.0

**Scope:** Narrow, by instruction: record the build-first rule already added to Purpose and Branch Policy in `generated-artefacts.md`, and the Standing Decision on where it lives. Not a full reconcile.
**Commit:** 2d4220a3
**Changes:** Recorded an earlier Amend pass that added a paragraph to Purpose and Branch Policy in this manifest's `generated-artefacts.md`: a commit on a branch that is not a feature branch opens with a fresh Build & Maintain run, and a feature branch skips it. The command and menu label were checked against `scripts/cli.js`. Added the matching Standing Decision. The personas copy of the document was brought into agreement in the same session, and its own log records that.
**Notes:** The working tree held uncommitted changes, so the scan read 2d4220a3 plus that working tree. The reverted-decision search, changed-code intersection and adjacent-document check were not run, by the brief's scope. Finding for root `AGENTS.md` (owner: AGENTS.md Curator): its Generated Artefacts intro says the Git Committer "enforces" the branch handling and is the authority, and the new build-first row sits among rules under that intro. The row could state that it is a project-level rule the Git Committer does not enforce, and its "The manifest and the Git Committer disagree" row should not be read as covering it.

### 2026-10-21 · Update · Curator v1.8.0

**Scope:** Narrow, by instruction: the "Root `AGENTS.md` and root `CLAUDE.md`" row of `generated-artefacts.md`, plus a search of the hub manifest for other pointers to a removed Known Contradictions entry about `CLAUDE.md`. Not a full reconcile.
**Commit:** 6e94b106
**Changes:** Dropped the dangling "(see *Known Contradictions*)" from that row. No other hub manifest document points to a Known Contradictions entry about `CLAUDE.md`.
**Notes:** The working tree held uncommitted changes, so the scan read 6e94b106 plus that working tree. The reverted-decision search, changed-code intersection and adjacent-document check were not run, by the brief's scope.

### 2026-10-19 · Update · Curator v1.8.0

**Scope:** Narrow, by instruction: the Known Contradictions section of `generated-artefacts.md`. Not a full reconcile.
**Commit:** 1ced4e17
**Changes:** Removed the bullet saying the personas manifest still lists root `CLAUDE.md` as generated; that was already corrected there. The section keeps its remaining bullet. The "Root `AGENTS.md` and root `CLAUDE.md`" row is unchanged and remains the record for both root files.
**Notes:** The working tree held uncommitted changes, so the scan read 1ced4e17 plus that working tree. Other checks were not run, by the brief's scope. That row still ends with "(see *Known Contradictions*)", which no longer holds an entry for `CLAUDE.md`; left as instructed.

### 2026-10-19 · Update · Curator v1.8.0

**Scope:** Narrow, by instruction: the end state in which `AGENTS.md` is no longer imported into the generated `.context/` bundle. Touched `generated-artefacts.md` only; `README.md`, `root-tooling.md` and `cross-system-dependencies.md` were searched for statements that `.context/` mirrors or imports `AGENTS.md`. Not a full reconcile.
**Commit:** 1ced4e17
**Changes:** In `generated-artefacts.md`, the `.context/**` row's unsafe-to-discard text no longer lists `AGENTS.md` among the changes a `.context/` diff can reflect, and the "Root `AGENTS.md` and root `CLAUDE.md`" row now states that `.context/agents.md` is no longer generated and the root `context.yaml` does not import `AGENTS.md`. The other three documents held no such statement.
**Notes:** The working tree held uncommitted changes, so the scan read 1ced4e17 plus that working tree. The reverted-decision search, changed-code intersection and adjacent-document check were not run, by the brief's scope. The root `context.yaml` and root `AGENTS.md` had not yet been changed when this pass ran (later stages of the session), so the end state was written from the brief, not verified against those files.

### 2026-10-19 · Update · Curator v1.8.0

**Scope:** Narrow, by instruction: one wording defect in the hub `README.md` Navigation table. Not a full reconcile, and it does not certify the rest of the hub as verified. The README was searched for other hard-coded "9-stage" / "9-agent" / "nine" wording.
**Commit:** 1ced4e17
**Changes:** The Navigation row "Understand the 9-stage ledger pipeline" now reads "Understand the ledger agent workflow", link target unchanged. The earlier entry's "9-stage ledger pipeline" wording was wrong: the per-work-package pipeline has six stages (four by default), and the nine roles include Planner, PM and Synthesis, which sit outside it (`shared/workflow-manifest.json`, `personas/ledger/README.md`). No other such wording was found in the README.
**Notes:** The working tree held uncommitted changes at scan time, so the scan read 1ced4e17 plus that working tree. The reverted-decision search, changed-code intersection and adjacent-document check were not run, by the brief's scope.

### 2026-10-19 · Update · Curator v1.8.0

**Scope:** Narrow, by instruction: moving the Cross-System Dependencies and Root-Level Tooling inventories out of root `AGENTS.md` into two new hub documents, and the hub `README.md` fixes that go with it. Not a full reconcile, and it does not certify the rest of the hub as verified. Rows were checked against `orchestrator/src/config.py`, `scripts/install-mcp-global.js`, `personas/ledger/README.md`, `scripts/` and a sample of the named symbols.
**Commit:** 1ced4e17
**Changes:**
- Created `cross-system-dependencies.md` (dependency table with its validation scripts) and `root-tooling.md` (script and shared-file table, merged with the former README "Shared Infrastructure" rows). Both are linked from the README index.
- Hub `README.md`: the dependency table, validation scripts and Shared Infrastructure tables were replaced by links to the new documents. This removed the stale "Orchestrator persona files" row (it named `personas/ledger/claude-code/`; the orchestrator reads `personas/ledger/deep-agents/`) and the "MCP server name" row that pointed at a nonexistent `.mcp.json` (the registration code is `scripts/install-mcp-global.js`, hardcoding `central_pm`). "9-agent pipeline" became "9-stage ledger pipeline".
- `cross-system-dependencies.md`: the `stores.json location` row, which was split from the table in `AGENTS.md` by a blank line, sits inside it. The "Orchestrator MCP server command" row said the command comes from `orchestrator/.env` → `MCP_SERVER_CMD`; no such variable exists, and `load_config()` hardcodes `node <workspace>/mcp-server/dist/index.js`, so the row now says that.
- `root-tooling.md`: added rows for `scripts/generate-persona-audit.js`, `scripts/lib/yaml-utils.js`, `scripts/lib/persona-model-resolution.js` and `scripts/templates/`, which existed on disk and were in no table, plus a row for `docs/agents/deferred-topics.md`, carried over from the README.

**Notes:** The working tree held uncommitted changes at scan time, so the scan read 1ced4e17 plus that working tree. The reverted-decision search and changed-code intersection were not run, by the brief's scope. Root `AGENTS.md` still carries both inventories until its own pass removes them, and the adjacent-document check was not run here. The Standing Decision on the personas manifest's treatment of root `CLAUDE.md` is unchanged: the hub already lists it as hand-maintained.

### 2026-10-19 · Update · Curator v1.8.0

**Scope:** Narrow, by instruction: add `curation-log.md` and `generated-artefacts.md` to the hub manifest and link both from the hub `README.md`. No other hub section was reconciled, and this entry is an initial log: it does not certify the rest of the hub as verified. Generator facts in the new `generated-artefacts.md` were checked against `scripts/cli.js`, the build scripts, `.gitignore`, `.githooks/pre-commit` and `git ls-files`.
**Commit:** 1ced4e17
**Changes:**
- Created `generated-artefacts.md` for the whole repository: tracked runtime-coupled and documentation-style artefacts, ignored generated output, hand-maintained neighbours, commands with side effects, and known contradictions. It cross-links the personas manifest's document for the persona-build rows instead of duplicating them.
- Created this log.
- Hub `README.md`: added a "Hub Documents" index section linking both new documents; removed the `**Version:**` and `**Last Updated:**` fields, which the log supersedes.

**Notes:** The working tree held uncommitted changes at scan time (a modified `personas/name-mapping.json` and untracked plan and project folders under `docs/agents/`), so the scan read 1ced4e17 plus that working tree. The reverted-decision search and changed-code intersection were not run: the brief limited this pass to the two additions, and no earlier hub log exists to supply a floor. The next full pass has no floor either and should take a bounded slice of recent history.

Judgement calls:
- `mcp-server/coverage/**` is tracked, and `npm run test:coverage` is its only plausible generator, but no vitest config setting confirms the output directory. The row carries a verify marker and tells readers to ask the user. Whether it should be tracked at all is unsettled.
- `docs/presentation/dist/ai-insights-slides.html` is a tracked, runtime-style deliverable, and the pre-commit hook only warns when it is stale.
- Root `CLAUDE.md` holds `@AGENTS.md` and `cmdCtxGenerate` no longer writes it, so the hub lists it as hand-maintained. The personas manifest still calls it generated.
- `personas/name-mapping.json` is listed as tracked. A pending plan (`docs/agents/plans/2026-10-15-untrack-name-mapping/`) would untrack it; the row needs revisiting if that plan lands.
- The hub has no `constraints.md`, so the binding Generated Artefacts rules are not yet written there. Creating that document would be a structural addition and was not part of this pass.

Observed but untouched, outside this pass's scope:
- Hub `README.md` Personas document list omits the personas manifest's `file-tree.md`, `generated-artefacts.md`, `curation-log.md` and `variables.md`.
- Hub `README.md` "Orchestrator persona files" row names `personas/ledger/claude-code/` filenames; the deep-agents output directory is the one the orchestrator reads (per the pending Amend plan, citing `orchestrator/src/config.py`). Not re-verified here.
- Hub `README.md` "MCP server name" row points at a `.mcp.json` the pending Amend plan reports as nonexistent. Not re-verified here.
- Hub `README.md` overview says "three sub-projects"; root `AGENTS.md` says two in places. Counts of this kind go stale and are queued in the pending Amend plan.
- Personas `generated-artefacts.md`, `README.md` and `constraints.md` still describe root `CLAUDE.md` as generated.
- Adjacent documents: root `AGENTS.md` does not link the hub's two new documents and still describes generated agent-instruction mirrors, so it routes readers to the personas copy of the artefact table. Owner: AGENTS.md Curator v2.4.0. Root `README.md` was not read for this pass.

```
###  Path: `/docs/agents/project-manifest/generated-artefacts.md`

```md
# Generated Artefacts

Which tracked files a build step writes anywhere in the repository, which command writes each, which module owns it, and when a modified copy can be discarded. This is the single document for the whole workspace: personas build output, the MCP server and the orchestrator are all covered here, and no module manifest keeps a copy. The binding rules derived from this table live in each module manifest's own *Generated Artefacts* section of `constraints.md`: [personas](../../../personas/docs/agents/project-manifest/constraints.md#generated-artefacts), [MCP server](../../../mcp-server/docs/agents/project-manifest/constraints.md#generated-artefacts) and [orchestrator](../../../orchestrator/docs/agents/project-manifest/constraints.md#generated-artefacts). The hub has no `constraints.md` of its own, and the [Curation Log](curation-log.md) records the deferral.

## Purpose and Branch Policy

The owner's stated practice is the one the [Git Committer](../../../personas/standalone/src/content/git-committer.md) persona enforces, recorded as a Standing Decision in the [personas Curation Log](../../../personas/docs/agents/project-manifest/curation-log.md). That persona is the authority; this section summarises it. On a feature branch, generator drift is not committed. A file whose row's *Safe to discard when* condition holds stays out of the commit and is discarded by path before an upstream integration. A file whose source the branch changed is committed with that source change. `.context/**` counts as drift on every feature branch whatever its row says, so CTX output enters version control only on the default branch (`main`), as its own `CTX: Updated docs` commit. On any branch, a generated file whose diff is only a timestamp or date is not committed.

The practice for a commit on a branch that is not a feature branch, such as the default branch, opens with a fresh Build & Maintain run (CLI menu action `Build & Maintain`, command `node scripts/cli.js build-maintain`), so every generated artefact is current before anything is committed. On a feature branch the step is skipped, because generated artefacts are not committed there. The build-first rule is a project-level constraint of this repository that does not apply to every workspace, so the Git Committer persona does not enforce it; the Git Committer remains the authority for the feature-branch practice above only.

The repository itself enforces something narrower. The `.githooks/pre-commit` hook blocks a commit when `node scripts/build-personas.js --check` fails. That check renders the personas in memory and fails only on error-severity validation results; it never compares against files on disk, so it does not detect out-of-date generated files. The hook also blocks on `node scripts/check-version-sync.js` and on ruff for staged orchestrator Python. It only warns when presentation sources change without a rebuilt `docs/presentation/dist/`, and when staged source under `mcp-server/src/`, `orchestrator/src/`, `personas/`, `scripts/` or `shared/` carries no `.context/` change.

## How to Read Tracked Status

`git ls-files <path>` decides whether a file is tracked. An entry in `.gitignore` proves nothing on its own, because a file committed before its ignore entry stays tracked.

## Tracked Generated Artefacts

Each table names the owning module in *Source* and the inputs the file is built from in *Derived from*.

### Runtime-coupled

Committed code reads these files, so a stale copy changes behaviour, not just documentation.

| Path / glob | Source | Generated by | Derived from | Safe to discard when | Unsafe to discard when |
|---|---|---|---|---|---|
| `personas/name-mapping.json` | Personas | `node scripts/build-personas.js` (real builds only; skipped under `--check` / `--dry-run`), also run by `node scripts/cli.js build-maintain`. Written by `scripts/lib/name-mapping.js`. | Persona YAML in all three suites' `src/meta/` (naming fields, `changelog` versions, `model_slug`) and the model registry in `personas/model-registry/` (see *Known Contradictions*). Loaded at module-load time by `mcp-server/src/utils/constants.ts` (`AGENT_NAMES`). | The diff is limited to the `model`, `model_slug` and `cc_model` fields and the branch changed no model assignment the user asked for — that is machine-local registry drift. | The branch changed a persona's naming fields, version or changelog, or added, renamed or removed a persona. The diff is then the first materialisation of that change and the MCP server's agent names depend on it. |
| `mcp-server/package.json` (`version` field only) | MCP Server | `npm run sync-version` in `mcp-server/` (`scripts/sync-version.js`), run automatically by the `predev` hook and by `build-maintain`. | The top version header of `mcp-server/changelog.md`. | The diff is limited to the `version` field and the branch did not change `changelog.md` (stale local value). | The branch edited `changelog.md`, or the diff touches anything beyond `version`: the rest of the file is hand-maintained. |
| `orchestrator/pyproject.toml` (`version` field only) | Orchestrator | `node scripts/cli.js build-maintain`, which synchronises the version from the orchestrator changelog (`scripts/cli.js`). The orchestrator has no build step of its own. | The top version header of `orchestrator/changelog.md`. | The diff is limited to the `version` field and the branch did not edit `changelog.md` (stale local value). | The branch edited `changelog.md`, or the diff touches anything beyond `version`: the rest of the file is hand-maintained packaging metadata. |
| `docs/presentation/dist/ai-insights-slides.html` | Presentation (`docs/presentation/`) | `docs/presentation/build.sh` (or `build.cmd`), which runs `node tools/build.js`; `node tools/build.js --check` verifies it is current. | `docs/presentation/template.html`, `slides.json`, `slides/`, `partials/`, `img/` and `changelog.md`. | The branch changed none of those sources and the diff is only rebuild noise. | The branch changed any presentation source. The committed HTML is the distributed deliverable and is the first materialisation of that change. |

### Documentation-style

| Path / glob | Source | Generated by | Derived from | Safe to discard when | Unsafe to discard when |
|---|---|---|---|---|---|
| `.context/**` | Hub (CTX configuration at the root and in the personas, `mcp-server` and `orchestrator` modules) | `node scripts/cli.js ctx-generate`, also the last step of `node scripts/cli.js build-maintain`. The command deletes `.context/` whole, runs `ctx generate`, then `scripts/normalize-ctx-paths.js`, then writes `.context/generated-at.txt`. | Root `context.yaml` and every `**/module-context.yaml` (in `personas/`, `mcp-server/`, `orchestrator/`), which import manifests, READMEs, source and directory trees. | On a feature branch: always, whatever the diff shows; all of `.context/` is drift there (see *Purpose and Branch Policy*). On `main`: the diff is limited to `.context/generated-at.txt`, or a file's diff reflects no source or manifest change. Judge per file, never per folder. | Only on `main`: a file's diff reflects a manifest, README or source change — including this manifest's own documents, which the hub document in `.context/` imports. That file belongs in the `CTX: Updated docs` commit. On a feature branch this condition never applies. |
| `docs/references/agents-overview.md` | Personas (generator in root `scripts/`) | `node scripts/generate-agents-overview.js` (`node scripts/cli.js generate-overview`), also run by `build-maintain`. Supports `--check`, which ignores the `> **Generated:**` date line. | Persona YAML metadata in all three suites, plus the header template `scripts/templates/agents-overview-header.md`. | The diff is limited to the `> **Generated:**` date line. | The branch changed persona YAML or the header template. |
| `personas/docs/audits/status.md` | Personas | `node scripts/generate-persona-audit.js` (`node scripts/cli.js generate-persona-audit`). Not part of `build-maintain`. | Persona YAML metadata and source composition, the Persona Design Guide's version and changelog, and `personas/docs/audits/annotations.json`. | The diff is limited to the `**Generated:**` date line. | The branch changed persona metadata, the guide version, or `annotations.json`. |

The `.context/mcp-server/**` and `.context/orchestrator/**` output (and the `.context/personas/**` output) is part of the `.context/**` row and follows its verdicts. It is written by the repository-level `node scripts/cli.js ctx-generate` from each module's `module-context.yaml`, never by an `mcp-server` npm script or a command inside `orchestrator/`.

## Ignored Generated Artefacts

These are not tracked, so there is nothing to revert or commit.

| Path / glob | Source | Regenerate with |
|---|---|---|
| `personas/{ledger,standalone,ledger-support}/{vs-code,claude-code,deep-agents}/*.md` — built persona files | Personas | `node scripts/build-personas.js` (deploy with `node scripts/sync-personas.js`) |
| `dist/*.zip` — packaged standalone personas | Personas | `node scripts/cli.js package-personas` (`scripts/package-personas.js`) |
| `dist/vscode-skills/`, `dist/claude-skills/` — built skills | Hub (root scripts) | `node scripts/build-skills.js` (deploy with `node scripts/publish-skills.js`) |
| `build/` — the NotebookLM bundle and the workflow specification bundle | Hub (root scripts) | `node scripts/cli.js bundle-docs` (`scripts/bundle-docs.js`) |
| `mcp-server/dist/` — compiled server (`tsc`, `outDir` `./dist`); ignored by the root `.gitignore` | MCP Server | `npm run build` in `mcp-server/` |
| `mcp-server/coverage/` — Vitest's default coverage report (`index.html`, per-source `*.ts.html` pages, `clover.xml`, `coverage-final.json`, static assets); a temporary file that is not meant to be tracked, ignored by the root `.gitignore`. `vitest.config.ts` sets no `coverage` options, so Vitest's defaults apply. No build, hook or script reads it | MCP Server | `npm run test:coverage` in `mcp-server/` (`vitest run --coverage` with `@vitest/coverage-v8`) |
| `mcp-server/node_modules/` | MCP Server | `npm install` in `mcp-server/` |
| `mcp-server/storage/ledger/{repo}/{slug}/orchestrator/{logs,chunks,dialogues}/` — run artefacts stored in the MCP server's ledger tree, ignored through `mcp-server/.gitignore` (`storage/ledger/`). Layout rules are in [constraints-storage.md](../../../mcp-server/docs/agents/project-manifest/constraints-storage.md) and the [orchestrator constraints](../../../orchestrator/docs/agents/project-manifest/constraints.md#storage-layout) | Orchestrator | Written by a run (the log copy in `src/cli.py`, `ChunkWriter`, `dialogue_writer`); not regenerable on demand |
| `orchestrator/checkpoints/workflow.sqlite` — resumable run state for `--resume` | Orchestrator | Written by a run: the LangGraph SQLite checkpointer (`src/graph.py`). Location set by `CHECKPOINT_DIR`, default `./checkpoints`. Not regenerable on demand |
| `orchestrator/checkpoints/{thread_id}.terminal` — zero-content markers telling a later `--resume` the thread is finished | Orchestrator | Written by a run that reaches a terminal state (`src/cli.py`) |
| `orchestrator/logs/{timestamp}-{slug}.jsonl` — JSONL run log, see the [log schema](../../jsonl-log-schema.md) | Orchestrator | Written by every run (`src/utils/logging.py`) |
| `orchestrator/logs/{plan-hash}-run-status.json` — tombstone for GUI polling, deleted at the start of the next run of the same plan | Orchestrator | Written by every run (`src/cli.py`) |
| `orchestrator/logs/.run-queue.json`, `.run-queue.lock` — queue state and its file lock | Orchestrator | The run queue (`src/utils/run_queue.py`) |
| `{plan_dir}/.orchestrator-run.json` (and a `.tmp` sibling during the atomic write) — lives beside the plan document, so it can appear in any repository the orchestrator is pointed at; ignored by the root `.gitignore` pattern `.orchestrator-run.json` | Orchestrator | Written by a run via `_write_run_metadata()` in `src/cli.py` |
| `orchestrator/.venv/`, `ai_insights_orchestrator.egg-info/`, `**/__pycache__/` — ignored through `orchestrator/.gitignore` and the root `.gitignore` | Orchestrator | `pip install -e` and the Python interpreter |
| `.pytest_cache/`, `.ruff_cache/` — each directory ships its own self-ignoring `.gitignore` | Orchestrator | `pytest` and `ruff check` |

## Hand-maintained Neighbours

Files that sit next to generated output or feed a generator, but are source. Never revert them as build noise.

| Path | Why it looks generated | Why it is source |
|---|---|---|
| `personas/{ledger,standalone}/{vs-code,claude-code}/.gitkeep` | Lives inside a generated output directory. | Tracked placeholder keeping the directory in Git; the build's pre-clean deletes only `*.md`. |
| `personas/{ledger,standalone,ledger-support}/README.md` | Sits beside the generated target directories. | Hand-authored suite guides; the build never writes them. |
| `personas/package.json` | `build-personas.js` rewrites its `version` field after a real build. | Hand-maintained; only `version` is synchronised from the newest `## vX.Y.Z` heading in `personas/changelog.md`. A version change there follows a changelog change; any other change is real work. |
| `context.yaml`, `**/module-context.yaml` | Named like CTX output. | CTX input configuration, owned by the CTX Architect. |
| Root `AGENTS.md` and root `CLAUDE.md` | `.context/agents.md` is no longer generated, and the root `context.yaml` does not import `AGENTS.md`. `CLAUDE.md` was once generated from `AGENTS.md`. | Both are hand-maintained; `CLAUDE.md` holds an `@AGENTS.md` import and `ctx-generate` no longer writes it. |
| `docs/presentation/{template.html,slides.json,slides/,partials/,img/,tools/}` | Sit beside the generated `dist/`. | Presentation sources. |
| `docs/presentation/dist/` neighbours: `README.md`, `notes.md`, `docs/` | Live under the presentation folder. | Hand-written. |
| `scripts/templates/` | Feed generators. | Hand-written templates for the agents overview (`agents-overview-header.md`) and bundles. |
| `personas/docs/audits/{notes.md,annotations.json}` | Beside the generated `status.md`. | Hand-written input of `generate-persona-audit.js`. |
| `personas/model-registry/default.json` | JSON beside machine-local registry state. | Shipped seed model list. |
| `docs/agents/project-manifest/**` and the module manifests | Imported wholesale into `.context/`. | The source `.context/` manifest copies derive from. |
| `skills/{meta,src}/` | Feed `build-skills.js`. | Skill sources. |
| `mcp-server/module-context.yaml`, `orchestrator/module-context.yaml` | Named like CTX output. | CTX input configuration, owned by the CTX Architect (the `**/module-context.yaml` row above covers the same files). |
| `mcp-server/docs/agents/project-manifest/**`, `mcp-server/gui/docs/agents/project-manifest/**`, `orchestrator/docs/agents/project-manifest/**` | Imported wholesale into `.context/mcp-server/` and `.context/orchestrator/`. | The sources the `.context/` copies derive from. |
| `mcp-server/package-lock.json` | Machine-written by npm. | Committed lockfile; changes with dependency edits, not with builds. |
| `mcp-server/storage/` | Holds runtime-looking data. | Per-project ledger runtime data layout; contents are governed by [constraints-storage.md](../../../mcp-server/docs/agents/project-manifest/constraints-storage.md), not by a build. |
| `orchestrator/requirements.txt` | Reads like a pip freeze. | Hand-maintained dependency list. Nothing in `scripts/` writes it; the only reference there is a reader, `scripts/lib/health-checks.js`. <!-- TODO: verify: no writer found in orchestrator/ either; origin assumed manual --> |
| `orchestrator/.env.example` | Sits beside the ignored `.env`. | Committed template for local configuration. |
| `orchestrator/docs/jsonl-log-schema.md` | Describes generated logs. | Hand-written schema reference. |

## Commands That Touch More Than They Generate

| Command | Writes beyond its generated output |
|---|---|
| `node scripts/build-personas.js` | Rewrites the `version` field of `personas/package.json` from `personas/changelog.md`. Deletes every `*.md` file in the persona output directories before building. `--check` / `--dry-run` write nothing. |
| `node scripts/cli.js ctx-generate` | Deletes `.context/` entirely before regenerating. Requires the `ctx` binary on `PATH`. This is the lighter docs-only command. |
| `node scripts/cli.js build-maintain` | The full build. Before the persona build it runs `mcp-server/scripts/sync-version.js` and synchronises the root `package.json` and `orchestrator/pyproject.toml` versions from their changelogs; it then builds all persona suites (rewriting `personas/package.json` `version` and `personas/name-mapping.json`), regenerates `docs/references/agents-overview.md`, runs `check-known-roles.js`, and finishes with `ctx-generate`. |
| `npm test` in `mcp-server/` | The `pretest` hook runs `node ../scripts/build-personas.js` and then `--check`, so every test run rebuilds persona output and may rewrite the tracked `personas/name-mapping.json` (verdicts in its row above). |
| `npm run dev` in `mcp-server/` | The `predev` hook runs `sync-version`, which can rewrite `mcp-server/package.json`. |
| `npm run test:coverage` in `mcp-server/` | Calls `vitest` directly, so the `pretest` hook does not run, and it rewrites the ignored `mcp-server/coverage/` tree. |
| `orchestrate` (`src/cli.py`) | Writes into several locations at once: the orchestrator's own `checkpoints/` and `logs/`, the plan directory (`.orchestrator-run.json`), and the MCP server's ledger storage (`mcp-server/storage/ledger/...`). It also drives MCP tools that change ledger state. |
| `pytest` in `orchestrator/` | Writes only `.pytest_cache/` and `__pycache__/`. Tests that exercise the run queue, checkpoints or logs are expected to use temporary paths. <!-- TODO: verify: `tests/conftest.py` and several tests use `tmp_path` / `tempfile`, but isolation from the real logs/ and checkpoints/ directories was not checked for every test --> |
| `node scripts/sync-personas.js` | Runs the full build (with all its side effects above), then copies output outside the repository into the VS Code agents directory and `~/.claude/agents/`, and `.claude/skills/` into `~/.claude/skills/`. Under `--dry-run` it regenerates and copies nothing. |
| `node scripts/cli.js package-personas` | Unless `--skip-build` is given, first runs `node scripts/build-personas.js --strict`, which builds every suite (with the build's side effects above), not only the standalone suite. The `TARGETS` list in `scripts/package-personas.js` (`personas/standalone/vs-code`, `personas/standalone/claude-code`) is what keeps the `dist/` ZIPs standalone-only. |

## Known Contradictions

- **`personas/name-mapping.json` depends on untracked, machine-local files.** Its `model`, `model_slug` and `cc_model` fields are resolved through `scripts/lib/persona-model-resolution.js` from `personas/model-registry/local.json` (falling back to `default.json`) and `assignments.json`. Both are gitignored, so two machines building the same commit write different model fields into a tracked file. This cannot be fixed by regenerating; a diff confined to those fields is machine drift, not a defect to "fix". A pending plan (`docs/agents/plans/2026-10-15-untrack-name-mapping/`) proposes untracking the file; until it lands the file is tracked and this row stands.

```
###  Path: `/docs/agents/project-manifest/root-tooling.md`

```md
# Root-Level Tooling

The workspace-level scripts, shared libraries and shared configuration that sit outside the three sub-projects. `scripts/` holds cross-project operations (persona build and deployment, ledger imports, orchestrator pre-flight and log tooling, version and health checks, skill publishing). `shared/` holds the workflow manifest every sub-project derives its roles, pipelines and status enums from. `scripts/cli.js` is the interactive command center and the direct CLI entry point for most of them.

Persona-build details live in the [personas manifest](../../../personas/docs/agents/project-manifest/README.md). Which of these scripts write tracked files, and when a modified output can be discarded, is covered by [generated-artefacts.md](generated-artefacts.md). The synchronisation points these tools take part in are listed in [cross-system-dependencies.md](cross-system-dependencies.md).

## Files and Scripts

| File | Purpose |
|------|---------|
| `scripts/cli.js` | **Interactive command center + direct CLI** for all workspace operations. Replaces `setup-orchestrator.js` as the user-facing entry point. |
| `scripts/sync-personas.js` | Runs `node scripts/build-personas.js` (all suites and targets), then deploys and validates frontmatter. `--target` (`vscode` \| `claude-code` \| `all`, default `all`) selects only the deploy steps: `vscode` copies all three suites to the VS Code agents folder (~/.copilot/agents/) (`--custom-path` overrides it); `claude-code` copies all three suites to `~/.claude/agents/`, then syncs skills from `.claude/skills/` to `~/.claude/skills/`. Under `--dry-run` the build is forwarded `--dry-run`, so nothing is regenerated or copied — the sync only previews ("Would copy") from the existing output. See [`api-surface.md` → Sync Script](personas/docs/agents/project-manifest/api-surface.md#sync-script-scriptssync-personasjs). |
| `scripts/launch-agent.js` | Thin CLI entry point for `ai-insights agent`: scans `~/.claude/agents/`, presents a type-to-filter picker over the built launch-entry list — a pinned "Resume a previous session" row above the personas, separated by a dim divider — and spawns `claude` with the argv carried by the selected entry (`--agent <id>` for a persona, `--resume` for the session row), forwarding its exit code. Owns the single `LaunchToggles` instance for the run (persisting across picker loop-backs) and appends `toggles.toClaudeArgs()` to the spawn argv; supports `--skip-permissions` (and absorbs a passthrough `--dangerously-skip-permissions` into the toggle), `--filter <term>` (now honored on both the raw-mode and `readline`-fallback paths) and passthrough args after a bare `--`. Invokable via `node scripts/cli.js agent`. |
| `scripts/lib/launch-agent-core.js` | Pure discovery/filtering/reducer logic and both picker I/O shells for `scripts/launch-agent.js`. Exports `discoverAgents(agentsDir)` (role: frontmatter → label, else filename-without-extension), `buildLaunchEntries(agents, toggleDefs)` (prepends the pinned session entry and one pinned `kind: 'toggle'` row per toggle definition, widens each agent with `kind: 'agent'` and `claudeArgs: ['--agent', id]`), `filterEntries(entries, query)` (renamed from `filterAgents`), `firstAgentIndex(entries)` (index of the first `kind === 'agent'` entry, or `0`), `reducePickerInput(state, input, filteredLength)`, `parseLaunchArgs(argv)` (→ `{ filter, ownArgs, passthroughArgs }`), `renderPickerLines(state, filtered, maxVisibleRows, toggles)` (toggle-aware, with the instructions-line warning) and `CHROME_ROWS` (both now exported for test coverage of the divider/row-budget invariants), `runInteractivePicker(entries, initialQuery, toggles)`, and `runNonInteractivePicker(entries, initialQuery, { readlineFactory, toggles })` (Enter/number on a toggle row flips it without resolving) — both pickers now resolve with the selected launch-entry object rather than a bare agent id. No `main()`/CLI logic — imported by both `launch-agent.js` and its test file. |
| `scripts/lib/launch-toggles.js` | Registry and state model for the `ai-insights agent` picker's session-scoped toggles. Exports `LAUNCH_TOGGLES` (frozen definitions; currently `skip-permissions` → `--dangerously-skip-permissions`) and class `LaunchToggles` (`isOn`, `toggle`, `toClaudeArgs`, `activeWarnings`, static `fromArgs(ownArgs, passthroughArgs, defs)`). A new toggle is a data addition to the registry. No `main()`. |
| `scripts/lib/frontmatter.js` | Shared YAML frontmatter parser for deployed persona `.md` files. Exports `parseFrontmatter(filePath)` — extracted verbatim from `sync-personas.js`'s former private implementation; consumed by both `sync-personas.js` and `scripts/lib/launch-agent-core.js`. |
| `scripts/lib/claude-cli.js` | Shared "is the `claude` CLI on PATH" predicate. Exports `isClaudeCliAvailable()` — extracted from `install-mcp-global.js`'s private `_checkClaudeCodeStatus()`; consumed by `install-mcp-global.js` and `scripts/launch-agent.js`. |
| `scripts/lib/npm-link.js` | Global `npm link` registration for the `ai-insights` CLI binary — a distinct concern from Global MCP registration (`install-mcp-global.js`, which registers the MCP server with an IDE rather than making the `ai-insights` shell command itself resolvable). Exports `getPackageName(root?)`, `isCliLinked(opts?)` (via `npm ls -g --depth=0 <name>`, cross-platform), and `linkCli(opts?)` (runs `npm link`, returns `{ success, output }`). Consumed by `scripts/cli.js` (`global-cli` `SETUP_COMPONENT` and the `link-cli` command) and `scripts/lib/health-checks.js` (`global-cli-linked` slow-tier check). |
| `scripts/lib/original-cwd.js` | Shared accessor for the invoking terminal's working directory. Exports `getOriginalCwd()`, backed by a `process.cwd()` value captured once at module-load time (before any command logic runs). Consumed by `scripts/cli.js` (`cmdAgent`, sourcing the `cwd` option passed to `runScript()` for the `launch-agent.js` hand-off) and `scripts/launch-agent.js` (its `spawn('claude', ...)` call), so `ai-insights agent` launches the selected persona in the user's actual invocation directory rather than the `ai-insights` workspace root. |
| `scripts/publish-locations.js` | Single source of truth for persona publish locations (label, path, target type). Consumed by `sync-personas.js` and `cli.js`. Copilot locations honour `COPILOT_HOME` (rebased via the `copilot_home` segments in `shared/publish-locations.json`); `getCopilotMcpConfigPath()` serves `install-mcp-global.js`. Individual path helpers (e.g. `getVSCodeSkillsDir()`, `getClaudeCodeSkillsDir()`) are also imported directly by `publish-skills.js`. |
| `scripts/package-personas.js` | Packages the standalone persona output into release ZIPs. Runs `node scripts/build-personas.js --strict` first (building every suite) unless `--skip-build` is given; its `TARGETS` list (`personas/standalone/vs-code`, `personas/standalone/claude-code`) is what keeps the ZIPs standalone-only. |
| `scripts/preview-prompts.py` | Python utility to preview rendered prompt output for a persona |
| `scripts/build-personas.js` | Assemble all persona files (each in every output target: `vs-code`, `claude-code`, `deep-agents`) from `personas/ledger/src/`, `personas/standalone/src/`, and `personas/ledger-support/src/` templates. Accepts only `--check` (alias `--dry-run`) and `--strict`, both forwarded to the library CLI; there is no `--suite` or `--target` — suites and targets come from `personas/persona-build.config.js`, and every build covers all of them ([CLI Interface](personas/docs/agents/project-manifest/api-surface.md#scriptsbuild-personasjs--cli-interface)). `--strict` adds the library's warning-severity validation results as failures; unresolved-marker `[WARN]` lines and the wrapper's own warn-severity checks never fail the build. Its post-build name-mapping step (real builds only) delegates to `scripts/lib/name-mapping.js` (`generateNameMapping()` + `writeNameMapping()`) rather than carrying the generator inline. |
| `scripts/build-skills.js` | Compile skill source files from `skills/meta/` and `skills/src/` into `dist/vscode-skills/` and `dist/claude-skills/`. Supports `--check` / `--dry-run` (read-only) and `--strict`. Invokable via `node scripts/cli.js build-skills`. |
| `scripts/publish-skills.js` | Deploy built skill files from `dist/vscode-skills/` and `dist/claude-skills/` to `~/.copilot/skills/` and `~/.claude/skills/`. Clears only the matching stem directory per skill — hand-written sibling directories (e.g. `release-check`) are preserved. Supports `--dry-run` (logs what would be deployed without writing). Invokable via `node scripts/cli.js publish-skills`. |
| `scripts/check-known-roles.js` | Manifest validation delegate (previously `KNOWN_ROLES` ↔ `AGENT_ROLES` drift check; superseded by `validate-workflow-manifest.js` now that both derive from the manifest) |
| `scripts/check-version-sync.js` | Compares each module's changelog version against its package manifest version. Exits 1 on mismatch. Called by the pre-commit hook (blocking) and available via `node scripts/cli.js check-versions`. |
| `scripts/extract-changelog-entry.js` | Parses the topmost root changelog entry for CI/GitHub Actions release automation |
| `scripts/bundle-docs.js` | Bundle workspace docs into `build/`: `notebooklm-bundle.md` (root README, MCP server + personas READMEs/manifests, agent roster overview — a full project brief for NotebookLM or another AI assistant) and `workflow-specification.md` |
| `scripts/normalize-ctx-paths.js` | Normalises absolute paths in `.context/` output to workspace-relative paths after CTX generation |
| `scripts/preflight-orchestrator.js` | Pre-flight readiness checks for the orchestrator: validates venv, `.env` config, MCP server dist freshness, and absence of conflicting processes. Supports `--plan <path>`, `--json`, and `--check-api-key` (live-validates API key(s) against provider endpoints, no tokens consumed). Invokable via `node scripts/cli.js preflight`. |
| `scripts/run-orchestrator.js` | Pre-flight dist freshness guard + orchestrate launcher. Uses the shared `scripts/lib/mcp-dist-freshness.js` (`ensureMcpDistFresh()`, no `requiredFile`) to rebuild `mcp-server/dist/` when stale, preserving its own stale/up-to-date console lines and its silent build-failure exit, then delegates to the `orchestrate` CLI with all supplied arguments. |
| `scripts/import-standalone.js` | Import standalone plan folder(s) into the project ledger. Supports `--path <plan-folder>` (single import) and `--batch` (scan `docs/agents/` or `--base-dir` for untracked plans). Includes `--dry-run` mode and `--verbose` flag (surfaces full error stacks from `collectKnownSlugs()` I/O failures). Automatically rebuilds `mcp-server/dist/` when stale before importing — an error is only emitted when the tool file is still missing after a completed build. Cross-platform (uses `path.join`/`path.resolve`/`pathToFileURL`). Invokable via `node scripts/cli.js import-standalone`. |
| `scripts/run-gui.js` | Launches the MCP GUI server from the workspace root and opens the default browser once the server is ready. Delegates to `tsx gui/server.ts` inside `mcp-server/`. |
| `scripts/read-log.js` | Structured JSONL log reader for orchestrator runs: renders entries as human-readable colored output (default) or raw JSON array (`--format json`). Supports `--errors` to filter to error events only. |
| `scripts/extract-dialogue.js` | Extracts prose text from LangGraph agent chunk `.jsonl` files, writing a `.md` file alongside each source. Supports single-file and directory batch modes. Flags: `--force` (overwrite existing), `--dry-run` (preview paths without writing), `--help`/`-h`. Invokable via `node scripts/extract-dialogue.js <chunk-file>` or `node scripts/cli.js extract-dialogue <args>`. Shares the same `.md` output format as the server-side `renderChunksToText()` and the GUI "Text Only" tab. |
| `scripts/audit-orchestrator.js` | Audits the packages installed in `orchestrator/.venv` for known security advisories via `pip-audit` (a `dev` extra), run as `python -m pip_audit --path <site-packages>`. Exits 0 when clean, 1 on findings or when the venv / `pip-audit` is missing. Supports `--json` and `--fix`; other arguments pass through to `pip-audit`. CLI: `audit-orchestrator`. |
| `scripts/kill-orchestrator.js` | Finds and terminates stale orchestrator processes, cleans up lock files. Supports `--force` (kill without prompting), `--json` (list processes as JSON without killing), and `--depth N` (scan last N log files for lock cleanup; default 20). |
| `scripts/install-hooks.js` | One-time setup: sets `git config core.hooksPath .githooks` to activate the `.githooks/pre-commit` guard (`node scripts/build-personas.js --check || exit 1` — blocks the commit when persona sources fail validation; it is not a freshness check — plus blocking version sync, ruff lint, presentation `dist/` staleness warning, CTX staleness warning, changelog drift warning) |
| `scripts/migrate-knowledge-uuids.js` | **One-time batch migration:** converts all knowledge store files from schema v1 (numeric `id`, `next_id` counter) to v2 (UUID v4 `id`, no `next_id`). Run **once** before deploying WP-002–WP-006 code changes. Supports `--dry-run` (report planned changes without writing), `--verbose` (log old→new ID mappings), and `--store <path>` (repeatable, overrides auto-detection). Store discovery: `--store` flags → `~/.ai-insights/stores.json` → `LEDGER_ROOT` env var. Idempotent: files already at `"2.0.0"` are silently skipped. Uses only Node.js built-ins (`fs`, `path`, `os`, `crypto`). |
| `scripts/backfill-duration.js` | **One-time backfill:** populates `duration_ms`, `active_ms`, and `pipeline_runs` in `.meta.json` for existing projects that already have `synthesis_generated_at` on their root index but predate one or more of these enrichment-cache fields. `duration_ms = synthesis_generated_at - date_created` (wall-clock), nulled out for zero-duration standalone same-session imports. `active_ms` / `pipeline_runs` are computed by reading every project's `WP-###.json` detail files and summing pipeline `duration_ms` (the script writes only `.meta.json` — WP detail files are read-only inputs). Supports `--dry-run` and `--verbose`. Idempotent — each field is skipped independently once already cached, so a project with `duration_ms` set still receives `active_ms` / `pipeline_runs` on a later run. Store discovery: `~/.ai-insights/stores.json` → `LEDGER_ROOT` env var. Project-directory discovery is delegated to `scripts/lib/ledger-dirs.js` (never re-implemented locally). Invokable via `node scripts/cli.js backfill-duration`. |
| `scripts/generate-agents-overview.js` | Generate `docs/references/agents-overview.md` from persona YAML metadata across all three suites. Supports `--check` / `--dry-run` for staleness detection. Invokable via `node scripts/cli.js generate-overview`. Called automatically by `cmdBuildMaintain` after the persona build step. |
| `scripts/lib/health-checks.js` | **Shared health-check registry** — checks across three cost tiers: instant (< 5 ms, file-existence/mtime), fast (< 50 ms, JSON reads), slow (100 ms – 2 s, subprocess). The CLI main menu displays all instant-tier checks as status lines. Exports `HEALTH_CHECKS: Array<HealthCheck>` and `runChecks(costFilter)`. Not a runnable script; imported by consumers in `scripts/` (CLI status line, doctor command, preflight flows). Must not import from `scripts/cli.js` or `SETUP_COMPONENTS`. |
| `scripts/lib/insight-validation.js` | **`insight_agent` field validation** for persona YAML metadata. Exports `validateInsightFields(meta, filePath)` (single-file) and `validateInsightFieldsInDirs(dirs)` (batch). Fails the build when: (a) `insight_agent` differs from `role` (ledger personas only — standalone personas without `role` are exempt); (b) exactly one of `insight_agent` / `insight_report_target` is defined. Called unconditionally by `scripts/build-personas.js` in both real and `--check` modes. |
| `scripts/lib/subagent-reference-validation.js` | **Rendered sub-agent reference check** across all three suites and all three output targets. Exports `validateSubagentReferences(suites)` (batch), `checkRenderedReferences({ persona, target, text, subagents, index })` (single file) and `readRenderedName(text)`. Fails the build when a declared `subagents` slug is never referenced in a target's rendered output by the identifier that target matches (VS Code frontmatter `name`, Claude Code frontmatter `name`, or the slug for deep-agents); when a literal `agentName` / `subagent_type` names an undeclared or nonexistent agent; or when a Claude Code dispatch names its agent only in `description`, or a deep-agents dispatch passes a `task` parameter. Validates the library's in-memory render (`build({ ...config, check: true })`), not the gitignored files on disk, in both real and `--check` modes. Each persona's targets are derived directly from which `r.target` values the library's own build results carry for its `personaYamlPath` — the library already skips excluded-target renders, so there is no separate target-resolution or pruning step here. `cc_tools` / dispatch-grant validation (previously this file's sibling `scripts/lib/cc-tools-validation.js`, now deleted) and target resolution (previously this file's own `resolvePersonaTargets()`, now removed) both live in `@mistralys/persona-builder`'s `validateToolRequirements()`, configured via the `toolRequirements` build option. **Fails hard**, since a wrong identifier makes the platform start another agent, or none, without an error. |
| `scripts/lib/philosophy-tone.js` | **Operating Philosophy mood check** for persona content files (Persona Design Guide v3.0). Exports `extractPhilosophyPrinciples(markdown)`, `checkPhilosophyTone(markdown, filename, { stripComments })` (single-file) and `checkPhilosophyToneInDirs(dirs, { stripComments })` (batch, forwards the option). Flags verb-initial principle titles and imperative body openings, which the guide requires to be stated in the indicative mood. Comment-aware: `stripComments` is applied to each extracted principle's title/body individually (not to the whole file), so a comment never shifts the reported line number, and a comment-only title is skipped; the seam defaults to the identity function, matching `agent-slug-validation.js`. Known edge, pinned by a characterization test: a bullet sitting *inside* a multi-line comment is still extracted and checked, since extraction scans raw lines. Called unconditionally by `scripts/build-personas.js` (passing its hoisted `stripCommentsFn`) over the three suite `src/content/` directories **and `personas/shared/partials/`** — a philosophy section extracted into a partial must stay within tone coverage. **Warns, never fails**, since the detector is a heuristic and a legitimate declarative may open with an unrecognised verb. |
| `scripts/lib/changelog-size-check.js` | **Newest-entry size/verbosity check** for `personas/changelog.md` (Changelog Convention rule 8, summary-only). Exports `extractLatestChangelogEntry(markdown)` and `checkChangelogEntrySize(markdown, filename, options)`, plus the `MAX_ENTRY_LINES` / `MAX_BULLETS` / `MAX_SENTENCES_PER_BULLET` / `MAX_LINE_LENGTH` threshold constants. `MAX_LINE_LENGTH` (100) flags any newest-entry line — heading included — whose code-point count exceeds the threshold, counting a Markdown link `[label](target)` as `label` only (the `(target)` portion is excluded, per house style). Scoped to only the first `## v` heading in the file — the entry about to land, never historical entries. Called unconditionally by `scripts/build-personas.js` as the final warning block. **Warns, never fails**, since a mechanical line/bullet/sentence/length count cannot judge prose quality on its own. |
| `scripts/lib/agent-slug-validation.js` | **`{{agent_slug_*}}` cross-reference check** for ledger persona content files. Exports `validateAgentSlugReferences(metaDir, contentDir, { stripComments })` (returns an array of error strings; empty = valid) and `extractSubagentsList(text, key)` (parses a flat dash-prefixed YAML block list). Extracted from `scripts/build-personas.js`'s former inline block; now comment-aware — a `{{agent_slug_*}}` reference written inside a template comment is ignored when the caller passes the library's real `stripComments()` (falls back to the identity function for a stale `dist/` predating that export). Called unconditionally by `scripts/build-personas.js` as one of the `runBuildChecks()` descriptors (see `scripts/lib/build-checks.js`). |
| `scripts/lib/build-checks.js` | **Check-runner descriptor pattern** used by `scripts/build-personas.js` to run every build check unconditionally, regardless of whether an earlier one failed. Exports `runBuildChecks(checks, { log, warn, error })` — executes an ordered list of `{ id, label, severity, run() }` descriptors, awaits async ones, prints non-empty results under `[ERROR]`/`[WARN]` prefixes, and returns `{ errorCount, warningCount }`; a descriptor whose `run()` throws or rejects is recorded as an error-severity result and the loop continues — and `resolveExitCode(libraryStatus, { errorCount })` (returns the library CLI's own exit status when non-zero, else `1` when `errorCount > 0`, else `0`). `scripts/build-personas.js` now calls `process.exit` exactly once, via `resolveExitCode()`, after every check has run. |
| `scripts/lib/name-mapping.js` | **Name-mapping generator** for `personas/name-mapping.json`, extracted verbatim from `scripts/build-personas.js`'s former inline post-build block. Exports `generateNameMapping({ personasDir, warn, info })` (returns `{ entries, ledgerCount, nonLedgerCount }` by reading the ledger, standalone and ledger-support `src/meta/` persona YAML — each `_shared.yaml` included for model defaults — plus `personas/model-registry/`), `writeNameMapping(outPath, entries)` (two-space-indented JSON with a trailing newline; entry fields per [`api-surface.md` → `name-mapping.json` — All Suites](personas/docs/agents/project-manifest/api-surface.md#name-mappingjson--all-suites)), and the exported helpers `resolveVersionFromChangelog(text)`, `validateChangelogField(raw, filename, { warn, info })`, and `deriveRole(name)`. Deliberately does not call the library's own `resolveChangelogMeta()` — that would break name-mapping generation whenever `dist/` fails to load, which the wrapper tolerates. Called by `scripts/build-personas.js` on real builds only — never under `--check` / `--dry-run`. |
| `scripts/lib/ledger-dirs.js` | **Canonical project-directory discovery for root-level scripts.** Loads `LedgerStore.listAllProjectDirs()` from the compiled `mcp-server/dist/` output — rebuilding it when stale via the shared `scripts/lib/mcp-dist-freshness.js` (`ensureMcpDistFresh()`, `requiredFile` = `dist/storage/ledger-store.js`), preserving its own `[ledger-dirs] …` message texts and exit codes — and re-exports it as `listAllProjectDirs(storeRoot)`. Every root-level script that needs to enumerate ledger project directories (`scripts/backfill-duration.js`, `scripts/import-standalone.js`, `scripts/lib/store-commands.js` → `storeList()`) calls this helper instead of re-implementing flat-vs-namespaced layout detection — that logic is owned exclusively by `LedgerStore.listAllProjectDirs()` in `mcp-server/src/storage/ledger-store.ts`. |
| `scripts/lib/mcp-dist-freshness.js` | **Shared `mcp-server/dist/` freshness-check and rebuild module**, replacing the drifted private copies of this logic previously duplicated across several root-level scripts. Exports `latestMtime(dir)` (recursive max mtime across a directory tree; returns `-Infinity` for a missing or unreadable directory), `isMcpDistStale({ srcDir, sentinelFile })`, and `ensureMcpDistFresh({ mcpServerDir, requiredFile, spawn, platform, onBuildStart })` — returns `{ ok: true, rebuilt }` on success, `{ ok: false, reason: 'build-failed', status }` when the rebuild subprocess exits non-zero, or `{ ok: false, reason: 'missing-module', file }` when `requiredFile` is still absent after a completed (or skipped) build; `build-failed` is checked and returned before the `missing-module` check ever runs. The module never calls `process.exit` or any `console` method — callers own all presentation (message text, exit codes) and own the actual `spawn`/`platform` dependency injection for testability. Consumed by `scripts/lib/ledger-dirs.js`, `scripts/import-standalone.js`, and `scripts/run-orchestrator.js` (`ensureMcpDistFresh()`, each with its own `requiredFile`/`onBuildStart` mapping back to its pre-migration message texts), `scripts/cli.js` (`isMcpDistStale()` only, in `cmdOrchestratorTests`), and `scripts/lib/health-checks.js` (`latestMtime()` only — `scripts/preflight-bootstrap.js` is deliberately excluded; see its own row). |
| `scripts/lib/store-commands.js` | Pure-JavaScript implementation of the `store` CLI command group (cross-device ledger sync plan, WP-006); **public command functions** consumed by `scripts/cli.js → cmdStore()`: `storeInit`, `storeAdd`, `storeRemove`, `storeList`, `storeSetDefault`, `storeConflicts`, `storeStatus`, `storeRepoAdd`, `storeRepoMove`, `storeRepoList`; **exported for test isolation only** (not public CLI API): `resolveConfigPath`, `expandPath`, `registryPath`, `loadConfig`, `saveConfig`, `loadRegistry`, `saveRegistry` — these I/O helpers let tests pre-seed config/registry files in temporary directories via the `configPath` override parameter; `saveConfig()` and `storeInit()` additionally accept `_storesDirOverride` for test isolation (overrides the `~/.ai-insights/` directory used for `mkdirSync`); `storeRemove()` sets `default_store: null` when the last store is removed (the resulting invalid config causes `loadStoresConfig()` to return null and fall back to legacy single-store mode on next server load); file formats are compatible with the TypeScript `StoresConfigSchema` and `RepositoryRegistrySchema`; cross-platform (uses `path.join`/`path.resolve`, no shell deps). |
| `scripts/install-mcp-global.js` | Stable-shim strategy for user-level MCP server registration across VS Code and Claude Code; installs `~/.ai-insights/bin/launch-server.js`, merges `central_pm` into `~/.copilot/mcp-config.json` (`mcpServers` schema; read by Copilot CLI and VS Code), and optionally registers with Claude Code. Supports `--dry-run`. Called by the `scripts/cli.js` `install-mcp` command and the `global-mcp` `SETUP_COMPONENT`. |
| `scripts/preflight-bootstrap.js` | Bootstrap guard: ensures root `node_modules` are installed and rebuilds `mcp-server/dist/` when stale before launching the CLI |
| `scripts/generate-persona-audit.js` | Generates `personas/docs/audits/status.md` from persona YAML metadata across all three suites, oldest persona first within each suite. The hand-written narrative lives beside it in `notes.md`, and editorial Notes-column text in `annotations.json`. Supports `-o <file>`, `--stdout` and `--guide-version`. Invokable via `node scripts/cli.js generate-persona-audit`. Not part of `build-maintain`. |
| `scripts/lib/yaml-utils.js` | Dependency-free YAML helpers for persona YAML files (`parseYamlScalars`, `extractYamlBlockScalar`). Consumed by `scripts/build-personas.js`, `scripts/generate-agents-overview.js` and `scripts/generate-persona-audit.js`. No `main()`. |
| `scripts/lib/persona-model-resolution.js` | Pure model-resolution helpers for the name-mapping pass. Exports `loadModelRegistry(registryDir)` (reads `local.json` or `default.json`, plus `assignments.json`) and `resolveModel(...)`, which applies the priority chain: per-persona assignment, per-persona YAML `model_slug`, default assignment, `_shared.yaml` `default_model_slug`, then the `inherit` sentinel. |
| `scripts/templates/` | Hand-written header templates prepended by generators: `agents-overview-header.md` (for `docs/references/agents-overview.md`) and `notebooklm-bundle-header.md` (for the `bundle-docs.js` bundle). |
| `docs/agents/deferred-topics.md` | Not a script: tracks deliberately deferred implementation decisions with structured trigger and timeline fields. |
| `scripts/tests/` | Root workspace script test suite (Vitest). Run via `npm test` from the workspace root |
| `shared/workflow-manifest.json` | **Single source of truth** for specification-derived constructs: agent roles, pipeline types, status enums (project/WP/pipeline/blocker), and workflow constants. All sub-projects derive their constants from this file. Validated by `shared/workflow-manifest.schema.json`. |
| `shared/workflow-manifest.schema.json` | JSON Schema (Draft-07) enforcing structural constraints on `workflow-manifest.json`. Semantic cross-reference checks (unique IDs, fail_routing references, default_stages subset) are enforced by `scripts/validate-workflow-manifest.js`. |
| `context.yaml` | [CTX Generator](https://github.com/context-hub/generator) root config. Imports `**/module-context.yaml` and defines workspace-wide documents. Run via `node scripts/cli.js ctx-generate` (requires `ctx` on PATH). Output goes to `.context/` (tracked in VCS). |

```