# Public API Surface

## Build Script (`scripts/build-personas.js`)

### CLI Flags

| Flag | Values | Default | Description |
|------|--------|---------|-------------|
| `--suite` | `ledger \| standalone \| all` or comma-separated | `ledger` | Select which persona suite(s) to build. `all` expands to `ledger,standalone`. Comma-separated values run suites in order without duplication (e.g. `--suite ledger,standalone`). |
| `--target` | `vscode \| claude-code \| all` | `all` | Select which IDE target to generate. Can be combined with `--suite`. |
| `--check` | *(flag)* | off | Verify output is up-to-date without writing. Exits 1 if any file is stale or if any `note_only: true` tool entry appears as a rendered table row in generated output (`[note_only-violation]`). Suite-aware: use `--suite all --check` to check all suites. |
| `--dry-run` | *(flag)* | off | Preview build without writing files. |
| `--strict` | *(flag)* | off | After building, scan all generated output for unresolved `{{variable}}` or `{{> partial}}` markers. Exits 1 with a `[STRICT]` log line if any are found. Safe to combine with `--suite` and `--target`. Compatible with `--check` and `--dry-run`; does not alter their output behaviour. **Known limitations:** (1) The scan regex would produce false positives if a template body contained literal `{{…}}` inside a Markdown fenced-code block (no current persona triggers this — see constraint 9 GN-4); (2) When `--check` fires first and exits 1, `[STRICT]` scan output is skipped — run `--check` as a separate CI step if strict failure details are needed (see constraint 9 GN-5). |

### Constants

| Constant | Value | Description |
|----------|-------|-------------|
| `VALID_SUITES` | `['ledger', 'standalone', 'all']` | Accepted values for the `--suite` CLI flag. `expandSuites()` validates against this list and exits with `[ERROR]` on unknown values. `'all'` is a shorthand that expands to both concrete suite names. |

### Suite Configuration (`SUITE_CONFIGS`)

The `SUITE_CONFIGS` map defines directories and persona mode for each suite:

| Suite | `srcDir` | `outVscode` | `outCC` | `personaMode` |
|-------|----------|-------------|---------|---------------|
| `ledger` | `personas/ledger/src/` | `personas/ledger/vs-code/` | `personas/ledger/claude-code/` | `numbered` |
| `standalone` | `personas/standalone/src/` | `personas/standalone/vs-code/` | `personas/standalone/claude-code/` | `standalone` |

`personaMode: 'numbered'` uses `N-name.yaml` discovery and number-prefixed frontmatter fields. `personaMode: 'standalone'` uses slug-based YAML discovery and slug-derived frontmatter.

### Template Functions

