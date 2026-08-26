# Plan

## Plan Audit Cycles
- Audits: 2 — Plan Auditor v1.9.0
- Architectural Reviews: 1 — Plan Architect Reviewer v2.3.0

## Prior Project Context

The repository's **short-term strategic goal** is minimising setup and daily-usage friction, and
the **long-term secondary goal** is reliability across Windows, Linux, and macOS. Both bear
directly on this plan: the current `.githooks/pre-commit` implements five of its six guards with
`grep` pipelines, which means that on native Windows Git every guard except the persona freshness
check silently no-ops — a contributor on Windows can commit in DEV mode, with a drifted version, or
with a `file:` contaminated lock file, and nothing stops them. That is a live gap against the
declared reliability goal, not a cosmetic one.

Two knowledge-base insights shaped the design:

- *"Add a structural-invariant test harness when migrating to a declarative route table"*
  (`96efc4fa`) — assert structural invariants (non-empty, no duplicate ids) rather than hard-coded
  counts. This is the direct prescription for the `toHaveLength(12)` debt in
  `scripts/tests/health-checks.test.js`.
- *"Null-guard tests can be tautologically true when the test fixture path is deeper than expected
  on the target OS"* (`0ec86e04`) — when testing guards against temp-dir fixtures, verify each
  assertion is actually falsifiable rather than vacuously true.

This plan is a Synthesis Rework of `docs/agents/plans/2026-08-25-local-dev-linking/synthesis.md`.
It addresses the six code insights that were recorded but not acted on in that session. The two
insights the previous session already resolved in-flight (version-sync lock coverage, and the
`name-mapping.json` model-field gate) are out of scope here.

## Summary

Address the outstanding code insights from the `2026-08-25-local-dev-linking` synthesis. The
substantive change is extracting the blocking pre-commit guards out of the POSIX shell hook into a
cross-platform, unit-testable Node module — closing a real Windows reliability gap and satisfying
the workspace's own "no Unix-only utilities in root scripts" policy. Alongside it: two test-suite
debt items (a brittle registry count assertion and a flaky sub-5-second timeout), a DEV-mode
advisory in the pre-menu bootstrap, and a silent column-overflow defect in the sibling `cli-menu`
help renderer that the previous session worked around rather than fixed.

## Architectural Context

**Root scripts layering.** The workspace consistently separates importable logic in
`scripts/lib/*.js` from runnable entry points in `scripts/*.js`. Established pairs:
`scripts/lib/store-commands.js` ↔ `scripts/cli.js`, `scripts/lib/package-version.js` ↔
`scripts/check-version-sync.js`, `scripts/lib/health-checks.js` ↔ both `scripts/cli.js` and
`scripts/preflight-orchestrator.js`. All are ESM (`"type": "module"` in the root
[package.json](package.json)) and resolve the workspace root via `import.meta.dirname`.

