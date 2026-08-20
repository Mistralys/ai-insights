import { z } from 'zod';
import { ProjectStatus } from './enums.js';

export const ProjectMetaSchema = z.object({
  slug: z.string(),                      // plan folder basename, e.g. "2026-02-16-feature"
  plan_path: z.string(),                 // original absolute project_path
  status: ProjectStatus,
  date_created: z.string(),              // ISO timestamp; stamped once by writeProjectMeta() on first write and never re-synced afterward — NOT authoritative for duration math. Prefer RootIndex.date_created (writeRootIndex() treats it as the source of truth), which can legitimately differ (e.g. standalone imports derive it from plan.md's filesystem birthtime).
  last_updated: z.string(),             // ISO timestamp
  title: z.string().optional(),         // optional, derived from plan_file content
  // Enrichment cache fields - optional for backward compatibility
  total_work_packages: z.number().int().nonnegative().optional(),
  pending_work_packages: z.number().int().nonnegative().optional(),
  progress_pct: z.number().nonnegative().optional(),
  duration_ms: z.number().int().nonnegative().nullable().optional(),
  project_name: z.string().nullable().optional(),
  repository_name: z.string().nullable().optional(),
  // Synthesis outcome — optional for backward compatibility
  outcome_summary: z.string().nullable().optional(),
  // Project intent summary — set at initialization time, optional for backward compatibility
  project_summary: z.string().nullable().optional(),
  // Runner metadata - optional for backward compatibility
  runner: z.enum(['vscode', 'claude-code', 'orchestrator', 'standalone', 'unknown']).optional(),
  runner_client: z.string().optional(),   // raw clientInfo.name
  runner_version: z.string().optional(),  // raw clientInfo.version
});

export type ProjectMeta = z.infer<typeof ProjectMetaSchema>;
