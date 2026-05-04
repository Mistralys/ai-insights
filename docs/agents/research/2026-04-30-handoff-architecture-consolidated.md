# Research Report — Consolidated Handoff Architecture

> **Synthesis of:**
> - [`2026-04-30-documentation-handoff-stall.md`](2026-04-30-documentation-handoff-stall.md) — root-cause of the Documentation stall + the next-ready-dispatch + orchestrator-interception fixes.
> - [`2026-04-30-wait-state-necessity.md`](2026-04-30-wait-state-necessity.md) — analysis of every `WAIT` producer and the case for collapsing `WAIT` into honest terminal/deadlock statuses.
>
> **Audience:** Planner agent. This document is the single input needed to
> decompose the work into Work Packages.

---

## Problem Statement

The ledger workflow has two intertwined defects that surface as IDE workflow
stalls and ambiguous routing semantics:

1. **The Documentation handoff strands the workflow.** When the Documentation
   agent finalizes the last stage of a WP and the next `READY` WP has zero
   pipelines yet, `getDocumentationHandoff` falls through to `WAIT` with no
   `auto_handoff` payload. IDE runners (VS Code, Claude Code) halt because no
   persona switch is signalled. Concretely observed in project
   `2026-04-30-net10-upgrade` after WP-001 completed and WP-002 was READY.

2. **`WAIT` is overloaded and routinely emitted as a "real" handoff status
   even though it carries no routing information.** The same symbol means
   "this role is idle right now," "the chain has terminated cleanly," and
   "the workflow is deadlocked and needs human intervention." Runners cannot
   distinguish these. `WAIT` has no entry in `HANDOFF_STATUS_ROLE`, so
   `buildHandoffResponse` cannot attach `auto_handoff` — every `WAIT` is a
   silent stop.

These defects share a root cause: **the per-role handoff functions don't
generalize the cross-WP "next-ready dispatch" pattern**, and the
`WAIT` exit is a catch-all for situations that should be classified as either
deterministic dispatch, PM escalation, or honest terminal/deadlock.

A secondary defect, surfaced while researching (1), is that **orchestrator
personas mis-acted on cross-role `auto_handoff` blocks** in the past — they
treated routing signals as tasks to perform. The previous workaround was the
pessimistic Step-3 fall-through to `WAIT` in Documentation. The correct fix
is at the orchestrator's MCP-tool-wrapper layer, not at the ledger.

---

## Problem Decomposition

1. **Per-role handoff generalization.** Every role's handoff function should
   end with a uniform tail: `next-ready dispatch → PM escalation → terminal
   classification`, never a bare `WAIT`.
2. **Status reduction.** The runner-visible status set should collapse
   `WAIT` into three honest replacements: `READY_FOR_SYNTHESIS`, `COMPLETE`
   (project), and `BLOCKED` (handoff = deadlock requiring human/PM).
3. **Orchestrator interception.** Cross-role `auto_handoff` blocks must be
   intercepted at the tool-wrapper layer and routed via the supervisor;
   personas only see neutral acknowledgements.
4. **Per-WP `WAIT_FOR_*` codes.** These are correctness guards (temporal
   re-run prevention) and must remain as internal recommendation-engine
   outputs, but should never surface as the *final* handoff answer — they
   become diagnostic notes attached to a routed action for a different WP, or
   trigger PM escalation when no alternative exists.
5. **Spec + tests + persona files.** All three layers must be updated in
   lockstep with code: `mcp-server/docs/agents/workflow-specification/` first,
   then implementation, then tests, then persona templates that recognize the
   new statuses.

---

## Context & Constraints

### Code touchpoints

