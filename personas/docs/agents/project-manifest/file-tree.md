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
├── vanilla/                       # Non-ledger personas (standalone, no MCP dependency)
│   ├── README.md
│   ├── 1-planner.md … 7-synthesis.md
│
├── standalone/                    # Special-purpose personas (not part of the 7-stage workflow)
│   ├── agents-md-curator.md
│   ├── manifest-curator.md
│   ├── module-intent-architect.md
│   ├── readme-curator.md
│   ├── researcher.md
│   ├── unit-test-auditor.md
│   │
│   └── claude-code/               # ← Claude Code variants of all 6 standalone personas
│       ├── agents-md-curator.md   #   Uses CC frontmatter (kebab name, CC tools, permissionMode, model, memory)
│       ├── manifest-curator.md    #   Body content byte-for-byte identical to VS Code counterpart
│       ├── module-intent-architect.md
│       ├── readme-curator.md
│       ├── researcher.md
│       └── unit-test-auditor.md
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
| `personas/ledger/src/partials/` | No | Reusable Markdown fragments embedded via `{{> name}}` |
| `personas/ledger/src/content/` | No | Per-persona body templates — the "main" content for each agent |
| `personas/vanilla/` | No | Hand-authored personas for use without the MCP server |
| `personas/standalone/` | No | Hand-authored special-purpose VS Code personas (not part of the 7-stage workflow) |
| `personas/standalone/claude-code/` | No | Claude Code variants of the standalone personas — CC frontmatter, body content identical to VS Code counterparts |
