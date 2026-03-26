# Dependencies & Rework

> Part of the [Agent Workflow Specification](README.md).

---

## 15. Dependency Management

### 15.1 Initial Status Based on Dependencies

When creating a WP:

```
if dependencies is empty OR all dependencies have terminal status:
  initial_status = READY
  blocked_by = null
else:
  initial_status = BLOCKED
  unresolvedDeps = dependencies.filter(d => NOT isTerminalStatus(d.status))
  blocked_by = {
    type: "dependency",
    description: "Depends on " + unresolvedDeps.map(d => d.work_package_id).join(", "),
    blocking_work_package: unresolvedDeps[0].work_package_id
  }
```

> **Single-blocker limitation:** The `blocking_work_package` field references only the first unresolved dependency. The `description` field lists all unresolved dependencies for diagnostic visibility, but `blocked_by` is a single object (see [§21.35](edge-cases.md#2135-single-blocker-metadata-limitation)). This does not affect auto-unblock correctness — `propagateDependencyUnblock` (§15.4) checks **all** dependencies regardless of the `blocked_by` content.

### 15.2 Dependency Validation on Creation

All dependency IDs must exist in the root index. Unknown IDs are rejected.

Dependency graphs must be **acyclic**. On creation, perform a cycle check:

```
function hasCycle(newWpId, dependencies, allSummaries):
  visited = Set()
  queue = [...dependencies]
  
  while queue is not empty:
    current = queue.pop()
    if current == newWpId:
      return true    // Cycle detected
    if visited.has(current):
      continue
    visited.add(current)
    dep = allSummaries.find(s => s.work_package_id == current)
    if dep is not null:
      queue.pushAll(dep.dependencies)
  
  return false
```

If a cycle is detected, the WP creation is rejected with an error identifying the cycle path.

> **Structural note — defense-in-depth only:** Under normal operation, cycles are impossible by construction. WP IDs are generated sequentially (§3.6) and dependencies must reference pre-existing IDs (§15.2 validation above), so no existing WP can list `newWpId` as a dependency — the traversal from the new WP's dependencies through the graph can never reach `newWpId`. This check exists as defense-in-depth against data corruption (e.g., a WP referencing a future ID due to manual file editing or interrupted writes). Implementations SHOULD still include it, but should not rely on it as the primary cycle-prevention mechanism — the sequential-ID + existing-ID-only invariants are the real guards.

> **Deliberate limitation — no post-creation dependency updates:** The `dependencies` array is set at WP creation time and cannot be modified thereafter. No `updateDependencies` or `addDependency` operation exists. If the PM discovers mid-project that WP-005 depends on WP-003, the available workarounds are: (a) cancel WP-005 and recreate it with the correct dependencies (losing all pipeline history and rework counts), or (b) manually BLOCKED WP-005 with a `dependency` blocker referencing WP-003 — however, this workaround does not participate in `propagateDependencyUnblock` (§15.4) because auto-unblock checks the `dependencies` array, not the `blocked_by` field; the PM must manually unblock when WP-003 completes. This limitation keeps the dependency graph immutable after creation, simplifying cycle detection and cascade logic. Implementations that need post-creation dependency mutation SHOULD add an `updateDependencies` operation with cycle detection, auto-block/unblock re-evaluation, and root index synchronization.

### 15.3 Dependency Check for Claiming

```
function canStartWorkPackage(wp, allSummaries):
  for each depId in wp.dependencies:
    dep = allSummaries.find(s => s.work_package_id == depId)
    if dep is null:
      return { allowed: false, reason: "Dependency not found" }
    if not isTerminalStatus(dep.status):
      return { allowed: false, reason: "Dependency not complete" }
  return { allowed: true }
```

> Both COMPLETE and CANCELLED satisfy dependency requirements.
>
> **Design note on CANCELLED:** A cancelled WP unblocks its dependents even though the work was never completed. This is intentional — the Project Manager is responsible for validating that the dependency is no longer needed before cancelling. If dependent WPs still require the deliverables, the PM should restructure dependencies before cancelling.

### 15.4 Automatic Unblocking (propagateDependencyUnblock)

When a WP transitions to a terminal status (COMPLETE or CANCELLED):

```
function propagateDependencyUnblock(projectPath, completedWpId):
  acquire lock
  read root index
  
  candidates = root.work_packages.filter(
    wp => wp.status == "BLOCKED" AND wp.dependencies.includes(completedWpId)
  )
  
  for each candidate:
    wpDetail = readWorkPackage(candidate.id)
    
    // Check ALL dependencies, not just the one that completed
    if not canStartWorkPackage(wpDetail, root.work_packages).allowed:
      continue    // Other dependencies still incomplete
    
    // Skip non-dependency blockers
    if wpDetail.blocked_by AND wpDetail.blocked_by.type not in ["dependency", null]:
      continue    // External/decision/technical blockers need manual resolution
    
    // Unblock
    wpDetail.status = "READY"
    wpDetail.blocked_by = null
    root.work_packages[candidate.id].status = "READY"
    
    write wpDetail
  
  write root index
  release lock
```

> **Design note — auto-unblock always transitions to READY (not back to IN_PROGRESS):**
> When a WP was blocked, its context may have drifted — the agent that originally claimed it may no longer be in session, the implementation plan may have changed, or the unblocking dependency's output may differ from what was assumed. Requiring an explicit re-claim (READY → IN_PROGRESS) is a safe default that forces the agent to re-evaluate the WP before resuming.
>
> The `assigned_to` field is preserved through the block/unblock cycle, so the recommendation engine will still route the WP to the correct agent. The re-claim step is lightweight (single tool call) and provides explicit confirmation of intent.

> **\u26a0 Stuck-agent limitation:** Because `assigned_to` is preserved through the block/unblock cycle, the WP is routed exclusively to the preserved agent after auto-unblock. If that agent is no longer available (session ended, agent crashed), no other pipeline agent can claim the WP without PM override (`claimWorkPackage` §10.1 rejects when `wp.assigned_to` is set and the caller differs). The WP will eventually be surfaced via the PM's `REVIEW_ABANDONED` action ([§14.1.2](recommendations.md#1412-project-manager-action-logic), priority 3b), but this requires the staleness threshold to elapse. Implementations that need faster recovery MAY detect assignment-to-absent-agent conditions (e.g., cross-referencing `assigned_to` with active agent sessions) and proactively unclaim the WP.

### 15.5 Cascade Reblocking (propagateDependencyReblock)

When a COMPLETE WP is reopened (COMPLETE → IN_PROGRESS):

```
function propagateDependencyReblock(projectPath, reopenedWpId):
  acquire lock
  read root index
  
  // Find non-terminal, non-BLOCKED WPs that depend on the reopened WP
  candidates = root.work_packages.filter(
    wp => not isTerminalStatus(wp.status)
      AND wp.status != "BLOCKED"
      AND wp.dependencies.includes(reopenedWpId)
  )
  
  for each candidate:
    wpDetail = readWorkPackage(candidate.id)
    
    // Cancel any IN_PROGRESS pipelines (they are now invalid)
    for each pipeline in wpDetail.pipelines:
      if pipeline.status == "IN_PROGRESS":
        pipeline.status = "FAIL"
        pipeline.completed_at = now()
        pipeline.summary = ["Auto-cancelled: dependency {reopenedWpId} was reopened"]
        pipeline.auto_cancelled = true    // Excludes from rework budget (§21.27)
    
    wpDetail.status = "BLOCKED"
    wpDetail.blocked_by = {
      type: "dependency",
      description: "Dependency {reopenedWpId} was reopened",
      blocking_work_package: reopenedWpId
    }
    root.work_packages[candidate.id].status = "BLOCKED"
    
    write wpDetail
  
  // Warn about transitive dependents that may be working on stale assumptions.
  // Cascade reblock only targets DIRECT dependents of the reopened WP.
  // Transitive dependents (WPs that depend on a direct dependent) are NOT
  // automatically reblocked. Their in-flight pipelines continue executing
  // against potentially invalidated assumptions. This is a known limitation:
  // State-machine integrity is preserved: transitive dependents cannot
  //   reach COMPLETE because their direct dependency (now BLOCKED) is
  //   non-terminal, failing the freshness/dependency checks.
  // - However, in-flight work on transitive dependents may be wasted.
  // - Implementations MAY extend this function with recursive traversal to
  //   reblock transitive dependents. If so, use the same auto_cancelled
  //   pipeline closure pattern and dependency blocker as direct dependents.
  // See §21.42 for the full discussion of this limitation.

  // Warn about COMPLETE dependents that may now be stale
  completeDependents = root.work_packages.filter(
    wp => wp.status == "COMPLETE"
      AND wp.dependencies.includes(reopenedWpId)
  )
  
  for each completeDep in completeDependents:
    root.project_comments.append({
      type: "warning",
      priority: "high",
      timestamp: now(),
      agent: "system",
      note: "WP {completeDep.work_package_id} completed based on {reopenedWpId}, "
            + "which has been reopened. Review whether {completeDep.work_package_id} "
            + "needs rework."
    })
  
  // Recompute pending counter
  root.pending_work_packages = count(wp in root.work_packages where not isTerminalStatus(wp.status))
  
  // Safety net: ensure synthesis_generated is reset when a WP is reopened.
  // Primary reset happens during the COMPLETE → IN_PROGRESS transition (§6.2);
  // this catches the case where that reset was missed due to a crash.
  if root.synthesis_generated:
    root.synthesis_generated = false
    root.synthesis_generated_at = null    // §21.57: clear staleness timestamp
  
  root.last_updated = now()
  write root index
  release lock
```

### 15.6 Blocker Types

| Type | Auto-Clearable? | Description |
|------|----------------|-------------|
| `dependency` | Yes | Cleared when all dependencies become terminal |
| `decision` | No | Requires human decision |
| `external` | No | External factor (third-party, infrastructure) |
| `technical` | No | Technical issue requiring investigation |

Only `dependency` blockers (or absent `blocked_by.type`) are auto-cleared by `propagateDependencyUnblock`. All other types require manual intervention.

---

## 16. Rework & Circuit Breaker

### 16.1 Rework Detection

Rework is detected when starting a pipeline where either:
1. The most recent same-type pipeline has FAIL status (direct rework), OR
2. The most recent same-type pipeline has PASS status but a downstream pipeline has FAIL status (downstream-triggered rework)

```
samePipelines = wp.pipelines.filter(p => p.type == pipelineType)
isDirectRework = samePipelines is not empty AND samePipelines.last().status == "FAIL"
isDownstreamRework = not isDirectRework AND hasDownstreamFail(wp.pipelines, pipelineType)
needsRework = isDirectRework OR isDownstreamRework
```

### 16.2 Rework Counts (Per-Pipeline)

- Field: `rework_counts` on WorkPackageDetail (map of PipelineType → integer)
- Initial value: absent; lazily initialized on first rework. For WPs with `active_pipeline_stages`, the map includes one entry per active stage: e.g., `{ implementation: 0, qa: 0, security-audit: 0, code-review: 0, release-engineering: 0, documentation: 0 }` for a full 6-stage WP, or `{ implementation: 0, qa: 0, code-review: 0, documentation: 0 }` for a default 4-stage WP (see §11.1 for initialization logic)
- Each pipeline type's counter increments independently when starting that pipeline type after a direct or downstream FAIL
- Not incremented when: no previous pipeline, or most recent same-type is PASS with no downstream FAIL

> **Backward compatibility:** If the legacy scalar `rework_count` field is present, treat its value as `rework_counts.implementation` and migrate to the map structure on next write.

### 16.3 Circuit Breaker

```
MAX_REWORK_COUNT = 5

When rework_counts[pipelineType] >= MAX_REWORK_COUNT:
  - startPipeline REJECTS the call for that specific pipeline type
  - getNextAction returns BLOCK_FOR_REWORK_LIMIT
  - Human intervention required: cancel or restructure the WP
```

The circuit breaker is evaluated **per pipeline type**. Reaching the limit on `documentation` does not block `implementation` rework, and vice versa.

### 16.3b Circuit Breaker Reset

When the circuit breaker trips, the only prescribed recovery paths are cancelling or "restructuring" the WP — but restructuring is undefined, and cancellation loses all pipeline history. The following PM-only operation provides a targeted recovery path.

```
function resetReworkCount(wp, root, pipelineType, agentRole, reason):
  // Guard: PM only
  if agentRole != "Project Manager":
    ERROR("Only the Project Manager can reset rework counts")

  // Guard: Reason is required (audit trail)
  if reason is empty:
    ERROR("A reason is required when resetting rework counts")

  counts = wp.rework_counts
  if counts is null OR (counts[pipelineType] ?? 0) == 0:
    return    // Nothing to reset

  previousValue = counts[pipelineType]
  counts[pipelineType] = 0
  wp.rework_counts = counts

  // Record the reset for auditability
  root.project_comments.append({
    type: "rework_reset",
    priority: "high",
    timestamp: now(),
    agent: "Project Manager",
    note: "Reset rework count for {pipelineType} on {wp.work_package_id} "
          + "from {previousValue} to 0. Reason: {reason}"
  })

  root.last_updated = now()
  write wp
  write root
```

> **Use case:** After investigating a root cause (e.g., flaky test environment, misunderstood requirement), the PM resets the counter to allow retries. The mandatory reason and project comment ensure the decision is auditable. The PM should address the root cause before resetting — otherwise the circuit breaker will trip again after `MAX_REWORK_COUNT` additional attempts.

### 16.3c Circuit Breaker Escalation for Automated Orchestrators

The circuit breaker (§16.3) is designed around a human Project Manager who can review `REVIEW_REWORK_LIMIT` recommendations and decide whether to cancel or restructure the affected WP (see §16.3b for the PM reset operation). In **automated (headless) orchestrators** where no interactive PM is available, a circuit-broken WP would block indefinitely — `startPipeline` rejects the call, no human can reset the counter, and the project can never reach synthesis because `pending_work_packages > 0`.

**Prescribed behavior for automated orchestrators:**

When `getNextAction` returns a `REVIEW_REWORK_LIMIT` recommendation for a WP and no PM intervention is available (the system is running headlessly), the orchestrator SHOULD:

1. **Log the circuit-breaker event** — Record the WP ID, the circuit-broken pipeline type, the rework count, and a diagnostic note explaining that the circuit breaker was reached. This ensures the operator has visibility into which WPs were affected and why.
2. **Transition the WP to CANCELLED** — Call `updateWorkPackageStatus(CANCELLED)` on the circuit-broken WP. This is a PM-level operation; automated orchestrators acting as PM surrogates must invoke it with `agent_role: "Project Manager"`. Cancellation is terminal (§21.1) — the WP's pipeline history is preserved for post-run analysis, and `synthesis_generated` is not reset (§21.38).
3. **Allow the project to proceed to synthesis** — Once all remaining WPs are terminal (COMPLETE or CANCELLED), `completeSynthesis` (§19.1) can proceed. The Synthesis agent's final report SHOULD document cancelled WPs and the reason for cancellation.

> **Rationale:** The circuit breaker threshold (`MAX_REWORK_COUNT = 5`) represents a systemic failure — 5 rework cycles without resolution indicates either a persistent bug, a fundamentally flawed requirement, or an environmental issue. In a headless run, the correct recovery is to preserve the evidence (cancel rather than delete), proceed with the deliverable WPs, and document the failure in the synthesis report. This is preferable to leaving the project stuck indefinitely, which produces no output and obscures the partial progress made on other WPs.

> **PM reset as alternative:** If the automated system has access to an emergency PM intervention path (e.g., a human-triggered override webhook), the PM MAY reset the rework count via `ledger_reset_rework_count` (§16.3b) and let the orchestrator retry. This is preferable to cancellation when the root cause has been identified and fixed (e.g., a flaky test environment was repaired). Cancellation should be the default when no such path exists.

> **Halted WPs and synthesis:** Some orchestrators implement a local circuit breaker (e.g., 3 consecutive failures → "halted" state) that prevents further invocation of the agent for that WP within the current run, even though the WP remains `IN_PROGRESS` in the ledger. Such halted WPs must be transitioned to `CANCELLED` before `completeSynthesis` is called, because the synthesis guard requires `pending_work_packages == 0` — a halted `IN_PROGRESS` WP still counts as pending.

**Related sections:** [§16.3b](#163b-circuit-breaker-reset) (PM rework count reset), [§21.68](edge-cases.md#2168-orphaned-pipeline-recovery-agent-crash-between-begin_work-and-complete_pipeline) (orphaned pipeline recovery), [§19.1](auxiliary-systems.md#191-algorithm) (`completeSynthesis` pending guard)

### 16.4 Rework Flow

The canonical 6-stage pipeline. Stages not in a WP's `active_pipeline_stages` are skipped via `resolveNextAgent` (§9.2).

```
                    ┌───────────┐
                    │ Developer │
                    │implements │
                    └─────┬─────┘
                          │
                    ┌─────▼─────┐
                    │  QA runs  │
                    │  tests    │
                    └─────┬─────┘
                          │
                   ┌──────┴──────┐
                 PASS           FAIL ──► Developer fixes
                   │                    (rework_counts.implementation++)
            ┌──────▼──────────┐
            │[Security Audit] │  ◄── optional; skipped if not in active stages
            └──────┬──────────┘
                   │
            ┌──────┴──────┐
          PASS           FAIL ──► Developer fixes
            │                    (rework_counts.implementation++)
            │
            ┌──────▼──────┐
            │  Reviewer   │
            │  reviews    │
            └──────┬──────┘
                   │
            ┌──────┴──────┐
          PASS           FAIL ──► Developer fixes
            │                    (rework_counts.implementation++)
            │
     ┌──────▼─────────────────┐
     │[Release Engineering]   │  ◄── optional; skipped if not in active stages
     └──────┬─────────────────┘
            │
         ┌──┴──┐
       PASS   FAIL ──► Release Engineer self-reworks
         │            (rework_counts.release-engineering++)
         │
     ┌───▼──────────┐
     │Documentation │
     │  writes      │
     └──────┬───────┘
            │
         ┌──┴──┐
       PASS   FAIL ──► Documentation self-reworks
         │            (rework_counts.documentation++)
         │
      COMPLETE → Synthesis (after all WPs complete)
```

> **FAIL routing summary:** QA, Security Audit, and Code Review FAILs route to Developer (`rework_counts.implementation++`). Release Engineering and Documentation FAILs route to self-rework (`rework_counts.release-engineering++` and `rework_counts.documentation++` respectively). Each rework budget is independent — reaching the circuit breaker limit on one pipeline type does not block other pipeline types (§16.3).
>
> **Stage skipping:** When a stage is not in a WP's `active_pipeline_stages`, the corresponding box in the diagram is skipped entirely — PASS from the preceding stage flows directly to the next active stage via `resolveNextAgent` (§9.2).
