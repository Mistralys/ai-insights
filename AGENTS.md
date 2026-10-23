# AI Agents Operating System — AI Insights Workspace

> **Purpose:** This document is the authoritative entry point for AI agents entering the **ai-insights** workspace. It defines how agents discover, navigate, and interact with the three sub-projects and their shared infrastructure to ensure architectural integrity and token efficiency.

---

## Workspace Architecture

This is a **monorepo-style workspace** containing three distinct sub-projects and shared root-level tooling:

| Sub-Project | Path | Language | Purpose |
|-------------|------|----------|---------|
| **Project Ledger MCP Server** | `mcp-server/` | TypeScript (ESM) | MCP server that provides typed tools for managing project ledgers in AI agent workflows |
| **Ledger Personas Build System** | `personas/` | JavaScript (CJS) | Persona build system that assembles ledger, standalone, and ledger-support persona files across its output targets (vs-code, claude-code, deep-agents) from YAML/Markdown sources via `@mistralys/persona-builder` |
| **Orchestrator** | `orchestrator/` | Python (3.11+) | LangGraph + Deep Agents headless pipeline executor — deterministic alternative to IDE-based agent workflows |

The `scripts/` directory contains cross-project scripts that orchestrate persona deployment and role-parity checks.

> **Key relationship:** The personas sub-project generates agent instructions that reference MCP tools exposed by the mcp-server sub-project. All three consumers of agent role names — `AGENT_ROLES` in `mcp-server/src/utils/constants.ts`, `KNOWN_ROLES` in `scripts/sync-personas.js`, and the `role` values in persona YAML metadata — now derive from or are validated against `shared/workflow-manifest.json`. The manifest is the single source of truth; adding a role there propagates automatically to `AGENT_ROLES` and `KNOWN_ROLES`. Persona YAML `role` fields are validated by `scripts/build-personas.js` against manifest role names.

---

## Project Manifests — Start Here!

**Core Philosophy:** The Project Manifests are the canonical documentation of this codebase. If implementation code contradicts a manifest, the **code is likely wrong**.

**Unified entry point:** [`docs/agents/project-manifest/`](docs/agents/project-manifest/README.md) — links to all module manifests, the [cross-system dependencies](docs/agents/project-manifest/cross-system-dependencies.md) and [root-level tooling](docs/agents/project-manifest/root-tooling.md) hub documents, and a navigation guide.

Each sub-project maintains its own detailed manifest:

| Module | Manifest Location |
|--------|-------------------|
| **MCP Server** | [`mcp-server/docs/agents/project-manifest/`](mcp-server/docs/agents/project-manifest/README.md) |
| **MCP Server GUI** | [`mcp-server/gui/docs/agents/project-manifest/`](mcp-server/gui/docs/agents/project-manifest/README.md) |
| **Personas** | [`personas/docs/agents/project-manifest/`](personas/docs/agents/project-manifest/README.md) |
| **Orchestrator** | [`orchestrator/docs/agents/project-manifest/`](orchestrator/docs/agents/project-manifest/README.md) |

> **Constraints are split by domain.** The MCP server manifest carries five constraints documents
> (`constraints.md` for core infrastructure, plus `-workflow`, `-testing`, `-code-style`, and
> `-storage`); the personas manifest carries three. Cite constraints by heading, not by number —
> numbering was removed from the MCP server documents after repeated collisions.

**See also:** [Workflow Specification](mcp-server/docs/agents/workflow-specification/README.md) — state machines, routing, handoffs, and edge cases (MCP server scope).

### Sub-Project AGENTS.md

The MCP server sub-project has its own detailed `AGENTS.md`:

- [mcp-server/AGENTS.md](mcp-server/AGENTS.md) — Comprehensive agent operating system specific to the MCP server codebase (efficiency rules, failure protocol, critical constraints, navigation reference).

> When working **exclusively** inside `mcp-server/`, prefer that file for detailed guidance. This root-level document provides workspace-wide orientation and cross-project rules.

---

## Quick Start Workflow — Agent Ingestion Path

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

If your work touches more than one sub-project or root-level scripts, review the Manifest Maintenance Rules in this document and the hub documents [cross-system-dependencies.md](docs/agents/project-manifest/cross-system-dependencies.md) and [root-tooling.md](docs/agents/project-manifest/root-tooling.md).

