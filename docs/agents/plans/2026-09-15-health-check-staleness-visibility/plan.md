# Plan

## Summary

The workspace's `slow`-tier health checks (`personas-fresh`, `global-cli-linked`) only run inside `doctor`, so a regression in either area is invisible on the everyday menu status line between `doctor` runs — a user can trust a green status that is actually stale. This plan adds two independent, additive pieces: (A) a hash-based `fast`-tier promotion for the self-contained `personas-fresh` check, letting its source-drift signal appear on every menu open without a subprocess spawn, while keeping the existing spawn-based full diff as `doctor`'s deeper ground truth; and (B) a staleness-nudge second status line that persists the outcome of every `doctor` run and surfaces, on every subsequent menu open, how long ago the last full check ran and whether any `slow`-tier check failed then and hasn't been re-verified since. `global-cli-linked` (and the existing `fast`-tier `global-mcp-registered`, which only checks config-file existence, not real IDE-registration validity) explicitly stay spawn/existence-check-based and `doctor`-only — externally-mutable state cannot be safely cached without reintroducing the exact false-confidence problem this plan solves.

## Architectural Context

`scripts/lib/health-checks.js` is the single source of health-check detection logic, exporting `HEALTH_CHECKS` (a flat array of `{id, label, cost, detect(), fix?}` entries across three cost tiers — `instant`, `fast`, `slow`) and `runChecks(costFilter)`. `scripts/cli.js` consumes this registry two ways: `STATUS_LINES` (currently one `() => string` renderer, run synchronously on every menu open, filtering to `instant`-tier checks only) and `cmdDoctor()` (`await runChecks('all')`, printing every tier's result and exiting non-zero on any failure). The persona build pipeline (`scripts/build-personas.js`) is a thin `!CHECK`-gated wrapper around `@mistralys/persona-builder`'s CLI, with two existing post-build side-effect steps (`personas/package.json` version sync, `personas/name-mapping.json` regeneration) that only run on a real build, never on `--check`/`--dry-run`. The workspace has exactly one existing user-level (not per-checkout) persistent-state directory, `~/.ai-insights/`, established by `scripts/install-mcp-global.js` for the MCP shim's `config.json` and reused by `health-checks.js`'s `global-mcp-registered` check.

## Approach / Architecture

**Piece A — hash-based fast-tier promotion for `personas-fresh`:**

1. New module `scripts/lib/persona-hash-cache.js` exports `computeSourceHash(inputPaths)` (a deterministic SHA-256 over every file's `relativePath\0content` pair across the given paths, sorted for OS-independent ordering), `readHashCache(cachePath)` / `writeHashCache(cachePath, hash)` (JSON `{ hash, generatedAt }`, fail-safe: any read/parse error returns `null`), and `isPersonaSourceFresh({ cachePath, inputPaths } = {})` (the synchronous boolean used directly as a `detect()` function — `false` whenever the cache is missing, corrupt, or its hash disagrees with a freshly recomputed one). Default `inputPaths` are read from `personas/persona-build.config.js` via the same `createRequire()` ESM/CJS bridge `build-personas.js` already uses (L20), rather than hardcoding a second copy of the suite path list: the three suites' `srcDir`s, `sharedPartialsDir`, plus `persona-build.config.js` itself and the `personas/plugins/` directory (both affect build output without living under a suite `srcDir`).
2. `scripts/build-personas.js` gains a third `if (!CHECK) { ... }` post-build block (matching the existing two) that computes the hash of the same input paths and calls `writeHashCache()` — only a real, successful build produces a trustworthy cache entry.
3. `scripts/lib/health-checks.js` gains one new `fast`-tier entry, `personas-hash-fresh` (label: "Personas source unchanged since last build"), whose `detect()` is `isPersonaSourceFresh()`. The existing `slow`-tier `personas-fresh` entry (full spawn-based diff via `build-personas.js --check`) is **not** removed or renamed — it remains `doctor`'s deeper ground-truth check, since the hash comparison is a deliberately narrower guarantee (see Rationale).

**Piece B — staleness-nudge status line:**

4. New module `scripts/lib/doctor-history.js` exports `HISTORY_PATH` (`~/.ai-insights/last-doctor-run.json`, following the existing `global-mcp-registered` / `install-mcp-global.js` precedent for this directory), `writeDoctorRun(results, historyPath)` (persists `{ ranAt: <ISO8601>, results: [{id, label, passed}, ...] }`, creating the parent directory if absent), and `readDoctorRun(historyPath)` (fail-safe: any read/parse error, or a missing file, returns `null` — never a false "last run passed").
5. `scripts/cli.js`'s `cmdDoctor()` calls `writeDoctorRun(results)` immediately after `runChecks('all')` resolves, unconditionally (including when checks fail — the whole point is recording the true last-known state, not just successes).
6. `scripts/cli.js`'s `STATUS_LINES` gains a second renderer function that reads `readDoctorRun()` and:
   - Renders `"⚠ Full check never run — run \`ai-insights doctor\`"` (yellow) when the history file is absent/corrupt.
   - Otherwise renders a dimmed recency line ("Last full check: N day(s) ago") plus, for every currently-registered `slow`-tier check id present in the recorded results with `passed: false`, a distinct yellow warning line ("⚠ {label} — last verified N day(s) ago, FAILED then"). It never asserts a `slow`-tier check "passes" from cached data — passing `slow` checks from the last run are only implied by the shared recency line, never individually re-asserted as current.

Both pieces are purely additive: no existing `detect()` contracts, `HEALTH_CHECKS` entries, or `runChecks()` behavior change.

## Rationale

The hash-based check is legitimate to cache because `personas-fresh` is self-contained — only `build-personas.js`, this workspace's own tooling, can regenerate persona output — matching the plan's stated acceptance criterion for when caching is safe. `global-cli-linked` and `global-mcp-registered` are deliberately excluded from any caching scheme because their underlying state is externally mutable (`npm unlink`, an `nvm` switch, a cleared global `node_modules`, IDE config edited by hand); an optimistic "still true" cache for those would keep reporting green after a silent drift, which is strictly worse than today's "simply not shown between `doctor` runs" gap, since it would look like a positive signal instead of an absent one.

The hash check deliberately keeps the existing slow full-diff check alongside it rather than replacing it, because the two provide different guarantees: the hash only detects changes to source *inputs* (suite `srcDir`s, shared partials, the build config, the ledger plugin), while `build-personas.js --check`'s full template-render diff also catches drift in the *generated output itself* — e.g. a hand-edited `.md` file under `personas/ledger/vs-code/` that no longer matches what the current source would regenerate, with the source hash unchanged. This is a real, narrower guarantee, not a strict subset of the old check's coverage, and is called out explicitly here rather than silently accepted: the fast hash check is a cheap **early signal** surfaced on every menu open; `doctor`'s existing slow full-diff check remains the authoritative verification.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| `personas-fresh` fast-tier promotion | Add a new `fast`-tier check (`personas-hash-fresh`) alongside the unchanged `slow`-tier `personas-fresh` | Replace `personas-fresh` in place, changing its `cost` to `fast` and swapping its `detect()` to the hash comparison | Replacing in place would silently narrow `doctor`'s guarantee (loses hand-edited-output-drift detection) with no visible signal that the check's meaning changed; coexistence keeps `doctor` a strict superset of what the status line shows and makes the narrower/broader distinction an explicit, documented design choice instead of a silent regression |
| Doctor-run history storage location | `~/.ai-insights/last-doctor-run.json` (user-level, single file) | (a) A workspace-local, gitignored file (matching `personas/model-registry/local.json`'s precedent); (b) per-checkout namespacing inside a multi-key JSON file | (a) A workspace-local file would need per-branch/per-worktree awareness this workspace has no existing convention for, and would vanish on `git clean`, defeating the "don't lose staleness signal" goal; (b) `~/.ai-insights/` already encodes a single-active-checkout assumption via `config.json`'s single `repoPath` (see Assumptions) — namespacing only this one file would be inconsistent with that existing precedent for no present benefit |
| Persona source hash inputs | Suite `srcDir`s + `sharedPartialsDir` + `persona-build.config.js` + `personas/plugins/` (read from the config file itself, not hardcoded) | Hash only the three suite `srcDir`s (matching the narrowest literal reading of "source templates") | Excluding the build config and plugin code would silently miss a real class of drift (e.g. editing a frontmatter template in `persona-build.config.js` changes output with zero change under any `srcDir`) — including them costs nothing (still a synchronous, dependency-free file hash) and closes an otherwise-obvious blind spot |
| Staleness-nudge rendering | A second `STATUS_LINES` entry, always-instant (single file read + timestamp diff, no spawn) | Fold the staleness message into the existing single `STATUS_LINES[0]` renderer | `STATUS_LINES` is already `Array<() => string>`, explicitly designed for independent renderer functions; merging the two would conflate "live instant-tier results" with "cached slow-tier history," two different trust levels that the whole point of this feature is to keep visually distinct |

## Pattern Alignment

- Follows the established `scripts/lib/*.js` single-responsibility module shape (alongside `npm-link.js`, `claude-cli.js`, `store-commands.js`) for both new modules — no departure.
- Follows `health-checks.js`'s existing rule that detection logic needing independent testability is a named exported helper, not an inline `detect()` closure (matching `lockfileFresh`) — `isPersonaSourceFresh()` follows this shape.
- Follows `build-personas.js`'s existing `if (!CHECK) { ... }` sequential post-build-step pattern (version sync, name-mapping regeneration) — the new hash-cache write is a third block in the same shape, not a new mechanism.
- Follows `install-mcp-global.js`'s precedent of accepting an override parameter (e.g. `historyPath`/`cachePath` arguments defaulting to the real path) so tests can redirect file I/O into a temp directory — both new modules adopt this seam.
- Departs from nothing in `HEALTH_CHECKS`'s array-literal registry shape — the new entry is added the same way every existing entry was added.

## Structural Improvements

New code only for both new modules (`scripts/lib/persona-hash-cache.js`, `scripts/lib/doctor-history.js`) — no existing structures are reshaped there.

| Structure | Observation | Decision | Reason |
|-----------|-------------|----------|--------|
| `scripts/tests/health-checks.test.js` hardcoded entry count (`toHaveLength(12)`) and enumerated id list | A new registry entry breaks this test unless updated | Promoted to step 7 | Directly required by the new `personas-hash-fresh` entry; not optional |
| `cmdDoctor()`'s discarded `results` array (no persistence today) | Gap this plan exists to fill | Promoted to step 5 | Net-new responsibility already in scope, not a pre-existing defect requiring separate justification |
| `docs/references/menu-guide.md`'s Health Dashboard section (static instant-tier-only table + one-line Doctor mention) | Now describes only part of what the status line renders once this plan ships | Promoted to step 10 (Documentation Updates) | In the direct blast radius of the change — the table would otherwise become inaccurate |

## Detailed Steps

1. Create `scripts/lib/persona-hash-cache.js`: implement `computeSourceHash(inputPaths)` (recursive file walk per input path — treat each input as either a directory, recursed, or a single file; sort collected `{relativePath, content}` pairs by relative path; feed a `crypto.createHash('sha256')` update per pair; return the hex digest), `readHashCache(cachePath)`, `writeHashCache(cachePath, hash)`, and `isPersonaSourceFresh({ cachePath, inputPaths } = {})`. Resolve default `inputPaths` by `require()`-ing `personas/persona-build.config.js` (via `createRequire(import.meta.url)`, matching `build-personas.js` L20) and collecting each suite's `srcDir`, `sharedPartialsDir`, the config file's own path, and `personas/plugins/`. Default `cachePath` = `path.join(WORKSPACE_ROOT, 'personas', '.persona-build-cache.json')`.
2. Add `/personas/.persona-build-cache.json` to `.gitignore`, grouped with the existing `/personas/model-registry/local.json` / `/personas/model-registry/assignments.json` gitignored-cache entries.
3. Edit `scripts/build-personas.js`: add a third `if (!CHECK) { ... }` block after the existing name-mapping regeneration step, importing `computeSourceHash`/`writeHashCache` from the new module and writing the cache using the same default input paths and cache path the health check will read.
4. Edit `scripts/lib/health-checks.js`: import `isPersonaSourceFresh` from `./persona-hash-cache.js`; add a new `fast`-tier entry (`id: 'personas-hash-fresh'`, `label: 'Personas source unchanged since last build'`, `detect: isPersonaSourceFresh`, `fix: 'node scripts/cli.js sync-personas'`) directly below the existing `personas-deps-fresh`/`mcp-deps-fresh`/`orchestrator-deps-fresh` fast-tier group, keeping the existing `slow`-tier `personas-fresh` entry unchanged.
5. Create `scripts/lib/doctor-history.js`: implement `HISTORY_PATH` (`path.join(os.homedir(), '.ai-insights', 'last-doctor-run.json')`), `writeDoctorRun(results, historyPath = HISTORY_PATH)` (`fs.mkdirSync(path.dirname(historyPath), { recursive: true })` then a JSON write of `{ ranAt: new Date().toISOString(), results }`), and `readDoctorRun(historyPath = HISTORY_PATH)` (fail-safe `try/catch` returning `null`).
6. Edit `scripts/cli.js`'s `cmdDoctor()`: after `const results = await runChecks('all');`, call `writeDoctorRun(results)` (import from `./lib/doctor-history.js`), before the existing per-result logging loop.
7. Edit `scripts/cli.js`'s `STATUS_LINES`: append a second renderer function. It calls `readDoctorRun()`; if `null`, returns the "never run" yellow line; otherwise computes days-since-`ranAt`, builds the dimmed recency line, and appends one yellow warning line per `slow`-tier `HEALTH_CHECKS` id whose most recent recorded result has `passed: false` (cross-referencing `HEALTH_CHECKS.filter(c => c.cost === 'slow')` so a since-removed/renamed check id in old history data is silently skipped, not shown as an error).
8. Update `scripts/tests/health-checks.test.js`: bump the entry-count assertion to 13 and add `'personas-hash-fresh'` to the enumerated expected-ids array (AC-1). No other existing assertions need edits — the generic fast-tier boolean-return test (AC-2b) automatically covers the new entry.
9. Create `scripts/tests/persona-hash-cache.test.js` and `scripts/tests/doctor-history.test.js` (see Test Plan for obligations) — following the one-test-file-per-new-lib-module convention already established this session (`claude-cli.test.js`, `frontmatter.test.js`, `npm-link.test.js`).
10. Update documentation (see Documentation Updates).

## Dependencies

- Step 4 depends on step 1 (the health check imports `isPersonaSourceFresh`).
- Step 3 depends on step 1 (the build script imports the same hash/cache functions).
- Step 6 depends on step 5 (`cmdDoctor()` imports `writeDoctorRun`).
- Step 7 depends on step 5 (the status-line renderer imports `readDoctorRun`) and on step 4 conceptually (it cross-references `HEALTH_CHECKS`'s current `slow`-tier ids, already present before this plan).
- Step 8 depends on step 4 (the new registry entry must exist before the test assertion is updated).
- Step 9 depends on steps 1 and 5 (both modules must exist before their tests are written).
- Step 2 has no code dependency but should land alongside step 1 to avoid an uncommitted cache artefact accidentally being staged.

## Required Components

- `scripts/lib/persona-hash-cache.js` — new
- `scripts/lib/doctor-history.js` — new
- `scripts/lib/health-checks.js` — modified (new registry entry + import)
- `scripts/build-personas.js` — modified (new post-build block)
- `scripts/cli.js` — modified (`cmdDoctor()`, `STATUS_LINES`, new imports)
- `scripts/tests/health-checks.test.js` — modified
- `scripts/tests/persona-hash-cache.test.js` — new
- `scripts/tests/doctor-history.test.js` — new
- `.gitignore` — modified
- `AGENTS.md` — modified
- `docs/references/menu-guide.md` — modified

## Assumptions

- Exactly one active checkout of this workspace exists per user machine at a time, matching the existing `~/.ai-insights/config.json` single-`repoPath` precedent — the new `last-doctor-run.json` inherits this same assumption rather than introducing per-checkout namespacing that no other file in this directory has.
- `personas/persona-build.config.js`'s exported `suites` and `sharedPartialsDir` fields remain the authoritative, sole declaration of persona source locations (per existing Structural Observations) — the hash-cache module reads them rather than hardcoding a duplicate path list, so it stays correct if a suite is added/removed/moved in the future.
- A cache write failure (e.g. a read-only `personas/` directory) during `build-personas.js`'s post-build step should warn and continue, not fail the build — matching the existing precedent at L72–73 for the version-sync step's missing-changelog-entry case.

## Constraints

- Cross-platform: both new modules use only `fs`, `path`, `os`, `crypto` (all cross-platform stdlib), `path.join`/`path.resolve` exclusively for path construction, and no shell-dependent operations — consistent with AGENTS.md's Cross-Platform Policy.
- `scripts/lib/health-checks.js` must not import from `scripts/cli.js` or `SETUP_COMPONENTS` (existing header constraint, L17-18) — `persona-hash-cache.js` must likewise avoid importing from `scripts/cli.js`.
- Cache/history reads must fail safe: any missing file, unreadable file, or JSON parse error must be treated as "not fresh" / "never run" — never as a false positive. This applies to `readHashCache`, `isPersonaSourceFresh`, and `readDoctorRun` alike.
- `personas-hash-fresh`'s `detect()` must remain synchronous and return a plain boolean (no `Promise`), satisfying the existing `fast`-tier contract enforced by `scripts/tests/health-checks.test.js`'s AC-2b and `STATUS_LINES[0]`'s runtime `Promise`-guard.

## Out of Scope

- Any caching or tier change for `global-cli-linked` (stays `slow`, spawn-based, `doctor`-only) or `global-mcp-registered` (stays `fast`, existence-check-based) — both are externally-mutable state where an optimistic cache would actively regress trust, per this plan's Background. `global-mcp-registered`'s known limitation (config-file existence is not proof of real IDE-registration validity) is a pre-existing condition, documented here as a caveat, not addressed by this plan.
- Any change to `build-personas.js --check`'s existing full-diff behavior or exit codes.
- A UI/config toggle to disable the staleness-nudge line — it always renders once history exists, matching every other `STATUS_LINES` entry's unconditional-render convention.
- Retroactively backfilling `last-doctor-run.json` for users who have already run `doctor` before this plan ships — the first post-upgrade `doctor` run naturally establishes the baseline; before that, the status line correctly shows "never run."

## Acceptance Criteria

- AC-01: `HEALTH_CHECKS` contains a new `fast`-tier entry `personas-hash-fresh` whose `detect()` returns `true` immediately after a real `build-personas.js` run (cache freshly written) and `false` when any file under a hashed input path changes afterward, without spawning a subprocess.
- AC-02: The existing `slow`-tier `personas-fresh` entry (spawn-based full diff) is unchanged in id, label, cost, and behavior.
- AC-03: `isPersonaSourceFresh()` returns `false` (not throw, not `true`) when the cache file is missing, unreadable, or contains malformed JSON.
- AC-04: `build-personas.js` (real build, not `--check`/`--dry-run`) writes a hash cache reflecting the current state of the suite `srcDir`s, `sharedPartialsDir`, `persona-build.config.js`, and `personas/plugins/`; running with `--check`/`--dry-run` does not write or modify the cache.
- AC-05: `cmdDoctor()` persists a `last-doctor-run.json` record (timestamp + per-check id/label/passed) after every `doctor` invocation, including runs where one or more checks fail.
- AC-06: The status line shows a distinct "never run" message when no doctor-run history exists, and never renders any staleness-related line claiming a `slow`-tier check "passes" based purely on cached data.
- AC-07: When the last recorded `doctor` run included a failing `slow`-tier check, the status line shows a warning line naming that check and how long ago it was last verified, on every menu open until the next `doctor` run re-verifies it.
- AC-08: All new `detect()`/status-line functions remain cross-platform (no hardcoded path separators, no shell-only utilities) and complete well within the `fast`/`instant` tier's documented latency budgets (no subprocess spawns).

## Testing Strategy

Unit tests via Vitest under `scripts/tests/`, matching this workspace's existing convention for `scripts/lib/*.js` modules (no live subprocess spawns in the new tests; all file I/O redirected into a Vitest-managed temp directory via each function's override parameter — `cachePath`/`inputPaths` for the hash-cache module, `historyPath` for the doctor-history module). The existing `scripts/tests/health-checks.test.js` suite is extended, not restructured, to keep the generic tier-shape assertions (AC-2, AC-2b, AC-3, AC-4) automatically covering the new entry.

## Test Plan

- `scripts/tests/persona-hash-cache.test.js` — `computeSourceHash()` returns identical output for identical directory content regardless of filesystem read order (build a temp dir, hash twice with shuffled intermediate state) — AC-01
- `scripts/tests/persona-hash-cache.test.js` — `computeSourceHash()` output changes when any file's content changes under a hashed input path — AC-01
- `scripts/tests/persona-hash-cache.test.js` — `isPersonaSourceFresh()` returns `true` immediately after `writeHashCache(computeSourceHash(paths))` with unchanged `paths` — AC-01
- `scripts/tests/persona-hash-cache.test.js` — `isPersonaSourceFresh()` returns `false` after a tracked file is modified post-cache-write — AC-01
- `scripts/tests/persona-hash-cache.test.js` — `readHashCache()` / `isPersonaSourceFresh()` return `null`/`false` (not throw) for a missing cache file — AC-03
- `scripts/tests/persona-hash-cache.test.js` — `readHashCache()` / `isPersonaSourceFresh()` return `null`/`false` (not throw) for a corrupt (non-JSON) cache file — AC-03
- `scripts/tests/health-checks.test.js` — updated `toHaveLength(13)` and expected-id-list assertions include `personas-hash-fresh` — AC-01, AC-02
- `scripts/tests/health-checks.test.js` — the unchanged `personas-fresh` entry still reports `cost: 'slow'` and the same `id`/`label` — AC-02
- `scripts/tests/doctor-history.test.js` — `writeDoctorRun()` followed by `readDoctorRun()` round-trips `ranAt` and `results` — AC-05
- `scripts/tests/doctor-history.test.js` — `readDoctorRun()` returns `null` for a missing history file — AC-06
- `scripts/tests/doctor-history.test.js` — `readDoctorRun()` returns `null` (not throw) for a corrupt history file — AC-06
- `scripts/tests/doctor-history.test.js` — `writeDoctorRun()` creates the parent directory when absent (temp-dir path with no pre-existing subdirectory) — AC-05
- A new test in `scripts/tests/health-checks.test.js` (or a dedicated `build-personas` test, whichever the existing suite already covers `build-personas.js` from — verify at implementation time) confirming `--check`/`--dry-run` invocations never call `writeHashCache` — AC-04

## Documentation Updates

- `AGENTS.md` (root) — Root-Level Tooling table: add rows for `scripts/lib/persona-hash-cache.js` and `scripts/lib/doctor-history.js` (public exports, one-paragraph each, matching the existing `scripts/lib/health-checks.js` row's style); amend the existing `scripts/lib/health-checks.js` row to mention the new `personas-hash-fresh` fast-tier entry; amend the existing `scripts/build-personas.js` row to mention the new post-build hash-cache write.
- `docs/references/menu-guide.md` — Health Dashboard section: note that the status line now has two parts (live instant-tier results, plus a doctor-run staleness/recency line), and mention that `personas-hash-fresh` gives an early (narrower-guarantee) signal on every menu open while `doctor`'s full `personas-fresh` diff remains the authoritative check.
- Run `node scripts/cli.js ctx-generate` after the `AGENTS.md` edit lands, to regenerate `CLAUDE.md` and the `.context/` snapshot — flagged here as a required follow-up command, not a direct file edit in this plan's steps (per the workspace's own automated sync mechanism).

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **The narrower hash-check guarantee is misunderstood as a full replacement for `doctor`'s deep check, and a future contributor later removes the slow check as "redundant."** | Explicitly documented in this plan's Rationale and in the `menu-guide.md` update; the `personas-hash-fresh` check's own label ("source unchanged since last build") is phrased to avoid implying full build-output correctness. |
| **Hashing large persona source trees on every menu open adds perceptible latency, violating the `fast`-tier budget.** | Persona source trees are small, text-only Markdown/YAML (this workspace's own existing `latestMtime()` full-recursive-walk helper already performs a comparable walk over the same trees at `fast`-tier cost); if a future measurement shows otherwise, the check can fall back to an mtime-based short-circuit before hashing, without changing its public contract. |
| **`~/.ai-insights/last-doctor-run.json` silently accumulates stale state across unrelated checkouts if a user switches repos without realizing the assumption.** | Documented explicitly in Assumptions and Out of Scope; matches the pre-existing single-checkout assumption already baked into `config.json` in the same directory, so this plan introduces no new class of risk beyond what already exists. |
| **A `slow`-tier check id is renamed/removed in a future change, and old `last-doctor-run.json` data references a since-vanished id.** | `STATUS_LINES`'s new renderer cross-references against the *current* `HEALTH_CHECKS` slow-tier id set (step 7) and silently skips unmatched history entries rather than erroring or showing a misleading label. |
