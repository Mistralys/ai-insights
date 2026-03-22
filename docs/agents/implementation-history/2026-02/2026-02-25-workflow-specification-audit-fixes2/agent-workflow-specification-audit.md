# Claude Code Audit

```
# Audit of Agent Workflow Specification v1.0.0

**Date:** 2026-02-25
**Source:** [agent-workflow-specification.md](agent-workflow-specification.md)

---

## Critical Issues

### 1. Circular dependency deadlock — no cycle detection (§9.1, §6.3)

WP creation validates that dependency IDs *exist*, but never checks for cycles. If PM creates WP-001→WP-002 and WP-002→WP-001 (or a longer chain forming a cycle), both WPs start as BLOCKED and can never be unblocked. The auto-unblock in §9.2 requires a dependency to reach COMPLETE first, which is impossible in a cycle. This is a permanent deadlock with no recovery path.

### 2. Handoff routing stalls on pipeline FAIL — breaks auto-handoff chain (§8.2, §10.3)

When QA FAILs a pipeline, the QA handoff logic hits this branch:

> "If some non-BLOCKED wpsWithImpl still need QA or have FAIL qa → `IN_PROGRESS`"

`IN_PROGRESS` maps to "same agent continues" (§8.3). But QA can't act — it needs the Developer to fix the code first. Meanwhile:
- QA's `get_next_action` returns `WAIT` (no new upstream PASS via `hasNewUpstreamPassSince`).
- Auto-handoff is blocked because §10.3 condition 4 excludes `IN_PROGRESS`.
- The Developer's `get_next_action` *would* return `REWORK` (priority 4), but no one invokes the Developer.

**Result:** The workflow stalls. Human intervention is required on every pipeline FAIL to manually invoke the Developer. The same issue affects Reviewer and Documentation handoff logic — they all return `IN_PROGRESS` when their pipeline FAILs, even though the Developer is the only agent who can make progress.

**Fix suggestion:** The handoff logic for QA/Reviewer/Documentation should detect "I have FAIL pipelines for WPs where I can't act without upstream rework" and return `READY_FOR_DEVELOPER` instead of `IN_PROGRESS`.

### 3. Rework count semantics contradiction (§7.1 vs §7.6 vs §13.2)

§7.1 says: *"If any existing pipeline of the **same type** has FAIL status → increment rework_count."*

§7.6 table confirms: *"At least one prior FAIL → +1"*

But §13.2 walkthrough says:
> *"rework_count only increments if same-type pipeline has a prior FAIL. In this case the impl pipeline was PASS, so rework_count is NOT incremented."*

Consider history `[FAIL, PASS]` for implementation, and a new implementation pipeline starts (due to downstream QA FAIL). Per §7.1/7.6, there IS at least one prior FAIL → increment. Per §13.2, the impl "was PASS" → no increment. These contradict each other. The intended semantic is likely "most recent pipeline of the same type is FAIL," not "any prior FAIL exists."

---

## Design Issues

### 4. Handoff notes address wrong agent on FAIL (§7.2 step 7, §5.3)

`complete_pipeline` always routes the handoff note `to_agent` via the Next-Agent Map, regardless of PASS/FAIL. When QA FAILs:
- Note: `{from: QA, to: Reviewer}` — but the Developer needs this information for rework.
- When Developer eventually picks up the REWORK, the relevant failure notes are addressed to Reviewer, not Developer.

This isn't wrong (Developer can still read all handoff notes), but it's misleading metadata.

### 5. WP ID format caps at 999 (§15 Invariant 1, §9.3)

Invariant 1 requires IDs match `/^WP-\d{3}$/`. The generation logic in §9.3 says "zero-padded to 3 digits." At WP-999 + 1, the generated ID would be `WP-1000` (4 digits), violating the invariant. Either relax the regex to `/^WP-\d{3,}$/` or document the 999-WP limit.

### 6. Auto-unblock always targets READY, losing IN_PROGRESS state (§9.2 step 5c)

If a WP was `IN_PROGRESS` and then BLOCKED (e.g., a newly-discovered dependency), auto-unblock transitions it to READY (not back to IN_PROGRESS). The agent must re-claim it, but any pipeline state from before the block is preserved. Minor friction, but worth documenting as intentional.

### 7. No WP cancellation or deletion mechanism

There is no `CANCELLED` status and no delete operation. An erroneously created WP can only be forced to COMPLETE (requiring all acceptance criteria to be met by Documentation). Consider adding a `CANCELLED` terminal status or a PM-only delete operation.

---

## Ambiguities

### 8. Same-status no-op scope (§6.2)

> "Same-status transition (e.g., IN_PROGRESS → IN_PROGRESS) is always valid (no-op)."

Does `COMPLETE → COMPLETE` bypass the "only Documentation can transition to COMPLETE" guard? If treated as a pure no-op that skips validation, any agent could invoke it. If the guard still applies, the no-op rule should state that validation is still enforced for COMPLETE.

### 9. Incrementing an absent `rework_count` (§3.3, §7.1)

`rework_count` is "Absent until first rework." §7.1 says "increment rework_count." Incrementing an absent/undefined field is implementation-ambiguous. Clarify: treat absent as `0`, then increment to `1`.

### 10. Acceptance criteria merge on unknown criterion text (§7.2 step 6)

"Merge by criterion text" — if `acceptance_criteria_updates` contains a criterion whose text doesn't match any existing criterion, is it: (a) appended as new, (b) ignored, or (c) an error? This affects whether agents can add new criteria mid-pipeline.

---

## Unhandled Edge Cases

### 11. Documentation pipeline FAIL requiring code changes

If the documentation pipeline FAILs and the fix requires code changes (not just doc updates), there's no routing path to Developer. The Developer's next-action (priority 4) only checks for `qa` or `code-review` FAIL — **not** `documentation` FAIL. Documentation would have to manually block the WP and hope the PM routes it correctly.

### 12. Synthesis has no ledger action

The Synthesis agent generates a report and calls `get_handoff_status` → `COMPLETE`. But Synthesis performs no ledger write. The project status reaching `COMPLETE` depends entirely on self-healing (§11.1) being triggered by a subsequent `get_project_status` call. If no one calls `get_project_status`, the project status may remain `IN_PROGRESS` indefinitely. Consider having Synthesis explicitly set project status, or document that self-healing is the intended mechanism.

### 13. Vacuously true acceptance criteria

If a WP has an empty `acceptance_criteria` array, the "all criteria met" check passes vacuously, allowing premature completion. Consider requiring at least one acceptance criterion.

### 14. PM blocker resolution mechanism

PM gets `RESOLVE_BLOCKERS` as a next-action, but the spec doesn't define what operation the PM uses to resolve a blocker. Presumably `update_work_package_status(BLOCKED → READY)`, but this should be explicit — especially since the `blocked_by` field must be cleared and the spec doesn't mention a separate "clear blocker" operation.

### 15. Stale pipeline threshold is global, not per-pipeline-type

The 24-hour staleness threshold (§7.5) applies uniformly. An implementation pipeline might reasonably be in-progress for days (complex feature), while a QA pipeline stale after a few hours indicates a problem. Consider per-type thresholds or making the threshold configurable per WP.

### 16. No handling of agent failure mid-handoff-note write

§7.2 writes handoff notes as part of pipeline completion. If the agent crashes after writing the pipeline status (PASS/FAIL) but before writing the handoff note (or vice versa — though atomic writes mitigate within a single file), the next agent may not receive context. Since both are in the same WP detail file and written atomically, this is likely safe, but the spec should confirm that handoff notes and pipeline status are written in the same atomic operation.

---

## Summary Table

| # | Severity | Category | Section | Issue |
|---|----------|----------|---------|-------|
| 1 | **Critical** | Deadlock | §9.1, §6.3 | No circular dependency detection |
| 2 | **Critical** | Logic | §8.2, §10.3 | FAIL handoff returns IN_PROGRESS, stalling auto-chain |
| 3 | **Critical** | Contradiction | §7.1 vs §13.2 | rework_count "any FAIL" vs "most recent FAIL" |
| 4 | Design | Misleading | §7.2, §5.3 | Handoff notes on FAIL addressed to wrong agent |
| 5 | Design | Limit | §15, §9.3 | WP ID regex caps at 999 |
| 6 | Design | Minor | §9.2 | Auto-unblock loses IN_PROGRESS state |
| 7 | Design | Missing | — | No WP cancel/delete |
| 8 | Ambiguity | Guard | §6.2 | COMPLETE→COMPLETE no-op vs role guard |
| 9 | Ambiguity | Data | §7.1 | Absent rework_count increment |
| 10 | Ambiguity | Data | §7.2 | AC merge on unknown criterion |
| 11 | Unhandled | Routing | §8.1 | Documentation FAIL needing code changes |
| 12 | Unhandled | State | §13.1 | Synthesis has no ledger write |
| 13 | Unhandled | Validation | §6.5 | Empty AC array → vacuously true |
| 14 | Unhandled | Operation | §8.1 | PM blocker resolution not specified |
| 15 | Unhandled | Config | §7.5 | Staleness threshold not per-type |
| 16 | Unhandled | Atomicity | §7.2 | Handoff note + pipeline status atomicity |
```

