# Handoff & Recommendations

> Part of the [Agent Workflow Specification](README.md).

---

## 13. Handoff Logic

The handoff system determines which agent should act next, based on the current state of all work packages.

### 13.1 Per-Agent Handoff Functions

Each agent role has handoff logic that examines all WPs and determines the correct next agent.

#### Planner Handoff

```
if no WPs exist:
  return READY_FOR_PM    (Project Manager should create WPs from the plan)
else:
  return WAIT            (Planner's work is done once WPs exist)
```

> **Design note:** The Planner operates before the ledger exists (it creates the plan document that the PM uses to initialize the ledger). Once the PM has created WPs, the Planner has no further role. The `getNextAction` for the Planner always returns `WAIT`. This handoff function is used only in the `getHandoffStatus` context.

#### Developer Handoff

```
// FAIL conditions first (§13.2 short-circuit semantics)
if any non-terminal, non-dependency-blocked WP has a FAIL routed to Developer:
  // Includes: most recent implementation is FAIL (direct rework),
  // OR most recent implementation is PASS but QA or review FAIL
  // (per FAIL_ROUTING_MAP §9.3 — excludes documentation FAIL, which is self-rework)
  return IN_PROGRESS               (Developer must rework)
if any non-terminal, non-dependency-blocked WP needs QA (has PASS implementation, no QA started):
  return READY_FOR_QA
if all WPs are terminal (COMPLETE or CANCELLED):
  return READY_FOR_SYNTHESIS
if any WP is IN_PROGRESS with assigned_to == "Developer":
  return IN_PROGRESS               (Developer has active work)
return WAIT                        (no actionable work for Developer)
```

#### QA Handoff

```
// FAIL conditions first (§13.2 short-circuit semantics)
if any non-terminal, non-dependency-blocked WP has a FAIL QA pipeline routed to Developer:
  return READY_FOR_DEVELOPER     (Developer must rework)
if WPs with PASS QA but no review started:
  if all such WPs are dependency-blocked:
    return WAIT                  (nothing actionable until dependencies resolve)
  else:
    return READY_FOR_REVIEW      (unblocked WPs ready for next stage)
if all WPs are terminal (COMPLETE or CANCELLED):
  return READY_FOR_SYNTHESIS
if any WP is IN_PROGRESS with assigned_to == "QA":
  return IN_PROGRESS             (QA has active work)
return WAIT                      (no actionable work for QA)
```

#### Reviewer Handoff

```
// FAIL conditions first (§13.2 short-circuit semantics)
if any non-terminal, non-dependency-blocked WP has a FAIL code-review pipeline routed to Developer:
  return READY_FOR_DEVELOPER     (Developer must rework)
if WPs with PASS code-review but no docs started:
  if all such WPs are dependency-blocked:
    return WAIT                  (nothing actionable until dependencies resolve)
  else:
    return READY_FOR_DOCS        (unblocked WPs ready for next stage)
if all WPs are terminal (COMPLETE or CANCELLED):
  return READY_FOR_SYNTHESIS
if any WP is IN_PROGRESS with assigned_to == "Reviewer":
  return IN_PROGRESS             (Reviewer has active work)
return WAIT                      (no actionable work for Reviewer)
```

#### Documentation Handoff

```
// WPs ready for documentation (PASS code-review, no doc pipeline yet or new upstream pass)
readyForDocs = non-terminal WPs where hasPassCodeReview AND (
  no documentation pipeline yet OR hasNewUpstreamPassSince("code-review", "documentation")
)
if readyForDocs is not empty:
  if all readyForDocs are dependency-blocked:
    skip                           (fall through to check earlier-stage WPs)
  else:
    return IN_PROGRESS             (Documentation continues documenting)

// Documentation FAIL → self-rework (not forwarded to Developer)
if any non-terminal, non-dependency-blocked WP has FAIL documentation pipeline (most recent):
  return IN_PROGRESS               (Documentation self-reworks)

// WPs still in earlier pipeline stages (no PASS code-review yet)
needsUpstreamWork = non-terminal, non-blocked WPs without PASS code-review
if needsUpstreamWork is not empty:
  if all needsUpstreamWork are dependency-blocked:
    return WAIT                    (nothing actionable until dependencies resolve)
  else:
    return READY_FOR_DEVELOPER     (unblocked WPs need earlier-stage work)

if all WPs are terminal:
  return READY_FOR_SYNTHESIS

return WAIT
```

