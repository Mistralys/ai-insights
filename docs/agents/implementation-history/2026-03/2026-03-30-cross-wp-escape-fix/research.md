
# Research Report

## Problem Statement

During an orchestrator run, the `docs` stage for WP-002 completed
its documentation pipeline successfully but then attempted to begin
work on WP-003 — violating the orchestrator's single-WP-per-stage
invariant. The `restrict_to_wp` guard caught and blocked the cross-WP
calls (3 strikes → hard abort), but the resulting error path wasted
API tokens, logged a noisy pipeline-rollback warning, and added
unnecessary latency.

## Problem Decomposition

1. **Why did the agent cross the WP boundary?** Trace the tool call
   sequence to identify what directed the agent to WP-003.
2. **Why didn't the guard prevent it sooner?** Analyse which tools
   are exempt from the guard and whether the exemption is too broad.
3. **Was the error recovery correct?** Evaluate whether the supervisor
   handled the failed stage appropriately and whether the ledger state
   remained consistent.
4. **Is this a systemic risk?** Determine whether all stages are
   vulnerable to the same pattern.

## Context & Constraints

- The orchestrator invokes one Deep Agent per stage turn, scoped to a
  single work package (`_wp_id`).
- The `restrict_to_wp` guard in `tool_wrappers.py` blocks write-tool
  calls that target a WP other than the active one (2 soft-fail
  warnings, then a hard `ValueError`).
- `_READ_ONLY_TOOLS` (`ledger_get_work_package`,
  `ledger_get_next_action`, etc.) are **exempt** from the guard so
  agents can read cross-WP context.
- Persona files are shared between IDE workflows (one agent loops
  through all WPs) and orchestrator workflows (supervisor routes one
  WP per stage turn). Persona changes must not break the IDE path.

## Prior Art & Known Patterns

### Pattern 1: Soft-fail + hard-kill strike counter (current)

- **Description:** `restrict_to_wp` gives the agent 2 soft-fail
  warnings (error message returned as tool output) before raising a
  `ValueError` on the 3rd violation.
- **Where used:** `orchestrator/src/utils/tool_wrappers.py`
  lines 330-400.
- **Strengths:** Gives the LLM a chance to self-correct; prevents
  infinite retry loops.
- **Weaknesses:** Does not prevent the root cause — the agent is
  *directed* to the wrong WP by `ledger_get_next_action` before any
  write tool is called. By the time the guard fires, the agent is
  already committed to the cross-WP path.
- **Fit:** Working correctly as a last-resort safety net, but does
  not address the upstream signal problem.

### Pattern 2: `_install_begin_work_tracker` (existing infra)

- **Description:** Wraps `ledger_begin_work` to record when it fires
  and which `pipeline_type` was used. Used by the error handler to
  decide whether pipeline rollback is needed.
- **Where used:** `orchestrator/src/nodes/__init__.py` lines 52-93.
- **Strengths:** Proven pattern for observing tool calls without
  altering behaviour.
- **Weaknesses:** Only tracks; does not intercept or alter results.
- **Fit:** Demonstrates the pattern of wrapping a specific tool to
  observe state transitions inside a stage.

## Root Cause Analysis

### Event sequence (from logs)

```
13:54:15  ledger_begin_work(WP-002)          ← starts docs pipeline
13:55:07  ledger_complete_pipeline(WP-002)   ← pipeline PASS; auto-finalises WP-002
13:55:13  ledger_get_next_action             ← returns WRITE_DOCS for WP-003
13:55:18  ledger_begin_work(WP-003)          ← strike 1  (soft fail)
13:55:18  ledger_get_work_package(WP-003)    ← read-only exempt
13:55:32  ledger_begin_work(WP-003)          ← strike 2  (soft fail)
13:55:36  ledger_claim_work_package(WP-003)  ← strike 3  (hard kill)
```

### Cause chain

1. The agent completed WP-002's documentation pipeline via
   `ledger_complete_pipeline`. The MCP server auto-finalised WP-002
   to `COMPLETE`.
2. The Documentation persona's workflow step 6 instructs:
   *"Call `ledger_get_next_action` again … Continue until WAIT."*
3. The agent dutifully called `ledger_get_next_action`. Since WP-002
   is now `COMPLETE`, the MCP server returned `WRITE_DOCS` for
   WP-003 — the next WP needing documentation.
