# Synthesis Report — Knowledge Repository Scope Rework 1

**Plan:** `2026-05-29-knowledge-repository-scope-rework-1`
**Date:** 2026-05-30
**Status:** COMPLETE
**Runner:** orchestrator v0.1.0 / MCP Server v1.31.0

---

## Executive Summary

This rework plan resolved all actionable items surfaced in the prior
`2026-05-29-knowledge-repository-scope` synthesis. The session hardened the
knowledge REST API in two security-relevant areas — preventing HTTP 500 leakage
for malformed `repository_name` values and closing the inconsistent `scope`
validation gap in `handleListKnowledge` — and completed four low-priority
cleanup tasks: a stale test variable rename, a null-guard correctness fix in the
frontend API client, a constant rename to remove the now-defunct `project` scope
reference, and a consolidated changelog entry.

All 6 work packages are COMPLETE with all pipeline stages PASS. One rework
cycle occurred (WP-001: QA surfaced two stale tests not updated by the
Developer; fixed in a second implementation pass before QA re-ran cleanly).

---

## Metrics Summary

| WP | Title | Stages | Reworks | Test Result |
|----|-------|--------|---------|-------------|
| WP-001 | `handleListKnowledge` scope validation | impl → QA → impl → QA → review → docs | 1 | 2728 / 5 pre-existing failures |
| WP-002 | `projectInsightId` → `repositoryInsightId` rename | impl → QA → review → docs | 0 | 39 / 0 |
| WP-003 | `\|\| undefined` → `!= null` fix in api-client.js | impl → QA → review → docs | 0 | 28 WP-scope / 5 pre-existing |
| WP-004 | Slug validation guards in delete/promote handlers | impl → QA → security → review → docs | 0 | 89 / 5 pre-existing |
| WP-005 | `PROJECT_SLUG_REGEX` → `SLUG_REGEX` rename | impl → QA → review → docs | 0 | 172 / 5 pre-existing |
| WP-006 | Consolidated changelog entry (v1.32.4) | docs | 0 | n/a |

**Security audit (WP-004):** 0 Critical · 0 High · 2 Low/Info observations
**Pre-existing regression:** 5 `api-client.test.ts` failures across all WPs
(field naming mismatch `project_slug` / `repository_name` from commit 294687a
— confirmed out-of-scope for this rework plan)

---

## Work Package Outcomes

### WP-001 — `handleListKnowledge` scope validation

`handleListKnowledge` previously returned all insights and silently discarded
any unrecognised `scope` value (e.g. `'project'`). It was the only one of the
five knowledge REST handlers without explicit scope rejection.

**Change:** Added an `InsightScope.safeParse()` guard before the storage call.
Any non-`undefined` scope string that fails the parse now throws
`VALIDATION_ERROR` (HTTP 400), bringing `handleListKnowledge` into contract
parity with all four mutating handlers.

**Rework detail:** QA found two stale tests that still asserted the old
silent-fallback contract (`knowledge-repository-scope.test.ts:767` and
`server-knowledge-routes.test.ts:230`). A second implementation pass updated
both tests; the full test suite then passed on the QA re-run (2728 pass,
5 pre-existing failures unrelated to this WP).

**Files modified:**
- `mcp-server/gui/api-knowledge.ts`
- `mcp-server/tests/gui/api-knowledge.test.ts`
- `mcp-server/tests/gui/knowledge-repository-scope.test.ts`
- `mcp-server/tests/gui/server-knowledge-routes.test.ts`

---

### WP-002 — `projectInsightId` test variable rename

The variable `projectInsightId` inside the `ledger_update_insight` describe
block of `tests/tools/knowledge.test.ts` was a naming artefact from the prior
`project` scope (now removed). It was renamed to `repositoryInsightId`.

**Change:** Pure four-site rename (declaration + three usages). No logic
changes. Grep-verified zero residual `projectInsightId` references in any
source or test file.

**Files modified:** `mcp-server/tests/tools/knowledge.test.ts`

---

### WP-003 — `|| undefined` null-guard fix in `api-client.js`

Four mutation handlers in `mcp-server/gui/public/api-client.js`
(`updateKnowledge`, `deleteKnowledge`, `promoteKnowledge`, `moveKnowledge`)
used `|| undefined` to omit optional `repositoryName`/`sourceRepositoryName`
parameters. This pattern drops falsy-but-legitimate values (e.g. `'0'`).

**Change:** Replaced all four `|| undefined` patterns with
`!= null ? value : undefined` null-guards. Updated all corresponding JSDoc
`@param` prose to remove "falsy" language. Removed the `updateKnowledge` known-
limitation paragraph that documented the `'0'` edge-case defect. The
`getKnowledge` JSDoc prose was also corrected (from "Falsy" to
"undefined or empty-string") following a documentation-forward item raised by
the Reviewer.

