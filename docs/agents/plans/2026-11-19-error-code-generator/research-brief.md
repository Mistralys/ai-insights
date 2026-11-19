# Research Brief

## Scope Sketch

- MCP server tools — `mcp-server/src/tools/` — new code (error-code tools) + modification (tool registration seam)
- MCP server error-code domain — `mcp-server/src/error-codes/` — new code (service client, local counter, generator)
- Runtime configuration — `mcp-server/src/gui/config.ts`, `mcp-server/src/storage/store-registry.ts` — modification
- GUI dashboard — `mcp-server/gui/api.ts`, `mcp-server/gui/server.ts`, `mcp-server/gui/public/views/config.js`, `mcp-server/gui/public/api-client.js` — modification
- MCP server tests — `mcp-server/tests/` — new + modification
- Personas — `personas/ledger/src/`, `personas/standalone/src/`, `personas/shared/partials/` — modification + new partial
- Documentation / manifests — `mcp-server/docs/agents/project-manifest/`, `mcp-server/gui/docs/agents/project-manifest/`, `personas/docs/agents/project-manifest/`, `docs/agents/project-manifest/cross-system-dependencies.md`, changelogs — modification

## Area: MCP Server Tools

### Verified References
- `mcp-server/src/index.ts` (L8–L18): one `import * as xTools from './tools/x.js'` per tool module; (L73–L83): one `xTools.register(server)` call per module; (L155–L159): hand-maintained `console.error('[project-ledger-mcp] Registered tools: …')` literal listing all 32 tool names, with a NOTE comment that it "must be kept in sync manually".
- `mcp-server/src/tools/ping.ts`: canonical minimal tool module — Zod `inputSchema` (`PingSchema.passthrough()`), handler returning `{ content: [{ type: 'text', text: JSON.stringify(response) }] }`, `export function register(server: McpServer)` calling `server.registerTool(name, { description, inputSchema }, handler as any)`, and `export const _internal = { … }` for tests.
- `mcp-server/src/tools/help-content.ts` (L13): `export const TOOL_HELP: Record<string, string>` keyed by tool name, each entry starting with `# {tool_name}`; plus an overview Markdown table (L30–L51) with one row per tool (`| ledger_ping | None | … |`). 27 per-tool entries currently.
- `mcp-server/tests/startup/tool-log-sync.test.ts`: regex-parses the `Registered tools:` literal in `src/index.ts` and diffs it against `server.registerTool('…'` occurrences scanned from every `src/tools/*.ts` (excluding `help-content.ts`).
- `mcp-server/tests/tools/schema-integrity.test.ts`: imports 10 `register` functions by hand, captures schemas through a mock `registerTool`, and holds a hand-written `EXPECTED_TOOL_NAMES` list (header comment says "all 29"); `ping.ts`, `standalone-import.ts` are not among the imports.
- `mcp-server/tests/tools/knowledge-help.test.ts`: per-tool assertion pattern that `TOOL_HELP[name]` exists, is non-empty and contains `# {name}`.
- `mcp-server/tests/tools/ping.test.ts`: existing tool-level test file pattern.
- [added by: Plan Auditor, unverified] `mcp-server/src/tools/help.ts` (L70–L71): `register(server)` for `ledger_help`; `help-content.ts` has no `register` (data only), so it does not belong in a `TOOL_MODULES` list.
- [added by: Plan Auditor, verified by Planner during audit integration] `mcp-server/src/storage/file-lock.ts` (L31–L50): `withLock` creates `{storageDir}/.lock` (via proper-lockfile `lockfilePath`) and `mkdir -p`s `storageDir`; a lock on a project-local counter-file directory therefore leaves a `.lock` entry in that directory.
- [added by: Plan Auditor, verified by Planner during audit integration] No `redact`/secret-redaction helper exists anywhere under `mcp-server/src` or `mcp-server/gui` (grep, 2026-11-19).

