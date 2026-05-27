# MCP Server - Workflow Spec (Edge Cases & Guidance)
<INSTRUCTION>
# MCP Server - Workflow Spec: Edge Cases & Guidance
Edge case handling, dependency and rework patterns, auxiliary systems, and agent recommendations.

</INSTRUCTION>
------------------------------------------------------------
```
// Structure of documents
└── mcp-server/
    └── docs/
        └── agents/
            └── workflow-specification/
                └── edge-cases.md

```
###  Path: `/mcp-server/docs/agents/workflow-specification/edge-cases.md`

```md
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
- Fields that must stay in sync: `work_package_id`, `status`, `assigned_to`, `dependencies`, `active_pipeline_stages`

### 21.10 Generalized COMPLETE Guard

Only the agent owning the WP's **last active stage** can mark a WP as COMPLETE. The last active stage is determined by `lastActiveStage(wp)` (§6.2.1) — the final entry in the WP's `active_pipeline_stages` (or `DEFAULT_PIPELINE_STAGES` when absent). The terminal agent is `PIPELINE_AGENT_MAP[lastActiveStage(wp)]`.

Additionally, the most recent pipeline of the last active stage must have PASS status, **and** that PASS must post-date the most recent pipeline start of the WP's **first active stage** (`firstActiveStage(wp)` — §6.2.1). This freshness check prevents a stale PASS (from before a WP reopen) from satisfying the COMPLETE guard. The effective pipeline chain is the WP's `active_pipeline_stages` — any valid subsequence of the canonical ordering:

```
Default:         Developer → QA → Reviewer → Documentation → COMPLETE
Full:            Developer → QA → Security Auditor → Reviewer → Release Engineer → Documentation → COMPLETE
Doc-only:        Documentation → COMPLETE
Verification:    Developer → QA → Reviewer → COMPLETE
```

No agent can skip active stages. The terminal agent cannot mark COMPLETE without having completed its own pipeline successfully, and a WP reopen invalidates any prior terminal-stage PASS.

> **Single-stage WPs:** When `firstActiveStage == lastActiveStage` (e.g., documentation-only WP `["documentation"]`), the freshness check passes vacuously — there is no earlier stage to compare against. The PASS of the single stage is sufficient.

> **Absent first-active-stage pipeline:** If no pipeline of the first active stage exists on the WP (which would require bypassing the normal pipeline ordering — see §8.1), the freshness check passes vacuously. The guard's purpose is to detect stale terminal-stage PASS after a WP reopen; without a first-active-stage pipeline, there is no reopen reference point to compare against. Implementations MAY treat this as an invariant violation and reject the transition, but the core specification does not require it.

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
- Documentation and release-engineering self-rework do not consume the implementation rework budget — they increment only `rework_counts.documentation` and `rework_counts.release-engineering` respectively
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

- The re-validation guard operates in two layers, both enforced in `startPipeline` ([§11.1](operations.md#111-algorithm)):
  1. **Upstream rework check (unconditional):** Regardless of whether the current pipeline type has ever run, the guard checks if any upstream pipeline (via `getUpstreamTypes` §8.5) was started after the prerequisite PASSed. If upstream rework is detected, the prerequisite must re-PASS. This catches first-run stage-skipping, rework-induced staleness, and WP reopen scenarios.
  2. **Temporal consistency check (same-type re-runs only):** When the current pipeline type has been run before (`effectiveSamePipelines` is non-empty, excluding auto-cancelled per §21.27), the guard verifies the prerequisite PASSed after the most recent effective run. If the prerequisite is temporally stale but no upstream rework occurred, this is a self-rework scenario — the guard allows the pipeline to start.
- This prevents skipping intermediate validation stages after upstream rework (e.g., starting `code-review` with a stale QA PASS that validated an older implementation — even when the pipeline type has never run before or the last run FAILed)
- The temporal baseline for the same-type check uses `effectiveSamePipelines` (filtered to exclude auto-cancelled) rather than all pipelines of the same type. This ensures an auto-cancelled pipeline's timestamp does not shift the comparison, consistent with the §21.27 invariant that auto-cancelled pipelines are excluded from quality-related decisions
- The upstream rework check naturally distinguishes self-rework from genuine upstream invalidation: in a self-rework scenario (e.g., documentation retrying after its own FAIL), no upstream pipeline was started after the prerequisite PASSed, so `hasUpstreamRework` is `false` and the guard does not fire
- Complements the recommendation engine's `hasNewUpstreamPassSince` logic (§14.6) with a hard enforcement gate that covers all scenarios including WP reopens and first-run pipeline starts

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
- `propagateDependencyReblock` (§15.5) also resets `synthesis_generated` (and clears `synthesis_generated_at`) as a crash-recovery safety net
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

### 21.34 Terminal-Stage PASS to COMPLETE Finalization Gap

- After the WP's last active stage pipeline PASSes, the WP remains IN_PROGRESS until the terminal agent (the agent owning the last active stage — see §6.2.1) explicitly calls `updateWorkPackageStatus(COMPLETE)`
- The `FINALIZE_WP` recommendation (§14.5, §14.5a) bridges this gap by advising the terminal agent to mark the WP as COMPLETE when all conditions are satisfied (last-active-stage PASS, all acceptance criteria met, freshness check passed)
- Without `FINALIZE_WP`, an agent that completes the terminal pipeline but forgets to update the WP status would leave the WP stranded in IN_PROGRESS with no further recommendations
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
- The `to_agent` field still uses the standard routing maps (`resolveNextAgent` §9.2 for PASS, `FAIL_ROUTING_MAP` §9.3 for FAIL), preserving correct routing semantics
- In non-override scenarios, `from_agent` remains the pipeline owner per `PIPELINE_AGENT_MAP`, which is the expected behavior

### 21.42 Transitive Cascade Reblock Limitation

> **⚠ Safety-critical implementations should evaluate the recursive extension described below.** The compounding effects of this limitation can produce stale pipeline results that bypass both the re-validation guard and the recommendation engine's advisory checks.

- `propagateDependencyReblock` (§15.5) only reblocks **direct** dependents of the reopened WP. Transitive dependents (WPs that depend on a direct dependent, not on the reopened WP itself) are **not** automatically reblocked
- **Example:** WP-001 → WP-002 → WP-003 (dependency chain). If WP-001 is reopened: WP-002 (depends on WP-001) is reblocked, but WP-003 (depends on WP-002, not WP-001) continues executing — even though its transitive dependency chain is now broken
- **State-machine integrity is preserved:** WP-003 cannot reach COMPLETE because WP-002 (its dependency) is now BLOCKED (non-terminal), so the dependency check in `claimWorkPackage` (§10.1) and the general terminal-dependency invariant prevent WP-003 from progressing past its current state. However, any in-flight pipelines on WP-003 continue executing against potentially invalidated assumptions, which may result in wasted work and produce misleading pipeline PASS results (e.g., a QA PASS on WP-003 while WP-001 is being reworked)
- **Mitigation:** The wasted work is bounded — WP-003 cannot claim new WPs or mark itself COMPLETE while WP-002 is non-terminal. When WP-002 is eventually unblocked and re-completed, WP-003's work may still be valid (or the Reviewer/QA will catch inconsistencies in their pipeline passes)
- **Stale prerequisite interaction (compounding gap):** Beyond wasted work, the continued execution produces pipeline PASS results that persist after WP-002 eventually re-completes and unblocks WP-003. These stale PASSes may satisfy prerequisite checks for later pipeline types — e.g., a QA PASS on WP-003 (validating the pre-reopen state of WP-001) could allow `startPipeline(type=code-review)` to proceed without re-running QA. Note that the re-validation guard's upstream rework check ([§11.1.1](operations.md#1111-re-validation-guard)) **does** catch intra-WP stale prerequisites (including after WP reopens), but it operates within a single WP — it cannot detect cross-WP staleness caused by transitive dependency changes. The remaining gap compounds because: (1) the recommendation engine's `hasNewUpstreamPassSince` only compares adjacent pipeline types within a single WP, not across the dependency graph; (2) cascade reblock is limited to direct dependents by design. For longer dependency chains (A → B → C → D), nodes further from the reopened WP have progressively less protection against stale state
- **Recommended extension for safety-critical implementations:** Extend `propagateDependencyReblock` with recursive traversal of the dependency graph, applying the same auto-cancelled pipeline closure pattern and dependency blocker to all transitive dependents. This eliminates the compounding gap at the cost of broader state disruption on reopen. Implementations that adopt this extension should use a visited-set to prevent infinite traversal in case of (invalid) cyclic dependencies
- **Lighter-weight alternative:** See [§21.59](#2159-cross-wp-staleness-after-dependency-reopens) for a `completePipeline` dependency freshness check that detects cross-WP staleness at the point of consumption without pre-emptive cascade disruption

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

- After COMPLETE → IN_PROGRESS, if no new first-active-stage pipeline starts, the old last-active-stage PASS may still satisfy the freshness check (it post-dates the old first-active-stage start). If all acceptance criteria remain `met: true`, the terminal agent can immediately call `updateWorkPackageStatus(COMPLETE)` without any substantive rework
- This is **by design**: the PM or terminal agent who reopened the WP is responsible for setting up meaningful rework — e.g., by modifying acceptance criteria, starting a new pipeline, or adding handoff notes describing the required changes. The state machine enforces structural integrity (pipeline ordering, agent guards, freshness) but does not enforce that "useful work was done"
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
   - QA, Security Auditor (when active), Reviewer, Release Engineer (when active), and Documentation should re-engage in sequence after implementation re-PASSes. Both the recommendation engine's `hasNewUpstreamPassSince` ([§14.6](recommendations.md#146-hasnewupstreampasssince-algorithm)) and the re-validation guard ([§11.1.1](operations.md#1111-re-validation-guard)) correctly handle the WP reopen case — the guard's upstream rework check detects the new implementation pipeline and blocks downstream stages from starting with stale prerequisites
3. **Without PM intervention:** If the PM (or terminal agent who initiated the reopen) does not set up rework context:
   - All prior pipelines remain PASS — no agent receives rework/implement recommendations
   - The terminal agent receives `FINALIZE_WP` (§14.5, §14.5a) because all acceptance criteria are still met and the old last-active-stage PASS satisfies the freshness check against the old first-active-stage start
   - The WP can be immediately re-completed without any new pipeline work — a "no-op reopen"

- **Mitigation for no-op reopens:** Implementations that want to prevent this MAY add a guard requiring at least one pipeline started after the COMPLETE → IN_PROGRESS transition before allowing the WP to transition back to COMPLETE. This is an optional enhancement beyond the core specification (see §21.45)
- **Terminal-agent-initiated reopens:** When the terminal agent (rather than the PM) reopens a WP, the same structural side effects apply (revision increment, rework count reset, synthesis invalidation, cascade reblock of dependents — potentially cancelling their in-flight pipelines). Because the cascade damage to dependents is irreversible (auto-cancelled pipelines and lost in-progress work), a no-op reopen is particularly harmful. The terminal agent **MUST** perform at least one of: (a) mark one or more acceptance criteria as `met: false` to prevent immediate re-completion, (b) add handoff notes explaining the issue that prompted the reopen, or (c) set the WP to BLOCKED with a `technical` blocker if the issue requires code changes. Without any of these actions, the recommendation engine will immediately offer `FINALIZE_WP` (§14.5, §14.5a) — making the reopen a no-op (§21.45) while dependents have already suffered cascade damage. Implementations SHOULD enforce this by requiring at least one acceptance criterion to be set to `met: false` as part of a terminal-agent-initiated COMPLETE → IN_PROGRESS transition.
- **Related edge cases:** §21.34 (FINALIZE_WP gap), §21.44 (rework count reset), §21.45 (re-completion without new work), [§11.1.1](operations.md#1111-re-validation-guard) (re-validation guard WP reopen limitation)

### 21.49 Agent Role Guard on Work Package Claiming

- The `claimWorkPackage` function ([§10.1](operations.md#101-algorithm)) restricts claiming to **pipeline-owning agents** (Developer, QA, Security Auditor, Reviewer, Release Engineer, Documentation) and the **Project Manager**
- Non-pipeline agents (Planner, Synthesis) cannot claim WPs — they have no pipeline types to start (§4.1), so a WP claimed by them would be stranded in IN_PROGRESS with no pipeline activity until the PM notices via `REVIEW_ABANDONED` ([§14.1.2](recommendations.md#1412-project-manager-action-logic))
- This guard is consistent with the spec's enforcement philosophy: pipeline agent guards exist on `startPipeline` ([§11.1.2](operations.md#1112-agent-role-validation)) and `completePipeline` ([§12.4](operations.md#124-agent-role-validation-on-completion)), and the claiming guard extends this to the entry point of the WP lifecycle
- The PM is permitted to claim on behalf of any pipeline-owning agent (e.g., re-claiming an abandoned WP), consistent with the PM override pattern used throughout the spec
- **⚠ PM claiming without follow-up creates a dead-end:** When the PM claims a WP, `assigned_to` is set to `"Project Manager"`. No pipeline agent's recommendation engine surfaces WPs assigned to the PM in their `CLAIM_WP` check (Developer checks "unassigned or assigned to Developer"; others check "assigned to this agent"), and the PM cannot start a pipeline without invoking the PM override (§11.1.2). If the PM claims a WP and takes no further action, the WP remains invisible to pipeline agents until `REVIEW_ABANDONED` (§14.1.2) eventually fires — telling the PM to fix the problem the PM created. **Best practice:** PM claims should always be followed immediately by either (a) starting a pipeline via PM override on behalf of the intended agent, or (b) unclaiming the WP (IN_PROGRESS → READY) so a pipeline-owning agent can re-claim it
- **⚠ No escalation path for PM session failure:** If the PM crashes or disconnects after claiming a WP, `REVIEW_ABANDONED` will eventually surface the issue — but it surfaces it *to the PM*, who is also unavailable. No other agent role has the authority to override the PM's claim or unclaim the WP. In headless orchestration, this creates a permanent dead-end until the PM is externally restarted. Implementations that need resilience against PM session failures SHOULD add an external watchdog or allow a supervisor process to act with PM authority for claim recovery.

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
- **Prescribed behavior:** WP creation on a COMPLETE project MUST reset `synthesis_generated` to `false` and clear `synthesis_generated_at` to `null`. This ensures the Synthesis agent is required to re-run after the new WP completes, producing an up-to-date report
- This is analogous to the `synthesis_generated` reset on COMPLETE → IN_PROGRESS (§21.26) — both represent the introduction of new work that invalidates a prior synthesis
- **Contrast with §21.38:** `COMPLETE → CANCELLED` does **not** reset `synthesis_generated` because cancellation removes existing work rather than introducing new work. See §21.38 for the full rationale

### 21.52 Developer Downstream-Rework Churn Prevention

- After the Developer completes rework (e.g., impl-2 PASS following a qa-1 FAIL), the most recent downstream pipeline is still FAIL. Without a temporal guard, the Developer's `getNextAction` (§14.2 priority 5) would immediately recommend REWORK again — even though the fix has already been delivered and the downstream agent (QA) should re-engage next
- In headless/automated orchestration, this produces a pathological loop: the Developer churns through redundant implementation cycles (impl-3, impl-4, ...) before the downstream agent gets a turn, exhausting the circuit breaker budget (`rework_counts.implementation` reaching `MAX_REWORK_COUNT`) without any quality signal from downstream
- **Resolution:** The `hasDownstreamReengagedSince` function (§14.13) detects whether a downstream agent has started a pipeline since the Developer's most recent implementation PASS. When the fix has been delivered but downstream hasn't re-engaged, the Developer receives `WAIT_FOR_DOWNSTREAM` (§14.2 priority 5b) instead of `REWORK`
- **Trace — prevented churn:** impl-1 PASS → qa-1 FAIL → impl-2 PASS → Developer calls `getNextAction` → priority 5 fires (`isMostRecentPipelineFail("qa")` is true) → `hasDownstreamReengagedSince` returns `false` (no QA started since impl-2 PASS) → negated guard fires (`NOT false`) → continue → falls through to priority 5b → **WAIT_FOR_DOWNSTREAM** ✓
- **Trace — re-engagement then re-failure:** impl-1 PASS → qa-1 FAIL → impl-2 PASS → qa-2 FAIL → Developer calls `getNextAction` → priority 5 fires → `hasDownstreamReengagedSince` returns `true` (qa-2 started after impl-2 PASS) → negated guard does not fire (`NOT true`) → falls through to **REWORK** ✓ — the Developer is correctly told to rework immediately after QA re-fails, with no wasted cycle. On the next cycle: Developer completes impl-3 PASS → `hasDownstreamReengagedSince` returns `false` (no downstream started since impl-3 PASS) → negated guard fires → **WAIT_FOR_DOWNSTREAM** until QA re-engages
- This is the Developer-side counterpart of the QA/Reviewer `hasNewUpstreamPassSince` check (§14.3 priority 4, §14.4 priority 4), which prevents *downstream* agents from waiting indefinitely after upstream rework completes. Together they form a symmetric temporal guard: upstream agents wait for downstream re-engagement, and downstream agents detect upstream re-passes

### 21.53 Upstream Circuit Breaker Propagation

- The circuit breaker (§16.3) is evaluated **per pipeline type** — reaching the limit on `implementation` does not directly block `qa`, `code-review`, or `documentation` rework. However, when an upstream pipeline is circuit-broken, downstream agents performing new work against a stale upstream PASS produces wasted effort: the downstream pipeline will likely FAIL, incrementing the downstream rework counter without any possibility of upstream correction through normal channels
- **Example:** `rework_counts.implementation` reaches `MAX_REWORK_COUNT` (5). `startPipeline(type=implementation)` is now rejected. But QA's `getNextAction` still returns `RUN_QA` (re-engagement or first run) because QA's priority checks only examine whether the most recent `implementation` pipeline is PASS — they do not verify that implementation can still be reworked if QA fails. QA runs, fails (the underlying implementation issue persists), and `rework_counts.qa` increments. This repeats until `rework_counts.qa` also reaches 5, wasting up to 5 QA cycles
- **Resolution:** The recommendation engine for downstream agents (QA §14.3, Reviewer §14.4, Documentation §14.5) includes a **WAIT_FOR_UPSTREAM_REWORK_LIMIT** priority (1b), evaluated immediately after the agent's own rework limit check (priority 1). This check examines `rework_counts` for all pipeline types upstream of the current agent's owned type (using `getUpstreamTypes` §8.5). If any upstream type has reached `MAX_REWORK_COUNT`, the agent receives `WAIT` with a diagnostic note identifying the circuit-broken upstream type, rather than a `RUN_*` recommendation
- **Upstream type resolution per agent** (dynamically determined via `getUpstreamTypes(ownedType, wp.active_pipeline_stages)`):
  - **QA** checks: `implementation`
  - **Security Auditor** checks: `implementation`, `qa`
  - **Reviewer** checks: `implementation`, `qa` (plus `security-audit` when active)
  - **Release Engineer** checks: `implementation`, `qa`, `code-review` (plus `security-audit` when active)
  - **Documentation** checks: `implementation`, `qa`, `code-review` (plus `security-audit` and/or `release-engineering` when active)
- The PM's `REVIEW_REWORK_LIMIT` action (§14.1.2 priority 2) already surfaces circuit-broken WPs for PM intervention (cancel or restructure). The upstream propagation prevents downstream agents from doing useless work while the PM decides
- This does **not** affect `startPipeline` guards — the `startPipeline` function (§11.1) continues to enforce the circuit breaker only on the pipeline type being started, not on upstream types. The propagation is advisory (recommendation engine only), consistent with the spec's pattern of soft enforcement via recommendations and hard enforcement via tool guards
### 21.54 Canonical "Dependency-Blocked" Definition

Throughout handoff (§13) and recommendation (§14) functions, WPs described as "dependency-blocked" are excluded from actionable work. The canonical definition is:

> A WP is **dependency-blocked** when `status == "BLOCKED"` AND `blocked_by.type == "dependency"` (or `blocked_by` is absent, which implies a dependency blocker from legacy data).

This definition checks the `blocked_by` metadata, not the `dependencies` array. A WP with all formal dependencies terminal but a manually-set `dependency` blocker (e.g., PM used BLOCKED → BLOCKED to set a dependency type) is still considered dependency-blocked under this definition.

The auto-unblock function (`propagateDependencyUnblock` §15.4) uses a different criterion: it checks whether all entries in the `dependencies` array are terminal, regardless of `blocked_by.type`. These two definitions intentionally differ — auto-unblock is structural (based on the dependency graph), while handoff/recommendation filtering is metadata-based (based on the recorded blocker type).

> **Implementation note:** When filtering "non-dependency-blocked" WPs in handoff and recommendation functions, use `wp.status != "BLOCKED" OR wp.blocked_by.type != "dependency"`. Do not substitute a check against the `dependencies` array — this would miss WPs blocked by PM-set dependency blockers that do not correspond to formal dependencies.

### 21.55 Pipeline Stage Backward Compatibility

- WPs created before composable stages (or created without specifying `active_pipeline_stages`) default to `DEFAULT_PIPELINE_STAGES`: `["implementation", "qa", "code-review", "documentation"]`
- When `active_pipeline_stages` is `null` or absent, all dynamic functions (`resolvePrerequisite`, `resolveNextAgent`, `resolveFailAgent`, `getUpstreamTypes`, `getDownstreamTypes`, `firstActiveStage`, `lastActiveStage`) fall back to the default stages — equivalent to the static routing of v1.x
- Stages only become active when explicitly included in the WP's `active_pipeline_stages` at creation time
- Pipeline agents filter their recommendation and handoff logic to only consider WPs where their owned stage is in `active_pipeline_stages`. WPs without their stage are invisible to these agents
- **No mid-flight stage addition:** `active_pipeline_stages` is set at WP creation and cannot be modified thereafter. If the PM discovers mid-project that a WP needs additional stages, the PM must cancel and recreate the WP with the correct stages (losing pipeline history), or manually route work via project comments and PM overrides. This limitation is consistent with the immutable-dependencies design (§15.2) and keeps the pipeline routing deterministic throughout a WP's lifecycle
- **Mixed-stage projects:** A single project may contain WPs with different `active_pipeline_stages` configurations. For example, security-critical WPs may include all 6 stages while documentation-only WPs use `["documentation"]`. Each WP's routing is independent — the pipeline ordering is per-WP, not per-project

### 21.56 Release Engineering FAIL Self-Referential Handoff

- When a release-engineering pipeline FAILs, the `FAIL_ROUTING_MAP` routes to Release Engineer (self-rework), producing a handoff note where `from_agent == to_agent == "Release Engineer"`
- This follows the same self-referential handoff pattern as Documentation (§21.29) — the note serves as an audit trail and provides failure context for new Release Engineer instances in multi-session workflows
- The escalation path for code-level issues discovered during release engineering uses the BLOCKED mechanism with a `technical` blocker, consistent with the Documentation escalation path (§21.24)

### 21.57 Synthesis Staleness Detection via Timestamp

- The `synthesis_generated_at` field on the root index (§3.1) records the UTC timestamp of the most recent `completeSynthesis` call. It is set atomically alongside `synthesis_generated = true` in §19.1
- Whenever `synthesis_generated` is reset to `false` — via COMPLETE → IN_PROGRESS (§6.2), cascade reblock (§15.5), or WP creation on a COMPLETE project (§21.51) — `synthesis_generated_at` is cleared to `null`
- **Primary use — staleness guard in `completeSynthesis`:** Before accepting a `completeSynthesis` call, implementations SHOULD compare `synthesis_generated_at` (if non-null from a prior run) against the `last_updated` timestamp of every WP. If any WP's `last_updated` post-dates `synthesis_generated_at`, the prior synthesis is stale. Under normal operation this condition never arises (because `synthesis_generated` is reset on any state change that invalidates synthesis), but it provides defense-in-depth against corruption scenarios where `synthesis_generated` was not properly reset
- **Secondary use — observability:** External tooling (dashboards, audit logs) can use `synthesis_generated_at` to determine how fresh the synthesis report is relative to the last project activity (`root.last_updated`). A large delta suggests the project was modified after synthesis without re-running the Synthesis agent
- **Absent/null semantics:** `synthesis_generated_at` being `null` or absent is equivalent to "no synthesis has been generated" and is consistent with `synthesis_generated == false`. If `synthesis_generated == true` but `synthesis_generated_at` is null, this indicates a legacy ledger created before the field was introduced (or data corruption). Implementations SHOULD treat this as a soft warning and set `synthesis_generated_at = root.last_updated` as a best-effort repair during self-healing
- **Idempotency:** Multiple `completeSynthesis` calls update `synthesis_generated_at` to the current time on each invocation, consistent with the idempotency semantics described in §19.2

### 21.58 Ledger Version

- The `ledger_version` field on the root index (§3.1) records the specification version that created (or last migrated) the ledger. Format follows semantic versioning (e.g., `"2.3.0"`)
- **Set on creation:** When a new ledger is initialized (first WP creation on a fresh project), `ledger_version` is set to the current specification version of the implementation
- **Read-only thereafter:** Normal workflow operations do not modify `ledger_version`. It serves as a provenance stamp, not a runtime control
- **Migration use case:** When an implementation loads a ledger whose `ledger_version` is older than the current specification version, it can detect structural differences and apply migrations — for example, adding new fields with defaults, rewriting deprecated field formats, or adjusting healing rules that changed between versions. Without this field, implementations must infer the ledger era from the presence or absence of fields (e.g., `rework_counts` vs. legacy `rework_count`, `active_pipeline_stages` presence), which is fragile and non-exhaustive
- **Forward compatibility:** If an older implementation encounters a `ledger_version` newer than its own specification version, it SHOULD emit a `"warning"` project comment (`"Ledger version {version} is newer than this implementation's specification version"`) and continue operating in best-effort mode. Implementations MUST NOT reject a ledger solely because its version is unrecognized — the design philosophy is additive (new fields are optional/nullable), so older implementations can safely ignore fields they don't understand
- **Absent/null semantics:** A ledger without `ledger_version` was created before this field was introduced. Implementations SHOULD treat this as equivalent to `"1.0.0"` (the pre-versioning era) and MAY set `ledger_version` to the current specification version during the next write operation as a one-time migration

### 21.59 Cross-WP Staleness After Dependency Reopens

> This section extends the transitive cascade limitation documented in §21.42 with a concrete staleness propagation scenario and recommended mitigation.

- **Scenario:** Consider a dependency chain WP-001 → WP-002 → WP-003, where all three have completed their full pipeline chains. WP-001 is reopened (COMPLETE → IN_PROGRESS). Cascade reblock (§15.5) blocks WP-002 (direct dependent) and auto-cancels its in-flight pipelines. WP-003 (transitive dependent) is **not** reblocked — its pipeline PASSes remain intact
- **The compounding gap:** WP-003's existing pipeline PASSes (e.g., QA PASS, code-review PASS) validated output that transitively depended on WP-001's now-stale deliverables. All intra-WP guards — the re-validation guard (§11.1.1), `hasNewUpstreamPassSince` (§14.6), and the COMPLETE guard freshness check (§21.10) — operate within a single WP's pipeline history. None can detect that WP-003's prerequisites are stale due to a **cross-WP** dependency change
- **Why the existing guards are insufficient:** After WP-001 re-completes and WP-002 is unblocked, re-completes its pipeline chain, and itself reaches terminal status, WP-003 is also unblocked. At this point, WP-003's pipeline history shows PASS results from the pre-reopen era. Within WP-003, no upstream pipeline was restarted (the rework happened in WP-001 and WP-002), so the re-validation guard's upstream rework check finds nothing. The recommendation engine sees satisfied prerequisites and may offer `FINALIZE_WP` or next-stage pipeline starts based on stale PASSes
- **Impact scales with chain depth:** In longer chains (A → B → C → D), nodes further from the reopened WP accumulate more undetected staleness. This is bounded by the DAG — a WP cannot reach COMPLETE while any dependency is non-terminal — but the quality of intermediate pipeline PASSes degrades with distance from the reopened node
- **Recommended mitigation — `completePipeline` dependency freshness check:** Before accepting a PASS result in `completePipeline` (§12.1), implementations SHOULD verify that all entries in the WP's `dependencies` array are in a terminal status and that each dependency's `last_updated` timestamp predates the current pipeline's `started_at`. If a dependency was re-completed after the pipeline started (indicating the pipeline validated pre-reopen deliverables), the implementation SHOULD emit a `"warning"` project comment and optionally reject the PASS with an `auto_cancelled = true` FAIL. This adds minor overhead to every pipeline completion but catches cross-WP staleness that intra-WP guards cannot detect
- **Alternative — recursive cascade reblock:** As documented in §21.42, implementations MAY extend `propagateDependencyReblock` with recursive traversal to reblock all transitive dependents. This is a more aggressive approach that eliminates the staleness window entirely at the cost of broader state disruption (auto-cancelling pipelines on WPs that may not actually be affected by the upstream change). The `completePipeline` freshness check provides a lighter-weight alternative that detects staleness at the point of consumption rather than pre-emptively disrupting in-flight work

### 21.60 Single-Stage Work Package Semantics

- A WP with exactly one entry in `active_pipeline_stages` (e.g., `["documentation"]`) has the following properties:
  - The single stage's owning agent is the terminal agent — only that agent can mark the WP as COMPLETE (§6.2.1)
  - The COMPLETE freshness check passes vacuously because `firstActiveStage == lastActiveStage` — there is no upstream reference point to compare against
  - Pipeline ordering has no predecessor or successor — `resolvePrerequisite` returns `null` and `resolveNextAgent` returns `"Synthesis"`
  - FAIL routing uses the standard `FAIL_ROUTING_MAP` target if that target's stage is active, otherwise falls back to the single stage's agent (self-rework) via `resolveFailAgent` (§9.3.1)
  - The rework and circuit breaker mechanisms (§16) function normally — the `MAX_REWORK_COUNT` applies to the single stage
  - The recommendation engine (§14) emits the appropriate action for the single stage's agent (e.g., `WRITE_DOCS` for documentation-only, `IMPLEMENT` for implementation-only)
- **Validation:** Single-stage WPs trigger the "single-stage chain" soft guardrail warning (§9b.2 rule 6) but are not rejected

### 21.61 Documentation-Only Work Package

- A WP with `active_pipeline_stages = ["documentation"]` is the canonical "documentation-only" pattern where documentation IS the creative work, not a post-implementation activity
- The Documentation agent claims the WP, starts and completes the `documentation` pipeline, and marks the WP as COMPLETE
- No QA, code-review, or implementation stages run — they are not in the active set
- The FINALIZE_WP action is offered by the recommendation engine when the documentation pipeline has PASS status and all acceptance criteria are met
- FAIL routing for a documentation FAIL is Documentation (self-rework) — consistent with the standard `FAIL_ROUTING_MAP` and the self-rework pattern (§21.29)
- **Use case:** Pure documentation tasks (writing guides, updating READMEs, creating architectural documents) that do not involve code changes

### 21.62 Verification-Only Work Package

- A WP with `active_pipeline_stages = ["implementation", "qa", "code-review"]` is the canonical "verification-only" pattern for spikes, prototypes, or exploratory work where formal documentation is not required
- The terminal agent is **Reviewer** (owning `code-review`, the last active stage) — only Reviewer can mark the WP as COMPLETE
- The COMPLETE freshness check compares the most recent `code-review` PASS against the most recent `implementation` pipeline start
- The FINALIZE_WP action is offered to Reviewer (not Documentation) when the code-review pipeline has PASS status and all acceptance criteria are met
- FAIL routing for `qa` → Developer, `code-review` → Developer (standard map applies because Developer's `implementation` stage is active)
- **Use case:** Spike/prototype WPs, experimental implementations, or tasks where documentation will be handled separately

### 21.63 FAIL Routing Fallback Semantics

- When a pipeline FAILs and the standard `FAIL_ROUTING_MAP` target's owned stage is **not active** in the WP, `resolveFailAgent` (§9.3.1) falls back to the agent owning the WP's first active stage
- **Example:** A WP with `["qa", "code-review"]` — a `qa` FAIL normally routes to Developer, but `implementation` is not active. The fallback routes to QA (owning `qa`, the first active stage), producing a self-rework handoff note
- **Example:** A WP with `["qa", "code-review", "documentation"]` — a `qa` FAIL normally routes to Developer, but `implementation` is not active. The fallback routes to QA (self-rework)
- The self-referential handoff pattern (from_agent == to_agent) is consistent with existing Documentation (§21.29) and Release Engineering (§21.56) self-rework patterns
- The fallback is deterministic — it always selects the first active stage's agent, providing a consistent "loop back to start" behavior for unusual compositions

### 21.64 Artifact Declaration Soft Warning

- When `completePipeline` records a PASS result for a pipeline type in `ARTIFACT_EXPECTED_PIPELINE_TYPES` (`implementation`, `code-review`, `release-engineering`, `documentation`) and the `artifacts.files_modified` field is absent, null, or an empty array, a `"warning"` project comment is emitted (§12.1)
- Verification-only pipeline types (`qa`, `security-audit`) are **exempt** — those agents verify but do not modify files
- `code-review` is included because the Reviewer may apply Fix-Forward edits (Tier 2 feedback) that should be declared
- This is a **soft warning** only — it does not block the PASS or affect routing
- The warning serves as an audit trail prompt: agents that modify files should declare what they changed for traceability and downstream awareness

### 21.65 Test-Only WP Production Method Prerequisite

- When a WP's `active_pipeline_stages` excludes `implementation` (making it test-only, verification-only, or documentation-only), all methods, functions, and classes referenced in the WP's scope must already exist in production code
- This is a **planning discipline rule** enforced by the Project Manager during WP decomposition (after ledger bootstrapping) and by the Pipeline Configurator sub-agent during stage assignment — it is not enforced by the MCP server at the schema level
- If a required symbol does not exist, the WP must be reclassified to include the `implementation` stage. Failing to do so constitutes invisible scope expansion: the Developer will be forced to add production code inside a WP that was scoped as non-implementation, creating a plan-vs-reality mismatch
- **Validation method:** A grep or codebase search for the referenced symbols is sufficient. The PM or Pipeline Configurator does not need to run the code — only verify that the symbols exist in the source tree
- **Example:** A WP scoped as `["qa", "code-review"]` that references `setItemsPerPageURLTemplate()` in its acceptance criteria must verify that this method already exists. If it does not, the WP should use `["implementation", "qa", "code-review"]` (or the full default chain) instead
- This rule does not apply to WPs that include `implementation` in their `active_pipeline_stages`, since the Developer is expected to create any missing symbols during that stage

### 21.66 First-Active-Stage Re-engagement Loop

**Affected agent functions:** QA P4, Reviewer P4, Security Auditor P4, Release Engineer P5  
**Immune agent functions:** Documentation P4, Release Engineer P4

**The footgun pattern:**  
All four affected functions share a ternary null-guard on the prerequisite resolved by `resolvePrerequisite` ([§8.1.1](pipeline-routing.md#811-dynamic-prerequisite-resolution)):

```pseudocode
prerequisite = resolvePrerequisite(pipelineType, activeStages)
hasNewUpstream = prerequisite === null ? <VALUE> : hasNewUpstreamPassSince(prerequisite, pipelineType)
if priorPipelineExists AND hasNewUpstream: return RUN_*  // P4/P5 re-engagement
```

When the pipeline type is the **first active stage** (e.g., `qa` in `["qa", "code-review"]`), `resolvePrerequisite` returns `null`. If `<VALUE>` is `true`, the condition `priorPipelineExists AND true` is satisfied as soon as any prior pipeline exists — and a PASS pipeline **is** a prior pipeline. After the first-active-stage pipeline PASSes, P4/P5 fires again immediately: `priorPipelineExists` is `true`, and `null → true` makes `hasNewUpstream` unconditionally `true`. The engine returns `RUN_*` again. The next PASS triggers the same evaluation, producing an **infinite loop** where every PASS immediately re-generates another `RUN_*`.

**The resolution:**  
P4/P5 re-engagement checks MUST treat `null` as `false`:

```pseudocode
hasNewUpstream = prerequisite === null ? false : hasNewUpstreamPassSince(prerequisite, pipelineType)
```

When no upstream stage exists (first-active-stage), there is no upstream to have "re-passed after rework." The re-engagement condition is meaningless. Treating `null` as `false` causes P4/P5 to evaluate as `false`, falling through to P5/P6 (first-run check) or `WAIT`/`FINALIZE_WP` as appropriate.

**The P4-vs-P6 distinction:**  
The null guard appears at two priority levels in each affected agent's action logic. Only the P4/P5 treatment is wrong:

- **P6 (first-run):** `null → true` is **correct**. "No prerequisite needed to start" is the intended semantics — a first-active-stage pipeline can always be started for the first time without a prerequisite PASS.
- **P4/P5 (re-engagement):** `null → true` is **wrong**. "Re-engagement after upstream rework" is meaningless when no upstream exists. `null → false` is the correct guard.

Implementations MUST apply the `null → false` fix only to the P4/P5 re-engagement check, never to the P6 first-run check.

**Affected agent functions and compositions:**

| Agent | Priority | First-active-stage composition example | Variable | Buggy guard | Fixed guard |
|-------|----------|----------------------------------------|----------|-------------|-------------|
| QA | P4 | `["qa", "code-review"]` | `qaPrerequisite` | `=== null ? true` | `=== null ? false` |
| Reviewer | P4 | `["code-review", "documentation"]` | `reviewPrerequisite` | `=== null ? true` | `=== null ? false` |
| Security Auditor | P4 | `["security-audit", "code-review"]` | `auditPrerequisite` | `=== null ? true` | `=== null ? false` |
| Release Engineer | P5 | `["release-engineering", "documentation"]` | `releasePrerequisite` | `=== null ? true` | `=== null ? false` |

Any `active_pipeline_stages` composition where a non-`implementation` stage is **first** creates a first-active-stage scenario for that stage's owning agent. Note that `implementation` is never affected: the Developer action logic at P4 checks `isMostRecentPipelineFail("implementation")` (direct FAIL rework), not a `resolvePrerequisite`-based re-engagement condition.

**Immune agent functions:**

- **Documentation P4:** The self-rework guard at P4 uses an OR-exit pattern — `docPrerequisite === null || !hasNewUpstreamPassSince(...)` — gated behind `isMostRecentPipelineFail("documentation")`. When `null`, the OR short-circuits to `true`, making the outer condition reduce to "latest pipeline is FAIL → self-rework." This is safe because the guard only fires on FAIL (triggering REWORK, not RUN), so no loop can occur. The null case appears in an OR-exit guard on the self-rework block, not a ternary that collapses to `true` for re-engagement.
- **Release Engineer P4:** Same OR-exit guard structure as Documentation P4 — `releasePrerequisite === null || !hasNewUpstreamPassSince(...)` gated behind `isMostRecentPipelineFail("release-engineering")`. Immune for the same reason: when `null`, the OR short-circuits into the self-rework path (REWORK, not RUN), so no loop can form. The null-collapsing issue affects Release Engineer only at P5 (re-engagement after upstream rework), not P4 (self-rework after own FAIL).

**Related sections:** [§8.1.1](pipeline-routing.md#811-dynamic-prerequisite-resolution) (`resolvePrerequisite` returns `null` for first active stage), [§14.3](recommendations.md#143-qa-action-logic) P4 null-prerequisite guard (QA), [§14.4](recommendations.md#144-reviewer-action-logic) P4 null-prerequisite guard (Reviewer), [§14.5b](recommendations.md#145b-security-auditor-action-logic) P4 null-prerequisite guard (Security Auditor), [§14.5c](recommendations.md#145c-release-engineer-action-logic) P5 null-prerequisite guard (Release Engineer), [§21.63](#2163-fail-routing-fallback-semantics) (FAIL routing fallback for first-active-stage compositions), [§21.67](#2167-first-active-stage-self-rework-deadlock) (WAIT_FOR_REWORK deadlock when FAIL routes to self)

### 21.67 First-Active-Stage Self-Rework Deadlock

**Affected agents:** QA, Reviewer, Security Auditor  
**Prerequisite:** §21.66 (null-prerequisite guard correctly returns `false`), §21.63 (FAIL routing falls back to self-rework), §9.3.1 (`resolveFailAgent` fallback)

**The deadlock pattern:**

When an agent's pipeline type is the first active stage (e.g., `qa` in `["qa", "code-review"]`) and its pipeline FAILs:

1. `resolveFailAgent` (§9.3.1) routes to the first-active-stage agent itself (self-rework), because the standard FAIL target (Developer) owns `implementation`, which is not in `active_pipeline_stages`
2. The recommendation engine's P4 re-engagement check returns `false` (correct per §21.66 — no upstream to re-engage from)
3. P5 (`WAIT_FOR_REWORK`) fires: "most recent pipeline is FAIL AND no new upstream PASS" → returns `WAIT_FOR_REWORK`
4. **Deadlock:** The agent is told to wait for an upstream rework that can never happen — the fail routing says the agent should self-rework, but the recommendation engine says to wait

This is a spec gap between the FAIL routing system (§9.3.1, which correctly identifies the self-rework target) and the recommendation engine (§14.3–§14.5b, which unconditionally returns `WAIT_FOR_REWORK` on FAIL without considering whether the fail target is the agent itself).

**The fix — P4b self-rework fallback:**

Between P4 (re-engagement) and P5 (WAIT_FOR_REWORK), each affected agent MUST check whether the FAIL routing for its pipeline type resolves to itself. If so, return the agent's run action (e.g., `RUN_QA`) with self-rework semantics instead of falling through to `WAIT_FOR_REWORK`.

```pseudocode
// P4b: Self-rework fallback (§21.67)
// When this agent's FAIL routes back to itself (§9.3.1 fallback),
// return RUN_* for self-rework instead of WAIT_FOR_REWORK.
if isMostRecentPipelineFail(pipelines, ownPipelineType):
  failAgent = resolveFailAgent(ownPipelineType, activeStages)
  if failAgent == ownAgentName:
    return RUN_* (self-rework)
