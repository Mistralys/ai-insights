# Plan

## Plan Audit Cycles
- Audits: 6 — Plan Auditor v1.4.0
- Architectural Reviews: 2 — Plan Architect Reviewer v1.5.0

## Summary

Implement all Tier 1 developer-experience improvements from the research paper (`docs/agents/research/2026-05-29-developer-experience.md`). This plan covers seven items: a unified health-check registry (foundation), status lines in the interactive menu, a global MCP registration command, a doctor command, an npm `bin` field for short invocation, a first-run wizard trigger, and an enhanced bootstrap with self-updating wrapper behaviour. Together these eliminate first-clone friction, provide at-a-glance health in every session, and ensure the workspace stays consistent after pulls.

## Architectural Context

### Existing Components

- **`scripts/cli.js`** — Main entry point using `@mistralys/cli-menu`. Defines `SETUP_COMPONENTS` (5 items: `mcp-server`, `personas`, `orchestrator`, `mcp-json`, `git-hooks`) with `detect()`/`run()`/`validate()` on each. Registers 15+ commands via `COMMANDS` array and calls `createMenu()`.
- **`@mistralys/cli-menu` (`cli-menu/`)** — Zero-dependency library. `MenuConfig` interface in `src/types.ts`. `renderMenu()` in `src/menu/renderer.ts` handles interactive display. Setup wizard in `src/setup/index.ts`.
- **`scripts/preflight-bootstrap.js`** — Auto-builds sibling repos (`cli-menu`, `ai-persona-builder`) if `dist/` or `node_modules/` are missing. Does not handle staleness detection or missing-repo guidance.
- **`scripts/preflight-orchestrator.js`** — Validates orchestrator environment (venv, `.env`, MCP dist freshness, conflicting processes). Standalone checks with pass/fail output.
- **`.githooks/pre-commit`** — Existing hook infrastructure; `install-hooks.js` sets `core.hooksPath`.
- **`.mcp.dist.json`** — Template for per-project MCP registration (absolute-path placeholder).
- **`mcp-server/src/index.ts`** — MCP server entry; parses `--agents-dir` only. No GUI integration.
- **`mcp-server/gui/server.ts`** — Standalone HTTP server on port 3420. Binds `0.0.0.0`. Has CORS + security headers but no Host-header allowlist.

### Key Constraints

- `cli-menu` is zero-dependency — any new `MenuConfig` property must be optional and type-only.
- Cross-platform (Windows/macOS/Linux) — no OS-specific APIs without fallback.
- The MCP server uses STDIO transport — stdout must only contain JSON-RPC messages.
- Global MCP registration uses absolute paths — requires a stable-shim indirection strategy.

## Approach / Architecture

The implementation is layered:

1. **Foundation layer** (`scripts/lib/health-checks.js`): A cost-tiered check registry shared across status lines, doctor, and preflight. Each check declares a cost tier (`instant` / `fast` / `slow`) so consumers select the appropriate subset.

2. **Library layer** (`cli-menu`): Add optional `statusLines` property to `MenuConfig` and render it in the menu header. Add a `firstRunRedirect` flag for auto-wizard behaviour.

3. **Consumer layer** (`scripts/cli.js`): Wire health checks into status lines, register `doctor` and `install-mcp` commands, enhance bootstrap, add `bin` field.

4. **Shim layer** (`~/.ai-insights/`): A stable launcher shim for global MCP registration that decouples IDE config from the repo's absolute path.

## Rationale

