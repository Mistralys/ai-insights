# Public API Surface — MCP Server GUI

---

## 1. Backend REST API

All routes are prefixed with `/api`. Response envelope on success: raw JSON value. Error envelope: `{ error: { code, message } }`.

### Error Codes → HTTP Status

| Code | Status |
|------|--------|
| `NOT_FOUND` | 404 |
| `FORBIDDEN` | 403 |
| `VALIDATION_ERROR` | 400 |
| `CONFLICT` | 409 |
| `PAYLOAD_TOO_LARGE` | 413 |
| `UNSUPPORTED_MEDIA_TYPE` | 415 |
| *(unhandled)* | 500 |

---

### 1.1 Projects

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| `GET` | `/api/projects` | `handleListProjects` | Paginated list with filtering, sorting, search. |
| `GET` | `/api/projects/:repo/:slug` | `handleGetProject` | Full project detail (root index + meta). |
| `GET` | `/api/projects/:repo/:slug/plan` | `handleGetPlanDocument` | Plan Markdown content. |
| `GET` | `/api/projects/:repo/:slug/synthesis` | `handleGetSynthesisDocument` | Synthesis Markdown content. |
| `GET` | `/api/projects/:repo/:slug/health` | `handleGetProjectHealth` | Health summary. |
| `GET` | `/api/projects/:repo/:slug/run-metadata` | `handleGetRunMetadata` | `.orchestrator-run.json` sidecar. |
| `GET` | `/api/projects/:repo/:slug/work-packages` | `handleListWorkPackages` | All WPs for a project. |
| `GET` | `/api/projects/:repo/:slug/work-packages/overview` | `handleGetWorkPackageOverview` | Aggregate WP status summary. |
| `GET` | `/api/projects/:repo/:slug/work-packages/:wpId` | `handleGetWorkPackage` | Single WP detail. |
| `GET` | `/api/projects/:repo/:slug/dialogues` | `handleListDialogues` | Dialogue file list (optional `?wp=` filter). |
| `GET` | `/api/projects/:repo/:slug/dialogues/:filename` | `handleGetDialogueFile` | Single dialogue content. |
| `GET` | `/api/projects/:repo/:slug/chunks` | `handleListChunks` | Chunk file list (optional `?wp=` filter). |
| `GET` | `/api/projects/:repo/:slug/chunks/:filename` | `handleGetChunkFile` | Raw chunk JSONL content. |
| `GET` | `/api/projects/:repo/:slug/chunks/:filename/rendered` | `handleGetChunkFile` + `renderChunksToDialogue` / `renderChunksToStructured` | Rendered chunk. Without `?format=structured`: Markdown string (`{ content }`) — compact chat-like format, plain paragraphs, per-tool summaries. With `?format=structured`: JSON array (`{ blocks: DialogueBlock[] }`) for interactive frontend rendering. |
| `GET` | `/api/projects/:repo/:slug/chunks/:filename/text` | `handleGetChunkText` | Prose-only extraction via `renderChunksToText()`. Returns `{ content: string }` — AI text turns only, no tool-call JSON, no tool results. Single-namespace: flat prose. Dual-namespace: `## Outer Agent` / `## Inner Agent` sections. |
| `GET` | `/api/projects/:repo/:slug/runs` | `handleListRunLogs` | Orchestrator run log file list. |
| `GET` | `/api/projects/:repo/:slug/runs/:filename` | `handleGetRunLog` | Log entries (supports `?after=N` for streaming). |
| `DELETE` | `/api/projects/:repo/:slug` | `handleDeleteProject` | Permanently delete a project. |
| `PATCH` | `/api/projects/:repo/:slug` | `handleRenameProject` | Rename title or slug. Body: `{ title?: string, slug?: string }`. |
| `POST` | `/api/projects/:repo/:slug/archive` | `handleArchiveProject` | Set status to ARCHIVED. |
| `POST` | `/api/projects/:repo/:slug/unarchive` | `handleUnarchiveProject` | Restore from ARCHIVED. |
| `POST` | `/api/projects/:repo/:slug/complete` | `handleMarkProjectComplete` | Mark project COMPLETE. |
| `POST` | `/api/projects/:repo/:slug/reset` | `handleResetProject` | Reset project (dry_run or apply). Body: `{ dry_run: boolean, decisions?: [] }`. |

#### GET /api/projects Query Parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `page` | number | 1 | Page number (1-indexed). |
| `limit` | number | 50 | Items per page (max 200). |
| `status` | string | `'ACTIVE'` | `'ACTIVE'`, `'ALL'`, or a specific status value. |
| `search` | string | — | Case-insensitive substring match on slug, name, repo. |
| `sort` | string | `'last_updated'` | Column: `project`, `repository`, `status`, `total_work_packages`, `done`, `date_created`, `last_updated`, `runner`, `duration` (orders by `active_ms` — the project-wide sum of completed-pipeline durations, not the wall-clock `duration_ms`). |
| `dir` | string | `'desc'` | `'asc'` or `'desc'`. |
| `runner` | string | — | Filter: `'orchestrator'`, `'vscode'`, `'claude-code'`, `'unknown'`. |

#### GET /api/projects Response Envelope (`ProjectListEnvelope`)

```typescript
{
  projects: ProjectSummary[];
  total: number;
  page: number;
  limit: number;
  total_pages: number;
  status_counts: Record<string, number>;
  runner_counts: Record<string, number>;
}
```

---

### 1.2 Orchestrator

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| `GET` | `/api/orchestrator/queue` | `handleGetOrchestratorQueue` | Current queue entries with effective status. |
| `GET` | `/api/orchestrator/run-status/:filename` | `handleGetRunStatus` | Status from a specific log file. |
| `POST` | `/api/orchestrator/start` | `handleOrchestratorStart` | Run preflight + spawn orchestrator. Body: `{ planPath, dryRun?, resumeThreadId? }`. |
| `POST` | `/api/orchestrator/kill/:id` | `handleOrchestratorKill` | SIGTERM → SIGKILL escalation. |
| `POST` | `/api/orchestrator/dismiss/:id` | `handleOrchestratorDismiss` | Remove dead entry from queue. Returns 204. |

---

### 1.3 Knowledge

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| `GET` | `/api/knowledge` | `handleListKnowledge` | List/search insights. Query: `?scope&category&tags&repository_name&query&limit&offset`. |
| `PATCH` | `/api/knowledge/:id` | `handleUpdateKnowledge` | Update insight fields. Body validated by `KnowledgeUpdateBodySchema`. |
| `DELETE` | `/api/knowledge/:id` | `handleDeleteKnowledge` | Delete insight. Query: `?scope&repository_name`. |
| `POST` | `/api/knowledge/:id/promote` | `handlePromoteKnowledge` | Promote repository insight to global. Query: `?scope&repository_name`. |
| `POST` | `/api/knowledge/:id/move` | `handleMoveKnowledge` | Move insight between stores. Body validated by `KnowledgeMoveBodySchema`. |

---

### 1.4 Model Registry

All routes are handled by `api-models.ts` and are registered in the declarative `buildRoutes()` table — dispatched by `dispatchRoute()` along with every other API route.

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| `GET` | `/api/models` | `handleGetModels` | Returns model list. Auto-initializes `local.json` from `default.json` on first access. |
| `PUT` | `/api/models` | `handleSaveModels` | Bulk-save the model list. Auto-assigns UUIDv4 to entries without `id`. Returns 409 when a deletion would remove a referenced model. |
| `POST` | `/api/models/load-defaults` | `handleLoadDefaults` | Merge `default.json` into `local.json` without overwriting existing entries. Returns `{ models, conflicts }`. |

#### PUT /api/models Request Body

Array of model entries validated by `SaveModelsBodySchema`:

```typescript
Array<{
  id?: string;          // UUIDv4 — omit to auto-assign
  name: string;         // Display name (min 1 char)
  slug: string;         // Lowercase kebab-case (regex: /^[a-z0-9]+(-[a-z0-9]+)*$/)
  cc_model?: string;    // Claude Code model identifier (default: "inherit")
}>
```

**Validation rules:**
- Duplicate `slug` values → 400
- Reserved slug `"inherit"` on a non-sentinel entry → 400
- Removing a model that is referenced in assignments → 409 with `referencedModels` details (user must use Replace Model first)

#### PUT /api/models Response

