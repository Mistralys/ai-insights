# Synthesis Report

**Plan:** `2026-06-04-planner-project-history-access-rework-1`
**Date:** 2026-06-05
**Status:** COMPLETE — All 6 work packages delivered with all pipeline stages passing.

---

## Executive Summary

This rework plan hardened the Planner history system delivered by the parent plan (`2026-06-04-planner-project-history-access`). Six independent, backward-compatible changes were delivered:

1. **Schema hardening** — Added `.min(10)` guard to `CompleteSynthesisSchema.outcome_summary`, closing the degenerate-input gap at the tool API layer while preserving the permissive storage schema for legacy data compatibility.
2. **Round-trip integration test** — Closed the only `writeProjectMeta` ↔ `outcome_summary` round-trip test gap, providing regression safety for the critical `.meta.json` persistence path.
3. **Insight deduplication** — Implemented O(n) Set-based deduplication in `getRepositoryContext()` (global-first, first-seen wins), preventing token waste from overlapping global and repository-scoped insights.
4. **Filesystem discovery API** — Extended `GET /api/repos` with an optional `?include_undeclared=true` query parameter that discovers undeclared namespace directories at the ledger root and returns them as synthetic `RepoListItem` entries with `declared: false`.
5. **Strategy GUI toggle** — Added a "Show undeclared repositories" checkbox to the Strategy list view with muted visual styling for undeclared entries and a "Register" button that pre-fills the Add Repository form.
6. **Convention constraints** — Formally documented the Dual-Schema Pattern (Constraint 75) and the Graceful Degradation `@remarks` Fallback Contract (Constraint 76) in `constraints.md`.

All changes passed the full four-stage pipeline (implementation → QA → code-review → documentation). The full test suite grew from the assumed baseline of ~3,066 tests to **3,081 tests across 101 files**, all passing, with zero regressions.

---

## Metrics

| Work Package | Description | Tests Passed | Tests Failed | Coverage Notes |
|---|---|---|---|---|
| WP-001 (WP-003.md) | Insight deduplication in `repository-context.ts` | 3,069 | 0 | 3 dedicated AC test cases + 101-file regression |
| WP-002 (WP-002.md) | `outcome_summary` round-trip integration test | 3,081 | 0 | 15/15 in `project-meta.test.ts` |
| WP-003 (WP-001.md) | `CompleteSynthesisSchema` `.min(10)` guard | 101 files | 0 | 3 targeted schema cases; dual-schema pattern verified |
| WP-004 (WP-006.md) | Constraints 75 & 76 documentation | N/A | N/A | Documentation-only WP |
| WP-005 (WP-004.md) | `handleListRepos` filesystem discovery API | 3,081 | 0 | 57 dedicated tests + 9 QA edge-case probes |
| WP-006 (WP-005.md) | Strategy GUI undeclared repos toggle | 3,081 | 0 | All 5 ACs verified; TypeScript compiles clean |

**Aggregate:** 3,081 tests passing, 0 failures, 0 TypeScript compilation errors across all delivered work packages. Net new tests from baseline: +15 (estimated from ~3,066 baseline to 3,081).

---

## Strategic Recommendations (Gold Nuggets)

### 1. Dual-Schema Pattern Is Now a Formal Constraint
The Dual-Schema Pattern (strict input / permissive storage / key-presence bridge) was previously an informal convention repeated across 3+ components. It is now documented as Constraint 75 in `constraints.md`. Future contributors should be pointed to this constraint rather than discovering it by reading existing code. Any new `.meta.json` enrichment field should follow this pattern by default.

### 2. Graceful Degradation Needs `@remarks` by Convention
The Graceful Degradation `@remarks` Fallback Contract (Constraint 76) addresses a real-world risk: three components in the history system silently degrade, and the first time a new contributor sees this, their instinct will be to "fix" it. The constraint is now documented and exemplified. Recommend adding a code-review checklist item: *"Does any new optional enrichment path have a `@remarks` block documenting its fallback?"*

### 3. `safeListRepositoryInsights` Error Suppression Requires a Narrower Catch
Three independent agents (Developer, QA, Reviewer) flagged that `safeListRepositoryInsights` in `repository-context.ts` uses a bare `catch {}` that swallows all errors, including genuine I/O failures. The intent is to suppress SLUG_REGEX validation failures, but the current implementation also hides disk errors. Recommend narrowing to a typed catch (e.g., catching only `ZodError` or a known validation type) in a future cleanup pass.

### 4. Undeclared Repo Registration UX Has a Known Gap
The "Register" button pre-fills `#new-repo-id` with the raw filesystem folder name. Since `SLUG_REGEX` enforces alphanumeric/hyphens/underscores only, folder names containing dots, spaces, or other special characters will produce a `VALIDATION_ERROR` on submit. A lightweight client-side sanitiser was identified by Developer, QA, and Reviewer as the correct fix. This is a UX improvement that should be included in the next GUI iteration.

### 5. Strategy GUI Inner-Function Growth Warrants a Future Refactor
`renderStrategyList` in `strategy.js` now contains five nested helper functions (`buildToggleHtml`, `buildTableHtml`, `refreshTable`, `wireRegisterButtons`, `wireToggle`). This is idiomatic for the SPA's module-less pattern but is growing. When the next GUI feature touches this file, consider extracting helpers into a module-level namespace object (e.g., `StrategyList = { … }`) mirroring `renderStrategyDetail`.

