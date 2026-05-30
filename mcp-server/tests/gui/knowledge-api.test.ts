/**
 * WP-007: Knowledge Handler Unit Tests
 *
 * 30 test cases covering all 5 REST handler functions:
 * - handleListKnowledge       (7 cases)
 * - handleUpdateKnowledge     (6 cases, including scope disambiguation)
 * - handleDeleteKnowledge     (4 cases, including scope disambiguation)
 * - handlePromoteKnowledge    (5 cases, including scope disambiguation)
 * - handleMoveKnowledge       (6 cases, including scope disambiguation)
 * - parseKnowledgeId          (2 cases — tested indirectly: each case calls both handleDeleteKnowledge
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
import type { Insight } from '../../src/schema/knowledge.js';

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
      makeInsightInput({ title: 'Superseded', superseded_by: 99 })
    );
    expect(created.superseded_by).toBe(99);

    const updated = await handleUpdateKnowledge(ledgerRoot, String(created.id), {
      scope: 'global',
      superseded_by: null,
    });

    expect(updated.superseded_by).toBeUndefined();
  });

  it('throws NOT_FOUND for unknown id', async () => {
    await expect(
      handleUpdateKnowledge(ledgerRoot, '99999', { scope: 'global', title: 'x' })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('throws VALIDATION_ERROR for non-integer id', async () => {
    await expect(
      handleUpdateKnowledge(ledgerRoot, 'abc', { scope: 'global', title: 'x' })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('throws VALIDATION_ERROR for extra body fields', async () => {
    await expect(
      handleUpdateKnowledge(ledgerRoot, '1', { scope: 'global', unknownField: 'bad' })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('updates insight in global store, not same-id insight in repository store (scope disambiguation)', async () => {
    // Both stores start at next_id=1, so their first insight will have id=1
    const globalInsight = await manager.addInsight(
      makeInsightInput({ scope: 'global', title: 'Global id=1' })
    );
    const repoInsight = await manager.addInsight(
      makeInsightInput({ scope: 'repository', repository_name: 'repo-a', title: 'Repository id=1' })
    );

    expect(globalInsight.id).toBe(1);
    expect(repoInsight.id).toBe(1);

    // Update only the global-scoped insight
    const updated = await handleUpdateKnowledge(ledgerRoot, '1', {
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
    expect(repoInsights[0]!.title).toBe('Repository id=1');
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
      handleDeleteKnowledge(ledgerRoot, '99999', 'global')
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('throws VALIDATION_ERROR for id=0', async () => {
    await expect(
      handleDeleteKnowledge(ledgerRoot, '0', 'global')
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('deletes insight in repository store, not same-id insight in global store (scope disambiguation)', async () => {
    // Both stores start at next_id=1, so their first insight will have id=1
    const globalInsight = await manager.addInsight(
      makeInsightInput({ scope: 'global', title: 'Global id=1' })
    );
    const repoInsight = await manager.addInsight(
      makeInsightInput({ scope: 'repository', repository_name: 'repo-a', title: 'Repository id=1' })
    );

    expect(globalInsight.id).toBe(1);
    expect(repoInsight.id).toBe(1);

    // Delete only the repository-scoped insight
    const result = await handleDeleteKnowledge(ledgerRoot, '1', 'repository', 'repo-a');
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
    expect(globalInsights[0]!.title).toBe('Global id=1');
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
      handlePromoteKnowledge(ledgerRoot, '99999', 'repository', 'my-repo')
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('promotes correct insight when two stores share the same numeric id', async () => {
    // Both stores start at next_id=1, so their first insight will have id=1
    const globalInsight = await manager.addInsight(
      makeInsightInput({ scope: 'global', title: 'Global id=1' })
    );
    const repoInsight = await manager.addInsight(
      makeInsightInput({ scope: 'repository', repository_name: 'repo-a', title: 'Repository id=1' })
    );

    expect(globalInsight.id).toBe(1);
    expect(repoInsight.id).toBe(1);

    // Promote the repository insight (id=1, scope=repository, repository_name=repo-a)
    const promoted = await handlePromoteKnowledge(ledgerRoot, '1', 'repository', 'repo-a');

    expect(promoted.scope).toBe('global');
    expect(promoted.title).toBe('Repository id=1');

    // The original repository insight is gone
    const repoInsights = await manager.listInsights({
      scope: 'repository',
      repository_name: 'repo-a',
    });
    expect(repoInsights).toHaveLength(0);

    // The original global insight is untouched (different object despite same source id)
    const globalInsights = await manager.listInsights({ scope: 'global' });
    expect(globalInsights.length).toBe(2); // original global + promoted copy
    const titles = globalInsights.map((i) => i.title);
    expect(titles).toContain('Global id=1');
    expect(titles).toContain('Repository id=1');
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
      handleMoveKnowledge(ledgerRoot, '99999', {
        source_scope: 'global',
        repository_name: 'target-repo',
      })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('moves correct insight when two stores share the same numeric id', async () => {
    const globalInsight = await manager.addInsight(
      makeInsightInput({ scope: 'global', title: 'Global id=1' })
    );
    const repoInsight = await manager.addInsight(
      makeInsightInput({ scope: 'repository', repository_name: 'repo-a', title: 'Repository id=1' })
    );

    expect(globalInsight.id).toBe(1);
    expect(repoInsight.id).toBe(1);

    // Move only the repository insight (id=1, source_scope=repository, source_repository_name=repo-a)
    const moved = await handleMoveKnowledge(ledgerRoot, '1', {
      source_scope: 'repository',
      source_repository_name: 'repo-a',
      repository_name: 'repo-b',
    });

    expect(moved.scope).toBe('repository');
    expect(moved.repository_name).toBe('repo-b');
    expect(moved.title).toBe('Repository id=1');

    // repo-a is now empty
    const repoAInsights = await manager.listInsights({
      scope: 'repository',
      repository_name: 'repo-a',
    });
    expect(repoAInsights).toHaveLength(0);

    // Global insight is untouched
    const globalInsights = await manager.listInsights({ scope: 'global' });
    expect(globalInsights).toHaveLength(1);
    expect(globalInsights[0]!.title).toBe('Global id=1');
  });
});

// ---------------------------------------------------------------------------
// parseKnowledgeId (2 cases — tested indirectly via handler calls)
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
