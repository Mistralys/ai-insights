# Plan: Multi-IDE Persona Support (Claude Code Compatibility)

## Summary

Extend the persona build system to produce platform-specific output for both **VS Code (GitHub Copilot)** and **Claude Code**, so the same source templates generate IDE-appropriate persona files. This involves adding `{{else}}` support to the template engine, introducing a `--target` CLI flag, creating separate output directories per platform, adding platform-specific frontmatter and partials, extending the sync script with Claude Code deployment support, and optionally extending the MCP server's agent registry for dual-platform auto-handoff discovery.

## Architectural Context

### Current Build System

The persona build system lives in `personas/ledger/src/` with three source directories:

- [personas/ledger/src/meta/](personas/ledger/src/meta/) — YAML metadata per persona (`_shared.yaml` + `N-name.yaml`)
- [personas/ledger/src/partials/](personas/ledger/src/partials/) — Reusable Markdown fragments (12 partials)
- [personas/ledger/src/content/](personas/ledger/src/content/) — Per-persona body templates (7 files)

Build script: [scripts/build-personas.js](scripts/build-personas.js) — A 342-line CJS script with a 4-phase template engine:

1. `resolvePartials()` — embed `{{> name}}` fragments
2. `resolveConditionals()` — process `{{#if flag}}…{{/if}}` blocks (no `{{else}}` yet)
3. `resolveVariables()` — interpolate `{{variable}}` placeholders
4. `collapseBlankLines()` — normalize whitespace

Output currently goes to `personas/ledger/` (flat, 7 `.md` files).

### Current Sync System

[scripts/sync-personas.js](scripts/sync-personas.js) — A 320-line CJS script that:
- Runs `build-personas.js` as a child process
- Walks `personas/` (ledger/, vanilla/, standalone/) for `.md` files
- Extracts `vs_file_name` from frontmatter → copies to the VS Code prompts directory
- Validates ledger frontmatter against `KNOWN_ROLES`

### Agent Registry

[mcp-server/src/utils/agent-registry.ts](mcp-server/src/utils/agent-registry.ts) — Scans `*.agent.md` files in the VS Code prompts directory, parses `name` and `role` from frontmatter, and builds a `role → agent_name` map used by `buildHandoffResponse()` for auto-handoff.

### Handoff Mechanism

[mcp-server/src/tools/workflow-handoff.ts](mcp-server/src/tools/workflow-handoff.ts) — `buildHandoffResponse()` returns an `auto_handoff` payload with `agent_name` (the VS Code `name` field, e.g., `"3 - Developer v3.5.0"`) and a `prompt`. The handoff partial ([personas/ledger/src/partials/handoff-block.md](personas/ledger/src/partials/handoff-block.md)) instructs agents to call `runSubagent` (VS Code–only tool) with these values.

### Platform-Sensitive Partials

Two partials contain VS Code–specific instructions:
- [personas/ledger/src/partials/handoff-block.md](personas/ledger/src/partials/handoff-block.md) — References `runSubagent` tool
- [personas/ledger/src/partials/mcp-preflight-header.md](personas/ledger/src/partials/mcp-preflight-header.md) — References `tool_search_tool_regex` for deferred MCP tool loading

### Key Differences: VS Code vs. Claude Code

| Aspect | VS Code | Claude Code |
|--------|---------|-------------|
| **Agent directory** | `~/Library/Application Support/Code/User/prompts/` | `~/.claude/agents/` |
| **File extension** | `*.agent.md` | `*.md` |
| **Name format** | Display name with version: `'3 - Developer v3.5.0'` | Kebab-case identifier: `3-developer` |
| **Handoff tool** | `runSubagent(description, prompt)` | `Task(agent_type, prompt)` |
| **MCP loading** | Deferred — `tool_search_tool_regex` | Native — auto-loaded or `MCPSearch` |
| **Tool slugs** | `vscode`, `execute`, `read`, `edit`, `search`, `web`, `agent`, `todo` | `Bash`, `Read`, `Edit`, `Write`, `Grep`, `Glob`, `Task`, `WebFetch`, `WebSearch` |
| **Extra frontmatter** | `vs_file_name`, `tools` | `permissionMode`, `mcpServers`, `memory`, `model` |

