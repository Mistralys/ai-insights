# Operations

> Part of the [Agent Workflow Specification](README.md).

---

## 9b. Work Package Creation

Creating a WP initializes it from plan data and adds it to the project ledger. This section consolidates guards and behaviors that are defined individually in §3.6, §15.1, §15.2, §21.3, §21.50, and §21.51.

### 9b.1 Algorithm

```
function createWorkPackage(root, wpData, agentRole):
  acquire lock

  // --- WP ID generation (§3.6) ---
  existingIds = root.work_packages.map(wp => parseNumericSuffix(wp.work_package_id))
  nextNum = (max(existingIds) ?? 0) + 1
  wpId = "WP-" + zeroPad(nextNum, 3)    // e.g., "WP-001", "WP-012"

  // --- Acceptance criteria validation (§21.3) ---
  if wpData.acceptance_criteria is empty:
    ERROR("At least one acceptance criterion is required")
  for each ac in wpData.acceptance_criteria:
    if ac.criterion is empty or whitespace-only:
      ERROR("Acceptance criterion text must be non-empty")

  // --- Dependency validation (§15.2) ---
  for each depId in wpData.dependencies:
    if not root.work_packages.any(wp => wp.work_package_id == depId):
      ERROR("Dependency {depId} not found in project")

  // --- Cycle detection (§15.2) ---
  if hasCycle(wpId, wpData.dependencies, root.work_packages):
    ERROR("Adding dependencies would create a circular dependency")

  // --- Initial status determination (§15.1) ---
  unresolvedDeps = wpData.dependencies.filter(depId =>
    dep = root.work_packages.find(wp => wp.work_package_id == depId)
    return NOT isTerminalStatus(dep.status)
  )

  if unresolvedDeps is empty:
    initialStatus = "READY"
    blockedBy = null
  else:
    initialStatus = "BLOCKED"
    blockedBy = {
      type: "dependency",
      description: "Depends on " + unresolvedDeps.join(", "),
      blocking_work_package: unresolvedDeps[0]
    }

  // --- Synthesis invalidation on COMPLETE project (§21.51) ---
  if root.status == "COMPLETE" OR root.synthesis_generated == true:
    root.synthesis_generated = false

  // --- Create WP detail file ---
  wpDetail = WorkPackageDetail {
    work_package_id: wpId,
    work_package_file: "{storageDir}/{wpId}.json",
    status: initialStatus,
    assigned_to: null,
    dependencies: wpData.dependencies,
    blocked_by: blockedBy,
    acceptance_criteria: wpData.acceptance_criteria,
    revision: 0,
    active_pipeline_stages: wpData.active_pipeline_stages ?? null,  // See §9b.2
    pipelines: []
  }

  // --- Soft guardrail warnings (§9b.2) ---
  warnings = validateActiveStages(wpData.active_pipeline_stages)
  for each warning in warnings:
    root.project_comments.append(ProjectComment {
      type: "warning",
      priority: "low",
      timestamp: now(),
      agent: agentRole ?? "system",
      note: warning
    })

  // --- Update root index ---
  root.work_packages.append(WorkPackageSummary {
    work_package_id: wpId,
    status: initialStatus,
    assigned_to: null,
    dependencies: wpData.dependencies,
    active_pipeline_stages: wpData.active_pipeline_stages ?? null,
    file: wpDetail.work_package_file
  })
  root.total_work_packages = root.work_packages.length
  root.pending_work_packages = count(wp in root.work_packages where NOT isTerminalStatus(wp.status))
  root.last_updated = now()

  write wpDetail
  write root
  release lock
  return wpDetail
```

> **No agent guard (§21.50):** Unlike `claimWorkPackage` (§10.1) and `startPipeline` (§11.1), WP creation does not enforce an agent role guard. In practice only the PM creates WPs; implementations that require stricter control MAY add a guard.

### 9b.2 Active Pipeline Stages Validation

When `active_pipeline_stages` is provided during WP creation, validation enforces structural correctness with **hard rejects** and emits **soft guardrail warnings** for unusual compositions. The PM retains full authority to compose any valid subsequence.

#### Hard Rejects (block creation)

1. **All entries must be valid `PipelineType` values** — reject unknown pipeline type strings
2. **List must be a subsequence of `CANONICAL_PIPELINE_ORDERING`** — the stages must appear in the same relative order as the canonical ordering. Reordering is never permitted.
3. **No duplicates** — each pipeline type may appear at most once
4. **Non-empty** — at least one stage must be included

#### Soft Guardrails (emit warning project comments, do not block creation)

5. **Implementation without QA** — if `implementation` is present but `qa` is absent, warn: `"WP has implementation without QA — consider adding qa for quality assurance"`
6. **Single-stage chain** — if exactly one stage is provided, warn: `"WP has a single-stage pipeline ({stage}) — verify this is intentional"`
7. **Non-default composition** — if the provided list differs from `DEFAULT_PIPELINE_STAGES` and is not the full 6-stage list, warn: `"WP uses a custom pipeline composition: [{stages}] — ensure this matches the work package's intent"`

