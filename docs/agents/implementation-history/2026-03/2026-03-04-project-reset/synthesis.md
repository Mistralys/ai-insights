# Synthesis Report: Semi-Intelligent Project Reset

**Project**: 2026-03-04-project-reset
**Date Completed**: 2026-03-05
**Status**: COMPLETE
**Work Packages**: 6 / 6 complete
**Acceptance Criteria Met**: 72 / 72

---

## Executive Summary

Successfully delivered a semi-intelligent project reset feature for the MCP server GUI. The feature enables an authorised user to detect and repair broken ledger projects — where agents have prematurely marked all work packages `COMPLETE` after running only the `implementation` pipeline — without losing downstream audit history.

The implementation is a full-stack addition: a pure analysis utility, a locking mutation function, a REST API endpoint, and an interactive frontend modal with per-WP decision controls. All 6 work packages completed across all four pipeline stages (implementation → QA → code review → documentation), with 72 acceptance criteria met and 1040/1040 tests passing across 35 test files.

---

## What Was Built

### WP-001 — Reset Analysis Utility (`analyzeProjectForReset`)

A pure TypeScript function in `mcp-server/src/utils/project-reset.ts` that takes a `RootIndex` and an array of `WorkPackageDetail` objects and returns a `ProjectResetDiagnosis` with per-WP analysis. No I/O — designed for easy unit testing and reuse.

Key logic:
- Skips `CANCELLED` WPs entirely.
- Walks each WP's pipelines array to find the furthest `PASS` stage in the canonical `[implementation, qa, code-review, documentation]` order.
- Derives `pipeline_stages_missing`, `next_required_stage`, and `target_assigned_to` (via `PIPELINE_AGENT_MAP`).
- Computes `suggested_action` (`reset` for broken WPs, `skip` for healthy/READY/BLOCKED) and `suggested_reset_criteria` defaults so the GUI can pre-populate controls intelligently.
- Returns project-level counters: `work_packages_needing_reset`, `work_packages_healthy`, `work_packages_skipped`.

Exports: `WpResetDiagnosis`, `ProjectResetDiagnosis` interfaces + `analyzeProjectForReset()` function.

### WP-002 — Reset Mutation Function (`applyProjectReset`)

In the same file, an async mutation function that wraps all writes in a single `withLock(store.storageDir)` scope.

Per-WP actions:
- **reset**: sets `status → IN_PROGRESS`, `assigned_to` from `diagnosis.target_assigned_to`, optionally resets `acceptance_criteria[*].met = false` (default) or preserves them.
- **cancel**: sets `status → CANCELLED`.
- **skip / absent from decisions map**: no-op.

Project-level updates:
- WP summaries in root index reflect new status/assigned_to.
- `pending_work_packages` recomputed as count of non-terminal WPs.
- `project_status → IN_PROGRESS`, `synthesis_generated → false`, `auto_handoff_depth → 0`.
- Appends an audit `project_comment` listing per-WP decisions.
- Stale-state guard: re-reads each WP under lock; WPs changed since diagnosis are skipped with a response warning.
- Existing pipeline entries are never touched.

Exports: `WpDecision`, `ProjectResetResult` interfaces + `applyProjectReset()` function.

### WP-003 — GUI API Handler + Server Route

`handleResetProject()` exported from `mcp-server/gui/api.ts` (line 537). Validates the slug via `assertSafeSlug`, parses the request body with a Zod schema, and branches on `dry_run`:

- `dry_run: true` → reads all WP details, calls `analyzeProjectForReset()`, returns `ProjectResetDiagnosis`. Zero file writes.
- `dry_run: false` + valid `decisions` map → calls `applyProjectReset()`, returns `ProjectResetResult`.
- `dry_run: false` without `decisions` → `400 VALIDATION_ERROR`.
- Invalid/missing slug → `404 NOT_FOUND`.
- Malformed body → `400 VALIDATION_ERROR`.

