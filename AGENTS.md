# AI Agents Operating System — AI Insights Workspace

> **Purpose:** This document is the authoritative entry point for AI agents entering the **ai-insights** workspace. It defines how agents discover, navigate, and interact with the sub-projects and their shared infrastructure to ensure architectural integrity and token efficiency.

---

## Workspace Architecture

This is a monorepo-style workspace: the Project Ledger MCP server (`mcp-server/`), the persona build system (`personas/`), the orchestrator (`orchestrator/`) and shared root-level tooling (`scripts/`, `shared/`). What each part is, the language it uses and how the parts relate are stated in the hub's [Workspace Overview](docs/agents/project-manifest/README.md#workspace-overview); this file routes to that material and does not restate it.

---

## Project Manifests — Start Here!

**Core Philosophy:** The Project Manifests are the canonical documentation of this codebase. If implementation code contradicts a manifest, the **code is more likely wrong** — but a manifest can be stale too, so verify before acting (see the *Manifest vs. code conflict* row in the Failure Protocol).

**Unified entry point:** [`docs/agents/project-manifest/`](docs/agents/project-manifest/README.md) — links to all module manifests, the [cross-system dependencies](docs/agents/project-manifest/cross-system-dependencies.md), [root-level tooling](docs/agents/project-manifest/root-tooling.md), [development commands](docs/agents/project-manifest/development-commands.md) (commands, toolchain versions, verification by change type), the [live workspace](docs/agents/project-manifest/live-workspace.md) notes, the [plan folder layout](docs/agents/project-manifest/plan-folders.md), [generated artefacts](docs/agents/project-manifest/generated-artefacts.md) and [constraints](docs/agents/project-manifest/constraints.md) (critical rules digest, git operations, live workspace, cross-platform policy, changelog convention) hub documents, and a navigation guide.

Each sub-project maintains its own detailed manifest:

| Module | Manifest Location |
|--------|-------------------|
| **MCP Server** | [`mcp-server/docs/agents/project-manifest/`](mcp-server/docs/agents/project-manifest/README.md) |
| **MCP Server GUI** | [`mcp-server/gui/docs/agents/project-manifest/`](mcp-server/gui/docs/agents/project-manifest/README.md) |
| **Personas** | [`personas/docs/agents/project-manifest/`](personas/docs/agents/project-manifest/README.md) |
| **Orchestrator** | [`orchestrator/docs/agents/project-manifest/`](orchestrator/docs/agents/project-manifest/README.md) |

> **Constraints are split by domain.** The MCP server and personas manifests each carry several
> constraints documents (`constraints.md` for core infrastructure, plus domain-specific siblings).
> Cite constraints by heading, not by number — numbering was removed from the MCP server documents
> after repeated collisions.

**See also:** [Workflow Specification](mcp-server/docs/agents/workflow-specification/README.md) — state machines, routing, handoffs, and edge cases (MCP server scope).

### Sub-Project AGENTS.md

The MCP server sub-project has its own detailed `AGENTS.md`:

- [mcp-server/AGENTS.md](mcp-server/AGENTS.md) — Comprehensive agent operating system specific to the MCP server codebase (efficiency rules, failure protocol, critical constraints, navigation reference).

> When working **exclusively** inside `mcp-server/`, prefer that file for detailed guidance. This root-level document provides workspace-wide orientation and cross-project rules.

---

## Quick Start Workflow — Agent Ingestion Path

### Step 1: Determine Your Scope

| Working on… | Start with |
|-------------|------------|
| The MCP server | Its [manifest](mcp-server/docs/agents/project-manifest/README.md), then [mcp-server/AGENTS.md](mcp-server/AGENTS.md) |
| The MCP server GUI | The [GUI manifest](mcp-server/gui/docs/agents/project-manifest/README.md) — not the MCP server manifest |
| The persona system | The [personas manifest](personas/docs/agents/project-manifest/README.md) |
| The orchestrator | The [orchestrator manifest](orchestrator/docs/agents/project-manifest/README.md) |
| A sync point between sub-projects, root scripts or shared files | [cross-system-dependencies.md](docs/agents/project-manifest/cross-system-dependencies.md) |
| Root-level scripts | [root-tooling.md](docs/agents/project-manifest/root-tooling.md) and the root [README.md](README.md) |
| A generated file | [generated-artefacts.md](docs/agents/project-manifest/generated-artefacts.md) |
| Cross-project work | Every affected manifest, plus the cross-project rules in this file |

