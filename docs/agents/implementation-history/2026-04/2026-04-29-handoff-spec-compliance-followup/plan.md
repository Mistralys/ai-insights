# Plan

## Summary

Address all actionable items from the synthesis of plan
`2026-04-29-handoff-spec-compliance` (see
[../2026-04-29-handoff-spec-compliance/synthesis.md](../2026-04-29-handoff-spec-compliance/synthesis.md)).
Close the remaining unit-test gaps for `getSecurityAuditorHandoff` (cond-1 /
cond-2) and `getReviewerHandoff` (Step 4), produce a release-quality changelog
entry that documents the silent routing bugs fixed in the parent plan, and
optionally split the now-~1,300-line `workflow-handoff.ts` along its existing
`HANDOFF_DISPATCH` seam to reduce future merge-conflict risk. The
`pretest`/`@mistralys/persona-builder` environment friction is also captured as
an explicit operational note so contributors are not surprised.

## Architectural Context

The relevant subsystem lives in `mcp-server/src/tools/workflow-handoff.ts`
(~1,300 lines), which exports per-role handoff resolvers
(`getQaHandoff`, `getSecurityAuditorHandoff`, `getReviewerHandoff`,
`getDocumentationHandoff`, plus the PM dispatch). It is consumed by:

- `mcp-server/src/tools/workflow-next-action.ts` and
  `workflow-next-action-batch.ts` (per-WP routing).
- `mcp-server/tests/tools/workflow-handoff.test.ts` (unit suite, currently
  ~2,765 lines, 4 describe blocks added in WP-006/WP-007).
- `mcp-server/tests/integration/auto-handoff.test.ts` (45 tests, includes the
  WP-009 5-stage fixtures A and B).
- `mcp-server/tests/tools/workflow-rework-loop.test.ts` (rework regression).

Spec authority for these functions is
`mcp-server/docs/agents/workflow-specification/handoff.md` §5.2, §5.2b, §5.3,
§5.4, §13.1, §18.6, §21.66.

The changelog convention is documented in [AGENTS.md →
Changelog Convention](../../../AGENTS.md) (hub-and-spoke: module changelogs
first, then a root entry referencing module versions). The
`changelog.prompt.md` slash command at
[`.github/prompts/changelog.prompt.md`](../../../.github/prompts/changelog.prompt.md)
invokes the `Changelog Curator v1.1.1` agent with the project's house style
preconfigured. **The changelog work in this plan is delegated to that prompt
rather than re-specified here.**

The MCP server module's current version baseline is recorded in
`mcp-server/changelog.md` and `mcp-server/package.json` (kept in sync via the
pre-commit hook).

## Approach / Architecture

Five Work Packages, sequenced so test gaps close before any structural
refactor and before a release-tagging changelog is generated:

1. **WP-A — `getSecurityAuditorHandoff` cond-1 / cond-2 unit tests**
   (medium priority). Add a new `describe('getSecurityAuditorHandoff →
   re-engagement & FAIL routing', …)` block in
   `mcp-server/tests/tools/workflow-handoff.test.ts` mirroring the AC5/AC6
   patterns already used for QA. Include the negative-regression assertion
   suggested in the synthesis: `getSecurityAuditorHandoff([non-SA WP
   IN_PROGRESS])` must NOT return `READY_FOR_SYNTHESIS`.

2. **WP-B — `getReviewerHandoff` Step 4 unit test** (low priority). Add a
   single `it()` under the existing Reviewer describe block exercising
   `assigned_to === 'Reviewer'` → `IN_PROGRESS`,
   `current_agent === 'Reviewer'`. Use the fixture shape suggested in
   Strategic Recommendation 2.

3. **WP-C — Decide on `workflow-handoff.ts` split** (low priority,
   discovery → optional implementation). Spike: produce a short design note
   in `discussions/` weighing the cost (5–7 new files + import churn across
   `workflow-next-action*.ts` and tests; exact count to be determined by
   the spike based on whether the PM dispatcher and the two private helpers
   each warrant their own modules) vs. the benefit (merge-conflict
   reduction). If approved by the user during PM review, split along the
   `HANDOFF_DISPATCH` seam into per-role files and a barrel module that
   preserves the public re-exports. If rejected, mark WP-C as complete with
   the discussion document as the deliverable. **No code is moved without an
   explicit go-ahead during the work package — the spike is non-destructive.**

