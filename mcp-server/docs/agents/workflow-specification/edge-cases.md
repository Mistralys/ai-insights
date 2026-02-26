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

Only the Documentation agent can mark a WP as COMPLETE. Additionally, the most recent `documentation` pipeline must have PASS status. This enforces the full pipeline chain:
```
Developer → QA → Reviewer → Documentation → COMPLETE
```
No agent can skip stages, and Documentation cannot mark COMPLETE without having completed its own pipeline successfully.

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

### 21.15 Cascade Reblock Warning for COMPLETE Dependents

- When a COMPLETE WP is reopened (COMPLETE → IN_PROGRESS), dependent WPs that are themselves COMPLETE are **not** reblocked (see [§15.5](dependencies-and-rework.md#155-cascade-reblocking-propagatedependencyreblock))
- Instead, a high-priority `warning` project comment is emitted for each such WP
- The Project Manager is responsible for reviewing these warnings and deciding whether to reopen the downstream WPs
- This avoids destructive cascading state changes while still surfacing the potential inconsistency

### 21.16 Per-Pipeline Rework Counts

- The `rework_counts` map tracks rework cycles independently per pipeline type
- Documentation self-rework does not consume the implementation rework budget
- Downstream-triggered rework (e.g., QA fails → Developer restarts implementation) increments the **pipeline type being started** (implementation), not the pipeline that failed (qa)
- Legacy `rework_count` scalar is migrated to `rework_counts.implementation` on first write

### 21.17 BLOCKED → BLOCKED Blocker Replacement

- When transitioning BLOCKED → BLOCKED, the new `blocked_by` replaces the existing one
- A `dependency` blocker **cannot** be overwritten with a non-dependency type — this preserves auto-unblock eligibility
- All other blocker-type changes are allowed
- Use case: PM re-classifies a blocker (e.g., `technical` → `decision`) without unblocking first

### 21.18 Null Timestamp Data Integrity

- `started_at` is always set at pipeline creation; `completed_at` is always set at pipeline completion
- If either is null in a context where it should be present (e.g., `hasNewUpstreamPassSince`), this indicates a data integrity issue
- Implementations SHOULD emit a project comment of type `"warning"` when a null timestamp is encountered
- The system fails safe (returns `false` / does not trigger rework), but the anomaly must be surfaced for investigation

### 21.19 Stale Pipeline Detection Limitations

- Stale detection only fires via `getNextAction` for the pipeline's owning agent role
- If no agent of the correct role queries, a stale pipeline is never detected
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

- When starting a pipeline, the system verifies that the prerequisite pipeline PASSed **after** the most recent run of the current pipeline type (if any)
- This prevents skipping intermediate validation stages after upstream rework (e.g., starting `code-review` with a stale QA PASS that validated an older implementation)
- The guard uses `hasDownstreamFail` to detect whether re-validation is actually needed — if no downstream pipeline has FAILed, the existing prerequisite PASS is considered valid
- Complements the recommendation engine's `hasNewUpstreamPassSince` logic (§14.6) with a hard enforcement gate

### 21.23 Mandatory Agent Role on Pipeline Start

- The `agentRole` parameter is **required** when calling `startPipeline`
- The agent must match the pipeline owner defined in `PIPELINE_AGENT_MAP` (§9.1)
- **PM override:** The Project Manager may start any pipeline type (e.g., restarting a stale pipeline on behalf of an absent agent)
- This ensures pipeline ownership (§4.1) is enforced at the tool level, not just advised by the recommendation engine