| Layer | File | Role |
|---|---|---|
| Constants | [`mcp-server/src/utils/constants.ts`](../../../mcp-server/src/utils/constants.ts) | `READY_STATUS_FOR_ROLE`, `HANDOFF_STATUS_ROLE`, `PIPELINE_AGENT_MAP` |
| Handoff functions | [`mcp-server/src/tools/workflow-handoff.ts`](../../../mcp-server/src/tools/workflow-handoff.ts) | `get*Handoff`, `buildHandoffResponse`, `nextAgentFromStatus` |
| Action ladders | [`mcp-server/src/tools/workflow-next-action.ts`](../../../mcp-server/src/tools/workflow-next-action.ts) | `get*Action` |
| Embed | [`mcp-server/src/tools/workflow-next-action-batch.ts`](../../../mcp-server/src/tools/workflow-next-action-batch.ts) | `embedHandoffStatusInWait` |
| Spec | [`mcp-server/docs/agents/workflow-specification/handoff.md`](../../../mcp-server/docs/agents/workflow-specification/handoff.md), [`recommendations.md`](../../../mcp-server/docs/agents/workflow-specification/recommendations.md), [`state-machines.md`](../../../mcp-server/docs/agents/workflow-specification/state-machines.md), [`edge-cases.md`](../../../mcp-server/docs/agents/workflow-specification/edge-cases.md) | §13.x, §14.x, §5.x |
| Orchestrator | `orchestrator/src/utils/tool_wrappers.py`, `orchestrator/src/supervisor.py`, `orchestrator/src/state.py` | MCP call interception + supervisor routing |
| Personas | `personas/ledger/src/meta/N-*.yaml` + `personas/ledger/src/content/` | Status recognition for Synthesis, PM, Documentation |
| Tests | `mcp-server/tests/`, `orchestrator/tests/` | Coverage for new statuses + interception |

### Hard invariants

- `BLOCKED` (WP status) and `BLOCKED` (handoff status) remain semantically
  distinct. Renaming to `WP_BLOCKED` / `WORKFLOW_DEADLOCKED` is **deferred**
  to a future major version (out of scope for this plan).
- The ledger remains pure — no `runner` branching inside handoff/action code.
  Consumption asymmetry between IDE and orchestrator is enforced in the
  orchestrator wrapper, not the ledger.
- Cross-platform: TypeScript edits must work on Windows/macOS/Linux (already
  the case); Python edits use `pathlib`/stdlib.
- Workflow logic changes follow the AGENTS.md sequence:
  **spec first → implementation → tests → constraints**.

### Out of scope

- Renaming `BLOCKED` ↔ `WORKFLOW_DEADLOCKED` (breaking change; defer).
- Auto-transitioning circuit-broken WPs to a new `WP_CIRCUIT_BROKEN` status
  (worth a separate design discussion).
- Retiring the Planner role from the roster after plan archival (future
  simplification).

---

## Recommended Solution — Unified Architecture

### A. Ledger: generalize the handoff tail

Every `get*Handoff` function in
[`workflow-handoff.ts`](../../../mcp-server/src/tools/workflow-handoff.ts)
must end with the following deterministic tail (after its role-specific
priority ladder is exhausted):

```ts
// Tail step 1 — Next-ready dispatch.
// Find the first READY WP whose dependencies are satisfied and route to the
// agent owning its first active stage.
const nextReady = findNextReadyDispatchable(wpDetails, root);
if (nextReady) {
  const targetRole = PIPELINE_AGENT_MAP[firstActiveStage(nextReady.active_pipeline_stages)];
  return buildHandoffResponse(role, READY_STATUS_FOR_ROLE[targetRole], reason, …);
}

// Tail step 2 — In-flight stage dispatch (mirrors PM §13.1 step 2b).
// A WP is IN_PROGRESS but its current stage's owning role hasn't been polled.
const inFlight = findInFlightStageDispatch(wpDetails);
if (inFlight) {
  return buildHandoffResponse(role, READY_STATUS_FOR_ROLE[targetOf(inFlight)], reason, …);
}

// Tail step 3 — PM escalation when non-terminal WPs remain but no agent can
// be deterministically chosen (mixed BLOCKED/circuit-broken/triage cases).
if (wpDetails.some((wp) => !isTerminalStatus(wp.status) && needsPmTriage(wp))) {
  return buildHandoffResponse(role, 'READY_FOR_PM', reason, …);
}

// Tail step 4 — Honest terminal classification.
if (allWpsTerminal(wpDetails)) {
  const status = root.synthesis_generated ? 'COMPLETE' : 'READY_FOR_SYNTHESIS';
  return buildHandoffResponse(role, status, reason, …);
}

// Tail step 5 — Genuine deadlock: cyclic deps, all FAIL beyond rework limit, etc.
if (anyWpDeadlocked(wpDetails)) {
  return buildHandoffResponse(role, 'BLOCKED', 'Workflow deadlocked; human intervention required.', …);
}

// Unreachable in practice. Safety net to prevent silent WAIT regressions.
throw new Error(`Unclassifiable handoff state for role=${role}`);
```

This tail replaces every existing `buildHandoffResponse(role, 'WAIT', …)`
call site across all `get*Handoff` functions.

### B. Constants: introduce two new handoff statuses

In [`mcp-server/src/utils/constants.ts`](../../../mcp-server/src/utils/constants.ts):

