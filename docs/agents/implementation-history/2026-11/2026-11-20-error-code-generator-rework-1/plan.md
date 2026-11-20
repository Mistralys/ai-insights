# Plan

## Plan Audit Cycles
- Audits: 1 (Sonnet 5.5 ×1) — Plan Auditor v1.13.1
- Architectural Reviews: 1 (Sonnet 5.5 ×1) — Plan Architect Reviewer v2.5.1

## Prior Project Context

- **Source:** `docs/agents/plans/2026-11-19-error-code-generator/synthesis.md` (13/13 WPs complete, 4499 mcp-server tests passing). This plan covers its follow-up items that sit inside the error-code feature, plus one tooling gap the same run exposed.
- **Strategic vision:** the short-term goal is low-friction setup and daily use. A symlinked plugin that is silently ignored, or an MCP server that hangs at startup because of a plugin, both work against it. The secondary long-term goal is cross-platform reliability, which shapes the symlink tests (Windows privileges) and the file-mode change (no effect on Windows).
- **Insight 39ca30b5** (a `--check` mode should reuse the real generation path): shapes step 6. Both the overview's write path and its check path go through one shared render function.
- **Insight 77cd0cdc** (verify a regeneration claim by the freshness of its timestamp): step 6 overtakes it. See Knowledge Base Reconciliation.
- **Re-verified and dropped (2026-11-20):** `initProviderRegistry()` concurrency (each call swaps in a complete new registry, last call wins, nothing corrupts); hex IPv4-mapped loopback forms (Node never reports them); the "missing WIP marker" on mcp-server v2.11.0 (v2.11.0 is released, so no marker is correct).

## Knowledge Base Reconciliation

| Insight ID | Title | What the plan overtakes | Executed by |
|------------|-------|-------------------------|-------------|
| 77cd0cdc-7857-45dc-83f4-430064902b89 | Verify a regeneration claim with a timestamp-freshness check, not a content diff | The insight says a generator that embeds a run-time timestamp "can never produce a true no-op diff — any run changes at least the timestamp line", and uses the agents overview generator as its example. After step 6, `docs/references/agents-overview.md` is rewritten only when content other than the date line changed. An old timestamp then means "nothing changed since that date", not "the generator did not run", so the technique no longer works for this generator. The insight should be narrowed to generators that always rewrite their timestamp, with the overview named as an exception. | Ledger Knowledge Curator v1.4.2 (Targeted Reconciliation) |

## Summary

This plan reworks `docs/agents/plans/2026-11-19-error-code-generator/` from its synthesis and closes the follow-up items that sit inside that feature:

1. The Error Codes tab's Save action gets the same module-level in-flight guard as Test connection.
2. `temporary-codes.json` is written `0600`, like the `config.json` beside it.
3. The plugin loader follows symlinked plugin entries and reports dangling links, instead of skipping them silently.
4. Each plugin import gets a timeout, so one hanging plugin can no longer block MCP or GUI server startup.
5. The persona build keeps `docs/references/agents-overview.md` current itself. A real `build-personas.js` run regenerates the overview, and `--check` (the command CI runs) fails when it is stale. This closes the gap that let WP-006 ship a stale overview.

The ledger routing loop after a rework (synthesis "Process follow-up") is out of scope. It is handled on the AI Insights branch `feature-pipeline-adjustments`.

## Architectural Context

- **Error Codes GUI tab:** `mcp-server/gui/public/views/config-error-codes.js` is an ES5 no-build view. Module state is a set of `ec*` variables documented in its header block. `ecHandleTestClick` guards re-entry with `ecTestInFlight`. `ecHandleSave` relies only on the Save button's DOM `disabled` attribute, which a second `submit` event or `form.requestSubmit()` bypasses. Frontend changes require a `?v=N` bump in `mcp-server/gui/public/index.html` (GUI `constraints.md`).
- **Error-code storage:** `mcp-server/src/error-codes/config-store.ts` and `temporary-codes.ts` both write into `resolveErrorCodesDir()` (`~/.ai-insights/error-codes/`) through `atomicWriteJson` (`mcp-server/src/storage/atomic-writer.ts`). Its `mode` option is applied when the temp file is created, so every write produces a file with that mode. Only `config-store.ts` passes `0o600`. The `file` provider's counter file (`providers/file-provider.ts`) can live inside a repository and is deliberately left at default permissions.
- **Plugin loader:** `mcp-server/src/error-codes/plugin-loader.ts` → `loadPluginProviders(pluginDir)` scans one fixed directory with `readdir(…, { withFileTypes: true })`. It accepts `*.mjs`/`*.js` files and folders (`package.json` `main` or `index.mjs`), imports each with `import(pathToFileURL(…).href)`, validates the default export, and records every failure in `errors` without throwing. `mcp-server/src/index.ts` (L65) and `mcp-server/gui/server.ts` (L1567) both `await initProviderRegistry(...)` during startup, before the MCP STDIO connect and before the GUI starts listening.
- **Persona build tooling:** `scripts/build-personas.js` wraps the persona-builder CLI. Real builds only: it runs post-steps (package version sync, `personas/name-mapping.json` via `scripts/lib/name-mapping.js`). Every invocation: it runs a `runBuildChecks()` descriptor list (`scripts/lib/build-checks.js`) and exits once. `scripts/generate-agents-overview.js` is a top-level script that writes or checks the overview and exports nothing. `scripts/cli.js` → `cmdBuildMaintain` runs `build-personas.js`, then `generate-agents-overview.js`, and stops at the first failure. CI (`.github/workflows/ci.yml` L122–L126) runs `build-personas.js` and `build-personas.js --check`, and never checks the overview.

