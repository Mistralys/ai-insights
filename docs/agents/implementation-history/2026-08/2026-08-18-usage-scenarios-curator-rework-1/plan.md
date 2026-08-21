# Plan

## Plan Audit Cycles
- Audits: 1 — Plan Auditor v1.7.0
- Architectural Reviews: 1 — Plan Architect Reviewer v2.2.0

## Summary
This rework addresses the actionable maintenance recommendations from `docs/agents/plans/2026-08-18-usage-scenarios-curator/synthesis.md`: add executable Plan Refiner scenario-phase coverage, classify optional scenario-file errors precisely, and remove recurring manual persona-count synchronization. It preserves the confirmed architecture from the design review: scenario verification remains post-convergence and bounded to a single Planner integration/re-check, optional files are treated as absent only on `ENOENT`, and the plan-blind Acceptance Verifier boundary remains intact. It also keeps every deferred item, including the future `request.md` scenario contract and the exact 13 unrelated root test failures, without expanding this rework into a model-registry repair.

## Prior Project Context
The original `2026-08-18-usage-scenarios-curator` plan delivered the standalone curator, bounded post-convergence Plan Refiner integration, authored-source archival, and generated outputs. Its synthesis recorded 4,165 cross-module tests passing, while the root workspace suite separately reported 13 model-resolution/display-label failures. Repository insights confirm that optional standalone-import files must distinguish genuine `ENOENT` absence from other filesystem failures.

## Architectural Context
The usage-scenario capability is source-driven. Persona YAML/content under `personas/standalone/src/` generates supported targets through `scripts/build-personas.js`; `plan-refiner.md` delegates scenario verification after technical convergence; and `mcp-server/src/tools/standalone-import.ts` delegates locked archive writes to `LedgerStore.importStandaloneProject()`.

The current import contract preserves authored `usage-scenarios.md` when present, excludes generated `scenario-coverage.md`, and reports actual `archived_files`. The remaining implementation gap is diagnostic: optional discovery treats every `access()` error as absence. The overview generator already counts loaded metadata but its tests and catalog expectations retain manual counts. The root model-resolution failures are in separate existing build/plugin/test surfaces.

## Approach / Architecture

1. Add a focused executable/document-contract test for Plan Refiner's post-convergence scenario phase. Cover non-GUI absent-file skip, GUI absent-file confirmation gate, confirmed exception, PASS/PASS WITH FINDINGS/FAIL recording, one Planner integration and re-check maximum, and preservation of the plan-blind Acceptance Verifier boundary. Use the existing source persona protocol and test conventions; do not introduce a runtime orchestration abstraction solely for this test.
2. Harden optional `usage-scenarios.md` discovery in `mcp-server/src/tools/standalone-import.ts` so only `ENOENT` means absent. Surface other access errors through the established import error path, while preserving the existing `LedgerStore` archive allowlist, locks, atomic writes, `archived_files`, and multi-store routing. Add a focused non-ENOENT test alongside the existing present/absent and exclusion cases.
3. Make displayed persona counts derive from loaded metadata. Refactor the overview summary rendering and its tests to use the same computed ledger/standalone/support counts that drive the generated document, but do not make the tests share the generator's entire metadata-loading path if that would make them tautological. Decide explicitly whether the standalone catalog count remains hand-synchronized, gains a generated marker, or is validated by a dedicated roster check; the key requirement is that the count is not duplicated in a second hard-coded source of truth. Regenerate overview, catalog-related outputs, name mapping, and affected context snapshots only where source changes require it.
4. Run focused validation for each promoted slice, then the MCP import/storage tests, persona freshness/build checks, and root `npm test`. Record the 13 model-resolution/display-label failures as an explicit baseline delta and do not reclassify them as green simply because this rework is in progress.

