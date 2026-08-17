# Plan

## Plan Audit Cycles
- Audits: none — Plan Auditor v1.7.0
- Architectural Reviews: none — Plan Architect Reviewer v2.2.0

## Summary

Enable the "Show undeclared repositories" toggle in the GUI Strategy/Repositories screen when running in multi-store mode. Currently the toggle is disabled with a "Not available in multi-store mode" note — this was a deferral from the original multi-store implementation. Since multi-store is now the de facto standard, the undeclared repo scanning must work across all configured stores. The backend will scan each store's filesystem for namespace directories not covered by that store's declared repos, and the frontend will remove the disabled guard.

## Architectural Context

The `handleListRepos()` function in `mcp-server/gui/api-repos.ts` serves `GET /api/repos` and has two code paths:

- **Multi-store mode** (stores.length > 1): delegates to `MultiStoreManager.getMergedRegistry()` which iterates all stores and returns tagged `RepoListItem[]` entries — but currently ignores the `includeUndeclared` parameter entirely and returns early.
- **Single-store / legacy mode**: performs filesystem scanning at `ledgerRoot` to discover namespace directories not covered by declared `folder_names`, validates each contains at least one project, and returns synthetic undeclared entries alongside declared ones.

The frontend `buildToggleHtml()` in `strategy.js` renders a disabled checkbox with an explanatory note when `isMultiStore` is true.

## Approach / Architecture

Extend the existing multi-store branch in `handleListRepos()` to perform the same undeclared namespace scanning as the single-store path, but per-store. Each store is scanned independently: its own registry provides the set of declared `folder_names`, its own filesystem provides the namespace directories, and `LedgerStore.listProjectsByFolderNames()` validates project presence using the store's path as `ledgerRoot`. An additional cross-store dedup guard ensures that a namespace directory in store B is not reported as undeclared if it is already claimed by a declared repo in any store (including store A). Undeclared entries are tagged with `store_id` like declared entries.

On the frontend, `buildToggleHtml()` drops the `multiStore` parameter entirely — the toggle renders identically regardless of store mode.

## Rationale

- The single-store undeclared scanning logic is well-tested and straightforward. Replicating it per-store in the multi-store branch follows the established pattern.
- Cross-store dedup is necessary because a user might have namespace `foo` on disk in store B that is actually managed by a declared repo in store A (which maps to folder `foo`). Without dedup, it would appear as undeclared in store B.
- Removing the frontend guard is trivial since the toggle already works correctly — it was only disabled because the backend didn't support it.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Per-store scanning vs. centralized scan | Per-store scanning (iterate stores, scan each independently) | Single merged scan across all store paths | Per-store scanning naturally produces `store_id`-tagged results and keeps the logic parallel to the single-store path. A merged scan would require additional bookkeeping to attribute undeclared entries to the correct store. |
| Cross-store dedup scope | Dedup against all declared `folder_names` across all stores | Dedup only within each store's own declared folder_names | Cross-store dedup prevents confusing duplicates when the same namespace exists in multiple stores but is declared in only one. The cost is one extra pass to collect all declared folder_names upfront — trivial. |

## Pattern Alignment

- Follows the existing pattern in `handleListRepos()` where single-store scanning uses `readdir` + `LedgerStore.listProjectsByFolderNames()` — `mcp-server/gui/api-repos.ts` L300–L348.
- Follows the multi-store iteration pattern using `getStoreRouter().getAllStores()` — established in `MultiStoreManager.getMergedRegistry()` at `mcp-server/src/storage/multi-store-manager.ts` L187.
- Follows the test infrastructure pattern for multi-store tests — `mcp-server/tests/gui/api-repos.test.ts` L670–L790.

## Detailed Steps

### Step 1: Extend `handleListRepos()` multi-store branch to support undeclared scanning

In `mcp-server/gui/api-repos.ts`, modify the multi-store branch of `handleListRepos()`:

1a. When `includeUndeclared` is false, keep the existing fast path (return declared entries only from `getMergedRegistry()`).

1b. When `includeUndeclared` is true:
   - First, collect all declared `folder_names` across all stores (for cross-store dedup) by iterating `getMergedRegistry()` results.
   - Then, for each store from `getAllStores()`:
     - Load the store's registry via `loadRegistry(store.path)`.
     - `readdir(store.path, { withFileTypes: true })` to enumerate namespace directories.
     - Filter to directories not starting with `.` and not in the global declared `folder_names` set.
     - For each undeclared namespace, call `LedgerStore.listProjectsByFolderNames([namespace], store.path)` to verify it contains at least one project.
     - Create synthetic `RepoListItem` entries with `declared: false` and `store_id: store.id`.
   - Return `[...declared, ...undeclared]`.

1c. Update the JSDoc comment on the multi-store branch to remove the "not yet implemented" note.

### Step 2: Remove multi-store disable guard from frontend toggle

In `mcp-server/gui/public/views/strategy.js`:

2a. Simplify `buildToggleHtml()` to remove the `multiStore` parameter and the disabled-checkbox branch. The function always renders the interactive checkbox.

