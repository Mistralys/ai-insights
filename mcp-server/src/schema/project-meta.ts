import { z } from 'zod';
import { ProjectStatus } from './enums.js';

export const ProjectMetaSchema = z.object({
  slug: z.string(),                      // plan folder basename, e.g. "2026-02-16-feature"
  plan_path: z.string(),                 // original absolute project_path
  status: ProjectStatus,
  date_created: z.string(),              // ISO timestamp
  last_updated: z.string(),             // ISO timestamp
  title: z.string().optional(),         // optional, derived from plan_file content
  // Enrichment cache fields — optional for backward compatibility
  total_work_packages: z.number().int().nonnegative().optional(),
  pending_work_packages: z.number().int().nonnegative().optional(),
  project_name: z.string().nullable().optional(),
  repository_name: z.string().nullable().optional(),
});

export type ProjectMeta = z.infer<typeof ProjectMetaSchema>;
