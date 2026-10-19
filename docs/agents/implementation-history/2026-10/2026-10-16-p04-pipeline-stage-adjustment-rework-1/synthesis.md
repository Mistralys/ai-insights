# Synthesis Report — P04 Pipeline Stage Adjustment, Rework 1

### Outcome Summary

This project closed out the deferred, out-of-scope, and rejected follow-up items carried over from the P04 pipeline stage adjustment plan across the `mcp-server`, root `scripts`, and `orchestrator` codebases. It introduced a registry-derived MCP tool registration system with completeness tests for both the startup log and schema coverage, filled four missing `TOOL_HELP` entries with a registry-derived coverage suite, pinned a previously untested `requirePmRole()` contract, and extracted a shared `applyPipelineStart` guard helper eliminating ~90 lines of duplicated start-guard logic between `startPipeline` and `beginWork`. It also replaced the destructive `ctx-generate` with a staged generate-and-swap implementation (never deletes `.context/` on failure) plus a real `--check` mode, fixed a halted-sweep double-cancellation bug in the orchestrator supervisor, derived the orchestrator's rework limit from the shared manifest instead of a stale hardcoded mirror, enforced the `live` pytest marker's documented default-skip behavior with a credential probe that turns an invalid API key into a clear skip instead of a raw 401 failure, and removed three stale hardcoded test-count mentions from documentation. All 12 work packages completed with a clean exit gate — full regression suites green across all three codebases, zero new failures against the WP-001 baseline, and the two previously-failing live-LLM tests now resolved (skip instead of fail) as an intended side effect of the live-gating work.

### Metrics

