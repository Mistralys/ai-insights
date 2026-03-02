# Project Synthesis — Ledger Tool Simplification

**Date:** 2026-03-01  
**Project:** `2026-03-01-ledger-tool-simplification`  
**Status:** COMPLETE  
**Work Packages:** 6 / 6 COMPLETE

---

## Executive Summary

This sprint delivered a comprehensive simplification of the MCP ledger tool surface, reducing the mandatory agent core loop from 6 steps to 3 (ask → start → finish). Six independent but synergistic work packages were completed, each collapsing boilerplate multi-step sequences into single-call conveniences:

| WP | Feature | Net Tool Reduction |
|----|---------|-------------------|
| WP-001 | Merged `ledger_get_next_actions` into `ledger_get_next_action` via `max_results` | −1 tool registered |
| WP-002 | Trimmed 4 low-frequency tools from persona YAML tables; `note_only` flag for `ledger_help` | −4 table rows (4 personas) |
| WP-003 | New `ledger_begin_work`: claim + start pipeline in one locked call | −1 step per cycle (Dev/QA/Rev/Doc) |
| WP-004 | Embedded `handoff_status` in WAIT responses; removed `ledger_get_handoff_status` from 3 persona tables | −1 explicit call per handoff |
| WP-005 | `cwd_path` fallback on all 17+ tools via `resolveProjectPath()`; removed `ledger_detect_project` from all persona tables | −1 preflight step per session |
| WP-006 | Auto-finalize: Documentation PASS with all AC met auto-transitions WP to COMPLETE | −1 explicit call per completion |

The result: agents following the new personas have a streamlined, near-zero-boilerplate workflow with far fewer decision points where off-script behaviour could occur.

All pipelines (implementation, QA, code-review, documentation) passed across all 6 WPs. The final test suite ended at **959/959 passing**.

---

## Metrics

| Metric | Value |
|--------|-------|
| Work Packages | 6 / 6 COMPLETE |
| Implementation pipelines | 7 PASS, 1 FAIL (stale pipeline cancelled + replaced) |
| QA pipelines | 6 PASS |
| Code-Review pipelines | 6 PASS |
| Documentation pipelines | 6 PASS |
| Total tests passing (final) | 959 / 959 |
| Pre-existing failures resolved | 2 (stale `workflow-batch-actions.test.ts` assertions) |
| Personas rebuilt | 14 (7 personas × 2 IDE targets) |
| Files modified (approx.) | 45+ across tools, schemas, tests, personas, docs |

---

## Deliverables by Work Package

### WP-001 — Merged `ledger_get_next_action` / `ledger_get_next_actions`

- `max_results` optional parameter added to `GetNextActionSchema` (Zod `int().positive().optional()`).
- Batch collector (`getNextActionsCollector`) consolidated into `workflow-next-action.ts`.
- `workflow-batch-actions.ts` reduced to a 12-line backward-compat re-export stub.
- `help-content.ts` and `api-surface.md` updated.
- 4 new batch-mode tests; 80/80 `workflow-next-action.test.ts` tests pass.

### WP-002 — Persona Tool Table Trim

- Removed `ledger_update_pipeline_progress`, `ledger_add_observation`, `ledger_get_project_status` from Developer YAML; `ledger_get_project_status` from QA/Reviewer/Documentation YAMLs.
- Introduced `note_only: true` YAML flag for `ledger_help` — suppresses table row while keeping the tool discoverable via prose.
- New flag documented in `personas/docs/agents/project-manifest/api-surface.md` and `constraints.md` (constraint 32b).
- 14 personas rebuilt cleanly.

### WP-003 — `ledger_begin_work`

- New composite tool in `begin-work.ts`: atomically claims a READY WP and starts the pipeline within a single `updateWorkPackageWithSync` lock scope.
- Idempotent re-entry path for IN_PROGRESS WPs (start-only, `claimed: false`).
- Full guard chain preserved: `CLAIMABLE_ROLES`, assignment, dependency, duplicate pipeline, `agent_role`, pipeline ordering, rework circuit breaker.
- 12 tests in `begin-work.test.ts`; `ledger_claim_work_package` and `ledger_start_pipeline` remain registered for advanced use.
- All 4 persona YAMLs updated; `api-surface.md` and `help-content.ts` updated.

### WP-004 — Embedded `handoff_status` in WAIT Responses

- `computeHandoffStatus()` added to `workflow-handoff.ts` as a thin wrapper returning the raw payload.
- `embedHandoffStatusInWait()` post-processes all WAIT return paths in `getNextAction`.
- Graceful degradation: errors embed as `handoff_status_error` and never block the primary WAIT response.
- `ledger_get_handoff_status` removed from Developer, QA, Reviewer persona tables; handoff partials updated with fallback prose.
- 3 new tests covering: WAIT embedding, non-WAIT exclusion, auto_handoff absent without registry.

### WP-005 — `cwd_path` Fallback on All Tools

- `resolveProjectPath()` utility added to `path-validator.ts`: resolution order is `project_path` → `cwd_path` (via `detectProjectByCwd`) → descriptive error if neither.
- AMBIGUOUS result lists all candidate `plan_paths`; NOT_FOUND includes the `cwd_path` and a hint.
- All 17+ tool schemas updated: `project_path?: string`, `cwd_path?: string`.
- `ledger_detect_project` removed from all 5 persona YAML tool tables; `mcp-preflight-detect.md` partial updated to describe `cwd_path` auto-detection.
- `validatePlanPathOrError` retained only in `initializeProject` (legacy entrypoint).
- 6 unit tests for `resolveProjectPath` + 3 end-to-end `cwd_path` tests in `workflow-next-action.test.ts`.
- README.md corrected: `ledger_get_next_actions` removed, `ledger_begin_work` added, `max_results` noted.

