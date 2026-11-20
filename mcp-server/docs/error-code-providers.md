# Error-Code Providers

How the Ledger MCP server allocates error-code base numbers, and how to write your own provider.

## What This Is

Agents call the `ledger_generate_error_code` MCP tool to get a new error-code base number for a class or module that throws coded exceptions — a base such as `42`, used as `4201`, `4202`, … for the exceptions it introduces, in the order they are added. Where that base number actually comes from is pluggable: a **provider** is the thing that hands out the next value. The server ships two built-in providers and loads any number of third-party ones you install yourself.

## How Providers Are Selected and Configured

- The GUI's **Error Codes** settings tab is the only place a provider is selected or configured. Neither `ledger_generate_error_code` nor any other MCP tool lets an agent choose or configure a provider — that is deliberate: the choice of destination, and any credentials it needs, is the user's own.
- The active provider's id is stored in `~/.ai-insights/error-codes/config.json` as `active_provider` (`"file"` by default — no setup required). Each provider's own settings are stored in the same file, under `providers.<id>`.
- Every allocation call re-reads this file from disk — there is no cache and no watcher, so a change saved in the GUI takes effect on the very next call, in both the MCP server and GUI server processes.
- A `temporary_prefix` (`"777"` by default), a `timeout_ms`, and a retry policy (`retry.default_wait_ms`, `retry.max_wait_ms`) are also stored here and apply to every provider uniformly — see "Outcome Taxonomy and Retry Policy" below.

## The Built-In Providers

| id | Label | What it does |
|----|-------|---------------|
| `file` | File (built-in, zero setup) | Keeps a sequence in a locked local JSON file. Scoped either **globally** (one sequence, named by "Counter Name") or **per repository** (one sequence per repository, keyed by its folder name). `counter_file` can point anywhere, including inside the repository itself via a `{repo}` placeholder. |
| `errorcode-incrementor` | Errorcode Incrementor (HTTP) | Allocates from a self-hosted Errorcode Incrementor counter service over HTTP (`GET {base_url}?pw={password}&counter={counter}[&increment=yes]`). The service's URL, password, and counter name are your own settings — never stored in this repository. |

Both are implemented entirely against the same contract documented below (`src/error-codes/providers/file-provider.ts`, `src/error-codes/providers/errorcode-incrementor-provider.ts`) — reading either is a good second reference alongside the example plugin in `docs/examples/error-code-provider-example/`.

## Writing a Plugin

### Where a Plugin Lives, and When It's Loaded

Drop your plugin into `~/.ai-insights/plugins/error-codes/`. Each top-level entry there is either:

- a `*.mjs` or `*.js` file whose **default export** is the provider object, or
- a **folder**, so your plugin can carry its own `node_modules`. The entry module is the folder's `package.json` `main` field when present, otherwise `index.mjs`. (A `package.json` `exports` map — conditions, subpaths — is **not** resolved; a folder with neither `main` nor `index.mjs` is reported as a load error that says so.)

