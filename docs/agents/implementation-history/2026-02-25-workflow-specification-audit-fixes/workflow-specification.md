# Agent Workflow Specification

**Version:** 1.0.0
**Date:** 2026-02-25
**Scope:** Language-agnostic specification of the ledger-based agent workflow logic

---

## 1. Purpose

This document is the authoritative specification of the agent workflow lifecycle managed by the Project Ledger system. It describes every state, transition, handoff, edge case, and invariant in a language-agnostic manner. Any conforming implementation — regardless of language or runtime — MUST produce identical behavior for the same inputs.

---

## 2. Domain Model

### 2.1 Entities

| Entity | Description |
|--------|-------------|
| **Project** | Top-level container. Has a status, a list of work packages, and metadata. |
| **Work Package (WP)** | A unit of work with its own lifecycle. Identified by `WP-###` (3-digit zero-padded). |
| **Pipeline** | A processing stage within a work package. Represents the work of a single agent role on that WP. |
| **Handoff Note** | A structured message from one agent to the next, attached to a work package. |
| **Acceptance Criterion** | A boolean-gated condition that must be met before a WP can be marked COMPLETE. |
| **Blocker** | A structured object describing why a WP is BLOCKED. |

### 2.2 Agent Roles

The workflow defines exactly **7** sequential agent roles:

| # | Role | Shorthand | Responsibility |
|---|------|-----------|----------------|
| 1 | Planner | — | Creates the implementation plan. Does not interact with the ledger. |
| 2 | Project Manager | PM | Decomposes the plan into work packages; initializes the ledger; resolves blockers. |
| 3 | Developer | Dev | Claims and implements work packages. Owns the `implementation` pipeline. |
| 4 | QA | QA | Validates implementation. Owns the `qa` pipeline. |
| 5 | Reviewer | Rev | Code review. Owns the `code-review` pipeline. |
| 6 | Documentation | Doc | Updates documentation and marks WPs COMPLETE. Owns the `documentation` pipeline. |
| 7 | Synthesis | Syn | Generates the final project report. Only acts when all WPs are COMPLETE. |

### 2.3 Pipeline Types

Exactly **4** pipeline types exist, in this fixed order:

```
implementation → qa → code-review → documentation
```

Each pipeline type is **owned** by exactly one agent role:

| Pipeline Type | Owner Agent | Next Agent (Handoff Target) |
|---------------|-------------|----------------------------|
| `implementation` | Developer | QA |
| `qa` | QA | Reviewer |
| `code-review` | Reviewer | Documentation |
| `documentation` | Documentation | Synthesis |

---

## 3. Status Enumerations

### 3.1 Project Status

```
READY | IN_PROGRESS | COMPLETE | BLOCKED
```

### 3.2 Work Package Status

```
READY | IN_PROGRESS | COMPLETE | BLOCKED
```

### 3.3 Pipeline Status

```
IN_PROGRESS | PASS | FAIL
```

> **Note:** Pipelines have no `READY` status. They are created directly in `IN_PROGRESS`.

---

## 4. State Machine: Work Package Lifecycle

### 4.1 Legal Status Transitions

```
         ┌──────────────────────────────────────┐
         │                                      │
         ▼                                      │
      ┌──────┐     ┌─────────────┐     ┌──────────┐
      │ READY│────►│ IN_PROGRESS │────►│ COMPLETE  │
      └──┬───┘     └──┬──────▲───┘     └──────────┘
         │            │      │               │
         │            ▼      │               │
         │       ┌─────────┐ │               │
         └──────►│ BLOCKED │─┘               │
                 └──┬──────┘                 │
                    │  ▲                     │
              READY─┘  │     (revision++)    │
              (auto)   └─────────────────────┘
                        (PM or Docs only)
```

| From | To | Conditions | Side Effects |
|------|----|------------|--------------|
| `READY` | `IN_PROGRESS` | All dependencies COMPLETE | — |
| `READY` | `BLOCKED` | — | `blocked_by` MUST be set |
| `IN_PROGRESS` | `COMPLETE` | All acceptance criteria met; agent MUST be "Documentation" | Decrement `pending_work_packages`; trigger dependency propagation |
| `IN_PROGRESS` | `BLOCKED` | — | `blocked_by` MUST be set |
| `BLOCKED` | `IN_PROGRESS` | — (manual unblock) | Clear `blocked_by` |
| `BLOCKED` | `READY` | All dependencies COMPLETE (auto-unblock) | Clear `blocked_by` |
| `COMPLETE` | `IN_PROGRESS` | Agent MUST be Project Manager or Documentation | Increment `revision`; increment `pending_work_packages` |
| Same → Same | (any) | Always valid (no-op) | — |

All other transitions are **illegal** and MUST be rejected.

### 4.2 Transition Guards

#### 4.2.1 READY → IN_PROGRESS (Claiming)

Before transitioning, validate:

1. **Dependency check:** For each WP ID in the `dependencies` array, the corresponding WP's status MUST be `COMPLETE`. If any dependency is not COMPLETE, reject with a descriptive error listing the non-complete dependencies.
2. **Assignment check:** If the WP's `assigned_to` differs from the claiming agent, reject UNLESS an `override` flag is explicitly set to `true`.

