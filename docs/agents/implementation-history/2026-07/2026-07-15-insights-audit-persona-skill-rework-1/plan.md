
# Plan

## Plan Audit Cycles
- Audits: none — Plan Auditor v1.5.0
- Architectural Reviews: none — Plan Architect Reviewer v2.0.0

## Prior Project Context
The `2026-07-15-insights-audit-persona-skill` project delivered a complete skills build pipeline. Its synthesis identified several deferred items affecting long-term stability: a `--dry-run` asymmetry that silently publishes files when the user expects a preview, missing test coverage for the two-step build→publish orchestration, and a fragile pre-build cleanup that only removes top-level `.md` files. This rework addresses those gaps. The repository's strategic vision prioritises minimal developer friction — the `--dry-run` fix directly serves that goal.

## Summary
Harden the skills build/publish pipeline by fixing the `--dry-run` asymmetry (so `publish-skills` respects `--dry-run`), adding a unit test for the `cmdPublishSkills()` sequencing and abort-on-fail guard, making pre-build cleanup resilient to future subdirectory output, and regenerating `.context/` to sync documentation snapshots.

## Architectural Context
The skills pipeline consists of three components:

1. **`scripts/build-skills.js`** — Uses the `@mistralys/persona-builder` `build()` API with a custom `TargetRegistry` to compile skill YAML+Markdown sources from `skills/` into `dist/vscode-skills/` and `dist/claude-skills/`. Supports `--check` / `--dry-run` (read-only) and `--strict`.
2. **`scripts/publish-skills.js`** — Reads built `.md` files from `dist/` and deploys each as `{stem}/SKILL.md` under `.github/skills/` (VS Code) and `~/.claude/skills/` (Claude Code). Has no `--dry-run` support.
3. **`scripts/cli.js` → `cmdPublishSkills(args)`** — Orchestrates the two-step sequence: build (with CLI args forwarded) → publish (no args). Aborts if build fails.

Root workspace tests live in `scripts/tests/` (Vitest, ESM `.test.js` files) and are configured via the root `vitest.config.ts`.

## Approach / Architecture
1. Add `--dry-run` flag parsing to `publish-skills.js` that logs what would be deployed without writing.
2. Update `cmdPublishSkills()` in `cli.js` to forward `--dry-run` to both the build and publish steps.
3. Replace the top-level-only `.md` file deletion in `build-skills.js` with a recursive directory clear.
4. Add a unit test file `scripts/tests/publish-skills.test.js` that verifies `publish-skills.js` `--dry-run` behaviour and the overall contract.
5. Regenerate `.context/` after any documentation changes.

## Rationale
- **`--dry-run` in publish-skills.js rather than in cli.js**: The principle of least surprise requires each script to independently respect `--dry-run` when called directly (not only via the CLI wrapper). This matches `build-skills.js` which already handles `--check` / `--dry-run` independently.
- **Recursive cleanup over `.md`-only filter**: The current cleanup silently leaves stale subdirectory output if the build ever produces nested structures. Using `fs.rmSync(dir, { recursive: true })` + `fs.mkdirSync(dir, { recursive: true })` is simpler, correct, and forward-compatible.
- **Testing publish-skills.js directly** rather than testing `cmdPublishSkills()` inside `cli.js`: `cmdPublishSkills` is an unexported function that calls `runScript` (a `child_process.spawnSync` wrapper). Mocking that requires import interception. Testing `publish-skills.js` behaviour directly (build output → deploy) is more straightforward, verifiable, and catches real regressions.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Where to add `--dry-run` | `publish-skills.js` (script-level) | CLI wrapper only (`cmdPublishSkills` forwards env var) | Script-level is independently testable and respects direct invocation (`node scripts/publish-skills.js --dry-run`) |
| Test approach | Integration test that runs `publish-skills.js` against a temp directory | Mock `runScript` in cli.js; Mock `fs` in publish-skills.js | Integration test is more robust, tests real file I/O, no import mock complexity |
| Pre-build cleanup strategy | `rmSync` + `mkdirSync` on entire output dir | Add glob for subdirectories | `rmSync` is simpler, already used in `deploySkill()`, and handles all shapes of stale output |