# Gemini Audit

```
I have reviewed the Agent Workflow Specification you provided. While the foundation is highly structured and well-thought-out, there are several critical logic fallacies, contradictions, and unhandled edge cases that will cause deadlocks or infinite loops during execution.

Here is the audit of your specification:

### 1. Critical Contradictions in Rework Routing

The most severe issue is how the specification handles failures in downstream pipelines (QA and Code Review). The rules for Next-Action and Handoff directly contradict the Walkthrough, breaking the rework loop.

* **The Infinite Loop Risk:** Section 8.1 states that if the QA agent finds a non-BLOCKED WP where the most-recent `qa` pipeline is `FAIL`, its next action is `REWORK_QA`. This means the QA agent will immediately re-run QA on the broken code instead of waiting for the Developer.
* **The Handoff Contradiction:** Section 8.2 dictates that if a WP has a `FAIL` `qa` pipeline, the handoff status remains `IN_PROGRESS` (keeping it with the QA agent). However, the Walkthrough in Section 13.2 explicitly claims that calling `get_handoff_status` after a QA failure will return `READY_FOR_DEVELOPER`.
* **The Fix:** You must remove `REWORK_QA` and `REWORK_REVIEW` from the respective agents' Next-Action maps for failures. When they fail a pipeline, their handoff logic must explicitly return `READY_FOR_DEVELOPER`, relying on the `hasNewUpstreamPassSince` temporal check to wake them back up once the Developer fixes it.

### 2. Dependency Integrity Gap on WP Reopening

There is a major flaw in how the system handles the reopening of a Work Package.

* **The Cascade Failure:** Section 6.6 allows a Project Manager or Documentation agent to transition a `COMPLETE` WP back to `IN_PROGRESS`. However, Section 9.2 only covers *unblocking* dependents when a WP is completed.
* **The Result:** If WP-001 is marked `COMPLETE`, WP-002 (which depends on it) becomes `READY`. If WP-001 is then reopened to `IN_PROGRESS`, WP-002 remains `READY` (or even `IN_PROGRESS` if claimed) because there is no "cascade block" logic defined. This violates the implicit rule that a WP can only be worked on if all its dependencies are strictly `COMPLETE`.

### 3. Concurrency Risk: Lock Retry vs. Timeout Mismatch

Your file locking parameters in Section 12.2 will lead to frequent lock acquisition failures under normal multi-agent contention.

* **The Mismatch:** The spec defines a stale timeout of 10 seconds, but limits retries to 5 attempts with 200ms intervals, totaling ~1 second of wait time.
* **The Result:** If Agent A acquires the lock and takes 2.5 seconds to write to the file, Agent B will try for 1 second, exhaust its retries, and throw a lock acquisition error, completely ignoring the fact that the lock was still safely within its 10-second valid window. You need to align the retry count/interval to span the entire stale timeout duration.

### 4. Synthesis Agent Infinite Loop

The workflow lacks a terminal state for the final project step.

* **The Loop:** According to Section 8.1, the Synthesis agent's global pre-check triggers `GENERATE_SYNTHESIS` unconditionally if "All WPs COMPLETE".
* **The Missing State:** Because the Synthesis agent does not own a WP pipeline and the Root Index has no `synthesis_generated: true` flag, the Synthesis agent will continuously evaluate its next action as `GENERATE_SYNTHESIS` in a rapid infinite loop. The Root Index entity model needs a project-level terminal status (e.g., `DONE` or `SYNTHESIZED`).

### 5. Missing WP Cancellation Status

The Work Package Lifecycle (Section 6.1) only supports `READY`, `IN_PROGRESS`, `BLOCKED`, and `COMPLETE`.

* **The Dead End:** If the Project Manager decides during the project that a WP is no longer needed, they have no safe way to abandon it. Deleting it violates the "No orphan WPs" invariant (Section 15.5) or breaks dependency arrays. Leaving it `BLOCKED` indefinitely prevents the project from ever reaching completion. You need a `CANCELLED` or `WONT_DO` status that downstream logic recognizes as a valid bypass.
```