| Function | Signature | Description |
|----------|-----------|-------------|
| `expandSuites` | `(suiteArg: string) → string[]` | Expands a `--suite` CLI argument (possibly comma-separated, possibly containing `"all"`) to a deduplicated ordered list of concrete suite names. |
| `loadPartials` | `(suiteConfig: Object) → Object.<string, string>` | Loads the merged partials map for a suite. Base layer: `personas/shared/partials/`. Override layer: `personas/<suite>/src/partials/`. Suite-local entries shadow same-named shared entries. Returns a name→content map. |
| `discoverPersonaYamls` | `(suiteConfig: Object) → string[]` | Discovers per-persona YAML files in `suiteConfig.srcDir/meta/`, excluding `_shared.yaml`. Returns sorted filenames. |
| `resolvePartials` | `(text: string, partialsMap: Object, depth?: number) → string` | Replaces `{{> name}}` markers with content from `partialsMap`. Recursive to depth 2. Warns and leaves marker as-is on missing partial. |
| `resolveConditionals` | `(text: string, context: Object) → string` | Processes `{{#if flag}}…{{/if}}` blocks. Truthy = keep inner content; falsy = remove block. |
| `resolveVariables` | `(text: string, context: Object, filename: string) → string` | Replaces `{{variable}}` with `String(context[variable])`. Warns on unresolved variables. |
| `collapseBlankLines` | `(text: string) → string` | Reduces 3+ consecutive blank lines to 2. Post-processing step. |
| `renderRoster` | `(roster: Array, activeNumber: number) → string` | Renders the 7-agent roster as a numbered Markdown list, tagging the current agent with `(YOU)`. |
| `renderMcpToolsTable` | `(tools: Array) → string` | Renders MCP tool entries as Markdown table rows (`| \`tool\` | purpose |`). |
| `serializeTools` | `(tools: string[]) → string` | Serializes a tools array to YAML flow format **with** outer brackets: `['vscode', 'execute', ...]`. Used in ledger frontmatter. |
| `serializeToolsList` | `(tools: string[]) → string` | Serializes a tools array **without** outer brackets: `'vscode', 'execute', ...`. Used inside `[…]` literals in standalone frontmatter templates. |
| `validateCcFileName` | `(persona: Object, suite: string) → void` | Validates that a persona object has a `cc_file_name` field set. Exits with code 1 and prints an error if the field is missing. Called before any Claude Code output is written. |
| `ccFrontmatterFields` | `() → string` | Returns the three shared Claude Code frontmatter fields (`permissionMode`, `model`, `memory`) as a YAML fragment string with no leading or trailing newlines. Interpolated into both `FRONTMATTER_LEDGER_CC` and `FRONTMATTER_STANDALONE_CC` template literals to eliminate verbatim duplication. |
| `buildForTarget` | `(suite: string, target: 'vscode' \| 'claude-code') → void` | Executes one complete build pass for the given suite + target combination. Loads suite config, reads `_shared.yaml`, loads merged partials, discovers persona YAMLs, selects the correct frontmatter template, and writes all persona files to the appropriate output directory. |

### Template Processing Order

Phases execute in strict order — each phase sees the output of the previous phase:

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

**Two-layer loading:** The build script loads partials in two passes:
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

No `{{#each}}` support.

### Variables

```
{{variable}}
```

Replaced with `String(context[variable])`. Unknown variables emit a warning and are left as-is.

### Computed Variables

These are generated by the build script — they cannot be set in YAML files:

| Variable | Suite | Source | Output |
|----------|-------|--------|--------|
| `{{roster_rendered}}` | ledger | `_shared.yaml` → `roster[]` | Numbered Markdown list of all 7 agents, with `(YOU)` marker |
| `{{mcp_tools_table}}` | ledger | per-persona YAML → `mcp_tools[]` | Markdown table rows: `\| \`tool\` \| purpose \|` |
| `{{tools_json}}` | ledger | per-persona YAML → `tools[]` | YAML flow sequence with brackets: `['vscode', 'execute', ...]` — used in `FRONTMATTER_LEDGER_VSCODE` |
| `{{tools_list}}` | standalone | per-persona YAML → `tools[]` | Comma-separated quoted list **without** brackets: `'vscode', 'execute', ...` — embedded inside `[…]` in standalone frontmatter |
| `{{cc_tools_json}}` | ledger | `persona.cc_tools` → fallback `_shared.default_cc_tools[]` | YAML flow sequence with brackets: `['Bash', 'Read', ...]` — used in `FRONTMATTER_LEDGER_CC` |
| `{{cc_tools_list}}` | standalone | `persona.cc_tools` → fallback `_shared.default_cc_tools[]` | Comma-separated quoted list **without** brackets: `'Bash', 'Read', ...` — embedded inside `[…]` in standalone CC frontmatter |
| `{{cc_name}}` | all | persona `cc_file_name` (`.md` stripped) | Kebab-case Claude Code identifier. Ledger: `N-role` (e.g. `3-developer`); standalone: plain slug (e.g. `researcher`) |
| `{{cc_description}}` | ledger | `_shared.yaml` → `roster[]` `title` + `short` | Human-readable description for Claude Code's auto-delegation display |
| `{{model}}` | ledger | `persona.model` → `_shared.default_model` → `_shared.cc_model` → `'inherit'` | AI model name for VS Code frontmatter (e.g. `"Claude Opus 4.6"` or `"Claude Sonnet 4.6"`). Resolution uses `||` not `??` for the shared fallbacks, so falsy values are skipped. |
| `{{cc_model}}` | all | `persona.cc_model` (if present) → resolved `model` | AI model name for Claude Code frontmatter. Inherits the full model resolution chain when no per-persona `cc_model` is set. |

