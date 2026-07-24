# Plan

## Plan Audit Cycles
- Audits: 3 — Plan Auditor v1.7.0
- Architectural Reviews: 1 — Plan Architect Reviewer v2.2.0

## Prior Project Context

The immediate predecessor (`2026-07-22-model-settings-rework-1`) completed 9/9 WPs with zero failures, delivering a `BodyRoute` declarative dispatcher, `config.js` decomposition, persona-key info-disclosure hardening, and 60 new tests. It deferred 9 items — two Medium-priority UUID-reflection security findings and seven Low-priority hygiene items. This plan addresses all deferred items plus the Gold Nugget recommendations from that synthesis.

The earlier `2026-07-21-model-settings` project delivered the Model Registry GUI, REST API, and per-persona model assignment system that this rework cycle continues to harden.

## Summary

This rework cycle closes all remaining actionable items from the model-settings-rework-1 synthesis: the UUID-reflection info-disclosure class in `api-models.ts` (Medium priority), the `matchRoute()` declarative refactor to make the full HTTP surface visible in a single route table (the largest piece), batch validation improvement for `handleUpdateAssignments()`, and a collection of test hygiene and documentation improvements. One synthesis deferred item (setup-gui-globals.ts ownership table) was found to be already resolved and is excluded.

## Architectural Context

The MCP server GUI (`mcp-server/gui/`) is a vanilla-JS SPA backed by a custom HTTP server in `server.ts`. The previous rework introduced a declarative `BodyRoute` interface and `dispatchBodyRoute()` dispatcher for body-parsing routes (~20 entries), reducing `handleRequest()` from ~448 to 55 lines. However, the body-free GET/DELETE routes still live in `matchRoute()` — a ~1,100-line if-else chain with ~50+ individual blocks. The `BodyRoute` interface already supports `noBody: true` for body-free routes, and several GET routes already use it (e.g., `GET /api/server-info`, `GET /api/config`).

The API model handlers in `api-models.ts` expose 8 REST endpoints. Five error messages in `handleUpdateAssignments()` and `handleReplaceAssignedModel()` reflect user-submitted UUIDs verbatim — the same OWASP A05 info-disclosure class that was already fixed for persona keys in the previous cycle.

## Approach / Architecture

1. **Unify the route system** — Evolve `BodyRoute` into a `Route` type that covers all HTTP routes (body and body-free). Extend the handler signature with an optional query-params argument. Replace `matchRoute()` entirely with declarative route entries in a single `buildRoutes()` function. The existing `dispatchBodyRoute()` becomes `dispatchRoute()` — the sole dispatcher for all API traffic.

2. **Complete UUID hardening** — Apply the same count-or-generic message pattern (already established for persona keys) to all 5 UUID-reflecting error messages. Simultaneously improve `handleUpdateAssignments()` to collect all invalid UUIDs and report a single error rather than failing fast on the first.

3. **Test and documentation hygiene** — Add `afterEach` fetch-mock teardown, `@throws` JSDoc, whitespace-slug test coverage, and minor documentation updates.

## Rationale

