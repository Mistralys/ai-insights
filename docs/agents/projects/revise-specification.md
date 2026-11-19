# Spec Amendment Brief: Headless Handling of REVIEW_ABANDONED and REVIEW_STALE (v2.10.0)

Oct 22, 2026 · @smordziol

## Purpose and scope

Amend workflow specification v2.9.0 to v2.10.0 so that `REVIEW_ABANDONED` no longer fires for work packages that have a routable next actor, and so that headless orchestrators have a prescribed resolution for `REVIEW_ABANDONED` and `REVIEW_STALE`. This brief is the output of review `REVIEW_ABANDONED` (briefing dated 2026-10-19); it is spec-only.

Files to change, all under `mcp-server/docs/agents/workflow-specification/` unless noted:

| File | Sections touched |
| --- | --- |
| `recommendations.md` | §14.1.2 (priority 3b, 3d, pseudocode, notes), §14.2–§14.5c (REWORK-requested priority), new §14.14 |
| `dependencies-and-rework.md` | new §16.3e, §15.4 stuck-agent note |
| `edge-cases.md` | §21.11, §21.19, §21.24, §21.39, §21.40, §21.43, §21.49, new edge case for invalid `rework_stage` |
| `operations.md` | §11.1 (`startPipeline` clearing and rework count), §11.1.2 (owner continues), §11.2 (rework count table) |
| `data-model.md` | §3.3 `WorkPackage.rework_requested`, §3.5 `Blocker.rework_stage` |
| `state-machines.md` | §6.2 transition table: BLOCKED → IN_PROGRESS side effects, IN_PROGRESS → READY clearing |
| `pipeline-routing.md` | §9.3 note on `rework_stage` |
| `handoff.md` | §13.1 step 2b (targeted rework routing) and its note |
| `walkthrough.md` | Appendix B action table: `REVIEW_ABANDONED` row, new `ROUTE_PIPELINE_AGENT` row |
| `README.md` | changelog entry v2.10.0, version header, TOC, Quick Section Reference |
| `shared/workflow-manifest.json` | `spec_version` → `2.10.0` |
| `mcp-server/docs/agents/project-manifest/constraints-workflow.md` | after the spec, per root `AGENTS.md` |

Constraints the agent must respect:

- Spec text only. No changes under `mcp-server/src/` or the orchestrator in this task. Implementation consequences are listed in the follow-ups section, not designed.
- The spec is language-agnostic and serves the TypeScript MCP server and the Python orchestrator. Keep the pseudocode style of the surrounding sections; do not reference TypeScript or Python symbols in normative text.
- Changes to interactive (human-PM) behaviour are confined to Change 1 (a routable idle WP yields `ROUTE_PIPELINE_AGENT` with `idle_hours`) and Change 5 (a targeted technical blocker routes its rework automatically on unblock). Each must carry its rationale in the spec text.
- Follow the §16.3c precedent (orchestrator acts as PM surrogate with `agent_role: "Project Manager"`, logs, comments, re-queries) wherever a headless rule is written; departures are stated and justified in the text.
- Preserve existing cross-reference anchors. New sections get anchors in the existing style and are added to the Table of Contents and the Quick Section Reference in `README.md`.
- Section and line references below were taken from the compiled v2.9.0 spec; verify them against the split files before editing.

## Specification position

A work package is abandoned only when the ledger yields no pipeline-role action for it. Wall-clock idleness is evidence, not the definition. The current 3b condition (IN_PROGRESS, no running pipeline, idle ≥ `STALE_PIPELINE_HOURS`) describes a state that in a consistent ledger always has a derivable next actor: the §14.1.2 priority-3d walk routes it (including zero-pipeline WPs, scenario b), a FAIL stage routes to the fail-target agent via `FAIL_ROUTING_MAP`, and an all-PASS WP routes to the terminal agent's `FINALIZE_WP`. What 3b measures is therefore "nobody has shown up for 24 h" — an availability problem, not a ledger state — and because 3b sits above 3d it masks the correct action behind two worse ones.

Consequences the agent should carry into every wording decision:

1. Detection changes first. 3b gains a `hasPendingRoleAction` guard and moves below 3d. Resolution rules are written only for what remains after that: structurally unroutable WPs.
2. The meaning of "abandoned" is the same in both run modes. Headless runs only make the false positive systematic (a paused run leaves every between-stage WP idle). §21.40's "the agent likely crashed" becomes one possible cause, not the definition.
3. Run-relative idleness lives in the orchestrator, not the ledger. The ledger has no run concept; the orchestrator knows on resume that none of its agents are running and may act immediately (§21.68 sweep) instead of waiting 24 h. The ledger's thresholds are unchanged.
4. The pipeline-type owner may always continue an IN_PROGRESS WP. `startPipeline` (§11.1) already reassigns `assigned_to` and does not gate on it; the spec says so implicitly and should say so explicitly.
5. The listed remedies are demoted. Unclaim detours through the Developer (only the Developer claims unassigned READY WPs; other roles claim only WPs assigned to them, so a WP whose `implementation` stage is inactive becomes claimable by nobody). Re-claim does not clear the condition because detection keys on pipeline completion time, not claim time. Cancel is correct only when work exists that cannot be routed.

