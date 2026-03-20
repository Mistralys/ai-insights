# MCP Server - Source (Storage & Schema)
_SOURCE: LedgerStore, schema validation, and data models_
# LedgerStore, schema validation, and data models
```
// Structure of documents
└── mcp-server/
    └── src/
        └── schema/
            ├── enums.ts
            ├── project-meta.ts
            ├── root-index.ts
            ├── validators.ts
            ├── work-package.ts
            ├── workflow-manifest-schema.ts
        └── storage/
            └── atomic-writer.ts
            └── file-lock.ts
            └── ledger-store.ts

```
###  Path: `\mcp-server\src\schema/enums.ts`

```ts
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

```
###  Path: `\mcp-server\src\schema/project-meta.ts`

```ts
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

```
###  Path: `\mcp-server\src\schema/root-index.ts`

```ts
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
});
export type RootIndex = z.infer<typeof RootIndexSchema>;

```
###  Path: `\mcp-server\src\schema/validators.ts`

```ts
import type { WorkPackageStatus } from './enums.js';
import type { WorkPackageDetail } from './work-package.js';
import type { WorkPackageSummary } from './root-index.js';

/**
 * Returns true if the given WP status is terminal (no further transitions out).
 * Terminal statuses: COMPLETE, CANCELLED.
 *
 * Use this predicate everywhere you need to check whether a WP is "done" —
 * instead of inline `status === 'COMPLETE'` or `status !== 'COMPLETE'` checks —
 * so that adding a new terminal status in the future is a single-point change.
 */
export function isTerminalStatus(status: string): boolean {
  return status === 'COMPLETE' || status === 'CANCELLED';
}

/**
 * Status transition rules enforced by the MCP server.
 * Based on the transition table in plan.md:
 *
 * Legal transitions:
 * - READY -> IN_PROGRESS (if dependencies met)
 * - READY -> BLOCKED
 * - READY -> CANCELLED (PM only)
 * - IN_PROGRESS -> COMPLETE (if all acceptance criteria met)
 * - IN_PROGRESS -> BLOCKED
 * - IN_PROGRESS -> CANCELLED (PM only)
 * - IN_PROGRESS -> READY (unclaim path, spec §21.13)
 * - BLOCKED -> IN_PROGRESS
 * - BLOCKED -> READY (auto-unblock by propagateDependencyUnblock)
 * - BLOCKED -> CANCELLED (PM only)
 * - COMPLETE -> IN_PROGRESS (triggers revision increment)
 * - COMPLETE -> CANCELLED (PM only)
 * - CANCELLED is terminal — no transitions out (including CANCELLED -> CANCELLED)
 */
export function isValidStatusTransition(
  from: WorkPackageStatus,
  to: WorkPackageStatus
): boolean {
  // Same-status is a no-op for all statuses except CANCELLED (which is terminal).
  if (from === to) {
    return from !== 'CANCELLED';
  }

  switch (from) {
    case 'READY':
      return to === 'IN_PROGRESS' || to === 'BLOCKED' || to === 'CANCELLED';

    case 'IN_PROGRESS':
      return to === 'COMPLETE' || to === 'BLOCKED' || to === 'CANCELLED' || to === 'READY';

    case 'BLOCKED':
      return to === 'IN_PROGRESS' || to === 'READY' || to === 'CANCELLED';

    case 'COMPLETE':
      return to === 'IN_PROGRESS' || to === 'CANCELLED';

    case 'CANCELLED':
      return false; // Terminal — no transitions out

    default:
      return false;
  }
}

/**
 * Check if a work package can be started (all dependencies must be COMPLETE).
 *
 * @param wp - The work package to check
 * @param allWpSummaries - All work package summaries from the root index
 * @returns Object with allowed boolean and optional reason string
 */
export function canStartWorkPackage(
  wp: WorkPackageDetail | WorkPackageSummary,
  allWpSummaries: WorkPackageSummary[]
): { allowed: boolean; reason?: string } {
  if (wp.dependencies.length === 0) {
    return { allowed: true };
  }

  const notCompleteDeps: string[] = [];

  for (const depId of wp.dependencies) {
    const depWp = allWpSummaries.find((w) => w.work_package_id === depId);

    if (!depWp) {
      return {
        allowed: false,
        reason: `Dependency ${depId} not found in project`,
      };
    }

    if (!isTerminalStatus(depWp.status)) {
      notCompleteDeps.push(`${depId} (status: ${depWp.status})`);
    }
  }

  if (notCompleteDeps.length > 0) {
    return {
      allowed: false,
      reason: `Dependencies not complete: ${notCompleteDeps.join(', ')}`,
    };
  }

  return { allowed: true };
}

/**
 * Check if a work package can be marked as COMPLETE (all acceptance criteria must be met).
 *
 * @param wp - The work package to check
 * @returns Object with allowed boolean and optional array of unmet criteria
 */
export function canCompleteWorkPackage(wp: WorkPackageDetail): {
  allowed: boolean;
  unmet?: string[];
} {
  const unmetCriteria = wp.acceptance_criteria
    .filter((criterion) => !criterion.met)
    .map((criterion) => criterion.criterion);

  if (unmetCriteria.length > 0) {
    return {
      allowed: false,
      unmet: unmetCriteria,
    };
  }

  return { allowed: true };
}

```
###  Path: `\mcp-server\src\schema/work-package.ts`

