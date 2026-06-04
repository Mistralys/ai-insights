# Plan

## Plan Audit Cycles
- Audits: 5 — Plan Auditor v1.4.0
- Architectural Reviews: 2 — Plan Architect Reviewer v1.5.0

## Summary

Implement a new MCP tool `ledger_reopen_cancelled_wp` that provides a PM-only administrative escape hatch to recover incorrectly cancelled work packages. CANCELLED is terminal in the normal state machine and must remain so; this tool bypasses the state machine explicitly (same pattern as `ledger_reset_rework_count`). The tool transitions a CANCELLED WP to READY with full side effects: counter adjustment, rework count clearing, assignment clearing, synthesis invalidation, cascade reblock on downstream dependents, and mandatory audit comment. Accompanying spec updates, persona updates, manifest updates, and test coverage complete the feature.

## Architectural Context

**State Machine (WP statuses):**
- Defined in `mcp-server/src/schema/validators.ts` — `isValidStatusTransition()` returns `false` for all transitions from CANCELLED (line ~42).
- `isTerminalStatus()` (same file, line ~4) treats CANCELLED and COMPLETE as terminal.
- The terminal invariant is load-bearing: dependency satisfaction logic (`propagateDependencyUnblock`), counter arithmetic (`pending_work_packages` = total − terminal), and `isTerminalStatus` call sites rely on CANCELLED never transitioning out.

**Administrative Override Pattern:**
- `ledger_reset_rework_count` in `mcp-server/src/tools/work-package.ts` (line ~1158–1340) provides the exact pattern: PM-only guard → Zod schema → `updateWorkPackageWithSync` → audit comment → structured response.
- Registration at line ~1421 in the same file.

**Atomic Storage Operations:**
- `LedgerStore.updateWorkPackageWithSync()` in `mcp-server/src/storage/ledger-store.ts` (line ~278) — updater callback receives `(wp, root)`, auto-stamps `last_updated`, syncs `passed_stages`, validates via Zod, writes atomically.
- `clearSynthesisState()` in `mcp-server/src/utils/workflow-helpers.ts` (line ~87) — sets `synthesis_generated = false`.

**Cascade Reblock:**
- `propagateDependencyReblock()` in `mcp-server/src/tools/work-package.ts` (line ~1015) — async function that scans for downstream dependents in READY/IN_PROGRESS and re-blocks them. Already called when COMPLETE → IN_PROGRESS occurs (line ~970).

**Workflow Specification:**
- `mcp-server/docs/agents/workflow-specification/` contains: `state-machines.md`, `edge-cases.md`, `operations.md`, `dependencies-and-rework.md`, and others.

**Ledger Doctor Persona:**
- `personas/standalone/src/content/ledger-doctor.md` — contains Diagnostic Toolkit (Write Tools table), Diagnostic Protocol (Step 2: Identify Anomalies), and repair procedures.

## Approach / Architecture

Add a single new tool `ledger_reopen_cancelled_wp` in `mcp-server/src/tools/work-package.ts`, following the `ledger_reset_rework_count` pattern exactly:

1. **Zod schema** defines the input (project path, WP ID, agent_role, reason — no pipeline_type since we clear all rework counts).
2. **PM-only guard** rejects non-PM callers before any disk I/O.
3. **Precondition check** validates the target WP is currently CANCELLED.
4. **`updateWorkPackageWithSync`** performs the atomic state change with all side effects inside the updater callback.
5. **Post-write `propagateDependencyReblock`** handles cascade reblock on downstream dependents (same call site pattern as the COMPLETE → IN_PROGRESS path).
6. **Root summary sync** keeps `root.work_packages[]` entries consistent with WP detail (same pattern as `updateWorkPackageStatus` L873–L877).
7. **Structured JSON response** confirms the reopen with all changed fields.

The normal state machine (`isValidStatusTransition`) remains unchanged — this tool explicitly bypasses it, just as `ledger_reset_rework_count` bypasses the rework limit.

## Rationale

