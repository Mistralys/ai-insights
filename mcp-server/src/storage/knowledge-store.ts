import { readFile, readdir } from 'fs/promises';
import { join } from 'path';
import type { Dirent } from 'fs';
import {
  KnowledgeStoreSchema,
  InsightSchema,
  PROJECT_SLUG_REGEX,
  type KnowledgeStore,
  type Insight,
  type InsightScope,
} from '../schema/knowledge.js';
import { atomicWriteJson } from './atomic-writer.js';
import { withLock } from './file-lock.js';
import { now } from '../utils/timestamp.js';

/**
 * Manages the `.knowledge/` directory, providing all CRUD operations for
 * insights with atomic writes, file locking, and in-memory search/filter logic.
 *
 * Storage layout (relative to `ledgerRoot`):
 *   .knowledge/
 *     .lock                     — lock file created by withLock
 *     global-insights.json      — insights with scope: 'global'
 *     {slug}-insights.json      — insights scoped to a specific project
 *
 * Locking strategy:
 *   - All read-modify-write sequences (addInsight, updateInsight, deleteInsight)
 *     acquire a single lock on knowledgeDir() for the entire operation.
 *   - All writes use atomicWriteJson() — write-to-temp-then-rename.
 *   - Pure reads (readGlobalStore, readProjectStore, searchInsights, listInsights)
 *     do not acquire a lock, consistent with the LedgerStore pattern.
 *
 * scope === 'project' + project_slug constraint:
 *   The Zod schema accepts project_slug as optional to remain context-free.
 *   This class enforces the constraint: addInsight() throws if scope is 'project'
 *   and project_slug is absent.
 */
export class KnowledgeStoreManager {
  public readonly ledgerRoot: string;

  constructor(ledgerRoot: string) {
    this.ledgerRoot = ledgerRoot;
  }

  // ==================== Path Helpers ====================

  knowledgeDir(): string {
    return join(this.ledgerRoot, '.knowledge');
  }

  globalStorePath(): string {
    return join(this.knowledgeDir(), 'global-insights.json');
  }

  projectStorePath(slug: string): string {
    this._validateSlug(slug);
    return join(this.knowledgeDir(), `${slug}-insights.json`);
  }

  // ==================== Read Methods ====================

  /**
   * Reads and validates the global insights store.
   * Returns a valid empty KnowledgeStore if the file does not yet exist.
   *
   * @throws Error if the file exists but contains malformed JSON or fails schema validation
   */
  async readGlobalStore(): Promise<KnowledgeStore> {
    return this._readStore(this.globalStorePath());
  }

  /**
   * Reads and validates a project-scoped insights store.
   * Returns a valid empty KnowledgeStore if the file does not yet exist.
   *
   * @param slug - Project slug (used to derive the filename)
   * @throws Error if the file exists but contains malformed JSON or fails schema validation
   */
  async readProjectStore(slug: string): Promise<KnowledgeStore> {
    return this._readStore(this.projectStorePath(slug));
  }

  // ==================== Write Methods ====================

  /**
   * Writes the global insights store atomically under a lock.
   * Validates the data against KnowledgeStoreSchema before writing.
   *
   * @param data - Store data to persist
   * @throws Error if validation fails or write fails
   * @warning Do NOT call this method from inside a withLock(knowledgeDir, ...) callback.
   *   The CRUD methods (addInsight, updateInsight, deleteInsight) intentionally bypass
   *   this method and call atomicWriteJson directly to avoid nested lock acquisition,
   *   which would deadlock. This method is safe only at the top level.
   */
  async writeGlobalStore(data: KnowledgeStore): Promise<void> {
    await withLock(this.knowledgeDir(), async () => {
      const validated = KnowledgeStoreSchema.parse(data);
      await atomicWriteJson(this.globalStorePath(), validated);
    });
  }

  /**
   * Writes a project-scoped insights store atomically under a lock.
   * Validates the data against KnowledgeStoreSchema before writing.
   *
   * @param slug - Project slug
   * @param data - Store data to persist
   * @throws Error if validation fails or write fails
   * @warning Do NOT call this method from inside a withLock(knowledgeDir, ...) callback.
   *   The CRUD methods (addInsight, updateInsight, deleteInsight) intentionally bypass
   *   this method and call atomicWriteJson directly to avoid nested lock acquisition,
   *   which would deadlock. This method is safe only at the top level.
   */
  async writeProjectStore(slug: string, data: KnowledgeStore): Promise<void> {
    await withLock(this.knowledgeDir(), async () => {
      const validated = KnowledgeStoreSchema.parse(data);
      await atomicWriteJson(this.projectStorePath(slug), validated);
    });
  }

