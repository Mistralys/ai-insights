# Plan

## Plan Audit Cycles
- Audits: none — Plan Auditor v1.11.0
- Architectural Reviews: none — Plan Architect Reviewer v2.3.4

## Prior Project Context

This is P05 in a numbered sequence (P01 personas, P02 fail-route validation, P03 rework-limit headless completion, P04 pipeline-stage adjustment). P03 found that `REVIEW_REWORK_LIMIT` reached a PM node that only knows plan decomposition, and added a supervisor intercept that cancels the WP per spec §16.3c. P03's Out of Scope (a) already noted that the four other PM review actions still dispatch the plan-only PM node. The Ledger Doctor persona records the same failure from a real incident: a single `REVIEW_ABANDONED` WP "consumed every dispatch cycle". The repository's long-term secondary goal is a reliable headless workflow. Insights `a1368334-…` and `cf33c8a0-…` (WPs that need a human end up cancelled in autonomous runs) support the user's cancel policy for `UNBLOCK_WP`.

## Summary

In a headless run, four PM review actions — `UNBLOCK_WP`, `REVIEW_STALE`, `REVIEW_ABANDONED` and `REPAIR_ORPHAN_BLOCKED` — are dispatched to a PM node whose prompt and persona can only decompose a plan. Because the supervisor polls the PM first, each of them pre-empts every other role for as long as its condition holds. The run then either loops to the iteration limit (exit 2) or, if the PM stage happens to crash three times, has the WP cancelled by the halted-WP sweep. This plan is a **safeguard** for those rare cases. It generalises P03's supervisor intercept into one table-driven mechanism that resolves all five PM review actions deterministically, without the PM node:

- `UNBLOCK_WP`: cancel the WP.
- `REVIEW_STALE`: auto-cancel the stale pipeline.
- `REPAIR_ORPHAN_BLOCKED`: set the WP to READY.
- `REVIEW_ABANDONED`: leave the WP to its owning role, which already has an action for it.
- `REVIEW_REWORK_LIMIT`: unchanged from P03.

Two small ledger alignments with the spec support this. The `UNBLOCK_WP` and `REVIEW_ABANDONED` payloads gain the fields the spec pseudocode already names, and a BLOCKED → CANCELLED transition keeps `blocked_by`, as the spec's transition table already implies. Interactive behaviour is unchanged: a PM or a human still decides. The spec takes the next free numbers after P04 (expected v2.9.0, §21.75).

## Architectural Context

- **Ledger recommendation engine.** `getProjectManagerAction` (`mcp-server/src/tools/workflow-next-action.ts` L351–L558) returns the first match. The order is P1 `UNBLOCK_WP` (L361), P2 `REVIEW_REWORK_LIMIT` (L381), P3 `REVIEW_STALE` (L402), P3b `REVIEW_ABANDONED` (L428), P3c `REPAIR_ORPHAN_BLOCKED` (L477), P3d `ROUTE_PIPELINE_AGENT` (L500), then WAIT. Per-role engines act on IN_PROGRESS WPs regardless of `assigned_to`; `assigned_to` gates only READY claims, and Developer P7 claims READY WPs that are unassigned (L718).
- **Ledger transitions.** `updateWorkPackageStatus` (`mcp-server/src/tools/work-package.ts` L663+) has these rules:
  - CANCELLED is PM-only (L766).
  - Unclaim (IN_PROGRESS → READY) is PM or assignee only and needs no running pipeline (L814).
  - BLOCKED → READY has no guard.
  - Step 7 (L865) deletes `blocked_by` on every exit from BLOCKED.
  - Terminal transitions run `propagateDependencyUnblock` (L939).

  `ledger_cancel_pipeline` (`pipeline.ts` L667–L717) takes `auto_cancelled`.
- **Orchestrator supervisor.** `orchestrator/src/supervisor.py` polls `ledger_get_next_action` for each role in manifest order, PM first (`_ROLES` L95). The first dispatchable action wins (role loop L547–L670), and the all-roles-WAIT fall-through runs the halted-WP sweep (L673–L741). After P03, the role loop holds an inline PM intercept for `REVIEW_REWORK_LIMIT`. It sits ahead of the skip, unknown-action and consecutive-failure checks. On success it cancels, logs `rework_limit_wp_cancelled` and re-queries the PM. It tracks handled WPs per iteration. On failure it logs `rework_limit_cancel_failed`, adds an `errors` entry and skips the PM role for that iteration.
- **PM node.** `orchestrator/src/nodes/pm.py` sends only the plan. The persona (`personas/ledger/src/content/2-project-manager.md` L96–L220) runs decomposition and nothing else.
- **Specification.** `mcp-server/docs/agents/workflow-specification/` is authoritative. Relevant sections:
  - §6.2 (`state-machines.md`): transition table.
  - §14.1.2 (`recommendations.md`): PM priorities.
  - §16.3c (`dependencies-and-rework.md`): headless rework-limit handling.
  - §21.12, §21.13, §21.20 (`edge-cases.md`).
  - §20.4 (`auxiliary-systems.md`): cascade lock gap.

### Verified current headless behaviour

The evidence is in `research-brief.md`, "Verified current headless behaviour". In short, for all four actions:

1. The ledger returns the action to the PM while its condition holds. The supervisor polls the PM first and dispatches `pm` (`_DISPATCH_ACTIONS` L66–L67). No other role is polled in that iteration, so every other WP is starved.
2. The PM stage cannot act on the action, because no action, WP or payload reaches it.
3. **If the stage returns normally**, the failure counter for that WP is popped (L223–L225). The same dispatch repeats until `MAX_ITERATIONS` (100), and the run stops at the safety limit with exit 2.
4. **If the stage raises** (a refused ledger call or the `restrict_to_wp` hard kill), the WP is halted after 3 iterations and the PM role is skipped from then on. At the all-WAIT fall-through, the sweep **cancels** the WP and routes straight to synthesis. A stale, abandoned or orphaned WP that was recoverable is lost, and its dependents never run.
5. Each PM pass may re-run the decomposition sub-agents. In a run resumed on another date, it may also rename the plan folder (persona step 3).

