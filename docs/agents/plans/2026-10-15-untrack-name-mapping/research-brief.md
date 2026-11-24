# Research Brief

## Scope Sketch

- Git tracking — `.gitignore`, `personas/name-mapping.json` — modification (untrack + ignore)
- MCP server name-mapping loading — `mcp-server/src/utils/constants.ts`, `mcp-server/src/tools/workflow-handoff.ts` — modification (tolerant loading)
- GUI server — `mcp-server/gui/server.ts`, `mcp-server/gui/api-models.ts` — modification + new code (setup notices endpoint)
- GUI frontend — `mcp-server/gui/public/` (`stale-check.js`, `app.js`, `index.html`, `api-client.js`, `views/config-persona-models.js`, `styles.css`) — modification + new code (setup notices banner)
- Root CLI tooling — `scripts/cli.js` (`SETUP_COMPONENTS`), `scripts/lib/health-checks.js` — modification
- Generator — `scripts/lib/name-mapping.js`, `scripts/build-personas.js` — unchanged, verified as dependency-free
- Documentation — root `AGENTS.md`/`CLAUDE.md`, `docs/agents/project-manifest/README.md`, personas + mcp-server + GUI manifests, `personas/docs/persona-build-system.md`, changelogs, `.context/` — modification

## Area: Git tracking

### Verified References
- `.gitignore`: already ignores `/personas/model-registry/local.json` and `/personas/model-registry/assignments.json` (the per-user sources of the model fields) and all generated persona output (`/personas/*/claude-code/*.md`, etc.). `personas/name-mapping.json` is **not** ignored and is tracked.
- `git diff personas/name-mapping.json` on this machine: 68 changed lines, all in `model`, `model_slug`, `cc_model` — per-user model assignment drift.

### Established Patterns
- Generated persona build output is gitignored — `.gitignore` lines `/personas/ledger/claude-code/*.md` etc.
- Per-user model registry files are gitignored and auto-created — `.gitignore`, `personas/model-registry/`.

### Structural Observations
- Removing a tracked file from the index in a commit causes Git to **delete the working-tree copy for every other user on pull**. Existing users will lose their local `name-mapping.json` the moment they pull this change.
- Tracking a generated file whose shared fields come from YAML and whose per-user fields come from gitignored files means it is dirty on every machine with custom assignments.
- Tracking also creates a mismatch today: a `git pull` updates the tracked mapping (new persona versions) while the deployed persona files (gitignored) stay old until the user re-syncs. Once untracked, the mapping and the deployed files are produced by the same local build and stay consistent.

### Constraints
- `.githooks/pre-commit` runs `node scripts/build-personas.js --check` (line 14) — unaffected by untracking.

## Area: MCP server name-mapping loading

