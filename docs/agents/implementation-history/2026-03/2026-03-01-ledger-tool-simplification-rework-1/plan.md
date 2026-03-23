# Plan

## Summary

Address the strategic recommendations ("Gold Nuggets") from the 2026-03-01 Ledger Tool Simplification synthesis. The work covers one architectural bug fix (missing `propagateDependencyUnblock` call in the auto-finalize path), several micro-debt cleanups (stub deletion, legacy function removal, JSDoc convention note), a persona build system regression guard, a schema-level refinement, and low-priority test and optimization improvements. All workflow-touching changes are cross-referenced against the workflow specification (§6.3, §12.2) to ensure canon compliance.

## Architectural Context

### Workflow Specification (§6.3 — Side Effects of Status Transitions)

The canonical workflow spec mandates:
- **Any → `COMPLETE`** → Decrement `pending_work_packages`; trigger `propagateDependencyUnblock`
- **Any → `CANCELLED`** → Decrement `pending_work_packages`; trigger `propagateDependencyUnblock`

This rule applies regardless of the code path that performs the COMPLETE transition. Currently, `updateWorkPackageStatus` in [mcp-server/src/tools/work-package.ts](mcp-server/src/tools/work-package.ts) correctly calls `propagateDependencyUnblock` after terminal transitions (line ~855). However, the **auto-finalize** path in `completePipeline` ([mcp-server/src/tools/pipeline.ts](mcp-server/src/tools/pipeline.ts), lines 389–415) transitions a WP to `COMPLETE` without calling `propagateDependencyUnblock` — violating §6.3.

### Key Modules

| Module | Path | Relevance |
|--------|------|-----------|
| `work-package.ts` | [mcp-server/src/tools/work-package.ts](mcp-server/src/tools/work-package.ts) | Contains `propagateDependencyUnblock` (currently unexported, line ~899) |
| `pipeline.ts` | [mcp-server/src/tools/pipeline.ts](mcp-server/src/tools/pipeline.ts) | Auto-finalize logic (lines 389–415) missing the unblock call |
| `begin-work.ts` | [mcp-server/src/tools/begin-work.ts](mcp-server/src/tools/begin-work.ts) | **No COMPLETE transition path** — synthesis item #1 incorrectly attributed a gap here; this file only handles READY→IN_PROGRESS and idempotent re-entry |
| `workflow-batch-actions.ts` | [mcp-server/src/tools/workflow-batch-actions.ts](mcp-server/src/tools/workflow-batch-actions.ts) | 13-line re-export stub to be deleted |
| `workflow-batch-actions.test.ts` | [mcp-server/tests/tools/workflow-batch-actions.test.ts](mcp-server/tests/tools/workflow-batch-actions.test.ts) | Imports from stub; redirect import to source |
| `path-validator.ts` | [mcp-server/src/utils/path-validator.ts](mcp-server/src/utils/path-validator.ts) | Contains both `resolveProjectPath` and legacy `validatePlanPathOrError` |
| `project-lifecycle.ts` | [mcp-server/src/tools/project-lifecycle.ts](mcp-server/src/tools/project-lifecycle.ts) | Sole consumer of `validatePlanPathOrError` (line ~389) |
| `workflow-next-action.ts` | [mcp-server/src/tools/workflow-next-action.ts](mcp-server/src/tools/workflow-next-action.ts) | 1,525 lines; batch logic extraction candidate |
| `workflow-handoff.ts` | [mcp-server/src/tools/workflow-handoff.ts](mcp-server/src/tools/workflow-handoff.ts) | `computeHandoffStatus` creates new `LedgerStore` per WAIT response |
| `constraints.md` | [mcp-server/docs/agents/project-manifest/constraints.md](mcp-server/docs/agents/project-manifest/constraints.md) | Needs new JSDoc convention note (captured-closure pattern) |
| `build-personas.js` | [scripts/build-personas.js](scripts/build-personas.js) | `note_only` filter untested |

### Synthesis Correction

The synthesis states both `begin-work.ts` and `pipeline.ts` have a `propagateDependencyUnblock` gap. Code inspection confirms that **only `pipeline.ts`** has the gap — `begin-work.ts` has no COMPLETE transition path at all. The plan scopes the fix accordingly.

## Approach / Architecture

Group the 10 synthesis recommendations into 4 work packages by priority and coupling:

| WP | Scope | Synthesis Items | Priority |
|----|-------|----------------|----------|
| WP-001 | `propagateDependencyUnblock` in auto-finalize path | #1 (medium) | Medium — architectural bug |
| WP-002 | Micro-debt cleanup bundle | #3 (JSDoc convention), #4 (stub cleanup), #5 (legacy function removal) | Low — code hygiene |
| WP-003 | Persona build system regression test + Zod refinement | #2 (note_only test), #8 (schema mutual exclusivity) | Low — defensive hardening |
| WP-004 | Test gap + optimization notes (document-only for deferred items) | #6 (eager loading), #7 (file split), #9 (I/O overhead), #10 (auto_handoff test gap) | Low — improvement backlog |

## Rationale

- **WP-001 is the only item with real-world impact** — projects with dependent WPs will silently fail to auto-unblock when auto-finalize fires. This is a violation of the workflow spec (§6.3: "Any → COMPLETE triggers `propagateDependencyUnblock`"). It must be fixed first.
- **WP-002 bundles three low-effort cleanups** that have no functional dependencies on each other but share the same "code hygiene" theme. None alter behavior.
- **WP-003 groups defensive improvements** — automated regression for the persona build system and a schema-level polish.
- **WP-004 documents deferred items** (#6, #7, #9) as future optimization candidates and addresses the one actionable test gap (#10). Items #6, #7, and #9 are explicitly out of scope for implementation — they are documented for future scheduling.

## Detailed Steps

### WP-001 — Fix `propagateDependencyUnblock` in Auto-Finalize Path

1. **Export `propagateDependencyUnblock` from `work-package.ts`.**
   - Promote the function from file-private (currently only in `_internal`) to a proper named export.
   - Keep it in `_internal` as well for backward test compatibility.
   - Signature: `async function propagateDependencyUnblock(projectPath: string, completedWpId: string, ledgerRoot?: string): Promise<void>`

2. **Call `propagateDependencyUnblock` in `pipeline.ts` after auto-finalize.**
   - In the `completePipeline` function, after the auto-finalize block sets `wp.status = 'COMPLETE'` and the lock scope completes, call `propagateDependencyUnblock(projectPath, wpId, ledgerRoot)`.
   - This mirrors the pattern in `updateWorkPackageStatus` (line ~855 of `work-package.ts`): the call happens **after** the main lock is released, consistent with the workflow spec note that `propagateDependencyUnblock` acquires its own separate lock (§12.2, Gotcha 8).
   - Use the captured `autoFinalized` boolean (already in an outer-scope `let`) to gate the call: only invoke when `autoFinalized === true`.

3. **Write tests for the new path.**
   - Add tests to [mcp-server/tests/tools/pipeline.test.ts](mcp-server/tests/tools/pipeline.test.ts) (or a dedicated test file if pipeline.test.ts doesn't exist) covering:
     - Auto-finalize on a WP with a BLOCKED dependent → dependent transitions to READY.
     - Auto-finalize on a WP with no dependents → no error, no side effects.
     - Auto-finalize on a WP with a dependent blocked by a non-dependency reason → dependent stays BLOCKED.

4. **Update manifest documentation.**
   - Update `api-surface.md`: add note to `ledger_complete_pipeline` that auto-finalize triggers `propagateDependencyUnblock`.
   - Update `data-flows.md` Flow 5: add the `propagateDependencyUnblock` call after the auto-finalize block.
   - Update `constraints.md` §13b: add the dependency unblock side-effect.

### WP-002 — Micro-Debt Cleanup Bundle

**Step 2a — JSDoc captured-closure convention note (synthesis #3):**

5. **Add a convention note to `constraints.md`.**
   - Add a new constraint (numbered sequentially after the last existing constraint) documenting the captured-closure pattern used in `updateWorkPackageWithSync` callbacks.
   - Reference: existing Gotcha 12 already describes the pattern; the new constraint formalizes it as a JSDoc convention for future contributors. The constraint should state: "When using the captured-closure pattern (outer-scope `let` written inside a lock callback and read after), add a brief `// captured via closure in lock callback` inline comment on the `let` declaration."

**Step 2b — Delete `workflow-batch-actions.ts` stub (synthesis #4):**

6. **Update test import.**
   - In [mcp-server/tests/tools/workflow-batch-actions.test.ts](mcp-server/tests/tools/workflow-batch-actions.test.ts) (line ~21), change the import from `../../src/tools/workflow-batch-actions.js` to `../../src/tools/workflow-next-action.js`.

7. **Delete the stub file.**
   - Remove [mcp-server/src/tools/workflow-batch-actions.ts](mcp-server/src/tools/workflow-batch-actions.ts).

8. **Verify no other imports reference the stub.**
   - Grep `workflow-batch-actions` across the codebase to confirm no other files import from it.

9. **Update `file-tree.md`.**
   - Remove the `workflow-batch-actions.ts` entry.

**Step 2c — Remove `validatePlanPathOrError` legacy function (synthesis #5):**

10. **Migrate `initializeProject` in `project-lifecycle.ts` to use `resolveProjectPath`.**
    - `initializeProject` is unique: it receives a mandatory `project_path` parameter (not optional) and never accepts `cwd_path`. The migration replaces `validatePlanPathOrError(projectPath)` with a direct call to `validateAbsolutePath(projectPath)` (the path-is-absolute check from `path-validator.ts`, if it exists separately) or simply inlines the validation that `validatePlanPathOrError` performs (check that the path is absolute; check the plan file constraint).
    - **Note:** `initializeProject` cannot use `resolveProjectPath()` directly because it requires `project_path` to be mandatory (not fallback-based). The migration should instead inline or extract just the absolute-path validation, removing the need for the wrapper function.

11. **Delete `validatePlanPathOrError` from `path-validator.ts`.**
    - Remove the function (lines ~58–72) and its jsdoc.
    - Verify no other files import it (currently only `project-lifecycle.ts`).

12. **Update `api-surface.md`.**
    - Remove `validatePlanPathOrError` from the utility functions section.

### WP-003 — Defensive Hardening

**Step 3a — Persona build system regression test (synthesis #2):**

13. **Add a `--check` mode assertion for `note_only` filtering.**
    - In [scripts/build-personas.js](scripts/build-personas.js), extend the `--check` mode to verify that tools with `note_only: true` do **not** appear in the generated tool tables. This makes the existing `--check` flag a regression guard for this filter.
    - Alternatively, create a lightweight test script (e.g., `scripts/test-build-personas.js`) that builds output to a temp directory and asserts expected tool table contents.

14. **Document the regression check in `personas/docs/agents/project-manifest/constraints.md`.**

**Step 3b — Zod schema `.refine()` for `project_path` / `cwd_path` mutual exclusivity (synthesis #8):**

15. **Add a `.refine()` guard to all tool schemas that accept both `project_path` and `cwd_path`.**
    - The refinement should reject calls that provide **both** parameters simultaneously, since the priority behavior (`project_path` wins) is unintuitive and may mask agent errors.
    - The refinement should be a reusable helper (e.g., `projectPathRefine`) defined once in the schema module and applied to each relevant schema.
    - Accept: neither (error from `resolveProjectPath`), `project_path` only, `cwd_path` only. Reject: both present.

16. **Update `api-surface.md` tool signatures and `constraints.md`.**
    - Document the mutual-exclusivity rule.

### WP-004 — Test Gap + Deferred Optimization Documentation

**Step 4a — `auto_handoff` WAIT embedding test (synthesis #10):**

17. **Add a test with a mock agent registry.**
    - In [mcp-server/tests/tools/workflow-next-action.test.ts](mcp-server/tests/tools/workflow-next-action.test.ts), add a test that:
      - Creates a temp directory with a mock `.agent.md` file to populate the agent registry.
      - Calls `discoverAgents()` to load the registry.
      - Triggers a WAIT response via `ledger_get_next_action`.
      - Asserts that `result.handoff_status.auto_handoff` is present and contains `agent_handle` and `next_agent`.
    - Use `resetRegistry()` in `afterEach` per constraint 28.

**Steps 4b–4d — Document deferred items (synthesis #6, #7, #9):**

18. **No code changes.** Document the following as future optimization candidates in the plan's "Out of Scope" section:
    - #6: `getNextActionsCollector` eager loading — optimize with early-exit sequential fetch.
    - #7: `workflow-next-action.ts` file size — split batch logic into `workflow-next-action-batch.ts` when next batch work occurs.
    - #9: `computeHandoffStatus` I/O overhead — thread pre-loaded WP details through `embedHandoffStatusInWait`.

## Dependencies

- WP-001 has no blockers — it can start immediately.
- WP-002 is independent of WP-001.
- WP-003 is independent of WP-001 and WP-002.
- WP-004 step 4a (test) is independent; steps 4b–4d are documentation-only.
- All WPs can be developed in parallel, but WP-001 should be prioritized due to its architectural impact.

## Required Components

### Modified Files
- [mcp-server/src/tools/work-package.ts](mcp-server/src/tools/work-package.ts) — export `propagateDependencyUnblock`
- [mcp-server/src/tools/pipeline.ts](mcp-server/src/tools/pipeline.ts) — call `propagateDependencyUnblock` after auto-finalize
- [mcp-server/src/tools/project-lifecycle.ts](mcp-server/src/tools/project-lifecycle.ts) — migrate away from `validatePlanPathOrError`
- [mcp-server/src/utils/path-validator.ts](mcp-server/src/utils/path-validator.ts) — remove `validatePlanPathOrError`
- [mcp-server/tests/tools/workflow-batch-actions.test.ts](mcp-server/tests/tools/workflow-batch-actions.test.ts) — redirect import
- [mcp-server/tests/tools/workflow-next-action.test.ts](mcp-server/tests/tools/workflow-next-action.test.ts) — add `auto_handoff` test
- [mcp-server/docs/agents/project-manifest/api-surface.md](mcp-server/docs/agents/project-manifest/api-surface.md) — update tool docs
- [mcp-server/docs/agents/project-manifest/data-flows.md](mcp-server/docs/agents/project-manifest/data-flows.md) — update Flow 5
- [mcp-server/docs/agents/project-manifest/constraints.md](mcp-server/docs/agents/project-manifest/constraints.md) — new JSDoc convention, §13b update, mutual-exclusivity rule
- [mcp-server/docs/agents/project-manifest/file-tree.md](mcp-server/docs/agents/project-manifest/file-tree.md) — remove stub entry
- [scripts/build-personas.js](scripts/build-personas.js) — extend `--check` for `note_only` regression
- Schema files in `mcp-server/src/schema/` — add `.refine()` guard (or in each tool file where schemas are defined)

### Deleted Files
- [mcp-server/src/tools/workflow-batch-actions.ts](mcp-server/src/tools/workflow-batch-actions.ts) — 13-line stub

### New Files
- New test cases in existing test files (no new test files needed unless `pipeline.test.ts` scope warrants a dedicated auto-finalize test file)

## Assumptions

- The workflow specification at [docs/agents/implementation-history/2026-02-26-workflow-spec-audit-fixes/workflow-specification.md](docs/agents/implementation-history/2026-02-26-workflow-spec-audit-fixes/workflow-specification.md) is the latest canon.
- `begin-work.ts` has no COMPLETE transition path (confirmed by code inspection), despite the synthesis suggesting otherwise. The fix is scoped to `pipeline.ts` only.
- The `propagateDependencyUnblock` function already works correctly and only needs to be exported and called from the new callsite — no logic changes to the function itself.
- Step 2c (legacy cleanup) assumes `initializeProject` can validate the absolute path directly without the wrapper function. If `validatePlanPathOrError` does additional validation beyond absolute-path checking, the migration must replicate that logic.

## Constraints

- **Workflow spec compliance (§6.3):** Any code path that transitions a WP to `COMPLETE` must trigger `propagateDependencyUnblock`. This is the canonical rule.
- **Lock ordering (§12.2, Gotcha 8):** `propagateDependencyUnblock` must run **after** the main lock is released, acquiring its own separate lock. Do not call it inside the `completePipeline` lock scope.
- **`_internal` export convention (constraint 53):** When promoting `propagateDependencyUnblock` to a named export, keep it in `_internal` too for test backward compatibility.
- **Mutual-exclusivity refinement (step 3b):** The `.refine()` must reject the `both present` case, not silently ignore `cwd_path`. This is a behavioral change — agents sending both will start receiving errors. Ensure persona instructions don't encourage sending both.

## Out of Scope

- **Synthesis #6 — `getNextActionsCollector` eager loading.** Acceptable performance today; document for future optimization when large ledgers are observed.
- **Synthesis #7 — `workflow-next-action.ts` file split.** Defer until the next feature addition to batch logic.
- **Synthesis #9 — `computeHandoffStatus` I/O overhead.** The WAIT path is the terminal end-of-work path; extra reads are acceptable. Defer to a future refactor that threads pre-loaded WP data.
- `begin-work.ts` changes — the synthesis incorrectly identified a gap here; no changes needed.

## Deferred Items (Carry Forward to Synthesis)

> **Instruction to Synthesis agent:** The items below were deliberately deferred from this rework project. They must be included as strategic recommendations in the synthesis document so they remain visible for future scheduling.

| # | Original Synthesis # | Item | Rationale for Deferral | Recommended Trigger |
|---|---------------------|------|------------------------|---------------------|
| D-1 | #6 | **`getNextActionsCollector` eager loading** — The batch collector `Promise.all`s all WP detail files before the limit-check loop runs. For large ledgers this loads all WPs even when `limit=2`. An early-exit pattern (sequential fetch with `break`) would reduce I/O at scale. | Acceptable performance at current project sizes; no user-reported latency. | Schedule when a project exceeds ~50 WPs or when batch-mode is extended. |
| D-2 | #7 | **`workflow-next-action.ts` file size (~1,525 lines)** — If additional batch logic or new agent roles are added, navigation efficiency degrades. Split batch logic into `workflow-next-action-batch.ts`. | No immediate growth planned; split adds churn without current benefit. | Schedule alongside the next feature addition to batch logic or new agent role. |
| D-3 | #9 | **`computeHandoffStatus` I/O overhead** — Creates a new `LedgerStore` instance on each WAIT return (extra root-index + WP reads via `getHandoffStatus()`). A future refactor could thread pre-loaded WP details through `embedHandoffStatusInWait()` to eliminate the round-trip. | WAIT is the terminal end-of-work path; extra I/O is not user-facing. | Schedule during a broader handoff refactor or if WAIT latency becomes measurable. |

## Acceptance Criteria

- [ ] Auto-finalize COMPLETE transition triggers `propagateDependencyUnblock` and downstream BLOCKED dependents are unblocked (test covers WP with dependency).
- [ ] Auto-finalize on WP with non-dependency-blocked dependent leaves that dependent BLOCKED (test covers guard).
- [ ] `propagateDependencyUnblock` is a named export from `work-package.ts`.
- [ ] `workflow-batch-actions.ts` stub is deleted; test file imports directly from `workflow-next-action.ts`.
- [ ] `validatePlanPathOrError` is removed from `path-validator.ts`; `initializeProject` works without it.
- [ ] `constraints.md` has a new convention note for the captured-closure pattern.
- [ ] Persona build system `--check` mode detects `note_only` filter regressions.
- [ ] Tool schemas reject calls with both `project_path` and `cwd_path` provided.
- [ ] `auto_handoff` WAIT embedding test exercises the populated `auto_handoff` sub-key via mock registry.
- [ ] All existing tests pass (959/959 baseline + new tests).
- [ ] Manifest documents (`api-surface.md`, `data-flows.md`, `constraints.md`, `file-tree.md`) are updated for all changes.

## Testing Strategy

| WP | Test Approach |
|----|---------------|
| WP-001 | Integration tests in `pipeline.test.ts`: auto-finalize with dependent WPs, dependency-blocked guard, non-dependency-blocked guard. Real `LedgerStore` with temp directory (constraint 29). |
| WP-002 | Verify deleted stub doesn't break imports (`npm run build` + `npm test`). Verify `initializeProject` still passes all existing tests after migration. |
| WP-003 | Run `node scripts/build-personas.js --check` after introducing a deliberate `note_only` regression to confirm detection. Schema refinement tested via existing schema validation tests + new edge case for both-present rejection. |
| WP-004 | New test in `workflow-next-action.test.ts` with mock agent registry to exercise `auto_handoff` sub-key. |

Full test suite run after each WP: `npm test` (target: 959+ tests passing).

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **`propagateDependencyUnblock` has subtle lock-ordering dependency** | Follow the exact pattern from `updateWorkPackageStatus`: call after main lock release, not inside the lock callback. Code review must verify lock ordering. |
| **Mutual-exclusivity `.refine()` breaks existing agent calls that send both** | Review persona instructions to confirm they never encourage sending both. The `resolveProjectPath` priority rule (`project_path` wins) was undocumented in personas — the refinement makes the contract explicit. |
| **Deleting `workflow-batch-actions.ts` breaks an import chain we didn't find** | Grep-verify before deletion. Run full build + test suite. |
| **`validatePlanPathOrError` does more than absolute-path checking** | Read the function body (lines 58–72 of `path-validator.ts`) before migrating. If additional logic exists beyond the absolute check, replicate it in `initializeProject`. |
| **`note_only` regression check in `--check` mode adds build-time overhead** | The check is O(n) over tool lists — negligible. The persona build runs in <1s today. |
