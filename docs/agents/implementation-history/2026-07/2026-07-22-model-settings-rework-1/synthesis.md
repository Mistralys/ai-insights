# Synthesis Report — model-settings-rework-1

**Plan:** 2026-07-22-model-settings-rework-1  
**Date:** 2026-07-23  
**Status:** COMPLETE (9/9 WPs, 0 failures)

---

## Executive Summary

This rework cycle addressed the technical debt, security hardening, and test-coverage gaps
identified in the previous model-settings project synthesis. The work is purely non-functional:
no new features were delivered. The five major deliverables were:

1. **Server Route Dispatch Refactor (WP-005)** — Introduced a typed `BodyRoute` descriptor,
   `buildBodyRoutes()`, and `dispatchBodyRoute()` into `server.ts`. `handleRequest()` shrank
   from ~448 lines to 55 lines, eliminating 18 copy-paste try/catch blocks. Named capture
   groups (`(?<name>…)`) are now mandatory for parameterised RegExp routes.

2. **Config View Modularization (WP-004, WP-005/WP-001, WP-007)** — `config.js` was reduced
   from ~1,395 lines to 181 lines by extracting the Model Registry tab into
   `config-model-registry.js` (606 lines) and the Persona Models tab into
   `config-persona-models.js`. The resulting `config.js` is a pure coordinator with no `mr*`
   or `pm*` definitions remaining. The three-file decomposition pattern now matches the
   established `project-detail-*.js` convention.

3. **Security & UX Hardening (WP-001, WP-003)** — The persona-ID-enumerating error message
   in `handleUpdateAssignments()` was replaced with a count-based, non-echoing message. Client-
   side duplicate-slug pre-check was added to the Model Registry Save path, and an empty-name
   guard was added to the Persona Models inline-edit Done handler — both fire without a
   server round-trip.

4. **Orchestrator Future-Proofing (WP-002)** — The glob pattern in
   `find_ledger_yaml_for_stage()` was widened from `[1-9]-*.yaml` to `[0-9]*-*.yaml`,
   supporting two-digit persona role numbers with no breaking changes and a new regression
   test to prevent backsliding.

5. **Test Coverage (WP-002, WP-006, WP-008)** — 16 API client unit tests were added covering
   all 8 model-related methods (success + error paths). 44 frontend helper unit tests were
   added covering `mrDeriveSlug`, `mrValidateSlug`, `mrHasChanges`, and `pmCloneAssignments`
   using the `vm.runInThisContext()` pattern.

---

## Metrics

| Metric | Value |
|---|---|
| Work Packages | 9 / 9 COMPLETE |
| Pipeline Stages Passed | 33 (sum across all WPs) |
| Pipeline Failures | 0 |
| Tests Passed (final full suite) | 3,593 |
| Tests Failed | 0 |
| Regressions | 0 |
| Critical/High Security Findings | 0 |
| Medium Security Observations | 2 (both deferred) |
| New Source Files | 3 (config-model-registry.js, config-persona-models.js, config-helpers.test.ts) |
| Net Line Reduction (config.js) | ~1,214 lines removed (1,395 → 181) |
| Net Line Reduction (handleRequest) | ~393 lines removed (~448 → 55) |
| Reviewer-Applied Fix-Forwards | 2 (plural/singular error message; stale docstring) |

---

## Strategic Recommendations

### Gold Nuggets

1. **Decompose server.ts further** — The `BodyRoute` table now reveals the full list of
   body-parsing routes in one place. A follow-on refactor can apply the same declarative
   approach to `matchRoute()` (the body-free GET/DELETE routes), making the entire HTTP
   surface visible without reading the dispatcher logic.

2. **Apply info-disclosure hardening to UUID reflection** — The model-UUID and replace-model
   validation errors in `api-models.ts` still echo user-submitted UUIDs verbatim (identified
   at Medium severity by the Security Auditor in WP-003). The same count-or-generic message
   pattern applied to persona keys should be extended here in a focused hardening pass.

3. **Formalize a `afterEach` fetch-mock teardown** — `api-client.test.ts` installs
   `globalThis.fetch` mocks per-test but does not clean up in `afterEach`. While currently
   safe (every test reinstalls), this is a latent ordering-dependency hazard that grows with
   the test file. A one-liner `afterEach(() => { delete (globalThis as any).fetch; })` in the
   `describe` root eliminates the risk permanently.

4. **Document view-module global ownership in setup-gui-globals.ts** — Now that three view
   modules (`config.js`, `config-model-registry.js`, `config-persona-models.js`) share a
   `jsdom` globalThis context in tests, there is no single record of which globals are
   "owned" by which file. A comment table in `setup-gui-globals.ts` listing the module-level
   globals per file would prevent subtle test-isolation bugs as the test suite grows.