```typescript
// Success
{ models: ModelEntry[] }

// 409 Conflict (referenced model deletion blocked)
{
  conflict: true;
  referencedModels: Array<{ model: ModelEntry; usages: string[] }>;
}
```

---

### 1.5 Model Assignments

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| `GET` | `/api/model-assignments` | `handleGetAssignments` | Returns assignments enriched with `stale` boolean. |
| `PUT` | `/api/model-assignments` | `handleUpdateAssignments` | Validate and persist assignments. Returns 400 when `name-mapping.json` is absent or invalid. |
| `POST` | `/api/model-assignments/replace` | `handleReplaceAssignedModel` | Swap all occurrences of `old_model_id` with `new_model_id`. Returns 400 for same-model swap or unreferenced source. |

#### GET /api/model-assignments Response

```typescript
{
  default_model_uuid?: string;              // Optional global default
  persona_models: Record<string, string>;   // Persona ID → model UUID
  stale: boolean;                           // See staleness rules below
}
```

**Staleness rules for `stale`:**

| Condition | `stale` |
|-----------|---------|
| `max(mtime(assignments.json), mtime(local.json))` > `mtime(name-mapping.json)` | `true` — rebuild needed |
| Neither `assignments.json` nor `local.json` exist | `false` — no user changes yet |
| `name-mapping.json` does not exist | `false` — no build output to compare |
| Only `default.json` is newer than `name-mapping.json` | `false` — Git checkout mtime, not a user change |

#### PUT /api/model-assignments Request Body

```typescript
{
  default_model_uuid?: string;             // Must exist in model registry if provided
  persona_models: Record<string, string>;  // Key: persona id from name-mapping.json; Value: model UUID
}
```

**Validation rules:**
- `name-mapping.json` must exist → 400 if absent
- All persona keys in `persona_models` must appear as `id` values in `name-mapping.json` → 400 if invalid
- All model UUIDs (including `default_model_uuid`) must exist in the registry → 400 if not found

#### POST /api/model-assignments/replace Request Body

```typescript
{ old_model_id: string; new_model_id: string }  // Both must be UUIDs in registry
```

**Rejection conditions (400):**
- `old_model_id === new_model_id` — "Source and target models must be different"
- `old_model_id` not referenced in any assignment — "Model is not referenced in any current assignment"

---

### 1.6 Personas

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| `GET` | `/api/personas` | `handleGetPersonas` | Returns all entries from `name-mapping.json`, or empty array if file absent. Returns 400 if file is malformed JSON. |
| `POST` | `/api/personas/rebuild` | `handleRebuildPersonas` | Spawns `node scripts/build-personas.js`. Returns 409 when a build is already in progress. |

#### GET /api/personas Response

Array of `PersonaEntry` objects:

```typescript
interface PersonaEntry {
  id: string;          // Persona identifier — use as key in PUT /api/model-assignments
  role: string;        // Human-readable display name
  suite: string;       // Persona suite (e.g. "ledger", "standalone")
  model?: string;      // Resolved model name (populated after build)
  model_slug?: string; // Matching ModelEntry.slug in local registry
  cc_model?: string;   // Effective Claude Code model identifier
  number?: number;     // Display ordering index within the suite
}
```

Optional fields are only populated after WP-003 is implemented and a build has run.

#### POST /api/personas/rebuild Response

```typescript
// Exit code 0
{ success: true; output: string }

// Non-zero exit code → HTTP 500
{ success: false; output: string; exitCode: number }

// Build already running → HTTP 409
{ error: { code: 'CONFLICT'; message: string } }
```

The `buildInProgress` module-level flag prevents concurrent builds. It is cleared in a `finally` block so process errors never leave the guard permanently set.

---

### 1.7 Configuration & Server Info

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| `GET` | `/api/config` | `handleGetConfig` | Current GUI configuration. |
| `PUT` | `/api/config` | `handleUpdateConfig` | Update GUI configuration. Body validated by `GuiConfigPartialSchema`. |
| `GET` | `/api/server-info` | *(inline)* | Boot vs disk versions + stale flag. |

---

### 1.8 Stores

All handlers live in `gui/api-stores.ts`. Literal-path routes precede parameterized `:storeId` routes to prevent shadowing. All write handlers call `reloadStoreContext()` after a successful `saveStoresConfig()`.

**Section A — body-parsing routes:**

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| `POST` | `/api/stores` | `handleAddStore` | Add a new store. Creates directory + empty `.repositories.json`. |
| `POST` | `/api/stores/import` | `handleImportStore` | Import an existing directory as a store. Preserves any existing `.repositories.json`. |
| `PUT` | `/api/stores/order` | `handleReorderStores` | Reorder stores. Body: `{ order: string[] }`. |
| `PUT` | `/api/stores/:storeId` | `handleUpdateStore` | Update store label. Body: `{ label?: string }`. |

**Section B — body-free routes:**

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| `DELETE` | `/api/stores/:storeId` | `handleRemoveStore` | Remove store from config (does NOT delete directory). |
| `POST` | `/api/stores/:storeId/default` | `handleSetDefaultStore` | Set default store. |
| `GET` | `/api/stores/conflicts` | `handleGetStoreConflicts` | Cross-store registry conflicts. Returns `RegistryConflict[]`; `[]` in legacy mode. |
| `GET` | `/api/stores` | `handleGetStoresEnriched` | Enriched store list. Returns `StoreListItem[]`; synthesized single entry in legacy mode. |

#### `StoreListItem` — Response Shape

Defined in `src/schema/store-config.ts`:

```typescript
interface StoreListItem {
  id: string;               // Store identifier
  label: string;            // Display name (falls back to id when StoreEntry.label is absent)
  path: string;             // Absolute path to the store's ledger root
  project_count: number;    // Number of projects in this store
  repository_count: number; // Number of registered repositories in this store
  is_default: boolean;      // true when this store is the default_store in stores.json
  is_git: boolean;          // true when the store path contains a .git directory
  ahead?: number;           // Local commits ahead of remote (only when is_git && upstream configured)
  behind?: number;          // Remote commits not yet pulled (only when is_git && upstream configured)
  sync?: StoreSyncMeta;     // Informational sync metadata; undefined when absent
}
```

> **is_git invariant:** When `is_git` is `false`, both `ahead` and `behind` are `undefined`. Git detection per store runs concurrently via `Promise.all` with a 5-second timeout per call. When `git` is not installed (`ENOENT`), all stores get `is_git: false`.

#### `POST /api/stores` Validation Rules

Body: `{ id: string, path: string, label?: string }`

| Rule | Error |
|------|-------|
| ID must match `SLUG_REGEX` | 400 |
| ID must not be `"import"`, `"order"`, or `"conflicts"` (reserved) | 400 |
| Duplicate ID | 400 |
| Duplicate expanded path | 409 |
| `path` must be absolute (`/` or `~/`) — relative paths rejected | 400 |
| `label`, if provided, must be non-empty after trimming | 400 |
| Directory creation fails (`EACCES`/`EPERM`) | 500 |

#### `POST /api/stores/import` Validation Rules

Same rules as `POST /api/stores`, plus: the target directory **must already exist** (400 if absent). Never overwrites an existing `.repositories.json`. Returns `warning` in the response when the existing file fails schema validation.

#### `PUT /api/stores/order` Validation Rules

Body: `{ order: string[] }` — must contain exactly the current store IDs, no duplicates, no omissions (length check prevents `['a','a','b']` from passing a set-based comparison against `['a','b']`).

#### Response Shapes

| Handler | Success Response |
|---------|-----------------|
| `handleGetStoresEnriched` | `StoreListItem[]` |
| `handleAddStore` | `StoreListItem[]` |
| `handleImportStore` | `{ stores: StoreListItem[], warning?: string }` |
| `handleUpdateStore` | `StoreListItem[]` |
| `handleRemoveStore` | `{ stores: StoreListItem[], warned: boolean }` — `warned: true` when removed store had registered repositories |
| `handleSetDefaultStore` | `StoreListItem[]` |
| `handleReorderStores` | `StoreListItem[]` |
| `handleGetStoreConflicts` | `RegistryConflict[]` |

---

### 1.9 Error Codes