  // ==================== ID Generation ====================

  /**
   * Increments the store's next_id counter and returns the formatted ID string.
   *
   * Mutates the store object in-place — the updated store must be written to disk
   * for the counter to persist across process restarts.
   *
   * @param store - The store whose counter should be incremented
   * @returns Formatted ID string in KN-NNNN format (e.g., "KN-0001" for next_id=1)
   */
  nextId(store: KnowledgeStore): string {
    const id = store.next_id;
    store.next_id = id + 1;
    return `KN-${String(id).padStart(4, '0')}`;
  }

  // ==================== CRUD Operations ====================

  /**
   * Adds a new insight to the appropriate store (global or project-scoped).
   *
   * Assigns the numeric id from the store's next_id counter and persists the
   * incremented counter. Enforces the project_slug requirement for project-scoped
   * insights. The entire read-modify-write sequence runs under a single lock.
   *
   * @param input - Insight data without the id field (auto-assigned from next_id)
   * @returns The created Insight with the assigned numeric id
   * @throws Error if scope === 'project' and project_slug is absent
   */
  async addInsight(input: Omit<Insight, 'id'>): Promise<Insight> {
    if (input.scope === 'project' && !input.project_slug) {
      throw new Error('project_slug is required for project-scoped insights');
    }

    return await withLock(this.knowledgeDir(), async () => {
      const storePath =
        input.scope === 'global'
          ? this.globalStorePath()
          : this.projectStorePath(input.project_slug!);

      const store = await this._readStore(storePath);

      // Save the numeric id before nextId increments the counter.
      // The KN-NNNN return value of nextId() is intentionally discarded here —
      // display-format IDs are produced by MCP tool layer consumers, not stored.
      const numericId = store.next_id;
      this.nextId(store);

      const insight: Insight = InsightSchema.parse({ ...input, id: numericId });
      store.insights.push(insight);
      store.last_updated = now();

      const validated = KnowledgeStoreSchema.parse(store);
      await atomicWriteJson(storePath, validated);

      return insight;
    });
  }

  /**
   * Searches insights across all (or filtered) stores for the query string.
   *
   * Applies a case-insensitive substring match against title, content, and every
   * entry in the tags array.
   *
   * @param query - Substring to search for
   * @param filters - Optional scope/category/project_slug filters to narrow the stores searched
   * @returns Insights matching the query
   */
  async searchInsights(
    query: string,
    filters?: { scope?: InsightScope; project_slug?: string; category?: string }
  ): Promise<Insight[]> {
    const allInsights = await this._loadInsights(filters);
    const q = query.toLowerCase();

    return allInsights.filter(
      (insight) =>
        insight.title.toLowerCase().includes(q) ||
        insight.content.toLowerCase().includes(q) ||
        insight.tags.some((tag) => tag.toLowerCase().includes(q))
    );
  }

  /**
   * Lists insights with optional scope/category/tags/project_slug filters and pagination.
   *
   * Filters are applied in this order: store selection (scope/project_slug) → category →
   * tags → offset → limit.
   *
   * @param filters - Scope, category, tags, project_slug filters; limit and offset for pagination
   * @returns Filtered and paginated insight array
   */
  async listInsights(filters: {
    scope?: InsightScope;
    category?: string;
    tags?: string[];
    project_slug?: string;
    limit?: number;
    offset?: number;
  }): Promise<Insight[]> {
    const { limit, offset = 0, tags: tagFilter, ...loadFilters } = filters;

    let insights = await this._loadInsights(loadFilters);

    if (tagFilter && tagFilter.length > 0) {
      insights = insights.filter((insight) =>
        tagFilter.every((tag) => insight.tags.includes(tag))
      );
    }

    return insights.slice(offset, limit !== undefined ? offset + limit : undefined);
  }