- Add `READY_FOR_SYNTHESIS` to `READY_STATUS_FOR_ROLE` mapping for the
  `Synthesis` role.
- Add `COMPLETE` as a terminal handoff status (no `HANDOFF_STATUS_ROLE`
  entry — it is its own terminator).
- `BLOCKED` already maps to `Project Manager` — keep, but its semantics
  shift from "WP-level dependency block" (which it never was at handoff
  level) to "workflow deadlock requiring intervention." Document this in
  spec §6.x.
- Remove `WAIT` from any consumer-facing status enums. Internally, keep
  `WAIT` as a value used by `embedHandoffStatusInWait` and the per-WP
  recommendation engine, but `buildHandoffResponse` translates any `WAIT`
  it receives via the classification switch above (the switch in tail
  steps 3–5 IS the translation).

### C. `buildHandoffResponse`: defensive translation

Refactor [`buildHandoffResponse`](../../../mcp-server/src/tools/workflow-handoff.ts)
so that if it ever receives `status === 'WAIT'` (e.g. from a code path not
yet migrated), it runs the same tail-step classification (3–5) before
emitting. An exhaustive switch with a `throw` default catches future
ladders that forget to classify.

### D. Per-WP `WAIT_FOR_*` codes — diagnostic-only

The temporal-guard codes in
[`workflow-next-action.ts`](../../../mcp-server/src/tools/workflow-next-action.ts)
(`WAIT_FOR_DOWNSTREAM`, `WAIT_FOR_REWORK`, `WAIT_FOR_UPSTREAM_REWORK_LIMIT`)
remain. Their behaviour changes as follows:

- When a per-WP `WAIT_FOR_*` would be the answer for one WP, the action
  ladder must continue iterating to find another WP with actionable work for
  the same role.
- If none is found, fall through to the same handoff classification tail
  (via `embedHandoffStatusInWait` → `buildHandoffResponse`).