### Verified References
- `mcp-server/src/utils/constants.ts` L10–13: `import { createRequire } from 'module'; … const _require = createRequire(import.meta.url);` — `_require` has exactly one use (L205).
- `mcp-server/src/utils/constants.ts` L127–193: `TargetNames` and `NameMappingEntry` interfaces (fields `number`, `id`, `role`, `version`, optional `suite`/`model`/`model_slug`/`cc_model`, `vscode`/`claude_code`/`deep_agents: TargetNames`).
- `mcp-server/src/utils/constants.ts` L204–208: `export const AGENT_NAMES: Record<AgentRole, NameMappingEntry> = Object.fromEntries((_require('../../../personas/name-mapping.json') as NameMappingEntry[]).filter(entry => !entry.suite || entry.suite === 'ledger').map(entry => [entry.role, entry]))` — **evaluated at module load; throws `MODULE_NOT_FOUND` when the file is missing**.
- `mcp-server/src/tools/workflow-handoff.ts` L7 imports `AGENT_NAMES`; L227: `const agentNames = nextAgent ? AGENT_NAMES[nextAgent as AgentRole] : null;` followed by a conditional spread `...(agentNames ? { cc_agent_name, vs_agent_name, da_agent_name } : {})` — the payload already tolerates a missing entry.
- `mcp-server/tests/integration/auto-handoff.test.ts` L8 imports `AGENT_NAMES` and uses it at L734–837.
- `mcp-server/tests/gui/handoff-config-integration.test.ts` L29 imports `AGENT_NAMES` from `../../src/utils/constants.js`; L134–136 assert `cc_agent_name`, `vs_agent_name` and `da_agent_name` of the auto-handoff payload against `AGENT_NAMES['QA']`. It does not mock `ledger-root.js` (verified during audit integration). Together with `auto-handoff.test.ts` and `mcp-server/src/tools/workflow-handoff.ts`, these are the only importers of `AGENT_NAMES`.
- `mcp-server/gui/public/views/config-persona-models.js` has three "Rebuild Personas" labels: L140 (`#pm-prebuild-rebuild-btn`, the pre-build state), L154 (stale-banner button) and L325 (action-bar button).
- `scripts/lib/name-mapping.js` (ESM) currently exports `resolveVersionFromChangelog`, `validateChangelogField`, `deriveRole`, `generateNameMapping` and `writeNameMapping`.
- `mcp-server/src/utils/agent-registry.ts` L187–200: `getAgentHandle(role)` / `getAgentId(role)` come from a registry built by scanning the **deployed** agent files — the handoff's primary `agent_name` does not depend on the name mapping.
- `mcp-server/src/gui/model-registry.ts` L6–14, L103, L515–540: seed pattern — gitignored `local.json` is auto-initialized from tracked `default.json` on first access (and `assignments.json` is auto-created). Not applicable to the name mapping, which is derived from YAML rather than seeded.
- `mcp-server/tests/utils/`: home of unit tests for `src/utils/` (e.g. `agent-registry.test.ts`, `workflow-manifest.test.ts`); there is no `tests/unit/` directory and no existing constants test.
- `mcp-server/src/utils/ledger-root.ts` L6–16: derives `serverDir` from `import.meta.url` (`src/utils/` or `dist/utils/` up two levels) and exports `WORKSPACE_ROOT` (one more level up). Already the single workspace-root anchor used by the GUI (`mcp-server/gui/api-models.ts` L49 imports it). [added during design-review integration]
- `mcp-server/tests/gui/api-models.test.ts` L30–45: GUI tests redirect paths by `vi.mock('../../src/utils/ledger-root.js', () => ({ get WORKSPACE_ROOT() { return tempWorkspaceRoot; }, … }))` — a getter, so any module that reads `WORKSPACE_ROOT` at call time (not at module load) follows the temp root. `mcp-server/tests/gui/model-registry.test.ts` L48–56 uses the same mock. [added during design-review integration]
- `mcp-server/package.json` L14: `"pretest": "node ../scripts/build-personas.js && node ../scripts/build-personas.js --check"` — tests always have a fresh mapping.

### Established Patterns
- MCP server never logs to stdout; all logs go to stderr — `mcp-server/docs/agents/project-manifest/constraints.md` L282–284.
- Module-load-time derivation of constants from the workflow manifest — `mcp-server/src/utils/constants.ts` header comment.

### Structural Observations
- `constants.ts` mixes pure constants with file I/O against a generated, now-optional artefact. Because the GUI server imports `constants.ts` (see GUI area), a missing mapping crashes the GUI server too, not just the MCP server.
- `AGENT_NAMES` is loaded once per process: after a persona rebuild the server keeps handing off with the old versioned VS Code agent names (e.g. `"3 - Developer v3.18.1"`) until restart.

### Constraints
- `stdout` is reserved for MCP protocol traffic.

## Area: GUI server

### Verified References
- `mcp-server/gui/server.ts` L24: `import { SAFE_SLUG_REGEX } from '../src/utils/constants.js';` and `mcp-server/gui/api.ts` L27 imports constants — **the GUI server crashes at start-up when the mapping is missing**.
- `mcp-server/gui/server.ts` L480–503 `buildConfigRoutes(configPath, bootVersions)`: `PUT /api/config`, `GET /api/server-info` (returns `{ stale, bootVersions, diskVersions }`), `GET /api/config`.
- `mcp-server/gui/server.ts` L660–700 `buildModelRoutes()`: includes `POST /api/personas/rebuild` → `handleRebuildPersonas(WORKSPACE_ROOT)`, throws `ApiError('BUILD_FAILED', output)` on failure.
- `mcp-server/gui/api-models.ts` L87–92: `nameMappingPath()` → `join(WORKSPACE_ROOT, 'personas', 'name-mapping.json')` (module-private).
- `mcp-server/gui/api-models.ts` L242–267 `computeStale()`: returns `false` when the mapping is missing.
- `mcp-server/gui/api-models.ts` L318–372 `handleUpdateAssignments()`: 400 `"name-mapping.json does not exist. Run a persona build first before updating assignments."`.
- `mcp-server/gui/api-models.ts` L530–553 `handleGetPersonas()`: returns `[]` when missing.
- `mcp-server/gui/api-models.ts` L570–630 `handleRebuildPersonas()`: spawns `node scripts/build-personas.js`, module-level `buildInProgress` guard → 409 `CONFLICT`.
- Tests: `mcp-server/tests/gui/server-info.test.ts`, `mcp-server/tests/gui/api-models.test.ts`, `mcp-server/tests/gui/route-table.test.ts`, `mcp-server/tests/gui/stale-check.test.ts`, helper `mcp-server/tests/gui/setup-gui-globals.ts`.

