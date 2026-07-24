# Synthesis Report — model-settings-rework-2

**Project:** `2026-07-23-model-settings-rework-2`
**Status:** COMPLETE — 6/6 work packages delivered with all acceptance criteria met
**Date:** 2026-07-23

---

## Executive Summary

This rework cycle closed all remaining actionable items from the `model-settings-rework-1` synthesis. The centrepiece was the full migration of the ~1,100-line `matchRoute()` if-else chain into a declarative `buildRoutes()` route table — completing the architectural vision introduced in the prior cycle and giving the entire HTTP surface a single, auditable source of truth. Simultaneously, the OWASP A05 UUID-reflection class was fully eliminated from the Model Registry API, test hygiene gaps were addressed, and a structural route-table test harness was added to prevent future regressions. The project delivered with zero pipeline failures (excluding one auto-cancelled connection-error retry on WP-004) and 3,599 tests passing at close.

---

## Metrics

| Work Package | Description | Tests Passed | Failures | Coverage |
|---|---|---|---|---|
| WP-001 | Route interface rename + query-param plumbing | 3,593 | 0 | 118 test files |
| WP-002 | Test hygiene + `@throws` JSDoc + slug validation fix | 3,594 | 0 | 118 test files |
| WP-003 | UUID-reflection hardening (OWASP A05) + batch validation | 37 | 0 | 100% of api-models tests |
| WP-004 | Migrate `matchRoute()` → declarative `buildRoutes()` | 1,701 | 0 | 55 GUI files + 8 server files |
| WP-005 | Route-table structural-invariant test harness | 3,599 | 0 | 119 test files |
| WP-006 | Final documentation + manifest sweep | 7 (ACs) | 0 | — |

**Final test count at project close: 3,599 tests across 119 test files — all passing.**

**Security findings:** 0 Critical · 0 High · 0 new Medium · 1 pre-existing Medium (out of WP scope, documented below)

---

## Work Package Outcomes

### WP-001 — Route Interface + Query-Param Plumbing

- Renamed `BodyRoute` → `Route` (exported interface) and `buildBodyRoutes()` → `buildRoutes()`, `dispatchBodyRoute()` → `dispatchRoute()` in `mcp-server/gui/server.ts`.
- Extended the handler signature with an optional `query?: URLSearchParams` third parameter — fully backward-compatible; existing handlers ignore it.
- `dispatchRoute()` now accepts the full URL, calls `parseQueryString()` once at the top, and passes the parsed `URLSearchParams` to every matched handler.
- `handleRequest()` now passes the full URL (not just path) to the dispatcher, enabling downstream query-param consumption.
- JSDoc extended with edge-case documentation for `parseQueryString` (bare `?`, percent-encoding, hash/fragment characters).
- `data-flows.md` and `api-surface.md` updated to reflect the new single-dispatcher architecture.

**Files modified:** `mcp-server/gui/server.ts`, `mcp-server/gui/docs/agents/project-manifest/data-flows.md`, `mcp-server/gui/docs/agents/project-manifest/api-surface.md`, plus `.context/` snapshots.

---

### WP-002 — Test Hygiene + @throws JSDoc + Slug Validation

- Added module-level `afterEach` teardown in `api-client.test.ts` that deletes `globalThis.fetch`, eliminating test-ordering leakage from fetch-mock state.
- Added `@throws {{ code: string, message: string }}` JSDoc to all 8 model-related methods in `api-client.js` (`getModels`, `saveModels`, `loadDefaultModels`, `getPersonas`, `getAssignments`, `updateAssignments`, `replaceAssignedModel`, `rebuildPersonas`), establishing a documented error contract for the Model Registry API surface.
- Fixed `mrValidateSlug()` in `config-model-registry.js`: added `!slug.trim()` guard so whitespace-only strings (`'   '`) return `'Slug is required.'` instead of the misleading regex error.
- Added targeted test case in `config-helpers.test.ts` verifying the whitespace-only slug path (test count: 44 → 45).
- `api-surface.md` corrected: endpoint count was 32 (stale), now correctly 40 — all 8 Model Registry and Persona methods added during `model-settings-rework-1` were missing from documentation.

