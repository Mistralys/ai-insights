# Personas - Overview
<INSTRUCTION>
# Personas - Overview
README for the Ledger Personas Build System: suites, build pipeline, quick-start, and usage guide.

</INSTRUCTION>
------------------------------------------------------------
_SOURCE: Overview_
# Overview
```
// Structure of documents
└── personas/
    └── README.md

```
###  Path: `/personas/README.md`

```md
# Ledger Personas Build System

A Node.js template engine that assembles **generated AI agent persona files** for three output targets from structured YAML metadata and Markdown content templates. The generated personas define the behaviour of AI agents across three distinct suites:

- **Ledger Suite** (`ledger/`) — Personas for the multi-agent software development workflow backed by the [Project Ledger MCP Server](../mcp-server/README.md). Each persona maps to a pipeline stage (Planner → PM → Developer → QA → Security Auditor → Reviewer → Release Engineer → Documentation → Synthesis).
- **Standalone Suite** (`standalone/`) — Single-purpose personas that operate independently of the ledger workflow. Includes the PM sub-agent cluster (WP Decomposer, Dependency Sequencer, Pipeline Configurator, Ledger Bootstrapper) and general-purpose specialists (README Curator, Changelog Curator, CTX Architect, Git Committer, etc.).
- **Ledger-Support Suite** (`ledger-support/`) — Specialist sub-agent personas used within the ledger workflow as delegates from primary ledger agents (e.g., WP Decomposer, Bootstrapper, CTX Architect, Changelog Curator).

Each suite produces output for three targets — **VS Code** (`.agent.md`), **Claude Code** (plain `.md`), and **Deep Agents** (`.md`).

## Key Concepts

- **Three-Phase Build Pipeline:** For each persona the build script executes: (1) load YAML metadata + merge shared defaults, (2) resolve Mustache-style `{{variable}}` and `{{> partial}}` markers in content templates, (3) wrap in IDE-specific frontmatter and write to target directories.
- **Shared Partials:** Cross-cutting content blocks (operational protocols, output formats, incident logging) live in `shared/partials/` and `ledger/src/partials/`. Any persona can include them via `{{> partial-name}}`.
- **Suite Isolation:** Ledger, standalone, and ledger-support suites have independent metadata (`_shared.yaml`, per-persona YAML), content templates, and output directories. They share only the `shared/partials/` layer.
- **Three-Target Output:** A single content template produces VS Code, Claude Code, and Deep Agents variants. Only the frontmatter wrapper differs between targets.

## Directory Structure

```
personas/
├── package.json                    # Build tooling package (js-yaml dependency)
├── changelog.md                    # Persona system changelog
├── docs/agents/project-manifest/   # Authoritative project manifest
├── model-registry/                 # File-based model registry
│   ├── README.md                   # Schema, seed/working-copy lifecycle, and UUID convention
│   ├── default.json                # Shipped seed models (tracked in Git)
│   ├── local.json                  # User model list — auto-initialized from default.json (gitignored)
│   └── assignments.json            # Per-persona model assignments (gitignored)
├── shared/partials/                # Cross-suite Markdown partials
├── ledger/
│   ├── README.md                   # Ledger workflow user guide
│   ├── src/
│   │   ├── meta/                   # YAML metadata (_shared.yaml + per-persona YAML)
│   │   ├── content/                # Markdown content templates
│   │   └── partials/               # Ledger-only partials (MCP blocks, handoffs)
│   ├── vs-code/                    # Generated VS Code output (.agent.md)
│   ├── claude-code/                # Generated Claude Code output (.md)
│   └── deep-agents/                # Generated Deep Agents output (.md)
├── standalone/
│   ├── README.md                   # Standalone personas user guide
│   ├── src/
│   │   ├── meta/                   # YAML metadata (_shared.yaml + per-persona YAML)
│   │   └── content/                # Markdown content templates
│   ├── vs-code/                    # Generated VS Code output (.agent.md)
│   ├── claude-code/                # Generated Claude Code output (.md)
│   └── deep-agents/                # Generated Deep Agents output (.md)
└── ledger-support/
    ├── src/
    │   ├── meta/                   # YAML metadata (_shared.yaml + per-persona YAML)
    │   └── content/                # Markdown content templates
    ├── vs-code/                    # Generated VS Code output (.agent.md)
    ├── claude-code/                # Generated Claude Code output (.md)
    └── deep-agents/                # Generated Deep Agents output (.md)
```

## Build Commands

Suite and target selection lives in `personas/persona-build.config.js`. The build script takes no `--suite` or `--target` flag, so every command below builds every suite and target defined there.

```bash
# Build all suites and targets
node scripts/build-personas.js

# Render in memory and write nothing; fails only on error-severity validation results
# (does not compare against files on disk)
node scripts/build-personas.js --check

# Also fail on warning-severity validation results; add --check to keep the run write-free
node scripts/build-personas.js --strict --check

# Build everything, then deploy to VS Code / Claude Code
# (--target vscode | claude-code | all selects only which deploy steps run)
node scripts/sync-personas.js
```

Unresolved `{{…}}` markers print a `[WARN]` line and do not fail the build, even under `--strict`. See [Build-system constraints](docs/agents/project-manifest/constraints-build-system.md#b6) for details.

## Integration Points

- **MCP Server:** Ledger personas reference MCP tools exposed by `mcp-server/`. The server name is configured in `ledger/src/meta/_shared.yaml` → `mcp_server_name`.
- **Workflow Manifest:** Persona `role` fields (ledger suite) are validated against role names in `shared/workflow-manifest.json` during the build.
- **Sync Script:** `scripts/sync-personas.js` rebuilds every suite, then deploys the output to the VS Code agents directory (`~/.copilot/agents/`) and/or Claude Code's `~/.claude/agents/`. Its `--target` flag (`vscode`, `claude-code`, or `all`, the default) selects only which deploy steps run; the `claude-code` and `all` targets also sync skills from `.claude/skills/` to `~/.claude/skills/`.

## Further Reading

- [Ledger Workflow Guide](ledger/README.md) — Step-by-step usage for the ledger agent pipeline
- [Ledger Workflow Visual Guide](../docs/agents/references/ledger-workflow-visual-guide.md) — Diagram-first reference for stages, handoffs, sub-agents, and ledger knowledge flow
- [Standalone Personas Guide](standalone/README.md) — Catalog and usage for the standalone personas
- [Ledger-Support Personas Guide](ledger-support/README.md) — Catalog and usage for the ledger-support sub-agent personas
- [Project Manifest](docs/agents/project-manifest/README.md) — Authoritative technical reference (API surface, constraints, data flows)

```