4. `ledger_get_next_action` is in `_READ_ONLY_TOOLS` → exempt from
   the guard → the response passed through unmodified.
5. The agent followed the response's `next_steps` and called
   `ledger_begin_work(WP-003)`, hitting the write-tool guard.

### Downstream error-path issues

- **Spurious rollback warning:** The error handler tried to cancel
  WP-002's `documentation` pipeline, but it was already `PASS` →
  `"Cannot cancel pipeline: no IN_PROGRESS pipeline"` warning. This
  is harmless but noisy.
- **Correct ledger state despite failure:** WP-002 was already
  `COMPLETE` in the ledger before the stage error. The supervisor's
  status-diff logic correctly detected `IN_PROGRESS → COMPLETE` and
  logged `✓ WP-002 COMPLETE`.
- **WP-003 succeeded on next iteration:** The supervisor correctly
  routed WP-003 to a fresh `docs` stage, which completed without
  error.

### Systemic scope

Every persona (Developer, QA, Reviewer, Security Auditor, Release
Engineer, Documentation) has the same "Repeat → call
`ledger_get_next_action` again → continue until WAIT" instruction.
**All stages are vulnerable to this pattern** when the assigned WP's
pipeline completes quickly enough for the agent to loop before the
stage ends.

In practice, the risk is highest for lightweight stages like `docs`
(fast pipeline, agent loops quickly) and lower for heavy stages like
`developer` (implementation takes longer, agent is less likely to
loop).

## Alternative & Creative Approaches

### Approach A: Post-completion `get_next_action` interception

Install a tracker on `ledger_complete_pipeline` (analogous to
`_install_begin_work_tracker`). Once it fires for the active WP,
intercept subsequent `ledger_get_next_action` calls and return a
synthetic response:

```json
{
  "action": "WAIT",
  "reason": "Pipeline completed. The orchestrator will route the next work package."
}
```

- **Rationale:** Prevents the agent from receiving cross-WP routing
  instructions. Aligns with the persona's "WAIT = done" rule without
  requiring persona changes. The agent sees WAIT and proceeds to the
  Handoff step — clean exit.
- **Risk:** If a stage legitimately needs to call
  `ledger_get_next_action` twice (e.g. rework cycle within the same
  WP), the interception must be scoped to *post-completion* only.
  Since `ledger_complete_pipeline` transitions the pipeline to a
  terminal status (PASS/FAIL), this is a reliable trigger. A FAIL
  completion followed by a rework loop won't re-trigger because the
  tracker would need to detect specifically PASS or track that the
  pipeline *for the active WP* has completed. However, even with
  FAIL, the supervisor should be routing — not the agent.

### Approach B: User-turn prompt WP-scoping

Add a `wp_id` variable to each stage template and include an
explicit scope instruction:

```markdown
You are working on **{wp_id}** only. Do NOT call ledger_begin_work
or ledger_claim_work_package for any other work package. After
completing the pipeline for {wp_id}, stop — the orchestrator will
route the next WP.
```

- **Rationale:** Directly tells the agent its scope. LLMs generally
  follow explicit user-turn instructions well.
- **Risk:** Relies on LLM compliance — not a hard guarantee. Adds
  prompt tokens to every stage invocation. The agent could still call
  `ledger_get_next_action` and receive a cross-WP response, even if
  it doesn't act on it.

### Approach C: Remove `ledger_get_next_action` from `_READ_ONLY_TOOLS`

Make `ledger_get_next_action` subject to the WP guard. Since it
doesn't take a `work_package_id` parameter, the guard's injection
logic would add `work_package_id=<active_wp>` to the call. However,
`ledger_get_next_action` uses `agent_role`, not `work_package_id` —
the injected parameter would be ignored by the MCP server, and the
response could still direct the agent to a different WP. **This
approach does not work** because the guard operates on *input*
parameters, not *output* content.

### Approach D: Hybrid (A + B)

Combine the programmatic interception (Approach A) with a brief
user-turn prompt hint (Approach B). The prompt hint reduces the
chance of the agent calling `ledger_get_next_action` at all; the
interception catches it if it does.

## Comparative Evaluation

