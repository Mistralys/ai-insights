# Synthesis Report

**Project:** `2026-02-21-detect-project-by-path`
**Date:** 2026-02-21
**Status:** COMPLETE
**Agent:** Head of Operations (Synthesis v3.3.0)

---

## Executive Summary

This session introduced **`ledger_detect_project`** — a workspace-path-aware auto-detection capability for the MCP project ledger. Agents can now identify their active project from a working directory path (`cwd_path`) without requiring an explicit `project_path` or an open plan file. The tool cross-references `cwd_path` against all registered project roots via the centralized ledger's `.meta.json` files and returns a discriminated union result: `FOUND`, `NOT_FOUND`, or `AMBIGUOUS`.

The feature spans three layers:

1. **Pure utility** — `inferProjectRootFromPlanPath()` strips 4 trailing path segments from a plan folder path to yield the project root (no filesystem access).
2. **Storage layer** — `LedgerStore.detectProjectByCwd()` iterates all stored projects and finds the one whose root is an ancestor of `cwd_path` (case-insensitive on Windows).
3. **MCP tool** — `ledger_detect_project` exposes the capability to agents, discoverable via `tool_search_tool_regex` with pattern `ledger_`.

Personas 3–7 (Developer, QA, Reviewer, Documentation, Synthesis) were updated to **v3.3.0**, replacing the legacy single-step pre-flight with a two-phase protocol: **Phase 1** auto-detects the project, **Phase 2** verifies MCP server reachability. This is the first version of the synthesis agent to self-apply these new pre-flight instructions.

---

## Metrics

| WP | Scope | Tests Added | Tests Passed | Tests Failed | Security Issues | Pipelines |
|----|-------|-------------|--------------|--------------|-----------------|-----------|
| WP-001 | `inferProjectRootFromPlanPath()` utility | 5 (unit) | 302 | 0 | 0 | 4 / 4 PASS |
| WP-002 | `LedgerStore.detectProjectByCwd()` method | 7→8 (integration) | 302 | 0 | 0 | 4 / 4 PASS |
| WP-003 | `ledger_detect_project` MCP tool | — | 302 | 0 | 0 | 4 / 4 PASS |
| WP-004 | Full test suite | 13 net new | 302 | 0 | 0 | 4 / 4 PASS |
| WP-005 | Project manifest docs | — (doc-only) | 302 | 0 | 0 | 4 / 4 PASS |
| WP-006 | Persona updates (v3.3.0) | — | N/A | 0 | 0 | 4 / 4 PASS |

**Totals:** 24 / 24 pipelines PASS · 13 new tests · 302 suite-wide · 0 failures · 0 security issues

### New Tests Breakdown

| Test File | Tests | Coverage |
|-----------|-------|----------|
| `tests/utils/ledger-root.test.ts` | 5 | Unix path, Windows backslash, Windows forward-slash, deep nesting, idempotency |
| `tests/storage/ledger-store.test.ts` | 8 | FOUND (subdir), FOUND (exact root), FOUND (plan folder as cwd), NOT_FOUND (unrelated), NOT_FOUND (empty ledger), ancestor-does-not-match, AMBIGUOUS (two matching), FOUND with two distinct projects |

---

## Artifacts

### New / Modified Source Files

| File | Change |
|------|--------|
| `src/utils/ledger-root.ts` | Added `inferProjectRootFromPlanPath()` export |
| `src/storage/ledger-store.ts` | Added `DetectProjectResult` type + `detectProjectByCwd()` static method |
| `src/tools/project-lifecycle.ts` | Registered `ledger_detect_project` tool (total tools: 19) |
| `tests/utils/ledger-root.test.ts` | 5 new unit tests |
| `tests/storage/ledger-store.test.ts` | 8 new integration tests |

### Documentation Updated

| File | Change |
|------|--------|
| `docs/agents/project-manifest/api-surface.md` | Added `ledger_detect_project` entry, `inferProjectRootFromPlanPath`, `DetectProjectResult`, `detectProjectByCwd` |
| `docs/agents/project-manifest/file-tree.md` | Annotated `ledger-root.ts` and `project-lifecycle.ts` with new exports |
| `docs/agents/project-manifest/data-flows.md` | Added **Flow 1c**: project detection by cwd path (step-by-step diagram) |

### Persona Updates

| File | Change |
|------|--------|
| `personas/ledger/3-developer.md` | v3.2.0 → v3.3.0, Phase 1+2 pre-flight, `ledger_detect_project` in Tools table |
| `personas/ledger/4-qa.md` | same |
| `personas/ledger/5-reviewer.md` | same |
| `personas/ledger/6-documentation.md` | same |
| `personas/ledger/7-synthesis.md` | same |
| `personas/changelog.md` | Added v3.3.0 entry |

`personas/ledger/2-project-manager.md` — **unchanged** (explicitly out of scope).

---

## Strategic Recommendations

### Gold Nuggets

1. **Vanilla personas are a separate, non-ledger workflow.** WP-006 surfaced a specification error: a criterion asked for the `personas/vanilla/` files to receive the same pre-flight updates. The Developer correctly identified that `personas/vanilla/` is a v1.x.x simplified workflow with no MCP tooling — the concept of a pre-flight check does not exist there. `sync-personas.js` propagates `personas/ledger/` to VS Code's user prompts directory, not to `personas/vanilla/`. This is a recurring planning blind spot: when writing acceptance criteria, the planner should verify which persona tier is in scope before referencing paths.

2. **`startsWith(root + '/')` is the correct ancestor check.** In `detectProjectByCwd`, using `startsWith(root + '/')` (rather than just `startsWith(root)`) correctly prevents a ancestor-only match where `cwd_path` is a *parent* of the project root. This edge case was explicitly tested and confirmed working. Future path-matching logic in the codebase should follow this pattern.

3. **Discriminated union on result type improves type safety.** The `DetectProjectResult` type with `result: 'FOUND' | 'NOT_FOUND' | 'AMBIGUOUS'` is a clean, extensible pattern. It avoids throwing exceptions for expected negative outcomes and allows callers to pattern-match exhaustively. Consider applying this pattern to other operations that return optional results (e.g., `GetWorkPackage` when a WP does not exist).

4. **Case-insensitive comparison scoped to Windows only.** The `process.platform === 'win32'` guard for case-folding paths is idiomatic and avoids silently mutating paths on case-sensitive Linux/macOS filesystems. This approach should be the project standard for any future cross-platform path comparisons.

---

## Next Steps

| Priority | Recommendation |
|----------|---------------|
| Medium | Update the **Planner** and **Project Manager** personas (and their acceptance criteria templates) to note that `personas/vanilla/` is out of scope for any MCP-ledger feature work. |
| Low | Consider applying the `DetectProjectResult` discriminated union pattern to `GetWorkPackageResult` — currently a `WP not found` case throws, which forces callers to use try/catch rather than a clean type-narrowing branch. |
| Low | The `ledger_detect_project` tool pre-flight instructions now appear in personas 3–7. Verify they are correctly applied end-to-end by running a test session where no explicit `project_path` is provided to the Developer agent. |
| Low | `data-flows.md` now has three flows for project loading (1a, 1b, 1c). Review whether a summary table or index should be added at the top of the file to aid navigation. |
