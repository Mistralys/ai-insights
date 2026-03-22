# Plan: Semi-Intelligent Project Reset

## Summary

Add a "reset project to healthy state" feature that intelligently analyzes each work package in a ledger, detects which pipeline stages are missing (compared to the required `implementation → qa → code-review → documentation` sequence), and presents the user with an interactive diagnosis in the GUI. The user can then make per-WP decisions (reset, skip, or cancel) before applying. The feature is exposed as a REST API endpoint consumed by a "Reset Project" button in the ledger GUI's project detail page.

## Architectural Context

### Existing Components Involved

- **LedgerStore** ([mcp-server/src/storage/ledger-store.ts](mcp-server/src/storage/ledger-store.ts)) — Provides `readRootIndex()`, `readWorkPackage()`, `writeWorkPackage()`, `writeRootIndex()`, `updateWorkPackageWithSync()`, and `withLock()` for atomic multi-file writes. All writes go through `atomicWriteJson()`.
- **Pipeline maps** ([mcp-server/src/utils/pipeline-maps.ts](mcp-server/src/utils/pipeline-maps.ts)) — `PIPELINE_TYPES` defines the canonical 4-stage ordering: `['implementation', 'qa', 'code-review', 'documentation']`. `PIPELINE_AGENT_MAP` maps each pipeline type to its responsible agent role.
- **GUI API** ([mcp-server/gui/api.ts](mcp-server/gui/api.ts)) — Pure async handler functions called by the HTTP server. Existing patterns: each handler takes `ledgerRoot` + route params, returns a result or throws `ApiError`.
- **GUI Server** ([mcp-server/gui/server.ts](mcp-server/gui/server.ts)) — Custom Node.js HTTP router. Routes are matched by method + segment count in `matchRoute()`. POST support already exists implicitly (body-reading function `readBody()` is present; PUT `/api/config` uses it). New routes are added to the `matchRoute()` function.
- **Frontend** ([mcp-server/gui/public/app.js](mcp-server/gui/public/app.js)) — Vanilla JS SPA. Uses `API.*` client methods, hash-based routing, and HTML template functions. Project detail page is rendered in `renderProjectDetail()`.
- **Schemas** — `RootIndexSchema` ([mcp-server/src/schema/root-index.ts](mcp-server/src/schema/root-index.ts)) and `WorkPackageDetailSchema` ([mcp-server/src/schema/work-package.ts](mcp-server/src/schema/work-package.ts)) enforce structure via Zod validation on every read/write.

### The Problem Being Solved

Agents can go off-script and set all WPs to `COMPLETE` with `assigned_to: Developer` after only running the `implementation` pipeline — skipping `qa`, `code-review`, and `documentation` entirely. The existing self-healing in `ledger_get_project_status` only fixes project-level status/counters, not per-WP pipeline gaps. There is currently no mechanism to detect and repair per-WP workflow violations.

### Example of a Broken Ledger

The project `2026-03-04-preserve-index-metadata` has 6 WPs. Each WP has:
- `status: "COMPLETE"`, `assigned_to: "Developer"`
- Only 1 pipeline: `implementation` with `PASS` status
- All acceptance criteria marked `met: true`
- Missing: `qa`, `code-review`, and `documentation` pipelines

The project-level `status` is `COMPLETE` with `pending_work_packages: 0` and `synthesis_generated: false`.

## Approach / Architecture

### Reset Analysis Algorithm

For each work package in the project, determine the **expected next pipeline stage** by examining the existing pipelines array:

1. **CANCELLED WPs** — Skip entirely. Never touch cancelled WPs.
2. **Identify the furthest completed pipeline stage** — Walk the pipeline array and find the most recent non-auto-cancelled pipeline for each type. Determine the last PASS stage in the canonical order.
3. **Determine missing stages** — Compare against the required sequence `[implementation, qa, code-review, documentation]`. Any stages after the last PASS that don't have a PASS are "missing".
4. **If no implementation PASS exists** — The WP needs to restart from implementation.
5. **If all 4 stages have PASS and the WP is COMPLETE** — The WP is healthy; skip it.
6. For each WP needing reset, produce a diagnosis including a **suggested action** (`reset`) and **suggested settings** (target stage, assigned_to, criteria reset). These are defaults that the user can override.

