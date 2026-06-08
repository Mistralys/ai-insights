/**
 * Integration tests for ledger_get_repository_context tool.
 *
 * Tests drive the tool handler directly via _internal, using vi.mock to
 * redirect resolveLedgerRoot() and deriveRepoName() to controlled values
 * so the real ledger storage is never touched.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

// ─── Module-level variable updated by beforeEach ──────────────────────────
let tempLedgerRoot: string;

vi.mock('../../src/utils/ledger-root.js', () => ({
  resolveLedgerRoot: () => tempLedgerRoot,
  WORKSPACE_ROOT: '/fake/workspace',
  ORCHESTRATOR_LOGS_DIR: '/fake/workspace/orchestrator/logs',
  projectSlugFromPath: (p: string) => (p.split('/').pop() ?? 'unknown'),
  inferProjectRootFromPlanPath: (p: string) => {
    // Walk up 4 dirs from the plan path
    const parts = p.split('/');
    return parts.slice(0, parts.length - 4).join('/') || '/';
  },
  deriveRepoName: (_planPath: string) => 'my-repo',
}));

import { _internal } from '../../src/tools/repository-context.js';
import { KnowledgeStoreManager, SlugValidationError } from '../../src/storage/knowledge-store.js';

const { getRepositoryContext } = _internal;

// ─── Helpers ──────────────────────────────────────────────────────────────

function parseResult(result: { content: Array<{ type: string; text: string }> }) {
  return JSON.parse(result.content[0]!.text);
}

function isError(result: { isError?: boolean }) {
  return result.isError === true;
}

/**
 * Seeds a minimal .meta.json for a project at:
 * {tempLedgerRoot}/{folder}/{slug}/.meta.json
 */
async function seedProject(
  folder: string,
  slug: string,
  overrides: Record<string, unknown> = {}
): Promise<void> {
  const dir = join(tempLedgerRoot, folder, slug);
  await mkdir(dir, { recursive: true });
  const meta = {
    slug,
    plan_path: `/fake/${folder}/docs/agents/plans/${slug}`,
    status: 'COMPLETE',
    date_created: overrides.date_created ?? '2026-01-01T00:00:00Z',
    last_updated: overrides.last_updated ?? '2026-01-01T00:00:00Z',
    ...overrides,
  };
  await writeFile(join(dir, '.meta.json'), JSON.stringify(meta, null, 2), 'utf-8');
}

/**
 * Seeds .repositories.json in the ledger root.
 */
async function seedRegistry(data: unknown): Promise<void> {
  await writeFile(
    join(tempLedgerRoot, '.repositories.json'),
    JSON.stringify(data, null, 2),
    'utf-8'
  );
}

// ─── Setup / Teardown ─────────────────────────────────────────────────────

beforeEach(async () => {
  tempLedgerRoot = await mkdtemp(join(tmpdir(), 'repo-ctx-test-'));
});

afterEach(async () => {
  await rm(tempLedgerRoot, { recursive: true, force: true });
});

// ─── Basic response shape ──────────────────────────────────────────────────

describe('ledger_get_repository_context — response shape', () => {
  it('returns all required top-level fields in the response', async () => {
    const result = await getRepositoryContext({
      repository_name: 'my-repo',
      include_insights: false,
    });

    expect(isError(result as any)).toBe(false);
    const data = parseResult(result as any);

    expect(data).toHaveProperty('repository_name');
    expect(data).toHaveProperty('repository_id');
    expect(data).toHaveProperty('repository_label');
    expect(data).toHaveProperty('total_projects');
    expect(data).toHaveProperty('strategic_vision');
    expect(data).toHaveProperty('projects');
    expect(data).toHaveProperty('relevant_insights');
  });

  it('returns the correct repository_name from input', async () => {
    const result = await getRepositoryContext({
      repository_name: 'my-repo',
      include_insights: false,
    });
    const data = parseResult(result as any);
    expect(data.repository_name).toBe('my-repo');
  });
});

// ─── No registry match ────────────────────────────────────────────────────

