# Recommendation Engine

> Part of the [Agent Workflow Specification](README.md). See also: [Handoff Logic](handoff.md).

---

## 14. Next-Action Recommendation Engine

Provides agents with actionable recommendations based on project state and their role.

### 14.1 Common Pre-checks

```pseudocode
function getNextAction(root, agentRole):
  // No WPs at all
  if root.work_packages is empty:
    if agentRole == "Project Manager":
      return { action: "CREATE_WORK_PACKAGES" }
    else:
      return { action: "WAIT" }
  
  // All WPs terminal
  if all WPs have terminal status:
    if agentRole == "Synthesis" AND NOT root.synthesis_generated:
      return { action: "GENERATE_SYNTHESIS" }
    else:
      return { action: "WAIT" }
  
  // Delegate to role-specific logic
  return getRoleAction(root, agentRole)
```

### 14.1.1 Planner Action Logic

The Planner operates before the ledger exists. `getNextAction` for the Planner role always returns `WAIT` — the Planner's work (creating the plan document) happens outside the ledger system.

### 14.1.2 Project Manager Action Logic

Priority order:

1. **UNBLOCK_WP**: Any WP is BLOCKED with a non-dependency blocker (`decision`, `external`, `technical`) — PM should investigate and resolve
2. **REVIEW_REWORK_LIMIT**: Any WP has `rework_counts[*] >= MAX_REWORK_COUNT` — PM must cancel or restructure
3. **REVIEW_STALE**: Any WP has a stale IN_PROGRESS pipeline (>24h) — PM should coordinate with the assigned agent
3b. **REVIEW_ABANDONED**: Any WP is IN_PROGRESS with no IN_PROGRESS pipeline AND no pipeline completed within `STALE_PIPELINE_HOURS` (or no pipelines at all) AND the WP has been IN_PROGRESS for at least `STALE_PIPELINE_HOURS` (measured via `root.last_updated` for the WP's claiming transition or, if available, the WP detail's most recent status-change timestamp) — WP was claimed but work never started or was abandoned. PM should re-claim on behalf of the correct agent or unclaim the WP.
3c. **REPAIR_ORPHAN_BLOCKED**: Any WP is BLOCKED with a `dependency` blocker (or absent blocker type) but all its formal dependencies are terminal — the WP should have been auto-unblocked by `propagateDependencyUnblock` (§15.4) but wasn't, likely due to an interruption during the cascade lock gap (§20.4). PM should transition it to READY or manually unblock.
4. **CREATE_WORK_PACKAGES**: No WPs exist yet (also covered by §14.1 common pre-check)
5. **WAIT**: No actionable items

```pseudocode
function getPMAction(root, store):
  load all WP details
  
  // Priority 1: Non-dependency blockers needing PM intervention
  for each WP with status == "BLOCKED":
    if wp.blocked_by.type in ["decision", "external", "technical"]:
      return UNBLOCK_WP with wp.id, blocker details
  
  // Priority 2: Rework limit reached
  for each WP where any rework_counts[*] >= MAX_REWORK_COUNT:
    return REVIEW_REWORK_LIMIT with wp.id
  
  // Priority 3: Stale pipelines
  for each IN_PROGRESS WP with any stale pipeline:
    return REVIEW_STALE with wp.id, pipeline type, age
  
  // Priority 3b: Abandoned WPs (see notes below)
  for each IN_PROGRESS WP with no IN_PROGRESS pipeline:
    effectivePipeline = mostRecentEffectivePipeline(wp)
    if wp.pipelines is empty OR effectivePipeline is null OR effectivePipeline.completed_at < (now() - STALE_PIPELINE_HOURS):
      if wpClaimedDuration(wp) < STALE_PIPELINE_HOURS:
        continue
      return REVIEW_ABANDONED with wp.id, wp.assigned_to
  
  // Priority 3c: Orphan-blocked WPs (see notes below)
  for each WP with status == "BLOCKED":
    wpDetail = readWorkPackage(wp.id)
    if wpDetail.blocked_by is null OR wpDetail.blocked_by.type == "dependency":
      if canStartWorkPackage(wpDetail, root.work_packages).allowed:
        return REPAIR_ORPHAN_BLOCKED with wp.id
  
  // Priority 4: No WPs yet (redundant with §14.1, included for completeness)
  if root.work_packages is empty:
    return CREATE_WORK_PACKAGES
  
  return WAIT
```

