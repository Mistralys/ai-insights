# Research Report

## Problem Statement

Map all issues identified in the Agent Workflow Specification audit synthesis to their exact locations in the MCP server source code. For each issue, determine whether it exists in the current implementation, identify the exact file(s) and line(s) where problematic code lives, and describe the gap between current behavior and what the corrected spec should require.

## Problem Decomposition

1. Map critical workflow-breaking issues (C-1 through C-5) to code
2. Map design issues (D-1 through D-7) to code
3. Map ambiguities (A-1 through A-8) to code
4. Synthesize findings into a structured gap analysis

## Context & Constraints

- The audit was performed against the **specification** (agent-workflow-specification.md), not the implementation
- The implementation may already handle some issues differently from the spec
- The goal is to understand what the **code actually does** and where it diverges from what a corrected spec should require
- All paths are relative to `mcp-server/src/`

---

## Issue-by-Issue Code Mapping

---

### C-1: FAIL Handoff Logic Stalls Rework Loop

**Audit claim:** When QA FAILs, handoff returns `IN_PROGRESS` (trapping QA), next-action gives QA `REWORK_QA` (pointless), and handoff notes route to the wrong agent.

#### C-1a: Does `complete_pipeline` always use Next-Agent Map for `to_agent` even on FAIL?

**File:** [pipeline.ts](../../../mcp-server/src/tools/pipeline.ts#L289-L306)

```typescript
// Line 289-306 in completePipeline():
if (args.handoff_notes && args.handoff_notes.length > 0) {
  const fromAgent = PIPELINE_AGENT_MAP[args.type] ?? args.type;
  const toAgent = NEXT_AGENT_MAP[args.type] ?? 'Unknown';
  const note: HandoffNote = {
    from_agent: fromAgent,
    to_agent: toAgent,
    timestamp: now(),
    notes: args.handoff_notes,
  };
```

**Current behavior:** Yes — `to_agent` is **always** derived from `NEXT_AGENT_MAP` regardless of PASS/FAIL. For `qa → Reviewer`, even on FAIL the handoff note goes to Reviewer, not Developer.

**Map definition** ([pipeline-maps.ts](../../../mcp-server/src/utils/pipeline-maps.ts#L62-L68)):
```
NEXT_AGENT_MAP = {
  implementation: 'QA',
  qa: 'Reviewer',        // ← FAIL should route to Developer
  'code-review': 'Documentation',  // ← FAIL should route to Developer
  documentation: 'Synthesis',
}
```

**Gap:** On FAIL, `to_agent` should be `Developer` for qa/code-review/documentation failures. Needs a conditional or a separate `FAIL_AGENT_MAP`.

**However**, the `buildCompletionGuidance` function **does** give correct textual guidance on FAIL:

**File:** [pipeline.ts](../../../mcp-server/src/tools/pipeline.ts#L48-L62)
```typescript
// Lines 48-62: FAIL path for qa/code-review
return (
  `Pipeline FAIL. Do NOT set ${wpId} to BLOCKED — leave it as IN_PROGRESS. ` +
  `The Developer will see the FAIL ${pipelineType} pipeline via ledger_get_next_action...`
);
```

**Verdict:** The **guidance text** is correct but the **structured handoff note `to_agent`** is wrong. The note data routes to the wrong agent even though the human-readable guidance says the right thing.

---

#### C-1b: Does handoff computation return `IN_PROGRESS` when QA FAILs?

**File:** [workflow-handoff.ts](../../../mcp-server/src/tools/workflow-handoff.ts#L372-L430)

```typescript
// getQaHandoff(), ~line 408-430:
const needsWork = wpsWithImpl.some(
  (wp) =>
    wp.status !== 'BLOCKED' &&
    (!wp.pipelines.some((p) => p.type === 'qa') ||
    wp.pipelines.some((p) => p.type === 'qa' && p.status === 'FAIL'))
);

if (needsWork) {
  return buildHandoffResponse(
    'QA',
    'IN_PROGRESS',   // ← This is what the audit flags
    `QA work in progress. ${wpsNeedingWork.length} work package(s) still need QA or rework.`,
    `Call ledger_get_next_action with agent_role: "QA"...`,
```

**Current behavior:** Yes — when QA has FAIL pipelines and those WPs are not BLOCKED, handoff returns `IN_PROGRESS`. Per `nextAgentFromStatus` ([workflow-handoff.ts L118](../../../mcp-server/src/tools/workflow-handoff.ts#L118)): `'IN_PROGRESS' → return currentAgent` (i.e., QA). This traps QA as the "next agent."

**But note the nuance:** The `IN_PROGRESS` return here is **not always wrong**. Two sub-scenarios:

1. **QA FAIL but no new implementation PASS yet** — QA genuinely has a `REWORK_QA` action (see C-1c). The audit argues this is pointless, but the implementation deliberately includes it.
2. **QA FAIL and a new implementation PASS exists** — `hasNewUpstreamPassSince` in `getQaAction` would trigger `RUN_QA` instead of `REWORK_QA`, which IS correct.

The real stall occurs in scenario 1: after QA FAILs, no one tells the Developer to rework. But this IS handled — see the Developer's downstream FAIL detection:

**File:** [workflow-next-action.ts](../../../mcp-server/src/tools/workflow-next-action.ts#L272-L306)
```typescript
// getDeveloperAction(), ~line 272-306: downstream pipeline failure detection
for (const downstreamType of ['qa', 'code-review'] as const) {
  if (isMostRecentPipelineFail(wpDetail.pipelines, downstreamType)) {
    return {
      action: 'REWORK',
      work_package_id: wpDetail.work_package_id,
      reason: `...has a FAIL ${downstreamType} pipeline. Developer rework needed...`,
```

**Verdict:** The **Developer does see QA FAILs** via `getDeveloperAction` — the implementation already handles the main stall scenario. The issue is that QA's handoff returns `IN_PROGRESS` rather than `READY_FOR_DEVELOPER`, which means:
- Auto-handoff to Developer won't trigger (auto-handoff skips `IN_PROGRESS`)
- QA is told to continue working (misleading)

**Confirmed gap:** QA handoff should return `READY_FOR_DEVELOPER` when FAIL pipelines exist and no new upstream PASS has arrived. Currently it returns `IN_PROGRESS`.

---

#### C-1c: Does QA's next-action include a `REWORK_QA` action?

**File:** [workflow-next-action.ts](../../../mcp-server/src/tools/workflow-next-action.ts#L452-L474)

```typescript
// getQaAction(), ~line 452-474:
for (const wpDetail of wpDetails) {
  if (wpDetail.status !== 'BLOCKED' && isMostRecentPipelineFail(wpDetail.pipelines, 'qa')) {
    return {
      action: 'REWORK_QA',
      work_package_id: wpDetail.work_package_id,
      reason: `...has a FAIL QA pipeline. Investigate and retry QA.`,
```

**Current behavior:** Yes — `REWORK_QA` is returned when the most recent QA pipeline is FAIL and the WP is not BLOCKED. This **prioritizes below** the `hasNewUpstreamPassSince` check (line ~425), so if Developer already reworked and pushed a new implementation PASS, QA gets `RUN_QA` instead.

**Verdict:** `REWORK_QA` exists and is intentional in the implementation. The audit argues it's pointless on unchanged code, but the implementation treats it as a "QA can re-investigate their own findings" action. Whether this is correct is a spec design decision, not a bug. The more critical issue is C-1b (handoff routing).

---

### C-2: Rework Count Semantics

**Audit claim:** Contradictory rules on when `rework_count` increments — "any prior FAIL" vs "most recent is FAIL."

**File:** [pipeline.ts](../../../mcp-server/src/tools/pipeline.ts#L147-L153)

```typescript
// startPipeline(), ~line 147-153:
// 6. Increment rework_count if restarting a previously-failed pipeline of the same type
const hasPreviousFail = wp.pipelines.some(
  (p) => p.type === args.type && p.status === 'FAIL'
);
if (hasPreviousFail) {
  wp.rework_count = (wp.rework_count ?? 0) + 1;
}
```

**Current behavior:** Uses **"any prior FAIL"** semantics — `Array.some()` checks if **any** historical pipeline of that type has `FAIL` status, not just the most recent. This means:

- History `[FAIL, PASS]` + starting new implementation → `hasPreviousFail = true` → **increments**
- This matches §7.1/§7.6 but contradicts §13.2's walkthrough

**Absent field handling:** `(wp.rework_count ?? 0) + 1` — treats absent as `0`, then increments to `1`. This resolves ambiguity A-2.

**Gap:** The implementation chose "any prior FAIL" semantics. If the spec correction decides on "most recent is FAIL" semantics, this line needs to change from `.some()` to checking `.at(-1)?.status === 'FAIL'`. Additionally, this counter doesn't track cross-pipeline rework cycles (e.g., impl PASS → QA FAIL → new impl doesn't increment because impl never failed).

---

### C-3: Synthesis Has No Terminal Mechanism

**Audit claim:** `GENERATE_SYNTHESIS` loops indefinitely; self-healing marks COMPLETE before synthesis; no terminal flag.

#### C-3a: Does the global pre-check for "all WPs COMPLETE" trigger `GENERATE_SYNTHESIS` indefinitely?

**File:** [workflow-next-action.ts](../../../mcp-server/src/tools/workflow-next-action.ts#L82-L109)

```typescript
// getNextAction(), ~line 82-109:
const allComplete = rootIndex.work_packages.every(
  (wp) => wp.status === 'COMPLETE'
);

if (allComplete) {
  if (args.agent_role === 'Synthesis') {
    return {
      action: 'GENERATE_SYNTHESIS',
      reason: 'All work packages are COMPLETE. Generate synthesis report.',
    };
  }
```

**Current behavior:** Yes — **every call** with `agent_role: 'Synthesis'` when all WPs are COMPLETE returns `GENERATE_SYNTHESIS`. There is no flag, counter, or state that records whether synthesis has already been generated. This is an infinite loop.

#### C-3b: Is there any `synthesis_generated` flag or terminal project status?

**File:** [schema/enums.ts](../../../mcp-server/src/schema/enums.ts#L6-L8)

```typescript
export const ProjectStatus = z.enum(['READY', 'IN_PROGRESS', 'COMPLETE', 'BLOCKED']);
```

**Current behavior:** No `DONE`, `SYNTHESIZED`, or `CLOSED` status exists. No `synthesis_generated` flag exists on the root index schema.

#### C-3c: Does self-healing set COMPLETE before synthesis runs?

**File:** [project-lifecycle.ts](../../../mcp-server/src/tools/project-lifecycle.ts#L109-L116)

```typescript
// getProjectStatus() self-healing, ~line 109-116:
if (
  rootIndex.status === 'IN_PROGRESS' &&
  pendingWps === 0 &&
  totalWps > 0
) {
  // All work packages are done — project should be COMPLETE
  healedStatus = 'COMPLETE';
}
```

**Current behavior:** Yes — as soon as `pending_work_packages === 0` (all WPs COMPLETE), self-healing sets the project to `COMPLETE`. This happens when Documentation finishes the last WP, **before** Synthesis runs.

**Verdict:** All three sub-issues confirmed. The implementation has no mechanism to prevent infinite `GENERATE_SYNTHESIS` calls and no way to record that synthesis is done.

---

### C-4: No Circular Dependency Detection

**File:** [work-package.ts](../../../mcp-server/src/tools/work-package.ts#L215-L227)

```typescript
// createWorkPackage(), ~line 215-227: dependency validation
for (const depId of args.dependencies) {
  const depExists = rootIndex.work_packages.some(
    (wp) => wp.work_package_id === depId
  );
  if (!depExists) {
    throw new Error(
      `Dependency ${depId} not found in project...`
    );
  }
}
```

**Current behavior:** Only checks that dependency IDs **exist**. No cycle detection. If WP-001 depends on WP-002 and WP-002 depends on WP-001, both will be created as BLOCKED and never unblockable.

**Note:** Technically, creating `WP-001 → WP-002` first requires WP-002 to already exist (validated above). So a **direct** A→B, B→A cycle requires creating both without dependencies first, then somehow adding deps later. But the current `create_work_package` doesn't allow dep editing after creation. **Indirect** cycles (A→B→C→A) across 3+ WPs ARE possible: create A, create B(dep:A), create C(dep:B), then create D(dep:C,A) — wait, that's not a cycle.

Actually, re-examining: since deps are declared at creation time and each dep must already exist, a cycle requires creating WP-001 (no deps), WP-002 (dep: WP-001), then... WP-001 can't add WP-002 as a dep after creation. **The current API makes direct cycles impossible** because there's no "add dependency" operation — deps are immutable at creation.

**Revised verdict:** Circular dependencies are **not possible** with the current tool surface because dependencies are set at creation time and the target WP must already exist. A cycle would require a WP to depend on a WP created after it, which the existence check prevents. **The audit issue applies to the spec but NOT to the implementation.** However, if an "edit dependencies" tool is ever added, cycle detection would become necessary.

---

### C-5: Reopen Doesn't Cascade-Block Dependents

**File:** [work-package.ts](../../../mcp-server/src/tools/work-package.ts#L475-L510)

```typescript
// updateWorkPackageStatus(), ~line 497-505: COMPLETE → IN_PROGRESS
if (oldStatus === 'COMPLETE' && newStatus === 'IN_PROGRESS') {
  wp.revision += 1;
}

// ... only propagateDependencyUnblock fires on COMPLETE:
if (args.status === 'COMPLETE') {
  await propagateDependencyUnblock(args.project_path, args.work_package_id);
}
```

**Current behavior:** When a WP goes COMPLETE→IN_PROGRESS:
- `revision` is incremented (line 497)
- No cascade-block of dependents occurs
- `propagateDependencyUnblock` only runs on transitions **to** COMPLETE, not **from** it

Dependent WPs that were unblocked when this WP completed remain in their current status (READY/IN_PROGRESS/COMPLETE). They can proceed on stale assumptions.

**Agent guard** ([work-package.ts L482-L493](../../../mcp-server/src/tools/work-package.ts#L482-L493)): Only PM or Documentation can reopen.

**Verdict:** Confirmed. No `propagateDependencyReblock` exists. This is a real gap — reopening a WP should cascade-block its dependents.

---

### D-1: Lock Retry Window Too Short

**File:** [storage/file-lock.ts](../../../mcp-server/src/storage/file-lock.ts#L8-L14)

```typescript
const LOCK_OPTIONS = {
  stale: 10000,    // 10 seconds
  retries: {
    retries: 5,
    minTimeout: 200,
    maxTimeout: 1000,
  },
};
```

**Current behavior:**
- Stale timeout: **10 seconds**
- Retries: **5**
- Min retry interval: **200ms**, max: **1000ms**
- Total worst-case retry window: 5 × 1000ms = **~5 seconds** (with exponential backoff from `proper-lockfile`)
- Total best-case retry window: 5 × 200ms = **~1 second**

**Gap:** A lock holder taking 2–5 seconds (legitimate for multi-file writes) will cause other agents to fail. The retry window should at least match the stale timeout (10s). Recommended: increase retries to ~20 or increase minTimeout.

---

### D-2: Timestamps Use Local Time

**File:** [utils/timestamp.ts](../../../mcp-server/src/utils/timestamp.ts#L1-L16)

```typescript
export function now(): string {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');

  // NOTE: toISOString() converts to UTC, which would corrupt timestamps for
  // users in non-UTC timezones. This manual construction uses local time
  // deliberately. Do not replace with toISOString().
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
}
```

**Current behavior:** Uses **local time deliberately**. The comment explicitly warns against using `toISOString()`. Output format: `YYYY-MM-DDTHH:MM:SS` (no timezone suffix).

**Where timestamps are compared:** [workflow-helpers.ts](../../../mcp-server/src/utils/workflow-helpers.ts#L140-L170) — `hasNewUpstreamPassSince` compares `completed_at` vs `started_at` via `Date.getTime()`.

**`parseTimestamp`** ([timestamp.ts L22-L30](../../../mcp-server/src/utils/timestamp.ts#L22-L30)):
```typescript
export function parseTimestamp(ts: string): Date {
  return new Date(ts.replace(' ', 'T'));
}
```

When `new Date('2026-02-25T14:30:00')` is called without a `Z` suffix, JavaScript interprets it as **local time**. So comparison is self-consistent if all timestamps are generated on the same machine.

**Gap:** Cross-machine or cross-timezone scenarios (e.g., orchestrator on a different server) will produce incorrect temporal comparisons. However, the implementation comment indicates this is a **deliberate design choice** for single-machine use. The fix would require migrating all existing ledger files.

---

### D-3: No WP Cancellation

**File:** [schema/enums.ts](../../../mcp-server/src/schema/enums.ts#L12-L13)

```typescript
export const WorkPackageStatus = z.enum(['READY', 'IN_PROGRESS', 'COMPLETE', 'BLOCKED']);
```

**Current behavior:** No `CANCELLED` status. The only statuses are READY, IN_PROGRESS, COMPLETE, BLOCKED.

**File:** [schema/validators.ts](../../../mcp-server/src/schema/validators.ts#L18-L39) — transition rules have no mention of CANCELLED.

**Verdict:** Confirmed. There is no cancellation mechanism. An unwanted WP must be forced through the full pipeline to COMPLETE or left as BLOCKED forever.

---

### D-4: No Rework Circuit Breaker

**Checked files:**
- [pipeline.ts L147-L153](../../../mcp-server/src/tools/pipeline.ts#L147-L153) — `rework_count` is incremented but **never checked against a maximum**
- [workflow-next-action.ts](../../../mcp-server/src/tools/workflow-next-action.ts) — no `max_rework_count` check anywhere
- [workflow-helpers.ts](../../../mcp-server/src/utils/workflow-helpers.ts) — no circuit breaker logic

**Current behavior:** `rework_count` is tracked but never enforced. There is no `max_rework_count` configuration or check. A persistent defect causes unlimited Developer→QA→Developer loops.

**Contrast:** `max_handoff_depth` IS checked in `buildHandoffResponse` ([workflow-handoff.ts L161-L171](../../../mcp-server/src/tools/workflow-handoff.ts#L161-L171)).

**Verdict:** Confirmed. Rework count is a write-only metric — incremented but never used for control flow.

---

### D-5: WP ID Format Caps at 999

**File:** [utils/wp-id.ts](../../../mcp-server/src/utils/wp-id.ts#L6-L8)

```typescript
export function formatWpId(n: number): string {
  return `WP-${String(n).padStart(3, '0')}`;
}
```

**Current behavior:** `padStart(3, '0')` means WP-1000 would format as `WP-1000` (4 digits, not zero-padded to 3). This **would not break** `formatWpId` itself.

**But the validation regex:**

- [pipeline.ts L84](../../../mcp-server/src/tools/pipeline.ts#L84): `regex(/^WP-\d{3}$/)`
- [work-package.ts L77](../../../mcp-server/src/tools/work-package.ts#L77): `regex(/^WP-\d{3}$/)`
- [work-package.ts L281](../../../mcp-server/src/tools/work-package.ts#L281): `regex(/^WP-\d{3}$/)`

All input schemas use `\d{3}` (exactly 3 digits). WP-1000 would be created with `formatWpId(1000)` → `"WP-1000"` but then **rejected by every tool's input validation** because `"WP-1000"` doesn't match `\d{3}`.

**Verdict:** Confirmed. The system will break at WP-1000. The regex needs to be `\d{3,}` or the 999 limit needs to be documented.

**Parse side** ([wp-id.ts L18](../../../mcp-server/src/utils/wp-id.ts#L18)): `parseWpId` uses `/^WP-(\d+)$/` — this would accept WP-1000. Inconsistency between parse (lenient) and validate (strict).

---

### D-6: Documentation FAIL Routing

**File:** [workflow-next-action.ts](../../../mcp-server/src/tools/workflow-next-action.ts#L256-L306)

```typescript
// getDeveloperAction(), ~line 272-306:
// Look for downstream pipeline failures (QA or code-review)...
for (const downstreamType of ['qa', 'code-review'] as const) {
  if (isMostRecentPipelineFail(wpDetail.pipelines, downstreamType)) {
```

**Current behavior:** Developer only checks for `qa` and `code-review` FAILs. **`documentation` is not checked.** If a documentation pipeline fails because of a code issue, Developer will never see it.

**File:** [workflow-batch-actions.ts](../../../mcp-server/src/tools/workflow-batch-actions.ts#L247-L268) — same pattern: `for (const downstreamType of ['qa', 'code-review'] as const)`.

**Documentation's own handling** ([workflow-next-action.ts L658-L680](../../../mcp-server/src/tools/workflow-next-action.ts#L658-L680)): Documentation gets `REWORK_DOCS` when its most recent doc pipeline is FAIL. It handles its own rework.

**Verdict:** Confirmed. No path from documentation FAIL to Developer. Documentation handles its own FAIL, but if the root cause is code (not docs), there's no routing mechanism to Developer. The audit's recommended fix (Documentation should BLOCK with a `technical` blocker to route to PM) is not implemented.

---

### D-7: Self-Heal Mutates on Read

**File:** [project-lifecycle.ts](../../../mcp-server/src/tools/project-lifecycle.ts#L120-L133)

```typescript
// getProjectStatus(), ~line 120-133:
if (
  rootIndex.total_work_packages !== totalWps ||
  rootIndex.pending_work_packages !== pendingWps ||
  rootIndex.status !== healedStatus
) {
  rootIndex.total_work_packages = totalWps;
  rootIndex.pending_work_packages = pendingWps;
  rootIndex.status = healedStatus;
  rootIndex.last_updated = now();

  // Write the corrected root index
  await store.writeRootIndex(rootIndex);
}
```

**Current behavior:** `get_project_status` (a conceptually read-only tool) **writes to disk** when it detects counter/status drift. This happens without acquiring the file lock (no `withLock` wrapper around `getProjectStatus`).

**No lock protection:** The entire `getProjectStatus` function runs outside any lock. If another agent concurrently writes, the self-heal write could overwrite those changes.

**Verdict:** Confirmed. Self-healing is a write-on-read without lock protection. This is both surprising semantically and a race condition risk.

---

### A-1: COMPLETE→COMPLETE No-Op vs Role Guard

**File:** [schema/validators.ts](../../../mcp-server/src/schema/validators.ts#L21-L26)

```typescript
// Same status is always valid (no-op)
if (from === to) {
  return true;
}
```

**File:** [work-package.ts](../../../mcp-server/src/tools/work-package.ts#L447-L459) — the "only Documentation" guard:

```typescript
if (newStatus === 'COMPLETE') {
  if (args.agent !== 'Documentation Agent' && args.agent !== 'Documentation') {
    throw new Error(`Only the Documentation Agent can mark work packages as COMPLETE...`);
  }
}
```

**Current behavior:** Status transition validation passes (COMPLETE→COMPLETE is valid), but then the role guard fires because `newStatus === 'COMPLETE'`. So a Developer calling COMPLETE→COMPLETE **would be rejected** by the role guard. The no-op doesn't bypass guards.

**Verdict:** Ambiguity exists in spec but the implementation **already resolves it** — role guards apply even for no-ops.

---

### A-2: Incrementing Absent `rework_count`

**File:** [pipeline.ts L151](../../../mcp-server/src/tools/pipeline.ts#L151)

```typescript
wp.rework_count = (wp.rework_count ?? 0) + 1;
```

**Current behavior:** Null-coalesces absent to `0`, then increments. Already handled.

**Verdict:** Resolved in implementation.

---

### A-3: Acceptance Criteria Merge on Unknown Criterion

**File:** [pipeline.ts](../../../mcp-server/src/tools/pipeline.ts#L278-L287)

```typescript
if (args.acceptance_criteria_updates) {
  for (const update of args.acceptance_criteria_updates) {
    const criterion = wp.acceptance_criteria.find(
      (ac) => ac.criterion === update.criterion
    );
    if (criterion) {
      criterion.met = update.met;
    }
  }
}
```

**Current behavior:** Unknown criteria are **silently ignored** (the `if (criterion)` check skips non-matches). No error, no append.

**Verdict:** Implementation chose option (b) from the audit — silent ignore. This should be documented.

---

### A-4: Empty Acceptance Criteria Passes Vacuously

**File:** [schema/validators.ts](../../../mcp-server/src/schema/validators.ts#L86-L97)

```typescript
export function canCompleteWorkPackage(wp: WorkPackageDetail): {
  allowed: boolean;
  unmet?: string[];
} {
  const unmetCriteria = wp.acceptance_criteria
    .filter((criterion) => !criterion.met)
    .map((criterion) => criterion.criterion);

  if (unmetCriteria.length > 0) {
    return { allowed: false, unmet: unmetCriteria };
  }
  return { allowed: true };
}
```

**Current behavior:** If `acceptance_criteria` is an empty array, `unmetCriteria` is empty, so `allowed: true`. WP with no acceptance criteria **can be marked COMPLETE vacuously**.

**Verdict:** Confirmed. Empty acceptance criteria bypasses the completion check. Whether this is intentional or a bug is a spec decision.

---

### A-5: PM Blocker Resolution Mechanism

**File:** [work-package.ts](../../../mcp-server/src/tools/work-package.ts#L489-L492)

```typescript
// Handle any exit from BLOCKED (clear blocker)
if (oldStatus === 'BLOCKED' && newStatus !== 'BLOCKED') {
  delete wp.blocked_by;
}
```

**Current behavior:** PM (or any agent) can call `update_work_package_status(BLOCKED → IN_PROGRESS)` or `(BLOCKED → READY)`, and `blocked_by` is automatically cleared. The status transition validator allows both transitions.

**Verdict:** The mechanism exists and works. No explicit documentation in tool descriptions, but functionally complete.

---

### A-6: `override: true` Claim Authorization

**File:** [work-package.ts](../../../mcp-server/src/tools/work-package.ts#L307-L316)

```typescript
if (
  wp.assigned_to &&
  wp.assigned_to !== args.agent &&
  !args.override
) {
  throw new Error(
    `Cannot claim work package ${args.work_package_id}: it is assigned to "${wp.assigned_to}"...`
  );
}
```

**Current behavior:** Any agent can use `override: true` — there is no role-based authorization check. No audit trail is recorded for overrides.

**Verdict:** Confirmed ambiguity. Any role can override any assignment with no logging.

---

### A-7: Multi-WP Parallel Processing

**File:** [workflow-batch-actions.ts](../../../mcp-server/src/tools/workflow-batch-actions.ts) — entire file

**Current behavior:** `ledger_get_next_actions` (plural) exists and returns up to `max_results` (default 5) actionable WPs. This explicitly supports parallel processing within a single agent invocation.

**Verdict:** The implementation **already supports** batch/parallel processing via the `get_next_actions` tool. The spec ambiguity is resolved.

---

### A-8: Auto-Unblock Targets READY, Losing Prior IN_PROGRESS State

**File:** [work-package.ts](../../../mcp-server/src/tools/work-package.ts#L561-L583)

```typescript
// propagateDependencyUnblock():
const canStart = canStartWorkPackage(wpDetail, rootIndex.work_packages);
if (!canStart.allowed) continue;

// Transition BLOCKED -> READY and clear blocked_by
wpDetail.status = 'READY';
delete wpDetail.blocked_by;
```

**Current behavior:** Always transitions to `READY`, regardless of what status the WP had before being BLOCKED. If a WP was `IN_PROGRESS` → `BLOCKED` → auto-unblocked, it becomes `READY` (losing the IN_PROGRESS state). The agent must re-claim it.

**Verdict:** Confirmed. Prior status is not preserved. This is likely intentional (force re-claim for safety) but undocumented.

---

## Comparative Evaluation

| Issue | Exists in Code? | Severity in Implementation | Implementation Mitigation |
|-------|:-:|:-:|---|
| **C-1a** FAIL handoff note routing | **YES** | High | `buildCompletionGuidance` gives correct text, but structured `to_agent` is wrong |
| **C-1b** QA handoff returns IN_PROGRESS on FAIL | **YES** | High | Developer's `getDeveloperAction` catches downstream FAILs, but auto-handoff breaks |
| **C-1c** QA gets REWORK_QA | **YES** | Medium | Intentional — QA can re-investigate; lower priority than hasNewUpstreamPassSince |
| **C-2** Rework count "any FAIL" semantics | **YES** | Medium | Consistent implementation but may not match desired spec semantics |
| **C-3a** Synthesis infinite loop | **YES** | Critical | No mitigation — every call returns GENERATE_SYNTHESIS |
| **C-3b** No synthesis flag | **YES** | Critical | No terminal state exists |
| **C-3c** Self-heal sets COMPLETE early | **YES** | High | Synthesis has no state to prevent premature completion |
| **C-4** No cycle detection | **NO** | N/A | API design prevents cycles — deps are immutable and must pre-exist |
| **C-5** Reopen doesn't cascade-block | **YES** | High | No mitigation |
| **D-1** Lock retry too short | **YES** | Medium | Retry window ~1-5s vs 10s stale timeout |
| **D-2** Local timestamps | **YES** | Low-Medium | Deliberate design choice; self-consistent on single machine |
| **D-3** No CANCELLED status | **YES** | Medium | No mitigation |
| **D-4** No rework circuit breaker | **YES** | Medium | `rework_count` tracked but never enforced |
| **D-5** WP ID caps at 999 | **YES** | Low | Will break at WP-1000 due to regex |
| **D-6** Docs FAIL no Developer routing | **YES** | Low | Documentation handles own rework |
| **D-7** Self-heal mutates on read | **YES** | Medium | No lock protection on self-heal write |
| **A-1** COMPLETE→COMPLETE role guard | Resolved | N/A | Guards apply to no-ops |
| **A-2** Absent rework_count | Resolved | N/A | Null-coalesced to 0 |
| **A-3** Unknown criterion merge | Resolved | N/A | Silently ignored |
| **A-4** Empty AC vacuous pass | **YES** | Low | Possibly intentional |
| **A-5** PM blocker resolution | Resolved | N/A | BLOCKED→READY/IN_PROGRESS clears blocked_by |
| **A-6** Override authorization | **YES** | Low | No role check on override |
| **A-7** Multi-WP parallel | Resolved | N/A | Batch tool exists |
| **A-8** Auto-unblock loses state | **YES** | Low | Always targets READY |

## Recommendation

### Priority 1 — Fix Now (workflow-breaking in implementation)

1. **C-3 (Synthesis terminal):** Add `synthesis_generated` flag to root index schema. Guard `GENERATE_SYNTHESIS` behind `!rootIndex.synthesis_generated`. Add a `ledger_mark_synthesis_complete` tool or have Synthesis set the flag. Prevent self-healing from setting COMPLETE until `synthesis_generated === true`.

2. **C-1b (QA handoff routing):** In `getQaHandoff`, when FAIL pipelines exist and no new upstream PASS, return `READY_FOR_DEVELOPER` instead of `IN_PROGRESS`. Same pattern for Reviewer and Documentation handoff functions.

3. **C-1a (Handoff note to_agent):** In `completePipeline`, add FAIL-aware routing: `const toAgent = args.status === 'FAIL' ? 'Developer' : NEXT_AGENT_MAP[args.type]` for post-impl pipelines.

4. **C-5 (Cascade-block on reopen):** Add `propagateDependencyReblock` function that runs when COMPLETE→IN_PROGRESS. Set dependent non-COMPLETE WPs to BLOCKED.

### Priority 2 — Fix Before Production

5. **D-1 (Lock timing):** Increase retries to 20 and/or minTimeout to 500ms.
6. **D-4 (Circuit breaker):** Add `max_rework_count` config check in `startPipeline` after incrementing.
7. **D-5 (WP ID regex):** Change all `\d{3}` to `\d{3,}` in Zod schemas.
8. **D-3 (CANCELLED status):** Add to enums and validator transitions.
9. **D-7 (Self-heal lock):** Wrap the write in `getProjectStatus` with `withLock`.
10. **C-2 (Rework semantics):** Decide on "most recent FAIL" semantics and change `.some()` to `.at(-1)` check if needed.

### Priority 3 — Document or Defer

11. **D-2 (Timestamps):** Document as intentional for single-machine use, or migrate to UTC.
12. **D-6 (Docs FAIL):** Document that Documentation handles own FAIL; add blocker workflow for code issues.
13. **A-4, A-6, A-8:** Document current behavior as intentional.
14. **C-4 (Cycles):** Document that cycles are prevented by API design. Add check if edit-deps tool is added.

## Open Questions

- Should `REWORK_QA` / `REWORK_REVIEW` be removed entirely (audit recommendation) or kept as intentional "re-investigate" actions? The implementation clearly chose to keep them.
- Should rework_count semantics be "any prior FAIL" (current) or "most recent FAIL" (walkthrough)? The implementation and spec need to agree.
- Is the local-time timestamp decision permanent? Cross-machine orchestrator use may force UTC migration.
- Should `get_project_status` self-healing be behind a lock, or should it be split into read-only and repair functions?

## References

- [Audit synthesis](../research/agent-workflow-specification-audit-synthesis.md)
- [pipeline.ts](../../../mcp-server/src/tools/pipeline.ts) — pipeline start/complete/cancel
- [workflow-handoff.ts](../../../mcp-server/src/tools/workflow-handoff.ts) — handoff status computation
- [workflow-next-action.ts](../../../mcp-server/src/tools/workflow-next-action.ts) — next-action computation
- [workflow-batch-actions.ts](../../../mcp-server/src/tools/workflow-batch-actions.ts) — batch actions
- [workflow-helpers.ts](../../../mcp-server/src/utils/workflow-helpers.ts) — shared helpers
- [work-package.ts](../../../mcp-server/src/tools/work-package.ts) — WP CRUD + status transitions
- [project-lifecycle.ts](../../../mcp-server/src/tools/project-lifecycle.ts) — project status self-healing
- [validators.ts](../../../mcp-server/src/schema/validators.ts) — transition rules
- [enums.ts](../../../mcp-server/src/schema/enums.ts) — status enums
- [pipeline-maps.ts](../../../mcp-server/src/utils/pipeline-maps.ts) — routing maps
- [wp-id.ts](../../../mcp-server/src/utils/wp-id.ts) — WP ID formatting
- [timestamp.ts](../../../mcp-server/src/utils/timestamp.ts) — timestamp handling
- [file-lock.ts](../../../mcp-server/src/storage/file-lock.ts) — lock parameters
