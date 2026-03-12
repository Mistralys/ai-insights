# Plan

## Summary

Restructure all persona YAML metadata to group IDE-specific fields under a new `ide_settings` mapping instead of using flat `cc_*` / `vs_*` prefixed fields. This applies to both per-persona YAML files (17 files across 2 suites) and both `_shared.yaml` files. The build script and sync script will be updated to read from the new nested structure. Generated output (frontmatter in `.md` files) remains byte-identical — this is a source-only schema change.

## Architectural Context

The persona build system ([scripts/build-personas.js](scripts/build-personas.js)) reads YAML metadata from `personas/<suite>/src/meta/` and assembles persona Markdown files with IDE-specific frontmatter. Currently, IDE-specific fields are distinguished by prefix convention:

- **`vs_*`** — VS Code–only fields (`vs_file_name`)
- **`cc_*`** — Claude Code–only fields (`cc_file_name`, `cc_tools`, `cc_description`, `cc_model`, `cc_permission_mode`, `cc_memory`)
- **`tools`** — currently unprefixed but VS Code–only (different tool vocabulary from Claude Code)
This prefix convention has grown organically and has multiple issues:
1. Shared persona-level fields (`number`, `role`, `version`) and IDE-specific fields are interleaved without structure.
2. The `tools` field is VS Code–only but carries no prefix, while `cc_tools` has one — inconsistent.
3. Adding a new IDE target would require inventing a new prefix and migrating across all files.

**Files involved:**

| File | Current IDE-prefixed fields |
|------|---------------------------|
| `personas/ledger/src/meta/_shared.yaml` | `cc_permission_mode`, `cc_memory`, `default_cc_tools` |
| `personas/standalone/src/meta/_shared.yaml` | `cc_permission_mode`, `cc_memory`, `default_cc_tools` |
| 7 ledger per-persona YAML files | `vs_file_name`, `cc_file_name`, `tools`, optionally `cc_model`, `cc_description` |
| 10 standalone per-persona YAML files | `vs_file_name`, `cc_file_name`, `tools`, optionally `cc_tools` |
| [scripts/build-personas.js](scripts/build-personas.js) | Reads all above fields, assembles context object |
| [scripts/sync-personas.js](scripts/sync-personas.js) | Reads `vs_file_name` and `name` from generated frontmatter |
| [personas/docs/agents/project-manifest/api-surface.md](personas/docs/agents/project-manifest/api-surface.md) | Documents YAML schema |
| [personas/docs/agents/project-manifest/constraints.md](personas/docs/agents/project-manifest/constraints.md) | Constraints 14, 15, 25b, 28c reference these fields |
| [personas/docs/agents/project-manifest/data-flows.md](personas/docs/agents/project-manifest/data-flows.md) | Documents context assembly |

**Key downstream consumers of generated frontmatter (unchanged by this refactor):**
- [scripts/sync-personas.js](scripts/sync-personas.js) reads `vs_file_name` and `name` from **generated** frontmatter (not source YAML). Since generated frontmatter stays identical, sync is unaffected.
- [mcp-server/src/utils/agent-registry.ts](mcp-server/src/utils/agent-registry.ts) reads `name`, `role`, and `id` from generated frontmatter. Unaffected.

## Approach / Architecture

### New YAML schema

**Per-persona YAML (example: `2-project-manager.yaml`):**

```yaml
# Identity & content fields (shared across all IDE targets)
number: 2
role: Project Manager
id: ledger-2-pm
model: "Claude Opus 4.6"
version: "3.6.0"
last_updated: "2026-03-04"

# IDE-specific settings
ide_settings:
  vscode:
    file_name: 2-pm.agent.md
    tools:
      - vscode
      - execute
      - read
      - edit
      - search
      - web
      - agent
      - todo
      - central_pm/*
  claude_code:
    file_name: 2-project-manager.md

# Feature flags
has_mcp: true
has_detect_project: false
self_documenting_note: false
has_incident_logging: false

# MCP tool allocation
mcp_tools:
  - tool: ledger_initialize_project
    purpose: Create the root ledger for a new project.
  # ...
```

**Standalone per-persona YAML (example: `orchestrator-runner.yaml` — showing CC tools override):**

