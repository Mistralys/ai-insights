
## Synthesis

### Completion Status
- Date: 2026-09-17
- Status: COMPLETE
- Completed by: Standalone Developer Agent
- Research brief: used
- Archived in Ledger: 2026-09-17

### Outcome Summary

Removed the workspace's one Claude-Code-specific advisory (`pretooluse-hook`) from `ai-insights
ledger init`/`edit`, and codified a durable "Tool-Agnostic Policy" in `AGENTS.md` so the same class
of coupling does not reappear unchallenged in a future plan. Alongside that, `CLAUDE.md` was
switched from a generated 70 KB verbatim copy of `AGENTS.md` to a committed one-line `@AGENTS.md`
import — matching the contract the AGENTS.md Curator persona already specified — with a matching
`mcp-server/CLAUDE.md` companion added and both guarded by a new instant-tier health check. Two
items deferred by the prior ledger-declaration synthesis were pulled forward: a documentation-only
warning against declaring an output path at a security-sensitive destination, and a leaf-symlink
regression test closing the last unpinned variant of the sync write guard's symlink-escape
protection.

### Implementation Summary
- `collectAdvisories()` in `scripts/lib/ledger-project-core.js` now returns four advisory records
  (gitignore, both doc-routing lines, public-repository warning) instead of five; its JSDoc and the
  corresponding exact-set test were updated in step with the removal.
- Added a Tool-Agnostic Policy section to `AGENTS.md`, modeled on the existing Cross-Platform
  Policy, naming the `personas/` per-target build as the deliberate exception; wired it into the
  Root-Level / Cross-Project maintenance table and the ledger-project-core.js tooling row.
- Deleted the AGENTS.md→CLAUDE.md content-copy block from `cmdCtxGenerate()` in `scripts/cli.js`;
  `CLAUDE.md` and the new `mcp-server/CLAUDE.md` are now committed one-line `@AGENTS.md` imports,
  documented in `AGENTS.md`'s Generated Context Docs section and a new Cross-System Dependencies
  row.
- Added an instant-tier `claude-md-companion` health check to `scripts/lib/health-checks.js`,
  hardcoding the two known `AGENTS.md`/`CLAUDE.md` path pairs and failing when either companion is
  missing, empty, or holds content beyond the import line.
- Documented the sensitive-output-path warning in `OutputConfigSchema`'s JSDoc, in
  `constraints-storage.md`, and in the root `README.md`'s ledger section — documentation only, no
  schema refinement or runtime denylist.
- Added a leaf-symlink regression case to `mcp-server/tests/outputs/sync.test.ts`, directly beside
  the existing intermediate-directory case, pinning the variant where the declared output path
  itself is a symlink to a file outside `projectRoot`.
- Regenerated `.context/` via `node scripts/cli.js ctx-generate`, confirming `CLAUDE.md` and
  `mcp-server/CLAUDE.md` were left byte-for-byte unchanged by the run.
- Bumped `mcp-server` to a patch version and the workspace root to a minor version, with matching
  changelog entries in house style; `personas/changelog.md` was left untouched per the plan's
  explicit constraint.

### Documentation Updates
- `AGENTS.md` — new Tool-Agnostic Policy section; a note in Generated Context Docs that `CLAUDE.md`
  is a committed import, not generated; a Cross-System Dependencies row for the companion contract;
  two Root-Level / Cross-Project maintenance-table rows (tool-specific behaviour routing, and the
  obligation to add a companion for any new `AGENTS.md`); the `ledger-project-core.js` and
  `health-checks.js` tooling rows updated to match the code.
- `mcp-server/docs/agents/project-manifest/constraints-storage.md` — new subsection documenting the
  sensitive-output-path warning as a storage-domain constraint.
- `README.md` — one sentence in the `ai-insights ledger` section warning against a security-sensitive
  output-path override.
- `mcp-server/changelog.md`, `changelog.md` (root) — new entries in house style.
- `docs/references/menu-guide.md`, `mcp-server/docs/agents/project-manifest/api-surface.md` — checked
  per the plan's Documentation Updates list; neither referenced the removed hook or the
  `OutputConfigSchema.path` field, so no change was needed.
- `.context/scripts.md`, `.context/agents.md`, and the rest of `.context/` — regenerated via
  `node scripts/cli.js ctx-generate`; never hand-edited.

### Verification Summary
- Tests run: root `npm test` (`scripts/tests/`, Vitest) and the `mcp-server` Vitest suite
  (`mcp-server/npm test`) — both full runs, including the new leaf-symlink case and the new
  `claude-md-companion` health-check cases.
- Static analysis run: `tsc --noEmit` in `mcp-server/` (no separate lint script exists at either the
  workspace root or in `mcp-server/`).
- Result: PASS. Both suites report zero failures. `node scripts/cli.js check-versions` exits 0.

### Code Insights

Compiled from `insights.jsonl`, which carries a `Developer` session-start marker plus decision and
follow-up entries recorded incrementally after each implementation gate.

#### Follow-Up Items
- [medium] (improvement) `scripts/tests/ledger-bridge.test.js`, `ledger-project-core.test.js`,
  `ledger-project.test.js`, `store-commands.test.js`: On a cold checkout, root `npm test` flaked
  with four 5-second timeouts because `scripts/lib/ledger-bridge.js` rebuilds `mcp-server/dist/` on
  first use, and the build itself takes longer than Vitest's default per-test timeout. Rebuilding
  `mcp-server/dist/` beforehand made all four pass cleanly. Worth either raising the timeout on the
  specific tests that can trigger a first-use rebuild, or moving the rebuild into a one-time global
  setup step, so a cold checkout doesn't intermittently fail `npm test` for a reason unrelated to
  the code under test.

#### Implementation Decisions
- [low] (decision) `scripts/lib/ledger-project-core.js`: Removed the `pretooluse-hook` advisory
  record and its two JSDoc mentions; `renderLedgerReadme()` already carried the tool-neutral
  "must never be hand-edited / generated-by marker" statement unchanged, so no replacement advisory
  text was added.
- [low] (decision) `scripts/tests/ledger-project-core.test.js`: Retitled the exact-set advisory test
  and removed `pretooluse-hook` from the expected id array, keeping the exact-set assertion shape so
  a future reintroduction fails loudly.
- [low] (decision) `mcp-server/src/schema/project-declaration.ts`, `constraints-storage.md`,
  `README.md`: Documented the sensitive-output-path warning in three places rather than adding a
  schema refinement or runtime denylist, per `constraints-code-style.md`.
- [low] (decision) `mcp-server/tests/outputs/sync.test.ts`: Added the leaf-symlink regression case
  directly after the intermediate-directory case, reusing its imports and fixture; no platform guard
  added, matching the pre-existing unmitigated gap on the sibling test.
- [low] (decision) `AGENTS.md`: Added the Tool-Agnostic Policy section and its maintenance-table row;
  caught and fixed a self-introduced AC-04 violation where the policy's rationale line initially
  named the removed hook by its literal string, which would have failed the repository-wide grep
  criterion — reworded before finalizing.
- [low] (decision) `scripts/cli.js`, `CLAUDE.md`, `mcp-server/CLAUDE.md`: Deleted the AGENTS.md→
  CLAUDE.md content-copy block and replaced both files with the single-line `@AGENTS.md` import;
  confirmed no existing test asserted the deleted sync behavior before removing it.
- [low] (decision) `scripts/lib/health-checks.js`: Added the `claude-md-companion` check hardcoding
  the two known path pairs rather than scanning for `AGENTS.md` files, per the plan's stated
  rationale (keeping the instant tier's fixed-path, no-traversal cost class).
- [low] (decision) `AGENTS.md`: Documented the companion contract as a Generated Context Docs note,
  a Cross-System Dependencies row, and a maintenance-table row obliging a companion for any new
  `AGENTS.md`.
- [low] (decision) `changelog.md`, `mcp-server/changelog.md`: Added a patch entry to the module
  changelog and a minor entry to the root changelog — minor rather than patch at the root, since the
  change alters build behavior (`cmdCtxGenerate()`) and adds a durable workspace policy, not just
  documentation.

### Additional Comments
- This plan's own `plan.md` and `research-brief.md` retain historical `PreToolUse` mentions, as
  expected — they are immutable plan source describing the advisory that was removed, and AC-04
  explicitly scopes the grep to exclude `docs/agents/plans/`.
- A large set of unrelated uncommitted changes from the prior `2026-09-16-ledger-project-declaration`
  plan remain staged in the working tree (dogfooding artefacts, `.githooks/pre-commit`, etc.) — per
  the plan's Deferred Items #1, committing them is a human action, not something this session
  performs or depends on.