**Files modified:** `mcp-server/gui/public/api-client.js`

---

### WP-004 — Slug validation guards in `handleDeleteKnowledge` / `handlePromoteKnowledge`

Both handlers passed `repository_name` directly to `KnowledgeStoreManager`
without a handler-level format check. A malformed slug (e.g. `'../evil'` or
`'has spaces'`) bypassed the handler layer, reached `_validateSlug()` in the
storage layer, and threw a plain `Error` — resulting in an unhandled HTTP 500
instead of a typed HTTP 400 `VALIDATION_ERROR`.

**Change:** Added explicit `SLUG_REGEX` validation guards to both handlers,
placed after the `repository_name` presence check. Malformed slugs now throw
`validationError()` immediately, consistent with `handleMoveKnowledge`.
The file-level `@known-limitation` JSDoc block was updated to mark the issue
RESOLVED.

**Security audit:** 0 Critical · 0 High.
- A01 (Broken Access Control): `SLUG_REGEX` is anchored at both ends; path-
  traversal characters are rejected at the handler level. Storage-layer
  `_validateSlug()` provides defence-in-depth.
- A03 (Injection): All inputs pass through Zod schemas or explicit regex guards
  before reaching the filesystem. No ReDoS surface in the query handler.
- Two Low/Info observations: (1) `handleListKnowledge` still lacks a handler-
  level `repository_name` slug guard (storage-layer guard prevents exploitation
  but throws HTTP 500 rather than 400); (2) `params.query` in
  `handleListKnowledge` uses safe `.includes()` — no ReDoS surface.

**Files modified:**
- `mcp-server/gui/api-knowledge.ts`
- `mcp-server/tests/gui/api-knowledge.test.ts`
- `mcp-server/docs/agents/project-manifest/api-surface.md`
- `mcp-server/docs/agents/project-manifest/data-flows.md`
- `mcp-server/docs/agents/project-manifest/file-tree.md`
- `mcp-server/changelog.md` · `changelog.md`

---

### WP-005 — `PROJECT_SLUG_REGEX` → `SLUG_REGEX` rename

The constant `PROJECT_SLUG_REGEX` in `src/schema/knowledge.ts` was named after
the now-defunct `project` scope. It validates both `repository_name` and
`origin_plan` slugs, neither of which are project-scoped. The rename eliminates
the misleading name from source code and documentation.

**Change:** Mechanical rename across 7 source/test files and 3 project-manifest
documents. All 172 target tests pass. TypeScript build succeeds. Changelog
historical entries (v1.32.1, v1.32.2) were intentionally left unchanged as
immutable records.

**Confirmed:** `origin_plan` is present in the repository-scoped example in
`help-content.ts` (line 783) — no change needed (pre-resolved by the prior
rework plan).

**Files modified:**
`src/schema/knowledge.ts`, `src/storage/knowledge-store.ts`,
`src/tools/knowledge.ts`, `src/tools/help-content.ts`, `gui/api-knowledge.ts`,
`tests/schema/knowledge.test.ts`, `tests/gui/api-knowledge.test.ts`,
`docs/agents/project-manifest/api-surface.md`,
`docs/agents/project-manifest/data-flows.md`,
`docs/agents/project-manifest/file-tree.md`

---

### WP-006 — Consolidated changelog entry

Added `v1.32.4` rollup entry to `mcp-server/changelog.md` covering all four
rework groups: Group A (slug validation in delete/promote), Group B (scope
rejection in list), Group C (null-guard fix, variable rename, JSDoc correction),
Group D (`SLUG_REGEX` rename). The entry explicitly meets all AC: handler
hardening, `PROJECT_SLUG_REGEX` → `SLUG_REGEX`, `|| undefined` fix.

The rollup entry coexists with the per-WP granular entries (v1.32.1–v1.32.3)
added during individual documentation passes, providing both a quick-scan
summary and a per-change audit trail.

---

## Aggregate Failure Metrics

No critical or blocking failures were introduced by this plan. The one rework
cycle (WP-001 QA) was caught by normal QA flow and resolved within the same WP.

**Pre-existing regression tracked across all WPs:**
5 tests in `tests/gui/api-client.test.ts` fail because commit `294687a`
renamed `project_slug` / `source_project_slug` API fields to
`repository_name` / `source_repository_name` in the implementation but did not
update the test assertions. This regression pre-dates all WPs in this plan and
was confirmed out-of-scope by QA on every WP that encountered it.

---

## Strategic Recommendations

### 1. Fix `api-client.test.ts` regressions (High Priority)