All handlers live in `gui/api-error-codes.ts`. Every route carries the `requireLoopbackRequest` guard (`gui/route-guards.ts`); the two body-carrying routes additionally carry `requireJsonContentType`. These routes reach third-party provider plugin code and the user's own stored secrets — see `constraints.md` → §7 "Request-Level Guards — Loopback-Only, JSON-Only, Fail-Closed Secret Merge" for why they are guarded rather than relying on the response-only CORS header the rest of the server sends. `GET /api/error-codes/providers` and `GET /api/error-codes/config` are safe to poll; `POST /api/error-codes/test` never calls a provider's `allocate`.

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| `GET` | `/api/error-codes/providers` | `handleListErrorCodeProviders` | Lists every registered provider (built-in and plugin), the scanned plugin directory, and any plugin load errors. |
| `GET` | `/api/error-codes/config` | `handleGetErrorCodeConfig` | The allocator's config, with every secret masked to `{ set: boolean }`. Uses `readErrorCodeConfig()` (not `loadErrorCodeConfig()`), so a `warning` for a salvaged/corrupt/unreadable `config.json` reaches this response instead of only stderr. |
| `PUT` | `/api/error-codes/config` | `handleUpdateErrorCodeConfig` | Updates top-level config fields and/or one provider's settings. |
| `POST` | `/api/error-codes/test` | `handleTestErrorCodeProvider` | Connection-tests a provider's settings without allocating a code. |
| `GET` | `/api/error-codes/temporary` | `handleListTemporaryErrorCodesGui` | Logged temporary codes, newest-first, capped by `?limit` (default 200). Response `{ entries, warning? }`; `warning` is passed through unchanged when the log is corrupt (the entries are then the recoverable ones). |

#### `ProviderListItem` — `GET /api/error-codes/providers` Response Shape

```typescript
interface ProviderListItem {
  id: string;
  label: string;
  description?: string;
  settings: SettingField[];     // descriptors only — never a settings value
  supports_test: boolean;       // true when the provider offers test or peek
  source: 'builtin' | 'plugin';
  path?: string;                // present only for source: 'plugin' — a deliberate, loopback-guarded exception to "no internal paths in responses"
}
```

Full response: `{ providers: ProviderListItem[], plugin_dir: string, load_errors: { source: string, message: string }[] }`.

#### `ErrorCodeConfigResponse` — `GET`/`PUT /api/error-codes/config` Response Shape

```typescript
interface ErrorCodeConfigResponse {
  active_provider: string;
  temporary_prefix: string;
  timeout_ms: number;
  retry: { default_wait_ms: number; max_wait_ms: number };
  providers: Record<string, Record<string, unknown>>; // secret fields rendered as { set: boolean }; only currently-registered providers appear
  warning?: string; // GET only — see below
}
```

`PUT` body: `{ active_provider?, temporary_prefix?, timeout_ms?, retry?, provider_id?, settings?, clear_secrets? }` — `temporary_prefix` must match `TemporaryPrefixSchema` (`src/error-codes/config-store.ts`: 1–6 digits, no leading zero); any other value is a `400 VALIDATION_ERROR` whose `error.message` is built by `describeZodIssues()` (`src/gui/errors.ts`) and names the failing field (e.g. `temporary_prefix: …`) plus the schema's own message — `details` (the raw Zod issues, which can carry the received value) never reaches the wire, only `message` does — and nothing is written. `settings`/`clear_secrets` apply only when `provider_id` is present and names a currently-registered provider; an absent/empty secret in `settings` keeps the stored value, a key listed in `clear_secrets` clears it. An uninstalled provider's stored settings are left untouched by any update that does not target its `provider_id`, which is how they survive the round trip — but omitted from the response, since this route has no settings descriptors to mask their secrets safely.

**`warning`** is present only on the `GET` response, and only when `config.json` needed salvage or could not be used as stored (`src/error-codes/config-store.ts`'s `readErrorCodeConfig()`): absent for a missing or valid file; for a salvaged config it names the invalid field paths only (never a value); for a corrupt or unreadable file it is the same fixed, already-sanitized classification reason the server's stderr line would carry (never the raw JSON-parser message, which would quote file content holding secrets). The `PUT` response (`handleUpdateErrorCodeConfig`) never carries a `warning` — a successful save has just written a fully-validated `config.json`, so there is nothing left to salvage — and the Error Codes tab's own save handler relies on this to clear its banner (see `config-error-codes.js`'s `ecConfigWarning` below).

#### `POST /api/error-codes/test` Body and Response

Body: `{ provider_id: string, settings?: Record<string, unknown> }`.

Response: `{ supported: boolean, secrets_merged: boolean, ok?: boolean, reason?: string, detail?: string, value?: number, message?: string }`. `supported: false` (with `message`) when the provider offers neither `test` nor `peek` — `allocate` is never called by this route. `secrets_merged` is `true` only when every non-secret setting field equals its stored value (see `mergeSettingsForTest` in `src/error-codes/settings-schema.ts`) — any other difference tests the incoming settings only, so a changed destination is never tested with a password meant for a different one.

#### `GET /api/error-codes/temporary` Query Parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | number | 200 | Maximum entries returned, newest-first. Must be a positive integer. |

---

## 1.X Server-side TypeScript Modules

### `chunk-accumulator.ts` — Shared accumulation layer

Pure-function module. No I/O, no side effects, no imports from `mcp-server/src/`. All exports are named.

#### Types

| Export | Kind | Description |
|--------|------|-------------|
| `JsonValue` | `type` | Raw JSON value accepted in chunk payloads. |
| `ToolCallChunk` | `interface` | Single tool-call fragment from an `AIMessageChunk`. Fields: `index?`, `id?`, `name?`, `args?`. |
| `MergedToolCall` | `interface` | Accumulated tool call (after merging). Fields: `id`, `name`, `args`. |
| `ContentBlock` | `interface` | Content block (text or non-text). Fields: `type`, `text?`, index signature. |
| `MergedMessage` | `interface` | Merged/reconstructed message. Fields: `type`, `id`, `content`, `tool_calls`, `usage_metadata`, `tool_call_id?`. |
| `NamespaceKey` | `type` | `string` — `""` for main agent, `"subgraph/node"` for sub-agents. |

#### Functions

| Export | Signature | Description |
|--------|-----------|-------------|
| `chunkId` | `(chunk: Record<string, JsonValue>) → string` | Extracts the stable `id` field from a chunk payload. |
| `chunkType` | `(chunk: Record<string, JsonValue>) → string` | Returns the `type` field from a chunk payload. |
| `mergeContent` | `(acc, incoming) → string \| ContentBlock[]` | Merges a new content value into an accumulated content value (string concat or block-list merge). |
| `mergeToolCallChunks` | `(acc: Map<number, MergedToolCall>, chunks: ToolCallChunk[]) → void` | Merges `tool_call_chunks` fragments into an accumulator map keyed by index. |
| `mergeUsageMetadata` | `(acc, incoming) → Record<string, number>` | Sums `usage_metadata` numeric fields into an accumulator. |
| `isValidHeader` | `(line: string) → boolean` | Validates that a JSONL line is a `chunk_format: 1` header. |
| `parseChunkLine` | `(line: string) → { namespace, msg, metadata } \| null` | Parses one JSONL data line (object or array shape). Returns `null` on parse errors. |
| `namespaceKey` | `(ns: string[]) → NamespaceKey` | Converts a raw namespace array to a display key (`""` for main agent). |
| `namespaceLabel` | `(key: NamespaceKey) → string` | Returns a human-readable label (`"Main Agent"` or the key string). |
| `accumulateChunks` | `(records: Array<{ namespace, msg }>) → Map<NamespaceKey, MergedMessage[]>` | Accumulates parsed chunk records into a namespace-keyed map of merged messages. |

### `chunk-renderer.ts` — Rendering layer

Imports all types and functions from `chunk-accumulator.ts`. Exports four pure renderers and the `DialogueBlock` discriminated union type:

| Export | Signature | Description |
|--------|-----------|-------------|
| `renderChunksToMarkdown` | `(jsonlContent: string) → string` | Verbose format: `## Role` headings, JSON fenced tool-call blocks, token-usage footer. |
| `renderChunksToDialogue` | `(jsonlContent: string) → string` | Compact chat-like format: plain-paragraph AI text, per-tool summary lines, hidden ToolMessages, sub-agent `### Subagent:` headings. |
| `renderChunksToStructured` | `(jsonlContent: string) → DialogueBlock[]` | Structured format: returns a typed JSON array of `DialogueBlock` objects for interactive frontend rendering. |
| `renderChunksToText` | `(jsonlContent: string) → string` | Prose-only extraction: AI text turns only, no tool-call JSON, no tool results. Single-namespace files render as flat prose; multi-namespace files get `## Outer Agent` / `## Inner Agent` section headers (one per inner namespace, all labeled identically). Returns `'*No dialogue recorded.*\n'` for empty or content-free input. Shares its `.md` output format with `scripts/extract-dialogue.js`. |
| `DialogueBlock` | *(exported type)* | Discriminated union describing one rendered block in the structured view. |

#### `DialogueBlock` Type

```typescript
type DialogueBlock =
  | { type: 'text'; content: string }
  | { type: 'tool-call'; name: string; detailLines: string[]; args: unknown; result?: { content: string } }
  | { type: 'subagent-heading'; label: string }
  | { type: 'checklist'; items: Array<{ content: string; status: string; checked: boolean }> };
```

Variants:
- `text` — A prose paragraph of AI-generated text.
- `tool-call` — One tool invocation: name, summary detail lines, parsed args JSON, and an optional embedded ToolMessage result for non-inline tools (e.g. `read_file`, `ledger_*`).
- `subagent-heading` — Heading marking the start of a sub-agent namespace.
- `checklist` — A `write_todos` invocation rendered as a typed item list; each item carries `content`, `status`, and a pre-computed `checked` boolean.

---

## 1.X Server-side TypeScript Exports (`gui/server.ts`)

These types and functions are exported from `gui/server.ts` and used by test code and other server-side modules.

### Exported Types

#### `HttpMethod`

```typescript
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
```

Discriminated union of all HTTP methods accepted by the route table. Used as the type of `Route.method`, converting a runtime string check into a compile-time guarantee. The route-table structural test (`tests/gui/route-table.test.ts`) validates method values at runtime as defense-in-depth alongside the compile-time union.

#### `RouteGuard`

```typescript
export type RouteGuard = (req: IncomingMessage, port: number) => void;
```

A request-level check `dispatchRoute` runs, in `Route.guards` array order, after the route matches and before `readJsonBody`. Throws `ApiError` to reject the request — `dispatchRoute`'s existing `ApiError` handling maps it to a status code and error body exactly as it would for a handler-thrown error. Implemented by `requireLoopbackRequest` and `requireJsonContentType` in `gui/route-guards.ts`.

#### `Route` (interface)

A declarative route entry for `buildRoutes()` and `dispatchRoute()`.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `method` | `HttpMethod` | ✓ | HTTP method — one of `'GET' \| 'POST' \| 'PUT' \| 'PATCH' \| 'DELETE'`. |
| `path` | `string \| RegExp` | ✓ | Exact string path or RegExp with named capture groups (`(?<name>…)`). |
| `handler` | `(body: unknown, groups?: Record<string, string>, query?: URLSearchParams) => Promise<unknown>` | ✓ | Called with the parsed body (or `undefined` when `noBody` is set), named capture groups, and query parameters. |
| `statusCode` | `number` | — | Response status code (default `200`). Use `204` for empty responses. |
| `noBody` | `boolean` | — | When `true`, skip `readJsonBody()`. Use for GET routes and body-free mutations. |
| `guards` | `readonly RouteGuard[]` | — | Run in array order after the route matches and before `readJsonBody`. A route with no `guards` behaves exactly as before this field existed. |

### Exported Functions

#### `buildRoutes(ledgerRoot, configPath, orchestratorLogsDir, bootVersions): Route[]`

Builds the declarative route table consumed by `dispatchRoute()`. **Delegates to eight non-exported domain sub-builders** (`buildConfigRoutes`, `buildOrchestratorRoutes`, `buildRepoRoutes`, `buildKnowledgeRoutes`, `buildModelRoutes`, `buildStoreRoutes`, `buildErrorCodeRoutes`, `buildProjectRoutes`) composed via spread — each sub-builder receives only the closure variables its handlers require. Routes are organized into Section A (body-parsing), Section B (keyword-specific body-free, `noBody: true`), Section C (catch-all body-free, `noBody: true`). Section B must precede Section C (load-bearing ordering — see constraint §9). `buildErrorCodeRoutes()` takes no arguments — its handlers operate on the user-level `~/.ai-insights/error-codes/` directory, not on any ledger root or project path.

#### `getRouteDescriptors(): Route[]`

Zero-argument factory for structural testing. Calls `buildRoutes('/dev/null', '/dev/null', '/dev/null', null)` with sentinel arguments so tests can inspect the route table structure without requiring real filesystem paths. Use this in test code instead of calling `buildRoutes()` directly with dummy constants.

---

## 1.Y Server-side TypeScript Exports (`gui/api.ts`)

### `__awaitPendingSelfHealsForTesting(): Promise<void>`

Test-only hook. `handleGetProject` never awaits its own fire-and-forget `.meta.json` cache-refresh self-heal write — doing so would add lock latency to every production project-detail request — so each write's promise is tracked in a module-level `pendingSelfHeals: Set<Promise<void>>` (added on start, removed in `finally` regardless of outcome). `__awaitPendingSelfHealsForTesting()` resolves once every currently-tracked write has settled, giving a test a deterministic point to wait for before tearing down a temp directory the write may still target, instead of a fixed-duration sleep. See "Fire-and-Forget Self-Heal Writes Use the `pendingSelfHeals` Test Seam" in the MCP server's `constraints-testing.md`.

---

## 2. Frontend Global Namespaces

### 2.1 `API` (api-client.js)

Client-side REST API wrapper. All methods return Promises. All methods can reject with `{ code: string, message: string }` on HTTP error responses — callers should handle this shape at every call site.

