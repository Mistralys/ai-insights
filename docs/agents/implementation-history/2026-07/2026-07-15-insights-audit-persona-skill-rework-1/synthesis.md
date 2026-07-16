## Synthesis

### Completion Status
- Date: 2026-07-16
- Status: COMPLETE
- Completed by: Standalone Developer Agent
- Archived in Ledger: 2026-07-16

### Outcome Summary

All four hardening gaps identified in the prior project's synthesis were addressed: `publish-skills.js` now respects `--dry-run` independently, the CLI wrapper forwards the flag correctly, the pre-build cleanup is recursive rather than top-level-only, and a new integration test suite covers the `--dry-run` contract. Documentation was updated across `AGENTS.md`, `skills/README.md`, and `docs/references/menu-guide.md`, and `.context/` was regenerated.

### Implementation Summary
- Added `const DRY_RUN = process.argv.includes('--dry-run')` flag to `scripts/publish-skills.js`; `deploySkill()` accepts a `dryRun` parameter that logs the target path and returns early, skipping all filesystem writes
- Updated final report line to print `(dry-run)` suffix when in dry-run mode
- Modified `cmdPublishSkills(args)` in `scripts/cli.js` to derive `publishArgs` from the presence of `--dry-run` in `args` and pass it through to `publish-skills.js`
- Replaced the top-level `.md`-only deletion loop in `scripts/build-skills.js` with `rmSync(..., { recursive: true, force: true })` + `mkdirSync(..., { recursive: true })`, matching the pattern already used in `deploySkill()`
- Created `scripts/tests/publish-skills.test.js` with six tests across two `describe` blocks: dry-run exit code, stdout markers, summary line pattern, no-write guarantee, exit code 1 on empty dist, and stderr error message

### Documentation Updates
- `AGENTS.md` — Updated `scripts/publish-skills.js` table entry to mention `--dry-run` support
- `skills/README.md` — Added "Publishing Skills" section with a command reference table covering both `publish-skills.js` direct invocation and the CLI wrapper, including `--dry-run` variants
- `docs/references/menu-guide.md` — Replaced the asymmetry comment block with a clean `./menu.sh publish-skills -- --dry-run` example line; the old note ("the publish step always writes...") was removed since the asymmetry is now fixed
- `.context/` — Regenerated via `node scripts/cli.js ctx-generate`; AGENTS.md synced to CLAUDE.md automatically

### Verification Summary
- Tests run: `npm test` (root workspace Vitest suite, all 4 test files including new `publish-skills.test.js`)
- Static analysis run: none configured for root scripts
- Result: PASS — 90/90 tests pass, 0 regressions
- Manual AC verification:
  - AC-01: `node scripts/publish-skills.js --dry-run` → `[dry-run]` lines + `(dry-run)` summary, no filesystem writes ✓
  - AC-02: `node scripts/cli.js publish-skills -- --dry-run` → build in check mode + publish in dry-run mode ✓
  - AC-03: `build-skills.js` pre-build cleanup uses `rmSync` + `mkdirSync` ✓
  - AC-04: `scripts/tests/publish-skills.test.js` exists and all 6 tests pass ✓
  - AC-05: All existing tests continue to pass ✓
  - AC-06: `.context/` regenerated successfully ✓

### Code Insights
- [low] (improvement) `scripts/publish-skills.js`: ~~The `deploySkill()` function signature now takes a positional boolean `dryRun` parameter. If additional options are added later (e.g. `--verbose`), consider switching to an options object `{ dryRun }` to avoid a growing positional argument list.~~ **ACKNOWLEDGED**
- [low] (debt) `scripts/publish-skills.js`: ~~The VS Code and Claude Code deploy loops are nearly identical. A single loop over `[{ files: vsFiles, targetDir: GH_SKILLS, label: 'VS Code' }, ...]` would reduce duplication if a third deploy target is ever added.~~ **DEFERRED** This will naturally be done when we come to it.
- [low] (improvement) `scripts/tests/publish-skills.test.js`: ~~The "no built files" describe block backs up and restores dist dirs in `beforeAll`/`afterAll`. If a future test run is aborted mid-suite, dist files may not be restored. A `process.on('exit')` guard or `try/finally` in `afterAll` would make cleanup more robust.~~ **FIXED** Added `process.once('exit', restore)` in `beforeAll` and `process.removeListener('exit', restore)` in `afterAll` so the dist dirs are restored even if the test run is aborted.

### Additional Comments
- The `--dry-run` in `cmdPublishSkills` is forwarded only when explicitly present in `args`; no other args are filtered, so `--strict` and `--check` are still forwarded to the build step as before.
- The test stem `test-skill-publish-abc123` is intentionally collision-resistant; if a real skill ever takes this slug, the test's no-write assertion would need updating.
