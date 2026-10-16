# Synthesis Report — P04 Pipeline Stage Adjustment

### Outcome Summary

This project added a PM-only `ledger_update_pipeline_stages` MCP tool, backed by seven ordered guards (role, structural validation, CANCELLED, COMPLETE, no-running-pipeline, no-removal-of-executed-stage, assigned_to clean-up), so a work package's mis-transcribed stage list can be corrected in place instead of requiring cancel-and-recreate. The workflow specification, the `work-package.ts` module (split into a dedicated `work-package-admin.ts` with a shared `requirePmRole()` guard), and the mcp-server project manifest were all updated ahead of or alongside the tool, and the Ledger Bootstrapper, Project Manager, and Ledger Doctor personas were updated to use it — closing the root cause with a post-registration stage-parity check and a drift-diagnosis repair recipe. All generated artefacts (persona builds, `.context/`, `docs/agents-overview.md`) were rebuilt and an exit-gate regression check against a merge-base baseline showed no new failures (150 test files / 4264 tests, up from a 146/4221 baseline). All ten work packages completed; changelogs and versions were bumped across mcp-server (v2.13.0), personas (v3.39.0), and the root workspace (v2.16.0).

### Metrics

- **Work packages:** 10/10 COMPLETE, 0 blocked, 0 cancelled.
- **Pipeline stages run:** 29 total across all WPs, all PASS (0 FAIL/rework cycles recorded).
- **Test suite:** mcp-server full regression grew from 4237 → 4264 tests (150 files), 0 failures throughout the project. Baseline-vs-current exit gate (WP-009) confirmed no new failures relative to the pre-project merge-base (146 files/4221 tests).
- **Security audits:** 2 (WP-002 PM role guard extraction, WP-004 new tool) — both PASS, 0 issues.
- **Code reviews:** 4 (WP-001, WP-002, WP-003, WP-004, WP-009) — all PASS, 0 blocking issues.
- **Static analysis:** `tsc --noEmit` clean throughout.
- **Build/persona freshness:** `build-personas.js --check` — 0 errors/0 warnings (130 processed, 2 skipped); `check-version-sync.js` passes.

### Strategic Recommendations

- The exit gate originally planned for WP-004 was deliberately relocated to WP-009 during the plan's consistency pass to avoid a dependency cycle (WP-005–WP-008 each depend on WP-004's tool existing). This pattern — hosting a cross-cutting regression gate on the last WP still carrying authoring work rather than on the WP that introduces the capability being gated — is a reusable sequencing technique for future plans with a similar fan-out dependency shape.
- `scripts/cli.js ctx-generate` has no non-destructive `--check`/dry-run mode, and its clean step runs *before* argument parsing, so any invalid flag (including a plausible-sounding `--check`) wipes `.context/` before erroring. This bit both QA and a prior WP's documentation pipeline. Recommend adding a real `--check` flag to this script, or at minimum reordering clean-then-validate so flag errors surface before destructive side effects.
- The precedent set here (replace whole-array-of-stages rather than add/remove operations, PM-only gating matching existing admin tools, explicit reopen-then-restage over an auto-reopening flag) is documented in spec §12.3c/§21.75 and is a reusable template for any future "administrative correction" tool that touches ledger state outside the normal pipeline flow.

### Code Insights

**Developer**
- `pm-role-guard.ts`: `requirePmRole()` returns `null` on success (not a sentinel string/boolean), matching the existing early-return idiom in the codebase.
- `work-package.ts`: each guard's call-site position relative to `resolveProjectPath` was preserved exactly as found rather than normalized, since reordering was out of scope and nothing depends on uniformity.
- `work-package-admin.ts`: `propagateDependencyReblock` was exported and imported rather than duplicated — the only shared logic between the admin module and the main module.
- `tests/tools/schema-integrity.test.ts` hardcodes its own `beforeAll()` list of per-module `register()` calls, separate from `index.ts`'s registration list — a moved/added tool can silently drop out of schema coverage unless this file is updated by hand too. Flagged as a convention risk for future module splits.
- Guard 4 (COMPLETE) is deliberately checked ahead of guard 6 (stage removal) so a COMPLETE WP always reports the reopen message, even when its requested list also removes an already-passed stage (verified by a dedicated ordering test, AC-09).

