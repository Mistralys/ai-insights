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
  summary: z.array(z.string()),
  artifacts: ArtifactsSchema.optional(),
  metrics: MetricsSchema.optional(),
  comments: z.array(PipelineCommentSchema).optional(),
});
export type Pipeline = z.infer<typeof PipelineSchema>;

/**
 * Work Package Detail schema (ledger/WP-###.json)
 */
export const WorkPackageDetailSchema = z.object({
  work_package_id: z.string().regex(/^WP-\d{3}$/),
  work_package_file: z.string(),
  status: WorkPackageStatus,
  assigned_to: z.string(),
  dependencies: z.array(z.string()),
  blocked_by: BlockerSchema.optional(),
  acceptance_criteria: z.array(AcceptanceCriterionSchema),
  revision: z.number().int().positive(),
  pipelines: z.array(PipelineSchema),
});
export type WorkPackageDetail = z.infer<typeof WorkPackageDetailSchema>;
