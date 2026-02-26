# Operations

> Part of the [Agent Workflow Specification](README.md).

---

## 10. Work Package Claiming

Claiming transitions a WP from READY to IN_PROGRESS and assigns an agent.

### 10.1 Algorithm

```
function claimWorkPackage(wp, root, agentName, overrideFlag):
  // Guard: WP assignment check
  if wp.assigned_to is set AND wp.assigned_to != agentName:
    if overrideFlag is false:
      ERROR("Cannot claim: assigned to {wp.assigned_to}, not {agentName}")
    
    if overrideFlag is true:
      if agentName != "Project Manager":
        ERROR("override restricted to Project Manager")
  
  // Guard: Status must be READY
  if wp.status != "READY":
    ERROR("Cannot claim: status is {wp.status}, expected READY")
  
  // Guard: Dependencies must be met
  result = canStartWorkPackage(wp, root.work_packages)
  if not result.allowed:
    ERROR(result.reason)
  
  // Validate transition
  if not isValidStatusTransition("READY", "IN_PROGRESS"):
    ERROR("Invalid transition")
  
  // Apply changes
  wp.status = "IN_PROGRESS"
  wp.assigned_to = agentName
  root.work_packages[wp.id].status = "IN_PROGRESS"
  root.work_packages[wp.id].assigned_to = agentName
  root.last_updated = now()
```

### 10.2 Override Rules

The override flag is only relevant when `wp.assigned_to` is set to a *different* agent than the caller. In that case:

| Caller | Override Allowed? |
|--------|------------------|
| Project Manager | Yes |
| Any other agent (including current assignee — but the outer guard already passed for current assignee) | No — hard rejection |

---

## 11. Starting a Pipeline

### 11.1 Algorithm

```
function startPipeline(wp, root, pipelineType, agentRole):
  // Guard: WP must be IN_PROGRESS
  if wp.status != "IN_PROGRESS":
    ERROR("WP status must be IN_PROGRESS")
  
  // Guard: No duplicate IN_PROGRESS pipeline of same type  
  if hasDuplicateInProgress(wp, pipelineType):
    ERROR("Duplicate in-progress pipeline")
  
  // Guard: Prerequisites must be met
  prerequisite = PIPELINE_PREREQUISITES[pipelineType]
  if prerequisite is not null:
    prereqPipelines = wp.pipelines.filter(p => p.type == prerequisite)
    if prereqPipelines is empty OR prereqPipelines.last().status != "PASS":
      ERROR("Requires PASS {prerequisite} pipeline first")
  
  // Guard: Re-validation after upstream rework (prevents skipping stages)
  // If a downstream pipeline previously FAILed, verify the prerequisite
  // PASSed AFTER the most recent pipeline of the current type completed.
  samePipelines = wp.pipelines.filter(p => p.type == pipelineType)
  if prerequisite is not null:
    prereqPass = prereqPipelines.last()   // Already confirmed PASS above
    if samePipelines is not empty:
      lastSame = samePipelines.last()
      if prereqPass.completed_at is not null
         AND lastSame.completed_at is not null
         AND prereqPass.completed_at < lastSame.completed_at:
        // Prerequisite passed BEFORE the current pipeline type last ran
        // (regardless of whether lastSame is PASS or FAIL).
        // Check for a FAIL at or downstream of the prerequisite — this includes
        // the current pipeline type itself, since it is downstream of its own
        // prerequisite. Using `prerequisite` (not `pipelineType`) is intentional:
        // getDownstreamTypes(prerequisite) includes the current type, so a FAIL
        // of the current type (e.g., review-1 FAIL) is correctly detected.
        if hasDownstreamFail(wp.pipelines, prerequisite):
          ERROR("Prerequisite {prerequisite} must re-PASS after upstream rework. "
                + "Most recent {prerequisite} PASS predates the last {pipelineType} run.")
  
  // Guard: Agent role validation
  expectedRole = PIPELINE_AGENT_MAP[pipelineType]
  if agentRole is not provided:
    ERROR("agentRole is required")
  if agentRole != expectedRole:
    if agentRole == "Project Manager":
      // PM override: allowed (e.g., restarting a pipeline on behalf of absent agent)
      log info: "PM override: {agentRole} starting {pipelineType} pipeline "
                + "(normally owned by {expectedRole})"
    else:
      ERROR("Agent role {agentRole} cannot start {pipelineType} pipeline "
            + "(owned by {expectedRole})")
  
  // Rework detection: Check if retrying after FAIL (same-type or downstream)
  // (samePipelines already computed above in re-validation guard)
  isDirectRework = samePipelines is not empty AND samePipelines.last().status == "FAIL"
  isDownstreamRework = not isDirectRework AND hasDownstreamFail(wp.pipelines, pipelineType)
  
  if isDirectRework OR isDownstreamRework:
    counts = wp.rework_counts ?? { implementation: 0, qa: 0, code-review: 0, documentation: 0 }
    counts[pipelineType] = (counts[pipelineType] ?? 0) + 1
    wp.rework_counts = counts
    
    // Circuit breaker (per-pipeline-type threshold)
    if counts[pipelineType] >= MAX_REWORK_COUNT:   // default: 5
      ERROR("Rework limit reached for {pipelineType}. Cancel or restructure this WP.")
  
  // Create pipeline
  newPipeline = Pipeline {
    type: pipelineType,
    status: "IN_PROGRESS",
    started_at: now(),
    summary: []
  }
  wp.pipelines.append(newPipeline)
  
  // Auto-update assigned agent
  wp.assigned_to = PIPELINE_AGENT_MAP[pipelineType]
  root.work_packages[wp.id].assigned_to = wp.assigned_to
  root.last_updated = now()
```

