/**
 * Model Registry Module
 *
 * Manages the file-based model registry and per-persona model assignment system.
 * Registry files live at `{WORKSPACE_ROOT}/personas/model-registry/`:
 *   - `default.json` — shipped default models (tracked in Git)
 *   - `local.json`   — user-registered models (gitignored, auto-created on first use)
 *   - `assignments.json` — per-persona model assignments + default model selection
 *                          (gitignored, auto-created on first use)
 *
 * Design notes:
 *   - `local.json` is the single source of truth for the live model list.
 *   - `default.json` is a seed: it is only consulted during auto-initialization
 *     (first access) and the "Load Defaults" operation.
 *   - Assignment values are stable model UUIDs, not slugs.  Slug renames do not
 *     require cascading into `assignments.json`.
 *   - `getResolvedAssignments()` is the authoritative UUID-to-slug resolver for
 *     API consumers.  The build system and orchestrator resolve locally.
 *
 * STDIO discipline: this module only writes to stderr, never stdout.
 */

import { readFile } from 'fs/promises';
import { join } from 'path';
import { z } from 'zod';
import { WORKSPACE_ROOT } from '../utils/ledger-root.js';
import { atomicWriteJson } from '../storage/atomic-writer.js';
import { ApiError } from './errors.js';

// ---------------------------------------------------------------------------
// Schemas & Types
// ---------------------------------------------------------------------------

export const ModelEntrySchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  cc_model: z.string().min(1).default('inherit'),
});

export type ModelEntry = z.infer<typeof ModelEntrySchema>;

export const ModelRegistrySchema = z.array(ModelEntrySchema);
export type ModelRegistry = z.infer<typeof ModelRegistrySchema>;

export const ModelAssignmentsSchema = z.object({
  default_model_uuid: z.string().uuid().optional(),
  persona_models: z.record(z.string(), z.string().uuid()),
});

export type ModelAssignments = z.infer<typeof ModelAssignmentsSchema>;

/** UUID of the built-in "Inherit / Auto" sentinel entry. */
const INHERIT_SENTINEL_UUID = '00000000-0000-0000-0000-000000000000';

/** Reserved slug that may only appear on the sentinel entry. */
const RESERVED_SLUG = 'inherit';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/**
 * Returns the absolute path to the model registry directory.
 * Equivalent to `{WORKSPACE_ROOT}/personas/model-registry`.
 */
export function getModelRegistryPath(): string {
  return join(WORKSPACE_ROOT, 'personas', 'model-registry');
}

function localJsonPath(): string {
  return join(getModelRegistryPath(), 'local.json');
}

function defaultJsonPath(): string {
  return join(getModelRegistryPath(), 'default.json');
}

function assignmentsJsonPath(): string {
  return join(getModelRegistryPath(), 'assignments.json');
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}

async function readJsonFile(filePath: string): Promise<unknown> {
  const raw = await readFile(filePath, 'utf-8');
  return JSON.parse(raw) as unknown;
}

// ---------------------------------------------------------------------------
// Public API — Model Registry
// ---------------------------------------------------------------------------

/**
 * Reads `local.json`.
 *
 * If `local.json` does not exist, auto-initializes it by copying `default.json`
 * contents, then returns the result.
 *
 * @throws {ApiError} if `default.json` is missing or cannot be parsed during
 *   auto-initialization, or if an existing `local.json` fails schema validation.
 */
