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
- [added by: Plan Architect Reviewer, unverified] `scripts/lib/health-checks.js` (L196–208, L210–223): the two existing `fast`-tier entries `mcp-dist-fresh` and `overview-fresh` both compare `latestMtime(sourceDir) <= latestMtime(alreadyGeneratedOutputPath)` — an mtime-based freshness pattern with no separate cache file. This is the established in-repo alternative to hash-based freshness detection for this cost tier.
- [added by: Plan Architect Reviewer, unverified] `.gitignore` (L19–27): persona suite output directories are named `claude-code/`, `vs-code/`, `deep-agents/` under each suite dir (e.g. `personas/ledger/vs-code/`), alphabetically bracketing `src/` in two of three suites — relevant to any mtime-comparison check between a suite's `src/` and its output dirs, since git checkout does not guarantee causal (only alphabetical/readdir) file-write ordering.
- [added by: Plan Architect Reviewer, unverified] `folder-hash` (npm, MIT license, latest `4.1.3` published 2026-05-16): an actively maintained ecosystem library for hashing a directory tree, verified to exist but carrying two runtime dependencies (`debug`, `minimatch`) — a mismatch with this workspace's stdlib-only `scripts/lib/*.js` convention.

### Constraints

- `runChecks()`'s slow-tier contract requires `detect()` to return a `Promise<boolean>`; instant/fast detectors must return a plain boolean synchronously (enforced by both the type comment and a runtime guard in `scripts/cli.js`'s `STATUS_LINES[0]`, L1237–1239, which reports `Promise` results as a check-contract violation on the status line itself).
- `scripts/tests/health-checks.test.js` (L26–65) hard-asserts `HEALTH_CHECKS` has **exactly 12 entries** and enumerates every expected `id` — any new entry requires updating this test file (count + id list) or the suite fails.
- [added by: Plan Auditor, unverified] `scripts/lib/health-checks.js` (L227, L239, L251): `personas-deps-fresh`, `mcp-deps-fresh`, and `orchestrator-deps-fresh` are all placed under the `// ── fast tier` comment block but each declares `cost: 'instant'` (L229, L241, L253) — a pre-existing comment/field mismatch in this file. The registry's true tier distribution by `cost` field is **7 instant / 3 fast (`global-mcp-registered`, `mcp-dist-fresh`, `overview-fresh`) / 2 slow**, not "4 instant, 6 fast, 2 slow" as stated earlier in this Area's Verified References.

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
- `scripts/build-personas.js` (L54–63) exits immediately when the delegated persona-builder CLI fails, while its real-build post-processing starts afterward (L65 onward). A cache write must therefore be a third post-success `if (!CHECK)` block with its own `try/catch`, so it cannot create a cache after a failed build or turn a successful build into a failed one.
- [added by: Plan Auditor, unverified] `ROOT`/`PERSONAS` (L22–23) have no override parameter or env var — every invocation of `build-personas.js`, `--check` or real, always targets the live workspace's `personas/` directory. A real (non-`--check`) invocation's pre-build cleanup (L33–52) unlinks existing `.md` files under each suite's `outVscode`/`outClaudeCode`/`outputDirs['deep-agents']` before regenerating them, so a test that spawns a real build to observe the hash-cache write would also rewrite the checked-out generated persona files as a side effect.

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
- [added by: Plan Auditor, unverified] `personas/plugins/ledger/index.js` (L52: `MODEL_REGISTRY_DIR = path.join(__dirname, '..', '..', 'model-registry')`; L120: `_defaultRegistry = loadModelRegistry(MODEL_REGISTRY_DIR)` loaded at module scope; L152–286: `onBuildContext` resolves `model_slug`/`cc_model` from `personas/model-registry/{default,local,assignments}.json` for **every** persona, not suite-gated like `onSuiteInit`) — the resolved `cc_model` is rendered into Claude Code frontmatter for all three suites (`personas/persona-build.config.js` L58 `model: {{cc_model}}`; `personas/plugins/ledger/frontmatter-templates.js` L28 `model: '{{cc_model}}'`). `personas/model-registry/` is therefore a real build input affecting generated output, alongside the four paths this plan's hash-cache module already hashes, but is not itself one of them.

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
- `cmdDoctor()` currently discards the `results` array after logging it (no persistence) — this is the gap the staleness-nudge feature fills; recording results is a net-new responsibility, not a reshape of existing logic.- [added by: Plan Architect Reviewer, unverified] `@mistralys/cli-menu` (`src/menu/interactive.ts` L141\u2013169, `src/menu/renderer.ts` L21\u201346): `showInteractiveMenu()`'s `while(running)` loop calls `renderMenu(config)` again after every command run (not only once at menu startup), and `renderMenu()` invokes every `config.statusLines[]` function synchronously on each call \u2014 any per-render computation in a `STATUS_LINES` entry (e.g. a fresh file hash) repeats on every command return, not just once per session.
### Constraints

