# Workflow Specification Audit — Findings & Fix Recommendations

**Date:** 2026-02-25
**Audited Document:** `mcp-server/docs/agents/workflow-specification.md` (v1.0.0)
**Purpose:** Catalog logic fallacies, unhandled workflow paths, and contradictions for developer remediation.

---

## Severity Legend

| Severity | Meaning |
|----------|---------|
| **CRITICAL** | Breaks core workflow; agents will deadlock or produce incorrect behavior |
| **HIGH** | Unhandled path that can occur in realistic projects |
| **MEDIUM** | Contradictory or ambiguous text that will confuse implementors |
| **LOW** | Minor inconsistency or missing clarification |

---

## 1. CRITICAL — State Machine Missing BLOCKED → READY Transition

**Location:** §4.1 (Legal Status Transitions table + diagram)

**Problem:** The transition table only lists `BLOCKED → IN_PROGRESS`, but §6 (Dependency Propagation) explicitly transitions WPs from `BLOCKED → READY`, and §14.12 reinforces this: *"Dependency Auto-Unblocking Transitions to READY, Not IN_PROGRESS."* The state machine diagram also omits this arrow.

**Impact:** An implementation that strictly follows the §4.1 table will reject auto-unblocking as an illegal transition.

**Fix:** Add a row to the §4.1 transition table:

| From | To | Conditions | Side Effects |
|------|----|------------|--------------|
| `BLOCKED` | `READY` | All dependencies COMPLETE (auto-unblock) | Clear `blocked_by` |

Update the ASCII diagram to include the `BLOCKED → READY` arrow.

---

## 2. CRITICAL — Downstream Rework Cannot Re-trigger QA/Review

**Location:** §7.3 step 4 (Developer next-action), §7.4 (QA next-action), §19.1–19.2 (Rework sequences)

**Problem:** When a Reviewer rejects a WP (code-review FAIL), the spec says (§19.2):

> *"Work re-enters the pipeline chain: implementation → qa → code-review"*

But the next-action logic **cannot produce this behavior**:

1. Reviewer completes `code-review` with `FAIL`
2. Developer gets `REWORK` (§7.3 step 4) — correct
3. Developer starts + completes a new `implementation` pipeline with `PASS` — correct
4. QA's next-action (§7.4):
   - Step 2 ("new work"): requires "no `qa` pipeline" — but the **old PASS qa** still exists → **no match**
   - Step 3 ("rework"): requires most recent `qa` is `FAIL` — it's `PASS` → **no match**
   - Result: **WAIT** — QA is never re-engaged. Workflow deadlocks.

The same gap affects Documentation re-entry after code-review rejection.

**Root cause:** The next-action logic checks only whether a pipeline *exists* and its *most recent status*, but has no temporal awareness of whether a new upstream pipeline was added **after** the last downstream pass.

**Fix options (choose one):**

- **(A) Temporal comparison:** Change "new work" checks to: *"no `qa` pipeline started **after** the most recent PASS `implementation` pipeline."* This is the minimal-invasive fix.
- **(B) Pipeline supersession:** When a new `implementation` pipeline starts, mark all downstream PASS pipelines as `SUPERSEDED` (new status). Downstream agents then see "no valid pipeline" and re-engage.
- **(C) Explicit invalidation on rework:** When the Developer starts a new implementation pipeline after a downstream FAIL, explicitly clear or mark the downstream pipelines. This requires a new side effect in §5.2.

**Recommendation:** Option (A) — temporal comparison — is the simplest and least disruptive to the existing schema.

---

## 3. MEDIUM — Self-Contradictory rework_count Narrative in §19.1

**Location:** §19.1 (QA Fails a Work Package), paragraph about Developer's new implementation pipeline

**Problem:** The text reads:

> *"rework_count incremented (previous implementation was PASS, so NOT incremented by implementation restart — but the qa FAIL is a new impl pipeline on a type that had no previous FAIL, so rework_count increments only if there was a previous FAIL implementation pipeline)"*

The first clause says "incremented," then immediately explains why it should NOT be. Per §5.2/§5.6, `rework_count` increments only when starting a pipeline of a type that has a previous FAIL. Since the previous implementation was PASS, it should **not** increment here.

**Fix:** Rewrite to:

> *"rework_count is **not** incremented for the new implementation pipeline (the previous implementation was PASS, not FAIL). However, when QA later starts a new qa pipeline, rework_count **is** incremented because the previous qa pipeline was FAIL."*

---

## 4. HIGH — No Role Guard on Pipeline Start

**Location:** §5.2 (Starting a Pipeline)

