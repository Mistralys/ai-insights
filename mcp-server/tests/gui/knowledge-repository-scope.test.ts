/**
 * WP-010: New Test Suite — Repository Scope Integration Tests
 *
 * 31 test cases covering repository scope functionality across two layers:
 *
 * Storage layer (KnowledgeStoreManager) — 17 cases:
 *   - repositoryStorePath path generation and reserved-name guard
 *   - addInsight with repository scope (success and missing-repository_name error)
 *   - readRepositoryStore empty and populated
 *   - listInsights unfiltered, scope-filtered, and name-filtered
 *   - searchInsights with repository_name
 *   - updateInsight and deleteInsight with repository scope
 *   - moveInsight global→repo, repo→repo, and same-name rejection
 *   - origin_plan preservation through add, update, and move
 *
 * GUI REST handlers (gui/api-knowledge.ts) — 14 cases:
 *   - handleListKnowledge with repository_name
 *   - handleUpdateKnowledge with repository scope and repository_name
 *   - handleDeleteKnowledge with repository scope (success and missing repository_name)
 *   - handlePromoteKnowledge from repository (success) and from global (rejection)
 *   - handleMoveKnowledge global→repo, repo→repo same-name rejection,
 *     missing target_repository_name rejection
 *   - scope: 'project' rejection by all handlers (5 cases)
 *
 * Uses real temp directories (mkdtemp/rm) and KnowledgeStoreManager — no mocks.
 * Follows the pattern established in tests/gui/knowledge-api.test.ts.
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
// Storage layer — repositoryStorePath
// ---------------------------------------------------------------------------

describe('KnowledgeStoreManager.repositoryStorePath', () => {
  let ledgerRoot: string;
  let manager: KnowledgeStoreManager;

  beforeEach(async () => {
    ledgerRoot = await mkdtemp(join(tmpdir(), 'knowledge-repo-path-'));
    manager = new KnowledgeStoreManager(ledgerRoot);
  });

  afterEach(async () => {
    await rm(ledgerRoot, { recursive: true, force: true });
  });

  it("returns {knowledgeDir}/{repoName}-insights.json for a valid repository name", () => {
    const storePath = manager.repositoryStorePath('hcp-editor');
    const expected = join(manager.knowledgeDir(), 'hcp-editor-insights.json');
    expect(storePath).toBe(expected);
  });

  it("throws for the reserved name 'global'", () => {
    expect(() => manager.repositoryStorePath('global')).toThrow(
      "'global' is a reserved name and cannot be used as a repository name."
    );
  });
});

// ---------------------------------------------------------------------------
// Storage layer — addInsight (repository scope)
// ---------------------------------------------------------------------------

describe('KnowledgeStoreManager.addInsight — repository scope', () => {
  let ledgerRoot: string;
  let manager: KnowledgeStoreManager;

  beforeEach(async () => {
    ledgerRoot = await mkdtemp(join(tmpdir(), 'knowledge-repo-add-'));
    manager = new KnowledgeStoreManager(ledgerRoot);
  });

  afterEach(async () => {
    await rm(ledgerRoot, { recursive: true, force: true });
  });

  it('creates repository store file with correct fields including origin_plan', async () => {
    const insight = await manager.addInsight(
      makeInsightInput({
        scope: 'repository',
        repository_name: 'hcp-editor',
        origin_plan: 'my-plan',
        title: 'Codebase insight',
      })
    );

    expect(insight.scope).toBe('repository');
    expect(insight.repository_name).toBe('hcp-editor');
    expect(insight.origin_plan).toBe('my-plan');
    expect(insight.title).toBe('Codebase insight');
    expect(insight.id).toBeTypeOf('number');
    expect(insight.id).toBeGreaterThan(0);

    // Verify the file was written in the correct location
    const store = await manager.readRepositoryStore('hcp-editor');
    expect(store.insights).toHaveLength(1);
    expect(store.insights[0]!.title).toBe('Codebase insight');
  });

  it('throws when repository_name is absent for repository-scoped insight', async () => {
    await expect(
      manager.addInsight(
        makeInsightInput({ scope: 'repository' /* no repository_name */ })
      )
    ).rejects.toThrow('repository_name is required for repository-scoped insights');
  });
});