- The existing `~/.ai-insights/` directory is implicitly single-repo in its current sole use (`config.json` stores one `repoPath` for the MCP shim) — there is no existing multi-checkout namespacing convention in this directory. A new doctor-run history file placed here inherits that same single-active-checkout assumption (see plan Assumptions).
- `os.homedir()`-based paths are already used without incident on all three supported OSes elsewhere in this codebase (`health-checks.js` L191, `install-mcp-global.js` L59) — no additional cross-platform risk from following the same pattern.
- [added by: Plan Auditor, unverified] `scripts/cli.js` (L1270-1287): the file's entry point calls `createMenu({...}).run(process.argv.slice(2)).then(code => process.exit(code));` unconditionally at module top level (not inside a guarded `if (import.meta.url === ...)` block) — importing this file from a Vitest test would run the live CLI and call `process.exit`. This is why `scripts/tests/cli-cmd-agent.test.js` verifies `cli.js` via source-text regex assertions against the file's raw contents rather than importing and executing it. Any new logic added directly inline in `scripts/cli.js` (e.g., a `STATUS_LINES` renderer closure) inherits this same untestable-by-import constraint unless its decision logic is extracted into a separately importable `scripts/lib/*.js` function first.
- `scripts/cli.js` (L1232–1247) invokes selected synchronous `detect()` functions on every status render. Therefore a cache-identity-only freshness memo cannot meet a requirement to detect a hashed source edit made between two menu renders while the cache remains untouched; the detector must compare the current input hash on every call.

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
- `scripts/tests/cli-cmd-agent.test.js` (L18–79) reads an unimportable CLI file as text, extracts a named function body, and asserts imports and source fragments. The same non-mutating pattern can verify `scripts/build-personas.js` imports and calls `writePersonaHashCache()` behind `if (!CHECK)` after the delegated build, with a recovery `try/catch`.

### Constraints

- None beyond the existing count/id-list coupling noted above (this is itself the reason `AC-1` in `health-checks.test.js` must be revised as part of this work — recorded as a Documentation/Test Plan step, not a defect).
- [added by: Plan Auditor, unverified] `package.json` (root, L7–9): `"test": "npm run test:scripts"`, `"test:scripts": "vitest run scripts/tests/"` — no `pretest` script exists. `.github/workflows/ci.yml` has no job that runs root `npm test` / `vitest run scripts/tests/` at all (its jobs are `mcp-server-tests`, `orchestrator-tests`, `ruff`, `manifest-validation`, `persona-build-check` — none invoke the root Vitest suite). `.githooks/pre-commit` (L14) runs only `node scripts/build-personas.js --check` (never a real, non-`--check` build) before a commit. No existing mechanism in this workspace guarantees a real `build-personas.js` invocation has run — and therefore that `personas/.persona-build-cache.json` exists — before `scripts/tests/*.test.js` executes.

## Area: Documentation

### Verified References

- `AGENTS.md` (root, mirrored to `CLAUDE.md` — see `scripts/cli.js`'s `cmdCtxGenerate()` L571–580, which copies `AGENTS.md` → `CLAUDE.md` verbatim with a generated-file header) — Root-Level Tooling table contains an entry for `scripts/lib/health-checks.js` ("Shared health-check registry — checks across three cost tiers...") and `scripts/build-personas.js` ("thin wrapper around @mistralys/persona-builder..." — actually documented under the Root-Level Tooling table's `scripts/build-personas.js` row, described only briefly there since most detail lives in the personas manifest).
- `docs/references/menu-guide.md` (L16–27): "Health Dashboard" section — documents the instant-tier status-line table and states "The **Doctor** command runs a fuller set of checks including dependency freshness and persona staleness — see below." This section must be updated to mention (a) the new fast-tier hash check if it changes the instant-tier table's framing, and (b) the new staleness-nudge second status line.
- Manifest Maintenance Rules (`AGENTS.md`, Root-Level / Cross-Project table): "Add root-level script → Root `README.md`" and the general rule that new `scripts/lib/*.js` files are documented in the Root-Level Tooling table (established by every existing entry, e.g. `scripts/lib/ledger-dirs.js`, `scripts/lib/store-commands.js`).

### Established Patterns

- Every `scripts/lib/*.js` file has a one-paragraph entry in `AGENTS.md`'s Root-Level Tooling table describing its exported public API surface (e.g. the `scripts/lib/health-checks.js` row explicitly lists `HEALTH_CHECKS` and `runChecks(costFilter)`).

### Constraints

