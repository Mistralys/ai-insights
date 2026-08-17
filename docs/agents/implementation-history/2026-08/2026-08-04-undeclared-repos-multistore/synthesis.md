## Synthesis

### Completion Status
- Date: 2026-08-04
- Status: COMPLETE
- Completed by: Standalone Developer Agent
- Archived in Ledger: 2026-08-04

### Outcome Summary

Enabled undeclared repository scanning in multi-store mode by extending the `handleListRepos()` multi-store branch to perform per-store filesystem scanning with cross-store dedup. The frontend toggle guard was removed simultaneously, making the "Show undeclared repositories" checkbox fully interactive regardless of store mode. All acceptance criteria are satisfied.

### Implementation Summary
- Extended `handleListRepos()` in `mcp-server/gui/api-repos.ts`: when `includeUndeclared` is true in multi-store mode, the function now iterates all stores, reads each store's filesystem, filters undeclared namespaces against a global set of all declared `folder_names` across all stores (cross-store dedup), validates each namespace contains at least one project, and returns synthetic `RepoListItem` entries tagged with the correct `store_id`.
- Updated the `GET /api/repos` route-level JSDoc to remove the "not yet implemented" note.
- Simplified `buildToggleHtml()` in `mcp-server/gui/public/views/strategy.js`: removed the `multiStore` parameter and the disabled-checkbox branch. Both call sites updated to drop the `isMultiStore` argument.
- Added a new `describe` block "handleListRepos — include_undeclared in multi-store mode" in `mcp-server/tests/gui/api-repos.test.ts` with 6 tests covering all acceptance criteria.

### Documentation Updates
- No documentation updates were required because no public API signatures changed and no new files were added. The JSDoc update is inline (step 1c of the plan).

### Verification Summary
- Tests run: `mcp-server/tests/gui/api-repos.test.ts` (75 tests, 75 passed — includes 6 new tests)
- Static analysis run: `tsc` (TypeScript build) — no errors
- Result: PASS — all 75 tests in the target file pass; pre-existing failures in unrelated HTTP integration test files (`dispatch-route`, `server-queue`, `security-headers`, `server-body-limit`, `server-info`, `route-structured-format`, `run-log-server`, `server-knowledge-routes`, `api-run-metadata`) are unchanged from before this implementation.

### Code Insights
- [low] (improvement) `mcp-server/gui/api-repos.ts` → `handleListRepos()`: The per-store undeclared scanning loop makes one `LedgerStore.listProjectsByFolderNames()` call per undeclared namespace. For users with many namespace directories across many stores, this could be slow. A future micro-optimisation would batch the namespace lookups per store rather than calling one at a time — the single-store path has the same characteristic, so this is consistent debt, not new.
- [low] (convention) `mcp-server/tests/gui/api-repos.test.ts`: The `writeRepoRegistry` helper (lines 712–727) is scoped inside the WP-006 `describe` block, forcing the new multi-store undeclared tests to use `saveRegistry` directly with inline fixture data. Promoting `writeRepoRegistry` (or an equivalent) to module scope would reduce duplication across both describe blocks.

### Additional Comments
- The cross-store dedup guard collects all `folder_names` from `getMergedRegistry()` (which already suppresses duplicate IDs via first-match priority). This means the dedup is correct even when the same repo ID appears in multiple stores — only the winner's folder names are included in the dedup set, consistent with the priority rule.