```ts
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

```
###  Path: `\mcp-server\src\schema/workflow-manifest-schema.ts`

```ts
/**
 * Zod schema for the shared workflow manifest.
 *
 * Purpose: runtime validation at module-load time (fail fast with a clear error)
 * + narrow TypeScript type inference (e.g. AgentRole derived via z.infer,
 * eliminating manually maintained union type declarations in consumers).
 *
 * Distinct from shared/workflow-manifest.schema.json, which is a JSON Schema
 * used for structural validation only.  The Zod schema serves the additional
 * purpose of producing narrow TypeScript types and validating field semantics
 * (e.g. positive integers, non-empty arrays) at startup.
 */

import { createRequire } from 'module';
import { z } from 'zod';

const _require = createRequire(import.meta.url);

// ── Agent role names ────────────────────────────────────────────────────────

/**
 * Zod enum of all valid agent role names, in manifest order.
 * `AgentRole` is inferred from this — no manual union type annotation needed
 * in consumers.
 */
export const AgentRoleEnum = z.enum([
  'Planner',
  'Project Manager',
  'Developer',
  'QA',
  'Security Auditor',
  'Reviewer',
  'Release Engineer',
  'Documentation',
  'Synthesis',
]);

/** Union of all valid agent role name strings. Inferred from AgentRoleEnum. */
export type AgentRole = z.infer<typeof AgentRoleEnum>;

// ── Manifest schema ─────────────────────────────────────────────────────────

const RoleSchema = z.object({
  id: z.string(),
  name: AgentRoleEnum,
  number: z.number().int().positive(),
  orchestrating: z.boolean(),
  pipeline: z.string().nullable(),
  persona_file: z.string(),
});

const PipelinesSchema = z.object({
  canonical_order: z.array(z.string()).nonempty(),
  default_stages: z.array(z.string()).nonempty(),
  prerequisites: z.record(z.string().nullable()),
  fail_routing: z.record(z.string()),
});

const StatusesSchema = z.object({
  project: z.array(z.string()).nonempty(),
  work_package: z.array(z.string()).nonempty(),
  terminal_work_package: z.array(z.string()).nonempty(),
  pipeline: z.array(z.string()).nonempty(),
  blocker_type: z.array(z.string()).nonempty(),
});

const ConstantsSchema = z.object({
  max_rework_count: z.number().int().positive(),
  stale_pipeline_hours: z.number().positive(),
  max_handoff_depth: z.number().int().positive(),
  handoff_depth_multiplier: z.number().int().positive(),
});

export const ManifestSchema = z.object({
  spec_version: z.string(),
  roles: z.array(RoleSchema).nonempty(),
  pipelines: PipelinesSchema,
  statuses: StatusesSchema,
  constants: ConstantsSchema,
});

/** Full manifest type inferred from ManifestSchema. */
export type Manifest = z.infer<typeof ManifestSchema>;

/**
 * Parsed and validated workflow manifest singleton.
 *
 * Fails fast at module load time with a descriptive Zod validation error if
 * the manifest is malformed or missing required fields.  All consumers of the
 * manifest should import this constant rather than calling createRequire
 * themselves, keeping the parsing + validation logic in one place.
 */
export const workflowManifest: Manifest = ManifestSchema.parse(
  _require('../../../shared/workflow-manifest.json'),
);

```
###  Path: `\mcp-server\src\storage/atomic-writer.ts`

```ts
import { writeFile, rename, unlink, mkdir } from 'fs/promises';
import { dirname } from 'path';

/**
 * Writes JSON data to a file atomically using the write-to-temp-then-rename pattern.
 *
 * The process:
 * 1. Write data to {filePath}.tmp.{pid}
 * 2. Use fs.rename to atomically replace the target file (POSIX semantics)
 * 3. Clean up temp file on error
 *
 * This ensures that readers never see partial writes.
 *
 * @param filePath - Absolute path to the target file
 * @param data - Data to serialize as JSON
 * @throws Error if write or rename fails
 */
export async function atomicWriteJson(
  filePath: string,
  data: unknown
): Promise<void> {
  const pid = process.pid;
  const tempPath = `${filePath}.tmp.${pid}`;

  try {
    // Ensure the parent directory exists
    const dir = dirname(filePath);
    await mkdir(dir, { recursive: true });

    // Pretty-print JSON with 2-space indentation and trailing newline
    const json = JSON.stringify(data, null, 2) + '\n';

    // Write to temp file
    await writeFile(tempPath, json, 'utf-8');

    // Atomically rename temp file to target (POSIX atomic)
    await rename(tempPath, filePath);
  } catch (error) {
    // Clean up temp file if it exists
    try {
      await unlink(tempPath);
    } catch {
      // Ignore cleanup errors (temp file may not exist)
    }

    // Re-throw original error
    throw new Error(
      `Failed to write JSON to ${filePath}: ${(error as Error).message}`
    );
  }
}

```
###  Path: `\mcp-server\src\storage/file-lock.ts`

