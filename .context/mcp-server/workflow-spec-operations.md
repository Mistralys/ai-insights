# MCP Server - Workflow Spec (Operations & Routing)
<INSTRUCTION>
# MCP Server - Workflow Spec: Operations & Routing
Tool operations, pipeline routing maps, agent handoff logic, and step-by-step workflow walkthrough.

</INSTRUCTION>
------------------------------------------------------------
```
// Structure of documents
└── mcp-server/
    └── docs/
        └── agents/
            └── workflow-specification/
                └── operations.md

```
###  Path: `/mcp-server/docs/agents/workflow-specification/operations.md`

```md
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

- `completePipeline` emits a **soft warning** (project comment, `type: "warning"`, `priority: "low"`) when a PASS pipeline has `artifacts.files_modified` empty or absent **and** the pipeline type is in `ARTIFACT_EXPECTED_PIPELINE_TYPES` (see implementation in §12.1).
- `ARTIFACT_EXPECTED_PIPELINE_TYPES` contains `implementation`, `code-review`, `release-engineering`, and `documentation` — pipeline types where agents may modify files.
- Verification-only pipeline types (`qa`, `security-audit`) are **exempt** from this warning because those agents verify but do not modify files.
- `code-review` is included because the Reviewer may apply Fix-Forward edits (Tier 2 feedback) that should be declared for traceability.
- Agent personas explicitly instruct creative agents to declare all modified files before calling `completePipeline`.
- The soft warning does **not** block the pipeline from completing — it serves as a traceability nudge.

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
  
  // Artifact completeness soft warning (scoped to creative/modifying pipeline types)
  if status == "PASS" AND pipelineType in ARTIFACT_EXPECTED_PIPELINE_TYPES AND (opts.artifacts is null OR opts.artifacts.files_modified is null OR opts.artifacts.files_modified is empty):
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

---

### 12.5 Pipeline Cancellation (cancelPipeline)

The `cancelPipeline` operation forcibly closes the most recent IN_PROGRESS pipeline of a given type on a WP. It is used for operational cleanup, crash recovery, and rollback of orphaned pipelines (see §21.68). The operation exists as `ledger_cancel_pipeline` in the implementation.

### 12.5.1 Algorithm

```
function cancelPipeline(wp, root, pipelineType, reason, agentRole, opts):
  // Guard: Agent role validation — only owning agent or PM may cancel
  expectedRole = PIPELINE_AGENT_MAP[pipelineType]
  if agentRole != expectedRole AND agentRole != "Project Manager":
    ERROR("Agent role {agentRole} cannot cancel {pipelineType} pipeline "
          + "(owned by {expectedRole})")

  // Find the most recent IN_PROGRESS pipeline of the given type
  pipeline = wp.pipelines
    .filter(p => p.type == pipelineType AND p.status == "IN_PROGRESS")
    .last()

  if pipeline is null:
    ERROR("No in-progress {pipelineType} pipeline found on {wp.work_package_id}")

  // Apply cancellation
  pipeline.status = "FAIL"
  pipeline.completed_at = now()
  pipeline.summary = ["Cancelled: " + reason]
  pipeline.auto_cancelled = opts.auto_cancelled ?? false   // See §12.5.2

  root.last_updated = now()
  write wp
  write root
```

### 12.5.2 auto_cancelled Semantics

The `auto_cancelled` parameter controls whether the cancellation consumes the per-pipeline rework budget (§16.2):

| `auto_cancelled` | Effect |
|-----------------|--------|
| `false` (default) | Pipeline counts as a rework attempt — `rework_counts[pipelineType]` increments on the next `startPipeline` call |
| `true` | Pipeline is excluded from rework detection and circuit-breaker calculations (§21.27) — does not consume rework budget |

**When to use `auto_cancelled = true`:** Cancellations caused by external interruptions rather than agent quality failures SHOULD set `auto_cancelled = true`. This includes:

- **Crash recovery:** The orchestrator cancelling an orphaned pipeline after an agent crash (§21.68)
- **WP lifecycle transitions:** System-generated cancellations on `IN_PROGRESS → BLOCKED` or `IN_PROGRESS → CANCELLED` transitions (§21.14b)
- **GUI reset cleanup:** Cancellations applied by the GUI reset tool to clear orphaned pipelines before re-running

**When to use `auto_cancelled = false` (default):** Explicit PM cancellations of running pipelines (e.g., aborting a pipeline whose output is known to be incorrect) are operational decisions, not external interruptions. These should not suppress rework budget tracking because the pipeline represents a genuine failure that required human intervention.

### 12.5.3 Relationship to completePipeline

`cancelPipeline` is a restricted form of `completePipeline` with:
- Status always `FAIL`
- Summary always `["Cancelled: {reason}"]`
- No acceptance criteria updates, handoff notes, or pipeline metrics
- An additional `auto_cancelled` flag (absent on `completePipeline`)

For normal pipeline completion — including PM-forced FAIL completions — use `completePipeline` (§12.1). Reserve `cancelPipeline` for cleanup and crash-recovery scenarios where the pipeline was never legitimately completed.

```
```
// Structure of documents
└── mcp-server/
    └── docs/
        └── agents/
            └── workflow-specification/
                └── pipeline-routing.md

```
###  Path: `/mcp-server/docs/agents/workflow-specification/pipeline-routing.md`

```md
# Pipeline Routing

> Part of the [Agent Workflow Specification](README.md).

---

## 8. Pipeline Ordering & Prerequisites

Pipelines within a work package follow a **canonical ordering** of six stages. The Project Manager selects which stages are active for each WP at creation time:

```
Canonical:  implementation → qa → security-audit → code-review → release-engineering → documentation
```

The PM may compose **any valid subsequence** of this ordering. Inactive stages are skipped by the dynamic routing functions. For example, the default 4-stage chain:

```
Default:    implementation → qa → code-review → documentation
```

A WP with all six stages active follows the full chain:

```
Full:       implementation → qa → security-audit → code-review → release-engineering → documentation
```

A documentation-only WP has a single stage:

```
Doc-only:   documentation
```

The active stages for a WP are always a **subsequence** of the canonical ordering — stages can be omitted, but never reordered. See [§4.2](data-model.md#42-pipeline-stage-constants) for the constant definitions and common composition patterns.

### 8.1 Prerequisites Map

The **static** prerequisites map defines the canonical prerequisite for each pipeline type — i.e., the immediately preceding stage in the canonical ordering:

| Pipeline Type | Canonical Prerequisite |
|--------------|----------------------|
| `implementation` | None (can always start) |
| `qa` | `implementation` |
| `security-audit` | `qa` |
| `code-review` | `security-audit` |
| `release-engineering` | `code-review` |
| `documentation` | `release-engineering` |

Because inactive stages are skipped, the **effective** prerequisite for a given pipeline type depends on the work package's `active_pipeline_stages`. The `resolvePrerequisite` function dynamically computes the correct prerequisite by walking backward through the canonical ordering until it finds an active predecessor:

#### 8.1.1 Dynamic Prerequisite Resolution

```
function resolvePrerequisite(pipelineType, activeStages):
  // activeStages defaults to DEFAULT_PIPELINE_STAGES when absent/null
  ordering = CANONICAL_PIPELINE_ORDERING
  index = ordering.indexOf(pipelineType)
  
  if index <= 0:
    return null  // implementation has no prerequisite
  
  // Walk backward from the position just before pipelineType
  for i = index - 1 downto 0:
    if ordering[i] in activeStages:
      return ordering[i]
  
  return null  // First active stage — no active predecessor
```

**Effective prerequisite examples:**

| Pipeline Type | Active Stages (default 4) | Active Stages (all 6) |
|--------------|--------------------------|----------------------|
| `implementation` | None | None |
| `qa` | `implementation` | `implementation` |
| `security-audit` | *(not active)* | `qa` |
| `code-review` | `qa` | `security-audit` |
| `release-engineering` | *(not active)* | `code-review` |
| `documentation` | `code-review` | `release-engineering` |

### 8.2 Prerequisite Check Algorithm

```
function canStartPipeline(wp, pipelineType):
  activeStages = wp.active_pipeline_stages ?? DEFAULT_PIPELINE_STAGES
  prerequisite = resolvePrerequisite(pipelineType, activeStages)
  if prerequisite is null:
    return true
  
  prereqPipelines = wp.pipelines.filter(p => p.type == prerequisite)
  if prereqPipelines is empty:
    return false
  
  mostRecent = prereqPipelines.last()
  return mostRecent.status == "PASS"
