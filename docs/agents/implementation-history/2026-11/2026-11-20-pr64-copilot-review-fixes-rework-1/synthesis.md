# Synthesis Report — PR64 Copilot Review Fixes - Rework 1

### Outcome Summary

This plan reworked a prior PR's review-fixes synthesis across 9 work packages, all completed and verified. It consolidated five duplicated `isNodeError` guards and two diverging provider-data-dir helpers into shared utilities, gave `atomicWriteJson` a per-call unique temp path and `withLock` a test-only fast-retry seam (cutting `tests/error-codes/` wall-clock time from 57.24s to ~1.75s), added value-free GUI validation error messages and a config-salvage warning banner, and replaced the Configuration tab's hand-written tab lists with a `CONFIG_TABS` descriptor registry with per-module visit tokens to prevent stale-response corruption. A full-suite verification gate (WP-008) confirmed no new regressions against a merge-base baseline, and documentation/changelog updates (WP-009) were applied across both the mcp-server and GUI manifests with no behaviour claim lost.

### Metrics

- **Work packages:** 9/9 COMPLETE (41 pipeline stages passed across all WPs: implementation, qa, security-audit (WP-005, WP-006 only), code-review, release-engineering (WP-009 only), documentation).
- **Tests:** Final full regression runs consistently green — 169 files / 4654 tests passing (WP-008's gate), 0 failures across every QA and code-review pass in all 9 WPs.
- **Security audits:** 2 run (WP-005, WP-006), both PASS with 0 Critical/High/Medium findings.
- **Code review:** 9/9 PASS, 0 Blocking issues across the entire plan; 1 Documentation-Forward item raised (WP-007, resolved same-WP by Documentation).
- **Performance win:** `tests/error-codes/` suite wall-clock reduced from 57.24s to ~1.75–1.93s via the WP-003 fast-lock test seam (33x speedup), reproduced independently by QA, code-review, and WP-008's gate run.
- **Verification gate (WP-008):** `tsc --noEmit`, `npm run build`, and two consecutive full `vitest run` passes all green (4654 tests); baseline comparison run from a temporary worktree at merge-base `d2982adc` (4223 tests, 0 failures) confirmed no new failures introduced by the plan.

### Strategic Recommendations

- **In-process test seams over environment variables for production-code timing knobs** (WP-003): the `withLock` fast-lock seam (`__setLockRetryForTesting`/`__resetLockOptionsForTesting`) is an in-process setter invoked via a CLI flag to worker processes, deliberately avoiding any environment-variable read in production code — eliminating the risk of a stray env var weakening production locking. Code review flagged this as a reusable template for future slow-legacy-code test work. The same pattern was reused in WP-008 for `pendingSelfHeals`/`__awaitPendingSelfHealsForTesting`.
- **Characterization-first discipline for legacy code** (WP-003): `withLock` had no dedicated test file; characterization tests pinning existing behaviour were written before any production change, per the project's AGENTS.md Decision Matrix — a pattern worth repeating whenever touching untested legacy modules.
- **Fix at the cause, not the symptom** (WP-008): rather than adding `rm(..., { maxRetries })` to mask an `ENOTEMPTY` teardown race, the plan tracked the actual untracked fire-and-forget write, removing the race's root cause and the five timing-dependent `setTimeout` sleeps that depended on it.
- **Single-sanitization-rule pattern for warning text** (WP-006): `readErrorCodeConfig()` and `loadErrorCodeConfig()` share one sanitization rule (field paths only, fixed reason strings, never a value or raw parser message), eliminating any risk of the stderr and GUI warning texts drifting apart — flagged as a gold-nugget by code review.
- **Descriptor-registry over duplicated dispatch lists** (WP-007): `CONFIG_TABS` replaced three hand-written tab lists in `config.js` with one array of `{ key, label, render, leave, reset }` descriptors — adding a sixth tab now means one descriptor instead of three edit sites, and a test now fails if a `config-*.js` module is missing from the registry.

### Code Insights

**Developer:**
- WP-001: Kept the strictest original `isNodeError` body (`typeof err.code === 'string'`) rather than the weaker `'code' in err` check used by four of the five original copies; `gui/api.ts`'s two-code OR call sites kept `isNodeError` narrowing directly since `hasErrorCode` only covers a single code.
- WP-004: Renaming the import surfaced hard-coded `vi.mock` factory export lists in two test files that silently broke when the new `resolveErrorCodeProviderDataDir` export wasn't added to the mock — flagged as a recurring trap for future additions to `store-registry.ts`.
- WP-007: Fixed dead code uncovered while writing `csResetState()` — `config.js`'s old code guarded a `csCloseModal` function that was never defined in `config-stores.js`.
- WP-008: Consolidated two separate self-heal writes (`duration_ms`/`active_ms`+`pipeline_runs`) into one `selfHealUpdates` object flushed in a single `writeProjectMeta()` call, additionally fixing a two-write race beyond the WP's stated scope.

**QA:**
- WP-005: AC-07 (the `temporary_prefix` validation message) was only verified manually in-session, not pinned by a committed test; recommended adding an integration-style assertion against the real schema.
- WP-008: No test directly forces `store.writeProjectMeta` to reject to empirically prove `pendingSelfHeals` cleans up on a failed write — correctness is proven only by code inspection of the `.finally()` chain; recommended a dedicated failure-injection test.
- WP-008: `pendingSelfHeals` is a module-level singleton; safe under Vitest's current file-level isolation, but future concurrent tests in the same file that skip the await between `handleGetProject` calls could see cross-test write leakage.

**Reviewer:**
- WP-004: Hard-coded `vi.mock` factory export lists for `store-registry.ts` are a recurring trap for future additions to that module (project-level observation).
- WP-006: `handleUpdateErrorCodeConfig`'s PUT response never carries a `warning` (an implicit contract the GUI's clear-after-save logic depends on) — not independently pinned by a server-side test today; flagged for awareness, not blocking.
- WP-007: `constraints.md` §25 described tab reset as running "unconditionally" on every switch — no longer accurate for Model Registry/Persona Models' `leave(discarded)` contract (raised as documentation-forward, resolved same-WP).

