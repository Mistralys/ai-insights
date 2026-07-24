
# Plan

## Plan Audit Cycles
- Audits: 3 — Plan Auditor v1.7.0
- Architectural Reviews: 2 — Plan Architect Reviewer v2.2.0

## Prior Project Context
Three consecutive model-settings cycles have progressively hardened the GUI server architecture:
- `model-settings` (2026-07-21): Introduced Model Registry GUI + REST API
- `model-settings-rework-1` (2026-07-22): Refactored route dispatch, decomposed config, hardened one info-disclosure error
- `model-settings-rework-2` (2026-07-23): Completed `matchRoute()` → declarative `buildRoutes()` migration, eliminated UUID-reflection (OWASP A05), added route-table structural test harness

This rework-3 closes all remaining deferred and out-of-scope items from the rework-2 synthesis, completing the architectural vision.

## Summary
Complete the model-settings hardening series by: (1) narrowing the `Route.method` type from `string` to a discriminated union, converting a runtime test into a compile-time guarantee; (2) decomposing the ~630-line `buildRoutes()` function into domain-focused sub-builders and adding a zero-argument factory for structural tests; (3) adding dedicated unit tests for `dispatchRoute()` query-parameter injection; (4) eliminating OWASP A05 `err.message` surfacing in all 6 Model Registry error responses; (5) completing `@throws` JSDoc coverage for all ~30 remaining API client methods; and (6) cleaning up a manifest phrasing artifact.

## Architectural Context
The GUI HTTP server (`mcp-server/gui/server.ts`) is a standalone Node.js process serving both static files and a REST API. All API traffic flows through a declarative route table (`buildRoutes()`) iterated by `dispatchRoute()`. The route table is organized into three load-bearing sections (A → B → C) documented in Constraint 71. The `Route` interface defines `method: string`, `path: string | RegExp`, `handler`, and optional `statusCode`/`noBody` fields. Route-table structural invariants are enforced at CI time by `tests/gui/route-table.test.ts`.

The Model Registry (`src/gui/model-registry.ts`) provides file-based CRUD for `local.json`, `default.json`, and `assignments.json`. Six error paths currently embed `(err as Error).message` in `ApiError` responses — a pre-existing OWASP A05 info-disclosure pattern flagged in rework-2.

The API client (`gui/public/api-client.js`) is a plain-JS module with no build step. All methods delegate to a shared `request()` helper that rejects with `{ code, message }`. Constraint 57 mandates `@throws` JSDoc on every method that can reject; 8 model-related methods already comply, ~30 do not.

## Approach / Architecture

### Route Type Safety
Introduce a `HttpMethod` type alias (`'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'`) and narrow `Route.method` from `string` to `HttpMethod`. Export the type for test consumption. The route-table structural test retains its runtime check as defense-in-depth.

### Route Table Decomposition
Extract `buildRoutes()` into domain-focused sub-builders: `buildConfigRoutes()`, `buildOrchestratorRoutes()`, `buildRepoRoutes()`, `buildKnowledgeRoutes()`, `buildModelRoutes()`, `buildProjectRoutes()`. Each sub-builder receives the same closure parameters and returns `Route[]`. The top-level `buildRoutes()` composes them via spread, preserving Section A/B/C ordering. A zero-argument `getRouteDescriptors()` factory returns the route table with dummy arguments for structural test inspection.

### Dispatcher Testing
Create `tests/gui/dispatch-route.test.ts` exercising `dispatchRoute()` with synthetic `IncomingMessage`/`ServerResponse` mocks and hand-crafted route arrays. Cover: (a) query-parameter injection to handler, (b) body-free route dispatch, (c) 204 response handling, (d) error propagation paths.

### Security Hardening
Replace all 6 `(err as Error).message` occurrences in `model-registry.ts` with generic client-facing messages and `process.stderr.write()` for operator detail, following the pattern already established in `dispatchRoute()` (server.ts L1131–L1134).

### API Documentation
Add `@throws {{ code: string, message: string }} On HTTP error responses.` JSDoc to every API client method that lacks it, following the format established for the 8 model methods.

