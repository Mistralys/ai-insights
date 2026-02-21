# Project Synthesis Report

**Project:** Centralized Ledger Storage  
**Plan Folder:** `2026-02-20-centralized-ledger-storage`  
**Date:** 2026-02-21  
**Status:** ✅ COMPLETE  
**Version:** v1.4.0 → v1.5.0

---

## Executive Summary

This project migrated the MCP server's ledger storage from a distributed model — where every plan folder contained its own hidden `.ledger/` subdirectory — to a **centralized storage architecture** at `storage/ledger/{slug}/`. The change makes ledger data portable, inspectable from a single location, and decoupled from the human-readable plan folders.

Three new surface areas were delivered alongside the storage refactor:

1. **`ledger_list_projects` tool** — enables cross-project status queries against the central store.
2. **`.meta.json` per-project sidecar** — a lightweight index auto-synced on every root-index write, enabling fast project enumeration without reading every WP file.
3. **`--ledger-dir` CLI override** — allows the ledger root to be redirected at server startup (useful for testing and multi-environment deployments).

All 7 work packages completed with every pipeline (implementation, QA, code-review, documentation) passing. The test suite grew from 257 to **288 tests** and ends at **0 failures**.

---

## Work Package Summary

| WP | Title | Status | Tests (end state) |
|----|-------|--------|-------------------|
| WP-001 | Schema & utility foundations | ✅ COMPLETE | 257 / 257 |
| WP-002 | LedgerStore centralized refactor | ✅ COMPLETE | 183 / 257 (intentional — WP-006 scope) |
| WP-003 | `initializeProject` + `ledger_list_projects` | ✅ COMPLETE | 183 / 257 (same) |
| WP-004 | Server startup & `.gitkeep` | ✅ COMPLETE | n/a (no new tests) |
| WP-005 | Help text + changelog + version bump | ✅ COMPLETE | **288 / 288** |
| WP-006 | Test suite update & new test files | ✅ COMPLETE | **288 / 288** |
| WP-007 | Project manifest documentation | ✅ COMPLETE | **288 / 288** |

---

## Metrics

| Metric | Value |
|--------|-------|
| Final test count | 288 |
| Test failures | 0 |
| TypeScript compile errors | 0 |
| Security issues | 0 |
| Work packages | 7 / 7 COMPLETE |
| All pipelines passing | ✅ Yes |
| Version delivered | v1.5.0 |

---

## Artifacts

### New Files

| File | Purpose |
|------|---------|
| `src/schema/project-meta.ts` | `ProjectMetaSchema` (Zod) and `ProjectMeta` type |
| `src/utils/ledger-root.ts` | `resolveLedgerRoot()`, `projectSlugFromPath()` |
| `storage/ledger/.gitkeep` | Tracks default storage directory in version control |
| `.gitignore` | Excludes `storage/ledger/` contents, preserves `.gitkeep` |
| `tests/storage/project-meta.test.ts` | 14 tests for meta read/write/list/archive-exclusion |
| `tests/utils/ledger-root.test.ts` | 9 tests for ledger root resolution and slug extraction |

### Modified Files

| File | Change |
|------|--------|
| `src/utils/path-validator.ts` | Extracted and exported `planFolderBasename()` |
| `src/storage/ledger-store.ts` | Full centralized storage refactor; new meta methods |
| `src/storage/file-lock.ts` | Lock path changed to `{storageDir}/.lock` |
| `src/tools/project-lifecycle.ts` | `initializeProject` syncs meta; `ledger_list_projects` registered |
| `src/index.ts` | Calls `resolveLedgerRoot()` + `mkdirSync` at startup |
| `src/tools/help.ts` | Updated references, documented new tool and storage architecture |
| `docs/agents/project-manifest/*.md` | Full manifest refresh (file-tree, api-surface, data-flows, constraints) |
| `README.md` | Updated architecture diagram and data model section |
| `changelog.md` | v1.5.0 entry |
| `package.json` | Version bumped to 1.5.0 |

---

## Strategic Recommendations ("Gold Nuggets")

### 🔴 High Priority

_(None — all critical issues resolved within this cycle.)_

### 🟡 Medium Priority

1. **Test isolation contract must be documented.**  
   `auto-handoff.test.ts` was silently writing real ledger files to `storage/ledger/{slug}/` on every test run, accumulating ~30 stale artifact directories. The root cause: any test using `new LedgerStore(path)` without a second `ledgerRoot` argument will write to real storage. This is now fixed, but the pattern has no lint guard. **Recommendation:** Add a project convention document or eslint rule enforcing that all test files pass a `mkdtemp` value as the second `LedgerStore` argument.

2. **`afterEach` variable bug pattern.**  
   `tests/tools/pipeline.test.ts` had `afterEach` referencing `tempLedgerRoot` in a `describe` block that declared `tempDir`, silently skipping cleanup and leaking temp directories. This is an easy-to-miss JavaScript closure bug. **Recommendation:** Consider a linting rule or test convention that requires `afterEach` teardown variables to be declared in the same scope.

### 🟢 Low Priority

3. **`--ledger-dir` with no value returns `undefined` silently.**  
   `resolveLedgerRoot()` handles the edge case `--ledger-dir` (flag with no following value) by returning `undefined`, which the caller treats as "use default." The contract is undocumented in the source. **Recommendation:** Either document the explicit fallback contract in the JSDoc, or throw a descriptive configuration error — `Error: --ledger-dir flag requires a path argument`.

4. **`as any` cast in `help.ts`.**  
   Required due to MCP SDK Zod passthrough type incompatibility. Runtime behaviour is correct. Track the upstream SDK issue; remove the cast when types are fixed.

5. **`.archive` exclusion relies on directory-name dot-prefix, not slug validity.**  
   `listAllProjects()` skips entries where the directory name starts with `.` — this is correct and intentional, but only a brief inline comment in the source explains the distinction. A future maintainer rewriting the filter could inadvertently change semantics.

---

## Next Steps

| Priority | Recommendation |
|----------|---------------|
| **High** | Run a one-time cleanup of the ~30 stale `storage/ledger/` test artifacts left by earlier runs of `auto-handoff.test.ts` (if not already cleaned). |
| **Medium** | Add a shared test helper (e.g. `createTempStore(planPath)`) that always injects a `mkdtemp` ledger root, making the isolation pattern the path of least resistance. |
| **Medium** | Document the `--ledger-dir` no-value contract in `resolveLedgerRoot()` JSDoc. |
| **Low** | When MCP SDK types improve, remove the `as any` cast in `help.ts`. |
| **Future** | Consider adding a `ledger_archive_project` tool that moves a project's `storage/ledger/{slug}/` into `storage/ledger/.archive/{slug}/`, respecting the already-wired `.archive` exclusion in `listAllProjects()`. |

---

## Overall Assessment

The centralized storage architecture is well-executed. The phased WP sequence was logical — foundations first (WP-001), then storage layer (WP-002), then tool surface (WP-003/004), then cleanup (WP-005/006/007). The deliberate "break tests now, fix in WP-006" strategy was clearly communicated across pipeline summaries and avoided confusion.

The test suite is in excellent shape: 288 tests, 0 failures, full type-safety. New test files provide meaningful coverage for the new surface area (meta schema, root resolution, path extraction). The project manifest is consistent and up-to-date.

**No blockers. Handoff is clean.**
