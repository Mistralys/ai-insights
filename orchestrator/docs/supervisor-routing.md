# Supervisor Routing Model

> **Parent:** [orchestrator/README.md](../README.md) · **Source of truth:** `orchestrator/src/supervisor.py`

The supervisor is a pure-Python deterministic router — no LLM calls are made here. It delegates all routing decisions to the MCP server via **`ledger_get_next_action`** and returns a LangGraph `Command` routing the graph to the next stage.

`ledger_get_project_status` is called for observability context. `ledger_list_work_packages` is queried to detect two boundary conditions (empty project and all-terminal) before entering the per-role dispatch loop.

---

## Special Exits (checked first, in order)

```
supervisor_node
  ├─ iteration > max_iterations                      → __end__    (safety limit; level=WARNING)
  ├─ No WPs in ledger                                 → pm         (create work packages)
  └─ All WPs terminal (COMPLETE or CANCELLED)         → synthesis  (final report)
```

---

## Standard Routing (per role — first dispatchable action wins)

The supervisor calls `ledger_get_next_action` for each agent role in priority order
(`Project Manager` → `Developer` → `QA` → `Reviewer` → `Documentation`).
The **role** determines the destination; the **action** determines dispatch vs. skip:

```
For each role in priority order:
  action ∈ _SKIP_ACTIONS            → skip this role
    (_SKIP_ACTIONS includes WAIT, WAIT_FOR_REWORK, WAIT_FOR_DOWNSTREAM,
     WAIT_FOR_UPSTREAM_REWORK_LIMIT, BLOCK_FOR_REWORK_LIMIT)

  action not in _DISPATCH_ACTIONS    → treat as WAIT (forward-compatibility guard)

  action ∈ _DISPATCH_ACTIONS and circuit-breaker (≥ 3 consecutive failures)
                                     → skip WP, record WARNING entry

  action ∈ _DISPATCH_ACTIONS         → dispatch to role's stage:
    "Project Manager"  → pm          (_DISPATCH_ACTIONS includes REPAIR_ORPHAN_BLOCKED,
    "Developer"        → developer    UNBLOCK_WP, REVIEW_REWORK_LIMIT, REVIEW_STALE,
    "QA"               → qa           REVIEW_ABANDONED, IMPLEMENT, REWORK, CLAIM_WP,
    "Reviewer"         → reviewer     CONTINUE_PIPELINE, RESUME_OR_CANCEL, RUN_QA,
    "Documentation"    → docs         RUN_REVIEW, WRITE_DOCS, FINALIZE_WP,
                                      UPDATE_CRITERIA)

All roles returned WAIT/skip          → synthesis
```

> `_SKIP_ACTIONS`, `_DISPATCH_ACTIONS`, and `_ROLE_STAGE_MAP` in
> `orchestrator/src/supervisor.py` are the source of truth for the action-to-stage
> mapping. Adding a new action from the MCP server only requires updating those
> constants — no other routing logic changes are needed.

---

## Circuit-Breaker

The `consecutive_failures` field in `WorkflowState` tracks per-WP failure counts. Each supervisor pass:
- **Increments** the counter for the previous WP if `stage_success` is `False`.
- **Resets** the counter when `stage_success` is `True`.

A WP that accumulates **≥ 3 consecutive failures** is skipped for the remainder of the run (its `ledger_get_next_action` dispatch is bypassed). Skipped WPs do not terminate the run — the supervisor continues checking the remaining roles. Only when all roles return `WAIT` or are circuit-broken does the supervisor fall through to `synthesis`.
