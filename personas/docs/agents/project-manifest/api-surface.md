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
| `brief_tag` | `string` | no | Research brief entry tag the persona draws on, substituted into `research-brief-protocol.md` (e.g. `"[verify]"`, `"[arch]"`). Required for personas including that partial, alongside the other four `brief_*` fields. |
| `brief_purpose` | `string` | no | Sentence fragment naming what the brief gives a head start on (e.g. `"grounding verification"`). Pairs with `brief_tag`. |
| `brief_contributor` | `string` | no | Attribution name used in the `[added by: …, unverified]` prefix when appending to the brief. Pairs with `brief_tag`. |
| `brief_authority` | `string` | no | Phrase naming what remains authoritative over the brief (e.g. `"independent verification"`). Pairs with `brief_tag`. |
| `brief_report_file` | `string` | no | The persona's own report filename, used to contrast facts (brief) against judgments (report) — e.g. `"audit.md"`. Pairs with `brief_tag`. |
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
| `research-brief-protocol.md` | Plan Auditor, Plan Architect Reviewer | `{{brief_tag}}`, `{{brief_purpose}}`, `{{brief_contributor}}`, `{{brief_authority}}`, `{{brief_report_file}}`; placement: after Outputs, before the Operational Protocol. Contains the orient / size-estimate / contribute-back steps and a consolidated Constraints block. Consumers must supply all five variables, provide a **Research brief** line in their output template, and carry both a brief-existence workflow checkpoint and a contribute-back step. |

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