#### 4.2.2 IN_PROGRESS → COMPLETE

1. **Acceptance criteria check:** Every entry in `acceptance_criteria` MUST have `met: true`. If any are unmet, reject with the list of unmet criteria.
2. **Agent guard:** Only the `"Documentation"` agent (or the variant `"Documentation Agent"`) may perform this transition. All other agents MUST be rejected with an error that includes the full workflow reminder:
   ```
   Developer → QA → Reviewer → Documentation → COMPLETE
   ```

#### 4.2.3 Any → BLOCKED

`blocked_by` object is **required** with:
- `type`: one of `dependency | decision | external | technical`
- `description`: free-text explanation
- `blocking_work_package` (optional): WP ID of the blocker

#### 4.2.4 COMPLETE → IN_PROGRESS

Increment the WP's `revision` counter by 1.

**Agent guard:** Only the `"Project Manager"` (or `"Project Manager Agent"`) and `"Documentation"` (or `"Documentation Agent"`) agents may perform this transition. All other agents MUST be rejected with a message directing them to hand off to the Project Manager or Documentation agent to formally reopen the work package.

### 4.3 Initial Status on WP Creation

When a work package is created:
- If `dependencies` is empty OR all referenced WPs have status `COMPLETE` → initial status is `READY`
- Otherwise → initial status is `BLOCKED`

---

## 5. Pipeline Lifecycle

### 5.1 Pipeline Ordering (Prerequisites)

Pipelines MUST be started in sequence. Each type has a prerequisite:

| Pipeline Type | Prerequisite | Prerequisite Condition |
|---------------|-------------|------------------------|
| `implementation` | _none_ | Can always start |
| `qa` | `implementation` | Most recent `implementation` pipeline has `PASS` status |
| `code-review` | `qa` | Most recent `qa` pipeline has `PASS` status |
| `documentation` | `code-review` | Most recent `code-review` pipeline has `PASS` status |

If the prerequisite is not met, reject with:
```
Cannot start '{type}' pipeline: requires a PASS '{prerequisite}' pipeline first.
Pipeline order: implementation → qa → code-review → documentation.
```

### 5.2 Starting a Pipeline

**Preconditions:**
1. The work package status MUST be `IN_PROGRESS`
2. No existing pipeline of the same type may be `IN_PROGRESS` (no duplicates)
3. Pipeline prerequisite (§5.1) MUST be satisfied
4. **Agent role check:** If `agent_role` is provided, it MUST match the pipeline type's owner (per §2.3 table). Mismatched roles MUST be rejected with: `"Pipeline type '{type}' can only be started by the {owner} agent."` If `agent_role` is omitted, no role check is performed (backward compatibility).

**Side Effects:**
1. Create a new Pipeline object: `{ type, status: "IN_PROGRESS", started_at: now(), summary: [] }`
2. Append to the WP's `pipelines` array
3. If any previous pipeline of the **same type** has status `FAIL`, increment `rework_count` by 1
4. Update `assigned_to` on both WP detail and root index summary to the pipeline's owner agent (per §2.3 table)
5. Update root index `last_updated` timestamp

### 5.3 Completing a Pipeline

**Input:** pipeline type, result status (`PASS` or `FAIL`), summary strings, and optional fields (artifacts, metrics, comments, acceptance criteria updates, handoff notes).

**Procedure:**
1. Find the most recent `IN_PROGRESS` pipeline of the given type. If none found → error.
2. Set pipeline `status` to the given result.
3. Set `completed_at` to current timestamp.
4. Set `summary` to the provided array.
5. If `artifacts` provided, set on pipeline.
6. If `metrics` provided, set on pipeline.
7. If `comments` provided, set on pipeline.
8. If `acceptance_criteria_updates` provided, for each entry find the matching criterion by string and update its `met` boolean.
9. If `handoff_notes` provided (non-empty array of strings):
   - Construct a `HandoffNote` object:
     ```
     {
       from_agent: PIPELINE_AGENT_MAP[type],
       to_agent: NEXT_AGENT_MAP[type],
       timestamp: now(),
       notes: <the provided strings>
     }
     ```
   - Append to the WP's `handoff_notes` array (create if absent).
10. Update root index `last_updated` timestamp.

### 5.4 Cancelling a Pipeline

**Procedure:**
1. Find the most recent `IN_PROGRESS` pipeline of the given type. If none found → error.
2. Set pipeline `status` to `FAIL`.
3. Set `completed_at` to current timestamp.
4. Set `summary` to `["Cancelled: {reason}"]`.
5. Update root index `last_updated` timestamp.

### 5.5 Updating Pipeline Progress

**Procedure:**
1. Find the most recent `IN_PROGRESS` pipeline of the given type. If none found → error.
2. Replace `summary` with the provided array (note: replaces, not appends).
3. Update root index `last_updated` timestamp.

### 5.6 Rework Count

The `rework_count` field on a WP tracks how many times a pipeline has been restarted after a failure:

| Pipeline history for a type | Effect on `rework_count` |
|-----------------------------|-------------------------|
| No previous pipelines | No change |
| Previous pipelines, all PASS | No change |
| At least one previous FAIL | Increment by 1 |

`rework_count` is `undefined`/absent until the first rework. It is never initialized to 0.

**Implementation note:** Implementations MUST treat absent `rework_count` as 0 for arithmetic purposes: `(rework_count ?? 0) + 1`.

---

## 6. Dependency Propagation (Auto-Unblocking)

When a work package transitions to `COMPLETE`:

1. Scan the root index for all `BLOCKED` WPs whose `dependencies` array includes the just-completed WP ID.
2. For each candidate:
   a. Load the full WP detail.
   b. Check if **all** dependencies (not just the one that completed) are now `COMPLETE`.
   c. If yes:
      - Set WP status to `READY`
      - Clear `blocked_by`
      - Update root index summary
   d. If no: skip (still blocked by other dependencies).
3. Persist all changes atomically.

**Idempotency:** Re-running propagation on an already-unblocked WP is a no-op.

**Concurrency note:** In the reference implementation, propagation runs as a **separate locked operation** after the COMPLETE transition's lock is released. There is a brief window where the root shows a WP as COMPLETE but its dependents are still BLOCKED. This is acceptable for single-agent workflows but would be a race risk in concurrent multi-agent environments.

---

## 7. Workflow Coordination: Next Action

The "next action" system reads project state and returns a **single** recommendation for a given agent role.

### 7.1 Global Prechecks

Before agent-specific logic, evaluate in this order:

1. **No work packages exist:**
   - PM → `CREATE_WORK_PACKAGES`
   - All others → `WAIT`

2. **All work packages COMPLETE:**
   - Synthesis → `GENERATE_SYNTHESIS`
   - PM → `SIGNAL_SYNTHESIS`
   - All others → `WAIT`

### 7.2 Project Manager Logic

1. If any WP is `BLOCKED` → `RESOLVE_BLOCKERS` (return the first blocked WP ID)
2. Otherwise → `WAIT`

### 7.3 Developer Logic

Priority order (return the first match):

1. **Stale pipeline check:** For each WP, if it has an `implementation` pipeline that is `IN_PROGRESS` and was started more than **24 hours** ago → `RESUME_OR_CANCEL` (include pipeline age)

2. **New work:** For each WP that is `READY` or `IN_PROGRESS`:
   - AND is not dependency-blocked (all deps COMPLETE)
   - AND has no `implementation` pipeline at all
   - → `IMPLEMENT` (include next_steps guidance; if READY, include claim step)

3. **Failed implementation:** For each WP:
   - AND status is not `BLOCKED`
   - AND the **most recent** `implementation` pipeline has `FAIL` status
   - → `REWORK`

4. **Downstream failure (QA or code-review):** For each WP:
   - AND has a `PASS` implementation pipeline
   - AND the **most recent** `qa` or `code-review` pipeline has `FAIL` status (check `qa` first, then `code-review`)
   - → `REWORK` (include `pipeline_that_failed` field)

5. No match → `WAIT`

### 7.4 QA Logic

Priority order:

1. **Stale pipeline:** `qa` pipeline older than 24h → `RESUME_OR_CANCEL`
2. **New work:** WP has `PASS` implementation, AND (no `qa` pipeline, OR most recent `PASS` implementation `completed_at` > most recent `qa` `started_at`), AND status is NOT `BLOCKED` → `RUN_QA`
3. **Rework:** Status not BLOCKED, most recent `qa` is `FAIL` → `REWORK_QA`
4. No match → `WAIT`

### 7.5 Reviewer Logic

Priority order:

1. **Stale pipeline:** `code-review` pipeline older than 24h → `RESUME_OR_CANCEL`
2. **New work:** WP has `PASS` qa, AND (no `code-review` pipeline, OR most recent `PASS` qa `completed_at` > most recent `code-review` `started_at`), AND status is NOT `BLOCKED` → `RUN_REVIEW`
3. **Rework:** Status not BLOCKED, most recent `code-review` is `FAIL` → `REWORK_REVIEW`
4. No match → `WAIT`

### 7.6 Documentation Logic

Priority order:

1. **Stale pipeline:** `documentation` pipeline older than 24h → `RESUME_OR_CANCEL`
2. **Mark complete check:** WP is `IN_PROGRESS` AND has `PASS` pipelines for ALL 4 types → `MARK_COMPLETE`
3. **New work:** WP has `PASS` code-review, AND (no `documentation` pipeline, OR most recent `PASS` code-review `completed_at` > most recent `documentation` `started_at`), AND status is NOT `BLOCKED` → `WRITE_DOCS`
4. **Rework:** Status not BLOCKED, most recent `documentation` is `FAIL` → `REWORK_DOCS`
5. No match → `WAIT`

### 7.7 Synthesis Logic

- Always → `WAIT` (unless the global "all complete" check fires `GENERATE_SYNTHESIS` in §7.1)

### 7.8 Most-Recent-Pipeline-Fail Semantics