---

## Manifest Maintenance Rules

### MCP Server (`mcp-server/docs/agents/project-manifest/`)

| Change Made | Documents to Update |
|-------------|---------------------|
| Add new MCP tool | `api-surface.md`, `file-tree.md` (if new file), `data-flows.md` (if new flow) |
| Add new class/service | `api-surface.md`, `file-tree.md` |
| Add/remove dependency | `tech-stack.md` |
| Add new file/directory | `file-tree.md` |
| Change architectural pattern | `tech-stack.md`, `README.md` |
| Add constraint/convention | The matching `constraints-*.md` (workflow / testing / code-style / storage), or `constraints.md` for infrastructure |
| Change anything under `mcp-server/gui/` | `mcp-server/gui/docs/agents/project-manifest/` — the GUI owns its own manifest |
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
| Change a tracked generated file, its generator, or the inputs/commands that produce it (e.g. `personas/name-mapping.json`, `.context/**`, `docs/references/agents-overview.md`, `personas/docs/audits/status.md`) | [`generated-artefacts.md`](personas/docs/agents/project-manifest/generated-artefacts.md) |
| Change how a documentation persona defers to a caller's plan (the shared partial's caller's-plan rule, an inline deferral in the Manifest / AGENTS.md / Documentation Curator, or what the Workspace Architect's dispatches carry) | `personas/shared/partials/documentation-ownership.md` (for the includers' rule); the inline deferral steps in the affected persona sources under `personas/standalone/src/content/`; the Workspace Architect's *Delegation Protocol* inputs; [`constraints.md` → C5f](personas/docs/agents/project-manifest/constraints.md#nested-delegation) |

### Root-Level / Cross-Project

| Change Made | Documents to Update |
|-------------|---------------------|
| Add/modify agent role | `mcp-server/` → `constraints.md`, `personas/` → `constraints.md` |
| Add OS-specific code or dependency | This `AGENTS.md` → Cross-Platform Policy; affected sub-project's `constraints.md` |
| Add or change a root-level script | [`root-tooling.md`](docs/agents/project-manifest/root-tooling.md) (hub), root `README.md` |
| Add or change a cross-system sync point | [`cross-system-dependencies.md`](docs/agents/project-manifest/cross-system-dependencies.md) (hub) |
| Restructure workspace | `mcp-server/…/file-tree.md`, this `AGENTS.md`, regenerate `.context/` |
| Change workflow logic (state machines, routing, handoffs, edge cases) | `mcp-server/docs/agents/workflow-specification/` **first**, then implementation code, then tests, then `mcp-server/docs/agents/project-manifest/constraints-workflow.md` |
| Change changelog convention | This `AGENTS.md` → Changelog Convention section; Changelog Curator persona source |

---

## Efficiency Rules — Search Smart, Read Less

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
| `mcp-server/gui/` | [GUI manifest](mcp-server/gui/docs/agents/project-manifest/README.md) — not the MCP server manifest |
| `personas/ledger/src/`, `scripts/build-personas.js` | Personas manifest |
| `personas/standalone/src/` | Personas manifest |
| `personas/ledger-support/src/` | Personas manifest |
| `personas/ledger/vs-code/*.agent.md`, `personas/ledger/claude-code/*.md` (generated output) | Personas manifest — **never edit these directly** |
| `personas/standalone/vs-code/*.agent.md`, `personas/standalone/claude-code/*.md` (generated output) | Personas manifest — **never edit these directly** |
| `personas/ledger-support/vs-code/*.agent.md`, `personas/ledger-support/claude-code/*.md` (generated output) | Personas manifest — **never edit these directly** |
| `scripts/sync-personas.js`, `scripts/build-personas.js`, other `scripts/` | Both manifests, [root-tooling.md](docs/agents/project-manifest/root-tooling.md), root `README.md` |
| A sync point between sub-projects, root scripts or shared files | [cross-system-dependencies.md](docs/agents/project-manifest/cross-system-dependencies.md) |
| `orchestrator/src/`, `orchestrator/tests/` | [Orchestrator manifest](orchestrator/docs/agents/project-manifest/README.md) |

### Anti-Patterns

| Avoid | Prefer |
|---------------|-------------|
| Grep entire workspace for a tool name | Search `mcp-server/…/api-surface.md` |
| Read generated persona files to understand template logic | Read `personas/…/api-surface.md` + `data-flows.md` |
| Read 10 source files to understand status transitions | Read the Workflow Specification §6.2 |
| Search code to find where a file lives | Check `file-tree.md` (mcp-server) or `.context/` tree (personas) |
| Get a full module overview (API + source + tests) | Read `.context/{module}/` generated docs | Manifest `api-surface.md` | Source code |

### Generated Context Docs (`.context/`)

The [CTX Generator](https://github.com/context-hub/generator) produces Markdown snapshots of the entire codebase. Run `node scripts/cli.js ctx-generate` to regenerate. Output lives in `.context/` (tracked in VCS).

| Path | Contents |
|------|----------|
| `.context/README.md` | Workspace overview (mirrors root `README.md`) |
| `.context/workspace-structure.md` | Top-level directory tree (depth 3) |
| `.context/scripts.md` | All workspace scripts source |
| `.context/shared-manifest.md` | `workflow-manifest.json` + schema |
| `.context/project-manifest.md` | Root manifest hub (module links, cross-system dependencies, root tooling) |
| `.context/mcp-server/overview.md` | MCP server README |
| `.context/mcp-server/manifest-readme.md` | MCP server manifest: project overview + GUI sub-manifest hub |
| `.context/mcp-server/manifest-api-surface.md` | MCP server manifest: full API surface |
| `.context/mcp-server/manifest-constraints.md` | MCP server manifest: all five constraints documents + GUI constraints |
| `.context/mcp-server/manifest-tech-stack.md` | MCP server manifest: tech stack and patterns (core + GUI) |
| `.context/mcp-server/manifest-data-flows.md` | MCP server manifest: data flows |
| `.context/mcp-server/manifest-file-tree.md` | MCP server manifest: annotated file tree |
| `.context/mcp-server/workflow-spec-state.md` | Workflow spec: overview, state machines, data model |
| `.context/mcp-server/workflow-spec-operations.md` | Workflow spec: operations, routing, handoffs, walkthrough |
| `.context/mcp-server/workflow-spec-edge-cases.md` | Workflow spec: edge cases, dependencies, auxiliary systems |
| `.context/mcp-server/tests.md` | Test suite directory tree |
| `.context/mcp-server/file-structure.md` | MCP server directory tree |
| `.context/mcp-server/source-gui-api-handlers.md` | MCP server GUI: API handler source |
| `.context/mcp-server/source-gui-frontend.md` | MCP server GUI: frontend source |
| `.context/orchestrator/overview.md` | Orchestrator README |
| `.context/orchestrator/documentation.md` | Architecture, routing, log schema, public API docs |
| `.context/orchestrator/manifest.md` | Orchestrator project manifest (incl. `decisions.md`) |
| `.context/orchestrator/tests.md` | Test suite directory tree |
| `.context/orchestrator/file-structure.md` | Orchestrator directory tree |
| `.context/personas/overview.md` | Personas README |
| `.context/personas/manifest.md` | Personas project manifest |
| `.context/personas/ledger-suite.md` | Ledger workflow user guide |
| `.context/personas/standalone-suite.md` | Standalone personas guide |
| `.context/personas/ledger-support-suite.md` | Ledger support personas guide |
| `.context/personas/shared-partials.md` | Cross-suite Markdown partials |
| `.context/personas/ledger-metadata.md` | Ledger persona YAML metadata |
| `.context/personas/standalone-metadata.md` | Standalone persona YAML metadata |
| `.context/personas/ledger-support-metadata.md` | Ledger support persona YAML metadata |
| `.context/personas/file-structure.md` | Personas directory tree |

> **Tip:** These files are ideal for feeding into LLMs or external tools (e.g. NotebookLM) that need a full codebase snapshot without cloning the repo.

---

## Failure Protocol & Decision Matrix

| Scenario | Action | Priority |
|----------|--------|----------|
| **Manifest vs. code conflict** | Trust manifest. Flag code for correction. | MUST |
| **Ambiguous requirement** | Use most restrictive interpretation. Document assumption. | MUST |
| **Missing manifest documentation** | Flag gap. Do not invent facts. Draft entry for review. | MUST |
| **Untested code path** | Proceed with caution. Add test recommendation. | SHOULD |
| **Cross-project role mismatch** | Both `AGENT_ROLES` and `KNOWN_ROLES` derive from `shared/workflow-manifest.json` — run `node scripts/validate-workflow-manifest.js` to verify the manifest is self-consistent. Verify persona YAML `role` fields are valid manifest role names (validated automatically by `build-personas.js`). Flag any divergence. | MUST |
| **Unclear which manifest applies** | If change touches both sub-projects, consult both. When in doubt, default to the MCP server manifest. | SHOULD |
| **Generated file needs change** | Never edit generated persona files. Trace back to the relevant suite source (`personas/ledger/src/`, `personas/standalone/src/`, or `personas/ledger-support/src/`) and change the template source. | MUST |
| **Published artifact needs change** | `personas/docs/persona-design-guide.md` and `personas/standalone/src/content/persona-curator.md` are fetched by unrelated downstream projects covering non-coding domains. Keep both domain-neutral — project-specific inventories go in `personas/docs/agents/project-manifest/constraints.md` (C5d). Top-level heading renames break a downstream sync anchor: flag them, never apply silently. | MUST |
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

## Cross-System Dependencies

The synchronisation points between sub-projects, root scripts and shared files are tabulated in [`cross-system-dependencies.md`](docs/agents/project-manifest/cross-system-dependencies.md) under *Dependency Table*; the commands that check them are under *Validation Scripts* in the same document. These are silent-failure points: breaking one produces no error.

> **MUST:** Before changing either side of a sync point, read the [Dependency Table](docs/agents/project-manifest/cross-system-dependencies.md#dependency-table) and update every counterpart it lists. When a change adds or alters a sync point, update the table in the same change.

---

## Cross-Platform Policy

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

## Changelog Convention

This workspace uses a **hub-and-spoke changelog model**: each sub-project maintains its own detailed changelog, and the root changelog aggregates the highlights into versioned releases.

### File Locations

| File | Scope | Versioning |
|------|-------|------------|
| `changelog.md` (root) | Workspace-wide release summary | SemVer, tagged in Git (`v1.9.0`, …) |
| `mcp-server/changelog.md` | MCP server changes only | Own SemVer (`v1.14.0`, …), **not** Git-tagged |
| `orchestrator/changelog.md` | Orchestrator changes only | Own SemVer (`v0.5.0`, …), **not** Git-tagged |
| `personas/changelog.md` | Summary of the most relevant persona and build-system changes; individual persona changes are tracked in each persona's integrated changelog | Own SemVer (`v3.9.1`, …), **not** Git-tagged |

### Rules

1. **Only the root changelog triggers Git tags/releases.** Module changelogs track internal history but have no corresponding Git tags.
2. **Module changelogs come first.** When preparing a release, update each affected module changelog before writing the root entry.
3. **Root entries reference module versions.** Use the blockquote line format to link back: `> mcp v1.14.0 · personas v3.9.1 · orchestrator v0.4.0`. Omit modules that had no changes.
4. **Root entries summarize, not duplicate.** Each root bullet condenses multiple module-level bullets into one outcome-oriented line. Implementation detail stays in the module changelog.
5. **House style applies everywhere.** All changelogs follow the Changelog Curator's house style: flat bullet list with category prefixes, no `### Added/Changed/Fixed` sub-headers, ≤ 100-char lines.
6. **Version bumps:** Root version follows SemVer based on the most significant change across all modules. Module versions are incremented independently.
7. **`scripts/extract-changelog-entry.js`** parses the topmost root changelog entry for CI/GitHub Actions release automation.
8. **Personas changelog is summary-only:** Since each persona has an integrated changelog, `personas/changelog.md` entries summarize outcomes only — rationale, implementation mechanism, and file-level detail belong exclusively in that persona's own YAML `changelog` field, never here.
   - **Guardrail:** cap each release entry at roughly one bullet per affected persona or per cross-cutting theme (shared partials, build tooling, docs). Needing 5+ individual per-persona bullets under one theme is a sign to group them into a single thematic bullet instead.
   - **Anti-pattern** (rationale-laden, restates mechanism — do not write this): *"Standalone: Redesigned the Persona Curator to fix a tone violation in its Core Philosophy section, converting three imperative-mood principles to indicative mood and adding a Philosophy Tone Pass step to its own validation workflow so it can catch the same issue in personas it audits going forward."*
   - **Good pattern** (outcome-only, one line — write this instead): *"Standalone: Persona Curator gained a Philosophy Tone Pass and accepted-deviation reporting."*
   - This duplication risk is specific to `personas/changelog.md`, since personas carry their own integrated changelogs to defer detail to. `mcp-server/changelog.md` and `orchestrator/changelog.md` have no equivalent per-item changelog — rule 5's single-line house style is the existing safeguard there.
   - `scripts/build-personas.js` now warns (never fails) when the newest entry exceeds mechanical line/bullet/sentence-per-bullet/line-length thresholds, via `scripts/lib/changelog-size-check.js`.

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

## Project Statistics

| Property | MCP Server | Personas | Orchestrator |
|----------|-----------|----------|--------------|
| **Language** | TypeScript 5.7.2 (ES2022) | JavaScript (ES2020+, CJS) | Python 3.11+ |
| **Runtime** | Node.js (ESM) | Node.js (CommonJS) | CPython |
| **Architecture** | MCP Server + Repository Pattern | Template Engine (3-Phase Pipeline) | LangGraph StateGraph + Deep Agents |
| **Package Manager** | npm | npm | pip |
| **Test Framework** | Vitest | — (none; `--check` is a write-free validation run, not a test suite) | pytest |
| **Build Tool** | `tsc` | `build-personas.js` (via `@mistralys/persona-builder`) | — (source install) |
| **Prod Dependencies** | `@modelcontextprotocol/sdk`, `zod`, `proper-lockfile` | `@mistralys/persona-builder`, `js-yaml` | core: `aiosqlite`, `deepagents`, `langchain-core`, `langchain-mcp-adapters`, `langgraph`, `langgraph-checkpoint-sqlite`, `python-dotenv`; optional: `anthropic`, `google` |
| **Dev Dependencies** | `@types/node`, `@types/proper-lockfile`, `@vitest/coverage-v8`, `jsdom`, `tsx`, `typescript`, `vitest` | — | `pytest`, `pytest-asyncio`, `ruff` |

### Root-Level Tooling

The root-level scripts, shared libraries, `shared/workflow-manifest.json` and its schema, and `context.yaml` are inventoried in [`root-tooling.md`](docs/agents/project-manifest/root-tooling.md) (heading *Files and Scripts*).

---

## Navigation Quick Reference

| I Need To… | Go Here |
|------------|---------|
| Understand the whole workspace | [README.md](README.md) |
| See all project manifests | [docs/agents/project-manifest/](docs/agents/project-manifest/README.md) |
| Check what must stay in sync across systems | [cross-system-dependencies.md](docs/agents/project-manifest/cross-system-dependencies.md) |
| Look up a root-level script or shared file | [root-tooling.md](docs/agents/project-manifest/root-tooling.md) |
| Work on the MCP server | [mcp-server/AGENTS.md](mcp-server/AGENTS.md) → then its manifest |
| Work on persona templates | [personas/docs/agents/project-manifest/](personas/docs/agents/project-manifest/) |
| Work on the orchestrator | [orchestrator/docs/agents/project-manifest/](orchestrator/docs/agents/project-manifest/README.md) |
| Look up an MCP tool signature | [mcp-server/…/api-surface.md](mcp-server/docs/agents/project-manifest/api-surface.md) |
| Look up template syntax | [personas/…/api-surface.md](personas/docs/agents/project-manifest/api-surface.md) |
| Find a file in mcp-server | [mcp-server/…/file-tree.md](mcp-server/docs/agents/project-manifest/file-tree.md) |
| Find a file in personas | `.context/personas/file-structure.md` (auto-generated) |
| See MCP server constraints | [mcp-server/…/constraints.md](mcp-server/docs/agents/project-manifest/constraints.md) (core) — plus [workflow](mcp-server/docs/agents/project-manifest/constraints-workflow.md), [testing](mcp-server/docs/agents/project-manifest/constraints-testing.md), [code style](mcp-server/docs/agents/project-manifest/constraints-code-style.md), [storage](mcp-server/docs/agents/project-manifest/constraints-storage.md) |
| See GUI constraints | [mcp-server/gui/…/constraints.md](mcp-server/gui/docs/agents/project-manifest/constraints.md) |
| See persona system constraints | [personas/…/constraints.md](personas/docs/agents/project-manifest/constraints.md) |
| See orchestrator design decisions | [orchestrator/…/decisions.md](orchestrator/docs/agents/project-manifest/decisions.md) |
| Understand the ledger agent workflow | [personas/ledger/README.md](personas/ledger/README.md) |
| Understand workflow logic (state machines, routing, handoffs) | [Workflow Specification](mcp-server/docs/agents/workflow-specification/README.md) |
| Review past discussions | [discussions/](docs/discussions/) |
| Review error history | [history/error-ledger.md](docs/history/error-ledger.md) |
| Review key learnings | [history/key-learnings.md](docs/history/key-learnings.md) |
| Get a full codebase snapshot for LLMs | `.context/` (run `node scripts/cli.js ctx-generate` to regenerate) |
| Understand changelog workflow | Changelog Convention section (this file) |

---

## Generated Artefacts

Some tracked files are written by build commands, not by hand: the persona name mapping, the CTX context docs, and generated reference documents. [`generated-artefacts.md`](personas/docs/agents/project-manifest/generated-artefacts.md) records which files these are, what produces each, and when a modified copy may be discarded. How they are handled on a branch is set by the [Standing Decision](personas/docs/agents/project-manifest/curation-log.md#standing-decisions) of 2026-10-16. The [Git Committer](personas/standalone/src/content/git-committer.md) persona enforces it and is the authority, and [Purpose and Branch Policy](personas/docs/agents/project-manifest/generated-artefacts.md#purpose-and-branch-policy) summarises it. The rules below apply workspace-wide.

| Scenario | Action | Priority |
|----------|--------|----------|
| **A modified tracked file may be generated** | Classify it against [Tracked Generated Artefacts](personas/docs/agents/project-manifest/generated-artefacts.md#tracked-generated-artefacts) before discarding it. | MUST |
| **Generator drift on a feature branch** | Keep it out of every commit, and revert it by path before integrating upstream, as the [Standing Decision](personas/docs/agents/project-manifest/curation-log.md#standing-decisions) sets out. | MUST |
| **Committing on a branch that is not a feature branch (e.g. the default branch)** | Make the very first step a fresh Build & Maintain run (CLI menu action; `node scripts/cli.js build-maintain`), so every generated artefact is current before anything is committed. On a feature branch, skip the step: generated artefacts are not committed there. See [Purpose and Branch Policy](docs/agents/project-manifest/generated-artefacts.md#purpose-and-branch-policy). | MUST |
| **CTX context output changed** | Commit it only on the default branch, as its own commit, per the [Standing Decision](personas/docs/agents/project-manifest/curation-log.md#standing-decisions). On a feature branch all of it counts as drift. | MUST |
| **A generated file's diff is only a timestamp or date** | Never commit it ([Standing Decision](personas/docs/agents/project-manifest/curation-log.md#standing-decisions)). | MUST |
| **The branch changed the source of a generated file** | Keep the file, regenerate it, and commit it with that source change. This applies especially to runtime-coupled artefacts ([`constraints.md` → Generated Artefacts](personas/docs/agents/project-manifest/constraints.md#generated-artefacts)). | MUST |
| **A file sits beside generated output or feeds a generator** | Never revert it as build noise. Check [Hand-maintained Neighbours](personas/docs/agents/project-manifest/generated-artefacts.md#hand-maintained-neighbours) first. | MUST |
| **A generated file's diff matches a known contradiction** | Handle it as [Known Contradictions](personas/docs/agents/project-manifest/generated-artefacts.md#known-contradictions) describes, not as a defect to fix. | MUST |
| **Discarding is needed** | Revert by path only, never by whole-tree restore. | MUST |
| **The manifest and the Git Committer disagree** | Follow the Git Committer, and report the manifest entry to the Manifest Curator for correction. | MUST |
| **Unsure whether a file is generated** | Leave it and ask the user. | MUST |

---

**Version:** 1.2.2
**Last Updated:** 2026-10-19
**Maintained By:** AGENTS.md Curator Agent
