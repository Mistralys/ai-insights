# Project Synthesis: Usage Scenarios Curator

## Executive Summary

Implemented and integrated the standalone `usage-scenarios-curator` persona with separate Generate and Verify modes. Plan Refiner now performs an opt-in, GUI-aware, post-convergence scenario check with bounded Planner re-check behavior, while keeping scenario evidence upstream of the plan-blind Acceptance Verifier.

Authored `usage-scenarios.md` is now preserved through Git Committer, Developer, Web GUI Specialist, Standalone Archiver, and MCP import/storage boundaries. Generated `scenario-coverage.md` remains derived evidence and is excluded from archival. Catalogs, generated persona targets, name mapping, overview metadata, manifests, context snapshots, GUI boundary documentation, and changelogs were reconciled.

## Metrics

- Work packages: 5 of 5 complete; all configured pipeline stages passed.
- Final cross-module QA reconciliation: 4,165 tests passed, 0 failed.
- MCP regression: 146 test files, 4,045 tests passed.
- Focused import/storage coverage: 3 test files, 120 tests passed.
- Persona build/freshness: 129 personas processed successfully; freshness checks passed.
- Production dependency audit after remediation: 0 vulnerabilities.
- Release metadata: personas `v3.32.0`; MCP server `v2.8.1`.
- Formatting, workflow-manifest, version-sync, build, and generated-output checks passed.

The root workspace test suite still reports 13 unrelated model-resolution/display-label failures recorded during earlier QA runs. They do not involve the changed persona, import, storage, or documentation paths and were intentionally left outside this plan.

## Strategic Recommendations

- Keep the authored-source versus generated-evidence distinction as a cross-boundary contract. The fixed MCP archive allowlist and explicit handoff wording prevent derived coverage reports from becoming project source.
- Preserve scenario verification after technical convergence and limit remediation to one Planner integration/re-check. This provides user-facing coverage without creating an unbounded second refinement loop.
- Consider deriving standalone catalog and overview persona counts from generated metadata instead of maintaining display counts manually.
- Harden optional `usage-scenarios.md` detection to distinguish `ENOENT` from permission and other filesystem errors for more precise diagnostics.
- Maintain the dependency-remediation pattern: the MCP SDK upgrade plus patched transitive overrides cleared the production audit while preserving the import contract.

## Deferred and Follow-Up Items

- **Deferred, WP-005, Planner/Project Manager decision:** Decide whether requester-authored goal scenarios belong in a future `request.md` bundle. The current contract intentionally supports plan-derived `usage-scenarios.md` only.
- **Follow-up, WP-002, QA:** Add a dedicated executable Plan Refiner scenario-phase test. Current validation is structural source/generated-output inspection and focused checks.
- **Follow-up, WP-003, QA/Reviewer:** Add executable coverage for persona handoff wording if the documentation-only boundaries become regression-sensitive.
- **Follow-up, WP-004, QA/Security/Reviewer:** Distinguish optional-file absence from non-ENOENT filesystem failures during discovery. Current behavior is non-exploitable under the same-directory contract.
- **Follow-up, WP-005, Reviewer/Release/Documentation:** Derive manually displayed persona counts from metadata to remove a recurring synchronization point.
- **Out of scope, project-level:** Triage the pre-existing 13 root test failures involving model display names and generated overview expectations. No changed file participates in those failures.

## Next Steps

1. Triage the unrelated root model-resolution regression in a separate work package.
2. Decide the future `request.md` bundle contract before adding requester-authored scenario support.
3. Add focused Plan Refiner scenario tests and optional-file error classification when maintenance capacity permits.

## Outcome

The plan is complete. The new curator, lifecycle integration, source preservation, MCP archival contract, security updates, generated outputs, and boundary documentation are all implemented and validated, with follow-up work explicitly separated from the delivered scope.