### 11.1.1 Re-Validation Guard

The re-validation guard (added after the prerequisite check) prevents a subtle stage-skipping scenario during rework:

1. impl-1 PASS → qa-1 PASS → review-1 **FAIL**
2. Developer reworks: impl-2 **PASS**
3. Without the guard, `startPipeline(type=code-review)` would succeed — qa-1 is PASS
4. But qa-1 validated impl-1, not impl-2. QA has been **bypassed**.

The guard detects that the prerequisite (QA) PASSed *before* the last run of the current pipeline type (code-review, which FAILed as review-1), and that a downstream FAIL exists for `code-review` itself (review-1 FAIL), requiring QA to re-PASS first.

> **Note on the `lastSame.status` check:** The guard intentionally does **not** restrict on `lastSame.status == "PASS"`. When `lastSame` is FAIL (as in review-1 above), the prerequisite temporal check is equally critical — the stale PASS of the prerequisite (qa-1) must not be accepted just because the current pipeline type previously FAILed.

> **Interaction with recommendation engine:** The `hasNewUpstreamPassSince` function (§14.6) advises agents to re-engage after upstream rework. The re-validation guard is the **hard enforcement** counterpart — it prevents direct tool calls from bypassing the recommended flow.

### 11.1.2 Agent Role Validation

The `agentRole` parameter is mandatory. The agent must match the pipeline owner defined in `PIPELINE_AGENT_MAP` (§9.1), with one exception:

- **PM override:** The Project Manager may start any pipeline type to handle operational scenarios (e.g., restarting a stale pipeline on behalf of an absent agent). A log entry is emitted for auditability.

### 11.2 Rework Count Semantics

| Most Recent Pipeline of Same Type | Downstream State | `rework_counts[pipelineType]` Change |
|-----------------------------------|------------------|--------------------------------------|
| None (first pipeline) | N/A | No change |
| PASS | No downstream FAIL | No change |
| PASS | Downstream FAIL exists | Increment by 1 |
| FAIL | N/A | Increment by 1 |
| IN_PROGRESS | N/A | Cannot start (duplicate guard) |