```yaml
slug: orchestrator-runner
name: "Orchestrator Runner"
description: "Pre-flight checks, launch, and monitor an AI Insights orchestrator workflow run."
id: standalone-orchestrator-runner

ide_settings:
  vscode:
    file_name: orchestrator-runner.agent.md
    tools:
      - vscode
      - execute
      - read
      - edit
      - search
      - todo
  claude_code:
    file_name: orchestrator-runner.md
    tools:                                # Per-persona CC tools override
      - Bash
      - Read
      - Edit
      - Grep
      - Task
      - TodoRead
      - TodoWrite

version: "1.0.2"
last_updated: "2026-03-04"
```

**`_shared.yaml` (ledger):**

```yaml
author: Sebastian Mordziol
last_updated: "2026-03-01 12:00"
default_version: "3.5.0"
default_model: "Claude Sonnet 4.6"

mcp_server_name: "central_pm"

ide_settings:
  claude_code:
    permission_mode: "acceptEdits"
    memory: "project"
    default_tools:
      - Bash
      - Read
      - Edit
      - Write
      - Grep
      - Glob
      - Task
      - WebFetch
      - WebSearch

roster:
  - number: 1
    title: Chief Product Officer
    short: Planning & Strategy
  # ...
```

**`_shared.yaml` (standalone):**

```yaml
author: Sebastian Mordziol
last_updated: "2026-02-23"
default_version: "1.0.0"
default_model: "inherit"

ide_settings:
  claude_code:
    permission_mode: "acceptEdits"
    memory: "project"
    default_tools:
      - Bash
      - Read
      - Edit
      - Write
      - Grep
      - Glob
      - Task
      - WebFetch
      - WebSearch
      - TodoRead
      - TodoWrite
```

### Build script changes

The build script's context assembly (~line 545–640) currently reads fields like `persona.vs_file_name`, `persona.cc_file_name`, `persona.tools`, `persona.cc_tools`, `sharedMeta.cc_permission_mode`, etc. These access patterns must be updated to read from the nested `ide_settings` structure:

```javascript
// Accessor helpers for the nested ide_settings structure
const vsSettings     = persona.ide_settings?.vscode || {};
const ccSettings     = persona.ide_settings?.claude_code || {};
const sharedVS       = sharedMeta.ide_settings?.vscode || {};
const sharedCC       = sharedMeta.ide_settings?.claude_code || {};
```

Then all field reads are updated:

| Current access | New access |
|---|---|
| `persona.vs_file_name` | `vsSettings.file_name` |
| `persona.cc_file_name` | `ccSettings.file_name` |
| `persona.tools` | `vsSettings.tools` |
| `persona.cc_tools` | `ccSettings.tools` |
| `persona.cc_description` | `ccSettings.description` |
| `persona.cc_model` | `ccSettings.model` |
| `sharedMeta.cc_permission_mode` | `sharedCC.permission_mode` |
| `sharedMeta.cc_memory` | `sharedCC.memory` |
| `sharedMeta.default_cc_tools` | `sharedCC.default_tools` |

The context object assembly must still produce the **same flat context variables** (`{{vs_file_name}}`, `{{cc_permission_mode}}`, etc.) so that the frontmatter templates remain unchanged. The mapping happens in the context object construction, not in the templates.

### What stays the same

- **Frontmatter templates** — unchanged. They still reference `{{vs_file_name}}`, `{{cc_tools_json}}`, etc.
- **Generated output** — byte-identical before and after.
- **Template context variables** — the flat `{{variable}}` names in templates are an internal contract between the build script and templates. Renaming them is unnecessary churn.
- **Sync script** — reads from generated frontmatter, not source YAML. Unaffected.
- **Agent registry** — reads from generated frontmatter. Unaffected.

## Rationale

- **Grouping by IDE** makes the YAML self-documenting: a contributor can see at a glance which fields affect which IDE target.
- **Map style** (`ide_settings.vscode.file_name`) gives direct key access without array indexing.
- **`vscode` / `claude_code`** key names are short, snake_case, and match existing conventions.
- **Including `_shared.yaml`** in the migration ensures full consistency.
- **Keeping `model` at root level** (not under `ide_settings`) is correct because the plan's `model` field is a semantic choice ("which AI model to use") that applies conceptually across all IDE targets. The `cc_model` override is the exception — it moves under `ide_settings.claude_code.model` for those rare cases where a persona needs a different model on Claude Code specifically.
- **Keeping `id` at root level** is correct because it serves as a general-purpose programmatic identifier for the persona. While currently only consumed by VS Code `@id` routing, it is a useful stable handle that any tooling can reference.
- **Keeping `mcp_server_name` at root level** in `_shared.yaml` is correct because it is a project-level configuration value (the MCP server key in `.mcp.json`), not inherently tied to a single IDE.
- **Keeping `mcp_tools` at root level** is correct because MCP tool allocation is a persona-level design decision, not IDE-specific. The build script already renders it differently per-IDE (`tools_json` vs no table for CC targets), but the source data is shared.