Two claims in the briefing are corrected rather than adopted:

- Gap 6 (grace-period prose vs pseudocode) is not a spec divergence: both read "flagged ⇔ idle ∧ claimed ≥ threshold". Any implementation that skips the grace check when an effective pipeline exists is an implementation deviation; it only matters for a WP re-claimed after unblock less than 24 h ago whose last pipeline is older. Listed as a test follow-up, not a spec change.
- "Unclaim causes completed work to be redone" is not supported by §14.2: Developer priority 6 (`IMPLEMENT`) requires no implementation pipeline. The real cost is a wasted Developer dispatch and a wrong `assigned_to`. The conclusion that unclaim is the wrong remedy stands either way.

## Change 1 — recommendations.md §14.1.2 and new §14.14

This is one of the two interactive changes (the other is Change 5). A routable idle WP now yields `ROUTE_PIPELINE_AGENT` with `idle_hours` instead of `REVIEW_ABANDONED`. Rationale to state in the text: routing is strictly better than either listed remedy (unclaim detours through the Developer, re-claim does not clear the condition), and the PM keeps the idle signal through `idle_hours`.

**1a. Priority list.** Replace item 3b and amend item 3d. Keep 3c where it is. New order of the sub-items is 3, 3c, 3d, 3b — renumber only if the file's convention requires it; otherwise keep the labels and note the evaluation order in the pseudocode.

```markdown
3d. **ROUTE_PIPELINE_AGENT**: (unchanged condition) … The action output carries `idle_hours` — hours since the most recent effective pipeline completed (`mostRecentEffectivePipeline` §14.11), or since the claim (`wpClaimedDuration` §14.12) when no effective pipeline exists — so the PM can see that a routable WP has sat untouched. Evaluated before 3b. WPs whose current stage has FAILed are deliberately not reported here: the fail-target agent's own engine returns the pending REWORK, so no PM action is needed and no idle signal is emitted for them.

3b. **REVIEW_ABANDONED** (defensive): Any WP is IN_PROGRESS with no IN_PROGRESS pipeline AND no pipeline completed within `STALE_PIPELINE_HOURS` (or no pipelines at all) AND the WP has been IN_PROGRESS for at least `STALE_PIPELINE_HOURS` AND `hasPendingRoleAction(wp)` (§14.14) is false. On a ledger whose chains satisfy §9b.2 Rules 1–4 this condition is unreachable: every IN_PROGRESS WP has a derivable next actor and is reported by 3d, by a fail-target's REWORK, or by the terminal agent's FINALIZE_WP. The action therefore signals a ledger-integrity failure (e.g. a hand-edited or invalid `active_pipeline_stages`). The PM should repair the WP's active stages (§12.3c) or cancel it. In headless runs it is fatal (§16.3e).
```

**1b. Pseudocode.** Move the 3b block after the 3d block and add the guard:

```pseudocode
  // Priority 3b: Abandoned WPs — defensive; evaluated after 3d (see notes below)
  for each IN_PROGRESS WP with no IN_PROGRESS pipeline:
    effectivePipeline = mostRecentEffectivePipeline(wp)
    if wp.pipelines is empty OR effectivePipeline is null OR effectivePipeline.completed_at < (now() - STALE_PIPELINE_HOURS):
      if wpClaimedDuration(wp) < STALE_PIPELINE_HOURS:
        continue
      result = hasPendingRoleAction(wp)
      if result.pending:
        continue    // a pipeline role owns the next step; 3d or the role's engine reports it
      return REVIEW_ABANDONED with wp.id, wp.assigned_to, idle_hours, integrity_reason = result.reason
```

In the 3d block, compute `idle_hours` as described in 1a and include it in the returned action.

**1c. Notes.** Rewrite the "Priority 3b notes" paragraph: keep the grace-period and `mostRecentEffectivePipeline` sentences; state openly that with the `hasPendingRoleAction` guard 3b cannot fire on a ledger whose chains satisfy §9b.2 Rules 1–4 (legacy chains failing Rule 5 still route) and exists as an integrity check (`integrity_reason` names what the helper could not resolve); add why 3b sits below 3d (an idle but routable WP is a dispatch problem, and the correct PM action is to dispatch). Add the sentence on FAIL-stage WPs from 1a: they get no `idle_hours` signal by design because the fail-target's REWORK is already pending.

**1d. New §14.14 `hasPendingRoleAction`.** Add after §14.13:

````markdown
### 14.14 `hasPendingRoleAction` Algorithm