```

This check fires only when all of:
- The most recent pipeline of the agent's type is FAIL (same gate as P5)
- The FAIL routing resolves to the agent itself (via §9.3.1 fallback — standard fail target's stage is not active)

When the FAIL routing resolves to a different agent (the normal case), P4b does not fire and P5 proceeds as before.

**Affected priority chains (updated):**

| Agent | P4 | P4b (new) | P5 |
|-------|----|-----------|----|
| QA (§14.3) | Re-engagement (upstream PASS since last QA) | Self-rework (`resolveFailAgent('qa', stages) == 'QA'`) | WAIT_FOR_REWORK (fail target is another agent) |
| Reviewer (§14.4) | Re-engagement (upstream PASS since last review) | Self-rework (`resolveFailAgent('code-review', stages) == 'Reviewer'`) | WAIT_FOR_REWORK (fail target is another agent) |
| Security Auditor (§14.5b) | Re-engagement (upstream PASS since last audit) | Self-rework (`resolveFailAgent('security-audit', stages) == 'Security Auditor'`) | WAIT_FOR_REWORK (fail target is another agent) |

**Agents NOT affected:**
- **Developer:** Does not use `resolvePrerequisite`-based re-engagement; uses `isMostRecentPipelineFail("implementation")` directly. No deadlock possible.
- **Documentation:** Self-reworks at P4 already (REWORK action on FAIL). No WAIT_FOR_REWORK exists in its priority chain.
- **Release Engineer:** Self-reworks at P4 already (REWORK action on FAIL). No WAIT_FOR_REWORK exists in its priority chain.

**Interaction with §21.66:** This fix is complementary. §21.66 prevents the infinite re-engagement loop (`null → false`). §21.67 prevents the resulting deadlock when the agent should self-rework but the recommendation engine tells it to wait. Both fixes are required for correct behavior of first-active-stage compositions.

**Related sections:** [§9.3.1](pipeline-routing.md#931-fail-routing-fallback) (`resolveFailAgent` fallback), [§14.3](recommendations.md#143-qa-action-logic) (QA action priorities), [§14.4](recommendations.md#144-reviewer-action-logic) (Reviewer action priorities), [§14.5b](recommendations.md#145b-security-auditor-action-logic) (Security Auditor action priorities), [§21.63](#2163-fail-routing-fallback-semantics) (FAIL routing fallback examples), [§21.66](#2166-first-active-stage-re-engagement-loop) (re-engagement loop fix)

### 21.68 Orphaned Pipeline Recovery (Agent Crash Between begin_work and complete_pipeline)

- **Scenario:** An agent calls `ledger_begin_work` (which creates an `IN_PROGRESS` pipeline on the WP) and then crashes, errors out, or is interrupted before calling `ledger_complete_pipeline`. The pipeline remains in `IN_PROGRESS` indefinitely — the WP cannot accept a new pipeline of the same type (duplicate guard in §11.1), and the next `ledger_begin_work` call is rejected.
- **Detection:** On restart or re-invocation, `ledger_get_next_action` for the agent's role returns `RESUME_OR_CANCEL` (§14.7) when it detects an active pipeline that has exceeded the stale threshold (`STALE_PIPELINE_HOURS`). Alternatively, the orchestrator MAY detect the orphaned pipeline immediately after an agent exception if it can inspect the WP's in-progress pipeline state.
- **Prescribed recovery:** The orchestrator or recovering agent MUST call `cancelPipeline` (§12.5) with `auto_cancelled = true` before retrying the stage. Setting `auto_cancelled = true` ensures the crash-recovery cancellation does not consume the per-pipeline rework budget (§16.2, §21.27) — the failure was caused by infrastructure, not agent quality.

```
function recoverOrphanedPipeline(wp, pipelineType, reason):
  // Verify the pipeline is actually orphaned (IN_PROGRESS with no recent activity)
  orphaned = wp.pipelines
    .filter(p => p.type == pipelineType AND p.status == "IN_PROGRESS")
    .last()

  if orphaned is null:
    return    // Nothing to recover

  // Cancel with auto_cancelled = true (not a quality failure)
  cancelPipeline(wp, root, pipelineType, reason, "Project Manager",
                 { auto_cancelled: true })