### Platform Feature Flags

Injected per target pass — cannot be set in YAML:

| Flag | Type | Value when target = `vscode` | Value when target = `claude-code` |
|------|------|-------------------------------|-----------------------------------|
| `{{target_vscode}}` | `bool` | `true` | `false` |
| `{{target_claude_code}}` | `bool` | `false` | `true` |

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
| `default_version` | `string` | **Required.** Default version string (e.g. `"3.4.0"`) unless overridden per-persona. Absence causes `[ERROR]` + `process.exit(1)` in `buildForTarget()`. |
| `default_model` | `string` | Default AI model for generated frontmatter (e.g. `"Claude Sonnet 4.6"`). Per-persona `model` overrides this. |
| `mcp_server_name` | `string` | MCP server name used in tool patterns and references (e.g. `"central_pm"`) |
| `roster` | `Array<{number, title, short}>` | 7-entry list of agent identities |
| `cc_permission_mode` | `string` | Claude Code permission mode (e.g. `"acceptEdits"`) |
| `cc_model` | `string` | Claude Code model override — `"inherit"` to defer to user config. Also serves as the final named fallback in the VS Code `model` resolution chain (after `default_model`), so suites without `default_model` (e.g. standalone) resolve to this value. |
| `cc_memory` | `string` | Claude Code memory scope — e.g. `"project"` |
| `default_cc_tools` | `string[]` | Default tool list for Claude Code frontmatter — applied to all personas unless per-persona `cc_tools` overrides it (e.g. `["Bash", "Read", "Edit", ...]`) |

### Per-Persona YAML (`N-name.yaml`) — Ledger Suite

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `number` | `int` | yes | Agent position (1–7) |
| `role` | `string` | yes | Workflow role identifier — must match `AGENT_ROLES` in MCP server |
| `model` | `string` | no | AI model override — replaces `default_model` for this persona (e.g. `"Claude Opus 4.6"`) |
| `id` | `string` | yes | Stable VS Code routing identifier for `@id` subagent routing. Pattern: `ledger-{vs_file_name stem}` (e.g. `ledger-3-dev` for `3-dev.agent.md`). Must be lowercase, no spaces, and stable across version bumps. |
| `vs_file_name` | `string` | yes | Output filename when synced to VS Code prompts dir |
| `cc_file_name` | `string` | yes | Output filename when synced to Claude Code projects dir (e.g. `"3-developer.md"`). **Required.** Absence causes `[ERROR]` + `process.exit(1)` in `buildForTarget()`. |
| `version` | `string` | no | Overrides `default_version` for this persona |
| `tools` | `string[]` | yes | Tool permission slugs for the AI IDE |
| `cc_tools` | `string[]` | no | Tool names for Claude Code — overrides `default_cc_tools` from `_shared.yaml` when present (e.g. `["Bash", "Read", "Edit", ...]`) |
| `has_mcp` | `bool` | yes | Inject MCP pre-flight check and tools table |
| `has_detect_project` | `bool` | yes | Inject detect-project pre-flight step |
| `self_documenting_note` | `bool` | yes | Inject self-documenting tools note |
| `has_incident_logging` | `bool` | yes | Inject environment incident logging instructions |
| `mcp_tools` | `Array<{tool, purpose, note_only?}>` | no | MCP tool entries for the tools table; omitted for Agent 1. When `note_only: true` is set on an entry, `renderMcpToolsTable` excludes it from the rendered table — the tool is mentioned only in prose content. Use this flag when a tool should be acknowledged in context (e.g. help-text prose) but must not appear as a first-class table row in the generated persona output. |

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

