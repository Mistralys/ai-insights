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
import { LedgerStore } from '../src/storage/ledger-store.js';
import type { ProjectMeta } from '../src/schema/project-meta.js';
import type { ProjectStatus } from '../src/schema/enums.js';
import type { RootIndex } from '../src/schema/root-index.js';
import type { IncidentContext, WorkPackageDetail } from '../src/schema/work-package.js';
import { getConfig, writeConfig } from '../src/gui/config.js';
import type { GuiConfig } from '../src/gui/config.js';

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

function validationError(message: string, details?: unknown): never {
  throw new ApiError('VALIDATION_ERROR', message, details);
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
}

/**
 * Returns the full list of enriched project summaries from the centralized
 * ledger. Each entry extends ProjectMeta with WP counters and project name.
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

      return {
        ...meta,
        total_work_packages,
        pending_work_packages,
        project_name,
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