A **symbolic link** in that directory is followed: a link to a `*.mjs`/`*.js` file or to a folder loads like the file or folder itself (the file-extension check uses the link's own name, and the plugin is reported under the link path). A link whose target is missing or unreadable is reported as a load error (`symbolic link target is missing or unreadable`) naming the link, rather than skipped silently. This makes it easy to link a plugin under development into the directory. On Windows, creating a file symlink needs Developer Mode or elevated rights; a directory junction does not.

The plugin directory is scanned once, at process startup, by both the MCP server and the GUI server independently (each calls `initProviderRegistry()` against the same directory). **A newly added or edited plugin is not picked up until both processes are restarted.** A plugin that fails to load — a syntax error, a thrown error during module evaluation, an invalid provider shape, or an `id` clashing with another already-loaded plugin — is recorded as a load error and skipped; it never stops the rest of the directory from loading, and never stops either server from starting. A plugin `id` that clashes with a **built-in** provider's id is also rejected (the built-in keeps working under that id) — this is checked separately from the plugin-vs-plugin clash above.

### The Contract

A provider is a plain object — no base class, no import required from this repository's own code:

```typescript
interface ErrorCodeProvider {
  apiVersion: 1;
  id: string;        // must match /^[a-z][a-z0-9-]{1,47}$/ — the config key and the active_provider value
  label: string;      // shown in the GUI's provider selector
  description?: string;
  settings: SettingField[];   // declarative settings descriptors — see below
  allocate(request: AllocationRequest, ctx: ProviderContext): Promise<AllocationOutcome>;
  peek?(request: AllocationRequest, ctx: ProviderContext): Promise<AllocationOutcome>;
  test?(ctx: ProviderContext): Promise<TestOutcome>;
}
```

- **`allocate`** is the only required hook: it allocates and returns the next value, consuming it.
- **`peek`** (optional) returns the value the next `allocate` call would return, **without** consuming it. When present, the GUI's "Test connection" button falls back to calling it (with a repository-free, context-free `AllocationRequest`) when `test` is absent.
- **`test`** (optional) is a lightweight connectivity/credentials check with no allocation side effect at all — prefer implementing this over relying on the `peek` fallback whenever a real connection check (e.g. a backend health endpoint) is cheaper or safer than a real `peek`. When neither hook is present, the GUI reports "offers no connection test" rather than calling `allocate`.

`request_id` on `AllocationRequest` is a UUID, provided for your own logging/idempotency only — the core never uses it to detect duplicates. `request.repository` is `null` unless the caller's `cwd_path` resolved inside a git repository (see "Repository Scoping" below). Your provider **must ignore unknown fields** on `request` and `ctx` — a future additive field must never break an existing provider that does not read it (see "Stability Rules" below).

### Settings Field Types

One `settings: SettingField[]` array drives three things at once: runtime validation, the GUI's generated settings form, and secret masking/redaction. Every field needs a unique `key` and a `label`; most also take a `description` shown in the GUI.

| `type` | Extra fields | Notes |
|--------|--------------|-------|
| `'string'` | `required?`, `default?`, `placeholder?` | Plain text. |
| `'path'` | same as `'string'` | Semantically a filesystem path — rendered the same as `'string'`, documented separately so the GUI can offer a file-picker affordance later without a breaking change. |
| `'url'` | `required?`, `default?`, `placeholder?` | See "The `url` Scheme Rule" below — `https://` is always accepted, `http://` only for a loopback host. |
| `'secret'` | `required?` | Never echoed back to the GUI as a raw value — rendered as `{ set: boolean }`, and redacted out of every log line and error detail your provider's text ever reaches. |
| `'integer'` | `required?`, `default?`, `min?`, `max?` | |
| `'boolean'` | `default?` | |
| `'select'` | `options: { value, label }[]` (non-empty, required), `default?` | A fixed set of choices, rendered as a dropdown. |

A field's `default`, when declared, is applied automatically wherever the core reads your settings — you never need to apply it yourself inside `allocate`/`peek`/`test`.

### Outcome Taxonomy and Retry Policy

`allocate`/`peek` return an `AllocationOutcome`:

```typescript
type AllocationOutcome =
  | { ok: true; value: number }
  | {
      ok: false;
      reason: 'throttled' | 'misconfigured' | 'unavailable' | 'rejected' | 'invalid_response' | 'failed';
      ambiguous?: boolean;     // true when you cannot say whether the operation actually completed
      retry_after_ms?: number; // for reason: 'throttled' only
      detail?: string;         // free text; always redacted of your configured secrets before it leaves the core
    };
```

This taxonomy is deliberately coarse — it encodes only what the core's retry/fallback policy needs: wait and retry, fix the configuration, or fall back to a temporary code. Provider-specific nuance belongs in `detail`, never as a new `reason` value (the core treats any unrecognised `reason` string as `failed`).

- `ok: true` with a non-positive or non-safe-integer `value` is treated as `invalid_response` — you never need to validate your own return value's range.
- On `throttled` (and only when not `ambiguous`), the core waits once for `min(retry_after_ms ?? retry.default_wait_ms, retry.max_wait_ms)` and retries your `allocate` exactly once. A second failure of any kind falls back to a temporary code.
- `ambiguous: true` means the core never retries — retrying an ambiguous failure risks allocating two codes for one request, so it falls back to a temporary code instead.
- Every other failure (including an uncaught throw from your code, or an abort via `ctx.signal` once `timeout_ms` elapses) falls back to a temporary code without ever calling your provider a second time.

Your provider is **never** responsible for retry, timeout enforcement, or redaction — all of that lives in the core allocator (`src/error-codes/allocator.ts`), not in providers, so a plugin cannot get it wrong and a future policy change never touches this contract.

### Stability Rules (`apiVersion: 1`)

- Within `apiVersion: 1`, every change the core ever makes to this contract is **additive**: new optional request fields, context members, provider hooks, and setting-field types. Nothing required is ever added, and nothing is ever removed or renamed.
- There is no `capabilities` bag and no `ctx.api_version` — a hook's presence (`typeof provider.peek === 'function'`) already says what a capability flag would, and your provider declares its own `apiVersion`.
- A breaking change would require `apiVersion: 2`, with the core still loading `apiVersion: 1` providers through an adapter. In practice: a plugin written against this guide today keeps working unmodified for the lifetime of `apiVersion: 1`.

## The Trust Model

Installing a plugin means putting code at `~/.ai-insights/plugins/error-codes/` — the same trust level as `npm install`. The GUI never writes to, or loads code from, any other path; only the plugin loader, scanning this one fixed directory at startup, ever imports plugin code. There is no sandboxing: a plugin runs with the same privileges as the server process itself.

### Trust-Model Limits

- **Each plugin import has a 10-second timeout.** A plugin whose module never finishes evaluating (for example a top-level `await` that never settles) is recorded as a load error (`import timed out after 10000 ms`) and skipped, so it cannot block server startup indefinitely. The budget is per plugin and plugins load one after another, so the worst-case startup delay is (number of hanging plugins) × 10 s. Each timeout is logged to stderr against the plugin's path: fix or remove the plugin named in the error. The import cannot be cancelled — a timed-out module may keep evaluating in the background, though it is never registered — and a plugin that blocks the event loop synchronously at the top level cannot be interrupted at all.
- **Synchronous event-loop blocking is not interruptible.** `ctx.signal` (an `AbortSignal` that fires after `timeout_ms`) only helps if your code passes it to asynchronous I/O (e.g. `fetch(url, { signal: ctx.signal })`). A provider that blocks the event loop synchronously — a long synchronous loop, a synchronous `fs` call on a huge file — cannot be interrupted by the timeout at all; it will simply make the whole server process unresponsive for as long as it runs. Always prefer asynchronous I/O.
- **"Test connection" runs your plugin's code inside the GUI process, not just the MCP server.** `POST /api/error-codes/test` calls your `test` (or falls back to `peek`) from the GUI's own HTTP server process. A plugin that crashes or blocks during a connection test therefore affects the GUI, not only the MCP server — the same code-trust caveat above applies there too.

## Repository Scoping

`request.repository`, when non-null, identifies the **main** repository checkout for the caller's `cwd_path` — resolved without shelling out to `git`. Two consequences worth knowing before you key a sequence by it:

- **Every linked worktree of one repository resolves to the same `repository.root_path` and `repository.folder_name`.** A sequence scoped by repository (as the built-in `file` provider's "Per repository" scope does, keyed by `folder_name`) is therefore never split across a repository's own worktrees — allocating from a worktree and from its main checkout draws from the same sequence.
- **Two different, unrelated repositories that happen to share the same folder name share one sequence**, because scoping by `folder_name` alone cannot distinguish them. If that matters for your use case, key your sequence by `repository.root_path` instead (the full, unambiguous path) — or, following the built-in `file` provider's own escape hatch, let your settings carry a `{repo}` placeholder that expands to `repository.root_path` so the counter file itself lives inside each distinct repository and therefore can never collide.

## The GUI's Connection-Test Secret Rule

`POST /api/error-codes/test` is the one place the server combines a provider's **stored** secrets with **client-supplied** settings from the GUI's (possibly not-yet-saved) edit form. It does so under a fail-closed rule (`mergeSettingsForTest`, `src/error-codes/settings-schema.ts`): a stored secret is merged into the settings actually tested **only when every non-secret field — of any type, not only a `url` field — equals its stored value**. If anything else about the settings changed, the incoming settings are tested exactly as given (including any newly-typed secret), and the stored secret is never reused. This exists so that editing, say, a host field and clicking "Test" before saving can never accidentally test the *old* destination with the *old* password reused against it.

This rule lives in the core, not in any provider — you never need to implement it yourself, and a plugin cannot opt out of it.

## The Loopback-Only Restriction

Every `/api/error-codes/*` route in the GUI server is guarded by `requireLoopbackRequest` (`gui/route-guards.ts`), which checks three things in order: the request's actual TCP connection (`req.socket.remoteAddress`) must itself be loopback — this is the primary, non-spoofable check, since a client cannot forge which socket the OS handed the server; then `Host` must be a loopback address; then, when an `Origin` header is present, it must also resolve to a loopback hostname at the GUI's own listening port. The socket-level check is what stops a direct, non-browser client elsewhere on the network (the GUI server binds every network interface, not just loopback, so `Host`/`Origin` alone would be fully attacker-controlled on such a client); the `Host`/`Origin` checks stop a hostile web page's cross-origin fetch from a browser on the same machine, whose `remoteAddress` is genuinely loopback. This matters to you as a plugin author only indirectly: together, these three checks are what stand between an attacker and the ability to trigger your plugin's `test`/`peek`/`allocate` at all.

## The `url` Scheme Rule

A `'url'`-typed setting field is validated by the core, not by your provider: `https://` is always accepted; `http://` is accepted **only** when the host is a loopback address (`localhost`, `127.0.0.1`, `[::1]`). Every other scheme, and every other `http://` host, is rejected outright — a password configured on a `url` field can therefore never be sent in plain text across a real network, regardless of what your provider's own code does with the value afterward.

## The Example Plugin

`docs/examples/error-code-provider-example/` is a complete, working folder plugin — `package.json` (declaring `main: "index.mjs"`) and `index.mjs` — implementing a simple JSON-file counter using nothing but Node's own `fs`/`path` modules. It is loaded by the server's real `loadPluginProviders()` in `tests/error-codes/plugin-loader.test.ts` and validated by the real `validateProvider()` in `tests/error-codes/provider-validation.test.ts`, so this guide's description of it cannot drift out of sync with what actually loads. Copy it as your plugin's starting point.
