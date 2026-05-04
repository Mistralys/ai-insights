# Research Report

## Problem Statement

In project `2026-04-30-net10-upgrade` (runner: `vscode`), the Documentation agent
finished the last active pipeline stage of WP-001 successfully and WP-001 was
auto-finalized to `COMPLETE`. Dependency unblocking correctly transitioned WP-002
to `READY`. However, the Documentation agent did **not** auto-hand off — neither
`ledger_get_next_action` nor `ledger_get_handoff_status` returned an
`auto_handoff` block, so the IDE workflow halted.

## Problem Decomposition

1. Why did `ledger_get_next_action` return no actionable work for the Documentation
   agent even though WP-002 was `READY`?
2. Why did the embedded / standalone `handoff_status` resolve to `WAIT` instead of
   `READY_FOR_PM` or `READY_FOR_DEVELOPER`?
3. Why does a `WAIT` handoff status carry no `auto_handoff` payload?

## Context & Constraints

- Ledger snapshot at the time of stall:
  - WP-001: `COMPLETE`, last stage `documentation` PASS, `passed_stages: 4`.
  - WP-002: `READY`, `assigned_to: null`, active stages
    `[implementation, qa, code-review, documentation]`, `passed_stages: 0`.
  - WP-003/004/005: `BLOCKED` on upstream WPs.
  - `auto_handoff_depth: 4` (well below `effectiveMaxDepth(5) = 150` — depth is
    not the cause).
  - `runner: vscode` (no orchestrator polling loop available).
- Relevant code:
  - [`mcp-server/src/tools/workflow-next-action.ts`](mcp-server/src/tools/workflow-next-action.ts) — `getDocumentationAction` (P1–P7 ladder).
  - [`mcp-server/src/tools/workflow-handoff.ts`](mcp-server/src/tools/workflow-handoff.ts) — `getDocumentationHandoff`, `buildHandoffResponse`, `nextAgentFromStatus`.
  - [`mcp-server/src/utils/constants.ts`](mcp-server/src/utils/constants.ts) — `HANDOFF_STATUS_ROLE` mapping.

## Root-Cause Analysis

### 1. `ledger_get_next_action` (Documentation) returned WAIT

`getDocumentationAction` (workflow-next-action.ts L1550–1779) iterates over every
non-terminal, non-BLOCKED WP whose active stages include `documentation`:

| WP | Outcome in the ladder |
|----|-----------------------|
| WP-001 | Skipped (`isTerminalStatus` → COMPLETE). |
| WP-002 | P6 `WRITE_DOCS` requires upstream prerequisite PASS (`hasNewUpstreamPassSince(..., 'code-review', 'documentation')`); WP-002 has zero pipelines → false. P7 `CLAIM_WP` requires `assigned_to === 'Documentation'`; WP-002 is `assigned_to: null` → false. |
| WP-003/004/005 | Skipped (BLOCKED). |

The loop falls through to the default `WAIT` response. This is correct behaviour
for the Documentation role on a per-WP basis, but it provides no cross-WP
escalation hint.

### 2. `getDocumentationHandoff` also returned WAIT

`getDocumentationHandoff` (workflow-handoff.ts L1161–1244) checks:

- **Condition 1 (`readyForDocsList`)**: requires `hasPassedDynamicUpstream(wp, 'documentation')`. WP-002 has no implementation/qa/code-review PASS yet → empty list.
- **Condition 2 (`wpsWithDocFail`)**: no doc pipelines have failed → empty list.
- **Condition 3 (Step 3 comment)** explicitly states:

  > Step 3 of §5.4: WPs in earlier pipeline stages — per spec v2.0.0, Documentation
  > cannot accurately dispatch to the correct upstream agent (Developer / QA /
  > Reviewer etc.). **Defer to orchestrator polling — fall through to WAIT.**

- **Condition 4** → `buildHandoffResponse('Documentation', 'WAIT', …)`.

This is the design decision driving the stall.

### 3. `WAIT` carries no `auto_handoff`

`buildHandoffResponse` (workflow-handoff.ts L182–263) has two consecutive
filters:

```ts
if (
  projectPath && store &&
  status !== 'COMPLETE' &&
  status !== 'BLOCKED' &&
  status !== 'IN_PROGRESS' &&
  getConfig().auto_handoff_enabled &&
  isRegistryLoaded()
) {
  const agentName = nextAgent ? getAgentHandle(nextAgent) : null;
  if (agentName !== null) { /* attach auto_handoff */ }
}
```

`'WAIT'` passes the first filter (it is none of the three excluded values), but
the second filter relies on `nextAgentFromStatus('WAIT', 'Documentation')`,
which:

- is not `'IN_PROGRESS'` (would return current agent),
- is not in `isTerminalStatus()` (WAIT is not a project status),
- has no entry in `HANDOFF_STATUS_ROLE` (only `READY_FOR_*` and `BLOCKED` are
  mapped — see [`mcp-server/src/utils/constants.ts`](mcp-server/src/utils/constants.ts#L78)),

…so it returns `null`. With `nextAgent = null`, `agentName = null`, the
`auto_handoff` key is never attached. The same path is reused by
`computeHandoffStatus` → `embedHandoffStatusInWait`, so the embedded status in
`ledger_get_next_action` is identical.

### 4. Why this only manifests after the *last* stage of a WP

When Documentation runs as the terminal stage and auto-finalizes its WP, the
next ready WP (WP-002) typically has zero pipelines. There is therefore:

- nothing for Documentation to claim,
- no FAIL to self-rework,
- no upstream PASS to re-engage on,

…and Documentation is the only role whose handoff function explicitly delegates
the cross-WP dispatch responsibility to an external polling loop. Other roles
(QA, Reviewer, Release Engineer) all route to `READY_FOR_DEVELOPER` or back into
their own pipelines on FAIL paths, so they are never "stranded" the same way.

## Why depth/registry/config are NOT the cause

| Hypothesis | Verdict |
|------------|---------|
| `auto_handoff_depth` ceiling reached | No — depth = 4, ceiling = `effectiveMaxDepth(5) = 150`. |
| Auto-handoff disabled in config | No — default is `auto_handoff_enabled: true`. |
| Registry not loaded | Would have produced a stall on every prior handoff in the same run; WP-001 had 3 successful auto-handoffs (Dev→QA→Reviewer→Doc). |
| `complete_pipeline` itself is supposed to emit `auto_handoff` | No — `completePipeline` does not call `buildHandoffResponse`; it only emits a textual `--- NEXT STEP ---` guidance block. The handoff block is intentionally produced by `ledger_get_handoff_status` and the embedded one inside `ledger_get_next_action` WAIT responses. |

## Recommended Fix Direction

The Step-3 comment in `getDocumentationHandoff` is more pessimistic than it
needs to be. Documentation *can* deterministically dispatch when there is a
`READY` WP whose first active stage points unambiguously at one specific
agent. Three options, in order of preference:

1. **Preferred — Step 3a "next-ready dispatch":** if no documentation-specific
   work is actionable but at least one WP is `READY` (and its dependencies are
   satisfied), look up its first active stage with
   `firstActiveStage(activeStages)` → `PIPELINE_AGENT_MAP[stage]` → target role,
   then return the corresponding `READY_FOR_*` status. For WP-002 in this
   project: `firstActiveStage(['implementation', 'qa', 'code-review',
   'documentation'])` = `'implementation'` → `Developer` → `READY_FOR_DEVELOPER`.
   This is what the user would expect: Doc finalizes WP-001 → auto-handoff
   straight to Developer for WP-002, no PM hop.
2. **Fallback — Step 3b "escalate to PM":** if Step 3a found no `READY` WP
   (e.g. all remaining WPs are `BLOCKED` on non-dependency reasons or
   `IN_PROGRESS` mid-pipeline), return `READY_FOR_PM` so the PM can triage.
3. **Last-resort fall-through — `WAIT`:** keep the existing behaviour only when
   the project is genuinely waiting (e.g. all remaining WPs are `IN_PROGRESS`
   on stages owned by a different role that hasn't been polled yet — relevant
   for the orchestrator's polling loop).

This composes cleanly: 1 handles the common "advance to next WP" case, 2
handles the "PM judgement needed" case, 3 preserves the orchestrator path.

The same pattern is generalizable to any role whose handoff currently
fall-throughs to `WAIT` after exhausting its own stage's work — but the
narrowest, lowest-risk first cut is to add it only to `getDocumentationHandoff`,
since Documentation is the terminal stage that triggers WP finalization and is
therefore the only role that routinely strands the workflow.

Both 1 and 2 must update:

- The §5.4 (Documentation handoff) section of the workflow specification
  (`mcp-server/docs/agents/workflow-specification/`).
- Tests for `getDocumentationHandoff` in `mcp-server/tests/`.

## Comparative Evaluation

| Criterion | Option 1 (next-ready dispatch) | Option 2 (escalate to PM) | Status quo (WAIT) |
|---|---|---|---|
| Hops to next productive work | 1 (Doc → Dev) | 2 (Doc → PM → Dev) | ∞ (manual restart in IDE) |
| Spec alignment | Natural extension of §5.4 + §14.5 cross-WP routing | Localized to §5.4 — natural extension | Documented but breaks IDE runners |
| Determinism | High — `firstActiveStage` + `PIPELINE_AGENT_MAP` are pure | High — single fixed target (PM) | N/A |
| Risk of regression | Low — only fires when no doc work is actionable AND a READY WP exists | Low — only fires when no doc work is actionable | None |
| Orchestrator parity | No-op for orchestrator (it polls all roles anyway) | Same | Current orchestrator behaviour |

## Recommendation

Implement **Option 1 with Option 2 as fallback**. Concretely, after the
existing Step 1 (ready-for-docs) and Step 2 (FAIL self-rework) checks in
`getDocumentationHandoff`:

```ts
// Step 3a: Cross-WP advance — next READY WP's first active stage.
const nextReady = wpDetails.find(
  (wp) => wp.status === 'READY' && canStartWorkPackage(wp, /* root.work_packages */).allowed
);
if (nextReady) {
  const stages = (nextReady.active_pipeline_stages as PipelineType[] | undefined) ?? DEFAULT_PIPELINE_STAGES;
  const firstStage = firstActiveStage(stages);
  const targetRole = PIPELINE_AGENT_MAP[firstStage];
  const status = READY_STATUS_FOR_ROLE[targetRole];
  return buildHandoffResponse('Documentation', status, `Next ready work package ${nextReady.work_package_id} starts at ${firstStage} (assigned to ${targetRole}).`, undefined, projectPath, store);
}

// Step 3b: No READY WP — escalate to PM for triage.
if (wpDetails.some((wp) => !isTerminalStatus(wp.status))) {
  return buildHandoffResponse('Documentation', 'READY_FOR_PM', 'No documentation work actionable; PM triage required.', undefined, projectPath, store);
}

// Existing fall-through to WAIT preserved as a last resort.
```

For WP-002 in the failing project this returns `READY_FOR_DEVELOPER`, which
populates `auto_handoff` correctly via the existing `HANDOFF_STATUS_ROLE`
mapping and unblocks the IDE workflow with a single Doc → Dev hop.

### Proof-of-Concept Outline

1. Add a fixture mirroring the project state: WP-001 COMPLETE with all four
   stages PASS, WP-002 READY with zero pipelines, WP-003+ BLOCKED.
2. Call `getDocumentationHandoff(wpDetails, projectPath, store)` and assert it
   returns `READY_FOR_PM` with an `auto_handoff` block (after the fix).
3. Verify the existing `WAIT` early-exit cases (all-terminal, all-blocked) are
   unaffected.

## Runner-Specific Consumption — Why the Step-3 Fallback Exists

The Step-3 "defer to orchestrator polling — fall through to WAIT" branch was
added because orchestrator personas were observed acting on cross-WP dispatches
that targeted *other* roles — they treated the `auto_handoff` block as a task
to perform rather than a routing signal. The IDE runner doesn't have this
problem: each persona only ever sees its own turn, and the IDE prompt-runner
consumes `AGENT: X / STATUS: Y` to switch personas.

This means the ledger is correct in *what* it computes, but the two runners
need different *consumption* semantics:

| Runner | Consumer of `auto_handoff` | Mechanism |
|---|---|---|
| IDE (VS Code, Claude Code) | The current persona itself | Persona emits `AGENT: X / STATUS: Y` → IDE switches persona |
| Orchestrator | The supervisor / graph router | Programmatic edge from current node → target node |

The right place to enforce that asymmetry is **not** the ledger (branching the
spec on `runner` would double the routing matrix and leak consumer identity
into a pure state-derivation function), and **not** the personas (LLM
non-determinism is exactly what made the original problem possible). The right
place is the orchestrator's MCP tool wrapper layer, which already sits between
every persona and the MCP server.

### Proposed Orchestrator Code Solution

In the orchestrator's tool-wrapper layer
(`orchestrator/src/utils/tool_wrappers.py` — the module that proxies every MCP
call from a persona node), intercept `ledger_get_handoff_status` and
`ledger_get_next_action` responses **before** they are rendered into the
persona's tool-result message:

```python
# Pseudocode — orchestrator/src/utils/tool_wrappers.py
def call_ledger_tool(tool_name: str, args: dict, *, current_role: str, supervisor_state):
    response = mcp.call(tool_name, args)

    auto_handoff = extract_auto_handoff(response)
    if auto_handoff is not None and auto_handoff["role"] != current_role:
        # Cross-role dispatch: route via the supervisor, not via the persona.
        supervisor_state.pending_route = {
            "target_role": auto_handoff["role"],
            "target_agent": auto_handoff["agent"],
            "reason": auto_handoff.get("reason"),
            "source_tool": tool_name,
        }
        # Strip the dispatch from the persona-visible payload so it cannot
        # mis-act on it. Replace with a neutral, non-actionable line.
        response = strip_auto_handoff(
            response,
            replacement="Stage complete; supervisor will route the next agent.",
        )

    return response
```

Then in the supervisor / graph router (`orchestrator/src/supervisor.py` or the
graph node responsible for choosing the next active node):

```python
# Pseudocode — supervisor tick
if supervisor_state.pending_route is not None:
    route = supervisor_state.pending_route
    supervisor_state.pending_route = None
    return goto_node_for_role(route["target_role"])
# else: existing per-role polling logic
```

This composes with — and ultimately replaces — the polling loop the Step-3
comment defers to. The supervisor becomes event-driven on cross-role
dispatches and only falls back to polling for genuine WAIT states (all-blocked,
mid-pipeline waiting on another agent that hasn't ticked yet).

### What This Enables

With the orchestrator interception in place, the ledger fix can be more
aggressive without risk of regressing orchestrator behaviour:

1. **The Step-3 fallback in `getDocumentationHandoff` can be removed** and
   replaced with the next-ready dispatch logic from §Recommendation. Both
   runners benefit.
2. **The same next-ready / escalate-to-PM pattern can be applied to every
   other role's WAIT exit** (QA mixed-routing, Reviewer dep-blocked, etc.) —
   the orchestrator strips them, the IDE consumes them. One mechanism in the
   ledger, two consumption strategies in the runners.
3. **Future runners** (CLI scripts, CI hooks, etc.) only need to choose their
   consumption strategy — the ledger never needs to learn about them.

### Implementation Touchpoints (Orchestrator Side)

| File | Change |
|---|---|
| `orchestrator/src/utils/tool_wrappers.py` | Add `extract_auto_handoff()` and `strip_auto_handoff()` helpers; intercept handoff/next-action responses. |
| `orchestrator/src/supervisor.py` (or the graph router module) | Add `pending_route` field to supervisor state; consume it on each tick before falling back to polling. |
| `orchestrator/src/state.py` (or wherever `OrchestratorState` is defined) | Add `pending_route: Optional[PendingRoute]` field. |
| `orchestrator/tests/` | New test: persona node receives a cross-role `auto_handoff` → asserts the persona's tool-result contains the neutral replacement, supervisor state contains the route, next tick transitions to the target node. |
| `orchestrator/docs/agents/project-manifest/data-flows.md` | Document the interception flow. |

### Why Code, Not Personas

Persona discipline was the implicit first attempt — personas were *supposed*
to ignore dispatches addressed to other roles. It failed because LLM outputs
are non-deterministic and an actionable-looking JSON block in a tool response
is exactly the kind of input models latch onto. Code interception is
deterministic, testable, and removes the temptation entirely.

## Open Questions

- Should the escalation also fire when Documentation is the *only* remaining
  active stage on the project (e.g. WP-005 in this ledger which is
  `documentation`-only)? Probably yes — same rationale: PM dispatches when no
  doc-specific work is ready.
- Should the Documentation `getDocumentationAction` (`ledger_get_next_action`)
  ladder mirror the same escalation, or is it sufficient to rely on the embedded
  `handoff_status` to carry the `auto_handoff`? Embedding is sufficient because
  `embedHandoffStatusInWait` already runs on every Documentation WAIT response.

## References

- [`mcp-server/src/tools/workflow-handoff.ts`](mcp-server/src/tools/workflow-handoff.ts) — `getDocumentationHandoff` (L1161), `buildHandoffResponse` (L182), `nextAgentFromStatus` (L165)
- [`mcp-server/src/tools/workflow-next-action.ts`](mcp-server/src/tools/workflow-next-action.ts) — `getDocumentationAction` (L1550)
- [`mcp-server/src/tools/workflow-next-action-batch.ts`](mcp-server/src/tools/workflow-next-action-batch.ts) — `embedHandoffStatusInWait` (L44)
- [`mcp-server/src/utils/constants.ts`](mcp-server/src/utils/constants.ts) — `HANDOFF_STATUS_ROLE` (L78), `READY_STATUS_FOR_ROLE` (L60)
- [`mcp-server/storage/ledger/2026-04-30-net10-upgrade/project-ledger.json`](mcp-server/storage/ledger/2026-04-30-net10-upgrade/project-ledger.json)
- [`mcp-server/storage/ledger/2026-04-30-net10-upgrade/WP-001.json`](mcp-server/storage/ledger/2026-04-30-net10-upgrade/WP-001.json)

AGENT: Research
STATUS: COMPLETE
