# Plan

## Plan Audit Cycles
- Audits: 3 — Plan Auditor v1.4.0
- Architectural Reviews: 1 — Plan Architect Reviewer v1.5.0

## Summary

Complete the namespace migration across the entire GUI stack so that no component uses the legacy bare-slug form (`/api/projects/:slug/...`) without the repository namespace prefix. The server already exposes full namespaced routes (`/api/projects/:repo/:slug/...`) and `handleListProjects` already returns `repository_name` in every `ProjectSummary`. This plan brings the frontend (API client, router, all views) and the orchestrator queue into alignment so that multi-root workspaces with slug collisions are fully supported end-to-end.

This plan also addresses the remaining secondary synthesis items: diagnostic logging in `resolveProjectStore()`, a shared namespaced test fixture factory, and `api-surface.md` route table normalization.

## Architectural Context

### Storage Layout

Projects are stored in a namespaced directory structure: `{ledgerRoot}/{repoName}/{slug}/`. The `LedgerStore.listAllProjects()` method scans both depth-1 (legacy flat) and depth-2 (namespaced) layouts. The migration to namespaced storage on disk is complete — all new projects are created under `{repo}/{slug}/`.

### Server-Side Routes (Complete)

`mcp-server/gui/server.ts` already has full parity between non-namespaced and namespaced routes:
- Non-namespaced: `GET /api/projects/:slug`, `GET /api/projects/:slug/plan`, etc.
- Namespaced: `GET /api/projects/:repo/:slug`, `GET /api/projects/:repo/:slug/plan`, etc.

The `resolveRepoName()` function resolves the canonical `repository_name` from `.meta.json` given a URL-param repo and slug.

### Frontend (NOT migrated — the gap)

- **`api-client.js`**: All 20+ project-scoped methods accept only `slug`. They construct URLs like `/projects/{slug}/...`.
- **`router.js`**: Hash routes only match `#/projects/:slug`, `#/projects/:slug/plan`, `#/projects/:slug/wp/:wpId`, `#/projects/:slug/runs/:filename`.
- **All views** (`project-list.js`, `project-detail.js`, `work-package.js`, `run-log.js`, `orchestrator.js`, `insights.js`): Use slug-only API calls and generate slug-only links.
- **`utils.js`**: Breadcrumb helper builds links with slug only.

### Orchestrator Queue (NOT migrated — secondary gap)

- `RawQueueEntry.expectedSlug` contains just the plan folder basename (e.g. `2026-05-05-feature`). No `expectedRepo` field exists yet.
- `getProjectLedgerStatus()` in `src/gui/queue/get-queue.ts` looks up `join(ledgerRoot, slug, 'project-ledger.json')` — the flat path.
- The Python orchestrator registers with `slug=plan_dir.name` (line 784 of `cli.py`).

### Key Reference Files

| File | Current State |
|------|---------------|
| `mcp-server/gui/public/api-client.js` | All methods use slug-only URLs |
| `mcp-server/gui/public/router.js` | Only `#/projects/:slug` patterns |
| `mcp-server/gui/public/views/project-list.js` | Links: `#/projects/{slug}` |
| `mcp-server/gui/public/views/project-detail.js` | All API calls: slug only |
| `mcp-server/gui/public/views/work-package.js` | API calls: slug only |
| `mcp-server/gui/public/views/run-log.js` | API calls: slug only |
| `mcp-server/gui/public/views/orchestrator.js` | Links use `entry.expectedSlug` without repo |
| `mcp-server/gui/public/views/insights.js` | Links use `e.project_slug` without repo |
| `mcp-server/gui/public/views/knowledge.js` | Links use `origin_plan` slug without repo |
| `mcp-server/gui/public/utils.js` | Breadcrumb: `#/projects/{slug}` |
| `mcp-server/src/gui/queue/types.ts` | `RawQueueEntry` — add `expectedRepo: string | null` field |
| `mcp-server/src/gui/queue/get-queue.ts` | `getProjectLedgerStatus()` — flat path lookup |
| `mcp-server/src/gui/queue/resolve-progress.ts` | `resolveProgress()` — suffix-matches log filenames by bare slug |
| `mcp-server/gui/orchestrator-manager.ts` | `killQueueEntry()` + `dismissQueueEntry()` call `getProjectLedgerStatus(ledgerRoot, entry.expectedSlug)` — must pass `expectedRepo` |
| `orchestrator/src/utils/run_queue.py` | Registers with `slug=plan_dir.name` |
| `orchestrator/src/cli.py` | Passes `plan_dir.name` as slug (line 785) |