## Approach / Architecture

### A. Save in-flight guard (GUI)

Add a module-level `ecSaveInFlight` boolean, documented in the header block beside `ecTestInFlight`. `ecHandleSave` returns before validation when the flag is set. It sets the flag immediately before `API.updateErrorCodeConfig(body)` and clears it as the **first** statement of both the `.then` and the `.catch` callbacks. Clearing it first in `.then` means the `ecRenderTab()` re-render that follows starts from a clean state. Validation failures (`reportValidity()` false, `core === null`, no provider) return before the flag is set, so they never leave it stuck. `ecCleanup()` deliberately does **not** reset the flag. A PUT still pending when the user leaves and re-enters the tab still blocks a second save until it settles. Bump `config-error-codes.js?v=1` to `?v=2`.

### B. Temporary-codes file mode

In `issueTemporaryCode`, pass `{ mode: 0o600 }` to `atomicWriteJson`. Add a module constant (`TEMPORARY_CODES_FILE_MODE = 0o600`) with a doc comment explaining why: entries carry `context`, `repository` and provider `detail` text. Because the mode is applied on every write, an existing file written with wider permissions is tightened on its next issuance. No migration step is needed. On Windows the change has no effect (documented in `atomic-writer.ts`).

### C. Plugin loader: entry classification, symlinks and import timeout

1. **Entry classification** becomes a private function, `classifyEntry(entry, entryPath)`, returning `'file' | 'directory' | 'dangling-link' | 'other'`. For `entry.isSymbolicLink()` it calls `stat(entryPath)` (`stat` follows links) and classifies by the target. A failing `stat` (dangling link, or a loop) returns `'dangling-link'`. The scan loop then dispatches on the result:
   - `file`: the existing `*.mjs`/`*.js` path. The extension check uses the **link's** name, which is the name the user sees in the plugin directory.
   - `directory`: the existing folder path, with `resolveFolderEntryPath(entryPath)` on the link path.
   - `dangling-link`: a load error such as `symbolic link target is missing or unreadable` with `source` = the link path. It shows in the GUI's plugins panel like any other load error.
   - `other`: skipped, as today.
   
   The error `source` and `LoadedPlugin.path` stay the link path, the name the user placed in the plugin directory. Node's ESM loader resolves the real path of the imported module, so a symlinked folder plugin's own `node_modules` resolve next to its real location.
2. **Import timeout:** a new exported constant `PLUGIN_IMPORT_TIMEOUT_MS = 10_000`. `loadOneModule` races `import(...)` against a timer. The timer is `unref()`'d and cleared in `finally`, so a fast import leaves no pending handle. On timeout it records `import timed out after {n} ms` against that plugin's `source` and moves on to the next entry. The import itself cannot be cancelled. The module may keep evaluating in the background and is never registered, and the module doc comment says so. `loadPluginProviders(pluginDir, options?: { importTimeoutMs?: number })` gains an optional second parameter, used by tests and defaulting to the constant. `initProviderRegistry` keeps calling it with one argument.
3. **Timeout budget is per plugin, and the worst case is accepted and documented.** The scan loop stays sequential, so the worst-case startup delay is (number of hanging plugins) × 10 s: bounded instead of infinite, but able to look like a hang when several plugins are broken. A shared total budget across the scan (a deadline passed down, later plugins failing fast once it is spent) was weighed and rejected. Once one broken plugin used the budget up, healthy plugins after it in the scan order would be reported as `import timed out` without ever being given time to load, so the error list would blame the wrong plugins and a working plugin's availability would depend on its directory position. Concurrent imports were also rejected, because id clashes are resolved by load order. Every timeout is a load error that startup logs to stderr against the plugin's `source`, so a slow start is attributable to named plugins. The provider guide's "Trust-Model Limits" states the N × 10 s worst case and tells the user to remove or fix the named plugin. Reconsider a total budget if plugin directories routinely hold many third-party plugins.
4. **Trust model:** unchanged. A link inside the plugin directory is placed there by the same person who could place the code itself, which is `npm install` trust. The constraint in `mcp-server/docs/agents/project-manifest/constraints.md` (only `loadPluginProviders()` imports plugin code, only from the one fixed directory) still holds. Its wording is extended to say that a symlink entry in that directory counts as an entry of that directory.

### D. Agents overview owned by the persona build

1. **New `scripts/lib/agents-overview.js`** (no `main()`, matching `scripts/lib/name-mapping.js`). It holds everything `scripts/generate-agents-overview.js` does today (suite loading, rendering, the `normalize()` date-line rule), exported as:
   - `renderAgentsOverview({ root })` → `string`: the full document for today's date.
   - `checkAgentsOverview({ root, outputFile? })` → `string[]`: an empty array when the file on disk matches the rendered output after normalization. Otherwise one finding naming the file and the regenerate command (a missing file is also a finding).
   - `writeAgentsOverview({ root, outputFile? })` → `{ written: boolean }`: renders, and writes **only when normalized content differs** (or the file is missing). A run that would change nothing but the date line leaves the file untouched.
   - `outputFile` defaults to `{root}/docs/references/agents-overview.md` and exists so tests can point the check at a temp copy.