| Method | Signature | Endpoint |
|--------|-----------|----------|
| `getProjects` | `(params?) → Promise<ProjectListEnvelope>` | `GET /api/projects` |
| `getProject` | `(repo, slug) → Promise<ProjectDetail>` | `GET /api/projects/:repo/:slug` |
| `getWorkPackages` | `(repo, slug) → Promise<WP[]>` | `GET /api/projects/:repo/:slug/work-packages` |
| `getWorkPackage` | `(repo, slug, wpId) → Promise<WPDetail>` | `GET /api/projects/:repo/:slug/work-packages/:wpId` |
| `deleteProject` | `(repo, slug) → Promise<null>` | `DELETE /api/projects/:repo/:slug` |
| `archiveProject` | `(repo, slug) → Promise<object>` | `POST …/archive` |
| `unarchiveProject` | `(repo, slug) → Promise<object>` | `POST …/unarchive` |
| `markProjectComplete` | `(repo, slug) → Promise<object>` | `POST …/complete` |
| `getRunLogs` | `(repo, slug) → Promise<object[]>` | `GET …/runs` |
| `getRunLogEntries` | `(repo, slug, filename, afterLine?) → Promise<object>` | `GET …/runs/:filename` |
| `getRunMetadata` | `(repo, slug) → Promise<object>` | `GET …/run-metadata` |
| `getPlanDocument` | `(repo, slug) → Promise<object>` | `GET …/plan` |
| `getSynthesisDocument` | `(repo, slug) → Promise<object>` | `GET …/synthesis` |
| `getProjectHealth` | `(repo, slug) → Promise<object>` | `GET …/health` |
| `getWorkPackageOverview` | `(repo, slug) → Promise<object>` | `GET …/work-packages/overview` |
| `renameProject` | `(repo, slug, title) → Promise<object>` | `PATCH …` |
| `renameSlug` | `(repo, slug, newSlug) → Promise<object>` | `PATCH …` |
| `analyzeProjectReset` | `(repo, slug) → Promise<object>` | `POST …/reset` (dry_run) |
| `applyProjectReset` | `(repo, slug, decisions) → Promise<object>` | `POST …/reset` (apply) |
| `getDialogues` | `(repo, slug, wpId?) → Promise<object[]>` | `GET …/dialogues` |
| `getDialogueContent` | `(repo, slug, filename) → Promise<string>` | `GET …/dialogues/:filename` |
| `getChunks` | `(repo, slug, wpId?) → Promise<object[]>` | `GET …/chunks` |
| `getChunkRendered` | `(repo, slug, filename) → Promise<string>` | `GET …/chunks/:filename/rendered` — Markdown string response |
| `getChunkStructured` | `(repo, slug, filename) → Promise<DialogueBlock[]>` | `GET …/chunks/:filename/rendered?format=structured` — structured JSON response (unwrapped array) |
| `getChunkText` | `(repo, slug, filename) → Promise<string>` | `GET …/chunks/:filename/text` — prose-only extraction; returns `data.content` (AI text turns, no tool-call JSON) |
| `getConfig` | `() → Promise<object>` | `GET /api/config` |
| `updateConfig` | `(data) → Promise<object>` | `PUT /api/config` |
| `getModels` | `() → Promise<object[]>` | `GET /api/models` |
| `saveModels` | `(models: object[]) → Promise<object>` | `PUT /api/models` |
| `loadDefaultModels` | `() → Promise<object>` | `POST /api/models/load-defaults` |
| `getPersonas` | `() → Promise<object[]>` | `GET /api/personas` |
| `getAssignments` | `() → Promise<object>` | `GET /api/model-assignments` |
| `updateAssignments` | `(data: object) → Promise<object>` | `PUT /api/model-assignments` |
| `replaceAssignedModel` | `(oldModelId: string, newModelId: string) → Promise<object>` | `POST /api/model-assignments/replace` |
| `rebuildPersonas` | `() → Promise<object>` | `POST /api/personas/rebuild` |
| `getInsights` | `() → Promise<object[]>` | `GET /api/insights` |
| `getServerInfo` | `() → Promise<object>` | `GET /api/server-info` |
| `getErrorCodeProviders` | `() → Promise<{ providers: object[], plugin_dir: string, load_errors: object[] }>` | `GET /api/error-codes/providers` |
| `getErrorCodeConfig` | `() → Promise<object>` | `GET /api/error-codes/config` |
| `updateErrorCodeConfig` | `(data: object) → Promise<object>` | `PUT /api/error-codes/config` |
| `testErrorCodeProvider` | `(providerId: string, settings?: object) → Promise<object>` | `POST /api/error-codes/test` |
| `getTemporaryErrorCodes` | `(limit?: number) → Promise<{ entries: object[], warning?: string }>` | `GET /api/error-codes/temporary` |
| `orchestratorStart` | `(planPath, dryRun, resumeThreadId?) → Promise<object>` | `POST /api/orchestrator/start` |
| `orchestratorGetQueue` | `() → Promise<object>` | `GET /api/orchestrator/queue` |
| `orchestratorGetRunStatus` | `(slug) → Promise<object>` | `GET /api/orchestrator/run-status/:filename` |
| `orchestratorKill` | `(id) → Promise<object>` | `POST /api/orchestrator/kill/:id` |
| `orchestratorDismiss` | `(id) → Promise<null>` | `POST /api/orchestrator/dismiss/:id` |
| `orchestratorDelete` | `(id) → Promise<object>` | `POST /api/orchestrator/delete/:id` |
| `getKnowledge` | `(params?) → Promise<object>` | `GET /api/knowledge` |
| `updateKnowledge` | `(id, scope, repositoryName, data) → Promise<object>` | `PATCH /api/knowledge/:id` |
| `deleteKnowledge` | `(id, scope, repositoryName?) → Promise<null>` | `DELETE /api/knowledge/:id` |
| `promoteKnowledge` | `(id, scope, repositoryName?) → Promise<object>` | `POST /api/knowledge/:id/promote` |
| `moveKnowledge` | `(id, body) → Promise<object>` | `POST /api/knowledge/:id/move` |

---

### 2.2 `Router` (router.js)

| Method | Signature | Description |
|--------|-----------|-------------|
| `init` | `() → void` | Attach `hashchange` listener; dispatch current hash. |
| `navigate` | `(hash: string) → void` | Programmatic navigation. |
| `_setPolling` | `(fn, delayMs) → void` | Set a polling interval (cleared on route change). |
| `_clearPolling` | `() → void` | Manually clear the active polling interval. |

---

### 2.3 `Theme` (theme.js)

| Method | Signature | Description |
|--------|-----------|-------------|
| `init` | `() → void` | Read stored preference, apply theme, bind toggle button. |
| `toggle` | `() → void` | Switch between dark/light and persist. |

---

### 2.4 `StaleCheck` (stale-check.js)

| Method | Signature | Description |
|--------|-----------|-------------|
| `init` | `() → void` | Start 30-second polling of `/api/server-info`; show banner on mismatch. |

---

### 2.5 `OrchestratorWidgets` (js/orchestrator-widgets.js)

| Method | Signature | Returns | Description |
|--------|-----------|---------|-------------|
| `renderStatusCard` | `(entry) → string` | HTML | Status card for a queue entry (badge + elapsed + PID + progress). |
| `renderKillButton` | `(entryId, onDone) → HTMLButtonElement` | DOM node | Confirmation-gated kill button. |
| `renderDismissButton` | `(entryId, onDone) → HTMLButtonElement` | DOM node | Dismiss button for dead entries. |
| `renderLogPreview` | `(container, repo, slug, filename) → cleanup()` | Function | Auto-polling log preview (3s interval). Returns cleanup function. |
| `renderProgressBadge` | `(lastAction) → string` | HTML | Small icon+label badge for a JSONL action type. |
| `renderCliReference` | `() → string` | HTML | Static CLI commands reference card. |
| `formatLogAction` | `(entry) → string` | String | Human-friendly label for a JSONL log entry. |

---

### 2.6 Global Utility Functions (utils.js)

| Function | Signature | Description |
|----------|-----------|-------------|
| `escapeHtml` | `(str) → string` | HTML-escape a string (null-safe). |
| `formatDate` | `(isoString) → string` | Relative date formatting ("Today, 14:30", "Yesterday", weekday, or full date). |
| `formatDuration` | `(ms) → string` | Duration formatting ("2h 15m", "< 1s"). |
| `statusBadge` | `(status) → string` | Returns `<span class="badge badge-{status}">…</span>` HTML. |
| `showLoading` | `(container) → void` | Set container innerHTML to loading spinner. |
| `showError` | `(container, message) → void` | Set container innerHTML to error banner. |
| `breadcrumb` | `() → BreadcrumbBuilder` | Fluent builder: `.projects().project(repo, slug).leaf(label).html()`. |
| `makeProjectCacheKey` | `(repo, slug) → string` | Returns `repo + '/' + slug`. |

### `ProjectNameCache` (utils.js)

LRU-like display name cache (max 200 entries, FIFO eviction).

| Method | Signature | Description |
|--------|-----------|-------------|
| `set` | `(key, name) → void` | Store a display name (key = `repo/slug`). |
| `get` | `(key) → string\|null` | Retrieve cached name; falls back to slug portion of key. |
| `_size` | `() → number` | Current cache size (testing only). |

---

### 2.7 View Render Functions (views/*.js)

Each view file exposes a global function called by `Router.dispatch()`:

| Function | File | Hash Route |
|----------|------|------------|
| `renderProjectList` | `project-list.js` | `#/` |
| `renderProjectDetail` | `project-detail.js` | `#/projects/:repo/:slug` |
| `renderPlan` | `project-detail.js` | `#/projects/:repo/:slug/plan` |
| `renderSynthesis` | `project-detail.js` | `#/projects/:repo/:slug/synthesis` |
| `renderWorkPackageDetail` | `work-package.js` | `#/projects/:repo/:slug/wp/:wpId` |
| `renderRunLog` | `run-log.js` | `#/projects/:repo/:slug/runs/:filename` |
| `renderOrchestrator` | `orchestrator.js` | `#/orchestrator` |
| `renderConfig` | `config.js` | `#/config` |
| `renderKnowledge` | `knowledge.js` | `#/knowledge` |

The Configuration view's Error Codes tab (`config-error-codes.js`) has no hash route of its own — it is a tab within `#/config`, entered via `renderConfigTabContent()`'s dispatcher (see below).

#### `config.js` — Internal Functions

`renderConfig` is the router entry point; it delegates to a set of named internal functions. The Configuration view has five tabs — General, Stores (implemented in `config-stores.js`), Persona Models (implemented in `config-persona-models.js`), Model Registry (implemented in `config-model-registry.js`), and Error Codes (implemented in `config-error-codes.js`). `CONFIG_TABS` — an array of `{ key, label, render, leave, reset }` descriptors declared in `config.js` — is the single source of truth for which tabs exist, which button labels appear, and how tab content is dispatched and cleaned up; `config.js` never reads or writes another module's `cs*`/`mr*`/`pm*`/`ec*` fields directly, only through a descriptor's three functions. `configFindTab(key)` looks up a descriptor by key, returning `undefined` when not found. See GUI constraint §25 "Config Tab Modules" for the full contract each descriptor's `render`/`leave`/`reset` must satisfy, and the "Two leave semantics" distinction (always-reset vs. reset-only-on-discard) it documents.