## Approach / Architecture

### Design Principle: Composite Identifier

Rather than threading separate `repo` and `slug` parameters through every layer, adopt a **composite identifier** pattern:

- **URL format**: `/api/projects/:repo/:slug/...` (already exists on server)
- **Hash route format**: `#/projects/:repo/:slug/...`
- **API client**: Methods accept `(repo, slug)` as first two params, constructing `/projects/{repo}/{slug}/...`
- **Internal passing**: Views pass both `repo` and `slug` as separate values (not a single string) to maintain type clarity

### Migration Strategy: Clean Cut

Since the server already supports both route variants and `handleListProjects` already returns `repository_name` for every project:

1. **Update API client methods** to accept `(repo, slug)` and always use the namespaced route.
2. **Update router** to parse `#/projects/:repo/:slug/...` hash patterns.
3. **Update all views** to pass and use `(repo, slug)`.
4. **Update orchestrator queue** to write `expected_repo` alongside `slug` in queue entries.
5. **Deprecate (but retain)** server-side non-namespaced routes for one version cycle.

### InsightEntry and Queue Entry Changes

- `InsightEntry` interface: Add `repository_name: string | null` field.
- `RawQueueEntry` interface: Add `expectedRepo: string | null` field (6-field → 7-field interface). The `expectedSlug` field retains its original semantics (bare slug only). Legacy queue entries written before this migration will have `expectedRepo` as `undefined` at the JSON level — normalization in `validate-entry.ts` (`isRawQueueEntry()` or `readQueueFile()`) sets missing `expectedRepo` to `null` so that all downstream consumers can rely on the type being `string | null` (never `undefined`).
- `getProjectLedgerStatus()`: Use `expectedRepo` (when non-null) to construct the namespaced path `join(ledgerRoot, expectedRepo, slug, 'project-ledger.json')`. Fall back to flat-path lookup when `expectedRepo` is null (legacy queue entries).
- Python `run_queue.register()`: Accept `repo_name` parameter and write it as `expected_repo` alongside the existing `slug` field.

## Rationale

The server-side namespace migration was completed months ago. Leaving the frontend on the legacy slug-only form creates:
1. **Correctness risk**: In multi-root workspaces, two repos can have the same slug — the non-namespaced route resolves ambiguously or fails with NOT_FOUND.
2. **Wasted complexity**: The server maintains duplicate route blocks for backward compatibility that should have been consumed by now.
3. **Queue status drift**: `getProjectLedgerStatus()` cannot find projects in namespaced storage given a flat `expectedSlug`.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| API client parameter shape | `(repo, slug)` as separate params | Single composite string `"repo/slug"` | Separate params avoids encoding/decoding errors and is consistent with server handler signatures |
| Hash route format | `#/projects/:repo/:slug/...` | Keep `#/projects/:slug` and pass repo as query param | Dedicated URL segments are clearer, bookmarkable, and match the API URL structure |
| Queue entry repo identification | Separate `expectedRepo` field on `RawQueueEntry` | Composite `repo/slug` in `expectedSlug` | A separate field eliminates runtime parsing at 4+ consumer sites; composite would force every reader to detect, split, and fallback — adding one nullable field to a 6-field interface is trivial |
| Legacy route retention | Keep for one version cycle with deprecation notice | Remove immediately | Avoids breaking any external consumers or bookmarks during transition |

## Pattern Alignment

- **Namespaced route pattern** — follows `mcp-server/gui/server.ts` lines 557 onward (existing `/:repo/:slug` blocks). No departure.
- **`resolveProjectDir()` composite input** — `mcp-server/src/utils/ledger-root.ts` line 153 already accepts `slugOrQualified` containing `/`. Not used for queue migration (see Finding 2 rationale: separate field is cleaner than composite overloading).
- **`ProjectSummary.repository_name`** — `mcp-server/gui/api.ts` line 266 already includes this field. Frontend views consume it but only for display. This plan extends that to navigation.
- **Orchestrator queue schema** — `mcp-server/src/gui/queue/types.ts` and `orchestrator/src/utils/run_queue.py` define the shared schema. This plan adds an `expectedRepo` field; `expectedSlug` retains its original bare-slug semantics.

