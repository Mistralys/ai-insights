# Personas - Manifest
<INSTRUCTION>
# Personas - Project Manifest
Complete project manifest: tech stack, architectural constraints, API surface (template syntax, feature flags, partials), data flows, and file tree.

</INSTRUCTION>
------------------------------------------------------------
_SOURCE: Project manifest (tech stack, constraints, API surface, data flows, file tree)_
# Project manifest (tech stack, constraints, API surface, data flows, file tree)
```
// Structure of documents
└── personas/
    └── docs/
        └── agents/
            └── project-manifest/
                └── README.md
                └── api-surface.md
                └── constraints-build-system.md
                └── constraints-cross-system.md
                └── constraints.md
                └── data-flows.md
                └── file-tree.md
                └── tech-stack.md

```
###  Path: `/personas/docs/agents/project-manifest/README.md`

```md
# Project Manifest: Ledger Personas Build System

**Version:** 1.2.0  
**Last Updated:** 2026-03-15  
**Purpose:** Templated build system for generating the 9 ledger-enabled AI agent persona files

---

## Overview

The **Ledger Personas Build System** is a Node.js-based template engine that assembles the 9 ledger persona Markdown files from structured YAML metadata and Markdown content/partial templates. The generated personas define the behaviour of AI agents in a multi-agent software development workflow backed by the [Project Ledger MCP Server](../../../../mcp-server/README.md).

Generated persona files are consumed in two ways:
- **Directly** — users copy-paste persona content into AI IDE chat sessions
- **Via sync** — `sync-personas.js` copies generated files to VS Code's User prompts directory (using `vs_file_name` frontmatter) and/or Claude Code's `~/.claude/agents/` directory (using `name` frontmatter)

---

## Manifest Sections

| Section | Description |
|---------|-------------|
| [Tech Stack & Patterns](tech-stack.md) | Runtime, dependencies, build tools, and architectural patterns |
| [Public API Surface](api-surface.md) | CLI interface, config shape, template syntax, metadata schema, and MCP tool allocation matrix |
| [Key Data Flows](data-flows.md) | Build pipeline (wrapper → library → plugin hooks → output), template resolution, and sync flows |
| [File Tree](file-tree.md) | Annotated directory structure — source templates, generated output, and build scripts |
| [Constraints & Conventions](constraints.md) | Core rules: source editing, naming, versioning, and safety guards |
| [Build System Constraints](constraints-build-system.md) | Template engine behavior, build flags, log conventions, and sync script rules |
| [Cross-System Constraints](constraints-cross-system.md) | Synchronization contracts with the MCP server, Agent Registry, and historical differences |

---

## Quick Reference

**Build all suites and targets (default):**
```bash
node scripts/build-personas.js
```

> Suite and target selection is controlled by `personas/persona-build.config.js`, not by CLI flags. The wrapper always builds all suites (`ledger`, `standalone`) for both targets (`vscode`, `claude-code`).

**Check for stale output (CI-friendly):**
```bash
node scripts/build-personas.js --check
```

**Preview without writing:**
```bash
node scripts/build-personas.js --dry-run
```

**Validate generated output for unresolved markers (strict mode):**
```bash
node scripts/build-personas.js --strict
```

Passes exit 0 if all markers resolved; exits 1 with `[STRICT]` log line(s) on any unresolved `{{variable}}` or `{{> partial}}` markers. Use in CI pipelines or pre-commit hooks to gate on zero unresolved markers.

**Build + sync to both IDEs (VS Code + Claude Code):**
```bash
node scripts/sync-personas.js
```

**Build + sync to a specific IDE only:**
```bash
node scripts/sync-personas.js --target vscode
node scripts/sync-personas.js --target claude-code
```

```
###  Path: `/personas/docs/agents/project-manifest/api-surface.md`

```md
# Public API Surface

## Build System

The persona build system consists of two files in this workspace:

| File | Role |
|------|------|
| `scripts/build-personas.js` | Thin CLI wrapper — resolves paths, reads flags, and delegates to the `@mistralys/persona-builder` library CLI |
| `personas/persona-build.config.js` | Build configuration — declares suite directories, output paths, and plugins |

All template engine logic (partial resolution, conditionals, variable interpolation, frontmatter assembly) is implemented inside the `@mistralys/persona-builder` library.

### `scripts/build-personas.js` — CLI Interface

The wrapper accepts three flags. Suite and target selection are controlled by the config file.

| Flag | Effect |
|------|--------|
| *(none)* | Delegate full build to `@mistralys/persona-builder` for all suites and targets in the config |
| `--check` | Forward `--check` to the library CLI — compare generated output against existing files; exit 1 if stale |
| `--dry-run` | Treated as `--check` (sets `CHECK=true`); no disk writes |
| `--strict` | Forward `--strict` to the library CLI — exit 1 if unresolved `{{variable}}` or `{{> partial}}` markers remain in output |

Post-build (real builds only, not `--check`/`--dry-run`): the wrapper performs two steps: (1) reads `personas/changelog.md`, extracts the latest `## vX.Y.Z` version, and writes it to `personas/package.json` if it differs; (2) reads all 9 ledger persona YAML files in `personas/ledger/src/meta/` plus `_shared.yaml` (for `default_version`), computes per-target agent names, and writes `personas/name-mapping.json` (9 entries sorted by `number`). Each entry shape: `role`, `number`, `id`, `version`, and target blocks `vscode`, `claude_code`, `deep_agents` — each with `file_name` and `agent_name`.

**Unconditional (both real builds and `--check`):** A cross-reference validation step scans every `personas/ledger/src/content/*.md` file for `{{agent_slug_X_Y}}` references and verifies that the corresponding slug `x-y` is declared in the persona's `subagents` field in its YAML. Errors accumulate across all personas before a single `[ERROR]` block is printed and `process.exit(1)` is called. Personas with no `{{agent_slug_*}}` references pass silently. The internal helper `extractSubagentsList(text, key)` parses flat dash-prefixed YAML block lists (strips inline comments and surrounding quotes); it is local to the validation block and is not exported.

### `personas/persona-build.config.js` — Config Interface

The config file is loaded by the library CLI. It exports an object with the following shape:

| Property | Type | Description |
|----------|------|-------------|
| `sharedPartialsDir` | `string` | Absolute path to `personas/shared/partials/` — base partial layer shared across all suites |
| `targets` | `string[]` | Ordered list of build target names — e.g. `['vscode', 'claude-code', 'deep-agents']`. Each target triggers a separate render pass per persona. The three built-in targets (`vscode`, `claude-code`, `deep-agents`) are registered by the `@mistralys/persona-builder` library; per-suite output paths are configured via `outVscode`, `outClaudeCode`, and `outputDirs` respectively. |
| `frontmatter` | `Object.<string, string>` | Config-level frontmatter template map keyed by target name. Used as the default for suites or targets the ledger plugin does not override. The ledger plugin overrides `vscode` and `claude-code` for the ledger suite via its `onSuiteInit` hook; the `deep-agents` template applies to both suites unchanged. |
| `suites` | `Object.<string, SuiteConfig>` | Suite definitions keyed by suite name (`ledger`, `standalone`) |
| `plugins` | `Array` | Plugin instances — currently `[ledgerPlugin({...})]` for role validation |

**Suite Configuration**

Each suite entry (`suites.ledger`, `suites.standalone`) has this shape:

| Property | Value | Description |
|----------|-------|-------------|
| `srcDir` | `personas/<suite>/src/` | Source templates directory |
| `outVscode` | `personas/<suite>/vs-code/` | VS Code output directory |
| `outClaudeCode` | `personas/<suite>/claude-code/` | Claude Code output directory |
| `outputDirs` | `Object.<string, string>` | Extension point for built-in targets beyond `vscode` and `claude-code`. Maps target name to absolute output path — e.g. `{ 'deep-agents': '…/personas/<suite>/deep-agents' }`. Required for each suite that participates in the deep-agents target. |
| `personaMode` | `'numbered'` \| `'standalone'` | Persona discovery and frontmatter mode |

`personaMode: 'numbered'` uses `N-name.yaml` discovery and number-prefixed frontmatter fields. `personaMode: 'standalone'` uses slug-based YAML discovery and slug-derived frontmatter.

**`ledgerPlugin` options**

| Option | Type | Description |
|--------|------|-------------|
| `manifestRoles` | `string[]` | Array of role name strings from `shared/workflow-manifest.json` — used to validate persona `role` fields |
| `warnOnUnknownRole` | `boolean` | Controls severity when a persona `role` is not in `manifestRoles`. `true` (default): emits a `warning` — build continues. `false`: escalates to `error` — hard failure. |

### Template Processing Order

Phases execute in strict order inside the library — each phase sees the output of the previous phase:

```
1. resolvePartials()       →  embed shared fragments
2. resolveConditionals()   →  strip/keep feature-flagged blocks
3. resolveVariables()      →  interpolate metadata values
4. collapseBlankLines()    →  normalize whitespace
```

---

## Template Syntax

### Partials

```
{{> partial-name}}
```

Embeds a partial from the merged partials registry. Recursive to depth 2 (partials can include other partials). Unknown partials emit a warning and are left as-is in the output.

**Two-layer loading:** The library loads partials in two passes:
1. **Base layer** — `personas/shared/partials/` (suite-agnostic content shared across all suites)
2. **Override layer** — `personas/<suite>/src/partials/` (suite-specific partials; same-named entries shadow the base layer)

The base layer is optional: if `personas/shared/partials/` does not exist it is silently skipped. This allows suites to opt out of the shared layer entirely.

