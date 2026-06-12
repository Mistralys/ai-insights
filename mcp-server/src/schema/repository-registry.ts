import { z } from 'zod';
import { SLUG_REGEX } from './knowledge.js';

/**
 * Three-horizon strategic vision for a repository.
 *
 * All three horizon fields are nullable strings — `null` indicates the vision
 * has not yet been authored for that horizon. Empty strings are rejected to
 * prevent accidentally saving a "blank" vision that is visually
 * indistinguishable from an unset one.
 */
export const StrategicVisionSchema = z.object({
  short_term: z.string().min(1).nullable(),
  mid_term: z.string().min(1).nullable(),
  long_term: z.string().min(1).nullable(),
});
export type StrategicVision = z.infer<typeof StrategicVisionSchema>;

/**
 * A single repository entry in the central `.repositories.json` registry.
 *
 * Field notes:
 * - `id`: slug identifier for this entry, validated against SLUG_REGEX.
 *   Must start with an alphanumeric character and contain only letters,
 *   digits, hyphens, and underscores. This prevents path traversal and
 *   ensures it is safe to use as a filename fragment.
 * - `label`: human-readable display name shown in the GUI Strategy screen.
 * - `folder_names`: one or more workspace folder names that map to this
 *   repository entry. The storage layer uses these aliases to resolve
 *   `ledger_get_repository_context` lookups by the active workspace folder.
 * - `vision`: three-horizon strategic vision, or all-null if not yet authored.
 * - `created_at`: ISO 8601 timestamp of when the entry was first created.
 *   The schema accepts any string here (no format constraint is applied by Zod),
 *   consistent with the project-wide convention in `knowledge.ts` (`InsightSchema.created_at`).
 *   ISO 8601 format is expected by convention and enforced by the storage layer.
 * - `last_modified`: ISO 8601 timestamp of the most recent edit. Same convention
 *   as `created_at` — format is validated by the storage layer, not by this schema.
 */
export const RepositoryEntrySchema = z.object({
  id: z.string().regex(SLUG_REGEX),
  label: z.string().min(1),
  folder_names: z.array(z.string().min(1)).min(1),
  vision: StrategicVisionSchema,
  created_at: z.string(),
  last_modified: z.string(),
});
export type RepositoryEntry = z.infer<typeof RepositoryEntrySchema>;

/**
 * Top-level schema for the `.repositories.json` registry file.
 *
 * The registry is stored at `{ledgerRoot}/.repositories.json` and lists
 * all opt-in repository entries. An empty `repositories` array is valid
 * and represents a registry that has been initialized but not yet populated.
 */
export const RepositoryRegistrySchema = z.object({
  repositories: z.array(RepositoryEntrySchema),
});
export type RepositoryRegistry = z.infer<typeof RepositoryRegistrySchema>;
