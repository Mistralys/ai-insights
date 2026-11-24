# Plan

## Plan Audit Cycles
- Audits: 1 (Sonnet 5.5 ×1) — Plan Auditor v1.12.0
- Architectural Reviews: 1 (Sonnet 5.5 ×1) — Plan Architect Reviewer v2.3.4

## Prior Project Context

The repository's short-term vision is the lowest possible friction for setup and daily use, and the long-term vision includes reliability on Windows, macOS and Linux. Untracking `personas/name-mapping.json` creates a new "file is missing" state for every fresh clone and, through Git's handling of untracked deletions, for every existing user on their next pull. This plan exists so that this state never stops the MCP server or the GUI from starting, explains itself in the GUI and the CLI, and can be fixed with one click or one command. No stored insight touches name mapping or model assignment loading.

## Summary

`personas/name-mapping.json` is a generated build artefact whose model fields (`model`, `model_slug`, `cc_model`) come from each user's gitignored model registry files, so a tracked copy is dirty on every machine with custom assignments. This plan stops tracking the file, adds it to `.gitignore`, and makes every consumer survive its absence. The MCP server and GUI server load it tolerantly through a new loader module instead of a module-load `require`. The GUI shows a global setup notice with a one-click "Build personas" action. The CLI health checks and `setup` command detect and repair the missing state, and the documentation stops describing the file as tracked.

## Architectural Context

- **Generator:** `scripts/build-personas.js` (L103–111) writes `personas/name-mapping.json` on every real build via `scripts/lib/name-mapping.js` (`generateNameMapping()`, `writeNameMapping()`). The generator only needs `fs`, `path`, `scripts/lib/persona-model-resolution.js` and `scripts/lib/yaml-utils.js`. Model fields are resolved from `personas/model-registry/default.json`, plus the gitignored `local.json` and `assignments.json`.
- **MCP server consumer:** `mcp-server/src/utils/constants.ts` L204–208 builds `AGENT_NAMES` with `createRequire(...)('../../../personas/name-mapping.json')` at module load. `mcp-server/src/tools/workflow-handoff.ts` L227 reads `AGENT_NAMES[nextAgent]` to add `cc_agent_name`, `vs_agent_name` and `da_agent_name` to the auto-handoff payload, and already skips them when the lookup is falsy.
- **GUI server:** `mcp-server/gui/server.ts` (L25) and `mcp-server/gui/api.ts` (L28) import `constants.ts`, so the GUI server inherits the start-up crash. `buildConfigRoutes()` is at L506 and `buildModelRoutes()` (with `POST /api/personas/rebuild`) at L700. `mcp-server/gui/api-models.ts` already handles a missing file:
  - `handleGetPersonas()` returns `[]`;
  - `handleUpdateAssignments()` returns a 400;
  - `computeStale()` returns `false`;
  - `POST /api/personas/rebuild` (`handleRebuildPersonas`) spawns the full build behind a 409 concurrency guard.
- **GUI frontend:**
  - `mcp-server/gui/public/views/config-persona-models.js` (L186–192) already shows a pre-build state with a "Rebuild Personas" button. Its `pmDoRebuild()` (L643) follows the Config tab visit-token contract (`mcp-server/gui/docs/agents/project-manifest/constraints.md`, integration point 5): `pmIsBuilding` is cleared before the `visit !== pmVisit` stale check, and every other callback effect returns early when the visit is stale.
  - `mcp-server/gui/public/stale-check.js` is the only global banner; it covers version mismatch only and stops polling once shown.
  - Scripts are loaded from `mcp-server/gui/public/index.html` with manual `?v=N` cache-busting.
- **CLI:**
  - `scripts/cli.js` `SETUP_COMPONENTS` (L183–240): `personas.detect()` checks only `node_modules` freshness.
  - `scripts/lib/health-checks.js` `HEALTH_CHECKS` is a data-driven registry of instant, fast and slow checks.
- **Tests:**
  - `mcp-server` `pretest` always runs a persona build, so tests can rely on a fresh mapping.
  - Two test files import `AGENT_NAMES`: `mcp-server/tests/integration/auto-handoff.test.ts` (L8) and `mcp-server/tests/gui/handoff-config-integration.test.ts` (L29, asserting the three target names at L134–136).

## Approach / Architecture

1. **Ignore, don't track.** Add `/personas/name-mapping.json` to `.gitignore`. Removing it from the index is a Git write left to the user (see Human Actions).
2. **Tolerant, reloading loader (MCP server core).** Add a new module, `mcp-server/src/utils/name-mapping.ts`, which owns the `TargetNames` / `NameMappingEntry` types and these functions:
   - `resolveNameMappingPath()`, derived from the existing `WORKSPACE_ROOT` in `mcp-server/src/utils/ledger-root.ts`. It is the single path owner inside `mcp-server`: the GUI's `api-models.ts` and `setup-notices.ts` use it instead of their own derivation. Root scripts keep their own helper, since they sit across the package boundary;
   - `getAgentNames(): Partial<Record<AgentRole, NameMappingEntry>>`, which reads the file lazily, caches it by `mtimeMs` and reloads when the file changes;
   - `isNameMappingPresent()`;
   - a test-only `_resetNameMappingCache()`.

   When the file is missing or malformed, the loader returns `{}` and writes one warning to **stderr** per process and failure kind; it never throws. `constants.ts` loses its file I/O entirely: `AGENT_NAMES` and `createRequire` are removed. Because `constants.ts` no longer reads the file, the GUI server crash disappears too.
3. **GUI setup notices.**
   - **Server side:** add a new module, `mcp-server/gui/setup-notices.ts`. It defines a typed `SetupNotice` and a single `detectSetupNotices(): SetupNotice[]` function, which today checks only for the missing mapping. `GET /api/setup-notices` returns the active notices as an array. The array-shaped endpoint is the durable contract; a provider registry is deferred until a second notice exists, and introducing it then changes no client code.
   - **Client side:** add a new `mcp-server/gui/public/setup-notices.js` that renders a global banner above `<header>` with a "Build personas" button. The button calls the existing `POST /api/personas/rebuild`.
   - **Polling:** the module polls only while at least one notice is visible, so a build run from the CLI clears the banner on its own.
   - **Persona Models tab:** one-way sync only. A successful rebuild in the tab calls `SetupNotices.refresh()`, so the banner clears at once. The banner does not reach into the tab. Concurrent builds are already prevented by the server's 409 `CONFLICT` guard, and the Config page re-fetches personas every time the route is entered, so a tab left open during a banner build is fixed by re-entering Config or by its own rebuild button.
4. **CLI repair paths.**
   - Add an instant-tier `name-mapping-present` health check.
   - `SETUP_COMPONENTS.personas.detect()` also requires the mapping, so `node scripts/cli.js setup` repairs a missing file.
