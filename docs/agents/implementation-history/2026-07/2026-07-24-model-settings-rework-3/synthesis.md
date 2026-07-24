# Synthesis Report — model-settings-rework-3

**Date:** 2026-07-24  
**Status:** COMPLETE  
**Work Packages:** 6 / 6 COMPLETE  
**Total Pipeline Stages Executed:** 22 (5 stages passed: WP-001; 4 each: WP-002, WP-003, WP-005; 3: WP-004 skipped docs; 1: WP-006 docs-only)

---

## Executive Summary

This cycle closes the final deferred and out-of-scope items from the three-session model-settings hardening series (`model-settings`, `model-settings-rework-1`, `model-settings-rework-2`). Six work packages were completed across four architectural tracks:

1. **Type Safety (WP-004):** `Route.method` narrowed from `string` to an exported `HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'` discriminated union, converting a runtime invariant test into a compile-time guarantee. Full test suite (3,605 tests across 120 files) passes cleanly.

2. **Architecture Refactor (WP-005):** The ~630-line `buildRoutes()` monolith decomposed into six domain-focused non-exported sub-builders (`buildConfigRoutes`, `buildOrchestratorRoutes`, `buildRepoRoutes`, `buildKnowledgeRoutes`, `buildModelRoutes`, `buildProjectRoutes`) with a new zero-argument `getRouteDescriptors()` exported factory for structural test isolation.

3. **Security Hardening — OWASP A05 (WP-001):** All 6 `(err as Error).message` interpolations in `model-registry.ts` replaced with generic client-facing messages; original error detail routed to `process.stderr.write()` with `[server]` prefix. 10 new tests added to `model-registry.test.ts` covering all 3 targeted error surfaces (readModels, readAssignments, loadDefaults) for both generic message and stderr logging.

4. **Documentation & JSDoc (WP-001, WP-002, WP-003, WP-006):**
   - `@throws` JSDoc coverage completed for all 52 IIFE-exported methods in `api-client.js` (8 pre-existing + 44 new). Four `@typedef` blocks added (GuiConfig, InsightEntry, ServerInfo, ServerVersions) and all utility-method `@returns` types promoted to named types.
   - `dispatchRoute()` dedicated unit tests created in `dispatch-route.test.ts` (6 test cases, real `createServer()`/`fetch` pattern — no synthetic mocks).
   - Project manifests, `api-surface.md`, `constraints.md`, `tests/gui/README.md`, and `.context/` snapshots updated to reflect all structural changes.

---

## Metrics

| Work Package | Title | Tests Passed | Tests Failed | Coverage / Notes |
|---|---|---|---|---|
| WP-001 | OWASP A05 hardening + `@throws` JSDoc | 59 (49 pre-existing + 10 new) | 0 | All 6 error paths hardened; stderr verified |
| WP-002 | `dispatchRoute()` unit tests | 6 new + 1,634 regression | 0 | Real `createServer()`/`fetch` — no synthetic mocks |
| WP-003 | `@throws` JSDoc audit (`api-client.js`) | 4 (structural audit) | 0 | 52 `@throws` confirmed; no runtime code changed |
| WP-004 | `HttpMethod` union type for `Route.method` | 3,605 (120 files) | 0 | TypeScript build clean; `Set<HttpMethod>` in tests |
| WP-005 | `buildRoutes()` sub-builder decomposition | 3,605 (120 files) | 0 | Section A/B/C ordering preserved and documented |
| WP-006 | Project manifest & `.context/` update | — | — | Docs-only; snapshots regenerated |

**Security Issues:** 0 critical, 0 high, 0 medium (WP-001 security audit)  
**TypeScript Build:** Clean (0 errors) across all cycles  
**Pipeline Health:** 5/6 WPs with all pipeline stages passing; WP-004 completed before documentation stage (docs addressed in WP-005 and WP-006)

---

## Strategic Recommendations ("Gold Nuggets")