## Rationale
- **Type narrowing over runtime validation:** A one-line type change eliminates an entire category of bugs at compile time — higher value than maintaining a runtime test alone.
- **Sub-builders over monolith:** At ~630 lines, `buildRoutes()` is the largest function in the file. Domain sub-builders make routes locatable, reduce merge conflicts, and align with the file-per-concern pattern already used for handler modules (`api.ts`, `api-models.ts`, `api-knowledge.ts`, `api-repos.ts`).
- **Generic error messages:** Even on a local-only server, surfacing OS error messages violates the OWASP A05 principle and the project's own hardening pattern established in rework-2.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| `Route.method` type | `HttpMethod` union type alias | Enum, const assertion | Union type is the lightest change, requires no import ceremony at each route site, and all 52+ routes already use string literals that satisfy the union |
| Sub-builder composition | Spread into parent `buildRoutes()` | Separate files per domain | Same-file sub-builders keep the entire route table visible in one file; separate files would fragment the load-bearing Section ordering |
| Memoization strategy | None (dropped) | Module-level `let` cache with referential-identity check, `Map` keyed by stringified args | Performance benefit is negligible on a local-only GUI dashboard (52 closure allocations per request is not measurable overhead); more critically, `getRouteDescriptors()` uses sentinel args so its cache population would never be hit by `handleRequest()` with real production args, making the memoization design incorrect as written |
| Zero-arg factory | `getRouteDescriptors()` returning `buildRoutes()` with sentinel args | Exporting a static route descriptor array | Factory preserves the existing `Route[]` shape and requires no test infrastructure changes beyond swapping the call site |
| Error message stripping | Generic message + `stderr` logging | Structured error codes only, logging frameworks | `stderr` + generic message is the established pattern in `dispatchRoute()` and requires no new dependencies |

## Pattern Alignment
- **Domain sub-builders** follow the existing handler-module-per-domain pattern (`api.ts`, `api-models.ts`, `api-knowledge.ts`, `api-repos.ts`) — `mcp-server/gui/`
- **`process.stderr.write()` for operator detail** is the established error-detail pattern — `mcp-server/gui/server.ts` (L1131–L1134)
- **`@throws` JSDoc format** follows Constraint 57 — `mcp-server/docs/agents/project-manifest/constraints.md` (L1048–L1072)
- **Departure: sub-builders in same file** — unlike handler modules which are separate files, route sub-builders stay in `server.ts` to keep Section ordering visible. Justified by the ordering invariant (Constraint 71).

## Detailed Steps

### Step 1 — Narrow `Route.method` to discriminated union
1. Define `export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';` above the `Route` interface in `mcp-server/gui/server.ts`.
2. Change `Route.method` from `string` to `HttpMethod`.
3. Update the `Route` interface JSDoc to reference the `HttpMethod` type instead of listing the valid methods as prose.
4. Verify all 52+ route entries in `buildRoutes()` compile without error (they already use matching string literals).
5. In `route-table.test.ts`, import `HttpMethod` and update the valid-methods test comment to note it now serves as defense-in-depth alongside the compile-time guarantee.

### Step 2 — Decompose `buildRoutes()` into domain sub-builders
1. Within `mcp-server/gui/server.ts`, create the following non-exported helper functions, each returning `Route[]`:
   - `buildConfigRoutes(configPath, bootVersions)` — `PUT /api/config`, `GET /api/server-info`, `GET /api/config`
   - `buildOrchestratorRoutes(orchestratorLogsDir, ledgerRoot)` — `POST /api/orchestrator/start`, `POST /api/orchestrator/kill/:id`, `POST /api/orchestrator/dismiss/:id`, `POST /api/orchestrator/delete/:id`, `GET /api/orchestrator/queue`, `GET /api/orchestrator/run-status/:filename`
   - `buildRepoRoutes(ledgerRoot)` — `POST /api/repos`, `PUT /api/repos/:repoId`, `GET /api/repos`, `GET /api/repos/:repoId`, `DELETE /api/repos/:repoId`
   - `buildKnowledgeRoutes(ledgerRoot)` — `PATCH /api/knowledge/:id`, `POST /api/knowledge/:id/move`, `GET /api/knowledge`, `GET /api/insights`, `DELETE /api/knowledge/:id`, `POST /api/knowledge/:id/promote`
   - `buildModelRoutes()` — `PUT /api/models`, `POST /api/models/load-defaults`, `PUT /api/model-assignments`, `POST /api/model-assignments/replace`, `POST /api/personas/rebuild`, `GET /api/models`, `GET /api/model-assignments`, `GET /api/personas`
   - `buildProjectRoutes(ledgerRoot, configPath, orchestratorLogsDir)` — all namespaced `/:repo/:slug` routes (active + deprecated) plus catch-all Section C routes
2. Refactor `buildRoutes()` to compose sub-builders via spread: `return [...buildConfigRoutes(...), ...buildOrchestratorRoutes(...), ..., ...buildProjectRoutes(...)]`.
3. Preserve Section A/B/C ordering within the composition — config/orchestrator/repo/knowledge/model routes are all Section A or early Section B; project routes span B and C.
4. Add a JSDoc comment on the refactored `buildRoutes()` noting the sub-builder composition and referencing the Section ordering invariant.

