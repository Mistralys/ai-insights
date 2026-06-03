import { describe, it, expect } from 'vitest';
import { join } from 'path';
import {
  validatePlanPath,
  planFolderBasename,
  assertSafeSegment,
  MAX_SEGMENT_LENGTH,
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

// ---------------------------------------------------------------------------
// assertSafeSegment
// ---------------------------------------------------------------------------

describe('assertSafeSegment', () => {
  it('returns true for valid slug segments', () => {
    expect(assertSafeSegment('abc')).toBe(true);
    expect(assertSafeSegment('a')).toBe(true);
    expect(assertSafeSegment('abc123')).toBe(true);
    expect(assertSafeSegment('my-project')).toBe(true);
    expect(assertSafeSegment('a1b2-c3d4')).toBe(true);
    expect(assertSafeSegment('2026-03-01-feature')).toBe(true);
  });

  it('returns false for an empty string', () => {
    expect(assertSafeSegment('')).toBe(false);
  });

  it('returns false for traversal patterns', () => {
    expect(assertSafeSegment('../etc')).toBe(false);
    expect(assertSafeSegment('..')).toBe(false);
    expect(assertSafeSegment('../')).toBe(false);
    expect(assertSafeSegment('foo/../bar')).toBe(false);
  });

  it('returns false for uppercase characters', () => {
    expect(assertSafeSegment('ABC')).toBe(false);
    expect(assertSafeSegment('MyProject')).toBe(false);
    expect(assertSafeSegment('my-Project')).toBe(false);
  });

  it('returns false for segments containing spaces', () => {
    expect(assertSafeSegment('my project')).toBe(false);
    expect(assertSafeSegment(' abc')).toBe(false);
  });

  it('returns false for segments starting with a hyphen', () => {
    expect(assertSafeSegment('-abc')).toBe(false);
    expect(assertSafeSegment('-')).toBe(false);
  });

  it('returns false for segments containing path separators', () => {
    expect(assertSafeSegment('foo/bar')).toBe(false);
    expect(assertSafeSegment('foo\\bar')).toBe(false);
  });

  it('returns false for segments with special characters', () => {
    expect(assertSafeSegment('foo_bar')).toBe(false);
    expect(assertSafeSegment('foo.bar')).toBe(false);
    expect(assertSafeSegment('foo@bar')).toBe(false);
  });

  it('returns true for a segment exactly at the maximum length boundary', () => {
    const atLimit = 'a' + 'b'.repeat(MAX_SEGMENT_LENGTH - 1);
    expect(atLimit.length).toBe(MAX_SEGMENT_LENGTH);
    expect(assertSafeSegment(atLimit)).toBe(true);
  });

  it('returns false for a segment one character over the maximum length', () => {
    const overLimit = 'a' + 'b'.repeat(MAX_SEGMENT_LENGTH);
    expect(overLimit.length).toBe(MAX_SEGMENT_LENGTH + 1);
    expect(assertSafeSegment(overLimit)).toBe(false);
  });

  it('returns false for a very long but otherwise valid segment', () => {
    const veryLong = 'a' + 'b'.repeat(499);
    expect(assertSafeSegment(veryLong)).toBe(false);
  });
});