Returns whether a pipeline-role action for the WP can be derived from the ledger, i.e. some agent other than the Project Manager has a next step, and if not, why. Used by `REVIEW_ABANDONED` (§14.1.2, priority 3b) so that idle WPs with an owner are routed rather than flagged as abandoned.

```pseudocode
function hasPendingRoleAction(wp) -> { pending: boolean, reason: string? }:
  activeStages = wp.active_pipeline_stages ?? DEFAULT_PIPELINE_STAGES
  // Structural rules only — §9b.2 Rules 1–4 (valid types, subsequence of the canonical ordering, no duplicates, non-empty).
  // Rule 5 (fail-route coverage) is deliberately NOT checked: chains stored before v2.6.0 may fail it and are valid
  // stored data that still routes through the §9.3.1 fallback (§21.72). Stored chains are never re-validated on read.
  for each rule in [Rule1, Rule2, Rule3, Rule4]:
    if rule fails for activeStages:
      return { pending: false, reason: "active_pipeline_stages violates §9b.2 " + rule }
  if wp.rework_requested is set:                    // targeted technical blocker, §3.3 / §6.2
    agent = PIPELINE_AGENT_MAP[wp.rework_requested]
    return agent is not null ? { pending: true } : { pending: false, reason: "rework_requested stage has no owner: " + wp.rework_requested }
  for each stage in getOrderedActiveStages(activeStages):
    if stage has a PASS pipeline (most recent non-auto-cancelled):
      continue
    if stage has an IN_PROGRESS pipeline (most recent non-auto-cancelled):
      return { pending: true }    // owner has CONTINUE_PIPELINE or RESUME_OR_CANCEL
    if stage has a FAIL pipeline (most recent non-auto-cancelled):
      agent = resolveFailAgent(stage, activeStages)   // fail-target has REWORK (§9.3, §9.3.1)
    else:
      agent = PIPELINE_AGENT_MAP[stage]               // owner has IMPLEMENT / RUN_* (same walk as §13.1 step 2b)
    return agent is not null ? { pending: true } : { pending: false, reason: "no agent for stage " + stage }
  return { pending: true }    // all active stages PASS: terminal agent has FINALIZE_WP (§14.5, §14.5a)
```

> **Invariant:** for any WP whose chain satisfies §9b.2 Rules 1–4, `pending` is true — `resolveFailAgent` never returns null and every pipeline type has an owner in `PIPELINE_AGENT_MAP`. A false result is therefore evidence of a ledger-integrity failure (a hand-edited or corrupted chain), not of an abandoned agent; `reason` names the failed rule or the unowned stage and is passed through as `REVIEW_ABANDONED.integrity_reason`. The function does not consult `assigned_to`, because `startPipeline` (§11.1) reassigns on start and the pipeline-type owner may continue any IN_PROGRESS WP (§11.1.2).
````

**1e. §14.9 batch notes and any field enumeration:** add `idle_hours` to `ROUTE_PIPELINE_AGENT`, and `idle_hours` + `integrity_reason` to `REVIEW_ABANDONED`.

## Change 2 — dependencies-and-rework.md: new §16.3e and §15.4

**2a. New §16.3e "Headless Resolution of PM Review Actions".** Insert after §16.3d. It follows the §16.3c pattern and extends it to `REVIEW_ABANDONED` and `REVIEW_STALE`. Proposed text (pseudocode fences as in the surrounding sections):