### WP-006 — Auto-Finalize on Documentation Pipeline PASS

- Auto-finalize logic added to `completePipeline` in `pipeline.ts`: fires when `type=documentation`, `status=PASS`, `agent_role=Documentation`, and all AC are met post-`acceptance_criteria_updates`.
- Response is enriched: `auto_finalized: true` on success; `auto_finalize_blocked: true` + `unmet_criteria[]` when AC are unmet.
- `ledger_update_work_package_status` removed from Documentation persona YAML; `ledger_complete_pipeline` purpose description updated.
- Documentation persona content (step 5) updated to explain auto-finalize and `auto_finalize_blocked` signals.
- `constraints.md` §13b added; `api-surface.md` and `help-content.ts` both updated.
- 6 new pipeline tests (4 auto-finalize + 2 guidance); `help-content.ts` Global Workflow Order step 5 corrected.

---

## Failure Summary

No blocking failures. One implementation pipeline on WP-003 was cancelled (stale partial implementation from a prior session) and replaced with a clean pipeline in the same session. All final pipelines across all WPs are PASS.

---

## Strategic Recommendations ("Gold Nuggets")

### 🔴 High Priority

_None identified. No security issues or critical failures found._

### 🟡 Medium Priority

1. **`propagateDependencyUnblock` gap (WP-003 + WP-006 — architectural shared gap)**  
   Both `begin-work.ts` (COMPLETE transition path) and `pipeline.ts` (auto-finalize path) complete a WP without calling `propagateDependencyUnblock`. For projects with dependent WPs, dependents will not auto-unblock when their dependency COMPLETE-transitions via these fast paths.  
   **Fix:** Export `propagateDependencyUnblock` from `work-package.ts` and call it in both the `beginWork` COMPLETE branch and the `completePipeline` auto-finalize block. A single follow-up WP can address both callsites simultaneously.

2. **`note_only: true` flag is new and now documented but was not tested**  
   The `build-personas.js` filter for `note_only: true` is minimal (`!t.note_only`), idiomatic, and working — but there are no automated snapshot/regression tests for the persona build system. If the filter is ever broken, the only detection is manual `--check` runs. Consider adding a simple automated test or CI check for the build output.

### 🟢 Low Priority

3. **Captured-closure pattern standardization**  
   All 6 WPs used variables (`claimed`, `autoFinalizeResult`, etc.) captured via closure inside `updateWorkPackageWithSync` callbacks. The Reviewer noted that future contributors may find this non-obvious. Add a brief JSDoc convention note to `constraints.md` clarifying that variables written inside a lock callback and read after the `await` are correct and safe.

4. **`workflow-batch-actions.ts` stub cleanup**  
   The file is now a 12-line re-export shell. Once `workflow-batch-actions.test.ts` is updated to import `buildBatchNextSteps` directly from `workflow-next-action.ts`, the stub and its test import can be deleted. Schedule as a micro-debt WP alongside any future batch-mode work.

5. **`validatePlanPathOrError` legacy cleanup**  
   The function is used exclusively by `initializeProject` in `project-lifecycle.ts`. Once that handler is updated to use `resolveProjectPath()`, `validatePlanPathOrError` can be removed, completing the full migration.

6. **`getNextActionsCollector` eager loading**  
   The batch collector eagerly `Promise.all`s all WP detail files before the limit-check loop runs. For large ledgers this loads all WPs even when `limit=2`. An early-exit pattern (sequential fetch with `break`) would reduce I/O at scale. Acceptable today; flag for future optimization.

7. **`workflow-next-action.ts` file size**  
   Now ~1526 lines and growing. If additional batch logic or new agent roles are added, consider splitting batch logic into a `workflow-next-action-batch.ts` sub-module to preserve navigation efficiency.

8. **Zod schema mutual-exclusivity for `project_path` / `cwd_path`**  
   Both parameters are optional with no `.refine()` guard enforcing mutual exclusivity. The priority order (`project_path` wins) is correct and documented, but a schema-level guard would make the contract explicit. Non-blocking polish.

9. **`computeHandoffStatus` I/O overhead**  
   Creates a new `LedgerStore` instance on each WAIT return (extra root-index + WP reads). Acceptable since WAIT is the terminal end-of-work path, but a future refactor could thread pre-loaded WP details through `embedHandoffStatusInWait` to eliminate the round-trip.

10. **`auto_handoff` sub-key not exercised in tests**  
    The WAIT embedding test exercises the `handoff_status` path but `auto_handoff` is absent because the agent registry is not loaded in the test environment. A mock registry fixture would exercise the full auto-handoff path. Low-effort test gap.

---

## Next Steps

1. **Schedule `propagateDependencyUnblock` follow-up WP (medium priority)** — Export from `work-package.ts`, call in `beginWork`'s COMPLETE branch and `completePipeline`'s auto-finalize block. This is the only architectural gap with real-world impact.
2. **Stub cleanup micro-WP** — Delete `workflow-batch-actions.ts` after updating the test import. Can bundle with items 3 and 5 above in a single micro-debt WP.
3. **Persona build system CI** — Consider a lightweight automated regression check for the `note_only` filter and other build-personas transforms.

---

_Synthesis generated by Head of Operations (Synthesis) on 2026-03-01._