### 6. `handleListRepos` Undeclared Discovery Uses Sequential I/O
The undeclared namespace validation loop in `api-repos.ts` calls `LedgerStore.listProjectsByFolderNames()` sequentially for each undeclared namespace. For ledger roots with many undeclared directories, a `Promise.all()` parallel fan-out would improve response latency. This is a non-urgent optimization — the sequential pattern is safe under concurrency and correct at current scale.

---

## Deferred & Follow-Up Items

| # | Source | Agent | Description | Type | Priority |
|---|---|---|---|---|---|
| 1 | WP-001 | Developer / Reviewer | `safeListRepositoryInsights` bare `catch {}` swallows genuine I/O errors in addition to SLUG_REGEX failures. Narrow to typed catch. | **Deferred** (pre-existing pattern, not introduced by this WP) | Low |
| 2 | WP-001 | Developer | `KnowledgeStoreManager` instantiated fresh on every `getRepositoryContext()` call. A cached instance per `ledgerRoot` would reduce allocations at high traffic. | **Deferred** (negligible at current call frequency) | Low |
| 3 | WP-005 | Developer | `handleListRepos` undeclared-namespace validation uses sequential for-loop rather than `Promise.all`. Parallel fan-out would reduce latency for large ledger roots. | **Deferred** (correct and safe at current scale) | Low |
| 4 | WP-005 | Developer / Reviewer | Synthetic `RepoListItem` for undeclared entries sets `created_at` and `last_modified` to query-time `new Date().toISOString()`. If the frontend sorts by these fields, undeclared entry order will vary between requests. A stable sentinel (epoch) or sort by namespace name may be preferable. | **Deferred** (product/UX decision outside WP scope) | Low |
| 5 | WP-006 | Developer / Reviewer | "Register" button pre-fills `#new-repo-id` with raw folder name, which may violate `SLUG_REGEX`. A client-side sanitiser (`replace(/[^a-zA-Z0-9_-]/g, '-')` etc.) on the ID field pre-fill would prevent confusing `VALIDATION_ERROR` on submit. | **Deferred** (known UX gap, next GUI iteration) | Medium |
| 6 | WP-006 | QA | Rapid checkbox toggling can produce concurrent in-flight `API.listRepos()` calls with no request cancellation guard. Last promise to resolve wins — cosmetic flicker only, no data corruption. Acceptable for a local dev tool. | **Deferred** (acceptable for local dev tool) | Low |
| 7 | WP-005 | Reviewer | `api-client.js` `buildQueryString()` helper excludes `0` values by design, so `listRepos()` and `getRunLogEntries()` construct query strings manually. Both have inline comments explaining the deviation. Recommend extending the helper to support a `required` flag set for consistency. | **Deferred** (consistency cleanup, no correctness impact) | Low |
| 8 | WP-006 | Developer / Reviewer | `renderStrategyList` inner-function nesting growing (5 helpers). Future refactor candidate: extract into a module-level `StrategyList` namespace object mirroring `renderStrategyDetail`. | **Deferred** (refactor candidate, not urgent) | Low |

---

## Next Steps

### Immediate (High-Value, Low-Effort)
1. **Slug sanitiser for "Register" button** — Medium-priority UX fix. Pre-process `#new-repo-id` pre-fill value with a client-side SLUG_REGEX sanitiser in `strategy.js wireRegisterButtons()`. Prevents `VALIDATION_ERROR` confusion for users with non-slug folder names.
2. **Narrow `safeListRepositoryInsights` catch** — Low-effort hardening. Replace bare `catch {}` with a typed guard catching only known validation errors. Surfaces genuine I/O failures without changing graceful-degradation behavior for SLUG_REGEX failures.

### Near-Term (Architecture & Quality)
3. **Add Insight knowledge-base tests for global/repo overlap** — The deduplication is now implemented and tested, but the knowledge store itself has no constraint preventing the same `id` appearing in both scopes. Consider adding a uniqueness invariant at the store layer, or a linting rule to catch overlaps at store population time.
4. **`Promise.all` fan-out for undeclared namespace validation** — Straightforward refactor of the `handleListRepos` sequential loop to parallel. Negligible now, but worthwhile before this API is used in larger environments.

### Planner Seeding for Next Cycle
5. **Strategy GUI module refactor** — When the next GUI feature touches `strategy.js`, extract inner helpers into a `StrategyList` namespace. Ticket the refactor before new feature work to avoid compounding the nesting depth.
6. **`buildQueryString()` `required` flag** — Small DX improvement. Extend the helper to accept a flag that allows `0` and `false` values as valid query string parameters, eliminating the manual pattern used in `listRepos()` and `getRunLogEntries()`.
7. **Stable timestamps for undeclared `RepoListItem`** — Coordinate with frontend on desired sort behavior for undeclared entries. If sort stability is required, use epoch (`'1970-01-01T00:00:00.000Z'`) as the sentinel or sort undeclared entries lexicographically by namespace name on the backend before returning.