### Established Patterns
- One module per tool family with a `register(server)` export — `mcp-server/src/tools/*.ts`.
- `_internal` export for test-only access — `mcp-server/docs/agents/project-manifest/constraints-code-style.md` ("Test-Only Exports Must Use the `_internal` Naming Convention").
- No `.refine()/.transform()/.superRefine()` on outer tool schemas; numeric inputs via `src/schema/common.ts` helpers — `constraints-code-style.md`.
- Tool names carry the `ledger_` prefix; persona preflight locates tools by the `ledger_` pattern.
- STDIO discipline: stderr only, never stdout — `mcp-server/AGENTS.md` Critical Constraint 4.

### Structural Observations
- `mcp-server/src/index.ts`: tool registration and the startup log are two hand-maintained lists of the same fact; the log literal is explicitly flagged as manual-sync.
- `mcp-server/tests/tools/schema-integrity.test.ts`: a third hand-maintained list (imports + `EXPECTED_TOOL_NAMES`), already stale (header says 29, misses `ping.ts`, `standalone-import.ts`), so newly added tools silently escape the schema regression guard.
- `mcp-server/tests/startup/tool-log-sync.test.ts`: exists only to police the hand-maintained log literal via regex source scanning.
- `mcp-server/src/tools/help-content.ts`: help coverage is only asserted per family (e.g. `knowledge-help.test.ts`); there is no test asserting every registered tool has a `TOOL_HELP` entry.

### Constraints
- `server.registerTool` handlers receive `(args, extra)`; handlers with a second positional parameter must be wrapped (`constraints-code-style.md` → "MCP SDK Injects `RequestHandlerExtra`").
- A new MCP tool requires `api-surface.md`, `file-tree.md`, `data-flows.md` updates (`mcp-server/AGENTS.md` → Manifest Maintenance Rules).

## Area: Runtime Configuration

### Verified References
- `mcp-server/src/gui/config.ts`: `GuiConfigSchema` (flat `z.object` with `auto_handoff_enabled`, `max_handoff_depth`, `auto_archive_days`, `capture_dialogues`, `ledger_root`, all `.default()`ed); `GuiConfigPartialSchema = GuiConfigSchema.omit({ ledger_root: true }).partial()`; `DEFAULT_CONFIG`; `getConfig()` (sync, cached); `readConfigFromDisk(path)` (self-heals missing file); `writeConfig(path, data)` (shallow merge with cache, strips `ledger_root`, validates, `atomicWriteJson`); `startConfigWatcher(path)` (250 ms debounce, re-arms on macOS rename); `__resetForTesting()`.
- `mcp-server/src/storage/store-registry.ts` (L12): `const AI_INSIGHTS_DIR = '.ai-insights'` (module-private); `resolveStoresConfigPath()`; `resolveGuiConfigPath(storeConfig, ledgerRoot)` → `~/.ai-insights/gui-config.json` in multi-store mode, `{ledgerRoot}/gui-config.json` otherwise.
- `mcp-server/src/index.ts` (L149–L152): MCP server reads config via `readConfigFromDisk(configPath)` + `startConfigWatcher(configPath)` — so the MCP process picks up GUI edits live.
- `mcp-server/src/storage/file-lock.ts` (L31): `withLock<T>(storageDir, fn)` — creates `{storageDir}/.lock` via proper-lockfile.
- `mcp-server/src/storage/atomic-writer.ts` (L18): `atomicWriteJson(path, data)`.

### Established Patterns
- Plain-function modules for stateless I/O helpers; classes only for lifecycle-managed state — insight f389f9ce (canonical: `src/storage/repository-registry.ts`).
- All JSON writes via `atomicWriteJson`, read-modify-write under `withLock` — `mcp-server/AGENTS.md` Critical Constraints 1–2.
- User-level config files live under `~/.ai-insights/` — `store-registry.ts` doc comment.