### Established Patterns
- Domain-split API handler modules (`api-models.ts`, `api-repos.ts`, …) composed into route tables by `build*Routes()` in `server.ts`.
- Route table is asserted by `mcp-server/tests/gui/route-table.test.ts`.

### Structural Observations
- `nameMappingPath()` is private to `api-models.ts`; any second consumer would duplicate it.
- There is no generic way for the GUI to tell the user that a generated artefact is missing. The only global banner is `stale-check.js`, which is specific to version mismatch and stops polling once shown.

### Constraints
- GUI owns its own manifest (`mcp-server/gui/docs/agents/project-manifest/`).
- [added by: Plan Architect Reviewer, unverified] `mcp-server/gui/api-models.ts` ~L95: an existing file-mtime helper (returns mtime or `null` when missing) sits next to `nameMappingPath()`; `computeStale()` already relies on name-mapping mtime.
- [added by: Plan Architect Reviewer, unverified] `mcp-server/gui/public/stale-check.js` L6–7: `POLL_INTERVAL_MS = 30 * 1000`, `_intervalId`/`_bannerInserted` module state in an IIFE `StaleCheck`.

## Area: GUI frontend

### Verified References
- `mcp-server/gui/public/views/config-persona-models.js` L134–145: an existing **pre-build state** ("No persona data available. Run the persona build…") with a `Rebuild Personas` button (`#pm-prebuild-rebuild-btn`) when `/api/personas` returns `[]`. L585–610: shared rebuild trigger calling `API.rebuildPersonas()` and refreshing personas + assignments.
- `mcp-server/gui/public/stale-check.js`: IIFE `StaleCheck` exposing `init()`; polls `API.getServerInfo()` every 30 s; inserts a `.stale-banner` before `body > header`; stops polling once the banner is shown.
- `mcp-server/gui/public/app.js` L7: `StaleCheck.init();`.
- `mcp-server/gui/public/index.html` L29–53: scripts loaded with manual `?v=N` cache-busting; `stale-check.js?v=2` then `app.js?v=2`.
- `mcp-server/gui/public/api-client.js`: `getServerInfo()` → `GET /server-info`; `rebuildPersonas`, `getPersonas` exist.
- `mcp-server/gui/public/styles.css` L1028: `.stale-banner`; L3607: `.pm-stale-banner`.
- `mcp-server/gui/public/views/config.js` L32–42 `renderConfig(app)`: fetches config, models, **personas**, assignments and stores on every entry into the Config route; L78–108: switching tabs re-renders from the data captured at page load and does **not** re-fetch. A Persona Models tab left open during a build started elsewhere is therefore refreshed by re-entering the Config route, not by a tab switch. [added during design-review integration]
- `mcp-server/gui/public/views/config-persona-models.js` L585–626 `pmDoRebuild()`: guarded by `pmIsBuilding`; on success re-fetches personas and assignments and re-renders; on failure (including a 409 `CONFLICT` from a concurrent build) renders the error message in `#pm-build-error` as a `.pm-build-error-pre`. [added during design-review integration]
- `mcp-server/gui/public/views/config.js` L63–67: config tabs (`general`, `stores`, `personaModels`, `modelRegistry`) selected by the `configActiveTab` global; tabs are not hash-routable.

### Established Patterns
- Global IIFE modules on `window` (`StaleCheck`, `API`, `UI`) — `stale-check.js`, `api-client.js`.
- Manual `?v=N` bump on every modified frontend file — `mcp-server/gui/docs/agents/project-manifest/constraints.md` L61, L264–270.

### Structural Observations
- The Persona Models pre-build state already lets a user build personas, but only someone who opens Config → Persona Models finds it. Nothing on the projects screen indicates that handoff agent names are degraded.

### Constraints
- No build step for the frontend; plain ES5-style scripts.

