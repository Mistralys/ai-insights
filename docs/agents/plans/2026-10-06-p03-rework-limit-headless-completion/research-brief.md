# Research Brief

## Scope Sketch

- Rework-limit recommendation and circuit breaker (ledger) — `mcp-server/src/tools/workflow-next-action.ts`, `mcp-server/src/tools/pipeline.ts`, `mcp-server/src/tools/begin-work.ts` — modification
- Synthesis guard (ledger) — `mcp-server/src/tools/project-lifecycle.ts` — read only (verified, no change)
- Orchestrator supervisor routing at the rework limit — `orchestrator/src/supervisor.py` — modification
- Orchestrator stage nodes, PM node, synthesis node, CLI result — `orchestrator/src/nodes/`, `orchestrator/src/cli.py` — read only (verified, no change)
- Start-path parity (`beginWork` vs `startPipeline`) — `mcp-server/src/tools/begin-work.ts` — modification
- Workflow specification — `mcp-server/docs/agents/workflow-specification/` — modification
- Manifest and orchestrator docs — `mcp-server/docs/agents/project-manifest/`, `orchestrator/docs/` — modification
- Tests — `mcp-server/tests/`, `orchestrator/tests/` — new and modified
- Pending plans that share spec numbering — `docs/agents/plans/2026-10-06-p02-unfixable-verifier-chain-validation/`, `docs/agents/plans/2026-09-22-p04-pipeline-stage-adjustment/` — read only

## Area: Rework-limit recommendation and circuit breaker (ledger)

### Verified References
- `shared/workflow-manifest.json`: `constants.max_rework_count` = 5; `spec_version` = `2.4.1` (drifted; the verifier plan realigns it). `pipelines.fail_routing` sends `implementation`, `qa`, `security-audit`, `code-review` FAILs to `developer`, `release-engineering` to `release_engineer`, `documentation` to `docs`. Role order: Planner, Project Manager, Developer, QA, Security Auditor, Reviewer, Release Engineer, Documentation, Synthesis.
- `mcp-server/src/utils/workflow-helpers.ts` L37: `MAX_REWORK_COUNT` derived from the manifest. L179–L181 `isMostRecentPipelineFail` uses `latestNonCancelledPipeline` (auto-cancelled excluded). L191–L198 `hasDownstreamFail` delegates to it. L286+ `hasDownstreamReengagedSince` excludes auto-cancelled.
- `mcp-server/src/tools/pipeline.ts` `startPipeline`, inside `store.updateWorkPackageWithSync`:
  - L192–L203: prerequisite lookup `wp.pipelines.filter((p) => p.type === prerequisite && !p.auto_cancelled)`; most recent must be PASS.
  - L221–L235: rework detection over `effectiveSamePipelines` (auto-cancelled excluded) or `hasDownstreamFail`; on rework, `rework_counts[type] = current + 1`.
  - L237–L246: "Uses post-increment count; the throw below aborts the write, so the increment is never persisted if the circuit breaker fires." Throws `Rework circuit breaker: … has reached the maximum rework count (5). Consider cancelling this work package (transition to CANCELLED) or restructuring the approach.`
- `mcp-server/src/tools/begin-work.ts` `beginWork`, one `updateWorkPackageWithSync` call (L74):
  - L76–L120 claim phase (READY → IN_PROGRESS, `claimed` captured outside the updater, L71/L120).
  - L174–L184 Guard 3: `wp.pipelines.filter((p) => p.type === prerequisite)` — **no** `auto_cancelled` exclusion.
  - L186–L196 Guard 3b: `checkRevalidationGuard` (shared helper, excludes auto-cancelled).
  - L198–L209 Guard 4: same rework detection as `startPipeline`.
  - L211–L218 Guard 5: same post-increment check and throw.