### Structural Observations
- `GuiConfigSchema` is flat and `writeConfig` merges shallowly; nested sections would need a deep merge that does not exist today.
- `GET /api/config` returns the full cached config verbatim — there is no notion of a secret field; any secret added to the schema would be exposed to the browser.
- `AI_INSIGHTS_DIR` is module-private, so any other user-level path must be resolved inside `store-registry.ts` or the constant duplicated.

### Constraints
- `ledger_root` is read-only from the GUI; the partial schema is derived from the full schema with `.omit()` to track additions automatically.
- Node.js runtime with `@types/node ^22` — global `fetch` and `AbortSignal.timeout()` are available; no HTTP client dependency exists or is needed (`mcp-server/package.json`).

## Area: GUI Dashboard

### Verified References
- `mcp-server/gui/api.ts` (L1002–L1034): `handleGetConfig(_configPath)` returns `getConfig()`; `handleUpdateConfig(configPath, body)` validates with `GuiConfigPartialSchema` then `writeConfig`.
- `mcp-server/gui/server.ts` (L477–L502): `buildConfigRoutes(configPath, bootVersions)` route table entries `PUT /api/config`, `GET /api/config`; (L1311–L1316) route assembly.
- `mcp-server/gui/public/views/config.js` (211 lines): `renderConfigPage` with a tab bar (`.config-tab`), `renderConfigTabContent`, `renderGeneralTab(config)` form, `wireGeneralTabEvents()` saving via `API.updateConfig({...})`, `configDirty` tracking, `escapeHtml()` on every rendered value. Sibling tab views: `config-model-registry.js`, `config-persona-models.js`, `config-stores.js`.
- `mcp-server/gui/public/api-client.js`: `API.updateConfig` client wrapper.
- [added by: Plan Auditor, unverified] `mcp-server/gui/public/index.html` (L30, L43–L46): `api-client.js?v=5`, `config-stores.js?v=1` then `config.js?v=3`; config tab scripts load before `config.js`.
- [added by: Plan Auditor, unverified] `mcp-server/gui/server.ts` (L1309–L1325): `buildRoutes()` spread order is config, orchestrator, repo, knowledge, model, store, project.

### Established Patterns
- GUI frontend is ES5, no build step; route-table ordering and security headers governed by `mcp-server/gui/docs/agents/project-manifest/constraints.md`.
- Every rendered string goes through `escapeHtml()` — insight 0cd6accc.
- One file per config tab under `gui/public/views/config-*.js`.

### Structural Observations
- `handleGetConfig` has no response-shaping layer; it returns the storage object as-is.

### Constraints
- GUI changes require the GUI manifest (`mcp-server/gui/docs/agents/project-manifest/`), not the MCP server manifest.

## Area: Personas

### Verified References
- `personas/ledger/src/meta/3-developer.yaml`: VS Code `tools:` includes `central_pm/*`; `cc_tools:` includes `mcp__central_pm` (whole server); `mcp_tools:` list renders the persona's tool table (`ledger_get_next_action` … `ledger_help`); integrated `changelog:`.
- `personas/ledger/src/content/3-developer.md`: includes `{{> mcp-intro}}`, `{{> mcp-insight-capture}}`, constraint bullets `{{> no-stale-counts}}`, `{{> no-release-cycles}}`, `{{> wip-changelog-version}}` (L130–L133).
- `personas/standalone/src/meta/developer.yaml`: `tools:` (vscode, execute, read, edit, search, browser, agent, todo), `cc_tools:` without any MCP grant; `use_when: "… (no MCP server needed)"`; `subagents: [ledger-synthesis-maintainer]`.
- `personas/standalone/src/content/developer.md`: `## Strict Constraints` (L129) with partial bullets at L138–L141; `## Workflow` (L164).
- `personas/standalone/src/meta/web-gui-specialist.yaml`: same tool shape, `tool_parity_exceptions: [web]` with inline rationale comment; no MCP grant.
- `personas/standalone/src/content/web-gui-specialist.md`: partial includes at L68, L124, L141, L250–L265.
- `personas/ledger-support/src/meta/ledger-synthesis-maintainer.yaml`: precedent for per-tool narrow MCP grants — VS Code `central_pm/ledger_import_standalone`, Claude Code `mcp__central_pm__ledger_import_standalone`.
- `personas/shared/partials/`: shared partial directory (e.g. `no-release-cycles.md`, `wip-changelog-version.md`), included with `{{> name}}`; conditionals `{{#if target_claude_code}}` / `{{#if target_vscode}}`.
- `personas/docs/agents/project-manifest/api-surface.md` (L535+): "MCP Tool Allocation Matrix" — normative per-persona `mcp_tools` table for ledger personas.
- `orchestrator/src/nodes/__init__.py` (L771–L925): Deep Agents stage nodes receive the full `mcp_tools` list from the shared MCPToolkit — a new server tool is available to orchestrator Developer runs without persona YAML changes.