### Conditionals

```
{{#if flag}}
… content included when flag is truthy …
{{/if}}
```

An optional `{{else}}` branch is supported:

```
{{#if flag}}
… content when flag is truthy …
{{else}}
… content when flag is falsy …
{{/if}}
```

**Nested conditionals** — `{{#if}}` blocks may be nested inside `{{else}}` branches,
enabling per-target content differentiation across all three targets:

```
{{#if target_vscode}}
… VS Code–specific content …
{{else}}
{{#if target_deep_agents}}
… Deep Agents–specific content …
{{else}}
… Claude Code–specific content …
{{/if}}
{{/if}}
```

The engine resolves nested blocks innermost-first and produces clean output with no stray
`{{/if}}` markers. This pattern is used in the PM persona for sub-agent invocation steps.

No `{{#each}}` support.

### Variables

```
{{variable}}
```

Replaced with `String(context[variable])`. Unknown variables emit a warning and are left as-is.

### Computed Variables

These are generated by the library — they cannot be set in YAML files:

| Variable | Suite | Source | Output |
|----------|-------|--------|--------|
| `{{roster_rendered}}` | ledger | `_shared.yaml` → `roster[]` | Numbered Markdown list of all 9 agents, with `(YOU)` marker |
| `{{mcp_tools_table}}` | ledger | per-persona YAML → `mcp_tools[]` | Markdown table rows: `\| \`tool\` \| purpose \|` |
| `{{tools_json}}` | ledger | per-persona YAML → `tools[]` | YAML flow sequence with brackets: `['vscode', 'execute', ...]` — used in `FRONTMATTER_LEDGER_VSCODE` |
| `{{tools_list}}` | standalone | per-persona YAML → `tools[]` | Comma-separated quoted list **without** brackets: `'vscode', 'execute', ...` — embedded inside `[…]` in standalone frontmatter |
| `{{cc_tools_json}}` | ledger | `persona.cc_tools` → fallback `_shared.default_cc_tools[]` | YAML flow sequence with brackets: `['Bash', 'Read', ...]` — used in `FRONTMATTER_LEDGER_CC` |
| `{{cc_tools_list}}` | standalone | `persona.cc_tools` → fallback `_shared.default_cc_tools[]` | Comma-separated quoted list **without** brackets: `'Bash', 'Read', ...` — embedded inside `[…]` in standalone CC frontmatter |
| `{{cc_name}}` | all | persona `cc_file_name` (`.md` stripped) | Kebab-case Claude Code identifier. Ledger: `N-role` (e.g. `3-developer`); standalone: plain slug (e.g. `researcher`) |
| `{{cc_description}}` | all | **Ledger:** `_shared.yaml` → `roster[]` `title` + `short` for the matching persona `number` (e.g. `"Technical Writing Manager — Documentation & README curation"`). **Standalone:** falls back to the persona YAML `description` field when no roster match exists. | Dual-context human-readable description used in `FRONTMATTER_LEDGER_CC` and `FRONTMATTER_DA`. Roster-derived for ledger; YAML-`description` for standalone. |
| `{{model}}` | ledger | `persona.model` → `_shared.default_model` → `_shared.cc_model` → `'inherit'` | AI model name for VS Code frontmatter (e.g. `"Claude Opus 4.6"` or `"Claude Sonnet 4.6"`). Resolution uses `||` not `??` for the shared fallbacks, so falsy values are skipped. |
| `{{model_slug}}` | ledger | `persona.model_slug` → `_shared.default_model_slug` | API-compatible model identifier consumed by the orchestrator (e.g. `"claude-opus-4-6"`). Not rendered into generated frontmatter templates; available in build context for orchestrator use. Resolution uses `||` (falsy-skip), matching the `{{model}}` pattern. |
| `{{cc_model}}` | all | `persona.cc_model` (if present) → resolved `model` | AI model name for Claude Code frontmatter. Inherits the full model resolution chain when no per-persona `cc_model` is set. |
| `{{agent_<slug>}}` | all | persona YAML `name` + `version` (all suites) | Display name for any agent across all configured suites (e.g. `{{agent_wp_decomposer}}` → `"WP Decomposer v1.0.0"`). One variable per persona, keyed by `agent_` + slug with hyphens replaced by underscores. Computed automatically by the `@mistralys/persona-builder` library's pre-scan phase in `build()` — available in every persona's context across all suites. Used in templates that invoke sub-agents via `runSubagent`. |

### Platform Feature Flags

Injected per target pass — cannot be set in YAML:

| Flag | Type | Value when target = `vscode` | Value when target = `claude-code` | Value when target = `deep-agents` |
|------|------|-------------------------------|-----------------------------------|-----------------------------------|
| `{{target_vscode}}` | `bool` | `true` | `false` | `false` |
| `{{target_claude_code}}` | `bool` | `false` | `true` | `false` |
| `{{target_deep_agents}}` | `bool` | `false` | `false` | `true` |

Use these flags in content templates to write platform-conditional blocks:
```
{{#if target_vscode}}
… VS Code–specific content …
{{else}}
… Claude Code–specific content …
{{/if}}
```

---

## Metadata Schema

### `_shared.yaml`

| Field | Type | Description |
|-------|------|-------------|
| `author` | `string` | Author name embedded in generated frontmatter |
| `last_updated` | `string` | ISO-style date string (e.g. `"2026-02-21 18:30"`) |
| `default_version` | `string` | **Required.** Default version string (e.g. `"3.4.0"`) unless overridden per-persona. Absence causes `[ERROR]` + `process.exit(1)` in the library build. |
| `default_model` | `string` | Default AI model for generated frontmatter (e.g. `"Claude Sonnet 4.6"`). Per-persona `model` overrides this. |
| `default_model_slug` | `string` | API-compatible model slug for orchestrator API calls (e.g. `"claude-sonnet-4-6"`). Per-persona `model_slug` overrides this. Not written into generated frontmatter. |
| `mcp_server_name` | `string` | MCP server name used in tool patterns and references (e.g. `"central_pm"`) |
| `roster` | `Array<{number, title, short}>` | 9-entry list of agent identities |
| `cc_permission_mode` | `string` | Claude Code permission mode (e.g. `"acceptEdits"`) |
| `cc_model` | `string` | Claude Code model override — `"inherit"` to defer to user config. Also serves as the final named fallback in the VS Code `model` resolution chain (after `default_model`), so suites without `default_model` (e.g. standalone) resolve to this value. |
| `cc_memory` | `string` | Claude Code memory scope — e.g. `"project"` |
| `default_cc_tools` | `string[]` | Default tool list for Claude Code frontmatter — applied to all personas unless per-persona `cc_tools` overrides it (e.g. `["Bash", "Read", "Edit", ...]`) |

### Per-Persona YAML (`N-name.yaml`) — Ledger Suite

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `number` | `int` | yes | Agent position (1–9) |
| `role` | `string` | yes | Workflow role identifier — must match `AGENT_ROLES` in MCP server |
| `model` | `string` | no | AI model override — replaces `default_model` for this persona (e.g. `"Claude Opus 4.6"`) |
| `model_slug` | `string` | no | API-compatible model slug — overrides `default_model_slug` from `_shared.yaml` (e.g. `"claude-opus-4-6"`). Consumed by the orchestrator directly; not written into generated frontmatter. |
| `id` | `string` | yes | Stable VS Code routing identifier for `@id` subagent routing. Pattern: `ledger-{vs_file_name stem}` (e.g. `ledger-3-dev` for `3-dev.agent.md`). Must be lowercase, no spaces, and stable across version bumps. |
| `vs_file_name` | `string` | yes | Output filename when synced to VS Code prompts dir |
| `cc_file_name` | `string` | yes | Output filename when synced to Claude Code projects dir (e.g. `"3-developer.md"`). **Required.** Absence causes `[ERROR]` + `process.exit(1)` in the library build. |
| `da_file_name` | `string` | yes | Output filename for the deep-agents target (e.g. `"3-developer.md"`). Follows the same `N-<role-slug>.md` pattern as `cc_file_name`. Intentionally absent from standalone YAMLs — the deep-agents target falls back to the content file basename (e.g. `researcher.md`) for standalone personas. |
| `version` | `string` | no | Overrides `default_version` for this persona |
| `tools` | `string[]` | yes | Tool permission slugs for the AI IDE |
| `cc_tools` | `string[]` | no | Tool names for Claude Code — overrides `default_cc_tools` from `_shared.yaml` when present (e.g. `["Bash", "Read", "Edit", ...]`) |
| `subagents` | `string[]` | no | Flat dash-prefixed list of standalone persona slugs that this ledger persona may delegate to as sub-agents. Each slug resolves to `personas/standalone/src/meta/{slug}.yaml`. Currently only carried by the Project Manager (Agent 2), where it lists the four PM planning sub-agents (`ledger-wp-decomposer`, `ledger-dependency-sequencer`, `ledger-pipeline-configurator`, `ledger-bootstrapper`). Consumed by the orchestrator's `load_subagents()` loader at pipeline startup to load the matching standalone persona YAML and make the sub-agent available for invocation. The template engine silently ignores unknown YAML keys, so this field has no effect on persona build output. |
| `has_mcp` | `bool` | yes | Inject MCP pre-flight check and tools table |
| `has_detect_project` | `bool` | yes | Inject detect-project pre-flight step |
| `self_documenting_note` | `bool` | yes | Inject self-documenting tools note |
| `has_incident_logging` | `bool` | yes | Inject environment incident logging instructions |
| `mcp_tools` | `Array<{tool, purpose, note_only?}>` | no | MCP tool entries for the tools table; omitted for Agent 1. When `note_only: true` is set on an entry, the library excludes it from the rendered table — the tool is mentioned only in prose content. Use this flag when a tool should be acknowledged in context (e.g. help-text prose) but must not appear as a first-class table row in the generated persona output. |