**Files modified:** `mcp-server/tests/gui/api-client.test.ts`, `mcp-server/gui/public/api-client.js`, `mcp-server/gui/public/views/config-model-registry.js`, `mcp-server/tests/gui/config-helpers.test.ts`, `mcp-server/docs/agents/project-manifest/file-tree.md`, `mcp-server/docs/agents/project-manifest/api-surface.md`.

---

### WP-003 — UUID-Reflection Hardening (OWASP A05) + Batch Validation

- Replaced all 5 UUID-reflecting error messages in `handleUpdateAssignments()` and `handleReplaceAssignedModel()` with count-or-generic patterns (matching the persona-key pattern already established in `model-settings-rework-1`).
- Refactored per-persona UUID validation from fail-fast to batch: `filter()` collects all invalid UUIDs before throwing a single error with the count (`"N model UUID(s)..."`). Reviewer fixed singular/plural to `"1 model UUID"` vs `"3 model UUIDs"`.
- Added explanatory comment documenting the intentional asymmetry between fail-fast persona-key loop and batch UUID collection.
- Reviewer applied `some()` refactor for `referenced` detection — idiomatic and reduces mutable state.
- File-level JSDoc updated to explicitly document batch-mode UUID validation and the fail-fast/batch asymmetry.
- **Security audit PASS:** 0 Critical, 0 High. All 5 OWASP A05-hardened messages confirmed — no user-submitted value reflected in any error response.
- New test case (AC-9) verifies 3-UUID batch error: single error, count in message, no UUID value reflected.

**Files modified:** `mcp-server/gui/api-models.ts`, `mcp-server/tests/gui/api-models.test.ts`.

---

### WP-004 — Migrate matchRoute() to Declarative Route Table

The largest work package in this cycle. Deleted the ~1,100-line `matchRoute()` function entirely and migrated all 50+ routes into declarative `Route` entries in `buildRoutes()`.

- Routes organised into three sections: **A** (body-parsing, existing), **B** (keyword-specific body-free, both active and deprecated), **C** (catch-all body-free). Section B **must** precede Section C — this ordering is load-bearing (prevents the catch-all `GET /api/projects/:repo/:slug` from silently shadowing 8 deprecated keyword routes) and is documented in a prominent JSDoc comment block.
- 52 parameterised routes all use named capture groups — 0 positional groups confirmed by grep.
- `handleRequest()` simplified to a single `dispatchRoute()` call with 404 fallthrough — from a complex branching function to ~35 clean lines.
- `RouteHandler` type alias removed (was only used by `matchRoute()`).
- Query-parameter routes (`GET /api/projects`, `/api/knowledge`, `/api/repos`, `/:repo/:slug/dialogues`, `/:repo/:slug/chunks`, `/:repo/:slug/runs/:filename`) now receive params via the dispatcher's `query` argument.
- All deprecated routes remain functional — Section B keyword-specific ordering confirmed.
- Documentation updated: `data-flows.md` §2 and §11, `constraints.md` §9 — all `matchRoute()` references removed.
- Reviewer applied double-`parseInt` fix (both `runs/:filename` routes) — cosmetic only, no behavioral change.

**Files modified:** `mcp-server/gui/server.ts`, `mcp-server/gui/docs/agents/project-manifest/data-flows.md`, `mcp-server/gui/docs/agents/project-manifest/constraints.md`.

---

### WP-005 — Route-Table Structural-Invariant Test Harness

Created `mcp-server/tests/gui/route-table.test.ts` with 4 structural invariant tests that run on every CI pass:

1. **Non-empty sanity:** `buildRoutes()` returns at least 1 route.
2. **Method validity:** Every route's `method` is from `{GET, POST, PUT, PATCH, DELETE}`.
3. **Named groups only:** Every RegExp route uses only named capture groups — positional groups detected via `\((?!\?)` negative lookahead.
4. **No duplicate routes:** No two routes share the same `method + path` combination.

QA stress-tested all 4 invariants by injecting synthetic violations (duplicate string route, duplicate RegExp route, positional-group RegExp, invalid method `HEAD`) — all 4 violations were correctly detected.

