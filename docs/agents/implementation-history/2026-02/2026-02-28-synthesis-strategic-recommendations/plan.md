# Plan

## Summary

This plan consolidates and triages **22 open strategic recommendations** surfaced by the synthesis documents of all six phases (plus the Phase 3→4 tech-debt interlude) of the Ledger Specification Alignment project. Every item was verified against the current codebase — 22 are confirmed OPEN, 1 was already RESOLVED (file-tree.md indentation).

The work is organized into **four themes** of decreasing priority, each designed as an independent work unit the TPM can decompose into work packages:

1. **Theme A — Architectural Drift Prevention** (Medium priority, 6 items): Eliminate hardcoded arrays and string literals that will silently diverge from their source-of-truth constants when the codebase evolves.
2. **Theme B — Test Infrastructure Modernization** (Medium priority, 7 items): Remove stale test replicas, migrate local factories to shared fixtures, create a shared test-utils module, and fix misleading test metadata.
3. **Theme C — Code Quality & DRY Consolidation** (Low priority, 6 items): Extract shared helpers, consolidate duplicate logic, and clean up naming conventions.
4. **Theme D — Documentation & Convention Codification** (Low priority, 3 items): Document established patterns in `constraints.md` so future agents don't re-introduce solved problems.

No new features are introduced. All changes are confined to the `mcp-server/` sub-project. The work is a targeted hardening pass that converts implicit conventions into explicit, enforced constraints.

---

## Architectural Context

The Ledger Specification Alignment project completed six phases that brought the MCP server into full compliance with the Agent Workflow Specification v1.3.1. During each phase, the QA, Reviewer, and Documentation pipelines surfaced strategic observations ("gold nuggets") that were deferred to avoid scope creep. Those observations accumulated across:

- **Phase 1** (Schema & Type Foundations) — 5 recommendations
- **Phase 2** (Core Algorithms) — 7 recommendations (4 resolved in Phase 3)
- **Phase 3** (Tool Guards & Status Transitions) — 6 recommendations (all resolved in Phase 4/TD)
- **Phase 4/TD** (Technical Debt Resolution) — 5 recommendations
- **Phase 4** (Recommendation Engine) — 3 gold nuggets + 8 technical debt items
- **Phase 5** (Handoff Engine) — 3 recommendations + 6 technical debt items
- **Phase 6** (Self-Healing & Auxiliary) — 6 recommendations

After cross-referencing resolved items, **22 remain open**. This plan addresses all of them.

### Key Files

| File | Role in This Plan |
|------|-------------------|
| `mcp-server/src/tools/pipeline.ts` | Dual-write bridge retirement, old schema conventions |
| `mcp-server/src/tools/work-package.ts` | CLAIMABLE_ROLES error message, autoCancelActivePipelines DRY, Zod whitespace guards |
| `mcp-server/src/tools/workflow-next-action.ts` | PIPELINE_TYPES extraction, getDocumentationAction loop guard, double-parse coupling |
| `mcp-server/src/tools/workflow-batch-actions.ts` | New action type handling in default branch |
| `mcp-server/src/tools/project-lifecycle.ts` | completeSynthesis role guard, let result! pattern, validatePipelineOrdering casts |
| `mcp-server/src/utils/workflow-helpers.ts` | checkRevalidationGuard signature, hasDependencyBlocked/isBlockedByDependencies consolidation |
| `mcp-server/src/tools/observations.ts` | _schemas export convention |
| `mcp-server/tests/helpers/` | New test-utils.ts, fixture migration |
| `mcp-server/tests/tools/project-lifecycle.test.ts` | applyStatusHealing replica removal |
| `mcp-server/tests/tools/work-package.test.ts` | Dead auto_handoff_depth test block |
| `mcp-server/tests/tools/pipeline.test.ts` | Old inlined prerequisite test block |
| `mcp-server/tests/tools/workflow-rework-loop.test.ts` | Stale describe/it strings |
| `mcp-server/tests/integration/full-workflow.test.ts` | Stale MARK_COMPLETE comment, revision:1 comment |
| `mcp-server/tests/utils/workflow-helpers.test.ts` | Local factory migration |
| `mcp-server/tests/storage/ledger-store.test.ts` | Local factory migration |
| `mcp-server/docs/agents/project-manifest/constraints.md` | Convention documentation |