## Rationale
The promoted changes are small, directly supported by current code, and reduce recurring maintenance risk. Executable Plan Refiner coverage protects the most behaviorally complex new protocol. Error-code classification preserves optionality while preventing permission or other filesystem failures from being silently downgraded. Metadata-derived counts remove a known synchronization point without changing persona behavior. The request-bundle decision and model failures remain separate because changing either would broaden the contract beyond this maintenance rework.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Plan Refiner validation | Focused executable protocol test over the existing persona contract | No test; full end-to-end agent invocation | A focused test is deterministic and cheap while still guarding the confirmation, verdict, and bounded-retry rules; live agent invocation would be slow and provider-dependent. |
| Optional-file error handling | Treat only `ENOENT` as absence and surface other errors | Preserve broad catch; make the file mandatory | Broad catching hides operational failures; making the file mandatory breaks the delivered optional contract. |
| Count source | Derive counts from loaded metadata | Update hard-coded test/catalog numbers manually | Metadata derivation removes recurring drift and matches the generator's existing architecture. |
| Requester-authored scenarios | Defer to a future `request.md` bundle design | Add a second scenario schema now | The current capability is explicitly plan-derived; adding requester intent now would alter archival, verifier, and handoff contracts without a settled schema. |
| Root test failures | Preserve as separate deferred triage | Mix model-registry repair into this rework | The failures are unrelated to usage scenarios and require their own diagnosis across model resolution, ledger plugin, and overview expectations. |

## Pattern Alignment

- Follows the existing Plan Refiner delegated-subagent and refinement-log patterns in `personas/standalone/src/content/plan-refiner.md`.
- Follows Node.js `fs/promises`, error-code checks, path utilities, and LedgerStore ownership in `mcp-server/src/tools/standalone-import.ts` and `mcp-server/src/storage/ledger-store.ts`.
- Follows metadata-driven generation in `scripts/generate-agents-overview.js` and source-authoritative persona build rules in `personas/docs/agents/project-manifest/constraints.md`.
- Deliberately keeps requester-authored scenarios outside the current import and Acceptance Verifier contracts.
- Deliberately keeps the model-resolution regression outside this rework's implementation scope while documenting it precisely.

## Detailed Steps

1. **Add Plan Refiner scenario-phase coverage.** Create or extend the nearest root test/document-contract fixture for `plan-refiner.md`. Assert the documented state transitions and terminal logging for all scenario outcomes, including the GUI confirmation denial path and the one-recheck ceiling. Assert that `usage-scenarios.md` is never passed to the plan-blind Acceptance Verifier.
2. **Harden optional import discovery.** Add a small helper or local error-code branch in `mcp-server/src/tools/standalone-import.ts` that returns false only for `ENOENT` and rethrows other filesystem failures. Preserve `scenario-coverage.md` exclusion and the current `LedgerStore.importStandaloneProject()` archive behavior. Add tests for non-ENOENT failure, optional absence, presence, content, exclusion, required files, and multi-store routing as needed to retain the existing matrix.
3. **Remove manual persona-count drift.** Update `scripts/generate-agents-overview.js` and `scripts/tests/generate-agents-overview.test.js` so suite and total counts are computed from loaded metadata without reusing the generator's entire loading path if that would make the assertions tautological. Explicitly choose the standalone catalog synchronization mechanism: generated marker, validation check, or documented manual update rule. Update `personas/standalone/README.md` only if its displayed count remains a maintained surface.
4. **Validate and regenerate.** Run focused MCP tests, root script tests, `node scripts/build-personas.js --check`, the relevant persona build command, overview `--check`, workflow-manifest validation, and any required CTX generation. Confirm generated outputs are not hand-edited and inspect the diff for unrelated churn.
5. **Document deferred work.** Keep the `request.md` scenario-bundle decision in the Deferred Items table. Preserve the full root failure inventory as the baseline delta and report it separately from promoted acceptance criteria. Do not mark the root suite green while those failures remain.

## Dependencies

- Existing Vitest root and MCP test infrastructure.
- Existing persona build and overview-generation scripts.
- Existing LedgerStore import/archive contract and multi-store routing.
- No new production dependency.

## Required Components

- Modified: `personas/standalone/src/content/plan-refiner.md` only if the test exposes a contract gap; otherwise test-only coverage.
- Modified: `mcp-server/src/tools/standalone-import.ts`.
- Modified: `scripts/generate-agents-overview.js` and `scripts/tests/generate-agents-overview.test.js`.
- Modified: `personas/standalone/README.md` only if count synchronization cannot use an existing generated path.
- Modified focused MCP tests under `mcp-server/tests/tools/`, `mcp-server/tests/storage/`, or the existing nearest test files.
- Regenerated as required: `docs/references/agents-overview.md`, persona targets, `personas/name-mapping.json`, and affected `.context/` files.