- The health-check registry prevents three parallel implementations (status lines, doctor, preflight) from duplicating detection logic — DRY at the infrastructure level.
- `statusLines` as an optional `MenuConfig` property keeps `cli-menu` generic; the consumer supplies the functions. No library dependency needed.
- Global MCP registration via a stable shim solves the "absolute path breaks on move" problem identified in the research. Re-running `install-mcp` updates one config file; no IDE config edits needed.
- The `bin` field is the standard npm mechanism for exposing a CLI executable — trivial to add, immediately useful.
- First-run detection leverages existing `SETUP_COMPONENTS[].detect()` — no new infrastructure.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Health-check deduplication | Shared registry in `scripts/lib/health-checks.js` | Inline checks per feature; preflight adapter pattern | Registry is cheapest to maintain; three consumers reference one array. |
| Status in menu | Optional `statusLines` on `MenuConfig` (consumer-supplied functions) | Built-in health framework in `cli-menu`; async background checks | Keeps library zero-dep and generic; consumer owns detection logic. |
| Global MCP path stability | Stable shim at `~/.ai-insights/bin/launch-server.js` + `config.json` | Raw absolute path; symlinks; env vars | Shim survives repo moves; updates don't touch IDE config. Symlinks break on Windows. |
| First-run detection | Check all `detect()` results at menu startup | Marker file (`.setup-complete`); ENV flag | `detect()` functions already exist and are authoritative; marker file can desync. |
| Enhanced bootstrap scope | Extend `preflight-bootstrap.js` with staleness + guidance | Separate `post-merge` hook (Tier 3); new script | Single responsibility: bootstrap handles everything pre-menu. |

## Pattern Alignment

- **`SETUP_COMPONENTS` pattern** (`scripts/cli.js`): Followed. New checks conform to the `{ id, label, desc, detect, run, validate }` interface.
- **`MenuConfig` extension pattern** (`cli-menu/src/types.ts`): Followed. Adding an optional property is the established pattern (see `categoryVersions`, `usageLine`).
- **`scripts/lib/` convention** (`scripts/`): New. Creates a `lib/` subdirectory for shared utilities. Justified: the alternative is inlining detection logic three times.
- **Cross-platform path handling** (`AGENTS.md` §Cross-Platform Policy): Followed. All paths via `path.join()`; OS detection via `process.platform`.
- **Hook infrastructure** (`.githooks/`): Followed. No changes to `install-hooks.js` — new additions use the existing `core.hooksPath` mechanism.

## Detailed Steps

### Step 1 — Health-Check Registry (foundation)

1. Create `scripts/lib/health-checks.js` exporting `HEALTH_CHECKS` array.
2. Use distinct JSDoc-documented interfaces to make the synchrony contract explicit:
   ```js
   /** @typedef {{ id: string, label: string, cost: 'instant'|'fast', detect(): boolean, fix?: string }} InstantCheck */
   /** @typedef {{ id: string, label: string, cost: 'slow', detect(): Promise<boolean>, fix?: string }} SlowCheck */
   /** @type {Array<InstantCheck | SlowCheck>} */
   const HEALTH_CHECKS = [...];
   ```
   `instant`/`fast` checks are documented with `detect(): boolean` (no Promise). `slow` checks are documented with `detect(): Promise<boolean>`. Since these are plain `.js` files, enforcement is not compile-time — the runtime guard in Step 3's `statusLines` map is the actual safety net against accidental async instant checks. JSDoc annotations give IDE-level hints to check authors.
3. Cost tier boundaries (from research):
   - `instant` (< 5 ms): file-existence stats, version checks — safe on every menu render.
   - `fast` (< 50 ms): mtime comparisons, JSON config parsing.
   - `slow` (100 ms–2 s): subprocess spawns (e.g. `build-personas.js --check`), network reachability.
4. Migration scope:
   - Migrate detection logic from `SETUP_COMPONENTS` in `scripts/cli.js` into this registry.
   - For `preflight-orchestrator.js`: only the two overlapping checks (`mcp-dist-fresh`, `orchestrator-venv`) are sourced from/shared with `health-checks.js`. `preflight-orchestrator.js` will be updated to import those two checks from `health-checks.js` (replacing its local implementations) but is **not** otherwise refactored. The orchestrator-specific checks (`checkEnv` for API keys, `checkNoConflict` for conflicting processes, `checkApiKey` for network reachability) are not migrated — they have no equivalent shape in the boolean `detect(): boolean` interface and remain in `preflight-orchestrator.js`.
   - **Dependency direction:** `health-checks.js` owns all detection logic. `cli.js` imports from `health-checks.js` (one-way). `health-checks.js` must not import from `cli.js` or reference `SETUP_COMPONENTS`.
