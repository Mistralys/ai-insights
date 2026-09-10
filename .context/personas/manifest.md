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
                └── curation-log.md
                └── data-flows.md
                └── file-tree.md
                └── tech-stack.md
                └── variables.md

```
###  Path: `/personas/docs/agents/project-manifest/README.md`

```md
# Project Manifest: Ledger Personas Build System

**Purpose:** Templated build system for generating persona files across the ledger, standalone, and ledger-support suites

---

## Overview

The **Ledger Personas Build System** is a Node.js-based template engine that assembles persona Markdown files from structured YAML metadata and Markdown content/partial templates, across three suites:

- **Ledger** (`ledger/`) — 9 personas for the multi-agent software development workflow backed by the [Project Ledger MCP Server](../../../../mcp-server/README.md)
- **Standalone** (`standalone/`) — special-purpose personas with no ledger dependency
- **Ledger-Support** (`ledger-support/`) — MCP-dependent utility sub-agents invoked as delegates from ledger personas

Each suite is built for three output targets: **VS Code** (`.agent.md`), **Claude Code** (plain `.md`), and **Deep Agents** (plain `.md`, consumed directly by the orchestrator).

Generated persona files are consumed in three ways:
- **Directly** — users copy-paste persona content into AI IDE chat sessions
- **Via sync** — `sync-personas.js` copies VS Code and Claude Code output to VS Code's User prompts directory (using `vs_file_name` frontmatter) and/or Claude Code's `~/.claude/agents/` directory (using `name` frontmatter)
- **Via the orchestrator** — the Deep Agents output is read directly off disk by `orchestrator/src/config.py`, with no sync step

---

## Manifest Sections

| Section | Description |
|---------|-------------|
| [Tech Stack & Patterns](tech-stack.md) | Runtime, dependencies, build tools, and architectural patterns |
| [Public API Surface](api-surface.md) | CLI interface, config shape, template syntax, metadata schema, and MCP tool allocation matrix |
| [Template Variables](variables.md) | Complete reference of all variables available in persona content templates |
| [Key Data Flows](data-flows.md) | Build pipeline (wrapper → library → plugin hooks → output), template resolution, and sync flows |
| [File Tree](file-tree.md) | Annotated directory structure — source templates, generated output, and build scripts |
| [Constraints & Conventions](constraints.md) | Core rules: source editing, naming, versioning, and safety guards |
| [Build System Constraints](constraints-build-system.md) | Template engine behavior, build flags, log conventions, and sync script rules |
| [Cross-System Constraints](constraints-cross-system.md) | Synchronization contracts with the MCP server, Agent Registry, and historical differences |
| [Curation Log](curation-log.md) | Standing decisions and the dated history of manifest curation passes |

---

## Quick Reference

**Build all suites and targets (default):**
```bash
node scripts/build-personas.js
```

> Suite and target selection is controlled by `personas/persona-build.config.js`, not by CLI flags. The wrapper always builds all three suites (`ledger`, `standalone`, `ledger-support`) for all three targets (`vscode`, `claude-code`, `deep-agents`).

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

Post-build (real builds only, not `--check`/`--dry-run`): the wrapper performs two steps: (1) reads `personas/changelog.md`, extracts the latest `## vX.Y.Z` version, and writes it to `personas/package.json` if it differs; (2) reads all 9 ledger persona YAML files in `personas/ledger/src/meta/` plus `_shared.yaml` (for `default_version`), computes per-target agent names, and writes `personas/name-mapping.json` (9 entries sorted by `number`). Each entry shape: `role`, `number`, `id`, `version` (derived from the per-persona `changelog:` block scalar via `resolveVersionFromChangelog()`, falling back to the YAML `version:` field if present, then `default_version`), and target blocks `vscode`, `claude_code`, `deep_agents` — each with `file_name` and `agent_name`. **`version:` and `last_updated:` are not direct YAML inputs** — they are auto-derived from the `changelog:` block scalar; do not set them manually in per-persona YAML.

**Unconditional (both real builds and `--check`):** Two validation steps run after every build:

1. **Subagent cross-reference:** Scans every `personas/ledger/src/content/*.md` file for `{{agent_slug_X_Y}}` references and verifies that the corresponding slug `x-y` is declared in the persona's `subagents` field in its YAML. Errors accumulate across all personas before a single `[ERROR]` block is printed and `process.exit(1)` is called. Personas with no `{{agent_slug_*}}` references pass silently. The internal helper `extractSubagentsList(text, key)` parses flat dash-prefixed YAML block lists (strips inline comments and surrounding quotes); it is local to the validation block and is not exported.

2. **`insight_agent` field validation:** Implemented in `scripts/lib/insight-validation.js`. Fails the build when: (a) a persona defines both `role` and `insight_agent` with differing values; (b) a persona defines exactly one of `insight_agent` / `insight_report_target`. Standalone personas without `role` are exempt from rule (a).

### `personas/persona-build.config.js` — Config Interface

The config file is loaded by the library CLI. It exports an object with the following shape:

| Property | Type | Description |
|----------|------|-------------|
| `sharedPartialsDir` | `string` | Absolute path to `personas/shared/partials/` — base partial layer shared across all suites |
| `targets` | `string[]` | Ordered list of build target names — e.g. `['vscode', 'claude-code', 'deep-agents']`. Each target triggers a separate render pass per persona. The three built-in targets (`vscode`, `claude-code`, `deep-agents`) are registered by the `@mistralys/persona-builder` library; per-suite output paths are configured via `outVscode`, `outClaudeCode`, and `outputDirs` respectively. |
| `frontmatter` | `Object.<string, string>` | Config-level frontmatter template map keyed by target name. Used as the default for suites or targets the ledger plugin does not override. The ledger plugin overrides `vscode` and `claude-code` for the ledger suite via its `onSuiteInit` hook; the `deep-agents` template applies to both suites unchanged. |
| `suites` | `Object.<string, SuiteConfig>` | Suite definitions keyed by suite name (`ledger`, `standalone`, `ledger-support`) |
| `plugins` | `Array` | Plugin instances — currently `[ledgerPlugin({...})]` for role validation |

**Suite Configuration**

Each suite entry (`suites.ledger`, `suites.standalone`, `suites['ledger-support']`) has this shape:

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
| `cc_permission_mode` | `string` | Claude Code permission mode — `default`, `acceptEdits`, `auto`, `dontAsk`, `bypassPermissions`, or `plan` |
| `cc_model` | `string` | Claude Code model override — `sonnet`, `opus`, `haiku`, `fable`, a full model ID, or `inherit` (default). Also serves as the final named fallback in the VS Code `model` resolution chain (after `default_model`), so suites without `default_model` (e.g. standalone) resolve to this value. |
| `cc_memory` | `string` | Claude Code memory scope — `user`, `project`, `local`, or `false` |
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
| `subagents` | `string[]` | no | Flat dash-prefixed list of ledger-support (or standalone, for legacy slugs) persona slugs that this ledger persona may delegate to as sub-agents. Each slug is resolved by the orchestrator against `personas/ledger-support/src/meta/{slug}.yaml` first, then falls back to `personas/standalone/src/meta/{slug}.yaml`. Currently only carried by the Project Manager (Agent 2), where it lists the four PM planning sub-agents (`ledger-wp-decomposer`, `ledger-dependency-sequencer`, `ledger-pipeline-configurator`, `ledger-bootstrapper`) — all four now live in the `ledger-support` suite. Consumed by the orchestrator's `load_subagents()` loader at pipeline startup. The template engine silently ignores unknown YAML keys, so this field has no effect on persona build output. |
| `has_mcp` | `bool` | yes | Inject MCP pre-flight check and tools table |
| `has_detect_project` | `bool` | yes | Inject detect-project pre-flight step |
| `self_documenting_note` | `bool` | yes | Inject self-documenting tools note |
| `has_incident_logging` | `bool` | yes | Inject environment incident logging instructions |
| `has_ledger_workflow` | `bool` | no | Gates the ledger-only sections of `planner-output-template.md` (`## Plan Audit Cycles`, `## Recommended Workflow`). Carried only by Agent 1 (`true`) and the standalone Planner (`false`). |
| `planner_implementer_ref` | `string` | no | Substituted into `planner-core-rules.md` as `{{planner_implementer_ref}}` — names who receives the plan (`"TPM and Engineer"` for ledger, `"implementer"` for standalone). Required by both Planner personas. |
| `mcp_tools` | `Array<{tool, purpose, note_only?}>` | no | MCP tool entries for the tools table; omitted for Agent 1. When `note_only: true` is set on an entry, the library excludes it from the rendered table — the tool is mentioned only in prose content. Use this flag when a tool should be acknowledged in context (e.g. help-text prose) but must not appear as a first-class table row in the generated persona output. |
| `identity` | `string` | yes | Short role title matching the `**Identity: {{identity}}.**` mission header. Required in all ledger personas. Used by `scripts/generate-agents-overview.js`. |
| `description` | `string` | yes | Mission summary sentence(s) displayed under the Identity line in the overview document. Used by `scripts/generate-agents-overview.js`. |
| `inputs` | `string` | yes | What this persona receives as input. Used by `generate-agents-overview.js`. |
| `outputs` | `string` | yes | What this persona produces as output. Used by `generate-agents-overview.js`. |
| `key_behavior` | block scalar | no | Newline-delimited behavior summary. First line rendered in the overview. |
| `modes` | block scalar | no | Newline-delimited operating modes. Rendered in the overview for personas with distinct modes. |
| `insight_pipeline_type` | `string` | no | Pipeline type value substituted into `mcp-insight-capture.md` as `{{insight_pipeline_type}}` (e.g. `"implementation"`, `"qa"`, `"code-review"`). Required for ledger personas that include the `mcp-insight-capture` partial (agents 3–6, 8). Must match the persona's pipeline type from `PIPELINE_AGENT_MAP`. |
| `dev_work_unit` | `string` | no | Substituted into `developer-dual-role.md` — the unit of work the persona implements. Required by both Developer personas, alongside `dev_work_scope`. |
| `dev_work_scope` | `string` | no | Substituted into `developer-dual-role.md` — what the two parallel duties span. Pairs with `dev_work_unit`. |
| `stale_counts_targets` | `string` | no | Substituted into `no-stale-counts.md` — the output surfaces the rule covers. Required by personas including that partial. |
| `insight_reporting_intro` | `string` | no | Substituted into `insight-reporting-rules.md` — the lead-in naming where the observation summary lands. Required by personas including that partial, alongside `insight_compile_source` and `insight_nothing_found`. |
| `insight_compile_source` | `string` | no | Substituted into `insight-reporting-rules.md` rule 1 — names the artefact the summary is compiled from. Pairs with `insight_reporting_intro`. |
| `insight_nothing_found` | `string` | no | Substituted into `insight-reporting-rules.md` rule 4 — the suite-specific nothing-found form. Pairs with `insight_reporting_intro`. |
| `insight_reviewer_ref` | `string` | no | Substituted into `insight-scope-and-types.md` — names who owns the out-of-scope column. Required by personas including that partial, alongside the other two `insight_*` scope fields. |
| `insight_routing` | `string` | no | Substituted into `insight-scope-and-types.md` — one sentence naming where a recorded observation travels downstream. Pairs with `insight_reviewer_ref`. |
| `insight_type_context` | `string` | no | Substituted into `insight-scope-and-types.md` — the lead-in sentence above the observation `type` table. Pairs with `insight_reviewer_ref`. |
| `audit_guide_version` | `string` | no | Persona Design Guide version this persona was last audited against (e.g. `"2.8"`). Set by the Persona Curator on PASS verdict. Consumed by `scripts/generate-persona-audit.js`, which writes `personas/docs/audits/status.md`. Not used by the build system. Audit *process* notes belong in `personas/docs/audits/annotations.json`, not here. |
| `audit_date` | `string` | no | Date of the last audit in `YYYY-MM-DD` format. Set alongside `audit_guide_version`. |

---

## Frontmatter Quick Reference

