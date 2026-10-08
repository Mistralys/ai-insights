# Plan

## Plan Audit Cycles
- Audits: none — Plan Auditor v1.11.0
- Architectural Reviews: none — Plan Architect Reviewer v2.3.4

## Prior Project Context

The repository's long-term secondary goal is a reliable headless orchestrator workflow. The decision of 2026-10-06 (`constraints-workflow.md`, "A Chain With a Verifier Stage Must Include `implementation`") routes failures that cannot be fixed in scope to the existing rework limit (`BLOCK_FOR_REWORK_LIMIT`, then PM review). That makes the rework-limit path load-bearing for headless runs. Insight `ea8cb364-…` records an orchestrator loop that ran 4+ cycles before a WP was cancelled. This investigation shows that the halted-WP sweep was the only exit available, and why. The global insight `f213b2d6-…` (a write gate should share its sibling's validation path) was weighed for item 2 and rejected for scope (see Considered Alternatives).

**Plan P02 has landed (2026-10-08, `docs/agents/plans/2026-10-08-p02-unfixable-verifier-chain-validation/`).** It shipped spec v2.6.0 with §21.72, Hard Reject 5 (`findFailRoutingGaps()` in `mcp-server/src/utils/pipeline-maps.ts`) and mcp-server v2.12.0, which the STABLE ledger server already runs. Three consequences for this plan:

- The numbering this plan expected is confirmed: spec v2.7.0 / §21.73, mcp-server v2.13.0, orchestrator v1.5.0. The line references below were re-verified against the post-P02 tree.
- P02 kept every pre-v2.6.0 verifier-only chain working through the legacy-only `resolveFailAgent` fallback, and §21.72 says that self-loop is "bounded only by `MAX_REWORK_COUNT`". That bound is unreachable for the same reason as item 1, so this plan's fix is what makes §21.72 true. The plan now covers legacy chains explicitly (step 1, AC-12).
- P02's synthesis left four open topics. Each one is either addressed here (Human Actions, Deferred Items) or already carried by plan P04's sequencing note.

## Summary

This plan fixes three findings about how the rework limit behaves in a headless run.

**Item 1: a headless run does not finish cleanly at the rework limit.** Two defects stack.

- *The ledger's limit actions are unreachable.* `startPipeline` and `beginWork` increment the counter and then reject at `>= MAX_REWORK_COUNT`. The throw aborts the write, so a stored counter never passes 4. Every recommendation check needs 5, so `REWORK` keeps being emitted for a start that is always refused. Today, the only way out is the orchestrator's 3-consecutive-crash breaker: three wasted Developer stages, then the halted-WP sweep.
- *The orchestrator has no handling for `REVIEW_REWORK_LIMIT`.* If the limit were reached, the supervisor would dispatch the PM node, whose prompt and persona only know how to decompose a plan. Spec §16.3c assigns this cancellation to the orchestrator.

The fix:

- The ledger persists the counter on the refused start, so the limit becomes visible.
- `REVIEW_REWORK_LIMIT` names the stage and count.
- The supervisor cancels the WP itself per §16.3c and re-polls the PM.

**Item 2: `ledger_begin_work` disagrees with `ledger_start_pipeline`.** It reads auto-cancelled prerequisite runs, which spec §21.27 forbids. This plan aligns it, adds a parity suite and removes the gotcha notes.

**Item 3: stale documentation, not a missing test.** The requested `current_wp_id` assertions already exist for both synthesis routes. This plan removes the stale note and adds the one missing variant: the non-halted all-WAIT path.

Spec edits take the next free numbers after plan P02, which has landed v2.6.0 and §21.72: this plan writes v2.7.0 and §21.73. The fix also closes the limit for legacy verifier-only chains that P02 left running through the `resolveFailAgent` fallback.

## Architectural Context

- **Ledger start paths.** `startPipeline` (`mcp-server/src/tools/pipeline.ts`) and `beginWork` (`mcp-server/src/tools/begin-work.ts`) each run the guard chain inside one `LedgerStore.updateWorkPackageWithSync` call (`mcp-server/src/storage/ledger-store.ts` L360–L398). A throw aborts the write. `beginWork` adds a claim phase for READY WPs and captures `claimed` outside the updater.
- **Recommendation engine.** `mcp-server/src/tools/workflow-next-action.ts`: per-role functions return the first actionable WP. Limit actions are PM P2 `REVIEW_REWORK_LIMIT` (L381–L398), owner P1 `BLOCK_FOR_REWORK_LIMIT` and downstream P1b `WAIT_FOR_UPSTREAM_REWORK_LIMIT`. They all test the stored counter against `MAX_REWORK_COUNT` (5, `shared/workflow-manifest.json`).
- **Synthesis guard.** `completeSynthesis` (`mcp-server/src/tools/project-lifecycle.ts` L821–L888) requires every WP terminal. CANCELLED counts as terminal, and a cancellation unblocks dependents (`work-package.ts` L940).
- **Orchestrator supervisor.** `orchestrator/src/supervisor.py` polls `ledger_get_next_action` for each role in manifest order. The PM is polled first, and the first dispatchable action wins. It also has a local breaker: 3 consecutive stage crashes skip a WP (L584–L614). On the all-roles-WAIT fall-through, halted WPs are cancelled and the run goes straight to synthesis (L673–L741).
- **Stage nodes.** In `orchestrator/src/nodes/__init__.py`, a ledger tool refusal raises `ToolException` (langchain-mcp-adapters, no `handle_tool_error`), which aborts the stage. `_handle_rollback` then auto-cancels any in-progress pipeline (L601–L687).
- **Specification.** `mcp-server/docs/agents/workflow-specification/` is authoritative. It covers §11.1 (start guards), §14.1.2 (PM priorities), §16.3 / §16.3c (circuit breaker; headless orchestrators SHOULD log and cancel at `REVIEW_REWORK_LIMIT`) and §21.27 (auto-cancelled exclusion).

### Item 1: traced outcome today (`max_rework_count` = 5)

