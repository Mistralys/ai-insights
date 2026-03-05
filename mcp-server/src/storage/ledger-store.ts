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
import { now } from '../utils/timestamp.js';

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
   * @param data - Root index data to write
   * @throws Error if validation fails or write fails
   */
  async writeRootIndex(data: RootIndex): Promise<void> {
    // Validate before writing
    const validated = RootIndexSchema.parse(data);

    const path = this.rootIndexPath();
    await atomicWriteJson(path, validated);
    // Auto-sync .meta.json after every root index write
    await this.writeProjectMeta('', validated.status);
  }

  /**
   * Writes a work package detail file after validation.
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

      // Validate the updates
      const validatedWp = WorkPackageDetailSchema.parse(updatedWp);
      const validatedRoot = RootIndexSchema.parse(updatedRoot);

      // Write both atomically (within the same lock)
      await atomicWriteJson(this.wpDetailPath(wpId), validatedWp);
      await atomicWriteJson(this.rootIndexPath(), validatedRoot);
      // Auto-sync .meta.json inside the same lock scope
      await this.writeProjectMeta('', validatedRoot.status);
    });
  }

  // ==================== Meta Methods ====================

  /**
   * Creates or updates the project's .meta.json file.
   * On first write: populates all fields. On subsequent writes: updates status and last_updated.
   * Must be called within the project lock when triggered from a root-index write.
   *
   * @param planFile - Plan file name (used only on first write; ignored on updates)
   * @param status - Optional status override; defaults to existing status or IN_PROGRESS
   */
  async writeProjectMeta(planFile: string, status?: string): Promise<void> {
    const path = this.metaPath();
    let existing: Partial<ProjectMeta> = {};

    try {
      const content = await readFile(path, 'utf-8');
      existing = JSON.parse(content) as Partial<ProjectMeta>;
    } catch {
      // First write — all fields will be initialised below
    }

    const timestamp = now();
    const meta = ProjectMetaSchema.parse({
      slug: existing.slug ?? this.slug,
      plan_path: existing.plan_path ?? this.planPath,
      status: (status ?? existing.status ?? 'IN_PROGRESS') as ProjectMeta['status'],
      date_created: existing.date_created ?? timestamp,
      last_updated: timestamp,
      ...(existing.title !== undefined ? { title: existing.title } : {}),
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
        matches.push(meta);
      }
    }

    if (matches.length === 1) {
      return { status: 'FOUND', meta: matches[0]! };
    }

    if (matches.length > 1) {
      return { status: 'AMBIGUOUS', candidates: matches };
    }

    return { status: 'NOT_FOUND' };
  }
}

// ==================== Result Types for detectProjectByCwd ====================

export type DetectProjectResult =
  | { status: 'FOUND'; meta: ProjectMeta }
  | { status: 'NOT_FOUND' }
  | { status: 'AMBIGUOUS'; candidates: ProjectMeta[] };