## Detailed Steps

### Phase 1: API Client & Router (Frontend Foundation)

1. **Update `api-client.js`** — Change all project-scoped methods from `function(slug)` to `function(repo, slug)`. Construct URL paths as `/projects/{repo}/{slug}/...`. Retain `getProjects()` unchanged (list endpoint does not take repo/slug).

2. **Update `router.js`** — Change route-matching regexes:
   - `#/projects/:repo/:slug` → `renderProjectDetail(app, repo, slug)`
   - `#/projects/:repo/:slug/plan` → `renderPlan(app, repo, slug)`
   - `#/projects/:repo/:slug/synthesis` → `renderSynthesis(app, repo, slug)`
   - `#/projects/:repo/:slug/wp/:wpId` → `renderWorkPackageDetail(app, repo, slug, wpId)`
   - `#/projects/:repo/:slug/runs/:filename` → `renderRunLog(app, repo, slug, filename)`

3. **Update `utils.js`** breadcrumb helper — Change `project(slug)` to `project(repo, slug)` producing links to `#/projects/{repo}/{slug}`.

### Phase 2: View Migration

4. **Update `project-list.js`** — Change project links from `#/projects/{slug}` to `#/projects/{repo}/{slug}`. Pass `repository_name` from the project summary. Update action menu handler to pass `(repo, slug)` to API client delete/archive/unarchive calls.

5. **Update `project-detail.js`** — Change function signature to `renderProjectDetail(app, repo, slug)`. Update all API calls to pass `(repo, slug)`. Update internal links (WP rows, plan link, synthesis link, run log links). Update sub-functions `renderPlan(app, repo, slug)` and `renderSynthesis(app, repo, slug)`.

6. **Update `work-package.js`** — Change `renderWorkPackageDetail(app, repo, slug, wpId)`. Update API calls to pass `(repo, slug)`.

7. **Update `run-log.js`** — Change `renderRunLog(app, repo, slug, filename)`. Update API calls to pass `(repo, slug)`.

8. **Update `orchestrator.js`** — Queue entries will have both `expectedSlug` (bare slug) and `expectedRepo` (repository name). Use both fields to generate correct links: `#/projects/{expectedRepo}/{expectedSlug}/runs/{filename}`. When `expectedRepo` is null (legacy entries), fall back to a flat link or omit the project link. Also update the "View Project" link.

9. **Update `knowledge.js`** — Knowledge entries include `origin_plan` (a bare slug). The knowledge API response (or InsightEntry) must supply a `repository_name` alongside `origin_plan` so that links can use `#/projects/{repo}/{slug}`. Reuse the `inferProjectRootFromPlanPath → split → pop` pattern from `handleListProjects` in the knowledge handler to derive `repository_name`.

10. **Update `insights.js`** — Consume the new `repository_name` field from `InsightEntry` to generate correct links: `#/projects/{repo}/{slug}`.

### Phase 3: Orchestrator Queue Namespace

11. **Update `InsightEntry` interface** (`mcp-server/gui/api.ts`) — Add `repository_name: string | null` to the type and populate it in `handleGetInsights()` from the project's storage path.

12. **Update `getProjectLedgerStatus()`** (`mcp-server/src/gui/queue/get-queue.ts`) — Read `entry.expectedRepo` (the new field). When non-null, construct the namespaced path: `join(ledgerRoot, expectedRepo, slug, 'project-ledger.json')`. When `expectedRepo` is null (legacy queue entries written before this migration), fall back to the flat-path lookup: `join(ledgerRoot, slug, 'project-ledger.json')`. Also update the `getQueue()` call site in the same file (line 148) to pass `entry.expectedRepo`. The normalization in `validate-entry.ts` guarantees that `expectedRepo` is always `string | null` (never `undefined`) by the time it reaches this function.

13. **Update `resolveProgress()`** (`mcp-server/src/gui/queue/resolve-progress.ts`) — This function matches log filenames by suffix: `const suffix = \`-${slug}.jsonl\``. Unlike step 12, this is NOT a path-construction problem — log filenames are flat (never contain `/`). When `expectedRepo` is provided, it does not affect the suffix match because log filenames use the bare slug only. Verify that `resolveProgress()` receives the bare `expectedSlug` (not a composite) — since the plan keeps `expectedSlug` as a bare slug, no change is needed here. Add a code comment documenting this invariant.

