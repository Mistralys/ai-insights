# File Tree

```
personas/                          # Sub-project root (has own package.json)
├── package.json                   # {"name": "ai-insights-personas"} — declares js-yaml dependency
├── package-lock.json
├── changelog.md                   # Release history for the persona system
│
├── ledger/                        # Ledger-enabled personas (MCP-backed workflow)
│   ├── README.md                  # User-facing workflow guide (hand-authored, not generated)
│   │
│   ├── vs-code/                   # ← GENERATED — VS Code target output (--target vscode)
│   │   ├── 1-planner.agent.md
│   │   ├── 2-pm.agent.md
│   │   ├── 3-dev.agent.md
│   │   ├── 4-qa.agent.md
│   │   ├── 5-security-auditor.agent.md
│   │   ├── 6-reviewer.agent.md
│   │   ├── 7-release-engineer.agent.md
│   │   ├── 8-docs.agent.md
│   │   └── 9-synthesis.agent.md
│   │
│   ├── claude-code/               # ← GENERATED — Claude Code target output (--target claude-code)
│   │   ├── 1-planner.md           #   Uses FRONTMATTER_CLAUDE_CODE (name, cc_tools, permissionMode, …)
│   │   ├── 2-project-manager.md
│   │   ├── 3-developer.md
│   │   ├── 4-qa.md
│   │   ├── 5-security-auditor.md
│   │   ├── 6-reviewer.md
│   │   ├── 7-release-engineer.md
│   │   ├── 8-documentation.md
│   │   └── 9-synthesis.md
│   │
│   └── src/                       # Template sources — edit THESE, then build
│       ├── meta/                  # YAML metadata
│       │   ├── _shared.yaml       # Shared: author, version, roster, mcp_server_name
│       │   ├── 1-planner.yaml     # Per-persona: number, role, tools, feature flags
│       │   ├── 2-project-manager.yaml
│       │   ├── 3-developer.yaml
│       │   ├── 4-qa.yaml
│       │   ├── 5-security-auditor.yaml
│       │   ├── 6-reviewer.yaml
│       │   ├── 7-release-engineer.yaml
│       │   ├── 8-documentation.yaml
│       │   └── 9-synthesis.yaml
│       │
│       ├── partials/              # Reusable Markdown fragments (shared across personas)
│       │   ├── agent-roster.md             # Numbered agent list (uses {{roster_rendered}})
│       │   ├── handoff-block-vscode.md     # VS Code handoff instructions (runSubagent)
│       │   ├── handoff-block-claude-code.md # Claude Code handoff instructions (Task tool)
│       │   ├── incident-logging.md         # Environment incident logging instructions
│       │   ├── mcp-intro.md                # MCP tools table header (uses {{mcp_server_name}}, {{mcp_tools_table}})
│       │   ├── role-boundaries.md           # Role boundary constraints (tool scope + WP ownership)
│       │   ├── mcp-preflight-detect.md     # Step 1: detect project via ledger_detect_project
│       │   ├── mcp-preflight-header-vscode.md     # VS Code pre-flight intro + tool_search_tool_regex instruction
│       │   ├── mcp-preflight-header-claude-code.md # Claude Code pre-flight intro (native MCP loading)
│       │   ├── mcp-preflight-verify-no-detect.md    # Step 1 (no detect): verify via ledger_get_project_status
│       │   ├── mcp-preflight-verify-with-detect.md  # Step 2 (with detect): verify after detect
│       │   ├── mcp-tools-note.md           # Self-documenting tools note (ledger_help reference)
│       │   └── mcp-unavailable.md          # Hard-stop message when MCP server is unreachable
│       │
│       └── content/               # Per-persona body templates (one per agent)
│           ├── 1-planner.md       # Planner body — minimal: roster only, no MCP
│           ├── 2-project-manager.md
│           ├── 3-developer.md     # Largest template — includes Code Insight Observer role
│           ├── 4-qa.md
│           ├── 5-security-auditor.md
│           ├── 6-reviewer.md
│           ├── 7-release-engineer.md
│           ├── 8-documentation.md
│           └── 9-synthesis.md
│
├── shared/                        # Suite-agnostic content shared across all persona suites
│   └── partials/                  # Shared Markdown fragments (base layer — loaded before any suite-local partials)
│       ├── agent-roster.md                     # Numbered agent list (uses {{roster_rendered}})
│       ├── planner-output-template.md          # Planner output template
│       ├── planner-core-rules.md               # Planner core operational rules
│       ├── pm-output-format.md                 # Project Manager output format
│       ├── developer-operational-protocol.md   # Developer operational protocol
│       ├── developer-strict-constraints.md     # Developer strict constraints (embeds {{> incident-logging}} — ledger-local partial)
│       ├── developer-output-format.md          # Developer output format
│       ├── qa-operational-protocol.md          # QA operational protocol
│       ├── qa-output-format.md                 # QA output format
│       ├── security-auditor-operational-protocol.md  # Security Auditor review methodology (OWASP A01–A10, severity classification)
│       ├── security-auditor-output-format.md         # Security Auditor findings format and metrics guidance
│       ├── reviewer-operational-protocol.md    # Reviewer operational protocol
│       ├── reviewer-output-format.md           # Reviewer output format
│       ├── release-engineer-operational-protocol.md  # Release Engineer semver, changelog, deployment readiness, self-rework
│       ├── release-engineer-output-format.md         # Release Engineer summary, artifacts, comments format
│       ├── docs-operational-protocol.md        # Documentation operational protocol (embeds {{> incident-logging}})
│       ├── docs-output-format.md               # Documentation output format
│       ├── synthesis-operational-protocol.md   # Synthesis operational protocol
│       └── synthesis-output-format.md          # Synthesis output format
│
├── standalone/                    # Special-purpose personas (not part of the 9-stage workflow)
│   ├── README.md                  # User-facing guide: persona catalog, PM sub-agent cluster, Claude Code limitations (hand-authored)
│   ├── vs-code/                   # ← GENERATED — VS Code target output (--suite standalone --target vscode)
│   │   ├── agents-md-curator.agent.md   #   Uses FRONTMATTER_STANDALONE_VSCODE (no role, includes vs_file_name)
│   │   ├── changelog-curator.agent.md
│   │   ├── composer-curator.agent.md
│   │   ├── ctx-architect.agent.md
│   │   ├── dependency-sequencer.agent.md
│   │   ├── ledger-bootstrapper.agent.md
│   │   ├── manifest-curator.agent.md
│   │   ├── module-intent-architect.agent.md
│   │   ├── orchestrator-runner.agent.md
│   │   ├── pipeline-configurator.agent.md
│   │   ├── readme-curator.agent.md
│   │   ├── researcher.agent.md
│   │   ├── unit-test-auditor.agent.md
│   │   ├── whatsnew-curator.agent.md
│   │   └── wp-decomposer.agent.md
│   │
│   ├── claude-code/               # ← GENERATED — Claude Code target output (--suite standalone --target claude-code)
│   │   ├── agents-md-curator.md   #   Uses FRONTMATTER_STANDALONE_CC (plain kebab name, role absent; mcpServers block omitted — persona has zero MCP tool entries)
│   │   ├── changelog-curator.md   #   Body content byte-for-byte identical to VS Code counterpart
│   │   ├── composer-curator.md
│   │   ├── ctx-architect.md
│   │   ├── dependency-sequencer.md
│   │   ├── ledger-bootstrapper.md   # NOTE: mcpServers: central_pm auto-injected (central_pm/* declared in tools list)
│   │   ├── manifest-curator.md
│   │   ├── module-intent-architect.md
│   │   ├── orchestrator-runner.md
│   │   ├── pipeline-configurator.md
│   │   ├── readme-curator.md
│   │   ├── researcher.md
│   │   ├── unit-test-auditor.md
│   │   ├── whatsnew-curator.md
│   │   └── wp-decomposer.md
│   │
│   └── src/                       # Template sources — edit THESE, then build
│       ├── meta/                  # YAML metadata
│       │   ├── _shared.yaml       # Shared: author, CC defaults (no mcp_server_name, no roster)
│       │   ├── agents-md-curator.yaml
│       │   ├── changelog-curator.yaml
│       │   ├── composer-curator.yaml
│       │   ├── ctx-architect.yaml
│       │   ├── dependency-sequencer.yaml    # PM sub-agent: sequences WPs by dependency topology
│       │   ├── ledger-bootstrapper.yaml     # PM sub-agent: initializes ledger via MCP (tools: central_pm/*)
│       │   ├── manifest-curator.yaml
│       │   ├── module-intent-architect.yaml  # Has explicit cc_tools override (no TodoRead/TodoWrite)
│       │   ├── orchestrator-runner.yaml
│       │   ├── pipeline-configurator.yaml   # PM sub-agent: selects pipeline stages per WP
│       │   ├── readme-curator.yaml
│       │   ├── researcher.yaml    # Per-persona: slug, name, description, vs_file_name, cc_file_name, version, tools
│       │   ├── unit-test-auditor.yaml
│       │   ├── whatsnew-curator.yaml
│       │   └── wp-decomposer.yaml           # PM sub-agent: decomposes plan into atomic work packages
│       │
│       └── content/               # Per-slug body templates (body content only, no frontmatter)
│           ├── agents-md-curator.md
│           ├── changelog-curator.md
│           ├── composer-curator.md
│           ├── ctx-architect.md
│           ├── dependency-sequencer.md
│           ├── ledger-bootstrapper.md
│           ├── manifest-curator.md
│           ├── module-intent-architect.md
│           ├── orchestrator-runner.md
│           ├── pipeline-configurator.md
│           ├── readme-curator.md
│           ├── researcher.md
│           ├── unit-test-auditor.md
│           ├── whatsnew-curator.md
│           └── wp-decomposer.md
│
└── docs/
    └── agents/
        └── project-manifest/      # This manifest
```