```markdown
### 16.3e Headless Resolution of PM Review Actions

§16.3c prescribes how an automated (headless) orchestrator resolves `REVIEW_REWORK_LIMIT` without dispatching a PM agent. This section generalises it: a headless orchestrator never dispatches the PM agent for an action that requires judgement and never waits for a human. Every PM action resolves as *automatic* (a prescribed rule applied by the orchestrator as PM surrogate, `agent_role: "Project Manager"`), *delegated* (the PM agent is dispatched for mechanical decomposition) or *fatal* (the run stops with an operator-readable reason; the ledger stays consistent and the run resumes after a human intervenes interactively). The per-action matrix is given below.

**Why `REVIEW_STALE` and `REVIEW_ABANDONED` need a headless rule.** Both fire on wall-clock age. A run that stops and resumes more than `STALE_PIPELINE_HOURS` later leaves every pipeline that was running at the stop IN_PROGRESS and every between-stage WP idle. Nothing was abandoned; the run was not running. The ledger cannot tell a paused run from a crashed agent. The orchestrator can: on resume it knows that none of its own agents are running.

**Run start or resume (`REVIEW_STALE`).** Before the first routing pass, the orchestrator SHOULD apply the §21.68 recovery to every IN_PROGRESS pipeline: `cancelPipeline` with `auto_cancelled = true`, as Project Manager, with a reason naming the run resume. The sweep does not wait for `STALE_PIPELINE_HOURS`; the §14.8 thresholds are unchanged and remain the rule for interactive runs and for pipelines started within the current run. After the sweep the owning role's engine routes the stage again at no rework cost (§21.27).

**`REVIEW_ABANDONED` is fatal.** With the `hasPendingRoleAction` guard (§14.14) the action fires only when the ledger is inconsistent. The orchestrator logs WP ID, `assigned_to`, `idle_hours` and `integrity_reason`, writes a project comment, and stops the run. It does not unclaim or cancel: the WP's history is the evidence an operator needs, and repair (§12.3c) is a human decision. Note that a PM-claimed or null-assigned IN_PROGRESS WP (§21.39, §21.49) is **not** this case — it is routed by `ROUTE_PIPELINE_AGENT`, which ignores `assigned_to`.

**Dispatch-progress limit (`MAX_DISPATCHES_WITHOUT_PROGRESS`, default 3).** An idle WP that *is* routable is not abandoned, but the agent it routes to may repeatedly fail to make progress (crash before `begin_work`, return without starting a pipeline). The ledger cannot detect this. Orchestrators MUST count, per run and per WP, consecutive dispatches after which the WP's progress signature is unchanged, and treat the WP as halted when the count reaches `MAX_DISPATCHES_WITHOUT_PROGRESS`. The progress signature is the set of (pipeline ID, status) pairs of the WP's non-auto-cancelled pipelines, together with `wp.rework_requested` and the WP status; a dispatch that starts or completes a pipeline, changes the WP status, or clears a rework request therefore resets the count. The constant is defined here as a spec default; orchestrators MAY make it configurable, as with `MAX_REWORK_COUNT`. Halted WPs are handled as in the §16.3c "Halted WPs and synthesis" note: cancelled with a project comment before `completeSynthesis`. This is the headless counterpart of §21.68's crash-recovery cap.

**Synthesis precondition.** As in §16.3c: every WP must be terminal before `completeSynthesis`; a WP left IN_PROGRESS or BLOCKED by any of the paths above still counts as pending, and a fatal outcome ends the run before synthesis.

**Interactive runs.** Nothing in this section changes interactive behaviour. A human PM receiving `REVIEW_STALE` or `REVIEW_ABANDONED` follows §21.19 and §21.40.

**Related sections:** §16.3c, §16.3d, §14.1.2, §14.14, §21.19, §21.39, §21.40, §21.43, §21.49, §21.68, §19.1.
```

**2b. §15.4 stuck-agent note.** In the ⚠ paragraph, replace "The WP will eventually be surfaced via the PM's `REVIEW_ABANDONED` action … but this requires the staleness threshold to elapse" with: the WP is surfaced by `ROUTE_PIPELINE_AGENT` (§14.1.2 3d) and by the owning role's own engine, both of which ignore `assigned_to` for IN_PROGRESS WPs; the owner may start its pipeline directly (§11.1.2). Replace "MAY … proactively unclaim the WP" with "MAY route the WP to its owning role immediately".

**2c. The headless matrix in §16.3e.** Place the table after the dispatch-progress paragraph, before "Synthesis precondition". It covers every §14.1.2 action so that no PM action ever waits on a human. The two `technical` rows depend on Change 5.

```markdown
| PM action (§14.1.2) | Headless outcome | Rule |
| --- | --- | --- |
| `UNBLOCK_WP`, blocker `decision` or `external` | Fatal | The blocker names a decision only a human can take. Log the WP and blocker, write a project comment, stop the run. Do not cancel the WP: the human resolves the blocker interactively and resumes. |
| `UNBLOCK_WP`, blocker `technical` **with** `rework_stage` | Automatic | Transition BLOCKED → IN_PROGRESS as PM surrogate. The transition sets `rework_requested` and appends a handoff note (§6.2); the owning role's engine and `ROUTE_PIPELINE_AGENT` then route the rework (§14.14), and the rework count is incremented once when the targeted pipeline starts (§11.2). Bounded by `MAX_DISPATCHES_WITHOUT_PROGRESS` and by `REVIEW_REWORK_LIMIT` (§16.3c). |
| `UNBLOCK_WP`, blocker `technical` **without** `rework_stage` | Fatal | An untargeted technical blocker is an investigation, not a routing instruction; after unblock no role engine would surface the work (§21.43). Log, comment, stop. |
| `REVIEW_REWORK_LIMIT` | Automatic | §16.3c: cancel, comment, re-query. |
| `REVIEW_STALE` | Automatic | §21.68 sweep on run start or resume; never dispatched. |
| `REVIEW_ABANDONED` | Fatal | Ledger-integrity failure (§14.14 invariant). Log, comment, stop; no unclaim, no cancel. |
| `REPAIR_ORPHAN_BLOCKED` | Automatic | Transition to READY as PM surrogate; it is the idempotent completion of §15.4 (§21.20). Log it. |
| `ROUTE_PIPELINE_AGENT` | Automatic | Dispatch the named agent (already the orchestrator's normal routing), subject to `MAX_DISPATCHES_WITHOUT_PROGRESS`. |
| `CREATE_WORK_PACKAGES` | Delegated | Dispatch the PM agent: plan decomposition is its one genuine capability. |
| `WAIT` | — | Proceed to the next role. |

> **Why fatal outcomes are not cancellations:** cancelling converts a missing decision into a silently dropped deliverable that only surfaces in the synthesis report. Stopping the run keeps the WP and its history intact, costs one human interaction, and is recoverable without §16.3d. Orchestrators MAY expose a configuration that cancels instead (for fully unattended batch use), but the default is to stop.
```

