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
| `READY` | Project initialized, no work started |
| `IN_PROGRESS` | At least one WP is being worked on |
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
│ READY         → CANCELLED      │ Agent must be "Project Manager"                  │
├───────────────┼────────────────┼──────────────────────────────────────────────────┤
│ IN_PROGRESS   → COMPLETE       │ All acceptance criteria met = true               │
│               │                │ Most recent `documentation` pipeline is PASS     │
│               │                │ Doc PASS must post-date most recent              │
│               │                │ `implementation` pipeline start (freshness check)│
│               │                │ Agent must be "Documentation"                    │
│ IN_PROGRESS   → READY          │ No IN_PROGRESS pipelines on the WP              │
│               │                │ Agent must be "Project Manager" or current       │
│               │                │ assignee (wp.assigned_to)                        │
│               │                │ Clears assigned_to                               │
│ IN_PROGRESS   → BLOCKED        │ Must provide blocked_by object                   │
│               │                │ All IN_PROGRESS pipelines set to FAIL            │
│               │                │ (with auto_cancelled = true; see §21.27)         │
│ IN_PROGRESS   → CANCELLED      │ Agent must be "Project Manager"                  │
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

> **BLOCKED → BLOCKED replacement rule:** A `dependency` blocker **cannot** be overwritten with a non-dependency type (`decision`, `external`, `technical`) **unless the agent is the Project Manager**. This prevents auto-unblock logic (§15.4) from silently skipping a WP that was originally blocked by a dependency. The PM exception allows recording non-dependency blockers discovered after the initial dependency block; the PM accepts responsibility for managing the auto-unblock implications (the `dependency` auto-unblock will no longer fire for this WP). All other blocker-type changes are allowed (e.g., `technical` → `decision`, `external` → `dependency`).

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
> - **READY →** IN_PROGRESS (claim), BLOCKED, CANCELLED (PM only)
> - **IN_PROGRESS →** COMPLETE (Doc only), READY (unclaim), BLOCKED, CANCELLED (PM only)
> - **BLOCKED →** IN_PROGRESS (PM/assignee/system), READY (auto-unblock only), CANCELLED (PM only)
> - **COMPLETE →** IN_PROGRESS (reopen: PM or Doc), CANCELLED (PM only; no cascade)
> - **CANCELLED →** *(none; strictly terminal)*

### 6.4 Counter Updates on Transitions

| Transition | `pending_work_packages` Change |
|------------|-------------------------------|
| Non-terminal → COMPLETE | Decrement by 1 |
| Non-terminal → CANCELLED | Decrement by 1 |
| COMPLETE → IN_PROGRESS | Increment by 1 |
| COMPLETE → CANCELLED | No change (terminal → terminal) |
| All other transitions | No change |

### 6.5 Agent Guards

| Transition | Allowed Agents |
|------------|---------------|
| → COMPLETE | "Documentation" (or "Documentation Agent") |
| → CANCELLED | "Project Manager" (or "Project Manager Agent") |
| BLOCKED → IN_PROGRESS | "Project Manager" (or "Project Manager Agent"), current assignee, system (auto-repair) |
| BLOCKED → READY | System only (auto-unblock via §15.4 — no manual agent guard) |
| IN_PROGRESS → READY | "Project Manager" (or "Project Manager Agent"), current assignee |
| COMPLETE → IN_PROGRESS | "Project Manager" (or "Project Manager Agent"), "Documentation" (or "Documentation Agent") |

> Implementations should accept both short-form ("Documentation") and long-form ("Documentation Agent") variants.

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
