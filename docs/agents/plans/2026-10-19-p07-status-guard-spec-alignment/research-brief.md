# Research Brief

> Stub brief. These facts were gathered while planning `2026-10-19-p04-pipeline-stage-adjustment-rework-2`. Re-verify the line numbers when fleshing out the plan.

## Scope Sketch
- Status-transition guards — `mcp-server/src/tools/work-package.ts` — modification
- Guard helper module — `mcp-server/src/utils/` — new code
- Manifest docs — `mcp-server/docs/agents/project-manifest/constraints-workflow.md`, `api-surface.md` — modification

## Area: Status-Transition Guards

### Verified References
- `mcp-server/src/tools/work-package.ts` `updateWorkPackageStatus` (L660+), guards in order:
  1. Transition validity.
  2. BLOCKED → BLOCKED replacement (L691–L712; dependency-type rule without a PM exception at L700–L705).
  3. READY → IN_PROGRESS redirect.
  4. BLOCKED → IN_PROGRESS agent guard.
  5. `→ COMPLETE` Documentation-only (L746–L760).
  6. `→ CANCELLED` PM-only.
  7. Acceptance criteria via `canCompleteWorkPackage`.
  8. BLOCKED requires `blocked_by`.
  9. COMPLETE → IN_PROGRESS (PM / Documentation, L796–L810).
  10. IN_PROGRESS → READY.
  11. Freshness: documentation PASS vs. implementation start (about L835–L855).
- `mcp-server/src/schema/validators.ts` L114 `canCompleteWorkPackage`: acceptance criteria only.
- `mcp-server/src/utils/pipeline-maps.ts` L395 `lastActiveStage(stages)`; `firstActiveStage` in the same module.
- `mcp-server/src/tools/pipeline.ts` L494–L520: auto-finalize already uses `lastActiveStage` and `PIPELINE_AGENT_MAP`.

### Established Patterns
- Pure guard helper used inside `updateWorkPackageWithSync` — `mcp-server/src/utils/pipeline-start.ts`.

### Structural Observations
- About 200 lines of inline guards in one updater callback, with five hand-written role lists.

### Constraints
- Spec: `mcp-server/docs/agents/workflow-specification/state-machines.md` §6.2 (L129–L137), §6.5 (L207–L222); `edge-cases.md` §21.10 (L90–L107); spec changelog v2.4.0 "Generalized COMPLETE guard" (`README.md` L80).
- Manifest drift: `mcp-server/docs/agents/project-manifest/constraints-workflow.md` L67 and L165+ describe the pre-v2.4.0 behaviour.
- Workflow logic changes follow root `AGENTS.md` order: spec, then code, then tests, then `constraints-workflow.md`. Here the spec is already correct.
