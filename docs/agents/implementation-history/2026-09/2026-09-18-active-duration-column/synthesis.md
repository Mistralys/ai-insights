
## Synthesis

### Completion Status
- Date: 2026-09-18
- Status: COMPLETE
- Completed by: Standalone Developer Agent
- Research brief: used
- Archived in Ledger: 2026-09-18

### Outcome Summary

Implemented the active-duration project column exactly as scoped: a new `active_ms` / `pipeline_runs` enrichment-cache pair, computed once at synthesis completion and lazily self-healed by the detail endpoint, repoints the project-list Duration column and its sort onto active pipeline time while the old wall-clock figure moves to a hover tooltip and the detail page's label. The backfill script was extended and run for real across all three configured stores, and the independently verified `2026-09-16-ledger-project-declaration` project now reports exactly the figures recorded in the plan (`active_ms: 9549000`, `pipeline_runs: 75`).

### Implementation Summary
- Added `active_ms` (nullable) and `pipeline_runs` fields to `ProjectMetaSchema` and `MetaCacheUpdates`, following the existing `duration_ms` nullability and two-phase-spread conventions.
- Added `computeWpActiveMs()` to `workflow-helpers.ts`, shared by `completeSynthesis()` (the synthesis-time cache write, inside the existing lock) and `handleGetProject()` (the authoritative recomputation and self-heal path) — a single implementation of "active time" instead of two.
- `handleGetProject()`'s self-heal for `active_ms`/`pipeline_runs` and the pre-existing `duration_ms` self-heal are now collected into one `MetaCacheUpdates` object and flushed with a single `writeProjectMeta()` call, closing a write race the original two-independent-writes design would have introduced.
- Repointed the `duration` sort key onto `active_ms` and updated the project-list column to render active time with the wall-clock figure as a tooltip; renamed the detail page's wall-clock label to "Elapsed", leaving its element id and live-refresh path untouched.
- Extended `scripts/backfill-duration.js` to independently backfill `active_ms`/`pipeline_runs` alongside `duration_ms` (splitting the prior all-or-nothing skip), and ran it for real across the `ledger`, `mistralys`, and `nexus` stores.

### Documentation Updates
- Updated the MCP server manifest (`api-surface.md`, `data-flows.md`) with the new schema fields, the `computeWpActiveMs()` helper, the extended `completeSynthesis` contract, the repointed sort semantics, and the merged self-heal behavior.
- Updated the GUI manifest's documented `sort` query values.
- Updated root `AGENTS.md`'s `backfill-duration.js` tooling row (synced to `CLAUDE.md` via `ctx-generate`).
- Added `mcp-server/changelog.md` (v2.10.0) and root `changelog.md` (v2.12.0) entries; synced module and root package versions; regenerated `.context/`.

### Verification Summary
- Tests run: `mcp-server` Vitest suite (`npx vitest run` in `mcp-server/`), root workspace script suite (`npx vitest run scripts/tests/`)
- Static analysis run: `npx tsc --noEmit` in `mcp-server/`
- Result: PASS — full `mcp-server` suite and root script suite pass with no failures; `tsc --noEmit` clean. No pre-existing `gui/server-*.test.ts` failures were observed at baseline or after the change (the documented pre-existing failure set did not reproduce in this environment). Frontend rendering (AC-10, AC-11) was verified only via `node --check` syntax validation — this session had no Browser tool available, so the visual/interactive GUI check called for in the Test Plan was not performed; see AX Feedback.
- Real backfill run: `node scripts/cli.js backfill-duration --dry-run` rehearsed across all three configured stores, then a real run — no errors, and a repeat run confirmed idempotency (nothing further backfilled). The spot-check project reports `active_ms: 9549000` / `pipeline_runs: 75`, matching the plan's independently verified figures exactly (AC-13).

### Code Insights

#### Implementation Decisions
- [high] (decision) `mcp-server/gui/api.ts` `handleGetProject()`: The new `active_ms`/`pipeline_runs` self-heal and the pre-existing `duration_ms` self-heal were originally two independent fire-and-forget `writeProjectMeta()` calls. Caught via a flaky existing test (the AC-04a duration self-heal test) after this change: two unlocked read-modify-write calls against the same `.meta.json` can race, with the later write discarding the earlier one's update. Fixed by collecting all self-heal outcomes into one `MetaCacheUpdates` object and flushing them with a single call.
- [medium] (decision) `scripts/backfill-duration.js`: the plan directed resolving WP detail paths via the root index's `work_packages[].file` field, but `LedgerStore.wpDetailPath()` (`ledger-store.ts` L130–132) always joins the project directory with `${wpId}.json` and ignores `file` entirely — confirmed against live on-disk projects where `file` reads `'ledger/WP-001.json'` but the actual file sits at the project root as `WP-001.json'`. Implemented the backfill using the server's actual `${wpId}.json` convention, per the developer protocol's rule that code is the current truth over plan text written against an earlier state.
- [low] (decision) `mcp-server/src/schema/project-meta.ts`: `active_ms` is nullable (mirrors `duration_ms`'s clearable-cache pattern) and `pipeline_runs` is non-nullable, always written alongside it — matching the plan's stated rationale exactly.

#### Follow-Up Items
- [low] (debt) `mcp-server/src/storage/ledger-store.ts` `writeProjectMeta()`: each new `MetaCacheUpdates` field costs four near-identical spread lines (preserve-existing ×2, override ×2) inside an already-large function. A small builder driven by a `{key, nullable}` field-spec table would collapse this to one line per field. This is pre-existing structure the plan explicitly follows rather than introduces, so it was left as-is — flagged for a future consolidation pass.

### Additional Comments
- The real backfill run touched every configured store (`ledger`, `mistralys`, `nexus`) and is not reversible via this session — if any backfilled `.meta.json` file needs correction, re-running the script is idempotent and safe (it only overwrites the fields it is asked to compute, `.meta.json`-only).
- Manual GUI verification (AC-10, AC-11) was not performed with a real browser in this session — no Browser tool was available. The rendering logic was reviewed by inspection and syntax-checked with `node --check`; a follow-up visual pass is recommended before this ships to end users who rely on the GUI.