---

## Approach / Architecture

### Theme A — Architectural Drift Prevention

These items prevent **silent divergence** between constants, error messages, and inline arrays. Each creates a compile-time or test-time binding that breaks loudly if the source of truth changes.

| # | Item | Source | Location | Change |
|---|------|--------|----------|--------|
| A-1 | Retire dual-write `rework_count` bridge | Phase 1 §2 | `pipeline.ts` ~L176-179, ~L186 | Remove `wp.rework_count = newCount` write for implementation type. Remove `?? wp.rework_count ?? 0` fallback from `effectiveReworkCount` read. All consumers now use `rework_counts` map exclusively. |
| A-2 | Extract `PIPELINE_TYPES` constant | Phase 4/Rec GN-2 | `workflow-next-action.ts` ~L286, ~L964 | Define `PIPELINE_TYPES` in `constants.ts` (or reuse from `pipeline-maps.ts` if already typed). Replace all inline `['implementation', 'qa', 'code-review', 'documentation']` arrays. |
| A-3 | Derive CLAIMABLE_ROLES error message at runtime | Phase 4/TD §2 | `work-package.ts` ~L419-420 | Replace hardcoded `"Valid roles: Developer, QA, ..."` with template literal: `` `Valid roles: ${CLAIMABLE_ROLES.filter(r => !r.includes('Agent')).join(', ')}.` `` |
| A-4 | Bind `completeSynthesis` role guard to `AGENT_ROLES` | Phase 6 §2 | `project-lifecycle.ts` ~L525-526 | Define `SYNTHESIS_PERMITTED_ROLES` as a `const` derived from `AGENT_ROLES`, use it in the guard instead of hardcoded `'Synthesis'` / `'Project Manager'` literals. |
| A-5 | Add `hasDependencyBlocked` loop guard to `getDocumentationAction` | Phase 4/Rec GN-3 | `workflow-next-action.ts` ~L933 | Add `if (hasDependencyBlocked(wpDetail)) continue;` at WP loop top, matching `getDeveloperAction`, `getQaAction`, `getReviewerAction`. |
| A-6 | Handle new action types in `buildBatchNextSteps` | Phase 4/Rec TD | `workflow-batch-actions.ts` ~L97 | Add explicit `case` branches for `WAIT_FOR_REWORK`, `WAIT_FOR_DOWNSTREAM`, `BLOCK_FOR_REWORK_LIMIT`, `WAIT_FOR_UPSTREAM_REWORK_LIMIT`, `UNBLOCK_WP`, `REVIEW_ABANDONED`, `REPAIR_ORPHAN_BLOCKED`, `FINALIZE_WP`, `UPDATE_CRITERIA`, `CLAIM_WP` — returning structured WAIT guidance or relevant next-step arrays instead of silent `[]`. |

### Theme B — Test Infrastructure Modernization

These items remove stale test code that validates dead logic, create shared utilities to prevent duplication, and fix misleading test metadata.