### Step 3 — Add zero-argument route factory for structural tests
1. Export `getRouteDescriptors(): Route[]` from `mcp-server/gui/server.ts`. It calls `buildRoutes()` with sentinel dummy arguments (`'/dev/null'`, `'/dev/null'`, `'/dev/null'`, `null`) and returns the result.
2. In `route-table.test.ts`, replace the manual dummy-argument call with `getRouteDescriptors()`. Remove the `DUMMY_*` constants.

### Step 4 — Add `dispatchRoute()` query-parameter unit tests
1. Create `mcp-server/tests/gui/dispatch-route.test.ts`.
2. Use a minimal real server following the `startTestServer` + `handleRequest` pattern established in `mcp-server/tests/gui/server-info.test.ts` (real `createServer()`, `mkdtemp()` for a temporary ledger root, teardown via `server.close()`). Since `dispatchRoute()` is exported, it can be called from a thin real-server wrapper without synthetic `IncomingMessage`/`ServerResponse` mocks — do not introduce such mocks; they have no prior art in this test suite.
3. Add test cases using `fetch` against the real server:
   - **Query-param injection:** Register a `GET /test` route with a handler spy that captures its `query` parameter. Fetch `/test?key=value&foo=bar`. Assert the handler received a `URLSearchParams` with the expected entries.
   - **No query string:** Fetch `/test` (no `?`). Assert the handler still receives a `URLSearchParams` (empty).
   - **Body-free dispatch:** Register a `noBody: true` route. Assert the handler receives `undefined` as the body argument.
   - **204 response:** Register a route with `statusCode: 204`. Assert the response has status 204 and an empty body.
   - **ApiError propagation:** Register a handler that throws `ApiError`. Assert the response contains the mapped status code and error JSON.
   - **Unhandled error:** Register a handler that throws a generic `Error`. Assert the response is 500 with `INTERNAL_ERROR` code and that `process.stderr.write` was called.

### Step 5 — Harden Model Registry error messages (OWASP A05)
1. In `mcp-server/src/gui/model-registry.ts`, for each of the 6 instances of `(err as Error).message` in `ApiError` constructors:
   - Log the original error detail to `process.stderr` with the existing `[server]` prefix format.
   - Replace the `ApiError` message with a generic string (e.g., `'Failed to read local.json due to a system error.'`).
2. Affected functions and their error paths:
   - `readModels()`: READ_ERROR (L119), PARSE_ERROR (L129)
   - `readAssignments()`: READ_ERROR (L268), PARSE_ERROR (L278)
   - `loadDefaults()`: READ_ERROR (L345)
   - `_initializeLocalFromDefault()`: READ_ERROR (L520)
3. Add or update tests in `mcp-server/tests/gui/model-registry.test.ts` to verify:
   - The generic error message is returned to the client (no OS-level detail).
   - The original error detail is written to `stderr`.

### Step 6 — Complete `@throws` JSDoc for API client methods
1. In `mcp-server/gui/public/api-client.js`, add `@throws {{ code: string, message: string }} On HTTP error responses.` to every method that currently lacks it.
2. Methods to annotate (all methods returned by the IIFE that do not already have `@throws`): `getProjects`, `getProject`, `getWorkPackages`, `getWorkPackage`, `deleteProject`, `archiveProject`, `unarchiveProject`, `getConfig`, `updateConfig`, `getInsights`, `getServerInfo`, `getPlanDocument`, `getSynthesisDocument`, `analyzeProjectReset`, `applyProjectReset`, `getProjectHealth`, `getWorkPackageOverview`, `renameProject`, `renameSlug`, `markProjectComplete`, `getRunLogs`, `getRunLogEntries`, `getRunMetadata`, `getDialogues`, `getDialogueContent`, `getChunks`, `getChunkRendered`, `getChunkStructured`, `listRepos`, `getRepo`, `createRepo`, `updateRepo`, `deleteRepo` (the repo method), `orchestratorStart`, `orchestratorGetQueue`, `orchestratorGetRunStatus`, `orchestratorKill`, `orchestratorDismiss`, `orchestratorDelete`, `getKnowledge`, `updateKnowledge`, `deleteKnowledge`, `promoteKnowledge`, `moveKnowledge`.

### Step 7 — Clean up manifest phrasing artifact
1. In `mcp-server/gui/docs/agents/project-manifest/constraints.md` (L155), change:
   `"Route handlers conform to the \`Route\` interface defined in \`server.ts\` (no \`RouteHandler\` type alias exists)."`
   to:
   `"Route handlers conform to the \`Route\` interface defined in \`server.ts\`."`
   Remove the parenthetical referencing the deleted `RouteHandler` type alias.