**QA**
- `pm-role-guard.ts` has no dedicated unit test file; its contract is only exercised indirectly via the three tool call-site tests in `work-package.test.ts` — a coverage gap carried forward (low priority) but not actioned in this plan.
- `scripts/cli.js ctx-generate`'s destructive `--check` behavior (see Strategic Recommendations) was independently rediscovered during WP-009 verification.

**Security Auditor**
- Both audited changes (PM role guard extraction, new tool) confirmed byte-for-byte/behavior-equivalent against pre-change state where applicable; no new dependencies, no new input surface beyond already-validated schema fields, no PII/secrets/crypto/logging/network changes.
- Noted for awareness, not actionable in this plan: `agent_role` across all PM-only tools is a self-declared string with no independent identity check — an established, repo-wide trust model predating this plan, not introduced by it.

**Reviewer**
- Confirmed guard ordering, registration, and documentation are all internally consistent across the new tool's seven files; no Fix-Forward or Documentation-Forward items raised in any of the four code-review passes.

**Documentation**
- `api-surface.md` never documented `reopenCancelledWp` in the `work-package.ts` `_internal` section even pre-split — a pre-existing gap, now folded into the new `work-package-admin.ts` section as part of the WP-003 documentation pass.
- Two stale spec/manifest statements were found and corrected while documenting the new mutation rule: the "no tool ever changes `active_pipeline_stages` after creation" claim, and the pre-v2.6.0 legacy-chain "not migrated" claim — both now point to the new repair path.

### Deferred & Follow-Up Items

- **Source: WP-004 (carried through QA, Security, Reviewer, and Documentation pipelines). Originating agent: Developer, reaffirmed by QA/Security/Reviewer/Documentation. Out-of-scope (not deferred — explicitly excluded from WP-004's declared scope).** The three pre-existing PM-only tools (`ledger_reset_rework_count`, `ledger_reopen_cancelled_wp`, `ledger_update_acceptance_criteria`) now have `help-content.ts` overview-table rows (added in WP-004) but still lack dedicated `TOOL_HELP` body entries at the detail level other tools get. Every downstream pipeline in WP-004 re-flagged this as "worth a small follow-up WP" — it was never picked up by a WP in this plan.
- **Source: project-level (QA incident during WP-009). Originating agent: QA. Out-of-scope / tooling gap, not a plan deliverable.** `scripts/cli.js ctx-generate` has no non-destructive `--check` mode; its clean step runs before flag-parsing, so an unrecognized flag like `--check` deletes `.context/` before erroring. QA's note: "Future QA/Dev runs should only ever invoke it without `--check` and rely on git diff to verify freshness." No code fix was made in this plan; recommend a follow-up to add a true check mode or reorder validation-before-clean.
- **Source: WP-002 (QA/Documentation). Originating agent: QA, reaffirmed by Documentation. Low-priority coverage gap.** `pm-role-guard.ts` has no dedicated unit test file; its contract is only exercised indirectly through the three call-site tests in `work-package.test.ts`.
- **Source: WP-009 (Reviewer). Visibility-only, no action taken.** An unrelated working-tree deletion of `docs/agents/plans/2026-09-22-p04-pipeline-stage-adjustment/*.md` was observed — appears to be leftover from this plan's folder rename to the `2026-10-15` date prefix, not introduced by any WP-009 pipeline. Flagged for awareness; no follow-up action was identified as necessary.

### Next Steps

- Consider a small, low-complexity follow-up WP to add full `TOOL_HELP` body entries in `help-content.ts` for the three pre-existing PM-only tools (`ledger_reset_rework_count`, `ledger_reopen_cancelled_wp`, `ledger_update_acceptance_criteria`), matching the detail level the new `ledger_update_pipeline_stages` entry now sets as the bar.
- Consider fixing `scripts/cli.js ctx-generate` so an invalid/unsupported flag (e.g. `--check`) cannot trigger a destructive clean before the argument-parsing error surfaces; either add a genuine non-destructive check mode or reorder validation ahead of the clean step.
- Consider adding a dedicated unit test file for `pm-role-guard.ts` rather than relying solely on indirect coverage through the three call-site tests.
- Verify that the stale `docs/agents/plans/2026-09-22-p04-pipeline-stage-adjustment/` folder deletion noted during WP-009 review is intentional (folder rename cleanup) and not an accidental loss of plan history; no action needed if confirmed intentional.
- Knowledge Archiver delegation did not run in this session (see AX Feedback below) — a manual Knowledge Archiver pass against this plan folder is recommended to capture the reusable sequencing/documentation patterns noted under Strategic Recommendations.