  /**
   * Updates an existing insight by numeric ID.
   *
   * When `filter.scope` and/or `filter.project_slug` are provided the search is
   * restricted to the matching store(s), preventing accidental global-insight
   * mutation when the same numeric ID exists in multiple stores. Without a
   * filter, all stores are scanned (original behaviour — preserved for
   * backwards compatibility).
   *
   * Applies the provided partial updates and sets updated_at to the current
   * timestamp. The entire read-modify-write sequence runs under a single lock.
   *
   * Immutable fields (id, scope, project_slug, created_at) are not accepted
   * in the updates parameter.
   *
   * @param id - Numeric insight id
   * @param updates - Partial insight fields to update
   * @param filter - Optional scope/project_slug filter to restrict which store is searched
   * @returns The updated Insight
   * @throws Error if no insight with the given id exists in the filtered stores
   */
  async updateInsight(
    id: number,
    updates: Partial<
      Pick<Insight, 'title' | 'content' | 'category' | 'tags' | 'source' | 'confidence' | 'superseded_by'>
    >,
    filter?: { scope?: InsightScope; project_slug?: string }
  ): Promise<Insight> {
    return await withLock(this.knowledgeDir(), async () => {
      const storePaths = await this._storePathsForFilter(filter);

      for (const storePath of storePaths) {
        const store = await this._readStore(storePath);
        const idx = store.insights.findIndex((i) => i.id === id);

        if (idx === -1) continue;

        const updatedInsight: Insight = InsightSchema.parse({
          ...store.insights[idx],
          ...updates,
          updated_at: now(),
        });

        store.insights[idx] = updatedInsight;
        store.last_updated = now();

        const validated = KnowledgeStoreSchema.parse(store);
        await atomicWriteJson(storePath, validated);

        return updatedInsight;
      }

      throw new Error(`Insight with id ${id} not found`);
    });
  }

  /**
   * Deletes an insight by numeric ID.
   *
   * When `filter.scope` and/or `filter.project_slug` are provided the search is
   * restricted to the matching store(s), preventing accidental global-insight
   * deletion when the same numeric ID exists in multiple stores. Without a
   * filter, all stores are scanned (original behaviour — preserved for
   * backwards compatibility).
   *
   * The entire read-modify-write sequence runs under a single lock.
   *
   * @param id - Numeric insight id
   * @param filter - Optional scope/project_slug filter to restrict which store is searched
   * @throws Error if no insight with the given id exists in the filtered stores
   */
  async deleteInsight(id: number, filter?: { scope?: InsightScope; project_slug?: string }): Promise<void> {
    await withLock(this.knowledgeDir(), async () => {
      const storePaths = await this._storePathsForFilter(filter);

      for (const storePath of storePaths) {
        const store = await this._readStore(storePath);
        const idx = store.insights.findIndex((i) => i.id === id);

        if (idx === -1) continue;

        store.insights.splice(idx, 1);
        store.last_updated = now();

        const validated = KnowledgeStoreSchema.parse(store);
        await atomicWriteJson(storePath, validated);
        return;
      }

      throw new Error(`Insight with id ${id} not found`);
    });
  }

  // ==================== Private Helpers ====================

  /**
   * Resolves the set of store paths to search based on an optional scope filter.
   *
   * Selection rules (mirrors `_loadInsights` store selection):
   *   - scope: 'global'                    → only global-insights.json
   *   - scope: 'project' + project_slug    → only {slug}-insights.json
   *   - scope: 'project' (no project_slug) → all project stores
   *   - project_slug (no scope)            → only {slug}-insights.json
   *   - no scope, no project_slug          → global store + all project stores
   *
   * This is the canonical store-selection helper for write operations.
   * `_loadInsights` uses an equivalent inline implementation for read operations.
   */
  private async _storePathsForFilter(
    filter?: { scope?: InsightScope; project_slug?: string }
  ): Promise<string[]> {
    const { scope, project_slug } = filter ?? {};

    if (scope === 'global') {
      return [this.globalStorePath()];
    } else if (scope === 'project' && project_slug) {
      return [this.projectStorePath(project_slug)];
    } else if (scope === 'project' && !project_slug) {
      return await this._enumerateProjectStorePaths();
    } else if (project_slug) {
      return [this.projectStorePath(project_slug)];
    } else {
      return await this._enumerateStorePaths();
    }
  }

