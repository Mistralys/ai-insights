# Plan

## Summary

Fix the `ledger_begin_work` tool's overly strict `assigned_to` guard on IN_PROGRESS work packages, which blocks legitimate pipeline handoffs (e.g., Documentation starting a documentation pipeline on a WP still assigned to the Reviewer). Also address two low-priority micro-debt items from the synthesis: redundant disk reads in `getProjectManagerAction` and the Synthesis inline object literal.

## Architectural Context

The workflow specification (§9.1) states: _"When a pipeline starts, the WP's `assigned_to` field is automatically updated to the owner agent."_ This means that the `assigned_to` field is a **trailing indicator** of who last started a pipeline, not a security guard for who may start the next one. Pipeline authorization is solely governed by `PIPELINE_AGENT_MAP` (§16.5).

**Current implementations:**

- **`ledger_start_pipeline`** ([mcp-server/src/tools/pipeline.ts](mcp-server/src/tools/pipeline.ts#L100-L230)): Has **no** `assigned_to` guard. Validates `agent_role` against `PIPELINE_AGENT_MAP`, then auto-updates `assigned_to` on success. This is spec-compliant.
- **`ledger_begin_work`** ([mcp-server/src/tools/begin-work.ts](mcp-server/src/tools/begin-work.ts#L120-L127)): On the IN_PROGRESS path, enforces `wp.assigned_to === args.agent_role`. Rejects any agent whose role doesn't match the current assignment. This is **stricter than the spec** and inconsistent with `start_pipeline`.

The pipeline-start phase of `begin_work` (lines 140+) already validates `agent_role` against `PIPELINE_AGENT_MAP` _and_ auto-updates `assigned_to`. The claim-phase guard on IN_PROGRESS is therefore redundant and harmful — it prevents the legitimate handoff that the pipeline-start phase would correctly authorize and execute.

**Additional micro-debt:**

- **`getProjectManagerAction`** ([mcp-server/src/tools/workflow-next-action.ts](mcp-server/src/tools/workflow-next-action.ts#L291-L300)): Loads `wpDetails` via its own `Promise.all`, even though the caller already has pre-loaded `wpDetails` available (line 75). All other action functions (`getDeveloperAction`, `getQaAction`, `getReviewerAction`, `getDocumentationAction`) accept `wpDetails` as a parameter.
- **Synthesis switch case** ([mcp-server/src/tools/workflow-next-action.ts](mcp-server/src/tools/workflow-next-action.ts#L231-L250)): Uses an inline object literal instead of a named `getSynthesisAction()` helper, unlike every other agent role.

## Approach / Architecture

### Fix 1: Relax the `begin_work` IN_PROGRESS guard (Medium priority)

Replace the strict `assigned_to === agent_role` check with a `PIPELINE_AGENT_MAP`-based check: if the requesting agent's `agent_role` matches `PIPELINE_AGENT_MAP[args.type]`, allow them to proceed. This mirrors the existing pipeline-start-phase guard and is consistent with `ledger_start_pipeline`.

**Before:**
```typescript
} else if (wp.status === 'IN_PROGRESS') {
  if (wp.assigned_to !== args.agent_role) {
    throw new Error(`Cannot begin work on ...: it is IN_PROGRESS and assigned to ...`);
  }
  claimed = false;
}
```

**After:**
```typescript
} else if (wp.status === 'IN_PROGRESS') {
  // Allow if the agent is the current assignee OR the legitimate pipeline owner
  // for the requested type. The pipeline-start phase (below) re-validates via
  // PIPELINE_AGENT_MAP and auto-updates assigned_to, so this is safe.
  const isPipelineOwner = PIPELINE_AGENT_MAP[args.type as PipelineType] === args.agent_role;
  if (wp.assigned_to !== args.agent_role && !isPipelineOwner) {
    throw new Error(`Cannot begin work on ...: it is IN_PROGRESS and assigned to ...`);
  }
  claimed = false;
}
```

### Fix 2: Eliminate redundant I/O in `getProjectManagerAction` (Low priority)

Add an optional `wpDetails` parameter to `getProjectManagerAction`, matching the signature pattern of all other action functions. Pass the pre-loaded `wpDetails` from the caller.

### Fix 3: Extract `getSynthesisAction()` helper (Low priority)

Move the Synthesis case's inline object literal into a named `getSynthesisAction()` function for uniformity with all other agent-role cases.

## Rationale

- **Fix 1** resolves a spec violation. The spec (§9.1, §16.5) never authorizes `assigned_to` as a pipeline-start guard — it's a bookkeeping field updated as a side effect. The current guard blocks every cross-agent handoff where `begin_work` is used instead of the two-step `claim + start_pipeline`. Since the personas recommend `begin_work` as the primary tool, this affects every project.
- **Fix 2** removes N redundant file reads per PM next-action call. Low-risk because `getProjectManagerAction` already receives `store` and `rootIndex` — adding `wpDetails` follows the established pattern.
- **Fix 3** is a code-style consistency improvement with zero behavioral change.

## Detailed Steps

1. **Relax the IN_PROGRESS guard in `begin_work.ts`** — Replace the strict `assigned_to` check with a compound check that also accepts `PIPELINE_AGENT_MAP[args.type]` matches. Keep the PM override (`isPmOverride`) path unchanged.

2. **Update/add tests for the relaxed guard in `begin-work.test.ts`:**
   - **New test:** Documentation agent can `begin_work` on a WP that is IN_PROGRESS and assigned to Reviewer, with `type: "documentation"`.
   - **New test:** QA agent can `begin_work` on a WP that is IN_PROGRESS and assigned to Developer, with `type: "qa"`.
   - **Existing test update:** The test "rejects when IN_PROGRESS WP is assigned to a different agent" (line 376) should be narrowed: it should still reject when the agent_role also doesn't match the pipeline type owner (i.e., a Developer trying to start a `qa` pipeline on a QA-assigned WP should still fail).

3. **Pass `wpDetails` to `getProjectManagerAction`:**
   - Add an optional `wpDetails?: WorkPackageDetail[]` parameter to `getProjectManagerAction`.
   - When provided, skip the internal `Promise.all` fetch.
   - Update the call site in the `switch` statement to pass the pre-loaded `wpDetails`.

4. **Extract `getSynthesisAction()` helper:**
   - Create a `getSynthesisAction()` function returning the existing inline object.
   - Replace the inline literal in the switch case with a call to `getSynthesisAction()`.

5. **Run tests** to validate all changes pass (`npm test` in `mcp-server/`).

6. **Update the `api-surface.md` manifest:**
   - Document that `ledger_begin_work` now accepts pipeline-owner agents on IN_PROGRESS WPs (not just the currently assigned agent).
   - Add `getSynthesisAction` to the internal functions list if documented there.

## Dependencies

- None. All changes are internal to `mcp-server/`.

## Required Components

- [mcp-server/src/tools/begin-work.ts](mcp-server/src/tools/begin-work.ts) — Relax IN_PROGRESS guard (Fix 1)
- [mcp-server/tests/tools/begin-work.test.ts](mcp-server/tests/tools/begin-work.test.ts) — Add/update tests (Fix 1)
- [mcp-server/src/tools/workflow-next-action.ts](mcp-server/src/tools/workflow-next-action.ts) — Pass `wpDetails` to PM action (Fix 2), extract Synthesis helper (Fix 3)
- [mcp-server/tests/tools/workflow-next-action.test.ts](mcp-server/tests/tools/workflow-next-action.test.ts) — Any impacted tests (Fixes 2, 3)
- [mcp-server/docs/agents/project-manifest/api-surface.md](mcp-server/docs/agents/project-manifest/api-surface.md) — Manifest update

## Assumptions

- The workflow specification (v1.1.0, 2026-02-26) is the canonical source of truth for `begin_work` behavior.
- `ledger_start_pipeline`'s behavior (no `assigned_to` guard, auto-update on start) is the correct reference implementation for the pipeline-start phase of `begin_work`.
- No external consumers rely on the current strict `assigned_to` rejection behavior in `begin_work`'s IN_PROGRESS path.

## Constraints

- The PM override path (`args.agent_role === 'Project Manager'`) must remain unchanged — PM can always start any pipeline type.
- The READY-path claim guard (assignment check on READY WPs) must remain unchanged — agents should only claim WPs assigned to them.
- The CLAIMABLE_ROLES guard must remain unchanged.
- All existing passing tests must continue to pass (983 tests).

## Out of Scope

- Changing `ledger_start_pipeline` behavior (it's already correct).
- Changing `ledger_claim_work_package` behavior.
- Modifying persona tool sets (the Documentation persona already has `ledger_begin_work`).
- Any changes to the workflow specification itself.

## Acceptance Criteria

- [ ] Documentation agent can call `ledger_begin_work` on an IN_PROGRESS WP assigned to "Reviewer" with `type: "documentation"` and succeed.
- [ ] QA agent can call `ledger_begin_work` on an IN_PROGRESS WP assigned to "Developer" with `type: "qa"` and succeed.
- [ ] Reviewer agent can call `ledger_begin_work` on an IN_PROGRESS WP assigned to "QA" with `type: "code-review"` and succeed.
- [ ] An agent whose role is neither the current assignee nor the pipeline type owner is still rejected (e.g., QA trying to start `implementation` on a Reviewer-assigned WP).
- [ ] `getProjectManagerAction` no longer makes redundant disk reads when `wpDetails` is pre-loaded.
- [ ] Synthesis switch case delegates to a named `getSynthesisAction()` function.
- [ ] All 983+ tests pass.
- [ ] `api-surface.md` reflects the updated `begin_work` behavior.

## Testing Strategy

- **Unit tests** for `begin_work`:
  - New: cross-agent handoff scenarios (Documentation→Reviewer-assigned, QA→Developer-assigned, Reviewer→QA-assigned).
  - Updated: existing "rejects when IN_PROGRESS WP is assigned to a different agent" test to verify rejection still fires when agent_role ≠ pipeline type owner AND ≠ assigned_to.
- **Unit tests** for `getProjectManagerAction`: verify existing tests still pass after signature change.
- **Regression**: full `npm test` run to confirm no breakage across all 983 tests.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Relaxing the guard too much** — allowing unauthorized agents to start pipelines they don't own. | The pipeline-start phase already enforces `PIPELINE_AGENT_MAP`. The new guard only allows agents who would pass that downstream check anyway. |
| **Breaking existing tests** — the test at line 376 relies on the strict guard. | Update the test to use a scenario where the agent_role is neither the assignee nor the pipeline owner, preserving the rejection behavior for truly unauthorized agents. |
| **`getProjectManagerAction` callers in tests** — tests may call the function directly without `wpDetails`. | The parameter is optional with a fallback to the existing `Promise.all` fetch, so existing callers continue to work. |