5. Checks to include (initial set — 9 entries):
   - `mcp-dist` (instant): `fs.existsSync(mcp-server/dist/index.js)`
   - `personas-fresh` (slow): delegates to `build-personas.js --check`
   - `orchestrator-venv` (instant): `fs.existsSync(orchestrator/.venv)`
   - `hooks-installed` (instant): `git config core.hooksPath === '.githooks'`
   - `global-mcp-registered` (fast): checks `~/.ai-insights/config.json` exists + IDE config file
   - `node-version` (instant): `process.versions.node` major >= 18 (aligned with the existing `checkNodeVersion(18)` in `scripts/cli.js`)
   - `mcp-dist-fresh` (fast): compare mtime of `mcp-server/src/` vs `mcp-server/dist/index.js`
   - `sibling-cli-menu` (instant): `fs.existsSync(../cli-menu/dist)`
   - `sibling-persona-builder` (instant): `fs.existsSync(../ai-persona-builder/dist)`
   - **Deferred:** `personas-deployed` (fast) — checks if persona files are deployed to the user's IDE prompts directory. Deferred from the initial set because it requires importing `getVSCodePromptsDir()` from `publish-locations.js`, coupling the registry to persona deployment concerns from day one. Can be added later without affecting the registry contract. `personas-fresh` (slow tier) covers the actionable case.
6. Export helper `runChecks(costFilter)` returning `Promise<{ id, label, passed, fix? }[]>`. For `'instant'`-only filtering, the result resolves synchronously (all detect functions are sync). For `'all'` or `'slow'`, await async detectors.

### Step 2 — Status Lines in `cli-menu` (library change)

1. Add `statusLines?: Array<() => string>` to `MenuConfig` in `cli-menu/src/types.ts`.
2. In `cli-menu/src/menu/renderer.ts`, after the version line block (line ~35), insert:
   ```typescript
   if (config.statusLines?.length) {
     for (const fn of config.statusLines) {
       process.stdout.write('  ' + fn() + '\n');
     }
     process.stdout.write('\n');
   }
   ```
3. No other changes to the library. This is a non-breaking minor addition.

### Step 3 — Wire Status Lines in `ai-insights` Consumer

1. In `scripts/cli.js`, import `HEALTH_CHECKS` from `./lib/health-checks.js`.
2. Build the `statusLines` array before calling `createMenu()` by filtering to instant-tier checks and calling each `detect()` directly (synchronous). Do **not** use `runChecks()` here — `runChecks` returns a `Promise` and cannot be called from a synchronous `() => string` callback:
   ```js
   const instantChecks = HEALTH_CHECKS.filter(c => c.cost === 'instant');
   const statusLines = instantChecks.map(check => () => {
     const passed = check.detect(); // must return boolean per JSDoc contract
     const icon = passed ? '\u2713' : '\u2717';
     const color = passed ? C.green : C.red;
   const result = color(`${icon} ${check.label}`) + (passed ? '' : C.dim(` — ${check.fix ?? ''}`)).trim();
   // Safety net: if detect() returned a Promise (contract violation), display a clear warning
   return (typeof result === 'string') ? result : `⚠ ${check.label} (detect returned Promise — check must be synchronous)`;
   });
   ```
   The `detect()` call must be synchronous; `instant`-tier checks are documented with a JSDoc `@returns {boolean}` annotation and the above runtime guard catches any violation before it silently renders as `[object Promise]`.
3. Pass `statusLines` into the `createMenu()` config object.
4. In the same step, bump the `@mistralys/cli-menu` dependency in `ai-insights/package.json` to `^1.1.0` to ensure `statusLines`, `firstRunRedirect`, and `onFirstRun` are available.

### Step 4 — Doctor Command

1. In `scripts/cli.js`, add a new command `{ id: 'doctor', key: 'v', label: 'Doctor', category: 'Validation & Utilities', ... }`. (Key `'d'` is already taken by `bundle-docs`.)
2. Handler calls `runChecks('all')` (instant + fast + slow), prints a Flutter-doctor-style report:
   ```
   ✓ MCP Server dist built
   ✗ Personas stale — run: node scripts/cli.js sync-personas
   ✓ Orchestrator venv present
   ...
   ```
