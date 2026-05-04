# Research Report

## Problem Statement

In light of the findings in
[`2026-04-30-documentation-handoff-stall.md`](2026-04-30-documentation-handoff-stall.md)
— specifically the proposal to (a) replace the Documentation Step-3 fall-through
with deterministic next-ready dispatch and (b) intercept cross-role handoffs at
the orchestrator layer — the user asks:

> Do we still need the `WAIT` state at all? With `BLOCKED` already guarding
> WPs from premature start, is there ever a moment when an agent must wait,
> given that there is always an open WP to continue work on?

This report tests the hypothesis "`WAIT` is redundant once `BLOCKED` exists and
cross-WP dispatch is generalized" against every current producer of `WAIT` in
the spec and codebase.

## Problem Decomposition

1. What distinct meanings does `WAIT` carry in the current ledger?
2. What does `BLOCKED` actually guarantee, and where is it insufficient?
3. For each existing `WAIT` producer, can it be replaced by a deterministic
   non-WAIT outcome (cross-WP dispatch, PM escalation, terminal status)?
4. Are there residual cases where no deterministic alternative exists?
5. What is the smallest set of states the workflow can collapse to?

## Context & Constraints

- The previous research established two fixes that are now treated as
  **assumed in place** for this analysis:
  - **Ledger fix:** Each role's handoff function performs *next-ready
    dispatch* (`firstActiveStage` + `PIPELINE_AGENT_MAP`) before falling
    through, then escalates to PM, before returning `WAIT`.
  - **Orchestrator fix:** The tool-wrapper layer
    (`orchestrator/src/utils/tool_wrappers.py`) intercepts `auto_handoff`
    blocks targeting *other* roles and routes via the supervisor instead
    of via the persona itself. Personas only see neutral acknowledgements.