## Pattern Alignment
- **Script flag parsing**: `build-skills.js` uses `process.argv.includes('--dry-run')` (L24). The same pattern will be used in `publish-skills.js`. — `scripts/build-skills.js`
- **Console log prefix**: `publish-skills.js` uses `[publish-skills]` prefix for all output. Dry-run messages will use the same prefix. — `scripts/publish-skills.js`
- **Test file naming**: Existing tests use `{subject}.test.js` in `scripts/tests/`. — `scripts/tests/health-checks.test.js`
- **Cleanup pattern**: `deploySkill()` in `publish-skills.js` already uses `fs.rmSync(destDir, { recursive: true, force: true })`. The pre-build cleanup will adopt the same call. — `scripts/publish-skills.js`

## Detailed Steps

### Step 1: Add `--dry-run` support to `publish-skills.js`

1. Add flag parsing at the top of the script:
   ```js
   const DRY_RUN = process.argv.includes('--dry-run');
   ```

2. Modify `deploySkill()` to accept a `dryRun` parameter. When `true`, log the destination path with a `[dry-run]` prefix and skip `rmSync`, `mkdirSync`, and `writeFileSync`.

3. Update the main loop to pass `DRY_RUN` to `deploySkill()`.

4. Update the final report line to indicate dry-run mode when active:
   ```
   [publish-skills] 4 skill file(s) would be published (dry-run).
   ```

### Step 2: Forward `--dry-run` to publish step in `cmdPublishSkills()`

In `scripts/cli.js`, modify `cmdPublishSkills(args)` so that when `args` contains `--dry-run`, it is also passed to the `publish-skills.js` invocation:

```js
function cmdPublishSkills(args) {
  const buildCode = runScript('node', [path.join(SCRIPTS_DIR, 'build-skills.js'), ...args], { cwd: WORKSPACE_ROOT });
  if (buildCode !== 0) process.exit(buildCode);
  const publishArgs = args.includes('--dry-run') ? ['--dry-run'] : [];
  const publishCode = runScript('node', [path.join(SCRIPTS_DIR, 'publish-skills.js'), ...publishArgs], { cwd: WORKSPACE_ROOT });
  if (publishCode !== 0) process.exit(publishCode);
}
```

### Step 3: Make pre-build cleanup recursive in `build-skills.js`

Replace the existing top-level-only `.md` file deletion (lines 72–78) with a recursive directory clear:

```js
if (!CHECK) {
    for (const dir of [OUT_VSCODE, OUT_CLAUDE]) {
        if (fs.existsSync(dir)) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
        fs.mkdirSync(dir, { recursive: true });
    }
}
```

This ensures all stale output (files and subdirectories) is removed before each build, and the output directory is recreated empty.

### Step 4: Add unit test for `publish-skills.js`

Create `scripts/tests/publish-skills.test.js` with integration tests that:

1. Create a temporary directory structure mimicking `dist/vscode-skills/` and `dist/claude-skills/` with sample `.md` files.
2. Call `publish-skills.js` (via `child_process.execFileSync` or `spawnSync`) with environment variables or args pointing at the temp dirs.
3. Verify files are deployed to the expected `{stem}/SKILL.md` structure.
4. Call `publish-skills.js --dry-run` and verify no files are written/modified.
5. Verify exit code 1 when no built files exist.

**Note:** Since `publish-skills.js` hardcodes its source and target paths (using `import.meta.dirname`), the test will need to either:
- (a) Provide actual build output in `dist/` and target a temp publish dir, or
- (b) Refactor the path constants into a testable shape.

The recommended approach is **(a)**: the test creates minimal `.md` files in `dist/vscode-skills/` and `dist/claude-skills/`, runs the script with `--dry-run` to verify no writes occur, and cleans up. For the "files are deployed" assertion, the test can validate the existing deployment (which was written by a prior real run) rather than triggering a fresh write to production locations.

A more targeted alternative: test just the `--dry-run` flag by running the script with `--dry-run` against the real dist directory and asserting that the exit code is 0 and the output contains `(dry-run)`. This avoids filesystem side effects entirely.

### Step 5: Regenerate `.context/`

After all code and documentation changes are complete, run:
```
node scripts/cli.js ctx-generate
```
to bring `.context/` snapshots in sync with the updated `AGENTS.md`, `README.md`, and script source files.

## Dependencies
- Steps 1 and 3 are independent and can be implemented in parallel.
- Step 2 depends on Step 1 (publish-skills.js must accept `--dry-run` before the CLI can forward it).
- Step 4 depends on Step 1 (test validates `--dry-run` behaviour).
- Step 5 depends on all prior steps (documentation must be final).

