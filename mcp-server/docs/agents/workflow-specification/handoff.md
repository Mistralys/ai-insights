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

```pseudocode
// FAIL conditions first (§13.2 short-circuit semantics)
// Temporal guard: only signal rework when the downstream agent has re-engaged
// since the Developer's latest fix (hasDownstreamReengagedSince §14.13).
// Without this, auto-handoff stalls after Developer delivers a fix — the handoff
// returns IN_PROGRESS (Developer "must rework") while getNextAction returns
// WAIT_FOR_DOWNSTREAM, preventing any agent from being routed to QA.
if any non-terminal, non-dependency-blocked WP has a FAIL routed to Developer
   AND hasDownstreamReengagedSince(wp.pipelines, "implementation") is true:
  // Downstream validated the current fix and FAILed again — Developer must rework
  return IN_PROGRESS               (Developer must rework)
if any non-terminal, non-dependency-blocked WP needs QA:
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

```pseudocode
// Re-engagement check (before FAIL short-circuit — see rationale below)
// If QA previously FAILed but Developer has since re-PASSed implementation,
// QA should re-engage rather than routing back to Developer.
if any non-terminal, non-dependency-blocked WP has a FAIL QA pipeline
   AND hasNewUpstreamPassSince(wp.pipelines, "implementation", "qa") is true:
  return IN_PROGRESS             (QA should re-engage after upstream rework)

// FAIL conditions (§13.2 short-circuit semantics)
// Only reached when upstream has NOT re-PASSed since the QA FAIL.
if any non-terminal, non-dependency-blocked WP has a FAIL QA pipeline routed to Developer:
  return READY_FOR_DEVELOPER     (Developer must rework)

// Dynamic next-stage routing after PASS QA
// nextAgent = resolveNextAgent("qa", wp.active_pipeline_stages)
//   → "Security Auditor" when security-audit is active, "Reviewer" otherwise
if WPs with PASS QA but next stage not started:
  if all such WPs are dependency-blocked:
    return WAIT                  (nothing actionable until dependencies resolve)
  else:
    return readyStatusForAgent[nextAgent]  (READY_FOR_SECURITY_AUDIT or READY_FOR_REVIEW)
if all WPs are terminal (COMPLETE or CANCELLED):
  return READY_FOR_SYNTHESIS
if any WP is IN_PROGRESS with assigned_to == "QA":
  return IN_PROGRESS             (QA has active work)
return WAIT                      (no actionable work for QA)
```

> **Re-engagement before FAIL rationale (v1.2.0):** Prior to v1.2.0, the QA handoff's FAIL check short-circuited before considering whether the Developer had already reworked. After `qa-1 FAIL → impl-2 PASS`, the handoff returned `READY_FOR_DEVELOPER`, but the Developer's `getNextAction` returned `WAIT_FOR_DOWNSTREAM`. In auto-handoff orchestration, nobody was routed to QA. The re-engagement check (using `hasNewUpstreamPassSince`) now fires first: if the Developer has re-PASSed since the QA FAIL, the handoff returns `IN_PROGRESS` for QA (mirroring §14.3 priority 4), allowing auto-handoff to keep QA in the loop.

#### Reviewer Handoff

```pseudocode
// Re-engagement check (before FAIL short-circuit — see QA handoff rationale)
// If Reviewer previously FAILed but the effective upstream has since re-PASSed,
// Reviewer should re-engage rather than routing back to Developer.
// effectiveUpstream = resolvePrerequisite("code-review", wp.active_pipeline_stages)
//   → "security-audit" when active, "qa" otherwise
if any non-terminal, non-dependency-blocked WP has a FAIL code-review pipeline
   AND hasNewUpstreamPassSince(wp.pipelines, effectiveUpstream, "code-review") is true:
  return IN_PROGRESS             (Reviewer should re-engage after upstream rework)

// FAIL conditions (§13.2 short-circuit semantics)
// Only reached when upstream has NOT re-PASSed since the review FAIL.
if any non-terminal, non-dependency-blocked WP has a FAIL code-review pipeline routed to Developer:
  return READY_FOR_DEVELOPER     (Developer must rework)

// Dynamic next-stage routing after PASS code-review
// nextAgent = resolveNextAgent("code-review", wp.active_pipeline_stages)
//   → "Release Engineer" when release-engineering is active, "Documentation" otherwise
if WPs with PASS code-review but next stage not started:
  if all such WPs are dependency-blocked:
    return WAIT                  (nothing actionable until dependencies resolve)
  else:
    return readyStatusForAgent[nextAgent]  (READY_FOR_RELEASE_ENGINEERING or READY_FOR_DOCS)
if all WPs are terminal (COMPLETE or CANCELLED):
  return READY_FOR_SYNTHESIS