> **Priority 3b notes:** Grace period — only flag if the WP has been IN_PROGRESS for at least `STALE_PIPELINE_HOURS`, to avoid false positives on freshly claimed WPs. Uses the WP detail's last status-change timestamp or, as a fallback, compares `root.last_updated` against the staleness threshold. `mostRecentEffectivePipeline` (§14.11) excludes auto-cancelled pipelines, whose `completed_at` reflects cascade reblock time, not real work activity.
>
> **Priority 3c notes (§21.20):** Detects WPs that should have been auto-unblocked by `propagateDependencyUnblock` (§15.4) but weren't — e.g., due to a process interruption during the cascade lock gap (§20.4). **Data-integrity caveat:** If `blocked_by` is null due to data-integrity issues (rather than a missing dependency entry), this check may incorrectly transition a WP that should have a non-dependency hold (e.g., technical). The condition targets the cascade-interruption scenario specifically; other data anomalies may produce false positives. The PM should verify the WP's hold reason before confirming the repair.

### 14.2 Developer Action Logic

Priority order:

1. **BLOCK_FOR_REWORK_LIMIT**: WP has `rework_counts[implementation] >= MAX_REWORK_COUNT`
2. **RESUME_OR_CANCEL**: WP has stale IN_PROGRESS `implementation` pipeline (>24h)
3. **CONTINUE_PIPELINE**: WP has an active (non-stale) IN_PROGRESS `implementation` pipeline — the Developer has work in progress
4. **REWORK** (direct): WP where most recent `implementation` pipeline is FAIL
5. **REWORK** (downstream-triggered): WP where most recent `implementation` is PASS but a downstream pipeline whose FAIL routes to Developer (per `FAIL_ROUTING_MAP` §9.3) has FAILed — i.e., most recent `qa`, `security-audit`, or `code-review` pipeline is FAIL — **AND** the downstream failure reflects the current implementation (`hasDownstreamReengagedSince("implementation")` is true, §14.13 — the downstream agent validated the latest implementation PASS and still FAILed). Documentation and release-engineering FAILs are excluded (route to self-rework).
5b. **WAIT_FOR_DOWNSTREAM**: WP where most recent `implementation` is PASS, a downstream pipeline whose FAIL routes to Developer has FAILed, but the downstream failure is stale (`hasDownstreamReengagedSince("implementation")` is false) — the Developer has delivered a new implementation PASS that the downstream agent has not yet validated. The Developer should wait rather than starting redundant rework.
6. **IMPLEMENT**: WP that is IN_PROGRESS, has no implementation pipeline yet
7. **CLAIM_WP**: WP that is READY, all dependencies satisfied, and either unassigned or assigned to "Developer"

```pseudocode
function getDeveloperAction(root, store):
  load all WP details
  
  // Priority 1: Rework limit hit
  for each WP with rework_counts[implementation] >= MAX_REWORK_COUNT:
    return BLOCK_FOR_REWORK_LIMIT
  
  // Priority 2: Stale pipeline
  for each IN_PROGRESS WP with stale implementation pipeline:
    return RESUME_OR_CANCEL with age info
  
  // Priority 3: Active pipeline (non-stale)
  for each IN_PROGRESS WP with active (non-stale) implementation pipeline:
    return CONTINUE_PIPELINE with wp.id, pipeline info
  
  // Priority 4: Direct rework — see ordering note below
  for each IN_PROGRESS WP where isMostRecentPipelineFail("implementation"):
    if WP is dependency-blocked: skip
    return REWORK
  
  // Priority 5: Downstream-triggered rework — see routing note below
  developerReworkTypes = ["qa", "code-review"]
  for each IN_PROGRESS WP:
    activeStages = wp.active_pipeline_stages ?? DEFAULT_PIPELINE_STAGES
    wpReworkTypes = developerReworkTypes
    if "security-audit" in activeStages:
      wpReworkTypes = ["qa", "security-audit", "code-review"]
    if any type in wpReworkTypes has isMostRecentPipelineFail(type):
      if WP is dependency-blocked: skip
      if NOT hasDownstreamReengagedSince(wp.pipelines, "implementation"):
        continue
      return REWORK with downstream_triggered = true
  
  // Priority 5b: Delivered rework awaiting downstream re-engagement
  for each IN_PROGRESS WP:
    activeStages = wp.active_pipeline_stages ?? DEFAULT_PIPELINE_STAGES
    wpReworkTypes = developerReworkTypes
    if "security-audit" in activeStages:
      wpReworkTypes = ["qa", "security-audit", "code-review"]
    if any type in wpReworkTypes has isMostRecentPipelineFail(type):
      if WP is dependency-blocked: skip
      if NOT hasDownstreamReengagedSince(wp.pipelines, "implementation"):
        return WAIT_FOR_DOWNSTREAM with wp.id
  
  // Priority 6: Fresh implementation needed
  for each IN_PROGRESS WP with no implementation pipeline yet:
    if WP is dependency-blocked: skip
    return IMPLEMENT
  
  // Priority 7: Claim a READY WP
  for each WP with status == "READY":
    if canStartWorkPackage(wp, root.work_packages).allowed:
      if wp.assigned_to is null OR wp.assigned_to == "Developer":
        return CLAIM_WP with wp.id
  
  return WAIT
```