3. Return exit code 0 if all pass, 1 if any fail.
4. Add `helpVariants: [['doctor', 'Full environment health check']]`.

### Step 5 — Global MCP Registration Command

1. Create `scripts/install-mcp-global.js` with:
   - `getShimDir()` → `~/.ai-insights/bin/` (cross-platform `os.homedir()`).
   - `writeShim()` → Creates `~/.ai-insights/bin/launch-server.js` (shebang + reads `config.json` + launches the MCP server). The shim must use `child_process.spawn(node, [distPath, ...process.argv.slice(2)], { stdio: 'inherit' })` — not `exec`, `execSync`, or any mechanism that buffers stdout. `stdio: 'inherit'` is mandatory: the MCP server uses STDIO transport, so all JSON-RPC messages flow over stdout and any buffering would silently break IDE integration. Before writing the shim, the command verifies that `{repoPath}/mcp-server/dist/index.js` exists; if not, it prints an actionable error (`"MCP server is not built. Run the menu and rebuild the MCP server first."`) and exits without writing.
   - `writeConfig(repoPath)` → Creates `~/.ai-insights/config.json` with `{ "repoPath": "<abs>" }`.
   - `installVSCode(options)` → Reads/creates user-level `mcp.json`, merges `central_pm` entry pointing to the shim. Cross-platform paths: macOS `~/Library/Application Support/Code/User/mcp.json`, Linux `~/.config/Code/User/mcp.json`, Windows `%APPDATA%/Code/User/mcp.json`.
   - `installClaudeCode()` → Spawns `claude mcp add --scope user --transport stdio central_pm -- node <shimPath>`.
   - `uninstall()` → Removes `central_pm` from user `mcp.json` and runs `claude mcp remove`.
   - `dryRun()` → Computes and prints the JSON diff without writing.
2. Safety requirements:
   - `--dry-run` flag prints diff without writing.
   - Timestamped backup of existing `mcp.json` before merge.
   - Idempotent: re-running is a no-op when already installed.
   - Strict JSON merge: only touches the `central_pm` key.
3. Register in `scripts/cli.js` as command `{ id: 'install-mcp', key: 'i', label: 'Install MCP (Global)', category: 'Setup & Configuration', ... }`. (Key `'g'` is already taken by `gui`.)
4. Add to `SETUP_COMPONENTS` as a new component, positioned **after** the existing `mcp-json` component:
   ```js
   { id: 'global-mcp', label: 'Global MCP', desc: 'User-level IDE registration (recommended)',
     detect: () => shimConfigExists(), run: () => installGlobal(), validate: () => shimConfigExists() }
   ```
5. Reframe the existing `mcp-json` component: update its `desc` to `'Workspace-level override (for advanced use)'` to signal that global registration is now the primary path.
6. **Shim startup path validation:** The `launch-server.js` shim must validate that the `repoPath` from `config.json` still exists on disk before exec. If the path is invalid, print a clear stderr message: `"[ai-insights] Configured repo path no longer exists: <path>. Re-run 'node scripts/cli.js install-mcp' to update."` and exit with code 1.

### Step 6 — npm `bin` Field (Pattern 15)

1. Add to `ai-insights/package.json`:
   ```json
   "bin": {
     "ai-insights": "./scripts/cli.js"
   }
   ```
2. Verify shebang `#!/usr/bin/env node` is present as the first line of `scripts/cli.js` (already exists — no change needed).
3. Set executable bit: file is already executable via `menu.sh` dispatch, but verify `chmod +x scripts/cli.js` is in place for direct invocation.

### Step 7 — First-Run Wizard Trigger (Approach D)

