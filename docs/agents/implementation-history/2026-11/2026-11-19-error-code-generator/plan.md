# Plan

## Plan Audit Cycles
- Audits: 2 (Sonnet 5.5 ×2) — Plan Auditor v1.13.1
- Architectural Reviews: 1 (Sonnet 5.5 ×1) — Plan Architect Reviewer v2.5.1

## Prior Project Context
- **Strategic alignment:**
  - The short-term vision is low-friction setup. That is why the default provider works with no configuration at all, and providers are configured in the GUI with a connection test.
  - The long-term goal of cross-platform reliability is why plugin paths are loaded through `pathToFileURL`, files use restrictive modes where the OS supports them, the code makes no shell calls, and the HTTP client is Node's built-in `fetch`.
- **User decisions (2026-11-19):**
  - AI Insights is open source. Where codes come from is the developer's choice (a file, a database, an HTTP service, …).
  - The provider contract is built properly from the start, so that it rarely needs to change.
  - Counter and scope semantics belong entirely to the provider. The core passes project and cwd information and expects an integer back.
  - The user's public library [Errorcode Incrementor](https://github.com/Mistralys/errorcode-incrementor) ships as a built-in provider, with no default host.
- **Insight f389f9ce** (plain-function modules for stateless storage helpers): store, loader and project-info helpers are plain-function modules. Providers are objects because they are selected at runtime through the plugin contract.
- **Insight 0cd6accc** (`escapeHtml()` on every field the GUI renders): applies to the Error Codes tab. That tab renders labels and descriptions supplied by third-party plugins, so it matters doubly.
- No stored insight covers error codes, plugin systems or tool-registration lists.

## Summary
Add an error-code allocator to the Ledger MCP server. Agents get a new error-code base number from one MCP call. Where the number comes from is decided by an **error-code provider**: a small plugin behind a stable, versioned contract (`apiVersion: 1`).

Two providers ship built in, and both use exactly the same public contract that third-party plugins use:
- **`file`**: the zero-setup default. It keeps sequences in a locked JSON file, can scope them globally or per repository, and can place the file inside the repository.
- **`errorcode-incrementor`**: a client for the user's public HTTP counter service.

Developers add their own providers (a database, an in-house service, …) by dropping an ES module, or a folder with its own dependencies, into `~/.ai-insights/plugins/error-codes/`. The GUI shows a settings form generated from each provider's declared fields, and can test the connection. It can choose and configure providers, but never install code.

The core owns all policy: the single retry on throttling, the rule never to retry an ambiguous failure, timeouts, secret redaction, result validation, and the fallback to declared temporary codes `777{NNNNNN}`, logged so they can be replaced later. Agents never see provider details. They call `ledger_generate_error_code` and `ledger_list_temporary_error_codes`, which are granted to the ledger Developer, the standalone Developer and the Web GUI Specialist.

Along the way, the server's three hand-maintained tool lists are replaced by a single tool registry.

## Architectural Context
- **Tool modules:** `mcp-server/src/tools/*.ts`. Each module exports `register(server: McpServer)` and an `_internal` object for tests. `mcp-server/src/tools/ping.ts` is the minimal reference.
- **Registration:** `mcp-server/src/index.ts` imports each tool module and calls its `register` (L8–L18, L73–L83). It also logs a hand-written `Registered tools:` list (L155–L159). Two tests police these lists: `mcp-server/tests/startup/tool-log-sync.test.ts` and `mcp-server/tests/tools/schema-integrity.test.ts`, the latter with its own stale list.
- **Help:** `mcp-server/src/tools/help-content.ts` holds `TOOL_HELP: Record<string, string>` plus an overview table.
- **User-level paths:** `mcp-server/src/storage/store-registry.ts` owns `AI_INSIGHTS_DIR = '.ai-insights'` (module-private) and resolvers such as `resolveStoresConfigPath()`.
- **Storage primitives:**
  - `atomicWriteJson(filePath, data)` (`mcp-server/src/storage/atomic-writer.ts`) has no file-mode option.
  - `withLock(storageDir, fn)` (`mcp-server/src/storage/file-lock.ts`).
- **Project info:** `readProjectName(projectRoot)` (`mcp-server/src/utils/read-project-name.ts`). No helper exists for finding a repository root from an arbitrary cwd. `deriveRepoName()` only works from plan-folder paths.
- **Numeric input helpers:** `mcp-server/src/schema/common.ts`.
- **GUI:**
  - Separate process (`mcp-server/gui/server.ts`), with one handler file per API area (e.g. `mcp-server/gui/api-stores.ts`).
  - Config page `mcp-server/gui/public/views/config.js`, with one file per tab (`config-*.js`).
  - ES5 frontend with no build step.
- **Personas:**
  - Tools are granted per target: VS Code `tools:` (`central_pm/*` or `central_pm/<tool>`), Claude Code `cc_tools:` (`mcp__central_pm` or `mcp__central_pm__<tool>`).
  - Ledger personas list their tools in `mcp_tools:`.
  - Shared prose lives in `personas/shared/partials/`.
  - Orchestrator (Deep Agents) nodes receive every MCP tool automatically.

## Approach / Architecture

### 1. The provider contract (public, versioned): `mcp-server/src/error-codes/provider-api.ts`

This is the only module a provider depends on, conceptually. Plugins are plain ESM and import nothing from the server; the types are the documentation. The built-in providers import only from this file, so the contract is proven sufficient by its own built-ins.

```ts
export const PROVIDER_API_VERSION = 1;

export interface ErrorCodeProvider {
  apiVersion: 1;
  id: string;                       // /^[a-z][a-z0-9-]{1,47}$/, unique
  label: string;
  description?: string;
  settings: SettingField[];         // declarative; drives validation, GUI form, secret handling
  allocate(request: AllocationRequest, ctx: ProviderContext): Promise<AllocationOutcome>;
  // Optional hooks. Their presence IS the capability; there is no separate capability flag.
  peek?(request: AllocationRequest, ctx: ProviderContext): Promise<AllocationOutcome>;
  test?(ctx: ProviderContext): Promise<TestOutcome>;  // core falls back to peek
}

export type SettingField =
  | { key: string; label: string; type: 'string' | 'url' | 'path'; required?: boolean; default?: string; description?: string; placeholder?: string }
  | { key: string; label: string; type: 'secret'; required?: boolean; description?: string }
  | { key: string; label: string; type: 'integer'; required?: boolean; default?: number; min?: number; max?: number; description?: string }
  | { key: string; label: string; type: 'boolean'; default?: boolean; description?: string }
  | { key: string; label: string; type: 'select'; options: { value: string; label: string }[]; default?: string; description?: string };

export interface AllocationRequest {
  request_id: string;               // uuid, for provider-side logging/idempotency
  cwd_path: string | null;          // as supplied by the agent
  repository: RepositoryInfo | null;
  context: string | null;           // free text from the agent, e.g. class name
}
// root_path/folder_name name the MAIN repository root: every linked worktree of one
// repository resolves to the same values (see project-info.ts).
export interface RepositoryInfo { root_path: string; folder_name: string; package_name: string | null; }

export interface ProviderContext {
  settings: Readonly<Record<string, unknown>>;  // validated against `settings`, secrets included
  signal: AbortSignal;              // core-owned timeout
  data_dir: string;                 // ~/.ai-insights/error-codes/data/{provider-id}/ (created on demand)
  log: { info(msg: string): void; warn(msg: string): void };  // stderr, prefixed, secrets redacted
}

export type AllocationOutcome =
  | { ok: true; value: number }     // positive safe integer
  | { ok: false; reason: FailureReason; ambiguous?: boolean; retry_after_ms?: number; detail?: string };

export type FailureReason = 'throttled' | 'misconfigured' | 'unavailable' | 'rejected' | 'invalid_response' | 'failed';
export type TestOutcome = { ok: true; detail?: string; value?: number } | { ok: false; reason: FailureReason; detail?: string };
```

**Stability rules.** These are written into the file's JSDoc and the authoring guide.
- Within `apiVersion: 1`, every change is additive: new **optional** request fields, context members, provider hooks and setting-field types.
- An optional hook is detected by its presence (`typeof provider.peek === 'function'`). The contract deliberately ships no `capabilities` bag and no `ctx.api_version`: the first would duplicate what hook presence already says, and the provider already declares its own `apiVersion`. Either can be added later as an optional member without a version bump, once a capability exists that hook presence cannot express.
- Providers must ignore unknown request and context fields.
- The core treats unknown outcome `reason`s as `failed`, and ignores unknown provider properties.
- The failure taxonomy is deliberately coarse. It encodes only what the core's policy needs: wait and retry, fix the configuration, or fall back. Provider-specific nuance goes in `detail`.
- A breaking change requires `apiVersion: 2`. The core then keeps loading v1 providers through an adapter. `SUPPORTED_PROVIDER_API_VERSIONS` lists what the core accepts.

### 2. Core modules (new): `mcp-server/src/error-codes/`

**`provider-validation.ts`**: runtime validation of a provider object with Zod, used for built-in and plugin providers alike. It checks:
- the `apiVersion` is supported, and the `id` pattern;
- that `allocate` is a function;
- the settings descriptors: unique keys, known types, and `options` present for `select`;
- that `peek` and `test`, when present, are functions.

It returns either a provider or a list of readable errors.

**`settings-schema.ts`**:
- `buildSettingsSchema(fields)` produces a Zod object: `integer` respects `min`/`max`, `select` must be one of its options, and defaults are applied.
  - `url` must be `https://`, with one exception: `http://` is accepted when the host is a loopback address (`localhost`, `127.0.0.1`, `[::1]`). This lets a self-hosted counter run on the developer's own machine without letting a password travel over plain HTTP across a network. The rule lives in the core, not in a per-descriptor flag, so a plugin cannot weaken it.
- `toPublicSettings(fields, values)`: secrets become `{ set: boolean }`.
- `mergeSettingsUpdate(fields, stored, incoming, clearKeys)`: an absent or empty secret keeps the stored value; keys listed in `clearKeys` are emptied.
- `mergeSettingsForTest(fields, stored, incoming)`: the fail-closed merge used by the GUI connection test (see "GUI security rules" in §6). Stored secrets are merged into the incoming values **only when every non-secret field in `incoming` equals its stored value** (after defaults are applied to both). Any other difference, in a field of any type, means the result carries the incoming secrets only. It returns `{ settings, secrets_merged: boolean }`. It is a pure function, so the rule is tested without HTTP.
- `collectSecrets(fields, values)` feeds redaction.