- `mcp-server/src/storage/ledger-store.ts` L360–L398 `updateWorkPackageWithSync`: the updater runs inside the lock; a throw aborts before `atomicWriteJson`, so nothing is written.
- `mcp-server/src/tools/workflow-next-action.ts`:
  - L183–L245: all-terminal pre-check — Synthesis `GENERATE_SYNTHESIS`, PM `SIGNAL_SYNTHESIS`, others `WAIT`.
  - L351–L398 `getProjectManagerAction`: P1 `UNBLOCK_WP` (BLOCKED with decision/external/technical blocker), P2 `REVIEW_REWORK_LIMIT` for an IN_PROGRESS WP with any `rework_counts` entry `>= MAX_REWORK_COUNT`; payload `{action, work_package_id, reason: "Rework limit reached for {type} pipeline."}` — no structured type or count.
  - L581–L603 Developer P1 `BLOCK_FOR_REWORK_LIMIT` when `rework_counts.implementation >= MAX`; payload carries `rework_count`, `max_rework_count`, `next_steps`.
  - L774–L810 QA P1 / P1b `WAIT_FOR_UPSTREAM_REWORK_LIMIT`; L1020–L1050 Reviewer; L1255–L1290 Security Auditor; L1466–L1500 Release Engineer; L1668–L1695 Documentation — all `>= MAX_REWORK_COUNT`.
  - L627–L652 Developer P4 `REWORK` (direct FAIL), L654–L676 P5 `REWORK` (downstream FAIL re-engaged).
- `mcp-server/src/tools/workflow-next-action-batch.ts` L221+ `getNextActionsCollector`: no rework-limit logic; PM returns "Batch actions not applicable".
- `mcp-server/src/tools/work-package.ts` L766–L767 CANCELLED requires `Project Manager`; L882–L885 IN_PROGRESS → CANCELLED auto-cancels running pipelines; L940 `propagateDependencyUnblock` runs after a terminal transition. L1249–L1251 `resetReworkCount` zeroes a counter.
- Writers of `rework_counts`: only `pipeline.ts` L234, `begin-work.ts` L208, `work-package.ts` L901 (reopen reset) and L1249–L1251 (PM reset), `ledger-store.ts` L219 (legacy migration). Nothing else can raise a counter.

### Established Patterns
- State captured outside the updater and read after the lock releases: `claimed` in `begin-work.ts` L71/L120/L245.
- Error results as `{ content: [{type:'text', text}], isError: true }` from the tool's outer `catch`.
- Recommendation payloads for limit actions carry `rework_count` and `max_rework_count` (Developer P1, `workflow-next-action.ts` L586–L593).

### Structural Observations
- The circuit breaker counts post-increment and aborts the write, so a stored counter never exceeds `MAX_REWORK_COUNT - 1` through normal operation. Every recommendation check uses `>= MAX_REWORK_COUNT`, so `BLOCK_FOR_REWORK_LIMIT`, `WAIT_FOR_UPSTREAM_REWORK_LIMIT` and `REVIEW_REWORK_LIMIT` are unreachable from tool-driven state. The engine keeps emitting `REWORK`, which every start then refuses.
- Every existing limit test seeds `rework_counts` at `MAX_REWORK_COUNT` directly (`tests/tools/rework-circuit-breaker.test.ts` L130–L176, L191–L223; `tests/tools/workflow-next-action.test.ts` L297–L305, L366+). No test drives the counter through tool calls, which is why the gap went unnoticed.
- `beginWork` re-implements the `startPipeline` guard chain (Guards 1–5). The two copies have already drifted once (prerequisite filter).
- The `REVIEW_REWORK_LIMIT` payload names the stage only inside the `reason` string.

### Constraints
- Spec first, then code, then tests, then `constraints-workflow.md` (root `AGENTS.md`, "Change workflow logic").
- No new mechanisms; scope limited to what is broken (user instruction).

## Area: Synthesis guard (ledger)