- The `matchRoute()` refactor is the natural completion of the `BodyRoute` pattern introduced in the prior cycle. Having two dispatch mechanisms (declarative table + 1,100-line if-else chain) creates a maintenance asymmetry where body routes are easy to find and body-free routes require reading the full chain. A single route table makes the entire HTTP surface visible at a glance — a prerequisite for any future OpenAPI spec or integration test harness.
- UUID hardening closes the full OWASP A05 info-disclosure class in the Model Registry API, leaving no known medium-or-higher security findings.
- Batch validation aligns with knowledge base insight #6 (validate inputs at the handler layer to produce complete, actionable 400 responses).

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Route interface evolution | Extend `BodyRoute` handler signature with `query?: URLSearchParams`; rename to `Route` | (A) Context object `{ body, groups, query }` — cleaner but breaks all existing handler signatures. (B) Pass full URL string — forces every handler to parse its own query string. | Adding an optional third param is backward-compatible: existing handlers ignore it. Minimal churn, maximal benefit. |
| Query-param support in dispatcher | Pass parsed `URLSearchParams` from the dispatcher to handlers that need it | (A) Handlers parse query from a captured URL closure — duplicates parsing logic. (B) Move query parsing into route definitions via a `queryParser` callback — over-engineered for the 13 routes that call `parseQueryString()` in `matchRoute()`. | Centralised parsing in the dispatcher is the simplest shape that serves all consumers. |
| Deprecated route handling | Order route table by **specificity** (keyword-specific routes before catch-alls at each segment depth), with `@deprecated` comments on individual deprecated entries placed adjacent to their active analogues | (A) Keep deprecated routes in a separate `matchRoute()` stub — defeats the purpose of a single authoritative table. (B) Remove deprecated routes — breaking change. (C) Deprecated-last grouping — the rejected approach: the active `GET /api/projects/:repo/:slug` catch-all would silently shadow all eight deprecated 4-segment keyword routes if placed before them. | Specificity-first ordering replicates the segment-count-first, then value-specificity ordering that `matchRoute()`'s exclusion guards currently enforce. A naive "deprecated last" grouping breaks backward compatibility silently — the eight deprecated `/:slug/keyword` routes become permanently unreachable. |
| UUID error message pattern | Count-or-generic message (e.g., "One or more model UUIDs do not exist") | (A) Keep UUID-specific messages for debuggability — leaks info. (B) Log the UUIDs server-side, return generic to client — adds complexity for a non-production debug need. | The count-or-generic pattern was already established for persona keys and is the project's standard for external-facing validation errors. |
| Batch validation for UUID checks | Collect all invalid UUIDs, report count in single error | (A) Keep fail-fast — simpler code but N round-trips. (B) Return array of all invalid fields — changes error shape. | Count-based message uses the same `{ code, message }` shape, no breaking change, eliminates multi-round-trip UX issue. |

## Pattern Alignment

- **`BodyRoute` / declarative dispatch** — `mcp-server/gui/server.ts` — This plan extends the pattern to cover the full HTTP surface. No departure.
- **Count-or-generic error messages** — `mcp-server/gui/api-models.ts` L353–359 — This plan applies the same pattern to UUID validation. No departure.
- **Named capture groups for RegExp routes** — established in WP-005 of the prior rework — This plan mandates them for all parameterised routes in the unified table. No departure.
- **`vm.runInThisContext()` test loading** — `mcp-server/tests/gui/` — This plan adds tests using the same pattern. No departure.
- **`assertSafeSlug()` path-traversal protection** — called inline in matchRoute — This plan moves the calls into handler closures. No departure in semantics.
- **JSDoc convention** — `mcp-server/gui/public/api-client.js` — This plan establishes `@throws` as a new convention for error-rejecting methods. Explicit new convention, not a departure.

## Detailed Steps

### Step 1: Evolve the Route Interface

Rename the `BodyRoute` interface to `Route` in `mcp-server/gui/server.ts`. Add an optional `query?: URLSearchParams` parameter to the handler signature:

```typescript
export interface Route {
  method: string;
  path: string | RegExp;
  handler: (body: unknown, groups?: Record<string, string>, query?: URLSearchParams) => Promise<unknown>;
  statusCode?: number;
  noBody?: boolean;
}
```

Update all existing references from `BodyRoute` to `Route` across the codebase (the interface, the builder function, the dispatcher, and any test imports).

### Step 2: Extend the Dispatcher with Query-Param Support

Rename `dispatchBodyRoute()` to `dispatchRoute()`. Modify it to:
1. Accept the full URL (not just the path) so it can extract query parameters.
2. Parse query parameters using `parseQueryString()` (already available in server.ts).
3. Pass the parsed `URLSearchParams` as the third argument to the handler.

The dispatcher already handles: method matching, string/RegExp path matching, optional body parsing (`noBody`), try/catch error formatting, response writing. Only the query-param pass-through is new.

### Step 3: Migrate matchRoute() Routes to the Declarative Table

Rename `buildBodyRoutes()` to `buildRoutes()`. Add all routes currently in `matchRoute()` as declarative entries with `noBody: true`. Group them by **specificity**, not by active/deprecated status — this ordering is load-bearing:

- **Section A — Body-parsing routes** (existing ~20 entries, already in the table; unchanged)
- **Section B — Keyword-specific routes** (both active and deprecated entries that fix a literal value in one segment position). Deprecated entries carry `@deprecated` comments and are placed directly adjacent to their active analogues. These routes cannot shadow each other because each fixes a literal in the last segment position.
- **Section C — Catch-all routes** (active entries first, then deprecated entries, within each segment depth). Listed last because they match any slug value in their variable position.

> **Load-bearing ordering:** Section B **must** precede Section C. The active `GET /api/projects/:repo/:slug` catch-all (a 4-segment RegExp matching any `/api/projects/X/Y`) would silently shadow the eight deprecated 4-segment keyword-specific GET routes (`/:slug/plan`, `/:slug/synthesis`, `/:slug/health`, `/:slug/run-metadata`, `/:slug/work-packages`, `/:slug/dialogues`, `/:slug/chunks`, `/:slug/runs`) if placed before them. The route table comment block must document that Section B precedes Section C for correctness, not cosmetics.

For parameterised routes, use RegExp with named capture groups:
```typescript
// GET /api/projects/:repo/:slug/plan
{ method: 'GET',
  path: /^\/api\/projects\/(?<repo>[^/]+)\/(?<slug>[^/]+)\/plan$/,
  noBody: true,
  handler: async (_body, groups) => {
    assertSafeSlug(groups!.repo!);
    assertSafeSlug(groups!.slug!);
    return handleGetPlanDocument(ledgerRoot, groups!.slug!, groups!.repo);
  },
},
```

For routes that need query parameters (e.g., `GET /api/projects`, `GET /api/knowledge`), use the `query` parameter:
```typescript
// GET /api/projects
{ method: 'GET', path: '/api/projects', noBody: true,
  handler: async (_body, _groups, query) => {
    const params = {
      page: query?.get('page') ?? undefined,
      limit: query?.get('limit') ?? undefined,
      // ...
    };
    return handleListProjects(ledgerRoot, params);
  },
},
```

### Step 4: Remove matchRoute() and Update handleRequest()

After all routes are in the unified table, delete the entire `matchRoute()` function (~1,100 lines). Simplify `handleRequest()` to call only `dispatchRoute()`:

```typescript
// Dispatch all API routes via the declarative route table
if (await dispatchRoute(req, res, method, url, port, buildRoutes(…))) {
  return;
}
sendError(res, 404, 'NOT_FOUND', 'Route not found.', port);
```

Preserve the route map summary comment block, updating it to note that all routes are now dispatched via the declarative table.

### Step 5: UUID-Reflection Hardening

In `mcp-server/gui/api-models.ts`, replace all 5 UUID-reflecting error messages with count-or-generic messages:

**`handleUpdateAssignments()`:**
- L367–370: `default_model_uuid` check → `"The default_model_uuid does not exist in the model registry."`
- L372–377: Per-persona UUID loop — also address batch validation (see Step 6)

**`handleReplaceAssignedModel()`:**
- L432–435: `old_model_id` check → `"The specified old_model_id does not exist in the model registry."`
- L437–440: `new_model_id` check → `"The specified new_model_id does not exist in the model registry."`
- L456–458: "not referenced" check → `"The specified model is not referenced in any current assignment. Nothing to replace."`

### Step 6: Batch Validation for handleUpdateAssignments()

Refactor the per-persona UUID validation loop in `handleUpdateAssignments()` (L372–377) to collect all invalid UUIDs before throwing:

```typescript
const invalidCount = Object.values(data.persona_models)
  .filter(uuid => !validModelIds.has(uuid)).length;
if (invalidCount > 0) {
  validationError(
    `${invalidCount} model ${invalidCount === 1 ? 'UUID' : 'UUIDs'} in persona_models ` +
    `do not exist in the model registry.`
  );
}
```

This eliminates the N-round-trip problem while using the same count-based message pattern and preserving the existing `{ code, message }` error shape.

### Step 7: afterEach Fetch-Mock Teardown

In `mcp-server/tests/gui/api-client.test.ts`, add an `afterEach` cleanup at the top-level `describe` scope:

```typescript
afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>)['fetch'];
});
```

Import `afterEach` from `vitest` alongside the existing imports.

### Step 8: JSDoc @throws Convention

In `mcp-server/gui/public/api-client.js`, add `@throws` annotations to all 8 model-related API methods:

```javascript
/**
 * @throws {{ code: string, message: string }} On HTTP error responses.
 */
```

This establishes the `@throws` convention for the API client. Apply to: `getModels()`, `saveModels()`, `loadDefaultModels()`, `getPersonas()`, `getAssignments()`, `updateAssignments()`, `replaceAssignedModel()`, `rebuildPersonas()`.

### Step 9: mrValidateSlug Whitespace Handling

In `mcp-server/gui/public/views/config-model-registry.js`, add `.trim()` to the slug validation:

```javascript
function mrValidateSlug(slug) {
  if (!slug || !slug.trim()) return 'Slug is required.';
  // ...
}
```

In `mcp-server/tests/gui/config-helpers.test.ts`, add a whitespace-only test case:

```typescript
it('returns error for whitespace-only string', () => {
  expect(mrValidateSlug('   ')).toBe('Slug is required.');
});
```

### Step 10: Minor Documentation Updates

**config-model-registry.js** — Update the header dependency comment at L4 to list all dependencies:
```
Depends on: API (api-client.js), UI (components.js), escapeHtml (utils.js), crypto.randomUUID (browser built-in), configDirty (config.js)
```

**orchestrator/src/utils/persona_models.py** — Add an inline comment next to the glob call at L236:
```python
# Pattern `[0-9]*-*.yaml` intentionally matches any numeric prefix (e.g. `1-`, `10-`).
# It also matches non-standard prefixes like `0a-` — acceptable because the persona
# build system enforces the `{digit}-{name}.yaml` naming convention.
for yaml_file in sorted(meta_dir.glob("[0-9]*-*.yaml")):
```

### Step 11: Update Existing Route Tests

Update any test files that import `BodyRoute`, `buildBodyRoutes`, or `dispatchBodyRoute` to use the renamed types:
- `mcp-server/tests/gui/route-structured-format.test.ts` — uses `handleRequest()` (no direct import of BodyRoute, likely unaffected)
- `mcp-server/tests/gui/server-*.test.ts` — verify none import `BodyRoute` directly; if they do, update the import.

Verify all existing route tests pass after the refactor. The behaviour is identical — only the internal dispatch mechanism changes.

### Step 12: Route Table Smoke Tests

Add a focused test that validates the route table structure:
- Every entry has a valid `method` (GET, POST, PUT, PATCH, DELETE).
- Every RegExp entry uses named capture groups (no positional groups).
- No duplicate `method + path` combinations exist in the table.

This prevents regressions when adding future routes.

## Dependencies

- Steps 1–4 form a sequence (interface → dispatcher → migration → cleanup).
- Steps 5–6 can be done in parallel with Steps 1–4 (different file).
- Steps 7–10 are independent of each other and of Steps 1–6.
- Step 11 depends on Steps 1–4 completing.
- Step 12 depends on Steps 1–4 completing.

## Required Components

- `mcp-server/gui/server.ts` — Route interface, dispatcher, route builder, matchRoute removal
- `mcp-server/gui/api-models.ts` — UUID hardening, batch validation
- `mcp-server/tests/gui/api-client.test.ts` — afterEach teardown
- `mcp-server/tests/gui/api-models.test.ts` — batch validation test (existing file, new test case)
- `mcp-server/gui/public/api-client.js` — @throws JSDoc
- `mcp-server/gui/public/views/config-model-registry.js` — mrValidateSlug fix, dependency comment
- `mcp-server/tests/gui/config-helpers.test.ts` — whitespace test case
- `orchestrator/src/utils/persona_models.py` — inline comment
- `mcp-server/tests/gui/` — route table smoke tests (new file or added to existing)

## Assumptions

- The `parseQueryString()` utility in `server.ts` is available and returns `URLSearchParams`.
- All deprecated routes must be preserved (no breaking changes to the HTTP API).
- The `assertSafeSlug()` function will be called inside handler closures rather than in a pre-dispatch hook — keeping the existing security semantics.
- No test files import `BodyRoute` directly (they use `handleRequest()` for integration tests).

## Constraints

- The `Route` interface rename must be a clean search-and-replace — no partial renames.
- The route table must preserve the exact same matching semantics as the current if-else chain (method, path segments, query parameters, slug validation, URL decoding).
- The unified dispatcher must handle all existing error types: `ApiError`, `PayloadTooLargeError`, and unexpected errors.
- Cross-platform: no changes affect the orchestrator's Python code beyond a documentation comment.