**Problem:** The preconditions for `start_pipeline` verify:
1. WP status is `IN_PROGRESS`
2. No duplicate `IN_PROGRESS` pipeline of the same type
3. Pipeline prerequisite is satisfied (§5.1)

But there is **no check that the requesting agent matches the pipeline's owner role** (§2.3 table). Nothing prevents the Developer from starting a `qa` pipeline, or QA from starting a `documentation` pipeline.

**Impact:** Agents that misuse the API can corrupt the pipeline chain. Even well-behaved agents may accidentally start wrong pipeline types without feedback.

**Fix:** Add a precondition to §5.2:

> **4. Agent role check:** The requesting agent's role MUST match the pipeline type's owner (per §2.3 table). If mismatched, reject with: *"Pipeline type '{type}' can only be started by the {owner} agent."*

If intentionally permissive (e.g., for PM override scenarios), document this explicitly.

---

## 5. HIGH — No Agent Guard on COMPLETE → IN_PROGRESS

**Location:** §4.2.4

**Problem:** The `IN_PROGRESS → COMPLETE` transition is guarded to Documentation-only (§4.2.2), but the reverse (`COMPLETE → IN_PROGRESS`) has **no role restriction**. Any agent can reopen a completed WP.

**Impact:** A QA or Developer agent could inadvertently reopen completed WPs, disrupting dependency chains and counter accuracy.

**Fix:** Either:
- **(A)** Add a role guard: only PM and Documentation may transition COMPLETE → IN_PROGRESS.
- **(B)** Explicitly state this is intentional and document which scenarios warrant it.

---

## 6. HIGH — Planner Handoff Status Undefined

**Location:** §8 (Handoff Status system)

**Problem:** Handoff status logic covers PM through Synthesis but not Planner. If `get_handoff_status` is called with role `"Planner"`, the behavior is unspecified. §15 (Batch Next Actions) explicitly states *"Non-applicable roles (Planner, PM, Synthesis) return an empty array"* but §8 has no equivalent fallback.

**Fix:** Add a fallback clause in §8:

> For the Planner role, `get_handoff_status` returns `READY_FOR_DEVELOPER` if WPs exist, or a descriptive error/WAIT if not. Alternatively, reject with: *"Handoff status is not applicable for the Planner role."*

---

## 7. HIGH — New-Work Suggestions Don't Exclude BLOCKED WPs for QA/Reviewer/Documentation

**Location:** §7.4 step 2 (QA), §7.5 step 2 (Reviewer), §7.6 step 3 (Documentation)

**Problem:** The "new work" checks (e.g., "WP has PASS implementation, no qa pipeline → RUN_QA") contain **no WP status guard**. A WP that is `BLOCKED` (e.g., blocked by PM after implementation but before QA) with a PASS implementation would be surfaced as new work.

§14.8 explicitly excludes BLOCKED WPs from **rework** suggestions but the same exclusion is missing from **new work** suggestions.

**Fix:** Add to each "new work" step: *"AND WP status is NOT `BLOCKED`"*.

---

## 8. HIGH — Auto-Handoff Depth Permanently Stalls Mid-Project

**Location:** §9.3 (Auto-Handoff Depth Counter)

**Problem:** The depth counter resets **only** when the project reaches `COMPLETE`. On a large project with many WPs and frequent handoffs, the counter can hit the maximum (default: 10) mid-project. The chain terminates silently with no recovery mechanism.

Example: A project with 5 WPs. Each WP pass through Developer → QA → Reviewer → Documentation produces 3–4 handoffs. By WP-003, the counter hits 10 and all subsequent auto-handoffs are silently dropped.

**Impact:** Auto-handoff becomes effectively broken for any non-trivial project.

**Fix options:**
- **(A)** Reset counter per-WP completion (not just project completion).
- **(B)** Increase default significantly (e.g., 50 or 100).
- **(C)** Reset counter when a new WP is claimed (new work cycle begins).
- **(D)** Make it per-WP rather than per-project.
- **(E)** Add a manual reset tool for PM.

**Recommendation:** Option (A) or (D) — per-WP tracking is most aligned with the workflow.

---

## 9. MEDIUM — Mixed BLOCKED + COMPLETE State Falls Through Handoff Logic

**Location:** §8.1 (Global Prechecks)

**Problem:** The global precheck says *"All BLOCKED (no READY/IN_PROGRESS, no COMPLETE)"* → route to PM. But consider: some WPs `BLOCKED`, some `COMPLETE`, zero `READY` or `IN_PROGRESS`.

