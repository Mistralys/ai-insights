
# Plan

## Plan Audit Cycles
- Audits: 5 — Plan Auditor v1.7.0
- Architectural Reviews: 2 — Plan Architect Reviewer v2.2.0

## Prior Project Context
The model-settings project (2026-07-21) delivered a fully GUI-managed model registry and per-persona assignment system across 10 WPs with 41 pipeline stage passes. Its synthesis identified two medium-priority technical debt items (server.ts route boilerplate and config.js monolithic tabs), one medium-priority security finding (info-disclosure), and several low-priority UX/test/code-hygiene items. This rework plan addresses all actionable items from that synthesis, promoting the most valuable deferred and out-of-scope items into concrete steps while preserving remaining items for future cycles. The strategic vision prioritizes reducing developer friction (short-term) and preparing for public release (mid-term) — both align directly with this maintainability and hardening work.

## Summary
Refactor the GUI server and frontend code introduced by the model-settings project to improve maintainability, fix a security info-disclosure pattern, add client-side validation UX, future-proof the orchestrator's persona file discovery, and establish test coverage for previously untested GUI components. No new features — purely technical debt, security hardening, and test coverage.

## Architectural Context
The MCP server GUI is a vanilla-JS SPA served by a Node.js HTTP server (`server.ts`). Routes are dispatched in two layers: `matchRoute()` for body-free GET/DELETE routes, and `handleRequest()` for body-parsing PUT/POST/PATCH routes (each as an inline if-block with identical try/catch boilerplate). API handlers are organized into domain modules (`api.ts`, `api-knowledge.ts`, `api-repos.ts`, `api-models.ts`). Frontend views are vanilla JS files loaded via `<script>` tags into a shared global scope — the `project-detail` view is already split into 5 files, establishing the decomposition pattern. The orchestrator reads persona YAML metadata via glob patterns in `persona_models.py`.

## Approach / Architecture

**A. Server Route Dispatch Refactor** — Introduce a typed `BodyRoute` descriptor and a `dispatchBodyRoute()` function that replaces all ~18 inline try/catch blocks in `handleRequest()` with a declarative route table. Each entry specifies method, path (string or RegExp — with mandatory named capture groups `(?<name>…)` for parameterised paths), handler function, and optional modifiers (`statusCode`, `noBody`). Non-standard response cases are expressed via `statusCode: 204` (dispatcher writes an empty response and skips `sendJson()`) and `ApiError` throws for conditional failures (e.g. rebuild), keeping all response writing consolidated in the dispatcher. The dispatcher handles `readJsonBody()`, `sendJson()` / `sendError()`, and the common `PayloadTooLargeError` / `ApiError` / generic error catch chain. Routes that need closure variables (e.g. `ledgerRoot`, `configPath`) use arrow functions that capture the scope.

**B. Config View Modularization** — Extract the Model Registry tab (`mr*` functions and state) and Persona Models tab (`pm*` functions and state) into separate files (`config-model-registry.js`, `config-persona-models.js`), following the `project-detail-*.js` splitting convention. The coordinator file (`config.js`) retains: tab dispatch, `configDirty` state, the General tab (small), shared `beforeTabSwitch()` guard, and the `renderConfigPage()` entry point. Dead parameters are cleaned up across the entire `pm*` forwarding chain (D5) — `pmWireEvents`, `pmRefreshTab`, `pmDoRebuild`, and `pmDoSave` all have their vestigial `(config, models, personas, assignments)` signatures stripped and all call sites updated.

**C. Security & UX Hardening** — Replace the persona-ID-enumerating error message in `handleUpdateAssignments()` with a generic count-based message. Add client-side pre-submit validation in the Model Registry tab (duplicate-slug check before Save) and Persona Models tab (empty-name guard on inline-edit Done).

**D. Orchestrator Future-Proofing** — Widen the glob pattern in `find_ledger_yaml_for_stage()` from `[1-9]-*.yaml` to `[0-9]*-*.yaml` to support two-digit persona role numbers.

**E. Test Coverage** — Add unit tests for the 8 API client methods (`api-client.js`). Establish a minimal frontend helper test setup and cover the pure-function helpers (`mrDeriveSlug`, `mrValidateSlug`, `mrHasChanges`, `pmCloneAssignments`).

