# Plan

## Plan Audit Cycles
- Audits: 1 (Sonnet 5.5 ×1) — Plan Auditor v1.12.0
- Architectural Reviews: 1 (Sonnet 5.5 ×1) — Plan Architect Reviewer v2.3.4

## Prior Project Context

- **Strategy:** The repository's long-term secondary goal is operational reliability of the headless orchestrator workflow. This amendment gives every PM action a prescribed headless outcome, so no headless run waits on a human or loops on an action the PM node cannot perform.
- **Precedent chain:** P02 (spec v2.6.0, Rule 5 fail-route coverage), P03 (v2.8.0, persisted refused start and the §16.3c headless rework-limit rule) and P04 (v2.9.0, `ledger_update_pipeline_stages` / §12.3c) were all spec-first. This plan follows the same order and, like P02's spec step, changes only the specification.
- **Superseded plan:** `docs/agents/plans/2026-10-06-p05-headless-pm-review-actions/` was never executed. The user retired it on 2026-10-23 because its premise required this specification change first. Its `UNBLOCK_WP` → cancel and `REVIEW_ABANDONED` → defer-plus-cancel rules contradict the amended §16.3e. It also expected to take v2.10.0 and §21.76, which this plan now uses.
- **Insights applied:**
  - `5e041ed3-…` (persist the state a refusal implies) supports keeping `rework_requested` on a refused start.
  - `5571cd45-…` (consecutive, not cumulative, failure counters) matches the `MAX_DISPATCHES_WITHOUT_PROGRESS` definition.
  - `53454e24-…` sets the `.context/` regeneration command.

## Knowledge Base Reconciliation

| Insight ID | Title | What the plan overtakes | Executed by |
|------------|-------|-------------------------|-------------|
| 1334b750-0b17-4424-90e9-4cf1f8b26784 | orchestrator/src/supervisor.py: widen cancelled-ID tracking scope without renaming _handle_rework_limit — P05 depends on the name | Its reason, "P05 depends on the name", no longer holds: P05 is retired, and this amendment replaces the P05 design with the §16.3e matrix. The underlying caution (check in-flight plans before renaming supervisor functions) still applies, but no plan currently depends on `_handle_rework_limit`. | Ledger Knowledge Curator v1.4.2 (Targeted Reconciliation) |

## Summary

This plan amends the workflow specification from v2.9.0 to v2.10.0, as set out in the final Spec Amendment Brief `docs/agents/projects/revise-specification.md`. It makes five changes:

1. **Abandoned detection.** `REVIEW_ABANDONED` stops firing for work packages that have a routable next actor. It moves below `ROUTE_PIPELINE_AGENT`, is guarded by a new `hasPendingRoleAction` helper (§14.14), and becomes a defensive ledger-integrity check. `ROUTE_PIPELINE_AGENT` gains an `idle_hours` signal. §21.40 is retitled to match its new scope.
2. **Headless matrix.** A new §16.3e gives every PM action a prescribed headless outcome: automatic, delegated or fatal.
3. **Edge cases.** The edge cases that prescribed unclaim or re-claim, or described PM-claimed WPs as dead ends, are corrected.
4. **Owner continues.** The rule that the pipeline-type owner may always continue an IN_PROGRESS WP becomes explicit.
5. **Targeted technical blockers.** A `technical` blocker may name a `rework_stage`. On unblock the ledger routes that rework like a FAIL, counts it once under the circuit breaker, and never stops a headless run for it. A new helper `targetedReworkAgent` (§14.15) states the routing predicate once, and every routing site cites it.

The work is spec text only. Implementation in the MCP server and the orchestrator, persona updates and the matching project-manifest update are listed as follow-ups and are not designed here. The plan also closes six gaps found while verifying the brief against the spec:

- The brief's two heading retitles (§21.40, §21.43) would break two in-file anchor links unless those links are repaired in the same step.
- The README TOC instruction cannot be applied.
- Updating `constraints-workflow.md` now would document code that does not exist yet.
- A pending targeted rework could be bypassed by finalisation.
- A pending targeted rework could survive a return to READY.
- `REPAIR_TIMESTAMPS` was missing from the headless matrix.

## Architectural Context

The workflow specification in `mcp-server/docs/agents/workflow-specification/` is the single source of truth (README Compliance Model, Rules 1–6). The TypeScript MCP server and the Python orchestrator implement it, and the project manifest describes the implementation after it changes. The specification is split by topic:

- `data-model.md` — §3.3 `WorkPackageDetail`, §3.5 `Blocker`
- `state-machines.md` — §6.2 transition table, as a box-drawing table with side effects listed per row
- `pipeline-routing.md` — §9.3 `FAIL_ROUTING_MAP`, §9.3.1 `resolveFailAgent` (never returns null)
- `operations.md` — §9b.2 validation Rules 1–5; §11.1 `startPipeline` with its `isDirectRework OR isDownstreamRework` increment branch and persisted circuit breaker; §11.1.2; §11.2
- `handoff.md` — §13.1 PM handoff step 2b, which mirrors §14.1.2 3d
- `recommendations.md` — §14.1.2 PM priorities 1–5 with sub-items 3b/3c/3d; six role engines §14.2–§14.5c that consult `assigned_to` only in `CLAIM_WP`; helpers §14.6–§14.13
- `dependencies-and-rework.md` — §15.4 stuck-agent note; §16.3 circuit breaker; §16.3c headless rework-limit rule
- `edge-cases.md` — §21.x, last one §21.75
- `walkthrough.md` — Appendices A (constants), B (actions), C (errors)
- `README.md` — version, changelog, TOC per document, Quick Section Reference per top-level §

`shared/workflow-manifest.json` carries `spec_version`, and `mcp-server/tests/utils/workflow-manifest.test.ts` asserts that it matches the README `**Version:**` line. `.context/mcp-server/workflow-spec-*.md` are generated from the spec directory.

## Approach / Architecture

The amendment is applied file by file, in dependency order of the concepts:

1. **New fields and transitions first** (data model, state machine), because every later section references `rework_stage`, `rework_requested` and the transition side effects.
2. **Operations next** (`startPipeline` counting and clearing; owner-continues).
3. **Recommendation engine** (3d routing and `idle_hours`, 3b move and guard, §14.14, `REWORK (requested)` in each role engine, finalisation guard).
4. **Routing and handoff mirrors** (§9.3 note, §13.1 step 2b).
5. **Headless policy** (§16.3e, §15.4).
6. **Edge cases** that describe all of the above.
7. **Reference appendices and the version bump** last, once the content is settled.
8. **A consistency sweep and verification step** closes the run.

The amendment brief's proposed text blocks are used verbatim where they are final. The plan names each departure from the brief and why (see Rationale and Structural Improvements). Normative text stays language-agnostic pseudocode, in the style of the surrounding sections.

## Rationale

- **Spec-only, single plan.** All five changes describe one coherent position: abandonment means "no derivable next actor", and every PM action has a headless outcome. Change 5 removes the only mechanical cause of a fatal headless stop (Documentation/Release Engineer → Developer escalation). Splitting it out would leave v2.10.0 telling headless runs to stop on the most common technical blocker. The user approved keeping Change 5 in v2.10.0 for long-term stability.
  - *Design review (Decision 6, Reconsider) — split declined.* The review found no defect in bundling and named review load as the residual risk. That risk is met by step 9, which checks the Change 5 items as their own group, separately from Changes 1–4.
