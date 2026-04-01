# File Tree — Ledger Personas Build System

Annotated directory structure for the persona build system. Auto-generated files (output of the build) are marked with `[generated]`.

---

## `personas/` — Build System Root

```
personas/
├── README.md                          # Overview and quick-start guide
├── changelog.md                       # Version history; version synced to package.json by build-personas.js
├── package.json                       # Package metadata; version field kept in sync with changelog.md
├── package-lock.json
├── module-context.yaml
│
├── persona-build.config.js            # ← Build configuration for @mistralys/persona-builder
│                                      #   Declares suites (ledger, standalone), output dirs, and plugins
│
├── docs/
│   └── agents/
│       └── project-manifest/
│           ├── README.md              # Manifest hub — links to all sub-documents
│           ├── tech-stack.md          # Runtime, dependencies, build tools, patterns
│           ├── api-surface.md         # CLI interface, config shape, template syntax, metadata schema
│           ├── data-flows.md          # Build pipeline, sync pipeline, template resolution
│           ├── constraints.md         # Core editing and naming rules
│           ├── constraints-build-system.md   # Template engine constraints and build flags
│           ├── constraints-cross-system.md   # Sync contracts with MCP server and Agent Registry
│           └── file-tree.md           # This document
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
│   │   ├── content/
│   │   │   ├── 1-planner.md
│   │   │   ├── 2-project-manager.md
│   │   │   ├── 3-developer.md
│   │   │   ├── 4-qa.md
│   │   │   ├── 5-security-auditor.md
│   │   │   ├── 6-reviewer.md
│   │   │   ├── 7-release-engineer.md
│   │   │   ├── 8-documentation.md
│   │   │   └── 9-synthesis.md
│   │   └── partials/                  # Suite-specific partials (override shared/partials/)
│   │       ├── handoff-block-claude-code.md
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
│   │   ├── 1-planner.agent.md
│   │   ├── 2-pm.agent.md
│   │   ├── 3-dev.agent.md
│   │   ├── 4-qa.agent.md
│   │   ├── 5-security-auditor.agent.md
│   │   ├── 6-reviewer.agent.md
│   │   ├── 7-release-engineer.agent.md
│   │   ├── 8-docs.agent.md
│   │   └── 9-synthesis.agent.md
│   └── claude-code/                   # [generated] Claude Code persona files (.md)
│       ├── 1-planner.md
│       ├── 2-project-manager.md
│       ├── 3-developer.md
│       ├── 4-qa.md
│       ├── 5-security-auditor.md
│       ├── 6-reviewer.md
│       ├── 7-release-engineer.md
│       ├── 8-documentation.md
│       └── 9-synthesis.md
│
├── standalone/                        # Standalone suite — special-purpose personas
│   ├── README.md
│   ├── src/                           # Source templates (hand-edited)
│   │   ├── meta/                      # Per-persona YAML files (slug.yaml)
│   │   └── content/                   # Per-persona content templates (slug.md)
│   ├── vs-code/                       # [generated] VS Code persona files (.agent.md)
│   └── claude-code/                   # [generated] Claude Code persona files (.md)
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
        ├── developer-operational-protocol.md
        ├── developer-output-format.md
        ├── developer-strict-constraints.md
        ├── docs-operational-protocol.md
        ├── docs-output-format.md
        ├── incident-logging.md
        ├── planner-core-rules.md
        ├── planner-output-template.md
        ├── pm-output-format.md
        ├── qa-operational-protocol.md
        ├── qa-output-format.md
        ├── release-engineer-operational-protocol.md
        ├── release-engineer-output-format.md
        ├── reviewer-operational-protocol.md
        ├── reviewer-output-format.md
        ├── security-auditor-operational-protocol.md
        ├── security-auditor-output-format.md
        ├── synthesis-operational-protocol.md
        └── synthesis-output-format.md
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