1. Add `firstRunRedirect?: boolean` and `onFirstRun?: () => Promise<string[]>` to `MenuConfig` in `cli-menu/src/types.ts`. The return value of `onFirstRun` is an array of component IDs to pre-select in the setup wizard — this is the return channel from consumer scope-selection logic to the library's `runSetup` call.
2. In `cli-menu/src/menu/interactive.ts` (the `showInteractiveMenu` function), **before the `while` loop**, insert the first-run redirect block with explicit terminal-mode transitions:
   ```typescript
   if (config.firstRunRedirect && config.setupComponents?.length) {
     const allUnset = config.setupComponents.every(c => !c.detect());
     if (allUnset) {
       enterRawMode();  // enables keypress events via readline.emitKeypressEvents
       process.stdout.write('\n  First run detected \u2014 launching setup wizard.\n');
       process.stdout.write('  Press q to skip.\n\n');
       const skipped = await waitForSkip(2000);
       restoreTerminal();  // must exit raw mode before onFirstRun (uses readline prompts)
       if (!skipped) {
         // skipped = false → timeout; user did not press q → launch wizard
         const preSelected = (await config.onFirstRun?.()) ?? [];
         // runSetup() expects CLI-arg format for pre-selection; pass [] for no pre-selection
         const setupArgs = preSelected.length ? ['--components=' + preSelected.join(',')] : [];
         await runSetup(config.setupComponents, setupArgs);
         return;         // exit before the while loop
       }
       // skipped = true → user pressed q; fall through to the while loop (which calls enterRawMode again)
     }
   }
   ```
3. Implement `waitForSkip(ms)` as a local function in `cli-menu/src/menu/interactive.ts`, following the `waitForKeypress()` pattern but with a timeout. Use `Promise.race` against a `setTimeout`. **Polarity:** resolves `false` on timeout (user did not skip → wizard launches) and `true` when `q` is pressed (user skipped → fall through). Used at the call site as `if (!skipped)` — timeout (`false`) → `!false = true` → wizard launches; `q` (`true`) → `!true = false` → wizard skipped. No separate file is needed.
4. In `scripts/cli.js`, pass `firstRunRedirect: true` to `createMenu()`.
5. **Scope selection prompt:** The scope-selection prompt is consumer logic and must not live in the `cli-menu` library. In `scripts/cli.js`, implement a `handleFirstRun()` function and pass it as `onFirstRun: handleFirstRun` in the `createMenu()` config. `handleFirstRun()` presents the scope choice:
   ```
   How should the MCP server be registered?
     [g] Globally (recommended — available in all workspaces)
     [w] Workspace-only (adds .mcp.json to this project)
   ```
   Based on the user's selection, `handleFirstRun()` **returns** the corresponding array of component IDs: `['global-mcp']` for global, `['mcp-json']` for workspace-only. The library captures this return value and converts it to CLI-arg format before forwarding to `runSetup`: `const preSelected = (await config.onFirstRun?.()) ?? []; const setupArgs = preSelected.length ? ['--components=' + preSelected.join(',')] : []; await runSetup(config.setupComponents, setupArgs)`. The `cli-menu` library has no knowledge of registration scope — it only passes the formatted args through.
6. **`--skip-setup-check` CLI flag:** In `scripts/cli.js`, if `process.argv` includes `--skip-setup-check`, set `firstRunRedirect: false` regardless of the config value. This allows scripting/CI contexts to bypass the interactive first-run detection.

### Step 8 — Enhanced Bootstrap with Self-Updating Behaviour (Patterns 4 + 11)

1. Extend `scripts/preflight-bootstrap.js`:
   - **Missing-repo guidance:** When `../cli-menu` or `../ai-persona-builder` don't exist, print the exact `git clone` commands and URLs instead of silently skipping.
   - **Staleness detection:** Compare `mcp-server/src/` aggregate mtime vs `mcp-server/dist/index.js` mtime. If source is newer, auto-rebuild.
   - **Same for siblings:** If `../cli-menu/src/` is newer than `../cli-menu/dist/`, rebuild.
   - **Menu integration:** The menu launcher (`menu.sh`/`menu.cmd`) already runs the bootstrap before showing the menu — no new wiring needed.
2. Self-updating wrapper behaviour: After `git pull`, the next menu invocation runs the bootstrap which now detects staleness and rebuilds automatically. This satisfies Pattern 11 without adding a separate hook (the hook approach is Tier 3).

## Dependencies