### User Decision Points (Interactive GUI Flow)

After the analysis runs, the GUI presents the diagnosis and lets the user make **per-WP decisions** before applying. The analysis pre-selects sensible defaults for every WP so that for typical broken projects the user can review the summary and click "Apply" immediately.

#### Default Selection Logic

The analysis function sets a `suggested_action` and `suggested_reset_criteria` per WP. These become the pre-selected values in the modal:

| WP Condition | Default Action | Default Reset Criteria | Rationale |
|-------------|----------------|----------------------|-----------|
| CANCELLED | (locked — no controls) | — | Terminal status, never touched |
| COMPLETE + all 4 pipelines PASS | **Skip** | — | Genuinely healthy, no action needed |
| COMPLETE + missing pipeline stages | **Reset** | `true` | The core broken case — prematurely completed |
| IN_PROGRESS + correct assigned_to | **Skip** | — | Already in the right state |
| IN_PROGRESS + wrong assigned_to or missing stages | **Reset** | `true` | Partially broken |
| BLOCKED (dependency type) | **Skip** | — | Will unblock naturally once dependencies are reset |
| BLOCKED (non-dependency type) | **Skip** | — | Has a real blocker, user must decide |
| READY | **Skip** | — | Hasn't started, nothing to fix |

The goal: **for the most common scenario (all WPs force-completed after only implementation), every broken WP is auto-selected as "Reset" and every healthy WP is auto-selected as "Skip" — the user just verifies the summary and confirms.**

#### Per-WP Action (radio per row)

| Action | Effect | When to use |
|--------|--------|-------------|
| **Reset** (default for broken WPs) | Set WP to `IN_PROGRESS`, assign to the agent for the next missing pipeline stage | Normal recovery — resume the workflow where it should have been |
| **Skip** (default for healthy WPs) | Leave the WP untouched | WP is already healthy, or user wants to deal with it manually |
| **Cancel** | Set WP to `CANCELLED` | User decides this WP's work is no longer needed |

#### Per-WP Options (shown when action is "Reset")

| Option | Default | Description |
|--------|---------|-------------|
| **Reset acceptance criteria** | `true` | Set all `met` flags to `false`, forcing QA/review to re-evaluate. User can toggle `false` to trust the Developer's self-assessment. |

#### Bulk Controls (above the WP list)

For projects with many WPs, the modal provides quick-action buttons that override individual selections:
- **"Reset All Broken"** — Sets all WPs with `needs_reset: true` to "Reset" (restores defaults)
- **"Skip All"** — Sets all non-CANCELLED WPs to "Skip"

These allow the user to quickly set a baseline and then adjust individual WPs if needed.

#### Project-Level Summary (shown at bottom of modal)

The modal footer shows a live summary that updates as the user changes selections:
- "X work packages will be reset, Y skipped, Z cancelled"
- "Project status will change from COMPLETE → IN_PROGRESS"

This interactive flow is the key differentiator from a brute-force reset — the analysis does the heavy lifting of determining what's broken and pre-selects the right actions, while the user retains override capability for edge cases.

### Reset Application (Write Phase)

When the user confirms, the apply endpoint receives the per-WP decisions:

For WPs with action `reset`:
   - Set `status: "IN_PROGRESS"`
   - Set `assigned_to` based on the next needed pipeline stage (via `PIPELINE_AGENT_MAP`)
   - If `reset_criteria` is `true`: reset `acceptance_criteria[*].met` to `false`
   - Update `status_changed_at`
   - **Do NOT delete or modify existing pipelines** — they contain valid implementation records

For WPs with action `cancel`:
   - Set `status: "CANCELLED"`
   - Update `status_changed_at`

For WPs with action `skip`:
   - No changes

### Reset at the Project Level

- Update the root index: set each affected WP summary's `status` to `IN_PROGRESS` and `assigned_to` to the correct agent
- Recompute `pending_work_packages` as the count of non-terminal WPs
- Set project `status` to `IN_PROGRESS`
- Set `synthesis_generated` to `false`
- Reset `auto_handoff_depth` to `0`
- Append a `project_comment` documenting the reset action

### Dry-Run Mode