5. **Docs and changelogs** stop describing the file as Git-tracked, and they describe the new loader, endpoint, notice and recovery paths. The workspace-wide facts now live in the hub documents under `docs/agents/project-manifest/`. In `generated-artefacts.md`, the file moves from *Tracked Generated Artefacts → Runtime-coupled* to *Ignored Generated Artefacts*, and the *Known Contradictions* entry that names this plan as pending is removed.

## Rationale

- **Only the build should create the file.** Each user's model assignments feed it, and the build already produces it at every entry point: `npm test` pretest, CLI `setup`, `sync-personas`, and the GUI rebuild button. Ignoring the file removes the per-user dirty state without losing any capability.
- **Untracking makes names more consistent, not less.** Today a pull refreshes the tracked mapping's versioned VS Code agent names (e.g. `"3 - Developer v3.18.1"`) while the deployed persona files stay at the old version until the user re-syncs, so the two disagree. Once the same local build produces both, they always match.
- **Missing must mean degraded, not crashed.** Absence becomes a normal state (fresh clone, or a pull that deletes the file), so the server must degrade rather than crash. The handoff payload already treats the target-specific names as optional, so the degraded mode is "omit three optional fields", which is safe.
- **Reloading on mtime fixes an existing bug as a side effect.** A rebuild after start-up becomes visible without restarting the MCP server, which also fixes the stale-version handoff names that exist today. The cost is one `statSync` per handoff.
- **Why an array-shaped endpoint but no provider registry yet:** there is one notice today (missing mapping). Further candidates exist, such as an empty model registry (`config-persona-models.js` L125) and an orchestrator venv for the Orchestrator view, but none is in scope. The array-shaped endpoint and the client banner, which renders any number of notices, are the parts later notices depend on, so they ship now. The `SetupNoticeProvider` interface and registry would have no second consumer in this plan; turning `detectSetupNotices()` into a registry when the second notice arrives is a local server-side change with no client impact.
- **Why one-way banner-to-tab sync:** the server's 409 guard already prevents double builds, and the Config route re-fetches personas on every entry. A shared building flag, a custom window event and a dirty-state guard would add cross-module coupling to cover a rare race and a stale tab that one navigation fixes. The one remaining call (tab → `SetupNotices.refresh()`) keeps the global banner truthful, which is the surface users see everywhere, and keeps `SetupNotices` as decoupled from views as `StaleCheck` is.
- **Why one name-mapping path owner per package:** inside `mcp-server`, deriving the path twice (loader via its own `import.meta.url` arithmetic, GUI via `WORKSPACE_ROOT`) adds something to keep in sync for no gain. Anchoring the loader on `WORKSPACE_ROOT` from `mcp-server/src/utils/ledger-root.ts` and having the GUI call the loader gives one derivation. Because `resolveNameMappingPath()` reads `WORKSPACE_ROOT` per call, the existing GUI tests' `vi.mock` of `ledger-root.js` (a getter returning a temp root) keeps redirecting the path, so no new override parameter is needed for test isolation. Root scripts keep their own `scripts/lib/name-mapping.js` helper, since they cannot import the TS server.
- **The server does not generate the file itself.** It does not spawn the generator at start-up, because that would mix the build system into the MCP runtime (see Considered Alternatives).

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Handling user-specific content | Ignore the whole file | Split into tracked shared fields plus an ignored overlay of model fields; track the file but always write default models; `git update-index --skip-worktree` | The split keeps version diffs visible but adds a second file every reader must merge. Default-only writing makes the GUI show wrong models. skip-worktree is per-clone, invisible, and conflicts on pull. The build is already the sole producer, so ignoring is enough. |
| Missing file in MCP server | Lazy tolerant loader returning `{}` plus a stderr warning | Fail fast with a clear error; generate the file at server start by importing `scripts/lib/name-mapping.js` | Fail-fast turns a routine post-pull state into an outage of every ledger tool. Generating at start-up couples the compiled TS server to root JS build scripts and writes into `personas/` from the runtime. Degrading only the three optional handoff fields is safe. |
| Seeding a missing file | No seed; the full persona build is the only producer | Copy a tracked default the way `mcp-server/src/gui/model-registry.ts` creates `local.json` from `default.json` on first access; have the loader run the dependency-free generator (`scripts/lib/name-mapping.js`) on demand | The registry pattern only works for user-owned seed data. The mapping is derived from persona YAML, so a tracked default would go out of date with every persona version bump. On-demand generation would write names from the current YAML that can differ from the deployed persona files after a pull without a re-sync. Omitting the names is safer, because the primary `agent_name` in the handoff comes from `getAgentHandle()` in `mcp-server/src/utils/agent-registry.ts`, which scans the deployed files and is always accurate. |
| Load timing | Lazy with `mtimeMs` cache and reload | Load once at first use; reload on every call | Load-once keeps today's stale-version-after-rebuild bug. Reading on every call parses JSON on every handoff. An mtime check costs one `statSync`. |
| Where the loader lives | New `mcp-server/src/utils/name-mapping.ts` | Keep in `constants.ts` behind a try/catch | Keeping I/O in `constants.ts` means every importer of a regex or filename constant, including the GUI server, pays for and depends on a generated file. A dedicated module isolates the dependency. |
| Informing GUI users | Global setup-notice banner plus the existing Persona Models pre-build state | Extend `/api/server-info` and `stale-check.js`; only rely on the Persona Models tab | `stale-check.js` stops polling once shown and covers a different concern (relaunch needed), so overloading it entangles two lifecycles. The tab alone is undiscoverable from the projects screen, where degraded handoffs actually matter. |
| Notice detection shape | `GET /api/setup-notices` returning an array built by one `detectSetupNotices()` function | `SetupNoticeProvider` interface plus `SETUP_NOTICE_PROVIDERS` registry; a `setup` field on `/api/server-info` | The registry has no second consumer in scope, and the array-shaped response already lets it be added later without client changes. Extending `/api/server-info` ties the notice to the `stale-check.js` lifecycle. |
| Banner and Persona Models tab coordination | One-way: tab rebuild calls `SetupNotices.refresh()`; the server's 409 guard covers concurrency | Bidirectional sync (`ai-insights:personas-rebuilt` event, shared `SetupNotices.isBuilding()`, `configDirty` guard); remove the tab's own pre-build button | Bidirectional sync couples a global module to a view to cover a rare race already guarded by the server, and a stale tab that re-entering Config fixes. Removing the tab's button breaks an existing, discoverable recovery path. |
| Name-mapping path derivation in `mcp-server` | One owner: `resolveNameMappingPath()` in `src/utils/name-mapping.ts`, anchored on `WORKSPACE_ROOT` from `src/utils/ledger-root.ts`; GUI modules call it | Loader derives its own path from `import.meta.url` and the GUI exports its private `nameMappingPath()` | Two derivations of one file inside one package can drift. Reading `WORKSPACE_ROOT` per call keeps the GUI tests' existing `ledger-root.js` mock effective, so consolidating costs nothing in test isolation. |
| Helping GUI users create the file | Banner button calling the existing `POST /api/personas/rebuild` | New "generate mapping only" endpoint using the dependency-free generator; link to Config tab only | The full build also refreshes the deployed persona output, keeping names and agent files consistent; a mapping-only endpoint would reintroduce the mismatch. Config tabs are not hash-routable, so a link alone cannot land on the right tab. |
| Notice polling | Poll every 30 s only while notices are visible | Fetch once on load; always poll | Fetch-once leaves the banner up after a CLI build until reload. Polling always is wasted traffic once setup is complete. |
| Untracking mechanics | `.gitignore` entry in the run; `git rm --cached` as a human action after the run | Agent runs `git rm --cached` | Index changes are Git writes, which the user owns. |