### Step 8 — Update project manifests and documentation
1. Update `mcp-server/docs/agents/project-manifest/api-surface.md`:
   - Add `HttpMethod` type alias to the exported types section.
   - Add `getRouteDescriptors()` to the exported functions section.
   - Document the sub-builder functions (non-exported, but mention their existence in the `buildRoutes()` entry for architectural clarity).
2. Update `mcp-server/docs/agents/project-manifest/constraints.md`:
   - In Constraint 71, note that `buildRoutes()` now delegates to domain sub-builders.
   - Add a new constraint documenting the `HttpMethod` type and its relationship to the route-table structural test.
3. Update `mcp-server/gui/docs/agents/project-manifest/api-surface.md` and `constraints.md` as needed to reflect the sub-builder architecture and `HttpMethod` type.
4. Regenerate `.context/` snapshots by running `node scripts/cli.js ctx-generate` from the workspace root (per KN-0010).

## Dependencies
- Steps 1 → 2 → 3: Sequential — type narrowing must happen before sub-builders, factory after sub-builders.
- Step 4: Independent — can run in parallel with Steps 1–3 (tests exercise existing `dispatchRoute()` API).
- Step 5: Independent — touches `model-registry.ts`, no overlap with `server.ts` changes.
- Step 6: Independent — touches `api-client.js`, no overlap with other steps.
- Step 7: Independent — trivial manifest edit.
- Step 8: Must run last — depends on all other steps being complete.

## Required Components
- `mcp-server/gui/server.ts` — Route interface, `buildRoutes()`, `dispatchRoute()`, sub-builders, factory
- `mcp-server/src/gui/model-registry.ts` — Error message hardening
- `mcp-server/gui/public/api-client.js` — `@throws` JSDoc completion
- `mcp-server/tests/gui/route-table.test.ts` — Updated to use `getRouteDescriptors()`
- `mcp-server/tests/gui/dispatch-route.test.ts` — New test file for dispatcher unit tests
- `mcp-server/tests/gui/model-registry.test.ts` — Updated tests for error message hardening
- `mcp-server/docs/agents/project-manifest/api-surface.md` — New exports documentation
- `mcp-server/docs/agents/project-manifest/constraints.md` — Updated Constraint 71, new `HttpMethod` constraint
- `mcp-server/gui/docs/agents/project-manifest/constraints.md` — Phrasing fix + sub-builder documentation
- `mcp-server/gui/docs/agents/project-manifest/api-surface.md` — Updated for sub-builder architecture

## Assumptions
- All API client methods use the shared `request()` helper and therefore share the same `{ code, message }` rejection contract.
- The `process.stderr.write()` pattern for operator-level error detail is acceptable for the local-only GUI server context.

## Constraints
- Section A/B/C ordering in `buildRoutes()` must be preserved across sub-builder composition (Constraint 71).
- `getRouteDescriptors()` uses sentinel arguments that must never be used for actual I/O — its purpose is structural inspection only.
- The `HttpMethod` type must be exported so tests can import it.

## Out of Scope
- O-6: Splitting `api-surface.md` into domain-focused documents — medium effort, tangential to this rework's focus on runtime and type-level hardening.
- D-1: Machine-readable route registry / OpenAPI spec generation — significant effort that builds on the sub-builder foundation laid here but is a distinct project.
- Removing deprecated non-namespaced routes — retained for backward compatibility per Constraint 10.

## Acceptance Criteria

- AC-01: `Route.method` is typed as `HttpMethod` (`'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'`); all route entries compile without error.
- AC-02: `buildRoutes()` delegates to domain sub-builders (`buildConfigRoutes`, `buildOrchestratorRoutes`, `buildRepoRoutes`, `buildKnowledgeRoutes`, `buildModelRoutes`, `buildProjectRoutes`) via spread composition.
- AC-03: `getRouteDescriptors()` returns the route table without requiring explicit dummy arguments.
- AC-04: `dispatchRoute()` passes a correctly-populated `URLSearchParams` to matched handlers when the URL contains a query string.
- AC-05: `dispatchRoute()` passes an empty `URLSearchParams` when the URL has no query string.
- AC-06: All 6 `(err as Error).message` occurrences in `model-registry.ts` are replaced with generic client-facing messages; original detail is logged to `stderr`.
- AC-07: No OS-level error detail appears in any `ApiError` response from `readModels()`, `readAssignments()`, `loadDefaults()`, or `_initializeLocalFromDefault()`.
- AC-08: All API client methods in `api-client.js` carry `@throws {{ code: string, message: string }}` JSDoc.
- AC-09: The `RouteHandler` provenance parenthetical is removed from `gui/docs/agents/project-manifest/constraints.md`.
- AC-10: `api-surface.md` documents `HttpMethod` and `getRouteDescriptors()`.
- AC-11: Constraint 71 in `constraints.md` is updated to describe sub-builder composition.
- AC-12: All existing tests pass after all changes (3,599+ tests).
- AC-13: `.context/` snapshots are regenerated and up to date.