- Step 2 is **independent** of Step 1. The library change (`statusLines` property in `MenuConfig`) has no import or runtime dependency on `health-checks.js`. It can proceed in parallel.
- Step 3 depends on Steps 1 + 2 (wires registry into menu via library API).
- Step 4 depends on Step 1 (doctor uses the full registry).
- Step 5 is independent (can be parallelized with Steps 1–4).
- Step 6 is independent (trivial `package.json` + shebang change).
- Step 7 depends on `cli-menu` library being available for modification.
- Step 8 is independent (enhances existing `preflight-bootstrap.js`).

**Sequencing:**
```
Step 1 (foundation) ───────────────────── Step 3 (consumer wiring)
Step 2 (library) ─────────────┬── Step 3
                               └── Step 7 (first-run — after library ships)
Step 1 (foundation) ────────── Step 4 (doctor)
Step 5 (install-mcp) ─── independent
Step 6 (bin field) ────── independent
Step 8 (bootstrap) ────── independent
```

## Required Components

### New Files
- `scripts/lib/health-checks.js` — Health-check registry (ai-insights)
- `scripts/install-mcp-global.js` — Global MCP registration logic (ai-insights)

### Modified Files
- `cli-menu/src/types.ts` — Add `statusLines`, `firstRunRedirect`, and `onFirstRun` to `MenuConfig`
- `cli-menu/src/menu/renderer.ts` — Render status lines after version
- `cli-menu/src/menu/interactive.ts` — First-run redirect logic + `waitForSkip` helper (in `showInteractiveMenu`)
- `ai-insights/scripts/cli.js` — Wire status lines, add `doctor` command (key `v`), add `install-mcp` command (key `i`), add `firstRunRedirect: true` + `onFirstRun: handleFirstRun`, add global-mcp to `SETUP_COMPONENTS`
- `ai-insights/scripts/preflight-bootstrap.js` — Staleness detection + missing-repo guidance
- `ai-insights/scripts/preflight-orchestrator.js` — Import `mcp-dist-fresh` and `orchestrator-venv` checks from `health-checks.js`, replacing the two local implementations (orchestrator-specific checks unchanged)
- `ai-insights/package.json` — Add `bin` field; bump `@mistralys/cli-menu` dependency to `^1.1.0`

### External Paths (written by `install-mcp`)
- `~/.ai-insights/bin/launch-server.js` — Stable shim
- `~/.ai-insights/config.json` — Repo path reference
- `~/Library/Application Support/Code/User/mcp.json` (macOS) — VS Code user MCP config

## Assumptions

- `claude mcp add --scope user` is available as a CLI command on all platforms where Claude Code is installed. If it isn't available, the install-mcp command will skip Claude Code registration with a warning.
- VS Code user-level MCP config uses the `mcpServers` key (same format as workspace-level `.mcp.json`). To be verified during implementation.
- The global shim execs `node {repoPath}/mcp-server/dist/index.js`. This requires the MCP server dist to be built before running `install-mcp`. The command validates dist existence before writing the shim and prints an actionable error if the dist is missing.
- The `cli-menu` version will be bumped as a minor release (1.1.0) for the new optional properties (`statusLines`, `firstRunRedirect`, `onFirstRun`). `ai-insights/package.json` dependency must be explicitly bumped to `^1.1.0` as part of Step 3.
- `onFirstRun` returns `string[]` (pre-selected component IDs) that the library captures and forwards to `runSetup`. Consumers returning an empty array (`[]`) produce the same behaviour as passing no pre-selection (interactive checkbox UI for all components).
- Status line rendering adds < 10 ms per menu render (only `instant` checks are run).
- The shebang `#!/usr/bin/env node` is compatible with all supported platforms (Windows ignores it; npm generates a `.cmd` wrapper automatically).

## Constraints