## Pattern Alignment

- **Follows** the domain-split GUI handler modules composed by `build*Routes()` in `mcp-server/gui/server.ts`. The new `mcp-server/gui/setup-notices.ts` sits next to `mcp-server/gui/api-models.ts`, and its route goes into `buildConfigRoutes()` next to `GET /api/server-info`.
- **Follows** the global IIFE module pattern of `mcp-server/gui/public/stale-check.js` (`var X = (function () { … return { init: init }; }())`), the banner placement before `body > header`, and init from `mcp-server/gui/public/app.js`. Like `StaleCheck`, `SetupNotices` does not reach into any view; the only coupling is the Persona Models tab calling `SetupNotices.refresh()` behind a `window.SetupNotices` guard.
- **Follows** the single workspace-root anchor `WORKSPACE_ROOT` in `mcp-server/src/utils/ledger-root.ts`, already used by `mcp-server/gui/api-models.ts`, and the GUI tests' `vi.mock` of `ledger-root.js` for path isolation (`mcp-server/tests/gui/api-models.test.ts`).
- **Follows** the manual `?v=N` cache-busting rule in `mcp-server/gui/docs/agents/project-manifest/constraints.md`.
- **Follows** the data-driven health-check registry in `scripts/lib/health-checks.js` and the `detect()`/`run()`/`validate()` setup components in `scripts/cli.js`.
- **Follows** the MCP server's stderr-only logging rule (`mcp-server/docs/agents/project-manifest/constraints.md`).
- **Follows** the gitignored-generated-output pattern of `.gitignore` (persona output, model registry user files).
- **Departs** from the "derive at module load" style of `mcp-server/src/utils/constants.ts` for the name mapping only. Its source is now an optional generated artefact, which the manifest-derived constants are not. The workflow-manifest-derived constants keep module-load derivation.

## Structural Improvements

| Structure | Observation | Decision | Reason |
|-----------|-------------|----------|--------|
| `mcp-server/src/utils/constants.ts` (`AGENT_NAMES`, `createRequire`) | A pure-constants module performs I/O against a generated file, crashing both the MCP server and the GUI server when it is missing | Promoted to step 1 | Required for the missing state to be survivable; isolating the dependency is the fix itself. |
| `AGENT_NAMES` load-once semantics | Versioned agent names stay stale after a rebuild until the server restarts | Promoted to step 1 | The mtime reload costs one `statSync` and comes free with the new loader. |
| `mcp-server/gui/api-models.ts` `nameMappingPath()` (private) | Duplicates the path the new loader resolves; the setup-notice check needs it too | Promoted to step 4 | Delegate to the loader's `resolveNameMappingPath()` so `mcp-server` has one derivation; the existing `ledger-root.js` test mock keeps working because the path is resolved per call. |
| `scripts/cli.js` `SETUP_COMPONENTS.personas.detect()` | Reports personas as set up even when the build output is missing | Promoted to step 8 | Without this, `setup` cannot repair the state this plan creates for existing users on pull. |
| Name-mapping path in root scripts (`scripts/build-personas.js` L105 inline `path.join`) | The path would be re-derived in `cli.js` and `health-checks.js`; `cli.js` is untestable on import | Promoted to step 8 | One exported helper in the existing generator module (`scripts/lib/name-mapping.js`) gives three consumers a single path and a testable predicate. |
| `mcp-server/gui/public/stale-check.js` | The only global banner, but single-purpose and stops polling once shown | Rejected | Generalising it would merge "relaunch the GUI" and "build something" lifecycles; a sibling module is cleaner and leaves stale-check's tested behaviour untouched. |
| `mcp-server/gui/api-models.ts` `computeStale()` returns `false` when the mapping is missing | Could report "stale" for a never-built state | Rejected | The Persona Models tab renders its pre-build state before the stale banner when personas are empty, so the flag is never shown in that state; the new setup notice covers the global case. |
| `mcp-server/gui/public/views/config.js` tabs not hash-routable | A banner cannot deep-link to Config → Persona Models | Rejected | The banner acts directly (Build personas) instead of linking; deep-linkable config tabs are outside this plan's blast radius. |
| `scripts/preflight-bootstrap.js` | Not invoked by any script, npm script or `bin` entry | Rejected | Not touched by this plan; whether to wire or delete it is a separate decision. |

## Detailed Steps

1. **Create the tolerant name-mapping loader** in a new file, `mcp-server/src/utils/name-mapping.ts`.
   - **Types:** move the `TargetNames` and `NameMappingEntry` interfaces (with their doc comments) here from `mcp-server/src/utils/constants.ts`.
   - **`resolveNameMappingPath(): string`:** returns `path.join(WORKSPACE_ROOT, 'personas', 'name-mapping.json')`, importing `WORKSPACE_ROOT` from `./ledger-root.js`. Read `WORKSPACE_ROOT` inside the function on every call, never into a module-level constant, so tests that mock `ledger-root.js` with a getter (as `mcp-server/tests/gui/api-models.test.ts` does) redirect it. `ledger-root.ts` already handles the `src/` versus `dist/` depth.
   - **`getAgentNames(filePath = resolveNameMappingPath()): Partial<Record<AgentRole, NameMappingEntry>>`:**
     - `fs.statSync` the file. If it does not exist, return `{}` and write a one-time stderr warning, e.g. `[project-ledger-mcp] personas/name-mapping.json not found — run "node scripts/build-personas.js"; auto-handoff responses will omit target-specific agent names.`
     - If `mtimeMs` equals the cached value, return the cached map.
     - Otherwise read and `JSON.parse` the file and keep `Array.isArray` entries with `!entry.suite || entry.suite === 'ledger'`, keyed by `role`.
     - On a parse error or a non-array, return `{}` and write a one-time stderr warning naming the problem.
     - Warnings are deduplicated per failure kind and reset when the file loads successfully.
   - **`isNameMappingPresent(filePath = resolveNameMappingPath()): boolean`.**
   - **`_resetNameMappingCache(): void`** (test-only, marked `@internal`).
   - **Remove from `constants.ts`:** the `AGENT_NAMES` export, the `createRequire` import and the `_require` constant. Do not re-export the moved types from `constants.ts`; update the importers instead.