| Suite | Result |
|---|---|
| mcp-server (`npm test` / vitest) | 154 files / 4,307 tests passed, 0 failed |
| mcp-server `tsc --noEmit` | Clean (strict mode) |
| Root scripts (`npm test` / vitest) | 27 files / 461 tests passed, 0 failed |
| Orchestrator (`pytest tests/`) | 1,186 passed, 8 skipped, 0 failed |
| Orchestrator `ruff check` | Clean (2 pre-existing E501 findings outside this plan's diffs, unrelated) |
| `node scripts/check-version-sync.js` | Exit 0 |
| `node scripts/cli.js ctx-generate --check` | Exit 0 ("`.context/` is up to date") |
| `node scripts/build-personas.js --check` | Exit 0, 0 errors/warnings |

**Baseline comparison (WP-001 vs. WP-012 exit gate):** no new failures. The two orchestrator baseline failures (`test_developer_stage_live`, `test_pm_stage_live`, invalid-API-key 401s) are now resolved — they skip cleanly instead of failing, as an intended consequence of WP-010's live-test gating.

**Pipeline health:** 12/12 work packages passed every active pipeline stage (implementation, qa, security-audit where applicable, code-review, release-engineering/documentation). Zero blocking code-review findings and zero security findings across all audited WPs (WP-005, WP-007, WP-010).

**Blockers / Failures / Security Concerns:** None. No WP required rework, no pipeline failed, and no Critical/High/Medium security findings were raised.

### Strategic Recommendations

- **Recording-shim pattern for SDK interception** (WP-002, code-review, medium): casting a minimal object exposing only the needed method (e.g. `registerTool`) through `unknown` to the real SDK class is a clean way to observe calls to a third-party SDK without subclassing it or touching private fields. Reusable anywhere else in the codebase that needs to intercept a narrow slice of an SDK's API surface.
- **Minimal, compatibility-preserving bug fixes for in-flight downstream plans** (WP-009, code-review, medium): when fixing `supervisor.py`'s halted-sweep double-cancellation bug, the cancelled-ID tracking set's *scope* was widened without touching `_handle_rework_limit`'s name or signature, because a pending downstream plan (P05) locates that function by name and depends on its existing semantics. A pattern worth citing whenever a bug fix must not disturb a function another in-flight plan already depends on.
- **Staged generate-and-swap over destructive-then-validate** (WP-007): replacing "delete output, then validate/run" with "write to staging, validate, then atomically swap" is a general reliability pattern for any CLI step that regenerates tracked output — a failure at any point leaves the previous output intact, and a `--check` mode that reuses the identical generation path can never drift from the real run.

### Code Insights

**Developer (Implementation):**
- `mcp-server/src/tools/work-package-admin.ts`: the three PM-only tools apply their PM-role check and project-path resolution guards in different relative order (`ledger_reset_rework_count` resolves the project path before checking PM role; `ledger_reopen_cancelled_wp` and `ledger_update_pipeline_stages` check PM role first). This asymmetry exists in the source itself and was documented as-is per WP-003's instruction to record code/manifest disagreements rather than silently resolve them (medium priority decision).
- `mcp-server/src/utils/pipeline-start.ts`: the shared guard chain always runs the `IN_PROGRESS` status check even on `beginWork`'s call site (which only ever reaches it already-`IN_PROGRESS`), rather than adding a skip-flag parameter — kept simple since the extra check is harmless.
- `orchestrator/tests/test_integration.py`: a blind sed rename (`REWORK_LIMIT` → `MAX_REWORK_COUNT`) initially corrupted the unrelated `REVIEW_REWORK_LIMIT` action-name string literal (substring collision); caught by immediate re-grep and reverted.
- `orchestrator/tests/conftest.py`: the first draft of the live-test gating hooks checked `"live" in item.keywords`, which also matches test-ID/parametrize tokens, not just markers — false-positived on a test parametrized with the literal string "live". Fixed to `item.get_closest_marker("live") is not None`.

**Reviewer (Code Review):**
- `mcp-server/src/tools/registry.ts`: the recording-shim pattern (gold nugget, see Strategic Recommendations) is cited as reusable elsewhere in the codebase.
- `orchestrator/src/supervisor.py`: the `cancelled_this_iteration` scope-widening fix (gold nugget, see Strategic Recommendations) is cited as a pattern for compatibility-preserving bug fixes.
- `scripts/lib/ctx-generate.js`: a narrow double-fault edge case was noted in the swap-restore path (not blocking, flagged for awareness only — no further detail recorded beyond the flag itself).

**Release Engineer:**
- All three changelogs (`mcp-server` v2.14.0, `orchestrator` v1.6.0, root v2.17.0) were opened as new WIP entries one step above each module's prior unmarked head, since the last git tag (root v2.14.1) lagged two to three releases behind — tagging itself was left to the user, not performed as part of this plan.

### Deferred & Follow-Up Items

- **Source: WP-004 (pm-role-guard.test.ts) — Documentation agent (deferred).** `requirePmRole()` accepts only the exact string `'Project Manager'`, while `updateWorkPackageStatus` separately accepts `'Project Manager Agent'`. This asymmetry was deliberately pinned by a characterization test rather than resolved, per the plan's own note that it is "tracked as a future decision in the plan's Deferred Items." Rationale: resolving it would change production behavior, which was out of scope for a characterization-test WP.
- **Source: WP-003 (help-content.ts) — Developer (out-of-scope).** The three PM-only tools in `work-package-admin.ts` apply their PM-role-check and project-path-resolution guards in inconsistent relative order across tools; `api-surface.md`'s existing prose does not call this out either. Documented as the code's current behavior rather than normalized. Rationale: "the fix (if wanted) belongs to a scoped follow-up, not this documentation WP."
- **Source: WP-007 (ctx-generate.js) — Reviewer (follow-up, low priority).** A narrow double-fault edge case exists in the staged generate-and-swap's rollback path. Not blocking; flagged for awareness only, with no further detail recorded in the review comment.
- **Source: WP-012 (release-engineering) — Release Engineer (follow-up, informational).** The root git tag (v2.14.1) lags two to three releases behind the changelog heads across all three modules. Flagged for the user's awareness — tagging is a user action, not something this plan's agents perform.
- **Source: WP-008 (test_integration.py) — Developer (deferred, low priority, debt).** Two pre-existing `ruff` E501 (line-too-long) violations at lines 968–969 of `test_integration.py`, inside the live-test API-key skip guard, are unrelated to this WP's scope and were left as-is.

### Next Steps

- Decide whether to resolve the `requirePmRole()` / `updateWorkPackageStatus` role-string asymmetry (accept `'Project Manager Agent'` everywhere, or reject it everywhere) — currently pinned as a characterization test rather than fixed.
- Decide whether to normalize the PM-role-check vs. project-path-resolution guard ordering across the three PM-only tools in `work-package-admin.ts`, or formally document the asymmetry as intentional in `api-surface.md`.
- Investigate and, if warranted, fix the double-fault edge case flagged in `ctx-generate.js`'s swap-restore path.
- Tag the three modules (mcp-server v2.14.0, orchestrator v1.6.0, root v2.17.0) once ready to publish — the changelogs are WIP-complete but no git tags were cut as part of this plan.
- Clean up the two pre-existing `ruff` E501 violations in `orchestrator/tests/test_integration.py` lines 968–969 as routine debt, independent of any feature work.
- The Knowledge Archiver sub-agent dispatch tool was unavailable in this session (see AX Feedback below) — a manual Knowledge Archiver run against this plan folder is still pending.
