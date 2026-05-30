import { z } from 'zod';

/**
 * Insight scope enum.
 * - 'global'  — applies across all projects
 * - 'project' — scoped to a specific project
 *
 * Note: when scope === 'project', project_slug must be present. This constraint
 * is enforced by the storage layer rather than this schema, so the Zod schema
 * remains composable and usable without runtime context.
 */
export const InsightScope = z.enum(['global', 'project']);
export type InsightScope = z.infer<typeof InsightScope>;

/**
 * Regex pattern for valid project slugs.
 *
 * Accepts slugs that start with an alphanumeric character and contain only
 * letters, digits, underscores, and hyphens. Rejects anything with `/`, `\`,
 * `.`, spaces, or other characters that could escape the `.knowledge/` directory.
 *
 * This pattern is the single source of truth — used by both the Zod schema
 * (InsightSchema.project_slug) and the storage-layer guard (_validateSlug).
 * Update this constant to change the slug policy in both places at once.
 */
export const PROJECT_SLUG_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

/**
 * Insight schema — a single reusable knowledge record stored in the knowledge base.
 *
 * Field notes:
 * - `project_slug`: required when scope === 'project', but that constraint is
 *   owned by the storage layer (KnowledgeStoreManager), not this schema. The
 *   schema accepts project_slug as optional to remain context-free. The regex
 *   constraint (PROJECT_SLUG_REGEX: `^[a-zA-Z0-9][a-zA-Z0-9_-]*$`) prevents
 *   path traversal at the schema boundary — slugs with `/`, `\`, or `..` are
 *   rejected.
 * - `confidence`: a 0–1 float indicating reliability of the insight. Range is
 *   enforced as [0, 1] — values outside this range are rejected at parse time.
 * - `superseded_by`: optional reference to the id of the insight that replaces
 *   this one. No referential integrity is enforced at the schema layer.
 * - `updated_at`: optional; present only when an insight has been amended after
 *   initial creation.
 */
export const InsightSchema = z.object({
  id: z.number().int(),
  scope: InsightScope,
  project_slug: z.string().regex(PROJECT_SLUG_REGEX).optional(),
  title: z.string(),
  content: z.string(),
  category: z.string(),
  tags: z.array(z.string()),
  source: z.string(),
  created_at: z.string(),
  updated_at: z.string().optional(),
  confidence: z.number().min(0).max(1),
  superseded_by: z.number().int().optional(),
});
export type Insight = z.infer<typeof InsightSchema>;

/**
 * KnowledgeStore schema — top-level structure for `.knowledge/store.json`.
 *
 * - `version`: schema version string (e.g. "1.0.0") for forward-compatibility.
 * - `last_updated`: ISO 8601 timestamp of the most recent write.
 * - `next_id`: auto-increment counter; the id that will be assigned to the
 *   next insight added to the store.
 * - `insights`: flat array of all stored Insight records.
 */
export const KnowledgeStoreSchema = z.object({
  version: z.string(),
  last_updated: z.string(),
  next_id: z.number().int().nonnegative(),
  insights: z.array(InsightSchema),
});
export type KnowledgeStore = z.infer<typeof KnowledgeStoreSchema>;