```

- **Rework budget preservation:** The `auto_cancelled = true` flag excludes the orphaned pipeline from `effectiveSamePipelines` in rework detection (§11.1) and from all circuit-breaker calculations (§21.27). The agent may retry up to `MAX_REWORK_COUNT` times on genuine quality failures without any budget consumed by the infrastructure crash.
- **Multiple orphaned pipelines:** If an agent crashes repeatedly across multiple invocations (e.g., due to a persistent environment issue), each recovery call to `cancelPipeline` with `auto_cancelled = true` does not increment the rework count. The circuit breaker is therefore not a useful safeguard against repeated infrastructure crashes — a separate orchestrator-level retry limit (e.g., a maximum number of crash-recovery attempts per WP per run) is recommended for automated systems.
- **Distinction from manual PM cancellation:** A PM calling `cancelPipeline` to abort a pipeline whose output is known to be incorrect is an operational decision (the pipeline represents a genuine failure), not crash recovery. In this case `auto_cancelled` SHOULD be `false` (default) so the rework budget accurately reflects the number of genuine failure cycles.

### 21.69 Handoff Handler Active-Stage Scoping

- **Invariant:** All per-role handoff functions (§13.1) MUST scope their pipeline-specific conditions to WPs that include the handler's owned pipeline type in `active_pipeline_stages`. Without this scoping, a WP with a non-default composition (e.g., `["documentation"]`) is visible to all handlers, and conditions that check for pipeline absence (e.g., "no implementation pipeline → needs work") incorrectly classify the WP as having pending work
- **Consequence of violation:** The handler returns `IN_PROGRESS` for non-applicable WPs, suppressing auto-handoff (§18) — the `auto_handoff` block is only generated for `READY_FOR_*` statuses, not `IN_PROGRESS`
- **Correct pattern:** Each pipeline-specific condition in the handoff pseudocode includes `with "<pipeline-type>" in activeStages`, matching the pattern established by the Security Auditor and Release Engineer handlers (§13.1). The `activeStages` variable defaults to `DEFAULT_PIPELINE_STAGES` when absent or null, preserving backward compatibility with WPs created before composable stages existed
- **Non-scoped conditions:** The "all WPs terminal" check and `assigned_to` fallback apply to ALL WPs regardless of active stages — these are project-level completeness checks, not pipeline-specific
- **Interaction with §21.60–§21.62:** Single-stage and restricted-composition WPs (documentation-only, verification-only) are the primary trigger for this issue. With correct scoping, a documentation-only WP is invisible to Developer/QA/Reviewer handoff logic, and only Documentation/PM handlers route it
- **PM routing:** The Project Manager handoff uses `firstActiveStage(wp)` (§6.2.1) to route unassigned READY WPs to the correct agent, rather than hardcoding `READY_FOR_DEVELOPER`. This ensures documentation-only WPs are routed to `READY_FOR_DOCS` and other non-default compositions reach the correct starting agent
- **Documentation null-prerequisite:** When `resolvePrerequisite("documentation", activeStages)` returns `null` (documentation is the first or only active stage), the `hasPassEffectiveUpstream` condition is vacuously true — no prerequisite is needed, consistent with `canStartPipeline` (§8.2). The `hasNewUpstreamPassSince(null, "documentation")` call returns `false` per §14.6 (no pipeline of type `null`), so first-active-stage documentation WPs only match via the "no documentation pipeline yet" branch
- **Related sections:** [§13.1](handoff.md#131-per-agent-handoff-functions) (handoff functions), [§14.2–§14.5c](recommendations.md) (recommendation engine — correctly scoped since v2.4.0), [§18](auxiliary-systems.md#18-auto-handoff-depth-counter) (auto-handoff eligibility)

**Related sections:** [§12.5](operations.md#125-pipeline-cancellation-cancelpipeline) (`cancelPipeline` operation and `auto_cancelled` semantics), [§21.27](#2127-auto-cancelled-pipelines) (auto-cancelled pipeline exclusion rules), [§16.3](dependencies-and-rework.md#163-circuit-breaker) (circuit breaker and rework budget), [§16.3c](dependencies-and-rework.md#163c-circuit-breaker-escalation-for-automated-orchestrators) (orchestrator escalation guidance)

### 21.70 PM Pipeline-Routing for IN_PROGRESS WPs

When all READY WPs have been claimed and all remaining WPs are IN_PROGRESS, the PM handoff previously returned WAIT — leaving no `auto_handoff` target to dispatch the next pipeline agent after a stage PASSed. Step 2b (§13.1) and priority 3d (§14.1.2) close this gap by scanning IN_PROGRESS WPs for pipeline stage transitions.

**Two covered scenarios:**

- **(a) Stage PASS → next stage:** A pipeline stage has completed with PASS and the next active stage has no pipeline started yet. The PM routes to `PIPELINE_AGENT_MAP[nextStage]`, engaging the next agent in the WP's pipeline chain without requiring a READY WP to trigger the handoff.
- **(b) Freshly-claimed WP with zero pipelines:** A WP was just claimed (status is IN_PROGRESS) but the owning agent has not yet called `startPipeline`. No pipelines exist, so the first active stage has no PASS, no FAIL, and no IN_PROGRESS. The algorithm routes to `PIPELINE_AGENT_MAP[firstActiveStage(wp)]`, providing immediate auto-handoff rather than waiting for the `REVIEW_ABANDONED` staleness threshold (§14.1.2 priority 3b) to expire.

**Guards (identical in both §13.1 step 2b and §14.1.2 priority 3d):**

- **FAIL stage:** If the first non-PASS stage's most recent non-auto-cancelled pipeline is FAIL, the WP is skipped. FAIL routing is handled by the downstream agent's own handoff — the PM should not override it.
- **IN_PROGRESS stage:** If the first non-PASS stage already has an active IN_PROGRESS pipeline, the WP is skipped — the stage is currently being worked on.
- **Upstream IN_PROGRESS:** If the prerequisite stage (via `resolvePrerequisite`) has an IN_PROGRESS pipeline, the WP is skipped — the upstream stage has not finished, making routing to the next stage premature.
- **Dependency-blocked WPs:** Non-dependency-blocked is a prerequisite for inclusion — WPs with status BLOCKED and a `dependency` blocker type (or absent blocker) are excluded entirely.

**Priority ordering:** Step 2b fires only after step 2 (READY WPs) finds no matches, preserving the invariant that READY WPs are always routed before any IN_PROGRESS pipeline-routing logic. Priority 3d in the recommendation engine is similarly positioned after all monitoring/repair priorities (3, 3b, 3c) and before the terminal WAIT.

**Related sections:** [§13.1](handoff.md#131-per-agent-handoff-functions) (PM Handoff step 2b pseudocode), [§14.1.2](recommendations.md#1412-project-manager-action-logic) (priority 3d ROUTE_PIPELINE_AGENT), [§21.46](#2146-pm-handoff-single-return-for-multiple-ready-wps) (single-return limitation and batch action system), [§21.40](#2140-abandoned-wp-detection-claimed-but-no-pipeline) (REVIEW_ABANDONED for staleness-threshold coverage)

### 21.71 Cross-WP Dispatch from Non-PM Agents

#### Stall scenario

A non-PM pipeline agent (QA, Security Auditor, Reviewer, Release Engineer, or Documentation) completes the final pipeline stage of WP-001. WP-002 is `READY` with zero pipelines and satisfied dependencies. Without cross-WP dispatch, the handoff function for the completing agent falls through to its terminal `return WAIT`. The IDE receives `WAIT` and has no `auto_handoff` target to fire — the workflow stalls until the orchestrator's supervisor polling loop detects the READY WP and resumes.

In headless orchestrator mode the polling loop handles this automatically. In IDE runner mode (where there is no polling loop), the stall is permanent until a human intervenes.

#### Resolution via `findNextReadyDispatch()`

The `findNextReadyDispatch()` helper (§13.5) is inserted as the **penultimate step** in each of the five affected handoff functions, immediately before the final `return WAIT`. The helper:

1. Scans all WPs for any with `status == "READY"` and satisfied dependencies (i.e., `!isBlockedByDependencies(wp)`).
2. For the first matching WP, resolves `targetRole = PIPELINE_AGENT_MAP[firstActiveStage(wp)]` and returns a `READY_FOR_<ROLE>` dispatch.
3. If no READY WP exists but all WPs are terminal, returns `READY_FOR_SYNTHESIS`.
4. Otherwise returns `null`, allowing the caller to fall through to its own `return WAIT`.

When the helper returns a non-null dispatch, the handoff function returns that dispatch **instead** of `WAIT`, giving the IDE a concrete next-agent target.

#### Self-routing

`findNextReadyDispatch()` does **not** filter out cases where `targetRole == currentRole` (the calling agent). Self-routing is intentional: even when the same agent is the correct owner of WP-002's first active stage, the handoff still returns `READY_FOR_<ROLE>` rather than `WAIT`. This causes the IDE to visibly declare a new handoff step, making it explicit that a fresh work package is being bootstrapped. Auditability and IDE-vs-orchestrator alignment are preserved.

**Example:** Documentation completes the final pipeline stage of WP-001. WP-002 is a documentation-only WP (`active_pipeline_stages = ["documentation"]`). `findNextReadyDispatch()` resolves `targetRole = "Documentation"` and returns `READY_FOR_DOCS`. The Documentation handoff returns `READY_FOR_DOCS` — causing the IDE to re-dispatch to Documentation for WP-002 — rather than `WAIT`.

#### Invariant

Cross-WP dispatch is a **best-effort optimization for IDE runners**. The orchestrator's supervisor polling loop already re-dispatches READY WPs without relying on this mechanism. Implementations that omit `findNextReadyDispatch()` remain correct in orchestrator mode; the fix only prevents stalls in IDE mode. No invariants of the core state machine are affected — READY WPs and pipeline ownership rules are unchanged.

**Related sections:** [§13.5](handoff.md#135-findnextreadydispatch-algorithm) (`findNextReadyDispatch` algorithm), [§13.1](handoff.md#131-per-agent-handoff-functions) (per-agent handoff functions — QA, Security Auditor, Reviewer, Release Engineer, Documentation each call `findNextReadyDispatch()` before final WAIT), [§21.70](#2170-pm-pipeline-routing-for-in_progress-wps) (PM equivalent for IN_PROGRESS WP routing)
```
```
// Structure of documents
└── mcp-server/
    └── docs/
        └── agents/
            └── workflow-specification/
                └── dependencies-and-rework.md

```
###  Path: `/mcp-server/docs/agents/workflow-specification/dependencies-and-rework.md`

