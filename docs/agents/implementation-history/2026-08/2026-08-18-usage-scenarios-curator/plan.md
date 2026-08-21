# Plan

## Plan Audit Cycles
- Audits: 1 — Plan Auditor v1.7.0
- Architectural Reviews: none — Plan Architect Reviewer v2.2.0

## Summary
Create a dedicated standalone Usage Scenarios Curator and integrate it into the plan lifecycle as an opt-in user-facing coverage check with a GUI-scope guard. The initiative will generate and verify concrete end-user scenarios, let Plan Refiner consume the verification after technical convergence, warn and require user confirmation when a GUI-touching plan lacks `usage-scenarios.md`, preserve the scenario source document through Git and standalone-ledger archival, and regenerate all persona/catalog outputs. It will not feed the plan-derived scenario document into the separate plan-blind Acceptance Verifier; requester-authored goal scenarios remain a future request-bundle design question.

## Architectural Context
The persona system is source-driven: standalone YAML metadata and Markdown content under `personas/standalone/src/` produce VS Code, Claude Code, and Deep Agents outputs through `scripts/build-personas.js`. Persona Curator is the designated authoring agent for the new persona: its Create mode reads the Persona Design Guide and produces the source YAML/content pair. Plan Refiner already coordinates delegated specialist reviews and uses optional companion files gated by presence.

Plan folders currently treat `plan.md`, `synthesis.md`, and optional `request.md` as source documents. `git-committer.md` controls source-file grouping and archival, `standalone-archiver.md` reports the MCP import contract, and `mcp-server/src/tools/standalone-import.ts` enforces the required plan/synthesis pair and archives it through LedgerStore. The new scenario source must extend this contract without importing the derived coverage report.

## Approach / Architecture

1. Add `usage-scenarios-curator` as a standalone persona with two modes:
   - **Generate:** read a completed `plan.md`, derive candidate scenarios with actor, goal, trigger, steps, expected responses, edge cases, and traceability hints, and write `usage-scenarios.md` beside the plan for human editing.
   - **Verify:** read `plan.md` and the edited `usage-scenarios.md`, classify each scenario and step as covered, partially covered, or unaddressed against the plan's approach, detailed steps, and acceptance criteria, and write `scenario-coverage.md` with PASS / PASS WITH FINDINGS / FAIL semantics.
2. Extend Plan Refiner with a GUI-scope guard and an opt-in scenario phase. Detect GUI impact from the plan's declared scope and content using explicit indicators such as frontend/GUI files, browser interaction, screens, views, forms, routes, or user-visible UI behavior. If GUI impact is detected and `usage-scenarios.md` is absent, warn that plan audits may be inaccurate and require explicit user confirmation to proceed without it; stop and leave the refinement incomplete when confirmation is not granted. If scenarios are present, or the user confirms the exception, continue only after recording the decision. After technical audit convergence, delete stale coverage, delegate Verify when scenarios are present, inspect the verdict, and perform at most one Planner integration and re-check for FAIL or Major findings. Record the guard decision plus `SKIPPED`, `PASS`, `PASS WITH FINDINGS`, or `FAIL — unresolved` in the refinement log.
   For the optional-file discovery probe, treat only `ENOENT` as absence. Wrap the probe in the handler-level error boundary: a non-`ENOENT` error must return the established MCP response shape with `isError: true` and an `Import failed:` message, not escape as a rejected `_internal.importStandalone()` promise. Preserve `LedgerStore.archiveDocuments()` as the storage boundary that skips only `ENOENT` and rethrows other I/O errors; its caller continues converting those errors through the existing import error response.
3. Extend source-document handling so `usage-scenarios.md` travels with `plan.md`, `synthesis.md`, and optional `request.md` through Git Committer archival and Standalone Archiver/MCP import. Keep `scenario-coverage.md` excluded as a generated report. Add the required MCP storage/tool behavior and tests.
4. Register the persona in metadata/catalogs, update affected persona changelogs, regenerate persona outputs, name mapping, and agents overview, and update relevant manifest/context documentation only where the implementation changes the documented public contract.

