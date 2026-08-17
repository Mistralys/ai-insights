# MCP Server - Source (GUI API Handlers)
_SOURCE: GUI REST route handlers: knowledge, queue, run-log, server bootstrap_
# GUI REST route handlers: knowledge, queue, run-log, server bootstrap
```
// Structure of documents
└── mcp-server/
    └── gui/
        └── api-knowledge.ts
        └── api-models.ts
        └── api-repos.ts
        └── api-stores.ts
        └── api.ts
        └── chunk-accumulator.ts
        └── chunk-renderer.ts
        └── orchestrator-manager.ts
        └── server.ts

```
###  Path: `/mcp-server/gui/api-knowledge.ts`

```ts
/**
 * GUI API Route Handlers — Knowledge Domain
 *
 * All REST handlers, schemas, and helpers for the /api/knowledge/* endpoints.
 * Extracted from gui/api.ts (WP-003) to keep the knowledge domain self-contained
 * and to wire handlePromoteKnowledge / handleMoveKnowledge to the atomic
 * KnowledgeStoreManager.moveInsight() method introduced in WP-002.
 *
 * Scope validation hardening (WP-001): handleListKnowledge now validates the
 * `scope` query parameter via InsightScope.safeParse() and throws VALIDATION_ERROR
 * for any non-undefined value that is not 'global' or 'repository'. This brings
 * the list handler into contract parity with the four mutating handlers, which
 * have always enforced scope validation via Zod. Omitting `scope` (undefined)
 * remains the "no filter" default and is always allowed.
 *
 * Error shape:  { code: string, message: string, details?: unknown }
 *   NOT_FOUND        → 404
 *   FORBIDDEN        → 403
 *   VALIDATION_ERROR → 400
 *   (unhandled)      → 500
 *
 * STDIO discipline: this file never writes to process.stdout.
 *
 * repository_name validation in DELETE and promote handlers (RESOLVED):
 *   `handleDeleteKnowledge` and `handlePromoteKnowledge` now validate `repository_name`
 *   against `SLUG_REGEX` at the handler level (after the presence check), throwing
 *   `VALIDATION_ERROR` (HTTP 400) for any malformed slug value. All five knowledge endpoints
 *   now return consistent, well-typed HTTP 400 responses for malformed slug values —
 *   the previous HTTP 500 / unhandled-error-branch fallback no longer applies.
 *
 * ID-change semantics (promote / move):
 *   handlePromoteKnowledge and handleMoveKnowledge both delegate to
 *   KnowledgeStoreManager.moveInsight(), which performs an atomic cross-store
 *   read-modify-write. The insight is deleted from the source store and inserted
 *   into the target store **with its UUID preserved** — the `id` field in the
 *   response is identical to the pre-operation ID. The `next_id` counter no longer
 *   exists. Frontend consumers can safely reference the pre-operation ID after
 *   a promote or move operation — the UUID does not change.
 */

import { z } from 'zod';
import { ApiError } from '../src/gui/errors.js';
import { KnowledgeStoreManager } from '../src/storage/knowledge-store.js';
import { InsightScope, SLUG_REGEX } from '../src/schema/knowledge.js';
import { isStoreContextInitialized, getStoreRouter, getMultiStoreManager } from '../src/storage/store-context.js';
import type { Insight } from '../src/schema/knowledge.js';

// Re-export ApiError so consumers of this module can catch typed errors without
// importing from a separate path.
export { ApiError };

// ---------------------------------------------------------------------------
// Multi-store helper
// ---------------------------------------------------------------------------

/**
 * Iterate-and-try helper for write operations that need to locate the owning
 * store for a given insight. Tries `fn` against each configured store in
 * priority order, skipping stores that throw a "not found" error. Throws
 * NOT_FOUND when no store satisfies the operation.
 *
 * Falls back to a single `new KnowledgeStoreManager(ledgerRoot)` call in
 * legacy single-store mode.
 */
async function withKnowledgeStore<T>(
  ledgerRoot: string,
  fn: (manager: KnowledgeStoreManager) => Promise<T>
): Promise<T> {
  if (isStoreContextInitialized()) {
    const stores = getStoreRouter().getAllStores();
    for (const store of stores) {
      const manager = new KnowledgeStoreManager(store.path);
      try {
        return await fn(manager);
      } catch (err) {
        if ((err as Error).message.includes('not found')) continue;
        throw err;
      }
    }
    throw new ApiError('NOT_FOUND', 'Insight not found.');
  }
  // Legacy single-store path: wrap 'not found' as ApiError for consistent error shape.
  try {
    return await fn(new KnowledgeStoreManager(ledgerRoot));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.toLowerCase().includes('not found')) {
      throw new ApiError('NOT_FOUND', 'Insight not found.');
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function validationError(message: string, details?: unknown): never {
  throw new ApiError('VALIDATION_ERROR', message, details);
}

// ---------------------------------------------------------------------------
// Knowledge — module-level schema constants
// ---------------------------------------------------------------------------

/**
 * Zod schema for the PATCH /api/knowledge/:id request body.
 *
 * `scope` is required; all other mutable fields are optional. `.strict()` rejects
 * unknown keys, preventing callers from sneaking in immutable fields (id, created_at, …).
 *
 * `superseded_by` accepts `null` to allow callers to explicitly clear the field.
 * The handler maps `null → undefined` before forwarding to `updateInsight()`.
 */
export const KnowledgeUpdateBodySchema = z
  .object({
    scope: InsightScope,
    repository_name: z.string().regex(SLUG_REGEX).optional(),
    title: z.string().optional(),
    content: z.string().optional(),
    category: z.string().optional(),
    tags: z.array(z.string()).optional(),
    source: z.string().optional(),
    confidence: z.number().min(0).max(1).optional(),
    superseded_by: z.string().uuid().nullable().optional(),
  })
  .strict();

/**
 * Zod schema for the POST /api/knowledge/:id/move request body.
 *
 * Fields validated by the Zod schema (format/type constraints):
 * - `source_scope`        — "global" or "repository" (InsightScope enum)
 * - `source_repository_name` — optional in the schema (`z.string().regex(SLUG_REGEX).optional()`);
 *                              the conditional-required constraint (required when source_scope is "repository")
 *                              is enforced in handler logic, not here.
 * - `repository_name`        — destination repository name (required; must match SLUG_REGEX)
 *
 * Note: `source_repository_name` is `.optional()` at the Zod layer so that the schema can parse
 * a body that omits it — the handler then checks the combination of `source_scope` and
 * `source_repository_name` and throws VALIDATION_ERROR if the conditional constraint is violated.
 * This is consistent with how other conditional-required fields are handled across this API.
 */
export const KnowledgeMoveBodySchema = z
  .object({
    source_scope: InsightScope,
    source_repository_name: z.string().regex(SLUG_REGEX).optional(),
    repository_name: z.string().regex(SLUG_REGEX),
  })
  .strict();

// ---------------------------------------------------------------------------
// Knowledge — private helpers
// ---------------------------------------------------------------------------

/**
 * Parses a raw string as a UUID insight ID.
 *
 * Accepts any well-formed UUID (8-4-4-4-12 hex groups, case-insensitive).
 * Rejects anything that does not match the UUID format.
 *
 * @throws ApiError VALIDATION_ERROR for any rejected value.
 */
export function parseKnowledgeId(raw: string): string {
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_REGEX.test(raw)) {
    throw new ApiError('VALIDATION_ERROR', 'Invalid insight id.');
  }
  return raw;
}

// ---------------------------------------------------------------------------
// Interface definitions
// ---------------------------------------------------------------------------

/** Raw query parameters accepted by GET /api/knowledge. */
export interface KnowledgeListParams {
  scope?: string;
  category?: string;
  /** Comma-separated list of tags to filter by. */
  tags?: string;
  repository_name?: string;
  /** Full-text search query — delegates to searchInsights when present. */
  query?: string;
  limit?: number | string;
  offset?: number | string;
}

// ---------------------------------------------------------------------------
// GET /api/knowledge
// ---------------------------------------------------------------------------

/**
 * Lists (or searches) knowledge insights stored in the ledger's `.knowledge/` directory.
 *
 * - When `query` is present, delegates to `KnowledgeStoreManager.searchInsights()`.
 * - Otherwise calls `KnowledgeStoreManager.listInsights()` with scope/category/tags filters.
 * - `scope` is validated via `InsightScope.safeParse()`; unrecognised values throw
 *   `VALIDATION_ERROR`. Omitting `scope` (or passing `undefined`) returns all insights.
 * - `repository_name` is validated against `SLUG_REGEX` when provided; malformed values
 *   throw `VALIDATION_ERROR` (HTTP 400) rather than reaching the storage layer.
 * - `tags` is a comma-separated string that is split before being forwarded.
 * - `limit` and `offset` are coerced to non-negative integers; invalid/missing values
 *   are silently ignored (limit → undefined, offset → 0).
 * - `limit=0` is treated as unlimited (mapped to undefined); pass a positive integer
 *   to enforce a page size.
 */
export async function handleListKnowledge(
  ledgerRoot: string,
  params: KnowledgeListParams = {}
): Promise<Insight[]> {
  // Validate scope — reject any non-nullish string that is not a valid InsightScope value.
  // Absent scope (undefined) means "no filter" and is always allowed.
  let scope: 'global' | 'repository' | undefined;
  if (params.scope !== undefined) {
    const scopeResult = InsightScope.safeParse(params.scope);
    if (!scopeResult.success) {
      validationError(`Invalid scope value: '${params.scope}'. Must be 'global' or 'repository'.`);
    }
    scope = scopeResult.data;
  }

  const category = params.category ?? undefined;
  const repository_name = params.repository_name ?? undefined;

  // Validate repository_name format — must match SLUG_REGEX if provided.
  if (repository_name !== undefined && !SLUG_REGEX.test(repository_name)) {
    validationError('repository_name contains invalid characters. Use only alphanumerics, hyphens, and underscores.');
  }

  // Split comma-separated tags; ignore empty segments.
  const tags =
    params.tags && params.tags.trim().length > 0
      ? params.tags
          .split(',')
          .map((t) => t.trim())
          .filter((t) => t.length > 0)
      : undefined;

  // Coerce pagination params.
  const limitRaw = params.limit !== undefined ? Math.floor(Number(params.limit)) : NaN;
  const limit = !isNaN(limitRaw) && limitRaw > 0 ? limitRaw : undefined;

  const offsetRaw = params.offset !== undefined ? Math.floor(Number(params.offset)) : NaN;
  const offset = !isNaN(offsetRaw) && offsetRaw >= 0 ? offsetRaw : 0;

  if (isStoreContextInitialized()) {
    if (params.query && params.query.trim().length > 0) {
      return getMultiStoreManager().searchKnowledge(params.query.trim(), { scope, repository_name, category, tags, limit, offset });
    }
    return getMultiStoreManager().listKnowledge({ scope, category, tags, repository_name, limit, offset });
  }

  const manager = new KnowledgeStoreManager(ledgerRoot);
  if (params.query && params.query.trim().length > 0) {
    return manager.searchInsights(params.query.trim(), { scope, repository_name, category, tags, limit, offset });
  }

  return manager.listInsights({ scope, category, tags, repository_name, limit, offset });
}

// ---------------------------------------------------------------------------
// PATCH /api/knowledge/:id
// ---------------------------------------------------------------------------

/**
 * Updates an existing knowledge insight identified by its UUID.
 *
 * Validates the raw ID string via `parseKnowledgeId` (throws VALIDATION_ERROR
 * for non-UUID strings). Validates the request body via `KnowledgeUpdateBodySchema`
 * (throws VALIDATION_ERROR for unknown fields or type mismatches). Extracts `scope`
 * and `repository_name` discriminator fields to scope the update to the correct store.
 *
 * `superseded_by: null` in the body is mapped to `undefined` so the field is
 * cleared (removed) on the stored insight.
 *
 * Throws NOT_FOUND when no insight with the given ID exists in the specified scope.
 *
 * @param ledgerRoot  Absolute path to the central ledger root.
 * @param rawId       Raw UUID string from the URL parameter (e.g. "a1b2c3d4-e5f6-7890-abcd-ef1234567890").
 * @param body        Parsed request body (any shape — validated here).
 * @returns The updated Insight.
 */
export async function handleUpdateKnowledge(
  ledgerRoot: string,
  rawId: string,
  body: unknown
): Promise<Insight> {
  const id = parseKnowledgeId(rawId);

  const parseResult = KnowledgeUpdateBodySchema.safeParse(body);
  if (!parseResult.success) {
    validationError('Invalid knowledge update body.', parseResult.error.issues);
  }

  const { scope, repository_name, superseded_by, ...rest } = parseResult.data;

  // Map superseded_by: null → undefined so the field is cleared on the stored insight.
  const updates: Parameters<KnowledgeStoreManager['updateInsight']>[1] = {
    ...rest,
    ...(superseded_by === null ? { superseded_by: undefined } : superseded_by !== undefined ? { superseded_by } : {}),
  };

  return withKnowledgeStore(ledgerRoot, (manager) =>
    manager.updateInsight(id, updates, { scope, repository_name })
  );
}

// ---------------------------------------------------------------------------
// DELETE /api/knowledge/:id
// ---------------------------------------------------------------------------

/**
 * Deletes an existing knowledge insight identified by its UUID.
 *
 * Validates the raw ID string via `parseKnowledgeId` (throws VALIDATION_ERROR
 * for non-UUID strings). Requires `scope` as a query parameter; when
 * `scope === 'repository'`, `repository_name` is also required (throws
 * VALIDATION_ERROR if absent). Scope discriminates between global and repository
 * stores to ensure the deletion targets the correct store.
 *
 * Throws NOT_FOUND when no insight with the given ID exists in the specified scope.
 *
 * `repository_name` is validated against `SLUG_REGEX` at this handler level
 * (after the presence check) before being forwarded to the storage layer. A malformed
 * slug throws `VALIDATION_ERROR` (HTTP 400) immediately, consistent with
 * `handleMoveKnowledge` and `handleUpdateKnowledge`.
 *
 * @param ledgerRoot      Absolute path to the central ledger root.
 * @param rawId           Raw UUID string from the URL parameter (e.g. "a1b2c3d4-e5f6-7890-abcd-ef1234567890").
 * @param scope           Required scope query parameter ('global' or 'repository').
 * @param repository_name Required when scope is 'repository'; the repository name.
 * @returns `null` — consistent with other delete handlers.
 */
export async function handleDeleteKnowledge(
  ledgerRoot: string,
  rawId: string,
  scope: string | undefined,
  repository_name?: string
): Promise<null> {
  const id = parseKnowledgeId(rawId);

  // Validate scope — required and must be a recognised InsightScope value.
  const scopeResult = InsightScope.safeParse(scope);
  if (!scopeResult.success) {
    validationError('scope query parameter is required and must be "global" or "repository".');
  }
  const validatedScope = scopeResult.data;

  // repository_name is required when scope === 'repository'.
  if (validatedScope === 'repository' && !repository_name) {
    validationError('repository_name query parameter is required when scope is "repository".');
  }

  // Validate repository_name format — must match SLUG_REGEX.
  if (repository_name && !SLUG_REGEX.test(repository_name)) {
    validationError('repository_name contains invalid characters. Use only alphanumerics, hyphens, and underscores.');
  }

  await withKnowledgeStore(ledgerRoot, (manager) =>
    manager.deleteInsight(id, { scope: validatedScope, repository_name })
  );

  return null;
}

// ---------------------------------------------------------------------------
// POST /api/knowledge/:id/promote
// ---------------------------------------------------------------------------

/**
 * Promotes a repository-scoped insight to global scope using the atomic
 * KnowledgeStoreManager.moveInsight() method.
 *
 * The returned insight is the global-scoped copy — its UUID is **preserved**
 * from the original (the `id` in the response equals the pre-promote ID).
 * Frontend consumers can continue to reference the same UUID after promotion.
 *
 * `repository_name` is validated against `SLUG_REGEX` at this handler level
 * (after the presence check) before being forwarded to the storage layer. A malformed
 * slug throws `VALIDATION_ERROR` (HTTP 400) immediately, consistent with
 * `handleMoveKnowledge` and `handleUpdateKnowledge`.
 *
 * @param ledgerRoot      Absolute path to the central ledger root.
 * @param rawId           Raw UUID string from the URL parameter (e.g. "a1b2c3d4-e5f6-7890-abcd-ef1234567890").
 * @param scope           Source scope — must be "repository" (global insights cannot be promoted).
 * @param repository_name Required when scope is "repository"; the source repository name.
 * @returns The promoted global Insight (same UUID as the original).
 * @throws ApiError VALIDATION_ERROR if scope is not "repository", insight is already global,
 *   or repository_name fails SLUG_REGEX validation.
 * @throws ApiError NOT_FOUND if no matching insight exists in the specified scope.
 */
export async function handlePromoteKnowledge(
  ledgerRoot: string,
  rawId: string,
  scope: string | undefined,
  repository_name?: string
): Promise<Insight> {
  const id = parseKnowledgeId(rawId);

  // Validate scope — must be 'repository' (global insights are already global).
  const scopeResult = InsightScope.safeParse(scope);
  if (!scopeResult.success) {
    validationError('scope query parameter is required and must be "global" or "repository".');
  }
  const validatedScope = scopeResult.data;

  if (validatedScope === 'global') {
    validationError('Insight is already global and cannot be promoted.');
  }

  // repository_name is required when scope === 'repository'.
  if (!repository_name) {
    validationError('repository_name query parameter is required when scope is "repository".');
  }

  // Validate repository_name format — must match SLUG_REGEX.
  if (!SLUG_REGEX.test(repository_name)) {
    validationError('repository_name contains invalid characters. Use only alphanumerics, hyphens, and underscores.');
  }

  return withKnowledgeStore(ledgerRoot, (manager) =>
    manager.moveInsight(id, { scope: validatedScope, repository_name }, 'global')
  );
}

// ---------------------------------------------------------------------------
// POST /api/knowledge/:id/move
// ---------------------------------------------------------------------------

/**
 * Moves an insight from one scope/repository to a different repository using the
 * atomic KnowledgeStoreManager.moveInsight() method.
 *
 * Supports two move variants:
 * - global → repository: moves the global insight into a named repository store
 * - repository → repository: moves a repository insight to a different repository
 *
 * The returned insight's UUID is **preserved** — the `id` in the response equals
 * the pre-move ID. Frontend consumers can continue to reference the same UUID
 * after the move.
 *
 * @param ledgerRoot  Absolute path to the central ledger root.
 * @param rawId       Raw UUID string from the URL parameter (e.g. "a1b2c3d4-e5f6-7890-abcd-ef1234567890").
 * @param body        Parsed request body (validated against KnowledgeMoveBodySchema).
 * @returns The moved Insight in the target repository store (same UUID as the original).
 * @throws ApiError VALIDATION_ERROR when source and destination are identical, body is invalid,
 *   or the destination name fails SLUG_REGEX.
 * @throws ApiError NOT_FOUND when no matching insight exists in the source scope.
 */
export async function handleMoveKnowledge(
  ledgerRoot: string,
  rawId: string,
  body: unknown
): Promise<Insight> {
  const id = parseKnowledgeId(rawId);

  const parseResult = KnowledgeMoveBodySchema.safeParse(body);
  if (!parseResult.success) {
    validationError('Invalid knowledge move body.', parseResult.error.issues);
  }

  const { source_scope, source_repository_name, repository_name } = parseResult.data;

  // Require source_repository_name when source_scope is 'repository'.
  if (source_scope === 'repository' && !source_repository_name) {
    validationError('source_repository_name is required when source_scope is "repository".');
  }

  // Validate that source and destination are not identical.
  // global → repository always changes scope, so no identity check is needed for that case.
  if (source_scope === 'repository' && source_repository_name === repository_name) {
    validationError('Source and destination repository are identical; nothing to move.');
  }

  return withKnowledgeStore(ledgerRoot, (manager) =>
    manager.moveInsight(
      id,
      { scope: source_scope, repository_name: source_repository_name },
      'repository',
      repository_name
    )
  );
}

```
###  Path: `/mcp-server/gui/api-models.ts`

```ts
/**
 * GUI API Route Handlers — Model Registry Domain
 *
 * All REST handlers for the /api/models, /api/model-assignments, and
 * /api/personas endpoints. Follows the domain-split pattern established by
 * `api-repos.ts` — each API domain gets its own handler file imported from
 * `server.ts`.
 *
 * Routes provided:
 *   GET    /api/models                       — list models (auto-init local.json from defaults)
 *   PUT    /api/models                       — bulk-save model list (auto-assign UUIDs)
 *   POST   /api/models/load-defaults         — merge default.json into local.json
 *   GET    /api/model-assignments            — get assignments enriched with stale flag
 *   PUT    /api/model-assignments            — validate + persist assignment data
 *   POST   /api/model-assignments/replace    — swap all occurrences of one model UUID
 *   GET    /api/personas                     — list personas from name-mapping.json
 *   POST   /api/personas/rebuild             — spawn node scripts/build-personas.js
 *
 * Validation rules:
 *   - `PUT /api/models`: auto-assigns UUIDv4 to entries missing `id`; rejects
 *     duplicate slugs and the reserved slug `"inherit"` on non-sentinel entries.
 *   - `PUT /api/models`: returns 409 Conflict when a deletion would leave a
 *     referenced model with no replacement (user must use Replace Model first).
 *   - `PUT /api/model-assignments`: validates all model UUIDs exist in registry
 *     and all persona keys exist in name-mapping.json. Per-persona UUID
 *     validation is batch-mode — all invalid UUIDs are collected before
 *     throwing a single error that reports the total count (e.g. "2 model
 *     UUIDs do not exist in the model registry"). Persona key validation
 *     is fail-fast (exits on the first invalid key) and is a distinct
 *     validation step that runs before UUID checks.
 *   - `POST /api/model-assignments/replace`: rejects same-model swap and
 *     rejects when old_model_id is not currently referenced.
 *
 * Error shape: { error: { code: string, message: string } }
 *   NOT_FOUND        → 404
 *   VALIDATION_ERROR → 400
 *   CONFLICT         → 409
 *   (unhandled)      → 500
 *
 * STDIO discipline: this file never writes to process.stdout.
 */

import { readFile, stat } from 'fs/promises';
import { join } from 'path';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { ApiError } from '../src/gui/errors.js';
import { WORKSPACE_ROOT } from '../src/utils/ledger-root.js';
import {
  readModels,
  writeModels,
  readAssignments,
  writeAssignments,
  loadDefaults,
  ModelRegistrySchema,
  ModelAssignmentsSchema,
  type ModelEntry,
  type ModelAssignments,
} from '../src/gui/model-registry.js';

// Re-export ApiError so consumers can catch typed errors without importing
// from a separate path.
export { ApiError };

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function validationError(message: string, details?: unknown): never {
  throw new ApiError('VALIDATION_ERROR', message, details);
}

function conflictError(message: string, details?: unknown): never {
  throw new ApiError('CONFLICT', message, details);
}

/**
 * Returns the absolute path to the model registry directory.
 * `{WORKSPACE_ROOT}/personas/model-registry`
 */
function modelRegistryDir(): string {
  return join(WORKSPACE_ROOT, 'personas', 'model-registry');
}

/**
 * Returns the absolute path to name-mapping.json.
 * `{WORKSPACE_ROOT}/personas/name-mapping.json`
 */
function nameMappingPath(): string {
  return join(WORKSPACE_ROOT, 'personas', 'name-mapping.json');
}

/**
 * Returns the mtime of a file, or `null` if the file does not exist.
 */
async function getMtime(filePath: string): Promise<Date | null> {
  try {
    const s = await stat(filePath);
    return s.mtime;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Module-level concurrency guard for persona rebuild
// ---------------------------------------------------------------------------

/** True while a `node scripts/build-personas.js` process is running. */
let buildInProgress = false;

// ---------------------------------------------------------------------------
// GET /api/models
// ---------------------------------------------------------------------------

/**
 * Returns the current model registry list.
 *
 * Auto-initializes `local.json` from `default.json` if it does not exist
 * (delegates to `readModels()` which handles the initialization).
 */
export async function handleGetModels(): Promise<ModelEntry[]> {
  return readModels();
}

// ---------------------------------------------------------------------------
// PUT /api/models
// ---------------------------------------------------------------------------

/**
 * Request body schema for PUT /api/models.
 *
 * Accepts an array of model entries. Entries missing `id` get a fresh UUIDv4
 * assigned before the write is performed.
 *
 * We accept `id` as optional at the schema level so that the handler can
 * auto-assign it. Downstream `writeModels()` requires full `ModelEntry`
 * objects (id required), which is satisfied after UUID assignment.
 */
const SaveModelsBodySchema = z.array(
  z.object({
    id: z.string().uuid().optional(),
    name: z.string().min(1),
    slug: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9 .()\-]*$/),
    cc_model: z.string().min(1).default('inherit'),
  })
);

/**
 * Bulk-saves the model registry.
 *
 * - Validates and auto-assigns UUIDv4 to any entry missing `id`.
 * - Delegates validation (slug uniqueness, reserved slug, deletion guard) to
 *   `writeModels()` from the model-registry module.
 * - Returns 409 Conflict when a referenced model would be deleted.
 *
 * @param body - Raw parsed JSON request body.
 */
export async function handleSaveModels(body: unknown): Promise<{
  models: ModelEntry[];
} | {
  conflict: true;
  referencedModels: Array<{
    model: ModelEntry;
    usages: string[];
  }>;
}> {
  const parsed = SaveModelsBodySchema.safeParse(body);
  if (!parsed.success) {
    validationError(
      `Invalid model list: ${parsed.error.issues.map((i) => i.message).join('; ')}`
    );
  }

  // Auto-assign UUIDv4 to entries missing an id
  const enriched: ModelEntry[] = parsed.data.map((entry) => ({
    id: entry.id ?? randomUUID(),
    name: entry.name,
    slug: entry.slug,
    cc_model: entry.cc_model,
  }));

  const result = await writeModels(enriched);

  if (!result.saved) {
    // Deletion blocked — referenced models
    conflictError(
      'One or more models being removed are still referenced in persona model assignments. ' +
        'Use the Replace Model feature to reassign them before removing.',
      result.referencedModels
    );
  }

  return { models: result.models };
}

// ---------------------------------------------------------------------------
// POST /api/models/load-defaults
// ---------------------------------------------------------------------------

/**
 * Merges `default.json` into `local.json`.
 *
 * Existing entries (by UUID) are never overwritten. Slug collisions between
 * new default entries and existing local entries are reported as conflicts but
 * do not block the merge.
 *
 * Returns the post-merge model list and the list of slug-collision conflicts.
 */
export async function handleLoadDefaults(): Promise<{
  models: ModelEntry[];
  conflicts: Array<{
    defaultEntry: ModelEntry;
    localEntry: ModelEntry;
    reason: 'slug_collision';
  }>;
}> {
  return loadDefaults();
}

// ---------------------------------------------------------------------------
// GET /api/model-assignments
// ---------------------------------------------------------------------------

/**
 * Staleness check.
 *
 * Returns `true` when `max(mtime(assignments.json), mtime(local.json))` is
 * **greater than** `mtime(name-mapping.json)`, indicating that the user
 * registry or assignments have changed since the last persona build.
 *
 * Staleness rules:
 * - Returns `false` when neither assignments.json nor local.json exist (no
 *   user modifications have been made yet — no build needed).
 * - Returns `false` when only `default.json` exists (mtime reflects Git
 *   checkout time, not user modification; excluded by design).
 * - Returns `false` when name-mapping.json does not exist (no build output to
 *   compare against).
 *
 * @internal
 */
async function computeStale(): Promise<boolean> {
  const registryDir = modelRegistryDir();

  const [assignmentsMtime, localMtime, nameMappingMtime] = await Promise.all([
    getMtime(join(registryDir, 'assignments.json')),
    getMtime(join(registryDir, 'local.json')),
    getMtime(nameMappingPath()),
  ]);

  // No user files exist → never stale
  if (assignmentsMtime === null && localMtime === null) {
    return false;
  }

  // name-mapping.json doesn't exist → can't compare, not stale
  if (nameMappingMtime === null) {
    return false;
  }

  // max(mtime(assignments.json), mtime(local.json))
  const userMtimes = [assignmentsMtime, localMtime].filter((m): m is Date => m !== null);
  const maxUserMtime = new Date(Math.max(...userMtimes.map((m) => m.getTime())));

  return maxUserMtime > nameMappingMtime;
}

/**
 * Returns the current model assignments enriched with a `stale` boolean.
 *
 * The `stale` flag indicates whether the persona build output (`name-mapping.json`)
 * is out of date relative to user-modified files. It is computed by
 * `computeStale()` and follows these rules:
 *
 * - `stale: true`  — `max(mtime(assignments.json), mtime(local.json))` is
 *   strictly greater than `mtime(name-mapping.json)`. The user has made
 *   registry or assignment changes since the last build; a rebuild is needed.
 * - `stale: false` — neither `assignments.json` nor `local.json` exist. No
 *   user modifications have been made yet; no build is needed.
 * - `stale: false` — `name-mapping.json` does not exist. There is no build
 *   output to compare against.
 * - `stale: false` — only `default.json` is newer than `name-mapping.json`.
 *   `default.json` mtime reflects Git checkout time, not a user modification,
 *   so it is excluded from the staleness comparison by design.
 *
 * Frontend consumers should show a "Rebuild personas" prompt when `stale: true`.
 */
export async function handleGetAssignments(): Promise<
  ModelAssignments & { stale: boolean }
> {
  const [assignments, stale] = await Promise.all([
    readAssignments(),
    computeStale(),
  ]);
  return { ...assignments, stale };
}

// ---------------------------------------------------------------------------
// PUT /api/model-assignments
// ---------------------------------------------------------------------------

/**
 * Request body schema for PUT /api/model-assignments.
 */
const UpdateAssignmentsBodySchema = ModelAssignmentsSchema;

/**
 * Validates and persists model assignments.
 *
 * Validation:
 * - All model UUIDs referenced in the body must exist in the model registry.
 * - All persona keys in `persona_models` must appear as `id` values in
 *   `name-mapping.json`. Returns 400 when `name-mapping.json` doesn't exist.
 *
 * @param body - Raw parsed JSON request body.
 */
export async function handleUpdateAssignments(
  body: unknown
): Promise<ModelAssignments> {
  const parsed = UpdateAssignmentsBodySchema.safeParse(body);
  if (!parsed.success) {
    validationError(
      `Invalid assignments data: ${parsed.error.issues.map((i) => i.message).join('; ')}`
    );
  }

  const data = parsed.data;

  // 1. Validate name-mapping.json exists and load valid persona IDs
  let nameMappingRaw: string;
  try {
    nameMappingRaw = await readFile(nameMappingPath(), 'utf-8');
  } catch {
    validationError(
      'name-mapping.json does not exist. Run a persona build first before updating assignments.'
    );
  }

  let nameMapping: unknown;
  try {
    // `nameMappingRaw!` — TypeScript cannot narrow across the try/catch above
    // because `validationError` returns `never` (the throw is inside the
    // catch block, not the try block). The assertion is safe: if we reach
    // this line, the readFile succeeded and `nameMappingRaw` is defined.
    nameMapping = JSON.parse(nameMappingRaw!);
  } catch {
    validationError('name-mapping.json is not valid JSON.');
  }

  if (!Array.isArray(nameMapping)) {
    validationError('name-mapping.json must be a JSON array.');
  }

  const validPersonaIds = new Set<string>(
    (nameMapping as Array<{ id?: unknown }>)
      .filter((e) => typeof e.id === 'string')
      .map((e) => e.id as string)
  );

  // 2. Validate all persona keys in persona_models are valid persona IDs.
  //    Intentionally fail-fast (exits on the first invalid key): persona-key
  //    errors are structural misconfiguration, not bulk data errors, so a
  //    single diagnostic is sufficient. Contrast with step 3 below, which
  //    collects all invalid UUIDs before throwing (batch validation).
  for (const personaKey of Object.keys(data.persona_models)) {
    if (!validPersonaIds.has(personaKey)) {
      validationError(
        `One or more persona keys in persona_models are not valid. ` +
          `Found ${validPersonaIds.size} valid persona ${validPersonaIds.size === 1 ? 'ID' : 'IDs'} in name-mapping.json.`
      );
    }
  }

  // 3. Validate all model UUIDs exist in the registry
  const models = await readModels();
  const validModelIds = new Set(models.map((m) => m.id));

  if (data.default_model_uuid !== undefined && !validModelIds.has(data.default_model_uuid)) {
    validationError(
      'The default_model_uuid does not exist in the model registry.'
    );
  }

  const invalidPersonaUUIDs = Object.entries(data.persona_models)
    .filter(([, uuid]) => !validModelIds.has(uuid));
  if (invalidPersonaUUIDs.length > 0) {
    const n = invalidPersonaUUIDs.length;
    validationError(
      `${n} model ${n === 1 ? 'UUID' : 'UUIDs'} in persona_models do not exist in the model registry.`
    );
  }

  // 4. Persist
  await writeAssignments(data);
  return data;
}

// ---------------------------------------------------------------------------
// POST /api/model-assignments/replace
// ---------------------------------------------------------------------------

/**
 * Request body schema for POST /api/model-assignments/replace.
 */
const ReplaceModelBodySchema = z
  .object({
    old_model_id: z.string().uuid(),
    new_model_id: z.string().uuid(),
  })
  .strict();

/**
 * Swaps all occurrences of `old_model_id` with `new_model_id` in the current
 * assignments.
 *
 * Rejects with 400 when:
 * - `old_model_id === new_model_id`
 * - `old_model_id` is not currently referenced in any assignment
 *
 * Both UUIDs must exist in the model registry.
 *
 * @param body - Raw parsed JSON request body.
 */
export async function handleReplaceAssignedModel(
  body: unknown
): Promise<ModelAssignments> {
  const parsed = ReplaceModelBodySchema.safeParse(body);
  if (!parsed.success) {
    validationError(
      `Invalid replace body: ${parsed.error.issues.map((i) => i.message).join('; ')}`
    );
  }

  const { old_model_id, new_model_id } = parsed.data;

  // Reject same-model replacement
  if (old_model_id === new_model_id) {
    validationError('Source and target models must be different.');
  }

  // Validate both UUIDs exist in the registry
  const models = await readModels();
  const validModelIds = new Set(models.map((m) => m.id));

  if (!validModelIds.has(old_model_id)) {
    validationError(
      'The specified old_model_id does not exist in the model registry.'
    );
  }

  if (!validModelIds.has(new_model_id)) {
    validationError(
      'The specified new_model_id does not exist in the model registry.'
    );
  }

  // Load current assignments
  const assignments = await readAssignments();

  // Check that old_model_id is actually referenced
  const referenced =
    assignments.default_model_uuid === old_model_id ||
    Object.values(assignments.persona_models).some((uuid) => uuid === old_model_id);

  if (!referenced) {
    validationError(
      'The specified model is not referenced in any current assignment. Nothing to replace.'
    );
  }

  // Perform the swap
  const updated: ModelAssignments = {
    default_model_uuid:
      assignments.default_model_uuid === old_model_id
        ? new_model_id
        : assignments.default_model_uuid,
    persona_models: Object.fromEntries(
      Object.entries(assignments.persona_models).map(([k, v]) => [
        k,
        v === old_model_id ? new_model_id : v,
      ])
    ),
  };

  await writeAssignments(updated);
  return updated;
}

// ---------------------------------------------------------------------------
// GET /api/personas
// ---------------------------------------------------------------------------

/**
 * Minimal persona shape exposed by `GET /api/personas`.
 *
 * The required fields (`id`, `role`, `suite`) are always present. The optional
 * fields are only populated after WP-003 is implemented and a persona build has
 * run — before that, `name-mapping.json` may only carry the required fields.
 *
 * @field id        - Unique persona identifier used as the key in model
 *                    assignments (`persona_models` map). Use this value when
 *                    calling `PUT /api/model-assignments`.
 * @field role      - Human-readable display name for the persona.
 * @field suite     - The persona suite this persona belongs to (e.g. `"ledger"`,
 *                    `"standalone"`).
 * @field model     - Optional resolved model name (e.g. `"claude-opus-4-5"`).
 *                    Present only after a build; may be undefined before first build.
 * @field model_slug - Optional slug of the assigned model entry in the local
 *                    registry (matches `ModelEntry.slug`).
 * @field cc_model  - Optional Claude Code model identifier for this persona.
 *                    Reflects the effective value after `"inherit"` resolution.
 * @field number    - Optional display ordering index within the suite.
 */
export interface PersonaEntry {
  id: string;
  role: string;
  suite: string;
  model?: string;
  model_slug?: string;
  cc_model?: string;
  number?: number;
}

/**
 * Returns all personas from `name-mapping.json`, or an empty array if the
 * file does not exist.
 */
export async function handleGetPersonas(): Promise<PersonaEntry[]> {
  let raw: string;
  try {
    raw = await readFile(nameMappingPath(), 'utf-8');
  } catch {
    // File doesn't exist yet (first run before any build) — return empty
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ApiError('VALIDATION_ERROR', 'name-mapping.json is not valid JSON.');
  }

  if (!Array.isArray(parsed)) {
    throw new ApiError(
      'VALIDATION_ERROR',
      'name-mapping.json must be a JSON array.'
    );
  }

  return parsed as PersonaEntry[];
}

// ---------------------------------------------------------------------------
// POST /api/personas/rebuild
// ---------------------------------------------------------------------------

/**
 * Spawns `node scripts/build-personas.js` in the workspace root, capturing
 * combined stdout+stderr output.
 *
 * Concurrency guard: returns 409 Conflict when a build is already in progress.
 * The `buildInProgress` flag is cleared in a `finally` block to handle
 * unexpected process errors.
 *
 * @param workspaceRoot - Absolute path to the workspace root (contains `scripts/`).
 */
export async function handleRebuildPersonas(workspaceRoot: string): Promise<{
  success: true;
  output: string;
} | {
  success: false;
  output: string;
  exitCode: number;
}> {
  if (buildInProgress) {
    throw new ApiError(
      'CONFLICT',
      'A persona build is already in progress. Please wait for it to complete.'
    );
  }

  buildInProgress = true;

  try {
    const output = await new Promise<{ output: string; exitCode: number }>(
      (resolve) => {
        const scriptPath = join(workspaceRoot, 'scripts', 'build-personas.js');
        const child = spawn('node', [scriptPath], {
          cwd: workspaceRoot,
          env: process.env,
        });

        const chunks: string[] = [];

        child.stdout.on('data', (chunk: Buffer) => {
          chunks.push(chunk.toString());
        });

        child.stderr.on('data', (chunk: Buffer) => {
          chunks.push(chunk.toString());
        });

        child.on('close', (code: number | null) => {
          resolve({ output: chunks.join(''), exitCode: code ?? 1 });
        });

        child.on('error', (err: Error) => {
          resolve({
            output: `Process error: ${err.message}`,
            exitCode: 1,
          });
        });
      }
    );

    if (output.exitCode === 0) {
      return { success: true, output: output.output };
    } else {
      return { success: false, output: output.output, exitCode: output.exitCode };
    }
  } finally {
    buildInProgress = false;
  }
}

/**
 * Exposed for testing purposes only — resets the module-level concurrency guard.
 * @internal
 */
export function _resetBuildInProgress(): void {
  buildInProgress = false;
}

```
###  Path: `/mcp-server/gui/api-repos.ts`

