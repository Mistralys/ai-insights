# Plan

## Summary

Address the actionable items from the `2026-04-29-handoff-spec-compliance-followup`
synthesis: (1) add the missing `not.toBe('READY_FOR_SYNTHESIS')` symmetry guard to the
`cond-2 (timed)` Security Auditor regression test, (2) verify the freshly-regenerated
`.context/` snapshots are clean and consistent with the current source tree, and
(3) extend regression coverage of `partitionWpsAwaitingNextStage` to its three
under-tested edge-case dependency-chain scenarios (mixed-routing WAIT, last-stage
Synthesis routing, FAIL-at-next-stage re-routing). The `workflow-handoff.ts` split
remains DEFERRED per the WP-003 spike — this plan does not revisit that decision.

## Architectural Context

- **Test target file:** [mcp-server/tests/tools/workflow-handoff.test.ts](mcp-server/tests/tools/workflow-handoff.test.ts) —
  Vitest suite. The Security Auditor §5.2b describe block lives at lines 2780–2851
  (three tests: `cond-1`, `cond-2 (no timestamps)`, `cond-2 (timed)`).
- **Production helper under additional test:** `partitionWpsAwaitingNextStage` in
  [mcp-server/src/tools/workflow-handoff.ts](mcp-server/src/tools/workflow-handoff.ts#L360)
  (lines 360–402). It is a module-private helper, so tests exercise it indirectly
  through public handoff functions (`getReviewerHandoff`, `getQaHandoff`,
  `getSecurityAuditorHandoff`). Its three notable branches are:
  1. **Mixed-routing** (`nextAgents.size > 1`) → `nextStatus = null` → caller emits WAIT.
  2. **Last-stage** (`AGENT_PIPELINE_MAP[nextAgent]` undefined for Synthesis) → WP
     excluded from `awaiting`, leaving the all-terminal early-exit to handle it.
  3. **Dependency-chain** — `awaiting` WPs split into `ready` vs `blocked` via
     `isBlockedByDependencies`; only `ready` informs `nextStatus`.
- **CTX snapshots:** `.context/` is regenerated via `node scripts/cli.js ctx-generate`
  (now available on PATH). The user has already run this; we only need to confirm the
  output is clean and current via `git status .context/`.
- **Test fixtures used:** `makeWp`, `makeWpTimed`, `parseResult`, `FIVE_STAGES`, and
  `WorkPackageDetail` shape — all already imported at the top of the test file.

## Approach / Architecture

Three small, additive Work Packages, no production code changes:

1. **WP-001 — Symmetry guard:** Single-line edit inside the existing `cond-2 (timed)`
   test to add a negative-regression assertion mirroring the no-timestamp variant.
   Lowest-risk change; test-only.
2. **WP-002 — CTX snapshot verification:** Confirm `.context/` is fully regenerated and
   in-sync with the source tree. If `git status` reports changes, commit them as part
   of this WP. If clean, document the verification result in the WP notes. No code edits
   expected; observation-only.
3. **WP-003 — `partitionWpsAwaitingNextStage` edge-case coverage:** Add three new tests
   to `workflow-handoff.test.ts` exercising the three branches identified above. Tests
   route through public handoff functions per the existing testing pattern.

All changes land in a single patch-level MCP server release (v1.28.0 → v1.28.1).

## Rationale

- **Symmetry guard (WP-001):** Reviewer flagged in WP-001 of the previous sprint. The
  `cond-2 (timed)` test correctly asserts `READY_FOR_DEVELOPER` but is missing the
  negative-regression check. Cost is one line; benefit is symmetric branch protection
  against a future regression that flips the FAIL short-circuit to skip ahead to
  Synthesis.
- **CTX verification (WP-002):** Synthesis Recommendation #2 noted the prior sprint
  manually patched `.context/mcp-server/overview.md` because `ctx` was unavailable.
  Now that `ctx` is on PATH and the user has regenerated, a verification step closes
  the loop and ensures no manual patches drifted from the auto-generated output.
- **Edge-case coverage (WP-003):** Synthesis Recommendation #4(a). The mixed-routing
  guard, last-stage exclusion, and dependency-chain partitioning logic in
  `partitionWpsAwaitingNextStage` have only one indirect test each (via
  `getReviewerHandoff`). The function is consumed by three handoff resolvers and any
  regression silently misroutes WPs. Three targeted tests give the helper full branch
  coverage at low cost.
- **Why not split `workflow-handoff.ts`?** WP-003 of the previous sprint produced a
  decision memo recommending DEFER ([discussions/2026-04-29-workflow-handoff-split.md](discussions/2026-04-29-workflow-handoff-split.md)).
  The conditions for revisiting (file > ~1500 lines, independent versioning need,
  ESM directory-index support) have not changed. Out of scope here.

## Detailed Steps

### Phase 1 — WP-001: Symmetry guard

1. Open [mcp-server/tests/tools/workflow-handoff.test.ts](mcp-server/tests/tools/workflow-handoff.test.ts)
   and locate the `cond-2 (timed)` test at line 2836.
2. After the existing `expect(result.status).toBe('READY_FOR_DEVELOPER');` assertion,
   add:
   ```ts
   expect(result.status).not.toBe('READY_FOR_SYNTHESIS');
   ```
3. Run `npm test -- workflow-handoff.test.ts` from `mcp-server/` and confirm the test
   still passes (test count unchanged at 176; assertion count +1).

### Phase 2 — WP-002: CTX snapshot verification

1. From the workspace root, run `git status .context/` and capture the output.
2. If the output reports modified or untracked files: stage them
   (`git add .context/`), confirm the diff makes sense (auto-generated content only —
   no spurious manual edits), and include the changes in the WP commit. Note in the
   WP synthesis whether the prior sprint's manual patch to
   `.context/mcp-server/overview.md` is now superseded by the regenerated content.
3. If the output is clean: document in the WP notes that `.context/` is verified
   in-sync with the source tree, with no action required.
4. Run `node scripts/cli.js ctx-generate` once more to double-check idempotency, then
   re-check `git status .context/` to confirm no further drift.

### Phase 3 — WP-003: `partitionWpsAwaitingNextStage` edge-case coverage

Add a new top-level `describe('partitionWpsAwaitingNextStage edge cases (indirect via handoff resolvers)', ...)` block at the end of `workflow-handoff.test.ts` containing three tests:

1. **Mixed-routing → WAIT:** Two WPs both PASS code-review, but their
   `active_pipeline_stages` route them to different next agents (one to
   `documentation`, one to `release-engineering`). Call `getReviewerHandoff` and assert
   the result is a WAIT with status not equal to any single `READY_FOR_*` value, and
   that the `details` message names the heterogeneous next-agent set (per the
   mixed-routing safety rule documented at workflow-handoff.ts L344–L351).
2. **Last-stage Synthesis routing:** A single WP whose `active_pipeline_stages` ends at
   the current resolver's stage (e.g., `code-review` is the last active stage). The WP
   has PASSed `code-review`. The resolver's call to `partitionWpsAwaitingNextStage`
   excludes the WP from `awaiting` (because `AGENT_PIPELINE_MAP['Synthesis']` is
   undefined). Combined with all other WPs being terminal, the result is
   `READY_FOR_SYNTHESIS`. (If a single all-terminal WP cannot reach this branch via the
   public API, document the limitation and use the smallest fixture that does.)
3. **FAIL-at-next-stage re-routing:** A WP has PASSed `code-review` and has a `FAIL`
   pipeline at `documentation`. Per the helper's filter
   (`!wp.pipelines.some((p) => p.type === nextStage && p.status === 'PASS')`), the WP
   is still considered "awaiting" — the upstream caller routes it to Documentation
   again. Assert the resolver returns `READY_FOR_DOCUMENTATION` and includes the WP in
   the routed set. This is the one branch most likely to regress silently if someone
   "fixes" the helper to also exclude FAIL pipelines.

For each test:
- Use `makeWp` (no timestamps required for these branches).
- Set `active_pipeline_stages` explicitly to disambiguate routing.
- Use `parseResult(getReviewerHandoff(wpDetails))` (or the appropriate resolver) and
  assert against `result.status`, `result.next_agent`, and `result.details` as
  applicable.

After adding the tests:
- Run `npm test` from `mcp-server/` and confirm 179 tests pass (176 → 179, +3).
- Run `npm run typecheck` to confirm no TypeScript regressions.

### Phase 4 — Release coordination (handled by Release Engineer agent)

1. Bump `mcp-server/package.json` version 1.28.0 → 1.28.1 (patch — test-only changes).
2. Add a single consolidated entry to `mcp-server/changelog.md` covering all three WPs.
3. Add a root-level entry to `changelog.md` referencing `> mcp v1.28.1`.
4. Verify `node scripts/check-version-sync.js` exits 0.

## Dependencies

- WP-001, WP-002, WP-003 are mutually independent and may be executed in parallel.
- WP-004 (release/changelog) depends on WP-001 + WP-002 + WP-003 all reaching PASS.

## Required Components

**Modified files:**
- [mcp-server/tests/tools/workflow-handoff.test.ts](mcp-server/tests/tools/workflow-handoff.test.ts) — WP-001 (1-line edit), WP-003 (~3 new tests, ~80–120 lines)
- [mcp-server/changelog.md](mcp-server/changelog.md) — WP-004 (new v1.28.1 entry)
- [mcp-server/package.json](mcp-server/package.json) — WP-004 (version bump)
- [changelog.md](changelog.md) — WP-004 (new root entry)

**Possibly modified files (depending on `git status .context/` outcome):**
- `.context/**` — WP-002 (auto-regenerated content, if any drift exists)

**No production source files (`mcp-server/src/**`) are modified by this plan.**

## Assumptions

- `partitionWpsAwaitingNextStage` remains a module-private helper; tests exercise it
  indirectly through `getReviewerHandoff` (and other resolvers as needed). The previous
  sprint established this testing pattern.
- The current MCP server test count is 176 (per the parent synthesis). After this plan,
  the count becomes 179 (+3 from WP-003; WP-001 adds an assertion, not a test).
- `ctx generate` produces deterministic, idempotent output. Running it twice in a row
  yields the same files.
- The prior sprint's manual patch to `.context/mcp-server/overview.md` either matches
  what `ctx generate` now produces, or is superseded by the new content. WP-002
  confirms this empirically.
- The mixed-routing test fixture (WP-003 step 1) can be constructed using existing
  pipeline-types in `active_pipeline_stages` without introducing new mocks.

## Constraints

- **No production code changes.** This is a test-and-documentation sprint mirroring the
  prior follow-up's discipline.
- **Patch-level version bump only** (1.28.0 → 1.28.1). No API surface changes.
- **No revisit of the `workflow-handoff.ts` split.** Out of scope per the WP-003 DEFER
  decision.
- All new tests must follow the existing file's conventions (Vitest, `describe`/`it`,
  `parseResult`, `makeWp`/`makeWpTimed` helpers).

