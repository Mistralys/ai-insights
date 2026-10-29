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
| `@mistralys/persona-builder` | ^3.0.1 | Library that owns all persona build logic — template engine, partial resolution, conditional processing, and variable interpolation. Invoked by `build-personas.js` via its CLI binary. |

### Workspace-level Dependencies

| Package | Version | Scope | Purpose |
|---------|---------|-------|---------|
| `vitest` | ^4.0.18 | workspace-root `devDependencies` | Test runner for the workspace-root suite in `scripts/tests/` (`npm test` at the workspace root). Not a dependency of `personas/package.json` |

### Testing

The personas module has no test framework of its own: `personas/package.json` declares no test script or test dependency, and the persona build logic lives in the external `@mistralys/persona-builder` library, which carries its own tests. `--check` on `build-personas.js` is a write-free validation run, not a test suite. The `ledgerPlugin` code under `personas/plugins/ledger/` is exercised by the workspace-root Vitest suite in `scripts/tests/` (for example `ledger-plugin.test.js`), which belongs to the root tooling rather than to this module.

The thin wrapper `build-personas.js` delegates all build logic to `@mistralys/persona-builder` via its CLI binary (`dist/cli.js`). The wrapper itself only resolves paths and forwards CLI flags (`--check`, `--strict`) to the library.

---

## Build Tools

| Tool | Invocation | Purpose |
|------|-----------|---------|
| `build-personas.js` | `node scripts/build-personas.js` | Thin wrapper: resolves paths to `personas/persona-build.config.js` and the library CLI binary, then delegates the full build to `@mistralys/persona-builder` |
| `persona-build.config.js` | *(loaded by the library CLI)* | Config file in `personas/persona-build.config.js` — declares suite directories, output paths, and the `ledgerPlugin` that validates persona role names against the workflow manifest |
| `sync-personas.js` | `node scripts/sync-personas.js` | Orchestrator: runs the full build, copies output to VS Code agents dir and/or Claude Code agents dir (plus skills to `~/.claude/skills/`), validates frontmatter |

### CLI Flags (`build-personas.js`)

The thin wrapper accepts only `--check`, `--dry-run` and `--strict`, and forwards them to the library CLI; it takes no `--suite` or `--target`. Suite and target selection are defined in `personas/persona-build.config.js`, and every build covers all of them.

| Flag | Effect |
|------|--------|
| *(none)* | Delegate build to `@mistralys/persona-builder` for all suites and targets declared in the config |
| `--check` | Forward `--check` to the library CLI — render every persona in memory and write nothing; exit 1 only on error-severity validation results. Does not compare against files on disk |
| `--dry-run` | Treated as `--check` by the wrapper (no disk writes) |
| `--strict` | Forward `--strict` to the library CLI — also exit 1 on the library's warning-severity validation results. Unresolved `{{variable}}` / `{{> partial}}` markers only print a `[WARN]` line and never fail the build; the wrapper's own warn-severity checks stay non-fatal |

### CLI Flags (`sync-personas.js`)

| Flag | Effect |
|------|--------|
| *(none)* | Build every suite and target, then run every deploy step (same as `--target all`) |
| `--target vscode` | Build every suite and target, then copy all three suites to the VS Code agents dir only |
| `--target claude-code` | Build every suite and target, then copy all three suites to `~/.claude/agents/` and sync `.claude/skills/` to `~/.claude/skills/` |
| `--target all` | Explicit default — both deploy steps |
| `--dry-run` | Runs the build with `--dry-run` (nothing regenerated) and previews ("Would copy") from the existing output; nothing is copied |
| `--custom-path <dir>` | Override the VS Code agents directory (vscode target only) |

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
