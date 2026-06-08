# Synthesis Report — Planner Project History Access

**Plan:** `2026-06-04-planner-project-history-access`
**Date:** 2026-06-05
**Status:** COMPLETE (10/10 WPs, all pipelines PASS)
**Overall Test Result:** 3,066 tests passing across 101 test files — zero regressions

---

## Executive Summary

This project delivered end-to-end project history awareness to the Planner agent. The Synthesis agent now authors a concise `outcome_summary` at project completion; a new `ledger_get_repository_context` MCP tool surfaces a bounded project timeline (with outcome summaries, strategic vision, and relevant insights) to the Planner at plan-creation time; and a GUI "Strategy" screen allows users to maintain a three-horizon strategic vision per declared repository. The implementation was completed without breaking changes to existing data, schemas, or agent workflows. All ten work packages were delivered through the full four-stage pipeline (implementation → QA → code-review → documentation). WP-008 (Strategy GUI frontend) required two rework cycles due to a vision badge data mismatch and two form-validation bugs found at QA and code-review — both corrected and re-verified before PASS.

---

## Metrics

| Metric | Value |
|---|---|
| Work Packages | 10 / 10 COMPLETE |
| Pipeline Stages (total) | 40 / 40 PASS |
| WPs requiring rework | 1 (WP-008 — 2× implementation, 2× QA, 1× code-review) |
| Final test suite | 3,066 tests across 101 files — 0 failures |
| Starting test suite | 2,934 tests across 97 files |
| Net tests added | +132 tests across 4 new test files + extensions |
| TypeScript build | PASS throughout (no build regressions at any stage) |
| CTX context regeneration | 33 documents — 0 errors (ran at WP-003, WP-005, WP-009) |
| Persona build | 102 personas / 102 files — 0 errors (WP-009) |
| Documentation-forward items resolved | 10 (all addressed within the same or a following WP) |
| Fix-Forward edits by Reviewer | 3 (WP-004: completeSynthesis echo; WP-005: schema description; WP-009: stale step-number cross-reference) |

### Test Growth by Work Package

| WP | Focus | Tests Added | Suite Total |
|---|---|---|---|
| WP-001 | Repository registry schema | 40 | 2,974 |
| WP-002 | outcome_summary schema + writeProjectMeta | 11 | 2,945 |
| WP-003 | Repository registry storage module | 23 | 2,968 |
| WP-004 | completeSynthesis tool extension | 4 | 2,972 |
| WP-005 | ledger_get_repository_context MCP tool | 27 (18 tool + 9 storage) | 3,000 |
| WP-006 | GUI REST API — /api/repos CRUD | 46 | 3,046 |
| WP-007 | ledger_help content | 9 | 3,055 |
| WP-008 | Strategy GUI frontend | 5 (net, after rework) | 3,060 |
| WP-009 | Persona updates | 5 (AC verification) | 3,060* |
| WP-010 | Project list label resolution | 6 | 3,066 |

*WP-009 changes were to persona source/config files, not to the mcp-server test suite.

---

## Deliverables

### New MCP Tool: `ledger_get_repository_context`

- **File:** `mcp-server/src/tools/repository-context.ts`
- **Registered in:** `mcp-server/src/index.ts`
- Accepts `cwd_path` or `repository_name`; `repository_name` takes precedence
- Cross-folder aggregation when a declared repository declares multiple `folder_names`
- `max_projects` cap (default: 5); `total_projects` always reflects the untruncated count
- `include_insights` flag (default: true); always returns `relevant_insights: []` (field present) rather than omitting it
- New storage helper: `LedgerStore.listProjectsByFolderNames()` — targeted O(folders × projects-per-folder) scan, not a full ledger root walk

### Schema Extensions

- **`ProjectMetaSchema`** (`project-meta.ts`): `outcome_summary?: string | null`
- **`RootIndexSchema`** (`root-index.ts`): `outcome_summary?: string | null`
- **`RepositoryRegistrySchema`** / `RepositoryEntrySchema` / `StrategicVisionSchema` — new file `repository-registry.ts`
- All changes are strictly backward-compatible (optional fields; existing files parse without modification)

### `ledger_complete_synthesis` Extension

- `outcome_summary` is now a **required** field on `CompleteSynthesisSchema`
- Value persisted to both `project-ledger.json` (root index) and `.meta.json` (enrichment cache)
- Echoed back in the success response body
- `CompleteSynthesisSchema` is now exported for direct test validation

### Repository Registry Storage Module