> **Priority 4 ordering dependency:** Priority 4 MUST remain above priority 5. Priority 5 only checks downstream pipeline types (qa, code-review); a direct implementation FAIL is not caught by priority 5's `isMostRecentPipelineFail` check on downstream types. If priorities 4 and 5 were reordered, direct implementation FAILs would fall through to priority 6/7 instead of being caught as rework.
>
> **Priority 5 routing notes:** Only check types whose FAIL routes to Developer per `FAIL_ROUTING_MAP` (§9.3). Documentation and release-engineering FAILs route to self-rework and are excluded. Temporal guard: skip if the Developer has already delivered a fix (new implementation PASS) but the downstream agent has not yet re-engaged to validate it (see §14.13, §21.52). Only check `security-audit` for WPs where it is active.

### 14.3 QA Action Logic

Same priority pattern as Developer, applied to `qa` pipelines:

1. **BLOCK_FOR_REWORK_LIMIT**: WP has `rework_counts[qa] >= MAX_REWORK_COUNT`
1b. **WAIT_FOR_UPSTREAM_REWORK_LIMIT**: WP has `rework_counts[implementation] >= MAX_REWORK_COUNT` — the upstream pipeline is rework-limited; QA should not run against a stale implementation that can no longer be reworked. Returns `WAIT` with a note indicating the upstream rework limiter is engaged (see [§21.53](edge-cases.md#2153-upstream-circuit-breaker-propagation))
2. **RESUME_OR_CANCEL**: stale QA pipeline
3. **CONTINUE_PIPELINE**: WP has an active (non-stale) IN_PROGRESS `qa` pipeline
4. **RUN_QA** (re-engagement after rework): WP has at least one prior `qa` pipeline (excluding auto-cancelled) AND `hasNewUpstreamPassSince("implementation", "qa")` is true — Developer re-passed implementation after previous QA; QA should re-engage regardless of previous QA result
4b. **RUN_QA** (self-rework fallback): most recent QA pipeline is FAIL AND `resolveFailAgent('qa', activeStages)` returns `'QA'` (self-rework — QA FAIL normally routes to Developer, but when `implementation` is not in active stages, the §9.3.1 fallback routes back to QA). QA should re-run, addressing the issues identified in the FAIL pipeline's summary and comments. See [§21.67](edge-cases.md#2167-first-active-stage-self-rework-deadlock)
5. **WAIT_FOR_REWORK**: most recent QA pipeline is FAIL AND NOT `hasNewUpstreamPassSince("implementation", "qa")` AND `resolveFailAgent('qa', activeStages)` does not return `'QA'` — QA cannot act; the fail-target agent must fix and re-pass first
6. **RUN_QA** (first run): WP with PASS implementation and no QA pipeline yet
7. **CLAIM_WP**: READY WP assigned to "QA" with all dependencies satisfied (post auto-unblock scenario)

> **Priority 4 before 5 rationale:** After a QA FAIL → Developer rework → implementation re-PASS cycle, the most recent QA pipeline is still FAIL. Without priority 4, the WAIT_FOR_REWORK check at priority 5 would short-circuit and QA would be told to wait — even though the Developer has already fixed the issue. By checking `hasNewUpstreamPassSince` first, the engine correctly detects that upstream work has been redone and QA should re-engage.
>
> The "at least one prior `qa` pipeline" guard ensures that first-run scenarios (no QA pipeline exists yet) fall through to Priority 6 (`RUN_QA` first run), which is semantically more accurate. Without the guard, `hasNewUpstreamPassSince` returns `true` when no downstream pipeline exists (§14.6), making Priority 6 unreachable dead code.
>
> **Null-prerequisite guard (P4):** The `"implementation"` argument to `hasNewUpstreamPassSince` is hardcoded; conceptually it should be `resolvePrerequisite("qa", activeStages)` for consistency with the dynamic pattern in §14.4. When `resolvePrerequisite("qa", activeStages)` returns `null` (i.e., `qa` is the first active stage, e.g., `active_pipeline_stages: ["qa", "code-review"]`), priority 4 does not fire — re-engagement requires an upstream stage to have re-passed. Control falls through to priority 4b, which checks whether QA should self-rework (see [§21.67](edge-cases.md#2167-first-active-stage-self-rework-deadlock)), then to priority 5/6.

### 14.4 Reviewer Action Logic

Same pattern, applied to `code-review` pipelines:

1. **BLOCK_FOR_REWORK_LIMIT**: WP has `rework_counts[code-review] >= MAX_REWORK_COUNT`
1b. **WAIT_FOR_UPSTREAM_REWORK_LIMIT**: Any upstream pipeline type (determined dynamically via `getUpstreamTypes("code-review", wp.active_pipeline_stages)` — at minimum `implementation` and `qa`, plus `security-audit` when active) has `rework_counts[type] >= MAX_REWORK_COUNT` — an upstream pipeline is rework-limited; Reviewer should not run against results that can no longer be reworked through normal channels. Returns `WAIT` with a note indicating which upstream rework limiter is engaged (see [§21.53](edge-cases.md#2153-upstream-circuit-breaker-propagation))
2. **RESUME_OR_CANCEL**: stale code-review pipeline
3. **CONTINUE_PIPELINE**: WP has an active (non-stale) IN_PROGRESS `code-review` pipeline
4. **RUN_REVIEW** (re-engagement after rework): WP has at least one prior `code-review` pipeline (excluding auto-cancelled) AND `hasNewUpstreamPassSince(effectiveUpstream, "code-review")` is true — where `effectiveUpstream = resolvePrerequisite("code-review", wp.active_pipeline_stages)` (i.e., `"security-audit"` when active, `"qa"` otherwise). Upstream re-passed after previous review; Reviewer should re-engage regardless of previous review result
4b. **RUN_REVIEW** (self-rework fallback): most recent code-review pipeline is FAIL AND `resolveFailAgent('code-review', activeStages)` returns `'Reviewer'` (self-rework — code-review FAIL normally routes to Developer, but when `implementation` is not in active stages, the §9.3.1 fallback routes back to Reviewer). Reviewer should re-run. See [§21.67](edge-cases.md#2167-first-active-stage-self-rework-deadlock)
5. **WAIT_FOR_REWORK**: most recent code-review is FAIL AND NOT `hasNewUpstreamPassSince(effectiveUpstream, "code-review")` AND `resolveFailAgent('code-review', activeStages)` does not return `'Reviewer'` — Reviewer cannot act; upstream agents must fix and re-pass first
6. **RUN_REVIEW** (first run): WP with PASS QA and no review pipeline yet
7. **CLAIM_WP**: READY WP assigned to "Reviewer" with all dependencies satisfied (post auto-unblock scenario)

> **Priority 4 before 5 rationale:** Same as QA (§14.3) — `hasNewUpstreamPassSince` must be checked before WAIT_FOR_REWORK to avoid short-circuiting on a stale FAIL when upstream rework has already completed. The "at least one prior pipeline" guard ensures first-run scenarios fall through to Priority 6 (see §14.3 rationale for details).
>
> **Null-prerequisite guard (P4):** When `effectiveUpstream` is `null` (i.e., `code-review` is the first active stage, e.g., `active_pipeline_stages: ["code-review", "documentation"]`), priority 4 does not fire — re-engagement requires an upstream stage to have re-passed. Control falls through to priority 4b, which checks whether Reviewer should self-rework (see [§21.67](edge-cases.md#2167-first-active-stage-self-rework-deadlock)), then to priority 5/6.

### 14.5 Documentation Action Logic

Same pattern, applied to `documentation` pipelines:

1. **BLOCK_FOR_REWORK_LIMIT**: WP has `rework_counts[documentation] >= MAX_REWORK_COUNT`
1b. **WAIT_FOR_UPSTREAM_REWORK_LIMIT**: Any upstream pipeline type (determined dynamically via `getUpstreamTypes("documentation", wp.active_pipeline_stages)` — at minimum `implementation`, `qa`, and `code-review`, plus `security-audit` and/or `release-engineering` when active) has `rework_counts[type] >= MAX_REWORK_COUNT` — an upstream pipeline is rework-limited; Documentation should not run against results that can no longer be reworked through normal channels. Returns `WAIT` with a note indicating which upstream rework limiter is engaged (see [§21.53](edge-cases.md#2153-upstream-circuit-breaker-propagation))
2. **RESUME_OR_CANCEL**: stale documentation pipeline
3. **CONTINUE_PIPELINE**: WP has an active (non-stale) IN_PROGRESS `documentation` pipeline
4. **REWORK**: most recent documentation is FAIL (rework action = REWORK — Documentation self-reworks)
5. **FINALIZE_WP**: WP is IN_PROGRESS, most recent `documentation` pipeline is PASS, all acceptance criteria are met, and the freshness check passes (documentation PASS post-dates the most recent first-active-stage pipeline start — see §6.2.1). The Documentation agent should mark the WP as COMPLETE.
5b. **UPDATE_CRITERIA**: WP is IN_PROGRESS, most recent `documentation` pipeline is PASS, the freshness check passes, but NOT all acceptance criteria are `met: true`. The Documentation agent should update criteria (mark as met), rework documentation to address remaining criteria, or — if the unmet criteria are caused by underlying code issues rather than documentation gaps — set the WP to BLOCKED with a `technical` blocker to escalate to the Project Manager (see §21.24).

> **UPDATE_CRITERIA rework tracking note:** If the Documentation agent chooses to start a new documentation pipeline to address unmet criteria (rather than updating criteria or escalating), this creates a pipeline that is **not tracked as rework** — the most recent documentation pipeline is PASS (not FAIL) and no downstream FAIL exists, so `needsRework = false` in `startPipeline` (§11.1) and `rework_counts.documentation` is not incremented. This is internally consistent (the prior pipeline succeeded; the new one addresses remaining criteria, not a failure) but may be surprising. Implementations that want to track these "criteria-driven re-runs" separately MAY add a distinct counter or metric; the core specification treats them as normal pipeline starts.

6. **WRITE_DOCS**: WP where effective upstream stage has PASS and no docs yet, OR `hasNewUpstreamPassSince(effectiveUpstream, "documentation")` — where `effectiveUpstream = resolvePrerequisite("documentation", wp.active_pipeline_stages)` (i.e., `"release-engineering"` when active, `"code-review"` otherwise)
7. **CLAIM_WP**: READY WP assigned to "Documentation" with all dependencies satisfied (post auto-unblock scenario)

> **Note on handoff vs. recommendation priority:** The Documentation handoff function ([§13.1](handoff.md#131-per-agent-handoff-functions)) checks ready-for-docs WPs before FAIL self-rework, while this recommendation engine checks FAIL self-rework (priority 4) before WRITE_DOCS (priority 6). This is intentional: handoff answers "who should act next?" (new-work-first bias to avoid idle agents), while the recommendation engine answers "what should I do?" (fix-failures-first bias to prevent broken WPs from accumulating). Implementations should not attempt to unify these orderings.
>
> **Auto-handoff implication:** Because auto-handoff (§18) uses handoff status, the Documentation agent may be invoked via auto-handoff for a new-docs WP while it has a FAIL documentation pipeline on another WP. The receiving agent's `getNextAction` will then recommend REWORK (priority 4) instead of the work the handoff intended. This may cause a wasted handoff cycle — the agent resolves the FAIL rather than the new-docs WP. This is acceptable: the REWORK takes priority regardless of how the agent was invoked, and the new-docs WP will be picked up in the next cycle. Implementations should not special-case the recommendation engine based on handoff context.

### 14.5a Generalized FINALIZE_WP for Non-Documentation Terminal Agents

When a WP's last active stage is not `documentation` (e.g., `code-review` for a verification-only WP), the **FINALIZE_WP** and **UPDATE_CRITERIA** actions are emitted by the agent owning that last active stage instead of Documentation. The conditions are identical to §14.5 priorities 5/5b, generalized via the §6.2.1 helpers:

- **FINALIZE_WP**: WP is IN_PROGRESS, most recent `lastActiveStage(wp)` pipeline is PASS, all acceptance criteria are met, freshness check passes. The terminal agent should mark the WP as COMPLETE.
- **UPDATE_CRITERIA**: Same as above but acceptance criteria are not fully met.

Each pipeline-owning agent's `getNextAction` implementation SHOULD check whether it is the terminal agent for a given WP (i.e., `resolveNextAgent(ownedPipelineType, wp.active_pipeline_stages) == "Synthesis"`) and, if so, include FINALIZE_WP/UPDATE_CRITERIA at the appropriate priority level.

### 14.5b Security Auditor Action Logic

Only active for WPs that include `security-audit` in their `active_pipeline_stages`. WPs without this stage are invisible to this agent's recommendation engine.

Same priority pattern as QA (§14.3), applied to `security-audit` pipelines:

1. **BLOCK_FOR_REWORK_LIMIT**: WP has `rework_counts[security-audit] >= MAX_REWORK_COUNT`
1b. **WAIT_FOR_UPSTREAM_REWORK_LIMIT**: Any upstream pipeline type (`implementation` or `qa`) has `rework_counts[type] >= MAX_REWORK_COUNT` — the upstream pipeline is rework-limited; Security Auditor should not run against stale implementation/QA results. Returns `WAIT` with a note indicating the upstream rework limiter is engaged (see [§21.53](edge-cases.md#2153-upstream-circuit-breaker-propagation))
2. **RESUME_OR_CANCEL**: stale security-audit pipeline
3. **CONTINUE_PIPELINE**: WP has an active (non-stale) IN_PROGRESS `security-audit` pipeline
4. **RUN_SECURITY_AUDIT** (re-engagement after rework): WP has at least one prior `security-audit` pipeline (excluding auto-cancelled) AND `hasNewUpstreamPassSince(effectiveUpstream, "security-audit")` is true — where `effectiveUpstream = resolvePrerequisite("security-audit", wp.active_pipeline_stages)` (i.e., `"qa"` in the standard chain). Upstream re-passed after previous security audit; Security Auditor should re-engage
4b. **RUN_SECURITY_AUDIT** (self-rework fallback): most recent security-audit pipeline is FAIL AND `resolveFailAgent('security-audit', activeStages)` returns `'Security Auditor'` (self-rework — security-audit FAIL normally routes to Developer, but when `implementation` is not in active stages, the §9.3.1 fallback routes back to Security Auditor). Security Auditor should re-run. See [§21.67](edge-cases.md#2167-first-active-stage-self-rework-deadlock)
5. **WAIT_FOR_REWORK**: most recent security-audit is FAIL AND NOT `hasNewUpstreamPassSince(effectiveUpstream, "security-audit")` AND `resolveFailAgent('security-audit', activeStages)` does not return `'Security Auditor'` — Security Auditor cannot act; Developer must fix and re-pass the prerequisite stage first
6. **RUN_SECURITY_AUDIT** (first run): WP with PASS qa and no security-audit pipeline yet
7. **CLAIM_WP**: READY WP assigned to "Security Auditor" with all dependencies satisfied

> **Scope filter:** The Security Auditor's `getNextAction` only considers WPs where `"security-audit"` is in `active_pipeline_stages`. WPs with only the default stages are excluded from all priority checks, as the Security Auditor has no work to do on those WPs.
>
> **Null-prerequisite guard (P4/P5):** When `effectiveUpstream` is `null` (i.e., `security-audit` is the first active stage), priority 4 does not fire — re-engagement requires an upstream stage to have re-passed. Priority 5 uses the same `effectiveUpstream`; when null, there is no upstream stage to wait for, so control falls through to priority 4b, which checks whether Security Auditor should self-rework (see [§21.67](edge-cases.md#2167-first-active-stage-self-rework-deadlock)), then to priority 6.

### 14.5c Release Engineer Action Logic

Only active for WPs that include `release-engineering` in their `active_pipeline_stages`. WPs without this stage are invisible to this agent's recommendation engine.

Same self-rework pattern as Documentation (§14.5), applied to `release-engineering` pipelines:

1. **BLOCK_FOR_REWORK_LIMIT**: WP has `rework_counts[release-engineering] >= MAX_REWORK_COUNT`
1b. **WAIT_FOR_UPSTREAM_REWORK_LIMIT**: Any upstream pipeline type (determined dynamically via `getUpstreamTypes("release-engineering", wp.active_pipeline_stages)` — at minimum `implementation`, `qa`, and `code-review`, plus `security-audit` when active) has `rework_counts[type] >= MAX_REWORK_COUNT`. Returns `WAIT` with a note indicating which upstream rework limiter is engaged (see [§21.53](edge-cases.md#2153-upstream-circuit-breaker-propagation))
2. **RESUME_OR_CANCEL**: stale release-engineering pipeline
3. **CONTINUE_PIPELINE**: WP has an active (non-stale) IN_PROGRESS `release-engineering` pipeline
4. **REWORK**: most recent release-engineering is FAIL (self-rework — Release Engineer fixes release/packaging issues)
5. **RUN_RELEASE_ENGINEERING**: WP with PASS `effectiveUpstream` and no release-engineering pipeline yet, OR `hasNewUpstreamPassSince(effectiveUpstream, "release-engineering")` — where `effectiveUpstream = resolvePrerequisite("release-engineering", wp.active_pipeline_stages)` (i.e., `"code-review"` in the standard chain)
6. **CLAIM_WP**: READY WP assigned to "Release Engineer" with all dependencies satisfied

> **Self-rework pattern:** Release Engineer follows the same self-rework pattern as Documentation — release-engineering FAIL routes back to Release Engineer itself. The escalation path for code-level issues discovered during release engineering uses the BLOCKED mechanism with a `technical` blocker, consistent with the Documentation escalation path (§21.24).
>
> **Scope filter:** The Release Engineer's `getNextAction` only considers WPs where `"release-engineering"` is in `active_pipeline_stages`.
>
> **Null-prerequisite guard (P5):** When `effectiveUpstream` is `null` (i.e., `release-engineering` is the first active stage), priority 5 does not fire — re-engagement requires an upstream stage to have re-passed. Control falls through to priority 6/CLAIM_WP.

### 14.6 `hasNewUpstreamPassSince` Algorithm

Determines whether a downstream agent should (re-)engage after an upstream rework cycle.

```pseudocode
function hasNewUpstreamPassSince(pipelines, upstreamType, downstreamType):
  upstreamPass = pipelines
    .filter(p => p.type == upstreamType AND p.status == "PASS")
    .last()
  
  if upstreamPass is null:
    return false              // Upstream not yet passed
  
  // Exclude auto-cancelled pipelines (see notes below)
  downstreamLatest = pipelines
    .filter(p => p.type == downstreamType AND NOT p.auto_cancelled)
    .last()
  
  if downstreamLatest is null:
    return true               // First run — should engage

  if upstreamPass.completed_at is null OR downstreamLatest.started_at is null:
    log warning: "Missing timestamp in pipeline comparison for WP {wp.id}; "
                 + "defaulting to false. This indicates a data integrity issue."
    return false              // Conservative: don't proceed without timestamps
  
  // Upstream completed AT or AFTER downstream started — rework cycle
  return upstreamPass.completed_at >= downstreamLatest.started_at
```

> **First-run `true` return:** The `true` return when no downstream pipeline exists means that callers using `hasNewUpstreamPassSince` with an OR-ed "no downstream yet" condition have a redundant first disjunct — the function already returns `true` for first-run scenarios. This is intentional: the function's contract is "should the downstream (re-)engage?", which is always yes when no downstream pipeline has ever run. Callers that need to distinguish "first run" from "re-engagement after rework" must add an explicit prior-pipeline-exists guard (see §14.3 priority 4 and §14.4 priority 4 for examples of this pattern).
>
> **Missing-timestamp fallback:** This conservative default may cause the downstream agent to permanently receive WAIT_FOR_REWORK instead of RUN_* (re-engagement), effectively stalling progress until timestamps are repaired. See §21.18 for the full implications and recommended mitigations.

> **`>=` comparison note:** The `>=` operator (rather than `>`) is intentionally conservative. If both timestamps are identical (possible with low-resolution clocks or in tests), the function returns `true` — treating coincident events as requiring re-engagement. This may cause a single extra pipeline cycle in edge cases but ensures that borderline timing never silently skips a re-validation.

> **Implementation note:** Since `started_at` is always set at pipeline creation and `completed_at` is always set at pipeline completion, a null timestamp here indicates a data integrity issue (e.g., interrupted write, manual file edit). Implementations SHOULD emit a project comment of type `"warning"` when this occurs, so that the PM has visibility into the anomaly.

### 14.7 `isMostRecentPipelineFail` Algorithm

```pseudocode
function isMostRecentPipelineFail(pipelines, pipelineType):
  matching = pipelines.filter(p => p.type == pipelineType AND NOT p.auto_cancelled)
  if matching is empty:
    return false
  return matching.last().status == "FAIL"
```

Auto-cancelled pipelines are excluded because they represent external interruptions, not quality signals.

| Pipeline History | Result |
|-----------------|--------|
| `[]` | false |
| `[FAIL]` | true |
| `[PASS]` | false |
| `[FAIL, PASS]` | false (resolved) |
| `[PASS, FAIL]` | true (needs rework) |
| `[FAIL(auto_cancelled)]` | false (external interruption, filtered out) |
| `[PASS, FAIL(auto_cancelled)]` | false (auto-cancelled filtered; effective last is PASS) |

### 14.8 Stale Pipeline Detection

```pseudocode
STALE_PIPELINE_HOURS = 24

function isStalePipeline(pipeline):
  if pipeline.status != "IN_PROGRESS" OR pipeline.started_at is null:
    return false
  ageHours = (now() - parseTimestamp(pipeline.started_at)) / hours
  return ageHours > STALE_PIPELINE_HOURS
```

> **Known limitation:** Stale pipeline detection only triggers when an agent of the appropriate role calls `getNextAction`. If an agent terminates unexpectedly 1 hour into a pipeline, the WP sits idle until either (a) the 24-hour threshold is reached and another agent of the same role queries, or (b) a different agent notices the WP is not progressing.
>
> **Mitigation:** Implementations may optionally expose a "check stale now" action for the Project Manager role, allowing the PM to trigger stale detection on demand. This does not change the state machine — it simply allows the PM to invoke the stale-check logic at any time rather than waiting for the threshold.

### 14.9 Batch Actions (Get Next Actions)

Same logic as single next-action, but collects **all** matching WPs instead of returning the first. Limited by a `max_results` parameter (default: 5). Enables parallel work on independent WPs.

### 14.10 Handoff Notes in Recommendations

When a next-action recommendation targets a specific WP, any handoff notes addressed to the requesting agent are included in the response. This ensures the agent receives context from the previous stage immediately.

```pseudocode
function getHandoffNotesForAgent(wp, agentName):
  relevant = wp.handoff_notes.filter(n => n.to_agent == agentName)
  if relevant is empty: return null
  return relevant.flatMap(n => n.notes)
```

### 14.11 `mostRecentEffectivePipeline` Algorithm

Returns the most recent pipeline on a WP, excluding auto-cancelled pipelines. Used by the PM's `REVIEW_ABANDONED` detection (§14.1.2) to avoid masking abandonment behind system-generated pipeline closures.

```pseudocode
function mostRecentEffectivePipeline(wp):
  effective = wp.pipelines.filter(p => NOT p.auto_cancelled)
  if effective is empty:
    return null
  return effective.last()
```

> **Why exclude auto-cancelled:** An auto-cancelled pipeline's `completed_at` is set at the time of cascade reblock (§15.5) or manual BLOCKED transition — not when real work was last performed. Without this exclusion, a WP that was cascade-reblocked, unblocked, and re-claimed but never worked on would not be flagged as abandoned until the auto-cancelled pipeline's `completed_at` ages past `STALE_PIPELINE_HOURS`. This is consistent with the §21.27 principle that auto-cancelled pipelines are excluded from quality-related decisions.

### 14.12 `wpClaimedDuration` Algorithm

Returns how long a WP has been in its current IN_PROGRESS state. Used by the PM's `REVIEW_ABANDONED` detection (§14.1.2) to enforce the grace period.

```pseudocode
function wpClaimedDuration(wp):
  if wp.status_changed_at is not null:
    return now() - wp.status_changed_at
  
  // Fallback: earliest pipeline started_at as a lower bound
  allPipelines = wp.pipelines.filter(p => p.started_at is not null)
  if allPipelines is not empty:
    return now() - allPipelines.first().started_at
  
  // Final fallback (imprecise — see note below)
  return now() - root.last_updated
```

> **Implementation note:** The `status_changed_at` field is part of the `WorkPackageDetail` schema (§3.3) as an optional field. Implementations MUST update this field on every WP status transition (inside `updateWorkPackageStatus` §10b.1 and `claimWorkPackage` §10.1) to ensure accurate claimed-duration tracking. When the field is absent (e.g., WPs created before the field was added), the fallback heuristics above provide reasonable approximations.
>
> **Fallback accuracy warning:** When `status_changed_at` is absent and no pipelines exist — the exact scenario `REVIEW_ABANDONED` is designed to detect — the final fallback `now() - root.last_updated` is used. Since `root.last_updated` is updated by *any* project operation (e.g., completing a pipeline on an unrelated WP), a project with ongoing activity on other WPs will continuously refresh `root.last_updated`, making the abandoned WP's claimed duration appear short. This can suppress `REVIEW_ABANDONED` detection indefinitely on active projects. Implementations MUST populate the `status_changed_at` field (§3.3) rather than depending on the fallback heuristic.

### 14.13 `hasDownstreamReengagedSince` Algorithm

Determines whether the downstream agent (whose FAIL triggered Developer rework) has started a new pipeline since the Developer's most recent implementation PASS. Used by the Developer recommendation engine (§14.2, priority 5) to prevent redundant rework cycles.

```pseudocode
function hasDownstreamReengagedSince(pipelines, upstreamType):
  upstreamPass = pipelines
    .filter(p => p.type == upstreamType AND p.status == "PASS" AND NOT p.auto_cancelled)
    .last()
  
  if upstreamPass is null OR upstreamPass.completed_at is null:
    return false

  developerReworkTypes = ["qa", "security-audit", "code-review"]
  for each dsType in developerReworkTypes:
    dsPipelines = pipelines
      .filter(p => p.type == dsType AND NOT p.auto_cancelled)
    if dsPipelines is not empty:
      mostRecent = dsPipelines.last()
      if mostRecent.started_at is not null
         AND mostRecent.started_at >= upstreamPass.completed_at:
        return true
  
  return false
```

| Scenario | Result |
|----------|--------|
| impl-1 PASS → qa-1 FAIL (no further activity) | `true` — QA validated the current implementation and FAILed; priority 5 routes to REWORK |
| impl-1 PASS → qa-1 FAIL → impl-2 PASS (no QA re-engagement) | `false` — Developer's fix delivered but downstream hasn't re-engaged; priority 5 negated guard fires → WAIT_FOR_DOWNSTREAM |
| impl-1 PASS → qa-1 FAIL → impl-2 PASS → qa-2 started | `true` — QA re-engaged after the fix (if qa-2 is still IN_PROGRESS, priority 5's outer `isMostRecentPipelineFail` check is false → priority 5 does not fire) |
| impl-1 PASS → qa-1 FAIL → impl-2 PASS → qa-2 FAIL | `true` — QA re-engaged and failed again; priority 5 routes to REWORK |

> **Interaction with re-engagement that fails again:** When the downstream agent re-engages and FAILs again (e.g., qa-2 FAIL after impl-2 PASS), `hasDownstreamReengagedSince` returns `true` (qa-2 started after impl-2 PASS). The negated guard in priority 5 evaluates `NOT true` → does not fire, so the code falls through to REWORK — correctly routing the Developer to fix the code again. After a new implementation PASS (impl-3), `hasDownstreamReengagedSince` returns `false` (no downstream pipeline started since impl-3 PASS), and the negated guard fires, routing the Developer to WAIT_FOR_DOWNSTREAM until QA re-engages. The net effect: REWORK fires immediately when the downstream agent validates and FAILs, WAIT_FOR_DOWNSTREAM fires when the Developer has delivered a fix that hasn't been validated yet. This prevents the pathological loop identified in §21.52 while preserving immediate rework signaling after repeated failures.

> **Auto-cancelled pipeline exclusion:** Consistent with §21.27, auto-cancelled pipelines are excluded from both the upstream PASS lookup and the downstream re-engagement check.
