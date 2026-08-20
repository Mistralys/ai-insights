# Plan

## Plan Audit Cycles
- Audits: 1 — Plan Auditor v1.7.0
- Architectural Reviews: 1 — Plan Architect Reviewer v2.2.0

### Architectural Review Summary (2026-08-01)
**Overall Assessment: Sound Design** — 6 Confirm, 0 Challenge, 0 Reconsider. All design decisions align with established codebase patterns. Full analysis in `design-review.md`.

**Implementation-critical notes:**
1. **Protect the `writeRootIndex()` auto-computation (Step 4):** This follows the `computeProjectProgress()` precedent at L268 of `ledger-store.ts` and is the lynchpin that makes Step 5 (standalone imports) work with zero changes to `importStandaloneProject()`. Do not move computation to callers.
2. **Protect `preserveLastUpdated: true` in self-heal (Step 6):** Without this option on the fire-and-forget `writeProjectMeta()` call, the self-heal write would bump `last_updated` on every first detail view, distorting sort order in the project list.

## Prior Project Context
The repository's short-term goal is minimal friction and ease of use. Project duration is currently computed on-the-fly in the GUI detail endpoint by reading every project's root index — an I/O-heavy operation unavailable to the list view. Persisting duration in `.meta.json` eliminates this bottleneck and makes duration a first-class, sortable, filterable field across the entire GUI.

## Summary
Add a `duration_ms` field to `ProjectMeta` (`.meta.json`) that captures the wall-clock duration of a project — defined as the millisecond difference between `date_created` and `synthesis_generated_at`. The field is populated automatically when synthesis completes (ledger workflow) or when a standalone project is imported, and is synced to `.meta.json` via the existing `writeRootIndex()` → `writeProjectMeta()` auto-sync path. A one-time backfill script populates the field for all 284 existing projects in the ledger. The GUI project list gains a duration column and sort option; the project detail view reads the cached value instead of recomputing it.

## Architectural Context
The MCP server uses a dual-file storage model per project: `project-ledger.json` (root index — the authoritative operational state) and `.meta.json` (a lightweight enrichment cache for fast list queries). The `writeRootIndex()` method auto-syncs selected fields to `.meta.json` after every root index write, via `writeProjectMeta()`. The GUI project list endpoint (`handleListProjects`) reads only `.meta.json` files for performance, while the detail endpoint (`handleGetProject`) reads both files and computes timing on-the-fly.

Currently, project duration is computed server-side in `handleGetProject()` as:
```
endTime = synthesis_generated_at ?? last_updated
duration = endTime - date_created
```
This computation requires reading the root index (for `synthesis_generated_at`), which is why duration is unavailable in the list view.

## Approach / Architecture
Persist `duration_ms` in `.meta.json` as a pre-computed enrichment cache field, following the same pattern as `progress_pct`, `total_work_packages`, etc. The field is set at two write-time events:

1. **`completeSynthesis()`** — computes `duration_ms = synthesis_generated_at - date_created` and includes it in the root index sync to `.meta.json`.
2. **`importStandaloneProject()`** — computes `duration_ms = now() - dateCreated` (import time minus plan creation time).

The `handleGetProject()` timing block reads `duration_ms` from `.meta.json` (via the already-loaded `meta` object) instead of recomputing from timestamps.

A root-level backfill script iterates all project directories, reads each root index for `date_created` and `synthesis_generated_at`, computes `duration_ms`, and patches the `.meta.json` file.

## Rationale
- **Pre-compute over request-time computation:** Duration never changes after synthesis — computing it once and caching it in `.meta.json` eliminates per-request I/O and makes it available to the list endpoint without schema changes to the API response envelope.
- **`.meta.json` over root index:** The list endpoint reads only `.meta.json` files. Adding the field here makes it immediately available for list display, sorting, and filtering without changing the list endpoint's I/O pattern.
- **Backfill script + lazy self-heal:** 284 existing projects need the field. A one-time script handles the bulk backfill; a lazy self-heal in the detail endpoint catches stragglers (future standalone imports, projects added after the script ran) without requiring the user to remember to re-run the script.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Where to persist duration | `.meta.json` (`duration_ms` field) | Root index only; compute on-the-fly in list endpoint | Meta is the enrichment cache by design; root index would require list endpoint to read every root index (defeats the fast-path). On-the-fly in list is O(N) root index reads. |
| When to compute duration | At synthesis completion + import time | At every `writeRootIndex()` call; via a scheduled background job | Synthesis completion is the definitive end-time — computing at every write would produce intermediate (wrong) values. Background job adds unnecessary complexity. |
| Backfill mechanism | One-time script + lazy self-heal in detail endpoint | Script-only (no lazy); lazy-only (no bulk); MCP tool | Script handles the bulk (284 projects in seconds). Lazy self-heal catches future imports without user intervention — but only fires in the detail endpoint (already reads root index), not the list endpoint (would defeat the fast path). Combined approach gives both immediate coverage and long-term resilience. |
| Field name | `duration_ms` | `project_duration_ms`, `elapsed_ms`, `wall_clock_ms` | `duration_ms` is concise, matches `PipelineSchema.duration_ms`, and is unambiguous in context. |
| Null semantics | `null` when unmeasurable (standalone same-session, missing timestamps) | `0`, `-1` sentinel | `null` aligns with existing nullable optional patterns and lets the GUI show "Not measured" naturally. |

