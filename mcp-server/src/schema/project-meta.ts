import { z } from 'zod';

export const ProjectMetaSchema = z.object({
  slug: z.string(),                      // plan folder basename, e.g. "2026-02-16-feature"
  plan_path: z.string(),                 // original absolute project_path
  status: z.enum(['READY', 'IN_PROGRESS', 'COMPLETE', 'BLOCKED']),
  date_created: z.string(),              // ISO timestamp
  last_updated: z.string(),             // ISO timestamp
  title: z.string().optional(),         // optional, derived from plan_file content
});

export type ProjectMeta = z.infer<typeof ProjectMetaSchema>;