describe('ledger_get_repository_context — no registry match', () => {
  it('returns null for repository_id, repository_label, and strategic_vision when no registry file exists', async () => {
    await seedProject('my-repo', '2026-01-01-project-alpha');

    const result = await getRepositoryContext({
      repository_name: 'my-repo',
      include_insights: false,
    });

    const data = parseResult(result as any);
    expect(data.repository_id).toBeNull();
    expect(data.repository_label).toBeNull();
    expect(data.strategic_vision).toBeNull();
  });

  it('reads projects from the single derived folder name when no registry match', async () => {
    await seedProject('my-repo', '2026-01-01-project-alpha');
    await seedProject('my-repo', '2026-01-02-project-beta');

    const result = await getRepositoryContext({
      repository_name: 'my-repo',
      include_insights: false,
    });

    const data = parseResult(result as any);
    expect(data.total_projects).toBe(2);
    expect(data.projects).toHaveLength(2);
  });

  it('returns empty projects array for an empty repo folder (no registry)', async () => {
    const result = await getRepositoryContext({
      repository_name: 'my-repo',
      include_insights: false,
    });

    const data = parseResult(result as any);
    expect(data.total_projects).toBe(0);
    expect(data.projects).toEqual([]);
  });
});

// ─── Registry match ───────────────────────────────────────────────────────

describe('ledger_get_repository_context — registry match', () => {
  it('returns repository_id, repository_label, and strategic_vision from the registry entry', async () => {
    await seedRegistry({
      repositories: [
        {
          id: 'my-repo',
          label: 'My Repository',
          folder_names: ['my-repo'],
          vision: {
            short_term: 'Ship MVP',
            mid_term: 'Expand feature set',
            long_term: null,
          },
          created_at: '2026-01-01T00:00:00Z',
          last_modified: '2026-01-01T00:00:00Z',
        },
      ],
    });

    const result = await getRepositoryContext({
      repository_name: 'my-repo',
      include_insights: false,
    });

    const data = parseResult(result as any);
    expect(data.repository_id).toBe('my-repo');
    expect(data.repository_label).toBe('My Repository');
    expect(data.strategic_vision.short_term).toBe('Ship MVP');
    expect(data.strategic_vision.mid_term).toBe('Expand feature set');
    expect(data.strategic_vision.long_term).toBeNull();
  });

  it('aggregates projects from ALL folder_names declared in the registry', async () => {
    await seedRegistry({
      repositories: [
        {
          id: 'multi-folder-repo',
          label: 'Multi Folder Repo',
          folder_names: ['folder-a', 'folder-b'],
          vision: { short_term: null, mid_term: null, long_term: null },
          created_at: '2026-01-01T00:00:00Z',
          last_modified: '2026-01-01T00:00:00Z',
        },
      ],
    });

    await seedProject('folder-a', '2026-01-01-project-from-a');
    await seedProject('folder-b', '2026-01-02-project-from-b');

    const result = await getRepositoryContext({
      repository_name: 'folder-a',
      include_insights: false,
    });

    const data = parseResult(result as any);
    expect(data.total_projects).toBe(2);
    const slugs = data.projects.map((p: { slug: string }) => p.slug).sort();
    expect(slugs).toEqual(['2026-01-01-project-from-a', '2026-01-02-project-from-b']);
  });
});

// ─── Sorting ──────────────────────────────────────────────────────────────

describe('ledger_get_repository_context — sorting', () => {
  it('sorts projects by date_created descending (most recent first)', async () => {
    await seedProject('my-repo', '2026-01-01-oldest', { date_created: '2026-01-01T00:00:00Z' });
    await seedProject('my-repo', '2026-01-03-newest', { date_created: '2026-01-03T00:00:00Z' });
    await seedProject('my-repo', '2026-01-02-middle', { date_created: '2026-01-02T00:00:00Z' });

    const result = await getRepositoryContext({
      repository_name: 'my-repo',
      max_projects: 10,
      include_insights: false,
    });

    const data = parseResult(result as any);
    expect(data.projects[0].slug).toBe('2026-01-03-newest');
    expect(data.projects[1].slug).toBe('2026-01-02-middle');
    expect(data.projects[2].slug).toBe('2026-01-01-oldest');
  });
});

// ─── max_projects ─────────────────────────────────────────────────────────

