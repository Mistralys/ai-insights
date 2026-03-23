# Agent Workflow Specification — Audit Synthesis

**Date:** 2026-02-25
**Source Audits:** Claude Code, Gemini, Claude Web, GitHub Copilot
**Specification:** [agent-workflow-specification.md](agent-workflow-specification.md)

---

## Methodology

Four independent audits of the Agent Workflow Specification v1.0.0 were conducted. This synthesis consolidates their findings into a single prioritized issue list. Issues found by multiple auditors carry higher confidence. Each issue is tagged with its source audits.

**Confidence legend:** 🔴 Found by 3–4 auditors | 🟡 Found by 2 auditors | ⚪ Found by 1 auditor

---

## I. Critical — Workflow-Breaking

These issues will cause deadlocks, infinite loops, or silent stalls in any faithful implementation of the spec.

### C-1. FAIL handoff logic stalls the rework loop 🔴

**Sources:** Claude Code §2, Gemini §1, Claude Web §1
**Sections:** §7.2, §8.1, §8.2, §10.3, §13.2

The specification has three interlocking failures around what happens when a downstream pipeline (QA, code-review) FAILs:

1. **Handoff status traps the wrong agent.** When QA FAILs, the handoff logic (§8.2) returns `IN_PROGRESS`, which maps to "same agent continues" (§8.3). But QA cannot act — only the Developer can fix the code. The `IN_PROGRESS` status also disqualifies auto-handoff (§10.3 condition 4), so the Developer is never automatically invoked. **Result: the workflow stalls.**

2. **Next-action gives QA a nonsensical self-rework action.** §8.1 QA priority 3 returns `REWORK_QA` when the most-recent `qa` pipeline is `FAIL`. But re-running QA on unchanged broken code is pointless. The Developer must fix the code first. Gemini notes this creates an infinite loop risk if QA blindly acts on `REWORK_QA`.

3. **Handoff note routes to the wrong agent.** `complete_pipeline` (§7.2) always routes the handoff note `to_agent` via the Next-Agent Map (`qa → Reviewer`), even on FAIL. The failure information reaches Reviewer instead of Developer, the agent that needs it.

4. **Walkthrough contradicts the rules.** §13.2 claims that `get_handoff_status` after a QA FAIL returns `READY_FOR_DEVELOPER`, but the actual handoff logic in §8.2 returns `IN_PROGRESS`.

**Fix:** On pipeline FAIL, the handoff logic for QA/Reviewer/Documentation must return `READY_FOR_DEVELOPER` (not `IN_PROGRESS`). Remove `REWORK_QA` and `REWORK_REVIEW` from their next-action maps. Add a failure-specific handoff note routing map (`to_agent` = Developer on FAIL). Align the walkthrough with the rules once corrected.

---

### C-2. Rework count semantics contradict the walkthrough 🔴

**Sources:** Claude Code §3, Claude Web §2, Copilot §5
**Sections:** §7.1, §7.6, §13.2

The rules and the worked example disagree on when `rework_count` increments:

| Source | Rule | Trigger |
|--------|------|---------|
| §7.1 / §7.6 | "At least one prior FAIL of the same type" | **Any** historical FAIL |
| §13.2 | "The impl pipeline was PASS, so rework_count is NOT incremented" | Only **most recent** is FAIL |

Given history `[FAIL, PASS]` for implementation, a new `implementation` pipeline starts (due to downstream QA FAIL). §7.1 says increment (prior FAIL exists). §13.2 says do not (most recent was PASS). These cannot both be correct.

**Secondary issue (Claude Web):** Even if resolved, `rework_count` only tracks same-type pipeline retries-after-own-FAIL, not "how many times this WP went through the rework loop." A downstream QA FAIL that triggers a new implementation pipeline on a previously-PASS implementation does not increment any counter. The metric is semantically misleading.

**Fix:** Decide on one semantic: "most recent pipeline of same type is FAIL" (likely intent). Rename to `pipeline_retry_count` or add a separate WP-level `rework_cycles` counter. Clarify the absent-field case (§3.3): treat absent as `0`, then increment to `1`.