- **File:** `mcp-server/src/storage/repository-registry.ts`
- Plain-function module: `loadRegistry()`, `saveRegistry()`, `findByFolderName()`, `getAllFolderNames()`
- `loadRegistry()` degrades gracefully to `{ repositories: [] }` on absent file, malformed JSON, or schema validation failure (intentionally lossy — documented with `@remarks`)
- `saveRegistry()` validates via `RepositoryRegistrySchema` before acquiring `withLock(ledgerRoot)` and calling `atomicWriteJson` — matches the project-wide locking strategy
- `REGISTRY_FILENAME = '.repositories.json'` at ledger root (dot-file convention, same as `.knowledge/`)

### GUI — Repository CRUD API (`/api/repos`)

- **File:** `mcp-server/gui/api-repos.ts`
- 5 handlers: `handleListRepos`, `handleGetRepo`, `handleCreateRepo`, `handleUpdateRepo`, `handleDeleteRepo`
- Folder-name uniqueness enforced across all entries via `assertNoFolderNameConflicts()`
- `RepoListItem` (list endpoint) exposes `has_vision` and `has_full_vision` booleans rather than the full vision object — avoids over-fetching
- `POST /api/repos` returns HTTP 201 (correct REST; intentionally differs from the server's uniform-200 convention for other mutations)
- `RepoCreateBodySchema` / `RepoUpdateBodySchema` exported with `@internal` JSDoc

### GUI — Strategy Frontend (`#/strategy`)

- **File:** `mcp-server/gui/public/views/strategy.js`
- Route `#/strategy`: list view with vision status badges (No / Partial / Full) and Add Repository form
- Route `#/strategy/:repoId`: detail/editor view with label, folder names (add/remove), and three vision textareas
- Client-side validation: empty folder names and empty vision fields handled before API calls (empty strings coerced to `null` for vision; folder count < 1 aborts with error banner)
- Navigation link "Strategy" added to `index.html` nav

### GUI — Project List Enhancement

- Project list now resolves repository labels from the registry via `repoFolderMap` (parallel fetch with `Promise.all`; graceful degradation on `/api/repos` failure)
- Matched repos display label linked to `#/strategy/:repoId`; unmatched repos display raw folder name (no regression)

### Persona Updates

- **Planner (`1-planner.yaml`):** `has_mcp: true`, `central_pm/*` in tools, `mcp_tools` array with `ledger_get_repository_context` and `ledger_search_insights`
- **Planner (`1-planner.md`):** New workflow step 3 "Gather project history" with explicit graceful-degradation guidance
- **Plan output template:** Optional `## Prior Project Context` section before `## Summary`
- **Synthesis (`9-synthesis.yaml`):** `ledger_complete_synthesis` entry documents `outcome_summary` requirement and 2–3 sentence guidance
- Build: 102 personas / 102 files across VS Code, Claude Code, and Deep Agents targets

### Help Content (`ledger_help`)

- `TOOL_HELP['ledger_get_repository_context']`: all 4 parameters, full response shape, cross-folder aggregation notes, 3 usage examples
- `TOOL_HELP['ledger_complete_synthesis']`: `outcome_summary` documented as required parameter
- Section grouping comments added to `help-content.ts` (9 sections) for navigability
- Tool count corrected in `README.md` (root and `mcp-server/`)

### Documentation

Comprehensive documentation updates delivered across:
- `mcp-server/README.md` — new tool, Strategy GUI section, tool counts
- `mcp-server/docs/agents/project-manifest/api-surface.md` — all new interfaces and functions
- `mcp-server/docs/agents/project-manifest/file-tree.md` — all new source and test files
- `mcp-server/docs/agents/project-manifest/tech-stack.md` — plain-function storage pattern rationale
- `mcp-server/docs/agents/project-manifest/data-flows.md` — `.repositories.json` storage layout, Flow 13c/14 updates
- `mcp-server/docs/agents/project-manifest/constraints.md` — constraint 61 for `api-repos.ts`
- `personas/ledger/README.md` — Planner MCP prereqs, agent flow, stage 1 tips
- All compiled persona targets (VS Code, Claude Code, Deep Agents)
- CTX context files regenerated throughout

---

## Strategic Recommendations ("Gold Nuggets")

### 1. Schema-Level Intentional Divergence Between Input and Storage Schemas

WP-004 surfaced a deliberate and well-handled pattern: `CompleteSynthesisSchema` declares `outcome_summary` as `z.string()` (required, non-nullable) while `RootIndexSchema` declares it as `z.string().nullable().optional()`. This is the correct design — input schemas enforce call-site contracts; storage schemas are permissive for backward compatibility with legacy records. The `'in' cacheUpdates` key-presence check bridges the two. **This dual-schema pattern should be documented as a project convention** so future contributors know it is intentional rather than an oversight.

### 2. Plain-Function Storage Modules as the Correct Abstraction for Stateless I/O Helpers

WP-003 established (and WP-006 confirmed) that for stateless registry operations (no caching, no lifecycle, no in-memory state), a plain-function module is the correct shape — not a class. The code-reviewer explicitly validated this against the `LedgerStore` class, which has initialization state and lifecycle. **This distinction (class = stateful/lifecycle; module = stateless/functional) should be documented in `tech-stack.md`** as a guiding principle for new storage modules — WP-003's documentation agent did add a section on this.

### 3. Graceful Degradation as a First-Class Design Constraint

Three distinct components were designed with explicit graceful degradation: `loadRegistry()` (absent/corrupt file → empty registry), `safeListRepositoryInsights()` in `repository-context.ts` (SLUG_REGEX failure → empty array), and the Planner's new MCP workflow step (tool error or empty result → proceed without historical context). This pattern is worth codifying: **any optional enrichment path — where absence is acceptable — should specify its fallback contract explicitly in the JSDoc `@remarks` block.** The `loadRegistry()` implementation is the canonical example.

### 4. `has_vision` / `has_full_vision` Boolean Contract Boundary

The decision to expose pre-computed booleans (`has_vision`, `has_full_vision`) on `RepoListItem` rather than the full vision object is a strong API design choice that prevents over-fetching on list endpoints. **This pattern — pre-computing derived boolean summaries for list APIs while returning full objects on detail endpoints — should be applied to any future list endpoint that includes complex nested objects.** The `toListItem()` function in `api-repos.ts` is the canonical reference.

### 5. Test File Coverage Comments as Living Documentation

WP-010 surfaced a gap where the `project-list.test.ts` `Covers:` comment block listed only the original 5 tests despite 6 new ones being added. The documentation pipeline caught and fixed this. **Test file header comments should be treated as required documentation artifacts, updated in the same commit that adds new test cases.** A future constraint or lint rule could enforce this automatically.

---

## Deferred & Follow-Up Items

### Deferred (Intentionally Postponed)

| # | Source | Agent | Description | Priority |
|---|---|---|---|---|
| D-1 | WP-001 | QA | `RepositoryRegistrySchema` has no schema-level uniqueness constraint on `id` — duplicate IDs are accepted by the schema and uniqueness is enforced by the storage layer. Confirmed intentional. | Low |
| D-2 | WP-002 | QA | No storage-level integration test for `writeProjectMeta()` with `outcome_summary` — coverage gap matches sibling fields (`project_name`, `repository_name`). A test that calls `writeProjectMeta({ outcome_summary: 'text' })` and reads back `.meta.json` would close this round-trip gap. | Low |
| D-3 | WP-003 | Developer | `loadRegistry()` merges three distinct failure modes (absent file, malformed JSON, schema validation failure) into a single `{ repositories: [] }` fallback. A typed result `{ registry, source: 'loaded' | 'default' | 'corrupt' }` would give callers diagnostic fidelity if observability becomes important. | Low |
| D-4 | WP-003 | Developer | `REGISTRY_FILENAME` constant is module-private. If WPs downstream of WP-003 need the path directly, export `registryPath()` rather than hardcoding the constant. (No downstream need materialized in this cycle.) | Low |
| D-5 | WP-005 | Developer | `cwd_path → repository_name` derivation constructs a synthetic plan path (`${cwd_path}/docs/agents/plans/synthetic-slug`) and calls `deriveRepoName()`. A dedicated `resolveFolderNameFromCwd(workspaceRoot)` helper in `ledger-root.ts` would eliminate the indirection. | Low |
| D-6 | WP-005 | Developer | `include_insights` path fetches up to 20 global insights unconditionally. A future `max_insights` parameter or repository-name tag filter would keep responses token-efficient for large knowledge stores. | Low |
| D-7 | WP-006 | Developer | `handleUpdateRepo` with an empty body `{}` is a valid no-op that still bumps `last_modified`. If the product team wants to require at least one field, a `z.refine()` on `RepoUpdateBodySchema` is the fix. | Low |
| D-8 | WP-007 | Reviewer | `help-content.ts` is still a flat `~1060`-line `Record<string, string>`. Section grouping was added in this cycle but individual entries could be further organized. | Low |
| D-9 | WP-010 | Developer | `project-list.js` `load()` fetches `/api/repos` on every 10 s poll cycle. A longer-TTL cache (fetch only on navigation or explicit Refresh) would reduce unnecessary API calls since repo declarations change rarely. | Low |

### Out-of-Scope Items (Beyond This Plan's Boundaries)

| # | Source | Agent | Description | Priority |
|---|---|---|---|---|
| O-1 | WP-005 | QA | No integration test for `listProjectsByFolderNames()` against a real ledger root with a known `cwd_path` — only mocked in current test suite. Low risk (component is separately unit-tested) but a real-path integration test would add confidence. | Low |
| O-2 | WP-006 | QA | No test for URL-encoded `repoId` in `GET /DELETE /api/repos/:repoId` handlers. `decodeURIComponent` is called at the `server.ts` routing level so it works at runtime, but no unit-level test exercises the decode path. | Low |
| O-3 | WP-008 | Code Review (original FAIL) | Strategy GUI nav link (`#/strategy`) is not highlighted on sub-routes (`#/strategy/:repoId`). Consistent with existing SPA behavior for all nav links on nested routes. A future UX pass could use prefix matching in `updateNavActive()`. | Low |
| O-4 | WP-009 | Developer | `scripts/build-personas.js` emits 3 pre-existing `WARN` entries for unresolved variables in `ctx-architect.md`. Out of scope for this plan — should be fixed in a dedicated documentation cleanup. | Low |
| O-5 | WP-005 / WP-006 | Multiple | Global and repository insights are concatenated without deduplication in `repository-context.ts`. If a future knowledge-base workflow allows the same insight to appear in both stores, the Planner may see duplicates. Not a current issue (stores are disjoint by schema). | Low |
| O-6 | WP-005 | Reviewer | Strategy list view (declared-only): `handleListRepos` returns only registry-declared repos; it does not discover undeclared namespaces on the filesystem. A filesystem-discovery mode (scanning all namespace dirs in the ledger root) was explicitly deferred per the plan's "Strategy list data source (V1)" decision. | Medium |

---

## Next Steps

### Immediate (Planner Seed for Next Cycle)

1. **Validate the Planner history workflow end-to-end.** Now that `ledger_get_repository_context` is deployed and the Planner persona is updated, run a real planning cycle and verify the Planner correctly calls the tool, handles the response, and incorporates prior context into the plan. Pay particular attention to the `outcome_summary` field on recently completed projects — these will only be populated from this cycle forward.

2. **Populate `outcome_summary` on legacy projects.** Projects completed before this change have no `outcome_summary` in their `.meta.json`. Consider a one-time backfill script or a manual pass on important projects so the Planner has useful historical summaries immediately.

3. **Register the first repository in the Strategy GUI.** The `ai-insights` repository should be the first entry — set an `id`, `label`, one or more `folder_names`, and optionally draft a short-term vision. This activates the cross-folder aggregation and label display features.

### Strategic Enhancements (Medium Priority)

4. **Filesystem discovery for the Strategy list (O-6).** The current Strategy list shows only declared repos. A V2 mode that scans the ledger root and surfaces undeclared namespaces alongside declared ones would improve discoverability for new users. Design cue: reuse `LedgerStore.listAllProjects()` namespace enumeration.

5. **`outcome_summary` minLength guard.** WP-004 QA noted that an empty string passes `CompleteSynthesisSchema` validation (no `min(1)` constraint). A future hardening pass should add `z.string().min(10)` (or similar) to prevent degenerate submissions from creating useless history context.

6. **Storage-level integration test for `outcome_summary` round-trip (D-2).** Add a test that calls `writeProjectMeta({ outcome_summary: 'text' })` and reads back `.meta.json` to confirm field persistence. This closes the coverage gap flagged by WP-002 QA.

7. **Insight deduplication in `repository-context.ts` (O-5).** As the knowledge base grows, deduplicate by insight `id` in the response concatenation to prevent the same insight appearing as both a global and a repository insight.

### Low Priority / Housekeeping

8. **`ctx-architect.md` unresolved variables (O-4).** Fix the 3 `WARN` entries in the persona build script.
9. **`project-list.js` repo-fetch caching (D-9).** Cache the registry response across poll cycles.
10. **URL-encoded repoId test (O-2).** Add a unit test for `decodeURIComponent` handling at the `server.ts` route level.
11. **Dual-schema convention documentation (Gold Nugget 1).** Add a note to `constraints.md` or `tech-stack.md` describing the intentional divergence between input schemas (`z.string()`) and storage schemas (`z.string().nullable().optional()`) for fields that must be present on creation but may be absent in legacy data.