14. **Update Python `run_queue.register()`** (`orchestrator/src/utils/run_queue.py`) — Accept `repo_name` parameter. Write `expected_repo` as a new field in the queue entry JSON alongside the existing `slug` field (which remains the bare plan-directory name).

15. **Update `cli.py`** (`orchestrator/src/cli.py`) — Derive `repo_name` from `plan_dir.parents[3].name` (the existing pattern used for log-copy paths on line ~119 in `_derive_ledger_log_dir()`) and pass it to `run_queue.register()`.

16. **Update `QueueEntry` consumers in orchestrator-manager.ts** — `killQueueEntry()` and `dismissQueueEntry()` pass `entry.expectedSlug` and `entry.expectedRepo` to `getProjectLedgerStatus()`. Since step 12 handles the null-repo fallback, entries from older orchestrator versions (which lack `expectedRepo`) continue to work.

### Phase 4: Deprecation & Cleanup

17. **Add deprecation comments** to non-namespaced route blocks in `server.ts` — Mark them as deprecated, to be removed in the next major version.

18. **Add `resolveProjectStore()` diagnostic logging** (`mcp-server/gui/api.ts` line ~194) — Log caught errors to stderr inside the catch block for operator diagnostics.

19. **Create shared test fixture factory** — `mcp-server/tests/gui/helpers/create-namespaced-project.ts` with JSDoc explaining the `YYYY-MM-DD-slug` planPath constraint.

### Phase 5: Documentation

20. **Update `api-surface.md`** — Mark non-namespaced routes as deprecated. Normalize the route table format for all namespaced routes including `run-metadata`.

21. **Update `data-flows.md`** — Document the frontend→API→storage namespace flow.

22. **Regenerate `.context/` docs** — Run `node scripts/cli.js ctx-generate`.

## Dependencies

- Phase 2 depends on Phase 1 (views cannot pass `(repo, slug)` until the API client and router accept it).
- Phase 3 is independent of Phases 1–2 (queue namespace can proceed in parallel).
- Phase 4 depends on Phases 1–3 (deprecation only after all consumers are migrated).
- Phase 5 depends on Phase 4.

## Required Components

### Files to Modify

| File | Change |
|------|--------|
| `mcp-server/gui/public/api-client.js` | All project methods: `(slug)` → `(repo, slug)` |
| `mcp-server/gui/public/router.js` | Route patterns: add `:repo` segment |
| `mcp-server/gui/public/utils.js` | Breadcrumb: `project(repo, slug)` |
| `mcp-server/gui/public/views/project-list.js` | Links + action handlers |
| `mcp-server/gui/public/views/project-detail.js` | Function signatures + all API calls + internal links |
| `mcp-server/gui/public/views/work-package.js` | Function signature + API calls |
| `mcp-server/gui/public/views/run-log.js` | Function signature + API calls |
| `mcp-server/gui/public/views/orchestrator.js` | Queue entry link generation |
| `mcp-server/gui/public/views/insights.js` | Project links |
| `mcp-server/gui/public/views/knowledge.js` | Project links: use `repository_name` + `origin_plan` for `#/projects/{repo}/{slug}` links |
| `mcp-server/gui/api.ts` | `InsightEntry` type + `handleGetInsights()` + `resolveProjectStore()` logging |
| `mcp-server/gui/server.ts` | Deprecation comments on legacy routes |
| `mcp-server/src/gui/queue/get-queue.ts` | `getProjectLedgerStatus()` (use `expectedRepo`) |
| `mcp-server/src/gui/queue/resolve-progress.ts` | Add invariant comment documenting bare-slug usage in suffix matching |
| `mcp-server/src/gui/queue/validate-entry.ts` | Normalize missing `expectedRepo` field to `null` in `isRawQueueEntry()` or `readQueueFile()` |
| `mcp-server/gui/orchestrator-manager.ts` | Pass `entry.expectedRepo` to `getProjectLedgerStatus()` in `killQueueEntry()` and `dismissQueueEntry()` |
| `orchestrator/src/utils/run_queue.py` | `register()` signature + `expected_repo` field |
| `orchestrator/src/cli.py` | Pass `repo_name` to `run_queue.register()` |