- `BLOCKED` has **two distinct meanings** in the spec, which the user's
  question conflates (correctly so — the conflation is itself diagnostic):
  - **WP status `BLOCKED`** (`work-package.json` → `status`): "this WP
    cannot start because dependencies are not COMPLETE/CANCELLED"
    ([`mcp-server/docs/agents/workflow-specification/state-machines.md`](../../../mcp-server/docs/agents/workflow-specification/state-machines.md)).
  - **Handoff status `BLOCKED`** (`HANDOFF_STATUS_ROLE['BLOCKED'] = 'Project Manager'`
    in [`mcp-server/src/utils/constants.ts`](../../../mcp-server/src/utils/constants.ts#L78)):
    "the workflow itself is in a deadlock; PM intervention required."
- `WAIT` likewise has **two contexts**:
  - **Action-level `WAIT`** (in `getNextAction`): "this specific role has
    no actionable work *right now*."
  - **Handoff-level `WAIT`** (in `getHandoffStatus`): "no role to dispatch
    next."
- All WAIT producers were enumerated by grep in
  [`mcp-server/src/tools/workflow-handoff.ts`](../../../mcp-server/src/tools/workflow-handoff.ts)
  and
  [`mcp-server/src/tools/workflow-next-action.ts`](../../../mcp-server/src/tools/workflow-next-action.ts).

## Inventory of `WAIT` Producers

### A. Catch-all handoff WAIT (one per role)

`getDevHandoff`, `getQAHandoff`, `getReviewerHandoff`,
`getSecurityAuditorHandoff`, `getReleaseEngineerHandoff`,
`getDocumentationHandoff` all end with `buildHandoffResponse(role, 'WAIT', …)`
when no actionable work is found for the role.

**With ledger fix in place:** Each becomes `nextReady → PM → WAIT`. The trailing
`WAIT` only fires when *no* WP is `READY` AND *no* WP is `IN_PROGRESS` AND no
FAIL exists — i.e., the project is genuinely terminal.

### B. PM handoff WAIT

[`workflow-handoff.ts`](../../../mcp-server/src/tools/workflow-handoff.ts) §13.1
returns `WAIT` when:
- All WPs are terminal (COMPLETE/CANCELLED), or
- All non-terminal WPs are dependency-blocked AND none of their guardian
  upstream WPs are actionable (a true deadlock).

The first case is "synthesis pending or project complete" — a terminal status.
The second is a genuine deadlock requiring user intervention (PM cannot itself
unblock; only a human can break the cycle or cancel WPs).

### C. Synthesis handoff WAIT

`getSynthesisHandoff` always returns `WAIT`. Synthesis runs once at the end and
has no successor.
([`handoff.md`](../../../mcp-server/docs/agents/workflow-specification/handoff.md#L253-L256))

### D. Planner handoff/action WAIT

After the plan exists and WPs have been created, the Planner has no further
role. `getNextAction` for Planner always returns `WAIT`; `getPlannerHandoff`
returns `READY_FOR_PM` until WPs exist, then `WAIT`.
([`handoff.md`](../../../mcp-server/docs/agents/workflow-specification/handoff.md#L21-L24))

### E. Action-level WAIT (per role) when no per-WP work matches

`getDocumentationAction`, `getQAAction`, `getReviewerAction`, etc. fall through
to `WAIT` when no WP in the iteration matches any priority. With the ledger fix
in place, this WAIT is *always* embedded with `handoff_status` via
`embedHandoffStatusInWait` ([`workflow-next-action-batch.ts`](../../../mcp-server/src/tools/workflow-next-action-batch.ts#L44)),
so the action-level WAIT becomes a thin wrapper around the handoff-level
decision.

### F. Temporal-guard WAITs (`WAIT_FOR_DOWNSTREAM`, `WAIT_FOR_REWORK`, `WAIT_FOR_UPSTREAM_REWORK_LIMIT`)

These are **not** the same `WAIT` as A–E. They are distinct action codes
issued *per WP* by the recommendation engine to prevent state corruption from
premature re-runs:

| Action | Producer | Purpose |
|---|---|---|
| `WAIT_FOR_DOWNSTREAM` | Developer §14.2 P5b | Dev delivered fix; QA hasn't re-validated → don't re-implement. |
| `WAIT_FOR_REWORK` | QA §14.3 P5, Reviewer §14.4 P5, Security Auditor §14.5b P5 | Most recent FAIL not yet addressed by upstream → don't re-validate stale code. |
| `WAIT_FOR_UPSTREAM_REWORK_LIMIT` | QA/Reviewer/Documentation P1b | Upstream hit MAX_REWORK_COUNT (circuit breaker). |

These are temporal correctness guards on a *specific WP*, not idle signals.
They tell one role "you cannot productively act on **this WP** right now."
The user's question is whether the role itself ever needs to wait — i.e.,
whether after a per-WP `WAIT_FOR_*` the role could be redirected to **another**
WP.

## Verdict per Producer

| Producer | Required after fixes? | Replacement |
|---|---|---|
| A. Catch-all handoff WAIT (Dev/QA/Reviewer/SecAud/RelEng/Doc) | **No, except as terminal sentinel** | `nextReady → PM → terminal` |
| B. PM handoff WAIT (terminal case) | **Yes — but rename** to `PROJECT_COMPLETE` or `READY_FOR_SYNTHESIS` | Reify as terminal status |
| B. PM handoff WAIT (deadlock case) | **Yes — but rename** to `DEADLOCK_HUMAN_INTERVENTION` | Reify; `WAIT` here is misleading because no agent will ever resolve it |
| C. Synthesis handoff WAIT | **Yes — but rename** to `CHAIN_TERMINATED` | Synthesis is the chain terminator |
| D. Planner WAIT | **No** | Planner can return `READY_FOR_PM` while WPs exist; once project is COMPLETE, the chain is already terminated |
| E. Action-level WAIT | **No, except as wrapper for B/C** | Embedded handoff_status carries the real signal |
| F. `WAIT_FOR_DOWNSTREAM` | **No (per-WP), partially per-role** | If another READY/IN_PROGRESS WP has Dev work → dispatch there; else → PM escalation |
| F. `WAIT_FOR_REWORK` | **No (per-WP), partially per-role** | Same: redirect to another WP's QA/Review work; else PM |
| F. `WAIT_FOR_UPSTREAM_REWORK_LIMIT` | **Yes, escalated** | Circuit-broken WPs need PM judgement; emit `BLOCKED` (handoff) → PM, not WAIT |

## What `BLOCKED` (WP status) Cannot Cover Alone

The user is right that a healthy ledger almost always has *some* actionable
work somewhere. But `BLOCKED` (WP status) only covers **one** axis of
unavailability — dependency wait. It does **not** cover:

1. **Mid-pipeline temporal guards.** A WP can be `IN_PROGRESS` (not BLOCKED)
   yet have no productive work for a specific role at this instant — e.g., the
   `impl-PASS / awaiting-QA` window. The WP is healthy; the *role* is idle on
   that WP.
2. **Single-WP / linear-plan terminal stretch.** When the only remaining
   non-terminal WP is mid-pipeline at one stage, every other role has nothing
   to claim. With cross-WP dispatch, the *currently working* role keeps
   working; the dispatch decision after PASS routes to the next stage's role.
   No role is asked "what next?" in a state with literally nothing to do —
   except after the very last PASS of the very last WP. That moment is the
   one true `WAIT`, and it's better named `READY_FOR_SYNTHESIS` or
   `PROJECT_COMPLETE`.
3. **Genuine deadlocks.** Cyclic dependencies, missing inputs, all WPs FAILed
   beyond rework limit. PM cannot self-unblock — a human must intervene.
   Calling this `WAIT` is misleading; it's a `DEADLOCK`.
4. **Concurrency races in the orchestrator's polling loop.** If the supervisor
   ever polls multiple roles in parallel and asks "any work for QA?" while a
   READY WP exists with QA as its first active stage but Developer hasn't
   started yet, the right answer is "not yet." But this is a supervisor-side
   scheduling concern, not an agent-facing routing status. It need not surface
   as `WAIT` from the ledger; the supervisor can compute it from the WP states
   directly.

## Why the Hypothesis Is *Mostly* Correct

The user's intuition holds for the **vast majority** of WAIT producers. After
the two fixes from the prior research:

- All A-class `WAIT`s collapse to deterministic dispatch.
- All E-class `WAIT`s become wrappers around the handoff result.
- Most F-class per-WP `WAIT_FOR_*` codes can route the role to another WP
  before falling back to PM escalation.

What remains is **not redundant with `BLOCKED`** — it is genuinely terminal or
genuinely deadlocked. The honest answer is therefore not "delete WAIT" but
"split WAIT into the two distinct meanings it currently muddles":

1. **Terminal sentinel** ("the chain stops here intentionally") — currently
   produced by Synthesis and by PM-after-all-WPs-COMPLETE.
2. **Deadlock signal** ("no agent can proceed, human needed") — currently
   produced by PM when all non-terminal WPs are dependency-blocked and no
   guardian is actionable.

The third meaning ("this role is idle right now but the workflow is healthy")
is what the user is correctly identifying as redundant.

## Per-WP `WAIT_FOR_*` — A Closer Look

These are the most resistant to elimination, so they deserve their own
analysis.

### `WAIT_FOR_DOWNSTREAM` (Developer)

**Purpose:** Dev finished impl-N; QA hasn't started qa-N yet; an older
qa-N-1 FAIL exists.

**Without WAIT_FOR_DOWNSTREAM:** Dev would re-run implementation on stale
guidance, churning the WP.

**Replacement:** Look for *another* WP with active implementation work.
- If found → dispatch Dev there.
- If none → escalate to PM (who triggers QA re-engagement via auto-handoff,
  per §13.1 step 2b "PM pipeline blindness").
- This is exactly the same pattern as the Documentation fix.

**Caveat:** The orchestrator can solve this *more elegantly* by simply
dispatching QA next (which is what the QA handoff §13.3 P4 re-engagement
already computes). The Dev-side `WAIT_FOR_DOWNSTREAM` only matters if the IDE
asks Dev "what's next?" — which only happens if the prior auto-handoff didn't
already route to QA. With the ledger fix making Dev's catch-all handoff route
to "next-ready" (which would find QA via re-engagement on the same WP), the
IDE never reaches a state where it asks Dev "what next?" without QA already
being dispatched.

**Verdict:** Eliminable as a *handoff-visible* status. Can remain as an
internal recommendation engine code for diagnostics, but should never be the
final answer surfaced to the runner.

### `WAIT_FOR_REWORK` (QA / Reviewer / Security Auditor)

**Purpose:** Most recent QA pipeline is FAIL; the fail-target agent (Dev,
typically) hasn't yet re-PASSed.

**Without WAIT_FOR_REWORK:** QA would re-validate stale code that Dev knows
is broken.

**Replacement:** The QA handoff §13.3 with re-engagement check (P4 before P5,
per §21.66/§21.67) already routes Dev → QA correctly when Dev has delivered
the fix. The `WAIT_FOR_REWORK` is only emitted on the QA side when QA is
asked directly; with the cross-WP dispatch fix and the orchestrator
interception, QA is never asked directly while Dev still owes a fix — Dev
gets dispatched first.

**Verdict:** Same as above. Internal diagnostic code; not a runner-visible
final status.

### `WAIT_FOR_UPSTREAM_REWORK_LIMIT`

**Purpose:** Upstream pipeline hit MAX_REWORK_COUNT — circuit broken.

**Without it:** Downstream agent would loop on a permanently broken upstream.

**Replacement:** This is a true PM-escalation case — the WP needs to be
cancelled, demoted, or rescoped. The handoff status should be `BLOCKED` →
`Project Manager`, not `WAIT`.

**Verdict:** Replace with `BLOCKED` (handoff) → PM. `WAIT` is the wrong
signal because no amount of waiting will resolve a circuit-broken WP.

## Recommended State Reduction

After applying both prior-research fixes plus the implications above, the
runner-visible status set collapses from:

```
{ READY_FOR_PM, READY_FOR_DEVELOPER, READY_FOR_QA, READY_FOR_SECURITY_AUDIT,
  READY_FOR_REVIEW, READY_FOR_RELEASE_ENGINEERING, READY_FOR_DOCUMENTATION,
  READY_FOR_SYNTHESIS, IN_PROGRESS, BLOCKED, COMPLETE, WAIT }
```

…to:

```
{ READY_FOR_*  (8 variants),
  IN_PROGRESS,
  BLOCKED,                      // handoff-level: PM intervention
  COMPLETE,                     // project complete (terminal)
  CHAIN_TERMINATED }            // synthesis ran or no-WPs-after-plan (terminal)
```

`WAIT` disappears as a runner-visible status. It can survive as an internal
intermediate value inside the recommendation engine and the per-WP action
ladders (where it's already wrapped by `embedHandoffStatusInWait`), but the
ledger never returns `WAIT` to the runner.

The per-WP `WAIT_FOR_*` action codes become **diagnostic notes** attached to
RUN_*/REWORK actions for *other* WPs (e.g., "WP-001 is waiting for QA
re-engagement; routing you to WP-002 implementation instead"), or escalation
triggers to PM when no alternative exists.

## Comparative Evaluation

| Criterion | Status quo (keep WAIT) | Eliminate runner-visible WAIT, split into terminal + deadlock |
|---|---|---|
| Spec clarity | `WAIT` is overloaded (idle vs terminal vs deadlock) | Each terminal/deadlock has its own honest name |
| Runner stalls in IDE | Frequent (per prior research) | Eliminated — dispatch is always deterministic or escalates |
| Orchestrator polling complexity | Polls every role and discards WAITs | Polls become event-driven; only true terminals stop the loop |
| Migration cost | None | Moderate: rename a few constants, update tests, update spec §13/§14 |
| Risk of regression | None | Low — purely additive renaming + dispatch generalization |
| Diagnostic richness | `WAIT` is opaque | Per-WP `WAIT_FOR_*` becomes a *reason* attached to a routed action |
| Backwards compat (external consumers) | N/A | Aliases can be kept for one minor version |

## Recommendation

**Yes, the user is essentially correct — but with two caveats:**

1. **Eliminate `WAIT` as a runner-visible handoff status.** Replace its three
   conflated meanings with three honest names:
   - `READY_FOR_SYNTHESIS` — chain is alive but only synthesis remains.
   - `COMPLETE` — synthesis ran, project is done.
   - `BLOCKED` (handoff) — true deadlock, PM/human intervention required.

2. **Generalize the next-ready dispatch fix from Documentation to every role.**
   The pattern from
   [`2026-04-30-documentation-handoff-stall.md`](2026-04-30-documentation-handoff-stall.md)
   §Recommendation should become the standard tail of every
   `get*Handoff` function:

   ```ts
   // After role-specific priorities exhausted:
   const nextReady = findNextReadyDispatchable(wpDetails, root);
   if (nextReady) return buildHandoffResponse(role, READY_STATUS_FOR_ROLE[targetOf(nextReady)], …);

   const inFlightDispatch = findInFlightStageDispatch(wpDetails);  // mirrors §13.1 step 2b
   if (inFlightDispatch) return buildHandoffResponse(role, READY_STATUS_FOR_ROLE[targetOf(inFlightDispatch)], …);

   if (allWpsTerminal(wpDetails)) return buildHandoffResponse(role, root.synthesis_generated ? 'COMPLETE' : 'READY_FOR_SYNTHESIS', …);

   if (anyWpDeadlocked(wpDetails)) return buildHandoffResponse(role, 'BLOCKED', …);

   // Last-resort fall-through (should be unreachable in practice):
   return buildHandoffResponse(role, 'BLOCKED', 'No actionable work and no terminal condition met — escalate to PM.', …);
   ```

3. **Keep per-WP `WAIT_FOR_*` codes as internal recommendation-engine
   diagnostics.** They never become the *final* runner-visible answer; they
   become reasons attached to routed actions ("waiting on WP-001; routed to
   WP-002 implementation").

4. **`BLOCKED` (WP status) and `BLOCKED` (handoff status) remain distinct.**
   The user's framing correctly identifies that they share a name but serve
   different purposes. The spec should clarify this in §6.x — they should
   probably be renamed to `WP_BLOCKED` and `WORKFLOW_DEADLOCKED` respectively
   if a breaking-change window opens.

### Why Not Delete `WAIT` Entirely from the Code?

Two pragmatic reasons:

- **Internal recommendation-engine code** uses `WAIT` as the natural
  "fall-through" value during the priority ladder evaluation. Eliminating it
  internally would force every code path to compute the terminal/deadlock
  classification eagerly — wasteful when the ladder usually short-circuits
  earlier.
- **`embedHandoffStatusInWait`** already wraps action-level WAITs with the
  real handoff decision. Keeping the wrapping layer means external code only
  ever sees the resolved status, not the intermediate `WAIT`.

The recommendation is therefore "eliminate runner-visible `WAIT`," not
"delete the symbol from the codebase."

### Proof-of-Concept Outline

1. Add `READY_FOR_SYNTHESIS`, `CHAIN_TERMINATED`/`COMPLETE` (handoff) to
   `READY_STATUS_FOR_ROLE` and `HANDOFF_STATUS_ROLE`.
2. Refactor `buildHandoffResponse` to translate `'WAIT'` into one of:
   `READY_FOR_SYNTHESIS`, `COMPLETE`, `BLOCKED`, based on `wpDetails` +
   `root` analysis. Add an exhaustive switch with a default that throws
   (catches future ladder additions that forget to classify).
3. Add fixture tests for the four terminal/deadlock conditions and assert
   no `'WAIT'` ever appears in the public response.
4. Update spec §13.x and §14.x to enumerate the new terminal statuses.
5. Bump persona files (Synthesis, PM) to recognize the new statuses.

## Open Questions

- Should `BLOCKED` (handoff) be renamed to `DEADLOCKED` to disambiguate from
  WP status `BLOCKED`? Probably yes, but it's a breaking change — defer to a
  major version bump.
- Should the orchestrator's tool-wrapper interception (from the prior
  research) also synthesize the `READY_FOR_SYNTHESIS` → `COMPLETE` transition
  internally, so the supervisor's stop signal is `COMPLETE` only? Yes — this
  composes cleanly and gives the supervisor a single "stop" predicate.
- For circuit-broken WPs (`MAX_REWORK_COUNT` reached), should the WP itself be
  auto-transitioned to a new `WP_CIRCUIT_BROKEN` status, separate from
  `BLOCKED`? This would let `BLOCKED` retain its "dependency wait" meaning
  exclusively. Worth a follow-up design discussion.
- The Planner role currently has both action-`WAIT` and handoff-`WAIT` after
  WPs exist. Should the Planner be retired from the role roster entirely once
  the plan is archived? It has no further role; the persona is dormant for
  the rest of the run. Could simplify the role inventory.

## References

- [`2026-04-30-documentation-handoff-stall.md`](2026-04-30-documentation-handoff-stall.md) — prior research establishing next-ready dispatch + orchestrator interception.
- [`mcp-server/docs/agents/workflow-specification/handoff.md`](../../../mcp-server/docs/agents/workflow-specification/handoff.md) — §13.x role-by-role handoff functions, all WAIT producers.
- [`mcp-server/docs/agents/workflow-specification/recommendations.md`](../../../mcp-server/docs/agents/workflow-specification/recommendations.md) — §14.2 P5b WAIT_FOR_DOWNSTREAM, §14.3–§14.5b P5 WAIT_FOR_REWORK, P1b WAIT_FOR_UPSTREAM_REWORK_LIMIT.
- [`mcp-server/docs/agents/workflow-specification/edge-cases.md`](../../../mcp-server/docs/agents/workflow-specification/edge-cases.md) — §21.18 (WAIT_FOR_REWORK indefinite-stall), §21.52/§21.66/§21.67 (temporal-guard rationale).
- [`mcp-server/src/utils/constants.ts`](../../../mcp-server/src/utils/constants.ts#L60-L82) — `READY_STATUS_FOR_ROLE`, `HANDOFF_STATUS_ROLE`.
- [`mcp-server/src/tools/workflow-handoff.ts`](../../../mcp-server/src/tools/workflow-handoff.ts) — all role handoff functions.
- [`mcp-server/src/tools/workflow-next-action.ts`](../../../mcp-server/src/tools/workflow-next-action.ts) — per-role action ladders.
- [`mcp-server/src/tools/workflow-next-action-batch.ts`](../../../mcp-server/src/tools/workflow-next-action-batch.ts#L44) — `embedHandoffStatusInWait`.

AGENT: Research
STATUS: COMPLETE