**Scaffold functions:**

| Function | Description |
|----------|-------------|
| `renderConfig(app)` | Entry point. Loads `API.getConfig()`, `API.getModels()`, `API.getPersonas()`, `API.getAssignments()`, and `API.getStores()` in parallel via `Promise.all`. Gracefully falls back to `[]` when optional API methods don't yet exist (`API.getStores` is guarded with a presence ternary for deployment safety). |
| `renderConfigPage(app, config, models, personas, assignments, stores)` | Renders the page scaffold (heading + tab bar, built from `CONFIG_TABS.map()` + `#config-tab-content`). Resets every `configDirty` key and calls every `CONFIG_TABS` descriptor's `reset()` on entry — fresh server data is always about to replace whatever state existed, so every tab is reset unconditionally here regardless of its `leave` semantics. Wires the tab-bar click handler with an unsaved-changes guard. |
| `renderConfigTabContent(config, models, personas, assignments, stores)` | Dispatcher — looks up the active tab via `configFindTab(configActiveTab)` and calls its `render(config, models, personas, assignments, stores)`; each tab's `render` ignores the arguments it does not need. |

**General tab functions:**

| Function | Description |
|----------|-------------|
| `renderGeneralTab(config)` | Returns the General tab HTML (wraps the settings form in a `UI.card()`). |
| `wireGeneralTabEvents()` | Attaches `change` and `input` listeners (both needed — checkboxes fire `change`, text/number inputs fire `input`) plus the `submit` handler to the General tab form. Sets `configDirty.general = false` on successful save. |

**Persona Models tab** (defined in `config-persona-models.js` — loaded before `config.js`; registered in `CONFIG_TABS` as `{ render: renderPersonaModelsTab, leave: pmLeaveTab, reset: pmResetState }`):

| Function | Description |
|----------|-------------|
| `renderPersonaModelsTab(models, personas, assignments)` | Entry point called by `renderConfigTabContent()`. Initializes pm* module state on first render or after a discard reset (`pmModels === null`); preserves existing state across tab switches that don't trigger the discard-changes path, so unsaved edits survive navigation. Returns `pmBuildTabHtml()`. |
| `pmLeaveTab(discarded)` | Leaves the tab: always increments `pmVisit` (invalidating in-flight requests). Resets `pmModels`/`pmOriginal`/`pmCollapsed`/`pmReplaceOpen` (and `pmIsBuilding`, via the same branch) only when `discarded` is `true` — `render`'s arguments are not refreshed after a save, so resetting on every leave would re-initialise from stale data. Registered as `CONFIG_TABS`'s `leave`. |
| `pmResetState()` | Full reset for a fresh page load: calls `pmLeaveTab(true)`. Registered as `CONFIG_TABS`'s `reset`. |
| `pmRefreshTab()` | Re-renders the Persona Models tab into `#config-tab-content`, re-wires events, and syncs `configDirty.personaModels` via `pmHasChanges()`. Called after any state mutation. |
| `pmBuildTabHtml()` | Builds the full tab HTML: suite sections (collapsed/expanded), per-persona model dropdowns, default model selector, stale-assignments banner, and action bar. |
| `pmWireEvents()` | Attaches all event handlers via card-level event delegation: per-persona edit/done/cancel, default-model change, suite collapse/expand, Replace Model inline form, Rebuild and Save buttons. Async handlers (e.g. the Replace Model inline form) capture `pmVisit` before their request and bail out in both `.then` and `.catch` when it no longer matches. |
| `pmDoSave()` | POSTs current `pmAssignments` to `PUT /api/model-assignments`. Captures `pmVisit` before the request; bails out in both `.then` and `.catch` when stale. On success, updates `pmOriginal` snapshot and sets `configDirty.personaModels = false`. |
| `pmDoRebuild()` | Triggers `POST /api/models/rebuild-personas`. Captures `pmVisit` before the request. Shows a build-progress state (`pmIsBuilding = true`) and refreshes the tab on completion. `pmIsBuilding` is cleared unconditionally by the settle callback — even when the visit is stale — before the stale check runs, since the flag spans visits (mirrors `ecSaveInFlight`); the nested `Promise.all` re-render that follows is itself guarded by the same `pmVisit` check. |
| `pmHasChanges()` | Returns `true` when `pmAssignments` differs from `pmOriginal` (checks `default_model_uuid` and all `persona_models` entries). |
| `pmCloneAssignments(a)` | Deep-clones an assignments object for snapshot comparison. |
| `pmModelName(uuid)` | Resolves a model UUID to its display name from `pmModels`. |
| `pmDirtyDot(isDirty)` | Returns the HTML for a dirty-indicator dot, or `''`. |
| `pmBuildModelOptions(selectedUuid, includeDefault)` | Builds `<option>` elements for a model dropdown; optionally prepends a "Default" option. |

**Model Registry tab** (defined in `config-model-registry.js` — loaded before `config.js`; registered in `CONFIG_TABS` as `{ render: renderModelRegistryTab, leave: mrLeaveTab, reset: mrResetState }`):

**Model Registry tab — core render functions:**

| Function | Description |
|----------|-------------|
| `renderModelRegistryTab(models)` | Main render entry. Initialises `mrModels` / `mrOriginal` / `mrEditingId` from server data on first call; preserves existing state if already populated (user may have unsaved edits). Returns `mrBuildTabHtml()`. |
| `mrLeaveTab(discarded)` | Leaves the tab: always increments `mrVisit` (invalidating in-flight requests). Resets `mrModels`/`mrOriginal`/`mrEditingId` only when `discarded` is `true`, for the same stale-page-load-argument reason as Persona Models' `pmLeaveTab`. Registered as `CONFIG_TABS`'s `leave`. |
| `mrResetState()` | Full reset for a fresh page load: calls `mrLeaveTab(true)`. Registered as `CONFIG_TABS`'s `reset`. |
| `mrRefreshTab()` | Re-renders the tab content into `#config-tab-content` and re-wires all event handlers. Syncs `configDirty.modelRegistry` via `mrHasChanges()`. Called after any state mutation (edit, delete, restore, save). |
| `mrBuildTabHtml()` | Builds the full Model Registry tab HTML string: model table (with read/edit rows), Add Model form, and action bar. Disables the Save button when any row has a slug validation error. |
| `mrRenderRow(model)` | Returns HTML for a single read-only model row. Shows dirty-indicator dots for changed fields (name, slug, cc_model) vs the original snapshot. Adds strikethrough row class for pending deletions. |
| `mrRenderEditRow(model)` | Returns HTML for the inline edit row (name/slug/cc_model inputs + Done/Cancel buttons). Done button is disabled while slug validation fails. |

**Model Registry tab — event wiring:**

| Function | Description |
|----------|-------------|
| `mrWireEvents()` | Wires all interactive elements: Edit/Cancel/Done/Delete/Restore row buttons, live slug validation on input, Add Model button, Save button, Load Defaults button. |
| `mrRefreshDirtyDots(id, tbody, origModel, model)` | No-op stub. Dirty dots are updated on full re-renders triggered by Done/Cancel/Delete/Restore actions, not on every keystroke. This function is a hook reserved for future fine-grained optimisation — callers should keep calling it so a future implementation can update dots in-place without requiring a full re-render. |
| `mrValidateAddSlug()` | Validates the Add Model slug field and shows/hides the error message. |
| `mrShowAddSlugError(msg)` | Shows or hides the inline slug error below the Add Model slug input. The Add button is intentionally NOT disabled here — validation runs on click instead, to avoid blocking mid-typing. |
| `mrSyncSaveButton()` | Enables/disables the global Save button based on whether any non-deleted row has a slug validation error. |

**Model Registry tab — helpers:**

