# Plan — Project Reset: Strategic Recommendations Rework

## Summary

Implement the four strategic recommendations from the [2026-03-04-project-reset synthesis](../2026-03-04-project-reset/synthesis.md). These are follow-up enhancements to the semi-intelligent project reset feature: a `reset_at` timestamp on work packages, a persistent pipeline-health badge on the GUI project detail page, aggregate pipeline health stats in `get_project_status`, and a manual smoke-test of the real broken project. All items are low-risk, additive changes that extend the existing reset infrastructure without modifying its core behaviour.

## Architectural Context

The project-reset feature is spread across four layers:

| Layer | Key File(s) | Purpose |
|-------|-------------|---------|
| Schema | [mcp-server/src/schema/work-package.ts](mcp-server/src/schema/work-package.ts) | `WorkPackageDetailSchema` — Zod schema with `status_changed_at?: string` |
| Analysis & mutation | [mcp-server/src/utils/project-reset.ts](mcp-server/src/utils/project-reset.ts) | `analyzeProjectForReset()` (pure) + `applyProjectReset()` (locking mutation) |
| MCP tool | [mcp-server/src/tools/project-lifecycle.ts](mcp-server/src/tools/project-lifecycle.ts) | `getProjectStatus()` handler with `computeHealedStatus()` pure function |
| GUI API | [mcp-server/gui/api.ts](mcp-server/gui/api.ts) | `handleGetProject()`, `handleResetProject()` |
| GUI frontend | [mcp-server/gui/public/app.js](mcp-server/gui/public/app.js) | `renderProjectDetail()`, `showResetModal()` |
| GUI styles | [mcp-server/gui/public/styles.css](mcp-server/gui/public/styles.css) | Modal + pipeline-badge CSS |

The existing `computeHealedStatus()` function is a pure function that takes a `RootIndex` and returns healed counters/status. It does **not** read work-package detail files. The GUI's `handleGetProject()` returns `{ ...rootIndex, meta }` — it reads the root index and project meta, but does **not** read individual WP detail files.

Pipeline stage data lives exclusively in WP detail files (`WP-###.json`). The root index `work_packages[]` array contains only summary-level fields (`work_package_id`, `status`, `assigned_to`, `dependencies`, `file`). Surfacing pipeline health therefore requires reading WP detail files — an operation the GUI API's `handleGetProject()` does not currently perform, but that `handleResetProject()` already does (for the dry-run analysis path).

## Approach / Architecture

### SR-1: `reset_at` Timestamp on WP Detail

Add an optional `reset_at?: string` field to `WorkPackageDetailSchema`. Set it in `applyProjectReset()` alongside `status_changed_at` for the `reset` action only. This is a non-breaking schema addition (optional field, existing data parses without it).

### SR-2: Healthy Project Health Badge on Project Detail Page

Add a persistent visual indicator to the project detail page header. This requires:

1. A new lightweight API endpoint `GET /api/projects/:slug/health` that calls `analyzeProjectForReset()` and returns the summary counts only (reuses existing analysis logic without mutation).
2. A frontend health badge rendered in `renderProjectDetail()` that fetches this endpoint asynchronously and displays a green checkmark ("All pipelines complete") or an amber warning ("N work packages need attention") next to the project status badge.

**Why a new endpoint?** The existing dry-run path (`POST /api/projects/:slug/reset` with `dry_run: true`) is functionally equivalent, but a GET endpoint is semantically clearer for a read-only health check, is cacheable, and doesn't require a POST body. The implementation delegates to the same `analyzeProjectForReset()` function — zero logic duplication.

### SR-3: Manual Smoke-Test

This is a documented manual verification step, not code. The plan will specify the exact sequence of steps and expected outcomes.

### SR-4: Aggregate Pipeline Health in `get_project_status`

Extend the `getProjectStatus()` handler response to include an optional `pipeline_health` sub-object. Since `computeHealedStatus()` only receives the `RootIndex` (which lacks pipeline data), the pipeline health computation must be performed separately — after the root index is read but before the response is returned. The function will read all WP detail files, call the existing `getPassedStages()` logic (currently private in `project-reset.ts`, needs to be exported), and compute aggregate stage counts.

This is a non-breaking extension — existing consumers that don't expect `pipeline_health` will simply ignore it.