### Established Patterns
- `cc_tools` must be explicit whenever `tools:` carries VS Code-only MCP syntax — comments in `3-developer.yaml`, `ledger-synthesis-maintainer.yaml`.
- `validateToolParity()` fails the build when a capability exists on one target only — `personas/docs/agents/project-manifest/constraints.md` (L230).
- Every capability-affecting persona edit records the grant change in that persona's integrated changelog — `personas/docs/agents/project-manifest/constraints.md` (L231).

### Structural Observations
- `personas/standalone/src/meta/developer.yaml` `use_when` claims "no MCP server needed" — becomes inaccurate (MCP becomes optional, for error codes only).

### Constraints
- Persona output is generated; edit sources only (`AGENTS.md` → "Generated file needs change").
- Changing agent tool grants is a cross-system sync point → `docs/agents/project-manifest/cross-system-dependencies.md` Dependency Table.

## Area: Documentation / Manifests

### Verified References
- `mcp-server/docs/agents/project-manifest/`: `api-surface.md`, `file-tree.md`, `data-flows.md`, `tech-stack.md`, `constraints.md`, `constraints-code-style.md`, `constraints-testing.md`.
- `mcp-server/gui/docs/agents/project-manifest/`: `api-surface.md`, `file-tree.md`, `data-flows.md`, `constraints.md`, `ui-components.md`.
- `mcp-server/README.md`: sections Features (L27), Quick Start (L49), Troubleshooting (L83).
- `mcp-server/changelog.md`: current top version v2.11.0; WIP convention per `docs/agents/project-manifest/constraints.md#changelog-convention`.
- `docs/agents/project-manifest/cross-system-dependencies.md`: `## Dependency Table` (L7), `## Validation Scripts` (L41).
- `personas/changelog.md`.

### Constraints
- Manifest updates are part of the same change (`mcp-server/AGENTS.md` → Enforcement).

## Strategic Context

- Short-term vision: minimal-friction setup and daily usage → favours GUI-editable settings with a connection test over hand-edited files.
- Long-term secondary goal: reliability on Windows/Linux/macOS → `os.homedir()`-based paths, no shell-outs; `fs.watch` macOS rename caveat already handled in `config.ts`.
- Insight f389f9ce (plain-function modules for stateless helpers) — applies to the service client and local counter.
- Insight 0cd6accc (`escapeHtml()` on every GUI-rendered field) — applies to the new config tab.
- No existing insight concerns tool registration lists or error codes; none is overtaken by this work.
- Live workspace: STABLE hosts the live Ledger server; the user will move the plan to a DEV workspace for implementation.
- Open-source constraint (user, 2026-11-19): AI Insights is public. The repository must not hard-code the user's private counter service; the backend is a configuration choice with a zero-setup local default. The user's service (`{value}01` response suffix, 403 = throttled, password in query string) must be expressible purely through generic HTTP-backend settings.
- User's error-code scheme: one generated base per class/module; component codes are `{base}01`, `{base}02`, … — so allocation requests are infrequent (no block leasing needed).
- `mcp-server/src/schema/common.ts` (L72–L100): `numericInput()`, `numberInput()`, `positiveIntInput()`, `nonNegativeIntInput()`, `confidenceInput()` — shared coercing numeric helpers.
- No module under `mcp-server/src/` spawns processes except `mcp-server/src/gui/queue/` (orchestrator queue); there is no precedent for config-driven command execution.