```ts
import lockfile from 'proper-lockfile';
import { join } from 'path';
import { mkdir } from 'fs/promises';

/**
 * Lock configuration for the ledger directory.
 * - 10 second stale timeout: locks older than this are considered stale
 * - 50 retries with 200ms–1000ms backoff: retry window of 10–50s,
 *   ensuring the window always covers the stale timeout duration
 */
const LOCK_OPTIONS = {
  stale: 10000, // 10 seconds
  retries: {
    retries: 50,
    minTimeout: 200,
    maxTimeout: 1000,
  },
};

/**
 * Acquires a file lock on the project's centralized storage directory,
 * executes the callback, and releases the lock in a finally block.
 *
 * The lock file is created at {storageDir}/.lock
 *
 * @param storageDir - Absolute path to the project's storage directory
 * @param fn - Async callback to execute while holding the lock
 * @returns The return value of the callback
 * @throws Error if lock cannot be acquired after retries
 */
export async function withLock<T>(
  storageDir: string,
  fn: () => Promise<T>
): Promise<T> {
  const lockFilePath = join(storageDir, '.lock');

  // Ensure the storage directory exists
  await mkdir(storageDir, { recursive: true });

  // Acquire the lock
  let release: (() => Promise<void>) | null = null;

  try {
    // proper-lockfile expects a file path, but we want to lock a directory.
    // We create a .lock file inside storageDir for this purpose.
    // Note: proper-lockfile creates a lockfile, so we don't need to pre-create it
    release = await lockfile.lock(storageDir, {
      ...LOCK_OPTIONS,
      lockfilePath: lockFilePath,
    });

    // Execute the callback while holding the lock
    return await fn();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ELOCKED') {
      throw new Error(
        `Failed to acquire lock on ${storageDir} after ${LOCK_OPTIONS.retries.retries} retries. ` +
          `Another process may be holding the lock.`
      );
    }
    throw error;
  } finally {
    // Always release the lock, even if the callback throws
    if (release) {
      try {
        await release();
      } catch (error) {
        // Log but don't throw - we don't want to mask the original error
        console.error(
          `[file-lock] Warning: Failed to release lock on ${storageDir}:`,
          error
        );
      }
    }
  }
}

```
###  Path: `\mcp-server\src\storage/ledger-store.ts`