---

## Generated Frontmatter Templates (All Suites)

### Ledger — VS Code (`FRONTMATTER_LEDGER_VSCODE`)

Written to `personas/ledger/vs-code/`.

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

### Ledger — Claude Code (`FRONTMATTER_LEDGER_CC`)

Written to `personas/ledger/claude-code/`.

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
model: {{cc_model}}
memory: {{cc_memory}}
mcpServers:
  - {{mcp_server_name}}
---
```

### Standalone — VS Code (`FRONTMATTER_STANDALONE_VSCODE`)

Written to `personas/standalone/vs-code/`. No `role`. Uses the persona `name` field directly (set in YAML). Output filename is determined by `vs_file_name`.

```yaml
---
id: {{id}}
name: '{{name}}'
description: '{{description}}'
author: {{author}}
version: {{version}}
last_updated: {{last_updated}}
vs_file_name: {{vs_file_name}}
tools: [{{tools_list}}]
---
```

### Standalone — Claude Code (`FRONTMATTER_STANDALONE_CC`)

Written to `personas/standalone/claude-code/`. No `role`; optional `mcpServers` via `{{#if mcp_server_name}}`. `cc_name` is the plain kebab slug (no numeric prefix).

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

When a per-persona YAML sets `mcp_server_name`, the `{{#if mcp_server_name}}` block resolves to include the `mcpServers` entry. Personas without `mcp_server_name` produce no `mcpServers` block — the conditional is stripped and blank lines are normalized by the library's post-processing step.

Every generated file is prefixed with `<!-- AUTO-GENERATED — do not edit. Source: personas/<suite>/src/ -->` immediately after the frontmatter. The source path reflects the actual suite (e.g. `personas/ledger/src/` for ledger builds).

### Deep-Agents — All Suites (`FRONTMATTER_DA`)

Written to `personas/ledger/deep-agents/` and `personas/standalone/deep-agents/`. Applies to both suites unchanged — the ledger plugin does not override this template.

```yaml
---
name: {{id}}
description: '{{cc_description}}'
---
```

> **`name` uses `{{id}}` (not `{{name}}`):** The `id` field is a machine-readable identifier suitable for headless LangGraph / Deep Agents pipeline consumers. For ledger personas, this produces values like `ledger-3-dev`; for standalone personas, values like `standalone-researcher`. This differs from the VS Code and Claude Code frontmatter templates, which use a human-readable `{{number}} - {{role}} v{{version}}` display name. The library's built-in `DEFAULT_FRONTMATTER_DEEP_AGENTS` uses `{{name}}` — this config-level override replaces it with `{{id}}` intentionally.
>
> **`description` uses `{{cc_description}}` (dual-context):** For ledger personas, `cc_description` is computed from the roster entry matching the persona's `number` — combining `title` + `short` (e.g. `"Staff Software Engineer — Implementation & Verification"`). For standalone personas, it falls back to the YAML `description` field. See the Computed Variables table above.

## Standalone Suite Metadata Schema

The standalone suite (`personas/standalone/src/`) uses a slug-based schema for special-purpose personas that do not fit the 9-stage workflow.

### Standalone `_shared.yaml`

| Field | Type | Description |
|-------|------|-------------|
| `author` | `string` | Author name |
| `last_updated` | `string` | ISO-style date string |
| `default_version` | `string` | **Required.** Default version string (e.g. `"1.0.0"`) unless overridden per-persona. Absence causes `[ERROR]` + `process.exit(1)` in the library build. |
| `cc_permission_mode` | `string` | Claude Code permission mode (e.g. `"acceptEdits"`) |
| `cc_model` | `string` | Claude Code model override |
| `cc_memory` | `string` | Claude Code memory scope |
| `default_cc_tools` | `string[]` | Default tool list for Claude Code frontmatter |

> **Note:** `mcp_server_name` is intentionally absent from standalone `_shared.yaml` — standalone personas have no shared MCP dependency. However, individual personas **can** set `mcp_server_name` in their own YAML file to opt into MCP support (e.g. `workflow-orchestrator.yaml` sets `mcp_server_name: central_pm`). When present, this triggers the `{{#if mcp_server_name}}` conditional in `FRONTMATTER_STANDALONE_CC` and includes an `mcpServers` block in the Claude Code output. `roster` is also absent — standalone personas are not part of the 7-stage workflow.

### Standalone Per-Persona YAML (`<slug>.yaml`)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `slug` | `string` | yes | Kebab-case identifier (e.g. `"researcher"`, `"manifest-curator"`) |
| `id` | `string` | yes | Stable VS Code routing identifier for `@id` subagent routing. Pattern: `standalone-{vs_file_name stem}` (e.g. `standalone-researcher` for `researcher.agent.md`). Must be lowercase, no spaces, and stable across version bumps. |
| `name` | `string` | yes | Human-readable display name including version (e.g. `"Researcher v1.0.1"`) |
| `description` | `string` | yes | Short description of the persona's purpose |
| `vs_file_name` | `string` | yes | Output filename for VS Code sync (e.g. `"researcher.agent.md"`) |
| `cc_file_name` | `string` | yes | Output filename for Claude Code sync (e.g. `"researcher.md"`). **Required.** Absence causes `[ERROR]` + `process.exit(1)` in the library build. |
| `version` | `string` | yes | Per-persona version string |
| `last_updated` | `string` | no | Per-persona last-updated date |
| `tools` | `string[]` | yes | Tool permission slugs for the AI IDE |
| `cc_tools` | `string[]` | no | Tool names for Claude Code — overrides `default_cc_tools` from `_shared.yaml` (e.g. `module-intent-architect` omits `TodoRead`/`TodoWrite`) |
| `mcp_server_name` | `string` | no | MCP server name for Claude Code frontmatter (e.g. `"central_pm"`). When set, triggers the `{{#if mcp_server_name}}` conditional in `FRONTMATTER_STANDALONE_CC` and adds an `mcpServers` block to the CC output. Absent from `_shared.yaml` — must be set per-persona when MCP support is needed. |

> **Note:** `role` is intentionally absent — standalone personas are not part of the MCP-backed 9-stage workflow and have no role-based routing. The `vs_file_name` field uses `.agent.md` extension (e.g. `researcher.agent.md`) — this convention was established by WP-004.

### Feature Flags by Agent

| Agent | `has_mcp` | `has_detect_project` | `self_documenting_note` | `has_incident_logging` |
|-------|-----------|----------------------|-------------------------|------------------------|
| 1 — Planner | — | — | — | — |
| 2 — Project Manager | ✓ | — | — | — |
| 3 — Developer | ✓ | ✓ | ✓ | ✓ |
| 4 — QA | ✓ | ✓ | ✓ | ✓ |
| 5 — Security Auditor | ✓ | ✓ | ✓ | ✓ |
| 6 — Reviewer | ✓ | ✓ | ✓ | ✓ |
| 7 — Release Engineer | ✓ | ✓ | ✓ | ✓ |
| 8 — Documentation | ✓ | ✓ | ✓ | ✓ |
| 9 — Synthesis | ✓ | ✓ | ✓ | — |

---

## MCP Tool Allocation Matrix

This table is the **normative reference** for which MCP tools belong in each persona's `mcp_tools` YAML. When editing persona YAML files, consult this matrix to verify that tool additions or removals are intentional. The `note_only` column indicates tools present in the YAML but excluded from the rendered table (see [constraint 7](constraints-build-system.md#c34)).

### Legend

| Symbol | Meaning |
|--------|-------|
| **✓** | Tool is listed in the persona's `mcp_tools` table |
| *(note)* | Tool is in YAML with `note_only: true` — available but not rendered in the table |
| — | Tool is not assigned to this persona |

### Allocation Table

| MCP Tool | 1-Plan | 2-PM | 3-Dev | 4-QA | 5-SecAudit | 6-Rev | 7-RelEng | 8-Doc | 9-Syn |
|---|---|---|---|---|---|---|---|---|---|
| `ledger_initialize_project` | — | **✓** | — | — | — | — | — | — | — |
| `ledger_create_work_package` | — | **✓** | — | — | — | — | — | — | — |
| `ledger_get_next_action` | — | — | **✓** | **✓** | **✓** | **✓** | **✓** | **✓** | **✓** |
| `ledger_begin_work` | — | — | **✓** | **✓** | **✓** | **✓** | **✓** | **✓** | — |
| `ledger_get_work_package` | — | — | **✓** | **✓** | **✓** | **✓** | **✓** | **✓** | **✓** |
| `ledger_complete_pipeline` | — | — | **✓** | **✓** | **✓** | **✓** | **✓** | **✓** | — |
| `ledger_cancel_pipeline` | — | — | **✓** | **✓** | **✓** | **✓** | **✓** | **✓** | — |
| `ledger_add_project_comment` | — | — | **✓** | **✓** | **✓** | **✓** | **✓** | **✓** | **✓** |
| `ledger_add_observation` | — | — | **✓** | — | — | — | — | — | — |
| `ledger_get_project_status` | — | **✓** | — | — | — | — | — | — | **✓** |
| `ledger_list_work_packages` | — | — | — | — | — | — | — | **✓** | **✓** |
| `ledger_update_work_package_status` | — | — | — | — | — | — | — | **✓** | — |
| `ledger_get_handoff_status` | — | **✓** | — | — | — | — | — | — | **✓** |
| `ledger_complete_synthesis` | — | — | — | — | — | — | — | — | **✓** |
| `ledger_help` | — | — | *(note)* | *(note)* | *(note)* | *(note)* | *(note)* | *(note)* | *(note)* |

### Rationale

**1 — Planner:** Has no MCP tools. The Planner produces a plan document before any ledger exists. It operates entirely on the filesystem and has no ledger to interact with.

**2 — Project Manager:** Initializes the ledger (`ledger_initialize_project`) and creates all work packages (`ledger_create_work_package`). Uses `ledger_get_project_status` to verify the ledger after creation. Uses `ledger_get_handoff_status` to compute the handoff block — required because PM does not use `ledger_get_next_action` (it has no pipeline loop) and therefore cannot rely on the embedded `handoff_status` in WAIT responses.

**3 — Developer:** Full pipeline agent. Uses `ledger_get_next_action` → `ledger_begin_work` → `ledger_complete_pipeline` as the core loop. Has `ledger_add_observation` (unique to Developer) for the Code Insight Observer role — recording observations after a pipeline is already completed. Has `ledger_cancel_pipeline` for stale pipeline recovery.

**4 — QA:** Pipeline agent with the same core loop as Developer (get next action → begin work → complete pipeline). Does not need `ledger_add_observation` because QA records all findings as pipeline comments in `ledger_complete_pipeline`. Does not need `ledger_get_project_status` — reachability is confirmed by the `ledger_get_next_action` call in the preflight detect step.

**5 — Security Auditor:** Same tool set as QA and for the same reasons. The Security Auditor's distinct behavior (OWASP-based vulnerability analysis, severity classification, findings recorded via `ledger_add_project_comment` and `ledger_complete_pipeline`) is expressed through how the tools are used, not which tools are available.

**6 — Reviewer:** Same tool set as Security Auditor. The Reviewer's distinct behavior (review dimensions, PASS/FAIL logic, cross-cutting architectural insights via `ledger_add_project_comment`) is expressed through how the tools are used, not which tools are available.

**7 — Release Engineer:** Same tool set as Security Auditor and Reviewer. Manages changelog entries, version bumps, and deployment readiness checks. Results recorded via `ledger_complete_pipeline`.

**8 — Documentation:** Pipeline agent with `ledger_list_work_packages` (unique among pipeline agents) to scan across WPs for documentation gaps, and `ledger_update_work_package_status` to finalize WPs when auto-finalize did not fire during `ledger_complete_pipeline`. Does not have `ledger_get_handoff_status` — the handoff status is embedded in the WAIT response from `ledger_get_next_action` (the handoff partial provides a fallback path if absent).

**9 — Synthesis:** Read-heavy agent. Uses `ledger_get_project_status` and `ledger_list_work_packages` to iterate all WPs, `ledger_get_work_package` for deep reads, and `ledger_complete_synthesis` (unique to Synthesis) to archive the report and transition the project to COMPLETE. Uses `ledger_get_handoff_status` explicitly because its handoff step is a custom block that directly calls this tool rather than relying on the WAIT-embedded status. Does not have `ledger_begin_work` or `ledger_complete_pipeline` — Synthesis does not run standard pipelines.

---

## Sync Script (`scripts/sync-personas.js`)

### Functions

| Function | Signature | Description |
|----------|-----------|-------------|
| `getVSCodePromptsDir` | `() → string` | Returns platform-specific VS Code User prompts directory (win32/darwin/linux) |
| `getClaudeCodeAgentsDir` | `() → string` | Returns `~/.claude/agents/` (cross-platform via `os.homedir()`) |
| `getClaudeCodeSkillsDir` | `() → string` | Returns `~/.claude/skills/` (cross-platform via `os.homedir()`) |
| `extractVSFileName` | `(filePath: string) → string \| null` | Delegates to `parseFrontmatter()`; returns `vs_file_name` field or null |
| `extractCCFileName` | `(filePath: string) → string \| null` | Delegates to `parseFrontmatter()`; returns `name` field (trimmed) + `.md`, or null |
| `parseFrontmatter` | `(filePath: string) → Object \| null` | Reads all top-level YAML frontmatter fields into a plain object |
| `validateVSCodeFrontmatter` | `(dir: string) → void` | Validates `role`, `name`, `vs_file_name`, and `id` fields in ledger VS Code persona frontmatter; warns (non-blocking) when `id:` is missing |
| `validateStandaloneVSCodeFrontmatter` | `(dir: string) → void` | Validates standalone VS Code persona frontmatter: requires `name`, `vs_file_name`, and `id`; no `role` required; warns on failures (including missing `id:`) but does not block sync |
| `validateCCFrontmatter` | `(dir: string) → void` | Validates `name` (kebab-case with numeric prefix), `role`, `permissionMode`, `model`, `memory` in CC persona frontmatter |
| `syncFromDir` | `(sourceDir, targetDir, extractFileNameFn, label, dryRun?) → void` | Generic copy helper: reads all `.md` files from sourceDir, extracts deployment name via `extractFileNameFn`, copies to targetDir |
| `syncVSCode` | `(dryRun?: boolean, customPath?: string \| null) → void` | Syncs `personas/ledger/vs-code/` → VS Code prompts dir; calls `validateVSCodeFrontmatter` |
| `syncStandaloneVSCode` | `(dryRun?: boolean, customPath?: string \| null) → void` | Syncs `personas/standalone/vs-code/` → VS Code prompts dir; calls `validateStandaloneVSCodeFrontmatter`; reuses `syncFromDir` with `extractVSFileName` |
| `syncClaudeCode` | `(dryRun?: boolean) → void` | Syncs `personas/ledger/claude-code/` → `~/.claude/agents/`; calls `validateCCFrontmatter` |
| `validateStandaloneCCFrontmatter` | `(dir: string) → void` | Validates standalone CC persona frontmatter: requires `name` (plain kebab-case, no numeric prefix), `permissionMode`, `model`, `memory`; warns on failures but does not block sync |
| `syncStandaloneClaudeCode` | `(dryRun?: boolean) → void` | Syncs `personas/standalone/claude-code/` → `~/.claude/agents/`; calls `validateStandaloneCCFrontmatter`; reuses `syncFromDir` with `extractCCFileName` |

### `KNOWN_ROLES` Constant

```javascript
const KNOWN_ROLES = require('../shared/workflow-manifest.json').roles.map(r => r.name);
```

Derived at runtime from the shared workflow manifest. Always in sync with `AGENT_ROLES` in `mcp-server/src/utils/constants.ts` (both are manifest-derived).

---

## Partials Inventory

Partials are organised into two layers. **Shared partials** (`personas/shared/partials/`) are suite-agnostic and available to all suites. **Ledger-specific partials** (`personas/ledger/src/partials/`) are MCP-workflow-only and override same-named shared entries.

### Shared Partials (`personas/shared/partials/`)

| Partial | Used By | Embeds Variables / Notes |
|---------|---------|-------------------------|
| `agent-roster.md` | All 9 agents | `{{roster_rendered}}` |
| `planner-output-template.md` | Agent 1 | *(none)* |
| `planner-core-rules.md` | Agent 1 | *(none)* |
| `pm-output-format.md` | Agent 2 | *(none)* |
| `developer-operational-protocol.md` | Agent 3 | *(none)* |
| `developer-strict-constraints.md` | Agent 3 | Embeds `{{> incident-logging}}` — resolves via ledger override layer; requires a stub in `shared/` for non-ledger suites |
| `developer-output-format.md` | Agent 3 | *(none)* |
| `qa-operational-protocol.md` | Agent 4 | *(none)* |
| `qa-output-format.md` | Agent 4 | *(none)* |
| `security-auditor-operational-protocol.md` | Agent 5 | *(none)* |
| `security-auditor-output-format.md` | Agent 5 | *(none)* |
| `reviewer-operational-protocol.md` | Agent 6 | *(none)* |
| `reviewer-output-format.md` | Agent 6 | *(none)* |
| `release-engineer-operational-protocol.md` | Agent 7 | *(none)* |
| `release-engineer-output-format.md` | Agent 7 | *(none)* |
| `docs-operational-protocol.md` | Agent 8 | Embeds `{{> incident-logging}}` — same ledger coupling as `developer-strict-constraints.md` |
| `docs-output-format.md` | Agent 8 | *(none)* |
| `synthesis-operational-protocol.md` | Agent 9 | *(none)* |
| `synthesis-output-format.md` | Agent 9 | *(none)* |

### Ledger-Specific Partials (`personas/ledger/src/partials/`)

| Partial | Used By | Embeds Variables |
|---------|---------|------------------|
| `mcp-intro.md` | Agents 2–9 | `{{mcp_server_name}}`, `{{mcp_tools_table}}` |
| `role-boundaries.md` | Agents 2–9 | *(none)* |
| `mcp-tools-note.md` | Agents 3–9 | *(none)* |
| `mcp-preflight-header-vscode.md` | Agents 2–9 (VS Code target) | `{{mcp_server_name}}` |
| `mcp-preflight-header-claude-code.md` | Agents 2–9 (Claude Code target) | `{{mcp_server_name}}` |
| `mcp-preflight-detect.md` | Agents 3–9 | *(none)* |
| `mcp-preflight-verify-no-detect.md` | Agent 2 only | *(none)* |
| `mcp-unavailable.md` | Agents 2–9 | `{{mcp_server_name}}` |
| `handoff-block-vscode.md` | Agents 2–8 (VS Code target) | `{{role}}` |
| `handoff-block-claude-code.md` | Agents 2–8 (Claude Code target) | `{{role}}` |
| `incident-logging.md` | Agents 3–8 (via shared partials or directly) | *(none)* |

```
###  Path: `/personas/docs/agents/project-manifest/constraints-build-system.md`

```md
# Constraints — Build System & Sync

> **Scope:** Template engine behavior, build script flags, log conventions, and sync script rules. Consult this document when modifying `scripts/build-personas.js`, `personas/persona-build.config.js`, or `scripts/sync-personas.js`.
>
> See also: [Core Constraints](constraints.md) · [Cross-System Constraints](constraints-cross-system.md)

---

## Template Engine Limitations

<a name="c5"></a>
<a name="b1"></a>
1. **`{{else}}` blocks are supported.** Conditionals may include an optional `{{else}}` branch: `{{#if flag}}…{{else}}…{{/if}}`. When the flag is truthy, the content before `{{else}}` is kept; when falsy, the content after `{{else}}` is kept. Prefer `{{else}}` over computed inverse booleans.

<a name="c6"></a>
<a name="b2"></a>
2. **Nested `{{#if}}` blocks are not supported.** The template engine uses a single-pass regex that stops at the first `{{/if}}` encountered. Nesting `{{#if}}` inside another `{{#if}}` will silently produce incorrect output. Flatten nested conditions to separate top-level `{{#if}}` blocks or extract to partials.

   **Anti-pattern:**
   ```
   {{#if platform_vscode}}
     {{#if feature_enabled}}
       Content for VS Code only when feature is on
     {{/if}}
   {{/if}}
   ```
   The inner `{{/if}}` terminates the outer block prematurely, leaving stray `{{/if}}` and `{{#if feature_enabled}}` markers in the output.

   **Correct pattern:**
   ```
   {{#if platform_vscode_and_feature}}
     Content for VS Code only when feature is on
   {{/if}}
   ```
   Pre-compute the compound boolean as a variable in the build script (or add it to `_shared.yaml`), then use a single top-level `{{#if}}` block.

<a name="c7"></a>
<a name="b3"></a>
3. **No `{{#each}}` loops.** Iteration must be handled by computed variables. The build script pre-renders `roster_rendered` and `mcp_tools_table` as fully-formed Markdown strings.

<a name="c8"></a>
<a name="b4"></a>
4. **Max partial depth: 2.** Partials can embed other partials, but only to depth 2. Deeper nesting is silently ignored (markers left in output).

<a name="c9"></a>
<a name="b5"></a>
5. **Unresolved markers are preserved.** Unknown `{{variable}}` or `{{> partial}}` markers are left in the output as-is and a `[WARN]` is emitted. This makes typos visible without causing a hard build failure.

<a name="c10"></a>
<a name="b6"></a>
6. **`--strict` mode converts unresolved markers into a hard failure.** When `--strict` is passed, a post-build scan runs on every generated file using the regex `/\{\{>?\s*[\w-]+\}\}/g`. If any markers remain, the script emits `[STRICT] Unresolved marker(s) in <suite>/<target>/<file>: <markers>` to stderr, increments a `strictFailures` counter, and exits with code 1 after the full build completes. The base build output (written files) is unaffected; `--strict` only controls the exit code. Use `node scripts/build-personas.js --strict --suite all` in CI pipelines or pre-commit hooks to gate on zero unresolved markers.

   > **GN-4 — Code-fence false-positive risk:** The `--strict` regex scans the full assembled text and would produce false positives if a template body contained literal `{{…}}` inside a Markdown fenced-code block. **Mitigation active (WP-002):** The build script strips fenced blocks (`/```[\s\S]*?```/g`) from a copy of the output before scanning, eliminating this false-positive risk.

   > **GN-5 — `--check` + `--strict` exit ordering:** When `--check` detects stale output files, `process.exit(1)` fires before `[STRICT]` scan output is emitted. The exit code remains 1 (correct). This is intentional. In CI, run `--check` as a separate pre-build step if `[STRICT]` failure details are needed.

---

## Log-Prefix Convention

The build script (`scripts/build-personas.js`) uses four bracket-prefixed severity levels for all console output. Use these prefixes consistently for any `console.log` / `console.error` calls added to the build script in the future.

| Prefix | Meaning | Example usage |
|--------|---------|---------------|
| `[info]` | Informational — runtime context, no action needed | Suite default announcement at startup |
| `[WARN]` | Warning — recoverable issue, output may still be valid | Unresolved template markers (non-strict mode) |
| `[STRICT]` | Strict-mode failure — gates CI exit code | Unresolved markers when `--strict` is active |
| `[ERROR]` | Fatal — build cannot continue | Missing content file, invalid YAML |

---

## Build Validation Constraints

<a name="c34"></a>
<a name="b7"></a>
7. **`note_only: true` on `mcp_tools` entries excludes them from the rendered tools table.** When an `mcp_tools` entry in a per-persona YAML file has `note_only: true`, the `renderMcpToolsTable()` function filters it out (using `.filter(t => !t.note_only)`) before building the Markdown table. The entry is still present in the YAML source and the tool remains functionally accessible to the agent, but it is not listed as a table row in generated output. Use this flag for tools that agents should be aware of via prose content (e.g., in a `mcp-tools-note.md` partial) but that are not primary workflow tools for that role. Entries without `note_only` are unaffected — `undefined` is falsy and passes the filter without change.

<a name="c35"></a>
<a name="b8"></a>
8. **`--check` mode asserts that `note_only: true` tools are absent from generated output.** Running `node scripts/build-personas.js --check` performs two validations per file: (1) the generated content matches the file on disk (staleness check), and (2) no tool entry marked `note_only: true` in the persona's `mcp_tools` YAML appears as a rendered table row in the generated output. The guard in `build-personas.js` uses a **regex** (`/\|\s*\`toolName\`\s*\|/`) rather than `string.includes()` — this tolerates Markdown table column-spacing variations (e.g., `|  \`toolName\`  |`). Violations increment `staleCount` and are printed to stderr with prefix `[note_only-violation]`. If any violation is found the process exits with code 1.

   > **Why regex over string.includes:** `string.includes('| \`toolName\` |')` is tightly coupled to exact column spacing. A Markdown table reformatter or editor that normalises padding (e.g., `|  \`toolName\`  |`) would silently bypass the check. The regex `\|\s*\`…\`\s*\|` matches any amount of whitespace on either side of the backtick-quoted name, making the guard robust to formatting drift.

<a name="c36"></a>
<a name="b9"></a>
9. **`{{agent_slug_*}}` references in ledger persona content must match the persona's declared `subagents` list.** Every `{{agent_slug_X_Y}}` reference in `personas/ledger/src/content/*.md` is cross-checked against that persona's `subagents` field in its YAML (`personas/ledger/src/meta/*.yaml`). The suffix `X_Y` is converted to kebab-case (`X-Y`) and must appear as an entry in the `subagents` list. The check runs **unconditionally** — on both real builds and `--check` runs. If any reference has no matching `subagents` entry, a `[ERROR]` block is emitted identifying the persona, the template variable, and the expected slug, and `process.exit(1)` is called.

   **Error message format:**
   ```
   [ERROR] agent_slug cross-reference check failed:

     Persona "2-project-manager": {{agent_slug_foo_bar}} references slug "foo-bar"
     which is not declared in the subagents list.
     Add "foo-bar" to the subagents field in 2-project-manager.yaml.
   ```

   **To resolve:** Add the slug to the `subagents` field in the relevant `personas/ledger/src/meta/N-name.yaml` file and rebuild standalone personas (`node scripts/build-personas.js`) so the matching `personas/standalone/src/meta/{slug}.yaml` and `personas/standalone/deep-agents/{slug}.md` files exist.

   **Regex scope:** The pattern `/\{\{agent_slug_([a-z0-9_]+)\}\}/g` only matches all-lowercase suffixes. Mixed-case or hyphenated `{{agent_slug_*}}` references are not detected — this is intentional and enforces the lowercase-only convention.

   **Shared-partial note:** The scan covers only `personas/ledger/src/content/*.md`. References in `personas/ledger/src/partials/` or `personas/shared/partials/` are not validated by this check.

---

## Sync Script Conventions

<a name="c30"></a>
<a name="b9"></a>
9. **`vs_file_name` is required for VS Code sync; `name` is required for Claude Code sync.** During VS Code sync, files without a `vs_file_name` field in frontmatter are silently skipped. During Claude Code sync, files without a `name` field are skipped. This excludes `README.md` and any non-persona files.

<a name="c31"></a>
<a name="b10"></a>
10. **Sync reads from explicit source directories.** `syncVSCode()` reads from `ledger/vs-code/`; `syncStandaloneVSCode()` reads from `standalone/vs-code/`; `syncClaudeCode()` reads from `ledger/claude-code/`; `syncStandaloneClaudeCode()` reads from `standalone/claude-code/`. All four copy to their respective target directories without recursively walking the whole `personas/` tree. When `--target vscode` (or `--target all`) is used, both `syncVSCode()` and `syncStandaloneVSCode()` are called. When `--target claude-code` (or `--target all`) is used, both `syncClaudeCode()` and `syncStandaloneClaudeCode()` are called.

<a name="c32"></a>
<a name="b11"></a>
11. **Frontmatter validation is advisory.** `validateVSCodeFrontmatter()` checks `role`, `name`, `vs_file_name`, `id`, and `model` in ledger VS Code personas. `validateStandaloneVSCodeFrontmatter()` checks `name` and `vs_file_name` in standalone VS Code personas (no `role` required). `validateCCFrontmatter()` checks `name` (must match `\d-kebab-case` pattern with numeric prefix), `role`, `permissionMode`, `model`, and `memory` in ledger Claude Code personas. `validateStandaloneCCFrontmatter()` checks `name` (plain kebab-case — **no** numeric prefix, e.g. `agents-md-curator`), `permissionMode`, `model`, and `memory` in standalone Claude Code personas. None of these functions block the sync — warnings are printed to console.

<a name="c33"></a>
<a name="b12"></a>
12. **Build is automatic during sync.** `scripts/sync-personas.js` spawns `scripts/build-personas.js` as a child process before copying files, and forwards the `--target` flag so the build step generates only the required output. There is no need to run build separately when syncing.

```
###  Path: `/personas/docs/agents/project-manifest/constraints-cross-system.md`

```md
# Constraints — Cross-System Dependencies

> **Scope:** Synchronization contracts between the personas build system and the MCP server, Agent Registry, and workflow manifest. Consult this document when working on integration points between sub-projects.
>
> See also: [Core Constraints](constraints.md) · [Build System Constraints](constraints-build-system.md)

---

## Runtime Synchronization

<a name="c36"></a>
<a name="x1"></a>
1. **`KNOWN_ROLES` and `AGENT_ROLES` are both manifest-derived.** Both `scripts/sync-personas.js` → `KNOWN_ROLES` and `mcp-server/src/utils/constants.ts` → `AGENT_ROLES` now derive their values at runtime from `shared/workflow-manifest.json`. There is no longer a manual sync contract between these two — they always agree by construction. Adding or renaming a role in the manifest propagates automatically. Persona YAML `role` fields still need to match manifest role names; `scripts/build-personas.js` validates this and emits advisory warnings on mismatch.

<a name="c37"></a>
<a name="x2"></a>
2. **`role` field ↔ Agent Registry**: The `role` value in persona frontmatter is used by the MCP server's Agent Registry (`mcp-server/src/utils/agent-registry.ts`) to discover agent handles for automatic handoffs. The registry scans `*.agent.md` files in the VS Code prompts directory and matches the `role` field.

<a name="c38"></a>
<a name="x3"></a>
3. **`name-mapping.json` is generated from persona YAML metadata.** `scripts/build-personas.js` reads all 9 ledger persona YAML files in `personas/ledger/src/meta/` (plus `_shared.yaml` for `default_version`) and writes `personas/name-mapping.json` after every real build (skipped in `--check`/`--dry-run` mode). The file contains per-persona identity (`role`, `number`, `id`, `version`) and per-target agent name data (`vscode`, `claude_code`, `deep_agents` — each with `file_name` and `agent_name`). It must be regenerated whenever persona YAML naming fields change (`role`, `number`, `id`, `version`, `cc_file_name`, `vs_file_name`, `da_file_name`, or `default_version` in `_shared.yaml`). The file is checked into Git — stale state is visible in Git diffs. Run `node scripts/build-personas.js` (without `--check`) to regenerate.

<a name="c39"></a>
<a name="x4"></a>
4. **`subagents` field in ledger persona YAML is consumed by the orchestrator's `load_subagents()`.** The optional `subagents` field (type: `string[]`, flat dash-prefixed block list) in a ledger persona YAML (`personas/ledger/src/meta/N-name.yaml`) declares the kebab-case slugs of standalone personas this stage may delegate sub-tasks to. For each slug, `load_subagents()` in `orchestrator/src/utils/subagents.py` resolves:
   - **`description`** — from `personas/standalone/src/meta/{slug}.yaml`
   - **`system_prompt`** — from `personas/standalone/deep-agents/{slug}.md`
   - **`name`** — the kebab-case slug itself

   The template engine silently ignores unknown YAML keys, so the `subagents` field has no effect on persona build output. It is not used by `scripts/build-personas.js` for rendering — only for the `{{agent_slug_*}}` cross-reference validation (see [Build System Constraint 9](constraints-build-system.md#b9)).

   **Sync contract:** Every slug declared in the `subagents` field must have a corresponding `personas/standalone/src/meta/{slug}.yaml` (with a `description` field) and a `personas/standalone/deep-agents/{slug}.md` that are valid at orchestrator startup. Missing files raise `FileNotFoundError`; a missing `description` raises `ValueError`. Currently only Agent 2 (Project Manager) carries this field, listing four PM planning sub-agents.

---

When the build system was introduced, the generated output differs from the original hand-authored files in these **intentional** ways:

<a name="c41"></a>
<a name="x3"></a>
3. **AUTO-GENERATED header** added to every generated file.

<a name="c42"></a>
<a name="x4"></a>
4. **Code fence indentation normalized.** Handoff block code fences are at column 0; originals had 3–4 space indent (numbered list continuation style).

<a name="c43"></a>
<a name="x5"></a>
5. **`mcp-tools-note` placement unified.** For Agent 3 (Developer), the self-documenting note was moved from the Workflow section to the MCP Tools section for consistency with agents 4–9.

<a name="c44"></a>
<a name="x6"></a>
6. **Detect-step wording standardized.** Slight rewording of the detect-project pre-flight step to be uniform across all agents that use it.

```
###  Path: `/personas/docs/agents/project-manifest/constraints.md`

```md
# Constraints & Conventions

> **Scope:** Core rules for editing persona source files, naming conventions, versioning, and safety guards. This is the primary constraints document — consult it before making any persona changes.
>
> See also: [Build System Constraints](constraints-build-system.md) · [Cross-System Constraints](constraints-cross-system.md)

---

## Source Editing Rules

<a name="c1"></a>
<a name="c45"></a>
1. **Never edit generated files directly.** All persona files in the following directories are auto-generated and must not be hand-edited:
   - `personas/ledger/vs-code/`, `personas/ledger/claude-code/`, and `personas/ledger/deep-agents/`
   - `personas/standalone/vs-code/`, `personas/standalone/claude-code/`, and `personas/standalone/deep-agents/`

   All changes must be made in the corresponding `src/` directory and rebuilt. Generated files carry an `<!-- AUTO-GENERATED — do not edit. Source: personas/<suite>/src/ -->` header as a guard. The generated output directories are fully overwritten on every build.

<a name="c2"></a>
2. **`README.md` is not generated.** The `personas/ledger/README.md` is hand-authored and serves as the user-facing workflow guide. It is excluded from the build process.

<a name="c2a"></a>
3. **Directory layout — generated vs. source.** Use the auto-generated tree in `.context/personas/file-structure.md` for structural navigation. The table below clarifies which directories are generated output vs. hand-authored source:

   | Directory | Generated? | Purpose |
   |-----------|-----------|----------|
   | `personas/ledger/vs-code/` | Yes | VS Code target output |
   | `personas/ledger/claude-code/` | Yes | Claude Code target output |
   | `personas/ledger/deep-agents/` | Yes | Deep-agents target output |
   | `personas/standalone/vs-code/` | Yes | VS Code target output (standalone) |
   | `personas/standalone/claude-code/` | Yes | Claude Code target output (standalone) |
   | `personas/standalone/deep-agents/` | Yes | Deep-agents target output (standalone) |
   | `personas/ledger/src/meta/` | No | YAML metadata: identity, feature flags, tool lists |
   | `personas/ledger/src/content/` | No | Per-persona body templates |
   | `personas/ledger/src/partials/` | No | Ledger-suite Markdown fragments (override layer; MCP-specific partials live here) |
   | `personas/standalone/src/meta/` | No | YAML metadata for standalone personas (slug-based, no `role`) |
   | `personas/standalone/src/content/` | No | Per-slug body templates |
   | `personas/shared/partials/` | No | Suite-agnostic shared Markdown fragments (base layer; no MCP content) |

<a name="c3"></a>
4. **Edit → Build → Sync workflow.** After modifying any source file in `src/`, run `node scripts/build-personas.js` (or add `--suite` to target a specific suite and `--target vscode` / `--target claude-code` / `--target deep-agents` for a single target) to regenerate output, then `node scripts/sync-personas.js` to deploy to both VS Code and Claude Code. Use `--suite all` to rebuild both suites in one pass.

---

## Persona Content Philosophy

<a name="c4"></a>
5. **Persona content must add value the self-documenting tools cannot provide.** The ledger's `next_steps` arrays, `--- NEXT STEP ---` guidance blocks, and Zod parameter descriptions are the runtime source of truth. A persona's job is to provide **identity, methodology, and decision-making framework** — not to duplicate tool documentation. When tool self-documentation already covers a behavior (e.g., wait-action reasons, required parameters), do not restate it in persona content. When persona content enumerates tool parameters or action names, it must match the implementation exactly or defer to the tool descriptions entirely.

<a name="c4a"></a>
5a. **Numbered workflow steps in persona content templates are immutable structural contracts.** When a new phase partial is added to a persona's content template, a corresponding numbered-step entry must be added in the same implementation change — never deferred to a follow-up. An agent following only the numbered steps will silently skip any phase that exists as a partial but has no matching step entry. Before closing a persona-modification PR, cross-check the count of numbered workflow steps against the count of phase partials included in that template to confirm parity. The Documentation pipeline is responsible for catching step/partial count mismatches during its review pass.

---

## Naming & File Conventions

<a name="c11"></a>
6. **Ledger persona output filenames differ by target.** VS Code target files use `N-name.agent.md` (e.g., `3-dev.agent.md`); Claude Code and deep-agents target files both use `N-name.md` (e.g., `3-developer.md`). The number prefix matches the agent's `number` field (1–9). The VS Code filename is declared in the YAML `vs_file_name` field; the Claude Code filename in `cc_file_name`; the deep-agents filename in `da_file_name`. The `da_file_name` field follows the same `N-<role-slug>.md` pattern as `cc_file_name` and is intentionally absent from standalone YAMLs — the deep-agents target falls back to the content file basename (e.g. `researcher.md`) for standalone personas.

<a name="c12"></a>
7. **Standalone YAML files are slug-based, not number-prefixed.** Standalone persona filenames match their `slug` field (e.g. `researcher.yaml`, `manifest-curator.yaml`). The `slug` must be a valid kebab-case identifier with no numeric prefix.

<a name="c13"></a>
8. **All VS Code output files use the `.agent.md` extension.** This applies to both ledger (e.g. `3-dev.agent.md`) and standalone (e.g. `researcher.agent.md`) suites. The output filename is YAML-declared via `vs_file_name` and written by the library — it is not derived from the content template basename. Claude Code output uses plain `.md` (e.g. `researcher.md`), declared via `cc_file_name`.

<a name="c14"></a>
9. **`cc_name` is derived from `cc_file_name`.** The computed `cc_name` variable is `persona.cc_file_name.replace(/\.md$/, '')`, producing identifiers like `3-developer` or `2-project-manager`. This naming is required for Claude Code slash commands, which do not allow spaces. The `cc_file_name` YAML field (e.g., `2-project-manager.md`) is the authoritative source — `cc_name` always equals that filename without the `.md` extension.

<a name="c15"></a>
10. **`cc_tools` in a per-persona YAML overrides `default_cc_tools` from `_shared.yaml`.** By default, all personas use the `default_cc_tools` array defined in `_shared.yaml`. To customise the tool list for a specific persona, add a `cc_tools` key to its YAML file — this takes precedence over the shared default. Personas omitting `cc_tools` automatically inherit `default_cc_tools`.

<a name="c16"></a>
11. **Content, meta, and partial files share the same basename.** For each persona: `src/meta/N-name.yaml`, `src/content/N-name.md`. If a content file is missing for a YAML file, the build exits with `[ERROR]`.

<a name="c17"></a>
12. **Partials use kebab-case filenames** without number prefixes (e.g., `mcp-preflight-detect.md`). The partial name in templates matches the filename without the `.md` extension.

<a name="c18"></a>
13. **Shared vs. suite-local partials.** The build system loads partials in two layers:
  - **Base layer** (`personas/shared/partials/`): suite-agnostic fragments reusable by all suites (ledger, standalone). Never include MCP-specific content here.
  - **Override layer** (`personas/<suite>/src/partials/`): suite-specific fragments. Same-named entries silently shadow their shared counterpart. All MCP-workflow partials (`mcp-*`, `role-boundaries`, `handoff-block-*`, `incident-logging`) live here.
  
  When building the standalone suite, a partial referenced by a shared partial but only defined in the ledger override layer (e.g., `{{> incident-logging}}`) will produce a `[WARN]` and be left as-is unless a stub is added to `shared/partials/`.

<a name="c19"></a>
14. **Standalone `_shared.yaml` must not contain `mcp_server_name` or `roster`.** Standalone personas are independent tools — they have no workflow roster and no MCP server dependency. Do not add these fields when extending the standalone suite.

<a name="c20"></a>
15. **Platform-specific partials use a `-vscode` / `-claude-code` suffix** (e.g., `handoff-block-vscode.md`, `handoff-block-claude-code.md`, `mcp-preflight-header-vscode.md`, `mcp-preflight-header-claude-code.md`). Content templates include them via a top-level `{{#if target_vscode}}…{{else}}…{{/if}}` conditional block — never inline platform-specific content directly in a content template.

   When a content section must produce **different inline text for all three targets**, use nested conditionals instead of named partials:
   ```
   {{#if target_vscode}}
   … VS Code–specific inline content …
   {{else}}
   {{#if target_deep_agents}}
   … Deep Agents–specific inline content …
   {{else}}
   … Claude Code–specific inline content …
   {{/if}}
   {{/if}}
   ```
   This pattern is used in `personas/ledger/src/content/2-project-manager.md` for sub-agent invocation steps 3–6.

<a name="c21"></a>
16. **`9-synthesis.md` omits the handoff-block partial by design.** The Synthesis agent always prints its handoff block verbatim (never auto-handoffs), so its content template does not include `{{> handoff-block-vscode}}` or `{{> handoff-block-claude-code}}`. This is intentional — do not add the partial to this template.

<a name="c22"></a>
17. **`.gitkeep` files exist in all source directories** to preserve empty directory structure in version control.

---

## Role & Version Conventions

<a name="c23"></a>
18. **`role` values must match manifest role names** in `shared/workflow-manifest.json`. The sync script's `KNOWN_ROLES` and the MCP server's `AGENT_ROLES` both derive from the manifest at runtime, so adding or renaming a role in the manifest automatically propagates to both consumers. `scripts/build-personas.js` cross-checks each ledger persona's `role` field against manifest role names and emits advisory warnings for mismatches.

<a name="c24"></a>
19. **`id` naming convention and stability rules:**
   - **Ledger personas**: `id` must follow `ledger-{vs_file_name stem}` — e.g. `vs_file_name: 3-dev.agent.md` → `id: ledger-3-dev`.
   - **Standalone personas**: `id` must follow `standalone-{vs_file_name stem}` — e.g. `vs_file_name: researcher.agent.md` → `id: standalone-researcher`.
   - **Format constraints**: lowercase only, no spaces, no special characters except hyphens.
   - **Stability**: `id` values must never change once published — they are the routing key used by VS Code `@id` subagent routing. Version bumps, renames, or persona reordering must not alter the `id`.
   - **Uniqueness**: `id` values must be globally unique across all custom agents in the user's VS Code instance. The `ledger-` and `standalone-` namespace prefixes isolate these personas from each other and from any third-party agents the user may have installed.
   - **Claude Code output is unaffected**: `id:` is only added to `FRONTMATTER_LEDGER_VSCODE` and `FRONTMATTER_STANDALONE_VSCODE`. The Claude Code frontmatter templates (`FRONTMATTER_LEDGER_CC`, `FRONTMATTER_STANDALONE_CC`) do not include `id:` — Claude Code uses name-derivation routing, not `@id` routing.

<a name="c25"></a>
20. **`default_version` in `_shared.yaml` applies to all personas** unless overridden per-persona via the `version` field. This follows the standard `default_X` + per-persona override pattern used throughout the build system.

<a name="c26"></a>
21. **`default_model` in `_shared.yaml` applies to all personas** unless overridden per-persona via the `model` field. This follows the same `default_X` + per-persona override pattern as `default_version` / `version`.

<a name="c26a"></a>
21a. **`default_model_slug` in `_shared.yaml` applies to all ledger personas** unless overridden per-persona via the `model_slug` field. This follows the identical `default_X` + per-persona override pattern as `default_model` / `model`. The slug is an API-compatible identifier used by the orchestrator to route calls to the correct model endpoint (e.g. `"claude-sonnet-4-6"`). It is **not** rendered into generated frontmatter templates — it is consumed directly from YAML source by the orchestrator.

<a name="c27"></a>
22. **`cc_model` resolution chain:** The Claude Code `model` frontmatter value is resolved in Layer 3 as: `persona.cc_model → persona.model → _shared.default_model → _shared.cc_model`. This means a per-persona `cc_model` takes highest priority, followed by the persona's VS Code `model` override, then the shared default model, and finally the shared `cc_model` value (typically `"inherit"`).

<a name="c28"></a>
23. **`default_version` is required in all `_shared.yaml` files.** Its absence is a **fatal build error** — the library emits `[ERROR] Missing 'default_version' in <suite>/_shared.yaml` and exits with code 1. Without this field, the generated output would contain the string `"undefined"` as the version, a silent corruption that is hard to detect post-build. This check applies to both suites (ledger, standalone).

<a name="c29"></a>
<a name="c38"></a>
<a name="c48"></a>
24. **`mcp_server_name` in `_shared.yaml` controls the MCP server reference** everywhere in generated output and must match the server key used by `scripts/install-mcp-global.js` (default: `central_pm`). If the server name changes, update this field, rebuild personas, and update `install-mcp-global.js` — see the Cross-System Dependencies table in `AGENTS.md`.

   > **Shadowing risk for standalone personas:** Per-persona YAML fields shadow shared YAML values via the object spread in the build context. Standalone personas in `personas/standalone/src/meta/` hardcode `mcp_server_name: central_pm` in their individual YAML files rather than inheriting from a shared source (standalone has no shared `mcp_server_name` — see [constraint 14](#c19)). If `mcp_server_name` changes globally, update both `personas/ledger/src/meta/_shared.yaml` **and** every standalone persona YAML file that hardcodes the old value.

<a name="c49"></a>
25. **Every persona change requires a version bump, date update, and changelog entry.** When any persona source file is modified (YAML metadata in `src/meta/`, content template in `src/content/`, or a partial in `src/partials/` that affects generated output), the agent performing the change **must** complete all three steps before finishing:
   1. **Bump `version`** in the persona's YAML metadata file. Use the per-persona `version` field (or update `default_version` in `_shared.yaml` if the change applies to the entire suite). Follow SemVer: patch for wording/formatting fixes, minor for behavioral or structural changes, major for breaking changes.
   2. **Update `last_updated`** in the same YAML file to the current date (`YYYY-MM-DD` format).
   3. **Add an entry to `personas/changelog.md`** under a new or existing version heading, following the established house style (flat bullet list with category prefix, ≤ 100-char lines).

   If a single change affects multiple personas (e.g., editing a shared partial), bump and date-stamp each affected persona individually and document all of them in one changelog entry. Omitting any of these three steps is a defect — downstream agents and the pre-commit freshness guard depend on accurate version metadata.

---

## Pre-Commit Guard

<a name="c46"></a>
26. **Run `node scripts/install-hooks.js` after cloning.** This sets `git config core.hooksPath .githooks` for the repo, activating the `.githooks/pre-commit` hook. The hook runs `node scripts/build-personas.js --check` before every commit. Without this step, stale generated output can be committed silently.

<a name="c47"></a>
27. **`.githooks/pre-commit` enforces persona freshness at commit time.** The hook exits non-zero if any generated persona file is stale, blocking the commit. This closes the gap where a developer editing only `personas/src/` would never trigger the freshness check via `mcp-server/` tests.

---

## Cross-Platform Constraints

<a name="c50"></a>
28. **Build scripts must run on Windows, macOS, and Linux.** The personas build system runs on Node.js (inherently cross-platform), but scripts must not assume Unix-only utilities or path separators. Use `path.join()` / `path.resolve()` — never hardcode `/` or `\`. See root `AGENTS.md` → Cross-Platform Policy for the full workspace-wide policy.

---

## Plugin Module Convention

<a name="c51"></a>
29. **`personas/plugins/` uses CommonJS.** All modules under `personas/plugins/` use `module.exports` / `require()` syntax. This is required because the build config loader (`personas/persona-build.config.js`) is itself CommonJS and loads plugins via `require()`. Do not convert these modules to ESM.

<a name="c52"></a>
30. **Test files use the `createRequire` bridge for CJS imports.** Test suites in `scripts/tests/` run under Vitest (ESM). To import CJS plugins, they use `createRequire(import.meta.url)` to create a Node.js `require()` function scoped to the test file's directory. See `scripts/tests/README.md` for the full pattern and rationale.

<a name="c53"></a>
31. **New plugins must follow the CJS convention.** Any future plugin added to `personas/plugins/` should use CommonJS (`module.exports`) and be imported via `require()` in the build config. Corresponding tests should use the `createRequire` bridge pattern.

```
###  Path: `/personas/docs/agents/project-manifest/data-flows.md`

```md
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

Post-build (real builds only, not `--check`/`--dry-run`): the wrapper performs two steps: (1) reads `personas/changelog.md`, extracts the latest version, and updates `personas/package.json` if it differs; (2) reads all 9 ledger persona YAML files and `_shared.yaml`, computes per-target agent names, and writes `personas/name-mapping.json` (9 entries sorted by `number`; each entry: `role`, `number`, `id`, `version`, plus `vscode`, `claude_code`, `deep_agents` blocks with `file_name` and `agent_name`).

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

```
###  Path: `/personas/docs/agents/project-manifest/file-tree.md`

```md
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

```
###  Path: `/personas/docs/agents/project-manifest/tech-stack.md`

```md
# Tech Stack & Patterns

## Runtime & Language

| Component | Version | Notes |
|-----------|---------|-------|
| **Runtime** | Node.js ≥ 18 | CommonJS (`require`) — no transpilation step |
| **Language** | JavaScript (ES2020+) | `'use strict'` mode; no TypeScript |
| **Package Manager** | npm | Standard Node.js tooling |

---

## Dependencies

### Production

| Package | Version | Purpose |
|---------|---------|---------|
| `js-yaml` | ^4.1.0 | Parse YAML metadata files (`_shared.yaml`, per-persona YAMLs) |

### Workspace-level Dependencies

| Package | Version | Scope | Purpose |
|---------|---------|-------|---------|
| `@mistralys/persona-builder` | ^2.1.0 | workspace-root `devDependencies` | Library that owns all persona build logic — template engine, partial resolution, conditional processing, and variable interpolation. Invoked by `build-personas.js` via its CLI binary. |
| `vitest` | ^4.0.18 | workspace-root `devDependencies` | Test runner — no longer used for persona-build tests post-migration; retained for other workspace test suites |

The thin wrapper `build-personas.js` delegates all build logic to `@mistralys/persona-builder` via its CLI binary (`dist/cli.js`). The wrapper itself only resolves paths and forwards CLI flags (`--check`, `--strict`) to the library.

---

## Build Tools

| Tool | Invocation | Purpose |
|------|-----------|---------|
| `build-personas.js` | `node scripts/build-personas.js` | Thin wrapper: resolves paths to `personas/persona-build.config.js` and the library CLI binary, then delegates the full build to `@mistralys/persona-builder` |
| `persona-build.config.js` | *(loaded by the library CLI)* | Config file in `personas/persona-build.config.js` — declares suite directories, output paths, and the `ledgerPlugin` that validates persona role names against the workflow manifest |
| `sync-personas.js` | `node scripts/sync-personas.js` | Orchestrator: runs build, copies output to VS Code prompts dir and/or Claude Code agents dir, validates frontmatter |

### CLI Flags (`build-personas.js`)

The thin wrapper recognises three flags and forwards the relevant ones to the library CLI. Suite and target selection are defined in `personas/persona-build.config.js`.

| Flag | Effect |
|------|--------|
| *(none)* | Delegate build to `@mistralys/persona-builder` for all suites and targets declared in the config |
| `--check` | Forward `--check` to the library CLI — compare generated output against existing files; exit 1 if stale |
| `--dry-run` | Treated as `--check` by the wrapper (no disk writes) |
| `--strict` | Forward `--strict` to the library CLI — exit 1 if unresolved `{{variable}}` or `{{> partial}}` markers remain in output |

### CLI Flags (`sync-personas.js`)

| Flag | Effect |
|------|--------|
| *(none)* | Build + copy to both VS Code prompts dir and `~/.claude/agents/` |
| `--target vscode` | Build + copy VS Code output only |
| `--target claude-code` | Build + copy Claude Code output only |
| `--target all` | Explicit default — same as no `--target` |
| `--dry-run` | Build dry-run + preview copy targets; no writes |
| `--custom-path <dir>` | Override the VS Code prompts directory (vscode target only) |

---

## Architectural Patterns

### 1. Template Engine (3-Phase Pipeline)

The template engine is implemented inside the `@mistralys/persona-builder` library and executed when `build-personas.js` invokes the library CLI. The phases remain unchanged from the pre-migration design:

1. **Partial resolution** — `{{> name}}` embeds content from `src/partials/name.md` (recursive, max depth 2)
2. **Conditional blocks** — `{{#if flag}} … {{/if}}` includes or strips blocks based on YAML boolean flags
3. **Variable interpolation** — `{{variable}}` substituted from merged YAML context

Post-processing collapses 3+ consecutive blank lines to 2.

**Key constraint:** No `{{#each}}` loops — iteration is handled by computed variables. Conditionals support an optional `{{else}}` branch (see `constraints.md` #4). Nested `{{#if}}` blocks are not supported — flatten to separate conditionals or partials.

### 2. Merged Context Model

Each persona's template context is built by merging three layers:

```
_shared.yaml          (base: author, version, roster)
  └─ N-name.yaml      (per-persona: number, role, tools, feature flags)
      └─ computed      (derived: tools_json, roster_rendered, mcp_tools_table)
```

Per-persona values override shared values. Computed values are generated by the library and cannot be overridden via YAML.

### 3. Source/Output Separation

Source templates live in `personas/ledger/src/` (3 subdirectories: `meta/`, `partials/`, `content/`). Generated output is written to two target directories: `personas/ledger/vs-code/` (VS Code frontmatter + tooling) and `personas/ledger/claude-code/` (Claude Code frontmatter + tools). The `README.md` and `src/` directory in `personas/ledger/` are not affected by the build. Generated files carry an `<!-- AUTO-GENERATED -->` header to signal they should not be hand-edited.

### 4. Frontmatter Contract

Every generated persona file starts with YAML frontmatter declaring identity and capabilities. The exact shape differs by target:

**VS Code** (`personas/ledger/vs-code/`):

```yaml
---
name: '3 - Developer v3.4.0'
description: 'Step 3/9 in the agent workflow.'
role: Developer
author: Sebastian Mordziol
version: 3.4.0
last_updated: 2026-02-21 18:30
vs_file_name: 3-dev.agent.md
tools: ['vscode', 'execute', 'read', 'edit', 'search', 'web', 'agent', 'todo', 'central_pm/*']
---
```

**Claude Code** (`personas/ledger/claude-code/`):

```yaml
---
name: 3-developer
description: 'Staff Software Engineer — Implementation & Verification'
role: Developer
author: Sebastian Mordziol
version: 3.5.0
last_updated: 2026-02-22 12:00
tools: ['Bash', 'Read', 'Edit', 'Write', 'Grep', 'Glob', 'Task', 'WebFetch', 'WebSearch']
permissionMode: acceptEdits
model: inherit
memory: project
mcpServers:
  - central_pm
---
```

This frontmatter is consumed by:
- `sync-personas.js` → reads `vs_file_name` (VS Code) or `name` (Claude Code) to determine the deployment filename
- `sync-personas.js` → validates VS Code frontmatter (`role`, `name`, `vs_file_name`) and CC frontmatter (`name` format, `role`, `permissionMode`, `model`, `memory`) against `KNOWN_ROLES`
- AI IDEs → reads `name`, `description`, and `tools` for agent picker UI
- MCP Agent Registry → reads `role` for automatic handoff routing

```