## Approach / Architecture

Adopt **Approach A** from the research paper — **Unified Template with Platform Context Variable** — combining three complementary patterns:

1. **Pattern 1 (Conditionals):** Add `{{else}}` to the template engine. Use `{{#if target_vscode}}…{{else}}…{{/if}}` for small platform divergences in body templates.
2. **Pattern 2 (Separate Frontmatter):** Define `FRONTMATTER_VSCODE` and `FRONTMATTER_CLAUDE_CODE` templates in the build script. Frontmatter is structurally too different to conditionalize inline.
3. **Pattern 3 (Separate Output Dirs):** Output to `personas/ledger/vs-code/` and `personas/ledger/claude-code/` instead of `personas/ledger/`.

For the **handoff block** and **MCP pre-flight header** — where content is substantially different — create platform-specific partial variants selected at build time (Pattern 4, limited scope). Specifically:

- `handoff-block.md` → `handoff-block-vscode.md` + `handoff-block-claude-code.md`
- `mcp-preflight-header.md` → `mcp-preflight-header-vscode.md` + `mcp-preflight-header-claude-code.md`

The content templates will reference these via a platform-resolved partial name (e.g., `{{> handoff-block-vscode}}` or `{{> handoff-block-claude-code}}`), selected by the build script injecting the correct partial name into context, or by wrapping the partial references in `{{#if target_vscode}}…{{else}}…{{/if}}` blocks.

### Build Loop Changes

The build loop will execute **twice** when `--target all` (default): once with `target_vscode = true` writing to `personas/ledger/vs-code/`, and once with `target_claude_code = true` writing to `personas/ledger/claude-code/`. The frontmatter template selection is based on the active target. Body templates are identical — platform conditionals handle divergences.

### Sync Script Changes

The sync script gains a `--target` flag (`vscode | claude-code | all`, default `all`). Per target, it reads from the corresponding output directory and deploys to the platform-appropriate agents directory using the platform-appropriate filename field (`vs_file_name` or `cc_file_name`).

## Rationale

- **Unified template approach** minimizes duplication — ~90% of persona content is shared across platforms.
- **Separate frontmatter templates** are warranted because the frontmatter schemas diverge structurally (different required fields, different naming conventions).
- **Separate output directories** prevent filename collisions (VS Code uses `.agent.md`, CC uses `.md`) and make the sync script's job straightforward.
- **`{{else}}` support** is a small, high-value engine enhancement that simplifies all current and future conditional blocks (also eliminates the `no_detect_project` inverse boolean hack).
- **Platform-specific partials** for handoff and MCP pre-flight are cleaner than large inline conditional blocks because those sections are almost entirely different between platforms.
- **MCP server changes are deferred** — the CC handoff partial can use a deterministic convention (`N-role` naming) to map roles to CC agent names without requiring server-side changes. The agent registry dual-scan can be added in a follow-up.

## Detailed Steps

### Phase 1: Template Engine Enhancement

1. **Add `{{else}}` support to `resolveConditionals()`** in [scripts/build-personas.js](scripts/build-personas.js).
   - Update the regex from `{{#if flag}}…{{/if}}` to `{{#if flag}}…({{else}}…)?{{/if}}`.
   - When flag is truthy: keep content before `{{else}}`; when falsy: keep content after `{{else}}` (or remove block if no `{{else}}`).
   - The new regex: `/\n*\{\{#if (\w+)\}\}([\s\S]*?)(?:\{\{else\}\}([\s\S]*?))?\{\{\/if\}\}\n*/g`

2. **Refactor `no_detect_project` usage.** Replace all `{{#if no_detect_project}}…{{/if}}` blocks in content templates with `{{else}}` branches inside existing `{{#if has_detect_project}}…{{/if}}` blocks. Remove `no_detect_project` from the computed context in the build script.