describe('ledger_get_repository_context — max_projects', () => {
  it('caps the returned projects list to max_projects', async () => {
    // Seed 7 projects
    for (let i = 1; i <= 7; i++) {
      await seedProject('my-repo', `2026-01-${String(i).padStart(2, '0')}-project-${i}`, {
        date_created: `2026-01-${String(i).padStart(2, '0')}T00:00:00Z`,
      });
    }

    const result = await getRepositoryContext({
      repository_name: 'my-repo',
      max_projects: 3,
      include_insights: false,
    });

    const data = parseResult(result as any);
    expect(data.projects).toHaveLength(3);
    // total_projects should reflect ALL projects, not the capped count
    expect(data.total_projects).toBe(7);
  });

  it('defaults to 5 projects when max_projects is not provided', async () => {
    for (let i = 1; i <= 8; i++) {
      await seedProject('my-repo', `2026-01-${String(i).padStart(2, '0')}-project-${i}`, {
        date_created: `2026-01-${String(i).padStart(2, '0')}T00:00:00Z`,
      });
    }

    const result = await getRepositoryContext({
      repository_name: 'my-repo',
      include_insights: false,
    });

    const data = parseResult(result as any);
    expect(data.projects).toHaveLength(5);
    expect(data.total_projects).toBe(8);
  });

  it('returns all projects when fewer than max_projects exist', async () => {
    await seedProject('my-repo', '2026-01-01-only-project');

    const result = await getRepositoryContext({
      repository_name: 'my-repo',
      max_projects: 10,
      include_insights: false,
    });

    const data = parseResult(result as any);
    expect(data.projects).toHaveLength(1);
  });
});

// ─── include_insights ─────────────────────────────────────────────────────

describe('ledger_get_repository_context — include_insights', () => {
  it('omits relevant_insights from the response when include_insights is false', async () => {
    const result = await getRepositoryContext({
      repository_name: 'my-repo',
      include_insights: false,
    });

    const data = parseResult(result as any);
    // relevant_insights should be present but empty (does not query the knowledge store)
    expect(data.relevant_insights).toEqual([]);
  });

  it('includes relevant_insights in the response when include_insights is true (default)', async () => {
    // No insights seeded — should return an empty array without error
    const result = await getRepositoryContext({
      repository_name: 'my-repo',
      include_insights: true,
    });

    const data = parseResult(result as any);
    expect(Array.isArray(data.relevant_insights)).toBe(true);
  });

  it('defaults include_insights to true when not specified', async () => {
    const result = await getRepositoryContext({
      repository_name: 'my-repo',
    });

    expect(isError(result as any)).toBe(false);
    const data = parseResult(result as any);
    expect(Array.isArray(data.relevant_insights)).toBe(true);
  });
});

// ─── outcome_summary in projects ──────────────────────────────────────────

describe('ledger_get_repository_context — project entries', () => {
  it('includes outcome_summary: null when the project has no outcome_summary', async () => {
    await seedProject('my-repo', '2026-01-01-no-summary', {
      // no outcome_summary field
    });

    const result = await getRepositoryContext({
      repository_name: 'my-repo',
      include_insights: false,
    });

    const data = parseResult(result as any);
    expect(data.projects[0].outcome_summary).toBeNull();
  });

  it('includes outcome_summary when the project has one', async () => {
    await seedProject('my-repo', '2026-01-01-with-summary', {
      outcome_summary: 'Successfully delivered the feature',
    });

    const result = await getRepositoryContext({
      repository_name: 'my-repo',
      include_insights: false,
    });

    const data = parseResult(result as any);
    expect(data.projects[0].outcome_summary).toBe('Successfully delivered the feature');
  });

  it('includes essential project fields: slug, plan_path, status, date_created, last_updated', async () => {
    await seedProject('my-repo', '2026-01-15-full-project', {
      status: 'COMPLETE',
      date_created: '2026-01-15T00:00:00Z',
      last_updated: '2026-01-20T00:00:00Z',
    });

    const result = await getRepositoryContext({
      repository_name: 'my-repo',
      include_insights: false,
    });

    const data = parseResult(result as any);
    const project = data.projects[0];
    expect(project.slug).toBe('2026-01-15-full-project');
    expect(project.status).toBe('COMPLETE');
    expect(project.date_created).toBe('2026-01-15T00:00:00Z');
    expect(project.last_updated).toBe('2026-01-20T00:00:00Z');
    expect(project.plan_path).toBeDefined();
  });
});

// ─── Error handling ───────────────────────────────────────────────────────