export async function readModels(): Promise<ModelEntry[]> {
  let raw: string;
  try {
    raw = await readFile(localJsonPath(), 'utf-8');
  } catch (err) {
    if (isNodeError(err) && err.code === 'ENOENT') {
      return await _initializeLocalFromDefault();
    }
    process.stderr.write(`[server] readModels READ_ERROR: ${String(err)}\n`);
    throw new ApiError(
      'READ_ERROR',
      'Failed to read local.json due to a system error.'
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    process.stderr.write(`[server] readModels PARSE_ERROR: ${String(err)}\n`);
    throw new ApiError(
      'PARSE_ERROR',
      'Failed to parse local.json: the file contains invalid JSON.'
    );
  }

  const result = ModelRegistrySchema.safeParse(parsed);
  if (!result.success) {
    throw new ApiError(
      'VALIDATION_ERROR',
      `local.json failed schema validation: ${result.error.message}`
    );
  }
  return result.data;
}

/**
 * Validates and writes `models` to `local.json` atomically.
 *
 * Guards:
 * 1. Schema validation — all entries must conform to `ModelEntrySchema`.
 * 2. Slug uniqueness — duplicate slugs are rejected.
 * 3. Reserved slug — the slug `"inherit"` is only permitted on the sentinel entry
 *    whose UUID is `00000000-0000-0000-0000-000000000000`.
 * 4. Deletion guard — entries present in the current `local.json` but absent from
 *    `models` are treated as deletions.  If any deleted model's UUID is referenced
 *    in `assignments.json`, the write is rejected and the caller receives the list
 *    of usages so they can surface them to the user.
 *    - If `local.json` does not yet exist (or is inaccessible due to an OS-level
 *      error such as permission denied), the guard is skipped and the write proceeds.
 *    - If `local.json` exists but is corrupt (parse failure or schema mismatch), the
 *      write is rejected with an `ApiError` (`PARSE_ERROR` or `VALIDATION_ERROR`);
 *      corruption must be resolved before any modifications are permitted.
 *
 * Returns `{ saved: true, models: ModelEntry[] }` on success, or
 * `{ saved: false, referencedModels: ReferencedModel[] }` when a deletion is blocked.
 *
 * @throws {ApiError} with code `VALIDATION_ERROR` on schema or constraint violations.
 * @throws {ApiError} with code `PARSE_ERROR` or `VALIDATION_ERROR` when `local.json`
 *   exists but cannot be parsed or fails schema validation (corruption guard).
 * @throws {ApiError} with code `WRITE_ERROR` if the atomic write to `local.json` fails.
 */
export type WriteModelsResult =
  | { saved: true; models: ModelEntry[] }
  | { saved: false; referencedModels: ReferencedModel[] };

export interface ReferencedModel {
  model: ModelEntry;
  usages: string[];
}

export async function writeModels(models: ModelEntry[]): Promise<WriteModelsResult> {
  // 1. Schema validation
  const validation = ModelRegistrySchema.safeParse(models);
  if (!validation.success) {
    throw new ApiError(
      'VALIDATION_ERROR',
      `Model list failed schema validation: ${validation.error.message}`
    );
  }
  const validated = validation.data;

  // 2. Slug uniqueness
  const slugsSeen = new Set<string>();
  for (const entry of validated) {
    if (slugsSeen.has(entry.slug)) {
      throw new ApiError(
        'VALIDATION_ERROR',
        `Duplicate slug detected: "${entry.slug}". Each model must have a unique slug.`
      );
    }
    slugsSeen.add(entry.slug);
  }

  // 3. Reserved slug guard
  for (const entry of validated) {
    if (entry.slug === RESERVED_SLUG && entry.id !== INHERIT_SENTINEL_UUID) {
      throw new ApiError(
        'VALIDATION_ERROR',
        `The slug "${RESERVED_SLUG}" is reserved for the built-in "Inherit / Auto" model and cannot be used for other entries.`
      );
    }
  }

  // 4. Deletion guard — identify removed model IDs
  let existingModels: ModelEntry[] = [];
  try {
    existingModels = await readModels();
  } catch (err) {
    // Silently skip the deletion guard only for OS-level read failures (e.g. file
    // not found, permission denied) — these mean there is nothing to protect.
    // Any ApiError from a corrupt local.json (PARSE_ERROR, VALIDATION_ERROR) is
    // re-thrown so the caller cannot inadvertently bypass the guard on bad data.
    if (!(err instanceof ApiError && err.code === 'READ_ERROR') && !(isNodeError(err) && err.code === 'ENOENT')) {
      throw err;
    }
  }

  const incomingIds = new Set(validated.map((m) => m.id));
  const deletedModels = existingModels.filter((m) => !incomingIds.has(m.id));

  if (deletedModels.length > 0) {
    const referencedModels: ReferencedModel[] = [];
    for (const model of deletedModels) {
      const ref = await isModelReferenced(model.id);
      if (ref.referenced) {
        referencedModels.push({ model, usages: ref.usages });
      }
    }
    if (referencedModels.length > 0) {
      return { saved: false, referencedModels };
    }
  }

  // 5. Write
  await atomicWriteJson(localJsonPath(), validated);
  return { saved: true, models: validated };
}

// ---------------------------------------------------------------------------
// Public API — Model Assignments
// ---------------------------------------------------------------------------

/**
 * Reads `assignments.json`.
 *
 * Returns a default structure `{ default_model_uuid: undefined, persona_models: {} }`
 * when the file does not exist.
 *
 * @throws {ApiError} on parse or schema validation failures.
 */
export async function readAssignments(): Promise<ModelAssignments> {
  let raw: string;
  try {
    raw = await readFile(assignmentsJsonPath(), 'utf-8');
  } catch (err) {
    if (isNodeError(err) && err.code === 'ENOENT') {
      return { default_model_uuid: undefined, persona_models: {} };
    }
    process.stderr.write(`[server] readAssignments READ_ERROR: ${String(err)}\n`);
    throw new ApiError(
      'READ_ERROR',
      'Failed to read assignments.json due to a system error.'
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    process.stderr.write(`[server] readAssignments PARSE_ERROR: ${String(err)}\n`);
    throw new ApiError(
      'PARSE_ERROR',
      'Failed to parse assignments.json: the file contains invalid JSON.'
    );
  }

  const result = ModelAssignmentsSchema.safeParse(parsed);
  if (!result.success) {
    throw new ApiError(
      'VALIDATION_ERROR',
      `assignments.json failed schema validation: ${result.error.message}`
    );
  }
  return result.data;
}

/**
 * Validates and writes `data` to `assignments.json` atomically.
 *
 * @throws {ApiError} on schema validation failure.
 */
export async function writeAssignments(data: ModelAssignments): Promise<void> {
  const result = ModelAssignmentsSchema.safeParse(data);
  if (!result.success) {
    throw new ApiError(
      'VALIDATION_ERROR',
      `Assignments data failed schema validation: ${result.error.message}`
    );
  }
  await atomicWriteJson(assignmentsJsonPath(), result.data);
}

// ---------------------------------------------------------------------------
// Public API — Defaults Merge
// ---------------------------------------------------------------------------

export interface ConflictEntry {
  defaultEntry: ModelEntry;
  localEntry: ModelEntry;
  reason: 'slug_collision';
}

export interface LoadDefaultsResult {
  models: ModelEntry[];
  conflicts: ConflictEntry[];
}

/**
 * Merges `default.json` into `local.json`.
 *
 * Merge rules:
 * - When a default entry's `id` already exists in `local.json`, the local entry
 *   wins (no overwrite).
 * - When a default entry's `id` is new but its `slug` collides with an existing
 *   local entry, the entry is not added and a conflict is recorded.
 * - All other default entries are appended to the local registry.
 *
 * Returns `{ models: ModelEntry[], conflicts: ConflictEntry[] }`.
 *
 * @throws {ApiError} if `default.json` cannot be read/parsed/validated.
 */
export async function loadDefaults(): Promise<LoadDefaultsResult> {
  // Read defaults
  let defaultParsed: unknown;
  try {
    defaultParsed = await readJsonFile(defaultJsonPath());
  } catch (err) {
    process.stderr.write(`[server] loadDefaults READ_ERROR: ${String(err)}\n`);
    throw new ApiError(
      'READ_ERROR',
      'Failed to read default.json due to a system error.'
    );
  }

  const defaultValidation = ModelRegistrySchema.safeParse(defaultParsed);
  if (!defaultValidation.success) {
    throw new ApiError(
      'VALIDATION_ERROR',
      `default.json failed schema validation: ${defaultValidation.error.message}`
    );
  }
  const defaults = defaultValidation.data;

  // Read local (may not exist yet — start from empty)
  let locals: ModelEntry[] = [];
  try {
    locals = await readModels();
  } catch (err) {
    // Note: ENOENT on local.json is handled inside readModels() via auto-init from
    // default.json — it never reaches here as READ_ERROR.  This catch handles the
    // narrow case where readModels() throws READ_ERROR for a non-ENOENT OS error
    // (e.g. permission denied) on local.json.  Treating that as "empty" is
    // intentional: loadDefaults() will then attempt to write the merged result, and
    // any ongoing permission issue will surface there as an atomicWriteJson error.
    // VALIDATION_ERROR and PARSE_ERROR (corrupt local.json) are deliberately re-thrown
    // so the caller learns the registry is in a bad state rather than silently
    // overwriting it with defaults.
    if (err instanceof ApiError && err.code === 'READ_ERROR') {
      locals = [];
    } else {
      throw err;
    }
  }

  const localById = new Map(locals.map((m) => [m.id, m]));
  const localBySlug = new Map(locals.map((m) => [m.slug, m]));

  const conflicts: ConflictEntry[] = [];
  const toAdd: ModelEntry[] = [];

  for (const def of defaults) {
    if (localById.has(def.id)) {
      // Already present by ID — local wins, skip
      continue;
    }
    const slugConflict = localBySlug.get(def.slug);
    if (slugConflict !== undefined) {
      // Slug collision — record conflict, skip
      conflicts.push({ defaultEntry: def, localEntry: slugConflict, reason: 'slug_collision' });
      continue;
    }
    toAdd.push(def);
  }

  if (toAdd.length === 0 && conflicts.length === 0) {
    return { models: locals, conflicts: [] };
  }

  const merged = [...locals, ...toAdd];

  // Note: the disk write is conditional on toAdd.length > 0 — when there are
  // only slug conflicts and nothing new to add, the registry is returned as-is
  // without touching local.json.  The returned `models` array always reflects
  // the full post-merge view regardless of whether a write occurred.
  if (toAdd.length > 0) {
    await atomicWriteJson(localJsonPath(), merged);
  }

  return { models: merged, conflicts };
}

// ---------------------------------------------------------------------------
// Public API — Reference Checking
// ---------------------------------------------------------------------------

/**
 * Checks whether `modelId` (UUID) is referenced in `assignments.json`.
 *
 * Returns `{ referenced: boolean, usages: string[] }` where `usages` lists the
 * persona IDs and/or `'default'` that reference this model UUID.
 */
export async function isModelReferenced(
  modelId: string
): Promise<{ referenced: boolean; usages: string[] }> {
  let assignments: ModelAssignments;
  try {
    assignments = await readAssignments();
  } catch {
    // If assignments.json doesn't exist or is unreadable, nothing references it
    return { referenced: false, usages: [] };
  }

  const usages: string[] = [];

  if (assignments.default_model_uuid === modelId) {
    usages.push('default');
  }

  for (const [personaId, uuid] of Object.entries(assignments.persona_models)) {
    if (uuid === modelId) {
      usages.push(personaId);
    }
  }

  return { referenced: usages.length > 0, usages };
}

// ---------------------------------------------------------------------------
// Public API — UUID-to-Slug Resolution
// ---------------------------------------------------------------------------

export interface ResolvedAssignments {
  default_model_slug: string | null;
  persona_models: Record<string, string>;
}

/**
 * Resolves UUID values in `assignments.json` to slugs using `local.json`.
 *
 * - Returns `null` for `default_model_slug` when `default_model_uuid` is absent
 *   or references an unknown model.
 * - Persona entries with unresolvable UUIDs are omitted (graceful degradation).
 * - When `assignments.json` does not exist, returns
 *   `{ default_model_slug: null, persona_models: {} }`.
 */
export async function getResolvedAssignments(): Promise<ResolvedAssignments> {
  let assignments: ModelAssignments;
  try {
    assignments = await readAssignments();
  } catch {
    return { default_model_slug: null, persona_models: {} };
  }

  let models: ModelEntry[] = [];
  try {
    models = await readModels();
  } catch {
    // Registry unavailable — return unresolved empty result
    return { default_model_slug: null, persona_models: {} };
  }

  const uuidToSlug = new Map(models.map((m) => [m.id, m.slug]));

  const default_model_slug =
    assignments.default_model_uuid !== undefined
      ? (uuidToSlug.get(assignments.default_model_uuid) ?? null)
      : null;

  const persona_models: Record<string, string> = {};
  for (const [personaId, uuid] of Object.entries(assignments.persona_models)) {
    const slug = uuidToSlug.get(uuid);
    if (slug !== undefined) {
      persona_models[personaId] = slug;
    }
    // Unresolvable UUIDs are silently omitted (graceful degradation)
  }

  return { default_model_slug, persona_models };
}

// ---------------------------------------------------------------------------
// Internal — Auto-initialization
// ---------------------------------------------------------------------------

/**
 * Reads `default.json`, writes it to `local.json`, and returns the parsed entries.
 * Called when `local.json` is absent.
 */
async function _initializeLocalFromDefault(): Promise<ModelEntry[]> {
  let defaultParsed: unknown;
  try {
    defaultParsed = await readJsonFile(defaultJsonPath());
  } catch (err) {
    process.stderr.write(`[server] _initializeLocalFromDefault READ_ERROR: ${String(err)}\n`);
    throw new ApiError(
      'READ_ERROR',
      'Auto-initialization failed: could not read default.json due to a system error.'
    );
  }

  const result = ModelRegistrySchema.safeParse(defaultParsed);
  if (!result.success) {
    throw new ApiError(
      'VALIDATION_ERROR',
      `Auto-initialization failed: default.json schema validation error: ${result.error.message}`
    );
  }

  await atomicWriteJson(localJsonPath(), result.data);
  process.stderr.write(
    `[model-registry] local.json not found — auto-initialized from default.json\n`
  );
  return result.data;
}