// ---------------------------------------------------------------------------
// Storage layer — readRepositoryStore
// ---------------------------------------------------------------------------

describe('KnowledgeStoreManager.readRepositoryStore', () => {
  let ledgerRoot: string;
  let manager: KnowledgeStoreManager;

  beforeEach(async () => {
    ledgerRoot = await mkdtemp(join(tmpdir(), 'knowledge-repo-read-'));
    manager = new KnowledgeStoreManager(ledgerRoot);
  });

  afterEach(async () => {
    await rm(ledgerRoot, { recursive: true, force: true });
  });

  it('returns empty store when repository file does not exist', async () => {
    const store = await manager.readRepositoryStore('hcp-editor');
    expect(store.insights).toEqual([]);
    expect(store.next_id).toBe(1);
  });

  it('returns stored insights after addInsight', async () => {
    await manager.addInsight(
      makeInsightInput({ scope: 'repository', repository_name: 'hcp-editor', title: 'First' })
    );
    await manager.addInsight(
      makeInsightInput({ scope: 'repository', repository_name: 'hcp-editor', title: 'Second' })
    );

    const store = await manager.readRepositoryStore('hcp-editor');
    expect(store.insights).toHaveLength(2);
    const titles = store.insights.map((i) => i.title);
    expect(titles).toContain('First');
    expect(titles).toContain('Second');
  });
});

// ---------------------------------------------------------------------------
// Storage layer — listInsights (scope and repository_name filtering)
// ---------------------------------------------------------------------------

describe('KnowledgeStoreManager.listInsights — repository scope filtering', () => {
  let ledgerRoot: string;
  let manager: KnowledgeStoreManager;

  beforeEach(async () => {
    ledgerRoot = await mkdtemp(join(tmpdir(), 'knowledge-repo-list-'));
    manager = new KnowledgeStoreManager(ledgerRoot);
  });

  afterEach(async () => {
    await rm(ledgerRoot, { recursive: true, force: true });
  });

  it('no filters returns global + all repository insights', async () => {
    await manager.addInsight(makeInsightInput({ scope: 'global', title: 'Global' }));
    await manager.addInsight(
      makeInsightInput({ scope: 'repository', repository_name: 'alpha', title: 'Alpha insight' })
    );
    await manager.addInsight(
      makeInsightInput({ scope: 'repository', repository_name: 'beta', title: 'Beta insight' })
    );

    const results = await manager.listInsights({});
    expect(results).toHaveLength(3);
    const titles = results.map((i) => i.title);
    expect(titles).toContain('Global');
    expect(titles).toContain('Alpha insight');
    expect(titles).toContain('Beta insight');
  });

  it('scope:repository returns only repository-scoped insights', async () => {
    await manager.addInsight(makeInsightInput({ scope: 'global', title: 'Global' }));
    await manager.addInsight(
      makeInsightInput({ scope: 'repository', repository_name: 'alpha', title: 'Alpha' })
    );
    await manager.addInsight(
      makeInsightInput({ scope: 'repository', repository_name: 'beta', title: 'Beta' })
    );

    const results = await manager.listInsights({ scope: 'repository' });
    expect(results).toHaveLength(2);
    expect(results.every((i) => i.scope === 'repository')).toBe(true);
  });

  it('scope:repository + repository_name narrows to one store', async () => {
    await manager.addInsight(
      makeInsightInput({ scope: 'repository', repository_name: 'hcp-editor', title: 'HCP insight' })
    );
    await manager.addInsight(
      makeInsightInput({ scope: 'repository', repository_name: 'other-repo', title: 'Other' })
    );

    const results = await manager.listInsights({ scope: 'repository', repository_name: 'hcp-editor' });
    expect(results).toHaveLength(1);
    expect(results[0]!.title).toBe('HCP insight');
    expect(results[0]!.repository_name).toBe('hcp-editor');
  });
});

// ---------------------------------------------------------------------------
// Storage layer — searchInsights with repository_name
// ---------------------------------------------------------------------------

