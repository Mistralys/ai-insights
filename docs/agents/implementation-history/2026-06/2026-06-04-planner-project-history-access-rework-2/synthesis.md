# Synthesis Report
**Plan:** `2026-06-04-planner-project-history-access-rework-2`
**Date:** 2026-06-05
**Status:** COMPLETE — All 2 work packages delivered across all 4 pipeline stages.

---

## Executive Summary

This plan addressed two production-critical defects surfaced by the prior synthesis (`2026-06-04-planner-project-history-access-rework-1`):

1. **WP-001 — Typed catch in `safeListRepositoryInsights`** (`mcp-server/src/tools/repository-context.ts`): A bare `catch {}` was silently swallowing all errors, including genuine I/O failures (`EACCES`, `EIO`, disk corruption). The catch was narrowed to suppress only the two known slug-validation error prefixes (`"Invalid repository name:"` / `"'global' is a reserved name"`) and re-throw everything else. The function was added to the `_internal` export for direct unit-testability, and 7 new unit tests were added covering all discriminated paths.

2. **WP-002 — `sanitiseSlug` for Strategy GUI Register button** (`mcp-server/gui/public/views/strategy.js`): The "Register" button pre-filled `#new-repo-id` with the raw filesystem directory name, causing a `VALIDATION_ERROR` for any user whose ledger root contained directories with dots, spaces, or special characters. A `sanitiseSlug(raw)` helper was added (lowercase → replace non-slug chars → strip leading non-alphanumeric → collapse consecutive hyphens → strip trailing hyphens → fallback `'repo'`) and applied to the `#new-repo-id` pre-fill only. The label and folders fields continue to use the raw name unchanged.

Both WPs executed in parallel, completed all four pipeline stages (implementation → QA → code-review → documentation) with zero failures, and required no rework cycles.

---

## Metrics

| Metric | WP-001 | WP-002 |
|---|---|---|
| Pipeline stages | 4/4 PASS | 4/4 PASS |
| Rework cycles | 0 | 0 |
| Tests added | 7 new unit tests | Manual verification (no GUI test runner) |
| Full suite result | 3,088 passed / 0 failed | 1,223 passed / 0 failed |
| TypeScript build | Clean (exit 0) | N/A (vanilla JS) |
| Implementation duration | 137 s | 45 s |
| QA duration | 75 s | 119 s |
| Code-review duration | 64 s | 50 s |
| Documentation duration | 294 s | 150 s |

**Total tests in suite after changes:** 3,088 (mcp-server TypeScript suite) + 1,223 (vitest suite) = **4,311 tests, 0 failures.**

---

## Strategic Recommendations (Gold Nuggets)

### 1. Error message coupling is an acknowledged technical debt
The `safeListRepositoryInsights` catch guard relies on stable message **prefixes** from `_validateSlug()` and `repositoryStorePath()` in `knowledge-store.ts`. A code comment documents this coupling, and the plan explicitly accepts string-prefix matching as intentional. However, if those message strings ever change without a corresponding guard update, slug-validation errors will silently re-throw instead of returning `[]`, breaking the graceful-degradation contract (Constraint 76).
**Recommendation:** If `knowledge-store.ts` error messages are ever refactored, grep for the guard strings in `repository-context.ts` as part of the change checklist. Alternatively, a future WP could introduce typed slug-validation errors via a custom error class (rejected this cycle due to scope, but the right long-term fix).

### 2. `sanitiseSlug` scope is a future reusability bottleneck
`sanitiseSlug` is defined as a local function inside `renderStrategyList` and is not accessible from `renderStrategyDetail` or any other view function. This was the correct choice for a single call site and the module-less SPA pattern, but if slug sanitization is ever needed elsewhere in the GUI, the function would need to be duplicated or elevated to module scope.
**Recommendation:** If a second call site appears, extract `sanitiseSlug` to a shared utility (e.g., a `utils.js` module or a dedicated section at the top of `strategy.js` before any `render*` functions).