```md
# Dependencies & Rework

> Part of the [Agent Workflow Specification](README.md).

---

## 15. Dependency Management

### 15.1 Initial Status Based on Dependencies

When creating a WP:

```
if dependencies is empty OR all dependencies have terminal status:
  initial_status = READY
  blocked_by = null
else:
  initial_status = BLOCKED
  unresolvedDeps = dependencies.filter(d => NOT isTerminalStatus(d.status))
  blocked_by = {
    type: "dependency",
    description: "Depends on " + unresolvedDeps.map(d => d.work_package_id).join(", "),
    blocking_work_package: unresolvedDeps[0].work_package_id
  }
```

> **Single-blocker limitation:** The `blocking_work_package` field references only the first unresolved dependency. The `description` field lists all unresolved dependencies for diagnostic visibility, but `blocked_by` is a single object (see [§21.35](edge-cases.md#2135-single-blocker-metadata-limitation)). This does not affect auto-unblock correctness — `propagateDependencyUnblock` (§15.4) checks **all** dependencies regardless of the `blocked_by` content.

### 15.2 Dependency Validation on Creation

All dependency IDs must exist in the root index. Unknown IDs are rejected.

Dependency graphs must be **acyclic**. On creation, perform a cycle check:

```
function hasCycle(newWpId, dependencies, allSummaries):
  visited = Set()
  queue = [...dependencies]
  
  while queue is not empty:
    current = queue.pop()
    if current == newWpId:
      return true    // Cycle detected
    if visited.has(current):
      continue
    visited.add(current)
    dep = allSummaries.find(s => s.work_package_id == current)
    if dep is not null:
      queue.pushAll(dep.dependencies)
  
  return false
