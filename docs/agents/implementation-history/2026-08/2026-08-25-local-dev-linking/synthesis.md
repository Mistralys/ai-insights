## Synthesis

### Completion Status
- Date: 2026-08-25
- Status: COMPLETE
- Completed by: Standalone Developer Agent
- Archived in Ledger: 2026-08-25

### Outcome Summary

Implemented a scripted DEV/PROD dependency-mode switch for the two sibling packages
(`@mistralys/persona-builder`, `@mistralys/cli-menu`). `scripts/dev-link.js` handles
link/unlink/status via `npm link`, a gitignored `.dev-links.json` marker records the active
mode, and three consumers read it: the CLI status line, the `dev-unlink` command, and a
blocking pre-commit guard. End-to-end validation confirmed the full link → verify → unlink
round trip leaves `package.json` and `package-lock.json` untouched.

### Implementation Summary
- **New** `scripts/dev-link.js` — `link` / `unlink` / `status` subcommands with `--package <name>`
  (short alias or full scoped name) and `--skip-build`. Builds the sibling, runs `npm link` on
  both sides, verifies the resulting symlink via `fs.lstatSync()`, and writes the marker. Absent
  sibling repos warn and skip rather than fail. Cross-platform (`path.join`, `npm.cmd` on Win32).
- `scripts/cli.js` — registered `dev-link` (`l`) and `dev-unlink` (`u`) under
  "Setup & Configuration", both delegating to the standalone script via `runScript`. The
  planned `dev-status` menu entry was intentionally omitted per plan Step 2 — the status line
  already surfaces the mode on every render; `node scripts/dev-link.js status` remains for scripts.
- `scripts/lib/health-checks.js` — new instant-tier `dev-links-inactive` check. Reports DEV mode
  as a *failing* check so it draws attention in the status line, with `dev-unlink` as the fix.
- `.githooks/pre-commit` — two new blocking guards: (a) marker file present, (b) any staged
  `package-lock.json` whose **added** lines contain a `"file:` resolved path. The added-lines
  restriction (`grep '^+'`) prevents a false positive when a `file:` line is being removed.
- `.gitignore` — added `/.dev-links.json`.
- **New** `scripts/tests/dev-link.test.js` — spawns the script against a temp workspace copy, so
  no test ever writes to the real repo root or invokes `npm link`.

Deviation worth flagging: partial link failures now return exit code 1 while still persisting
whatever *did* link successfully. The plan did not specify failure semantics; this keeps the
marker truthful about actual on-disk state rather than rolling back a working symlink.

### Documentation Updates
- `docs/references/development.md` — removed the incorrect advice to switch `cli-menu` to a
  `file:` path, and the false claim that `preflight-bootstrap.js` "handles sibling linking
  automatically" (it has no such logic). Added a DEV/PROD mode section, a mode-marker/guards
  subsection explaining the relationship to the `release-check` skill's step 3a, an Agent
  Workflow subsection with the autonomous activation rule, and a Key Scripts table row.
- `AGENTS.md` — added the `.dev-links.json` row to Cross-System Dependencies, the
  `scripts/dev-link.js` row to Root-Level Tooling, and a new "Sibling Package Development"
  section carrying the agent-facing autonomous DEV mode activation rule.
- `CLAUDE.md` is auto-generated from `AGENTS.md` and was intentionally left untouched — it
  regenerates via `node scripts/cli.js ctx-generate`.

### Verification Summary
- Tests run: `npm test` (full root scripts suite, 191 passed / 9 files);
  `scripts/tests/dev-link.test.js` (15); `scripts/tests/health-checks.test.js` (16)
- Static analysis run: `node scripts/build-personas.js --check` (clean);
  `node scripts/cli.js help` (menu rendering + column alignment verified)
- Manual validation:
  - AC-01: `dev-link --package cli-menu --skip-build` created
    `node_modules/@mistralys/cli-menu -> ../../../cli-menu` and wrote a correct marker
  - AC-02: `dev-unlink` restored the registry package and removed the marker
  - AC-04/05: pre-commit guard exits 1 with the `dev-unlink` hint while the marker exists
  - AC-06: guard logic exercised in a throwaway git repo — blocks a staged `"file:` addition,
    allows a registry-resolved lock (no false positive)
  - AC-09: `git check-ignore -v .dev-links.json` resolves to `.gitignore:39`
  - Constraint: `git status` confirmed `package.json` / `package-lock.json` unmodified across the
    entire link → unlink cycle
- Result: PASS. One flaky failure (`store-commands` AC-4, 5 s timeout under parallel load)
  passed in isolation and on re-run — unrelated to this change, recorded below.
- Re-verified after the post-plan follow-up (see below): full root suite green, pre-commit clean.

### Code Insights
- [high] (code-smell) `scripts/dev-link.js`: The first implementation of `cmdUnlink` ran
  `npm install` in *every* consumer directory regardless of what was actually linked. End-to-end
  validation caught it rewriting the tracked `personas/package-lock.json` version field
  (3.32.0 → 3.31.0), directly violating this plan's "never modify `package-lock.json`"
  constraint. Fixed by filtering consumers to those with a marker entry or a live symlink;
  regression test added. **Follow-up: RESOLVED (same session).** The underlying drift was
  pre-existing and wider than first thought — all three npm modules had lock files ahead of their
  `package.json` (root 1.0.0 vs changelog 2.9.0, mcp-server 2.8.1 vs 2.8.0, personas 3.32.0 vs
  3.31.0), caused by two duplicated version writers that only wrote `package.json`. Both now
  delegate to a new `scripts/lib/package-version.js` and write `version` +
  `packages[""].version` in the lock file too; `check-version-sync.js` compares all three values
  across all four modules (root included) and blocks in pre-commit. Note `npm ci` does **not**
  catch this — verified empirically that it exits 0 on a root version mismatch, so the
  `release-check` skill's step 3b claim was corrected.
