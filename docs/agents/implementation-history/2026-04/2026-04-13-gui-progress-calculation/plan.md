# Plan

## Summary

Improve the Ledger GUI "% Done" progress calculation so that
partially-completed work packages contribute proportional progress
based on their pipeline stage completion, rather than counting as
0% until the WP reaches a terminal status (COMPLETE / CANCELLED).

## Architectural Context

The progress calculation currently flows through three layers:

1. **Root index** (`project-ledger.json`) — stores
   `total_work_packages` and `pending_work_packages` counters.
   `pending` = WPs whose status is not terminal (COMPLETE /
   CANCELLED). These counters are recomputed whenever the root
   index is written.
2. **Meta cache** (`.meta.json`) — mirrors `total_work_packages`
   and `pending_work_packages` from the root index, auto-synced by
   `LedgerStore.writeRootIndex()`. The project list enrichment in
   `gui/api.ts` reads these cached values to avoid opening every
   root-index file.
3. **Frontend** (`gui/public/views/project-list.js`) — computes
   `pct = ((total - pending) / total) * 100` and renders a
   progress bar. Sorting by "% Done" in `gui/api.ts` uses the
   same `total - pending` formula.

Key files:

- `mcp-server/src/schema/root-index.ts` — `WorkPackageSummary`,
  `RootIndex`
- `mcp-server/src/schema/project-meta.ts` — `ProjectMeta`
- `mcp-server/src/storage/ledger-store.ts` —
  `writeRootIndex()`, `writeProjectMeta()`
- `mcp-server/src/schema/validators.ts` — `isTerminalStatus()`
- `mcp-server/gui/api.ts` — `handleListProjects` enrichment,
  `ProjectSummary` type, sorting logic, `handleGetWorkPackageOverview`
- `mcp-server/gui/public/views/project-list.js` — `buildTable()`
  progress bar rendering

The per-project detail view already displays per-WP pipeline stage
badges via the `/api/projects/:slug/work-packages/overview` endpoint.
That endpoint reads every WP detail file for a single project —
acceptable for a single-project view but too expensive to call for
every project in the list.

Each WP summary in the root index already contains an
`active_pipeline_stages` array (the stages configured for that WP),
but it does **not** contain any information about how many stages
have been completed. That information currently lives only in the
WP detail files (`WP-###.json` → `pipelines[]` array).

## Approach / Architecture

**Track stage completion in the root index WP summary**, so the
project list can compute fine-grained progress without reading
individual WP detail files.

### New fields

1. **`WorkPackageSummary.passed_stages`** (optional `number`,
   default 0) — the count of pipeline stages whose latest run
   status is `PASS` for this WP.
2. **`ProjectMeta.progress_pct`** (optional `number`) — cached
   project-level progress percentage, written alongside
   `total_work_packages` / `pending_work_packages` during every
   `writeRootIndex()` call.

### Progress formula

For each work package:

```
wp_weight =
  if status ∈ { COMPLETE, CANCELLED }  → 1.0
  if status ∈ { READY, BLOCKED }       → 0.0
  if status = IN_PROGRESS              → passed_stages / active_stages_count
```

Where `active_stages_count` = length of
`active_pipeline_stages` (or `DEFAULT_PIPELINE_STAGES` length
when absent).

Project progress:

```
progress_pct = round( sum(wp_weight) / total_work_packages × 100 )
```

### Data flow

1. Every WP-write sync method
   (`updateWorkPackageWithSync`, `createWorkPackageWithSync`,
   `batchUpdateWorkPackagesWithSync`) already builds a fresh root
   index with updated WP summaries. In this step, compute
   `passed_stages` from the WP detail being written and set it on
   the corresponding summary entry.
2. `writeRootIndex()` already computes `total_work_packages` and
   `pending_work_packages` from the root index. Add a
   `progress_pct` computation using the formula above, pass it
   to `writeProjectMeta()` via `cacheUpdates`.
3. `handleListProjects` uses `progress_pct` from the meta cache
   (fast path) or computes it from the root index (slow path for
   legacy meta files).
4. Frontend `buildTable()` uses `progress_pct` directly instead
   of computing from `total - pending`.

## Rationale

- **No additional I/O in the hot path**: The project list
  enrichment already reads `.meta.json` per project. Adding one
  more cached field to that file costs zero extra reads.
- **Correct by construction**: `passed_stages` is updated
  atomically when the WP and root index are written together,
  so the value is always consistent with the pipeline state.
- **Backward compatible**: Both `passed_stages` and
  `progress_pct` are optional fields. Legacy projects without
  them fall back to the current `(total - pending) / total`
  calculation.
- **No schema break**: Adding optional fields to Zod schemas
  with `.optional()` is non-breaking. Existing ledger files
  parse successfully without the new fields.

## Detailed Steps

1. **Add `passed_stages` to `WorkPackageSummarySchema`**
   (`mcp-server/src/schema/root-index.ts`) — add an optional
   non-negative integer field.

