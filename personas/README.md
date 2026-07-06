# Ledger Personas Build System

A Node.js template engine that assembles **120 generated AI agent persona files** (40 personas × 3 output targets) from structured YAML metadata and Markdown content templates. The generated personas define the behaviour of AI agents across three distinct suites:

- **Ledger Suite** (`ledger/`) — 9 personas for the multi-agent software development workflow backed by the [Project Ledger MCP Server](../mcp-server/README.md). Each persona maps to a pipeline stage (Planner → PM → Developer → QA → Security Auditor → Reviewer → Release Engineer → Documentation → Synthesis).
- **Standalone Suite** (`standalone/`) — 21 single-purpose personas that operate independently of the ledger workflow. Includes the PM sub-agent cluster (WP Decomposer, Dependency Sequencer, Pipeline Configurator, Ledger Bootstrapper) and general-purpose specialists (README Curator, Changelog Curator, CTX Architect, Git Committer, etc.).
- **Ledger-Support Suite** (`ledger-support/`) — 10 specialist sub-agent personas used within the ledger workflow as delegates from primary ledger agents (e.g., WP Decomposer, Bootstrapper, CTX Architect, Changelog Curator).

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
├── docs/agents/project-manifest/   # Authoritative project manifest (6 documents)
├── shared/partials/                # Cross-suite Markdown partials (20+ files)
├── ledger/
│   ├── README.md                   # Ledger workflow user guide
│   ├── src/
│   │   ├── meta/                   # YAML metadata (_shared.yaml + 9 per-persona)
│   │   ├── content/                # Markdown content templates (9 files)
│   │   └── partials/               # Ledger-only partials (MCP blocks, handoffs)
│   ├── vs-code/                    # Generated VS Code output (9 .agent.md files)
│   ├── claude-code/                # Generated Claude Code output (9 .md files)
│   └── deep-agents/                # Generated Deep Agents output (9 .md files)
├── standalone/
│   ├── README.md                   # Standalone personas user guide
│   ├── src/
│   │   ├── meta/                   # YAML metadata (_shared.yaml + 21 per-persona)
│   │   └── content/                # Markdown content templates (21 files)
│   ├── vs-code/                    # Generated VS Code output (21 .agent.md files)
│   ├── claude-code/                # Generated Claude Code output (21 .md files)
│   └── deep-agents/                # Generated Deep Agents output (21 .md files)
└── ledger-support/
    ├── src/
    │   ├── meta/                   # YAML metadata (_shared.yaml + 10 per-persona)
    │   └── content/                # Markdown content templates (10 files)
    ├── vs-code/                    # Generated VS Code output (10 .agent.md files)
    ├── claude-code/                # Generated Claude Code output (10 .md files)
    └── deep-agents/                # Generated Deep Agents output (10 .md files)
```

## Build Commands

```bash
# Build ledger suite (default)
node scripts/build-personas.js

# Build standalone suite
node scripts/build-personas.js --suite standalone

# Build all suites
node scripts/build-personas.js --suite all

# Check for stale output (CI-friendly)
node scripts/build-personas.js --check

# Validate no unresolved markers
node scripts/build-personas.js --strict --suite all

# Build + deploy to VS Code / Claude Code
node scripts/sync-personas.js
```

## Integration Points

- **MCP Server:** Ledger personas reference MCP tools exposed by `mcp-server/`. The server name is configured in `ledger/src/meta/_shared.yaml` → `mcp_server_name`.
- **Workflow Manifest:** Persona `role` fields (ledger suite) are validated against role names in `shared/workflow-manifest.json` during the build.
- **Sync Script:** `scripts/sync-personas.js` deploys generated output to the VS Code User prompts directory and/or Claude Code's `~/.claude/agents/`.

## Further Reading

- [Ledger Workflow Guide](ledger/README.md) — Step-by-step usage for the 9-agent pipeline
- [Ledger Workflow Visual Guide](../docs/agents/references/ledger-workflow-visual-guide.md) — Diagram-first reference for stages, handoffs, sub-agents, and ledger knowledge flow
- [Standalone Personas Guide](standalone/README.md) — Catalog and usage for all 21 standalone personas
- [Ledger-Support Personas Guide](ledger-support/README.md) — Catalog and usage for all 10 ledger-support sub-agent personas
- [Project Manifest](docs/agents/project-manifest/README.md) — Authoritative technical reference (API surface, constraints, data flows)