```

If a cycle is detected, the WP creation is rejected with an error identifying the cycle path.

> **Structural note — defense-in-depth only:** Under normal operation, cycles are impossible by construction. WP IDs are generated sequentially (§3.6) and dependencies must reference pre-existing IDs (§15.2 validation above), so no existing WP can list `newWpId` as a dependency — the traversal from the new WP's dependencies through the graph can never reach `newWpId`. This check exists as defense-in-depth against data corruption (e.g., a WP referencing a future ID due to manual file editing or interrupted writes). Implementations SHOULD still include it, but should not rely on it as the primary cycle-prevention mechanism — the sequential-ID + existing-ID-only invariants are the real guards.

> **Deliberate limitation — no post-creation dependency updates:** The `dependencies` array is set at WP creation time and cannot be modified thereafter. No `updateDependencies` or `addDependency` operation exists. If the PM discovers mid-project that WP-005 depends on WP-003, the available workarounds are: (a) cancel WP-005 and recreate it with the correct dependencies (losing all pipeline history and rework counts), or (b) manually BLOCKED WP-005 with a `dependency` blocker referencing WP-003 — however, this workaround does not participate in `propagateDependencyUnblock` (§15.4) because auto-unblock checks the `dependencies` array, not the `blocked_by` field; the PM must manually unblock when WP-003 completes. This limitation keeps the dependency graph immutable after creation, simplifying cycle detection and cascade logic. Implementations that need post-creation dependency mutation SHOULD add an `updateDependencies` operation with cycle detection, auto-block/unblock re-evaluation, and root index synchronization.

### 15.3 Dependency Check for Claiming

```
function canStartWorkPackage(wp, allSummaries):
  for each depId in wp.dependencies:
    dep = allSummaries.find(s => s.work_package_id == depId)
    if dep is null:
      return { allowed: false, reason: "Dependency not found" }
    if not isTerminalStatus(dep.status):
      return { allowed: false, reason: "Dependency not complete" }
  return { allowed: true }
```

> Both COMPLETE and CANCELLED satisfy dependency requirements.
>
> **Design note on CANCELLED:** A cancelled WP unblocks its dependents even though the work was never completed. This is intentional — the Project Manager is responsible for validating that the dependency is no longer needed before cancelling. If dependent WPs still require the deliverables, the PM should restructure dependencies before cancelling.

### 15.4 Automatic Unblocking (propagateDependencyUnblock)

When a WP transitions to a terminal status (COMPLETE or CANCELLED):

```
function propagateDependencyUnblock(projectPath, completedWpId):
  acquire lock
  read root index
  
  candidates = root.work_packages.filter(
    wp => wp.status == "BLOCKED" AND wp.dependencies.includes(completedWpId)
  )
  
  for each candidate:
    wpDetail = readWorkPackage(candidate.id)
    
    // Check ALL dependencies, not just the one that completed
    if not canStartWorkPackage(wpDetail, root.work_packages).allowed:
      continue    // Other dependencies still incomplete
    
    // Skip non-dependency blockers
    if wpDetail.blocked_by AND wpDetail.blocked_by.type not in ["dependency", null]:
      continue    // External/decision/technical blockers need manual resolution
    
    // Unblock
    wpDetail.status = "READY"
    wpDetail.blocked_by = null
    root.work_packages[candidate.id].status = "READY"
    
    write wpDetail
  
  write root index
  release lock
