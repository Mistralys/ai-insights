# Plan

## Summary

This sprint implements all actionable items surfaced in the strategic recommendations of the `2026-02-28-synthesis-strategic-recommendations` synthesis report. Five work packages cover: (1) documenting the `tests/helpers/` usage mandate in `constraints.md`, (2) fixing a one-line guidance bug in the `CLAIM_WP` batch step, (3) adding a missing `getDocumentationAction` integration test for the `hasDependencyBlocked` path, (4) auditing and formally closing the `withLock` non-null assertion health check, and (5) removing the orphaned `rework_count` backward-compat scalar from both production source and its stale test fixture. All five items were flagged by the previous sprint's review pipeline as either medium-priority documentation gaps, low-severity bugs, coverage gaps, or deferred cleanup — none are speculative.

---

## Architectural Context

All changes are confined to `mcp-server/`. The relevant modules are:

| File | Role |
|------|------|
| `mcp-server/docs/agents/project-manifest/constraints.md` | Canonical constraint catalogue. Currently ends at §54. §55 will be added here to mandate `tests/helpers/` usage. |
| `mcp-server/src/tools/workflow-batch-actions.ts` | Implements `buildBatchNextSteps` and `get_next_actions`. The `CLAIM_WP` case at ~L147–L152 uses `pipelineType` where `agentRole` is already computed and should be used. |
| `mcp-server/src/tools/work-package.ts` | The `COMPLETE → IN_PROGRESS` reset path at L754 contains `wp.rework_count = undefined` — an orphaned backward-compat write for the retired scalar. |
| `mcp-server/src/utils/workflow-helpers.ts` | Exports `getDocumentationAction` (contains the now-symmetric `hasDependencyBlocked` guard) and the `hasDependencyBlocked` utility. |
| `mcp-server/tests/helpers/fixtures.ts` | Canonical fixture factory (`makeProject`, `makeWpDetail`, etc.). |
| `mcp-server/tests/helpers/test-utils.ts` | Canonical test utilities (`injectLedgerDir`, `nowFloor`). Mandated infrastructure introduced in the previous sprint. |
| `mcp-server/tests/tools/rework-circuit-breaker.test.ts` | Local `makeWpDetail` fixture at L37 still sets `rework_count` alongside `rework_counts`. This is the stale test-only orphan. |
| `mcp-server/tests/tools/workflow-batch-actions.test.ts` | Existing tests for `buildBatchNextSteps`. Will need a test for the corrected `CLAIM_WP` guidance output (WP-002). |
| `mcp-server/tests/tools/workflow-next-action.test.ts` or `mcp-server/tests/utils/workflow-helpers.test.ts` | Target home for the `getDocumentationAction` + `hasDependencyBlocked` integration test (WP-003). |

The `withLock` pattern is used across `work-package.ts` (L230, L844, L910), `project-lifecycle.ts` (L284, L302, L522), `observations.ts` (L132), and `ledger-store.ts` (L211). The `let result!` pattern was confirmed absent from all of these during pre-plan audit — WP-004 is a verification and formal close-out only.

---

## Approach / Architecture

Each work package is a minimal, targeted change with no cross-package coupling:

- **WP-001** is a pure documentation edit — one new section appended to `constraints.md`.
- **WP-002** is a one-line production fix + one new test assertion to cover the corrected output.
- **WP-003** is a test-only addition — no production code changes.
- **WP-004** is a read-only audit producing a written verification note documenting findings and formally closing the health check.
- **WP-005** removes two lines of dead code (one production, one test) after confirming no live ledger files contain the `rework_count` scalar.

WP-001 is sequenced first because it establishes the mandate that the other test work packages implicitly follow. WP-002 and WP-003 are independent and can run in parallel. WP-004 must precede WP-005 (the audit result informs whether the orphan removal is safe). WP-005 is last.

---

## Rationale

