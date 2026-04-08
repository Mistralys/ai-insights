# Key Data Flows

## 1. Build Pipeline (`scripts/build-personas.js`)

The primary data flow: transform source templates into final persona Markdown files.

### Top-Level Flow

```
  ┌──────────────────────────────────┐
  │  node scripts/build-personas.js  │  --check | --dry-run | --strict
  └─────────────────┬────────────────┘
                    │  resolves paths to:
                    │    personas/persona-build.config.js
                    │    node_modules/@mistralys/persona-builder/dist/cli.js
                    │  forwards flags; spawns library CLI via execFileSync
                    ▼
  ┌──────────────────────────────────┐
  │  @mistralys/persona-builder CLI  │
  │  (dist/cli.js)                   │
  └─────────────────┬────────────────┘
                    │  loads persona-build.config.js
                    │  runs ledgerPlugin (role validation)
                    │  iterates suites × targets from config
                    ▼
  ┌──────────────────────────────────┐
  │  For each suite + target:        │
  │  Template Engine (see below)     │
  └─────────────────┬────────────────┘
                    │
                    ▼
  ┌──────────────────────────────────┐
  │  Plugin hooks (ledgerPlugin)     │
  │  - Validates persona `role`      │
  │    against manifestRoles[]       │
  │  - Emits warn on unknown role    │
  └─────────────────┬────────────────┘
                    │
                    ▼
  ┌──────────────────────────────────────────┐
  │ Write to suite-specific output dirs      │
  │  ledger    + vscode:                     │
  │    personas/ledger/vs-code/              │
  │  ledger    + claude-code:                │
  │    personas/ledger/claude-code/          │
  │  ledger    + deep-agents:                │
  │    personas/ledger/deep-agents/          │
  │  standalone + vscode:                    │
  │    personas/standalone/vs-code/          │
  │  standalone + claude-code:               │
  │    personas/standalone/claude-code/      │
  │  standalone + deep-agents:               │
  │    personas/standalone/deep-agents/      │
  └──────────────────────────────────────────┘
```

Post-build (real builds only, not `--check`/`--dry-run`): the wrapper reads `personas/changelog.md`, extracts the latest version, and updates `personas/package.json` if it differs.

### Template Engine Detail (inside the library)

For each suite + target AND each per-persona YAML:

```
  ┌──────────────────┐     ┌────────────────────────┐
  │  _shared.yaml    │     │  N-name.yaml /         │
  │  (shared meta)   │     │  slug.yaml             │
  └────────┬─────────┘     └──────────┬─────────────┘
           │                          │
           └──────────┬───────────────┘
                      ▼
              ┌───────────────┐
              │ Merge Context │  shared + persona + computed variables
              │               │  + target_vscode / target_claude_code / target_deep_agents flags
              └───────┼───────┘
                      │
                      │
              ┌───────────────┐   Based on suite + target:
              │ Select        │   ledger   + vscode      → FRONTMATTER_LEDGER_VSCODE
              │ Frontmatter   │   ledger   + claude-code → FRONTMATTER_LEDGER_CC
              │               │   ledger   + deep-agents → FRONTMATTER_DA
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
                      │       │ 1. resolvePartials│◄───│ Load partials            │
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
                     Write output file
```

### Merge Context Details

The context object is assembled in this priority order (later overrides earlier). Some fields are suite-specific.

```javascript
context = {
  // Layer 1: Shared metadata (from _shared.yaml)
  author:              _shared.author,
  last_updated:        _shared.last_updated,
  mcp_server_name:     _shared.mcp_server_name,   // ledger only
  cc_permission_mode:  _shared.cc_permission_mode,
  cc_memory:           _shared.cc_memory,

  // Layer 2: Per-persona metadata (all fields from N-name.yaml or slug.yaml)
  ...persona,

  // Layer 3: Computed values (cannot be overridden by YAML)
  version,             // persona.version ?? _shared.default_version
  model,               // persona.model !== undefined ? persona.model : (_shared.default_model || _shared.cc_model || 'inherit')
  model_slug,          // persona.model_slug || _shared.default_model_slug  — ledger only
  total,               // _shared.roster.length (ledger: 9; standalone: not used)
  tools_json,          // serializeTools(persona.tools)         — ledger only
  tools_list,          // serializeToolsList(persona.tools)     — standalone
  cc_tools_json,       // serializeTools(persona.cc_tools ?? _shared.default_cc_tools)  — ledger only
  cc_tools_list,       // serializeToolsList(same)             — standalone
  roster_rendered,     // renderRoster(_shared.roster, persona.number) — ledger
  mcp_tools_table,     // renderMcpToolsTable(persona.mcp_tools) or '' — ledger only
  cc_name,             // persona.cc_file_name.replace(/\.md$/, '') — all suites
  cc_description,      // roster entry title + short (e.g. "Technical Writing Manager — Docs & README curation") — ledger
  cc_model,            // persona.cc_model !== undefined ? persona.cc_model : resolved model  (resolved model already incorporates _shared.cc_model as a fallback step)

  // Layer 4: Target-pass flags (set by the library per target pass)
  target_vscode,       // true when target = 'vscode'
  target_claude_code,  // true when target = 'claude-code'
  target_deep_agents,  // true when target = 'deep-agents'
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
  ┌────────┴─────────┐   ┌─────────┴────────────────────────┐
  ▼                  ▼   ▼                                   ▼
  Read ledger/       Read standalone/   Read ledger/         Read standalone/
  vs-code/           vs-code/           claude-code/         claude-code/
  Extract            Extract            Extract name         Extract name
  vs_file_name       vs_file_name       + .md                + .md
  Copy → prompts     Copy → prompts     Copy → ~/            Copy → ~/
  dir                dir                .claude/agents/      .claude/agents/
  Validate           Validate           Validate             Validate
  frontmatter        frontmatter        frontmatter          frontmatter
  (role, name,       (name,             (name: N-kebab       (name: plain
   vs_file_name)      vs_file_name,      prefix, role,        kebab,
                      id; no role)       permissionMode,      permissionMode,
                                         model, memory)       model, memory;
                                                              no role)
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
  ledger/vs-code/*.agent.md     ledger/claude-code/*.md     ledger/deep-agents/*.md
  standalone/vs-code/*.agent.md standalone/claude-code/*.md standalone/deep-agents/*.md
       │                          │                           │
       ├────────────────────────┼───────────────────────────┐│
       │                          │                         │ │
       ▼  scripts/sync-personas.js  (--target vscode)          │ ▼  Orchestrator (reads directly from disk)
  VS Code User/prompts/            ▼  scripts/sync-personas.js  ▼  orchestrator/src/config.py
  (*.agent.md)              ~/.claude/agents/            PERSONA_FILES / STAGE_SUBAGENT_FILES
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