## Area: Root CLI tooling

### Verified References
- `scripts/cli.js` L182–231 `SETUP_COMPONENTS`: `mcp-server` (npm install + build) and `personas` (npm install + `sync-personas.js`). The `personas.detect()` checks only that `node_modules` is in sync with the lock file — it reports "set up" even when `name-mapping.json` is missing.
- `scripts/cli.js` has no `export` statements; `SETUP_COMPONENTS` is only passed into the menu (L1273), so it cannot be imported by tests.
- `scripts/lib/health-checks.js` L30: `const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');`.
- `scripts/cli.js` L460 `cmdBuildPersonas(args)` runs `scripts/build-personas.js`.
- `scripts/lib/health-checks.js`: `HEALTH_CHECKS` registry with `{ id, label, cost: 'instant'|'fast'|'slow', detect(), fix }`; e.g. `mcp-dist` (instant, `fs.existsSync`), `personas-fresh` (slow, `build-personas.js --check`). Test: `scripts/tests/health-checks.test.js`.
- `scripts/preflight-bootstrap.js`: not called by any script, npm script or `bin` entry (root `package.json` `bin` → `scripts/cli.js`). Not a viable hook.

### Established Patterns
- Data-driven health-check registry — `scripts/lib/health-checks.js`.
- Setup components with `detect()` / `run()` / `validate()` — `scripts/cli.js`.

### Structural Observations
- `SETUP_COMPONENTS.personas.detect()` does not consider build output, so `setup` will not repair a missing mapping.

## Area: Generator

### Verified References
- `scripts/lib/name-mapping.js`: imports only `fs`, `path`, `./persona-model-resolution.js`, `./yaml-utils.js`; exports `generateNameMapping({ personasDir, warn, info })`, `writeNameMapping(outPath, entries)`.
- `scripts/lib/persona-model-resolution.js`: imports only `fs`, `path`. `scripts/lib/yaml-utils.js`: no imports.
- `scripts/build-personas.js` L103–111: real builds write `personas/name-mapping.json`.
- Unit tests: `scripts/tests/name-mapping.test.js` (temp dirs), `scripts/tests/build-personas-model-resolution.test.js`.

### Constraints
- None changing; the generator is dependency-free, so it does not need `personas/node_modules`.

- [added by: Plan Auditor, unverified] `mcp-server/tests/gui/handoff-config-integration.test.ts` L29 imports `AGENT_NAMES` from `constants.js` and asserts at L134-136; the file has no `vi.mock`. Only `workflow-handoff.ts` (L227) plus the two tests reference `AGENT_NAMES` under `mcp-server/` outside docs.
- [added by: Plan Auditor, unverified] `mcp-server/src/utils/ledger-root.ts` L16 `export const WORKSPACE_ROOT`; `scripts/build-personas.js` L105 inline `path.join(ROOT, 'personas', 'name-mapping.json')`; `scripts/lib/health-checks.js` L30 `WORKSPACE_ROOT`; `scripts/cli.js` L66 `PERSONAS_DIR`.

## Area: Documentation

### Verified References
Files mentioning `name-mapping`: root `AGENTS.md` (L257 Cross-System Dependencies "Agent name mapping" row: "checked into Git — staleness is visible in diffs"; L274 Model Registry row), root `CLAUDE.md` (a separate, differing copy of AGENTS.md content), `docs/agents/project-manifest/README.md` L103, `personas/docs/persona-build-system.md` L65/L104, `personas/docs/agents/project-manifest/constraints-cross-system.md` L18, `personas/docs/agents/project-manifest/data-flows.md`, `personas/docs/agents/project-manifest/api-surface.md`, `personas/docs/agents/project-manifest/file-tree.md`, `mcp-server/docs/agents/project-manifest/{api-surface,data-flows,file-tree}.md`, `mcp-server/docs/agents/workflow-specification/auxiliary-systems.md`, `mcp-server/gui/docs/agents/project-manifest/api-surface.md` L150–202, changelogs, and generated `.context/`.

## Strategic Context

- Short-term vision: "make the whole project as easy as possible to set up and use … as little friction as possible". A fresh clone or a pull that deletes the mapping must not leave the MCP server or GUI unable to start — this plan makes the missing state survivable and self-explaining.
- Long-term vision: reliability across Windows, macOS, Linux — all new code uses `path`/`fs` only.
- `ledger_search_insights` ("name-mapping AGENT_NAMES model-registry assignments rebuild"): no relevant insights for this repository.