if any WP is IN_PROGRESS with assigned_to == "Reviewer":
  return IN_PROGRESS             (Reviewer has active work)
return WAIT                      (no actionable work for Reviewer)
```

> **Re-engagement before FAIL rationale (v1.2.0):** Identical to the QA handoff rationale. After `review-1 FAIL → impl-2 PASS → qa-2 PASS`, the handoff now returns `IN_PROGRESS` for Reviewer (re-engagement) instead of `READY_FOR_DEVELOPER` (stale FAIL routing). See QA Handoff rationale for the full explanation.
>
> **Dynamic upstream (v2.0.0):** The re-engagement check uses `resolvePrerequisite("code-review", wp.active_pipeline_stages)` to determine the effective upstream — `"security-audit"` when the WP includes the optional security-audit stage, `"qa"` otherwise. Similarly, the next-stage routing uses `resolveNextAgent` to determine whether PASS code-review flows to Release Engineer or Documentation.

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

return WAIT
```

> **Self-rework pattern:** Release Engineer follows the same self-rework pattern as Documentation — release-engineering FAIL routes to Release Engineer itself (§9.3). Escalation for code-level issues uses the BLOCKED mechanism with a `technical` blocker, identical to the Documentation escalation path (§21.24).

> **Upstream catch-all removed (v2.0.0):** Prior versions included a catch-all `READY_FOR_DEVELOPER` for WPs awaiting earlier pipeline stages. This was removed because the Release Engineer cannot accurately dispatch to the correct upstream agent — a WP awaiting `code-review` would be misrouted to Developer instead of Reviewer, causing the auto-handoff chain to terminate at Developer → WAIT. The orchestrator's hub-and-spoke polling (or the supervisor) is responsible for routing WPs to the correct upstream agent.

#### Documentation Handoff

```pseudocode
// WPs ready for documentation — the effective upstream stage is determined
// dynamically: "release-engineering" if active, otherwise "code-review".
readyForDocs = non-terminal WPs where hasPassEffectiveUpstream AND (
  no documentation pipeline yet OR hasNewUpstreamPassSince(effectiveUpstream, "documentation")
)
// Where effectiveUpstream = resolvePrerequisite("documentation", wp.active_pipeline_stages)
// Where hasPassEffectiveUpstream = most recent pipeline of effectiveUpstream type is PASS
if readyForDocs is not empty:
  if all readyForDocs are dependency-blocked:
    skip                           (fall through to check earlier-stage WPs)
  else:
    return IN_PROGRESS             (Documentation continues documenting)

// Documentation FAIL → self-rework (not forwarded to Developer)
if any non-terminal, non-dependency-blocked WP has FAIL documentation pipeline (most recent):
  return IN_PROGRESS               (Documentation self-reworks)

// WPs still in earlier pipeline stages — defer to orchestrator polling
// (Documentation cannot dispatch to the correct upstream agent;
//  returning READY_FOR_DEVELOPER would misroute WPs needing QA/Reviewer/etc.)
if all WPs are terminal:
  return READY_FOR_SYNTHESIS

return WAIT
```

> **Upstream catch-all removed (v2.0.0):** Same rationale as the Release Engineer handoff — the Documentation agent cannot accurately dispatch to the correct upstream agent. WPs needing earlier-stage work are left for the orchestrator to route via polling.

#### Synthesis Handoff

```pseudocode
// Synthesis is the terminal stage — no onward routing
return WAIT   // Chain terminates; project COMPLETE status is the orchestrator's stop signal
```

> **Design note:** The Synthesis agent's handoff always returns `WAIT`. After `completeSynthesis` (§19.1) sets the project to `COMPLETE`, no further handoff is evaluated (§18.6 skips auto-handoff for `COMPLETE` status). This block exists for completeness — implementations that enumerate all agent handoff functions will not encounter a null/undefined case for Synthesis.

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
    // Unassigned: route to Developer (first pipeline owner in workflow)
    return READY_FOR_DEVELOPER

// All WPs terminal
if all WPs have terminal status:
  return READY_FOR_SYNTHESIS

// WPs are in-flight (IN_PROGRESS or dependency-BLOCKED) — no PM action needed
return WAIT
```

> **`readyStatusForAgent` mapping:** Maps agent role to handoff status: `"Developer"` → `READY_FOR_DEVELOPER`, `"QA"` → `READY_FOR_QA`, `"Security Auditor"` → `READY_FOR_SECURITY_AUDIT`, `"Reviewer"` → `READY_FOR_REVIEW`, `"Release Engineer"` → `READY_FOR_RELEASE_ENGINEERING`, `"Documentation"` → `READY_FOR_DOCS`. Unknown roles fall back to `READY_FOR_DEVELOPER`.

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
