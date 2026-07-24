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
