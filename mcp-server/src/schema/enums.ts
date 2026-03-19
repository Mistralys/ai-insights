import { z } from 'zod';
import { workflowManifest } from './workflow-manifest-schema.js';

// ─── Status enums derived from the shared workflow manifest ────────────────
//
// The manifest's `statuses` object is the single source of truth for all
// spec-defined status values.  Each enum is assembled from the manifest arrays;
// no inline literal arrays remain except for the ARCHIVED extension and
// CommentPriority (an implementation-level concern, not a spec construct).
//
// TypeScript JSON imports widen string arrays to `string[]`, so narrow union
// types are preserved via explicit tuple type assertions (compile-time only).
// The actual VALUES at runtime always come from the manifest.
// ─────────────────────────────────────────────────────────────────────────────

const { statuses } = workflowManifest;

/**
 * Project-level status enum matching project-ledger-schema.md.
 * Spec §5.2 defines READY | IN_PROGRESS | COMPLETE | BLOCKED.
 * ARCHIVED is an implementation extension used by the GUI auto-archive system.
 */
export const ProjectStatus = z.enum(
  [...statuses.project, 'ARCHIVED'] as unknown as
    ['READY', 'IN_PROGRESS', 'COMPLETE', 'BLOCKED', 'ARCHIVED']
);
export type ProjectStatus = z.infer<typeof ProjectStatus>;

/**
 * Work package status enum matching project-ledger-schema.md
 */
export const WorkPackageStatus = z.enum(
  statuses.work_package as unknown as
    ['READY', 'IN_PROGRESS', 'COMPLETE', 'BLOCKED', 'CANCELLED']
);
export type WorkPackageStatus = z.infer<typeof WorkPackageStatus>;

/**
 * Pipeline status enum matching project-ledger-schema.md
 * Note: 'READY' was removed as pipelines are always created with 'IN_PROGRESS' status.
 */
export const PipelineStatus = z.enum(
  statuses.pipeline as unknown as ['IN_PROGRESS', 'PASS', 'FAIL']
);
export type PipelineStatus = z.infer<typeof PipelineStatus>;

/**
 * Blocker type enum matching project-ledger-schema.md
 */
export const BlockerType = z.enum(
  statuses.blocker_type as unknown as
    ['dependency', 'decision', 'external', 'technical']
);
export type BlockerType = z.infer<typeof BlockerType>;

/**
 * Comment priority enum — implementation-level constant, not a spec construct.
 */
export const CommentPriority = z.enum(['low', 'medium', 'high']);
export type CommentPriority = z.infer<typeof CommentPriority>;