## Rationale
A standalone persona keeps the user-facing coverage lens separate from plan authorship, technical audit, and implementation. Conditional gating preserves backward compatibility for non-GUI plans while preventing a GUI plan from silently receiving an incomplete user-facing audit: absence of scenarios becomes a confirmed exception, not an invisible skip. A single-shot post-convergence verification phase avoids multiplying the technical audit loop while still giving major user-facing gaps one controlled path back into the plan. Treating `usage-scenarios.md` as a source document and `scenario-coverage.md` as derived output prevents generated review state from being mistaken for requester intent or archived project source.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Persona placement | Standalone-only curator | Ledger role or Web GUI Specialist mode | The capability is plan-adjacent and user-invocable, not a fixed pipeline stage; standalone avoids routing semantics and keeps the GUI implementation persona focused. |
| Scenario verification cadence | One post-audit check plus one re-check | Full iterative loop or pre-audit verification | Post-audit sees a stable plan; bounded re-check catches integrated gaps without creating a second unbounded refinement loop. |
| Missing-scenario handling for GUI plans | Warn and require explicit user confirmation to continue without `usage-scenarios.md` | Silent skip or make the file mandatory for every plan | A confirmation gate preserves non-GUI compatibility while making the loss of user-facing audit coverage visible and deliberate. |
| Scenario artifact boundary | Preserve `usage-scenarios.md`; exclude `scenario-coverage.md` | Archive/import both or preserve neither | The authored scenarios are reusable source context; coverage is generated evidence and should be recreated rather than archived as source. |
| Acceptance Verifier relationship | Keep plan-derived scenarios upstream-only | Pass `usage-scenarios.md` directly to Acceptance Verifier | The document is derived from `plan.md`; passing it downstream would violate the Verifier's plan-blindness and duplicate the plan's interpretation. |

## Pattern Alignment

- Follows standalone source/output separation and changelog-derived metadata in `personas/standalone/src/meta/` and `personas/standalone/src/content/`.
- Follows the Curator persona pattern established by `personas/standalone/src/content/persona-curator.md`.
- Delegates new persona authoring to Persona Curator Create mode; any fallback authoring is temporary and must be followed by a Persona Curator Audit.
- Follows Plan Refiner's delegated-specialist and optional-file-presence patterns in `personas/standalone/src/content/plan-refiner.md`.
- Follows existing MCP import validation and storage paths in `mcp-server/src/tools/standalone-import.ts` and LedgerStore; no new storage abstraction is required.
- Deliberately introduces a new source-document category, but keeps the existing plan-folder convention and generated-report exclusion explicit.

## Detailed Steps