4. **WP-D — Generate consolidated changelog entry**. Run the
   `/changelog` slash command (which invokes `Changelog Curator v1.1.1` via
   `.github/prompts/changelog.prompt.md`). The curator is responsible for:
   - Determining the last tagged version (`git tag --sort=-v:refname | head
     -1`).
   - Walking `git log <tag>..HEAD` for `mcp-server/`.
   - Consolidating any interim version headings added during the parent plan
     into one new MCP server SemVer bump.
   - Calling out the four silent routing bugs identified by the synthesis
     (premature `READY_FOR_SYNTHESIS` in SA handoff, removed
     `READY_FOR_DEVELOPER` catch-alls in Documentation handoff, fixed
     fallthrough in Reviewer/Documentation, and the
     `partitionWpsAwaitingNextStage` PASS-status fix).
   - Appending the root `changelog.md` entry referencing the new MCP
     server version.

5. **WP-E — Operational note: `pretest` / persona-builder dist**. Add a
   short troubleshooting subsection to `mcp-server/README.md` (or
   `mcp-server/AGENTS.md` if the README would be cluttered) explaining that
   `npm test` in `mcp-server/` invokes a `pretest` hook that requires the
   sibling `@mistralys/persona-builder` workspace to be built (`npm run
   build` in `ai-persona-builder`) before tests can run. Cross-link from
   the relevant AGENTS.md so future contributors find it during ingestion.

Each WP runs through the standard 9-stage pipeline. WP-A and WP-B are
test-only and do not need the security-audit or release-engineering
pipelines. WP-C is a spike with conditional code changes (the user's
decision determines whether the implementation portion runs at all). WP-D
delegates entirely to the `Changelog Curator` agent and only requires QA +
review verification of the resulting markdown. WP-E is documentation-only.

## Rationale

- **Tests before refactor.** WP-A and WP-B close unit-test gaps that are
  currently invisible in the suite. Doing them before the WP-C split means
  the new tests live in the right (post-split) location only if the split
  actually happens, avoiding reorganisation churn either way.
- **Changelog after fixes are tested.** The curator agent walks Git history;
  having the WP-A/WP-B test commits in place means the changelog naturally
  captures them under the same MCP server version bump as the parent plan's
  routing fixes.
- **Split as a spike, not a default.** The synthesis flagged the file size
  as low priority. Forcing a split without user confirmation would inflate
  scope and create import churn touching at least three test files. A spike
  document is reversible; a refactor is not.
- **Reuse the existing changelog prompt.** Re-specifying the changelog
  procedure inside this plan would duplicate
  `.github/prompts/changelog.prompt.md` and risk drift from the
  documented house style. Delegation keeps the source of truth singular.
- **Operational note over CI fix.** Fixing the `pretest` cross-workspace
  dependency would require either restructuring the npm scripts or adding a
  build-on-demand wrapper — both outside the synthesis's scope. A clear
  contributor note solves the user-facing surprise immediately and leaves
  the larger fix for a future plan.

## Detailed Steps

### WP-A — Security Auditor cond-1 / cond-2 unit tests

1. Open `mcp-server/tests/tools/workflow-handoff.test.ts` and locate the
   existing `getSecurityAuditorHandoff` describe block added in WP-006.
2. Append a new sibling `describe('getSecurityAuditorHandoff →
   re-engagement & FAIL routing', …)` block.
3. Add `it('cond-1: re-engagement when implementation:PASS and security-audit not started → IN_PROGRESS / Security Auditor', …)`.
4. Add `it('cond-2: most-recent security-audit:FAIL → READY_FOR_DEVELOPER', …)`.
5. Add the negative-regression `it()`: a single non-SA WP with
   `IN_PROGRESS` must not yield `READY_FOR_SYNTHESIS`.