**`redact.ts`**: the single owner of secret redaction. Plain functions, no state.
- `redact(text, secrets)` replaces every occurrence of each non-empty secret in `text` with `[REDACTED]`. Longer secrets are replaced first, so a secret that contains another is never partly exposed. Empty or whitespace-only secrets are ignored, so an unset field cannot blank out unrelated text.
- `createRedactingLogger(prefix, secrets)` returns the `{ info, warn }` logger handed to providers as `ctx.log`, and used by the allocator, the registry and the loader. It writes `[{prefix}] {message}` to stderr only, passing every message through `redact`.
- It lives in its own module, not in `settings-schema.ts`, because the plugin loader and registry redact text without needing Zod or the descriptor logic, and a future secret-handling route can import it on its own. `collectSecrets` stays in `settings-schema.ts`, which owns the descriptors it reads.

**`config-store.ts`**: the core config file `~/.ai-insights/error-codes/config.json`.
- Shape, validated by Zod:
  ```json
  { "version": 1, "active_provider": "file", "temporary_prefix": "777", "timeout_ms": 10000,
    "retry": { "default_wait_ms": 11000, "max_wait_ms": 30000 },
    "providers": { "<id>": { …settings… } } }
  ```
- **The file is read on every allocation, with no cache and no watcher.** Allocations are rare, so reads stay cheap and both server processes always see the latest settings.
- A missing file means the defaults (`file` provider): zero setup.
- Writes go through `atomicWriteJson(..., { mode: 0o600 })`. Every write is a read-modify-write, exposed as `updateErrorCodeConfig(mutator)`, which runs under `withLock(resolveErrorCodesDir(), …)`. `atomicWriteJson` uses a per-process temp name (`{file}.tmp.{pid}`), so two unlocked saves in the GUI process would collide on the same temp file.
- The module also owns the config Zod schema and its inferred type (no separate `types.ts`).
- Settings stored for a provider that is currently not installed are preserved untouched, so uninstalling and reinstalling a plugin does not lose its configuration.

**`plugin-loader.ts`**: `loadPluginProviders(pluginDir)` scans `~/.ai-insights/plugins/error-codes/`. Each entry is either:
- a `*.mjs` or `*.js` file whose default export is the provider; or
- a folder, so a plugin can carry its own `node_modules` (e.g. a database driver). The entry module is the folder's `package.json` `main` when present, otherwise `index.mjs`. The loader does **not** resolve `package.json` `exports` maps (conditions, subpaths): that would re-implement part of Node's resolver for no current consumer. A folder with neither a `main` nor an `index.mjs` is reported as a load error that says so. `exports` support can be added later without a contract change.

It imports through `pathToFileURL(...).href`, which works on Windows. Each provider goes through `provider-validation`. The result is `{ providers, errors: { source, message }[] }`. A failing plugin never prevents the server from starting.

Plugins run in-process, in whichever process loaded them. The documented trust model states two consequences plainly:
- The allocator's timeout race stops waiting for a provider whose promise never settles, but cannot interrupt a plugin that blocks the event loop synchronously. Such a plugin stalls the whole process.
- The GUI server loads the same plugins, so "Test connection" runs plugin code inside the GUI process.

**`provider-registry.ts`**:
- `BUILTIN_PROVIDERS = [fileProvider, errorcodeIncrementorProvider]`.
- `initProviderRegistry({ pluginDir })` runs once at startup in each process (MCP server and GUI server). Built-ins win on an id clash; the plugin is then recorded as a load error.
- `getProvider(id)` and `listProviders()`. Each entry carries `source: 'builtin' | 'plugin'`, the plugin's path, and the load errors.
- Plugins are picked up on restart. This is documented, and the GUI shows the hint.

**`project-info.ts`**:
- `resolveRepositoryInfo(cwdPath)` walks upward from `cwdPath` to the first directory that contains `.git`.
  - When `.git` is a directory, that directory's parent is the repository root.
  - When `.git` is a file (a linked worktree or a submodule), it reads the `gitdir:` line (resolved relative to the walked directory when relative). If that git directory contains a `commondir` file, the path it names (resolved relative to the git directory) is the shared `.git` directory, and its parent is the **main repository root**. Without a `commondir` (a submodule), or when any read fails, the walked directory is the root.
  - Result: `{ root_path, folder_name, package_name: await readProjectName(root_path) }` for the main root, or `null`. All worktrees of one repository therefore yield the same `folder_name`, so per-repository sequences never split across worktrees.
- It does no shell or `git` calls; the worktree resolution is a few file reads, following git's documented repository layout.
- Known limit, documented in the guide: two unrelated clones with the same folder name share a per-repository sequence. Users who need to separate them set a `counter_file` with the `{repo}` placeholder.

**`temporary-codes.ts`**: owned by the core and never visible to providers. Plain functions over `~/.ai-insights/error-codes/temporary-codes.json`, guarded by `withLock`. The module owns the temporary-entry Zod schema.
- `issueTemporaryCode(dir, prefix, entry)` returns `prefix + String(n).padStart(6, '0')`, with `n` starting at 1. `000000` is reserved as the "MCP unavailable" placeholder. It throws when `n` would exceed 999999.
- Each entry logs `code`, `issued_at` (`now()`), `provider`, `fallback_reason`, `detail`, `repository` and `context`.
- `listTemporaryCodes(dir, filter?)` filters by a substring of `context` or `repository`.

**`allocator.ts`**: `allocateErrorCode(input, deps)`. `deps = { loadConfig, getProvider, resolveRepositoryInfo, temporaryCodes, sleep, now }` is injected for tests.
1. Load the config and resolve the repository info.
2. If the agent requested `temporary`, issue a temporary code (reason `requested`).
3. Get the active provider. A missing provider falls back as `misconfigured`, with detail "provider '{id}' is not installed or failed to load". Settings that fail validation also fall back as `misconfigured`, naming the invalid keys but never their values.
4. Call `allocate` with a context: settings, `AbortSignal.timeout(timeout_ms)`, `data_dir`, and a redacting logger. A provider that throws is treated as `failed` and ambiguous. An abort is `unavailable` and ambiguous.
5. Validate the outcome. A value that is not a positive safe integer becomes `invalid_response`.
6. On `throttled`, wait `min(retry_after_ms ?? retry.default_wait_ms, retry.max_wait_ms)` once and retry once.
7. Never retry an ambiguous failure. Every other failure falls back to a temporary code.
8. Build `ErrorCodeResult`:
   - `code` (a string of digits), `temporary`, `provider`, `fallback_reason?`, `detail?` (redacted), `waited_ms?`, `repository`, `first_component_code` (`code + '01'`);
   - `message` and `instruction`. For `misconfigured`, the instruction adds a hint to check the GUI's Error Codes tab.

All detail and log text passes through `redact(text, secrets)` (from `redact.ts`) before it leaves the allocator. `allocator.ts` exports the `ErrorCodeResult` type, which the tool module imports.

There is no separate `types.ts`: each internal type lives in the module that owns it (config schema in `config-store.ts`, temporary-entry schema in `temporary-codes.ts`, `ErrorCodeResult` in `allocator.ts`).

### 3. Built-in providers (new): `mcp-server/src/error-codes/providers/`

**`file-provider.ts`** (id `file`, the default). Settings:
- `scope` (select `global` | `repository`, default `global`);
- `counter_file` (path, default empty, meaning `{data_dir}/counters.json`; supports a `{repo}` placeholder, e.g. `{repo}/.error-codes.json`, so the sequence can live inside the project);
- `counter_name` (string, default `default`, the key used with global scope);
- `start_value` (integer ≥ 1, default 1).

Behaviour:
- With repository scope, the key is `repository.folder_name`, which is the main repository's folder name for every worktree (§2 `project-info.ts`). A `{repo}` placeholder likewise expands to the main repository root, so a counter file inside the project is shared by all its worktrees.
- When repository scope or a `{repo}` path is configured but no repository resolves, it returns `misconfigured` with detail "no repository found for cwd_path".
- Read-modify-write runs under `withLock(ctx.data_dir)` with `atomicWriteJson`, **whatever directory the counter file is in**. `withLock` creates a `.lock` entry in the directory it locks, so locking `dirname(file)` would leave an untracked `.lock` in the repository root for a `{repo}/.error-codes.json` counter file. `data_dir` is the same path in both server processes, so it serialises every writer on the machine. One lock for all of this provider's counter files is acceptable because allocations are rare.
- `peek` returns the current value.

