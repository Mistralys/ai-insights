# Key Data Flows

## 1. Build Pipeline (`scripts/build-personas.js`)

The primary data flow: transform source templates into final persona Markdown files. A single `build-personas.js` run executes **one or more suite × target combinations** controlled by the `--suite` and `--target` CLI flags.

```
CLI flags:
  --suite  ledger | standalone | all | comma-separated  [default: ledger]
  --target vscode | claude-code | all                             [default: all]
         │
         ▼
   expandSuites() resolves SUITES_TO_BUILD (deduplicated list)
         │
   For each suite in SUITES_TO_BUILD AND each active target:
         ▼
   buildForTarget(suite, target) called once per suite + target pair

For each suite + target AND each per-persona YAML:

  ┌──────────────────┐     ┌────────────────────────┐
  │  _shared.yaml    │     │  N-name.yaml /         │
  │  (shared meta)   │     │  slug.yaml             │
  └────────┬─────────┘     └──────────┬─────────────┘
           │                          │
           └──────────┬───────────────┘
                      ▼
              ┌───────────────┐
              │ Merge Context │  shared + persona + computed variables
              │               │  + target_vscode / target_claude_code flags
              └───────┬───────┘
                      │
                      ▼
              ┌───────────────┐   Based on suite + target:
              │ Select        │   ledger   + vscode      → FRONTMATTER_LEDGER_VSCODE
              │ Frontmatter   │   ledger   + claude-code → FRONTMATTER_LEDGER_CC
              └───────┬───────┘
                      │
                      │       ┌─────────────────┐   standalone + vscode → FRONTMATTER_STANDALONE_VSCODE
                      │       │ src/content/    │   standalone + cc     → FRONTMATTER_STANDALONE_CC
                      │       │ N-name.md /     │
                      │       │ slug.md         │
                      │       └────────┬────────┘
                      │                │
                      │                ▼
                      │       ┌──────────────────┐    ┌──────────────────────────┐
                      │       │ 1. resolvePartials│◄───│ loadPartials(suiteConfig)│
                      │       └────────┬──────────┘    │ Base: shared/partials/  │
                      │                ▼               │ Override: src/partials/ │
                      │       ┌──────────────────┐    └──────────────────────────┘
                      │       │ 2. resolveCondi- │
                      │       │    tionals       │
                      │       └────────┬──────────┘
                      │                ▼
                      │       ┌──────────────────┐
                      │       │ 3. resolveVars   │
                      │       └────────┬──────────┘
                      │                ▼
                      │       ┌──────────────────┐
                      │       │ 4. collapseBlank │
                      │       └────────┬──────────┘
                      │                │
                      └──────┬─────────┘
                             ▼
              ┌──────────────────────────┐
              │ Assemble:                │
              │ frontmatter +            │
              │ AUTO-GENERATED header +  │
              │ body                     │
              └──────────────┬───────────┘
                             ▼
        ┌────────────────────────────────────────┐
        │ Write to suite-specific output dir     │
        │  ledger    + vscode:                   │
        │    personas/ledger/vs-code/            │
        │  ledger    + claude-code:              │
        │    personas/ledger/claude-code/        │
        │  standalone + vscode:                  │
        │    personas/standalone/vs-code/        │
        │  standalone + claude-code:             │
        │    personas/standalone/claude-code/    │
        └────────────────────────────────────────┘
```

### Merge Context Details

The context object is assembled in this priority order (later overrides earlier). Some fields are suite-specific.

```javascript
context = {
  // Layer 1: Shared metadata (from _shared.yaml)
  author:              _shared.author,
  last_updated:        _shared.last_updated,
  mcp_server_name:     _shared.mcp_server_name,   // ledger only
  default_model:       _shared.default_model,      // consumed in Layer 3
  cc_permission_mode:  _shared.cc_permission_mode,
  cc_model:            _shared.cc_model,           // overridden in Layer 3
  cc_memory:           _shared.cc_memory,

  // Layer 2: Per-persona metadata (all fields from N-name.yaml or slug.yaml)
  ...persona,

  // Layer 3: Computed values (cannot be overridden by YAML)
  version,             // persona.version ?? _shared.default_version
  model,               // persona.model !== undefined ? persona.model : (_shared.default_model || _shared.cc_model || 'inherit')
  total,               // _shared.roster.length (ledger: 7; standalone: not used)
  tools_json,          // serializeTools(persona.tools)         — ledger only
  tools_list,          // serializeToolsList(persona.tools)     — standalone
  cc_tools_json,       // serializeTools(persona.cc_tools ?? _shared.default_cc_tools)  — ledger only
  cc_tools_list,       // serializeToolsList(same)             — standalone
  roster_rendered,     // renderRoster(_shared.roster, persona.number) — ledger
  mcp_tools_table,     // renderMcpToolsTable(persona.mcp_tools) or '' — ledger only
  cc_name,             // persona.cc_file_name.replace(/\.md$/, '') — all suites
  cc_description,      // roster entry title + short (e.g. "Technical Writing Manager — Docs & README curation") — ledger
  cc_model,            // persona.cc_model !== undefined ? persona.cc_model : resolved model  (resolved model already incorporates _shared.cc_model as a fallback step)

  // Layer 4: Target-pass flags (set by buildForTarget)
  target_vscode,       // true when target = 'vscode'
  target_claude_code,  // true when target = 'claude-code'
}
```

