# Research Brief

## Scope Sketch

- Health-check registry — `scripts/lib/health-checks.js` — modification (add a new `fast`-tier check; import a new hash-cache helper)
- Persona build pipeline — `scripts/build-personas.js` — modification (write a hash cache after a successful real build)
- New persona source-hash cache module — `scripts/lib/` — new code
- CLI status line + doctor command — `scripts/cli.js` — modification (`STATUS_LINES`, `cmdDoctor()`)
- New doctor-run history module — `scripts/lib/` — new code
- Tests — `scripts/tests/` — modification (`health-checks.test.js`) + new test files for the two new lib modules
- Documentation — `AGENTS.md` (Root-Level Tooling table), `docs/references/menu-guide.md` (Health Dashboard section), `.gitignore` — modification

## Area: Health-Check Registry (`scripts/lib/health-checks.js`)

### Verified References

- `scripts/lib/health-checks.js` (L1–19): module header documents the three cost tiers and a hard dependency-direction rule: "this file MUST NOT import from scripts/cli.js, SETUP_COMPONENTS, or any other file in scripts/ outside of scripts/lib/." It already imports `isCliLinked` from `./npm-link.js` (L25), confirming `scripts/lib/*.js` → `scripts/lib/*.js` imports are the established pattern for extending this registry.
- `scripts/lib/health-checks.js` (L109–116): `@typedef` block defines `SyncCheck` (`cost: 'instant'|'fast'`, `detect(): boolean`) and `SlowCheck` (`cost: 'slow'`, `detect(): Promise<boolean>`), plus `CheckResult = { id, label, passed, fix? }`.
- `scripts/lib/health-checks.js` (L121–303): `HEALTH_CHECKS` array, 12 entries total — 4 `instant`, 6 `fast`, 2 `slow`. The two `slow` entries are `global-cli-linked` (L271–281, spawns `npm ls -g --depth=0`) and `personas-fresh` (L283–301, spawns `node scripts/build-personas.js --check`, resolves `code === 0`).
- `scripts/lib/health-checks.js` (L320–358): `runChecks(costFilter)` — filters `HEALTH_CHECKS` by tier set (`instant`, `fast` = instant+fast, `slow`, `all` = everything), awaits `Promise`-returning `detect()` results, and returns `CheckResult[]` with `passed: Boolean(passed)`; any thrown error from `detect()` is caught and treated as `passed: false` (existing fail-safe precedent for check errors).
- `scripts/lib/health-checks.js` (L44–107): existing sync helpers `latestMtimeFlat(dir)`, `latestMtime(dir)` (recursive, catches unreadable dirs → `-Infinity`), and `lockfileFresh(dir)` — the established style for this file's detection helpers: synchronous, wrapped in `try/catch`, fail closed.

### Established Patterns

- Every `SyncCheck` entry is a plain object literal inline in the `HEALTH_CHECKS` array with a JSDoc `@type` annotation immediately above it — `scripts/lib/health-checks.js` L125–247.
- Detection logic that needs to be shared/testable independently is extracted into a named helper function above the registry (e.g. `lockfileFresh`), not inlined in `detect()` — `scripts/lib/health-checks.js` L88–107.
- `fix` strings are always a literal `ai-insights`/`node scripts/cli.js <command>` invocation string, matching an existing `COMMANDS` entry id in `scripts/cli.js`.

### Structural Observations

- `HEALTH_CHECKS` is a flat array literal (not a registry with metadata subclasses); adding a 13th entry for a new `fast`-tier "persona source hash fresh" check is a same-shape addition, not a restructure.
- The existing `personas-fresh` (`slow`) check's `detect()` spawns a full `build-personas.js --check` diff every time; this is the "ground truth" comparison the new fast hash-check will *not* replace (narrower guarantee — see plan Rationale).

### Constraints

