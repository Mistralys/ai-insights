# Plan

## Plan Audit Cycles
- Audits: 3 — Plan Auditor v1.9.2. Cycle 1 (2026-09-18): **PASS WITH FINDINGS** — 0 Critical / 2 Major / 1 Minor; all three integrated (step 6 self-heal gated on `synthesis_generated_at`, step 4 → step 3 dependency edge recorded, AC-07 test mapping clarified). Cycle 2 (2026-09-18, `audit.md`): **FAIL** — 1 Critical / 0 Major / 1 Minor; both integrated (the project-reset Risk row corrected — `applyProjectReset()` clears `synthesis_generated_at`, so the self-heal gate stays closed and the cached figures persist until re-synthesis, accepted as documented parity with `duration_ms`; `clearSynthesisState()` added to the research brief). Cycle 3 (2026-09-18, `audit.md`): **PASS** — 0 Critical / 0 Major / 0 Minor; plan audit-clean.
- Architectural Reviews: 1 — Plan Architect Reviewer v2.3.2 (2026-09-18, `design-review.md`): **Sound Design** — 6 decisions reviewed, Confirm 6 / Challenge 0 / Reconsider 0; no rework required, plan content unchanged.

## Prior Project Context

The repository's short-term strategic goal is minimal friction in daily usage. A project-list column showing a figure the user has learned to distrust — and which is blank for 93 % of rows in the `mistralys` store — is exactly that kind of friction.

The prior project `2026-08-18-project-duration-field` built everything this plan extends: the `.meta.json` `duration_ms` cache, the list column, the `duration` sort key, the detail-view self-heal, and `scripts/backfill-duration.js`. It was executed **standalone** by a single developer session, and it was strictly larger than this plan (it created all of that from nothing). Two lessons from its synthesis carry forward: `rootIndex.date_created` is authoritative over the `.meta.json` copy, and project-directory discovery in root-level scripts must go through `scripts/lib/ledger-dirs.js` rather than a local reimplementation.