Also add to §14.1.2 priority 1 a one-line pointer: "Headless runs: see §16.3e for the prescribed outcome per blocker type."

## Change 3 — edge-cases.md §21.19, §21.39, §21.40, §21.49

**3a. §21.40 — redefine.** Replace the section body with:

```markdown
### 21.40 Abandoned WP Detection (No Derivable Next Actor)

- An IN_PROGRESS WP is "abandoned" when it has no IN_PROGRESS pipeline, no pipeline completed within `STALE_PIPELINE_HOURS` (or no pipelines at all), has been IN_PROGRESS for at least `STALE_PIPELINE_HOURS`, **and** `hasPendingRoleAction` (§14.14) is false — the ledger yields no pipeline-role action for it
- Idleness alone is not abandonment. An idle WP whose next stage has an owner is reported by `ROUTE_PIPELINE_AGENT` (§14.1.2 3d) with `idle_hours`; the owner continues it (§11.1.2). A crashed or disconnected agent is one cause of idleness; a paused automated run is another (§16.3e), and the ledger cannot tell them apart
- **Grace period:** unchanged — the WP must have been IN_PROGRESS for at least `STALE_PIPELINE_HOURS` (`wpClaimedDuration`, §14.12)
- **This condition is unreachable on a validated ledger** (§14.14 invariant). `REVIEW_ABANDONED` (§14.1.2 3b, positioned after `REVIEW_STALE` and `ROUTE_PIPELINE_AGENT`) is a defensive integrity check: it fires only when `active_pipeline_stages` violates a structural rule (§9b.2 Rules 1–4; Rule 5 is excluded because legacy chains are valid stored data, §21.72) or a stage resolves to no owner, e.g. after a hand edit, and reports the cause as `integrity_reason`
- The PM can: (a) repair the WP's active stages (§12.3c) so that routing resumes; (b) cancel it (§21.1) if the WP cannot be made consistent. Unclaim and override-claim are no longer listed: `startPipeline` reassigns on start, so neither changes what any role's engine returns
- In headless runs the action is fatal (§16.3e)
- Null-`assigned_to` and PM-claimed WPs (§21.39, §21.49) are not abandoned by this definition: 3d routes them
```

**3b. §21.39 — mitigation bullet.** Replace the last bullet with: an IN_PROGRESS WP with null `assigned_to` is routed by `ROUTE_PIPELINE_AGENT` (3d) and by the owning role's engine, neither of which consults `assigned_to`; the owner's `startPipeline` call restores `assigned_to`. Remove the reference to `REVIEW_ABANDONED`.

**3c. §21.49 — correct the dead-end claims.** In the two ⚠ bullets:

- "the WP remains invisible to pipeline agents until `REVIEW_ABANDONED` eventually fires" → the WP is invisible to the `CLAIM_WP` checks only while READY; once IN_PROGRESS it is routed by 3d and by the owning role's engine regardless of `assigned_to`, and the owner may start its pipeline (§11.1.2), which reassigns the WP. Keep the best-practice sentence.
- "In headless orchestration, this creates a permanent dead-end until the PM is externally restarted" → in headless orchestration a PM-claimed IN_PROGRESS WP is routed by 3d like any other; the orchestrator acts with PM authority for the actions listed in §16.3e. Replace the trailing SHOULD with a pointer to §16.3e.

**3d. §21.19 — add a bullet.** After the "check stale now" bullet: in headless runs the orchestrator SHOULD apply the §21.68 recovery to all IN_PROGRESS pipelines on run start or resume rather than waiting for the threshold (§16.3e); `REVIEW_STALE` is never dispatched to a PM agent in headless runs.

**3e. Line ≈171 (null-timestamp mitigation) and ≈735 (PM handoff 2b note).** Check that the references to `REVIEW_ABANDONED` still read correctly once 3b is residual; where the sentence relies on 3b catching an idle-but-owned WP, point it at 3d / `idle_hours` instead.

## Change 4 — operations.md §11.1.2, handoff.md, walkthrough.md

**4a. §11.1.2 Agent Role Validation — add a second paragraph** after the PM-override bullet:

```markdown
- **Owner continues:** The pipeline-type owner may start its pipeline on any IN_PROGRESS WP regardless of `wp.assigned_to`. `startPipeline` reassigns the WP to the owner (§11.1 "Auto-update assigned agent"). Assignment therefore gates only claiming (§10.1) and the `CLAIM_WP` checks of the role engines (§14.2–§14.5c); it never prevents the correct role from continuing claimed work. This is the sanctioned path for resuming an idle WP after an agent crash or a paused run (§21.40, §16.3e).
```

