# Research Brief

> Stub brief. These facts were gathered while planning `2026-10-19-p04-pipeline-stage-adjustment-rework-2`. Re-verify the line numbers when fleshing out the plan.

## Scope Sketch
- Role guards — `mcp-server/src/utils/pm-role-guard.ts`, `mcp-server/src/tools/work-package.ts` — modification
- Possible new role-identity helper — `mcp-server/src/utils/` — new code
- Spec and manifest docs — `mcp-server/docs/agents/workflow-specification/state-machines.md`, `mcp-server/docs/agents/project-manifest/` — modification

## Area: Role Guards

### Verified References
- `mcp-server/src/utils/pm-role-guard.ts`: `requirePmRole(toolName, agentRole)` returns `null` only for `'Project Manager'`. Used by the four tools in `mcp-server/src/tools/work-package-admin.ts`.
- `mcp-server/src/tools/work-package.ts` `updateWorkPackageStatus` (L660+):
  - `pmAgents = ['Project Manager', 'Project Manager Agent']` at L692 (BLOCKED → BLOCKED), L731 (BLOCKED → IN_PROGRESS) and L822 (IN_PROGRESS → READY).
  - CANCELLED list at L766–L769.
  - COMPLETE → IN_PROGRESS list at L798–L803 (PM and Documentation, both forms).
  - COMPLETE check at L746–L750 (`'Documentation'` / `'Documentation Agent'`).
  - Schema description at L635 mentions `"Documentation Agent"`.
- `mcp-server/src/tools/pipeline.ts` L368: `isPmOverride = args.agent_role === 'Project Manager'` (short form only).
- `mcp-server/src/utils/constants.ts` L25: `AGENT_ROLES` derived from `shared/workflow-manifest.json`.

### Established Patterns
- Manifest-derived role constants — `mcp-server/src/utils/constants.ts`.
- Pure guard helpers in `src/utils/` — `mcp-server/src/utils/pm-role-guard.ts`, `mcp-server/src/utils/pipeline-start.ts`.

### Structural Observations
- Five hand-written alias lists in one function, plus a separate exact-match helper: the drift that produced the asymmetry.

### Constraints
- Spec `mcp-server/docs/agents/workflow-specification/state-machines.md` §6.5 (L207–L222): "Implementations should accept both short-form ("Documentation") and long-form ("Documentation Agent") variants."

## Area: Tests and Docs

### Verified References
- Tests using long forms: `mcp-server/tests/tools/work-package.test.ts` (L55–L57, L95–L106, L593–L609, L2464–L2466, L2711–L2731, L2895–L2900), `mcp-server/tests/integration/full-workflow.test.ts` (L848, L860), `mcp-server/tests/utils/pm-role-guard.test.ts` (L11, L34–L40, which asserts rejection).
- Docs naming the aliases: `mcp-server/docs/agents/project-manifest/api-surface.md` L310–L315, `mcp-server/docs/agents/project-manifest/constraints-workflow.md` L67–L69, L127, L169.
- No long-form consumer in `personas/*/src`, `personas/shared`, `orchestrator/src` or `scripts/`.
