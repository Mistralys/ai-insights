# Fix Spec-Implementation Sync Discrepancies

## Overview

Post-sync verification of the ledger MCP server (v2.4.0) against the workflow specification revealed 5 discrepancies. All core logic is correct, but these items prevent full spec compliance. Fixing them makes the implementation bulletproof.

## Changes

### Fix 1: Developer `assigned_to` filter (Medium — functional correctness)

`getDeveloperAction` at `workflow-next-action.ts:485` has an overly restrictive `assigned_to !== 'Developer'` filter that causes the Developer to miss downstream-triggered rework (P5/P5b) when QA/Reviewer has started their pipeline (changing `assigned_to`). The spec §14.2 does not apply an `assigned_to` filter — only P7 (CLAIM_WP) should check assignment. No other agent action function has this filter.

**Action:** Remove the blanket filter; move assignment check into P7 only.

### Fix 2: Tool schema descriptions missing "Security Auditor" and "Release Engineer"

The `.describe()` strings for `current_agent` (workflow-handoff.ts) and `agent_role` (workflow-next-action.ts) list 7 of 9 roles. Missing "Security Auditor" and "Release Engineer".

**Action:** Update descriptions to list all 9 canonical roles.

### Fix 3: Missing soft warning 7 in `validateActiveStages`

Spec §9b.2 rule 7 requires a soft warning when `active_pipeline_stages` is a non-default, non-full custom composition. Implementation only has warnings 5 (impl without qa) and 6 (single-stage).

**Action:** Add warning 7 to `pipeline-maps.ts:validateActiveStages`.

### Fix 4: Stale comment in `constants.ts`

Comment says "seven-stage workflow" but should say "nine-agent workflow".

**Action:** Update comment.

### Fix 5: Document `ARCHIVED` as implementation extension

`ProjectStatus` includes `ARCHIVED` (not in spec §5.2) but it's actively used by the GUI auto-archive system. Legitimate extension.

**Action:** Add clarifying comment to `enums.ts`.

## Acceptance Criteria

- Developer's `getNextAction` returns REWORK (not WAIT) for WPs with downstream FAIL when assigned_to is not "Developer"
- Tool schema descriptions list all 9 agent roles
- `validateActiveStages` emits warning for non-default custom compositions
- All comments accurately reflect the 9-agent workflow
- `npx tsc --noEmit` passes
- All existing tests pass