### 1. Dual-layer ordering constraint documentation is the right pattern for load-bearing invariants
The Section A/B/C route ordering constraint is documented both in `buildRoutes()` JSDoc (module-level) and via `⚠️ ORDERING CONSTRAINT` inline banners inside `buildProjectRoutes()`. This makes the invariant discoverable from two entry points — the function contract and the implementation site — and should be adopted as a standard for all load-bearing ordering or sequencing invariants in the codebase.

### 2. `getRouteDescriptors()` sentinel factory pattern for structural tests
Exporting a zero-argument `getRouteDescriptors()` factory that calls `buildRoutes()` with sentinel arguments cleanly decouples structural test harnesses from filesystem path dependencies. The pattern generalizes to any function that requires runtime arguments for its handlers but exposes a structural contract (path/method combinations) that is testable with dummy closures.

### 3. Real `createServer()`/`fetch` with ephemeral port 0 as canonical dispatcher test pattern
`dispatch-route.test.ts` demonstrates that `dispatchRoute()` can be exercised end-to-end without synthetic `IncomingMessage`/`ServerResponse` mocks. Using port `0` eliminates port collision risk, and `afterEach(server.close())` prevents resource leaks. This pattern is now documented in `tests/gui/README.md` as the canonical approach for dispatcher isolation testing.

### 4. EISDIR trigger strategy for READ_ERROR tests
Using a directory at the expected file path (EISDIR) for READ_ERROR test setup guarantees a non-ENOENT OS error that carries OS-level detail in its `.message`, making the generic-message assertion meaningful. This is a robust pattern for testing error-message sanitization in file-access code.

### 5. `@typedef` blocks as IDE discoverability layer for plain-JS modules
Adding `@typedef GuiConfig`, `@typedef InsightEntry`, `@typedef ServerInfo`, and `@typedef ServerVersions` to `api-client.js` gives VS Code and WebStorm users field completions without requiring TypeScript migration. The pattern mirrors the existing `@typedef DialogueBlock` and should be applied proactively when adding new JSDoc blocks to plain-JS modules.

---

## Pipeline Observations

### Notable: WP-001 required 3 documentation FAILs before implementation gap was resolved
WP-001's acceptance criteria array contained criteria from two distinct scopes (api-client.js `@throws` scope, AC-11–14; and model-registry.ts OWASP A05 scope, AC-1–10). The first documentation pipeline correctly PASSed the `@throws` criteria, but the OWASP A05 implementation had never been performed. Three consecutive documentation FAILs (each identifying the same gap) preceded the implementation being applied directly in a final documentation pass.

**Root cause:** The WP's `work_package_file` pointed to `work/WP-003.md` (api-client.js scope) but its `acceptance_criteria` mixed in the model-registry.ts criteria. This created a scope mismatch not caught at the implementation stage.

**Mitigation for future cycles:** WPs covering two distinct implementation files should either be split into separate work packages (preferred) or the acceptance criteria should be clearly sectioned with a MUST gate — implementation must verify ALL criteria, not just the criteria matching the file the Developer chose to focus on.

### Minor: WP-003 declared no `files_modified` artifacts
WP-003 (api-client.js `@throws` audit) found the implementation already complete and declared `files_modified: []`. The project-level comment flagged this for traceability. No action is required, but agents completing audit-type WPs where no changes are needed should explicitly note the pre-existing compliance in the summary to prevent confusion during review.

---

## Deferred & Follow-Up Items

### Deferred (intentionally postponed)