3. **Update personas manifest documentation:**
   - [personas/docs/agents/project-manifest/api-surface.md](personas/docs/agents/project-manifest/api-surface.md) — Document `{{else}}` syntax, remove `no_detect_project` from computed variables.
   - [personas/docs/agents/project-manifest/constraints.md](personas/docs/agents/project-manifest/constraints.md) — Update constraint #4 (currently says "No `{{else}}` blocks").

### Phase 2: Multi-Target Build Infrastructure

4. **Add `--target` CLI flag** to [scripts/build-personas.js](scripts/build-personas.js).
   - Accepted values: `vscode`, `claude-code`, `all` (default: `all`).
   - Parse from `process.argv`.

5. **Create output directories.** Change `OUTPUT_DIR` from a single path to a target-dependent path:
   - `personas/ledger/vs-code/` (for VS Code output)
   - `personas/ledger/claude-code/` (for Claude Code output)
   - Existing `personas/ledger/*.md` generated files should be moved into `vs-code/` and the old flat output location should no longer be used.
   - `personas/ledger/README.md` stays at the `ledger/` root (it is hand-authored, not generated).

6. **Add `cc_file_name` and `cc_tools` fields** to all 7 per-persona YAML files in [personas/ledger/src/meta/](personas/ledger/src/meta/):
   - `cc_file_name`: follows `N-role.md` convention (e.g., `3-developer.md`, `4-qa.md`)
   - `cc_tools`: Claude Code tool names appropriate for each persona's permission level

   CC tool mapping per persona (derived from VS Code `tools` arrays):

   | Persona | VS Code `tools` | `cc_tools` |
   |---------|-----------------|------------|
   | 1-planner | `vscode, execute, read, edit, search, web, agent, todo` | `Bash, Read, Edit, Write, Grep, Glob, Task, WebFetch, WebSearch` |
   | 2-pm | `vscode, execute, read, edit, search, web, agent, todo, central_pm/*` | `Bash, Read, Edit, Write, Grep, Glob, Task, WebFetch, WebSearch` |
   | 3-developer | `vscode, execute, read, edit, search, web, agent, todo, central_pm/*` | `Bash, Read, Edit, Write, Grep, Glob, Task, WebFetch, WebSearch` |
   | 4-qa | `vscode, execute, read, edit, search, web, agent, todo, central_pm/*` | `Bash, Read, Edit, Write, Grep, Glob, Task, WebFetch, WebSearch` |
   | 5-reviewer | `vscode, execute, read, edit, search, web, agent, todo, central_pm/*` | `Bash, Read, Edit, Write, Grep, Glob, Task, WebFetch, WebSearch` |
   | 6-documentation | `vscode, execute, read, edit, search, web, agent, todo, central_pm/*` | `Bash, Read, Edit, Write, Grep, Glob, Task, WebFetch, WebSearch` |
   | 7-synthesis | `vscode, execute, read, edit, search, web, agent, todo, central_pm/*` | `Bash, Read, Edit, Write, Grep, Glob, Task, WebFetch, WebSearch` |

7. **Add CC-specific fields to `_shared.yaml`:**
   - `cc_permission_mode: "acceptEdits"` — autonomous workflow default
   - `cc_model: "inherit"` — defer to user's configured model
   - `cc_memory: "project"` — project-scoped memory

8. **Add platform feature flags to the build context.** For each target pass, set:
   - `target_vscode: true/false`
   - `target_claude_code: true/false`

9. **Define `FRONTMATTER_CLAUDE_CODE` template** in the build script:
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
   - `cc_name`: computed as kebab-case `N-role` (e.g., `3-developer`)
   - `cc_description`: more detailed than VS Code's `description` — Claude uses it for auto-delegation decisions
   - `cc_tools_json`: serialized CC tool names

10. **Add computed variables** for Claude Code context:
    - `cc_name`: derived from `number` and `role` → `"N-role"` (lowercase, kebab-case)
    - `cc_description`: richer description (can be a new field in per-persona YAML or computed from existing metadata)
    - `cc_tools_json`: serialized from `cc_tools` array

