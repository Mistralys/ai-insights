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
│   │   ├── 1-planner.md
│   │   ├── 2-project-manager.md
│   │   ├── 3-developer.md
│   │   ├── 4-qa.md
│   │   ├── 5-reviewer.md
│   │   ├── 6-documentation.md
│   │   └── 7-synthesis.md
│   │
│   ├── claude-code/               # ← GENERATED — Claude Code target output (--target claude-code)
│   │   ├── 1-planner.md           #   Uses FRONTMATTER_CLAUDE_CODE (name, cc_tools, permissionMode, …)
│   │   ├── 2-project-manager.md
│   │   ├── 3-developer.md
│   │   ├── 4-qa.md
│   │   ├── 5-reviewer.md
│   │   ├── 6-documentation.md
│   │   └── 7-synthesis.md
│   │
│   └── src/                       # Template sources — edit THESE, then build
│       ├── meta/                  # YAML metadata
│       │   ├── _shared.yaml       # Shared: author, version, roster, mcp_server_name
│       │   ├── 1-planner.yaml     # Per-persona: number, role, tools, feature flags
│       │   ├── 2-project-manager.yaml
│       │   ├── 3-developer.yaml
│       │   ├── 4-qa.yaml
│       │   ├── 5-reviewer.yaml
│       │   ├── 6-documentation.yaml
│       │   └── 7-synthesis.yaml
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
│           ├── 5-reviewer.md
│           ├── 6-documentation.md
│           └── 7-synthesis.md
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
│       ├── reviewer-operational-protocol.md    # Reviewer operational protocol
│       ├── reviewer-output-format.md           # Reviewer output format
│       ├── docs-operational-protocol.md        # Documentation operational protocol (embeds {{> incident-logging}})
│       ├── docs-output-format.md               # Documentation output format
│       ├── synthesis-operational-protocol.md   # Synthesis operational protocol
│       └── synthesis-output-format.md          # Synthesis output format
│
├── standalone/                    # Special-purpose personas (not part of the 7-stage workflow)
│   ├── vs-code/                   # ← GENERATED — VS Code target output (--suite standalone --target vscode)
│   │   ├── agents-md-curator.md   #   Uses FRONTMATTER_STANDALONE_VSCODE (no role, includes vs_file_name)
│   │   ├── manifest-curator.md
│   │   ├── module-intent-architect.md
│   │   ├── readme-curator.md
│   │   ├── researcher.md
│   │   └── unit-test-auditor.md
│   │
│   ├── claude-code/               # ← GENERATED — Claude Code target output (--suite standalone --target claude-code)
│   │   ├── agents-md-curator.md   #   Uses FRONTMATTER_STANDALONE_CC (plain kebab name, no role, no mcpServers)
│   │   ├── manifest-curator.md    #   Body content byte-for-byte identical to VS Code counterpart
│   │   ├── module-intent-architect.md
│   │   ├── readme-curator.md
│   │   ├── researcher.md
│   │   └── unit-test-auditor.md
│   │
│   └── src/                       # Template sources — edit THESE, then build
│       ├── meta/                  # YAML metadata
│       │   ├── _shared.yaml       # Shared: author, CC defaults (no mcp_server_name, no roster)
│       │   ├── researcher.yaml    # Per-persona: slug, name, description, vs_file_name, cc_file_name, version, tools
│       │   ├── manifest-curator.yaml
│       │   ├── module-intent-architect.yaml  # Has explicit cc_tools override (no TodoRead/TodoWrite)
│       │   ├── readme-curator.yaml
│       │   ├── agents-md-curator.yaml
│       │   └── unit-test-auditor.yaml
│       │
│       └── content/               # Per-slug body templates (body content only, no frontmatter)
│           ├── researcher.md
│           ├── manifest-curator.md
│           ├── module-intent-architect.md
│           ├── readme-curator.md
│           ├── agents-md-curator.md
│           └── unit-test-auditor.md
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
| `personas/standalone/claude-code/` | Yes | Claude Code target output: standalone CC frontmatter (plain kebab `name`, no `role`, no `mcpServers`) |
| `personas/standalone/src/meta/` | No | YAML metadata for standalone personas; slug-based (no `number`, no `role`); no `mcp_server_name`, no `roster` |
| `personas/standalone/src/content/` | No | Per-slug body templates — body content compiled verbatim into both VS Code and Claude Code outputs |