The analysis endpoint returns the diagnosis without writing anything. The GUI shows the diagnosis with per-WP decision controls, then sends the user's choices back to the apply endpoint. This two-step flow prevents accidental data loss and gives the user full control.

### API Shape

**Phase 1 — Analyze:**
```
POST /api/projects/:slug/reset
Body: { "dry_run": true }
Response: ProjectResetDiagnosis (per-WP analysis with suggested actions)
```

**Phase 2 — Apply:**
```
POST /api/projects/:slug/reset
Body: {
  "dry_run": false,
  "decisions": {
    "WP-001": { "action": "reset", "reset_criteria": true },
    "WP-002": { "action": "skip" },
    "WP-003": { "action": "reset", "reset_criteria": false },
    "WP-004": { "action": "cancel" }
  }
}
Response: ProjectResetResult (what was actually changed)
```

The `decisions` map is keyed by WP ID. Each entry specifies:
- `action`: `"reset"` | `"skip"` | `"cancel"`
- `reset_criteria`: `boolean` (only relevant when action is `"reset"`, defaults to `true`)

If a WP ID from the diagnosis is absent from `decisions`, it defaults to `"skip"`.

### GUI Integration

A "Reset Project" button appears on the project detail page. Clicking it:
1. Calls the endpoint with `dry_run: true` to get the diagnosis
2. Opens a modal showing per-WP diagnosis cards with interactive controls:
   - Each WP row shows: WP ID, current status, stages present/missing, suggested action
   - Radio buttons for action: Reset (default for broken) / Skip (default for healthy) / Cancel
   - Checkbox for "Reset acceptance criteria" (shown when Reset is selected, default checked)
   - Visual pipeline stage indicators (green for present, red for missing)
3. Footer shows live summary of pending changes
4. On confirm: sends `dry_run: false` with the user's `decisions` map
5. On success: refreshes the project view
6. On cancel: closes modal, no changes

## Rationale

- **Semi-intelligent analysis + user control** — The server does the heavy lifting of detecting what's broken per-WP, but the user makes the final call on each WP. This avoids both the rigidity of a blanket reset and the tedium of manual investigation.
- **Per-WP action choices** — Different WPs may need different treatment. Some might be genuinely complete (skip), some need pipeline continuation (reset), and some may no longer be relevant (cancel). Giving the user these options in a single modal is far more efficient than handling each WP individually.
- **Optional criteria reset** — The user can decide whether to trust the Developer's acceptance criteria assessment on a per-WP basis. For simple WPs the implementation self-assessment may be reliable; for complex ones, forcing QA re-evaluation is safer.
- **Dry-run first** — Prevents accidental destructive operations. The user sees exactly what will change before committing.
- **GUI-only (no MCP tool)** — This is an admin/recovery operation, not an agent workflow action. Exposing it as an MCP tool would risk agents calling it during normal execution. The REST API is exclusively for human use via the GUI.
- **Pipeline history preservation** — Existing pipeline entries are never deleted. They contain valid audit data (implementation summaries, artifacts, timestamps). The reset only changes WP status/assignment and optionally criteria flags.

## Detailed Steps

### 1. Create the reset analysis utility function

**New file:** `mcp-server/src/utils/project-reset.ts`

Implement the pure analysis function:

```typescript
interface WpResetDiagnosis {
  work_package_id: string;
  current_status: string;
  current_assigned_to: string | null;
  pipeline_stages_present: string[];    // e.g. ['implementation']
  pipeline_stages_missing: string[];    // e.g. ['qa', 'code-review', 'documentation']
  next_required_stage: string | null;   // e.g. 'qa'; null when healthy or cancelled
  target_assigned_to: string | null;    // e.g. 'QA'; null when healthy or cancelled
  needs_reset: boolean;
  reason: string;
  suggested_action: 'reset' | 'skip';              // pre-selected default for the GUI
  suggested_reset_criteria: boolean;                // pre-selected default for criteria checkbox
}

interface ProjectResetDiagnosis {
  project_slug: string;
  current_project_status: string;
  work_packages: WpResetDiagnosis[];
  work_packages_needing_reset: number;
  work_packages_healthy: number;
  work_packages_skipped: number;        // CANCELLED count
}
```

This function:
- Takes a `RootIndex` and an array of `WorkPackageDetail` objects
- Returns a `ProjectResetDiagnosis` with per-WP analysis
- Is a **pure function** (no I/O) for easy unit testing

