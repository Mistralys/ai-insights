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
- Initial value: absent; lazily created as `{ implementation: 0, qa: 0, code-review: 0, documentation: 0 }` on first rework
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

### 16.4 Rework Flow

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
                   │             │
                 PASS          FAIL
                   │             │
            ┌──────▼──────┐   ┌─▼──────────────┐
            │  Reviewer   │   │ Developer fixes │
            │  reviews    │   │(rework_counts   │
            └──────┬──────┘   │.implementation++)│
                   │          └────────┬─────────┘
                   │                   │
            ┌──────┴──────┐     ┌──────▼──────┐
           PASS          FAIL   │  QA re-runs │
            │             │     │  tests      │
     ┌──────▼──────┐    ┌─▼───────────────┐  └─────────────┘
     │Documentation│    │ Developer fixes  │
     │  writes     │    │(rework_counts    │
     └──────┬──────┘    │.implementation++)│
                        └─────────────────┘
            │
         PASS → Synthesis (after all WPs complete)
```

> **Note:** `rework_counts.implementation` increments on every Developer rework cycle, regardless of whether the FAIL originated from the implementation pipeline itself or from a downstream pipeline (QA, review). This ensures the circuit breaker ([§16.3](#163-circuit-breaker)) engages for repeated downstream failures, not just direct implementation failures. Documentation self-rework cycles only increment `rework_counts.documentation`, keeping the two rework budgets independent.