| Function | Description |
|----------|-------------|
| `mrDeriveSlug(name)` | Derives a URL-safe slug from a human-readable name: lowercase, spaces → hyphens, strip non-alphanumeric. Mirrors the auto-slug derivation on the Add Model form. |
| `mrValidateSlug(slug)` | Validates a slug string. Returns an error message string, or `''` if valid. Rejects empty values, the reserved slug `"inherit"`, and strings that don't match `/^[a-z0-9]+(-[a-z0-9]+)*$/`. |
| `mrCloneModels(arr)` | Deep-clones a model array (shallow clone of each entry object). Used to create `mrOriginal` snapshot at init time and after a successful save. |
| `mrHasChanges()` | Returns `true` when `mrModels` differs from `mrOriginal`. Uses index-based positional comparison — correct for the stable-order bulk-save pattern. |
| `mrDirtyDot(isDirty)` | Returns the HTML for a dirty-indicator dot when `isDirty` is true, or `''` otherwise. |

**Model Registry tab — API actions:**

| Function | Description |
|----------|-------------|
| `mrDoSave()` | Strips `_deleted` entries from the working copy and sends the result to `PUT /api/models`. Captures `mrVisit` before the request; bails out in both `.then` and `.catch` when stale. On success, refreshes `mrModels` / `mrOriginal` from the server response. On 409 CONFLICT, shows an error directing the user to the Replace Model feature on the Persona Models tab. |
| `mrDoLoadDefaults()` | Shows a confirmation dialog, then calls `POST /api/models/load-defaults`. Captures `mrVisit` before the request; bails out in both `.then` and `.catch` when stale. On success, refreshes state and displays slug-collision conflicts if any were returned. |

**Error Codes tab** (defined in `config-error-codes.js` — loaded before `config.js`; registered in `CONFIG_TABS` as `{ render: function () { ecRenderTab(); }, leave: ecResetState, reset: ecResetState }` — Error Codes has no "keep state unless discarded" case, so `leave` and `reset` are the same function):

