# Project Synthesis Report

**Plan:** Ledger Document Archiving Rework — Round 1  
**Date:** 2026-02-28  
**Plan Path:** `docs/agents/plans/2026-02-28-ledger-document-archiving-rework-1/`  
**Status:** COMPLETE — all 5 work packages delivered

---

## Executive Summary

This session implemented all five actionable recommendations from the `2026-02-28-ledger-document-archiving` synthesis report. Four work packages delivered code and test changes; a fifth consolidated documentation. Every acceptance criterion across all five WPs was met.

The work was confined entirely to the `mcp-server/` sub-project. No API contracts changed, no test suite regressions occurred, and the test count grew from 529 to 535 with six new targeted tests.

### What Was Built

| WP | Topic | Change Type |
|----|-------|-------------|
| WP-001 | Archive filename constants | Code + tests + manifest |
| WP-002 | `archiveDocuments()` ENOENT discrimination | Code + tests + manifest |
| WP-003 | Slug path-traversal sanitization (`assertSafeSlug`) | Code + tests + manifest |
| WP-004 | Route dispatch ordering comment in `server.ts` | Code comment only |
| WP-005 | Manifest consolidation (`api-surface.md`, `constraints.md`) | Documentation only |

---

## Metrics

| Metric | Value |
|--------|-------|
| Work packages | 5 / 5 COMPLETE |
| Pipeline passes | 20 / 20 (implementation × 4, qa × 5, code-review × 4, documentation × 5) |
| Tests at start | 529 |
| Tests at end | **535** (+6 new) |
| Tests failed | **0** |
| TypeScript compile errors | **0** |
| Security issues | 0 blocking |

All pipelines across all five WPs returned `PASS`. Zero failures recorded.

---

## Deliverables

### WP-001 — Archive Filename Constants

Added `PLAN_ARCHIVE_FILENAME = 'plan.md'` and `SYNTHESIS_ARCHIVE_FILENAME = 'synthesis.md'` as `as const` exports to `mcp-server/src/utils/constants.ts`. Replaced every hardcoded occurrence in:

- `gui/api.ts` — `handleGetPlanDocument` join path
- `src/tools/project-lifecycle.ts` — Zod `.default()` and `.describe()` template
- `src/tools/help-content.ts` — four inline example sites

**Impact:** The archive filenames are now single-source-of-truth constants. Any future rename touches one line.

### WP-002 — `archiveDocuments()` Error Discrimination

Refined the catch block in `LedgerStore.archiveDocuments()` to discriminate `ENOENT` (benign skip → `skipped[]`) from all other error codes (re-throw to caller). Updated JSDoc with a `@throws` tag. Added a new integration test that triggers `EISDIR` (by placing a directory at the destination) to verify the re-throw path — no mocking required.

**Impact:** Real I/O failures (permission denied, disk full) now surface to callers instead of being silently swallowed.

### WP-003 — Slug Path-Traversal Sanitization

Introduced `assertSafeSlug(slug: string): void` — a non-exported helper in `gui/api.ts`. It rejects any slug that is empty, contains `/`, or contains `..`, responding with HTTP 404 (`notFound()`). Deployed as the **first statement** in all five slug-accepting GUI handlers: `handleGetProject`, `handleListWorkPackages`, `handleGetWorkPackage`, `handleDeleteProject`, `handleGetPlanDocument`.

Added five new path-traversal test blocks to `api.test.ts` (one per handler), each covering all three forbidden patterns.

**Impact:** GUI API handlers are now protected against path-traversal attacks at the earliest possible point, before any filesystem access.

### WP-004 — Route Dispatch Ordering Comment

Added a 9-line block comment in `gui/server.ts` `matchRoute()`, immediately above the routing if-else chain. The comment explains the `rest.length` segment-count disambiguation model and warns with a concrete example (`/:slug/synthesis at length 3`) about same-length route shadowing.

**Impact:** Zero functional change; eliminates a latent maintenance trap for the next developer adding a route.