| # | Item | Source | Location | Change |
|---|------|--------|----------|--------|
| B-1 | Remove `applyStatusHealing` inline test replica | Phase 6 §1 (🔴 HIGH) | `project-lifecycle.test.ts` ~L34-56 | Delete the inline replica. Migrate its test cases to call `_internal.computeHealedStatus` directly, updating assertions to match current 16-rule semantics. |
| B-2 | Remove dead `auto_handoff_depth reset algorithm` test block | Phase 5 TD | `work-package.test.ts` ~L158 | Delete the `describe('auto_handoff_depth reset algorithm ...')` block and its local `applyDepthResetOnComplete` helper. The production logic now lives in `completeSynthesis` and is tested in `project-lifecycle.test.ts`. |
| B-3 | Create shared `test-utils.ts` module | Phase 4/TD §1 | `tests/helpers/test-utils.ts` (new) | Export `injectLedgerDir(dir: string): () => void` (push `--ledger-dir` to `process.argv`, return cleanup fn) and `nowFloor(): number` (`Math.floor(Date.now()/1000)*1000`). |
| B-4 | Migrate `ledger-store.test.ts` local factory to shared fixtures | Phase 1 §5 | `tests/storage/ledger-store.test.ts` ~L26 | Replace local `makeWpDetail` with `import { makeWorkPackageDetail } from '../helpers/fixtures.js'`. |
| B-5 | Migrate `workflow-helpers.test.ts` local factories to shared fixtures | Phase 4/Rec TD | `tests/utils/workflow-helpers.test.ts` ~L8-26 | Replace local `makePipeline`/`makeWp` with imports from `tests/helpers/fixtures.ts`. Update call-site signatures where API shape differs. |
| B-6 | Fix stale `describe`/`it` strings in `workflow-rework-loop.test.ts` | Phase 4/Rec TD | `workflow-rework-loop.test.ts` ~L245, ~L282 | Change `"returns WAIT"` → `"returns WAIT_FOR_REWORK"` in all describe/it labels. |
| B-7 | Fix stale `MARK_COMPLETE` comment and add `revision:1` protection comment | Phase 4/Rec TD + Phase 1 §4 | `full-workflow.test.ts` ~L769, ~L922 | (a) Add comment at L769: `// Deliberate: seeds revision:1 to verify COMPLETE→IN_PROGRESS increment yields revision:2`. (b) Replace `MARK_COMPLETE` reference at L922 with current action name (`FINALIZE_WP` or `UPDATE_CRITERIA`). |

### Theme C — Code Quality & DRY Consolidation

These items reduce copy-paste duplication, improve type safety, and tighten naming conventions.

| # | Item | Source | Location | Change |
|---|------|--------|----------|--------|
| C-1 | Extend `autoCancelActivePipelines` to `propagateDependencyReblock` | Phase 4/TD §3 | `work-package.ts` ~L935-941 | Replace inline auto-cancel block with `autoCancelActivePipelines(wpDetail, \`Auto-cancelled: dependency ${reopenedWpId} was reopened\`)`. |
| C-2 | Consolidate `_internal` / `_schemas` test export convention | Phase 1 §3 | `pipeline.ts` ~L596, `observations.ts` ~L196 | Rename `_schemas` exports to `_internal` (merging into the existing `_internal` object where both exist in the same file). Standardize on `_internal` as the single convention. |
| C-3 | Standardize `checkRevalidationGuard` signature | Phase 2 L-3 | `workflow-helpers.ts` ~L160 | Refactor to accept `Pipeline[]` instead of `WorkPackageDetail`, matching sibling functions. Update all call sites (currently in `pipeline.ts`). |
| C-4 | Consolidate Zod whitespace guards with `.trim().min(1)` | Phase 6 §3 | `work-package.ts` (resetReworkCount, updateAcceptanceCriteria) | Move whitespace validation into Zod schema definitions using `.trim().min(1)`, removing redundant in-handler `!args.reason.trim()` checks. |
| C-5 | Clean up `validatePipelineOrdering` type assertions | Phase 6 §4 | `project-lifecycle.ts` | Replace `as (typeof pipelines)[number] \| undefined` casts with direct array access + existing null-checks. |
| C-6 | Replace `let result!` non-null assertion pattern | Phase 6 §5 | `project-lifecycle.ts` ~L519 | Change to `let result: { content: ... } \| undefined` and add post-lock null-check. Only one instance remains. |

### Theme D — Documentation & Convention Codification

| # | Item | Source | Location | Change |
|---|------|--------|----------|--------|
| D-1 | Document `_internal` export convention in `constraints.md` | Phase 1 §3 + Phase 2 L-7 | `constraints.md` | Add a numbered constraint: "Test-only exports must use the `_internal` naming convention. Do not introduce `_schemas`, `_test`, or other variants." |
| D-2 | Document `for-of` loop preference with `noUncheckedIndexedAccess` | Phase 4/TD §5 | `constraints.md` | Add convention: "Prefer `for-of` loops. When `for (let i ...)` is required, use `!` with comment explaining in-bounds guarantee." |
| D-3 | Add `modify_text` met-preservation comment | Phase 6 §6 | `work-package.ts` (updateAcceptanceCriteria) | Add inline comment: `// modify_text intentionally preserves the existing 'met' value — only the text changes, not the progress state.` |