1. **Spec integrity preserved:** CANCELLED remains terminal in the normal flow. All existing `isTerminalStatus()` call sites, dependency satisfaction logic, and counter arithmetic continue to work unmodified.
2. **Forced auditability:** The dedicated tool requires a mandatory `reason` and writes a typed audit comment. A generic status tool could be invoked without explanation.
3. **Intent distinction:** Normal agents should never reopen cancelled work. This is an administrative recovery action — not a workflow transition. Separating it into a dedicated tool makes the intent explicit.
4. **Pattern consistency:** Following `ledger_reset_rework_count` exactly means no new patterns to learn, test, or maintain.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Bypass vs. modify state machine | Dedicated bypass tool | Add `CANCELLED → READY` to `isValidStatusTransition` with PM guard | Modifying the state machine would require auditing all `isTerminalStatus()` call sites and dependency satisfaction logic; bypass is surgical and self-documenting |
| Target state: READY vs. IN_PROGRESS vs. BLOCKED | READY (with dep-check fallback to BLOCKED) | (a) Direct to IN_PROGRESS; (b) Always READY regardless of deps | (a) conflates recovery with work assignment; (b) creates "READY but unclaimable" UX gap. Dep-aware target matches `createWorkPackage` semantics — the PM sees the honest state immediately |
| Revision increment | No increment | Increment on reopen | CANCELLED WPs never delivered output to consumers; revision tracks rework of delivered work, not recovery of unstarted intent |
| Pipeline history | Preserve (no-op) | Clear or mark stale | Preserving gives audit trail; freshness guards in the normal flow already handle staleness organically |
| Batch reopen | Single WP only | Accept array of WP IDs | Atomic single-WP operations are simpler to audit, reason about, and test; bulk recovery is just N invocations |

## Pattern Alignment

- **PM-only guard pattern** → follows `ledger_reset_rework_count` in `mcp-server/src/tools/work-package.ts` (line ~1269)
- **Zod schema pattern** → follows `ResetReworkCountSchema` in same file (line ~1158)
- **`updateWorkPackageWithSync` with updater callback** → follows same file (line ~1282)
- **Audit comment push to `root.project_comments`** → follows same file (line ~1302)
- **Post-write `propagateDependencyReblock` call** → follows `updateWorkPackageStatus` COMPLETE→IN_PROGRESS path (line ~913)
- **Tool registration** → follows registration block at line ~1421
- **Root summary sync on status change** → follows `updateWorkPackageStatus` in same file (L873–L877)
- **`status_changed_at` timestamp on every status transition** → follows `updateWorkPackageStatus` in same file (L830)
- **Inside-callback dep check** → follows `createWorkPackage` (L306–L316) for single-write dependency-aware initial status
- No departures from existing patterns.

## Detailed Steps

### Step 1: Implement Zod Schema

Add `ReopenCancelledWpSchema` in `mcp-server/src/tools/work-package.ts` near the existing `ResetReworkCountSchema` (~line 1158):

```typescript
const ReopenCancelledWpSchema = z.object({
  project_path: z.string().optional().describe('Absolute path to the plan folder...'),
  cwd_path: z.string().optional().describe('Your current workspace root directory...'),
  work_package_id: z
    .string()
    .regex(/^WP-\d{3,}$/)
    .describe('ID of the work package to reopen'),
  agent_role: z.string().describe('Must be "Project Manager"'),
  reason: z.string().trim().min(1).describe(
    'Mandatory reason for reopening the cancelled WP (audit trail)'
  ),
});
```

### Step 2: Implement Handler Function

Add `reopenCancelledWp` function in `mcp-server/src/tools/work-package.ts` after the `resetReworkCount` function:

1. PM-only guard (early return with `isError: true` if not PM)
2. Resolve project path via `resolveProjectPath(args)`
3. Instantiate `LedgerStore`
4. Read the WP; reject if status ≠ CANCELLED
5. Call `store.updateWorkPackageWithSync(args.work_package_id, (wp, root) => { ... })`:
   - Set `wp.status_changed_at = now()` (standard bookkeeping for all status transitions)
   - **Dependency-aware initial status (inside callback):** Run `canStartWorkPackage` against the WP. If upstream dependencies are satisfied, set `wp.status = 'READY'`; otherwise set `wp.status = 'BLOCKED'` with `wp.blocked_by = { type: 'dependency', ... }` (matching `createWorkPackage` L306–L316 semantics — single-write, no post-write second call needed)
   - Clear `wp.assigned_to = undefined`
   - Clear `wp.rework_counts = undefined`
   - **Sync root summary:** Find the WP's entry in `root.work_packages[]` and update `summary.status` and `summary.assigned_to` to match the detail mutations (mirrors `updateWorkPackageStatus` L873–L877 pattern — keeps root summary consistent with WP detail)
   - Increment `root.pending_work_packages += 1`
   - Call `clearSynthesisState(root)`
   - Push audit comment: `{ type: 'reopen_cancelled', priority: 'high', timestamp, agent: 'Project Manager', note: ... }`
   - Update `root.last_updated`