- `cli-menu` remains zero-dependency — no npm packages added to its `dependencies`.
- All new code must be cross-platform (Windows/macOS/Linux).
- `scripts/lib/health-checks.js` must be importable from both `cli.js` and `preflight-orchestrator.js` (ESM).
- The dependency direction is strictly one-way: `cli.js → health-checks.js`. `health-checks.js` must not import from `cli.js`.
- The global MCP shim must use `child_process.spawn` with `{ stdio: 'inherit' }` — stdout must not be buffered. Any spawn mechanism that buffers stdout will silently break STDIO JSON-RPC message delivery to the IDE.
- The global MCP registration must never overwrite or reorder other entries in the user's `mcp.json`.
- Status lines must not slow menu rendering — only `instant`-cost checks (< 5 ms each).

## Out of Scope

- Embedded GUI via `--gui` flag (Tier 2 — separate plan)
- `.vscode/tasks.json` (Tier 2)
- Shell alias / global CLI install (Tier 2)
- Contextual suggestions in menu (Tier 2)
- `post-merge` Git hook (Tier 3)
- npm-published MCP server (Tier 3)
- Workspace-level npx bootstrap (`create-ai-insights`) (Tier 3)
- `postinstall` guidance (depends on user feedback)
- npx-based zero-install server (needs further thought)
- Self-registering `--self-register` flag on MCP server (Tier 2)

## Acceptance Criteria

1. Running `./menu.sh` displays a health status block below the version line showing pass/fail for: MCP dist, hooks, node version, sibling repos.
2. `node scripts/cli.js doctor` prints a comprehensive check report (all tiers, including async `slow` checks) with actionable fix commands and exits 1 on any failure.
3. `node scripts/cli.js install-mcp` registers `central_pm` in VS Code user-level `mcp.json` via the stable shim. Re-running is idempotent. `--dry-run` shows the diff without writing.
4. `npx ai-insights` works from the workspace root after running `npm link` (or after global install). For local verification without `npm link`, use `node scripts/cli.js help` as the short-invocation smoke test. The `bin` field is the standard npm mechanism ensuring the executable is available when the package is installed globally or linked.
5. On a fresh clone with no setup completed, launching the menu auto-redirects to the setup wizard (skippable with `q`). The redirect presents a scope-selection prompt (global vs workspace-only).
6. Passing `--skip-setup-check` bypasses the first-run redirect entirely.
7. After modifying `mcp-server/src/` without rebuilding, the next menu launch auto-rebuilds `dist/` before presenting commands.
8. When `../cli-menu` directory is missing, the bootstrap prints the exact `git clone` command.
9. If the repo path in `~/.ai-insights/config.json` no longer exists, the shim prints a clear diagnostic to stderr and exits 1 (not a silent failure).
10. The existing `mcp-json` setup component is labelled as the secondary/override option; `global-mcp` is positioned after it in `SETUP_COMPONENTS` and labelled as recommended.
11. All features work on macOS, Linux, and Windows.

## Testing Strategy

Testing is split across the two packages:

- **`cli-menu` library changes:** Unit tests in `cli-menu/tests/` using Vitest. Test the new `statusLines` rendering and `firstRunRedirect` logic in isolation with mocked configs.
- **`ai-insights` script changes:** Integration tests verifying health-check registry output, doctor command exit codes, and install-mcp dry-run output. Use the existing `vitest` setup at the workspace root (`vitest.config.ts` targeting `scripts/tests/`).
- **Cross-platform:** CI matrix already tests on multiple Node versions; path-related tests use `path.join()` assertions rather than literal separators.

## Test Plan

