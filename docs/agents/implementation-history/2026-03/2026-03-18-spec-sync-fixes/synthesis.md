# Synthesis Report: Spec-Implementation Sync Fixes

**Project:** 2026-03-18-spec-sync-fixes
**Date:** 2026-03-18
**Spec version:** 2.4.0

## Summary

Post-sync verification of the ledger MCP server against the v2.4.0 workflow specification identified 5 discrepancies. All have been resolved. The implementation is now fully aligned with the spec.

## Work Packages

### WP-001: Developer `assigned_to` filter (Medium severity)

**Problem:** `getDeveloperAction` had an overly restrictive `assigned_to !== 'Developer'` filter at the top of its WP iteration loop, causing the Developer to miss downstream-triggered rework (P5/P5b) when the WP was assigned to a downstream agent (QA, Reviewer, etc.). No other agent action function had this filter.

**Fix:** Removed the blanket filter from the loop. Added the assignment check to P7 (CLAIM_WP) only, matching spec §14.2 and the pattern used by all other agents.

**Impact:** Developer now correctly sees REWORK actions for WPs with downstream FAIL regardless of current assignee. This was the only functional correctness issue.

**Files:** `workflow-next-action.ts`

### WP-002: Schema descriptions + soft warning 7 (Low severity)

**Problem 1:** Tool schema descriptions for `current_agent` and `agent_role` listed 7 of 9 roles, missing "Security Auditor" and "Release Engineer".

**Problem 2:** `validateActiveStages` was missing soft warning 7 (§9b.2) for non-default, non-full custom pipeline compositions.

**Fix 1:** Updated `.describe()` strings in `workflow-handoff.ts` and `workflow-next-action.ts` to list all 9 canonical roles.

**Fix 2:** Added warning 7 to `validateActiveStages` in `pipeline-maps.ts`. Updated test `work-package.test.ts` to validate the new warning on custom compositions.

**Files:** `workflow-handoff.ts`, `workflow-next-action.ts`, `pipeline-maps.ts`, `work-package.test.ts`

### WP-003: Cosmetic comment fixes (Cosmetic)

**Fix 1:** Updated `constants.ts` comment from "seven-stage workflow" to "nine-agent workflow".

**Fix 2:** Added comment to `enums.ts` documenting `ARCHIVED` in `ProjectStatus` as a GUI auto-archive extension beyond spec §5.2.

**Files:** `constants.ts`, `enums.ts`

## Verification

- `npx tsc --noEmit`: clean (zero errors)
- `npm test`: 44 test files, 1,433 tests, all passing
- All pipeline stages (implementation, QA, code-review, documentation) PASS on all 3 WPs

## Residual Risk

None. All five discrepancies are resolved. The implementation now matches the v2.4.0 specification across all verified areas: enums, agent roles, pipeline types, state transitions, routing maps, dynamic resolve functions, recommendation engine priorities, handoff logic, re-validation guards, and soft guardrails.
