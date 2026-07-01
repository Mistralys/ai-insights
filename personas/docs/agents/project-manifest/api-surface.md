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

**Unconditional (both real builds and `--check`):** A cross-reference validation step scans every `personas/ledger/src/content/*.md` file for `{{agent_slug_X_Y}}` references and verifies that the corresponding slug `x-y` is declared in the persona's `subagents` field in its YAML. Errors accumulate across all personas before a single `[ERROR]` block is printed and `process.exit(1)` is called. Personas with no `{{agent_slug_*}}` references pass silently. The internal helper `extractSubagentsList(text, key)` parses flat dash-prefixed YAML block lists (strips inline comments and surrounding quotes); it is local to the validation block and is not exported.

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
| `mcp_tools` | `Array<{tool, purpose, note_only?}>` | no | MCP tool entries for the tools table; omitted for Agent 1. When `note_only: true` is set on an entry, the library excludes it from the rendered table — the tool is mentioned only in prose content. Use this flag when a tool should be acknowledged in context (e.g. help-text prose) but must not appear as a first-class table row in the generated persona output. |

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