This falls through the global precheck (not "all BLOCKED" because COMPLETE exists) and enters agent-specific logic where:
- PM sees BLOCKED WPs → `RESOLVE_BLOCKERS` — correct
- Developer/QA/Reviewer/Doc may all return `WAIT`

The handoff status doesn't route to PM (since it's not "all BLOCKED"), creating a state where only PM has actionable work but the handoff system doesn't direct traffic to PM.

**Fix:** Broaden the global precheck:

> *"If any WP is BLOCKED **and** no WP is READY or IN_PROGRESS"* → return `BLOCKED` (route to PM).

---

## 10. LOW — rework_count NaN Risk on First Rework

**Location:** §5.6, §16.3

**Problem:** §5.6 states *"`rework_count` is `undefined`/absent until the first rework. It is never initialized to 0."* §16.3 lists `rework_count?: number` as optional. Code that does `rework_count + 1` on first rework would produce `NaN` unless implementations guard for this.

**Fix:** Add an explicit note: *"Implementations MUST treat absent `rework_count` as 0 for arithmetic purposes: `(rework_count ?? 0) + 1`."*

---

## 11. LOW — Self-Healing Doesn't Cover READY or BLOCKED Project Status

**Location:** §10.2

**Problem:** Self-healing covers:
- `IN_PROGRESS` → `COMPLETE` (when pending = 0)
- `COMPLETE` → `IN_PROGRESS` (when pending > 0)

But not:
- `READY` project status when WPs are already `IN_PROGRESS` (should be `IN_PROGRESS`)
- `BLOCKED` project status when no WPs are actually blocked (should heal to `IN_PROGRESS` or `READY`)

**Fix:** Add healing rules for READY and BLOCKED project statuses.

---

## 12. LOW — Contradictory Parenthetical in §8.6

**Location:** §8.6 (Reviewer Handoff)

**Problem:** Text says: *"Dependency-blocked unreviewed WPs → `READY_FOR_DOCUMENTATION` (skip back to Developer)"*

The parenthetical says "skip back to Developer" but the arrow points **forward** to Documentation. These contradict each other.

**Fix:** Remove the incorrect parenthetical, or clarify that the forward-progression to Documentation is intentional (skipping *past* the unreviewed blocked WPs, not skipping *back*).

---

## 13. LOW — Ambiguous Tool Ordering: next-action vs. handoff-status for Synthesis

**Location:** §7.1, §7.7, §8.8

**Problem:**
- §7.1: When all WPs are COMPLETE, Synthesis gets `GENERATE_SYNTHESIS` from next-action.
- §8.8: Synthesis handoff "always returns COMPLETE."

If Synthesis calls `get_handoff_status` before `get_next_action`, it receives `COMPLETE` (done!) and may never call `get_next_action` to discover `GENERATE_SYNTHESIS`.

**Fix:** Either:
- **(A)** Make §8.8 conditional: Synthesis returns `COMPLETE` only **after** the synthesis report is generated.
- **(B)** Add explicit guidance that Synthesis should call `get_next_action` first, then `get_handoff_status` after generating the report.
- **(C)** Have the handoff status for Synthesis return `IN_PROGRESS` when synthesis work is pending, and `COMPLETE` only when the report exists.

---

## Summary — Prioritized Fix Order

| # | Severity | Finding | Effort |
|---|----------|---------|--------|
| 2 | CRITICAL | Downstream rework can't re-trigger QA | Medium — logic change in next-action |
| 1 | CRITICAL | Missing BLOCKED → READY in state machine | Low — documentation + validation update |
| 4 | HIGH | No role guard on pipeline start | Low — add precondition check |
| 5 | HIGH | No agent guard on COMPLETE → IN_PROGRESS | Low — add role check or document intent |
| 7 | HIGH | New-work suggestions don't exclude BLOCKED WPs | Low — add status guard |
| 8 | HIGH | Auto-handoff depth stalls mid-project | Medium — counter reset strategy |
| 6 | HIGH | Planner handoff status undefined | Low — add fallback clause |
| 9 | MEDIUM | Mixed BLOCKED + COMPLETE falls through | Low — broaden precheck |
| 3 | MEDIUM | Self-contradictory rework_count narrative | Low — rewrite paragraph |
| 12 | LOW | Contradictory parenthetical in §8.6 | Trivial — text fix |
| 13 | LOW | Ambiguous Synthesis tool ordering | Low — add guidance |
| 11 | LOW | Self-healing gaps for READY/BLOCKED project status | Low — add healing rules |
| 10 | LOW | rework_count NaN risk | Trivial — add implementation note |