## Refresh Verification (2026-11-24)

Re-verified against `main` at `737d83e0`, which is 84 commits after the plan was written. The plan has not been implemented: the file is still tracked (`git ls-files`), it is not in `.gitignore`, and `AGENT_NAMES` is still loaded at module load.

### Unchanged (still valid)
- `mcp-server/src/utils/constants.ts` L10/L13 (`createRequire`, `_require`, whose only use is L205), L132/L155 (types) and L204 (`AGENT_NAMES`). `mcp-server/src/tools/workflow-handoff.ts` L7/L227. The only test importers are `auto-handoff.test.ts` L8 and `handoff-config-integration.test.ts` L29 (assertions at L134–136).
- `mcp-server/src/utils/ledger-root.ts` `WORKSPACE_ROOT`. `mcp-server/gui/api-models.ts` L49 import, L90 `nameMappingPath()`, L243 `computeStale()`, L530 `handleGetPersonas()`, L570 `handleRebuildPersonas()` with the `buildInProgress` guard. `api-models.test.ts` L35 still mocks `ledger-root.js`.
- `mcp-server/package.json` L14 `pretest`. `scripts/lib/name-mapping.js` exports are unchanged. `scripts/build-personas.js` L106 inline path. `scripts/lib/health-checks.js` L30 `WORKSPACE_ROOT`. `scripts/cli.js` L67 `PERSONAS_DIR`. `scripts/run-gui.js` exists.
- `stale-check.js`, `app.js` L7 `StaleCheck.init()`, and the `--color-banner-stale-*` tokens (styles.css L107–109, L231–233).

### Moved line numbers
- `mcp-server/gui/server.ts`: constants import at L25, `buildConfigRoutes()` at L506, `buildModelRoutes()` at L700. `mcp-server/gui/api.ts` constants import at L28.
- `config-persona-models.js`: pre-build state at L186–192 (message L188, `#pm-prebuild-rebuild-btn` label L190), stale-banner button L204, action-bar button L375, `pmDoRebuild()` L643.
- `index.html`: `api-client.js?v=7`, `config-persona-models.js?v=2`, `stale-check.js?v=2`, `app.js?v=2`.

### New facts affecting the plan
- **Config tab visit tokens:** `pmDoRebuild()` captures `pmVisit` and returns early when the visit is stale, after clearing `pmIsBuilding` (`mcp-server/gui/docs/agents/project-manifest/constraints.md` L525–542, integration point 5). Existing rebuild tests are in `mcp-server/tests/gui/config-tabs.test.ts`.
- **Hub manifest restructure:** root `AGENTS.md` no longer has the Cross-System Dependencies or Root-Level Tooling tables, and root `CLAUDE.md` is `@AGENTS.md`. The name-mapping facts now live in `docs/agents/project-manifest/{generated-artefacts,cross-system-dependencies,live-workspace,root-tooling,development-commands,constraints}.md`. `docs/agents/project-manifest/README.md` no longer mentions the file.
- **`generated-artefacts.md`:** L27 lists the file as *Tracked → Runtime-coupled* (citing `constants.ts` `AGENT_NAMES`). L97–98 call it tracked. L108 *Known Contradictions* names this plan as pending. An *Ignored Generated Artefacts* section exists at L42.
- **`live-workspace.md`** L14/L25: says the server loads the file at start-up. The root `AGENTS.md` Failure Protocol makes updating this file a MUST when what the server reads changes.
- **Module Generated Artefacts rules:** `personas/docs/agents/project-manifest/constraints.md` L347–354, `mcp-server/docs/agents/project-manifest/constraints.md` L671, `mcp-server/docs/agents/project-manifest/tech-stack.md` L250, and `personas/docs/persona-build-system.md` L837/L958.
- **Changelog Convention rule 9** (one WIP entry, never a second): `mcp-server/changelog.md` already has `## v2.12.0 - **WIP; UNRELEASED**`. The root `changelog.md` top entry is v2.15.0 and is not marked WIP; the last tag is `2.14.1`.
- **Verification by Change Type** (`development-commands.md`): MCP server code also requires `npx tsc --noEmit`.
- Git writes are restricted to the user or the Git Committer persona (`docs/agents/project-manifest/constraints.md` → Git Operations).
- `ledger_search_insights` re-run: still no insight about name mapping or model-assignment loading, so there is nothing to reconcile.