- `cli-menu/tests/menu/renderer.test.ts` — Add test: `renderMenu()` with `statusLines` config writes status block to stdout between version and commands — covers AC 1.
- `cli-menu/tests/menu/interactive.test.ts` — Add tests: when all `detect()` return false and `firstRunRedirect: true`, the redirect message is written, `onFirstRun` is called, and `runSetup()` is called; when any `detect()` returns true, menu renders normally — covers AC 5. Also test that `waitForSkip()` (inlined in `interactive.ts`) resolves correctly on timeout and on `q` keypress.
- `ai-insights/scripts/tests/first-run.test.js` (new) — Test: `--skip-setup-check` flag suppresses first-run redirect even when all `detect()` return false (consumer-side argv parsing); `handleFirstRun()` pre-selects the correct setup component based on scope selection — covers AC 5, 6.
- `ai-insights/scripts/tests/health-checks.test.js` (new) — Test: `runChecks('instant')` returns expected shape; mock filesystem for detect functions; verify cost filtering excludes `slow` checks; verify async `slow` checks resolve correctly when included — covers AC 1, 2 foundation.
- `ai-insights/scripts/tests/doctor.test.js` (new) — Test: doctor command returns exit code 1 when any check fails, 0 when all pass; verify async `slow` checks (e.g. `personas-fresh`) are awaited before exit code is determined — covers AC 2.
- `ai-insights/scripts/tests/install-mcp.test.js` (new) — Test: `--dry-run` outputs valid JSON diff without writing files; `installVSCode()` merges only `central_pm` key; idempotent re-run produces no changes; shim validates `repoPath` existence and exits 1 with diagnostic when path is invalid — covers AC 3, 9.
- `ai-insights/scripts/tests/bootstrap.test.js` (new) — Test: staleness detection triggers rebuild when src mtime > dist mtime; missing sibling prints clone guidance — covers AC 7, 8.

## Documentation Updates

- `cli-menu/docs/agents/project-manifest/api-surface.md` — Add `statusLines`, `firstRunRedirect`, and `onFirstRun` to `MenuConfig` documentation.
- `cli-menu/docs/configuration.md` — Add `statusLines`, `firstRunRedirect`, and `onFirstRun` to the user-facing `MenuConfig` property reference table (linked from the `cli-menu` README).
- `cli-menu/docs/agents/project-manifest/data-flows.md` — Update §4 (interactive menu loop) to document status-line rendering step and first-run redirect.
- `cli-menu/CHANGELOG.md` — New entry for v1.1.0 with `statusLines`, `firstRunRedirect`, and `onFirstRun`. Alongside this, bump `cli-menu/package.json` `"version"` to `"1.1.0"`.
- `ai-insights/README.md` — Add "Quick Launch" section documenting `menu.sh`/`menu.cmd`/`npx ai-insights`; document `install-mcp` and `doctor` commands.
- `ai-insights/AGENTS.md` — Update Root-Level Tooling table with `scripts/lib/health-checks.js` and `scripts/install-mcp-global.js`; add a row to the Cross-System Dependencies table: `Global MCP registration server key → install-mcp-global.js (hardcodes central_pm) → must stay in sync with personas/ledger/src/meta/_shared.yaml → mcp_server_name`.
- `ai-insights/mcp-server/docs/agents/project-manifest/README.md` — Reference global MCP registration as the primary configuration method (replaces per-project `.mcp.json` as default recommendation).
- `personas/docs/agents/project-manifest/constraints.md` — Note that `mcp_server_name` is now used in global registration (in addition to `.mcp.json`).

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **VS Code user-level `mcp.json` format differs from workspace-level** | Verify format before implementation by inspecting VS Code source/docs. Use `MCP: Open User Configuration` command output as reference. Fall back gracefully if format is unexpected. |
| **`claude mcp add` not available on all platforms** | Wrap in try/catch; skip with informational warning. Document as optional. |
| **Status lines slow down menu render** | Cost-tier system ensures only `instant` (< 5 ms) checks run on render. Benchmark during implementation. |
| **Global MCP registration path breaks on repo move** | Stable-shim indirection: IDE config → shim → `config.json` → real path. Moving repo → re-run `install-mcp` (updates one file). |
| **First-run redirect surprises returning users who cleared state** | The 2-second skip window with `q` key provides an escape hatch. Only triggers when *all* components are undetected. |
| **`bin` field conflicts with existing `menu.sh` wrapper** | They are complementary, not conflicting. `npx ai-insights` works after `npm install`; `menu.sh` works without it. Document both. |
| **Breaking change to `cli-menu` API** | No breaking change — both new properties are optional. Existing consumers are unaffected. Ships as minor version bump. |
| **Shim exec fails because MCP server dist is not built** | `install-mcp` validates that `mcp-server/dist/index.js` exists before writing the shim. If the dist is missing, the command exits with an actionable error: "MCP server is not built. Rebuild the MCP server first." |