```ts
/**
 * GUI API Route Handlers — Repository Registry Domain
 *
 * All REST handlers for the /api/repos and /api/repos/:repoId endpoints.
 * Follows the domain-split pattern established by `api-knowledge.ts` — each
 * API domain gets its own handler file imported from `server.ts`.
 *
 * Routes provided:
 *   GET    /api/repos              — list all declared repositories
 *                                    Query parameters:
 *                                      ?include_undeclared=true — also return filesystem-discovered
 *                                      namespace directories that are not covered by any declared
 *                                      repo's folder_names. Works in both single-store and multi-
 *                                      store modes. Undeclared entries carry declared: false and a
 *                                      synthetic shape (see RepoListItem). Defaults to false,
 *                                      preserving the original endpoint behaviour.
 *   GET    /api/repos/:repoId      — get a single repository entry or 404
 *   POST   /api/repos              — create a new repository entry
 *   PUT    /api/repos/:repoId      — update label, folder_names, and/or vision
 *   DELETE /api/repos/:repoId      — remove the declaration (no project data deleted)
 *   POST   /api/repos/:repoId/move — move the declaration to a different store (multi-store only)
 *
 * Validation rules:
 *   - `id` (create): must match SLUG_REGEX; must be unique across existing entries.
 *   - `folder_names`: each name must be unique across ALL entries in the registry.
 *     Create and update operations that would violate this constraint are rejected
 *     with VALIDATION_ERROR (HTTP 400) and a clear error message.
 *   - `label`: non-empty string (min 1 character).
 *   - `vision`: three-horizon object (short_term, mid_term, long_term) — each field
 *     is a nullable string; null means "not yet authored"; empty strings are rejected.
 *
 * Error shape: { code: string, message: string, details?: unknown }
 *   NOT_FOUND        → 404
 *   VALIDATION_ERROR → 400
 *   (unhandled)      → 500
 *
 * STDIO discipline: this file never writes to process.stdout.
 */

import { readdir } from 'fs/promises';
import { join } from 'path';
import { z } from 'zod';
import { ApiError } from '../src/gui/errors.js';
import {
  loadRegistry,
  saveRegistry,
} from '../src/storage/repository-registry.js';
import {
  RepositoryEntrySchema,
  StrategicVisionSchema,
  type RepositoryEntry,
} from '../src/schema/repository-registry.js';
import { SLUG_REGEX } from '../src/schema/common.js';
import { LedgerStore } from '../src/storage/ledger-store.js';
import {
  isStoreContextInitialized,
  getStoreRouter,
  getMultiStoreManager,
} from '../src/storage/store-context.js';

// Re-export ApiError so consumers can catch typed errors without importing
// from a separate path.
export { ApiError };

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function validationError(message: string, details?: unknown): never {
  throw new ApiError('VALIDATION_ERROR', message, details);
}

/**
 * Returns the current ISO 8601 timestamp string.
 */
function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Validates that none of the given `folder_names` appear in any existing
 * registry entry. Optionally skips a specific entry by `excludeId` so that
 * an update operation can keep its own existing folder names without conflict.
 *
 * @throws ApiError VALIDATION_ERROR listing the conflicting folder name(s).
 */
function assertNoFolderNameConflicts(
  allEntries: RepositoryEntry[],
  folderNames: string[],
  excludeId?: string
): void {
  const conflicts: string[] = [];
  for (const name of folderNames) {
    const conflict = allEntries.find(
      (e) => e.id !== excludeId && e.folder_names.includes(name)
    );
    if (conflict) {
      conflicts.push(name);
    }
  }
  if (conflicts.length > 0) {
    validationError(
      `folder_names conflict: the following names are already used by another repository entry: ${conflicts.map((n) => `'${n}'`).join(', ')}.`
    );
  }
}

/**
 * Searches all configured stores for a repository entry with the given ID.
 *
 * - Multi-store mode: iterates stores in **config order** and returns the path of
 *   the **first** store whose registry contains the repo, along with the entry.
 * - Single-store / legacy mode: loads the single registry at `ledgerRoot`.
 *
 * Returns `null` when no matching entry is found in any store.
 *
 * **First-match semantics:** Iteration stops at the first store that contains the
 * given `repoId`. If the same ID is present in multiple stores (cross-store
 * uniqueness is not enforced on creation — see `handleCreateRepo`), all read,
 * update, and delete operations will silently target only the first-matched store
 * in config order. The second occurrence remains unaffected and unreachable via
 * these routes. Use `GET /api/stores/conflicts` to detect and resolve duplicate
 * IDs across stores.
 */
async function findEntryInStores(
  ledgerRoot: string,
  repoId: string
): Promise<{ storePath: string; entry: RepositoryEntry } | null> {
  if (isStoreContextInitialized() && getStoreRouter().isMultiStoreMode()) {
    const stores = getStoreRouter().getAllStores();
    for (const store of stores) {
      const registry = await loadRegistry(store.path);
      const entry = registry.repositories.find((e) => e.id === repoId);
      if (entry) return { storePath: store.path, entry };
    }
    return null;
  }

  const registry = await loadRegistry(ledgerRoot);
  const entry = registry.repositories.find((e) => e.id === repoId);
  return entry ? { storePath: ledgerRoot, entry } : null;
}

// ---------------------------------------------------------------------------
// Zod schemas for request bodies
// ---------------------------------------------------------------------------

/**
 * Body schema for POST /api/repos.
 *
 * Exported so that test code can construct and inspect validated shapes directly.
 * Not intended as a stable public API — treat as `@internal`.
 *
 * All fields required except `vision`, which defaults to all-null horizons
 * when omitted. `.strict()` rejects unknown keys.
 */
export const RepoCreateBodySchema = z
  .object({
    id: z.string().regex(SLUG_REGEX, {
      message:
        'id must start with an alphanumeric character and contain only letters, digits, hyphens, and underscores.',
    }),
    label: z.string().min(1, { message: 'label must be a non-empty string.' }),
    folder_names: z
      .array(z.string().min(1))
      .min(1, { message: 'folder_names must contain at least one entry.' }),
    vision: StrategicVisionSchema.optional(),
    /** Target store ID — optional; when omitted the default store (or legacy ledgerRoot) is used. */
    store_id: z.string().optional(),
  })
  .strict();

/**
 * Body schema for PUT /api/repos/:repoId.
 *
 * Exported so that test code can construct and inspect validated shapes directly.
 * Not intended as a stable public API — treat as `@internal`.
 *
 * All fields are optional — omitted fields are left unchanged. `.strict()`
 * rejects unknown keys.
 */
export const RepoUpdateBodySchema = z
  .object({
    label: z.string().min(1, { message: 'label must be a non-empty string.' }).optional(),
    folder_names: z
      .array(z.string().min(1))
      .min(1, { message: 'folder_names must contain at least one entry.' })
      .optional(),
    vision: StrategicVisionSchema.optional(),
    /** Accepted but ignored — the owning store is located automatically via the registry. */
    store_id: z.string().optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// GET /api/repos
// ---------------------------------------------------------------------------

/**
 * Response shape for list / get endpoints.
 * Exposes `has_vision` and `has_full_vision` as convenience booleans instead
 * of requiring the frontend to inspect all three horizon fields.
 *
 * @remarks
 * **Declared entries** (`declared: true`) are sourced from the repository
 * registry file and carry fully authoritative field values.
 *
 * **Undeclared (synthetic) entries** (`declared: false`) are discovered from
 * the filesystem when `GET /api/repos?include_undeclared=true` is requested.
 * Their fields follow these conventions:
 *   - `id`, `label`, and `folder_names[0]` all equal the namespace directory name.
 *   - `folder_names` always has exactly one element.
 *   - `has_vision` and `has_full_vision` are always `false` (no registry entry exists).
 *   - `created_at` and `last_modified` are set to the query timestamp
 *     (`new Date().toISOString()`) — they are **not** stable across calls and
 *     should not be used for sorting or comparison.
 *
 * Consumers that need to distinguish the two kinds of entries should branch on
 * `declared` rather than relying on any other field heuristic.
 */
export interface RepoListItem {
  id: string;
  label: string;
  folder_names: string[];
  /** true when at least one horizon field is non-null */
  has_vision: boolean;
  /** true when all three horizon fields are non-null */
  has_full_vision: boolean;
  created_at: string;
  last_modified: string;
  /**
   * `true` for entries sourced from the repository registry.
   * `false` for synthetic entries discovered from the filesystem
   * (returned only when `?include_undeclared=true` is specified).
   */
  declared: boolean;
  /**
   * ID of the store this repository belongs to.
   * Present only in multi-store mode — absent in single-store / legacy mode.
   */
  store_id?: string;
}

function toListItem(entry: RepositoryEntry, storeId?: string): RepoListItem {
  const { vision } = entry;
  const has_vision =
    vision.short_term !== null ||
    vision.mid_term !== null ||
    vision.long_term !== null;
  const has_full_vision =
    vision.short_term !== null &&
    vision.mid_term !== null &&
    vision.long_term !== null;
  return {
    id: entry.id,
    label: entry.label,
    folder_names: entry.folder_names,
    has_vision,
    has_full_vision,
    created_at: entry.created_at,
    last_modified: entry.last_modified,
    declared: true,
    ...(storeId !== undefined ? { store_id: storeId } : {}),
  };
}

/**
 * Lists all declared repositories from the registry file, and optionally
 * includes undeclared namespace directories discovered on the filesystem.
 *
 * When `includeUndeclared` is `false` (the default), behavior is identical to
 * the original implementation — only declared repos are returned.
 *
 * When `includeUndeclared` is `true`, the function performs a `readdir` at the
 * ledger root, collects namespace directories that are not already covered by
 * any declared repo's `folder_names`, validates each undeclared namespace
 * contains at least one project (via `LedgerStore.listProjectsByFolderNames`),
 * and returns them as synthetic `RepoListItem` entries with `declared: false`.
 *
 * Dot-prefixed directories are always excluded (archive/control directories).
 *
 * @param ledgerRoot        - Absolute path to the centralized ledger root directory.
 * @param includeUndeclared - When true, also returns filesystem-discovered namespaces.
 *                            Defaults to false to preserve existing behavior.
 */
export async function handleListRepos(
  ledgerRoot: string,
  includeUndeclared = false
): Promise<RepoListItem[]> {
  // Multi-store mode: return a merged view from all stores, each entry tagged with store_id.
  if (isStoreContextInitialized() && getStoreRouter().isMultiStoreMode()) {
    const tagged = await getMultiStoreManager().getMergedRegistry();
    const declared = tagged.map((entry) => toListItem(entry, entry.store_id));

    if (!includeUndeclared) {
      return declared;
    }

    // Collect all declared folder_names across all stores for cross-store dedup.
    const allDeclaredFolderNames = new Set<string>(tagged.flatMap((e) => e.folder_names));

    const undeclaredItems: RepoListItem[] = [];
    for (const store of getStoreRouter().getAllStores()) {
      let dirents: import('fs').Dirent[];
      try {
        dirents = await readdir(store.path, { withFileTypes: true });
      } catch {
        continue; // Unreadable store root — skip it
      }

      const undeclaredNamespaces = dirents
        .filter((d) => d.isDirectory() && !d.name.startsWith('.') && !allDeclaredFolderNames.has(d.name))
        .map((d) => d.name);

      for (const namespace of undeclaredNamespaces) {
        const projects = await LedgerStore.listProjectsByFolderNames([namespace], store.path);
        if (projects.length === 0) continue;
        const now = new Date().toISOString();
        undeclaredItems.push({
          id: namespace,
          label: namespace,
          folder_names: [namespace],
          has_vision: false,
          has_full_vision: false,
          created_at: now,
          last_modified: now,
          declared: false,
          store_id: store.id,
        });
      }
    }

    return [...declared, ...undeclaredItems];
  }

  // Single-store / legacy mode: existing behavior
  const registry = await loadRegistry(ledgerRoot);
  const declared = registry.repositories.map((e) => toListItem(e));

  if (!includeUndeclared) {
    return declared;
  }

  // Collect all folder_names already claimed by declared entries
  const declaredFolderNames = new Set<string>(
    registry.repositories.flatMap((e) => e.folder_names)
  );

  // Enumerate namespace directories at the ledger root
  let dirents: import('fs').Dirent[];
  try {
    dirents = await readdir(ledgerRoot, { withFileTypes: true });
  } catch {
    // Ledger root unreadable — return just the declared repos
    return declared;
  }

  // Find directories not covered by any declared repo's folder_names
  const undeclaredNamespaces = dirents
    .filter((d) => d.isDirectory() && !d.name.startsWith('.') && !declaredFolderNames.has(d.name))
    .map((d) => d.name);

  if (undeclaredNamespaces.length === 0) {
    return declared;
  }

  // Validate undeclared namespaces contain at least one project to avoid surfacing
  // empty or control directories
  const undeclaredItems: RepoListItem[] = [];
  for (const namespace of undeclaredNamespaces) {
    const projects = await LedgerStore.listProjectsByFolderNames([namespace], ledgerRoot);
    if (projects.length === 0) {
      continue; // Skip empty/non-project directories
    }
    const now = new Date().toISOString();
    undeclaredItems.push({
      id: namespace,
      label: namespace,
      folder_names: [namespace],
      has_vision: false,
      has_full_vision: false,
      created_at: now,
      last_modified: now,
      declared: false,
    });
  }

  return [...declared, ...undeclaredItems];
}

// ---------------------------------------------------------------------------
// GET /api/repos/:repoId
// ---------------------------------------------------------------------------

/**
 * Returns the full repository entry for the given `repoId`, or throws
 * NOT_FOUND (404) if no entry with that id exists in the registry.
 *
 * In multi-store mode, the returned object is enriched with a `store_id` field
 * identifying the store that owns the entry. The id is resolved by matching the
 * `storePath` returned by `findEntryInStores()` against `getStoreRouter().getAllStores()`.
 * If the match yields no result (e.g. store removed between calls), the field is omitted.
 * In single-store mode or when store context is not initialized, `store_id` is absent.
 *
 * @param ledgerRoot - Absolute path to the centralized ledger root directory.
 * @param repoId     - The `id` field of the repository entry to retrieve.
 */
export async function handleGetRepo(
  ledgerRoot: string,
  repoId: string
): Promise<RepositoryEntry & { store_id?: string }> {
  const found = await findEntryInStores(ledgerRoot, repoId);
  if (!found) {
    throw new ApiError('NOT_FOUND', `Repository not found: '${repoId}'.`);
  }
  if (isStoreContextInitialized() && getStoreRouter().isMultiStoreMode()) {
    const match = getStoreRouter().getAllStores().find((s) => s.path === found.storePath);
    if (match) {
      return { ...found.entry, store_id: match.id };
    }
    console.warn(`handleGetRepo: no store found for storePath '${found.storePath}' — store_id omitted from response`);
  }
  return found.entry;
}

// ---------------------------------------------------------------------------
// POST /api/repos
// ---------------------------------------------------------------------------

/**
 * Creates a new repository entry in the registry.
 *
 * Validations (in order):
 *   1. Request body must conform to {@link RepoCreateBodySchema}.
 *   2. `id` must match SLUG_REGEX (enforced by the schema).
 *   3. `id` must be unique (no existing entry with the same id).
 *   4. No `folder_names` value may already appear in any existing entry.
 *
 * On success, returns the newly created {@link RepositoryEntry}.
 *
 * @param ledgerRoot - Absolute path to the centralized ledger root directory.
 * @param body       - Parsed request body (any shape — validated here).
 */
export async function handleCreateRepo(
  ledgerRoot: string,
  body: unknown
): Promise<RepositoryEntry> {
  const parsed = RepoCreateBodySchema.safeParse(body);
  if (!parsed.success) {
    validationError(
      'Invalid request body.',
      parsed.error.flatten().fieldErrors
    );
  }

  const { id, label, folder_names, vision, store_id } = parsed.data;

  // Resolve the target store path.
  // In multi-store mode: use the requested store_id (validating it), or fall back to the
  //   configured default store when store_id is omitted.
  // In single-store / legacy mode: always write to ledgerRoot.
  let targetStorePath: string;
  if (isStoreContextInitialized() && getStoreRouter().isMultiStoreMode()) {
    if (store_id !== undefined) {
      const stores = getStoreRouter().getAllStores();
      const target = stores.find((s) => s.id === store_id);
      if (!target) {
        const validIds = stores.map((s) => s.id).join(', ');
        validationError(
          `Invalid store_id '${store_id}'. Valid store IDs are: ${validIds}.`
        );
      }
      targetStorePath = target.path;
    } else {
      // No store_id specified — use the default store
      targetStorePath = getStoreRouter().resolveDefaultStore();
    }
  } else {
    targetStorePath = ledgerRoot;
  }

  const registry = await loadRegistry(targetStorePath);

  // Unique id check
  if (registry.repositories.some((e) => e.id === id)) {
    validationError(`A repository entry with id '${id}' already exists.`);
  }

  // Folder name uniqueness check
  assertNoFolderNameConflicts(registry.repositories, folder_names);

  const now = nowIso();
  const newEntry: RepositoryEntry = RepositoryEntrySchema.parse({
    id,
    label,
    folder_names,
    vision: vision ?? { short_term: null, mid_term: null, long_term: null },
    created_at: now,
    last_modified: now,
  });

  await saveRegistry(targetStorePath, {
    repositories: [...registry.repositories, newEntry],
  });
  return newEntry;
}

// ---------------------------------------------------------------------------
// PUT /api/repos/:repoId
// ---------------------------------------------------------------------------

/**
 * Updates an existing repository entry.
 *
 * Updatable fields: `label`, `folder_names`, `vision`. All are optional — only
 * supplied fields are overwritten. `created_at` is never mutated; `last_modified`
 * is always set to the current timestamp on a successful update.
 *
 * Validations:
 *   1. `repoId` must match an existing entry (NOT_FOUND otherwise).
 *   2. Request body must conform to {@link RepoUpdateBodySchema}.
 *   3. If `folder_names` is supplied, each value must be unique across all OTHER
 *      entries in the registry (the current entry's own names are excluded from
 *      the conflict check so that a no-change update always succeeds).
 *
 * @param ledgerRoot - Absolute path to the centralized ledger root directory.
 * @param repoId     - The `id` field of the repository entry to update.
 * @param body       - Parsed request body (any shape — validated here).
 */
export async function handleUpdateRepo(
  ledgerRoot: string,
  repoId: string,
  body: unknown
): Promise<RepositoryEntry> {
  // Locate the owning store — in multi-store mode this iterates stores in config order
  const found = await findEntryInStores(ledgerRoot, repoId);
  if (!found) {
    throw new ApiError('NOT_FOUND', `Repository not found: '${repoId}'.`);
  }
  const { storePath } = found;
  const registry = await loadRegistry(storePath);
  const existingIndex = registry.repositories.findIndex((e) => e.id === repoId);
  // existingIndex must be valid since findEntryInStores already found the entry
  const parsed = RepoUpdateBodySchema.safeParse(body);
  if (!parsed.success) {
    validationError(
      'Invalid request body.',
      parsed.error.flatten().fieldErrors
    );
  }

  const { label, folder_names, vision } = parsed.data;

  // Folder name uniqueness check — exclude the entry being updated
  if (folder_names !== undefined) {
    assertNoFolderNameConflicts(registry.repositories, folder_names, repoId);
  }

  const existing = registry.repositories[existingIndex]!;
  const updated: RepositoryEntry = RepositoryEntrySchema.parse({
    id: existing.id,
    label: label ?? existing.label,
    folder_names: folder_names ?? existing.folder_names,
    vision: vision ?? existing.vision,
    created_at: existing.created_at,
    last_modified: nowIso(),
  });

  const updatedRepositories = [...registry.repositories];
  updatedRepositories[existingIndex] = updated;

  await saveRegistry(storePath, { repositories: updatedRepositories });
  return updated;
}

// ---------------------------------------------------------------------------
// DELETE /api/repos/:repoId
// ---------------------------------------------------------------------------

/**
 * Removes a repository entry from the registry.
 *
 * This operation does NOT delete any project data, files, or directories —
 * it only removes the declaration from `.repositories.json`.
 *
 * Throws NOT_FOUND (404) if no entry with the given `repoId` exists.
 *
 * @param ledgerRoot - Absolute path to the centralized ledger root directory.
 * @param repoId     - The `id` field of the repository entry to remove.
 */
export async function handleDeleteRepo(
  ledgerRoot: string,
  repoId: string
): Promise<{ deleted: true }> {
  const found = await findEntryInStores(ledgerRoot, repoId);
  if (!found) {
    throw new ApiError('NOT_FOUND', `Repository not found: '${repoId}'.`);
  }
  const { storePath } = found;
  const registry = await loadRegistry(storePath);
  const updatedRepositories = registry.repositories.filter((e) => e.id !== repoId);
  await saveRegistry(storePath, { repositories: updatedRepositories });
  return { deleted: true };
}

// ---------------------------------------------------------------------------
// POST /api/repos/:repoId/move
// ---------------------------------------------------------------------------

/**
 * Body schema for POST /api/repos/:repoId/move.
 *
 * Exported so that test code can construct and inspect validated shapes.
 * Not intended as a stable public API — treat as `@internal`.
 */
export const RepoMoveBodySchema = z
  .object({
    target_store_id: z.string().min(1),
  })
  .strict();

/**
 * Moves a repository declaration from its current store to a different store.
 *
 * Performs the move atomically: removes the entry from the source registry and
 * appends it to the target registry in a single logical transaction (two
 * sequential writes — source first, then target).
 *
 * Validations (in order):
 *   1. Multi-store mode must be active (VALIDATION_ERROR otherwise).
 *   2. Request body must conform to {@link RepoMoveBodySchema}.
 *   3. `target_store_id` must reference a known store.
 *   4. `repoId` must exist in some store (NOT_FOUND otherwise).
 *   5. Same-store move short-circuits — returns the entry with `store_id` without writes.
 *   6. `repoId` must not already exist in the target store.
 *   7. No `folder_names` value may already appear in the target store.
 *
 * Returns the moved entry (with updated `last_modified`) and the `store_id` of
 * the target store.
 *
 * @param ledgerRoot - Absolute path to the centralized ledger root directory.
 * @param repoId     - The `id` field of the repository entry to move.
 * @param body       - Parsed request body (any shape — validated here).
 */
export async function handleMoveRepo(
  ledgerRoot: string,
  repoId: string,
  body: unknown
): Promise<RepositoryEntry & { store_id: string }> {
  if (!isStoreContextInitialized() || !getStoreRouter().isMultiStoreMode()) {
    validationError('Repository move requires multi-store mode.');
  }

  const parsed = RepoMoveBodySchema.safeParse(body);
  if (!parsed.success) {
    validationError('Invalid request body.', parsed.error.flatten().fieldErrors);
  }
  const { target_store_id } = parsed.data;

  const stores = getStoreRouter().getAllStores();
  const targetStore = stores.find((s) => s.id === target_store_id);
  if (!targetStore) {
    validationError(`Unknown target_store_id: '${target_store_id}'.`);
  }

  const found = await findEntryInStores(ledgerRoot, repoId);
  if (!found) {
    throw new ApiError('NOT_FOUND', `Repository not found: '${repoId}'.`);
  }
  const { storePath: sourceStorePath, entry } = found;

  // Same-store no-op — return entry with current store_id without any writes.
  if (sourceStorePath === targetStore.path) {
    const sourceStore = stores.find((s) => s.path === sourceStorePath)!;
    return { ...entry, store_id: sourceStore.id };
  }

  const targetRegistry = await loadRegistry(targetStore.path);

  if (targetRegistry.repositories.some((e) => e.id === repoId)) {
    validationError(`A repository with id '${repoId}' already exists in the target store.`);
  }

  assertNoFolderNameConflicts(targetRegistry.repositories, entry.folder_names);

  // Remove from source registry, then append to target registry.
  const sourceRegistry = await loadRegistry(sourceStorePath);
  const updatedSource = sourceRegistry.repositories.filter((e) => e.id !== repoId);
  await saveRegistry(sourceStorePath, { repositories: updatedSource });

  const movedEntry: RepositoryEntry = RepositoryEntrySchema.parse({
    ...entry,
    last_modified: nowIso(),
  });
  await saveRegistry(targetStore.path, {
    repositories: [...targetRegistry.repositories, movedEntry],
  });

  return { ...movedEntry, store_id: target_store_id };
}

```
###  Path: `/mcp-server/gui/api-stores.ts`

```ts
/**
 * GUI API Route Handlers — Stores Domain
 *
 * All REST handlers for the /api/stores and /api/stores/:storeId endpoints.
 * Follows the domain-split pattern established by `api-repos.ts` and
 * `api-knowledge.ts` — each API domain gets its own handler file imported
 * from `server.ts`.
 *
 * Routes provided (managed by buildStoreRoutes() in server.ts):
 *   GET    /api/stores                       — enriched store list (replaces old handleGetStores)
 *   GET    /api/stores/conflicts             — cross-store repository conflicts
 *   POST   /api/stores                       — add a new store (creates directory)
 *   POST   /api/stores/import                — import existing directory as a store
 *   PUT    /api/stores/order                  — reorder stores
 *   PUT    /api/stores/:storeId              — update store label
 *   DELETE /api/stores/:storeId              — remove a store (deregisters only)
 *   POST   /api/stores/:storeId/default      — set the default store
 *
 * Validation rules:
 *   - `id`: must match SLUG_REGEX; must not be a reserved word ("import",
 *     "order", "conflicts"); must be unique.
 *   - `path`: must be absolute (/... or C:\... on Windows) or home-relative
 *     (~/...); relative paths are rejected. Duplicate resolved paths are rejected
 *     with 409.
 *   - `label`: optional; trimmed; whitespace-only rejected with 400.
 *
 * Git detection:
 *   - Each store is tested with `git rev-parse --git-dir` (5-second timeout).
 *   - `ahead`/`behind` come from `git rev-list --left-right --count HEAD...@{upstream}`.
 *   - All git commands degrade gracefully: ENOENT → is_git: false; timeout or
 *     no upstream → ahead/behind omitted.
 *
 * Error shape: { code: string, message: string, details?: unknown }
 *   NOT_FOUND        → 404
 *   VALIDATION_ERROR → 400
 *   CONFLICT         → 409
 *   INTERNAL_ERROR   → 500
 *
 * STDIO discipline: this file never writes to process.stdout.
 */

import { execFile } from 'node:child_process';
import { mkdir, writeFile, stat, readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { z } from 'zod';
import { ApiError } from '../src/gui/errors.js';
import {
  loadStoresConfig,
  saveStoresConfig,
  expandStorePath,
} from '../src/storage/store-registry.js';
import {
  reloadStoreContext,
  isStoreContextInitialized,
  getMultiStoreManager,
} from '../src/storage/store-context.js';
import { LedgerStore } from '../src/storage/ledger-store.js';
import { loadRegistry } from '../src/storage/repository-registry.js';
import { RepositoryRegistrySchema } from '../src/schema/repository-registry.js';
import type { StoresConfig, StoreListItem } from '../src/schema/store-config.js';
import { SLUG_REGEX } from '../src/schema/common.js';
import type { RegistryConflict } from '../src/storage/multi-store-manager.js';

export { ApiError };
export type { StoreListItem };

// ---------------------------------------------------------------------------
// Private constants
// ---------------------------------------------------------------------------

/** Store IDs that collide with literal API path suffixes in buildStoreRoutes(). */
const RESERVED_IDS = new Set(['import', 'order', 'conflicts']);

/** Timeout in milliseconds for git subprocess calls. */
const GIT_TIMEOUT_MS = 5_000;

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function validationError(message: string, details?: unknown): never {
  throw new ApiError('VALIDATION_ERROR', message, details);
}

/**
 * Runs a single git command in the given directory with a 5-second timeout.
 * Rejects on any error (non-zero exit, ENOENT, timeout).
 */
async function runGit(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, timeout: GIT_TIMEOUT_MS });
  return stdout;
}

/**
 * Detects whether `storePath` is a Git repository and, if so, fetches
 * ahead/behind counts relative to the upstream tracking branch.
 *
 * - `is_git: false` when Git is not installed (ENOENT) or the directory is not
 *   a Git repo (non-zero `rev-parse` exit).
 * - `ahead`/`behind` are omitted when no upstream tracking branch exists (exit
 *   128 from `rev-list`) or when any git command times out.
 */
async function detectGitStatus(
  storePath: string
): Promise<{ is_git: boolean; ahead?: number; behind?: number }> {
  try {
    await runGit(['rev-parse', '--git-dir'], storePath);
  } catch (err) {
    // ENOENT → git not installed; any other error → not a git repo
    return { is_git: false };
  }

  // Is a git repo — try to get ahead/behind counts
  try {
    const raw = await runGit(
      ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'],
      storePath
    );
    const parts = raw.trim().split(/\s+/);
    const ahead = parseInt(parts[0] ?? '', 10);
    const behind = parseInt(parts[1] ?? '', 10);
    if (!isNaN(ahead) && !isNaN(behind)) {
      return { is_git: true, ahead, behind };
    }
  } catch {
    // No upstream, timeout, or detached HEAD — ahead/behind omitted
  }

  return { is_git: true };
}

/**
 * Builds the enriched StoreListItem array from an in-memory StoresConfig.
 *
 * All stores are processed concurrently via `Promise.all`. Git detection for
 * each store runs concurrently alongside the project/registry I/O.
 */
async function buildEnrichedMultiStoreList(config: StoresConfig): Promise<StoreListItem[]> {
  return Promise.all(
    config.stores.map(async (entry) => {
      const expandedPath = expandStorePath(entry.path);
      const [[projects, registry], gitStatus] = await Promise.all([
        Promise.all([
          LedgerStore.listAllProjects(expandedPath),
          loadRegistry(expandedPath),
        ]),
        detectGitStatus(expandedPath),
      ]);
      return {
        id: entry.id,
        label: entry.label ?? entry.id,
        path: expandedPath,
        project_count: projects.length,
        repository_count: registry.repositories.length,
        is_default: entry.id === config.default_store,
        is_git: gitStatus.is_git,
        ...(gitStatus.ahead !== undefined ? { ahead: gitStatus.ahead } : {}),
        ...(gitStatus.behind !== undefined ? { behind: gitStatus.behind } : {}),
        ...(entry.sync !== undefined ? { sync: entry.sync } : {}),
      };
    })
  );
}

/** Returns true for Windows absolute paths like C:\ or C:/. */
function isWindowsAbsolutePath(p: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(p);
}

/**
 * Rejects relative paths. Accepts Unix absolute (/...), home-relative (~/...),
 * and Windows absolute paths (C:\... or C:/...).
 */
function assertAbsolutePath(rawPath: string): void {
  if (!rawPath.startsWith('/') && !rawPath.startsWith('~/') && rawPath !== '~' && !isWindowsAbsolutePath(rawPath)) {
    validationError(
      `Store path must be absolute (starting with / or a drive letter on Windows) or home-relative (starting with ~/). ` +
        `Relative paths are not supported.`
    );
  }
}

/** Rejects IDs that shadow literal API path suffixes. */
function assertNotReservedId(id: string): void {
  if (RESERVED_IDS.has(id)) {
    validationError(`Store ID "${id}" is reserved. Choose a different identifier.`);
  }
}

/** Trims a label and rejects empty/whitespace-only values. */
function normalizeLabel(label: string): string {
  const trimmed = label.trim();
  if (trimmed === '') {
    validationError('label must not be whitespace-only.');
  }
  return trimmed;
}

/** Throws CONFLICT when a store with `id` already exists in `config`. */
function assertNoDuplicateId(config: StoresConfig | null, id: string): void {
  if (config !== null && config.stores.some((s) => s.id === id)) {
    throw new ApiError('CONFLICT', `A store with id "${id}" already exists.`);
  }
}

/** Throws CONFLICT when a store with the same resolved `expandedPath` already exists. */
function assertNoDuplicatePath(config: StoresConfig | null, expandedPath: string): void {
  if (config === null) return;
  for (const s of config.stores) {
    let existingExpanded: string;
    try {
      existingExpanded = expandStorePath(s.path);
    } catch {
      continue; // skip entries with unresolvable paths
    }
    if (existingExpanded === expandedPath) {
      throw new ApiError('CONFLICT', `A store already exists at path "${expandedPath}".`);
    }
  }
}

/**
 * Creates the store directory (no-op if it already exists) and seeds an empty
 * `.repositories.json` when one is not already present.
 *
 * Throws ApiError with code 'INTERNAL_ERROR' (→ 500) on EACCES / EPERM.
 */
async function createStoreDirectory(expandedPath: string): Promise<void> {
  try {
    await mkdir(expandedPath, { recursive: true });
  } catch (err) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr.code === 'EACCES' || nodeErr.code === 'EPERM') {
      throw new ApiError(
        'INTERNAL_ERROR',
        `Cannot create store directory: permission denied at ${expandedPath}.`
      );
    }
    throw err;
  }

  const registryPath = join(expandedPath, '.repositories.json');
  try {
    await stat(registryPath);
    // File already exists — do not overwrite
  } catch {
    // File does not exist — create an empty registry
    try {
      await writeFile(registryPath, JSON.stringify({ repositories: [] }), 'utf-8');
    } catch (err) {
      const nodeErr = err as NodeJS.ErrnoException;
      if (nodeErr.code === 'EACCES' || nodeErr.code === 'EPERM') {
        throw new ApiError(
          'INTERNAL_ERROR',
          `Cannot create store directory: permission denied at ${expandedPath}.`
        );
      }
      throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// Request body schemas
// ---------------------------------------------------------------------------

const AddStoreBodySchema = z
  .object({
    id: z.string().regex(SLUG_REGEX, {
      message:
        'id must start with an alphanumeric character and contain only letters, digits, hyphens, and underscores.',
    }),
    path: z.string().min(1, { message: 'path must be a non-empty string.' }),
    label: z.string().optional(),
  })
  .strict();

// Import has identical shape to add; the semantics differ (directory must exist).
const ImportStoreBodySchema = AddStoreBodySchema;

const UpdateStoreBodySchema = z
  .object({
    label: z.string(),
  })
  .strict();

const ReorderStoresBodySchema = z
  .object({
    order: z.array(z.string()),
  })
  .strict();

// ---------------------------------------------------------------------------
// GET /api/stores — handleGetStoresEnriched
// ---------------------------------------------------------------------------

/**
 * Returns the list of configured stores, each enriched with `is_default`,
 * `is_git`, optional `ahead`/`behind`, project and repository counts, and
 * optional `sync` metadata.
 *
 * Mode selection is based on `loadStoresConfig()`:
 * - **Multi-store** (non-null config): iterates `config.stores`.
 * - **Legacy / single-store** (null config): returns a single synthesized entry
 *   for `ledgerRoot` with `id: 'default'` and `label: 'Default Store'`.
 *
 * Git commands run concurrently (Promise.all) and degrade gracefully on
 * failure — no 500 errors from missing Git or unreachable remotes.
 *
 * @param ledgerRoot - Absolute ledger root path; used to resolve store paths and
 *   project/repository counts in single-store legacy mode (when `loadStoresConfig()`
 *   returns null).
 */
export async function handleGetStoresEnriched(ledgerRoot: string): Promise<StoreListItem[]> {
  const config = await loadStoresConfig();

  if (config !== null) {
    return buildEnrichedMultiStoreList(config);
  }

  // Legacy / single-store mode: synthesize a single default entry.
  const [[projects, registry], gitStatus] = await Promise.all([
    Promise.all([
      LedgerStore.listAllProjects(ledgerRoot),
      loadRegistry(ledgerRoot),
    ]),
    detectGitStatus(ledgerRoot),
  ]);

  return [
    {
      id: 'default',
      label: 'Default Store',
      path: ledgerRoot,
      project_count: projects.length,
      repository_count: registry.repositories.length,
      is_default: true,
      is_git: gitStatus.is_git,
      ...(gitStatus.ahead !== undefined ? { ahead: gitStatus.ahead } : {}),
      ...(gitStatus.behind !== undefined ? { behind: gitStatus.behind } : {}),
    },
  ];
}

// ---------------------------------------------------------------------------
// GET /api/stores/conflicts — handleGetStoreConflicts
// ---------------------------------------------------------------------------

/**
 * Returns the list of repositories registered in more than one store.
 *
 * Delegates to `MultiStoreManager.getRegistryConflicts()`. Returns an empty
 * array in single-store / legacy mode (no cross-store conflicts possible).
 */
export async function handleGetStoreConflicts(): Promise<RegistryConflict[]> {
  if (!isStoreContextInitialized()) {
    return [];
  }
  return getMultiStoreManager().getRegistryConflicts();
}

// ---------------------------------------------------------------------------
// POST /api/stores — handleAddStore
// ---------------------------------------------------------------------------

/**
 * Adds a new store to `stores.json`.
 *
 * Creates the store directory and seeds an empty `.repositories.json` when
 * neither already exists. Creates `stores.json` if none exists (first-store
 * scenario — the new store becomes the default).
 *
 * Validation: slug ID, reserved-ID rejection, absolute path, duplicate
 * id/path detection, optional label trimming.
 *
 * @returns Updated enriched store list.
 */
export async function handleAddStore(body: unknown): Promise<StoreListItem[]> {
  const parsed = AddStoreBodySchema.safeParse(body);
  if (!parsed.success) {
    validationError(parsed.error.issues[0]?.message ?? 'Invalid request body.');
  }

  const { id, path: rawPath, label } = parsed.data;
  const trimmedLabel = label !== undefined ? normalizeLabel(label) : undefined;

  assertNotReservedId(id);
  assertAbsolutePath(rawPath);

  let expandedPath: string;
  try {
    expandedPath = expandStorePath(rawPath);
  } catch (err) {
    validationError((err as Error).message);
  }

  const config = await loadStoresConfig();
  assertNoDuplicateId(config, id);
  assertNoDuplicatePath(config, expandedPath!);

  await createStoreDirectory(expandedPath!);

  const newEntry = {
    id,
    path: rawPath,
    ...(trimmedLabel !== undefined ? { label: trimmedLabel } : {}),
  };

  const newConfig: StoresConfig =
    config !== null
      ? { ...config, stores: [...config.stores, newEntry] }
      : { stores: [newEntry], default_store: id };

  await saveStoresConfig(newConfig);
  await reloadStoreContext();

  return buildEnrichedMultiStoreList(newConfig);
}

// ---------------------------------------------------------------------------
// POST /api/stores/import — handleImportStore
// ---------------------------------------------------------------------------

/**
 * Imports an existing directory as a store in `stores.json`.
 *
 * Unlike `handleAddStore`, the target directory **must already exist** and the
 * handler never creates it. Any existing `.repositories.json` is preserved
 * as-is; a `warning` is included in the response when it is present but fails
 * schema validation. Creates `stores.json` if none exists (first-store).
 *
 * @returns Wrapped response `{ stores, warning? }` where `stores` is the
 *   updated enriched store list.
 */
export async function handleImportStore(
  body: unknown
): Promise<{ stores: StoreListItem[]; warning?: string }> {
  const parsed = ImportStoreBodySchema.safeParse(body);
  if (!parsed.success) {
    validationError(parsed.error.issues[0]?.message ?? 'Invalid request body.');
  }

  const { id, path: rawPath, label } = parsed.data;
  const trimmedLabel = label !== undefined ? normalizeLabel(label) : undefined;

  assertNotReservedId(id);
  assertAbsolutePath(rawPath);

  let expandedPath: string;
  try {
    expandedPath = expandStorePath(rawPath);
  } catch (err) {
    validationError((err as Error).message);
  }

  // Directory must already exist
  try {
    const s = await stat(expandedPath!);
    if (!s.isDirectory()) {
      validationError(`Path "${expandedPath!}" exists but is not a directory.`);
    }
  } catch (err) {
    if (err instanceof ApiError) throw err;
    validationError(`Directory does not exist at path "${expandedPath!}".`);
  }

  const config = await loadStoresConfig();
  assertNoDuplicateId(config, id);
  assertNoDuplicatePath(config, expandedPath!);

  // Check for a corrupted .repositories.json (preserve it regardless)
  let warning: string | undefined;
  const registryFilePath = join(expandedPath!, '.repositories.json');
  try {
    const content = await readFile(registryFilePath, 'utf-8');
    try {
      RepositoryRegistrySchema.parse(JSON.parse(content));
    } catch {
      warning =
        'Existing .repositories.json is present but could not be validated — it may need manual repair.';
    }
  } catch {
    // File absent — no warning
  }

  const newEntry = {
    id,
    path: rawPath,
    ...(trimmedLabel !== undefined ? { label: trimmedLabel } : {}),
  };

  const newConfig: StoresConfig =
    config !== null
      ? { ...config, stores: [...config.stores, newEntry] }
      : { stores: [newEntry], default_store: id };

  await saveStoresConfig(newConfig);
  await reloadStoreContext();

  const stores = await buildEnrichedMultiStoreList(newConfig);
  return warning !== undefined ? { stores, warning } : { stores };
}

// ---------------------------------------------------------------------------
// PUT /api/stores/:storeId — handleUpdateStore
// ---------------------------------------------------------------------------

/**
 * Updates the label of an existing store.
 *
 * The label is trimmed; whitespace-only values are rejected with 400.
 *
 * @returns Updated enriched store list.
 */
export async function handleUpdateStore(
  storeId: string,
  body: unknown
): Promise<StoreListItem[]> {
  const parsed = UpdateStoreBodySchema.safeParse(body);
  if (!parsed.success) {
    validationError(parsed.error.issues[0]?.message ?? 'Invalid request body.');
  }

  const { label } = parsed.data;
  const trimmedLabel = normalizeLabel(label);

  const config = await loadStoresConfig();
  if (config === null) {
    throw new ApiError('NOT_FOUND', `Store "${storeId}" not found.`);
  }

  const storeIndex = config.stores.findIndex((s) => s.id === storeId);
  if (storeIndex === -1) {
    throw new ApiError('NOT_FOUND', `Store "${storeId}" not found.`);
  }

  const updatedStores = config.stores.map((s, i) =>
    i === storeIndex ? { ...s, label: trimmedLabel } : s
  );
  const newConfig: StoresConfig = { ...config, stores: updatedStores };

  await saveStoresConfig(newConfig);
  await reloadStoreContext();

  return buildEnrichedMultiStoreList(newConfig);
}

// ---------------------------------------------------------------------------
// DELETE /api/stores/:storeId — handleRemoveStore
// ---------------------------------------------------------------------------

/**
 * Removes a store from `stores.json`.
 *
 * - Rejects removal of the last store (schema requires ≥ 1 store).
 * - If the removed store was the default, the first remaining store becomes
 *   the new default (matching CLI `storeRemove` behavior).
 * - The store directory is **not** deleted from disk.
 *
 * @returns `{ stores, warned }` where `warned` is `true` when the removed
 *   store had registered repositories.
 */
export async function handleRemoveStore(
  storeId: string
): Promise<{ stores: StoreListItem[]; warned: boolean }> {
  const config = await loadStoresConfig();
  if (config === null) {
    throw new ApiError('NOT_FOUND', `Store "${storeId}" not found.`);
  }

  const storeIndex = config.stores.findIndex((s) => s.id === storeId);
  if (storeIndex === -1) {
    throw new ApiError('NOT_FOUND', `Store "${storeId}" not found.`);
  }

  if (config.stores.length === 1) {
    validationError('Cannot remove the last store. At least one store must remain configured.');
  }

  // Check for registered repositories (for the warned flag)
  const storeEntry = config.stores[storeIndex]!;
  let warned = false;
  try {
    const expandedPath = expandStorePath(storeEntry.path);
    const registry = await loadRegistry(expandedPath);
    warned = registry.repositories.length > 0;
  } catch {
    // Path unresolvable — proceed without warning
  }

  const remainingStores = config.stores.filter((_, i) => i !== storeIndex);

  // Reassign default to the first remaining store if the removed store was default
  const newDefault =
    config.default_store === storeId ? remainingStores[0]!.id : config.default_store;

  const newConfig: StoresConfig = {
    ...config,
    stores: remainingStores,
    default_store: newDefault,
  };

  await saveStoresConfig(newConfig);
  await reloadStoreContext();

  const stores = await buildEnrichedMultiStoreList(newConfig);
  return { stores, warned };
}

// ---------------------------------------------------------------------------
// POST /api/stores/:storeId/default — handleSetDefaultStore
// ---------------------------------------------------------------------------

/**
 * Sets the default store in `stores.json`.
 *
 * @returns Updated enriched store list.
 */
export async function handleSetDefaultStore(storeId: string): Promise<StoreListItem[]> {
  const config = await loadStoresConfig();
  if (config === null) {
    throw new ApiError('NOT_FOUND', `Store "${storeId}" not found.`);
  }

  if (!config.stores.some((s) => s.id === storeId)) {
    throw new ApiError('NOT_FOUND', `Store "${storeId}" not found.`);
  }

  const newConfig: StoresConfig = { ...config, default_store: storeId };

  await saveStoresConfig(newConfig);
  await reloadStoreContext();

  return buildEnrichedMultiStoreList(newConfig);
}

// ---------------------------------------------------------------------------
// PUT /api/stores/order — handleReorderStores
// ---------------------------------------------------------------------------

/**
 * Reorders the `stores` array in `stores.json`.
 *
 * The `order` array must be an exact permutation of the current store IDs:
 * - Same length (catches duplicates).
 * - Every ID in `order` must exist in config (no unknowns).
 * - Every ID in config must appear in `order` (no omissions).
 *
 * Store order determines conflict-resolution priority.
 *
 * @returns Updated enriched store list.
 */
export async function handleReorderStores(body: unknown): Promise<StoreListItem[]> {
  const parsed = ReorderStoresBodySchema.safeParse(body);
  if (!parsed.success) {
    validationError(parsed.error.issues[0]?.message ?? 'Invalid request body.');
  }

  const { order } = parsed.data;

  const config = await loadStoresConfig();
  if (config === null) {
    validationError('No stores are configured to reorder.');
  }

  const existingIds = config!.stores.map((s) => s.id);

  if (order.length !== existingIds.length) {
    validationError(
      `order array length (${order.length}) does not match the number of configured stores (${existingIds.length}).`
    );
  }

  const existingIdSet = new Set(existingIds);
  for (const id of order) {
    if (!existingIdSet.has(id)) {
      validationError(`Unknown store id "${id}" in order array.`);
    }
  }

  const orderSet = new Set(order);
  for (const id of existingIds) {
    if (!orderSet.has(id)) {
      validationError(`Store id "${id}" is missing from the order array.`);
    }
  }

  const storeMap = new Map(config!.stores.map((s) => [s.id, s]));
  const reorderedStores = order.map((id) => storeMap.get(id)!);

  const newConfig: StoresConfig = { ...config!, stores: reorderedStores };

  await saveStoresConfig(newConfig);
  await reloadStoreContext();

  return buildEnrichedMultiStoreList(newConfig);
}

```
###  Path: `/mcp-server/gui/api.ts`