2b. Update both call sites (`renderList` and `refreshTable`) to drop the `isMultiStore` argument.

### Step 3: Add tests for multi-store undeclared repo discovery

In `mcp-server/tests/gui/api-repos.test.ts`, add a new `describe` block after the existing multi-store tests:

3a. Test: `include_undeclared=true` returns undeclared namespace entries from each store with correct `store_id`.

3b. Test: undeclared entries have the correct synthetic shape (`declared: false`, `has_vision: false`, `folder_names: [name]`).

3c. Test: namespace already covered by a declared repo's `folder_names` (in any store) is excluded from undeclared results (cross-store dedup).

3d. Test: `include_undeclared=false` (default) still returns only declared entries in multi-store mode.

3e. Test: dot-prefixed directories are excluded from undeclared results in multi-store mode.

3f. Test: namespaces without any project (no `.meta.json`) are excluded from undeclared results.

## Dependencies

- No new dependencies. Uses existing `readdir`, `LedgerStore.listProjectsByFolderNames`, and store context utilities.

## Required Components

- `mcp-server/gui/api-repos.ts` — modify `handleListRepos()`
- `mcp-server/gui/public/views/strategy.js` — modify `buildToggleHtml()` and its two call sites
- `mcp-server/tests/gui/api-repos.test.ts` — add multi-store undeclared test suite

## Assumptions

- Each store's filesystem layout follows the same convention as the single-store layout: namespace directories at the store root, project directories within namespaces.
- The existing `seedNamespaceProject()` test helper works correctly when given a store path as `ledgerRoot`.

## Constraints

- Must not break existing single-store undeclared scanning behavior.
- Must not break existing multi-store declared-only listing behavior.
- Must handle stores with unreadable directories gracefully (same `try/catch` pattern as single-store).

## Out of Scope

- Moving undeclared repos between stores.
- Bulk-registering undeclared repos from the Conflicts tab.
- Changing how the "Register" button works for undeclared entries in multi-store mode (it already opens the add modal with store selection).

## Acceptance Criteria

- AC-01: In multi-store mode, `handleListRepos(root, true)` returns undeclared namespace entries from each store, each tagged with the correct `store_id` and `declared: false`.
- AC-02: Undeclared entries have the correct synthetic shape: `id` and `label` equal the namespace directory name, `folder_names` is `[name]`, `has_vision` is false.
- AC-03: A namespace directory that is already covered by any declared repo's `folder_names` in any store is excluded from undeclared results (cross-store dedup).
- AC-04: `include_undeclared` defaults to false in multi-store mode — only declared entries are returned.
- AC-05: Dot-prefixed directories and namespaces without projects are excluded from undeclared results in multi-store mode.
- AC-06: The frontend "Show undeclared repositories" toggle is interactive in multi-store mode (no longer disabled).
- AC-07: Existing single-store undeclared scanning behavior is unchanged.

## Testing Strategy

Unit tests against `handleListRepos()` using the existing multi-store test infrastructure (temp directories, `setStoreContext`, `seedNamespaceProject`). Frontend changes are trivial HTML/JS — verified by visual inspection and covered by the backend tests ensuring the data is returned correctly.

## Test Plan

- `mcp-server/tests/gui/api-repos.test.ts` — New describe block "handleListRepos — include_undeclared in multi-store mode":
  - "returns undeclared entries from each store with correct store_id" — Asserts undeclared namespace in store A gets `store_id: 'store-a'` and vice versa. Covers AC-01.
  - "undeclared entries have correct synthetic shape" — Asserts `declared: false`, `id === namespace`, `has_vision === false`, etc. Covers AC-02.
  - "namespace covered by declared folder_names in any store is excluded" — Declares a repo in store A with `folder_names: ['shared-ns']`, seeds `shared-ns` directory in store B, asserts no undeclared entry for `shared-ns`. Covers AC-03.
  - "include_undeclared defaults to false in multi-store mode" — Calls without `includeUndeclared`, asserts only declared entries returned. Covers AC-04.
  - "dot-prefixed directories excluded in multi-store mode" — Seeds `.archive` directory, asserts excluded. Covers AC-05.
  - "empty namespaces (no projects) excluded in multi-store mode" — Creates a namespace directory without seeding a project, asserts excluded. Covers AC-05.

## Documentation Updates

- `mcp-server/gui/api-repos.ts` — Update JSDoc on the multi-store branch (inline, part of step 1c).
- No manifest updates needed — no new files, no API signature changes, no new dependencies.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Performance with many stores and large filesystems** | The scanning is bounded by the number of namespace directories per store (typically < 50). `listProjectsByFolderNames` only checks for `.meta.json` existence — lightweight. Same cost profile as the single-store path. |
| **Race condition if registry changes during scan** | Same risk exists in single-store mode and is accepted. The GUI always re-fetches on toggle, so stale results are transient. |

## Recommended Workflow
- **Workflow:** standalone
- **Rationale:** Single-module change within the established undeclared-scanning pattern — no cross-project impact, no new architecture.
