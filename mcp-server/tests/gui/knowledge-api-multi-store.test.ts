/**
 * WP-007: Knowledge Handler Unit Tests
 *
 * 30 test cases covering all 5 REST handler functions:
 * - handleListKnowledge       (7 cases)
 * - handleUpdateKnowledge     (6 cases, including scope disambiguation)
 * - handleDeleteKnowledge     (4 cases, including scope disambiguation)
 * - handlePromoteKnowledge    (5 cases, including scope disambiguation)
 * - handleMoveKnowledge       (6 cases, including scope disambiguation)
 * - parseKnowledgeId          (6 cases — tested indirectly: each case calls both handleDeleteKnowledge
 *                               and handleUpdateKnowledge, both of which invoke parseKnowledgeId
 *                               internally, providing dual-handler coverage for the private helper)
 *
 * Uses real temp directories and KnowledgeStoreManager for fixture setup
 * (no mocks of the storage layer). Follows the pattern established in
 * tests/gui/api.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

import {
  handleListKnowledge,
  handleUpdateKnowledge,
  handleDeleteKnowledge,
  handlePromoteKnowledge,
  handleMoveKnowledge,
  ApiError,
} from '../../gui/api-knowledge.js';
import { KnowledgeStoreManager } from '../../src/storage/knowledge-store.js';
import { setStoreContext } from '../../src/storage/store-context.js';
import { StoreRouter } from '../../src/storage/store-router.js';
import { MultiStoreManager } from '../../src/storage/multi-store-manager.js';
import type { Insight } from '../../src/schema/knowledge.js';
import type { StoresConfig } from '../../src/schema/store-config.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal valid insight input (no id). */
function makeInsightInput(overrides: Partial<Omit<Insight, 'id'>> = {}): Omit<Insight, 'id'> {
  return {
    scope: 'global',
    title: 'Default title',
    content: 'Default content',
    category: 'general',
    tags: [],
    source: 'test',
    created_at: '2026-01-01T00:00:00Z',
    confidence: 0.8,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// handleListKnowledge (7 cases)
// ---------------------------------------------------------------------------

describe('handleListKnowledge', () => {
  let ledgerRoot: string;
  let manager: KnowledgeStoreManager;

  beforeEach(async () => {
    ledgerRoot = await mkdtemp(join(tmpdir(), 'knowledge-api-list-'));
    manager = new KnowledgeStoreManager(ledgerRoot);
  });

  afterEach(async () => {
    await rm(ledgerRoot, { recursive: true, force: true });
  });

  it('no filters returns all insights', async () => {
    await manager.addInsight(makeInsightInput({ scope: 'global', title: 'Global insight' }));
    await manager.addInsight(
      makeInsightInput({ scope: 'repository', repository_name: 'my-repo', title: 'Repository insight' })
    );

    const result = await handleListKnowledge(ledgerRoot);
    expect(result).toHaveLength(2);
    const titles = result.map((i) => i.title);
    expect(titles).toContain('Global insight');
    expect(titles).toContain('Repository insight');
  });

  it('scope:global returns only global', async () => {
    await manager.addInsight(makeInsightInput({ scope: 'global', title: 'Global' }));
    await manager.addInsight(
      makeInsightInput({ scope: 'repository', repository_name: 'repo', title: 'Repository' })
    );

    const result = await handleListKnowledge(ledgerRoot, { scope: 'global' });
    expect(result).toHaveLength(1);
    expect(result[0]!.scope).toBe('global');
    expect(result[0]!.title).toBe('Global');
  });

  it('scope:repository + repository_name filters to one repository', async () => {
    await manager.addInsight(makeInsightInput({ scope: 'global', title: 'Global' }));
    await manager.addInsight(
      makeInsightInput({ scope: 'repository', repository_name: 'alpha', title: 'Alpha insight' })
    );
    await manager.addInsight(
      makeInsightInput({ scope: 'repository', repository_name: 'beta', title: 'Beta insight' })
    );

    const result = await handleListKnowledge(ledgerRoot, {
      scope: 'repository',
      repository_name: 'alpha',
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.title).toBe('Alpha insight');
    expect(result[0]!.repository_name).toBe('alpha');
  });

  it('category filter', async () => {
    await manager.addInsight(makeInsightInput({ title: 'Best practice A', category: 'best-practice' }));
    await manager.addInsight(makeInsightInput({ title: 'Pattern', category: 'pattern' }));
    await manager.addInsight(makeInsightInput({ title: 'Best practice B', category: 'best-practice' }));

    const result = await handleListKnowledge(ledgerRoot, { category: 'best-practice' });
    expect(result).toHaveLength(2);
    expect(result.every((i) => i.category === 'best-practice')).toBe(true);
  });

  it('tags filter (comma-separated string parsed correctly)', async () => {
    await manager.addInsight(
      makeInsightInput({ title: 'Node insight', tags: ['node', 'backend'] })
    );
    await manager.addInsight(
      makeInsightInput({ title: 'Frontend insight', tags: ['frontend', 'css'] })
    );
    await manager.addInsight(
      makeInsightInput({ title: 'Full stack', tags: ['node', 'frontend'] })
    );

    // Only insights that have BOTH 'node' and 'backend'
    const result = await handleListKnowledge(ledgerRoot, { tags: 'node,backend' });
    expect(result).toHaveLength(1);
    expect(result[0]!.title).toBe('Node insight');
  });

  it('query triggers searchInsights, returns text matches', async () => {
    await manager.addInsight(
      makeInsightInput({ title: 'Atomic writes are important', content: 'Use atomic writes.' })
    );
    await manager.addInsight(
      makeInsightInput({ title: 'File locking', content: 'Use proper file locks.' })
    );
    await manager.addInsight(
      makeInsightInput({ title: 'Indexing strategy', tags: ['atomic', 'index'] })
    );

    const result = await handleListKnowledge(ledgerRoot, { query: 'atomic' });
    expect(result.length).toBeGreaterThanOrEqual(1);
    const titles = result.map((i) => i.title);
    expect(titles).toContain('Atomic writes are important');
  });

  it('empty store returns empty array', async () => {
    const result = await handleListKnowledge(ledgerRoot);
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// handleUpdateKnowledge (6 cases)
// ---------------------------------------------------------------------------

describe('handleUpdateKnowledge', () => {
  let ledgerRoot: string;
  let manager: KnowledgeStoreManager;

  beforeEach(async () => {
    ledgerRoot = await mkdtemp(join(tmpdir(), 'knowledge-api-update-'));
    manager = new KnowledgeStoreManager(ledgerRoot);
  });

  afterEach(async () => {
    await rm(ledgerRoot, { recursive: true, force: true });
  });

  it('updates title and returns updated insight', async () => {
    const created = await manager.addInsight(makeInsightInput({ title: 'Original title' }));

    const updated = await handleUpdateKnowledge(ledgerRoot, String(created.id), {
      scope: 'global',
      title: 'Updated title',
    });

    expect(updated.id).toBe(created.id);
    expect(updated.title).toBe('Updated title');
    expect(updated.content).toBe('Default content');
  });

  it('clears superseded_by when null is passed', async () => {
    const created = await manager.addInsight(
      makeInsightInput({ title: 'Superseded', superseded_by: '00000000-0000-0000-0000-000000000099' })
    );
    expect(created.superseded_by).toBe('00000000-0000-0000-0000-000000000099');

    const updated = await handleUpdateKnowledge(ledgerRoot, String(created.id), {
      scope: 'global',
      superseded_by: null,
    });

    expect(updated.superseded_by).toBeUndefined();
  });

  it('throws NOT_FOUND for unknown id', async () => {
    await expect(
      handleUpdateKnowledge(ledgerRoot, '00000000-0000-0000-0000-000000000000', { scope: 'global', title: 'x' })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('throws VALIDATION_ERROR for non-UUID id', async () => {
    await expect(
      handleUpdateKnowledge(ledgerRoot, 'abc', { scope: 'global', title: 'x' })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('throws VALIDATION_ERROR for extra body fields', async () => {
    await expect(
      handleUpdateKnowledge(ledgerRoot, '00000000-0000-0000-0000-000000000001', { scope: 'global', unknownField: 'bad' })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('updates insight in global store, not repository insight (scope disambiguation)', async () => {
    const globalInsight = await manager.addInsight(
      makeInsightInput({ scope: 'global', title: 'Global insight' })
    );
    const repoInsight = await manager.addInsight(
      makeInsightInput({ scope: 'repository', repository_name: 'repo-a', title: 'Repository insight' })
    );

    // Update only the global-scoped insight by UUID
    const updated = await handleUpdateKnowledge(ledgerRoot, String(globalInsight.id), {
      scope: 'global',
      title: 'Updated global',
    });

    expect(updated.title).toBe('Updated global');
    expect(updated.scope).toBe('global');

    // Verify repository insight is unchanged
    const repoInsights = await manager.listInsights({
      scope: 'repository',
      repository_name: 'repo-a',
    });
    expect(repoInsights[0]!.title).toBe('Repository insight');
  });
});

// ---------------------------------------------------------------------------
// handleDeleteKnowledge (4 cases)
// ---------------------------------------------------------------------------

describe('handleDeleteKnowledge', () => {
  let ledgerRoot: string;
  let manager: KnowledgeStoreManager;

  beforeEach(async () => {
    ledgerRoot = await mkdtemp(join(tmpdir(), 'knowledge-api-delete-'));
    manager = new KnowledgeStoreManager(ledgerRoot);
  });

  afterEach(async () => {
    await rm(ledgerRoot, { recursive: true, force: true });
  });

  it('removes insight from store', async () => {
    const created = await manager.addInsight(makeInsightInput({ title: 'To delete' }));

    const result = await handleDeleteKnowledge(ledgerRoot, String(created.id), 'global');

    expect(result).toBeNull();

    const remaining = await manager.listInsights({ scope: 'global' });
    expect(remaining).toHaveLength(0);
  });

  it('throws NOT_FOUND for unknown id', async () => {
    await expect(
      handleDeleteKnowledge(ledgerRoot, '00000000-0000-0000-0000-000000000000', 'global')
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('throws VALIDATION_ERROR for id=0', async () => {
    await expect(
      handleDeleteKnowledge(ledgerRoot, '0', 'global')
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('deletes insight in repository store, not global insight (scope disambiguation)', async () => {
    const globalInsight = await manager.addInsight(
      makeInsightInput({ scope: 'global', title: 'Global insight' })
    );
    const repoInsight = await manager.addInsight(
      makeInsightInput({ scope: 'repository', repository_name: 'repo-a', title: 'Repository insight' })
    );

    // Delete only the repository-scoped insight by UUID
    const result = await handleDeleteKnowledge(ledgerRoot, String(repoInsight.id), 'repository', 'repo-a');
    expect(result).toBeNull();

    // Repository insight is gone
    const repoInsights = await manager.listInsights({
      scope: 'repository',
      repository_name: 'repo-a',
    });
    expect(repoInsights).toHaveLength(0);

    // Global insight is untouched
    const globalInsights = await manager.listInsights({ scope: 'global' });
    expect(globalInsights).toHaveLength(1);
    expect(globalInsights[0]!.title).toBe('Global insight');
  });
});

// ---------------------------------------------------------------------------
// handlePromoteKnowledge (5 cases)
// ---------------------------------------------------------------------------

describe('handlePromoteKnowledge', () => {
  let ledgerRoot: string;
  let manager: KnowledgeStoreManager;

  beforeEach(async () => {
    ledgerRoot = await mkdtemp(join(tmpdir(), 'knowledge-api-promote-'));
    manager = new KnowledgeStoreManager(ledgerRoot);
  });

  afterEach(async () => {
    await rm(ledgerRoot, { recursive: true, force: true });
  });

  it('repository insight appears in global store', async () => {
    const original = await manager.addInsight(
      makeInsightInput({ scope: 'repository', repository_name: 'my-repo', title: 'To promote' })
    );

    const promoted = await handlePromoteKnowledge(
      ledgerRoot,
      String(original.id),
      'repository',
      'my-repo'
    );

    expect(promoted.scope).toBe('global');
    expect(promoted.title).toBe('To promote');
    expect(promoted.repository_name).toBeUndefined();

    const globalInsights = await manager.listInsights({ scope: 'global' });
    expect(globalInsights.some((i) => i.title === 'To promote')).toBe(true);
  });

  it('original repository insight is removed', async () => {
    const original = await manager.addInsight(
      makeInsightInput({ scope: 'repository', repository_name: 'my-repo', title: 'Will be removed' })
    );

    await handlePromoteKnowledge(ledgerRoot, String(original.id), 'repository', 'my-repo');

    const remaining = await manager.listInsights({
      scope: 'repository',
      repository_name: 'my-repo',
    });
    expect(remaining).toHaveLength(0);
  });

  it('throws VALIDATION_ERROR if already global', async () => {
    const global = await manager.addInsight(
      makeInsightInput({ scope: 'global', title: 'Already global' })
    );

    await expect(
      handlePromoteKnowledge(ledgerRoot, String(global.id), 'global')
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('throws NOT_FOUND for unknown id', async () => {
    await expect(
      handlePromoteKnowledge(ledgerRoot, '00000000-0000-0000-0000-000000000000', 'repository', 'my-repo')
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('promotes correct insight when scope+repository_name disambiguate the target', async () => {
    const globalInsight = await manager.addInsight(
      makeInsightInput({ scope: 'global', title: 'Global insight' })
    );
    const repoInsight = await manager.addInsight(
      makeInsightInput({ scope: 'repository', repository_name: 'repo-a', title: 'Repository insight' })
    );

    // Promote the repository insight by UUID
    const promoted = await handlePromoteKnowledge(ledgerRoot, String(repoInsight.id), 'repository', 'repo-a');

    expect(promoted.scope).toBe('global');
    expect(promoted.title).toBe('Repository insight');

    // The original repository insight is gone
    const repoInsights = await manager.listInsights({
      scope: 'repository',
      repository_name: 'repo-a',
    });
    expect(repoInsights).toHaveLength(0);

    // The original global insight is untouched
    const globalInsights = await manager.listInsights({ scope: 'global' });
    expect(globalInsights.length).toBe(2); // original global + promoted copy
    const titles = globalInsights.map((i) => i.title);
    expect(titles).toContain('Global insight');
    expect(titles).toContain('Repository insight');
  });
});

// ---------------------------------------------------------------------------
// handleMoveKnowledge (6 cases)
// ---------------------------------------------------------------------------

describe('handleMoveKnowledge', () => {
  let ledgerRoot: string;
  let manager: KnowledgeStoreManager;

  beforeEach(async () => {
    ledgerRoot = await mkdtemp(join(tmpdir(), 'knowledge-api-move-'));
    manager = new KnowledgeStoreManager(ledgerRoot);
  });

  afterEach(async () => {
    await rm(ledgerRoot, { recursive: true, force: true });
  });

  it('global insight moves to named repository', async () => {
    const global = await manager.addInsight(
      makeInsightInput({ scope: 'global', title: 'Will move to repository' })
    );

    const moved = await handleMoveKnowledge(ledgerRoot, String(global.id), {
      source_scope: 'global',
      repository_name: 'target-repo',
    });

    expect(moved.scope).toBe('repository');
    expect(moved.repository_name).toBe('target-repo');
    expect(moved.title).toBe('Will move to repository');

    // Original global insight is gone
    const globalInsights = await manager.listInsights({ scope: 'global' });
    expect(globalInsights).toHaveLength(0);
  });

  it('repository insight moves to different repository', async () => {
    const original = await manager.addInsight(
      makeInsightInput({
        scope: 'repository',
        repository_name: 'repo-a',
        title: 'Move between repositories',
      })
    );

    const moved = await handleMoveKnowledge(ledgerRoot, String(original.id), {
      source_scope: 'repository',
      source_repository_name: 'repo-a',
      repository_name: 'repo-b',
    });

    expect(moved.scope).toBe('repository');
    expect(moved.repository_name).toBe('repo-b');
    expect(moved.title).toBe('Move between repositories');

    // Original is gone
    const repoAInsights = await manager.listInsights({
      scope: 'repository',
      repository_name: 'repo-a',
    });
    expect(repoAInsights).toHaveLength(0);

    // Moved insight is in target repository
    const repoBInsights = await manager.listInsights({
      scope: 'repository',
      repository_name: 'repo-b',
    });
    expect(repoBInsights).toHaveLength(1);
    expect(repoBInsights[0]!.title).toBe('Move between repositories');
  });

  it('throws VALIDATION_ERROR for same destination', async () => {
    await expect(
      handleMoveKnowledge(ledgerRoot, '1', {
        source_scope: 'repository',
        source_repository_name: 'same-repo',
        repository_name: 'same-repo',
      })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('throws VALIDATION_ERROR for invalid slug (path-traversal attempt)', async () => {
    await expect(
      handleMoveKnowledge(ledgerRoot, '1', {
        source_scope: 'global',
        repository_name: '../evil',
      })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('throws NOT_FOUND for unknown id', async () => {
    await expect(
      handleMoveKnowledge(ledgerRoot, '00000000-0000-0000-0000-000000000000', {
        source_scope: 'global',
        repository_name: 'target-repo',
      })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('moves correct insight when scope+source_repository_name disambiguate the target', async () => {
    const globalInsight = await manager.addInsight(
      makeInsightInput({ scope: 'global', title: 'Global insight' })
    );
    const repoInsight = await manager.addInsight(
      makeInsightInput({ scope: 'repository', repository_name: 'repo-a', title: 'Repository insight' })
    );

    // Move only the repository insight by UUID
    const moved = await handleMoveKnowledge(ledgerRoot, String(repoInsight.id), {
      source_scope: 'repository',
      source_repository_name: 'repo-a',
      repository_name: 'repo-b',
    });

    expect(moved.scope).toBe('repository');
    expect(moved.repository_name).toBe('repo-b');
    expect(moved.title).toBe('Repository insight');

    // repo-a is now empty
    const repoAInsights = await manager.listInsights({
      scope: 'repository',
      repository_name: 'repo-a',
    });
    expect(repoAInsights).toHaveLength(0);

    // Global insight is untouched
    const globalInsights = await manager.listInsights({ scope: 'global' });
    expect(globalInsights).toHaveLength(1);
    expect(globalInsights[0]!.title).toBe('Global insight');
  });
});

// ---------------------------------------------------------------------------
// parseKnowledgeId (6 cases — tested indirectly via handler calls)
//
// parseKnowledgeId is a private module helper. Each test case calls both
// handleDeleteKnowledge and handleUpdateKnowledge, which both invoke
// parseKnowledgeId internally, providing dual-handler coverage without
// requiring the helper to be exported.
// ---------------------------------------------------------------------------

describe('parseKnowledgeId', () => {
  let ledgerRoot: string;

  beforeEach(async () => {
    ledgerRoot = await mkdtemp(join(tmpdir(), 'knowledge-api-parseid-'));
  });

  afterEach(async () => {
    await rm(ledgerRoot, { recursive: true, force: true });
  });

  it('accepts a valid UUID — does not throw VALIDATION_ERROR (throws NOT_FOUND because insight is absent)', async () => {
    const validUuid = '00000000-0000-0000-0000-000000000001';
    await expect(
      handleDeleteKnowledge(ledgerRoot, validUuid, 'global')
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    await expect(
      handleUpdateKnowledge(ledgerRoot, validUuid, { scope: 'global', title: 'x' })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('throws VALIDATION_ERROR for an empty string', async () => {
    await expect(
      handleDeleteKnowledge(ledgerRoot, '', 'global')
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    await expect(
      handleUpdateKnowledge(ledgerRoot, '', { scope: 'global', title: 'x' })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('throws VALIDATION_ERROR for a malformed UUID string', async () => {
    await expect(
      handleDeleteKnowledge(ledgerRoot, 'not-a-uuid', 'global')
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    await expect(
      handleUpdateKnowledge(ledgerRoot, 'not-a-uuid', { scope: 'global', title: 'x' })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('throws VALIDATION_ERROR for an integer string', async () => {
    await expect(
      handleDeleteKnowledge(ledgerRoot, '42', 'global')
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    await expect(
      handleUpdateKnowledge(ledgerRoot, '42', { scope: 'global', title: 'x' })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('throws VALIDATION_ERROR for negative id', async () => {
    await expect(
      handleDeleteKnowledge(ledgerRoot, '-1', 'global')
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    await expect(
      handleUpdateKnowledge(ledgerRoot, '-5', { scope: 'global', title: 'x' })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('throws VALIDATION_ERROR for floating-point string', async () => {
    await expect(
      handleDeleteKnowledge(ledgerRoot, '1.5', 'global')
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    await expect(
      handleUpdateKnowledge(ledgerRoot, '2.0', { scope: 'global', title: 'x' })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});
// ---------------------------------------------------------------------------
// Multi-store aware handlers
// ---------------------------------------------------------------------------

describe('multi-store', () => {
  let storeA: string;
  let storeB: string;

  // Build a two-store StoresConfig pointing at two temp dirs.
  function makeConfig(a: string, b: string): StoresConfig {
    return {
      stores: [
        { id: 'store-a', path: a, label: 'Store A' },
        { id: 'store-b', path: b, label: 'Store B' },
      ],
      default_store: 'store-a',
    };
  }

  function initTwoStoreContext(a: string, b: string): void {
    const router = new StoreRouter(makeConfig(a, b));
    setStoreContext(router, new MultiStoreManager(router));
  }

  function restoreLegacyContext(): void {
    const router = new StoreRouter(null);
    setStoreContext(router, new MultiStoreManager(router));
  }

  beforeEach(async () => {
    storeA = await mkdtemp(join(tmpdir(), 'knowledge-ms-a-'));
    storeB = await mkdtemp(join(tmpdir(), 'knowledge-ms-b-'));
    initTwoStoreContext(storeA, storeB);
  });

  afterEach(async () => {
    restoreLegacyContext();
    await Promise.all([
      rm(storeA, { recursive: true, force: true }),
      rm(storeB, { recursive: true, force: true }),
    ]);
  });

  it('list returns insights from non-default store when ledgerRoot points to default', async () => {
    // Store A is empty; only store B has an insight.
    // The handler must reach store B via the multi-store path.
    const managerB = new KnowledgeStoreManager(storeB);
    await managerB.addInsight(makeInsightInput({ scope: 'global', title: 'From Store B Only' }));

    const results = await handleListKnowledge(storeA);
    const titles = results.map((i) => i.title);
    expect(titles).toContain('From Store B Only');
  });

  it('list merges insights from both stores (non-conflicting UUIDs)', async () => {
    // With UUID ids every addInsight call generates a unique id — no collisions.
    // Seed both stores and verify the merged list contains insights from each.
    const managerA = new KnowledgeStoreManager(storeA);
    const managerB = new KnowledgeStoreManager(storeB);
    await managerA.addInsight(makeInsightInput({ scope: 'global', title: 'A insight' }));
    await managerB.addInsight(makeInsightInput({ scope: 'global', title: 'B insight first' }));
    await managerB.addInsight(makeInsightInput({ scope: 'global', title: 'B insight second' }));

    const results = await handleListKnowledge(storeA);
    const titles = results.map((i) => i.title);
    expect(titles).toContain('A insight');
    expect(titles).toContain('B insight second');
  });

  it('search returns insights from non-default store', async () => {
    // Store A is empty; only store B has the searchable insight.
    const managerB = new KnowledgeStoreManager(storeB);
    await managerB.addInsight(makeInsightInput({ scope: 'global', title: 'multistore-unique-term' }));

    const results = await handleListKnowledge(storeA, { query: 'multistore-unique-term' });
    expect(results.some((i) => i.title === 'multistore-unique-term')).toBe(true);
  });

  it('update finds and updates insight in store B', async () => {
    const managerB = new KnowledgeStoreManager(storeB);
    const created = await managerB.addInsight(
      makeInsightInput({ scope: 'global', title: 'Original in B' })
    );

    const updated = await handleUpdateKnowledge(storeA, String(created.id), {
      scope: 'global',
      title: 'Updated from B',
    });

    expect(updated.title).toBe('Updated from B');
    const remaining = await managerB.listInsights({ scope: 'global' });
    expect(remaining[0]!.title).toBe('Updated from B');
  });

  it('delete finds and removes insight in store B', async () => {
    const managerB = new KnowledgeStoreManager(storeB);
    const created = await managerB.addInsight(
      makeInsightInput({ scope: 'global', title: 'To delete from B' })
    );

    const result = await handleDeleteKnowledge(storeA, String(created.id), 'global');

    expect(result).toBeNull();
    const remaining = await managerB.listInsights({ scope: 'global' });
    expect(remaining).toHaveLength(0);
  });

  it('promote finds and promotes insight from store B', async () => {
    const managerB = new KnowledgeStoreManager(storeB);
    const created = await managerB.addInsight(
      makeInsightInput({
        scope: 'repository',
        repository_name: 'my-repo',
        title: 'Promote from B',
      })
    );

    const promoted = await handlePromoteKnowledge(
      storeA,
      String(created.id),
      'repository',
      'my-repo'
    );

    expect(promoted.scope).toBe('global');
    expect(promoted.title).toBe('Promote from B');
  });

  it('move finds and moves insight from store B', async () => {
    const managerB = new KnowledgeStoreManager(storeB);
    const created = await managerB.addInsight(
      makeInsightInput({ scope: 'global', title: 'Move from B' })
    );

    const moved = await handleMoveKnowledge(storeA, String(created.id), {
      source_scope: 'global',
      repository_name: 'target-repo',
    });

    expect(moved.scope).toBe('repository');
    expect(moved.repository_name).toBe('target-repo');
    expect(moved.title).toBe('Move from B');
  });

  it('throws NOT_FOUND when insight exists in neither store', async () => {
    await expect(
      handleUpdateKnowledge(storeA, '00000000-0000-0000-0000-000000000000', { scope: 'global', title: 'x' })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});