**Documentation:**
- WP-005: Found and fixed a stale GUI `api-surface.md` claim (§1.9) that the validation error body carries only a generic message — directly contradicted the new `describeZodIssues()` behaviour.
- WP-006: Found a GUI `data-flows.md` section opening with "Backend-only as of this revision... introduced by a later WP" that was already false and self-contradictory within the same section.
- WP-007: Found `file-tree.md`/`api-surface.md` config descriptions that predated the entire refactor (zero mention of `CONFIG_TABS`), not reviewer-flagged — found via a proactive search for every changed symbol.
- WP-009: Restructured the API reference's Error-Code Provider Contract section into bullet lists and dropped in-section WP-provenance tags while verifying claim-by-claim that no behaviour claim was lost; found four new test files never declared in `file-tree.md` (`server-error-mapping.test.ts`, `api-error-codes.test.ts`, `config-error-codes-view.test.ts`, `config-tabs.test.ts`); documented a previously undocumented Configuration tab-switch data flow through `CONFIG_TABS`/`configFindTab()`.

### Deferred & Follow-Up Items

- **Deferred — AC-07 integration test** (WP-005, QA, low priority): add a committed integration-style assertion in `tests/gui/api-error-codes.test.ts` tying the `temporary_prefix` validation message to the real schema, rather than relying on the manual QA check performed in this session.
- **Deferred — self-heal failure-injection test** (WP-008, QA, medium priority): add a test that forces `store.writeProjectMeta` to reject, asserting `pendingSelfHeals` returns to size 0 — current correctness relies on code inspection only.
- **Deferred — `pendingSelfHeals` singleton isolation note** (WP-008, QA, low priority): add an explanatory comment in `gui/api.ts` warning future test authors that concurrent tests in the same file must await `__awaitPendingSelfHealsForTesting()` between `handleGetProject` calls to avoid cross-test write leakage.
- **Deferred — `handleUpdateErrorCodeConfig` warning-omission contract test** (WP-006, Reviewer, low priority): the PUT response's implicit "never carries a warning" contract (which the GUI's clear-after-save logic depends on) is not independently pinned by a server-side test.
- **Out-of-scope — WP-003 true before/after timing baseline** (WP-008, Developer, low priority): `tests/error-codes/` did not exist at the plan's merge-base, so a genuine pre-WP-003 wall-clock baseline is unreachable via git history in this session; only the post-change duration (~1.93s) could be captured. Future timing-sensitive WPs should capture a baseline immediately before their own change lands.
- **Out-of-scope — changelog bullet consolidation** (WP-009, Release Engineer, low priority): the new Configuration-tab-wide stale-response guard bullet sits close to the pre-existing Error-Codes-tab-specific save-guard bullet in `changelog.md` (line 23 vs. 22) — two related but distinct mechanisms; flagged as worth consolidating in a future changelog rewrite pass.

### Next Steps

- Consider a small follow-up WP to add the two deferred QA test-coverage items (AC-07 integration test, self-heal failure-injection test) before they are forgotten in a future unrelated rework cycle.
- When planning the next feature touching `store-registry.ts`, flag the hard-coded `vi.mock` factory export list pattern in `tests/tools/error-codes.test.ts` and `tests/gui/api-error-codes.test.ts` as a known trap.
- The `withLock` fast-lock test seam and `pendingSelfHeals` self-heal tracking seam are now documented reusable patterns (`constraints-testing.md`) — apply the same in-process-setter approach to any future slow or fire-and-forget production code that needs a deterministic test hook.
- No unfinished work packages remain; the plan is fully COMPLETE and ready for ledger finalization.