## Rationale

- **SR-1** is trivially additive: one optional schema field, one line in the mutation function, and targeted tests. No migration needed.
- **SR-2** inverts the user mental model from "click a button to check health" to "health is always visible". A dedicated GET endpoint is simpler and semantically correct for the GUI's use case.
- **SR-3** is the highest-certainty validation path — unit/integration tests exercise fixtures, but a real broken project exercises the full stack including JSON serialization, HTTP transport, and frontend rendering.
- **SR-4** gives agents and the GUI passive health visibility without requiring an explicit reset analysis. The cost is reading all WP detail files on every `get_project_status` call, but projects typically have ≤10 WPs, making this negligible. If performance becomes a concern later, the health data can be cached in the root index.

## Detailed Steps

### Step 1 — SR-1: Add `reset_at` to WP Schema and Mutation

1. In [mcp-server/src/schema/work-package.ts](mcp-server/src/schema/work-package.ts), add `reset_at: z.string().optional()` to `WorkPackageDetailSchema` (after the existing `status_changed_at` field).
2. In [mcp-server/src/utils/project-reset.ts](mcp-server/src/utils/project-reset.ts), inside `applyProjectReset()`, set `wp.reset_at = timestamp` alongside `wp.status_changed_at = timestamp` for the `reset` action block (approximately line 331).
3. Add unit tests in [mcp-server/tests/utils/project-reset.test.ts](mcp-server/tests/utils/project-reset.test.ts): verify that after `applyProjectReset()` with a `reset` decision, the WP has `reset_at` set; verify `cancel` and `skip` decisions do **not** set `reset_at`.
4. Add an integration test in [mcp-server/tests/gui/api-reset.test.ts](mcp-server/tests/gui/api-reset.test.ts): verify the API handler response includes `reset_at` on reset WPs.
5. Update [mcp-server/docs/agents/project-manifest/api-surface.md](mcp-server/docs/agents/project-manifest/api-surface.md): document the new `reset_at` field on `WorkPackageDetail`.

### Step 2 — SR-2: Health Badge on Project Detail Page

1. **Export `getPassedStages` from `project-reset.ts`.** Change `function getPassedStages` to `export function getPassedStages` — no logic change.
2. **Create `handleGetProjectHealth()` in [mcp-server/gui/api.ts](mcp-server/gui/api.ts):**
   - Accept `(ledgerRoot: string, slug: string)`.
   - Validate with `assertSafeSlug(slug)`.
   - Instantiate `LedgerStore`, read root index + all WP details (same pattern as the existing dry-run path in `handleResetProject`).
   - Call `analyzeProjectForReset()`.
   - Return a lightweight object: `{ work_packages_needing_reset, work_packages_healthy, work_packages_skipped, total_work_packages }`.
3. **Wire the route in [mcp-server/gui/server.ts](mcp-server/gui/server.ts):** Add `GET /api/projects/:slug/health` with the same pattern as the existing routes.
4. **Frontend changes in [mcp-server/gui/public/app.js](mcp-server/gui/public/app.js):**
   - Add `API.getProjectHealth(slug)` method.
   - In `renderProjectDetail()`, add a placeholder `<span id="health-badge">` in the page header (next to the status badge, before the reset button).
   - After the main content renders, fire an async `API.getProjectHealth(slug)` call. On success, populate the badge with either `✓ All pipelines complete` (green) or `⚠ N WPs need attention` (amber).
5. **CSS additions in [mcp-server/gui/public/styles.css](mcp-server/gui/public/styles.css):** `.health-badge`, `.health-badge.healthy`, `.health-badge.attention` — small pill-shaped badges using existing CSS variable system.
6. **Tests:**
   - Unit test for `handleGetProjectHealth()` — healthy project returns all-zero needing-reset count; broken project returns correct needing-reset count.
   - Verify 404 on non-existent slug.
7. **Update manifests:** [api-surface.md](mcp-server/docs/agents/project-manifest/api-surface.md) for the new endpoint; [file-tree.md](mcp-server/docs/agents/project-manifest/file-tree.md) if any new files are created.

### Step 3 — SR-4: Pipeline Health in `get_project_status`

