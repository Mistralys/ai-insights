import { describe, it, expect, vi, afterEach } from 'vitest';
import { LedgerStore } from '../../src/storage/ledger-store.js';
import {
  resolveProjectPath,
  formatCandidateList,
} from '../../src/utils/project-resolver.js';

// ---------------------------------------------------------------------------
// resolveProjectPath
// ---------------------------------------------------------------------------

describe('resolveProjectPath', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns project_path directly when provided (validates format)', async () => {
    const valid = '/tmp/2026-02-16-my-project';
    const result = await resolveProjectPath({ project_path: valid });
    expect(result).toBe(valid);
  });

  it('throws when project_path is provided but has invalid format', async () => {
    await expect(
      resolveProjectPath({ project_path: '/tmp/invalid-no-date' })
    ).rejects.toThrow('Invalid project path format');
  });

  it('returns plan_path from LedgerStore.detectProjectByCwd when cwd_path is provided and FOUND', async () => {
    vi.spyOn(LedgerStore, 'detectProjectByCwd').mockResolvedValueOnce({
      status: 'FOUND',
      meta: {
        plan_path: '/projects/docs/agents/plans/2026-03-01-my-project',
        slug: '2026-03-01-my-project',
        title: 'My Project',
        status: 'IN_PROGRESS',
        codebase_root: '/projects',
        date_created: '2026-03-01T00:00:00Z',
        last_updated: '2026-03-01T00:00:00Z',
      },
    } as any);

    const result = await resolveProjectPath({ cwd_path: '/projects' });
    expect(result).toBe('/projects/docs/agents/plans/2026-03-01-my-project');
    expect(LedgerStore.detectProjectByCwd).toHaveBeenCalledWith('/projects');
  });

  it('throws with candidates list when cwd_path matches multiple projects (AMBIGUOUS)', async () => {
    vi.spyOn(LedgerStore, 'detectProjectByCwd').mockResolvedValueOnce({
      status: 'AMBIGUOUS',
      best: [
        { plan_path: '/a/docs/plans/2026-02-01-beta', slug: '2026-02-01-beta', status: 'IN_PROGRESS', date_created: '2026-03-05T10:00:00Z', last_updated: '2026-03-05T10:00:00Z' },
      ],
      unlikely: [
        { plan_path: '/a/docs/plans/2026-01-01-alpha', slug: '2026-01-01-alpha', status: 'READY', date_created: '2026-02-01T10:00:00Z', last_updated: '2026-02-01T10:00:00Z' },
      ],
    } as any);

    await expect(
      resolveProjectPath({ cwd_path: '/a' })
    ).rejects.toThrow('Multiple projects match');
  });

  it('throws NOT_FOUND error when cwd_path does not match any project', async () => {
    vi.spyOn(LedgerStore, 'detectProjectByCwd').mockResolvedValueOnce({
      status: 'NOT_FOUND',
    } as any);

    await expect(
      resolveProjectPath({ cwd_path: '/nonexistent' })
    ).rejects.toThrow('No project found for cwd_path');
  });

  it('uses project_path when both project_path and cwd_path are provided', async () => {
    const spy = vi.spyOn(LedgerStore, 'detectProjectByCwd');
    const validPlan = '/tmp/2026-02-16-my-project';
    const result = await resolveProjectPath({ project_path: validPlan, cwd_path: '/any/workspace' });
    expect(result).toBe(validPlan);
    // LedgerStore must NOT be called — project_path takes precedence
    expect(spy).not.toHaveBeenCalled();
  });

  it('throws when neither project_path nor cwd_path is provided', async () => {
    await expect(resolveProjectPath({})).rejects.toThrow(
      'Either project_path or cwd_path is required.'
    );
  });
});

// ---------------------------------------------------------------------------
// formatCandidateList
// ---------------------------------------------------------------------------

function makeMeta(slug: string, plan_path: string, last_updated = '2026-01-01T00:00:00Z') {
  return { slug, plan_path, status: 'READY' as const, date_created: '2026-01-01T00:00:00Z', last_updated };
}

// Fixed reference point so relative-time labels are deterministic.
const FIXED_NOW = new Date('2026-03-06T12:00:00Z');

describe('formatCandidateList', () => {
  it('lists only a "Best matches" section when unlikely is empty', () => {
    const best = [makeMeta('2026-03-05-alpha', '/root/docs/plans/2026-03-05-alpha')];
    const result = formatCandidateList(best, [], FIXED_NOW);
    expect(result).toContain('Best matches:');
    expect(result).toContain('2026-03-05-alpha');
    expect(result).not.toContain('Unlikely');
  });

  it('includes an "Unlikely" section when unlikely candidates are present', () => {
    const best = [makeMeta('2026-03-05-alpha', '/root/docs/plans/2026-03-05-alpha')];
    const unlikely = [makeMeta('2026-01-01-old', '/root/docs/plans/2026-01-01-old')];
    const result = formatCandidateList(best, unlikely, FIXED_NOW);
    expect(result).toContain('Best matches:');
    expect(result).toContain('2026-03-05-alpha');
    expect(result).toContain('Unlikely');
    expect(result).toContain('2026-01-01-old');
  });

  it('renders best entries before unlikely entries', () => {
    const best = [makeMeta('2026-03-05-alpha', '/root/docs/plans/2026-03-05-alpha')];
    const unlikely = [makeMeta('2026-01-01-old', '/root/docs/plans/2026-01-01-old')];
    const result = formatCandidateList(best, unlikely, FIXED_NOW);
    expect(result.indexOf('2026-03-05-alpha')).toBeLessThan(result.indexOf('2026-01-01-old'));
  });

  it('includes the plan_path of each candidate', () => {
    const best = [makeMeta('2026-03-05-alpha', '/my/project/docs/plans/2026-03-05-alpha')];
    const result = formatCandidateList(best, [], FIXED_NOW);
    expect(result).toContain('/my/project/docs/plans/2026-03-05-alpha');
  });

  it('appends a relative time label to each best match entry', () => {
    // 21 minutes before FIXED_NOW
    const best = [makeMeta('2026-03-06-recent', '/root/docs/plans/2026-03-06-recent', '2026-03-06T11:39:00Z')];
    const result = formatCandidateList(best, [], FIXED_NOW);
    expect(result).toContain('last active 21mn ago');
  });

  it('does NOT append a time label to unlikely entries', () => {
    const best = [makeMeta('2026-03-06-recent', '/root/docs/plans/2026-03-06-recent', '2026-03-06T11:39:00Z')];
    const unlikely = [makeMeta('2026-01-01-old', '/root/docs/plans/2026-01-01-old', '2026-01-01T00:00:00Z')];
    const result = formatCandidateList(best, unlikely, FIXED_NOW);
    // The unlikely line should be a plain "  - path (slug)" with no time label
    const unlikelyLine = result.split('\n').find(l => l.includes('2026-01-01-old'))!;
    expect(unlikelyLine).not.toContain('last active');
  });
});