When `active_pipeline_stages` is omitted or `null`, it defaults to `DEFAULT_PIPELINE_STAGES` at read time (not stored as an explicit value). This ensures full backward compatibility with existing ledger files created before this field existed.

```
function validateActiveStages(stages):
  warnings = []
  
  if stages is null:
    return warnings    // null/absent is valid — uses default

  // Rule 1: Valid types
  for each stage in stages:
    if stage not in CANONICAL_PIPELINE_ORDERING:
      ERROR("Unknown pipeline type: {stage}")

  // Rule 2: Subsequence of canonical ordering
  lastIndex = -1
  for each stage in stages:
    index = CANONICAL_PIPELINE_ORDERING.indexOf(stage)
    if index <= lastIndex:
      ERROR("Active stages must follow canonical ordering")
    lastIndex = index

  // Rule 3: No duplicates
  if stages.length != unique(stages).length:
    ERROR("Duplicate pipeline type in active_pipeline_stages")

  // Rule 4: Non-empty
  if stages.length == 0:
    ERROR("active_pipeline_stages must contain at least one stage")

  // Soft guardrail 5: Implementation without QA
  if "implementation" in stages AND "qa" not in stages:
    warnings.append("WP has implementation without QA — consider adding qa for quality assurance")

  // Soft guardrail 6: Single-stage chain
  if stages.length == 1:
    warnings.append("WP has a single-stage pipeline ({stages[0]}) — verify this is intentional")

  // Soft guardrail 7: Non-default composition
  if stages != DEFAULT_PIPELINE_STAGES AND stages != CANONICAL_PIPELINE_ORDERING:
    warnings.append("WP uses a custom pipeline composition: [{stages}] — ensure this matches the work package's intent")

  return warnings
```