### Files to Create

| File | Purpose |
|------|---------|
| `mcp-server/tests/gui/helpers/create-namespaced-project.ts` | Shared test fixture factory |

### Documentation Files to Update

| File | Change |
|------|--------|
| `mcp-server/docs/agents/project-manifest/api-surface.md` | Route table normalization + deprecation notices |
| `mcp-server/docs/agents/project-manifest/data-flows.md` | Frontend namespace flow |
| `orchestrator/docs/agents/project-manifest/constraints.md` | Queue `expectedSlug` format change |

## Assumptions

- All projects in the ledger have a valid `repository_name` derivable from their storage path or `.meta.json`. Projects at depth-1 (legacy flat layout) should have been migrated by the existing `migrate-namespaced.ts` migration.
- The `handleListProjects` response already provides `repository_name` for every project — no backend change needed for the list endpoint.
- The Python orchestrator's `plan_dir.parents[3]` derivation correctly identifies the repository name (this is an existing pattern already used for log-copy paths in `cli.py`).
- No external consumers (bookmarks, scripts) depend on the non-namespaced server routes — deprecation is safe.

## Constraints

- **Cross-platform**: All path construction must use proper encoding (`encodeURIComponent` in JS, `urllib.parse.quote` not needed since slugs are already safe).
- **Backward compatibility**: Non-namespaced server routes remain functional during the deprecation period (one version cycle).
- **Queue schema**: The `expectedRepo` addition is a structural schema change (new nullable field). `expectedRepo` is `null` for legacy queue entries; consumers use the flat-path lookup when `expectedRepo` is null.
- **Queue normalization boundary**: All consumers of `entry.expectedRepo` must rely on the normalized value (`null` for legacy, `string` for new entries) — normalization happens at the queue-read boundary (`validate-entry.ts`).
- **Test isolation**: Existing tests may use bare slugs — update them rather than breaking test infrastructure.

## Out of Scope

- Removing non-namespaced server routes entirely (deferred to next major version).
- Tombstone deprecation system (noted in prior synthesis as needing broader impact analysis).
- `startOrchestrator()` options-object refactor (no 5th parameter exists yet).
- KeyboardInterrupt test coverage in `cli.py` (pre-existing gap, not related to namespace).

## Acceptance Criteria

1. **AC-1**: Every `API.*` method in `api-client.js` that takes a project identifier uses `(repo, slug)` and constructs the namespaced URL `/projects/{repo}/{slug}/...`.
2. **AC-2**: The router correctly dispatches `#/projects/:repo/:slug`, `#/projects/:repo/:slug/plan`, `#/projects/:repo/:slug/synthesis`, `#/projects/:repo/:slug/wp/:wpId`, and `#/projects/:repo/:slug/runs/:filename`.
3. **AC-3**: All links generated by `project-list.js`, `project-detail.js`, `orchestrator.js`, `insights.js`, `knowledge.js`, and `utils.js` use the `#/projects/{repo}/{slug}` form.
4. **AC-4**: The orchestrator registers queue entries with `expected_repo` set to the repository name and `slug` set to the bare plan-directory name.
5. **AC-5**: `getProjectLedgerStatus()` correctly resolves projects using `expectedRepo` (namespaced path) and falls back to flat-path lookup when `expectedRepo` is null.
6. **AC-6**: All existing GUI tests pass after migration (test assertions updated to use namespaced URLs/routes).
7. **AC-7**: `resolveProjectStore()` logs caught errors to stderr for operator diagnostics.
8. **AC-8**: A shared `createNamespacedProject(repo, slug)` test fixture factory exists with JSDoc.
9. **AC-9**: `api-surface.md` documents all namespaced routes in consistent table format and marks non-namespaced routes as deprecated.
10. **AC-10**: Zero regressions in the MCP server and orchestrator test suites.

## Testing Strategy

The migration is primarily a URL-pattern change across the frontend layer. Testing focuses on:

1. **API client unit tests** — Verify each method constructs the correct namespaced URL path.
2. **Router dispatch tests** — Verify hash patterns with two path segments (`repo/slug`) dispatch to the correct view function.
3. **View integration tests** — Verify rendered links include the repo segment.
4. **Queue integration tests** — Verify the `expected_repo` field is written by Python and `getProjectLedgerStatus()` uses `expectedRepo` + `expectedSlug` correctly.
5. **HTTP integration tests** — Existing `api-run-metadata.test.ts` style tests confirm end-to-end operation with namespaced routes.
6. **Regression** — Full test suite run for both MCP server and orchestrator.

## Test Plan

- `mcp-server/tests/gui/api-client.test.ts` — Update all existing assertions to expect namespaced URL paths (`/projects/{repo}/{slug}/...`). Add tests for each modified method verifying repo+slug encoding. — AC-1, AC-6
- `mcp-server/tests/gui/router.test.ts` (new or extend existing) — Test dispatch of `#/projects/my-repo/my-slug`, `#/projects/my-repo/my-slug/plan`, `/synthesis`, `/wp/WP-001`, `/runs/filename.jsonl`. — AC-2
- `mcp-server/tests/gui/client-rendering.test.ts` — Update link assertions in project-list rendering to expect `#/projects/{repo}/{slug}`. — AC-3, AC-6
- `mcp-server/tests/gui/project-detail-runs.test.ts` — Update `renderWithAPI` stubs to pass `(repo, slug)`. Verify run log links include repo. — AC-3, AC-6
- `mcp-server/tests/gui/orchestrator-view.test.ts` — Verify queue entry links use `expectedRepo` + `expectedSlug` to generate `#/projects/{repo}/{slug}/runs/{file}`. — AC-3, AC-4
- `mcp-server/tests/gui/knowledge-links.test.ts` (new or extend existing) — Verify `knowledge.js` origin-plan links use `#/projects/{repo}/{slug}` when `repository_name` is available. — AC-3
- `mcp-server/tests/gui/helpers/create-namespaced-project.ts` — Unit test the factory function itself (valid planPath format, correct directory structure). — AC-8
- `mcp-server/tests/gui/queue-ledger-status.test.ts` (new) — Test `getProjectLedgerStatus()` with `expectedRepo` non-null (namespaced path). Test backward compat with `expectedRepo` null (flat-path fallback). — AC-5
- `orchestrator/tests/test_run_queue.py` (new or extend) — Test that `register()` writes `expected_repo` field alongside bare `slug`. — AC-4
- `mcp-server/tests/gui/api-run-metadata.test.ts` — Existing namespaced HTTP tests validate server-side operation (no change needed). — AC-10
- Full regression: `cd mcp-server && npm test` and `cd orchestrator && python -m pytest` — AC-10

## Documentation Updates

- `mcp-server/docs/agents/project-manifest/api-surface.md` — Normalize all GUI server route entries to consistent table format. Add deprecation notice to non-namespaced route variants. Document updated `api-client.js` method signatures.
- `mcp-server/docs/agents/project-manifest/data-flows.md` — Add a "Frontend Namespace Resolution" section documenting how `repository_name` flows from `handleListProjects` → project-list → hash route → view → API client → namespaced server route.
- `orchestrator/docs/agents/project-manifest/constraints.md` — Update constraint re: queue entry format (new `expectedRepo` field).
- `.context/` — Regenerate via `node scripts/cli.js ctx-generate`.
- `AGENTS.md` Cross-System Dependencies table — Update the queue entry row to note new `expectedRepo` field.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Bookmarked URLs break** | Non-namespaced server routes remain functional for API calls. Old `#/projects/:slug` hash URLs will not resolve in the SPA router during the deprecation period. This is acceptable for internal tooling — no async fallback is added to preserve the router's stateless dispatch model. |
| **Queue entries written by older orchestrator versions lack `expectedRepo`** | `getProjectLedgerStatus()` falls back to flat-path lookup when `expectedRepo` is null. |
| **`repository_name` is null for some projects** | Validate in `handleListProjects` that every project has a non-null `repository_name`. If null (should not occur post-migration), omit the project link from navigation (display as read-only row without click-through) rather than generating a broken URL. Log a warning for operator investigation. |
| **Test count increase slows CI** | The changes are primarily URL string updates to existing tests, not new test files. Net new tests are limited to ~3 new describe blocks. |
| **Python orchestrator and TS server desync on queue format** | Both sides are updated in the same plan. The `getProjectLedgerStatus()` null-`expectedRepo` fallback ensures old-format entries still work. |