**4b. handoff.md — PM handoff, step 2b note (≈L382).** No algorithm change. Where the note says that freshly claimed WPs are routed immediately "rather than waiting for the abandoned threshold", add that the threshold now only governs the residual `REVIEW_ABANDONED` case and that routing ignores `assigned_to`.

**4c. walkthrough.md — Appendix B action table (≈L148–172).** The table has no output column and no `ROUTE_PIPELINE_AGENT` row. Change the `REVIEW_ABANDONED` row's Meaning text to: "Defensive: IN_PROGRESS WP idle past the staleness threshold with no derivable next actor (`hasPendingRoleAction` false); unreachable on a validated ledger, indicates an integrity failure. PM repairs active stages or cancels; headless: fatal (§16.3e)." Add a `ROUTE_PIPELINE_AGENT` row whose Meaning text names the routing walk and the `idle_hours` field.

**4d. Any invariant list** that states "every IN_PROGRESS WP is surfaced to some role" (check the walkthrough and §21 summary tables): keep it, and cite 3d + §14.14 as the mechanism.

## Change 5 — Targeted technical blockers (data-model.md, state-machines.md, operations.md, pipeline-routing.md, recommendations.md, handoff.md, edge-cases.md)

The `technical` blocker type is doing two jobs the spec does not separate: a genuine investigation (nobody knows which stage owns the fix) and a routing escape hatch ("send this back to a stage the `FAIL_ROUTING_MAP` cannot reach", canonically Documentation → Developer, §21.24). The second is mechanical and must not stop a headless run. This change lets a technical blocker name its target stage; the ledger then routes the rework like a FAIL. A technical blocker without a target keeps its current meaning. This is the second explicit interactive change: a PM who unblocks a targeted technical blocker no longer coordinates the rework by hand (§21.43 becomes the untargeted case).

**5a. data-model.md — `Blocker` (§3.5 Supporting Types) and `WorkPackage` (§3.3 Work Package Detail).**

```markdown
Blocker {
  type:                  BlockerType
  description:           string
  blocking_work_package: string?
  rework_stage:          PipelineType?   // `technical` only: the active stage that owns the fix (e.g. "implementation")
}

WorkPackage {
  …
  rework_requested:      PipelineType?   // Set by BLOCKED → IN_PROGRESS from blocked_by.rework_stage (§6.2); cleared when a pipeline of that type starts (§11.1)
}
```

Both fields are optional and absent on existing ledgers, so the data-model change is backward compatible (minor bump stands). Validation on any → BLOCKED transition (§21.11): `rework_stage` is accepted only with `type: "technical"`, and must be an active stage ordered strictly before the latest active stage that has a pipeline of any status (most recent non-auto-cancelled). The rule is evaluated against the pipeline state **before** the transition's auto-cancel side effect (IN_PROGRESS → BLOCKED cancels the WP's IN_PROGRESS pipelines, §6.2, §21.27), so a pipeline that is IN_PROGRESS at block time counts; otherwise a Documentation agent blocking mid-pipeline on `["implementation", "documentation"]` with `rework_stage: "implementation"` would be rejected. The ledger does not record which stage raised a blocker, so "not the raising stage" cannot be checked directly; the ordering rule excludes self-rework without that knowledge, covers both the §21.24 case (documentation FAIL) and the §14.5 5b case (documentation PASS with unmet criteria), and is derivable from the ledger. Reject `rework_stage` if no stage has a pipeline yet. The §6.2 BLOCKED → BLOCKED replacement rules are unchanged; replacing a blocker replaces its `rework_stage`.

**5b. state-machines.md §6.2 transition table — BLOCKED → IN_PROGRESS.** Add to the transition's side effects: if `blocked_by.type == "technical"` and `blocked_by.rework_stage` is set, then set `wp.rework_requested = blocked_by.rework_stage` and append a `HandoffNote` carrying the blocker description — both before `blocked_by` is cleared (§21.12). No rework counter changes here: the count is incremented exactly once, when the targeted pipeline starts (5c, §11.2), so that the targeted rework is under the §16.3 circuit breaker without being double-counted. `BLOCKED → READY` clears `blocked_by` without setting `rework_requested` (the WP is re-claimed from the start anyway). `IN_PROGRESS → READY` (unclaim, §21.13) clears `rework_requested`, so a re-claimed WP does not carry a stale routing instruction.

