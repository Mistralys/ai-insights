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
 *   into the target store with a **new numeric ID** assigned by the target store's
 *   `next_id` counter. The original ID is no longer valid after the operation.
 *   Frontend consumers that need to track the moved insight must capture the
 *   pre-operation ID before calling promote/move and match by that ID — not by
 *   the new ID returned in the response.
 */

import { z } from 'zod';
import { ApiError } from '../src/gui/errors.js';
import { KnowledgeStoreManager } from '../src/storage/knowledge-store.js';
import { InsightScope, SLUG_REGEX } from '../src/schema/knowledge.js';
import type { Insight } from '../src/schema/knowledge.js';

// Re-export ApiError so consumers of this module can catch typed errors without
// importing from a separate path.
export { ApiError };

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
    superseded_by: z.number().int().nullable().optional(),
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
 * Parses a raw string as a positive integer insight ID.
 *
 * Rejects:
 * - Non-numeric strings (NaN after Number())
 * - Floating-point strings (any string containing '.', e.g. "1.5", "2.0")
 * - Zero or negative integers
 *
 * The decimal-point check is performed on the raw string before numeric
 * coercion so that "2.0" (which coerces to an integer) is still rejected.
 *
 * @throws ApiError VALIDATION_ERROR for any rejected value.
 */
export function parseKnowledgeId(raw: string): number {
  // Reject strings containing a decimal point before numeric coercion —
  // this catches "1.5" and also "2.0", both of which the caller must treat
  // as non-integer IDs even though Number("2.0") === 2.
  if (raw.includes('.')) {
    throw new ApiError('VALIDATION_ERROR', 'Invalid insight id.');
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new ApiError('VALIDATION_ERROR', 'Invalid insight id.');
  }
  return n;
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
  const manager = new KnowledgeStoreManager(ledgerRoot);

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

  if (params.query && params.query.trim().length > 0) {
    return manager.searchInsights(params.query.trim(), { scope, repository_name, category, tags, limit, offset });
  }

  return manager.listInsights({ scope, category, tags, repository_name, limit, offset });
}

// ---------------------------------------------------------------------------
// PATCH /api/knowledge/:id
// ---------------------------------------------------------------------------

/**
 * Updates an existing knowledge insight identified by its numeric ID.
 *
 * Validates the raw ID string via `parseKnowledgeId` (throws VALIDATION_ERROR
 * for non-integer, zero, or floating-point strings). Validates the request body
 * via `KnowledgeUpdateBodySchema` (throws VALIDATION_ERROR for unknown fields or
 * type mismatches). Extracts `scope` and `repository_name` discriminator fields to
 * scope the update to the correct store.
 *
 * `superseded_by: null` in the body is mapped to `undefined` so the field is
 * cleared (removed) on the stored insight.
 *
 * Throws NOT_FOUND when no insight with the given ID exists in the specified scope.
 *
 * @param ledgerRoot  Absolute path to the central ledger root.
 * @param rawId       Raw ID string from the URL parameter (e.g. "42").
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

  const manager = new KnowledgeStoreManager(ledgerRoot);

  try {
    return await manager.updateInsight(id, updates, { scope, repository_name });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('not found')) {
      throw new ApiError('NOT_FOUND', 'Insight not found.');
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/knowledge/:id
// ---------------------------------------------------------------------------

/**
 * Deletes an existing knowledge insight identified by its numeric ID.
 *
 * Validates the raw ID string via `parseKnowledgeId` (throws VALIDATION_ERROR
 * for non-integer, zero, or floating-point strings). Requires `scope` as a
 * query parameter; when `scope === 'repository'`, `repository_name` is also required
 * (throws VALIDATION_ERROR if absent). Scopes the deletion to the correct store
 * to prevent accidental cross-scope deletion when the same numeric ID exists in
 * multiple stores.
 *
 * Throws NOT_FOUND when no insight with the given ID exists in the specified scope.
 *
 * `repository_name` is validated against `SLUG_REGEX` at this handler level
 * (after the presence check) before being forwarded to the storage layer. A malformed
 * slug throws `VALIDATION_ERROR` (HTTP 400) immediately, consistent with
 * `handleMoveKnowledge` and `handleUpdateKnowledge`.
 *
 * @param ledgerRoot      Absolute path to the central ledger root.
 * @param rawId           Raw ID string from the URL parameter (e.g. "42").
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

  const manager = new KnowledgeStoreManager(ledgerRoot);

  try {
    await manager.deleteInsight(id, { scope: validatedScope, repository_name });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('not found')) {
      throw new ApiError('NOT_FOUND', 'Insight not found.');
    }
    throw err;
  }

  return null;
}

// ---------------------------------------------------------------------------
// POST /api/knowledge/:id/promote
// ---------------------------------------------------------------------------

/**
 * Promotes a repository-scoped insight to global scope using the atomic
 * KnowledgeStoreManager.moveInsight() method.
 *
 * The returned insight is the newly created global-scoped copy — it has a
 * **different numeric ID** than the original (assigned by the global store's
 * `next_id` counter). The frontend must match by pre-promote ID, not the new ID.
 *
 * `repository_name` is validated against `SLUG_REGEX` at this handler level
 * (after the presence check) before being forwarded to the storage layer. A malformed
 * slug throws `VALIDATION_ERROR` (HTTP 400) immediately, consistent with
 * `handleMoveKnowledge` and `handleUpdateKnowledge`.
 *
 * @param ledgerRoot      Absolute path to the central ledger root.
 * @param rawId           Raw ID string from the URL parameter (e.g. "42").
 * @param scope           Source scope — must be "repository" (global insights cannot be promoted).
 * @param repository_name Required when scope is "repository"; the source repository name.
 * @returns The newly created global Insight.
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

  const manager = new KnowledgeStoreManager(ledgerRoot);

  try {
    return await manager.moveInsight(
      id,
      { scope: validatedScope, repository_name },
      'global'
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.toLowerCase().includes('not found')) {
      throw new ApiError('NOT_FOUND', 'Insight not found.');
    }
    throw err;
  }
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
 * The returned insight is the newly created copy — it has a **different numeric
 * ID** (assigned by the target store's `next_id` counter).
 *
 * @param ledgerRoot  Absolute path to the central ledger root.
 * @param rawId       Raw ID string from the URL parameter (e.g. "42").
 * @param body        Parsed request body (validated against KnowledgeMoveBodySchema).
 * @returns The newly created Insight in the target repository store.
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

  const manager = new KnowledgeStoreManager(ledgerRoot);

  try {
    return await manager.moveInsight(
      id,
      { scope: source_scope, repository_name: source_repository_name },
      'repository',
      repository_name
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.toLowerCase().includes('not found')) {
      throw new ApiError('NOT_FOUND', 'Insight not found.');
    }
    throw err;
  }
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
 *     and all persona keys exist in name-mapping.json.
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
    slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
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

  // 2. Validate all persona keys in persona_models are valid persona IDs
  for (const personaKey of Object.keys(data.persona_models)) {
    if (!validPersonaIds.has(personaKey)) {
      validationError(
        `Persona key "${personaKey}" does not exist in name-mapping.json. Valid IDs are: ${[...validPersonaIds].join(', ')}.`
      );
    }
  }

  // 3. Validate all model UUIDs exist in the registry
  const models = await readModels();
  const validModelIds = new Set(models.map((m) => m.id));

  if (data.default_model_uuid !== undefined && !validModelIds.has(data.default_model_uuid)) {
    validationError(
      `default_model_uuid "${data.default_model_uuid}" does not exist in the model registry.`
    );
  }

  for (const [personaKey, uuid] of Object.entries(data.persona_models)) {
    if (!validModelIds.has(uuid)) {
      validationError(
        `Model UUID "${uuid}" assigned to persona "${personaKey}" does not exist in the model registry.`
      );
    }
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
      `old_model_id "${old_model_id}" does not exist in the model registry.`
    );
  }

  if (!validModelIds.has(new_model_id)) {
    validationError(
      `new_model_id "${new_model_id}" does not exist in the model registry.`
    );
  }

  // Load current assignments
  const assignments = await readAssignments();

  // Check that old_model_id is actually referenced
  let referenced = false;
  if (assignments.default_model_uuid === old_model_id) {
    referenced = true;
  }
  for (const uuid of Object.values(assignments.persona_models)) {
    if (uuid === old_model_id) {
      referenced = true;
      break;
    }
  }

  if (!referenced) {
    validationError(
      `Model "${old_model_id}" is not referenced in any current assignment. Nothing to replace.`
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
 *                                      repo's folder_names. Undeclared entries carry declared: false
 *                                      and a synthetic shape (see RepoListItem). Defaults to false,
 *                                      preserving the original endpoint behaviour.
 *   GET    /api/repos/:repoId      — get a single repository entry or 404
 *   POST   /api/repos              — create a new repository entry
 *   PUT    /api/repos/:repoId      — update label, folder_names, and/or vision
 *   DELETE /api/repos/:repoId      — remove the declaration (no project data deleted)
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
import { SLUG_REGEX } from '../src/schema/knowledge.js';
import { LedgerStore } from '../src/storage/ledger-store.js';

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
}

function toListItem(entry: RepositoryEntry): RepoListItem {
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
  const registry = await loadRegistry(ledgerRoot);
  const declared = registry.repositories.map(toListItem);

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
 * @param ledgerRoot - Absolute path to the centralized ledger root directory.
 * @param repoId     - The `id` field of the repository entry to retrieve.
 */