11. **Wrap the build loop in a target iteration.** When `--target all`, iterate over `['vscode', 'claude-code']`. For each target:
    - Set `target_vscode` / `target_claude_code` in context
    - Select appropriate `FRONTMATTER_*` template
    - Set `OUTPUT_DIR` to the target-specific directory

### Phase 3: Platform-Specific Partials

12. **Create `handoff-block-vscode.md`** — Move current content from `handoff-block.md` (references `runSubagent`).

13. **Create `handoff-block-claude-code.md`** — New partial with Claude Code handoff instructions:
    - Instructs the agent to call the `Task` tool instead of `runSubagent`
    - Maps `auto_handoff.agent_name` to the CC agent name convention
    - Includes a static role→CC-name mapping table or a deterministic extraction rule (strip version, lowercase, replace spaces with hyphens, prepend number)

14. **Create `mcp-preflight-header-vscode.md`** — Move current content from `mcp-preflight-header.md` (references `tool_search_tool_regex`).

15. **Create `mcp-preflight-header-claude-code.md`** — New partial with CC MCP pre-flight:
    - States that MCP tools are natively available (no deferred loading)
    - References `MCPSearch` as fallback if tools aren't visible

16. **Update content templates** that reference `{{> handoff-block}}` and `{{> mcp-preflight-header}}` to use platform-conditional partial inclusion:
    ```
    {{#if target_vscode}}
    {{> handoff-block-vscode}}
    {{else}}
    {{> handoff-block-claude-code}}
    {{/if}}
    ```

17. **Remove the original `handoff-block.md` and `mcp-preflight-header.md`** once all references are updated to the platform-specific variants.

### Phase 4: Sync Script Extension

18. **Add `--target` flag** to [scripts/sync-personas.js](scripts/sync-personas.js).
    - Accepted values: `vscode`, `claude-code`, `all` (default: `all`).

19. **Add `getClaudeCodeAgentsDir()` function:**
    - Returns `~/.claude/agents/` (cross-platform: `path.join(os.homedir(), '.claude', 'agents')`)

20. **Add `extractCCFileName()` function:**
    - Parses YAML frontmatter to extract `cc_file_name` field (analogous to `extractVSFileName`).
    - Alternatively, extract the `name` field from CC frontmatter and append `.md`.

21. **Update `syncPersonas()` to accept a target parameter.** Based on target:
    - `vscode`: read from `personas/ledger/vs-code/`, use `extractVSFileName`, deploy to `getVSCodePromptsDir()`
    - `claude-code`: read from `personas/ledger/claude-code/`, use `extractCCFileName`, deploy to `getClaudeCodeAgentsDir()`
    - `all`: run both

22. **Pass `--target` through to `build-personas.js`** when the sync script spawns it.

23. **Update frontmatter validation** to handle CC-specific fields (`name` format, `permissionMode`, etc.).

### Phase 5: Content Template Adjustments

24. **Audit all content templates** in [personas/ledger/src/content/](personas/ledger/src/content/) for VS Code–specific references that need platform conditionals:
    - References to `tool_search_tool_regex` outside the MCP pre-flight header
    - References to `runSubagent` outside the handoff block
    - References to VS Code–specific tool names or behaviors
    - References to file extensions (`.agent.md`)

25. **Add platform conditionals** where needed. Most body content is platform-agnostic; only the partials and frontmatter differ significantly. Inline conditionals should be minimal.

### Phase 6: Migration & Path Updates

26. **Move existing generated files** from `personas/ledger/*.md` to `personas/ledger/vs-code/`.

27. **Update all references** to the old output location:
    - [personas/docs/agents/project-manifest/file-tree.md](personas/docs/agents/project-manifest/file-tree.md) — New directory structure
    - [personas/docs/agents/project-manifest/constraints.md](personas/docs/agents/project-manifest/constraints.md) — Source editing rules reference new subdirectories
    - [personas/ledger/README.md](personas/ledger/README.md) — Update paths to generated files
    - [AGENTS.md](AGENTS.md) — Update navigation reference for generated persona output
    - [scripts/sync-personas.js](scripts/sync-personas.js) — `excludeDirs` and discovery paths
    - [scripts/build-personas.js](scripts/build-personas.js) — `--check` mode paths
    - Any other scripts or docs referencing `personas/ledger/*.md`