- `AGENTS.md` → `CLAUDE.md` sync is regenerated by `node scripts/cli.js ctx-generate`, not hand-edited into both files independently; the plan's Documentation Updates step should edit `AGENTS.md` only and note that `CLAUDE.md`/`.context/` regeneration is a separate, already-automated step (out of this plan's direct edit scope, but worth flagging as a follow-up command to run).
- [added by: Plan Auditor, unverified] `personas/README.md` (L20–29): the "Directory Structure" tree lists top-level `personas/` entries including `model-registry/local.json` and `model-registry/assignments.json`, each annotated `(gitignored)` — an established precedent of documenting gitignored build artefacts directly in this tree. A new top-level gitignored file (`personas/.persona-build-cache.json`) is not mentioned anywhere in this plan's Documentation Updates section.
- `AGENTS.md` Root-Level / Cross-Project maintenance table requires the root `README.md` when adding a root-level script. The new `scripts/lib/persona-hash-cache.js` and `scripts/lib/doctor-history.js` therefore require a concrete root README update alongside their Root-Level Tooling-table entries.

## Area: Architect Review Additions

- `personas/persona-build.config.js` (L19–20, L111–124): the config directly imports `../shared/workflow-manifest.json` and derives `manifestRoles` passed to `ledgerPlugin()`. The workflow manifest is therefore a direct workspace-owned build input in addition to the suite paths, shared partials, config, plugins, and model registry.
- `scripts/cli.js` (L208–224, L353–356): both the setup Personas component and `cmdSyncPersonas()` start `sync-personas.js` as a child process. A process-lifetime freshness boolean in the parent status renderer is not automatically invalidated after that child completes a successful build.
- `scripts/cli.js` (L587–604): `cmdDoctor()` currently bases its process exit only on `runChecks('all')` results. A doctor-history persistence failure needs explicit handling to avoid changing the command's health-derived outcome.
- [added by: Plan Auditor, unverified] `scripts/cli.js` (L1232–1247): each `STATUS_LINES` renderer invokes its selected check's `detect()` directly on every menu render; the current source has no per-render source-change invalidation hook.
- [added by: Plan Auditor, unverified] `scripts/build-personas.js` (L65–100, L367): current post-build `writeFileSync` operations are not enclosed by a broad best-effort error boundary; only the missing changelog-version condition is explicitly downgraded to `console.warn`.
- [added by: Plan Auditor, unverified] `scripts/tests/cli-cmd-agent.test.js` (L18–79): the established source-text test pattern can inspect named function bodies and imports in `scripts/cli.js` without importing its unguarded top-level entry point.
- [verified during audit integration] `scripts/build-personas.js` (L54–63) runs the delegated builder before every real-build post-processing block, providing a stable source-text ordering anchor for the cache-write wiring test.
- [added by: Plan Auditor, unverified] `scripts/cli.js` (L1232–1247): `STATUS_LINES[0]` invokes every selected synchronous `detect()` directly, without an individual error boundary; an `isPersonaSourceFresh()` traversal/read exception would escape the status renderer unless that detector fail-closes internally.
- [added by: Plan Auditor, unverified] `scripts/lib/health-checks.js` (L121–303): `HEALTH_CHECKS` is an ordered array, so `HEALTH_CHECKS.filter(c => c.cost === 'slow').map(c => c.id)` yields ids in registry order; a stored/current slow-check comparison must normalize order when its contract is set equality.
- [verified during audit-cycle-2 integration] `isPersonaSourceFresh()` must catch the full cache-read and resolved-input traversal/hash-computation path, returning `false` for every source traversal or read error. This is required because the synchronous status renderer has no per-detector error boundary.
- [verified during audit-cycle-2 integration] `writePersonaHashCache({ inputPaths, cachePath, writeCache = writeHashCache } = {})` provides the deterministic test-only write seam: it calls `writeCache(resolvedCachePath, hash)`, returns the delegate result, and propagates a delegate throw. Production calls the default with no options; `build-personas.js` remains the caller that catches the propagated error, warns, and continues.
- [verified during audit-cycle-2 integration] `buildStalenessLines()` must implement slow-check coverage as order-independent set equality: compare `Set` cardinality and membership, not array positions. Equal stored/current IDs in different registry orders preserve ordinary recency and prior-failure rendering.
- [added by: Plan Auditor, unverified] `personas/docs/agents/project-manifest/file-tree.md` (L9-L112): this curated manifest file tree inventories files under `personas/`, including generated and gitignored artifacts such as `name-mapping.json`, `model-registry/local.json`, and `model-registry/assignments.json`; the maintenance rules require `file-tree.md` when a file is added. A planned `personas/.persona-build-cache.json` needs a corresponding entry.