The `rework_counts` map is absent (`null`/`undefined`) until the first rework on any pipeline type. It is initialized with all-zero entries on first coalesce, then the specific pipeline type's counter is incremented.

> **Per-pipeline isolation:** Documentation self-rework cycles (Documentation FAIL → Documentation re-runs) increment only `rework_counts.documentation`, not `rework_counts.implementation`. This prevents trivial documentation fixes from exhausting the implementation rework budget. Conversely, repeated QA/Review failures that trigger Developer rework increment `rework_counts.implementation` via downstream-fail detection.

> **Parallel counter increments during rework chains:** In a typical QA-fail rework cycle, *both* `rework_counts.implementation` and `rework_counts.qa` increment: the Developer restarts implementation (downstream QA FAIL detected → `implementation++`), and QA restarts qa (direct rework of previous FAIL → `qa++`). After 5 such cycles, both counters reach the circuit breaker limit simultaneously. This is by design — each counter tracks how many times *that specific pipeline type* has been retried, regardless of the root cause. The circuit breaker engages on whichever pipeline type reaches the limit first.

### 11.3 Downstream Fail Detection

```
function hasDownstreamFail(pipelines, pipelineType):
  // Get the ordered list of downstream pipeline types
  downstreamTypes = getDownstreamTypes(pipelineType)
  // e.g., for "implementation": ["qa", "code-review", "documentation"]
  
  for each dsType in downstreamTypes:
    dsPipelines = pipelines.filter(p => p.type == dsType)
    if dsPipelines is not empty AND dsPipelines.last().status == "FAIL":
      return true
  
  return false
```

This ensures the circuit breaker engages for the common pattern: QA/review fails → Developer restarts implementation.

---

## 12. Completing a Pipeline

### 12.1 Algorithm

```
function completePipeline(wp, root, pipelineType, status, summary, opts):
  // Find the most recent IN_PROGRESS pipeline of the given type
  pipeline = wp.pipelines
    .filter(p => p.type == pipelineType AND p.status == "IN_PROGRESS")
    .last()
  
  if pipeline is null:
    ERROR("No in-progress {pipelineType} pipeline found")
  
  // Update pipeline
  pipeline.status = status       // "PASS" or "FAIL"
  pipeline.completed_at = now()
  pipeline.summary = summary
  pipeline.artifacts = opts.artifacts       // optional
  pipeline.metrics = opts.metrics           // optional
  pipeline.comments = opts.comments         // optional
  
  // Acceptance criteria updates (merge semantics)
  if opts.acceptance_criteria_updates is provided:
    for each update in opts.acceptance_criteria_updates:
      existing = wp.acceptance_criteria.find(ac => ac.criterion == update.criterion)
      if existing:
        existing.met = update.met           // Update existing
      else:
        wp.acceptance_criteria.append({     // Append new
          criterion: update.criterion,
          met: update.met
        })
  
  // Handoff notes
  if opts.handoff_notes is provided:
    fromAgent = PIPELINE_AGENT_MAP[pipelineType]
    if status == "PASS":
      toAgent = NEXT_AGENT_MAP[pipelineType]
    else:  // FAIL
      toAgent = FAIL_ROUTING_MAP[pipelineType]
    
    handoffNote = HandoffNote {
      from_agent: fromAgent,
      to_agent: toAgent,
      timestamp: now(),
      notes: opts.handoff_notes
    }
    wp.handoff_notes = (wp.handoff_notes ?? []).append(handoffNote)
  
  root.last_updated = now()
```

### 12.2 Handoff Note Routing Summary

```
On PASS:
  implementation → QA
  qa             → Reviewer
  code-review    → Documentation
  documentation  → Synthesis

On FAIL:
  implementation → Developer (self-rework)
  qa             → Developer
  code-review    → Developer
  documentation  → Documentation (self-rework)
```

### 12.3 Acceptance Criteria Merge Semantics

- Match by **exact** criterion text
- Found → update the `met` flag
- Not found → **append** as a new entry `{ criterion, met }`
