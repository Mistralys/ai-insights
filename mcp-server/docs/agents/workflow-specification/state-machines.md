# State Machines

> Part of the [Agent Workflow Specification](README.md).

---

## 5. Project Lifecycle

### 5.1 Initialization

```
Input: project_path, plan_file
Precondition: No ledger exists for this project

Steps:
  1. Derive slug from project_path (folder basename)
  2. Create root index with:
     - status = READY
     - total_work_packages = 0
     - pending_work_packages = 0
     - work_packages = []
     - project_comments = []
  3. Create project metadata file (.meta.json) alongside root index
  4. Return root index

Error: Reject if ledger already exists
```

### 5.2 Project Status Values

| Status | Meaning |
|--------|---------|
| `READY` | No WP is `IN_PROGRESS`; at least one WP is `READY` or no WPs exist yet. Also the initial status after project initialization. May be reached after work has started (e.g., via auto-unblock §15.4 or self-healing §17.2 rule 4b/6b). |
| `IN_PROGRESS` | At least one WP is being worked on, OR all WPs are terminal but synthesis has not yet been generated (see §17.2 rules 1b/1c/5b) |
| `COMPLETE` | All WPs terminal AND synthesis generated |
| `BLOCKED` | All non-terminal WPs are `BLOCKED` (equivalently: no WP is `IN_PROGRESS` or `READY`) |

### 5.3 Automatic Project Status Transitions

Project status updates are **implicit** — they happen as side effects of WP operations:

- Project transitions to `IN_PROGRESS` when first WP is claimed (`READY → IN_PROGRESS`) by an agent
- Project transitions to `BLOCKED` when a WP transitions to `BLOCKED` AND no other WP is `IN_PROGRESS` or `READY`
- Project transitions **out of** `BLOCKED` when:
  - A previously-blocked WP is unblocked (auto or manual) AND at least one WP is now `IN_PROGRESS` → project becomes `IN_PROGRESS`
  - A previously-blocked WP is unblocked AND at least one WP is `READY` (none `IN_PROGRESS`) → project becomes `READY`
  - All WPs reach terminal status → project follows the completion path below