Route wired in `mcp-server/gui/server.ts` via a dedicated POST block in `matchRoute()` (lines 351–376). All 1040 tests pass.

### WP-004 — Frontend Reset Button, Diagnosis Modal, and CSS

Full UI layer in `mcp-server/gui/public/app.js` and `mcp-server/gui/public/styles.css`:

**API client methods** added to the `API` object:
- `analyzeProjectReset(slug)` — POST with `{ dry_run: true }`
- `applyProjectReset(slug, decisions)` — POST with `{ dry_run: false, decisions }`

**"Reset Project" button** inserted into `renderProjectDetail()` header area. Click handler calls `analyzeProjectReset()` and, if any WPs need reset, opens `showResetModal()`; otherwise shows a brief "project is healthy" toast.

**`showResetModal(slug, diagnosis)`** renders a full modal overlay with:
1. **Header** with title and × close button.
2. **Summary banner**: "Analysis found N broken work packages out of M total."
3. **Bulk controls**: "Reset All Broken" and "Skip All" buttons.
4. **Per-WP rows** (collapsed by default, expandable):
   - WP ID + status badge.
   - Pipeline stage indicators: 4 small badges (green = PASS present, red = missing, grey = CANCELLED/N/A).
   - Diagnosis text (e.g., "Missing: qa, code-review, documentation → will resume at QA").
   - Action radio buttons: Reset / Skip / Cancel, pre-selected from `suggested_action`.
   - "Reset acceptance criteria" checkbox (visible when Reset is selected, pre-checked from `suggested_reset_criteria`).
   - `CANCELLED` WPs are greyed-out informational rows with no controls.
5. **Live summary footer** updating on every selection change ("X will be reset, Y skipped, Z cancelled").
6. **Apply Reset** (disabled when 0 WPs have reset/cancel action) and **Cancel** buttons.

On successful apply: modal closes, success toast shown, project detail refreshed. Modal can be dismissed via ×, Cancel, or backdrop click.

CSS additions follow the existing CSS variable system: `.reset-modal-overlay`, `.reset-modal-header`, `.reset-bulk-controls`, `.reset-modal-footer`, `.wp-diagnosis-row` (`.collapsed` / `.expanded`), `.pipeline-badge` (`.pass` / `.missing` / `.na`) — all in `styles.css` lines 817–1040.

### WP-005 — Unit Tests for Reset Utility Functions

14 Vitest unit tests in `mcp-server/tests/utils/project-reset.test.ts` covering:

**`analyzeProjectForReset()` cases**:
- Healthy project (all 4 pipelines PASS) → `needs_reset: false` for all WPs.
- WP with only implementation → detects 3 missing stages.
- WP with implementation + QA PASS → detects 2 missing stages.
- `CANCELLED` WP → skipped (no controls, greyed-out).
- WP with no pipelines → full restart from `implementation`.
- WP with `FAIL` implementation → `next_required_stage: 'implementation'` (retry).
- `IN_PROGRESS` WP with correct `assigned_to` → `suggested_action: skip`.
- `BLOCKED` WP → `suggested_action: skip`.
- `READY` WP → `suggested_action: skip`.
- Auto-cancelled pipeline entries excluded from stage-present detection.
- Mixed project → correct broken/healthy counts.

**`applyProjectReset()` cases**: covered in WP-006 test suite.

All tests use in-memory fixture objects (no real file I/O or ledger reads).

### WP-006 — API Handler Integration Tests

13 integration tests in `mcp-server/tests/gui/api-reset.test.ts` calling `handleResetProject()` directly against a real `LedgerStore` in a temp directory:

1. Dry-run returns `ProjectResetDiagnosis` with correct per-WP analysis; no file writes.
2. Apply mode writes correct WP state and returns accurate `ProjectResetResult` counts.
3. Apply mode without `decisions` → 400 `VALIDATION_ERROR`.
4. Invalid slug characters → 400 `ApiError`.
5. Non-existent project slug → 404 `NOT_FOUND`.
6. Malformed body (`dry_run` as string) → 400 `ApiError`.
7. Invalid decision action value → 400 `ApiError`.
8. Empty `decisions` map is valid (all WPs default to skip).
9. Partial decisions map: absent WP IDs default to skip.
10. `reset_criteria: true` resets all `met` flags to `false`.
11. `reset_criteria: false` preserves existing `met` values.
12. `CANCELLED` WPs ignored regardless of decisions entry.
13. Root index updated with correct counters, status, and audit comment.

---

## Metrics Summary

### Test Coverage

| Metric | Value |
|--------|-------|
| Total tests (full suite) | 1040 |
| Tests passed | 1040 |
| Tests failed | 0 |
| Test files | 35 |
| New tests (project-reset.test.ts) | 14 |
| New tests (api-reset.test.ts) | 13 |
| New tests total | 27 |

### Acceptance Criteria

| WP | Component | AC Met | AC Total |
|----|-----------|--------|----------|
| WP-001 | Analysis utility | 8 | 8 |
| WP-002 | Mutation function | 11 | 11 |
| WP-003 | API handler + route | 7 | 7 |
| WP-004 | Frontend UI + CSS | 24 | 24 |
| WP-005 | Unit tests | 5 | 5 |
| WP-006 | Integration tests | 17 | 17 |
| **Total** | | **72** | **72** |

### TypeScript

| Metric | Value |
|--------|-------|
| Compilation errors | 0 |
| New source file | 1 (`project-reset.ts`) |
| New test files | 2 (`project-reset.test.ts`, `api-reset.test.ts`) |
| Modified source files | 4 (`api.ts`, `server.ts`, `app.js`, `styles.css`) |
| Manifest docs updated | 2 (`file-tree.md`, `api-surface.md`) |

---

## File Inventory

### Created

| File | Purpose |
|------|---------|
| `mcp-server/src/utils/project-reset.ts` | Analysis and mutation logic (pure + locking) |
| `mcp-server/tests/utils/project-reset.test.ts` | 14 unit tests for analysis + mutation |
| `mcp-server/tests/gui/api-reset.test.ts` | 13 integration tests for the API handler |

### Modified

| File | Change |
|------|--------|
| `mcp-server/gui/api.ts` | `handleResetProject()` handler (line 537) |
| `mcp-server/gui/server.ts` | POST `/api/projects/:slug/reset` route (lines 351–376) |
| `mcp-server/gui/public/app.js` | API client methods, reset button, `showResetModal()` |
| `mcp-server/gui/public/styles.css` | Modal and pipeline-badge styles (lines 817–1040) |
| `mcp-server/docs/agents/project-manifest/file-tree.md` | Added `project-reset.ts`, `project-reset.test.ts`, `api-reset.test.ts` entries |
| `mcp-server/docs/agents/project-manifest/api-surface.md` | Documented all 4 interfaces, both functions, handler signature, route, and frontend API/modal |

---

## Key Architecture Decisions

### 1. Dry-Run First, Apply Second

The two-phase API (`dry_run: true` → diagnosis, `dry_run: false` + decisions → apply) prevents accidental destructive operations. The frontend always calls analyze first, presents the diagnosis in the modal with sensible defaults, and only submits decisions after the user explicitly confirms. This is the critical safety gate for a feature that writes to production ledger JSON.

### 2. Smart Defaults Eliminate Manual Review for the Common Case

The analysis function sets `suggested_action: 'reset'` for all genuinely broken WPs and `suggested_action: 'skip'` for healthy/READY/BLOCKED WPs. For the canonical broken scenario (all WPs force-completed after only `implementation`), every row is pre-selected to "Reset". The user can open the modal, verify the summary banner, and click "Apply" in seconds without reviewing individual rows.

### 3. Pure Analysis Function

`analyzeProjectForReset()` takes plain in-memory objects (no `LedgerStore` dependency) and returns a deterministic result. This made the 14 unit tests trivially simple — no temp directories, no async setup, no file I/O mocking. The mutation function (`applyProjectReset`) handles all I/O concerns in one place.

