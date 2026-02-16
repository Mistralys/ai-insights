import { describe, it, expect } from 'vitest';
import { validatePlanPath } from '../../src/utils/path-validator.js';

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