```

> **Note:** This check validates that the prerequisite is PASS but does not verify temporal ordering. The full re-validation guard (ensuring the prerequisite PASSed *after* the most recent run of the current pipeline type) is enforced in `startPipeline` (see [§11.1](operations.md#111-algorithm)).
>
> **Implementation note:** `startPipeline` (§11.1) implements the prerequisite check inline rather than delegating to `canStartPipeline`, because it extends the check with additional guards (re-validation, duplicate prevention, active-stage validation) in a single pass. This function is provided as a conceptual reference for the ordering rule; implementations are not required to expose it as a separate callable.

### 8.3 Duplicate Prevention

Only one pipeline of a given type can be IN_PROGRESS at a time per work package.

```
function hasDuplicateInProgress(wp, pipelineType):
  return wp.pipelines.any(p => p.type == pipelineType AND p.status == "IN_PROGRESS")
```

### 8.4 Downstream Types

Returns all pipeline types that follow a given type in the canonical pipeline ordering, filtered to only include active stages. When `activeStages` is omitted, defaults to `DEFAULT_PIPELINE_STAGES` (4-stage legacy behavior) for backward compatibility with pre-composable-stages callers.

```
function getDownstreamTypes(pipelineType, activeStages?):
  ordering = CANONICAL_PIPELINE_ORDERING
  stages = activeStages ?? DEFAULT_PIPELINE_STAGES
  active = ordering.filter(t => t in stages)
  index = active.indexOf(pipelineType)
  if index == -1 OR index == active.length - 1:
    return []
  return active.slice(index + 1)
```

**Examples with default (4 stages):**

| Input | Output |
|-------|--------|
| `implementation` | `["qa", "code-review", "documentation"]` |
| `qa` | `["code-review", "documentation"]` |
| `code-review` | `["documentation"]` |
| `documentation` | `[]` |

**Examples with all 6 stages active:**

| Input | Output |
|-------|--------|
| `implementation` | `["qa", "security-audit", "code-review", "release-engineering", "documentation"]` |
| `qa` | `["security-audit", "code-review", "release-engineering", "documentation"]` |
| `security-audit` | `["code-review", "release-engineering", "documentation"]` |
| `code-review` | `["release-engineering", "documentation"]` |
| `release-engineering` | `["documentation"]` |
| `documentation` | `[]` |

> Used by `hasDownstreamFail` ([§11.3](operations.md#113-downstream-fail-detection)) and the re-validation guard ([§11.1](operations.md#111-algorithm)).

### 8.5 Upstream Types

Returns all pipeline types that precede a given type in the canonical pipeline ordering, filtered to only include active stages. When `activeStages` is omitted, defaults to `DEFAULT_PIPELINE_STAGES` (4-stage legacy behavior) for backward compatibility. Counterpart of `getDownstreamTypes` (§8.4).

```
function getUpstreamTypes(pipelineType, activeStages?):
  ordering = CANONICAL_PIPELINE_ORDERING
  stages = activeStages ?? DEFAULT_PIPELINE_STAGES
  active = ordering.filter(t => t in stages)
  index = active.indexOf(pipelineType)
  if index <= 0:
    return []
  return active.slice(0, index)
```

**Examples with default (4 stages):**

| Input | Output |
|-------|--------|
| `implementation` | `[]` |
| `qa` | `["implementation"]` |
| `code-review` | `["implementation", "qa"]` |
| `documentation` | `["implementation", "qa", "code-review"]` |

**Examples with all 6 stages active:**

| Input | Output |
|-------|--------|
| `implementation` | `[]` |
| `qa` | `["implementation"]` |
| `security-audit` | `["implementation", "qa"]` |
| `code-review` | `["implementation", "qa", "security-audit"]` |
| `release-engineering` | `["implementation", "qa", "security-audit", "code-review"]` |
| `documentation` | `["implementation", "qa", "security-audit", "code-review", "release-engineering"]` |

> Used by the re-validation guard's upstream activity check ([§11.1](operations.md#111-algorithm)) to distinguish stale prerequisites from self-rework scenarios, and by upstream circuit breaker propagation ([§21.53](edge-cases.md#2153-upstream-circuit-breaker-propagation)).

---

## 9. Pipeline Routing Maps

Four maps control how agents are assigned and how failures/successes are routed. `PIPELINE_AGENT_MAP`, `FAIL_ROUTING_MAP`, and `AGENT_PIPELINE_MAP` are static (they cover all 6 pipeline types). `NEXT_AGENT_MAP` is replaced by the dynamic `resolveNextAgent` function because the next agent depends on which stages are active.

### 9.1 PIPELINE_AGENT_MAP

Maps pipeline type to the agent that owns it. Used to auto-update `assigned_to` when a pipeline starts.

| Pipeline Type | Agent |
|--------------|-------|
| `implementation` | Developer |
| `qa` | QA |
| `security-audit` | Security Auditor |
| `code-review` | Reviewer |
| `release-engineering` | Release Engineer |
| `documentation` | Documentation |

### 9.2 resolveNextAgent (Dynamic Next-Agent Resolution)

In previous versions of this specification, `NEXT_AGENT_MAP` was a static map. With dynamic pipeline composition, the next agent on PASS depends on the work package's `active_pipeline_stages`. The `resolveNextAgent` function replaces the static map:

```
function resolveNextAgent(pipelineType, activeStages):
  // activeStages defaults to DEFAULT_PIPELINE_STAGES when absent/null
  ordering = CANONICAL_PIPELINE_ORDERING
  agentMap = PIPELINE_AGENT_MAP
  index = ordering.indexOf(pipelineType)
  
  if index == -1:
    return null  // Unknown pipeline type
  
  // Find the next active stage after the current one
  for i = index + 1 to ordering.length - 1:
    if ordering[i] in activeStages:
      return agentMap[ordering[i]]
  
  // No more active pipeline stages — route to Synthesis
  return "Synthesis"
```

**Effective routing examples:**

| Pipeline Type | Default (4 stages) | All 6 stages | Doc-only | Verification-only (impl/qa/review) |
|--------------|-------------------|--------------|----------|------------------------------------|
| `implementation` | QA | QA | *(not active)* | QA |
| `qa` | Reviewer | Security Auditor | *(not active)* | Reviewer |
| `security-audit` | *(not active)* | Reviewer | *(not active)* | *(not active)* |
| `code-review` | Documentation | Release Engineer | *(not active)* | Synthesis |
| `release-engineering` | *(not active)* | Documentation | *(not active)* | *(not active)* |
| `documentation` | Synthesis | Synthesis | Synthesis | *(not active)* |

> **Terminal routing:** When `resolveNextAgent` returns `"Synthesis"`, it means there are no more active pipeline stages. This is the signal that the current stage is the **last active stage** — its owning agent is the terminal agent for this WP (see [§6.2.1](state-machines.md#621-dynamic-complete-guard-helpers)).

> **Backward compatibility:** When `activeStages` contains only the 4 default types (`DEFAULT_PIPELINE_STAGES`), `resolveNextAgent` produces the same results as the original static `NEXT_AGENT_MAP`.

### 9.3 FAIL_ROUTING_MAP

Maps pipeline type to the agent responsible for fixing failures. Used for handoff notes on FAIL. The base map is static:

| Pipeline Type | Rework Agent (on FAIL) |
|--------------|------------------------|
| `implementation` | Developer (self-rework) |
| `qa` | Developer |
| `security-audit` | Developer |
| `code-review` | Developer |
| `release-engineering` | Release Engineer (self-rework) |
| `documentation` | Documentation (self-rework) |

#### 9.3.1 FAIL Routing Fallback

When the standard FAIL target's owned pipeline stage is **not active** in the WP's `active_pipeline_stages`, the routing falls back to the agent owning the WP's **first active stage**:

```
function resolveFailAgent(pipelineType, activeStages):
  activeStages = activeStages ?? DEFAULT_PIPELINE_STAGES
  standardTarget = FAIL_ROUTING_MAP[pipelineType]
  targetStage = AGENT_PIPELINE_MAP[standardTarget]  // standardTarget always owns a pipeline type — see AGENT_PIPELINE_MAP consistency invariant (§9.4)
  
  if targetStage in activeStages:
    return standardTarget
  
  // Fallback: route to first active stage's agent
  firstStage = activeStages[0]
  return PIPELINE_AGENT_MAP[firstStage]