- The original `WAIT_FOR_*` reason is preserved as a `notes` / `diagnostic`
  field on the *final* routed action so debugging information isn't lost
  ("WP-001 is waiting for QA re-engagement; routing you to WP-002
  implementation instead").
- `WAIT_FOR_UPSTREAM_REWORK_LIMIT` is special: it is a circuit-breaker
  signal. When encountered, escalate to PM with `BLOCKED` (handoff status)
  rather than routing to other WPs (the WP needs cancel/demote/rescope
  judgement).

### E. Orchestrator: tool-wrapper interception

In `orchestrator/src/utils/tool_wrappers.py`:

```python
def call_ledger_tool(tool_name, args, *, current_role, supervisor_state):
    response = mcp.call(tool_name, args)
    auto_handoff = extract_auto_handoff(response)
    if auto_handoff is not None and auto_handoff["role"] != current_role:
        supervisor_state.pending_route = PendingRoute(
            target_role=auto_handoff["role"],
            target_agent=auto_handoff["agent"],
            reason=auto_handoff.get("reason"),
            source_tool=tool_name,
        )
        response = strip_auto_handoff(
            response,
            replacement="Stage complete; supervisor will route the next agent.",
        )
    return response
```

In the supervisor / graph router:

```python
if supervisor_state.pending_route is not None:
    route = supervisor_state.pending_route
    supervisor_state.pending_route = None
    return goto_node_for_role(route.target_role)
# else: existing per-role polling logic, which now also handles
# READY_FOR_SYNTHESIS → synthesis node, COMPLETE → terminate.
```

In `orchestrator/src/state.py`: add `pending_route: Optional[PendingRoute]`
to `OrchestratorState`.

The supervisor's "stop" predicate becomes `status == 'COMPLETE'`.
`READY_FOR_SYNTHESIS` routes to the Synthesis node, which on completion
flips the project to `COMPLETE` via the existing `synthesis_generated` flag.

### F. Spec updates

Order matters per AGENTS.md:

1. `mcp-server/docs/agents/workflow-specification/handoff.md` §13.1–§13.10 —
   replace each role's WAIT exit with the unified tail.
2. `…/recommendations.md` §14.x — clarify per-WP `WAIT_FOR_*` are
   diagnostic only.
3. `…/state-machines.md` — add `READY_FOR_SYNTHESIS` and clarify
   `BLOCKED` (handoff) = deadlock, not dependency wait.
4. `…/edge-cases.md` §21.18, §21.52, §21.66, §21.67 — update to reflect
   that temporal-guard WAITs route to alternative WPs first.
5. `mcp-server/docs/agents/project-manifest/constraints.md` — record the
   new invariant "no handoff function emits runner-visible WAIT."

### G. Persona updates

In `personas/ledger/src/`:

- **Synthesis persona** — recognize `READY_FOR_SYNTHESIS` as its trigger.
- **PM persona** — recognize `BLOCKED` (handoff) as a deadlock signal
  requiring triage / human escalation, distinct from WP-level `BLOCKED`.
- **Documentation persona** — drop any language that says "fall through to
  WAIT" or "defer to orchestrator polling" (the spec itself drops it).
- **All personas** — replace any references to emitting `WAIT` with the
  appropriate terminal/deadlock status.
- Run `node scripts/build-personas.js` and verify `name-mapping.json` is
  unchanged (no role additions).

### H. Tests

| Area | New tests |
|---|---|
| `mcp-server/tests/` | `getDocumentationHandoff` returns `READY_FOR_DEVELOPER` when next READY WP starts at implementation |
| `mcp-server/tests/` | Each `get*Handoff` function returns the correct terminal status when project is complete or deadlocked |
| `mcp-server/tests/` | `buildHandoffResponse` throws if it receives `WAIT` and cannot classify (defensive-throw guard) |
| `mcp-server/tests/` | Per-WP `WAIT_FOR_DOWNSTREAM` for WP-A redirects to RUN_IMPLEMENTATION for WP-B when both have Dev work |
| `mcp-server/tests/` | `WAIT_FOR_UPSTREAM_REWORK_LIMIT` escalates to PM with `BLOCKED` (handoff) |
| `orchestrator/tests/` | Persona node receives cross-role `auto_handoff` → tool-result contains neutral replacement; supervisor state contains route; next tick transitions to target node |
| `orchestrator/tests/` | `READY_FOR_SYNTHESIS` routes to synthesis node; `COMPLETE` terminates the run |

### I. Fixture for the originating bug

Create a regression fixture mirroring `2026-04-30-net10-upgrade`:
- WP-001 COMPLETE with all four stages PASS.
- WP-002 READY with zero pipelines.
- WP-003+ BLOCKED.
Assert: `getDocumentationHandoff` returns `READY_FOR_DEVELOPER` with a
populated `auto_handoff` block.

---

## Comparative Evaluation

| Criterion | Status quo | Recommended (unified tail + interception + status split) |
|---|---|---|
| IDE stalls after Doc finalization | Frequent | Eliminated |
| Spec clarity | `WAIT` overloaded across 3 meanings | Each meaning has its own status |
| Orchestrator complexity | Polls every role, discards WAITs | Event-driven on dispatches; polls only on true WAIT-like states |
| Determinism of routing | Mixed — some roles route, some WAIT | Uniform tail across all roles |
| Diagnostic richness | `WAIT` is opaque | Per-WP `WAIT_FOR_*` becomes a *reason* on a routed action |
| Risk of regression | N/A | Low — defensive throw + per-role tests catch unmigrated paths |
| Migration scope | None | Moderate: spec + ~10 handoff functions + orchestrator wrapper + 3 personas + tests |
| Backwards compat | N/A | Internal symbol `WAIT` retained; runner-visible only changes (no public wire-format break beyond status names) |

---

## Implementation Plan Outline

> Suggested Work Package decomposition. The Planner is free to merge/split.

| WP | Title | Pipeline | Depends on |
|----|-------|----------|------------|
| **WP-1** | Update workflow specification (handoff.md, recommendations.md, state-machines.md, edge-cases.md) for the unified tail + status split | docs-only | — |
| **WP-2** | Add `READY_FOR_SYNTHESIS` to constants + extend `READY_STATUS_FOR_ROLE` and document `COMPLETE` as terminal handoff status | implementation, qa, code-review, documentation | WP-1 |
| **WP-3** | Refactor `buildHandoffResponse` to add the defensive WAIT-translation switch + exhaustive throw default | implementation, qa, code-review, documentation | WP-2 |
| **WP-4** | Generalize the handoff tail across all `get*Handoff` functions (next-ready dispatch → in-flight → PM escalation → terminal/deadlock) | implementation, qa, code-review, documentation | WP-3 |
| **WP-5** | Update per-WP `WAIT_FOR_*` action ladders to iterate to other WPs and attach diagnostic notes; route `WAIT_FOR_UPSTREAM_REWORK_LIMIT` to PM via `BLOCKED` | implementation, qa, code-review, documentation | WP-4 |
| **WP-6** | Add regression fixture for `2026-04-30-net10-upgrade` Doc-stall scenario + comprehensive handoff tests | implementation, qa, code-review, documentation | WP-4, WP-5 |
| **WP-7** | Orchestrator interception: `tool_wrappers.py` extract/strip helpers, `OrchestratorState.pending_route`, supervisor consumption | implementation, qa, code-review, documentation | WP-2 |
| **WP-8** | Orchestrator: route `READY_FOR_SYNTHESIS` → synthesis node, `COMPLETE` → terminate; supervisor stop predicate | implementation, qa, code-review, documentation | WP-7 |
| **WP-9** | Persona updates: Synthesis recognizes `READY_FOR_SYNTHESIS`, PM recognizes deadlock `BLOCKED`, Documentation drops WAIT language | implementation, qa, code-review, documentation | WP-1, WP-4 |
| **WP-10** | Update `mcp-server/docs/agents/project-manifest/constraints.md` with the new invariant "no handoff function emits runner-visible WAIT"; update orchestrator + personas manifests as required by AGENTS.md cross-project rules | docs-only | WP-4, WP-7, WP-9 |

Parallelism opportunities: WP-7/WP-8 (orchestrator) can proceed in parallel
with WP-4/WP-5 (ledger) once WP-2 lands. WP-9 (personas) can start once
WP-1 (spec) lands.

---

## Open Questions for the Planner

1. **Should `BLOCKED` (handoff) be renamed to `DEADLOCKED`?** Recommended
   yes long-term for clarity, but it's a breaking change and is **out of
   scope for this plan**. Flag for a future major version.
2. **Should circuit-broken WPs auto-transition to a new
   `WP_CIRCUIT_BROKEN` status** (separate from `BLOCKED`)? Out of scope —
   for now, `WAIT_FOR_UPSTREAM_REWORK_LIMIT` escalates to PM via handoff
   `BLOCKED` and PM decides the WP fate.
3. **Should the Planner role be retired from the roster** once the plan is
   archived? Pure simplification; out of scope.
4. **Aliases for backwards compat?** If any external consumer (CI hooks,
   scripts) reads handoff statuses, a one-minor-version alias of `WAIT` →
   `BLOCKED`/`COMPLETE`/`READY_FOR_SYNTHESIS` may be warranted. Planner
   should audit external consumers in `scripts/` and `.github/` before
   deciding.

---

## References

- [`2026-04-30-documentation-handoff-stall.md`](2026-04-30-documentation-handoff-stall.md) — root cause + next-ready dispatch + orchestrator interception design.
- [`2026-04-30-wait-state-necessity.md`](2026-04-30-wait-state-necessity.md) — full WAIT-producer inventory + status reduction analysis.
- [`mcp-server/docs/agents/workflow-specification/handoff.md`](../../../mcp-server/docs/agents/workflow-specification/handoff.md) — §13.x role handoff functions.
- [`mcp-server/docs/agents/workflow-specification/recommendations.md`](../../../mcp-server/docs/agents/workflow-specification/recommendations.md) — §14.x action ladders + per-WP WAIT codes.
- [`mcp-server/docs/agents/workflow-specification/state-machines.md`](../../../mcp-server/docs/agents/workflow-specification/state-machines.md) — status enums.
- [`mcp-server/docs/agents/workflow-specification/edge-cases.md`](../../../mcp-server/docs/agents/workflow-specification/edge-cases.md) — temporal-guard rationale.
- [`mcp-server/src/utils/constants.ts`](../../../mcp-server/src/utils/constants.ts) — `READY_STATUS_FOR_ROLE`, `HANDOFF_STATUS_ROLE`, `PIPELINE_AGENT_MAP`.
- [`mcp-server/src/tools/workflow-handoff.ts`](../../../mcp-server/src/tools/workflow-handoff.ts) — all role handoffs + `buildHandoffResponse`.
- [`mcp-server/src/tools/workflow-next-action.ts`](../../../mcp-server/src/tools/workflow-next-action.ts) — per-role action ladders.
- [`mcp-server/src/tools/workflow-next-action-batch.ts`](../../../mcp-server/src/tools/workflow-next-action-batch.ts) — `embedHandoffStatusInWait`.
- `orchestrator/src/utils/tool_wrappers.py`, `orchestrator/src/supervisor.py`, `orchestrator/src/state.py` — interception touchpoints.

AGENT: Research
STATUS: COMPLETE
