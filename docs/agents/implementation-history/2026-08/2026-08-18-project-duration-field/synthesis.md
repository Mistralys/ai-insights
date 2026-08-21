## Synthesis

### Completion Status
- Date: 2026-08-18
- Status: COMPLETE
- Completed by: Standalone Developer Agent
- Archived in Ledger: 2026-08-18

### Outcome Summary

Added a persisted `duration_ms` enrichment cache field to `.meta.json`, computed automatically whenever `synthesis_generated_at` is set on the root index (synthesis completion, standalone import, or the legacy self-heal repair path). The GUI project list now shows a sortable Duration column, the detail endpoint reads the cached value with a lazy self-heal fallback, and a one-time backfill script (with CLI registration) populates the field for existing projects. All acceptance criteria are met and the full mcp-server test suite (4063 tests) passes.

### Implementation Summary
- Added `duration_ms: z.number().int().nonnegative().nullable().optional()` to `ProjectMetaSchema`.
- Extended `MetaCacheUpdates` with `duration_ms?: number | null` and wired key-presence semantics into `writeProjectMeta()` (preserve-on-omit, explicit-null-clear).
- `writeRootIndex()` now computes `duration_ms = synthesis_generated_at - date_created` whenever `synthesis_generated_at` is present, nulling out invalid/clock-skewed timestamps and zero-duration standalone same-session imports, and syncs the result into `.meta.json`. This single change covers `completeSynthesis()`, `importStandaloneProject()`, and the legacy `synthesis_generated_at` self-heal path with zero additional call sites.
- `handleGetProject()` now prefers the cached `meta.duration_ms`; when absent but computable, it falls back to the original timestamp computation and fires a non-blocking `writeProjectMeta(..., { preserveLastUpdated: true })` self-heal write so future reads hit the fast path.
- Added a `duration` sort field to `ProjectSortField`/`SORT_FIELDS` and the sort switch in `gui/api.ts`, using a `-1` sentinel so unmeasured projects sort before measured ones.
- Added a "Duration" column and sort header to the project list GUI (`project-list.js`), rendering via the existing `formatDuration()` utility.
- Created `scripts/backfill-duration.js` — a one-time, idempotent, dry-run-capable backfill that discovers stores via `~/.ai-insights/stores.json` / `LEDGER_ROOT`, scans both flat and namespaced project layouts, and patches `.meta.json` files directly. Registered it as a hidden CLI command (`node scripts/cli.js backfill-duration`).