  /**
   * Validates a project slug to prevent path traversal attacks.
   *
   * Accepts only slugs that start with an alphanumeric character and contain
   * only letters, digits, underscores, and hyphens. Rejects slugs with `/`,
   * `\`, `.`, or any other character that could escape the .knowledge/ directory.
   *
   * @param slug - The project slug to validate
   * @throws Error if the slug contains unsafe characters
   */
  private _validateSlug(slug: string): void {
    if (!PROJECT_SLUG_REGEX.test(slug)) {
      throw new Error(
        `Invalid project slug: "${slug}". Slug must start with a letter or digit and contain only letters, digits, underscores, and hyphens.`
      );
    }
  }

  /**
   * Creates a valid empty KnowledgeStore with next_id starting at 1.
   */
  private _emptyStore(): KnowledgeStore {
    return {
      version: '1.0.0',
      last_updated: now(),
      next_id: 1,
      insights: [],
    };
  }

  /**
   * Reads and validates a store file at the given path.
   * Returns a valid empty KnowledgeStore when the file does not exist.
   */
  private async _readStore(filePath: string): Promise<KnowledgeStore> {
    try {
      const content = await readFile(filePath, 'utf-8');
      const data = JSON.parse(content);
      return KnowledgeStoreSchema.parse(data);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return this._emptyStore();
      }
      if (error instanceof SyntaxError) {
        throw new Error(
          `Malformed JSON in knowledge store at ${filePath}: ${error.message}`
        );
      }
      throw error;
    }
  }

  /**
   * Enumerates all existing store file paths in the knowledge directory.
   * Includes global-insights.json and all {slug}-insights.json files.
   * Returns an empty array if the directory does not yet exist.
   */
  private async _enumerateStorePaths(): Promise<string[]> {
    const dir = this.knowledgeDir();
    let dirents: Dirent[];

    try {
      dirents = await readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }

    const paths: string[] = [];
    for (const dirent of dirents) {
      if (!dirent.isFile()) continue;
      // Matches both global-insights.json and {slug}-insights.json
      if (dirent.name.endsWith('-insights.json')) {
        paths.push(join(dir, dirent.name));
      }
    }
    return paths;
  }

  /**
   * Enumerates only project-scoped store paths ({slug}-insights.json).
   * Excludes global-insights.json.
   * Returns an empty array if the directory does not yet exist.
   */
  private async _enumerateProjectStorePaths(): Promise<string[]> {
    const dir = this.knowledgeDir();
    let dirents: Dirent[];

    try {
      dirents = await readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }

    const paths: string[] = [];
    for (const dirent of dirents) {
      if (!dirent.isFile()) continue;
      if (
        dirent.name !== 'global-insights.json' &&
        dirent.name.endsWith('-insights.json')
      ) {
        paths.push(join(dir, dirent.name));
      }
    }
    return paths;
  }

  /**
   * Loads and concatenates insights from stores selected by the provided filters.
   *
   * Store selection rules:
   *   - scope: 'global'                    → only global-insights.json
   *   - scope: 'project' + project_slug    → only {slug}-insights.json
   *   - scope: 'project' (no project_slug) → all project stores
   *   - project_slug (no scope)            → only {slug}-insights.json
   *   - no scope, no project_slug          → global store + all project stores
   *
   * Category filter is applied after loading.
   */
  private async _loadInsights(filters?: {
    scope?: InsightScope;
    project_slug?: string;
    category?: string;
  }): Promise<Insight[]> {
    const { scope, project_slug, category } = filters ?? {};

    let storePaths: string[];

    if (scope === 'global') {
      storePaths = [this.globalStorePath()];
    } else if (scope === 'project' && project_slug) {
      storePaths = [this.projectStorePath(project_slug)];
    } else if (scope === 'project' && !project_slug) {
      storePaths = await this._enumerateProjectStorePaths();
    } else if (project_slug) {
      // project_slug provided without scope → narrow to that project's store only
      storePaths = [this.projectStorePath(project_slug)];
    } else {
      // No scope filter, no project_slug: load global store + all project stores
      storePaths = [
        this.globalStorePath(),
        ...(await this._enumerateProjectStorePaths()),
      ];
    }

    const allInsights: Insight[] = [];
    for (const storePath of storePaths) {
      const store = await this._readStore(storePath);
      allInsights.push(...store.insights);
    }

    if (category) {
      return allInsights.filter((i) => i.category === category);
    }

    return allInsights;
  }
}