6. Reuse the `FIVE_STAGES`/`makeWp` helpers already in the file.
7. Tag each `it()` description with its spec condition (`§5.2b cond-1`,
   `§5.2b cond-2`).
8. Run `npx vitest run tests/tools/workflow-handoff.test.ts` from
   `mcp-server/` and confirm all new tests pass and pre-existing tests stay
   green.

### WP-B — Reviewer Step 4 unit test

1. In the same file, locate the existing `getReviewerHandoff` describe block.
2. Add `it('cond-4: assigned_to === "Reviewer" → IN_PROGRESS / current_agent: Reviewer', …)`.
3. Use the fixture from synthesis Recommendation 2:
   `makeWp('WP-001', 'IN_PROGRESS', [{type:'implementation', status:'PASS'}], [], 'Reviewer')`.
4. Assert `result.status === 'IN_PROGRESS'` and
   `result.current_agent === 'Reviewer'`.
5. Run the targeted vitest invocation and confirm green.

### WP-C — Spike: split decision for `workflow-handoff.ts`

1. Create `discussions/2026-04-29-workflow-handoff-split.md`.
2. Document the proposed file layout (one file per handoff resolver +
   barrel) and enumerate every import site that would change (grep
   `workflow-handoff` across `mcp-server/src/` and `mcp-server/tests/`).
3. Estimate line count per new file based on the current
   `HANDOFF_DISPATCH` map.
4. Recommend a verdict (split / defer) with rationale.
5. **Pause for user decision.** If approved during PM review or by direct
   user input, proceed to mechanical split:
   a. Create `mcp-server/src/tools/workflow-handoff/` directory with one
      file per resolver plus an `index.ts` barrel re-exporting the public
      API to preserve all existing import paths.
   b. Move private helpers (`hasPassedDynamicUpstream`,
      `partitionWpsAwaitingNextStage`) into a `helpers.ts` sibling module
      and import them where used.
   c. **Delete** the original `mcp-server/src/tools/workflow-handoff.ts`
      file. Existing imports of `./tools/workflow-handoff` will resolve to
      the new `workflow-handoff/index.ts` automatically — no shim file is
      needed, and keeping both a `.ts` file and a same-named directory as
      siblings creates an ambiguous module-resolution hazard (the file
      would shadow the directory in most resolvers).
   d. Run `npm run build` and full `npx vitest run` — both must remain
      green with zero TypeScript errors.
6. If declined, the discussion document is the WP deliverable.

### WP-D — Changelog generation

1. Confirm WP-A, WP-B, and (if approved) WP-C are merged into the working
   branch.
2. **Inspect `mcp-server/changelog.md`** for any interim version entries
   added during the parent plan since the last Git tag. Record the version
   range (or note "no interim entries"). This determines whether the
   curator's job is *consolidate existing entries into one new bump* or
   *write the first new entry since the last tag*.
