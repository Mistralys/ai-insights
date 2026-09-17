import { z } from 'zod';
import { SLUG_REGEX } from './common.js';

/**
 * Project-side declaration schema (`.ledger/settings.json`).
 *
 * This is the schema for the opt-in, project-side declaration file that
 * links a working tree to a repository entry in the central ledger registry
 * and controls which generated outputs (e.g. the strategic vision mirror)
 * are written into the project.
 *
 * No filesystem I/O happens here — this module only defines shapes. Loading,
 * merging with the local override, and path resolution live in
 * `src/storage/project-declaration.ts`. Path-traversal and reserved-filename
 * validation for `outputs.*.path` is intentionally excluded from this schema
 * (see `constraints-code-style.md` § "Do Not Use `.refine()`, `.transform()`,
 * or `.superRefine()` on Outer Tool Schemas") — that validation lives in
 * `resolveOutputPath()`.
 */

/**
 * The single list of valid output ids. v1 ships exactly one member,
 * `strategic-vision`; the `outputs` map's shape is designed for more.
 */
export const OUTPUT_IDS = ['strategic-vision'] as const;

/**
 * Enum of known output ids, derived from OUTPUT_IDS so the two can never
 * drift apart.
 */
export const OutputIdSchema = z.enum(OUTPUT_IDS);
export type OutputId = z.infer<typeof OutputIdSchema>;

/**
 * Default relative path (from the project root) for each output id, used
 * by `resolveOutputPath()` when a declaration does not override `path`.
 */
export const DEFAULT_OUTPUT_PATHS: Record<OutputId, string> = {
  'strategic-vision': '.ledger/strategic-vision.md',
};

/**
 * Per-output configuration: whether it is enabled, and an optional
 * override for the path it is written to (relative to the project root).
 *
 * `enabled` defaults to `false` — every output is opt-in, per the consent
 * model this feature is bounded by.
 *
 * `path`, when set, retargets a *generated, periodically overwritten* file.
 * Never declare it at a security-sensitive destination — for example,
 * anything under `.git/`, a CI configuration file, or an executable script
 * path — since every `ledger sync` run will silently replace that file's
 * content. This is unsupported: there is no schema-level denylist (see the
 * module doc above), so containment relies entirely on the runtime guards in
 * `resolveOutputPath()` / `syncProjectOutputs()`, not on this field's shape.
 */
export const OutputConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    path: z.string().min(1).optional(),
  })
  .strict();
export type OutputConfig = z.infer<typeof OutputConfigSchema>;

/**
 * Per-output configuration as it appears in `settings.local.json` — same
 * shape as {@link OutputConfigSchema}, but `enabled` carries no `.default()`.
 *
 * `settings.local.json` entries are merged field-by-field over the base
 * `settings.json` entry (see `loadProjectDeclaration()` in
 * `src/storage/project-declaration.ts`), not schema-validated in isolation
 * as a final value. If `enabled` defaulted to `false` here the way it does
 * in {@link OutputConfigSchema}, a local override that specifies only
 * `path` would parse with a fabricated `enabled: false` that then always
 * wins the merge — silently clobbering the base's `enabled: true` even
 * though neither file asked for that. Leaving `enabled` `undefined` when
 * unspecified lets the loader apply the `false` default only to the
 * *merged* result, after both files have had a chance to set it.
 */
export const OutputConfigLocalSchema = z
  .object({
    enabled: z.boolean().optional(),
    path: z.string().min(1).optional(),
  })
  .strict();
export type OutputConfigLocal = z.infer<typeof OutputConfigLocalSchema>;

/**
 * The project-side declaration file, `.ledger/settings.json`.
 *
 * - `schema_version`: currently only `1` is supported.
 * - `repository_id`: slug identifying the linked entry in the central
 *   registry, validated against the same `SLUG_REGEX` as
 *   `RepositoryEntrySchema.id` (`schema/repository-registry.ts`).
 * - `outputs`: optional, keyed by a known output id; unknown keys are
 *   rejected via `.strict()` on both this object and `OutputConfigSchema`.
 */
export const ProjectSettingsSchema = z
  .object({
    schema_version: z.literal(1),
    repository_id: z.string().regex(SLUG_REGEX),
    outputs: z.record(OutputIdSchema, OutputConfigSchema).optional(),
  })
  .strict();
export type ProjectSettings = z.infer<typeof ProjectSettingsSchema>;

/**
 * The local override file, `.ledger/settings.local.json`.
 *
 * Same shape as `ProjectSettingsSchema`, but every field is optional and
 * `repository_id` is omitted entirely — a local override may not redirect
 * a project's declared identity, only tweak output preferences on a single
 * machine. The loader rejects a local file that carries `repository_id`
 * with a message naming the file.
 */
export const ProjectSettingsLocalSchema = z
  .object({
    schema_version: z.literal(1).optional(),
    outputs: z.record(OutputIdSchema, OutputConfigLocalSchema).optional(),
  })
  .strict();
export type ProjectSettingsLocal = z.infer<typeof ProjectSettingsLocalSchema>;