1. **Finalize the persona contract.** Resolve the proposed slug and standalone-only placement. Define Generate and Verify inputs, outputs, workflow steps, scenario schema, coverage classifications, verdict rules, self-validation, scope boundaries, and standardized handoffs. Ensure Verify is read-only with respect to plan and implementation and never proposes fixes outside the coverage report.
2. **Author through Persona Curator.** Invoke the existing Persona Curator in Create mode with the finalized role brief and this plan's verified references. Require it to read `personas/docs/persona-design-guide.md` and create the YAML metadata and Markdown content under `personas/standalone/src/meta/usage-scenarios-curator.yaml` and `personas/standalone/src/content/usage-scenarios-curator.md`, including the dated `changelog:` entry and overview metadata. If Persona Curator cannot be invoked, record the reason, author only the minimum equivalent source change, and schedule Persona Curator Audit before implementation is accepted.
3. **Integrate Plan Refiner.** Add the curator to `plan-refiner.yaml` subagents. Amend `plan-refiner.md` inputs, operational protocol, refinement-log template, workflow, and terminal reporting to detect GUI scope, warn when scenarios are absent, require and record explicit user confirmation before proceeding without them, and implement the presence-gated post-audit scenario phase with bounded re-check. Preserve the technical audit loop's existing terminal semantics. Add a concrete source contract test at `scripts/tests/plan-refiner-contract.test.js`; it must load the Markdown source and assert stable protocol markers for: silent non-GUI skip; GUI absence warning; denial stopping refinement; granted exception continuing as `SKIPPED`; `PASS`, `PASS WITH FINDINGS`, and `FAIL — unresolved` verdict recording; exactly one Planner integration and curator re-check; and the rule that `usage-scenarios.md` is never passed to Acceptance Verifier. The test should assert headings/labels or distinctive protocol phrases, not incidental Markdown formatting.
4. **Extend Git source-document handling.** Amend `git-committer.md` so `usage-scenarios.md` is an optional source companion for matching, grouping, and archival, while `scenario-coverage.md` remains excluded and absence remains normal.
5. **Extend standalone archival/import.** Amend `personas/ledger-support/src/content/standalone-archiver.md`, the standalone Developer and Web GUI Specialist handoff wording, and `mcp-server/src/tools/standalone-import.ts`/LedgerStore import behavior to copy `usage-scenarios.md` when present, report it accurately, and ignore `scenario-coverage.md`. The handler-level optional-file probe must catch non-`ENOENT` discovery failures and return `{ content: [{ type: 'text', text: 'Import failed: ...' }], isError: true }`; add a focused `_internal.importStandalone()` test that verifies this returned response and confirms the promise does not reject. Keep the storage-layer `archiveDocuments()` contract unchanged: missing files are skipped, while non-`ENOENT` copy failures are rethrown for the handler's established `Import failed:` catch. Update MCP help, API-surface, data-flow, and file-tree documentation if the public import contract changes.
6. **Add focused tests.** Cover successful import with and without `usage-scenarios.md`, returned `archived_files`, archived content, exclusion of `scenario-coverage.md`, missing required-file behavior, handler-level non-`ENOENT` optional-probe errors as returned MCP error responses, storage-level rethrow behavior for non-`ENOENT` archive failures, and multi-store routing. Add the concrete `scripts/tests/plan-refiner-contract.test.js` described in Step 3, with deterministic assertions for every GUI guard, verdict, bounded re-check, and Acceptance Verifier separation case. Add persona/build validation checks for metadata, generated output freshness, Plan Refiner registration, and catalog presence.
7. **Regenerate and reconcile outputs.** Run the persona build for all required suites/targets, regenerate `personas/name-mapping.json` and `docs/agents-overview.md`, and update any affected generated context documents. Verify no generated file was edited directly and that all source changelogs and `personas/changelog.md` are current.
8. **Audit fallback authoring when needed.** If Persona Curator authored the persona, perform the normal source/build validation. If fallback authoring was required, invoke Persona Curator Audit against the created source before accepting the implementation.
9. **Review the Acceptance Verifier boundary.** Record requester-authored, goal-level scenarios as a future `request.md` bundle consideration only; do not alter the plan-blind verifier contract in this initiative.

## Dependencies

- The persona builder and root scripts must be available for generated output and overview regeneration.
- Persona Curator should be available for the authoring work package; if unavailable, the fallback path requires a subsequent Persona Curator Audit before acceptance.
- The MCP import change depends on the existing LedgerStore import/archive contract and its multi-store routing.
- Plan Refiner integration depends on the new persona's generated target files and stable subagent registration.
- Documentation updates depend on the final import response shape and archived-file list.

## Required Components

- New: `personas/standalone/src/meta/usage-scenarios-curator.yaml`
- New: `personas/standalone/src/content/usage-scenarios-curator.md`
- Modified: `personas/standalone/src/meta/plan-refiner.yaml`
- Modified: `personas/standalone/src/content/plan-refiner.md`
- Modified: `personas/standalone/src/content/git-committer.md`
- Modified: `personas/ledger-support/src/content/standalone-archiver.md`
- Modified: standalone Developer and Web GUI Specialist source templates
- Modified: `mcp-server/src/tools/standalone-import.ts` and the LedgerStore import surface as required by the existing implementation
- Modified tests under `mcp-server/tests/tools/`, `mcp-server/tests/storage/`, and relevant root/persona build checks
- Regenerated: standalone persona targets, `personas/name-mapping.json`, `docs/agents-overview.md`, and affected `.context/` documents

## Assumptions

- `usage-scenarios.md` is optional for non-GUI plans and may be manually edited between Generate and Verify.
- A GUI-touching plan may proceed without `usage-scenarios.md` only after the user explicitly confirms the exception; the Refiner records that decision and warns that plan audits may be inaccurate.
- Verify receives a plan path and scenario-file path; it does not need MCP access in standalone mode.
- The existing standalone import API can expose an optional archived-file list without changing required `plan.md`/`synthesis.md` semantics.
- The current plan-folder naming convention remains unchanged.