### 2. Create the reset application function

In the same file, implement the mutation function:

```typescript
interface WpDecision {
  action: 'reset' | 'skip' | 'cancel';
  reset_criteria?: boolean;              // default true; only relevant when action === 'reset'
}

interface ProjectResetResult {
  diagnosis: ProjectResetDiagnosis;
  applied: true;
  work_packages_reset: string[];       // IDs of WPs that were reset
  work_packages_cancelled: string[];   // IDs of WPs that were cancelled
  work_packages_skipped: string[];     // IDs of WPs that were skipped
  project_comment_added: string;       // The audit comment text
}
```

This function:
- Takes a `LedgerStore`, the diagnosis, and a `Record<string, WpDecision>` decisions map
- Wraps all writes in a single `withLock(store.storageDir)` scope
- For each WP per the user's decision:
  - `reset`: reads WP, sets `IN_PROGRESS`, correct `assigned_to`, optionally resets criteria, writes WP
  - `cancel`: reads WP, sets `CANCELLED`, writes WP
  - `skip`: no-op
- Updates root index: WP summaries, pending counter, project status, synthesis flag, comment
- Returns the result summary

### 3. Add the GUI API handler

**Modified file:** `mcp-server/gui/api.ts`

Add `handleResetProject(ledgerRoot: string, slug: string, body: unknown)`:
- Validates slug
- Parses the body with a Zod schema to extract `dry_run` and optional `decisions`
- Creates `LedgerStore`, reads root index and all WP details
- Calls the analysis function
- If `dry_run === true`: returns the diagnosis only
- If `dry_run === false`: validates that `decisions` is present, calls the mutation function with the user's decisions, returns the result

### 4. Add the server route

**Modified file:** `mcp-server/gui/server.ts`

Add a `POST /api/projects/:slug/reset` route:
- Import the new handler
- Wire it in `matchRoute()` (POST, rest.length === 3, rest[2] === 'reset')
- Parse the JSON body to extract `dry_run`
- Special handling for POST in the request handler similar to PUT `/api/config`

### 5. Add the frontend API client methods

**Modified file:** `mcp-server/gui/public/app.js`

Add to the `API` object:
```javascript
analyzeProject: function (slug) {
  return request('POST', '/projects/' + encodeURIComponent(slug) + '/reset', { dry_run: true });
},
applyProjectReset: function (slug, decisions) {
  return request('POST', '/projects/' + encodeURIComponent(slug) + '/reset', { dry_run: false, decisions: decisions });
}
```

### 6. Add the reset button and interactive diagnosis modal to the project detail view

**Modified file:** `mcp-server/gui/public/app.js`

In `renderProjectDetail()`:
- Add a "Reset Project" button in the page header area (next to the existing status badge)
- On click: call `API.analyzeProject(slug)` to get diagnosis, then open modal

**New function:** `showResetModal(slug, diagnosis)`

Builds and inserts a modal overlay into the DOM with:

1. **Header:** "Reset Project — {slug}" with a close (×) button

2. **Summary banner** at top: "Analysis found X broken work packages out of Y total." — gives the user an immediate understanding of severity without needing to review individual rows.

3. **Bulk controls:** "Reset All Broken" and "Skip All" buttons above the WP list for mass selection.

4. **Per-WP rows** (one card per WP in diagnosis):
   - WP ID + current status badge
   - Pipeline stage indicators: 4 small stage badges (implementation/qa/code-review/documentation), colored green (PASS present), red (missing), or grey (N/A for CANCELLED)
   - Diagnosis text: e.g. "Missing: qa, code-review, documentation → will resume at QA"
   - Action radio buttons: Reset / Skip / Cancel — **pre-selected** per `suggested_action` from the analysis
     - Broken WPs pre-selected to "Reset", healthy WPs pre-selected to "Skip"
     - CANCELLED WPs are shown as greyed-out informational rows (no controls)
   - Criteria checkbox: "Reset acceptance criteria to unmet" — **pre-checked** per `suggested_reset_criteria` (shown only when Reset is selected)
   - WP rows are **collapsed by default** to just the WP ID + status + suggested action summary. An expand toggle reveals the full pipeline breakdown and radio controls. This keeps the modal scannable for large projects.

