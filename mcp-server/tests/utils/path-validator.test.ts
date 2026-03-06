import { describe, it, expect, vi, afterEach } from 'vitest';
import { join } from 'path';
import { z } from 'zod';
import { LedgerStore } from '../../src/storage/ledger-store.js';
import {
  validatePlanPath,
  planFolderBasename,
  resolveProjectPath,
  mutuallyExclusivePaths,
  MUTUAL_EXCLUSIVITY_PATH_MSG,
  formatCandidateList,
} from '../../src/utils/path-validator.js';

describe('validatePlanPath', () => {
  it('should accept valid plan paths with date prefix', () => {
    const validPaths = [
      'f:\\Webserver\\www\\htdocs\\tools\\x4-mod-cargo-sizes\\docs\\agents\\plans\\2026-02-16-technical-debt-cleanup',
      '/home/user/project/docs/agents/plans/2026-01-15-feature-implementation',
      'C:\\Projects\\myapp\\docs\\agents\\plans\\2025-12-31-year-end-refactor',
      '/tmp/2024-06-01-test-project',
    ];

    for (const path of validPaths) {
      const result = validatePlanPath(path);
      expect(result.isValid).toBe(true);
      expect(result.error).toBeUndefined();
    }
  });

  it('should reject paths that do not end with date prefix pattern', () => {
    const invalidPaths = [
      'f:\\Webserver\\www\\htdocs\\tools\\x4-mod-cargo-sizes',
      '/home/user/project',
      'C:\\Projects\\myapp\\docs\\agents\\plans',
      '/tmp/my-project',
      '/home/user/project/technical-debt-cleanup',
      'C:\\Projects\\myapp\\2026-02-16', // No project name after date
    ];

    for (const path of invalidPaths) {
      const result = validatePlanPath(path);
      expect(result.isValid).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('Invalid project path format');
      expect(result.error).toContain('YYYY-MM-DD');
    }
  });

  it('should provide helpful error message for invalid paths', () => {
    const result = validatePlanPath('f:\\Webserver\\www\\htdocs\\tools\\x4-mod-cargo-sizes');
    
    expect(result.isValid).toBe(false);
    expect(result.error).toContain('x4-mod-cargo-sizes');
    expect(result.error).toContain('YYYY-MM-DD-{project-name}');
    expect(result.error).toContain('project root path');
    expect(result.error).toContain('plan-specific path');
  });

  it('should accept edge cases with valid date patterns', () => {
    const edgeCases = [
      '/tmp/2026-02-16-a', // Minimal project name (single character)
      '/tmp/2026-02-16-my-very-long-project-name-with-many-hyphens',
      '/tmp/2000-01-01-year2k', // Old date
      '/tmp/2099-12-31-future', // Far future date
    ];

    for (const path of edgeCases) {
      const result = validatePlanPath(path);
      expect(result.isValid).toBe(true);
    }
  });

  it('should reject paths with malformed date patterns', () => {
    const malformedDates = [
      '/tmp/26-02-16-project', // 2-digit year
      '/tmp/2026-2-16-project', // Missing leading zero in month
      '/tmp/2026-02-6-project', // Missing leading zero in day
      '/tmp/02-16-2026-project', // Wrong date order (MM-DD-YYYY)
    ];

    for (const path of malformedDates) {
      const result = validatePlanPath(path);
      expect(result.isValid).toBe(false);
    }
  });

  it('should accept paths with date patterns even if date values are unrealistic', () => {
    // Note: We only validate the pattern format (YYYY-MM-DD-name), not semantic date validity
    // This is intentional - our goal is to catch wrong path levels, not validate calendar dates
    const patternsWithUnrealisticDates = [
      '/tmp/2026-13-01-project', // Month > 12 (but follows pattern)
      '/tmp/2026-02-32-project', // Day > 31 (but follows pattern)
      '/tmp/9999-99-99-project', // Nonsensical but follows pattern
    ];

    for (const path of patternsWithUnrealisticDates) {
      const result = validatePlanPath(path);
      expect(result.isValid).toBe(true); // Pattern matches, which is our requirement
    }
  });
});