- **WP-001:** The `tests/helpers/` infrastructure was built in the prior sprint but not mandated. Without a codified constraint, future test files will silently diverge again — the exact problem the previous sprint fixed.
- **WP-002:** `agent: "${pipelineType}"` produces nonsensical guidance like `agent: "implementation"` instead of `agent: "Developer"`. The `agentRole` variable is already computed one line above the switch — the fix is purely referencing the correct variable.
- **WP-003:** The `hasDependencyBlocked` bug fix (WP-005 of prior sprint) has no end-to-end test coverage through `getDocumentationAction`. The utility itself is unit-tested, but a bad future refactor could re-introduce the asymmetry without failing any test.
- **WP-004:** The `let result!` pattern was confirmed absent in pre-plan audit. A formal write-up closes the open health-check item cleanly rather than leaving it in an unresolved state.
- **WP-005:** The `rework_count` scalar was retired in the prior sprint. The orphan write at `work-package.ts` L754 and the test fixture duplication at `rework-circuit-breaker.test.ts` L37 are now the only remaining references. Removing them completes the retirement.

---

## Detailed Steps

1. **(WP-001)** Append §55 to `mcp-server/docs/agents/project-manifest/constraints.md`. The section must specify: (a) all new test files must import shared factories and utilities from `tests/helpers/fixtures.ts` and `tests/helpers/test-utils.ts`; (b) local test-scope fixture factories are prohibited if an equivalent exists in `tests/helpers/`; (c) rationale: prevents per-file divergence and test-replica maintenance burden.

2. **(WP-002)** In `mcp-server/src/tools/workflow-batch-actions.ts`, `buildBatchNextSteps` CLAIM_WP case (~L149), change `${pipelineType}` → `${agentRole}` in the step-1 guidance string (`agent: "${pipelineType}"` → `agent: "${agentRole}"`). Add or update a test in `mcp-server/tests/tools/workflow-batch-actions.test.ts` (or wherever `buildBatchNextSteps` is tested) to assert that the CLAIM_WP guidance for an `implementation` pipeline yields `agent: "Developer"` (not `agent: "implementation"`).

3. **(WP-003)** Add an integration test in the appropriate test file (preferably `mcp-server/tests/utils/workflow-helpers.test.ts` where the other `getDocumentationAction` tests live, or a new focused section) that:
   - Creates a WP in `IN_PROGRESS` status.
   - Creates a dependency WP in `BLOCKED` status.
   - Calls `getDocumentationAction` with this state.
   - Asserts the result is NOT `WRITE_DOCS` (it must return `SKIP` or equivalent, respecting the `hasDependencyBlocked` guard).

4. **(WP-004)** Review all six `withLock` callback sites confirmed in pre-plan audit (`work-package.ts` L230, L844, L910; `project-lifecycle.ts` L284, L302, L522; `observations.ts` L132; `ledger-store.ts` L211). For each site, verify no `let variable!` (non-null assertion accumulator) pattern is present. The pre-plan grep found zero matches; the Developer should read each site to confirm. Document findings in a short commit message or inline comment noting the audit is complete. No source changes expected.

5. **(WP-005)**: 
   - **5a (safety check):** Inspect the live ledger storage directory (`mcp-server/storage/ledger/`) for any `.json` files containing the `rework_count` key. If any are found, do not proceed: log a warning and defer. If none are found, proceed.
   - **5b (production):** Remove line L754 `wp.rework_count = undefined; // Reset legacy scalar (backward-compat)` from `mcp-server/src/tools/work-package.ts`.
   - **5c (test):** In `mcp-server/tests/tools/rework-circuit-breaker.test.ts` L37, remove `, rework_count: reworkCount` from the spread so only `rework_counts: { implementation: reworkCount }` is set.
   - **5d (verification):** Run the full test suite (`npm test` in `mcp-server/`) and confirm zero failures.

---

## Dependencies

- WP-001 is independent.
- WP-002 is independent of WP-001.
- WP-003 is independent.
- WP-004 must complete before WP-005 (audit result gates the production removal).
- WP-005 depends on WP-004 sign-off.

**Sequencing:**
```
WP-001 ──────────────────────────────────────────────► done
WP-002 ──────────────────────────────────────────────► done
WP-003 ──────────────────────────────────────────────► done
WP-004 ──────────────────────────────────────────────► sign-off
                                                           │
WP-005 ◄───────────────────────────────────────────────────
```

WP-001, WP-002, WP-003, and WP-004 can all be run in parallel by the PM.

---

## Required Components

### Modified Files
- `mcp-server/docs/agents/project-manifest/constraints.md` — §55 addition (WP-001)
- `mcp-server/src/tools/workflow-batch-actions.ts` — CLAIM_WP one-line fix (WP-002)
- `mcp-server/src/tools/work-package.ts` — orphan line removal (WP-005b)
- `mcp-server/tests/tools/rework-circuit-breaker.test.ts` — fixture cleanup (WP-005c)