- `runChecks()`'s slow-tier contract requires `detect()` to return a `Promise<boolean>`; instant/fast detectors must return a plain boolean synchronously (enforced by both the type comment and a runtime guard in `scripts/cli.js`'s `STATUS_LINES[0]`, L1237–1239, which reports `Promise` results as a check-contract violation on the status line itself).
- `scripts/tests/health-checks.test.js` (L26–65) hard-asserts `HEALTH_CHECKS` has **exactly 12 entries** and enumerates every expected `id` — any new entry requires updating this test file (count + id list) or the suite fails.

## Area: Persona Build Pipeline (`scripts/build-personas.js`)

### Verified References

- `scripts/build-personas.js` (L1–7): thin wrapper around `@mistralys/persona-builder`'s CLI binary; supports `--check` (read-only diff, aliased by `--dry-run`) and `--strict`.
- `scripts/build-personas.js` (L28): `const CHECK = process.argv.includes('--check') || process.argv.includes('--dry-run');` — the flag gating all "real build" side effects below.
- `scripts/build-personas.js` (L33–52): pre-build cleanup of output dirs, gated on `!CHECK`.
- `scripts/build-personas.js` (L54–63): delegates the actual build/check to the `@mistralys/persona-builder` CLI via `execFileSync`; exits with the child's status code on failure.
- `scripts/build-personas.js` (L65–86): post-build step 1 (`!CHECK`-gated) — syncs `personas/package.json` version from `personas/changelog.md`'s first `## v` heading.
- `scripts/build-personas.js` (L88–100+): post-build step 2 (`!CHECK`-gated) — regenerates `personas/name-mapping.json` from `personas/ledger/src/meta/*.yaml` filenames.
- This establishes the exact insertion point for a new post-build step: another `if (!CHECK) { ... }` block, placed after the existing two, that computes and persists the source hash. Never runs during `--check`/`--dry-run`, matching the "only a real build produces a trustworthy cache" requirement.

### Established Patterns

- All `!CHECK`-gated side effects are independent, sequential `if (!CHECK) { ... }` blocks with a leading `// Post-build: ...` comment — no shared "did we already build" flag or callback chain.
- Import style: named imports of small `scripts/lib/*.js` helper modules at the top of the file (`loadModelRegistry`, `resolveModel`, `parseYamlScalars`, `validateInsightFieldsInDirs`, etc. — L13–18).

### Constraints

- `ROOT` (`scripts/build-personas.js` L22) = `path.join(import.meta.dirname, '..')` = workspace root. `PERSONAS` (L23) = `path.join(ROOT, 'personas')`.
- The post-build steps must not throw on missing/malformed state in a way that aborts an otherwise-successful build; existing precedent (L72–73) is `console.warn(...)` and continue, not `process.exit`.

## Area: Persona Suite Source Directories (hash inputs)

### Verified References

- `personas/persona-build.config.js` (L78–125): defines `module.exports.sharedPartialsDir = path.join(ROOT, 'personas', 'shared', 'partials')` (L79) and three suites under `suites`, each with a `srcDir`:
  - `suites.ledger.srcDir` = `personas/ledger/src`
  - `suites.standalone.srcDir` = `personas/standalone/src`
  - `suites['ledger-support'].srcDir` = `personas/ledger-support/src`
- `personas/persona-build.config.js` (L19): `const { ledgerPlugin } = require('./plugins/ledger');` — resolves to `personas/plugins/ledger/index.js` (confirmed to exist; directory, not a single file — the plugin module has internal structure under `personas/plugins/ledger/`).
- `personas/persona-build.config.js` itself is a `require()`d CommonJS config file (L18, L34–125) that also defines frontmatter templates (e.g. `FRONTMATTER_STANDALONE_VSCODE`, L34–45) — a change to this file (e.g. editing a frontmatter template) changes build output without touching any suite `srcDir` or the shared partials dir.

### Established Patterns

