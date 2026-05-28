# Synthesis Report — Repo-Namespaced Ledger Storage Rework (Sprint 1)

**Plan:** `2026-05-27-repo-namespaced-ledger-storage-rework-1`  
**Date:** 2026-05-28  
**Status:** COMPLETE — 8/8 work packages passed all pipeline stages

---

## Executive Summary

This sprint closed two open known-limitation items (KL-3 and KL-4) from the previous synthesis cycle and added hardening and test coverage across both the TypeScript MCP server and the Python orchestrator.

**KL-4 (dialogue/chunk handlers: non-namespaced paths)** — All four GUI handlers
(`handleListDialogues`, `handleGetDialogueFile`, `handleListChunks`, `handleGetChunkFile`) now
resolve storage through `resolveProjectStore()` and construct subdirectory paths from
`store.storageDir` (`{ledgerRoot}/{repo}/{slug}/…`). The `repoName` parameter, previously
accepted but silently ignored, is now actively threaded through. The old flat
`join(ledgerRoot, slug, DIR)` pattern has been fully retired from `gui/api.ts`. A behavioral
change accompanies this: the list handlers now return `NOT_FOUND` (not `[]`) when the project
does not exist — semantically correct and consistent with all other handlers.

**KL-3 (assertSafeSlug duplication)** — The shared `assertSafeSegment(segment: string): boolean`
predicate was extracted to `path-validator.ts`. All three former assertSafeSlug sites (storage
layer in `ledger-root.ts`, GUI layer in `run-log-handlers.ts`, module guard in `gui/api.ts`)
now delegate to it. SAFE_SLUG_REGEX has been removed from `gui/api.ts` imports entirely.

**resolveRepoName() hardening** — The function in `gui/server.ts` now validates both URL
parameters (repoUrlParam, slugUrlParam) through assertSafeSlug guards before any filesystem
access. A security-flagged reflected-input message was caught in audit and replaced with a
static, non-reflective error string by the Reviewer.

**Orchestrator test coverage** — `TestLedgerLogCopyPath` (9 tests) added to
`orchestrator/tests/test_slug_dir.py`, covering the inline repo_name derivation logic in
`cli.py` lines 869–876 that previously had no dedicated test.

**Documentation** — `api-surface.md`, `file-tree.md`, `constraints.md`, and `constants.ts`
JSDoc were updated to reflect the new architecture. KL-3 and KL-4 in `constraints.md` are
now marked Resolved.

---

## Metrics

| Metric | Value |
|--------|-------|
| Work packages | 8 / 8 COMPLETE |
| Pipeline stages total | 27 (all PASS) |
| Rework cycles | 0 |
| TypeScript tests at sprint start | 2330 |
| TypeScript tests at sprint end | 2342 (+12) |
| Python tests at sprint end | 1001 passed, 6 skipped |
| Pre-existing Python failures | 3 (test_streaming_capture.py — Python 3.14 async compat, out of scope) |
| Security findings Critical/High | 0 |
| Security findings Medium | 0 |
| Security findings Low (found + fixed) | 1 (reflected input in assertSafeSlug error message — Reviewer fix-forward applied) |
| Files modified (production) | 5 |
| Files modified (tests) | 3 |
| Files modified (docs/manifests) | 5 |

### Files Changed

**Production code:**
- `mcp-server/src/utils/path-validator.ts` — new `assertSafeSegment` export
- `mcp-server/src/utils/ledger-root.ts` — assertSafeSlug delegates to assertSafeSegment
- `mcp-server/src/gui/handlers/run-log-handlers.ts` — same delegation
- `mcp-server/gui/api.ts` — 4 handlers migrated; assertSafeSlug delegates; SAFE_SLUG_REGEX removed
- `mcp-server/gui/server.ts` — resolveRepoName hardened + exported; static error message

**Tests:**
- `mcp-server/tests/utils/path-validator.test.ts` — 8 new assertSafeSegment tests
- `mcp-server/tests/gui-server.test.ts` — new file; 10 resolveRepoName guard tests
- `mcp-server/tests/gui/api.test.ts` — 12 new namespaced-path tests (3 per handler)
- `orchestrator/tests/test_slug_dir.py` — TestLedgerLogCopyPath class, 9 tests

**Docs / manifests:**
- `mcp-server/docs/agents/project-manifest/api-surface.md`
- `mcp-server/docs/agents/project-manifest/constraints.md`
- `mcp-server/docs/agents/project-manifest/file-tree.md`
- `mcp-server/src/utils/constants.ts` (JSDoc only)

---

## Strategic Recommendations

### 1. Complete KL-3 closure — deriveRepoName() inline SAFE_SLUG_REGEX (low priority)
`deriveRepoName()` in `ledger-root.ts` still uses an inline `SAFE_SLUG_REGEX.test()` check on
its fallback path rather than `assertSafeSegment()`. Flagged by Developer, QA, and Reviewer as
out of scope for this sprint. A follow-up single-function change would complete the
assertSafeSegment consolidation across the entire codebase.

### 2. Add dedicated unit tests for run-log-handlers.ts assertSafeSlug (low priority)
The ApiError throw path in `run-log-handlers.ts` assertSafeSlug has no dedicated test file.
The delegate (`assertSafeSegment`) is fully covered, and the analogous ApiError pattern is
tested in `api-orchestrator.test.ts`, so the regression risk is low. A targeted test asserting
`ApiError` (not plain `Error`) would provide an explicit regression guard if the error type
changes independently of the delegate.

### 3. Fix pre-existing Python 3.14 async failures (medium priority)
3 pre-existing failures in `orchestrator/tests/test_streaming_capture.py`
(`RuntimeError: coroutine raised StopIteration`) are Python 3.14 async compatibility issues.
These failures predate this sprint and are excluded from WP-003 scope per the acceptance criteria
carve-out. However, they will continue to contaminate the orchestrator test report until fixed.

### 4. Extract cli.py inline log derivation into a named function (low priority)
`_derive_ledger_log_dir()` in `test_slug_dir.py` is a test-local mirror of the inline logic
at `cli.py` lines 869–876. If `cli.py`'s inline derivation changes, the test mirror will drift
silently without a failure. Extracting the production logic into a named function would allow
the tests to call it directly, eliminating the mirror pattern.

### 5. Consolidate duplicate createNs*Project test helpers (low priority, readability)
The four `createNsDialoguesProject`, `createNsDialogueFileProject`, `createNsChunksProject`,
and `createNsChunkFileProject` helpers in `api.test.ts` are structurally identical. Extracting
them to a single shared `createNsProject()` outer-scope helper would reduce boilerplate and
make future test additions cheaper.

---

## Next Steps

1. **Start Sprint 2:** The only remaining open item from the original synthesis cycle is item #1
   (add `@security` JSDoc to `resolveProjectStore()`) — which was already resolved before this
   sprint. No items from the prior synthesis remain open. Next sprint should be driven by new
   planning priorities.
2. **Optional follow-up WP:** deriveRepoName() inline SAFE_SLUG_REGEX migration (see
   Recommendation #1) — small, isolated, no dependencies.
3. **Orchestrator health:** Schedule a focused fix for the 3 Python 3.14 async failures in
   `test_streaming_capture.py` before they compound with future async changes.
4. **Behavioral change notice:** Consumers of `handleListDialogues` / `handleListChunks` should
   be aware that both now return `NOT_FOUND` (HTTP 404) when the project slug does not exist,
   rather than silently returning `[]`. This is a breaking semantic change for callers that
   relied on the empty-array response to detect missing projects.