## Assumptions

- The delivered scenario archival contract remains correct and requires only diagnostic hardening.
- A focused source/document-contract test is acceptable for persona behavior that is expressed as Markdown protocol rather than executable runtime code.
- The current root failure inventory was captured from `npm test` on 2026-08-18 and may change; any changed inventory must be reported rather than silently omitted.
- No requester-authored scenario schema is introduced until the `request.md` bundle decision is made.

## Constraints

- Do not edit generated persona targets, `docs/references/agents-overview.md`, or `.context/` snapshots directly.
- Do not archive or import `scenario-coverage.md`.
- Do not make `usage-scenarios.md` mandatory.
- Preserve cross-platform path handling and existing locking/atomic-write behavior.
- Do not claim all tests pass while the listed root failures remain.
- Do not fix unrelated model-resolution failures as an incidental part of this rework.

## Out of Scope

- Designing requester-authored goal scenarios in `request.md`.
- Changing the plan-blind Acceptance Verifier contract.
- Reworking model registry resolution, ledger plugin model injection, or generated overview expectations beyond count derivation needed for this rework.
- Adding a persistent scenario database, MCP scenario tool, or GUI for scenario authoring/viewing.
- Expanding Plan Refiner into an unbounded scenario loop.

## Acceptance Criteria

- AC-01: A focused executable or deterministic document-contract test covers Plan Refiner scenario-phase skip, confirmation, verdict, bounded re-check, and Acceptance Verifier separation behavior.
- AC-02: Optional `usage-scenarios.md` discovery treats only `ENOENT` as absence and surfaces non-ENOENT filesystem failures through the established error path.
- AC-03: Existing import behavior remains intact: authored scenarios are preserved when present, absent optional files remain valid, `scenario-coverage.md` is excluded, archived files are reported accurately, required-file validation remains intact, and multi-store routing remains intact.
- AC-04: Overview suite and total counts are derived from loaded persona metadata rather than duplicated hard-coded values, and the relevant catalog/output checks are synchronized.
- AC-05: Focused MCP tests, persona build/freshness checks, overview checks, and manifest/context validation pass for the promoted changes.
- AC-06: The final report preserves the future `request.md` contract as deferred and lists all 13 current root failures by test file and behavior; it does not misreport the root suite as green.

## Testing Strategy

Start with the narrowest tests for each promoted change, then run the MCP import/storage matrix and persona generation checks. Finish with the root suite to detect cross-module drift. Treat the 13 model-resolution/display-label failures as a known deferred baseline unless separately authorized; record any change in count or failure family.

## Test Plan

- `mcp-server/tests/tools/standalone-import.test.ts` — non-ENOENT optional-file discovery, present/absent behavior, `archived_files`, and derived-report exclusion — AC-02, AC-03.
- `mcp-server/tests/storage/ledger-store.test.ts` — optional authored source archive and absence behavior at the storage boundary — AC-03.
- `mcp-server/tests/tools/standalone-import-multi-store.test.ts` — optional source preservation through multi-store routing — AC-03.
- Existing or new root Plan Refiner contract test near `scripts/tests/` — GUI/non-GUI gating, confirmation, verdicts, one-recheck ceiling, and verifier separation — AC-01.
- `scripts/tests/generate-agents-overview.test.js` — metadata-derived total and per-suite counts plus freshness behavior — AC-04.
- `scripts/tests/build-personas-model-resolution.test.js` — record current 7 unrelated failures as deferred regression inventory; do not alter as part of this rework — AC-06.
- `scripts/tests/ledger-plugin.test.js` — record current 4 unrelated model-resolution failures as deferred regression inventory; do not alter as part of this rework — AC-06.
- `scripts/tests/generate-agents-overview.test.js` — record current 2 count/display-label failures as deferred baseline until count derivation work resolves or reclassifies them — AC-06.
- `node scripts/build-personas.js --check` and the relevant build command — generated persona freshness and name mapping — AC-04, AC-05.
- `npm test` from the workspace root — final regression inventory; report remaining unrelated failures explicitly — AC-05, AC-06.