### Documentation Updates
- `mcp-server/docs/agents/project-manifest/api-surface.md` — documented `duration_ms` on `ProjectMeta`, `writeRootIndex()`, `writeProjectMeta()`; reconciled the previously stale `ProjectSortField`/`ProjectSummary`/`ProjectListParams`/`ProjectListEnvelope` definitions with the live code (they were missing `project`, `repository`, `runner`, `progress_pct`, `runner_counts`, `repo_counts`, and more) while adding `duration`.
- `mcp-server/docs/agents/project-manifest/data-flows.md` — updated Flow 14 (Synthesis Completion) and added a new Flow 14b (Project Duration Caching) documenting the compute/cache/self-heal/backfill pipeline end-to-end.
- `mcp-server/gui/docs/agents/project-manifest/api-surface.md` — added `duration` to the documented `sort` query parameter values.
- Root `AGENTS.md` (and its generated mirror `CLAUDE.md`) — added `scripts/backfill-duration.js` to the Root-Level Tooling table.
- Regenerated `.context/` via `node scripts/cli.js ctx-generate` so the LLM-facing snapshots reflect all manifest changes.
- Root `README.md` was not updated — it has no scripts listing table (per the plan's conditional instruction).
- `mcp-server/gui/docs/agents/project-manifest/data-flows.md` was checked but does not document the `.meta.json` sync flow, so no change was needed there.

### Verification Summary
- Tests run: `npx vitest run` (mcp-server) — full suite, 146 files / 4063 tests, all passing (includes new/extended tests in `tests/schema/project-meta.test.ts`, `tests/storage/project-meta.test.ts`, `tests/storage/ledger-store.test.ts`, `tests/tools/project-lifecycle.test.ts`, `tests/tools/standalone-import.test.ts`, `tests/gui/api.test.ts`).
- Static analysis run: `npx tsc --noEmit` (mcp-server) — zero errors. No ESLint config exists in this workspace, so `tsc --noEmit` is the project's static analysis gate.
- Script verification: `node scripts/backfill-duration.js --dry-run` and via `node scripts/cli.js backfill-duration --dry-run` against the real multi-store ledger — ran cleanly, reported plausible counts (361 backfillable, 161 skipped for no synthesis, 0 errors) without writing any files.
- Result: PASS — all acceptance criteria (AC-01 through AC-11) satisfied; no regressions detected.

### Code Insights
- [medium] (code-smell) `mcp-server/src/storage/ledger-store.ts` — ~~`writeRootIndex()`: the plan's originally specified duration-null logic (`synth <= created` returning `null`, followed by a `synth === created && runner === 'standalone'` branch) contained unreachable code — the second condition could never be true once the first already covers equality.~~  **DONE:** Implemented the corrected, non-redundant version (`synth < created` → null for skew; separate explicit check for the standalone same-session case). Verified: both branches are now reachable and covered by dedicated tests (`nulls out zero-duration standalone same-session imports`, `preserves a zero-duration for non-standalone runners`) in `ledger-store.test.ts`; full suite passes.
- [medium] (code-smell) [FIXED] `scripts/backfill-duration.js` — the quirk noted below (`.meta.json.date_created` vs `rootIndex.date_created` can legitimately diverge) initially led me to write `backfillProject()` with `meta.date_created ?? rootIndex.date_created`, preferring the meta-file value. This is wrong: for standalone imports the root index's `date_created` is deliberately derived from `plan.md`'s filesystem birthtime (see `deriveDateCreated()` in `standalone-import.ts`) and can predate `.meta.json`'s own `date_created` (stamped at import time) by days. Verified against the real `ledger-storage` store: 39 of 327 projects have a `meta`/`root` `date_created` mismatch, and the buggy version computed `duration_ms: null` for two of them (`2026-07-03-ac-misfiling-fixes-rework-1`, `2026-07-03-pm-dialogue-capture`) instead of their true durations (~290s and ~65s respectively). Fixed by preferring `rootIndex.date_created` (matching `writeRootIndex()`'s own in-server computation) with `meta.date_created` only as a last-resort fallback for the pathological case where the root index itself is malformed. Re-verified via `--dry-run` — both previously-null projects now compute nonzero durations, and the store-wide summary shows no new errors.
- [low] (convention) `mcp-server/tests/gui/api.test.ts` — the self-heal test needed to manually patch `.meta.json`'s `date_created` to match the root index override, because `writeProjectMeta()` independently stamps `date_created` from `now()` on first write rather than syncing it from the root index. This divergence has a legitimate reason to exist — see the entry above — but there is no explicit documentation of the invariant "root index date_created is authoritative for duration purposes; .meta.json's copy is a first-write timestamp, not synced afterward." Recommend adding a one-line note to the `ProjectMeta.date_created` doc comment in `project-meta.ts` and to `constraints.md` so future code (and agents) reading `.meta.json` don't repeat the mistake fixed above.
- [low] (improvement) [FIXED — 2026-08-18] `scripts/backfill-duration.js` — the script previously re-implemented light-weight project-directory discovery (flat vs. namespaced layout) instead of using the canonical `LedgerStore` scan. Per user direction, centralized this fully rather than deferring it: added `LedgerStore.listAllProjectDirs()` as the single canonical directory-discovery primitive in `mcp-server/src/storage/ledger-store.ts` (existing-file `.meta.json` check only, no content parsing), refactored `LedgerStore.listAllProjects()` to delegate to it, and created `scripts/lib/ledger-dirs.js` to load the compiled method from `mcp-server/dist/` (with the same dist-freshness rebuild guard used by `import-standalone.js`) for consumption by root-level Node scripts. Migrated all three duplicated implementations to the shared helper: `scripts/backfill-duration.js` (removed its `collectProjectDirs()`), `scripts/import-standalone.js` (`collectKnownSlugs()` now awaits `listAllProjectDirs()` instead of a manual two-level `readdirSync`), and `scripts/lib/store-commands.js` (`storeList()`, now `async`, replaced its inline scan with the same helper). Added a dedicated test suite (`describe('LedgerStore.listAllProjectDirs …')`, 5 tests) in `mcp-server/tests/storage/list-all-projects.test.ts` and documented the centralization rule in `mcp-server/docs/agents/project-manifest/constraints.md` and `api-surface.md`.
 