```

> **Design note — auto-unblock always transitions to READY (not back to IN_PROGRESS):**
> When a WP was blocked, its context may have drifted — the agent that originally claimed it may no longer be in session, the implementation plan may have changed, or the unblocking dependency's output may differ from what was assumed. Requiring an explicit re-claim (READY → IN_PROGRESS) is a safe default that forces the agent to re-evaluate the WP before resuming.
>
> The `assigned_to` field is preserved through the block/unblock cycle, so the recommendation engine will still route the WP to the correct agent. The re-claim step is lightweight (single tool call) and provides explicit confirmation of intent.

> **\u26a0 Stuck-agent limitation:** Because `assigned_to` is preserved through the block/unblock cycle, the WP is routed exclusively to the preserved agent after auto-unblock. If that agent is no longer available (session ended, agent crashed), no other pipeline agent can claim the WP without PM override (`claimWorkPackage` §10.1 rejects when `wp.assigned_to` is set and the caller differs). The WP will eventually be surfaced via the PM's `REVIEW_ABANDONED` action ([§14.1.2](recommendations.md#1412-project-manager-action-logic), priority 3b), but this requires the staleness threshold to elapse. Implementations that need faster recovery MAY detect assignment-to-absent-agent conditions (e.g., cross-referencing `assigned_to` with active agent sessions) and proactively unclaim the WP.

### 15.5 Cascade Reblocking (propagateDependencyReblock)

When a COMPLETE WP is reopened (COMPLETE → IN_PROGRESS):

```
function propagateDependencyReblock(projectPath, reopenedWpId):
  acquire lock
  read root index
  
  // Find non-terminal, non-BLOCKED WPs that depend on the reopened WP
  candidates = root.work_packages.filter(
    wp => not isTerminalStatus(wp.status)
      AND wp.status != "BLOCKED"
      AND wp.dependencies.includes(reopenedWpId)
  )
  
  for each candidate:
    wpDetail = readWorkPackage(candidate.id)
    
    // Cancel any IN_PROGRESS pipelines (they are now invalid)
    for each pipeline in wpDetail.pipelines:
      if pipeline.status == "IN_PROGRESS":
        pipeline.status = "FAIL"
        pipeline.completed_at = now()
        pipeline.summary = ["Auto-cancelled: dependency {reopenedWpId} was reopened"]
        pipeline.auto_cancelled = true    // Excludes from rework budget (§21.27)
    
    wpDetail.status = "BLOCKED"
    wpDetail.blocked_by = {
      type: "dependency",
      description: "Dependency {reopenedWpId} was reopened",
      blocking_work_package: reopenedWpId
    }
    root.work_packages[candidate.id].status = "BLOCKED"
    
    write wpDetail
  
  // Warn about transitive dependents that may be working on stale assumptions.
  // Cascade reblock only targets DIRECT dependents of the reopened WP.
  // Transitive dependents (WPs that depend on a direct dependent) are NOT
  // automatically reblocked. Their in-flight pipelines continue executing
  // against potentially invalidated assumptions. This is a known limitation:
  // State-machine integrity is preserved: transitive dependents cannot
  //   reach COMPLETE because their direct dependency (now BLOCKED) is
  //   non-terminal, failing the freshness/dependency checks.
  // - However, in-flight work on transitive dependents may be wasted.
  // - Implementations MAY extend this function with recursive traversal to
  //   reblock transitive dependents. If so, use the same auto_cancelled
  //   pipeline closure pattern and dependency blocker as direct dependents.
  // See §21.42 for the full discussion of this limitation.

  // Warn about COMPLETE dependents that may now be stale
  completeDependents = root.work_packages.filter(
    wp => wp.status == "COMPLETE"
      AND wp.dependencies.includes(reopenedWpId)
  )
  
  for each completeDep in completeDependents:
    root.project_comments.append({
      type: "warning",
      priority: "high",
      timestamp: now(),
      agent: "system",
      note: "WP {completeDep.work_package_id} completed based on {reopenedWpId}, "
            + "which has been reopened. Review whether {completeDep.work_package_id} "
            + "needs rework."
    })
  
  // Recompute pending counter
  root.pending_work_packages = count(wp in root.work_packages where not isTerminalStatus(wp.status))
  
  // Safety net: ensure synthesis_generated is reset when a WP is reopened.
  // Primary reset happens during the COMPLETE → IN_PROGRESS transition (§6.2);
  // this catches the case where that reset was missed due to a crash.
  if root.synthesis_generated:
    root.synthesis_generated = false
    root.synthesis_generated_at = null    // §21.57: clear staleness timestamp
  
  root.last_updated = now()
  write root index
  release lock
```

### 15.6 Blocker Types

| Type | Auto-Clearable? | Description |
|------|----------------|-------------|
| `dependency` | Yes | Cleared when all dependencies become terminal |
| `decision` | No | Requires human decision |
| `external` | No | External factor (third-party, infrastructure) |
| `technical` | No | Technical issue requiring investigation |

Only `dependency` blockers (or absent `blocked_by.type`) are auto-cleared by `propagateDependencyUnblock`. All other types require manual intervention.

---

## 16. Rework & Circuit Breaker

### 16.1 Rework Detection

Rework is detected when starting a pipeline where either:
1. The most recent same-type pipeline has FAIL status (direct rework), OR
2. The most recent same-type pipeline has PASS status but a downstream pipeline has FAIL status (downstream-triggered rework)

```
samePipelines = wp.pipelines.filter(p => p.type == pipelineType)
isDirectRework = samePipelines is not empty AND samePipelines.last().status == "FAIL"
isDownstreamRework = not isDirectRework AND hasDownstreamFail(wp.pipelines, pipelineType)
needsRework = isDirectRework OR isDownstreamRework
```

### 16.2 Rework Counts (Per-Pipeline)

- Field: `rework_counts` on WorkPackageDetail (map of PipelineType → integer)
- Initial value: absent; lazily initialized on first rework. For WPs with `active_pipeline_stages`, the map includes one entry per active stage: e.g., `{ implementation: 0, qa: 0, security-audit: 0, code-review: 0, release-engineering: 0, documentation: 0 }` for a full 6-stage WP, or `{ implementation: 0, qa: 0, code-review: 0, documentation: 0 }` for a default 4-stage WP (see §11.1 for initialization logic)
- Each pipeline type's counter increments independently when starting that pipeline type after a direct or downstream FAIL
- Not incremented when: no previous pipeline, or most recent same-type is PASS with no downstream FAIL

> **Backward compatibility:** If the legacy scalar `rework_count` field is present, treat its value as `rework_counts.implementation` and migrate to the map structure on next write.

### 16.3 Circuit Breaker

```
MAX_REWORK_COUNT = 5

When rework_counts[pipelineType] >= MAX_REWORK_COUNT:
  - startPipeline REJECTS the call for that specific pipeline type
  - getNextAction returns BLOCK_FOR_REWORK_LIMIT
  - Human intervention required: cancel or restructure the WP
```

The circuit breaker is evaluated **per pipeline type**. Reaching the limit on `documentation` does not block `implementation` rework, and vice versa.

### 16.3b Circuit Breaker Reset

When the circuit breaker trips, the only prescribed recovery paths are cancelling or "restructuring" the WP — but restructuring is undefined, and cancellation loses all pipeline history. The following PM-only operation provides a targeted recovery path.

```
function resetReworkCount(wp, root, pipelineType, agentRole, reason):
  // Guard: PM only
  if agentRole != "Project Manager":
    ERROR("Only the Project Manager can reset rework counts")

  // Guard: Reason is required (audit trail)
  if reason is empty:
    ERROR("A reason is required when resetting rework counts")

  counts = wp.rework_counts
  if counts is null OR (counts[pipelineType] ?? 0) == 0:
    return    // Nothing to reset

  previousValue = counts[pipelineType]
  counts[pipelineType] = 0
  wp.rework_counts = counts

  // Record the reset for auditability
  root.project_comments.append({
    type: "rework_reset",
    priority: "high",
    timestamp: now(),
    agent: "Project Manager",
    note: "Reset rework count for {pipelineType} on {wp.work_package_id} "
          + "from {previousValue} to 0. Reason: {reason}"
  })

  root.last_updated = now()
  write wp
  write root
```

> **Use case:** After investigating a root cause (e.g., flaky test environment, misunderstood requirement), the PM resets the counter to allow retries. The mandatory reason and project comment ensure the decision is auditable. The PM should address the root cause before resetting — otherwise the circuit breaker will trip again after `MAX_REWORK_COUNT` additional attempts.

### 16.3c Circuit Breaker Escalation for Automated Orchestrators

The circuit breaker (§16.3) is designed around a human Project Manager who can review `REVIEW_REWORK_LIMIT` recommendations and decide whether to cancel or restructure the affected WP (see §16.3b for the PM reset operation). In **automated (headless) orchestrators** where no interactive PM is available, a circuit-broken WP would block indefinitely — `startPipeline` rejects the call, no human can reset the counter, and the project can never reach synthesis because `pending_work_packages > 0`.

**Prescribed behavior for automated orchestrators:**

When `getNextAction` returns a `REVIEW_REWORK_LIMIT` recommendation for a WP and no PM intervention is available (the system is running headlessly), the orchestrator SHOULD:

1. **Log the circuit-breaker event** — Record the WP ID, the circuit-broken pipeline type, the rework count, and a diagnostic note explaining that the circuit breaker was reached. This ensures the operator has visibility into which WPs were affected and why.
2. **Transition the WP to CANCELLED** — Call `updateWorkPackageStatus(CANCELLED)` on the circuit-broken WP. This is a PM-level operation; automated orchestrators acting as PM surrogates must invoke it with `agent_role: "Project Manager"`. Cancellation is terminal (§21.1) — the WP's pipeline history is preserved for post-run analysis, and `synthesis_generated` is not reset (§21.38).
3. **Allow the project to proceed to synthesis** — Once all remaining WPs are terminal (COMPLETE or CANCELLED), `completeSynthesis` (§19.1) can proceed. The Synthesis agent's final report SHOULD document cancelled WPs and the reason for cancellation.

> **Rationale:** The circuit breaker threshold (`MAX_REWORK_COUNT = 5`) represents a systemic failure — 5 rework cycles without resolution indicates either a persistent bug, a fundamentally flawed requirement, or an environmental issue. In a headless run, the correct recovery is to preserve the evidence (cancel rather than delete), proceed with the deliverable WPs, and document the failure in the synthesis report. This is preferable to leaving the project stuck indefinitely, which produces no output and obscures the partial progress made on other WPs.

> **PM reset as alternative:** If the automated system has access to an emergency PM intervention path (e.g., a human-triggered override webhook), the PM MAY reset the rework count via `ledger_reset_rework_count` (§16.3b) and let the orchestrator retry. This is preferable to cancellation when the root cause has been identified and fixed (e.g., a flaky test environment was repaired). Cancellation should be the default when no such path exists.

> **Halted WPs and synthesis:** Some orchestrators implement a local circuit breaker (e.g., 3 consecutive failures → "halted" state) that prevents further invocation of the agent for that WP within the current run, even though the WP remains `IN_PROGRESS` in the ledger. Such halted WPs must be transitioned to `CANCELLED` before `completeSynthesis` is called, because the synthesis guard requires `pending_work_packages == 0` — a halted `IN_PROGRESS` WP still counts as pending.

**Related sections:** [§16.3b](#163b-circuit-breaker-reset) (PM rework count reset), [§21.68](edge-cases.md#2168-orphaned-pipeline-recovery-agent-crash-between-begin_work-and-complete_pipeline) (orphaned pipeline recovery), [§19.1](auxiliary-systems.md#191-algorithm) (`completeSynthesis` pending guard)

### 16.4 Rework Flow

The canonical 6-stage pipeline. Stages not in a WP's `active_pipeline_stages` are skipped via `resolveNextAgent` (§9.2).

```
                    ┌───────────┐
                    │ Developer │
                    │implements │
                    └─────┬─────┘
                          │
                    ┌─────▼─────┐
                    │  QA runs  │
                    │  tests    │
                    └─────┬─────┘
                          │
                   ┌──────┴──────┐
                 PASS           FAIL ──► Developer fixes
                   │                    (rework_counts.implementation++)
            ┌──────▼──────────┐
            │[Security Audit] │  ◄── optional; skipped if not in active stages
            └──────┬──────────┘
                   │
            ┌──────┴──────┐
          PASS           FAIL ──► Developer fixes
            │                    (rework_counts.implementation++)
            │
            ┌──────▼──────┐
            │  Reviewer   │
            │  reviews    │
            └──────┬──────┘
                   │
            ┌──────┴──────┐
          PASS           FAIL ──► Developer fixes
            │                    (rework_counts.implementation++)
            │
     ┌──────▼─────────────────┐
     │[Release Engineering]   │  ◄── optional; skipped if not in active stages
     └──────┬─────────────────┘
            │
         ┌──┴──┐
       PASS   FAIL ──► Release Engineer self-reworks
         │            (rework_counts.release-engineering++)
         │
     ┌───▼──────────┐
     │Documentation │
     │  writes      │
     └──────┬───────┘
            │
         ┌──┴──┐
       PASS   FAIL ──► Documentation self-reworks
         │            (rework_counts.documentation++)
         │
      COMPLETE → Synthesis (after all WPs complete)
