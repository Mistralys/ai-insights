# Synthesis Report: workflow-orchestrator-persona

**Project:** 2026-03-19-workflow-orchestrator-persona
**Date:** 2026-03-19
**Status:** COMPLETE

---

## Executive Summary

This session introduced the `workflow-orchestrator` as a first-class standalone persona in the ai-insights persona build system. The persona replaces a now-deleted skill file (`.claude/skills/project-ledger.md`) and is deployed as a Claude Code agent with full access to the `central_pm` MCP server. The work required both a new build system capability (per-persona `mcpServers` injection via Handlebars conditionals) and the authoring of the persona source files themselves.

The end state is 24 standalone personas (12 VS Code + 12 Claude Code) building cleanly with `--strict` and `--check`, with `workflow-orchestrator` as the sole persona carrying an `mcpServers` block in the Claude Code output. All pre-existing personas are regression-free.

---

## What Was Delivered

### WP-001 — Build system: per-persona mcpServers injection

- `scripts/build-personas.js` was updated to support a new `mcp_server_name` field in per-persona YAML metadata.
- `FRONTMATTER_STANDALONE_CC` now includes a `{{#if mcp_server_name}}...{{/if}}` block.
- The frontmatter rendering pipeline was updated to run `resolveConditionals` before `resolveVariables`, ensuring the conditional block collapses correctly for personas that do not set `mcp_server_name`.

### WP-002 — Persona source files

- `personas/standalone/src/meta/workflow-orchestrator.yaml` — metadata with `mcp_server_name: central_pm`, `cc_tools: [Task, Read, Grep]`, and all required fields.
- `personas/standalone/src/content/workflow-orchestrator.md` — full agent content with `{{#if target_claude_code}}` conditionals where tool naming differs between targets. No mentions of "skill" remain.

### WP-003 — Build and verify

- Both `--strict` and `--check` pass with 24 files.
- Claude Code output contains the correct `mcpServers: {central_pm: ...}` block.
- VS Code output contains no `mcpServers` block.

### WP-004 — Manifest documentation

- `personas/docs/agents/project-manifest/file-tree.md` updated with all four new/generated workflow-orchestrator file paths.
- `personas/docs/agents/project-manifest/api-surface.md` updated with `mcp_server_name` schema entry, revised `FRONTMATTER_STANDALONE_CC` description, and clarification that `mcp_server_name` is per-persona (absent from `_shared.yaml`).

### WP-005 — Skill file deletion and deployment sync

- `.claude/skills/project-ledger.md` deleted from the filesystem (file was untracked in git).
- `node scripts/sync-personas.js` ran cleanly: 38 personas built across 2 suites x 2 targets.
- `~/.claude/agents/workflow-orchestrator.md` deployed with `mcpServers: central_pm`.
- `workflow-orchestrator.agent.md` deployed to the VS Code prompts directory.

---

## Metrics

| Metric | Value |
|---|---|
| Work packages completed | 5 / 5 |
| Acceptance criteria verified | 9 / 9 (cross-WP QA sweep) |
| Standalone personas built | 24 (12 VS Code + 12 Claude Code) |
| Pre-existing persona regressions | 0 |
| Build warnings (`--strict`) | 0 |
| QA tests passed | 16 (7 WP-001 + 9 final sweep) |
| QA tests failed | 0 |
| Blocking issues found in review | 0 |

---

## Strategic Recommendations

### Gold Nuggets

1. **The `mcp_server_name` opt-in model is the right pattern.** Keeping `mcpServers` absent from `_shared.yaml` and requiring explicit per-persona opt-in prevents accidental MCP scope creep. Future personas requiring MCP access follow the same pattern: add `mcp_server_name: <server>` to the YAML metadata. No build system changes needed.

2. **The conditional frontmatter approach is extensible.** The `{{#if mcp_server_name}}` block can be adapted for other optional frontmatter fields (e.g., future `allowedTools`, `permissionMode` overrides) without changing the pipeline architecture. The `resolveConditionals`-before-`resolveVariables` ordering in the rendering pipeline is now correctly established.

3. **The `workflow-orchestrator` persona is the first multi-agent coordinator in the standalone suite.** This creates a usable pattern for future personas that need to orchestrate sub-agents or integrate external tooling. The tool restriction to `[Task, Read, Grep]` (no write tools in CC) is a deliberate safety constraint and should be maintained for any similar orchestration personas.

---

## Tracked Technical Debt

These items were flagged by the implementation and review pipelines. None are blocking; all are low-priority cosmetic or architectural notes.

| ID | Priority | Location | Description |
|---|---|---|---|
| D-001 | Low | `scripts/build-personas.js` lines 260, 264, 267, 435 | Four pre-existing single-slash comments (`/ Truthy:`, `/ Falsy with:`, `/ Falsy without:`, `/ LEDGER`) are missing their second slash. Cosmetic only; no runtime impact. Recommend a single cleanup commit at a convenient time. |
| D-002 | Medium | `scripts/build-personas.js` line 429 (`ccFrontmatterFields()`) | The docblock warns about potential ledger/standalone CC frontmatter divergence. That divergence has now partially materialized: standalone CC uses a conditional `mcpServers` block while the ledger suite uses an unconditional one. The function is not yet affected (it only covers `permissionMode`, `model`, `memory`), but if a third suite-specific frontmatter variation appears, the function should be split or parameterized by suite. |
| D-003 | Low | `personas/standalone/src/content/workflow-orchestrator.md` line 129 | The "What You Must NEVER Do" section enumerates mutating ledger tools by name. This list will drift as new ledger tools are added. Consider replacing with a policy reference to "all ledger_* tools not in the read/query list above" for lower maintenance burden, or accept the explicit list as intentional (it provides clearer guidance). |

---

## Follow-up Items for the Next Cycle

- **Commit the staged changes.** The build output, documentation updates, and `build-personas.js` changes are staged and ready. A commit with a descriptive message (e.g., "feat: add workflow-orchestrator persona with mcpServers support") should be created.
- **Address D-001 comment typos** in a separate cleanup commit to keep the fix atomic and easy to review.
- **Monitor D-002** as the persona suite grows. If a third suite variant requires distinct `ccFrontmatterFields()` behavior, split or parameterize at that point.
- **Validate deployment** by running the `workflow-orchestrator` persona in a live session to confirm the `central_pm` MCP tools are accessible as expected.