### WP-005 — Manifest Consolidation

Updated `mcp-server/docs/agents/project-manifest/`:

- **`api-surface.md`:** Added `PLAN_ARCHIVE_FILENAME` / `SYNTHESIS_ARCHIVE_FILENAME` to the constants table; updated `archiveDocuments()` entry to reflect discriminated-ENOENT behavior; documented `assertSafeSlug()` in the GUI API section.
- **`constraints.md`:** Extended constraint 4 (archive error contract) with the re-throw paragraph; added new constraint 40 (GUI API slug sanitization rule).

---

## Strategic Recommendations (Gold Nuggets)

These items were surfaced during the session by the Reviewer and QA agents. They are non-blocking but warrant tracking.

### 1. `wpId` Path-Traversal Gap — Medium Priority

**Source:** Reviewer on WP-003 (echoed in project-level comment)

`handleGetWorkPackage()` forwards `wpId` to `wpDetailPath()` as `join(storageDir, \`${wpId}.json\`)` without validation. A malicious `wpId` such as `../../../target` could theoretically escape the storage directory. The existing Zod schema parse on the resulting file provides a secondary protection layer (a traversal-escaped file would likely fail schema validation), but an explicit `assertSafeWpId()` guard — matching the pattern of `assertSafeSlug()` — would close this completely.

**Recommended follow-on task:** Add `assertSafeWpId(wpId: string): void` to `gui/api.ts` and deploy it as the first statement in `handleGetWorkPackage()`. Scope: ~15 lines of code + tests.

### 2. `archiveDocuments` / GUI Read-Path Coupling — Medium Priority

**Source:** Reviewer on WP-001

`archiveDocuments([args.plan_file])` stores the plan under its **original filename** (user-supplied). `gui/api.ts` reads it back as `PLAN_ARCHIVE_FILENAME` (`'plan.md'`). These two remain consistent only if `plan_file` is always `'plan.md'`. A project initialized with a non-standard `plan_file` (e.g., `'design.md'`) would have the GUI plan endpoint silently return 404.

**Recommended follow-on task:** Consider canonicalizing the destination filename to `PLAN_ARCHIVE_FILENAME` inside `archiveDocuments()` for the plan document specifically — or document the constraint explicitly in `initializeProject`'s `plan_file` parameter description.

### 3. Test Files Still Use Hardcoded Archive Filenames — Low Priority

**Source:** QA on WP-001

Test files (`tests/tools/project-lifecycle.test.ts`, `tests/storage/ledger-store.test.ts`, `tests/gui/api.test.ts`) still contain hardcoded `'plan.md'` and `'synthesis.md'` strings. These are out of scope for this plan but represent a future maintenance risk: if constant values ever change, tests would need manual updates.

**Recommended follow-on task:** Import `PLAN_ARCHIVE_FILENAME` / `SYNTHESIS_ARCHIVE_FILENAME` into the relevant test files.

### 4. Route Table Growth Debt — Low Priority

**Source:** Developer and Reviewer on WP-004

`server.ts`'s manual `if-else` dispatcher will become harder to maintain as routes grow. The new comment mitigates the immediate risk. If routes reach ~10+ entries, a table-driven router with explicit `{ method, pathPattern, handler, priority }` records would provide clearer intent and safer ordering.

---

## Next Steps

1. **File a follow-on plan** for `wpId` path-traversal hardening (Recommendation 1 above). Estimated scope: one small Developer WP, one QA WP.
2. **Address the `archiveDocuments`/GUI coupling** (Recommendation 2) — decide whether to canonicalize the archived filename or document the constraint.
3. **Import archive constants into test files** (Recommendation 3) — low-risk cleanup, can be bundled with any future test refactor pass.
4. **Monitor route table size** (Recommendation 4) — no action needed now; revisit when adding the next GUI route.

---

*Synthesis generated by Head of Operations (Synthesis Agent) — 2026-02-28*