> **Removed constraint:** The former Rule 2 ("All mandatory stages must be included") is retired. All six stages are now PM-composable — the PM selects any valid subsequence. See [§4.2](data-model.md#42-pipeline-stage-constants) for the rationale and common composition patterns.

### 9b.3 Artifact Declaration Expectation

Implementation agents **must** declare all files modified during a pipeline in `artifacts.files_modified` when completing a pipeline. This includes ancillary changes, minor out-of-scope improvements, and any file touched by the work — not just the primary deliverables.

**Enforcement:** This is a process rule, not a hard validation gate.

- `completePipeline` emits a **soft warning** (project comment, `type: "warning"`, `priority: "low"`) when a PASS pipeline has `artifacts.files_modified` empty or absent (see implementation in §12.1).
- Agent personas explicitly instruct agents to declare all modified files before calling `completePipeline`.
- The soft warning does **not** block the pipeline from completing — it serves as a traceability nudge.

**Legitimate empty-artifact scenarios:** Verification-only or documentation-audit pipelines that make no file changes may naturally have an empty `files_modified`. These will receive the soft warning but are not defects.

**Rationale:** Complete artifact declarations enable accurate audit trails, support diff review, and allow future tooling to compute cumulative change sets. Partial or missing declarations impede these capabilities without preventing pipeline progress.

---

## 10. Work Package Claiming

Claiming transitions a WP from READY to IN_PROGRESS and assigns an agent.

### 10.1 Algorithm

```
function claimWorkPackage(wp, root, agentName, overrideFlag):
  // Guard: Status must be READY (checked first for clearer error messages)
  if wp.status != "READY":
    ERROR("Cannot claim: status is {wp.status}, expected READY")
  
  // Guard: Only pipeline-owning agents or PM can claim (see §21.49)
  // CLAIMABLE_ROLES is derived programmatically: AGENT_ROLES minus ORCHESTRATING_ROLES
  // (i.e. excludes 'Planner' and 'Synthesis'), including both bare names and 'X Agent' variants.
  // Derivation rule defined here (§10.1). Implementation: CLAIMABLE_ROLES export in src/tools/work-package.ts.
  CLAIMABLE_ROLES = AGENT_ROLES.filter(r => r not in ORCHESTRATING_ROLES)
                  + [r + " Agent" for r in AGENT_ROLES if r not in ORCHESTRATING_ROLES]
  if agentName not in CLAIMABLE_ROLES:
    ERROR("Agent role {agentName} cannot claim work packages. "
          + "Only pipeline-owning agents and Project Manager may claim.")
  
  // Guard: WP assignment check
  if wp.assigned_to is set AND wp.assigned_to != agentName:
    if overrideFlag is false:
      ERROR("Cannot claim: assigned to {wp.assigned_to}, not {agentName}")
    
    if overrideFlag is true:
      if agentName != "Project Manager":
        ERROR("override restricted to Project Manager")
  
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
  wp.status_changed_at = now()      // Track for REVIEW_ABANDONED grace period (§14.12)
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

> **Design principle — point-in-time dependency validation:** Dependency checks (`canStartWorkPackage`) are enforced at claim time (§10.1) only. Once a WP is IN_PROGRESS, `startPipeline` (§11.1) does **not** re-check dependencies. If a dependency is reopened (COMPLETE → IN_PROGRESS) after a dependent WP has already been claimed, the cascade reblock mechanism (§15.5) is the sole line of defense for direct dependents, and transitive dependents are not reblocked at all (§21.42). This is a conscious trade-off: continuous dependency validation would add complexity and performance cost to every pipeline operation, whereas the cascade reblock mechanism handles the common case (direct dependents). The recommendation engine’s `hasNewUpstreamPassSince` (§14.6) provides soft enforcement for the remaining cases.

---

## 10b. Updating Work Package Status

The core status-transition operation for work packages. All WP status changes — except `READY → IN_PROGRESS`, handled exclusively by `claimWorkPackage` ([§10.1](#101-algorithm)) — flow through this function. It consolidates the transition guards ([§6.2](state-machines.md#62-transition-table)), agent guards ([§6.5](state-machines.md#65-agent-guards)), counter updates ([§6.4](state-machines.md#64-counter-updates-on-transitions)), and post-transition side effects that are specified individually throughout the document.

### 10b.1 Algorithm

```
function updateWorkPackageStatus(wp, root, targetStatus, agentRole, opts):
  acquire lock
  currentStatus = wp.status

  // --- Reject transitions from CANCELLED (§21.32) ---
  if currentStatus == "CANCELLED":
    ERROR("CANCELLED is terminal — no transitions allowed (including self-transitions)")

  // --- Same-state transitions ---
  if currentStatus == targetStatus:
    if currentStatus == "BLOCKED":
      goto BLOCKED_HANDLING    // Substantive: replace blocked_by (§6.2, §21.17)
    if currentStatus == "COMPLETE":
      terminalAgent = PIPELINE_AGENT_MAP[lastActiveStage(wp)]  // §6.2.1
      if agentRole not in [terminalAgent, "Project Manager"]:
        ERROR("COMPLETE → COMPLETE requires {terminalAgent} or PM")
      release lock
      return    // Agent check only — no data modification (§6.2 same-state note)
    release lock
    return      // All other same-state: pure no-op

  // --- Validate transition exists in §6.2 table ---
  if not isValidTransition(currentStatus, targetStatus):
    ERROR("Invalid transition: {currentStatus} → {targetStatus}")

  // --- Agent guards (§6.5) ---
  validateAgentGuard(currentStatus, targetStatus, agentRole, wp.assigned_to, wp)

  // --- Transition-specific guards and side effects ---

  if targetStatus == "COMPLETE":
    // Full completion guards (§6.2, §21.10)
    if not wp.acceptance_criteria.every(ac => ac.met == true):
      ERROR("Not all acceptance criteria are met")
    lastStage = lastActiveStage(wp)                    // §6.2.1
    lastStagePipelines = wp.pipelines.filter(p => p.type == lastStage)
    if lastStagePipelines is empty OR lastStagePipelines.last().status != "PASS":
      ERROR("Most recent {lastStage} pipeline must be PASS")
    // Freshness check (§21.10)
    firstStage = firstActiveStage(wp)                  // §6.2.1
    if firstStage != lastStage:                        // Single-stage: vacuous pass
      firstStagePipelines = wp.pipelines.filter(p => p.type == firstStage)
      if firstStagePipelines is not empty:
        if lastStagePipelines.last().completed_at < firstStagePipelines.last().started_at:
          ERROR("{lastStage} PASS predates most recent {firstStage} start (freshness)")
    // NOTE: This comparison is intentionally asymmetric — it compares the
    // last-active-stage pipeline's completed_at against the first-active-stage
    // pipeline's started_at (not completed_at). A terminal-stage PASS that
    // occurs after a first-stage pipeline starts but before it completes would
    // satisfy this check, even though the terminal stage validated pre-rework
    // output. In practice, the pipeline ordering prerequisites (§8.1) prevent
    // this race: a later-stage pipeline cannot start without a PASS from its
    // prerequisite, which chains back to the first active stage. A new
    // first-stage pipeline invalidates the prerequisite chain, so no new
    // terminal-stage pipeline can start until the full chain re-PASSes.
    // the full chain re-PASSes. The asymmetry only matters if an existing
    // IN_PROGRESS documentation pipeline overlaps with a new implementation
    // pipeline — a scenario that requires two agents acting on the same WP
    // simultaneously outside the recommended flow.
    // Guard: No IN_PROGRESS pipelines allowed on COMPLETE
    if wp.pipelines.any(p => p.status == "IN_PROGRESS"):
      ERROR("Cannot mark COMPLETE: IN_PROGRESS pipelines exist on this WP")

  if targetStatus == "BLOCKED":
    BLOCKED_HANDLING:
    if opts.blocked_by is null:
      ERROR("Transition to BLOCKED requires a blocked_by object (§21.11)")
    if currentStatus == "BLOCKED":
      // Same-state: agent guard + replacement rule (§21.47, §6.2)
      if agentRole not in ["Project Manager"] AND agentRole != wp.assigned_to:
        ERROR("BLOCKED → BLOCKED requires PM or current assignee")
      if wp.blocked_by?.type == "dependency" AND opts.blocked_by.type != "dependency":
        if agentRole != "Project Manager":
          ERROR("Only PM can overwrite dependency blocker with non-dependency type")
    if currentStatus == "IN_PROGRESS":
      // Auto-cancel IN_PROGRESS pipelines (§21.14b, §21.27)
      for each pipeline in wp.pipelines where pipeline.status == "IN_PROGRESS":
        pipeline.status = "FAIL"
        pipeline.completed_at = now()
        pipeline.summary = ["Auto-cancelled: WP transitioned to BLOCKED"]
        pipeline.auto_cancelled = true
    wp.blocked_by = opts.blocked_by    // assigned_to preserved (not cleared)

  if targetStatus == "CANCELLED" AND currentStatus == "IN_PROGRESS":
    // Auto-cancel IN_PROGRESS pipelines (§21.14b)
    for each pipeline in wp.pipelines where pipeline.status == "IN_PROGRESS":
      pipeline.status = "FAIL"
      pipeline.completed_at = now()
      pipeline.summary = ["Auto-cancelled: WP cancelled"]
      pipeline.auto_cancelled = true

  if currentStatus == "IN_PROGRESS" AND targetStatus == "READY":
    // Unclaim (§21.13)
    if wp.pipelines.any(p => p.status == "IN_PROGRESS"):
      ERROR("Cannot unclaim: IN_PROGRESS pipelines exist on this WP")
    wp.assigned_to = null
    root.work_packages[wp.id].assigned_to = null

  if currentStatus == "BLOCKED" AND targetStatus in ["IN_PROGRESS", "READY"]:
    // Clear blocker (§21.12)
    wp.blocked_by = null

  if currentStatus == "COMPLETE" AND targetStatus == "IN_PROGRESS":
    // Reopen side effects (§6.2, §21.4, §21.26, §21.44)
    wp.revision = (wp.revision ?? 0) + 1
    wp.rework_counts = null           // Reset rework budget (§21.44)
    root.synthesis_generated = false  // Invalidate synthesis (§21.26)

  // --- Counter updates (§6.4) ---
  if NOT isTerminalStatus(currentStatus) AND isTerminalStatus(targetStatus):
    root.pending_work_packages -= 1
  if currentStatus == "COMPLETE" AND targetStatus == "IN_PROGRESS":
    root.pending_work_packages += 1
  // COMPLETE → CANCELLED: no counter change (terminal → terminal)

  // --- Apply status ---
  wp.status = targetStatus
  wp.status_changed_at = now()     // Track for REVIEW_ABANDONED grace period (§14.12)
  root.work_packages[wp.id].status = targetStatus
  root.last_updated = now()

  write wp
  write root
  release lock

  // --- Post-transition hooks (outside main lock — see §20.4) ---
  if isTerminalStatus(targetStatus) AND NOT isTerminalStatus(currentStatus):
    propagateDependencyUnblock(projectPath, wp.work_package_id)    // §15.4
  if currentStatus == "COMPLETE" AND targetStatus == "IN_PROGRESS":
    propagateDependencyReblock(projectPath, wp.work_package_id)    // §15.5
```

### 10b.2 Agent Guard Helper

```
function validateAgentGuard(from, to, agentRole, assignedTo, wp):
  PM = "Project Manager"
  terminalAgent = PIPELINE_AGENT_MAP[lastActiveStage(wp)]  // §6.2.1

  if to == "COMPLETE":
    if agentRole not in [terminalAgent, PM]:
      ERROR("Only {terminalAgent} (or PM) can mark COMPLETE")
  else if to == "CANCELLED":
    if agentRole != PM:
      ERROR("Only Project Manager can cancel a WP")
  else if from == "BLOCKED" AND to == "IN_PROGRESS":
    if agentRole not in [PM, "system"] AND agentRole != assignedTo:
      ERROR("BLOCKED → IN_PROGRESS requires PM, assignee, or system")
  else if from == "BLOCKED" AND to == "READY":
    if agentRole != "system":
      ERROR("BLOCKED → READY is system-only (auto-unblock via §15.4)")
  else if from == "IN_PROGRESS" AND to == "READY":
    if agentRole != PM AND agentRole != assignedTo:
      ERROR("Unclaim requires PM or current assignee")
  else if from == "COMPLETE" AND to == "IN_PROGRESS":
    if agentRole not in [PM, terminalAgent]:
      ERROR("Reopen requires PM or {terminalAgent}")

  // → BLOCKED: no agent guard (§6.5 design note)
  // READY → IN_PROGRESS: use claimWorkPackage (§10.1), not this function
```

> **Relationship to `claimWorkPackage`:** The `READY → IN_PROGRESS` transition is **not** handled by `updateWorkPackageStatus`. It is handled exclusively by `claimWorkPackage` ([§10.1](#101-algorithm)), which enforces additional guards (assignment check, override flag, dependency validation) specific to the claiming workflow. Implementations that receive a `READY → IN_PROGRESS` request through `updateWorkPackageStatus` SHOULD redirect to `claimWorkPackage` or reject with an error directing the caller to use the claiming operation.

> **Post-transition hooks and lock separation:** `propagateDependencyUnblock` ([§15.4](dependencies-and-rework.md#154-automatic-unblocking-propagatedependencyunblock)) and `propagateDependencyReblock` ([§15.5](dependencies-and-rework.md#155-cascade-reblocking-propagatedependencyreblock)) execute **after** the main lock is released, per the cascade lock separation principle ([§20.4](auxiliary-systems.md#204-cascade-lock-separation)). Both acquire their own locks. The brief inconsistency window is acceptable because both are idempotent (see §20.4 for crash recovery).

> **Centralization rationale:** Prior to this section, status transition side effects were specified individually across [§6.2](state-machines.md#62-transition-table) (guards), [§6.4](state-machines.md#64-counter-updates-on-transitions) (counters), [§6.5](state-machines.md#65-agent-guards) (agent guards), [§15.4](dependencies-and-rework.md#154-automatic-unblocking-propagatedependencyunblock)/[§15.5](dependencies-and-rework.md#155-cascade-reblocking-propagatedependencyreblock) (cascades), and §21.4/§21.12/§21.13/§21.14b/§21.26/§21.44 (edge-case side effects). This algorithm consolidates all into a single implementable function. The original sections remain authoritative for *rationale*; this section provides the consolidation for implementation.

---

## 11. Starting a Pipeline

### 11.1 Algorithm

```
function startPipeline(wp, root, pipelineType, agentRole):
  // Guard: WP must be IN_PROGRESS
  if wp.status != "IN_PROGRESS":
    ERROR("WP status must be IN_PROGRESS")
  
  // Guard: Pipeline type must be in the WP's active stages
  activeStages = wp.active_pipeline_stages ?? DEFAULT_PIPELINE_STAGES
  if pipelineType not in activeStages:
    ERROR("Pipeline type '{pipelineType}' is not active for this work package. "
          + "Active stages: {activeStages}")
  
  // Guard: No duplicate IN_PROGRESS pipeline of same type  
  if hasDuplicateInProgress(wp, pipelineType):
    ERROR("Duplicate in-progress pipeline")
  
  // Guard: Prerequisites must be met (dynamic resolution — §8.1.1)
  prerequisite = resolvePrerequisite(pipelineType, activeStages)
  if prerequisite is not null:
    prereqPipelines = wp.pipelines.filter(p => p.type == prerequisite)
    if prereqPipelines is empty OR prereqPipelines.last().status != "PASS":
      ERROR("Requires PASS {prerequisite} pipeline first")
  
  // Guard: Re-validation after upstream rework (prevents skipping stages)
  // Two-layer check: (1) unconditional upstream rework detection, then
  // (2) temporal consistency for same-type re-runs (self-rework allowance).
  // Use filtered list (excluding auto-cancelled) for temporal baseline,
  // consistent with the §21.27 invariant that auto-cancelled pipelines are
  // excluded from quality-related decisions.
  samePipelines = wp.pipelines.filter(p => p.type == pipelineType)
  effectiveSamePipelines = samePipelines.filter(p => NOT p.auto_cancelled)
  if prerequisite is not null:
    prereqPass = prereqPipelines.last()   // Already confirmed PASS above

    // --- Upstream rework check (applies regardless of prior runs) ---
    // Detects if any pipeline upstream of the current type was started
    // AFTER the prerequisite PASSed — indicating stale prerequisite.
    // This check is decoupled from effectiveSamePipelines so it also
    // catches first-run stage-skipping (e.g., code-review starting for
    // the first time while a new implementation is in progress).
    upstreamTypes = getUpstreamTypes(pipelineType, activeStages)
    hasUpstreamRework = upstreamTypes.any(type =>
      wp.pipelines.any(p => p.type == type
        AND p.started_at > prereqPass.completed_at))
    if hasUpstreamRework:
      ERROR("Prerequisite {prerequisite} must re-PASS after upstream rework. "
            + "An upstream pipeline was started after the most recent "
            + "{prerequisite} PASS.")

    // --- Temporal consistency check (same-type re-runs only) ---
    // When the current pipeline type has been run before, verify the
    // prerequisite PASSed AFTER the most recent effective run. This
    // catches scenarios where the prerequisite is temporally stale
    // relative to prior runs of this type, even without upstream rework
    // (defense-in-depth).
    if effectiveSamePipelines is not empty:
      lastSame = effectiveSamePipelines.last()
      if prereqPass.completed_at is not null
         AND lastSame.completed_at is not null
         AND prereqPass.completed_at < lastSame.completed_at:
        // Prerequisite passed BEFORE the current pipeline type last ran.
        // Since hasUpstreamRework was already checked above, reaching here
        // means no upstream rework occurred — this is a self-rework
        // scenario (e.g., documentation retrying after its own FAIL).
        // Allow the pipeline to start.
        pass    // skip guard — prerequisite still valid for self-rework
  
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
  // (effectiveSamePipelines already computed above in re-validation guard —
  // auto-cancelled pipelines excluded per §21.27)
  isDirectRework = effectiveSamePipelines is not empty AND effectiveSamePipelines.last().status == "FAIL"
  isDownstreamRework = not isDirectRework AND hasDownstreamFail(wp.pipelines, pipelineType, activeStages)
  
  if isDirectRework OR isDownstreamRework:
    counts = wp.rework_counts ?? {}
    // Initialize missing entries to 0 for active stages only
    for each stage in activeStages:
      if counts[stage] is undefined:
        counts[stage] = 0
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

The guard detects that the prerequisite (QA) PASSed *before* any upstream pipeline was started after that PASS — indicating the prerequisite validated stale output and must re-PASS first.

The guard operates in two layers:

1. **Upstream rework check (unconditional):** Regardless of whether the current pipeline type has ever run, the guard checks whether any pipeline *upstream* of the current type (via `getUpstreamTypes` §8.5) was started after the prerequisite PASSed. If so, the prerequisite is stale and must re-PASS. This catches both first-run stage-skipping (e.g., code-review starting for the first time while a new implementation pipeline is in progress) and rework-induced staleness.

2. **Temporal consistency check (same-type re-runs only):** When the current pipeline type has been run before, the guard additionally verifies the prerequisite PASSed *after* the most recent effective run. If the prerequisite is temporally stale but no upstream rework occurred, this is a self-rework scenario (e.g., documentation retrying after its own FAIL) and the guard allows the pipeline to start.

**First-run stage-skipping example (code-review never run):**
1. impl-1 PASS → qa-1 PASS → Developer starts impl-2 (rework)
2. Reviewer calls `startPipeline(type=code-review)` for the first time
3. Prerequisite check: `resolvePrerequisite("code-review")` = `"qa"` → qa-1 is PASS → passes
4. Upstream rework check: `getUpstreamTypes("code-review")` = `[impl, qa]` — impl-2 started after qa-1 PASSed → **upstream rework detected** → guard fires ✓

**Self-rework example (documentation):**
1. impl-1 PASS → qa-1 PASS → review-1 PASS → doc-1 **FAIL**
2. Documentation retries: `startPipeline(type=documentation)`
3. Upstream rework check: `getUpstreamTypes("documentation")` = `[impl, qa, code-review]` — none started after review-1 PASSed → **no upstream rework** → guard does **not** fire ✓

**Stage-skipping example (code-review after upstream rework):**
1. impl-1 PASS → qa-1 PASS → review-1 **FAIL** → impl-2 **PASS**
2. `startPipeline(type=code-review)` attempted
3. Upstream rework check: `getUpstreamTypes("code-review")` = `[impl, qa]` — impl-2 started after qa-1 PASSed → **upstream rework detected** → guard fires ✓

**WP reopen example (all prior pipelines PASS):**
1. All pipelines PASS → WP COMPLETE → Reopen → Developer starts impl-2 PASS
2. Reviewer calls `startPipeline(type=code-review)`
3. Upstream rework check: `getUpstreamTypes("code-review")` = `[impl, qa]` — impl-2 started after qa-1 PASSed → **upstream rework detected** → guard fires ✓

> **Note on the `lastSame.status` check:** The temporal consistency check (layer 2) intentionally does **not** restrict on `lastSame.status == "PASS"`. When `lastSame` is FAIL (as in review-1 above), the prerequisite temporal check is equally critical — the stale PASS of the prerequisite (qa-1) must not be accepted just because the current pipeline type previously FAILed.

> **Interaction with recommendation engine:** The `hasNewUpstreamPassSince` function (§14.6) advises agents to re-engage after upstream rework. The re-validation guard is the **hard enforcement** counterpart — it prevents direct tool calls from bypassing the recommended flow. The guard now covers all scenarios including WP reopens and first-run pipeline starts.

### 11.1.2 Agent Role Validation

The `agentRole` parameter is mandatory. The agent must match the pipeline owner defined in `PIPELINE_AGENT_MAP` (§9.1), with one exception:

- **PM override:** The Project Manager may start any pipeline type to handle operational scenarios (e.g., restarting a stale pipeline on behalf of an absent agent). A log entry is emitted for auditability.

### 11.2 Rework Count Semantics

| Most Recent Pipeline of Same Type | Downstream State | `rework_counts[pipelineType]` Change |
|-----------------------------------|------------------|--------------------------------------|
| None (first pipeline) | N/A | No change |
| PASS | No downstream FAIL | No change |
| PASS | Downstream FAIL exists | Increment by 1 |
| PASS | Downstream IN_PROGRESS (no FAIL) | No change (downstream still validating) |
| FAIL | N/A | Increment by 1 |
| IN_PROGRESS | N/A | Cannot start (duplicate guard) |

The `rework_counts` map is absent (`null`/`undefined`) until the first rework on any pipeline type. It is initialized with all-zero entries on first coalesce, then the specific pipeline type's counter is incremented.

> **Per-pipeline isolation:** Documentation self-rework cycles (Documentation FAIL → Documentation re-runs) increment only `rework_counts.documentation`, not `rework_counts.implementation`. This prevents trivial documentation fixes from exhausting the implementation rework budget. Conversely, repeated QA/Review failures that trigger Developer rework increment `rework_counts.implementation` via downstream-fail detection.

> **Parallel counter increments during rework chains:** In a typical QA-fail rework cycle, *both* `rework_counts.implementation` and `rework_counts.qa` increment: the Developer restarts implementation (downstream QA FAIL detected → `implementation++`), and QA restarts qa (direct rework of previous FAIL → `qa++`). In the simplest case (one implementation attempt per QA failure), both counters increment at the same rate and reach the circuit breaker limit at the same time after 5 cycles. However, if the Developer requires multiple implementation attempts per QA failure, `rework_counts.implementation` will reach the limit before `rework_counts.qa`. This is by design — each counter tracks how many times *that specific pipeline type* has been retried, regardless of the root cause. The circuit breaker engages on whichever pipeline type reaches the limit first.

> **Auto-cancelled pipeline exclusion:** When determining the "most recent pipeline of same type" for rework detection, auto-cancelled pipelines (`auto_cancelled = true`) are filtered out. An auto-cancelled FAIL — from cascade reblock ([§15.5](dependencies-and-rework.md#155-cascade-reblocking-propagatedependencyreblock)) or manual IN_PROGRESS → BLOCKED transition — does not trigger rework count increments. See [§21.27](edge-cases.md#2127-auto-cancelled-pipelines).

### 11.3 Downstream Fail Detection

```
function hasDownstreamFail(pipelines, pipelineType, activeStages?):
  // Get the ordered list of downstream pipeline types (filtered to active stages)
  downstreamTypes = getDownstreamTypes(pipelineType, activeStages)
  // e.g., for "implementation" with default stages: ["qa", "code-review", "documentation"]
  // e.g., for "implementation" with all stages: ["qa", "security-audit", "code-review", "release-engineering", "documentation"]
  
  for each dsType in downstreamTypes:
    // Exclude auto-cancelled pipelines — they represent external interruptions
    // (cascade reblock, manual BLOCKED), not quality failures (see §21.27)
    dsPipelines = pipelines.filter(p => p.type == dsType AND NOT p.auto_cancelled)
    if dsPipelines is not empty AND dsPipelines.last().status == "FAIL":
      return true
  
  return false
```

This ensures the circuit breaker engages for the common pattern: QA/review fails → Developer restarts implementation.

> **Naming note:** Despite its name, `hasDownstreamFail` is sometimes called with the *prerequisite* type (one step upstream of the current pipeline type) rather than the current type itself — see the re-validation guard in §11.1. This is because `getDownstreamTypes(prerequisite)` includes the current pipeline type, allowing the function to detect a FAIL of the current type (e.g., `hasDownstreamFail("qa")` detects a review-1 FAIL when starting code-review). The function name reflects its general purpose ("are there failures downstream of X?"), and the caller controls the scope by choosing the input type.

---

## 12. Completing a Pipeline

### 12.1 Algorithm

```
function completePipeline(wp, root, pipelineType, status, summary, agentRole, opts):
  // Guard: WP must be IN_PROGRESS (defense-in-depth — a non-IN_PROGRESS WP
  // should not have IN_PROGRESS pipelines, but the brief lock gap between
  // status transition and pipeline cancellation §20.4 could allow a race)
  if wp.status != "IN_PROGRESS":
    ERROR("WP status must be IN_PROGRESS, got {wp.status}")
  
  // Find the most recent IN_PROGRESS pipeline of the given type
  pipeline = wp.pipelines
    .filter(p => p.type == pipelineType AND p.status == "IN_PROGRESS")
    .last()
  
  if pipeline is null:
    ERROR("No in-progress {pipelineType} pipeline found")
  
  // Guard: Agent role validation
  expectedRole = PIPELINE_AGENT_MAP[pipelineType]
  if agentRole is not provided:
    ERROR("agentRole is required")
  if agentRole != expectedRole:
    if agentRole == "Project Manager":
      // PM override: allowed (e.g., cancelling a stale pipeline with FAIL)
      log info: "PM override: {agentRole} completing {pipelineType} pipeline "
                + "(normally owned by {expectedRole})"
    else:
      ERROR("Agent role {agentRole} cannot complete {pipelineType} pipeline "
            + "(owned by {expectedRole})")
  
  // Guard: Status must be PASS or FAIL (the only terminal pipeline statuses per §7.1)
  if status not in ["PASS", "FAIL"]:
    ERROR("Invalid pipeline completion status: {status}. Must be PASS or FAIL.")

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
    // Use actual agent when PM override is active for accurate audit trail.
    // Routing (to_agent) still uses the standard routing maps/functions.
    if agentRole != expectedRole:
      fromAgent = agentRole
    else:
      fromAgent = PIPELINE_AGENT_MAP[pipelineType]
    activeStages = wp.active_pipeline_stages ?? DEFAULT_PIPELINE_STAGES
    if status == "PASS":
      toAgent = resolveNextAgent(pipelineType, activeStages)   // §9.2
    else:  // FAIL
      toAgent = resolveFailAgent(pipelineType, activeStages)   // §9.3.1
    
    handoffNote = HandoffNote {
      from_agent: fromAgent,
      to_agent: toAgent,
      timestamp: now(),
      notes: opts.handoff_notes
    }
    wp.handoff_notes = (wp.handoff_notes ?? []).append(handoffNote)
  
  // Artifact completeness soft warning
  if status == "PASS" AND (opts.artifacts is null OR opts.artifacts.files_modified is null OR opts.artifacts.files_modified is empty):
    root.project_comments.append(ProjectComment {
      type: "warning",
      priority: "low",
      timestamp: now(),
      agent: agentRole,
      note: "Pipeline {pipelineType} on {wp.work_package_id} completed with PASS but declared no artifacts.files_modified — consider declaring modified files for traceability"
    })

  root.last_updated = now()
```

### 12.2 Handoff Note Routing Summary

PASS routing is **dynamic** — it depends on the WP's `active_pipeline_stages` and is computed by `resolveNextAgent` (§9.2). FAIL routing uses the static `FAIL_ROUTING_MAP` (§9.3) with a **dynamic fallback** via `resolveFailAgent` (§9.3.1) when the standard target's stage is not active.

```
On PASS (default 4 stages):          On PASS (all 6 stages):
  implementation → QA                  implementation    → QA
  qa             → Reviewer            qa                → Security Auditor
  code-review    → Documentation       security-audit    → Reviewer
  documentation  → Synthesis           code-review       → Release Engineer
                                       release-engineering → Documentation
                                       documentation     → Synthesis

On FAIL (default — standard targets active):
  implementation       → Developer (self-rework)
  qa                   → Developer
  security-audit       → Developer
  code-review          → Developer
  release-engineering  → Release Engineer (self-rework)
  documentation        → Documentation (self-rework)

On FAIL (fallback — standard target's stage not active):
  Route to first active stage's agent (see §9.3.1)
```

### 12.3 Acceptance Criteria Merge Semantics

- Match by **exact** criterion text
- Found → update the `met` flag
- Not found → **append** as a new entry `{ criterion, met }`

### 12.3b Acceptance Criteria Management

The merge semantics in [§12.3](#123-acceptance-criteria-merge-semantics) handle adding and updating criteria during `completePipeline`. Removing criteria or modifying criterion text requires a dedicated PM operation.

```
function updateAcceptanceCriteria(wp, root, agentRole, operations):
  // Guard: PM only
  if agentRole != "Project Manager":
    ERROR("Only the Project Manager can remove or modify acceptance criteria text")

  // Guard: WP must not be CANCELLED
  if wp.status == "CANCELLED":
    ERROR("Cannot modify acceptance criteria on a CANCELLED WP")

  for each op in operations:
    if op.action == "remove":
      index = wp.acceptance_criteria.findIndex(ac => ac.criterion == op.criterion)
      if index == -1:
        ERROR("Criterion not found: {op.criterion}")
      wp.acceptance_criteria.removeAt(index)

    if op.action == "modify_text":
      existing = wp.acceptance_criteria.find(ac => ac.criterion == op.old_criterion)
      if existing is null:
        ERROR("Criterion not found: {op.old_criterion}")
      if op.new_criterion is empty or whitespace-only:
        ERROR("Criterion text must be non-empty")
      existing.criterion = op.new_criterion

  // Guard: At least one criterion must remain (§21.3)
  if wp.acceptance_criteria is empty:
    ERROR("At least one acceptance criterion is required")

  root.last_updated = now()
  write wp
  write root
```

> **Scope:** This operation manages the criteria list structure — removing criteria or changing their text. Toggling `met` status during pipeline completion is handled by [§12.3](#123-acceptance-criteria-merge-semantics) merge semantics. Use this operation for PM corrections: removing accidentally appended criteria, fixing typos in criterion text, or updating outdated requirements.

### 12.4 Agent Role Validation on Completion

The `agentRole` parameter is mandatory. The agent must match the pipeline owner defined in `PIPELINE_AGENT_MAP` (§9.1), with one exception:

- **PM override:** The Project Manager may complete any pipeline type to handle operational scenarios (e.g., cancelling a stale pipeline by completing it with FAIL). A log entry is emitted for auditability.

This guard is the completion counterpart of §11.1.2 (Agent Role Validation on start). Together they ensure that only the owning agent (or PM) can start and complete a given pipeline type.