- Project remains (or transitions to) `IN_PROGRESS` when all WPs reach terminal status but `synthesis_generated` is still `false` — this "awaiting synthesis" sub-state means no WP is actively being worked on, but the project cannot be `COMPLETE` until the Synthesis agent runs. See self-healing rules 1b/1c/5b in [§17.2](auxiliary-systems.md#172-healing-rules-applied-in-order--first-match-wins) for the formal conditions
- Project transitions to `COMPLETE` when synthesis is marked complete AND all WPs are terminal
- Project status is also governed by self-healing rules (see [§17](auxiliary-systems.md#17-self-healing))

---

## 6. Work Package State Machine

### 6.1 States

| State | Terminal? | Description |
|-------|-----------|-------------|
| `READY` | No | Available to be claimed |
| `IN_PROGRESS` | No | Being actively worked on |
| `BLOCKED` | No | Waiting on a dependency or external factor |
| `COMPLETE` | Normally | All criteria met, documentation done. May be reopened by PM or Documentation (see §6.2). |
| `CANCELLED` | Yes | Abandoned; satisfies dependencies like COMPLETE |

### 6.2 Transition Table

```
┌───────────────┬────────────────┬──────────────────────────────────────────────────┐
│ From          │ To             │ Conditions & Guards                              │
├───────────────┼────────────────┼──────────────────────────────────────────────────┤
│ READY         → IN_PROGRESS    │ All dependencies must be COMPLETE or CANCELLED   │
│ READY         → BLOCKED        │ Must provide blocked_by object                   │
│               │                │ Preserves assigned_to                            │
│               │                │ Any agent may invoke (see §6.5 design note)      │
│ READY         → CANCELLED      │ Agent must be "Project Manager"                  │
├───────────────┼────────────────┼──────────────────────────────────────────────────┤
│ IN_PROGRESS   → COMPLETE       │ All acceptance criteria met = true               │
│               │                │ Most recent `documentation` pipeline is PASS     │
│               │                │ Doc PASS must post-date most recent              │
│               │                │ `implementation` pipeline start (freshness check;│
│               │                │ passes vacuously if no implementation pipeline   │
│               │                │ exists — see §21.10)                             │
│               │                │ Agent must be "Documentation"                    │
│ IN_PROGRESS   → READY          │ No IN_PROGRESS pipelines on the WP              │
│               │                │ Agent must be "Project Manager" or current       │
│               │                │ assignee (wp.assigned_to)                        │
│               │                │ Clears assigned_to                               │
│ IN_PROGRESS   → BLOCKED        │ Must provide blocked_by object                   │
│               │                │ All IN_PROGRESS pipelines set to FAIL            │
│               │                │ (with auto_cancelled = true; see §21.27)         │
│               │                │ Preserves assigned_to                            │
│               │                │ Any agent may invoke (see §6.5 design note)      │
│ IN_PROGRESS   → CANCELLED      │ Agent must be "Project Manager"                  │
│               │                │ All IN_PROGRESS pipelines set to FAIL            │
│               │                │ (with auto_cancelled = true; see §21.27)         │
├───────────────┼────────────────┼──────────────────────────────────────────────────┤
│ BLOCKED       → IN_PROGRESS    │ Agent must be "Project Manager", current         │
│               │                │ assignee (wp.assigned_to), or system              │
│               │                │ Clears blocked_by field                          │
│ BLOCKED       → READY          │ System-only (auto-unblock path from §15.4)       │
│               │                │ Clears blocked_by field                          │
│ BLOCKED       → CANCELLED      │ Agent must be "Project Manager"                  │
├───────────────┼────────────────┼──────────────────────────────────────────────────┤
│ COMPLETE      → IN_PROGRESS    │ Agent must be "Project Manager" or               │
│               │                │ "Documentation"                                  │
│               │                │ Increments revision counter                      │
│               │                │ Resets rework_counts to absent (see §21.44)      │
│               │                │ Resets project synthesis_generated to false       │
│               │                │ Triggers cascade reblock of dependents           │
│ COMPLETE      → CANCELLED      │ Agent must be "Project Manager"                  │
│               │                │ No counter change (terminal → terminal)          │
│               │                │ No cascade reblock (CANCELLED satisfies deps)    │
├───────────────┼────────────────┼──────────────────────────────────────────────────┤
│ CANCELLED     → (none)         │ Terminal — no outward transitions                │
└───────────────┴────────────────┴──────────────────────────────────────────────────┘
```

Same-state transitions (e.g., READY → READY) are always valid (no-op) **except for transitions to guarded or terminal states**. Specifically:
- `CANCELLED → CANCELLED` is **not valid** — CANCELLED is strictly terminal with no outward transitions, including self-transitions (see [§21.32](edge-cases.md#2132-cancelled-self-transition-prohibition))
- `COMPLETE → COMPLETE` still requires the Documentation agent guard (agent identity check only — the full completion guards of acceptance criteria, documentation pipeline PASS, and freshness check are **not** re-evaluated for same-state no-ops)
- `BLOCKED → BLOCKED` still requires a `blocked_by` object; the new blocker **replaces** the existing one
- All other same-state transitions are pure no-ops that skip validation

> **Same-state behavioral asymmetry:** `BLOCKED → BLOCKED` and `COMPLETE → COMPLETE` are both listed as same-state transitions, but they differ fundamentally in semantics. `BLOCKED → BLOCKED` is a **substantive operation** — it replaces the `blocked_by` payload, requires agent guards (PM or assignee), and enforces blocker-type transition rules (see §6.2 replacement rule). `COMPLETE → COMPLETE` is a **pure no-op** — only the agent identity is checked; no data is modified. The asymmetry arises because BLOCKED carries mutable metadata (`blocked_by`) that same-state transitions can validly update, whereas COMPLETE has no analogous mutable field that a same-state call would change.

> **BLOCKED → BLOCKED agent guard:** The `BLOCKED → BLOCKED` same-state transition requires the agent to be the **Project Manager** or the **current assignee** (`wp.assigned_to`). This prevents arbitrary agents from modifying blockers on WPs they do not own, consistent with the agent guard philosophy applied to other transitions.
>
> **BLOCKED → BLOCKED replacement rule:** A `dependency` blocker **cannot** be overwritten with a non-dependency type (`decision`, `external`, `technical`) **unless the agent is the Project Manager**. This prevents auto-unblock logic (§15.4) from silently skipping a WP that was originally blocked by a dependency. The PM exception allows recording non-dependency blockers discovered after the initial dependency block; the PM accepts responsibility for managing the auto-unblock implications (the `dependency` auto-unblock will no longer fire for this WP). All other blocker-type changes are allowed (e.g., `technical` → `decision`, `external` → `dependency`).
>
> **⚠ Permission asymmetry — non-dependency → dependency re-classification:** The replacement rule is asymmetric: overwriting `dependency` with a non-dependency type requires PM, but overwriting a non-dependency type with `dependency` is allowed by any authorized agent (PM or assignee). This means an assignee can make a WP eligible for auto-unblock (§15.4) by re-classifying a PM-managed `technical` or `decision` blocker as `dependency`. If the referenced dependency has already reached terminal status, the re-classification does not trigger auto-unblock (see [§21.17](edge-cases.md#2117-blocked--blocked-blocker-replacement) for the latency issue), but a future dependency completion would auto-unblock the WP — potentially bypassing the PM's intended manual-resolution workflow. Implementations that require stricter control MAY extend the replacement rule to also require PM for non-dependency → `dependency` re-classification.

### 6.3 State Diagram

```
                     ┌─────────┐
             ┌──────►│  READY  │◄────────────────────────┐
             │       └─┬──┬──┬─┘                          │
             │         │  │  │                            │ (auto-unblock §15.4)
 (unclaim)   │         │  │  └──► BLOCKED ────────────────┤
             │         │  │         ├──► IN_PROGRESS      │
             │         │  │         │    (PM/assignee/    │
             │         │  │         │     system)         │
             │         │  │         └──► CANCELLED (PM)   │
             │         │  └────────► CANCELLED (PM only)  │
             │         ▼                                   │
        ┌────┴─────────────┐                               │
        │   IN_PROGRESS    ├──► BLOCKED ───────────────────┘
        │                  ├──► CANCELLED (PM only)
        └────────┬─────────┘
                 ▼
        ┌────────────────┐
        │    COMPLETE     ├──► IN_PROGRESS (reopen: PM or Doc)
        │  (normally      ├──► CANCELLED (PM only; no cascade)
        │   terminal)     │
        └─────────────────┘

        CANCELLED: strictly terminal — no outward transitions
                   (including self-transitions).
```

> **Complete transition list** (all transitions from §6.2, for verification):
> - **READY →** IN_PROGRESS (claim), BLOCKED (any agent; requires blocker), CANCELLED (PM only)
> - **IN_PROGRESS →** COMPLETE (Doc only), READY (unclaim), BLOCKED (any agent; requires blocker; auto-cancels pipelines), CANCELLED (PM only)
> - **BLOCKED →** IN_PROGRESS (PM/assignee/system), READY (auto-unblock only), CANCELLED (PM only)
> - **COMPLETE →** IN_PROGRESS (reopen: PM or Doc), CANCELLED (PM only; no cascade)
> - **CANCELLED →** *(none; strictly terminal)*

### 6.4 Counter Updates on Transitions

| Transition | `pending_work_packages` Change |
|------------|-------------------------------|
| Non-terminal → COMPLETE | Decrement by 1 |
| Non-terminal → CANCELLED | Decrement by 1 |
| COMPLETE → IN_PROGRESS | Increment by 1 |
| COMPLETE → COMPLETE | No change (same-state no-op; §6.2 preempts counter logic) |
| COMPLETE → CANCELLED | No change (terminal → terminal) |
| CANCELLED → CANCELLED | N/A — transition rejected (§21.32) |
| All other transitions | No change |

### 6.5 Agent Guards

| Transition | Allowed Agents |
|------------|---------------|
| READY → IN_PROGRESS (claim) | Pipeline-owning agents (Developer, QA, Security Auditor, Reviewer, Release Engineer, Documentation), "Project Manager" (see [§10.1](operations.md#101-algorithm), [§21.49](edge-cases.md#2149-agent-role-guard-on-work-package-claiming)) |
| → COMPLETE | "Documentation" (or "Documentation Agent"), or "Project Manager" for same-state `COMPLETE → COMPLETE` only — for same-state `COMPLETE → COMPLETE`, only the agent identity check is enforced; the full completion guards (acceptance criteria, documentation pipeline PASS, freshness check) are **not** re-evaluated (see §6.2 same-state transition rules). The PM is permitted for same-state COMPLETE because it is a pure no-op (no data modification); the PM is **not** permitted for `IN_PROGRESS → COMPLETE` (that remains Documentation-only). |
| → CANCELLED | "Project Manager" (or "Project Manager Agent") |
| BLOCKED → IN_PROGRESS | "Project Manager" (or "Project Manager Agent"), current assignee, system (auto-repair) |
| BLOCKED → READY | System only (auto-unblock via §15.4 — no manual agent guard) |
| BLOCKED → BLOCKED | "Project Manager" (or "Project Manager Agent"), current assignee |
| IN_PROGRESS → READY | "Project Manager" (or "Project Manager Agent"), current assignee |
| COMPLETE → IN_PROGRESS | "Project Manager" (or "Project Manager Agent"), "Documentation" (or "Documentation Agent") |

> **Design note — no agent guard on → BLOCKED transitions:** The `READY → BLOCKED` and `IN_PROGRESS → BLOCKED` transitions intentionally have **no agent role restriction**. Any of the nine agent roles may block a WP by providing a `blocked_by` object. This is a deliberate design choice: any agent may discover a blocker during its work (e.g., a Developer encountering an external dependency, a QA agent discovering a technical issue). Restricting blocking to specific roles would force agents to complete their current pipeline with FAIL and add handoff notes requesting the PM to block — adding latency and complexity without a safety benefit. The `blocked_by` object (§21.11) is required for all → BLOCKED transitions, providing an audit trail of who blocked and why. The `BLOCKED → BLOCKED` replacement rule (§6.2) and `BLOCKED → IN_PROGRESS` agent guard (§6.5) ensure that *resolving* or *modifying* blockers remains restricted to authorized agents (PM/assignee/system).

> Implementations should accept both short-form ("Documentation") and long-form ("Documentation Agent") variants.
>
> **"System" agent identity:** Several agent guard entries reference "system" as an allowed agent (e.g., `BLOCKED → IN_PROGRESS`). "System" is not one of the nine canonical agent roles (§4) — it represents automated operations performed by the implementation itself, not by an external AI agent. System-initiated transitions occur in two contexts: (1) `propagateDependencyUnblock` (§15.4), which transitions WPs from `BLOCKED → READY`; and (2) implementation-specific auto-repair logic (e.g., `REPAIR_ORPHAN_BLOCKED` in §21.20), which may transition WPs from `BLOCKED → IN_PROGRESS`. Implementations should use a reserved agent identifier (e.g., `"system"`) for audit trail purposes when performing these automated transitions, and MUST NOT allow external callers to claim the "system" identity to bypass agent guards.

---

## 7. Pipeline State Machine

### 7.1 States

| State | Terminal? | Description |
|-------|-----------|-------------|
| `IN_PROGRESS` | No | Pipeline is active |
| `PASS` | Yes | Pipeline completed successfully |
| `FAIL` | Yes | Pipeline failed; rework needed |

### 7.2 Transitions

```
IN_PROGRESS → PASS    (pipeline completed successfully)
IN_PROGRESS → FAIL    (pipeline failed or was cancelled)
```

There is no READY state for pipelines. They are created directly as IN_PROGRESS.

PASS and FAIL are terminal — no further transitions.

### 7.3 Cancellation

A pipeline can be cancelled by setting its status to FAIL with a reason string as the summary. This is the mechanism for closing stale pipelines.

When a pipeline is cancelled by system automation (cascade reblock via [§15.5](dependencies-and-rework.md#155-cascade-reblocking-propagatedependencyreblock) or manual IN_PROGRESS → BLOCKED transition), the `auto_cancelled` flag is set to `true`. This flag excludes the pipeline from rework detection and circuit breaker calculations (see [§21.27](edge-cases.md#2127-auto-cancelled-pipelines)).
