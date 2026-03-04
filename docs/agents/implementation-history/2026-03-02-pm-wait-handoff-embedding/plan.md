# Plan

## Summary

Fix a bug where the Project Manager's `WAIT` response from `ledger_get_next_action` does not include the embedded `handoff_status` payload. All other agent roles (Developer, QA, Reviewer, Documentation, Synthesis) correctly receive `handoff_status` in their WAIT responses via `embedHandoffStatusInWait`, but the PM case was missed during the original WP-004 implementation in the `2026-03-01-ledger-tool-simplification` project.

## Architectural Context

The `getNextAction` function in [mcp-server/src/tools/workflow-next-action.ts](mcp-server/src/tools/workflow-next-action.ts#L213) dispatches to per-role action functions via a `switch` statement (lines 213–260). Each case wraps the result in `embedHandoffStatusInWait()` — **except** the `'Project Manager'` case at [line 217](mcp-server/src/tools/workflow-next-action.ts#L217):

```typescript
case 'Project Manager':
  return await getProjectManagerAction(rootIndex, store);  // ← NOT wrapped
case 'Developer':
  return await embedHandoffStatusInWait(await getDeveloperAction(...), ...);  // ← wrapped
```

`embedHandoffStatusInWait` (defined in [workflow-next-action-batch.ts](mcp-server/src/tools/workflow-next-action-batch.ts#L44)) parses the response JSON, and if `action === "WAIT"`, calls `computeHandoffStatus()` to inject a `handoff_status` key containing `current_agent`, `next_agent`, `status`, `details`, and `auto_handoff`. Non-WAIT responses pass through unchanged.

`getProjectManagerAction` (defined at [line 286](mcp-server/src/tools/workflow-next-action.ts#L286)) has a Priority 4 fallback that returns `{ action: "WAIT", reason: "No actionable items found." }` at [line 450](mcp-server/src/tools/workflow-next-action.ts#L450). This is the exact scenario from the workflow report — the PM gets a bare `WAIT` with no handoff information.

Note: `getProjectManagerAction` internally loads its own `wpDetails` (line 291), redundantly with the outer scope (line 75). The outer `wpDetails` and `store`/`rootIndex` are already available for the opts passthrough.

## Approach / Architecture

1. Wrap the `'Project Manager'` switch case in `embedHandoffStatusInWait`, matching the pattern of all other roles.
2. Add a test that verifies the PM WAIT response includes `handoff_status`.
3. Optionally refactor `getProjectManagerAction` to accept pre-loaded `wpDetails` (same pattern as `getDeveloperAction`, `getQaAction`, etc.) to eliminate the redundant disk read — but this is a separate micro-optimization and not mandatory for the bug fix.

## Rationale

- The original WP-004 plan explicitly stated: *"In each `getXxxAction()` function at the final `WAIT` return"* — PM was unintentionally omitted during implementation.
- The fix is a single-line change in the switch statement, matching the established pattern.
- A test is needed since the existing `handoff_status` test suite only covers Developer WAIT responses (see [workflow-next-action.test.ts](mcp-server/tests/tools/workflow-next-action.test.ts#L1373)).

## Detailed Steps

1. **Fix the switch case** — In [mcp-server/src/tools/workflow-next-action.ts](mcp-server/src/tools/workflow-next-action.ts#L217), wrap the PM case:
   ```typescript
   case 'Project Manager':
     return await embedHandoffStatusInWait(
       await getProjectManagerAction(rootIndex, store),
       projectPath,
       args.agent_role,
       { store, rootIndex, wpDetails }
     );
   ```

2. **Add PM WAIT handoff test** — In [mcp-server/tests/tools/workflow-next-action.test.ts](mcp-server/tests/tools/workflow-next-action.test.ts#L1373), add a test to the existing `handoff_status embedded in WAIT responses` describe block:
   - Set up a project with one READY WP (assigned to no one).
   - Call `getNextAction` with `agent_role: 'Project Manager'` in a state that triggers the WAIT fallback (e.g., no blockers, no stale pipelines, no rework limits — but all WPs are IN_PROGRESS with an active pipeline mid-flight).
   - Assert `result.handoff_status` is defined.

3. **Optional: Accept pre-loaded wpDetails in getProjectManagerAction** — Align its signature with `getDeveloperAction(rootIndex, store, preloadedWpDetails?)` to avoid the redundant `Promise.all` fetch at line 291. This is a minor I/O optimisation.

4. **Verify** — Run `npm test` in `mcp-server/` to confirm all tests pass.

## Dependencies

- None — this is a self-contained bug fix.

## Required Components

- [mcp-server/src/tools/workflow-next-action.ts](mcp-server/src/tools/workflow-next-action.ts) — switch case fix (line 217)
- [mcp-server/tests/tools/workflow-next-action.test.ts](mcp-server/tests/tools/workflow-next-action.test.ts) — new test case

## Assumptions

- The PM's non-WAIT actions (`UNBLOCK_WP`, `REVIEW_REWORK_LIMIT`, `REVIEW_STALE`, `REVIEW_ABANDONED`, `REPAIR_ORPHAN_BLOCKED`, `SIGNAL_SYNTHESIS`, `CREATE_WORK_PACKAGES`) should NOT receive `handoff_status` — consistent with all other roles where `embedHandoffStatusInWait` only injects on `action: "WAIT"`.
- The early-return PM paths (zero WPs → `CREATE_WORK_PACKAGES`, all complete → `SIGNAL_SYNTHESIS`) are already correctly handled (no embedding needed since they're not WAIT).

## Constraints

- Must not change the behaviour of `ledger_get_handoff_status` as a standalone tool.
- Must pass all existing 982+ tests.

## Out of Scope

- Removing `ledger_get_handoff_status` from the PM persona tool table (PM legitimately uses it for explicit handoff queries).
- Refactoring `getProjectManagerAction` to accept `wpDetails` parameter (desirable but separate micro-debt item).

## Acceptance Criteria

- `ledger_get_next_action` with `agent_role: "Project Manager"` returns `handoff_status` in WAIT responses.
- `handoff_status` includes `auto_handoff` when the agent registry is loaded.
- Non-WAIT PM responses (e.g. `UNBLOCK_WP`) do not include `handoff_status`.
- All existing tests pass; at least 1 new test covers the PM WAIT embedding.

## Testing Strategy

- Add a unit test in the existing `handoff_status embedded in WAIT responses` describe block that targets the Project Manager role.
- Verify the test independently fails before the fix (to confirm test validity) and passes after.
- Run the full test suite (`npm test`) to confirm no regressions.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Test setup complexity** — PM WAIT requires a specific state where no PM-priority actions fire | Use a project with a single IN_PROGRESS WP that has a fresh (non-stale) active pipeline — this bypasses all PM priority checks and falls through to WAIT |
| **Redundant wpDetails load** — `getProjectManagerAction` re-reads all WPs that were already loaded | Acceptable for now; flagged as micro-debt. The `opts` passthrough to `embedHandoffStatusInWait` itself is efficient (reuses the outer `store`/`rootIndex`/`wpDetails`). |