### 3. GUI vanilla JS test coverage gap
No automated test infrastructure exists for `strategy.js`. The `sanitiseSlug` function is pure (no DOM or API dependencies) and is trivially unit-testable, but the project has no test harness for browser-targeted vanilla JS.
**Recommendation:** If slug utilities are ever extracted to module scope (see #2), introduce a vitest test file for the shared utility at that time. This would close the coverage gap without requiring a full GUI test harness.

### 4. `_internal` export convention lacks a module-level boundary note
The `_internal` export in `repository-context.ts` is decorated with `@internal` JSDoc but has no module-level comment clarifying that it is test-only and must not be imported by consumers. Documented in `api-surface.md` (addressed by Documentation agent), but the source file itself remains ambiguous for contributors reading it cold.
**Recommendation:** Add a brief inline comment above the `_internal` export const explaining the test-only boundary — e.g., `// _internal: exported for unit testing only; not part of the public API.`

### 5. `makeManager` stub uses `as any` — acceptable but worth narrowing
The `makeManager` test stub in `repository-context.test.ts` uses `as any` to satisfy TypeScript's structural typing for `KnowledgeStoreManager`. This is a common and acceptable test pattern but suppresses type-checking on the stub entirely.
**Recommendation:** In a future cleanup pass, narrow the stub to `Pick<KnowledgeStoreManager, 'listInsights'>` to preserve type safety on the one method being tested.

---

## Deferred & Follow-Up Items

| # | Source | Agent | Description | Type | Priority |
|---|---|---|---|---|---|
| 1 | WP-001 | Developer / QA / Reviewer | Error message coupling in the `safeListRepositoryInsights` catch guard. String-prefix matching is intentional (per plan rationale) but brittle if `knowledge-store.ts` messages change. The right long-term fix is a custom typed error class in `knowledge-store.ts`. | Deferred | Medium |
| 2 | WP-001 | Developer | `makeManager` stub uses `as any` in `repository-context.test.ts`. Should be narrowed to `Pick<KnowledgeStoreManager, 'listInsights'>` in a future cleanup pass. | Deferred | Low |
| 3 | WP-001 | Reviewer | No module-level note in `repository-context.ts` source clarifying that `_internal` is test-only. Addressed in `api-surface.md` but not in the source file itself. | Deferred | Low |
| 4 | WP-002 | QA | `sanitiseSlug` is scoped inside `renderStrategyList` and not reusable from other views. No second call site exists today, but if one appears, extraction to module scope will be required. | Out-of-scope | Low |
| 5 | WP-002 | QA | No automated tests for `strategy.js` (vanilla browser JS). `sanitiseSlug` is pure and trivially unit-testable — a test harness could be added if slug utilities are ever extracted to module scope. | Out-of-scope | Low |
| 6 | Plan | Planner | Introducing a custom error class for slug-validation failures in `knowledge-store.ts` was explicitly rejected this cycle (larger scope, modifies a constrained module). This is the correct structural fix that would eliminate the string-prefix coupling permanently. | Out-of-scope | Medium |

---

## Next Steps for Planner / Manager

1. **No immediate follow-up required.** Both production defects from the prior synthesis are resolved. The codebase is in a stable, shippable state.

2. **Medium-priority follow-up to consider for the next cycle:**
   - Introduce a custom slug-validation error type in `knowledge-store.ts` (`SlugValidationError extends Error`) so the catch guard in `safeListRepositoryInsights` can use `instanceof` instead of string-prefix matching. This eliminates the message-coupling debt and is the structurally correct fix.

3. **Low-priority cleanup to bundle with other work:**
   - Narrow the `makeManager` test stub to `Pick<KnowledgeStoreManager, 'listInsights'>`.
   - Add a source-level `// _internal: test-only` comment above the `_internal` export in `repository-context.ts`.
   - If a second `sanitiseSlug` call site ever appears in the GUI, extract the function to module scope and add a vitest test file.

4. **Documentation is current.** `file-tree.md`, `api-surface.md`, README, `changelog.md`, and all `.context/` files were updated. No further documentation work is needed.