- All suite directories and the shared partials directory are declared once, centrally, in `personas/persona-build.config.js` — no other file re-declares these paths; a new hash-cache helper must read them from this same config file (via `require()`, matching `build-personas.js`'s own `_require(CONFIG)` pattern at L34) rather than hardcoding a second copy of the suite path list.

### Structural Observations

- New code only — no existing structures in this area are being reshaped; the hash-cache module is additive.

### Constraints

- `personas/persona-build.config.js` is CommonJS (`'use strict'`, `require`/`module.exports`); `scripts/build-personas.js` and `scripts/lib/health-checks.js` are ESM (`import`/`export`). The existing `_require = createRequire(import.meta.url)` bridge in `build-personas.js` (L20) is the established interop pattern for ESM code reading this CJS config — a new hash-cache lib module needs the same bridge if it also reads `persona-build.config.js` directly.

## Area: CLI Status Line & Doctor Command (`scripts/cli.js`)

### Verified References

- `scripts/cli.js` (L44–45): imports `isCliLinked`, `linkCli` from `./lib/npm-link.js` and `HEALTH_CHECKS`, `runChecks` from `./lib/health-checks.js`.
- `scripts/cli.js` (L1229–1249): `STATUS_LINES` — currently a one-element array of `() => string` functions. The sole entry iterates `HEALTH_CHECKS.filter(c => c.cost === 'instant')` synchronously, builds a `failures[]` list (red `✗ {label} — {fix}` per failure, guarding against a `Promise` contract violation), and returns either `"✓ All checks passed"` (green) or the joined failure lines.
- `scripts/cli.js` (L587–604): `cmdDoctor()` — `await runChecks('all')`, then logs a green `✓`/red `✗` line per result (with an indented `fix` hint on failure), and `process.exit(1)` if any check failed.
- `scripts/cli.js` (L1131–1141): the `doctor` command descriptor in `COMMANDS` — `id: 'doctor'`, `key: 'v'`, `category: 'Validation & Utilities'`, `run: cmdDoctor`.
- `scripts/cli.js` (L1267–1280+): `createMenu({...})` call — `preflightChecks`, `setupComponents`, `categoryVersions` are passed here; `STATUS_LINES` itself is referenced elsewhere in the file (not shown in the read range) as the `statusLines` (or similar) option to `createMenu`.
- `scripts/lib/health-checks.js` (L186–194): `global-mcp-registered` check reads `path.join(os.homedir(), '.ai-insights', 'config.json')` — the established `os.homedir()`-based path for this workspace's single user-level state directory.

### Established Patterns

- `STATUS_LINES` is `Array<() => string>` — each function is independently responsible for its own rendering, including ANSI color via the imported `C` helper (`C.green`, `C.red`, `C.yellow`, `C.dim`) from `@mistralys/cli-menu`.
- `scripts/install-mcp-global.js` (L59): `const base = overrides.shimBaseDir ?? path.join(os.homedir(), '.ai-insights');` — establishes `~/.ai-insights/` as the workspace's one existing user-level (not per-checkout) persistent-state directory, already used for `config.json` (single `repoPath`) and the `bin/launch-server.js` shim.
- Both `scripts/install-mcp-global.js`'s `_resolvePaths()` (L58–66) and `scripts/lib/store-commands.js` (per its module doc comment) accept override parameters (e.g. `_storesDirOverride`) so tests can redirect file I/O into a temp directory instead of the real `~/.ai-insights/` — the established seam for testing code that touches this directory.

### Structural Observations

- `STATUS_LINES` currently has exactly one entry and no precedent for a second; extending it to two entries (instant health-check summary + doctor-staleness nudge) is additive, not a reshape — the array shape already supports N independent renderer functions.
- `cmdDoctor()` currently discards the `results` array after logging it (no persistence) — this is the gap the staleness-nudge feature fills; recording results is a net-new responsibility, not a reshape of existing logic.

### Constraints

- The existing `~/.ai-insights/` directory is implicitly single-repo in its current sole use (`config.json` stores one `repoPath` for the MCP shim) — there is no existing multi-checkout namespacing convention in this directory. A new doctor-run history file placed here inherits that same single-active-checkout assumption (see plan Assumptions).
- `os.homedir()`-based paths are already used without incident on all three supported OSes elsewhere in this codebase (`health-checks.js` L191, `install-mcp-global.js` L59) — no additional cross-platform risk from following the same pattern.

## Area: Tests (`scripts/tests/`)

### Verified References

- `scripts/tests/health-checks.test.js` (L1–18): documents AC-1 through AC-6 in its header comment; imports `{ HEALTH_CHECKS, runChecks }` from `../lib/health-checks.js`.
- `scripts/tests/health-checks.test.js` (L26–28): `it('contains exactly 12 entries', () => { expect(HEALTH_CHECKS).toHaveLength(12); });` — must become 13 once the new fast-tier check is added.
- `scripts/tests/health-checks.test.js` (L46–65): `it('contains all expected ids in any order', ...)` — enumerated `expected` array must gain the new check's id.
- `scripts/tests/health-checks.test.js` (L84–94): fast-tier `detect()` boolean-return test iterates `HEALTH_CHECKS.filter(c => c.cost === 'fast')` generically — the new fast check is automatically covered by this test with no edit needed, as long as its `detect()` returns a plain boolean.
- Sibling test files already exist for other new `scripts/lib/*.js` modules added in this same working session (per `git status`): `scripts/tests/claude-cli.test.js`, `scripts/tests/frontmatter.test.js`, `scripts/tests/launch-agent.test.js`, `scripts/tests/npm-link.test.js` — establishing one test file per new lib module as this workspace's granularity convention.

### Established Patterns

- Vitest (`describe`/`it`/`expect`), imported directly from `'vitest'` — no custom test harness.
- Test files import the module under test via a relative `../lib/*.js` path, matching the source file's own location under `scripts/lib/`.

### Constraints

- None beyond the existing count/id-list coupling noted above (this is itself the reason `AC-1` in `health-checks.test.js` must be revised as part of this work — recorded as a Documentation/Test Plan step, not a defect).

## Area: Documentation

### Verified References

- `AGENTS.md` (root, mirrored to `CLAUDE.md` — see `scripts/cli.js`'s `cmdCtxGenerate()` L571–580, which copies `AGENTS.md` → `CLAUDE.md` verbatim with a generated-file header) — Root-Level Tooling table contains an entry for `scripts/lib/health-checks.js` ("Shared health-check registry — checks across three cost tiers...") and `scripts/build-personas.js` ("thin wrapper around @mistralys/persona-builder..." — actually documented under the Root-Level Tooling table's `scripts/build-personas.js` row, described only briefly there since most detail lives in the personas manifest).
- `docs/references/menu-guide.md` (L16–27): "Health Dashboard" section — documents the instant-tier status-line table and states "The **Doctor** command runs a fuller set of checks including dependency freshness and persona staleness — see below." This section must be updated to mention (a) the new fast-tier hash check if it changes the instant-tier table's framing, and (b) the new staleness-nudge second status line.
- Manifest Maintenance Rules (`AGENTS.md`, Root-Level / Cross-Project table): "Add root-level script → Root `README.md`" and the general rule that new `scripts/lib/*.js` files are documented in the Root-Level Tooling table (established by every existing entry, e.g. `scripts/lib/ledger-dirs.js`, `scripts/lib/store-commands.js`).

### Established Patterns

- Every `scripts/lib/*.js` file has a one-paragraph entry in `AGENTS.md`'s Root-Level Tooling table describing its exported public API surface (e.g. the `scripts/lib/health-checks.js` row explicitly lists `HEALTH_CHECKS` and `runChecks(costFilter)`).

### Constraints

- `AGENTS.md` → `CLAUDE.md` sync is regenerated by `node scripts/cli.js ctx-generate`, not hand-edited into both files independently; the plan's Documentation Updates step should edit `AGENTS.md` only and note that `CLAUDE.md`/`.context/` regeneration is a separate, already-automated step (out of this plan's direct edit scope, but worth flagging as a follow-up command to run).