2. **`scripts/generate-agents-overview.js`** becomes a thin CLI over the lib. Usage, messages and exit codes stay unchanged (`--check`/`--dry-run` → 0 or 1; write mode → 0 and a log line that says "Generated" or "already up to date").
3. **`scripts/build-personas.js`:**
   - Adds a real-build-only post-step, next to name-mapping (inside the `if (!CHECK)` region, L103–L111), that calls `writeAgentsOverview({ root: ROOT })` and logs the outcome.
   - Adds an error-severity descriptor `{ id: 'agents-overview', label: 'stale docs/references/agents-overview.md', run: () => checkAgentsOverview({ root: ROOT }) }` to `checks`. As with every descriptor, it runs on every invocation. In a real build it runs after the regeneration, so it passes unless the write failed. In `--check` it fails on a stale overview. This catches the problem in CI's existing `--check` step without a new workflow line.
   - **Ordering dependency, made explicit.** In a real build the descriptor passes only because the post-step ran first, and that order comes from source position alone (post-steps above, `runBuildChecks(checks)` at L221). The descriptor stays mode-independent, keeping the "every check runs on every invocation" convention, and the order is protected two ways instead: a comment at the post-step stating that the `agents-overview` descriptor depends on it running before `runBuildChecks()`, and a static source-scan test asserting that the `writeAgentsOverview(` call appears before `runBuildChecks(` in `scripts/build-personas.js`. The check after the write costs one extra render, and it is a real verification of the write rather than a no-op: the render is deterministic apart from the date line (suite entries are sorted, and the only time-dependent value is the `Generated` date, which `normalize()` blanks), so a passing check confirms the file on disk matches what the build produced.
4. **`scripts/cli.js` → `cmdBuildMaintain`:** remove the separate `generate-agents-overview.js` step (L511–L512), now redundant because the build owns it. Keeping it would also do no harm, since the write skips unchanged content, but one owner is the point. `cmdGenerateOverview` stays as the standalone command.

## Rationale

- **The Save flag mirrors the Test flag** instead of introducing a shared "busy button" helper. There are two consumers in one file, and their restore paths differ: Save re-renders the whole tab on success, Test restores the button in place. A helper would need a mode switch for that difference. See Structural Improvements.
- **The plugin timeout lives in the core loader**, keeping to the policy-in-the-core pattern the synthesis called out (WP-007). Plugins never implement it.
- **Symlinks are followed, not just reported.** Linking a plugin under development into the plugin directory is the natural workflow, and refusing it would add friction (short-term vision) without adding safety (same trust boundary).
- **The overview's freshness is owned by the build**, not by a separate CI step. `build-personas.js` is what CI, the development-commands checklist, `sync-personas.js` and `package-personas.js` already run, so making it responsible covers every route at once. A separate CI step would protect CI only, and only once someone remembers to add the same check to each new route.
- **Skip-unchanged writing is required, not cosmetic.** Without it, every real `build-personas.js` run would rewrite the overview's date line and dirty the tree. On feature branches that drift must then be kept out of commits under the generated-artefacts Standing Decision.
- **Speculative structure:** none. The `options` parameter on `loadPluginProviders` has a current consumer (the timeout tests). `outputFile` on the overview functions has a current consumer (the check tests).

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Save re-entry guard | Module flag `ecSaveInFlight`, like `ecTestInFlight` | Keep relying on `button.disabled`; a shared `ecRunExclusive(btn, label, fn)` helper | `disabled` does not stop `requestSubmit()` or a second `submit` event. A helper for two call sites with different restore paths adds a mode switch and saves no code. |
| Symlinked plugin entries | Follow the link (`stat`), report dangling links as load errors | Report every symlink as an unsupported-entry error; keep skipping | Following matches the plugin-development workflow at the same trust level. Reporting-only would just turn silence into friction. |
| Hung plugin import | `Promise.race` with a 10 s unref'd timer, recorded as a load error | Load plugins in a worker thread or child process; no timeout (document only) | Isolating plugins would change the provider contract's execution model (providers run in-process with `ctx.signal`), which is far outside this rework. Documenting only leaves startup able to hang forever. |
| Timeout budget across the scan | Per-plugin 10 s, sequential loop; N × 10 s worst case documented | A shared total deadline for the whole scan; concurrent imports with `allSettled` | A shared deadline makes healthy plugins after a broken one fail with a misleading timeout that depends on directory order. Concurrent imports change the load-order clash semantics. The per-plugin worst case is rare and each timeout names its plugin on stderr. |
| Overview check after the real-build write | Descriptor runs in every mode; ordering protected by a comment and a source-order test | Make the descriptor `--check`-only; fold the write into the descriptor's `run()` for real builds | A mode condition breaks the uniform descriptor convention. A `run()` with a write side effect mixes checking and generating in one list. A comment plus a test keeps both conventions and makes a reordering fail loudly. |
| Timeout value | 10 s constant, overridable only via the loader's options (tests) | User-configurable setting in the GUI | No user has asked for it. A constant can become a setting later without breaking anything, so a configuration knob now would have no consumer. |
| Who keeps the overview current | `build-personas.js` regenerates it (real build) and checks it (all modes) via a shared lib | Add `generate-agents-overview.js --check` as a CI step; make the check warn-only | A CI-only step leaves the local `build-personas.js --check` blind, and that blind spot is the root cause of WP-006. Warn-only would not fail CI. |
| Date-line churn | Write only when normalized content differs | Always rewrite; strip the date line from the document entirely | Always rewriting dirties the tree on every build. Dropping the date removes information readers use and changes a document that unrelated projects may fetch. |
| `build-maintain` overview step | Remove it (the build owns regeneration) | Keep it | Keeping two owners of one artefact is the shape that let it drift. Removal costs nothing, because the build step runs first anyway. |

