# Constraints — Workflow Enforcement

> **Scope:** Server-side enforcement of the workflow state machine — status transitions, claiming,
> pipelines, handoffs, and the gotchas that arise from them.
>
> **The [Workflow Specification](../workflow-specification/README.md) is the authority for workflow
> *rules*.** This document records only what the specification does not: which function enforces a
> rule, what error text it emits, and where the implementation has non-obvious consequences. When
> this document and the specification disagree, the specification wins.
>
> **Companion documents:**
> [Core](constraints.md) ·
> [Testing](constraints-testing.md) ·
> [Code Style](constraints-code-style.md) ·
> [Storage & Knowledge](constraints-storage.md) ·
> [GUI](../../../gui/docs/agents/project-manifest/constraints.md)

## Contents

- [Status Transitions](#status-transitions)
- [Claiming & Assignment](#claiming--assignment)
- [Work Package Creation](#work-package-creation)
- [Pipelines](#pipelines)
- [Handoffs & Routing](#handoffs--routing)
- [Comments](#comments)
- [Gotchas](#gotchas)

---

## Status Transitions

### Status Transitions Are Enforced

**Rule:** Work package status transitions must follow the legal transition table.

> **Specification:** [§6.2 Transition Table](../workflow-specification/state-machines.md#62-transition-table)
> is the authoritative table. It is not duplicated here.

**Enforcement:** `isValidStatusTransition()`, applied in `updateWorkPackageStatus()` in
`src/tools/work-package.ts`.

**Server-side notes not in the specification:**

- `CANCELLED` is the only fully terminal status; `CANCELLED → CANCELLED` self-transitions are rejected.
- `ledger_reopen_cancelled_wp` (PM-only) bypasses the check explicitly — `isValidStatusTransition('CANCELLED', *)` continues to return `false`. See [§16.3d](../workflow-specification/dependencies-and-rework.md#163d-administrative-reopen-of-incorrectly-cancelled-wps) and [§21.1a](../workflow-specification/edge-cases.md#211a-administrative-reopen-of-cancelled-wps).
- `status_changed_at` is set on **every** successful transition, including `BLOCKED → BLOCKED` blocker replacements where the status value itself does not change.

**PM-only tool guard placement convention:** PM-only guards must fire **before** `resolveProjectPath()` and any `LedgerStore` construction — no file lock is acquired on early rejection. The `reopenCancelledWp` handler is the canonical model: `agent_role` is checked at the top of the handler body, before any I/O. Prefer this placement over the older `resetReworkCount` pattern (PM guard inside `try` after store construction). All new PM-only tools should follow the `reopenCancelledWp` placement.

---

### Acceptance Criteria Must All Be Met Before COMPLETE

**Rule:** A work package cannot be marked `COMPLETE` unless all acceptance criteria have `met: true`.

**Enforcement:** `canCompleteWorkPackage()` validator in `ledger_update_work_package_status`.

**Error message format:**
```
Cannot mark work package as COMPLETE: the following acceptance criteria are not met:
  - Criterion 1
  - Criterion 2
```

---

### Only the Documentation Agent Can Set COMPLETE

**Rule:** The `ledger_update_work_package_status` tool rejects transitions to `COMPLETE` from any agent other than `"Documentation"` or `"Documentation Agent"`.

**Enforcement:** Hard guard in `updateWorkPackageStatus()`. The error message includes the full workflow reminder (Developer → QA → Reviewer → Documentation → COMPLETE).

**Rationale:** Enforces the multi-stage workflow at the MCP server level; this was previously a persona-level convention only. Auto-finalize on terminal-stage PASS (below) is now the preferred COMPLETE path — `ledger_update_work_package_status` remains registered for PM and edge-case use only.

> **Specification:** [§6.5 Agent Guards](../workflow-specification/state-machines.md#65-agent-guards), §21.10.

---

### Auto-Finalize on Terminal-Stage Pipeline PASS

**Rule:** When `ledger_complete_pipeline` is called with `status: "PASS"` and the calling agent owns the WP's **last active stage** (terminal stage), the server automatically evaluates whether all acceptance criteria are met **after** applying `acceptance_criteria_updates`. If all criteria are met, the WP is transitioned to `COMPLETE` **within the same lock scope** as the pipeline completion — no separate `ledger_update_work_package_status` call is required.

The terminal stage is determined dynamically: `CANONICAL_PIPELINE_ORDERING.filter(t => activeStages.includes(t)).at(-1)`. For default WPs (`DEFAULT_PIPELINE_STAGES`), this is `documentation` (Documentation agent). For custom-stage WPs it may be any stage.

**Conditions (all must apply):**
- `type === lastActiveStage` (the last entry in the WP's ordered active stages)
- `status === 'PASS'`
- `agent_role === PIPELINE_AGENT_MAP[lastActiveStage]` (PM overrides bypass auto-finalize)
- All `wp.acceptance_criteria[*].met === true` after applying `acceptance_criteria_updates`

**Response signals:**
- `auto_finalized: true` — WP transitioned to COMPLETE; `pending_work_packages` decremented.
- `auto_finalize_blocked: true` + `unmet_criteria: string[]` — criteria check failed; WP stays IN_PROGRESS.

**Enforcement:** Logic in `completePipeline()` in `src/tools/pipeline.ts`.

**Dependency unblocking side-effect (§6.3):** When auto-finalize transitions the WP to `COMPLETE`, `propagateDependencyUnblock` is called **after** the main lock is released (consistent with §12.2 and the separate-lock gotcha below). This transitions eligible BLOCKED dependents to `READY`. Only dependents whose `blocked_by.type` is `'dependency'` (or absent) are eligible — WPs blocked by `'external'`, `'decision'`, or `'technical'` reasons remain BLOCKED.

**Rationale:** The Documentation agent always called `ledger_update_work_package_status` immediately after a PASS pipeline — the transition was unconditional and never conditional. Automating it server-side removes a mandatory extra tool call from every Documentation pipeline.

---

### `READY → IN_PROGRESS` Must Use `ledger_claim_work_package`

**Rule:** `ledger_update_work_package_status` rejects `status: 'IN_PROGRESS'` when the WP is currently `READY`. The caller must use `ledger_claim_work_package` instead.

**Enforcement:** Early-return guard in `updateWorkPackageStatus()` that throws an actionable error naming `ledger_claim_work_package` as the correct tool.

**Rationale:** `ledger_claim_work_package` enforces dependency checks and agent identity checks that `ledger_update_work_package_status` does not replicate.

---

### `IN_PROGRESS → READY` (Unclaim) Requires No Active Pipelines

**Rule:** When transitioning a WP from `IN_PROGRESS` back to `READY`, all pipelines must be in a terminal state (non-`IN_PROGRESS`). If any pipeline is currently `IN_PROGRESS`, the transition is rejected with an actionable error.

**Side effect:** On success, `assigned_to` is cleared in both the WP detail file and the root index summary.

**Enforcement:** Guard in `updateWorkPackageStatus()` step 4 in `src/tools/work-package.ts`.

---

### `BLOCKED → BLOCKED` Replaces the Blocker with Guards

**Rule:** A `BLOCKED` work package can be re-blocked with a different `blocked_by` object. This early-return path applies:

1. **Agent guard:** Only the `"Project Manager"` (or `"Project Manager Agent"`) or the current `wp.assigned_to` may replace a blocker.
2. **Type guard:** Changing a `'dependency'`-type blocker to a non-dependency type (or vice versa) is rejected. Dependency blockers are managed automatically by the system; manual replacement of dependency blockers is disallowed.
3. **Side effect:** `status_changed_at` and `root.last_updated` are set; `pending_work_packages` is unchanged (status remains `BLOCKED`).

**Enforcement:** Early-return guard in `updateWorkPackageStatus()` step 1a.

---

### BLOCKED Status Requires a Blocker Object

**Rule:** When transitioning a work package to `BLOCKED`, the `blocked_by` field must be provided.

**Enforcement:** `ledger_update_work_package_status` throws an error if `status: 'BLOCKED'` is passed without `blocked_by`.

---

### `IN_PROGRESS → BLOCKED` and `IN_PROGRESS → CANCELLED` Auto-Cancel Active Pipelines

**Rule:** When a WP transitions from `IN_PROGRESS` to `BLOCKED` or `CANCELLED`, all currently `IN_PROGRESS` pipelines are automatically cancelled. Each cancelled pipeline receives `auto_cancelled: true` to distinguish it from deliberate FAIL pipelines.

**Effect on rework detection:** Auto-cancelled pipelines are excluded from both direct and downstream rework detection in `ledger_start_pipeline` (see [Rework Count Increments on Pipeline Retry](#rework-count-increments-on-pipeline-retry)).

**Enforcement:** `autoCancelActivePipelines(wp, reason)` helper called at steps 8a/8b in `updateWorkPackageStatus()` in `src/tools/work-package.ts`.

---

### `→ COMPLETE` Freshness Check

**Rule:** When transitioning a WP to `COMPLETE`, a freshness check is applied: the most recent non-auto-cancelled `documentation` pipeline PASS must have been recorded **after** the most recent `implementation` pipeline start. If the doc PASS predates the impl start (stale doc), the transition is rejected.

**Exception:** If no `implementation` pipeline exists, or if no `documentation` pipeline has a PASS, the check is skipped (absent timestamps are accepted).

**Absent timestamp permissive default:** If the most recent `documentation` pipeline lacks a `completed_at` timestamp, or if the most recent `implementation` pipeline lacks a `started_at` timestamp, the freshness check is skipped and the `→ COMPLETE` transition is allowed.

**Enforcement:** Freshness check in `canCompleteWorkPackage()` or in `updateWorkPackageStatus()` step 2b.

**Rationale:** Prevents a WP from being completed with documentation that was written before the current implementation cycle.

---

### Reopening a COMPLETE Work Package Requires PM or Documentation

**Rule:** When transitioning a work package from `COMPLETE` back to `IN_PROGRESS`, the calling `agent` MUST be `"Project Manager"` (or `"Project Manager Agent"`) or `"Documentation"` (or `"Documentation Agent"`). All other agents are rejected.

**Enforcement:** Hard guard in `updateWorkPackageStatus()` in `src/tools/work-package.ts`, applied before the status mutation.

**Error message format:**
```
Cannot reopen work package WP-XXX: only the Project Manager or Documentation agent may transition COMPLETE → IN_PROGRESS.
Hand off to the Project Manager or Documentation agent to formally reopen this work package.
```

**Additional effect:** On `COMPLETE → IN_PROGRESS`, rework state is fully reset: `rework_counts` is set to `{}`, `rework_count` is set to `0`, `root.synthesis_generated` is cleared, and `root.synthesis_generated_at` is set to `null`. This ensures a reopened WP starts with a clean rework slate and prevents the Synthesis agent from being gated by stale synthesis state.

---

## Claiming & Assignment

### Claiming a WP Assigned to Another Agent Requires Override

**Rule:** `ledger_claim_work_package` rejects the claim when the work package's `assigned_to` field differs from the calling `agent` parameter, unless `override: true` is explicitly passed.

**Authorization:** Only the **Project Manager** and the **current assignee** (`wp.assigned_to`) are permitted to use `override: true`. Any other agent passing `override: true` receives a hard rejection. The guard is conditional on `wp.assigned_to` being set — unassigned WPs bypass the identity check.

**Error message (unauthorized override):**
```
override is restricted to "Project Manager" or the current assignee ("Developer"). You are "Reviewer".
```

**Error message (assignment mismatch):**
```
Cannot claim work package WP-002: it is assigned to "Documentation" but you are "Developer".

If you need to re-assign this WP, pass override: true.
Otherwise, only claim work packages assigned to your role.
```

**Enforcement:** Hard guard in `claimWorkPackage()` before dependency and status-transition checks.

**Rationale:** Prevents agents from silently re-assigning WPs outside their remit.

---

### Only CLAIMABLE_ROLES Can Claim Work Packages

**Rule:** The `agent` field passed to `ledger_claim_work_package` must be a claimable role.

**Non-claimable roles:** `Planner`, `Planner Agent`, `Synthesis`, `Synthesis Agent` — these orchestrating roles are excluded from claiming WPs.

**Guard ordering:** The CLAIMABLE_ROLES guard fires at step 1b — unconditionally, immediately after the `READY` status guard and **before** the assignment guard (step 2) and override-auth guard (step 2b). Consequence: a non-claimable role always receives the role error regardless of the WP's `assigned_to` field or whether `override: true` is passed.

**Enforcement:** `CLAIMABLE_ROLES` is a named export at module scope in `src/tools/work-package.ts`, checked in `claimWorkPackage` step 1b. It is derived programmatically from `AGENT_ROLES` by filtering out `ORCHESTRATING_ROLES` (defined in `src/utils/constants.ts`), so adding a new orchestrating role automatically removes it from the claimable set without requiring manual updates.

---

### Work Package `assigned_to` Always Starts as `null`

**Rule:** When creating a work package via `ledger_create_work_package`, the `assigned_to` input field is accepted silently but **ignored**. Both the WP detail file and the root index summary are written with `assigned_to: null`.

**Rationale (§9b.1):** Assignment is managed by `ledger_claim_work_package` (transitions to `IN_PROGRESS`) and cleared by `IN_PROGRESS → READY` (unclaim). Pre-populating at creation time bypasses these guards.

**Enforcement:** `createWorkPackage()` in `src/tools/work-package.ts` overwrites the input value.

---

### `ledger_begin_work` IN_PROGRESS Guard Accepts Pipeline-Type Owners

**Rule:** When `ledger_begin_work` is called on a work package that is already `IN_PROGRESS`, the call is allowed if **either** condition holds:

1. **Idempotent re-entry:** `wp.assigned_to === args.agent_role` (the same agent is continuing their own work).
2. **Cross-agent handoff:** `PIPELINE_AGENT_MAP[args.type] === args.agent_role` (the caller is the legitimate pipeline-type owner per the workflow spec).

If neither condition holds, the call is rejected.

**Rationale (§9.1, §16.5):** The `assigned_to` field is a trailing bookkeeping field — a side-effect updated by the pipeline-start phase, not a security gate. Pipeline authorisation is defined by `PIPELINE_AGENT_MAP`. Using `assigned_to` as a hard gate would block every cross-agent handoff where `ledger_begin_work` is used instead of the two-step `ledger_claim_work_package + ledger_start_pipeline` sequence.

**Contrast with `ledger_claim_work_package`:** That tool operates on `READY` WPs and does require an explicit `override: true` for cross-agent claims — the `READY → IN_PROGRESS` transition is a deliberate re-assignment. `ledger_begin_work` on an `IN_PROGRESS` WP is a pipeline-start handoff, not a re-assignment.

**Enforcement:** `isPipelineOwner` compound check in `beginWork()` in `src/tools/begin-work.ts`.

**Error message (guard fires):**
```
Cannot begin work on WP-002: it is IN_PROGRESS and assigned to "Reviewer" but you are "Developer".
Only the assigned agent or the legitimate pipeline-type owner may start a pipeline on an IN_PROGRESS work package.
```

---

## Work Package Creation

### Dependencies Must Exist Before Creation

**Rule:** When creating a work package, all dependency IDs must already exist in the root index.

**Enforcement:** `ledger_create_work_package` validates dependencies before creating the work package.

**Rationale:** Prevents dangling references.

---

### Creating a Work Package Must Not Introduce a Dependency Cycle

**Rule:** Before persisting, `createWorkPackage` calls `hasCycle(newWpId, deps, allExistingWps)` (BFS) to verify the new dependency edges don't form a circular dependency. If a cycle is detected, the creation is rejected.

**Error message format:**
```
Dependency cycle detected: WP X would create a circular dependency.
```

**Scope:** `hasCycle` checks forward-reference cycles among existing WPs. Simultaneous batch creation bypasses cycle detection — WPs should be created sequentially.

**Enforcement:** `hasCycle()` pure function at module scope in `src/tools/work-package.ts`, called in `createWorkPackage` step 3b.

---

### New BLOCKED Work Packages Receive an Auto-Assigned `blocked_by`

**Rule:** When a work package's initial status is `BLOCKED` (because at least one dependency is not terminal), `blocked_by` is automatically populated:
```typescript
{ type: 'dependency', description: 'Dependency WP-XXX is not complete', blocking_work_package: 'WP-XXX' }
```
where `WP-XXX` is the first unmet dependency.

**Enforcement:** Inside `createWorkPackage()` initial status determination.

---

### Acceptance Criteria Cannot Be Empty or Whitespace-Only

**Rule:** Each string in the `acceptance_criteria` array must be non-empty and non-whitespace after trimming. An empty string or a string containing only spaces/tabs/newlines is rejected. The array itself must contain at least one entry (Zod `.min(1)`).

**Error message format:**
```
Acceptance criteria cannot be empty or whitespace-only.
```

**Enforcement:** Validation loop in `createWorkPackage()` before WP creation, supplementing the Zod-level `.min(1)` array constraint.

**Rationale:** Prevents the degenerate case of a WP that auto-passes all criterion checks.

---

### `title` Is Required on `ledger_create_work_package`

**Rule:** The `title` field is required in `CreateWorkPackageSchema` for all new WPs. Calling `ledger_create_work_package` without `title` fails Zod validation. `title` is defined as `z.string().min(1)`, so an empty string (`""`) is rejected at the validation layer.

**Storage-schema divergence:** In storage schemas (`WorkPackageDetailSchema`, `WorkPackageSummarySchema`) `title` is optional for backward compatibility with existing WPs that pre-date the field. A `description` field is also available on the detail schema (optional) for storing the full specification body; it is stored in the WP detail file only and never copied to the root index summary, which must remain compact.

---

## Pipelines

### Pipelines Require an IN_PROGRESS Work Package

**Rule:** A pipeline can only be started on a work package with status `IN_PROGRESS`.

**Enforcement:** `ledger_start_pipeline` validates WP status before creating the pipeline.

**Rationale:** Prevents starting work before a work package is claimed.

---

### No Duplicate IN_PROGRESS Pipelines

**Rule:** Only one pipeline of a given type can be `IN_PROGRESS` at a time for a work package.

**Enforcement:** `ledger_start_pipeline` checks for an existing `IN_PROGRESS` pipeline of the same type before creating a new one.

**Rationale:** Forces agents to complete or fail a pipeline before retrying.

---

### Pipelines Must Follow the Required Ordering

**Rule:** Pipelines must be started in the order defined by the work package's `active_pipeline_stages` (defaults to `DEFAULT_PIPELINE_STAGES` when omitted). Each stage requires a PASS on its immediately preceding active stage. A historical PASS followed by a FAIL is not sufficient — the most recent entry is the only one that counts (per §8.2 most-recent-wins semantics).

**Enforcement:** `ledger_start_pipeline` calls `resolvePrerequisite(type, activeStages)` — which filters `CANONICAL_PIPELINE_ORDERING` by the WP's `active_pipeline_stages` and returns the immediately preceding active stage — then finds the most recent pipeline of that prerequisite type via `.at(-1)`, and rejects if it is absent or its status is not `PASS`.

**Error message format:**
```
Cannot start 'qa' pipeline: requires a PASS 'implementation' pipeline first.
Active pipeline order: implementation → qa → code-review → documentation.
```

**Exception:** The first active stage in the WP's ordering has no prerequisite and can always be started (subject to other constraints).

> **Specification:** [§8 Pipeline Routing](../workflow-specification/pipeline-routing.md).

---

### All Six Pipeline Stages Are PM-Composable

**Rule:** All six pipeline stages (`implementation`, `qa`, `security-audit`, `code-review`, `release-engineering`, `documentation`) are equally composable by the Project Manager. There is no inherent "mandatory" or "optional" designation for any stage. The PM selects any valid subsequence of `CANONICAL_PIPELINE_ORDERING` per work package via the `active_pipeline_stages` field.

**Default:** When `active_pipeline_stages` is omitted, `DEFAULT_PIPELINE_STAGES` (`['implementation', 'qa', 'code-review', 'documentation']`) is used for backward compatibility.

**Rationale:** The former `MANDATORY_PIPELINE_TYPES` and `OPTIONAL_PIPELINE_TYPES` constants are retired. The PM-composable model enables custom workflows (e.g., skipping QA for documentation-only WPs, adding a security audit before code review) without encoding assumptions into the server.

**Extension:** `CANONICAL_PIPELINE_ORDERING` defines the only valid execution order — stages may be omitted but not reordered. `resolvePrerequisite`, `resolveNextAgent`, and `resolveFailAgent` derive routing dynamically from the per-WP `active_pipeline_stages` array.

> **Specification:** [§4.2 Pipeline Stage Constants](../workflow-specification/data-model.md#42-pipeline-stage-constants), §9b.

---

### `active_pipeline_stages` Validation: Hard and Soft Guardrails

**Rule:** When `ledger_create_work_package` receives an `active_pipeline_stages` value, it validates the array before persisting the work package.

**Hard guardrails (reject with error — creation is aborted):**
- Empty array (`[]`)
- Entries that are not valid `PIPELINE_TYPES` values
- Duplicate entries
- Entries that are not a subsequence of `CANONICAL_PIPELINE_ORDERING` (relative ordering must be preserved; gaps are allowed)

**Soft guardrails (warning appended to the success response — creation is NOT aborted):**
- `implementation` present without `qa` (unusual composition)
- Single-stage chain (degenerate case)

**Omitted field:** When `active_pipeline_stages` is omitted (the common case for standard 4-stage workflows), validation is bypassed entirely. The field is absent on the WP detail and dynamic resolve functions substitute `DEFAULT_PIPELINE_STAGES` at runtime.

**Enforcement:** `validateActiveStages()` helper called inside `createWorkPackage()` in `src/tools/work-package.ts`. Hard rejection throws before the WP is written; soft warning is appended to the response string after the WP is written.

> **Specification:** [§9b.2](../workflow-specification/operations.md#9b2-active-pipeline-stages-validation).

---

### Pipeline Start Auto-Updates `assigned_to`

**Rule:** When a pipeline starts, the work package's `assigned_to` field is automatically updated to the responsible agent according to `PIPELINE_AGENT_MAP`.

**Enforcement:** `ledger_start_pipeline` applies the map atomically alongside the pipeline creation. Both WP detail and root index summary are updated.

> The type-to-agent map itself is defined in `src/utils/pipeline-maps.ts` and specified in
> [§9 Pipeline Routing](../workflow-specification/pipeline-routing.md).

---

### `agent_role` Is Required for Pipeline Start and Complete

**Rule:** Both `ledger_start_pipeline` and `ledger_complete_pipeline` require an `agent_role` parameter. The value must match the pipeline type's owner role (per `PIPELINE_AGENT_MAP`). Calls that omit `agent_role` or provide a mismatched role are rejected with a descriptive error.

**Exception:** `agent_role: 'Project Manager'` (or `'Project Manager Agent'`) bypasses the type-to-agent match check for any pipeline type (PM Override). When PM override is active, `startPipeline` adds a `[PM Override]` marker to the pipeline summary and `completePipeline` sets the handoff note's `from_agent` to `'Project Manager (PM Override)'`.

**Enforcement:** Agent role guard in `startPipeline()` and `completePipeline()` in `src/tools/pipeline.ts` (steps 1b and 2b respectively), applied after the WP status guard.

---

### Rework Count Increments on Pipeline Retry

**Rule:** When `ledger_start_pipeline` detects a rework, the work package's rework counters are automatically incremented. Rework is detected when either:
- **Direct rework:** The most recent completed pipeline of the same type has `FAIL` status.
- **Downstream rework:** A prerequisite pipeline type was reworked (re-failed) after the last PASS of the current pipeline type.

**Auto-cancelled exclusion:** Pipelines with `.auto_cancelled === true` are excluded from both rework-detection checks. This exclusion also applies to **temporal comparison functions** such as `checkRevalidationGuard` — an auto-cancelled pipeline is invisible to all time-based guard logic. Auto-cancelled pipelines must never be counted by rework detection, circuit breakers, or any temporal comparison function.

**Primary field:** `rework_counts` — a per-pipeline-type map. This is the authoritative counter.

**Legacy field:** `rework_count` — a scalar counter maintained during a prior transition period. No production code path writes this field. The in-memory migration in `LedgerStore.readWorkPackage()` handles on-disk files that still contain it, but no new writes are emitted.

**Backward-compat migration:** `LedgerStore.readWorkPackage()` performs a lazy in-memory migration: if a file contains `rework_count` but no `rework_counts`, it synthesises `rework_counts: { implementation: rework_count, qa: 0, 'code-review': 0, documentation: 0 }` and removes `rework_count`. This migration is **in-memory only** — no write is triggered; the on-disk file is updated lazily on the next `updateWorkPackageWithSync()` call.

**Initial value:** Both fields are absent (`undefined`) until the first rework; neither is ever initialised to `0` on creation.

| Rework condition | `rework_counts` change |
|---|---|
| None (no prior failure, no downstream rework) | No increment |
| Direct rework (last same-type FAIL) | `rework_counts[type]` +1 |
| Downstream rework (prerequisite reworked after last PASS) | `rework_counts[type]` +1 |

**Circuit breaker:** After incrementing, the effective count is computed as `rework_counts?.[type] ?? 0`. If this value reaches `MAX_REWORK_COUNT` (default: 5, from `workflow-helpers.ts`), `ledger_start_pipeline` rejects with an error guiding the caller to cancel or restructure. `getDeveloperAction` also surfaces `BLOCK_FOR_REWORK_LIMIT` as the highest-priority action for affected WPs.

---

### `propagateDependencyReblock` Auto-Cancels IN_PROGRESS Pipelines

**Rule:** When `propagateDependencyReblock` transitions a non-COMPLETE, non-CANCELLED, non-BLOCKED dependent WP back to `BLOCKED`, all currently `IN_PROGRESS` pipelines on that WP are automatically cancelled with `auto_cancelled: true` (consistent with the `IN_PROGRESS → BLOCKED` behavior enforced by `updateWorkPackageStatus`).

**Additional behaviors:**
- **COMPLETE dependents:** For each `COMPLETE` WP that lists the reopened WP as a dependency, a warning comment is appended to its last pipeline (type: `"warning"`, priority: `"high"`).
- **`synthesis_generated` reset:** If any WP was re-blocked, `root.synthesis_generated` is reset to `false` and `root.synthesis_generated_at` is set to `null` to ensure the Synthesis agent must re-run.
- If no candidates were re-blocked, `synthesis_generated` and `synthesis_generated_at` are **not** changed.

**Enforcement:** `propagateDependencyReblock()` in `src/tools/work-package.ts`.

---

### Artifact Declaration Expectation — Soft Warning on Empty `files_modified`

**Rule:** When `ledger_complete_pipeline` is called with `status: 'PASS'` and the `artifacts.files_modified` array is either absent or empty, the server appends a soft-warning note **only if the pipeline type is in `ARTIFACT_EXPECTED_PIPELINE_TYPES`** (`implementation`, `code-review`, `release-engineering`, `documentation`). Verification-only pipeline types (`qa`, `security-audit`) are exempt because those agents verify but do not modify files. `code-review` is included because the Reviewer may apply Fix-Forward edits. This is a non-blocking warning — the pipeline completion is still accepted.

**Rationale:** Agents often forget to populate `files_modified`, reducing the value of the pipeline record for auditing and documentation. The soft warning creates a visible signal in the response without blocking legitimate zero-file-change completions.

**Exception:** The warning is only emitted on `PASS` completions — `FAIL` pipelines are not expected to declare modified files.

**Enforcement:** Soft check in `completePipeline()` in `src/tools/pipeline.ts` (step 3b), gated by `ARTIFACT_EXPECTED_PIPELINE_TYPES` from `src/utils/pipeline-maps.ts`.

---

### Advisory Dependency Freshness Check on PASS Completion

**Rule:** When `ledger_complete_pipeline` is called with `status: 'PASS'` on a WP that has `dependencies`, the server performs an advisory staleness check. For each dependency, the server reads the full WP detail (pre-lock, before lock acquisition) and uses `dep.last_updated` directly. Inside the lock callback, if `dep.last_updated` is later than `pipeline.started_at` (Date-based comparison via `new Date().getTime()`, not lexicographic string comparison), a project comment is appended:

```typescript
{ type: 'warning', priority: 'low', agent: 'system', note: '<dep WP-XXX was modified after this pipeline started>' }
```

**PASS is never blocked.** This check is purely advisory — no pipeline status is changed, no error is thrown.

**Skip conditions:** The check is entirely skipped when `pipeline.started_at` is absent (unstarted or legacy pipeline record), or the WP's `dependencies` array is empty.

**`last_updated` field:** `WorkPackageDetail` includes a dedicated `last_updated: z.string().optional()` field auto-stamped with `now()` on every WP detail write path (status transitions, claim, pipeline start/complete/cancel, creation, cascade reblock/unblock). It is auto-stamped via `updateWorkPackageWithSync` (the primary choke point), plus explicit setting in `createWorkPackage`, `propagateDependencyUnblock`, and `propagateDependencyReblock` (which bypass the choke point). Existing WP detail files without the field parse without error.

**Race window (acceptable):** Dependency WP files are read before lock acquisition. A dependency could theoretically be modified between the pre-read and the lock. For an advisory-only check this race window is acceptable — false negatives do not affect correctness.

> **Specification:** §21.59.

---

## Handoffs & Routing

### Handoff Notes Are Routed via `resolveNextAgent` / `resolveFailAgent`

**Rule:** When `ledger_complete_pipeline` is called with a `handoff_notes` array, a structured `HandoffNote` entry is appended to the work package. The `to_agent` is determined dynamically:

- **On PASS:** `resolveNextAgent(type, activeStages)` returns the owner of the next active stage in canonical order, or `'Synthesis'` when the type is the last active stage.
- **On FAIL:** `resolveFailAgent(type, activeStages)` uses a base routing map extended to all six stages. If the base fail-target's stage is absent from `activeStages`, the fallback is the agent that owns the first active stage.

> **Specification:** The full PASS/FAIL routing tables are defined in
> [§9, §12 Pipeline Routing](../workflow-specification/pipeline-routing.md) and are not duplicated
> here. In summary: `documentation` and `release-engineering` self-rework on FAIL; all other FAIL
> paths route to the Developer.

**Schema:**
```typescript
interface HandoffNote {
  from_agent: string; // PIPELINE_AGENT_MAP[type], or 'Project Manager (PM Override)' when PM override is active
  to_agent: string;   // resolveNextAgent(type, activeStages) on PASS; resolveFailAgent(type, activeStages) on FAIL
  timestamp: string;
  notes: string[];    // The strings passed in handoff_notes
}
```

**`ledger_complete_pipeline` guards (applied before pipeline lookup):**
1. **WP status guard:** Rejects if `wp.status !== 'IN_PROGRESS'` (defense-in-depth).
2. **Agent role guard:** `agent_role` must match `PIPELINE_AGENT_MAP[type]`. Exception: `agent_role === 'Project Manager'` bypasses this check (PM Override), and `from_agent` is set to `'Project Manager (PM Override)'`.

**Consumption:** `ledger_get_next_action` and `ledger_get_next_actions` include any handoff notes addressed to the requesting agent in their response.

---

### PM Handoff Detects Pending Pipeline Stages on IN_PROGRESS WPs

**Rule:** Both `getProjectManagerHandoff()` (§13.1, `workflow-handoff.ts`) and `getProjectManagerAction()` (§14.1.2, `workflow-next-action.ts`) MUST scan non-terminal, non-dependency-blocked `IN_PROGRESS` work packages for pending pipeline stages when no `READY` WPs exist. This scan — called **step 2b** in the handoff function and **Priority 3d** in the recommendation engine — is the only mechanism that advances a WP between pipeline stages after a stage PASS, and that bootstraps freshly-claimed WPs with zero pipelines to their first active stage.

**Invariant:** An IN_PROGRESS WP that has a PASS on stage N and no pipeline started for stage N+1 MUST surface as actionable by the PM (either via `ROUTE_PIPELINE_AGENT` action or the equivalent `READY_FOR_<AGENT>` handoff status) before the affected agent can be dispatched. Without step 2b, such WPs are silently stuck — the PM returns `WAIT` instead of routing the next agent.

**Guards (all must be applied):**
1. **FAIL guard** — If the most recent non-auto-cancelled pipeline for the current stage is FAIL, break the stage scan for this WP. The stage's own agent handles rework; the PM does not route.
2. **IN_PROGRESS guard** — If the most recent non-auto-cancelled pipeline for the current stage is IN_PROGRESS, break. The stage is already being worked on.
3. **Upstream IN_PROGRESS guard** — If the preceding stage's most recent non-auto-cancelled pipeline is IN_PROGRESS, break. Routing the next stage now would be premature.
4. **Dependency-blocked exclusion** — WPs where `wp.status === 'BLOCKED'` and `blocked_by.type === 'dependency'` (or `blocked_by` is absent) are excluded from step 2b entirely.

**Coverage scenarios:**
- **Stage-transition routing:** WP has implementation PASS and no QA pipeline → PM routes to QA.
- **Zero-pipeline bootstrap:** Freshly-claimed IN_PROGRESS WP with no pipelines → PM routes to first active stage's agent.

**Rationale:** The PM is the only agent whose action/handoff functions have visibility into all WPs simultaneously. Without step 2b, a WP that just received a pipeline PASS would not advance until something else triggered a re-scan.

> Implementation: `workflow-handoff.ts` `getProjectManagerHandoff()` §13.1 step 2b; `workflow-next-action.ts` `getProjectManagerAction()` §14.1.2 Priority 3d.

---

### Non-PM Handoff Functions Must Dispatch to the Next READY WP Before Returning WAIT

**Rule:** Each of the five non-PM handoff functions — `getQaHandoff`, `getSecurityAuditorHandoff`, `getReviewerHandoff`, `getReleaseEngineerHandoff`, and `getDocumentationHandoff` — MUST call `findNextReadyDispatch(wpDetails, '<RoleName>')` as the penultimate step, immediately before the final `return WAIT` fallthrough. If `findNextReadyDispatch` returns a non-null result, the function MUST return that dispatch rather than falling through to WAIT.

**Rationale:** Without this step, completing the last pipeline stage on WP-N leaves the IDE in a stalled state when WP-N+1 is READY but has no pipelines yet. The affected functions previously returned a bare `WAIT` in this scenario, requiring manual PM intervention to unblock the IDE workflow. The PM handoff already implements this cross-WP dispatch pattern (§13.1 Step 2); this rule extends the same behaviour to all non-PM handoff functions.

**`findNextReadyDispatch` algorithm:**
1. Finds the first READY work package whose dependencies are satisfied (using `isBlockedByDependencies`).
2. Routes to the agent owning its first active pipeline stage (`PIPELINE_AGENT_MAP[firstActiveStage(wp.active_pipeline_stages ?? null)]`).
3. If all WPs are terminal, returns `READY_FOR_SYNTHESIS` (safety-net branch for handoff functions that position cross-WP dispatch before their own all-terminal check).
4. Returns `null` when no deterministic dispatch is possible — the caller falls through to WAIT.

**Self-routing is intentional:** `findNextReadyDispatch` does NOT filter out cases where the target role equals the calling role. Self-routing causes the IDE to visibly declare a new handoff step for the new work package, improving auditability and keeping orchestrator and IDE behaviors aligned.

**Scope:** This is a best-effort optimization for IDE runners. The orchestrator does not depend on it — its supervisor polling loop re-dispatches independently.

**Correct pattern:**
```typescript
// ✅ CORRECT — penultimate step, just before final WAIT return
const dispatch = findNextReadyDispatch(wpDetails, 'Documentation');
if (dispatch) {
  return buildHandoffResponse(
    'Documentation', dispatch.status, dispatch.reason,
    undefined, projectPath, store
  );
}
return buildHandoffResponse('Documentation', 'WAIT', 'No actionable documentation work.');
```

**Anti-pattern:**
```typescript
// ❌ WRONG — returns WAIT without checking for READY WPs
return buildHandoffResponse('Documentation', 'WAIT', 'No actionable documentation work.');
```

---

## Comments

### Pipeline Comments Have No Agent Field

**Rule:** Pipeline-level comments do not include an `agent` field. The agent is inferred from the pipeline type.

**Contrast:** Project-level comments include an explicit `agent` field because they are not tied to a specific pipeline.

---

### Incident Comments Require Context

**Rule:** When adding a project comment with `type: 'incident'`, the `context` field is required.

**Enforcement:** `ledger_add_project_comment` throws an error if `type === 'incident'` and `context` is missing.

**Required context fields:**
- `os` — Operating system where the incident occurred
- `tool` — Tool or command that caused the incident
- `work_package` (optional) — Associated work package
- `resolved` — Whether the incident is resolved
- `workaround` (optional) — Workaround description

---

## Gotchas

### ⚠️ Revision Only Increments on COMPLETE → IN_PROGRESS

The `revision` field only increments when a work package transitions from `COMPLETE` back to `IN_PROGRESS`. It does not increment on other status changes.

---

### ⚠️ READY Status After Creation Depends on Dependencies

When creating a work package:
- If dependencies are empty or all `COMPLETE` → initial status is `READY`
- If any dependency is not `COMPLETE` → initial status is `BLOCKED`

This logic is automatic and transparent to the caller.

---

### ⚠️ Work Package Summaries Are Duplicates

Work package summaries in the root index duplicate a subset of data from the work package detail files.

**Reason:** Performance — agents can list work packages without loading all detail files.

**Invariant:** Summaries must always match the corresponding detail files. This is enforced by `createWorkPackageWithSync()` (creation) and `updateWorkPackageWithSync()` (updates).

---

### ⚠️ REWORK Is Triggered Only by the Most Recent FAIL

The REWORK recommendation in `ledger_get_next_action` is based **only on the most recent pipeline** of a given type, not any historical FAIL. A work package with pipeline history `[FAIL, PASS]` does NOT receive a REWORK recommendation — the PASS means the issue was resolved.

**Implementation:** `isMostRecentPipelineFail(pipelines, pipelineType)` — see [Internal Testing Utilities](api-surface.md#internal-testing-utilities).

---

### ⚠️ Documentation Handoff Skips Dependency-Blocked WPs

`getDocumentationHandoff` (and `getQaHandoff`, `getReviewerHandoff`) treat WPs blocked by incomplete dependencies as ineligible for their stage. If all unreviewed/undocumented WPs are dependency-blocked, the handoff returns `READY_FOR_SYNTHESIS` rather than routing the agent back to the Developer.

**Why it matters:** Without this check, a project where the only remaining WPs are blocked by incomplete dependencies would incorrectly route the Documentation Agent back to the Developer stage, stalling the workflow.

---

### ⚠️ Dependency Auto-Unblocking Uses a Separate Lock

When a work package transitions to `COMPLETE`, `propagateDependencyUnblock` automatically transitions eligible downstream dependents from `BLOCKED` to `READY`. This runs **after** the main lock in `updateWorkPackageStatus` is released — it acquires its own lock.

**Eligibility rule:** A BLOCKED WP is auto-unblocked only when **all its dependencies are terminal (COMPLETE or CANCELLED) AND its `blocked_by.type` is `"dependency"` or absent**. WPs blocked by `"external"`, `"decision"`, or `"technical"` reasons are intentionally skipped — their blockers must be resolved manually.

**Implication:** There is a brief window between the COMPLETE write and the unblocking write during which the root index shows the WP as COMPLETE but dependents are still BLOCKED. This is safe for single-user workflows, but would be a race condition risk in a concurrent multi-agent environment.

---

### ⚠️ WP ID Generation Is Max-Based, Not Length-Based

Work package IDs are generated by scanning the highest existing numeric suffix and adding 1. This means:
- Deleting a WP does not cause ID collisions (unlike a length+1 approach)
- IDs are monotonically increasing but may have gaps (e.g., WP-001, WP-003 if WP-002 was removed)
- IDs can be 3+ digits: the schema regex `/^WP-\d{3,}$/` supports WP-001 through WP-9999+

---

### ⚠️ Unknown Criteria Text in `acceptance_criteria_updates` Is Appended

When `ledger_complete_pipeline` is called with `acceptance_criteria_updates`, each update item is matched by exact criterion text:
- **Matched:** updates the `met` flag on the existing entry.
- **Not matched (unknown text):** appends a new `AcceptanceCriterion` entry `{ criterion, met }` to the WP's `acceptance_criteria` array.

---

### ⚠️ Metrics Object Is Extensible

The `metrics` object in pipelines uses `.passthrough()` in Zod, meaning it accepts additional fields beyond the predefined ones (`test_coverage`, `tests_passed`, etc.).

**Use case:** Custom metrics for different pipeline types (e.g., `build_time`, `bundle_size`).

---

### ⚠️ Lock File Persists After Server Exit

The `.lock` file inside `storage/ledger/{slug}/` is not automatically deleted when the server exits. It will be left on disk and overwritten on the next lock acquisition.

**Implication:** Safe to ignore — the lock system handles stale locks automatically.