1. **Export `getPassedStages`** (already done in Step 2).
2. **In [mcp-server/src/tools/project-lifecycle.ts](mcp-server/src/tools/project-lifecycle.ts)**, inside the `getProjectStatus()` function, after the root index is read (and healed if needed), add a pipeline-health computation:
   - Read all WP detail files using `store.readWorkPackage()`.
   - For each non-CANCELLED WP, call `getPassedStages()` and compare against `PIPELINE_TYPES`.
   - Compute: `wps_with_all_stages_pass`, `wps_missing_stages`, `total_stages_missing` (aggregate count).
   - Attach as `pipeline_health` sub-object on the response JSON.
3. **Handle read failures gracefully:** If a WP detail file is unreadable, skip it (same pattern as `validatePipelineOrdering`).
4. **Tests in [mcp-server/tests/tools/project-lifecycle.test.ts](mcp-server/tests/tools/project-lifecycle.test.ts):**
   - Verify `pipeline_health` is present in the `get_project_status` response.
   - Verify correct counts for a healthy project (all stages pass).
   - Verify correct counts for a project with missing stages.
5. **Update [api-surface.md](mcp-server/docs/agents/project-manifest/api-surface.md):** Document the `pipeline_health` sub-object in the `ledger_get_project_status` section.

### Step 4 — SR-3: Manual Smoke-Test

1. Open the GUI at `http://localhost:24678`.
2. Navigate to the project `2026-03-04-preserve-index-metadata`.
3. Click **Reset Project**.
4. Verify the modal opens with a summary banner showing broken WP count.
5. Verify pipeline stage indicators (green/red badges) are correct per WP.
6. Click **Apply Reset**.
7. Verify the project detail page refreshes with all reset WPs showing `IN_PROGRESS`.
8. Re-click **Reset Project** to confirm the modal now reports "All work packages are healthy".
9. Verify the new health badge (from SR-2) reflects the updated state.
10. Document the result (pass/fail) in the work package notes.

## Dependencies

- SR-2 and SR-4 both depend on SR-1 (schema change) being completed first — though technically they are independent, sequencing avoids merge conflicts.
- SR-2's `getPassedStages` export is reused by SR-4.
- SR-3 depends on SR-2 being deployed (to also verify the health badge in the smoke test).

## Required Components

### Modified Files

| File | Change |
|------|--------|
| `mcp-server/src/schema/work-package.ts` | Add `reset_at` optional field |
| `mcp-server/src/utils/project-reset.ts` | Export `getPassedStages`; set `reset_at` in apply mutation |
| `mcp-server/src/tools/project-lifecycle.ts` | Add `pipeline_health` to `getProjectStatus` response |
| `mcp-server/gui/api.ts` | Add `handleGetProjectHealth()` |
| `mcp-server/gui/server.ts` | Wire `GET /api/projects/:slug/health` route |
| `mcp-server/gui/public/app.js` | Add `API.getProjectHealth()`, health badge in `renderProjectDetail()` |
| `mcp-server/gui/public/styles.css` | Health badge CSS |
| `mcp-server/tests/utils/project-reset.test.ts` | Tests for `reset_at` field |
| `mcp-server/tests/gui/api-reset.test.ts` | Tests for `reset_at` in API response |
| `mcp-server/tests/tools/project-lifecycle.test.ts` | Tests for `pipeline_health` |
| `mcp-server/docs/agents/project-manifest/api-surface.md` | Document `reset_at`, health endpoint, `pipeline_health` |

### New Files

None — all changes fit into existing files.

## Assumptions

- The project `2026-03-04-preserve-index-metadata` referenced in the synthesis still exists in the ledger storage and is in the broken state described. If it has already been manually fixed, the smoke test will verify the "healthy project" path instead.
- `getPassedStages()` in `project-reset.ts` is currently a private function but the logic is stable and can be safely exported without modification.
- The GUI HTTP server is run locally and accessible at `localhost:24678` for the smoke test.

## Constraints

- **Schema backward compatibility:** `reset_at` must be optional — existing WP JSON files without this field must continue to parse without error.
- **No new dependencies:** All changes use existing libraries (Zod, node:http, LedgerStore).
- **STDIO discipline:** No `console.log` or `process.stdout.write` in any MCP server source file (per [constraints.md](mcp-server/docs/agents/project-manifest/constraints.md)).
- **Atomic writes / locking:** Any new write paths must use `atomicWriteJson()` and `withLock()` per existing conventions. SR-1's mutation already runs inside the existing lock scope — no new lock acquisition needed.