```

> **FAIL routing summary:** QA, Security Audit, and Code Review FAILs route to Developer (`rework_counts.implementation++`). Release Engineering and Documentation FAILs route to self-rework (`rework_counts.release-engineering++` and `rework_counts.documentation++` respectively). Each rework budget is independent — reaching the circuit breaker limit on one pipeline type does not block other pipeline types (§16.3).
>
> **Stage skipping:** When a stage is not in a WP's `active_pipeline_stages`, the corresponding box in the diagram is skipped entirely — PASS from the preceding stage flows directly to the next active stage via `resolveNextAgent` (§9.2).

```
```
// Structure of documents
└── mcp-server/
    └── docs/
        └── agents/
            └── workflow-specification/
                └── auxiliary-systems.md

```
###  Path: `/mcp-server/docs/agents/workflow-specification/auxiliary-systems.md`

```md
# Auxiliary Systems

> Part of the [Agent Workflow Specification](README.md).

---

## 17. Self-Healing

The project status tool auto-corrects counters and project status on every read.

### 17.1 Healed Fields

- `total_work_packages`: recomputed as `work_packages.length`
- `pending_work_packages`: recomputed as count of non-terminal WPs
- `status`: corrected based on rules below

### 17.2 Healing Rules (Applied in Order — First Match Wins)

> **Numbering convention:** Rules are grouped by the project status they match against. Sub-rules (e.g., 1b, 1c) share the same status condition as their parent but differ in secondary conditions. Rules 1/1b/1c all match `pending == 0 AND total > 0` but diverge on `synthesis_generated` and the current project status.

| # | Condition | Healed Status |
|---|-----------|---------------|
| 1 | (`IN_PROGRESS` or `READY`) AND `pending == 0` AND `total > 0` AND `synthesis_generated` | `COMPLETE` |
| 1b | `READY` AND `pending == 0` AND `total > 0` AND NOT `synthesis_generated` | `IN_PROGRESS` (all WPs done, awaiting synthesis — see note below) |
| 1c | `IN_PROGRESS` AND `pending == 0` AND `total > 0` AND NOT `synthesis_generated` | Preserve `IN_PROGRESS` (no change — awaiting synthesis) |
| 2 | `COMPLETE` AND `pending > 0` | `IN_PROGRESS` (reopen/drift repair) |
| 2b | `COMPLETE` AND `pending == 0` AND `total > 0` AND NOT `synthesis_generated` | `IN_PROGRESS` (synthesis not yet run — project completion requires synthesis) |
| 3 | `READY` AND any WP is `IN_PROGRESS` | `IN_PROGRESS` |
| 3b | `READY` AND `pending > 0` AND no WP is `READY` or `IN_PROGRESS` | `BLOCKED` (all remaining WPs are blocked) |
| 3c | `IN_PROGRESS` AND `pending > 0` AND no WP is `READY` or `IN_PROGRESS` | `BLOCKED` (drift repair: all remaining WPs are blocked) |
| 4 | `BLOCKED` AND any WP is `IN_PROGRESS` | `IN_PROGRESS` (progress possible despite some WPs still blocked) |
| 4b | `BLOCKED` AND any WP is `READY` (none `IN_PROGRESS`) | `READY` (progress possible via READY WPs, even if other WPs remain blocked) |
| 5a | `BLOCKED` AND `pending == 0` AND `total > 0` AND `synthesis_generated` | `COMPLETE` |
| 5b | `BLOCKED` AND `pending == 0` AND `total > 0` AND NOT `synthesis_generated` | `IN_PROGRESS` (all WPs done, awaiting synthesis) |
| 6 | Empty project (no WPs) | Never auto-healed to `COMPLETE` |
| 6b | (`IN_PROGRESS` or `BLOCKED`) AND `total == 0` | `READY` (drift repair: no WPs exist to process) |
| 6c | `COMPLETE` AND `total == 0` | `READY` (drift repair: project marked complete with no WPs — see note below) |

> **Rule 1b/1c/5b semantic note:** In the "all WPs terminal, awaiting synthesis" state, no WP is actively being worked on, yet the project is healed to `IN_PROGRESS`. This extends the §5.2 definition of `IN_PROGRESS` beyond its literal meaning ("at least one WP is being worked on") to also cover the post-completion, pre-synthesis phase. `IN_PROGRESS` is the best available status — the project is neither `READY` (work has been done), `BLOCKED` (synthesis can proceed), nor `COMPLETE` (synthesis hasn't run). Implementations should treat `IN_PROGRESS` with `pending == 0` and `synthesis_generated == false` as the "awaiting synthesis" sub-state.

> **Rule 6b rationale:** If data corruption or an interrupted operation leaves a project `IN_PROGRESS` or `BLOCKED` with zero work packages, no agent can make progress and no other healing rule matches. Healing to `READY` is the most conservative repair — the Project Manager can then re-create work packages.

> **Rule 6c rationale:** A `COMPLETE` project with zero work packages is contradictory — `completeSynthesis` (§19.1) explicitly requires at least one WP. This state can only arise from data corruption (e.g., WP files deleted after synthesis). Healing to `READY` allows the Project Manager to re-create work packages. Without this rule, a COMPLETE-but-empty project would persist in an inconsistent state with no self-repair path.

> **Rule 4 rationale:** A project should not stay `BLOCKED` when some WPs can make progress. Even if other WPs remain `BLOCKED`, the presence of an `IN_PROGRESS` WP means at least one agent can advance. This mirrors rule 3 (which handles the `READY` → `IN_PROGRESS` case) for the `BLOCKED` → `IN_PROGRESS` case.

> **Rule 4b rationale:** Extends rule 4 to the `READY` case. After a partial auto-unblock (§15.4), some WPs may become `READY` while others remain `BLOCKED`. Per §5.2, the project should not be `BLOCKED` when any WP is `READY` or `IN_PROGRESS`. Without rule 4b, a partially-unblocked project would remain stuck in `BLOCKED` until all blocked WPs resolved — the prior rule 5b required "no WP is `BLOCKED`" in its condition, missing the mixed READY/BLOCKED case. Rule 4b subsumes former rule 5b (which was removed as unreachable once 4b was added). Rules 5a and 5b were renumbered (formerly 5a and 5c) and their "no WP is `BLOCKED`" condition was removed as redundant — after rules 4 and 4b filter out any project with `IN_PROGRESS` or `READY` WPs, a `BLOCKED` project with `pending == 0` can only contain terminal WPs (none `BLOCKED`).

> **Completeness note:** The healing rules above are designed for the four-status model (`READY`, `IN_PROGRESS`, `COMPLETE`, `BLOCKED`). The initial project state — `READY` with `total == 0` — intentionally matches no rule: self-healing is a no-op for this state because it is already correct (the PM has not yet created WPs). No catch-all rule exists — if a project enters a state that matches no rule (e.g., due to a future status value being added without corresponding healing rules), self-healing silently does nothing. Implementations that extend the status model MUST add corresponding healing rules to maintain the self-repair guarantee.

> **Known gap — stale `synthesis_generated` with pending WPs:** If data corruption sets `synthesis_generated = true` while WPs are still pending (`pending > 0`) and the project is `IN_PROGRESS`, no healing rule resets `synthesis_generated`. Self-healing only corrects project `status`, not the `synthesis_generated` flag (which is reset by COMPLETE → IN_PROGRESS transitions §6.2, cascade reblock §15.5, and WP creation on COMPLETE projects §21.51). If the pending WPs subsequently complete, rule 1 fires (`IN_PROGRESS AND pending == 0 AND synthesis_generated`) and auto-completes the project with a stale synthesis. **Mitigation:** Implementations SHOULD add a defensive check: if `synthesis_generated == true` AND `pending > 0`, reset `synthesis_generated = false` during self-healing. This is a corruption-only scenario (no normal operation produces this combination), so the risk is low, but the impact (silent stale completion) is high.

### 17.3 Write Optimization

```
function healProject(root):
  healed = computeHealedStatus(root)    // Pure function, no I/O
  
  if not healed.needsWrite:
    return root                          // No correction needed
  
  acquire lock
  freshRoot = readRootIndex()            // Re-read under lock
  freshHealed = computeHealedStatus(freshRoot)
  
  if freshHealed.needsWrite:
    apply corrections to freshRoot
    writeRootIndex(freshRoot)
  
  release lock
  return corrected root
```

The double-check (compute → lock → re-read → re-compute → write) prevents race conditions.

### 17.4 Optional Pipeline Ordering Validation

The `pipelines` array ordering invariant ([§3.4](data-model.md#34-pipeline)) is critical to the correctness of prerequisite checks, rework detection, and freshness checks. Implementations SHOULD add a defensive check during self-healing: verify that `started_at` timestamps across all pipelines in each WP are monotonically non-decreasing. If a violation is detected, emit a `"warning"` project comment identifying the affected WP. Self-healing does not attempt to reorder pipelines (the correct order may be ambiguous if timestamps were corrupted), but surfacing the violation allows the PM to investigate and repair the data.

---

## 18. Auto-Handoff Depth Counter

Prevents infinite agent-chain loops.

### 18.1 Storage

`auto_handoff_depth` field on the root index. Optional; absent = 0.

### 18.2 Constants

```
MAX_HANDOFF_DEPTH = 50    // Static floor; configurable at runtime via gui-config
```

### 18.2.1 Dynamic Effective Maximum

The static constant serves as a floor. Once work packages exist, the effective maximum scales with project size:

```
effectiveMax = max(MAX_HANDOFF_DEPTH, total_work_packages × 30)
```

| Project Size | Effective Max | Rationale |
|-------------|--------------|----------|
| 0 WPs (pre-planning) | 50 | Static floor applies |
| 1 WP | 50 | 1 × 30 = 30 < 50, floor applies |
| 3 WPs | 90 | 3 × 30 = 90 |
| 5 WPs | 150 | 5 × 30 = 150 |
| 8 WPs | 240 | 8 × 30 = 240 |

The `× 30` multiplier accounts for:
- **4–6 happy-path handoffs** per WP (Dev → QA → Security Auditor → Reviewer → Release Engineer → Doc; varies by active stages — 4 for the default pipeline, up to 6 when all stages are active)
- **~6–9 rework handoffs** per WP for typical rework patterns (2–3 QA/security-audit → Dev cycles, plus occasional Review → Dev cycles that restart the Dev → QA → [Security Audit] → Review chain)
- **~10–15 headroom** per WP for atypical rework, blocker resolution, self-rework cycles (Release Engineering, Documentation), and wasted handoff cycles from handoff/recommendation priority mismatches

> **Multiplier increased from 20 to 30 (v2.4.1):** Operational experience showed that the original `× 20` multiplier was insufficient for projects with complex rework patterns, multi-stage WPs, and the overhead of wasted handoff cycles (§18.4). The increased multiplier provides adequate headroom without compromising the loop-guard safety net.

> **Formula dependency on `MAX_REWORK_COUNT`:** The `× 30` multiplier assumes a `MAX_REWORK_COUNT` of 5 (the default). If `MAX_REWORK_COUNT` is configured higher, the rework handoff budget increases proportionally — roughly `MAX_REWORK_COUNT × 4` handoffs per WP for implementation rework (each cycle involves Dev → QA → potentially Security Auditor → Reviewer handoffs). Implementations that configure `MAX_REWORK_COUNT > 5` SHOULD increase the multiplier accordingly or adjust `MAX_HANDOFF_DEPTH` to ensure the effective maximum does not constrain legitimate rework.

> **Design intent:** The auto-handoff depth counter is a **safeguard against infinite loops**, not a throttle. The effective maximum should be high enough that a legitimate project completes without ever hitting it. If the counter is reached, it indicates a pathological loop — not normal workflow activity.

> **⚠ Shrinking effective maximum on WP cancellation:** The depth counter only resets on `completeSynthesis` (§18.4). If WPs are cancelled mid-project, `total_work_packages` decreases and `effectiveMax` shrinks accordingly (computed at handoff time via §18.3). However, the counter retains its accumulated value. This can retroactively exhaust the handoff budget — for example, a project that consumed 120 handoffs across 5 WPs has `effectiveMax = 150`; if 3 WPs are then cancelled, `effectiveMax = max(50, 2 × 30) = 60`, and the counter (120) already exceeds the new limit. No further auto-handoffs are possible. This is consistent with the design intent (loop guard, not throttle) but may surprise implementations. If this becomes a practical issue, implementations MAY add a PM action to manually reset the counter, or reset the counter as a side effect of WP cancellation.

### 18.3 Increment Path

```
function buildHandoffResponse(currentAgent, status, ..., store):
  if status in ["COMPLETE", "BLOCKED", "IN_PROGRESS"]:
    skip auto-handoff
  
  nextAgent = resolveNextAgent(status, currentAgent)
  if nextAgent is null:
    skip auto-handoff
  
  root = store.readRootIndex()
  currentDepth = root.auto_handoff_depth ?? 0
  effectiveMax = max(MAX_HANDOFF_DEPTH, root.total_work_packages * 30)
  
  if currentDepth < effectiveMax:
    root.auto_handoff_depth = currentDepth + 1
    store.writeRootIndex(root)
    agentId = getAgentId(nextAgent)  // null when persona has no id: field
    names = AGENT_NAMES[nextAgent]   // loaded from personas/name-mapping.json at startup
    include auto_handoff in response payload:
      {
        agent_name: nextAgentHandle,
        ...(agentId !== null ? { agent_id: agentId } : {}),
        cc_agent_name: names.claude_code.agent_name,   // e.g. "3-developer"
        vs_agent_name: names.vscode.agent_name,        // e.g. "3 - Developer v3.6.1"
        da_agent_name: names.deep_agents.agent_name,   // e.g. "3-developer"
        prompt: buildHandoffPrompt(projectPath, agentId ?? undefined)
        // prompt starts with "@{agentId}\n" when agentId is present — VS Code routes to the matching persona
      }
  else:
    omit auto_handoff from response
    // Emit warning for observability
    root.project_comments.append({
      type: "warning",
      priority: "high",
      timestamp: now(),
      agent: "system",
      note: "Auto-handoff depth limit reached ({currentDepth}/{effectiveMax}). "
            + "Agent chain terminated. Manual routing required."
    })
    store.writeRootIndex(root)
