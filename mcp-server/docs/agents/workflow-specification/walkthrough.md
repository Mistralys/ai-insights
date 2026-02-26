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
   - Handoff note created: QA → Reviewer
   
9. Reviewer starts code-review pipeline (ledger_start_pipeline type=code-review)
   - WP.assigned_to = "Reviewer"
   
10. Reviewer completes review (ledger_complete_pipeline type=code-review status=PASS)
    - Handoff note created: Reviewer → Documentation
    
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

---

## Appendix A: Constant Reference

| Constant | Default Value | Description |
|----------|--------------|-------------|
| `STALE_PIPELINE_HOURS` | 24 | Hours before a pipeline is considered stale |
| `MAX_REWORK_COUNT` | 5 | Maximum rework cycles before circuit breaker |
| `MAX_HANDOFF_DEPTH` | 50 | Static floor for auto-handoff chain depth (runtime-configurable). Effective max = `max(50, total_work_packages × 20)` — see [§18.2.1](auxiliary-systems.md#1821-dynamic-effective-maximum) |

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
| `WRITE_DOCS` | Documentation | WP needs documentation |
| `REWORK` | Developer/Documentation | Most recent pipeline FAIL (direct self-rework), or downstream pipeline FAIL routed to this agent (downstream-triggered rework — Developer only, see §14.2) |
| `WAIT_FOR_REWORK` | QA/Reviewer | Most recent pipeline FAIL AND no upstream re-pass detected (`hasNewUpstreamPassSince` is false); another agent must fix first |
| `WAIT` | Any | No actionable work available |
| `RESUME_OR_CANCEL` | Any | Stale pipeline detected; decide whether to resume or cancel |
| `BLOCK_FOR_REWORK_LIMIT` | Any pipeline owner | Per-pipeline rework limit reached; requires human intervention |
| `CONTINUE_PIPELINE` | Any pipeline owner | Active (non-stale) IN_PROGRESS pipeline exists for this agent's pipeline type; continue current work |
| `CLAIM_WP` | Any pipeline owner | READY WP available to claim (dependencies satisfied, unassigned or assigned to this agent) |
| `FINALIZE_WP` | Documentation | Documentation pipeline PASS, all acceptance criteria met, freshness check passed; mark WP as COMPLETE |
| `UPDATE_CRITERIA` | Documentation | Documentation pipeline PASS and freshness check passed, but acceptance criteria not fully met; update criteria, rework documentation, or escalate via BLOCKED with `technical` blocker (§21.24) |

## Appendix C: Error Conditions Summary

| Operation | Error Condition | Description |
|-----------|----------------|-------------|
| Initialize | Ledger exists | Cannot re-initialize an existing project |
| Create WP | Dependency not found | Referenced WP ID does not exist |
| Create WP | Dependency cycle | Adding these dependencies would create a circular dependency |
| Create WP | Empty criteria | At least one acceptance criterion required |
| Claim WP | Wrong status | WP must be READY |
| Claim WP | Dependencies not met | All deps must be terminal |
| Claim WP | Assigned to other | Override required (PM or assignee only) |
| Start Pipeline | WP not IN_PROGRESS | Pipeline requires active WP |
| Start Pipeline | Duplicate IN_PROGRESS | Same type already active |
| Start Pipeline | Prerequisite not met | Previous stage must be PASS |
| Start Pipeline | Missing agent role | `agentRole` parameter is required |
| Start Pipeline | Wrong agent role | Agent doesn't own this pipeline type (PM override allowed) |
| Start Pipeline | Re-validation needed | Prerequisite must re-PASS after upstream rework |
| Start Pipeline | Rework limit | Circuit breaker engaged |
| Complete Pipeline | No IN_PROGRESS pipeline | Nothing to complete |
| Complete Pipeline | Missing agent role | `agentRole` parameter is required |
| Complete Pipeline | Wrong agent role | Agent doesn't own this pipeline type (PM override allowed) |
| Unclaim WP | Active pipelines | Cannot unclaim WP with IN_PROGRESS pipelines |
| Unclaim WP | Wrong agent | Only PM or current assignee can unclaim |
| Update Status | Invalid transition | State machine violation |
| Update Status | Criteria not met | COMPLETE requires all criteria met |
| Update Status | Pipeline not passed | COMPLETE requires most recent documentation pipeline PASS |
| Update Status | Wrong agent | Only specific agents for specific transitions |
| Update Status | Missing blocker | BLOCKED requires blocked_by object |
| Update Status | Wrong agent (BLOCKED→BLOCKED) | Only PM or current assignee can modify blockers |
| Detect Project | Not found | No project matches the given path |
| Detect Project | Ambiguous | Multiple projects match |
| Complete Synthesis | WPs pending | Cannot complete synthesis while work packages are still pending |
| Complete Synthesis | No WPs | Cannot complete synthesis with zero work packages |
| Complete Synthesis | Wrong agent | Only Synthesis agent (or PM override) can complete synthesis |
