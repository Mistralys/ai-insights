# Plan

## Summary

Convert the Claude Code skill `.claude/skills/project-ledger.md` into a proper standalone persona in the existing `personas/standalone/` build system. The skill, which orchestrates the multi-agent ledger-backed development pipeline, behaves more like an agent than a procedure: it has a persistent identity, enforces strict tool restrictions, and manages an isolated context window. Moving it into the build system means it gets versioned, built, and synced alongside all other personas, and gains proper `mcpServers:` injection in Claude Code output. The skill file is deleted once the persona is live.

## Architectural Context

The project has a Node.js persona build system (`scripts/build-personas.js`) with two suites:

- **`ledger`** — 7 numbered pipeline agents backed by the `central_pm` MCP server
- **`standalone`** — unnumbered special-purpose agents (currently 11 personas)

Each suite has `src/meta/` (YAML metadata), `src/content/` (Markdown body templates), and generates to `vs-code/` and `claude-code/` output directories via `scripts/build-personas.js`. Outputs are deployed to IDEs via `scripts/sync-personas.js`.

The standalone Claude Code frontmatter template (`FRONTMATTER_STANDALONE_CC`, ~line 474 of `build-personas.js`) currently hard-codes "no `mcpServers:`". The ledger template always includes `mcpServers:`. The workflow orchestrator persona needs `mcpServers: central_pm` in Claude Code output — so the standalone template must be enhanced with a conditional block.

A second gap: frontmatter rendering at ~line 665 runs only `resolveVariables(fmTemplate, context)`. The `{{#if}}` template syntax (already supported by `resolveConditionals`) is never applied to frontmatter. This must be fixed before the conditional `mcpServers:` block can work.

The `mcp_server_name` field is absent from the standalone `_shared.yaml` by design (standalone personas have no MCP dependency). The per-persona YAML spread (`...persona` in the context) already takes precedence over shared metadata, so `mcp_server_name` can be added directly in the per-persona YAML without touching `_shared.yaml`.

The project manifest docs (`personas/docs/agents/project-manifest/`) will need updating to reflect the new persona, the enhanced frontmatter template, and the new `mcp_server_name` per-persona YAML field.

## Approach / Architecture

1. Enhance `FRONTMATTER_STANDALONE_CC` with a `{{#if mcp_server_name}}` block for optional `mcpServers:` injection.
2. Pipe frontmatter through `resolveConditionals` before `resolveVariables` so the new conditional renders correctly.
3. Create the two new source files (`workflow-orchestrator.yaml` and `workflow-orchestrator.md`) following existing standalone conventions.
4. Build and validate with `--strict`.
5. Update project manifest docs.
6. Delete the now-superseded skill file.
7. Sync to both IDEs.

No changes to `_shared.yaml`, the sync script, or any other persona. Changes are additive and backward-compatible: existing standalone personas that omit `mcp_server_name` will simply resolve the conditional to nothing, leaving their output unchanged.

## Rationale

- **Agent over skill:** Skills inherit the caller's tools and run in shared context. The workflow orchestrator needs enforced tool restrictions (`tools:` frontmatter) and context isolation — both are properties of agents, not skills.
- **Build system over raw file:** Using the build system ensures the persona is versioned, documented, and built/synced consistently with the other personas. A raw `.claude/agents/` file would be an orphan outside the build pipeline.
- **Conditional `mcpServers:` over always-on:** Only the workflow orchestrator (and potentially future MCP-backed standalone personas) needs `mcpServers:`. The conditional approach is surgical — no impact on the 11 existing standalone personas.
- **Per-persona `mcp_server_name` over `_shared.yaml`:** The standalone suite's design principle is no MCP dependency at the suite level. Adding `mcp_server_name` per-persona preserves this and keeps the opt-in explicit.

## Detailed Steps

1. **`scripts/build-personas.js` — pipe frontmatter through `resolveConditionals`**
   - At ~line 665, change:
     ```javascript
     const frontmatter = resolveVariables(fmTemplate, context, yamlFile);
     ```
     to:
     ```javascript
     let frontmatter = resolveConditionals(fmTemplate, context);
     frontmatter = resolveVariables(frontmatter, context, yamlFile);
     ```

2. **`scripts/build-personas.js` — add conditional `mcpServers:` to `FRONTMATTER_STANDALONE_CC`**
   - The comment on ~line 462 says "no role, no mcpServers" — update it to reflect the new conditional.
   - Insert the block before the closing `---`:
     ```
     {{#if mcp_server_name}}
     mcpServers:
       - {{mcp_server_name}}
     {{/if}}
     ```