- **`targetedReworkAgent` (§14.15, new):**
  - *Current consumers:* §14.1.2 3d, §13.1 step 2b, the six role engines §14.2–§14.5c, §14.14 and the §14.5/§14.5a finalisation guard. That is ten routing sites that would otherwise each restate the predicate.
  - It returns `PIPELINE_AGENT_MAP[wp.rework_requested]` when `rework_requested` is set, and null otherwise. Each site then cites one definition and does not restate the wording.
  - *Design review (Decision 5, Reconsider) — accepted.* The plan's top risk was six-way wording drift. A helper in the §14.11–§14.13 style removes the drift at its source, without the restructuring cost of a shared "common role priorities" section, which stays rejected (see Structural Improvements).
  - It is a separate helper rather than part of §14.14, because the role engines need "which agent owns the requested rework", not §14.14's `{pending, reason}` integrity answer.
- **`hasPendingRoleAction` (§14.14):**
  - *Current consumer:* §14.1.2 3b.
  - *Growth:* the MCP server implementation and any future PM integrity check that needs to know whether a role owns the next step.
  - The helper returns `{pending, reason}` rather than a boolean, so `REVIEW_ABANDONED.integrity_reason` has a source.
- **`rework_stage` / `rework_requested`:**
  - *Current consumers:* §6.2 BLOCKED → IN_PROGRESS, §11.1, §13.1 step 2b, §14.1.2 3d, the six role engines, §14.14, §16.3e.
  - These are typed routing instructions replacing a free-text blocker plus manual PM coordination (§21.43).
- **`MAX_DISPATCHES_WITHOUT_PROGRESS`:**
  - *Consumer:* the orchestrator's dispatch-progress counter (follow-up).
  - It is defined once in §16.3e with its default, and mirrored in Appendix A as every spec constant is.
  - Its Appendix A row states that it is spec-only until the orchestrator follow-up adds it to `shared/workflow-manifest.json`. Without that note, a reader comparing Appendix A against the manifest would take it as a drift defect, like the existing `MAX_HANDOFF_DEPTH` divergence (design review, Decision 9).
- **`rework_stage` ordering rule.** The §21.11 validation reads pipeline state that the same → BLOCKED transition then mutates through auto-cancel. Its correctness depends on evaluation order. §21.11 therefore states it as a pseudocode block with a worked example, not prose alone, so both implementations honour the order (design review, Decision 4). No `raised_by` field is added (see Considered Alternatives).
- **§21.40 and §21.43 are retitled** as the brief proposes (design review, Decision 10, Challenge — accepted):
  - §21.40 becomes "Abandoned WP Detection (No Derivable Next Actor)".
  - §21.43 becomes "Post-Technical-Blocker Unblock Routing (Untargeted Blockers)".
  - A repository-wide search found exactly two inbound links, both in `edge-cases.md` (L214, L746), plus their regenerated `.context/` copies. No source, test, persona or manifest file links to either anchor. Step 6 repairs both links in the same edit, and the Test Plan's anchor sweep is the gate.
  - The brief's "preserve existing cross-reference anchors" constraint is read as "every existing cross-reference keeps resolving". The brief itself proposes both retitles, so it cannot mean the anchor strings are frozen.
  - The v2.10.0 changelog entry names both retitles and their new anchors, for any reader holding an old link.
- **Departures from the amendment brief:**
  - **No TOC or Quick Section Reference rows.** Both list documents and top-level sections only. §14.14, §14.15 and §16.3e sit under the existing §14 and §16 rows.
  - **`constraints-workflow.md` is not changed.** Spec Compliance Rule 6 and the root `AGENTS.md` order are spec → code → tests → manifest. The document records "which function enforces a rule, what error text it emits", and no function enforces these rules yet. The update moves to the implementation follow-up.
  - **The manifest gets no new constant.** `MAX_DISPATCHES_WITHOUT_PROGRESS` has no consumer until the orchestrator follow-up. Adding it to `constants` would also require a schema change and a validator change (`additionalProperties: false`, required keys) in root tooling for a value nothing reads. The follow-up adds it together with its first consumer, the way `constants.max_rework_count` → `orchestrator/src/config.py` works.
- **Plan additions that close holes in the brief's Change 5 design:**
  - **Finalisation guard.** `IN_PROGRESS → COMPLETE` and `FINALIZE_WP` require `rework_requested` to be absent. Otherwise, in the §14.5 5b case (documentation PASS with unmet criteria), the Documentation agent could mark the criteria met and finalise, skipping the requested code rework. The freshness check does not catch this, because the requested implementation pipeline has not started.
  - **Clear on any transition to READY.** `rework_requested` is cleared on `BLOCKED → READY` as well as `IN_PROGRESS → READY`. A WP whose rework was requested can be cascade-reblocked (`dependency`) and then auto-unblocked to READY (§15.4), and must not carry a stale instruction into the next claim.
  - **`REPAIR_TIMESTAMPS` row.** The §16.3e matrix gains a row for this optional PM action (Appendix B, §21.18) as *Fatal*: it is a data repair, like the integrity failure behind `REVIEW_ABANDONED`. This keeps the brief's promise that the matrix covers every PM action.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Meaning of `REVIEW_ABANDONED` | Defensive integrity check (no derivable next actor), evaluated after 3d | Keep the wall-clock definition and add a headless rule; remove 3b entirely | The wall-clock definition is a false positive in every resumed headless run. Removing 3b loses the only signal for hand-edited or corrupt chains. A defensive check costs one helper. |