## Out of Scope

- Caching pipeline health data in the root index (performance optimization — premature for current project sizes).
- Exposing the health endpoint or `pipeline_health` data as new MCP tools (consistent with the synthesis decision to keep reset/health features GUI-only).
- Frontend polish beyond the health badge (e.g., detailed per-WP pipeline visualization on the project list page).
- Automated E2E tests for the smoke-test scenario (manual verification is sufficient for a one-time check).

## Acceptance Criteria

### SR-1: `reset_at` Timestamp
- [ ] `WorkPackageDetailSchema` accepts and validates an optional `reset_at: string` field.
- [ ] Existing WP JSON files without `reset_at` parse without error.
- [ ] `applyProjectReset()` sets `reset_at` on WPs with `reset` action.
- [ ] `applyProjectReset()` does NOT set `reset_at` on WPs with `cancel` or `skip` actions.
- [ ] Unit tests verify `reset_at` presence/absence for each action type.
- [ ] Integration test confirms `reset_at` is persisted to disk and readable.
- [ ] `api-surface.md` documents the `reset_at` field.

### SR-2: Health Badge
- [ ] `GET /api/projects/:slug/health` returns `{ work_packages_needing_reset, work_packages_healthy, work_packages_skipped, total_work_packages }`.
- [ ] Non-existent slug returns 404.
- [ ] Invalid slug returns 400.
- [ ] Project detail page displays a green health badge when all WPs are healthy.
- [ ] Project detail page displays an amber badge when WPs need attention.
- [ ] Health badge loads asynchronously — page is usable before health data arrives.
- [ ] Health badge updates after a reset operation (page refresh).
- [ ] `api-surface.md` documents the health endpoint.

### SR-3: Manual Smoke-Test
- [ ] The broken project is analyzed correctly by the modal.
- [ ] The reset applies successfully with correct WP state transitions.
- [ ] A second analysis confirms the project is now healthy.
- [ ] The health badge shows the correct post-reset state.
- [ ] Pass/fail result is documented.

### SR-4: Pipeline Health in `get_project_status`
- [ ] `get_project_status` response includes `pipeline_health` sub-object.
- [ ] `pipeline_health` includes `wps_with_all_stages_pass`, `wps_missing_stages`, `total_stages_missing`.
- [ ] WPs that fail to read are silently skipped (non-fatal).
- [ ] Healthy project returns `wps_missing_stages: 0`.
- [ ] Project with broken WPs returns accurate counts.
- [ ] `api-surface.md` documents the `pipeline_health` sub-object.

## Testing Strategy

| Change | Test Type | Location |
|--------|-----------|----------|
| `reset_at` schema field | Unit | `tests/utils/project-reset.test.ts` |
| `reset_at` in API | Integration | `tests/gui/api-reset.test.ts` |
| Health endpoint | Integration | `tests/gui/api-reset.test.ts` (extend existing file) |
| `pipeline_health` in MCP tool | Tool-level | `tests/tools/project-lifecycle.test.ts` |
| Health badge rendering | Manual | Smoke-test (SR-3) |
| Full stack smoke-test | Manual | Against real broken project |

All existing 1040 tests must continue to pass. New tests should follow existing fixture patterns (`makeWorkPackageDetail()`, `makePipeline()`, `createTempStore()`).

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **SR-4 performance on large projects** | Projects currently have ≤10 WPs; reading all detail files adds negligible latency. If projects grow, cache health data in the root index and update it piggy-backed on WP writes. |
| **`getPassedStages` export creates coupling** | The function is pure, stable, and well-tested. Exporting it from `project-reset.ts` is low-risk. If it grows into a general utility, move it to a shared module later. |
| **Broken project already fixed** | The smoke-test step documents the "healthy project" path as an acceptable alternative outcome. |
| **Schema field `reset_at` missing on older data** | Field is optional with no default — Zod `z.string().optional()` handles missing values transparently. |
| **Health endpoint adds latency to page load** | The GET request is fired asynchronously after the main content renders. The page is fully usable before the health badge populates. |