```ts
/**
 * GUI API Route Handlers
 *
 * Pure async functions — one per REST endpoint. Each handler accepts parsed
 * request parameters and returns a result object (or throws a structured error).
 * The HTTP server (gui/server.ts) calls these handlers and maps results to HTTP
 * responses.
 *
 * Error shape:  { code: string, message: string, details?: unknown }
 *   NOT_FOUND        → 404
 *   FORBIDDEN        → 403
 *   VALIDATION_ERROR → 400
 *   (unhandled)      → 500
 *
 * STDIO discipline: this file never writes to process.stdout.
 */

import { rm, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { z } from 'zod';
import { LedgerStore, SlugConflictError } from '../src/storage/ledger-store.js';
import { withLock } from '../src/storage/file-lock.js';
import { inferProjectRootFromPlanPath, resolveProjectDir } from '../src/utils/ledger-root.js';
import { assertSafeSegment } from '../src/utils/path-validator.js';
import { readProjectName } from '../src/utils/read-project-name.js';
import { PLAN_ARCHIVE_FILENAME, SYNTHESIS_ARCHIVE_FILENAME, DIALOGUES_DIR, CHUNKS_DIR } from '../src/utils/constants.js';
import {
  PIPELINE_AGENT_MAP,
  DEFAULT_PIPELINE_STAGES,
  CANONICAL_PIPELINE_ORDERING,
} from '../src/utils/pipeline-maps.js';
import type { PipelineType } from '../src/utils/pipeline-maps.js';
import { ProjectMetaSchema } from '../src/schema/project-meta.js';
import type { ProjectMeta } from '../src/schema/project-meta.js';
import type { ProjectStatus, WorkPackageStatus } from '../src/schema/enums.js';
import type { RootIndex } from '../src/schema/root-index.js';
import type { WorkPackageDetail } from '../src/schema/work-package.js';

/**
 * Extended WP detail response that includes the server's canonical default pipeline stages.
 * The extra field is additive — all existing fields of WorkPackageDetail are preserved.
 */
export type WorkPackageDetailResponse = WorkPackageDetail & {
  default_pipeline_stages: string[];
};
import { getConfig, writeConfig, GuiConfigPartialSchema } from '../src/gui/config.js';
import type { GuiConfig } from '../src/gui/config.js';
import {
  analyzeProjectForReset,
  applyProjectReset,
  getPassedStages,
  markProjectComplete,
} from '../src/utils/project-reset.js';
import type {
  WpDecision,
  ProjectResetDiagnosis,
  ProjectResetResult,
  MarkProjectCompleteResult,
} from '../src/utils/project-reset.js';
import { ApiError } from '../src/gui/errors.js';
import {
  getMultiStoreManager,
  getStoreRouter,
  isStoreContextInitialized,
} from '../src/storage/store-context.js';
import { loadRegistry } from '../src/storage/repository-registry.js';
import type { TaggedProjectMeta } from '../src/storage/multi-store-manager.js';
export { ApiError };
import {
  getQueue,
  killQueueEntry,
  dismissQueueEntry,
  deleteQueueEntry,
  startOrchestrator,
  getRunStatus,
} from './orchestrator-manager.js';
import type { QueueEntry, KillResult, StartResult, RunStatus, PreflightResult } from './orchestrator-manager.js';
import { renderChunksToText } from './chunk-renderer.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function notFound(message: string): never {
  throw new ApiError('NOT_FOUND', message);
}

function forbidden(message: string): never {
  throw new ApiError('FORBIDDEN', message);
}

function conflict(message: string): never {
  throw new ApiError('CONFLICT', message);
}

function validationError(message: string, details?: unknown): never {
  throw new ApiError('VALIDATION_ERROR', message, details);
}

/**
 * Allowlist for WP IDs and queue entry IDs: must start with alnum, then word chars or hyphens.
 * Note: `\w` includes underscore intentionally — WP IDs (`WP-001`) and queue entry IDs may
 * contain underscores in future formats. This is permissive by design.
 */
const SAFE_ID_PATTERN = /^[A-Za-z0-9][\w-]*$/;

/**
 * Guards against path-traversal attacks on the project slug URL parameter.
 *
 * Rejects any slug that does not satisfy the safe-slug rules
 * (lowercase alphanumeric + hyphens, must start with an alphanumeric character).
 * This reuses the same slug format enforced on project creation and rename,
 * ensuring only lowercase alphanumeric characters and hyphens are accepted —
 * eliminating path separators and traversal sequences by design.
 *
 * @param slug - The raw slug string extracted from the request URL.
 */
function assertSafeSlug(slug: string): void {
  if (!assertSafeSegment(slug)) {
    notFound(`Invalid project slug: '${slug}'.`);
  }
}

/**
 * Guards against path-traversal attacks on the work-package ID URL parameter.
 *
 * Rejects any wpId that does not match {@link SAFE_ID_PATTERN}
 * (`/^[A-Za-z0-9][\w-]*$/`). Requires an alphanumeric first character,
 * blocking `..`, `.`, and all path separators by design.
 *
 * @param wpId - The raw work-package ID string extracted from the request URL.
 */
function assertSafeWpId(wpId: string): void {
  if (!wpId || !SAFE_ID_PATTERN.test(wpId)) {
    notFound(`Invalid work-package ID: '${wpId}'.`);
  }
}

/**
 * Guards against path-traversal attacks on the orchestrator queue entry ID
 * URL parameter.
 *
 * Rejects any id that does not match {@link SAFE_ID_PATTERN}
 * (`/^[A-Za-z0-9][\w-]*$/`). Requires an alphanumeric first character,
 * blocking `..`, `.`, and all path separators by design.
 *
 * @param id - The raw queue entry ID string extracted from the request URL.
 */
function assertSafeQueueId(id: string): void {
  if (!id || !SAFE_ID_PATTERN.test(id)) {
    notFound(`Invalid queue entry ID: '${id}'.`);
  }
}

/**
 * Resolves a LedgerStore for URL-parameter-driven handlers.
 *
 * Locates the namespaced storage directory via resolveProjectDir(), reads
 * .meta.json for plan_path, and constructs a LedgerStore from it. Callers
 * must validate `slug` (via assertSafeSlug) before calling. If `repoName` is
 * provided, it is validated here via assertSafeSlug before being joined with
 * `slug` to form a qualified `{repo}/{slug}` lookup.
 *
 * @remarks **Security contract — AMBIGUOUS → NOT_FOUND downgrade:**
 * When `resolveProjectDir()` throws an AMBIGUOUS error (multiple repos contain
 * this slug), this function intentionally downgrades it to the same NOT_FOUND
 * ApiError used for a missing project. This prevents callers from learning
 * that a slug exists in any repository (cross-namespace existence leak).
 * The inline comment in the catch block documents the downgrade decision;
 * do not restore the original AMBIGUOUS message without a security review.
 *
 * @remarks **Diagnostic logging — metadata read failures:**
 * When reading `.meta.json` fails (e.g. file missing, corrupt JSON, schema
 * mismatch), the second catch block logs a structured message to `stderr`
 * before calling `notFound()`. The log line includes the slug, optional repo
 * name, and the error message so operators can diagnose storage issues without
 * enabling debug-level verbosity. The function's externally-visible behaviour
 * is unchanged: callers always receive a NOT_FOUND response. Do not remove the
 * `stderr.write` call — it is the only signal that distinguishes a missing
 * project from a corrupted metadata file in production logs.
 *
 * @throws ApiError NOT_FOUND when the project cannot be located, is ambiguous
 *   across namespaces, or has no metadata.
 */
async function resolveProjectStore(
  ledgerRoot: string,
  slug: string,
  repoName?: string
): Promise<LedgerStore> {
  if (repoName !== undefined) {
    assertSafeSlug(repoName);
  }
  const slugOrQualified = repoName !== undefined ? `${repoName}/${slug}` : slug;

  // In multi-store mode, search all configured stores; fall back to default store otherwise.
  const storePaths =
    isStoreContextInitialized() && getStoreRouter().isMultiStoreMode()
      ? getStoreRouter().getAllStorePaths()
      : [ledgerRoot];

  for (const storePath of storePaths) {
    let storageDir: string;
    try {
      storageDir = await resolveProjectDir(slugOrQualified, storePath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // NOT_FOUND or AMBIGUOUS in this store: try next store. AMBIGUOUS is
      // downgraded to NOT_FOUND to prevent cross-namespace existence leaks
      // (security contract — see JSDoc above).
      if (msg.startsWith('NOT_FOUND') || msg.startsWith('AMBIGUOUS')) {
        continue;
      }
      throw err;
    }

    try {
      const raw = await readFile(join(storageDir, '.meta.json'), 'utf-8');
      const meta = ProjectMetaSchema.parse(JSON.parse(raw));
      return new LedgerStore(meta.plan_path, storePath);
    } catch (err) {
      // ENOENT means the project doesn't live in this store — try the next one.
      // This handles the qualified-slug case where resolveProjectDir() constructs
      // the path without checking existence.
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') continue;

      // Corrupt JSON or schema validation failure — log for operator diagnostics
      // (stderr only) and return 404 to the caller.
      const errMsg = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        `[resolveProjectStore] Failed to read metadata for slug="${slug}"` +
          (repoName !== undefined ? ` repo="${repoName}"` : '') +
          `: ${errMsg}\n`
      );
      notFound(`Project '${slug}' not found or has no metadata.`);
    }
  }

  notFound(`Project '${slug}' not found.`);
}

// ---------------------------------------------------------------------------
// GET /api/projects
// ---------------------------------------------------------------------------

export interface ProjectSummary extends ProjectMeta {
  total_work_packages: number;
  pending_work_packages: number;
  progress_pct: number;
  project_name: string | null;
  repository_name: string | null;
}

/** Fields that the project list can be sorted by. */
export type ProjectSortField =
  | 'project'
  | 'repository'
  | 'status'
  | 'total_work_packages'
  | 'done'
  | 'date_created'
  | 'last_updated'
  | 'runner';

/** Raw query parameters accepted by GET /api/projects. */
export interface ProjectListParams {
  page?: number | string;
  limit?: number | string;
  /** 'ACTIVE' (default), 'ALL', or a specific ProjectStatus value. */
  status?: string;
  /** Case-insensitive substring match on slug, project_name, repository_name. */
  search?: string;
  /** Sort column. Defaults to 'last_updated'. */
  sort?: string;
  /** 'asc' or 'desc'. Defaults to 'desc'. */
  dir?: string;
  /** Normalized runner filter ('orchestrator', 'vscode', 'claude-code', 'unknown'). Unrecognized values return empty results without a 500. */
  runner?: string;
  /** Repository name filter (exact match on repository_name). */
  repository?: string;
}

/** Paginated response envelope returned by handleListProjects. */
export interface ProjectListEnvelope {
  projects: ProjectSummary[];
  total: number;
  page: number;
  limit: number;
  total_pages: number;
  /** Per-status counts computed from the search-filtered set (before status filter). */
  status_counts: Record<string, number>;
  /** Per-runner counts computed from the search-filtered set (before runner filter). 'unknown' for projects without a stored runner field. */
  runner_counts: Record<string, number>;
  /** Per-repository counts computed from the search-filtered set (before status/runner/repository filters). */
  repo_counts: Record<string, number>;
}

const SORT_FIELDS = new Set<ProjectSortField>([
  'project',
  'repository',
  'status',
  'total_work_packages',
  'done',
  'date_created',
  'last_updated',
  'runner',
]);

const VALID_STATUS_FILTERS = new Set([
  'ACTIVE', 'ALL', 'READY', 'IN_PROGRESS', 'COMPLETE', 'BLOCKED', 'ARCHIVED', 'CANCELLED',
]);

/**
 * Returns a paginated envelope of enriched project summaries.
 *
 * Processing pipeline:
 *  1. Enrich all projects (cache fast-path from .meta.json when available).
 *  2. Apply search filter to the full list.
 *  3. Compute status_counts from the search-filtered set (before status filter).
 *  4. Apply status filter.
 *  5. Sort.
 *  6. Paginate (slice) and return the envelope.
 *
 * project_name resolution order: manifest file → slug date-strip fallback →
 * meta.title (takes precedence when set).
 * Per-project read failures are isolated so one bad project never breaks
 * the entire response.
 */
export async function handleListProjects(
  ledgerRoot: string,
  rawParams: ProjectListParams = {}
): Promise<ProjectListEnvelope> {
  // --- Validate and sanitise params ---
  const page = Math.max(1, Math.floor(Number(rawParams.page) || 1));
  const limitRaw = rawParams.limit !== undefined ? Math.floor(Number(rawParams.limit)) : 50;
  const limit = Math.min(200, Math.max(1, isNaN(limitRaw) ? 50 : limitRaw));
  const statusFilter =
    rawParams.status !== undefined && VALID_STATUS_FILTERS.has(rawParams.status)
      ? rawParams.status
      : 'ACTIVE';
  const search = (rawParams.search ?? '').trim();
  const sortRaw = rawParams.sort ?? '';
  const sort: ProjectSortField = SORT_FIELDS.has(sortRaw as ProjectSortField)
    ? (sortRaw as ProjectSortField)
    : 'last_updated';
  const dir: 'asc' | 'desc' = rawParams.dir === 'asc' ? 'asc' : 'desc';
  // runner filter — undefined means no filter; any string value (including unrecognized ones) is accepted
  // so that unrecognized runners return an empty set rather than a 500 error.
  const runnerFilter: string | undefined = rawParams.runner;
  const repositoryFilter: string | undefined = rawParams.repository;

  const allProjects: ProjectMeta[] = isStoreContextInitialized()
    ? await getMultiStoreManager().listAllProjects()
    : await LedgerStore.listAllProjects(ledgerRoot);

  // In multi-store mode each project carries its source store_path; in legacy
  // mode the single ledger root is used for all projects.
  function getStorePath(meta: ProjectMeta): string {
    return (meta as TaggedProjectMeta).store_path ?? ledgerRoot;
  }

  // --- Enrich all projects ---
  const enrichedAll = await Promise.all(
    allProjects.map(async (meta): Promise<ProjectSummary> => {
      let total_work_packages = 0;
      let pending_work_packages = 0;
      let progress_pct = 0;
      let project_name: string | null = null;

      const projectRoot = inferProjectRootFromPlanPath(meta.plan_path);

      // Derive project name from slug first — takes precedence over any repo
      // manifest file (package.json etc.), which would return the repository
      // name rather than the individual plan's name. Strips the YYYY-MM-DD-
      // date prefix and title-cases the remainder, e.g.
      // "2026-02-27-gui-enhancements" → "Gui Enhancements".
      const slugMatch = meta.slug.match(/^\d{4}-\d{2}-\d{2}-(.+)$/);
      if (slugMatch) {
        project_name = slugMatch[1]
          .split('-')
          .map((w) => (w.length > 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
          .join(' ');
      }

      // FAST PATH: use cached enrichment values from .meta.json when available.
      // Falls back to I/O-based enrichment for legacy meta files that pre-date
      // the enrichment cache (WP-006). The cached project_name is only used
      // when slug derivation produced no name (non-date-prefixed slugs).
      if (
        meta.total_work_packages !== undefined &&
        meta.project_name !== undefined
      ) {
        total_work_packages = meta.total_work_packages;
        pending_work_packages = meta.pending_work_packages ?? 0;
        progress_pct = meta.progress_pct ?? (total_work_packages > 0
          ? Math.round(((total_work_packages - pending_work_packages) / total_work_packages) * 100)
          : 0);
        if (project_name === null) {
          project_name = meta.project_name;
        }
      } else {
        const store = new LedgerStore(meta.plan_path, getStorePath(meta));

        await Promise.all([
          (async () => {
            try {
              const rootIndex = await store.readRootIndex();
              total_work_packages = rootIndex.total_work_packages ?? 0;
              pending_work_packages = rootIndex.pending_work_packages ?? 0;
              progress_pct = total_work_packages > 0
                ? Math.round(((total_work_packages - pending_work_packages) / total_work_packages) * 100)
                : 0;
            } catch {
              // default to 0
            }
          })(),
          (async () => {
            // Only read the repo manifest when slug derivation produced no name.
            if (project_name === null) {
              project_name = await readProjectName(projectRoot);
            }
          })(),
        ]);
      }

      // Persisted title takes precedence over all auto-detected names.
      if (meta.title && meta.title.trim().length > 0) {
        project_name = meta.title;
      }

      // Derive repository_name from the project root directory name.
      // NOTE: We intentionally do NOT use deriveRepoName() from ledger-root.ts here.
      // deriveRepoName() lowercases and validates the segment against SLUG_REGEX — that is
      // correct for storage keys (e.g. namespaced folder names) but wrong for display fields
      // like repository_name on ProjectSummary, where original casing must
      // be preserved. Both call sites (handleListProjects and the removed insights aggregation)
      // use this inline pattern deliberately; keep them in sync if the derivation logic changes.
      // inline pattern deliberately; keep them in sync if the derivation logic ever changes.
      const repository_name = projectRoot
        ? (projectRoot.split(/[\\/]/).filter(Boolean).pop() ?? null)
        : null;

      return {
        ...meta,
        // Normalize runner: projects without a stored runner field default to 'unknown'
        // for consistent filtering and display.
        runner: meta.runner ?? 'unknown',
        total_work_packages,
        pending_work_packages,
        progress_pct,
        project_name,
        repository_name,
      };
    })
  );

  // --- Step 2: Search filter (applied to full list, before status filter) ---
  const searchLower = search.toLowerCase();
  const searchFiltered = searchLower
    ? enrichedAll.filter(
        (p) =>
          p.slug.toLowerCase().includes(searchLower) ||
          (p.project_name ?? '').toLowerCase().includes(searchLower) ||
          (p.repository_name ?? '').toLowerCase().includes(searchLower)
      )
    : enrichedAll;

  // --- Step 3: Compute status_counts and runner_counts from search-filtered set (before status/runner filter) ---
  const status_counts: Record<string, number> = {};
  const runner_counts: Record<string, number> = {};
  const repo_counts: Record<string, number> = {};
  for (const p of searchFiltered) {
    status_counts[p.status] = (status_counts[p.status] ?? 0) + 1;
    const r = p.runner ?? 'unknown';
    runner_counts[r] = (runner_counts[r] ?? 0) + 1;
    if (p.repository_name) {
      repo_counts[p.repository_name] = (repo_counts[p.repository_name] ?? 0) + 1;
    }
  }

  // --- Step 4a: Status filter ---
  const statusFiltered =
    statusFilter === 'ALL'
      ? searchFiltered
      : statusFilter === 'ACTIVE'
        ? searchFiltered.filter((p) => p.status !== 'ARCHIVED')
        : searchFiltered.filter((p) => p.status === statusFilter);

  // --- Step 4b: Runner filter (applied after status filter; unrecognized values return empty set) ---
  const runnerFiltered =
    runnerFilter !== undefined
      ? statusFiltered.filter((p) => (p.runner ?? 'unknown') === runnerFilter)
      : statusFiltered;

  // --- Step 4c: Repository filter ---
  // repositoryFilter may be a repo ID (from the GUI dropdown) or a raw folder name
  // (fallback / backward-compatible legacy values). When it is a known repo ID,
  // expand it to all folder_names so that multi-alias repos filter correctly.
  let repoFolderNameSet: Set<string> | null = null;
  if (repositoryFilter !== undefined && repositoryFilter !== '') {
    const registryEntries = isStoreContextInitialized()
      ? await getMultiStoreManager().getMergedRegistry()
      : (await loadRegistry(ledgerRoot)).repositories;
    const repoEntry = registryEntries.find((e) => e.id === repositoryFilter);
    if (repoEntry) {
      repoFolderNameSet = new Set(repoEntry.folder_names);
    }
  }
  const filtered =
    repositoryFilter !== undefined && repositoryFilter !== ''
      ? runnerFiltered.filter((p) =>
          repoFolderNameSet
            ? p.repository_name != null && repoFolderNameSet.has(p.repository_name)
            : p.repository_name === repositoryFilter
        )
      : runnerFiltered;

  // --- Step 5: Sort ---
  const sorted = [...filtered].sort((a, b) => {
    let aVal: string | number;
    let bVal: string | number;
    switch (sort) {
      case 'project':
        aVal = (a.project_name ?? a.slug).toLowerCase();
        bVal = (b.project_name ?? b.slug).toLowerCase();
        break;
      case 'repository':
        aVal = (a.repository_name ?? '').toLowerCase();
        bVal = (b.repository_name ?? '').toLowerCase();
        break;
      case 'status':
        aVal = a.status;
        bVal = b.status;
        break;
      case 'total_work_packages':
        aVal = a.total_work_packages;
        bVal = b.total_work_packages;
        break;
      case 'done':
        aVal = a.progress_pct;
        bVal = b.progress_pct;
        break;
      case 'date_created':
        aVal = a.date_created ?? '';
        bVal = b.date_created ?? '';
        break;
      case 'runner':
        aVal = (a.runner ?? 'unknown').toLowerCase();
        bVal = (b.runner ?? 'unknown').toLowerCase();
        break;
      case 'last_updated':
      default:
        aVal = a.last_updated ?? '';
        bVal = b.last_updated ?? '';
        break;
    }
    if (aVal < bVal) return dir === 'asc' ? -1 : 1;
    if (aVal > bVal) return dir === 'asc' ? 1 : -1;
    return 0;
  });

  // --- Step 6: Paginate ---
  const total = sorted.length;
  const total_pages = Math.max(1, Math.ceil(total / limit));
  const start = (page - 1) * limit;
  const pageSlice = sorted.slice(start, start + limit);

  return {
    projects: pageSlice,
    total,
    page,
    limit,
    total_pages,
    status_counts,
    runner_counts,
    repo_counts,
  };
}

// ---------------------------------------------------------------------------
// GET /api/projects/:slug
// ---------------------------------------------------------------------------

export type ProjectDetail = RootIndex & {
  meta: ProjectMeta;
  project_name: string | null;
  timing?: {
    project_elapsed_ms: number | null;
    total_active_ms: number;
    pipeline_runs: number;
  };
};

/**
 * Returns the combined root index + meta for a project.
 * Throws NOT_FOUND if the project slug does not exist in the ledger.
 * project_name resolution order: manifest file → slug date-strip fallback →
 * meta.title (takes precedence when set).
 * @param repoName  Optional repository name used to resolve the namespaced storage path.
 */
export async function handleGetProject(
  ledgerRoot: string,
  slug: string,
  repoName?: string
): Promise<ProjectDetail> {
  assertSafeSlug(slug);
  const store = await resolveProjectStore(ledgerRoot, slug, repoName);

  try {
    const [rootIndex, meta] = await Promise.all([
      store.readRootIndex(),
      store.readProjectMeta(),
    ]);

    // Resolve project_name using the same logic as handleListProjects:
    // slug derivation first, repo manifest only as a last resort.
    let project_name: string | null = null;

    const slugMatch = slug.match(/^\d{4}-\d{2}-\d{2}-(.+)$/);
    if (slugMatch) {
      project_name = slugMatch[1]
        .split('-')
        .map((w) => (w.length > 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
        .join(' ');
    }

    if (project_name === null) {
      const projectRoot = inferProjectRootFromPlanPath(meta.plan_path);
      project_name = await readProjectName(projectRoot);
    }

    if (meta.title && meta.title.trim().length > 0) {
      project_name = meta.title;
    }

    // Compute timing: sum duration_ms across all WP pipelines
    const wpDetails = (
      await Promise.all(
        rootIndex.work_packages.map(async (wpSummary) => {
          try {
            return await store.readWorkPackage(wpSummary.work_package_id);
          } catch {
            return null;
          }
        })
      )
    ).filter((wp): wp is WorkPackageDetail => wp !== null);

    let total_active_ms = 0;
    let pipeline_runs = 0;
    for (const wp of wpDetails) {
      for (const p of wp.pipelines) {
        if (p.duration_ms != null) {
          total_active_ms += p.duration_ms;
          pipeline_runs++;
        }
      }
    }
    const createdAt = meta.date_created ? new Date(meta.date_created).getTime() : NaN;
    // Prefer synthesis_generated_at as the end-time for completed projects: it is set
    // once by ledger_complete_synthesis and never bumped by post-run operations, making
    // it a reliable wall-clock end marker regardless of runner (MCP or orchestrator).
    // synthesis_generated_at lives on the root index, not on ProjectMeta — use rootIndex.
    // Fall back to last_updated for in-progress projects that have not yet synthesised.
    const endTimeStr = rootIndex.synthesis_generated_at ?? meta.last_updated;
    const endAt = endTimeStr ? new Date(endTimeStr).getTime() : NaN;
    const rawElapsedMs = (!isNaN(createdAt) && !isNaN(endAt)) ? endAt - createdAt : null;
    // For standalone projects, date_created and synthesis_generated_at are both written
    // during archival (same moment), so elapsed = 0. Null it out so the UI can show
    // "Not measured" rather than "< 1s".
    const project_elapsed_ms =
      rawElapsedMs === 0 && rootIndex.runner === 'standalone' ? null : rawElapsedMs;

    const timing = { project_elapsed_ms, total_active_ms, pipeline_runs };
    return { ...rootIndex, meta, project_name, timing };
  } catch (err) {
    if (err instanceof ApiError) throw err;
    notFound(`Project '${slug}' not found or corrupted: ${String(err)}`);
  }
}

// ---------------------------------------------------------------------------
// GET /api/projects/:slug/work-packages
// ---------------------------------------------------------------------------

/**
 * Returns the WP summary array from the project's root index.
 * Throws NOT_FOUND if the project does not exist.
 * @param repoName  Optional repository name used to resolve the namespaced storage path.
 */
export async function handleListWorkPackages(
  ledgerRoot: string,
  slug: string,
  repoName?: string
): Promise<RootIndex['work_packages']> {
  assertSafeSlug(slug);
  const store = await resolveProjectStore(ledgerRoot, slug, repoName);

  try {
    const rootIndex = await store.readRootIndex();
    return rootIndex.work_packages;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    notFound(`Project '${slug}' not found or corrupted: ${String(err)}`);
  }
}

// ---------------------------------------------------------------------------
// GET /api/projects/:slug/work-packages/:wpId
// ---------------------------------------------------------------------------

/**
 * Returns the full WP detail for the given WP ID.
 * Throws NOT_FOUND if the project or WP does not exist.
 * @param repoName  Optional repository name used to resolve the namespaced storage path.
 */
export async function handleGetWorkPackage(
  ledgerRoot: string,
  slug: string,
  wpId: string,
  repoName?: string
): Promise<WorkPackageDetailResponse> {
  assertSafeSlug(slug);
  assertSafeWpId(wpId);
  const store = await resolveProjectStore(ledgerRoot, slug, repoName);

  if (!(await store.wpDetailExists(wpId))) {
    notFound(`Work package '${wpId}' not found in project '${slug}'.`);
  }

  try {
    const wp = await store.readWorkPackage(wpId);
    return { ...wp, default_pipeline_stages: [...DEFAULT_PIPELINE_STAGES] };
  } catch (err) {
    if (err instanceof ApiError) throw err;
    notFound(`Work package '${wpId}' not found or corrupted: ${String(err)}`);
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/projects/:slug
// ---------------------------------------------------------------------------

export type DeleteProjectResult = { deleted: true; slug: string };

/**
 * Permanently removes the project's ledger directory.
 * Only COMPLETE projects may be deleted.
 * Throws FORBIDDEN if the project is not COMPLETE.
 * Throws NOT_FOUND if the project does not exist.
 * @param repoName  Optional repository name used to resolve the namespaced storage path.
 */
export async function handleDeleteProject(
  ledgerRoot: string,
  slug: string,
  repoName?: string
): Promise<DeleteProjectResult> {
  assertSafeSlug(slug);
  const store = await resolveProjectStore(ledgerRoot, slug, repoName);

  let meta: ProjectMeta;
  try {
    meta = await store.readProjectMeta();
  } catch {
    notFound(`Project '${slug}' not found or has no metadata.`);
  }

  // TypeScript: meta is always assigned here because the catch above throws via notFound()
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  if (!['COMPLETE', 'ARCHIVED'].includes(meta!.status)) {
    forbidden('Only COMPLETE or ARCHIVED projects can be deleted.');
  }

  await rm(store.storageDir, { recursive: true, force: true });

  return { deleted: true, slug };
}

// ---------------------------------------------------------------------------
// POST /api/projects/:slug/archive
// ---------------------------------------------------------------------------

export type ArchiveProjectResult = { archived: true; slug: string };

/**
 * Transitions a COMPLETE project to ARCHIVED status.
 * Updates both .meta.json and project-ledger.json within a single lock scope.
 * Throws NOT_FOUND if the project does not exist.
 * Throws VALIDATION_ERROR if the project is not in COMPLETE status.
 * @param repoName  Optional repository name used to resolve the namespaced storage path.
 */
export async function handleArchiveProject(
  ledgerRoot: string,
  slug: string,
  repoName?: string
): Promise<ArchiveProjectResult> {
  assertSafeSlug(slug);
  const store = await resolveProjectStore(ledgerRoot, slug, repoName);

  let meta: ProjectMeta;
  try {
    meta = await store.readProjectMeta();
  } catch {
    notFound(`Project '${slug}' not found or has no metadata.`);
  }

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  if (meta!.status !== 'COMPLETE') {
    validationError(`Cannot archive project '${slug}': status is '${meta!.status}', expected 'COMPLETE'.`);
  }

  await withLock(store.storageDir, async () => {
    const rootIndex = await store.readRootIndex();
    // Archiving is an administrative action — preserve last_updated so the
    // project's visible activity time is not distorted.
    await store.writeRootIndex({ ...rootIndex, status: 'ARCHIVED' }, { preserveLastUpdated: true });
  });

  return { archived: true, slug };
}

// ---------------------------------------------------------------------------
// POST /api/projects/:slug/unarchive
// ---------------------------------------------------------------------------

export type UnarchiveProjectResult = { unarchived: true; slug: string };

/**
 * Transitions an ARCHIVED project back to COMPLETE status.
 * Updates both .meta.json and project-ledger.json within a single lock scope.
 * Throws NOT_FOUND if the project does not exist.
 * Throws VALIDATION_ERROR if the project is not in ARCHIVED status.
 * @param repoName  Optional repository name used to resolve the namespaced storage path.
 */
export async function handleUnarchiveProject(
  ledgerRoot: string,
  slug: string,
  repoName?: string
): Promise<UnarchiveProjectResult> {
  assertSafeSlug(slug);
  const store = await resolveProjectStore(ledgerRoot, slug, repoName);

  let meta: ProjectMeta;
  try {
    meta = await store.readProjectMeta();
  } catch {
    notFound(`Project '${slug}' not found or has no metadata.`);
  }

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  if (meta!.status !== 'ARCHIVED') {
    validationError(`Cannot unarchive project '${slug}': status is '${meta!.status}', expected 'ARCHIVED'.`);
  }

  await withLock(store.storageDir, async () => {
    const rootIndex = await store.readRootIndex();
    // Unarchiving is an administrative action — preserve last_updated so the
    // project's visible activity time is not distorted.
    await store.writeRootIndex({ ...rootIndex, status: 'COMPLETE' }, { preserveLastUpdated: true });
  });

  return { unarchived: true, slug };
}

// ---------------------------------------------------------------------------
// POST /api/projects/:slug/complete
// ---------------------------------------------------------------------------

/**
 * Forces every non-CANCELLED work package and the project to COMPLETE status.
 *
 * Throws NOT_FOUND  if the project does not exist.
 * Throws FORBIDDEN  if the project is currently ARCHIVED (unarchive first).
 *
 * STDIO discipline: this function never writes to process.stdout.
 * @param repoName  Optional repository name used to resolve the namespaced storage path.
 */
export async function handleMarkProjectComplete(
  ledgerRoot: string,
  slug: string,
  repoName?: string
): Promise<MarkProjectCompleteResult> {
  assertSafeSlug(slug);
  const store = await resolveProjectStore(ledgerRoot, slug, repoName);

  let rootIndex: RootIndex;
  try {
    rootIndex = await store.readRootIndex();
  } catch (err) {
    notFound(`Project '${slug}' not found or corrupted: ${String(err)}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  if (rootIndex!.status === 'ARCHIVED') {
    forbidden('Cannot mark an archived project as complete. Unarchive it first.');
  }

  return markProjectComplete(store, slug);
}