## Pattern Alignment

- **Follows** the module-level in-flight flag pattern of `ecHandleTestClick`: `mcp-server/gui/public/views/config-error-codes.js`.
- **Follows** `?v=N` cache-busting on frontend changes: `mcp-server/gui/docs/agents/project-manifest/constraints.md` (L277–L283).
- **Follows** `0o600` for sensitive user-level files: `mcp-server/src/error-codes/config-store.ts` (L116).
- **Follows** collect-don't-throw plugin errors: `mcp-server/src/error-codes/plugin-loader.ts`.
- **Follows** `it.skipIf(platform() === 'win32')` for POSIX-only assertions: `mcp-server/tests/storage/atomic-writer.test.ts`, `mcp-server/tests/error-codes/config-store.test.ts`.
- **Follows** moving CLI logic into a `scripts/lib/` module the script calls: `scripts/lib/name-mapping.js`.
- **Follows** wrapper checks as `runBuildChecks()` descriptors that run on every invocation: `scripts/build-personas.js`, `scripts/lib/build-checks.js`.
- **Follows** real-build-only post-steps for tracked derived artefacts: the name-mapping step in `scripts/build-personas.js`.
- **Departs** from "every regeneration rewrites the date line" (`scripts/generate-agents-overview.js`). Justified: the build now regenerates on every run, and rewriting the date each time would create constant date-only diffs that the generated-artefacts branch policy then has to clean up.

## Structural Improvements

| Structure | Observation | Decision | Reason |
|-----------|-------------|----------|--------|
| `mcp-server/gui/public/views/config-error-codes.js` | Save and Test protect against re-entry in two different ways (a DOM attribute vs a module flag) | Promoted to step 2 | Same file, same concern. Aligning on the module flag closes the reviewer finding. |
| `mcp-server/gui/public/views/config-error-codes.js` | Each handler repeats its own disable/label/restore sequence | Rejected | Two call sites with different restore paths (re-render vs in-place restore). A helper would need a mode switch and would not save code. Reconsider when a third button needs the same handling. |
| `mcp-server/src/error-codes/temporary-codes.ts` | Each writer in the error-codes directory decides its own file mode; only `config-store.ts` sets one | Promoted to step 3 (named mode constant at the write site) | Fixes the one sensitive writer. A directory-wide "secure writer" wrapper was rejected because `file-provider.ts` must keep default permissions (its counter file can be committed to a repository), so a blanket policy would be wrong for one of the three writers. |
| `mcp-server/src/error-codes/plugin-loader.ts` | Entry classification is written inline in the scan loop | Promoted to step 4 (`classifyEntry`) | Supporting symlinks needs classification that looks through the link. A named function keeps the loop a flat dispatch and makes it testable through the public API. |
| `mcp-server/src/error-codes/plugin-loader.ts` | `loadPluginProviders` takes no options, so tests cannot shorten a timeout | Promoted to step 5 (`options.importTimeoutMs`) | The timeout tests need it, and future loader options get a place to go. |
| `scripts/generate-agents-overview.js` | All logic runs at the top level and nothing is exported, so the script cannot be reused in-process | Promoted to step 6 (`scripts/lib/agents-overview.js`) | Needed for the build-check descriptor. Matches the name-mapping extraction precedent and insight 39ca30b5. |
| `scripts/cli.js` → `cmdBuildMaintain` | Overview regeneration is owned by `build-maintain` alone, not by the build | Promoted to step 7 | One owner for one artefact. |
| Overview date-line rewriting | Every regeneration produces a date-only diff | Promoted to step 6 (skip-unchanged write) | Required once the build regenerates on every run. |
| `scripts/build-personas.js` | Accepts `--suite` arguments from `cmdBuildMaintain` that it silently ignores (`root-tooling.md` L23 documents that no `--suite` exists) | Rejected | Real, but it concerns the CLI's argument passing, not overview ownership. Changing it is unrelated to this plan's goal. Recorded in Deferred Items. |

## Detailed Steps