## Detailed Steps

### Step 1 — Migrate all per-persona YAML files (ledger suite, 7 files)

For each of the 7 persona YAML files in `personas/ledger/src/meta/`:

1. Create an `ide_settings:` block with `vscode:` and `claude_code:` sections.
2. Move `vs_file_name` → `ide_settings.vscode.file_name`.
3. Move `tools` → `ide_settings.vscode.tools`.

**Note:** `id` remains at root level (general-purpose programmatic identifier).
4. Move `cc_file_name` → `ide_settings.claude_code.file_name`.
5. If the file has `cc_model`, move it → `ide_settings.claude_code.model`.
6. If the file has `cc_description`, move it → `ide_settings.claude_code.description`.
7. Remove the old flat fields.

**Files:** `1-planner.yaml`, `2-project-manager.yaml`, `3-developer.yaml`, `4-qa.yaml`, `5-reviewer.yaml`, `6-documentation.yaml`, `7-synthesis.yaml`

### Step 2 — Migrate all per-persona YAML files (standalone suite, 10 files)

Same structure as Step 1, but for standalone personas. Additionally:

1. If the file has `cc_tools`, move it → `ide_settings.claude_code.tools`.

**Files:** `researcher.yaml`, `manifest-curator.yaml`, `module-intent-architect.yaml`, `orchestrator-runner.yaml`, `changelog-curator.yaml`, `agents-md-curator.yaml`, `readme-curator.yaml`, `composer-curator.yaml`, `unit-test-auditor.yaml`, `whatsnew-curator.yaml`

### Step 3 — Migrate `_shared.yaml` (ledger)

In `personas/ledger/src/meta/_shared.yaml`:

1. Create an `ide_settings:` block.
2. Add `vscode: {}` (no shared VS Code settings currently — the empty map signals intent).
3. Move `cc_permission_mode` → `ide_settings.claude_code.permission_mode`.
4. Move `cc_memory` → `ide_settings.claude_code.memory`.
5. Move `default_cc_tools` → `ide_settings.claude_code.default_tools`.
6. Remove the old flat fields.

**Note:** `mcp_server_name` remains at root level (project-level configuration).

### Step 4 — Migrate `_shared.yaml` (standalone)

In `personas/standalone/src/meta/_shared.yaml`:

Same as Step 3 (standalone has no `mcp_server_name` at root level either).

### Step 5 — Update build script accessor layer

In [scripts/build-personas.js](scripts/build-personas.js):

1. Add accessor helper variables at the start of `buildForTarget()`'s per-persona loop (inside the `for` block, after loading the persona YAML):

   ```javascript
   const vsSettings = persona.ide_settings?.vscode || {};
   const ccSettings = persona.ide_settings?.claude_code || {};
   ```

2. Add shared accessor helpers after loading `sharedMeta`:

   ```javascript
   const sharedCC = sharedMeta.ide_settings?.claude_code || {};
   ```

