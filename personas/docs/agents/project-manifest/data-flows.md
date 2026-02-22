# Key Data Flows

## 1. Build Pipeline (`scripts/build-personas.js`)

The primary data flow: transform source templates into final persona Markdown files.

```
For each per-persona YAML (1-planner.yaml … 7-synthesis.yaml):

  ┌──────────────────┐     ┌─────────────────────┐
  │  _shared.yaml    │     │  N-name.yaml         │
  │  (shared meta)   │     │  (per-persona meta)  │
  └────────┬─────────┘     └──────────┬───────────┘
           │                          │
           └──────────┬───────────────┘
                      ▼
              ┌───────────────┐
              │ Merge Context │  shared + persona + computed variables
              └───────┬───────┘
                      │
                      ▼
              ┌───────────────┐     ┌─────────────────┐
              │ Render        │◄────│ src/content/     │
              │ Frontmatter   │     │ N-name.md        │
              └───────┬───────┘     │ (body template)  │
                      │             └────────┬──────────┘
                      │                      │
                      │                      ▼
                      │             ┌───────────────────┐     ┌──────────────┐
                      │             │ 1. resolvePartials│◄────│ src/partials/ │
                      │             └────────┬──────────┘     │ *.md         │
                      │                      ▼                └──────────────┘
                      │             ┌───────────────────┐
                      │             │ 2. resolveCondi-  │
                      │             │    tionals        │
                      │             └────────┬──────────┘
                      │                      ▼
                      │             ┌───────────────────┐
                      │             │ 3. resolveVars    │
                      │             └────────┬──────────┘
                      │                      ▼
                      │             ┌───────────────────┐
                      │             │ 4. collapseBlank  │
                      │             └────────┬──────────┘
                      │                      │
                      └──────────┬───────────┘
                                 ▼
                      ┌──────────────────────┐
                      │ Assemble:            │
                      │ frontmatter +        │
                      │ AUTO-GENERATED hdr + │
                      │ body                 │
                      └──────────┬───────────┘
                                 ▼
                      ┌──────────────────────┐
                      │ Write to             │
                      │ ledger/N-name.md     │
                      └──────────────────────┘
```

### Merge Context Details

The context object is assembled in this priority order (later overrides earlier):

```javascript
context = {
  // Layer 1: Shared metadata
  author:          _shared.author,
  last_updated:    _shared.last_updated,
  mcp_server_name: _shared.mcp_server_name,

  // Layer 2: Per-persona metadata (all fields from N-name.yaml)
  ...persona,

  // Layer 3: Computed values (cannot be overridden by YAML)
  version,             // persona.version ?? _shared.default_version
  total,               // _shared.roster.length (always 7)
  tools_json,          // serializeTools(persona.tools)
  roster_rendered,     // renderRoster(_shared.roster, persona.number)
  mcp_tools_table,     // renderMcpToolsTable(persona.mcp_tools) or ''
  no_detect_project,   // !persona.has_detect_project
}
```

---

## 2. Sync Pipeline (`scripts/sync-personas.js`)

Orchestrates a full build-and-deploy cycle to the AI IDE.

```
  ┌──────────────────────┐
  │ scripts/sync-personas.js│
  └──────────┬───────────┘
             │
             ▼
  ┌──────────────────────┐
  │ 1. Build             │  Spawns: node scripts/build-personas.js [--dry-run]
  │    (child process)   │  Generates all 7 persona files in ledger/
  └──────────┬───────────┘
             ▼
  ┌──────────────────────┐
  │ 2. Discover          │  Walks personas/ recursively (excludes ledger/src/)
  │    persona files     │  Finds ALL .md files across ledger/, vanilla/, standalone/
  └──────────┬───────────┘
             ▼
  ┌──────────────────────┐
  │ 3. Extract           │  For each file: parse YAML frontmatter → extract vs_file_name
  │    vs_file_name      │  Files without vs_file_name are skipped (e.g., README.md)
  └──────────┬───────────┘
             ▼
  ┌──────────────────────┐
  │ 4. Copy              │  Copy file → {VS Code prompts dir}/{vs_file_name}
  │    to target         │  Platform-detected: %APPDATA%/Code/User/prompts (Windows)
  └──────────┬───────────┘
             ▼
  ┌──────────────────────┐
  │ 5. Validate          │  Check ledger/ frontmatter: role ∈ KNOWN_ROLES, name present
  │    frontmatter       │  Advisory warnings only — does not block the sync
  └──────────────────────┘
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
├── {{> mcp-preflight-header}}   → partials/mcp-preflight-header.md
│   └── {{mcp_server_name}}          → "central_pm"
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
└── {{> handoff-block}}          → partials/handoff-block.md
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
  Generated files (ledger/*.md)
       │
       ├──────────────────────────┐
       │                          │
       ▼  scripts/sync-personas.js  ▼  Manual copy-paste
  VS Code User/prompts/      AI IDE chat session
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