## Documentation Updates

- `docs/agents/plans/2026-08-18-usage-scenarios-curator-rework-1/research-brief.md` — verified references and failure inventory.
- `docs/agents/plans/2026-08-18-usage-scenarios-curator-rework-1/plan.md` — this rework plan and all deferred items.
- `mcp-server/docs/agents/project-manifest/api-surface.md`, `data-flows.md`, and `file-tree.md` — update only if the diagnostic or public import behavior changes; regenerate `.context/` afterward.
- `personas/docs/agents/project-manifest/api-surface.md`, `data-flows.md`, or `constraints.md` — update only if persona/test or generated-count conventions change; regenerate `.context/` afterward.
- `personas/standalone/README.md` — synchronize the displayed catalog count if it remains a maintained surface.
- Generated `docs/references/agents-overview.md`, persona targets, `personas/name-mapping.json`, and affected `.context/` snapshots — regenerate from source, never hand-edit.
- `docs/agents/projects/gui-usage-scenarios.md` — update only if the deferred `request.md` decision is resolved; otherwise retain its current boundary statement.

## Deferred Items

| # | Deferred Item | Origin | Reason Deferred | Notes |
|---|---|---|---|---|
| 1 | Decide whether requester-authored goal scenarios belong in a future `request.md` bundle. | Synthesis WP-005 / Strategic Recommendations | The current contract intentionally supports plan-derived `usage-scenarios.md` only; no requester-intent schema or verifier boundary has been accepted. | Reconsider when a request-bundle design exists; do not add it here. |
| 2 | Triage and repair the 7 `scripts/tests/build-personas-model-resolution.test.js` failures: per-persona assignment, YAML fallback, default assignment, shared default, per-persona inherit skip, default inherit skip, and absent-registry model name. | Synthesis project-level out-of-scope item | Cross-cutting model-registry/build behavior is unrelated to scenario archival and needs its own diagnosis. | Current `npm test` baseline; keep listed even if later tests change. |
| 3 | Triage and repair the 4 `scripts/tests/ledger-plugin.test.js` failures: per-persona assignment, shared default fallback, empty-registry YAML fallback, and per-persona inherit skip. | Synthesis project-level out-of-scope item | Same separate model-resolution regression family as item 2. | Coordinate with item 2 in a dedicated model-settings work package. |
| 4 | Resolve the 2 `scripts/tests/generate-agents-overview.test.js` failures: total persona count and summary table counts. | Synthesis project-level out-of-scope item | Count drift overlaps this rework's promoted maintenance slice, but any remaining display-label expectation failure belongs to the overview/count repair scope, not scenario behavior. | Reclassify after metadata-derived counts are implemented; do not silently drop the baseline. |
| 5 | Add executable coverage for persona handoff wording if documentation-only boundaries become regression-sensitive. | Synthesis WP-003 follow-up | Current source/generated inspection is sufficient for the delivered contract; stronger behavioral coverage needs a stable harness. | Promote when a reusable persona protocol test harness exists. |

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Focused Plan Refiner coverage becomes brittle Markdown snapshot testing. | Assert stable protocol markers and decision branches, not incidental prose formatting. |
| Non-ENOENT errors leak filesystem details or alter expected tool semantics. | Follow existing error-code handling and test a representative non-ENOENT failure at the tool boundary. |
| Count derivation changes generated output unexpectedly. | Compare generated diffs, run `--check`, and keep source metadata authoritative. |
| The known root failures are mistaken for regressions caused by this rework. | Record the exact baseline, run focused tests first, and report failure deltas explicitly as a separate inventory. |
| Count tests become tautological by reusing the same generator loader path. | Keep assertions independent from the full generator pipeline or use an explicitly enumerated roster/validation check. |
| Deferred `request.md` work is reintroduced indirectly through archival changes. | Keep the current authored-source allowlist explicit and add a boundary assertion to the documentation/test plan. |

## Recommended Workflow
- **Workflow:** standalone
- **Rationale:** This is a bounded maintenance rework across existing contracts with no new architecture; focused implementation, QA, and explicit regression reporting are sufficient once the plan is executed.
