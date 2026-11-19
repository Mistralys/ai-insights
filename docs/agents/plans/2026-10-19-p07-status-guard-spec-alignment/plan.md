# Plan

> **Status: STUB — to be fleshed out.** This is a slim placeholder that captures intent, the user's decision and the verified facts. Run the Planner on this folder in Normal Planning mode to expand it into a full plan before execution.

## Plan Audit Cycles
- Audits: none — Plan Auditor v1.12.0
- Architectural Reviews: none — Plan Architect Reviewer v2.3.4

## Summary

Bring `updateWorkPackageStatus` (`mcp-server/src/tools/work-package.ts`) in line with workflow specification v2.4.0+, which generalised the status guards for PM-composable pipeline stages. The code never followed. It still hardcodes the Documentation agent as the only agent allowed to complete or reopen a WP, and it lacks two other spec rules. The divergence was found while planning `docs/agents/plans/2026-10-19-p04-pipeline-stage-adjustment-rework-2/`, and the user chose a dedicated plan. The spec is authoritative, so the code (and `constraints-workflow.md`, which describes the outdated behaviour) is what changes.

## Known Divergences

Verified on 2026-10-19; see `research-brief.md`.

| Rule | Spec | Code today |
|------|------|------------|
| Who may set `IN_PROGRESS → COMPLETE` | The agent owning the WP's last active stage (`PIPELINE_AGENT_MAP[lastActiveStage(wp)]`), §6.5 / §21.10 | `'Documentation'` / `'Documentation Agent'` only (L746–L760) |
| PASS check before `→ COMPLETE` | The most recent last-active-stage pipeline must be PASS, §21.10 | Not checked; `canCompleteWorkPackage` (`mcp-server/src/schema/validators.ts` L114) checks acceptance criteria only |
| Freshness check | The last-active-stage PASS post-dates the first-active-stage start; vacuous for single-stage WPs, §21.10 | Documentation PASS vs. implementation start |
| `COMPLETE → COMPLETE` | Identity check only; the last-active-stage agent or the PM, §6.2 / §6.5 | Documentation only, and the full completion guards appear to run (verify) |
| `COMPLETE → IN_PROGRESS` | PM or the last-active-stage agent, §6.5 | PM or Documentation |
| Replacing a `dependency` blocker with another type | Allowed for the PM, §6.2 replacement rule | Rejected for everyone (L700–L705) |

In practice, a WP whose last active stage is not `documentation` can only be completed through auto-finalize (`mcp-server/src/tools/pipeline.ts` L494–L520), never through `ledger_update_work_package_status`.

## Intended Direction

- Extract the transition guards into a pure helper module in `mcp-server/src/utils/`, following `mcp-server/src/utils/pipeline-start.ts`, and reuse `lastActiveStage` / `firstActiveStage` from `mcp-server/src/utils/pipeline-maps.ts`.
- Add characterization tests first, then align each guard with the spec, with one test per divergence row.
- Rewrite the outdated rules in `mcp-server/docs/agents/project-manifest/constraints-workflow.md` ("Only the Documentation Agent Can Set COMPLETE", "Reopening a COMPLETE Work Package Requires PM or Documentation") and the matching `api-surface.md` lines.
- Check the persona sources (`personas/ledger/src/`) and the orchestrator for any instruction that relies on Documentation-only completion.

## Open Questions

1. Should this plan absorb `docs/agents/plans/2026-10-19-p08-role-alias-alignment/`, since both rewrite the same guard block?
2. Should the "absent first-active-stage pipeline" case (§21.10, MAY reject) pass vacuously or be rejected?
3. Are there persisted WPs or GUI flows that depend on Documentation completing Reviewer-terminal WPs?

## Dependencies

- After `docs/agents/plans/2026-10-19-p04-pipeline-stage-adjustment-rework-2/`.
- Coordinate with `docs/agents/plans/2026-10-19-p08-role-alias-alignment/`.

## Recommended Workflow
- **Workflow:** to be decided when fleshed out (likely ledger: a workflow-logic change with security-relevant authorisation impact).
