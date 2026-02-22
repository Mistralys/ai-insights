# File Tree

```
personas/                          # Sub-project root (has own package.json)
├── package.json                   # {"name": "ai-insights-personas"} — declares js-yaml dependency
├── package-lock.json
├── changelog.md                   # Release history for the persona system
│
├── ledger/                        # Ledger-enabled personas (MCP-backed workflow)
│   ├── README.md                  # User-facing workflow guide (hand-authored, not generated)
│   ├── 1-planner.md              # ← GENERATED — do not edit
│   ├── 2-project-manager.md      # ← GENERATED
│   ├── 3-developer.md            # ← GENERATED
│   ├── 4-qa.md                   # ← GENERATED
│   ├── 5-reviewer.md             # ← GENERATED
│   ├── 6-documentation.md        # ← GENERATED
│   ├── 7-synthesis.md            # ← GENERATED
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
│       │   ├── handoff-block.md            # Auto-handoff instructions (uses {{role}})
│       │   ├── incident-logging.md         # Environment incident logging instructions
│       │   ├── mcp-intro.md                # MCP tools table header (uses {{mcp_server_name}}, {{mcp_tools_table}})
│       │   ├── mcp-preflight-detect.md     # Step 1: detect project via ledger_detect_project
│       │   ├── mcp-preflight-header.md     # Pre-flight intro + tool_search_tool_regex instruction
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
│   ├── manifest-curator.md
│   ├── module-intent-architect.md
│   ├── readme-curator.md
│   ├── researcher.md
│   └── unit-test-auditor.md
│
└── docs/
    └── agents/
        └── project-manifest/      # This manifest
```

## Directory Purposes

| Directory | Generated? | Description |
|-----------|-----------|-------------|
| `personas/ledger/` | Output files: YES; `README.md` and `src/`: NO | Generated persona `.md` files + template sources |
| `personas/ledger/src/meta/` | No | YAML metadata defining each persona's identity and feature flags |
| `personas/ledger/src/partials/` | No | Reusable Markdown fragments embedded via `{{> name}}` |
| `personas/ledger/src/content/` | No | Per-persona body templates — the "main" content for each agent |
| `personas/vanilla/` | No | Hand-authored personas for use without the MCP server |
| `personas/standalone/` | No | Hand-authored special-purpose personas |
