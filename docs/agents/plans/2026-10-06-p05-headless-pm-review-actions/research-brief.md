# Research Brief

## Scope Sketch

- PM review recommendations (ledger) — `mcp-server/src/tools/workflow-next-action.ts` — modification (payload alignment only)
- WP status transitions (ledger) — `mcp-server/src/tools/work-package.ts` — modification (blocker retention on cancel)
- Orchestrator supervisor routing — `orchestrator/src/supervisor.py` — modification (generalise P03's intercept)
- Orchestrator PM node and PM persona — `orchestrator/src/nodes/pm.py`, `personas/ledger/src/content/2-project-manager.md` — read only (evidence)
- Workflow specification — `mcp-server/docs/agents/workflow-specification/` — modification
- Manifests and orchestrator docs — `mcp-server/docs/agents/project-manifest/`, `orchestrator/docs/` — modification
- Tests — `mcp-server/tests/`, `orchestrator/tests/` — new and modified
- Sibling plans P01–P04 — `docs/agents/plans/2026-10-06-p0{1,2,3}-*`, `docs/agents/plans/2026-09-22-p04-*` — read only (numbering, P03 intercept)

## Area: PM review recommendations (ledger)

### Verified References
- `mcp-server/src/tools/workflow-next-action.ts`:
  - L53–L54 `NEXT_ACTION_DISPATCH['Project Manager']` → `getProjectManagerAction`.
  - L192–L275: all-terminal pre-check (PM gets `SIGNAL_SYNTHESIS`); otherwise role dispatch (L284).
  - L351 `getProjectManagerAction`. First match wins, in this order:
    - L361–L379 **P1 `UNBLOCK_WP`**: any BLOCKED WP with `blocked_by.type` in `decision | external | technical`. Payload `{action, work_package_id, reason}` — **no blocker details**, although spec §14.1.2 pseudocode (`recommendations.md` L59) says "with wp.id, blocker details".
    - L381–L400 **P2 `REVIEW_REWORK_LIMIT`** (P03 extends its payload).
    - L402–L426 **P3 `REVIEW_STALE`**: IN_PROGRESS WP with a pipeline older than `STALE_PIPELINE_HOURS` (24, `shared/workflow-manifest.json` `constants.stale_pipeline_hours`; `workflow-helpers.ts` L28, `isStalePipeline` L151–L155). Payload carries `pipeline_type`, `age_hours`.
    - L428–L475 **P3b `REVIEW_ABANDONED`**: IN_PROGRESS WP, no IN_PROGRESS pipeline, and either the last effective (non-auto-cancelled) pipeline completed > 24 h ago, or no effective pipeline and `status_changed_at` > 24 h ago. Payload `{action, work_package_id, reason}` — **no `assigned_to`**, although spec pseudocode (`recommendations.md` L75) says "with wp.id, wp.assigned_to".
    - L477–L498 **P3c `REPAIR_ORPHAN_BLOCKED`**: BLOCKED WP with `dependency` or absent blocker whose dependencies all satisfy `canStartWorkPackage` (terminal). Payload `{action, work_package_id, reason}`.
    - L500–L547 P3d `ROUTE_PIPELINE_AGENT`; L549 WAIT.
- `mcp-server/src/tools/workflow-next-action-batch.ts` L175–L191: the ledger's own guidance for `UNBLOCK_WP` and `REPAIR_ORPHAN_BLOCKED` is `ledger_update_work_package_status(status: "READY")`. L229: the batch collector does not serve the PM.
- Per-role engines act on IN_PROGRESS WPs regardless of `assigned_to`. `assigned_to` is read only in the READY-claim branches (`workflow-next-action.ts` L718, L934, L1179, L1411, L1604, L1832). Developer P7 `CLAIM_WP` (L717–L740) fires for a READY WP that is unassigned **or** assigned to Developer, when `implementation` is an active stage. QA P6 `RUN_QA` (L900–L930) and the other first-run actions also fire on READY WPs (the role loops skip only terminal and BLOCKED, e.g. L761–L763).
- New WPs always start with `assigned_to: null` (`constraints-workflow.md` "Work Package `assigned_to` Always Starts as `null`").
- Tests: `mcp-server/tests/tools/workflow-next-action.test.ts` L264+ "PM action logic": L276 (UNBLOCK_WP), L308 (REVIEW_STALE), L322 (REVIEW_ABANDONED), L346 (REPAIR_ORPHAN_BLOCKED, absent blocker), L367/L396/L416 (priority ordering).

### Established Patterns
- Limit and routing payloads carry structured fields beside `reason` (`REVIEW_STALE` `pipeline_type`/`age_hours`, Developer P1 `rework_count`/`max_rework_count`; P03 adds them to P2).

### Structural Observations
- Two PM payloads omit fields the spec pseudocode names (`UNBLOCK_WP` blocker details, `REVIEW_ABANDONED` `assigned_to`).

### Constraints
- Recommendation priorities must not change (user framing: safeguard only).

## Area: WP status transitions (ledger)

### Verified References
- `mcp-server/src/tools/work-package.ts` `updateWorkPackageStatus` (L663+):
  - L728–L745 BLOCKED → IN_PROGRESS guard (PM or assignee).
  - L766–L781 CANCELLED is PM-only (`Project Manager`, `Project Manager Agent`).
  - L814–L834 IN_PROGRESS → READY (unclaim): rejected while any pipeline is IN_PROGRESS; PM or current assignee only.
  - **No guard on BLOCKED → READY**: any agent identity is accepted.
  - L865–L869 step 7: `if (oldStatus === 'BLOCKED' && newStatus !== 'BLOCKED') delete wp.blocked_by;` — the comment says it covers BLOCKED → IN_PROGRESS and BLOCKED → READY, but the condition also matches **BLOCKED → CANCELLED**, so a cancelled WP loses its blocker.
  - L881–L885 IN_PROGRESS → CANCELLED auto-cancels running pipelines; L887–L896 unclaim clears `assigned_to`.
  - L939–L941 every terminal transition calls `propagateDependencyUnblock`.
- L999–L1060 `propagateDependencyUnblock`: unblocks BLOCKED dependents of the WP that just turned terminal when all their dependencies are terminal and their blocker is `dependency` **or absent**; target status READY; `blocked_by` deleted.
- `mcp-server/src/schema/work-package.ts` L126: `blocked_by: BlockerSchema.optional()` — no coupling to status, so a CANCELLED WP may carry a blocker.
- `mcp-server/src/tools/pipeline.ts` L667–L717 `ledger_cancel_pipeline`: args `work_package_id`, `type`, `reason`, `auto_cancelled`; no agent identity; rejects when no IN_PROGRESS pipeline of that type exists.
- Orphan sources found in code besides the §20.4 lock gap:
  - `mcp-server/src/utils/project-reset.ts` L441–L456: GUI project reset sets `CANCELLED` directly, without `propagateDependencyUnblock`.
  - Any agent may block a WP with a `dependency` blocker whose dependencies are already terminal (no agent guard on → BLOCKED, spec §6.2 design note).
- No existing test asserts that `blocked_by` is cleared on BLOCKED → CANCELLED (`grep blocked_by).toBeUndefined` across `mcp-server/tests`: creation, unblock, reblock and reopen cases only).
- `mcp-server/src/tools/help-content.ts` L355–L401 `ledger_update_work_package_status` help: rules list, no blocker-retention rule.

### Established Patterns
- Terminal transitions trigger the cascade after the lock (`work-package.ts` L931–L941).

### Structural Observations
- Code clears `blocked_by` on every exit from BLOCKED; the spec clears it only on BLOCKED → IN_PROGRESS / READY (see Specification area).
- Spec §6.2 calls BLOCKED → READY "system-only"; the code accepts it from any agent.

### Constraints
- Interactive behaviour must stay unchanged apart from spec alignment.

## Area: Orchestrator supervisor routing

### Verified References
- `orchestrator/src/config.py` L155–L157 `PIPELINE_ROLE_NAMES` = non-orchestrating manifest roles in manifest order: Project Manager, Developer, QA, Security Auditor, Reviewer, Release Engineer, Documentation (`shared/workflow-manifest.json` `roles`; Planner and Synthesis are `orchestrating`).
- `orchestrator/src/supervisor.py` (748 lines, pre-P03):
  - L52–L59 `_SKIP_ACTIONS`; L65–L83 `_DISPATCH_ACTIONS` includes `UNBLOCK_WP`, `REVIEW_REWORK_LIMIT`, `REVIEW_STALE`, `REVIEW_ABANDONED`, `REPAIR_ORPHAN_BLOCKED`, `ROUTE_PIPELINE_AGENT` (PM).
  - L88–L95 `_ROLE_STAGE_MAP`, `_ROLES = list(PIPELINE_ROLE_NAMES)` (L95) → **PM is polled first**.
  - L143–L152 `_call_tool` bypasses stage wrappers and passes explicit args.
  - L210–L225 consecutive-failure counter keyed on the previous `current_wp_id`: incremented when `stage_success` is False, **popped when the stage succeeded**.
  - L235–L262 safety limit: `new_iteration > max_iterations` → END with an `errors` entry (`MAX_ITERATIONS` default 100, `config.py` L373–L376).
  - L518–L537 all-terminal → synthesis.
  - L547–L670 role loop: skip set (L572) → unknown action = WAIT (L576) → consecutive-failure skip at ≥ 3 (L584–L614, `halted_repeated_failure`, errors entry, next role) → dispatch to the role's stage with `current_wp_id = wp_id` (L660–L670). The first dispatchable role wins.
  - L673–L741 all-roles-WAIT fall-through: cancels non-terminal WPs with ≥ 3 consecutive failures (`halted_wp_cancelled`), then routes straight to synthesis.
- `orchestrator/src/nodes/__init__.py`:
  - L897–L902: when `current_wp_id` is set, `restrict_to_wp` applies to every stage, including PM (`src/utils/tool_wrappers.py` L278–L330: third cross-WP call raises `ValueError`).
  - L601–L687 `_handle_rollback` calls `ledger_cancel_pipeline(..., auto_cancelled=True)` (L657–L663) — the same call shape as the planned stale-pipeline cancel.
  - A ledger refusal raises `ToolException` and aborts the stage (P03 brief, probe on installed versions).
- `orchestrator/src/nodes/pm.py`: `_build_pm_prompt` renders `templates/pm.md` with `project_path`, `plan_file` and the plan text only. No action, WP or payload reaches the prompt. `orchestrator/src/nodes/templates/pm.md`: "Please start with the plan".
- `orchestrator/src/cli.py` `_print_run_summary` (L490+): exit 2 at the iteration limit, 1 with errors, 0 otherwise.
- P03 (`docs/agents/plans/2026-10-06-p03-rework-limit-headless-completion/plan.md`, Approach 1b, step 7) adds, ahead of P05: removal of `REVIEW_REWORK_LIMIT` from `_DISPATCH_ACTIONS`; a PM-role intercept placed before the skip, unknown-action and consecutive-failure checks; cancel + `rework_limit_wp_cancelled` (WARNING, no errors entry); re-query of the PM role; per-iteration set of handled WP IDs; failure → `rework_limit_cancel_failed` (ERROR + errors entry) and the PM role skipped for that iteration; entries included in `run_log` on every exit path. Tests `TestReworkLimitCancellation` in `orchestrator/tests/test_supervisor.py`; `ScriptedLedger` extension in `test_integration.py`.

### Verified current headless behaviour (all four actions)
Evidence chain, identical for `UNBLOCK_WP`, `REVIEW_STALE`, `REVIEW_ABANDONED`, `REPAIR_ORPHAN_BLOCKED`:
1. The ledger returns the action to the PM role while its condition holds; P1–P3c precede P3d and WAIT (`workflow-next-action.ts` L361–L498).
2. The supervisor polls the PM first (`_ROLES`, L95) and the action is in `_DISPATCH_ACTIONS` (L66–L67), so it dispatches `pm` with `current_wp_id` = the action's WP (L660–L670). **No other role is polled in that iteration**: while the condition persists, PM pre-empts every other role's work. The Ledger Doctor documents this from a real incident (`personas/ledger-support/src/content/ledger-doctor.md` L288–L292, L337–L340: "A single stale WP generating `REVIEW_ABANDONED` can block the entire project's forward progress by consuming every dispatch cycle").
3. The PM stage cannot perform the action: the prompt carries only the plan (`nodes/pm.py`), and the persona's only workflow is decomposition (`personas/ledger/src/content/2-project-manager.md` L96–L220: research-brief check, plan-folder date rename at step 3, WP Decomposer ×2, Dependency Sequencer, Pipeline Configurator, Ledger Bootstrapper, verify, hand off). No persona source handles these actions (grep across `personas/ledger/src`, `personas/shared`; only the Ledger Doctor mentions them).
4. Two outcomes, both without the action being performed:
   - **The PM stage returns normally** → `stage_success` True → the counter for that WP is popped (L223–L225) → the same dispatch repeats every iteration → safety limit after `MAX_ITERATIONS` (100) → END, exit 2. No other WP progresses.
   - **The PM stage raises** (a refused ledger call, e.g. `ledger_initialize_project` on an existing ledger, or a third cross-WP call under `restrict_to_wp`) → counter +1 per iteration → after 3, `halted_repeated_failure` skips the PM role each iteration (L584–L614, errors entry each time). At the all-WAIT fall-through the sweep **cancels** the WP (L673–L741) and routes straight to synthesis: a stale or abandoned WP, or an orphan that only needed READY, is lost, and its dependents never run in that run (P03 Deferred Item 1).
   Which outcome occurs depends on the LLM; it is not statically decidable. Each PM pass may also re-run the decomposition sub-agents (overwriting `work-packages-draft.md`) and, in a run resumed on a later date, rename the plan folder (persona step 3).
5. Reachability in headless runs:
   - `UNBLOCK_WP`: an agent blocks a WP with a `technical`/`external`/`decision` blocker (no agent guard on → BLOCKED).
   - `REVIEW_STALE`: an IN_PROGRESS pipeline older than 24 h, e.g. a run killed hard (no rollback) and resumed a day later.
   - `REVIEW_ABANDONED`: any IN_PROGRESS WP sitting between stages when a run is resumed more than 24 h after its last pipeline completed.
   - `REPAIR_ORPHAN_BLOCKED`: lock-gap crash (§20.4), GUI project-reset cancellation (`project-reset.ts` L441–L456), or an agent-set `dependency` blocker on terminal dependencies.
- Existing tests that pin the old behaviour: `orchestrator/tests/test_supervisor.py` L1145–L1151 (`TestDirectActionRouting` PM rows → `pm`), L1186–L1200 (`test_first_dispatchable_role_wins` uses `UNBLOCK_WP`), L657–L668 (`TestAllBlocked.test_all_blocked_routes_to_pm`, mock returns `REPAIR_ORPHAN_BLOCKED` without `work_package_id`, L70–L74); `orchestrator/tests/test_integration.py` L116–L121 (`ScriptedLedger` returns `REPAIR_ORPHAN_BLOCKED` without a WP id when all non-terminal WPs are BLOCKED).

### Verified consequence of an unclaim for `REVIEW_ABANDONED`
- IN_PROGRESS → READY is allowed with `agent="Project Manager"` (`work-package.ts` L814–L834; spec §6.2, §21.13). Its guard (no IN_PROGRESS pipeline) always holds for P3b. It clears `assigned_to` (L887–L896).
- The resulting READY, unassigned WP is claimed by Developer P7 `CLAIM_WP` whenever `implementation` is active (L718), and the Developer is polled before every verifier. For a WP waiting on QA or later, that starts a **new implementation pipeline** on already-passed work; the revalidation guard then forces every downstream stage to re-run. Not a rework, so no counter increments, but one or more redundant LLM stages per abandoned WP.
- Without an unclaim, the owning role already acts on the idle IN_PROGRESS WP (per-role actions ignore `assigned_to` for IN_PROGRESS WPs). Only the PM's pre-emption stops it.
- The Ledger Doctor's Repair 10 (`ledger-doctor.md` L294–L301) prescribes this unclaim and claims "the routing engine can dispatch the correct next agent"; the code shows it dispatches the Developer.

### Established Patterns
- Supervisor-side ledger mutation with `agent="Project Manager"` and a WARNING log entry (`halted_wp_cancelled`, L686–L720; P03's `rework_limit_wp_cancelled`).
- No LLM in the supervisor (`orchestrator/docs/agents/project-manifest/constraints.md` §4).

### Structural Observations
- After P03 the PM intercept is a single inline branch for one action. Four more actions with the same shape (tool call, success event, failure event, re-query) would repeat it four times.
- `_DISPATCH_ACTIONS` lists PM review actions next to dispatchable PM actions; after this plan only `ROUTE_PIPELINE_AGENT` (redirected to `next_agent`) remains dispatchable for the PM, plus the no-WP decomposition route.

### Constraints
- No new graph edge, exit code, WP status or LLM involvement (user framing; P03 constraint).
- Exit codes and the synthesis predicate stay as they are (`decisions.md` "Not Adopted: Settled-but-Not-Terminal WPs at Synthesis").

## Area: Workflow specification

### Verified References
- `README.md` L5 Version 2.5.1 (before P02–P04). `edge-cases.md` last section §21.71 (L738). `shared/workflow-manifest.json` `spec_version` 2.4.1 (P02 realigns).
- `recommendations.md` §14.1.2 L40–L86 (priorities 1–5, pseudocode; 3b and 3c notes L88–L90: 3c names "PM should transition it to READY or manually unblock", with a data-integrity caveat for an absent blocker).
- `state-machines.md` §6.2 L67–L118: BLOCKED → READY "System-only (auto-unblock path from §15.4) / Clears blocked_by"; BLOCKED → IN_PROGRESS "Clears blocked_by"; **BLOCKED → CANCELLED: PM only, no clearing**. L224: "system" identity note.
- `operations.md` L353–L357: pseudocode clears `blocked_by` only `if currentStatus == "BLOCKED" AND targetStatus in ["IN_PROGRESS", "READY"]`.
- `edge-cases.md` §21.12 L113–L115 "Both BLOCKED → IN_PROGRESS and BLOCKED → READY automatically clear the blocked_by field"; §21.13 L117–L123 (unclaim); §21.20 L180–L184 ("Implementations SHOULD detect orphaned BLOCKED WPs … during `getNextAction` and either auto-repair or surface as a PM action"); §21.21 L186–L190.
- `auxiliary-systems.md` §17 (self-healing is project-level only, L7–L15); §20.4 L293–L302 (re-invoking the cascade is the prescribed WP-level repair; "either auto-repair or surface it as a PM action").
- `dependencies-and-rework.md` §15.4 L77–L117 (auto-unblock); §16.3c L291–L309 (headless rework-limit handling, rewritten by P03).
- `walkthrough.md` L150–L172 action table (UNBLOCK_WP, REVIEW_*, REPAIR_ORPHAN_BLOCKED descriptions).

### Structural Observations
- Spec contradiction: §6.2 says BLOCKED → READY is system-only; §14.1.2 3c (and the ledger's own batch guidance) tell the PM to transition an orphan to READY.
- Spec-code divergence: code clears `blocked_by` on BLOCKED → CANCELLED; spec does not.
- §21.20 permits either layer for the orphan repair; the implementation chose the PM action, with a verification caveat for absent blockers.

### Constraints
- Spec first, then code, then tests, then `constraints-workflow.md` (root `AGENTS.md`, "Change workflow logic").

## Area: Manifests and orchestrator docs

### Verified References
- `mcp-server/docs/agents/project-manifest/constraints-workflow.md`: "Status Transitions Are Enforced" (L32–L50), "`IN_PROGRESS → READY` (Unclaim) Requires No Active Pipelines" (L113–L119), "BLOCKED Status Requires a Blocker Object" (L135+), "Handoffs & Routing" (L537+). The five actions are not named in this file today.
- `mcp-server/docs/agents/project-manifest/api-surface.md` L6541–L6557 (PM priorities); `data-flows.md` L491–L496, L550–L551, L843–L844.
- `orchestrator/docs/supervisor-routing.md` L35–L66 (standard routing; table L55–L57 lists the PM review actions → `pm`), L79–L89 (circuit breaker, halted-WP cancellation). P03 adds a "Rework-Limit Cancellation (spec §16.3c)" subsection.
- `orchestrator/README.md` L348 routing table row "`REPAIR_ORPHAN_BLOCKED` / `UNBLOCK_WP` / `REVIEW_*` → `pm`"; L418+ exit codes.
- `orchestrator/docs/jsonl-log-schema.md` L84, `orchestrator/docs/architecture.md` L287, `orchestrator/docs/agents/project-manifest/api-surface.md` L47–L55: supervisor event rows.
- `orchestrator/docs/agents/project-manifest/decisions.md` L68–L82 "Not Adopted: Settled-but-Not-Terminal WPs at Synthesis" (P03 adds a Consequences bullet).
- `orchestrator/docs/agents/project-manifest/file-tree.md` L36 and `README.md` L112: `src/` listing.
- Versions: `mcp-server/changelog.md` top v2.11.0; `orchestrator/changelog.md` top v1.4.0 (`pyproject.toml` L3).

## Area: Sibling plans (numbering)

### Verified References
- P02: spec v2.6.0, §21.72, mcp-server v2.12.0.
- P03: spec v2.7.0, §21.73, mcp-server v2.13.0, orchestrator v1.5.0; numbering rule in its Dependencies section.
- P04 (`2026-09-22-p04-pipeline-stage-adjustment/plan.md` L3 sequencing note): renumbers to spec v2.8.0 / §21.74 and the next mcp-server minor after P03 (v2.14.0); no orchestrator change (P04 Out of Scope).
- P03 Out of Scope (a)–(c) and Deferred Item 4 list the PM, pipeline-agent and Synthesis persona follow-ups; (a) already names the four actions this plan handles.

## Strategic Context

- Long-term secondary goal: make the orchestrator headless workflow as reliable as possible. A PM action that pre-empts every role and loops to the iteration limit contradicts it directly.
- Insights `a1368334-…` and `cf33c8a0-…` (global): WPs that need a human cannot complete in an autonomous run and end up cancelled. This supports the user's cancel policy for `UNBLOCK_WP`; neither insight is overtaken.
- Insight `ea8cb364-…` (repository): routing loop ended by a wrong cancellation; consistent with the "PM stage raises" outcome above; not overtaken.
- No stored insight claims how these four actions behave in headless runs, so none needs reconciliation.