6. After atomic write: call `propagateDependencyReblock(projectPath, args.work_package_id, { store })`
7. Return structured JSON response with confirmation details (include final status — READY or BLOCKED — so the PM knows immediately)

### Step 3: Register the Tool

Add tool registration in the tool registration section of `mcp-server/src/tools/work-package.ts` (near line ~1421):

```typescript
server.registerTool(
  'ledger_reopen_cancelled_wp',
  {
    description: 'PM-only administrative override: reopens an incorrectly cancelled work package back to READY status. Clears assignment, resets rework counts, adjusts pending counter, invalidates synthesis, and fires cascade reblock on downstream dependents. Requires a mandatory reason for the audit trail.',
    inputSchema: ReopenCancelledWpSchema,
  },
  (args) => reopenCancelledWp(args)
);
```

### Step 4: Export for Testing

Add `reopenCancelledWp` to the `_internal` export object (line ~83) for test access.

### Step 5: Update Workflow Specification — `state-machines.md`

In `mcp-server/docs/agents/workflow-specification/state-machines.md`, add a note after the CANCELLED row in the §6.2 Transition Table:

> "CANCELLED may be reopened to READY via the administrative `ledger_reopen_cancelled_wp` tool (PM-only). This bypasses the normal state machine and requires a mandatory reason for the audit trail."

### Step 6: Update Workflow Specification — `edge-cases.md`

In `mcp-server/docs/agents/workflow-specification/edge-cases.md`:

1. In §21.1, add §21.1a — Administrative Reopen subsection documenting the tool's behavior and side effects.
2. Add a new subsection documenting cascade reblock behavior when a CANCELLED WP is reopened.

### Step 7: Update Workflow Specification — `dependencies-and-rework.md`

In `mcp-server/docs/agents/workflow-specification/dependencies-and-rework.md`, add a new subsection §16.3d "Administrative Reopen" (following the `ledger_reset_rework_count` precedent at §16.3b; §16.3c is already taken by "Circuit Breaker Escalation for Automated Orchestrators"), documenting `ledger_reopen_cancelled_wp` behavior, side effects, and PM-only access control.

### Step 8: Update Ledger Doctor Persona

In `personas/standalone/src/content/ledger-doctor.md`:

1. Add `ledger_reopen_cancelled_wp` to the "Write Tools" table.
2. Add "Incorrectly Cancelled WP" as a new anomaly pattern in Step 2 of the Diagnostic Protocol.
3. Add "Repair 9: Incorrectly Cancelled WP Recovery" procedure (as drafted in the research document).

### Step 9: Update MCP Server API Surface Manifest

In `mcp-server/docs/agents/project-manifest/api-surface.md`, add the `ledger_reopen_cancelled_wp` tool entry documenting schema, access control, side effects, and response.

### Step 10: Update MCP Server Constraints Manifest

In `mcp-server/docs/agents/project-manifest/constraints.md`, add a note that CANCELLED remains terminal in the normal state machine, with an administrative bypass available via `ledger_reopen_cancelled_wp`.

### Step 11: Write Tests

Create tests in a dedicated file `tests/tools/reopen-cancelled-wp.test.ts`:

**Guard & precondition tests:**
1. PM-only guard rejects non-PM callers
2. Rejects if target WP is not in CANCELLED status

**Core side-effect tests:**
3. Successfully transitions CANCELLED → READY (when deps are satisfied)
4. Transitions CANCELLED → BLOCKED when upstream dependencies are unsatisfied
5. Increments `pending_work_packages` by 1
6. Clears `rework_counts`
7. Clears `assigned_to`
8. Invalidates synthesis (`synthesis_generated = false`)
9. Writes audit comment with type `reopen_cancelled`

**Cascade reblock tests:**
10. Reopen a CANCELLED WP that has downstream READY dependents → dependents get BLOCKED
11. Reopen a CANCELLED WP that has downstream BLOCKED dependents → no-op (already blocked)