// ---------------------------------------------------------------------------
// GET /api/projects/:slug/plan
// ---------------------------------------------------------------------------

/**
 * Returns the content of the archived plan.md for a project.
 * Throws NOT_FOUND if the project does not exist or has no archived plan.
 * @param repoName  Optional repository name used to resolve the namespaced storage path.
 */
export async function handleGetPlanDocument(
  ledgerRoot: string,
  slug: string,
  repoName?: string
): Promise<{ content: string }> {
  assertSafeSlug(slug);
  const store = await resolveProjectStore(ledgerRoot, slug, repoName);

  try {
    const planContent = await readFile(join(store.storageDir, PLAN_ARCHIVE_FILENAME), 'utf-8');
    return { content: planContent };
  } catch {
    notFound(`Plan document not found for project '${slug}'.`);
  }
}

// ---------------------------------------------------------------------------
// GET /api/projects/:slug/synthesis
// ---------------------------------------------------------------------------

/**
 * Returns the content of the archived synthesis.md for a project.
 * Throws NOT_FOUND if the project does not exist or has no archived synthesis.
 * @param repoName  Optional repository name used to resolve the namespaced storage path.
 */
export async function handleGetSynthesisDocument(
  ledgerRoot: string,
  slug: string,
  repoName?: string
): Promise<{ content: string }> {
  assertSafeSlug(slug);
  const store = await resolveProjectStore(ledgerRoot, slug, repoName);

  try {
    const synthesisContent = await readFile(
      join(store.storageDir, SYNTHESIS_ARCHIVE_FILENAME),
      'utf-8'
    );
    return { content: synthesisContent };
  } catch {
    notFound(`Synthesis document not found for project '${slug}'.`);
  }
}

// ---------------------------------------------------------------------------
// GET /api/config
// ---------------------------------------------------------------------------

/**
 * Returns the current in-memory GUI config.
 * Never reads from disk — uses the cached value from the config module.
 */
export async function handleGetConfig(_configPath: string): Promise<GuiConfig> {
  return getConfig();
}

// ---------------------------------------------------------------------------
// PUT /api/config
// ---------------------------------------------------------------------------

/**
 * Validates and persists an incoming config update.
 * Strips ledger_root from the body (read-only).
 * Throws VALIDATION_ERROR if the body fails Zod validation.
 * Returns the updated full config.
 */
export async function handleUpdateConfig(
  configPath: string,
  body: unknown
): Promise<GuiConfig> {
  // Validate with the partial schema (ledger_root stripped by schema omission)
  const parseResult = GuiConfigPartialSchema.safeParse(body);
  if (!parseResult.success) {
    validationError('Invalid config values.', parseResult.error.issues);
  }

  return writeConfig(configPath, parseResult.data);
}

// ---------------------------------------------------------------------------
// POST /api/projects/:slug/reset
// ---------------------------------------------------------------------------

/**
 * Zod schema for the reset request body.
 */
const WpDecisionSchema = z.object({
  action: z.enum(['reset', 'skip', 'cancel']),
  reset_criteria: z.boolean().optional(),
});

const ResetRequestSchema = z.object({
  dry_run: z.boolean(),
  decisions: z.record(z.string(), WpDecisionSchema).optional(),
});

/**
 * Handles project reset: analyze (dry_run=true) or apply (dry_run=false).
 *
 * - dry_run=true: Returns diagnosis with per-WP analysis and suggested actions.
 * - dry_run=false: Requires `decisions` map. Applies per-WP reset/skip/cancel.
 *
 * Throws NOT_FOUND if the project does not exist.
 * Throws VALIDATION_ERROR if the request body is invalid.
 * @param repoName  Optional repository name used to resolve the namespaced storage path.
 */
export async function handleResetProject(
  ledgerRoot: string,
  slug: string,
  body: unknown,
  repoName?: string
): Promise<ProjectResetDiagnosis | ProjectResetResult> {
  assertSafeSlug(slug);

  // Validate body
  const parseResult = ResetRequestSchema.safeParse(body);
  if (!parseResult.success) {
    validationError('Invalid reset request body.', parseResult.error.issues);
  }
  const { dry_run, decisions } = parseResult.data;

  const store = await resolveProjectStore(ledgerRoot, slug, repoName);

  // Read root index and all WP details
  let rootIndex: RootIndex;
  try {
    rootIndex = await store.readRootIndex();
  } catch (err) {
    notFound(`Project '${slug}' not found or corrupted: ${String(err)}`);
  }

  const wpDetails: WorkPackageDetail[] = [];
  for (const wpSummary of rootIndex.work_packages) {
    try {
      const wp = await store.readWorkPackage(wpSummary.work_package_id);
      wpDetails.push(wp);
    } catch (err) {
      process.stderr.write(
        `[handleResetProject] Skipping WP "${wpSummary.work_package_id}": ${String(err)}\n`
      );
    }
  }

  // Analyze
  const diagnosis = analyzeProjectForReset(slug, rootIndex, wpDetails);

  if (dry_run) {
    return diagnosis;
  }

  // Apply mode — decisions are required
  if (!decisions || Object.keys(decisions).length === 0) {
    validationError('Decisions map is required when dry_run is false.');
  }

  const result = await applyProjectReset(store, diagnosis, decisions as Record<string, WpDecision>);
  return result;
}

// ---------------------------------------------------------------------------
// PATCH /api/projects/:slug
// ---------------------------------------------------------------------------

/**
 * Zod schema for the PATCH /api/projects/:slug request body.
 *
 * Accepts `title`, `slug`, or both — but requires at least one field to be
 * present. Hoisted to module level so it can be reused and inspected in tests.
 */
export const RenameBodySchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    slug: z.string().min(1).max(200).optional(),
  })
  .refine((d) => d.title !== undefined || d.slug !== undefined, {
    message: 'At least one of title or slug must be provided.',
  });

/**
 * Handles `PATCH /api/projects/:slug`.
 *
 * Accepts a partial update body with `title`, `slug`, or both:
 * - `title` — persists a new display title via `LedgerStore.updateTitle()`.
 * - `slug`  — renames the ledger storage directory and updates `.meta.json`
 *             via `LedgerStore.renameSlug()`. The response `ProjectMeta.slug`
 *             reflects the new slug so the frontend can redirect.
 *
 * Operations are applied in order: title first, then slug. Each updates
 * `latestMeta` independently. `last_updated` is **not** modified by either
 * operation — renaming is cosmetic and must not distort sort order.
 *
 * Do not reuse the `LedgerStore` instance after a slug rename; its internal
 * `storageDir` points to the (now non-existent) old path.
 *
 * Throws `NOT_FOUND` if the project does not exist.
 * Throws `VALIDATION_ERROR` if the body is empty or fails schema validation.
 * Throws `CONFLICT` if the target slug directory already exists.
 * @param repoName  Optional repository name used to resolve the namespaced storage path.
 */
export async function handleRenameProject(
  ledgerRoot: string,
  slug: string,
  body: unknown,
  repoName?: string
): Promise<ProjectMeta> {
  assertSafeSlug(slug);
  const parseResult = RenameBodySchema.safeParse(body);
  if (!parseResult.success) {
    validationError('Invalid rename request body.', parseResult.error.issues);
  }
  const { title, slug: newSlug } = parseResult.data;

  // Early-reject invalid slug patterns before touching disk.
  if (newSlug !== undefined && !assertSafeSegment(newSlug)) {
    validationError(
      `Invalid slug '${newSlug}'. Must match ^[a-z0-9][a-z0-9-]*$.`
    );
  }

  const store = await resolveProjectStore(ledgerRoot, slug, repoName);

  let latestMeta: ProjectMeta | undefined;

  if (title !== undefined) {
    latestMeta = await store.updateTitle(title);
  }

  if (newSlug !== undefined) {
    if (newSlug === slug) {
      // Same-slug no-op: nothing to rename. Materialise latestMeta if needed.
      latestMeta ??= await store.readProjectMeta();
    } else {
      try {
        latestMeta = await store.renameSlug(newSlug);
      } catch (err: unknown) {
        if (err instanceof SlugConflictError) {
          conflict(`Slug already in use: '${newSlug}'.`);
        }
        throw err;
      }
    }
  }

  // latestMeta is always defined here: the .refine() above guarantees at least
  // one branch ran. The non-null assertion keeps TypeScript happy.
  return latestMeta!;
}

// ---------------------------------------------------------------------------
// GET /api/projects/:slug/health
// ---------------------------------------------------------------------------

export interface ProjectHealthSummary {
  work_packages_needing_reset: number;
  work_packages_healthy: number;
  work_packages_skipped: number;
  total_work_packages: number;
}

/**
 * Returns a lightweight health summary for the project.
 *
 * Delegates to the same `analyzeProjectForReset()` logic as the reset modal
 * dry-run path — read-only, no writes, no locks required.
 * @param repoName  Optional repository name used to resolve the namespaced storage path.
 */
export async function handleGetProjectHealth(
  ledgerRoot: string,
  slug: string,
  repoName?: string
): Promise<ProjectHealthSummary> {
  assertSafeSlug(slug);

  const store = await resolveProjectStore(ledgerRoot, slug, repoName);

  let rootIndex: RootIndex;
  try {
    rootIndex = await store.readRootIndex();
  } catch (err) {
    notFound(`Project '${slug}' not found or corrupted: ${String(err)}`);
  }

  const wpDetails: WorkPackageDetail[] = (
    await Promise.all(
      rootIndex.work_packages.map(async (wpSummary) => {
        try {
          return await store.readWorkPackage(wpSummary.work_package_id);
        } catch (err) {
          process.stderr.write(
            `[handleGetProjectHealth] Skipping WP "${wpSummary.work_package_id}": ${String(err)}\n`
          );
          return null;
        }
      })
    )
  ).filter((wp): wp is WorkPackageDetail => wp !== null);

  const diagnosis = analyzeProjectForReset(slug, rootIndex, wpDetails);

  return {
    work_packages_needing_reset: diagnosis.work_packages_needing_reset,
    work_packages_healthy:       diagnosis.work_packages_healthy,
    work_packages_skipped:       diagnosis.work_packages_skipped,
    total_work_packages:         rootIndex.work_packages.length,
  };
}

// ---------------------------------------------------------------------------
// GET /api/projects/:slug/work-packages/overview
// ---------------------------------------------------------------------------

export interface WpPipelineStage {
  type: PipelineType;
  agent: string;
  status: 'pending' | 'in-progress' | 'pass' | 'fail';
  rework_count: number;
}

export interface WpOverviewEntry {
  work_package_id: string;
  title?: string;
  status: WorkPackageStatus;
  assigned_to: string | null;
  dependencies: string[];
  pipeline_stages: WpPipelineStage[];
  acceptance_criteria: { met: number; total: number };
  blocked_by?: { type: string; description: string };
}

/**
 * Returns an enriched summary array for every work package in the project.
 *
 * For each WP the handler resolves:
 *  - pipeline_stages: ordered per CANONICAL_PIPELINE_ORDERING, with status
 *    derived from the most recent pipeline entry of each stage type
 *  - acceptance_criteria: met/total counts
 *  - blocked_by: propagated from the WP detail when present
 *
 * Corrupt or missing WP detail files are skipped (same error-tolerance
 * pattern as handleGetProjectHealth).
 * STDIO discipline: this handler never writes to process.stdout.
 * @param repoName  Optional repository name used to resolve the namespaced storage path.
 */
export async function handleGetWorkPackageOverview(
  ledgerRoot: string,
  slug: string,
  repoName?: string
): Promise<WpOverviewEntry[]> {
  assertSafeSlug(slug);

  const store = await resolveProjectStore(ledgerRoot, slug, repoName);

  let rootIndex: RootIndex;
  try {
    rootIndex = await store.readRootIndex();
  } catch (err) {
    notFound(`Project '${slug}' not found or corrupted: ${String(err)}`);
  }

  const entries: WpOverviewEntry[] = (
    await Promise.all(
      rootIndex.work_packages.map(async (wpSummary) => {
        let wp: WorkPackageDetail;
        try {
          wp = await store.readWorkPackage(wpSummary.work_package_id);
        } catch (err) {
          process.stderr.write(
            `[handleGetWorkPackageOverview] Skipping WP "${wpSummary.work_package_id}": ${String(err)}\n`
          );
          return null;
        }

        // Resolve active stages, filtering through CANONICAL_PIPELINE_ORDERING
        // to guarantee the output is always in canonical execution order.
        const rawStages: string[] = wp.active_pipeline_stages ?? [...DEFAULT_PIPELINE_STAGES];
        const orderedStages = CANONICAL_PIPELINE_ORDERING.filter((s) => rawStages.includes(s));

        // Build a lookup map from stage type → latest pipeline entry.
        // Iterating in array order means later entries for the same type overwrite
        // earlier ones, so the map always holds the most recent execution.
        const latestByType = new Map<string, WorkPackageDetail['pipelines'][number]>();
        for (const pipeline of wp.pipelines) {
          latestByType.set(pipeline.type, pipeline);
        }

        const pipeline_stages: WpPipelineStage[] = orderedStages.map((type) => {
          const latest = latestByType.get(type);
          let status: WpPipelineStage['status'] = 'pending';
          if (latest) {
            if (latest.status === 'IN_PROGRESS') status = 'in-progress';
            else if (latest.status === 'PASS') status = 'pass';
            else if (latest.status === 'FAIL') status = 'fail';
          }
          const rework_count =
            (wp.rework_counts as Record<string, number> | undefined)?.[type] ?? 0;
          return {
            type,
            agent: PIPELINE_AGENT_MAP[type],
            status,
            rework_count,
          };
        });

        const metCount = wp.acceptance_criteria.filter((ac) => ac.met).length;
        const entry: WpOverviewEntry = {
          work_package_id: wp.work_package_id,
          ...(wp.title !== undefined && { title: wp.title }),
          status: wp.status,
          assigned_to: wp.assigned_to,
          dependencies: wp.dependencies,
          pipeline_stages,
          acceptance_criteria: { met: metCount, total: wp.acceptance_criteria.length },
        };

        if (wp.blocked_by) {
          entry.blocked_by = {
            type: wp.blocked_by.type,
            description: wp.blocked_by.description,
          };
        }

        return entry;
      })
    )
  ).filter((entry): entry is WpOverviewEntry => entry !== null);

  return entries;
}

// ---------------------------------------------------------------------------
// GET /api/projects/:slug/dialogues
// ---------------------------------------------------------------------------

/** Filename allowlist pattern: only alphanumeric, hyphens, underscores + .md */
const DIALOGUE_FILENAME_RE = /^[A-Za-z0-9_-]+\.md$/;

/** WP ID allowlist pattern: must be 'WP-' followed by one or more digits, or the literal 'project' */
const WP_ID_RE = /^(WP-\d+|project)$/;

/**
 * Parsed representation of a single dialogue file.
 * Derived from the filename convention `{WP_ID}-{stage}-r{N}.md`
 * or `project-{stage}-r{N}.md` for project-level (PM/Synthesis) dialogues.
 */
export interface DialogueEntry {
  filename: string;
  wp_id: string;
  stage: string;
  revision: number;
}

/** Parses a dialogue filename into a structured entry. Handles both `WP-\d+` and `project` prefixes. */
const DIALOGUE_PARSE_RE = /^(WP-\d+|project)-(.+)-r(\d+)\.md$/;
function parseDialogueFilename(filename: string): DialogueEntry {
  const m = DIALOGUE_PARSE_RE.exec(filename);
  if (m) {
    return { filename, wp_id: m[1]!, stage: m[2]!, revision: parseInt(m[3]!, 10) };
  }
  return { filename, wp_id: '', stage: '', revision: 0 };
}

/**
 * Returns an array of structured dialogue entries from the project's
 * orchestrator/dialogues/ directory. Each entry includes the filename plus
 * the wp_id and stage parsed from the filename convention
 * `{WP_ID}-{stage}-r{N}.md`.
 *
 * @param ledgerRoot  Root directory containing all project ledger folders.
 * @param slug        Project slug — validated via assertSafeSlug().
 * @param wpId        Optional WP ID prefix filter (e.g. 'WP-001').
 *                    When provided, only filenames starting with '{wpId}-' are returned.
 * @param repoName    Repository namespace. Used to namespace the storage path.
 * @returns           Sorted array of DialogueEntry objects, or [] when the directory
 *                    is absent (no error thrown).
 */
export async function handleListDialogues(
  ledgerRoot: string,
  slug: string,
  wpId?: string,
  repoName?: string
): Promise<DialogueEntry[]> {
  assertSafeSlug(slug);

  const store = await resolveProjectStore(ledgerRoot, slug, repoName);
  const dialoguesDir = join(store.storageDir, DIALOGUES_DIR);

  let entries: string[];
  try {
    entries = await readdir(dialoguesDir);
  } catch (err: unknown) {
    // Directory absent — return empty array rather than throwing.
    if (isNodeError(err) && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) {
      return [];
    }
    throw err;
  }

  // Filter to .md files only.
  let filenames = entries.filter((f) => f.endsWith('.md'));

  // Optional WP ID prefix filter — validate the value before using it.
  if (wpId) {
    if (!WP_ID_RE.test(wpId)) {
      // Invalid wpId (e.g. injection attempt or malformed value): return empty list.
      return [];
    }
    const prefix = `${wpId}-`;
    filenames = filenames.filter((f) => f.startsWith(prefix));
  }

  return filenames.sort().map(parseDialogueFilename);
}

// ---------------------------------------------------------------------------
// GET /api/projects/:slug/dialogues/:filename
// ---------------------------------------------------------------------------

/**
 * Returns the raw Markdown content of a single dialogue file.
 *
 * Security:
 * - `slug` is validated via assertSafeSlug().
 * - `filename` must match DIALOGUE_FILENAME_RE (alphanumeric + hyphens/underscores + .md).
 * - Resolved path must be inside the project's orchestrator/dialogues/ directory (defence-in-depth).
 *
 * @param ledgerRoot  Root directory containing all project ledger folders.
 * @param slug        Project slug.
 * @param filename    Dialogue file name (e.g. 'WP-001-developer-r0.md').
 * @param repoName    Repository namespace. Used to namespace the storage path.
 * @returns           File content as a UTF-8 string.
 * @throws            ApiError NOT_FOUND when filename is invalid or the file does not exist.
 */