1. Four reworks run. Each start increments `rework_counts.implementation` (1 … 4) and writes it (`pipeline.ts` L221–L235, `begin-work.ts` L198–L209).
2. The verifier FAILs a fifth time. The PM has no P2 action, because 4 < 5 (`workflow-next-action.ts` L384–L386). The Developer gets `REWORK` (L627–L676), and the supervisor dispatches the developer node.
3. The agent calls `ledger_begin_work`. The counter goes to 5 and Guard 5 throws (`begin-work.ts` L211–L218), so nothing is written: the counter stays 4. The `isError` result raises `ToolException` and the stage crashes. `_handle_rollback` finds no in-progress pipeline to cancel (warning), `stage_success` is False, and an `errors` entry is added.
4. Steps 2–3 repeat until `consecutive_failures[WP] == 3` (`supervisor.py` L210–L224). Each repeat costs one LLM stage.
5. From then on, every iteration logs `halted_repeated_failure` and adds an `errors` entry (L584–L614). The loop moves to the *next role*. The Developer role keeps returning the halted WP first, so any other WP that needs the Developer is starved.
6. When every role returns WAIT or skip, the sweep cancels the WP and routes **directly** to synthesis (L673–L741):
   - Dependents that the cancellation just unblocked never run. Neither do the starved READY WPs.
   - The Synthesis agent gets `WAIT` ("Not all work packages are COMPLETE", `workflow-next-action.ts` L329–L345), so no synthesis is generated.
   - If nothing else is pending, synthesis succeeds.
7. Either way, the CLI reports "COMPLETED WITH ERRORS" and exits 1 (`cli.py` L536–L569).

`BLOCK_FOR_REWORK_LIMIT`, `WAIT_FOR_UPSTREAM_REWORK_LIMIT` and `REVIEW_REWORK_LIMIT` never fire from tool-driven state. Every existing limit test seeds the counter at 5 directly.

**Counterfactual: if the counter did reach 5.** The PM's P2 `REVIEW_REWORK_LIMIT` would be dispatched to the PM node (`_DISPATCH_ACTIONS`, L66–L83).

- `_build_pm_prompt` (`nodes/pm.py`) sends only the plan. The PM persona (`personas/ledger/src/content/2-project-manager.md` L96–L207) has no `REVIEW_REWORK_LIMIT` handling and would re-run the decomposition workflow.
- An agent that finishes without raising resets the breaker, so the PM would be re-dispatched every iteration until `MAX_ITERATIONS` (100), ending in a safety-limit stop with exit 2.

So fixing only the ledger would make the outcome worse, and the two halves must ship together.

## Approach / Architecture

### Item 1a: make the limit visible in the ledger (refused start persists the counter)

When a start detects a rework and the incremented counter reaches `MAX_REWORK_COUNT` while the stored value is below it, the call still fails with the existing circuit-breaker error. It now also writes the incremented counter (and, for `beginWork`, the claim it already applied), but it appends no pipeline and changes no `assigned_to` beyond the claim. Once the stored counter is `>= MAX_REWORK_COUNT`, any further refusal writes nothing, as today. Both start paths use the existing "capture outside the updater" pattern (`claimed` in `begin-work.ts`): the updater records the breaker message and returns `{ wp, root }`, and the handler returns the `isError` result after the lock releases.

Effect: a stored counter of 5 now means "a rework of this stage was needed and refused". The existing recommendation checks become correct without change:

- the stage owner gets `BLOCK_FOR_REWORK_LIMIT`;
- downstream stages get `WAIT_FOR_UPSTREAM_REWORK_LIMIT`;
- the PM gets `REVIEW_REWORK_LIMIT`.

The fix is keyed on the pipeline type, not on implementation, so it also applies to legacy verifier-only chains (§21.72). On a pre-v2.6.0 `["qa", "code-review"]` WP, each QA restart after a QA FAIL is a direct rework of `qa`. The refused fifth QA start now persists `rework_counts.qa = 5`, after which QA gets `BLOCK_FOR_REWORK_LIMIT`, the Reviewer gets `WAIT_FOR_UPSTREAM_REWORK_LIMIT`, and the PM gets `REVIEW_REWORK_LIMIT` with `pipeline_type: "qa"`. No legacy-specific code is needed.

The number of reworks that actually run is unchanged (4). `REVIEW_REWORK_LIMIT` additionally carries `pipeline_type`, `rework_count` and `max_rework_count`, matching the Developer P1 payload, so an orchestrator can log what spec §16.3c asks for.

### Item 1b: the supervisor implements spec §16.3c

In the role loop, when the Project Manager role returns `REVIEW_REWORK_LIMIT`, the supervisor never dispatches the PM node. It handles the action in three steps:

1. **Cancel the WP.** It calls `ledger_update_work_package_status(work_package_id, status="CANCELLED", agent="Project Manager")`, the same call shape the halted sweep uses. The ledger auto-cancels any running pipeline and unblocks dependents.
2. **Log the cancellation.** It logs a `rework_limit_wp_cancelled` entry (level WARNING) with `wp_id`, `pipeline_type`, `rework_count`, `max_rework_count` and `reason`. This is an accepted outcome, so it adds no `errors` entry.
3. **Re-query the Project Manager role.** The PM's next answer goes through the same rules. A second limited WP is cancelled too. Any other PM action dispatches normally, and a skip action moves on to the Developer.

Guards and precedence:

- **Failed cancellation.** If the ledger rejects the cancellation, or `REVIEW_REWORK_LIMIT` names a WP already cancelled in this iteration, the supervisor logs `rework_limit_cancel_failed` (level ERROR), adds an `errors` entry and treats the PM role as skipped for this iteration. The PM node is never dispatched for this action.
- **Precedence over the halt.** The handling runs before the consecutive-failure check, so a limited WP is cancelled even if it is also halted.

**Result.** After the fix, a limited WP becomes CANCELLED in the iteration right after its refused start. Its dependents run in the same run, `completeSynthesis` passes once everything else is terminal, and the run reaches synthesis.

**Exit status.** The CLI still exits 1, because the refused start surfaced as one developer stage error. This follows `decisions.md`: no new exit code, terminal-only predicate kept.

### Item 2: align `beginWork` with `startPipeline`

In `begin-work.ts` Guard 3, the prerequisite lookup gains `&& !p.auto_cancelled`, as prescribed by spec §21.27 and as `startPipeline` already does. The spec's §11.1 pseudocode line, which lacks the filter, is corrected to match §21.27. A parity test suite runs the same scenarios through both tools.

### Item 3: synthesis-route `current_wp_id`