`Route` interface JSDoc updated to enumerate valid HTTP methods and link to `route-table.test.ts` as the enforcement point. CTX context regenerated.

**Files modified:** `mcp-server/tests/gui/route-table.test.ts` (new), `mcp-server/gui/server.ts`.

---

### WP-006 — Final Documentation + Manifest Sweep

Consolidated documentation pass closing all cross-cutting documentation debts:

- **Symbol sweep:** Eliminated all occurrences of `BodyRoute`, `buildBodyRoutes`, `dispatchBodyRoute`, and `matchRoute` from both manifest trees (`mcp-server/docs/agents/project-manifest/` and `mcp-server/gui/docs/agents/project-manifest/`) and all `.context/mcp-server/` snapshots.
- **Constraint 57 (new):** `@throws` JSDoc convention for error-rejecting API client methods — added to `mcp-server/docs/agents/project-manifest/constraints.md` with rule, scope, rationale, and anti-pattern/correct-pattern examples.
- `config-model-registry.js` L4 dependency comment updated with explicit file annotations.
- `orchestrator/src/utils/persona_models.py` glob call annotated with inline comment explaining the `[0-9]*-*.yaml` pattern trade-off.
- `.context/mcp-server/` regenerated (all 14 snapshot files updated).
- `gui/docs/agents/project-manifest/constraints.md` §9 reworded from past-tense migration note to present-tense canonical state.
- `route-table.test.ts` added to `file-tree.md` test file listing.

**Files modified:** 14 files across manifest, context snapshot, and source trees.

---

## Strategic Recommendations (Gold Nuggets)

### 1. Narrow `Route.method` to a discriminated union type (Low effort, High value)
**Source:** Developer + QA + Reviewer (WP-005)
The `Route.method` field is typed as `string`. Narrowing to `'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'` would move AC-2 of the route-table test from a runtime assertion to a compile-time TypeScript guarantee — eliminating an entire category of runtime validation. This is a one-line change in `server.ts`.

### 2. Add a dedicated unit test for `dispatchRoute()` query-param injection (Low effort, Medium value)
**Source:** QA (WP-001)
No test currently asserts that a handler receives a correctly-populated `URLSearchParams` when a URL contains a query string. This gap becomes a regression risk as future handlers begin consuming `query`. A targeted test exercising the `dispatchRoute()` → `query?.get('key')` path should be added before any handler adopts the new parameter.

### 3. Cache the compiled route table (Medium effort, Low priority)
**Source:** Developer + Reviewer (WP-004)
`dispatchRoute()` calls `buildRoutes()` on every request, rebuilding the route array (~450 entries) each time. Memoizing by `ledgerRoot + configPath` would eliminate repeated array allocations. At current traffic levels this is a non-issue, but it is the right shape for a future performance pass.

### 4. Split `buildRoutes()` into sub-builders (Medium effort, Medium value)
**Source:** Developer (WP-004)
The route table is now ~450 lines. Extracting logical sub-builders (e.g., `buildProjectRoutes()`, `buildKnowledgeRoutes()`) and composing them in `buildRoutes()` would improve readability and make it easier to locate a specific route group. No behavioral change required.

### 5. Extend `@throws` JSDoc to remaining API client methods (Low effort, Low priority)
**Source:** Developer + Reviewer (WP-002)
The 8 model-related methods now carry `@throws` annotations. The remaining methods (`getRunLogs`, `getRunLogEntries`, `getServerInfo`, `orchestratorStart`, `getKnowledge`, `getChunks`, etc.) all reject on HTTP errors via the same shared `request()` helper but lack `@throws`. A single documentation pass would complete the API surface contract.

### 6. Fix pre-existing `readModels()` error-surfacing (Low effort, Low-Medium priority)
**Source:** Security Auditor (WP-003)
`model-registry.ts` `readModels()` includes `err.message` verbatim in its `ApiError` on non-ENOENT failures. OS-level error messages can occasionally contain filesystem path fragments. OWASP A05 (info-disclosure). Recommendation: log the detail to `stderr` and return a generic message to the client. Low exploitation risk on a local-only server, but a simple fix.