The "rework needed" check is based **only on the most recent pipeline** of a given type:

| Pipeline history for type X | Rework needed? |
|-----------------------------|---------------|
| `[]` (none) | No |
| `[FAIL]` | **Yes** |
| `[PASS]` | No |
| `[FAIL, PASS]` | No (resolved) |
| `[PASS, FAIL]` | **Yes** (regression) |
| `[FAIL, FAIL]` | **Yes** |

The rationale: a FAIL followed by a PASS means the issue was resolved. Only the current (most recent) state of the pipeline matters.

### 7.9 Stale Pipeline Detection

A pipeline is "stale" when:
- `status` is `IN_PROGRESS`
- `started_at` is defined
- `(now - started_at)` exceeds 24 hours

The RESUME_OR_CANCEL response includes: `work_package_id`, `pipeline_type`, `started_at`, `age_hours`.

### 7.10 Handoff Notes in Responses

When returning an action recommendation that addresses an agent, include any `handoff_notes` on the WP that are addressed to that agent (where `to_agent` matches).

### 7.11 Temporal Precedence Rule

When a Developer completes a rework cycle, the new `PASS` implementation pipeline post-dates the downstream pipelines that ran against the previous implementation. Without temporal comparison, downstream agents (QA, Reviewer, Documentation) would remain in `WAIT` because their pipelines already exist — causing a silent workflow stall.

**Rule:** For QA, Reviewer, and Documentation new-work checks, the condition is not merely "no downstream pipeline exists" but rather:

> The most recent **upstream PASS** pipeline's `completed_at` timestamp is **after** the most recent **downstream** pipeline's `started_at` timestamp.

This naturally handles both cases:
- **First run:** No downstream pipeline → condition is trivially true (trigger).
- **Rework re-engagement:** New upstream PASS added after last downstream start → condition is true (re-trigger).
- **Already up-to-date:** Downstream started after upstream completed → condition is false (skip).

Implementation: `hasNewUpstreamPassSince(pipelines, upstreamType, downstreamType)` in `utils/workflow-helpers.ts`.

---

## 8. Workflow Coordination: Handoff Status

The "handoff status" system determines which agent should work next and whether the current agent's work is done.

### 8.1 Global Prechecks

1. **BLOCKED, no actionable WPs:** If any WP is `BLOCKED` AND no WP is `READY` or `IN_PROGRESS` (regardless of `COMPLETE` WPs) → Return status `BLOCKED` → next agent is PM.

### 8.2 Planner Handoff

1. If no work packages exist → `WAIT` (planning complete; PM should create WPs)
2. If any WP is `READY` or `IN_PROGRESS` → `READY_FOR_DEVELOPER`
3. Otherwise → `WAIT` (all WPs are COMPLETE or BLOCKED; no further planner action needed)

### 8.3 Handoff Status Values

| Status | Meaning | Next Agent |
|--------|---------|------------|
| `READY_FOR_DEVELOPER` | Developer should pick up work | Developer |
| `READY_FOR_QA` | QA should start | QA |
| `READY_FOR_REVIEW` | Reviewer should start | Reviewer |
| `READY_FOR_DOCUMENTATION` | Documentation should start | Documentation |
| `READY_FOR_SYNTHESIS` | Synthesis should start | Synthesis |
| `IN_PROGRESS` | Current agent should continue | Same agent |
| `BLOCKED` | Work is blocked | Project Manager |
| `COMPLETE` | Project complete | _none_ |

### 8.4 Project Manager Handoff

1. If any WP is `READY` or `IN_PROGRESS` with no `implementation` pipeline → `READY_FOR_DEVELOPER`
2. Otherwise → `IN_PROGRESS`

### 8.5 Developer Handoff

Consider only **non-BLOCKED** WPs:

1. If all non-blocked WPs have a `PASS` implementation pipeline → `READY_FOR_QA`
2. If any non-blocked WP lacks an implementation pipeline OR has any `FAIL` implementation pipeline (with no subsequent `PASS`) → `IN_PROGRESS` (with count of WPs needing work)
3. Otherwise → `READY_FOR_QA`

### 8.6 QA Handoff

Let `wpsWithImpl` = WPs with `PASS` implementation pipeline.
Let `wpsStillNeedingImpl` = WPs without `PASS` implementation.

1. If all `wpsWithImpl` have `PASS` qa:
   a. If `wpsStillNeedingImpl` exist:
      - All are dependency-blocked → `READY_FOR_REVIEW`
      - Some are ready → `READY_FOR_DEVELOPER`
   b. No remaining WPs → `READY_FOR_REVIEW`

2. If any non-BLOCKED WP in `wpsWithImpl` needs qa or has `FAIL` qa → `IN_PROGRESS`

3. If all qa work is done but `wpsStillNeedingImpl` exist:
   - All dependency-blocked → `READY_FOR_REVIEW`
   - Some ready → `READY_FOR_DEVELOPER`

4. Fallback → `READY_FOR_REVIEW`

### 8.7 Reviewer Handoff

Let `wpsWithQa` = WPs with `PASS` qa pipeline.
Let `wpsNotYetQaPassed` = WPs without `PASS` qa.