3. Update all read patterns:

   | Location | Current | New |
   |---|---|---|
   | Context object `cc_permission_mode` (~line 606) | `sharedMeta.cc_permission_mode` | `sharedCC.permission_mode` |
   | Context object `cc_memory` (~line 607) | `sharedMeta.cc_memory` | `sharedCC.memory` |
   | Tools serialization, ledger (~line 575) | `persona.tools` | `vsSettings.tools` |
   | CC tools resolution (~line 577) | `persona.cc_tools \|\| sharedMeta.default_cc_tools` | `ccSettings.tools \|\| sharedCC.default_tools` |
   | `validateCcFileName` call (~line 580) | `persona.cc_file_name` | `ccSettings.file_name` |
   | `cc_name` derivation (~line 581) | `persona.cc_file_name.replace(...)` | `ccSettings.file_name.replace(...)` |
   | `cc_description` read (~line 583) | `persona.cc_description` | `ccSettings.description` |
   | Tools-list for standalone (~line 593) | `persona.tools` | `vsSettings.tools` |
   | CC tools-list for standalone (~line 594) | `persona.cc_tools \|\| sharedMeta.default_cc_tools` | `ccSettings.tools \|\| sharedCC.default_tools` |
   | Standalone `cc_name` (~line 600) | `persona.cc_file_name.replace(...)` | `ccSettings.file_name.replace(...)` |
   | `ccModel` ternary (~line 555) | `persona.cc_model` | `ccSettings.model` |
   | Context spread `...persona` (~line 612) | Spreads flat persona | Must still spread, but now `ide_settings` comes along as a nested object (harmless — it won't match any `{{variable}}` template) |

4. Update the context object to explicitly set `vs_file_name` from the new structure:

   ```javascript
   vs_file_name: vsSettings.file_name,
   ```

   This must be explicit because the `...persona` spread no longer contains `vs_file_name` at the top level. (`id` remains at persona root and is still covered by the spread.)

5. Update `validateCcFileName()` to accept the file_name string directly (or the settings object) instead of the persona object. The validation message should reference the new field path.

### Step 6 — Rebuild and verify

1. Run `node scripts/build-personas.js --suite all --strict` — must exit 0 with 34 personas.
2. **Diff check:** Compare generated output before and after to confirm byte-identical content. Save the current output with `cp -r personas/*/vs-code personas/*/claude-code /tmp/personas-before/` before making changes, then diff after.
3. Run `node scripts/build-personas.js --check` — must confirm no stale output.
4. Run `node scripts/check-known-roles.js` — must pass.
5. Run `node scripts/sync-personas.js --dry-run` — must complete without errors (validates sync reads generated frontmatter correctly).

### Step 7 — Update manifest documentation

- **[api-surface.md](personas/docs/agents/project-manifest/api-surface.md):**
  - Replace the flat `_shared.yaml` schema table with the new nested structure.
  - Replace the per-persona YAML schema tables (ledger + standalone) with the new `ide_settings` structure.
  - Update `validateCcFileName` signature.
  - Update computed variables table source descriptions.

- **[constraints.md](personas/docs/agents/project-manifest/constraints.md):**
  - Update constraint 13 (`vs_file_name` references → `ide_settings.vscode.file_name`).
  - Update constraint 14 (`cc_name` derivation from `cc_file_name` → `ide_settings.claude_code.file_name`).
  - Update constraint 15 (`cc_tools` override → `ide_settings.claude_code.tools`).
  - Update constraint 15 (`cc_tools` override → `ide_settings.claude_code.tools`).
  - Update constraint 28c (`cc_model` resolution → `ide_settings.claude_code.model`).
  - Update constraint 29 (`vs_file_name` required for sync → `ide_settings.vscode.file_name`).

- **[data-flows.md](personas/docs/agents/project-manifest/data-flows.md):**
  - Update the context assembly documentation to reflect the new accessor pattern.

### Step 8 — Update persona changelog

Add a changelog entry documenting the schema migration.

## Dependencies

- Steps 1–5 must all complete before Step 6 (verification).
- Steps 1–4 (YAML migrations) and Step 5 (build script) can be done in parallel by the same agent.
- Step 7 (manifest docs) should follow Step 6 to document verified behavior.
- Step 8 (changelog) should be last.

## Required Components

- 7 ledger per-persona YAML files (Step 1)
- 10 standalone per-persona YAML files (Step 2)
- `personas/ledger/src/meta/_shared.yaml` (Step 3)
- `personas/standalone/src/meta/_shared.yaml` (Step 4)
- `scripts/build-personas.js` (Step 5)
- `personas/docs/agents/project-manifest/api-surface.md` (Step 7)
- `personas/docs/agents/project-manifest/constraints.md` (Step 7)
- `personas/docs/agents/project-manifest/data-flows.md` (Step 7)
- `personas/changelog.md` (Step 8)
- No new files are created.

## Assumptions

- The generated frontmatter field names (`vs_file_name`, `model`, `tools`, etc.) are an internal contract between the build script and templates. They are intentionally **not** renamed — only the source YAML structure changes.
- No external tooling reads the source YAML files directly. All consumers read generated frontmatter.
- The `...persona` spread in the context object will now include an `ide_settings` key as a nested object. This is harmless — the `{{variable}}` resolver only matches simple word keys and will silently ignore it.
- Feature flags (`has_mcp`, `has_detect_project`, etc.) remain at the persona root level because they are not IDE-specific.
- The `id` field remains at the persona root level as a general-purpose programmatic identifier.
- The `mcp_server_name` field remains at root level in `_shared.yaml` as a project-level configuration value.
- The `mcp_tools` array remains at the persona root level because MCP tool allocation is a persona-level design decision.
- The `model` field (common model) remains at the persona root level. Only the CC-specific override moves under `ide_settings.claude_code.model`.

## Constraints

- Generated output must be byte-identical before and after. This is a source-refactor with zero output change.
- All persona source changes must flow through the Edit → Build → Sync workflow.
- Generated files must never be edited directly.
- The `persona.cc_model` escape hatch must be preserved — it moves from `persona.cc_model` to `ide_settings.claude_code.model`.

## Out of Scope

- Renaming template context variables (`{{vs_file_name}}`, `{{cc_tools_json}}`, etc.) — this would change generated output and is unnecessary.
- Adding new IDE targets (e.g., Cursor, Windsurf) — this plan creates the structure that makes future IDE additions easy, but does not add any.
- Adding per-persona VS Code tools override in `_shared.yaml` — currently there is no `default_tools` for VS Code because VS Code tool names are specified per-persona. This can be added later if needed.
- Changes to the MCP server sub-project.
- Changes to the sync script (it reads generated frontmatter, not source YAML).

## Acceptance Criteria

- All 17 per-persona YAML files use `ide_settings.vscode` and `ide_settings.claude_code` instead of flat `vs_*`/`cc_*` prefixed fields.
- Both `_shared.yaml` files use `ide_settings.claude_code` instead of flat `cc_*` prefixed fields.
- No per-persona or shared YAML file contains any `cc_*` or `vs_*` prefixed top-level field.
- The `tools` field has moved from root level to `ide_settings.vscode.tools` in all per-persona YAML files.
- The `id` field remains at root level in all per-persona YAML files.
- The `mcp_server_name` field remains at root level in the ledger `_shared.yaml`.
- `node scripts/build-personas.js --suite all --strict` exits 0 with 34 personas built.
- `node scripts/build-personas.js --check` confirms no stale output.
- Generated output is byte-identical to pre-migration output (verified by diff).
- `node scripts/check-known-roles.js` passes.
- `node scripts/sync-personas.js --dry-run` completes without errors.
- Manifest files (`api-surface.md`, `constraints.md`, `data-flows.md`) reflect the new `ide_settings` schema.
- `personas/changelog.md` has entry documenting the migration.

## Testing Strategy

1. **Pre-migration snapshot:** Save current generated output to a temp directory before any changes.
2. **Build verification:** `--suite all --strict` to confirm both suites build cleanly with zero unresolved markers.
3. **Byte-identical diff:** `diff -r` between pre-migration snapshot and post-migration output. Any differences indicate a bug.
4. **Freshness check:** `--check` to confirm generated output matches source truth.
5. **Role parity:** `check-known-roles.js` to ensure no cross-system drift.
6. **Sync dry-run:** `sync-personas.js --dry-run` to confirm sync still reads generated frontmatter correctly.
7. **Negative test:** `grep -rn '^cc_\|^vs_file_name\|^default_cc_' personas/*/src/meta/*.yaml` — must return zero matches (all prefixed fields are gone).

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Bulk YAML edits introduce typos** | Step 6 diff check catches any output deviation. The `--strict` mode catches unresolved template markers. |
| **`...persona` spread pollutes context with `ide_settings` key** | The `{{variable}}` resolver only matches `\w+` patterns — it cannot resolve nested objects. The `ide_settings` key is harmlessly ignored. |
| **Sync script breaks** | Sync reads **generated** frontmatter, not source YAML. Generated output is byte-identical. Additional safety: `--dry-run` validation in Step 6. |
| **Agent registry breaks** | Registry reads `name`, `role`, `id` from generated frontmatter. These fields remain in generated output. |
| **Future contributors confused by schema change** | Manifest docs (Step 7) and changelog (Step 8) provide full documentation. The new schema is more intuitive than the prefix convention. |
| **17 YAML files to edit increases error surface** | The edits are mechanical (move fields into a nested block). The diff check in Step 6 is the definitive verification. |