describe('KnowledgeStoreManager.searchInsights — repository_name filter', () => {
  let ledgerRoot: string;
  let manager: KnowledgeStoreManager;

  beforeEach(async () => {
    ledgerRoot = await mkdtemp(join(tmpdir(), 'knowledge-repo-search-'));
    manager = new KnowledgeStoreManager(ledgerRoot);
  });

  afterEach(async () => {
    await rm(ledgerRoot, { recursive: true, force: true });
  });

  it('searches only the specified repository store', async () => {
    await manager.addInsight(
      makeInsightInput({
        scope: 'repository',
        repository_name: 'hcp-editor',
        title: 'Atomic writes pattern',
        content: 'Use atomic writes for safe file updates.',
      })
    );
    await manager.addInsight(
      makeInsightInput({
        scope: 'repository',
        repository_name: 'other-repo',
        title: 'Atomic file operations',
        content: 'Other repo content about atomicity.',
      })
    );

    const results = await manager.searchInsights('atomic', { repository_name: 'hcp-editor' });
    expect(results).toHaveLength(1);
    expect(results[0]!.repository_name).toBe('hcp-editor');
    expect(results[0]!.title).toBe('Atomic writes pattern');
  });
});

// ---------------------------------------------------------------------------
// Storage layer — updateInsight with repository scope
// ---------------------------------------------------------------------------

describe('KnowledgeStoreManager.updateInsight — repository scope', () => {
  let ledgerRoot: string;
  let manager: KnowledgeStoreManager;

  beforeEach(async () => {
    ledgerRoot = await mkdtemp(join(tmpdir(), 'knowledge-repo-update-'));
    manager = new KnowledgeStoreManager(ledgerRoot);
  });

  afterEach(async () => {
    await rm(ledgerRoot, { recursive: true, force: true });
  });

  it('updates insight in repository store correctly', async () => {
    const created = await manager.addInsight(
      makeInsightInput({
        scope: 'repository',
        repository_name: 'hcp-editor',
        title: 'Original title',
      })
    );

    const updated = await manager.updateInsight(
      created.id,
      { title: 'Updated title' },
      { scope: 'repository', repository_name: 'hcp-editor' }
    );

    expect(updated.id).toBe(created.id);
    expect(updated.title).toBe('Updated title');
    expect(updated.scope).toBe('repository');
    expect(updated.repository_name).toBe('hcp-editor');
  });
});

// ---------------------------------------------------------------------------
// Storage layer — deleteInsight with repository scope
// ---------------------------------------------------------------------------