describe('planFolderBasename', () => {
  it('returns the basename for a valid YYYY-MM-DD-{name} path', () => {
    const path = join('/some', 'project', 'docs', 'agents', 'plans', '2026-02-16-my-feature');
    expect(planFolderBasename(path)).toBe('2026-02-16-my-feature');
  });

  it('returns basename on a minimal single-character project name', () => {
    const path = join('/tmp', '2026-01-01-a');
    expect(planFolderBasename(path)).toBe('2026-01-01-a');
  });

  it('handles Windows-style backslash paths', () => {
    const winPath = 'C:\\Projects\\docs\\plans\\2026-03-15-feature-x';
    expect(planFolderBasename(winPath)).toBe('2026-03-15-feature-x');
  });

  it('throws for a path whose basename does not match YYYY-MM-DD-{name}', () => {
    const invalid = '/home/user/project/my-project';
    expect(() => planFolderBasename(invalid)).toThrow('Invalid project path format');
    expect(() => planFolderBasename(invalid)).toThrow('YYYY-MM-DD');
  });

  it('throws for a path with only a date and no project name suffix', () => {
    const invalid = '/tmp/2026-02-16';
    expect(() => planFolderBasename(invalid)).toThrow('Invalid project path format');
  });

  it('throws for a path with a 2-digit year', () => {
    const invalid = '/tmp/26-02-16-project';
    expect(() => planFolderBasename(invalid)).toThrow('Invalid project path format');
  });

  it('throws for a path with no date prefix at all', () => {
    expect(() => planFolderBasename('/some/path/without/date')).toThrow('Invalid project path format');
  });
});

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

  it('throws when both project_path and cwd_path are provided', async () => {
    await expect(
      resolveProjectPath({ project_path: '/a', cwd_path: '/b' })
    ).rejects.toThrow(MUTUAL_EXCLUSIVITY_PATH_MSG);
  });

  it('throws when neither project_path nor cwd_path is provided', async () => {
    await expect(resolveProjectPath({})).rejects.toThrow(
      'Either project_path or cwd_path is required.'
    );
  });
});

// ---------------------------------------------------------------------------
// mutuallyExclusivePaths + MUTUAL_EXCLUSIVITY_PATH_MSG
// ---------------------------------------------------------------------------

describe('mutuallyExclusivePaths', () => {
  it('returns true when only project_path is provided', () => {
    expect(mutuallyExclusivePaths({ project_path: '/some/plan/2026-01-01-test' })).toBe(true);
  });

  it('returns true when only cwd_path is provided', () => {
    expect(mutuallyExclusivePaths({ cwd_path: '/workspace/root' })).toBe(true);
  });

  it('returns true when neither field is provided', () => {
    expect(mutuallyExclusivePaths({})).toBe(true);
  });

  it('returns false when both project_path and cwd_path are provided', () => {
    expect(
      mutuallyExclusivePaths({
        project_path: '/some/plan/2026-01-01-test',
        cwd_path: '/workspace/root',
      })
    ).toBe(false);
  });

  it('returns true when project_path is empty string (falsy)', () => {
    expect(mutuallyExclusivePaths({ project_path: '', cwd_path: '/workspace/root' })).toBe(true);
  });

  it('returns true when cwd_path is undefined and project_path is set', () => {
    expect(mutuallyExclusivePaths({ project_path: '/plan/2026-01-01-x', cwd_path: undefined })).toBe(true);
  });
});

describe('MUTUAL_EXCLUSIVITY_PATH_MSG', () => {
  it('is a non-empty string', () => {
    expect(typeof MUTUAL_EXCLUSIVITY_PATH_MSG).toBe('string');
    expect(MUTUAL_EXCLUSIVITY_PATH_MSG.length).toBeGreaterThan(0);
  });

  it('is surfaced by a Zod schema refine when both paths are provided', () => {
    const TestSchema = z.object({
      project_path: z.string().optional(),
      cwd_path: z.string().optional(),
    }).refine(mutuallyExclusivePaths, { message: MUTUAL_EXCLUSIVITY_PATH_MSG });

    // Both fields → validation error with expected message
    const result = TestSchema.safeParse({
      project_path: '/some/plan/2026-01-01-test',
      cwd_path: '/workspace/root',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errors[0]!.message).toBe(MUTUAL_EXCLUSIVITY_PATH_MSG);
    }
  });

  it('Zod schema with refine accepts project_path only', () => {
    const TestSchema = z.object({
      project_path: z.string().optional(),
      cwd_path: z.string().optional(),
    }).refine(mutuallyExclusivePaths, { message: MUTUAL_EXCLUSIVITY_PATH_MSG });

    expect(TestSchema.safeParse({ project_path: '/some/plan/2026-01-01-x' }).success).toBe(true);
  });

  it('Zod schema with refine accepts cwd_path only', () => {
    const TestSchema = z.object({
      project_path: z.string().optional(),
      cwd_path: z.string().optional(),
    }).refine(mutuallyExclusivePaths, { message: MUTUAL_EXCLUSIVITY_PATH_MSG });

    expect(TestSchema.safeParse({ cwd_path: '/workspace' }).success).toBe(true);
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
