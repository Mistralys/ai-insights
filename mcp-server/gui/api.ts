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
import { inferProjectRootFromPlanPath } from '../src/utils/ledger-root.js';
import { PLAN_ARCHIVE_FILENAME, SYNTHESIS_ARCHIVE_FILENAME, SAFE_SLUG_REGEX } from '../src/utils/constants.js';
import type { ProjectMeta } from '../src/schema/project-meta.js';
import type { ProjectStatus } from '../src/schema/enums.js';
import type { RootIndex } from '../src/schema/root-index.js';
import type { IncidentContext, WorkPackageDetail } from '../src/schema/work-package.js';
import { getConfig, writeConfig } from '../src/gui/config.js';
import type { GuiConfig } from '../src/gui/config.js';
import {
  analyzeProjectForReset,
  applyProjectReset,
  getPassedStages,
} from '../src/utils/project-reset.js';
import type {
  WpDecision,
  ProjectResetDiagnosis,
  ProjectResetResult,
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

/**
 * Resolves the human-readable project name from the managed workspace's
 * manifest file. Tries package.json → composer.json → pyproject.toml in
 * order. Returns null if no file is found or any parse/read fails.
 */
async function readProjectName(planPath: string): Promise<string | null> {
  // 1. Try package.json
  try {
    const raw = await readFile(join(planPath, 'package.json'), 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      'name' in parsed &&
      typeof (parsed as Record<string, unknown>).name === 'string' &&
      (parsed as Record<string, string>).name.trim() !== ''
    ) {
      return (parsed as Record<string, string>).name;
    }
  } catch {
    // fall through
  }

  // 2. Try composer.json
  try {
    const raw = await readFile(join(planPath, 'composer.json'), 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      'name' in parsed &&
      typeof (parsed as Record<string, unknown>).name === 'string' &&
      (parsed as Record<string, string>).name.trim() !== ''
    ) {
      return (parsed as Record<string, string>).name;
    }
  } catch {
    // fall through
  }

  // 3. Try pyproject.toml (best-effort regex)
  try {
    const raw = await readFile(join(planPath, 'pyproject.toml'), 'utf-8');
    const match = raw.match(/name\s*=\s*"([^"]+)"/);
    if (match && match[1].trim() !== '') {
      return match[1];
    }
  } catch {
    // fall through
  }

  return null;
}

export interface ProjectSummary extends ProjectMeta {
  total_work_packages: number;
  pending_work_packages: number;
  project_name: string | null;
  repository_name: string | null;
}

/**
 * Returns the full list of enriched project summaries from the centralized
 * ledger. Each entry extends ProjectMeta with WP counters, project name, and
 * repository_name derived from the project root directory.
 * project_name resolution order: manifest file → slug date-strip fallback →
 * meta.title (takes precedence when set).
 * Per-project read failures are isolated so one bad project never breaks
 * the entire response.
 */
export async function handleListProjects(ledgerRoot: string): Promise<ProjectSummary[]> {
  const projects = await LedgerStore.listAllProjects(ledgerRoot);

  const summaries = await Promise.all(
    projects.map(async (meta): Promise<ProjectSummary> => {
      let total_work_packages = 0;
      let pending_work_packages = 0;
      let project_name: string | null = null;

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
          project_name = await readProjectName(meta.plan_path);
        })(),
      ]);

      // Infer project name from slug when no manifest file was found.
      // Strips the YYYY-MM-DD- date prefix and title-cases the remainder,
      // e.g. "2026-02-27-gui-enhancements" → "Gui Enhancements".
      if (project_name === null) {
        const match = meta.slug.match(/^\d{4}-\d{2}-\d{2}-(.+)$/);
        if (match) {
          project_name = match[1]
            .split('-')
            .map((w) => (w.length > 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
            .join(' ');
        }
      }

      // Persisted title takes precedence over auto-detected manifest names.
      if (meta.title && meta.title.trim().length > 0) {
        project_name = meta.title;
      }

      // Derive repository_name from the project root directory name.
      const projectRoot = inferProjectRootFromPlanPath(meta.plan_path);
      const repository_name = projectRoot
        ? (projectRoot.split(/[\\/]/).filter(Boolean).pop() ?? null)
        : null;

      return {
        ...meta,
        total_work_packages,
        pending_work_packages,
        project_name,
        repository_name,
      };
    })
  );

  return summaries;
}

// ---------------------------------------------------------------------------
// GET /api/projects/:slug
// ---------------------------------------------------------------------------

export type ProjectDetail = RootIndex & { meta: ProjectMeta };

/**
 * Returns the combined root index + meta for a project.
 * Throws NOT_FOUND if the project slug does not exist in the ledger.
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
    return { ...rootIndex, meta };
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
): Promise<WorkPackageDetail> {
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
    return await store.readWorkPackage(wpId);
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
  if (meta!.status !== 'COMPLETE') {
    forbidden('Only COMPLETE projects can be deleted.');
  }

  const projectDir = join(ledgerRoot, slug);
  await rm(projectDir, { recursive: true, force: true });

  return { deleted: true, slug };
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
 * Partial-update schema for incoming config PUT bodies.
 * ledger_root is intentionally omitted — it is read-only in the GUI.
 */
const GuiConfigPartialSchema = z.object({
  auto_handoff_enabled: z.boolean().optional(),
  max_handoff_depth: z.number().int().min(1).optional(),
});

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