2. **Add `progress_pct` to `ProjectMetaSchema`**
   (`mcp-server/src/schema/project-meta.ts`) — add an optional
   non-negative number field.

3. **Create a `computePassedStages()` helper**
   (`mcp-server/src/utils/workflow-helpers.ts` or inline) — given
   a WP detail's `pipelines` array and `active_pipeline_stages`,
   return the count of distinct stage types whose latest pipeline
   entry has status `PASS`.

4. **Create a `computeProjectProgress()` helper** — given a root
   index's `work_packages` summary array, return a 0–100 integer
   using the formula above.

5. **Update `LedgerStore` sync methods** — in every method that
   builds/updates a WP summary in the root index, set
   `passed_stages` by calling `computePassedStages()` on the WP
   detail being written.

6. **Update `LedgerStore.writeRootIndex()`** — after writing,
   compute `progress_pct` and pass it to `writeProjectMeta()` via
   `cacheUpdates`.

7. **Extend `writeProjectMeta()` `cacheUpdates` type** — add the
   optional `progress_pct` field and persist it.

8. **Update `handleListProjects`** in `gui/api.ts`:
   - Add `progress_pct` to the `ProjectSummary` type.
   - Use `meta.progress_pct` when available (fast path); fall
     back to the old formula when not cached.
   - Update `done` sorting to use `progress_pct`.

9. **Update frontend `buildTable()`** in
   `gui/public/views/project-list.js` — read `p.progress_pct`
   from the API response instead of computing from
   `total_work_packages` and `pending_work_packages`.

10. **Update `project-reset.ts`** — the reset logic recomputes
    `pending_work_packages`; it should also recompute
    `passed_stages` on each WP summary and
    `progress_pct` on the project.

11. **Add tests** — verify the progress computation helper with
    edge cases: zero WPs, all complete, all ready, mixed
    in-progress with varying stage counts, cancelled WPs.

## Dependencies

- No new npm dependencies required.
- All changes are within the `mcp-server/` sub-project.

## Required Components

- `mcp-server/src/schema/root-index.ts` (modify)
- `mcp-server/src/schema/project-meta.ts` (modify)
- `mcp-server/src/utils/workflow-helpers.ts` (modify — add helpers)
- `mcp-server/src/storage/ledger-store.ts` (modify)
- `mcp-server/src/utils/project-reset.ts` (modify)
- `mcp-server/gui/api.ts` (modify)
- `mcp-server/gui/public/views/project-list.js` (modify)
- `mcp-server/tests/` (new test file or additions to existing)

## Assumptions

- A WP with status `CANCELLED` contributes 100% (weight 1.0) to
  progress, matching the current behavior where cancelled WPs are
  counted as "done" (non-pending).
- A `BLOCKED` WP contributes 0% to progress, even if it has some
  passed stages from a prior attempt. This is intentional: blocked
  WPs represent unresolved work.
- `IN_PROGRESS` WPs with no passed stages contribute 0%, which is
  the same as today.

## Constraints

- Must not break backward compatibility with existing
  `.meta.json` or `project-ledger.json` files (all new fields are
  optional with sensible defaults).
- Must not introduce additional file I/O in the project list hot
  path. The progress data must come from the meta cache or root
  index data that is already being read.
- Must work cross-platform (no OS-specific logic involved).

## Out of Scope

- Per-WP progress bar in the project detail view (the pipeline
  track badges already provide this visually).
- Historical progress tracking or progress-over-time charts.
- Progress notifications or thresholds.

## Acceptance Criteria

- A project with 3 WPs, where 1 is COMPLETE and 1 has 3/4 stages
  passed (IN_PROGRESS), shows ~58% progress (not 33%).
- A project with all WPs in READY status shows 0%.
- A project with all WPs COMPLETE shows 100%.
- A project with no WPs shows "—" (unchanged).
- Sorting by "% Done" uses the new granular progress value.
- Legacy projects without `progress_pct` in their meta cache fall
  back gracefully to the old formula.

## Testing Strategy

- **Unit tests** for `computePassedStages()` and
  `computeProjectProgress()` covering edge cases (zero WPs,
  mixed statuses, varying stage counts, missing
  `active_pipeline_stages`).
- **Integration test**: Create a project with multiple WPs at
  different pipeline completion levels; verify that the API
  response contains the expected `progress_pct`.
- **Manual verification**: Run the GUI and observe the progress
  bar for a project with partially-completed WPs.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Stale `passed_stages` if a WP file is edited externally** | The health-check self-healing already detects root-index drift; extend it to recompute `passed_stages` during self-heal. |
| **Existing projects show 0% until their next pipeline write** | Acceptable: the old formula was already showing 0% for these projects. Progress will correct itself on the next WP/pipeline update, or when the enrichment slow path recalculates from the root index. |
| **Schema migration needed for old root-index files** | No migration required: the new fields are optional with default 0. Zod `.optional()` handles absent fields gracefully. |