---

## Rationale

- **Theme A first** because drift-prevention items have the highest risk/reward ratio — they prevent silent bugs when future features add roles, pipeline types, or action types.
- **Theme B second** because stale test replicas actively mask regressions (especially B-1, the highest-priority item across all synthesis reports, flagged 5 times independently).
- **Theme C is safe to defer** — these are DRY improvements with no behavioral impact. They reduce cognitive load but don't prevent bugs.
- **Theme D is lowest effort** — each item is a comment or one-paragraph addition. Can be bundled into any WP as a sub-task.

**Execution order within themes:**
- A-1 (dual-write retirement) should be first — it removes a compatibility bridge that every subsequent change must reason about.
- A-2 (PIPELINE_TYPES) before A-5 and A-6, since extracting the constant simplifies the inline-array replacements.
- B-1 before B-2 — both remove dead test code, but B-1 requires migrating tests to the new API (more complex).
- B-3 before B-4 and B-5 — create the shared module first, then migrate consumers.
- C-2 depends on D-1 being agreed — unify the convention before renaming exports.

---

## Detailed Steps

1. **A-1**: Remove dual-write bridge in `pipeline.ts`. Delete `wp.rework_count = newCount` line. Remove `?? wp.rework_count ?? 0` fallback. Run full test suite — any test relying on `rework_count` must be updated to use `rework_counts`.
2. **A-2**: Export `PIPELINE_TYPES` from `constants.ts` (or re-export from `pipeline-maps.ts`). Replace 3 inline arrays in `workflow-next-action.ts`. Add a TypeScript exhaustiveness guard to catch missing types at compile time.
3. **A-3**: Build error message string from `CLAIMABLE_ROLES` array in `claimWorkPackage`.
4. **A-4**: Define `SYNTHESIS_PERMITTED_ROLES` in `project-lifecycle.ts` or `constants.ts`. Replace hardcoded strings in `completeSynthesis` guard.
5. **A-5**: Add one-line `hasDependencyBlocked` guard to `getDocumentationAction` WP loop.
6. **A-6**: Add explicit case branches to `buildBatchNextSteps` for all 10+ new action types.
7. **B-1**: Delete inline `applyStatusHealing` replica in `project-lifecycle.test.ts`. Rewrite associated tests to call `_internal.computeHealedStatus`. Verify all tests pass.
8. **B-2**: Delete `auto_handoff_depth reset algorithm` describe block in `work-package.test.ts`.
9. **B-3**: Create `tests/helpers/test-utils.ts` with `injectLedgerDir` and `nowFloor`.
10. **B-4**: Migrate `ledger-store.test.ts` to shared `makeWorkPackageDetail`.
11. **B-5**: Migrate `workflow-helpers.test.ts` to shared fixture factories.
12. **B-6**: Fix stale describe/it strings in `workflow-rework-loop.test.ts`.
13. **B-7**: Add protective comments in `full-workflow.test.ts` — revision:1 seed and MARK_COMPLETE replacement.
14. **C-1**: Replace inline auto-cancel block in `propagateDependencyReblock` with `autoCancelActivePipelines` call.
15. **C-2**: Rename `_schemas` to `_internal` in `pipeline.ts` and `observations.ts`. Update all test imports.
16. **C-3**: Refactor `checkRevalidationGuard` to accept `Pipeline[]`.
17. **C-4**: Consolidate Zod whitespace guards.
18. **C-5**: Clean up `validatePipelineOrdering` type assertions.
19. **C-6**: Replace `let result!` with `let result: ... | undefined` + null check.
20. **D-1**: Add `_internal` convention to `constraints.md`.
21. **D-2**: Add `for-of` loop preference to `constraints.md`.
22. **D-3**: Add `modify_text` met-preservation comment to `work-package.ts`.

---

## Dependencies