### Step 2: Ingest the Relevant Manifest

Follow this sequence for whichever sub-project you're entering:

1. **Read README.md** — Understand project purpose and context
2. **Read tech-stack.md** — Understand runtime, frameworks, and patterns
3. **Read constraints.md** — MANDATORY before making any changes. At the hub, the [Critical Rules](docs/agents/project-manifest/constraints.md#critical-rules) digest at the top is the one-hop start; it links each rule to its owning document
4. **Consult file-tree.md + api-surface.md** — Find files and public interfaces
5. **Read source code** — Only when implementation details are needed

### Step 3: Check Cross-Project Rules (below)

If your work touches more than one sub-project or root-level scripts, review the Manifest Maintenance Rules in this document and the hub documents [cross-system-dependencies.md](docs/agents/project-manifest/cross-system-dependencies.md) and [root-tooling.md](docs/agents/project-manifest/root-tooling.md).

---

## Manifest Maintenance Rules

### MCP Server (`mcp-server/`)

Changes under `mcp-server/`, the GUI included, follow the *Manifest Maintenance Rules* section of [mcp-server/AGENTS.md](mcp-server/AGENTS.md). That file is the topmost one they apply to, so they are not restated here.

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
| Change how a documentation persona defers to a caller's plan, or what the Workspace Architect's dispatches carry | The locations listed in [`constraints.md` → Nested delegation](personas/docs/agents/project-manifest/constraints.md#nested-delegation), and that entry's table in the same change |

### Root-Level / Cross-Project

| Change Made | Documents to Update |
|-------------|---------------------|
| Add/modify agent role | `mcp-server/` → `constraints.md`, `personas/` → `constraints.md` |
| Add OS-specific code or dependency | [`constraints.md` → Cross-Platform Policy](docs/agents/project-manifest/constraints.md#cross-platform-policy) (hub); affected sub-project's `constraints.md` |
| Add or change a root-level script | [`root-tooling.md`](docs/agents/project-manifest/root-tooling.md) (hub), root `README.md`, and [`development-commands.md`](docs/agents/project-manifest/development-commands.md) where it is a command a developer runs |
| Add or change a build, test, lint, typecheck or start command, or a toolchain version, in any module | [`development-commands.md`](docs/agents/project-manifest/development-commands.md) (hub), and the module's `tech-stack.md` |
| Add or change a check that a kind of change must pass | [`development-commands.md` → Verification by Change Type](docs/agents/project-manifest/development-commands.md#verification-by-change-type) (hub) |
| Change what the running Ledger server reads, or how it is started | [`live-workspace.md`](docs/agents/project-manifest/live-workspace.md) (hub) |
| Change the files a plan folder holds, who writes them, or how the folder is archived | [`plan-folders.md`](docs/agents/project-manifest/plan-folders.md) (hub) |
| Add or change a workspace-wide binding rule | [`constraints.md`](docs/agents/project-manifest/constraints.md) (hub), and its [Critical Rules](docs/agents/project-manifest/constraints.md#critical-rules) digest when the rule is high-impact |
| Add a generator, a tracked generated file or a changed source-to-artefact dependency, in any module (personas, MCP server, orchestrator) or at the root | [`generated-artefacts.md`](docs/agents/project-manifest/generated-artefacts.md) (hub) — the single document for all modules; no module manifest keeps a copy |
| Add or change a cross-system sync point | [`cross-system-dependencies.md`](docs/agents/project-manifest/cross-system-dependencies.md) (hub) |
| Restructure workspace | `mcp-server/…/file-tree.md`, this `AGENTS.md`, and the generated context docs (regeneration is covered in [`generated-artefacts.md`](docs/agents/project-manifest/generated-artefacts.md)) |
| Change workflow logic (state machines, routing, handoffs, edge cases) | `mcp-server/docs/agents/workflow-specification/` **first**, then implementation code, then tests, then `mcp-server/docs/agents/project-manifest/constraints-workflow.md` |
| Change changelog convention | [`constraints.md` → Changelog Convention](docs/agents/project-manifest/constraints.md#changelog-convention) (hub); Changelog Curator persona source |

---

## Efficiency Rules — Search Smart, Read Less

**Token efficiency is critical. Follow this search hierarchy:**

| What You Need | Search Here FIRST | Then Here | Read Source LAST |
|---------------|-------------------|-----------|------------------|
| Find a file location | Relevant `file-tree.md` | grep/file search | Never needed |
| Understand a method/tool | Relevant `api-surface.md` | Source code | Only for implementation logic |
| Trace data flow | Relevant `data-flows.md` | Source code | Only for edge cases |
| Check a rule or convention | Relevant `constraints.md` | Source comments | Only if ambiguous |
| Identify dependencies | Relevant `tech-stack.md` | `package.json` | Never needed |
| Install, build, test (one test or all), lint, typecheck or start something; toolchain versions | [development-commands.md](docs/agents/project-manifest/development-commands.md) | The module's `tech-stack.md` | Never needed |
| What a plan folder holds, who writes each file | [plan-folders.md](docs/agents/project-manifest/plan-folders.md) | The Git Committer and Developer persona sources | Never needed |
| The highest-impact workspace rules | [Critical Rules](docs/agents/project-manifest/constraints.md#critical-rules) | The owning document it links | Never needed |
| Understand patterns | Relevant `tech-stack.md` | Source code | Only for complex logic |

Which manifest is the relevant one is settled by the scope table in Step 1 above.

---

## Failure Protocol & Decision Matrix

| Scenario | Action | Priority |
|----------|--------|----------|
| **Manifest vs. code conflict** | Trust the manifest by default and flag the code. Before acting, verify which side is stale: check the code's history and the related plan or changelog entry. Where the manifest is the stale side, fix a small error in place and dispatch the Manifest Curator for anything larger. Never reword this file to absorb the conflict. | MUST |
| **Git write operation (stage, commit, revert, reset, path checkout, stash, push)** | Per [Git Operations](docs/agents/project-manifest/constraints.md#git-operations), only the [Git Committer](personas/standalone/src/content/git-committer.md) makes commits, and no other agent performs any git write operation. Read-only git commands are allowed. Where a commit or a revert is needed, flag it for the Git Committer or the user. | MUST |
| **Ambiguous requirement** | Use most restrictive interpretation. Document assumption. | MUST |
| **Missing manifest documentation** | Flag gap. Do not invent facts. Draft entry for review. | MUST |
| **Untested code path** | Proceed with caution. Add test recommendation. | SHOULD |
| **Changing either side of a cross-system sync point, agent role names included** | Read the [Dependency Table](docs/agents/project-manifest/cross-system-dependencies.md#dependency-table) and update every counterpart it lists. Run the checks under *Validation Scripts* in the same document, and flag any divergence. When a change adds or alters a sync point, update the table in the same change. These are silent-failure points. | MUST |
| **Editing, releasing or archiving a changelog** | Read [Changelog Convention](docs/agents/project-manifest/constraints.md#changelog-convention) first. | MUST |
| **Adding platform-specific code or a dependency with OS-specific behaviour** | Read [Cross-Platform Policy](docs/agents/project-manifest/constraints.md#cross-platform-policy) first. | MUST |
| **Unclear which manifest applies** | If the change touches more than one module, consult every affected manifest. When in doubt, default to the MCP server manifest. | SHOULD |
| **Generated file needs change** | Never edit generated output. Change its source instead and regenerate: [generated-artefacts.md](docs/agents/project-manifest/generated-artefacts.md) names the source, and for persona output the [Source Editing Rules](personas/docs/agents/project-manifest/constraints.md#source-editing-rules) say where to edit. | MUST |
| **Editing a document that unrelated downstream projects fetch** | Read the [Published artifacts rule](personas/docs/agents/project-manifest/constraints.md#c5d) first. Flag any heading rename to the user; never apply it silently. | MUST |
| **Waiting for a sub-agent under Claude Code, or a dispatch chain seems hung** | Never poll (`sleep`, `until`, Monitor, waiting on a file); end the turn and act on the `<task-notification>`, not the hand-back. See [Debugging a Hung Chain](docs/agents/references/claude-code-subagent-dispatch.md#debugging-a-hung-chain). | MUST |
| **Finishing a change** | Before calling it done, run the checks [Verification by Change Type](docs/agents/project-manifest/development-commands.md#verification-by-change-type) lists for that kind of change, and report any you could not run. | MUST |
| **A change touches what the running Ledger server or its workflow reads** | Read [live-workspace.md](docs/agents/project-manifest/live-workspace.md) and [Live Workspace](docs/agents/project-manifest/constraints.md#live-workspace) first. This workspace hosts the live server; bigger changes belong in a dedicated DEV workspace. | MUST |
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
    ↓ YES → Consult every affected manifest + cross-project rules above
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

## Project Statistics

| Property | MCP Server | Personas | Orchestrator |
|----------|-----------|----------|--------------|
| **Language** | TypeScript (ES2022) | JavaScript (ES2020+, CJS) | Python 3.11+ |
| **Runtime** | Node.js (ESM) | Node.js (CommonJS) | CPython |
| **Architecture** | MCP Server + Repository Pattern | Template Engine (3-Phase Pipeline) | LangGraph StateGraph + Deep Agents |
| **Package Manager** | npm | npm | pip |
| **Test Framework** | Vitest | None | pytest |
| **Build Tool** | `tsc` | `build-personas.js` (via `@mistralys/persona-builder`) | — (source install) |

Dependencies are inventoried in each module's `tech-stack.md`, not here.

---

## Navigation Quick Reference

The manifest hub's [navigation guide](docs/agents/project-manifest/README.md#navigation-quick-reference) covers the manifest documents. These entries point to material outside the manifest.

| I Need To… | Go Here |
|------------|---------|
| Dispatch sub-agents under Claude Code, or debug a hung Claude Code chain | [claude-code-subagent-dispatch.md](docs/agents/references/claude-code-subagent-dispatch.md) |
| Review past discussions | [discussions/](docs/discussions/) |
| Review error history | [history/error-ledger.md](docs/history/error-ledger.md) |
| Review key learnings | [history/key-learnings.md](docs/history/key-learnings.md) |
| Get a full codebase snapshot for LLMs | The *Generated Context* section of the [manifest hub](docs/agents/project-manifest/README.md) |

---

## Generated Artefacts

Some tracked files are written by build commands, not by hand: persona build output, version fields synchronised from changelogs, the CTX context docs, and generated reference documents. [`generated-artefacts.md`](docs/agents/project-manifest/generated-artefacts.md) is the single document for the whole workspace, covering the personas, the MCP server and the orchestrator alike. How these files are handled on a branch is set by the [Standing Decision](personas/docs/agents/project-manifest/curation-log.md#standing-decisions) of 2026-10-16, which the [Git Committer](personas/standalone/src/content/git-committer.md) persona enforces; [Purpose and Branch Policy](docs/agents/project-manifest/generated-artefacts.md#purpose-and-branch-policy) summarises it, including the cases of CTX output and date-only diffs. The build-first row below is the one project-level rule the Git Committer does not enforce. The rules below apply workspace-wide.

| Scenario | Action | Priority |
|----------|--------|----------|
| **A modified tracked file may be generated** | Classify it against [Tracked Generated Artefacts](docs/agents/project-manifest/generated-artefacts.md#tracked-generated-artefacts) and [Known Contradictions](docs/agents/project-manifest/generated-artefacts.md#known-contradictions) before discarding it. | MUST |
| **Generator drift on a feature branch** | Keep it out of every commit, and revert it by path before integrating upstream, as the [Standing Decision](personas/docs/agents/project-manifest/curation-log.md#standing-decisions) sets out. | MUST |
| **Committing on a branch that is not a feature branch (e.g. the default branch)** | Make the very first step a fresh Build & Maintain run (the CLI menu action of that name; the exact command is in [Purpose and Branch Policy](docs/agents/project-manifest/generated-artefacts.md#purpose-and-branch-policy)), so every generated artefact is current before anything is committed. On a feature branch, skip the step: generated artefacts are not committed there. | MUST |
| **The branch changed the source of a generated file** | Keep the file, regenerate it, and commit it with that source change. This applies especially to runtime-coupled artefacts; each module's rules are in its own `constraints.md` → Generated Artefacts ([personas](personas/docs/agents/project-manifest/constraints.md#generated-artefacts), [MCP server](mcp-server/docs/agents/project-manifest/constraints.md#generated-artefacts), [orchestrator](orchestrator/docs/agents/project-manifest/constraints.md#generated-artefacts)). | MUST |
| **A file sits beside generated output or feeds a generator** | Never revert it as build noise. Check [Hand-maintained Neighbours](docs/agents/project-manifest/generated-artefacts.md#hand-maintained-neighbours) first. | MUST |
| **Discarding is needed** | Revert by path only, never by whole-tree restore. The revert is a git write operation, so the Git Committer or the user performs it; other agents flag the path. | MUST |
| **Unsure whether a file is generated** | Leave it and ask the user. | MUST |