---

## AX Feedback
No friction encountered.

AGENT: Standalone Developer
STATUS: COMPLETE

---

## Follow-up: Centralize Project-Directory Discovery (2026-08-18)

### Trigger
User flagged the `[low] (improvement)` code insight above as too permissive given that project-directory discovery logic had already drifted across multiple independent copies (`LedgerStore.listAllProjects()`, `scripts/import-standalone.js`, `scripts/lib/store-commands.js`, `scripts/backfill-duration.js`). Requested full centralization rather than deferral.

### Changes
- **`mcp-server/src/storage/ledger-store.ts`** — Added `LedgerStore.listAllProjectDirs(ledgerRoot?)`: the canonical two-level (flat + namespaced) directory-discovery primitive, returning directory paths only (existence-checks `.meta.json`, does not parse it). Refactored `listAllProjects()` to delegate to it (read + validate `.meta.json` for each discovered directory) — behavior-preserving, confirmed by the full existing `list-all-projects.test.ts` and `project-meta.test.ts` suites passing unchanged.
- **`scripts/lib/ledger-dirs.js`** (new) — Loads the compiled `LedgerStore` from `mcp-server/dist/storage/ledger-store.js` (rebuilding `mcp-server/dist/` when stale, mirroring `import-standalone.js`'s freshness guard) and re-exports `listAllProjectDirs(storeRoot)` for root-level scripts.
- **`scripts/backfill-duration.js`** — Removed the local `collectProjectDirs()` implementation; `main()` now awaits `listAllProjectDirs(storePath)` from the shared helper.
- **`scripts/import-standalone.js`** — `collectKnownSlugs()` is now `async` and delegates directory discovery to `listAllProjectDirs()` instead of manually walking `LEDGER_ROOT` with `readdirSync`.
- **`scripts/lib/store-commands.js`** — `storeList()` is now `async`; its per-store project count is computed via `listAllProjectDirs(absPath).length` instead of an inline nested `readdirSync` scan. `scripts/cli.js`'s `cmdStore()` was made `async` and now `await`s the `list` subcommand's `storeList()` call.
- **Tests** — Added a new `describe('LedgerStore.listAllProjectDirs …')` block (5 tests: mixed-layout discovery, existence-only `.meta.json` check, dot-prefix exclusion at both depths, non-existent root, and shared-logic parity with `listAllProjects()`) to `mcp-server/tests/storage/list-all-projects.test.ts`. Updated `scripts/tests/store-commands.test.js`'s `storeList` test cases to `async`/`await` for the new Promise-returning signature.
- **Docs** — Documented the centralization rule ("never re-implement depth-1/depth-2 layout detection outside `LedgerStore.listAllProjectDirs()`") in `mcp-server/docs/agents/project-manifest/constraints.md`, updated `api-surface.md` with the new method's contract, and added/updated the `scripts/backfill-duration.js` and `scripts/lib/ledger-dirs.js` rows in the root `AGENTS.md` tooling table (synced to `CLAUDE.md` and `.context/` via `node scripts/cli.js ctx-generate`).

### Verification
- `mcp-server`: `npx tsc --noEmit` — clean. `npx vitest run tests/storage/` — 376/376 passing (371 pre-existing + 5 new). Full suite `npx vitest run` — 3971/4068 passing; the 97 failures are pre-existing `gui/server-*.test.ts` failures (`server.close` undefined) confirmed present on the unmodified base branch via `git stash` — unrelated to this change.
- Root: `npx vitest run scripts/tests/store-commands.test.js` — 35/35 passing. Full `scripts/tests/` run shows 2 unrelated pre-existing failures (`ledger-plugin.test.js`, `build-personas-model-resolution.test.js`) confirmed present on the base branch.
- End-to-end smoke tests against the real multi-store ledger: `node scripts/backfill-duration.js --dry-run` (525 projects scanned across 3 stores, consistent with the pre-refactor run), `node scripts/import-standalone.js --batch --dry-run` (correctly recognized already-imported slugs), and `node scripts/cli.js store list` (correct repo/project counts for all 3 configured stores).

### Additional Comments
No new code insights beyond what's documented above — this follow-up fully resolves the flagged item with no remaining duplication of ledger project-directory discovery logic in the workspace.