## Constraints

- Never edit generated persona output or generated overview documents directly.
- Preserve cross-platform Node.js path handling and existing lock/atomic-write behavior.
- Do not import or archive `scenario-coverage.md`.
- Do not make scenario files mandatory for non-GUI plans.
- Do not silently proceed without scenarios when GUI impact is detected; require and record explicit user confirmation.
- Do not add Acceptance Verifier input access to plan-derived scenarios.
- Every modified persona source requires its own changelog update and a corresponding `personas/changelog.md` entry.

## Out of Scope

- Implementing or redesigning the Acceptance Verifier.
- Moving scenario capture into the pre-plan request workflow.
- Making scenario verification a mandatory ledger pipeline stage.
- Building a GUI for authoring or viewing scenarios.
- Adding a new persistent scenario database or MCP tool.
- Iterating Plan Refiner scenario verification beyond one integration/re-check.

## Acceptance Criteria

- AC-01: A standalone `usage-scenarios-curator` persona is available in source metadata/content with Generate and Verify modes, complete Design Guide structure, explicit boundaries, structured outputs, and handoff blocks.
- AC-01a: The persona source is authored through Persona Curator Create mode when available; if fallback authoring is necessary, the reason is recorded and Persona Curator Audit passes before implementation acceptance.
- AC-02: Generate mode writes a human-editable `usage-scenarios.md` beside the target plan with actor, goal, trigger, interaction steps, expected responses, edge cases, and plan traceability fields.
- AC-03: Verify mode writes `scenario-coverage.md`, classifies every scenario and step, and emits a deterministic PASS, PASS WITH FINDINGS, or FAIL verdict without modifying the plan or implementation.
- AC-04: Plan Refiner skips the scenario phase without warning for non-GUI plans when `usage-scenarios.md` is absent, but detects GUI impact from the plan's scope/content, warns that audits may be inaccurate, and requires explicit user confirmation before proceeding without the file; an unconfirmed GUI exception leaves refinement incomplete. When scenarios are present, Refiner runs verification after technical convergence, records the result, and performs no more than one Planner integration/re-check for major gaps.
- AC-05: Git Committer and Standalone Archiver treat `usage-scenarios.md` as an optional source companion and exclude `scenario-coverage.md` from grouping, archival, and import.
- AC-06: `ledger_import_standalone` preserves `usage-scenarios.md` when present, remains successful when it is absent, and reports the actual archived file list; required-file and multi-store behavior remain intact.
- AC-06a: When the optional `usage-scenarios.md` discovery probe encounters a non-`ENOENT` filesystem error, `_internal.importStandalone()` resolves to the established MCP error response with `isError: true` and an `Import failed:` message; it does not reject. `LedgerStore.archiveDocuments()` continues to skip only `ENOENT` and rethrow other copy errors for the handler to convert.
- AC-07: Focused MCP tests cover present/absent optional files, derived-report exclusion, archived content, and routing/error paths; persona build and freshness checks pass.
- AC-08: Standalone catalogs, overview metadata, generated persona outputs, name mapping, changelog entries, and affected manifest/context documents are consistent with the new capability.
- AC-09: Documentation explicitly keeps plan-derived scenarios separate from the plan-blind Acceptance Verifier and defers requester-authored scenario capture to a future request-bundle decision.

## Testing Strategy

Use focused source-level and integration tests for the MCP import contract, then run the persona build freshness and generated-overview checks. Validate the persona manually against the Design Guide checklist and inspect generated outputs for target-specific correctness. Run the broader MCP and root test suites after focused checks because the import contract and generated persona registration cross module boundaries.

## Test Plan