**`errorcode-incrementor-provider.ts`** (id `errorcode-incrementor`, label "Errorcode Incrementor (HTTP)", with a description linking the public library). Settings:
- `base_url` (url, required, **no default**);
- `password` (secret, required);
- `counter` (string, required);
- `response_suffix` (string, default `01`, the literal suffix the service appends);
- `throttle_delay_ms` (integer, default 10000, the library's default minimum delay).

Behaviour:
- `allocate` sends `GET {base_url}?pw=&counter=&increment=yes`, built with `URL` and `URLSearchParams`, using `ctx.signal`. `peek` sends the same request without `increment`.
- The trimmed body must be digits ending with `response_suffix`; the suffix is stripped.
- Status mapping:

  | Status / error | Outcome |
  |---|---|
  | 401, 400, 404 | `misconfigured`, with a precise `detail` |
  | 403 | `throttled`, `retry_after_ms = throttle_delay_ms + 1000` |
  | 500 | `unavailable`, ambiguous |
  | Other status | `rejected` |
  | Abort | `unavailable`, ambiguous |
  | DNS failure or connection refused | `unavailable`, not ambiguous |
  | Other network error | `unavailable`, ambiguous |
  | Body does not match | `invalid_response` |

- It never logs or returns the URL.

### 4. MCP tools (new `mcp-server/src/tools/error-codes.ts`)
- **`ledger_generate_error_code`** takes:
  - `cwd_path?: string`: the agent's working directory or repository root. It is strongly recommended, because it is what lets providers scope per project.
  - `context?: string`: e.g. `"Namespace\\ClassName"`.
  - `temporary?: boolean`: skips the provider on purpose.

  It returns the `ErrorCodeResult` as JSON. It returns an MCP error only when the temporary-code store itself fails.
- **`ledger_list_temporary_error_codes`** takes `filter?: string` and returns the logged temporary codes.
- Both are added to `TOOL_MODULES`, and `TOOL_HELP` entries are added.

### 5. Tool registry (new `mcp-server/src/tools/registry.ts`)
- `TOOL_MODULES: ReadonlyArray<{ id: string; register(server: McpServer): void }>` lists every tool module.
- `registerAllTools(server): string[]` collects the registered names.
- `src/index.ts` registers through it and logs the derived names. The `initProviderRegistry()` startup call is added separately, together with the error-code tools (step 6), so the registry refactor does not depend on the error-code modules.
- `schema-integrity.test.ts` iterates `TOOL_MODULES`.
- `tool-log-sync.test.ts` is replaced by a registry-completeness and help-coverage test.

### 6. GUI (new handler file `mcp-server/gui/api-error-codes.ts`, new tab `mcp-server/gui/public/views/config-error-codes.js`)
- `mcp-server/gui/server.ts` calls `initProviderRegistry()` at startup.
- New routes:

  | Route | Purpose |
  |---|---|
  | `GET /api/error-codes/providers` | id, label, description, `settings` descriptors, `supports_test` (derived: the provider has `test` or `peek`), source, plugin path, plugin directory path, load errors |
  | `GET /api/error-codes/config` | Core config with each provider's settings through `toPublicSettings` |
  | `PUT /api/error-codes/config` | `{ active_provider?, temporary_prefix?, timeout_ms?, retry?, providers?: { [id]: settings }, clear_secrets?: { [id]: string[] } }`, validated per provider schema and merged with `mergeSettingsUpdate` |
  | `POST /api/error-codes/test` | `{ provider, settings? }`, using unsaved values combined with stored secrets through `mergeSettingsForTest`. Calls `test`, else `peek`, else returns "provider offers no connection test". **Never calls `allocate`.** Secret merge is fail-closed, see "GUI security rules" below. |
  | `GET /api/error-codes/temporary` | The logged temporary codes, newest first, capped (default 200) with an optional `limit` query parameter |

- Routes live in a new non-exported `buildErrorCodeRoutes()` sub-builder in `mcp-server/gui/server.ts`, spread in `buildRoutes()` next to `buildStoreRoutes` without changing the existing spread order (GUI constraint 9). All routes use named capture groups.

- **GUI security rules** (all five routes). The GUI has no authentication, and `server.listen(port)` binds every interface, so these routes are reachable from the LAN and from any web page the user visits unless the server checks the request itself.
  - **Stored secrets are merged into a connection test only when nothing else changed (fail-closed).** `POST /api/error-codes/test` uses `mergeSettingsForTest`: stored secrets are merged only when every non-secret field in the incoming `settings` equals its stored value. Any other change, in a field of any type, means the test runs with the incoming secrets only, and a missing required secret returns `misconfigured`. The rule is type-agnostic on purpose: a database or in-house plugin typically declares its destination as a `string` host or DSN, not a `url`, and a rule keyed on `url` fields would fail open for exactly those plugins. The GUI therefore asks the user to re-enter the password when they test edited settings; the response's `secrets_merged: false` lets the form say so.
  - **Request guards.** The new routes declare request guards that `dispatchRoute` runs before the body is read (see "Route guards" below):
    - `requireLoopbackRequest`: the `Host` header's hostname must be `localhost`, `127.0.0.1` or `[::1]`, and an `Origin` header, when present, must be `http://localhost:{port}`, `http://127.0.0.1:{port}` or `http://[::1]:{port}`. Otherwise `ApiError('FORBIDDEN')` (HTTP 403). This blocks LAN clients, cross-site pages and DNS-rebinding attacks (a rebound page sends its own hostname in `Host`). It applies to all five routes. Consequence, documented: the Error Codes tab only works when the GUI is opened through a loopback address.
    - `requireJsonContentType`: on the `PUT` and `POST` routes, a `Content-Type` other than `application/json` (parameters such as `; charset=utf-8` allowed) is rejected with `ApiError('UNSUPPORTED_MEDIA_TYPE')`, mapped to HTTP 415. This closes the "simple cross-origin POST" path as defence in depth. `api-client.js` already sends this header.
  - Load errors and plugin paths are returned as `{ source, message }` only. Messages carry no stack traces. Showing the plugin and plugin-directory paths is a deliberate, documented exception to the GUI's "no internal paths in responses" rule (GUI constraint 7, Information Hiding): the routes are loopback-only through the guard above, and the user needs the path to install plugins.

- **Route guards** (new, `mcp-server/gui/route-guards.ts`). Route handlers never see the request (`Route.handler(body, groups?, query?)`), so header checks need a route-level hook:
  - `Route` in `mcp-server/gui/server.ts` gains an optional `guards?: ReadonlyArray<RouteGuard>`, with `type RouteGuard = (req: IncomingMessage, port: number) => void` that throws `ApiError` to reject. `dispatchRoute` runs every guard in order after the route matches and before `readJsonBody`. The error goes through the existing `ApiError` branch, so the response shape is unchanged.
  - `apiErrorToStatus` gains `UNSUPPORTED_MEDIA_TYPE` → 415.
  - `route-guards.ts` exports `requireLoopbackRequest` and `requireJsonContentType`. Their first consumer is the error-code routes. The named trajectory is every other route that handles secrets or mutates user-level files: they can opt in with one line, without touching `dispatchRoute` again. Existing routes are not changed by this plan.

- The tab shows:
  - a provider selector;
  - a settings form generated from the descriptors (see "Form renderer rules" below);
  - Save and "Test connection" buttons;
  - a plugins panel listing the plugin directory (with a copy button, following the `cs-copy-btn` pattern in `config-stores.js`), installed plugins and load errors, with a "restart the MCP server and the GUI server to load new plugins" hint, and an empty state when no plugins are installed;
  - core settings (temporary prefix, timeout, retry waits);
  - a list of temporary codes, newest first, capped, with `font-variant-numeric: tabular-nums` for the codes, and a horizontally scrollable wrapper (or stacked layout) below the existing 900px breakpoint.

  Every value that came from a plugin or from config is rendered through `escapeHtml()`.

- **Form renderer rules** (`config-error-codes.js`):
  - `string`, `url`, `path`: `<input type="text">` (`type="url"` for `url`). `path` help text mentions the `{repo}` placeholder where the provider's description does. Defaults appear as placeholder text or help text, never as a pre-filled value that would be saved unintentionally.
  - `secret`: `<input type="password" autocomplete="new-password">`, never pre-filled. A text indicator ("Set" / "Not set", not colour alone) shows the stored state. A "Clear stored value" checkbox is shown only when the secret is set; ticking it disables and empties the input and adds the key to `clear_secrets`.
  - `integer`: `<input type="number">` with `min`/`max` from the descriptor and a computed font size of at least 16px on mobile.
  - `boolean`: checkbox using the existing `form-check` pattern. `select`: a real `<select>` with the descriptor's options.
  - Unknown types render as text inputs; the saved value still goes through the provider's server-side validation, so an unknown type never bypasses it.
  - Every control has a `<label for>` and its description is linked with `aria-describedby`. Required fields are marked in text and with `required`/`aria-required`.
  - Generated element ids are derived from the provider id and field key, passed through `escapeHtml()`, and prefixed (`ec-`) to avoid collisions with other tabs.
  - Save and test results are announced in an `aria-live="polite"` region (a dedicated element, not the existing `#config-msg`).
  - "Test connection" disables itself and shows "Testing…" while the request runs (up to `timeout_ms`), ignores double clicks, and states that the test never consumes a code. It tests the current form values, including unsaved edits. When the response says `secrets_merged: false` and a secret input is empty, the result text explains that stored secrets are only used when no other setting changed, and asks the user to enter them.
  - The `url` input's help text states the scheme rule: `https://`, or `http://` for `localhost` only.
  - Switching the provider selector with unsaved edits triggers the existing "You have unsaved changes. Discard them?" confirm guard. Dirty state is tracked for the whole tab, not per field.
  - Status badges ("builtin", "plugin", load error) reuse the existing `.badge-*` tokens so dark mode keeps its contrast.

### 7. Personas
- **New partial** `personas/shared/partials/error-code-generation.md`:
  - Request one base per new class or module that throws coded exceptions, never one per exception. Component codes are `{base}01`, `{base}02`, ….
  - Always pass `cwd_path` (the repository root) and a `context`.
  - If `temporary` is true, add a `TEMPORARY ERROR CODE` comment marker and report it: as a ledger observation for the ledger Developer, in the synthesis for standalone personas.
  - If the tool is unavailable altogether, use the placeholder base `777000000` with the same marker.
  - Replace temporary codes using `ledger_list_temporary_error_codes`.
  - Never choose or configure providers; that is the user's job.
- **Included in** `personas/ledger/src/content/3-developer.md`, `personas/standalone/src/content/developer.md` and `personas/standalone/src/content/web-gui-specialist.md`.
- **Grants:**
  - Ledger Developer: already has the whole server. Add both tools to `mcp_tools`.
  - Standalone Developer and Web GUI Specialist: narrow per-tool grants on both targets, following `personas/ledger-support/src/meta/ledger-synthesis-maintainer.yaml`.

### 8. Documentation for plugin authors (new)
- **`mcp-server/docs/error-code-providers.md`**: the user-facing guide. It covers:
  - how providers are selected and configured;
  - the built-in providers;
  - writing a plugin: the contract, field types, outcome taxonomy, stability rules, file and folder plugin layouts (folder entry is `main` or `index.mjs`; `exports` maps are not resolved), the trust model and restart behaviour;
  - the trust model's limits: a plugin that blocks the event loop synchronously stalls the process and is not stopped by the timeout, and "Test connection" runs plugin code inside the GUI process;
  - repository scoping: worktrees share their main repository's sequence, and same-named unrelated clones share one too unless a `{repo}` counter file is used;
  - the GUI's connection-test secret rule, the loopback-only restriction of the Error Codes tab, and the `url` scheme rule.
- **`mcp-server/docs/examples/error-code-provider-example/`**: a working example folder plugin (`package.json`, `index.mjs`) implementing a simple JSON-file counter. A test loads it through the real loader, so the documentation cannot rot.

## Rationale
- **A narrow provider contract with all policy in the core:** a provider answers one question, "what is the next integer?". Retry, fallback, timeouts, redaction and agent messaging are where getting it wrong does damage, so they live once in the core. Plugin authors cannot break them, and changing policy never touches the contract.
- **Request and context objects instead of positional parameters:** new information (e.g. a future `scope_hint`) can be added as an optional field without breaking any provider. This is the main lever for the user's "minimal future API changes" requirement.
- **A coarse failure taxonomy with free-text `detail`:** the core only needs to know whether to wait, whether to tell the user to fix the configuration, and whether to fall back. A fine-grained enum would keep growing with every backend and force contract changes.
- **Declarative settings descriptors:** one declaration drives validation, the GUI form and secret handling. A third-party plugin gets a validated, secret-safe settings UI without writing any GUI code, and the GUI never needs per-provider code.
- **Built-ins use exactly the public contract:** the contract is proven sufficient by real providers on day one, and the built-ins double as reference implementations.
- **Counter and scope semantics belong to the provider** (user decision): the core supplies `cwd_path`, repository info and context, and accepts any positive integer. The `file` provider shows both global and per-repository scoping. The `errorcode-incrementor` provider uses one configured counter, which is the user's own setup.
- **A dedicated config file read on every call:** provider settings are only known at runtime, so they cannot live in the static `GuiConfigSchema`. A separate file also keeps secrets out of the general GUI config and lets it carry `0600` permissions. Reading it on each rare allocation removes the need for a cache and watcher, and keeps the two processes consistent.
- **The trust boundary is filesystem access:** installing a plugin means putting code into `~/.ai-insights/plugins/error-codes/`, the same trust level as `npm install`. The GUI can select and configure providers but cannot load code from a path, so its HTTP API never becomes a way to run code.
- **Built-in Errorcode Incrementor provider:** the library is public and MIT-licensed, so this is a driver for a published protocol, like a database driver. Only the host and credentials are private, and they live only in the user's config.
- **Temporary codes owned by the core, `777` plus six zero-padded digits** (user decision): providers cannot affect the fallback guarantee, and a collision would need a real counter above 777 million.
- **Tool registry:** promoted because this plan adds a tool module and would otherwise touch all three hand-maintained lists, one of which has already drifted.
- **A minimal contract surface:** optional hooks are detected by presence, with no capability flag or context version field. Every member a third-party plugin sets is a member the core must honour for the life of `apiVersion: 1`, and an additive contract lets either be added the day a real need appears.
- **Fail-closed secret handling on the connection test, plus loopback-only route guards:** the test route is the one place where the server combines stored secrets with client-supplied settings. Keying that on "nothing else changed" holds for every plugin, whatever field types it declares, and the guards stop other machines and other web pages from reaching the route at all, since the GUI binds every interface.
- **Worktree-aware repository identity:** agents commonly work in linked worktrees. Resolving the main repository root keeps the zero-setup `file` provider's per-repository sequences unique, which is its whole purpose.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Extensibility model | Versioned provider contract, built-ins plus filesystem-installed plugins | A closed set of built-in backends; a generic HTTP backend driven by URL templates | A closed set forces database or in-house users to fork. Templates cannot express real protocols cleanly. A small plugin can express anything. |
| Where policy lives | Core (retry, fallback, timeout, redaction, validation) | Each provider handles its own retries and fallback | Spreading policy across providers duplicates it, lets plugins get it wrong, and couples policy changes to the contract. |
| Provider method signature | `allocate(request, ctx)` with extensible objects | Positional `allocate(counter, settings)` | Positional parameters break every provider whenever an input is added. Objects allow additive evolution. |
| Failure taxonomy | Six coarse reasons, plus `ambiguous`, `retry_after_ms` and `detail` | A fine-grained enum per failure type | A fine-grained enum grows with every backend. The core's decisions only need the coarse classes. |
| Settings UI | Generated from declarative descriptors | Plugins ship their own GUI fragments | Plugin GUI fragments mean running third-party frontend code, an XSS risk, and coupling to the GUI's ES5 conventions. |
| Settings storage | `~/.ai-insights/error-codes/config.json` (`0600`), read per call | Keys inside `gui-config.json`; environment variables | Runtime provider schemas don't fit the static GUI schema. Environment variables are invisible to the GUI process, so the connection test would test something else. |
| Plugin installation | Fixed directory; ESM files or folders with `package.json` | npm packages listed in config; a plugin path set from the GUI | A path set from the GUI turns its API into a way to load code. npm-in-config adds install tooling for no gain over dropping in a folder. |
| Folder plugin entry resolution | `package.json` `main`, else `index.mjs` | Full `exports`/`main` resolution; out-of-process plugins over stdio | `exports` resolution re-implements part of Node's resolver (conditions, subpaths) with no current consumer, and can be added later. Out-of-process isolation contradicts the no-subprocess constraint and the filesystem trust model. |
| Optional provider capabilities | Presence of the `peek`/`test` hook is the capability | A `capabilities.peek` flag validated against the hook; `ctx.api_version` | A flag duplicates what `typeof peek` already says and adds a flag/function mismatch failure mode; the provider already declares `apiVersion`. Both can be added additively when a real capability needs them. |
| Connection-test secret merge | Merge stored secrets only when every non-secret field is unchanged | Merge unless a `url` field changed; never merge (save before testing) | A `url`-only rule fails open for plugins whose destination is a `string` host or DSN. Never merging is strictest but drops the "test unsaved edits" workflow for the common case of unchanged settings. |
| Request-level protection of the new routes | Route-level `guards` (loopback `Host`/`Origin`, JSON `Content-Type`) run by `dispatchRoute` | Content-Type check only; binding the whole GUI to `127.0.0.1` | Content-Type alone does not stop LAN clients (the server binds every interface) or DNS rebinding. Rebinding the whole GUI changes every existing route's reachability, outside this plan's blast radius. |
| `url` field scheme | `https://`, or `http://` for loopback hosts only, enforced in the core | `https://` only; a per-descriptor `allow_http` flag | `https`-only blocks a counter self-hosted on the developer's machine. A per-descriptor flag hands the decision to plugin authors and allows passwords over plain HTTP across a network. |
| Plugin reload | On restart | Hot reload / rescan endpoint | ESM module caching makes true reload unreliable. Plugins change rarely, so a restart is the honest contract. |
| Allocation granularity | One code per call | Leasing blocks of N | Codes are requested once per component, and Errorcode Incrementor cannot increment by N. |
| Repository detection | Walk up to `.git`; for a `.git` file, follow `gitdir:` and `commondir` to the main repository root | Running `git rev-parse --git-common-dir`; keying on the walked (worktree) folder name; keying on `package_name ?? folder_name` | No subprocess and cross-platform. Keying on the worktree folder splits one repository into several sequences. `package_name` is absent for many repositories. |
| `file` provider lock location | `withLock(ctx.data_dir)` for every counter file | `withLock(dirname(counter_file))`, documenting a `.lock` gitignore entry; one lock directory per counter file under `data_dir` | Locking the counter file's directory puts an untracked `.lock` into the repository and pushes a gitignore chore onto every user. Per-file lock directories add path hashing for no measurable gain at this allocation rate. |
| Redaction ownership | Dedicated `redact.ts` (`redact`, `createRedactingLogger`) | Export `redact` from `settings-schema.ts`; inline redaction per module | The loader and registry redact without needing descriptors or Zod; inline copies would drift. One small module gives a single owner and a single test. |
| Tool-list maintenance | `TOOL_MODULES` registry plus a completeness test | Keep adding to the hand-written lists | Removes three places that must be kept in sync, one of which has already drifted. |

## Pattern Alignment
- **Follows** the one-module-per-tool-family pattern with `register()` and `_internal` exports (`mcp-server/src/tools/ping.ts`).
- **Follows** plain-function modules for stateless I/O (`mcp-server/src/storage/repository-registry.ts`), `atomicWriteJson` with `withLock`, `now()` timestamps and stderr-only logging.
- **Follows** user-level files under `~/.ai-insights/`, resolved in `mcp-server/src/storage/store-registry.ts`.
- **Follows** field-level-only refinement and the shared numeric helpers (`mcp-server/src/schema/common.ts`) for tool inputs.
- **Follows** one GUI handler file per API area (`mcp-server/gui/api-stores.ts`) and one file per config tab (`mcp-server/gui/public/views/config-stores.js`), with `escapeHtml()` on every rendered value.
- **Follows** narrow per-tool MCP grants (`personas/ledger-support/src/meta/ledger-synthesis-maintainer.yaml`).
- **Departs from** "the startup log is a hand-maintained literal" (`mcp-server/src/index.ts`). The log is derived from the registry.
- **Departs from** "runtime settings live in `gui-config.json` with a watcher". Error-code settings get their own file, read per call, because provider schemas are dynamic and the file holds secrets.
- **Extends** the declarative route table (`Route` and `dispatchRoute` in `mcp-server/gui/server.ts`) with an optional `guards` field, instead of adding header checks inside `dispatchRoute` for specific paths. Existing routes are unaffected.
- **New pattern:** runtime-loaded plugins. This is the first code-loading extension point in the server, justified by the user's requirement that developers choose any code source. It is documented as a new constraint (trust boundary, contract versioning).

## Structural Improvements

| Structure | Observation | Decision | Reason |
|-----------|-------------|----------|--------|
| `mcp-server/src/index.ts` registration and startup log | Two hand-maintained lists of the same tool names | Promoted to step 5 | The plan adds a tool module, and a registry removes the need to keep these lists in sync. |
| `mcp-server/tests/tools/schema-integrity.test.ts` | Hand-written import list, already stale (misses `ping.ts`, `standalone-import.ts`) | Promoted to step 5 | New tools would otherwise silently skip the schema regression guard. |
| `mcp-server/tests/startup/tool-log-sync.test.ts` | Exists only to police the log literal | Promoted to step 5 (replaced) | Redundant once the log is derived from the registry. |
| `mcp-server/src/tools/help-content.ts` coverage | No test asserts that every tool has help | Promoted to step 5 | The completeness test checks `TOOL_HELP` for every registered name. |
| `mcp-server/src/storage/atomic-writer.ts` | Cannot set a file mode; a file holding secrets needs `0600` on POSIX | Promoted to step 1 | An optional `options?: { mode?: number }` parameter is additive. It is applied to the temp file before the rename, and Windows ignores it. |
| `mcp-server/src/storage/store-registry.ts` `AI_INSIGHTS_DIR` | Private constant; new user-level paths would duplicate it | Promoted to step 1 | `resolveErrorCodesDir()` and `resolveErrorCodePluginDir()` next to the existing resolvers keep a single owner. |
| `mcp-server/src/gui/config.ts` `GuiConfigSchema` | Static schema; cannot hold runtime provider settings | Rejected (left unchanged) | Error-code settings live in their own file, so the GUI config needs no change. |
| `mcp-server/src/utils/ledger-root.ts` `deriveRepoName()` | Derives the repository only from plan-folder paths | Rejected (not reused or reshaped) | Its plan-path semantics are used throughout the ledger. A separate `.git`-walking resolver for arbitrary cwds avoids changing that behaviour. |
| `mcp-server/gui/server.ts` `Route` / `dispatchRoute` | Handlers never receive the request, so no route can check `Host`, `Origin` or `Content-Type` | Promoted to step 7 | An optional `guards` field is additive, keeps `dispatchRoute` path-agnostic, and gives future secret-handling routes a one-line opt-in. |
| `mcp-server/gui/server.ts` `apiErrorToStatus` | No mapping for 415 | Promoted to step 7 | One `case` line; needed for the `Content-Type` guard. |
| `mcp-server/gui/server.ts` `server.listen(port)` | Binds every interface, exposing all unauthenticated routes to the LAN | Rejected | Changing the bind address alters the reachability of every existing route and may break a deliberate LAN setup; that is a GUI-wide decision outside this plan's blast radius. The new routes are protected by the loopback guard instead, and the observation is recorded in the GUI constraints' Known Limitations (Documentation Updates). |
| `mcp-server/src/storage/atomic-writer.ts` per-pid temp name | Two unlocked writes of one file in one process share a temp path | Rejected (no reshaping) | Every read-modify-write already runs under `withLock`, as the storage constraints require; `config-store.ts` follows that rule (step 3). |
| `personas/standalone/src/meta/developer.yaml` `use_when` | Says "no MCP server needed", which is no longer fully accurate | Promoted to step 11 | One-line wording fix in a file the plan already edits. |

## Detailed Steps

1. **Storage foundations.**
   - Add the optional `options?: { mode?: number }` parameter to `atomicWriteJson` in `mcp-server/src/storage/atomic-writer.ts`.
   - Add `resolveErrorCodesDir()` (`~/.ai-insights/error-codes/`) and `resolveErrorCodePluginDir()` (`~/.ai-insights/plugins/error-codes/`) to `mcp-server/src/storage/store-registry.ts`.
2. **The provider contract.** Create `mcp-server/src/error-codes/provider-api.ts` exactly as in Approach §1, with JSDoc stating the stability rules. Create `provider-validation.ts`, `settings-schema.ts` and `redact.ts` (Approach §2).
3. **Core modules.** Create `config-store.ts` (with `updateErrorCodeConfig` under `withLock`), `project-info.ts`, `temporary-codes.ts`, `plugin-loader.ts`, `provider-registry.ts` and `allocator.ts` in `mcp-server/src/error-codes/`, as in Approach §2. Every secret is redacted through `collectSecrets` and `redact.ts` (`redact`, `createRedactingLogger`) before any text leaves the allocator, registry or loader.
4. **Built-in providers.** Create `mcp-server/src/error-codes/providers/file-provider.ts` and `errorcode-incrementor-provider.ts` (Approach §3). They import only from `provider-api.ts`, plus the storage primitives for the file provider, which locks `ctx.data_dir` rather than the counter file's directory. Register both in `BUILTIN_PROVIDERS`.
5. **Tool registry.** Create `mcp-server/src/tools/registry.ts` with `TOOL_MODULES` covering every existing module, and `registerAllTools`. This step does not touch any error-code module.
   - Update `mcp-server/src/index.ts` to register through it and log the derived names.
   - Rewrite `mcp-server/tests/tools/schema-integrity.test.ts` to iterate `TOOL_MODULES`.
   - Replace `mcp-server/tests/startup/tool-log-sync.test.ts` with `mcp-server/tests/tools/tool-registry.test.ts`.
   - Fill in any `TOOL_HELP` entries that turn out to be missing.
6. **MCP tools and MCP server startup wiring.** Create `mcp-server/src/tools/error-codes.ts` with both tools (Approach §4), wiring the real dependencies. Add the module to `TOOL_MODULES`. In `mcp-server/src/index.ts`, call `await initProviderRegistry({ pluginDir: resolveErrorCodePluginDir() })` at startup, before tools are registered, and log each load error to stderr. Add `TOOL_HELP` entries and overview rows in `mcp-server/src/tools/help-content.ts`, covering:
   - parameters, result fields and every `fallback_reason`;
   - why `cwd_path` matters;
   - the `777` + six-digit format, the `000000` placeholder and the component-code convention;
   - that providers are configured by the user in the GUI.
7. **GUI API.**
   - Add the optional `guards?: ReadonlyArray<RouteGuard>` field and the `RouteGuard` type to `Route` in `mcp-server/gui/server.ts`, and run the guards in `dispatchRoute` after a route matches and before `readJsonBody`. Add the `UNSUPPORTED_MEDIA_TYPE` → 415 case to `apiErrorToStatus`.
   - Create `mcp-server/gui/route-guards.ts` with `requireLoopbackRequest` and `requireJsonContentType` (Approach §6, "Route guards").
   - Create `mcp-server/gui/api-error-codes.ts` with handlers for the five routes in Approach §6. Config writes go through `updateErrorCodeConfig`; the test handler goes through `mergeSettingsForTest` and returns `secrets_merged`.
   - Register them in `mcp-server/gui/server.ts`, following the GUI route-ordering rules.
   - Add a `buildErrorCodeRoutes()` sub-builder in `server.ts` and spread it in `buildRoutes()` without changing the existing order.
   - Call `initProviderRegistry()` in the GUI server startup.
   - No response ever contains a secret value.
   - Apply the "GUI security rules" in Approach §6: `requireLoopbackRequest` on all five routes, `requireJsonContentType` on the `PUT` and `POST` routes, the fail-closed secret merge, sanitised load errors.
8. **GUI view.**
   - Create `mcp-server/gui/public/views/config-error-codes.js` (ES5), with a form renderer driven by the settings descriptors, following the "Form renderer rules" in Approach §6. Closure-scoped helpers carry the `Closure dependencies` JSDoc (GUI constraint 19). Event listeners on persistent elements use the stored-handler pattern with a cleanup function (GUI constraint 2).
   - Add the "Error Codes" tab in `mcp-server/gui/public/views/config.js`, and complete every integration point:
     - add `errorCodes` to the `configDirty` object and reset it in `renderConfigPage()`;
     - reset the new module's state variables in `renderConfigPage()`;
     - add the tab button and the dispatcher branch in `renderConfigTabContent()`;
     - add a cleanup branch to the tab-switch handler that removes the module's listeners, runs on leaving the tab, and honours the dirty-state confirm guard;
     - the tab loads its own data (providers, config, temporary codes) lazily on first open. Do not add these calls to the `Promise.all` in `renderConfig()`, so the config page never depends on the new endpoints to render.
   - Add the API wrappers to `mcp-server/gui/public/api-client.js`, each with `@throws {{ code: string, message: string }}` JSDoc (GUI constraint 20).
   - In `mcp-server/gui/public/index.html`, add `<script src="/views/config-error-codes.js?v=1">` before `config.js`, and bump `api-client.js?v=5` and `config.js?v=3` (GUI constraint 14).
   - Add any styles to `mcp-server/gui/public/styles.css` using the existing CSS custom properties and `.badge-*` tokens, with dark-mode values under `[data-theme="dark"]`.
   - Secret inputs are never pre-filled.
9. **Plugin author documentation and example.** Write `mcp-server/docs/error-code-providers.md` and the example plugin `mcp-server/docs/examples/error-code-provider-example/` (`package.json`, `index.mjs`), as in Approach §8.
10. **Shared persona partial and ledger Developer.**
    - Create `personas/shared/partials/error-code-generation.md` (Approach §7).
    - Include it in `personas/ledger/src/content/3-developer.md` as an `### Error Codes` subsection. If it is added as a workflow phase, also add the matching numbered step, per persona `constraints.md` 5a.
    - Add both tools to `mcp_tools` in `personas/ledger/src/meta/3-developer.yaml`, with an integrated changelog entry and a minor version bump.
11. **Standalone personas.**
    - Include the partial in `personas/standalone/src/content/developer.md` and `personas/standalone/src/content/web-gui-specialist.md`.
    - In both YAML files, add `central_pm/ledger_generate_error_code` and `central_pm/ledger_list_temporary_error_codes` to `tools:`, and the matching `mcp__central_pm__…` entries to `cc_tools:`, each with an inline rationale comment.
    - Reword `use_when` in `developer.yaml` to "MCP server optional — used only for error-code allocation".
    - Add integrated changelog entries recording the grant change.
12. **Build and verify personas.** Run `node scripts/build-personas.js --strict --check`, then the real build. Confirm that tool parity passes and the generated Claude Code and VS Code files contain the partial and the grants.
13. **Tests.** Implement every entry in the Test Plan, all of which run unattended under Vitest (the GUI view through jsdom), then run `npm test` and `npm run build` in `mcp-server/`. The visual and browser checks that jsdom cannot perform are not part of this step; they are Human Action 4.
14. **Documentation.** Apply every entry in Documentation Updates.

## Dependencies
- Step 1 comes before steps 3 and 4.
- Step 2 comes before steps 3 and 4.
- Step 3 comes before steps 4, 6 and 7.
- Step 4 comes before steps 6, 7 and 9.
- Step 5 comes before step 6. Step 6 also depends on steps 1, 3 and 4 (it imports `initProviderRegistry`, `resolveErrorCodePluginDir` and, through the registry, `BUILTIN_PROVIDERS`).
- Step 7 comes before step 8.
- Step 10 comes before step 11, which comes before step 12.
- Step 13 depends on steps 1–9.
- Step 14 depends on steps 1–12.
- Steps 1, 2 and 5 can run in parallel: step 5 no longer imports any error-code module. Step 10 can run in parallel with steps 1–9.

## Required Components
- **New core:** `mcp-server/src/error-codes/provider-api.ts`, `provider-validation.ts`, `settings-schema.ts`, `redact.ts`, `config-store.ts`, `project-info.ts`, `temporary-codes.ts`, `plugin-loader.ts`, `provider-registry.ts`, `allocator.ts`
- **New providers:** `mcp-server/src/error-codes/providers/file-provider.ts`, `mcp-server/src/error-codes/providers/errorcode-incrementor-provider.ts`
- **New tools:** `mcp-server/src/tools/error-codes.ts`, `mcp-server/src/tools/registry.ts`
- **New GUI:** `mcp-server/gui/api-error-codes.ts`, `mcp-server/gui/route-guards.ts`, `mcp-server/gui/public/views/config-error-codes.js`
- **New docs:** `mcp-server/docs/error-code-providers.md`, `mcp-server/docs/examples/error-code-provider-example/package.json`, `mcp-server/docs/examples/error-code-provider-example/index.mjs`
- **New persona partial:** `personas/shared/partials/error-code-generation.md`
- **New runtime files:**
  - `~/.ai-insights/error-codes/config.json`, `temporary-codes.json` and `data/{provider-id}/`;
  - the `~/.ai-insights/plugins/error-codes/` directory, which the user creates when needed.
- **Modified:** `mcp-server/src/storage/atomic-writer.ts`, `mcp-server/src/storage/store-registry.ts`, `mcp-server/src/index.ts`, `mcp-server/src/tools/help-content.ts`, `mcp-server/gui/server.ts`, `mcp-server/gui/public/views/config.js`, `mcp-server/gui/public/api-client.js`, `mcp-server/gui/public/index.html`, `mcp-server/gui/public/styles.css`, `mcp-server/gui/docs/agents/project-manifest/constraints.md`
- **Modified:** `personas/ledger/src/meta/3-developer.yaml`, `personas/ledger/src/content/3-developer.md`, `personas/standalone/src/meta/developer.yaml`, `personas/standalone/src/content/developer.md`, `personas/standalone/src/meta/web-gui-specialist.yaml`, `personas/standalone/src/content/web-gui-specialist.md`
- **External:** an Errorcode Incrementor installation (`https://github.com/Mistralys/errorcode-incrementor`), which is optional and configured by the user.

## Assumptions
- The plan is carried out in a DEV workspace, not STABLE, which hosts the live Ledger server (user decision).
- Errorcode Incrementor responds with `{value}01` as `text/plain`, per the user's reference. The suffix is a setting in case a future version changes it.
- Agents allocating codes through the `file` provider run on one machine. Cross-machine uniqueness is what remote providers are for.
- Consuming applications store error codes as 64-bit integers or as strings.
- Plugins are trusted code installed by the machine's user.
- No release is planned. Changelogs use the WIP convention.

## Constraints
- **Within `apiVersion: 1`, the provider contract changes only additively.** Any breaking change requires `apiVersion: 2` and a v1 adapter in the core.
- No private hosts, counter names or credentials appear in the repository. `errorcode-incrementor` has no default `base_url`, and tests use the fictitious `https://counter.example.test/`.
- Secret values never appear in logs, tool responses, GUI responses, error details or test snapshots.
- The GUI can never cause code to be loaded from a path. Plugins come only from the fixed plugin directory.
- The GUI has no authentication and binds every interface. The new routes therefore accept only loopback requests (`Host`/`Origin` guard), require `Content-Type: application/json` on bodies, and the connection test merges stored secrets only when no non-secret field changed.
- The GUI follows its own conventions: `escapeHtml()` on all rendered values, `Closure dependencies` JSDoc on view helpers, `@throws` JSDoc on API client methods, `?v=N` bumps in `index.html`, and manual listener cleanup on tab switch.
- At most one retry, and only after `throttled`. Ambiguous failures are never retried.
- STDIO discipline: stderr only. JSON is written only through `atomicWriteJson`, and read-modify-write runs under `withLock`.
- No outer-schema `.refine()` on tool input schemas. The GUI stays ES5 with no build step.
- Cross-platform: paths come from `os.homedir()` and `path.join`, plugins are imported through `pathToFileURL`, and no shell or `git` subprocesses are used.

## Out of Scope
- Hot reloading of plugins (a restart is required).
- A plugin marketplace, npm-based install tooling or plugin signing.
- Leasing blocks of codes.
- A lint or CI duplicate-code check. It belongs in the consuming projects.
- Automatically replacing temporary codes in source, or a tool that marks a temporary code as resolved.
- Further built-in providers (e.g. a database or generic HTTP template). These are reachable through plugins.
- Granting the tools to personas other than the three named.
- Encrypting secrets at rest beyond `0600` file permissions, or storing them in an OS keychain.
- Changing the GUI server's bind address, or adding the new route guards to existing routes. Recorded as a known limitation in the GUI constraints.
- Resolving `package.json` `exports` maps for folder plugins.

## Human Actions

| # | Action | When | Why an agent cannot do it |
|---|--------|------|---------------------------|
| 1 | Move this plan folder to the DEV workspace before starting the run | Before the run | Workspace selection is the user's decision and environment |
| 2 | In the GUI's Error Codes tab, select "Errorcode Incrementor (HTTP)", enter the base URL, password and counter, then check them with "Test connection" | After the run | The host and password are private to the user and must not enter the repository |
| 3 | Restart the MCP server and GUI server, and redeploy the personas to the live environment, once the change reaches STABLE | After the run | The live servers and deployment belong to the user |
| 4 | Browser check of the Error Codes tab in the DEV workspace: a keyboard-only pass with visible focus throughout; dark and light themes, 200% zoom, a viewport below 900px (the temporary-codes list scrolls or stacks) and `prefers-reduced-motion`; a password manager does not autofill the secret input; drop the example plugin into `~/.ai-insights/plugins/error-codes/`, restart both servers and see it listed and selectable; open the GUI through the machine's LAN address and see a readable error instead of data | After the run | Needs a real browser with a layout engine, a password manager, server restarts and a second network address; jsdom cannot render layout, focus rings or contrast |

## Acceptance Criteria
- AC-01: With no `config.json` present, `ledger_generate_error_code` allocates through the `file` provider with `temporary: false`. Sequences start at 1 and increase by one per call. No network request is made.
- AC-02: The `file` provider supports `global` and `repository` scope, a configurable `start_value`, and a `counter_file` with a `{repo}` placeholder. With repository scope, two repositories keep independent sequences, and two linked worktrees of one repository share a single sequence (both resolve to the main repository's `root_path` and `folder_name`). Without a resolvable repository it returns `misconfigured`, and the tool falls back.
- AC-03: The `errorcode-incrementor` provider sends one increment request and strips the configured suffix (`52001` → `520`). 401/400/404 map to `misconfigured`, 403 to `throttled` with `retry_after_ms`, 500 and timeout to ambiguous `unavailable`, and a non-matching body to `invalid_response`.
- AC-04: The allocator retries exactly once after `throttled`, waiting `min(retry_after_ms ?? default_wait_ms, max_wait_ms)`, and reports `waited_ms`. It never retries an ambiguous failure. Every failure, and a `temporary: true` request, produces a temporary `777NNNNNN` code with the matching `fallback_reason`.
- AC-05: Temporary codes are zero-padded to six digits after the configured prefix, persisted, unique under parallel calls and never `000000`. Each is logged with provider, reason, repository and context. `ledger_list_temporary_error_codes` returns them, with filtering.
- AC-06: A provider value that is not a positive safe integer, a provider that throws, and an active provider that is missing or has invalid settings all produce a temporary code (`invalid_response`, `failed` or `misconfigured`). None of them crashes the tool.
- AC-07: Provider validation rejects an unsupported `apiVersion`, an invalid or duplicate `id`, a missing `allocate`, invalid settings descriptors, and a `peek` or `test` member that is present but not a function, each with a readable error.
- AC-08: The plugin loader loads a single-file ESM plugin, a folder plugin whose `package.json` `main` names the entry, and a folder plugin with only `index.mjs` from the plugin directory. A folder with neither is reported as a load error naming the expected entry. Loading works on Windows-style paths through `pathToFileURL`. A broken plugin is reported in the load errors without preventing startup. In the provider registry, a plugin whose id clashes with a built-in is rejected and recorded as a load error, and the built-in keeps working; every listed provider carries `source: 'builtin' | 'plugin'`.
- AC-09: The example plugin in `mcp-server/docs/examples/error-code-provider-example/` loads through the real loader and allocates successfully.
- AC-10: Within `apiVersion: 1`, providers receive unknown extra request and context fields without error. Unknown outcome reasons are treated as `failed`, and unknown provider properties are ignored. Both behaviours are tested.
- AC-11: Secret values (fields of type `secret`) never appear in any GUI response, tool response, error detail, log line or temporary-code log entry. The GUI sees only `{ set: boolean }`. An empty or absent secret on save keeps the stored value, and `clear_secrets` clears it. `POST /api/error-codes/test` merges stored secrets only when every non-secret field equals its stored value, whatever the field types, so a request cannot make the server send a stored secret to a different host, URL, DSN or any other changed destination.
- AC-12: `config.json` is written with mode `0600` on POSIX. Settings of providers that are not installed are preserved across saves. Concurrent saves in one process run under `withLock` and lose no update.
- AC-13: `POST /api/error-codes/test` uses the provider's `test`, or else `peek`, with unsaved settings, and never calls `allocate`.
- AC-14: The GUI Error Codes tab, rendered in jsdom against stubbed API wrappers, lists the providers, renders each settings form from its descriptors (unknown field types as text inputs), sends the expected save and test requests, shows the plugin directory and load errors, and lists temporary codes. A descriptor label containing `<script>` is rendered as text, never as markup.
- AC-19: The Error Codes tab's rendered markup meets the accessibility floor, asserted in jsdom. Every generated control has a `<label for>` matching its id, descriptions are linked with `aria-describedby`, and required fields carry `required`/`aria-required`. Secret inputs are `type="password"` with `autocomplete="new-password"` and an empty value; the set/not-set state is text; the "Clear stored value" checkbox appears only when the secret is set. Save and test results are written to an `aria-live="polite"` region. Provider switching with unsaved edits calls the unsaved-changes confirm guard. "Test connection" is disabled and reads "Testing…" while its request is pending, and a second click sends no second request. Leaving and re-entering the tab does not duplicate event handling. The interactive controls are native, focusable elements (`input`, `select`, `button`), with no positive `tabindex`. Visual behaviour (focus rings, themes, zoom, narrow viewports) is checked by the user in Human Action 4 and is not an acceptance criterion of the run.
- AC-20: The new GUI routes reject requests whose `Host` is not a loopback name or whose `Origin` is not the GUI's own loopback origin (HTTP 403), reject non-`application/json` request bodies (HTTP 415, through the new `Route.guards` hook and `apiErrorToStatus` mapping, with existing routes unaffected), return load errors as `{ source, message }` without stack traces, and are registered through a `buildErrorCodeRoutes()` sub-builder without changing the existing route ordering. The new view is loaded through `index.html` with `?v=N` bumps for every changed frontend file.
- AC-15: `errorcode-incrementor` has no default `base_url`, and no private host, counter name or credential appears in the repository.
- AC-16: Every tool module is registered through `TOOL_MODULES`, and the startup log is derived from the registry. Tests fail if a module is missing from the registry or a registered tool has no `TOOL_HELP` entry.
- AC-17: The generated Claude Code and VS Code output of the ledger Developer, standalone Developer and Web GUI Specialist contains the error-code instructions and grants for both tools. The persona build passes with `--strict`.
- AC-18: All MCP server tests pass, and `tsc` builds without errors.
- AC-21: Settings of type `url` accept `https://` URLs and `http://` URLs whose host is `localhost`, `127.0.0.1` or `[::1]`, and reject every other `http://` URL and every other scheme.
- AC-22: Secret redaction has a single owner, `mcp-server/src/error-codes/redact.ts`. `redact` removes every occurrence of each non-empty secret (a secret contained in another is never partly exposed), ignores empty secrets, and the redacting logger writes only to stderr.
- AC-23: The `file` provider never creates a `.lock` entry beside its counter file: with a `{repo}` counter file, the repository directory contains no new entry other than the counter file itself.

## Testing Strategy
- **Contract-first.** A shared helper, `describeProviderContract(name, makeProvider, makeCtx)`, runs the same behavioural suite against every provider: both built-ins and the docs example. It checks that the provider passes validation, returns a positive integer, increases monotonically, ignores unknown request fields and respects abort.
- Test the allocator with injected fakes for config, provider, temporary store, `sleep` and `now`, so there are no real waits.
- Test the HTTP provider with `vi.stubGlobal('fetch', …)` against `https://counter.example.test/`.
- Test the file-based code (file provider, temporary codes, config store, plugin loader) in temp directories, including parallel calls.
- Test the GUI handlers at the function level, and the ES5 Error Codes view in jsdom (the `orchestrator-view.test.ts` pattern), so every GUI check the run owns executes unattended. Layout-dependent checks are the user's browser pass (Human Action 4).
- Use a secret sentinel value (`SENTINEL-SECRET-123`) and assert across every output path that it never appears.

## Test Plan
- `mcp-server/tests/error-codes/provider-contract.ts` (shared helper, not a test file itself), applied in each provider's test file. Covers AC-09, AC-10.
- `mcp-server/tests/error-codes/provider-validation.test.ts`:
  - Accepts both built-ins and the example plugin.
  - Rejects each invalid shape listed in AC-07.
  - Covers AC-07.
- `mcp-server/tests/error-codes/settings-schema.test.ts`:
  - Builds a schema per field type, including integer bounds and select options, and applies defaults.
  - `url` scheme rule: `https://` accepted; `http://localhost`, `http://127.0.0.1` and `http://[::1]` accepted; `http://` to any other host, `ftp://` and `javascript:` rejected.
  - `toPublicSettings` hides secrets.
  - `mergeSettingsUpdate` keep/clear semantics.
  - `mergeSettingsForTest`: merges stored secrets when all non-secret fields are unchanged (including a field left at its default); does not merge when a `url` field, a `string` field (e.g. a host), an `integer` field or a `select` field differs; reports `secrets_merged` accordingly.
  - Covers AC-11, AC-21.
- `mcp-server/tests/error-codes/config-store.test.ts`:
  - A missing file yields defaults.
  - Round-trip save and load.
  - `0600` mode on POSIX (skipped on Windows).
  - Settings of uninstalled providers are preserved.
  - Ten parallel `updateErrorCodeConfig` calls, each setting a different key, all land in the final file.
  - Covers AC-01, AC-12.
- `mcp-server/tests/error-codes/project-info.test.ts`:
  - Finds `.git` as a directory.
  - Worktree fixture: a main checkout with a `.git` directory plus a `worktrees/wt1/commondir` file, and a sibling worktree folder with a different name whose `.git` file holds a relative `gitdir:`. Both the main checkout and a subdirectory of the worktree resolve to the same `root_path` and `folder_name` (the main checkout's).
  - Same fixture with an absolute `gitdir:` path.
  - Submodule fixture (`.git` file whose git directory has no `commondir`) resolves to the submodule folder itself.
  - A `.git` file pointing at a missing directory falls back to the walked directory without throwing.
  - Returns null outside a repository.
  - Picks up `package_name` via `readProjectName`.
  - Covers AC-02.
- `mcp-server/tests/error-codes/file-provider.test.ts`:
  - The contract suite.
  - Global vs. repository scope, `start_value`, and the `{repo}` path placeholder.
  - Two requests carrying the `RepositoryInfo` of two worktrees of one repository draw from one sequence.
  - Twenty parallel allocations are unique.
  - No repository leads to `misconfigured`.
  - `peek` works.
  - With a `{repo}/.error-codes.json` counter file in a temp repository fixture, after allocations the repository directory holds no `.lock` entry, and the lock is taken in `ctx.data_dir`.
  - Covers AC-01, AC-02, AC-23.
- `mcp-server/tests/error-codes/redact.test.ts`:
  - Replaces every occurrence of a secret; handles several secrets; a secret contained in a longer secret leaves no fragment of the longer one; empty and whitespace-only secrets leave the text untouched; secrets with regex metacharacters are replaced literally.
  - `createRedactingLogger` writes prefixed, redacted lines to stderr (spy on `process.stderr.write` / `console.error`) and never to stdout.
  - Covers AC-11, AC-22.
- `mcp-server/tests/error-codes/errorcode-incrementor-provider.test.ts`:
  - The contract suite, against a stubbed `fetch`.
  - The increment URL carries `increment=yes`, `peek` omits it, and parameters are URL-encoded.
  - Suffix stripping.
  - Each status and error mapping from AC-03, including the `ambiguous` flags and `retry_after_ms`.
  - The sentinel never appears in the outcome or logs.
  - Covers AC-03, AC-11.
- `mcp-server/tests/error-codes/temporary-codes.test.ts`:
  - Zero padding and the prefix.
  - Never `000000`; overflow throws.
  - Persistence, parallel uniqueness and filtering.
  - Covers AC-05.
- `mcp-server/tests/error-codes/allocator.test.ts`:
  - Success path and the `temporary: true` path.
  - Throttle → exactly one wait, with the computed delay and its cap, then retry; a second throttle falls back.
  - Ambiguous failures get no retry.
  - Non-integer values, a throwing provider, a missing provider and invalid settings all fall back.
  - Unknown reasons map to `failed`.
  - Abort through the timeout.
  - Redaction of `detail`.
  - Covers AC-04, AC-06, AC-10, AC-11.
- `mcp-server/tests/error-codes/plugin-loader.test.ts`:
  - Loads a file plugin, a folder plugin with `package.json` `main`, and a folder plugin with only `index.mjs`, from a temp plugin directory.
  - A syntax-error plugin, an invalid-shape plugin, two plugins in the directory declaring the same id, and a folder with only an `exports` map (no `main`, no `index.mjs`) are each reported as load errors. The loader knows nothing of built-ins; clashes with them are the registry's job.
  - A missing plugin directory yields no providers and no errors.
  - Load error messages carry no stack text, and a secret-like string thrown by a plugin passes through `redact` when secrets are supplied.
  - Loads the docs example plugin.
  - Covers AC-08, AC-09.
- `mcp-server/tests/error-codes/provider-registry.test.ts` (new), with `loadPluginProviders` injected or pointed at a temp plugin directory:
  - `listProviders()` returns both built-ins with `source: 'builtin'` and a valid plugin with `source: 'plugin'` and its path.
  - A plugin whose id is `file` is rejected, recorded as a load error naming the clash, and `getProvider('file')` still returns the built-in.
  - Loader errors are surfaced unchanged through the registry's load-error list.
  - `getProvider` of an unknown id returns `undefined`.
  - Calling `initProviderRegistry` twice (as the MCP server and the GUI server each do in their own process) leaves one consistent provider set, not duplicates.
  - Covers AC-08.
- `mcp-server/tests/tools/error-codes.test.ts`:
  - Tool handlers return well-formed results for final and temporary codes.
  - `cwd_path` is passed through as repository info.
  - The list tool works.
  - An MCP error is returned only when the temporary store fails.
  - No sentinel in any response.
  - Covers AC-01, AC-04, AC-05, AC-11.
- `mcp-server/tests/gui/api-error-codes.test.ts`:
  - The providers listing includes descriptors and load errors.
  - GET/PUT config never returns secrets, and keep/clear works.
  - Invalid settings are rejected per the provider schema.
  - The test route never calls `allocate` (spy) and falls back from `test` to `peek` to "no test".
  - The test route does not merge stored secrets when a `url` field differs from the stored value, nor when a `string`-typed destination field (a stub plugin provider declaring a `host` string and a `password` secret) differs; in both cases the sentinel password never reaches the stub provider's `test` context and the response says `secrets_merged: false`. It does merge them when every non-secret field is unchanged.
  - Non-`application/json` bodies are rejected with 415 on the `PUT` and `POST` routes.
  - A request with `Host: 192.168.1.10:{port}`, or with `Origin: http://evil.example`, is rejected with 403 on every new route; `Host: localhost:{port}` with no `Origin`, and with `Origin: http://127.0.0.1:{port}`, is accepted.
  - Load errors contain only `source` and `message`, with no stack text.
  - Temporary-code listing, including the cap and `limit` parameter.
  - Covers AC-11, AC-12, AC-13, AC-14, AC-20.
- `mcp-server/tests/gui/route-guards.test.ts` (new): unit tests of `requireLoopbackRequest` (each loopback host form, IPv6 bracket form, non-loopback host, mismatched port in `Origin`, foreign `Origin`, missing `Origin`, missing `Host`) and `requireJsonContentType` (`application/json`, `application/json; charset=utf-8`, `text/plain`, missing header). Covers AC-20.
- `mcp-server/tests/gui/dispatch-route.test.ts` (existing, extended): a route with `guards` runs them before the body is read (a rejecting guard means the handler is never called and the body is not parsed); an `ApiError('UNSUPPORTED_MEDIA_TYPE')` maps to 415; a route without `guards` behaves exactly as before. Covers AC-20.
- `mcp-server/tests/gui/route-table.test.ts` (existing, modified if needed): the five new routes are present, use named capture groups, carry `requireLoopbackRequest`, and keep the existing section ordering.
- `mcp-server/tests/error-codes/no-private-config.test.ts`:
  - The `errorcode-incrementor` descriptor has no `base_url` default.
  - Scanning `mcp-server/src/`, `mcp-server/gui/`, `mcp-server/docs/` and `mcp-server/tests/` finds no `mistralys.eu` host.
  - Covers AC-15.
- `mcp-server/tests/tools/tool-registry.test.ts` (replaces `tests/startup/tool-log-sync.test.ts`):
  - Every `src/tools/*.ts` file that contains `server.registerTool(` is in `TOOL_MODULES`.
  - Registered names are unique and include both new tools.
  - Every name has a `TOOL_HELP` entry containing `# {name}`.
  - Covers AC-16.
- `mcp-server/tests/tools/schema-integrity.test.ts` (modified): iterates `TOOL_MODULES` and asserts non-empty `properties` for every schema. Covers AC-16, AC-18.
- `mcp-server/tests/gui/config-error-codes-view.test.ts` (new), following the jsdom pattern of `mcp-server/tests/gui/orchestrator-view.test.ts` (`// @vitest-environment jsdom`, script loaded with `vm.runInThisContext`, API wrappers stubbed with `vi.fn`):
  - Provider list and switching: the selector lists the stubbed providers; selecting one renders its form; a provider with load errors and the plugins panel (directory path, copy button, restart hint, empty state) render.
  - Form renderer, one descriptor per field type: `string`/`path` → `type="text"`, `url` → `type="url"`, `integer` → `type="number"` with `min`/`max`, `boolean` → checkbox, `select` → `<select>` with the descriptor's options, an unknown type → `type="text"`. Defaults appear as placeholder or help text, not as `value`.
  - Escaping: a provider label, description and load-error message containing `<script>` and `<img onerror>` render as text (no such elements in the DOM).
  - Accessibility markup: every control has a matching `<label for>`; descriptions are referenced by `aria-describedby`; required fields carry `required` and `aria-required="true"`; element ids are `ec-`-prefixed; no element has a positive `tabindex`.
  - Secrets: the input is `type="password"`, `autocomplete="new-password"` and empty; "Set"/"Not set" appears as text; the "Clear stored value" checkbox exists only when set, and ticking it disables the input and puts the key into `clear_secrets` in the save payload; an empty secret is omitted from the payload.
  - Save and test: Save sends the expected `PUT` payload; the result is written to the `aria-live="polite"` region, not `#config-msg`. "Test connection" is disabled and reads "Testing…" while its promise is pending, a second click sends no second request, and a `secrets_merged: false` response with an empty secret input shows the re-enter explanation.
  - Dirty guard and cleanup: switching providers after an edit calls the stubbed `confirm`; leaving the tab runs the cleanup function, and re-entering then clicking Save sends exactly one request.
  - Temporary codes: the list renders newest first, inside the scroll wrapper.
  - Covers AC-14, AC-19.
- The LAN-address rejection is covered by the guard tests (`route-guards.test.ts`, `api-error-codes.test.ts`, AC-20). The browser-only checks (focus rings, themes, zoom, narrow viewport, reduced motion, password-manager behaviour, a plugin installed and picked up after a real restart) are Human Action 4, not part of the run.
- Persona build: `node scripts/build-personas.js --strict --check` passes. Grep the generated Claude Code and VS Code files of the three personas for both tool names and the `TEMPORARY ERROR CODE` marker. Covers AC-17.
- `npm test` and `npm run build` in `mcp-server/`. Covers AC-18.

## Documentation Updates
- `mcp-server/docs/error-code-providers.md` (new): the user and plugin-author guide (Approach §8).
- `mcp-server/docs/examples/error-code-provider-example/` (new): the working example plugin.
- `mcp-server/docs/agents/project-manifest/api-surface.md`:
  - Both tools.
  - The full provider contract and its stability rules.
  - The core module functions (including `redact` and `createRedactingLogger`) and `BUILTIN_PROVIDERS`.
  - `TOOL_MODULES` and `registerAllTools`.
  - `atomicWriteJson`'s new `options` parameter.
  - `resolveErrorCodesDir` and `resolveErrorCodePluginDir`.
- `mcp-server/docs/agents/project-manifest/file-tree.md`: the new folders and files, the new tests (with the removal of `tests/startup/tool-log-sync.test.ts`), the docs example, and the runtime files under `~/.ai-insights/`.
- `mcp-server/docs/agents/project-manifest/data-flows.md`: startup provider loading in both processes, the allocation flow (config → repository info → provider → throttle retry → fallback → temporary log), the GUI configuration and test flow, and the registry-based tool registration.
- `mcp-server/docs/agents/project-manifest/tech-stack.md`: the runtime plugin architecture (provider contract, filesystem plugin directory, `pathToFileURL` imports), Node's built-in `fetch`, and no new dependencies.
- `mcp-server/docs/agents/project-manifest/constraints.md`, four new constraints:
  - "Error-Code Provider Contract Is Additive-Only Within an API Version".
  - "Policy Lives in the Allocator, Not in Providers".
  - "Plugins Load Only From the Plugin Directory; the GUI Never Loads Code".
  - "Secrets Never Leave the Server", covering the descriptor-driven redaction, `redact.ts` as its single owner, and the sentinel tests.

  Also add "Tool Modules Are Registered Through `TOOL_MODULES`".
- `mcp-server/docs/agents/project-manifest/constraints-testing.md`: new providers must pass `describeProviderContract`; tests never call a real counter service; `sleep` is injected.
- `mcp-server/AGENTS.md`:
  - In the "Add new MCP tool" maintenance row, add "register in `src/tools/registry.ts` and add a `TOOL_HELP` entry".
  - Add a row for "Change the error-code provider contract" pointing to `docs/error-code-providers.md`, `api-surface.md` and the additive-only constraint.
- `mcp-server/gui/docs/agents/project-manifest/api-surface.md`, `data-flows.md`, `file-tree.md`, `ui-components.md`: the five routes, the handler file, `route-guards.ts`, the `Route.guards` field and `RouteGuard` type, the `UNSUPPORTED_MEDIA_TYPE` → 415 mapping, the descriptor-driven form renderer and the Error Codes tab.
- `mcp-server/gui/docs/agents/project-manifest/constraints.md`:
  - The handler-domain table in "Handler Domain Split" gets a row for `gui/api-error-codes.ts`, and the sub-builder list in "Route Dispatch Ordering" names `buildErrorCodeRoutes`.
  - A new constraint: "Routes That Handle Secrets Are Loopback-Only, Require `application/json`, and Never Merge Stored Secrets Into Changed Settings". It states the no-authentication, all-interfaces-bind rationale, the `guards` opt-in for future routes, and the fail-closed merge rule.
  - Under "Security Constraints (Backend)", a note on the deliberate exception to "no internal paths in responses" (Information Hiding) for plugin paths, justified by the loopback guard.
  - Under "Known Limitations": the GUI binds every interface (`server.listen(port)` without a host), so routes without the loopback guard are reachable from the LAN.
  - The Error Codes tab is added to the known tab modules, and the config-tab integration points (`configDirty`, reset, cleanup, lazy load) are described for future tabs.
- `mcp-server/README.md`:
  - In Features, pluggable error-code allocation.
  - A short "Error codes" section linking to `docs/error-code-providers.md`.
  - Troubleshooting entries for `fallback_reason` values and plugin load errors.
- `mcp-server/changelog.md`: a WIP entry covering the tools, provider system, built-in providers, GUI tab, docs and tool registry.
- `personas/docs/agents/project-manifest/api-surface.md`: the new partial in the partials table, and both tools added to the 3-Dev column of the MCP Tool Allocation Matrix.
- `personas/changelog.md`: a WIP entry. Each of the three persona YAML files also gets an integrated changelog entry (steps 10–11).
- `docs/agents/project-manifest/cross-system-dependencies.md`: a new Dependency Table row, "Error-code tools". It ties `mcp-server/src/tools/error-codes.ts` (tool names, the `cwd_path` and `context` parameters, `temporary` semantics, `777` + six-digit format, `000000` placeholder) to `personas/shared/partials/error-code-generation.md` and the grants in `3-developer.yaml`, `developer.yaml` and `web-gui-specialist.yaml`.
- `docs/agents/project-manifest/live-workspace.md`: the live server now reads `~/.ai-insights/error-codes/config.json`, writes to `~/.ai-insights/error-codes/`, and loads plugins from `~/.ai-insights/plugins/error-codes/` at startup.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **The contract turns out to be missing something, forcing a break** | Request and context are extensible objects, provider hooks are optional, the failure taxonomy is coarse with free-text detail, and forward-compatibility rules are tested (AC-10). Built-ins and the example plugin exercise the contract on day one. `apiVersion: 2` with a v1 adapter is the planned escape hatch. |
| **A malicious or buggy plugin** | Trust is filesystem-only (`npm install` level), which is documented. A plugin that throws is contained (`failed`, then fallback). A failing plugin never blocks startup. A timeout aborts hung providers. The GUI cannot load code. |
| **A plugin hangs and ignores the abort signal** | The allocator races the provider promise against the timeout, falls back on expiry, and records it as ambiguous `unavailable`. The late result is discarded. A plugin that blocks the event loop synchronously cannot be interrupted in-process; the guide states this as part of the trust model rather than implying it is covered. |
| **A cross-site page, a LAN client or a DNS-rebinding attack abuses the unauthenticated GUI to exfiltrate a stored secret through the test route** | The test route merges stored secrets only when no non-secret field changed, whatever the field type, so no destination can be swapped. All new routes reject non-loopback `Host` and foreign `Origin` headers, and body routes require `application/json`. All three are covered by guard and handler tests, including a `string`-typed destination. The wider lack of authentication and the all-interfaces bind are recorded as known GUI limitations. |
| **Worktrees split a per-repository sequence and hand out duplicate bases** | `project-info.ts` resolves linked worktrees to the main repository root through `gitdir:` and `commondir`; a worktree fixture test asserts one sequence. Same-named unrelated clones remain a documented limit, with the `{repo}` counter file as the remedy. |
| **Users find the connection test asks for the password again after editing settings** | Deliberate trade-off for fail-closed secret handling. The form explains it when `secrets_merged` is false, and testing unchanged saved settings still needs no re-entry. |
| **The GUI form is inaccessible or inconsistent across generated fields** | One renderer with fixed rules (labels, `aria-describedby`, live region, password handling), AC-19 asserted in jsdom by `config-error-codes-view.test.ts`, and the user's browser pass for focus, themes, zoom and narrow viewports (Human Action 4). |
| **A project-local counter file leaves lock artefacts in the repository** | The `file` provider always locks `ctx.data_dir`, never the counter file's directory (AC-23, tested). The only file it writes inside a repository is the configured counter file. |
| **Secrets leak** | Secret fields are declared, so redaction and public projection are generic. Logs go through the redacting logger, the config file is `0600`, and sentinel tests cover every output path. |
| **An ambiguous failure causes a double-issued code** | No retry after ambiguous failures; fall back instead. At most one remote number goes unused, never duplicated. |
| **The two processes see different plugin sets** | Both load from the same directory at startup. The GUI shows its own load errors and a restart hint. Settings are read from the file on every call. |
| **The `file` provider collides across machines** | Documented: it is unique per machine and user. A `{repo}` counter file committed to the repository can cause merge conflicts, which is documented as a trade-off; remote providers cover cross-machine needs. |
| **Agents leave temporary codes in shipped code** | The response instruction requires a `TEMPORARY ERROR CODE` marker. Codes are logged with context and repository, the list tool and GUI list expose them, and the persona partial requires reporting them. |
| **11-digit component codes from temporary bases overflow 32-bit integers** | Documented in the help text and the guide. Temporary codes are meant to be short-lived. |
| **Registry refactor breaks startup or drops a tool** | The completeness test runs against a source scan, and the schema-integrity test then covers every module. |
| **Narrow per-tool grants fail the parity validator** | Mirror `ledger-synthesis-maintainer.yaml`. Step 12 runs the build with `--strict`. |

## Recommended Workflow
- **Workflow:** ledger
- **Rationale:** The plan introduces a versioned plugin system that loads code at runtime, handles secrets, integrates with an external HTTP service, and spans the MCP server, the GUI, the personas and cross-system docs. It needs formal QA, security-audit and architectural review stages.