**5c. operations.md §11.1 `startPipeline` and §11.2 rework count semantics.** Extend the existing rework branch rather than adding a path: define `isTargetedRework = (wp.rework_requested == pipelineType)` next to `isDirectRework` and `isDownstreamRework`, and change the branch condition to `if isDirectRework OR isDownstreamRework OR isTargetedRework`. This yields exactly one increment of `rework_counts[pipelineType]` for the targeted start, under the existing circuit breaker and the §21.74 persistence rule (a refused start persists the incremented count and creates no pipeline). Clear `wp.rework_requested` only when the pipeline is actually created, never on a refused start: on refusal the WP keeps its routing instruction and `REVIEW_REWORK_LIMIT` takes over (§16.3c in headless runs). In §11.2, express this as a note on the branch condition — "a pending `rework_requested` for the pipeline type counts as rework regardless of the prior-state row" — and explain that it prevents double counting in the §21.24 case, where the documentation FAIL would otherwise also satisfy the "PASS / downstream FAIL exists" row. Add the refused-start case to §21.74. The existing re-validation guard (§11.1 "re-validation after upstream rework") then forces every downstream stage to re-run, which is the intended effect of a code fix. Note in §11.1.2 that no new guard is needed: a new pipeline on an already-PASSed stage is already permitted.

**5d. pipeline-routing.md / recommendations.md — routing.** Treat a pending `rework_requested` like a FAIL on that stage:

- §13.1 step 2b (`handoff.md`) and §14.1.2 3d: before the stage walk, if `wp.rework_requested` is set, route to `PIPELINE_AGENT_MAP[wp.rework_requested]` with reason "targeted rework".
- Each role engine (§14.2–§14.5c): add a priority immediately after the active/stale pipeline checks and before FAIL-driven rework: "**REWORK (requested)**: WP is IN_PROGRESS and `PIPELINE_AGENT_MAP[wp.rework_requested]` is this agent — rework per the handoff note and start a new pipeline of type `wp.rework_requested`." `AGENT_PIPELINE_MAP` is 1:1 today, so "this agent's stage" is unambiguous; state in the text that the rule keys on `PIPELINE_AGENT_MAP[rework_requested]`, not on the agent's stage list, so it remains correct if an agent ever owns more than one stage.
- §14.14 `hasPendingRoleAction`: first check after the structural rules — `if wp.rework_requested is set: pending iff PIPELINE_AGENT_MAP[wp.rework_requested] is not null` (always true after 5a validation; already included in the §14.14 text under Change 1).
- §9.3 (`pipeline-routing.md`): add a note that `rework_stage` is the sanctioned backward jump the map cannot express; it does not change `FAIL_ROUTING_MAP`.

**5e. edge-cases.md.**

- §21.24: the Documentation agent SHOULD set `rework_stage: "implementation"` on the technical blocker; the manual-coordination sentence becomes "without `rework_stage`, see §21.43".
- §21.43: retitle "Post-Technical-Blocker Unblock Routing (untargeted blockers)"; add an opening bullet that a targeted blocker (5a) routes automatically via `rework_requested`, and keep the existing options for untargeted ones.
- §14.5 priority 5b and the terminal-agent reopen rule ("set the WP to BLOCKED with a `technical` blocker if the issue requires code changes"): add `rework_stage` to the recommended blocker.
- §21.11: the validation rules from 5a, including the ordering rule and that it is evaluated before the auto-cancel side effect.
- §21.74: add the refused targeted start — count persisted, no pipeline created, `rework_requested` retained.
- New §21.76 "Invalid `rework_stage` on a Technical Blocker": rejected at block time when the type is not `technical`, the stage is not active, no stage has a pipeline yet, or the stage is not ordered strictly before the latest active stage with a pipeline (pipelines IN_PROGRESS at block time count, since validation precedes auto-cancel). Rejection is expected when the latest pipeline is on the WP's first active stage: nothing is ordered before it, so there is nowhere to send the rework, and the blocker belongs to that stage's own FAIL path (self-rework) or must be untargeted — e.g. a documentation-only WP (`["documentation"]`). Recovery is to block again with a valid target or without one.

**5f. §16.3e matrix** — the `technical` row is split (see Change 2c): targeted → automatic (orchestrator as PM performs BLOCKED → IN_PROGRESS, routing takes over, bounded by `MAX_DISPATCHES_WITHOUT_PROGRESS` and the rework circuit breaker); untargeted → fatal.

## Versioning and consistency

Bump to **v2.10.0** (minor). Two optional fields are added — `Blocker.rework_stage` and `WorkPackage.rework_requested` — both absent on existing ledgers; they are backward compatible and no migration is needed. The recommendation engine's observable output changes and a new helper is added.