| # | Source | Agent | Description | Priority |
|---|---|---|---|---|
| D-1 | WP-001 (implementation) | Developer | `api-client.js` has no associated test file. Adding a test harness (e.g., jsdom + jest or mock fetch) for the `request()` error-path behavior and JSDoc contract would improve long-term maintainability. | Low |
| D-2 | WP-002 (QA/code-review) | QA, Reviewer | AC-7 stderr regex `.toMatch(/server/)` is broad — both `[server]` (production) and `[test-server]` (unreachable `.catch` branch) would match. Should be tightened to `/\[server\]/` to explicitly distinguish production stderr from test-harness stderr. | Low |
| D-3 | WP-002 (QA) | QA | No edge-case test for a `path` as `RegExp` with named capture groups in `dispatch-route.test.ts`. The `startDispatchServer` helper supports it; the production code exercises that branch in all real routes. | Low |
| D-4 | WP-005 (implementation) | Developer | `buildProjectRoutes()` remains the largest sub-builder (~300 lines) due to the density of deprecated non-namespaced routes. A future cleanup pass could consolidate the deprecated routes into a thin helper once the pre-namespace client base is fully retired. | Low |
| D-5 | WP-005 (implementation) | Developer | The decode-and-`assertSafeSlug` pattern appears verbatim in every namespaced project route handler inside `buildProjectRoutes()`. A tiny inline helper `function ns(groups)` scoped inside the sub-builder would reduce duplication. Out of scope for this WP. | Low |

### Out-of-Scope (beyond this plan's boundaries)

| # | Source | Agent | Description | Priority |
|---|---|---|---|---|
| O-1 | WP-001 (code-review) | Reviewer | `getConfig`, `updateConfig`, `getInsights`, `getServerInfo` have generic `@returns` types (`{Promise<object>}` / `{Promise<object[]>}`). Adding `@typedef` blocks was done for the four new server-info types — the Documentation pipeline addressed this for all four utility methods. ✅ **Resolved in this cycle.** | — |
| O-2 | WP-001 (security audit) | Security Auditor | `request()` helper surfaces server-returned `errData.error.message` to the client-side JS caller. If the backend ever leaks internal error details, those details would reach the client. This is a server-side hardening concern (the model-registry.ts work in this cycle addressed the server side). No further action in this WP. | Low |
| O-3 | WP-003 (code-review) | Reviewer | A top-level README or JSDoc-generated API surface document for the GUI public JS modules could call out that ALL public API methods throw `{ code: string, message: string }` as a module-level contract. Added to `api-surface.md` — ✅ **Resolved in this cycle.** | — |
| O-4 | WP-004 (documentation-forward) | Reviewer | `route-table.test.ts` module-level JSDoc (lines 1–12) could mention the `HttpMethod` import and the compile-time / defense-in-depth duality. ✅ **Resolved by WP-005 Documentation pipeline.** | — |

---

## Next Steps (Recommendations for Next Planner Cycle)

1. **Address D-2 (stderr regex tightening):** Update `dispatch-route.test.ts` AC-7 assertion from `.toMatch(/server/)` to `.toMatch(/\[server\]/)`. Single-line change; low effort, improves test precision.

2. **Retire deprecated non-namespaced routes (D-4):** The pre-namespace client base appears to be fully retired or nearly so. Conduct an audit to confirm which deprecated routes in `buildProjectRoutes()` still receive real traffic, then prune or consolidate them. This would bring `buildProjectRoutes()` to parity with the other sub-builders in size.

3. **Inline `ns()` helper for `buildProjectRoutes()` (D-5):** Extract the repetitive `decodeURIComponent` + `assertSafeSlug` pattern into a scoped two-liner inside `buildProjectRoutes()`. Low risk, improves maintainability.

4. **`api-client.js` test harness (D-1):** This is the last major untested surface in the GUI public layer. A minimal jest/vitest test with `vi.stubGlobal('fetch', ...)` would cover the `request()` error-path contract and serve as a regression backstop for the `@throws` documentation.

5. **No further model-settings cycles anticipated** unless new error paths are introduced in model-registry.ts or new API client methods are added without `@throws` JSDoc. The hardening series is architecturally complete.

---

## AX Feedback

No friction encountered.

---

*Report generated by Head of Operations (Synthesis) — 2026-07-24*