- [medium] (convention) `.githooks/pre-commit`: A growing flat shell script mixing blocking
  guards with advisory warnings and no section markers. Extracting the blocking guards into a
  single `node scripts/precommit-guards.js` would make them unit-testable and cross-platform —
  today the shell-only guards silently do nothing on native Windows Git.
- [medium] (debt) `scripts/tests/store-commands.test.js`: `storeList` AC-4 intermittently times
  out at the 5 s default under full-suite parallel load (it loads `mcp-server/dist` via
  `ledger-dirs.js`). Give it an explicit longer timeout, matching the `15_000` already used in
  `health-checks.test.js`.
- [low] (debt) `scripts/tests/health-checks.test.js`: The `toHaveLength(12)` registry assertion
  must be hand-bumped for every added check. Replacing it with a duplicate-id assertion plus the
  existing per-id presence checks would catch the same real defects without going stale.
- [low] (improvement) `scripts/cli.js`: Help-variant labels wider than `CMD_WIDTH` in
  `@mistralys/cli-menu`'s `help.ts` collide with their description text (hit while writing the
  `dev-link` variants). **Worked around, not fixed:** the `dev-link` / `dev-unlink` labels were
  shortened to fit. The renderer still silently overlaps any over-width label, and the limit is
  neither documented nor asserted — a width assertion or truncation in `help.ts` would catch this
  at render time instead of leaving each caller to discover it by eye.
- [low] (debt) `scripts/preflight-bootstrap.js`: Consider surfacing DEV mode from preflight too,
  so long-running commands warn about an active link before doing minutes of work.
- [low] (convention) `scripts/dev-link.js`: Uses `process.exit(main())`, matching sibling
  scripts. If stdout truncation is ever observed on Windows, switch to `process.exitCode`.

### Post-Plan Follow-Up (same session, at user request)

Two insights raised above were acted on immediately rather than deferred. Both were out of the
original plan's scope but grew directly out of defects this plan surfaced.

**1. Version sync now owns lock files** (resolves the high-priority insight's follow-up)
- **New** `scripts/lib/package-version.js` — shared changelog/manifest/lock version helpers.
- `mcp-server/scripts/sync-version.js` and the post-build step in `scripts/build-personas.js`
  both delegate to it, replacing two copy-pasted implementations; `syncOrchestratorVersion()`
  in `scripts/cli.js` reuses its changelog reader (a third copy) and gained `UNRELEASED` handling.
- **New** `syncRootVersion()` in `scripts/cli.js`, wired into `cmdBuildMaintain` — the workspace
  root was previously never synced or checked at all (the CLI banner reads the changelog directly,
  which is why the stale manifest went unnoticed).
- `scripts/check-version-sync.js` compares changelog vs manifest vs both lock version fields for
  all four modules. Reconciled: root 1.0.0→2.9.0, mcp-server 2.8.1→2.8.0, personas 3.32.0→3.31.0
  (the higher lock values were orphan lock-only commits with no changelog entry or tag).
- `.github/skills/release-check/SKILL.md` — corrected step 3b's false claim that `npm ci` catches
  lock/manifest version mismatch.
- **New** `scripts/tests/package-version.test.js`.

**2. `name-mapping.json` model-field gate** (resolves the build-churn noted below)
- `scripts/build-personas.js` emits `model` / `model_slug` / `cc_model` only when
  `personas/model-registry/local.json` or `assignments.json` exists. Naming fields stay
  unconditional — the MCP server bare-`require()`s this file at startup for `AGENT_NAMES`, so
  skipping generation outright would break startup on a fresh clone.
- `scripts/lib/persona-model-resolution.js` — `resolveModel()` now warns once per slug that
  matches no registry entry. This surfaced a real latent defect: the shipped `default.json` uses
  display-style slugs (`Claude Opus 4.6 (anthropic)`) while persona YAML uses API-style slugs
  (`claude-opus-4-6`), so `default.json` alone never satisfies a YAML lookup. Deliberately *not*
  auto-inferred from `cc_model` — that mapping is ambiguous (`claude-sonnet-4-6` → two entries).
- **New** `scripts/tests/name-mapping-model-gate.test.js`; docs updated in `AGENTS.md`,
  `personas/docs/persona-build-system.md`, and the personas manifest `data-flows.md`.

Verification after both: 226 tests passing (11 files), pre-commit clean, `npm ci` accepts every
rewritten lock file unchanged, and `npm install` no longer produces spurious lock churn.

### Additional Comments
- DEV mode was activated and then unlinked during validation; the workspace is back in PROD mode
  with no tracked-file changes from the linking process.
- `--skip-build` was used to validate the link path without a full sibling rebuild. Users editing
  a sibling should run `npm run dev` (tsup watch) there for live rebuilds — the symlink picks up
  each rebuild with no further action in `ai-insights`.
- The `personas/name-mapping.json` build churn referenced in the insights is now fixed by the
  model-field gate above, so builds on a machine without a local model registry no longer produce
  a spurious diff.