1. **Record the baselines** (no dependencies; run before any other step). In `mcp-server/`, run `npm test` and `npm run build`. At the workspace root, run `npm test`. Record the pass/fail counts in the run's working notes, so the exit gate (step 11) can compare against them.
2. **Save in-flight guard.** In `mcp-server/gui/public/views/config-error-codes.js`, add `var ecSaveInFlight = false;` and document it in the header block. Guard `ecHandleSave` as described in Approach A: return early when the flag is set, set it right before the PUT, clear it first in `.then` and `.catch`, and leave `ecCleanup()` alone. In `mcp-server/gui/public/index.html`, bump `config-error-codes.js?v=1` to `?v=2`. Extend `resetEcModuleState()` in `mcp-server/tests/gui/config-error-codes-view.test.ts` to reset `ecSaveInFlight`, and add the tests listed in the Test Plan.
3. **Temporary-codes file mode.** In `mcp-server/src/error-codes/temporary-codes.ts`, add the `TEMPORARY_CODES_FILE_MODE = 0o600` constant with its doc comment and pass `{ mode: TEMPORARY_CODES_FILE_MODE }` to `atomicWriteJson`. Add the tests in `mcp-server/tests/error-codes/temporary-codes.test.ts`.
4. **Plugin loader: symlinks.** In `mcp-server/src/error-codes/plugin-loader.ts`, add the private `classifyEntry(entry, entryPath)` and rewrite the scan loop as a dispatch on its result (Approach C.1). Update the module doc comment: symlinked file and folder entries are followed, and dangling links are reported. Add the symlink tests in `mcp-server/tests/error-codes/plugin-loader.test.ts`.
5. **Plugin loader: import timeout.** In `plugin-loader.ts`, export `PLUGIN_IMPORT_TIMEOUT_MS = 10_000`, add the optional `options: { importTimeoutMs?: number }` parameter to `loadPluginProviders` and thread it into `loadOneModule`, then implement the race with an unref'd, `finally`-cleared timer (Approach C.2). Document in the module doc comment that a timed-out import cannot be cancelled and that synchronous top-level blocking cannot be interrupted. Add the timeout tests. Depends on step 4 (same scan loop).
6. **Overview lib, and the generator as a thin CLI.** Create **new** `scripts/lib/agents-overview.js` exporting `renderAgentsOverview`, `checkAgentsOverview` and `writeAgentsOverview` (Approach D.1), moving the loading, rendering and `normalize()` code out of `scripts/generate-agents-overview.js`. Reduce that script to argument parsing plus calls into the lib, keeping its usage, messages and exit codes. Create **new** `scripts/tests/agents-overview.test.js`. Confirm that `scripts/tests/generate-agents-overview.test.js` passes unchanged.
7. **Build owns the overview.** In `scripts/build-personas.js`, import the lib, add the real-build-only `writeAgentsOverview({ root: ROOT })` post-step after the name-mapping step, with a comment stating that the `agents-overview` descriptor depends on it running before `runBuildChecks()` (Approach D.3), and add the `agents-overview` error-severity descriptor to `checks`. Update the header comment's list of wrapper checks. In `scripts/cli.js` → `cmdBuildMaintain`, remove the `generate-agents-overview.js` invocation (L511–L512). Depends on step 6.
8. **mcp-server docs and manifests:**
   - `mcp-server/docs/error-code-providers.md`: "Where a Plugin Lives, and When It's Loaded" covers symlinked entries and dangling-link errors, and "Trust-Model Limits" covers the 10 s per-plugin import timeout, the (hanging plugins) × 10 s worst-case startup delay with the advice to fix or remove the plugin named in the error, that the import cannot be cancelled, and synchronous top-level blocking.
   - `mcp-server/docs/agents/project-manifest/api-surface.md` → `### plugin-loader.ts`: the new signature, `PLUGIN_IMPORT_TIMEOUT_MS`, and symlink behaviour.
   - `mcp-server/docs/agents/project-manifest/data-flows.md`: the `atomicWriteJson` call for `temporary-codes.json` (L2230) shows `{ mode: 0o600 }`, and the plugin-loading flow (L2268) shows link resolution and the timeout.
   - `mcp-server/docs/agents/project-manifest/constraints.md` (L614 rule): symlink entries count as entries of the fixed directory.
   - GUI manifest: `mcp-server/gui/docs/agents/project-manifest/api-surface.md` (the `ecHandleSave` row and the new `ecSaveInFlight` state row next to L730/L749) and `mcp-server/gui/docs/agents/project-manifest/file-tree.md` (L47 state list).
   - Depends on steps 2–5.
9. **Root and personas docs:**
   - `docs/agents/project-manifest/root-tooling.md`: the `build-personas.js` row (L23) covers the overview post-step and check. The `generate-agents-overview.js` row (L42) becomes a thin CLI over the lib and drops "called automatically by `cmdBuildMaintain`". Add a new row for `scripts/lib/agents-overview.js`.
   - `docs/agents/project-manifest/generated-artefacts.md`: the agents-overview row (L37) is regenerated by `build-personas.js` (real build), checked by `build-personas.js --check`, and no longer produces date-only diffs. Update the build-maintain description (L97).
   - `docs/agents/project-manifest/development-commands.md` (L111, the **Persona source** row of *Verification by Change Type*): within that table row, replace the sentence "Run `node scripts/generate-agents-overview.js --check` when overview metadata changed." with the note that `build-personas.js --check` now covers the overview. No structural change to the table.
   - `docs/agents/project-manifest/cross-system-dependencies.md` (L35): regeneration happens on every real persona build.
   - `personas/docs/agents/project-manifest/constraints.md` rule 33: regenerate via `node scripts/build-personas.js`.
   - `personas/docs/agents/project-manifest/api-surface.md` → `### scripts/build-personas.js — CLI Interface`: the new check and post-step.
   - The root `AGENTS.md` rule "Add or change a root-level script" names three documents: `root-tooling.md` and `development-commands.md` are covered above, and the root `README.md` mentions neither `build-personas` nor `agents-overview` (verified by grep), so it needs no change.
   - Depends on steps 6–7.
10. **Changelogs.** Add bullets to the open `mcp-server/changelog.md` v2.12.0 WIP entry: Save guard, temporary-codes mode, symlinked plugins, import timeout. Add a build-system bullet to the open `personas/changelog.md` v3.39.0 WIP entry: the build keeps the agents overview current, and `--check` fails when it is stale. Do not open new versions and do not edit the root changelog (Changelog Convention). Depends on steps 2–7.
11. **Exit gate.** In `mcp-server/`, run `npm test` and `npm run build`. At the root, run `npm test`, then `node scripts/build-personas.js` followed by `node scripts/build-personas.js --check`, and `node scripts/generate-agents-overview.js --check`. Run the root `npm test` before the persona builds, so a regeneration cannot hide a failing generator test. Compare the results against step 1's baselines: no new failures. Confirm that a second real `build-personas.js` run leaves `docs/references/agents-overview.md` unmodified (`git status --short docs/references/agents-overview.md` shows no change from the run). Depends on steps 1–10.