### Verified References
- `mcp-server/src/tools/project-lifecycle.ts` L821–L888 `completeSynthesis`: Guard 1 role (`Synthesis` or `Project Manager`), Guard 3 at least one WP, Guard 4 `pendingWps` (non-terminal, recomputed fresh) must be 0. CANCELLED counts as terminal.
- Spec §19.1 (`auxiliary-systems.md`) and §21.28 (`edge-cases.md` L244–L248): an all-CANCELLED project still synthesises.

### Established Patterns
- Terminal = COMPLETE or CANCELLED everywhere (`isTerminalStatus`).

### Structural Observations
- Nothing found that needs to change: a cancelled WP satisfies the guard.

### Constraints
- A BLOCKED or IN_PROGRESS WP blocks synthesis (by design; orchestrator `decisions.md` "Not Adopted: Settled-but-Not-Terminal WPs at Synthesis").

## Area: Orchestrator supervisor routing

### Verified References
- `orchestrator/src/supervisor.py`:
  - L51–L58 `_SKIP_ACTIONS` includes `WAIT_FOR_UPSTREAM_REWORK_LIMIT` and `BLOCK_FOR_REWORK_LIMIT`. L66–L83 `_DISPATCH_ACTIONS` includes `REVIEW_REWORK_LIMIT` (PM).
  - L88–L95 `_ROLE_STAGE_MAP` / `_ROLES` from `PIPELINE_ROLE_NAMES` (`config.py` L155): Project Manager is polled first.
  - L210–L224 consecutive-failure counter keyed on the previous `current_wp_id`; reset on `stage_success`.
  - L231–L262 safety limit (`iteration > max_iterations`) → END with an `errors` entry.
  - L518–L537 all-terminal check on `ledger_list_work_packages` summaries → synthesis with `current_wp_id: ""`.
  - L546–L670 role loop: first dispatchable action wins; L584–L614 a WP with `cf >= 3` is skipped (`halted_repeated_failure`, adds an `errors` entry every iteration) and the loop moves to the **next role**.
  - L673–L741 all-roles-WAIT fall-through: cancels every non-terminal WP with `cf >= 3` via `ledger_update_work_package_status(status="CANCELLED", agent="Project Manager")`, logs `halted_wp_cancelled`, then routes **directly** to synthesis with `current_wp_id: ""`.
- `orchestrator/src/config.py` L373–L381: `MAX_ITERATIONS` default 100.
- `orchestrator/src/graph.py`: stages loop back to supervisor; `synthesis` edges to END.

### Established Patterns
- Supervisor-side ledger mutation through `ledger_update_work_package_status(... agent="Project Manager")` with a WARNING log entry (`halted_wp_cancelled`).
- Every dispatch emits a `route` entry; supervisor never calls an LLM (`constraints.md` §4).