5. **Establish a JSDoc `@throws` convention for api-client.js** — The 8 model-related API
   client methods omit `@throws` documentation for the `{ code, message }` rejection shape.
   Adding a shared `@throws {ApiError}` note to the JSDoc template for all error-rejecting
   methods would make the contract explicit for future callers.

---

## Deferred & Follow-Up Items

| # | Source | Agent | Type | Description | Priority |
|---|---|---|---|---|---|
| 1 | WP-003 | Security Auditor | **Deferred** | `handleUpdateAssignments()` lines 371–377: model UUID validation error reflects back user-submitted UUID and persona key verbatim. Same class of info-disclosure as was fixed for persona keys. Schema enforces UUID v4 format (limits injection surface). Recommend applying count-or-generic message pattern in a follow-on hardening pass. | Medium |
| 2 | WP-003 | Security Auditor | **Deferred** | `handleReplaceAssignedModel()` lines 432–442: `old_model_id` and `new_model_id` values reflected verbatim in validation errors. Same UUID-echo pattern. Consolidate in the same hardening pass as item 1. | Medium |
| 3 | WP-003 | Developer | **Deferred** | `handleUpdateAssignments()` persona-key validation loop fails-fast on the first invalid key. A caller submitting N invalid keys needs N round-trips to discover all violations. Consider collecting all invalid keys and reporting a count in a single response. | Low |
| 4 | WP-002/WP-006 | Developer, QA | **Deferred** | `api-client.test.ts` lacks an `afterEach` teardown for `globalThis.fetch`. Currently safe (each test reinstalls), but creates latent ordering-dependency risk for future tests that omit the setup step. | Low |
| 5 | WP-002 | Developer | **Deferred** | `api-client.js` model-related methods lack `@throws` JSDoc tags. Adding a shared `@throws {ApiError}` note would document the `{ code, message }` rejection contract for callers. | Low |
| 6 | WP-008 | QA | **Deferred** | `mrValidateSlug('   ')` (whitespace-only string) passes the falsy check and returns the generic regex error rather than 'Slug is required.' Functionally correct but UX is slightly misleading. | Low |
| 7 | WP-008 | Developer | **Deferred** | `setup-gui-globals.ts` does not document which globals are owned by each view module. A comment table would help prevent shared-global hazards as the test suite grows. | Low |
| 8 | WP-004 | Developer | **Deferred** | `config-model-registry.js` dependency comment at the file header only lists `configDirty`. Expand to: `Depends on: API, UI, escapeHtml, crypto.randomUUID (browser built-in), configDirty (config.js)`. | Low |
| 9 | WP-002 | Developer | **Deferred** | `orchestrator/src/utils/persona_models.py`: glob `[0-9]*-*.yaml` would also match `0a-name.yaml` (digit + non-digit chars before hyphen). Acceptable in practice (build tooling enforces naming), but a comment noting this intentional trade-off would help future maintainers. | Low |

---

## Next Steps

### Immediate (next cycle)

1. **UUID-reflection hardening pass** — Address deferred items 1 and 2: apply the
   count-or-generic message pattern to model UUID and replace-model validation errors in
   `api-models.ts`. This closes the full OWASP A05 info-disclosure class in the Model Registry
   API handlers.

2. **`matchRoute()` declarative refactor** — Apply the `BodyRoute` / dispatcher pattern to the
   body-free GET/DELETE route dispatch in `server.ts`, making the entire HTTP surface
   declarative in a single pass.

### Medium Term

3. **GUI test hygiene** — Address deferred items 3–8 in a single "test hygiene" WP: add
   `afterEach` fetch-mock teardown, add `@throws` JSDoc, add whitespace-slug test case, and
   add the setup-globals ownership comment table.

4. **SPA module system migration** — The `vm.runInThisContext()` pattern works but is a
   workaround for the absence of ES modules. When the GUI is ready for an `<script type="module">`
   migration, the test loading approach can be simplified to standard Vitest imports.

### Strategic Vision

The server-side and frontend refactors from this cycle establish the structural foundations
needed before any further GUI expansion. The `BodyRoute` table is now the single authoritative
list of the GUI's HTTP surface — a prerequisite for any future OpenAPI spec or integration
test harness. The `config-model-registry.js` / `config-persona-models.js` split follows the
`project-detail-*.js` decomposition convention and sets the pattern for any future config
tabs. The remaining work (UUID hardening, `matchRoute()` declarative refactor) is bounded
and well-specified — both are suitable for a short, focused next cycle.