## Area: Provider Plugin System (added after design discussion, 2026-11-19)

### Verified References
- `https://github.com/Mistralys/errorcode-incrementor` — public, MIT-licensed PHP script/library by the user. HTTP API: `GET {base}/?pw=…&counter=NAME[&increment=yes]`; status codes 401 (password), 400 (no counter), 404 (unknown counter), 403 (minimum update delay, default 10 s, minimum 1 s, per counter), 500 (load/save failure). Counters are defined server-side in `config-local.php`. The README does not document the response body; the user's reference states the body is `{value}01` (`text/plain`).
- `mcp-server/src/storage/atomic-writer.ts` (L18–L40): `atomicWriteJson(filePath, data)` — `mkdir -p` parent, write `{file}.tmp.{pid}`, `rename`; no file-mode option.
- `mcp-server/src/utils/read-project-name.ts` (L12): `readProjectName(projectRoot)` — package.json → composer.json → pyproject.toml name, or `null`.
- `mcp-server/src/utils/ledger-root.ts` (L113): `deriveRepoName(projectPath, resolvedRoot?)` — derives from a *plan folder* path (walks up 4 levels); not usable for an arbitrary cwd. No helper exists that finds a repository root (`.git`) from an arbitrary directory.

### Structural Observations
- `atomicWriteJson` cannot set a restrictive file mode, which a secrets-bearing file needs on POSIX.
- `GuiConfigSchema` is static; settings of runtime-loaded providers cannot be expressed in it.

### Constraints
- User decisions: (1) the plugin contract must be designed for minimal future API changes; (2) counter/scope semantics belong entirely to the provider — the core passes project/cwd information and expects an integer back; (3) the Errorcode Incrementor provider ships built in (public library), with no default host.

## Area: Design Review Verification (added during design-review integration, 2026-11-19)

### Verified References
- `mcp-server/gui/server.ts` (L1513): `server.listen(port, …)` passes no host, so the GUI binds every interface, not only loopback. The "localhost-only" wording in the GUI manifest describes intended use, not the bind.
- `mcp-server/gui/server.ts` (L139–L146): `corsHeaders(port)` sets `Access-Control-Allow-Origin: http://localhost:{port}`. No route checks the `Host` or `Origin` request header.
- `mcp-server/gui/server.ts` (L317–L323): `interface Route { method; path; handler(body, groups?, query?); statusCode?; noBody? }`. Handlers never receive the `IncomingMessage`, so header checks (`Content-Type`, `Host`, `Origin`) cannot be done inside a handler.
- `mcp-server/gui/server.ts` (L1357–L1401): `dispatchRoute(req, res, method, url, port, routes)` calls `readJsonBody(req)` unless `noBody`, then the handler; `ApiError` is mapped through `apiErrorToStatus`.
- `mcp-server/gui/server.ts` (L191–L204): `apiErrorToStatus(code)` maps `NOT_FOUND` 404, `FORBIDDEN` 403, `VALIDATION_ERROR` 400, `CONFLICT` 409, otherwise 500. There is no 415 mapping.
- `mcp-server/src/gui/errors.ts` (L23): `class ApiError(code, message, details?)`.
- `mcp-server/gui/public/api-client.js` (L13): the client already sets `Content-Type: application/json` on requests with a body.
- `mcp-server/tests/gui/dispatch-route.test.ts`: exercises `dispatchRoute()` and `apiErrorToStatus` against a real `createServer()`.
- `mcp-server/src/storage/file-lock.ts` (L31): `withLock<T>(storageDir, fn: () => Promise<T>): Promise<T>`.
- `mcp-server/src/storage/atomic-writer.ts` (L22–L23): temp file is `${filePath}.tmp.${process.pid}`, so two unlocked writes of one file in one process share a temp path.
- `mcp-server/gui/docs/agents/project-manifest/constraints.md`: sections "7. Security Constraints (Backend)" (Information Hiding, Security Headers), "9. Route Dispatch Ordering and Sub-Builder Composition", "21. Handler Domain Split", "24. Known Limitations".
- `https://git-scm.com/docs/gitrepository-layout` (accessed 2026-11-19): in a linked worktree `.git` is a file `gitdir: <path>` (path may be relative to the worktree); the per-worktree directory holds a `commondir` file whose path (usually relative, e.g. `../..`) points at the shared `.git` directory. A submodule's `.git` file points at `.git/modules/<name>` and has no `commondir`.