## Out of Scope

- Splitting `workflow-handoff.ts` into smaller modules (DEFERRED per
  [discussions/2026-04-29-workflow-handoff-split.md](discussions/2026-04-29-workflow-handoff-split.md)).
- Any changes to handoff routing logic (production code).
- Refactoring of test helpers (`makeWp`, `makeWpTimed`).
- Coverage of `hasNewUpstreamPassSince`, `hasPassedDynamicUpstream`, or any other
  helper not named in Recommendation #4(a).
- New persona, manifest, or workflow-spec changes.

## Acceptance Criteria

- WP-001: `cond-2 (timed)` test contains the
  `expect(result.status).not.toBe('READY_FOR_SYNTHESIS')` assertion. Test passes.
- WP-002: `git status .context/` is clean after running `node scripts/cli.js ctx-generate`
  twice consecutively. Any drift discovered is committed with a clear message
  ("WP-002: regenerate CTX snapshots"). Verification result is recorded in the WP notes.
- WP-003: Three new tests exist in `workflow-handoff.test.ts`, one per edge case
  (mixed-routing, last-stage Synthesis, FAIL-at-next-stage). Total test count is 179.
  All tests pass. `npm run typecheck` passes.
- WP-004: `mcp-server/package.json` version is `1.28.1`. `mcp-server/changelog.md`
  contains a v1.28.1 entry summarizing all three WPs in house style.
  `changelog.md` (root) contains a new entry referencing `> mcp v1.28.1`.
  `node scripts/check-version-sync.js` exits 0.
