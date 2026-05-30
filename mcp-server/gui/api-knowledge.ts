/**
 * GUI API Route Handlers — Knowledge Domain
 *
 * All REST handlers, schemas, and helpers for the /api/knowledge/* endpoints.
 * Extracted from gui/api.ts (WP-003) to keep the knowledge domain self-contained
 * and to wire handlePromoteKnowledge / handleMoveKnowledge to the atomic
 * KnowledgeStoreManager.moveInsight() method introduced in WP-002.
 *
 * Error shape:  { code: string, message: string, details?: unknown }
 *   NOT_FOUND        → 404
 *   FORBIDDEN        → 403
 *   VALIDATION_ERROR → 400
 *   (unhandled)      → 500
 *
 * STDIO discipline: this file never writes to process.stdout.
 *
 * @known-limitation Partial repository_name validation in DELETE and promote handlers:
 *   `handleDeleteKnowledge` and `handlePromoteKnowledge` accept `repository_name` as a
 *   raw query-parameter string and do NOT validate it against `PROJECT_SLUG_REGEX` at
 *   the handler level. The storage layer's `_validateSlug()` enforces the regex before
 *   constructing any file path, making path-traversal attacks impossible. However, because
 *   `_validateSlug()` throws a generic `Error` (not an `ApiError`), a malformed slug
 *   propagates to the server's unhandled-error branch and returns HTTP 500 rather than
 *   a semantically correct HTTP 400 `VALIDATION_ERROR`.
 *   Contrast with `handleMoveKnowledge` and `handleUpdateKnowledge`, where `repository_name`
 *   is validated via Zod (`z.string().regex(PROJECT_SLUG_REGEX)`) before reaching the
 *   storage layer. A future hardening pass should add an explicit `PROJECT_SLUG_REGEX`
 *   guard to `handleDeleteKnowledge` and `handlePromoteKnowledge` (mirroring the Zod
 *   pattern used in the move/update handlers) so all five knowledge endpoints return
 *   consistent, well-typed HTTP 400 responses for malformed slug values.
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
import { InsightScope, PROJECT_SLUG_REGEX } from '../src/schema/knowledge.js';
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
    repository_name: z.string().regex(PROJECT_SLUG_REGEX).optional(),
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
 * - `source_repository_name` — optional in the schema (`z.string().regex(PROJECT_SLUG_REGEX).optional()`);
 *                              the conditional-required constraint (required when source_scope is "repository")
 *                              is enforced in handler logic, not here.
 * - `repository_name`        — destination repository name (required; must match PROJECT_SLUG_REGEX)
 *
 * Note: `source_repository_name` is `.optional()` at the Zod layer so that the schema can parse
 * a body that omits it — the handler then checks the combination of `source_scope` and
 * `source_repository_name` and throws VALIDATION_ERROR if the conditional constraint is violated.
 * This is consistent with how other conditional-required fields are handled across this API.
 */
export const KnowledgeMoveBodySchema = z
  .object({
    source_scope: InsightScope,
    source_repository_name: z.string().regex(PROJECT_SLUG_REGEX).optional(),
    repository_name: z.string().regex(PROJECT_SLUG_REGEX),
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
 * - `scope` is validated via `InsightScope.safeParse()`; unrecognised values are silently
 *   treated as "no scope filter" rather than causing an error.
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

  // Validate scope — unrecognised values fall back to undefined (no filter).
  const scopeResult = InsightScope.safeParse(params.scope);
  const scope = scopeResult.success ? scopeResult.data : undefined;

  const category = params.category ?? undefined;
  const repository_name = params.repository_name ?? undefined;

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
 * **Defence-in-depth note:** `repository_name` is accepted as a raw query-parameter
 * string and is NOT validated against `PROJECT_SLUG_REGEX` at this handler level.
 * The storage layer's `_validateSlug()` enforces the regex before constructing any
 * file path, making path-traversal attacks impossible in practice. However, because
 * `_validateSlug()` throws a generic `Error` (not an `ApiError`), a malformed slug
 * will propagate to the server's unhandled-error branch and return HTTP 500 rather
 * than a semantically correct HTTP 400 `VALIDATION_ERROR`. Contrast with
 * `handleMoveKnowledge` and `handleUpdateKnowledge`, where `repository_name` is
 * validated via Zod schema (`z.string().regex(PROJECT_SLUG_REGEX)`) before reaching
 * the storage layer. A future hardening pass should add an explicit regex guard here
 * (mirroring the Zod pattern) to return a proper 400 and remove reliance on the
 * storage layer as the sole validation point for this field.
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
 * **Defence-in-depth note:** `repository_name` is accepted as a raw query-parameter
 * string and is NOT validated against `PROJECT_SLUG_REGEX` at this handler level.
 * The storage layer's `_validateSlug()` enforces the regex before constructing any
 * file path, making path-traversal attacks impossible in practice. However, because
 * `_validateSlug()` throws a generic `Error` (not an `ApiError`), a malformed slug
 * will propagate to the server's unhandled-error branch and return HTTP 500 rather
 * than a semantically correct HTTP 400 `VALIDATION_ERROR`. Contrast with
 * `handleMoveKnowledge` and `handleUpdateKnowledge`, where `repository_name` is
 * validated via Zod schema (`z.string().regex(PROJECT_SLUG_REGEX)`) before reaching
 * the storage layer. A future hardening pass should add an explicit regex guard here
 * (mirroring the Zod pattern) to return a proper 400 and remove reliance on the
 * storage layer as the sole validation point for this field.
 *
 * @param ledgerRoot      Absolute path to the central ledger root.
 * @param rawId           Raw ID string from the URL parameter (e.g. "42").
 * @param scope           Source scope — must be "repository" (global insights cannot be promoted).
 * @param repository_name Required when scope is "repository"; the source repository name.
 * @returns The newly created global Insight.
 * @throws ApiError VALIDATION_ERROR if scope is not "repository", or insight is already global.
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
 *   or the destination name fails PROJECT_SLUG_REGEX.
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
