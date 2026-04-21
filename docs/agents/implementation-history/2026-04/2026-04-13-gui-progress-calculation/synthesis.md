
## Synthesis

### Completion Status
- Date: 2026-04-13
- Status: COMPLETE
- Completed by: Standalone Developer Agent

### Implementation Summary
- Added `passed_stages` (optional non-negative integer) to `WorkPackageSummarySchema` in the root index, tracking how many pipeline stages have PASS status per WP.
- Added `progress_pct` (optional non-negative number) to `ProjectMetaSchema`, caching the project-level progress percentage.
- Created `computePassedStages()` helper in `workflow-helpers.ts` — counts distinct stage types with a most-recent PASS (excluding auto-cancelled pipelines), scoped to the WP's active pipeline stages.
- Created `computeProjectProgress()` helper in `workflow-helpers.ts` — computes a 0–100 integer from WP summaries using the weighted formula: COMPLETE/CANCELLED → 1.0, IN_PROGRESS → passed/active, READY/BLOCKED → 0.0.
- Updated all three `LedgerStore` sync methods (`updateWorkPackageWithSync`, `createWorkPackageWithSync`, `batchUpdateWorkPackagesWithSync`) to automatically compute `passed_stages` on the modified WP's summary entry and include `progress_pct` in the `.meta.json` cache sync.
- Updated `writeRootIndex()` to include `progress_pct` in the `.meta.json` cache update.
- Extended `writeProjectMeta()` `cacheUpdates` type to accept `progress_pct` and persist/preserve it alongside existing enrichment fields.
- Updated `handleListProjects` in `gui/api.ts`: added `progress_pct` to the `ProjectSummary` type, reads it from the meta cache (fast path) or falls back to the old `(total - pending) / total` formula (legacy projects), and sorting by "done" now uses `progress_pct`.
- Updated frontend `buildTable()` in `project-list.js` to use `p.progress_pct` from the API response (with fallback to the old formula for backward compatibility).
- No changes required to `project-reset.ts` — the automatic `passed_stages` sync in `batchUpdateWorkPackagesWithSync` handles all WPs modified by reset and mark-complete operations.

### Documentation Updates
- No documentation updates were required because all changes are internal to the MCP server and do not alter public MCP tool signatures, CLI interfaces, or user-facing configuration. The new fields are optional and backward-compatible.

### Verification Summary
- Tests run: `npx vitest run` (full suite) — 1830 tests across 60 files
- Tests run: `npx vitest run tests/utils/progress.test.ts` — 21 new tests for `computePassedStages` and `computeProjectProgress`
- Static analysis run: `npx tsc --noEmit` — clean, no type errors
- Result: ALL PASS — no regressions

### Code Insights
- [low] (improvement) `mcp-server/gui/api.ts` → `handleListProjects`: The enrichment logic for the slow path (legacy meta files) computes `progress_pct` using the old binary formula rather than reading WP summaries from the root index. This is intentional for backward compatibility, but existing projects will show coarse-grained progress until their next WP write triggers a `passed_stages` backfill. A one-time migration script to backfill `passed_stages` on all existing WP summaries could improve accuracy for legacy projects.
- [low] (convention) `mcp-server/src/storage/ledger-store.ts`: ~~The `cacheUpdates` parameter type on `writeProjectMeta` is growing (now 9 optional fields). If more cache fields are added in the future, consider extracting the type into a named interface for clarity and reuse.~~ **Fixed** — extracted `MetaCacheUpdates` named interface.
- [low] (debt) `mcp-server/gui/public/views/project-list.js`: ~~The frontend `buildTable` retains a fallback calculation (`total - pending / total`) for `progress_pct`.~~ **Fixed** — removed legacy fallback; falls back to `0` when `progress_pct` is absent.

### Additional Comments
- Both `passed_stages` and `progress_pct` are optional fields with backward-compatible defaults. Legacy ledger files will parse without error. Progress will refine automatically as WPs are written through the sync methods.
- The `batchUpdateWorkPackagesWithSync` approach ensures `passed_stages` is computed after any pipeline state mutations (e.g., auto-cancellation during project reset), so the value is always consistent with the final WP state on disk.