## Approach / Architecture

### 1. One intercept registry in the orchestrator (generalises P03)

A new module, `orchestrator/src/pm_review.py`, declares one frozen record per PM review action. Each record has these fields:

| Field | Meaning |
|---|---|
| `action` | Ledger action string |
| `kind` | `"mutate"` (one ledger call, then re-query the PM) or `"defer"` (no ledger call; move on to the next role) |
| `build_call(payload)` | Returns `(tool_name, kwargs)`; raises `ValueError` on a malformed payload (e.g. missing `work_package_id`) |
| `success_event`, `success_level` | Run-log action name and level on success |
| `failure_event` | Run-log action name on failure (`None` for `defer`) |
| `log_fields(payload)` | Payload fields copied into the log entry |

`PM_REVIEW_INTERCEPTS: Mapping[str, PmReviewIntercept]` is the registry. The supervisor gets one generic executor, `_handle_pm_review(action_data)`, which uses its existing `_call_tool` and `_log_entry` closures. P03's inline `REVIEW_REWORK_LIMIT` branch becomes the registry's first entry, with its event names, levels, `errors` semantics and tests unchanged. All five actions leave `_DISPATCH_ACTIONS`. After this plan the PM node is reached only for the no-WP decomposition route and the `ROUTE_PIPELINE_AGENT` fallback.

The role loop keeps P03's placement: for the Project Manager role, a registry action is handled before the skip, unknown-action and consecutive-failure checks.

- **`mutate` success.** Log the success event (no `errors` entry), add `(action, wp_id)` to the iteration's handled set, and re-query the PM. A re-query that names an already-handled `(action, wp_id)` counts as a failure, which bounds the loop.
- **`mutate` failure.** A ledger exception, a malformed payload or a repeated key all lead to the same path. The supervisor logs the failure event at ERROR, adds an `errors` entry and skips the PM role for this iteration (P03 semantics). The next iteration retries. A persistent failure therefore costs one `errors` entry per iteration while the other roles keep working. When the run ends at the all-WAIT fall-through, it exits 1.
- **`defer`.** Log the success event, then continue with the next role.

### 2. Per-action handling

| Action | Kind | Ledger call | Success event (level) | Failure event |
|---|---|---|---|---|
| `REVIEW_REWORK_LIMIT` | mutate | P03, unchanged | `rework_limit_wp_cancelled` (WARNING) | `rework_limit_cancel_failed` |
| `UNBLOCK_WP` | mutate | `ledger_update_work_package_status(work_package_id, status="CANCELLED", agent="Project Manager")` | `blocked_wp_cancelled` (WARNING) with `blocker_type`, `blocker_description`, `blocking_work_package` | `blocked_wp_cancel_failed` |
| `REVIEW_STALE` | mutate | `ledger_cancel_pipeline(work_package_id, type=pipeline_type, reason="Orchestrator: stale pipeline (~{age_hours}h) cancelled in headless run", auto_cancelled=True)` | `stale_pipeline_cancelled` (WARNING) with `pipeline_type`, `age_hours` | `stale_pipeline_cancel_failed` |
| `REPAIR_ORPHAN_BLOCKED` | mutate | `ledger_update_work_package_status(work_package_id, status="READY", agent="Project Manager")` | `orphan_blocked_wp_repaired` (WARNING) | `orphan_blocked_repair_failed` |
| `REVIEW_ABANDONED` | defer | none | `abandoned_wp_left_to_owner` (INFO) with `assigned_to` | none (no ledger call) |

What each handling does:

- **`UNBLOCK_WP`.** The cancellation auto-unblocks dependents (CANCELLED satisfies dependencies, §6.1). The run then continues and finishes through the existing paths: all-terminal → synthesis. An `UNBLOCK_WP` cancellation adds no `errors` entry, so a run without other errors exits 0, consistent with `orchestrator/README.md` "Exit codes". The blocker stays on the WP (Approach 3).
- **`REVIEW_STALE`.** The auto-cancelled pipeline is excluded from every routing and rework decision (§21.27). On the next poll, the owning role gets its normal action (e.g. `IMPLEMENT`, `REWORK`, `RUN_QA`), and the rework budget is untouched. This is the call shape of the stage rollback (`nodes/__init__.py` L657–L663).
- **`REPAIR_ORPHAN_BLOCKED`.** READY is what the auto-unblock cascade would have produced. `assigned_to` is preserved, so the right role claims the WP.
- **`REVIEW_ABANDONED`.** No ledger mutation. In a headless run the WP is not abandoned: time passed (typically a resumed run), and the supervisor itself drives the work. The owning role's engine returns an action for the idle IN_PROGRESS WP, because per-role actions ignore `assigned_to`. That role is reached once the PM is no longer dispatched. The P3b condition clears as soon as that role starts a pipeline.