- `mcp-server/tests/tools/standalone-import.test.ts` — import with and without `usage-scenarios.md`, returned archived files, content preservation, and exclusion of `scenario-coverage.md` — AC-06, AC-07.
- `mcp-server/tests/tools/standalone-import.test.ts` — import with and without `usage-scenarios.md`, returned archived files, content preservation, exclusion of `scenario-coverage.md`, and a non-`ENOENT` optional-probe failure resolved as `{ isError: true, content[0].text matching /^Import failed:/ }` rather than rejected — AC-06, AC-06a, AC-07.
- `mcp-server/tests/storage/ledger-store.test.ts` — direct import/archive behavior for optional source documents and absence, plus rethrowing a non-`ENOENT` copy failure from `archiveDocuments()` — AC-06, AC-06a, AC-07.
- `mcp-server/tests/tools/standalone-import-multi-store.test.ts` — optional-file preservation through multi-store routing — AC-06, AC-07.
- Root persona/build validation — metadata registration, generated target files, name mapping, and stale-output detection — AC-01, AC-07, AC-08.
- Manual Persona Design Guide checklist against `usage-scenarios-curator.md` — structure, mode separation, constraints, decision logic, output schema, and handoff — AC-01, AC-03.
- Persona Curator Create/Audit record — Create mode authors the source when available; fallback source receives a Persona Curator Audit before acceptance — AC-01a.
- `scripts/tests/plan-refiner-contract.test.js` — load `personas/standalone/src/content/plan-refiner.md` and assert stable protocol markers for non-GUI absent-file skip, GUI absent-file warning, denial stop, granted exception, `PASS`, `PASS WITH FINDINGS`, `FAIL — unresolved`, one Planner integration followed by one curator re-check, and explicit Acceptance Verifier separation; also assert `plan-refiner.yaml` registers the curator — AC-04.
- Documentation consistency check — source/derived boundary and Acceptance Verifier separation remain explicit — AC-05, AC-08, AC-09.

## Documentation Updates

- `docs/agents/projects/gui-usage-scenarios.md` — close resolved open items, record the final slug/placement and bounded Plan Refiner loop, and link the dedicated plan.
- `personas/standalone/README.md` — add the new persona to the standalone catalog.
- `personas/changelog.md` — summarize the new curator and affected persona contract changes.
- Modified persona YAML changelog blocks — add dated entries for each changed persona. If `plan-refiner.md` or `plan-refiner.yaml` changes, update the Plan Refiner `changelog:` block with a dated SemVer entry; likewise update the changelog block for every other modified persona source, including standalone Developer or Web GUI Specialist handoff templates.
- `mcp-server/docs/agents/project-manifest/api-surface.md` — document optional `usage-scenarios.md` import behavior and response fields if public surface changes.
- `mcp-server/docs/agents/project-manifest/data-flows.md` and `file-tree.md` — document the source-document archive flow and any new archived artifact handling.
- `personas/docs/agents/project-manifest/api-surface.md` / `data-flows.md` / `constraints.md` — update persona registration/build or source-document conventions only where changed; run CTX generation after edits.
- `docs/agents-overview.md`, `personas/name-mapping.json`, generated persona files, and affected `.context/` snapshots — regenerate from source; never hand-edit.

If the Plan Refiner source remains unchanged and the work is test-only for that surface, no Plan Refiner version bump is required; the new curator's source metadata and any other actually modified persona sources still require their own changelog entries and the corresponding `personas/changelog.md` summary.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Scenario verification duplicates Plan Auditor or Acceptance Verifier | Keep the curator's lens explicitly user-facing and plan-cross-referencing; keep Acceptance Verifier plan-blind and defer request-bundle capture. |
| Optional-file changes break standalone import assumptions | Preserve required-file validation, add present/absent tests, and return the actual archived-file list. |
| Plan Refiner becomes an unbounded second audit loop | Run only after technical convergence and cap integration/re-check at one pass. |
| Generated persona/catalog drift | Run build, overview generation, name-mapping generation, freshness checks, and CTX regeneration in the same change. |
| Archival accidentally stores derived coverage reports | Add explicit negative tests and source-document exclusions in both Git Committer and MCP import paths. |
| Multiple personas' shared guidance becomes inconsistent | Update source templates and changelog each affected persona, then inspect generated outputs before completion. |

## Recommended Workflow
- **Workflow:** ledger
- **Rationale:** The work spans persona sources, Plan Refiner orchestration, MCP import/storage behavior, generated artifacts, and documentation contracts; the persona-authoring work package should invoke Persona Curator Create mode first, followed by the coordinated implementation, QA, security, architecture, release, and documentation passes.