The 5 pre-existing test failures in `tests/gui/api-client.test.ts` have been
noted in every QA pass across this plan. They represent a real test gap for
the four mutation API methods and should be resolved in a dedicated follow-up
work package. Impact: low risk (the implementation is correct; tests simply
assert old field names), but noise in the test output erodes confidence.

### 2. Add handler-level slug validation to `handleListKnowledge` (Medium Priority)

The Security Auditor flagged (Info, A01) that `handleListKnowledge` forwards
`repository_name` to the storage layer without a handler-level `SLUG_REGEX`
check. The storage guard (`_validateSlug`) prevents exploitation, but a
malformed value throws a plain `Error` (HTTP 500) rather than a typed
`ApiError` (HTTP 400 VALIDATION_ERROR). This is a minor API contract
inconsistency. The fix mirrors the pattern now in place for `handleDeleteKnowledge`
and `handlePromoteKnowledge` — low complexity, high consistency gain.

### 3. Consolidate dual `api-surface.md` knowledge handler sections (Low Priority)

The `api-surface.md` manifest contains two parallel documentation sections for
the knowledge REST handlers: one human-readable prose section and one
TypeScript-declaration-style section. Both were kept in sync during this rework
plan, but maintaining two sections doubles the update surface. A future
consolidation to a single canonical reference section would reduce drift risk.

### 4. Simplify dual-assertion test pattern (Low Priority)

Several new test cases introduced in WP-001 and WP-004 invoke the handler twice
to assert both `toThrow(ApiError)` and `toMatchObject({ code: 'VALIDATION_ERROR' })`.
A single `rejects.toMatchObject({ code: 'VALIDATION_ERROR' })` per test would
be sufficient and would eliminate the redundant handler invocation. Not a
correctness concern — flag for a future test-cleanup pass.

---

## Next Steps

| Priority | Action |
|----------|--------|
| ~~High~~ | ~~Create a follow-up WP to fix the 5 `api-client.test.ts` regressions~~ — **DONE** |
| ~~Medium~~ | ~~Create a follow-up WP to add `SLUG_REGEX` guard to `handleListKnowledge`~~ — **DONE** |
| ~~Low~~ | ~~Consolidate the dual `api-surface.md` documentation sections~~ — **DONE** |
| ~~Low~~ | ~~Simplify dual-assertion patterns in new knowledge handler tests~~ — **DONE** |

---

## Follow-Up Implementation (2026-05-30)

All four strategic recommendations from this synthesis were implemented by the
Standalone Developer Agent in a follow-up session.

### 1 — `api-client.test.ts` regressions (all 5 fixed)

The 5 failing tests asserted the old `project_slug` / `source_project_slug` /
`project_slug` (move destination) field names from before commit `294687a`.
Updated to the current `repository_name`, `source_repository_name`, and
`target_repository_name` field names. One test also required a semantics fix:
the "omits source_repository_name when empty/falsy" test used `''` as input,
but the WP-003 `!= null` guard no longer drops empty strings. Corrected the
input to `null` (the actual omission-triggering value) to match the documented
contract.

**Files modified:**
- `mcp-server/tests/gui/api-client.test.ts`

### 2 — `SLUG_REGEX` guard added to `handleListKnowledge`

Added an explicit `SLUG_REGEX` check on `repository_name` in
`handleListKnowledge`, placed after the scope validation and before the storage
call. Malformed slugs now throw `VALIDATION_ERROR` (HTTP 400), bringing the
list handler into full parity with the four mutating handlers. Added three test
cases covering path-traversal rejection, space rejection, and the passing case.

**Files modified:**
- `mcp-server/gui/api-knowledge.ts`
- `mcp-server/tests/gui/api-knowledge.test.ts`

### 3 — `api-surface.md` knowledge handler section consolidated

- **Route-table note** updated to state that all five handlers validate
  `repository_name` (was: only delete/promote).
- **Section 1** (`### handleListKnowledge()` prose block): replaced the
  stale "Known limitation" paragraph and duplicated `KnowledgeListParams`
  interface with a brief updated declaration that cross-references Section 2.
- **Section 2** (comprehensive TypeScript declarations): added `repository_name`
  SLUG_REGEX validation bullet to the parameter-handling block.

**Files modified:**
- `mcp-server/docs/agents/project-manifest/api-surface.md`

### 4 — Dual-assertion test patterns simplified

Removed the redundant `rejects.toThrow(ApiError)` call from 4 test cases in
`api-knowledge.test.ts` (AC-5, AC-6, AC-9 ×2). Each test now uses a single
`rejects.toMatchObject({ code: '...' })` assertion, which is sufficient to
assert both the throw and the error code.

**Files modified:**
- `mcp-server/tests/gui/api-knowledge.test.ts`

### Verification

Full test suite: **2740 / 2740 pass** (`npx vitest run` in `mcp-server/`).
TypeScript: no new errors introduced.