#### Project Manager Handoff

```
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
    // Unassigned: route to Developer (first pipeline owner in workflow)
    return READY_FOR_DEVELOPER

// All WPs terminal
if all WPs have terminal status:
  return READY_FOR_SYNTHESIS

// WPs are in-flight (IN_PROGRESS or dependency-BLOCKED) — no PM action needed
return WAIT
```

> **`readyStatusForAgent` mapping:** Maps agent role to handoff status: `"Developer"` → `READY_FOR_DEVELOPER`, `"QA"` → `READY_FOR_QA`, `"Reviewer"` → `READY_FOR_REVIEW`, `"Documentation"` → `READY_FOR_DOCS`. Unknown roles fall back to `READY_FOR_DEVELOPER`.

### 13.2 Handoff Evaluation Order

> **Important:** All per-agent handoff functions evaluate conditions **top-to-bottom with short-circuit semantics**. The first matching condition wins. This means FAIL conditions always take priority over PASS conditions: if any WP has a FAIL pipeline requiring Developer rework, that status is returned even if other WPs simultaneously have PASS pipelines ready for the next stage.

> **Auto-cancelled pipeline exclusion:** Throughout all handoff and recommendation functions, auto-cancelled pipelines (`auto_cancelled = true`) are excluded from FAIL detection. An auto-cancelled FAIL represents an external interruption (cascade reblock or manual BLOCKED transition), not a quality failure. Functions that filter pipeline history — `isMostRecentPipelineFail` (§14.7), `hasDownstreamFail` (§11.3), and `hasNewUpstreamPassSince` (§14.6) — all exclude auto-cancelled pipelines. See [§21.27](edge-cases.md#2127-auto-cancelled-pipelines) for the full invariant.

### 13.3 Dependency-Blocked WP Exclusion

A critical invariant across Developer, QA, Reviewer, and Documentation handoff functions:

**WPs blocked by incomplete dependencies are excluded from the "work remaining" count.** A WP is considered unblocked only when all its dependencies are COMPLETE or CANCELLED. If all unprocessed WPs are dependency-blocked, the handoff returns `WAIT` — not the next stage — because no agent can make progress until dependencies resolve.

### 13.4 Next Agent Resolution

```
function nextAgentFromStatus(status, currentAgent):
  if isTerminalStatus(status):
    return null                     // No next agent for terminal states
  if status == "WAIT":
    return null                     // No next agent when no actionable work
  if status == "IN_PROGRESS":
    return currentAgent             // Stay with current agent
  
  // Map READY_FOR_* statuses to agent roles
  mapping = {
    "READY_FOR_PM":        "Project Manager",
    "READY_FOR_DEVELOPER": "Developer",
    "READY_FOR_QA":        "QA",
    "READY_FOR_REVIEW":    "Reviewer",
    "READY_FOR_DOCS":      "Documentation",
    "READY_FOR_SYNTHESIS": "Synthesis"
  }
  return mapping[status] ?? null
```

---

## 14. Next-Action Recommendation Engine

Provides agents with actionable recommendations based on project state and their role.

### 14.1 Common Pre-checks

```
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
4. **CREATE_WORK_PACKAGES**: No WPs exist yet (also covered by §14.1 common pre-check)
5. **WAIT**: No actionable items

```
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
  
  // Priority 3b: Abandoned WPs (claimed but no pipeline activity)
  // Grace period: only flag if the WP has been IN_PROGRESS for at least
  // STALE_PIPELINE_HOURS, to avoid false positives on freshly claimed WPs.
  // Use the WP detail's last status-change timestamp or, as a fallback,
  // compare root.last_updated against the staleness threshold.
  for each IN_PROGRESS WP with no IN_PROGRESS pipeline:
    // Use mostRecentEffectivePipeline (§14.11) to exclude auto-cancelled pipelines,
    // whose completed_at reflects cascade reblock time, not real work activity.
    effectivePipeline = mostRecentEffectivePipeline(wp)
    if wp.pipelines is empty OR effectivePipeline is null OR effectivePipeline.completed_at < (now() - STALE_PIPELINE_HOURS):
      if wpClaimedDuration(wp) < STALE_PIPELINE_HOURS:
        continue    // Grace period — WP was recently claimed
      return REVIEW_ABANDONED with wp.id, wp.assigned_to
  
  // Priority 4: No WPs yet (redundant with §14.1, included for completeness)
  if root.work_packages is empty:
    return CREATE_WORK_PACKAGES
  
  return WAIT
```

### 14.2 Developer Action Logic

Priority order:

1. **BLOCK_FOR_REWORK_LIMIT**: WP has `rework_counts[implementation] >= MAX_REWORK_COUNT`
2. **RESUME_OR_CANCEL**: WP has stale IN_PROGRESS `implementation` pipeline (>24h)
3. **CONTINUE_PIPELINE**: WP has an active (non-stale) IN_PROGRESS `implementation` pipeline — the Developer has work in progress
4. **REWORK** (direct): WP where most recent `implementation` pipeline is FAIL
5. **REWORK** (downstream-triggered): WP where most recent `implementation` is PASS but a downstream pipeline whose FAIL routes to Developer (per `FAIL_ROUTING_MAP` §9.3) has FAILed — i.e., most recent `qa` or `code-review` pipeline is FAIL — **AND** the downstream failure reflects the current implementation (`hasDownstreamReengagedSince("implementation")` is true, §14.13 — the downstream agent validated the latest implementation PASS and still FAILed). Documentation FAIL is excluded (routes to Documentation self-rework).
5b. **WAIT_FOR_DOWNSTREAM**: WP where most recent `implementation` is PASS, a downstream pipeline whose FAIL routes to Developer has FAILed, but the downstream failure is stale (`hasDownstreamReengagedSince("implementation")` is false) — the Developer has delivered a new implementation PASS that the downstream agent has not yet validated. The Developer should wait rather than starting redundant rework.
6. **IMPLEMENT**: WP that is IN_PROGRESS, has no implementation pipeline yet
7. **CLAIM_WP**: WP that is READY, all dependencies satisfied, and either unassigned or assigned to "Developer"

```
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
  
  // Priority 4: Direct rework (most recent implementation is FAIL)
  for each IN_PROGRESS WP where isMostRecentPipelineFail("implementation"):
    if WP is dependency-blocked: skip
    return REWORK
  
  // Priority 5: Downstream-triggered rework (impl PASS, but QA or review FAIL)
  // Only check types whose FAIL routes to Developer per FAIL_ROUTING_MAP (§9.3).
  // Documentation FAIL routes to Documentation (self-rework) and is excluded.
  // Temporal guard: skip if the Developer has already delivered a fix (new
  // implementation PASS) but the downstream agent has not yet re-engaged
  // to validate it (see §14.13, §21.52).
  developerReworkTypes = ["qa", "code-review"]
  for each IN_PROGRESS WP where any type in developerReworkTypes has isMostRecentPipelineFail(type):
    if WP is dependency-blocked: skip
    if NOT hasDownstreamReengagedSince(wp.pipelines, "implementation"):
      continue    // Developer's fix delivered; downstream hasn't re-engaged yet
    return REWORK with downstream_triggered = true
  
  // Priority 5b: Delivered rework awaiting downstream re-engagement
  // WPs that matched the downstream-fail condition above but were skipped by the
  // temporal guard. The Developer should wait rather than churning through redundant
  // implementation cycles.
  for each IN_PROGRESS WP where any type in developerReworkTypes has isMostRecentPipelineFail(type):
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

### 14.3 QA Action Logic

Same priority pattern as Developer, applied to `qa` pipelines:

1. **BLOCK_FOR_REWORK_LIMIT**: WP has `rework_counts[qa] >= MAX_REWORK_COUNT`
2. **RESUME_OR_CANCEL**: stale QA pipeline
3. **CONTINUE_PIPELINE**: WP has an active (non-stale) IN_PROGRESS `qa` pipeline
4. **RUN_QA** (re-engagement after rework): WP has at least one prior `qa` pipeline (excluding auto-cancelled) AND `hasNewUpstreamPassSince("implementation", "qa")` is true — Developer re-passed implementation after previous QA; QA should re-engage regardless of previous QA result
5. **WAIT_FOR_REWORK**: most recent QA pipeline is FAIL AND NOT `hasNewUpstreamPassSince("implementation", "qa")` — QA cannot act; Developer must fix and re-pass implementation first
6. **RUN_QA** (first run): WP with PASS implementation and no QA pipeline yet
7. **CLAIM_WP**: READY WP assigned to "QA" with all dependencies satisfied (post auto-unblock scenario)

> **Priority 4 before 5 rationale:** After a QA FAIL → Developer rework → implementation re-PASS cycle, the most recent QA pipeline is still FAIL. Without priority 4, the WAIT_FOR_REWORK check at priority 5 would short-circuit and QA would be told to wait — even though the Developer has already fixed the issue. By checking `hasNewUpstreamPassSince` first, the engine correctly detects that upstream work has been redone and QA should re-engage.
>
> The "at least one prior `qa` pipeline" guard ensures that first-run scenarios (no QA pipeline exists yet) fall through to Priority 6 (`RUN_QA` first run), which is semantically more accurate. Without the guard, `hasNewUpstreamPassSince` returns `true` when no downstream pipeline exists (§14.6), making Priority 6 unreachable dead code.

### 14.4 Reviewer Action Logic

Same pattern, applied to `code-review` pipelines:

1. **BLOCK_FOR_REWORK_LIMIT**: WP has `rework_counts[code-review] >= MAX_REWORK_COUNT`
2. **RESUME_OR_CANCEL**: stale code-review pipeline
3. **CONTINUE_PIPELINE**: WP has an active (non-stale) IN_PROGRESS `code-review` pipeline
4. **RUN_REVIEW** (re-engagement after rework): WP has at least one prior `code-review` pipeline (excluding auto-cancelled) AND `hasNewUpstreamPassSince("qa", "code-review")` is true — QA re-passed after previous review; Reviewer should re-engage regardless of previous review result
5. **WAIT_FOR_REWORK**: most recent code-review is FAIL AND NOT `hasNewUpstreamPassSince("qa", "code-review")` — Reviewer cannot act; Developer must fix and re-pass implementation + QA first
6. **RUN_REVIEW** (first run): WP with PASS QA and no review pipeline yet
7. **CLAIM_WP**: READY WP assigned to "Reviewer" with all dependencies satisfied (post auto-unblock scenario)

> **Priority 4 before 5 rationale:** Same as QA (§14.3) — `hasNewUpstreamPassSince` must be checked before WAIT_FOR_REWORK to avoid short-circuiting on a stale FAIL when upstream rework has already completed. The "at least one prior pipeline" guard ensures first-run scenarios fall through to Priority 6 (see §14.3 rationale for details).

### 14.5 Documentation Action Logic

Same pattern, applied to `documentation` pipelines:

1. **BLOCK_FOR_REWORK_LIMIT**: WP has `rework_counts[documentation] >= MAX_REWORK_COUNT`
2. **RESUME_OR_CANCEL**: stale documentation pipeline
3. **CONTINUE_PIPELINE**: WP has an active (non-stale) IN_PROGRESS `documentation` pipeline
4. **REWORK**: most recent documentation is FAIL (rework action = REWORK — Documentation self-reworks)
5. **FINALIZE_WP**: WP is IN_PROGRESS, most recent `documentation` pipeline is PASS, all acceptance criteria are met, and the documentation PASS post-dates the most recent `implementation` pipeline start (freshness check). The Documentation agent should mark the WP as COMPLETE.
5b. **UPDATE_CRITERIA**: WP is IN_PROGRESS, most recent `documentation` pipeline is PASS, the documentation PASS post-dates the most recent `implementation` pipeline start (freshness check passed), but NOT all acceptance criteria are `met: true`. The Documentation agent should update criteria (mark as met), rework documentation to address remaining criteria, or — if the unmet criteria are caused by underlying code issues rather than documentation gaps — set the WP to BLOCKED with a `technical` blocker to escalate to the Project Manager (see §21.24).
6. **WRITE_DOCS**: WP with PASS code-review and no docs yet, OR `hasNewUpstreamPassSince("code-review", "documentation")`
7. **CLAIM_WP**: READY WP assigned to "Documentation" with all dependencies satisfied (post auto-unblock scenario)

> **Note on handoff vs. recommendation priority:** The Documentation handoff function (§13.1) checks ready-for-docs WPs before FAIL self-rework, while this recommendation engine checks FAIL self-rework (priority 4) before WRITE_DOCS (priority 6). This is intentional: handoff answers "who should act next?" (new-work-first bias to avoid idle agents), while the recommendation engine answers "what should I do?" (fix-failures-first bias to prevent broken WPs from accumulating). Implementations should not attempt to unify these orderings.
>
> **Auto-handoff implication:** Because auto-handoff (§18) uses handoff status, the Documentation agent may be invoked via auto-handoff for a new-docs WP while it has a FAIL documentation pipeline on another WP. The receiving agent's `getNextAction` will then recommend REWORK (priority 4) instead of the work the handoff intended. This may cause a wasted handoff cycle — the agent resolves the FAIL rather than the new-docs WP. This is acceptable: the REWORK takes priority regardless of how the agent was invoked, and the new-docs WP will be picked up in the next cycle. Implementations should not special-case the recommendation engine based on handoff context.

### 14.6 `hasNewUpstreamPassSince` Algorithm

Determines whether a downstream agent should (re-)engage after an upstream rework cycle.

```
function hasNewUpstreamPassSince(pipelines, upstreamType, downstreamType):
  // Find most recent upstream PASS
  upstreamPass = pipelines
    .filter(p => p.type == upstreamType AND p.status == "PASS")
    .last()
  
  if upstreamPass is null:
    return false              // Upstream not yet passed
  
  // Find most recent downstream pipeline (any status), excluding auto-cancelled
  // (auto-cancelled pipelines are external interruptions, not quality signals)
  downstreamLatest = pipelines
    .filter(p => p.type == downstreamType AND NOT p.auto_cancelled)
    .last()
  
  if downstreamLatest is null:
    return true               // First run — trigger
  
  // Both timestamps must be present
  if upstreamPass.completed_at is null OR downstreamLatest.started_at is null:
    log warning: "Missing timestamp in pipeline comparison for WP {wp.id}; "
                 + "defaulting to false (no rework trigger). "
                 + "This indicates a data integrity issue."
    return false              // Conservative: don't trigger without timestamps
    // NOTE: This conservative default may cause the downstream agent to
    // permanently receive WAIT_FOR_REWORK instead of RUN_* (re-engagement),
    // effectively blocking progress until timestamps are repaired.
    // See §21.18 for the full implications and recommended mitigations.
  
  // Upstream completed AT or AFTER downstream started → rework cycle
  return upstreamPass.completed_at >= downstreamLatest.started_at
```

> **Implementation note:** Since `started_at` is always set at pipeline creation and `completed_at` is always set at pipeline completion, a null timestamp here indicates a data integrity issue (e.g., interrupted write, manual file edit). Implementations SHOULD emit a project comment of type `"warning"` when this occurs, so that the PM has visibility into the anomaly.

### 14.7 `isMostRecentPipelineFail` Algorithm

```
function isMostRecentPipelineFail(pipelines, pipelineType):
  // Exclude auto-cancelled pipelines — external interruptions are not quality failures
  matching = pipelines.filter(p => p.type == pipelineType AND NOT p.auto_cancelled)
  if matching is empty:
    return false
  return matching.last().status == "FAIL"
```

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

```
STALE_PIPELINE_HOURS = 24

function isStalePipeline(pipeline):
  if pipeline.status != "IN_PROGRESS" OR pipeline.started_at is null:
    return false
  ageHours = (now() - parseTimestamp(pipeline.started_at)) / hours
  return ageHours > STALE_PIPELINE_HOURS
```

> **Known limitation:** Stale pipeline detection only triggers when an agent of the appropriate role calls `getNextAction`. If an agent crashes 1 hour into a pipeline, the WP sits idle until either (a) the 24-hour threshold is reached and another agent of the same role queries, or (b) a different agent notices the WP is not progressing.
>
> **Mitigation:** Implementations may optionally expose a "check stale now" action for the Project Manager role, allowing the PM to trigger stale detection on demand. This does not change the state machine — it simply allows the PM to invoke the stale-check logic at any time rather than waiting for the threshold.

### 14.9 Batch Actions (Get Next Actions)

Same logic as single next-action, but collects **all** matching WPs instead of returning the first. Limited by a `max_results` parameter (default: 5). Enables parallel work on independent WPs.

### 14.10 Handoff Notes in Recommendations

When a next-action recommendation targets a specific WP, any handoff notes addressed to the requesting agent are included in the response. This ensures the agent receives context from the previous stage immediately.

```
function getHandoffNotesForAgent(wp, agentName):
  relevant = wp.handoff_notes.filter(n => n.to_agent == agentName)
  if relevant is empty: return null
  return relevant.flatMap(n => n.notes)
```

### 14.11 `mostRecentEffectivePipeline` Algorithm

Returns the most recent pipeline on a WP, excluding auto-cancelled pipelines. Used by the PM's `REVIEW_ABANDONED` detection (§14.1.2) to avoid masking abandonment behind system-generated pipeline closures.

```
function mostRecentEffectivePipeline(wp):
  effective = wp.pipelines.filter(p => NOT p.auto_cancelled)
  if effective is empty:
    return null
  return effective.last()
```

> **Why exclude auto-cancelled:** An auto-cancelled pipeline's `completed_at` is set at the time of cascade reblock (§15.5) or manual BLOCKED transition — not when real work was last performed. Without this exclusion, a WP that was cascade-reblocked, unblocked, and re-claimed but never worked on would not be flagged as abandoned until the auto-cancelled pipeline's `completed_at` ages past `STALE_PIPELINE_HOURS`. This is consistent with the §21.27 principle that auto-cancelled pipelines are excluded from quality-related decisions.

### 14.12 `wpClaimedDuration` Algorithm

Returns how long a WP has been in its current IN_PROGRESS state. Used by the PM's `REVIEW_ABANDONED` detection (§14.1.2) to enforce the grace period.

```
function wpClaimedDuration(wp):
  // Prefer WP detail's last status-change timestamp if tracked by the implementation.
  // Fallback: use the WP's most recent pipeline start or the root index's last_updated
  // as a proxy for when the WP was claimed.
  if wp.status_changed_at is not null:
    return now() - wp.status_changed_at
  
  // Fallback: find the earliest pipeline started_at on the WP as a lower bound.
  // If no pipelines exist (the scenario we're detecting), fall back to root.last_updated.
  allPipelines = wp.pipelines.filter(p => p.started_at is not null)
  if allPipelines is not empty:
    return now() - allPipelines.first().started_at
  
  // Final fallback: root.last_updated (imprecise but conservative)
  return now() - root.last_updated
```

> **Implementation note:** The `status_changed_at` field is not part of the core `WorkPackageDetail` schema (§3.3). Implementations that need precise claimed-duration tracking SHOULD add this field and update it on every WP status transition. The fallback heuristics above provide reasonable approximations when the field is absent.
>
> **⚠ Fallback accuracy warning:** When `status_changed_at` is absent and no pipelines exist — the exact scenario `REVIEW_ABANDONED` is designed to detect — the final fallback `now() - root.last_updated` is used. Since `root.last_updated` is updated by *any* project operation (e.g., completing a pipeline on an unrelated WP), a project with ongoing activity on other WPs will continuously refresh `root.last_updated`, making the abandoned WP's claimed duration appear short. This can suppress `REVIEW_ABANDONED` detection indefinitely on active projects. Implementations that rely on abandoned-WP detection SHOULD add the `status_changed_at` field to the `WorkPackageDetail` schema rather than depending on the fallback heuristic.

### 14.13 `hasDownstreamReengagedSince` Algorithm

Determines whether the downstream agent (whose FAIL triggered Developer rework) has started a new pipeline since the Developer's most recent implementation PASS. Used by the Developer recommendation engine (§14.2, priority 5) to prevent redundant rework cycles.

```
function hasDownstreamReengagedSince(pipelines, upstreamType):
  // Find most recent upstream PASS (excluding auto-cancelled)
  upstreamPass = pipelines
    .filter(p => p.type == upstreamType AND p.status == "PASS" AND NOT p.auto_cancelled)
    .last()
  
  if upstreamPass is null OR upstreamPass.completed_at is null:
    return false              // No upstream PASS to compare against
  
  // Check if any downstream pipeline type (whose FAIL routes to Developer)
  // has started AT or AFTER the upstream PASS completed.
  // This indicates the downstream agent has re-engaged to validate the fix.
  developerReworkTypes = ["qa", "code-review"]
  for each dsType in developerReworkTypes:
    dsPipelines = pipelines
      .filter(p => p.type == dsType AND NOT p.auto_cancelled)
    if dsPipelines is not empty:
      mostRecent = dsPipelines.last()
      if mostRecent.started_at is not null
         AND mostRecent.started_at >= upstreamPass.completed_at:
        return true            // Downstream has re-engaged since the fix
  
  return false                  // No downstream re-engagement detected
```

| Scenario | Result |
|----------|--------|
| impl-1 PASS → qa-1 FAIL (no further activity) | `true` — QA validated the current implementation and FAILed; priority 5 routes to REWORK |
| impl-1 PASS → qa-1 FAIL → impl-2 PASS (no QA re-engagement) | `false` — Developer's fix delivered but downstream hasn't re-engaged; priority 5 negated guard fires → WAIT_FOR_DOWNSTREAM |
| impl-1 PASS → qa-1 FAIL → impl-2 PASS → qa-2 started | `true` — QA re-engaged after the fix (if qa-2 is still IN_PROGRESS, priority 5's outer `isMostRecentPipelineFail` check is false → priority 5 does not fire) |
| impl-1 PASS → qa-1 FAIL → impl-2 PASS → qa-2 FAIL | `true` — QA re-engaged and failed again; priority 5 routes to REWORK |

> **Interaction with re-engagement that fails again:** When the downstream agent re-engages and FAILs again (e.g., qa-2 FAIL after impl-2 PASS), `hasDownstreamReengagedSince` returns `true` (qa-2 started after impl-2 PASS). The negated guard in priority 5 evaluates `NOT true` → does not fire, so the code falls through to REWORK — correctly routing the Developer to fix the code again. After a new implementation PASS (impl-3), `hasDownstreamReengagedSince` returns `false` (no downstream pipeline started since impl-3 PASS), and the negated guard fires, routing the Developer to WAIT_FOR_DOWNSTREAM until QA re-engages. The net effect: REWORK fires immediately when the downstream agent validates and FAILs, WAIT_FOR_DOWNSTREAM fires when the Developer has delivered a fix that hasn't been validated yet. This prevents the pathological loop identified in §21.52 while preserving immediate rework signaling after repeated failures.

> **Auto-cancelled pipeline exclusion:** Consistent with §21.27, auto-cancelled pipelines are excluded from both the upstream PASS lookup and the downstream re-engagement check.