```

> **Name fields source:** `cc_agent_name`, `vs_agent_name`, and `da_agent_name` are loaded from `personas/name-mapping.json` (generated by `scripts/build-personas.js`) via the `AGENT_NAMES` constant in `mcp-server/src/utils/constants.ts`. The existing `agent_name` field (VS Code display name from the Agent Registry) is preserved for backward compatibility.

> **Concurrency note:** The depth-increment read-modify-write cycle (`readRootIndex` → increment → `writeRootIndex`) must be protected by the storage directory lock ([§20](#20-concurrency-model)) to prevent parallel handoff chains from racing past the depth limit. Implementations should acquire the lock before reading the depth counter.

### 18.4 Reset Path

The depth counter is reset to `0` **atomically inside `completeSynthesis`** (§19.1) when the project status transitions to `COMPLETE`. This ensures no window exists where the project is COMPLETE but the counter is stale.

```
// Inside completeSynthesis, after setting root.status = "COMPLETE":
if (root.auto_handoff_depth ?? 0) != 0:
  root.auto_handoff_depth = 0
// Written as part of the same writeRootIndex(root) call
```

Individual WP completions do **not** reset the counter. This prevents the counter from being reset N times in a project with N work packages, which would allow `MAX_HANDOFF_DEPTH × N` total handoffs and undermine the loop guard.

> **Wasted handoff cycles:** When the handoff function (§13.1) and the recommendation engine (§14) have different priority orderings (e.g., Documentation handoff checks new-work WPs before FAIL self-rework, while `getNextAction` checks FAIL self-rework first — see §14.5), a handoff may invoke an agent that immediately prioritizes different work than the handoff intended. Each such “wasted” handoff still increments the depth counter. Over many such cycles, this can consume depth budget without productive handoff progress. The dynamic scaling (§18.2.1) provides generous headroom to absorb this, but implementations that observe frequent wasted handoffs MAY consider aligning handoff and recommendation priorities for specific roles, or skipping the depth increment when the receiving agent's `getNextAction` targets a different WP than the handoff intended. Such optimizations are beyond the core specification.

### 18.5 Depth-Exceeded Behavior

- No error thrown
- `auto_handoff` key simply omitted from response
- A project comment of type `"warning"` with priority `"high"` is emitted: `"Auto-handoff depth limit reached ({currentDepth}/{effectiveMax}). Agent chain terminated. Manual routing required."`
- Agent chain terminates; manual routing required

> **Rationale:** Silent termination (without any diagnostic output) would cause headless orchestrators to stop processing with no indication of why. The warning comment ensures the Project Manager has visibility into the termination cause, mirroring the pattern used for null timestamp anomalies (§21.18).

### 18.6 Auto-Handoff Eligibility

`auto_handoff` is included in the response **only when ALL conditions are true**:

1. `auto_handoff_enabled` is `true` in runtime config
2. Agent registry is loaded (agent files discovered)
3. Next agent has a known handle in the registry
4. Status is not `COMPLETE`, `BLOCKED`, or `IN_PROGRESS`
5. `auto_handoff_depth` < `effectiveMax` (where `effectiveMax = max(MAX_HANDOFF_DEPTH, total_work_packages × 30)` — see [§18.2.1](#1821-dynamic-effective-maximum))

---

## 19. Synthesis Completion

### 19.1 Algorithm

```
function completeSynthesis(projectPath, agentRole):
  // Guard: Only Synthesis agent (or PM override) can complete synthesis
  if agentRole != "Synthesis" AND agentRole != "Project Manager":
    ERROR("Only Synthesis agent can complete synthesis (PM override allowed)")
  
  acquire lock
  root = readRootIndex()
  
  // Heal counters before checking (guard against stale pending count from
  // a prior crash or interrupted write — see §17)
  root.total_work_packages = root.work_packages.length
  root.pending_work_packages = count(wp in root.work_packages where not isTerminalStatus(wp.status))
  
  // Guard: All WPs must be terminal before synthesis can complete
  if root.pending_work_packages > 0:
    release lock
    ERROR("Cannot complete synthesis: {root.pending_work_packages} work packages still pending")
  
  // Guard: At least one WP must exist
  if root.work_packages.length == 0:
    release lock
    ERROR("Cannot complete synthesis: no work packages exist")
  
  root.synthesis_generated = true
  root.synthesis_generated_at = now()   // §21.57: enables staleness detection
  root.status = "COMPLETE"
  root.last_updated = now()
  
  // Reset auto-handoff depth counter atomically with project completion (§18.4)
  if (root.auto_handoff_depth ?? 0) != 0:
    root.auto_handoff_depth = 0
  
  writeRootIndex(root)
  release lock
```

### 19.2 Idempotency

Calling `completeSynthesis` multiple times after all WPs are terminal is safe. The flag is simply set to `true` again (and `synthesis_generated_at` is updated to the current time). However, calling it while WPs are still pending is rejected (not silently ignored).

> **Crash recovery and statelessness:** Unlike pipeline-owning agents, the Synthesis agent has no pipeline-based state tracking — its only persistent artifact is the binary `synthesis_generated` flag. If the Synthesis agent crashes or is interrupted during report generation, there is no "synthesis in progress" state to resume from. The `synthesis_generated` flag remains `false`, and `getNextAction` for the Synthesis role will return `GENERATE_SYNTHESIS` again. Implementations MUST treat Synthesis as a **stateless, idempotent operation**: each invocation regenerates the complete synthesis report from scratch using the current state of all work packages. The Synthesis agent should not attempt to resume or append to a partial report from a prior session.

### 19.3 Project Completion Condition

A project is `COMPLETE` when:
- All WPs have terminal status (COMPLETE or CANCELLED) ⟹ `pending_work_packages == 0`
- At least one WP exists ⟹ `total_work_packages > 0`
- `synthesis_generated == true` (and `synthesis_generated_at` records when)

---

## 20. Concurrency Model

### 20.1 Atomic Writes

All file writes use a write-to-temp-then-rename pattern:
1. Write data to `{file}.tmp.{pid}`
2. Atomically rename to target file

This ensures readers never see partial writes.

### 20.2 File Locking

Dual-file updates (WP detail + root index) are protected by file locks:
- Lock file: `{storageDir}/.lock`
- Stale timeout: 10 seconds (locks older than this are forcibly acquired)
- Retry: 50 attempts with 200ms–1000ms exponential backoff
- Lock is always released in a `finally` block

### 20.3 Lock Scoping

| Operation | Lock Required? | Lock Scope |
|-----------|---------------|------------|
| Read-only (get status, list WPs) | No | — |
| Single-file write (synthesis completion) | Yes | Root index |
| Auto-handoff depth increment | Yes | Root index |
| Dual-file write (WP + root) | Yes | Storage directory |
| Dependency cascade (unblock/reblock) | Yes (separate) | Storage directory |

### 20.4 Cascade Lock Separation

`propagateDependencyUnblock` and `propagateDependencyReblock` acquire their own locks **after** the main update lock is released. This is intentional:
- Avoids holding a lock during potentially slow cascade reads
- Safe because cascade operations are idempotent
- Brief window between locks where state may appear inconsistent

> **Crash recovery:** If the process crashes during the gap between the main update lock release and cascade lock acquisition, WP-level blocking state may be left stale (e.g., a WP remains BLOCKED despite all its dependencies being terminal). Since `propagateDependencyUnblock` and `propagateDependencyReblock` are **idempotent and re-entrant**, the recovery path is to re-invoke the cascade function with the same arguments. This produces the correct end state regardless of how many times it runs.
>
> Self-healing (§17) repairs **project-level** status drift. For **WP-level** blocking inconsistency after a suspected cascade failure, re-invoking the cascade is the prescribed repair. Implementations SHOULD detect this condition (WP is BLOCKED but all dependencies are terminal and blocker type is `dependency`) during `getNextAction` and either auto-repair or surface it as a PM action.

> **⚠ Stale PASS on direct dependents:** The lock gap can also produce **stale PASS pipelines** on direct dependents, not just stale blocking state. If a dependent WP's pipeline completes with PASS during the gap between the main update (reopening the dependency) and the cascade lock acquisition, the PASS result validated pre-reopen output. Since PASS is terminal (§7.2), cascade reblock cannot retroactively cancel it. The dependent WP now carries a PASS pipeline that validated stale assumptions. This is analogous to the transitive-dependent issue documented in §21.42, but affects **direct** dependents during the lock gap. Implementations SHOULD add a dependency-status re-check to `completePipeline` (verifying that all of the WP's dependencies are still terminal before accepting a PASS result) to guard against this race. This adds minor overhead to every pipeline completion but prevents stale PASS results from propagating through the dependency graph undetected. See [§21.59](edge-cases.md#2159-cross-wp-staleness-after-dependency-reopens) for the full dependency freshness check recommendation.

> **Side-effect idempotency on concurrent unblock:** When two dependencies of the same WP complete near-simultaneously, `propagateDependencyUnblock` may be invoked twice. The state mutation is idempotent (both calls write `READY`), but **side effects** such as notifications, project comments, or webhook emissions may double-fire. Implementations SHOULD ensure that unblock side effects are either idempotent or deduplicated (e.g., via an idempotency key derived from the WP ID and target status).

```
```
// Structure of documents
└── mcp-server/
    └── docs/
        └── agents/
            └── workflow-specification/
                └── recommendations.md

```
###  Path: `/mcp-server/docs/agents/workflow-specification/recommendations.md`

```md
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
3d. **ROUTE_PIPELINE_AGENT**: Any non-terminal, non-dependency-blocked IN_PROGRESS WP where the next active pipeline stage has no pipeline started (or no PASS). This covers two scenarios: (a) a stage has PASSed and the next stage needs work, and (b) a freshly-claimed WP with zero pipelines where the first active stage's agent needs to begin. PM should route to the agent owning that stage. Same guards as §13.1 step 2b: FAIL stages are skipped (handled by downstream agent's FAIL routing), current-stage IN_PROGRESS pipelines are skipped (stage already being worked on), upstream IN_PROGRESS stages are skipped (premature routing prevention).
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
  
  // Priority 3d: IN_PROGRESS WPs needing next pipeline stage (§13.1 step 2b)
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
      return ROUTE_PIPELINE_AGENT with wp.id, stage, nextAgent

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

```