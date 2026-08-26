# Persona Build System Guide

> A reference for editing personas in the ai-insights workspace. Covers the build pipeline, template syntax, metadata schema, partials, versioning, subagent declarations, and output targets.

**Version:** 1.0.0.
**Last Updated:** 2026-04-23.

---

## Overview

Personas in this workspace are **not hand-written output files**. They are assembled from source templates by the [`@mistralys/persona-builder`](https://www.npmjs.com/package/@mistralys/persona-builder) library. The build process combines three inputs — YAML metadata, Markdown content templates, and reusable partials — and produces target-specific output files for three platforms:

| Target | Output Format | Example Output |
|--------|---------------|----------------|
| **VS Code** | `*.agent.md` with YAML frontmatter | `3-dev.agent.md` |
| **Claude Code** | `*.md` with YAML frontmatter | `3-developer.md` |
| **Deep Agents** | `*.md` with minimal frontmatter | `3-developer.md` |

Two persona suites exist:

| Suite | Path | Discovery | Purpose |
|-------|------|-----------|---------|
| **Ledger** | `personas/ledger/src/` | `N-name.yaml` (numbered) | 9-agent MCP-backed workflow |
| **Ledger Support** | `personas/ledger-support/src/` | `slug.yaml` (kebab-case) | MCP-dependent utility agents for the ledger workflow |
| **Standalone** | `personas/standalone/src/` | `slug.yaml` (kebab-case) | Special-purpose personas with no MCP dependency |

Each suite produces output for all three targets — 9 output directories total.

---

## Directory Layout

```
personas/
├── persona-build.config.js          # Build configuration (suites, targets, plugins)
├── plugins/ledger/                   # Ledger plugin (CJS) — roster, MCP tools, role validation
├── shared/partials/                  # Base partial layer (suite-agnostic)
├── ledger/
│   ├── src/
│   │   ├── meta/                     # YAML metadata (1 per persona + _shared.yaml)
│   │   │   ├── _shared.yaml
│   │   │   ├── 1-planner.yaml
│   │   │   ├── 2-project-manager.yaml
│   │   │   └── ...
│   │   ├── content/                  # Markdown content templates (1 per persona)
│   │   │   ├── 1-planner.md
│   │   │   ├── 2-project-manager.md
│   │   │   └── ...
│   │   └── partials/                 # Ledger-specific partials (override layer)
│   ├── vs-code/                      # ← Generated output (never edit)
│   ├── claude-code/                  # ← Generated output (never edit)
│   └── deep-agents/                  # ← Generated output (never edit)
├── standalone/
│   ├── src/
│   │   ├── meta/                     # YAML metadata (1 per persona + _shared.yaml)
│   │   │   ├── _shared.yaml
│   │   │   ├── researcher.yaml
│   │   │   ├── manifest-curator.yaml
│   │   │   └── ...
│   │   └── content/                  # Markdown content templates
│   ├── vs-code/                      # ← Generated output (never edit)
│   ├── claude-code/                  # ← Generated output (never edit)
│   └── deep-agents/                  # ← Generated output (never edit)
└── name-mapping.json                 # Generated: agent name registry for MCP server
```

**Rule:** Never edit files in `vs-code/`, `claude-code/`, or `deep-agents/`. All changes go into the `src/` directory. Generated files carry a `<!-- AUTO-GENERATED — do not edit. -->` header.

---

## Build Pipeline

### How to Build

```bash
# Full build (all suites, all targets)
node scripts/build-personas.js

# Check for stale output (no writes — CI-safe)
node scripts/build-personas.js --check

# Strict mode — fail on unresolved {{markers}}
node scripts/build-personas.js --strict
```

### What Happens During a Build

For each suite × target × persona, the build engine:

1. **Loads metadata** — merges `_shared.yaml` + per-persona YAML into a context object.
2. **Computes variables** — generates derived values (`version`, `model`, `roster_rendered`, `mcp_tools_table`, `agent_*` variables, target flags).
3. **Selects frontmatter template** — per target and suite (ledger vs. standalone).
4. **Reads the content template** — `src/content/N-name.md` or `src/content/slug.md`.
5. **Runs the template engine** in strict order:
   - `resolvePartials()` — embed shared fragments
   - `resolveConditionals()` — evaluate `{{#if}}` / `{{else}}` / `{{else if}}` blocks
   - `resolveVariables()` — interpolate `{{variable}}` references
   - `collapseBlankLines()` — normalize whitespace
6. **Assembles the output** — frontmatter + auto-generated header + rendered body.
7. **Writes the output file** to the target directory.

Post-build (real builds only): the wrapper script generates `personas/name-mapping.json` and syncs `personas/package.json` version from the changelog.

### Validation Steps

| Check | When | Failure Mode |
|-------|------|--------------|
| Role validation (ledger plugin) | Every build | Warning (default) or error |
| `note_only` guard | Every build | Error — `note_only` tools must not appear in rendered output |
| `{{agent_slug_*}}` cross-reference | Every build + `--check` | Error — see [Subagent Declarations](#subagent-declarations) |
| Staleness check | `--check` flag | Error — generated file differs from disk |
| Unresolved markers | `--strict` flag | Error — `{{…}}` markers remain in output |

---

## Template Syntax

### Variables

Interpolate any metadata value into the content template:

```
{{variable_name}}
```

Replaced with `String(context[variable_name])`. Unknown variables emit a `[WARN]` and are left as-is.

**Example:**

```markdown
Your role identifier for all MCP tool calls is `{{role}}`.
```

With `role: Developer` in the YAML, this renders as:

```markdown
Your role identifier for all MCP tool calls is `Developer`.
```

### Partials

Embed a reusable Markdown fragment:

```
{{> partial-name}}
```

Resolves to the contents of `partial-name.md` from the merged partials registry. Recursive to depth 2. Unknown partials emit a `[WARN]`.

**Example:**

```markdown
{{> developer-strict-constraints}}
```

Embeds the full contents of `shared/partials/developer-strict-constraints.md` (or the suite-local override if one exists).

### Conditionals

Basic if/else:

```
{{#if flag}}
Content when flag is truthy.
{{else}}
Content when flag is falsy.
{{/if}}
```

Else-if chains (any number of branches):

```
{{#if target_vscode}}
VS Code–specific content.
{{else if target_claude_code}}
Claude Code–specific content.
{{else if target_deep_agents}}
Deep Agents–specific content.
{{else}}
Fallback content.
{{/if}}
```

First truthy branch wins. No `{{#each}}` loops are supported.

---

## Partials System

### Two-Layer Loading

Partials load in two passes per suite:

| Layer | Path | Purpose |
|-------|------|---------|
| **Base** | `personas/shared/partials/` | Suite-agnostic fragments shared across all suites |
| **Override** | `personas/<suite>/src/partials/` | Suite-specific fragments; same-named files shadow the base layer |

The base layer is optional. If a suite has no override layer, only the base partials are available.

### Naming Convention

- Filenames use **kebab-case** without number prefixes: `developer-strict-constraints.md`, `mcp-intro.md`.
- The partial name in templates matches the filename without `.md`: `{{> mcp-intro}}`.
- Platform-specific partials use a `-vscode` / `-claude-code` suffix: `handoff-block-vscode.md`, `handoff-block-claude-code.md`.

### Where Partials Live

| Partial Type | Location | Examples |
|--------------|----------|----------|
| Shared (all suites) | `personas/shared/partials/` | `developer-strict-constraints.md`, `qa-operational-protocol.md`, `incident-logging.md` |
| Ledger-only (MCP-specific) | `personas/ledger/src/partials/` | `mcp-intro.md`, `mcp-preflight-detect.md`, `handoff-block-vscode.md`, `role-boundaries.md` |

**Rule:** Never put MCP-specific content in `shared/partials/`. All MCP-workflow partials (`mcp-*`, `role-boundaries`, `handoff-block-*`) belong in `personas/ledger/src/partials/`.

### Using Platform-Specific Partials

When a section of content differs by target, use conditionals to select the right partial:

```markdown
{{#if target_vscode}}
{{> handoff-block-vscode}}
{{else}}
{{> handoff-block-claude-code}}
{{/if}}
```

For inline content that differs across all three targets, use else-if chains instead of partials:

```markdown
{{#if target_vscode}}
VS Code–specific inline content.
{{else if target_deep_agents}}
Deep Agents–specific inline content.
{{else}}
Claude Code–specific inline content.
{{/if}}
```

---

## Metadata Schema

Every persona has a YAML metadata file in `src/meta/`. A suite-wide `_shared.yaml` provides defaults; per-persona YAML files add or override fields.

### Context Merge Order

Later layers override earlier ones:

1. **`_shared.yaml`** — suite-wide defaults (author, version, model, tools, roster).
2. **Per-persona YAML** — all fields from the persona's own file.
3. **Computed values** — generated by the build engine (cannot be overridden by YAML).
4. **Target flags** — `target_vscode`, `target_claude_code`, `target_deep_agents` (set per build pass).

### Ledger `_shared.yaml`

| Field | Type | Description |
|-------|------|-------------|
| `author` | `string` | Author name in generated frontmatter |
| `last_updated` | `string` | ISO date string (e.g. `"2026-03-01 12:00"`) |
| `default_version` | `string` | **Required.** Default version for all personas (e.g. `"3.5.0"`). Absence = fatal build error. |
| `default_model` | `string` | Default AI model for VS Code frontmatter (e.g. `"Claude Sonnet 4.6"`) |
| `default_model_slug` | `string` | API model slug for orchestrator (e.g. `"claude-sonnet-4-6"`) |
| `mcp_server_name` | `string` | MCP server key (e.g. `"central_pm"`) |
| `cc_permission_mode` | `string` | Claude Code permission mode (e.g. `"acceptEdits"`) |
| `cc_model` | `string` | Claude Code model override — `"inherit"` defers to user config |
| `cc_memory` | `string` | Claude Code memory scope (e.g. `"project"`) |
| `default_cc_tools` | `string[]` | Default tool list for Claude Code frontmatter |
| `roster` | `Array<{number, title, short}>` | 9-entry list of agent identities |

**Example:**

```yaml
author: Sebastian Mordziol
last_updated: "2026-03-01 12:00"
default_version: "3.5.0"
default_model: "Claude Sonnet 4.6"
default_model_slug: "claude-sonnet-4-6"
mcp_server_name: "central_pm"
cc_permission_mode: "acceptEdits"
cc_model: "inherit"
cc_memory: "project"
default_cc_tools:
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
  - number: 2
    title: Technical Program Manager
    short: Task Decomposition & Project Management
```

### Standalone `_shared.yaml`

Same shape as ledger but **without** `mcp_server_name`, `roster`, `default_model`, or `default_model_slug`. Standalone personas are not part of the MCP-backed workflow. Individual standalone personas may opt into MCP support by setting `mcp_server_name` in their own YAML.

### Ledger Per-Persona YAML (`N-name.yaml`)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `number` | `int` | yes | Agent position (1–9) |
| `role` | `string` | yes | Workflow role — must match manifest role names |
| `id` | `string` | yes | Stable VS Code routing identifier (e.g. `ledger-3-dev`) |
| `vs_file_name` | `string` | yes | VS Code output filename (e.g. `3-dev.agent.md`) |
| `cc_file_name` | `string` | yes | Claude Code output filename (e.g. `3-developer.md`) |
| `da_file_name` | `string` | yes | Deep Agents output filename (e.g. `3-developer.md`) |
| `version` | `string` | no | Overrides `default_version` for this persona |
| `last_updated` | `string` | no | Per-persona last-updated date |
| `model` | `string` | no | AI model override (e.g. `"Claude Opus 4.6"`) |
| `model_slug` | `string` | no | API model slug override (e.g. `"claude-opus-4-6"`) |
| `tools` | `string[]` | yes | Tool permission slugs for the IDE |
| `cc_tools` | `string[]` | no | Claude Code tool names — overrides `default_cc_tools` |
| `subagents` | `string[]` | no | Standalone persona slugs this persona may delegate to |
| `has_mcp` | `bool` | yes | Feature flag: inject MCP pre-flight check and tools table |
| `has_detect_project` | `bool` | yes | Feature flag: inject detect-project pre-flight step |
| `self_documenting_note` | `bool` | yes | Feature flag: inject self-documenting tools note |
| `has_incident_logging` | `bool` | yes | Feature flag: inject incident logging instructions |
| `mcp_tools` | `Array<{tool, purpose, note_only?}>` | no | MCP tool entries for the rendered tools table |

**Example (Developer — Agent 3):**

```yaml
number: 3
role: Developer
vs_file_name: 3-dev.agent.md
id: ledger-3-dev
cc_file_name: 3-developer.md
da_file_name: 3-developer.md
version: "3.6.2"
last_updated: "2026-04-08"

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

has_mcp: true
has_detect_project: true
self_documenting_note: true
has_incident_logging: true

mcp_tools:
  - tool: ledger_get_next_action
    purpose: "Get the recommended action for your role."
  - tool: ledger_begin_work
    purpose: "Claim a READY WP and start the implementation pipeline."
  - tool: ledger_help
    note_only: true
    purpose: "Get usage documentation for any ledger tool."
```

### Standalone Per-Persona YAML (`slug.yaml`)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `slug` | `string` | yes | Kebab-case identifier (e.g. `researcher`) |
| `name` | `string` | yes | Human-readable display name (e.g. `"Researcher"`) |
| `description` | `string` | yes | Short description of the persona's purpose |
| `id` | `string` | yes | Stable VS Code routing identifier (e.g. `standalone-researcher`) |
| `vs_file_name` | `string` | yes | VS Code output filename (e.g. `researcher.agent.md`) |
| `cc_file_name` | `string` | yes | Claude Code output filename (e.g. `researcher.md`) |
| `da_file_name` | `string` | no | Deep Agents output filename (e.g. `ledger-orchestrator-runner.md`). When absent, the library falls back to the content template filename. |
| `version` | `string` | yes | Per-persona version string |
| `last_updated` | `string` | no | Per-persona last-updated date |
| `tools` | `string[]` | yes | Tool permission slugs |
| `cc_tools` | `string[]` | no | Claude Code tool overrides |
| `mcp_server_name` | `string` | no | Opt-in MCP support (e.g. `"central_pm"`) |

**Example (Researcher):**

```yaml
slug: researcher
name: "Researcher"
description: "Research solutions to complex problems through known patterns or creative thinking."
vs_file_name: researcher.agent.md
id: standalone-researcher
cc_file_name: researcher.md
version: "1.0.2"
last_updated: "2026-03-04"

tools:
  - vscode
  - execute
  - read
  - edit
  - search
  - web
  - agent
  - todo
```

### Feature Flags

Feature flags in per-persona YAML control conditional content injection. They only apply to ledger personas:

| Flag | Effect When `true` |
|------|-------------------|
| `has_mcp` | Injects MCP pre-flight check and the MCP tools table |
| `has_detect_project` | Injects detect-project pre-flight step |
| `self_documenting_note` | Injects a note about self-documenting MCP tool descriptions |
| `has_incident_logging` | Injects environment incident logging instructions |

Use these in content templates as standard conditionals:

```markdown
{{#if has_detect_project}}
{{> mcp-preflight-detect}}
{{/if}}
```

---

## Computed Variables

These variables are generated automatically by the build engine — they cannot be set in YAML.

### Agent Name Variables (`{{agent_*}}`)

The library pre-scans all persona YAML files across all configured suites and generates one `{{agent_<slug>}}` variable per persona. The slug uses underscores (hyphens replaced).

| Variable | Resolves To | Example |
|----------|-------------|---------|
| `{{agent_researcher}}` | `Researcher v1.0.2` | Display name + version |
| `{{agent_ledger_wp_decomposer}}` | `Ledger WP Decomposer v1.0.0` | From standalone persona YAML |
| `{{agent_changelog_curator}}` | `Changelog Curator v1.1.1` | From standalone persona YAML |

These are available in **every** persona's context across all suites. Use them when referencing another agent by name in content templates.

### Agent Slug Variables (`{{agent_slug_*}}`)

Similar to agent name variables, but resolve to the slug value (machine-readable identifier):

| Variable | Resolves To |
|----------|-------------|
| `{{agent_slug_ledger_wp_decomposer}}` | `ledger-wp-decomposer` |
| `{{agent_slug_ledger_bootstrapper}}` | `ledger-bootstrapper` |

Used in deep-agents target output where the orchestrator needs a machine identifier rather than a display name.

**Important:** `{{agent_slug_*}}` references in ledger persona content are **validated at build time** — see [Subagent Declarations](#subagent-declarations).

### Platform Target Flags

Injected automatically per target pass:

| Flag | `vscode` | `claude-code` | `deep-agents` |
|------|----------|---------------|---------------|
| `target_vscode` | `true` | `false` | `false` |
| `target_claude_code` | `false` | `true` | `false` |
| `target_deep_agents` | `false` | `false` | `true` |

### Other Computed Variables

| Variable | Source | Description |
|----------|--------|-------------|
| `{{version}}` | `persona.version` ?? `_shared.default_version` | Resolved version string |
| `{{model}}` | `persona.model` &#124;&#124; `_shared.default_model` | AI model name |
| `{{model_slug}}` | `persona.model_slug` &#124;&#124; `_shared.default_model_slug` | API model identifier |
| `{{cc_name}}` | `cc_file_name` without `.md` | Claude Code identifier (e.g. `3-developer`) |
| `{{cc_description}}` | Roster entry (ledger) or `description` (standalone) | Human-readable description |
| `{{cc_model}}` | `persona.cc_model` &#124;&#124; `_shared.cc_model` (standard YAML merge) | Claude Code model |
| `{{roster_rendered}}` | `_shared.roster[]` | Full numbered agent roster in Markdown |
| `{{mcp_tools_table}}` | `persona.mcp_tools[]` | Markdown table of MCP tools |
| `{{tools_json}}` | `persona.tools[]` | YAML flow sequence with brackets |
| `{{tools_list}}` | `persona.tools[]` | Comma-separated list without brackets |
| `{{cc_tools_json}}` | `persona.cc_tools` ?? `persona.tools` | CC tools with brackets |
| `{{cc_tools_list}}` | Same | CC tools without brackets |

---

## Subagent Declarations

When a persona delegates work to sub-agents, it must declare those sub-agents in its YAML metadata. The build system validates these declarations.

### How It Works

1. A persona's YAML metadata declares a `subagents` list of standalone persona slugs:

   ```yaml
   # 2-project-manager.yaml
   subagents:
     - ledger-wp-decomposer
     - ledger-dependency-sequencer
     - ledger-pipeline-configurator
     - ledger-bootstrapper
   ```

2. The content template references the sub-agent using `{{agent_slug_*}}` variables:

   ```markdown
   Use the `task` tool with the following arguments:
   - `subagent_type`: `"{{agent_slug_ledger_wp_decomposer}}"`
   ```

3. At build time, the build script scans every ledger content file for `{{agent_slug_*}}` references and verifies each one has a matching entry in the persona's `subagents` list.

### Validation Rules

- The variable suffix uses underscores: `{{agent_slug_ledger_wp_decomposer}}`
- The expected slug uses hyphens: `ledger-wp-decomposer`
- The conversion is: replace underscores with hyphens
- This check runs **unconditionally** — on both real builds and `--check` runs

### What Happens on Validation Failure

If a `{{agent_slug_*}}` reference exists in content but the corresponding slug is not in the `subagents` list, the build fails:

```
[ERROR] agent_slug cross-reference check failed:

  Persona "2-project-manager": {{agent_slug_foo_bar}} references slug "foo-bar"
  which is not declared in the subagents list.
  Add "foo-bar" to the subagents field in 2-project-manager.yaml.
```

### How to Fix

Add the missing slug to the `subagents` field in the persona's YAML:

```yaml
subagents:
  - ledger-wp-decomposer
  - foo-bar               # ← add the missing slug
```

### `{{agent_*}}` vs. `{{agent_slug_*}}`

| Variable Type | Resolves To | Validated? | Use Case |
|---------------|-------------|------------|----------|
| `{{agent_<slug>}}` | Display name + version (e.g. `Researcher v1.0.2`) | No | Human-readable references in all targets |
| `{{agent_slug_<slug>}}` | Machine slug (e.g. `researcher`) | Yes (ledger only) | Deep Agents `subagent_type` parameter |

`{{agent_*}}` variables do **not** require a `subagents` declaration. Only `{{agent_slug_*}}` variables are validated. Both variable types are available to all personas across all suites.

### Practical Example: Three-Target Sub-Agent Invocation

The Project Manager persona uses else-if chains to produce different invocation syntax per target:

```markdown
3. **Invoke WP Decomposer sub-agent:**
{{#if target_vscode}}
   Invoke `runSubagent` with the following arguments:
   - `agentName`: `"{{agent_ledger_wp_decomposer}}"`
   - `description`: `"Decompose plan into work packages"`
   - `prompt`: the full plan document content
{{else if target_claude_code}}
   Use the `Task` tool with `description: Use the custom agent
   "{{agent_ledger_wp_decomposer}}"`. Pass: the plan content.
{{else if target_deep_agents}}
   Use the `task` tool with the following arguments:
   - `subagent_type`: `"{{agent_slug_ledger_wp_decomposer}}"`
   - `task`: the plan document content.
{{else}}
   Call the **{{agent_ledger_wp_decomposer}}** subagent with:
   the plan content.
{{/if}}
```

Note how:
- VS Code and Claude Code targets use `{{agent_*}}` (display name) for human-readable agent routing.
- Deep Agents target uses `{{agent_slug_*}}` (machine slug) for programmatic routing.
- The `{{agent_slug_*}}` reference requires `ledger-wp-decomposer` in the `subagents` list.

---

## Versioning

### Per-Persona Versioning

Each persona has its own version, set in one of two ways:

| Method | Where | Effect |
|--------|-------|--------|
| Suite default | `_shared.yaml` → `default_version` | Applies to all personas without an explicit `version` |
| Per-persona override | `N-name.yaml` → `version` | Overrides `default_version` for this persona only |

**Example:** The ledger suite has `default_version: "3.5.0"`, but the Developer persona overrides it with `version: "3.6.2"`.

### Version Bump Rules

Every persona change requires **all three** of these steps:

1. **Bump `version`** in the persona's YAML metadata file. SemVer: patch for wording fixes, minor for behavioral changes, major for breaking changes.
2. **Update `last_updated`** in the same YAML file to today's date (`YYYY-MM-DD`).
3. **Add a changelog entry** in `personas/changelog.md` under a new or existing version heading.

If a shared partial change affects multiple personas, bump and date-stamp each affected persona individually.

### `id` Stability

The `id` field must **never change** once published. It is the routing key used by VS Code `@id` subagent routing. Version bumps, renames, or persona reordering must not alter the `id`.

| Suite | `id` Pattern | Example |
|-------|-------------|---------|
| Ledger | `ledger-{vs_file_name stem}` | `ledger-3-dev` |
| Standalone | `standalone-{vs_file_name stem}` | `standalone-researcher` |

---

## Frontmatter Templates

Each suite × target combination uses a specific frontmatter template. The frontmatter is prepended to the rendered content body.

### Ledger — VS Code

```yaml
---
id: {{id}}
name: '{{number}} - {{role}} v{{version}}'
description: 'Step {{number}}/{{total}} in the agent workflow.'
model: '{{model}}'
role: {{role}}
author: {{author}}
version: {{version}}
last_updated: {{last_updated}}
vs_file_name: {{vs_file_name}}
tools: {{tools_json}}
---
```

### Ledger — Claude Code

```yaml
---
name: {{cc_name}}
description: '{{cc_description}}'
role: {{role}}
author: {{author}}
version: {{version}}
last_updated: {{last_updated}}
tools: {{cc_tools_json}}
permissionMode: {{cc_permission_mode}}
model: '{{cc_model}}'
memory: {{cc_memory}}
{{#if has_mcp}}
mcpServers:
  - {{mcp_server_name}}
{{/if}}
---
```

### Standalone — VS Code

```yaml
---
id: {{id}}
name: '{{name}} v{{version}}'
description: '{{description}}'
author: {{author}}
version: {{version}}
last_updated: {{last_updated}}
vs_file_name: {{vs_file_name}}
tools: [{{tools_list}}]
---
```

### Standalone — Claude Code

```yaml
---
name: {{cc_name}}
description: '{{description}}'
author: {{author}}
version: {{version}}
last_updated: {{last_updated}}
tools: [{{cc_tools_list}}]
permissionMode: {{cc_permission_mode}}
model: {{cc_model}}
memory: {{cc_memory}}
{{#if mcp_server_name}}
mcpServers:
  - {{mcp_server_name}}
{{/if}}
---
```

### Deep Agents — All Suites

```yaml
---
name: {{id}}
description: '{{cc_description}}'
---
```

> **No tools field.** The Deep Agents frontmatter emits only `name` and `description`. Tool availability for this target is determined at runtime by the orchestrator's `create_deep_agent()` call, not by persona YAML — see `orchestrator/docs/architecture.md` § Built-in Tool Suite.

---

## Common Editing Scenarios

### Adding a New Ledger Persona

1. Create `src/meta/N-name.yaml` with all required fields.
2. Create `src/content/N-name.md` with the content template.
3. Add the agent to `_shared.yaml` → `roster[]`.
4. Run `node scripts/build-personas.js` and verify output.
5. Add a changelog entry in `personas/changelog.md`.

### Adding a New Standalone Persona

1. Create `src/meta/slug.yaml` with all required fields.
2. Create `src/content/slug.md` with the content template.
3. Run `node scripts/build-personas.js` and verify output.
4. Add a changelog entry in `personas/changelog.md`.

### Adding a New Partial

1. Decide scope: suite-agnostic → `shared/partials/`; ledger-only → `ledger/src/partials/`.
2. Create `partial-name.md`.
3. Reference it in content templates with `{{> partial-name}}`.
4. Rebuild to verify.

### Adding a Subagent to a Ledger Persona

1. Add the standalone persona slug to the `subagents` list in the ledger persona's YAML.
2. Use `{{agent_<slug>}}` for display name references in the content template.
3. Use `{{agent_slug_<slug>}}` for machine identifiers (deep-agents target only).
4. Rebuild — the cross-reference validation will catch any mismatches.

### Overriding a Shared Partial for One Suite

Create a file with the **same name** in the suite's `src/partials/` directory. It will shadow the shared version for that suite only.

### Using Feature Flags

Set the flag in the persona's YAML:

```yaml
has_mcp: true
has_detect_project: true
```

Reference it in the content template:

```markdown
{{#if has_detect_project}}
{{> mcp-preflight-detect}}
{{/if}}
```

### Making a Model Override

Set `model` in the persona's YAML to override the suite default:

```yaml
model: "Claude Opus 4.6"          # VS Code frontmatter
model_slug: "claude-opus-4-6"     # orchestrator API calls
```

---

## Build Configuration

The build config lives in `personas/persona-build.config.js` (CommonJS). It configures:

| Property | Purpose |
|----------|---------|
| `sharedPartialsDir` | Path to `personas/shared/partials/` |
| `targets` | `['vscode', 'claude-code', 'deep-agents']` |
| `frontmatter` | Config-level frontmatter templates (used as defaults) |
| `suites` | Suite definitions with source and output paths |
| `plugins` | Plugin instances — currently `[ledgerPlugin({...})]` |

### Ledger Plugin

The `ledgerPlugin` (in `personas/plugins/ledger/`) provides:

- **`onSuiteInit`** — applies ledger-specific frontmatter templates only for the numbered suite.
- **`onBuildContext`** — injects `roster_rendered`, `mcp_tools_table`, `total`, model resolution, `cc_name`, and `cc_description` into the build context.
- **`onPostRender`** — captures rendered output for the `note_only` validation.
- **`onValidate`** — validates persona `role` against workflow manifest roles, and runs the `note_only` guard (using output captured by `onPostRender`).

### Plugin Convention

All plugins under `personas/plugins/` must use **CommonJS** (`module.exports` / `require()`). The build config loader is CJS and loads plugins via `require()`. Do not convert to ESM.

---

## Name-Mapping Generation

After every real build (skipped on `--check` runs), `scripts/build-personas.js` generates `personas/name-mapping.json`. This file is the canonical agent name registry consumed by the MCP server at startup.

### What It Contains

Each entry covers one persona across all three suites:

| Field | Present in | Description |
|-------|-----------|-------------|
| `id` | All | Stable routing identifier (e.g. `ledger-3-dev`) |
| `role` | All | Role name — canonical AgentRole for ledger, free-form for other suites |
| `number` | Ledger only | Numeric position (1–9); `null` for standalone and ledger-support |
| `suite` | All | `"ledger"`, `"standalone"`, or `"ledger-support"` |
| `version` | All | Persona version string |
| `model` | All | Resolved model display name (e.g. `"Claude Sonnet 4.6"` or `"Inherit / Auto"`) |
| `model_slug` | All | API-compatible slug (e.g. `"claude-sonnet-4-6"` or `"inherit"`) |
| `cc_model` | All | Claude Code model identifier (e.g. `"inherit"`) |
| `vscode` | All | `{ file_name, agent_name }` for the VS Code target |
| `claude_code` | All | `{ file_name, agent_name }` for the Claude Code target |
| `deep_agents` | All | `{ file_name, agent_name }` for the Deep Agents target |

The MCP server's `AGENT_NAMES` constant filters this array to ledger-only entries (`suite === "ledger"` or absent) before keying by role name.

### Role Derivation for Non-Ledger Suites

Standalone and ledger-support entries have no canonical role field in their YAML. The build derives `role` by stripping the suite suffix from the persona `name` field:

- `"Developer (Standalone)"` → `role: "Developer"`
- `"Ledger WP Decomposer (Ledger Support)"` → `role: "Ledger WP Decomposer"`

---

## Model Resolution

Model fields in `name-mapping.json` are resolved at build time from the model registry. The resolution logic lives in `scripts/lib/persona-model-resolution.js` — a standalone ESM module imported by both `build-personas.js` and the model resolution unit tests.

### The `loadModelRegistry()` Function

```js
import { loadModelRegistry } from './scripts/lib/persona-model-resolution.js';

const { uuidToSlug, registryEntries, assignments } = loadModelRegistry(registryDir, opts);
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `registryDir` | `string` | Absolute path to the `personas/model-registry/` directory |
| `opts.warn` | `function` | Optional override for `console.warn` — useful in tests to capture warnings |

**Returns:** An object with three keys:

| Key | Type | Description |
|-----|------|-------------|
| `uuidToSlug` | `Map<string, string>` | UUID → slug map built from the registry entries |
| `registryEntries` | `object[]` | Full array of `{ id, name, slug, cc_model }` registry entries |
| `assignments` | `object \| null` | Parsed `assignments.json` if present; `null` otherwise |

**Graceful degradation:**

- If `local.json` is absent, falls back to `default.json`.
- If both are absent, returns an empty `uuidToSlug` and `registryEntries: []`.
- If `assignments.json` is absent (standard in clean installs), `assignments` is `null`.
- File parse errors emit a `[WARN]` via the configured `warn` function and are silently skipped — the build never crashes due to a missing or malformed registry file.

### The `resolveModel()` Function

```js
import { resolveModel } from './scripts/lib/persona-model-resolution.js';

const { model, model_slug, cc_model } = resolveModel(
  personaId, yamlModelSlug, sharedModelSlug, sharedModelName,
  uuidToSlug, assignments, registryEntries,
  { warn, warnedSlugs }   // optional
);
```

**Priority chain** (first matching level wins):

| Priority | Source | Skip condition |
|----------|--------|---------------|
| 1 | `assignments.json` `persona_models[personaId]` | Resolved slug is `"inherit"` |
| 2 | Per-persona YAML `model_slug` | Value is `"inherit"` |
| 3 | `assignments.json` `default_model_uuid` | Resolved slug is `"inherit"` |
| 4 | `_shared.yaml` `default_model_slug` / `default_model` | — |
| 5 | Sentinel fallback | — (always matches) |

The sentinel fallback returns `{ model: "Inherit / Auto", model_slug: "inherit", cc_model: "inherit" }`.

**Slug must match the registry.** Levels 2 and 4 look the slug up in the registry to obtain the
display `name` and `cc_model`. When the slug matches no entry, resolution still returns a usable
`model_slug` (the orchestrator reads it from YAML directly), but `model` falls back to the raw
slug and `cc_model` degrades to `"inherit"`. `resolveModel()` emits one `[WARN]` per unmatched
slug so the mismatch is visible instead of silent.

> The shipped `default.json` uses display-style slugs (`Claude Opus 4.6 (anthropic)`) while
> persona YAML uses API-style slugs (`claude-opus-4-6`). These namespaces do not overlap, so
> `default.json` alone never satisfies a YAML slug lookup — a real `local.json` is required for
> `model` / `cc_model` to resolve meaningfully.

**Model fields are gated on a local registry.** `scripts/build-personas.js` calls `resolveModel()`
only when `local.json` or `assignments.json` exists. Without either, the `model`, `model_slug`,
and `cc_model` keys are **omitted** from `name-mapping.json` entries rather than written with
fallback values — those values are machine-dependent and would otherwise churn the committed
file on every clone. Naming fields are always written: the MCP server `require()`s this file at
startup for `AGENT_NAMES` and needs them regardless of model configuration.

**Parameter reference:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `personaId` | `string \| undefined` | Persona ID used as the key in `assignments.persona_models` |
| `yamlModelSlug` | `string \| undefined` | Per-persona `model_slug` from YAML (after suite-default fallback) |
| `sharedModelSlug` | `string \| undefined` | `_shared.yaml` `default_model_slug` |
| `sharedModelName` | `string \| undefined` | `_shared.yaml` `default_model` (display name fallback) |
| `uuidToSlug` | `Map<string, string>` | From `loadModelRegistry()` |
| `assignments` | `object \| null` | From `loadModelRegistry()` |
| `registryEntries` | `object[]` | From `loadModelRegistry()` |

This priority chain mirrors the resolution order used by the build plugin and the orchestrator, keeping model selection consistent across all three execution paths.

---

## Quick Reference

| I Need To… | Do This |
|------------|---------|
| Build all personas | `node scripts/build-personas.js` |
| Check for stale output (CI) | `node scripts/build-personas.js --check` |
| Build + deploy to IDE | `node scripts/sync-personas.js` |
| Add a new persona | Create matching `src/meta/*.yaml` + `src/content/*.md` |
| Add a shared partial | Create in `personas/shared/partials/` |
| Add an MCP-specific partial | Create in `personas/ledger/src/partials/` |
| Reference another agent by name | Use `{{agent_<slug>}}` (underscores, not hyphens) |
| Reference another agent by slug | Use `{{agent_slug_<slug>}}` + add to `subagents` |
| Override suite default version | Add `version` to per-persona YAML |
| Override model for one persona | Add `model` / `model_slug` to per-persona YAML |
| Write platform-specific content | Use `{{#if target_vscode}}` / `{{else if …}}` chains |
| Inject conditional content | Use feature flags in YAML + `{{#if flag}}` in content |
| Understand model resolution | See [Model Resolution](#model-resolution) above |
| Inspect the agent name registry | Read `personas/name-mapping.json` (generated on build) |