2. **Switch `workflow-handoff.ts` to the loader.** In `mcp-server/src/tools/workflow-handoff.ts`, replace the `AGENT_NAMES` import with `getAgentNames` from `../utils/name-mapping.js`, and change L227 to `const agentNames = nextAgent ? (getAgentNames()[nextAgent as AgentRole] ?? null) : null;`. Leave the conditional spread unchanged.
3. **Update the MCP server tests.**
   - Migrate both test importers of `AGENT_NAMES` to the loader, replacing the `constants.js` import with `getAgentNames` from `../../src/utils/name-mapping.js` (e.g. `const AGENT_NAMES = getAgentNames();` in setup) and keeping the existing assertions:
     - `mcp-server/tests/integration/auto-handoff.test.ts` (L8, uses at L734–837);
     - `mcp-server/tests/gui/handoff-config-integration.test.ts` (L29, assertions at L134–136). This file does not mock `ledger-root.js`, so the default path resolves to the real mapping produced by the `pretest` build.
   - Add a new `mcp-server/tests/utils/name-mapping.test.ts`, using temp dirs via `os.tmpdir()` (see Test Plan).
   - Add a handoff test proving the payload omits the three target names, without throwing, when the loader returns `{}`. Inject a missing path with `vi.mock` of `../utils/name-mapping.js`, or with a path parameter.
4. **Add the GUI setup-notices backend** in a new file, `mcp-server/gui/setup-notices.ts`.
   - Export the type: `interface SetupNotice { id: string; severity: 'warning'; title: string; message: string; action?: { kind: 'rebuild-personas'; label: string } }`.
   - Export `detectSetupNotices(): SetupNotice[]`. It builds the array inline and today adds one notice, `personas-not-built`, when `isNameMappingPresent()` (from `../src/utils/name-mapping.js`) is `false`, with title "Personas have not been built" and message "Agent handoffs omit IDE-specific agent names and persona model settings are unavailable until the persona build has run.", plus action `{ kind: 'rebuild-personas', label: 'Build personas' }`. Add no provider interface or registry; a doc comment states that a registry is the intended refactor when a second notice is added.
   - Export `handleGetSetupNotices(): Promise<{ notices: SetupNotice[] }>`, which returns `{ notices: detectSetupNotices() }`.
   - In `mcp-server/gui/api-models.ts`, make the private `nameMappingPath()` delegate to `resolveNameMappingPath()` from `../src/utils/name-mapping.js` (or replace its call sites with it), so `mcp-server` has a single derivation. `mcp-server/tests/gui/api-models.test.ts` must stay green unchanged, which proves the `ledger-root.js` mock still redirects the path.
   - Register `GET /api/setup-notices` (`noBody: true`) in `buildConfigRoutes()` in `mcp-server/gui/server.ts`, and update the route listing in that function's doc comment.