```ts
import { readFile, access, readdir, copyFile, rename } from 'fs/promises';
import { join } from 'path';
import { constants } from 'fs';
import { RootIndexSchema, type RootIndex } from '../schema/root-index.js';
import {
  WorkPackageDetailSchema,
  type WorkPackageDetail,
} from '../schema/work-package.js';
import { ProjectMetaSchema, type ProjectMeta } from '../schema/project-meta.js';
import { atomicWriteJson } from './atomic-writer.js';
import { withLock } from './file-lock.js';
import { resolveLedgerRoot, projectSlugFromPath, inferProjectRootFromPlanPath } from '../utils/ledger-root.js';
import { SAFE_SLUG_REGEX } from '../utils/constants.js';
import { now, parseTimestamp } from '../utils/timestamp.js';

/**
 * Thrown by `LedgerStore.renameSlug()` when the target slug directory already
 * exists on disk (i.e. the slug is taken by another project).
 */
export class SlugConflictError extends Error {
  constructor(slug: string) {
    super(`Slug already in use: "${slug}".`);
    this.name = 'SlugConflictError';
  }
}

/**
 * Central storage abstraction for ledger file I/O.
 *
 * All reads validate with Zod schemas.
 * All writes use atomic operations and file locking.
 *
 * Files are stored in the centralized ledger root at `{ledgerRoot}/{slug}/`
 * rather than inside the plan folder.
 */
export class LedgerStore {
  public readonly planPath: string;
  public readonly slug: string;
  public readonly ledgerRoot: string;
  public readonly storageDir: string;

  constructor(projectPath: string, ledgerRoot?: string) {
    this.planPath = projectPath;
    this.slug = projectSlugFromPath(projectPath);
    this.ledgerRoot = ledgerRoot ?? resolveLedgerRoot();
    this.storageDir = join(this.ledgerRoot, this.slug);
  }

  // ==================== Path Helpers ====================

  private rootIndexPath(): string {
    return join(this.storageDir, 'project-ledger.json');
  }

  private wpDetailPath(wpId: string): string {
    return join(this.storageDir, `${wpId}.json`);
  }

  private ledgerDirPath(): string {
    return this.storageDir;
  }

  metaPath(): string {
    return join(this.storageDir, '.meta.json');
  }

  // ==================== Existence Checks ====================

  async rootIndexExists(): Promise<boolean> {
    try {
      await access(this.rootIndexPath(), constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  async wpDetailExists(wpId: string): Promise<boolean> {
    try {
      await access(this.wpDetailPath(wpId), constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  async ledgerDirExists(): Promise<boolean> {
    try {
      await access(this.ledgerDirPath(), constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  // ==================== Read Methods ====================

  /**
   * Reads and validates the root index (.ledger/project-ledger.json).
   *
   * @throws Error if file does not exist, JSON is malformed, or validation fails
   */
  async readRootIndex(): Promise<RootIndex> {
    const path = this.rootIndexPath();

    try {
      const content = await readFile(path, 'utf-8');
      const data = JSON.parse(content);
      return RootIndexSchema.parse(data);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`Root index not found at ${path}`);
      }

      if (error instanceof SyntaxError) {
        throw new Error(`Malformed JSON in root index at ${path}: ${error.message}`);
      }

      // Zod validation error
      throw new Error(
        `Root index validation failed at ${path}: ${(error as Error).message}`
      );
    }
  }

  /**
   * Reads and validates a work package detail file (.ledger/WP-###.json).
   *
   * @param wpId - Work package ID (e.g., "WP-001")
   * @throws Error if file does not exist, JSON is malformed, or validation fails
   */
  async readWorkPackage(wpId: string): Promise<WorkPackageDetail> {
    const path = this.wpDetailPath(wpId);

    try {
      const content = await readFile(path, 'utf-8');
      const data = JSON.parse(content);
      const wp = WorkPackageDetailSchema.parse(data);

      // Migration: rework_count (legacy scalar) → rework_counts (per-pipeline map)
      if (wp.rework_count !== undefined && wp.rework_counts === undefined) {
        wp.rework_counts = {
          implementation: wp.rework_count,
          qa: 0,
          'code-review': 0,
          documentation: 0,
        };
        delete wp.rework_count;
      }

      return wp;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`Work package ${wpId} not found at ${path}`);
      }

      if (error instanceof SyntaxError) {
        throw new Error(
          `Malformed JSON in work package ${wpId} at ${path}: ${error.message}`
        );
      }

      // Zod validation error
      throw new Error(
        `Work package ${wpId} validation failed at ${path}: ${(error as Error).message}`
      );
    }
  }

  // ==================== Write Methods ====================

  /**
   * Writes the root index after validation and automatically syncs .meta.json.
   *
   * @internal This method should only be called from within LedgerStore sync methods
   * (`updateWorkPackageWithSync`, `createWorkPackageWithSync`, `batchUpdateWorkPackagesWithSync`)
   * or from one of the following explicitly approved direct callers that manage their own
   * lock scope and cannot route through a sync method:
   *
   *   - `project-lifecycle.ts` — `getProjectStatus()` self-healing: repairs stale counter fields
   *     under an explicit `withLock` before returning project status; also used in
   *     `initializeProject()` and `completeSynthesis()` for root-index-only transitions that
   *     don't involve any WP file writes.
   *   - `auto-archive.ts`    — GUI auto-archive: sets `status: 'ARCHIVED'` with
   *     `preserveLastUpdated: true` so the visible activity time is not distorted.
   *   - `observations.ts`    — Project-level comment append: writes only the root index
   *     (no WP file involved) after appending a project comment.
   *   - `workflow-handoff.ts` — `buildHandoffResponse()`: increments or caps the
   *     `auto_handoff_depth` counter on every handoff-status response; root-index-only
   *     write with no WP file involvement.
   *
   * All other tool functions and helpers must NOT call this directly — use a sync method
   * instead to guarantee atomic WP+root writes, schema validation, `last_updated`
   * auto-stamping, and `.meta.json` sync.
   *
   * @param data    - Root index data to write
   * @param options - Optional flags; set `preserveLastUpdated: true` for
   *                  administrative status transitions (archive / unarchive)
   *                  that must not alter the project's visible activity time.
   * @throws Error if validation fails or write fails
   */
  async writeRootIndex(data: RootIndex, options?: { preserveLastUpdated?: boolean }): Promise<void> {
    // Validate before writing
    const validated = RootIndexSchema.parse(data);

    const path = this.rootIndexPath();
    await atomicWriteJson(path, validated);
    // Auto-sync .meta.json after every root index write — include WP counters
    await this.writeProjectMeta('', validated.status, {
      total_work_packages: validated.total_work_packages,
      pending_work_packages: validated.pending_work_packages,
    }, options);
  }

  /**
   * Writes a work package detail file after validation.
   *
   * @internal This method should only be called from within LedgerStore sync methods
   * (`updateWorkPackageWithSync`, `createWorkPackageWithSync`, `batchUpdateWorkPackagesWithSync`).
   * As of the WP-002 migration (consolidate-wp-writes), `writeWorkPackage` has NO legitimate
   * external callers — every code path that previously called it directly (including
   * `project-reset.ts`) has been migrated to use a sync method. Tool functions and
   * helpers must NOT call this directly — use a sync method instead to guarantee atomic
   * WP+root writes, schema validation, `last_updated` auto-stamping, and `.meta.json` sync.
   *
   * @param wpId - Work package ID (e.g., "WP-001")
   * @param data - Work package detail data to write
   * @throws Error if validation fails or write fails
   */
  async writeWorkPackage(wpId: string, data: WorkPackageDetail): Promise<void> {
    // Validate before writing
    const validated = WorkPackageDetailSchema.parse(data);

    const path = this.wpDetailPath(wpId);
    await atomicWriteJson(path, validated);
  }

  /**
   * Updates a work package and the root index atomically within a single lock.
   *
   * This is the critical method that prevents dual-file desync bugs.
   *
   * The updater function receives both the work package detail and root index,
   * and must return updated versions of both. Both files are then written
   * atomically within the same lock.
   *
   * @param wpId - Work package ID (e.g., "WP-001")
   * @param updater - Function that transforms both WP and root index
   * @throws Error if files don't exist, validation fails, or write fails
   */
  async updateWorkPackageWithSync(
    wpId: string,
    updater: (
      wp: WorkPackageDetail,
      root: RootIndex
    ) => { wp: WorkPackageDetail; root: RootIndex } | Promise<{ wp: WorkPackageDetail; root: RootIndex }>
  ): Promise<void> {
    await withLock(this.storageDir, async () => {
      // Read both files
      const wp = await this.readWorkPackage(wpId);
      const root = await this.readRootIndex();

      // Apply the update
      const { wp: updatedWp, root: updatedRoot } = await updater(wp, root);

      // Auto-stamp last_updated on every WP write (§WP-002)
      updatedWp.last_updated = now();

      // Validate the updates
      const validatedWp = WorkPackageDetailSchema.parse(updatedWp);
      const validatedRoot = RootIndexSchema.parse(updatedRoot);

      // Write both atomically (within the same lock)
      await atomicWriteJson(this.wpDetailPath(wpId), validatedWp);
      await atomicWriteJson(this.rootIndexPath(), validatedRoot);
      // Auto-sync .meta.json inside the same lock scope — include WP counters
      await this.writeProjectMeta('', validatedRoot.status, {
        total_work_packages: validatedRoot.total_work_packages,
        pending_work_packages: validatedRoot.pending_work_packages,
      });
    });
  }

  /**
   * Creates a new work package and updates the root index atomically within a single lock.
   *
   * This is the creation-time sibling of `updateWorkPackageWithSync`. Use it when the
   * WP file does not yet exist on disk. The callback receives the current root index
   * and must return the new WP detail, the WP ID to write it under, and the updated
   * root index. Both files are then written atomically within the same lock.
   *
   * Post-write guarantees (same as `updateWorkPackageWithSync`):
   *   - `last_updated` is auto-stamped on the WP detail
   *   - Both objects are validated via their Zod schemas
   *   - `.meta.json` is synced after every successful write
   *
   * @param creator - Callback that receives the root index and returns the new WP detail,
   *                  its ID, and the updated root index
   * @throws Error if validation fails or write fails
   */
  async createWorkPackageWithSync(
    creator: (
      root: RootIndex
    ) => { wpId: string; wp: WorkPackageDetail; root: RootIndex } | Promise<{ wpId: string; wp: WorkPackageDetail; root: RootIndex }>
  ): Promise<string> {
    let createdWpId = '';
    await withLock(this.storageDir, async () => {
      // Read the current root index
      const root = await this.readRootIndex();

      // Apply the creator callback
      const { wpId, wp: newWp, root: updatedRoot } = await creator(root);
      createdWpId = wpId;

      // Auto-stamp last_updated on every WP write (matches updateWorkPackageWithSync behaviour)
      newWp.last_updated = now();

      // Validate both objects
      const validatedWp = WorkPackageDetailSchema.parse(newWp);
      const validatedRoot = RootIndexSchema.parse(updatedRoot);

      // Write both atomically (within the same lock)
      await atomicWriteJson(this.wpDetailPath(wpId), validatedWp);
      await atomicWriteJson(this.rootIndexPath(), validatedRoot);
      // Auto-sync .meta.json inside the same lock scope — include WP counters
      await this.writeProjectMeta('', validatedRoot.status, {
        total_work_packages: validatedRoot.total_work_packages,
        pending_work_packages: validatedRoot.pending_work_packages,
      });
    });
    return createdWpId;
  }

  /**
   * Updates multiple work packages and the root index atomically within a single lock.
   *
   * This is the batch-write sibling of `updateWorkPackageWithSync`. It preserves the
   * single-lock-scope semantics of the propagation helpers while routing all individual
   * WP writes through validation and auto-stamping.
   *
   * The callback receives:
   *   - `root` — the current root index (read inside the lock)
   *   - `readWp` — a helper that reads a WP detail file (also inside the lock)
   *
   * The callback must return:
   *   - `updatedWps` — a Map of WP ID → updated WorkPackageDetail for every WP that was modified
   *   - `root` — the updated root index
   *
   * For each entry in `updatedWps`:
   *   - `last_updated` is auto-stamped (overwriting any value set by the callback)
   *   - The WP is validated via `WorkPackageDetailSchema.parse()`
   *   - The WP file is written atomically
   *
   * The root index is validated via `RootIndexSchema.parse()` and written atomically.
   * `.meta.json` is synced exactly once at the end.
   *
   * @param callback - Function that reads WPs and returns modified state
   * @throws Error if files don't exist, validation fails, or write fails
   */
  async batchUpdateWorkPackagesWithSync(
    callback: (
      root: RootIndex,
      readWp: (id: string) => Promise<WorkPackageDetail>
    ) => Promise<{ updatedWps: Map<string, WorkPackageDetail>; root: RootIndex }>
  ): Promise<void> {
    await withLock(this.storageDir, async () => {
      // Read the root index inside the lock
      const root = await this.readRootIndex();

      // Provide a readWp helper bound to this store
      const readWp = (id: string) => this.readWorkPackage(id);

      // Run the callback to get the batch of updates
      const { updatedWps, root: updatedRoot } = await callback(root, readWp);

      const timestamp = now();

      // Pass 1: auto-stamp and validate every WP — collect validated objects before any write.
      // This ensures a mid-batch validation failure cannot leave some WP files updated
      // while the root index still reflects the pre-batch state (WP/root desync).
      const validatedEntries: Array<[string, WorkPackageDetail]> = [];
      for (const [wpId, wp] of updatedWps) {
        // Auto-stamp last_updated on every WP write (mirrors updateWorkPackageWithSync)
        wp.last_updated = timestamp;
        validatedEntries.push([wpId, WorkPackageDetailSchema.parse(wp)]);
      }

      // Also validate the root index before writing anything
      const validatedRoot = RootIndexSchema.parse(updatedRoot);

      // Pass 2: write all validated WPs atomically (no validation can fail from here)
      for (const [wpId, validatedWp] of validatedEntries) {
        await atomicWriteJson(this.wpDetailPath(wpId), validatedWp);
      }
      await atomicWriteJson(this.rootIndexPath(), validatedRoot);

      // Sync .meta.json exactly once after all WP writes
      await this.writeProjectMeta('', validatedRoot.status, {
        total_work_packages: validatedRoot.total_work_packages,
        pending_work_packages: validatedRoot.pending_work_packages,
      });
    });
  }

  // ==================== Meta Methods ====================

  /**
   * Creates or updates the project's .meta.json file.
   * On first write: populates all fields. On subsequent writes: updates status and last_updated
   * (unless `options.preserveLastUpdated` is true, in which case the existing value is kept).
   * Must be called within the project lock when triggered from a root-index write.
   *
   * @param planFile     - Plan file name (used only on first write; ignored on updates)
   * @param status       - Optional status override; defaults to existing status or IN_PROGRESS
   * @param cacheUpdates - Optional WP counter / enrichment fields to write into the cache
   * @param options      - Set `preserveLastUpdated: true` to retain the existing timestamp
   *                       (use for admin operations: archive, unarchive, cache refresh).
   */
  async writeProjectMeta(
    planFile: string,
    status?: string,
    cacheUpdates?: {
      total_work_packages?: number;
      pending_work_packages?: number;
      project_name?: string | null;
      repository_name?: string | null;
    },
    options?: { preserveLastUpdated?: boolean }
  ): Promise<void> {
    const path = this.metaPath();
    let existing: Partial<ProjectMeta> = {};

    try {
      const content = await readFile(path, 'utf-8');
      existing = JSON.parse(content) as Partial<ProjectMeta>;
    } catch {
      // First write — all fields will be initialised below
    }

    const timestamp = now();
    // Preserve the existing last_updated for administrative operations (archive,
    // unarchive, enrichment cache refresh) that should not distort sort order.
    const lastUpdated =
      options?.preserveLastUpdated && existing.last_updated
        ? existing.last_updated
        : timestamp;
    const meta = ProjectMetaSchema.parse({
      slug: existing.slug ?? this.slug,
      plan_path: existing.plan_path ?? this.planPath,
      status: (status ?? existing.status ?? 'IN_PROGRESS') as ProjectMeta['status'],
      date_created: existing.date_created ?? timestamp,
      last_updated: lastUpdated,
      ...(existing.title !== undefined ? { title: existing.title } : {}),
      // Preserve existing cache fields unless overridden by cacheUpdates
      ...(existing.total_work_packages !== undefined ? { total_work_packages: existing.total_work_packages } : {}),
      ...(existing.pending_work_packages !== undefined ? { pending_work_packages: existing.pending_work_packages } : {}),
      ...(existing.project_name !== undefined ? { project_name: existing.project_name } : {}),
      ...(existing.repository_name !== undefined ? { repository_name: existing.repository_name } : {}),
      // Apply overrides from cacheUpdates (undefined values skip the field)
      ...(cacheUpdates?.total_work_packages !== undefined ? { total_work_packages: cacheUpdates.total_work_packages } : {}),
      ...(cacheUpdates?.pending_work_packages !== undefined ? { pending_work_packages: cacheUpdates.pending_work_packages } : {}),
      ...(cacheUpdates !== undefined && 'project_name' in cacheUpdates ? { project_name: cacheUpdates.project_name } : {}),
      ...(cacheUpdates !== undefined && 'repository_name' in cacheUpdates ? { repository_name: cacheUpdates.repository_name } : {}),
    });

    await atomicWriteJson(path, meta);
  }

  /**
   * Reads and validates the project's .meta.json file.
   *
   * @throws Error if file does not exist, JSON is malformed, or validation fails
   */
  async readProjectMeta(): Promise<ProjectMeta> {
    const path = this.metaPath();

    try {
      const content = await readFile(path, 'utf-8');
      const data = JSON.parse(content);
      return ProjectMetaSchema.parse(data);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`Project meta not found at ${path}`);
      }
      if (error instanceof SyntaxError) {
        throw new Error(`Malformed JSON in .meta.json at ${path}: ${error.message}`);
      }
      throw new Error(
        `Project meta validation failed at ${path}: ${(error as Error).message}`
      );
    }
  }

  /**
   * Sets the user-visible display title for the project.
   * Reads the current meta, updates `title` only (preserves `last_updated`),
   * validates, and writes atomically. Returns the updated ProjectMeta.
   */
  async updateTitle(title: string): Promise<ProjectMeta> {
    const meta = await this.readProjectMeta();
    const updated: ProjectMeta = ProjectMetaSchema.parse({
      ...meta,
      title,
    });
    await atomicWriteJson(this.metaPath(), updated);
    return updated;
  }

  /**
   * Renames the ledger storage directory and updates the `slug` field in `.meta.json`.
   *
   * Algorithm:
   *   1. Validates `newSlug` against SAFE_SLUG_REGEX and the 200-char length cap.
   *   2. Guards against a same-slug no-op and a target-directory conflict.
   *   3. Calls `fs.rename(oldStorageDir, newStorageDir)` — atomic on POSIX, effectively
   *      atomic on Windows for same-drive renames.
   *   4. Reads `.meta.json` from the **new** path (old path is gone), patches `slug`,
   *      and writes back with `atomicWriteJson`. Does **not** touch `last_updated`.
   *
   * Error conditions:
   *   - `Invalid slug "…"` — pattern or length violation.
   *   - `Slug is already "…"` — same-slug no-op.
   *   - `Slug already in use: "…"` — target directory already exists.
   *
   * Lock behaviour: intentionally **not** wrapped in `withLock`. `withLock` creates
   * `.lock` inside `storageDir`; holding that lock across `fs.rename` would move the
   * lock file to the new path, causing `proper-lockfile` to fail to release at the
   * original path. The same low-concurrency reasoning that justifies `updateTitle()`
   * running lock-free applies here.
   *
   * ⚠️  After this method returns, the current `LedgerStore` instance is stale:
   * `this.storageDir` and `this.slug` still point to the old (now-deleted) directory.
   * The GUI reconstructs `LedgerStore` per-request, so this is safe in practice.
   * Do not reuse the same instance after calling `renameSlug()`.
   */
  async renameSlug(newSlug: string): Promise<ProjectMeta> {
    if (newSlug.length > 200 || !SAFE_SLUG_REGEX.test(newSlug)) {
      throw new Error(
        `Invalid slug "${newSlug}": must match ^[a-z0-9][a-z0-9-]*$ and be at most 200 characters.`
      );
    }
    if (newSlug === this.slug) {
      throw new Error(`Slug is already "${newSlug}"; no rename needed.`);
    }
    const newStorageDir = join(this.ledgerRoot, newSlug);
    try {
      await access(newStorageDir);
      // If access() resolves, the directory exists — conflict.
      throw new SlugConflictError(newSlug);
    } catch (err: unknown) {
      const nodeErr = err as NodeJS.ErrnoException;
      if (nodeErr.code !== 'ENOENT') {
        // Re-throw both our conflict error and unexpected fs errors.
        throw err;
      }
      // ENOENT means the target does not exist — safe to proceed.
    }
    await rename(this.storageDir, newStorageDir);
    const newMetaPath = join(newStorageDir, '.meta.json');
    const rawMeta = JSON.parse(await readFile(newMetaPath, 'utf-8')) as Record<string, unknown>;
    const updated: ProjectMeta = ProjectMetaSchema.parse({
      ...rawMeta,
      slug: newSlug,
    });
    await atomicWriteJson(newMetaPath, updated);
    // NOTE: this instance is no longer valid after this return — see JSDoc above.
    return updated;
  }

  // ==================== Archive Methods ====================

  /**
   * Copies named Markdown files from the plan folder to the ledger storage directory.
   *
   * Missing source files (`ENOENT`) are silently skipped with a warning to stderr.
   * Any other I/O error (e.g. `EACCES`, `ENOSPC`, `EISDIR`) is **re-thrown** so
   * the caller can observe the failure rather than receiving a silent partial result.
   *
   * The storageDir is expected to already exist (created by initializeProject).
   *
   * @param filenames - Array of filenames (relative to planPath) to archive
   * @returns Object with arrays of archived and skipped filenames
   * @throws {NodeJS.ErrnoException} For any non-ENOENT filesystem error
   */
  async archiveDocuments(filenames: string[]): Promise<{ archived: string[]; skipped: string[] }> {
    const archived: string[] = [];
    const skipped: string[] = [];

    for (const filename of filenames) {
      const src = join(this.planPath, filename);
      const dest = join(this.storageDir, filename);
      try {
        await copyFile(src, dest);
        archived.push(filename);
      } catch (err: unknown) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') {
          console.error(`[project-ledger-mcp] Archive skipped (source not found): ${src}`);
          skipped.push(filename);
        } else {
          throw err; // unexpected I/O error — do not silently swallow
        }
      }
    }

    return { archived, skipped };
  }

  /**
   * Scans the central ledger root and returns metadata for all projects.
   * Skips .archive/ and any entry where .meta.json is absent or invalid.
   *
   * @param ledgerRoot - Optional override; defaults to resolveLedgerRoot()
   */
  static async listAllProjects(ledgerRoot?: string): Promise<ProjectMeta[]> {
    const root = ledgerRoot ?? resolveLedgerRoot();
    let dirents: import('fs').Dirent[];

    try {
      dirents = await readdir(root, { withFileTypes: true });
    } catch {
      return [];
    }

    const results: ProjectMeta[] = [];

    for (const dirent of dirents) {
      const entry = dirent.name;

      // Skip non-directory entries (e.g. gui-config.json sitting at the ledger root).
      if (!dirent.isDirectory()) continue;

      // Skip the dedicated archive directory (dot-prefix convention keeps it out of
      // normal enumeration).  Any directory whose name starts with '.' is treated
      // as a control directory — NOT as a project slug — so this filter must
      // remain a starts-with('.') check rather than an exact equality check.
      // Changing it to include normal slugs that happen to start with a dot would
      // break archive isolation.
      if (entry.startsWith('.')) continue;

      const metaFile = join(root, entry, '.meta.json');
      try {
        const content = await readFile(metaFile, 'utf-8');
        const data = JSON.parse(content);
        const meta = ProjectMetaSchema.parse(data);
        results.push(meta);
      } catch (err) {
        process.stderr.write(
          `[LedgerStore.listAllProjects] Skipping "${entry}": ${(err as Error).message}\n`
        );
      }
    }

    return results;
  }

  /**
   * Scans all known projects and returns the one whose project root is an
   * ancestor of (or equal to) `cwdPath`.
   *
   * Matching rules:
   *   - The project root is derived by calling inferProjectRootFromPlanPath on
   *     each project's plan_path (4 levels up from the plan folder).
   *   - normalizedCwd starts with normalizedProjectRoot + '/' → project root is an ancestor
   *   - normalizedCwd === normalizedProjectRoot → exact match at project root
   *   - Parent paths of the project root do NOT match (no upward traversal).
   *   - Path comparison is case-insensitive on Windows.
   *
   * @param cwdPath   - Absolute path the agent is working from
   * @param ledgerRoot - Optional override; defaults to resolveLedgerRoot()
   */
  static async detectProjectByCwd(
    cwdPath: string,
    ledgerRoot?: string
  ): Promise<DetectProjectResult> {
    const projects = await LedgerStore.listAllProjects(ledgerRoot);

    // Normalize a path: forward slashes, lowercase on Windows
    function normalizePath(p: string): string {
      const fwd = p.replace(/\\/g, '/');
      return process.platform === 'win32' ? fwd.toLowerCase() : fwd;
    }

    const normalizedCwd = normalizePath(cwdPath);

    const matches: ProjectMeta[] = [];
    for (const meta of projects) {
      const projectRoot = inferProjectRootFromPlanPath(meta.plan_path);
      const normalizedRoot = normalizePath(projectRoot);

      if (
        normalizedCwd === normalizedRoot ||
        normalizedCwd.startsWith(normalizedRoot + '/')
      ) {
        // Skip archived projects — agents should not accidentally work on them
        if (meta.status === 'ARCHIVED') continue;
        matches.push(meta);
      }
    }

    if (matches.length === 1) {
      return { status: 'FOUND', meta: matches[0]! };
    }

    if (matches.length > 1) {
      // Sort by last_updated descending (most recently active first) and cap the list.
      const sorted = [...matches].sort((a, b) =>
        b.last_updated.localeCompare(a.last_updated)
      );
      const capped = sorted.slice(0, MAX_CANDIDATES);

      // Split into "best" and "unlikely" at the first gap larger than the threshold.
      let splitIndex = capped.length; // default: all are best
      for (let i = 0; i < capped.length - 1; i++) {
        const curr = parseTimestamp(capped[i]!.last_updated).getTime();
        const next = parseTimestamp(capped[i + 1]!.last_updated).getTime();
        if (curr - next > AMBIGUOUS_GAP_THRESHOLD_MS) {
          splitIndex = i + 1;
          break;
        }
      }

      const best = capped.slice(0, splitIndex);
      const unlikely = capped.slice(splitIndex);

      // Single clear best match — treat it as unambiguous.
      if (best.length === 1) {
        return { status: 'FOUND', meta: best[0]! };
      }

      return { status: 'AMBIGUOUS', best, unlikely };
    }

    return { status: 'NOT_FOUND' };
  }
}

// ==================== Constants for detectProjectByCwd ====================

/** Maximum number of candidates returned in an AMBIGUOUS result. */
const MAX_CANDIDATES = 8;

/**
 * Minimum time gap (ms) between consecutive candidates that causes everything
 * after the gap to be classified as "unlikely".  Defaults to 6 hours.
 */
const AMBIGUOUS_GAP_THRESHOLD_MS = 6 * 60 * 60 * 1000;

// ==================== Result Types for detectProjectByCwd ====================

export type DetectProjectResult =
  | { status: 'FOUND'; meta: ProjectMeta }
  | { status: 'NOT_FOUND' }
  | { status: 'AMBIGUOUS'; best: ProjectMeta[]; unlikely: ProjectMeta[] };

```
---
**File Statistics**
- **Size**: 51.93 KB
- **Lines**: 1431
File: `mcp-server/source-storage.md`
