# File Tree — Ledger Personas Build System

Annotated directory structure for the persona build system. Auto-generated files (output of the build) are marked with `[generated]`.

> For structural navigation, prefer the auto-generated `.context/personas/file-structure.md` (see [constraints.md §C2a](constraints.md#c2a)) — it is regenerated from the live filesystem and cannot drift. This document is a curated, annotated overview: it explains *why* directories exist and marks generated vs. hand-authored content, which the auto-generated tree does not.

---

## `personas/` — Build System Root

```
personas/
├── README.md                          # Overview and quick-start guide
├── changelog.md                       # Version history; version synced to package.json by build-personas.js
├── package.json                       # Package metadata; version field kept in sync with changelog.md
├── package-lock.json
├── module-context.yaml
├── name-mapping.json                  # [generated] Per-persona agent-name lookup; regenerated on every real build
│
├── persona-build.config.js            # ← Build configuration for @mistralys/persona-builder
│                                      #   Declares suites (ledger, standalone, ledger-support), output dirs, and plugins
│
├── docs/
│   ├── persona-design-guide.md        # Persona Design Guide — published artifact, see constraints.md §C5d
│   ├── persona-anchoring.md
│   ├── persona-build-system.md
│   ├── audits/                        # Persona Design Guide compliance tracking — see data-flows.md §5
│   │   ├── README.md
│   │   ├── status.md                  # [generated] Per-persona tracking table — never hand-edit
│   │   ├── notes.md                   # Hand-written audit methodology and findings, cumulative
│   │   └── annotations.json           # Hand-written Notes-column text, keyed by suite + persona stem
│   └── agents/
│       └── project-manifest/
│           ├── README.md              # Manifest hub — links to all sub-documents
│           ├── tech-stack.md          # Runtime, dependencies, build tools, patterns
│           ├── api-surface.md         # CLI interface, config shape, template syntax, metadata schema
│           ├── variables.md           # Template variable reference
│           ├── data-flows.md          # Build pipeline, sync pipeline, template resolution
│           ├── constraints.md         # Core editing and naming rules
│           ├── constraints-build-system.md   # Template engine constraints and build flags
│           ├── constraints-cross-system.md   # Sync contracts with MCP server and Agent Registry
│           ├── file-tree.md           # This document
│           └── curation-log.md        # Standing decisions and curation history for this manifest
│
├── model-registry/                    # File-based model registry — see constraints.md §C26b
│   ├── README.md                      # Schema, seed/working-copy lifecycle, and UUID convention
│   ├── default.json                   # Shipped seed models (tracked in Git)
│   ├── local.json                     # User-registered models (gitignored, auto-created)
│   └── assignments.json               # Per-persona model assignments, keyed by persona `id` (gitignored, auto-created)
│
├── ledger/                            # Ledger suite — 9 workflow-agent personas
│   ├── README.md
│   ├── src/                           # Source templates (hand-edited)
│   │   ├── meta/
│   │   │   ├── _shared.yaml           # Shared YAML: author, version, roster, MCP server name
│   │   │   ├── 1-planner.yaml
│   │   │   ├── 2-project-manager.yaml
│   │   │   ├── 3-developer.yaml
│   │   │   ├── 4-qa.yaml
│   │   │   ├── 5-security-auditor.yaml
│   │   │   ├── 6-reviewer.yaml
│   │   │   ├── 7-release-engineer.yaml
│   │   │   ├── 8-documentation.yaml
│   │   │   └── 9-synthesis.yaml
│   │   ├── content/                   # 1-planner.md … 9-synthesis.md
│   │   └── partials/                  # Suite-specific partials (override shared/partials/)
│   │       ├── handoff-block-claude-code.md
│   │       ├── handoff-block-manual.md
│   │       ├── handoff-block-vscode.md
│   │       ├── incident-logging.md
│   │       ├── mcp-intro.md
│   │       ├── mcp-preflight-detect.md
│   │       ├── mcp-preflight-header-claude-code.md
│   │       ├── mcp-preflight-header-vscode.md
│   │       ├── mcp-preflight-verify-no-detect.md
│   │       ├── mcp-tools-note.md
│   │       ├── mcp-unavailable.md
│   │       └── role-boundaries.md
│   ├── vs-code/                       # [generated] VS Code persona files (.agent.md)
│   ├── claude-code/                   # [generated] Claude Code persona files (.md)
│   └── deep-agents/                   # [generated] Deep Agents persona files (.md)
│
├── standalone/                        # Standalone suite — special-purpose personas
│   ├── README.md
│   ├── src/                           # Source templates (hand-edited)
│   │   ├── meta/                      # Per-persona YAML files (slug.yaml)
│   │   └── content/                   # Per-persona content templates (slug.md)
│   ├── vs-code/                       # [generated] VS Code persona files (.agent.md)
│   ├── claude-code/                   # [generated] Claude Code persona files (.md)
│   └── deep-agents/                   # [generated] Deep Agents persona files (.md)
│
├── ledger-support/                    # Ledger-support suite — MCP-dependent utility sub-agent personas
│   ├── README.md
│   ├── src/                           # Source templates (hand-edited)
│   │   ├── meta/                      # Per-persona YAML files (slug.yaml); _shared.yaml sets mcp_server_name
│   │   └── content/                   # Per-persona content templates (slug.md)
│   ├── vs-code/                       # [generated] VS Code persona files (.agent.md)
│   ├── claude-code/                   # [generated] Claude Code persona files (.md)
│   └── deep-agents/                   # [generated] Deep Agents persona files (.md)
│
├── plugins/
│   └── ledger/                        # Local ledger plugin (migrated from @mistralys/persona-builder)
│       ├── index.js                   # Factory — assembles plugin hooks; exports ledgerPlugin()
│       ├── frontmatter-templates.js   # FRONTMATTER_LEDGER_VSCODE and FRONTMATTER_LEDGER_CC templates
│       ├── mcp-tools-renderer.js      # renderMcpToolsTable() — builds the MCP tools markdown table
│       ├── role-validator.js          # validateRole() + validateNoteOnlyGuard() validators
│       └── roster-renderer.js         # renderRoster() — builds the agent roster markdown list
│
└── shared/
    └── partials/                      # Base partial layer — shared across all suites
        ├── agent-roster.md
        ├── ax-feedback.md
        ├── developer-dual-role.md
        ├── developer-philosophy.md
        ├── incident-logging.md
        ├── insight-capture.md
        ├── insight-compilation.md
        ├── insight-observer-intro.md
        ├── insight-reporting-rules.md
        ├── insight-scope-and-types.md
        ├── knowledge-ownership.md
        ├── mcp-insight-capture.md
        ├── no-stale-counts.md
        ├── planner-core-rules.md
        ├── planner-operating-modes.md
        ├── planner-output-template.md
        ├── planner-philosophy.md
        ├── planner-quality-checklist.md
        ├── planner-research-brief-template.md
        ├── pm-subagent-roster.md
        ├── research-brief-protocol.md
        └── summary-crafting-guide.md
```

---

## `scripts/` — Workspace Build Scripts

Only the persona-build–related scripts are annotated here.

```
scripts/
├── build-personas.js                  # Thin wrapper: delegates build to @mistralys/persona-builder
│                                      #   Accepts: --check | --dry-run | --strict
│                                      #   Post-build: syncs personas/package.json version from changelog
├── sync-personas.js                   # Orchestrator: builds then copies output to VS Code / Claude Code dirs
└── …                                  # Other workspace scripts (unrelated to persona build)
```

> **Removed (post-migration):** `scripts/lib/persona-helpers.js` and `scripts/tests/persona-helpers.test.js` no longer exist. All build logic previously in `persona-helpers.js` is now inside the `@mistralys/persona-builder` library.

---

## Key Relationships

| Source file | Consumed by | Output |
|-------------|-------------|--------|
| `personas/persona-build.config.js` | `@mistralys/persona-builder` CLI (via `build-personas.js`) | — |
| `personas/ledger/src/meta/*.yaml` | Library template engine | Frontmatter context for each persona |
| `personas/ledger/src/content/*.md` | Library template engine | Persona body content |
| `personas/ledger/src/partials/*.md` | Library template engine (override layer) | Embedded partial content |
| `personas/shared/partials/*.md` | Library template engine (base layer) | Embedded partial content |
| `personas/ledger/vs-code/*.agent.md` | `sync-personas.js` → VS Code prompts dir | Deployed agent file |
| `personas/ledger/claude-code/*.md` | `sync-personas.js` → `~/.claude/agents/` | Deployed agent file |
