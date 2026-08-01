import { z } from 'zod';
import { SLUG_REGEX } from './common.js';

/**
 * Optional sync metadata attached to a store entry.
 *
 * The MCP server does not manage sync — this is purely informational.
 * Users can document their sync setup (provider, remote path, notes) here;
 * the data travels with `stores.json` and is never acted upon by the server.
 */
export const StoreSyncMetaSchema = z.object({
  provider: z.string().min(1).optional(),
  remote_path: z.string().min(1).optional(),
  notes: z.string().optional(),
});
export type StoreSyncMeta = z.infer<typeof StoreSyncMetaSchema>;

/**
 * A single store entry in `stores.json`.
 *
 * Field notes:
 * - `id`: slug identifier, validated against SLUG_REGEX. Used as a stable
 *   reference key; must start with an alphanumeric character and contain
 *   only letters, digits, hyphens, and underscores. Prevents path traversal
 *   when used as a directory fragment.
 * - `path`: path to the store's root directory on disk. May use a `~` prefix
 *   which is expanded at runtime by `expandStorePath()`. The schema accepts
 *   any non-empty string — expansion and normalization happen in the storage
 *   layer, not at the schema boundary.
 * - `label`: optional human-readable display name shown in GUIs and CLI output.
 * - `sync`: optional informational sync metadata. Not enforced by the server.
 */
export const StoreEntrySchema = z.object({
  id: z.string().regex(SLUG_REGEX),
  path: z.string().min(1),
  label: z.string().min(1).optional(),
  sync: StoreSyncMetaSchema.optional(),
});
export type StoreEntry = z.infer<typeof StoreEntrySchema>;

/**
 * Top-level schema for `stores.json` — the user-level multi-store configuration.
 *
 * Stored at `~/.ai-insights/stores.json`. The array order in `stores` defines
 * store priority: when the same repository appears in multiple stores'
 * `.repositories.json`, the first matching store wins for write routing.
 *
 * Refinements enforced:
 * - `stores` must contain at least one entry.
 * - `stores` must not contain duplicate `id` values.
 * - `default_store` must reference an `id` that exists in `stores`.
 */
export const StoresConfigSchema = z
  .object({
    stores: z.array(StoreEntrySchema).min(1),
    default_store: z.string(),
  })
  .refine(
    (data) => {
      const ids = data.stores.map((s) => s.id);
      return new Set(ids).size === ids.length;
    },
    { message: 'Duplicate store IDs are not allowed', path: ['stores'] }
  )
  .refine(
    (data) => data.stores.some((s) => s.id === data.default_store),
    {
      message: 'default_store must match an existing store id',
      path: ['default_store'],
    }
  );
export type StoresConfig = z.infer<typeof StoresConfigSchema>;

/**
 * Shape of a single store entry returned by `GET /api/stores`.
 *
 * Defined here (co-located with the store configuration schema) so that
 * TypeScript consumers can import the type directly from the schema layer
 * without depending on the GUI handler module.
 */
export interface StoreListItem {
  id: string;
  label: string;
  path: string;
  project_count: number;
  repository_count: number;
}
