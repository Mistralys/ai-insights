import { z } from 'zod';
import { ProjectStatus, WorkPackageStatus, CommentPriority } from './enums.js';
import { IncidentContextSchema } from './work-package.js';

/**
 * Work Package Summary object schema (lightweight entry in root index)
 */
export const WorkPackageSummarySchema = z.object({
  work_package_id: z.string().regex(/^WP-\d{3,}$/),
  status: WorkPackageStatus,
  assigned_to: z.string().nullable(),
  dependencies: z.array(z.string()),
  file: z.string(),
  active_pipeline_stages: z.array(z.string()).nullable().optional(),
});
export type WorkPackageSummary = z.infer<typeof WorkPackageSummarySchema>;

/**
 * Project comment schema (includes agent field, unlike pipeline comments)
 */
export const ProjectCommentSchema = z.object({
  type: z.string(),
  priority: CommentPriority,
  timestamp: z.string(),
  agent: z.string(),
  note: z.string(),
  context: IncidentContextSchema.optional(),
});
export type ProjectComment = z.infer<typeof ProjectCommentSchema>;

/**
 * Root Index schema (.ledger/project-ledger.json)
 */
export const RootIndexSchema = z.object({
  plan_file: z.string(),
  date_created: z.string(),
  last_updated: z.string(),
  status: ProjectStatus,
  total_work_packages: z.number().int().nonnegative(),
  pending_work_packages: z.number().int().nonnegative(),
  work_packages: z.array(WorkPackageSummarySchema),
  project_comments: z.array(ProjectCommentSchema),
  auto_handoff_depth: z.number().int().nonnegative().optional(),
  synthesis_generated: z.boolean().optional(),
  synthesis_generated_at: z.string().nullable().optional(),
  ledger_version: z.string().optional(),
  server_version: z.string().optional(),
});
export type RootIndex = z.infer<typeof RootIndexSchema>;
