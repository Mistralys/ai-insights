# Synthesis Report — P04 Pipeline Stage Adjustment, Rework 2

### Outcome Summary

This plan closed out the actionable, non-authorisation follow-up items from the P04 rework-1 synthesis across the `mcp-server`, root `scripts`, and `orchestrator` modules. It unified the PM-only tool guard order in `work-package-admin.ts` so all four guarded tools reject a non-PM caller before any disk access, made `ctx-generate`'s failure reporting derive state from observed disk reality rather than a fallible helper's self-report, cleared all 22 pre-existing `ruff` findings in `orchestrator/tests/` and widened both CI and the pre-commit hook to lint `tests/` alongside `src/`, and added a new `root-scripts-tests` CI job (discovering through a live clean-copy rehearsal that it also needed an `mcp-server` install step). All six work packages passed every active pipeline stage with zero new failures against the pre-change baseline, and the exit gate (WP-006) confirmed the full mcp-server, root scripts, and orchestrator suites, the widened ruff check, persona build check, and `ctx-generate --check` all pass cleanly.

### Metrics

| Suite / Check | Baseline (WP-001) | Final (WP-006 exit gate) |
|---|---|---|
| mcp-server test suite | 154 files / 4307 tests, 0 failing | 155 files / 4326 tests, 0 failing |
| Root scripts suite | 27 files / 461 tests, 0 failing | 27 files / 483 tests, 0 failing |
| Orchestrator suite | 1186 passed / 8 skipped, 0 failing | 1186 passed / 8 skipped, 0 failing (exact match) |
| Orchestrator `ruff check src/ tests/` | 22 findings | 0 findings |
| `npx tsc --noEmit` (mcp-server) | — | Clean |
| `node scripts/build-personas.js --check` | — | Exit 0, clean |
| `node scripts/cli.js ctx-generate --check` | — | Exit 0, up to date |
| `node scripts/check-version-sync.js` | — | Passes (all 3 modules UNRELEASED, in sync) |

Security audit (WP-002): 0 Critical/High/Medium findings. Code review across all WPs: 0 Blocking, 0 Fix-Forward, 0 Documentation-Forward findings in every pass.

### Strategic Recommendations

- **Observation over self-report for failure classification (WP-003):** `classifySwapFailure()` derives `previousOutput` from what `fs.existsSync` actually observes on disk after a failing branch's own cleanup, never from the failing rename's own reported result. Code Review flagged this as a gold-nugget pattern worth reusing anywhere a result needs to be trustworthy under partial failure — a component's self-reported outcome is not proof of its effect on shared state.
- **Clean-copy rehearsal before adding a CI job (WP-005):** Rather than assuming the plan's baseline install steps (`root npm ci`, `personas npm ci`) were sufficient, the Developer and QA independently rehearsed the new job's exact command list against a fresh `git ls-files -co --exclude-standard` copy of the tree. This surfaced a real, non-obvious dependency (`backfill-duration.test.js` triggers an `mcp-server/dist` rebuild via `tsc`, requiring `mcp-server/node_modules`) that reading the test file alone would not have revealed. Code Review recommended this rehearsal-driven discovery pattern be repeated for future CI job additions.
- **Unwrap multi-line changelog bullets before measuring line length (WP-006):** The Changelog Curator found that several `mcp-server/changelog.md` bullets looked house-style-compliant on a quick visual scan (each physical/wrapped line under 100 chars) but ran 118–159 chars once unwrapped into a single sentence. Future changelog reviews should unwrap bullets before checking length rather than eyeballing wrapped text.
- **Derived-completeness tests over hand-maintained lists (WP-002):** `pm-only-guard-order.test.ts` scans `mcp-server/src/tools/` for any binding imported from `pm-role-guard` (including aliased imports and multi-line calls) and cross-checks it against a table, with a non-vacuity assertion. This keeps the completeness check honest as new guarded tools are added, rather than drifting the way a hand-maintained list or a literal-text scan for `requirePmRole(` would.

### Code Insights

**Developer (Implementation):**
- `work-package-admin.ts` / `help-content.ts` (WP-002): guard reorder left rejection text byte-identical; only the call-site position and an explanatory comment changed.
- `ctx-generate.js` (WP-003): check-mode gating uses a conditional skip (`mode !== 'check' && ...`) rather than an early return, so the shared incoming-directory cleanup logic isn't duplicated between `generate` and `check` modes.
- `.githooks/pre-commit` (WP-004): widened to `grep -E` matching `orchestrator/(src|tests)/.*\.py$`, verified against the plan's exact simulated staged-file list (selects exactly the 3 expected paths out of 7 candidates).
- `.github/workflows/ci.yml` (WP-005): the new `root-scripts-tests` job's install order (root → personas → mcp-server → `npm test`) was fixed only after the clean-copy rehearsal exposed the missing `mcp-server` dependency.

**Security Auditor (WP-002):** Confirmed via direct source read that all four PM-only tools now share guard-first order; the new completeness scanner's regex logic (handles aliased imports and multi-line calls) was reviewed and found sound — itself a security-relevant regression guard against a future tool being added without the guard-first placement.

**Release Engineer (WP-004, WP-005, WP-006):** No version bump beyond the already-open WIP entries on any of the three modules (root v2.17.0, mcp-server v2.14.0, orchestrator v1.6.0) — every change in this plan was judged internal/tooling-level, below the minor-level scope the WIP entries already carried from the original P04 plan and its rework-1 pass.

### Deferred & Follow-Up Items

- **Source:** Project-level (noted in the plan's own context, `project_summary`).
  **Originating agent:** Planner (prior to this execution cycle).
  **Description:** Two authorisation-related follow-up items from the P04 rework-1 synthesis were explicitly split off into their own separate plans at the user's request, rather than being included in this plan's scope.
  **Classification:** Out-of-scope for this plan — tracked separately, not lost.

No other deferred, out-of-scope, or follow-up items were recorded in any WP's implementation, QA, security-audit, code-review, release-engineering, or documentation pipeline comments; every WP's "Follow-Up Items" sub-section in its implementation summary reported "None."

### Next Steps

- Locate and confirm the status of the two separate authorisation-related plans split off from P04 rework-1 (see Deferred & Follow-Up Items above) — these remain open threads outside this plan's boundary and should be checked by the Planner for the next cycle.
- Apply the Changelog Curator's "unwrap before measuring" house-style check as a standing habit in future changelog reviews across all modules.
- Consider whether the clean-copy rehearsal practice used in WP-005 should become a standard step whenever a new CI job is added, given how it surfaced a real hidden dependency that static reading missed.