### New / Extended Files
- `mcp-server/tests/utils/workflow-helpers.test.ts` OR the relevant test file — new `getDocumentationAction` + BLOCKED dependency integration test (WP-003)
- `mcp-server/tests/tools/workflow-batch-actions.test.ts` — new CLAIM_WP assertion (WP-002)

### No New Files Required
No new source modules, utilities, or infrastructure files are needed for this sprint.

---

## Assumptions

- No live ledger JSON files in `mcp-server/storage/ledger/` contain the `rework_count` scalar (pre-plan audit did not verify live storage, so WP-005 includes an explicit safety check before deletion).
- `buildBatchNextSteps` already has tests in `workflow-batch-actions.test.ts` or a related file; if not, the Developer creates a minimal test adding the CLAIM_WP assertion.
- The `getDocumentationAction` function is accessible for testing (either exported or accessible via the tool handler path). If not exported, the test exercises it through the full `getNextAction` tool call path.
- The `tests/helpers/` mandate (§55, WP-001) does not require migrating any existing test files — only enforces the rule going forward.

---

## Constraints

- Follow all existing constraints in `mcp-server/docs/agents/project-manifest/constraints.md`, particularly §53 (`_internal` naming), §54 (`for-of` preference), and the STDIO logging discipline (§7).
- WP-005 must not be executed if the safety check (5a) finds live `rework_count` keys in storage.
- Test files must not define local fixture factories when a canonical equivalent exists in `tests/helpers/` (this is the rule WP-001 is codifying).
- Manifest must be updated after each WP that modifies the public API or constraint catalogue. Only `constraints.md` requires a manifest update for this sprint (WP-001); all other changes are implementation-internal.

---

## Out of Scope

- Migrating existing test files to use `tests/helpers/` (the mandate is forward-only; migration is a separate future sprint if deemed necessary).
- Extending the `tests/helpers/` infrastructure with new utilities beyond what already exists.
- Changing `getDocumentationAction` behavior — the fix from WP-005 of the prior sprint is already in production; WP-003 here adds only test coverage.
- Any changes to schema, data flows, or other manifest documents beyond `constraints.md`.

---

## Acceptance Criteria

- [ ] `constraints.md` contains a new §55 section formally mandating `tests/helpers/` usage for all new test files.
- [ ] `buildBatchNextSteps` CLAIM_WP case produces `agent: "Developer"` (not `agent: "implementation"`) for an `implementation`-type pipeline. A test asserts this.
- [ ] A test exists that calls `getDocumentationAction` with a WP whose dependency is `BLOCKED` and asserts the result is not `WRITE_DOCS`.
- [ ] All `withLock` callback sites in production source have been manually reviewed and confirmed to have no `let variable!` accumulator pattern. Audit outcome is documented.
- [ ] Live ledger storage confirms no `rework_count` scalar keys present, OR WP-005 is deferred with a documented reason.
- [ ] `wp.rework_count = undefined` line removed from `work-package.ts` (conditional on safety check passing).
- [ ] `rework_count: reworkCount` removed from the `makeWpDetail` fixture in `rework-circuit-breaker.test.ts` (conditional on safety check passing).
- [ ] Full test suite passes with zero failures and zero TypeScript errors after all WPs are applied.

---

## Testing Strategy

WP-001 is documentation-only; no automated test. WP-002 adds one focused unit assertion for the corrected CLAIM_WP guidance string. WP-003 adds one integration test exercising `getDocumentationAction` through the `hasDependencyBlocked` branch. WP-004 produces no automated test (it is a manual read-and-confirm audit). WP-005 is validated by ensuring the full suite still passes after the two line removals. The Developer must run `npm test` in `mcp-server/` and confirm 865+ tests pass (or match prior count) with zero failures.

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Live ledger contains rework_count scalar** | WP-005 step 5a explicitly checks before any deletion. If found, the WP is deferred and logged. |
| **getDocumentationAction is not directly accessible for testing** | Use the full `getNextAction` tool call path to exercise it; alternatively, verify its export under `_internal` per §53. |
| **CLAIM_WP test does not yet exist** | Developer creates a minimal test block for `buildBatchNextSteps` within the existing `workflow-batch-actions.test.ts` file. |
| **§55 mandate creates friction for future developers** | The section should be clearly scoped as forward-only (new files only) to avoid unintended scope creep. |
