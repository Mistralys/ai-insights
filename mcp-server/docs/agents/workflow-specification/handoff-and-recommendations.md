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
if any WP needs QA (has PASS implementation, no QA started):
  return READY_FOR_QA
if all WPs are terminal (COMPLETE or CANCELLED):
  return READY_FOR_SYNTHESIS
else:
  return IN_PROGRESS or WAIT
```

#### QA Handoff

```
if only FAIL QA pipelines remain (no new/in-progress QA):
  return READY_FOR_DEVELOPER
if WPs with PASS QA but no review started:
  if all such WPs are dependency-blocked:
    return WAIT                  (nothing actionable until dependencies resolve)
  else:
    return READY_FOR_REVIEW      (unblocked WPs ready for next stage)
if all WPs are terminal:
  return READY_FOR_SYNTHESIS
```

#### Reviewer Handoff

```
Same pattern as QA handoff, shifted one stage:
  FAIL code-review → READY_FOR_DEVELOPER
  PASS code-review, no docs → check dependency-blocked
    All blocked: WAIT            (nothing actionable)
    Not all blocked: READY_FOR_DOCS
  All WPs terminal: READY_FOR_SYNTHESIS
```

#### Documentation Handoff

```
// WPs ready for documentation (PASS code-review, no doc pipeline yet or new upstream pass)
readyForDocs = WPs where hasPassCodeReview AND (
  no documentation pipeline yet OR hasNewUpstreamPassSince("code-review", "documentation")
)
if readyForDocs is not empty:
  if all readyForDocs are dependency-blocked:
    skip                           (fall through to check earlier-stage WPs)
  else:
    return IN_PROGRESS             (Documentation continues documenting)

// Documentation FAIL → self-rework (not forwarded to Developer)
if any WP has FAIL documentation pipeline (most recent):
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
Check for BLOCKED work packages that need intervention
```

### 13.2 Handoff Evaluation Order

> **Important:** All per-agent handoff functions evaluate conditions **top-to-bottom with short-circuit semantics**. The first matching condition wins. This means FAIL conditions always take priority over PASS conditions: if any WP has a FAIL pipeline requiring Developer rework, that status is returned even if other WPs simultaneously have PASS pipelines ready for the next stage.

### 13.3 Dependency-Blocked WP Exclusion

A critical invariant across QA, Reviewer, and Documentation handoff functions:

**WPs blocked by incomplete dependencies are excluded from the "work remaining" count.** A WP is considered unblocked only when all its dependencies are COMPLETE or CANCELLED. If all unprocessed WPs are dependency-blocked, the handoff returns `WAIT` — not the next stage — because no agent can make progress until dependencies resolve.

### 13.4 Next Agent Resolution

```
function nextAgentFromStatus(status, currentAgent):
  if isTerminalStatus(status):
    return null                     // No next agent for terminal states
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
  
  // Priority 4: No WPs yet (redundant with §14.1, included for completeness)
  if root.work_packages is empty:
    return CREATE_WORK_PACKAGES
  
  return WAIT
```

### 14.2 Developer Action Logic

Priority order:

1. **BLOCK_FOR_REWORK_LIMIT**: WP has `rework_count >= MAX_REWORK_COUNT`
2. **RESUME_OR_CANCEL**: WP has stale IN_PROGRESS `implementation` pipeline (>24h)
3. **REWORK**: WP where most recent `implementation` pipeline is FAIL
4. **IMPLEMENT**: WP that is IN_PROGRESS, assigned to Developer, has no implementation pipeline yet or needs fresh implementation

```
function getDeveloperAction(root, store):
  load all WP details
  
  // Priority 1: Rework limit hit
  for each WP with rework_count >= MAX_REWORK_COUNT:
    return BLOCK_FOR_REWORK_LIMIT
  
  // Priority 2: Stale pipeline
  for each IN_PROGRESS WP with stale implementation pipeline:
    return RESUME_OR_CANCEL with age info
  
  // Priority 3: Rework needed (most recent implementation is FAIL)
  for each IN_PROGRESS WP where isMostRecentPipelineFail("implementation"):
    if WP is dependency-blocked: skip
    return REWORK
  
  // Priority 4: Fresh implementation needed
  for each WP that needs implementation:
    if WP is dependency-blocked: skip
    return IMPLEMENT
  
  return WAIT
```

### 14.3 QA Action Logic

Same priority pattern as Developer, applied to `qa` pipelines:

1. **BLOCK_FOR_REWORK_LIMIT**: check for WP rework limit
2. **RESUME_OR_CANCEL**: stale QA pipeline
3. **WAIT_FOR_REWORK**: most recent QA pipeline is FAIL — QA cannot act; Developer must fix and re-pass implementation first
4. **RUN_QA**: WP with PASS implementation and no QA yet, OR `hasNewUpstreamPassSince("implementation", "qa")` — Developer re-passed after previous QA

### 14.4 Reviewer Action Logic

Same pattern, applied to `code-review` pipelines:

1. **BLOCK_FOR_REWORK_LIMIT**
2. **RESUME_OR_CANCEL**: stale code-review pipeline
3. **WAIT_FOR_REWORK**: most recent code-review is FAIL — Reviewer cannot act; Developer must fix and re-pass implementation + QA first
4. **RUN_REVIEW**: WP with PASS QA and no review yet, OR `hasNewUpstreamPassSince("qa", "code-review")`

### 14.5 Documentation Action Logic

Same pattern, applied to `documentation` pipelines:

1. **BLOCK_FOR_REWORK_LIMIT**
2. **RESUME_OR_CANCEL**: stale documentation pipeline
3. **REWORK**: most recent documentation is FAIL (rework action = REWORK — Documentation self-reworks)
4. **WRITE_DOCS**: WP with PASS code-review and no docs yet, OR `hasNewUpstreamPassSince("code-review", "documentation")`

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
  
  // Find most recent downstream pipeline (any status)
  downstreamLatest = pipelines
    .filter(p => p.type == downstreamType)
    .last()
  
  if downstreamLatest is null:
    return true               // First run — trigger
  
  // Both timestamps must be present
  if upstreamPass.completed_at is null OR downstreamLatest.started_at is null:
    log warning: "Missing timestamp in pipeline comparison for WP {wp.id}; "
                 + "defaulting to false (no rework trigger). "
                 + "This indicates a data integrity issue."
    return false              // Conservative: don't trigger without timestamps
  
  // Upstream completed AFTER downstream started → rework cycle
  return upstreamPass.completed_at > downstreamLatest.started_at
```

> **Implementation note:** Since `started_at` is always set at pipeline creation and `completed_at` is always set at pipeline completion, a null timestamp here indicates a data integrity issue (e.g., interrupted write, manual file edit). Implementations SHOULD emit a project comment of type `"warning"` when this occurs, so that the PM has visibility into the anomaly.

### 14.7 `isMostRecentPipelineFail` Algorithm

```
function isMostRecentPipelineFail(pipelines, pipelineType):
  matching = pipelines.filter(p => p.type == pipelineType)
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