- `README.md`: version header; changelog entry in the existing style, e.g. "v2.10.0 — Abandoned-WP Detection Narrowed to Integrity Failures; Headless Resolution of PM Actions; Targeted Technical Blockers", listing every touched section: §3.3, §3.5, §6.2, §9.3, §11.1, §11.1.2, §11.2, §13.1, §14.1.2, §14.2–§14.5c, §14.14, §15.4, §16.3e, §21.11, §21.19, §21.24, §21.39, §21.40, §21.43, §21.49, the new edge case, and the walkthrough table; name the two new optional fields and state that existing ledgers need no migration; add §14.14 and §16.3e to the Table of Contents and the Quick Section Reference.
- `shared/workflow-manifest.json`: `spec_version` → `"2.10.0"` only; it lists no action names or fields.
- `mcp-server/docs/agents/project-manifest/constraints-workflow.md`: update after the spec per root `AGENTS.md` (the constraint that the PM is polled first stays; add that 3b is defensive, that headless orchestrators resolve PM actions per the §16.3e matrix, and that technical blockers can carry `rework_stage` and are then routed automatically, since this changes how agents are told to escalate).
- Constants: `MAX_DISPATCHES_WITHOUT_PROGRESS = 3` is new and defined in §16.3e; add it wherever the spec lists constants alongside `STALE_PIPELINE_HOURS` and `MAX_REWORK_COUNT`.
- Machine-readable vocabulary / action enums: no new action names; `idle_hours` and `integrity_reason` are new output fields on existing actions. If the vocabulary section enumerates action fields, add them there.

## Follow-ups outside the spec (listed, not designed)

| Area | Follow-up |
| --- | --- |
| MCP server (`recommendations.ts`) | Implement `hasPendingRoleAction`; reorder 3b after 3d; add `idle_hours` / `integrity_reason` to action outputs |
| MCP server tests | Add the post-unblock re-claim case (re-claimed < 24 h ago, last pipeline > 24 h old → not flagged) to verify the grace check matches §14.1.2 (briefing gap 6); add a legacy pre-v2.6.0 WP idle > 24 h → routed, not flagged |
| Python orchestrator | Fatal stop for `REVIEW_ABANDONED`, untargeted `technical`, `decision` and `external` per the §16.3e matrix; automatic unblock for targeted `technical`; resume-time §21.68 sweep; per-run dispatch-progress counter and halted handling |
| MCP server + orchestrator (Change 5) | Schema update for the two optional fields; → BLOCKED validation (§21.11 ordering rule); BLOCKED → IN_PROGRESS side effects (`rework_requested`, handoff note); `startPipeline` clearing and single rework increment; REWORK-requested priority in each role engine; Documentation persona sets `rework_stage` on §21.24 escalations |
| Plan `2026-10-06-p05-headless-pm-review-actions` | Replace the `REVIEW_ABANDONED` entry with the fatal rule plus the dispatch-progress limit; its "leave to owning role" assumption becomes a spec rule (§14.14), not a plan assumption |
| Ledger Doctor persona, Repair 10 | Replace the unclaim prescription: route if routable (dispatch the 3d agent); otherwise the WP is an integrity failure — repair active stages or cancel with comment |
| Verify | That orchestrator dispatch prompts follow the role engine rather than re-running a stage on a re-claimed WP (the briefing's "work is redone" claim) |

## Acceptance checklist

- [ ] §14.1.2 3b condition includes the `hasPendingRoleAction` guard and is evaluated after 3d in both prose and pseudocode
- [ ] `ROUTE_PIPELINE_AGENT` output documents `idle_hours`; `REVIEW_ABANDONED` output documents `idle_hours` and `integrity_reason`
- [ ] §14.14 exists, is anchored, returns `{pending, reason}`, checks only §9b.2 Rules 1–4, and is referenced from §14.1.2, §21.39, §21.40, §21.49
- [ ] §16.3e exists, follows the §16.3c pattern (PM-surrogate rules, synthesis note, related sections) and is referenced from §14.1.2, §21.19, §21.40, §21.49
- [ ] §11.1.2 states the owner-continues rule
- [ ] §21.49 no longer calls a PM-claimed WP a permanent dead-end in headless runs
- [ ] §15.4 no longer recommends proactive unclaim
- [ ] No sentence in the spec still says "PM should re-claim" for abandoned WPs
- [ ] Interactive behaviour changes are confined to Changes 1 and 5, each with its rationale in the text
- [ ] No runtime-specific symbol in normative text; `AGENTS.md` process order followed (spec → code → tests → constraints-workflow.md)
- [ ] README changelog, TOC, Quick Section Reference and `workflow-manifest.json` updated to 2.10.0
- [ ] §16.3e contains the headless matrix covering every §14.1.2 action; `REVIEW_ABANDONED`, `decision`/`external` blockers and untargeted `technical` blockers are fatal, targeted `technical` blockers are automatic, nothing waits on a human
- [ ] No remaining prescription to unclaim an abandoned WP anywhere in the spec
- [ ] `MAX_DISPATCHES_WITHOUT_PROGRESS` is defined once, with its default and its comparison basis, and the FAIL-stage omission from 3d is stated as deliberate
- [ ] `rework_stage` / `rework_requested` defined in §3.5 / §3.3, validated on → BLOCKED (§21.11 ordering rule), set in §6.2, cleared in §11.1 and on unclaim, counted exactly once in §11.2, routed in §13.1 / §14.1.2 3d / every role engine / §14.14; §21.24 and §21.43 updated
