import { readFile, access } from 'fs/promises';
import { join } from 'path';
import { constants } from 'fs';
import { RootIndexSchema, type RootIndex } from '../schema/root-index.js';
import {
  WorkPackageDetailSchema,
  type WorkPackageDetail,
} from '../schema/work-package.js';
import { atomicWriteJson } from './atomic-writer.js';
import { withLock } from './file-lock.js';
import { formatWpId } from '../utils/wp-id.js';

/**
 * Central storage abstraction for ledger file I/O.
 *
 * All reads validate with Zod schemas.
 * All writes use atomic operations and file locking.
 */
export class LedgerStore {
  constructor(private readonly projectPath: string) {}

  // ==================== Path Helpers ====================

  private rootIndexPath(): string {
    return join(this.projectPath, 'project-ledger.json');
  }

  private wpDetailPath(wpId: string): string {
    return join(this.projectPath, 'ledger', `${wpId}.json`);
  }

  private ledgerDirPath(): string {
    return join(this.projectPath, 'ledger');
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
   * Reads and validates the root index (project-ledger.json).
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
   * Reads and validates a work package detail file (ledger/WP-###.json).
   *
   * @param wpId - Work package ID (e.g., "WP-001")
   * @throws Error if file does not exist, JSON is malformed, or validation fails
   */
  async readWorkPackage(wpId: string): Promise<WorkPackageDetail> {
    const path = this.wpDetailPath(wpId);

    try {
      const content = await readFile(path, 'utf-8');
      const data = JSON.parse(content);
      return WorkPackageDetailSchema.parse(data);
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
   * Writes the root index after validation.
   *
   * @param data - Root index data to write
   * @throws Error if validation fails or write fails
   */
  async writeRootIndex(data: RootIndex): Promise<void> {
    // Validate before writing
    const validated = RootIndexSchema.parse(data);

    const path = this.rootIndexPath();
    await atomicWriteJson(path, validated);
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
    await withLock(this.projectPath, async () => {
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
    });
  }
}