```

In practice, this fallback only triggers for unusual compositions where the standard fail target's stage was omitted (e.g., a WP with `["qa", "code-review"]` where a `qa` FAIL would normally route to Developer, but `implementation` is not active — the fallback routes to QA itself for self-rework). For all standard compositions (including the default 4 stages and full 6 stages), the base FAIL_ROUTING_MAP applies directly.

> **Self-referential fallback:** When the fallback routes to the same agent that completed the failing pipeline (e.g., QA FAIL → QA when Developer's stage is not active), this produces a self-rework handoff note. This follows the same self-referential handoff pattern as Documentation (§21.29) and Release Engineering (§21.56).

> **Failure routing rationale:**
> - **Security Auditor (`security-audit`)** failures route to Developer because security issues are typically code-level fixes, consistent with the QA and code-review failure routing pattern.
> - **Release Engineer (`release-engineering`)** failures are self-rework because release issues (versioning, packaging, changelog) are within the Release Engineer's own domain, consistent with the Documentation self-rework pattern.
>
> **Escalation path:** If a release-engineering pipeline FAIL is caused by underlying code issues (not release/packaging quality), the Release Engineer should set the WP to BLOCKED with a `technical` blocker. This follows the same escalation pattern as Documentation failures ([§21.24](edge-cases.md#2124-documentation-fail-escalation)).

### 9.4 AGENT_PIPELINE_MAP (Inverse)

Maps agent role to the pipeline type it owns. Derived from PIPELINE_AGENT_MAP by inversion. This is a convenience lookup for implementations — no algorithm in this specification references it by name, but it is useful for dynamically resolving an agent's pipeline type (e.g., when determining which pipeline to check in `getNextAction`).

| Agent | Pipeline Type |
|-------|--------------|
| Developer | `implementation` |
| QA | `qa` |
| Security Auditor | `security-audit` |
| Reviewer | `code-review` |
| Release Engineer | `release-engineering` |
| Documentation | `documentation` |

> **Map consistency invariant:** `PIPELINE_AGENT_MAP` (§9.1), `FAIL_ROUTING_MAP` (§9.3), and `AGENT_PIPELINE_MAP` (§9.4) must be consistent — every pipeline type that appears as a key in one map must appear in all maps, and `AGENT_PIPELINE_MAP` must be the exact inverse of `PIPELINE_AGENT_MAP`. The `resolveNextAgent` function (§9.2) dynamically derives next-agent routing from `PIPELINE_AGENT_MAP` and `CANONICAL_PIPELINE_ORDERING`, so no separate static `NEXT_AGENT_MAP` needs to be kept in sync. A typo or omission in any map could silently misroute handoffs or skip pipeline stages. Implementations SHOULD validate cross-map consistency at startup (e.g., asserting key-set equality and inverse-mapping correctness) and fail fast on any divergence.

```
```
// Structure of documents
└── mcp-server/
    └── docs/
        └── agents/
            └── workflow-specification/
                └── handoff.md

```
###  Path: `/mcp-server/docs/agents/workflow-specification/handoff.md`

```md
# Handoff Logic

> Part of the [Agent Workflow Specification](README.md). See also: [Recommendation Engine](recommendations.md).

---

## 13. Handoff Logic

The handoff system determines which agent should act next, based on the current state of all work packages.

### 13.1 Per-Agent Handoff Functions

Each agent role has handoff logic that examines all WPs and determines the correct next agent.

#### Planner Handoff

```pseudocode
if no WPs exist:
  return READY_FOR_PM    (Project Manager should create WPs from the plan)