### Step 12: Build Personas

Run `node scripts/build-personas.js` to regenerate persona output files from the updated source.

## Dependencies

- `mcp-server/src/tools/work-package.ts` — primary implementation file
- `mcp-server/src/storage/ledger-store.ts` — `updateWorkPackageWithSync` (existing, no changes needed)
- `mcp-server/src/utils/workflow-helpers.ts` — `clearSynthesisState` (existing, no changes needed)
- `mcp-server/src/schema/validators.ts` — no changes (CANCELLED remains terminal)
- `personas/standalone/src/content/ledger-doctor.md` — persona content update
- `scripts/build-personas.js` — regenerate persona output (existing, no changes)

## Required Components

- `mcp-server/src/tools/work-package.ts` — add schema, handler, registration, export
- `mcp-server/docs/agents/workflow-specification/state-machines.md` — add footnote
- `mcp-server/docs/agents/workflow-specification/edge-cases.md` — add §21.1a + cascade reblock section
- `mcp-server/docs/agents/workflow-specification/dependencies-and-rework.md` — add §16.3d "Administrative Reopen"
- `mcp-server/docs/agents/project-manifest/api-surface.md` — add tool documentation
- `mcp-server/docs/agents/project-manifest/constraints.md` — add note
- `personas/standalone/src/content/ledger-doctor.md` — add tool, anomaly, repair procedure
- `mcp-server/tests/` — new test file or additions to existing work-package tests

## Assumptions

- The `updateWorkPackageWithSync` callback pattern supports all the mutations needed (status, assigned_to, rework_counts, root counter, synthesis, comments) — confirmed by research.
- `propagateDependencyReblock` can be called with a `{ store }` options object — confirmed by its signature.
- The audit comment `type` field accepts arbitrary strings (no enum validation) — follows the `rework_reset` precedent.
- The Ledger Doctor persona source at `personas/standalone/src/content/ledger-doctor.md` is the correct file to edit (not a generated output).

## Constraints

- CANCELLED must remain terminal in `isValidStatusTransition()` — no modification to the state machine.
- The tool must NOT increment `revision` (CANCELLED WPs never delivered output to consumers).
- The tool must NOT delete pipeline history (audit trail preservation).
- `pending_work_packages` arithmetic: simply +1 (WP moves from terminal → non-terminal pool).
- The `reason` parameter must be mandatory and non-empty (audit trail requirement).

## Out of Scope

- Batch reopen (accepting multiple WP IDs) — single-WP atomic operations are sufficient for current needs.
- Automatic pipeline staleness marking — the existing freshness guards handle this organically.
- Modifying `isValidStatusTransition` or `isTerminalStatus` — explicitly out of scope.
- Pre-existing `blocked_by` staleness issues in affected projects — unrelated pre-existing data quality issue.
- GUI support for triggering the tool — administrative tools are CLI/MCP-only.

## Acceptance Criteria

1. Calling `ledger_reopen_cancelled_wp` with a CANCELLED WP (with satisfied deps) and PM role transitions the WP to READY.
2. Calling `ledger_reopen_cancelled_wp` with a CANCELLED WP whose upstream dependencies are unsatisfied transitions the WP to BLOCKED (matching `createWorkPackage` semantics).
3. Non-PM callers are rejected with a clear error before any disk I/O.
4. Calling on a non-CANCELLED WP returns an error without modifying state.
5. After reopen: `assigned_to` is cleared, `rework_counts` is cleared, `pending_work_packages` is incremented by 1.
6. Synthesis is invalidated (`synthesis_generated = false`).
7. An audit comment with type `reopen_cancelled` and the provided reason is appended to `root.project_comments`.
8. Downstream READY/IN_PROGRESS dependents are cascade-reblocked.
9. Downstream BLOCKED dependents remain unchanged (no-op).
10. Pipeline history is preserved unchanged.
11. The normal state machine (`isValidStatusTransition`) remains unmodified.
12. Workflow specification documents are updated to reflect the administrative escape hatch.
13. The Ledger Doctor persona includes the tool in its toolkit and repair procedures.
14. All tests pass.

## Testing Strategy

Unit tests validate each side effect in isolation using the `_internal` export pattern. Integration tests validate the cascade reblock behavior with multi-WP project fixtures. Tests follow the existing Vitest patterns in `mcp-server/tests/`.

## Test Plan