## Testing Strategy
Changes span three test categories: (1) type-level correctness verified by TypeScript compilation, (2) structural route-table invariants verified by existing `route-table.test.ts` (updated to use `getRouteDescriptors()`), and (3) new behavioral tests for `dispatchRoute()` query-param injection and Model Registry error hardening.

## Test Plan

- `mcp-server/tests/gui/route-table.test.ts` (modified) — Update to use `getRouteDescriptors()` instead of manual dummy args; retain the valid-methods runtime test as defense-in-depth — covers AC-01, AC-03
- `mcp-server/tests/gui/dispatch-route.test.ts` (new) — Test `dispatchRoute()` with synthetic routes: query-param injection (`?key=value`), empty query string, `noBody: true` dispatch, 204 response, `ApiError` propagation, unhandled error → 500 — covers AC-04, AC-05
- `mcp-server/tests/gui/model-registry.test.ts` (modified) — Test that `readModels()`, `readAssignments()`, `loadDefaults()` return generic error messages on non-ENOENT OS errors; verify `stderr` receives the original detail — covers AC-06, AC-07
- TypeScript compilation (`npm run build`) — Verifies all route entries satisfy the `HttpMethod` union; any invalid method literal becomes a compile error — covers AC-01
- Full test suite (`npm test`) — Regression check across all 3,599+ tests — covers AC-12

## Documentation Updates

- `mcp-server/docs/agents/project-manifest/api-surface.md` — Add `HttpMethod` type and `getRouteDescriptors()` exports; note sub-builder composition in `buildRoutes()` entry — AC-10
- `mcp-server/docs/agents/project-manifest/constraints.md` — Update Constraint 71 (sub-builder composition); add new constraint for `HttpMethod` type — AC-11
- `mcp-server/gui/docs/agents/project-manifest/api-surface.md` — Mirror `HttpMethod` and sub-builder documentation — AC-10
- `mcp-server/gui/docs/agents/project-manifest/constraints.md` — Remove `RouteHandler` provenance parenthetical (L155); update §9 to reflect sub-builder architecture — AC-09
- `.context/mcp-server/` snapshots — Regenerate via `node scripts/cli.js ctx-generate` — AC-13

## Deferred Items

| # | Deferred Item | Origin | Reason Deferred | Notes |
|---|---------------|--------|-----------------|-------|
| 1 | Machine-readable route registry / OpenAPI spec generation | D-1 from rework-2 synthesis | Significant standalone project; sub-builder decomposition in this plan lays the necessary foundation | The declarative route table + domain sub-builders make this achievable in a future cycle |
| 2 | Split `api-surface.md` into domain-focused documents | O-6 from rework-2 synthesis | Medium effort, tangential to runtime/type-level hardening focus | At 5,942 lines the file is large but functional; splitting is a documentation-architecture decision best done as a dedicated documentation cycle |
| 3 | Route table memoization | Rework-3 design review (Reconsider finding) | `getRouteDescriptors()` uses sentinel args so the cache populated by test calls would never be hit by `handleRequest()` with real production args; performance benefit is also negligible on a local-only server | Revisit if profiling shows route-table construction as a hot path; a correct approach would require stable shared argument references or lazy initialization |

## Risks & Mitigations
| Risk | Mitigation |
|------|------------|
| **Sub-builder composition breaks Section ordering** | Each sub-builder's routes are spread in a fixed order in `buildRoutes()`; the route-table structural test (no-duplicate invariant) catches any accidental shadowing; Constraint 71's JSDoc is updated to document the composition |
| **`getRouteDescriptors()` sentinel args accidentally used for I/O** | Sentinel values (`'/dev/null'`) are not valid ledger paths; handlers would fail at I/O time, not silently succeed; JSDoc on the factory documents its structural-only purpose |
| **`stderr` logging in model-registry becomes noisy** | These error paths are rarely hit (only on OS-level file permission or disk errors); logging detail is essential for operator troubleshooting |

## Recommended Workflow
- **Workflow:** ledger
- **Rationale:** Six interconnected steps across multiple files with distinct concerns (type safety, architecture, testing, security, documentation) benefit from formal QA, security audit, and review stages.