## Directory Purposes

| Directory | Generated? | Description |
|-----------|-----------|-------------|
| `personas/ledger/` | Output files: YES (vs-code/ + claude-code/); `README.md` and `src/`: NO | Generated persona `.md` files + template sources |
| `personas/ledger/vs-code/` | Yes | VS Code target output: standard frontmatter, `tools` = IDE tool slugs, `vs_file_name` used for sync |
| `personas/ledger/claude-code/` | Yes | Claude Code target output: CC frontmatter (`name`, `cc_tools`, `permissionMode`, `model`, `memory`, `mcpServers`) |
| `personas/ledger/src/meta/` | No | YAML metadata defining each persona's identity and feature flags |
| `personas/shared/partials/` | No | Suite-agnostic shared Markdown fragments — **base layer**, loaded first. Available to all suites (ledger, standalone). Never include MCP-specific content. |  
| `personas/ledger/src/partials/` | No | Ledger-suite-specific Markdown fragments — **override layer**, loaded after shared. Partials here shadow same-named entries in `shared/partials/`. Contains MCP-specific partials (`mcp-*`, `role-boundaries`, `handoff-block-*`, `incident-logging`). |
| `personas/ledger/src/content/` | No | Per-persona body templates — the "main" content for each agent |
| `personas/standalone/` | Output files: YES (vs-code/ + claude-code/); `src/`: NO | Special-purpose non-workflow personas |
| `personas/standalone/vs-code/` | Yes | VS Code target output: standalone frontmatter (`name`, `vs_file_name`, no `role`) |
| `personas/standalone/claude-code/` | Yes | Claude Code target output: standalone CC frontmatter (plain kebab `name`, no `role`; `mcpServers` conditionally injected for personas with MCP tool entries in `tools`) |
| `personas/standalone/src/meta/` | No | YAML metadata for standalone personas; slug-based (no `number`, no `role`); no `mcp_server_name`, no `roster` |
| `personas/standalone/src/content/` | No | Per-slug body templates — body content compiled verbatim into both VS Code and Claude Code outputs |

## Root-Level Build Scripts

The `scripts/` directory at the workspace root contains cross-project tooling. Two sub-directories were added in WP-001:

```
scripts/
├── build-personas.js             # CLI entry point (see api-surface.md)
├── sync-personas.js              # Deploy to VS Code prompts + Claude Code ~/.claude/agents/
├── check-known-roles.js          # Drift check: KNOWN_ROLES ↔ AGENT_ROLES
├── ...
│
├── lib/                          # ← Pure helpers extracted from build-personas.js (WP-001)
│   └── persona-helpers.js        #   12 stateless functions: serializers, validators, template engine, post-processors
│
└── tests/                        # ← Vitest test suite for persona-helpers (WP-001)
    └── persona-helpers.test.js   #   36 unit tests covering all 12 exported helper functions
```

| Path | Description |
|------|-------------|
| `scripts/lib/persona-helpers.js` | Pure helper module — all side-effect-free except `validateFileName` (calls `process.exit(1)`) and `resolve*` functions (call `console.warn`). CJS module loaded via `require('./lib/persona-helpers')`. |
| `scripts/tests/persona-helpers.test.js` | Vitest test suite. Run with `npx vitest run scripts/tests/` from the workspace root. Requires `vitest` from the root `package.json`. |
