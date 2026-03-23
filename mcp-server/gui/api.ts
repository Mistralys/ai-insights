/**
 * GUI API Route Handlers
 *
 * Pure async functions — one per REST endpoint. Each handler accepts parsed
 * request parameters and returns a result object (or throws a structured error).
 * The HTTP server (gui/server.ts) calls these handlers and maps results to HTTP
 * responses.
 *
 * Error shape:  { code: string, message: string, details?: unknown }
 *   NOT_FOUND        → 404
 *   FORBIDDEN        → 403
 *   VALIDATION_ERROR → 400
 *   (unhandled)      → 500
 *
 * STDIO discipline: this file never writes to process.stdout.
 */

import { rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { LedgerStore, SlugConflictError } from '../src/storage/ledger-store.js';
import { withLock } from '../src/storage/file-lock.js';
import { inferProjectRootFromPlanPath } from '../src/utils/ledger-root.js';
import { readProjectName } from '../src/utils/read-project-name.js';
import { PLAN_ARCHIVE_FILENAME, SYNTHESIS_ARCHIVE_FILENAME, SAFE_SLUG_REGEX } from '../src/utils/constants.js';
import {
  PIPELINE_AGENT_MAP,
  DEFAULT_PIPELINE_STAGES,
  CANONICAL_PIPELINE_ORDERING,
} from '../src/utils/pipeline-maps.js';
import type { PipelineType } from '../src/utils/pipeline-maps.js';
import type { ProjectMeta } from '../src/schema/project-meta.js';
import type { ProjectStatus, WorkPackageStatus } from '../src/schema/enums.js';
import type { RootIndex } from '../src/schema/root-index.js';
import type { IncidentContext, WorkPackageDetail } from '../src/schema/work-package.js';

/**
 * Extended WP detail response that includes the server's canonical default pipeline stages.
 * The extra field is additive — all existing fields of WorkPackageDetail are preserved.
 */
export type WorkPackageDetailResponse = WorkPackageDetail & {
  default_pipeline_stages: string[];
};
import { getConfig, writeConfig, GuiConfigPartialSchema } from '../src/gui/config.js';
import type { GuiConfig } from '../src/gui/config.js';
import {
  analyzeProjectForReset,
  applyProjectReset,
  getPassedStages,
  markProjectComplete,
} from '../src/utils/project-reset.js';
import type {
  WpDecision,
  ProjectResetDiagnosis,
  ProjectResetResult,
  MarkProjectCompleteResult,
} from '../src/utils/project-reset.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Structured error thrown by all API handlers. */
export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function notFound(message: string): never {
  throw new ApiError('NOT_FOUND', message);
}

function forbidden(message: string): never {
  throw new ApiError('FORBIDDEN', message);
}

function conflict(message: string): never {
  throw new ApiError('CONFLICT', message);
}

function validationError(message: string, details?: unknown): never {
  throw new ApiError('VALIDATION_ERROR', message, details);
}

/**
 * Guards against path-traversal attacks on the project slug URL parameter.
 *
 * Throws a NOT_FOUND (404) error for any slug that is empty, contains a
 * forward-slash, or contains a `..` component — all of which could otherwise
 * be used to escape the ledger root directory.
 *
 * @param slug - The raw slug string extracted from the request URL.
 */
function assertSafeSlug(slug: string): void {
  if (!slug || slug.includes('/') || slug.includes('..')) {
    notFound(`Invalid project slug: '${slug}'.`);
  }
}

/**
 * Guards against path-traversal attacks on the work-package ID URL parameter.
 *
 * Throws a NOT_FOUND (404) error for any wpId that is empty, contains a
 * forward-slash, or contains a `..` component — all of which could otherwise
 * be used to escape the project ledger directory.
 *
 * @param wpId - The raw work-package ID string extracted from the request URL.
 */
function assertSafeWpId(wpId: string): void {
  if (!wpId || wpId.includes('/') || wpId.includes('..')) {
    notFound(`Invalid work-package ID: '${wpId}'.`);
  }
}

// ---------------------------------------------------------------------------
// GET /api/insights
// ---------------------------------------------------------------------------

export interface InsightEntry {
  project_slug: string;
  project_status: ProjectStatus;
  type: string;
  priority: 'low' | 'medium' | 'high';
  timestamp: string;
  agent: string;
  note: string;
  context?: IncidentContext;
}

/**
 * Aggregates all project_comments from every project ledger into a single
 * flat array, sorted by timestamp descending (newest first).
 * Per-project read failures are logged to stderr and skipped gracefully.
 * Returns an empty array when no projects exist or no comments are found.
 */
export async function handleGetInsights(ledgerRoot: string): Promise<InsightEntry[]> {
  const projects = await LedgerStore.listAllProjects(ledgerRoot);

  const entries: InsightEntry[] = [];

  await Promise.all(
    projects.map(async (meta) => {
      const store = new LedgerStore(meta.slug, ledgerRoot);
      let rootIndex;
      try {
        rootIndex = await store.readRootIndex();
      } catch (err) {
        process.stderr.write(
          `[handleGetInsights] Skipping project "${meta.slug}": ${String(err)}\n`
        );
        return;
      }

      const comments = rootIndex.project_comments;
      if (!comments || comments.length === 0) return;

      for (const comment of comments) {
        entries.push({
          project_slug: meta.slug,
          project_status: meta.status,
          ...comment,
        });
      }
    })
  );

  // Sort by timestamp descending (newest first)
  entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  return entries;
}

// ---------------------------------------------------------------------------
// GET /api/projects
// ---------------------------------------------------------------------------

export interface ProjectSummary extends ProjectMeta {
  total_work_packages: number;
  pending_work_packages: number;
  project_name: string | null;
  repository_name: string | null;
}

/** Fields that the project list can be sorted by. */
export type ProjectSortField =
  | 'project'
  | 'repository'
  | 'status'
  | 'total_work_packages'
  | 'done'
  | 'date_created'
  | 'last_updated'
  | 'runner';

/** Raw query parameters accepted by GET /api/projects. */
export interface ProjectListParams {
  page?: number | string;
  limit?: number | string;
  /** 'ACTIVE' (default), 'ALL', or a specific ProjectStatus value. */
  status?: string;
  /** Case-insensitive substring match on slug, project_name, repository_name. */
  search?: string;
  /** Sort column. Defaults to 'last_updated'. */
  sort?: string;
  /** 'asc' or 'desc'. Defaults to 'desc'. */
  dir?: string;
  /** Normalized runner filter ('orchestrator', 'vscode', 'claude-code', 'unknown'). Unrecognized values return empty results without a 500. */
  runner?: string;
}

/** Paginated response envelope returned by handleListProjects. */
export interface ProjectListEnvelope {
  projects: ProjectSummary[];
  total: number;
  page: number;
  limit: number;
  total_pages: number;
  /** Per-status counts computed from the search-filtered set (before status filter). */
  status_counts: Record<string, number>;
  /** Per-runner counts computed from the search-filtered set (before runner filter). 'unknown' for projects without a stored runner field. */
  runner_counts: Record<string, number>;
}

const SORT_FIELDS = new Set<ProjectSortField>([
  'project',
  'repository',
  'status',
  'total_work_packages',
  'done',
  'date_created',
  'last_updated',
  'runner',
]);

const VALID_STATUS_FILTERS = new Set([
  'ACTIVE', 'ALL', 'READY', 'IN_PROGRESS', 'COMPLETE', 'BLOCKED', 'ARCHIVED', 'CANCELLED',
]);

/**
 * Returns a paginated envelope of enriched project summaries.
 *
 * Processing pipeline:
 *  1. Enrich all projects (cache fast-path from .meta.json when available).
 *  2. Apply search filter to the full list.
 *  3. Compute status_counts from the search-filtered set (before status filter).
 *  4. Apply status filter.
 *  5. Sort.
 *  6. Paginate (slice) and return the envelope.
 *
 * project_name resolution order: manifest file → slug date-strip fallback →
 * meta.title (takes precedence when set).
 * Per-project read failures are isolated so one bad project never breaks
 * the entire response.
 */
export async function handleListProjects(
  ledgerRoot: string,
  rawParams: ProjectListParams = {}
): Promise<ProjectListEnvelope> {
  // --- Validate and sanitise params ---
  const page = Math.max(1, Math.floor(Number(rawParams.page) || 1));
  const limitRaw = rawParams.limit !== undefined ? Math.floor(Number(rawParams.limit)) : 50;
  const limit = Math.min(200, Math.max(1, isNaN(limitRaw) ? 50 : limitRaw));
  const statusFilter =
    rawParams.status !== undefined && VALID_STATUS_FILTERS.has(rawParams.status)
      ? rawParams.status
      : 'ACTIVE';
  const search = (rawParams.search ?? '').trim();
  const sortRaw = rawParams.sort ?? '';
  const sort: ProjectSortField = SORT_FIELDS.has(sortRaw as ProjectSortField)
    ? (sortRaw as ProjectSortField)
    : 'last_updated';
  const dir: 'asc' | 'desc' = rawParams.dir === 'asc' ? 'asc' : 'desc';
  // runner filter — undefined means no filter; any string value (including unrecognized ones) is accepted
  // so that unrecognized runners return an empty set rather than a 500 error.
  const runnerFilter: string | undefined = rawParams.runner;

  const allProjects = await LedgerStore.listAllProjects(ledgerRoot);

  // --- Enrich all projects ---
  const enrichedAll = await Promise.all(
    allProjects.map(async (meta): Promise<ProjectSummary> => {
      let total_work_packages = 0;
      let pending_work_packages = 0;
      let project_name: string | null = null;

      const projectRoot = inferProjectRootFromPlanPath(meta.plan_path);

      // Derive project name from slug first — takes precedence over any repo
      // manifest file (package.json etc.), which would return the repository
      // name rather than the individual plan's name. Strips the YYYY-MM-DD-
      // date prefix and title-cases the remainder, e.g.
      // "2026-02-27-gui-enhancements" → "Gui Enhancements".
      const slugMatch = meta.slug.match(/^\d{4}-\d{2}-\d{2}-(.+)$/);
      if (slugMatch) {
        project_name = slugMatch[1]
          .split('-')
          .map((w) => (w.length > 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
          .join(' ');
      }

      // FAST PATH: use cached enrichment values from .meta.json when available.
      // Falls back to I/O-based enrichment for legacy meta files that pre-date
      // the enrichment cache (WP-006). The cached project_name is only used
      // when slug derivation produced no name (non-date-prefixed slugs).
      if (
        meta.total_work_packages !== undefined &&
        meta.project_name !== undefined
      ) {
        total_work_packages = meta.total_work_packages;
        pending_work_packages = meta.pending_work_packages ?? 0;
        if (project_name === null) {
          project_name = meta.project_name;
        }
      } else {
        const store = new LedgerStore(meta.slug, ledgerRoot);

        await Promise.all([
          (async () => {
            try {
              const rootIndex = await store.readRootIndex();
              total_work_packages = rootIndex.total_work_packages ?? 0;
              pending_work_packages = rootIndex.pending_work_packages ?? 0;
            } catch {
              // default to 0
            }
          })(),
          (async () => {
            // Only read the repo manifest when slug derivation produced no name.
            if (project_name === null) {
              project_name = await readProjectName(projectRoot);
            }
          })(),
        ]);
      }

      // Persisted title takes precedence over all auto-detected names.
      if (meta.title && meta.title.trim().length > 0) {
        project_name = meta.title;
      }

      // Derive repository_name from the project root directory name.
      const repository_name = projectRoot
        ? (projectRoot.split(/[\\/]/).filter(Boolean).pop() ?? null)
        : null;

      return {
        ...meta,
        // Normalize runner: projects without a stored runner field default to 'unknown'
        // for consistent filtering and display.
        runner: meta.runner ?? 'unknown',
        total_work_packages,
        pending_work_packages,
        project_name,
        repository_name,
      };
    })
  );

  // --- Step 2: Search filter (applied to full list, before status filter) ---
  const searchLower = search.toLowerCase();
  const searchFiltered = searchLower
    ? enrichedAll.filter(
        (p) =>
          p.slug.toLowerCase().includes(searchLower) ||
          (p.project_name ?? '').toLowerCase().includes(searchLower) ||
          (p.repository_name ?? '').toLowerCase().includes(searchLower)
      )
    : enrichedAll;

  // --- Step 3: Compute status_counts and runner_counts from search-filtered set (before status/runner filter) ---
  const status_counts: Record<string, number> = {};
  const runner_counts: Record<string, number> = {};
  for (const p of searchFiltered) {
    status_counts[p.status] = (status_counts[p.status] ?? 0) + 1;
    const r = p.runner ?? 'unknown';
    runner_counts[r] = (runner_counts[r] ?? 0) + 1;
  }

  // --- Step 4a: Status filter ---
  const statusFiltered =
    statusFilter === 'ALL'
      ? searchFiltered
      : statusFilter === 'ACTIVE'
        ? searchFiltered.filter((p) => p.status !== 'ARCHIVED')
        : searchFiltered.filter((p) => p.status === statusFilter);

  // --- Step 4b: Runner filter (applied after status filter; unrecognized values return empty set) ---
  const filtered =
    runnerFilter !== undefined
      ? statusFiltered.filter((p) => (p.runner ?? 'unknown') === runnerFilter)
      : statusFiltered;

  // --- Step 5: Sort ---
  const sorted = [...filtered].sort((a, b) => {
    let aVal: string | number;
    let bVal: string | number;
    switch (sort) {
      case 'project':
        aVal = (a.project_name ?? a.slug).toLowerCase();
        bVal = (b.project_name ?? b.slug).toLowerCase();
        break;
      case 'repository':
        aVal = (a.repository_name ?? '').toLowerCase();
        bVal = (b.repository_name ?? '').toLowerCase();
        break;
      case 'status':
        aVal = a.status;
        bVal = b.status;
        break;
      case 'total_work_packages':
        aVal = a.total_work_packages;
        bVal = b.total_work_packages;
        break;
      case 'done':
        aVal = a.total_work_packages - a.pending_work_packages;
        bVal = b.total_work_packages - b.pending_work_packages;
        break;
      case 'date_created':
        aVal = a.date_created ?? '';
        bVal = b.date_created ?? '';
        break;
      case 'runner':
        aVal = (a.runner ?? 'unknown').toLowerCase();
        bVal = (b.runner ?? 'unknown').toLowerCase();
        break;
      case 'last_updated':
      default:
        aVal = a.last_updated ?? '';
        bVal = b.last_updated ?? '';
        break;
    }
    if (aVal < bVal) return dir === 'asc' ? -1 : 1;
    if (aVal > bVal) return dir === 'asc' ? 1 : -1;
    return 0;
  });

  // --- Step 6: Paginate ---
  const total = sorted.length;
  const total_pages = Math.max(1, Math.ceil(total / limit));
  const start = (page - 1) * limit;
  const pageSlice = sorted.slice(start, start + limit);

  return {
    projects: pageSlice,
    total,
    page,
    limit,
    total_pages,
    status_counts,
    runner_counts,
  };
}

// ---------------------------------------------------------------------------
// GET /api/projects/:slug
// ---------------------------------------------------------------------------

export type ProjectDetail = RootIndex & {
  meta: ProjectMeta;
  project_name: string | null;
  timing?: {
    project_elapsed_ms: number | null;
    total_active_ms: number;
    pipeline_runs: number;
  };
};

/**
 * Returns the combined root index + meta for a project.
 * Throws NOT_FOUND if the project slug does not exist in the ledger.
 * project_name resolution order: manifest file → slug date-strip fallback →
 * meta.title (takes precedence when set).
 */
export async function handleGetProject(
  ledgerRoot: string,
  slug: string
): Promise<ProjectDetail> {
  assertSafeSlug(slug);
  const store = new LedgerStore(slug, ledgerRoot);

  if (!(await store.ledgerDirExists())) {
    notFound(`Project '${slug}' not found.`);
  }

  try {
    const [rootIndex, meta] = await Promise.all([
      store.readRootIndex(),
      store.readProjectMeta(),
    ]);

    // Resolve project_name using the same logic as handleListProjects:
    // slug derivation first, repo manifest only as a last resort.
    let project_name: string | null = null;

    const slugMatch = slug.match(/^\d{4}-\d{2}-\d{2}-(.+)$/);
    if (slugMatch) {
      project_name = slugMatch[1]
        .split('-')
        .map((w) => (w.length > 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
        .join(' ');
    }

    if (project_name === null) {
      const projectRoot = inferProjectRootFromPlanPath(meta.plan_path);
      project_name = await readProjectName(projectRoot);
    }

    if (meta.title && meta.title.trim().length > 0) {
      project_name = meta.title;
    }

    // Compute timing: sum duration_ms across all WP pipelines
    const wpDetails = (
      await Promise.all(
        rootIndex.work_packages.map(async (wpSummary) => {
          try {
            return await store.readWorkPackage(wpSummary.work_package_id);
          } catch {
            return null;
          }
        })
      )
    ).filter((wp): wp is WorkPackageDetail => wp !== null);

    let total_active_ms = 0;
    let pipeline_runs = 0;
    for (const wp of wpDetails) {
      for (const p of wp.pipelines) {
        if (p.duration_ms != null) {
          total_active_ms += p.duration_ms;
          pipeline_runs++;
        }
      }
    }
    const createdAt = meta.date_created ? new Date(meta.date_created).getTime() : NaN;
    const updatedAt = meta.last_updated ? new Date(meta.last_updated).getTime() : NaN;
    const project_elapsed_ms = (!isNaN(createdAt) && !isNaN(updatedAt)) ? updatedAt - createdAt : null;

    const timing = { project_elapsed_ms, total_active_ms, pipeline_runs };
    return { ...rootIndex, meta, project_name, timing };
  } catch (err) {
    if (err instanceof ApiError) throw err;
    notFound(`Project '${slug}' not found or corrupted: ${String(err)}`);
  }
}

// ---------------------------------------------------------------------------
// GET /api/projects/:slug/work-packages
// ---------------------------------------------------------------------------

/**
 * Returns the WP summary array from the project's root index.
 * Throws NOT_FOUND if the project does not exist.
 */
export async function handleListWorkPackages(
  ledgerRoot: string,
  slug: string
): Promise<RootIndex['work_packages']> {
  assertSafeSlug(slug);
  const store = new LedgerStore(slug, ledgerRoot);

  if (!(await store.ledgerDirExists())) {
    notFound(`Project '${slug}' not found.`);
  }

  try {
    const rootIndex = await store.readRootIndex();
    return rootIndex.work_packages;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    notFound(`Project '${slug}' not found or corrupted: ${String(err)}`);
  }
}

// ---------------------------------------------------------------------------
// GET /api/projects/:slug/work-packages/:wpId
// ---------------------------------------------------------------------------

/**
 * Returns the full WP detail for the given WP ID.
 * Throws NOT_FOUND if the project or WP does not exist.
 */
export async function handleGetWorkPackage(
  ledgerRoot: string,
  slug: string,
  wpId: string
): Promise<WorkPackageDetailResponse> {
  assertSafeSlug(slug);
  assertSafeWpId(wpId);
  const store = new LedgerStore(slug, ledgerRoot);

  if (!(await store.ledgerDirExists())) {
    notFound(`Project '${slug}' not found.`);
  }

  if (!(await store.wpDetailExists(wpId))) {
    notFound(`Work package '${wpId}' not found in project '${slug}'.`);
  }

  try {
    const wp = await store.readWorkPackage(wpId);
    return { ...wp, default_pipeline_stages: [...DEFAULT_PIPELINE_STAGES] };
  } catch (err) {
    if (err instanceof ApiError) throw err;
    notFound(`Work package '${wpId}' not found or corrupted: ${String(err)}`);
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/projects/:slug
// ---------------------------------------------------------------------------

export type DeleteProjectResult = { deleted: true; slug: string };

/**
 * Permanently removes the project's ledger directory.
 * Only COMPLETE projects may be deleted.
 * Throws FORBIDDEN if the project is not COMPLETE.
 * Throws NOT_FOUND if the project does not exist.
 */
export async function handleDeleteProject(
  ledgerRoot: string,
  slug: string
): Promise<DeleteProjectResult> {
  assertSafeSlug(slug);
  const store = new LedgerStore(slug, ledgerRoot);

  if (!(await store.ledgerDirExists())) {
    notFound(`Project '${slug}' not found.`);
  }

  let meta: ProjectMeta;
  try {
    meta = await store.readProjectMeta();
  } catch {
    notFound(`Project '${slug}' not found or has no metadata.`);
  }

  // TypeScript: meta is always assigned here because the catch above throws via notFound()
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  if (!['COMPLETE', 'ARCHIVED'].includes(meta!.status)) {
    forbidden('Only COMPLETE or ARCHIVED projects can be deleted.');
  }

  const projectDir = join(ledgerRoot, slug);
  await rm(projectDir, { recursive: true, force: true });

  return { deleted: true, slug };
}

// ---------------------------------------------------------------------------
// POST /api/projects/:slug/archive
// ---------------------------------------------------------------------------

export type ArchiveProjectResult = { archived: true; slug: string };

/**
 * Transitions a COMPLETE project to ARCHIVED status.
 * Updates both .meta.json and project-ledger.json within a single lock scope.
 * Throws NOT_FOUND if the project does not exist.
 * Throws VALIDATION_ERROR if the project is not in COMPLETE status.
 */
export async function handleArchiveProject(
  ledgerRoot: string,
  slug: string
): Promise<ArchiveProjectResult> {
  assertSafeSlug(slug);
  const store = new LedgerStore(slug, ledgerRoot);

  if (!(await store.ledgerDirExists())) {
    notFound(`Project '${slug}' not found.`);
  }

  let meta: ProjectMeta;
  try {
    meta = await store.readProjectMeta();
  } catch {
    notFound(`Project '${slug}' not found or has no metadata.`);
  }

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  if (meta!.status !== 'COMPLETE') {
    validationError(`Cannot archive project '${slug}': status is '${meta!.status}', expected 'COMPLETE'.`);
  }

  await withLock(store.storageDir, async () => {
    const rootIndex = await store.readRootIndex();
    // Archiving is an administrative action — preserve last_updated so the
    // project's visible activity time is not distorted.
    await store.writeRootIndex({ ...rootIndex, status: 'ARCHIVED' }, { preserveLastUpdated: true });
  });

  return { archived: true, slug };
}

// ---------------------------------------------------------------------------
// POST /api/projects/:slug/unarchive
// ---------------------------------------------------------------------------

export type UnarchiveProjectResult = { unarchived: true; slug: string };

/**
 * Transitions an ARCHIVED project back to COMPLETE status.
 * Updates both .meta.json and project-ledger.json within a single lock scope.
 * Throws NOT_FOUND if the project does not exist.
 * Throws VALIDATION_ERROR if the project is not in ARCHIVED status.
 */
export async function handleUnarchiveProject(
  ledgerRoot: string,
  slug: string
): Promise<UnarchiveProjectResult> {
  assertSafeSlug(slug);
  const store = new LedgerStore(slug, ledgerRoot);

  if (!(await store.ledgerDirExists())) {
    notFound(`Project '${slug}' not found.`);
  }

  let meta: ProjectMeta;
  try {
    meta = await store.readProjectMeta();
  } catch {
    notFound(`Project '${slug}' not found or has no metadata.`);
  }

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  if (meta!.status !== 'ARCHIVED') {
    validationError(`Cannot unarchive project '${slug}': status is '${meta!.status}', expected 'ARCHIVED'.`);
  }

  await withLock(store.storageDir, async () => {
    const rootIndex = await store.readRootIndex();
    // Unarchiving is an administrative action — preserve last_updated so the
    // project's visible activity time is not distorted.
    await store.writeRootIndex({ ...rootIndex, status: 'COMPLETE' }, { preserveLastUpdated: true });
  });

  return { unarchived: true, slug };
}

// ---------------------------------------------------------------------------
// POST /api/projects/:slug/complete
// ---------------------------------------------------------------------------

/**
 * Forces every non-CANCELLED work package and the project to COMPLETE status.
 *
 * Throws NOT_FOUND  if the project does not exist.
 * Throws FORBIDDEN  if the project is currently ARCHIVED (unarchive first).
 *
 * STDIO discipline: this function never writes to process.stdout.
 */
export async function handleMarkProjectComplete(
  ledgerRoot: string,
  slug: string
): Promise<MarkProjectCompleteResult> {
  assertSafeSlug(slug);
  const store = new LedgerStore(slug, ledgerRoot);

  if (!(await store.ledgerDirExists())) {
    notFound(`Project '${slug}' not found.`);
  }

  let rootIndex: RootIndex;
  try {
    rootIndex = await store.readRootIndex();
  } catch (err) {
    notFound(`Project '${slug}' not found or corrupted: ${String(err)}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  if (rootIndex!.status === 'ARCHIVED') {
    forbidden('Cannot mark an archived project as complete. Unarchive it first.');
  }

  return markProjectComplete(store, slug);
}

// ---------------------------------------------------------------------------
// GET /api/projects/:slug/plan
// ---------------------------------------------------------------------------

/**
 * Returns the content of the archived plan.md for a project.
 * Throws NOT_FOUND if the project does not exist or has no archived plan.
 */
export async function handleGetPlanDocument(
  ledgerRoot: string,
  slug: string
): Promise<{ content: string }> {
  assertSafeSlug(slug);
  const store = new LedgerStore(slug, ledgerRoot);
  if (!(await store.ledgerDirExists())) {
    notFound(`Project '${slug}' not found.`);
  }

  try {
    const planContent = await readFile(join(ledgerRoot, slug, PLAN_ARCHIVE_FILENAME), 'utf-8');
    return { content: planContent };
  } catch {
    notFound(`Plan document not found for project '${slug}'.`);
  }
}

// ---------------------------------------------------------------------------
// GET /api/projects/:slug/synthesis
// ---------------------------------------------------------------------------

/**
 * Returns the content of the archived synthesis.md for a project.
 * Throws NOT_FOUND if the project does not exist or has no archived synthesis.
 */
export async function handleGetSynthesisDocument(
  ledgerRoot: string,
  slug: string
): Promise<{ content: string }> {
  assertSafeSlug(slug);
  const store = new LedgerStore(slug, ledgerRoot);
  if (!(await store.ledgerDirExists())) {
    notFound(`Project '${slug}' not found.`);
  }

  try {
    const synthesisContent = await readFile(
      join(ledgerRoot, slug, SYNTHESIS_ARCHIVE_FILENAME),
      'utf-8'
    );
    return { content: synthesisContent };
  } catch {
    notFound(`Synthesis document not found for project '${slug}'.`);
  }
}

// ---------------------------------------------------------------------------
// GET /api/config
// ---------------------------------------------------------------------------

/**
 * Returns the current in-memory GUI config.
 * Never reads from disk — uses the cached value from the config module.
 */
export async function handleGetConfig(_configPath: string): Promise<GuiConfig> {
  return getConfig();
}

// ---------------------------------------------------------------------------
// PUT /api/config
// ---------------------------------------------------------------------------

/**
 * Validates and persists an incoming config update.
 * Strips ledger_root from the body (read-only).
 * Throws VALIDATION_ERROR if the body fails Zod validation.
 * Returns the updated full config.
 */
export async function handleUpdateConfig(
  configPath: string,
  body: unknown
): Promise<GuiConfig> {
  // Validate with the partial schema (ledger_root stripped by schema omission)
  const parseResult = GuiConfigPartialSchema.safeParse(body);
  if (!parseResult.success) {
    validationError('Invalid config values.', parseResult.error.issues);
  }

  return writeConfig(configPath, parseResult.data);
}

// ---------------------------------------------------------------------------
// POST /api/projects/:slug/reset
// ---------------------------------------------------------------------------

/**
 * Zod schema for the reset request body.
 */
const WpDecisionSchema = z.object({
  action: z.enum(['reset', 'skip', 'cancel']),
  reset_criteria: z.boolean().optional(),
});

const ResetRequestSchema = z.object({
  dry_run: z.boolean(),
  decisions: z.record(z.string(), WpDecisionSchema).optional(),
});

/**
 * Handles project reset: analyze (dry_run=true) or apply (dry_run=false).
 *
 * - dry_run=true: Returns diagnosis with per-WP analysis and suggested actions.
 * - dry_run=false: Requires `decisions` map. Applies per-WP reset/skip/cancel.
 *
 * Throws NOT_FOUND if the project does not exist.
 * Throws VALIDATION_ERROR if the request body is invalid.
 */
export async function handleResetProject(
  ledgerRoot: string,
  slug: string,
  body: unknown
): Promise<ProjectResetDiagnosis | ProjectResetResult> {
  assertSafeSlug(slug);

  // Validate body
  const parseResult = ResetRequestSchema.safeParse(body);
  if (!parseResult.success) {
    validationError('Invalid reset request body.', parseResult.error.issues);
  }
  const { dry_run, decisions } = parseResult.data;

  const store = new LedgerStore(slug, ledgerRoot);

  if (!(await store.ledgerDirExists())) {
    notFound(`Project '${slug}' not found.`);
  }

  // Read root index and all WP details
  let rootIndex: RootIndex;
  try {
    rootIndex = await store.readRootIndex();
  } catch (err) {
    notFound(`Project '${slug}' not found or corrupted: ${String(err)}`);
  }

  const wpDetails: WorkPackageDetail[] = [];
  for (const wpSummary of rootIndex.work_packages) {
    try {
      const wp = await store.readWorkPackage(wpSummary.work_package_id);
      wpDetails.push(wp);
    } catch (err) {
      process.stderr.write(
        `[handleResetProject] Skipping WP "${wpSummary.work_package_id}": ${String(err)}\n`
      );
    }
  }

  // Analyze
  const diagnosis = analyzeProjectForReset(slug, rootIndex, wpDetails);

  if (dry_run) {
    return diagnosis;
  }

  // Apply mode — decisions are required
  if (!decisions || Object.keys(decisions).length === 0) {
    validationError('Decisions map is required when dry_run is false.');
  }

  const result = await applyProjectReset(store, diagnosis, decisions as Record<string, WpDecision>);
  return result;
}

// ---------------------------------------------------------------------------
// PATCH /api/projects/:slug
// ---------------------------------------------------------------------------

/**
 * Zod schema for the PATCH /api/projects/:slug request body.
 *
 * Accepts `title`, `slug`, or both — but requires at least one field to be
 * present. Hoisted to module level so it can be reused and inspected in tests.
 */
export const RenameBodySchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    slug: z.string().min(1).max(200).optional(),
  })
  .refine((d) => d.title !== undefined || d.slug !== undefined, {
    message: 'At least one of title or slug must be provided.',
  });

/**
 * Handles `PATCH /api/projects/:slug`.
 *
 * Accepts a partial update body with `title`, `slug`, or both:
 * - `title` — persists a new display title via `LedgerStore.updateTitle()`.
 * - `slug`  — renames the ledger storage directory and updates `.meta.json`
 *             via `LedgerStore.renameSlug()`. The response `ProjectMeta.slug`
 *             reflects the new slug so the frontend can redirect.
 *
 * Operations are applied in order: title first, then slug. Each updates
 * `latestMeta` independently. `last_updated` is **not** modified by either
 * operation — renaming is cosmetic and must not distort sort order.
 *
 * Do not reuse the `LedgerStore` instance after a slug rename; its internal
 * `storageDir` points to the (now non-existent) old path.
 *
 * Throws `NOT_FOUND` if the project does not exist.
 * Throws `VALIDATION_ERROR` if the body is empty or fails schema validation.
 * Throws `CONFLICT` if the target slug directory already exists.
 */
export async function handleRenameProject(
  ledgerRoot: string,
  slug: string,
  body: unknown
): Promise<ProjectMeta> {
  assertSafeSlug(slug);
  const parseResult = RenameBodySchema.safeParse(body);
  if (!parseResult.success) {
    validationError('Invalid rename request body.', parseResult.error.issues);
  }
  const { title, slug: newSlug } = parseResult.data;

  // Early-reject invalid slug patterns before touching disk.
  if (newSlug !== undefined && !SAFE_SLUG_REGEX.test(newSlug)) {
    validationError(
      `Invalid slug '${newSlug}'. Must match ^[a-z0-9][a-z0-9-]*$.`
    );
  }

  const store = new LedgerStore(slug, ledgerRoot);
  if (!(await store.ledgerDirExists())) {
    notFound(`Project not found: ${slug}`);
  }

  let latestMeta: ProjectMeta | undefined;

  if (title !== undefined) {
    latestMeta = await store.updateTitle(title);
  }

  if (newSlug !== undefined) {
    if (newSlug === slug) {
      // Same-slug no-op: nothing to rename. Materialise latestMeta if needed.
      latestMeta ??= await store.readProjectMeta();
    } else {
      try {
        latestMeta = await store.renameSlug(newSlug);
      } catch (err: unknown) {
        if (err instanceof SlugConflictError) {
          conflict(`Slug already in use: '${newSlug}'.`);
        }
        throw err;
      }
    }
  }

  // latestMeta is always defined here: the .refine() above guarantees at least
  // one branch ran. The non-null assertion keeps TypeScript happy.
  return latestMeta!;
}

// ---------------------------------------------------------------------------
// GET /api/projects/:slug/health
// ---------------------------------------------------------------------------

export interface ProjectHealthSummary {
  work_packages_needing_reset: number;
  work_packages_healthy: number;
  work_packages_skipped: number;
  total_work_packages: number;
}

/**
 * Returns a lightweight health summary for the project.
 *
 * Delegates to the same `analyzeProjectForReset()` logic as the reset modal
 * dry-run path — read-only, no writes, no locks required.
 */
export async function handleGetProjectHealth(
  ledgerRoot: string,
  slug: string
): Promise<ProjectHealthSummary> {
  assertSafeSlug(slug);

  const store = new LedgerStore(slug, ledgerRoot);

  if (!(await store.ledgerDirExists())) {
    notFound(`Project '${slug}' not found.`);
  }

  let rootIndex: RootIndex;
  try {
    rootIndex = await store.readRootIndex();
  } catch (err) {
    notFound(`Project '${slug}' not found or corrupted: ${String(err)}`);
  }

  const wpDetails: WorkPackageDetail[] = (
    await Promise.all(
      rootIndex.work_packages.map(async (wpSummary) => {
        try {
          return await store.readWorkPackage(wpSummary.work_package_id);
        } catch (err) {
          process.stderr.write(
            `[handleGetProjectHealth] Skipping WP "${wpSummary.work_package_id}": ${String(err)}\n`
          );
          return null;
        }
      })
    )
  ).filter((wp): wp is WorkPackageDetail => wp !== null);

  const diagnosis = analyzeProjectForReset(slug, rootIndex, wpDetails);

  return {
    work_packages_needing_reset: diagnosis.work_packages_needing_reset,
    work_packages_healthy:       diagnosis.work_packages_healthy,
    work_packages_skipped:       diagnosis.work_packages_skipped,
    total_work_packages:         rootIndex.work_packages.length,
  };
}

// ---------------------------------------------------------------------------
// GET /api/projects/:slug/work-packages/overview
// ---------------------------------------------------------------------------

export interface WpPipelineStage {
  type: PipelineType;
  agent: string;
  status: 'pending' | 'in-progress' | 'pass' | 'fail';
  rework_count: number;
}

export interface WpOverviewEntry {
  work_package_id: string;
  status: WorkPackageStatus;
  assigned_to: string | null;
  dependencies: string[];
  pipeline_stages: WpPipelineStage[];
  acceptance_criteria: { met: number; total: number };
  blocked_by?: { type: string; description: string };
}

/**
 * Returns an enriched summary array for every work package in the project.
 *
 * For each WP the handler resolves:
 *  - pipeline_stages: ordered per CANONICAL_PIPELINE_ORDERING, with status
 *    derived from the most recent pipeline entry of each stage type
 *  - acceptance_criteria: met/total counts
 *  - blocked_by: propagated from the WP detail when present
 *
 * Corrupt or missing WP detail files are skipped (same error-tolerance
 * pattern as handleGetProjectHealth).
 * STDIO discipline: this handler never writes to process.stdout.
 */
export async function handleGetWorkPackageOverview(
  ledgerRoot: string,
  slug: string
): Promise<WpOverviewEntry[]> {
  assertSafeSlug(slug);

  const store = new LedgerStore(slug, ledgerRoot);

  if (!(await store.ledgerDirExists())) {
    notFound(`Project '${slug}' not found.`);
  }

  let rootIndex: RootIndex;
  try {
    rootIndex = await store.readRootIndex();
  } catch (err) {
    notFound(`Project '${slug}' not found or corrupted: ${String(err)}`);
  }

  const entries: WpOverviewEntry[] = (
    await Promise.all(
      rootIndex.work_packages.map(async (wpSummary) => {
        let wp: WorkPackageDetail;
        try {
          wp = await store.readWorkPackage(wpSummary.work_package_id);
        } catch (err) {
          process.stderr.write(
            `[handleGetWorkPackageOverview] Skipping WP "${wpSummary.work_package_id}": ${String(err)}\n`
          );
          return null;
        }

        // Resolve active stages, filtering through CANONICAL_PIPELINE_ORDERING
        // to guarantee the output is always in canonical execution order.
        const rawStages: string[] = wp.active_pipeline_stages ?? [...DEFAULT_PIPELINE_STAGES];
        const orderedStages = CANONICAL_PIPELINE_ORDERING.filter((s) => rawStages.includes(s));

        // Build a lookup map from stage type → latest pipeline entry.
        // Iterating in array order means later entries for the same type overwrite
        // earlier ones, so the map always holds the most recent execution.
        const latestByType = new Map<string, WorkPackageDetail['pipelines'][number]>();
        for (const pipeline of wp.pipelines) {
          latestByType.set(pipeline.type, pipeline);
        }

        const pipeline_stages: WpPipelineStage[] = orderedStages.map((type) => {
          const latest = latestByType.get(type);
          let status: WpPipelineStage['status'] = 'pending';
          if (latest) {
            if (latest.status === 'IN_PROGRESS') status = 'in-progress';
            else if (latest.status === 'PASS') status = 'pass';
            else if (latest.status === 'FAIL') status = 'fail';
          }
          const rework_count =
            (wp.rework_counts as Record<string, number> | undefined)?.[type] ?? 0;
          return {
            type,
            agent: PIPELINE_AGENT_MAP[type],
            status,
            rework_count,
          };
        });

        const metCount = wp.acceptance_criteria.filter((ac) => ac.met).length;
        const entry: WpOverviewEntry = {
          work_package_id: wp.work_package_id,
          status: wp.status,
          assigned_to: wp.assigned_to,
          dependencies: wp.dependencies,
          pipeline_stages,
          acceptance_criteria: { met: metCount, total: wp.acceptance_criteria.length },
        };

        if (wp.blocked_by) {
          entry.blocked_by = {
            type: wp.blocked_by.type,
            description: wp.blocked_by.description,
          };
        }

        return entry;
      })
    )
  ).filter((entry): entry is WpOverviewEntry => entry !== null);

  return entries;
}