### 4. Pipeline History Preservation

Existing pipeline entries are never deleted or modified, even for "broken" WPs. The reset only changes `status`, `assigned_to`, `status_changed_at`, and optionally `acceptance_criteria[*].met`. The full audit trail (implementation summaries, artifacts, timestamps) survives the reset and remains visible in the GUI.

### 5. Stale-State Guard Under Lock

The apply function re-reads each WP inside the `withLock()` scope. If a WP's status has changed between the dry-run analysis and the apply call (e.g., an agent is actively working), that WP is silently skipped and listed in the response's `stale_skipped` field. This prevents overwriting legitimate in-progress work with reset state.

### 6. GUI-Only, Not an MCP Tool

The reset endpoint is a REST API consumed exclusively by the GUI admin interface. Deliberately not exposed as an MCP tool, this prevents agents from accidentally (or intentionally) calling a destructive recovery operation during normal workflow execution.

---

## Problem Solved

### Before This Feature

If an agent set all WPs to `COMPLETE` with only an `implementation` PASS — a real scenario documented in the plan — the ledger had no recovery path. The only option was manual JSON editing: find the affected WPs, reset `status`, clear `synthesis_generated`, recompute `pending_work_packages`, fix `assigned_to` on each WP, and hope nothing was missed. On a 6-WP project this took ~15 minutes and was error-prone.

### After This Feature

1. Open the project in the GUI.
2. Click "Reset Project".
3. Review the summary banner ("6 broken work packages detected").
4. Click "Apply Reset".
5. Done — all 6 WPs are now `IN_PROGRESS` with the correct next-stage `assigned_to`, criteria reset, root index updated, and an audit comment appended.

Estimated time: under 30 seconds. No JSON editing. No risk of partial updates.

---

## Strategic Recommendations

### 1. Wire `reset_at` Timestamp to WP Detail (Low Priority)

The apply function currently sets `status_changed_at` on each reset WP but does not record a dedicated `reset_at` timestamp. If a future audit query wants "which WPs were recovered and when", the data is technically present in the `project_comment`, but there is no typed field. Consider adding `reset_at?: string` to `WorkPackageDetailSchema` if recovery audit trails become a reporting requirement.

### 2. Add a "Healthy Project" Visual Indicator (Low Priority)

When `analyzeProjectForReset()` finds `work_packages_needing_reset === 0`, the current flow shows a toast message and does not open the modal. There is no persistent visual on the project detail page indicating that workflow completeness was verified. A small health badge (✓ All pipelines complete) on the project card would make health status glanceable without requiring a manual reset trigger.

### 3. Smoke-Test the Real Broken Project (Immediate / Manual)

The plan documents a specific broken project (`2026-03-04-preserve-index-metadata`) as the canonical test target. Now that the feature is deployed, manually verifying the end-to-end flow on that project will confirm the full stack (analysis, modal rendering, apply, root index recompute) outside of the unit/integration test fixtures. A one-time manual verification is all that is needed.

### 4. Consider Exposing Aggregate Reset Stats in `get_project_status` (Low Priority)

`get_project_status` already self-heals counters. Extending it to return a `pipeline_health` sub-object (e.g., `{ wps_with_all_stages_pass: 4, wps_missing_stages: 2 }`) would allow agents and the GUI to surface health information passively, without the user needing to trigger an explicit reset analysis.

---

## Conclusion

The semi-intelligent project reset feature is a high-leverage operational tool that converts a multi-step error-prone manual JSON editing process into a sub-30-second guided GUI workflow. The implementation is clean, fully tested, and architecturally sound: pure analysis logic separated from locking mutation logic, a typed REST API with clear error semantics, and a frontend modal designed for the common case (confirm and apply) while supporting fine-grained per-WP override.

All 6 work packages are complete, all 72 acceptance criteria are met, and 1040/1040 tests are passing. The project is ready for production use.

---

*Generated by Synthesis Agent on 2026-03-05*