else:
  return WAIT            (Planner's work is done once WPs exist)
```

> **Design note:** The Planner operates before the ledger exists (it creates the plan document that the PM uses to initialize the ledger). Once the PM has created WPs, the Planner has no further role. The `getNextAction` for the Planner always returns `WAIT`. This handoff function is used only in the `getHandoffStatus` context.

#### Developer Handoff

Only considers non-terminal WPs that include `implementation` in their `active_pipeline_stages` for pipeline-specific conditions (FAIL routing, QA readiness). The "all WPs terminal" and `assigned_to` checks apply to all WPs regardless of active stages.

```pseudocode
// activeStages = wp.active_pipeline_stages ?? DEFAULT_PIPELINE_STAGES
// FAIL conditions first (§13.2 short-circuit semantics)
// Temporal guard: only signal rework when the downstream agent has re-engaged
// since the Developer's latest fix (hasDownstreamReengagedSince §14.13).
// Without this, auto-handoff stalls after Developer delivers a fix — the handoff
// returns IN_PROGRESS (Developer "must rework") while getNextAction returns
// WAIT_FOR_DOWNSTREAM, preventing any agent from being routed to QA.
if any non-terminal, non-dependency-blocked WP with "implementation" in activeStages
   has a FAIL routed to Developer
   AND hasDownstreamReengagedSince(wp.pipelines, "implementation") is true:
  // Downstream validated the current fix and FAILed again — Developer must rework
  return IN_PROGRESS               (Developer must rework)
if any non-terminal, non-dependency-blocked WP with "implementation" in activeStages needs QA:
  // "Needs QA" means: PASS implementation AND (no QA started yet
  // OR hasNewUpstreamPassSince("implementation", "qa") — i.e., QA needs
  // to run or re-run after upstream rework)
  return READY_FOR_QA
if all WPs are terminal (COMPLETE or CANCELLED):
  return READY_FOR_SYNTHESIS
if any WP is IN_PROGRESS with assigned_to == "Developer":
  return IN_PROGRESS               (Developer has active work)
return WAIT                        (no actionable work for Developer)
```

> **Temporal guard rationale (v1.2.0):** Prior to v1.2.0, the Developer handoff checked for *any* FAIL routed to Developer without verifying whether the Developer had already delivered a fix. After `impl-1 PASS → qa-1 FAIL → impl-2 PASS`, the handoff would return `IN_PROGRESS` (qa-1 FAIL still exists), but `getNextAction` would return `WAIT_FOR_DOWNSTREAM` — the Developer has nothing to do. In auto-handoff–driven orchestration, this caused stalls: no agent was routed to QA for re-engagement. The temporal guard (`hasDownstreamReengagedSince`) aligns the handoff function with the recommendation engine's §14.2 priority 5/5b logic. Similarly, the "needs QA" condition now uses `hasNewUpstreamPassSince` to detect QA re-engagement needs after rework, mirroring the Documentation handoff's approach.

> **Direct implementation FAIL routing gap:** When the most recent `implementation` pipeline is itself FAIL (not a downstream QA/review FAIL), the first condition does not match — `hasDownstreamReengagedSince` looks for the latest implementation PASS, which either doesn't exist or predates the FAIL. The WP is instead caught by the generic `assigned_to == "Developer"` fallback, which returns `IN_PROGRESS` ("Developer has active work") rather than the rework-specific `IN_PROGRESS` ("Developer must rework"). The handoff **routing** is correct (Developer stays engaged), but the **semantic signal** differs: the fallback does not distinguish "active work" from "must rework." This has no runtime impact — the recommendation engine (§14.2 priority 4) correctly returns `REWORK` regardless of how the handoff routed — but may cause misleading auto-handoff log entries. Implementations that require precise handoff semantics for logging or observability MAY add a separate condition before the temporal-guarded check: `if any non-terminal WP has a FAIL implementation pipeline (most recent, excluding auto-cancelled): return IN_PROGRESS (Developer must rework)`.

#### QA Handoff

Only considers non-terminal WPs that include `qa` in their `active_pipeline_stages` for pipeline-specific conditions. WPs without `qa` in their active stages are invisible to QA's pipeline checks. The "all WPs terminal" and `assigned_to` checks apply to all WPs regardless of active stages.

```pseudocode
// activeStages = wp.active_pipeline_stages ?? DEFAULT_PIPELINE_STAGES
// Re-engagement check (before FAIL short-circuit — see rationale below)
// If QA previously FAILed but Developer has since re-PASSed implementation,
// QA should re-engage rather than routing back to Developer.
if any non-terminal, non-dependency-blocked WP with "qa" in activeStages
   has a FAIL QA pipeline
   AND hasNewUpstreamPassSince(wp.pipelines, "implementation", "qa") is true:
  return IN_PROGRESS             (QA should re-engage after upstream rework)

// FAIL conditions (§13.2 short-circuit semantics)
// Only reached when upstream has NOT re-PASSed since the QA FAIL.
if any non-terminal, non-dependency-blocked WP with "qa" in activeStages
   has a FAIL QA pipeline routed to Developer:
  return READY_FOR_DEVELOPER     (Developer must rework)

// Dynamic next-stage routing after PASS QA
// nextAgent = resolveNextAgent("qa", wp.active_pipeline_stages)
//   → "Security Auditor" when security-audit is active, "Reviewer" otherwise
// Mixed-routing: when ready WPs route to different next agents, return the
// first ready WP's READY_FOR_* status. Remaining WPs are dispatched via
// subsequent per-agent handoff calls (each agent's getNextAction is role-scoped).
if WPs with "qa" in activeStages have PASS QA but next stage not started:
  if all such WPs are dependency-blocked:
    return WAIT                  (nothing actionable until dependencies resolve)
  else:
    return readyStatusForAgent[firstReadyWp.nextAgent]  (first match wins)
if all WPs are terminal (COMPLETE or CANCELLED):
  return READY_FOR_SYNTHESIS
if any WP is IN_PROGRESS with assigned_to == "QA":
  return IN_PROGRESS             (QA has active work)
// Cross-WP dispatch: check for any other READY WP that can be dispatched
dispatch = findNextReadyDispatch()
if dispatch is not null:
  return dispatch
return WAIT                      (no actionable work for QA)
```

> **Re-engagement before FAIL rationale (v1.2.0):** Prior to v1.2.0, the QA handoff's FAIL check short-circuited before considering whether the Developer had already reworked. After `qa-1 FAIL → impl-2 PASS`, the handoff returned `READY_FOR_DEVELOPER`, but the Developer's `getNextAction` returned `WAIT_FOR_DOWNSTREAM`. In auto-handoff orchestration, nobody was routed to QA. The re-engagement check (using `hasNewUpstreamPassSince`) now fires first: if the Developer has re-PASSed since the QA FAIL, the handoff returns `IN_PROGRESS` for QA (mirroring §14.3 priority 4), allowing auto-handoff to keep QA in the loop.
>
> **Mixed-routing forward progress (v2.5.1):** When multiple ready WPs route to different next agents (e.g., WP-A → Security Auditor, WP-B → Reviewer due to different `active_pipeline_stages`), the handoff returns the first ready WP's `READY_FOR_*` status rather than `WAIT`. This is safe because `getNextAction` is role-scoped — dispatching Security Auditor does not cause that agent to claim WP-B (which needs Reviewer). WP-B is picked up on the next handoff cycle when the Reviewer's own handoff or `findNextReadyDispatch` fires. Prior to v2.5.1, the implementation returned `WAIT` in this scenario as a conservative safety guard, causing IDE stalls in mixed-stage projects.
>
> **Implementation note (hardcoded upstream):** The QA handoff implementation passes `'implementation'` as a hardcoded string to `hasNewUpstreamPassSince` — it does not call `resolvePrerequisite('qa', wp.active_pipeline_stages)`. For first-active-stage compositions (e.g., `active_pipeline_stages: ["qa", "code-review"]`), this means the re-engagement check always looks for an `implementation` PASS. If no `implementation` pipeline exists, `hasNewUpstreamPassSince` returns `false` and the check does not fire — which is the correct conservative behavior. This makes the handoff **immune to the null-prerequisite loop** ([§21.66](edge-cases.md#2166-first-active-stage-re-engagement-loop)): unlike `workflow-next-action.ts`, the implementation never collapses `null → true`. The tradeoff is that the re-engagement check is non-adaptive for unusual compositions where the conceptual upstream is not `implementation`. This is an intentional simplification — the hardcoded approach fails gracefully (returns `false`, falls through) rather than risking an infinite routing loop.

#### Reviewer Handoff

Only considers non-terminal WPs that include `code-review` in their `active_pipeline_stages` for pipeline-specific conditions. WPs without `code-review` in their active stages are invisible to Reviewer's pipeline checks. The "all WPs terminal" and `assigned_to` checks apply to all WPs regardless of active stages.

```pseudocode
// activeStages = wp.active_pipeline_stages ?? DEFAULT_PIPELINE_STAGES
// Re-engagement check (before FAIL short-circuit — see QA handoff rationale)
// If Reviewer previously FAILed but the effective upstream has since re-PASSed,
// Reviewer should re-engage rather than routing back to Developer.
// effectiveUpstream = resolvePrerequisite("code-review", wp.active_pipeline_stages)
//   → "security-audit" when active, "qa" otherwise, or null for first-active-stage compositions
//   When null (code-review is the first active stage), skip this re-engagement check entirely
if any non-terminal, non-dependency-blocked WP with "code-review" in activeStages
   has a FAIL code-review pipeline
   AND hasNewUpstreamPassSince(wp.pipelines, effectiveUpstream, "code-review") is true:
  return IN_PROGRESS             (Reviewer should re-engage after upstream rework)

// FAIL conditions (§13.2 short-circuit semantics)
// Only reached when upstream has NOT re-PASSed since the review FAIL.
if any non-terminal, non-dependency-blocked WP with "code-review" in activeStages
   has a FAIL code-review pipeline routed to Developer:
  return READY_FOR_DEVELOPER     (Developer must rework)

// Dynamic next-stage routing after PASS code-review
// nextAgent = resolveNextAgent("code-review", wp.active_pipeline_stages)
//   → "Release Engineer" when release-engineering is active, "Documentation" otherwise
// Mixed-routing: when ready WPs route to different next agents, return the
// first ready WP's READY_FOR_* status. Remaining WPs are dispatched via
// subsequent per-agent handoff calls (each agent's getNextAction is role-scoped).
if WPs with "code-review" in activeStages have PASS code-review but next stage not started:
  if all such WPs are dependency-blocked:
    return WAIT                  (nothing actionable until dependencies resolve)
  else:
    return readyStatusForAgent[firstReadyWp.nextAgent]  (first match wins)
if all WPs are terminal (COMPLETE or CANCELLED):
  return READY_FOR_SYNTHESIS
if any WP is IN_PROGRESS with assigned_to == "Reviewer":
  return IN_PROGRESS             (Reviewer has active work)
// Cross-WP dispatch: check for any other READY WP that can be dispatched
dispatch = findNextReadyDispatch()
if dispatch is not null:
  return dispatch
return WAIT                      (no actionable work for Reviewer)
```

> **Re-engagement before FAIL rationale (v1.2.0):** Identical to the QA handoff rationale. After `review-1 FAIL → impl-2 PASS → qa-2 PASS`, the handoff now returns `IN_PROGRESS` for Reviewer (re-engagement) instead of `READY_FOR_DEVELOPER` (stale FAIL routing). See QA Handoff rationale for the full explanation.
>
> **Mixed-routing forward progress (v2.5.1):** Same semantics as the QA handoff — when ready WPs route to different next agents (e.g., WP-A → Release Engineer, WP-B → Documentation), the handoff returns the first ready WP's `READY_FOR_*` status. See the QA handoff mixed-routing note for the full rationale.
>
> **Dynamic upstream (v2.0.0):** The re-engagement check uses `resolvePrerequisite("code-review", wp.active_pipeline_stages)` to determine the effective upstream — `"security-audit"` when the WP includes the optional security-audit stage, `"qa"` otherwise, or `null` for first-active-stage compositions. When `resolvePrerequisite` returns `null` (code-review is the first active stage), the re-engagement check is skipped entirely — there is no upstream to re-engage from, consistent with the [§21.66 null-prerequisite rule](edge-cases.md#2166-first-active-stage-re-engagement-loop). Similarly, the next-stage routing uses `resolveNextAgent` to determine whether PASS code-review flows to Release Engineer or Documentation.

#### Security Auditor Handoff

Only active for WPs that include `security-audit` in their `active_pipeline_stages`.

```pseudocode
// Re-engagement check (before FAIL short-circuit — same pattern as QA/Reviewer)
if any non-terminal, non-dependency-blocked WP with "security-audit" in activeStages
   has a FAIL security-audit pipeline
   AND hasNewUpstreamPassSince(wp.pipelines, "qa", "security-audit") is true:
  return IN_PROGRESS             (Security Auditor should re-engage after upstream rework)

// FAIL conditions (§13.2 short-circuit semantics)
if any non-terminal, non-dependency-blocked WP with "security-audit" in activeStages
   has a FAIL security-audit pipeline routed to Developer:
  return READY_FOR_DEVELOPER     (Developer must fix security issues)

// WPs with PASS security-audit ready for next stage
if WPs with "security-audit" in activeStages have PASS security-audit but no code-review started:
  if all such WPs are dependency-blocked:
    return WAIT
  else:
    return READY_FOR_REVIEW

if all WPs are terminal:
  return READY_FOR_SYNTHESIS
if any WP is IN_PROGRESS with assigned_to == "Security Auditor":
  return IN_PROGRESS
// Cross-WP dispatch: check for any other READY WP that can be dispatched
dispatch = findNextReadyDispatch()
if dispatch is not null:
  return dispatch
return WAIT
```

> **Scope filter:** The Security Auditor handoff only considers WPs where `security-audit` is in `active_pipeline_stages`. WPs without the optional security-audit stage are invisible to this handoff function, even if they have FAIL pipelines routed to Developer.

#### Release Engineer Handoff

Only active for WPs that include `release-engineering` in their `active_pipeline_stages`.

```pseudocode
// WPs ready for release engineering (PASS code-review, no release-engineering pipeline yet or new upstream pass)
readyForRelease = non-terminal WPs with "release-engineering" in activeStages where hasPassCodeReview AND (
  no release-engineering pipeline yet OR hasNewUpstreamPassSince("code-review", "release-engineering")
)
if readyForRelease is not empty:
  if all readyForRelease are dependency-blocked:
    skip
  else:
    return IN_PROGRESS             (Release Engineer continues release work)

// Release engineering FAIL → self-rework (not forwarded to Developer)
if any non-terminal, non-dependency-blocked WP with "release-engineering" in activeStages
   has FAIL release-engineering pipeline (most recent):
  return IN_PROGRESS               (Release Engineer self-reworks)

// WPs still in earlier pipeline stages — defer to orchestrator polling
// (Release Engineer cannot dispatch to the correct upstream agent;
//  returning READY_FOR_DEVELOPER would misroute WPs needing QA/Reviewer)
if all WPs are terminal:
  return READY_FOR_SYNTHESIS

// Cross-WP dispatch: check for any other READY WP that can be dispatched
dispatch = findNextReadyDispatch()
if dispatch is not null:
  return dispatch
return WAIT
```

> **Self-rework pattern:** Release Engineer follows the same self-rework pattern as Documentation — release-engineering FAIL routes to Release Engineer itself (§9.3). Escalation for code-level issues uses the BLOCKED mechanism with a `technical` blocker, identical to the Documentation escalation path (§21.24).

> **Upstream catch-all removed (v2.0.0):** Prior versions included a catch-all `READY_FOR_DEVELOPER` for WPs awaiting earlier pipeline stages. This was removed because the Release Engineer cannot accurately dispatch to the correct upstream agent — a WP awaiting `code-review` would be misrouted to Developer instead of Reviewer, causing the auto-handoff chain to terminate at Developer → WAIT. The orchestrator's hub-and-spoke polling (or the supervisor) is responsible for routing WPs to the correct upstream agent.

> **All-terminal scope harmonized:** As of the cross-WP dispatch rework, the Release Engineer handoff's all-terminal early exit uses `wpDetails.every(isTerminal)` — the same scope as the QA, Security Auditor, Reviewer, and Documentation handoff functions. The previous asymmetry (scoped to `releaseWps`) has been removed for consistency. The check is placed before `scopeToStage()` so that projects with no `release-engineering` WPs still fire the early exit when all WPs are terminal.

#### Documentation Handoff

Only considers non-terminal WPs that include `documentation` in their `active_pipeline_stages` for pipeline-specific conditions. WPs without `documentation` in their active stages are invisible to Documentation's pipeline checks. The "all WPs terminal" check applies to all WPs regardless of active stages.

```pseudocode
// activeStages = wp.active_pipeline_stages ?? DEFAULT_PIPELINE_STAGES
// WPs ready for documentation — the effective upstream stage is determined
// dynamically: "release-engineering" if active, otherwise "code-review",
// or null when documentation is the first (or only) active stage.
readyForDocs = non-terminal WPs with "documentation" in activeStages where
  hasPassEffectiveUpstream AND (
  no documentation pipeline yet OR hasNewUpstreamPassSince(effectiveUpstream, "documentation")
)
// Where effectiveUpstream = resolvePrerequisite("documentation", wp.active_pipeline_stages)
// Where hasPassEffectiveUpstream:
//   - When effectiveUpstream is not null: most recent pipeline of effectiveUpstream type is PASS
//   - When effectiveUpstream is null (documentation is the first or only active stage):
//     vacuously true — no prerequisite needed, consistent with canStartPipeline (§8.2)
// Note: hasNewUpstreamPassSince(null, "documentation") returns false per §14.6
// (no pipeline of type null exists), so first-active-stage WPs only match via
// "no documentation pipeline yet" — once a documentation pipeline exists,
// there is no upstream to re-engage from.
if readyForDocs is not empty:
  if all readyForDocs are dependency-blocked:
    skip                           (fall through to check earlier-stage WPs)
  else:
    return IN_PROGRESS             (Documentation continues documenting)

// Documentation FAIL → self-rework (not forwarded to Developer)
if any non-terminal, non-dependency-blocked WP with "documentation" in activeStages
   has FAIL documentation pipeline (most recent):
  return IN_PROGRESS               (Documentation self-reworks)

// WPs still in earlier pipeline stages — defer to orchestrator polling
// (Documentation cannot dispatch to the correct upstream agent;
//  returning READY_FOR_DEVELOPER would misroute WPs needing QA/Reviewer/etc.)
if all WPs are terminal:
  return READY_FOR_SYNTHESIS

// Cross-WP dispatch: check for any other READY WP that can be dispatched
dispatch = findNextReadyDispatch()
if dispatch is not null:
  return dispatch
return WAIT
```

> **Upstream catch-all removed (v2.0.0):** Same rationale as the Release Engineer handoff — the Documentation agent cannot accurately dispatch to the correct upstream agent. WPs needing earlier-stage work are left for the orchestrator to route via polling.

#### Synthesis Handoff

```pseudocode
// Synthesis is the terminal stage — no onward routing
return COMPLETE   // Chain terminates; project COMPLETE status is the orchestrator's stop signal
```

> **Design note:** The Synthesis agent's handoff always returns `COMPLETE`. After `completeSynthesis` (§19.1) sets the project to `COMPLETE`, no further handoff is evaluated (§18.6 skips auto-handoff for `COMPLETE` status). This block exists for completeness — implementations that enumerate all agent handoff functions will not encounter a null/undefined case for Synthesis. The `COMPLETE` return value signals to auto-handoff orchestrators that the entire project workflow is finished — no next agent needs to be dispatched.

#### Project Manager Handoff

```pseudocode
// Non-dependency blockers needing PM intervention
for each non-terminal WP with status == "BLOCKED":
  if wp.blocked_by.type in ["decision", "external", "technical"]:
    return IN_PROGRESS                  (PM still has actionable work)

// READY WPs need claiming by pipeline agents
for each WP with status == "READY":
  if wp.assigned_to is not null:
    // Post auto-unblock: route to the assigned agent
    return readyStatusForAgent(wp.assigned_to)
  else:
    // Unassigned: route to the agent owning the WP's first active stage
    return readyStatusForAgent(PIPELINE_AGENT_MAP[firstActiveStage(wp)])

// Step 2b: IN_PROGRESS WPs needing next pipeline stage
for each non-terminal, non-dependency-blocked WP with status == "IN_PROGRESS":
  activeStages = wp.active_pipeline_stages ?? DEFAULT_PIPELINE_STAGES
  for each stage in getOrderedActiveStages(activeStages):
    if stage has a PASS pipeline (most recent non-auto-cancelled):
      continue  // done, check next stage
    // This is the first stage not yet PASS
    if stage has a recent FAIL pipeline (most recent non-auto-cancelled):
      break     // FAIL routing handles this WP; skip to next WP
    if stage has an IN_PROGRESS pipeline (most recent non-auto-cancelled):
      break     // stage already being worked on; skip to next WP
    upstreamStage = resolvePrerequisite(stage, activeStages)
    if upstreamStage != null AND upstreamStage has an IN_PROGRESS pipeline:
      break     // upstream still running; skip to next WP
    nextAgent = PIPELINE_AGENT_MAP[stage]
    return readyStatusForAgent(nextAgent)

// All WPs terminal
if all WPs have terminal status:
  return READY_FOR_SYNTHESIS

// WPs are in-flight (IN_PROGRESS or dependency-BLOCKED) — no PM action needed
return WAIT
```

> **`readyStatusForAgent` mapping:** Maps agent role to handoff status: `"Developer"` → `READY_FOR_DEVELOPER`, `"QA"` → `READY_FOR_QA`, `"Security Auditor"` → `READY_FOR_SECURITY_AUDIT`, `"Reviewer"` → `READY_FOR_REVIEW`, `"Release Engineer"` → `READY_FOR_RELEASE_ENGINEERING`, `"Documentation"` → `READY_FOR_DOCS`. Unknown roles fall back to `READY_FOR_DEVELOPER`.

### 13.5 `findNextReadyDispatch` Algorithm

The `findNextReadyDispatch` helper is called by QA, Security Auditor, Reviewer, Release Engineer, and Documentation handoff functions immediately before their final `return WAIT`. It provides cross-WP dispatch: when an agent finishes its own work for the current WP but other WPs are READY and awaiting a deterministic agent, the handoff can route directly to that agent rather than returning `WAIT` and relying on the orchestrator to poll.

```pseudocode
function findNextReadyDispatch(currentRole):
  // Scan all READY, non-dependency-blocked WPs for a deterministic dispatch target.
  // First matching WP wins (consistent with PM Step 2).
  for each WP with status == "READY" AND !isBlockedByDependencies(wp):
    // Route to the agent owning the WP's first active pipeline stage.
    firstStage = firstActiveStage(wp.active_pipeline_stages)   // §6.2.1
    targetRole = PIPELINE_AGENT_MAP[firstStage]
    return readyStatusForRole(targetRole)  // e.g. READY_FOR_QA, READY_FOR_DOCS
    // reason: "{WP-ID} is READY; routing to {targetRole} for {firstStage} stage.
    //          (Cross-WP dispatch from {currentRole}.)"

  // All WPs are terminal (COMPLETE or CANCELLED) — project ready for Synthesis.
  // Guard: wpDetails must be non-empty (prevents false READY_FOR_SYNTHESIS on empty projects).
  if wpDetails is non-empty AND all WPs have terminal status:
    return READY_FOR_SYNTHESIS

  // No deterministic dispatch possible (all non-terminal WPs are IN_PROGRESS
  // or dependency-BLOCKED, or no READY WPs exist).
  return null
```

**Behaviour summary:**

| Condition | Return value |
|---|---|
| READY, non-dependency-blocked WP exists | `readyStatusForRole(PIPELINE_AGENT_MAP[firstActiveStage(wp)])` |
| All WPs terminal (and at least one WP exists) | `READY_FOR_SYNTHESIS` |
| No READY WPs; non-terminal WPs in-flight or dependency-blocked | `null` (caller returns `WAIT`) |

> **`currentRole` parameter:** The `currentRole` string is the calling agent's role name (e.g. `"Documentation"`). It is used exclusively for the human-readable `reason` string in the return object — never as a routing filter. Pass it for diagnostic clarity; it has no effect on the returned status.

> **Dependency-blocked exclusion:** READY WPs where `isBlockedByDependencies(wp)` returns true are excluded from Step 1. A WP is dependency-blocked when one or more of its declared dependency WP IDs have not yet reached a terminal status. Excluding them ensures `findNextReadyDispatch` does not route to agents who would immediately encounter a blocking dependency check.

> **`assigned_to` not consulted:** Unlike the PM handoff Step 2 (which routes to `wp.assigned_to` when set), `findNextReadyDispatch` always routes via `PIPELINE_AGENT_MAP[firstActiveStage(wp)]`. For the typical case where `assigned_to` matches the first-active-stage agent this is equivalent. For post-auto-unblock scenarios where `assigned_to` diverges from the first active stage, the PM handoff is the authoritative router — `findNextReadyDispatch` is a lightweight safety net intended for IDE stall prevention, not full PM-equivalent routing.

> **Self-routing design decision:** `findNextReadyDispatch` may return a status that routes back to the calling agent (e.g., Documentation handoff calling `findNextReadyDispatch` which returns `READY_FOR_DOCS` for a different WP). This is intentional — it allows Documentation to continue working on another READY WP that still needs documentation, without forcing the orchestrator to re-poll. The calling agent's own `getNextAction` will then surface the next WP to act on. See also [§21.71](edge-cases.md#2171-cross-wp-dispatch-from-non-pm-agents).

> **Relationship to PM handoff:** The PM handoff (§13.1 Project Manager Handoff) subsumes `findNextReadyDispatch` logic inline as Steps 2 and 2b, with additional depth for IN_PROGRESS WPs (pipeline-stage inspection) and `assigned_to` routing. `findNextReadyDispatch` is the lightweight variant used by pipeline agents — it only examines READY WPs and defers IN_PROGRESS WP routing to the PM or orchestrator polling.

> **Dynamic routing for unassigned WPs (v2.4.2):** Prior to v2.4.2, unassigned READY WPs were hardcoded to route to `READY_FOR_DEVELOPER`. This caused misrouting for WPs with non-default `active_pipeline_stages` — a documentation-only WP (`["documentation"]`) would be routed to Developer, whose `getNextAction` returns `WAIT` (no implementation work), stalling auto-handoff. The routing now uses `firstActiveStage` (§6.2.1) to dynamically determine the correct starting agent for the WP's composition.

> **Design note — PM pipeline blindness (v2.4.3):** Prior to v2.4.3, the PM handoff only examined WP-level statuses (READY, BLOCKED, COMPLETE, IN_PROGRESS). When all WPs were IN_PROGRESS and a pipeline stage completed (e.g., implementation PASS), the PM saw "in-flight work" and returned WAIT — even though the next pipeline agent (e.g., QA) needed to be engaged. This left auto-handoff with no target to dispatch to, stalling the pipeline chain. Step 2b closes this gap by examining pipeline states within each IN_PROGRESS WP, matching the approach used by all other pipeline agents' handoff functions. Step 2b fires only when step 2 (READY WPs) does not match, preserving the existing priority: READY WPs are always routed first.

> **Design note — freshly-claimed WP coverage (v2.4.3):** Step 2b intentionally covers freshly-claimed IN_PROGRESS WPs with zero pipelines. When no pipelines exist yet, the first active stage has no PASS, no FAIL, and no IN_PROGRESS — so the algorithm routes to `PIPELINE_AGENT_MAP[firstActiveStage(wp)]`. This is correct: the WP was claimed but the owning agent has not yet called `startPipeline`. The REVIEW_ABANDONED priority (§14.1.2 priority 3b) separately handles the case where a claimed WP remains idle beyond the staleness grace period — step 2b provides immediate routing so that the auto-handoff chain does not stall while waiting for the staleness threshold to expire.

### 13.2 Handoff Evaluation Order

> **Important:** All per-agent handoff functions evaluate conditions **top-to-bottom with short-circuit semantics**. The first matching condition wins. For QA and Reviewer handoffs, re-engagement checks (after upstream rework) take priority over stale FAIL routing — this ensures auto-handoff correctly routes back to the downstream agent when the upstream agent has already delivered a fix. For the Developer handoff, the temporal guard on FAIL conditions prevents false IN_PROGRESS returns when the Developer has already reworked. See the per-handoff rationale notes (v1.2.0) for details.

> **Auto-cancelled pipeline exclusion:** Throughout all handoff and recommendation functions, auto-cancelled pipelines (`auto_cancelled = true`) are excluded from FAIL detection. An auto-cancelled FAIL represents an external interruption (cascade reblock or manual BLOCKED transition), not a quality failure. Functions that filter pipeline history — `isMostRecentPipelineFail` ([§14.7](recommendations.md#147-ismostrecentpipelinefail-algorithm)), `hasDownstreamFail` (§11.3), and `hasNewUpstreamPassSince` ([§14.6](recommendations.md#146-hasnewupstreampasssince-algorithm)) — all exclude auto-cancelled pipelines. See [§21.27](edge-cases.md#2127-auto-cancelled-pipelines) for the full invariant.

### 13.3 Dependency-Blocked WP Exclusion

A critical invariant across Developer, QA, Reviewer, and Documentation handoff functions:

**WPs blocked by incomplete dependencies are excluded from the "work remaining" count.** A WP is considered unblocked only when all its dependencies are COMPLETE or CANCELLED. If all unprocessed WPs are dependency-blocked, the handoff returns `WAIT` — not the next stage — because no agent can make progress until dependencies resolve.

### 13.4 Next Agent Resolution

```pseudocode
function nextAgentFromStatus(status, currentAgent):
  if isTerminalStatus(status):
    return null                     // No next agent for terminal states
  if status == "WAIT":
    return null                     // No next agent when no actionable work
  if status == "IN_PROGRESS":
    return currentAgent             // Stay with current agent
  
  // Map READY_FOR_* statuses to agent roles
  mapping = {
    "READY_FOR_PM":                   "Project Manager",
    "READY_FOR_DEVELOPER":            "Developer",
    "READY_FOR_QA":                   "QA",
    "READY_FOR_SECURITY_AUDIT":       "Security Auditor",
    "READY_FOR_REVIEW":               "Reviewer",
    "READY_FOR_RELEASE_ENGINEERING":  "Release Engineer",
    "READY_FOR_DOCS":                 "Documentation",
    "READY_FOR_SYNTHESIS":            "Synthesis"
  }
  return mapping[status] ?? null
```

```
```
// Structure of documents
└── mcp-server/
    └── docs/
        └── agents/
            └── workflow-specification/
                └── walkthrough.md

```
###  Path: `/mcp-server/docs/agents/workflow-specification/walkthrough.md`

```md
# Walkthrough & Appendices

> Part of the [Agent Workflow Specification](README.md).

---

## 22. Complete Workflow Walkthrough

A typical project follows this sequence:

### Phase 1: Planning & Setup

```
1. Planner creates implementation plan document
2. Project Manager initializes ledger (ledger_initialize_project)
3. Project Manager creates work packages (ledger_create_work_package × N)
   - WPs with dependencies start as BLOCKED
   - WPs with no dependencies start as READY
```

### Phase 2: Implementation Cycle (Per Work Package)

Shows the default 4-stage pipeline (`DEFAULT_PIPELINE_STAGES`). Additional stages are inserted at their canonical positions when included in the WP's `active_pipeline_stages` — see Phase 2d below.

```
4. Developer claims WP (ledger_claim_work_package)
   - READY → IN_PROGRESS
   
5. Developer starts implementation pipeline (ledger_start_pipeline type=implementation)
   - WP.assigned_to = "Developer"
   
6. Developer completes implementation (ledger_complete_pipeline type=implementation status=PASS)
   - Handoff note created: Developer → QA
   
7. QA starts QA pipeline (ledger_start_pipeline type=qa)
   - WP.assigned_to = "QA"
   
8. QA completes QA (ledger_complete_pipeline type=qa status=PASS)
   - Handoff note created: QA → next active stage (Reviewer or Security Auditor)
   
9. Reviewer starts code-review pipeline (ledger_start_pipeline type=code-review)
   - WP.assigned_to = "Reviewer"
   
10. Reviewer completes review (ledger_complete_pipeline type=code-review status=PASS)
    - Handoff note created: Reviewer → next active stage (Documentation or Release Engineer)
    
11. Documentation starts documentation pipeline (ledger_start_pipeline type=documentation)
    - WP.assigned_to = "Documentation"
    
12. Documentation completes docs (ledger_complete_pipeline type=documentation status=PASS)
    - Handoff note created: Documentation → Synthesis
    
13. Documentation marks WP as COMPLETE (ledger_update_work_package_status status=COMPLETE)
    - Documentation pipeline PASS verified
    - Acceptance criteria verified
    - pending_work_packages decremented
    - Dependency unblocking triggered
```

### Phase 2b: Rework Cycle (On Failure)

```
Example: QA fails
  
8b. QA completes QA (ledger_complete_pipeline type=qa status=FAIL)
    - Handoff note created: QA → Developer
    
8c. Developer starts new implementation pipeline (ledger_start_pipeline type=implementation)
    - rework_counts.implementation incremented (downstream QA FAIL detected via hasDownstreamFail)
    
8d. Developer completes fix (ledger_complete_pipeline type=implementation status=PASS)
    - Handoff note created: Developer → QA
    
8e. QA starts new QA pipeline (ledger_start_pipeline type=qa)
    - rework_counts.qa incremented (direct rework of qa FAIL)
    - hasNewUpstreamPassSince("implementation", "qa") = true
     
8f. Flow continues from step 8...
```

### Phase 3: Synthesis

```
14. (After all WPs reach COMPLETE or CANCELLED)
    Synthesis agent generates project report
    
15. Synthesis completes (ledger_complete_synthesis agentRole="Synthesis")
    - Agent guard: only Synthesis agent (or PM override)
    - synthesis_generated = true
    - If pending_work_packages == 0: project status → COMPLETE
```

### Phase 2c: Reopening a Completed WP

```
PM or Documentation decides WP needs more work:

1. ledger_update_work_package_status(WP-001, status=IN_PROGRESS, agent="Project Manager")
   - revision incremented
   - rework_counts reset to absent (fresh rework budget for new revision)
   - pending_work_packages incremented
   - synthesis_generated reset to false (stale synthesis invalidated)
   - Dependent WPs cascade-reblocked (READY/IN_PROGRESS → BLOCKED)
   - IN_PROGRESS pipelines on dependents auto-cancelled (auto_cancelled = true)
   
2. Pipeline cycle restarts from implementation (or any applicable pipeline)
```

### Parallel Work Packages

Multiple independent WPs (no mutual dependencies) can progress through the pipeline simultaneously. The batch action tool (`ledger_get_next_actions`) returns all actionable WPs for an agent, enabling parallel processing.

### Phase 2d: Full 6-Stage Pipeline (All Stages Active)

When a WP includes all six stages in its `active_pipeline_stages`:

```
Developer (implementation) → QA (qa) → Security Auditor (security-audit)
  → Reviewer (code-review) → Release Engineer (release-engineering)
  → Documentation (documentation) → COMPLETE
```

The additional steps between QA and Reviewer (Security Auditor) and between Reviewer and Documentation (Release Engineer) follow the same pattern:
- Security Auditor claims, starts `security-audit` pipeline, completes PASS/FAIL
  - FAIL → Developer (same rework loop as QA/Reviewer FAILs)
  - PASS → handoff to Reviewer
- Release Engineer claims, starts `release-engineering` pipeline, completes PASS/FAIL
  - FAIL → Release Engineer (self-rework, same pattern as Documentation)
  - PASS → handoff to Documentation

Inactive stages are skipped entirely when not in `active_pipeline_stages` — `resolveNextAgent` (§9.2) walks the canonical ordering to find the next active stage.

---

## Appendix A: Constant Reference

| Constant | Default Value | Description |
|----------|--------------|-------------|
| `DEFAULT_PIPELINE_STAGES` | `["implementation", "qa", "code-review", "documentation"]` | Default active stages when `active_pipeline_stages` is absent/null. Backward-compatible with pre-composable-stages ledgers. See [§4.2](data-model.md#42-pipeline-stage-constants) |
| `CANONICAL_PIPELINE_ORDERING` | `["implementation", "qa", "security-audit", "code-review", "release-engineering", "documentation"]` | Fixed ordering of all six pipeline types. All `active_pipeline_stages` must be subsequences of this. See [§4.2](data-model.md#42-pipeline-stage-constants) |
| `STALE_PIPELINE_HOURS` | 24 | Hours before a pipeline is considered stale |
| `MAX_REWORK_COUNT` | 5 | Maximum rework cycles before circuit breaker |
| `MAX_HANDOFF_DEPTH` | 50 | Static floor for auto-handoff chain depth (runtime-configurable). Effective max = `max(50, total_work_packages × 30)` — see [§18.2.1](auxiliary-systems.md#1821-dynamic-effective-maximum) |

## Appendix B: Action Types Reference

| Action | Emitted By | Meaning |
|--------|------------|---------|
| `CREATE_WORK_PACKAGES` | PM | No WPs exist; PM should create them |
| `UNBLOCK_WP` | PM | WP blocked by non-dependency blocker; PM should investigate |
| `REVIEW_REWORK_LIMIT` | PM | WP hit per-pipeline rework limit; PM must cancel or restructure |
| `REVIEW_STALE` | PM | Stale pipeline detected; PM should coordinate with assigned agent |
| `REVIEW_ABANDONED` | PM | IN_PROGRESS WP with no pipeline activity within staleness threshold and claimed longer than staleness threshold; claimed but abandoned. PM should re-claim or unclaim |
| `GENERATE_SYNTHESIS` | Synthesis | All WPs terminal; generate report |
| `IMPLEMENT` | Developer | WP needs implementation |
| `RUN_QA` | QA | WP needs QA validation |
| `RUN_REVIEW` | Reviewer | WP needs code review |
| `RUN_SECURITY_AUDIT` | Security Auditor | WP needs security audit (only for WPs with `security-audit` in `active_pipeline_stages`) |
| `RUN_RELEASE_ENGINEERING` | Release Engineer | WP needs release engineering (only for WPs with `release-engineering` in `active_pipeline_stages`) |
| `WRITE_DOCS` | Documentation | WP needs documentation |
| `REWORK` | Developer/Documentation/Release Engineer | Most recent pipeline FAIL (direct self-rework), or downstream pipeline FAIL routed to this agent (downstream-triggered rework — Developer only, see §14.2) |
| `WAIT_FOR_REWORK` | QA/Security Auditor/Reviewer | Most recent pipeline FAIL AND no upstream re-pass detected (`hasNewUpstreamPassSince` is false); another agent must fix first |
| `WAIT_FOR_DOWNSTREAM` | Developer | Most recent implementation is PASS, a downstream pipeline (QA/security-audit/code-review) has FAILed, but the downstream agent has not yet re-engaged since the Developer's fix (`hasDownstreamReengagedSince` §14.13 is false). Developer should wait rather than starting redundant rework. See [§21.52](edge-cases.md#2152-developer-downstream-rework-churn-prevention). |
| `WAIT` | Any | No actionable work available |
| `RESUME_OR_CANCEL` | Any | Stale pipeline detected; decide whether to resume or cancel |
| `BLOCK_FOR_REWORK_LIMIT` | Any pipeline owner | Per-pipeline rework limit reached; requires human intervention |
| `CONTINUE_PIPELINE` | Any pipeline owner | Active (non-stale) IN_PROGRESS pipeline exists for this agent's pipeline type; continue current work |
| `CLAIM_WP` | Any pipeline owner | READY WP available to claim (dependencies satisfied, unassigned or assigned to this agent) |
| `FINALIZE_WP` | Terminal agent (last-active-stage owner) | Last-active-stage pipeline PASS, all acceptance criteria met, freshness check passed; mark WP as COMPLETE. For default WPs this is Documentation; for verification-only WPs this is Reviewer; etc. (see §6.2.1) |
| `UPDATE_CRITERIA` | Terminal agent (last-active-stage owner) | Last-active-stage pipeline PASS and freshness check passed, but acceptance criteria not fully met; update criteria, rework, or escalate via BLOCKED with `technical` blocker (§21.24) |
| `REPAIR_TIMESTAMPS` | PM | Null timestamp detected on a pipeline where `started_at` or `completed_at` should be present; data integrity issue blocking downstream agent progress (see [§21.18](edge-cases.md#2118-null-timestamp-data-integrity)). Recommended (SHOULD) — not all implementations may emit this action. |
| `REPAIR_ORPHAN_BLOCKED` | PM | WP is BLOCKED with a `dependency` blocker but all dependencies are terminal; inconsistent state from cascade lock gap or interrupted operation (see [§21.20](edge-cases.md#2120-cascade-lock-gap-recovery)). Recommended (SHOULD) — implementations may auto-repair instead. |

## Appendix C: Error Conditions Summary

| Operation | Error Condition | Description |
|-----------|----------------|-------------|
| Initialize | Ledger exists | Cannot re-initialize an existing project |
| Create WP | Dependency not found | Referenced WP ID does not exist |
| Create WP | Dependency cycle | Adding these dependencies would create a circular dependency |
| Create WP | Empty criteria | At least one acceptance criterion required |
| Create WP | Invalid active stages | `active_pipeline_stages` contains invalid types, empty array, duplicates, or violates canonical ordering (see [§9b.2](operations.md#9b2-active-pipeline-stages-validation)) |
| Claim WP | Wrong status | WP must be READY |
| Claim WP | Dependencies not met | All deps must be terminal |
| Claim WP | Assigned to other | Override required (PM or assignee only) |
| Claim WP | Non-pipeline agent | Only pipeline-owning agents and PM may claim (see [§21.49](edge-cases.md#2149-agent-role-guard-on-work-package-claiming)) |
| Start Pipeline | WP not IN_PROGRESS | Pipeline requires active WP |
| Start Pipeline | Pipeline type not active | `pipelineType` not in WP's `active_pipeline_stages` |
| Start Pipeline | Duplicate IN_PROGRESS | Same type already active |
| Start Pipeline | Prerequisite not met | Previous stage must be PASS |
| Start Pipeline | Missing agent role | `agentRole` parameter is required |
| Start Pipeline | Wrong agent role | Agent doesn't own this pipeline type (PM override allowed) |
| Start Pipeline | Re-validation needed | Prerequisite must re-PASS after upstream rework |
| Start Pipeline | Rework limit | Circuit breaker engaged |
| Complete Pipeline | No IN_PROGRESS pipeline | Nothing to complete |
| Complete Pipeline | WP not IN_PROGRESS | WP must be IN_PROGRESS (defense-in-depth against lock-gap races — see [§12.1](operations.md#121-algorithm)) |
| Complete Pipeline | Missing agent role | `agentRole` parameter is required |
| Complete Pipeline | Wrong agent role | Agent doesn't own this pipeline type (PM override allowed) |
| Unclaim WP | Active pipelines | Cannot unclaim WP with IN_PROGRESS pipelines |
| Unclaim WP | Wrong agent | Only PM or current assignee can unclaim |
| Update Status | Invalid transition | State machine violation |
| Update Status | Criteria not met | COMPLETE requires all criteria met |
| Update Status | Pipeline not passed | COMPLETE requires most recent pipeline of WP's last active stage to be PASS (see [§6.2.1](state-machines.md#621-dynamic-complete-guard-helpers)) |
| Update Status | Wrong agent | Only specific agents for specific transitions (COMPLETE: last-active-stage agent; see [§6.5](state-machines.md#65-agent-guards)) |
| Update Status | Missing blocker | BLOCKED requires blocked_by object |
| Update Status | Wrong agent (BLOCKED→BLOCKED) | Only PM or current assignee can modify blockers |
| Detect Project | Not found | No project matches the given path |
| Detect Project | Ambiguous | Multiple projects match |
| Complete Synthesis | WPs pending | Cannot complete synthesis while work packages are still pending |
| Complete Synthesis | No WPs | Cannot complete synthesis with zero work packages |
| Complete Synthesis | Wrong agent | Only Synthesis agent (or PM override) can complete synthesis |

### Soft Warnings (project comments, non-blocking)

| Operation | Warning Condition | Description |
|-----------|------------------|-------------|
| Create WP | Implementation without QA | `active_pipeline_stages` includes `implementation` but not `qa` (§9b.2 rule 5) |
| Create WP | Single-stage chain | `active_pipeline_stages` has exactly one entry (§9b.2 rule 6) |
| Create WP | Non-default composition | `active_pipeline_stages` differs from both `DEFAULT_PIPELINE_STAGES` and `CANONICAL_PIPELINE_ORDERING` (§9b.2 rule 7) |
| Complete Pipeline | Missing artifacts | PASS with empty/absent `artifacts.files_modified` (§12.1, [§21.64](edge-cases.md#2164-artifact-declaration-soft-warning)) |

```