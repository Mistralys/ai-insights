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
| `{{name}}` | `string` | `Researcher v1.2.0` |
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
