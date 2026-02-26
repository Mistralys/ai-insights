# Workflow Specification Audit

> **Date:** 2026-02-26  
> **Subject:** [workflow-specification.md](workflow-specification.md) v1.0.0  
> **Verdict:** No infinite-loop deadlocks found. Routing is deterministic and generally well-structured. Three critical issues, four moderate, and three minor findings.

> **Resolution (2026-02-26):** All 10 issues listed below were addressed in [workflow-specification.md](workflow-specification.md) v1.1.0. This document is retained as a historical audit record.

---

## Critical Issues

### 1. Counter Self-Healing Gap: READY → COMPLETE path missing (§14.1)

The healing rules can transition BLOCKED → READY (rule 2) but there is no READY → COMPLETE rule.

**Scenario:**
- Project status: `BLOCKED`, all WPs: `COMPLETE`, `synthesis_generated: true`
- Rule 2 fires: no WP is BLOCKED → heals to `READY` (since `pendingWps == 0`)
- Next healing pass: status is `READY` — **no rule matches**. Rule 1 needs a WP `IN_PROGRESS`; Rule 3 requires status `IN_PROGRESS`.
- Project **permanently stuck in READY** despite meeting all completion conditions.

**Fix:** Add a healing rule: `IF status == READY AND pendingWps == 0 AND totalWps > 0 AND synthesis_generated → COMPLETE`. Or generalize Rule 3 to cover both `IN_PROGRESS` and `READY`.

### 2. Documentation Handoff Routes FAIL to Wrong Agent (§21.8 vs §9.3)

§21.8 says Documentation handoff "mirrors Reviewer handoff" with "Backward: `READY_FOR_DEVELOPER`". But per the Fail Routing Map (§9.3), documentation failures route to **Documentation** (self-rework), not Developer.

**Consequence:**
- All remaining non-blocked WPs have FAIL documentation pipelines
- Handoff returns `READY_FOR_DEVELOPER`
- Developer has no logic to handle documentation failures
- Supervisor's `route_for_wp` (§11.2) correctly routes `doc == FAIL → Documentation`, so the **Supervisor** handles this right, but the **handoff status API** gives incorrect guidance

The inconsistency between §11.2 (correct) and §21.8 (incorrect) means consumers of `get_handoff_status` get wrong routing for this case.

**Fix:** Documentation handoff Branch 3 (FAIL equivalent) should return `IN_PROGRESS` (self-rework), not `READY_FOR_DEVELOPER`.

### 3. Auto-Unblock Ignores Non-Dependency Blockers (§12.2)

`propagateDependencyUnblock` only checks whether all WP dependencies are satisfied — it does not inspect `blocked_by.type`.

**Scenario:**
- WP-002: `BLOCKED`, `blocked_by: { type: "external", description: "waiting for API key" }`, `dependencies: ["WP-001"]`
- WP-001 transitions to `COMPLETE`
- Auto-unblock: all deps satisfied → WP-002 transitions to `READY`
- **External blocker silently cleared** despite being unresolved

**Fix:** `propagateDependencyUnblock` should only clear `blocked_by` and transition to `READY` when `blocked_by.type == "dependency"`, or when `blocked_by` is absent. Non-dependency blockers should be preserved.

---

## Moderate Issues

### 4. Supervisor Routes to Synthesis Prematurely via "Mixed State" (§11.1)

The check `IF all WPs are COMPLETE → Synthesis` only matches `COMPLETE`, not `CANCELLED`. A project with `WP-001=COMPLETE, WP-002=CANCELLED` falls through to "mixed state → Synthesis." While this **happens to work** (Synthesis checks terminal status properly), the routing is imprecise and relies on a fallthrough path for a normal scenario.

**Fix:** Change to `IF all WPs are terminal (COMPLETE or CANCELLED) → Synthesis`.

### 5. Auto-Handoff Eligibility Uses Ambiguous "Project Status" (§15.5)

> "Project status is not `COMPLETE`, `BLOCKED`, or `IN_PROGRESS` (only handoff statuses are eligible)"

This is contradictory — excluding `IN_PROGRESS` from project status eliminates the only state where agents are actively working. The condition almost certainly refers to **handoff status** values (§21.1), not `ProjectStatus` enum values. As written, auto-handoff would only be eligible when project status is `READY`, which is pre-work.

**Fix:** Clarify this refers to handoff status, not project status. Likely intended meaning: auto-handoff is eligible when handoff status is one of the `READY_FOR_*` values (not `COMPLETE`, `BLOCKED`, `IN_PROGRESS`, or `WAIT`).

### 6. Planner Handoff Skips PM (§21.3)

```
IF any WP is READY or IN_PROGRESS:
    → READY_FOR_DEVELOPER
```

Per §4, the Planner creates the plan and the PM creates WPs. The Planner's natural successor is PM, not Developer. There is no `READY_FOR_PM` handoff status in §21.1, so there's no way to express Planner → PM routing within the handoff system.

**Fix:** Either add `READY_FOR_PM` as a handoff status, or explicitly route Planner handoff to PM when the plan exists but no WPs have been created yet.

### 7. Circuit Breaker Trigger Condition Undefined (§11.3)

The Supervisor increments `consecutive_failures[wp_id]` on `stage_success == false`, but the spec never defines what determines `stage_success`. Is it based on pipeline status? Agent timeout? No pipeline started? An agent that is routed to a WP but makes no progress (no pipeline started, no error) leaves `stage_success` undefined.

**Fix:** Define `stage_success` explicitly — e.g., "A stage is successful if at least one pipeline was completed with status `PASS` during the agent's turn."

---

## Minor Issues

### 8. Editorial Note Left in Walkthrough (§19.2)

The QA Failure walkthrough contains a draft note that was never cleaned up:

> `└─ Wait — this is wrong. The Developer would start a new implementation pipeline.`

This is confusing for readers and should be removed or turned into a proper explanation.

### 9. Planner Next-Action Fallthrough (§20.7)

If WPs exist but aren't all terminal, the pre-routing checks pass through to agent-specific routing, but there is no Planner-specific section in §20.2–§20.6. The Planner would either silently return `WAIT` or hit an undefined code path. This should be explicit.

### 10. Vacuous Unblocking of Non-Dependency Blockers (§6.2)

`BLOCKED → READY` requires "All dependencies COMPLETE or CANCELLED." If a WP is blocked for a non-dependency reason (e.g., `type: "decision"`) and has **no** WP dependencies, this condition is vacuously true. Combined with issue #3, a PM could manually trigger this transition even though the actual blocker isn't resolved. This overlaps with issue #3 but applies to the manual transition path as well.

---

## Summary Table

| # | Severity | Section | Issue |
|---|----------|---------|-------|
| 1 | **Critical** | §14.1 | Self-healing can't reach COMPLETE from READY |
| 2 | **Critical** | §21.8 | Doc FAIL handoff routes to Developer instead of self |
| 3 | **Critical** | §12.2 | Auto-unblock ignores non-dependency blocker types |
| 4 | Moderate | §11.1 | "all COMPLETE" should be "all terminal" |
| 5 | Moderate | §15.5 | "Project status" vs "handoff status" ambiguity |
| 6 | Moderate | §21.3 | Planner → Developer handoff skips PM |
| 7 | Moderate | §11.3 | `stage_success` never defined |
| 8 | Minor | §19.2 | Editorial note left in walkthrough |
| 9 | Minor | §20.7 | Planner fallthrough undefined |
| 10 | Minor | §6.2 | Vacuous unblocking for non-dependency blockers |
