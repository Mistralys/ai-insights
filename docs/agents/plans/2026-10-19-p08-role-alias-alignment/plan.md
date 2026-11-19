# Plan

> **Status: STUB — to be fleshed out.** This is a slim placeholder that captures intent, the user's decision and the verified facts. Run the Planner on this folder in Normal Planning mode to expand it into a full plan before execution.

## Plan Audit Cycles
- Audits: none — Plan Auditor v1.12.0
- Architectural Reviews: none — Plan Architect Reviewer v2.3.4

## Summary

Make the MCP server's role checks follow workflow specification §6.5, which says implementations should accept both the short-form (`"Documentation"`) and long-form (`"Documentation Agent"`) role names. Today `updateWorkPackageStatus` accepts the long forms through five hand-written lists, while `requirePmRole()`, used by the four PM-only tools, accepts only `'Project Manager'`. Rework-1 pinned that contract with a characterization test. The user decided to follow the spec in a dedicated plan. Origin: `docs/agents/plans/2026-10-16-p04-pipeline-stage-adjustment-rework-1/synthesis.md` (Deferred, WP-004), split out of `docs/agents/plans/2026-10-19-p04-pipeline-stage-adjustment-rework-2/`.

## Known Facts

Verified on 2026-10-19; see `research-brief.md`.

- `mcp-server/src/utils/pm-role-guard.ts` `requirePmRole(toolName, agentRole)`: exact match on `'Project Manager'`.
- `mcp-server/src/tools/work-package.ts` `updateWorkPackageStatus`: alias lists at L692, L731, L766–L769, L798–L803 and L822, and the Documentation check at L746–L750.
- The manifest (`shared/workflow-manifest.json` → `roles[].name`) lists short forms only. No persona, orchestrator code or root script sends a long form.
- `mcp-server/tests/utils/pm-role-guard.test.ts` currently asserts that `'Project Manager Agent'` is **rejected**. It must flip.

## Intended Direction

- One role-identity helper (likely new, in `mcp-server/src/utils/`) that derives the accepted names for a manifest role (canonical name plus `"<name> Agent"`), with one function such as `isRole(agent, roleName)`.
- `requirePmRole()` and every list in `updateWorkPackageStatus` go through it, which removes the hand-written alias lists.
- Decide during fleshing-out whether the claim guard, `startPipeline`'s PM override (`mcp-server/src/tools/pipeline.ts` L368) and `completePipeline`'s `agent_role` checks also accept aliases, since spec §6.5's note is phrased generally.

## Open Questions

1. Should every `agent_role` / `agent` parameter accept the long form, or only the guards §6.5 lists?
2. Should the long form be normalised to the canonical name before it is stored (for example in `assigned_to`), so routing comparisons keep working?
3. Should this land before or after `docs/agents/plans/2026-10-19-p07-status-guard-spec-alignment/`, which rewrites the same guards? Merging the two plans is an option.

## Dependencies

- After `docs/agents/plans/2026-10-19-p04-pipeline-stage-adjustment-rework-2/`, which reorders the PM-only guards in `work-package-admin.ts`.
- Coordinate with `docs/agents/plans/2026-10-19-p07-status-guard-spec-alignment/`.

## Recommended Workflow
- **Workflow:** to be decided when fleshed out (likely ledger, since it touches authorisation across several tools).