# Claude Web Audit

```
# Audit of Agent Workflow Specification

This is a well-structured spec. Here are the issues I found, organized by severity.

---

## Logical Contradictions

**1. Handoff note routing on QA FAIL is inconsistent with intent (§7.2 vs §13.2)**

When QA fails, the `complete_pipeline` logic in §7.2 routes the handoff note using the Next-Agent Map: `qa → Reviewer`. But the *intent* is clearly to send work back to the Developer for rework. The walkthrough in §13.2 even acknowledges this awkwardness with a NOTE explaining the handoff note goes to Reviewer while the actual handoff status routes to Developer. This means the handoff *note* and the handoff *routing* point to different agents, which is confusing and arguably a design flaw. The `from_agent`/`to_agent` on the note becomes misleading metadata.

**Recommendation:** Either introduce a failure-specific routing map (on FAIL, `to_agent` = Developer), or document explicitly that handoff notes on FAIL are informational records, not routing directives.

**2. Rework count semantics are narrower than the walkthrough suggests (§7.6 vs §13.2)**

The rework count only increments when a new pipeline of the *same type* has a prior FAIL. But the conceptual "rework" triggered by a downstream failure (e.g., QA fails → Developer restarts implementation) does *not* increment `rework_count` on the implementation pipeline if the prior implementation was PASS. The walkthrough in §13.2 correctly notes this, but it means `rework_count` doesn't actually track "how many times this WP was reworked" — it tracks "how many times a specific pipeline type was retried after its own failure." This is a semantic mismatch that could mislead consumers of the data.

**Recommendation:** Either rename to something like `pipeline_retry_count` or add a separate WP-level `rework_cycles` counter that increments whenever any downstream failure triggers a return to Developer.

---

## Missed Edge Cases

**3. No maximum rework count / circuit breaker**

There's a `max_handoff_depth` to prevent infinite auto-handoff chains, but no equivalent limit on rework cycles. A persistent QA failure could loop Developer → QA → Developer → QA indefinitely. In practice with AI agents, this is a real risk if the agent can't resolve the underlying issue.

**4. Reopening a COMPLETE WP doesn't reset pipelines**

§6.6 says reopening increments `revision` and sets status to IN_PROGRESS, but doesn't specify what happens to existing pipelines. The old PASS pipelines are still there. When the Developer starts a new `implementation` pipeline, the prerequisite checks for downstream pipelines (qa needs impl PASS) will see the *old* PASS pipelines as valid. This could allow QA to skip re-validation of new changes if the temporal check (`hasNewUpstreamPassSince`) isn't carefully applied.

**5. What happens when Documentation FAIL occurs?**

The next-action logic for Documentation has `REWORK_DOCS` for a failed documentation pipeline, but who actually fixes it? Documentation itself? There's no routing back to Developer for a docs failure, which makes sense, but it's never explicitly stated that Documentation is responsible for its own rework — unlike every other pipeline type where failure routes back to Developer.

**6. Synthesis agent has no pipeline and no completion mechanism**

Synthesis generates a report but owns no pipeline and has no state transition to mark the *project* as COMPLETE. The project status would need to be set to COMPLETE, but the spec never says who does this or how. The self-healing in §11 will heal it to COMPLETE only if `pending_work_packages == 0`, which happens when all WPs are done — but that's before Synthesis even runs. So the project is "COMPLETE" before the synthesis report exists.

**7. Concurrent multi-WP pipeline progression is underspecified**

With multiple independent WPs (no dependencies), Developer could finish WP-001 and WP-002 implementation, then QA picks up WP-001. Meanwhile, Reviewer has nothing to do. The spec handles this via next-action priority scanning, but doesn't address whether agents should work on multiple WPs in parallel within a single invocation or strictly one at a time.

---

## Minor Issues

**8. WP ID format limits projects to 999 work packages** (`WP-NNN` with 3-digit zero-padding). Should the spec state behavior when exceeding 999? Does it become `WP-1000`?

**9. §8.1 Developer priority 4 wording is ambiguous.** "Any non-BLOCKED WP with PASS impl has most-recent `qa` or `code-review` = FAIL" — does this mean `(qa = FAIL) OR (code-review = FAIL)`, or the most recent of either? The intent is OR, but it reads ambiguously.

**10. Timestamp format (§15, invariant 4) says local time, not UTC.** This is fragile for distributed or multi-timezone deployments. If two agents run in different timezones, the temporal upstream checks (`completed_at > started_at`) could produce incorrect results.

**11. §9.2 auto-unblock gap between locks.** The spec acknowledges the race condition but dismisses it as "safe for single-agent workflows." If the system is ever used with concurrent agents (which the locking infrastructure suggests is anticipated), this becomes a real bug. A dependent WP could be picked up by an agent between the two lock acquisitions in an inconsistent state.

---

## Structural Observations

**12. No versioning/migration strategy for the ledger schema.** The spec is versioned (1.0.0), but there's no guidance on what happens when the schema evolves and existing ledger files need migration.

**13. No audit trail beyond handoff notes.** There's no general-purpose event log. If you need to debug why a WP went through 5 rework cycles, you'd have to reconstruct the story from pipeline arrays and handoff notes, which is doable but not ergonomic.

---

The most impactful issues to address are **#1** (handoff note mismatch), **#3** (no rework circuit breaker), **#6** (Synthesis/project completion gap), and **#10** (local timestamps in temporal comparisons). The rest are either minor or documented-but-accepted tradeoffs.
```