export async function handleGetDialogueFile(
  ledgerRoot: string,
  slug: string,
  filename: string,
  repoName?: string
): Promise<{ content: string }> {
  assertSafeSlug(slug);

  // Allowlist check — rejects path traversal attempts like '../secret.md'.
  if (!DIALOGUE_FILENAME_RE.test(filename)) {
    console.warn(`[handleGetDialogueFile] Rejected filename (regex check): '${filename}'`);
    notFound(`Dialogue file not found: '${filename}'.`);
  }

  const store = await resolveProjectStore(ledgerRoot, slug, repoName);
  const dialoguesDir = resolve(join(store.storageDir, DIALOGUES_DIR));
  const filePath = resolve(join(dialoguesDir, filename));

  // Defence-in-depth: ensure resolved path stays inside dialoguesDir.
  if (!filePath.startsWith(dialoguesDir + sep) && filePath !== dialoguesDir) {
    console.warn(`[handleGetDialogueFile] Rejected filename (prefix check): '${filename}'`);
    notFound(`Dialogue file not found: '${filename}'.`);
  }

  try {
    const content = await readFile(filePath, 'utf-8');
    return { content };
  } catch (err: unknown) {
    if (isNodeError(err) && err.code === 'ENOENT') {
      notFound(`Dialogue file not found: '${filename}'.`);
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// GET /api/projects/:slug/chunks
// ---------------------------------------------------------------------------

/** Filename allowlist pattern for chunk files: only alphanumeric, hyphens, underscores + .jsonl */
const CHUNK_FILENAME_RE = /^[A-Za-z0-9_-]+\.jsonl$/;

/** Parse pattern for chunk filenames: `{WP_ID}-{stage}-r{N}.jsonl` or `project-{stage}-r{N}.jsonl` */
const CHUNK_PARSE_RE = /^(WP-\d+|project)-(.+)-r(\d+)\.jsonl$/;

/**
 * Parsed representation of a single chunk file.
 * Derived from the filename convention `{WP_ID}-{stage}-r{N}.jsonl`
 * or `project-{stage}-r{N}.jsonl` for project-level (PM/Synthesis) chunks.
 */
export interface ChunkEntry {
  filename: string;
  wp_id: string;
  stage: string;
  revision: number;
}

/** Parses a chunk filename into a structured entry. Handles both `WP-\d+` and `project` prefixes. */
function parseChunkFilename(filename: string): ChunkEntry {
  const m = CHUNK_PARSE_RE.exec(filename);
  if (m) {
    return { filename, wp_id: m[1]!, stage: m[2]!, revision: parseInt(m[3]!, 10) };
  }
  return { filename, wp_id: '', stage: '', revision: 0 };
}

/**
 * Returns an array of structured chunk entries from the project's
 * orchestrator/chunks/ directory. Each entry includes the filename plus
 * the wp_id and stage parsed from the filename convention
 * `{WP_ID}-{stage}-r{N}.jsonl`.
 *
 * @param ledgerRoot  Root directory containing all project ledger folders.
 * @param slug        Project slug — validated via assertSafeSlug().
 * @param wpId        Optional WP ID prefix filter (e.g. 'WP-001').
 *                    When provided, only filenames starting with '{wpId}-' are returned.
 * @param repoName    Repository namespace. Used to namespace the storage path.
 * @returns           Sorted array of ChunkEntry objects, or [] when the directory
 *                    is absent (no error thrown).
 */
export async function handleListChunks(
  ledgerRoot: string,
  slug: string,
  wpId?: string,
  repoName?: string
): Promise<ChunkEntry[]> {
  assertSafeSlug(slug);

  const store = await resolveProjectStore(ledgerRoot, slug, repoName);
  const chunksDir = join(store.storageDir, CHUNKS_DIR);

  let entries: string[];
  try {
    entries = await readdir(chunksDir);
  } catch (err: unknown) {
    // Directory absent — return empty array rather than throwing.
    if (isNodeError(err) && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) {
      return [];
    }
    throw err;
  }

  // Filter to .jsonl files only.
  let filenames = entries.filter((f) => f.endsWith('.jsonl'));

  // Optional WP ID prefix filter — validate the value before using it.
  if (wpId) {
    if (!WP_ID_RE.test(wpId)) {
      // Invalid wpId (e.g. injection attempt or malformed value): return empty list.
      return [];
    }
    const prefix = `${wpId}-`;
    filenames = filenames.filter((f) => f.startsWith(prefix));
  }

  return filenames.sort().map(parseChunkFilename);
}

// ---------------------------------------------------------------------------
// GET /api/projects/:slug/chunks/:filename
// ---------------------------------------------------------------------------

/**
 * Returns the raw JSONL content of a single chunk file.
 *
 * Security:
 * - `slug` is validated via assertSafeSlug().
 * - `filename` must match CHUNK_FILENAME_RE (alphanumeric + hyphens/underscores + .jsonl).
 * - Resolved path must be inside the project's orchestrator/chunks/ directory (defence-in-depth).
 *
 * @param ledgerRoot  Root directory containing all project ledger folders.
 * @param slug        Project slug.
 * @param filename    Chunk file name (e.g. 'WP-001-developer-r0.jsonl').
 * @param repoName    Repository namespace. Used to namespace the storage path.
 * @returns           File content as a UTF-8 string.
 * @throws            ApiError NOT_FOUND when filename is invalid or the file does not exist.
 */
export async function handleGetChunkFile(
  ledgerRoot: string,
  slug: string,
  filename: string,
  repoName?: string
): Promise<{ content: string }> {
  assertSafeSlug(slug);

  // Allowlist check — rejects path traversal attempts like '../secret.jsonl'.
  if (!CHUNK_FILENAME_RE.test(filename)) {
    console.warn(`[handleGetChunkFile] Rejected filename (regex check): '${filename}'`);
    notFound(`Chunk file not found: '${filename}'.`);
  }

  const store = await resolveProjectStore(ledgerRoot, slug, repoName);
  const chunksDir = resolve(join(store.storageDir, CHUNKS_DIR));
  const filePath = resolve(join(chunksDir, filename));

  // Defence-in-depth: ensure resolved path stays inside chunksDir.
  if (!filePath.startsWith(chunksDir + sep) && filePath !== chunksDir) {
    console.warn(`[handleGetChunkFile] Rejected filename (prefix check): '${filename}'`);
    notFound(`Chunk file not found: '${filename}'.`);
  }

  try {
    const content = await readFile(filePath, 'utf-8');
    return { content };
  } catch (err: unknown) {
    if (isNodeError(err) && err.code === 'ENOENT') {
      notFound(`Chunk file not found: '${filename}'.`);
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Internal Node.js error type guard (shared by file handlers above)
// ---------------------------------------------------------------------------

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}

// ---------------------------------------------------------------------------
// GET /api/projects/:repo/:slug/chunks/:filename/text
// ---------------------------------------------------------------------------

/**
 * Returns extracted prose text for a chunk file, with transparent `.md` caching.
 *
 * Cache-first strategy:
 *  1. Derives the `.md` filename server-side (never from user input) by replacing
 *     the validated `.jsonl` suffix.
 *  2. If the `.md` file already exists (pre-generated by the CLI or a prior
 *     request), reads and returns it with `{ content, cached: true }`.
 *  3. On cache miss: reads the `.jsonl` file, calls `renderChunksToText()`,
 *     writes the `.md` as a best-effort side-effect (write errors are silently
 *     ignored — the read path must never fail due to a caching failure), and
 *     returns `{ content, cached: false }`.
 *
 * Security:
 *  - `slug` is validated via `assertSafeSlug()`.
 *  - `filename` must match `CHUNK_FILENAME_RE` (allowlist — rejects traversal).
 *  - Resolved `.md` path must share the `chunksDir` prefix (defence-in-depth).
 *  - The `.md` filename is derived server-side; it is never accepted from the caller.
 *
 * @param ledgerRoot  Root directory containing all project ledger folders.
 * @param slug        Project slug.
 * @param filename    Chunk file name (e.g. 'WP-001-developer-r0.jsonl').
 * @param repoName    Repository namespace. Used to namespace the storage path.
 * @returns           `{ content: string, cached: boolean }`.
 * @throws            ApiError NOT_FOUND when filename is invalid or the .jsonl does not exist.
 * @throws            Internal server error (500) if the .jsonl content cannot be parsed by
 *                    `renderChunksToText()` (e.g. corrupt or structurally invalid JSONL).
 */
export async function handleGetChunkText(
  ledgerRoot: string,
  slug: string,
  filename: string,
  repoName?: string
): Promise<{ content: string; cached: boolean }> {
  assertSafeSlug(slug);

  // Allowlist check — rejects path traversal attempts and non-.jsonl names.
  if (!CHUNK_FILENAME_RE.test(filename)) {
    console.warn(`[handleGetChunkText] Rejected filename (regex check): '${filename}'`);
    notFound(`Chunk file not found: '${filename}'.`);
  }

  const store = await resolveProjectStore(ledgerRoot, slug, repoName);
  const chunksDir = resolve(join(store.storageDir, CHUNKS_DIR));

  // Derive the .md filename server-side — never from user input.
  const mdFilename = filename.replace(/\.jsonl$/, '.md');
  const mdPath = resolve(join(chunksDir, mdFilename));

  // Defence-in-depth: ensure the derived .md path stays inside chunksDir.
  if (!mdPath.startsWith(chunksDir + sep) && mdPath !== chunksDir) {
    console.warn(`[handleGetChunkText] Rejected derived md path (prefix check): '${mdFilename}'`);
    notFound(`Chunk file not found: '${filename}'.`);
  }

  // Cache-first: attempt to read a pre-existing .md file.
  try {
    const content = await readFile(mdPath, 'utf-8');
    return { content, cached: true };
  } catch (err: unknown) {
    if (!isNodeError(err) || err.code !== 'ENOENT') {
      throw err;
    }
    // ENOENT — fall through to extraction.
  }

  // Cache miss: read the .jsonl, extract prose, cache best-effort.
  // No prefix check needed here — CHUNK_FILENAME_RE already bounds the .jsonl filename to safe
  // characters (alphanumeric, hyphens, underscores + the literal ".jsonl" suffix), so the resolved
  // filePath is guaranteed to stay inside chunksDir. mdPath requires an explicit prefix check
  // because it is derived via string replacement (/\.jsonl$/ → '.md') rather than validated
  // directly, making the defence-in-depth guard above the appropriate layer for that path.
  const filePath = resolve(join(chunksDir, filename));
  let chunkContent: string;
  try {
    chunkContent = await readFile(filePath, 'utf-8');
  } catch (err: unknown) {
    if (isNodeError(err) && err.code === 'ENOENT') {
      notFound(`Chunk file not found: '${filename}'.`);
    }
    throw err;
  }

  const textContent = renderChunksToText(chunkContent);

  // Best-effort write — ignore errors so the read path is never broken.
  try {
    await writeFile(mdPath, textContent, 'utf-8');
  } catch {
    // Intentionally swallowed: permissions or disk errors must not propagate.
  }

  return { content: textContent, cached: false };
}

// ---------------------------------------------------------------------------
// POST /api/orchestrator/start
// ---------------------------------------------------------------------------

/** UUID v4 format accepted by `body.resumeThreadId` in {@link handleOrchestratorStart}. */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Validates `body.planPath`, then runs preflight checks and (when `dryRun`
 * is `false` and all checks pass) spawns a detached orchestrator process.
 *
 * Throws VALIDATION_ERROR when `body.planPath` is absent or not a string.
 *
 * In multi-store mode, runs a registration preflight before the standard checks:
 * if the repository folder inferred from `planPath` is not registered in any store,
 * returns a `store-registration` fail check immediately without calling
 * `startOrchestrator()`. When `inferProjectRootFromPlanPath` returns `null`
 * (i.e. `planPath` does not contain the `/docs/agents/` segment), the registration
 * check is skipped and `startOrchestrator()` proceeds normally.
 *
 * @param workspaceRoot - Absolute path to the workspace root directory.
 * @param body          - Parsed request body (any shape — validated here).
 */
export async function handleOrchestratorStart(
  workspaceRoot: string,
  body: unknown,
): Promise<StartResult> {
  if (typeof body !== 'object' || body === null) {
    validationError('Request body must be a JSON object.');
  }
  const b = body as Record<string, unknown>;
  if (!('planPath' in b) || typeof b['planPath'] !== 'string') {
    validationError('body.planPath is required and must be a string.');
  }
  const planPath = b['planPath'];
  const dryRun = typeof b['dryRun'] === 'boolean' ? b['dryRun'] : false;

  // Optional resume thread ID — must be UUID v4 when supplied.
  let resumeThreadId: string | undefined;
  if ('resumeThreadId' in b) {
    if (typeof b['resumeThreadId'] !== 'string' || !UUID_V4.test(b['resumeThreadId'])) {
      validationError('body.resumeThreadId must be a valid UUID v4 string.');
    }
    resumeThreadId = b['resumeThreadId'];
  }

  // Multi-store registration preflight (runs before all other checks).
  // In single-store / legacy mode this is a no-op — registration is optional.
  if (isStoreContextInitialized() && getStoreRouter().isMultiStoreMode()) {
    const projectRoot = inferProjectRootFromPlanPath(planPath);
    const folderName = projectRoot
      ? projectRoot.split(/[\/\\]/).filter(Boolean).pop() ?? null
      : null;
    if (folderName !== null) {
      const storeResult = await getStoreRouter().resolveStoreForRepo(folderName);
      if (storeResult === null) {
        const check: PreflightResult = {
          name:   'store-registration',
          pass:   false,
          detail: `Repository '${folderName}' is not registered in any store`,
          fix:    `Register '${folderName}' using the Repos tab or: node scripts/cli.js store repos add`,
        };
        return { checks: [check], started: false };
      }
    }
  }

  return startOrchestrator(planPath, workspaceRoot, dryRun, resumeThreadId);
}

// ---------------------------------------------------------------------------
// GET /api/orchestrator/queue
// ---------------------------------------------------------------------------

/**
 * Returns all active orchestrator queue entries enriched with computed
 * lifecycle state and JSONL progress summaries.
 *
 * @param logsDir    - Absolute path to the orchestrator logs directory.
 * @param ledgerRoot - Absolute path to the central ledger root.
 */
export async function handleGetOrchestratorQueue(
  logsDir: string,
  ledgerRoot: string,
): Promise<QueueEntry[]> {
  return getQueue({ logsDir, ledgerRoot });
}

// ---------------------------------------------------------------------------
// POST /api/orchestrator/kill/:id
// ---------------------------------------------------------------------------

/**
 * Terminates the orchestrator process for an effectively-pending queue entry
 * and removes it from the queue file.
 *
 * Returns `{ killed: false }` without throwing when the entry is not found or
 * its effective status is not `pending`.
 *
 * @param id         - Queue entry ID.
 * @param logsDir    - Absolute path to the orchestrator logs directory.
 * @param ledgerRoot - Absolute path to the central ledger root.
 */
export async function handleOrchestratorKill(
  id: string,
  logsDir: string,
  ledgerRoot: string,
): Promise<KillResult> {
  assertSafeQueueId(id);
  return killQueueEntry({ id, logsDir, ledgerRoot });
}

// ---------------------------------------------------------------------------
// POST /api/orchestrator/dismiss/:id
// ---------------------------------------------------------------------------

/**
 * Removes a dead queue entry from the queue file on disk.
 *
 * Resolves without throwing when the entry is not found or its effective
 * status is not `dead`. The caller (server.ts) sends HTTP 204 No Content.
 *
 * @param id         - Queue entry ID.
 * @param logsDir    - Absolute path to the orchestrator logs directory.
 * @param ledgerRoot - Absolute path to the central ledger root.
 */
export async function handleOrchestratorDismiss(
  id: string,
  logsDir: string,
  ledgerRoot: string,
): Promise<void> {
  assertSafeQueueId(id);
  await dismissQueueEntry({ id, logsDir, ledgerRoot });
}

// ---------------------------------------------------------------------------
// POST /api/orchestrator/delete/:id
// ---------------------------------------------------------------------------

/**
 * Unconditionally removes a queue entry from the queue file.
 *
 * Unlike dismiss, this does not check effective status — it is an admin
 * escape hatch for entries that cannot be removed via Kill or Dismiss
 * (e.g. when the PID has been recycled on Windows).
 *
 * The caller (server.ts) sends HTTP 204 No Content.
 *
 * @param id      - Queue entry ID.
 * @param logsDir - Absolute path to the orchestrator logs directory.
 */
export async function handleOrchestratorDelete(
  id: string,
  logsDir: string,
): Promise<void> {
  assertSafeQueueId(id);
  await deleteQueueEntry({ id, logsDir });
}

// ---------------------------------------------------------------------------
// GET /api/orchestrator/run-status/:filename
// ---------------------------------------------------------------------------

/** Allowlist for run-status filenames: `{16 hex chars}-run-status.json`. */
const SAFE_RUN_STATUS_FILENAME = /^[0-9a-f]{16}-run-status\.json$/;

/**
 * Returns the run-status tombstone written by the Python orchestrator at the
 * end of every run, or `null` when the file does not exist yet (run still in
 * progress, or has not started for this plan).
 *
 * The filename must be the value returned by `runStatusFilename()` in
 * `orchestrator-manager.ts` — a SHA-1 hash prefix of the absolute plan path
 * so that plans with identical folder names in different repositories never
 * collide in the shared logs directory.
 *
 * @param logsDir        - Absolute path to the orchestrator logs directory.
 * @param statusFilename - Bare filename as returned by `runStatusFilename()`.
 */
export async function handleGetRunStatus(
  logsDir:        string,
  statusFilename: string,
): Promise<RunStatus | null> {
  if (!statusFilename || !SAFE_RUN_STATUS_FILENAME.test(statusFilename)) {
    notFound(`Invalid run-status filename: '${statusFilename}'.`);
  }
  return getRunStatus(logsDir, statusFilename);
}

// ---------------------------------------------------------------------------
// GET /api/projects/:slug/run-metadata
// ---------------------------------------------------------------------------

/**
 * Returns the `.orchestrator-run.json` sidecar file written by the Python
 * orchestrator into the plan directory, parsed as JSON.
 *
 * The file contains the run identity fields (`thread_id`, `plan_path`,
 * `started_at`, `is_resume`, `dry_run`, `log_filename`, `pid`) and the run
 * outcome fields (`result`, `error`, `duration_s`).  While a run is in
 * progress, `result`, `error`, and `duration_s` are `null`.
 *
 * Throws NOT_FOUND when:
 * - The project slug is unsafe (path-traversal guard).
 * - The project does not exist in the ledger.
 * - The project has no `meta.plan_path` (metadata missing).
 * - The sidecar file does not exist on disk.
 *
 * @param ledgerRoot - Absolute path to the ledger root directory.
 * @param slug       - URL-decoded project slug from the request path.
 * @param repoName   - Optional repository name for namespaced lookups.
 */
export async function handleGetRunMetadata(
  ledgerRoot: string,
  slug: string,
  repoName?: string
): Promise<unknown> {
  assertSafeSlug(slug);
  const store = await resolveProjectStore(ledgerRoot, slug, repoName);
  const planPath = store.planPath;
  const metaFilePath = join(planPath, '.orchestrator-run.json');
  try {
    const raw = await readFile(metaFilePath, 'utf-8');
    return JSON.parse(raw) as unknown;
  } catch {
    notFound(`Run metadata not found for project '${slug}'.`);
  }
}

// handleGetStores and handleGetStoreConflicts have been moved to api-stores.ts
```
###  Path: `/mcp-server/gui/chunk-accumulator.ts`

```ts
/**
 * chunk-accumulator.ts — Shared accumulation layer for JSONL chunk parsing and merging.
 *
 * This module contains the types, JSONL parsing functions, chunk-merging functions,
 * namespace helpers, and the `accumulateChunks()` function that transforms raw JSONL
 * chunk records into merged messages grouped by namespace.
 *
 * It is consumed exclusively by `chunk-renderer.ts`, which builds the rendering layer
 * on top of the accumulated message maps.
 *
 * JSONL format (chunk_format: 1)
 * --------------------------------
 * Line 0 (header):
 *   {"chunk_format": 1, "stream_mode": "messages", "langgraph_stream_version": "v2"}
 *
 * Lines 1-N (chunks):
 *   Each chunk represents one streaming event and can arrive in either of two
 *   wire shapes — both are parsed identically:
 *
 *   Object shape (default Python serialisation):
 *     {"ns": namespace, "msg": AIMessageChunk.model_dump(), "metadata": {...}}
 *
 *   Array shape (tuple serialisation):
 *     [namespace, AIMessageChunk.model_dump(), metadata]
 *
 *   In both shapes, `namespace` is an array of strings (e.g. [] for the main
 *   agent or ["subgraph_name", "node_name"] for sub-agents).  The two shapes
 *   are fully interchangeable; `parseChunkLine()` normalises them to a common
 *   internal representation before any further processing.
 *
 * Merge semantics
 * ---------------
 * LangGraph streams `AIMessageChunk` objects — one per token / tool-call fragment.
 * Chunks sharing the same `id` field belong to the same logical message.  We
 * accumulate them in order and merge fields as follows:
 *   - `content`:    if string, concatenate; if list, merge by index/id
 *   - `tool_calls`: accumulate by index; merge `name`, `args` (string-concat), `id`
 *   - `usage_metadata`: sum numeric fields (input_tokens, output_tokens, …)
 *
 * Pure data transformation: no I/O, no side effects, no imports from
 * `mcp-server/src/`.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Raw JSON value accepted in chunk payloads. */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

/** A single tool-call fragment as it appears in an AIMessageChunk. */
export interface ToolCallChunk {
  /** Numeric index (used when merging multi-fragment tool calls). */
  index?: number;
  /** Tool call id (set on the first fragment). */
  id?: string | null;
  /** Tool name (set on the first fragment). */
  name?: string | null;
  /** Partial JSON-encoded args string. */
  args?: string | null;
}

/** Accumulated tool-call state keyed by index. */
export interface MergedToolCall {
  id: string;
  name: string;
  /** Accumulated JSON-encoded args string — may be partial if chunks are malformed. */
  args: string;
}

/** Content block from an AIMessageChunk / AIMessage. */
export interface ContentBlock {
  type: string;
  text?: string;
  [key: string]: JsonValue | undefined;
}

/** Merged/reconstructed message ready for rendering. */
export interface MergedMessage {
  /** LangChain message type: "ai", "human", "tool", "system", … */
  type: string;
  /** Message ID (for grouping chunks). */
  id: string;
  /** Reconstructed text or list-of-block content. */
  content: string | ContentBlock[];
  /** Merged tool calls (AI messages only). */
  tool_calls: MergedToolCall[];
  /** Aggregated token usage metadata. */
  usage_metadata: Record<string, number>;
  /** Tool message correlation id. */
  tool_call_id?: string;
}

/** Namespace key: empty string for the main agent, "subgraph/node" for sub-agents. */
export type NamespaceKey = string;

// ---------------------------------------------------------------------------
// Internal helpers — chunk merging
// ---------------------------------------------------------------------------

/**
 * Extracts a stable string id from a chunk payload.
 * LangChain's `AIMessageChunk.model_dump()` places the message id in the
 * top-level `id` field.  Falls back to an empty string when absent.
 */
export function chunkId(chunk: Record<string, JsonValue>): string {
  return typeof chunk['id'] === 'string' ? chunk['id'] : '';
}

/**
 * Returns the message type from a chunk payload.
 * LangChain's message dumps use the `type` field (e.g. "AIMessageChunk").
 */
export function chunkType(chunk: Record<string, JsonValue>): string {
  return typeof chunk['type'] === 'string' ? chunk['type'] : 'ai';
}

/**
 * Merges a new content value into an existing accumulated content value.
 * Both string-concatenation (token streaming) and block-list merging are
 * supported.
 *
 * **Content block alignment:**
 * Anthropic's streaming API emits each content block in its own single-element
 * array chunk.  The block carries a semantic `index` field indicating its
 * logical slot in the fully-assembled content array — e.g. `{type:"text",
 * index:0}` for the text portion and `{type:"tool_use", index:1}` for a tool
 * invocation.  Without index-aware alignment, a `tool_use` block arriving at
 * array position 0 would overwrite the accumulated `text` block at position 0,
 * corrupting the text content.
 *
 * When a block carries a numeric `index` field, that value is used as the
 * target slot — matching the pattern already used by `mergeToolCallChunks()`.
 * When `index` is absent, the loop variable `i` is used as the fallback,
 * preserving backward compatibility with providers that omit the field.
 */
export function mergeContent(
  acc: string | ContentBlock[],
  incoming: string | ContentBlock[] | null | undefined,
): string | ContentBlock[] {
  if (incoming === null || incoming === undefined) return acc;

  // String + string → concatenate.
  if (typeof acc === 'string' && typeof incoming === 'string') {
    return acc + incoming;
  }

  // Array + array → merge blocks by semantic index field (Anthropic streaming
  // convention), falling back to array position when the field is absent.
  if (Array.isArray(acc) && Array.isArray(incoming)) {
    // Work on a sparse array so index-keyed blocks land at the correct slot.
    // Anthropic streams each block in its own single-element array chunk, so every
    // incoming array has length 1, but its block.index may be 1, 2, … — meaning it
    // belongs at a higher logical position than array position 0.
    const sparse: (ContentBlock | undefined)[] = [...acc];
    for (let i = 0; i < incoming.length; i++) {
      const block = incoming[i];
      if (!block) continue;
      // Use the block's own `index` field when it is a non-negative integer;
      // otherwise fall back to the loop counter (backward-compat path).
      const slot = (typeof block['index'] === 'number' && block['index'] >= 0)
        ? block['index']
        : i;
      const existing = sparse[slot];
      if (existing) {
        if (existing.type === 'text' && block.type === 'text') {
          sparse[slot] = { ...existing, text: (existing.text ?? '') + (block.text ?? '') };
        } else {
          sparse[slot] = { ...existing, ...block };
        }
      } else {
        sparse[slot] = { ...block };
      }
    }
    // Compact: remove any undefined gaps introduced by sparse indexing.
    return sparse.filter((b): b is ContentBlock => b !== undefined);
  }

  // String + array → upgrade accumulator to array, reprocess.
  if (typeof acc === 'string' && Array.isArray(incoming)) {
    const upgraded: ContentBlock[] = acc ? [{ type: 'text', text: acc }] : [];
    return mergeContent(upgraded, incoming);
  }

  // Array + string → append as text block.
  if (Array.isArray(acc) && typeof incoming === 'string') {
    if (!incoming) return acc;
    return [...acc, { type: 'text', text: incoming }];
  }

  return acc;
}

/**
 * Merges a `tool_call_chunks` array from a new chunk into the accumulated
 * tool-calls map (keyed by integer index).
 */
export function mergeToolCallChunks(
  acc: Map<number, MergedToolCall>,
  chunks: ToolCallChunk[],
): void {
  for (const tc of chunks) {
    const idx = typeof tc.index === 'number' ? tc.index : 0;
    const existing = acc.get(idx);
    if (!existing) {
      acc.set(idx, {
        id: tc.id ?? '',
        name: tc.name ?? '',
        args: tc.args ?? '',
      });
    } else {
      acc.set(idx, {
        id: existing.id || (tc.id ?? ''),
        name: existing.name || (tc.name ?? ''),
        args: existing.args + (tc.args ?? ''),
      });
    }
  }
}

/**
 * Merges usage_metadata from a new chunk into the accumulator.
 */
export function mergeUsageMetadata(
  acc: Record<string, number>,
  incoming: Record<string, number> | null | undefined,
): Record<string, number> {
  if (!incoming) return acc;
  const result: Record<string, number> = { ...acc };
  for (const [key, value] of Object.entries(incoming)) {
    if (typeof value === 'number') {
      result[key] = (result[key] ?? 0) + value;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Internal helpers — JSONL parsing
// ---------------------------------------------------------------------------

/**
 * Validates that the first JSONL line is a valid chunk_format:1 header.
 */
export function isValidHeader(line: string): boolean {
  try {
    const obj = JSON.parse(line);
    return obj !== null
      && typeof obj === 'object'
      && !Array.isArray(obj)
      && obj.chunk_format === 1;
  } catch {
    return false;
  }
}

/**
 * Parses a single JSONL data line.
 *
 * The Python side writes each chunk as:
 *   json.dumps({"ns": ns, "msg": msg.model_dump(), "metadata": metadata})
 *
 * or equivalently as a tuple/array:
 *   json.dumps([ns, msg.model_dump(), metadata])
 *
 * Both shapes are accepted.  Returns null on parse errors or unrecognised
 * shapes (the caller skips null lines gracefully).
 */
export function parseChunkLine(line: string): {
  namespace: string[];
  msg: Record<string, JsonValue>;
  metadata: Record<string, JsonValue>;
} | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }

  // Array shape: [namespace, msg_dump, metadata]
  if (Array.isArray(parsed)) {
    const [ns, msg, meta] = parsed as [unknown, unknown, unknown];
    if (!Array.isArray(ns)) return null;
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return null;
    return {
      namespace: ns.filter((n): n is string => typeof n === 'string'),
      msg: msg as Record<string, JsonValue>,
      metadata: (meta && typeof meta === 'object' && !Array.isArray(meta))
        ? meta as Record<string, JsonValue>
        : {},
    };
  }

  // Object shape: {ns, msg, metadata}
  if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>;
    const ns = obj['ns'];
    const msg = obj['msg'];
    const meta = obj['metadata'];
    if (!Array.isArray(ns)) return null;
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return null;
    return {
      namespace: ns.filter((n): n is string => typeof n === 'string'),
      msg: msg as Record<string, JsonValue>,
      metadata: (meta && typeof meta === 'object' && !Array.isArray(meta))
        ? meta as Record<string, JsonValue>
        : {},
    };
  }

  return null;
}

/**
 * Converts a raw namespace array to a display key.
 * An empty array → "" (main agent); otherwise → joined string.
 */
export function namespaceKey(ns: string[]): NamespaceKey {
  return ns.join('/');
}

/**
 * Returns a human-readable label for a namespace key.
 */
export function namespaceLabel(key: NamespaceKey): string {
  return key === '' ? 'Main Agent' : key;
}

// ---------------------------------------------------------------------------
// Core accumulation logic
// ---------------------------------------------------------------------------

/**
 * Accumulates a sequence of parsed chunk records into a map of
 * namespace → list-of-merged-messages.
 *
 * Within each namespace, messages with the same `id` are merged
 * (token-by-token accumulation).  Messages without an id are each
 * treated as a standalone message.
 */
export function accumulateChunks(
  records: Array<{
    namespace: string[];
    msg: Record<string, JsonValue>;
  }>,
): Map<NamespaceKey, MergedMessage[]> {
  // namespace → (messageId → {mergedMessage, toolCallAcc})
  const nsMap = new Map<NamespaceKey, Map<string, {
    merged: MergedMessage;
    toolCallAcc: Map<number, MergedToolCall>;
  }>>();
  // namespace → ordered list of message ids (for output ordering)
  const nsOrder = new Map<NamespaceKey, string[]>();
  // Counter for anonymous messages (no id)
  let anonCounter = 0;

  for (const { namespace, msg } of records) {
    const nsKey = namespaceKey(namespace);

    if (!nsMap.has(nsKey)) {
      nsMap.set(nsKey, new Map());
      nsOrder.set(nsKey, []);
    }
    const msgMap = nsMap.get(nsKey)!;
    const orderList = nsOrder.get(nsKey)!;

    const rawId = chunkId(msg);
    // Assign a synthetic id for anonymous chunks so each gets its own slot.
    const msgId = rawId || `__anon_${anonCounter++}`;

    const rawContent = msg['content'];
    const incomingContent: string | ContentBlock[] | null | undefined =
      typeof rawContent === 'string' ? rawContent
      : Array.isArray(rawContent) ? (rawContent as ContentBlock[])
      : null;

    const incomingToolChunks: ToolCallChunk[] = Array.isArray(msg['tool_call_chunks'])
      ? (msg['tool_call_chunks'] as ToolCallChunk[])
      : [];

    const incomingUsage = msg['usage_metadata'];
    const usageMap: Record<string, number> | null =
      incomingUsage && typeof incomingUsage === 'object' && !Array.isArray(incomingUsage)
        ? incomingUsage as Record<string, number>
        : null;

    if (!msgMap.has(msgId)) {
      // First chunk for this message.
      const initialContent: string | ContentBlock[] =
        incomingContent !== null && incomingContent !== undefined
          ? incomingContent
          : '';
      const toolCallAcc = new Map<number, MergedToolCall>();
      mergeToolCallChunks(toolCallAcc, incomingToolChunks);

      const merged: MergedMessage = {
        type: chunkType(msg),
        id: rawId,
        content: initialContent,
        tool_calls: [],
        usage_metadata: mergeUsageMetadata({}, usageMap),
        ...(msg['tool_call_id'] !== undefined && {
          tool_call_id: typeof msg['tool_call_id'] === 'string'
            ? msg['tool_call_id']
            : String(msg['tool_call_id']),
        }),
      };

      msgMap.set(msgId, { merged, toolCallAcc });
      orderList.push(msgId);
    } else {
      // Subsequent chunk — merge into existing.
      const existing = msgMap.get(msgId)!;

      if (incomingContent !== null && incomingContent !== undefined) {
        existing.merged.content = mergeContent(existing.merged.content, incomingContent);
      }
      mergeToolCallChunks(existing.toolCallAcc, incomingToolChunks);
      existing.merged.usage_metadata = mergeUsageMetadata(
        existing.merged.usage_metadata,
        usageMap,
      );
    }
  }

  // Finalise: convert toolCallAcc maps to sorted arrays on each merged message.
  const result = new Map<NamespaceKey, MergedMessage[]>();
  for (const [nsKey, orderList] of nsOrder.entries()) {
    const msgMap = nsMap.get(nsKey)!;
    const messages: MergedMessage[] = [];
    for (const msgId of orderList) {
      const entry = msgMap.get(msgId);
      if (!entry) continue;
      const { merged, toolCallAcc } = entry;
      // Convert tool call accumulator to sorted array.
      merged.tool_calls = [...toolCallAcc.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, tc]) => tc);
      messages.push(merged);
    }
    result.set(nsKey, messages);
  }

  return result;
}

```
###  Path: `/mcp-server/gui/chunk-renderer.ts`

```ts
/**
 * chunk-renderer.ts — Rendering layer for streaming dialogue capture.
 *
 * This module builds on the shared accumulation layer in `chunk-accumulator.ts`
 * and exposes four pure renderers:
 *
 * renderChunksToMarkdown(jsonlContent: string): string
 *   Verbose format: `## Role` headings, JSON fenced tool-call blocks, and a
 *   token-usage footer.  Retained for debugging and diff-based consumers.
 *
 * renderChunksToDialogue(jsonlContent: string): string
 *   Compact chat-like format: plain-paragraph AI text, per-tool single-line
 *   summaries, hidden ToolMessages (execute/task results shown inline), and
 *   sub-agent `### Subagent:` headings.  Primary renderer used in production.
 *
 * renderChunksToStructured(jsonlContent: string): DialogueBlock[]
 *   Structured block array for frontend rendering (collapsible tool calls,
 *   interactive checklists, inline results).
 *
 * renderChunksToText(jsonlContent: string): string
 *   Prose-only extraction: AI text turns only, no tool-call JSON, no tool
 *   results.  Dual-namespace files get `## Outer Agent` / `## Inner Agent`
 *   section headers; single-namespace files render flat.  Used by the GUI
 *   "Text Only" tab and the CLI extraction script.
 *
 * Types, parsing, merging, and `accumulateChunks()` live in `chunk-accumulator.ts`.
 *
 * Pure data transformation: no I/O, no side effects, no imports from
 * `mcp-server/src/`.
 */

import {
  type JsonValue,
  type MergedToolCall,
  type ContentBlock,
  type MergedMessage,
  type NamespaceKey,
  accumulateChunks,
  isValidHeader,
  namespaceLabel,
  parseChunkLine,
} from './chunk-accumulator.js';

// ---------------------------------------------------------------------------
// Module-scope constants
// ---------------------------------------------------------------------------

/** Tools whose ToolMessage results are rendered inline (in detailLines) rather than embedded in a separate `result` field. */
const INLINE_RESULT_TOOLS = new Set(['execute', 'task']);

/**
 * Anthropic streaming-only content block types that are always redundant with
 * the `tool_calls` / `tool_call_chunks` message fields.  These block types
 * carry no information that is not already captured elsewhere and must be
 * filtered out of rendered text output.
 *
 * To handle a new streaming-only type (e.g. `thinking_delta`), add its string
 * value to this set — no change to `renderContent()` logic required.
 */
const REDUNDANT_BLOCK_TYPES = new Set(['tool_use', 'input_json_delta']);

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Shared JSONL pre-processing: splits raw content into lines, validates/skips
 * the chunk_format header, parses each data line via `parseChunkLine()`, and
 * returns the accumulated record array.
 *
 * Used by all three renderers to eliminate duplicated header-validation and
 * parse-loop boilerplate.
 */
function parseJsonlContent(
  jsonlContent: string,
): Array<{ namespace: string[]; msg: Record<string, JsonValue> }> {
  const rawLines = jsonlContent.split('\n');
  const nonEmptyLines = rawLines.map(l => l.trim()).filter(Boolean);

  let dataLines: string[];
  if (nonEmptyLines.length === 0) {
    dataLines = [];
  } else {
    const firstLine = nonEmptyLines[0]!;
    dataLines = isValidHeader(firstLine)
      ? nonEmptyLines.slice(1)
      : nonEmptyLines;
  }

  const records: Array<{ namespace: string[]; msg: Record<string, JsonValue> }> = [];
  for (const line of dataLines) {
    const parsed = parseChunkLine(line);
    if (parsed) {
      records.push({ namespace: parsed.namespace, msg: parsed.msg });
    }
  }
  return records;
}

// ---------------------------------------------------------------------------
// Internal rendering helpers
// ---------------------------------------------------------------------------

/**
 * Returns the canonical role label for a LangChain message type string.
 * Mirrors `_msg_role()` in `dialogue_writer.py`.
 */
function msgRole(type: string): string {
  switch (type.toLowerCase()) {
    case 'human':
    case 'humanmessage':
      return 'Human';
    case 'ai':
    case 'aimessage':
    case 'aimessagechunk':
      return 'Assistant';
    case 'tool':
    case 'toolmessage':
      return 'Tool Result';
    case 'system':
    case 'systemmessage':
      return 'System';
    default: {
      // Strip trailing "message"/"messagechunk" suffix, capitalise first char.
      const base = type.toLowerCase()
        .replace(/messagechunk$/, '')
        .replace(/message$/, '');
      return base ? base.charAt(0).toUpperCase() + base.slice(1) : 'Message';
    }
  }
}

/**
 * Renders a content value (string or list-of-blocks) to a plain string
 * suitable for Markdown body text.
 * Mirrors `_render_content()` in `dialogue_writer.py`.
 */
function renderContent(content: string | ContentBlock[] | null | undefined): string {
  if (content === undefined || content === null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      if (typeof block === 'string') {
        parts.push(block);
      } else if (block && typeof block === 'object') {
        const btype = block.type ?? '';
        if (btype === 'text') {
          parts.push(typeof block.text === 'string' ? block.text : '');
        } else if (REDUNDANT_BLOCK_TYPES.has(btype)) {
          // Anthropic streaming-only block types — always redundant with
          // `tool_calls` / `tool_call_chunks`; skip as a defence-in-depth filter.
          // (intentional no-op — block is skipped)
        } else {
          // Genuinely non-text, non-tool blocks (e.g. `image`) — rendered as
          // compact JSON fences for the Markdown debug renderer.
          parts.push('```json\n' + JSON.stringify(block, null, 2) + '\n```');
        }
      } else {
        parts.push(String(block));
      }
    }
    return parts.filter(Boolean).join('\n\n');
  }
  return String(content);
}

/**
 * Renders a list of merged tool calls as fenced Markdown code blocks.
 * Mirrors `_render_tool_calls()` in `dialogue_writer.py`.
 *
 * **Unparseable args fallback contract:**
 * When a tool call's accumulated `args` string is not valid JSON (e.g. because
 * the stream was truncated mid-token), `JSON.parse()` throws and the raw arg
 * string is used as-is.  The rendered output places this raw string directly
 * inside a ` ```json ` fence without any further transformation.  This means
 * the rendered block will contain partial JSON rather than a pretty-printed
 * object.  Consumers should treat a ` ```json ` block that is not valid JSON
 * as an indicator of a truncated or incomplete stream capture.
 */
function renderToolCalls(toolCalls: MergedToolCall[]): string {
  const blocks: string[] = [];
  for (const tc of toolCalls) {
    const name = tc.name || 'unknown_tool';
    const tcId = tc.id || '';
    const header = `**Tool call:** \`${name}\`` + (tcId ? ` (id: \`${tcId}\`)` : '');

    let argsObj: unknown = {};
    try {
      argsObj = tc.args ? JSON.parse(tc.args) : {};
    } catch {
      // Treat unparseable args as a raw string.
      argsObj = tc.args;
    }
    const body = '```json\n' + JSON.stringify(argsObj, null, 2) + '\n```';
    blocks.push(`${header}\n\n${body}`);
  }
  return blocks.join('\n\n');
}

// ---------------------------------------------------------------------------
// Markdown rendering
// ---------------------------------------------------------------------------

/**
 * Renders a namespace block to Markdown lines.
 *
 * For the main agent (nsKey === '') the messages are rendered without an extra
 * namespace heading.  For sub-agents a `### Subagent: {label}` heading is
 * prepended so the reader can easily identify the agent boundary.
 */
function renderNamespaceBlock(
  nsKey: NamespaceKey,
  messages: MergedMessage[],
  isSubagent: boolean,
): string[] {
  const lines: string[] = [];

  if (isSubagent) {
    lines.push(`### Subagent: ${namespaceLabel(nsKey)}`);
    lines.push('');
  }

  for (const msg of messages) {
    const role = msgRole(msg.type);
    lines.push(`## ${role}`);
    lines.push('');

    const contentStr = renderContent(msg.content);
    if (contentStr) {
      lines.push(contentStr);
      lines.push('');
    }

    if (msg.tool_calls.length > 0) {
      lines.push(renderToolCalls(msg.tool_calls));
      lines.push('');
    }
  }

  return lines;
}

/**
 * Collects aggregated token usage across all namespaces and messages.
 */
function collectTotalUsage(
  nsMap: Map<NamespaceKey, MergedMessage[]>,
): Record<string, number> | null {
  const totals: Record<string, number> = {};
  for (const messages of nsMap.values()) {
    for (const msg of messages) {
      for (const [key, value] of Object.entries(msg.usage_metadata)) {
        if (typeof value === 'number') {
          totals[key] = (totals[key] ?? 0) + value;
        }
      }
    }
  }
  return Object.keys(totals).length > 0 ? totals : null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parses a JSONL chunk file and renders its contents to a Markdown string
 * structurally consistent with the orchestrator's `serialize_messages_to_markdown()`
 * format.
 *
 * @param jsonlContent  Raw JSONL string (e.g. the content of a `.jsonl` chunk file).
 * @returns             A Markdown document string (always ends with a trailing newline).
 */
export function renderChunksToMarkdown(jsonlContent: string): string {
  // --- Parse JSONL content (header validation + line parsing) ---
  const records = parseJsonlContent(jsonlContent);

  // --- Accumulate chunks into merged messages per namespace ---
  const nsMap = accumulateChunks(records);

  // --- Build output lines ---
  const lines: string[] = [
    '# Dialogue — streaming capture',
    '',
    '| Field | Value |',
    '| ----- | ----- |',
    '| Format | `chunks` |',
    '',
  ];

  if (nsMap.size === 0) {
    lines.push('*No messages recorded.*');
    return lines.join('\n') + '\n';
  }

  // Render main-agent namespace first (empty key), then sub-agents in insertion order.
  const mainMessages = nsMap.get('');
  if (mainMessages && mainMessages.length > 0) {
    lines.push(...renderNamespaceBlock('', mainMessages, false));
  }

  for (const [nsKey, messages] of nsMap.entries()) {
    if (nsKey === '') continue; // already rendered above
    if (messages.length > 0) {
      lines.push(...renderNamespaceBlock(nsKey, messages, true));
    }
  }

  // --- Token-usage footer ---
  const usage = collectTotalUsage(nsMap);
  if (usage) {
    lines.push('---');
    lines.push('');
    lines.push('## Token Usage');
    lines.push('');
    lines.push('| Metric | Count |');
    lines.push('| ------ | ----- |');
    for (const key of Object.keys(usage).sort()) {
      const label = key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      lines.push(`| ${label} | ${usage[key]} |`);
    }
    lines.push('');
  }

  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Dialogue rendering — private helpers
// ---------------------------------------------------------------------------

/**
 * Builds a map from toolCallId → toolName by scanning all AI messages across
 * all namespaces in the accumulated message map.
 */
function buildToolCallIndex(
  nsMap: Map<NamespaceKey, MergedMessage[]>,
): Map<string, string> {
  const index = new Map<string, string>();
  for (const messages of nsMap.values()) {
    for (const msg of messages) {
      for (const tc of msg.tool_calls) {
        if (tc.id) {
          index.set(tc.id, tc.name);
        }
      }
    }
  }
  return index;
}

/**
 * Builds a map from toolCallId → { toolName, content } by scanning all
 * ToolMessages across all namespaces.  Only stores entries for tools whose
 * rendering rule needs inline results (currently `execute` and `task`).
 */
function buildToolResultIndex(
  nsMap: Map<NamespaceKey, MergedMessage[]>,
  toolCallIndex: Map<string, string>,
): Map<string, { toolName: string; content: string }> {
  const index = new Map<string, { toolName: string; content: string }>();

  for (const messages of nsMap.values()) {
    for (const msg of messages) {
      const msgType = msg.type.toLowerCase();
      if (msgType !== 'tool' && msgType !== 'toolmessage') continue;
      const tcId = msg.tool_call_id;
      if (!tcId) continue;

      const toolName = toolCallIndex.get(tcId);
      if (!toolName || !INLINE_RESULT_TOOLS.has(toolName)) continue;

      const content = renderContent(msg.content);
      index.set(tcId, { toolName, content });
    }
  }
  return index;
}

/**
 * Strips a leading `cd … &&` prefix from a shell command, takes the first
 * meaningful command token, and truncates to ≤ 80 characters with `…`.
 */
function abbreviateCommand(command: string): string {
  // Strip leading `cd <dir> &&` or `cd "<dir>" &&` prefix (possibly chained).
  let cmd = command.trim();
  cmd = cmd.replace(/^(cd\s+(?:"[^"]*"|'[^']*'|\S+)\s*&&\s*)+/i, '').trim();

  // Truncate to 80 chars with ellipsis if needed.
  if (cmd.length > 80) {
    return cmd.slice(0, 79) + '…';
  }
  return cmd;
}

/**
 * Extracts the last meaningful output line and exit-code success flag from a
 * ToolMessage content string produced by `execute`.
 *
 * Content format (approximate):
 *   <output lines…>
 *   [Command succeeded with exit code 0]   ← or "failed with exit code N"
 *
 * Returns null if content is empty or no meaningful line exists.
 *
 * @remarks
 * **Default-success behaviour.**
 * When no `[Command succeeded/failed…]` footer line is found in the content,
 * the function defaults to `success = true`.  This is intentional: commands
 * that produce output without a footer line are assumed to have succeeded (e.g.
 * tools that emit a result without a trailing exit-code annotation).  The
 * sibling formatter `formatExecuteDetail` renders ✓ or ✗ based on this value.
 *
 * **Summary truncation.**
 * The returned `summary` string is capped at 120 characters (with a trailing
 * `…` when truncated) to prevent unwieldy `↳` lines in the dialogue output.
 * The full content is always available in the raw JSONL.
 */
function extractExecuteResult(
  content: string,
): { summary: string; success: boolean } | null {
  const lines = content.split('\n').map(l => l.trim());

  // Find the exit-code footer line.
  let footerIdx = -1;
  let success = true;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i] ?? '';
    const match = line.match(/^\[Command\s+(succeeded|failed)\s+with\s+exit\s+code\s+(\d+)\]$/i);
    if (match) {
      footerIdx = i;
      success = match[1]?.toLowerCase() === 'succeeded';
      break;
    }
  }

  // Collect all non-empty, non-footer lines.
  const outputLines = lines.filter(
    (l, i) => l && i !== footerIdx,
  );

  if (outputLines.length === 0) return null;

  let summary = outputLines[outputLines.length - 1]!;
  const MAX_SUMMARY_LENGTH = 120;
  if (summary.length > MAX_SUMMARY_LENGTH) {
    summary = summary.slice(0, MAX_SUMMARY_LENGTH - 1) + '…';
  }
  return { summary, success };
}

// ---------------------------------------------------------------------------
// Dialogue rendering — per-family formatter helpers
// ---------------------------------------------------------------------------

/**
 * Formats a `↳ [filename](file_path)` detail line for file tools
 * (`edit_file`, `write_file`, `read_file`).
 */
function formatFileToolDetail(args: unknown): string[] {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return [];
  const a = args as Record<string, unknown>;

  // edit_file / write_file use `file_path`; read_file also uses `file_path`.
  const filePath =
    typeof a['file_path'] === 'string' ? a['file_path'] :
    typeof a['path'] === 'string' ? a['path'] :
    null;

  if (!filePath) return [];

  const filename = filePath.split('/').pop() ?? filePath;
  return [`↳ [${filename}](${filePath})`];
}

/**
 * Formats `↳ \`abbreviated_command\`` and an optional result line for `execute`.
 */
function formatExecuteDetail(
  args: unknown,
  resultEntry?: { toolName: string; content: string },
): string[] {
  const lines: string[] = [];
  if (args && typeof args === 'object' && !Array.isArray(args)) {
    const command = (args as Record<string, unknown>)['command'];
    if (typeof command === 'string') {
      lines.push('↳ `' + abbreviateCommand(command) + '`');
    }
  }
  if (resultEntry) {
    const extracted = extractExecuteResult(resultEntry.content);
    if (extracted) {
      const tick = extracted.success ? '✓' : '✗';
      // extracted.summary is guaranteed ≤ 120 chars (truncated by extractExecuteResult).
      lines.push(`↳ ${extracted.summary} ${tick}`);
    }
  }
  return lines;
}

/**
 * Formats `↳ Sub-agent: **subagent_type**` and an optional first-result-line for `task`.
 */
function formatTaskDetail(
  args: unknown,
  resultEntry?: { toolName: string; content: string },
): string[] {
  const lines: string[] = [];
  if (args && typeof args === 'object' && !Array.isArray(args)) {
    const subagentType = (args as Record<string, unknown>)['subagent_type'];
    if (typeof subagentType === 'string') {
      lines.push(`↳ Sub-agent: **${subagentType}**`);
    }
  }
  if (resultEntry) {
    const firstLine = resultEntry.content
      .split('\n')
      .map(l => l.trim())
      .find(l => l.length > 0);
    if (firstLine) {
      lines.push(`↳ ${firstLine}`);
    }
  }
  return lines;
}

/**
 * Formats `write_todos` as a compact checklist.
 *
 * The args `todos` field is an array of `{ content: string; status: string }`
 * objects.  Each item is rendered as `- [x] content` (completed) or
 * `- [ ] content` (pending / in_progress).
 *
 * @remarks
 * **Return-shape divergence from sibling formatters.**
 * Unlike `formatFileToolDetail`, `formatExecuteDetail`, `formatTaskDetail`, and
 * `formatLedgerToolDetail` — which all return `'↳ …'`-prefixed strings —
 * this function returns raw Markdown list items (`'- [x] …'` / `'- [ ] …'`).
 *
 * This is intentional: `write_todos` renders a visual checklist, not a
 * summary line.  The `getToolDetailLines` dispatcher pushes return values
 * verbatim into the output line buffer, so the rendered Markdown is correct.
 *
 * If you add a new formatter to this family, follow the `'↳ …'` convention
 * unless the tool's output is inherently list-shaped.  Do **not** model a new
 * formatter on `formatWriteTodosDetail` for the general case.
 */
function formatWriteTodosDetail(args: unknown): string[] {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return [];
  const a = args as Record<string, unknown>;
  const todos = a['todos'];
  if (!Array.isArray(todos) || todos.length === 0) return [];

  return todos.map((todo: unknown) => {
    if (!todo || typeof todo !== 'object' || Array.isArray(todo)) return '- [ ] (unknown)';
    const t = todo as Record<string, unknown>;
    const content = typeof t['content'] === 'string' ? t['content'] : '(unknown)';
    const status = typeof t['status'] === 'string' ? t['status'] : '';
    const checked = status === 'completed' ? 'x' : ' ';
    return `- [${checked}] ${content}`;
  });
}

/**
 * Formats contextual `↳ …` detail lines for `ledger_*` tools.
 *
 * Tools are split into mutation and query families; each has its own detail
 * format.  Unrecognised ledger tools emit no detail line (but the header is
 * always emitted by the caller).
 */
function formatLedgerToolDetail(name: string, args: unknown): string[] {
  const a = (args && typeof args === 'object' && !Array.isArray(args))
    ? (args as Record<string, unknown>)
    : {};

  const wp = typeof a['work_package_id'] === 'string' ? a['work_package_id'] : '';

  switch (name) {
    // --- Mutation tools ---
    case 'ledger_begin_work':
    case 'ledger_start_pipeline': {
      const type = typeof a['type'] === 'string' ? a['type'] : '';
      const role = typeof a['agent_role'] === 'string' ? a['agent_role'] : '';
      if (!wp) return [];
      return [`↳ ${wp} — ${type} (${role})`];
    }

    case 'ledger_complete_pipeline': {
      const type = typeof a['type'] === 'string' ? a['type'] : '';
      const status = typeof a['status'] === 'string' ? a['status'] : '';
      if (!wp) return [];
      const detail = [`↳ ${wp} ${type} → ${status}`];
      // Append first summary bullet if available.
      const summary = a['summary'];
      let firstItem: string | null = null;
      if (typeof summary === 'string' && summary.trim()) {
        firstItem = summary.trim().split('\n')[0] ?? null;
      } else if (Array.isArray(summary) && summary.length > 0) {
        const first = summary[0];
        if (typeof first === 'string' && first.trim()) firstItem = first.trim();
      }
      if (firstItem) detail.push(`↳ ${firstItem}`);
      return detail;
    }

    case 'ledger_cancel_pipeline': {
      const type = typeof a['type'] === 'string' ? a['type'] : '';
      const reason = typeof a['reason'] === 'string' ? a['reason'] : '';
      if (!wp) return [];
      return [`↳ ${wp} ${type} — ${reason}`];
    }

    case 'ledger_claim_work_package': {
      const agent = typeof a['agent'] === 'string' ? a['agent'] : '';
      if (!wp) return [];
      return [`↳ ${wp} → ${agent}`];
    }

    case 'ledger_update_work_package_status': {
      const status = typeof a['status'] === 'string' ? a['status'] : '';
      if (!wp) return [];
      return [`↳ ${wp} → ${status}`];
    }

    case 'ledger_update_pipeline_progress': {
      const type = typeof a['type'] === 'string' ? a['type'] : '';
      const summary = a['summary'];
      let firstItem = '';
      if (typeof summary === 'string') firstItem = summary.trim().split('\n')[0] ?? '';
      else if (Array.isArray(summary) && summary.length > 0) {
        const first = summary[0];
        if (typeof first === 'string') firstItem = first.trim();
      }
      if (!wp) return [];
      return [`↳ ${wp} ${type} — ${firstItem}`];
    }

    case 'ledger_update_acceptance_criteria': {
      const ops = a['operations'];
      const n = Array.isArray(ops) ? ops.length : 0;
      if (!wp) return [];
      return [`↳ ${wp} (${n} operations)`];
    }

    case 'ledger_add_project_comment': {
      const type = typeof a['type'] === 'string' ? a['type'] : '';
      const priority = typeof a['priority'] === 'string' ? a['priority'] : '';
      const note = typeof a['note'] === 'string' ? a['note'] : '';
      const firstNoteLine = note.split('\n')[0] ?? '';
      return [`↳ ${type} (${priority}): ${firstNoteLine}`];
    }

    // --- Query tools ---
    case 'ledger_get_next_action': {
      const role = typeof a['agent_role'] === 'string' ? a['agent_role'] : '';
      return role ? [`↳ ${role}`] : [];
    }

    case 'ledger_get_work_package': {
      return wp ? [`↳ ${wp}`] : [];
    }

    case 'ledger_get_handoff_status': {
      const agent = typeof a['current_agent'] === 'string' ? a['current_agent'] : '';
      return agent ? [`↳ ${agent}`] : [];
    }

    case 'ledger_search_insights': {
      const query = typeof a['query'] === 'string' ? a['query'] : '';
      return query ? [`↳ "${query}"`] : [];
    }

    // --- No-detail query tools ---
    case 'ledger_get_project_status':
    case 'ledger_list_work_packages':
      return [];

    // --- Other ledger_* tools (no detail, but always shown via header) ---
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Dialogue rendering — tool detail dispatcher
// ---------------------------------------------------------------------------

/**
 * Returns 0–N `↳ …` detail lines for a given tool call.  Dispatches to the
 * appropriate per-family formatter helper.
 *
 * @param name         Tool name.
 * @param args         Parsed tool arguments (object or null).
 * @param resultEntry  Optional result index entry for tools needing inline results.
 */
function getToolDetailLines(
  name: string,
  args: unknown,
  resultEntry?: { toolName: string; content: string },
): string[] {
  // File family
  if (name === 'edit_file' || name === 'write_file' || name === 'read_file') {
    return formatFileToolDetail(args);
  }
  // Execution family
  if (name === 'execute') {
    return formatExecuteDetail(args, resultEntry);
  }
  // Task family
  if (name === 'task') {
    return formatTaskDetail(args, resultEntry);
  }
  // Todo family
  if (name === 'write_todos') {
    return formatWriteTodosDetail(args);
  }
  // Search family — no detail line
  if (name === 'glob' || name === 'grep' || name === 'ls') {
    return [];
  }
  // Ledger family
  if (name.startsWith('ledger_')) {
    return formatLedgerToolDetail(name, args);
  }
  // Default / unknown — no detail line, header always shown by caller
  return [];
}

// ---------------------------------------------------------------------------
// Dialogue rendering — message walker
// ---------------------------------------------------------------------------

/**
 * Renders a list of merged messages in dialogue style.
 *
 * - AI messages: text content as plain paragraphs; tool calls as `Tool call: \`name\`` lines.
 * - ToolMessages: skipped (results already consumed inline for `execute` and `task`).
 * - All other message types (Human, System, …): skipped silently.
 */
function renderDialogueMessages(
  messages: MergedMessage[],
  toolResultIndex: Map<string, { toolName: string; content: string }>,
): string[] {
  const lines: string[] = [];

  for (const msg of messages) {
    const msgType = msg.type.toLowerCase();

    // Only AI messages contribute dialogue output.
    if (
      msgType !== 'ai' &&
      msgType !== 'aimessage' &&
      msgType !== 'aimessagechunk'
    ) {
      continue; // Skip Human, System, ToolMessage, etc.
    }

    // Render text content as plain paragraphs.
    const contentStr = renderContent(msg.content).trim();
    if (contentStr) {
      lines.push(contentStr);
      lines.push('');
    }

    // Render each tool call as a `Tool call: \`name\`` header + detail lines.
    for (const tc of msg.tool_calls) {
      const toolName = tc.name || 'unknown_tool';
      lines.push(`Tool call: \`${toolName}\``);

      // Parse args once.
      let parsedArgs: unknown = null;
      try {
        parsedArgs = tc.args ? JSON.parse(tc.args) : null;
      } catch {
        parsedArgs = null;
      }

      // Look up result entry (only populated for `execute` and `task`).
      const resultEntry = tc.id ? toolResultIndex.get(tc.id) : undefined;

      const detailLines = getToolDetailLines(toolName, parsedArgs, resultEntry);
      lines.push(...detailLines);
      lines.push('');
    }
  }

  return lines;
}

// ---------------------------------------------------------------------------
// Dialogue rendering — sub-agent section wrapper
// ---------------------------------------------------------------------------

/**
 * Renders a namespace block in dialogue style.
 *
 * For sub-agents a `### Subagent: {label}` heading is prepended.
 * For the main agent (nsKey === '') no heading is added.
 */
function renderDialogueNamespaceBlock(
  nsKey: NamespaceKey,
  messages: MergedMessage[],
  toolResultIndex: Map<string, { toolName: string; content: string }>,
  isSubagent: boolean,
): string[] {
  const lines: string[] = [];

  if (isSubagent) {
    lines.push(`### Subagent: ${namespaceLabel(nsKey)}`);
    lines.push('');
  }

  lines.push(...renderDialogueMessages(messages, toolResultIndex));
  return lines;
}

// ---------------------------------------------------------------------------
// Public API — dialogue renderer
// ---------------------------------------------------------------------------

/**
 * Parses a JSONL chunk file and renders its contents in a clean, chat-like
 * dialogue format.
 *
 * Differences from `renderChunksToMarkdown`:
 * - No `# Dialogue` document header or metadata table.
 * - No `## Role` headings — AI text appears as plain paragraphs.
 * - Tool calls are rendered as `Tool call: \`name\`` with a compact detail line
 *   instead of a full JSON fenced block.
 * - ToolMessages are hidden; `execute` and `task` results are shown inline with
 *   their tool call.
 * - No token-usage footer.
 *
 * @param jsonlContent  Raw JSONL string (e.g. the content of a `.jsonl` chunk file).
 * @returns             A Markdown string (always ends with a trailing `\n`).
 *                      Returns `*No dialogue recorded.*\n` for empty or header-only input.
 */
export function renderChunksToDialogue(jsonlContent: string): string {
  // --- Parse JSONL content (header validation + line parsing) ---
  const records = parseJsonlContent(jsonlContent);

  // --- Accumulate chunks into merged messages per namespace ---
  const nsMap = accumulateChunks(records);

  if (nsMap.size === 0) {
    return '*No dialogue recorded.*\n';
  }

  // --- Build correlation indexes ---
  const toolCallIndex = buildToolCallIndex(nsMap);
  const toolResultIndex = buildToolResultIndex(nsMap, toolCallIndex);

  // --- Render per namespace (main agent first, sub-agents next) ---
  const lines: string[] = [];

  const mainMessages = nsMap.get('');
  if (mainMessages && mainMessages.length > 0) {
    lines.push(...renderDialogueNamespaceBlock('', mainMessages, toolResultIndex, false));
  }

  for (const [nsKey, messages] of nsMap.entries()) {
    if (nsKey === '') continue;
    if (messages.length > 0) {
      lines.push(...renderDialogueNamespaceBlock(nsKey, messages, toolResultIndex, true));
    }
  }

  // Remove any trailing blank lines before adding the final newline.
  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }

  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Structured rendering — public types
// ---------------------------------------------------------------------------

/**
 * A single dialogue block in the structured representation returned by
 * `renderChunksToStructured()`.
 *
 * Discriminated union on the `type` field:
 *  - `text`             — AI prose content (no JSON or tool-call data mixed in).
 *  - `tool-call`        — One tool invocation: name, detail lines, parsed args,
 *                         and an optional embedded ToolMessage result for
 *                         non-inline tools (not `execute`/`task`).
 *  - `subagent-heading` — Heading that marks the start of a sub-agent namespace.
 *  - `checklist`        — A `write_todos` invocation rendered as a typed item list.
 */
export type DialogueBlock =
  | { type: 'text'; content: string }
  | {
      type: 'tool-call';
      name: string;
      detailLines: string[];
      args: unknown;
      result?: { content: string };
    }
  | { type: 'subagent-heading'; label: string }
  | {
      type: 'checklist';
      items: Array<{ content: string; status: string; checked: boolean }>;
    };

// ---------------------------------------------------------------------------
// Structured rendering — private helpers
// ---------------------------------------------------------------------------

/**
 * Builds a map from toolCallId → { toolName, content } by scanning ALL
 * ToolMessage entries across all namespaces.  Unlike `buildToolResultIndex()`,
 * no tool-name filter is applied — every ToolMessage is indexed.
 *
 * Used by `renderChunksToStructured()` so that non-inline tool results
 * (e.g. `read_file`, `glob`, `ledger_*`) can be embedded in their tool-call
 * blocks via the `result` field.
 */
function buildFullToolResultIndex(
  nsMap: Map<NamespaceKey, MergedMessage[]>,
  toolCallIndex: Map<string, string>,
): Map<string, { toolName: string; content: string }> {
  const index = new Map<string, { toolName: string; content: string }>();

  for (const messages of nsMap.values()) {
    for (const msg of messages) {
      const msgType = msg.type.toLowerCase();
      if (msgType !== 'tool' && msgType !== 'toolmessage') continue;
      const tcId = msg.tool_call_id;
      if (!tcId) continue;

      const toolName = toolCallIndex.get(tcId) ?? '';
      const content = renderContent(msg.content);
      index.set(tcId, { toolName, content });
    }
  }

  return index;
}

/**
 * Parses `write_todos` args into a typed checklist item array.
 */
function buildChecklistItems(
  args: unknown,
): Array<{ content: string; status: string; checked: boolean }> {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return [];
  const a = args as Record<string, unknown>;
  const todos = a['todos'];
  if (!Array.isArray(todos)) return [];

  return todos.map((todo: unknown) => {
    if (!todo || typeof todo !== 'object' || Array.isArray(todo)) {
      return { content: '(unknown)', status: '', checked: false };
    }
    const t = todo as Record<string, unknown>;
    const content = typeof t['content'] === 'string' ? t['content'] : '(unknown)';
    const status = typeof t['status'] === 'string' ? t['status'] : '';
    const checked = status === 'completed';
    return { content, status, checked };
  });
}

/**
 * Walks a list of merged messages and emits DialogueBlock objects.
 *
 * - AI messages: text content → `text` block; tool calls → `tool-call` or `checklist`.
 * - Inline tools (`execute`, `task`): result summary stays in `detailLines`.
 * - Non-inline tools: result (if any) is embedded in the `result` field.
 * - ToolMessages, Human, System: skipped.
 */
function renderMessagesToStructuredBlocks(
  messages: MergedMessage[],
  fullToolResultIndex: Map<string, { toolName: string; content: string }>,
): DialogueBlock[] {
  const blocks: DialogueBlock[] = [];

  for (const msg of messages) {
    const msgType = msg.type.toLowerCase();
    if (
      msgType !== 'ai' &&
      msgType !== 'aimessage' &&
      msgType !== 'aimessagechunk'
    ) {
      continue;
    }

    // AI text content → text block.
    const contentStr = renderContent(msg.content).trim();
    if (contentStr) {
      blocks.push({ type: 'text', content: contentStr });
    }

    // Tool calls.
    for (const tc of msg.tool_calls) {
      const toolName = tc.name || 'unknown_tool';

      let parsedArgs: unknown = null;
      try {
        parsedArgs = tc.args ? JSON.parse(tc.args) : null;
      } catch {
        parsedArgs = null;
      }

      if (toolName === 'write_todos') {
        // write_todos → checklist block (not a generic tool-call block).
        blocks.push({ type: 'checklist', items: buildChecklistItems(parsedArgs) });
      } else {
        const isInline = INLINE_RESULT_TOOLS.has(toolName);
        const resultEntry = tc.id ? fullToolResultIndex.get(tc.id) : undefined;

        // Inline tools (execute, task): pass resultEntry to getToolDetailLines so
        // the result summary appears in detailLines — matching the dialogue renderer.
        // All other tools: detailLines come from args only; result goes in result field.
        const detailLines = getToolDetailLines(
          toolName,
          parsedArgs,
          isInline ? resultEntry : undefined,
        );

        if (!isInline && resultEntry) {
          blocks.push({
            type: 'tool-call',
            name: toolName,
            detailLines,
            args: parsedArgs,
            result: { content: resultEntry.content },
          });
        } else {
          blocks.push({
            type: 'tool-call',
            name: toolName,
            detailLines,
            args: parsedArgs,
          });
        }
      }
    }
  }

  return blocks;
}

/**
 * Collects DialogueBlocks for a namespace block.
 * For sub-agents, prepends a `subagent-heading` block before the content blocks.
 */
function collectStructuredNamespaceBlocks(
  nsKey: NamespaceKey,
  messages: MergedMessage[],
  fullToolResultIndex: Map<string, { toolName: string; content: string }>,
  isSubagent: boolean,
): DialogueBlock[] {
  const blocks: DialogueBlock[] = [];

  if (isSubagent) {
    blocks.push({ type: 'subagent-heading', label: namespaceLabel(nsKey) });
  }

  blocks.push(...renderMessagesToStructuredBlocks(messages, fullToolResultIndex));
  return blocks;
}

// ---------------------------------------------------------------------------
// Public API — structured renderer (renderChunksToStructured)
// ---------------------------------------------------------------------------

/**
 * Parses a JSONL chunk file and returns a structured array of `DialogueBlock`
 * objects representing the conversation.
 *
 * This is the structured alternative to `renderChunksToDialogue()`: instead of
 * a flat Markdown string the caller receives typed block objects that give the
 * frontend full control over rendering (collapsible tool calls, interactive
 * checklists, inline results).
 *
 * Block types:
 *  - `text`             — AI prose only; no JSON or tool-call data mixed in.
 *  - `tool-call`        — Tool name, `getToolDetailLines()` detail lines, parsed
 *                         args, and an optional `result.content` for non-inline tools.
 *  - `subagent-heading` — Marks the start of a sub-agent namespace block.
 *  - `checklist`        — `write_todos` items with `content`, `status`, `checked`.
 *
 * ToolMessage results for non-inline tools (not `execute`/`task`) are embedded
 * in the `result` field of the corresponding tool-call block.  Inline tool
 * results remain in `detailLines` (matching the dialogue renderer).
 *
 * @param jsonlContent  Raw JSONL string (e.g. the content of a `.jsonl` chunk file).
 * @returns             Array of `DialogueBlock` objects; empty array for empty input.
 */
export function renderChunksToStructured(jsonlContent: string): DialogueBlock[] {
  // --- Parse JSONL content (header validation + line parsing) ---
  const records = parseJsonlContent(jsonlContent);

  // --- Accumulate chunks into merged messages per namespace ---
  const nsMap = accumulateChunks(records);

  if (nsMap.size === 0) {
    return [];
  }

  // --- Build correlation indexes ---
  const toolCallIndex = buildToolCallIndex(nsMap);
  const fullToolResultIndex = buildFullToolResultIndex(nsMap, toolCallIndex);

  // --- Collect blocks (main agent first, sub-agents next) ---
  const blocks: DialogueBlock[] = [];

  const mainMessages = nsMap.get('');
  if (mainMessages && mainMessages.length > 0) {
    blocks.push(...collectStructuredNamespaceBlocks('', mainMessages, fullToolResultIndex, false));
  }

  for (const [nsKey, messages] of nsMap.entries()) {
    if (nsKey === '') continue;
    if (messages.length > 0) {
      blocks.push(...collectStructuredNamespaceBlocks(nsKey, messages, fullToolResultIndex, true));
    }
  }

  return blocks;
}

// ---------------------------------------------------------------------------
// Text-only rendering — private helpers
// ---------------------------------------------------------------------------

/**
 * Iterates AI messages and extracts prose text only (no tool calls, no tool
 * results).  Calls `renderContent(msg.content).trim()` on each AI message and
 * joins non-empty results with `'\n\n'`.
 *
 * Used exclusively by `renderChunksToText()`.
 */
function extractTextFromMessages(messages: MergedMessage[]): string {
  const parts: string[] = [];
  for (const msg of messages) {
    const msgType = msg.type.toLowerCase();
    if (
      msgType !== 'ai' &&
      msgType !== 'aimessage' &&
      msgType !== 'aimessagechunk'
    ) {
      continue;
    }
    const text = renderContent(msg.content).trim();
    if (text) {
      parts.push(text);
    }
  }
  return parts.join('\n\n');
}

// ---------------------------------------------------------------------------
// Public API — text-only renderer
// ---------------------------------------------------------------------------

/**
 * Parses a JSONL chunk file and returns a prose-only Markdown string
 * containing only the AI turns' text content — no tool-call JSON, no tool
 * results.
 *
 * Output format:
 *  - **Single-namespace** files: flat prose paragraphs, no section headers.
 *  - **Multi-namespace** files (outer agent + one or more inner agents): one
 *    `## Outer Agent` section followed by one `## Inner Agent` section **per
 *    inner namespace**.  When N > 1 inner namespaces are present, each gets
 *    its own `## Inner Agent` header in iteration order — the label is the
 *    same for all inner namespaces (no distinguishability guarantee).
 *    Contributors adding N-inner support should replace the fixed label with
 *    a namespace-derived identifier before relying on label uniqueness.
 *
 * This renderer shares its `.md` output format with the CLI extraction script
 * (`scripts/extract-dialogue.js`) so that either tool can prime the on-disk
 * cache that the backend's `/chunks/:filename/text` endpoint uses.
 *
 * @param jsonlContent  Raw JSONL string (e.g. the content of a `.jsonl` chunk file).
 * @returns             A Markdown string (always ends with a trailing `\n`).
 *                      Returns `'*No dialogue recorded.*\n'` for empty input or
 *                      when all AI turns contain no text content.
 */
export function renderChunksToText(jsonlContent: string): string {
  // --- Parse JSONL content (header validation + line parsing) ---
  const records = parseJsonlContent(jsonlContent);

  // --- Accumulate chunks into merged messages per namespace ---
  const nsMap = accumulateChunks(records);

  if (nsMap.size === 0) {
    return '*No dialogue recorded.*\n';
  }

  // --- Detect whether sub-agent namespaces are present ---
  const hasSubAgents = [...nsMap.keys()].some(k => k !== '');

  if (!hasSubAgents) {
    // Single-namespace: flat prose, no section headers.
    const mainMessages = nsMap.get('') ?? [];
    const text = extractTextFromMessages(mainMessages);
    if (!text) {
      return '*No dialogue recorded.*\n';
    }
    return text + '\n';
  }

  // --- Dual-namespace: labelled sections ---
  const mainMessages = nsMap.get('') ?? [];
  const outerText = extractTextFromMessages(mainMessages);

  const innerTexts: string[] = [];
  for (const [nsKey, messages] of nsMap.entries()) {
    if (nsKey === '') continue;
    innerTexts.push(extractTextFromMessages(messages));
  }

  // If all sections are empty, return the standard empty sentinel.
  if (!outerText && innerTexts.every(t => !t)) {
    return '*No dialogue recorded.*\n';
  }

  const sections: string[] = [];
  sections.push('## Outer Agent\n\n' + (outerText || '*No dialogue recorded.*'));
  for (const innerText of innerTexts) {
    sections.push('## Inner Agent\n\n' + (innerText || '*No dialogue recorded.*'));
  }

  return sections.join('\n\n') + '\n';
}

```
###  Path: `/mcp-server/gui/orchestrator-manager.ts`

```ts
/**
 * Orchestrator Manager (WP-005, WP-007)
 *
 * Provides two areas of functionality:
 *
 * 1. Queue reader — delegates to `src/gui/queue/get-queue.ts`. The extracted
 *    module holds `getQueue()`, `readQueueFile()`, `isProcessAlive()`,
 *    `getProjectLedgerStatus()`, and all queue-reading internals.
 *
 * 2. Preflight and launch — validates workspace readiness via 8 preflight checks
 *    and optionally spawns a detached orchestrator process (startOrchestrator).
 *
 * Type definitions — delegated to `src/gui/queue/types.ts`:
 *   `RawQueueEntry`, `QueueEntry`, `KillResult`, `PreflightResult`,
 *   `StartResult`, `RunStatus`, `QUEUE_FILENAME`.
 *
 * STDIO discipline: this module never writes to process.stdout.
 *
 * Queue file location: <logsDir>/.run-queue.json
 * Written by: orchestrator Python process (cli.py → run_queue.register/unregister)
 * Read by:    GUI server (this module) — never modifies the queue file
 *
 * Lifecycle state transitions (computed in-memory, never persisted):
 *   pending + alive  + stage activity  + no project  → effectiveStatus: 'started'
 *   pending + alive  + no stage activity + no project → effectiveStatus: 'pending'
 *   pending + alive  + project exists               → effectiveStatus: 'started'
 *   pending + dead   + no project                   → effectiveStatus: 'dead'
 *   pending + dead   + project exists               → effectiveStatus: 'started'
 *   started + synthesis_generated true              → excluded from result (AC-6)
 *
 * Note (WP-007): The `synthesis_generated` ledger lookup performed for the AC-6
 * exclusion row is namespace-aware. When a queue entry carries a non-null
 * `expectedRepo`, `getProjectLedgerStatus()` resolves the ledger file from a
 * namespaced path (`<ledgerRoot>/<expectedRepo>/<slug>/project-ledger.json`);
 * entries without `expectedRepo` use the legacy flat path. This applies at all
 * three call sites: `getQueue()`, `killQueueEntry()`, and `dismissQueueEntry()`.
 *
 * @see {@link computeEffectiveStatus} — canonical implementation of the transition rules above.
 */

import { readFile, readdir, writeFile, unlink, rename, stat } from 'node:fs/promises';
import { join, dirname, resolve, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';

import { planFolderBasename } from '../src/utils/path-validator.js';
import { computeEffectiveStatus } from '../src/gui/queue/compute-effective-status.js';
import { readQueueFile, isProcessAlive, getProjectLedgerStatus } from '../src/gui/queue/get-queue.js';
import { QUEUE_FILENAME, type RawQueueEntry, type KillResult, type PreflightResult, type StartResult, type RunStatus } from '../src/gui/queue/types.js';

// Re-exports for backward compatibility with callers that import from this module.
export { formatProgressEntry, type ProgressResolution } from '../src/gui/queue/resolve-progress.js';
export { type EffectiveStatus } from '../src/gui/queue/compute-effective-status.js';
export { QUEUE_FILENAME, type RawQueueEntry, type QueueEntry, type KillResult, type PreflightResult, type StartResult, type RunStatus } from '../src/gui/queue/types.js';
export { getQueue } from '../src/gui/queue/get-queue.js';

// ---------------------------------------------------------------------------
// Queue mutation helpers
// ---------------------------------------------------------------------------

/** Milliseconds to wait after SIGTERM before escalating to SIGKILL. */
const SIGTERM_WAIT_MS = 3_000;

/**
 * Returns a Promise that resolves after `ms` milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Atomically writes `entries` back to the queue file.
 *
 * Writes to a `.tmp` sibling first, then renames it over the real file.
 * This prevents partial-write corruption if the process is killed mid-write.
 *
 * @remarks
 * **Locking parity gap:** The Python orchestrator (`run_queue.py`) acquires
 * `.run-queue.lock` before reading or writing the queue file. This TypeScript
 * writer relies solely on the atomic rename and does **not** acquire the same
 * lock. If a Python write operation overlaps with a TypeScript write (e.g.,
 * during a handoff where both processes are briefly active), a race condition
 * could cause one writer to overwrite the other's changes. The risk is low in
 * normal operation — the GUI calls this function only when no orchestrator
 * process is running — but the asymmetry should be resolved if concurrent
 * writes become possible in future designs.
 */
async function writeQueueFileAtomic(logsDir: string, entries: RawQueueEntry[]): Promise<void> {
  const queuePath = join(logsDir, QUEUE_FILENAME);
  const tmpPath   = `${queuePath}.tmp`;
  await writeFile(tmpPath, JSON.stringify(entries), 'utf-8');
  await rename(tmpPath, queuePath);
}

/**
 * Removes the `.orchestrator.lock` file from the plan's parent directory.
 * Silently succeeds if the file is already absent.
 */
async function removeLockFile(planPath: string): Promise<void> {
  const lockPath = join(dirname(planPath), '.orchestrator.lock');
  try {
    await unlink(lockPath);
  } catch {
    // File already removed or never created — not an error.
  }
}

/**
 * Sends SIGTERM to `pid`, waits {@link SIGTERM_WAIT_MS} ms, then sends
 * SIGKILL if the process is still alive.
 *
 * If SIGTERM throws `ESRCH` (the process died in the TOCTOU window between
 * the liveness check and signal delivery), the function returns early without
 * re-throwing — the process is already gone and the caller can proceed with
 * queue and lock-file cleanup.
 */
async function terminateProcess(pid: number): Promise<void> {
  if (pid <= 0) return;
  try {
    process.kill(pid, 'SIGTERM');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ESRCH') return;
    throw err;
  }
  await sleep(SIGTERM_WAIT_MS);
  if (isProcessAlive(pid)) {
    process.kill(pid, 'SIGKILL');
  }
}

// ---------------------------------------------------------------------------
// Public API — kill and dismiss
// ---------------------------------------------------------------------------

/**
 * Terminates the orchestrator process for a pending queue entry and removes
 * the entry from the queue file.
 *
 * Only operates on effectively-pending entries (`alive && no project in ledger`).
 * Returns `{ killed: false }` without throwing when:
 *   - The entry is not found.
 *   - The entry's effective status is `started` or `dead`.
 *
 * When `killed === true`, the procedure performed is:
 *   1. SIGTERM sent to the process.
 *   2. Wait up to {@link SIGTERM_WAIT_MS} ms.
 *   3. SIGKILL sent if the process is still alive after the wait.
 *   4. Entry removed from the queue file on disk.
 *   5. `.orchestrator.lock` file removed from the plan directory.
 *
 * @param params.id          - Queue entry ID to kill.
 * @param params.logsDir     - Absolute path to the orchestrator logs directory.
 * @param params.ledgerRoot  - Absolute path to the central ledger root.
 */
export async function killQueueEntry(params: {
  id: string;
  logsDir: string;
  ledgerRoot: string;
}): Promise<KillResult> {
  const { id, logsDir, ledgerRoot } = params;

  const entries    = await readQueueFile(logsDir);
  const entryIndex = entries.findIndex((e) => e.id === id);

  if (entryIndex === -1) {
    return { killed: false, reason: 'Queue entry not found.' };
  }

  const entry = entries[entryIndex]!;

  // Recompute effective status. Intentionally omits the hasLogActivity argument
  // (defaults to false) so kill eligibility uses the conservative two-factor rule:
  // only alive+no-project entries are 'pending'. getQueue() passes hasStageActivity
  // for display purposes but kill must not promote stale entries.
  const alive = isProcessAlive(entry.pid);
  const { exists: projectExists } = await getProjectLedgerStatus(ledgerRoot, entry.expectedSlug, entry.expectedRepo);
  const effectiveStatus = computeEffectiveStatus(alive, projectExists);

  if (effectiveStatus !== 'pending') {
    const reason = effectiveStatus === 'started'
      ? 'The run has already created the project ledger and cannot be killed from the GUI. Use: node scripts/kill-orchestrator.js --force'
      : 'The run is no longer active.';
    return { killed: false, reason };
  }

  // 1–3: Terminate the process.
  await terminateProcess(entry.pid);

  // 4: Remove from the queue file.
  const updated = entries.filter((_, i) => i !== entryIndex);
  await writeQueueFileAtomic(logsDir, updated);

  // 5: Remove the per-plan lock file.
  await removeLockFile(entry.planPath);

  return { killed: true };
}

/**
 * Removes a dead queue entry from the queue file on disk.
 *
 * Only operates on effectively-dead entries (`!alive && no project in ledger`).
 * Returns without throwing when:
 *   - The entry is not found.
 *   - The entry's effective status is `pending` or `started`.
 *
 * @param params.id          - Queue entry ID to dismiss.
 * @param params.logsDir     - Absolute path to the orchestrator logs directory.
 * @param params.ledgerRoot  - Absolute path to the central ledger root.
 */
export async function dismissQueueEntry(params: {
  id: string;
  logsDir: string;
  ledgerRoot: string;
}): Promise<void> {
  const { id, logsDir, ledgerRoot } = params;

  const entries    = await readQueueFile(logsDir);
  const entryIndex = entries.findIndex((e) => e.id === id);

  if (entryIndex === -1) {
    return;
  }

  const entry = entries[entryIndex]!;

  // Recompute effective status. Intentionally omits the hasLogActivity argument
  // (defaults to false) — dismiss eligibility uses the same conservative rule as kill.
  const alive = isProcessAlive(entry.pid);
  const { exists: projectExists } = await getProjectLedgerStatus(ledgerRoot, entry.expectedSlug, entry.expectedRepo);
  const effectiveStatus = computeEffectiveStatus(alive, projectExists);

  if (effectiveStatus !== 'dead') {
    return;
  }

  // Remove from the queue file.
  const updated = entries.filter((_, i) => i !== entryIndex);
  await writeQueueFileAtomic(logsDir, updated);
}

/**
 * Unconditionally removes a queue entry from the queue file on disk.
 *
 * Unlike `dismissQueueEntry`, this function does not check the entry's
 * effective status — it removes the entry regardless of whether the process
 * is alive, dead, or started.  Intended for admin use when the normal
 * Kill/Dismiss flow is blocked (e.g. due to PID recycling on Windows).
 *
 * Returns without throwing when the entry is not found (idempotent).
 *
 * @param params.id      - Queue entry ID to delete.
 * @param params.logsDir - Absolute path to the orchestrator logs directory.
 */
export async function deleteQueueEntry(params: {
  id: string;
  logsDir: string;
}): Promise<void> {
  const { id, logsDir } = params;
  const entries = await readQueueFile(logsDir);
  const updated = entries.filter((e) => e.id !== id);
  if (updated.length === entries.length) return; // not found — no-op
  await writeQueueFileAtomic(logsDir, updated);
}

// ---------------------------------------------------------------------------
// Preflight helpers
// ---------------------------------------------------------------------------

/**
 * Resolves the `orchestrate` binary path within the orchestrator venv.
 * Uses `Scripts/orchestrate.exe` on Windows, `bin/orchestrate` elsewhere.
 */
function resolveOrchestrateBin(workspaceRoot: string): string {
  const subdir = process.platform === 'win32' ? 'Scripts' : 'bin';
  const ext    = process.platform === 'win32' ? '.exe'    : '';
  return join(workspaceRoot, 'orchestrator', '.venv', subdir, `orchestrate${ext}`);
}

/**
 * Validates the plan folder basename matches `YYYY-MM-DD-{project-name}`.
 * Wraps planFolderBasename() so any thrown error becomes a failed check.
 *
 * Handles both folder paths (`.../2026-06-05-my-feature`) and file paths
 * (`.../2026-06-05-my-feature/plan.md`) — tries the path directly first,
 * then falls back to its dirname.
 */
function checkPlanBasename(resolvedPlan: string): PreflightResult {
  try {
    planFolderBasename(resolvedPlan);
    return { name: 'plan-basename', pass: true, detail: 'Plan folder follows naming convention' };
  } catch {
    try {
      planFolderBasename(dirname(resolvedPlan));
      return { name: 'plan-basename', pass: true, detail: 'Plan folder follows naming convention' };
    } catch {
      return {
        name:   'plan-basename',
        pass:   false,
        detail: 'Plan path does not follow naming convention',
        fix:    'The plan folder must match YYYY-MM-DD-{project-name} (e.g. 2026-05-05-my-feature)',
      };
    }
  }
}

/** Checks that the plan file exists on disk. */
async function checkPlanFile(resolvedPlan: string): Promise<PreflightResult> {
  try {
    await stat(resolvedPlan);
    return {
      name:   'plan-file',
      pass:   true,
      detail: `Plan file found: ${basename(resolvedPlan)}`,
    };
  } catch {
    return {
      name:   'plan-file',
      pass:   false,
      detail: `Plan file not found: ${resolvedPlan}`,
    };
  }
}

/** Checks that the orchestrator venv exists and contains the `orchestrate` binary. */
async function checkVenv(workspaceRoot: string): Promise<PreflightResult> {
  const venvDir = join(workspaceRoot, 'orchestrator', '.venv');
  try {
    await stat(venvDir);
  } catch {
    return {
      name:   'venv',
      pass:   false,
      detail: '.venv directory not found',
      fix:    'node scripts/cli.js setup --components orchestrator',
    };
  }

  const binPath = resolveOrchestrateBin(workspaceRoot);
  try {
    await stat(binPath);
  } catch {
    return {
      name:   'venv',
      pass:   false,
      detail: 'orchestrate binary not found in .venv',
      fix:    'node scripts/cli.js setup --components orchestrator --force',
    };
  }

  return { name: 'venv', pass: true, detail: 'orchestrate binary found' };
}

/**
 * Parses `orchestrator/.env` and returns key→value pairs (trimmed, comments and empty
 * lines excluded). Returns `null` when the file does not exist or cannot be read.
 */
async function parseEnvFile(workspaceRoot: string): Promise<Record<string, string> | null> {
  const envFile = join(workspaceRoot, 'orchestrator', '.env');
  let content: string;
  try {
    content = await readFile(envFile, 'utf-8');
  } catch {
    return null;
  }
  const vars: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (val) vars[key] = val;
  }
  return vars;
}

/** Checks that `orchestrator/.env` exists and contains at least one API key. */
async function checkEnv(workspaceRoot: string): Promise<PreflightResult> {
  const vars = await parseEnvFile(workspaceRoot);
  if (vars === null) {
    return {
      name:   'env',
      pass:   false,
      detail: '.env file not found',
      fix:    'cp orchestrator/.env.example orchestrator/.env  # then edit it',
    };
  }
  if (!vars['ANTHROPIC_API_KEY'] && !vars['GOOGLE_API_KEY']) {
    return {
      name:   'env',
      pass:   false,
      detail: 'No API key set in .env (need ANTHROPIC_API_KEY or GOOGLE_API_KEY)',
      fix:    'Set the appropriate API key in orchestrator/.env',
    };
  }
  return { name: 'env', pass: true, detail: 'API key configured' };
}

/** Live-validates an Anthropic API key via GET /v1/models — no tokens consumed. */
async function checkAnthropicKey(apiKey: string): Promise<PreflightResult> {
  try {
    const res = await fetch('https://api.anthropic.com/v1/models', {
      headers: {
        'x-api-key':          apiKey,
        'anthropic-version':  '2023-06-01',
      },
    });
    if (res.ok) {
      return { name: 'anthropic-key', pass: true, detail: 'key accepted by Anthropic API' };
    }
    const hint = res.status === 401 ? 'invalid or expired key' : `HTTP ${res.status}`;
    return {
      name:   'anthropic-key',
      pass:   false,
      detail: `Anthropic rejected key: ${hint}`,
      fix:    'Update ANTHROPIC_API_KEY in orchestrator/.env',
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      name:   'anthropic-key',
      pass:   false,
      detail: `Anthropic key check failed: ${msg}`,
    };
  }
}

/** Live-validates a Google AI Studio API key via GET /v1beta/models — no tokens consumed. */
async function checkGoogleKey(apiKey: string): Promise<PreflightResult> {
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url);
    if (res.ok) {
      return { name: 'google-key', pass: true, detail: 'key accepted by Google AI Studio API' };
    }
    const hint =
      res.status === 400 || res.status === 403 ? 'invalid or expired key' : `HTTP ${res.status}`;
    return {
      name:   'google-key',
      pass:   false,
      detail: `Google rejected key: ${hint}`,
      fix:    'Update GOOGLE_API_KEY in orchestrator/.env',
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      name:   'google-key',
      pass:   false,
      detail: `Google key check failed: ${msg}`,
    };
  }
}

/**
 * Recursively finds the latest modification time among all files under `dir`.
 * Returns `-Infinity` when the directory is empty or unreadable.
 */
async function latestMtimeInDir(dir: string): Promise<number> {
  let latest = -Infinity;
  let entries: Awaited<ReturnType<typeof readdir>>;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return latest;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      latest = Math.max(latest, await latestMtimeInDir(full));
    } else {
      try {
        const s = await stat(full);
        latest = Math.max(latest, s.mtimeMs);
      } catch {
        // Skip unreadable files.
      }
    }
  }
  return latest;
}

/** Checks that `mcp-server/dist/index.js` exists and is up to date with `mcp-server/src/`. */
async function checkMcpDist(workspaceRoot: string): Promise<PreflightResult> {
  const sentinel = join(workspaceRoot, 'mcp-server', 'dist', 'index.js');
  const srcDir   = join(workspaceRoot, 'mcp-server', 'src');

  let sentinelMtime: number;
  try {
    const s = await stat(sentinel);
    sentinelMtime = s.mtimeMs;
  } catch {
    return {
      name:   'mcp-dist',
      pass:   false,
      detail: 'mcp-server/dist/index.js not found',
      fix:    'cd mcp-server && npm run build',
    };
  }

  const srcLatest = await latestMtimeInDir(srcDir);
  if (srcLatest > sentinelMtime) {
    return {
      name:   'mcp-dist',
      pass:   false,
      detail: 'mcp-server/dist is stale (source is newer)',
      fix:    'cd mcp-server && npm run build',
    };
  }

  return { name: 'mcp-dist', pass: true, detail: 'mcp-server/dist is up to date' };
}

/**
 * Checks that the project root can be inferred from the plan path.
 *
 * Mirrors the Python `_infer_project_root()` logic in `orchestrator/src/cli.py`:
 * the slug directory must be exactly 4 levels below the project root
 * (`<project-root>/docs/agents/plans/<slug>`) and the `docs/agents/plans/`
 * directory must exist at the inferred root.
 *
 * Accepts both a file path (`…/plan.md`) and a folder path (`…/2026-01-01-slug`).
 */
async function checkProjectRoot(resolvedPlan: string): Promise<PreflightResult> {
  // Derive the slug directory: strip the filename when resolvedPlan is a file.
  const slugDir = resolvedPlan.endsWith('.md') ? dirname(resolvedPlan) : resolvedPlan;

  // Walk up 4 levels: plans/ → agents/ → docs/ → project-root
  let inferred = slugDir;
  for (let i = 0; i < 4; i++) {
    const parent = dirname(inferred);
    if (parent === inferred) {
      // Reached filesystem root — path too shallow.
      return {
        name:   'project-root',
        pass:   false,
        detail: 'Cannot infer project root: plan path is too shallow',
        fix:    'The plan must live at <project-root>/docs/agents/plans/<slug>/plan.md',
      };
    }
    inferred = parent;
  }

  const sanityDir = join(inferred, 'docs', 'agents', 'plans');
  try {
    await stat(sanityDir);
  } catch {
    return {
      name:   'project-root',
      pass:   false,
      detail: `docs/agents/plans/ not found at inferred project root: ${inferred}`,
      fix:    'The plan must live at <project-root>/docs/agents/plans/<slug>/plan.md, or use --project-path',
    };
  }

  return {
    name:   'project-root',
    pass:   true,
    detail: `Project root inferred: ${inferred}`,
  };
}

/**
 * Checks whether the given plan is already registered in the run queue.
 * Reads the queue file rather than querying the OS process table, so
 * multiple concurrent plans (different slugs) are handled correctly.
 */
async function checkNoConflict(resolvedPlan: string, logsDir: string): Promise<PreflightResult> {
  const entries = await readQueueFile(logsDir);
  const conflict = entries.find((e) => resolve(e.planPath) === resolvedPlan);

  if (conflict) {
    return {
      name:   'no-conflict',
      pass:   false,
      detail: `Plan is already registered in the run queue (PID ${conflict.pid})`,
      fix:    'Kill or dismiss the existing queue entry first',
    };
  }

  return { name: 'no-conflict', pass: true, detail: 'No existing run for this plan' };
}

// ---------------------------------------------------------------------------
// Public API — preflight and start
// ---------------------------------------------------------------------------

/**
 * Computes the deterministic status-file basename for a given absolute plan
 * path. The filename is a SHA-1 hex digest (first 16 chars) of the resolved
 * plan path so that two plans with identical folder names in different
 * repositories never collide in the shared `orchestrator/logs/` directory.
 *
 * Python uses the identical algorithm:
 *   `hashlib.sha1(str(plan_path).encode('utf-8')).hexdigest()[:16] + '-run-status.json'`
 */
export function runStatusFilename(resolvedPlanPath: string): string {
  const hash = createHash('sha1').update(resolvedPlanPath).digest('hex').slice(0, 16);
  return `${hash}-run-status.json`;
}

// ---------------------------------------------------------------------------
// Run-status tombstone
// ---------------------------------------------------------------------------

/**
 * Reads `<logsDir>/{runStatusFilename}` and returns its parsed content,
 * or `null` when the file does not exist yet (run still in progress or
 * never started).
 *
 * The filename must be the value returned by {@link runStatusFilename};
 * it encodes a hash of the absolute plan path so different plans with the
 * same folder basename in different repositories never collide.
 *
 * Fail-safe: any I/O or parse error returns `null`.
 */
export async function getRunStatus(
  logsDir:        string,
  statusFilename: string,
): Promise<RunStatus | null> {
  const statusPath = join(logsDir, statusFilename);
  let raw: string;
  try {
    raw = await readFile(statusPath, 'utf-8');
  } catch {
    return null;
  }
  try {
    const data = JSON.parse(raw) as unknown;
    if (typeof data !== 'object' || data === null) return null;
    const d = data as Record<string, unknown>;
    return {
      slug:        typeof d['slug']        === 'string' ? d['slug']        : statusFilename.split('-run-status.json')[0],
      result:      d['result'] === 'SUCCESS' ? 'SUCCESS'                   : 'ERROR',
      error:       typeof d['error']       === 'string' ? d['error']       : null,
      logFilename: typeof d['logFilename'] === 'string' ? d['logFilename'] : '',
      durationS:   typeof d['durationS']  === 'number' ? d['durationS']   : null,
    };
  } catch {
    return null;
  }
}

/**
 * Runs preflight checks and optionally spawns a detached orchestrator process.
 *
 * Preflight checks run unconditionally for environment state (venv, env,
 * mcp-dist). Path-dependent checks (path-prefix, plan-basename, plan-file,
 * project-root, no-conflict) run only when the path is determined to be
 * inside the workspace root.
 *
 * - `dryRun: true`  → returns all check results without spawning.
 * - Any check fails → returns results with `started: false`.
 * - All pass + not dry-run → spawns detached `orchestrate` process,
 *   returns `started: true` and the `pid`.
 *
 * @param planPath       - Absolute path to the plan `.md` file.
 * @param workspaceRoot  - Absolute path to the workspace root directory.
 * @param dryRun         - When `true`, skip spawning even if all checks pass.
 * @param resumeThreadId - When provided, passes `--resume <threadId>` to the
 *                         spawned process so the orchestrator resumes an
 *                         existing LangGraph thread instead of starting fresh.
 */
export async function startOrchestrator(
  planPath:        string,
  workspaceRoot:   string,
  dryRun           = false,
  resumeThreadId?: string,
): Promise<StartResult> {
  const resolvedPlan = resolve(planPath);
  const resolvedRoot = resolve(workspaceRoot);

  const checks: PreflightResult[] = [];

  // Run all checks in parallel — plan path is resolved above, no traversal risk.
  const [planChecks, envChecks, keyChecks] = await Promise.all([
    Promise.all([
      Promise.resolve(checkPlanBasename(resolvedPlan)),
      checkPlanFile(resolvedPlan),
      checkProjectRoot(resolvedPlan),
      checkNoConflict(resolvedPlan, join(resolvedRoot, 'orchestrator', 'logs')),
    ]),
    Promise.all([checkVenv(resolvedRoot), checkEnv(resolvedRoot), checkMcpDist(resolvedRoot)]),
    parseEnvFile(resolvedRoot).then((vars) => {
      if (!vars) return [] as PreflightResult[];
      const pending: Promise<PreflightResult>[] = [];
      if (vars['ANTHROPIC_API_KEY']) pending.push(checkAnthropicKey(vars['ANTHROPIC_API_KEY']));
      if (vars['GOOGLE_API_KEY'])    pending.push(checkGoogleKey(vars['GOOGLE_API_KEY']));
      return Promise.all(pending);
    }),
  ]);

  checks.push(...planChecks, ...envChecks, ...keyChecks);

  // Dry-run: return results without spawning.
  if (dryRun) {
    return { checks, started: false };
  }

  // Any failure → do not spawn.
  if (checks.some((c) => !c.pass)) {
    return { checks, started: false };
  }

  // All checks passed — spawn a detached orchestrator process.
  const bin            = resolveOrchestrateBin(resolvedRoot);
  const statusFilename = runStatusFilename(resolvedPlan);
  const spawnArgs      = resumeThreadId
    ? ['--resume', resumeThreadId, resolvedPlan]
    : [resolvedPlan];
  const child = spawn(bin, spawnArgs, {
    detached:    true,
    stdio:       ['ignore', 'ignore', 'ignore'],
    env:         { ...process.env, PYTHONUTF8: '1' },
    windowsHide: true,
  });
  child.unref();

  return { checks, started: true, pid: child.pid, runStatusFilename: statusFilename };
}

```
###  Path: `/mcp-server/gui/server.ts`

```ts
/**
 * GUI HTTP Server
 *
 * Standalone Node.js HTTP server that routes requests to API handlers
 * (gui/api.ts) and serves static files from gui/public/. This is a SEPARATE
 * process from the MCP server — stdout logging is allowed and expected.
 *
 * CLI Arguments:
 *   --port <n>           Listen port (default: 3420)
 *   --ledger-dir <path>  Ledger root path (handled by resolveLedgerRoot())
 */

import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveLedgerRoot, resolveProjectDir, ORCHESTRATOR_LOGS_DIR, WORKSPACE_ROOT } from '../src/utils/ledger-root.js';
import { loadStoresConfig, resolveGuiConfigPath } from '../src/storage/store-registry.js';
import { StoreRouter } from '../src/storage/store-router.js';
import { MultiStoreManager } from '../src/storage/multi-store-manager.js';
import { setStoreContext, isStoreContextInitialized, getStoreRouter } from '../src/storage/store-context.js';
import { SAFE_SLUG_REGEX } from '../src/utils/constants.js';
import { captureWorkspaceVersions } from '../src/utils/workspace-versions.js';
import type { WorkspaceVersions } from '../src/utils/workspace-versions.js';
import { readConfigFromDisk, startConfigWatcher } from '../src/gui/config.js';
import { startAutoArchiveTimer } from '../src/gui/auto-archive.js';
import {
  handleListRunLogs,
  handleGetRunLog,
} from '../src/gui/handlers/run-log-handlers.js';
import {
  handleListProjects,
  handleGetProject,
  handleGetPlanDocument,
  handleGetSynthesisDocument,
  handleListWorkPackages,
  handleGetWorkPackage,
  handleDeleteProject,
  handleGetConfig,
  handleUpdateConfig,
  handleResetProject,
  handleGetProjectHealth,
  handleGetWorkPackageOverview,
  handleRenameProject,
  handleArchiveProject,
  handleUnarchiveProject,
  handleMarkProjectComplete,
  handleListDialogues,
  handleGetDialogueFile,
  handleListChunks,
  handleGetChunkFile,
  handleGetChunkText,
  handleOrchestratorStart,
  handleGetOrchestratorQueue,
  handleOrchestratorKill,
  handleOrchestratorDismiss,
  handleOrchestratorDelete,
  handleGetRunStatus,
  handleGetRunMetadata,
  ApiError,
} from './api.js';
import {
  handleGetStoresEnriched,
  handleGetStoreConflicts,
  handleAddStore,
  handleImportStore,
  handleUpdateStore,
  handleRemoveStore,
  handleSetDefaultStore,
  handleReorderStores,
} from './api-stores.js';
import {
  handleListKnowledge,
  handleUpdateKnowledge,
  handleDeleteKnowledge,
  handlePromoteKnowledge,
  handleMoveKnowledge,
} from './api-knowledge.js';
import {
  handleListRepos,
  handleGetRepo,
  handleCreateRepo,
  handleUpdateRepo,
  handleDeleteRepo,
  handleMoveRepo,
  type RepoListItem,
} from './api-repos.js';
import {
  handleGetModels,
  handleSaveModels,
  handleLoadDefaults,
  handleGetAssignments,
  handleUpdateAssignments,
  handleReplaceAssignedModel,
  handleGetPersonas,
  handleRebuildPersonas,
} from './api-models.js';
import { renderChunksToDialogue, renderChunksToStructured } from './chunk-renderer.js';

// ---------------------------------------------------------------------------
// Path resolution (ESM-safe)
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PUBLIC_DIR = join(__dirname, 'public');

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function getPort(): number {
  const args = process.argv;
  const idx = args.indexOf('--port');
  if (idx !== -1 && idx + 1 < args.length) {
    const p = parseInt(args[idx + 1]!, 10);
    if (!isNaN(p) && p > 0) return p;
  }
  return 3420;
}

// ---------------------------------------------------------------------------
// MIME types
// ---------------------------------------------------------------------------

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
};