## Pattern Alignment
- **Enrichment cache fields in `.meta.json`:** Follows the pattern of `total_work_packages`, `pending_work_packages`, `progress_pct` — optional numeric fields synced via `writeRootIndex()` → `writeProjectMeta()`. Established in `mcp-server/src/schema/project-meta.ts`.
- **`MetaCacheUpdates` type for sync:** New field added to the existing `MetaCacheUpdates` interface, following the key-presence spread pattern in `writeProjectMeta()`. Established in `mcp-server/src/storage/ledger-store.ts`.
- **Backfill script pattern:** Follows `mcp-server/src/storage/migrate-namespaced.ts` — filesystem traversal, idempotent writes, skip-if-already-done. New script lives in `scripts/` per root-level tooling convention.
- **Standalone null-out:** Follows the existing pattern in `handleGetProject()` (L606–L608) where standalone projects with `rawElapsedMs === 0` are nulled out.

## Detailed Steps

### Step 1: Add `duration_ms` to `ProjectMetaSchema`
Add `duration_ms: z.number().int().nonnegative().nullable().optional()` to the `ProjectMetaSchema` in `mcp-server/src/schema/project-meta.ts`. Position it after the `progress_pct` field alongside other enrichment cache fields.

### Step 2: Add `duration_ms` to `MetaCacheUpdates`
Add `duration_ms?: number | null` to the `MetaCacheUpdates` type in `mcp-server/src/storage/ledger-store.ts` so `writeProjectMeta()` can accept the field.

### Step 3: Sync `duration_ms` in `writeProjectMeta()`
Add the key-presence spread for `duration_ms` in `writeProjectMeta()` (alongside existing fields like `outcome_summary`):
```ts
...(cacheUpdates !== undefined && 'duration_ms' in cacheUpdates ? { duration_ms: cacheUpdates.duration_ms } : {}),
```
Also add the existing-value preservation:
```ts
...(existing.duration_ms !== undefined ? { duration_ms: existing.duration_ms } : {}),
```

### Step 4: Compute and sync `duration_ms` in `completeSynthesis()`
After setting `rootIndex.synthesis_generated_at = now()` in `completeSynthesis()`, compute:
```ts
const createdAt = new Date(rootIndex.date_created).getTime();
const synthesisAt = new Date(rootIndex.synthesis_generated_at).getTime();
const durationMs = (!isNaN(createdAt) && !isNaN(synthesisAt) && synthesisAt > createdAt)
  ? synthesisAt - createdAt
  : null;
```
Then include `duration_ms: durationMs` in the `writeRootIndex()` sync. Since `writeRootIndex()` already calls `writeProjectMeta()`, the value needs to be passed through the `MetaCacheUpdates` object. Update the `writeRootIndex()` call in `completeSynthesis()` to pass `duration_ms` via the cache updates, or — more cleanly — compute it and write it directly to `.meta.json` after the `writeRootIndex()` call within the same lock scope.

**Recommended approach:** Add `duration_ms` to the `writeRootIndex()` → `writeProjectMeta()` sync path. This requires `writeRootIndex()` to accept the root index data (it already does) and to extract `synthesis_generated_at` and `date_created` from it for the duration computation. Add the computation inside `writeRootIndex()` itself, gated on `synthesis_generated_at` being truthy:

```ts
// In writeRootIndex(), after the existing cache updates spread:
const durationMs = (() => {
  if (!validated.synthesis_generated_at) return undefined; // no duration to sync
  const created = new Date(validated.date_created).getTime();
  const synth = new Date(validated.synthesis_generated_at).getTime();
  if (isNaN(created) || isNaN(synth) || synth <= created) return null;
  // Null out zero-duration standalone projects (same-session import)
  return (synth === created && validated.runner === 'standalone') ? null : synth - created;
})();
```
Then pass `...(durationMs !== undefined ? { duration_ms: durationMs } : {})` into the `writeProjectMeta()` call.

### Step 5: Handle `duration_ms` in `importStandaloneProject()`
The duration for standalone imports is computed the same way as in Step 4 — `writeRootIndex()` now handles it automatically since the root index has both `date_created` and `synthesis_generated_at` set before the write.

No changes needed in `importStandaloneProject()` — the `writeRootIndex()` enhancement from Step 4 covers it.

### Step 6: Update `handleGetProject()` with cached read + lazy self-heal
In `mcp-server/gui/api.ts`, the `handleGetProject()` function currently computes `project_elapsed_ms` from timestamps. Update it to:

1. **Prefer `meta.duration_ms`** when available (fast path — no change to existing I/O).
2. **Lazy self-heal** when `meta.duration_ms` is missing but `synthesis_generated_at` is available on the root index (already loaded in this endpoint): compute the value, write it back to `.meta.json` asynchronously (fire-and-forget — do not block the response), and return the computed value.
3. **Fall back to the existing computation** when neither cached nor computable.

```ts
// Prefer cached duration_ms from .meta.json
let project_elapsed_ms: number | null;
if (meta.duration_ms !== undefined && meta.duration_ms !== null) {
  project_elapsed_ms = meta.duration_ms;
} else {
  // Existing computation as fallback
  project_elapsed_ms =
    rawElapsedMs === 0 && rootIndex.runner === 'standalone' ? null : rawElapsedMs;

  // Lazy self-heal: persist computed duration to .meta.json for future fast-path reads.
  // Fire-and-forget — do not await; a failed write is harmless (next detail view retries).
  if (project_elapsed_ms !== null && rootIndex.synthesis_generated_at) {
    store.writeProjectMeta('', undefined, { duration_ms: project_elapsed_ms },
      { preserveLastUpdated: true }).catch(() => {});
  }
}
```

The `preserveLastUpdated: true` option ensures the self-heal write does not bump `last_updated`, which would distort sort order in the project list.

Keep the existing computation for `total_active_ms` and `pipeline_runs` (these aggregate pipeline-level data and are unrelated to project duration).

### Step 7: Expose `duration_ms` in project list API
In `mcp-server/gui/api.ts`, the `ProjectSummary` type extends `ProjectMeta` — so `duration_ms` is automatically available once added to the schema. No type change needed.

The `handleListProjects()` enrichment already spreads the full `meta` object into the return value, so `duration_ms` flows through automatically when present in `.meta.json`.

### Step 8: Add `duration` sort field
Add `'duration'` to the `ProjectSortField` union type and `SORT_FIELDS` set. Add the sort case:

```ts
case 'duration':
  aVal = a.duration_ms ?? -1;
  bVal = b.duration_ms ?? -1;
  break;
```

Projects without duration sort to the bottom (or top, depending on direction) using `-1` as a sentinel that sorts before any real positive duration.

### Step 9: Add duration column to project list GUI
In `mcp-server/gui/public/views/project-list.js`, add a "Duration" column to the table header and render `formatDuration(project.duration_ms)` (or "—" when null/undefined) in each row. Use the existing `formatDuration()` utility from `utils.js`.

Add a clickable column header for sorting by `duration`, following the existing pattern for other sortable columns.

### Step 10: Write backfill script
Create `scripts/backfill-duration.js` that:

1. Scans the ledger root for all `{repoName}/{slug}/` directories.
2. For each project, reads `.meta.json` and `project-ledger.json`.
3. If `.meta.json` already has a non-null `duration_ms`, skips (idempotent).
4. Extracts `date_created` from `.meta.json` and `synthesis_generated_at` from `project-ledger.json`.
5. Computes `duration_ms = synthesis_generated_at - date_created` (ms). Null if either timestamp is missing, or if the result is 0 for standalone projects.
6. Patches `.meta.json` with the new field and writes it back atomically.
7. Reports summary: total projects, backfilled, skipped (already had duration), skipped (no synthesis).

The script runs from the workspace root: `node scripts/backfill-duration.js`. It should also be invokable via `node scripts/cli.js backfill-duration`.