## Required Components
- `scripts/publish-skills.js` — modification (add `--dry-run` flag)
- `scripts/cli.js` — modification (`cmdPublishSkills` forwarding)
- `scripts/build-skills.js` — modification (recursive cleanup)
- `scripts/tests/publish-skills.test.js` — new file (unit/integration test)

## Assumptions
- The `@mistralys/persona-builder` `build()` API continues to handle file writes internally; the `--dry-run` / `--check` flag in `build-skills.js` already prevents writes at the build level.
- The `dist/vscode-skills/` and `dist/claude-skills/` directories are gitignored build artifacts that can be safely deleted and recreated.
- `ctx` CLI is available on PATH for `.context/` regeneration.

## Constraints
- `publish-skills.js` must remain independently callable (not only via `cli.js`).
- No changes to the `@mistralys/persona-builder` package in this plan.
- Cross-platform: all file operations must use `path.join()` / `path.resolve()`, no hardcoded separators.
- Tests must use OS temp directories (no hardcoded `/tmp/` paths).

## Out of Scope
- Cosmetic blank line in Claude Code frontmatter (deferred #3) — will be addressed upstream in `@mistralys/persona-builder`.
- `import.meta.dirname` ESM-only concern (deferred #5) — no CJS consumer exists.
- Adding new skills — the pipeline is ready; new skills are future work.
- Tagging a release — handled separately after changelog curation.

## Acceptance Criteria

- AC-01: Running `node scripts/publish-skills.js --dry-run` logs what would be deployed but writes zero files to `.github/skills/` or `~/.claude/skills/`.
- AC-02: Running `node scripts/cli.js publish-skills -- --dry-run` passes `--dry-run` to both `build-skills.js` and `publish-skills.js`.
- AC-03: `scripts/build-skills.js` pre-build cleanup removes the entire output directory (including any subdirectories), not just top-level `.md` files.
- AC-04: A new test file `scripts/tests/publish-skills.test.js` exists and passes, covering at minimum the `--dry-run` no-write guarantee.
- AC-05: All existing workspace tests (`npm test` from root) continue to pass with zero regressions.
- AC-06: `.context/` is regenerated and reflects any documentation changes.

## Testing Strategy
Integration-style testing: run the actual scripts in a controlled environment and assert on exit codes and file system state. Use `--dry-run` mode for non-destructive assertions. Verify existing test suite passes without regressions.

## Test Plan

- `scripts/tests/publish-skills.test.js` — "dry-run produces zero file writes" — verifies `publish-skills.js --dry-run` does not create or modify deployment targets — AC-01, AC-04
- `scripts/tests/publish-skills.test.js` — "exit code 1 when no built files exist" — verifies script fails gracefully when `dist/` is empty — AC-04
- `scripts/tests/publish-skills.test.js` — "dry-run output contains expected log lines" — verifies console output includes `[dry-run]` and `(dry-run)` markers — AC-01, AC-04
- Existing test suite — `npm test` from workspace root — verifies zero regressions — AC-05

## Documentation Updates

- `docs/references/menu-guide.md` — Remove or update the bash comment explaining the `--dry-run` asymmetry (if present), since the asymmetry is now fixed.
- `skills/README.md` — Add a note that `publish-skills` supports `--dry-run` for safe preview.
- `AGENTS.md` — Update the `scripts/build-skills.js` and `scripts/publish-skills.js` table entries to mention `--dry-run` / `--check` support where newly added.

## Deferred Items

| # | Deferred Item | Origin | Reason Deferred | Notes |
|---|---------------|--------|-----------------|-------|
| 1 | Cosmetic blank line between `context:` and `agent:` in Claude Code skill frontmatter | Synthesis deferred #3 | Will be addressed upstream in the `@mistralys/persona-builder` engine's `resolveConditionals()` function | Adjacent truthy `{{#if}}` blocks always produce a double-newline; fix belongs in the engine, not in consumer templates |
| 2 | Adding new skills (changelog-curator, planner, release-check replacement) | Synthesis Next Steps #1 | Pipeline work, not stability rework | Pipeline is ready; new skills can be added at any time |

## Risks & Mitigations
| Risk | Mitigation |
|------|------------|
| **Test flakiness from real filesystem paths** | Use `--dry-run` mode for assertions (no writes); use `os.tmpdir()` for any temp file needs |
| **Breaking existing `publish-skills` behaviour** | `--dry-run` is opt-in; default behaviour (no flag) is unchanged |
| **Recursive cleanup deletes needed files** | Output dirs are gitignored build artifacts; `--check` mode skips cleanup entirely |