3. **Create `personas/standalone/src/meta/workflow-orchestrator.yaml`**
   - Fields: `slug`, `name`, `description`, `vs_file_name`, `id`, `cc_file_name`, `version`, `last_updated`, `tools`, `cc_tools`, `mcp_server_name`
   - `slug`: `workflow-orchestrator`
   - `name`: `"Workflow Orchestrator"`
   - `description`: `"Coordinate the multi-stage agentic pipeline by consulting the central_pm ledger and dispatching work to the correct sub-agent."`
   - `vs_file_name`: `workflow-orchestrator.agent.md`
   - `id`: `standalone-workflow-orchestrator`
   - `cc_file_name`: `workflow-orchestrator.md`
   - `version`: `"1.0.0"`
   - `last_updated`: `"2026-03-19"`
   - `mcp_server_name`: `central_pm`
   - VS Code `tools`: `vscode`, `execute`, `read`, `edit`, `search`, `agent`, `mcp` (needs agent dispatch and MCP read access)
   - CC `tools`: `Task` (to dispatch sub-agents), `Read`, `Grep` (for codebase queries only; no write tools — the orchestrator must not edit files)

4. **Create `personas/standalone/src/content/workflow-orchestrator.md`**
   - Adapt the body of `.claude/skills/project-ledger.md` (lines 7–128), replacing any "skill" references with "agent" terminology.
   - Wrap MCP preflight/tool-specific blocks in `{{#if target_claude_code}}` / `{{else}}` / `{{/if}}` where VS Code and Claude Code differ (particularly Step 1 `ledger_detect_project` call and tool name references if needed).
   - The body is identical for both IDE targets except for any platform-specific tool invocation patterns.

5. **Build and verify**
   ```bash
   node scripts/build-personas.js --suite standalone --strict
   ```
   Confirm:
   - Two new files appear: `personas/standalone/vs-code/workflow-orchestrator.agent.md` and `personas/standalone/claude-code/workflow-orchestrator.md` (note: `vs-code/` output uses `vs_file_name` — file will be `workflow-orchestrator.agent.md`)
   - Claude Code output contains `mcpServers:\n  - central_pm`
   - VS Code output does NOT contain `mcpServers:`
   - No `[WARN]` or `[STRICT]` failures
   - All 11 existing standalone personas produce byte-for-byte identical output (run `--check` to confirm)

6. **Update project manifest docs**
   - `personas/docs/agents/project-manifest/file-tree.md`: Add `workflow-orchestrator.yaml` to `standalone/src/meta/`, `workflow-orchestrator.md` to `standalone/src/content/`, and both output files to `standalone/vs-code/` and `standalone/claude-code/`.
   - `personas/docs/agents/project-manifest/api-surface.md`:
     - Update `FRONTMATTER_STANDALONE_CC` description: replace "no role, no mcpServers" with "no role; optional mcpServers via `{{#if mcp_server_name}}`"
     - Update the standalone `_shared.yaml` note: clarify that `mcp_server_name` is absent from `_shared.yaml` but CAN be set per-persona
     - Add `mcp_server_name` row to the standalone per-persona YAML schema table

7. **Delete `.claude/skills/project-ledger.md`**
   - Remove the file once the persona builds successfully and the sync confirms the Claude Code agent file is in place.

8. **Sync to both IDEs**
   ```bash
   node scripts/sync-personas.js
   ```

## Dependencies

- `scripts/build-personas.js` must be modified before the persona source files can be created or tested
- `workflow-orchestrator.yaml` and `workflow-orchestrator.md` must exist before the build step
- Build must pass `--strict` before the manifest docs update (to confirm final output shape)
- Sync must run after the build and docs update steps

## Required Components

- `scripts/build-personas.js` — 2 targeted edits (~line 462 comment, ~line 474 template, ~line 665 frontmatter render call)
- `personas/standalone/src/meta/workflow-orchestrator.yaml` — new file
- `personas/standalone/src/content/workflow-orchestrator.md` — new file
- `personas/standalone/vs-code/workflow-orchestrator.agent.md` — generated output (not hand-edited)
- `personas/standalone/claude-code/workflow-orchestrator.md` — generated output (not hand-edited)
- `personas/docs/agents/project-manifest/file-tree.md` — update
- `personas/docs/agents/project-manifest/api-surface.md` — update
- `.claude/skills/project-ledger.md` — delete after build

## Assumptions