## Dependencies

- Step 1 runs before every other step.
- Steps 2, 3, 4 and 6 are independent of each other.
- Step 5 depends on step 4. Step 7 depends on step 6.
- Step 8 depends on steps 2–5. Step 9 depends on steps 6–7. Step 10 depends on steps 2–7.
- Step 11 depends on steps 1–10.

## Required Components

- `mcp-server/gui/public/views/config-error-codes.js` (modified)
- `mcp-server/gui/public/index.html` (modified)
- `mcp-server/src/error-codes/temporary-codes.ts` (modified)
- `mcp-server/src/error-codes/plugin-loader.ts` (modified)
- `scripts/lib/agents-overview.js` (**new**)
- `scripts/generate-agents-overview.js` (modified, becomes a thin CLI)
- `scripts/build-personas.js` (modified)
- `scripts/cli.js` (modified)
- `mcp-server/tests/gui/config-error-codes-view.test.ts`, `mcp-server/tests/error-codes/temporary-codes.test.ts`, `mcp-server/tests/error-codes/plugin-loader.test.ts` (modified)
- `scripts/tests/agents-overview.test.js` (**new**)
- The docs and changelogs listed in Documentation Updates

## Assumptions

- The work runs on the existing AI Insights branch `feature-error-code-generator` in the DEV workspace (the current branch). Only the `ai-insights` repository changes, so no dependency symlink switch is needed.
- The routing-loop fix on `feature-pipeline-adjustments` does not touch any file this plan changes. A grep of the plan's file list against that branch is not possible from here. If both branches change the same changelog WIP entries, the conflict is resolved when merging, which is outside the run.
- Node's ESM loader resolves symlinked module paths to their real location (default `--preserve-symlinks` off). The existing server start commands do not pass `--preserve-symlinks`.

## Constraints

- GUI frontend stays ES5 with no build step, and every frontend change bumps its `?v=N`.
- STDIO discipline: the loader writes nothing to stdout. Load errors stay in the registry's error list, which startup already logs to stderr.
- Cross-platform: symlink file tests skip on Windows. Folder links use the `'junction'` type, which needs no privilege on Windows. File-mode assertions skip on Windows.
- Changelog Convention: add bullets to the open WIP entries only.
- Generated artefacts on a feature branch: overview drift from the step 11 build runs is classified per `docs/agents/project-manifest/generated-artefacts.md`. The run does not commit.

## Out of Scope

- The ledger next-action routing loop after a rework (synthesis "Process follow-up"). Handled on `feature-pipeline-adjustments`.
- Changing the GUI server's bind address, or adding route guards to the non-error-code routes. This is an authorisation change, which by the standing preference goes into its own plan. It was already rejected for blast-radius reasons in the original plan.
- Running plugins in a worker thread or child process.
- A user-configurable plugin import timeout.
- Containment validation for the `file` provider's `counter_file` path (synthesis Security Auditor item). It is documented as deliberate, reachable only through the trusted local config-write surface, and changing it would alter documented provider behaviour.
- The remaining low-value test gaps QA verified by reading the code (duplicate-name throw in `registerAllTools`, empty `response_suffix` and overflow branches in the HTTP provider, the throw path in `resolveErrorCodesDir()`).
- The original plan's other Out of Scope items (hot plugin reload, marketplace and signing, block leasing, CI duplicate-code lint, auto-replacing temporary codes, more built-in providers, more persona grants, keychain storage, `exports` maps). They remain deliberate product boundaries, and none sits inside this rework's blast radius.

## Human Actions

| # | Action | When | Why an agent cannot do it |
|---|--------|------|---------------------------|
| 1 | Once the branch reaches STABLE, restart the MCP server and GUI server so the loader and GUI changes take effect, and hard-reload the GUI | After the run | The live servers belong to the user |
| 2 | Optionally, symlink the example plugin (`mcp-server/docs/examples/error-code-provider-example/`) into `~/.ai-insights/plugins/error-codes/`, restart both servers, and see it listed in the Error Codes tab | After the run | Needs the user's home directory and server restarts |

## Acceptance Criteria

- AC-01: While a Save request in the Error Codes tab is pending, a second submit (button click, `submit` event or `requestSubmit()`) sends no second `PUT`. After the request settles, success or failure, Save works again.
- AC-02: A Save blocked by form validation leaves the in-flight flag clear, so the next valid Save is sent.
- AC-03: `index.html` loads `config-error-codes.js?v=2`.
- AC-04: On POSIX, `temporary-codes.json` has mode `0600` after `issueTemporaryCode`, including when the file already existed with a wider mode.
- AC-05: A symlink in the plugin directory pointing to a valid `*.mjs` file loads as a plugin, with its reported `path` being the link path.
- AC-06: A symlink in the plugin directory pointing to a valid folder plugin loads as a plugin.
- AC-07: A dangling symlink in the plugin directory produces one load error naming the link path and does not stop other plugins from loading.
- AC-08: A plugin whose module evaluation never settles produces one `import timed out` load error within the configured timeout, and every other plugin in the directory still loads.
- AC-09: A fast-loading plugin leaves no pending timer behind (the race timer is cleared).
- AC-10: `node scripts/build-personas.js --check` exits non-zero and names `docs/references/agents-overview.md` when the overview is stale, and passes when it is current.
- AC-11: A real `node scripts/build-personas.js` run regenerates a stale overview, and a second run leaves the file byte-identical (no date-only rewrite).
- AC-12: `node scripts/generate-agents-overview.js` keeps its usage, messages and exit codes. The existing `scripts/tests/generate-agents-overview.test.js` passes unchanged.
- AC-13: `cmdBuildMaintain` no longer calls `generate-agents-overview.js` directly.
- AC-14: The documentation listed in Documentation Updates reflects the changes, and both WIP changelog entries carry the new bullets.
- AC-15: The mcp-server `npm test` and `npm run build`, the root `npm test`, and both `build-personas.js` modes show no new failures against the step 1 baselines.