### Structural Observations
- `REVIEW_REWORK_LIMIT` is dispatched to the PM node like any other PM action; nothing in the supervisor implements spec §16.3c.
- The halted sweep routes straight to synthesis after cancelling. Dependents unblocked by that cancellation, and WPs starved behind the halted WP (each role's `ledger_get_next_action` returns its first WP; the halted skip moves to the next role), never run in that run. Synthesis then gets `WAIT` and the run ends without a synthesis.

### Constraints
- `orchestrator/docs/agents/project-manifest/decisions.md` L68+ "Not Adopted: Settled-but-Not-Terminal WPs at Synthesis": keep the terminal-only predicate and exit codes 0/1/2; "A failure that cannot be fixed in scope ends at the existing rework limit."
- `orchestrator/docs/agents/project-manifest/constraints.md` §4 (no LLM in supervisor), §6 (circuit-breaker threshold 3).

## Area: Orchestrator stage nodes, PM node, synthesis node, CLI

### Verified References
- `orchestrator/src/nodes/pm.py`: `_build_pm_prompt` renders `templates/pm.md` with `project_path`, `plan_file` and the full plan text. No action or `work_package_id` reaches the prompt.
- `personas/ledger/src/content/2-project-manager.md` L96–L207: the only workflow is plan decomposition (verify brief, rename plan folder date, WP Decomposer ×2, Dependency Sequencer, Pipeline Configurator, Ledger Bootstrapper, validate, verify, handoff "When `ledger_get_next_action` returns WAIT"). No handling for `REVIEW_REWORK_LIMIT`, `UNBLOCK_WP`, `REVIEW_STALE`, `REVIEW_ABANDONED` or `REPAIR_ORPHAN_BLOCKED` (grep across `personas/ledger/src`, `personas/shared`, `personas/ledger-support/src`: only the Ledger Doctor and Claude Coordinator mention the limit).
- `personas/ledger/src/content/9-synthesis.md`: no mention of cancelled WPs.
- `orchestrator/src/nodes/__init__.py`:
  - L270–L289 begin-work tracker sets `called = True` on every call, including refused ones.
  - L601–L687 `_handle_rollback`: when `ledger_begin_work` was called and `ledger_complete_pipeline` did not succeed, calls `ledger_cancel_pipeline(..., auto_cancelled=True)`; a failure is logged as a warning.
  - L767–L1058 `create_stage_node`: `stage_success` True only when the agent finishes without raising; any exception → `stage_error`, rollback, an `errors` entry, `stage_success` False. `restrict_to_wp` is applied when `current_wp_id` is set (also for PM).
- `orchestrator/src/mcp_client.py` L101 `load_mcp_tools(session)`; `.venv/.../langchain_mcp_adapters/tools.py` L180–L189 raises `ToolException` on `isError`, L426 `StructuredTool(...)` sets no `handle_tool_error`. LangGraph `ToolNode`'s default handler re-raises non-invocation errors. Probe (scratchpad, installed versions): a `ToolException` from a tool inside a `ToolNode` graph propagates (`RAISED ToolException`). So a ledger tool refusal aborts the stage.
- `orchestrator/src/nodes/synthesis.py`: project-scoped; prompt only `project_path`.
- `orchestrator/src/cli.py` L536–L569 `_print_run_summary`: exit 0 only with zero errors and below the iteration limit; FATAL → 1; `iteration >= max_iterations` → 2; else 1 "COMPLETED WITH ERRORS". L1152–L1166 sidecar `result` is SUCCESS unless fatal/outside errors or interrupted.
- `orchestrator/README.md` L418–L428 exit codes; "A run that ends with WPs cancelled … but raised no errors, exits 0."

### Structural Observations
- A ledger refusal surfaces as a stage crash, so every refused start costs a stage and an `errors` entry.

### Constraints
- PM and Synthesis persona content is out of scope (Persona Curator).

## Area: Start-path parity

### Verified References
- Spec §21.27 (`edge-cases.md` L231–L242): auto-cancelled pipelines are excluded from "Prerequisite check in `startPipeline` (§11.1, §8.2) … a WP with `[impl PASS, impl FAIL(auto_cancelled)]` correctly allows QA to start".
- Spec §11.1 pseudocode (`operations.md` L447–L451): `prereqPipelines = wp.pipelines.filter(p => p.type == prerequisite)` — no exclusion. Internal spec inconsistency; §21.27 is the specific rule and matches `startPipeline`.
- The spec has no separate `beginWork` algorithm; `ledger_begin_work` is claim + the `startPipeline` guard chain (`constraints-workflow.md` "Pipelines Can Only Be Started for an Active Stage").
- `mcp-server/tests/tools/start-pipeline-guards.test.ts` L196–L227 pins the §21.27 case for `startPipeline` only. `mcp-server/tests/tools/begin-work.test.ts` (602 lines) has no `auto_cancelled` case.
- Writers of `auto_cancelled: true`: `cancelPipeline` with `auto_cancelled` (`pipeline.ts` L676–L717; orchestrator rollback), IN_PROGRESS → BLOCKED / CANCELLED (`work-package.ts` L651–L658, L882–L885), cascade reblock (spec §15.5), GUI project reset (`api-surface.md` L3834).
- `mcp-server/docs/agents/project-manifest/constraints-workflow.md` L370: "Divergence between the two start paths … They already differ in one place …". `data-flows.md` Flow 4 (L257–L313) step 3 says "most recent prerequisite pipeline" without the exclusion, and L274 says `ledger_begin_work` runs the same guard. Recorded by the 2026-10-06 Curator pass (`curation-log.md` L15–L23).

### Established Patterns
- `latestNonCancelledPipeline` / `!p.auto_cancelled` filters everywhere in the recommendation engine.

### Structural Observations
- `beginWork` and `startPipeline` duplicate Guards 1–5. A shared extraction would remove the drift risk but is a refactor beyond the two fixes.

### Constraints
- Divergence is one-directional: auto-cancelled pipelines are always FAIL, so `beginWork` can only wrongly reject, never wrongly accept.

## Area: Workflow specification

### Verified References
- `README.md` L5–L6: Version 2.5.1, Date 2026-05-30; changelog L10+.
- `dependencies-and-rework.md` §16.2 (L230–L238), §16.3 (L240–L250), §16.3b (L252–L289), §16.3c (L291–L309, "orchestrator SHOULD … log … transition the WP to CANCELLED … allow the project to proceed to synthesis"; "Halted WPs and synthesis" note).
- `operations.md` §11.1 L447–L451 (prerequisite) and L517–L529 (rework detection + circuit breaker; `ERROR` aborts).
- `recommendations.md` §14.1.2 L40–L63 (PM priorities; `return REVIEW_REWORK_LIMIT with wp.id`), Developer L116–L131, QA L192–L193, Reviewer L212–L213, Documentation L230–L231, Security Auditor L262–L263, Release Engineer L282–L283.
- `edge-cases.md`: last section §21.71 (L738). §21.27 L231–L242. §21.68 L680–L703. L447–L464 (upstream rework-limit propagation example "rework_counts.implementation reaches MAX_REWORK_COUNT (5)").
- `walkthrough.md` L142 (`MAX_REWORK_COUNT` "Maximum rework cycles before circuit breaker"), L151, L166.

### Constraints
- The spec is authoritative over code (root `AGENTS.md`).

## Area: Manifest and orchestrator docs

### Verified References
- `mcp-server/docs/agents/project-manifest/constraints-workflow.md`: L360–L372 "Pipelines Can Only Be Started for an Active Stage" (divergence paragraph L370); L414–L440 "A Chain With a Verifier Stage Must Include `implementation`" ("Unfixable failures" paragraph, "until its `rework_counts` entry reaches `MAX_REWORK_COUNT`"); L488 circuit-breaker paragraph under "Rework Count Increments on Pipeline Retry".
- `mcp-server/docs/agents/project-manifest/api-surface.md` L339 (reset use case), L421 (`ledger_begin_work` start phase), L443–L445 (rework detection, circuit breaker), L6542 (PM P2), L6568–L6636 (per-role P1/P1b).
- `mcp-server/docs/agents/project-manifest/data-flows.md` Flow 4 L257–L313.
- `mcp-server/src/tools/help-content.ts` L291 "Rework circuit breaker — rejects if per-type rework count is at maximum".
- `orchestrator/docs/supervisor-routing.md` L19–L25 (special exits, synthesis predicate), L35–L67 (standard routing; table lists `REVIEW_REWORK_LIMIT` → pm), L68 stale "Test coverage gap (known)" note, L79–L89 circuit breaker and halted-WP cancellation.
- `orchestrator/docs/jsonl-log-schema.md` L84, `orchestrator/docs/architecture.md` L287, `orchestrator/docs/agents/project-manifest/api-surface.md` L55: `halted_wp_cancelled` rows.
- `orchestrator/docs/agents/project-manifest/decisions.md` L68+ (Not Adopted entry).
- Changelogs: `mcp-server/changelog.md` top v2.11.0 (`package.json` 2.11.0); `orchestrator/changelog.md` top v1.4.0 (`pyproject.toml` 1.4.0).

## Area: Tests

### Verified References
- `mcp-server/tests/tools/rework-circuit-breaker.test.ts` L47–L176 (start-pipeline breaker), L178+ (Developer P1).
- `mcp-server/tests/tools/start-pipeline-guards.test.ts` L196–L227 (§21.27), L300 (auto-cancelled excluded from rework detection), L316+ (per-type breaker).
- `mcp-server/tests/tools/workflow-next-action.test.ts` L297–L305 (PM P2 with seeded count), L366+ (P1 before P2).
- `mcp-server/tests/integration/full-workflow.test.ts` (end-to-end tool calls; dependency auto-unblock L944+).
- `orchestrator/tests/test_supervisor.py`:
  - L519–L625 `TestRouteToSynthesis`: `current_wp_id == ""` is already asserted in six tests, including `test_synthesis_all_terminal_clears_stale_wp_id` (L588) and `test_synthesis_all_wait_clears_stale_wp_id` (L605, halted variant).
  - L859–L1012 `TestHaltedWPCancellation`; L1060–L1110 `make_mcp_tools_with_actions` (static per-role responses); L1116–L1170 `TestDirectActionRouting` pins `("Project Manager", "REVIEW_REWORK_LIMIT", "pm")` (L1147); L1283–L1318 `TestAllRolesWait` (no `current_wp_id` assertion); L1320–L1350 skip variants.
- `orchestrator/tests/test_integration.py` L59+ `ScriptedLedger` (scripted states, derived next actions, stage stubs advance state); tests L343–L852.

### Structural Observations
- Item 3's requested assertions already exist for both synthesis routes; the doc note is stale. The non-halted all-WAIT path has no `current_wp_id` assertion.

## Area: Pending plans sharing spec numbering

### Verified References
- `docs/agents/plans/2026-10-06-p02-unfixable-verifier-chain-validation/plan.md`: spec 2.5.1 → 2.6.0, §21.72; manifest `spec_version` → 2.6.0; mcp-server v2.12.0; edits `operations.md` §9b.2, `pipeline-routing.md`, `data-model.md`, `edge-cases.md` (§21.55, §21.60, §21.63, §21.65–§21.67), `walkthrough.md` Appendix C, `README.md`; `constraints-workflow.md` entry "A Chain With a Verifier Stage…" (Enforcement paragraph); runs first.
- `docs/agents/plans/2026-09-22-p04-pipeline-stage-adjustment/plan.md`: as written claims 2.6.0 and §21.72 (to renumber after plans P02 and 03; expected 2.8.0 / §21.74); new §12.3c; moves `resetReworkCount` and others into new `work-package-admin.ts`; new `pm-role-guard.ts`; mcp-server minor bump; persona changes; root changelog.
- `docs/agents/plans/2026-10-06-p01-verifier-chain-prevention-personas/plan.md`: persona plan; states the existing rework limit ends unfixable loops.

## Strategic Context

- Strategic vision (ledger): the long-term secondary goal is to make the orchestrator headless workflow as reliable as possible. A run that cannot finish at the rework limit contradicts it directly.
- Insight `ea8cb364-186f-43e9-a007-33d5f009ff63` (orchestrator routing loop ended by an incorrect cancellation after 4+ cycles) matches the halted-sweep path observed here; it is not overtaken.
- Global insight `f213b2d6-b037-4d2b-baad-460a7ee5ed9b` (write gates should share the validation path of their sibling) argues for extracting the shared start-guard chain; weighed and rejected for scope in the plan.
- No stored insight claims the rework-limit path works, so none needs reconciliation.
