import { z } from 'zod';

/**
 * Insight scope enum.
 * - 'global'     — applies across all codebases / repositories
 * - 'repository' — scoped to a specific repository (codebase-level knowledge)
 *
 * Note: when scope === 'repository', repository_name should be present. This
 * constraint is enforced by the storage layer rather than this schema, so the
 * Zod schema remains composable and usable without runtime context.
 */
export const InsightScope = z.enum(['global', 'repository']);
export type InsightScope = z.infer<typeof InsightScope>;

/**
 * Regex pattern for valid slugs (repository names, plan slugs, etc.).
 *
 * Accepts slugs that start with an alphanumeric character and contain only
 * letters, digits, underscores, and hyphens. Rejects anything with `/`, `\`,
 * `.`, spaces, or other characters that could escape the `.knowledge/` directory.
 *
 * This pattern is the single source of truth — used by the Zod schema
 * (InsightSchema.repository_name, InsightSchema.origin_plan) and the
 * storage-layer guard (_validateSlug).
 * Update this constant to change the slug policy in both places at once.
 */
export const SLUG_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

/**
 * Insight schema — a single reusable knowledge record stored in the knowledge base.
 *
 * Field notes:
 * - `repository_name`: required when scope === 'repository', but that constraint
 *   is owned by the storage layer (KnowledgeStoreManager), not this schema. The
 *   schema accepts repository_name as optional to remain context-free. The regex
 *   constraint (SLUG_REGEX: `^[a-zA-Z0-9][a-zA-Z0-9_-]*$`) prevents
 *   path traversal at the schema boundary — slugs with `/`, `\`, or `..` are
 *   rejected.
 * - `origin_plan`: optional provenance metadata — the plan slug where this
 *   insight was first discovered or generated. Validated against SLUG_REGEX.
 *   Distinct from `source` (a reference link/URL); origin_plan records the
 *   planning artefact that produced the insight.
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
  repository_name: z.string().regex(SLUG_REGEX).optional(),
  origin_plan: z.string().regex(SLUG_REGEX).optional(),
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
 * KnowledgeStore schema — top-level structure for per-scope store files under `.knowledge/`.
 *
 * The knowledge base uses a multi-file layout — one JSON file per store:
 * - `.knowledge/global-insights.json` — global-scoped insights
 * - `.knowledge/{repositoryName}-insights.json` — repository-scoped insights
 *
 * Each file conforms to this schema:
 * - `version`: schema version string (e.g. "1.0.0") for forward-compatibility.
 * - `last_updated`: ISO 8601 timestamp of the most recent write.
 * - `next_id`: auto-increment counter; the id that will be assigned to the
 *   next insight added to this store.
 * - `insights`: flat array of all stored Insight records in this store.
 */
export const KnowledgeStoreSchema = z.object({
  version: z.string(),
  last_updated: z.string(),
  next_id: z.number().int().nonnegative(),
  insights: z.array(InsightSchema),
});
export type KnowledgeStore = z.infer<typeof KnowledgeStoreSchema>;