---

## 2. Sync Pipeline (`scripts/sync-personas.js`)

Orchestrates a full build-and-deploy cycle to one or both AI IDEs.

```
  ┌──────────────────────────┐
  │ scripts/sync-personas.js │  --target vscode | claude-code | all (default: all)
  └──────────┬───────────────┘
             │
             ▼
  ┌──────────────────────────┐
  │ 1. Build (child process) │  Spawns: node scripts/build-personas.js --suite ledger,standalone [--target] [--dry-run]
  │                          │  Always rebuilds both ledger and standalone output before syncing.
  └──────────┬───────────────┘
             │
     ┌───────┴──────────────────────┐
     ▼                              ▼
  ┌──────────────────┐   ┌──────────────────────────────────┐
  │ VS Code target   │   │ Claude Code target               │
  │ (if requested)   │   │ (if requested)                   │
  └────────┬─────────┘   └──────────┬───────────────────────┘
           │                        │
           ▼              ┌─────────┴────────────────────────┐
  Read ledger/vs-code/    ▼                                  ▼
  Extract vs_file_name   Read ledger/claude-code/   Read standalone/claude-code/
  Copy → prompts dir     Extract name + .md         Extract name + .md
  Validate frontmatter   Copy → ~/.claude/agents/   Copy → ~/.claude/agents/
  (role, name,           Validate frontmatter       Validate frontmatter
   vs_file_name)         (name: N-kebab prefix,     (name: plain kebab,
                          role, permissionMode,      permissionMode, model,
                          model, memory)             memory; no role required)
```

---

## 3. Template Resolution Example (Agent 3 — Developer)

Illustrates the concrete partial chain for a fully-featured MCP-enabled persona:

```
content/3-developer.md
│
├── {{> agent-roster}}           → partials/agent-roster.md
│   └── {{roster_rendered}}          (computed: numbered list with "(YOU)" on Agent 3)
│
├── {{> mcp-intro}}              → partials/mcp-intro.md
│   ├── {{mcp_server_name}}          → "central_pm"
│   └── {{mcp_tools_table}}          (computed: 10 tool rows for Developer)
│
├── {{#if self_documenting_note}}    (true for Agent 3)
│   └── {{> mcp-tools-note}}    → partials/mcp-tools-note.md
│
├── {{#if target_vscode}}           (target-conditional)
│   ├── {{> mcp-preflight-header-vscode}}    → partials/mcp-preflight-header-vscode.md
│   │   └── {{mcp_server_name}}          → "central_pm"
│   └── {{else}}
│       └── {{> mcp-preflight-header-claude-code}} → partials/mcp-preflight-header-claude-code.md
│           └── {{mcp_server_name}}          → "central_pm"
│
├── {{#if has_detect_project}}       (true for Agent 3)
│   └── {{> mcp-preflight-detect}}      → partials/mcp-preflight-detect.md
│
├── {{#if has_detect_project}}       (true — second guard for verify step)
│   └── {{> mcp-preflight-verify-with-detect}}  → partials/mcp-preflight-verify-with-detect.md
│
├── {{> mcp-unavailable}}        → partials/mcp-unavailable.md
│   └── {{mcp_server_name}}          → "central_pm"
│
├── … persona-specific body …
│   └── {{> incident-logging}}       (inline in Strict Constraints section)
│   └── {{role}}                     → "Developer"
│
└── {{#if target_vscode}}           (target-conditional)
    ├── {{> handoff-block-vscode}}    → partials/handoff-block-vscode.md
    │   └── {{role}}                     → "Developer"
    └── {{else}}
        └── {{> handoff-block-claude-code}} → partials/handoff-block-claude-code.md
            └── {{role}}                     → "Developer"
```

### Agent 2 (Project Manager) — Notable Difference

Agent 2 does **not** use the `{{#if has_detect_project}}` guard. Instead, it directly embeds `{{> mcp-preflight-verify-no-detect}}`, which uses "Step 1" numbering and references a "target project_path" rather than a resolved one. This is because the PM always receives an explicit path from the Planner.

### Agent 1 (Planner) — Minimal Template

Agent 1 uses `{{> agent-roster}}` only. No MCP partials, no handoff block, no incident logging. It produces a plan document and does not interact with the ledger.

---

## 4. Persona Consumption Flow

How generated personas reach end users and the MCP server:

```
  Source templates (src/)
       │
       ▼  scripts/build-personas.js
  Generated files:
  ledger/vs-code/*.md     ledger/claude-code/*.md
       │                          │
       ├──────────────────────────┼─────────────────────────────────────┐
       │                          │                                     │
       ▼  scripts/sync-personas.js  (--target vscode)                  │
  VS Code User/prompts/            ▼  scripts/sync-personas.js  ▼  Manual copy-paste
  (*.agent.md)              ~/.claude/agents/          AI IDE chat session
  (*.agent.md)                    │
       │                          │
       ▼                          ▼
  Agent picker UI            Agent executes persona instructions
       │                          │
       ▼                          │
  Agent executes persona     ◄────┘
  instructions
       │
       ▼
  Agent calls MCP tools (central_pm/ledger_*)
       │
       ▼
  Project Ledger MCP Server
```