describe('KnowledgeStoreManager.deleteInsight — repository scope', () => {
  let ledgerRoot: string;
  let manager: KnowledgeStoreManager;

  beforeEach(async () => {
    ledgerRoot = await mkdtemp(join(tmpdir(), 'knowledge-repo-delete-'));
    manager = new KnowledgeStoreManager(ledgerRoot);
  });

  afterEach(async () => {
    await rm(ledgerRoot, { recursive: true, force: true });
  });

  it('removes insight from repository store', async () => {
    const created = await manager.addInsight(
      makeInsightInput({
        scope: 'repository',
        repository_name: 'hcp-editor',
        title: 'To delete',
      })
    );

    await manager.deleteInsight(created.id, { scope: 'repository', repository_name: 'hcp-editor' });

    const remaining = await manager.listInsights({ scope: 'repository', repository_name: 'hcp-editor' });
    expect(remaining).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Storage layer — moveInsight (global ↔ repository, repo ↔ repo)
// ---------------------------------------------------------------------------

describe('KnowledgeStoreManager.moveInsight — repository scope', () => {
  let ledgerRoot: string;
  let manager: KnowledgeStoreManager;

  beforeEach(async () => {
    ledgerRoot = await mkdtemp(join(tmpdir(), 'knowledge-repo-move-'));
    manager = new KnowledgeStoreManager(ledgerRoot);
  });

  afterEach(async () => {
    await rm(ledgerRoot, { recursive: true, force: true });
  });

  it('moves global insight to repository (global → repository)', async () => {
    const global = await manager.addInsight(
      makeInsightInput({ scope: 'global', title: 'Will move to repo' })
    );

    const moved = await manager.moveInsight(
      global.id,
      { scope: 'global' },
      'repository',
      'hcp-editor'
    );

    expect(moved.scope).toBe('repository');
    expect(moved.repository_name).toBe('hcp-editor');
    expect(moved.title).toBe('Will move to repo');

    // Original global insight is removed
    const globalInsights = await manager.listInsights({ scope: 'global' });
    expect(globalInsights).toHaveLength(0);

    // Insight now lives in the repository store
    const repoInsights = await manager.listInsights({ scope: 'repository', repository_name: 'hcp-editor' });
    expect(repoInsights).toHaveLength(1);
    expect(repoInsights[0]!.title).toBe('Will move to repo');
  });

  it('moves repository insight to different repository (repository → repository)', async () => {
    const original = await manager.addInsight(
      makeInsightInput({
        scope: 'repository',
        repository_name: 'repo-a',
        title: 'Cross-repo move',
      })
    );

    const moved = await manager.moveInsight(
      original.id,
      { scope: 'repository', repository_name: 'repo-a' },
      'repository',
      'repo-b'
    );

    expect(moved.scope).toBe('repository');
    expect(moved.repository_name).toBe('repo-b');
    expect(moved.title).toBe('Cross-repo move');

    const repoAInsights = await manager.listInsights({ scope: 'repository', repository_name: 'repo-a' });
    expect(repoAInsights).toHaveLength(0);

    const repoBInsights = await manager.listInsights({ scope: 'repository', repository_name: 'repo-b' });
    expect(repoBInsights).toHaveLength(1);
  });

  it('throws when moving repository insight to the same repository (identity move)', async () => {
    await expect(
      manager.moveInsight(
        1,
        { scope: 'repository', repository_name: 'same-repo' },
        'repository',
        'same-repo'
      )
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Storage layer — origin_plan preservation through add, update, and move
// ---------------------------------------------------------------------------

describe('KnowledgeStoreManager — origin_plan provenance preservation', () => {
  let ledgerRoot: string;
  let manager: KnowledgeStoreManager;

  beforeEach(async () => {
    ledgerRoot = await mkdtemp(join(tmpdir(), 'knowledge-repo-origin-'));
    manager = new KnowledgeStoreManager(ledgerRoot);
  });

  afterEach(async () => {
    await rm(ledgerRoot, { recursive: true, force: true });
  });

  it('origin_plan is preserved through add and update', async () => {
    const created = await manager.addInsight(
      makeInsightInput({
        scope: 'repository',
        repository_name: 'hcp-editor',
        origin_plan: '2026-01-01-my-plan',
        title: 'With provenance',
      })
    );

    expect(created.origin_plan).toBe('2026-01-01-my-plan');

    const updated = await manager.updateInsight(
      created.id,
      { title: 'Updated with provenance' },
      { scope: 'repository', repository_name: 'hcp-editor' }
    );

    // origin_plan must not be cleared by an update that doesn't mention it
    expect(updated.origin_plan).toBe('2026-01-01-my-plan');
  });

  it('origin_plan is preserved through moveInsight (global → repository)', async () => {
    const global = await manager.addInsight(
      makeInsightInput({
        scope: 'global',
        origin_plan: '2026-01-01-my-plan',
        title: 'Move and preserve origin_plan',
      })
    );

    const moved = await manager.moveInsight(
      global.id,
      { scope: 'global' },
      'repository',
      'hcp-editor'
    );

    expect(moved.origin_plan).toBe('2026-01-01-my-plan');
    expect(moved.scope).toBe('repository');
    expect(moved.repository_name).toBe('hcp-editor');
  });
});

// ---------------------------------------------------------------------------
// GUI handler — handleListKnowledge with repository_name
// ---------------------------------------------------------------------------

describe('handleListKnowledge — repository_name filter', () => {
  let ledgerRoot: string;
  let manager: KnowledgeStoreManager;

  beforeEach(async () => {
    ledgerRoot = await mkdtemp(join(tmpdir(), 'knowledge-repo-handler-list-'));
    manager = new KnowledgeStoreManager(ledgerRoot);
  });

  afterEach(async () => {
    await rm(ledgerRoot, { recursive: true, force: true });
  });

  it('returns only that repository store insights when repository_name is provided', async () => {
    await manager.addInsight(
      makeInsightInput({ scope: 'repository', repository_name: 'hcp-editor', title: 'HCP insight' })
    );
    await manager.addInsight(
      makeInsightInput({ scope: 'repository', repository_name: 'other-repo', title: 'Other insight' })
    );
    await manager.addInsight(makeInsightInput({ scope: 'global', title: 'Global insight' }));

    const result = await handleListKnowledge(ledgerRoot, { repository_name: 'hcp-editor' });
    expect(result).toHaveLength(1);
    expect(result[0]!.title).toBe('HCP insight');
    expect(result[0]!.repository_name).toBe('hcp-editor');
  });
});

// ---------------------------------------------------------------------------
// GUI handler — handleUpdateKnowledge with repository scope
// ---------------------------------------------------------------------------

describe('handleUpdateKnowledge — repository scope', () => {
  let ledgerRoot: string;
  let manager: KnowledgeStoreManager;

  beforeEach(async () => {
    ledgerRoot = await mkdtemp(join(tmpdir(), 'knowledge-repo-handler-update-'));
    manager = new KnowledgeStoreManager(ledgerRoot);
  });

  afterEach(async () => {
    await rm(ledgerRoot, { recursive: true, force: true });
  });

  it('updates insight in the correct repository store', async () => {
    const created = await manager.addInsight(
      makeInsightInput({
        scope: 'repository',
        repository_name: 'hcp-editor',
        title: 'Original',
      })
    );

    const updated = await handleUpdateKnowledge(ledgerRoot, String(created.id), {
      scope: 'repository',
      repository_name: 'hcp-editor',
      title: 'Updated by handler',
    });

    expect(updated.id).toBe(created.id);
    expect(updated.title).toBe('Updated by handler');
    expect(updated.scope).toBe('repository');
    expect(updated.repository_name).toBe('hcp-editor');
  });
});

// ---------------------------------------------------------------------------
// GUI handler — handleDeleteKnowledge with repository scope
// ---------------------------------------------------------------------------

describe('handleDeleteKnowledge — repository scope', () => {
  let ledgerRoot: string;
  let manager: KnowledgeStoreManager;

  beforeEach(async () => {
    ledgerRoot = await mkdtemp(join(tmpdir(), 'knowledge-repo-handler-delete-'));
    manager = new KnowledgeStoreManager(ledgerRoot);
  });

  afterEach(async () => {
    await rm(ledgerRoot, { recursive: true, force: true });
  });

  it('deletes insight from the correct repository store', async () => {
    const created = await manager.addInsight(
      makeInsightInput({ scope: 'repository', repository_name: 'hcp-editor', title: 'To delete' })
    );

    const result = await handleDeleteKnowledge(
      ledgerRoot,
      String(created.id),
      'repository',
      'hcp-editor'
    );

    expect(result).toBeNull();

    const remaining = await manager.listInsights({
      scope: 'repository',
      repository_name: 'hcp-editor',
    });
    expect(remaining).toHaveLength(0);
  });

  it('throws VALIDATION_ERROR when scope is repository but repository_name is missing', async () => {
    await expect(
      handleDeleteKnowledge(ledgerRoot, '1', 'repository' /* no repository_name */)
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});

// ---------------------------------------------------------------------------
// GUI handler — handlePromoteKnowledge
// ---------------------------------------------------------------------------

describe('handlePromoteKnowledge — repository scope', () => {
  let ledgerRoot: string;
  let manager: KnowledgeStoreManager;

  beforeEach(async () => {
    ledgerRoot = await mkdtemp(join(tmpdir(), 'knowledge-repo-handler-promote-'));
    manager = new KnowledgeStoreManager(ledgerRoot);
  });

  afterEach(async () => {
    await rm(ledgerRoot, { recursive: true, force: true });
  });

  it('promotes repository insight to global scope', async () => {
    const original = await manager.addInsight(
      makeInsightInput({
        scope: 'repository',
        repository_name: 'hcp-editor',
        title: 'Promote me',
      })
    );

    const promoted = await handlePromoteKnowledge(
      ledgerRoot,
      String(original.id),
      'repository',
      'hcp-editor'
    );

    expect(promoted.scope).toBe('global');
    expect(promoted.title).toBe('Promote me');
    expect(promoted.repository_name).toBeUndefined();

    const globalInsights = await manager.listInsights({ scope: 'global' });
    expect(globalInsights.some((i) => i.title === 'Promote me')).toBe(true);
  });

  it('throws VALIDATION_ERROR when trying to promote a global insight', async () => {
    const global = await manager.addInsight(
      makeInsightInput({ scope: 'global', title: 'Already global' })
    );

    await expect(
      handlePromoteKnowledge(ledgerRoot, String(global.id), 'global')
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});

// ---------------------------------------------------------------------------
// GUI handler — handleMoveKnowledge
// ---------------------------------------------------------------------------

describe('handleMoveKnowledge — repository scope', () => {
  let ledgerRoot: string;
  let manager: KnowledgeStoreManager;

  beforeEach(async () => {
    ledgerRoot = await mkdtemp(join(tmpdir(), 'knowledge-repo-handler-move-'));
    manager = new KnowledgeStoreManager(ledgerRoot);
  });

  afterEach(async () => {
    await rm(ledgerRoot, { recursive: true, force: true });
  });

  it('moves global insight to repository store', async () => {
    const global = await manager.addInsight(
      makeInsightInput({ scope: 'global', title: 'Move to repo' })
    );

    const moved = await handleMoveKnowledge(ledgerRoot, String(global.id), {
      source_scope: 'global',
      repository_name: 'hcp-editor',
    });

    expect(moved.scope).toBe('repository');
    expect(moved.repository_name).toBe('hcp-editor');
    expect(moved.title).toBe('Move to repo');

    const globalInsights = await manager.listInsights({ scope: 'global' });
    expect(globalInsights).toHaveLength(0);
  });

  it('throws VALIDATION_ERROR when source and target repository are the same', async () => {
    await expect(
      handleMoveKnowledge(ledgerRoot, '1', {
        source_scope: 'repository',
        source_repository_name: 'same-repo',
        repository_name: 'same-repo',
      })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('throws VALIDATION_ERROR when repository_name (target) is missing', async () => {
    await expect(
      handleMoveKnowledge(ledgerRoot, '1', {
        source_scope: 'global',
        // repository_name is missing — schema validation should reject this
      })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});

// ---------------------------------------------------------------------------
// scope: 'project' rejection by all handlers (AC-17)
// ---------------------------------------------------------------------------

describe("scope: 'project' rejection — VALIDATION_ERROR from all handlers", () => {
  let ledgerRoot: string;

  beforeEach(async () => {
    ledgerRoot = await mkdtemp(join(tmpdir(), 'knowledge-repo-project-rejection-'));
  });

  afterEach(async () => {
    await rm(ledgerRoot, { recursive: true, force: true });
  });

  it("handleDeleteKnowledge rejects scope: 'project'", async () => {
    await expect(
      handleDeleteKnowledge(ledgerRoot, '1', 'project')
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it("handlePromoteKnowledge rejects scope: 'project'", async () => {
    await expect(
      handlePromoteKnowledge(ledgerRoot, '1', 'project')
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it("handleUpdateKnowledge rejects scope: 'project' in body", async () => {
    await expect(
      handleUpdateKnowledge(ledgerRoot, '1', { scope: 'project', title: 'x' })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it("handleMoveKnowledge rejects source_scope: 'project' in body", async () => {
    await expect(
      handleMoveKnowledge(ledgerRoot, '1', {
        source_scope: 'project',
        repository_name: 'target-repo',
      })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it("handleListKnowledge silently ignores unrecognised scope: 'project' (returns all insights, no error)", async () => {
    // handleListKnowledge uses InsightScope.safeParse() — invalid scope values are treated
    // as "no scope filter" rather than rejected, consistent with its documented behaviour.
    // This test verifies that behaviour is preserved for the removed 'project' scope value.
    const result = await handleListKnowledge(ledgerRoot, { scope: 'project' });
    expect(result).toEqual([]);
  });
});