describe('ledger_get_repository_context — error handling', () => {
  it('returns an error response when neither cwd_path nor repository_name is provided', async () => {
    // Pass an empty object — both fields absent
    const result = await getRepositoryContext({} as any);
    expect(isError(result as any)).toBe(true);
    expect(result.content[0]!.text).toMatch(/cwd_path|repository_name/i);
  });
});

// ─── Insight deduplication ────────────────────────────────────────────────

/**
 * Seeds a knowledge store JSON file at the given path.
 * The `insights` array is written as-is; `next_id` is set to max(id)+1.
 */
async function seedKnowledgeStore(
  filePath: string,
  insights: Array<Record<string, unknown>>
): Promise<void> {
  const dir = filePath.substring(0, filePath.lastIndexOf('/'));
  await mkdir(dir, { recursive: true });
  const maxId = insights.reduce((m, ins) => Math.max(m, (ins['id'] as number) ?? 0), 0);
  const store = {
    version: '1.0.0',
    last_updated: new Date().toISOString(),
    next_id: maxId + 1,
    insights,
  };
  await writeFile(filePath, JSON.stringify(store, null, 2), 'utf-8');
}

function knowledgeDir(): string {
  return join(tempLedgerRoot, '.knowledge');
}

describe('ledger_get_repository_context — insight deduplication', () => {
  it('returns each insight only once when globalInsights and repoInsights share the same id', async () => {
    // Seed the same insight id (42) in both global and repo-scoped stores
    const sharedInsight = {
      id: 42,
      scope: 'global',
      title: 'Shared insight',
      content: 'Content of the shared insight',
      category: 'architecture',
      tags: ['shared'],
      source: '',
      created_at: '2026-01-01T00:00:00Z',
      confidence: 1,
    };

    await seedKnowledgeStore(
      join(knowledgeDir(), 'global-insights.json'),
      [sharedInsight]
    );
    await seedKnowledgeStore(
      join(knowledgeDir(), 'my-repo-insights.json'),
      [{ ...sharedInsight, scope: 'repository', repository_name: 'my-repo' }]
    );

    const result = await getRepositoryContext({
      repository_name: 'my-repo',
      include_insights: true,
    });

    expect(isError(result as any)).toBe(false);
    const data = parseResult(result as any);

    // id 42 must appear exactly once
    const ids: number[] = data.relevant_insights.map((ins: { id: number }) => ins.id);
    expect(ids.filter((id) => id === 42)).toHaveLength(1);
  });

  it('preserves insertion order: global insights first, then unique repo-scoped additions', async () => {
    // Global store: ids 1, 2
    // Repo store: ids 2 (duplicate), 3 (unique)
    // Expected order: [1, 2, 3]
    const globalInsight1 = {
      id: 1,
      scope: 'global',
      title: 'Global insight 1',
      content: 'First global insight',
      category: 'testing',
      tags: [],
      source: '',
      created_at: '2026-01-01T00:00:00Z',
      confidence: 1,
    };
    const globalInsight2 = {
      id: 2,
      scope: 'global',
      title: 'Global insight 2',
      content: 'Second global insight',
      category: 'testing',
      tags: [],
      source: '',
      created_at: '2026-01-01T00:00:00Z',
      confidence: 1,
    };
    const repoInsight2 = {
      id: 2,
      scope: 'repository',
      repository_name: 'my-repo',
      title: 'Repo insight 2 (duplicate)',
      content: 'Duplicate of global insight 2',
      category: 'testing',
      tags: [],
      source: '',
      created_at: '2026-01-01T00:00:00Z',
      confidence: 1,
    };
    const repoInsight3 = {
      id: 3,
      scope: 'repository',
      repository_name: 'my-repo',
      title: 'Repo insight 3 (unique)',
      content: 'Unique repo-scoped insight',
      category: 'testing',
      tags: [],
      source: '',
      created_at: '2026-01-01T00:00:00Z',
      confidence: 1,
    };

    await seedKnowledgeStore(
      join(knowledgeDir(), 'global-insights.json'),
      [globalInsight1, globalInsight2]
    );
    await seedKnowledgeStore(
      join(knowledgeDir(), 'my-repo-insights.json'),
      [repoInsight2, repoInsight3]
    );

    const result = await getRepositoryContext({
      repository_name: 'my-repo',
      include_insights: true,
    });

    expect(isError(result as any)).toBe(false);
    const data = parseResult(result as any);

    const ids: number[] = data.relevant_insights.map((ins: { id: number }) => ins.id);
    expect(ids).toEqual([1, 2, 3]);
  });

  it('returns all insights unchanged when no duplicates exist', async () => {
    // Global: id 10; Repo: id 20 — no overlap
    const globalInsight = {
      id: 10,
      scope: 'global',
      title: 'Global only',
      content: 'No overlap here',
      category: 'workflow',
      tags: [],
      source: '',
      created_at: '2026-01-01T00:00:00Z',
      confidence: 1,
    };
    const repoInsight = {
      id: 20,
      scope: 'repository',
      repository_name: 'my-repo',
      title: 'Repo only',
      content: 'No overlap here',
      category: 'workflow',
      tags: [],
      source: '',
      created_at: '2026-01-01T00:00:00Z',
      confidence: 1,
    };

    await seedKnowledgeStore(
      join(knowledgeDir(), 'global-insights.json'),
      [globalInsight]
    );
    await seedKnowledgeStore(
      join(knowledgeDir(), 'my-repo-insights.json'),
      [repoInsight]
    );

    const result = await getRepositoryContext({
      repository_name: 'my-repo',
      include_insights: true,
    });

    expect(isError(result as any)).toBe(false);
    const data = parseResult(result as any);

    const ids: number[] = data.relevant_insights.map((ins: { id: number }) => ins.id);
    expect(ids).toContain(10);
    expect(ids).toContain(20);
    expect(data.relevant_insights).toHaveLength(2);
  });
});