### Structural Observations
- `Route` has no request-level hook; every route that needs a header check would have to special-case `dispatchRoute`.
- The GUI bind address (all interfaces) exposes every unauthenticated route to the LAN.

### Constraints
- `UNSUPPORTED_MEDIA_TYPE` has no status mapping today; a 415 response needs a new `apiErrorToStatus` case.

## Area: Audit Integration Verification (added during audit integration, 2026-11-19)

### Verified References
- `mcp-server/package.json` (L30): `jsdom` (`^29.0.0`) is already a dev dependency.
- `mcp-server/tests/gui/orchestrator-view.test.ts` (L1, L22–L38): established pattern for testing an ES5 view file: `// @vitest-environment jsdom`, `readFileSync` of `gui/public/views/*.js`, executed with `vm.runInThisContext`, then DOM assertions. `mcp-server/tests/gui/client-rendering.test.ts` (L1–L19) follows the same pattern.
- `mcp-server/tests/gui/` holds no config-tab view test today (`config.test.ts` and `config-helpers.test.ts` exist).

### Established Patterns
- jsdom + `vm.runInThisContext` for unattended rendering tests of no-build ES5 views — `mcp-server/tests/gui/orchestrator-view.test.ts`.

### Constraints
- jsdom has no layout engine: zoom, viewport width, computed contrast and visible focus rings cannot be asserted in it. Those checks need a person with a browser.

## Area: Plan Auditor Verification (cycle 2, 2026-11-19)
- [added by: Plan Auditor, unverified] `mcp-server/src/storage/file-lock.ts`: `withLock(storageDir, fn)` calls `mkdir(storageDir, { recursive: true })` and locks via `proper-lockfile` with `lockfilePath = {storageDir}/.lock`; stale 10 s, 50 retries.
- [added by: Plan Auditor, unverified] `mcp-server/gui/server.ts`: `Route` interface (L316, fields `method`, `path`, `handler`, `statusCode?`, `noBody?`), `apiErrorToStatus` (L191, cases NOT_FOUND/FORBIDDEN/VALIDATION_ERROR/CONFLICT), `dispatchRoute(req, res, method, url, port, routes)` (L1357), `corsHeaders(port)` allows only `http://localhost:{port}`; default port 3420.
- [added by: Plan Auditor, unverified] `mcp-server/src/gui/errors.ts` L23: `class ApiError`.
- [added by: Plan Auditor, unverified] `mcp-server/tests/tools/schema-integrity.test.ts`: hand-written import list of 10 tool modules plus `EXPECTED_TOOL_NAMES` (29 names).
- [added by: Plan Auditor, unverified] `mcp-server/tests/gui/api-client.test.ts`: existing convention of one `describe('API.<method>')` per `api-client.js` wrapper; `mcp-server/tests/gui/security-headers.test.ts` is the only test touching `index.html`.
- [added by: Plan Auditor, unverified] `mcp-server/gui/docs/agents/project-manifest/constraints.md`: numbered sections 7 (Security, incl. Information Hiding), 9 (Route Dispatch Ordering), 14, 19, 20, 21, 24 (Known Limitations); already lists "No authentication" and "CORS locked to localhost".