// ---------------------------------------------------------------------------
// CORS helpers
// ---------------------------------------------------------------------------

function corsHeaders(port: number): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': `http://localhost:${port}`,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

// ---------------------------------------------------------------------------
// Security headers
// ---------------------------------------------------------------------------

function securityHeaders(): Record<string, string> {
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Content-Security-Policy':
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'",
  };
}

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

function sendJson(
  res: ServerResponse,
  status: number,
  data: unknown,
  port: number
): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    ...corsHeaders(port),
    ...securityHeaders(),
  });
  res.end(body);
}

function sendError(
  res: ServerResponse,
  status: number,
  code: string,
  message: string,
  port: number
): void {
  sendJson(res, status, { error: { code, message } }, port);
}

export function apiErrorToStatus(code: string): number {
  switch (code) {
    case 'NOT_FOUND':
      return 404;
    case 'FORBIDDEN':
      return 403;
    case 'VALIDATION_ERROR':
      return 400;
    case 'CONFLICT':
      return 409;
    default:
      return 500;
  }
}

// ---------------------------------------------------------------------------
// Body reading
// ---------------------------------------------------------------------------

/** Maximum accepted request body size (1 MiB). */
export const MAX_BODY_BYTES = 1_048_576;

/** Thrown by {@link readBody} when the request body exceeds {@link MAX_BODY_BYTES}. */
export class PayloadTooLargeError extends Error {
  constructor() {
    super('Payload Too Large');
    this.name = 'PayloadTooLargeError';
  }
}