---

## Deferred & Follow-Up Items

### Deferred (intentionally postponed to a future cycle)

| # | Source | Agent | Description | Priority |
|---|---|---|---|---|
| D-1 | WP-001 (impl) | Developer | The route map summary comment block (~lines 1384–1454 in the old `matchRoute()`) was a manually maintained duplicate of the route table. Now that the route table is declarative, a machine-readable route registry (e.g., for OpenAPI spec generation or integration test harness scaffolding) would eliminate future maintenance drift. | Low |
| D-2 | WP-004 (impl) | Developer | `dispatchRoute()` rebuilds the full route table on every request. Memoize by `ledgerRoot + configPath` for performance. | Low |
| D-3 | WP-004 (impl) | Developer | `buildRoutes()` is now ~450 lines. Split into domain sub-builders (`buildProjectRoutes`, `buildKnowledgeRoutes`, etc.) and compose in `buildRoutes()`. | Low |
| D-4 | WP-005 (impl) | Developer | `buildRoutes()` requires four arguments to inspect route structure. A zero-argument factory or exported static route descriptor would make structural tests cleaner and express intent more directly. | Low |

### Out-of-Scope (beyond this plan's boundaries, flagged for awareness)

| # | Source | Agent | Description | Priority |
|---|---|---|---|---|
| O-1 | WP-003 (security) | Security Auditor | `model-registry.ts` `readModels()` error handler includes `err.message` verbatim in `ApiError` on non-ENOENT failures — potential path/system info leak (OWASP A05). Pre-existing, not introduced in this cycle. Local-only server reduces risk. Recommend generic message + stderr logging. | Medium |
| O-2 | WP-002 (code-review) | Reviewer | `@throws` JSDoc annotations on the 8 model methods establish a convention. The remaining API client methods (`getRunLogs`, `getServerInfo`, `orchestratorStart`, etc.) lack `@throws` but also reject on HTTP errors. | Low |
| O-3 | WP-001 (qa) | QA | No unit test directly exercises the `query` parameter injection path through `dispatchRoute()`. Tests currently exercise routes through `handleRequest()` integration-style. | Low |
| O-4 | WP-004 (qa) | QA | The deprecated `GET /:slug/runs` route is covered through integration paths rather than a dedicated unit test. | Low |
| O-5 | WP-004 (impl) | Developer | `gui/docs/agents/project-manifest/constraints.md` §9 retains a low-priority phrasing note: the `RouteHandler type alias has been removed` line was reworded in WP-006, but a latent reference to implementation provenance in an adjacent bullet remains. | Low |
| O-6 | WP-006 (impl) | Developer | `api-surface.md` is very large (~5000+ lines) and duplicates what `ctx-generate` extracts from source. Consider splitting into focused domain documents to reduce maintenance burden. | Low |

---

## Failed / Blocked Pipelines

- **WP-004 documentation pipeline (attempt 1):** Auto-cancelled due to a connection error during the orchestrator stage. This was a transient infrastructure issue — the pipeline was re-run cleanly on the second attempt. No work was lost and the WP completed without any rework increment.

---

## Next Steps for the Planner

1. **Immediately actionable (Low effort):** Narrow `Route.method` to a discriminated union type (`'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'`) in `server.ts` — a one-line change that converts a runtime test assertion into a compile-time guarantee.
2. **Short-term:** Add a unit test for `dispatchRoute()` query-param injection before any handler begins consuming the `query` parameter — locks in the regression boundary.
3. **Security:** Address the pre-existing `readModels()` `err.message` surfacing (O-1) in the next security-focused cycle.
4. **Documentation maintenance:** Complete `@throws` JSDoc coverage for the remaining API client methods (O-2).
5. **Architecture (medium-term):** Split `buildRoutes()` into domain sub-builders and evaluate memoization of the compiled route table.
6. **OpenAPI / Integration harness:** The declarative route table is now the prerequisite for this — all routes are in one place and use named capture groups. A future cycle could generate an OpenAPI spec from the table or build an integration test scaffolding layer on top of it.