# Copilot Audit

```
### Audit summary

Below are **logical issues, ambiguities, and risky race conditions** I found in the *Agent Workflow Specification* plus concrete fixes and tests. I begin with two short, verbatim sentences from the specification to ground the audit.

> **"State persists across sessions. Each agent can resume from where the last agent left off."**  
> **"Only Documentation can transition WP to COMPLETE."**  
(agent-workflow-specification.md)

---

### High‑priority correctness and safety issues

| # | Issue | Why it matters | Suggested fix |
|---:|---|---|---|
| 1 | **Race window in auto-unblock (gap between locks)** | The spec explicitly allows a window where a WP is COMPLETE but dependents remain BLOCKED. In concurrent multi-agent runs this can cause conflicting claims, duplicate starts, or missed auto-unblocks. | Make auto-unblock part of the same lock that marks COMPLETE, or use a two‑phase commit: mark COMPLETE, compute dependents, atomically update dependents in the same transaction. If same-lock is impossible, add a short retry/backoff and a deterministic version check to avoid lost updates. |
| 2 | **Ambiguous lock ownership and stale-lock policy** | Lock timeout 10s and "abandoned locks are force-overridden" plus "lock files persist" are underspecified and unsafe under slow I/O or GC pauses. Force override without owner verification can corrupt concurrent writes. | Define lock owner metadata, heartbeat renewal, and a conservative stale timeout configurable per environment. Require explicit owner PID and timestamp and only allow override after heartbeat absence plus human-confirmable audit log. |
| 3 | **Dual-file atomicity not fully specified for crash scenarios** | Writing root and WP detail under one lock is described, but recovery after partial failure (process crash between writes) is not specified. Readers may see inconsistent state. | Specify write order, durable fsync semantics, and a recovery routine that detects partial updates by comparing file versions or temp files and rolls back or completes the operation. Add a transaction log entry for each multi-file update. |
| 4 | **Auto-handoff depth stored on root index causes contention** | Incrementing `auto_handoff_depth` on root index for every automatic handoff serializes many short-lived operations and can create a hotspot and race on the root lock. | Move `auto_handoff_depth` to an ephemeral in-memory coordinator or a separate lightweight file per chain. If it must be on root index, use compare-and-swap with versioning and retry logic and limit frequency of writes. |
| 5 | **Inconsistent rework_count semantics in multi-stage rework** | The spec increments `rework_count` only when starting a pipeline of a type that previously had a FAIL. The example and rules create confusion about which pipeline's rework_count increments when downstream fails cause upstream work. | Clarify: define `rework_count` per pipeline type and increment it when starting a pipeline of that type if the most recent pipeline of the same type has status FAIL. Add explicit examples for downstream-triggered upstream rework and ensure tooling increments the correct pipeline type. |
| 6 | **Temporal checks (`hasNewUpstreamPassSince`) fragile when timestamps missing or clock skew exists** | Function returns false if timestamps absent and uses strict `>` comparison. In distributed systems with clock skew or missing timestamps this can incorrectly suppress necessary downstream runs. | Require monotonic logical clocks or use vector clocks or sequence numbers per pipeline. If timestamps are used, require UTC and enforce timestamp presence on completion and start. Add a fallback: if timestamps missing, use pipeline sequence numbers. |
| 7 | **Ambiguity in "assigned_to" override semantics** | Claiming guard allows `override: true` but does not define authorization, audit trail, or consequences. This can enable accidental or malicious cross-role claims. | Require explicit reason, caller identity, and a high‑privilege role check for overrides. Log overrides in `project_comments` with priority high and include who overrode and why. |
| 8 | **Incomplete invariant for pipeline ordering vs. historical data** | Invariants state you cannot have PASS `qa` without PASS `implementation`, but the spec allows historical sequences like `[PASS, FAIL]` and reworks that could temporarily violate derived invariants when reading partial history. | Enforce invariant at write time by validating pipeline histories before accepting a PASS. If historical anomalies exist, provide a remediation path and a `self-heal` rule to reorder or flag inconsistent histories for manual review. |
| 9 | **Unclear behavior for concurrent pipeline starts across agents** | Preconditions prevent duplicate IN_PROGRESS of same type, but two agents may race to start the same pipeline if they read state before a lock is acquired. The spec lacks a canonical compare-and-set start operation. | Define `start_pipeline` as an atomic compare-and-set under the project lock: re-read WP status and pipelines inside the lock and fail fast if preconditions no longer hold. Document retry/backoff policy for callers. |
| 10 | **Timestamps format requirement uses local time not UTC** | Invariant 4 requires `YYYY-MM-DD HH:MM:SS` local time. Local time with no timezone causes ambiguity and breaks cross-host comparisons. | Require ISO 8601 UTC timestamps with timezone designator, e.g., `YYYY-MM-DDTHH:MM:SSZ`. Update all timestamp rules and temporal comparisons to use UTC. |

---

### Medium‑priority correctness and UX issues

- **Ambiguous error semantics**: Many operations say "error" but do not define error codes, retryability, or whether partial side effects are rolled back. **Fix:** define structured error types, idempotency guarantees, and whether callers should retry.
- **Auto-unblock idempotency vs. concurrent writes**: Auto-unblock is idempotent but may race with manual unblock; add optimistic concurrency checks using file version or ETag.
- **`get_project_status` self-heal side effects**: Self-heal writes back to disk only if correction made. This means a read-only status call can mutate state. That violates principle of least surprise. **Fix:** separate `compute_status` (pure) from `repair_status` (explicit write) and require an explicit flag to persist corrections.
- **No explicit retention or pruning policy for pipelines and artifacts**: Over time pipelines and artifacts grow unbounded. **Fix:** add retention policy and archival rules.
- **No authorization model**: Roles are described but no authentication/authorization model is specified. **Fix:** add RBAC mapping and audit logging requirements.

---

### Recommended prioritized remediation plan

1. **Immediate (safety):**  
   - Make COMPLETE → auto-unblock atomic or add deterministic retry with version checks.  
   - Change timestamps to UTC ISO 8601.  
   - Make `start_pipeline` atomic under lock with compare-and-set semantics.

2. **Short term (robustness):**  
   - Add lock owner heartbeat and safe override policy.  
   - Move `auto_handoff_depth` off the hot root index or implement CAS with versioning.  
   - Define structured error codes and idempotency rules.

3. **Medium term (consistency & observability):**  
   - Add transaction log for multi-file updates and recovery routine.  
   - Define RBAC and override audit trail.  
   - Add retention/archival policy for pipelines and artifacts.

4. **Long term (distributed scale):**  
   - Replace timestamp-based temporal checks with monotonic sequence numbers or logical clocks.  
   - Consider a coordinator service for auto-handoff chains to avoid root-index contention.

---

### Tests and verification to add

- **Concurrency tests:** parallel `start_pipeline`, parallel `complete_pipeline` and simultaneous `create_work_package` to detect races.  
- **Crash-recovery tests:** simulate process crash between root and WP writes and validate recovery routine.  
- **Auto-unblock stress test:** complete a WP while many agents concurrently read and attempt to claim dependents. Verify no lost unblocks.  
- **Clock skew tests:** run agents with skewed clocks and verify `hasNewUpstreamPassSince` behavior.  
- **Lock override tests:** simulate stale lock and ensure override only after heartbeat absence and with audit log entry.  
- **Self-heal idempotency tests:** call `get_project_status` repeatedly and ensure only intended corrections are persisted and logged.

---

### Quick implementer checklist

- **Timestamps:** switch to UTC ISO 8601 everywhere.  
- **Atomicity:** implement transaction log and atomic multi-file commit or single-file canonical store.  
- **Locks:** add owner, heartbeat, safe override, and configurable stale timeout.  
- **Auto-handoff:** avoid root-index hot writes; use ephemeral coordinator or CAS.  
- **Temporal logic:** replace fragile timestamp comparisons with sequence numbers.  
- **Errors & audit:** define structured errors, audit override actions, and log all auto-unblock and auto-handoff events.  
- **Tests:** add concurrency, crash, and skew test suites.
```