## Rationale
The synthesis explicitly recommended bundling the server.ts and config.js refactors into a single "SPA maintainability" work package. Both files crossed the complexity threshold during the model-settings project (server.ts at 1994 lines with 18 identical blocks; config.js at 1395 lines with 3 tabs). The security fix is a one-line change flagged at medium priority. The glob fix prevents a silent failure that would bite when the persona count grows. Test coverage for the GUI API client and frontend helpers closes a regression gap that will compound with every new GUI feature.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Route dispatch mechanism | Declarative `BodyRoute[]` array + `dispatchBodyRoute()` loop | (a) Express/Koa framework, (b) class-based Router, (c) keep inline blocks | Framework adds a dependency; class-based Router is over-engineered for a flat route list; inline blocks don't scale. A typed array is minimal and zero-dependency. |
| Config view splitting granularity | One file per tab (3 files total: coordinator + 2 extracted) | (a) Keep monolithic, (b) one file per function group | Per-tab mirrors the logical separation already enforced by prefix conventions; per-function is too granular for a vanilla-JS SPA without a module system. |
| Frontend test infrastructure | Vitest with inline `eval`/`Function` loading of vanilla JS files | (a) Full jsdom + HAPPY-DOM browser env, (b) extract helpers to ESM modules | Full browser env is overkill for pure functions; ESM extraction would require a bundler for the SPA. Loading the file as a string and evaluating the target functions is pragmatic and zero-overhead. |
| Glob pattern fix | `[0-9]*-*.yaml` (any digits before dash) | (a) `*.yaml` (match all), (b) regex filter | `[0-9]*-*.yaml` preserves the existing convention of numeric-prefix naming while removing the single-digit ceiling. Matching all YAML files would pick up `_shared.yaml` and other non-persona files. |

## Pattern Alignment
- **View file splitting:** Follows the established `project-detail-*.js` convention of splitting large views into domain-scoped files — `mcp-server/gui/public/views/project-detail*.js`
- **API handler modules:** Follows the existing domain-module pattern (`api.ts`, `api-knowledge.ts`, `api-repos.ts`, `api-models.ts`) — no new handler modules needed
- **Prefix namespace convention:** The `mr*`/`pm*` prefix convention for global-scope vanilla JS is preserved exactly during extraction — `mcp-server/gui/public/views/config.js`
- **Test file co-location:** Tests placed in `mcp-server/tests/gui/` following existing convention — `mcp-server/tests/gui/api-models.test.ts`

## Detailed Steps

### Step 1: Define `BodyRoute` type and route table