/**
 * Reads the full request body as a UTF-8 string, enforcing a size limit of
 * {@link MAX_BODY_BYTES} (1 MiB).
 *
 * @throws {PayloadTooLargeError} When the body exceeds the limit (detected
 *   either via Content-Length header pre-check or streaming byte count).
 *   **Callers must catch this error and return a 413 response.**
 *
 * @param req - The incoming HTTP request.
 * @returns The full body string.
 */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    // Content-Length pre-check: reject immediately if the declared size exceeds the limit.
    const declaredLength = req.headers['content-length'];
    if (declaredLength !== undefined) {
      const n = parseInt(declaredLength, 10);
      if (!isNaN(n) && n > MAX_BODY_BYTES) {
        req.resume();  // drain body data from socket buffer
        reject(new PayloadTooLargeError());
        return;
      }
    }

    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let rejected = false;

    req.on('data', (chunk: Buffer) => {
      if (rejected) return;
      totalBytes += chunk.length;
      if (totalBytes > MAX_BODY_BYTES) {
        rejected = true;
        reject(new PayloadTooLargeError());
        // Drain remaining data so the 413 response can be sent cleanly.
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!rejected) resolve(Buffer.concat(chunks).toString('utf-8'));
    });
    req.on('error', (err) => {
      if (!rejected) reject(err);
    });
  });
}

/**
 * Reads and parses the request body as JSON, enforcing the same size limit as
 * {@link readBody}. Throws {@link PayloadTooLargeError} for oversized bodies
 * and {@link ApiError} with code `VALIDATION_ERROR` for invalid JSON.
 *
 * @param req - The incoming HTTP request.
 * @returns The parsed JSON value.
 */
async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const raw = await readBody(req);
  try {
    return JSON.parse(raw);
  } catch {
    throw new ApiError('VALIDATION_ERROR', 'Invalid JSON body.');
  }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

/**
 * The set of HTTP methods accepted by the route dispatcher.
 *
 * Narrowing `Route.method` to this union converts a previously runtime-only
 * validation (enforced by `route-table.test.ts`) into a compile-time guarantee.
 * The test continues to serve as defense-in-depth.
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * A declarative body-parsing route entry for {@link buildRoutes} and
 * {@link dispatchRoute}.
 *
 * - `method` — HTTP method; must be one of the {@link HttpMethod} values
 *   (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`, uppercase). The union type
 *   enforces this at compile time; `route-table.test.ts` provides
 *   defense-in-depth at test time.
 * - `path` — Exact string path or a RegExp with named capture groups.
 * - `handler` — Receives the parsed body (or `undefined` when `noBody` is
 *   set), any named capture groups extracted from the RegExp match, and the
 *   parsed query parameters from the request URL.
 * - `statusCode` — Response status code (default `200`). Use `204` for empty
 *   responses — the dispatcher writes the header and skips `sendJson()`.
 * - `noBody` — When `true`, skip `readJsonBody()`.
 */
export interface Route {
  method: HttpMethod;
  path: string | RegExp;
  handler: (body: unknown, groups?: Record<string, string>, query?: URLSearchParams) => Promise<unknown>;
  statusCode?: number;
  noBody?: boolean;
}

// ---------------------------------------------------------------------------
// Meta helpers
// ---------------------------------------------------------------------------

/**
 * Guards against path-traversal attacks on URL parameters that are used as
 * filesystem path segments.
 *
 * Rejects any segment that is empty or does not match {@link SAFE_SLUG_REGEX}
 * (`/^[a-z0-9][a-z0-9-]*$/`). Throws {@link ApiError} `NOT_FOUND` so that
 * callers receive the same status as a missing project — no information leak.
 *
 * @param segment - The raw URL parameter value to validate.
 */
function assertSafeSlug(segment: string): void {
  if (!segment || !SAFE_SLUG_REGEX.test(segment)) {
    throw new ApiError('NOT_FOUND', 'Invalid repo or slug parameter.');
  }
}

/**
 * Reads the `.meta.json` for a namespaced project at
 * `{ledgerRoot}/{repoUrlParam}/{slugUrlParam}/.meta.json`.
 *
 * Returns the stored `repository_name` value, falling back to `repoUrlParam`
 * when the field is absent or null.
 *
 * When the meta file exists but contains malformed JSON, the function still
 * falls back to `repoUrlParam` — but writes a warning to `process.stderr`
 * (format: `[server] Warning: malformed .meta.json at {path} — falling back
 * to URL param '…'`) so operators can detect corrupt meta files during
 * troubleshooting. API callers always receive the fallback value in this case.
 *
 * Throws {@link ApiError} `NOT_FOUND` when the meta file does not exist —
 * indicating that the `{repo}/{slug}` combination is not a known project in
 * this ledger. This is the project-existence check for namespaced routes.
 * Using `NOT_FOUND` (rather than a 400 or `VALIDATION_ERROR`) is intentional
 * information-hiding: invalid-input and missing-project cases are
 * indistinguishable from the client side.
 *
 * Both `repoUrlParam` and `slugUrlParam` are validated via {@link assertSafeSlug}
 * before any filesystem access is attempted (defence-in-depth).
 */
export async function resolveRepoName(
  ledgerRoot: string,
  repoUrlParam: string,
  slugUrlParam: string,
): Promise<string> {
  assertSafeSlug(repoUrlParam);
  assertSafeSlug(slugUrlParam);

  // In multi-store mode, search all configured stores; fall back to default store otherwise.
  const storePaths =
    isStoreContextInitialized() && getStoreRouter().isMultiStoreMode()
      ? getStoreRouter().getAllStorePaths()
      : [ledgerRoot];

  for (const storePath of storePaths) {
    const metaPath = join(storePath, repoUrlParam, slugUrlParam, '.meta.json');
    let raw: string;
    try {
      raw = await readFile(metaPath, 'utf-8');
    } catch {
      // .meta.json not found in this store — try next
      continue;
    }
    try {
      const meta = JSON.parse(raw) as { repository_name?: string | null };
      return meta.repository_name ?? repoUrlParam;
    } catch {
      // Malformed .meta.json — log and fall back to URL param
      process.stderr.write(`[server] Warning: malformed .meta.json at ${metaPath} — falling back to URL param '${repoUrlParam}'\n`);
      return repoUrlParam;
    }
  }

  throw new ApiError('NOT_FOUND', `Project not found: ${slugUrlParam}`);
}

/**
 * Extracts query-string parameters from a full URL string.
 * Returns a URLSearchParams instance (empty if no query string present).
 *
 * Edge-case behaviour:
 * - **Bare `?`** (e.g. `/api/foo?`): `url.slice(qIdx + 1)` is `""` → returns
 *   an empty `URLSearchParams`. Safe, no exceptions.
 * - **Percent-encoded values** (e.g. `?q=hello%20world`): `URLSearchParams`
 *   decodes them transparently — `params.get('q')` returns `"hello world"`.
 * - **Fragment / hash characters** (e.g. `?x=1#anchor`): the `#` and
 *   everything after it are passed through as literal characters inside the
 *   query value because no fragment stripping is performed. Browsers strip the
 *   fragment before sending the request, so in practice this situation does not
 *   arise for server-received URLs.
 */
function parseQueryString(url: string): URLSearchParams {
  const qIdx = url.indexOf('?');
  return new URLSearchParams(qIdx !== -1 ? url.slice(qIdx + 1) : '');
}

// ---------------------------------------------------------------------------
// Static file server
// ---------------------------------------------------------------------------

async function serveStatic(
  req: IncomingMessage,
  res: ServerResponse,
  port: number
): Promise<void> {
  const urlPath = (req.url ?? '/').split('?')[0]!;
  const filePath =
    urlPath === '/' ? join(PUBLIC_DIR, 'index.html') : join(PUBLIC_DIR, urlPath.slice(1));

  // Security: prevent path traversal outside PUBLIC_DIR
  const resolved = resolve(filePath);
  if (!resolved.startsWith(PUBLIC_DIR)) {
    sendError(res, 404, 'NOT_FOUND', 'Not found.', port);
    return;
  }

  const ext = extname(filePath);
  const mimeType = MIME_TYPES[ext] ?? 'application/octet-stream';

  try {
    const content = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': mimeType,
      'Content-Length': content.length,
      'Cache-Control': 'no-store',
      ...corsHeaders(port),
      ...securityHeaders(),
    });
    res.end(content);
  } catch {
    sendError(res, 404, 'NOT_FOUND', 'Not found.', port);
  }
}

// ---------------------------------------------------------------------------
// Route dispatcher
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Domain sub-builders
//
// Each function returns Route[] for a single domain area and captures only the
// closure parameters it needs. All sub-builders are non-exported: they are
// composed exclusively by buildRoutes().
// ---------------------------------------------------------------------------

/**
 * Config/server-info routes.
 *
 * Section A:
 *   PUT  /api/config
 *   GET  /api/server-info
 *   GET  /api/config
 */
function buildConfigRoutes(
  configPath: string,
  bootVersions: WorkspaceVersions | null
): Route[] {
  return [
    // PUT /api/config
    { method: 'PUT', path: '/api/config',
      handler: async (body) => handleUpdateConfig(configPath, body) },
    // GET /api/server-info — needs bootVersions closure
    { method: 'GET', path: '/api/server-info', noBody: true,
      handler: async () => {
        const boot = bootVersions ?? captureWorkspaceVersions();
        const disk = captureWorkspaceVersions();
        const stale =
          boot.mcpServer !== disk.mcpServer ||
          boot.personas !== disk.personas ||
          boot.orchestrator !== disk.orchestrator;
        return { stale, bootVersions: boot, diskVersions: disk };
      } },
    // GET /api/config
    { method: 'GET', path: '/api/config', noBody: true,
      handler: async () => handleGetConfig(configPath) },
  ];
}

/**
 * Orchestrator routes (Section A body-parsing and Section B body-free).
 *
 * Section A:
 *   POST /api/orchestrator/start
 *   POST /api/orchestrator/kill/:id
 *   POST /api/orchestrator/dismiss/:id
 *   POST /api/orchestrator/delete/:id
 *
 * Section B:
 *   GET  /api/orchestrator/queue
 *   GET  /api/orchestrator/run-status/:filename
 */
function buildOrchestratorRoutes(
  ledgerRoot: string,
  orchestratorLogsDir: string
): Route[] {
  return [
    // POST /api/orchestrator/start
    { method: 'POST', path: '/api/orchestrator/start',
      handler: async (body) => handleOrchestratorStart(WORKSPACE_ROOT, body) },
    // POST /api/orchestrator/kill/:id
    { method: 'POST', path: /^\/api\/orchestrator\/kill\/(?<id>.+)$/, noBody: true,
      handler: async (_, groups) =>
        handleOrchestratorKill(
          decodeURIComponent(groups!.id!), orchestratorLogsDir, ledgerRoot
        ) },
    // POST /api/orchestrator/dismiss/:id — 204 No Content
    { method: 'POST', path: /^\/api\/orchestrator\/dismiss\/(?<id>.+)$/, noBody: true,
      statusCode: 204,
      handler: async (_, groups) => {
        await handleOrchestratorDismiss(
          decodeURIComponent(groups!.id!), orchestratorLogsDir, ledgerRoot
        );
        return undefined;
      } },
    // POST /api/orchestrator/delete/:id — 204 No Content
    { method: 'POST', path: /^\/api\/orchestrator\/delete\/(?<id>.+)$/, noBody: true,
      statusCode: 204,
      handler: async (_, groups) => {
        await handleOrchestratorDelete(
          decodeURIComponent(groups!.id!), orchestratorLogsDir
        );
        return undefined;
      } },
    // GET /api/orchestrator/queue
    { method: 'GET', path: '/api/orchestrator/queue', noBody: true,
      handler: async () => handleGetOrchestratorQueue(orchestratorLogsDir, ledgerRoot) },
    // GET /api/orchestrator/run-status/:filename
    { method: 'GET', path: /^\/api\/orchestrator\/run-status\/(?<filename>.+)$/, noBody: true,
      handler: async (_, groups) =>
        handleGetRunStatus(orchestratorLogsDir, decodeURIComponent(groups!.filename!)) },
  ];
}

/**
 * Repository routes (Section A body-parsing and Section B body-free).
 *
 * Section A:
 *   POST   /api/repos
 *   PUT    /api/repos/:repoId
 *
 * Section B:
 *   GET    /api/repos
 *   GET    /api/repos/:repoId
 *   DELETE /api/repos/:repoId
 */

function buildRepoRoutes(ledgerRoot: string): Route[] {
  return [
    // POST /api/repos — 201 Created
    { method: 'POST', path: '/api/repos', statusCode: 201,
      handler: async (body) => handleCreateRepo(ledgerRoot, body) },
    // PUT /api/repos/:repoId
    { method: 'PUT', path: /^\/api\/repos\/(?<repoId>[^/]+)$/,
      handler: async (body, groups) =>
        handleUpdateRepo(ledgerRoot, decodeURIComponent(groups!.repoId!), body) },
    // POST /api/repos/:repoId/move
    { method: 'POST', path: /^\/api\/repos\/(?<repoId>[^/]+)\/move$/,
      handler: async (body, groups) =>
        handleMoveRepo(ledgerRoot, decodeURIComponent(groups!.repoId!), body) },
    // GET /api/repos — always delegates to handleListRepos() which handles
    //   both multi-store (tagged results) and single-store modes.
    { method: 'GET', path: '/api/repos', noBody: true,
      handler: async (_, _groups, query) =>
        handleListRepos(ledgerRoot, query?.get('include_undeclared') === 'true') },
    // GET /api/repos/:repoId
    { method: 'GET', path: /^\/api\/repos\/(?<repoId>[^/]+)$/, noBody: true,
      handler: async (_, groups) =>
        handleGetRepo(ledgerRoot, decodeURIComponent(groups!.repoId!)) },
    // DELETE /api/repos/:repoId
    { method: 'DELETE', path: /^\/api\/repos\/(?<repoId>[^/]+)$/, noBody: true,
      handler: async (_, groups) =>
        handleDeleteRepo(ledgerRoot, decodeURIComponent(groups!.repoId!)) },
  ];
}

/**
 * Knowledge routes (Section A body-parsing and Section B body-free).
 *
 * Section A:
 *   PATCH /api/knowledge/:id
 *   POST  /api/knowledge/:id/move
 *
 * Section B:
 *   GET    /api/knowledge
 *   DELETE /api/knowledge/:id
 *   POST   /api/knowledge/:id/promote
 */
function buildKnowledgeRoutes(ledgerRoot: string): Route[] {
  return [
    // PATCH /api/knowledge/:id
    { method: 'PATCH', path: /^\/api\/knowledge\/(?<id>[^/]+)$/,
      handler: async (body, groups) =>
        handleUpdateKnowledge(ledgerRoot, decodeURIComponent(groups!.id!), body) },
    // POST /api/knowledge/:id/move
    { method: 'POST', path: /^\/api\/knowledge\/(?<id>[^/]+)\/move$/,
      handler: async (body, groups) =>
        handleMoveKnowledge(ledgerRoot, decodeURIComponent(groups!.id!), body) },
    // GET /api/knowledge[?scope&category&tags&repository_name&query&limit&offset]
    { method: 'GET', path: '/api/knowledge', noBody: true,
      handler: async (_, _groups, query) => {
        const params = {
          scope: query?.get('scope') ?? undefined,
          category: query?.get('category') ?? undefined,
          tags: query?.get('tags') ?? undefined,
          repository_name: query?.get('repository_name') ?? undefined,
          query: query?.get('query') ?? undefined,
          limit: query?.get('limit') ?? undefined,
          offset: query?.get('offset') ?? undefined,
        };
        return handleListKnowledge(ledgerRoot, params);
      } },
    // DELETE /api/knowledge/:id[?scope&repository_name]
    { method: 'DELETE', path: /^\/api\/knowledge\/(?<id>[^/]+)$/, noBody: true,
      handler: async (_, groups, query) =>
        handleDeleteKnowledge(
          ledgerRoot,
          decodeURIComponent(groups!.id!),
          query?.get('scope') ?? undefined,
          query?.get('repository_name') ?? undefined,
        ) },
    // POST /api/knowledge/:id/promote[?scope&repository_name]
    { method: 'POST', path: /^\/api\/knowledge\/(?<id>[^/]+)\/promote$/, noBody: true,
      handler: async (_, groups, query) =>
        handlePromoteKnowledge(
          ledgerRoot,
          decodeURIComponent(groups!.id!),
          query?.get('scope') ?? undefined,
          query?.get('repository_name') ?? undefined,
        ) },
  ];
}

/**
 * Model/assignment/persona routes (Section A body-parsing and Section B body-free).
 *
 * Section A:
 *   PUT  /api/models
 *   POST /api/models/load-defaults
 *   PUT  /api/model-assignments
 *   POST /api/model-assignments/replace
 *   POST /api/personas/rebuild
 *
 * Section B:
 *   GET  /api/models
 *   GET  /api/model-assignments
 *   GET  /api/personas
 */
function buildModelRoutes(): Route[] {
  return [
    // PUT /api/models
    { method: 'PUT', path: '/api/models',
      handler: async (body) => handleSaveModels(body) },
    // POST /api/models/load-defaults
    { method: 'POST', path: '/api/models/load-defaults', noBody: true,
      handler: async () => handleLoadDefaults() },
    // PUT /api/model-assignments
    { method: 'PUT', path: '/api/model-assignments',
      handler: async (body) => handleUpdateAssignments(body) },
    // POST /api/model-assignments/replace
    { method: 'POST', path: '/api/model-assignments/replace',
      handler: async (body) => handleReplaceAssignedModel(body) },
    // POST /api/personas/rebuild — conditional ApiError on build failure
    { method: 'POST', path: '/api/personas/rebuild', noBody: true,
      handler: async () => {
        const result = await handleRebuildPersonas(WORKSPACE_ROOT);
        if (!result.success) throw new ApiError('BUILD_FAILED', result.output);
        return result;
      } },
    // GET /api/models
    { method: 'GET', path: '/api/models', noBody: true,
      handler: async () => handleGetModels() },
    // GET /api/model-assignments
    { method: 'GET', path: '/api/model-assignments', noBody: true,
      handler: async () => handleGetAssignments() },
    // GET /api/personas
    { method: 'GET', path: '/api/personas', noBody: true,
      handler: async () => handleGetPersonas() },
  ];
}

/**
 * Store routes (Section A body-parsing and Section B body-free).
 *
 * Section A — Body-parsing write routes:
 *   POST   /api/stores              — add a new store (creates directory)
 *   POST   /api/stores/import       — import existing directory as a store
 *   PUT    /api/stores/order         — reorder stores
 *   PUT    /api/stores/:storeId     — update store label
 *
 * Section B — Body-free routes:
 *   DELETE /api/stores/:storeId     — remove store (deregisters only)
 *   POST   /api/stores/:storeId/default — set the default store
 *   GET    /api/stores/conflicts    — cross-store conflicts (literal path)
 *   GET    /api/stores              — enriched store list (catch-all)
 *
 * ⚠️  ORDERING CONSTRAINT: Literal-path routes (/import, /order, /conflicts)
 *     MUST precede parameterised :storeId routes to avoid shadowing.
 *     GET /api/stores/conflicts MUST precede the GET /api/stores catch-all.
 */
function buildStoreRoutes(ledgerRoot: string): Route[] {
  return [
    // =========================================================================
    // Section A — Body-parsing store write routes
    // =========================================================================

    // POST /api/stores — add new store (201 Created)
    { method: 'POST', path: '/api/stores', statusCode: 201,
      handler: async (body) => handleAddStore(body) },
    // POST /api/stores/import — literal path must precede :storeId routes (201 Created)
    { method: 'POST', path: '/api/stores/import', statusCode: 201,
      handler: async (body) => handleImportStore(body) },
    // PUT /api/stores/order — literal path must precede :storeId routes
    { method: 'PUT', path: '/api/stores/order',
      handler: async (body) => handleReorderStores(body) },
    // PUT /api/stores/:storeId — update store label
    { method: 'PUT', path: /^\/api\/stores\/(?<storeId>[^/]+)$/,
      handler: async (body, groups) =>
        handleUpdateStore(decodeURIComponent(groups!.storeId!), body) },

    // =========================================================================
    // Section B — Body-free store routes
    // =========================================================================

    // DELETE /api/stores/:storeId — remove store (no directory deletion)
    { method: 'DELETE', path: /^\/api\/stores\/(?<storeId>[^/]+)$/, noBody: true,
      handler: async (_, groups) =>
        handleRemoveStore(decodeURIComponent(groups!.storeId!)) },
    // POST /api/stores/:storeId/default — set default store
    { method: 'POST', path: /^\/api\/stores\/(?<storeId>[^/]+)\/default$/, noBody: true,
      handler: async (_, groups) =>
        handleSetDefaultStore(decodeURIComponent(groups!.storeId!)) },
    // GET /api/stores/conflicts — must precede the /api/stores catch-all
    { method: 'GET', path: '/api/stores/conflicts', noBody: true,
      handler: async () => handleGetStoreConflicts() },
    // GET /api/stores — enriched store list (catch-all, must be last)
    { method: 'GET', path: '/api/stores', noBody: true,
      handler: async () => handleGetStoresEnriched(ledgerRoot) },
  ];
}