The investigation confirms that both synthesis routes set `current_wp_id: ""` (`supervisor.py` L534, L736) and that tests already assert it, including with a stale value (`test_supervisor.py` L588, L605). The plan removes the stale "Test coverage gap (known)" note. It also extends the non-halted all-WAIT test with a stale `current_wp_id`, which is the one variant not yet asserted. Item 1 needs no change to the value.

## Rationale

- **Persist-on-refusal reuses every existing check.** The recommendation engine, the PM P2 loop, the per-role P1/P1b checks and their tests stay as they are. The refused call is the only moment the ledger learns that a needed rework cannot run. Recording it then makes the stored state honest without predicting future reworks.
- **The supervisor, not the PM persona, cancels.** Spec §16.3c assigns the action to the orchestrator. The supervisor is deterministic (orchestrator `constraints.md` §4), and the same call shape already exists in the halted sweep. Sending a decision with one correct answer to an LLM would add cost and non-determinism, and persona work is out of scope.
- **Re-polling the PM instead of moving on.** If the loop just continued to the Developer after a cancellation, the PM's lower-priority actions for this iteration would be hidden. The all-WAIT fall-through could then route to synthesis while a second limited WP is still IN_PROGRESS. A bounded re-poll removes that case and adds no new route.
- **Item 2 is a one-line alignment plus a parity suite.** The spec already settles which behaviour is right (§21.27). The parity suite is what keeps the two copies from drifting again.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Making the limit reachable | Refused start persists the counter (no pipeline), then rejects | (a) Predictive predicate in the engine: "count = MAX−1 and a rework is pending"; (b) check the pre-increment count, so a 5th rework runs and the counter reaches 5 | (a) `hasDownstreamFail` stays true while a rework is in flight and after it PASSes, so it would block re-verification of the 4th rework unless every role reproduced the Developer's re-engagement logic. (b) Flags the WP while the 5th rework is still running, preempts `CONTINUE_PIPELINE`, and leaves the 5th rework unverified (P1b). Persist-on-refusal changes two handlers and no engine code. |
| Who resolves `REVIEW_REWORK_LIMIT` headlessly | Supervisor cancels (spec §16.3c) | Teach the PM persona to cancel; route the PM node with an action-aware prompt | Persona work is out of scope and non-deterministic. The spec assigns the action to the orchestrator. |
| After a supervisor cancellation | Re-poll the PM role in place | Continue with the next role; self-route the supervisor back to itself | Continuing can mask PM actions and fall through to synthesis with a second limited WP still pending. A self-route adds a new graph edge, which the user ruled out. |
| Recording the cancellation reason in the ledger | JSONL log entry only; the WP's own record (`rework_counts` at max, FAIL history) is the ledger evidence | Add a project comment via `ledger_add_project_comment` | A comment is a new behaviour beyond §16.3c's "log". The evidence is already in the WP detail. |
| Exit code for a run that cancelled a WP at the limit | Unchanged (1, from the refused start's stage error) | New exit code / sidecar result | Rejected by `decisions.md` ("Not Adopted: Settled-but-Not-Terminal WPs"). The GUI reads any non-SUCCESS result as ERROR. |
| Start-path alignment | One-line filter in `beginWork` + a parity suite over both tools | Extract the shared guard chain into one helper (insight `f213b2d6-…`) | Extraction is the durable shape but a refactor beyond the defect. The user asked for tight scope. The parity suite pins equivalence in the meantime. |

## Pattern Alignment

- Follows capture-outside-the-updater for post-lock results (`claimed`, `mcp-server/src/tools/begin-work.ts` L71/L120/L245).
- Follows the limit-payload shape (`rework_count`, `max_rework_count`) of Developer P1 (`workflow-next-action.ts` L586–L593) for PM P2.
- Follows supervisor-side cancellation with a WARNING log entry (`halted_wp_cancelled`, `orchestrator/src/supervisor.py` L686–L720), including the `agent="Project Manager"` argument.
- Follows spec-first ordering and per-version spec changelog entries (root `AGENTS.md`, "Change workflow logic").
- Deliberate departure: a tool call that returns `isError` now also writes a counter. No other ledger tool writes on rejection. This is justified because the refusal itself is the only event that establishes the limit (spec §16.3), and the write is idempotent once the limit is stored.

## Structural Improvements

| Structure | Observation | Decision | Reason |
|-----------|-------------|----------|--------|
| `mcp-server/src/tools/pipeline.ts` L237–L246 and `begin-work.ts` L211–L218 circuit breaker | The increment that reaches the limit is never persisted, so the limit actions are unreachable | Promoted to step 3 | This is the defect itself. |
| `mcp-server/src/tools/workflow-next-action.ts` L381–L398 PM P2 payload | Names the stage only inside `reason` | Promoted to step 4 | Spec §16.3c asks orchestrators to log the type and count. |
| `orchestrator/src/supervisor.py` `_DISPATCH_ACTIONS` / role loop | `REVIEW_REWORK_LIMIT` dispatches the plan-only PM node | Promoted to step 7 | This is the defect itself. |
| `begin-work.ts` L174–L184 Guard 3 | Prerequisite lookup reads auto-cancelled runs | Promoted to step 5 | This is the defect itself. |
| `begin-work.ts` / `pipeline.ts` duplicated guard chain | Two copies of Guards 1–5 | Rejected | A refactor beyond the defect; the user asked for tight scope. The parity suite (step 6) pins equivalence. |
| `orchestrator/src/supervisor.py` L673–L741 halted sweep | Routes straight to synthesis after cancelling, so unblocked dependents and starved WPs never run | Rejected (deferred) | After step 7, the rework-limit path no longer goes through the sweep. The remaining defect affects crash-halted WPs only, which is outside the three items. Recorded in Deferred Items. |
| `mcp-server/docs/agents/workflow-specification/operations.md` §11.1 prerequisite line | Contradicts §21.27 | Promoted to step 1 | The spec must state the rule the code is aligned to. |
| `mcp-server/docs/agents/workflow-specification/edge-cases.md` §21.72 "Legacy-WP treatment" (plan P02) | States the legacy self-loop is bounded by `MAX_REWORK_COUNT`, which no tool-driven state reaches today | Promoted to step 1 | This plan makes the statement true. A cross-reference to §21.73 keeps the two sections consistent. |
| `orchestrator/docs/supervisor-routing.md` L68 | Stale "Test coverage gap (known)" note | Promoted to step 10 | Item 3 outcome. |

## Detailed Steps

1. **Revise the workflow specification first** (`mcp-server/docs/agents/workflow-specification/`). Take the version and section numbers by the rule in Dependencies; the expected values are v2.7.0 and §21.73.
   - `operations.md` §11.1:
     - Prerequisite guard (L458–L462): filter `NOT p.auto_cancelled`, citing §21.27.
     - Circuit breaker (L528–L540): when the incremented count reaches `MAX_REWORK_COUNT` and the stored count was below it, persist `rework_counts` (and the claim, for `ledger_begin_work`). Create no pipeline. Return the error. When the stored count is already at or above the maximum, reject without writing.
     - Add one sentence stating that `ledger_begin_work` applies this guard chain after its claim phase.
   - `dependencies-and-rework.md`:
     - §16.3: state that `MAX_REWORK_COUNT − 1` reworks run, that the start which would be the `MAX`-th rework is refused and recorded, and that the recommendation actions fire from then on.
     - §16.3c: the orchestrator handles `REVIEW_REWORK_LIMIT` itself. It cancels with `agent_role "Project Manager"`, logs the type and count from the payload, and re-queries the PM in the same routing pass. Dependents unblocked by the cancellation continue in the same run. The PM node is never dispatched for this action.
   - `recommendations.md` §14.1.2: the P2 output carries `pipeline_type`, `rework_count` and `max_rework_count`. Update the pseudocode at L62–L63.
   - `edge-cases.md`:
     - Add **§21.73 Rework Limit Reached Through a Refused Start**. It covers:
       - the former unreachable limit (post-increment check with an aborted write);
       - the persisted counter and its idempotence;
       - claim persistence for READY WPs, so P1/P2 see an IN_PROGRESS WP;
       - unchanged rework capacity;
       - headless resolution per §16.3c;
       - legacy verifier-only chains (§21.72): the same trip on `rework_counts.qa` (or the verifier's own type) ends the self-loop.
     - Amend §21.27 so the prerequisite bullet names both `startPipeline` and `ledger_begin_work`.
     - Check §21.53 (L453–L457, "reaches `MAX_REWORK_COUNT` (5)") still reads correctly.
     - In §21.72 "Legacy-WP treatment", add one sentence pointing to §21.73: the `MAX_REWORK_COUNT` bound on a legacy self-loop is reached through the refused start. Leave the rest of §21.72 and the legacy-only markers on §21.63, §21.66 and §21.67 unchanged.
   - `walkthrough.md` L142: clarify "Maximum rework cycles before circuit breaker" (the `MAX`-th rework start is refused).
   - `README.md`: version, the execution date, and a changelog entry above `v2.6.0 - Fail-Route Coverage Validation` naming §11.1, §14.1.2, §16.3, §16.3c, §21.27, §21.72 and the new §21.73.
2. **Align the manifest version.** Set `shared/workflow-manifest.json` `spec_version` to the version written in step 1.
3. **Persist the counter on a refused start** in `mcp-server/src/tools/pipeline.ts` (step 6b) and `mcp-server/src/tools/begin-work.ts` (Guard 5), per Approach 1a:
   - Inside the updater: record the breaker message in a variable declared outside it. Skip the pipeline append and the `assigned_to` update. Set `root.last_updated`, and return `{ wp, root }` only when the stored count was below the maximum. When it was already at or above the maximum, throw as today (no write).
   - After `updateWorkPackageWithSync`, return the existing error text as an `isError` result.
   - Update the L237–L239 comment in `pipeline.ts` to describe the persisted trip.
4. **Extend the PM P2 payload** in `getProjectManagerAction` (`workflow-next-action.ts` L381–L398) with `pipeline_type` (the counter's key), `rework_count` and `max_rework_count`. Leave the priority logic unchanged.
5. **Align the `beginWork` prerequisite lookup** (`begin-work.ts` L177): add `&& !p.auto_cancelled`.
6. **Ledger tests** per the Test Plan (new `mcp-server/tests/tools/start-path-parity.test.ts`, new `mcp-server/tests/integration/rework-limit.test.ts`, plus extensions). Run `npm test` and `npm run build` in `mcp-server/`.
7. **Supervisor handling of `REVIEW_REWORK_LIMIT`** in `orchestrator/src/supervisor.py`, per Approach 1b:
   - Remove `REVIEW_REWORK_LIMIT` from `_DISPATCH_ACTIONS`.
   - Handle it in the role loop for the Project Manager role, ahead of the skip, unknown-action and consecutive-failure checks.
   - On success: cancel, emit `rework_limit_wp_cancelled`, re-query the PM. Track cancelled IDs for this iteration to bound the loop.
   - On failure: emit `rework_limit_cancel_failed` with an `errors` entry and move on to the next role.
   - Include the new entries in the returned `run_log` on every exit path of the iteration (dispatch and fall-through).
8. **Orchestrator tests** per the Test Plan (`orchestrator/tests/test_supervisor.py`, `orchestrator/tests/test_integration.py`). Run `pytest` and `ruff check` in `orchestrator/`.
9. **MCP manifest and tool help.**
   - `mcp-server/docs/agents/project-manifest/constraints-workflow.md`:
     - "Pipelines Can Only Be Started for an Active Stage": delete the divergence paragraph (L370) and replace it with a pointer to `tests/tools/start-path-parity.test.ts` as the parity guard.
     - "Rework Count Increments on Pipeline Retry": rewrite the circuit-breaker paragraph (L488) for the persisted trip and the limit actions.
     - "A Chain With a Verifier Stage Must Include `implementation`": rewrite "Unfixable failures" to describe the working path (refused start → limit actions → PM review, which headless orchestrators perform by cancelling). In "Why the chain cannot recover (legacy chains only — see Enforcement below)", reword the last bullet ("until its `rework_counts` entry reaches `MAX_REWORK_COUNT`") so it says the refused start records the limit (§21.73). Leave plan P02's "Enforcement (v2.6.0)" paragraph and the heading as they are. Locate by heading.
   - `api-surface.md`:
     - L421 and L443–L445: describe the persisted trip for both tools.
     - L6578: list the PM P2 payload fields.
     - Note the `beginWork` prerequisite exclusion.
   - `data-flows.md` Flow 4: step 3 states the auto-cancelled exclusion and that `ledger_begin_work` runs the same check. Step 5 describes the persisted trip.
   - `mcp-server/src/tools/help-content.ts` L292 and the `ledger_start_pipeline` entry: describe the refused start that records the limit.
10. **Orchestrator docs.**
    - `orchestrator/docs/supervisor-routing.md`:
      - Update the routing table (L56): `REVIEW_REWORK_LIMIT` is handled by the supervisor.
      - Add a "Rework-Limit Cancellation (spec §16.3c)" subsection.
      - Rewrite the last sentence of the halted-WP paragraph (L89).
      - Delete the stale note (L68).
    - `orchestrator/docs/jsonl-log-schema.md`, `orchestrator/docs/architecture.md`, `orchestrator/docs/agents/project-manifest/api-surface.md`: add the `rework_limit_wp_cancelled` and `rework_limit_cancel_failed` rows next to `halted_wp_cancelled`.
    - `orchestrator/docs/agents/project-manifest/decisions.md` ("Not Adopted: Settled-but-Not-Terminal WPs at Synthesis"): add a Consequences bullet stating that the rework limit ends in CANCELLED through the supervisor's §16.3c handling, which keeps the terminal-only predicate and the 0/1/2 exit codes. Add `supervisor-routing.md` § Rework-Limit Cancellation to References.
11. **Release preparation.**
    - `mcp-server/changelog.md`: add an entry under the next free minor version (v2.13.0, after plan P02's v2.12.0, now the topmost entry) in house style:
      - the refused start records the limit;
      - the PM review payload names the stage and count;
      - `ledger_begin_work` ignores auto-cancelled prerequisite runs;
      - spec realigned.
    - Run `npm run sync-version` in `mcp-server/`.
    - `orchestrator/changelog.md` + `orchestrator/pyproject.toml`: next minor (v1.5.0; the current version is 1.4.0). The supervisor cancels rework-limited WPs per spec §16.3c instead of dispatching the PM.
    - Run `node scripts/check-version-sync.js` from the workspace root.
12. **Regenerate derived documents** last: `node scripts/bundle-docs.js` and `node scripts/cli.js ctx-generate`.

## Dependencies

- Step 1 precedes steps 3–10 (spec first). Step 2 follows step 1.
- Steps 3–5 precede step 6. Step 4 precedes step 7 (the supervisor reads the payload fields, but must tolerate their absence for older servers).
- Steps 3 and 7 must land in the same run. Step 3 alone makes `REVIEW_REWORK_LIMIT` reachable, and without step 7 it would dispatch the plan-only PM node in a loop.
- Step 12 runs last.
- **Plan order (numbered folders, amended 2026-10-08):** `2026-10-06-p01-verifier-chain-prevention-personas` (personas, deployed) and `2026-10-08-p02-unfixable-verifier-chain-validation` (COMPLETE 2026-10-08), then this plan (P03), then `2026-09-22-p04-pipeline-stage-adjustment`, then `2026-10-06-p05-headless-pm-review-actions` (which generalises this plan's supervisor intercept). This plan was moved ahead of 09-22: the accepted-failure path it repairs is a precondition of plan P02's decision, while 09-22 is a new capability. This plan has no code dependency on either neighbour. They share spec and version numbering only.
- **Numbering rule:** at execution time, read the spec `README.md` version and the highest `### 21.N` in `edge-cases.md`. Take the next minor version and `§21.(N+1)`. Re-verified after plan P02 (2026-10-08): the spec is at v2.6.0 and the highest section is §21.72, so this plan writes v2.7.0 and §21.73. P04 then takes the next numbers, as its own sequencing note already instructs. Apply the same rule to the mcp-server version (2.12.0 → v2.13.0) and the orchestrator version (1.4.0 → v1.5.0).

## Required Components

- Spec: `mcp-server/docs/agents/workflow-specification/operations.md`, `dependencies-and-rework.md`, `recommendations.md`, `edge-cases.md`, `walkthrough.md`, `README.md`
- `shared/workflow-manifest.json`
- `mcp-server/src/tools/pipeline.ts`, `mcp-server/src/tools/begin-work.ts`, `mcp-server/src/tools/workflow-next-action.ts`, `mcp-server/src/tools/help-content.ts`
- Tests (existing): `mcp-server/tests/tools/rework-circuit-breaker.test.ts`, `start-pipeline-guards.test.ts`, `begin-work.test.ts`, `workflow-next-action.test.ts`
- Tests (new): `mcp-server/tests/tools/start-path-parity.test.ts`, `mcp-server/tests/integration/rework-limit.test.ts`
- `orchestrator/src/supervisor.py`; tests `orchestrator/tests/test_supervisor.py`, `orchestrator/tests/test_integration.py`
- Docs: `mcp-server/docs/agents/project-manifest/constraints-workflow.md`, `api-surface.md`, `data-flows.md`; `orchestrator/docs/supervisor-routing.md`, `jsonl-log-schema.md`, `architecture.md`, `orchestrator/docs/agents/project-manifest/api-surface.md`, `decisions.md`
- Versions: `mcp-server/changelog.md`, `mcp-server/package.json`, `orchestrator/changelog.md`, `orchestrator/pyproject.toml`
- Regenerated: `build/workflow-specification.md`, `.context/`

## Assumptions

- The orchestrator spawns its MCP server from `mcp-server/dist/` (`MCP_SERVER_CMD`), and `scripts/run-orchestrator.js` rebuilds `dist/` when stale. So steps 3 and 7 reach headless runs together.
- Plan P02's changes are in the tree this plan runs on (spec v2.6.0, §21.72, mcp-server v2.12.0). Where Human Action 1 was skipped they sit uncommitted beside this plan's changes, which only affects how the diffs separate.
- A refused ledger start keeps surfacing as a stage crash (`ToolException`). The plan relies on that only for the exit-code statement, not for correctness.
- The ledger keeps emitting `REVIEW_REWORK_LIMIT` only for IN_PROGRESS WPs (P2). If an agent sets a limited WP to BLOCKED with a non-dependency blocker, P1 `UNBLOCK_WP` would take precedence. Headless agents cannot do this after a refused start, because the stage aborts at the refusal.

## Constraints

- No new mechanisms: no new graph edge, exit code, WP status or ledger tool.
- No change to the number of reworks that run, to recommendation priorities, or to the halted-WP sweep.
- Generated docs are regenerated, never hand-edited. `docs/references/agents-overview.md` is ignored.

## Out of Scope

- Persona changes. These are follow-ups for the Persona Curator:
  - (a) PM persona (`personas/ledger/src/content/2-project-manager.md`): handling for `REVIEW_REWORK_LIMIT` (IDE flows: cancel or `ledger_reset_rework_count`), `UNBLOCK_WP`, `REVIEW_STALE`, `REVIEW_ABANDONED` and `REPAIR_ORPHAN_BLOCKED`. The headless side of the four other actions is planned in `docs/agents/plans/2026-10-06-p05-headless-pm-review-actions/`. The IDE persona side remains a Persona Curator follow-up.
  - (b) Pipeline-agent personas: on `BLOCK_FOR_REWORK_LIMIT`, stop and hand off; do not try to cancel, since that is PM-only.
  - (c) Synthesis persona (`9-synthesis.md`): report cancelled WPs and the reason (spec §16.3c step 3).
- The halted-WP sweep's direct synthesis route (see Deferred Items).
- Extracting a shared start-guard helper.
- Editing the other pending plans (P04, P05).
- Retiring the legacy-only `resolveFailAgent` fallback (see Deferred Items).
- `docs/references/agents-overview.md`.

## Human Actions

| # | Action | When | Why an agent cannot do it |
|---|--------|------|---------------------------|
| 1 | Commit plan P02's uncommitted changes, and decide on the other working-tree changes P02 flagged (the deleted `2026-10-06-p02-…` folder, `personas/name-mapping.json`), so this plan's diff starts from a clean tree | Before the run | The user manages version control; agents never run Git write commands. |
| 2 | Rebuild and restart the STABLE Ledger MCP server so IDE sessions pick up the persisted trip and the new payload | After the run | The server backs the user's live agent sessions; restarting it is the user's call. |

## Acceptance Criteria

- AC-01: A rework start that would reach `MAX_REWORK_COUNT` is rejected with the existing circuit-breaker error by both `ledger_start_pipeline` and `ledger_begin_work`. It persists `rework_counts[type] = MAX_REWORK_COUNT`, appends no pipeline and leaves `assigned_to` unchanged. On a READY WP, `ledger_begin_work` also persists the claim. A further refused start writes nothing.
- AC-02: Driven only by tool calls (no seeded counters), a WP whose QA fails after four implementation reworks yields these actions after the refused fifth start:
  - Developer: `BLOCK_FOR_REWORK_LIMIT`.
  - QA: `WAIT_FOR_UPSTREAM_REWORK_LIMIT`.
  - Project Manager: `REVIEW_REWORK_LIMIT`, with `pipeline_type: "implementation"`, `rework_count: 5`, `max_rework_count: 5`.
- AC-03: After `ledger_update_work_package_status(CANCELLED, "Project Manager")` on that WP, its dependent becomes READY. Once the dependent is COMPLETE, `ledger_complete_synthesis` succeeds and the project is COMPLETE.
- AC-04: The supervisor never routes to `pm` for `REVIEW_REWORK_LIMIT`. It calls `ledger_update_work_package_status` with `status="CANCELLED"` and `agent="Project Manager"`, and logs `rework_limit_wp_cancelled` at WARNING with the payload fields. It adds no `errors` entry.
- AC-05: After a cancellation the supervisor re-queries the PM:
  - A second limited WP is cancelled in the same iteration.
  - A following PM action dispatches normally.
  - A failed cancellation, or a repeated WP, logs `rework_limit_cancel_failed` with an `errors` entry, does not dispatch `pm`, and moves on to the next role.
  - A limited WP with 3 consecutive failures is still cancelled.
- AC-06: In a scripted end-to-end orchestrator run, a WP reaching the limit ends CANCELLED. Its dependent runs afterwards, the synthesis node executes, and the PM node does not execute after the limit.
- AC-07: `ledger_begin_work` starts QA on a WP whose pipelines are `[implementation PASS, implementation FAIL (auto_cancelled)]`. A parity suite shows both start tools give the same accept/reject outcome and the same persisted `rework_counts` across the prerequisite and circuit-breaker scenarios.
- AC-08: Both synthesis routes clear a stale `current_wp_id`, including the non-halted all-WAIT path. The "Test coverage gap (known)" note is gone from `orchestrator/docs/supervisor-routing.md`.
- AC-09: The spec carries the new version and §21.73 (or the numbers assigned by the rule), with §11.1, §14.1.2, §16.3, §16.3c and §21.27 updated. `shared/workflow-manifest.json` `spec_version` matches.
- AC-10: The `auto_cancelled` divergence notes are gone from `constraints-workflow.md`, and `data-flows.md` Flow 4 states the exclusion. Manifest docs, tool help and orchestrator docs (including `decisions.md`) describe the new behaviour.
- AC-11: Changelogs and package versions agree (`check-version-sync.js`). `npm test` and `npm run build` pass in `mcp-server/`, `pytest` and `ruff check` pass in `orchestrator/`, and the derived docs are regenerated.
- AC-12: On a legacy `["qa", "code-review"]` WP seeded directly in storage (as created before v2.6.0) and driven by tool calls through four QA self-reworks, the refused fifth QA start persists `rework_counts.qa = 5`. QA then gets `BLOCK_FOR_REWORK_LIMIT`, the Reviewer gets `WAIT_FOR_UPSTREAM_REWORK_LIMIT`, and the PM gets `REVIEW_REWORK_LIMIT` with `pipeline_type: "qa"`. §21.72 cross-references §21.73.

## Testing Strategy

On the ledger side, unit tests pin the persisted trip on both start tools. A parity suite runs identical scenarios through both tools. A tool-driven integration test walks a WP to the limit without seeding counters, which existing tests never did, and then on to synthesis. On the orchestrator side, supervisor unit tests use sequenced mock responses to cover cancellation, re-polling, failure and precedence. A `ScriptedLedger` integration run proves the graph reaches synthesis. The existing seeded-count tests stay as regression cover for the unchanged recommendation checks.

## Test Plan

- `mcp-server/tests/tools/rework-circuit-breaker.test.ts`:
  - "rejects pipeline start when rework_counts.implementation reaches MAX via increment": additionally asserts the stored counter is `MAX_REWORK_COUNT`, `pipelines` is unchanged and `assigned_to` is unchanged — AC-01.
  - "rejects when … already at MAX": asserts the WP file is not rewritten (`last_updated` unchanged) — AC-01.
- `mcp-server/tests/tools/begin-work.test.ts`, new describe "circuit breaker persists the trip":
  - IN_PROGRESS WP at `MAX−1` with an implementation FAIL → `isError`, counter `MAX`, no pipeline — AC-01.
  - READY WP with FAIL history at `MAX−1` → `isError`, WP IN_PROGRESS and claimed, counter `MAX` — AC-01.
- `mcp-server/tests/tools/begin-work.test.ts`, new describe "auto-cancelled prerequisite (§21.27)":
  - `[impl PASS, impl FAIL auto_cancelled]` → `begin_work(qa)` succeeds — AC-07.
  - `[impl PASS, impl FAIL]` (genuine) → rejected with "requires a PASS 'implementation'" — AC-07.
- `mcp-server/tests/tools/start-path-parity.test.ts` (new): table-driven. Each scenario runs once through `pipeline.ts` `_internal.startPipeline` and once through `begin-work.ts` `_internal.beginWork` on an IN_PROGRESS WP. Asserts equal `isError` and equal persisted `rework_counts` for:
  - the auto-cancelled prerequisite;
  - a genuine FAIL prerequisite;
  - an auto-cancelled same-type run not counted as rework;
  - a trip at `MAX−1`;
  - a WP already at `MAX`.
  Covers AC-07 and AC-01.
- `mcp-server/tests/tools/workflow-next-action.test.ts`: the existing P2 case (L297–L305) also asserts `pipeline_type: "qa"`, `rework_count` and `max_rework_count` — AC-02.
- `mcp-server/tests/integration/rework-limit.test.ts` (new), using only real tool calls:
  - **Setup:** `WP-001` (`implementation, qa`) and `WP-002` (`implementation`), with `WP-002` depending on `WP-001`.
  - **Reworks:** four cycles of implementation PASS / QA FAIL, then the fifth `ledger_begin_work` is refused.
  - **Limit actions:** asserts Developer `BLOCK_FOR_REWORK_LIMIT`, QA `WAIT_FOR_UPSTREAM_REWORK_LIMIT` and PM `REVIEW_REWORK_LIMIT` with the payload fields — AC-02.
  - **Cancel to synthesis:** the PM cancels `WP-001`, `WP-002` becomes READY and is completed, and `ledger_complete_synthesis` succeeds with the project COMPLETE — AC-03.
  - **Legacy verifier-only chain:** a second `describe` seeds `WP-001` with `active_pipeline_stages: ["qa", "code-review"]` through `store.writeWorkPackage` (as `tests/tools/workflow-next-action.test.ts` L48 does), since `ledger_create_work_package` now rejects that chain. It drives four QA FAIL / `ledger_begin_work(qa)` cycles, asserts the fifth start is refused with `rework_counts.qa === 5` persisted, and asserts QA `BLOCK_FOR_REWORK_LIMIT`, Reviewer `WAIT_FOR_UPSTREAM_REWORK_LIMIT` and PM `REVIEW_REWORK_LIMIT` with `pipeline_type: "qa"` — AC-12.
- `orchestrator/tests/test_supervisor.py`:
  - `TestDirectActionRouting`: remove the `("Project Manager", "REVIEW_REWORK_LIMIT", "pm")` parameter — AC-04.
  - New `TestReworkLimitCancellation` (PM responses sequenced via `side_effect`; `ledger_update_work_package_status` mock records calls):
    - `test_cancels_and_does_not_route_to_pm` — AC-04
    - `test_cancellation_logged_as_warning_with_payload_fields_not_in_errors` — AC-04
    - `test_repolls_pm_and_dispatches_following_action` (second response `ROUTE_PIPELINE_AGENT`, `next_agent` QA → `goto == "qa"`) — AC-05
    - `test_two_limited_wps_cancelled_in_one_iteration` — AC-05
    - `test_cancel_failure_logs_error_and_skips_pm` — AC-05
    - `test_same_wp_returned_after_cancel_is_not_cancelled_twice` — AC-05
    - `test_limited_wp_cancelled_even_when_halted` (`consecutive_failures` 3) — AC-05
    - `test_after_cancellation_all_wait_routes_to_synthesis_with_cleared_wp_id` (stale `current_wp_id`) — AC-04, AC-08
  - `TestAllRolesWait.test_all_roles_wait_with_in_progress_wp`: set `current_wp_id = "WP-STALE"` and assert `cmd.update.get("current_wp_id") == ""` (non-halted fall-through) — AC-08.
- `orchestrator/tests/test_integration.py`, new `test_rework_limit_cancels_wp_and_reaches_synthesis`:
  - **`ScriptedLedger` extension:** derive PM `REVIEW_REWORK_LIMIT` from a WP detail's `rework_counts`, and add a `ledger_update_work_package_status` tool that marks the WP CANCELLED and its dependent READY.
  - **Asserts:** `synthesis` is in the execution log, `pm` is absent after the limit, and the dependent's stage ran — AC-06.
- Verification commands:
  - `npm test` and `npm run build` (mcp-server); `pytest` and `ruff check` (orchestrator) — AC-11.
  - `node scripts/check-version-sync.js` — AC-11.
  - `tests/utils/workflow-manifest.test.ts` SPEC_VERSION parity — AC-09.
  - A grep that §21.72 links to §21.73 in `edge-cases.md` — AC-12.
  - A grep that "already differ in one place" no longer appears in `constraints-workflow.md` and "Test coverage gap (known)" no longer appears in `supervisor-routing.md` — AC-08, AC-10.

## Documentation Updates

- `mcp-server/docs/agents/workflow-specification/operations.md`: §11.1 prerequisite filter, persisted trip, begin_work sentence
- `mcp-server/docs/agents/workflow-specification/dependencies-and-rework.md`: §16.3 semantics; §16.3c orchestrator handling
- `mcp-server/docs/agents/workflow-specification/recommendations.md`: §14.1.2 P2 payload
- `mcp-server/docs/agents/workflow-specification/edge-cases.md`: new §21.73 (including legacy chains); §21.27 amended; §21.72 "Legacy-WP treatment" cross-reference to §21.73
- `mcp-server/docs/agents/workflow-specification/walkthrough.md`: L142 constant description
- `mcp-server/docs/agents/workflow-specification/README.md`: version, date, changelog
- `shared/workflow-manifest.json`: `spec_version`
- `mcp-server/docs/agents/project-manifest/constraints-workflow.md`:
  - divergence paragraph removed (parity-test pointer instead);
  - circuit-breaker paragraph;
  - "Unfixable failures" and "Why the chain cannot recover" in the verifier-chain entry
- `mcp-server/docs/agents/project-manifest/api-surface.md`: begin_work / start_pipeline circuit breaker; PM P2 payload; begin_work prerequisite exclusion
- `mcp-server/docs/agents/project-manifest/data-flows.md`: Flow 4 steps 3 and 5
- `mcp-server/src/tools/help-content.ts`: circuit-breaker wording
- `orchestrator/docs/supervisor-routing.md`: routing table; Rework-Limit Cancellation subsection; halted paragraph; stale note removed
- `orchestrator/docs/jsonl-log-schema.md`, `orchestrator/docs/architecture.md`, `orchestrator/docs/agents/project-manifest/api-surface.md`: two new log actions
- `orchestrator/docs/agents/project-manifest/decisions.md`: Not Adopted entry, Consequences and References reconciled
- `mcp-server/changelog.md`, `orchestrator/changelog.md`: new entries
- `build/workflow-specification.md`, `.context/`: regenerated

## Deferred Items

| # | Deferred Item | Origin | Reason Deferred | Notes |
|---|---------------|--------|-----------------|-------|
| 1 | The halted-WP sweep routes straight to synthesis after cancelling (`supervisor.py` L673–L741). Dependents unblocked by the cancellation, and WPs starved behind the halted WP in their role's `ledger_get_next_action` order, never run, so synthesis gets `WAIT` and the run ends without one. | Item 1 trace, step 6 | After this plan the rework-limit path no longer uses the sweep. What remains affects crash-halted WPs only, outside the three items. | The fix is to re-evaluate routing after a sweep that cancelled something, instead of going straight to synthesis. Reconsider with the next orchestrator reliability plan. |
| 2 | Any ledger tool refusal aborts the whole stage: `ToolException` from langchain-mcp-adapters, no `handle_tool_error`. | Item 1 trace, step 3 | Changing tool-error semantics affects every stage and every guard. | This explains why a refused start costs a stage and an `errors` entry. |
| 3 | Extract the duplicated `beginWork` / `startPipeline` guard chain into one helper | Item 2 | Out of scope by instruction; the parity suite pins equivalence | Insight `f213b2d6-…`. |
| 4 | PM, pipeline-agent and Synthesis persona follow-ups (see Out of Scope) | Item 1 | Persona Curator | The headless side of the four other PM review actions is planned in P05 (`2026-10-06-p05-headless-pm-review-actions`). The persona side stays open. |
| 5 | Retire the legacy-only `resolveFailAgent` fallback, its legacy-only tests, and spec §21.63, §21.66, §21.67 and §21.72's legacy-WP bullet | Plan P02 synthesis, Next Steps | Only valid once no ledger holds a pre-v2.6.0 chain lacking `implementation` ahead of a verifier. That condition cannot be checked from this plan. | After this plan, a legacy self-loop ends at the limit (cancelled headlessly), so such WPs drain faster. Reconsider once a store scan shows no remaining legacy chains. |
| 6 | Renumber plan P04's spec version and edge-case section, and apply Hard Reject 5 in `ledger_update_pipeline_stages` | Plan P02 synthesis, Deferred & Follow-Up | Already carried by P04's own sequencing note (P04 `plan.md` L3). Editing P04 is out of scope here. | After this plan, P04 takes v2.8.0 / §21.74 and mcp-server v2.14.0. |
| 7 | Documentation-stage completions should declare `artifacts.files_modified` for traceability | Plan P02 synthesis, Deferred & Follow-Up (low) | A Documentation persona practice, outside this plan's code and docs | Persona Curator follow-up. P02's own instance was an accurate empty declaration. |

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Step 3 lands without step 7 (e.g. a partially executed run), making `REVIEW_REWORK_LIMIT` reachable while the PM node still loops** | The Dependencies section ties them together. The orchestrator integration test (AC-06) fails unless both are present. |
| **A refused call that writes surprises callers or tests** | The error text is unchanged, and the write happens once (idempotent at the limit). AC-01 pins it, and §21.73 documents it. |
| **READY-WP claim persisted on a refused start** | This is intended: it keeps the WP visible to P1/P2. It is pinned by a test and documented in §21.73. |
| **Re-poll loop never terminates if the ledger keeps naming the same WP** | Cancelled IDs are tracked per iteration. A repeat is treated as a failure, and the PM role is skipped for that iteration (AC-05). |
| **Spec and version numbering collides with the pending plans** | Plan P02's numbers are already in the tree (v2.6.0, §21.72, mcp-server v2.12.0), and the numbering rule in Dependencies reads the live values. P04's sequencing note and P05's expected numbers already assume this plan's v2.7.0 / §21.73. |
| **This plan overwrites plan P02's text in the shared `constraints-workflow.md` entry or in §21.72** | Edits are located by heading. This plan rewrites only "Unfixable failures" and the last bullet of "Why the chain cannot recover (legacy chains only …)", and adds one sentence to §21.72. P02's "Enforcement (v2.6.0)" paragraph and legacy-only markers stay as they are. |
| **The 09-22 plan moves `resetReworkCount` into `work-package-admin.ts`** | No overlap: this plan does not touch the reset tool. A CANCELLED WP is recovered via `ledger_reopen_cancelled_wp`, which resets the counters, and can then be restaged with 09-22's tool. |
| **Runs that cancel at the limit still exit 1** | Documented (README exit-codes text already says the code reflects errors, not WP state). This is consistent with `decisions.md`. |

## Recommended Workflow
- **Workflow:** ledger
- **Rationale:** The plan spans the MCP server, the orchestrator and the authoritative specification, and makes several coupled decisions that must land together (persisted trip + supervisor handling). It needs formal QA and review.