## Testing Strategy

Unit-level coverage in each module's existing suite. The GUI guard is tested with the established jsdom + `vm.runInThisContext` view harness. The file mode and plugin loader are tested against real temp directories (`mkdtemp`), with POSIX-only assertions skipped on Windows. The overview lib is tested in-process against temp copies of the real output, so the tests never mutate the tracked file. The existing spawn-based generator test remains the regression guard for the CLI contract. Step 11's exit gate runs the end-to-end build/check sequence.

## Test Plan

- `mcp-server/tests/gui/config-error-codes-view.test.ts` → "Save ignores a second submit while pending and re-enables after success": mock `API.updateErrorCodeConfig` with a pending promise, dispatch `submit` twice, assert one call, resolve, then assert a further submit sends a second call. Covers AC-01.
- Same file → "Save ignores a second submit while pending and re-enables after failure": reject the promise, then assert the button is re-enabled and a further submit is sent. Covers AC-01.
- Same file → "Save via requestSubmit() while pending sends no second request". Covers AC-01.
- Same file → "a Save blocked by validation does not set the in-flight flag": stub `reportValidity` to return false, then true, and assert one call on the second submit. Covers AC-02.
- `mcp-server/tests/gui/security-headers.test.ts` (the only test that reads `index.html`) or a new assertion in `config-error-codes-view.test.ts`: `index.html` references `config-error-codes.js?v=2`. Covers AC-03.
- `mcp-server/tests/error-codes/temporary-codes.test.ts` → `it.skipIf(win32)` "writes temporary-codes.json with mode 0600", and "tightens an existing 0644 file to 0600 on the next issuance". Covers AC-04.
- `mcp-server/tests/error-codes/plugin-loader.test.ts` → `it.skipIf(win32)` "loads a plugin through a file symlink, reporting the link path" (target in a sibling temp dir outside the plugin dir). Covers AC-05.
- Same file → "loads a folder plugin through a directory link" (`symlink(target, link, 'junction')`, runs on every platform). Covers AC-06.
- Same file → `it.skipIf(win32)` "reports a dangling symlink as a load error and keeps loading the rest". Covers AC-07.
- Same file → "times out a plugin whose top-level await never settles, and still loads the others" (`await new Promise(() => {})` plugin plus one valid plugin, `importTimeoutMs: 200`). Covers AC-08.
- Same file → "a fast plugin import clears its timeout timer" (`vi.useFakeTimers()` or a spy on `clearTimeout`, asserting the timer is cleared after a successful load). Covers AC-09.
- Same file → "exports PLUGIN_IMPORT_TIMEOUT_MS as the default timeout". Covers AC-08.
- **New** `scripts/tests/agents-overview.test.js` → "checkAgentsOverview returns no findings for a fresh copy" (render into a temp file, then check). Covers AC-10.
- Same file → "checkAgentsOverview reports a stale or missing file naming it and the regenerate command". Covers AC-10.
- Same file → "checkAgentsOverview ignores a differing Generated date line". Covers AC-10, AC-11.
- Same file → "writeAgentsOverview writes a stale file and reports written: true". Covers AC-11.
- Same file → "writeAgentsOverview leaves a file that differs only in its date line byte-identical and reports written: false". Covers AC-11.
- `scripts/tests/generate-agents-overview.test.js` (unchanged, must pass). Covers AC-12.
- **New** test in `scripts/tests/agents-overview.test.js` (or a sibling `scripts/tests/build-personas-overview.test.js`) → static assertions: `scripts/build-personas.js` source registers a descriptor with `id: 'agents-overview'`, its `writeAgentsOverview(` call appears before its `runBuildChecks(` call (guards the ordering dependency of Approach D.3), and `scripts/cli.js`'s `cmdBuildMaintain` body no longer references `generate-agents-overview.js`. This follows the source-scanning precedent of `mcp-server/tests/tools/tool-registry.test.ts` (which replaced the former `tests/startup/tool-log-sync.test.ts`). Covers AC-10, AC-13.
- Step 11 exit gate: real build twice plus `--check`, and the `git status` assertion on the overview. Covers AC-10, AC-11, AC-15.
- Step 11 doc review against the Documentation Updates list. Covers AC-14.

## Documentation Updates