Written to `personas/ledger/claude-code/`. The three shared CC fields are supplied by `${ccFrontmatterFields()}`.

```yaml
---
name: {{cc_name}}
description: '{{cc_description}}'
role: {{role}}
author: {{author}}
version: {{version}}
last_updated: {{last_updated}}
tools: {{cc_tools_json}}
${ccFrontmatterFields()}
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

Written to `personas/standalone/claude-code/`. No `role`, no `mcpServers`. `cc_name` is the plain kebab slug (no numeric prefix). The three shared CC fields are supplied by `${ccFrontmatterFields()}`.

```yaml
---
name: {{cc_name}}
description: '{{description}}'
author: {{author}}
version: {{version}}
last_updated: {{last_updated}}
tools: [{{cc_tools_list}}]
${ccFrontmatterFields()}
---
```

Every generated file is prefixed with `<!-- AUTO-GENERATED — do not edit. Source: personas/<suite>/src/ -->` immediately after the frontmatter. The source path reflects the actual suite (e.g. `personas/ledger/src/` for ledger builds).

## Standalone Suite Metadata Schema

The standalone suite (`personas/standalone/src/`) uses a slug-based schema for special-purpose personas that do not fit the 7-stage workflow.

### Standalone `_shared.yaml`

| Field | Type | Description |
|-------|------|-------------|
| `author` | `string` | Author name |
| `last_updated` | `string` | ISO-style date string |
| `default_version` | `string` | **Required.** Default version string (e.g. `"1.0.0"`) unless overridden per-persona. Absence causes `[ERROR]` + `process.exit(1)` in `buildForTarget()`. |
| `cc_permission_mode` | `string` | Claude Code permission mode (e.g. `"acceptEdits"`) |
| `cc_model` | `string` | Claude Code model override |
| `cc_memory` | `string` | Claude Code memory scope |
| `default_cc_tools` | `string[]` | Default tool list for Claude Code frontmatter |

> **Note:** `mcp_server_name` and `roster` are absent — standalone personas have no MCP dependency and no workflow roster.

### Standalone Per-Persona YAML (`<slug>.yaml`)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `slug` | `string` | yes | Kebab-case identifier (e.g. `"researcher"`, `"manifest-curator"`) |
| `id` | `string` | yes | Stable VS Code routing identifier for `@id` subagent routing. Pattern: `standalone-{vs_file_name stem}` (e.g. `standalone-researcher` for `researcher.agent.md`). Must be lowercase, no spaces, and stable across version bumps. |
| `name` | `string` | yes | Human-readable display name including version (e.g. `"Researcher v1.0.1"`) |
| `description` | `string` | yes | Short description of the persona's purpose |
| `vs_file_name` | `string` | yes | Output filename for VS Code sync (e.g. `"researcher.agent.md"`) |
| `cc_file_name` | `string` | yes | Output filename for Claude Code sync (e.g. `"researcher.md"`). **Required.** Absence causes `[ERROR]` + `process.exit(1)` in `buildForTarget()`. |
| `version` | `string` | yes | Per-persona version string |
| `last_updated` | `string` | no | Per-persona last-updated date |
| `tools` | `string[]` | yes | Tool permission slugs for the AI IDE |
| `cc_tools` | `string[]` | no | Tool names for Claude Code — overrides `default_cc_tools` from `_shared.yaml` (e.g. `module-intent-architect` omits `TodoRead`/`TodoWrite`) |

> **Note:** `role` is intentionally absent — standalone personas are not part of the MCP-backed 7-stage workflow and have no role-based routing. The `vs_file_name` field uses `.agent.md` extension (e.g. `researcher.agent.md`) — this convention was established by WP-004.

### Feature Flags by Agent

| Agent | `has_mcp` | `has_detect_project` | `self_documenting_note` | `has_incident_logging` |
|-------|-----------|----------------------|-------------------------|------------------------|
| 1 — Planner | — | — | — | — |
| 2 — Project Manager | ✓ | — | — | — |
| 3 — Developer | ✓ | ✓ | ✓ | ✓ |
| 4 — QA | ✓ | ✓ | ✓ | ✓ |
| 5 — Reviewer | ✓ | ✓ | ✓ | — |
| 6 — Documentation | ✓ | ✓ | ✓ | ✓ |
| 7 — Synthesis | ✓ | ✓ | ✓ | — |



---

## Sync Script (`scripts/sync-personas.js`)

### Functions

| Function | Signature | Description |
|----------|-----------|-------------|
| `getVSCodePromptsDir` | `() → string` | Returns platform-specific VS Code User prompts directory (win32/darwin/linux) |
| `getClaudeCodeAgentsDir` | `() → string` | Returns `~/.claude/agents/` (cross-platform via `os.homedir()`) |
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
const KNOWN_ROLES = [
  'Planner', 'Project Manager', 'Developer', 'QA',
  'Reviewer', 'Documentation', 'Synthesis',
];
```

