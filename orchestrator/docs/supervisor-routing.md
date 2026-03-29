# Supervisor Routing Model

> **Parent:** [orchestrator/README.md](../README.md) · **Source of truth:** `orchestrator/src/supervisor.py`

The supervisor is a pure-Python deterministic router — no LLM calls are made here. It delegates all routing decisions to the MCP server via **`ledger_get_next_action`** and returns a LangGraph `Command` routing the graph to the next stage.

`ledger_get_project_status` is called for observability context. `ledger_list_work_packages` is queried to detect two boundary conditions (empty project and all-terminal) before entering the per-role dispatch loop.

---

## Special Exits (checked first, in order)

```
supervisor_node
  ├─ iteration > max_iterations                      → __end__    (safety limit; level=WARNING)
  ├─ dry_run + get_project_status error               → __end__    (dry_run_no_ledger; level=INFO)
  ├─ dry_run + no WPs + iteration > 1                 → __end__    (dry_run_complete; level=INFO)
  ├─ No WPs in ledger                                 → pm         (create work packages)
  └─ All WPs terminal (COMPLETE or CANCELLED)         → synthesis  (final report)
```

> **State clearing on synthesis routes:** Both synthesis routing paths (all-WPs-terminal and all-roles-WAIT) explicitly set `"current_wp_id": ""` in their `Command` update dicts. This ensures the `restrict_to_wp` tool wrapper does not activate in the synthesis stage, which is project-scoped and must not be constrained to a single WP. A stale `current_wp_id` (left over from the preceding stage) would otherwise cause every MCP tool call in synthesis to trigger cross-WP violations.

### Dry-Run Mode

When `make_supervisor_node(mcp_tools, dry_run=True)` is used (set automatically by `--dry-run`), the supervisor tolerates missing ledger state:

- **Missing ledger errors** are logged at INFO level (`dry_run_no_ledger`) instead of WARNING/ERROR (`mcp_error`). No entries are added to the `errors` list.
- **First iteration with no WPs**: routes to PM (validates the routing path).
- **Second iteration with no WPs**: terminates cleanly to `__end__` (`dry_run_complete`) since PM stubs cannot create a ledger.
- **Existing ledger**: routing proceeds normally regardless of `dry_run`.

---

## Standard Routing (per role — first dispatchable action wins)

The supervisor calls `ledger_get_next_action` for each agent role in priority order
(`Project Manager` → `Developer` → `QA` → `Security Auditor` → `Reviewer` → `Release Engineer` → `Documentation`).
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
    "Project Manager"   → pm               (_DISPATCH_ACTIONS includes REPAIR_ORPHAN_BLOCKED,
    "Developer"         → developer         UNBLOCK_WP, REVIEW_REWORK_LIMIT, REVIEW_STALE,
    "QA"                → qa                REVIEW_ABANDONED, IMPLEMENT, REWORK, CLAIM_WP,
    "Security Auditor"  → security_auditor  CONTINUE_PIPELINE, RESUME_OR_CANCEL, RUN_QA,
    "Reviewer"          → reviewer          RUN_SECURITY_AUDIT, RUN_REVIEW,
    "Release Engineer"  → release_engineer  RUN_RELEASE_ENGINEERING, WRITE_DOCS,
    "Documentation"     → docs              FINALIZE_WP, UPDATE_CRITERIA)

All roles returned WAIT/skip          → synthesis
```

> **State clearing on synthesis fall-through:** Like the all-WPs-terminal path, this path also sets `"current_wp_id": ""` in the `Command` update dict to prevent the `restrict_to_wp` guard from activating in synthesis.

> **Test coverage gap (known):** The existing `test_supervisor.py` synthesis routing tests assert `goto == "synthesis"` but do not assert `current_wp_id == ""` in the Command update dict. Dedicated assertions verifying both synthesis paths clear `current_wp_id` (including with a stale non-empty value in input state) are missing and should be added in a follow-up task.

> `_SKIP_ACTIONS`, `_DISPATCH_ACTIONS`, and `_ROLE_STAGE_MAP` in
> `orchestrator/src/supervisor.py` are the source of truth for the action-to-stage
> mapping. `_ROLE_STAGE_MAP` and `_ROLES` are now derived from the manifest-derived
> `PIPELINE_ROLE_NAMES` constant in `config.py`. Adding a new action from the MCP
> server only requires updating `_DISPATCH_ACTIONS` — no other routing logic changes
> are needed.

---

## Circuit-Breaker

The `consecutive_failures` field in `WorkflowState` tracks per-WP failure counts. Each supervisor pass:
- **Increments** the counter for the previous WP if `stage_success` is `False`.
- **Resets** the counter when `stage_success` is `True`.

A WP that accumulates **≥ 3 consecutive failures** is skipped for the remainder of the run (its `ledger_get_next_action` dispatch is bypassed). Skipped WPs do not terminate the run — the supervisor continues checking the remaining roles. Only when all roles return `WAIT` or are circuit-broken does the supervisor fall through to `synthesis`.