28. **Update `.gitignore`** (if applicable) to include the new output directories.

### Phase 7: Standalone Personas

29. **Add Claude Code variants for standalone personas** in [personas/standalone/](personas/standalone/). These are hand-authored (not auto-generated), so CC variants can either be:
    - Manual CC-formatted copies in a `standalone/claude-code/` subdirectory
    - Brought into a lightweight build step that generates CC frontmatter

    Given these are simple files with no handoff blocks or MCP tools, the main change is frontmatter adaptation (name format, tool slugs). A lightweight approach: add CC frontmatter as a second YAML block in each file, or create a simple script that transforms the frontmatter.

### Phase 8: Documentation & Manifest Updates

30. **Update personas manifest** ([personas/docs/agents/project-manifest/](personas/docs/agents/project-manifest/)):
    - [README.md](personas/docs/agents/project-manifest/README.md) — New build commands, `--target` flag, multi-IDE overview
    - [tech-stack.md](personas/docs/agents/project-manifest/tech-stack.md) — If any new dependencies are added
    - [constraints.md](personas/docs/agents/project-manifest/constraints.md) — Updated template limitations (now has `{{else}}`), new naming conventions for CC files, new output directory rules
    - [file-tree.md](personas/docs/agents/project-manifest/file-tree.md) — New directory structure with `vs-code/` and `claude-code/` subdirectories, new partial files
    - [api-surface.md](personas/docs/agents/project-manifest/api-surface.md) — Updated `resolveConditionals` signature, new `FRONTMATTER_CLAUDE_CODE` template, `{{else}}` syntax, new computed variables, new metadata fields (`cc_file_name`, `cc_tools`, etc.), new sync script functions
    - [data-flows.md](personas/docs/agents/project-manifest/data-flows.md) — Updated build pipeline flow (dual-target), updated sync pipeline (target-dependent)

31. **Update root [AGENTS.md](AGENTS.md)** — Cross-project navigation and dependency table updates.

32. **Update root [README.md](README.md)** if it references persona build/sync commands.

33. **Update [personas/changelog.md](personas/changelog.md)** with the new feature.

## Dependencies

- **`{{else}}` support** (Step 1) is a prerequisite for all content template changes.
- **Output directory restructure** (Steps 5, 26) must happen before the dual-target build loop can write to the new locations.
- **CC metadata fields** (Steps 6–7) must be added before the CC frontmatter template can be rendered.
- **Platform-specific partials** (Steps 12–17) must exist before the dual-target build produces correct CC output.
- **Sync script changes** (Steps 18–23) depend on the new output directory structure and CC metadata fields.

Sequencing: Phase 1 → Phase 2 → Phase 3 → Phase 5 → Phase 6 → Phase 4 → Phase 7 → Phase 8

## Required Components

### Modified Files

| File | Change |
|------|--------|
| [scripts/build-personas.js](scripts/build-personas.js) | `{{else}}` support, `--target` flag, dual frontmatter templates, dual-target build loop, new computed variables, output directory logic |
| [scripts/sync-personas.js](scripts/sync-personas.js) | `--target` flag, `getClaudeCodeAgentsDir()`, `extractCCFileName()`, target-dependent sync routing |
| [personas/ledger/src/meta/_shared.yaml](personas/ledger/src/meta/_shared.yaml) | `cc_permission_mode`, `cc_model`, `cc_memory` fields |
| [personas/ledger/src/meta/1-planner.yaml](personas/ledger/src/meta/1-planner.yaml) | `cc_file_name`, `cc_tools` |
| [personas/ledger/src/meta/2-project-manager.yaml](personas/ledger/src/meta/2-project-manager.yaml) | `cc_file_name`, `cc_tools` |
| [personas/ledger/src/meta/3-developer.yaml](personas/ledger/src/meta/3-developer.yaml) | `cc_file_name`, `cc_tools` |
| [personas/ledger/src/meta/4-qa.yaml](personas/ledger/src/meta/4-qa.yaml) | `cc_file_name`, `cc_tools` |
| [personas/ledger/src/meta/5-reviewer.yaml](personas/ledger/src/meta/5-reviewer.yaml) | `cc_file_name`, `cc_tools` |
| [personas/ledger/src/meta/6-documentation.yaml](personas/ledger/src/meta/6-documentation.yaml) | `cc_file_name`, `cc_tools` |
| [personas/ledger/src/meta/7-synthesis.yaml](personas/ledger/src/meta/7-synthesis.yaml) | `cc_file_name`, `cc_tools` |
| Content templates (7 files in `personas/ledger/src/content/`) | Platform conditionals for handoff and MCP pre-flight partial references |

