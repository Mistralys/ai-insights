# Plan

## Summary

Add pipeline-aware routing to the Project Manager's handoff function and recommendation engine. Currently, when all WPs are IN_PROGRESS and a pipeline stage completes (e.g., implementation PASS), the PM handoff returns WAIT — leaving no `auto_handoff` for the PM to dispatch the next pipeline agent (e.g., QA). This plan inserts a new step 2b into the PM handoff algorithm that detects pending pipeline stages in IN_PROGRESS WPs and routes to the owning agent, closing the auto-handoff gap.

## Architectural Context

The PM handoff and recommendation engine are the two core dispatch mechanisms for the orchestrating agent:

- **Handoff function** — `getProjectManagerHandoff()` in [mcp-server/src/tools/workflow-handoff.ts](mcp-server/src/tools/workflow-handoff.ts#L330) implements the §13.1 algorithm: 4 steps checking blockers → READY WPs → all terminal → WAIT fallback. The function produces a `handoff_status` that is embedded in `get_next_action` WAIT responses via `embedHandoffStatusInWait()`, providing the `auto_handoff` field that the PM persona and orchestrator runner use for dispatch.
- **Recommendation engine** — `getProjectManagerAction()` in [mcp-server/src/tools/workflow-next-action.ts](mcp-server/src/tools/workflow-next-action.ts#L335) implements the §14.1.2 five-priority algorithm: UNBLOCK_WP → REVIEW_REWORK_LIMIT → REVIEW_STALE → REVIEW_ABANDONED → REPAIR_ORPHAN_BLOCKED → WAIT.
- **Pipeline maps** — `PIPELINE_AGENT_MAP`, `resolvePrerequisite`, `firstActiveStage`, `getOrderedActiveStages` in [mcp-server/src/utils/pipeline-maps.ts](mcp-server/src/utils/pipeline-maps.ts) provide stage→agent mapping and ordering. `PIPELINE_AGENT_MAP`, `resolvePrerequisite`, `firstActiveStage`, and `DEFAULT_PIPELINE_STAGES` are already imported by `workflow-handoff.ts`; `getOrderedActiveStages` is **not** currently imported and must be added.
- **Workflow helpers** — `isMostRecentPipelineFail`, `isBlockedByDependencies`, `isActivePipeline`, `mostRecentEffectivePipeline` in [mcp-server/src/utils/workflow-helpers.ts](mcp-server/src/utils/workflow-helpers.ts) provide pipeline state inspection.
- **Workflow specification** — [mcp-server/docs/agents/workflow-specification/](mcp-server/docs/agents/workflow-specification/README.md) (v2.4.2) is the authoritative spec. PM Handoff is §13.1, PM Action Logic is §14.1.2, edge cases are §21.xx (highest: §21.69).

**Root cause:** Every pipeline agent's handoff function (Developer, QA, Reviewer, etc.) examines pipeline states within WPs to determine routing. The PM is the only agent that does NOT — it only looks at WP-level statuses (READY, BLOCKED, COMPLETE, IN_PROGRESS). When all WPs are IN_PROGRESS and a stage completes, the PM sees "in-flight work" and returns WAIT, even though the next pipeline agent needs to be engaged.

**Research:** Full analysis in [docs/agents/research/2026-04-21-pm-handoff-gap.md](docs/agents/research/2026-04-21-pm-handoff-gap.md).

## Approach / Architecture

Insert a new **step 2b** in both the PM handoff function and the PM recommendation engine that scans IN_PROGRESS WPs for pipeline stage transitions:

1. Walk each non-terminal, non-dependency-blocked IN_PROGRESS WP's `active_pipeline_stages` in canonical order.
2. Find the first stage that does not have a PASS pipeline (most recent non-auto-cancelled).
3. If that stage's most recent pipeline is FAIL → skip (FAIL routing is handled by the downstream agent's own handoff).
4. If that stage's most recent pipeline is IN_PROGRESS → skip (stage already being worked on).
5. If the upstream prerequisite has an IN_PROGRESS pipeline → skip (premature routing prevention).
6. Otherwise → route to `PIPELINE_AGENT_MAP[stage]`.

This step fires only when step 2 (READY WPs) does not match, preserving the existing priority: READY WPs are always routed first.

## Rationale

- **Consistency:** All other pipeline agents' handoff functions examine pipeline states. The PM should too.
- **Both runners benefit:** VS Code PM persona and orchestrator runner both call `get_next_action("Project Manager")` / `get_handoff_status("Project Manager")`. A server-side fix covers both.
- **Deterministic routing:** The ledger remains the authoritative dispatch mechanism, not subagent text parsing.
- **Minimal blast radius:** The new step only fires when no READY WPs exist, and includes guards against FAIL and IN_PROGRESS upstream stages.

## Detailed Steps

### Step 1: Workflow Specification — Handoff Update (§13.1)

**File:** `mcp-server/docs/agents/workflow-specification/handoff.md`

Insert step 2b into the PM Handoff algorithm between step 2 (READY WPs) and step 3 (all terminal):

```
Step 2b: IN_PROGRESS WPs needing next pipeline stage
  for each non-terminal, non-dependency-blocked WP with status == "IN_PROGRESS":
    activeStages = wp.active_pipeline_stages ?? DEFAULT_PIPELINE_STAGES
    for each stage in activeStages (in canonical order):
      if stage has a PASS pipeline (most recent non-auto-cancelled):
        continue  // done, check next stage
      // This is the first stage not yet PASS
      if stage has a recent FAIL pipeline (most recent non-auto-cancelled):
        break     // FAIL routing handles this WP; skip to next WP
      if stage has an IN_PROGRESS pipeline (most recent non-auto-cancelled):
        break     // stage already being worked on; skip to next WP
      upstreamStage = resolvePrerequisite(stage, activeStages)
      if upstreamStage != null AND upstreamStage has an IN_PROGRESS pipeline:
        break     // upstream still running; skip to next WP
      nextAgent = PIPELINE_AGENT_MAP[stage]
      return readyStatusForAgent(nextAgent)
```

Add a design note explaining: the PM was blind to intra-WP pipeline transitions, causing auto-handoff stalls after a pipeline stage PASSed when no READY WPs remained.

Add a second design note: step 2b intentionally covers freshly-claimed IN_PROGRESS WPs with zero pipelines. When no pipelines exist yet, the first active stage has no PASS, no FAIL, and no IN_PROGRESS — so the algorithm routes to `PIPELINE_AGENT_MAP[firstActiveStage(wp)]`. This is correct: the WP was claimed but the owning agent has not yet called `startPipeline`. The REVIEW_ABANDONED priority (§14.1.2 priority 3b) separately handles the case where a claimed WP remains idle beyond the staleness grace period.

### Step 2: Workflow Specification — Recommendation Engine Update (§14.1.2)

**File:** `mcp-server/docs/agents/workflow-specification/recommendations.md`

Add a new priority **3d: ROUTE_PIPELINE_AGENT** after REPAIR_ORPHAN_BLOCKED and before WAIT:

```
3d. ROUTE_PIPELINE_AGENT: Any non-terminal, non-dependency-blocked
    IN_PROGRESS WP where the next active pipeline stage has no pipeline
    started (or no PASS). This covers two scenarios: (a) a stage has
    PASSed and the next stage needs work, and (b) a freshly-claimed WP
    with zero pipelines where the first active stage's agent needs to
    begin. PM should route to the agent owning that stage. Same guards
    as §13.1 step 2b.
```

### Step 3: Workflow Specification — Edge Case Documentation

**File:** `mcp-server/docs/agents/workflow-specification/edge-cases.md`

Add **§21.70 PM Pipeline-Routing for IN_PROGRESS WPs**:

> When all READY WPs have been claimed and IN_PROGRESS WPs have a pending pipeline stage, the PM handoff must detect it and route to the owning agent. This includes two scenarios: (a) a stage has PASSed and the next active stage has no pipeline started, and (b) a freshly-claimed WP with zero pipelines where the first active stage's agent needs to begin work. Guards: FAIL stages are skipped (handled by downstream agent's FAIL routing), current-stage IN_PROGRESS pipelines are skipped (stage already being worked on), upstream IN_PROGRESS stages are skipped (premature routing prevention), dependency-blocked WPs are excluded.

