import { z } from 'zod';
import {
  WorkPackageStatus,
  PipelineStatus,
  BlockerType,
  CommentPriority,
} from './enums.js';

/**
 * Blocker object schema (optional, only present when status is BLOCKED)
 */
export const BlockerSchema = z.object({
  type: BlockerType,
  description: z.string(),
  blocking_work_package: z.string().optional(),
});
export type Blocker = z.infer<typeof BlockerSchema>;

/**
 * Acceptance criterion object schema
 */
export const AcceptanceCriterionSchema = z.object({
  criterion: z.string(),
  met: z.boolean(),
});
export type AcceptanceCriterion = z.infer<typeof AcceptanceCriterionSchema>;

/**
 * Artifacts object schema (optional, common in implementation and deployment pipelines)
 */
export const ArtifactsSchema = z.object({
  files_modified: z.array(z.string()).optional(),
  commit_hash: z.string().optional(),
  pull_request: z.string().optional(),
});
export type Artifacts = z.infer<typeof ArtifactsSchema>;

/**
 * Metrics object schema (optional, flexible structure for different pipeline types)
 */
export const MetricsSchema = z.object({
  test_coverage: z.string().optional(),
  tests_passed: z.number().optional(),
  tests_failed: z.number().optional(),
  security_issues: z.number().optional(),
}).passthrough(); // Allow additional fields for custom metrics
export type Metrics = z.infer<typeof MetricsSchema>;

/**
 * Context object for incident comments (required for incident type)
 */
export const IncidentContextSchema = z.object({
  os: z.string(),
  tool: z.string(),
  work_package: z.string().optional(),
  resolved: z.boolean(),
  workaround: z.string().optional(),
});
export type IncidentContext = z.infer<typeof IncidentContextSchema>;

/**
 * Pipeline comment schema (no agent field - agent is inferred from pipeline type)
 */
export const PipelineCommentSchema = z.object({
  type: z.string(),
  priority: CommentPriority,
  timestamp: z.string(),
  note: z.string(),
  context: IncidentContextSchema.optional(),
});
export type PipelineComment = z.infer<typeof PipelineCommentSchema>;

/**
 * Pipeline object schema
 */
export const PipelineSchema = z.object({
  type: z.string(),
  status: PipelineStatus,
  started_at: z.string().optional(),
  completed_at: z.string().optional(),
  duration_ms: z.number().optional(),
  summary: z.array(z.string()),
  artifacts: ArtifactsSchema.optional(),
  metrics: MetricsSchema.optional(),
  comments: z.array(PipelineCommentSchema).optional(),
  auto_cancelled: z.boolean().optional(),
});
export type Pipeline = z.infer<typeof PipelineSchema>;

/**
 * Handoff note schema (optional, appended when completing a pipeline with handoff_notes)
 */
export const HandoffNoteSchema = z.object({
  from_agent: z.string(),
  to_agent: z.string(),
  timestamp: z.string(),
  notes: z.array(z.string()),
});
export type HandoffNote = z.infer<typeof HandoffNoteSchema>;

/**
 * Rework counts per pipeline type (canonical new field, §3.4)
 */
export const ReworkCountsSchema = z.object({
  implementation: z.number().int().nonnegative().optional(),
  qa: z.number().int().nonnegative().optional(),
  'code-review': z.number().int().nonnegative().optional(),
  documentation: z.number().int().nonnegative().optional(),
  'security-audit': z.number().int().nonnegative().optional(),
  'release-engineering': z.number().int().nonnegative().optional(),
});
export type ReworkCounts = z.infer<typeof ReworkCountsSchema>;

/**
 * Work Package Detail schema (.ledger/WP-###.json)
 */
export const WorkPackageDetailSchema = z.object({
  work_package_id: z.string().regex(/^WP-\d{3,}$/),
  work_package_file: z.string(),
  status: WorkPackageStatus,
  assigned_to: z.string().nullable(),
  dependencies: z.array(z.string()),
  blocked_by: BlockerSchema.optional(),
  acceptance_criteria: z.array(AcceptanceCriterionSchema),
  active_pipeline_stages: z.array(z.string()).optional(),
  revision: z.number().int().nonnegative(),
  pipelines: z.array(PipelineSchema),
  rework_count: z.number().int().nonnegative().optional(),
  rework_counts: ReworkCountsSchema.optional(),
  status_changed_at: z.string().optional(),
  last_updated: z.string().optional(),
  reset_at: z.string().optional(),
  handoff_notes: z.array(HandoffNoteSchema).optional(),
});
export type WorkPackageDetail = z.infer<typeof WorkPackageDetailSchema>;