| Criterion            | A: Post-completion interception | B: Prompt scoping | D: Hybrid (A+B) |
|----------------------|--------------------------------|-------------------|------------------|
| **Reliability**      | High (programmatic)            | Medium (LLM-dependent) | High         |
| **Complexity**       | Medium (new tracker + wrapper) | Low (template edit)    | Medium       |
| **Token cost**       | Zero extra                     | ~40 tokens/stage       | ~40 tokens/stage |
| **Persona impact**   | None                           | None (template-only)   | None         |
| **Covers all stages**| Yes                            | Yes                    | Yes          |
| **Prevents wasted calls** | Yes (at source)           | Probabilistic          | Yes          |
| **Implementation risk** | Low (follows existing patterns) | Very low            | Low          |

## Recommendation

**Approach A (post-completion `get_next_action` interception)** is
the recommended solution.

It addresses the root cause programmatically, follows the existing
`_install_begin_work_tracker` pattern, requires no persona or
template changes, and prevents all three wasted tool calls. The
synthetic WAIT response aligns with the persona's "WAIT = done" exit
condition, so the agent will cleanly proceed to the Handoff step.

Approach B (prompt scoping) is a worthwhile optional addition — it
reduces unnecessary `get_next_action` calls and makes the scope
explicit. But it should not be relied on as the sole fix.

Approach C is non-viable.

### Proof-of-Concept Outline

1. **Add a `_install_complete_pipeline_tracker`** in
   `nodes/__init__.py`. Similar to `_install_begin_work_tracker`:
   wrap `ledger_complete_pipeline`'s `ainvoke` to flip a
   `{"completed": True}` flag when the tool call succeeds for the
   active WP.

2. **Add a `_install_post_completion_guard`** — wrap
   `ledger_get_next_action`'s `ainvoke` to check the completion
   flag. If set, return a synthetic tool response:
   ```json
   {
     "action": "WAIT",
     "reason": "Pipeline completed for the active work package. The orchestrator will route the next work package."
   }
   ```
   This wrapper should be installed *after* the completion tracker
   so the flag is available.

3. **Integrate both wrappers** into the existing wrapper chain in
   `create_stage_node`, between `_install_begin_work_tracker` and
   `log_tool_calls`.

4. **Add tests** in `tests/test_tool_wrappers.py`:
   - After `ledger_complete_pipeline` succeeds,
     `ledger_get_next_action` returns synthetic WAIT.
   - Before `ledger_complete_pipeline`, `ledger_get_next_action`
     passes through to the real tool.
   - The synthetic response has the expected shape for the persona's
     WAIT handling.

5. **Optional (Approach B addition):** Update the
   `project-path-reminder.md` partial or add a new
   `wp-scope-reminder.md` partial to include a one-line scope hint.
   This requires adding `wp_id` as a template variable in each
   stage's `_build_*_prompt` function and the partial.

## Open Questions

- **Rework within a single stage turn:** Can a stage legitimately
  complete a pipeline as FAIL and then re-attempt work on the same
  WP within the same agent invocation? Current persona instructions
  suggest the agent should loop, so this is theoretically possible.
  The tracker should only intercept `get_next_action` after a *first*
  `complete_pipeline` call; any subsequent rework within the same WP
  would trigger `begin_work` again (which the guard allows for the
  active WP). **This needs careful design** — the tracker should
  probably fire on any completion (PASS or FAIL) since the
  orchestrator's supervisor, not the agent, should decide whether to
  re-run the stage.

- **Pipeline rollback false warning:** The error handler attempts to
  cancel an already-completed pipeline. This should be suppressed
  when `_begin_work_state["called"]` is True but
  `_complete_pipeline_state["completed"]` is also True. This is a
  minor logging cleanup, not a functional issue.

## References

- `orchestrator/src/utils/tool_wrappers.py` — `restrict_to_wp()`,
  `_READ_ONLY_TOOLS`
- `orchestrator/src/nodes/__init__.py` —
  `_install_begin_work_tracker()`, `create_stage_node()`
- `personas/ledger/claude-code/8-documentation.md` — Workflow step 6
  ("Repeat … Continue until WAIT")
- `personas/ledger/claude-code/3-developer.md` — Workflow step 5
  (same pattern)
- `personas/ledger/claude-code/4-qa.md` — Workflow step 6
  (same pattern)