5. **Add the client API wrapper.** In `mcp-server/gui/public/api-client.js`, add `getSetupNotices()` → `request('GET', '/setup-notices')` with a JSDoc typedef for `SetupNotice`, matching the `getServerInfo` documentation style.
6. **Add the setup-notices banner** in a new file, `mcp-server/gui/public/setup-notices.js`, as IIFE `SetupNotices` exposing `init()` and `refresh()`.
   - **Rendering:**
     - `refresh()` fetches the notices and renders a container `#setup-notices` inserted before `body > header`. If `.stale-banner` is present, the container goes after it.
     - Each notice gets a `.setup-banner` block with title and message. Use `textContent` only, never `innerHTML`, for server-provided strings.
     - A notice with an `action` gets a `<button type="button">`; `rebuild-personas` calls `API.rebuildPersonas()`.
     - **Button label:** use the same label as the Persona Models pre-build button. Align both on "Build personas" (change the tab's "Rebuild Personas" pre-build label accordingly).
   - **Accessibility:**
     - `#setup-notices` is a live region: `role="status"` and `aria-live="polite"`. Do not use `role="alert"`, since a missing file is a degraded state, not an emergency. The container stays in the DOM (empty) so later insertions are announced.
     - While building, the button is `disabled` and its text reads "Building…". The spinner is `aria-hidden="true"`; the text carries the meaning.
     - The button has an explicit `:focus-visible` outline with at least 3:1 contrast against the banner background in both themes.
     - Failure output sits in `<details>` with a visible `<summary>` ("Build output") and a `<pre>` with `overflow: auto` and a `max-height`, so long logs neither clip nor push the page down.
   - **While building:** the button is disabled and shows the spinner. Building state is private to `SetupNotices`; it is not shared with the Persona Models tab. A build started from the other surface is rejected by the server's 409 guard and shown as "already running".
   - **On success:** call `refresh()`. Dispatch no window event.
   - **On failure:**
     - show an inline error: "Build failed — run `node scripts/cli.js setup` in a terminal, or see Config → Persona Models for the build output". Because the module uses `textContent` only, render the command as a `<code>` element created with `createElement`, not as literal backticks;
     - put the output from the `BUILD_FAILED` error message in a collapsible `<details>`, reusing the `.pm-build-error-pre` class so it matches the Persona Models tab;
     - treat a 409 `CONFLICT` as "build already running", not as a failure. Show a "Build already running…" state with the button disabled and keep polling, so the banner clears on its own when the other build finishes.
   - **Polling and lifecycle:**
     - `init()` performs the first `refresh()` immediately. After every fetch, `refresh()` starts the 30 s timer if at least one notice is shown and no timer is running, and clears it when the list is empty. A later `refresh()` (for example, after the file is deleted again) therefore restarts polling.
     - Polling is skipped while `document.hidden`, and a `visibilitychange` back to visible triggers an immediate `refresh()`.
     - Network errors are ignored and the next poll retries.
     - `init()` is idempotent.
   - **Styles:** add `.setup-banner` styles to `mcp-server/gui/public/styles.css`.
     - Reuse the existing `--color-banner-stale-*` tokens (they already have light and dark values); introduce no new colours.
     - **Positioning:** `#setup-notices` is a non-sticky block in normal flow, so it scrolls away and never overlaps the sticky `.stale-banner` or the sticky `header`. Do not copy `position: sticky` from `.stale-banner`.
     - **Layout:** a flex layout with `flex-wrap: wrap` and `gap` (as in `.pm-stale-banner`), so the button wraps below the text at narrow widths and at 200% zoom instead of clipping.
     - Add no animation. The spinner is the only motion, and the stylesheet has no `prefers-reduced-motion` rule; do not add motion beyond it.
7. **Wire the banner into the GUI.**
   - `mcp-server/gui/public/index.html`: add `<script src="/setup-notices.js?v=1"></script>` after `stale-check.js`, and bump `api-client.js`, `app.js`, `views/config-persona-models.js` and `styles.css` `?v=N`.
   - `mcp-server/gui/public/app.js`: call `SetupNotices.init()` after `StaleCheck.init()`.
   - `mcp-server/gui/public/views/config-persona-models.js`:
     - after a successful rebuild in `pmDoRebuild()` (L643), call `SetupNotices.refresh()` when `window.SetupNotices` is defined. Place the call next to `pmIsBuilding = false`, **before** the `visit !== pmVisit` early return. The build result is global, so the banner must update even when the user has left the tab, and the call writes nothing into `#config-tab-content`, so the visit-token rule (`mcp-server/gui/docs/agents/project-manifest/constraints.md`, integration point 5) still holds. This is the only cross-module call; add no event listener and no shared building flag;
     - rename the pre-build button label (`#pm-prebuild-rebuild-btn`, L190) from "Rebuild Personas" to "Build personas" to match the banner. Only L190 changes: the stale-banner button (L204) and the action-bar button (L375) keep "Rebuild Personas", since they rebuild an existing output. Keep the "Rebuilding…" building text, or align it to "Building…" in the pre-build state only;
     - extend the pre-build message (L188) with a second sentence: "This file is generated locally and is not stored in Git."
8. **Add the CLI repair paths.**
   - In `scripts/lib/name-mapping.js`, add and export `nameMappingPath(personasDir)` → `path.join(personasDir, 'name-mapping.json')` and `isNameMappingPresent(personasDir)` → `fs.existsSync(nameMappingPath(personasDir))`. Use `nameMappingPath()` in `scripts/build-personas.js` L105 instead of its inline `path.join`.
   - In `scripts/cli.js`, make `SETUP_COMPONENTS` `personas.detect()` also return `false` when `!isNameMappingPresent(PERSONAS_DIR)`. Extend `validate()` the same way (vs-code output present **and** mapping present). `cli.js` exports nothing and runs a menu on import, so the predicate is tested through the helper, not through `SETUP_COMPONENTS`.
   - In `scripts/lib/health-checks.js`, add an instant-tier check after `mcp-dist`: `{ id: 'name-mapping-present', label: 'Persona name mapping built', cost: 'instant', detect: () => isNameMappingPresent(path.join(WORKSPACE_ROOT, 'personas')), fix: 'node scripts/build-personas.js' }`. `WORKSPACE_ROOT` already exists at L30.
9. **Ignore the file.** Add `/personas/name-mapping.json` to `.gitignore`, grouped with the `/personas/model-registry/…` entries, with a comment: `# Generated per user by scripts/build-personas.js (contains model assignments)`.
10. **Update the documentation** listed in Documentation Updates, including regenerating `.context/` with `node scripts/cli.js ctx-generate`. If `ctx` is not on PATH, record that in the pipeline summary; it does not block the run.
11. **Add the changelog entries**, following the house style (≤ 100-character lines) and rule 9 of the Changelog Convention (`docs/agents/project-manifest/constraints.md`: one WIP entry per changelog, never a second one):
    - `mcp-server/changelog.md`: add the entry to the existing `## v… - **WIP; UNRELEASED**` entry (v2.12.0 when this plan was refreshed) rather than opening a new version. Content: tolerant mapping loader with live reload; GUI setup notices with a one-click persona build.
    - Root `changelog.md`: add to the topmost WIP entry if there is one. Otherwise, open one with the version rule 9 derives from the last release tag. Content: the mapping is no longer tracked, plus an upgrade note: "after pulling, run `node scripts/cli.js setup` or a persona build to regenerate `personas/name-mapping.json`". Add or extend the module-version blockquote line (rule 3).
    - Run `npm run sync-version` in `mcp-server/` (a no-op when the WIP version is already synced).
    - No `personas/changelog.md` entry: no persona or persona build-system behaviour changes.
12. **Verify** with the checks that `docs/agents/project-manifest/development-commands.md` → *Verification by Change Type* lists for MCP server code, GUI, root script and changelog changes: `cd mcp-server && npm run build`, `npx tsc --noEmit` and `npm test` in `mcp-server/`, `npm test` at the workspace root, and `node scripts/check-version-sync.js`. Then do a manual degraded-mode smoke test:
    - temporarily rename `personas/name-mapping.json`;
   - confirm `node scripts/cli.js setup` reports Personas as needing setup;
    - start `node mcp-server/dist/index.js` and confirm it starts and logs the stderr warning;
    - start the GUI with `node scripts/run-gui.js` and confirm the banner appears and "Build personas" regenerates the file and clears the banner;
    - restore the file if the build did not;
    - GUI audit in a browser, in light and dark themes, with the banner visible:
      - keyboard: Tab reaches the button, a visible focus ring shows, Enter and Space trigger the build;
      - screen reader: the banner is announced politely when it appears, and the building state is announced as text;
      - layout at roughly 360 px, 768 px and desktop widths, and at 200% zoom: no clipping, the button wraps, and the banner does not overlap the sticky header or `.stale-banner` (force the stale banner to confirm);
      - `prefers-reduced-motion: reduce`: no motion beyond the spinner;
      - contrast of text, button and focus ring against the banner background, at least 4.5:1 for text and 3:1 for non-text.

## Dependencies

- Step 2 depends on step 1; step 3 depends on steps 1–2.
- Step 4 depends on step 1 (the GUI server must start without the file to exercise the notice).
- Step 5 depends on step 4; step 6 depends on step 5; step 7 depends on step 6.
- Steps 8 and 9 are independent of steps 1–7.
- Step 10 depends on steps 1–9; step 11 depends on step 10; step 12 depends on all prior steps.

## Required Components

- **New:** `mcp-server/src/utils/name-mapping.ts`
- **New:** `mcp-server/gui/setup-notices.ts`
- **New:** `mcp-server/gui/public/setup-notices.js`
- **New:** `mcp-server/tests/utils/name-mapping.test.ts`
- **New:** `mcp-server/tests/utils/constants-no-io.test.ts`
- **New:** `mcp-server/tests/gui/setup-notices.test.ts`
- **New:** `mcp-server/tests/gui/setup-notices-client.test.ts`
- **Modified source:**
  - `scripts/lib/name-mapping.js`
  - `scripts/build-personas.js`
  - `mcp-server/src/utils/constants.ts`
  - `mcp-server/src/tools/workflow-handoff.ts`
  - `mcp-server/gui/api-models.ts`
  - `mcp-server/gui/server.ts`
  - `mcp-server/gui/public/api-client.js`
  - `mcp-server/gui/public/app.js`
  - `mcp-server/gui/public/index.html`
  - `mcp-server/gui/public/styles.css`
  - `mcp-server/gui/public/views/config-persona-models.js`
  - `scripts/cli.js`
  - `scripts/lib/health-checks.js`
  - `.gitignore`
- **Modified tests:**
  - `mcp-server/tests/integration/auto-handoff.test.ts`
  - `mcp-server/tests/gui/handoff-config-integration.test.ts`
  - `mcp-server/tests/gui/route-table.test.ts`
  - `mcp-server/tests/gui/config-tabs.test.ts`
  - `scripts/tests/health-checks.test.js`
  - `scripts/tests/name-mapping.test.js`
- **Docs and changelogs:** see Documentation Updates.

## Assumptions

- The GUI jsdom test harness (`mcp-server/tests/gui/setup-gui-globals.ts`, used by `mcp-server/tests/gui/stale-check.test.ts`) can load `setup-notices.js` the same way it loads `stale-check.js`.
- Everyone regenerates the mapping locally; no external consumer fetches it from the GitHub repository.

## Constraints

- MCP server: never write to stdout; loader warnings go to stderr only.
- Cross-platform: `path`/`fs` only (the workspace root comes from `WORKSPACE_ROOT`); no hard-coded separators; tests use `os.tmpdir()`.
- GUI: no `innerHTML` with server-provided strings in the new banner; manual `?v=N` bumps for every modified frontend file.
- GUI accessibility: the banner ships with a live region, keyboard reach, a visible focus indicator and readable contrast in both themes; it is non-sticky and adds no motion beyond the existing spinner.
- Agents perform no Git writes: the index removal is a human action.

## Out of Scope

- Splitting the mapping into tracked and per-user files (option B).
- Wiring or removing `scripts/preflight-bootstrap.js`.
- Hash-routable config tabs.
- Additional setup notices beyond `personas-not-built`, and the provider registry they would justify. The array-shaped endpoint and banner already accept more notices; the registry is introduced together with the second notice.
- Bidirectional banner-to-tab synchronisation (shared building flag, rebuilt event). The tab reflects a banner-triggered build after Config is re-entered or its own rebuild runs.
- Any change to the persona build output format, or to the generation logic and output format of `scripts/lib/name-mapping.js` (`generateNameMapping()`, `writeNameMapping()`). Adding the `nameMappingPath()` / `isNameMappingPresent()` helper exports in step 8 is in scope.

## Human Actions

| # | Action | When | Why an agent cannot do it |
|---|--------|------|---------------------------|
| 1 | Run `git rm --cached personas/name-mapping.json` and commit it together with the `.gitignore` change (yourself or through the Git Committer persona) | After the run | Index changes and commits are Git writes, which only the user or the Git Committer performs (`docs/agents/project-manifest/constraints.md` → Git Operations). |
| 2 | Tell other users of the repository (release notes or the root changelog upgrade note) that pulling this change deletes their local `personas/name-mapping.json`, which `node scripts/cli.js setup`, a persona build, or the GUI banner regenerates | After the run | Communicating with other users is outside the agent's reach. |

## Acceptance Criteria

- AC-01: `.gitignore` contains `/personas/name-mapping.json`; `git check-ignore --no-index personas/name-mapping.json` reports it as ignored.
- AC-02: `mcp-server/src/utils/constants.ts` no longer exports `AGENT_NAMES` and no longer imports `createRequire` or reads `personas/name-mapping.json`.
- AC-03: `getAgentNames()` returns ledger entries keyed by role when the file exists; returns `{}` without throwing when it is missing, malformed, or not an array; and writes one stderr warning per failure kind, with nothing on stdout.
- AC-04: `getAgentNames()` reflects a rewritten file (changed `mtimeMs`) without a process restart, and does not re-read when the mtime is unchanged.
- AC-05: With the mapping missing, the auto-handoff payload is still produced and omits `cc_agent_name`, `vs_agent_name` and `da_agent_name`; with it present, the three fields match the file.
- AC-06: The MCP server (`dist/index.js`) and the GUI server both start successfully when `personas/name-mapping.json` is absent.
- AC-07: `GET /api/setup-notices` returns `{ notices: [ { id: 'personas-not-built', … action: { kind: 'rebuild-personas' } } ] }` when the mapping is missing and `{ notices: [] }` when present. Inside `mcp-server`, the name-mapping path is derived only by `resolveNameMappingPath()` (anchored on `WORKSPACE_ROOT`), which `mcp-server/gui/api-models.ts` and `mcp-server/gui/setup-notices.ts` both use.
- AC-08: The GUI shows a global setup banner with a "Build personas" button when notices exist and shows nothing otherwise. A successful build removes the banner. A failed build shows an inline error with the build output and the `node scripts/cli.js setup` hint. A 409 is shown as "already running".
- AC-09: The banner polls only while notices are visible, and disappears without a page reload after the file is created externally. Polling restarts when a later `refresh()` finds a notice again, is skipped while the page is hidden, and resumes with an immediate refresh when it becomes visible. A 409 keeps polling until the other build finishes.
- AC-10: A successful rebuild from the Persona Models tab calls `SetupNotices.refresh()` (guarded by `window.SetupNotices`), including when the tab's visit token has gone stale, so the banner clears without waiting for the next poll. `SetupNotices` exposes only `init()` and `refresh()`, dispatches no window event, and does not touch the Persona Models view.
- AC-14: The setup banner meets the accessibility floor: a `role="status"` / `aria-live="polite"` container, a real `<button>` with a visible `:focus-visible` indicator (at least 3:1 contrast), a text-based building state with an `aria-hidden` spinner, a `<details>` with a visible `<summary>` for build output, and no `innerHTML` for server strings (the setup command is rendered with a `<code>` element). It uses the existing banner colour tokens in both themes, is non-sticky and never overlaps `.stale-banner` or the header, wraps without clipping at narrow widths and 200% zoom, and adds no motion beyond the spinner. The build button label reads "Build personas" on both the banner and the Persona Models pre-build state.
- AC-11: `scripts/lib/name-mapping.js` exports `nameMappingPath()` and `isNameMappingPresent()`; `scripts/lib/health-checks.js` exposes an instant-tier `name-mapping-present` check built on it, with fix `node scripts/build-personas.js`; `SETUP_COMPONENTS.personas.detect()` and `validate()` return `false` when the mapping is missing.
- AC-12: All documents listed in Documentation Updates no longer state or imply that `personas/name-mapping.json` is tracked in Git, and describe the loader, the endpoint and the recovery paths.
- AC-13: `mcp-server` `npm test`, root `npm test`, `npm run build` in `mcp-server/` and `node scripts/check-version-sync.js` all pass.

## Testing Strategy

- **Unit tests** cover the loader's state machine (present, missing, malformed, non-array, mtime reload, cache hit, warning dedup) against temp files.
- **Integration tests** cover the handoff payload in both present and missing states.
- **GUI server tests** cover `detectSetupNotices()`, the shared path derivation and the route table.
- **jsdom client tests** cover the banner's rendering, action handling, polling lifecycle and event wiring, mocking `API`.
- **Root script tests** cover the shared presence helper and the health check. `SETUP_COMPONENTS` in `scripts/cli.js` is not importable in tests, so its detection is covered through the helper and the step 12 manual check.
- **Manual smoke test** (step 12): the real degraded start of both servers and the one-click recovery.

## Test Plan

- `mcp-server/tests/utils/name-mapping.test.ts` — "returns ledger entries keyed by role" (filters out `standalone`/`ledger-support`, accepts entries without `suite`) — AC-03
- `mcp-server/tests/utils/name-mapping.test.ts` — "returns {} and warns once on stderr when the file is missing; nothing written to stdout" (spy on `process.stderr.write` / `process.stdout.write`, call twice, assert one warning) — AC-03
- `mcp-server/tests/utils/name-mapping.test.ts` — "returns {} and warns on malformed JSON" and "returns {} and warns on non-array JSON" — AC-03
- `mcp-server/tests/utils/name-mapping.test.ts` — "reloads after the file is rewritten with a new mtime" (use `fs.utimesSync` to force a distinct mtime) and "does not re-read when the mtime is unchanged" (spy on `fs.readFileSync`) — AC-04
- `mcp-server/tests/utils/name-mapping.test.ts` — "recovers after a missing file appears" (missing → write → entries returned) — AC-04, AC-06
- `mcp-server/tests/utils/name-mapping.test.ts` — "resolveNameMappingPath points at personas/name-mapping.json under WORKSPACE_ROOT" (compare via `path.resolve`) and "resolveNameMappingPath follows a mocked WORKSPACE_ROOT" (`vi.mock` of `../../src/utils/ledger-root.js` with a getter, as in `api-models.test.ts`) — AC-06, AC-07
- `mcp-server/tests/utils/name-mapping.test.ts` — "isNameMappingPresent reflects file existence" — AC-07
- `mcp-server/tests/utils/constants-no-io.test.ts` (new) — "constants module exports no AGENT_NAMES" and "imports without personas/name-mapping.json" (`vi.resetModules()` + dynamic import with the file path mocked absent) — AC-02, AC-06
- `mcp-server/tests/integration/auto-handoff.test.ts` — existing assertions migrated to `getAgentNames()` stay green — AC-05
- `mcp-server/tests/gui/handoff-config-integration.test.ts` — existing `cc_agent_name` / `vs_agent_name` / `da_agent_name` assertions (L134–136) migrated to `getAgentNames()['QA']` stay green — AC-02, AC-05
- `mcp-server/tests/integration/auto-handoff.test.ts` — new "omits target-specific agent names when the name mapping is unavailable" (loader mocked to `{}`; payload has `agent_name` and `prompt`, lacks the three fields) — AC-05
- `mcp-server/tests/gui/setup-notices.test.ts` — "reports personas-not-built when the mapping is missing" and "reports nothing when present" (temp `WORKSPACE_ROOT` via the `ledger-root.js` mock) — AC-07
- `mcp-server/tests/gui/api-models.test.ts` — existing suite stays green unchanged after `nameMappingPath()` delegates to `resolveNameMappingPath()`, proving the shared derivation honours the mocked root — AC-07
- `mcp-server/tests/gui/route-table.test.ts` — includes `GET /api/setup-notices` — AC-07
- `mcp-server/tests/gui/setup-notices-client.test.ts` — "renders a banner per notice before body > header", "renders nothing for an empty list", "uses textContent for server strings" — AC-08
- `mcp-server/tests/gui/setup-notices-client.test.ts` — "Build personas success refreshes and removes the banner", "BUILD_FAILED shows inline error with output and setup hint", "CONFLICT shows already-running state" — AC-08
- `mcp-server/tests/gui/setup-notices-client.test.ts` — "polls while notices are visible and stops when empty; banner disappears after a poll returns no notices" (fake timers) — AC-09
- `mcp-server/tests/gui/setup-notices-client.test.ts` — "restarts polling when a later refresh finds a notice", "skips polling while document.hidden and refreshes on visibilitychange", "CONFLICT keeps polling and clears when notices are empty" — AC-09
- `mcp-server/tests/gui/setup-notices-client.test.ts` — "container has role=status and aria-live=polite", "building state disables the button and shows text with an aria-hidden spinner", "failure renders details with summary and the setup command in a code element" — AC-08, AC-14
- `mcp-server/tests/gui/setup-notices-client.test.ts` — "exposes only init and refresh" and "a successful build dispatches no window event" (spy on `window.dispatchEvent`) — AC-10
- `mcp-server/tests/gui/config-tabs.test.ts` (the existing suite that exercises the Persona Models rebuild) — "Persona Models rebuild success calls SetupNotices.refresh", "Persona Models rebuild calls SetupNotices.refresh even when the visit is stale (tab left during the build)" and "Persona Models rebuild does not throw when window.SetupNotices is undefined" — AC-10
- `scripts/tests/health-checks.test.js` — "name-mapping-present is instant tier and detects presence/absence" (temp workspace or `fs.existsSync` spy) — AC-11
- `scripts/tests/name-mapping.test.js` — "nameMappingPath joins personasDir and name-mapping.json" and "isNameMappingPresent reflects existence in a temp personas dir" — AC-11
- Step 12 manual check: `node scripts/cli.js setup` with the file removed lists Personas as needing setup and regenerates the file — AC-11
- Step 12 commands (`npm test` ×2, `npm run build`, `check-version-sync`) plus a manual smoke test recorded in the QA summary — AC-01, AC-06, AC-12, AC-13

## Documentation Updates

Root `AGENTS.md` no longer carries the cross-system or tooling inventories, and root `CLAUDE.md` is now only `@AGENTS.md`, so neither file changes. The workspace-wide facts live in the hub documents under `docs/agents/project-manifest/`. The root `AGENTS.md` Manifest Maintenance Rules require each of the hub updates below.

- `docs/agents/project-manifest/generated-artefacts.md` (the single generated-artefacts document for the workspace):
  - Remove the `personas/name-mapping.json` row from *Tracked Generated Artefacts → Runtime-coupled* (L27). Add a row to *Ignored Generated Artefacts* (Source: Personas; regenerate with `node scripts/build-personas.js`, `node scripts/cli.js setup` or the GUI's "Build personas" banner).
  - Remove the *Known Contradictions* entry (L108) that names this plan as pending.
  - Reword the `npm test` in `mcp-server/` command row (L98) and the `build-maintain` row (L97), which call the file "tracked".
- `docs/agents/project-manifest/cross-system-dependencies.md`:
  - "Agent name mapping" row (L14): gitignored, generated per user (contains model assignments). The MCP consumer is now `mcp-server/src/utils/name-mapping.ts` → `getAgentNames()` (lazy, mtime-reloaded, tolerant of absence) instead of `constants.ts` → `AGENT_NAMES`.
  - Model Registry row (L31): `name-mapping.json` carries the resolved models and is gitignored.
- `docs/agents/project-manifest/live-workspace.md` (L14 *Startup reads*, L25): the server no longer loads the file at start-up. It reads it lazily on the first auto-handoff, reloads it when its mtime changes (no restart needed after a rebuild) and degrades when it is absent. Remove the link to the Known Contradictions entry. This update is required because the change alters what the running Ledger server reads (root `AGENTS.md` Failure Protocol).
- `docs/agents/project-manifest/root-tooling.md`: the `scripts/lib/name-mapping.js` row (L53) gains the `nameMappingPath()` / `isNameMappingPresent()` exports. The `scripts/lib/health-checks.js` row mentions `name-mapping-present`, and the `scripts/cli.js` `setup` description notes that Personas setup now also requires the mapping.
- `docs/agents/project-manifest/development-commands.md` (L47, L112): stop calling `personas/name-mapping.json` a tracked file the build rewrites.
- `docs/agents/project-manifest/constraints.md` (L16, Critical Rules): keep the sync-point rule, but drop any implication that the mapping is versioned.
- `personas/docs/agents/project-manifest/constraints.md` → *Generated Artefacts* (L347–354): remove `personas/name-mapping.json` from the tracked list and from the "keep a runtime-coupled artefact" and "machine-local drift" bullets.
- `personas/docs/persona-build-system.md` (L65, L104, L837, L958): mark the file as generated and gitignored, and replace "consumed by the MCP server at startup" with the lazy, tolerant loader.
- `personas/docs/agents/project-manifest/constraints-cross-system.md` (L18), `data-flows.md`, `api-surface.md`, `file-tree.md`: gitignored status; the MCP consumer is now `getAgentNames()`.
- `mcp-server/docs/agents/project-manifest/tech-stack.md` (L250, `pretest` row) and `constraints.md` → *Generated Artefacts* (L671): the `pretest` build regenerates the ignored mapping and no longer rewrites a tracked file.
- `mcp-server/docs/agents/project-manifest/api-surface.md`: new `name-mapping.ts` exports; remove `AGENT_NAMES`; move the `NameMappingEntry`/`TargetNames` location.
- `mcp-server/docs/agents/project-manifest/file-tree.md`: add `src/utils/name-mapping.ts`.
- `mcp-server/docs/agents/project-manifest/data-flows.md`: name-mapping load flow (lazy, mtime cache, degraded mode).
- `mcp-server/docs/agents/project-manifest/constraints.md`: a constraint that `constants.ts` performs no I/O on generated artefacts, and that the name mapping is optional at runtime.
- `mcp-server/docs/agents/workflow-specification/auxiliary-systems.md`: the auto-handoff target-specific names are omitted when the mapping is unavailable. This is a documentation-only clarification of existing payload optionality, not a workflow-logic change.
- `mcp-server/gui/docs/agents/project-manifest/api-surface.md`: add `GET /api/setup-notices`, the `SetupNotice` shape and `detectSetupNotices()` (with the note that a provider registry is the intended refactor at the second notice), the `setup-notices.js` client module (`init()`, `refresh()`) and the one-way Persona Models → `SetupNotices.refresh()` call; note that `api-models.ts` resolves the mapping path through `resolveNameMappingPath()`.
- `mcp-server/gui/docs/agents/project-manifest/constraints.md`: record the setup-banner conventions — non-sticky container, live region, reuse of the `--color-banner-stale-*` tokens — so later notices follow them.
- `mcp-server/gui/docs/agents/project-manifest/file-tree.md`, `data-flows.md` and `ui-components.md`: add `gui/setup-notices.ts` and `gui/public/setup-notices.js`. Describe the setup banner as a global UI component, and the Persona Models → `SetupNotices.refresh()` call that runs before the visit-token check.
- Curation logs (`docs/agents/project-manifest/curation-log.md` L119, the personas `curation-log.md`): not edited by this plan. They belong to the Manifest Curator, whose open item on the name-mapping row is resolved by the `generated-artefacts.md` update above.
- `mcp-server/changelog.md`, root `changelog.md`: entries per step 11.
- `.context/`: regenerate with `node scripts/cli.js ctx-generate`.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Pulling the untracking commit deletes every existing user's local `name-mapping.json`** | The server and GUI keep running (AC-06); the GUI banner offers one-click recovery; the `name-mapping-present` health check and `setup` detect it; the root changelog carries an upgrade note (Human Action 2). |
| **Silent degradation of handoff names goes unnoticed in IDE-only use (no GUI open)** | One stderr warning per process at the first handoff (visible in MCP server logs), plus the CLI health-check status line. |
| **Name-mapping path resolves differently between `src/` (tsx) and `dist/`, or ignores a test's temp root** | The loader reuses `WORKSPACE_ROOT` from `ledger-root.ts`, which already handles both depths and is used by the GUI today; reading it per call keeps the `ledger-root.js` test mock effective. Covered by the `resolveNameMappingPath` tests, the unchanged `api-models.test.ts` suite and the step 12 smoke test against `dist/`. |
| **GUI rebuild fails on a fresh clone without `personas/node_modules`** | The failure shows the build output and the `node scripts/cli.js setup` hint (AC-08); `setup` installs the dependencies and builds. |
| **Concurrent rebuild from banner and tab** | The existing 409 `CONFLICT` guard in `handleRebuildPersonas`; the banner shows "already running" and keeps polling (AC-08, AC-09), and the tab's existing `pmDoRebuild()` error path shows the conflict message. No client-side shared flag is needed. |
| **Banner overlaps the sticky header or `.stale-banner`** | `#setup-notices` is non-sticky and in normal flow; verified in the step 12 audit with the stale banner forced (AC-14). |
| **Persona Models tab still shows its pre-build state after a banner-triggered build** | Accepted. The tab is never re-rendered from outside, so unsaved edits are never discarded. `renderConfig()` re-fetches personas on every Config route entry, and the tab's own "Build personas" button rebuilds and re-fetches. |
| **Banner invisible to assistive technology** | Live region, text-based building state and a keyboard-operable button with a visible focus indicator (AC-14). |
| **mtime granularity misses a rewrite within the same timestamp tick** | A rebuild writes the whole file seconds after any prior write; tests force distinct mtimes with `fs.utimesSync`. Worst case is one stale handoff name until the next write. |
| **Tests that import `AGENT_NAMES` break at compile time** | Step 3 migrates both test importers (`auto-handoff.test.ts` and `handoff-config-integration.test.ts`); the only source importer, `workflow-handoff.ts`, moves in step 2. A repo-wide grep for `AGENT_NAMES` under `mcp-server/` must return no `constants.js` import; `npm run build` and `npm test` gate in step 12. |

## Recommended Workflow
- **Workflow:** ledger
- **Rationale:** The change spans the MCP server runtime, the GUI server and client, root CLI tooling and many manifests. It introduces a new runtime degradation mode and a new GUI notice mechanism whose start-up and recovery behaviour benefits from independent QA and review.