Create a typed `BodyRoute` interface in `mcp-server/gui/server.ts` (or a dedicated `mcp-server/gui/route-types.ts` if preferred for testing). Each entry describes:
- `method`: HTTP method string (`'PUT'` | `'POST'` | `'PATCH'`)
- `path`: exact string or `RegExp` for matching
- `handler`: `(body: unknown, pathParams: Record<string, string>) => Promise<unknown>`
- `statusCode`: optional (default 200); when `204`, the dispatcher writes an empty response and skips `sendJson()`
- `noBody`: optional boolean (for routes like `/api/models/load-defaults` that don't parse a body)

All `path: RegExp` entries **must** use named capture groups (`(?<name>…)`) — positional groups are not permitted. The dispatcher extracts params via `route.path.exec(reqPath)?.groups ?? {}`, producing a named-key `Record<string, string>` (e.g. `{ repo: 'my-repo', slug: 'my-project' }`) passed as `pathParams` to the handler.

Conditional failure cases (e.g. the persona rebuild route) are expressed as `ApiError` throws inside the handler — `throw new ApiError('BUILD_FAILED', result.output)` — relying on the dispatcher's existing `ApiError` catch branch and `apiErrorToStatus('BUILD_FAILED')` returning 500. No escape-hatch field is needed.

Define the route table as a `BodyRoute[]` array, migrating all ~18 inline blocks from `handleRequest()` into entries. Routes requiring closure variables (`ledgerRoot`, `configPath`, `orchestratorLogsDir`, `bootVersions`) receive them via a factory function or direct closure capture when the table is constructed inside `handleRequest()`.

### Step 2: Implement `dispatchBodyRoute()` function

Implement a function that iterates the route table, matches the incoming request, optionally parses the body with `readJsonBody()`, calls the handler, and sends the response with the standard try/catch chain (`PayloadTooLargeError` → `ApiError` → generic error). This eliminates ~270 lines of duplicated boilerplate from `handleRequest()`.

Handle the non-standard cases:
- `noBody: true` — skip `readJsonBody()` call
- `statusCode === 204` — after calling the handler, write `res.writeHead(204, headers); res.end()` and return without calling `sendJson()`; for all other `statusCode` values, pass the code to `sendJson()`
- Path parameter extraction: for RegExp paths, extract via `const pathParams = route.path instanceof RegExp ? (route.path.exec(reqPath)?.groups ?? {}) : {}`; because all RegExp paths use named capture groups (mandated in Step 1), `pathParams` is always a named-key `Record<string, string>`
- Conditional failure cases (e.g. rebuild) — the handler throws `new ApiError('BUILD_FAILED', result.output)` on failure; the dispatcher's `ApiError` catch branch handles it via `apiErrorToStatus('BUILD_FAILED')` returning 500, with no special-casing needed in the dispatcher

### Step 3: Refactor `handleRequest()` to use the dispatcher

Replace all inline body-parsing if-blocks in `handleRequest()` with a single call to `dispatchBodyRoute()`. Preserve:
- OPTIONS preflight handling (before route dispatch)
- Static file serving (before route dispatch)
- `matchRoute()` fallback (after body-route dispatch returns no match)

The resulting `handleRequest()` should be ~70–80 lines: preflight → static → body dispatch → match route → 404.

### Step 4: Extract Model Registry tab to `config-model-registry.js`

Create `mcp-server/gui/public/views/config-model-registry.js` containing:
- All `mr*` module-level state variables (`mrModels`, `mrOriginalModels`, `mrEditingRow`, etc.)
- All `mr*` functions (`mrBuildTabHtml`, `mrWireEvents`, `mrDoSave`, `mrDoLoadDefaults`, `mrDeriveSlug`, `mrValidateSlug`, `mrHasChanges`, `mrShowAddSlugError`, etc.)
- Add client-side duplicate-slug pre-check in `mrDoSave()`: before calling `saveModels()`, scan `mrModels` for duplicate slugs and show an inline error if found (OOS-6)
- Add client-side empty-name guard in the inline-edit Done handler: reject empty name with an inline error message instead of allowing a server round-trip (OOS-7)

Update the SPA shell HTML to include the new `<script>` tag before `config.js`.

### Step 5: Extract Persona Models tab to `config-persona-models.js`

Create `mcp-server/gui/public/views/config-persona-models.js` containing:
- All `pm*` module-level state variables (`pmModels`, `pmAssignments`, `pmOriginalAssignments`, `pmDefaultModel`, etc.)
- All `pm*` functions (`pmBuildTabHtml`, `pmWireEvents`, `pmDoSave`, `pmDoRebuild`, `pmCloneAssignments`, etc.)
- During extraction, remove the vestigial `(config, models, personas, assignments)` pass-through parameters from the entire `pm*` forwarding chain (D5). All four functions must be stripped:
  - `pmWireEvents(config, models, personas, assignments)` → `pmWireEvents()`
  - `pmRefreshTab(config, models, personas, assignments)` → `pmRefreshTab()`
  - `pmDoRebuild(config, models, personas, assignments)` → `pmDoRebuild()`
  - `pmDoSave(config, models, personas, assignments)` → `pmDoSave()`

  Update all call sites: `renderConfigTabContent()` (calls `pmWireEvents`), event-handler lambdas inside `pmWireEvents` (call `pmRefreshTab`, `pmDoRebuild`, `pmDoSave`), and the async re-fetch path inside `pmDoRebuild` (calls `pmRefreshTab`). The net result is that every `pm*` function reads exclusively from module-level state.

Update the SPA shell HTML to include the new `<script>` tag before `config.js`.

### Step 6: Slim down `config.js` to coordinator role

After extraction, `config.js` should retain only:
- `configActiveTab` state and tab constants
- `configDirty` tracking object
- `renderConfigPage()` entry point (fetches data, dispatches to tab render functions)
- `renderConfigTabContent()` dispatcher
- `beforeTabSwitch()` unsaved-changes guard
- General tab implementation (~50 lines: `renderGeneralTab`, `wireGeneralTabEvents`)
- Tab bar rendering

Verify that all cross-tab interactions (e.g. `configDirty` updates from `mr*`/`pm*` functions) work correctly via the shared global scope.

### Step 7: Fix info-disclosure in `handleUpdateAssignments()`

In `mcp-server/gui/api-models.ts`, replace the error message in `handleUpdateAssignments()`:

**Before:**
```ts
`Persona key "${personaKey}" does not exist in name-mapping.json. Valid IDs are: ${[...validPersonaIds].join(', ')}.`
```

**After:**
```ts
`Persona key "${personaKey}" does not exist in name-mapping.json. ${validPersonaIds.size} valid persona IDs are available.`
```

### Step 8: Fix orchestrator glob pattern

In `orchestrator/src/utils/persona_models.py`, change the glob pattern in `find_ledger_yaml_for_stage()`:

**Before:**
```python
for yaml_file in sorted(meta_dir.glob("[1-9]-*.yaml")):
```

**After:**
```python
for yaml_file in sorted(meta_dir.glob("[0-9]*-*.yaml")):
```

Update or remove the docstring warning about the single-digit limitation. Add a test case that verifies a two-digit prefix (e.g. `10-test.yaml`) is matched.

### Step 9: Add API client method tests

Add to the existing `mcp-server/tests/gui/api-client.test.ts` — the file already contains 200+ lines of tests with mock `fetch()` boilerplate (`vi.fn()`) that can be reused. Add unit tests for the 8 model-related API client methods:
- `getModels()` — verifies GET /api/models call and JSON parsing
- `saveModels(models)` — verifies PUT with body serialization
- `loadDefaultModels()` — verifies POST to /api/models/load-defaults
- `getPersonas()` — verifies GET /api/personas
- `getAssignments()` — verifies GET /api/model-assignments
- `updateAssignments(data)` — verifies PUT with body
- `replaceAssignedModel(oldModelId, newModelId)` — verifies POST with body
- `rebuildPersonas()` — verifies POST to /api/personas/rebuild

Test both success paths and error paths (non-ok response), following the existing test patterns in the file.

### Step 10: Add frontend helper tests

Create `mcp-server/tests/gui/config-helpers.test.ts` with unit tests for the pure-function helpers extracted in Steps 4–5:
- `mrDeriveSlug(name)` — test slug derivation from various model names (spaces, special chars, unicode)
- `mrValidateSlug(slug)` — test valid/invalid slug format validation
- `mrHasChanges()` — test change detection between current and original model arrays
- `pmCloneAssignments()` — test deep-clone correctness

Since these are vanilla JS functions in the global scope (no module exports), load the source file content and evaluate the target functions in the test environment.

### Step 11: Update documentation

- `mcp-server/docs/agents/project-manifest/file-tree.md` — add entries for new files: `config-model-registry.js`, `config-persona-models.js`, `api-client.test.ts`, `config-helpers.test.ts`
- `mcp-server/docs/agents/project-manifest/api-surface.md` — document the `BodyRoute` interface and `dispatchBodyRoute()` function
- Regenerate `.context/` via `node scripts/cli.js ctx-generate`

## Dependencies
- Step 3 depends on Steps 1–2 (route table and dispatcher must exist before refactoring handleRequest)
- Steps 4–5 are independent of each other but both must complete before Step 6
- Step 6 depends on Steps 4–5 (coordinator slimming needs tabs extracted first)
- Step 7 is independent of all other steps
- Step 8 is independent of all other steps
- Step 9 is independent of all other steps
- Step 10 depends on Steps 4–5 (helper functions must be in their final files)
- Step 11 depends on all other steps (documentation captures final state)

## Required Components
- `mcp-server/gui/server.ts` — refactored route dispatch
- `mcp-server/gui/public/views/config.js` — slimmed coordinator
- `mcp-server/gui/public/views/config-model-registry.js` — new file (extracted)
- `mcp-server/gui/public/views/config-persona-models.js` — new file (extracted)
- `mcp-server/gui/api-models.ts` — info-disclosure fix
- `mcp-server/gui/public/api-client.js` — unchanged (test target)
- `mcp-server/tests/gui/api-client.test.ts` — updated test file (existing, 200+ lines)
- `mcp-server/tests/gui/config-helpers.test.ts` — new test file
- `mcp-server/tests/gui/server.test.ts` — new test file
- `mcp-server/tests/gui/api-models.test.ts` — existing (no assertion changes needed)
- `orchestrator/src/utils/persona_models.py` — glob fix
- `orchestrator/tests/test_persona_models.py` — updated test file (existing, with `TestFindLedgerYamlForStage` class)
- SPA shell HTML (likely `mcp-server/gui/public/index.html`) — new `<script>` tags

## Assumptions
- The SPA shell loads view JS files via `<script>` tags and all functions are in the global scope (no module system)
- The `project-detail-*.js` splitting pattern is the established convention for view decomposition
- The `mr*`/`pm*` prefix conventions are sufficient namespace isolation in the global scope
- The info-disclosure fix does not affect any client-side error handling (the client only checks `response.ok`)
- The orchestrator test suite can create temporary YAML fixture files with two-digit prefixes

## Constraints
- No new npm dependencies — the route dispatcher must use only existing utilities
- Frontend test approach must work without a bundler or module system for the vanilla JS files
- All existing tests (~3,523 GUI + 1,132 orchestrator) must continue to pass
- Deprecated non-namespaced routes in `server.ts` must be preserved in the route table
- All `path: RegExp` entries in the `BodyRoute` route table must use named capture groups (`(?<name>…)`); positional group indexing is not permitted

## Out of Scope
- Adding a frontend module system or bundler (webpack, vite, etc.)
- Replacing the vanilla JS SPA with a framework (React, Vue, etc.)
- Refactoring `matchRoute()` (the body-free route dispatcher) — it works fine as-is
- Adding a custom modal system to replace `window.confirm()` (OOS-3 from synthesis)
- Caching `workflow-manifest.json` reads in the orchestrator (OOS-8 — pre-existing pattern, low volume)

## Acceptance Criteria

- AC-01: `handleRequest()` in `server.ts` is reduced to ≤80 lines (from ~500+ lines of inline body-route blocks), with all routes delegated to a declarative route table + dispatcher function
- AC-02: All ~18 body-parsing routes produce identical HTTP responses (status codes, error shapes, headers) as before refactoring
- AC-03: `config.js` is reduced to ≤200 lines, serving only as a tab coordinator
- AC-04: `config-model-registry.js` contains all `mr*` state and functions and renders the Model Registry tab identically to the pre-extraction version
- AC-05: `config-persona-models.js` contains all `pm*` state and functions and renders the Persona Models tab identically to the pre-extraction version
- AC-06: The vestigial pass-through parameters are removed from all four functions in the `pm*` forwarding chain — `pmWireEvents`, `pmRefreshTab`, `pmDoRebuild`, and `pmDoSave` — and all call sites (`renderConfigTabContent`, event-handler lambdas inside `pmWireEvents`, and the async re-fetch path inside `pmDoRebuild`) are updated accordingly (D5)
- AC-07: `handleUpdateAssignments()` error message no longer enumerates persona IDs; it provides only a count or generic message
- AC-08: Client-side duplicate-slug validation fires before Save in the Model Registry tab, showing an inline error without a server round-trip
- AC-09: Client-side empty-name guard fires on inline-edit Done in the Model Registry tab, showing an inline error without a server round-trip
- AC-10: `find_ledger_yaml_for_stage()` glob pattern matches two-digit persona role prefixes (e.g. `10-name.yaml`)
- AC-11: Unit tests exist for all 8 model-related API client methods, covering success and error paths
- AC-12: Unit tests exist for `mrDeriveSlug`, `mrValidateSlug`, `mrHasChanges`, and `pmCloneAssignments`
- AC-13: Full GUI regression suite (3,523+ tests) passes after all changes
- AC-14: Full orchestrator regression suite (1,132+ tests) passes after all changes
- AC-15: `file-tree.md` and `api-surface.md` are updated to reflect new/changed files and interfaces

## Testing Strategy
Regression-first: run the full GUI test suite (3,523+ tests) and orchestrator test suite (1,132+ tests) at each step boundary to catch breakage early. New tests cover the dispatcher (route matching and error handling), the extracted view modules (render output, event wiring), the API client methods, and the frontend helpers. The glob fix gets a dedicated test with a two-digit-prefix fixture file.

## Test Plan
- `mcp-server/tests/gui/server.test.ts` (existing or new) — test `dispatchBodyRoute()` with mock routes: verify correct handler invocation, body parsing, status codes, error classification — covers AC-01, AC-02
- `mcp-server/tests/gui/api-models.test.ts` (existing) — existing tests pass without changes; the assertion only checks `{ code: 'VALIDATION_ERROR' }`, not the message text — covers AC-07
- `mcp-server/tests/gui/api-client.test.ts` (existing, extended) — add 16+ tests: 8 success paths + 8 error paths for model API client methods, reusing existing mock fetch boilerplate — covers AC-11
- `mcp-server/tests/gui/config-helpers.test.ts` (new) — 10+ tests: slug derivation, slug format validation (valid/invalid formats), change detection, deep clone — covers AC-12
- `orchestrator/tests/test_persona_models.py` (existing) — add test case to `TestFindLedgerYamlForStage` class with `10-name.yaml` fixture to verify two-digit glob match — covers AC-10
- Full GUI regression suite — run after Steps 3, 6, 7 — covers AC-13
- Full orchestrator regression suite — run after Step 8 — covers AC-14
- Code inspection: verify `pmWireEvents`, `pmRefreshTab`, `pmDoRebuild`, and `pmDoSave` have zero-argument signatures and their call sites pass no arguments — covers AC-06
- Manual smoke test: open Configuration screen, switch tabs, edit models, save, rebuild — covers AC-03–AC-05, AC-08–AC-09

## Documentation Updates
- `mcp-server/docs/agents/project-manifest/file-tree.md` — add entries for `config-model-registry.js`, `config-persona-models.js`, `api-client.test.ts`, `config-helpers.test.ts`, `server.test.ts`; update `config.js` description
- `mcp-server/docs/agents/project-manifest/api-surface.md` — add `BodyRoute` interface and `dispatchBodyRoute()` function signature
- `.context/` — regenerate via `node scripts/cli.js ctx-generate`

## Deferred Items

| # | Deferred Item | Origin | Reason Deferred | Notes |
|---|---------------|--------|-----------------|-------|
| 1 | `writeModels()` calls `readModels()` internally — extra filesystem read on every write | Synthesis D2 | Negligible performance impact at current usage patterns | Reconsider if model registry write frequency increases significantly |
| 2 | `resolveModel()` rebuilds `slugToEntry` Map on every invocation | Synthesis D3 | Negligible at ~40 calls per build; no profiling evidence of bottleneck | Return pre-built Map from `loadModelRegistry()` if tight-loop usage emerges |
| 3 | Module-level registry load in `personas/plugins/ledger/index.js` blocks watch-mode | Synthesis D4 | No watch-mode build exists today | Move registry load into `onBuildStart` if/when watch-mode is added |
| 4 | Replace `window.confirm()` dirty-guard with custom modal | Synthesis OOS-3 | No modal system exists in the SPA; introducing one is a separate design effort | Relevant only if a modal abstraction is added in a future project |
| 5 | `find_ledger_yaml_for_stage()` re-reads `workflow-manifest.json` per stage | Synthesis OOS-8 | Pre-existing pattern, not introduced by model-settings; negligible at current persona count | Candidate for orchestrator I/O optimization when persona count exceeds ~50 |

## Risks & Mitigations
| Risk | Mitigation |
|------|------------|
| **Route dispatch refactor breaks a non-obvious response shape** | Enumerate all response variations (200/201/204/conditional) during route table construction; add integration tests for each non-standard case |
| **Global-scope view extraction breaks cross-tab interactions** | Verify `configDirty` updates and `beforeTabSwitch()` guard work across file boundaries; the prefix convention (`mr*`/`pm*`) prevents naming collisions |
| **Frontend helper tests fragile due to eval-based loading** | Keep tests focused on pure functions only (no DOM, no API calls); if eval proves brittle, fall back to extracting helpers into a shared utility file |
| **Info-disclosure test assertion too tightly coupled to message text** | Use a regex or `toContain` matcher that validates structure (mentions count, does NOT contain comma-separated IDs) rather than exact string match |

## Recommended Workflow
- **Workflow:** ledger
- **Rationale:** Multi-file refactoring across server routing, frontend views, API handlers, and orchestrator with 15 acceptance criteria benefits from formal QA and review stages to catch regression.