export async function handleGetRepo(
  ledgerRoot: string,
  repoId: string
): Promise<RepositoryEntry> {
  const registry = await loadRegistry(ledgerRoot);
  const entry = registry.repositories.find((e) => e.id === repoId);
  if (!entry) {
    throw new ApiError('NOT_FOUND', `Repository not found: '${repoId}'.`);
  }
  return entry;
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

  const { id, label, folder_names, vision } = parsed.data;
  const registry = await loadRegistry(ledgerRoot);

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

  const updatedRegistry = {
    repositories: [...registry.repositories, newEntry],
  };

  await saveRegistry(ledgerRoot, updatedRegistry);
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
  const registry = await loadRegistry(ledgerRoot);
  const existingIndex = registry.repositories.findIndex((e) => e.id === repoId);
  if (existingIndex === -1) {
    throw new ApiError('NOT_FOUND', `Repository not found: '${repoId}'.`);
  }

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

  await saveRegistry(ledgerRoot, { repositories: updatedRepositories });
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
  const registry = await loadRegistry(ledgerRoot);
  const index = registry.repositories.findIndex((e) => e.id === repoId);
  if (index === -1) {
    throw new ApiError('NOT_FOUND', `Repository not found: '${repoId}'.`);
  }

  const updatedRepositories = registry.repositories.filter((e) => e.id !== repoId);
  await saveRegistry(ledgerRoot, { repositories: updatedRepositories });
  return { deleted: true };
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

import { rm, readFile, readdir } from 'node:fs/promises';
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
import type { IncidentContext, WorkPackageDetail } from '../src/schema/work-package.js';

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
export { ApiError };
import {
  getQueue,
  killQueueEntry,
  dismissQueueEntry,
  deleteQueueEntry,
  startOrchestrator,
  getRunStatus,
} from './orchestrator-manager.js';
import type { QueueEntry, KillResult, StartResult, RunStatus } from './orchestrator-manager.js';


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

  let storageDir: string;
  try {
    storageDir = await resolveProjectDir(slugOrQualified, ledgerRoot);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Intentionally downgrade AMBIGUOUS to NOT_FOUND: the caller must not learn
    // that multiple repos contain this slug (prevents cross-namespace existence leak).
    if (msg.startsWith('NOT_FOUND') || msg.startsWith('AMBIGUOUS')) {
      notFound(`Project '${slug}' not found.`);
    }
    throw err;
  }

  try {
    const raw = await readFile(join(storageDir, '.meta.json'), 'utf-8');
    const meta = ProjectMetaSchema.parse(JSON.parse(raw));
    return new LedgerStore(meta.plan_path, ledgerRoot);
  } catch (err) {
    // .meta.json missing, corrupt JSON, or schema validation failure —
    // log for operator diagnostics (stderr only) and return 404 to the caller.
    const errMsg = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `[resolveProjectStore] Failed to read metadata for slug="${slug}"` +
        (repoName !== undefined ? ` repo="${repoName}"` : '') +
        `: ${errMsg}\n`
    );
    notFound(`Project '${slug}' not found or has no metadata.`);
  }
}

// ---------------------------------------------------------------------------
// GET /api/insights
// ---------------------------------------------------------------------------

export interface InsightEntry {
  project_slug: string;
  project_status: ProjectStatus;
  repository_name: string | null;
  type: string;
  priority: 'low' | 'medium' | 'high';
  timestamp: string;
  agent: string;
  note: string;
  context?: IncidentContext;
}

/**
 * Aggregates all project_comments from every project ledger into a single
 * flat array, sorted by timestamp descending (newest first).
 * Per-project read failures are logged to stderr and skipped gracefully.
 * Returns an empty array when no projects exist or no comments are found.
 */