### Step 4: Workflow Specification — Version Bump

**File:** `mcp-server/docs/agents/workflow-specification/README.md`

Bump the spec version from 2.4.2 to 2.4.3 with a changelog entry describing the PM pipeline-routing addition.

### Step 5: Implementation — PM Handoff Function

**File:** `mcp-server/src/tools/workflow-handoff.ts`
**Function:** `getProjectManagerHandoff()` (line ~330)

Insert a new loop between step 2 (READY WPs, line ~352) and step 3 (all terminal, line ~375):

```typescript
// Step 2b: IN_PROGRESS WPs needing next pipeline stage (§13.1 step 2b)
for (const wp of wpDetails) {
  if (isTerminalStatus(wp.status) || wp.status !== 'IN_PROGRESS') continue;
  if (isBlockedByDependencies(wp)) continue;

  const activeStages = getOrderedActiveStages(
    (wp.active_pipeline_stages as PipelineType[] | undefined) ?? [...DEFAULT_PIPELINE_STAGES]
  );

  for (const stage of activeStages) {
    // Check if this stage has a PASS pipeline (most recent non-auto-cancelled)
    const matching = wp.pipelines.filter(p => p.type === stage && !p.auto_cancelled);
    const mostRecent = matching.at(-1);

    if (mostRecent?.status === 'PASS') continue; // stage done, check next

    // First stage not yet PASS
    if (mostRecent?.status === 'FAIL') break; // FAIL routing handles this WP
    if (mostRecent?.status === 'IN_PROGRESS') break; // stage already being worked on

    // Check upstream prerequisite
    const upstream = resolvePrerequisite(stage, activeStages);
    if (upstream) {
      const upstreamPipelines = wp.pipelines.filter(
        p => p.type === upstream && !p.auto_cancelled
      );
      if (upstreamPipelines.at(-1)?.status === 'IN_PROGRESS') break;
    }

    const targetAgent = PIPELINE_AGENT_MAP[stage];
    const status = readyStatusForAgent(targetAgent);
    return buildHandoffResponse(
      'Project Manager',
      status,
      `Work package ${wp.work_package_id} is IN_PROGRESS with ` +
        `${stage} stage pending. Routing to ${targetAgent}.`,
      undefined,
      projectPath,
      store
    );
  }
}
```