5. **Live summary footer** that updates as user toggles:
   - "3 will be reset, 2 skipped, 1 cancelled"
   - If any WPs are being reset: "Project status → IN_PROGRESS"

6. **Action buttons:** "Apply Reset" (primary) + "Cancel" (secondary)
   - "Apply Reset" disabled when 0 WPs are being reset or cancelled (no-op guard)
   - On Apply: build `decisions` map from form state, call `API.applyProjectReset(slug, decisions)`
   - On success: close modal, show brief success toast, refresh project view
   - On Cancel: close modal

The design philosophy: **for the common case, the user opens the modal, sees "6 broken WPs will be reset", and clicks Apply.** Expanding rows and changing per-WP settings is there for edge cases but not required.

### 7. Add modal CSS styles

**Modified file:** `mcp-server/gui/public/styles.css`

Add styles for a simple confirmation modal (overlay, card, WP diagnosis cards, confirm/cancel buttons). Follow existing design system conventions (CSS variables, `.card`, `.badge`, `.btn` classes).

### 8. Write unit tests for the analysis function

**New file:** `mcp-server/tests/utils/project-reset.test.ts`

Test cases for `analyzeProjectForReset()`:
- Healthy project (all 4 pipelines PASS) → `needs_reset: false` for all WPs
- WP with only implementation → detects missing qa/code-review/documentation
- WP with implementation + qa PASS → detects missing code-review/documentation
- CANCELLED WP → skipped
- WP with BLOCKED status → still analyzed (might have been force-completed)
- WP with no pipelines → needs full restart from implementation
- WP with FAIL implementation → next stage is implementation (retry)
- Mixed project (some healthy, some broken) → correct counts

Test cases for `applyProjectReset()`:
- Applies "reset" action: WP transitions to IN_PROGRESS with correct assigned_to
- Applies "cancel" action: WP transitions to CANCELLED
- Applies "skip" action: WP is unchanged
- Mixed decisions across multiple WPs
- `reset_criteria: true` resets met flags; `reset_criteria: false` preserves them
- Root index is updated with correct counters, status, and audit comment
- Missing WP IDs in decisions map default to skip

### 9. Write unit tests for the API handler

**New file or extended:** `mcp-server/tests/gui/api.test.ts` (or a new `api-reset.test.ts`)

Test the handler with mock LedgerStore:
- Dry-run returns diagnosis, no writes
- Apply mode with decisions writes correct state per user choices
- Apply mode without decisions → validation error
- Invalid slug → 404
- Non-existent project → 404

## Dependencies

- `PIPELINE_TYPES` and `PIPELINE_AGENT_MAP` from `mcp-server/src/utils/pipeline-maps.ts`
- `LedgerStore` from `mcp-server/src/storage/ledger-store.ts`
- `withLock` from `mcp-server/src/storage/lock.ts`
- `now()` from `mcp-server/src/utils/timestamp.ts`
- Existing Zod schemas for validation

## Required Components

- **New:** `mcp-server/src/utils/project-reset.ts` — Analysis and mutation logic
- **New:** `mcp-server/tests/utils/project-reset.test.ts` — Unit tests
- **Modified:** `mcp-server/gui/api.ts` — New handler function
- **Modified:** `mcp-server/gui/server.ts` — New POST route + POST body parsing in matchRoute, update `handleRequest` to handle POST for this route
- **Modified:** `mcp-server/gui/public/app.js` — API method, reset button, confirmation modal
- **Modified:** `mcp-server/gui/public/styles.css` — Modal and diagnosis card styles

## Assumptions

- The reset operation is a GUI-only admin action; no MCP tool is needed.
- Existing pipeline history (implementation PASS records) should be preserved.
- The user makes per-WP decisions on whether to reset, skip, or cancel. The analysis provides smart defaults (reset for broken WPs, skip for healthy ones) but the user has final say.
- Acceptance criteria `met` flags are reset to `false` by default for WPs being reset, but this is user-configurable per WP.
- The analysis logic only considers the most recent non-auto-cancelled pipeline of each type when determining presence of a PASS.
- WPs absent from the `decisions` map in the apply request default to `skip`.

## Constraints