- `tests/tools/reopen-cancelled-wp.test.ts` — "PM-only guard rejects Developer role" — AC #3
- `tests/tools/reopen-cancelled-wp.test.ts` — "PM-only guard rejects QA role" — AC #3
- `tests/tools/reopen-cancelled-wp.test.ts` — "rejects if WP is READY" — AC #4
- `tests/tools/reopen-cancelled-wp.test.ts` — "rejects if WP is IN_PROGRESS" — AC #4
- `tests/tools/reopen-cancelled-wp.test.ts` — "rejects if WP is COMPLETE" — AC #4
- `tests/tools/reopen-cancelled-wp.test.ts` — "rejects if WP is BLOCKED" — AC #4
- `tests/tools/reopen-cancelled-wp.test.ts` — "transitions CANCELLED WP to READY when deps satisfied" — AC #1
- `tests/tools/reopen-cancelled-wp.test.ts` — "transitions CANCELLED WP to BLOCKED when upstream deps unsatisfied" — AC #2
- `tests/tools/reopen-cancelled-wp.test.ts` — "clears assigned_to" — AC #5
- `tests/tools/reopen-cancelled-wp.test.ts` — "clears rework_counts" — AC #5
- `tests/tools/reopen-cancelled-wp.test.ts` — "increments pending_work_packages" — AC #5
- `tests/tools/reopen-cancelled-wp.test.ts` — "invalidates synthesis state" — AC #6
- `tests/tools/reopen-cancelled-wp.test.ts` — "writes audit comment with type reopen_cancelled" — AC #7
- `tests/tools/reopen-cancelled-wp.test.ts` — "audit comment includes provided reason" — AC #7
- `tests/tools/reopen-cancelled-wp.test.ts` — "preserves pipeline history" — AC #10
- `tests/tools/reopen-cancelled-wp.test.ts` — "cascade reblocks downstream READY dependent" — AC #8
- `tests/tools/reopen-cancelled-wp.test.ts` — "cascade reblocks downstream IN_PROGRESS dependent" — AC #8
- `tests/tools/reopen-cancelled-wp.test.ts` — "no-ops on already-BLOCKED downstream dependent" — AC #9

## Documentation Updates

- `mcp-server/docs/agents/workflow-specification/state-machines.md` — Add footnote to §6.2 about administrative reopen
- `mcp-server/docs/agents/workflow-specification/edge-cases.md` — Add §21.1a and cascade reblock subsection
- `mcp-server/docs/agents/workflow-specification/dependencies-and-rework.md` — Add §16.3d "Administrative Reopen" subsection
- `mcp-server/docs/agents/project-manifest/api-surface.md` — Add `ledger_reopen_cancelled_wp` tool entry
- `mcp-server/docs/agents/project-manifest/constraints.md` — Add note about administrative bypass for CANCELLED
- `mcp-server/docs/agents/project-manifest/file-tree.md` — Add `tests/tools/reopen-cancelled-wp.test.ts` entry with annotation describing the 18 tests (guard, side-effect, and cascade reblock coverage)
- `personas/standalone/src/content/ledger-doctor.md` — Add tool to Write Tools table, anomaly to Step 2, Repair 9 procedure

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Counter arithmetic error** | Verified against both real affected projects in research; simple +1 matches the recomputation formula (total − terminal = pending) |
| **Cascade reblock breaks downstream WPs** | Research confirmed both affected projects have all dependents already BLOCKED — cascade is a no-op. Integration test covers the active-reblock case. |
| **`updateWorkPackageWithSync` auto-sync conflicts with manual counter change** | The updater modifies root inside the callback before auto-sync runs; `passed_stages` sync is independent of pending counter — no conflict |
| **Future tools assume CANCELLED is always terminal** | Spec footnote + constraints doc explicitly document the administrative bypass; `isTerminalStatus()` remains unchanged (the function truthfully reports CANCELLED as terminal — the bypass happens at a higher abstraction level) |
| **Reopened WP appears READY but deps are unsatisfied** | In-callback `canStartWorkPackage` check sets status to BLOCKED if upstream deps are unmet — matches `createWorkPackage` L306–L316 semantics; single atomic write eliminates "READY but unclaimable" UX confusion |
| **Persona output drift after Doctor content change** | Step 12 explicitly rebuilds personas; pre-commit hook catches staleness |