**Imports needed:** `getOrderedActiveStages` from `pipeline-maps.ts` — **not** currently imported by `workflow-handoff.ts`, must be added to the existing import block (line ~11). `isBlockedByDependencies` from `workflow-helpers.ts` is already imported.

### Step 6: Implementation — PM Recommendation Engine

**File:** `mcp-server/src/tools/workflow-next-action.ts`
**Function:** `getProjectManagerAction()` (line ~335)

Add a new priority block **3d: ROUTE_PIPELINE_AGENT** after REPAIR_ORPHAN_BLOCKED (line ~454) and before the WAIT fallback (line ~462):

```typescript
// --- Priority 3d: ROUTE_PIPELINE_AGENT ---
// IN_PROGRESS WPs where a pipeline stage has PASSed and the next stage needs work
for (const wpDetail of wpDetails) {
  if (isTerminalStatus(wpDetail.status) || wpDetail.status !== 'IN_PROGRESS') continue;
  if (hasDependencyBlocked(wpDetail)) continue;

  const activeStages = getOrderedActiveStages(
    (wpDetail.active_pipeline_stages as PipelineType[] | undefined) ?? [...DEFAULT_PIPELINE_STAGES]
  );

  for (const stage of activeStages) {
    const matching = wpDetail.pipelines.filter(p => p.type === stage && !p.auto_cancelled);
    const mostRecent = matching.at(-1);

    if (mostRecent?.status === 'PASS') continue;
    if (mostRecent?.status === 'FAIL') break;
    if (mostRecent?.status === 'IN_PROGRESS') break; // stage already being worked on

    const upstream = resolvePrerequisite(stage, activeStages);
    if (upstream) {
      const upstreamPipelines = wpDetail.pipelines.filter(
        p => p.type === upstream && !p.auto_cancelled
      );
      if (upstreamPipelines.at(-1)?.status === 'IN_PROGRESS') break;
    }

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          action: 'ROUTE_PIPELINE_AGENT',
          work_package_id: wpDetail.work_package_id,
          pipeline_type: stage,
          next_agent: PIPELINE_AGENT_MAP[stage],
          reason: `Work package ${wpDetail.work_package_id} needs its ` +
            `${stage} stage started. Route to ${PIPELINE_AGENT_MAP[stage]}.`,
        }, null, 2),
      }],
    };
  }
}
```