- The `resolveConditionals` regex (`/\n*\{\{#if (\w+)\}\}([\s\S]*?)(?:\{\{else\}\}([\s\S]*?))?\{\{\/if\}\}\n*/g`) correctly handles conditionals in frontmatter YAML strings — the regex is not context-sensitive and operates on raw text, so this should work.
- No existing standalone persona has `mcp_server_name` set in its YAML, so the build change is backward-compatible by construction.
- The VS Code output for standalone personas does not include `mcpServers:` regardless (only the CC template has the conditional), so no VS Code-side changes are needed.
- The `validateStandaloneCCFrontmatter` function in `sync-personas.js` does not reject unknown frontmatter keys — `mcpServers:` will pass through silently.

## Constraints

- Do not modify `personas/standalone/src/meta/_shared.yaml` — the `mcp_server_name` field must be per-persona only.
- Do not add `mcpServers:` to `FRONTMATTER_STANDALONE_VSCODE` — VS Code does not use that field.
- The workflow orchestrator CC tools list must NOT include write tools (`Edit`, `Write`, `Bash`) — the orchestrator must not edit files. Only `Task` (for agent dispatch) and read-only tools.
- Agent name references in the body must match the exact Claude Code agent names derived from `cc_file_name`: `1-planner`, `2-project-manager`, `3-developer`, `4-qa`, `5-reviewer`, `6-documentation`, `7-synthesis`.
- The `FRONTMATTER_STANDALONE_CC` template change must be tested against all 11 existing standalone personas to confirm no regressions (`--check` flag).

## Out of Scope

- Changes to the ledger suite or its 7 personas
- Changes to `scripts/sync-personas.js` (no new validation logic needed)
- Changes to the MCP server (`mcp-server/`)
- Adding `mcpServers:` support to the VS Code standalone frontmatter template
- Adding `mcpServers:` to the standalone `_shared.yaml`
- Any changes to other standalone personas

## Acceptance Criteria

- `node scripts/build-personas.js --suite standalone --strict` exits 0 with no warnings
- `node scripts/build-personas.js --suite standalone --check` exits 0 (no stale output after build)
- `personas/standalone/claude-code/workflow-orchestrator.md` contains `mcpServers:` with `central_pm`
- `personas/standalone/vs-code/workflow-orchestrator.agent.md` does NOT contain `mcpServers:`
- All 11 pre-existing standalone personas produce identical output to their pre-change baseline (verified via `--check` on a clean build)
- `.claude/skills/project-ledger.md` is deleted
- `personas/docs/agents/project-manifest/file-tree.md` lists the new persona files
- `personas/docs/agents/project-manifest/api-surface.md` documents the `mcp_server_name` per-persona field and the updated `FRONTMATTER_STANDALONE_CC` description
- `node scripts/sync-personas.js` completes without errors and deploys `workflow-orchestrator.md` to `~/.claude/agents/`

## Testing Strategy

The build system is self-validating via `--strict` (unresolved markers) and `--check` (stale output detection). The primary test strategy is:

1. Build the standalone suite with `--strict` to catch any unresolved `{{variable}}` or `{{#if}}` markers in the new persona output.
2. Manually inspect the generated `workflow-orchestrator.md` (Claude Code) to confirm `mcpServers:` injection is present and correctly formatted.
3. Manually inspect the generated `workflow-orchestrator.agent.md` (VS Code) to confirm `mcpServers:` is absent.
4. Run `--check` to verify all 11 existing standalone personas are byte-for-byte unchanged.
5. Run the sync script and confirm the file appears in `~/.claude/agents/`.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **`resolveConditionals` in frontmatter YAML produces malformed YAML** (e.g. extra blank lines from the regex's `\n` normalization) | Inspect raw generated frontmatter output before sync; the regex strips leading/trailing newlines from inner content so YAML indentation should be preserved |
| **Existing standalone personas gain spurious `[WARN]` about unknown `mcp_server_name`** | Variable warnings are only emitted for `{{variable}}` markers that appear in the template — the conditional block wraps the variable, so if the flag is falsy the variable marker is never evaluated |
| **`validateStandaloneCCFrontmatter` in `sync-personas.js` fails on `mcpServers:` key** | Check the validation function before syncing; if it validates only known keys, add `mcpServers` to its allowed list |
| **Confusion between `workflow-orchestrator` (new) and `orchestrator-runner` (existing)** | Names differ sufficiently; `orchestrator-runner` launches orchestrator pipelines from plan documents, `workflow-orchestrator` dispatches the agent pipeline itself |