Follows the same pattern as QA handoff (§8.5) but shifted one stage forward:
- "Work done" target: `READY_FOR_DOCUMENTATION`
- "Work remaining" fallback: `READY_FOR_DEVELOPER`
- Dependency-blocked unreviewed WPs → `READY_FOR_DOCUMENTATION` (proceed forward past blocked WPs)

### 8.8 Documentation Handoff

Let `wpsWithReview` = WPs with `PASS` code-review pipeline.
Let `wpsNotYetReviewed` = WPs without `PASS` code-review.

1. If all `wpsWithReview` have `PASS` documentation:
   a. If `wpsNotYetReviewed` exist:
      - All dependency-blocked → `READY_FOR_SYNTHESIS`
      - Some ready → `READY_FOR_DEVELOPER`
   b. No remaining → `READY_FOR_SYNTHESIS`

2. If any non-BLOCKED WP in `wpsWithReview` needs docs or has `FAIL` docs → `IN_PROGRESS`

3. If all docs work done but `wpsNotYetReviewed` exist:
   - All dependency-blocked → `READY_FOR_SYNTHESIS`
   - Some ready → `READY_FOR_DEVELOPER`

4. Fallback → `READY_FOR_SYNTHESIS`

### 8.9 Synthesis Handoff

Always returns `COMPLETE`.

**Tool ordering guidance:** Synthesis should call `ledger_get_next_action` first to verify there is no remaining synthesis work pending, then call `ledger_get_handoff_status` after generating the report. The `get_handoff_status` response includes a `next_action` field with this reminder.

### 8.10 Dependency-Blocked WP Handling in Handoffs (Critical Invariant)

When computing handoffs for QA, Reviewer, and Documentation:

- WPs that are blocked by **incomplete dependencies** are excluded from the "work remaining" count.
- If ALL remaining WPs (that haven't passed the current stage) are dependency-blocked, the handoff progresses **forward** (to Review, Documentation, or Synthesis) rather than sending the agent back to the Developer.
- This prevents workflow stalls where the only remaining WPs are waiting on dependencies that can't be resolved yet.

---

## 9. Auto-Handoff Chain

### 9.1 Mechanism

When the handoff status tool returns a `READY_FOR_*` status, it may include an `auto_handoff` object that enables automatic agent invocation without human intervention.

### 9.2 Eligibility Conditions (ALL must be true)

1. `auto_handoff_enabled` is `true` in runtime configuration
2. An agent registry is loaded (mapping role names → agent handles)
3. The next agent has a known handle in the registry
4. The handoff status is NOT `COMPLETE`, `BLOCKED`, or `IN_PROGRESS`
5. `auto_handoff_depth` in the root index is less than the configured maximum (default: 10)

### 9.3 Auto-Handoff Depth Counter

| Event | Effect |
|-------|--------|
| Eligible auto-handoff emitted | Increment `auto_handoff_depth` by 1, persist to root index |
| Any work package reaches COMPLETE status | Reset `auto_handoff_depth` to 0 (prevents stalling across multi-WP projects) |
| Depth reaches maximum | `auto_handoff` object is **omitted** from response (chain terminates silently) |

### 9.4 Auto-Handoff Payload

```
{
  agent_name: string,  // The agent handle (e.g., "3 - Developer v3.5.0")
  prompt: string       // "Project path: {project_path}"
}
```

### 9.5 Failure Handling

If a storage error occurs during depth counter update, the error is logged to stderr and auto-handoff is silently skipped. The main handoff response is still returned.

---

## 10. Self-Healing: Counter and Status Correction

The "get project status" operation auto-corrects drift:

### 10.1 Counter Recomputation

On every invocation:
1. `total_work_packages` = count of `work_packages` array
2. `pending_work_packages` = count where `status ≠ COMPLETE`

If either counter is incorrect, silently correct it.

### 10.2 Project Status Auto-Healing

| Current Status | Condition | Healed Status |
|----------------|-----------|---------------|
| `IN_PROGRESS` | `pending = 0` AND WPs exist | `COMPLETE` |
| `COMPLETE` | `pending > 0` | `IN_PROGRESS` |
| `READY` | Any WP is `IN_PROGRESS` | `IN_PROGRESS` |
| `BLOCKED` | No WPs are actually `BLOCKED` | `IN_PROGRESS` (if any WP is IN_PROGRESS) or `READY` (if any WP is READY) |
| Any | No WPs exist | Never auto-healed to COMPLETE |

Only write to disk if a correction was actually made.

---

## 11. Pipeline Completion Guidance

After completing a pipeline, the system returns explicit "next step" guidance to the agent. This is a self-healing measure preventing agents from guessing.

### 11.1 PASS Guidance

| Pipeline Type | Guidance |
|---------------|----------|
| `implementation` | Call `get_handoff_status` to confirm handoff to QA |
| `qa` | Call `get_handoff_status` to confirm handoff to Reviewer |
| `code-review` | Call `get_handoff_status` to confirm handoff to Documentation |
| `documentation` | Mark WP as COMPLETE first, then call `get_handoff_status` |

### 11.2 FAIL Guidance

| Pipeline Type | Guidance |
|---------------|----------|
| `implementation` | Leave WP as IN_PROGRESS. Developer will see via next-action. |
| `qa` | Leave WP as IN_PROGRESS. Do NOT set to BLOCKED. Developer reworks. |
| `code-review` | Leave WP as IN_PROGRESS. Do NOT set to BLOCKED. Developer reworks. |
| `documentation` | Same as above. |

**Critical rule:** On a FAIL pipeline, the WP MUST remain `IN_PROGRESS`. It MUST NOT be set to `BLOCKED`. The Developer will pick it up through the next-action system which detects downstream pipeline failures (§7.3, step 4).

---

## 12. Work Package ID Generation

IDs follow the format `WP-###` (3-digit zero-padded integer).

**Algorithm:**
1. Scan all existing WP IDs, extract numeric suffixes.
2. Next ID = max(suffixes) + 1.
3. If no WPs exist → `WP-001`.

This is **max-based**, not length-based. Deleting a WP does not cause ID collisions. IDs may have gaps.

---

## 13. Concurrency Model

### 13.1 File Locking

All dual-file updates (WP detail + root index) MUST be wrapped in a lock:
- Lock file: `{storage_dir}/.lock`
- Stale timeout: 10 seconds
- Retry count: 5
- Retry interval: 200ms

### 13.2 Atomic Writes

All file writes use the write-to-temp-then-rename pattern:
1. Write to `{file}.tmp.{pid}`
2. Atomically rename to target

### 13.3 Read-Validate Pattern

All reads:
1. Read raw file
2. Parse JSON
3. Validate against schema
4. Return typed data or throw

### 13.4 Write-Validate Pattern

All writes:
1. Validate data against schema
2. Serialize to pretty JSON (2-space indent + trailing newline)
3. Write atomically

---

## 14. Edge Cases and Gotchas

### 14.1 Revision Only Increments on COMPLETE → IN_PROGRESS

The `revision` field increments **only** on the COMPLETE → IN_PROGRESS transition. No other transition affects it.

### 14.2 Metrics Object Is Extensible

The `metrics` object accepts arbitrary additional fields beyond the predefined set (`test_coverage`, `tests_passed`, `tests_failed`, `security_issues`).

### 14.3 Work Package Summaries Are Denormalized

Root index summaries duplicate a subset of WP detail data (ID, status, assigned_to, dependencies, file path). The system MUST keep summaries in sync with details. The `updateWorkPackageWithSync` pattern ensures this.

### 14.4 Pipeline Comments Have No Agent Field

Pipeline-level comments omit the `agent` field — it is inferred from the pipeline type. Project-level comments **do** include an explicit `agent` field.

### 14.5 Incident Comments Require Context

When adding a project comment with `type: "incident"`, a `context` object is **required** containing: `os`, `tool`, `resolved` (boolean), and optionally `work_package` and `workaround`.

### 14.6 Developer Sees Downstream Failures

The Developer's next-action logic checks not only for `FAIL` implementation pipelines, but also for `FAIL` qa and `code-review` pipelines on WPs that have a `PASS` implementation. This prevents deadlocks where downstream rejections are invisible to the Developer.

### 14.7 Documentation Agent Detects Forgotten COMPLETE

The Documentation agent's next-action logic checks for WPs that have all 4 pipeline types with `PASS` status but are still `IN_PROGRESS`. It returns `MARK_COMPLETE` to prompt the agent to finalize the WP.

### 14.8 BLOCKED WPs Are Excluded from Rework Suggestions

Pipeline rework actions (REWORK_QA, REWORK_REVIEW, REWORK_DOCS) are **not** suggested for WPs with `BLOCKED` status. Blocked WPs need upstream (typically Developer) intervention first.

### 14.9 Lock File Persistence

Lock files are not cleaned up on process exit. They persist on disk. The locking system handles stale locks automatically via the 10-second timeout.

### 14.10 Handoff Notes Are Append-Only

Handoff notes are never modified or deleted. Each pipeline completion that includes `handoff_notes` appends a new entry. Notes are queried by `to_agent` field.

### 14.11 Pipeline Start Auto-Updates assigned_to

When a pipeline starts, both the WP detail and root index summary `assigned_to` fields are updated to the pipeline's owner agent. This happens atomically.

### 14.12 Dependency Auto-Unblocking Transitions to READY, Not IN_PROGRESS

When dependencies are satisfied and a BLOCKED WP is auto-unblocked, it transitions to `READY` (not `IN_PROGRESS`). The agent must then explicitly claim it.

---

## 15. Batch Next Actions

A batch variant of the next-action system returns **all** actionable WPs for an agent (up to a configurable limit, default 5), instead of just the first.

The logic per WP is identical to the single next-action (§7), but:
- All matches are collected (not just the first)
- Stale pipelines take priority per-WP: if a WP has a stale pipeline, skip new-work and rework checks for that WP
- A `max_results` limit caps the response array
- Non-applicable roles (Planner, PM, Synthesis) return an empty array

---

## 16. Data Schemas

### 16.1 Root Index

```
{
  plan_file: string,
  date_created: string,         // "YYYY-MM-DD HH:MM:SS"
  last_updated: string,         // "YYYY-MM-DD HH:MM:SS"
  status: ProjectStatus,
  total_work_packages: number,
  pending_work_packages: number,
  work_packages: WorkPackageSummary[],
  project_comments: ProjectComment[],
  auto_handoff_depth?: number   // absent/undefined treated as 0
}
```

### 16.2 Work Package Summary (in root index)

```
{
  work_package_id: string,      // "WP-###"
  status: WorkPackageStatus,
  assigned_to: string,
  dependencies: string[],       // array of WP IDs
  file: string                  // relative path to detail file
}
```

### 16.3 Work Package Detail

```
{
  work_package_id: string,      // "WP-###"
  work_package_file: string,
  status: WorkPackageStatus,
  assigned_to: string,
  dependencies: string[],
  blocked_by?: Blocker,
  acceptance_criteria: AcceptanceCriterion[],
  revision: number,
  rework_count?: number,
  handoff_notes?: HandoffNote[],
  pipelines: Pipeline[]
}
```

### 16.4 Pipeline

```
{
  type: string,                 // "implementation" | "qa" | "code-review" | "documentation"
  status: PipelineStatus,
  started_at?: string,
  completed_at?: string,
  summary: string[],
  artifacts?: Artifacts,
  metrics?: Metrics,
  comments?: PipelineComment[]
}
```

### 16.5 HandoffNote

```
{
  from_agent: string,
  to_agent: string,
  timestamp: string,
  notes: string[]
}
```

### 16.6 AcceptanceCriterion

```
{
  criterion: string,
  met: boolean
}
```

### 16.7 Blocker

```
{
  type: "dependency" | "decision" | "external" | "technical",
  description: string,
  blocking_work_package?: string
}
```

### 16.8 Artifacts

```
{
  files_modified?: string[],
  commit_hash?: string,
  pull_request?: string
}
```

### 16.9 Metrics (extensible)

```
{
  test_coverage?: string,
  tests_passed?: number,
  tests_failed?: number,
  security_issues?: number,
  [additional_keys: any]
}
```

### 16.10 PipelineComment

```
{
  type: string,
  priority: "low" | "medium" | "high",
  timestamp: string,
  note: string
}
```

### 16.11 ProjectComment

```
{
  type: string,
  priority: "low" | "medium" | "high",
  timestamp: string,
  agent: string,
  note: string,
  context?: IncidentContext
}
```

### 16.12 IncidentContext

```
{
  os: string,
  tool: string,
  work_package?: string,
  resolved: boolean,
  workaround?: string
}
```

---

## 17. Timestamp Format

All timestamps MUST use the format `YYYY-MM-DD HH:MM:SS` in **local time** (not UTC).

Do NOT use ISO 8601 with timezone suffixes (`Z`, `+00:00`). The local-time-without-timezone format is intentional to avoid UTC conversion errors for users in non-UTC timezones.

---

## 18. Complete Workflow Sequence (Happy Path)

This traces a single work package through the entire workflow:

```
1. Planner creates plan document (outside ledger)

2. PM initializes project
   └─ ledger_initialize_project → creates root index

3. PM creates work packages
   └─ ledger_create_work_package × N → WPs in READY or BLOCKED status

4. PM calls get_handoff_status → READY_FOR_DEVELOPER

5. Developer claims WP
   └─ ledger_claim_work_package → WP: READY → IN_PROGRESS

6. Developer starts implementation
   └─ ledger_start_pipeline(type: implementation) → pipeline IN_PROGRESS

7. Developer completes implementation
   └─ ledger_complete_pipeline(type: implementation, status: PASS)
   └─ Handoff notes → addressed to QA

8. Developer calls get_handoff_status → READY_FOR_QA

9. QA starts validation
   └─ ledger_start_pipeline(type: qa) → pipeline IN_PROGRESS
   └─ assigned_to auto-updated to "QA"

10. QA completes validation
    └─ ledger_complete_pipeline(type: qa, status: PASS)
    └─ Handoff notes → addressed to Reviewer

11. QA calls get_handoff_status → READY_FOR_REVIEW

12. Reviewer starts code review
    └─ ledger_start_pipeline(type: code-review) → pipeline IN_PROGRESS
    └─ assigned_to auto-updated to "Reviewer"

13. Reviewer completes review
    └─ ledger_complete_pipeline(type: code-review, status: PASS)
    └─ Handoff notes → addressed to Documentation

14. Reviewer calls get_handoff_status → READY_FOR_DOCUMENTATION

15. Documentation starts docs
    └─ ledger_start_pipeline(type: documentation) → pipeline IN_PROGRESS
    └─ assigned_to auto-updated to "Documentation"

16. Documentation completes docs
    └─ ledger_complete_pipeline(type: documentation, status: PASS)

17. Documentation marks WP complete
    └─ ledger_update_work_package_status(status: COMPLETE, agent: "Documentation")
    └─ Dependency propagation runs → BLOCKED dependents may become READY

18. Documentation calls get_handoff_status → READY_FOR_SYNTHESIS (if all WPs done)

19. Synthesis generates report
```

---

## 19. Failure / Rework Sequences

### 19.1 QA Fails a Work Package

```
QA completes qa pipeline with FAIL
  └─ WP remains IN_PROGRESS (NOT set to BLOCKED)
  └─ QA calls get_handoff_status → routes to Developer

Developer calls get_next_action
  └─ Detects FAIL qa pipeline on a WP with PASS implementation
  └─ Returns REWORK with pipeline_that_failed: "qa"

Developer starts new implementation pipeline
  └─ rework_count is **not** incremented for the new implementation pipeline
     (the previous implementation was PASS, not FAIL)

Developer completes implementation with PASS
  └─ Handoff to QA

QA retries validation
  └─ New qa pipeline (rework_count **is** incremented because the previous qa pipeline was FAIL)
```

### 19.2 Reviewer Rejects a Work Package

Same pattern as 19.1, but:
- Reviewer completes code-review with FAIL
- Developer sees FAIL code-review via next-action
- Developer reworks implementation
- Work re-enters the pipeline chain: implementation → qa → code-review

### 19.3 Stale Pipeline Recovery

```
Agent calls get_next_action
  └─ Detects pipeline IN_PROGRESS for > 24 hours
  └─ Returns RESUME_OR_CANCEL

Agent decides to cancel:
  └─ ledger_cancel_pipeline(reason: "Agent session expired")
  └─ Pipeline set to FAIL

Agent (same or different) calls get_next_action
  └─ Now sees FAIL pipeline → REWORK recommendation
```

---

## 20. Multi-WP Project with Dependencies

```
PM creates:
  WP-001 (no deps)     → READY
  WP-002 (deps: [001]) → BLOCKED
  WP-003 (no deps)     → READY

Developer implements WP-001 and WP-003 (parallel-capable)

When WP-001 reaches COMPLETE:
  └─ propagateDependencyUnblock fires
  └─ WP-002's only dep (001) is COMPLETE → WP-002 transitions BLOCKED → READY

Developer can now claim and implement WP-002

Handoff logic: QA sees WPs with PASS implementation
  └─ If WP-002 still needs impl, dependency-blocked check determines whether
     to route forward or back to Developer
```

---

## 21. Glossary

| Term | Definition |
|------|-----------|
| **Auto-handoff** | Automatic invocation of the next agent without human intervention |
| **Dependency propagation** | Automatic unblocking of downstream WPs when a dependency completes |
| **Handoff** | The transfer of workflow control from one agent to the next |
| **Most-recent pipeline** | The last element in the pipelines array filtered by type |
| **Pipeline chain** | The sequence: implementation → qa → code-review → documentation |
| **Rework** | A new pipeline cycle triggered by a previous FAIL |
| **Rework count** | Counter tracking how many times a pipeline type has been retried after failure |
| **Self-healing** | Automatic correction of counters, statuses, or guidance without human intervention |
| **Stale pipeline** | An IN_PROGRESS pipeline started more than 24 hours ago |
| **Work package** | The atomic unit of work tracked by the ledger |

---

## Appendix A: Action Types Reference

| Action | Agent | Meaning |
|--------|-------|---------|
| `CREATE_WORK_PACKAGES` | PM | No WPs exist; create them |
| `RESOLVE_BLOCKERS` | PM | WPs are blocked; investigate |
| `SIGNAL_SYNTHESIS` | PM | All WPs complete; signal Synthesis |
| `IMPLEMENT` | Developer | Claim and implement a WP |
| `REWORK` | Developer | Fix implementation after failure |
| `RUN_QA` | QA | Start QA on a WP |
| `REWORK_QA` | QA | Retry QA after failure |
| `RUN_REVIEW` | Reviewer | Start code review on a WP |
| `REWORK_REVIEW` | Reviewer | Retry review after failure |
| `WRITE_DOCS` | Documentation | Write documentation for a WP |
| `REWORK_DOCS` | Documentation | Retry docs after failure |
| `MARK_COMPLETE` | Documentation | Mark a fully-pipelined WP as COMPLETE |
| `GENERATE_SYNTHESIS` | Synthesis | All WPs complete; generate report |
| `RESUME_OR_CANCEL` | Any pipeline agent | Stale pipeline detected |
| `WAIT` | Any | No work available for this role |

---

## Appendix B: Handoff Status Reference

| Status | Source Agent(s) | Next Agent |
|--------|----------------|------------|
| `READY_FOR_DEVELOPER` | PM, QA, Reviewer, Documentation | Developer |
| `READY_FOR_QA` | Developer | QA |
| `READY_FOR_REVIEW` | QA | Reviewer |
| `READY_FOR_DOCUMENTATION` | Reviewer | Documentation |
| `READY_FOR_SYNTHESIS` | Documentation | Synthesis |
| `IN_PROGRESS` | Any | Same agent continues |
| `BLOCKED` | Any | Project Manager |
| `COMPLETE` | Synthesis | _none_ |