## Out of Scope

- SPA module system migration (`<script type="module">`) — strategic/future, requires a separate plan.
- Removing deprecated routes — would be a breaking change requiring a major version bump.
- OpenAPI spec generation from the route table — a future enhancement that this refactor enables but does not implement.

## Acceptance Criteria

- AC-01: All 5 UUID-reflecting error messages in `api-models.ts` use count-or-generic patterns; no user-submitted UUID appears in any HTTP error response.
- AC-02: `handleUpdateAssignments()` reports all invalid model UUIDs in a single error response (no fail-fast per UUID).
- AC-03: `matchRoute()` is completely removed from `server.ts`. All routes (body and body-free, active and deprecated) are dispatched via a single declarative route table.
- AC-04: The `Route` interface (formerly `BodyRoute`) supports query-parameter pass-through. Routes that need query params receive a `URLSearchParams` argument.
- AC-05: All existing GUI server tests pass without modification (beyond import renames if needed).
- AC-06: `api-client.test.ts` includes an `afterEach` that cleans up `globalThis.fetch`.
- AC-07: All 8 model-related methods in `api-client.js` have `@throws` JSDoc annotations.
- AC-08: `mrValidateSlug('   ')` returns `'Slug is required.'` (not the generic regex error). A test case covers this.
- AC-09: `config-model-registry.js` header lists all dependencies explicitly.
- AC-10: `persona_models.py` glob call has an inline comment documenting the intentional trade-off.
- AC-11: A route-table structure test validates method validity, named capture groups, and no duplicate routes.
- AC-12: The full MCP server test suite passes with zero failures.

## Testing Strategy

The refactor is primarily structural (no new features), so the testing strategy emphasises regression prevention:

1. **Existing test suite** — All ~3,593 tests must pass after every step. The route refactor is a pure internal restructuring; external behaviour is unchanged.
2. **Route table structure tests** — New tests validate the declarative table's invariants (valid methods, named groups, no duplicates).
3. **UUID hardening tests** — Existing tests in `api-client.test.ts` cover the error paths; verify they still pass with the new message text. If existing tests assert specific error message strings, update the assertions.
4. **Batch validation test** — Verify that submitting multiple invalid UUIDs returns a single error with the correct count.
5. **Whitespace slug test** — New test case for `mrValidateSlug('   ')`.
6. **afterEach verification** — Confirm no test ordering issues after adding the teardown.

## Test Plan

- `mcp-server/tests/gui/server-*.test.ts` (existing) — Verify all route integration tests pass unchanged — AC-03, AC-05
- `mcp-server/tests/gui/route-structured-format.test.ts` (existing) — Verify query-param routes work through the unified dispatcher — AC-04, AC-05
- `mcp-server/tests/gui/route-table.test.ts` (new) — Validate route table structure: valid methods, named capture groups on RegExps, no duplicate method+path combinations — AC-11
- `mcp-server/tests/gui/api-client.test.ts` (existing, modified) — afterEach cleanup added; verify existing tests pass — AC-06
- `mcp-server/tests/gui/api-models.test.ts` (existing, modified) — Add batch-validation test for `handleUpdateAssignments()` (submit multiple invalid UUIDs, verify single error with correct count); verify that error messages for UUID validation in `handleUpdateAssignments()` and `handleReplaceAssignedModel()` do NOT contain any UUID string (message text is free of the input UUID value) — AC-01, AC-02
- `mcp-server/tests/gui/config-helpers.test.ts` (existing, modified) — Add whitespace-only `mrValidateSlug` test case — AC-08
- Full test suite run (`npm test` from `mcp-server/`) — AC-12

## Documentation Updates

Per AGENTS.md Manifest Maintenance Rules:

- `mcp-server/docs/agents/project-manifest/api-surface.md` — Update `BodyRoute` → `Route` interface, update `buildBodyRoutes` → `buildRoutes`, update `dispatchBodyRoute` → `dispatchRoute`, remove `matchRoute` entry.
- `mcp-server/docs/agents/project-manifest/file-tree.md` — Add `route-table.test.ts` if created as a new file; update the `server.ts` annotation to reflect unified single-dispatcher routing (remove the "two-tier: matchRoute() handles body-free routes" description).
- `mcp-server/docs/agents/project-manifest/data-flows.md` — Update the request dispatch flow to reflect unified routing (single dispatcher, no matchRoute fallback).
- `mcp-server/docs/agents/project-manifest/constraints.md` — Document the `@throws` JSDoc convention for error-rejecting API client methods (new convention established in Step 8); update §71 "gui/server.ts Two-Tier Routing Convention" to describe the unified single-dispatcher architecture (all routes via `dispatchRoute()`), replacing references to `matchRoute()`.
- `mcp-server/gui/docs/agents/project-manifest/api-surface.md` — Update §1.4: remove the statement "GET routes are registered in `matchRoute()`"; reflect that all GET routes are now in the unified declarative route table.
- `mcp-server/gui/docs/agents/project-manifest/constraints.md` — Remove §9 documentation of segment-count matching inside `matchRoute()`; `matchRoute()` is removed by this plan.
- `mcp-server/gui/docs/agents/project-manifest/data-flows.md` — Remove `matchRoute()` from the request dispatch tree; update to show the unified declarative route table as the sole dispatcher.
- `.context/mcp-server/` (regenerated) — Run `node scripts/cli.js ctx-generate` after implementation to capture the three symbol renames (`BodyRoute` → `Route`, `buildBodyRoutes` → `buildRoutes`, `dispatchBodyRoute` → `dispatchRoute`) and the new `api-models.test.ts` additions in the generated snapshot.

## Deferred Items

| # | Deferred Item | Origin | Reason Deferred | Notes |
|---|---------------|--------|-----------------|-------|
| 1 | SPA module system migration (`<script type="module">`) | model-settings-rework-1 synthesis, Next Steps §4 | Requires a separate, larger plan encompassing the entire GUI frontend. Not scoped as a rework item. | Reconsider when the GUI gains enough complexity to warrant ES module imports (e.g., shared component library, bundler integration). |
| 2 | OpenAPI spec generation from the declarative route table | model-settings-rework-1 synthesis, Strategic Vision | Dependent on the unified route table (delivered by this plan, AC-03). Deserves its own plan with schema extraction, validation, and documentation generation. | The route table structure test (AC-11) establishes the machine-readable invariants needed as a foundation. |
| 3 | Deprecated route removal (major version breaking change) | Ongoing — ~16 deprecated routes preserved for backward compatibility | Requires a major version bump and migration guide for any consumers of the non-namespaced API. | Track usage of deprecated routes via server-side access logging before removing. |

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Route migration introduces subtle matching differences** | The route table must replicate `matchRoute()`'s specificity ordering: keyword-specific routes (those that fix a literal in the last segment position) must appear in Section B before catch-alls in Section C at the same segment depth. Concretely, the eight deprecated 4-segment GET routes (`/:slug/plan`, `/:slug/synthesis`, etc.) must appear before the active `GET /api/projects/:repo/:slug` catch-all — otherwise they become permanently unreachable, silently breaking backward compatibility. The route map summary comment block must state that this ordering is load-bearing. Step 12 structural tests validate method validity, named groups, and no duplicate routes. |
| **RegExp capture group naming errors** | Named capture groups are already mandatory (prior rework convention). The route table test (AC-11) validates their presence on every RegExp route. |
| **Query-param handling breaks for edge cases** | 13 routes call `parseQueryString()` in the current `matchRoute()`. Each must be verified with the existing integration test pattern (real HTTP server + request). |
| **`dispatchRoute` rename breaks external consumers** | `BodyRoute`, `buildBodyRoutes`, and `dispatchBodyRoute` are exported from `server.ts`. Check if any file outside `mcp-server/` imports them. If so, update the imports. |
| **Batch validation changes break clients expecting single-error format** | The error shape `{ code, message }` is preserved. Only the message text changes. No structural breaking change. |

## Recommended Workflow
- **Workflow:** ledger
- **Rationale:** The matchRoute refactor touches ~1,100 lines of routing logic with ~50+ routes to migrate, benefits from formal QA validation of every route, and the security hardening warrants a security audit stage.