Supports `--dry-run` (report what would change without writing) and `--verbose` (log each project).

### Step 11: Register backfill script in CLI
Add a `backfill-duration` command to `scripts/cli.js` that delegates to `scripts/backfill-duration.js`.

### Step 12: Verify legacy synthesis_generated_at repair coverage
In `mcp-server/src/tools/project-lifecycle.ts`, the existing legacy repair backfills `synthesis_generated_at` from `last_updated` (in the self-heal write block) and then calls `store.writeRootIndex(fresh)`. Because the Step 4 enhancement computes `duration_ms` inside `writeRootIndex()` whenever `synthesis_generated_at` is set, that call already covers the legacy repair path automatically — **no code changes to `project-lifecycle.ts` are needed**.

Verify: after implementing Step 4, confirm that a project reaching the self-heal path (synthesis_generated is true but synthesis_generated_at was missing) receives `duration_ms` in `.meta.json` via the `writeRootIndex()` call. This is a verification-only step.

## Dependencies
- Step 2 depends on Step 1 (schema must exist before type is updated).
- Steps 3–5 depend on Step 2 (sync logic needs the type).
- Steps 6–9 depend on Step 1 (schema field must exist).
- Step 10 depends on Step 1 (schema field must exist for validation).
- Steps 7–9 are independent of Steps 3–5 (GUI can read the field even before the write-side populates it — it'll just be undefined).
- Step 12 (verification) depends on Step 4 being implemented.

## Required Components
- `mcp-server/src/schema/project-meta.ts` — schema modification
- `mcp-server/src/storage/ledger-store.ts` — `MetaCacheUpdates` type + `writeProjectMeta()` + `writeRootIndex()` modifications
- `mcp-server/src/tools/project-lifecycle.ts` — `completeSynthesis()` modification only (legacy repair path covered automatically by Step 4 — verified in Step 12, no additional code needed)
- `mcp-server/src/tools/standalone-import.ts` — no changes needed (covered by `writeRootIndex()` enhancement)
- `mcp-server/gui/api.ts` — `handleGetProject()`, `ProjectSortField`, sort logic modifications
- `mcp-server/gui/public/views/project-list.js` — duration column + sort header
- `scripts/backfill-duration.js` — new file
- `scripts/cli.js` — new command registration

## Assumptions
- `synthesis_generated_at` is the correct end-time for duration computation (confirmed by existing GUI logic and code comments).
- The backfill script has read/write access to the ledger storage directory.
- `.meta.json` files are valid JSON (the script should handle corrupt files gracefully).

## Constraints
- All schema changes must be backward-compatible (optional/nullable fields only).
- The backfill script must be idempotent — safe to run multiple times.
- Cross-platform: the backfill script uses Node.js built-in APIs only (no Unix-specific commands).
- No changes to the `RootIndexSchema` — `duration_ms` lives only on `.meta.json`.

## Out of Scope
- Adding `duration_ms` to the root index (`project-ledger.json`) — duration is a derived/cached value and belongs in the enrichment cache, not the operational state.
- Duration filtering in the project list API (sorting is sufficient for now).
- Pipeline-level duration aggregation changes — `total_active_ms` and `pipeline_runs` remain computed at request-time in the detail endpoint.
- MCP tool output changes — `ledger_get_project_status` and other MCP tools do not need to expose `duration_ms`.

## Acceptance Criteria
- AC-01: `ProjectMetaSchema` includes `duration_ms: z.number().int().nonnegative().nullable().optional()`.
- AC-02: `completeSynthesis()` computes and persists `duration_ms` to `.meta.json` via the `writeRootIndex()` sync path.
- AC-03: Standalone imports via `importStandaloneProject()` persist `duration_ms` to `.meta.json` (via the same `writeRootIndex()` path).
- AC-04: `handleGetProject()` reads `duration_ms` from `.meta.json` instead of recomputing it, with fallback to the existing computation for un-backfilled projects.
- AC-04a: When `duration_ms` is missing but computable, `handleGetProject()` writes the computed value back to `.meta.json` (lazy self-heal) without blocking the response.
- AC-05: `handleListProjects()` includes `duration_ms` in the `ProjectSummary` response.
- AC-06: The project list GUI displays a "Duration" column with human-readable values.
- AC-07: The project list supports sorting by `duration`.
- AC-08: `scripts/backfill-duration.js` populates `duration_ms` for all existing projects that have `synthesis_generated_at`.
- AC-09: The backfill script is idempotent — running it twice produces the same result.
- AC-10: The backfill script supports `--dry-run` mode.
- AC-11: All existing MCP server tests pass without modification.

## Testing Strategy
Unit tests for the schema change (ProjectMeta validation), integration tests for the `completeSynthesis()` → `.meta.json` sync path, and a manual run of the backfill script against the existing ledger storage. GUI changes are visually verified.

## Test Plan
- `mcp-server/tests/schema/project-meta.test.ts` (or inline in existing schema tests) — Validates `duration_ms` is accepted as number, null, or absent. Covers AC-01.
- `mcp-server/tests/tools/project-lifecycle.test.ts` — Existing `completeSynthesis` tests: verify the `.meta.json` output includes `duration_ms` after synthesis completion. Covers AC-02.
- `mcp-server/tests/storage/ledger-store.test.ts` — Test `writeProjectMeta()` with `duration_ms` in cache updates. Also add edge case tests for the `writeRootIndex()` computation logic: (a) `synthesis_generated_at` absent → `duration_ms` not written to meta; (b) invalid/NaN timestamp → `duration_ms` is `null`; (c) `synth <= created` (clock skew) → `duration_ms` is `null`. Covers AC-02, AC-03.
- `mcp-server/tests/tools/standalone-import.test.ts` — Verify standalone import writes `duration_ms` to `.meta.json`. Covers AC-03.
- `mcp-server/tests/gui/api.test.ts` (if exists) or manual verification — `handleGetProject()` returns `duration_ms` from meta when available; when missing, computes and persists it (lazy self-heal). Covers AC-04, AC-04a, AC-05.
- Manual: Run backfill script with `--dry-run`, verify output. Run without flag, verify `.meta.json` files updated. Run again, verify idempotent (no changes). Covers AC-08, AC-09, AC-10.
- Manual: Load GUI project list, verify Duration column renders and sort works. Covers AC-06, AC-07.

## Documentation Updates
- `mcp-server/docs/agents/project-manifest/api-surface.md` — Add `duration_ms` to `ProjectMeta` type documentation; update `ProjectSummary` type; add `duration` sort field; document backfill script. **Note:** the existing `ProjectSortField` definition in this file is stale (missing `project`, `repository`, `runner`, `total_work_packages` from the live code); reconcile the full definition while adding `duration`.
- `mcp-server/docs/agents/project-manifest/data-flows.md` — Update the `.meta.json` sync flow to include `duration_ms`.
- `mcp-server/gui/docs/agents/project-manifest/api-surface.md` — Add `duration` to the `sort` query parameter field list; add `duration_ms` to the `ProjectSummary` and `ProjectDetail` type entries.
- `mcp-server/gui/docs/agents/project-manifest/data-flows.md` — Verify whether the `.meta.json` sync flow is documented here; update if so to include `duration_ms`.
- `AGENTS.md` (root) — Add `scripts/backfill-duration.js` to the Root-Level Tooling table.
- `README.md` (root) — Add `backfill-duration` to the scripts listing if scripts are documented there.
- Regenerate `.context/` files after manifest updates (`node scripts/cli.js ctx-generate`).

## Risks & Mitigations
| Risk | Mitigation |
|------|------------|
| **Backfill script corrupts `.meta.json`** | Script reads, validates, patches, and writes atomically. `--dry-run` mode allows preview. Idempotent by design. |
| **Clock skew between `date_created` and `synthesis_generated_at`** | Both timestamps are generated by the same server process using `now()`. Cross-device imports (standalone) derive `date_created` from filesystem timestamps, which may have minor skew — acceptable for wall-clock duration. |
| **Standalone projects showing misleading duration** | The existing null-out logic for zero-duration standalone projects is preserved. Standalone imports where `date_created` < `synthesis_generated_at` (real elapsed time) will show meaningful duration. |
| **GUI column adds visual clutter** | Duration column is narrow (uses the existing compact `formatDuration()` output like "2h 15m"). Can be toggled in a future iteration if needed. |
| **Lazy self-heal write fails** | Fire-and-forget with `.catch(() => {})` — a failed write is harmless; the next detail view request retries the self-heal. No data loss or corruption risk since `.meta.json` is an enrichment cache. |

## Recommended Workflow
- **Workflow:** standalone
- **Rationale:** Single-module change (MCP server + scripts) within well-understood enrichment cache patterns; no cross-module coordination or formal QA stages needed.