- Whole plan: full `npm test` from `mcp-server/` reports 179 passing, 0 failing.
  Workspace `node scripts/validate-workflow-manifest.js` exits 0 (sanity check; no
  manifest changes expected).

## Testing Strategy

- **Unit-level (WP-001, WP-003):** Vitest in `mcp-server/`. All new tests must run via
  `npm test` and pass. Each new test asserts the specific branch it targets and, where
  meaningful, includes a negative-regression guard (`not.toBe(...)`).
- **Snapshot verification (WP-002):** Empirical via `git status .context/`. No
  automated test added; result documented in the WP notes.
- **Release verification (WP-004):** `node scripts/check-version-sync.js` and a manual
  read-through of both changelog entries by the Release Engineer.
- **Whole-suite regression:** Final `npm test` from `mcp-server/` must report 179
  passing, 0 failing, 0 skipped (modulo any pre-existing skips).

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **WP-003 mixed-routing test cannot be constructed without exposing the private helper.** | Use two WPs with carefully chosen `active_pipeline_stages` (e.g. one ending in `documentation`, one in `release-engineering` after a shared `code-review`). The existing `getReviewerHandoff` test pattern at lines ~1700–1830 already exercises this routing surface. If it proves infeasible, downgrade WP-003 to two tests + a documented inability, and capture the gap as a future Researcher task. |
| **WP-003 last-stage test conflates with the `READY_FOR_SYNTHESIS` early-exit.** | The early-exit checks _all_ WPs being terminal. The last-stage branch within `partitionWpsAwaitingNextStage` is reached when at least one WP is still in-flight at the current stage AND another has just PASSed its last stage. Use a 2-WP fixture: WP-A is mid-flight at `code-review`; WP-B has PASSed `code-review` as its last active stage. Assert WP-B does not appear in the `ready` partition (indirectly: `getReviewerHandoff` returns WAIT, not `READY_FOR_SYNTHESIS`). |
| **CTX regeneration produces large diffs unrelated to source changes.** | If `git status .context/` reveals widespread churn, pause WP-002 and investigate whether `ctx generate` configuration has drifted. Do not blindly commit — file a CTX Architect review as a follow-up if the diff cannot be explained by the prior sprint's source changes. |
| **A new test in WP-003 accidentally passes for the wrong reason** (e.g. matches a different branch in the resolver). | Mitigate by adding a `details` substring assertion that is unique to the targeted branch (e.g., the mixed-routing message naming the conflicting agents). The existing tests at lines 1700–2055 use this pattern. |
| **Version-sync script fails after WP-004 bump.** | Run `npm run sync-version` from `mcp-server/` per the standard release flow; this regenerates `package.json` from the changelog. If the script is missing, fall back to manual edit + `node scripts/check-version-sync.js` to confirm. |

AGENT: Planning
STATUS: READY_FOR_PM
