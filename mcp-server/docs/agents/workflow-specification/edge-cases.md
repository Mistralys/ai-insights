# Edge Cases & Invariants

> Part of the [Agent Workflow Specification](README.md).

---

## 21. Edge Cases & Invariants

### 21.1 Terminal Status Invariants

- `CANCELLED` is strictly terminal — no outward transitions allowed
- `COMPLETE` is *normally terminal* but may be reopened to `IN_PROGRESS` by PM or Documentation (see [§6.2](state-machines.md#62-transition-table))
- Both `COMPLETE` and `CANCELLED` satisfy dependency requirements
- `isTerminalStatus()` returns `true` for both `COMPLETE` and `CANCELLED` for dependency checks and counter calculations

### 21.2 Empty Project

- A project with zero WPs is never auto-healed to `COMPLETE`
- `getNextAction` with no WPs returns `CREATE_WORK_PACKAGES` for PM, `WAIT` for others

### 21.3 Acceptance Criteria

- At least one acceptance criterion is required when creating a WP
- Empty `acceptance_criteria` array is rejected
- `IN_PROGRESS → COMPLETE` requires ALL criteria to have `met: true`
- Unknown criteria text in updates is **appended** (not rejected)

### 21.4 Revision Counter

- Starts at 0 (or default initial value)
- Incremented **only** on `COMPLETE → IN_PROGRESS` transition
- Not incremented on any other transition
- On `COMPLETE → IN_PROGRESS`, `rework_counts` is also reset to absent (cleared) — see [§21.44](#2144-rework-count-reset-on-wp-reopen) for rationale

### 21.5 Pipeline Comment Agent Inference

- Pipeline-level comments do **not** have an explicit `agent` field
- Agent is inferred from the pipeline type via `PIPELINE_AGENT_MAP`
- Project-level comments **do** have an explicit `agent` field
- **Limitation:** In rework scenarios, the inferred agent is always the pipeline owner (e.g., "Developer" for `implementation`) regardless of which agent's feedback prompted the rework. Consumers should use handoff notes for cross-agent rework context.

### 21.6 Incident Comments

- Project comments with `type: "incident"` **require** a `context` object
- Context must include: `os`, `tool`, `resolved` (boolean)
- Optional: `work_package`, `workaround`

### 21.7 Metrics Extensibility

- The `metrics` object on pipelines is extensible (key-value map with predefined optional fields)
- Known fields: `test_coverage`, `tests_passed`, `tests_failed`, `security_issues`
- Additional arbitrary fields are accepted

### 21.8 Timestamps

- All timestamps use UTC ISO 8601 format: `YYYY-MM-DDTHH:MM:SSZ`
- Legacy formats accepted for reading: `YYYY-MM-DD HH:MM:SS`, `YYYY-MM-DDTHH:MM:SS` (no Z)

### 21.9 WP Summary ↔ Detail Consistency

- WP summaries in the root index are a **subset** of WP detail data
- Summaries must always match corresponding detail files
- Dual-file atomic updates enforce this invariant
- Fields that must stay in sync: `work_package_id`, `status`, `assigned_to`, `dependencies`

### 21.10 Documentation-Only COMPLETE Guard

Only the Documentation agent can mark a WP as COMPLETE. Additionally, the most recent `documentation` pipeline must have PASS status, **and** that PASS must post-date the most recent `implementation` pipeline's `started_at` timestamp. This freshness check prevents a stale documentation PASS (from before a WP reopen) from satisfying the COMPLETE guard. Together these enforce the full pipeline chain:
```
Developer → QA → Reviewer → Documentation → COMPLETE
```
No agent can skip stages, Documentation cannot mark COMPLETE without having completed its own pipeline successfully, and a WP reopen invalidates any prior documentation PASS.

> **Absent implementation pipeline:** If no `implementation` pipeline exists on the WP (which would require bypassing the normal pipeline ordering — see §8.1), the freshness check passes vacuously. The guard's purpose is to detect stale documentation after a WP reopen; without an implementation pipeline, there is no reopen reference point to compare against. Implementations MAY treat this as an invariant violation and reject the transition, but the core specification does not require it.

### 21.11 Transition to BLOCKED Requires Blocker

Any transition to `BLOCKED` must provide a `blocked_by` object. Transitions to BLOCKED without a reason are rejected.

### 21.12 Auto-Unblock Clears blocked_by

Both `BLOCKED → IN_PROGRESS` and `BLOCKED → READY` automatically clear the `blocked_by` field.

### 21.13 Unclaim (IN_PROGRESS → READY)

- Transition requires no IN_PROGRESS pipelines on the WP
- Allowed agents: Project Manager or current assignee (`wp.assigned_to`)
- Clears `assigned_to` (WP becomes unassigned)
- Does not affect `pending_work_packages` counter (both states are non-terminal)
- Use case: agent claimed the wrong WP, or PM reassigning before pipeline work begins

### 21.14 Direct Cancellation from COMPLETE

- `COMPLETE → CANCELLED` is allowed for Project Manager only
- This is a terminal-to-terminal transition: no counter change, no revision increment, no cascade reblock
- CANCELLED satisfies dependencies identically to COMPLETE, so downstream WPs remain unaffected
- Use case: feature rollback, or WP output determined to be unnecessary after completion

### 21.14b Pipeline Cancellation on WP Cancellation

- When a WP transitions `IN_PROGRESS → CANCELLED`, any IN_PROGRESS pipelines on the WP are set to FAIL with `auto_cancelled = true`, mirroring the `IN_PROGRESS → BLOCKED` behavior (§6.2)
- Without this, a cancelled WP could retain orphaned IN_PROGRESS pipelines that can never be completed (the WP is terminal)
- The `auto_cancelled` flag ensures these pipeline closures do not consume the rework budget (§21.27)
- `READY → CANCELLED` does not require this step — a READY WP cannot have IN_PROGRESS pipelines (pipeline creation requires WP status IN_PROGRESS per §11.1)

### 21.15 Cascade Reblock Warning for COMPLETE Dependents

- When a COMPLETE WP is reopened (COMPLETE → IN_PROGRESS), dependent WPs that are themselves COMPLETE are **not** reblocked (see [§15.5](dependencies-and-rework.md#155-cascade-reblocking-propagatedependencyreblock))
- Instead, a high-priority `warning` project comment is emitted for each such WP
- The Project Manager is responsible for reviewing these warnings and deciding whether to reopen the downstream WPs
- This avoids destructive cascading state changes while still surfacing the potential inconsistency

### 21.16 Per-Pipeline Rework Counts

- The `rework_counts` map tracks rework cycles independently per pipeline type
- Documentation self-rework does not consume the implementation rework budget
- Downstream-triggered rework (e.g., QA fails → Developer restarts implementation) increments the **pipeline type being started** (implementation), not the pipeline that failed (qa)
- In a QA-fail rework chain, both `rework_counts.implementation` and `rework_counts.qa` increment per cycle — each counter independently tracks how many times that pipeline type has been retried (see [§11.2](operations.md#112-rework-count-semantics))
- Legacy `rework_count` scalar is migrated to `rework_counts.implementation` on first write

### 21.17 BLOCKED → BLOCKED Blocker Replacement

- When transitioning BLOCKED → BLOCKED, the new `blocked_by` replaces the existing one
- The transition requires the agent to be the **Project Manager** or the **current assignee** (`wp.assigned_to`) — see [§21.47](#2147-blocked--blocked-agent-guard) for the rationale
- A `dependency` blocker **cannot** be overwritten with a non-dependency type **unless the agent is the Project Manager** — this preserves auto-unblock eligibility for non-PM transitions while giving the PM an escape hatch for recording additional blockers discovered after initial blocking
- When a PM overwrites a `dependency` blocker with a non-dependency type, the `dependency` auto-unblock will no longer fire for that WP — the PM accepts responsibility for managing this
- All other blocker-type changes are allowed
- Use case: PM re-classifies a blocker (e.g., `technical` → `decision`) without unblocking first
- **Known latency — non-dependency → dependency re-classification:** If an assignee changes a WP's blocker from a non-dependency type (e.g., `technical`) to `dependency` *after* the referenced dependency WP has already reached terminal status, no auto-unblock fires. `propagateDependencyUnblock` (§15.4) is event-driven — it triggers when a dependency WP transitions to terminal, not on blocker re-classification. The WP remains BLOCKED until the PM detects it via `REPAIR_ORPHAN_BLOCKED` ([§21.20](#2120-cascade-lock-gap-recovery)) or manually unblocks. Implementations that need immediate auto-unblock on re-classification MAY invoke `propagateDependencyUnblock` as a side effect of the BLOCKED → BLOCKED transition when the new blocker type is `dependency`

### 21.18 Null Timestamp Data Integrity

- `started_at` is always set at pipeline creation; `completed_at` is always set at pipeline completion
- If either is null in a context where it should be present (e.g., `hasNewUpstreamPassSince`), this indicates a data integrity issue
- Implementations SHOULD emit a project comment of type `"warning"` when a null timestamp is encountered
- The system fails safe (returns `false` / does not trigger rework), but the anomaly must be surfaced for investigation
- **Progress-blocking risk:** The `false` default in `hasNewUpstreamPassSince` (§14.6) means a null timestamp causes the downstream agent (QA, Reviewer, Documentation) to receive `WAIT_FOR_REWORK` indefinitely — even if the upstream agent has already completed rework. This is the safer direction for data integrity (avoiding premature re-engagement on stale data) but it blocks progress until the timestamp is repaired
- **Recommended mitigation:** The PM's `REVIEW_STALE` / `REVIEW_ABANDONED` actions (§14.1.2) will eventually surface the idle WP. Implementations SHOULD additionally detect the null-timestamp condition during `getNextAction` and emit a specific `REPAIR_TIMESTAMPS` PM action so the anomaly is addressed promptly rather than waiting for the staleness threshold

### 21.19 Stale Pipeline Detection Limitations

- Stale detection fires via `getNextAction` for the pipeline's owning agent role (§14.2–§14.5, priority 2) **and** via the Project Manager's `REVIEW_STALE` action (§14.1.2, priority 3). The PM provides a cross-role safety net — if no agent of the correct role queries, the PM can still detect stale pipelines
- However, if *neither* the owning agent nor the PM queries `getNextAction`, a stale pipeline is never detected
- The 24-hour threshold means up to 23 hours of idle time if an agent crashes early in a pipeline
- Implementations may optionally expose a PM "check stale now" action to mitigate this gap

### 21.20 Cascade Lock Gap Recovery

- If a process crashes between the main update lock release and cascade lock acquisition, WP-level state may be inconsistent
- Cascade functions are idempotent — re-invoking them with the same arguments repairs the state
- Implementations SHOULD detect orphaned BLOCKED WPs (all dependencies terminal, blocker type is `dependency`) during `getNextAction` and either auto-repair or surface as a PM action

### 21.21 BLOCKED → IN_PROGRESS Agent Guard

- Manual `BLOCKED → IN_PROGRESS` transitions require the agent to be the Project Manager, the current assignee (`wp.assigned_to`), or the system (auto-repair path)
- This prevents arbitrary agents from unblocking WPs stuck on PM-owned blockers (`decision`, `external`, `technical`)
- `BLOCKED → READY` (the auto-unblock path from §15.4) remains system-only and has no manual agent guard

### 21.22 Re-Validation Guard on Pipeline Start

- When starting a pipeline, the system verifies that the prerequisite pipeline PASSed **after** the most recent effective run of the current pipeline type (if any — excluding auto-cancelled pipelines per §21.27), regardless of whether that most recent run was PASS or FAIL
- This prevents skipping intermediate validation stages after upstream rework (e.g., starting `code-review` with a stale QA PASS that validated an older implementation — even when the last `code-review` itself FAILed)
- The temporal baseline uses `effectiveSamePipelines` (filtered to exclude auto-cancelled) rather than all pipelines of the same type. This ensures an auto-cancelled pipeline's timestamp does not shift the comparison, consistent with the §21.27 invariant that auto-cancelled pipelines are excluded from quality-related decisions
- The guard uses `hasDownstreamFail(pipelines, prerequisite)` — checking downstream of the *prerequisite* type — to detect whether re-validation is actually needed. The argument is `prerequisite` (not `pipelineType`) because `getDownstreamTypes(prerequisite)` includes the current pipeline type itself, allowing the guard to detect a FAIL of the current type (e.g., review-1 FAIL when starting code-review with prerequisite qa). If no pipeline downstream of the prerequisite has FAILed, the existing prerequisite PASS is considered valid
- **Upstream activity check:** After detecting a temporal gap and a downstream FAIL, the guard additionally verifies that at least one pipeline upstream of the current type (via `getUpstreamTypes` §8.5) was started after the prerequisite PASSed. If no upstream activity occurred, the prerequisite is still valid and the guard does not fire. This prevents false positives during self-rework — e.g., documentation retrying after its own FAIL would otherwise be blocked because `hasDownstreamFail("code-review")` returns true for the documentation FAIL itself, even though no upstream rework invalidated the code-review PASS
- Complements the recommendation engine's `hasNewUpstreamPassSince` logic (§14.6) with a hard enforcement gate

### 21.23 Mandatory Agent Role on Pipeline Start

- The `agentRole` parameter is **required** when calling `startPipeline`
- The agent must match the pipeline owner defined in `PIPELINE_AGENT_MAP` (§9.1)
- **PM override:** The Project Manager may start any pipeline type (e.g., restarting a stale pipeline on behalf of an absent agent)
- This ensures pipeline ownership (§4.1) is enforced at the tool level, not just advised by the recommendation engine

### 21.24 Documentation FAIL Escalation

- When a documentation pipeline FAILs due to underlying code issues (not documentation quality), the Documentation agent should set the WP to BLOCKED with a `technical` blocker
- This surfaces the issue to the Project Manager via the UNBLOCK_WP action (§14.1.2)
- The `FAIL_ROUTING_MAP` routes documentation failures to Documentation (self-rework) by design — the blocker mechanism handles the exceptional case of code-caused documentation failures
- After the PM unblocks the WP, manual coordination is required to route work to the Developer — see [§21.43](#2143-post-technical-blocker-unblock-routing) for the expected PM workflow
- See [§9.3](pipeline-routing.md#93-fail_routing_map) for the routing map and escalation path

### 21.25 Recommendation Engine Priority Semantics

- In QA (§14.3) and Reviewer (§14.4) action logic, the `hasNewUpstreamPassSince` check (re-engagement after rework) is evaluated **before** the WAIT_FOR_REWORK check — this prevents short-circuiting on a stale FAIL when the upstream agent has already completed rework
- In Developer action logic (§14.2), downstream-triggered rework (QA/review FAIL where implementation is still PASS) is a separate priority from direct rework (most recent implementation is FAIL) — this ensures the Developer is told to rework even when the most recent implementation pipeline PASSed but a downstream pipeline FAILed
- In Developer handoff logic (§13.1), FAIL conditions for rework are checked before PASS conditions for next-stage handoff, consistent with the §13.2 short-circuit semantics invariant

### 21.26 Synthesis Generated Reset on WP Reopen

- When a COMPLETE WP is reopened (COMPLETE → IN_PROGRESS), the project-level `synthesis_generated` flag is reset to `false`
- This prevents a stale synthesis report from satisfying the project completion condition after rework
- Without this reset, self-healing rule 1 (§17.2) would auto-complete the project once the reworked WP re-completes — without the Synthesis agent re-running to incorporate the changes
- `propagateDependencyReblock` (§15.5) also resets `synthesis_generated` as a crash-recovery safety net
- After rework completes and all WPs are terminal, self-healing rule 1c preserves `IN_PROGRESS` (pending=0 but synthesis_generated=false), correctly requiring Synthesis to re-run

### 21.27 Auto-Cancelled Pipelines

- When a pipeline is cancelled by system automation (cascade reblock via §15.5, or manual IN_PROGRESS → BLOCKED transition via §6.2), the `auto_cancelled` flag is set to `true`
- Auto-cancelled pipelines are **excluded** from rework detection and circuit breaker calculations:
  - `hasDownstreamFail` (§11.3): filters out auto-cancelled pipelines
  - `isMostRecentPipelineFail` (§14.7): filters out auto-cancelled pipelines
  - `hasNewUpstreamPassSince` (§14.6): filters out auto-cancelled pipelines from downstream history
  - Rework detection in `startPipeline` (§11.1): uses filtered `effectiveSamePipelines` that excludes auto-cancelled
  - Re-validation guard in `startPipeline` (§11.1): uses filtered `effectiveSamePipelines` for the temporal baseline, ensuring auto-cancelled pipelines do not shift the comparison timestamp
- Auto-cancelled pipelines are **not** excluded from prerequisite checks — an auto-cancelled prerequisite still blocks the next stage (but the WP will typically be BLOCKED anyway after cascade reblock)
- This prevents external interruptions (dependency reopening, manual blocking) from consuming the per-pipeline rework budget (§16.2) intended for quality failures
- The `auto_cancelled` field is `false` or absent for all pipelines created by normal `startPipeline` flow; it is only set to `true` by system automation

### 21.28 All-Cancelled Project Synthesis

- A project where **all** WPs are CANCELLED (none COMPLETE) still proceeds through Synthesis and can reach COMPLETE
- This is intentional: the Synthesis agent’s role is to generate a final project report documenting outcomes, including documenting why all work was cancelled
- If this behavior is undesirable for a given implementation, it can be guarded by checking `root.work_packages.some(wp => wp.status == "COMPLETE")` before calling `completeSynthesis`. This guard is **not** part of the core specification to keep the state machine simple

### 21.29 Documentation FAIL Self-Referential Handoff

- When a documentation pipeline FAILs, the `FAIL_ROUTING_MAP` routes to Documentation (self-rework), producing a handoff note where `from_agent == to_agent == "Documentation"`
- This self-referential handoff note is intentional and serves as an audit trail:
  - It records the failure context (via `notes`) even when the same agent handles the rework
  - In multi-session workflows, a new Documentation agent instance benefits from the handoff notes left by the prior instance
  - The `getHandoffNotesForAgent` function (§14.10) will return these notes, giving the Documentation agent its own failure context when re-engaging
- Implementations that find self-referential notes noisy may optionally suppress them in UI display, but SHOULD preserve them in storage for auditability

### 21.30 Planner Handoff vs. Recommendation Disconnect

- The Planner handoff function (§13.1) returns `READY_FOR_PM` when no WPs exist, while `getNextAction` for the Planner role (§14.1.1) always returns `WAIT`
- This is intentional: the Planner operates **before** the ledger exists (it creates the plan document that the PM uses to initialize the ledger). The handoff function reflects the Planner’s view of project readiness ("PM should act next"), while `getNextAction` reflects available ledger-based actions (none for Planner)
- Implementations should not attempt to reconcile these two systems for the Planner role — the disconnect is a consequence of the Planner’s unique pre-ledger position in the workflow

### 21.31 Mandatory Agent Guard on Synthesis Completion

- The `completeSynthesis` function requires an `agentRole` parameter (added for parity with all other guarded transitions)
- Only the **Synthesis** agent (or **Project Manager** as override) can complete synthesis
- This prevents arbitrary agents from marking synthesis as complete, consistent with the enforcement philosophy applied to `→ COMPLETE` (Documentation only) and `→ CANCELLED` (PM only) WP transitions

### 21.32 CANCELLED Self-Transition Prohibition

- `CANCELLED → CANCELLED` is **not** a valid transition, even as a same-state no-op (see [§6.2](state-machines.md#62-transition-table))
- CANCELLED is strictly terminal with no outward transitions, including self-transitions
- This resolves the potential ambiguity between the general same-state rule ("always valid no-op") and the transition table ("Terminal — no outward transitions") in favor of the transition table
- Implementations should reject any `updateWorkPackageStatus` call that targets a CANCELLED WP, regardless of the requested target status

### 21.33 Active Pipeline Continuation

- When an agent calls `getNextAction` and has an active (non-stale) IN_PROGRESS pipeline of their owned type, the recommendation engine returns `CONTINUE_PIPELINE` (see §14.2–§14.5)
- `CONTINUE_PIPELINE` takes priority over rework and new-work recommendations (but not over rework-limit checks or stale-pipeline checks) — the agent should finish current work before context-switching
- In multi-session workflows where a new agent instance inherits an active pipeline from a prior instance, `CONTINUE_PIPELINE` provides explicit acknowledgment of the in-progress work
- The batch action system (§14.9) may return `CONTINUE_PIPELINE` for one WP alongside rework/new-work actions for other WPs, enabling the agent to see the full picture
- If upstream rework has occurred while the pipeline is active (detectable via `hasNewUpstreamPassSince`), the active pipeline may be validating stale results. The recommendation engine does not prescribe cancellation — the agent should evaluate whether to complete with FAIL and restart, or finish and re-validate

### 21.34 Documentation PASS to COMPLETE Finalization Gap

- After a documentation pipeline PASSes, the WP remains IN_PROGRESS until the Documentation agent explicitly calls `updateWorkPackageStatus(COMPLETE)`
- The `FINALIZE_WP` recommendation (§14.5) bridges this gap by advising the Documentation agent to mark the WP as COMPLETE when all conditions are satisfied (documentation PASS, all acceptance criteria met, freshness check passed)
- Without `FINALIZE_WP`, a Documentation agent that completes the documentation pipeline but forgets to update the WP status would leave the WP stranded in IN_PROGRESS with no further recommendations
- Self-healing (§17) does not catch this case because the WP is legitimately IN_PROGRESS — the gap is at the recommendation level, not the state level

### 21.35 Single Blocker Metadata Limitation

- The `blocked_by` field on WorkPackageDetail (§3.3) is a single `Blocker?` object, not an array
- When cascade reblock (§15.5) fires for multiple dependencies simultaneously, only the last-written blocker is preserved — earlier blockers are overwritten
- This does **not** affect correctness: `propagateDependencyUnblock` (§15.4) checks **all** dependencies regardless of the `blocked_by` text; a WP is only unblocked when every dependency is terminal
- However, the `blocked_by` metadata may not reflect the complete set of blocking dependencies, which reduces diagnostic visibility for the Project Manager
- Implementations that need full multi-blocker visibility may extend `blocked_by` to an array or maintain a separate blocker history log — this is an optional enhancement beyond the core specification

### 21.36 Agent Role Validation on Pipeline Completion

- The `completePipeline` function requires an `agentRole` parameter (§12.4), mirroring the existing guard on `startPipeline` (§11.1.2)
- Only the pipeline owner (per `PIPELINE_AGENT_MAP` §9.1) or the Project Manager (override) may complete a pipeline
- This prevents agents from completing pipelines they do not own, which could bypass the workflow's separation of concerns (e.g., a Developer completing a QA pipeline)
- The PM override enables operational recovery scenarios such as force-failing a stale pipeline on behalf of an absent agent

### 21.37 CLAIM_WP Recommendation for READY Work Packages

- All pipeline-owning agents (Developer, QA, Reviewer, Documentation) include `CLAIM_WP` as a final-priority recommendation for READY WPs (§14.2–§14.5)
- **Developer** sees `CLAIM_WP` for READY WPs that are either unassigned or assigned to "Developer" — this is the primary path for freshly created WPs
- **QA, Reviewer, Documentation** see `CLAIM_WP` only for READY WPs assigned to them — this covers the post auto-unblock scenario (§15.4), where a WP returns to READY with `assigned_to` preserved
- `CLAIM_WP` is always the lowest priority — rework, active pipelines, and new pipeline starts all take precedence
- The claiming operation (`claimWorkPackage` §10.1) still enforces all its own guards (status check, assignment check, dependency check), so the recommendation is advisory

### 21.38 Synthesis Staleness After COMPLETE → CANCELLED

- When a WP transitions `COMPLETE → CANCELLED` (§6.2, §21.14), `synthesis_generated` is **not** reset
- The project remains `COMPLETE` (all WPs still terminal, synthesis done) but the synthesis report now inaccurately describes the cancelled WP as `COMPLETE`
- This is a known limitation: the PM made a deliberate choice to cancel, and the synthesis captured outcomes at the time of generation
- Implementations that require an up-to-date synthesis after cancellation should either (a) have the PM reopen the project via a non-cancelled WP's `COMPLETE → IN_PROGRESS` transition (which resets `synthesis_generated`), or (b) add an optional `COMPLETE → CANCELLED resets synthesis_generated` rule as an implementation-specific extension
- This behavior is consistent with the principle that `COMPLETE → CANCELLED` is a lightweight terminal-to-terminal transition with minimal side effects (no counter change, no cascade reblock, no revision increment)
- **Contrast with §21.51:** WP creation on a COMPLETE project **does** reset `synthesis_generated` because it introduces *new* work that the prior synthesis never covered. `COMPLETE → CANCELLED` only removes existing work — the synthesis report is stale but not *missing* coverage. This asymmetry is intentional: new work always invalidates synthesis; post-hoc cancellation is a PM judgment call

### 21.39 Orphaned IN_PROGRESS WP with Null `assigned_to`

- If data corruption or an interrupted operation leaves an `IN_PROGRESS` WP with `assigned_to` set to `null`, no agent's recommendation engine will match it via assignment-based checks
- The WP is not fully orphaned: `startPipeline` (§11.1) auto-updates `assigned_to` to the pipeline owner, so the WP becomes visible to the correct agent once a pipeline is started
- However, if no pipeline is active (e.g., the WP was claimed and the agent crashed before starting a pipeline), the WP has no owning agent and no recommendation will surface it
- Self-healing (§17) does not cover WP-level field integrity — it only repairs project-level counters and status
- **Mitigation:** The PM action logic `REVIEW_ABANDONED` (§14.1.2, priority 3b) detects IN_PROGRESS WPs with no active pipeline and no recent pipeline activity, which subsumes this null-`assigned_to` case. The PM can then either re-claim on behalf of the correct agent or unclaim the WP (which requires no `IN_PROGRESS` pipelines — already satisfied in this scenario)

### 21.40 Abandoned WP Detection (Claimed but No Pipeline)

- An IN_PROGRESS WP with no IN_PROGRESS pipeline and no pipeline completed within `STALE_PIPELINE_HOURS` (or no pipelines at all) is considered "abandoned" — the claiming agent likely crashed or disconnected before starting work
- **Grace period:** The WP must have been IN_PROGRESS for at least `STALE_PIPELINE_HOURS` before it is flagged as abandoned. This prevents false positives on freshly claimed WPs where the agent has not yet had time to start a pipeline. Implementations should track the time-of-claim via the WP detail's last status-change timestamp or, as a fallback, the root index's `last_updated` field for the claiming operation
- Unlike stale pipeline detection (§14.8, §21.19), which requires an IN_PROGRESS pipeline to exist, abandoned WP detection catches the gap where the WP was claimed but no pipeline was ever created
- The PM's `REVIEW_ABANDONED` action (§14.1.2, priority 3b) surfaces these WPs, positioned after `REVIEW_STALE` because stale pipelines represent more urgent in-flight work
- The PM can: (a) unclaim the WP (IN_PROGRESS → READY, which clears `assigned_to`), (b) override-claim on behalf of a different agent, or (c) cancel the WP if appropriate
- This also covers the null-`assigned_to` edge case (§21.39), since the check is based on pipeline activity, not assignment state

### 21.41 PM Override Handoff Note Attribution

- When the Project Manager uses the override to complete a pipeline (§12.1, §12.4), the handoff note's `from_agent` is set to `"Project Manager"` (the actual acting agent), not the pipeline owner
- This ensures the audit trail accurately reflects who took the action, which is especially important for operational recovery scenarios (e.g., PM force-failing a stale pipeline)
- The `to_agent` field still uses the standard routing maps (`NEXT_AGENT_MAP` for PASS, `FAIL_ROUTING_MAP` for FAIL), preserving correct routing semantics
- In non-override scenarios, `from_agent` remains the pipeline owner per `PIPELINE_AGENT_MAP`, which is the expected behavior

### 21.42 Transitive Cascade Reblock Limitation

> **⚠ Safety-critical implementations should evaluate the recursive extension described below.** The compounding effects of this limitation can produce stale pipeline results that bypass both the re-validation guard and the recommendation engine's advisory checks.

- `propagateDependencyReblock` (§15.5) only reblocks **direct** dependents of the reopened WP. Transitive dependents (WPs that depend on a direct dependent, not on the reopened WP itself) are **not** automatically reblocked
- **Example:** WP-001 → WP-002 → WP-003 (dependency chain). If WP-001 is reopened: WP-002 (depends on WP-001) is reblocked, but WP-003 (depends on WP-002, not WP-001) continues executing — even though its transitive dependency chain is now broken
- **State-machine integrity is preserved:** WP-003 cannot reach COMPLETE because WP-002 (its dependency) is now BLOCKED (non-terminal), so the dependency check in `claimWorkPackage` (§10.1) and the general terminal-dependency invariant prevent WP-003 from progressing past its current state. However, any in-flight pipelines on WP-003 continue executing against potentially invalidated assumptions, which may result in wasted work and produce misleading pipeline PASS results (e.g., a QA PASS on WP-003 while WP-001 is being reworked)
- **Mitigation:** The wasted work is bounded — WP-003 cannot claim new WPs or mark itself COMPLETE while WP-002 is non-terminal. When WP-002 is eventually unblocked and re-completed, WP-003's work may still be valid (or the Reviewer/QA will catch inconsistencies in their pipeline passes)
- **Stale prerequisite interaction (compounding gap):** Beyond wasted work, the continued execution produces pipeline PASS results that persist after WP-002 eventually re-completes and unblocks WP-003. These stale PASSes may satisfy prerequisite checks for later pipeline types — e.g., a QA PASS on WP-003 (validating the pre-reopen state of WP-001) could allow `startPipeline(type=code-review)` to proceed without re-running QA. This gap compounds because **three independent safeguards all miss it simultaneously**: (1) the re-validation guard ([§11.1.1](operations.md#1111-re-validation-guard)) does not fire because no downstream FAIL exists (see "Known limitation — WP reopen scenario" in §11.1.1); (2) the recommendation engine's `hasNewUpstreamPassSince` only compares adjacent pipeline types within a single WP, not across the dependency graph; (3) cascade reblock is limited to direct dependents by design. For longer dependency chains (A → B → C → D), nodes further from the reopened WP have progressively less protection against stale state
- **Recommended extension for safety-critical implementations:** Extend `propagateDependencyReblock` with recursive traversal of the dependency graph, applying the same auto-cancelled pipeline closure pattern and dependency blocker to all transitive dependents. This eliminates the compounding gap at the cost of broader state disruption on reopen. Implementations that adopt this extension should use a visited-set to prevent infinite traversal in case of (invalid) cyclic dependencies

### 21.43 Post-Technical-Blocker Unblock Routing

- When a Documentation agent sets a WP to BLOCKED with a `technical` blocker (§21.24) and the PM subsequently unblocks it (BLOCKED → IN_PROGRESS per §6.2), the WP returns to IN_PROGRESS with `assigned_to` still set to "Documentation" (the last pipeline agent)
- The recommendation engine for Developer will **not** automatically surface this WP for code rework: no implementation FAIL exists (§14.2 priority 4), no downstream FAIL routed to Developer exists because documentation FAIL is self-rework per FAIL_ROUTING_MAP (§14.2 priority 5), and the WP already has an implementation pipeline (§14.2 priority 6)
- **Expected PM workflow after unblocking:** The PM must manually coordinate the code rework. Options include: (a) unclaim the WP (IN_PROGRESS → READY, which clears `assigned_to`, requires no IN_PROGRESS pipelines — see §21.13), then have the Developer re-claim it; (b) start an implementation pipeline on behalf of the Developer via PM override (§11.1.2); (c) use a project comment to notify the Developer of the required rework
- This dead zone is a consequence of the `FAIL_ROUTING_MAP` deliberately routing documentation failures to Documentation (self-rework) rather than Developer. The blocker mechanism (not the pipeline routing system) is the escalation path for code-caused documentation failures, and the PM is responsible for the subsequent coordination

### 21.44 Rework Count Reset on WP Reopen

- When a COMPLETE WP is reopened (COMPLETE → IN_PROGRESS), the `rework_counts` map is **reset to absent** (cleared), restoring the full rework budget for the new revision cycle
- Without this reset, rework iterations accumulated in a prior revision would carry over, causing the circuit breaker (§16.3) to trip prematurely — potentially on the first rework attempt of the new cycle. A PM encountering `REVIEW_REWORK_LIMIT` on a freshly reopened WP would have no actionable path forward other than cancellation
- The reset is intentional: the `revision` counter (§21.4) already tracks how many times a WP has been reopened, providing the project-level signal that a WP is churning. Per-pipeline rework counts measure iteration intensity *within* a single revision, and should start fresh when the PM or Documentation makes a deliberate decision to reopen
- Implementations MUST clear `rework_counts` as part of the COMPLETE → IN_PROGRESS transition, alongside the existing `revision` increment and `synthesis_generated` reset

### 21.45 Reopened WP Can Re-Complete Without New Pipeline Work

- After COMPLETE → IN_PROGRESS, if no new `implementation` pipeline starts, the old documentation PASS may still satisfy the freshness check (it post-dates the old implementation start). If all acceptance criteria remain `met: true`, the Documentation agent can immediately call `updateWorkPackageStatus(COMPLETE)` without any substantive rework
- This is **by design**: the PM or Documentation agent who reopened the WP is responsible for setting up meaningful rework — e.g., by modifying acceptance criteria, starting a new pipeline, or adding handoff notes describing the required changes. The state machine enforces structural integrity (pipeline ordering, agent guards, freshness) but does not enforce that "useful work was done"
- **Mitigation:** If implementations want to prevent no-op re-completions, they MAY add a guard requiring at least one pipeline started after the COMPLETE → IN_PROGRESS transition. This is an optional enhancement beyond the core specification

### 21.46 PM Handoff Single-Return for Multiple READY WPs

- The Project Manager handoff function (§13.1) iterates READY WPs and returns on the first match (per §13.2 short-circuit semantics). If multiple READY WPs exist with different `assigned_to` values, only the first WP's assigned agent determines the handoff status
- This is a known limitation of the single-return handoff model: the PM handoff gives a single-agent picture when multiple agents should potentially be engaged simultaneously
- **Mitigation:** The batch action system (§14.9) compensates at the recommendation level — `getNextActions` returns all actionable WPs, enabling parallel engagement. The handoff limitation affects only the auto-handoff routing (§18), which can only target one agent per cycle. In practice, the auto-handoff chain will process READY WPs sequentially across multiple handoff cycles, eventually engaging all required agents
- Implementations that need parallel agent activation should use the batch action system rather than relying on the single-return handoff status

### 21.47 BLOCKED → BLOCKED Agent Guard

- The `BLOCKED → BLOCKED` same-state transition requires the agent to be the **Project Manager** or the **current assignee** (`wp.assigned_to`) — see §6.2 and §6.5
- This prevents arbitrary agents from modifying blockers on WPs they do not own, consistent with the agent guard philosophy applied to `BLOCKED → IN_PROGRESS` (PM/assignee/system) and other guarded transitions
- Without this guard, any agent could overwrite a PM-managed blocker (e.g., `decision`, `technical`), undermining the PM's blocker-management responsibility
- The current assignee is permitted because they may have additional context about the blocking condition (e.g., a Developer discovering that a `technical` blocker also has a `decision` component)

### 21.48 Consolidated Reopen Workflow Guidance

When a COMPLETE WP is reopened (COMPLETE → IN_PROGRESS), the state machine enforces structural invariants (revision increment, rework count reset, synthesis invalidation, cascade reblock — see [§6.2](state-machines.md#62-transition-table) and [§15.5](dependencies-and-rework.md#155-cascade-reblocking-propagatedependencyreblock)), but does **not** enforce that meaningful rework is performed before the WP re-completes. This is documented in §21.45 and §21.34.

The following describes the expected PM/agent workflow after a COMPLETE → IN_PROGRESS reopen:

1. **PM sets up rework context:** After reopening, the PM should perform one or more of:
   - Modify acceptance criteria to reflect the new requirements (e.g., mark criteria as `met: false`, add new criteria)
   - Start a new `implementation` pipeline on behalf of Developer via PM override ([§11.1.2](operations.md#1112-agent-role-validation))
   - Add handoff notes or project comments describing the required changes
   - Add or update the WP's `blocked_by` if the rework depends on external factors
2. **Pipeline agents re-engage:** Once the PM has set up the rework context:
   - The Developer should be routed to the WP (via handoff or recommendation engine) to start a new implementation pipeline
   - QA, Reviewer, and Documentation should re-engage in sequence after implementation re-PASSes. The recommendation engine's `hasNewUpstreamPassSince` ([§14.6](handoff-and-recommendations.md#146-hasnewupstreampasssince-algorithm)) correctly detects the new upstream PASS and advises re-engagement, but the re-validation guard ([§11.1.1](operations.md#1111-re-validation-guard)) does not provide hard enforcement for the WP reopen case (see "Known limitation — WP reopen scenario" in §11.1.1)
3. **Without PM intervention:** If the PM (or Documentation agent who initiated the reopen) does not set up rework context:
   - All prior pipelines remain PASS — no agent receives rework/implement recommendations
   - The Documentation agent receives `FINALIZE_WP` (§14.5) because all acceptance criteria are still met and the old documentation PASS satisfies the freshness check against the old implementation start
   - The WP can be immediately re-completed without any new pipeline work — a "no-op reopen"

- **Mitigation for no-op reopens:** Implementations that want to prevent this MAY add a guard requiring at least one pipeline started after the COMPLETE → IN_PROGRESS transition before allowing the WP to transition back to COMPLETE. This is an optional enhancement beyond the core specification (see §21.45)
- **Related edge cases:** §21.34 (FINALIZE_WP gap), §21.44 (rework count reset), §21.45 (re-completion without new work), [§11.1.1](operations.md#1111-re-validation-guard) (re-validation guard WP reopen limitation)

### 21.49 Agent Role Guard on Work Package Claiming

- The `claimWorkPackage` function ([§10.1](operations.md#101-algorithm)) restricts claiming to **pipeline-owning agents** (Developer, QA, Reviewer, Documentation) and the **Project Manager**
- Non-pipeline agents (Planner, Synthesis) cannot claim WPs — they have no pipeline types to start (§4.1), so a WP claimed by them would be stranded in IN_PROGRESS with no pipeline activity until the PM notices via `REVIEW_ABANDONED` ([§14.1.2](handoff-and-recommendations.md#1412-project-manager-action-logic))
- This guard is consistent with the spec's enforcement philosophy: pipeline agent guards exist on `startPipeline` ([§11.1.2](operations.md#1112-agent-role-validation)) and `completePipeline` ([§12.4](operations.md#124-agent-role-validation-on-completion)), and the claiming guard extends this to the entry point of the WP lifecycle
- The PM is permitted to claim on behalf of any pipeline-owning agent (e.g., re-claiming an abandoned WP), consistent with the PM override pattern used throughout the spec

### 21.50 No Agent Guard on Work Package Creation

- The `create_work_package` operation does **not** enforce an agent role guard — any agent may theoretically create a WP
- In practice, only the Project Manager creates WPs (see §22, Phase 1, step 3), and `getNextAction` only returns `CREATE_WORK_PACKAGES` for the PM role (§14.1)
- This is a **soft enforcement** model: the recommendation engine steers correct behavior, but no hard guard prevents other agents from calling the underlying tool
- This approach is intentional: during edge cases (e.g., a Developer discovering the need for a new WP), it may be useful for non-PM agents to create WPs rather than requiring a handoff back to the PM
- Implementations that require stricter control MAY add a guard restricting WP creation to the Project Manager role, consistent with the enforcement philosophy applied to other lifecycle operations

### 21.51 Work Package Creation on a COMPLETE Project

- If the PM creates a new WP on a `COMPLETE` project (all WPs terminal, `synthesis_generated == true`), the project enters an inconsistent state: `pending_work_packages > 0` while `synthesis_generated` remains `true`
- Self-healing rule 2 (§17.2) fires on the next status read: `COMPLETE AND pending > 0` → `IN_PROGRESS`. However, `synthesis_generated` is **not** reset by self-healing — it is only reset by the COMPLETE → IN_PROGRESS WP transition (§6.2) and cascade reblock (§15.5)
- This means the project would be `IN_PROGRESS` with `synthesis_generated == true` and a pending WP — an anomalous combination. Once the new WP reaches a terminal state, self-healing rule 1 (§17.2) would set the project to `COMPLETE` without requiring the Synthesis agent to re-run, producing a stale synthesis report
- **Prescribed behavior:** WP creation on a COMPLETE project MUST reset `synthesis_generated` to `false`. This ensures the Synthesis agent is required to re-run after the new WP completes, producing an up-to-date report
- This is analogous to the `synthesis_generated` reset on COMPLETE → IN_PROGRESS (§21.26) — both represent the introduction of new work that invalidates a prior synthesis
- **Contrast with §21.38:** `COMPLETE → CANCELLED` does **not** reset `synthesis_generated` because cancellation removes existing work rather than introducing new work. See §21.38 for the full rationale

### 21.52 Developer Downstream-Rework Churn Prevention

- After the Developer completes rework (e.g., impl-2 PASS following a qa-1 FAIL), the most recent downstream pipeline is still FAIL. Without a temporal guard, the Developer's `getNextAction` (§14.2 priority 5) would immediately recommend REWORK again — even though the fix has already been delivered and the downstream agent (QA) should re-engage next
- In headless/automated orchestration, this produces a pathological loop: the Developer churns through redundant implementation cycles (impl-3, impl-4, ...) before the downstream agent gets a turn, exhausting the circuit breaker budget (`rework_counts.implementation` reaching `MAX_REWORK_COUNT`) without any quality signal from downstream
- **Resolution:** The `hasDownstreamReengagedSince` function (§14.13) detects whether a downstream agent has started a pipeline since the Developer's most recent implementation PASS. When the fix has been delivered but downstream hasn't re-engaged, the Developer receives `WAIT_FOR_DOWNSTREAM` (§14.2 priority 5b) instead of `REWORK`
- **Trace — prevented churn:** impl-1 PASS → qa-1 FAIL → impl-2 PASS → Developer calls `getNextAction` → priority 5 fires (`isMostRecentPipelineFail("qa")` is true) → `hasDownstreamReengagedSince` returns `true` (impl-2 PASS exists, no QA started since) → skip to priority 5b → **WAIT_FOR_DOWNSTREAM** ✓
- **Trace — re-engagement then re-failure:** impl-1 PASS → qa-1 FAIL → impl-2 PASS → qa-2 FAIL → Developer calls `getNextAction` → priority 5 fires → `hasDownstreamReengagedSince` returns `true` (qa-2 started after impl-2 PASS) → skip to priority 5b → **WAIT_FOR_DOWNSTREAM**. However, the Developer now needs to rework again. On the *next* cycle: Developer starts impl-3 PASS (e.g., because the qa-2 FAIL handoff note prompted manual routing) → `hasDownstreamReengagedSince` returns `false` (no downstream started since impl-3 PASS) → **REWORK** would fire if needed. The one-cycle WAIT_FOR_DOWNSTREAM delay after qa-2 FAIL is acceptable — the handoff system (§12.2) routes qa-2 FAIL to Developer, and the PM or auto-handoff can re-invoke the Developer
- This is the Developer-side counterpart of the QA/Reviewer `hasNewUpstreamPassSince` check (§14.3 priority 4, §14.4 priority 4), which prevents *downstream* agents from waiting indefinitely after upstream rework completes. Together they form a symmetric temporal guard: upstream agents wait for downstream re-engagement, and downstream agents detect upstream re-passes
