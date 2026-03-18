import { z } from 'zod';

/**
 * Project-level status enum matching project-ledger-schema.md.
 * Spec §5.2 defines READY | IN_PROGRESS | COMPLETE | BLOCKED.
 * ARCHIVED is an implementation extension used by the GUI auto-archive system.
 */
export const ProjectStatus = z.enum(['READY', 'IN_PROGRESS', 'COMPLETE', 'BLOCKED', 'ARCHIVED']);
export type ProjectStatus = z.infer<typeof ProjectStatus>;

/**
 * Work package status enum matching project-ledger-schema.md
 */
export const WorkPackageStatus = z.enum(['READY', 'IN_PROGRESS', 'COMPLETE', 'BLOCKED', 'CANCELLED']);
export type WorkPackageStatus = z.infer<typeof WorkPackageStatus>;

/**
 * Pipeline status enum matching project-ledger-schema.md
 * Note: 'READY' was removed as pipelines are always created with 'IN_PROGRESS' status.
 */
export const PipelineStatus = z.enum(['IN_PROGRESS', 'PASS', 'FAIL']);
export type PipelineStatus = z.infer<typeof PipelineStatus>;

/**
 * Blocker type enum matching project-ledger-schema.md
 */
export const BlockerType = z.enum(['dependency', 'decision', 'external', 'technical']);
export type BlockerType = z.infer<typeof BlockerType>;

/**
 * Comment priority enum matching project-ledger-schema.md
 */
export const CommentPriority = z.enum(['low', 'medium', 'high']);
export type CommentPriority = z.infer<typeof CommentPriority>;