**Health-check registry.** [scripts/lib/health-checks.js](scripts/lib/health-checks.js) is the
single source of detection logic across three cost tiers. Its file header declares a one-way
dependency rule: it must not import from `scripts/cli.js` or anything in `scripts/` outside
`scripts/lib/`. Importing *from* it into another `scripts/lib/` module is therefore allowed —
[scripts/preflight-orchestrator.js](scripts/preflight-orchestrator.js#L40-L46) already does this,
resolving a `HEALTH_CHECKS` entry by id with a hard-throw guard when the id is missing. The
`dev-links-inactive` instant check owns the `.dev-links.json` predicate outright; every consumer
of that predicate — the pre-commit hook, and now the bootstrap advisory below — must resolve it
from this one registry rather than re-deriving the marker path.

**Pre-commit hook.** [.githooks/pre-commit](.githooks/pre-commit) is activated by
[scripts/install-hooks.js](scripts/install-hooks.js), which does nothing but
`git config core.hooksPath .githooks` — it never generates or copies hook content, so the hook file
can be restructured freely without touching the installer. The hook's first block (L4–L12) extends
`PATH` with Homebrew, `/usr/local/bin`, Volta, and nvm locations and hard-fails when `node` is
still unresolvable. That block is load-bearing: it is the only reason `node` is callable at all
inside a Git hook, and it must stay in shell.

**Test suite.** [vitest.config.ts](vitest.config.ts) includes `scripts/tests/**/*.test.{js,ts}`
with no `testTimeout` override, so Vitest's 5-second default applies. Two harness patterns are
established: temp-dir isolation via `fs.mkdtempSync(path.join(os.tmpdir(), …))`
([scripts/tests/store-commands.test.js](scripts/tests/store-commands.test.js#L40-L60)) and
copy-the-script-into-a-sandbox-then-`spawnSync`
([scripts/tests/dev-link.test.js](scripts/tests/dev-link.test.js#L34-L59)).

**Sibling `cli-menu`.** The help renderer is
[cli-menu/src/help.ts](../../../../cli-menu/src/help.ts), a self-contained module whose
`formatEntry()` pads a name to `CMD_WIDTH = 28` and concatenates the dim description. The library
operates under a documented zero-production-dependency invariant and a no-`process.exit()`
invariant. `ai-insights` consumes it at `^1.1.0`.

## Approach / Architecture

Five independent workstreams, only one of which is architecturally significant.

**1. Extract the pre-commit guards into Node.** Introduce `scripts/lib/precommit-guards.js` holding
every guard as a pure-ish function returning a structured result, plus a runnable
`scripts/precommit-guards.js` that executes them in order and maps results onto an exit code. The
shell hook shrinks to the PATH block plus `exec node scripts/precommit-guards.js`. Following the
user's decision, the advisory warnings move too — the hook becomes a thin wrapper with no guard
logic of its own.

The guard module replaces the `grep` pipelines with `child_process` + JavaScript string work:
`git diff --cached --name-only` for the staged file list, `git diff --cached -- <file>` for the
added-lines scan. Two guards that today shell out to a separate `node` process
(`build-personas.js --check`, `check-version-sync.js`) keep doing exactly that via `spawnSync`,
because both are already independently runnable and independently tested — re-importing their
internals would couple the guard module to their implementation for no gain.

The DEV-mode guard consumes the existing `dev-links-inactive` entry from
[scripts/lib/health-checks.js](scripts/lib/health-checks.js) by id rather than re-deriving the
marker path, following the lookup-plus-hard-throw precedent in
[scripts/preflight-orchestrator.js](scripts/preflight-orchestrator.js#L40-L46).

**2. Structural invariants replace the registry count.** Swap `toHaveLength(12)` for a non-empty
assertion plus a duplicate-id assertion. The existing per-id `toContain` presence checks and
per-entry shape checks already provide the real coverage; the count assertion only produced
maintenance churn.

**3. Explicit timeout on the `storeList` block.** The root cause is not AC-4 specifically — every
`storeList` test awaits `listAllProjectDirs()`, which mtime-walks `mcp-server/src/` and may spawn a
full `npm run build`. Apply an explicit `15_000` timeout to all four tests in the block, matching
the pattern already used in `scripts/tests/health-checks.test.js`.

**4. Add a DEV-mode advisory to the bootstrap.** Resolve the `dev-links-inactive` check from
`HEALTH_CHECKS` by id with a hard-throw guard when the id is missing — the same lookup shape
`preflight-orchestrator.js` already uses — rather than a raw, independent
`fs.existsSync('.dev-links.json')` literal, in
[scripts/preflight-bootstrap.js](scripts/preflight-bootstrap.js). It prints a `[Bootstrap]`-prefixed
warning and leaves the exit code untouched. `menu.sh` and `menu.cmd` both route through this file,
so one edit covers both platforms.

**5. Make the help-column overflow visible.** In `cli-menu`, `formatEntry()` gains a minimum
single-space separator so an over-width label can never butt against its description, and the
`CMD_WIDTH` limit gets documented and asserted. Truncation is deliberately not chosen — silently
cutting a command name would make help output wrong rather than merely ugly.

## Rationale

- **A thin shell shim over a Node implementation** is the only shape that satisfies both
  constraints simultaneously: Git requires an executable hook file and the minimal-PATH problem
  must be solved in shell, while the guard logic must be cross-platform and unit-testable.
- **`lib/` + runnable split** matches four existing precedents in this workspace and is what makes
  the guards testable without spawning `git`.
- **Reusing `dev-links-inactive`** rather than re-deriving `.dev-links.json` keeps the marker path
  in one place; `AGENTS.md` already tracks that path as a cross-system dependency with three
  named consumers.
- **Both new consumers of the `dev-links-inactive` predicate** — the pre-commit guard module and
  the bootstrap advisory — resolve it the same way, by id with a hard-throw guard, so a future
  marker rename is caught in one place instead of silently desyncing a second copy.
- **Structural invariants over counts** is a knowledge-base-endorsed pattern and costs the same
  number of lines as the assertion it replaces.
- **Timeout over test rewrite** for `storeList`: the slowness is inherent to the dist-freshness
  guard in `ledger-dirs.js`, which is correct behaviour. Mocking it out would weaken the test.
- **Separator over truncation** in `help.ts`: an over-width label is a caller-side formatting
  problem. The library's job is to never render two fields fused together; deciding to shorten the
  label remains the caller's.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| DEV-mode advisory in the bootstrap | Consume `dev-links-inactive` from `HEALTH_CHECKS` by id (hard-throw if missing) | Raw `fs.existsSync('.dev-links.json')` literal | The raw literal would create a third independent implementation of the same predicate (guard module by id, `HEALTH_CHECKS` canonical, now this literal), undermining the "one owner for the marker path" claim made one row above. Consuming by id costs one import and one `.find()` instead of one `existsSync` call, and matches both the guard module's own `devModeInactive()` and `preflight-orchestrator.js`'s `hcMcpDist` lookup. |
| Pre-commit guard portability | Thin shell shim → `scripts/precommit-guards.js` (Node) | (a) Keep shell, accept Windows gap; (b) full Node hook with a `#!/usr/bin/env node` shebang and no shell; (c) add a `husky`-style dependency | (a) leaves the reliability gap open against a declared strategic goal. (b) breaks the minimal-PATH problem — Git hooks on macOS/Linux frequently cannot resolve `node` without the existing PATH block. (c) adds a production tool dependency for something 60 lines of stdlib solves. |
| Guard module placement | `scripts/lib/precommit-guards.js` + `scripts/precommit-guards.js` | Single runnable `scripts/precommit-guards.js` with everything inline | The split matches four existing pairs and is the only way to unit-test individual guards without spawning `git`; a single file would force every test through a subprocess. |
| Persona / version-sync guards | Keep spawning them as subprocesses | Import `build-personas.js` and `check-version-sync.js` internals directly | Both are already independently runnable and tested, and both call `process.exit`. Importing them would couple the guard module to their exit semantics for no measurable speed gain. |
| Advisory warnings | Move into the Node module alongside the blocking guards | Leave advisories in shell, move only blocking guards | Per the user's decision. Also avoids a split-brain hook where half the logic is testable and half is not, and gives the advisories Windows support too. |
| DEV-mode marker detection in the guard | Consume `dev-links-inactive` from `HEALTH_CHECKS` by id | Re-derive `path.join(WORKSPACE_ROOT, '.dev-links.json')` locally | One owner for the marker path. The lookup-with-hard-throw pattern already guards against silent breakage on rename (`preflight-orchestrator.js`). |
| `storeList` flakiness | Explicit `15_000` timeout on all four tests in the block | (a) Timeout on AC-4 only; (b) global `testTimeout` in `vitest.config.ts`; (c) mock `listAllProjectDirs` | (a) treats the symptom — every test in the block shares the same slow dependency. (b) hides genuine hangs across the whole suite. (c) removes the integration coverage that makes the test worth having. |
| Registry count assertion | Non-empty + no-duplicate-ids invariants | (a) Keep and bump the count; (b) delete the test outright | (a) is the status quo debt. (b) loses the duplicate-id catch, which is a real defect class the current suite does not cover. |
| `help.ts` over-width handling | Guarantee a minimum one-space separator | (a) Truncate the label with an ellipsis; (b) `console.warn` on overflow; (c) auto-widen the column to the longest entry | (a) renders a wrong command name — worse than ugly. (b) violates the library's quiet-by-default posture and pollutes piped output. (c) is a visual regression for every consumer whose columns would suddenly shift. |
| `cli-menu` release | Source + tests + docs only | Bump version, update CHANGELOG, publish, bump the `ai-insights` dependency | Explicitly reserved by the user. |

## Pattern Alignment

- **Follows** the `scripts/lib/` logic + `scripts/` runnable split established by
  [scripts/lib/store-commands.js](scripts/lib/store-commands.js),
  [scripts/lib/package-version.js](scripts/lib/package-version.js), and — applied twice in
  this plan: once by the guard module's `devModeInactive()` and once by the bootstrap advisory, so
  the `.dev-links.json` predicate has exactly one owner across all three call sites
  [scripts/lib/ledger-dirs.js](scripts/lib/ledger-dirs.js).
- **Follows** the `HEALTH_CHECKS.find(c => c.id === …)` + hard-throw-on-missing lookup pattern from
  [scripts/preflight-orchestrator.js](scripts/preflight-orchestrator.js#L40-L46).
- **Adapts** the temp-dir isolation convention from
  [scripts/tests/dev-link.test.js](scripts/tests/dev-link.test.js) — that file's own sandbox
  pattern copies a script into a temp dir and spawns it, whereas the new `git init` repository
  fixture is itself a new pattern — and follows the AC-enumerating test file header convention
  used by every file in `scripts/tests/`.
- **Follows** the cross-platform spawn idiom (`npm.cmd` on Win32, `shell: isWindows`) from
  [scripts/lib/ledger-dirs.js](scripts/lib/ledger-dirs.js#L61-L67).
- **Follows** the `[Bootstrap] ` log prefix already used throughout
  [scripts/preflight-bootstrap.js](scripts/preflight-bootstrap.js).
- **Corrects a departure**: the existing hook violates `AGENTS.md` → Cross-Platform Policy rule 3
  ("root-level scripts must not rely on Unix-only utilities"). This plan brings it into compliance
  rather than introducing a new pattern.
- **Follows** `cli-menu` constraint §1 (zero production dependencies) and §2 (no `process.exit()`
  in library code) — the `help.ts` change is pure string formatting.
- **Deliberate departure — none.** No new architectural pattern is introduced by this plan.

## Detailed Steps

1. **Create `scripts/lib/precommit-guards.js`.** Export one function per guard, each returning
   `{ id, blocking, passed, messages: string[] }`:
   - `personaFreshness()` — `spawnSync` `node scripts/build-personas.js --check`; blocking.
   - `versionSync()` — `spawnSync` `node scripts/check-version-sync.js`; blocking.
   - `devModeInactive()` — resolve `dev-links-inactive` from `HEALTH_CHECKS` by id (throw if the id
     is absent) and call its `detect()`; blocking; failure message points at
     `node scripts/cli.js dev-unlink`.
   - `noFileProtocolInLocks(stagedFiles)` — for each staged path ending in `package-lock.json`, run
     `git diff --cached -- <file>`, split on line boundaries, and fail when any line starting with
     `+` (excluding the `+++` header) contains `"file:`; blocking.
   - `ruffLint(stagedFiles)` — when any staged path matches `orchestrator/src/**.py`, resolve
     `ruff` from the four candidate paths currently in the hook (`.venv/bin/ruff`,
     `.venv/Scripts/ruff.exe`, `.venv/Scripts/ruff`, then `PATH`) and spawn
     `ruff check orchestrator/src/`; blocking when it fails, advisory-skip when `ruff` is absent.
   - `contextStaleness(stagedFiles)` — advisory; source staged under
     `mcp-server/src/`, `orchestrator/src/`, `personas/`, `scripts/`, or `shared/` with nothing
     staged under `.context/`.
   - `changelogDrift(stagedFiles)` — advisory; a sub-project changelog staged without the root
     `changelog.md`.
   Also export `getStagedFiles()` (a `git diff --cached --name-only` wrapper returning a normalised
   `string[]`) and `GUARDS` — an ordered array of the guard descriptors so the runner iterates a
   declarative list rather than a hardcoded sequence.
2. **Create `scripts/precommit-guards.js`.** Iterate `GUARDS` in order, print each guard's messages,
   short-circuit on the first blocking failure, and finish with `process.exit(main())` per the
   [scripts/dev-link.js](scripts/dev-link.js#L318) convention. Advisory failures print but never
   affect the exit code.
3. **Reduce `.githooks/pre-commit`** to the existing PATH-extension block, the `command -v node`
   guard, and `exec node scripts/precommit-guards.js`. Delete every `grep` pipeline from the file.
4. **Add `scripts/tests/precommit-guards.test.js`.** Build a temp Git repository fixture
   (`git init` + `git add`) so `getStagedFiles()` and the lock-file diff scan run against real
   `git` output, and unit-test the pure predicates directly.
5. **Fix the registry assertion** in
   [scripts/tests/health-checks.test.js](scripts/tests/health-checks.test.js#L26-L28): replace
   `toHaveLength(12)` with a non-empty assertion plus a duplicate-id assertion built from
   `HEALTH_CHECKS`'s own ids.
6. **Add explicit timeouts to the `storeList` tests.** Apply a `15_000` timeout to all four tests
   in the `storeList` describe block in
   [scripts/tests/store-commands.test.js](scripts/tests/store-commands.test.js#L152-L194), matching
   the existing `15_000`-timeout pattern already used in
   [scripts/tests/health-checks.test.js](scripts/tests/health-checks.test.js).
7. **Add the DEV-mode advisory** to [scripts/preflight-bootstrap.js](scripts/preflight-bootstrap.js):
   import `HEALTH_CHECKS` from `./lib/health-checks.js`, resolve the `dev-links-inactive` entry by
   id (throw if the id is absent, matching the `hcMcpDist` lookup in
   [scripts/preflight-orchestrator.js](scripts/preflight-orchestrator.js#L40-L46)), and print a
   `[Bootstrap]`-prefixed warning naming `node scripts/cli.js dev-unlink` when `!check.detect()`,
   placed before the install/rebuild work so it is visible ahead of any long-running step. Exit
   code unchanged.
8. **Activate DEV mode** for the sibling edit: `node scripts/cli.js dev-link --package cli-menu`.
9. **Fix `formatEntry()`** in [cli-menu/src/help.ts](../../../../cli-menu/src/help.ts#L10-L12) so a
   name at or beyond `CMD_WIDTH` is still followed by at least one space before the description.
   Keep `CMD_WIDTH` at 28 and keep the function pure.
10. **Add over-width coverage** to [cli-menu/tests/help.test.ts](../../../../cli-menu/tests/help.test.ts):
    a command id longer than 28 characters and a `helpVariants` entry longer than 28 characters,
    each asserting the separator survives; keep the existing 1-char padding test unchanged.
11. **Document the width limit** in `cli-menu/docs/configuration.md` (the `helpVariants` /
    `HelpVariant` reference) and in `cli-menu/docs/agents/project-manifest/data-flows.md` §7 Help
    Rendering.
12. **Rebuild and verify propagation:** `npm run build` in `cli-menu`, then `node scripts/cli.js help`
    from `ai-insights` to confirm the column renders correctly against the linked build.
13. **Update `ai-insights` documentation:** add the `scripts/lib/precommit-guards.js` and
    `scripts/precommit-guards.js` rows to the `AGENTS.md` Root-Level Tooling table; update the
    "Sibling package linking" Cross-System Dependencies row to name the Node guard module as the
    enforcement point (with `.githooks/pre-commit` as the shim); update
    `docs/references/development.md` §"Mode Marker and Guards" and §"Pre-Commit Hook" to describe
    the new structure and state that the guards now run on Windows.
14. **Regenerate derived docs:** `node scripts/cli.js ctx-generate` (regenerates `CLAUDE.md` and
    `.context/`). Never hand-edit `CLAUDE.md`.
15. **Return to PROD mode:** `node scripts/cli.js dev-unlink`, then confirm `git status` shows no
    modification to any `package.json` or `package-lock.json`.

## Dependencies

- Steps 1–3 are sequential; step 4 depends on step 1.
- Steps 5, 6, 7 are independent of everything else and of each other.
- Steps 9–12 depend on step 8 (DEV mode active).
- Step 13 depends on steps 1–3; step 14 depends on step 13.
- Step 15 must run last and depends on step 12.
- Requires `git` on `PATH` inside the hook environment (already true — Git invokes the hook).
- Requires the `cli-menu` sibling repo present at `../cli-menu` for steps 8–12; `dev-link` warns
  and skips when it is absent, which would block this workstream.

## Required Components

- **New:** `scripts/lib/precommit-guards.js`
- **New:** `scripts/precommit-guards.js`
- **New:** `scripts/tests/precommit-guards.test.js`
- Modified: `.githooks/pre-commit`
- Modified: `scripts/preflight-bootstrap.js`
- Modified: `scripts/tests/health-checks.test.js`
- Modified: `scripts/tests/store-commands.test.js`
- Modified: `AGENTS.md`, `docs/references/development.md`
- Generated: `CLAUDE.md`, `.context/**` (via `ctx-generate`)
- Modified (sibling repo `cli-menu`): `src/help.ts`, `tests/help.test.ts`,
  `docs/configuration.md`, `docs/agents/project-manifest/data-flows.md`

## Assumptions

- `git` is invocable via `child_process` from within the hook process on all three platforms.
- The four `ruff` resolution paths currently hardcoded in the shell hook remain correct; the Node
  port reproduces them verbatim rather than redesigning venv discovery.
- `node scripts/build-personas.js --check` and `node scripts/check-version-sync.js` keep their
  current exit-code contract (0 = pass, non-zero = fail).
- The four-path `ruff` resolution in the guard module deliberately duplicates the shape of the
  `venvBin()` helper in
  [scripts/preflight-orchestrator.js](scripts/preflight-orchestrator.js#L47-L51) rather than
  extracting a shared helper — consolidating would mean editing an already-tested file with no
  other planned changes in this plan; worth revisiting if a third venv-binary lookup appears.
- The `cli-menu` sibling repo is checked out at `../cli-menu` relative to the workspace root.
- No CI job invokes `.githooks/pre-commit` directly — verified: the five CI jobs listed in
  `docs/references/development.md` run their checks as standalone commands.

## Constraints

- `.dev-links.json` must never be committed; DEV mode blocks commits by design.
- `package.json` and `package-lock.json` must remain untouched throughout the DEV/PROD cycle.
- `scripts/lib/health-checks.js` must not gain an import from outside `scripts/lib/`.
- `cli-menu` must remain zero-production-dependency and must not call `process.exit()` in library
  code.
- Root scripts must use Node built-ins only — no `grep`, `sed`, or other Unix-only utilities.
- Tests must not write to the real workspace root and must not invoke `npm link`.
- `CLAUDE.md` is generated; edit `AGENTS.md` and regenerate.

## Out of Scope

- Bumping the `cli-menu` version, writing its CHANGELOG entry, publishing to npm, or updating the
  `@mistralys/cli-menu` dependency range in the root `package.json` — the user handles releases.
- The `ai-persona-builder` sibling package — untouched by this plan.
- Any change to `mcp-server/`, `orchestrator/`, or `personas/` source.
- Redesigning venv/ruff discovery, or adding new guards beyond the six that exist today.
- The two insights already resolved in the parent session (version-sync lock coverage, the
  `name-mapping.json` model-field gate).
- Auto-widening or theming the help column layout.

## Acceptance Criteria

- AC-01: `.githooks/pre-commit` contains no `grep`, `sed`, or other Unix-only utility invocation;
  its only non-PATH content is the `node` availability guard and a delegation to
  `scripts/precommit-guards.js`.
- AC-02: `node scripts/precommit-guards.js` exits 0 on a clean working tree and exits 1 when any
  blocking guard fails.
- AC-03: The DEV-mode guard blocks a commit while `.dev-links.json` exists and names
  `node scripts/cli.js dev-unlink` in its output.
- AC-04: The lock-file guard blocks a staged `package-lock.json` that **adds** a `"file:` resolved
  path, and does **not** block one that only removes such a line.
- AC-05: The persona-freshness and version-sync guards block on failure, preserving the behaviour
  of the current hook.
- AC-06: The ruff guard runs only when `orchestrator/src/**.py` is staged, blocks on lint failure,
  and prints a non-blocking warning when `ruff` cannot be resolved.
- AC-07: The two advisory guards (`.context/` staleness, changelog drift) print their warnings but
  never change the exit code.
- AC-08: `scripts/tests/health-checks.test.js` asserts a non-empty registry and unique ids, and
  contains no hard-coded entry count.
- AC-09: All four tests in the `storeList` describe block carry an explicit `15_000` timeout and
  pass under a full parallel `npm test` run.
- AC-10: `node scripts/preflight-bootstrap.js` prints a DEV-mode warning when `.dev-links.json`
  exists and exits 0 regardless.
- AC-11: `printHelp()` in `cli-menu` renders at least one space between a command name at or
  beyond `CMD_WIDTH` characters and its description, for both command ids and `helpVariants`
  entries.
- AC-12: `npm test` passes in `ai-insights` (root scripts suite) and `npm test` passes in
  `cli-menu`.
- AC-13: After the full DEV → PROD cycle, `git status` reports no modification to any
  `package.json` or `package-lock.json` in either repository.
- AC-14: `AGENTS.md` and `docs/references/development.md` describe the Node guard module, and
  `CLAUDE.md` / `.context/` are regenerated rather than hand-edited.

## Testing Strategy

Guard logic is tested at two levels: pure predicates are called directly with synthetic staged-file
lists, and the `git`-dependent guards run against a throwaway `git init` repository built in a
temp directory, adapting the temp-dir isolation convention from `scripts/tests/dev-link.test.js`
(the git-repo fixture construction itself is new — that file's own pattern copies a script into a
temp dir and spawns it). No test writes to the real workspace root, invokes `npm link`, or installs
a Git hook. The `cli-menu` change is
covered by extending the existing `printHelp()` spy harness with over-width fixtures. Each new
assertion is checked for falsifiability — per insight `0cd6accc`, a guard test that passes because
the fixture never reaches the guard is worse than no test.

Manual verification covers the end-to-end hook path on macOS (a real `git commit` attempt in each
blocked state) plus the DEV → PROD round trip.

## Test Plan

- `scripts/tests/precommit-guards.test.js` — `getStagedFiles()` returns the staged paths from a
  temp `git init` repo and an empty array when nothing is staged — AC-02
- `scripts/tests/precommit-guards.test.js` — `devModeInactive()` fails when a `.dev-links.json`
  fixture exists and passes when it does not; failure message contains `dev-unlink` — AC-03
- `scripts/tests/precommit-guards.test.js` — `devModeInactive()` throws when the
  `dev-links-inactive` id is absent from the injected registry — AC-03
- `scripts/tests/precommit-guards.test.js` — `noFileProtocolInLocks()` fails on a staged lock diff
  that adds a `"file:` line — AC-04
- `scripts/tests/precommit-guards.test.js` — `noFileProtocolInLocks()` passes when a `"file:` line
  is only removed (leading `-`), and passes when the string appears solely in the `+++` header —
  AC-04
- `scripts/tests/precommit-guards.test.js` — `ruffLint()` is skipped (passed, no spawn) when no
  `orchestrator/src/**.py` path is staged — AC-06
- `scripts/tests/precommit-guards.test.js` — `ruffLint()` returns a non-blocking warning when no
  ruff binary resolves — AC-06
- `scripts/tests/precommit-guards.test.js` — `contextStaleness()` and `changelogDrift()` return
  `blocking: false` on failure — AC-07
- `scripts/tests/precommit-guards.test.js` — the runner exits 1 on the first blocking failure and 0
  when only advisories fail — AC-02, AC-07
- `scripts/tests/precommit-guards.test.js` — `GUARDS` is non-empty and every entry has a unique
  `id` — AC-02
- `scripts/tests/health-checks.test.js` — registry is non-empty and all `id` values are unique
  (replaces `contains exactly 12 entries`) — AC-08
- `scripts/tests/store-commands.test.js` — the four `storeList` tests carry `15_000` timeouts and
  pass under full-suite parallel load — AC-09
- `cli-menu/tests/help.test.ts` — a command id of 30 characters renders with at least one space
  before its dim description — AC-11
- `cli-menu/tests/help.test.ts` — a `helpVariants` label of 30 characters renders with at least one
  space before its dim description — AC-11
- `cli-menu/tests/help.test.ts` — the existing 1-char padding assertion still passes unchanged
  (regression guard) — AC-11
- Manual — real `git commit` blocked in each of the four blocking states on macOS — AC-02, AC-05
- Manual — `node scripts/preflight-bootstrap.js` with and without the marker; exit code 0 both
  times — AC-10
- Manual — `git status` clean for all manifests after `dev-link` → `dev-unlink` — AC-13

## Documentation Updates

- `AGENTS.md` → Root-Level Tooling — add rows for `scripts/lib/precommit-guards.js` (guard
  registry and predicates) and `scripts/precommit-guards.js` (runner invoked by the hook)
- `AGENTS.md` → Cross-System Dependencies, "Sibling package linking" row — name
  `scripts/lib/precommit-guards.js` as the DEV-mode and `file:`-lock enforcement point, with
  `.githooks/pre-commit` described as a thin shim
- `AGENTS.md` → Cross-Platform Policy, "Existing Cross-Platform Implementations" table — add a row
  for the pre-commit guards
- `docs/references/development.md` §"Mode Marker and Guards" — update the pre-commit bullet to
  reference the Node module and state that the guards now run on Windows
- `docs/references/development.md` §"Pre-Commit Hook" — describe the shim + Node runner structure
  and list the six guards with their blocking/advisory classification
- `docs/references/development.md` §"Key Scripts (Advanced)" — add a
  `node scripts/precommit-guards.js` row (no menu equivalent)
- `CLAUDE.md` and `.context/**` — regenerate via `node scripts/cli.js ctx-generate`
- `cli-menu/docs/configuration.md` — document the `CMD_WIDTH` = 28 column limit under
  `helpVariants` / `HelpVariant`
- `cli-menu/docs/agents/project-manifest/data-flows.md` §7 Help Rendering — note the minimum
  separator behaviour for over-width names

## Deferred Items

| # | Deferred Item | Origin | Reason Deferred | Notes |
|---|---------------|--------|-----------------|-------|
| 1 | Switch `scripts/dev-link.js` from `process.exit(main())` to `process.exitCode` | Synthesis §Code Insights, low/convention | Conditional on an unobserved defect — the insight itself says "if stdout truncation is ever observed on Windows". No evidence exists yet, and the current form matches every sibling script. | Revisit if a Windows contributor reports truncated `dev-link` output. |
| 2 | `cli-menu` version bump, CHANGELOG entry, npm publish, and `ai-insights` dependency bump | User decision during scope confirmation | Release management is handled by the user, not by this plan. | The `help.ts` fix reaches PROD mode only after this happens. |
| 3 | Auto-widening the help column to the longest registered label | Derived from the `CMD_WIDTH` insight | A visual regression risk for every existing consumer; the minimum-separator fix resolves the reported defect at a fraction of the blast radius. | Reconsider if multiple consumers report persistent over-width labels. |

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **The rewritten hook silently stops blocking, making the guard worse than the shell version** | Manual verification of every blocking state with a real `git commit` (AC-02 through AC-06), plus unit tests asserting exit-code propagation per guard. Verify each test is falsifiable, not vacuously passing. |
| **`git` invocation from Node behaves differently inside a hook (env, cwd) than in a test** | Invoke `git` with an explicit `cwd` of the workspace root rather than relying on the inherited cwd, and confirm with a real commit attempt on macOS. |
| **Node is unresolvable in the hook environment on a contributor machine** | Keep the existing PATH-extension block and the `command -v node` hard-fail untouched at the top of the shim — the failure mode is identical to today's. |
| **Advisory guards accidentally become blocking during the port** | Encode `blocking` as an explicit field on every guard descriptor and assert it in tests (AC-07); the runner reads the field rather than inferring from the return value. |
| **The `cli-menu` fix cannot be verified because the sibling repo is absent** | `dev-link` warns and skips rather than failing. If the repo is absent, halt steps 8–12 and report rather than editing blind. |
| **DEV mode is left active at the end of the session** | Step 15 is mandatory and AC-13 asserts a clean manifest diff; the pre-commit guard itself also blocks the commit while the marker exists. |
| **`ctx-generate` produces a large incidental diff** | Run it as its own step after all source edits are final, and review the diff before staging. |

## Recommended Workflow
- **Workflow:** ledger
- **Rationale:** The work spans two repositories, introduces a new module that replaces a
  safety-critical guard path, and carries a real risk of silently weakening enforcement — which
  warrants formal QA and review stages rather than self-review.