### New Files

| File | Purpose |
|------|---------|
| `personas/ledger/src/partials/handoff-block-vscode.md` | VS Code handoff instructions (current `handoff-block.md` content) |
| `personas/ledger/src/partials/handoff-block-claude-code.md` | Claude Code handoff instructions (Task tool) |
| `personas/ledger/src/partials/mcp-preflight-header-vscode.md` | VS Code MCP pre-flight (tool_search_tool_regex) |
| `personas/ledger/src/partials/mcp-preflight-header-claude-code.md` | Claude Code MCP pre-flight (native loading) |
| `personas/ledger/vs-code/` | **NEW directory** — VS Code generated output (7 files) |
| `personas/ledger/claude-code/` | **NEW directory** — Claude Code generated output (7 files) |

### Removed Files

| File | Reason |
|------|--------|
| `personas/ledger/src/partials/handoff-block.md` | Replaced by platform-specific variants |
| `personas/ledger/src/partials/mcp-preflight-header.md` | Replaced by platform-specific variants |
| `personas/ledger/1-planner.md` through `7-synthesis.md` | Moved into `personas/ledger/vs-code/` |

## Assumptions

- Claude Code's `Task` tool accepts `agent_type` matching the `name` frontmatter field to identify subagents.
- The `N-role` naming convention (e.g., `3-developer`) will work as Claude Code agent identifiers.
- Claude Code auto-discovers agents from `~/.claude/agents/` without requiring additional configuration.
- `permissionMode: acceptEdits` is appropriate for the autonomous ledger workflow in Claude Code.
- `memory: project` is the correct scope for project-specific agent work.
- CC frontmatter accepts `mcpServers` as a list of server names referencing `.mcp.json` entries.
- The existing `role-boundaries.md` partial and other shared partials are platform-agnostic and need no changes.

## Constraints

- **No breaking changes to VS Code output.** The VS Code persona files must be identical in content to what they are today (just moved to the `vs-code/` subdirectory).
- **The sync script must remain backward-compatible** — running without `--target` defaults to syncing both platforms.
- **No new npm dependencies** for the persona build system.
- **Generated files must not be edited directly** — this rule extends to both `vs-code/` and `claude-code/` output directories.
- **`KNOWN_ROLES` and `AGENT_ROLES` sync contract** — this cross-project dependency is unchanged.
- **Template engine changes must be backward-compatible** — existing `{{#if flag}}…{{/if}}` without `{{else}}` must continue to work.

## Out of Scope

- **MCP server agent registry dual-scan** — Extending `agent-registry.ts` to scan `~/.claude/agents/` is recommended but deferred to a follow-up work package. The CC handoff partial uses a deterministic naming convention instead.
- **`buildHandoffResponse` changes** — Adding `cc_agent_name` to the auto-handoff payload is deferred. The CC handoff partial extracts the role from the response and applies the naming convention locally.
- **Vanilla personas** — CC variants of the vanilla (non-ledger) personas are not needed at this time.
- **Windows/Linux Claude Code paths** — Claude Code is primarily macOS-focused; cross-platform CC paths can be added later if needed.
- **CI/CD integration** — Automated build/check in CI pipelines is a separate concern.
- **Claude Code project-level agents** (`.claude/agents/` in the project root) — Only global agent deployment (`~/.claude/agents/`) is in scope.