/**
 * Project routes spanning all three sections.
 *
 * Section A — Body-parsing mutations on projects:
 *   PATCH /api/projects/:repo/:slug  (namespaced)
 *   PATCH /api/projects/:slug  (deprecated)
 *   POST  /api/projects/:repo/:slug/reset  (namespaced)
 *   POST  /api/projects/:slug/reset  (deprecated)
 *
 * Section B — Keyword-specific body-free routes (active namespaced + deprecated):
 *   GET  /api/projects
 *   GET  /api/projects/:repo/:slug/plan|synthesis|health|run-metadata|work-packages|...
 *   POST /api/projects/:repo/:slug/archive|unarchive|complete
 *   ... and deprecated /:slug/keyword analogues
 *
 * Section C — Catch-all body-free routes:
 *   DELETE /api/projects/:repo/:slug  (namespaced)
 *   GET    /api/projects/:repo/:slug  (namespaced, catch-all)
 *
 * ⚠️  ORDERING CONSTRAINT: Section B keyword routes MUST precede Section C
 *     catch-alls within this sub-builder. The caller (buildRoutes) preserves
 *     the overall Section A/B/C ordering by spreading sub-builder results in
 *     the correct order.
 */
function buildProjectRoutes(
  ledgerRoot: string,
  orchestratorLogsDir: string
): Route[] {
  return [

    // =========================================================================
    // Section A — Body-parsing project mutations
    // =========================================================================

    // PATCH /api/projects/:repo/:slug (namespaced)
    { method: 'PATCH', path: /^\/api\/projects\/(?<repo>[^/]+)\/(?<slug>[^/]+)$/,
      handler: async (body, groups) => {
        const repo = decodeURIComponent(groups!.repo!);
        const slug = decodeURIComponent(groups!.slug!);
        assertSafeSlug(repo);
        assertSafeSlug(slug);
        const repoName = await resolveRepoName(ledgerRoot, repo, slug);
        return handleRenameProject(ledgerRoot, slug, body, repoName);
      } },
    // @deprecated — Use PATCH /api/projects/:repo/:slug instead.
    // PATCH /api/projects/:slug (retained for backward compat)
    { method: 'PATCH', path: /^\/api\/projects\/(?<slug>[^/]+)$/,
      handler: async (body, groups) =>
        handleRenameProject(ledgerRoot, decodeURIComponent(groups!.slug!), body) },
    // POST /api/projects/:repo/:slug/reset (namespaced)
    { method: 'POST', path: /^\/api\/projects\/(?<repo>[^/]+)\/(?<slug>[^/]+)\/reset$/,
      handler: async (body, groups) => {
        const repo = decodeURIComponent(groups!.repo!);
        const slug = decodeURIComponent(groups!.slug!);
        assertSafeSlug(repo);
        assertSafeSlug(slug);
        const repoName = await resolveRepoName(ledgerRoot, repo, slug);
        return handleResetProject(ledgerRoot, slug, body, repoName);
      } },
    // @deprecated — Use POST /api/projects/:repo/:slug/reset instead.
    // POST /api/projects/:slug/reset (retained for backward compat)
    { method: 'POST', path: /^\/api\/projects\/(?<slug>[^/]+)\/reset$/,
      handler: async (body, groups) =>
        handleResetProject(ledgerRoot, decodeURIComponent(groups!.slug!), body) },

    // =========================================================================
    // Section B — Keyword-specific body-free routes
    //
    // ⚠️  These MUST be declared before Section C catch-alls (see ordering note
    //     in the JSDoc of buildRoutes). Adding a catch-all before these entries
    //     would silently shadow the deprecated keyword routes and break backward
    //     compat.
    // =========================================================================

    // GET /api/projects[?page&limit&status&search&sort&dir&runner]
    { method: 'GET', path: '/api/projects', noBody: true,
      handler: async (_, _groups, query) => {
        const params = {
          page: query?.get('page') ?? undefined,
          limit: query?.get('limit') ?? undefined,
          status: query?.get('status') ?? undefined,
          search: query?.get('search') ?? undefined,
          sort: query?.get('sort') ?? undefined,
          dir: query?.get('dir') ?? undefined,
          runner: query?.get('runner') ?? undefined,
          repository: query?.get('repository') ?? undefined,
        };
        return handleListProjects(ledgerRoot, params);
      } },

    // --- Namespaced /:repo/:slug keyword routes (active) ---
    // Placed in Section B because they have fixed keyword suffixes (e.g. /plan,
    // /synthesis) that make them more specific than the Section C catch-all.

    // GET /api/projects/:repo/:slug/plan
    { method: 'GET', path: /^\/api\/projects\/(?<repo>[^/]+)\/(?<slug>[^/]+)\/plan$/, noBody: true,
      handler: async (_, groups) => {
        const repo = decodeURIComponent(groups!.repo!);
        const slug = decodeURIComponent(groups!.slug!);
        assertSafeSlug(repo);
        assertSafeSlug(slug);
        const repoName = await resolveRepoName(ledgerRoot, repo, slug);
        return handleGetPlanDocument(ledgerRoot, slug, repoName);
      } },

    // GET /api/projects/:repo/:slug/synthesis
    { method: 'GET', path: /^\/api\/projects\/(?<repo>[^/]+)\/(?<slug>[^/]+)\/synthesis$/, noBody: true,
      handler: async (_, groups) => {
        const repo = decodeURIComponent(groups!.repo!);
        const slug = decodeURIComponent(groups!.slug!);
        assertSafeSlug(repo);
        assertSafeSlug(slug);
        const repoName = await resolveRepoName(ledgerRoot, repo, slug);
        return handleGetSynthesisDocument(ledgerRoot, slug, repoName);
      } },

    // GET /api/projects/:repo/:slug/health
    { method: 'GET', path: /^\/api\/projects\/(?<repo>[^/]+)\/(?<slug>[^/]+)\/health$/, noBody: true,
      handler: async (_, groups) => {
        const repo = decodeURIComponent(groups!.repo!);
        const slug = decodeURIComponent(groups!.slug!);
        assertSafeSlug(repo);
        assertSafeSlug(slug);
        const repoName = await resolveRepoName(ledgerRoot, repo, slug);
        return handleGetProjectHealth(ledgerRoot, slug, repoName);
      } },

    // GET /api/projects/:repo/:slug/run-metadata
    { method: 'GET', path: /^\/api\/projects\/(?<repo>[^/]+)\/(?<slug>[^/]+)\/run-metadata$/, noBody: true,
      handler: async (_, groups) => {
        const repo = decodeURIComponent(groups!.repo!);
        const slug = decodeURIComponent(groups!.slug!);
        assertSafeSlug(repo);
        assertSafeSlug(slug);
        const repoName = await resolveRepoName(ledgerRoot, repo, slug);
        return handleGetRunMetadata(ledgerRoot, slug, repoName);
      } },

    // GET /api/projects/:repo/:slug/work-packages
    { method: 'GET', path: /^\/api\/projects\/(?<repo>[^/]+)\/(?<slug>[^/]+)\/work-packages$/, noBody: true,
      handler: async (_, groups) => {
        const repo = decodeURIComponent(groups!.repo!);
        const slug = decodeURIComponent(groups!.slug!);
        assertSafeSlug(repo);
        assertSafeSlug(slug);
        const repoName = await resolveRepoName(ledgerRoot, repo, slug);
        return handleListWorkPackages(ledgerRoot, slug, repoName);
      } },

    // GET /api/projects/:repo/:slug/work-packages/overview
    // Must appear BEFORE /:repo/:slug/work-packages/:wpId — same prefix, more specific suffix.
    { method: 'GET', path: /^\/api\/projects\/(?<repo>[^/]+)\/(?<slug>[^/]+)\/work-packages\/overview$/, noBody: true,
      handler: async (_, groups) => {
        const repo = decodeURIComponent(groups!.repo!);
        const slug = decodeURIComponent(groups!.slug!);
        assertSafeSlug(repo);
        assertSafeSlug(slug);
        const repoName = await resolveRepoName(ledgerRoot, repo, slug);
        return handleGetWorkPackageOverview(ledgerRoot, slug, repoName);
      } },

    // GET /api/projects/:repo/:slug/work-packages/:wpId
    { method: 'GET', path: /^\/api\/projects\/(?<repo>[^/]+)\/(?<slug>[^/]+)\/work-packages\/(?<wpId>[^/]+)$/, noBody: true,
      handler: async (_, groups) => {
        const repo = decodeURIComponent(groups!.repo!);
        const slug = decodeURIComponent(groups!.slug!);
        assertSafeSlug(repo);
        assertSafeSlug(slug);
        const repoName = await resolveRepoName(ledgerRoot, repo, slug);
        return handleGetWorkPackage(ledgerRoot, slug, groups!.wpId!, repoName);
      } },

    // GET /api/projects/:repo/:slug/dialogues[?wp=WP-001]
    { method: 'GET', path: /^\/api\/projects\/(?<repo>[^/]+)\/(?<slug>[^/]+)\/dialogues$/, noBody: true,
      handler: async (_, groups, query) => {
        const repo = decodeURIComponent(groups!.repo!);
        const slug = decodeURIComponent(groups!.slug!);
        assertSafeSlug(repo);
        assertSafeSlug(slug);
        const repoName = await resolveRepoName(ledgerRoot, repo, slug);
        return handleListDialogues(ledgerRoot, slug, query?.get('wp') ?? undefined, repoName);
      } },

    // GET /api/projects/:repo/:slug/dialogues/:filename
    { method: 'GET', path: /^\/api\/projects\/(?<repo>[^/]+)\/(?<slug>[^/]+)\/dialogues\/(?<filename>[^/]+)$/, noBody: true,
      handler: async (_, groups) => {
        const repo = decodeURIComponent(groups!.repo!);
        const slug = decodeURIComponent(groups!.slug!);
        assertSafeSlug(repo);
        assertSafeSlug(slug);
        const repoName = await resolveRepoName(ledgerRoot, repo, slug);
        return handleGetDialogueFile(ledgerRoot, slug, decodeURIComponent(groups!.filename!), repoName);
      } },

    // GET /api/projects/:repo/:slug/chunks[?wp=WP-001]
    { method: 'GET', path: /^\/api\/projects\/(?<repo>[^/]+)\/(?<slug>[^/]+)\/chunks$/, noBody: true,
      handler: async (_, groups, query) => {
        const repo = decodeURIComponent(groups!.repo!);
        const slug = decodeURIComponent(groups!.slug!);
        assertSafeSlug(repo);
        assertSafeSlug(slug);
        const repoName = await resolveRepoName(ledgerRoot, repo, slug);
        return handleListChunks(ledgerRoot, slug, query?.get('wp') ?? undefined, repoName);
      } },

    // GET /api/projects/:repo/:slug/chunks/:filename/rendered[?format=structured]
    // Must appear BEFORE /:repo/:slug/chunks/:filename — same prefix, more specific suffix.
    { method: 'GET', path: /^\/api\/projects\/(?<repo>[^/]+)\/(?<slug>[^/]+)\/chunks\/(?<filename>[^/]+)\/rendered$/, noBody: true,
      handler: async (_, groups, query) => {
        const repo = decodeURIComponent(groups!.repo!);
        const slug = decodeURIComponent(groups!.slug!);
        assertSafeSlug(repo);
        assertSafeSlug(slug);
        const repoName = await resolveRepoName(ledgerRoot, repo, slug);
        const filename = decodeURIComponent(groups!.filename!);
        if (query?.get('format') === 'structured') {
          return handleGetChunkFile(ledgerRoot, slug, filename, repoName).then(({ content }) => ({
            blocks: renderChunksToStructured(content),
          }));
        }
        return handleGetChunkFile(ledgerRoot, slug, filename, repoName).then(({ content }) => ({
          content: renderChunksToDialogue(content),
        }));
      } },

    // GET /api/projects/:repo/:slug/chunks/:filename
    { method: 'GET', path: /^\/api\/projects\/(?<repo>[^/]+)\/(?<slug>[^/]+)\/chunks\/(?<filename>[^/]+)$/, noBody: true,
      handler: async (_, groups) => {
        const repo = decodeURIComponent(groups!.repo!);
        const slug = decodeURIComponent(groups!.slug!);
        assertSafeSlug(repo);
        assertSafeSlug(slug);
        const repoName = await resolveRepoName(ledgerRoot, repo, slug);
        return handleGetChunkFile(ledgerRoot, slug, decodeURIComponent(groups!.filename!), repoName);
      } },

    // GET /api/projects/:repo/:slug/runs
    { method: 'GET', path: /^\/api\/projects\/(?<repo>[^/]+)\/(?<slug>[^/]+)\/runs$/, noBody: true,
      handler: async (_, groups) => {
        const repo = decodeURIComponent(groups!.repo!);
        const slug = decodeURIComponent(groups!.slug!);
        // Explicit SAFE_SLUG_REGEX guard before any path construction — makes the
        // path-traversal defence direct rather than relying on the indirect
        // resolveRepoName NOT_FOUND guard (defence-in-depth per Security Auditor).
        if (!SAFE_SLUG_REGEX.test(repo) || !SAFE_SLUG_REGEX.test(slug)) {
          throw new ApiError('NOT_FOUND', 'Invalid repo or slug parameter.');
        }
        // logsDir uses the URL segments to locate the directory. Unlike other namespaced
        // routes, we do NOT call resolveRepoName here — log files must be readable for
        // active runs whose project ledger hasn't been initialised yet (no .meta.json).
        // In multi-store mode, resolve the correct store path via the repo registry.
        let storePathForLogs = ledgerRoot;
        if (isStoreContextInitialized() && getStoreRouter().isMultiStoreMode()) {
          const storeRef = await getStoreRouter().resolveStoreForRepo(repo);
          if (storeRef !== null) storePathForLogs = storeRef.storePath;
        }
        const logsDir = join(storePathForLogs, repo, slug, 'orchestrator', 'logs');
        return handleListRunLogs(slug, repo, logsDir, orchestratorLogsDir);
      } },

    // GET /api/projects/:repo/:slug/runs/:filename[?after=N]
    { method: 'GET', path: /^\/api\/projects\/(?<repo>[^/]+)\/(?<slug>[^/]+)\/runs\/(?<filename>[^/]+)$/, noBody: true,
      handler: async (_, groups, query) => {
        const repo = decodeURIComponent(groups!.repo!);
        const slug = decodeURIComponent(groups!.slug!);
        const filename = decodeURIComponent(groups!.filename!);
        // Explicit SAFE_SLUG_REGEX guard before any path construction (defence-in-depth).
        if (!SAFE_SLUG_REGEX.test(repo) || !SAFE_SLUG_REGEX.test(slug)) {
          throw new ApiError('NOT_FOUND', 'Invalid repo or slug parameter.');
        }
        const afterParam = query?.get('after');
        const afterParsed = afterParam != null ? parseInt(afterParam, 10) : NaN;
        const afterLine = !isNaN(afterParsed) ? afterParsed : undefined;
        // logsDir uses the URL segments — do NOT call resolveRepoName here (see runs list note).
        // In multi-store mode, resolve the correct store path via the repo registry.
        let storePathForLogs = ledgerRoot;
        if (isStoreContextInitialized() && getStoreRouter().isMultiStoreMode()) {
          const storeRef = await getStoreRouter().resolveStoreForRepo(repo);
          if (storeRef !== null) storePathForLogs = storeRef.storePath;
        }
        const logsDir = join(storePathForLogs, repo, slug, 'orchestrator', 'logs');
        return handleGetRunLog(slug, repo, filename, logsDir, orchestratorLogsDir, afterLine);
      } },

    // POST /api/projects/:repo/:slug/archive
    { method: 'POST', path: /^\/api\/projects\/(?<repo>[^/]+)\/(?<slug>[^/]+)\/archive$/, noBody: true,
      handler: async (_, groups) => {
        const repo = decodeURIComponent(groups!.repo!);
        const slug = decodeURIComponent(groups!.slug!);
        assertSafeSlug(repo);
        assertSafeSlug(slug);
        const repoName = await resolveRepoName(ledgerRoot, repo, slug);
        return handleArchiveProject(ledgerRoot, slug, repoName);
      } },

    // POST /api/projects/:repo/:slug/unarchive
    { method: 'POST', path: /^\/api\/projects\/(?<repo>[^/]+)\/(?<slug>[^/]+)\/unarchive$/, noBody: true,
      handler: async (_, groups) => {
        const repo = decodeURIComponent(groups!.repo!);
        const slug = decodeURIComponent(groups!.slug!);
        assertSafeSlug(repo);
        assertSafeSlug(slug);
        const repoName = await resolveRepoName(ledgerRoot, repo, slug);
        return handleUnarchiveProject(ledgerRoot, slug, repoName);
      } },

    // POST /api/projects/:repo/:slug/complete
    { method: 'POST', path: /^\/api\/projects\/(?<repo>[^/]+)\/(?<slug>[^/]+)\/complete$/, noBody: true,
      handler: async (_, groups) => {
        const repo = decodeURIComponent(groups!.repo!);
        const slug = decodeURIComponent(groups!.slug!);
        assertSafeSlug(repo);
        assertSafeSlug(slug);
        const repoName = await resolveRepoName(ledgerRoot, repo, slug);
        return handleMarkProjectComplete(ledgerRoot, slug, repoName);
      } },

    // --- Deprecated non-namespaced /:slug keyword routes ---
    // Retained for backward compatibility. Each is adjacent to its active analogue
    // above for easy comparison. These MUST remain in Section B (before catch-alls).

    // @deprecated — Use GET /api/projects/:repo/:slug/plan instead.
    // GET /api/projects/:slug/plan
    { method: 'GET', path: /^\/api\/projects\/(?<slug>[^/]+)\/plan$/, noBody: true,
      handler: async (_, groups) =>
        handleGetPlanDocument(ledgerRoot, decodeURIComponent(groups!.slug!)) },

    // @deprecated — Use GET /api/projects/:repo/:slug/synthesis instead.
    // GET /api/projects/:slug/synthesis
    { method: 'GET', path: /^\/api\/projects\/(?<slug>[^/]+)\/synthesis$/, noBody: true,
      handler: async (_, groups) =>
        handleGetSynthesisDocument(ledgerRoot, decodeURIComponent(groups!.slug!)) },

    // @deprecated — Use GET /api/projects/:repo/:slug/health instead.
    // GET /api/projects/:slug/health
    { method: 'GET', path: /^\/api\/projects\/(?<slug>[^/]+)\/health$/, noBody: true,
      handler: async (_, groups) =>
        handleGetProjectHealth(ledgerRoot, decodeURIComponent(groups!.slug!)) },

    // @deprecated — Use GET /api/projects/:repo/:slug/run-metadata instead.
    // GET /api/projects/:slug/run-metadata
    { method: 'GET', path: /^\/api\/projects\/(?<slug>[^/]+)\/run-metadata$/, noBody: true,
      handler: async (_, groups) =>
        handleGetRunMetadata(ledgerRoot, decodeURIComponent(groups!.slug!)) },

    // @deprecated — Use GET /api/projects/:repo/:slug/work-packages instead.
    // GET /api/projects/:slug/work-packages
    { method: 'GET', path: /^\/api\/projects\/(?<slug>[^/]+)\/work-packages$/, noBody: true,
      handler: async (_, groups) =>
        handleListWorkPackages(ledgerRoot, decodeURIComponent(groups!.slug!)) },

    // @deprecated — Use GET /api/projects/:repo/:slug/work-packages/overview instead.
    // GET /api/projects/:slug/work-packages/overview
    // Must appear BEFORE /:slug/work-packages/:wpId — same prefix, more specific suffix.
    { method: 'GET', path: /^\/api\/projects\/(?<slug>[^/]+)\/work-packages\/overview$/, noBody: true,
      handler: async (_, groups) =>
        handleGetWorkPackageOverview(ledgerRoot, decodeURIComponent(groups!.slug!)) },

    // @deprecated — Use GET /api/projects/:repo/:slug/work-packages/:wpId instead.
    // GET /api/projects/:slug/work-packages/:wpId
    { method: 'GET', path: /^\/api\/projects\/(?<slug>[^/]+)\/work-packages\/(?<wpId>[^/]+)$/, noBody: true,
      handler: async (_, groups) =>
        handleGetWorkPackage(ledgerRoot, decodeURIComponent(groups!.slug!), groups!.wpId!) },

    // @deprecated — Use GET /api/projects/:repo/:slug/dialogues instead.
    // GET /api/projects/:slug/dialogues[?wp=WP-001]
    { method: 'GET', path: /^\/api\/projects\/(?<slug>[^/]+)\/dialogues$/, noBody: true,
      handler: async (_, groups, query) =>
        handleListDialogues(ledgerRoot, decodeURIComponent(groups!.slug!), query?.get('wp') ?? undefined) },

    // @deprecated — Use GET /api/projects/:repo/:slug/dialogues/:filename instead.
    // GET /api/projects/:slug/dialogues/:filename
    { method: 'GET', path: /^\/api\/projects\/(?<slug>[^/]+)\/dialogues\/(?<filename>[^/]+)$/, noBody: true,
      handler: async (_, groups) =>
        handleGetDialogueFile(ledgerRoot, decodeURIComponent(groups!.slug!), decodeURIComponent(groups!.filename!)) },

    // @deprecated — Use GET /api/projects/:repo/:slug/chunks instead.
    // GET /api/projects/:slug/chunks[?wp=WP-001]
    { method: 'GET', path: /^\/api\/projects\/(?<slug>[^/]+)\/chunks$/, noBody: true,
      handler: async (_, groups, query) =>
        handleListChunks(ledgerRoot, decodeURIComponent(groups!.slug!), query?.get('wp') ?? undefined) },

    // @deprecated — Use GET /api/projects/:repo/:slug/chunks/:filename/rendered instead.
    // GET /api/projects/:slug/chunks/:filename/rendered[?format=structured]
    // Must appear BEFORE /:slug/chunks/:filename — same prefix, more specific suffix.
    { method: 'GET', path: /^\/api\/projects\/(?<slug>[^/]+)\/chunks\/(?<filename>[^/]+)\/rendered$/, noBody: true,
      handler: async (_, groups, query) => {
        const slug = decodeURIComponent(groups!.slug!);
        const filename = decodeURIComponent(groups!.filename!);
        if (query?.get('format') === 'structured') {
          return handleGetChunkFile(ledgerRoot, slug, filename).then(({ content }) => ({
            blocks: renderChunksToStructured(content),
          }));
        }
        return handleGetChunkFile(ledgerRoot, slug, filename).then(({ content }) => ({
          content: renderChunksToDialogue(content),
        }));
      } },

    // @deprecated — Use GET /api/projects/:repo/:slug/chunks/:filename instead.
    // GET /api/projects/:slug/chunks/:filename
    { method: 'GET', path: /^\/api\/projects\/(?<slug>[^/]+)\/chunks\/(?<filename>[^/]+)$/, noBody: true,
      handler: async (_, groups) =>
        handleGetChunkFile(ledgerRoot, decodeURIComponent(groups!.slug!), decodeURIComponent(groups!.filename!)) },

    // @deprecated — Use GET /api/projects/:repo/:slug/runs instead.
    // GET /api/projects/:slug/runs
    // Resolves the canonical namespaced storage directory first to avoid creating
    // ghost directories under the legacy flat path when archiveCompletedLogs runs.
    // Falls back to the legacy flat path for truly pre-namespace projects.
    { method: 'GET', path: /^\/api\/projects\/(?<slug>[^/]+)\/runs$/, noBody: true,
      handler: async (_, groups) => {
        const slug = decodeURIComponent(groups!.slug!);
        const flatProjectDir = join(ledgerRoot, slug);
        let projectStorageDir: string;
        try {
          projectStorageDir = await resolveProjectDir(slug, ledgerRoot);
        } catch {
          projectStorageDir = flatProjectDir;
        }
        const logsDir = join(projectStorageDir, 'orchestrator', 'logs');
        const isNamespaced = projectStorageDir !== flatProjectDir;
        const legacyLogsDir = isNamespaced ? join(flatProjectDir, 'orchestrator', 'logs') : flatProjectDir;
        const legacyLogsDir2 = isNamespaced ? flatProjectDir : undefined;
        return handleListRunLogs(slug, slug, logsDir, orchestratorLogsDir, legacyLogsDir, legacyLogsDir2);
      } },

    // @deprecated — Use GET /api/projects/:repo/:slug/runs/:filename instead.
    // GET /api/projects/:slug/runs/:filename[?after=N]
    // Resolves the canonical namespaced storage directory first (same as the list
    // route above) to avoid creating ghost directories under the legacy flat path.
    { method: 'GET', path: /^\/api\/projects\/(?<slug>[^/]+)\/runs\/(?<filename>[^/]+)$/, noBody: true,
      handler: async (_, groups, query) => {
        const slug = decodeURIComponent(groups!.slug!);
        const filename = decodeURIComponent(groups!.filename!);
        const afterParam = query?.get('after');
        const afterParsed = afterParam != null ? parseInt(afterParam, 10) : NaN;
        const afterLine = !isNaN(afterParsed) ? afterParsed : undefined;
        const flatProjectDir = join(ledgerRoot, slug);
        let projectStorageDir: string;
        try {
          projectStorageDir = await resolveProjectDir(slug, ledgerRoot);
        } catch {
          projectStorageDir = flatProjectDir;
        }
        const logsDir = join(projectStorageDir, 'orchestrator', 'logs');
        return handleGetRunLog(slug, slug, filename, logsDir, orchestratorLogsDir, afterLine);
      } },

    // @deprecated — Use DELETE /api/projects/:repo/:slug instead.
    // DELETE /api/projects/:slug
    { method: 'DELETE', path: /^\/api\/projects\/(?<slug>[^/]+)$/, noBody: true,
      handler: async (_, groups) =>
        handleDeleteProject(ledgerRoot, decodeURIComponent(groups!.slug!)) },

    // @deprecated — Use POST /api/projects/:repo/:slug/archive instead.
    // POST /api/projects/:slug/archive
    { method: 'POST', path: /^\/api\/projects\/(?<slug>[^/]+)\/archive$/, noBody: true,
      handler: async (_, groups) =>
        handleArchiveProject(ledgerRoot, decodeURIComponent(groups!.slug!)) },

    // @deprecated — Use POST /api/projects/:repo/:slug/unarchive instead.
    // POST /api/projects/:slug/unarchive
    { method: 'POST', path: /^\/api\/projects\/(?<slug>[^/]+)\/unarchive$/, noBody: true,
      handler: async (_, groups) =>
        handleUnarchiveProject(ledgerRoot, decodeURIComponent(groups!.slug!)) },

    // @deprecated — Use POST /api/projects/:repo/:slug/complete instead.
    // POST /api/projects/:slug/complete
    { method: 'POST', path: /^\/api\/projects\/(?<slug>[^/]+)\/complete$/, noBody: true,
      handler: async (_, groups) =>
        handleMarkProjectComplete(ledgerRoot, decodeURIComponent(groups!.slug!)) },

    // =========================================================================
    // Section C — Catch-all body-free routes
    //
    // ⚠️  These MUST be declared after Section B (see ordering note in JSDoc).
    //     The namespaced GET /:repo/:slug catch-all would shadow all deprecated
    //     /:slug/keyword routes at the same segment count if placed before them.
    // =========================================================================

    // DELETE /api/projects/:repo/:slug (namespaced)
    { method: 'DELETE', path: /^\/api\/projects\/(?<repo>[^/]+)\/(?<slug>[^/]+)$/, noBody: true,
      handler: async (_, groups) => {
        const repo = decodeURIComponent(groups!.repo!);
        const slug = decodeURIComponent(groups!.slug!);
        assertSafeSlug(repo);
        assertSafeSlug(slug);
        const repoName = await resolveRepoName(ledgerRoot, repo, slug);
        return handleDeleteProject(ledgerRoot, slug, repoName);
      } },

    // GET /api/projects/:repo/:slug (namespaced, catch-all)
    { method: 'GET', path: /^\/api\/projects\/(?<repo>[^/]+)\/(?<slug>[^/]+)$/, noBody: true,
      handler: async (_, groups) => {
        const repo = decodeURIComponent(groups!.repo!);
        const slug = decodeURIComponent(groups!.slug!);
        assertSafeSlug(repo);
        assertSafeSlug(slug);
        const repoName = await resolveRepoName(ledgerRoot, repo, slug);
        return handleGetProject(ledgerRoot, slug, repoName);
      } },
  ];
}

/**
 * Builds the declarative route table consumed by {@link dispatchRoute}.
 *
 * All closure variables required by route handlers (`ledgerRoot`, `configPath`,
 * `orchestratorLogsDir`, `bootVersions`) are captured via the domain sub-builder
 * functions. Each sub-builder owns a single domain area and accepts only the
 * closure parameters it needs:
 *
 *   - {@link buildConfigRoutes}      — `PUT/GET /api/config`, `GET /api/server-info`
 *   - {@link buildOrchestratorRoutes} — `/api/orchestrator/*`
 *   - {@link buildRepoRoutes}         — `/api/repos/*`
 *   - {@link buildKnowledgeRoutes}    — `/api/knowledge/*`
 *   - {@link buildModelRoutes}        — `/api/models/*`, `/api/model-assignments/*`, `/api/personas/*`
 *   - {@link buildStoreRoutes}        — `/api/stores/*`
 *   - {@link buildProjectRoutes}      — `/api/projects/*`
 *
 * The composed array preserves the Section A/B/C ordering invariant:
 *
 *   Section A — Body-parsing routes (no `noBody` flag). Sub-builders place their
 *               Section A entries first; buildRoutes spreads them in domain order.
 *
 *   Section B — Keyword-specific body-free routes (`noBody: true`). Routes with
 *               a fixed keyword suffix (e.g. `/plan`, `/archive`) are more specific
 *               than the Section C catch-alls and MUST precede them.
 *
 *   Section C — Catch-all body-free routes. These are placed last by
 *               {@link buildProjectRoutes} and are spread last.
 *
 * ⚠️  ORDERING CONSTRAINT (load-bearing, not cosmetic):
 *     Section B MUST precede Section C across all sub-builders. The dispatcher
 *     walks the table in declaration order and returns on the first match. A
 *     Section C catch-all such as `GET /api/projects/:repo/:slug` would silently
 *     shadow all deprecated Section B keyword routes (`/:slug/plan`,
 *     `/:slug/synthesis`, etc.) if they were declared before them, permanently
 *     breaking backward compatibility with pre-namespace clients.
 */
export function buildRoutes(
  ledgerRoot: string,
  configPath: string,
  orchestratorLogsDir: string,
  bootVersions: WorkspaceVersions | null
): Route[] {
  return [
    ...buildConfigRoutes(configPath, bootVersions),
    ...buildOrchestratorRoutes(ledgerRoot, orchestratorLogsDir),
    ...buildRepoRoutes(ledgerRoot),
    ...buildKnowledgeRoutes(ledgerRoot),
    ...buildModelRoutes(),
    ...buildStoreRoutes(ledgerRoot),
    ...buildProjectRoutes(ledgerRoot, orchestratorLogsDir),
  ];
}

/**
 * Returns the full route table using sentinel dummy arguments, without
 * requiring callers to supply real filesystem paths.
 *
 * Intended for structural tests (e.g. `route-table.test.ts`) that inspect the
 * route table shape — method validity, named-capture-group compliance,
 * duplicate detection — without executing any handlers.
 *
 * Uses `/dev/null` as a safe sentinel for all path arguments and `null` for
 * `bootVersions`. The handlers captured inside each route are closures over
 * these sentinels; as long as no handler is actually invoked the sentinels have
 * no observable effect.
 *
 * @returns The full `Route[]` table, identical in structure to what
 *   {@link handleRequest} uses at runtime.
 */
export function getRouteDescriptors(): Route[] {
  return buildRoutes('/dev/null', '/dev/null', '/dev/null', null);
}

/**
 * Iterates the route table, matches the request, conditionally parses the body,
 * invokes the handler, and writes the response.
 *
 * Parses query parameters from the full `url` (including query string) via
 * {@link parseQueryString} and passes the resulting `URLSearchParams` as the
 * third argument to the matched handler.
 *
 * Returns `true` if a route was matched (caller should return immediately),
 * or `false` if no route matched (caller should fall through).
 */
export async function dispatchRoute(
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  url: string,
  port: number,
  routes: Route[]
): Promise<boolean> {
  const [path] = url.split('?') as [string];
  const query = parseQueryString(url);
  for (const route of routes) {
    if (route.method !== method) continue;
    let groups: Record<string, string> | undefined;
    if (typeof route.path === 'string') {
      if (route.path !== path) continue;
    } else {
      const m = route.path.exec(path);
      if (!m) continue;
      groups = (m.groups ?? {}) as Record<string, string>;
    }
    try {
      const body = route.noBody ? undefined : await readJsonBody(req);
      const result = await route.handler(body, groups, query);
      if (route.statusCode === 204) {
        res.writeHead(204, { ...corsHeaders(port), ...securityHeaders() });
        res.end();
      } else {
        sendJson(res, route.statusCode ?? 200, result, port);
      }
    } catch (err) {
      if (err instanceof PayloadTooLargeError) {
        sendError(res, 413, 'PAYLOAD_TOO_LARGE', 'Payload Too Large.', port);
      } else if (err instanceof ApiError) {
        sendError(res, apiErrorToStatus(err.code), err.code, err.message, port);
      } else {
        process.stderr.write(
          `[server] Unhandled error in ${method} ${path}: ${String(err)}\n`
        );
        sendError(res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred.', port);
      }
    }
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Main request handler
// ---------------------------------------------------------------------------

export async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  ledgerRoot: string,
  configPath: string,
  port: number,
  orchestratorLogsDir: string,
  bootVersions: WorkspaceVersions | null = null
): Promise<void> {
  const method = req.method?.toUpperCase() ?? 'GET';
  const url = req.url ?? '/';
  const [path] = url.split('?') as [string];
  const segments = path.split('/').filter(Boolean);
  const isApiRequest = segments[0] === 'api';

  // OPTIONS preflight
  if (method === 'OPTIONS') {
    res.writeHead(200, { ...corsHeaders(port), ...securityHeaders() });
    res.end();
    return;
  }

  // Static files
  if (!isApiRequest) {
    await serveStatic(req, res, port);
    return;
  }

  // All API traffic is dispatched via the unified declarative route table.
  // dispatchRoute() handles both body-parsing and body-free (noBody: true) routes.
  // If no route matches, fall through to 404.
  if (await dispatchRoute(
    req, res, method, url, port,
    buildRoutes(ledgerRoot, configPath, orchestratorLogsDir, bootVersions)
  )) {
    return;
  }

  sendError(res, 404, 'NOT_FOUND', 'Route not found.', port);
}

// ---------------------------------------------------------------------------
// Server startup
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const port = getPort();
  const ledgerRoot = resolveLedgerRoot();

  // Load multi-store configuration (returns null in single-store / legacy mode).
  // Mirror the same initialization sequence as index.ts.
  const storeConfig = await loadStoresConfig();
  const storeRouter = new StoreRouter(storeConfig);
  const multiStoreManager = new MultiStoreManager(storeRouter);
  setStoreContext(storeRouter, multiStoreManager);

  if (storeConfig !== null) {
    process.stdout.write(
      `[gui-server] Multi-store mode: ${storeConfig.stores.length} store(s) configured.\n`
    );
  } else {
    process.stdout.write('[gui-server] Single-store mode (no stores.json found).\n');
  }

  // Resolve gui-config.json: ~/.ai-insights/gui-config.json in multi-store mode,
  // join(ledgerRoot, 'gui-config.json') in single-store mode.
  const configPath = resolveGuiConfigPath(storeConfig, ledgerRoot);

  // Populate config cache from disk (defaults used if file missing)
  await readConfigFromDisk(configPath);
  startConfigWatcher(configPath);

  const orchestratorLogsDir = ORCHESTRATOR_LOGS_DIR;

  // Capture component versions at server startup. Passed into handleRequest()
  // so that subsequent GET /api/server-info calls can detect stale instances.
  const bootVersions = captureWorkspaceVersions();

  // Start the auto-archive background service. Reads auto_archive_days from
  // config; no-op if the setting is 0.
  startAutoArchiveTimer(ledgerRoot);

  const server = createServer((req, res) => {
    handleRequest(req, res, ledgerRoot, configPath, port, orchestratorLogsDir, bootVersions).catch((err) => {
      process.stderr.write(`[server] Unhandled error: ${String(err)}\n`);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json', ...securityHeaders() });
        res.end(
          JSON.stringify({
            error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' },
          })
        );
      }
    });
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      process.stderr.write(
        `[server] Port ${port} is already in use. Choose a different port with --port <n>. Exiting.\n`
      );
      process.exit(1);
    }
    throw err;
  });

  server.listen(port, () => {
    console.log(`GUI dashboard running at http://localhost:${port}`);
  });
}

// Only run main() when this file is the entry point (e.g. `tsx gui/server.ts`),
// not when it is imported by test code (e.g. to access the exported handleRequest).
const isEntryPoint =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isEntryPoint) {
  main().catch((err) => {
    process.stderr.write(`[server] Fatal startup error: ${String(err)}\n`);
    process.exit(1);
  });
}

```