// ─── safeListRepositoryInsights — narrowed catch ──────────────────────────

const { safeListRepositoryInsights } = _internal;

/**
 * Builds a minimal KnowledgeStoreManager stub whose listInsights method
 * either returns a fixed value or throws the provided error.
 */
function makeManager(behaviour: 'empty' | Error): KnowledgeStoreManager {
  return {
    listInsights: async () => {
      if (behaviour instanceof Error) throw behaviour;
      return [];
    },
  } as unknown as KnowledgeStoreManager;
}

describe('safeListRepositoryInsights — narrowed catch', () => {
  it('returns [] for a repo name that fails SLUG_REGEX (path-traversal "../")', async () => {
    // The manager.listInsights call will throw SlugValidationError
    // because repositoryStorePath() calls _validateSlug() first.
    // We simulate that with a typed SlugValidationError stub.
    const manager = makeManager(new SlugValidationError('../', 'invalid_characters'));
    await expect(safeListRepositoryInsights(manager, '../')).resolves.toEqual([]);
  });

  it('returns [] for a repo name that fails SLUG_REGEX ("has space")', async () => {
    const manager = makeManager(new SlugValidationError('has space', 'invalid_characters'));
    await expect(safeListRepositoryInsights(manager, 'has space')).resolves.toEqual([]);
  });

  it('returns [] for a repo name that fails SLUG_REGEX ("dot.name")', async () => {
    const manager = makeManager(new SlugValidationError('dot.name', 'invalid_characters'));
    await expect(safeListRepositoryInsights(manager, 'dot.name')).resolves.toEqual([]);
  });

  it('returns [] for the reserved name "global"', async () => {
    const manager = makeManager(new SlugValidationError('global', 'reserved_name'));
    await expect(safeListRepositoryInsights(manager, 'global')).resolves.toEqual([]);
  });

  it('re-throws a generic Error("disk failure") that is not a slug-validation error', async () => {
    const err = new Error('disk failure');
    const manager = makeManager(err);
    await expect(safeListRepositoryInsights(manager, 'valid-repo')).rejects.toThrow('disk failure');
  });

  it('re-throws an EACCES-style error that is not a slug-validation error', async () => {
    const err = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
    const manager = makeManager(err);
    await expect(safeListRepositoryInsights(manager, 'valid-repo')).rejects.toThrow('EACCES');
  });

  it('re-throws an EIO-style error that is not a slug-validation error', async () => {
    const err = Object.assign(new Error('EIO: i/o error'), { code: 'EIO' });
    const manager = makeManager(err);
    await expect(safeListRepositoryInsights(manager, 'valid-repo')).rejects.toThrow('EIO');
  });
});