- A-2 should precede A-5 and A-6 (shared constant simplifies those changes)
- B-3 should precede B-4 and B-5 (create shared module before migrating)
- C-2 should follow D-1 (codify convention before enforcing it)
- All other items are independent and can be parallelized or reordered by the TPM

---

## Required Components

### Existing Files (Modified)

- `mcp-server/src/tools/pipeline.ts` — A-1, C-2
- `mcp-server/src/tools/work-package.ts` — A-3, C-1, C-4, D-3
- `mcp-server/src/tools/workflow-next-action.ts` — A-2, A-5
- `mcp-server/src/tools/workflow-batch-actions.ts` — A-6
- `mcp-server/src/tools/project-lifecycle.ts` — A-4, C-5, C-6
- `mcp-server/src/tools/observations.ts` — C-2
- `mcp-server/src/utils/workflow-helpers.ts` — C-3
- `mcp-server/src/utils/constants.ts` — A-2 (if PIPELINE_TYPES added here)
- `mcp-server/tests/tools/project-lifecycle.test.ts` — B-1
- `mcp-server/tests/tools/work-package.test.ts` — B-2
- `mcp-server/tests/storage/ledger-store.test.ts` — B-4
- `mcp-server/tests/utils/workflow-helpers.test.ts` — B-5
- `mcp-server/tests/tools/workflow-rework-loop.test.ts` — B-6
- `mcp-server/tests/integration/full-workflow.test.ts` — B-7
- `mcp-server/docs/agents/project-manifest/constraints.md` — D-1, D-2

### New Files

- `mcp-server/tests/helpers/test-utils.ts` — B-3

---

## Assumptions

- All references to `rework_count` (legacy scalar) in test fixtures have already been migrated to `rework_counts` during Phase 1. If any remain, they will surface as test failures during A-1 and should be fixed inline.
- `PIPELINE_TYPES` already exists as a tuple in `pipeline-maps.ts`. A-2 may re-export it from `constants.ts` or import it directly — the TPM can decide the canonical location.
- The `_internal` convention is the preferred standard (it is older, more widespread, and already mentioned in `mcp-server/AGENTS.md`).
- The `let result!` pattern appears only once (in `project-lifecycle.ts`). A codebase-wide refactor is not needed.

---

## Constraints

- No behavioral changes to any MCP tool's external API (all changes are internal refactors or test-layer fixes).
- No new MCP tools or schema changes.
- All changes confined to `mcp-server/` sub-project.
- Must maintain zero TypeScript errors and zero test failures at every WP boundary.
- The `startPipeline` old "Pipeline ordering enforcement" describe block (item not in scope) should be preserved for documentation value — only the stale replicas that mask regressions are removed.

---

## Out of Scope

- **`startPipeline` old "Pipeline ordering enforcement" test block** — Phase 2 synthesis M-2 recommended retaining this block for schema documentation value. No action needed.
- **`hasDependencyBlocked` / `isBlockedByDependencies` consolidation** — Phase 5 explicitly documented the intentional duplication for call-site clarity. No action needed.
- **`getProjectManagerAction` `extractStalePipelineAction` double-parse coupling** (item 23) — Deprioritized; the current approach works and is not a drift risk. Would require a new typed helper and multiple call-site changes for minimal benefit.
- **Feature development** — This is a hardening pass only.
- **Persona or orchestrator changes** — All work is within `mcp-server/`.

---

## Acceptance Criteria

### Theme A — Drift Prevention
- [ ] `pipeline.ts` no longer writes to or reads from `rework_count` (legacy scalar field)
- [ ] No inline `['implementation', 'qa', 'code-review', 'documentation']` arrays exist in `workflow-next-action.ts` — all derived from `PIPELINE_TYPES`
- [ ] `claimWorkPackage` error message is dynamically derived from `CLAIMABLE_ROLES`
- [ ] `completeSynthesis` role guard references a `const` bound to `AGENT_ROLES`
- [ ] `getDocumentationAction` has `hasDependencyBlocked` loop guard matching sibling functions
- [ ] `buildBatchNextSteps` has explicit case branches for all action types introduced in Phase 4