export async function handleGetInsights(ledgerRoot: string): Promise<InsightEntry[]> {
  const projects = await LedgerStore.listAllProjects(ledgerRoot);

  const entries: InsightEntry[] = [];

  await Promise.all(
    projects.map(async (meta) => {
      const store = new LedgerStore(meta.plan_path, ledgerRoot);
      let rootIndex;
      try {
        rootIndex = await store.readRootIndex();
      } catch (err) {
        process.stderr.write(
          `[handleGetInsights] Skipping project "${meta.slug}": ${String(err)}\n`
        );
        return;
      }

      const comments = rootIndex.project_comments;
      if (!comments || comments.length === 0) return;

      const projectRoot = inferProjectRootFromPlanPath(meta.plan_path);
      // NOTE: We intentionally do NOT use deriveRepoName() from ledger-root.ts here.
      // deriveRepoName() lowercases and validates the segment against SLUG_REGEX — that is
      // correct for storage keys (e.g. namespaced folder names) but wrong for display fields
      // like repository_name on InsightEntry and ProjectSummary, where original casing must
      // be preserved. Both call sites (handleGetInsights and handleListProjects) use this
      // inline pattern deliberately; keep them in sync if the derivation logic ever changes.
      const repository_name: string | null = projectRoot
        ? (projectRoot.split(/[\\/]/).filter(Boolean).pop() ?? null)
        : null;

      for (const comment of comments) {
        entries.push({
          ...comment,
          project_slug: meta.slug,
          project_status: meta.status,
          repository_name,
        });
      }
    })
  );

  // Sort by timestamp descending (newest first)
  entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  return entries;
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

  const allProjects = await LedgerStore.listAllProjects(ledgerRoot);

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
        const store = new LedgerStore(meta.plan_path, ledgerRoot);

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
      // like repository_name on ProjectSummary and InsightEntry, where original casing must
      // be preserved. Both call sites (handleListProjects and handleGetInsights) use this
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
  for (const p of searchFiltered) {
    status_counts[p.status] = (status_counts[p.status] ?? 0) + 1;
    const r = p.runner ?? 'unknown';
    runner_counts[r] = (runner_counts[r] ?? 0) + 1;
  }

  // --- Step 4a: Status filter ---
  const statusFiltered =
    statusFilter === 'ALL'
      ? searchFiltered
      : statusFilter === 'ACTIVE'
        ? searchFiltered.filter((p) => p.status !== 'ARCHIVED')
        : searchFiltered.filter((p) => p.status === statusFilter);

  // --- Step 4b: Runner filter (applied after status filter; unrecognized values return empty set) ---
  const filtered =
    runnerFilter !== undefined
      ? statusFiltered.filter((p) => (p.runner ?? 'unknown') === runnerFilter)
      : statusFiltered;

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
    const updatedAt = meta.last_updated ? new Date(meta.last_updated).getTime() : NaN;
    const project_elapsed_ms = (!isNaN(createdAt) && !isNaN(updatedAt)) ? updatedAt - createdAt : null;

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
// POST /api/orchestrator/start
// ---------------------------------------------------------------------------

/**
 * Validates `body.planPath`, then runs preflight checks and (when `dryRun`
 * is `false` and all checks pass) spawns a detached orchestrator process.
 *
 * Throws VALIDATION_ERROR when `body.planPath` is absent or not a string.
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
  const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  let resumeThreadId: string | undefined;
  if ('resumeThreadId' in b) {
    if (typeof b['resumeThreadId'] !== 'string' || !UUID_V4.test(b['resumeThreadId'])) {
      validationError('body.resumeThreadId must be a valid UUID v4 string.');
    }
    resumeThreadId = b['resumeThreadId'];
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
 * and exposes two pure renderers:
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
// Public API — structured renderer
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
  handleGetInsights,
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

type RouteHandler = () => Promise<unknown>;

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
  const metaPath = join(ledgerRoot, repoUrlParam, slugUrlParam, '.meta.json');
  let raw: string;
  try {
    raw = await readFile(metaPath, 'utf-8');
  } catch {
    throw new ApiError('NOT_FOUND', `Project not found: ${slugUrlParam}`);
  }
  try {
    const meta = JSON.parse(raw) as { repository_name?: string | null };
    return meta.repository_name ?? repoUrlParam;
  } catch {
    // Malformed .meta.json — project directory exists, fall back to URL param.
    // Log to stderr so operators can detect corrupt meta files during troubleshooting.
    process.stderr.write(`[server] Warning: malformed .meta.json at ${metaPath} — falling back to URL param '${repoUrlParam}'\n`);
    return repoUrlParam;
  }
}

/**
 * Extracts query-string parameters from a full URL string.
 * Returns a URLSearchParams instance (empty if no query string present).
 */
function parseQueryString(url: string): URLSearchParams {
  const qIdx = url.indexOf('?');
  return new URLSearchParams(qIdx !== -1 ? url.slice(qIdx + 1) : '');
}

/**
 * Matches a method + URL path to an API handler.
 * Returns a handler thunk or null if no route matches.
 *
 * Exported for testing purposes.
 */
export function matchRoute(
  method: string,
  url: string,
  ledgerRoot: string,
  orchestratorLogsDir: string
): RouteHandler | null {
  const [path] = url.split('?') as [string];
  const segments = path.split('/').filter(Boolean);

  // All API routes must start with 'api'
  if (segments[0] !== 'api') return null;

  const rest = segments.slice(1);

  // Route dispatch note:
  // Routes are matched by segment count (rest.length) first, then by segment values.
  // Because the dispatcher walks the if-else chain in declaration order, two routes
  // that share the same rest.length value are ordered by their position here — the
  // first matching branch wins and subsequent branches at the same length are shadowed.
  // When adding a new route with the same rest.length as an existing one (e.g. a future
  // /:slug/synthesis at length 3 alongside /:slug/plan), make sure the more-specific
  // pattern appears BEFORE the catch-all pattern at that length, or it will never match.

  // GET /api/insights
  if (method === 'GET' && rest.length === 1 && rest[0] === 'insights') {
    return () => handleGetInsights(ledgerRoot);
  }

  // GET /api/orchestrator/queue
  if (method === 'GET' && rest.length === 2 && rest[0] === 'orchestrator' && rest[1] === 'queue') {
    return () => handleGetOrchestratorQueue(orchestratorLogsDir, ledgerRoot);
  }

  // GET /api/orchestrator/run-status/:filename
  if (method === 'GET' && rest.length === 3 && rest[0] === 'orchestrator' && rest[1] === 'run-status') {
    const filename = decodeURIComponent(rest[2]!);
    return () => handleGetRunStatus(orchestratorLogsDir, filename);
  }

  // GET /api/projects
  if (method === 'GET' && rest.length === 1 && rest[0] === 'projects') {
    const sp = parseQueryString(url);
    const params = {
      page: sp.get('page') ?? undefined,
      limit: sp.get('limit') ?? undefined,
      status: sp.get('status') ?? undefined,
      search: sp.get('search') ?? undefined,
      sort: sp.get('sort') ?? undefined,
      dir: sp.get('dir') ?? undefined,
      runner: sp.get('runner') ?? undefined,
    };
    return () => handleListProjects(ledgerRoot, params);
  }

  // @deprecated — Use GET /api/projects/:repo/:slug/plan instead.
  // This non-namespaced route is retained for backward compatibility and will be
  // removed in the next major version.
  // GET /api/projects/:slug/plan
  if (
    method === 'GET' &&
    rest.length === 3 &&
    rest[0] === 'projects' &&
    rest[2] === 'plan'
  ) {
    const slug = rest[1]!;
    return () => handleGetPlanDocument(ledgerRoot, slug);
  }

  // @deprecated — Use GET /api/projects/:repo/:slug/synthesis instead.
  // This non-namespaced route is retained for backward compatibility and will be
  // removed in the next major version.
  // GET /api/projects/:slug/synthesis
  if (
    method === 'GET' &&
    rest.length === 3 &&
    rest[0] === 'projects' &&
    rest[2] === 'synthesis'
  ) {
    const slug = rest[1]!;
    return () => handleGetSynthesisDocument(ledgerRoot, slug);
  }

  // @deprecated — Use GET /api/projects/:repo/:slug/health instead.
  // This non-namespaced route is retained for backward compatibility and will be
  // removed in the next major version.
  // GET /api/projects/:slug/health
  if (
    method === 'GET' &&
    rest.length === 3 &&
    rest[0] === 'projects' &&
    rest[2] === 'health'
  ) {
    const slug = rest[1]!;
    return () => handleGetProjectHealth(ledgerRoot, slug);
  }

  // @deprecated — Use GET /api/projects/:repo/:slug/run-metadata instead.
  // This non-namespaced route is retained for backward compatibility and will be
  // removed in the next major version.
  // GET /api/projects/:slug/run-metadata
  if (
    method === 'GET' &&
    rest.length === 3 &&
    rest[0] === 'projects' &&
    rest[2] === 'run-metadata'
  ) {
    const slug = rest[1]!;
    return () => handleGetRunMetadata(ledgerRoot, slug);
  }

  // @deprecated — Use GET /api/projects/:repo/:slug instead.
  // This non-namespaced route is retained for backward compatibility and will be
  // removed in the next major version.
  // GET /api/projects/:slug
  if (method === 'GET' && rest.length === 2 && rest[0] === 'projects') {
    const slug = rest[1]!;
    return () => handleGetProject(ledgerRoot, slug);
  }

  // @deprecated — Use GET /api/projects/:repo/:slug/work-packages instead.
  // This non-namespaced route is retained for backward compatibility and will be
  // removed in the next major version.
  // GET /api/projects/:slug/work-packages
  if (
    method === 'GET' &&
    rest.length === 3 &&
    rest[0] === 'projects' &&
    rest[2] === 'work-packages'
  ) {
    const slug = rest[1]!;
    return () => handleListWorkPackages(ledgerRoot, slug);
  }

  // @deprecated — Use GET /api/projects/:repo/:slug/work-packages/overview instead.
  // This non-namespaced route is retained for backward compatibility and will be
  // removed in the next major version.
  // GET /api/projects/:slug/work-packages/overview
  // IMPORTANT: this route has rest.length === 4 and must appear BEFORE the
  // generic /:wpId handler at the same length, otherwise 'overview' would be
  // treated as a WP ID.
  if (
    method === 'GET' &&
    rest.length === 4 &&
    rest[0] === 'projects' &&
    rest[2] === 'work-packages' &&
    rest[3] === 'overview'
  ) {
    const slug = rest[1]!;
    return () => handleGetWorkPackageOverview(ledgerRoot, slug);
  }

  // @deprecated — Use GET /api/projects/:repo/:slug/dialogues/:filename instead.
  // This non-namespaced route is retained for backward compatibility and will be
  // removed in the next major version.
  // GET /api/projects/:slug/dialogues/:filename
  // rest.length === 4, rest[2] === 'dialogues' — must appear before the generic
  // work-packages/:wpId handler at the same length.
  if (
    method === 'GET' &&
    rest.length === 4 &&
    rest[0] === 'projects' &&
    rest[2] === 'dialogues'
  ) {
    const slug = rest[1]!;
    const filename = decodeURIComponent(rest[3]!);
    return () => handleGetDialogueFile(ledgerRoot, slug, filename);
  }

  // @deprecated — Use GET /api/projects/:repo/:slug/work-packages/:wpId instead.
  // This non-namespaced route is retained for backward compatibility and will be
  // removed in the next major version.
  // GET /api/projects/:slug/work-packages/:wpId
  if (
    method === 'GET' &&
    rest.length === 4 &&
    rest[0] === 'projects' &&
    rest[2] === 'work-packages'
  ) {
    const slug = rest[1]!;
    const wpId = rest[3]!;
    return () => handleGetWorkPackage(ledgerRoot, slug, wpId);
  }

  // @deprecated — Use GET /api/projects/:repo/:slug/dialogues instead.
  // This non-namespaced route is retained for backward compatibility and will be
  // removed in the next major version.
  // GET /api/projects/:slug/dialogues[?wp=WP-001]
  // rest.length === 3, rest[2] === 'dialogues' — does not shadow other rest[2] routes
  if (
    method === 'GET' &&
    rest.length === 3 &&
    rest[0] === 'projects' &&
    rest[2] === 'dialogues'
  ) {
    const slug = rest[1]!;
    const sp = parseQueryString(url);
    const wpId = sp.get('wp') ?? undefined;
    return () => handleListDialogues(ledgerRoot, slug, wpId);
  }

  // @deprecated — Use GET /api/projects/:repo/:slug/chunks instead.
  // This non-namespaced route is retained for backward compatibility and will be
  // removed in the next major version.
  // GET /api/projects/:slug/chunks
  // rest.length === 3, rest[2] === 'chunks' — analogous to the dialogues list route
  if (
    method === 'GET' &&
    rest.length === 3 &&
    rest[0] === 'projects' &&
    rest[2] === 'chunks'
  ) {
    const slug = rest[1]!;
    const sp = parseQueryString(url);
    const wpId = sp.get('wp') ?? undefined;
    return () => handleListChunks(ledgerRoot, slug, wpId);
  }

  // @deprecated — Use GET /api/projects/:repo/:slug/chunks/:filename/rendered instead.
  // This non-namespaced route is retained for backward compatibility and will be
  // removed in the next major version.
  // GET /api/projects/:slug/chunks/:filename/rendered
  // rest.length === 5, rest[2] === 'chunks', rest[4] === 'rendered'
  // Placement note: this route (rest.length === 5) and the raw-file route below
  // (rest.length === 4) have different segment counts, so there is no ordering
  // requirement between them — the dispatcher can never confuse the two.  This
  // block is placed here (before the length-4 route) solely to keep all three
  // chunk routes visually adjacent and in URL-specificity order.
  if (
    method === 'GET' &&
    rest.length === 5 &&
    rest[0] === 'projects' &&
    rest[2] === 'chunks' &&
    rest[4] === 'rendered'
  ) {
    const slug = rest[1]!;
    const filename = decodeURIComponent(rest[3]!);
    const format = parseQueryString(url).get('format');
    if (format === 'structured') {
      return () =>
        handleGetChunkFile(ledgerRoot, slug, filename).then(({ content }) => ({
          blocks: renderChunksToStructured(content),
        }));
    }
    return () =>
      handleGetChunkFile(ledgerRoot, slug, filename).then(({ content }) => ({
        content: renderChunksToDialogue(content),
      }));
  }

  // @deprecated — Use GET /api/projects/:repo/:slug/chunks/:filename instead.
  // This non-namespaced route is retained for backward compatibility and will be
  // removed in the next major version.
  // GET /api/projects/:slug/chunks/:filename
  // rest.length === 4, rest[2] === 'chunks' — analogous to dialogues/:filename
  if (
    method === 'GET' &&
    rest.length === 4 &&
    rest[0] === 'projects' &&
    rest[2] === 'chunks'
  ) {
    const slug = rest[1]!;
    const filename = decodeURIComponent(rest[3]!);
    return () => handleGetChunkFile(ledgerRoot, slug, filename);
  }

  // ---------------------------------------------------------------------------
  // Namespaced /:repo/:slug routes — added in WP-009.
  // Each route validates repo and slug separately via SAFE_SLUG_REGEX (same
  // enforcement as assertSafeSlug but applied before any handler call, giving
  // explicit path-traversal defence at the routing layer).
  // resolveRepoName() reads .meta.json to obtain the canonical repository_name
  // and also serves as the project-existence check (throws NOT_FOUND when the
  // meta file is absent).
  //
  // Ordering note: all keyword-specific /:slug/xxx routes at rest.length===3
  // appear ABOVE the /:repo/:slug catch-all at the same length. The catch-all
  // uses explicit keyword exclusion to prevent shadowing.
  // ---------------------------------------------------------------------------

  // GET /api/projects/:repo/:slug/plan
  // rest.length === 4, rest[3] === 'plan' — does not conflict with /:slug/keyword (length 3)
  if (
    method === 'GET' &&
    rest.length === 4 &&
    rest[0] === 'projects' &&
    rest[3] === 'plan' &&
    rest[2] !== 'plan' &&
    rest[2] !== 'synthesis' &&
    rest[2] !== 'health' &&
    rest[2] !== 'work-packages' &&
    rest[2] !== 'dialogues' &&
    rest[2] !== 'chunks' &&
    rest[2] !== 'runs'
  ) {
    const repoUrlParam = decodeURIComponent(rest[1]!);
    const slug = decodeURIComponent(rest[2]!);
    return async () => {
      if (!SAFE_SLUG_REGEX.test(repoUrlParam) || !SAFE_SLUG_REGEX.test(slug)) {
        throw new ApiError('NOT_FOUND', 'Invalid repo or slug parameter.');
      }
      const repoName = await resolveRepoName(ledgerRoot, repoUrlParam, slug);
      return handleGetPlanDocument(ledgerRoot, slug, repoName);
    };
  }

  // GET /api/projects/:repo/:slug/synthesis
  // rest.length === 4, rest[3] === 'synthesis'
  if (
    method === 'GET' &&
    rest.length === 4 &&
    rest[0] === 'projects' &&
    rest[3] === 'synthesis' &&
    rest[2] !== 'plan' &&
    rest[2] !== 'synthesis' &&
    rest[2] !== 'health' &&
    rest[2] !== 'work-packages' &&
    rest[2] !== 'dialogues' &&
    rest[2] !== 'chunks' &&
    rest[2] !== 'runs'
  ) {
    const repoUrlParam = decodeURIComponent(rest[1]!);
    const slug = decodeURIComponent(rest[2]!);
    return async () => {
      if (!SAFE_SLUG_REGEX.test(repoUrlParam) || !SAFE_SLUG_REGEX.test(slug)) {
        throw new ApiError('NOT_FOUND', 'Invalid repo or slug parameter.');
      }
      const repoName = await resolveRepoName(ledgerRoot, repoUrlParam, slug);
      return handleGetSynthesisDocument(ledgerRoot, slug, repoName);
    };
  }

  // GET /api/projects/:repo/:slug/health
  // rest.length === 4, rest[3] === 'health'
  if (
    method === 'GET' &&
    rest.length === 4 &&
    rest[0] === 'projects' &&
    rest[3] === 'health' &&
    rest[2] !== 'plan' &&
    rest[2] !== 'synthesis' &&
    rest[2] !== 'health' &&
    rest[2] !== 'work-packages' &&
    rest[2] !== 'dialogues' &&
    rest[2] !== 'chunks' &&
    rest[2] !== 'runs'
  ) {
    const repoUrlParam = decodeURIComponent(rest[1]!);
    const slug = decodeURIComponent(rest[2]!);
    return async () => {
      if (!SAFE_SLUG_REGEX.test(repoUrlParam) || !SAFE_SLUG_REGEX.test(slug)) {
        throw new ApiError('NOT_FOUND', 'Invalid repo or slug parameter.');
      }
      const repoName = await resolveRepoName(ledgerRoot, repoUrlParam, slug);
      return handleGetProjectHealth(ledgerRoot, slug, repoName);
    };
  }

  // GET /api/projects/:repo/:slug/run-metadata
  // rest.length === 4, rest[3] === 'run-metadata'
  if (
    method === 'GET' &&
    rest.length === 4 &&
    rest[0] === 'projects' &&
    rest[3] === 'run-metadata' &&
    rest[2] !== 'plan' &&
    rest[2] !== 'synthesis' &&
    rest[2] !== 'health' &&
    rest[2] !== 'work-packages' &&
    rest[2] !== 'dialogues' &&
    rest[2] !== 'chunks' &&
    rest[2] !== 'runs'
  ) {
    const repoUrlParam = decodeURIComponent(rest[1]!);
    const slug = decodeURIComponent(rest[2]!);
    return async () => {
      if (!SAFE_SLUG_REGEX.test(repoUrlParam) || !SAFE_SLUG_REGEX.test(slug)) {
        throw new ApiError('NOT_FOUND', 'Invalid repo or slug parameter.');
      }
      const repoName = await resolveRepoName(ledgerRoot, repoUrlParam, slug);
      return handleGetRunMetadata(ledgerRoot, slug, repoName);
    };
  }

  // GET /api/projects/:repo/:slug/work-packages
  // rest.length === 4, rest[3] === 'work-packages'
  if (
    method === 'GET' &&
    rest.length === 4 &&
    rest[0] === 'projects' &&
    rest[3] === 'work-packages' &&
    rest[2] !== 'plan' &&
    rest[2] !== 'synthesis' &&
    rest[2] !== 'health' &&
    rest[2] !== 'work-packages' &&
    rest[2] !== 'dialogues' &&
    rest[2] !== 'chunks' &&
    rest[2] !== 'runs'
  ) {
    const repoUrlParam = decodeURIComponent(rest[1]!);
    const slug = decodeURIComponent(rest[2]!);
    return async () => {
      if (!SAFE_SLUG_REGEX.test(repoUrlParam) || !SAFE_SLUG_REGEX.test(slug)) {
        throw new ApiError('NOT_FOUND', 'Invalid repo or slug parameter.');
      }
      const repoName = await resolveRepoName(ledgerRoot, repoUrlParam, slug);
      return handleListWorkPackages(ledgerRoot, slug, repoName);
    };
  }

  // GET /api/projects/:repo/:slug/dialogues[?wp=WP-001]
  // rest.length === 4, rest[3] === 'dialogues'
  if (
    method === 'GET' &&
    rest.length === 4 &&
    rest[0] === 'projects' &&
    rest[3] === 'dialogues' &&
    rest[2] !== 'plan' &&
    rest[2] !== 'synthesis' &&
    rest[2] !== 'health' &&
    rest[2] !== 'work-packages' &&
    rest[2] !== 'dialogues' &&
    rest[2] !== 'chunks' &&
    rest[2] !== 'runs'
  ) {
    const repoUrlParam = decodeURIComponent(rest[1]!);
    const slug = decodeURIComponent(rest[2]!);
    const sp = parseQueryString(url);
    const wpId = sp.get('wp') ?? undefined;
    return async () => {
      if (!SAFE_SLUG_REGEX.test(repoUrlParam) || !SAFE_SLUG_REGEX.test(slug)) {
        throw new ApiError('NOT_FOUND', 'Invalid repo or slug parameter.');
      }
      const repoName = await resolveRepoName(ledgerRoot, repoUrlParam, slug);
      return handleListDialogues(ledgerRoot, slug, wpId, repoName);
    };
  }

  // GET /api/projects/:repo/:slug/chunks[?wp=WP-001]
  // rest.length === 4, rest[3] === 'chunks'
  if (
    method === 'GET' &&
    rest.length === 4 &&
    rest[0] === 'projects' &&
    rest[3] === 'chunks' &&
    rest[2] !== 'plan' &&
    rest[2] !== 'synthesis' &&
    rest[2] !== 'health' &&
    rest[2] !== 'work-packages' &&
    rest[2] !== 'dialogues' &&
    rest[2] !== 'chunks' &&
    rest[2] !== 'runs'
  ) {
    const repoUrlParam = decodeURIComponent(rest[1]!);
    const slug = decodeURIComponent(rest[2]!);
    const sp = parseQueryString(url);
    const wpId = sp.get('wp') ?? undefined;
    return async () => {
      if (!SAFE_SLUG_REGEX.test(repoUrlParam) || !SAFE_SLUG_REGEX.test(slug)) {
        throw new ApiError('NOT_FOUND', 'Invalid repo or slug parameter.');
      }
      const repoName = await resolveRepoName(ledgerRoot, repoUrlParam, slug);
      return handleListChunks(ledgerRoot, slug, wpId, repoName);
    };
  }

  // POST /api/projects/:repo/:slug/archive
  // rest.length === 4, rest[3] === 'archive'
  if (
    method === 'POST' &&
    rest.length === 4 &&
    rest[0] === 'projects' &&
    rest[3] === 'archive' &&
    rest[2] !== 'plan' &&
    rest[2] !== 'synthesis' &&
    rest[2] !== 'health' &&
    rest[2] !== 'work-packages' &&
    rest[2] !== 'dialogues' &&
    rest[2] !== 'chunks' &&
    rest[2] !== 'runs'
  ) {
    const repoUrlParam = decodeURIComponent(rest[1]!);
    const slug = decodeURIComponent(rest[2]!);
    return async () => {
      if (!SAFE_SLUG_REGEX.test(repoUrlParam) || !SAFE_SLUG_REGEX.test(slug)) {
        throw new ApiError('NOT_FOUND', 'Invalid repo or slug parameter.');
      }
      const repoName = await resolveRepoName(ledgerRoot, repoUrlParam, slug);
      return handleArchiveProject(ledgerRoot, slug, repoName);
    };
  }

  // POST /api/projects/:repo/:slug/unarchive
  // rest.length === 4, rest[3] === 'unarchive'
  if (
    method === 'POST' &&
    rest.length === 4 &&
    rest[0] === 'projects' &&
    rest[3] === 'unarchive' &&
    rest[2] !== 'plan' &&
    rest[2] !== 'synthesis' &&
    rest[2] !== 'health' &&
    rest[2] !== 'work-packages' &&
    rest[2] !== 'dialogues' &&
    rest[2] !== 'chunks' &&
    rest[2] !== 'runs'
  ) {
    const repoUrlParam = decodeURIComponent(rest[1]!);
    const slug = decodeURIComponent(rest[2]!);
    return async () => {
      if (!SAFE_SLUG_REGEX.test(repoUrlParam) || !SAFE_SLUG_REGEX.test(slug)) {
        throw new ApiError('NOT_FOUND', 'Invalid repo or slug parameter.');
      }
      const repoName = await resolveRepoName(ledgerRoot, repoUrlParam, slug);
      return handleUnarchiveProject(ledgerRoot, slug, repoName);
    };
  }

  // POST /api/projects/:repo/:slug/complete
  // rest.length === 4, rest[3] === 'complete'
  if (
    method === 'POST' &&
    rest.length === 4 &&
    rest[0] === 'projects' &&
    rest[3] === 'complete' &&
    rest[2] !== 'plan' &&
    rest[2] !== 'synthesis' &&
    rest[2] !== 'health' &&
    rest[2] !== 'work-packages' &&
    rest[2] !== 'dialogues' &&
    rest[2] !== 'chunks' &&
    rest[2] !== 'runs'
  ) {
    const repoUrlParam = decodeURIComponent(rest[1]!);
    const slug = decodeURIComponent(rest[2]!);
    return async () => {
      if (!SAFE_SLUG_REGEX.test(repoUrlParam) || !SAFE_SLUG_REGEX.test(slug)) {
        throw new ApiError('NOT_FOUND', 'Invalid repo or slug parameter.');
      }
      const repoName = await resolveRepoName(ledgerRoot, repoUrlParam, slug);
      return handleMarkProjectComplete(ledgerRoot, slug, repoName);
    };
  }

  // GET /api/projects/:repo/:slug/work-packages/overview
  // rest.length === 5, rest[3] === 'work-packages', rest[4] === 'overview'
  // Must appear BEFORE /:repo/:slug/work-packages/:wpId at the same rest.length.
  if (
    method === 'GET' &&
    rest.length === 5 &&
    rest[0] === 'projects' &&
    rest[3] === 'work-packages' &&
    rest[4] === 'overview' &&
    rest[2] !== 'work-packages'
  ) {
    const repoUrlParam = decodeURIComponent(rest[1]!);
    const slug = decodeURIComponent(rest[2]!);
    return async () => {
      if (!SAFE_SLUG_REGEX.test(repoUrlParam) || !SAFE_SLUG_REGEX.test(slug)) {
        throw new ApiError('NOT_FOUND', 'Invalid repo or slug parameter.');
      }
      const repoName = await resolveRepoName(ledgerRoot, repoUrlParam, slug);
      return handleGetWorkPackageOverview(ledgerRoot, slug, repoName);
    };
  }

  // GET /api/projects/:repo/:slug/dialogues/:filename
  // rest.length === 5, rest[3] === 'dialogues'
  // Must appear BEFORE /:repo/:slug/work-packages/:wpId to keep ordering consistent.
  if (
    method === 'GET' &&
    rest.length === 5 &&
    rest[0] === 'projects' &&
    rest[3] === 'dialogues' &&
    rest[2] !== 'work-packages' &&
    rest[2] !== 'dialogues'
  ) {
    const repoUrlParam = decodeURIComponent(rest[1]!);
    const slug = decodeURIComponent(rest[2]!);
    const filename = decodeURIComponent(rest[4]!);
    return async () => {
      if (!SAFE_SLUG_REGEX.test(repoUrlParam) || !SAFE_SLUG_REGEX.test(slug)) {
        throw new ApiError('NOT_FOUND', 'Invalid repo or slug parameter.');
      }
      const repoName = await resolveRepoName(ledgerRoot, repoUrlParam, slug);
      return handleGetDialogueFile(ledgerRoot, slug, filename, repoName);
    };
  }

  // GET /api/projects/:repo/:slug/work-packages/:wpId
  // rest.length === 5, rest[3] === 'work-packages'
  if (
    method === 'GET' &&
    rest.length === 5 &&
    rest[0] === 'projects' &&
    rest[3] === 'work-packages' &&
    rest[2] !== 'work-packages'
  ) {
    const repoUrlParam = decodeURIComponent(rest[1]!);
    const slug = decodeURIComponent(rest[2]!);
    const wpId = rest[4]!;
    return async () => {
      if (!SAFE_SLUG_REGEX.test(repoUrlParam) || !SAFE_SLUG_REGEX.test(slug)) {
        throw new ApiError('NOT_FOUND', 'Invalid repo or slug parameter.');
      }
      const repoName = await resolveRepoName(ledgerRoot, repoUrlParam, slug);
      return handleGetWorkPackage(ledgerRoot, slug, wpId, repoName);
    };
  }

  // GET /api/projects/:repo/:slug/chunks/:filename/rendered
  // rest.length === 6, rest[3] === 'chunks', rest[5] === 'rendered'
  if (
    method === 'GET' &&
    rest.length === 6 &&
    rest[0] === 'projects' &&
    rest[3] === 'chunks' &&
    rest[5] === 'rendered' &&
    rest[2] !== 'chunks'
  ) {
    const repoUrlParam = decodeURIComponent(rest[1]!);
    const slug = decodeURIComponent(rest[2]!);
    const filename = decodeURIComponent(rest[4]!);
    const format = parseQueryString(url).get('format');
    return async () => {
      if (!SAFE_SLUG_REGEX.test(repoUrlParam) || !SAFE_SLUG_REGEX.test(slug)) {
        throw new ApiError('NOT_FOUND', 'Invalid repo or slug parameter.');
      }
      const repoName = await resolveRepoName(ledgerRoot, repoUrlParam, slug);
      if (format === 'structured') {
        return handleGetChunkFile(ledgerRoot, slug, filename, repoName).then(({ content }) => ({
          blocks: renderChunksToStructured(content),
        }));
      }
      return handleGetChunkFile(ledgerRoot, slug, filename, repoName).then(({ content }) => ({
        content: renderChunksToDialogue(content),
      }));
    };
  }

  // GET /api/projects/:repo/:slug/chunks/:filename
  // rest.length === 5, rest[3] === 'chunks'
  if (
    method === 'GET' &&
    rest.length === 5 &&
    rest[0] === 'projects' &&
    rest[3] === 'chunks' &&
    rest[2] !== 'chunks'
  ) {
    const repoUrlParam = decodeURIComponent(rest[1]!);
    const slug = decodeURIComponent(rest[2]!);
    const filename = decodeURIComponent(rest[4]!);
    return async () => {
      if (!SAFE_SLUG_REGEX.test(repoUrlParam) || !SAFE_SLUG_REGEX.test(slug)) {
        throw new ApiError('NOT_FOUND', 'Invalid repo or slug parameter.');
      }
      const repoName = await resolveRepoName(ledgerRoot, repoUrlParam, slug);
      return handleGetChunkFile(ledgerRoot, slug, filename, repoName);
    };
  }

  // DELETE /api/projects/:repo/:slug
  // rest.length === 3, method === 'DELETE' — no conflict with DELETE /:slug (rest.length === 2)
  if (
    method === 'DELETE' &&
    rest.length === 3 &&
    rest[0] === 'projects' &&
    rest[2] !== 'plan' &&
    rest[2] !== 'synthesis' &&
    rest[2] !== 'health' &&
    rest[2] !== 'work-packages' &&
    rest[2] !== 'dialogues' &&
    rest[2] !== 'chunks' &&
    rest[2] !== 'runs'
  ) {
    const repoUrlParam = decodeURIComponent(rest[1]!);
    const slug = decodeURIComponent(rest[2]!);
    return async () => {
      if (!SAFE_SLUG_REGEX.test(repoUrlParam) || !SAFE_SLUG_REGEX.test(slug)) {
        throw new ApiError('NOT_FOUND', 'Invalid repo or slug parameter.');
      }
      const repoName = await resolveRepoName(ledgerRoot, repoUrlParam, slug);
      return handleDeleteProject(ledgerRoot, slug, repoName);
    };
  }

  // GET /api/projects/:repo/:slug
  // rest.length === 3 — catch-all; must appear AFTER all /:slug/keyword routes at
  // rest.length === 3 and uses explicit keyword exclusion to prevent shadowing them.
  if (
    method === 'GET' &&
    rest.length === 3 &&
    rest[0] === 'projects' &&
    rest[2] !== 'plan' &&
    rest[2] !== 'synthesis' &&
    rest[2] !== 'health' &&
    rest[2] !== 'work-packages' &&
    rest[2] !== 'dialogues' &&
    rest[2] !== 'chunks' &&
    rest[2] !== 'runs' &&
    rest[2] !== 'run-metadata'
  ) {
    const repoUrlParam = decodeURIComponent(rest[1]!);
    const slug = decodeURIComponent(rest[2]!);
    return async () => {
      if (!SAFE_SLUG_REGEX.test(repoUrlParam) || !SAFE_SLUG_REGEX.test(slug)) {
        throw new ApiError('NOT_FOUND', 'Invalid repo or slug parameter.');
      }
      const repoName = await resolveRepoName(ledgerRoot, repoUrlParam, slug);
      return handleGetProject(ledgerRoot, slug, repoName);
    };
  }

  // @deprecated — Use GET /api/projects/:repo/:slug/runs instead.
  // This non-namespaced route is retained for backward compatibility and will be
  // removed in the next major version.
  // GET /api/projects/:slug/runs
  // rest.length === 3, rest[2] === 'runs' — does not shadow work-packages (different rest[2] value)
  // Resolves the canonical namespaced storage directory first to avoid creating
  // ghost directories under the legacy flat path when archiveCompletedLogs runs.
  // Falls back to the legacy flat path for truly pre-namespace projects.
  if (
    method === 'GET' &&
    rest.length === 3 &&
    rest[0] === 'projects' &&
    rest[2] === 'runs'
  ) {
    const slug = decodeURIComponent(rest[1]!);
    return async () => {
      const flatProjectDir = join(ledgerRoot, slug);
      let projectStorageDir: string;
      try {
        projectStorageDir = await resolveProjectDir(slug, ledgerRoot);
      } catch {
        // NOT_FOUND or AMBIGUOUS — fall back to the legacy flat layout.
        projectStorageDir = flatProjectDir;
      }
      const logsDir = join(projectStorageDir, 'orchestrator', 'logs');
      // For namespaced projects, supply the old flat paths as legacy migration
      // sources so logs written under the pre-namespace layout are carried over.
      // For flat projects, preserve the original behaviour (migrate from the root).
      const isNamespaced = projectStorageDir !== flatProjectDir;
      const legacyLogsDir = isNamespaced ? join(flatProjectDir, 'orchestrator', 'logs') : flatProjectDir;
      const legacyLogsDir2 = isNamespaced ? flatProjectDir : undefined;
      return handleListRunLogs(slug, slug, logsDir, orchestratorLogsDir, legacyLogsDir, legacyLogsDir2);
    };
  }

  // GET /api/projects/:repo/:slug/runs
  // rest.length === 4, rest[3] === 'runs' — namespaced route; rest[2] !== 'runs' distinguishes from /:slug/runs/:filename
  if (
    method === 'GET' &&
    rest.length === 4 &&
    rest[0] === 'projects' &&
    rest[3] === 'runs' &&
    rest[2] !== 'runs'
  ) {
    const repoUrlParam = decodeURIComponent(rest[1]!);
    const slug = decodeURIComponent(rest[2]!);
    return async () => {
      // Explicit SAFE_SLUG_REGEX guard before any path construction — makes the
      // path-traversal defence direct rather than relying on the indirect
      // resolveRepoName NOT_FOUND guard (defence-in-depth per Security Auditor).
      if (!SAFE_SLUG_REGEX.test(repoUrlParam) || !SAFE_SLUG_REGEX.test(slug)) {
        throw new ApiError('NOT_FOUND', `Invalid repo or slug parameter.`);
      }
      // logsDir uses the URL segments to locate the directory. Unlike other namespaced
      // routes, we do NOT call resolveRepoName here — log files must be readable for
      // active runs whose project ledger hasn't been initialised yet (no .meta.json).
      // repoUrlParam is already validated by SAFE_SLUG_REGEX above, which satisfies
      // the assertSafeSlug guard inside handleListRunLogs.
      const logsDir = join(ledgerRoot, repoUrlParam, slug, 'orchestrator', 'logs');
      return handleListRunLogs(slug, repoUrlParam, logsDir, orchestratorLogsDir);
    };
  }

  // @deprecated — Use GET /api/projects/:repo/:slug/runs/:filename instead.
  // This non-namespaced route is retained for backward compatibility and will be
  // removed in the next major version.
  // GET /api/projects/:slug/runs/:filename
  // rest.length === 4, rest[2] === 'runs' — does not shadow work-packages/:wpId (different rest[2] value)
  // Resolves the canonical namespaced storage directory first (same as the list
  // route above) to avoid creating ghost directories under the legacy flat path.
  if (
    method === 'GET' &&
    rest.length === 4 &&
    rest[0] === 'projects' &&
    rest[2] === 'runs'
  ) {
    const slug = decodeURIComponent(rest[1]!);
    const filename = decodeURIComponent(rest[3]!);
    const sp = parseQueryString(url);
    const afterParam = sp.get('after');
    const afterLine = afterParam !== null && !isNaN(parseInt(afterParam, 10)) ? parseInt(afterParam, 10) : undefined;
    return async () => {
      const flatProjectDir = join(ledgerRoot, slug);
      let projectStorageDir: string;
      try {
        projectStorageDir = await resolveProjectDir(slug, ledgerRoot);
      } catch {
        projectStorageDir = flatProjectDir;
      }
      const logsDir = join(projectStorageDir, 'orchestrator', 'logs');
      return handleGetRunLog(slug, slug, filename, logsDir, orchestratorLogsDir, afterLine);
    };
  }

  // GET /api/projects/:repo/:slug/runs/:filename
  // rest.length === 5, rest[3] === 'runs' — namespaced route
  if (
    method === 'GET' &&
    rest.length === 5 &&
    rest[0] === 'projects' &&
    rest[3] === 'runs'
  ) {
    const repoUrlParam = decodeURIComponent(rest[1]!);
    const slug = decodeURIComponent(rest[2]!);
    const filename = decodeURIComponent(rest[4]!);
    const sp = parseQueryString(url);
    const afterParam = sp.get('after');
    const afterLine = afterParam !== null && !isNaN(parseInt(afterParam, 10)) ? parseInt(afterParam, 10) : undefined;
    return async () => {
      // Explicit SAFE_SLUG_REGEX guard before any path construction — makes the
      // path-traversal defence direct rather than relying on the indirect
      // resolveRepoName NOT_FOUND guard (defence-in-depth per Security Auditor).
      if (!SAFE_SLUG_REGEX.test(repoUrlParam) || !SAFE_SLUG_REGEX.test(slug)) {
        throw new ApiError('NOT_FOUND', `Invalid repo or slug parameter.`);
      }
      // logsDir uses the URL segments to locate the directory. Unlike other namespaced
      // routes, we do NOT call resolveRepoName here — log files must be readable for
      // active runs whose project ledger hasn't been initialised yet (no .meta.json).
      // repoUrlParam is already validated by SAFE_SLUG_REGEX above, which satisfies
      // the assertSafeSlug guard inside handleGetRunLog.
      const logsDir = join(ledgerRoot, repoUrlParam, slug, 'orchestrator', 'logs');
      return handleGetRunLog(slug, repoUrlParam, filename, logsDir, orchestratorLogsDir, afterLine);
    };
  }

  // @deprecated — Use DELETE /api/projects/:repo/:slug instead.
  // This non-namespaced route is retained for backward compatibility and will be
  // removed in the next major version.
  // DELETE /api/projects/:slug
  if (method === 'DELETE' && rest.length === 2 && rest[0] === 'projects') {
    const slug = rest[1]!;
    return () => handleDeleteProject(ledgerRoot, slug);
  }

  // @deprecated — Use POST /api/projects/:repo/:slug/archive instead.
  // This non-namespaced route is retained for backward compatibility and will be
  // removed in the next major version.
  // POST /api/projects/:slug/archive
  if (
    method === 'POST' &&
    rest.length === 3 &&
    rest[0] === 'projects' &&
    rest[2] === 'archive'
  ) {
    const slug = rest[1]!;
    return () => handleArchiveProject(ledgerRoot, slug);
  }

  // @deprecated — Use POST /api/projects/:repo/:slug/unarchive instead.
  // This non-namespaced route is retained for backward compatibility and will be
  // removed in the next major version.
  // POST /api/projects/:slug/unarchive
  if (
    method === 'POST' &&
    rest.length === 3 &&
    rest[0] === 'projects' &&
    rest[2] === 'unarchive'
  ) {
    const slug = rest[1]!;
    return () => handleUnarchiveProject(ledgerRoot, slug);
  }

  // @deprecated — Use POST /api/projects/:repo/:slug/complete instead.
  // This non-namespaced route is retained for backward compatibility and will be
  // removed in the next major version.
  // POST /api/projects/:slug/complete
  if (
    method === 'POST' &&
    rest.length === 3 &&
    rest[0] === 'projects' &&
    rest[2] === 'complete'
  ) {
    const slug = rest[1]!;
    return () => handleMarkProjectComplete(ledgerRoot, slug);
  }

  // GET /api/config and PUT /api/config are handled before matchRoute() is called
  // (they require configPath which is not passed to this function)

  // POST /api/projects/:slug/reset — handled separately in handleRequest()
  // because it requires body parsing (like PUT /api/config).

  // POST /api/orchestrator/start — handled separately in handleRequest()
  // because it requires body parsing.
  // POST /api/orchestrator/kill/:id and POST /api/orchestrator/dismiss/:id —
  // handled separately in handleRequest() (path-parameter extraction via path.slice).

  // ---------------------------------------------------------------------------
  // Repository Registry routes — added in WP-006.
  // All routes use the unique 'repos' first segment, so they cannot shadow any
  // existing route. POST /api/repos and PUT /api/repos/:repoId are handled as
  // special cases in handleRequest() because they require body parsing.
  // ---------------------------------------------------------------------------

  // GET /api/repos
  // rest.length === 1, rest[0] === 'repos'
  if (method === 'GET' && rest.length === 1 && rest[0] === 'repos') {
    const sp = parseQueryString(url);
    const includeUndeclared = sp.get('include_undeclared') === 'true';
    return () => handleListRepos(ledgerRoot, includeUndeclared);
  }

  // GET /api/repos/:repoId
  // rest.length === 2, rest[0] === 'repos'
  if (method === 'GET' && rest.length === 2 && rest[0] === 'repos') {
    const repoId = decodeURIComponent(rest[1]!);
    return () => handleGetRepo(ledgerRoot, repoId);
  }

  // DELETE /api/repos/:repoId
  // rest.length === 2, rest[0] === 'repos'
  if (method === 'DELETE' && rest.length === 2 && rest[0] === 'repos') {
    const repoId = decodeURIComponent(rest[1]!);
    return () => handleDeleteRepo(ledgerRoot, repoId);
  }

  // ---------------------------------------------------------------------------
  // Knowledge routes — added in WP-009.
  // All three routes use the unique 'knowledge' first segment, so they cannot
  // shadow any existing route. PATCH /api/knowledge/:id and
  // POST /api/knowledge/:id/move are handled as special cases in handleRequest()
  // because they require body parsing.
  // ---------------------------------------------------------------------------

  // GET /api/knowledge
  // rest.length === 1, rest[0] === 'knowledge'
  if (method === 'GET' && rest.length === 1 && rest[0] === 'knowledge') {
    const sp = parseQueryString(url);
    const params = {
      scope: sp.get('scope') ?? undefined,
      category: sp.get('category') ?? undefined,
      tags: sp.get('tags') ?? undefined,
      repository_name: sp.get('repository_name') ?? undefined,
      query: sp.get('query') ?? undefined,
      limit: sp.get('limit') ?? undefined,
      offset: sp.get('offset') ?? undefined,
    };
    return () => handleListKnowledge(ledgerRoot, params);
  }

  // DELETE /api/knowledge/:id
  // rest.length === 2, rest[0] === 'knowledge'
  if (method === 'DELETE' && rest.length === 2 && rest[0] === 'knowledge') {
    const rawId = rest[1]!;
    const sp = parseQueryString(url);
    const scope = sp.get('scope') ?? undefined;
    const repository_name = sp.get('repository_name') ?? undefined;
    return () => handleDeleteKnowledge(ledgerRoot, rawId, scope, repository_name);
  }

  // POST /api/knowledge/:id/promote
  // rest.length === 3, rest[0] === 'knowledge', rest[2] === 'promote'
  if (method === 'POST' && rest.length === 3 && rest[0] === 'knowledge' && rest[2] === 'promote') {
    const rawId = rest[1]!;
    const sp = parseQueryString(url);
    const scope = sp.get('scope') ?? undefined;
    const repository_name = sp.get('repository_name') ?? undefined;
    return () => handlePromoteKnowledge(ledgerRoot, rawId, scope, repository_name);
  }

  // ---------------------------------------------------------------------------
  // Model Registry routes — added in WP-006 (model settings).
  // All routes use the unique 'models', 'model-assignments', and 'personas'
  // first segments, so they cannot shadow any existing route.
  // Body-parsing routes (PUT /api/models, POST /api/models/load-defaults,
  // PUT /api/model-assignments, POST /api/model-assignments/replace,
  // POST /api/personas/rebuild) are handled as special cases in
  // handleRequest() because they require body parsing.
  // ---------------------------------------------------------------------------

  // GET /api/models
  // rest.length === 1, rest[0] === 'models'
  if (method === 'GET' && rest.length === 1 && rest[0] === 'models') {
    return () => handleGetModels();
  }

  // GET /api/model-assignments
  // rest.length === 1, rest[0] === 'model-assignments'
  if (method === 'GET' && rest.length === 1 && rest[0] === 'model-assignments') {
    return () => handleGetAssignments();
  }

  // GET /api/personas
  // rest.length === 1, rest[0] === 'personas'
  if (method === 'GET' && rest.length === 1 && rest[0] === 'personas') {
    return () => handleGetPersonas();
  }

  // No match found — fall through to 404.
  // ---------------------------------------------------------------------------
  // Route map summary
  // Body-free routes are dispatched in matchRoute(); body-parsing routes are
  // handled above in handleRequest() and are noted inline below.
  //
  // ACTIVE ROUTES (namespaced /:repo/:slug — use these going forward):
  //   GET    /api/insights
  //   GET    /api/orchestrator/queue
  //   GET    /api/orchestrator/run-status/:filename
  //   GET    /api/projects[?page&limit&status&search&sort&dir&runner]
  //   GET    /api/projects/:repo/:slug
  //   GET    /api/projects/:repo/:slug/plan
  //   GET    /api/projects/:repo/:slug/synthesis
  //   GET    /api/projects/:repo/:slug/health
  //   GET    /api/projects/:repo/:slug/run-metadata
  //   GET    /api/projects/:repo/:slug/work-packages
  //   GET    /api/projects/:repo/:slug/work-packages/overview
  //   GET    /api/projects/:repo/:slug/work-packages/:wpId
  //   GET    /api/projects/:repo/:slug/dialogues[?wp=WP-001]
  //   GET    /api/projects/:repo/:slug/dialogues/:filename
  //   GET    /api/projects/:repo/:slug/chunks[?wp=WP-001]
  //   GET    /api/projects/:repo/:slug/chunks/:filename
  //   GET    /api/projects/:repo/:slug/chunks/:filename/rendered
  //   GET    /api/projects/:repo/:slug/runs
  //   GET    /api/projects/:repo/:slug/runs/:filename[?after=N]
  //   DELETE /api/projects/:repo/:slug
  //   POST   /api/projects/:repo/:slug/archive
  //   POST   /api/projects/:repo/:slug/unarchive
  //   POST   /api/projects/:repo/:slug/complete
  //   PATCH  /api/projects/:repo/:slug      (body-parsing — handled in handleRequest)
  //   POST   /api/projects/:repo/:slug/reset (body-parsing — handled in handleRequest)
  //   GET    /api/repos
  //   GET    /api/repos/:repoId
  //   DELETE /api/repos/:repoId
  //   POST   /api/repos                     (body-parsing — handled in handleRequest)
  //   PUT    /api/repos/:repoId             (body-parsing — handled in handleRequest)
  //   GET    /api/knowledge[?scope&category&tags&repository_name&query&limit&offset]
  //   DELETE /api/knowledge/:id[?scope&repository_name]
  //   POST   /api/knowledge/:id/promote[?scope&repository_name]
  //   PATCH  /api/knowledge/:id             (body-parsing — handled in handleRequest)
  //   POST   /api/knowledge/:id/move        (body-parsing — handled in handleRequest)
  //   GET    /api/models
  //   PUT    /api/models                    (body-parsing — handled in handleRequest)
  //   POST   /api/models/load-defaults      (body-parsing — handled in handleRequest)
  //   GET    /api/model-assignments
  //   PUT    /api/model-assignments         (body-parsing — handled in handleRequest)
  //   POST   /api/model-assignments/replace (body-parsing — handled in handleRequest)
  //   GET    /api/personas
  //   POST   /api/personas/rebuild          (body-parsing — handled in handleRequest)
  //
  // DEPRECATED ROUTES (non-namespaced /:slug — retained for backward
  // compatibility only; will be removed in the next major version):
  //   GET    /api/projects/:slug                        → /api/projects/:repo/:slug
  //   GET    /api/projects/:slug/plan                   → /api/projects/:repo/:slug/plan
  //   GET    /api/projects/:slug/synthesis              → /api/projects/:repo/:slug/synthesis
  //   GET    /api/projects/:slug/health                 → /api/projects/:repo/:slug/health
  //   GET    /api/projects/:slug/run-metadata           → /api/projects/:repo/:slug/run-metadata
  //   GET    /api/projects/:slug/work-packages          → /api/projects/:repo/:slug/work-packages
  //   GET    /api/projects/:slug/work-packages/overview → /api/projects/:repo/:slug/work-packages/overview
  //   GET    /api/projects/:slug/work-packages/:wpId    → /api/projects/:repo/:slug/work-packages/:wpId
  //   GET    /api/projects/:slug/dialogues              → /api/projects/:repo/:slug/dialogues
  //   GET    /api/projects/:slug/dialogues/:filename    → /api/projects/:repo/:slug/dialogues/:filename
  //   GET    /api/projects/:slug/chunks                 → /api/projects/:repo/:slug/chunks
  //   GET    /api/projects/:slug/chunks/:filename       → /api/projects/:repo/:slug/chunks/:filename
  //   GET    /api/projects/:slug/chunks/:filename/rendered → /api/projects/:repo/:slug/chunks/:filename/rendered
  //   GET    /api/projects/:slug/runs                   → /api/projects/:repo/:slug/runs
  //   GET    /api/projects/:slug/runs/:filename         → /api/projects/:repo/:slug/runs/:filename
  //   DELETE /api/projects/:slug                        → /api/projects/:repo/:slug
  //   POST   /api/projects/:slug/archive                → /api/projects/:repo/:slug/archive
  //   POST   /api/projects/:slug/unarchive              → /api/projects/:repo/:slug/unarchive
  //   POST   /api/projects/:slug/complete               → /api/projects/:repo/:slug/complete
  //   PATCH  /api/projects/:slug   (body-parsing)       → /api/projects/:repo/:slug
  //   POST   /api/projects/:slug/reset (body-parsing)   → /api/projects/:repo/:slug/reset
  // ---------------------------------------------------------------------------

  return null;
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

  // Handle OPTIONS preflight
  if (method === 'OPTIONS') {
    res.writeHead(200, { ...corsHeaders(port), ...securityHeaders() });
    res.end();
    return;
  }

  // Static file serving
  if (!isApiRequest) {
    await serveStatic(req, res, port);
    return;
  }

  // PUT /api/config — special case: requires body parsing
  if (method === 'PUT' && path === '/api/config') {
    try {
      const body = await readJsonBody(req);
      const result = await handleUpdateConfig(configPath, body);
      sendJson(res, 200, result, port);
    } catch (err) {
      if (err instanceof PayloadTooLargeError) {
        sendError(res, 413, 'PAYLOAD_TOO_LARGE', 'Payload Too Large.', port);
      } else if (err instanceof ApiError) {
        sendError(res, apiErrorToStatus(err.code), err.code, err.message, port);
      } else {
        process.stderr.write(`[server] Unhandled error in PUT /api/config: ${String(err)}\n`);
        sendError(res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred.', port);
      }
    }
    return;
  }

  // GET /api/server-info — special case: needs bootVersions closure from main()
  if (method === 'GET' && path === '/api/server-info') {
    try {
      const boot = bootVersions ?? captureWorkspaceVersions();
      const disk = captureWorkspaceVersions();
      const stale =
        boot.mcpServer !== disk.mcpServer ||
        boot.personas !== disk.personas ||
        boot.orchestrator !== disk.orchestrator;
      sendJson(res, 200, { stale, bootVersions: boot, diskVersions: disk }, port);
    } catch (err) {
      process.stderr.write(`[server] Unhandled error in GET /api/server-info: ${String(err)}\n`);
      sendError(res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred.', port);
    }
    return;
  }

  // GET /api/config — special case: needs configPath
  if (method === 'GET' && path === '/api/config') {
    try {
      const result = await handleGetConfig(configPath);
      sendJson(res, 200, result, port);
    } catch (err) {
      if (err instanceof ApiError) {
        sendError(res, apiErrorToStatus(err.code), err.code, err.message, port);
      } else {
        process.stderr.write(`[server] Unhandled error in GET /api/config: ${String(err)}\n`);
        sendError(res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred.', port);
      }
    }
    return;
  }

  // PATCH /api/projects/:slug — special case: requires body parsing
  if (method === 'PATCH' && /^\/api\/projects\/.+$/.test(path)) {
    const rawPath = path.slice('/api/projects/'.length);
    const patchSegs = rawPath.split('/').filter(Boolean);
    try {
      const body = await readJsonBody(req);
      let result: unknown;
      if (patchSegs.length === 2) {
        // Namespaced: PATCH /api/projects/:repo/:slug
        const repoUrlParam = decodeURIComponent(patchSegs[0]!);
        const slug = decodeURIComponent(patchSegs[1]!);
        if (!SAFE_SLUG_REGEX.test(repoUrlParam) || !SAFE_SLUG_REGEX.test(slug)) {
          sendError(res, 404, 'NOT_FOUND', 'Invalid repo or slug parameter.', port);
          return;
        }
        const repoName = await resolveRepoName(ledgerRoot, repoUrlParam, slug);
        result = await handleRenameProject(ledgerRoot, slug, body, repoName);
      } else {
        // @deprecated — Use PATCH /api/projects/:repo/:slug instead.
        // This non-namespaced route is retained for backward compatibility and will be
        // removed in the next major version.
        // Flat: PATCH /api/projects/:slug
        const slug = decodeURIComponent(rawPath);
        result = await handleRenameProject(ledgerRoot, slug, body);
      }
      sendJson(res, 200, result, port);
    } catch (err) {
      if (err instanceof PayloadTooLargeError) {
        sendError(res, 413, 'PAYLOAD_TOO_LARGE', 'Payload Too Large.', port);
      } else if (err instanceof ApiError) {
        sendError(res, apiErrorToStatus(err.code), err.code, err.message, port);
      } else {
        process.stderr.write(`[server] Unhandled error in PATCH /api/projects/...: ${String(err)}\n`);
        sendError(res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred.', port);
      }
    }
    return;
  }

  // POST /api/projects/:slug/reset — special case: requires body parsing
  if (method === 'POST') {
    const postSegments = path.split('/').filter(Boolean);
    // @deprecated — Use POST /api/projects/:repo/:slug/reset instead.
    // This non-namespaced route is retained for backward compatibility and will be
    // removed in the next major version.
    // Flat: POST /api/projects/:slug/reset — postSegments.length === 4
    if (
      postSegments.length === 4 &&
      postSegments[0] === 'api' &&
      postSegments[1] === 'projects' &&
      postSegments[3] === 'reset'
    ) {
      const slug = decodeURIComponent(postSegments[2]!);
      try {
        const body = await readJsonBody(req);
        const result = await handleResetProject(ledgerRoot, slug, body);
        sendJson(res, 200, result, port);
      } catch (err) {
        if (err instanceof PayloadTooLargeError) {
          sendError(res, 413, 'PAYLOAD_TOO_LARGE', 'Payload Too Large.', port);
        } else if (err instanceof ApiError) {
          sendError(res, apiErrorToStatus(err.code), err.code, err.message, port);
        } else {
          process.stderr.write(`[server] Unhandled error in POST /api/projects/:slug/reset: ${String(err)}\n`);
          sendError(res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred.', port);
        }
      }
      return;
    }
    // Namespaced: POST /api/projects/:repo/:slug/reset — postSegments.length === 5
    if (
      postSegments.length === 5 &&
      postSegments[0] === 'api' &&
      postSegments[1] === 'projects' &&
      postSegments[4] === 'reset'
    ) {
      const repoUrlParam = decodeURIComponent(postSegments[2]!);
      const slug = decodeURIComponent(postSegments[3]!);
      try {
        if (!SAFE_SLUG_REGEX.test(repoUrlParam) || !SAFE_SLUG_REGEX.test(slug)) {
          sendError(res, 404, 'NOT_FOUND', 'Invalid repo or slug parameter.', port);
          return;
        }
        const body = await readJsonBody(req);
        const repoName = await resolveRepoName(ledgerRoot, repoUrlParam, slug);
        const result = await handleResetProject(ledgerRoot, slug, body, repoName);
        sendJson(res, 200, result, port);
      } catch (err) {
        if (err instanceof PayloadTooLargeError) {
          sendError(res, 413, 'PAYLOAD_TOO_LARGE', 'Payload Too Large.', port);
        } else if (err instanceof ApiError) {
          sendError(res, apiErrorToStatus(err.code), err.code, err.message, port);
        } else {
          process.stderr.write(`[server] Unhandled error in POST /api/projects/:repo/:slug/reset: ${String(err)}\n`);
          sendError(res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred.', port);
        }
      }
      return;
    }
  }

  // POST /api/orchestrator/start — body parsing required
  if (method === 'POST' && path === '/api/orchestrator/start') {
    try {
      const body = await readJsonBody(req);
      const result = await handleOrchestratorStart(WORKSPACE_ROOT, body);
      sendJson(res, 200, result, port);
    } catch (err) {
      if (err instanceof PayloadTooLargeError) {
        sendError(res, 413, 'PAYLOAD_TOO_LARGE', 'Payload Too Large.', port);
      } else if (err instanceof ApiError) {
        sendError(res, apiErrorToStatus(err.code), err.code, err.message, port);
      } else {
        process.stderr.write(`[server] Unhandled error in POST /api/orchestrator/start: ${String(err)}\n`);
        sendError(res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred.', port);
      }
    }
    return;
  }

  // POST /api/orchestrator/kill/:id
  if (method === 'POST' && path.startsWith('/api/orchestrator/kill/')) {
    const id = decodeURIComponent(path.slice('/api/orchestrator/kill/'.length));
    try {
      const result = await handleOrchestratorKill(id, orchestratorLogsDir, ledgerRoot);
      sendJson(res, 200, result, port);
    } catch (err) {
      if (err instanceof ApiError) {
        sendError(res, apiErrorToStatus(err.code), err.code, err.message, port);
      } else {
        process.stderr.write(`[server] Unhandled error in POST /api/orchestrator/kill/:id: ${String(err)}\n`);
        sendError(res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred.', port);
      }
    }
    return;
  }

  // POST /api/orchestrator/dismiss/:id — responds with 204 No Content
  if (method === 'POST' && path.startsWith('/api/orchestrator/dismiss/')) {
    const id = decodeURIComponent(path.slice('/api/orchestrator/dismiss/'.length));
    try {
      await handleOrchestratorDismiss(id, orchestratorLogsDir, ledgerRoot);
      res.writeHead(204, { ...corsHeaders(port), ...securityHeaders() });
      res.end();
    } catch (err) {
      if (err instanceof ApiError) {
        sendError(res, apiErrorToStatus(err.code), err.code, err.message, port);
      } else {
        process.stderr.write(`[server] Unhandled error in POST /api/orchestrator/dismiss/:id: ${String(err)}\n`);
        sendError(res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred.', port);
      }
    }
    return;
  }

  // POST /api/orchestrator/delete/:id — admin force-remove; responds with 204 No Content
  if (method === 'POST' && path.startsWith('/api/orchestrator/delete/')) {
    const id = decodeURIComponent(path.slice('/api/orchestrator/delete/'.length));
    try {
      await handleOrchestratorDelete(id, orchestratorLogsDir);
      res.writeHead(204, { ...corsHeaders(port), ...securityHeaders() });
      res.end();
    } catch (err) {
      if (err instanceof ApiError) {
        sendError(res, apiErrorToStatus(err.code), err.code, err.message, port);
      } else {
        process.stderr.write(`[server] Unhandled error in POST /api/orchestrator/delete/:id: ${String(err)}\n`);
        sendError(res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred.', port);
      }
    }
    return;
  }

  // POST /api/repos — special case: requires body parsing
  if (method === 'POST' && path === '/api/repos') {
    try {
      const body = await readJsonBody(req);
      const result = await handleCreateRepo(ledgerRoot, body);
      sendJson(res, 201, result, port);
    } catch (err) {
      if (err instanceof PayloadTooLargeError) {
        sendError(res, 413, 'PAYLOAD_TOO_LARGE', 'Payload Too Large.', port);
      } else if (err instanceof ApiError) {
        sendError(res, apiErrorToStatus(err.code), err.code, err.message, port);
      } else {
        process.stderr.write(`[server] Unhandled error in POST /api/repos: ${String(err)}\n`);
        sendError(res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred.', port);
      }
    }
    return;
  }

  // PUT /api/repos/:repoId — special case: requires body parsing
  const repoPutMatch = /^\/api\/repos\/([^/]+)$/.exec(path);
  if (method === 'PUT' && repoPutMatch) {
    const repoId = decodeURIComponent(repoPutMatch[1]!);
    try {
      const body = await readJsonBody(req);
      const result = await handleUpdateRepo(ledgerRoot, repoId, body);
      sendJson(res, 200, result, port);
    } catch (err) {
      if (err instanceof PayloadTooLargeError) {
        sendError(res, 413, 'PAYLOAD_TOO_LARGE', 'Payload Too Large.', port);
      } else if (err instanceof ApiError) {
        sendError(res, apiErrorToStatus(err.code), err.code, err.message, port);
      } else {
        process.stderr.write(`[server] Unhandled error in PUT /api/repos/:repoId: ${String(err)}\n`);
        sendError(res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred.', port);
      }
    }
    return;
  }

  // PATCH /api/knowledge/:id — special case: requires body parsing
  // Regex match on path to extract the numeric ID segment.
  const knowledgePatchMatch = /^\/api\/knowledge\/([^/]+)$/.exec(path);
  if (method === 'PATCH' && knowledgePatchMatch) {
    const rawId = decodeURIComponent(knowledgePatchMatch[1]!);
    try {
      const body = await readJsonBody(req);
      const result = await handleUpdateKnowledge(ledgerRoot, rawId, body);
      sendJson(res, 200, result, port);
    } catch (err) {
      if (err instanceof PayloadTooLargeError) {
        sendError(res, 413, 'PAYLOAD_TOO_LARGE', 'Payload Too Large.', port);
      } else if (err instanceof ApiError) {
        sendError(res, apiErrorToStatus(err.code), err.code, err.message, port);
      } else {
        process.stderr.write(`[server] Unhandled error in PATCH /api/knowledge/:id: ${String(err)}\n`);
        sendError(res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred.', port);
      }
    }
    return;
  }

  // POST /api/knowledge/:id/move — special case: requires body parsing
  // Regex match on path to extract the numeric ID segment.
  const knowledgeMoveMatch = /^\/api\/knowledge\/([^/]+)\/move$/.exec(path);
  if (method === 'POST' && knowledgeMoveMatch) {
    const rawId = decodeURIComponent(knowledgeMoveMatch[1]!);
    try {
      const body = await readJsonBody(req);
      const result = await handleMoveKnowledge(ledgerRoot, rawId, body);
      sendJson(res, 200, result, port);
    } catch (err) {
      if (err instanceof PayloadTooLargeError) {
        sendError(res, 413, 'PAYLOAD_TOO_LARGE', 'Payload Too Large.', port);
      } else if (err instanceof ApiError) {
        sendError(res, apiErrorToStatus(err.code), err.code, err.message, port);
      } else {
        process.stderr.write(`[server] Unhandled error in POST /api/knowledge/:id/move: ${String(err)}\n`);
        sendError(res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred.', port);
      }
    }
    return;
  }

  // PUT /api/models — body-parsing required
  if (method === 'PUT' && path === '/api/models') {
    try {
      const body = await readJsonBody(req);
      const result = await handleSaveModels(body);
      sendJson(res, 200, result, port);
    } catch (err) {
      if (err instanceof PayloadTooLargeError) {
        sendError(res, 413, 'PAYLOAD_TOO_LARGE', 'Payload Too Large.', port);
      } else if (err instanceof ApiError) {
        sendError(res, apiErrorToStatus(err.code), err.code, err.message, port);
      } else {
        process.stderr.write(`[server] Unhandled error in PUT /api/models: ${String(err)}\n`);
        sendError(res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred.', port);
      }
    }
    return;
  }

  // POST /api/models/load-defaults — body-parsing required (empty body accepted)
  if (method === 'POST' && path === '/api/models/load-defaults') {
    try {
      const result = await handleLoadDefaults();
      sendJson(res, 200, result, port);
    } catch (err) {
      if (err instanceof ApiError) {
        sendError(res, apiErrorToStatus(err.code), err.code, err.message, port);
      } else {
        process.stderr.write(`[server] Unhandled error in POST /api/models/load-defaults: ${String(err)}\n`);
        sendError(res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred.', port);
      }
    }
    return;
  }

  // PUT /api/model-assignments — body-parsing required
  if (method === 'PUT' && path === '/api/model-assignments') {
    try {
      const body = await readJsonBody(req);
      const result = await handleUpdateAssignments(body);
      sendJson(res, 200, result, port);
    } catch (err) {
      if (err instanceof PayloadTooLargeError) {
        sendError(res, 413, 'PAYLOAD_TOO_LARGE', 'Payload Too Large.', port);
      } else if (err instanceof ApiError) {
        sendError(res, apiErrorToStatus(err.code), err.code, err.message, port);
      } else {
        process.stderr.write(`[server] Unhandled error in PUT /api/model-assignments: ${String(err)}\n`);
        sendError(res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred.', port);
      }
    }
    return;
  }

  // POST /api/model-assignments/replace — body-parsing required
  if (method === 'POST' && path === '/api/model-assignments/replace') {
    try {
      const body = await readJsonBody(req);
      const result = await handleReplaceAssignedModel(body);
      sendJson(res, 200, result, port);
    } catch (err) {
      if (err instanceof PayloadTooLargeError) {
        sendError(res, 413, 'PAYLOAD_TOO_LARGE', 'Payload Too Large.', port);
      } else if (err instanceof ApiError) {
        sendError(res, apiErrorToStatus(err.code), err.code, err.message, port);
      } else {
        process.stderr.write(`[server] Unhandled error in POST /api/model-assignments/replace: ${String(err)}\n`);
        sendError(res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred.', port);
      }
    }
    return;
  }

  // POST /api/personas/rebuild — body-parsing not required but fits handleRequest() pattern
  if (method === 'POST' && path === '/api/personas/rebuild') {
    try {
      const result = await handleRebuildPersonas(WORKSPACE_ROOT);
      if (result.success) {
        sendJson(res, 200, result, port);
      } else {
        sendError(res, 500, 'BUILD_FAILED', result.output, port);
      }
    } catch (err) {
      if (err instanceof ApiError) {
        sendError(res, apiErrorToStatus(err.code), err.code, err.message, port);
      } else {
        process.stderr.write(`[server] Unhandled error in POST /api/personas/rebuild: ${String(err)}\n`);
        sendError(res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred.', port);
      }
    }
    return;
  }

  // General API route matching
  const handler = matchRoute(method, url, ledgerRoot, orchestratorLogsDir);
  if (!handler) {
    sendError(res, 404, 'NOT_FOUND', 'Route not found.', port);
    return;
  }

  try {
    const result = await handler();
    sendJson(res, 200, result, port);
  } catch (err) {
    if (err instanceof ApiError) {
      sendError(res, apiErrorToStatus(err.code), err.code, err.message, port);
    } else {
      process.stderr.write(`[server] Unhandled error: ${String(err)}\n`);
      sendError(res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred.', port);
    }
  }
}

// ---------------------------------------------------------------------------
// Server startup
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const port = getPort();
  const ledgerRoot = resolveLedgerRoot();
  const configPath = join(ledgerRoot, 'gui-config.json');

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