This section consolidates the key frontmatter facts that agents need most often. The full template strings follow in [Generated Frontmatter Templates](#generated-frontmatter-templates-all-suites) below; metadata schema details are in the [Per-Persona YAML](#per-persona-yaml-n-nameyaml--ledger-suite) tables above.

### Metadata → Frontmatter Field Map

How persona YAML fields map to generated frontmatter output across all targets:

| Frontmatter field | Ledger VS Code | Ledger Claude Code | Standalone VS Code | Standalone Claude Code | Deep Agents (all) |
|-------------------|---------------|--------------------|--------------------|----------------------|-------------------|
| `name` | `'{number} - {role} v{version}'` | `cc_file_name` stem | `'{name}'` | `cc_file_name` stem | `id` |
| `id` | YAML `id` | — | YAML `id` | — | — |
| `description` | Auto: `'Step N/T…'` | `cc_description` (roster-derived) | YAML `description` | YAML `description` | `cc_description` |
| `model` | `model` → `default_model` → `cc_model` | `cc_model` → resolved `model` | — | `cc_model` | — |
| `role` | YAML `role` | YAML `role` | — | — | — |
| `tools` | `tools[]` → `tools_json` | `cc_tools[]` → `cc_tools_json` | `tools[]` → `tools_list` | `cc_tools[]` → `cc_tools_list` | — |
| `name` composition | `'{{number}} - {{role}} v{{version}}'` | `cc_file_name` stem | `'{{name}} v{{version}}'` — plain YAML `name` plus version appended by the template | `cc_file_name` stem | `id` |
| `version` | Auto from `changelog` | Auto from `changelog` | Auto from `changelog` | Auto from `changelog` | — |
| `last_updated` | Auto from `changelog` date | Auto from `changelog` date | Auto from `changelog` date | Auto from `changelog` date | — |
| `author` | `_shared.author` | `_shared.author` | `_shared.author` | `_shared.author` | — |
| `vs_file_name` | YAML `vs_file_name` | — | YAML `vs_file_name` | — | — |
| `permissionMode` | — | `_shared.cc_permission_mode` | — | `_shared.cc_permission_mode` | — |
| `memory` | — | `_shared.cc_memory` | — | `_shared.cc_memory` | — |
| `mcpServers` | — | `_shared.mcp_server_name` (always) | — | Per-persona `mcp_server_name` (conditional) | — |

### Key Derivation Rules

- **`version` / `last_updated`** — Always auto-derived from the `changelog` block scalar via `resolveChangelogMeta()`. **Never set `version:` or `last_updated:` manually** in per-persona YAML — they will be silently overwritten. See constraint C20a.
- **`cc_description`** — For ledger personas: computed from `_shared.roster[]` matching the persona's `number` (`title + " — " + short`). For standalone personas: falls back to the YAML `description` field.
- **`model`** — Resolution chain: `persona.model` → `_shared.default_model` → `_shared.cc_model` → `'inherit'`. Uses `||` (falsy-skip).
- **`cc_name`** — Derived from `cc_file_name` with `.md` stripped. Ledger: `N-role` (e.g. `3-developer`); standalone: plain slug.
- **`name` (standalone VS Code)** — `'{{name}} v{{version}}'`. The YAML `name` field holds the plain display name only (e.g. `"Researcher"`) — do not include the version in it; the frontmatter template appends `v{{version}}` automatically.
- **Conditional blocks** — `mcpServers` in standalone CC frontmatter uses `{{#if mcp_server_name}}` — the block is omitted entirely when the field is absent.

### What Each Platform Consumes

| Field | VS Code reads? | Claude Code reads? | Deep Agents reads? |
|-------|---------------|-------------------|-------------------|
| `name` | Yes — display name in agent picker | Yes — `@agent-<name>` routing | Yes — agent identifier |
| `description` | Yes — placeholder text in chat input | Yes — trigger text for auto-delegation | Yes — agent description |
| `id` | Yes — `@id` subagent routing | No | No |
| `tools` | Yes — controls tool permissions | Yes — tool allowlist (omit to inherit) | No |
| `disallowedTools` | No | Yes — tool denylist | No |
| `model` | Yes — single model or prioritized array | Yes — selects the LLM | No |
| `effort` | No | Yes — reasoning effort override | No |
| `maxTurns` | No | Yes — caps agentic turns | No |
| `memory` | No | Yes — `project` / `user` / `local` / `false` | No |
| `permissionMode` | No | Yes — edit approval mode | No |
| `mcpServers` | No | Yes — scoped MCP servers | No |
| `agents` | Yes — subagent access control | No (uses `Agent()` in `tools`) | No |
| `background` | No | Yes — run as background task | No |
| `isolation` | No | Yes — `worktree` for git worktree isolation | No |
| `skills` | No | Yes — preload skill content | No |
| `handoffs` | Yes — suggested next-step buttons | No | No |
| `hooks` | Preview (requires setting) | Yes — lifecycle hooks | No |

> Fields like `role`, `author`, `version`, `last_updated`, and `vs_file_name` are metadata for human/agent orientation — they are not consumed by the host platforms' runtime.
>
> VS Code also supports `user-invocable`, `disable-model-invocation`, `target`, and `mcp-servers` on agent files. Claude Code also supports `initialPrompt`, `color`, and additional fields. The full field references are maintained in the `@mistralys/persona-builder` library docs (`docs/target-differences.md`).
>
> **Skills** use a cross-platform frontmatter schema ([agentskills.io](https://agentskills.io) standard) — not built by the persona-builder. The ai-insights `.github/skills/` files follow the VS Code skill format, while `.claude/skills/` files follow the Claude Code skill format. Both are documented in the persona-builder's `docs/target-differences.md`.

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

Written to `personas/standalone/vs-code/`. No `role`. The persona `name` field holds the plain display name only — the template appends the version. Output filename is determined by `vs_file_name`.

```yaml
---
id: {{id}}
name: '{{name}} v{{version}}'
description: '{{description}}'
author: {{author}}
version: {{version}}
{{#if last_updated}}
last_updated: {{last_updated}}
{{/if}}
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

Written to `personas/ledger/deep-agents/`, `personas/standalone/deep-agents/`, and `personas/ledger-support/deep-agents/`. Applies to all three suites unchanged — the ledger plugin does not override this template.

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
| `cc_permission_mode` | `string` | Claude Code permission mode — `default`, `acceptEdits`, `auto`, `dontAsk`, `bypassPermissions`, or `plan` |
| `cc_model` | `string` | Claude Code model override — `sonnet`, `opus`, `haiku`, `fable`, a full model ID, or `inherit` |
| `cc_memory` | `string` | Claude Code memory scope — `user`, `project`, `local`, or `false` |
| `default_cc_tools` | `string[]` | Default tool list for Claude Code frontmatter |

> **Note:** `mcp_server_name` is intentionally absent from standalone `_shared.yaml` — standalone personas are fully independent tools with no shared MCP dependency. MCP-dependent utility personas that support the ledger workflow live in the `ledger-support` suite instead, where `mcp_server_name: central_pm` is declared in `_shared.yaml`. `roster` is also absent — standalone personas are not part of the 9-stage workflow.

### Ledger Support Suite (`ledger-support`)

The `ledger-support` suite (`personas/ledger-support/src/`) uses the same slug-based schema as the standalone suite but with a shared `mcp_server_name: central_pm` in `_shared.yaml`. These personas are ledger workflow utility agents (e.g., PM sub-agents, ledger doctor) that require the `central_pm` MCP server.

**`_shared.yaml`:** Identical structure to standalone `_shared.yaml` plus `mcp_server_name: central_pm`.

**Per-persona YAML:** Same schema as standalone per-persona YAML. `id` values for the 9 personas migrated from `standalone/` retain their `standalone-*` prefix permanently (stability rule — see [constraint C24](constraints.md#c24)). New personas added to this suite use the `ledger-support-{slug}` prefix.

> **Note:** `role` is intentionally absent — ledger-support personas are not part of the 9-stage workflow roster. They are utility agents invoked as sub-agents or directly by users.

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
| `subagents` | `string[]` | no | Flat dash-prefixed list of ledger-support (or standalone) persona slugs this persona may invoke as sub-agents. When declared, the builder resolves `{{agent_{slug}}}` (display name) and `{{agent_slug_{slug}}}` (kebab slug) template variables for use in target-conditional dispatch blocks. Each slug must resolve to a YAML file in `personas/ledger-support/src/meta/` (first) or `personas/standalone/src/meta/` (fallback). |
| `identity` | `string` | yes | Short role title matching the `**Identity: {{identity}}.**` mission header. Required in all personas. Used by `scripts/generate-agents-overview.js` for the overview document. |
| `use_when` | `string` | no | One-line description of when to invoke this persona. Used by `generate-agents-overview.js`. Applies to standalone and ledger-support personas. |
| `key_behavior` | block scalar | no | Newline-delimited behavior summary. First line used in the overview. Applies to all suites. |
| `modes` | block scalar | no | Newline-delimited operating modes. Used in the overview for personas with distinct modes. |
| `notes` | `string` | no | Optional freeform note rendered as a **Notes:** bullet in the overview. |
| `insight_agent` | `string` | no | Value written to the JSONL `agent` key in `insights.jsonl` (e.g. `"Developer"`, `"Web GUI Specialist"`). Required for standalone personas that include the insight partials. Must be paired with `insight_report_target`. |
| `brief_orientation` | `string` | no | Clause naming which brief entries the persona draws on, substituted into `research-brief-reference.md`. Reviewers filter by tag (`"Entries tagged \`[verify]\`, and untagged entries, are the ones this audit draws on"`); implementers take the whole brief (`"Every area of the brief is in scope, whatever tags its entries carry"`). Required for personas including either research-brief partial, alongside `brief_purpose` and `brief_authority`. |
| `brief_purpose` | `string` | no | Sentence fragment naming what the brief gives a head start on (e.g. `"grounding verification"`, `"Contextual Analysis"`). Pairs with `brief_orientation`. |
| `brief_authority` | `string` | no | Phrase naming what remains authoritative over the brief (e.g. `"independent verification"`, `"the current state of the code"`). Pairs with `brief_orientation`. |
| `brief_contribution_point` | `string` | no | Adverbial phrase naming when references are appended back, trigger-anchoring the contribute-back step to an observable event (e.g. `"during the audit phases"`). **Authoring personas only** — required alongside `brief_contributor` and `brief_report_file` by `research-brief-protocol.md`, unused by reader-only personas. |
| `brief_contributor` | `string` | no | Attribution name used in the `[added by: …, unverified]` prefix when appending to the brief. Authoring personas only. |
| `brief_report_file` | `string` | no | The authoring persona's own report filename, used both to contrast facts (brief) against judgments (report) and to locate the **Research brief** status line — e.g. `"audit.md"`. Authoring personas only. |
| `insight_report_target` | `string` | no | Human phrase naming where the curated insight section lands. Must be paired with `insight_agent`. |
| `has_ledger_workflow` | `bool` | no | Gates the ledger-only sections of `planner-output-template.md`. Set to `false` on the standalone Planner so `## Plan Audit Cycles` and `## Recommended Workflow` are omitted. |
| `planner_implementer_ref` | `string` | no | Substituted into `planner-core-rules.md` as `{{planner_implementer_ref}}` — `"implementer"` for the standalone Planner. |
| `audit_guide_version` | `string` | no | Persona Design Guide version this persona was last audited against (e.g. `"2.8"`). Set by the Persona Curator on PASS verdict. Consumed by `scripts/generate-persona-audit.js`, which writes `personas/docs/audits/status.md`. Not used by the build system. Audit *process* notes belong in `personas/docs/audits/annotations.json`, not here. |
| `audit_date` | `string` | no | Date of the last audit in `YYYY-MM-DD` format. Set alongside `audit_guide_version`. |

> **Note:** `role` is intentionally absent — standalone personas are not part of the MCP-backed 9-stage workflow and have no role-based routing. The `vs_file_name` field uses `.agent.md` extension (e.g. `researcher.agent.md`) — this convention was established by WP-004.

### Feature Flags by Agent

| Agent | `has_mcp` | `has_detect_project` | `self_documenting_note` | `has_incident_logging` |
|-------|-----------|----------------------|-------------------------|------------------------|
| 1 — Planner | ✓ | — | — | — |
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
| `ledger_get_repository_context` | **✓** | — | — | — | — | — | — | — | — |
| `ledger_search_insights` | **✓** | — | **✓** | **✓** | **✓** | **✓** | — | — | — |
| `ledger_initialize_project` | — | **✓** | — | — | — | — | — | — | — |
| `ledger_create_work_package` | — | **✓** | — | — | — | — | — | — | — |
| `ledger_get_next_action` | — | — | **✓** | **✓** | **✓** | **✓** | **✓** | **✓** | **✓** |
| `ledger_begin_work` | — | — | **✓** | **✓** | **✓** | **✓** | **✓** | **✓** | — |
| `ledger_get_work_package` | — | — | **✓** | **✓** | **✓** | **✓** | **✓** | **✓** | **✓** |
| `ledger_complete_pipeline` | — | — | **✓** | **✓** | **✓** | **✓** | **✓** | **✓** | — |
| `ledger_cancel_pipeline` | — | — | **✓** | **✓** | **✓** | **✓** | **✓** | **✓** | — |
| `ledger_add_project_comment` | — | — | **✓** | **✓** | **✓** | **✓** | **✓** | **✓** | **✓** |
| `ledger_add_observation` | — | — | **✓** | **✓** | **✓** | **✓** | — | **✓** | — |
| `ledger_get_project_status` | — | **✓** | — | — | — | — | — | — | **✓** |
| `ledger_list_work_packages` | — | — | — | — | — | — | — | **✓** | **✓** |
| `ledger_update_work_package_status` | — | — | — | — | — | — | — | **✓** | — |
| `ledger_get_handoff_status` | — | **✓** | — | — | — | — | — | — | **✓** |
| `ledger_complete_synthesis` | — | — | — | — | — | — | — | — | **✓** |
| `ledger_help` | — | — | *(note)* | *(note)* | *(note)* | *(note)* | *(note)* | *(note)* | *(note)* |

### Rationale

**1 — Planner:** Uses `ledger_get_repository_context` to retrieve the repository's strategic vision and prior project history, and `ledger_search_insights` to query the knowledge base for relevant patterns. These are read-only, pre-planning tools — the Planner does not write to the ledger.

**2 — Project Manager:** Initializes the ledger (`ledger_initialize_project`) and creates all work packages (`ledger_create_work_package`). Uses `ledger_get_project_status` to verify the ledger after creation. Uses `ledger_get_handoff_status` to compute the handoff block — required because PM does not use `ledger_get_next_action` (it has no pipeline loop) and therefore cannot rely on the embedded `handoff_status` in WAIT responses.

**3 — Developer:** Full pipeline agent. Uses `ledger_get_next_action` → `ledger_begin_work` → `ledger_complete_pipeline` as the core loop. Has `ledger_add_observation` for recording Code Insight observations incrementally during implementation and after pipeline completion. Has `ledger_cancel_pipeline` for stale pipeline recovery.

**4 — QA:** Pipeline agent with the same core loop as Developer (get next action → begin work → complete pipeline). Uses `ledger_add_observation` to record QA observations (edge cases, coverage gaps, regression risks) incrementally after each test area. Does not need `ledger_get_project_status` — reachability is confirmed by the `ledger_get_next_action` call in the preflight detect step.

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
| `planner-philosophy.md` | Agent 1, Planner (Standalone) | *(none)* — the three canonical principles registered in [C5c](constraints.md#c4c) |
| `planner-operating-modes.md` | Agent 1, Planner (Standalone) | *(none)* — mode table, detection rule, and deferred-item triage |
| `planner-research-brief-template.md` | Agent 1, Planner (Standalone) | Gates `## Strategic Context` behind `{{#if has_mcp}}` |
| `planner-output-template.md` | Agent 1, Planner (Standalone) | Gates `## Plan Audit Cycles` and `## Recommended Workflow` behind `{{#if has_ledger_workflow}}`, and `## Prior Project Context` + `## Knowledge Base Reconciliation` behind `{{#if has_mcp}}`. Embeds `{{agent_plan_auditor}}` / `{{agent_plan_architect_reviewer}}` inside the ledger-gated block only, and `{{agent_ledger_knowledge_curator}}` inside the MCP-gated block only |
| `planner-core-rules.md` | Agent 1, Planner (Standalone) | `{{planner_implementer_ref}}` — who receives the plan (`"TPM and Engineer"` for ledger, `"implementer"` for standalone). The insight-routing rule under Scope & Boundaries is gated on `{{#if has_mcp}}` |
| `planner-quality-checklist.md` | Agent 1, Planner (Standalone) | *(none)* for the shared items; the reconciliation item is gated on `{{#if has_mcp}}` and embeds `{{agent_ledger_knowledge_curator}}` |
| `knowledge-ownership.md` | Agent 1, Agent 9, Standalone Developer | `{{agent_ledger_knowledge_archiver}}`, `{{agent_ledger_knowledge_curator}}`. Emits its own `## Knowledge Base Ownership` heading — consumers include it at top level, never under a wrapper heading. Answers *who to ask* via a need→custodian routing table, and points an overtaken entry at the Curator's Targeted Reconciliation mode. Deliberately names no MCP tools: the tool grants belong to the custodians, and a consuming persona holds none of them, so listing them describes capabilities the reader cannot use. Carries one constraint (report an overtaken entry) — the prohibitions it once repeated were dropped as redundant with naming the owner. Agent 9 and the Standalone Developer follow it with one paragraph naming where their dispatch happens; Agent 1 adds none, since its own workflow step and the plan template state the duty at the point it fires. |
| `pm-output-format.md` | Agent 2 | *(none)* |
| `developer-operational-protocol.md` | Agent 3 | *(none)* |
| `developer-strict-constraints.md` | Agent 3 | Embeds `{{> incident-logging}}` — resolves via ledger override layer; requires a stub in `shared/` for non-ledger suites |
| `developer-dual-role.md` | Agent 3, Standalone Developer | `{{dev_work_unit}}` (the unit of work — Work Package vs. scoped plan document), `{{dev_work_scope}}` (what the parallel duties span — `"every work package"` vs. `"the plan"`). The numbered Implementation / Code Insight Observer pair in the Mission section. |
| `insight-observer-intro.md` | Agent 3, Standalone Developer | *(none)* — mechanism-neutral by design: says observations "get recorded" without naming the sink or the ledger, so both suites share one paragraph. |
| `no-stale-counts.md` | Agent 3, Standalone Developer | `{{stale_counts_targets}}` (the surfaces the rule covers — `"documentation, summaries, or pipeline comments"` vs. `"documentation, summaries, or synthesis output"`). Rendered as a single `* {{> no-stale-counts}}` bullet inside a Strict Constraints list; the partial emits no leading bullet marker of its own. |
| `insight-reporting-rules.md` | Agent 3, Standalone Developer | `{{insight_reporting_intro}}` (lead-in naming where the summary lands), `{{insight_compile_source}}` (what rule 1 compiles from — ledger observations vs. `insights.jsonl`), `{{insight_nothing_found}}` (the nothing-found form for rule 4). Six numbered rules shared verbatim. |
| `insight-scope-and-types.md` | Agent 3, Standalone Developer | `{{insight_reviewer_ref}}` (who owns the out-of-scope column — `"the Reviewer agent"` / `"a formal reviewer"`), `{{insight_routing}}` (one sentence naming where recorded observations travel: Synthesis → rework plan for ledger, `synthesis.md` Code Insights → Planner for standalone), `{{insight_type_context}}` (lead-in above the type table — pipeline comments vs. sink append). Carries the Scope & Boundaries table, the out-of-scope-routing rationale, the five `type` values, and the priority guidelines. **Not** used by the Web GUI Specialist, which has a UI-specific scope table and its own `type` vocabulary (`visual-bug`, `ux-friction`, `accessibility-gap`, …). |
| `insight-capture.md` | Standalone Developer, Web GUI Specialist | `{{insight_agent}}`; placement: inside the observation section, after type/priority definitions. Contains the two-rung sink location ladder (resolve-once), flat JSONL schema with a concrete example line, append-only rules, non-blocking fallback, and retention note. |
| `insight-compilation.md` | Standalone Developer, Web GUI Specialist | `{{insight_agent}}`, `{{insight_report_target}}`; placement: beside the output-format / report-template section. Contains compile-from-sink instructions (all entries, never filtered by `agent`), cross-agent corroboration note, lenient consumption, and forcing function (nothing-found type `improvement` hardcoded). |
| `mcp-insight-capture.md` | Agents 3–6, 8 | `{{insight_pipeline_type}}`; placement: inside the observation section. Contains `ledger_add_observation` call shape with `loc`, action-gate rule, and retry-then-track fallback. Replaces `insight-capture.md` + `insight-compilation.md` for ledger personas. |
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
| `summary-crafting-guide.md` | Ledger Bootstrapper, Standalone Archiver | *(none)* |
| `research-brief-reference.md` | Standalone Developer, Web GUI Specialist — and, nested, `research-brief-protocol.md` | `{{brief_orientation}}`, `{{brief_purpose}}`, `{{brief_authority}}`. **Reader-facing half:** what a `research-brief.md` is, which entries to orient on, and the three don't-trust / don't-assume-complete / don't-reconstruct constraints. Carries no heading of its own — the including persona supplies `## Research Brief` — and says nothing about appending, since a reader never writes to the brief. Consumers supply the three variables, place the section anywhere after Outputs and before the protocol step that references it, carry a **Research brief** status line in their output template, and reference the brief from the protocol step that opens their codebase-discovery phase. |
| `research-brief-protocol.md` | Plan Auditor, Plan Architect Reviewer | Nests `research-brief-reference.md`, then adds a `### Contributing Back` section. Adds `{{brief_contribution_point}}`, `{{brief_contributor}}`, `{{brief_report_file}}` on top of the reference partial's three, so authoring consumers supply all six. **Author-facing half:** the 5,000-token size guard, the `[added by: …, unverified]` append format, and the two do-not-append constraints. Reserved for personas that write back to a brief whose plan is not yet implemented — implementers must not include it, because a brief is deleted at archival and anything they append has no reader. Authoring consumers additionally carry a brief-existence workflow checkpoint, a contribute-back step gated on `{{brief_contribution_point}}`, and a **Research brief** line in `{{brief_report_file}}`. The size guard is defined here only — never restate it in a persona. |
| `title-crafting-guide.md` | Ledger Bootstrapper, Standalone Archiver | *(none)* |

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

---

## Model Registry

The model registry lives at `{WORKSPACE_ROOT}/personas/model-registry/` and is the source of truth for the AI model list and per-persona model assignments. It is managed by the GUI via `mcp-server/gui/api-models.ts` and consumed by the build system and orchestrator at startup.

### File Shapes

#### `default.json` — Shipped defaults (Git-tracked)

A JSON array of model entries. Seeded into `local.json` on first access if `local.json` does not yet exist. Loaded into the registry view via `POST /api/models/load-defaults`. Never written by the API — it is the canonical default set shipped with the project.

```json
[
  { "id": "<uuid>", "name": "<display name>", "slug": "<kebab-slug>", "cc_model": "<model-id-or-inherit>" }
]
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID string | Stable identifier. Assignment values use this UUID — slug renames do not cascade into `assignments.json`. The sentinel entry for "Inherit / Auto" uses UUID `00000000-0000-0000-0000-000000000000`. |
| `name` | string (min 1) | Human-readable display name (e.g. `"Claude Opus 4.6"`). |
| `slug` | string | Kebab-case identifier matching `/^[a-z0-9]+(-[a-z0-9]+)*$/`. Used as the API-facing model key and as the value written to persona YAML `model_slug` after assignment. The slug `"inherit"` is reserved exclusively for the sentinel entry. |
| `cc_model` | string (min 1) | Claude Code model identifier (e.g. `"claude-opus-4-6"`) or `"inherit"` to inherit the workspace default. |

#### `local.json` — User-registered models (gitignored)

Same array shape as `default.json`. Auto-initialized from `default.json` on first `GET /api/models` call when absent. This is the **live model list** — all API reads and writes target this file. `default.json` is consulted only during auto-initialization and `POST /api/models/load-defaults`.

Corruption guard: if `local.json` exists but fails schema validation, all write operations are rejected until the file is manually repaired.

#### `assignments.json` — Per-persona model assignments (gitignored)

```json
{
  "default_model_uuid": "<uuid>",
  "persona_models": {
    "<persona-id>": "<uuid>"
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `default_model_uuid` | UUID string (optional) | UUID of the workspace-default model. Absent when no default has been set. |
| `persona_models` | `Record<string, UUID>` | Map from persona `id` (from `name-mapping.json`) to the assigned model UUID. Empty object when no overrides have been set. |

Auto-created on first `PUT /api/model-assignments` call when absent. Returns `{ default_model_uuid: undefined, persona_models: {} }` when file does not exist.

### Model Resolution Priority Chain

When resolving the effective model for a persona (consumed by build system and orchestrator), the following priority chain applies:

1. **Per-persona assignment** — `assignments.json` → `persona_models[persona.id]` → resolved to slug via `getResolvedAssignments()`.
2. **Workspace default** — `assignments.json` → `default_model_uuid` → resolved to slug.
3. **Per-persona YAML override** — `persona.model_slug` in `personas/ledger/src/meta/N-*.yaml`.
4. **Suite default** — `_shared.yaml` → `default_model_slug`.

The build system (`scripts/build-personas.js`) and orchestrator (`orchestrator/src/utils/persona_models.py`) each resolve this chain locally at startup. The GUI resolves it via `GET /api/model-assignments` (which returns UUID-keyed values) and `GET /api/personas` (which returns resolved slug values for display).

The persona `id` field (from `name-mapping.json`) is the stable key used in `assignments.json`. Changing a persona's display name or slug does not break existing assignments.

### `name-mapping.json` — All Suites

`personas/name-mapping.json` is regenerated by `scripts/build-personas.js` after every real build. It covers all three suites (ledger, standalone, ledger-support). Each entry shape:

| Field | Type | Description |
|-------|------|-------------|
| `role` | string | Human-readable role name |
| `number` | number | Display ordering index (ledger suite) |
| `id` | string | Stable persona identifier used as the `persona_models` key in `assignments.json` |
| `version` | string | Resolved from persona `changelog` block scalar |
| `vscode` | `{ file_name, agent_name }` | VS Code target output |
| `claude_code` | `{ file_name, agent_name }` | Claude Code target output |
| `deep_agents` | `{ file_name, agent_name }` | Deep-agents target output |

`PUT /api/model-assignments` validates all `persona_models` keys against the `id` values in `name-mapping.json` — assignments referencing persona IDs not present in the mapping are rejected.

---

## Standalone Developer Synthesis Output Format

The Standalone Developer persona (`personas/standalone/src/content/developer.md`) instructs
the agent to produce a synthesis Markdown document at the end of an implementation task.
This section documents the required section structure so that consumers (e.g. `parseOutcomeSummary()`
in `mcp-server/src/utils/synthesis-parser.ts`) can reliably extract structured data from
the output.

### Required Sections

The synthesis report must contain the following `###`-level sections in the order shown:

| Section | Order | Description |
|---------|-------|-------------|
| `### Completion Status` | 1 | One-line status word (e.g. `COMPLETE`, `PARTIAL`) |
| `### Outcome Summary` | 2 | 2–3 sentence prose summary of what was accomplished, the approach taken, and any notable results |
| `### Implementation Summary` | 3 | Flat bullet list of implementation actions taken |
| `### Documentation Updates` | 4 | List of documentation files created or updated |
| `### Verification Summary` | 5 | Test results, linting results, and verification steps |
| `### Code Insights` | 6 | Notable decisions, trade-offs, and architectural observations |
| `### Additional Comments` | 7 | Optional free-form notes |

### `### Outcome Summary` section

Added in WP-004 (standalone synthesis format alignment). This section is consumed by
`parseOutcomeSummary()` in `mcp-server/src/utils/synthesis-parser.ts` to populate the
`outcome_summary` field on the project meta when `ledger_complete_synthesis` is called.

**Fallback behaviour:** when `### Outcome Summary` is absent or its body is empty/whitespace,
`parseOutcomeSummary()` falls back to the first bullet item in `### Implementation Summary`.
When both sections yield no content, the function returns `null` and `outcome_summary` is
not populated.

**Source file:** `personas/standalone/src/content/developer.md` — modify this file to
change the synthesis section structure. Regenerate all three output targets after any
template change (`node scripts/build-personas.js`).


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
2. **Nested `{{#if}}` blocks are supported, but only inside an `{{else}}` branch.** The engine resolves conditionals innermost-first, so a `{{#if}}` may nest inside the `{{else}}` branch of an outer `{{#if}}` — this is the required pattern for three-way, per-target content (see `constraints.md` §C20 and the live example in `personas/ledger/src/content/2-project-manager.md`):

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

   `{{else if flag}}` chains are also supported and are normalised internally into the nested form above before resolution. What is **not** supported is nesting a second `{{#if}}` directly inside the truthy branch of an outer `{{#if}}` (i.e. before any `{{else}}`) — the engine's innermost-first resolution has no way to disambiguate which `{{/if}}` closes which opener in that position. Flatten that case to a single compound boolean instead:

   **Unsupported (nested inside the truthy branch, no `{{else}}`):**
   ```
   {{#if platform_vscode}}
     {{#if feature_enabled}}
       Content for VS Code only when feature is on
     {{/if}}
   {{/if}}
   ```

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

<a name="c37"></a>
<a name="b10"></a>
10. **Version in name-mapping is derived from the `changelog` block scalar.** `scripts/build-personas.js` uses an internal `resolveVersionFromChangelog(rawYamlText)` helper to extract version from each persona's `changelog:` YAML field before falling back to the explicit `version:` field and then to `DEFAULT_VERSION`. This mirrors the derivation logic in the persona-builder library's `resolveChangelogMeta()`. Supported formats:
    - `X.Y.Z (YYYY-MM-DD): description` — version + date extracted
    - `X.Y.Z: description` — version extracted, no date

    The build script emits diagnostics via the `validateChangelogField()` helper:
    - `[WARN]` when `changelog` is present but contains no parseable version line
    - `[WARN]` when the first parseable version entry has no date component
    - `[WARN]` when the same version number appears more than once with different dates (data-entry mistake that would cause `last_updated` to be ambiguous)
    - `[INFO]` when explicit `version:` or `last_updated:` fields coexist with `changelog` (indicating stale redundant fields that should be removed)

    The explicit `version:` field in per-persona YAML is **inert once a `changelog` field is present** — do not add or update `version:` manually.

    > **Resolved — generated frontmatter `version:` vs. `name-mapping.json` version.** Earlier releases of `@mistralys/persona-builder` (< v2.5.0) fell back to `default_version` from `_shared.yaml` for the frontmatter `version:` field regardless of a persona's `changelog:` content, causing `name-mapping.json` to show a newer version than generated frontmatter. `personas/package.json` now pins `^2.6.0`, which uses the shared `resolveChangelogMeta()` logic in both places — this discrepancy no longer applies. Do not add an explicit `version:` field to persona YAML; it remains inert regardless of installed library version.

<a name="c38"></a>
<a name="b11"></a>
11. **Frontmatter templates must guard `last_updated:` with `{{#if last_updated}}`.** When `buildContext()` derives `last_updated` from a changelog entry with no date component, it resolves to `''` (empty string). An unguarded `last_updated: {{last_updated}}` line in a frontmatter template produces `last_updated: ` — a blank YAML value that may cause downstream parsing issues or confuse consumers.

    All four frontmatter template locations use a conditional guard:
    ```
    {{#if last_updated}}
    last_updated: {{last_updated}}
    {{/if}}
    ```
    This applies to: VS Code and Claude Code templates in both `personas/persona-build.config.js` (standalone suite) and `personas/plugins/ledger/frontmatter-templates.js` (ledger suite). Any new frontmatter template that references `last_updated` **must** include this guard.

---

## Sync Script Conventions

<a name="c30"></a>
<a name="b12"></a>
12. **`vs_file_name` is required for VS Code sync; `name` is required for Claude Code sync.** During VS Code sync, files without a `vs_file_name` field in frontmatter are silently skipped. During Claude Code sync, files without a `name` field are skipped. This excludes `README.md` and any non-persona files.

<a name="c31"></a>
<a name="b13"></a>
13. **Sync reads from explicit source directories.** `syncVSCode()` reads from `ledger/vs-code/`; `syncStandaloneVSCode()` reads from `standalone/vs-code/`; `syncClaudeCode()` reads from `ledger/claude-code/`; `syncStandaloneClaudeCode()` reads from `standalone/claude-code/`. All four copy to their respective target directories without recursively walking the whole `personas/` tree. When `--target vscode` (or `--target all`) is used, both `syncVSCode()` and `syncStandaloneVSCode()` are called. When `--target claude-code` (or `--target all`) is used, both `syncClaudeCode()` and `syncStandaloneClaudeCode()` are called.

<a name="c32"></a>
<a name="b14"></a>
14. **Frontmatter validation is advisory.** `validateVSCodeFrontmatter()` checks `role`, `name`, `vs_file_name`, `id`, and `model` in ledger VS Code personas. `validateStandaloneVSCodeFrontmatter()` checks `name` and `vs_file_name` in standalone VS Code personas (no `role` required). `validateCCFrontmatter()` checks `name` (must match `\d-kebab-case` pattern with numeric prefix), `role`, `permissionMode`, `model`, and `memory` in ledger Claude Code personas. `validateStandaloneCCFrontmatter()` checks `name` (plain kebab-case — **no** numeric prefix, e.g. `agents-md-curator`), `permissionMode`, `model`, and `memory` in standalone Claude Code personas. None of these functions block the sync — warnings are printed to console.

<a name="c33"></a>
<a name="b15"></a>
15. **Build is automatic during sync.** `scripts/sync-personas.js` spawns `scripts/build-personas.js` as a child process before copying files, and forwards the `--target` flag so the build step generates only the required output. There is no need to run build separately when syncing.

```
###  Path: `/personas/docs/agents/project-manifest/constraints-cross-system.md`

```md
# Constraints — Cross-System Dependencies

> **Scope:** Synchronization contracts between the personas build system and the MCP server, Agent Registry, and workflow manifest. Consult this document when working on integration points between sub-projects.
>
> See also: [Core Constraints](constraints.md) · [Build System Constraints](constraints-build-system.md)

---

## Runtime Synchronization

<a name="x1"></a>
1. **`KNOWN_ROLES` and `AGENT_ROLES` are both manifest-derived.** Both `scripts/sync-personas.js` → `KNOWN_ROLES` and `mcp-server/src/utils/constants.ts` → `AGENT_ROLES` now derive their values at runtime from `shared/workflow-manifest.json`. There is no longer a manual sync contract between these two — they always agree by construction. Adding or renaming a role in the manifest propagates automatically. Persona YAML `role` fields still need to match manifest role names; `scripts/build-personas.js` validates this and emits advisory warnings on mismatch.

<a name="x2"></a>
2. **`role` field ↔ Agent Registry**: The `role` value in persona frontmatter is used by the MCP server's Agent Registry (`mcp-server/src/utils/agent-registry.ts`) to discover agent handles for automatic handoffs. The registry scans `*.agent.md` files in the VS Code prompts directory and matches the `role` field.

<a name="x3"></a>
3. **`name-mapping.json` is generated from persona YAML metadata.** `scripts/build-personas.js` reads all 9 ledger persona YAML files in `personas/ledger/src/meta/` (plus `_shared.yaml` for `default_version`) and writes `personas/name-mapping.json` after every real build (skipped in `--check`/`--dry-run` mode). The file contains per-persona identity (`role`, `number`, `id`, `version`) and per-target agent name data (`vscode`, `claude_code`, `deep_agents` — each with `file_name` and `agent_name`). It must be regenerated whenever persona YAML naming fields change (`role`, `number`, `id`, `version`, `cc_file_name`, `vs_file_name`, `da_file_name`, or `default_version` in `_shared.yaml`). The file is checked into Git — stale state is visible in Git diffs. Run `node scripts/build-personas.js` (without `--check`) to regenerate.

<a name="x4"></a>
4. **`subagents` field in ledger persona YAML is consumed by the orchestrator's `load_subagents()`.** The optional `subagents` field (type: `string[]`, flat dash-prefixed block list) in a ledger persona YAML (`personas/ledger/src/meta/N-name.yaml`) declares the kebab-case slugs of ledger-support (or standalone, for legacy slugs) personas this stage may delegate sub-tasks to. For each slug, `load_subagents()` in `orchestrator/src/utils/subagents.py` resolves:
   - **`description`** — from `personas/ledger-support/src/meta/{slug}.yaml` (falls back to `personas/standalone/src/meta/{slug}.yaml`)
   - **`system_prompt`** — from `personas/ledger-support/deep-agents/{slug}.md` (falls back to `personas/standalone/deep-agents/{slug}.md`)
   - **`name`** — the kebab-case slug itself

   The template engine silently ignores unknown YAML keys, so the `subagents` field has no effect on persona build output. It is not used by `scripts/build-personas.js` for rendering — only for the `{{agent_slug_*}}` cross-reference validation (see [Build System Constraint 9](constraints-build-system.md#b9)).

   **Sync contract:** Every slug declared in the `subagents` field must have a corresponding YAML file (with a `description` field) and a deep-agents file in either `personas/ledger-support/` or `personas/standalone/`. The resolver searches `ledger-support` first, then falls back to `standalone`. Missing files (in both suites) raise `FileNotFoundError`; a missing `description` raises `ValueError`. Currently only the Project Manager carries this field, listing its PM planning sub-agents (all in `ledger-support/`).

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
   - `personas/ledger-support/vs-code/`, `personas/ledger-support/claude-code/`, and `personas/ledger-support/deep-agents/`

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
   | `personas/ledger-support/vs-code/` | Yes | VS Code target output (ledger-support) |
   | `personas/ledger-support/claude-code/` | Yes | Claude Code target output (ledger-support) |
   | `personas/ledger-support/deep-agents/` | Yes | Deep-agents target output (ledger-support) |
   | `personas/ledger/src/meta/` | No | YAML metadata: identity, feature flags, tool lists |
   | `personas/ledger/src/content/` | No | Per-persona body templates |
   | `personas/ledger/src/partials/` | No | Ledger-suite Markdown fragments (override layer; MCP-specific partials live here) |
   | `personas/standalone/src/meta/` | No | YAML metadata for standalone personas (slug-based, no `role`) |
   | `personas/standalone/src/content/` | No | Per-slug body templates |
   | `personas/ledger-support/src/meta/` | No | YAML metadata for ledger-support personas (slug-based, MCP-dependent) |
   | `personas/ledger-support/src/content/` | No | Per-slug body templates (ledger-support) |
   | `personas/shared/partials/` | No | Suite-agnostic shared Markdown fragments (base layer; no MCP content) |

<a name="c3"></a>
4. **Edit → Build → Sync workflow.** After modifying any source file in `src/`, run `node scripts/build-personas.js` (or add `--suite` to target a specific suite and `--target vscode` / `--target claude-code` / `--target deep-agents` for a single target) to regenerate output, then `node scripts/sync-personas.js` to deploy to both VS Code and Claude Code. Use `--suite all` to rebuild all three suites (ledger, standalone, ledger-support) in one pass.

---

## Persona Content Philosophy

<a name="c4"></a>
5. **Persona content must add value the self-documenting tools cannot provide.** The ledger's `next_steps` arrays, `--- NEXT STEP ---` guidance blocks, and Zod parameter descriptions are the runtime source of truth. A persona's job is to provide **identity, methodology, and decision-making framework** — not to duplicate tool documentation. When tool self-documentation already covers a behavior (e.g., wait-action reasons, required parameters), do not restate it in persona content. When persona content enumerates tool parameters or action names, it must match the implementation exactly or defer to the tool descriptions entirely.

<a name="c4a"></a>
5a. **Numbered workflow steps in persona content templates are immutable structural contracts.** When a new phase partial is added to a persona's content template, a corresponding numbered-step entry must be added in the same implementation change — never deferred to a follow-up. An agent following only the numbered steps will silently skip any phase that exists as a partial but has no matching step entry. Before closing a persona-modification PR, cross-check the count of numbered workflow steps against the count of phase partials included in that template to confirm parity. The Documentation pipeline is responsible for catching step/partial count mismatches during its review pass.

<a name="c4b"></a>
5b. **Reference documents stay separate from persona content — never embed.** When a persona always loads an external reference document (e.g., the Persona Curator loads `personas/docs/persona-design-guide.md`), keep the document as a separate file read via tool call at session start. Do not embed reference material into the persona content, even though the effective per-session token cost is the same. Rationale:

   - **Single source of truth.** Reference documents evolve independently. Embedding creates a second copy that can drift from the canonical file without automated detection.
   - **Multiple consumers.** Reference documents serve other agents, human authors, and audit workflows. Embedding does not eliminate the standalone file — it only duplicates it.
   - **Separation of concerns.** Persona content defines identity, methodology, and decision-making framework. Reference documents are consulted knowledge — analogous to config loaded at runtime, not hardcoded into source.
   - **Context efficiency.** A tool-call load enters the conversation at a specific point. Embedded system-prompt content competes for model attention on every turn, including simple follow-ups that do not need the reference.

<a name="c4c"></a>
5c. **Recurring Operating Philosophy principles use their canonical name from the registry below.** The [Persona Design Guide](../../persona-design-guide.md) § "Recurring Principles Across a Persona Suite" defines the naming rules; this registry is the project-local vocabulary those rules operate on. The guide is a distributed document used to curate persona suites in unrelated projects and domains, so the inventory of *this* project's principles belongs here rather than in the guide.

   **Canonical names:**

   | Canonical Name | Meaning | Carried By |
   |---|---|---|
   | **Durable Over Precise** | A statement that stays true across commits beats a precise one that goes stale. Counts, tallies, and inventories are the standard illustration. | AGENTS.md Curator, Manifest Curator, Module Intent Architect, Documentation Curator, README Curator, Unit Test Auditor, CTX Architect |
   | **Every Artefact Earns Its Place** | An artefact justifies the cost it imposes or it does not belong; exhaustiveness is not a virtue. The cost differs by domain — ongoing maintenance for the Workspace Architect, diluted signal for the CTX Architect — but the test is the same. Distinct from the Dependency Curator's **The Smallest Sufficient Move Carries the Least Risk**, which weighs upgrade distance rather than whether a thing earns its keep. | CTX Architect, Workspace Architect |
   | **Stratified Authority** | Command voice earns its weight from scarcity; a document written entirely in directives flattens into noise. | AGENTS.md Curator, Manifest Curator, Persona Curator |
   | **Truth Upstream, Routing Downstream** | One document states a fact; the documents beside it link to that statement rather than repeating it. A copied fact gains a second maintainer and a second decay rate, and a reader meeting both copies cannot tell which is current. Stated for the manifest → `AGENTS.md` direction, where the manifest is upstream. | AGENTS.md Curator |
   | **Findings Travel Further Than Fixes** | A document's correctness is checked past the edge of what its owner may write, because neither a router nor its target can be verified in isolation. The write surface does not widen with the read surface: what is found outside it is routed to the owning agent, never corrected in place. Held by both sides of the manifest / `AGENTS.md` boundary, each reading into the other's file and writing only its own. The Manifest Reviewer is the limiting case — it reads the whole documentation scope with a write surface of zero — but since its 3.0.0 reduction it enforces that through its write restrictions rather than stating the principle, so it is not a carrier. | AGENTS.md Curator, Manifest Curator |
   | **A Claim Is Wrong When Written, Not Only When It Ages** | Drift — code moving under prose that stayed put — is the visible documentation failure. The quieter one is a sentence that was never true, composed from a method name, a call site, or a commit message rather than the statement it describes. Stated for the writing side by the Manifest Curator; the Manifest Reviewer states the verification-side consequence as **A Claim Is Guilty Until Its Source Says Otherwise**, and the two stay split because one governs how a fact is composed and the other how it is tested. | Manifest Curator (writing side), Manifest Reviewer (verification side, under its own name) |
   | **New Prose Is the Least Verified Prose** | A correction carries a reviewer's finding behind it; the prose written around it has been read by nobody and looks equally authoritative. The newest material in a document is its highest-risk material. The same claim applied to a review's priority list is the *Ordering* rule in `personas/shared/partials/manifest-claim-verification.md`, which puts previously corrected facts last; the Manifest Reviewer stated it as a principle named **The Last Reviewer's List Is the Least Productive Place to Look** until its 3.0.0 reduction and now relies on that shared ordering alone. | Manifest Curator |
   | **An Adjective Is a Claim** | A qualifier is a verifiable assertion, and the ones that go unverified are those a rewrite introduced after research closed — *atomic*, *unified*, *seamless*, *all*, *only*. Deliberately narrower than **New Prose Is the Least Verified Prose**, which covers any newly written sentence: this one names the single word class that enters during polishing, which is why the README Curator carries it as its own principle rather than inheriting the general claim. Not to be conflated with **Durable Over Precise**, which concerns figures that decay rather than words that were never sourced. | README Curator |
   | **A Few Right Files Beat Many** | Targeted reading of the files where a question actually turns beats a wide sweep of the repository. The Sequencer applies it to candidate dependency pairs, the WP Decomposer to uncertain WP boundaries, the Pipeline Configurator to the symbols a narrowed stage chain depends on — same claim, different unit of uncertainty. | Ledger Dependency Sequencer, Ledger WP Decomposer, Ledger Pipeline Configurator |
   | **The Upstream Stage Already Looked** | Codebase facts recorded by an earlier pipeline stage are findings, not guesses, and re-deriving them spends the session twice. Deliberately named for the *relationship* rather than the specific predecessor: the Sequencer inherits the WP Decomposer's Code Observations, the WP Decomposer inherits the Planner's research brief, the Pipeline Configurator inherits both. A per-predecessor name ("The Decomposer Already Looked") forks on every new consumer. | Ledger Dependency Sequencer, Ledger WP Decomposer, Ledger Pipeline Configurator |
   | **A Missing Stage Costs More Than an Extra One** | Where two error directions have unequal cost, the cheap error is the correct default under uncertainty. Stated for pipeline stages: a redundant stage costs one run, a missing one ships a defect nothing downstream catches. Related to the Sequencer's **A Wrong Edge Costs More Than a Missing One**, which is the same asymmetry argument in the opposite direction for its own domain — both stay split, since unifying them would assert that the cheap error is the same error in both. | Ledger Pipeline Configurator |
   | **The Acceptance Criteria Decide, Not the Title** | A work item's declared label is not evidence of what it does; its deliverables and acceptance criteria are. | Ledger Pipeline Configurator |
   | **Exploitability Outranks Category**, **A Passing Test Says Nothing About Safety**, **The Absent Control Is the Common Defect**, **Untrusted Until Validated** | The Security Auditor philosophy. Registered on first appearance rather than second, since a security suite is the likeliest place for a near-synonym to be coined independently ("Reachability Decides", "Validate at the Boundary"). **A Passing Test Says Nothing About Safety** is deliberately the *auditor's* claim about QA's scope, not a claim about test quality — the QA persona may not adopt it. | Security Auditor (ledger) |
   | **Context Completes the Insight** | A knowledge entry that cannot be acted on without its originating project has not carried its context. The Archiver applies it when deciding what narrative to commit; the Curator applies it when deciding whether a surviving entry still carries enough — same claim, opposite ends of an entry's life. The *type* of context differs by scope in both: class-of-problem framing for `global`, concrete identifiers for `repository`. | Ledger Knowledge Archiver, Ledger Knowledge Curator |
   | **The 30-Second Rule** | A reader reaches orientation within half a minute; anything slower belongs in a deeper document. | AGENTS.md Curator, Module Intent Architect |
   | **Long-Term Stability Over Expediency** | The solution that serves the codebase as it grows is worth more than the fastest one to write now. The Developer applies it to implementation choices, the Reviewer to review findings — same claim, opposite ends of the same code. | `personas/shared/partials/developer-philosophy.md` (Developer, both suites); Reviewer (ledger) — inline, own illustration |
   | **Growth Is the Default**, **Completeness Over Deferral**, **The Practitioner's Eye** | The shared Developer philosophy. | `personas/shared/partials/developer-philosophy.md` — rendered by both the ledger and standalone Developer personas; never duplicated inline |
   | **Growth Is the Default**, **Completeness Over Deferral**, **Long-Term Stability Over Expediency** | The shared Planner philosophy. Same three canonical names as the Developer philosophy above, stated for the planning domain (a plan step rather than a class) — the two partials carry different bodies under the same names, which is the guide's "bodies are authored, not copied" rule applied across suites. | `personas/shared/partials/planner-philosophy.md` — rendered by both the ledger and standalone Planner personas; never duplicated inline |
   | **Refactoring Is Always on the Table**, **Adjacent Improvement Is the Only Improvement** | Planner-only by design. Reshaping scope and adjacent improvements are decided *in the plan*, never during implementation — the Developer's scope table deliberately excludes refactoring campaigns and routes anything it notices into observations, which feed a rework plan. Adding either principle to a Developer persona would break that division of labour. | `personas/shared/partials/planner-philosophy.md` — must **not** be extended to the Developer personas |

   **Known collisions — deliberately not unified:**

   | Name | Why it stays split |
   |---|---|
   | **Quality Over Quantity** | The two knowledge personas (Archiver, Curator) mean a sparse knowledge base outperforms a dense one — one meaning, shared, and canonical between them. The Recipe Curator means fewer, better ingredients. That second meaning is coincidence, not a shared principle — unifying it with the knowledge sense would assert a relationship that does not exist. The Recipe Curator may not reference the knowledge meaning, nor the knowledge personas the ingredient one. |

   A principle appearing in a second persona is added to this registry at that point, which is what keeps its name from forking. Renaming a registered principle requires updating every persona listed against it in the same change.

<a name="c4d"></a>
5d. **Published artifacts carry no project-specific content.** Some files in this repository are consumed by unrelated downstream projects, which fetch them over HTTPS and overwrite their local copy on every sync. AI-Insights-specific content added to one of them ships to every consumer, and they cannot remove it — the next sync restores it.

   **Published artifacts:**

   | Artifact | How to recognise it | Downstream consumption |
   |---|---|---|
   | `personas/docs/persona-design-guide.md` | `**License:**` / `**Author:**` / `**Source:**` header block | Fetched by `nexus-personas` (`scripts/sync-persona-design-guide.js`, plus a scheduled Gitea Actions workflow); local copies also exist in `hcp-editor` and `nexus-plugins` |
   | `personas/standalone/src/content/persona-curator.md` | Consumed as source by downstream builds | Fetched by the same sync script; downstream treats its local copy as read-only under a MUST-level constraint |

   **Rules:**

   - **The guide is domain-neutral.** Downstream suites cover non-coding domains — recipes, content curation, research. A rule stated in the guide holds for any persona suite; an inventory, a file path under `personas/ledger/`, or a reference to this workspace's tooling does not belong there. Project-specific vocabulary and conventions go into this constraints document instead, as C5c does.
   - **The Persona Curator degrades gracefully.** Instructions in the Curator reference project infrastructure conditionally ("where the project maintains a registry…"), never unconditionally. A step that assumes this workspace's layout is a step that misfires in every downstream project.
   - **One section heading is a hard downstream contract; the rest are unverified.** `nexus-personas` injects a partial into `persona-curator.md` by anchoring on the literal string `\n\n## Operating Philosophy\n`, and its sync throws a hard error when the anchor is missing. That heading is load-bearing and must not be renamed or removed. Other top-level headings in either file have no *known* consumer, but downstream projects are not fully surveyed — so flag a proposed rename for the user and let them confirm, rather than either applying it silently or refusing it outright. Adding a heading and reordering existing ones are both safe. (`## Strict Constraints` → `## Core Rules` was renamed in the Curator on 2026-08-26 after the user confirmed no consumer.)
   - **Version and changelog are the sync signal.** Both files carry a version and changelog block that downstream consumers read to detect drift. Content changes bump the guide's version in the same change.

   > **Why this needs stating:** these files look exactly like ordinary project documentation from inside the workspace — same directory, same Markdown, same Git history. The only in-file signal is the header block, which is easy to read past. When in doubt, check whether the file appears in the table above.

<a name="c4e"></a>
5e. **This project's persona layout is not the layout the Persona Curator can assume.** Because `persona-curator.md` is published (C5d), it describes persona work in role terms — "the project's copy of the guide", "the persona's metadata file", "per-target output directories" — rather than naming paths. Downstream consumers use a flat `personas/src/` + `personas/meta/` layout with no suite subdivision and different target directories, so a hardcoded path in that file is wrong everywhere except here.

   The concrete values for **this** workspace:

   | Concept (as the Curator names it) | This project's path |
   |---|---|
   | The project's copy of the Design Guide | `personas/docs/persona-design-guide.md` — the first entry in the Curator's lookup order, so no search is needed here. The filename is invariant across projects; only the directory varies (downstream consumers use `docs/persona-design-guide.md`). Moving this file requires updating that lookup order, since it would otherwise fall through to the search fallback. |
   | Persona source content files | `personas/ledger/src/content/`, `personas/standalone/src/content/`, `personas/ledger-support/src/content/` |
   | Persona metadata files | `personas/{suite}/src/meta/` (see [C2a](#c2a) for the full directory table) |
   | Per-target generated output | `personas/{suite}/vs-code/`, `personas/{suite}/claude-code/`, `personas/{suite}/deep-agents/` — never edited ([C1](#c1)) |
   | Metadata fields for a new persona | `slug`, `name`, `description`, `id`, `vs_file_name`, `cc_file_name`, `tools`, `changelog` (see [C11](#c11)–[C15](#c15) for naming rules) |
   | The project's persona changelog | `personas/changelog.md` |
   | The persona build command | `node scripts/build-personas.js` ([C3](#c3) covers the full edit → build → sync workflow) |

   An agent operating the Curator inside this workspace resolves the role terms against this table. An agent editing the Curator keeps the role terms in place — adding a path back into that file re-breaks every downstream consumer.

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
14. **The `standalone` suite's `_shared.yaml` must not contain `mcp_server_name` or `roster`.** Standalone personas are fully independent tools — they have no workflow roster and no MCP server dependency. Do not add these fields to `personas/standalone/src/meta/_shared.yaml`.

   The `ledger-support` suite's `_shared.yaml` **does** contain `mcp_server_name: central_pm` by design — all ledger-support personas depend on the `central_pm` MCP server. This is intentional and correct for that suite.

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
   - **New ledger-support personas**: `id` must follow `ledger-support-{slug}` — e.g. `slug: my-new-tool` → `id: ledger-support-my-new-tool`.
   - **Migrated ledger-support personas**: The 9 personas moved from `standalone/` to `ledger-support/` retain their `standalone-*` id prefix permanently (e.g., `id: standalone-ledger-bootstrapper`). This is a historical artifact — changing these ids would break VS Code `@id` routing for all users who have these agents installed.

   > ⚠️ **`standalone-*` namespace is CLOSED to new personas.** The `standalone-*` id prefix is **permanently reserved** for those 9 historically migrated personas only. **Never assign a `standalone-{slug}` id to any new ledger-support persona** — even when the slug itself begins with "standalone-". All new ledger-support personas must use the `ledger-support-{slug}` prefix without exception.

   - **Format constraints**: lowercase only, no spaces, no special characters except hyphens.
   - **Stability**: `id` values must never change once published — they are the routing key used by VS Code `@id` subagent routing. Version bumps, renames, or persona reordering must not alter the `id`.
   - **Uniqueness**: `id` values must be globally unique across all custom agents in the user's VS Code instance. The `ledger-`, `standalone-`, and `ledger-support-` namespace prefixes isolate these personas from each other and from any third-party agents the user may have installed.
   - **Claude Code output is unaffected**: `id:` is only added to `FRONTMATTER_LEDGER_VSCODE` and `FRONTMATTER_STANDALONE_VSCODE`. The Claude Code frontmatter templates (`FRONTMATTER_LEDGER_CC`, `FRONTMATTER_STANDALONE_CC`) do not include `id:` — Claude Code uses name-derivation routing, not `@id` routing.

<a name="c25"></a>
20. **`default_version` in `_shared.yaml` is the suite-wide version fallback.** It applies to all personas that have no `changelog:` block scalar in their per-persona YAML. When a persona's `changelog:` field contains a parseable semver entry, the build system derives `version` from that entry and `default_version` is not used for that persona. This follows the standard `default_X` + per-persona override pattern used throughout the build system.

<a name="c25a"></a>
20a. **`changelog:` is the sole version source for per-persona metadata — never add standalone `version:` or `last_updated:` fields.** Each per-persona YAML uses a `changelog:` block scalar as its authoritative version record. The required format is one entry per line, most recent first, in `X.Y.Z (YYYY-MM-DD): description` form:

   ```yaml
   changelog: |
     1.0.0 (2026-06-13): Initial release
   ```

   The build system automatically derives the `version` context variable from the first version token and `last_updated` from the first date token. **Never add standalone `version:` or `last_updated:` YAML fields to any persona** — they are not read by the build system and create misleading redundancy. Use `default_version` in `_shared.yaml` only as a fallback for personas that have no `changelog:` entry yet.

<a name="c26"></a>
21. **`default_model` in `_shared.yaml` applies to all personas** unless overridden per-persona via the `model` field. This follows the same `default_X` + per-persona override pattern as `default_version` / `version`.

<a name="c26a"></a>
21a. **`default_model_slug` in `_shared.yaml` applies to all ledger personas** unless overridden per-persona via the `model_slug` field. This follows the identical `default_X` + per-persona override pattern as `default_model` / `model`. The slug is an API-compatible identifier used by the orchestrator to route calls to the correct model endpoint (e.g. `"claude-sonnet-4-6"`). It is **not** rendered into generated frontmatter templates — it is consumed directly from YAML source by the orchestrator.

<a name="c26b"></a>
21b. **Model registry assignments take precedence over YAML model fields.** The GUI-managed model registry (`personas/model-registry/`) adds a higher-priority layer above the YAML-based model fields. The full model resolution priority chain for the effective model slug consumed at runtime is:

   1. **Per-persona GUI assignment** — `assignments.json` → `persona_models[persona.id]`, resolved to a slug via `getResolvedAssignments()` in `mcp-server/src/gui/model-registry.ts`.
   2. **Workspace-default GUI assignment** — `assignments.json` → `default_model_uuid`, resolved to a slug.
   3. **Per-persona YAML override** — `model_slug` field in the persona's `N-*.yaml` file.
   4. **Suite default** — `_shared.yaml` → `default_model_slug`.

   The persona `id` field is the stable key used in `assignments.json`. Assignments survive persona renames and slug changes because they are keyed by UUID, not by slug. The build system and orchestrator resolve this chain locally at startup; the GUI surfaces resolved slugs via `GET /api/personas`. Do not read YAML model fields to determine the effective model when GUI assignments may be active.

<a name="c27"></a>
22. **`cc_model` resolution chain:** The Claude Code `model` frontmatter value is resolved in Layer 3 as: `persona.cc_model → persona.model → _shared.default_model → _shared.cc_model`. This means a per-persona `cc_model` takes highest priority, followed by the persona's VS Code `model` override, then the shared default model, and finally the shared `cc_model` value (typically `"inherit"`).

<a name="c28"></a>
23. **`default_version` is required in all `_shared.yaml` files.** Its absence is a **fatal build error** — the library emits `[ERROR] Missing 'default_version' in <suite>/_shared.yaml` and exits with code 1. Without this field, the generated output would contain the string `"undefined"` as the version, a silent corruption that is hard to detect post-build. This check applies to both suites (ledger, standalone).

<a name="c29"></a>
<a name="c48"></a>
24. **`mcp_server_name` in `_shared.yaml` controls the MCP server reference** everywhere in generated output and must match the server key used by `scripts/install-mcp-global.js` (default: `central_pm`). If the server name changes, update this field, rebuild personas, and update `install-mcp-global.js` — see the Cross-System Dependencies table in `AGENTS.md`.

   > **Shadowing risk:** Per-persona YAML fields shadow shared YAML values via the object spread in the build context. If `mcp_server_name` changes globally, update **both** `personas/ledger/src/meta/_shared.yaml` and `personas/ledger-support/src/meta/_shared.yaml`. The `standalone` suite has no `mcp_server_name` in its `_shared.yaml` (see [constraint 14](#c19)) and none of its personas should hardcode it.

<a name="c49"></a>
25. **Every persona change requires a version bump, date update, and changelog entry.** When any persona source file is modified (YAML metadata in `src/meta/`, content template in `src/content/`, or a partial in `src/partials/` that affects generated output), the agent performing the change **must** complete all three steps before finishing:
   1. **Update the `changelog:` block scalar** in the persona's YAML metadata file. Prepend a new entry in `X.Y.Z (YYYY-MM-DD): description` format. The build system derives both `version` and `last_updated` from this field automatically — do **not** add or update standalone `version:` or `last_updated:` fields. Follow SemVer: patch for wording/formatting fixes, minor for behavioral or structural changes, major for breaking changes.
   2. **Add an entry to `personas/changelog.md`** under a new or existing version heading, following the established house style (flat bullet list with category prefix, ≤ 100-char lines).

   > **Suite-wide changes:** If a single change affects multiple personas (e.g., editing a shared partial), update each affected persona's `changelog:` field individually and document all of them in one `personas/changelog.md` entry. For changes affecting every persona in a suite, prefer bumping `default_version` in `_shared.yaml` with a dated entry rather than updating every YAML file individually.

   Omitting any of these steps is a defect — downstream agents and the pre-commit freshness guard depend on accurate version metadata in the `changelog:` field.

---

## Audit Tracking

<a name="c50a"></a>
25a. **`audit_guide_version` and `audit_date` track design guide compliance.** Two optional YAML metadata fields record whether a persona has been audited against the Persona Design Guide:

   ```yaml
   audit_guide_version: "2.8"
   audit_date: "2026-08-25"
   ```

   - **`audit_guide_version`** — the version of the Persona Design Guide the persona was last audited against. Set by the Persona Curator on a PASS verdict.
   - **`audit_date`** — the date the audit was performed. Set alongside `audit_guide_version`.
   - **Not set on NEEDS WORK** — personas that fail audit retain their previous values (or none) until fixes are applied and the persona is re-audited.
   - **Consumed by `scripts/generate-persona-audit.js`** — the audit tracking script reads these fields to auto-derive status: current (matches the latest guide version), stale (audited against an older version), or unaudited (fields absent).
   - **Not consumed by the build system** — these fields are silently ignored by the template engine and have no effect on generated output.
   - **Process state does not belong here.** These two fields are facts about the persona. Facts about the *audit process* — "paired audit with twin", "tone fix only" — go in `personas/docs/audits/annotations.json` instead, keyed by suite and persona YAML stem. The two have different lifecycles, and mixing them puts editorial commentary into build-input metadata.
   - **The audit record lives in `personas/docs/audits/`**, split three ways: `status.md` (fully generated — never hand-edit), `notes.md` (hand-written narrative, cumulative), and `annotations.json` (Notes-column text). See that folder's `README.md`.

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

---

## Overview Metadata Requirements

<a name="c54"></a>
32. **`identity` is required in every persona YAML.** All personas across all three suites (ledger, standalone, ledger-support) must have a top-level `identity:` field whose value matches the role title in the `**Identity: {{identity}}.**` mission header. This field is the single source of truth for the persona's role label and is used by `scripts/generate-agents-overview.js`.

<a name="c55"></a>
33. **Overview metadata fields must be kept current.** When a persona's purpose, behavior, or operating modes change, update the corresponding YAML fields: `use_when` (standalone/support), `key_behavior` (all suites), `modes` (personas with distinct modes), `inputs`/`outputs` (ledger personas), `notes` (optional freeform). After modifying any overview field, run `node scripts/generate-agents-overview.js` (or `node scripts/cli.js build-maintain`) to regenerate `docs/agents-overview.md`.

<a name="c56"></a>
34. **Do not edit `docs/agents-overview.md` manually.** The file is generated by `scripts/generate-agents-overview.js` from persona YAML metadata. Manual edits will be overwritten on the next generation run. The generated-by comment at the top of the file marks it as auto-generated. To change overview content, update the persona YAML fields or the header template at `scripts/templates/agents-overview-header.md`.

---

## Insight Capture Constraints

<a name="c57"></a>
35. **`insight-capture.md`, `insight-compilation.md`, and `mcp-insight-capture.md` are parameterised shared partials.** They live in `personas/shared/partials/` and follow the same structural precedent as `ax-feedback.md`: short, suite-agnostic behavioural fragments. Ledger personas (agents 3–6, 8) use `mcp-insight-capture.md` (parameterised by `{{insight_pipeline_type}}`), which routes observations through `ledger_add_observation`. Standalone personas use `insight-capture.md` and `insight-compilation.md` (parameterised by `{{insight_agent}}` and `{{insight_report_target}}`), which route through the `insights.jsonl` sidecar.

<a name="c58"></a>
36. **Metadata pairing rules.** For standalone personas: `insight_agent` and `insight_report_target` must be declared as a pair; standalone personas (no `role`) are exempt from the identity check. For ledger personas: `insight_pipeline_type` must match the persona's pipeline type from `PIPELINE_AGENT_MAP`.

<a name="c59"></a>
37. **Verdict-affecting findings must never be routed through observation channels.** Findings that determine a PASS/FAIL verdict (e.g., the Security Auditor's `vulnerability` and `risk` types, the Reviewer's blocking findings) must go through their normal findings channel only. Observation channels (MCP or sidecar) carry only non-blocking observations.

<a name="c60"></a>
38. **A capture partial must always be accompanied by an action gate.** Placing `{{> insight-capture}}` or `{{> mcp-insight-capture}}` in the observation section alone makes the capture described but never triggered. Each consuming persona must also bind an explicit capture instruction to a concrete step of its Operational Protocol — without this, the partial delivers end-of-session reconstruction, not incremental capture.

```
###  Path: `/personas/docs/agents/project-manifest/curation-log.md`

```md
# Curation Log

Why this manifest looks the way it does, and when it was last verified.
Read freely — Standing Decisions explains the deliberate gaps and conventions.
Written by the Manifest Curator only; no other agent edits this file.

## Standing Decisions

| Date | Decision | Rationale |
|---|---|---|
| — | — | None settled with the user yet. |

## History

### 2026-09-02 · Update · Curator v1.4.1

**Scope:** All 14 discrepancies from the 2026-09-02 audit — `README.md`, `tech-stack.md`, `api-surface.md`, `file-tree.md`, `constraints-build-system.md`, `variables.md`. `data-flows.md`, `constraints.md`, and `constraints-cross-system.md` needed no changes (audit found none).
**Changes:**
- `README.md` — rewrote Overview and Quick Reference to describe all three suites (ledger, standalone, ledger-support) and all three targets (vscode, claude-code, deep-agents); removed the hand-maintained Version/Last Updated header; added a Curation Log row to the Manifest Sections table.
- `tech-stack.md` — moved `@mistralys/persona-builder` into the Production table (it is a `personas/package.json` dependency, not a workspace-root devDependency) and corrected its version to `^2.6.0`.
- `api-surface.md` — fixed the Planner's `has_mcp` flag (was `—`, is `✓`); corrected the `FRONTMATTER_STANDALONE_VSCODE` template (`name` now shows `v{{version}}` appended, `last_updated` now shows its `{{#if}}` guard) and the matching Metadata Field Map row; added a Key Derivation Rules bullet documenting the `name`/`version` composition.
- `file-tree.md` — full rewrite of the `personas/` tree: added the `ledger-support/` suite, `model-registry/`, `name-mapping.json`, all three suites' `deep-agents/` output dirs, `docs/audits/` and the other `docs/*.md` files, `variables.md` and `curation-log.md` in the manifest's own doc list, and `handoff-block-manual.md`; replaced the entirely-wrong `shared/partials/` listing with the real 22-file set; added a header note pointing to `.context/personas/file-structure.md` as the drift-proof source for pure structure.
- `constraints-build-system.md` — rewrote item 2: nested `{{#if}}` inside an `{{else}}` branch (and `{{else if}}` chains) are supported and required for three-target content; only nesting inside a truthy branch with no `{{else}}` is unsupported. Marked item 10's version-lag callout resolved now that `personas/package.json` pins `^2.6.0`.
- `variables.md` — corrected the `{{name}}` (standalone) example to the plain form, noting the template appends the version.

**Notes:** Per the prior audit's recommendation, `file-tree.md` and `README.md` were rewritten wholesale rather than patched piecemeal. `personas/README.md`'s stale `--suite` flag reference was left untouched — it is a sibling doc, not this manifest, and was routed to Documentation (Standalone) in the audit report rather than corrected here.

### 2026-09-02 · Audit · Curator v1.4.1

**Scope:** Whole manifest — `README.md`, `tech-stack.md`, `api-surface.md`, `data-flows.md`, `file-tree.md`, `constraints.md`, `constraints-build-system.md`, `constraints-cross-system.md`, `variables.md`.
**Changes:** None — audit only. This is the manifest's first recorded curation pass; no prior log existed.
**Findings:** 6 high, 6 medium, 2 low. See [audit-report-2026-09-02.md](audit-report-2026-09-02.md). Highlights: `README.md`/`file-tree.md` still describe a two-suite, two-target system (the codebase now has three of each); `constraints-build-system.md` item 2 claims nested `{{#if}}` is unsupported, contradicted by the live engine and by three other documents in this same manifest.

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
  │  ledger-support + vscode:                │
  │    personas/ledger-support/vs-code/      │
  │  ledger-support + claude-code:           │
  │    personas/ledger-support/claude-code/  │
  │  ledger-support + deep-agents:           │
  │    personas/ledger-support/deep-agents/  │
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
  │ 1. Build (child process) │  Spawns: node scripts/build-personas.js --suite ledger,standalone,ledger-support [--target] [--dry-run]
  │                          │  Always rebuilds all three suites (ledger, standalone, ledger-support) before syncing.
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

### Agent 1 (Planner) — Shared With the Standalone Twin

Agent 1 has no handoff-block partial and no incident logging — it prints its handoff verbatim and produces a plan document rather than driving the ledger. It does use the MCP pre-flight header partials, since it calls `ledger_get_repository_context` and `ledger_search_insights` for strategic context.

Beyond `{{> agent-roster}}`, Agent 1 shares six `planner-*` partials with the standalone Planner. The two personas are the same role under two deployment contexts, so the shared blocks live in `personas/shared/partials/` and each persona contributes only its genuine divergences:

```
content/1-planner.md                      content/planner.md  (standalone)
│                                         │
├── {{> agent-roster}}                    │   (ledger only — no roster in standalone)
├── {{> planner-philosophy}} ───────────── ┤   identical
├── {{> planner-operating-modes}} ──────── ┤   identical
├── … MCP tools table + pre-flight …      │   (ledger only — has_mcp: true)
├── {{> planner-research-brief-template}}─ ┤   {{#if has_mcp}} gates ## Strategic Context
├── {{> planner-output-template}} ──────── ┤   {{#if has_ledger_workflow}} gates
│                                         │     ## Plan Audit Cycles, ## Recommended Workflow
│                                         │   {{#if has_mcp}} gates ## Prior Project Context
├── … Rework Handling (own text) …        │   (standalone omits the audit-counter step)
├── {{> planner-core-rules}} ───────────── ┤   {{planner_implementer_ref}} differs
├── {{> planner-quality-checklist}} ────── ┤   identical
└── … Workflow (own text) …               │   (differs: MCP steps, workflow assessment)
```

The four genuine divergences are the agent roster, the MCP block, the ledger-gated plan sections, and the handoff status (`READY_FOR_PM` + `RECOMMENDED_WORKFLOW` vs. `COMPLETE`). Everything else is shared. A change to planning methodology belongs in the partial, not in either persona.

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

---

## 5. Persona Audit Process

Periodic compliance checks ensure all personas conform to the current Persona Design Guide. The process combines a generator script with the Persona Curator agent.

### Lifecycle

```
  Guide updated (new version)
       │
       ▼
  node scripts/generate-persona-audit.js
       │  reads: all personas/*/src/meta/*.yaml
       │  reads: all personas/*/src/content/*.md (composition tier)
       │  reads: personas/docs/persona-design-guide.md (version + changelog)
       │  reads: personas/docs/audits/annotations.json (Notes column)
       │  derives: guide version at each persona's last-updated date
       │  derives: audit status from audit_guide_version vs current guide
       │  derives: tier from partial + conditional counts in source
       ▼
  personas/docs/audits/status.md  (fully generated)
       │  sorted oldest-first per suite
       │  columns: Version, Last Updated, Guide, Audited, Tier, Status, Notes
       ▼
  Persona Curator (Audit mode)
       │  reads: persona-design-guide.md
       │  reads: personas/*/src/content/<persona>.md
       │  evaluates: Quality Checklist compliance
       ▼
  ┌─── Verdict ───┐
  │               │
  PASS        NEEDS WORK
  │               │
  │               ▼
  │          Fix issues (Maintain mode)
  │               │
  │               ▼
  │          Re-audit
  │               │
  ▼               │
  Stamp YAML  ◄───┘
  │  audit_guide_version: "{GUIDE_VERSION}"
  │  audit_date: "YYYY-MM-DD"
  │  changelog: prepend version bump entry
  ▼
  Regenerate tracking doc
       │  node scripts/generate-persona-audit.js
       ▼
  Summary shows updated Current / Stale / Unaudited counts
```

### File Layout

The audit record lives in `personas/docs/audits/`, split by who writes it:

| File | Written by | Contents |
|---|---|---|
| `status.md` | Generator | Per-persona tracking table. Regenerated wholesale — never hand-edit. |
| `notes.md` | Hand | Audit methodology, generalising findings, roll-forward reasoning. Cumulative. |
| `annotations.json` | Hand | Notes-column text keyed by suite + persona YAML stem. Missing key → empty cell. |

The split exists because `status.md` is derived entirely from YAML and source composition,
so anything hand-written inside it is lost on the next run.

### Tier Derivation

Tier is computed from each persona's content file, not stored in YAML:

| Condition | Tier | Meaning |
|---|---|---|
| No `{{> partial}}` and no `{{#if}}` / `{{#unless}}` | `A` | Rendered output is the source plus frontmatter; design guide v3.3's rendered-output requirement does not apply. |
| Otherwise | `B (Np/Mc)` | N partials, M conditionals — the assembled document must be read to be verified. |

Because it is derived, a persona that gains its first partial flips A → B automatically,
surfacing that its existing audit stamp no longer covers everything the guide requires.

### Status Derivation

The script reads `audit_guide_version` from each persona's YAML metadata and compares it against the current guide version:

| `audit_guide_version` | Current Guide | Derived Status |
|---|---|---|
| absent | any | Unaudited |
| matches current | e.g. `"2.8"` = `"2.8"` | Current (PASS) |
| older version | e.g. `"2.5"` < `"2.8"` | Stale — re-audit needed |

### CLI

```bash
# Write personas/docs/audits/status.md (default)
node scripts/generate-persona-audit.js

# Preview without writing
node scripts/generate-persona-audit.js --stdout

# Write elsewhere
node scripts/generate-persona-audit.js -o /tmp/audit-preview.md

# Override guide version label
node scripts/generate-persona-audit.js --guide-version 3.0
```

Also available via `node scripts/cli.js generate-persona-audit`.

```
###  Path: `/personas/docs/agents/project-manifest/file-tree.md`

```md
# File Tree — Ledger Personas Build System

Annotated directory structure for the persona build system. Auto-generated files (output of the build) are marked with `[generated]`.

> For structural navigation, prefer the auto-generated `.context/personas/file-structure.md` (see [constraints.md §C2a](constraints.md#c2a)) — it is regenerated from the live filesystem and cannot drift. This document is a curated, annotated overview: it explains *why* directories exist and marks generated vs. hand-authored content, which the auto-generated tree does not.

---

## `personas/` — Build System Root

```
personas/
├── README.md                          # Overview and quick-start guide
├── changelog.md                       # Version history; version synced to package.json by build-personas.js
├── package.json                       # Package metadata; version field kept in sync with changelog.md
├── package-lock.json
├── module-context.yaml
├── name-mapping.json                  # [generated] Per-persona agent-name lookup; regenerated on every real build
│
├── persona-build.config.js            # ← Build configuration for @mistralys/persona-builder
│                                      #   Declares suites (ledger, standalone, ledger-support), output dirs, and plugins
│
├── docs/
│   ├── persona-design-guide.md        # Persona Design Guide — published artifact, see constraints.md §C5d
│   ├── persona-anchoring.md
│   ├── persona-build-system.md
│   ├── audits/                        # Persona Design Guide compliance tracking — see data-flows.md §5
│   │   ├── README.md
│   │   ├── status.md                  # [generated] Per-persona tracking table — never hand-edit
│   │   ├── notes.md                   # Hand-written audit methodology and findings, cumulative
│   │   └── annotations.json           # Hand-written Notes-column text, keyed by suite + persona stem
│   └── agents/
│       └── project-manifest/
│           ├── README.md              # Manifest hub — links to all sub-documents
│           ├── tech-stack.md          # Runtime, dependencies, build tools, patterns
│           ├── api-surface.md         # CLI interface, config shape, template syntax, metadata schema
│           ├── variables.md           # Template variable reference
│           ├── data-flows.md          # Build pipeline, sync pipeline, template resolution
│           ├── constraints.md         # Core editing and naming rules
│           ├── constraints-build-system.md   # Template engine constraints and build flags
│           ├── constraints-cross-system.md   # Sync contracts with MCP server and Agent Registry
│           ├── file-tree.md           # This document
│           └── curation-log.md        # Standing decisions and curation history for this manifest
│
├── model-registry/                    # File-based model registry — see constraints.md §C26b
│   ├── README.md                      # Schema, seed/working-copy lifecycle, and UUID convention
│   ├── default.json                   # Shipped seed models (tracked in Git)
│   ├── local.json                     # User-registered models (gitignored, auto-created)
│   └── assignments.json               # Per-persona model assignments, keyed by persona `id` (gitignored, auto-created)
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
│   │   ├── content/                   # 1-planner.md … 9-synthesis.md
│   │   └── partials/                  # Suite-specific partials (override shared/partials/)
│   │       ├── handoff-block-claude-code.md
│   │       ├── handoff-block-manual.md
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
│   ├── claude-code/                   # [generated] Claude Code persona files (.md)
│   └── deep-agents/                   # [generated] Deep Agents persona files (.md)
│
├── standalone/                        # Standalone suite — special-purpose personas
│   ├── README.md
│   ├── src/                           # Source templates (hand-edited)
│   │   ├── meta/                      # Per-persona YAML files (slug.yaml)
│   │   └── content/                   # Per-persona content templates (slug.md)
│   ├── vs-code/                       # [generated] VS Code persona files (.agent.md)
│   ├── claude-code/                   # [generated] Claude Code persona files (.md)
│   └── deep-agents/                   # [generated] Deep Agents persona files (.md)
│
├── ledger-support/                    # Ledger-support suite — MCP-dependent utility sub-agent personas
│   ├── README.md
│   ├── src/                           # Source templates (hand-edited)
│   │   ├── meta/                      # Per-persona YAML files (slug.yaml); _shared.yaml sets mcp_server_name
│   │   └── content/                   # Per-persona content templates (slug.md)
│   ├── vs-code/                       # [generated] VS Code persona files (.agent.md)
│   ├── claude-code/                   # [generated] Claude Code persona files (.md)
│   └── deep-agents/                   # [generated] Deep Agents persona files (.md)
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
        ├── ax-feedback.md
        ├── developer-dual-role.md
        ├── developer-philosophy.md
        ├── incident-logging.md
        ├── insight-capture.md
        ├── insight-compilation.md
        ├── insight-observer-intro.md
        ├── insight-reporting-rules.md
        ├── insight-scope-and-types.md
        ├── knowledge-ownership.md
        ├── mcp-insight-capture.md
        ├── no-stale-counts.md
        ├── planner-core-rules.md
        ├── planner-operating-modes.md
        ├── planner-output-template.md
        ├── planner-philosophy.md
        ├── planner-quality-checklist.md
        ├── planner-research-brief-template.md
        ├── pm-subagent-roster.md
        ├── research-brief-protocol.md
        └── summary-crafting-guide.md
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

### Production (`personas/package.json`)

| Package | Version | Purpose |
|---------|---------|---------|
| `js-yaml` | ^4.1.0 | Parse YAML metadata files (`_shared.yaml`, per-persona YAMLs) |
| `@mistralys/persona-builder` | ^2.6.0 | Library that owns all persona build logic — template engine, partial resolution, conditional processing, and variable interpolation. Invoked by `build-personas.js` via its CLI binary. |

### Workspace-level Dependencies

| Package | Version | Scope | Purpose |
|---------|---------|-------|---------|
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
###  Path: `/personas/docs/agents/project-manifest/variables.md`

```md
# Template Variables Reference

Complete reference of all variables available in persona content templates (`personas/<suite>/src/content/*.md`). Variables are substituted via `{{variableName}}` syntax during the build pipeline's `resolveVariables()` phase.

---

## Context Merge Order

Variables are assembled in priority order — later layers override earlier ones:

| Layer | Source | Description |
|-------|--------|-------------|
| 1 | `_shared.yaml` | Suite-wide defaults (author, version, MCP server name, etc.) |
| 2 | Per-persona YAML (`N-name.yaml` / `slug.yaml`) | All fields from the persona's metadata file |
| 3 | Derived fields | Computed by `buildContext()` at build time (see below) |
| 4 | Cross-suite agent map | `agent_<slug>` and `agent_slug_<slug>` keys for all personas |
| 5 | Plugin hooks (`onBuildContext`) | Plugin-injected variables (e.g. ledgerPlugin) |
| 6 | Target flags | `target_vscode`, `target_claude_code`, `target_deep_agents` — always highest priority |

> **Override rule:** Explicit YAML values always win over computed defaults. Computed fields are only set when not already present in the merged context.

---

## YAML Pass-Through Variables

Any field in `_shared.yaml` or a per-persona YAML is available as `{{field_name}}` in templates. The most commonly used pass-through variables are listed below.

### From `_shared.yaml` (Ledger Suite)

| Variable | Type | Example Value |
|----------|------|---------------|
| `{{author}}` | `string` | `Sebastian Mordziol` |
| `{{last_updated}}` | `string` | `2026-03-01 12:00` |
| `{{mcp_server_name}}` | `string` | `central_pm` |
| `{{cc_permission_mode}}` | `string` | `acceptEdits` |
| `{{cc_memory}}` | `string` | `project` |

### From Per-Persona YAML (Ledger Suite)

| Variable | Type | Example Value |
|----------|------|---------------|
| `{{number}}` | `int` | `3` |
| `{{role}}` | `string` | `Developer` |
| `{{vs_file_name}}` | `string` | `3-dev.agent.md` |
| `{{cc_file_name}}` | `string` | `3-developer.md` |
| `{{da_file_name}}` | `string` | `3-developer.md` |
| `{{id}}` | `string` | `ledger-3-dev` |
| `{{has_mcp}}` | `bool` | `true` |
| `{{has_detect_project}}` | `bool` | `true` |
| `{{self_documenting_note}}` | `bool` | `true` |
| `{{has_incident_logging}}` | `bool` | `true` |

### From Per-Persona YAML (Standalone Suite)

| Variable | Type | Example Value |
|----------|------|---------------|
| `{{slug}}` | `string` | `researcher` |
| `{{name}}` | `string` | `Researcher` — plain display name only; the frontmatter template appends `v{{version}}` (see `api-surface.md` § Standalone VS Code frontmatter) |
| `{{description}}` | `string` | `Research solutions to complex problems...` |
| `{{id}}` | `string` | `standalone-researcher` |
| `{{vs_file_name}}` | `string` | `researcher.agent.md` |
| `{{cc_file_name}}` | `string` | `researcher.md` |

---

## Derived Variables

Computed by `buildContext()` during the build. Only set when not already present in YAML — explicit overrides always win.

### Standard Derived Fields (All Suites)

| Variable | Derived From | Output Format |
|----------|-------------|---------------|
| `{{version}}` | `persona.version` → `_shared.default_version` → `'0.0.0'` | String (e.g. `3.6.3`) |
| `{{cc_name}}` | `persona.cc_file_name` with `.md` stripped | Kebab-case (e.g. `3-developer` or `researcher`) |
| `{{cc_file_name_stem}}` | `persona.cc_file_name` with `.md` stripped | Same as `cc_name` |
| `{{cc_model}}` | `persona.cc_model` → resolved `model` → `_shared.cc_model` | String (e.g. `inherit`) |

### Tool Serialization (Ledger Suite)

| Variable | Derived From | Output Format |
|----------|-------------|---------------|
| `{{tools_json}}` | `persona.tools[]` | `['vscode', 'execute', ...]` (brackets included) |
| `{{tools_block}}` | `persona.tools[]` | YAML block sequence |
| `{{cc_tools_json}}` | `persona.cc_tools` → `_shared.default_cc_tools[]` | `['Bash', 'Read', ...]` (brackets included) |
| `{{cc_tools_block}}` | `persona.cc_tools` → `_shared.default_cc_tools[]` | YAML block sequence |

### Tool Serialization (Standalone Suite)

| Variable | Derived From | Output Format |
|----------|-------------|---------------|
| `{{tools_list}}` | `persona.tools[]` | `'vscode', 'execute'` (no brackets) |
| `{{cc_tools_list}}` | `persona.cc_tools` → `_shared.default_cc_tools[]` | `'Bash', 'Read'` (no brackets) |

### Deep Agents Derived Fields (Gated on `da_file_name`)

Only injected when `da_file_name` is present in the merged context. Personas without `da_file_name` produce no `da_*` fields.

| Variable | Derived From | Output Format |
|----------|-------------|---------------|
| `{{da_file_name_stem}}` | `persona.da_file_name` with `.md` stripped | String (e.g. `3-developer`) |
| `{{da_tools_list}}` | `persona.da_tools` → fallback to `tools` | Comma-separated quoted (no brackets) |
| `{{da_tools_json}}` | `persona.da_tools` → fallback to `tools` | `['tool1', 'tool2']` (brackets included) |
| `{{da_tools_block}}` | `persona.da_tools` → fallback to `tools` | YAML block sequence |

> **These variables are currently unused in this workspace.** The `FRONTMATTER_DA` template (see `api-surface.md`) emits only `name` and `description`, and no persona content template references `{{da_tools_*}}`. Setting `da_tools:` in a persona YAML therefore has no effect on generated output. Tool availability for the Deep Agents target is determined at runtime by the orchestrator — see `orchestrator/docs/architecture.md` § Built-in Tool Suite. The variables remain available should a future `FRONTMATTER_DA` revision start emitting a tools field.

### Model Resolution (Ledger Suite)

| Variable | Resolution Chain | Output Format |
|----------|-----------------|---------------|
| `{{model}}` | `persona.model` → `_shared.default_model` → `_shared.cc_model` → `'inherit'` | String (e.g. `Claude Sonnet 4.6`) |
| `{{model_slug}}` | `persona.model_slug` → `_shared.default_model_slug` | String (e.g. `claude-sonnet-4-6`) |

> **`||` resolution:** Both `model` and `model_slug` use JavaScript `||` (not `??`), so falsy values like empty string are skipped.

---

## Computed Variables (Plugin / Build-System Generated)

These are generated by the build system or plugins — they cannot be set in YAML files.

| Variable | Suite | Source | Output |
|----------|-------|--------|--------|
| `{{roster_rendered}}` | ledger | `_shared.yaml` → `roster[]` | Numbered Markdown list of all 9 agents, with `(YOU)` marker for the current persona |
| `{{mcp_tools_table}}` | ledger | Per-persona YAML → `mcp_tools[]` | Markdown table rows: `\| \`tool\` \| purpose \|` |
| `{{cc_description}}` | all | **Ledger:** roster entry `title` + `short` for matching `number`. **Standalone:** persona YAML `description` field. | Human-readable description (e.g. `"Staff Software Engineer — Implementation & Verification"`) |
| `{{total}}` | ledger | `_shared.roster.length` | `9` |

---

## Cross-Suite Agent Map Variables

Populated by the `@mistraljs/persona-builder` library's pre-scan phase. For **every persona across all configured suites**, two context keys are injected into every persona's context:

| Pattern | Value | Example |
|---------|-------|---------|
| `{{agent_<underscored_slug>}}` | `"<name> v<version>"` | `{{agent_wp_decomposer}}` → `"WP Decomposer v1.0.7"` |
| `{{agent_slug_<underscored_slug>}}` | Raw hyphenated slug | `{{agent_slug_wp_decomposer}}` → `"wp-decomposer"` |

**Key derivation:** The YAML `slug` field (or filename stem) is transformed for the key suffix: hyphens → underscores. The *value* of `agent_slug_*` preserves the original hyphens.

**Use cases:**
- Reference another persona by display name in prose: `Delegate to {{agent_wp_decomposer}}`
- Invoke a sub-agent in Deep Agents target: `task(subagent={{agent_slug_wp_decomposer}})`

### Subagents Cross-Reference Validation

When a persona declares a `subagents` list in its YAML metadata, the build script (`scripts/build-personas.js`) validates that every `{{agent_slug_<suffix>}}` reference in the content file maps to a slug present in that list. Mismatches produce a **blocking error** (exit code 1), not a warning.

To fix: ensure the suffix (underscores → hyphens) matches an entry in the persona's `subagents` field, and that the entry matches a real persona slug declared in `personas/*/src/meta/*.yaml`.

### Finding Available Slugs

Agent map variables are generated from the `slug` field (or filename stem) of every persona across all suites. To find the correct variable name for a target persona:

1. Locate its metadata: `personas/<suite>/src/meta/<file>.yaml`
2. Read the `slug` field (or use the filename without `.yaml`)
3. Replace hyphens with underscores → that is the variable suffix

Example: `personas/standalone/src/meta/ledger-knowledge-archiver.yaml` with `slug: ledger-knowledge-archiver` → `{{agent_ledger_knowledge_archiver}}` and `{{agent_slug_ledger_knowledge_archiver}}`.

---

## Platform Feature Flags

Injected per target pass — cannot be set in YAML. Use in `{{#if}}` conditionals to produce target-specific content.

| Flag | `vscode` pass | `claude-code` pass | `deep-agents` pass |
|------|---------------|--------------------|--------------------|
| `{{target_vscode}}` | `true` | `false` | `false` |
| `{{target_claude_code}}` | `false` | `true` | `false` |
| `{{target_deep_agents}}` | `false` | `false` | `true` |

**Usage pattern:**

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

---

## Boolean Feature Flags (YAML-Sourced)

These are set in per-persona YAML and used in content templates with `{{#if}}` conditionals to include/exclude persona-specific sections.

| Flag | Purpose | Agents Using |
|------|---------|--------------|
| `{{has_mcp}}` | Include MCP pre-flight check and tools table | Agents 2–9 |
| `{{has_detect_project}}` | Include detect-project pre-flight step | Agents 3–9 |
| `{{self_documenting_note}}` | Include self-documenting tools note | Agents 3–8 |
| `{{has_incident_logging}}` | Include environment incident logging instructions | Agents 3–8 |
| `{{mcp_server_name}}` | Include `mcpServers` block in standalone CC frontmatter | Per-persona opt-in |

---

## Variable Resolution Behaviour

| Scenario | Result |
|----------|--------|
| Variable found in context | Replaced with `String(value)` |
| Variable not found | Warning emitted to stderr; marker preserved as-is in output |
| Escaped variable (`\{{name}}`) | Output is literal `{{name}}` — no substitution, no warning |
| `--strict` flag and unresolved variable | Build exits with code 1 |

---

## Quick Lookup by Use Case

| I need to… | Use this variable |
|------------|-------------------|
| Show the persona's version | `{{version}}` |
| Show the MCP server name | `{{mcp_server_name}}` |
| Render the 9-agent roster | `{{roster_rendered}}` |
| Render the MCP tools table | `{{mcp_tools_table}}` |
| Reference another agent by name | `{{agent_<slug>}}` |
| Reference another agent's slug | `{{agent_slug_<slug>}}` |
| Write platform-specific content | `{{#if target_vscode}}` / `{{#if target_claude_code}}` / `{{#if target_deep_agents}}` |
| Conditionally include MCP section | `{{#if has_mcp}}` |
| Get tool list for frontmatter | `{{tools_json}}` (ledger) or `{{tools_list}}` (standalone) |
| Get CC tool list for frontmatter | `{{cc_tools_json}}` (ledger) or `{{cc_tools_list}}` (standalone) |
| Get the persona's role | `{{role}}` |
| Get roster-derived description | `{{cc_description}}` |

```