### Theme B — Test Modernization
- [ ] No inline replica of `applyStatusHealing` exists in `project-lifecycle.test.ts`; migrated tests call `_internal.computeHealedStatus` and pass
- [ ] No `auto_handoff_depth reset algorithm` describe block exists in `work-package.test.ts`
- [ ] `tests/helpers/test-utils.ts` exists and exports `injectLedgerDir` and `nowFloor`
- [ ] `ledger-store.test.ts` imports `makeWorkPackageDetail` from shared fixtures
- [ ] `workflow-helpers.test.ts` imports factories from shared fixtures
- [ ] All describe/it strings in `workflow-rework-loop.test.ts` reference `WAIT_FOR_REWORK`, not `WAIT`
- [ ] `full-workflow.test.ts` has revision:1 protective comment and no MARK_COMPLETE references

### Theme C — Code Quality
- [ ] `propagateDependencyReblock` calls `autoCancelActivePipelines` instead of inline block
- [ ] No `_schemas` exports exist in the codebase — all use `_internal`
- [ ] `checkRevalidationGuard` accepts `Pipeline[]` as first argument
- [ ] No redundant in-handler whitespace checks where Zod `.trim().min(1)` covers the same validation
- [ ] `validatePipelineOrdering` has no unnecessary type assertions
- [ ] No `let result!` pattern in the codebase

### Theme D — Documentation
- [ ] `constraints.md` documents the `_internal` export convention
- [ ] `constraints.md` documents the `for-of` / `noUncheckedIndexedAccess` convention
- [ ] `modify_text` met-preservation intent is commented in `work-package.ts`

### Global
- [ ] `npx tsc --noEmit` exits with 0 errors
- [ ] Full test suite passes with 0 failures
- [ ] Number of tests does not decrease (test migrations may change count but should not reduce it)

---

## Testing Strategy

This plan is primarily a refactoring and test-layer cleanup effort. The testing strategy is:

1. **Regression baseline**: Run full test suite before any changes. Record test count (expected: 867).
2. **Per-WP verification**: After each work package, run `npx tsc --noEmit && npx vitest run` — zero errors, zero failures.
3. **B-1 migration testing**: The `applyStatusHealing` test migration (B-1) is the highest-risk item. The migrated tests must exercise all 16 rules of `computeHealedStatus` via `_internal`. Compare old assertions against spec §17.2 rules to ensure semantic correctness.
4. **A-1 legacy removal**: After removing the dual-write bridge, run the full suite. Any test that reads `rework_count` instead of `rework_counts` will fail — fix inline.
5. **A-6 batch action types**: Add at least one test per new action type case in `buildBatchNextSteps` to verify the returned next-steps are structurally valid.
6. **C-2 export rename**: After renaming `_schemas` → `_internal`, grep the test suite for any remaining `_schemas` imports. All should be updated.
7. **Final gate**: Full suite pass + TypeScript clean + grep for removed patterns (`_schemas`, `rework_count` standalone, `MARK_COMPLETE`, `let result!`).

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **A-1 dual-write removal breaks unknown consumers** | Grep entire codebase for `rework_count` (without `s`) before removing. The orchestrator and persona templates may reference this field in prompts — check and update if needed. |
| **B-1 test migration introduces false-green tests** | Compare migrated test assertions 1:1 against the 16 spec rules in §17.2. Each rule must have at least one dedicated test case. |
| **C-2 _schemas rename breaks test imports** | Run `grep -r '_schemas' mcp-server/tests/` after the rename. Zero matches required. |
| **C-3 checkRevalidationGuard refactor breaks call sites** | There is exactly one call site (in `pipeline.ts` → `startPipeline`). Update it to pass `wp.pipelines` instead of `wp`. TypeScript will catch type mismatches. |
| **A-6 new action type cases are incomplete** | Cross-reference against the full action type enum documented in `data-flows.md` Flow 7. Every type must have a case branch — use TypeScript exhaustiveness check (`default: never`) where possible. |
| **Theme scope creep** | Themes are designed to be independent. If time is limited, Theme D can be trivially bundled into any Theme A or C work package as a sub-task. |