- **Constraint 1 (Atomic writes):** All file writes must use `atomicWriteJson()`.
- **Constraint 2 (Locking):** Multi-file updates must be wrapped in `withLock(store.storageDir)`.
- **Constraint 7 (STDIO):** No `stdout` writes in server-side code; use `stderr` for logging.
- **Constraint 10 (Pretty JSON):** JSON files are 2-space-indented with trailing newline (handled by `atomicWriteJson`).
- **Constraint 4 (No plan-folder writes):** The reset operation only modifies files in `storage/ledger/{slug}/`.

## Out of Scope

- Exposing the reset as an MCP tool (this is admin-only).
- Automatic detection of broken projects (user triggers reset manually).
- Modifying or deleting existing pipeline entries.
- Resetting rework counts (they should be preserved as-is).
- Handling the subsequent re-execution of pipelines (that's the normal workflow's job after reset).

## Acceptance Criteria

- Given a project where all WPs have only an `implementation` PASS and are marked `COMPLETE`: the dry-run endpoint correctly diagnoses each WP as needing reset, listing `qa`, `code-review`, and `documentation` as missing stages.
- Given a healthy project where all WPs have all 4 pipeline PASS stages: the dry-run endpoint reports all WPs as healthy with `needs_reset: false`.
- When the user selects "Reset" for a WP and applies: the WP transitions to `IN_PROGRESS` with the correct `assigned_to` (e.g., `QA` if `implementation` PASS exists but `qa` is missing).
- When the user selects "Reset" with "Reset acceptance criteria" checked: all `met` flags are set to `false` on that WP.
- When the user selects "Reset" with "Reset acceptance criteria" unchecked: `met` flags are preserved as-is.
- When the user selects "Cancel" for a WP and applies: the WP transitions to `CANCELLED`.
- When the user selects "Skip" for a WP: no changes are made to that WP.
- When reset is applied: the root index is updated with correct `pending_work_packages`, `status: IN_PROGRESS`, `synthesis_generated: false`.
- When reset is applied: a project comment is appended documenting the reset action and listing per-WP decisions.
- Existing pipeline entries are never deleted or modified by the reset.
- The GUI shows a "Reset" button on the project detail page.
- The GUI shows an interactive diagnosis modal with per-WP action controls (Reset/Skip/Cancel) and a criteria reset checkbox.
- The modal shows a live summary footer that updates as the user changes selections.
- CANCELLED work packages are shown as informational rows in the modal but cannot be interacted with.
- All new code has unit test coverage.
- The dry-run endpoint does not perform any file writes.

## Testing Strategy

- **Unit tests** for the pure analysis function with various WP configurations (healthy, partially broken, fully broken, CANCELLED, BLOCKED, mixed).
- **Unit tests** for the mutation function verifying correct state transitions and file write patterns.
- **Integration tests** for the API handler covering dry-run vs. apply modes, error cases, and edge cases.
- **Manual testing** via the GUI: trigger reset on the broken `2026-03-04-preserve-index-metadata` project and verify the WPs are correctly reset.
- Run existing test suite to confirm no regressions.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Reset applied to a healthy project accidentally** | Dry-run mode is always shown first. The user sees the diagnosis and must explicitly choose per-WP actions before applying. |
| **Race condition: agent writes during reset** | Entire reset is wrapped in `withLock(store.storageDir)`, preventing concurrent modifications. |
| **Resetting acceptance criteria breaks tracking** | Controlled per-WP by the user via checkbox. The reset preserves the original criterion text; only the `met` boolean is affected. |
| **User cancels WPs they shouldn't** | The modal clearly labels each action. Cancel is a deliberate choice that must be selected per-WP. The audit comment records every decision for traceability. |
| **Edge case: WP with FAIL implementation** | The analysis correctly identifies this as needing implementation retry, setting `next_required_stage: 'implementation'` and `target_assigned_to: 'Developer'`. |
| **Edge case: WP is BLOCKED with a non-dependency blocker** | Shown in the modal diagnosis. If the user selects "Reset", it overrides to `IN_PROGRESS`. The audit comment documents this override. |
| **Stale diagnosis: project state changes between analyze and apply** | The apply function re-reads all WPs under lock before writing. If a WP's status has changed since the diagnosis, it is skipped with a warning in the response. |
