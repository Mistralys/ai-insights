# Design Decisions & Rejected Alternatives

> **Scope:** Architectural choices that were considered and rejected, and IDE/orchestrator
> divergences that a reader might otherwise mistake for bugs. These are not conventions to
> follow — they explain why the orchestrator does *not* do something.
>
> Rules to follow live in [constraints.md](constraints.md).

## Contents

- [Rejected: User-Turn Prompt WP-Scoping](#rejected-user-turn-prompt-wp-scoping)
- [Not Adopted: Cross-WP Dispatch (`findNextReadyDispatch`)](#not-adopted-cross-wp-dispatch-findnextreadydispatch)

---

## Rejected: User-Turn Prompt WP-Scoping

**Decision:** Do not add `wp_id` template variables or explicit WP-scope instructions to stage prompts with the intent of preventing cross-WP escape. Do not emit "you are scoped to WP-XXX" strings in user-turn prompts or persona system prompts for this purpose.

**Why it was rejected:** Both the supervisor and the implementing agent use the ledger to determine the current work package — they are always in sync. Prior experience with WP-scoping in prompts created agent confusion without providing meaningful safety. The programmatic post-completion guard in `nodes/__init__.py` is the sole authoritative mechanism for preventing cross-WP escape (see the *Post-Completion Guard* constraint). Adding prompt-based scoping alongside it does not improve safety; it introduces redundant, fragile instructions that the LLM may misinterpret.

**Rejected approach:**
```python
# ❌ REJECTED — prompt-based WP scoping to prevent cross-WP escape
def _build_developer_prompt(state: WorkflowState) -> str:
    wp_id = state.get("current_wp_id", "")
    return render_prompt(_TEMPLATE, {
        "project_path": state["project_path"],
        "wp_id": wp_id,
        "scope_warning": f"You are ONLY permitted to work on {wp_id}.",  # ← rejected
    })
```

**Adopted approach:**
```python
# ✅ ADOPTED — runtime context only; scope enforcement is programmatic
def _build_developer_prompt(state: WorkflowState) -> str:
    wp_id = state.get("current_wp_id", "")
    return render_prompt(_TEMPLATE, {
        "project_path": state["project_path"],
        "wp_id": wp_id,
    })
```

**Note:** `wp_id` itself remains in the template context as runtime information. What was rejected is the *scope-warning instruction*, not the variable.

---

## Not Adopted: Cross-WP Dispatch (`findNextReadyDispatch`)

**Decision:** The `findNextReadyDispatch()` mechanism in `mcp-server/src/tools/workflow-handoff.ts` is a best-effort, IDE-only optimization. The orchestrator does not implement an equivalent.

**How it works in the IDE:** It is called by the five non-PM handoff functions (QA, Security Auditor, Reviewer, Release Engineer, Documentation) immediately before their final `WAIT` return. When a READY, non-dependency-blocked WP exists whose first active pipeline stage maps to a deterministic agent, `findNextReadyDispatch` returns a routing signal (e.g., `READY_FOR_DEVELOPER`) instead of `WAIT`, preventing the IDE from stalling between handoffs.

**Why the orchestrator does not need it:** The supervisor polling loop handles READY WP re-dispatch independently. It queries `ledger_get_next_action` on every iteration and dispatches the next stage based on the PM's routing logic, which covers all READY WP scenarios by construction.

**Consequences for orchestrator implementations:**

- Do not assume that cross-WP dispatch fires from non-PM handoff functions. Treat `WAIT` from any handoff function as a normal polling signal.
- Do not add `findNextReadyDispatch`-equivalent logic to the orchestrator. The supervisor's hub-and-spoke polling already covers the same ground deterministically.
- If the IDE's `findNextReadyDispatch` logic changes, no corresponding orchestrator change is needed.

**References:** [MCP server edge-cases.md §21.71](../../../../mcp-server/docs/agents/workflow-specification/edge-cases.md); the MCP server's [Non-PM Handoff Functions Must Dispatch to the Next READY WP Before Returning WAIT](../../../../mcp-server/docs/agents/project-manifest/constraints-workflow.md#non-pm-handoff-functions-must-dispatch-to-the-next-ready-wp-before-returning-wait) constraint.