---

### C-3. Synthesis agent has no terminal mechanism 🔴

**Sources:** Claude Code §12, Gemini §4, Claude Web §6
**Sections:** §8.1, §11.1, §13.1

Three related problems around how the workflow ends:

1. **Infinite loop.** The global pre-check returns `GENERATE_SYNTHESIS` whenever all WPs are COMPLETE. Synthesis owns no pipeline and writes no state, so the condition remains true after Synthesis acts. Every subsequent `get_next_action` call for Synthesis returns `GENERATE_SYNTHESIS` again.

2. **Project COMPLETE before Synthesis runs.** Self-healing (§11.1) sets project status to `COMPLETE` when `pending_work_packages == 0`, which is true as soon as Documentation finishes — before Synthesis generates its report. The project is "done" before its final deliverable exists.

3. **No explicit project completion mechanism.** The spec never defines who sets the project to a genuinely terminal state or what operation they use.

**Fix:** Add a `DONE` or `SYNTHESIZED` terminal project status (or a `synthesis_generated` flag on the root index). Synthesis writes this flag after generating its report. The global pre-check only triggers `GENERATE_SYNTHESIS` if the flag is absent. Self-healing should not mark COMPLETE until synthesis is done.

---

### C-4. No circular dependency detection 🟡

**Sources:** Claude Code §1, (implicit in Gemini §2's dependency discussion)
**Sections:** §9.1, §6.3

WP creation validates that dependency IDs exist but never checks for cycles. If PM creates `WP-001 → WP-002` and `WP-002 → WP-001`, both start as BLOCKED with no possibility of ever being unblocked (auto-unblock in §9.2 requires a dependency to reach COMPLETE first). This is a permanent, unrecoverable deadlock.

**Fix:** Add cycle detection (topological sort or DFS) at WP creation time. Reject creation if adding the dependency would form a cycle. Consider also adding a runtime safety check in `get_next_action` that detects and reports circular blocks.

---

### C-5. Reopening a COMPLETE WP doesn't cascade-block dependents 🟡

**Sources:** Gemini §2, Claude Web §4
**Sections:** §6.6, §9.2

The spec defines auto-**un**block on COMPLETE, but has no inverse: auto-**re-block** on reopen. If WP-001 completes, WP-002 (depending on it) unblocks. If WP-001 is then reopened to IN_PROGRESS, WP-002 remains READY or IN_PROGRESS despite its dependency no longer being satisfied.

Additionally (Claude Web), reopening doesn't reset existing pipelines. Old PASS pipelines persist and may satisfy prerequisite checks for downstream stages, allowing work to proceed on stale assumptions.

**Fix:** When a COMPLETE WP is reopened, cascade-block all WPs that depend on it (unless they're already COMPLETE). Document whether old pipelines should be invalidated or whether `hasNewUpstreamPassSince` is the intended guard.

---

## II. Design Issues — Correctness Under Stress

These issues cause incorrect behavior under specific conditions (concurrency, scale, edge cases) but do not break the happy path.

### D-1. Lock retry window is too short for the stale timeout 🟡

**Sources:** Gemini §3, Copilot §1–§2, §9
**Sections:** §12.2

The lock parameters create a mismatch: 5 retries × 200ms = ~1 second of waiting, but the stale timeout is 10 seconds. A legitimate lock holder taking 2–9 seconds will cause all other agents to fail with lock acquisition errors even though the lock is not stale. Additionally:

- Lock ownership metadata is not specified — force-override cannot verify whether the holder is still alive.
- No crash-recovery routine is defined for partial dual-file writes.
- Concurrent `start_pipeline` calls can race between precondition read and lock acquisition.

**Fix:** Align retry duration with stale timeout (e.g., 50 retries × 200ms = 10s). Add lock owner PID/timestamp metadata. Define write ordering and crash-recovery for dual-file operations. Make `start_pipeline` a compare-and-set under lock.

---

### D-2. Timestamps use local time, breaking temporal checks 🟡

**Sources:** Claude Web §10, Copilot §6, §10
**Sections:** §15 Invariant 4, §8.1

`hasNewUpstreamPassSince` compares `completed_at > started_at` using strict `>`. With local time (no timezone), cross-host or cross-timezone comparisons produce incorrect results. Missing timestamps cause the function to return `false`, suppressing necessary downstream work.

**Fix:** Require ISO 8601 UTC timestamps (`YYYY-MM-DDTHH:MM:SSZ`). Consider pipeline sequence numbers as a timezone-proof fallback for temporal ordering.

---

### D-3. No WP cancellation or deletion mechanism 🟡

**Sources:** Claude Code §7, Gemini §5
**Sections:** §6.1

There is no `CANCELLED` status and no delete operation. An unneeded WP can only be forced to COMPLETE (requiring all acceptance criteria met and Documentation involvement) or left BLOCKED forever (which prevents the project from reaching COMPLETE since `pending_work_packages > 0`).

**Fix:** Add a `CANCELLED` terminal status, permitted only by Project Manager. Define how CANCELLED interacts with `pending_work_packages` (does not count as pending), dependency resolution (treated like COMPLETE for unblocking), and project completion checks.

---

### D-4. No rework circuit breaker ⚪

**Source:** Claude Web §3
**Sections:** §8.1, §10

There is a `max_handoff_depth` to prevent infinite auto-handoff chains, but no equivalent limit on rework cycles. A persistent defect that an AI agent cannot resolve leads to an unbounded Developer → QA → Developer → QA loop. The system has no way to escalate or halt.

**Fix:** Add a `max_rework_count` (configurable, e.g., 5). When exceeded, set the WP to BLOCKED with a "max rework exceeded" blocker and surface a `RESOLVE_BLOCKERS` action to the PM.

---

### D-5. WP ID format caps at 999 🟡

**Sources:** Claude Code §5, Claude Web §8
**Sections:** §15 Invariant 1, §9.3

The regex `/^WP-\d{3}$/` and "zero-padded to 3 digits" break at WP-1000.

**Fix:** Relax regex to `/^WP-\d{3,}$/` or document the limit as intentional.

---

### D-6. Documentation FAIL with no path to Developer ⚪

**Sources:** Claude Code §11, Claude Web §5
**Sections:** §8.1

If a documentation pipeline FAILs and the root cause requires code changes, there is no routing path to Developer. The Developer's next-action (priority 4) only checks for `qa` or `code-review` FAIL — not `documentation` FAIL. Documentation is implicitly expected to handle its own rework, but this is never stated.

**Fix:** Explicitly document that Documentation handles its own FAIL. For cases requiring code changes, Documentation should BLOCK the WP with a `technical` blocker, routing to PM for resolution.

---

### D-7. `get_project_status` self-heal mutates state on read ⚪

**Source:** Copilot (medium priority)
**Sections:** §11.1

Self-healing can write corrections to disk during a read-only `get_project_status` call. This violates least-surprise and can race with concurrent writes.

**Fix:** Separate `compute_status` (pure, returns corrected view) from `repair_status` (explicit write). Or document the mutation as intentional and ensure it's idempotent under the lock.

---

## III. Ambiguities — Spec Gaps Requiring Clarification

| # | Issue | Sections | Sources | Resolution Needed |
|---|-------|----------|---------|-------------------|
| A-1 | COMPLETE→COMPLETE no-op: does it bypass the "only Documentation" role guard? | §6.2 | Claude Code §8 | Specify: role guards apply even for same-status transitions, OR explicitly exempt no-ops from guards. |
| A-2 | Incrementing absent `rework_count` is undefined | §3.3, §7.1 | Claude Code §9, Copilot §5 | Specify: treat absent as `0`, then increment to `1`. |
| A-3 | Acceptance criteria merge on unknown criterion text | §7.2 | Claude Code §10 | Specify: (a) append as new, (b) ignore, or (c) error. |
| A-4 | Empty `acceptance_criteria` array passes vacuously | §6.5 | Claude Code §13 | Require at least one criterion, OR document vacuous completion as intentional. |
| A-5 | PM blocker resolution mechanism unspecified | §8.1 | Claude Code §14 | Specify: PM calls `update_work_package_status(BLOCKED → READY)` which clears `blocked_by`. |
| A-6 | `override: true` claim has no authorization model | §6.4 | Copilot §7 | Specify: which roles may override, audit trail requirements. |
| A-7 | Multi-WP parallel processing within a single agent invocation | §8.1 | Claude Web §7 | Specify: one WP per invocation, or batch processing rules. |
| A-8 | Auto-unblock targets READY, losing prior IN_PROGRESS state | §9.2 | Claude Code §6 | Document as intentional or restore prior status. |

---

## IV. Future-Proofing — Not Blocking v1.0 but Worth Tracking

| # | Issue | Sources |
|---|-------|---------|
| F-1 | No schema versioning or ledger migration strategy | Claude Web §12 |
| F-2 | No general-purpose event/audit log beyond handoff notes | Claude Web §13 |
| F-3 | Stale pipeline threshold is global, not per-type | Claude Code §15 |
| F-4 | No retention/pruning policy for pipelines and artifacts | Copilot (medium) |
| F-5 | `auto_handoff_depth` on root index creates write contention | Copilot §4 |

---

## Consolidated Fix Priority

### Tier 1 — Must Fix Before Implementation

| Issue | Impact if Unfixed |
|-------|-------------------|
| **C-1** FAIL handoff stalls rework loop | Every pipeline failure requires human intervention; auto-handoff is broken |
| **C-2** Rework count semantics contradiction | Implementers will make inconsistent choices; metrics are unreliable |
| **C-3** Synthesis has no terminal mechanism | Project never truly completes; Synthesis loops infinitely |
| **C-4** No circular dependency detection | Permanent unrecoverable deadlock |
| **C-5** Reopen doesn't cascade-block dependents | Dependents proceed on invalidated assumptions |

### Tier 2 — Must Fix Before Production Use

| Issue | Impact if Unfixed |
|-------|-------------------|
| **D-1** Lock retry/timeout mismatch | Frequent spurious lock failures under any concurrency |
| **D-2** Local timestamps | Temporal checks produce wrong results across hosts/timezones |
| **D-3** No WP cancellation | Abandoned WPs block project completion |
| **D-4** No rework circuit breaker | Unbounded loops on persistent defects |
| **A-1–A-8** Ambiguities | Implementers must guess; implementations will diverge |

### Tier 3 — Should Fix Before Scale

| Issue | Impact if Unfixed |
|-------|-------------------|
| **D-5** WP ID cap at 999 | Hard limit on project complexity |
| **D-6** Docs FAIL routing | Rare edge case with manual workaround |
| **D-7** Self-heal mutates on read | Surprising behavior; race risk |
| **F-1–F-5** Future-proofing | Technical debt accumulation |

---

## Cross-Auditor Agreement Matrix

Shows which issues were independently identified by each auditor (● = found, ○ = tangentially mentioned).

| Issue | Claude Code | Gemini | Claude Web | Copilot |
|-------|:-----------:|:------:|:----------:|:-------:|
| C-1 FAIL handoff stalls | ● | ● | ● | ○ |
| C-2 Rework count contradiction | ● | | ● | ● |
| C-3 Synthesis terminal gap | ● | ● | ● | |
| C-4 Circular dependency deadlock | ● | | | |
| C-5 Reopen cascade gap | | ● | ● | |
| D-1 Lock timing mismatch | | ● | ○ | ● |
| D-2 Local timestamps | | | ● | ● |
| D-3 No WP cancellation | ● | ● | | |
| D-4 No rework circuit breaker | | | ● | |
| D-5 WP ID cap | ● | | ● | |
| D-6 Docs FAIL routing | ● | | ● | |
| D-7 Self-heal mutation | | | | ● |