Must be kept in sync with `AGENT_ROLES` in `mcp-server/src/utils/constants.ts`.

---

## Partials Inventory

Partials are organised into two layers. **Shared partials** (`personas/shared/partials/`) are suite-agnostic and available to all suites. **Ledger-specific partials** (`personas/ledger/src/partials/`) are MCP-workflow-only and override same-named shared entries.

### Shared Partials (`personas/shared/partials/`)

| Partial | Used By | Embeds Variables / Notes |
|---------|---------|-------------------------|
| `agent-roster.md` | All 7 agents | `{{roster_rendered}}` |
| `planner-output-template.md` | Agent 1 | *(none)* |
| `planner-core-rules.md` | Agent 1 | *(none)* |
| `pm-output-format.md` | Agent 2 | *(none)* |
| `developer-operational-protocol.md` | Agent 3 | *(none)* |
| `developer-strict-constraints.md` | Agent 3 | Embeds `{{> incident-logging}}` — resolves via ledger override layer; requires a stub in `shared/` for non-ledger suites |
| `developer-output-format.md` | Agent 3 | *(none)* |
| `qa-operational-protocol.md` | Agent 4 | *(none)* |
| `qa-output-format.md` | Agent 4 | *(none)* |
| `reviewer-operational-protocol.md` | Agent 5 | *(none)* |
| `reviewer-output-format.md` | Agent 5 | *(none)* |
| `docs-operational-protocol.md` | Agent 6 | Embeds `{{> incident-logging}}` — same ledger coupling as `developer-strict-constraints.md` |
| `docs-output-format.md` | Agent 6 | *(none)* |
| `synthesis-operational-protocol.md` | Agent 7 | *(none)* |
| `synthesis-output-format.md` | Agent 7 | *(none)* |

### Ledger-Specific Partials (`personas/ledger/src/partials/`)

| Partial | Used By | Embeds Variables |
|---------|---------|------------------|
| `mcp-intro.md` | Agents 2–7 | `{{mcp_server_name}}`, `{{mcp_tools_table}}` |
| `role-boundaries.md` | Agents 2–7 | *(none)* |
| `mcp-tools-note.md` | Agents 3–7 | *(none)* |
| `mcp-preflight-header-vscode.md` | Agents 2–7 (VS Code target) | `{{mcp_server_name}}` |
| `mcp-preflight-header-claude-code.md` | Agents 2–7 (Claude Code target) | `{{mcp_server_name}}` |
| `mcp-preflight-detect.md` | Agents 3–7 | *(none)* |
| `mcp-preflight-verify-with-detect.md` | Agents 3–7 | *(none)* |
| `mcp-preflight-verify-no-detect.md` | Agent 2 only | *(none)* |
| `mcp-unavailable.md` | Agents 2–7 | `{{mcp_server_name}}` |
| `handoff-block-vscode.md` | Agents 2–6 (VS Code target) | `{{role}}` |
| `handoff-block-claude-code.md` | Agents 2–6 (Claude Code target) | `{{role}}` |
| `incident-logging.md` | Agents 3, 4, 6 (via shared partials or directly) | *(none)* |