**Imports needed:** `getOrderedActiveStages` from `pipeline-maps.ts` (verify already imported; add if missing). `hasDependencyBlocked` is already used in this file.

### Step 7: Tests — PM Handoff Pipeline Routing

**File:** `mcp-server/tests/tools/workflow-handoff.test.ts`

Add a new `describe` block after the existing PM handoff test suites (after line ~2079):

**Test cases:**

1. **Happy path: impl PASS → routes to QA.** WP is IN_PROGRESS with a single PASS implementation pipeline. PM handoff returns `READY_FOR_QA` with `auto_handoff`.
2. **Multi-stage: impl PASS + QA PASS → routes to Reviewer.** PM handoff returns `READY_FOR_REVIEW`.
3. **FAIL guard: impl PASS + QA FAIL → WAIT.** PM handoff returns WAIT because the QA FAIL is handled by QA's own handoff.
4. **Current-stage IN_PROGRESS guard: impl IN_PROGRESS → WAIT.** PM handoff returns WAIT because the stage is already being worked on (note: `implementation` has no upstream — `resolvePrerequisite` returns `null` for the first active stage — so this guard must check the current stage itself, not just the upstream).
5. **READY takes priority: one READY + one IN_PROGRESS with impl PASS → routes to READY WP.** Step 2 short-circuits before step 2b fires.
6. **Dependency-blocked: IN_PROGRESS WP is dependency-blocked → WAIT.** Step 2b skips it.
7. **All stages PASS: IN_PROGRESS WP with all active stages PASS → WAIT.** Step 2b finds no pending stage (WP should transition to COMPLETE via self-healing, but that is out of scope).
8. **Custom active stages: WP with `active_pipeline_stages: ["implementation", "code-review"]` and impl PASS → routes to Reviewer** (skipping QA which is not active).
9. **Upstream IN_PROGRESS guard: impl PASS + QA IN_PROGRESS → WAIT.** PM handoff returns WAIT because the QA stage is currently in progress (distinct from test 4 which tests a first-stage IN_PROGRESS with no upstream).
10. **Zero-pipeline freshly-claimed WP: IN_PROGRESS WP with zero pipelines → routes to first active stage's agent.** For default stages, routes to Developer. For a documentation-only WP (`["documentation"]`), routes to Documentation.
11. **Zero-pipeline freshly-claimed WP with custom stages: IN_PROGRESS WP with `active_pipeline_stages: ["qa", "code-review"]` and zero pipelines → routes to QA** (the first active stage's agent).

### Step 8: Tests — PM Recommendation Engine

**File:** `mcp-server/tests/tools/workflow-next-action.test.ts`

Add tests within or after the existing `'PM action logic'` describe block (line ~264):

**Test cases:**

1. **ROUTE_PIPELINE_AGENT returned for impl PASS + no QA.** Action is `ROUTE_PIPELINE_AGENT` with `next_agent: "QA"` and `pipeline_type: "qa"`.
2. **Priority ordering: REVIEW_STALE fires before ROUTE_PIPELINE_AGENT.** A stale IN_PROGRESS pipeline takes precedence.
3. **Priority ordering: REPAIR_ORPHAN_BLOCKED fires before ROUTE_PIPELINE_AGENT.** An orphan-blocked WP takes precedence.
4. **Zero-pipeline freshly-claimed WP.** Action is `ROUTE_PIPELINE_AGENT` with `next_agent` matching the first active stage's agent and `pipeline_type` matching the first active stage.

### Step 9: Manifest Documentation Updates

**After implementation and tests pass:**

| File | Update |
|------|--------|
| `mcp-server/docs/agents/project-manifest/api-surface.md` | Add `ROUTE_PIPELINE_AGENT` to the PM action type list |
| `mcp-server/docs/agents/project-manifest/constraints.md` | Add invariant: PM handoff must detect pending pipeline stages in IN_PROGRESS WPs |
| `mcp-server/docs/agents/project-manifest/data-flows.md` | Update PM handoff flow description if pipeline routing is documented there |

## Dependencies

- Steps 1–4 (spec changes) must be completed before steps 5–6 (implementation).
- Steps 5–6 (implementation) must be completed before steps 7–8 (tests).
- Step 9 (manifest docs) is done after tests pass.
- No external dependencies or new npm packages required.

## Required Components

- `mcp-server/docs/agents/workflow-specification/handoff.md` — spec update
- `mcp-server/docs/agents/workflow-specification/recommendations.md` — spec update
- `mcp-server/docs/agents/workflow-specification/edge-cases.md` — new §21.70
- `mcp-server/docs/agents/workflow-specification/README.md` — version bump
- `mcp-server/src/tools/workflow-handoff.ts` — `getProjectManagerHandoff()` modification
- `mcp-server/src/tools/workflow-next-action.ts` — `getProjectManagerAction()` modification
- `mcp-server/src/utils/pipeline-maps.ts` — import source (no changes)
- `mcp-server/src/utils/workflow-helpers.ts` — import source (no changes)
- `mcp-server/tests/tools/workflow-handoff.test.ts` — new test cases
- `mcp-server/tests/tools/workflow-next-action.test.ts` — new test cases
- `mcp-server/docs/agents/project-manifest/api-surface.md` — doc update
- `mcp-server/docs/agents/project-manifest/constraints.md` — doc update

## Assumptions

- The existing `PIPELINE_AGENT_MAP`, `resolvePrerequisite`, and `getOrderedActiveStages` utilities are correct and sufficient for the new logic.
- The `isMostRecentPipelineFail` pattern (filter non-auto-cancelled, check `.at(-1)`) is the canonical way to inspect stage state, and can be replicated inline in the new step.
- The PM handoff's step 2b should use the same `readyStatusForAgent()` helper already used in step 2 for READY WPs.
- When multiple IN_PROGRESS WPs need different next-stage agents, the first matching WP (iteration order) wins. This is consistent with the short-circuit semantics used throughout the handoff system.
- The `ROUTE_PIPELINE_AGENT` action type is new and does not conflict with existing action types.
- Step 2b intentionally covers freshly-claimed IN_PROGRESS WPs with zero pipelines: the first active stage has no PASS/FAIL/IN_PROGRESS pipeline, so the algorithm routes to `PIPELINE_AGENT_MAP[firstActiveStage(wp)]`. This is correct because the WP was claimed but the owning agent has not yet called `startPipeline`.

## Constraints

- **Workflow Specification first.** Per AGENTS.md: spec changes (steps 1–4) must be completed before implementation code (steps 5–6), which must be completed before tests (steps 7–8), which must be completed before manifest docs (step 9).
- **No new dependencies.** All required helpers already exist in `pipeline-maps.ts` and `workflow-helpers.ts`.
- **Cross-platform.** No OS-specific code involved.
- **Backward-compatible.** The new step only adds routing where WAIT was previously returned. No existing routing paths are altered.

## Out of Scope

- **Self-healing for "all stages PASS" WPs.** If an IN_PROGRESS WP has all active stages PASS, it should transition to COMPLETE. This is a separate concern (auto-completion) and is not addressed here.
- **Multi-WP priority heuristics.** When multiple IN_PROGRESS WPs need different next-stage agents, simple iteration-order priority is used. A more sophisticated priority scheme (e.g., prefer the WP whose pending stage is earliest in the canonical pipeline order) could be a follow-up.
- **PM persona instruction changes.** The PM persona relies on `auto_handoff` from the embedded `handoff_status`. Since the handoff function now produces the correct `auto_handoff`, no persona changes are needed.
- **Orchestrator code changes.** The orchestrator calls the same MCP tools and benefits automatically.

## Acceptance Criteria

- PM handoff returns `READY_FOR_QA` (with `auto_handoff`) when a WP has implementation PASS and no QA pipeline started.
- PM handoff returns `READY_FOR_REVIEW` when a WP has impl PASS + QA PASS and no code-review pipeline.
- PM handoff returns WAIT when the next stage's most recent pipeline is FAIL.
- PM handoff returns WAIT when the current stage has an IN_PROGRESS pipeline (stage already being worked on).
- PM handoff returns WAIT when the upstream stage has an IN_PROGRESS pipeline.
- PM handoff still prioritizes READY WPs over IN_PROGRESS pipeline routing (step 2 before step 2b).
- PM handoff still routes to Synthesis when all WPs are terminal.
- PM recommendation engine returns `ROUTE_PIPELINE_AGENT` with correct `next_agent` and `pipeline_type` fields.
- `ROUTE_PIPELINE_AGENT` priority is lower than REVIEW_STALE, REVIEW_ABANDONED, and REPAIR_ORPHAN_BLOCKED.
- PM handoff routes freshly-claimed IN_PROGRESS WPs (zero pipelines) to the agent owning the first active stage (e.g., Developer for default stages, Documentation for `["documentation"]`).
- All existing PM handoff and action tests continue to pass.
- All new tests pass.
- Workflow specification is updated before implementation code.

## Testing Strategy

**Unit tests** in two existing test files:

1. `workflow-handoff.test.ts` — Test PM handoff step 2b with mock `WorkPackageDetail` objects containing various pipeline state combinations. Use the existing test patterns (mock store, mock WP details, assert on response status and message).
2. `workflow-next-action.test.ts` — Test PM action logic ROUTE_PIPELINE_AGENT priority and payload structure.

**Integration coverage** — The existing `auto-handoff.test.ts` full-chain test (`PM → Developer → QA → Reviewer → Documentation → Synthesis`) may implicitly cover the happy path if it exercises the PM re-dispatch after Developer completion. Verify and extend if needed.

**Edge case coverage** — Each guard (FAIL skip, IN_PROGRESS upstream skip, dependency-blocked skip, custom active stages) gets a dedicated test case.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Rework interaction:** After `impl PASS → qa FAIL → impl-2 PASS`, PM routes to QA, but QA's own handoff also detects re-engagement via `hasNewUpstreamPassSince`. Could cause duplicate routing. | Safe: PM routes to QA, then QA's `get_next_action` determines RE_ENGAGE vs. WAIT. The PM's routing is the trigger; QA's logic is the gate. No conflict. |
| **Multi-WP ambiguity:** Multiple WPs need different next agents simultaneously. | First-match short-circuit is used (consistent with all other handoff functions). For `max_results > 1` batch mode, the collector already handles multi-WP scenarios independently. |
| **Step 2b fires for WPs that are legitimately waiting.** E.g., a WP where implementation hasn't started yet (no pipelines at all). | The loop finds implementation as the first non-PASS stage. Since there's no upstream prerequisite for implementation (`resolvePrerequisite` returns null), and no FAIL pipeline, it routes to Developer — which is correct (the WP needs implementation work). |
| **Performance:** Extra loop over WPs and their pipelines. | Negligible — WP counts are small (typically 1–10), pipeline arrays are short. No async I/O added. |