**Deviation from the agreed handling (needs the user's confirmation).** The agreed handling for `REVIEW_ABANDONED` was to unclaim the WP (IN_PROGRESS → READY). That transition is allowed with `agent="Project Manager"`, and its no-running-pipeline guard always holds for P3b. But the resulting READY, unassigned WP is claimed by Developer P7 whenever `implementation` is active, and the Developer is polled before every verifier. A WP waiting on QA or later would get a fresh implementation pipeline and a full downstream re-run. Leaving the WP to its owner reaches the same goal ("it is picked up again") with no redundant stage and no ledger write. See Considered Alternatives. If the user prefers the unclaim, it is a one-entry change in the registry (`kind="mutate"`, status `READY`).

### 3. Ledger alignments (spec already prescribes them)

- **Blocker retention.** In `updateWorkPackageStatus`, step 7 clears `blocked_by` only for BLOCKED → IN_PROGRESS and BLOCKED → READY, matching spec §6.2, `operations.md` L353–L357 and §21.12. On BLOCKED → CANCELLED the blocker stays on the WP as the cancellation record. This satisfies "the blocker description stays on the WP" with no new tool and no new parameter. Interactive cancellations of blocked WPs keep their blocker too, which is the spec's existing behaviour.
- **Payload alignment** (§14.1.2 pseudocode L59, L75):
  - `UNBLOCK_WP` gains `blocked_by: { type, description, blocking_work_package? }`.
  - `REVIEW_ABANDONED` gains `assigned_to` in both branches.

  Priorities and conditions are unchanged. The supervisor tolerates absent fields from older servers and then logs `reason` only.

### 4. Where `REPAIR_ORPHAN_BLOCKED` is fixed, and why

The fix sits in the orchestrator (supervisor as PM surrogate). There is no ledger self-heal. The spec offers two layers:

- §21.20 and §20.4: "detect … during `getNextAction` and either auto-repair or surface as a PM action".
- §14.1.2 3c: the ledger chose to surface it as a PM action, "PM should transition it to READY". The ledger's own batch guidance says the same (`workflow-next-action-batch.ts` L186–L191).

So the layer the spec assigns to this implementation is the PM action. A headless orchestrator performs PM actions itself (§16.3c precedent). A read-path auto-repair was rejected:

- it would add a write to `ledger_get_next_action`, the most-polled tool (every role, every iteration);
- it would change interactive behaviour, which must stay unchanged;
- it would bypass the 3c caveat for an absent blocker, which asks the interactive PM to verify the hold before repairing.

The spec contradiction is resolved in the spec: §6.2's BLOCKED → READY row ("system-only") gains the PM orphan repair of §14.1.2 3c. The headless repair takes READY for absent-blocker orphans too, because that is exactly what the cascade itself does (`propagateDependencyUnblock` treats an absent blocker as unblockable). §21.75 states this.

## Rationale

- **One mechanism.** After P03 there is one intercepted action. Adding four inline branches would repeat the call / log / re-query / fail shape four times. A registry keeps the executor single and makes adding an action a data change. It has five consumers on day one.
- **Deterministic and LLM-free.** Every handling has one correct answer in a headless run, and the supervisor is required to be LLM-free (orchestrator `constraints.md` §4). P03 and §16.3c already establish the supervisor as PM surrogate.
- **Existing tools only.** All calls already exist: `ledger_update_work_package_status` and `ledger_cancel_pipeline`. The two ledger changes align code with the spec; they add no tool.
- **Re-query after a mutation.** As in P03: a mutation can expose a lower-priority PM action, and continuing to the next role could hide it and fall through to synthesis early. `defer` cannot change the PM's answer, so it moves on instead.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Mechanism | Registry module + one executor, absorbing P03's branch | Four more inline branches in the role loop; a PM-node prompt that names the action | Inline branches duplicate the shape and the failure semantics four times. A prompt-driven PM adds LLM non-determinism to decisions with one correct answer. |
| `REVIEW_ABANDONED` | Defer to the owning role (no mutation) | Unclaim to READY (agreed handling); unclaim and re-claim for the previous assignee | Unclaim makes the Developer re-claim and re-implement already-passed work. Re-claim leaves P3b true (it keys on the last pipeline's completion), so it would fire again. Deferring costs nothing, because the owner already has an action. |
| `REPAIR_ORPHAN_BLOCKED` layer | Supervisor sets READY as PM surrogate | Ledger auto-repair inside `ledger_get_next_action` (§21.20 option); auto-repair in `ledger_get_project_status` self-healing (§17) | The spec's chosen layer is the PM action (§14.1.2 3c). A read-path write changes interactive behaviour and bypasses the absent-blocker caveat. §17 is defined as project-level only (§20.4). |
| Keeping the `UNBLOCK_WP` reason on the WP | Retain `blocked_by` on BLOCKED → CANCELLED (spec alignment) | `ledger_add_project_comment`; JSONL log only; a new `reason` parameter on the status tool | A comment is project-level and a new behaviour. A log only does not keep the reason on the WP. A new parameter is a tool change. Retention is what the spec already prescribes. |
| Blocker details for the WARNING log | Extend the `UNBLOCK_WP` payload (spec pseudocode) | Supervisor calls `ledger_get_work_package` first | The extra call adds a second failure point to the intercept. The spec already names blocker details in the payload. |
| Persistent intercept failure | P03 semantics (`errors` entry, PM skipped this iteration, retry next) | Feed failures into `consecutive_failures` so the halted sweep cancels the WP | That would change P03's settled semantics and cancel recoverable WPs. A double failure is outside the safeguard's expected cases. |

## Pattern Alignment

- Follows P03's PM intercept (placement, success/failure semantics, per-iteration handled set, re-query) and its spec §16.3c framing of the supervisor as PM surrogate.
- Follows supervisor-side ledger mutations with `agent="Project Manager"` and WARNING entries (`halted_wp_cancelled`, `orchestrator/src/supervisor.py` L686–L720).
- Follows the rollback's `ledger_cancel_pipeline(..., auto_cancelled=True)` call (`orchestrator/src/nodes/__init__.py` L657–L663).
- Follows structured payload fields beside `reason` (`REVIEW_STALE`, Developer P1, P03's P2).
- Follows spec-first ordering and per-version spec changelog entries (root `AGENTS.md`, "Change workflow logic").
- Follows module-level frozen tables for routing vocabulary (`_SKIP_ACTIONS`, `_DISPATCH_ACTIONS`). **Departure:** the registry lives in a new module, `orchestrator/src/pm_review.py`, rather than in `supervisor.py`. Its records carry behaviour (call builders, log-field extractors), so they get a module that tests can import without the supervisor closure. `supervisor.py` still owns execution.

## Structural Improvements

| Structure | Observation | Decision | Reason |
|-----------|-------------|----------|--------|
| `orchestrator/src/supervisor.py` P03 inline `REVIEW_REWORK_LIMIT` branch | One-off branch whose shape the four other actions need | Promoted to step 6 | Becomes the registry's first entry; prevents four copies. |
| `orchestrator/src/supervisor.py` `_DISPATCH_ACTIONS` | Lists PM review actions beside dispatchable PM actions | Promoted to step 6 | All five leave the set. A test pins that the registry and `_DISPATCH_ACTIONS` are disjoint. |
| `mcp-server/src/tools/work-package.ts` L865 step 7 | Clears `blocked_by` on BLOCKED → CANCELLED, against spec §6.2 / §21.12 | Promoted to step 3 | The fix is needed for the agreed "blocker stays on the WP". |
| `mcp-server/src/tools/workflow-next-action.ts` `UNBLOCK_WP` / `REVIEW_ABANDONED` payloads | Omit fields the spec pseudocode names | Promoted to step 3 | Needed for the WARNING log; aligns code to spec. |
| `state-machines.md` §6.2 BLOCKED → READY row vs §14.1.2 3c | Spec contradiction (system-only vs PM repair) | Promoted to step 1 | The headless repair relies on the PM path being legitimate. |
| `work-package.ts` BLOCKED → READY has no agent guard | Spec says system-only; code accepts any agent | Rejected | Adding a guard changes interactive behaviour (other personas or recipes may use it) and is not needed for the safeguard. Recorded in Deferred Items. |
| `mcp-server/src/utils/project-reset.ts` L441–L456 | GUI reset cancels WPs without `propagateDependencyUnblock`, which creates orphans | Rejected | GUI-owned path with its own manifest, outside the headless safeguard. After this plan, headless runs repair such orphans anyway. Recorded in Deferred Items. |
| `orchestrator/tests/test_supervisor.py` `_derive_next_action` L70–L74 and `test_integration.py` `ScriptedLedger` L116–L121 | Mocks return `REPAIR_ORPHAN_BLOCKED` without a WP id and expect `pm` | Promoted to step 7 | The mocks must emit a real payload (with `work_package_id`), or the new failure path would fire in every unrelated test. |
| `orchestrator/src/supervisor.py` L673–L741 halted sweep direct synthesis route | Unblocked dependents never run | Rejected | P03 Deferred Item 1, unchanged. These actions no longer reach the sweep. |

## Detailed Steps

1. **Revise the workflow specification first** (`mcp-server/docs/agents/workflow-specification/`). Take the version and section numbers by the rule in Dependencies; the expected values are v2.9.0 and §21.75.
   - `dependencies-and-rework.md` §16.3c: keep the heading and anchor, and append a paragraph block **"Other PM review actions (headless-only safeguard)"**. It contains:
     - the per-action table from Approach 2;
     - a statement that the orchestrator never dispatches its PM agent for any of the five actions;
     - the re-query and failure semantics;
     - the rule that interactive sessions keep the §14.1.2 behaviour, where a PM or a human decides.
   - `recommendations.md` §14.1.2:
     - Name the `UNBLOCK_WP` payload fields (`blocked_by.type`, `.description`, `.blocking_work_package`) and the `REVIEW_ABANDONED` `assigned_to` in the pseudocode (L59, L75).
     - Add one sentence after the priority list pointing headless orchestrators to §16.3c.
     - In the 3c note, state that the PM's READY transition is the repair §21.20 refers to.
   - `state-machines.md` §6.2:
     - BLOCKED → READY row: "System (auto-unblock, §15.4) or Project Manager orphan repair (§14.1.2 3c, §21.20)".
     - BLOCKED → CANCELLED row: "Preserves `blocked_by` as the cancellation record".
   - `operations.md` L353–L357: add a comment that BLOCKED → CANCELLED keeps `blocked_by` (§21.12).
   - `edge-cases.md`:
     - §21.12: add "BLOCKED → CANCELLED retains `blocked_by`."
     - §21.20: add a bullet saying headless orchestrators perform the PM repair per §16.3c, and that the ledger does not auto-repair on read, with the reason.
     - Add **§21.75 PM Review Actions in Headless Runs**. It covers:
       - the former pre-emption and loop: PM polled first, the plan-only PM agent, the two outcomes;
       - the per-action handling;
       - why `REVIEW_ABANDONED` is deferred and not unclaimed (Developer P7 re-claim);
       - absent-blocker orphans set to READY, matching the cascade;
       - blocker retention;
       - failure semantics;
       - the rule that any future PM review action needs an intercept entry before it can reach a headless run.
   - `walkthrough.md` L150–L172 action table: append "(headless: §16.3c)" to the four PM rows.
   - `README.md`: version, date, and a changelog entry naming §6.2, §14.1.2, §16.3c, §21.12, §21.20 and the new §21.75.
2. **Align the manifest version.** Set `shared/workflow-manifest.json` `spec_version` to the version written in step 1.
3. **Ledger code.**
   - `mcp-server/src/tools/work-package.ts` step 7 (L865–L869): clear `blocked_by` only when `newStatus` is `IN_PROGRESS` or `READY`, and fix the comment.
   - `mcp-server/src/tools/workflow-next-action.ts`:
     - P1 (L361–L379): add `blocked_by` (type, description, and `blocking_work_package` when present).
     - P3b (L428–L475): add `assigned_to` in both return branches.
   - `mcp-server/src/tools/help-content.ts` `ledger_update_work_package_status` rules: add "BLOCKED → CANCELLED keeps `blocked_by`; BLOCKED → IN_PROGRESS / READY clear it."
4. **Ledger tests** per the Test Plan. Run `npm test` and `npm run build` in `mcp-server/`.
5. **New module `orchestrator/src/pm_review.py`** (new file).
   - Contents: the frozen `PmReviewIntercept` dataclass and the `PM_REVIEW_INTERCEPTS` mapping with the five entries from Approach 2.
   - Pure functions only, no I/O.
   - `build_call` raises `ValueError` when `work_package_id` (or, for `REVIEW_STALE`, `pipeline_type`) is missing.
   - The `REVIEW_REWORK_LIMIT` entry reproduces P03's call, event names and log fields exactly.
6. **Supervisor** (`orchestrator/src/supervisor.py`):
   - Remove the five actions from `_DISPATCH_ACTIONS`.
   - Replace P03's inline branch with `_handle_pm_review`, using `PM_REVIEW_INTERCEPTS`, at the same position in the role loop.
   - Implement the `mutate` and `defer` semantics from Approach 1, with the handled set keyed on `(action, wp_id)`.
   - Include the new entries in `run_log`, and failure entries in `errors`, on every exit path of the iteration, as P03 does.
   - Update the module docstring's action-set comments.
7. **Orchestrator tests** per the Test Plan. This includes updating the mocks and the tests that pin the old `pm` dispatch. Run `pytest` and `ruff check` in `orchestrator/`.
8. **MCP manifest.**
   - `mcp-server/docs/agents/project-manifest/constraints-workflow.md`:
     - In "Status Transitions Are Enforced" → server-side notes: `blocked_by` is kept on BLOCKED → CANCELLED, and BLOCKED → READY is not agent-guarded in code (spec: system or PM orphan repair).
     - New entry under "Handoffs & Routing": **"PM Review Actions Are Resolved by the Orchestrator in Headless Runs"**. Rule, spec link (§16.3c, §21.75), and the statement that interactive behaviour is unchanged.
   - `api-surface.md` L6541–L6557: payload fields for P1 and P3b.
   - `data-flows.md` L491–L496: the same fields.
9. **Orchestrator docs.**
   - `orchestrator/docs/supervisor-routing.md`:
     - Routing table L55–L57: remove the five PM review actions from the `pm` dispatch list.
     - Replace P03's "Rework-Limit Cancellation (spec §16.3c)" subsection with **"PM Review Actions (spec §16.3c)"**, carrying the per-action table and failure semantics. Keep the old heading text as the first row's label so existing links still read correctly.
   - `orchestrator/README.md` L348: replace the row with "`UNBLOCK_WP` / `REVIEW_*` / `REPAIR_ORPHAN_BLOCKED` | handled by the supervisor (spec §16.3c) — never `pm`".
   - `orchestrator/docs/jsonl-log-schema.md`, `orchestrator/docs/architecture.md`, `orchestrator/docs/agents/project-manifest/api-surface.md`: add rows for the seven new events (`blocked_wp_cancelled`, `blocked_wp_cancel_failed`, `stale_pipeline_cancelled`, `stale_pipeline_cancel_failed`, `orphan_blocked_wp_repaired`, `orphan_blocked_repair_failed`, `abandoned_wp_left_to_owner`) next to P03's two.
   - `orchestrator/docs/agents/project-manifest/decisions.md` ("Not Adopted: Settled-but-Not-Terminal WPs at Synthesis"): extend P03's Consequences bullet. A WP needing a human (`UNBLOCK_WP`) also ends CANCELLED through the supervisor, so the terminal-only predicate and exit codes 0/1/2 still hold. Add `supervisor-routing.md` § PM Review Actions to References.
   - `orchestrator/docs/agents/project-manifest/file-tree.md` L36 area and `orchestrator/docs/agents/project-manifest/README.md` L112 area: add `pm_review.py`.
   - `orchestrator/docs/agents/project-manifest/constraints.md` §4: one sentence. The supervisor resolves PM review actions itself through `pm_review.py`; still no LLM.
10. **Release preparation.**
    - `mcp-server/changelog.md`: next free minor, expected v2.15.0 after P04's v2.14.0, in house style:
      - `UNBLOCK_WP` carries the blocker;
      - `REVIEW_ABANDONED` carries `assigned_to`;
      - cancelling a blocked WP keeps its blocker;
      - spec realigned.
    - Run `npm run sync-version` in `mcp-server/`.
    - `orchestrator/changelog.md` + `orchestrator/pyproject.toml`: next minor, expected v1.6.0 after P03's v1.5.0. "Supervisor resolves all PM review actions per spec §16.3c; the PM agent is no longer dispatched for them."
    - Run `node scripts/check-version-sync.js` from the workspace root.
11. **Regenerate derived documents** last: `node scripts/bundle-docs.js` and `node scripts/cli.js ctx-generate`.

## Dependencies

- **P03 must have landed.** Step 6 refactors P03's intercept and step 9 replaces P03's routing subsection. If P03's intercept is absent at execution time, stop and report rather than re-implementing P03.
- Step 1 precedes steps 3–9 (spec first); step 2 follows step 1.
- Step 3 precedes steps 4 and 6. The supervisor reads the new payload fields, but it must tolerate their absence.
- Step 5 precedes step 6. Step 11 runs last.
- **Plan order:** P01 → P02 → P03 → P04 (`2026-09-22-p04-pipeline-stage-adjustment`) → this plan. There is no code dependency on P04. Both edit `work-package.ts`, but P04 moves admin tools into `work-package-admin.ts` and does not touch `updateWorkPackageStatus` step 7. Locate code by function and comment, not by line.
- **Numbering rule (same as P03):** at execution time, read the spec `README.md` version and the highest `### 21.N` in `edge-cases.md`, then take the next minor version and `§21.(N+1)`. In the planned order this yields v2.9.0 and §21.75 (after P04's v2.8.0 / §21.74). Apply the same rule to the mcp-server version (expected v2.15.0) and the orchestrator version (expected v1.6.0; P04 does not bump the orchestrator).

## Required Components

- Spec: `mcp-server/docs/agents/workflow-specification/dependencies-and-rework.md`, `recommendations.md`, `state-machines.md`, `operations.md`, `edge-cases.md`, `walkthrough.md`, `README.md`
- `shared/workflow-manifest.json`
- `mcp-server/src/tools/work-package.ts`, `mcp-server/src/tools/workflow-next-action.ts`, `mcp-server/src/tools/help-content.ts`
- Tests (existing): `mcp-server/tests/tools/workflow-next-action.test.ts`, `mcp-server/tests/tools/cancelled-status.test.ts`
- `orchestrator/src/pm_review.py` (**new**), `orchestrator/src/supervisor.py`
- Tests: `orchestrator/tests/test_pm_review.py` (**new**), `orchestrator/tests/test_supervisor.py`, `orchestrator/tests/test_integration.py`
- Docs: `mcp-server/docs/agents/project-manifest/constraints-workflow.md`, `api-surface.md`, `data-flows.md`; `orchestrator/docs/supervisor-routing.md`, `jsonl-log-schema.md`, `architecture.md`, `orchestrator/README.md`, `orchestrator/docs/agents/project-manifest/api-surface.md`, `decisions.md`, `file-tree.md`, `README.md`, `constraints.md`
- Versions: `mcp-server/changelog.md`, `mcp-server/package.json`, `orchestrator/changelog.md`, `orchestrator/pyproject.toml`
- Regenerated: `build/workflow-specification.md`, `.context/`

## Assumptions

- The orchestrator is the only actor on the project during a headless run, so a stale pipeline is not being worked on by an IDE session at the same time.
- P03 lands as planned: registry entry 1 reproduces its behaviour, and its tests stay green unchanged.
- `MCP_SERVER_CMD` runs `mcp-server/dist/`, which `scripts/run-orchestrator.js` rebuilds when stale (P03 assumption).

## Constraints

- No new ledger tool, graph edge, exit code, WP status or LLM call. Recommendation priorities and conditions stay unchanged.
- Exit codes and the synthesis predicate stay unchanged. Every handled action finishes through the existing paths: all-terminal → synthesis, or the all-WAIT fall-through.
- P01–P04 are not edited. Generated docs are regenerated, never hand-edited.

## Out of Scope

- Persona changes. These are follow-ups for the Persona Curator; they are listed in Deferred Items, deduplicated with P03.
- The halted-WP sweep's direct synthesis route (P03 Deferred Item 1).
- A ledger agent guard on BLOCKED → READY, and orphan prevention in the GUI project reset (Deferred Items).
- Changing the `REVIEW_ABANDONED` detection itself (e.g. treating a resumed run as fresh).

## Human Actions

| # | Action | When | Why an agent cannot do it |
|---|--------|------|---------------------------|
| 1 | Confirm or overrule the `REVIEW_ABANDONED` handling change (defer to the owning role instead of the agreed unclaim; see Approach 2) | Before the run | It revises a handling the user agreed; only the user can accept the deviation. |
| 2 | Rebuild and restart the STABLE Ledger MCP server so IDE sessions pick up the payload fields and blocker retention | After the run | The server backs the user's live agent sessions; restarting it is the user's call. |

## Acceptance Criteria

- AC-01: `ledger_update_work_package_status(BLOCKED → CANCELLED, "Project Manager")` keeps `blocked_by` unchanged on the WP. BLOCKED → READY and BLOCKED → IN_PROGRESS still clear it.
- AC-02: The PM's `UNBLOCK_WP` payload carries `blocked_by` with `type` and `description` (and `blocking_work_package` when set). Both `REVIEW_ABANDONED` branches carry `assigned_to`. Priorities and all other fields are unchanged.
- AC-03: For each of `UNBLOCK_WP`, `REVIEW_STALE`, `REVIEW_ABANDONED` and `REPAIR_ORPHAN_BLOCKED`, the supervisor never routes to `pm`. None of the five PM review actions is in `_DISPATCH_ACTIONS`.
- AC-04: On `UNBLOCK_WP` the supervisor calls `ledger_update_work_package_status(status="CANCELLED", agent="Project Manager")` and logs `blocked_wp_cancelled` at WARNING with `blocker_type` and `blocker_description`. No `errors` entry is added.
- AC-05: On `REVIEW_STALE` the supervisor calls `ledger_cancel_pipeline` with the payload's `pipeline_type` and `auto_cancelled=True`, and logs `stale_pipeline_cancelled`.
- AC-06: On `REPAIR_ORPHAN_BLOCKED` the supervisor calls `ledger_update_work_package_status(status="READY", agent="Project Manager")` and logs `orphan_blocked_wp_repaired`.
- AC-07: On `REVIEW_ABANDONED` the supervisor makes no ledger call, logs `abandoned_wp_left_to_owner`, and dispatches the next role that has an action in the same iteration.
- AC-08: For every `mutate` action:
  - after success, the supervisor re-queries the PM;
  - a failed ledger call, a malformed payload (missing `work_package_id`, or `pipeline_type` for `REVIEW_STALE`), or a repeated `(action, wp_id)` logs the action's `*_failed` event at ERROR, adds an `errors` entry, does not dispatch `pm`, and moves on to the next role;
  - the intercept runs before the consecutive-failure check.
- AC-09: P03's `REVIEW_REWORK_LIMIT` behaviour, event names and tests are unchanged. It is now served by the registry.
- AC-10: In scripted end-to-end orchestrator runs, each of the four actions resolves without `pm` executing after decomposition. The run ends at synthesis or the all-WAIT fall-through well below `max_iterations`:
  - an `UNBLOCK_WP` WP ends CANCELLED with its blocker, and its dependent runs;
  - a stale pipeline is auto-cancelled and the stage re-runs;
  - an orphan becomes READY and runs;
  - an abandoned WP's next stage runs.
- AC-11: The spec carries the new version and §21.75 (or the numbers assigned by the rule), with §6.2, §14.1.2, §16.3c, §21.12 and §21.20 updated. `shared/workflow-manifest.json` `spec_version` matches.
- AC-12: The manifests, tool help and orchestrator docs listed in Documentation Updates describe the new behaviour. No doc still routes the PM review actions to `pm`.
- AC-13: Changelogs and package versions agree (`check-version-sync.js`). `npm test` and `npm run build` pass in `mcp-server/`, `pytest` and `ruff check` pass in `orchestrator/`, and the derived docs are regenerated.

## Testing Strategy

On the ledger side, unit tests pin blocker retention and the two payload fields. On the orchestrator side:

- pure unit tests cover the registry (call builders and malformed payloads);
- supervisor tests with sequenced mocks cover each action's success, failure, re-query and precedence, plus a "persistent action" case per action that would have looped to `pm` before;
- `ScriptedLedger` integration runs prove that each action resolves and that the run finishes.

The tests that pinned the old `pm` dispatch are rewritten, not deleted, so that they now pin the fix.

## Test Plan

- `mcp-server/tests/tools/cancelled-status.test.ts`, new describe "BLOCKED → CANCELLED keeps blocked_by":
  - real `ledger_update_work_package_status` call on a `technical`-blocked WP: status CANCELLED, `blocked_by` deep-equals the original — AC-01;
  - BLOCKED → READY on a `dependency`-blocked WP still deletes `blocked_by` — AC-01.
- `mcp-server/tests/tools/workflow-next-action.test.ts` "PM action logic":
  - Case 1 (L276): also asserts `blocked_by.type === "technical"` and `blocked_by.description` — AC-02;
  - Case 5 (L322): asserts `assigned_to`;
  - new case for the no-pipeline `REVIEW_ABANDONED` branch asserting `assigned_to` — AC-02.
- `orchestrator/tests/test_pm_review.py` (**new**):
  - `test_registry_covers_all_pm_review_actions` (exact key set of five) — AC-03;
  - `test_registry_disjoint_from_dispatch_actions` (imports `_DISPATCH_ACTIONS`) — AC-03;
  - per entry, `test_build_call_<action>`: tool name and kwargs, including `agent="Project Manager"` and `auto_cancelled=True` — AC-04, AC-05, AC-06;
  - `test_build_call_rejects_missing_wp_id` (parametrised over `mutate` entries) and `test_stale_requires_pipeline_type` — AC-08;
  - `test_rework_limit_entry_matches_p03` (event names and call shape) — AC-09;
  - `test_abandoned_is_defer_without_call` — AC-07.
- `orchestrator/tests/test_supervisor.py`:
  - `TestDirectActionRouting` (L1145–L1151): remove the five PM review rows; keep `ROUTE_PIPELINE_AGENT` → `pm` — AC-03.
  - `test_first_dispatchable_role_wins` (L1186): use PM `ROUTE_PIPELINE_AGENT` without `next_agent` in place of `UNBLOCK_WP`, keeping its intent — AC-03.
  - `TestAllBlocked.test_all_blocked_routes_to_pm` (L657) → rename to `test_all_blocked_orphan_is_repaired_not_routed_to_pm`. The mock helper `_derive_next_action` (L70–L74) now returns `work_package_id` for the first BLOCKED WP. Assert `ledger_update_work_package_status` was called with `READY` and `goto != "pm"` — AC-03, AC-06.
  - New class `TestPmReviewIntercepts` (PM responses sequenced via `side_effect`; the ledger mutation mocks record calls):
    - `test_unblock_wp_cancels_and_logs_blocker` — AC-04;
    - `test_unblock_wp_without_blocked_by_field_logs_reason_only` (older server) — AC-04;
    - `test_review_stale_auto_cancels_pipeline` — AC-05;
    - `test_repair_orphan_sets_ready` — AC-06;
    - `test_review_abandoned_defers_and_dispatches_owner` (PM `REVIEW_ABANDONED` WP-001, QA `RUN_QA` WP-001 → `goto == "qa"`, no mutation call) — AC-07;
    - `test_mutate_repolls_pm_and_dispatches_following_action` — AC-08;
    - `test_mutate_failure_logs_error_skips_pm_and_continues` (parametrised over the three new `mutate` actions) — AC-08;
    - `test_malformed_payload_is_failure_without_ledger_call` — AC-08;
    - `test_repeated_action_after_success_is_failure` — AC-08;
    - `test_intercept_runs_before_consecutive_failure_check` (`consecutive_failures` 3 on the WP) — AC-08;
    - `test_persistent_action_never_routes_to_pm` (parametrised over the four actions; the static mock returns the action on every PM call; asserts `goto != "pm"` across two consecutive supervisor iterations) — AC-03, pins the old loop as fixed;
    - `test_new_entries_present_in_run_log_on_dispatch_and_fallthrough` — AC-08.
  - `TestReworkLimitCancellation` (from P03): unchanged and still passing — AC-09.
- `orchestrator/tests/test_integration.py`:
  - **`ScriptedLedger` extension:** derive the PM actions from scripted state:
    - `UNBLOCK_WP` from a `technical` blocker;
    - `REVIEW_STALE` from a pipeline flagged `stale`;
    - `REVIEW_ABANDONED` from a WP flagged `idle`;
    - `REPAIR_ORPHAN_BLOCKED` with `work_package_id`.
    Add `ledger_cancel_pipeline` and the READY / CANCELLED handling to `ledger_update_work_package_status`. The all-BLOCKED branch (L116–L121) emits the WP id.
  - New tests, each asserting that `pm` does not appear in the execution log after the initial decomposition and that the final iteration is far below `max_iterations` — AC-10:
    - `test_unblock_wp_cancels_and_dependent_runs`;
    - `test_stale_pipeline_cancelled_and_stage_reruns`;
    - `test_orphan_blocked_repaired_and_runs`;
    - `test_abandoned_wp_next_stage_runs`.
- Verification:
  - `npm test`, `npm run build` (mcp-server); `pytest`, `ruff check` (orchestrator) — AC-13;
  - `node scripts/check-version-sync.js` — AC-13;
  - `tests/utils/workflow-manifest.test.ts` SPEC_VERSION parity — AC-11;
  - grep that `orchestrator/docs/supervisor-routing.md` and `orchestrator/README.md` no longer map `UNBLOCK_WP`, `REVIEW_STALE`, `REVIEW_ABANDONED` or `REPAIR_ORPHAN_BLOCKED` to `pm` — AC-12.

## Documentation Updates

- `mcp-server/docs/agents/workflow-specification/dependencies-and-rework.md`: §16.3c "Other PM review actions (headless-only safeguard)"
- `mcp-server/docs/agents/workflow-specification/recommendations.md`: §14.1.2 payload fields, headless pointer, 3c note
- `mcp-server/docs/agents/workflow-specification/state-machines.md`: §6.2 BLOCKED → READY and BLOCKED → CANCELLED rows
- `mcp-server/docs/agents/workflow-specification/operations.md`: blocker-retention comment
- `mcp-server/docs/agents/workflow-specification/edge-cases.md`: §21.12, §21.20 amended; new §21.75
- `mcp-server/docs/agents/workflow-specification/walkthrough.md`: action table rows
- `mcp-server/docs/agents/workflow-specification/README.md`: version, date, changelog
- `shared/workflow-manifest.json`: `spec_version`
- `mcp-server/docs/agents/project-manifest/constraints-workflow.md`: status-transition server notes; new "PM Review Actions Are Resolved by the Orchestrator in Headless Runs" entry
- `mcp-server/docs/agents/project-manifest/api-surface.md`, `data-flows.md`: PM payload fields
- `mcp-server/src/tools/help-content.ts`: blocker retention rule
- `orchestrator/docs/supervisor-routing.md`: routing table; "PM Review Actions (spec §16.3c)" subsection
- `orchestrator/README.md`: routing table row
- `orchestrator/docs/jsonl-log-schema.md`, `orchestrator/docs/architecture.md`, `orchestrator/docs/agents/project-manifest/api-surface.md`: seven new events
- `orchestrator/docs/agents/project-manifest/decisions.md`: Consequences and References
- `orchestrator/docs/agents/project-manifest/file-tree.md`, `orchestrator/docs/agents/project-manifest/README.md`: `pm_review.py`
- `orchestrator/docs/agents/project-manifest/constraints.md`: §4 sentence
- `mcp-server/changelog.md`, `orchestrator/changelog.md`: new entries
- `build/workflow-specification.md`, `.context/`: regenerated

## Deferred Items

| # | Deferred Item | Origin | Reason Deferred | Notes |
|---|---------------|--------|-----------------|-------|
| 1 | **Persona follow-up — PM persona** (`personas/ledger/src/content/2-project-manager.md`) **and ledger Claude coordinator** (`personas/ledger-support/src/content/ledger-claude-coordinator.md`): a short section for interactive sessions. It surfaces `UNBLOCK_WP`, `REVIEW_REWORK_LIMIT`, `REVIEW_STALE`, `REVIEW_ABANDONED` and `REPAIR_ORPHAN_BLOCKED` to the user with the payload (blocker, stage, age) and the available tools. | User instruction; supersedes P03 Out of Scope (a) | Persona Curator scope; list, do not plan | One item covering both personas. P03 (a) is absorbed here. |
| 2 | **Persona follow-up — Synthesis persona** (`personas/ledger/src/content/9-synthesis.md`): report cancelled WPs with their reason. The reason is the rework-limit payload, or the retained `blocked_by` for human-gated WPs. | User instruction; same as P03 Out of Scope (c) | Persona Curator scope | One item for P03 and P05. The retained `blocked_by` (AC-01) gives the persona a reason to read from the WP itself. |
| 3 | Persona follow-up — pipeline-agent personas: on `BLOCK_FOR_REWORK_LIMIT`, stop and hand off | P03 Out of Scope (b) | Carried unchanged from P03 | Listed so the persona backlog stays in one place. |
| 4 | Persona follow-up — Ledger Doctor Repair 10 (`personas/ledger-support/src/content/ledger-doctor.md` L286–L301) prescribes an unclaim for abandoned WPs and claims "the routing engine can dispatch the correct next agent". In code, Developer P7 re-claims the WP and re-runs implementation. | This plan's research | Persona Curator scope | Align the recipe with §21.75: leave the WP to the owning role. |
| 5 | Ledger agent guard on manual BLOCKED → READY (spec: system or PM orphan repair) | Structural Improvements | Changes interactive behaviour; not needed for the safeguard | Reconsider in a ledger-hardening plan. |
| 6 | GUI project reset (`mcp-server/src/utils/project-reset.ts` L441–L456) cancels WPs without `propagateDependencyUnblock`, creating orphaned BLOCKED dependents | This plan's research | GUI-owned path, outside the headless safeguard | Fix at the source: call the cascade after the reset batch. |
| 7 | Halted-WP sweep routes straight to synthesis | P03 Deferred Item 1 | Unchanged | Not reached by the PM review actions after this plan. |

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **P03's behaviour regresses during the refactor into the registry** | P03's tests stay unchanged (AC-09). `test_rework_limit_entry_matches_p03` pins event names and call shape. |
| **`REVIEW_ABANDONED` defer hides lower PM priorities (3c, 3d) for that iteration** | The owning role usually acts in the same iteration, which clears P3b by the next one. 3d's routing is also covered by the per-role engines. §21.75 documents this. |
| **The user expected an unclaim for `REVIEW_ABANDONED`** | Human Action 1 asks for confirmation before the run. Reverting is a one-entry registry change. The verified cost of the unclaim is recorded in the brief and in §21.75. |
| **Cancelling a human-gated WP lets its dependents run without its output** | This is existing spec semantics (CANCELLED satisfies dependencies, §6.1), shared with P03 and the halted sweep. The retained blocker and the WARNING entry make it visible. The Synthesis follow-up (Deferred 2) reports it. |
| **Interactive PMs see `blocked_by` on cancelled WPs (new for them)** | This is what the spec's §6.2 / §21.12 already describe. No test or reader relies on its absence (brief). The help text states it. |
| **A persistent intercept failure adds one `errors` entry per iteration** | The PM role is skipped while the other roles proceed. The run ends at the all-WAIT fall-through, bounded and exit 1, as in P03. |
| **Mocks in unrelated tests emit `REPAIR_ORPHAN_BLOCKED` without a WP id** | Step 7 updates `_derive_next_action` and `ScriptedLedger` first. A malformed payload is a logged failure, never a crash. |
| **Spec and version numbering collides with P02–P04** | The numbering rule in Dependencies applies at execution time. |

## Recommended Workflow
- **Workflow:** ledger
- **Rationale:** The plan spans the authoritative spec, the MCP server and the orchestrator. It refactors P03's intercept and changes a ledger state-machine side effect that interactive sessions also see, so it benefits from formal QA and review.