- `mcp-server/docs/error-code-providers.md` — symlinked entries and dangling-link errors under "Where a Plugin Lives, and When It's Loaded"; per-plugin import timeout, the N × 10 s worst-case startup delay, no cancellation, and synchronous top-level blocking under "Trust-Model Limits".
- `mcp-server/docs/agents/project-manifest/api-surface.md` — `### plugin-loader.ts`: new signature with `options.importTimeoutMs`, `PLUGIN_IMPORT_TIMEOUT_MS`, symlink classification.
- `mcp-server/docs/agents/project-manifest/data-flows.md` — `temporary-codes.json` write with `{ mode: 0o600 }`, and the plugin-loading flow with link resolution and the timeout.
- `mcp-server/docs/agents/project-manifest/constraints.md` — the plugin-loading rule (L614): symlink entries count as entries of the fixed directory.
- `mcp-server/gui/docs/agents/project-manifest/api-surface.md` — the `ecHandleSave` row (guarded by `ecSaveInFlight`) and a new `ecSaveInFlight` state row.
- `mcp-server/gui/docs/agents/project-manifest/file-tree.md` — `config-error-codes.js` state list gains `ecSaveInFlight`.
- `docs/agents/project-manifest/root-tooling.md` — `build-personas.js` and `generate-agents-overview.js` rows updated, plus a new `scripts/lib/agents-overview.js` row.
- `docs/agents/project-manifest/generated-artefacts.md` — agents-overview row (generator, check, no date-only diffs) and the build-maintain description.
- `docs/agents/project-manifest/development-commands.md` — Verification by Change Type, persona-source row: the overview check is covered by `build-personas.js --check`.
- `docs/agents/project-manifest/cross-system-dependencies.md` — agents-overview row: regenerated by every real persona build.
- `personas/docs/agents/project-manifest/constraints.md` — rule 33: regenerate through `node scripts/build-personas.js`.
- `personas/docs/agents/project-manifest/api-surface.md` — `### scripts/build-personas.js — CLI Interface`: overview post-step and check.
- `mcp-server/changelog.md` — bullets in the open v2.12.0 WIP entry.
- `personas/changelog.md` — build-system bullet in the open v3.39.0 WIP entry.

## Deferred Items

| # | Deferred Item | Origin | Reason Deferred | Notes |
|---|---------------|--------|-----------------|-------|
| 1 | Ledger next-action routing loop after a rework invalidates a stage outside both active roles | Synthesis → Process follow-up | Being handled on the AI Insights branch `feature-pipeline-adjustments` | Closed once that branch merges |
| 2 | Concurrency guard on `initProviderRegistry()` | Synthesis → Out-of-scope (WP-005 QA) | Re-verified: each call swaps in a complete new registry, so concurrent calls are last-writer-wins with no corruption, and each server calls it once | Reconsider if a hot-reload path ever calls it while allocations run |
| 3 | `isLoopbackAddress()` hex IPv4-mapped forms and `127.x.x.x` coverage | Synthesis → Out-of-scope (WP-011 QA) | Not reachable through Node's socket API | Reconsider if a proxy layer ever feeds addresses in |
| 4 | v2.11.0 changelog "missing WIP marker" | Synthesis → Out-of-scope (WP-010) | Not a defect: v2.11.0 is released | None |
| 5 | Low-value test gaps verified by reading the code (registry duplicate name, HTTP parser empty suffix/overflow, `resolveErrorCodesDir()` throw) | Synthesis → QA Code Insights | Behaviour verified correct, so tests would add little | Bundle into the next change that touches those files |
| 6 | `counter_file` path containment validation | Synthesis → Security Auditor | Deliberate documented design; reachable only via the trusted local config surface | Reconsider if the config surface ever becomes reachable remotely |
| 7 | GUI bind address and guards on the non-error-code routes | Original plan → Out of Scope | Authorisation change, so it goes into a separate plan by the standing preference | Candidate for a slim stub plan |
| 8 | `cmdBuildMaintain` passes `--suite all` to `build-personas.js`, which ignores it | Structural Improvements (this plan) | CLI argument hygiene, unrelated to overview ownership | Small cleanup in `scripts/cli.js` |

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **A real persona build now writes a tracked doc, adding drift on feature branches** | The write skips date-only changes, so drift appears only when persona overview metadata actually changed, which is exactly when the generated-artefacts policy says to regenerate and commit with the source. |
| **The new error check makes `build-maintain` fail before regenerating** | The real build regenerates before the check runs, and `cmdBuildMaintain`'s own overview step is removed. Step 11 runs the real build and `--check` back to back. |
| **A timed-out plugin keeps running in the background** | Documented as a trust-model limit. The plugin is never registered, so nothing can allocate through it. Startup proceeds after a bounded delay. |
| **Several hanging plugins add up to a startup delay that looks like a hang** | Accepted (Approach C.3): each timeout is logged to stderr naming its plugin, and the provider guide documents the N × 10 s worst case and the fix. A shared total budget was rejected because it would misreport healthy plugins as timed out. |
| **A later edit moves the overview post-step after `runBuildChecks()`, so a real build fails on its own stale check** | A comment at the post-step names the dependency, and the static source-order test in `scripts/tests/agents-overview.test.js` fails on a reordering. |
| **Symlink tests fail on Windows CI or dev machines** | File links skip on Windows. Folder links use `'junction'`, which needs no privilege. |
| **Following symlinks widens what the loader can import** | It does not widen trust: only someone who can write into the plugin directory can add a link, and that person could add the code directly. Documented in the provider guide and the constraints rule. |
| **The Save flag gets stuck if `ecRenderTab()` throws after a successful PUT** | The flag is cleared as the first statement in `.then`, before the re-render. |
| **The fake-timer timer test is brittle against the real `import()`** | Prefer a `clearTimeout` spy around a real fast import over fully faked timers. The timeout test itself uses real timers with a 200 ms budget. |

## Recommended Workflow
- **Workflow:** standalone
- **Rationale:** Four small, independent fixes inside well-understood patterns plus one contained tooling refactor, all with clear test obligations. A single developer session with self-review is enough, and the formal QA, security and review stages would add overhead without finding more.