## Acceptance Criteria

1. `node scripts/build-personas.js` (no flags) produces output in both `personas/ledger/vs-code/` and `personas/ledger/claude-code/`.
2. `node scripts/build-personas.js --target vscode` produces output only in `personas/ledger/vs-code/`.
3. `node scripts/build-personas.js --target claude-code` produces output only in `personas/ledger/claude-code/`.
4. VS Code output files in `personas/ledger/vs-code/` are content-identical to the current `personas/ledger/` output (before the directory move).
5. Claude Code output files have correct CC-format frontmatter: kebab-case `name`, CC tool names, `permissionMode`, `mcpServers`, `memory`, `model`.
6. Claude Code output files reference the `Task` tool (not `runSubagent`) in handoff instructions.
7. Claude Code output files reference native MCP loading (not `tool_search_tool_regex`) in the MCP pre-flight section.
8. `{{else}}` blocks work correctly in `resolveConditionals()`: truthy → content before `{{else}}`; falsy → content after `{{else}}`; no `{{else}}` → existing behavior unchanged.
9. `no_detect_project` inverse boolean is removed from the build context and all `{{#if no_detect_project}}` blocks are converted to `{{else}}` branches.
10. `node scripts/build-personas.js --check` validates both output directories.
11. `node scripts/sync-personas.js` syncs VS Code output to the VS Code prompts dir and CC output to `~/.claude/agents/`.
12. `node scripts/sync-personas.js --target claude-code` syncs only CC output.
13. All persona manifest documents are updated to reflect the new architecture.
14. No regressions in existing VS Code persona functionality.

## Testing Strategy

1. **Unit test `resolveConditionals()`** — verify `{{else}}` behavior:
   - Flag truthy with `{{else}}` → keeps content before `{{else}}`
   - Flag falsy with `{{else}}` → keeps content after `{{else}}`
   - Flag truthy without `{{else}}` → existing behavior (keeps content)
   - Flag falsy without `{{else}}` → existing behavior (removes block)
   - Nested conditionals with `{{else}}`

2. **Snapshot comparison** — before starting, capture the current VS Code output. After the migration, compare `personas/ledger/vs-code/` output against the snapshot to ensure zero regressions.

3. **CC output validation** — manually inspect Claude Code output files for:
   - Correct frontmatter schema
   - No VS Code–specific references (`runSubagent`, `tool_search_tool_regex`, `.agent.md`, `vs_file_name`)
   - Correct CC tool names and handoff instructions

4. **`--check` mode** — run `node scripts/build-personas.js --check` after a clean build to verify all output is up-to-date for both targets.

5. **Sync dry-run** — `node scripts/sync-personas.js --dry-run --target claude-code` to verify correct deployment paths and filenames.

6. **End-to-end** — deploy CC personas to `~/.claude/agents/`, launch Claude Code, and verify agents are discovered and functional.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Template readability degrades** with platform conditionals | Limit inline conditionals to partial selection (`{{> handoff-block-*}}`). Keep body templates clean. Most divergence is handled by separate frontmatter templates and platform-specific partials. |
| **Claude Code frontmatter schema changes** | Pin to documented CC v1.x agent format. Monitor CC release notes. Frontmatter is isolated in one template — easy to update. |
| **Output directory move breaks external references** | Search workspace and documentation exhaustively for `personas/ledger/*.md` references. Update sync script, manifests, AGENTS.md, README. |
| **CC `Task` tool API differs from documentation** | Validate against live Claude Code before finalizing the handoff partial. Keep the partial simple so it's easy to adjust. |
| **Standalone persona CC variants drift from ledger personas** | Consider bringing standalone personas into a lightweight build step in a follow-up to ensure consistency. |
| **`resolveConditionals()` regex becomes fragile** with `{{else}}` | Use non-greedy matching. Test edge cases: empty branches, adjacent conditionals, nested conditionals. The regex is well-bounded by `{{#if}}` / `{{/if}}` delimiters. |
