import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { KnowledgeStoreManager } from '../../src/storage/knowledge-store.js';
import type { KnowledgeStore, Insight } from '../../src/schema/knowledge.js';

// ─── Helpers ───────────────────────────────────────────────────────────────

function makeInsightInput(overrides: Partial<Omit<Insight, 'id'>> = {}): Omit<Insight, 'id'> {
  return {
    scope: 'global',
    title: 'Use path.join for cross-platform paths',
    content: 'Always use path.join() instead of string concatenation.',
    category: 'best-practice',
    tags: ['node', 'filesystem'],
    source: 'WP-001',
    created_at: '2026-05-28T12:00:00Z',
    confidence: 0.9,
    ...overrides,
  };
}

function makeStore(overrides: Partial<KnowledgeStore> = {}): KnowledgeStore {
  return {
    version: '1.0.0',
    last_updated: '2026-05-28T12:00:00Z',
    next_id: 1,
    insights: [],
    ...overrides,
  };
}

// ─── Setup ─────────────────────────────────────────────────────────────────

describe('KnowledgeStoreManager', () => {
  let tempLedgerRoot: string;
  let manager: KnowledgeStoreManager;

  beforeEach(async () => {
    tempLedgerRoot = await mkdtemp(join(tmpdir(), 'knowledge-test-'));
    manager = new KnowledgeStoreManager(tempLedgerRoot);
  });

  afterEach(async () => {
    await rm(tempLedgerRoot, { recursive: true, force: true });
  });

  // ─── Path Helpers ──────────────────────────────────────────────────────

  describe('path helpers', () => {
    it('knowledgeDir() returns .knowledge under ledgerRoot', () => {
      expect(manager.knowledgeDir()).toBe(join(tempLedgerRoot, '.knowledge'));
    });

    it('globalStorePath() returns global-insights.json under knowledgeDir', () => {
      expect(manager.globalStorePath()).toBe(
        join(tempLedgerRoot, '.knowledge', 'global-insights.json')
      );
    });

    it('repositoryStorePath() returns {repoName}-insights.json under knowledgeDir', () => {
      expect(manager.repositoryStorePath('hcp-editor')).toBe(
        join(tempLedgerRoot, '.knowledge', 'hcp-editor-insights.json')
      );
    });

    it('repositoryStorePath("global") throws reserved-name error', () => {
      expect(() => manager.repositoryStorePath('global')).toThrow(
        "'global' is a reserved name and cannot be used as a repository name."
      );
    });

    describe('repositoryStorePath() — path traversal rejection', () => {
      const maliciousSlugs = [
        '../evil',
        '../../etc/passwd',
        './relative',
        'has/slash',
        'has\\backslash',
        '.hidden',
        '',
        'space here',
      ];

      for (const slug of maliciousSlugs) {
        it(`throws for slug: "${slug}"`, () => {
          expect(() => manager.repositoryStorePath(slug)).toThrow('Invalid repository name');
        });
      }
    });
  });

  // ─── Empty Store Initialization ────────────────────────────────────────

  describe('readGlobalStore — empty store initialization', () => {
    it('returns empty store with next_id: 1 when file does not exist', async () => {
      const store = await manager.readGlobalStore();
      expect(store.next_id).toBe(1);
      expect(store.insights).toEqual([]);
      expect(store.version).toBe('1.0.0');
    });

    it('does not throw when file does not exist', async () => {
      await expect(manager.readGlobalStore()).resolves.not.toThrow();
    });
  });

  describe('readRepositoryStore — empty store initialization', () => {
    it('returns empty store with next_id: 1 when file does not exist', async () => {
      const store = await manager.readRepositoryStore('some-repo');
      expect(store.next_id).toBe(1);
      expect(store.insights).toEqual([]);
    });

    it('does not throw when file does not exist', async () => {
      await expect(manager.readRepositoryStore('missing-repo')).resolves.not.toThrow();
    });
  });

  // ─── nextId ────────────────────────────────────────────────────────────

  describe('nextId', () => {
    it('returns KN-0001 for the first insight (next_id: 1)', () => {
      const store = makeStore({ next_id: 1 });
      expect(manager.nextId(store)).toBe('KN-0001');
    });

    it('returns KN-0002 for the second insight (next_id: 2)', () => {
      const store = makeStore({ next_id: 2 });
      expect(manager.nextId(store)).toBe('KN-0002');
    });

    it('pads to 4 digits for ids 1–9999', () => {
      expect(manager.nextId(makeStore({ next_id: 9 }))).toBe('KN-0009');
      expect(manager.nextId(makeStore({ next_id: 99 }))).toBe('KN-0099');
      expect(manager.nextId(makeStore({ next_id: 999 }))).toBe('KN-0999');
      expect(manager.nextId(makeStore({ next_id: 9999 }))).toBe('KN-9999');
    });

    it('increments the store next_id in place', () => {
      const store = makeStore({ next_id: 1 });
      manager.nextId(store);
      expect(store.next_id).toBe(2);
    });

    it('sequential calls return incrementing IDs', () => {
      const store = makeStore({ next_id: 1 });
      expect(manager.nextId(store)).toBe('KN-0001');
      expect(manager.nextId(store)).toBe('KN-0002');
      expect(manager.nextId(store)).toBe('KN-0003');
    });
  });

  // ─── writeGlobalStore / writeProjectStore ─────────────────────────────

  describe('writeGlobalStore', () => {
    it('writes store data to global-insights.json', async () => {
      const store = makeStore({ next_id: 5 });
      await manager.writeGlobalStore(store);

      const raw = JSON.parse(
        await readFile(manager.globalStorePath(), 'utf-8')
      );
      expect(raw.next_id).toBe(5);
    });

    it('creates the .knowledge/ directory if absent', async () => {
      await manager.writeGlobalStore(makeStore());
      const store = await manager.readGlobalStore();
      expect(store.next_id).toBe(1);
    });
  });

  describe('writeRepositoryStore', () => {
    it('writes store data to {repoName}-insights.json', async () => {
      const store = makeStore({ next_id: 3 });
      await manager.writeRepositoryStore('test-repo', store);

      const raw = JSON.parse(
        await readFile(manager.repositoryStorePath('test-repo'), 'utf-8')
      );
      expect(raw.next_id).toBe(3);
    });
  });

  // ─── addInsight ────────────────────────────────────────────────────────

  describe('addInsight', () => {
    it('writes a global-scoped insight to global-insights.json', async () => {
      const input = makeInsightInput({ scope: 'global' });
      const insight = await manager.addInsight(input);

      const store = await manager.readGlobalStore();
      expect(store.insights).toHaveLength(1);
      expect(store.insights[0].id).toBe(insight.id);
      expect(store.insights[0].scope).toBe('global');
    });

    it('writes a repository-scoped insight to {repoName}-insights.json', async () => {
      const input = makeInsightInput({
        scope: 'repository',
        repository_name: 'hcp-editor',
      });
      const insight = await manager.addInsight(input);

      const store = await manager.readRepositoryStore('hcp-editor');
      expect(store.insights).toHaveLength(1);
      expect(store.insights[0].id).toBe(insight.id);
      expect(store.insights[0].repository_name).toBe('hcp-editor');

      // Global store must remain empty
      const globalStore = await manager.readGlobalStore();
      expect(globalStore.insights).toHaveLength(0);
    });

    it('assigns id starting at 1 for the first insight', async () => {
      const insight = await manager.addInsight(makeInsightInput());
      expect(insight.id).toBe(1);
    });

    it('increments id for subsequent insights', async () => {
      const first = await manager.addInsight(makeInsightInput({ title: 'First' }));
      const second = await manager.addInsight(makeInsightInput({ title: 'Second' }));
      expect(first.id).toBe(1);
      expect(second.id).toBe(2);
    });

    it('counter persists across manager instances (simulates process restart)', async () => {
      // First write with initial manager
      await manager.addInsight(makeInsightInput({ title: 'Insight 1' }));

      // Create a new manager reading from same disk location
      const manager2 = new KnowledgeStoreManager(tempLedgerRoot);
      const insight2 = await manager2.addInsight(makeInsightInput({ title: 'Insight 2' }));

      expect(insight2.id).toBe(2);

      // Both insights present in the store
      const store = await manager2.readGlobalStore();
      expect(store.insights).toHaveLength(2);
    });

    it('throws when scope is "repository" but repository_name is missing', async () => {
      const input: Omit<Insight, 'id'> = {
        scope: 'repository',
        title: 'Test',
        content: 'Content',
        category: 'test',
        tags: [],
        source: 'WP-001',
        created_at: '2026-05-28T12:00:00Z',
        confidence: 0.5,
      };
      await expect(manager.addInsight(input)).rejects.toThrow('repository_name is required');
    });

    it('throws when repository_name contains path traversal characters', async () => {
      const input: Omit<Insight, 'id'> = {
        scope: 'repository',
        repository_name: '../evil',
        title: 'Test',
        content: 'Content',
        category: 'test',
        tags: [],
        source: 'WP-001',
        created_at: '2026-05-28T12:00:00Z',
        confidence: 0.5,
      };
      await expect(manager.addInsight(input)).rejects.toThrow('Invalid repository name');
    });

    it('preserves origin_plan metadata through add', async () => {
      const input = makeInsightInput({ origin_plan: 'my-plan-slug' });
      const insight = await manager.addInsight(input);
      expect(insight.origin_plan).toBe('my-plan-slug');
      const store = await manager.readGlobalStore();
      expect(store.insights[0].origin_plan).toBe('my-plan-slug');
    });

    it('returns the created insight with all input fields intact', async () => {
      const input = makeInsightInput({ title: 'Specific title' });
      const insight = await manager.addInsight(input);

      expect(insight.title).toBe('Specific title');
      expect(insight.scope).toBe('global');
      expect(insight.tags).toEqual(['node', 'filesystem']);
    });
  });

  // ─── searchInsights ────────────────────────────────────────────────────

  describe('searchInsights', () => {
    beforeEach(async () => {
      await manager.addInsight(makeInsightInput({
        title: 'Path joining strategy',
        content: 'Use path.join for all filesystem operations.',
        tags: ['filesystem', 'node'],
        category: 'best-practice',
        scope: 'global',
      }));
      await manager.addInsight(makeInsightInput({
        title: 'Error handling patterns',
        content: 'Always wrap async operations in try-catch.',
        tags: ['async', 'error'],
        category: 'pattern',
        scope: 'global',
      }));
      await manager.addInsight(makeInsightInput({
        title: 'Repository config tip',
        content: 'Store config in environment variables.',
        tags: ['config', 'environment'],
        category: 'pattern',
        scope: 'repository',
        repository_name: 'demo-repo',
      }));
    });

    it('matches query against title (case-insensitive)', async () => {
      const results = await manager.searchInsights('PATH');
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((r) => r.title.includes('Path'))).toBe(true);
    });

    it('matches query against content (case-insensitive)', async () => {
      const results = await manager.searchInsights('try-catch');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].content).toContain('try-catch');
    });

    it('matches query against tags (case-insensitive)', async () => {
      const results = await manager.searchInsights('FILESYSTEM');
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((r) => r.tags.includes('filesystem'))).toBe(true);
    });

    it('returns empty array when no match', async () => {
      const results = await manager.searchInsights('zzz-no-match-xyz');
      expect(results).toEqual([]);
    });

    it('searches across global and repository stores when no filter applied', async () => {
      const results = await manager.searchInsights('config');
      expect(results.some((r) => r.scope === 'repository')).toBe(true);
    });

    it('respects scope filter — only searches global store', async () => {
      const results = await manager.searchInsights('config', { scope: 'global' });
      expect(results.every((r) => r.scope === 'global')).toBe(true);
    });

    it('respects scope + repository_name filter', async () => {
      const results = await manager.searchInsights('config', {
        scope: 'repository',
        repository_name: 'demo-repo',
      });
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].repository_name).toBe('demo-repo');
    });

    it('narrows to named repository when repository_name is given without scope', async () => {
      // Only 'demo-repo' has a 'config' insight; global store has none
      const results = await manager.searchInsights('config', { repository_name: 'demo-repo' });
      expect(results.length).toBeGreaterThan(0);
      expect(results.every((r) => r.repository_name === 'demo-repo')).toBe(true);
      // Must NOT include global insights (global store has no 'config' content, but
      // confirm no global-scoped results leak through)
      expect(results.every((r) => r.scope === 'repository')).toBe(true);
    });

    it('returns empty array when knowledge directory does not exist', async () => {
      const emptyManager = new KnowledgeStoreManager(join(tmpdir(), 'does-not-exist-' + Date.now()));
      const results = await emptyManager.searchInsights('test');
      expect(results).toEqual([]);
    });

    // ── WP-005 additions ──────────────────────────────────────────────────

    it('tags filter narrows searchInsights results to insights that include all specified tags', async () => {
      // 'filesystem' insight has tags ['filesystem', 'node']
      // 'error' insight has tags ['async', 'error']
      // searching 'PATH' matches the filesystem insight; tag filter ['filesystem'] should keep it
      const resultsWithTag = await manager.searchInsights('PATH', { tags: ['filesystem'] });
      expect(resultsWithTag.length).toBeGreaterThan(0);
      expect(resultsWithTag.every((r) => r.tags.includes('filesystem'))).toBe(true);

      // tag filter that does not match any result of the query should return empty
      const resultsNoMatch = await manager.searchInsights('PATH', { tags: ['async'] });
      expect(resultsNoMatch).toEqual([]);
    });

    it('limit/offset paginates searchInsights results after text filtering', async () => {
      // Add extra insights so we have enough data to paginate against.
      // 'config' matches the project insight added in beforeEach; add more global ones too.
      await manager.addInsight(makeInsightInput({
        title: 'Config tip 2',
        content: 'Another config insight.',
        tags: ['config'],
        scope: 'global',
      }));
      await manager.addInsight(makeInsightInput({
        title: 'Config tip 3',
        content: 'Yet another config insight.',
        tags: ['config'],
        scope: 'global',
      }));

      // All results for 'config'
      const all = await manager.searchInsights('config');
      expect(all.length).toBeGreaterThanOrEqual(3);

      // First page: limit=2, offset=0
      const page1 = await manager.searchInsights('config', { limit: 2, offset: 0 });
      expect(page1).toHaveLength(2);
      expect(page1[0]).toEqual(all[0]);
      expect(page1[1]).toEqual(all[1]);

      // Second page: limit=2, offset=2
      const page2 = await manager.searchInsights('config', { limit: 2, offset: 2 });
      expect(page2.length).toBeGreaterThanOrEqual(1);
      expect(page2[0]).toEqual(all[2]);
    });

    it('combined query + tags filter returns only text-matching insights that also contain all specified tags', async () => {
      // 'config' substring matches the project insight (tags: ['config', 'environment'])
      // and any others added above (tags: ['config'])
      // filter by tag 'environment' — only the original project insight has that tag
      const results = await manager.searchInsights('config', { tags: ['environment'] });
      expect(results.length).toBeGreaterThan(0);
      expect(results.every((r) => r.tags.includes('environment'))).toBe(true);
      // Must not include any insight that matched only on text but lacks the 'environment' tag
      expect(results.every((r) => r.content.toLowerCase().includes('config') ||
        r.title.toLowerCase().includes('config') ||
        r.tags.some((t) => t.toLowerCase().includes('config'))
      )).toBe(true);
    });
  });

  // ─── listInsights ──────────────────────────────────────────────────────

  describe('listInsights', () => {
    beforeEach(async () => {
      for (let i = 1; i <= 5; i++) {
        await manager.addInsight(makeInsightInput({
          title: `Insight ${i}`,
          category: i % 2 === 0 ? 'pattern' : 'best-practice',
          tags: i <= 3 ? ['alpha'] : ['beta'],
          scope: 'global',
        }));
      }
      await manager.addInsight(makeInsightInput({
        title: 'Repository insight',
        category: 'pattern',
        tags: ['beta'],
        scope: 'repository',
        repository_name: 'sample-repo',
      }));
    });

    it('returns all insights when no filters', async () => {
      const results = await manager.listInsights({});
      expect(results).toHaveLength(6);
    });

    it('filters by category', async () => {
      const results = await manager.listInsights({ category: 'pattern' });
      expect(results.every((r) => r.category === 'pattern')).toBe(true);
    });

    it('filters by tags (every tag must match)', async () => {
      const results = await manager.listInsights({ tags: ['alpha'] });
      expect(results.every((r) => r.tags.includes('alpha'))).toBe(true);
      expect(results).toHaveLength(3);
    });

    it('filters by scope: global', async () => {
      const results = await manager.listInsights({ scope: 'global' });
      expect(results).toHaveLength(5);
      expect(results.every((r) => r.scope === 'global')).toBe(true);
    });

    it('filters by scope: repository + repository_name', async () => {
      const results = await manager.listInsights({
        scope: 'repository',
        repository_name: 'sample-repo',
      });
      expect(results).toHaveLength(1);
      expect(results[0].repository_name).toBe('sample-repo');
    });

    it('narrows to named repository when repository_name is given without scope', async () => {
      const results = await manager.listInsights({ repository_name: 'sample-repo' });
      expect(results).toHaveLength(1);
      expect(results[0].repository_name).toBe('sample-repo');
      expect(results[0].scope).toBe('repository');
      // Global insights must not appear
      expect(results.every((r) => r.scope === 'repository')).toBe(true);
    });

    it('respects limit', async () => {
      const results = await manager.listInsights({ limit: 2 });
      expect(results).toHaveLength(2);
    });

    it('respects offset', async () => {
      const all = await manager.listInsights({});
      const paged = await manager.listInsights({ offset: 2 });
      expect(paged).toHaveLength(all.length - 2);
      expect(paged[0].id).toBe(all[2].id);
    });

    it('applies limit + offset together for pagination', async () => {
      const page1 = await manager.listInsights({ limit: 2, offset: 0 });
      const page2 = await manager.listInsights({ limit: 2, offset: 2 });
      expect(page1).toHaveLength(2);
      expect(page2).toHaveLength(2);
      expect(page1[0].id).not.toBe(page2[0].id);
    });

    it('returns empty array when offset exceeds total', async () => {
      const results = await manager.listInsights({ offset: 100 });
      expect(results).toEqual([]);
    });
  });

  // ─── updateInsight ─────────────────────────────────────────────────────

  describe('updateInsight', () => {
    it('updates specified fields of a global insight', async () => {
      const { id } = await manager.addInsight(makeInsightInput());

      const updated = await manager.updateInsight(id, {
        title: 'Updated title',
        confidence: 1.0,
      });

      expect(updated.title).toBe('Updated title');
      expect(updated.confidence).toBe(1.0);
      expect(updated.id).toBe(id);
    });

    it('sets updated_at on update', async () => {
      const { id } = await manager.addInsight(makeInsightInput());
      const updated = await manager.updateInsight(id, { title: 'New title' });
      expect(typeof updated.updated_at).toBe('string');
      expect(updated.updated_at).toBeTruthy();
    });

    it('persists updates to disk', async () => {
      const { id } = await manager.addInsight(makeInsightInput());
      await manager.updateInsight(id, { title: 'Persisted title' });

      const store = await manager.readGlobalStore();
      const found = store.insights.find((i) => i.id === id);
      expect(found?.title).toBe('Persisted title');
    });

    it('sets superseded_by when provided', async () => {
      const first = await manager.addInsight(makeInsightInput({ title: 'Old' }));
      const second = await manager.addInsight(makeInsightInput({ title: 'New' }));

      const updated = await manager.updateInsight(first.id, {
        superseded_by: second.id,
      });
      expect(updated.superseded_by).toBe(second.id);
    });

    it('updates a repository-scoped insight', async () => {
      const { id } = await manager.addInsight(
        makeInsightInput({ scope: 'repository', repository_name: 'repo-a' })
      );

      const updated = await manager.updateInsight(id, { title: 'Repository update' });
      expect(updated.title).toBe('Repository update');

      const store = await manager.readRepositoryStore('repo-a');
      expect(store.insights.find((i) => i.id === id)?.title).toBe('Repository update');
    });

    it('throws when insight id does not exist', async () => {
      await expect(manager.updateInsight(9999, { title: 'Nope' })).rejects.toThrow(
        'Insight with id 9999 not found'
      );
    });

    it('does not mutate immutable fields (scope, repository_name, created_at)', async () => {
      const input = makeInsightInput({ scope: 'global', created_at: '2026-01-01T00:00:00Z' });
      const { id } = await manager.addInsight(input);

      const updated = await manager.updateInsight(id, { title: 'Changed' });
      expect(updated.scope).toBe('global');
      expect(updated.created_at).toBe('2026-01-01T00:00:00Z');
    });

    it('scope filter — targets global store when scope is "global"', async () => {
      // Both stores will have an insight with the same numeric id (id=1).
      // The global store is added first so its next_id starts at 1.
      const { id: globalId } = await manager.addInsight(makeInsightInput({ title: 'Global one' }));
      await manager.addInsight(
        makeInsightInput({ scope: 'repository', repository_name: 'filter-test', title: 'Repository one' })
      );

      // Verify id collision: both stores start at next_id=1
      expect(globalId).toBe(1);
      const repoStore = await manager.readRepositoryStore('filter-test');
      expect(repoStore.insights[0].id).toBe(1);

      // Update with scope filter — must touch only global store
      const updated = await manager.updateInsight(globalId, { title: 'Global updated' }, { scope: 'global' });
      expect(updated.title).toBe('Global updated');
      expect(updated.scope).toBe('global');

      // Repository store must be untouched
      const repoStoreAfter = await manager.readRepositoryStore('filter-test');
      expect(repoStoreAfter.insights[0].title).toBe('Repository one');
    });

    it('scope filter — targets repository store when scope+repository_name are provided', async () => {
      const { id: globalId } = await manager.addInsight(makeInsightInput({ title: 'Global one' }));
      await manager.addInsight(
        makeInsightInput({ scope: 'repository', repository_name: 'scoped-repo', title: 'Repository one' })
      );
      expect(globalId).toBe(1);

      // Update with scope + repository_name filter — must touch only repository store
      const updated = await manager.updateInsight(
        1,
        { title: 'Repository updated' },
        { scope: 'repository', repository_name: 'scoped-repo' }
      );
      expect(updated.title).toBe('Repository updated');
      expect(updated.scope).toBe('repository');

      // Global store must be untouched
      const globalStore = await manager.readGlobalStore();
      expect(globalStore.insights[0].title).toBe('Global one');
    });

    it('repository_name filter (without scope) targets only the specified repository store', async () => {
      await manager.addInsight(makeInsightInput({ title: 'Global one' }));
      await manager.addInsight(
        makeInsightInput({ scope: 'repository', repository_name: 'name-only', title: 'Repository one' })
      );

      const updated = await manager.updateInsight(
        1,
        { title: 'Name-only updated' },
        { repository_name: 'name-only' }
      );
      expect(updated.title).toBe('Name-only updated');
      expect(updated.repository_name).toBe('name-only');

      const globalStore = await manager.readGlobalStore();
      expect(globalStore.insights[0].title).toBe('Global one');
    });

    it('throws when the filtered stores do not contain the specified id', async () => {
      const { id } = await manager.addInsight(makeInsightInput({ title: 'Global only' }));

      // Filter to a repository store that does not have this id
      await expect(
        manager.updateInsight(id, { title: 'Nope' }, { scope: 'repository', repository_name: 'empty-repo' })
      ).rejects.toThrow(`Insight with id ${id} not found`);
    });

    it('preserves origin_plan metadata through update', async () => {
      const input = makeInsightInput({ origin_plan: 'plan-alpha' });
      const { id } = await manager.addInsight(input);
      const updated = await manager.updateInsight(id, { title: 'Updated title' });
      expect(updated.origin_plan).toBe('plan-alpha');
    });
  });

  // ─── deleteInsight ─────────────────────────────────────────────────────

  describe('deleteInsight', () => {
    it('removes a global insight from the store', async () => {
      const { id } = await manager.addInsight(makeInsightInput());
      await manager.deleteInsight(id);

      const store = await manager.readGlobalStore();
      expect(store.insights.find((i) => i.id === id)).toBeUndefined();
    });

    it('store can be re-read correctly after deletion', async () => {
      await manager.addInsight(makeInsightInput({ title: 'Keep me' }));
      const { id } = await manager.addInsight(makeInsightInput({ title: 'Delete me' }));

      await manager.deleteInsight(id);

      const store = await manager.readGlobalStore();
      expect(store.insights).toHaveLength(1);
      expect(store.insights[0].title).toBe('Keep me');
    });

    it('removes a repository-scoped insight from the correct store', async () => {
      const { id } = await manager.addInsight(
        makeInsightInput({ scope: 'repository', repository_name: 'del-test' })
      );
      await manager.deleteInsight(id);

      const store = await manager.readRepositoryStore('del-test');
      expect(store.insights.find((i) => i.id === id)).toBeUndefined();
    });

    it('throws when insight id does not exist', async () => {
      await expect(manager.deleteInsight(9999)).rejects.toThrow(
        'Insight with id 9999 not found'
      );
    });

    it('does not affect other insights in the same store', async () => {
      await manager.addInsight(makeInsightInput({ title: 'Stay' }));
      const { id } = await manager.addInsight(makeInsightInput({ title: 'Go' }));

      await manager.deleteInsight(id);

      const store = await manager.readGlobalStore();
      expect(store.insights).toHaveLength(1);
      expect(store.insights[0].title).toBe('Stay');
    });

    it('scope filter — deletes from global store only when scope is "global"', async () => {
      const { id: globalId } = await manager.addInsight(makeInsightInput({ title: 'Global one' }));
      await manager.addInsight(
        makeInsightInput({ scope: 'repository', repository_name: 'del-scope', title: 'Repository one' })
      );
      expect(globalId).toBe(1);

      await manager.deleteInsight(globalId, { scope: 'global' });

      const globalStore = await manager.readGlobalStore();
      expect(globalStore.insights).toHaveLength(0);

      const repoStore = await manager.readRepositoryStore('del-scope');
      expect(repoStore.insights).toHaveLength(1);
      expect(repoStore.insights[0].title).toBe('Repository one');
    });

    it('scope filter — deletes from repository store only when scope+repository_name are provided', async () => {
      await manager.addInsight(makeInsightInput({ title: 'Global one' }));
      await manager.addInsight(
        makeInsightInput({ scope: 'repository', repository_name: 'del-repo', title: 'Repository one' })
      );

      await manager.deleteInsight(1, { scope: 'repository', repository_name: 'del-repo' });

      const repoStore = await manager.readRepositoryStore('del-repo');
      expect(repoStore.insights).toHaveLength(0);

      const globalStore = await manager.readGlobalStore();
      expect(globalStore.insights).toHaveLength(1);
      expect(globalStore.insights[0].title).toBe('Global one');
    });

    it('throws when filtered stores do not contain the specified id', async () => {
      const { id } = await manager.addInsight(makeInsightInput({ title: 'Global only' }));

      await expect(
        manager.deleteInsight(id, { scope: 'repository', repository_name: 'non-existent' })
      ).rejects.toThrow(`Insight with id ${id} not found`);
    });
  });

  // ─── moveInsight ───────────────────────────────────────────────────────

  describe('moveInsight', () => {
    it('happy path: moves a global insight into a repository store', async () => {
      const { id } = await manager.addInsight(makeInsightInput({ scope: 'global', title: 'Global insight' }));

      const moved = await manager.moveInsight(
        id,
        { scope: 'global' },
        'repository',
        'target-repo'
      );

      expect(moved.scope).toBe('repository');
      expect(moved.repository_name).toBe('target-repo');

      // Moved insight appears in the target repository store
      const targetStore = await manager.readRepositoryStore('target-repo');
      expect(targetStore.insights).toHaveLength(1);
      expect(targetStore.insights[0].id).toBe(moved.id);

      // Original global store no longer contains the insight
      const globalStore = await manager.readGlobalStore();
      expect(globalStore.insights.find((i) => i.id === id)).toBeUndefined();
    });

    it('happy path: moves a repository insight into the global store', async () => {
      const { id } = await manager.addInsight(
        makeInsightInput({ scope: 'repository', repository_name: 'source-repo', title: 'Repository insight' })
      );

      const moved = await manager.moveInsight(
        id,
        { scope: 'repository', repository_name: 'source-repo' },
        'global'
      );

      expect(moved.scope).toBe('global');
      expect(moved.repository_name).toBeUndefined();

      // Moved insight appears in the global store
      const globalStore = await manager.readGlobalStore();
      expect(globalStore.insights).toHaveLength(1);
      expect(globalStore.insights[0].id).toBe(moved.id);

      // Source repository store no longer contains the insight
      const sourceStore = await manager.readRepositoryStore('source-repo');
      expect(sourceStore.insights.find((i) => i.id === id)).toBeUndefined();
    });

    it('happy path: moves an insight from one repository to another (different names)', async () => {
      const { id } = await manager.addInsight(
        makeInsightInput({ scope: 'repository', repository_name: 'repo-a', title: 'Repo A insight' })
      );

      const moved = await manager.moveInsight(
        id,
        { scope: 'repository', repository_name: 'repo-a' },
        'repository',
        'repo-b'
      );

      expect(moved.scope).toBe('repository');
      expect(moved.repository_name).toBe('repo-b');

      const targetStore = await manager.readRepositoryStore('repo-b');
      expect(targetStore.insights).toHaveLength(1);

      const sourceStore = await manager.readRepositoryStore('repo-a');
      expect(sourceStore.insights.find((i) => i.id === id)).toBeUndefined();
    });

    it('throws when attempting an identity move (same repository → same repository)', async () => {
      const { id } = await manager.addInsight(
        makeInsightInput({ scope: 'repository', repository_name: 'same-repo', title: 'Insight' })
      );

      await expect(
        manager.moveInsight(
          id,
          { scope: 'repository', repository_name: 'same-repo' },
          'repository',
          'same-repo'
        )
      ).rejects.toThrow('Cannot move insight to the same repository store: "same-repo"');
    });

    it('throws when the insight id is not found in the source store', async () => {
      await expect(
        manager.moveInsight(9999, { scope: 'global' }, 'repository', 'some-repo')
      ).rejects.toThrow('Insight with id 9999 not found');
    });

    it('returned insight has a new id from the target store, correct scope, and a fresh updated_at', async () => {
      // Pre-seed the target repository store with one insight so its next_id is 2.
      // This lets us verify the moved insight receives the target store's next_id
      // rather than the source store's id (which is also 1 for an empty global store).
      await manager.addInsight(
        makeInsightInput({ scope: 'repository', repository_name: 'new-repo', title: 'Existing in target' })
      );

      const { id: originalId } = await manager.addInsight(
        makeInsightInput({ scope: 'global', title: 'Move me' })
      );

      // Source global store next_id is 1 → originalId is 1.
      // Target repository store next_id is 2 → moved.id should be 2.
      expect(originalId).toBe(1);

      const moved = await manager.moveInsight(
        originalId,
        { scope: 'global' },
        'repository',
        'new-repo'
      );

      // New id is from target store's next_id (2, because the target already had one insight)
      expect(typeof moved.id).toBe('number');
      expect(moved.id).toBe(2);
      expect(moved.id).not.toBe(originalId);

      // Scope is correct
      expect(moved.scope).toBe('repository');
      expect(moved.repository_name).toBe('new-repo');

      // updated_at is set and is a valid ISO 8601 timestamp string.
      // now() truncates to whole seconds, so we just verify it is a parseable date
      // rather than doing a sub-second millisecond comparison.
      expect(typeof moved.updated_at).toBe('string');
      expect(moved.updated_at).toBeTruthy();
      expect(isNaN(new Date(moved.updated_at!).getTime())).toBe(false);
    });

    it('source store no longer contains the original insight after move', async () => {
      const first = await manager.addInsight(makeInsightInput({ title: 'Stay in global' }));
      const second = await manager.addInsight(makeInsightInput({ title: 'Move me out' }));

      await manager.moveInsight(
        second.id,
        { scope: 'global' },
        'repository',
        'dest-repo'
      );

      const globalStore = await manager.readGlobalStore();
      expect(globalStore.insights.find((i) => i.id === second.id)).toBeUndefined();
      // The remaining global insight is still there
      expect(globalStore.insights.find((i) => i.id === first.id)).toBeDefined();
    });

    it('target store next_id is incremented after move', async () => {
      const { id } = await manager.addInsight(makeInsightInput({ scope: 'global', title: 'To move' }));

      // Pre-condition: target repository store starts with next_id = 1
      const targetBefore = await manager.readRepositoryStore('incr-repo');
      expect(targetBefore.next_id).toBe(1);

      await manager.moveInsight(id, { scope: 'global' }, 'repository', 'incr-repo');

      // Post-condition: target store next_id is now 2
      const targetAfter = await manager.readRepositoryStore('incr-repo');
      expect(targetAfter.next_id).toBe(2);
    });

    it('preserves origin_plan metadata through move', async () => {
      const { id } = await manager.addInsight(
        makeInsightInput({ scope: 'global', title: 'Has origin plan', origin_plan: 'plan-beta' })
      );

      const moved = await manager.moveInsight(
        id,
        { scope: 'global' },
        'repository',
        'destination-repo'
      );

      expect(moved.origin_plan).toBe('plan-beta');
      const store = await manager.readRepositoryStore('destination-repo');
      expect(store.insights[0].origin_plan).toBe('plan-beta');
    });
  });

  // ─── Concurrent Write Safety ───────────────────────────────────────────

  describe('concurrent write safety', () => {
    it('serializes concurrent addInsight calls — all insights are written with unique ids', async () => {
      const N = 8;
      const promises = Array.from({ length: N }, (_, i) =>
        manager.addInsight(makeInsightInput({ title: `Concurrent insight ${i + 1}` }))
      );

      const insights = await Promise.all(promises);

      const ids = insights.map((i) => i.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(N);

      // Verify all insights are in the store
      const store = await manager.readGlobalStore();
      expect(store.insights).toHaveLength(N);
      expect(store.next_id).toBe(N + 1);
    });
  });
});