Three stored insights shaped the design: `dd78cc67` (`writeProjectMeta()` two-phase spread — `'key' in cacheUpdates` for nullable fields, `!== undefined` for non-nullable), `8f882784` (leave `handleListProjects`'s inline `repository_name` derivation alone — it is deliberately not `deriveRepoName()`), and `53454e24` (run `ctx-generate` after any project-manifest edit). Global insight `ee66370f` motivates the consumer sweep in step 11: repointing the meaning of the `duration` sort key across layers is the class of change where a stale test mirror gives false confidence.

## Summary

The "Duration" column in the GUI project list is not miscalculating anything — it renders `.meta.json`'s `duration_ms`, which is deliberately wall-clock (`synthesis_generated_at − date_created`). For `2026-09-16-ledger-project-declaration` that is 59,971,000 ms = 16 h 39 m, verified on disk. The detail page's "Active: 2h 39m across 75 pipeline runs" is a different metric — the sum of `duration_ms` across every completed pipeline in every work package, verified by re-summation as 9,549,000 ms across 75 runs. The active figure is the one that reflects real work, but today it exists only inside `handleGetProject`, which derives it by reading every work-package file — far too expensive for the project list, which is deliberately a `.meta.json`-only reader. This plan caches the active figure in `.meta.json` at the one moment it becomes final — synthesis completion — has the detail view lazily heal any project that predates the change or was otherwise missed, extends the existing backfill script to populate it (and the still-largely-unpopulated `duration_ms`) across the whole fleet, and repoints the list column and its sort onto the cached active value with wall-clock demoted to a tooltip. The detail page's wall-clock label is renamed "Elapsed" so the word "Duration" no longer denotes two different quantities across two views.

## Architectural Context

**Storage (`mcp-server/src/storage/ledger-store.ts`).** Project-level derived values are pushed into `.meta.json` through `writeProjectMeta()` (L538–612), which merges a `MetaCacheUpdates` object over the existing file using a two-phase spread — `'key' in cacheUpdates` for nullable fields, `!== undefined` for non-nullable ones. `writeRootIndex()` (L274–309) is the existing computation site for `duration_ms`: it derives the wall-clock gap whenever `synthesis_generated_at` is set and hands it to `writeProjectMeta()`. Crucially, `writeRootIndex()` runs on **every** work-package write and holds the project lock, so it may not perform fan-out file reads.

**Synthesis (`mcp-server/src/tools/project-lifecycle.ts` L814–927).** `completeSynthesis()` already acquires `withLock(store.storageDir)`, reads the root index, applies the four §19.1 guards, sets `synthesis_generated_at` / `status: 'COMPLETE'`, and calls `store.writeRootIndex(rootIndex)` directly — it is one of the documented approved direct callers. It is a once-per-project code path, which makes it the only place where reading every WP file is affordable.

**Pipeline durations (`mcp-server/src/tools/pipeline.ts`).** `ledger_complete_pipeline` sets `pipeline.duration_ms = completed_at − started_at` (L468–476). `ledger_cancel_pipeline` sets only `completed_at` (L705) — cancelled runs carry no duration and are excluded from any sum by construction.

**GUI (`mcp-server/gui/api.ts`).** `handleListProjects` is strictly `.meta.json`-only — it spreads the whole meta object into each `ProjectSummary` (L443–456), so a new cache field reaches the frontend with no plumbing. `handleGetProject` already reads every WP file and sums pipeline durations into `timing.total_active_ms` / `timing.pipeline_runs` (L640–665), and is the established home for non-blocking cache self-heal using `{ preserveLastUpdated: true }` (L686–693) so a cache refresh does not distort list sort order.

**Frontend.** `project-list.js` renders the column at L232/L241 and declares the sort header at L261; `project-detail.js` renders both timing figures at L713–719 and live-refreshes `#timing-duration` at L383–386. All durations render through `formatDuration()` in `gui/public/utils.js` (L162–174). Plain browser JS, no build step.

**Field state on disk (verified across the `mistralys` store, 350 projects).** 25 have `duration_ms`; 325 do not. Of 348 terminal projects, 323 have no cached duration at all — the prior backfill appears to have been run only in `--dry-run` mode. Both in-progress projects have no duration, confirming that the column is blank during a run by design: `duration_ms` is only ever computed once `synthesis_generated_at` exists.

## Approach / Architecture

1. **One new derivation helper.** `computeWpActiveMs(wp)` in `workflow-helpers.ts` returns `{ active_ms, pipeline_runs }` by summing `duration_ms` over `wp.pipelines`. Cancelled runs are excluded automatically because they carry no duration.
2. **Cache at synthesis.** `completeSynthesis()` — already inside the lock, already a once-per-project path — reads the WP details, sums them with the helper, and writes `active_ms` / `pipeline_runs` into `.meta.json`. This mirrors exactly when `duration_ms` is computed today, so the two fields appear and disappear together.
3. **Heal everything else lazily.** `handleGetProject` already computes the authoritative figure from the WP files; it writes the result back into `.meta.json` whenever the cached values are absent or disagree, gated on `rootIndex.synthesis_generated_at` exactly as the existing `duration_ms` self-heal is. This covers projects that predate the change and any synthesised project the backfill missed. An unsynthesised project is left uncached, which is what keeps the column synthesis-gated — and, because a project reset clears `synthesis_generated_at`, a reset project is left uncached too, retaining whatever was cached before the reset until it is re-synthesised (see Risks).
4. **Backfill the fleet.** `scripts/backfill-duration.js` gains an active-time pass alongside its existing wall-clock pass, so the ~325 projects with no cached duration get both fields in one run.
5. **Display.** The list column renders `active_ms`, and the `duration` sort key sorts on the same value — what is sorted must be what is shown. Wall-clock `duration_ms` stays in the payload and surfaces as the cell tooltip. The detail page renames its wall-clock label to "Elapsed".

`writeRootIndex()`, `WorkPackageSummarySchema`, and the three `passed_stages` sync sites are **not** touched.

## Rationale

The expensive part of active time is the fan-out read of every work-package file, so the design question is only ever *where that read is affordable*. There are exactly two such places: synthesis completion, which happens once per project and already holds the lock, and the detail endpoint, which already performs the read for its own display. Putting the computation in both — one as the primary write, one as the corrective — covers every project without adding a single file read to the hot paths (`writeRootIndex`, `handleListProjects`).

Caching at synthesis rather than incrementally on every work-package write is what keeps this small, and the on-disk evidence says nothing is lost by it: `duration_ms` is already synthesis-gated, so the column is blank during a run today. Matching that behaviour is parity, not a compromise. Incremental maintenance would require a root-index schema change, three sync sites, and a guard against legacy root indexes zeroing the cache — real complexity bought solely to make a column tick upward mid-run, which is new capability rather than the reported defect.

The nullable `active_ms` exists so both write paths can *clear* a value rather than only set one: a synthesised project whose pipelines carry no measured duration must show an em dash, not `0` (AC-05, AC-07). Per insight `dd78cc67` that requires `'key' in cacheUpdates` semantics.

The label change is not polish. Two views currently use "Duration" for two different quantities, which is the direct cause of the reported confusion; renaming the wall-clock figure to "Elapsed" removes the collision rather than papering over it.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Where active time is computed | At synthesis completion, plus a lazy self-heal in the detail endpoint | (a) Mirror `active_ms` onto each root-index WP summary at the three `passed_stages` sync sites and sum in `writeRootIndex()`; (b) recompute in `handleListProjects` | (a) buys a live-updating column during a run, at the cost of a root-index schema change, three sync sites, and a legacy-zeroing guard — and the column is blank during a run today anyway, so it is new capability, not the fix. (b) turns a 350-row list into thousands of file reads per request, destroying the list endpoint's design premise. |
| Coverage for pre-existing projects | Batch backfill script **and** detail-view self-heal | (a) Backfill only; (b) self-heal only | (a) leaves any synthesised project the script misses permanently wrong. (b) leaves ~325 rows blank until each project is opened by hand. The two together give immediate fleet-wide coverage plus ongoing self-correction. |
| Fate of the wall-clock figure in the list | Keep `duration_ms` in the payload, show it as the cell tooltip | (a) Add a second "Elapsed" column; (b) drop wall-clock from the list | (a) costs horizontal space in an already ten-column table for a number explicitly called misleading. (b) discards an occasionally useful datum (calendar span) at zero storage cost. |
| Meaning of the `duration` sort key | Repoint it to `active_ms`, keeping the key name | (a) New `active_duration` key, leaving `duration` on wall-clock | A sort key must order the column it heads, or the table lies on click. Keeping one key avoids a second `ProjectSortField` member and a second documented query value for a column that does not exist; bookmarked `?sort=duration` URLs keep working. |
| Nullability of the new fields | `active_ms` nullable, `pipeline_runs` non-nullable | Both non-nullable | The self-heal must be able to clear a stale value, which requires nullable + `'key' in cacheUpdates` (insight `dd78cc67`). `pipeline_runs` is only ever written alongside it and takes the simpler `!== undefined` path. |

## Pattern Alignment

- **Enrichment cache field** — follows `duration_ms` / `progress_pct` in `.meta.json` (`mcp-server/src/schema/project-meta.ts`; `ledger-store.ts` L281–307): optional, nullable where clearable, backward-compatible by absence.
- **Two-phase spread semantics** — follows the documented rule on `MetaCacheUpdates.title` and insight `dd78cc67`.
- **Derivation helper location** — follows `computePassedStages` / `computeProjectProgress` in `mcp-server/src/utils/workflow-helpers.ts` (L538, L566).
- **Synthesis-gated computation** — follows the existing `duration_ms` rule: a project-level duration figure exists only once `synthesis_generated_at` is set.
- **Non-blocking self-heal with `preserveLastUpdated`** — follows the existing `duration_ms` self-heal in `handleGetProject` (`mcp-server/gui/api.ts` L686–693).
- **List endpoint stays `.meta.json`-only** — follows `handleListProjects`'s existing contract; this plan adds no file reads there.
- **Duration rendering** — follows the single `formatDuration()` helper (`gui/public/utils.js` L162).
- **Backfill script scope** — follows `scripts/backfill-duration.js`'s existing behaviour: `.meta.json`-only patching, idempotent, `--dry-run`/`--verbose`, discovery via `scripts/lib/ledger-dirs.js`.
- **Deliberate departure — the `duration` sort key changes meaning.** No existing pattern covers repointing a public query-parameter value. Justified above: a sort key that does not order its own column is a defect, and the column is the thing being fixed. Documented in `mcp-server/gui/docs/agents/project-manifest/api-surface.md` (L58) and the module changelog.
- **Deliberate departure — the detail page's "Duration" label becomes "Elapsed".** The element id `#timing-duration` and its documented contract (`project-detail.js` L31) stay unchanged so the live-refresh path at L383–386 is untouched; only the visible label moves.

## Structural Improvements

| Structure | Observation | Decision | Reason |
|-----------|-------------|----------|--------|
| `mcp-server/gui/api.ts` L655–665 | The active-time summation is an inline loop that will now have a second caller in `completeSynthesis()`. | Promoted to step 2 + step 4 | Extracting `computeWpActiveMs()` means one definition of "active time" rather than two that can drift. Both sites are edited by this plan regardless. |
| `mcp-server/gui/public/views/project-detail.js` L713–719 | "Duration" (wall-clock) and "Active" (pipeline time) sit side by side, and "Duration" is the word the list column uses for a different quantity. | Promoted to step 8 | The naming collision is the proximate cause of the reported confusion, and the plan is already editing this block. |
| `scripts/backfill-duration.js` — `duration_ms` skip condition (L89) | The script currently skips a project outright once `duration_ms` is non-null, which would also skip populating the new fields. | Promoted to step 9 | Without splitting the skip into two independent per-field checks, the 25 projects that already have `duration_ms` would never receive `active_ms`. A correctness requirement of this plan, not an optional cleanup. |
| `mcp-server/src/storage/ledger-store.ts` L371 / L427 / L495 — triplicated `passed_stages` sync | A hand-maintained triplicate; a future derived field would need three more near-identical lines. | Rejected | Option A adds no per-WP derived field, so these three sites are outside this plan's blast radius. Consolidating them here would be an unfunded refactor of the most safety-critical write path in the store. |
| `mcp-server/gui/public/views/work-package.js` L84–86 | Client-side per-WP active-time sum — a third copy of the same arithmetic. | Rejected | Runs in the browser against a fetched WP detail and cannot import a server-side TypeScript helper without a build step this project does not have. |
| `scripts/backfill-duration.js` name and CLI registration | The name is `duration`-specific while the script will populate three fields. | Rejected | The command is registered in `scripts/cli.js` (L1124) and documented in root `AGENTS.md`; renaming a documented CLI verb for a label improvement is churn without behavioural gain. Its description string is updated instead (step 10). |
| `mcp-server/gui/api.ts` L432–441 `repository_name` derivation | Sits inside `handleListProjects`, which this plan edits. | Rejected | Insight `8f882784` records that the inline, non-`deriveRepoName()` form is deliberate — it preserves display casing. Explicitly left untouched. |

## Detailed Steps

1. **Extend `ProjectMetaSchema`** (`mcp-server/src/schema/project-meta.ts`) with `active_ms: z.number().int().nonnegative().nullable().optional()` and `pipeline_runs: z.number().int().nonnegative().optional()`, documented as the project-wide sum of completed-pipeline durations and the count of those runs — explicitly distinct from the wall-clock `duration_ms`, and absent (not zero) when never measured.

2. **Add the derivation helper.** In `mcp-server/src/utils/workflow-helpers.ts`, beside `computePassedStages`, add `computeWpActiveMs(wp: WorkPackageDetail): { active_ms: number; pipeline_runs: number }` — sums `duration_ms` over `wp.pipelines`, counting only pipelines that carry one. JSDoc states that cancelled pipelines have no `duration_ms` and are therefore excluded by construction.

3. **Extend `MetaCacheUpdates`.** In `mcp-server/src/storage/ledger-store.ts` (type at L28 and the two-phase spread in `writeProjectMeta()`), add `active_ms?: number | null` using `'key' in cacheUpdates` semantics and `pipeline_runs?: number` using `!== undefined` semantics, plus the matching preserve-existing entries. Update the `writeProjectMeta()` JSDoc field list. `writeRootIndex()` is not modified.

4. **Cache at synthesis.** In `completeSynthesis()` (`mcp-server/src/tools/project-lifecycle.ts` L885–894), after the existing `await store.writeRootIndex(rootIndex)` and still inside the lock: read each WP detail via `store.readWorkPackage(summary.work_package_id)` (a per-WP read failure is skipped, never fatal — synthesis must not fail because one WP file is unreadable), accumulate with `computeWpActiveMs()`, and call `store.writeProjectMeta('', undefined, { active_ms, pipeline_runs }, { preserveLastUpdated: true })`. Write `active_ms: null` when `pipeline_runs` is 0 so a project with no measured runs shows an em dash rather than `0`. Add a comment noting this is the one affordable fan-out read point and that `writeRootIndex()` is deliberately not used for it.

5. **Use the shared helper in the detail endpoint.** In `mcp-server/gui/api.ts` `handleGetProject` (L655–665), replace the inline summation loop with `computeWpActiveMs()` accumulated across the loaded WP details. `timing.total_active_ms` and `timing.pipeline_runs` keep their current meaning and shape.

6. **Self-heal the cache.** Still in `handleGetProject`, after computing the authoritative figures, compare them against `meta.active_ms` / `meta.pipeline_runs`; when they differ **and** `rootIndex.synthesis_generated_at` is set, fire the existing non-blocking pattern — `store.writeProjectMeta('', undefined, { active_ms, pipeline_runs }, { preserveLastUpdated: true }).catch(() => {})`. When `pipeline_runs` is 0, pass `active_ms: null` so a stale value is cleared. The `synthesis_generated_at` gate mirrors the existing `duration_ms` self-heal at L689 and is what holds the two fields to one lifecycle: a project that has not synthesised caches neither figure, so the list column stays blank for it exactly as it does today. This is the path that covers projects predating this change and any synthesised project the backfill missed; `timing.total_active_ms` is still returned to the detail view for unsynthesised projects — only the cache write is withheld. Note that a project put through `applyProjectReset()` has `synthesis_generated_at` cleared, so this gate holds it closed and its previously cached figures persist unchanged until re-synthesis — accepted parity with `duration_ms` (see Risks).

7. **Repoint the list sort.** In `mcp-server/gui/api.ts`, change the `'duration'` sort case (L553–557) to sort on `a.active_ms ?? -1`, keeping the `-1` sentinel and updating its comment to say "active duration". `active_ms` and `pipeline_runs` reach `ProjectSummary` automatically via the existing `...meta` spread — no change at L443–456, and the `repository_name` derivation above it is left exactly as-is.

8. **Update the frontend.**
   - `mcp-server/gui/public/views/project-list.js` L232/L241 — render `p.active_ms` via `formatDuration()`, em dash when null or absent; give the `<td>` a `title` attribute carrying `'Elapsed (wall-clock): ' + formatDuration(p.duration_ms)`, omitted when `duration_ms` is absent. The header at L261 keeps `thSort('Duration', 'duration')`.
   - `mcp-server/gui/public/views/project-detail.js` L713–719 — change the visible wall-clock label from `Duration:` to `Elapsed:`; leave the `#timing-duration` element id, the `Active:` segment, and the L383–386 refresh path untouched. Update the element-contract comment at L31 to describe the new label.

9. **Extend the backfill.** In `scripts/backfill-duration.js`:
   - Split the current all-or-nothing skip (L89) into two independent per-field decisions, so a project that already has `duration_ms` is still processed for `active_ms` / `pipeline_runs`.
   - Add an active-time pass: resolve each WP detail path from the root index's `work_packages[].file`, read and sum `duration_ms` across pipelines (unreadable or malformed WP files are skipped with a `--verbose` note, never failing the project), and patch both fields into `.meta.json`. Write `active_ms: null` when no runs carry a duration.
   - Keep everything else intact: `.meta.json`-only writes, idempotency, `--dry-run` / `--verbose`, `rootIndex.date_created` preference for the wall-clock computation, and directory discovery via `listAllProjectDirs()` from `scripts/lib/ledger-dirs.js` (never a local reimplementation).

10. **Update the CLI description.** In `scripts/cli.js` (L1124), widen the `backfill-duration` description to cover the active-time fields. The command name is unchanged.

11. **Consumer sweep.** Grep `duration_ms` across `mcp-server/src`, `mcp-server/gui`, `mcp-server/tests`, `scripts/`, and `orchestrator/` for any consumer of a project-level duration that would now read the wrong figure, and for any test that mirrors the sort or summation logic instead of importing it.

12. **Run the backfill for real.** `node scripts/cli.js backfill-duration --dry-run` first, then a real run, across all three configured stores (`ledger`, `mistralys`, `nexus`). Confirm the ~325 projects lacking `duration_ms` receive both fields, and spot-check `2026-09-16-ledger-project-declaration` against the independently verified figures (`active_ms` 9,549,000; `pipeline_runs` 75).

13. **Documentation** — see the Documentation Updates section.

## Dependencies

- Steps 3 and 4 depend on steps 1 and 2.
- Step 4 additionally depends on step 3: its `writeProjectMeta()` call passes `active_ms` / `pipeline_runs`, which exist on `MetaCacheUpdates` only after step 3 adds them. Steps 3 and 4 are therefore sequential, not parallel.
- Steps 5 and 6 depend on step 2; step 6 also depends on step 3.
- Steps 7 and 8 depend on step 1 (the field must exist before the UI reads it) and are best verified after step 12 has populated data.
- Step 12 depends on steps 9–10 and on a rebuilt `mcp-server/dist/` (the script's own freshness guard handles this).
- Step 11 (consumer sweep) depends on steps 5–10 being settled — it sweeps for consumers of the figures those steps repoint — and is run last among the code steps.
- Documentation (step 13) depends on all code steps being settled.

## Required Components

Existing, modified:
- `mcp-server/src/schema/project-meta.ts`
- `mcp-server/src/utils/workflow-helpers.ts`
- `mcp-server/src/storage/ledger-store.ts`
- `mcp-server/src/tools/project-lifecycle.ts`
- `mcp-server/gui/api.ts`
- `mcp-server/gui/public/views/project-list.js`
- `mcp-server/gui/public/views/project-detail.js`
- `scripts/backfill-duration.js`
- `scripts/cli.js`
- `mcp-server/tests/schema/project-meta.test.ts`, `mcp-server/tests/utils/workflow-helpers.test.ts`, `mcp-server/tests/storage/project-meta.test.ts`, `mcp-server/tests/tools/project-lifecycle.test.ts`, `mcp-server/tests/gui/api.test.ts`
- `mcp-server/docs/agents/project-manifest/api-surface.md`, `mcp-server/docs/agents/project-manifest/data-flows.md`
- `mcp-server/gui/docs/agents/project-manifest/api-surface.md`
- `AGENTS.md`, `CLAUDE.md`, `mcp-server/changelog.md`, `changelog.md`, `.context/`

New:
- `scripts/tests/backfill-duration.test.js` — Vitest spec for the extended backfill script, following the existing root-script suite convention (`scripts/tests/store-commands.test.js` et al.).

No new external services, dependencies, or infrastructure. No root-index schema change.

## Assumptions

- "Active" means what the detail page already labels Active: the sum of completed-pipeline wall-clock spans. Cancelled runs (no `duration_ms`) are excluded, which is the status quo.
- Overlapping pipelines are not a practical concern — the ledger workflow runs one pipeline at a time per project, so summation does not double-count.
- Parity with today's synthesis-gated behaviour is acceptable: the column stays blank for a project that has not yet synthesised, exactly as it is today. Both write paths enforce this — step 4 fires only at synthesis completion, and step 6's self-heal carries the same `synthesis_generated_at` gate as the existing `duration_ms` self-heal.
- Parity extends to the reset case as a known limitation, not as a solved one: because `applyProjectReset()` clears `synthesis_generated_at`, neither `active_ms` nor the pre-existing `duration_ms` is refreshed or cleared for a reset project until it is re-synthesised. The two fields stay wrong together and become right together, which is the behaviour `duration_ms` already has today.
- Standalone-imported projects (a synthetic WP-001 with no pipelines) correctly show an em dash rather than a fabricated figure — matching how `duration_ms` is already nulled for same-session imports.
- The GUI and MCP server are the only consumers of a project-level duration; the orchestrator emits its own per-stage `duration_s` in run logs and is unaffected — to be confirmed by step 11's sweep.

## Constraints

- `handleListProjects` must not read any file other than `.meta.json` per project.
- `writeRootIndex()` and `writeProjectMeta()` run inside the project lock on every WP write and must perform no additional reads — which is why the fan-out read lives in `completeSynthesis()`, a once-per-project path.
- The new meta fields must be `.optional()`; every existing `.meta.json` on disk lacks them, and absence must read as "not measured", never as zero.
- A per-WP read failure during synthesis must never fail the synthesis call.
- `scripts/backfill-duration.js` must remain idempotent, `--dry-run`-capable, stdlib-only, cross-platform, and must write nothing except `.meta.json`.
- Frontend code is plain browser JS (`var`, no build step, no modules).
- `CLAUDE.md` is a generated mirror of `AGENTS.md`; `.context/` must be regenerated after manifest edits (insight `53454e24`).
- A pre-existing suite of `gui/server-*.test.ts` failures (`server.close` undefined) is known; capture a baseline run before attributing any failure to this work.

## Out of Scope

- Incremental per-work-package maintenance of active time (the rejected Option B) and any root-index schema change.
- Consolidating the three `passed_stages` sync sites in `ledger-store.ts`.
- Unifying the browser-side active-time sum in `gui/public/views/work-package.js` with the server-side helper.
- Any change to how per-pipeline `duration_ms` is produced, or giving cancelled pipelines a duration.
- Excluding idle gaps *within* a pipeline run — active time remains a sum of pipeline wall-clock spans.
- Adding a second, separately sortable "Elapsed" column to the project list.
- Renaming the `backfill-duration` CLI command or the `duration` sort key.
- Clearing cached duration fields at project-reset time. `applyProjectReset()` already clears `synthesis_generated_at`, leaving both `active_ms` and `duration_ms` fossilised until re-synthesis; fixing that is a pre-existing `duration_ms` gap and new capability, not this plan's reported defect.
- Any change to orchestrator run-log timing or the statistics/strategy views.

## Acceptance Criteria

- AC-01: `ProjectMetaSchema` accepts and round-trips `active_ms` (number or null) and `pipeline_runs`, and still validates meta documents omitting both.
- AC-02: `computeWpActiveMs()` returns the sum of pipeline `duration_ms` and the count of pipelines carrying one, returning `{ active_ms: 0, pipeline_runs: 0 }` for a WP with no pipelines or no durations.
- AC-03: `ledger_complete_synthesis` writes `active_ms` and `pipeline_runs` into `.meta.json`, equal to the sum across all work packages, without altering `last_updated`.
- AC-04: A work package whose detail file is unreadable does not fail `ledger_complete_synthesis`; the remaining work packages are still summed.
- AC-05: `completeSynthesis` writes `active_ms: null` when no pipeline in the project carries a duration.
- AC-06: `handleGetProject` returns the same `timing.total_active_ms` / `timing.pipeline_runs` values as before the change for a project with pipelines.
- AC-07: For a project with `synthesis_generated_at` set, `handleGetProject` writes corrected `active_ms` / `pipeline_runs` into `.meta.json` when the cached values are absent or disagree with the work-package files, without altering `last_updated`, and clears `active_ms` to null when the project has no measured runs. For a project without `synthesis_generated_at`, it writes nothing to `.meta.json` while still returning the computed `timing` figures.
- AC-08: `handleListProjects` returns `active_ms` and `pipeline_runs` on each `ProjectSummary` without reading any work-package file or root index.
- AC-09: `sort=duration` orders projects by `active_ms`, with unmeasured projects sorting before measured ones in ascending order.
- AC-10: The project-list Duration cell renders the active figure, shows an em dash when absent, and carries a tooltip with the wall-clock elapsed value when `duration_ms` is present.
- AC-11: The project-detail info card labels the wall-clock figure "Elapsed" and still shows "Active: … across N pipeline runs"; the live-refresh path still updates the elapsed value in place.
- AC-12: `scripts/backfill-duration.js` populates `active_ms` and `pipeline_runs` for pre-existing projects, including projects that already have `duration_ms`; is idempotent across repeat runs; and writes nothing under `--dry-run`.
- AC-13: After the backfill run, `2026-09-16-ledger-project-declaration` reports `active_ms: 9549000` and `pipeline_runs: 75`, and its list row shows "2h 39m"; the ~325 previously-blank projects show a duration.
- AC-14: `npx tsc --noEmit` is clean and the `mcp-server` Vitest suite shows no failures beyond the documented pre-existing baseline.

## Testing Strategy

Four layers, matching where the logic lives. A schema test confirms the new optional fields parse and round-trip both present and absent. A focused unit test covers the derivation helper in isolation, including the empty and all-cancelled cases. Tool and storage tests drive the real `completeSynthesis` and `writeProjectMeta` against a temp-directory ledger and assert what lands in `.meta.json`, including the unreadable-WP tolerance and the null-clearing path. GUI API tests exercise `handleGetProject` (recomputation, self-heal, no `last_updated` drift) and `handleListProjects` (payload passthrough, sort ordering) using the existing `createProject` fixture helper. The backfill script gets a dedicated spec against a temp store, plus a `--dry-run` rehearsal on the three real stores and a spot-check of the independently verified project. Frontend rendering is verified manually — the project-list and project-detail views have no automated rendering harness in this project.

## Test Plan

- `mcp-server/tests/schema/project-meta.test.ts` — `ProjectMetaSchema` accepts `active_ms` as a number and as null, accepts `pipeline_runs`, and still validates a meta document omitting both — AC-01
- `mcp-server/tests/utils/workflow-helpers.test.ts` — `computeWpActiveMs()` sums durations and counts runs; returns zeros for a WP with no pipelines; ignores pipelines lacking `duration_ms` (cancelled) — AC-02
- `mcp-server/tests/tools/project-lifecycle.test.ts` — `ledger_complete_synthesis` writes `active_ms` / `pipeline_runs` matching the sum across all WPs, and leaves `last_updated` unchanged — AC-03
- `mcp-server/tests/tools/project-lifecycle.test.ts` — synthesis succeeds and sums the remaining WPs when one WP detail file is unreadable — AC-04
- `mcp-server/tests/tools/project-lifecycle.test.ts` — synthesis on a project whose pipelines carry no durations writes `active_ms: null` — AC-05
- `mcp-server/tests/storage/project-meta.test.ts` — `writeProjectMeta()` clears `active_ms` when passed an explicit null, preserves it when the key is absent, and applies `pipeline_runs` under `!== undefined` semantics — AC-01 (round-trip through the storage layer); supporting infrastructure for AC-03/AC-05/AC-07, which depend on these spread semantics but are each verified at their own layer below
- `mcp-server/tests/gui/api.test.ts` — `handleGetProject` returns unchanged `timing.total_active_ms` / `timing.pipeline_runs` for a project with completed pipelines — AC-06
- `mcp-server/tests/gui/api.test.ts` — sole direct verification of AC-07: `handleGetProject` self-heals absent and stale `.meta.json` `active_ms` / `pipeline_runs` without bumping `last_updated`, writes null for a project with no measured runs, and writes nothing at all for a project lacking `synthesis_generated_at` while still returning its `timing` figures — AC-07
- `mcp-server/tests/gui/api.test.ts` — `handleListProjects` surfaces `active_ms` / `pipeline_runs` on each summary — AC-08
- `mcp-server/tests/gui/api.test.ts` — `sort=duration dir=asc` orders by `active_ms` with unmeasured projects first (extends the existing L1081 test rather than duplicating it) — AC-09
- `scripts/tests/backfill-duration.test.js` — against a temp store: populates both fields; is a no-op on a second run; still processes a project that already has `duration_ms`; tolerates an unreadable WP file; writes nothing under `--dry-run` — AC-12
- Manual GUI verification — list Duration cell shows the active figure, em dash when absent, wall-clock tooltip on hover; detail card shows "Elapsed" and "Active"; live refresh still updates the elapsed value — AC-10, AC-11
- Manual store verification — `node scripts/cli.js backfill-duration --dry-run` then a real run across all three stores; confirm `2026-09-16-ledger-project-declaration` reports 9,549,000 ms / 75 runs and renders "2h 39m", and that previously-blank rows are populated — AC-13
- Gate commands — `npx tsc --noEmit` and `npx vitest run` in `mcp-server/`, compared against a pre-change baseline — AC-14

## Documentation Updates

- `mcp-server/docs/agents/project-manifest/api-surface.md` — document `active_ms` / `pipeline_runs` on `ProjectMeta` (~L2861) and `MetaCacheUpdates` (~L2069), the new `computeWpActiveMs()`, the extended `completeSynthesis` contract, and the revised `'duration'` sort semantics plus `handleGetProject` self-heal (~L4909–4926).
- `mcp-server/docs/agents/project-manifest/data-flows.md` — extend Flow 14 (Synthesis Completion, ~L1228) with the active-time cache write, and Flow 14b (Project Duration Caching, ~L1250–1271) with the two cached metrics, the self-heal, the backfill, and the fact that the list column now renders and sorts on the active figure while wall-clock moves to a tooltip.
- `mcp-server/gui/docs/agents/project-manifest/api-surface.md` L58 — note that the `duration` sort value orders by active duration; add the new `ProjectSummary` fields where that shape is documented.
- `AGENTS.md` — Root-Level Tooling row for `scripts/backfill-duration.js`: record that it backfills `active_ms` / `pipeline_runs` in addition to `duration_ms`, reads WP detail files to do so, and still writes only `.meta.json`. Sync into `CLAUDE.md`.
- `mcp-server/changelog.md` — new entry (house style: flat bullets, category prefixes, ≤ 100 chars) covering the schema field, the synthesis-time cache, the GUI column/sort change, the detail relabel, and the extended backfill.
- `changelog.md` (root) — a summarising entry with the `> mcp vX` module reference line, per the two-step workflow.
- `node scripts/cli.js check-versions` — confirm module/package version sync after the changelog bump.
- `node scripts/cli.js ctx-generate` — regenerate `.context/` after the manifest edits (insight `53454e24`).

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **The backfill misreads or skips work-package files and caches a too-low `active_ms`** | Per-file failures are skipped with a `--verbose` note rather than silently zeroing (step 9); `--dry-run` is rehearsed across all three stores before the real run; the known-good project is spot-checked against independently verified figures (AC-13); and any cached value is later corrected by the authoritative detail-view self-heal. |
| **Users read the repointed Duration column as the old wall-clock figure** | Wall-clock stays one hover away as a tooltip, the detail relabel to "Elapsed" removes the word collision, and both changelogs state that the column's meaning changed. |
| **Bookmarked or scripted `?sort=duration` URLs silently change ordering** | Documented in the GUI manifest (L58) and the module changelog; the key is retained rather than renamed, so no URL breaks — only the ordering basis moves to the figure actually displayed. |
| **Reading every work-package file slows down or destabilises synthesis** | It is a once-per-project path already holding the lock, reading files the synthesis agent has just finished writing; failures are non-fatal (AC-04). For scale reference, the largest verified project has 16 work packages. |
| **A project reset after synthesis leaves a fossilised `active_ms`** | **Accepted, documented limitation — identical to the existing `duration_ms` behaviour.** `applyProjectReset()` (`mcp-server/src/utils/project-reset.ts` L466, the path `gui/api.ts` L1086 calls) invokes `clearSynthesisState()` (`mcp-server/src/utils/workflow-helpers.ts` L87–90), which sets `synthesis_generated_at = null`. That closes the step-6 self-heal gate, so the previously cached `active_ms` / `pipeline_runs` — and the pre-existing `duration_ms` alongside them — stay fossilised in `.meta.json` until the project is re-synthesised, at which point step 4 overwrites all of them correctly. Clearing the cache at reset time is deliberately **not** added here: `duration_ms` has carried this exact gap since it shipped, and closing it is new capability beyond this plan's scope (see Out of Scope). The nullable `active_ms` still earns its keep via AC-05/AC-07's no-measured-runs path. |
| **New failures are attributed to this work when they are pre-existing** | Capture an `npx vitest run` baseline before starting, per the documented `gui/server-*.test.ts` failure set. |
| **`.context/` and `CLAUDE.md` drift from the edited manifests** | Explicit documentation steps for `ctx-generate` and the `AGENTS.md` → `CLAUDE.md` sync; the pre-commit hook also warns on CTX staleness. |

## Recommended Workflow

- **Workflow:** standalone
- **Rationale:** One new schema field, one ~10-line helper, two small call sites, three UI lines, and an extension to an existing backfill script — no new dependency, no external surface, no cross-module coordination, and strictly smaller than the standalone-executed `2026-08-18-project-duration-field` that introduced the feature.
