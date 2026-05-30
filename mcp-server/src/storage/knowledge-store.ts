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
 *     .lock                              — lock file created by withLock
 *     global-insights.json              — insights with scope: 'global'
 *     {repository_name}-insights.json   — insights scoped to a specific repository
 *
 * Locking strategy:
 *   - All read-modify-write sequences (addInsight, updateInsight, deleteInsight)
 *     acquire a single lock on knowledgeDir() for the entire operation.
 *   - All writes use atomicWriteJson() — write-to-temp-then-rename.
 *   - Pure reads (readGlobalStore, readRepositoryStore, searchInsights, listInsights)
 *     do not acquire a lock, consistent with the LedgerStore pattern.
 *
 * scope === 'repository' + repository_name constraint:
 *   The Zod schema accepts repository_name as optional to remain context-free.
 *   This class enforces the constraint: addInsight() throws if scope is 'repository'
 *   and repository_name is absent.
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

  /**
   * Returns the file path for a repository-scoped insights store.
   *
   * @param repoName - Repository name (used to derive the filename)
   * @throws Error if repoName is 'global' (reserved name)
   * @throws Error if repoName contains unsafe characters (path traversal guard)
   */
  repositoryStorePath(repoName: string): string {
    if (repoName === 'global') {
      throw new Error("'global' is a reserved name and cannot be used as a repository name.");
    }
    this._validateSlug(repoName);
    return join(this.knowledgeDir(), `${repoName}-insights.json`);
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
   * Reads and validates a repository-scoped insights store.
   * Returns a valid empty KnowledgeStore if the file does not yet exist.
   *
   * @param repoName - Repository name (used to derive the filename)
   * @throws Error if the file exists but contains malformed JSON or fails schema validation
   */
  async readRepositoryStore(repoName: string): Promise<KnowledgeStore> {
    return this._readStore(this.repositoryStorePath(repoName));
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
   * Writes a repository-scoped insights store atomically under a lock.
   * Validates the data against KnowledgeStoreSchema before writing.
   *
   * @param repoName - Repository name
   * @param data - Store data to persist
   * @throws Error if validation fails or write fails
   * @warning Do NOT call this method from inside a withLock(knowledgeDir, ...) callback.
   *   The CRUD methods (addInsight, updateInsight, deleteInsight) intentionally bypass
   *   this method and call atomicWriteJson directly to avoid nested lock acquisition,
   *   which would deadlock. This method is safe only at the top level.
   */
  async writeRepositoryStore(repoName: string, data: KnowledgeStore): Promise<void> {
    await withLock(this.knowledgeDir(), async () => {
      const validated = KnowledgeStoreSchema.parse(data);
      await atomicWriteJson(this.repositoryStorePath(repoName), validated);
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
   * Adds a new insight to the appropriate store (global or repository-scoped).
   *
   * Assigns the numeric id from the store's next_id counter and persists the
   * incremented counter. Enforces the repository_name requirement for
   * repository-scoped insights. The entire read-modify-write sequence runs
   * under a single lock.
   *
   * @param input - Insight data without the id field (auto-assigned from next_id)
   * @returns The created Insight with the assigned numeric id
   * @throws Error if scope === 'repository' and repository_name is absent
   */
  async addInsight(input: Omit<Insight, 'id'>): Promise<Insight> {
    if (input.scope === 'repository' && !input.repository_name) {
      throw new Error('repository_name is required for repository-scoped insights');
    }

    return await withLock(this.knowledgeDir(), async () => {
      const storePath =
        input.scope === 'global'
          ? this.globalStorePath()
          : this.repositoryStorePath(input.repository_name!);

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
   * entry in the tags array. Optionally narrows by tags (intersection), then
   * applies offset/limit pagination — in that order.
   *
   * @param query - Substring to search for (case-insensitive)
   * @param filters - Optional scope/category/repository_name filters to narrow the stores searched,
   *   plus optional tags (intersection filter), limit, and offset for pagination.
   *   - `filters.tags` — Case-sensitive intersection filter; every tag in this array must be
   *     present in `insight.tags` using exact-case matching. This contrasts with the
   *     case-insensitive text search applied to `query`. Pass tags in the exact casing
   *     they were stored with.
   * @returns Insights matching the query, filtered by tags, and paginated
   */
  async searchInsights(
    query: string,
    filters?: {
      scope?: InsightScope;
      repository_name?: string;
      category?: string;
      tags?: string[];
      limit?: number;
      offset?: number;
    }
  ): Promise<Insight[]> {
    const { tags: tagFilter, limit, offset = 0, ...loadFilters } = filters ?? {};

    const allInsights = await this._loadInsights(loadFilters);
    const q = query.toLowerCase();

    let results = allInsights.filter(
      (insight) =>
        insight.title.toLowerCase().includes(q) ||
        insight.content.toLowerCase().includes(q) ||
        insight.tags.some((tag) => tag.toLowerCase().includes(q))
    );

    if (tagFilter && tagFilter.length > 0) {
      results = results.filter((insight) =>
        tagFilter.every((tag) => insight.tags.includes(tag))
      );
    }

    return results.slice(offset, limit !== undefined ? offset + limit : undefined);
  }

  /**
   * Lists insights with optional scope/category/tags/repository_name filters and pagination.
   *
   * Filters are applied in this order: store selection (scope/repository_name) → category →
   * tags → offset → limit.
   *
   * @param filters - Scope, category, tags, repository_name filters; limit and offset for pagination
   * @returns Filtered and paginated insight array
   */
  async listInsights(filters: {
    scope?: InsightScope;
    category?: string;
    tags?: string[];
    repository_name?: string;
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
   * When `filter.scope` and/or `filter.repository_name` are provided the search is
   * restricted to the matching store(s), preventing accidental global-insight
   * mutation when the same numeric ID exists in multiple stores. Without a
   * filter, all stores are scanned (original behaviour — preserved for
   * backwards compatibility).
   *
   * Applies the provided partial updates and sets updated_at to the current
   * timestamp. The entire read-modify-write sequence runs under a single lock.
   *
   * Immutable fields (id, scope, repository_name, created_at) are not accepted
   * in the updates parameter.
   *
   * @param id - Numeric insight id
   * @param updates - Partial insight fields to update
   * @param filter - Optional scope/repository_name filter to restrict which store is searched
   * @returns The updated Insight
   * @throws Error if no insight with the given id exists in the filtered stores
   */
  async updateInsight(
    id: number,
    updates: Partial<
      Pick<Insight, 'title' | 'content' | 'category' | 'tags' | 'source' | 'confidence' | 'superseded_by'>
    >,
    filter?: { scope?: InsightScope; repository_name?: string }
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
   * Moves an insight from one store to another in a single atomic lock span,
   * eliminating the TOCTOU window inherent in the previous add→delete two-step pattern.
   *
   * The operation performs these steps inside a single withLock(knowledgeDir) span:
   *   1. Resolve the source store path(s) from sourceFilter.
   *   2. Find the insight by id in the source store — throws if not found.
   *   3. Construct the moved insight: new id (from the target store's next_id counter),
   *      corrected scope/repository_name, and a fresh updated_at timestamp.
   *   4. Validate the new insight with InsightSchema.parse(…).
   *   5. Write the updated target store (with the new insight appended) via atomicWriteJson.
   *   6. Remove the original insight from the source store and write it via atomicWriteJson.
   *
   * @param id - Numeric id of the insight to move
   * @param sourceFilter - Scope (and optional repository_name) of the store containing the insight
   * @param targetScope - Destination scope ('global' or 'repository')
   * @param targetRepositoryName - Required when targetScope === 'repository'
   * @returns The moved Insight with new id, corrected scope/repository_name, and updated_at
   * @throws Error if the insight is not found in the source store(s)
   * @throws Error if targetScope === 'repository' and targetRepositoryName is absent
   * @throws Error if source and target resolve to the same store (identity move)
   * @warning Do NOT call from inside a withLock(knowledgeDir, …) callback.
   *   This method acquires the lock itself; a nested call would deadlock.
   */
  async moveInsight(
    id: number,
    sourceFilter: { scope: InsightScope; repository_name?: string },
    targetScope: InsightScope,
    targetRepositoryName?: string
  ): Promise<Insight> {
    if (targetScope === 'repository' && !targetRepositoryName) {
      throw new Error('targetRepositoryName is required when targetScope is "repository"');
    }

    // Guard against identity moves: same repository → same repository
    if (
      sourceFilter.scope === 'repository' &&
      targetScope === 'repository' &&
      sourceFilter.repository_name !== undefined &&
      sourceFilter.repository_name === targetRepositoryName
    ) {
      throw new Error(
        `Cannot move insight to the same repository store: "${targetRepositoryName}"`
      );
    }

    return await withLock(this.knowledgeDir(), async () => {
      // 1. Resolve source path(s)
      const sourcePaths = await this._storePathsForFilter(sourceFilter);

      // 2. Find insight in source store
      let sourceStorePath: string | undefined;
      let sourceStore: KnowledgeStore | undefined;
      let sourceIdx = -1;

      for (const storePath of sourcePaths) {
        const store = await this._readStore(storePath);
        const idx = store.insights.findIndex((i) => i.id === id);
        if (idx !== -1) {
          sourceStorePath = storePath;
          sourceStore = store;
          sourceIdx = idx;
          break;
        }
      }

      if (!sourceStorePath || !sourceStore || sourceIdx === -1) {
        throw new Error(`Insight with id ${id} not found`);
      }

      const originalInsight = sourceStore.insights[sourceIdx];

      // 3. Resolve target store path and read it
      const targetStorePath =
        targetScope === 'global'
          ? this.globalStorePath()
          : this.repositoryStorePath(targetRepositoryName!);

      const targetStore = await this._readStore(targetStorePath);

      // 4. Construct the moved insight with new id, scope, and updated_at
      const newNumericId = targetStore.next_id;
      targetStore.next_id = newNumericId + 1;
      const movedAt = now(); // capture once — reused for both movedInsight.updated_at and store.last_updated

      const movedInsight: Insight = InsightSchema.parse({
        ...originalInsight,
        id: newNumericId,
        scope: targetScope,
        repository_name: targetScope === 'global' ? undefined : targetRepositoryName,
        updated_at: movedAt,
      });

      // 5. Append to target store and write atomically
      targetStore.insights.push(movedInsight);
      targetStore.last_updated = movedAt;
      const validatedTarget = KnowledgeStoreSchema.parse(targetStore);
      await atomicWriteJson(targetStorePath, validatedTarget);

      // 6. Remove from source store and write atomically
      sourceStore.insights.splice(sourceIdx, 1);
      sourceStore.last_updated = now();
      const validatedSource = KnowledgeStoreSchema.parse(sourceStore);
      await atomicWriteJson(sourceStorePath, validatedSource);

      return movedInsight;
    });
  }

  /**
   * Deletes an insight by numeric ID.
   *
   * When `filter.scope` and/or `filter.repository_name` are provided the search is
   * restricted to the matching store(s), preventing accidental global-insight
   * deletion when the same numeric ID exists in multiple stores. Without a
   * filter, all stores are scanned (original behaviour — preserved for
   * backwards compatibility).
   *
   * The entire read-modify-write sequence runs under a single lock.
   *
   * @param id - Numeric insight id
   * @param filter - Optional scope/repository_name filter to restrict which store is searched
   * @throws Error if no insight with the given id exists in the filtered stores
   */
  async deleteInsight(id: number, filter?: { scope?: InsightScope; repository_name?: string }): Promise<void> {
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
   *   - scope: 'global'                          → only global-insights.json
   *   - scope: 'repository' + repository_name    → only {repoName}-insights.json
   *   - scope: 'repository' (no repository_name) → all repository stores
   *   - repository_name (no scope)               → only {repoName}-insights.json
   *   - no scope, no repository_name             → global store + all repository stores
   *
   * This is the canonical store-selection helper for write operations.
   * `_loadInsights` uses an equivalent inline implementation for read operations.
   */
  private async _storePathsForFilter(
    filter?: { scope?: InsightScope; repository_name?: string }
  ): Promise<string[]> {
    const { scope, repository_name } = filter ?? {};

    if (scope === 'global') {
      return [this.globalStorePath()];
    } else if (scope === 'repository' && repository_name) {
      return [this.repositoryStorePath(repository_name)];
    } else if (scope === 'repository' && !repository_name) {
      return await this._enumerateRepositoryStorePaths();
    } else if (repository_name) {
      return [this.repositoryStorePath(repository_name)];
    } else {
      return await this._enumerateStorePaths();
    }
  }

  /**
   * Validates a repository name to prevent path traversal attacks.
   *
   * Accepts only names that start with an alphanumeric character and contain
   * only letters, digits, underscores, and hyphens. Rejects names with `/`,
   * `\`, `.`, or any other character that could escape the .knowledge/ directory.
   *
   * @param name - The repository name to validate
   * @throws Error if the name contains unsafe characters
   */
  private _validateSlug(slug: string): void {
    if (!PROJECT_SLUG_REGEX.test(slug)) {
      throw new Error(
        `Invalid repository name: "${slug}". Name must start with a letter or digit and contain only letters, digits, underscores, and hyphens.`
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
   * Includes global-insights.json and all {repoName}-insights.json files.
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
      // Matches both global-insights.json and {repoName}-insights.json
      if (dirent.name.endsWith('-insights.json')) {
        paths.push(join(dir, dirent.name));
      }
    }
    return paths;
  }

  /**
   * Enumerates only repository-scoped store paths ({repoName}-insights.json).
   * Excludes global-insights.json.
   * Returns an empty array if the directory does not yet exist.
   */
  private async _enumerateRepositoryStorePaths(): Promise<string[]> {
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
   *   - scope: 'global'                          → only global-insights.json
   *   - scope: 'repository' + repository_name    → only {repoName}-insights.json
   *   - scope: 'repository' (no repository_name) → all repository stores
   *   - repository_name (no scope)               → only {repoName}-insights.json
   *   - no scope, no repository_name             → global store + all repository stores
   *
   * Category filter is applied after loading.
   */
  private async _loadInsights(filters?: {
    scope?: InsightScope;
    repository_name?: string;
    category?: string;
  }): Promise<Insight[]> {
    const { scope, repository_name, category } = filters ?? {};

    let storePaths: string[];

    if (scope === 'global') {
      storePaths = [this.globalStorePath()];
    } else if (scope === 'repository' && repository_name) {
      storePaths = [this.repositoryStorePath(repository_name)];
    } else if (scope === 'repository' && !repository_name) {
      storePaths = await this._enumerateRepositoryStorePaths();
    } else if (repository_name) {
      // repository_name provided without scope → narrow to that repository's store only
      storePaths = [this.repositoryStorePath(repository_name)];
    } else {
      // No scope filter, no repository_name: load global store + all repository stores
      storePaths = [
        this.globalStorePath(),
        ...(await this._enumerateRepositoryStorePaths()),
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