3. From the workspace root, run the `/changelog` slash command.
4. The Changelog Curator will:
   - Determine the last tagged version.
   - Walk the MCP-server commit history since that tag.
   - Consolidate any interim entries identified in step 2 into one new
     MCP server SemVer minor bump (the routing-bug fixes are correctness
     changes affecting tool behavior — minor by the prompt's bump rules).
     If no interim entries exist, write a single new entry directly.
   - Add a blockquote line in the new root `changelog.md` entry referencing
     the MCP server version (e.g. `> mcp v1.X.0`).
5. Review the curator's output and request adjustments if any of the
   silent routing bugs enumerated in the Acceptance Criteria are not
   explicitly mentioned in the bullet list. Note that WP-A/WP-B are
   tests-only and per Changelog Curator house style will typically be
   **omitted** from the changelog — that is expected, not a review failure.
6. Run `node scripts/check-version-sync.js` to confirm the new MCP server
   version in `mcp-server/changelog.md` matches `mcp-server/package.json`
   (the curator should bump both; this check is the safety net).

### WP-E — Contributor note for `pretest` dependency

1. Add a short subsection (≤ 10 lines) to `mcp-server/README.md` titled
   "Running the test suite" explaining the cross-workspace build
   prerequisite.
2. Reference it from `mcp-server/AGENTS.md` under the most appropriate
   navigation section (test/build, Quick Start, or the navigation
   reference table — the WP author should pick the section that minimises
   disruption to the existing structure) so agents discover it during
   ingestion.
3. No source changes — pure documentation.

## Dependencies

- WP-A and WP-B are independent of each other and of WP-C; both should
  complete before WP-D so the test-suite baseline used for changelog
  verification is current. (Tests-only commits are typically omitted from
  the user-facing changelog per house style — landing them first is about
  baseline hygiene, not changelog content.)
- WP-C is independent and can run in parallel with WP-A/WP-B; if approved
  and the split is implemented, it must be merged before WP-D so the
  changelog can mention the structural refactor.
- WP-D depends on WP-A, WP-B, and (conditionally) WP-C being merged.
- WP-E is fully independent and may run at any time, but should be merged
  before WP-D so the documentation change is included in the changelog.

## Required Components

### Modified files (existing)

- `mcp-server/tests/tools/workflow-handoff.test.ts` — WP-A, WP-B.
- `mcp-server/changelog.md` — WP-D (via Changelog Curator).
- `mcp-server/package.json` — WP-D (version bump, via Changelog Curator).
- `changelog.md` (root) — WP-D (via Changelog Curator).
- `mcp-server/README.md` — WP-E.
- `mcp-server/AGENTS.md` — WP-E (cross-link only).

### New files (conditional / spike)

- `discussions/2026-04-29-workflow-handoff-split.md` — WP-C (always
  produced).
- `mcp-server/src/tools/workflow-handoff/index.ts` and per-resolver files
  — WP-C (only if user approves the split).

### Tooling consumed (no changes)

- `.github/prompts/changelog.prompt.md` — invoked by WP-D.
- `scripts/check-version-sync.js` — verification step in WP-D.
- Vitest, the existing `makeWp` / `FIVE_STAGES` test helpers.

## Assumptions

- The synthesis's classification of the routing bugs as MCP-server-scoped
  is accurate; no orchestrator or persona changes are needed.
- The `Changelog Curator` agent will correctly choose a SemVer bump given
  the commit history; if it picks patch instead of minor, WP-D includes a
  manual review step to override.
- The `pretest` hook behavior described in the synthesis ("environment
  issue unrelated to this project") is by design and not in scope to fix
  here.
- The user prefers reuse of existing prompts/agents over re-specifying
  procedures inline.

## Constraints

- No public API changes to handoff functions (WP-C must preserve all
  exported names via the barrel module).
- All changes must keep the full vitest suite green
  (currently 1,896 / 1,896).
- Changelog house style (≤ 100 char lines, flat bullets with category
  prefixes, no `### Added/Changed/Fixed` sub-headers) must be preserved by
  the curator output.
- WP-C's split, if it happens, must not change runtime behavior — it is a
  pure mechanical refactor verified by the existing test suite.
- **WP-C pause point is contractual.** The WP-C PM stage must explicitly
  request user approval at the end of the spike (after the discussion
  document is produced) before authorising the implementation half. The
  Developer agent must NOT proceed from spike → refactor in the same
  invocation without that approval being recorded in the WP ledger.

## Out of Scope

- Re-fixing any handoff routing logic — the parent plan completed that work.
- Solving the `pretest` cross-workspace build dependency at the npm-script
  level (only documenting it).
- Splitting `workflow-handoff.test.ts` (also flagged in synthesis as
  growing, but explicitly deferred to "the next natural WP boundary").
- Tagging the Git release — the synthesis lists this as "Next Step 1" but
  it is a post-plan operational action performed by the maintainer once the
  changelog is merged.
- Updates to the orchestrator or personas modules (no changes there in the
  parent plan).

## Acceptance Criteria

- WP-A: ≥ 3 new tests under a `getSecurityAuditorHandoff` re-engagement
  describe block, all passing; the negative-regression assertion present
  and tagged (may be a separate `it()` or an additional `expect()` inside
  one of the cond-1/cond-2 tests — both are acceptable).
- WP-B: ≥ 1 new test for Reviewer Step 4 active-work, passing, with
  spec-condition tag in the description.
- WP-C: discussion document exists with a clear verdict; if "split"
  verdict approved, the refactor is merged and the full vitest suite
  remains green with zero TypeScript errors.
- WP-D: a single new MCP server version entry in `mcp-server/changelog.md`
  consolidating any interim entries since the last Git tag (or written
  fresh if none existed); matching root `changelog.md` entry with
  `> mcp vX.Y.Z` blockquote; `node scripts/check-version-sync.js` exits 0.
  The bullet list must explicitly mention each of the **five** silent
  routing bugs identified by the synthesis (Strategic Recommendation 4 +
  the per-WP fixes in WP-002 / WP-003 / WP-004 / WP-005):
    1. Premature `READY_FOR_SYNTHESIS` in `getSecurityAuditorHandoff`
       (WP-005, all-terminal early exit fix).
    2. Removed `READY_FOR_DEVELOPER` upstream catch-all in
       `getDocumentationHandoff` (WP-002).
    3. Documentation final fallthrough corrected from
       `READY_FOR_SYNTHESIS` to `WAIT` (WP-002).
    4. Reviewer final fallthrough corrected from `READY_FOR_DOCUMENTATION`
       to `WAIT` (WP-003).
    5. `partitionWpsAwaitingNextStage` PASS-status filter fix affecting
       all three callers — QA / SA / Reviewer (WP-004).
- WP-E: a "Running the test suite" subsection in `mcp-server/README.md`
  with cross-link from `mcp-server/AGENTS.md`; no source changes.
- Final: `npm run build` exits 0; `npx vitest run` reports the baseline
  count (1,896) **plus the number of new `it()` blocks introduced by
  WP-A and WP-B**, all green; `node scripts/validate-workflow-manifest.js`
  exits 0.

## Testing Strategy

- **WP-A, WP-B**: targeted vitest run on
  `tests/tools/workflow-handoff.test.ts`, then full suite for regression.
- **WP-C**: full vitest suite + `npm run build`. The split is verified
  exclusively by the existing tests passing — any behavior change is a bug.
- **WP-D**: lint the resulting markdown manually for the four silent-bug
  callouts and the blockquote format. Run `node
  scripts/extract-changelog-entry.js` to confirm the topmost root entry
  parses cleanly. Run `node scripts/check-version-sync.js`.
- **WP-E**: documentation-only; no automated test. Visual review of
  rendered Markdown.
- **Final integration check**: full `npx vitest run`,
  `node scripts/validate-workflow-manifest.js`, and `npm run build` from
  `mcp-server/`.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Changelog Curator picks the wrong SemVer bump** | WP-D includes a manual review step before merging the curator's output; override and re-run if needed. |
| **WP-C spike turns into a sprawling refactor** | Hard pause point after the discussion document; no code is moved without explicit user approval inside the WP. |
| **Hidden behavioral change during the WP-C split** | Pure barrel re-exports + helpers move; full vitest suite must stay green; any change in test count or assertions blocks the WP. |
| **`pretest` hook fails for the agent running WP-D** | The synthesis already documented the workaround; agents follow WP-E's note (build `ai-persona-builder` first). |
| **Interim version entries already exist in `mcp-server/changelog.md`** | The Changelog Curator prompt explicitly handles this case (consolidation rule in the prompt); no special action needed. |
| **WP-A/WP-B fixture drift from existing AC5/AC6 patterns** | Reuse the existing `makeWp` and `FIVE_STAGES` helpers verbatim; do not introduce new helpers. |
| **Reviewer Step 4 test reveals a real bug** | Treat as a finding under the same WP; do not silently fix — open a follow-up plan if scope expands. |
| **Curator omits the WP-C structural refactor from the changelog** | If WP-C lands, the WP-D review checklist must explicitly verify the file split is mentioned (under a refactor / chore prefix) or — if the curator deliberately excludes it as non-behavioral — that exclusion is recorded in the WP-D notes. |

AGENT: Planning
STATUS: READY_FOR_PM