| `hasPendingRoleAction` validation scope | §9b.2 Rules 1–4 only | Full `validateActiveStages` (Rules 1–5) | Rule 5 rejects pre-v2.6.0 chains that are valid stored data and still route through §9.3.1. Checking it would make idle legacy WPs fatal in headless runs. |
| Headless outcome for judgement actions | Fatal stop (ledger left consistent, resumable) | Cancel (P05's design); dispatch the PM agent | Cancelling silently drops deliverables. The PM node cannot exercise judgement and, being polled first, blocks every other role. A stop costs one human interaction and loses nothing. |
| Mechanical technical escalation | Targeted `rework_stage` routed like a FAIL | Make all `technical` blockers fatal; extend `FAIL_ROUTING_MAP` with backward jumps | All-fatal stops headless runs on the most common escalation. Changing the map alters every FAIL route. A per-blocker target is explicit and opt-in. |
| Where targeted rework is counted | In the existing §11.1 rework branch via `isTargetedRework` | Increment at unblock; a separate counting path | Counting at unblock double-counts in the §21.24 case. A separate path duplicates the circuit breaker. Extending the branch gives exactly one increment under the existing §21.74 persistence. |
| Validating `rework_stage` without knowing who raised the blocker | Ordering rule: strictly before the latest active stage with a non-auto-cancelled pipeline, evaluated before auto-cancel. Stated in §21.11 as a pseudocode block with a worked example | Add a `raised_by` field to `Blocker`; derive the raiser from the calling agent; validate only type and membership in `active_pipeline_stages` | A new field adds data for one check, and the calling agent is undefined for PM-set blocks. Type-and-membership only would permit self-rework and forward targets. The ordering rule is derivable from the ledger and excludes self-rework. Its one weakness is evaluation order (it reads state that auto-cancel then mutates), which the pseudocode block and example make explicit. |
| Where the targeted-rework routing predicate lives | One helper §14.15 `targetedReworkAgent`, cited by 3d, step 2b, the six role engines, §14.14 and the finalisation guard | Restate the priority in each of the six engines; extract a shared "common role priorities" section | Restating it six times invites drift, the plan's top risk. A shared priorities section would restructure six sections and their traceability anchors for one priority. The helper follows §14.11–§14.13 and cuts the duplication to one-line citations. |
| §21.40 / §21.43 headings | Retitle as the brief proposes, and repair the two in-file inbound links (L214, L746) in the same step | Keep the headings and restate the scope in an opening bullet | Kept headings would misdescribe their scope for good, in a spec that agents navigate by heading. A repository-wide search found no inbound link beyond the two in-file ones, and the anchor sweep verifies the repair. |
| Bundling Change 5 into v2.10.0 | One plan, with Change 5 checked as its own group in step 9 | Two plans: Changes 1–4, then Change 5 | A split would publish a v2.10.0 matrix that stops headless runs on technical blockers, then amend it. The grouped sweep addresses the review-load concern without the interim inconsistency. |
| Project manifest timing | Update `constraints-workflow.md` in the implementation follow-up | Update it now (brief) | The manifest is descriptive of code (Compliance Rule 6). Documenting unimplemented enforcement would mislead agents reading it. |

## Pattern Alignment

- **Follows** spec-first amendment with a minor version bump and a README changelog entry that names sections — `mcp-server/docs/agents/workflow-specification/README.md` v2.8.0 / v2.9.0 entries.
- **Follows** helper-algorithm sections `### 14.N \`name\` Algorithm` with a pseudocode fence — `recommendations.md` §14.11–§14.13. Both new helpers (§14.14, §14.15) use it.
- **Follows** letter-suffixed priority sub-items without renumbering; evaluation order is stated in pseudocode comments — `recommendations.md` §14.1.2 (3b/3c/3d).
- **Follows** transition side effects listed inside the §6.2 table row — `state-machines.md` L83–L86, L98–L104.
- **Follows** the headless PM-surrogate pattern (`agent_role: "Project Manager"`, log, best-effort comment, re-query) — `dependencies-and-rework.md` §16.3c. **Departs** in one respect, as the brief states: the new *fatal* outcome stops the run instead of cancelling. It is justified in §16.3e's "Why fatal outcomes are not cancellations" note.
- **Follows** new edge cases opening with `**Introduced:** spec vX.Y.Z, …` and closing with `**Related:**` — `edge-cases.md` §21.74.
- **Follows** optional data-model fields with a trailing section comment — `data-model.md` L73–L80.
- **Follows** `Docs:`-prefixed changelog bullets in the open WIP entries, house style ≤ 100-char lines — `mcp-server/changelog.md` v2.14.0, root `changelog.md` v2.17.0, root `AGENTS.md` Changelog Convention.
- **Follows** headings that describe their section's content — `edge-cases.md` §21.x. Retitling §21.40 and §21.43 keeps that true after their scope changes.
- **Departs from the amendment brief** (not from a codebase pattern) on TOC rows, the `constraints-workflow.md` timing and the manifest constant. Each is justified in Rationale.

## Structural Improvements

| Structure | Observation | Decision | Reason |
|-----------|-------------|----------|--------|
| `recommendations.md` §14.1.2 | 3b precedes 3d, so routable idle WPs are reported as abandoned | Promoted to step 3 | This is the core of the amendment. |
| `recommendations.md` §14.2–§14.5c | Each role engine repeats the priority skeleton in prose; a new priority must be added six times | Promoted to step 3 (shared predicate helper §14.15, cited by a one-line priority in each engine) / Rejected (full skeleton consolidation) — recorded in Deferred Items | The helper puts the new priority's logic in one place at the cost of one section. Extracting a shared "common role priorities" section would restructure six sections and every implementation's traceability references for one new priority. Full consolidation belongs to a dedicated spec-structure plan. |
| `handoff.md` step 2b / `recommendations.md` 3d | The same walk is documented twice | Promoted to step 4 (keep both in sync, both cite §14.15 for the targeted branch, cross-reference §21.70) / Rejected (merge) — recorded in Deferred Items | Merging the two would change the handoff/recommendation section boundaries that both implementations trace to. Citing §14.15 from both removes the duplication of the new branch itself. |
| `operations.md` §11.1 rework branch | Two predicates feed one increment | Promoted to step 2 (`isTargetedRework`) | Single counting path; no duplicated circuit breaker. |
| `state-machines.md` §6.2 READY transitions | Two transitions reach READY | Promoted to step 1 (clear `rework_requested` on both) | Prevents a stale routing instruction after a cascade reblock and auto-unblock. |
| `state-machines.md` §6.2 / `recommendations.md` §14.5, §14.5a | Finalisation has no pending-rework guard | Promoted to steps 1 and 3 | Without it, targeted rework can be bypassed in the §14.5 5b case. |
| `dependencies-and-rework.md` §16.3c | Headless rule exists for one PM action only | Promoted to step 5 (§16.3e generalises it; §16.3c stays as the rework-limit rule it cites) | The amendment's second goal. |
| `edge-cases.md` §21.40, §21.43 headings | The brief retitles them; the only inbound anchors are `edge-cases.md` L214 and L746 | Promoted to step 6 (retitle, repair both links) | Headings that misdescribe their scope are a lasting navigation cost. The two links are repaired in the same edit, and the anchor sweep verifies them. |
| `edge-cases.md` §21.11 | Validation rules are stated in prose | Promoted to step 6 (pseudocode block plus worked example for the `rework_stage` ordering rule) | The rule depends on being evaluated before auto-cancel. Prose alone leaves that order to each implementer's reading. |
| `README.md` TOC / Quick Section Reference | Per-document and per-top-level-§ only | Rejected (new rows) | §14.14, §14.15 and §16.3e are covered by existing rows; adding sub-section rows would break the tables' convention. |
| `shared/workflow-manifest.json` `constants` | Mirrors Appendix A constants; the new constant has no consumer yet | Rejected (add now) — deferred to the implementation follow-up; Appendix A row marked spec-only (step 7) | It requires schema and validator changes in root tooling for a value nothing reads until the orchestrator consumer exists. The spec-only marker keeps the gap from being read as drift. |
| `mcp-server/docs/agents/project-manifest/constraints-workflow.md` | The brief asks for an update now | Rejected (update now) — deferred to the implementation follow-up | Compliance Rule 6 and root `AGENTS.md` order: the manifest documents implemented enforcement. |
| `walkthrough.md` Appendix A `MAX_HANDOFF_DEPTH` 50 vs manifest `max_handoff_depth` 100 | Pre-existing spec-vs-manifest divergence | Rejected — recorded in Deferred Items | It is outside the amendment's topic (handoff depth, §18). Per the user's standing preference, spec divergences get their own slim plan. |

## Detailed Steps

1. **Data model and state machine (Change 5a, 5b, plus plan additions).**
   - `data-model.md`:
     - §3.5: add `rework_stage: PipelineType?` to `Blocker`, with the comment from the brief 5a.
     - §3.3: add `rework_requested: PipelineType?` to `WorkPackageDetail`, with its comment ("Set by BLOCKED → IN_PROGRESS from `blocked_by.rework_stage` (§6.2); cleared when a pipeline of that type is created (§11.1) and on every transition to READY (§6.2)").
     - Add a short note under §3.5 that `rework_stage` is valid only for `type: "technical"` and is validated per §21.11.
   - `state-machines.md` §6.2 rows:
     - **`READY → BLOCKED`, `IN_PROGRESS → BLOCKED`, `BLOCKED → BLOCKED`:** add "`blocked_by.rework_stage` validated per §21.11 (before the auto-cancel side effect)".
     - **`BLOCKED → IN_PROGRESS`:** add the brief 5b side effects (if `technical` with `rework_stage`: set `rework_requested`, append a `HandoffNote` carrying the blocker description, both before `blocked_by` is cleared; no rework-counter change).
     - **`IN_PROGRESS → READY` and `BLOCKED → READY`:** add "Clears `rework_requested`".
     - **`IN_PROGRESS → COMPLETE`:** add "`rework_requested` must be absent (a pending targeted rework blocks finalisation)".
   - Update the L190 summary line so the IN_PROGRESS bullet mentions the `rework_stage` validation and the COMPLETE guard.

2. **Operations (Change 4a, 5c).**
   - `operations.md` §11.1 pseudocode:
     - Define `isTargetedRework = (wp.rework_requested == pipelineType)` next to `isDirectRework` and `isDownstreamRework`.
     - Change the branch to `if isDirectRework OR isDownstreamRework OR isTargetedRework`.
     - After the pipeline is created (never on a refused start), clear `wp.rework_requested` when it equals `pipelineType`.
     - Add a comment that the re-validation guard then forces every downstream stage to re-run.
   - §11.1.2:
     - Add the brief's "Owner continues" bullet verbatim.
     - Add one sentence that no new guard is needed for a targeted start on an already-PASSed stage.
   - §11.2: add the note on the branch condition ("a pending `rework_requested` for the pipeline type counts as rework regardless of the prior-state row"), with the §21.24 double-count explanation.

3. **Recommendation engine (Change 1, 2 pointer, 5d, plus finalisation guard).**
   - `recommendations.md` §14.1.2:
     - Priority 1: add "Headless runs: see §16.3e for the prescribed outcome per blocker type."
     - Replace the 3d and 3b prose with the brief's 1a text. Extend 3d with "if `targetedReworkAgent(wp)` (§14.15) is non-null, route to it with reason "targeted rework" before the stage walk".
     - Pseudocode: move the 3b block after 3d as in brief 1b, add the targeted-rework branch (a call to `targetedReworkAgent(wp)`) at the top of the 3d loop body, and compute `idle_hours` in 3d (since `mostRecentEffectivePipeline.completed_at`, or `wpClaimedDuration` when none).
     - Rewrite the "Priority 3b notes" as in brief 1c, and add a "Priority 3d notes" sentence on FAIL-stage WPs getting no `idle_hours` by design.
   - Add new §14.14 `hasPendingRoleAction` after §14.13, verbatim from the brief 1d (Rules 1–4 only, `rework_requested` check, `{pending, reason}` return, invariant note). Its `rework_requested` check calls `targetedReworkAgent(wp)` (§14.15) rather than restating the lookup.
   - **New §14.15 `targetedReworkAgent` Algorithm** after §14.14, in the §14.11–§14.13 style (heading `### 14.15 \`targetedReworkAgent\` Algorithm`, one pseudocode fence, a "Used by" line):
     - Input: `wp`. Returns `PIPELINE_AGENT_MAP[wp.rework_requested]` when `wp.rework_requested` is set, otherwise null.
     - Notes: the returned agent owns the next step regardless of FAIL routing or the stage walk. The field is set only by §6.2 BLOCKED → IN_PROGRESS and cleared per §3.3. The emitted action is the existing `REWORK`, with reason "targeted rework".
     - "Used by" line: §13.1 step 2b, §14.1.2 3d, §14.2–§14.5c, §14.5/§14.5a finalisation guard, §14.14.
     - This section is the single statement of the targeted-rework routing predicate. Every routing site cites it and does not restate it.
   - §14.9: add one sentence naming the new payload fields (`idle_hours` on `ROUTE_PIPELINE_AGENT`; `idle_hours` and `integrity_reason` on `REVIEW_ABANDONED`), carried unchanged in batch results.
   - Role engines §14.2, §14.3, §14.4, §14.5, §14.5b, §14.5c, in both the priority list and any pseudocode: insert the **REWORK (requested)** priority immediately after the active/stale pipeline checks and before FAIL-driven rework. The priority is one line of the same shape in every engine: "**REWORK (requested):** if `targetedReworkAgent(wp)` (§14.15) is this role, return `REWORK` (reason: targeted rework)". Use the same letter-suffix label in every engine. The brief's 5d wording moves into §14.15's notes, not into the engines.
   - §14.5 and §14.5a:
     - `FINALIZE_WP` is not returned while `targetedReworkAgent(wp)` (§14.15) is non-null.
     - §14.5 priority 5b and the Release Engineer escalation note (`recommendations.md` L292) recommend `rework_stage` on the `technical` blocker.

4. **Routing and handoff mirrors (Change 4b, 5d).**
   - `pipeline-routing.md`:
     - §9.3: add the note that `rework_stage` is the sanctioned backward jump the map cannot express, and does not change `FAIL_ROUTING_MAP`.
     - Release Engineer escalation note (L282): recommend `rework_stage`.
   - `handoff.md`:
     - §13.1 PM step 2b pseudocode (L307): add the same targeted-rework branch as 3d, before the stage walk, as a call to `targetedReworkAgent(wp)` citing §14.15.
     - Freshly-claimed design note (L382): apply brief 4b (the threshold now governs only the defensive `REVIEW_ABANDONED`, and routing ignores `assigned_to`).
     - Release Engineer self-rework note (L227): recommend `rework_stage`.

5. **Headless policy (Change 2).**
   - `dependencies-and-rework.md`:
     - Insert new §16.3e "Headless Resolution of PM Review Actions" after §16.3d, using the brief's 2a text, with the 2c matrix placed after the dispatch-progress paragraph and before "Synthesis precondition".
     - Add a matrix row: `REPAIR_TIMESTAMPS` (optional, §21.18) | Fatal | "Data repair is a human decision; log, comment, stop."
     - Add §21.76 and §21.18 to the Related sections line.
     - §15.4 ⚠ stuck-agent paragraph (L117): apply brief 2b.

6. **Edge cases (Change 3, 5e).** In `edge-cases.md`:
   - **§21.11:** add the `rework_stage` validation as a short prose lead-in followed by a pseudocode block and a worked example:
     - The pseudocode block, in order:
       1. reject unless `blocked_by.type == "technical"`;
       2. reject unless `rework_stage` is in `wp.active_pipeline_stages`;
       3. take a snapshot of the WP's pipelines *before* any side effect of the transition runs;
       4. from that snapshot, find the latest active stage (in `active_pipeline_stages` order) that has at least one non-auto-cancelled pipeline; reject when there is none;
       5. reject unless `rework_stage` comes strictly before that stage;
       6. only then may the transition apply its auto-cancel side effect.
     - A comment in the block states why step 3 comes first: auto-cancel would otherwise remove the raiser's own in-progress pipeline from the evidence, and the rule would compare against the wrong stage.
     - Worked example: stages `implementation → qa → code-review → documentation`; implementation, qa and code-review PASSed; documentation IN_PROGRESS. The Documentation agent blocks with `rework_stage: "implementation"`. The latest stage with a non-auto-cancelled pipeline is documentation, so `implementation`, `qa` and `code-review` are accepted. `rework_stage: "documentation"` (self-rework) is rejected. If auto-cancel ran first, the documentation pipeline would be auto-cancelled and code-review would become the latest stage, so the legitimate target `code-review` would be wrongly rejected as self-rework.
   - **§21.18 (L171):** apply brief 3e — point the mitigation at `ROUTE_PIPELINE_AGENT` / `idle_hours` and `REPAIR_TIMESTAMPS`, not at `REVIEW_ABANDONED`.
   - **§21.19:** add the brief 3d headless bullet.
   - **§21.24:**
     - The Documentation agent SHOULD set `rework_stage: "implementation"`.
     - The manual-coordination sentence (L214) reads "without `rework_stage`, see §21.43". Its link target changes to `#2143-post-technical-blocker-unblock-routing-untargeted-blockers`, matching the retitled heading.
   - **§21.39:** apply brief 3b.
   - **§21.40:**
     - Retitle the heading to `### 21.40 Abandoned WP Detection (No Derivable Next Actor)` (brief L172). The new anchor is `#2140-abandoned-wp-detection-no-derivable-next-actor`.
     - Replace the body with the brief's 3a bullets.
   - **§21.43:**
     - Retitle the heading to `### 21.43 Post-Technical-Blocker Unblock Routing (Untargeted Blockers)` (brief L244, title-cased like the other §21 headings). The new anchor is `#2143-post-technical-blocker-unblock-routing-untargeted-blockers`.
     - Add an opening bullet: since v2.10.0, a targeted blocker (§3.5 `rework_stage`) routes automatically via `rework_requested` (§14.15), and this section covers untargeted blockers only.
     - Keep the existing options for untargeted blockers unchanged.
   - **§21.48 (L415) and §21.56 (L492):** where a `technical` blocker is recommended for code-level issues, recommend `rework_stage`.
   - **§21.49:** apply brief 3c to both ⚠ bullets.
   - **§21.70:**
     - Scenario (b) and the related-sections line (L746): point the threshold reference at the defensive `REVIEW_ABANDONED`.
     - L746: change the §21.40 link target to `#2140-abandoned-wp-detection-no-derivable-next-actor`.
     - Add a sentence that targeted rework routes before the walk (§14.15), in both 3d and step 2b.
   - **§21.74:** add the refused targeted start (count persisted, no pipeline created, `rework_requested` retained, `REVIEW_REWORK_LIMIT` takes over).
   - **New §21.76 "Invalid `rework_stage` on a Technical Blocker":** use the brief's text, with `**Introduced:** spec v2.10.0` and a `**Related:**` line (§3.5, §6.2, §21.11, §21.24, §21.43).

7. **Reference appendices (Change 4c, 4d).** In `walkthrough.md`:
   - **Appendix A:** add `MAX_DISPATCHES_WITHOUT_PROGRESS` | 3 | "Consecutive dispatches without progress before a headless orchestrator treats a routable WP as halted (§16.3e). Spec-only until the orchestrator implementation adds it to `shared/workflow-manifest.json` `constants`; its absence there is not drift."
   - **Appendix B:**
     - Apply brief 4c to the `REVIEW_ABANDONED` row.
     - Add a `ROUTE_PIPELINE_AGENT` row (PM; the routing walk, targeted rework first, carries `idle_hours`).
     - Append "headless: §16.3e" to the `UNBLOCK_WP`, `REVIEW_STALE` and `REPAIR_ORPHAN_BLOCKED` rows.
     - Change the `REWORK` row's "Emitted By" to "Any pipeline owner", with the targeted case named.
   - **Appendix C:** add `Update Status | Invalid rework_stage` (§21.11, §21.76) and `Update Status | Rework pending` (COMPLETE refused while `rework_requested` is set).
   - **Invariant sweep:** search `walkthrough.md` and `edge-cases.md` for statements that every IN_PROGRESS WP is surfaced to some role. Keep them and cite 3d and §14.14. Record "none found" in the pipeline summary if there are none.

8. **Version and changelogs.**
   - `README.md`:
     - Set `**Version:** 2.10.0` and `**Date:**` to the run date.
     - Add a `### v2.10.0 - Abandoned-WP Detection Narrowed to Integrity Failures; Headless Resolution of PM Actions; Targeted Technical Blockers` entry at the top of the Changelog, in the existing bold-lead bullet style.
     - The entry names every touched section: §3.3, §3.5, §6.2, §9.3, §11.1, §11.1.2, §11.2, §13.1, §14.1.2, §14.2–§14.5c, §14.9, §14.14, §14.15, §15.4, §16.3e, §21.11, §21.18, §21.19, §21.24, §21.39, §21.40, §21.43, §21.48, §21.49, §21.56, §21.70, §21.74, §21.76, Appendices A–C.
     - It names the two optional fields and states that existing ledgers need no migration.
     - It names the §21.40 and §21.43 retitles with their new anchors.
     - Do not add TOC or Quick Section Reference rows.
   - `shared/workflow-manifest.json`: set `spec_version` to `"2.10.0"`. No other field changes.
   - `mcp-server/changelog.md` (open v2.14.0 WIP entry): add one `Docs:` bullet summarising the v2.10.0 amendment.
   - Root `changelog.md` (open v2.17.0 WIP entry): add one `Docs:` bullet, keeping the module-reference line accurate.

9. **Consistency sweep and verification.**
   - Run every check in the Test Plan and fix any finding in the spec text it points to.
   - Run the checks in two groups and report them separately in the pipeline summary:
     - **Changes 1–4** (abandoned detection, headless matrix, edge-case remedies, owner-continues): AC-01 to AC-07.
     - **Change 5** (targeted technical blockers): AC-08 to AC-12 and AC-19, including a side-by-side read of every §14.15 citation site.
     - The shared checks (anchors, appendices, version, changelogs, language, `.context/`) follow both groups.
   - Regenerate generated context with `node scripts/cli.js ctx-generate`, then confirm `node scripts/cli.js ctx-generate --check` exits 0. Any `.context/` file outside the three listed in Required Components that the regeneration touched is drift: it is not counted toward AC-17, and reverting it by path is left to the Git Committer after the run, so `--check` runs against the full regenerated set.
   - Commit handling of `.context/` follows the Git Committer's generated-artefact policy and is not part of this step.

## Dependencies

- Step 2 depends on step 1 (it references `rework_requested` and the §6.2 clearing rules).
- Step 3 depends on steps 1 and 2 (field semantics, owner-continues rule, counting).
- Step 4 depends on step 3 (it mirrors the 3d branch).
- Step 5 depends on step 3 (§16.3e cites §14.14, `idle_hours`, `integrity_reason`).
- Step 6 depends on steps 1–5 (edge cases describe all of them).
- Step 7 depends on steps 3, 5 and 6 (action fields, the constant, error conditions).
- Step 8 depends on steps 1–7 (the changelog lists the final section set).
- Step 9 depends on step 8.

## Required Components

- `mcp-server/docs/agents/workflow-specification/data-model.md` (modified)
- `mcp-server/docs/agents/workflow-specification/state-machines.md` (modified)
- `mcp-server/docs/agents/workflow-specification/operations.md` (modified)
- `mcp-server/docs/agents/workflow-specification/recommendations.md` (modified; **new** sections §14.14 and §14.15)
- `mcp-server/docs/agents/workflow-specification/pipeline-routing.md` (modified)
- `mcp-server/docs/agents/workflow-specification/handoff.md` (modified)
- `mcp-server/docs/agents/workflow-specification/dependencies-and-rework.md` (modified; **new** section §16.3e)
- `mcp-server/docs/agents/workflow-specification/edge-cases.md` (modified; **new** section §21.76)
- `mcp-server/docs/agents/workflow-specification/walkthrough.md` (modified)
- `mcp-server/docs/agents/workflow-specification/README.md` (modified)
- `shared/workflow-manifest.json` (modified, `spec_version` only)
- `mcp-server/changelog.md`, `changelog.md` (modified)
- `.context/mcp-server/workflow-spec-state.md`, `workflow-spec-operations.md`, `workflow-spec-edge-cases.md` (regenerated)

## Assumptions

- `docs/agents/projects/revise-specification.md` is the final, user-approved content source. Where this plan departs from it, the departure is stated in Rationale.
- The user has retired P05. No step reads from or writes to `docs/agents/plans/2026-10-06-p05-headless-pm-review-actions/`.
- The run date is used for the README `**Date:**` line.
- The open WIP entries (`mcp-server` v2.14.0, root v2.17.0) are still unreleased when the run starts.

## Constraints

- No changes under `mcp-server/src/`, `mcp-server/tests/`, `orchestrator/`, `personas/`, `scripts/` or `shared/workflow-manifest.schema.json`.
- No new action names. The new payload fields are `idle_hours` and `integrity_reason`. The new data fields are `Blocker.rework_stage` and `WorkPackageDetail.rework_requested`.
- Normative text uses language-agnostic pseudocode. It contains no TypeScript or Python symbols.
- Every existing `§`-anchor link keeps resolving. Where a heading is retitled (§21.40, §21.43 only), every inbound link is updated in the same step. New sections use the existing heading/anchor style.
- Interactive behaviour changes are confined to Change 1 (routable idle WP → `ROUTE_PIPELINE_AGENT` with `idle_hours`) and Change 5 (targeted technical blockers route automatically). Each carries its rationale in the spec text.
- Changelog lines follow house style (≤ 100 characters, category prefix, flat list).

## Out of Scope

- **Implementation** in the MCP server (`recommendations.ts`, `workflow-next-action*.ts`, status-update validation, `startPipeline`, schemas) and the orchestrator (§16.3e matrix, resume sweep, dispatch-progress counter).
- **Tests** for the new behaviour.
- **Manifest updates:** `mcp-server/docs/agents/project-manifest/constraints-workflow.md`, `api-surface.md`, `data-flows.md` and `orchestrator/docs/supervisor-routing.md`, to be made after implementation.
- **Persona updates:** Ledger Doctor Repair 10, and the Documentation and Release Engineer escalation guidance to set `rework_stage`.
- **Manifest constant:** adding `max_dispatches_without_progress` to `shared/workflow-manifest.json` `constants` and its schema and validator.
- **Handoff-depth divergence:** the `MAX_HANDOFF_DEPTH` divergence between the spec (50) and the manifest (100).
- **P05:** retiring or editing the P05 plan folder.

## Human Actions

| # | Action | When | Why an agent cannot do it |
|---|--------|------|---------------------------|
| 1 | Retire the `docs/agents/plans/2026-10-06-p05-headless-pm-review-actions/` folder (delete or archive it; it has uncommitted edits) | After the run | The folder is the user's planning artefact, and retiring it is the user's decision. |
| 2 | Commit the spec, manifest, changelog and regenerated `.context/` changes per the generated-artefact policy (Git Committer). On a feature branch (currently `feature-pipeline-adjustments`), root `AGENTS.md` row "CTX context output changed" makes all `.context/` output drift that stays out of the commit; the Git Committer is the authority and decides. | After the run | Agents in this workflow do not run Git write commands. |
| 3 | Commission the implementation follow-up plan(s) from the Deferred Items table | After the run | Starting a new planning cycle is the user's call. |

## Acceptance Criteria

- AC-01: §14.1.2 evaluates 3b after 3d in both prose and pseudocode. 3b includes the `hasPendingRoleAction` guard and is labelled defensive.
- AC-02: `ROUTE_PIPELINE_AGENT` documents `idle_hours` (in §14.1.2 and §14.9). `REVIEW_ABANDONED` documents `idle_hours` and `integrity_reason`. No text in the spec still names `has_effective_pipeline`.
- AC-03: §14.14 exists after §14.13, returns `{pending, reason}`, checks only §9b.2 Rules 1–4, handles `rework_requested`, carries the invariant note, and is referenced from §14.1.2, §21.39, §21.40 and §21.49.
- AC-04: §16.3e exists after §16.3d. It follows the §16.3c pattern (PM-surrogate rules, synthesis note, related sections) and contains the headless matrix with a row for every PM action in Appendix B, including `REPAIR_TIMESTAMPS`. `REVIEW_ABANDONED`, `decision`/`external` blockers and untargeted `technical` blockers are fatal; targeted `technical` blockers are automatic. It is referenced from §14.1.2, §21.19, §21.40 and §21.49.
- AC-05: `MAX_DISPATCHES_WITHOUT_PROGRESS` is defined once in §16.3e, with default 3 and its progress-signature basis, and appears in Appendix A with a note that it is spec-only until the orchestrator implementation adds it to the shared manifest.
- AC-06: §11.1.2 states the owner-continues rule. §15.4 no longer recommends proactive unclaim. §21.49 no longer calls a PM-claimed WP a permanent dead end in headless runs.
- AC-07: No sentence in the spec prescribes re-claiming, override-claiming or unclaiming as the remedy for an abandoned WP.
- AC-08: `Blocker.rework_stage` (§3.5) and `WorkPackageDetail.rework_requested` (§3.3) are defined as optional fields. `rework_stage` is validated on every → BLOCKED transition by the §21.11 ordering rule, evaluated before auto-cancel. §21.11 states the rule as a pseudocode block that takes the pipeline snapshot before any side effect, followed by a worked example showing the self-rework rejection and the result if auto-cancel ran first.
- AC-09: §6.2 sets `rework_requested` on BLOCKED → IN_PROGRESS without changing rework counts, clears it on both transitions to READY, and refuses IN_PROGRESS → COMPLETE while it is set. §14.5/§14.5a do not return `FINALIZE_WP` while it is set.
- AC-10: §11.1 counts a targeted start exactly once via `isTargetedRework` in the existing branch, clears `rework_requested` only on pipeline creation, and §11.2 and §21.74 document the refused-start case.
- AC-11: §13.1 step 2b, §14.1.2 3d and all six role engines (§14.2, §14.3, §14.4, §14.5, §14.5b, §14.5c) route a pending `rework_requested` by citing `targetedReworkAgent` (§14.15), using the existing `REWORK` action. The six engine priorities have the same one-line shape and label, and none restates the `PIPELINE_AGENT_MAP[wp.rework_requested]` lookup.
- AC-12: §21.24, §21.43, §21.48, §21.56, §14.5 priority 5b and the Release Engineer escalation notes in §9.3.1/§13.1/§14.5c recommend `rework_stage`. §21.43 states that it covers untargeted blockers only. §21.76 exists with the first-active-stage rejection sentence.
- AC-13: §21.40 is titled "Abandoned WP Detection (No Derivable Next Actor)" and §21.43 "Post-Technical-Blocker Unblock Routing (Untargeted Blockers)". The links at `edge-cases.md` L214 and L746 point at the new anchors, no link anywhere in the spec directory still uses the old anchors, and every `](…#…)` anchor link in the spec directory resolves to an existing heading.
- AC-14: Appendix B has a `ROUTE_PIPELINE_AGENT` row and the updated `REVIEW_ABANDONED`, `REWORK` and headless-pointer rows. Appendix C has the `Invalid rework_stage` and `Rework pending` rows.
- AC-15: README `**Version:**` reads 2.10.0. The changelog entry lists every touched section and both new fields, names the §21.40 and §21.43 retitles, and states that no migration is needed. TOC and Quick Section Reference are unchanged. `shared/workflow-manifest.json` `spec_version` is `"2.10.0"`, and no other manifest field changed.
- AC-16: `mcp-server/changelog.md` and root `changelog.md` WIP entries each carry one house-style `Docs:` bullet for the amendment.
- AC-17: No file outside the Required Components list was changed, and normative text contains no TypeScript or Python symbols. Excluded from this check: the plan folder itself, and any other `.context/` file touched by the full regeneration in step 9 (drift, not counted; the Git Committer reverts it by path after the run).
- AC-18: `.context/` is regenerated and `node scripts/cli.js ctx-generate --check` exits 0 in the working tree. Whether the regenerated `.context/` files are committed is not part of this criterion.
- AC-19: §14.15 `targetedReworkAgent` exists after §14.14 in the `### 14.N \`name\` Algorithm` style, returns `PIPELINE_AGENT_MAP[wp.rework_requested]` or null, carries a "Used by" line, and is cited from §13.1 step 2b, §14.1.2 3d, the six role engines, §14.5/§14.5a and §14.14.

## Testing Strategy

The plan changes no code, so verification is consistency checking of the specification plus the existing automated guards on the version line. Automated: the manifest validator and the existing manifest parity test suite. Mechanical: scripted grep/anchor sweeps whose expected output is stated below. Review: QA reads each changed section against the amendment brief and this plan's departures; code review checks cross-file consistency (3d ↔ step 2b ↔ role engines ↔ §14.15 ↔ §14.14 ↔ §16.3e matrix).

## Test Plan

- `node scripts/validate-workflow-manifest.js` — exits 0 with `spec_version` 2.10.0 — AC-15
- `cd mcp-server && npx vitest run tests/utils/workflow-manifest.test.ts` — `SPEC_VERSION matches manifest spec_version` and `manifest spec_version matches the workflow specification README Version line` pass — AC-15
- `git diff --stat -- mcp-server/docs/agents/workflow-specification shared mcp-server/changelog.md changelog.md .context/mcp-server` — only the Required Components paths changed; any other `.context/` file in the output is regeneration drift and not counted; the plan folder is out of the check — AC-15, AC-17
- Anchor sweep (throwaway script in the session scratch directory): extract every `](file.md#anchor)` and `](#anchor)` link under `mcp-server/docs/agents/workflow-specification/`, slugify every heading, and report unresolved links. The expected result is zero — AC-13
- `grep -n "^### 21.40\|^### 21.43" edge-cases.md` — the headings read "Abandoned WP Detection (No Derivable Next Actor)" and "Post-Technical-Blocker Unblock Routing (Untargeted Blockers)" — AC-13
- `grep -rn "2140-abandoned-wp-detection-claimed-but-no-pipeline\|2143-post-technical-blocker-unblock-routing)" mcp-server/docs/agents/workflow-specification/` — no matches (old anchors gone); the L214 and L746 links use the new anchors — AC-13
- `grep -rn "has_effective_pipeline" mcp-server/docs/agents/workflow-specification/` — no matches — AC-02
- `grep -rn -i "re-claim\|override-claim\|proactively unclaim" mcp-server/docs/agents/workflow-specification/` — every remaining match is unrelated to abandoned-WP remedies (listed and justified in the QA summary) — AC-07
- `grep -n "§14.14" recommendations.md edge-cases.md` — references present in §14.1.2, §21.39, §21.40, §21.49 — AC-03
- `grep -rn "§16.3e" mcp-server/docs/agents/workflow-specification/` — references present in §14.1.2, §21.19, §21.40, §21.49 — AC-04
- `grep -rn "MAX_DISPATCHES_WITHOUT_PROGRESS" mcp-server/docs/agents/workflow-specification/` — one definition (§16.3e) plus the Appendix A row and references only — AC-05
- `grep -rn "rework_requested" mcp-server/docs/agents/workflow-specification/` — present in §3.3, §6.2 (set, both READY clears, COMPLETE guard), §11.1, §11.2, §14.15, §16.3e, §21.74. In §13.1 step 2b, §14.1.2 3d, the six role engines, §14.5/§14.5a and §14.14, any match is prose only: none restates the `PIPELINE_AGENT_MAP[wp.rework_requested]` lookup outside §14.15 — AC-09, AC-10, AC-11
- `grep -rn "targetedReworkAgent\|§14.15" mcp-server/docs/agents/workflow-specification/` — the §14.15 definition plus citations in §13.1 step 2b, §14.1.2 3d, §14.2, §14.3, §14.4, §14.5, §14.5a, §14.5b, §14.5c and §14.14; the six engine priorities are the same one-line shape under the same label — AC-11, AC-19
- §14.15 review — heading style `### 14.15 \`targetedReworkAgent\` Algorithm`, one pseudocode fence, null return when `rework_requested` is absent, "Used by" line matching the citation list — AC-19
- §21.11 review — the pseudocode block takes the pipeline snapshot before any side effect and rejects in the stated order; the worked example shows `documentation` rejected as self-rework and the `code-review` misrejection if auto-cancel ran first — AC-08
- `grep -rn "rework_stage" mcp-server/docs/agents/workflow-specification/` — present in §3.5, §6.2 BLOCKED rows, §9.3, §13.1 (Release Engineer note), §14.5 5b, §14.5c, §21.11, §21.24, §21.43, §21.48, §21.56, §21.76, §16.3e — AC-08, AC-12
- §16.3e matrix review — the action set in the matrix equals the PM-emitted actions in Appendix B plus `WAIT` — AC-04
- Language-agnostic check — `git diff -U0 -- mcp-server/docs/agents/workflow-specification | grep '^+' | grep -nE '\.ts\b|\.py\b|\bdef |=>|\bconst |self\.'` — no matches in added lines — AC-17
- §21.40 / §21.43 / §21.49 / §15.4 / §11.1.2 read-through — the wording matches the brief's resolved positions — AC-06, AC-07, AC-12
- Changelog line-length check — every new changelog line in `mcp-server/changelog.md` and `changelog.md` is ≤ 100 characters after unwrapping — AC-16
- `node scripts/cli.js ctx-generate --check` — exits 0 after regeneration — AC-18
- Appendix review — `ROUTE_PIPELINE_AGENT`, `REVIEW_ABANDONED`, `REWORK`, `Invalid rework_stage`, `Rework pending`, and `MAX_DISPATCHES_WITHOUT_PROGRESS` rows present; the last carries the spec-only note — AC-05, AC-14
- README changelog review — the v2.10.0 entry lists §14.15 and names both retitles with their new anchors — AC-15
- §14.1.2 pseudocode review — the 3b block follows the 3d block, contains the guard, and returns `integrity_reason` — AC-01, AC-02

## Documentation Updates

- `mcp-server/docs/agents/workflow-specification/README.md` — version header, date, v2.10.0 changelog entry (step 8)
- `mcp-server/docs/agents/workflow-specification/walkthrough.md` — Appendices A, B, C (step 7)
- `shared/workflow-manifest.json` — `spec_version` (step 8; required by the spec README "Machine-Readable Vocabulary" and the parity test)
- `mcp-server/changelog.md` — `Docs:` bullet in the v2.14.0 WIP entry (root `AGENTS.md` Changelog Convention, module first)
- `changelog.md` — `Docs:` bullet in the v2.17.0 WIP entry (root summarises modules)
- `.context/mcp-server/workflow-spec-state.md`, `workflow-spec-operations.md`, `workflow-spec-edge-cases.md` — regenerated via `node scripts/cli.js ctx-generate` (insight `53454e24-…`; sources in `mcp-server/module-context.yaml` L162–L205)
- `mcp-server/docs/agents/project-manifest/constraints-workflow.md` — **deliberately not updated in this plan** (Compliance Rule 6); carried in Deferred Items

## Deferred Items

| # | Deferred Item | Origin | Reason Deferred | Notes |
|---|---------------|--------|-----------------|-------|
| 1 | MCP server: `hasPendingRoleAction`, 3b after 3d, `idle_hours` / `integrity_reason` payloads (`workflow-next-action.ts`, `workflow-next-action-batch.ts`) | Amendment brief, Follow-ups | Spec-only plan | Implementation plan, spec v2.10.0 |
| 2 | MCP server + schemas: `rework_stage` validation, BLOCKED → IN_PROGRESS side effects, READY clears, COMPLETE guard, `isTargetedRework` in `startPipeline`, REWORK-requested priority in every role engine | Amendment brief, Follow-ups (Change 5) and plan additions | Spec-only plan | Same implementation plan. The status-transition rules land in the guard block of `updateWorkPackageStatus` (`mcp-server/src/tools/work-package.ts` L688–L835), which `docs/agents/plans/2026-10-19-p07-status-guard-spec-alignment/` extracts into a pure helper module. Sequence that plan first and add these rules to the extracted helper. |
| 3 | MCP server tests: post-unblock re-claim grace case (briefing gap 6); legacy pre-v2.6.0 WP idle > 24 h → routed, not flagged; double-count prevention; refused targeted start | Amendment brief, Follow-ups | Spec-only plan | Tests reference §-sections per Compliance Rule 4 |
| 4 | Orchestrator: §16.3e matrix (fatal stops, automatic targeted unblock), resume-time §21.68 sweep, dispatch-progress counter and halted handling | Amendment brief, Follow-ups | Spec-only plan | Supersedes the retired P05 design. P05's event-naming and supervisor-routing research can be mined for that plan. |
| 5 | `shared/workflow-manifest.json` `constants.max_dispatches_without_progress` + schema + validator + `orchestrator/src/config.py` consumer | This plan (Structural Improvements) | No consumer before item 4 | Add together with item 4 |
| 6 | `mcp-server/docs/agents/project-manifest/constraints-workflow.md`, `api-surface.md`, `data-flows.md`; `orchestrator/docs/supervisor-routing.md` | Amendment brief (constraints-workflow), this plan | Compliance Rule 6: manifests document implemented behaviour | After items 1–4 |
| 7 | Ledger Doctor Repair 10 ladder; Documentation and Release Engineer persona guidance to set `rework_stage` | Amendment brief, Follow-ups | Personas sub-project; behaviour must exist first | After items 1–2 |
| 8 | Verify that orchestrator dispatch prompts follow the role engine rather than re-running a stage on a re-claimed WP | Amendment brief, Follow-ups | Verification belongs with item 4 | — |
| 9 | `MAX_HANDOFF_DEPTH` divergence: spec Appendix A / §18.2 say 50, manifest `max_handoff_depth` says 100 | Found during this plan's research | Outside the amendment's topic | Slim stub plan, per the user's preference for spec divergences |
| 10 | Spec-structure consolidation: a shared "common role priorities" section for §14.2–§14.5c, and folding §13.1 step 2b into a reference to §14.1.2 3d | This plan (Structural Improvements); design review Decisions 5 and 11 | Restructures section boundaries and implementation traceability anchors beyond this amendment's blast radius | Dedicated spec-structure plan. §14.15 already removes the new priority's duplication, so the plan can start from it. |

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **The six role engines diverge in wording or placement of the new priority** | The predicate lives once in §14.15, and each engine carries only a one-line citation with one placement rule (step 3). The §14.15 grep in the Test Plan enumerates every citation site, and code review checks them side by side. |
| **3d and step 2b drift apart** | Both cite §14.15 for the targeted branch (steps 3 and 4), and §21.70 states that the guards are identical. Code review compares both blocks. |
| **Implementations apply the §21.11 ordering rule after auto-cancel** | §21.11 states the rule as ordered pseudocode with the snapshot step first, and a worked example shows the wrong result of the other order (AC-08). |
| **Anchor breakage from new or retitled headings** | Only §21.40 and §21.43 are retitled; their two inbound links are repaired in the same step, and no other repository file links to them (verified). A scripted anchor sweep plus an old-anchor grep covers every link in the directory (AC-13). `.context/` copies are regenerated in step 9. |
| **The spec documents behaviour the server does not have, and agents act on it** | Compliance Rule 2 already makes the spec authoritative. The changelog entry states that implementation follows. The project manifest is left describing current code until the implementation plan. |
| **A WP blocked by an interactive agent at the rework limit with an untargeted `technical` blocker becomes fatal in a headless run (priority 1 `UNBLOCK_WP` precedes priority 2)** | Fatal is the safe outcome: nothing is cancelled and the run resumes after a human acts. This is recorded here for the implementation plan, which may route such WPs to the §16.3c rule if it proves common. |
| **The Version-line parity test fails if the README and manifest are bumped in different steps** | Both are bumped in step 8, and the test runs in step 9. |
| **Generated `.context/` drift on the feature branch is committed incorrectly** | The plan regenerates only. Committing is a human action that follows the Git Committer policy. |

## Recommended Workflow
- **Workflow:** ledger
- **Rationale:** The amendment touches ten spec files plus the manifest and changelogs, introduces two data-model fields and a new step in every role engine, and depends on cross-file consistency that benefits from separate QA and code-review stages.
