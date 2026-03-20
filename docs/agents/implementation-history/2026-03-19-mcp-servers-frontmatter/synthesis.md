# Synthesis Report — MCP Servers Frontmatter

**Project:** 2026-03-19-mcp-servers-frontmatter
**Date:** 2026-03-19
**Status:** COMPLETE

---

## Executive Summary

This project resolved a silent documentation-reality gap in the persona build system. The standalone `ledger-bootstrapper` persona was documented as having `mcpServers: central_pm` auto-injected into its Claude Code frontmatter, but the build did not produce this output because `ledger-bootstrapper.yaml` lacked the `mcp_server_name` field that the `{{#if mcp_server_name}}` conditional in `FRONTMATTER_STANDALONE_CC` requires.

The fix was a single-field YAML addition (`mcp_server_name: central_pm`) mirroring the established `workflow-orchestrator.yaml` pattern, plus three documentation corrections that removed references to a superseded `{{mcp_servers_yaml}}` injection mechanism. The full persona build (50 files) passes `--check --strict` cleanly after the change.

---

## Work Packages

| WP | Title | Status | Assigned To |
|----|-------|--------|-------------|
| WP-001 | Add `mcp_server_name` to `ledger-bootstrapper` and correct stale documentation | COMPLETE | Documentation |

---

## Metrics

| Metric | Value |
|--------|-------|
| Work packages total | 1 |
| Work packages complete | 1 |
| Acceptance criteria met | 7 / 7 |
| Pipelines run | 5 (implementation, qa, code-review, documentation x2) |
| Pipelines passed | 5 |
| Pipelines failed | 0 |
| Files modified | 5 (4 source + 1 regenerated output) |

---

## Acceptance Criteria — Final Status

| Criterion | Met |
|-----------|-----|
| `personas/standalone/claude-code/ledger-bootstrapper.md` contains `mcpServers:\n  - central_pm` in YAML frontmatter after rebuild | Yes |
| All other standalone CC files remain unchanged (no new `mcpServers` blocks) | Yes |
| All 9 ledger CC files retain their existing `mcpServers` blocks unchanged | Yes |
| `node scripts/build-personas.js --suite all --check --strict` exits 0, zero `[WARN]` or `[STRICT]` lines | Yes |
| Comment at ~line 301 of `scripts/build-personas.js` no longer references `{{mcp_servers_yaml}}` | Yes |
| `personas/docs/agents/project-manifest/api-surface.md` no longer describes `{{mcp_servers_yaml}}` as the active standalone CC injection mechanism | Yes |
| `personas/docs/agents/project-manifest/file-tree.md` annotation for `ledger-bootstrapper.md` accurately describes `mcp_server_name` YAML field as the trigger | Yes |

---

## Changes Delivered

| File | Change Type | Description |
|------|------------|-------------|
| `personas/standalone/src/meta/ledger-bootstrapper.yaml` | Modified — source | Added `mcp_server_name: central_pm` after `last_updated` field |
| `scripts/build-personas.js` | Modified — comment | Corrected stale comment at ~line 301: removed `{{mcp_servers_yaml}}` reference, now accurately describes `{{#if mcp_server_name}}` |
| `personas/docs/agents/project-manifest/api-surface.md` | Modified — docs | `{{mcp_servers_yaml}}` row updated to "Computed but unused"; `{{#if mcp_server_name}}` documented as the active mechanism |
| `personas/docs/agents/project-manifest/file-tree.md` | Modified — docs | `ledger-bootstrapper.md` annotation corrected to attribute `mcpServers` injection to `mcp_server_name: central_pm` in YAML |
| `personas/standalone/claude-code/ledger-bootstrapper.md` | Regenerated — output | Rebuilt from updated source; `mcpServers:\n  - central_pm` now present in YAML frontmatter |

---

## Pipeline Review

**Implementation (PASS):** All four source changes applied cleanly. The generated output file requires a build run — implementation noted this constraint and flagged it explicitly.

**QA (PASS):** All source file changes verified correct by direct file inspection. Confirmed only `ledger-bootstrapper.yaml` and `workflow-orchestrator.yaml` carry `mcp_server_name` among standalone metas — no unintended side effects.

**Code Review (PASS):** Changes reviewed as minimal, targeted, and consistent with established patterns. `FRONTMATTER_STANDALONE_CC` template required no modification. No new patterns introduced.

**Documentation (PASS x2):** First pass confirmed that the documentation corrections were the implementation for this WP. Second pass (after build was run) verified `personas/standalone/claude-code/ledger-bootstrapper.md` lines 11-12 contain the `mcpServers` block as specified, completing the final two outstanding acceptance criteria.

---

## Strategic Recommendations

**Keep `mcp_server_name` per-persona (opt-in) for standalone.** The decision to require an explicit `mcp_server_name` field in each standalone persona YAML rather than deriving it from the tools list is sound. It keeps MCP server dependencies visible and intentional. The `workflow-orchestrator` + `ledger-bootstrapper` pair are the only two standalone personas that interact with `central_pm`, and both now declare this explicitly.

(DONE) **Deferred cleanup: `mcp_servers_yaml` computed variable.** The `extractMcpServers()` function and `mcp_servers_yaml` build-loop variable (`scripts/build-personas.js` lines 480-487) are computed at runtime but go unused by any frontmatter template. This is harmless but adds minor cognitive overhead for future maintainers. The cleanup was intentionally deferred to avoid test changes. A future session could remove this code path alongside its corresponding test coverage.

(DONE) **Document the context-layer ordering risk.** Per-persona YAML fields (including `mcp_server_name`) shadow shared YAML values via the spread in the build context. If `personas/ledger/src/meta/_shared.yaml` `mcp_server_name` ever changes, the standalone personas with hardcoded `mcp_server_name: central_pm` would not automatically follow. This is a known and accepted risk but worth capturing in `personas/docs/agents/project-manifest/constraints.md` as a maintenance note.

---

## Next Steps

1. **No immediate action required.** All 50 persona files are passing `--check --strict`. The `ledger-bootstrapper.md` Claude Code output now correctly declares `central_pm` as a pre-authorized MCP server.

2. (DONE) **Optional deferred cleanup.** Remove `extractMcpServers()`, the `mcp_servers_yaml` build-loop variable, and its associated test coverage in a future housekeeping session when the scope justifies the test changes.

3. (DONE) **Constraints.md maintenance note.** Consider adding a note to `personas/docs/agents/project-manifest/constraints.md` documenting that standalone personas with hardcoded `mcp_server_name` values must be manually updated if `_shared.yaml` `mcp_server_name` changes.