| Function | Description |
|----------|-------------|
| `ecRenderTab()` | Entry point called by `renderConfigTabContent()`. Lazily fetches `API.getErrorCodeProviders()`, `API.getErrorCodeConfig()`, and `API.getTemporaryErrorCodes()` in parallel on first activation only (`ecProviders === null`); every later call (including a provider switch) re-renders synchronously from cached state. This lazy-load contract is why Error Codes data is never added to `renderConfig()`'s own `Promise.all`. |
| `ecBuildTabHtml()` | Builds the full tab HTML: an escaped error banner above the settings form when `ecConfigWarning` is set, provider `<select>`, the selected provider's descriptor-driven settings form, the core (non-provider) settings fields, Save/Test buttons, the plugins panel, and the temporary-codes list. |
| `ecRenderField(field, storedValue)` | Renders one settings descriptor as a form control: `string`/`path` → text, `url` → `type="url"`, `secret` → password input (never pre-filled) with a Set/Not-set indicator and a conditional Clear-stored-value checkbox, `integer` → number input with `min`/`max`, `boolean` → checkbox, `select` → `<select>`, any unrecognised type → text. Every label/description/value is passed through `escapeHtml()`. |
| `ecRenderCoreSettings()` | Renders the temporary-code prefix, allocation timeout, and the two retry-wait fields. |
| `ecRenderPluginsPanel()` | Renders the plugin directory path + copy button, installed plugins (source: `'plugin'`), load errors, and the empty state. |
| `ecRenderTemporaryList()` | Renders the temporary-codes table (server already returns newest-first, capped) or the empty state, preceded by an escaped error banner when `ecTemporaryWarning` is set. |
| `ecCollectProviderSettings(provider)` | Reads the current form values for one provider's descriptors into `{ settings, clear_secrets }`. A secret field whose Clear-stored-value checkbox is ticked is omitted from `settings` and listed in `clear_secrets`; a secret left blank (and not cleared) is omitted entirely so the server keeps the stored value. |
| `ecCollectCoreSettings()` | Reads and validates the core settings fields; returns `null` (after showing an error in the live region) when the temporary prefix does not match `EC_TEMPORARY_PREFIX_PATTERN` (a mirror of the server's `TEMPORARY_PREFIX_PATTERN`, pinned by a test) or a numeric value is not a positive integer. |
| `ecHandleSave(form)` | The `#ec-form` submit handler. Guarded by `ecSaveInFlight` (returns before validation while a PUT is pending, so a second submit, `submit` event or `requestSubmit()` sends nothing). Calls `form.reportValidity()`, then `PUT /api/error-codes/config` with the selected provider's id as both `active_provider` and `provider_id`, its collected settings/`clear_secrets`, and the core settings. On success, clears `ecConfigWarning` (a successful save just wrote a fully-validated `config.json`, so any prior salvage/corruption warning no longer applies), re-renders the tab (so masked secret state reflects the save) and writes to `#ec-live-region`. |
| `ecHandleTestClick(btn)` | The "Test connection" click handler. Guarded by `ecTestInFlight` so a second click while a request is pending never fires a second one. Disables the button and sets its text to "Testing…" for the duration. |
| `ecHandleProviderChange(selectEl)` | The provider `<select>`'s change handler. When `configDirty.errorCodes` is true, shows the same `confirm()` discard dialog as the tab-bar guard; reverts the selection on cancel. |
| `ecHandleCopyPluginDir(btn)` | Copies the plugin directory path to the clipboard (or a `document.execCommand('copy')` fallback), mirroring `config-stores.js`'s `.cs-copy-btn` pattern. |
| `ecWireEvents()` | Wires delegated `change`/`input`/`click` listeners on `#config-tab-content` plus the `#ec-form` `submit` handler. Calls `ecCleanup()` first as a duplicate-listener guard. |
| `ecCleanup()` | Removes every listener `ecWireEvents()` attached. Called before re-wiring within a visit and from `ecResetState()`. |
| `ecResetState()` | Leaves the tab: increments `ecVisit` (so every request still pending is stale), calls `ecCleanup()`, and resets every `ec*` field except `ecSaveInFlight`. Registered in `CONFIG_TABS` as both `leave` and `reset` — called by `renderConfigPage()`'s reset pass and by the tab-bar exit branch via `leavingTab.leave(discarded)`; `config.js` keeps no list of this module's fields. |

**Module-level state** (`config.js` globals unless noted otherwise):

| Variable | Type | Description |
|----------|------|-------------|
| `configActiveTab` | `string` | Currently active tab key (`'general'`, `'personaModels'`, `'modelRegistry'`, `'stores'`, `'errorCodes'`). Persists across tab switches within a page visit. Defaults to `'general'` (hard-coded at declaration — not runtime-configurable). |
| `configDirty` | `{ general, personaModels, modelRegistry, stores, errorCodes: boolean }` | Per-tab dirty flags. Set to `true` on any form change. Reset to `false` on save or on `renderConfigPage()` re-entry. `stores` is always `false` — the Stores tab uses immediate writes. |
| `CONFIG_TABS` | `{ key, label, render, leave, reset }[]` | The tab registry — single source of truth for tab buttons, content dispatch and per-tab cleanup. See "`config.js` — Internal Functions" above and GUI constraint §25. |
| `csVisit` (`config-stores.js`) | `number` | Monotonic visit token, incremented by `csResetState()`. `csHandleModalSave`, `csRefreshTab`, the delete/sync handlers in `csWireEvents`, and `csMoveStore` each capture it before their request and return early in both `.then` and `.catch` when it no longer matches. |
| `mrModels` | `ModelEntry[] \| null` | Working copy of the model list. May contain edits or pending deletions (entries with `_deleted: true`). `null` until first tab activation. |
| `mrOriginal` | `ModelEntry[] \| null` | Snapshot loaded from the server — used for dirty comparison via `mrHasChanges()`. Replaced on each successful save. |
| `mrEditingId` | `string \| null` | UUID of the model row currently in inline edit mode. `null` when no row is being edited. |
| `mrVisit` (`config-model-registry.js`) | `number` | Monotonic visit token, incremented by `mrLeaveTab()`/`mrResetState()`. `mrDoSave` and `mrDoLoadDefaults` capture it before their request and return early in both `.then` and `.catch` when it no longer matches. |
| `MR_SLUG_REGEX` | `RegExp` | `/^[a-z0-9]+(-[a-z0-9]+)*$/` — mirrors the server-side slug validation rule. |
| `pmIsBuilding` (`config-persona-models.js`) | `boolean` | `true` while `pmDoRebuild()`'s request is in flight. Spans visits by design — `pmLeaveTab(discarded)` only resets it when `discarded` is `true`, but `pmDoRebuild`'s own settle callback always clears it first, even when the visit is stale, mirroring `ecSaveInFlight`. |
| `pmVisit` (`config-persona-models.js`) | `number` | Monotonic visit token, incremented by `pmLeaveTab()`/`pmResetState()`. `pmDoSave`, `pmDoRebuild` (and its nested refresh) and the async `pmWireEvents` callbacks capture it before their request and return early in both `.then` and `.catch` when it no longer matches. |
| `ecProviders` | `ProviderListItem[] \| null` | Providers from the most recent `GET /api/error-codes/providers`. `null` until the tab's first lazy load, and nulled again by the tab-switch cleanup branch — each tab visit re-fetches. |
| `ecConfig` | `ErrorCodeConfigResponse \| null` | The allocator's config (secrets masked to `{ set: boolean }`). `null` until first lazy load. |
| `ecConfigWarning` | `string \| null` | `ecConfig.warning` from the most recent `GET`/`PUT /api/error-codes/config` response — set during the lazy load and after a successful save, rendered as an escaped error banner above the settings form (`ecBuildTabHtml()`), and cleared by `ecResetState()` on tab exit. |
| `ecSelectedProviderId` | `string \| null` | Id of the provider currently shown in the settings form. Defaults to `ecConfig.active_provider` on load; changed only via the provider `<select>`, guarded by the unsaved-changes `confirm()`. |
| `ecSaveInFlight` | `boolean` | `true` while a Save (`PUT /api/error-codes/config`) request is pending. Set right before the PUT, cleared first in both settle callbacks; deliberately not reset by `ecCleanup()`. |
| `ecTestInFlight` | `boolean` | `true` while a "Test connection" request is pending — guards a second click from firing a second request. A stale Test callback (tab left meanwhile) never touches it, so it cannot unlock a newer visit's pending test. |
| `ecVisit` | `number` | Monotonic visit token, incremented by `ecResetState()`. The lazy load, Save and Test callbacks capture it before the request and return early when it no longer matches, so a late response cannot write into another tab's DOM or repopulate cleared state. A late Save still clears `ecSaveInFlight` first, since that flag spans visits. |
| `ecTemporaryWarning` | `string \| null` | Notice shown in the Temporary Codes card: the listing's `warning`, or `Temporary codes could not be loaded: …` when only that fetch failed (the settings form still renders). |

**`configDirty` cross-module contract:**

`configDirty` is a shared mutable object with five boolean keys — `general`, `personaModels`, `modelRegistry`, `stores`, and `errorCodes`. It is declared and owned by `config.js` but mutated directly by all five tab modules:

| Module | Key written | When written |
|--------|-------------|--------------|
| `config.js` (General tab) | `.general` | `change`/`input` → `true`; successful form submit → `false` |
| `config-model-registry.js` | `.modelRegistry` | After any state mutation via `mrHasChanges()` |
| `config-persona-models.js` | `.personaModels` | After any state mutation via `pmHasChanges()`; successful save → `false` |
| `config-stores.js` | `.stores` | Never set to `true` — Stores tab uses immediate writes; always `false`. |
| `config-error-codes.js` | `.errorCodes` | `change`/`input` on any form field → `true` (except the provider `<select>` itself and a Clear-stored-value toggle, which route through `ecHandleProviderChange`/the clear-checkbox branch first); successful save → `false`. |

**Rules companion modules must follow:**
1. **Never reassign `configDirty`** — the companion files hold a reference to the original object. Replacing it with `configDirty = {}` would break the coordinator's reference silently.
2. **Only mutate named keys** — do not add or delete keys; `renderConfigPage()` always resets all five known keys on fresh load.
3. **Load order** — `config-model-registry.js`, `config-persona-models.js`, `config-stores.js`, and `config-error-codes.js` must load _before_ `config.js` (see `index.html`). All four files reference `configDirty` only inside function bodies (not at module evaluation time), so the forward-reference is safe even though `configDirty` is not yet declared when these files are evaluated.

**Integration points a future tab module must follow** (established by `config-stores.js`, confirmed again by `config-error-codes.js`, `config-model-registry.js` and `config-persona-models.js`):
- Add a boolean key to the `configDirty` literal in `config.js` (mutate only, per Rule 1 above).
- Add a `{ key, label, render, leave, reset }` descriptor to `CONFIG_TABS` in `config.js`. `render` populates `#config-tab-content`; `leave(discarded)` runs when the tab-bar handler switches away (after the dirty-guard `confirm()`, if it fired); `reset()` runs with no arguments from `renderConfigPage()` on every fresh page load. Choose between the two `leave` shapes GUI constraint §25 documents: always-reset (`leave`/`reset` both the same function, as Stores/Error Codes do) when `render`'s arguments never go stale across visits, or reset-only-on-discard (`mrLeaveTab`/`pmLeaveTab`'s shape) when a successful save updates the tab's own in-memory snapshot without `config.js` refreshing `render`'s arguments.
- `leave` must always invalidate in-flight requests (increment the module's visit token) regardless of `discarded`, even in the always-reset case — this is what makes point 5 below (visit-token guarding) actually take effect on every tab switch, not only on a discard.
- Hold a monotonic visit token (e.g. `mrVisit`, `pmVisit`, `csVisit`, `ecVisit`), incremented by the tab's `leave`/`reset` function. Every async call site (lazy load, save, test, rebuild) captures the token before its request and returns early — in both `.then` and `.catch` — when it no longer matches, so a response that settles after the user left cannot write into the shared `#config-tab-content` or repopulate state that was just cleared. A flag that spans visits by design (`ecSaveInFlight`, `pmIsBuilding`) is still cleared by its own callback before the stale check.
- If the tab's data is not part of the page's initial load, fetch it lazily on first activation inside the tab's own render-entry function rather than adding it to `renderConfig()`'s `Promise.all` — `config-error-codes.js`'s `ecRenderTab()` is the reference implementation.
- No separate dispatcher branch or tab-bar cleanup branch is needed — `renderConfigTabContent()` and the tab-bar click handler both operate purely off `CONFIG_TABS` via `configFindTab()`, so adding the descriptor is sufficient.

The tab-bar unsaved-changes guard in `config.js` reads `configDirty[configActiveTab]` on every tab-switch click and shows a `confirm()` dialog when the value is `true`. On discard, it resets the key, sets `discarded = true`, and calls the left tab's `leave(discarded)` via its `CONFIG_TABS` descriptor — which runs unconditionally either way, so a tab switch away from a never-dirty tab still invalidates its visit token and (for always-reset tabs) clears its cached state.

**Dependencies:** `API`, `UI`, `escapeHtml`, `showLoading`, `showError` (all globals, loaded before `config.js`).

---

### 2.8 `UI` (components.js)

Shared UI render helpers. Loaded after `utils.js`; requires `escapeHtml()` to be available as a global. Follows the same IIFE-namespace pattern as `OrchestratorWidgets`.

| Method | Signature | Returns | Description |
|--------|-----------|---------|-------------|
| `badge` | `(type: string, label: string) → string` | HTML | Renders `<span class="badge badge-{type}">{label}</span>`. `type` is normalised (lowercase, spaces/underscores → hyphens). `label` is HTML-escaped. |
| `banner` | `(type: string, message: string) → string` | HTML | Renders `<p class="{type}-banner">{message}</p>`. `type` is normalised. `message` is HTML-escaped. Supported types: `error`, `success`, `info`, `stale`. |
| `emptyState` | `(message: string) → string` | HTML | Renders `<p class="text-muted mt-16">{message}</p>`. `message` is HTML-escaped. |

**Security note:** `_normaliseType()` is not HTML-escaped — the normalised type string is interpolated directly into class attribute values. All current callers pass server-controlled enum strings. If `UI.badge()` or `UI.banner()` is ever called with user-supplied input, the `type` argument must be sanitised at the call site.

**Exception:** `run-log.js` line ~271 retains one intentional inline badge (the cross-WP `tool_call` badge) because it requires a `title` tooltip attribute that `UI.badge()` does not support.

---

## 3. CSS Component Library

→ **See [ui-components.md](ui-components.md)** for the full CSS class inventory (theming tokens, buttons, `.btn-group`, badges, cards, tables, forms, state feedback, and all view-specific classes).
