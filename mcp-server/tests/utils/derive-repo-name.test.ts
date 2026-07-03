import { describe, it, expect } from 'vitest';
import { deriveRepoName } from '../../src/utils/ledger-root.js';

describe('deriveRepoName', () => {
  it('returns the repo name from a standard 4-level-deep plan path', () => {
    expect(deriveRepoName('/repos/ai-insights/docs/agents/plans/2026-05-01-my-plan')).toBe('ai-insights');
  });

  it('lowercases the inferred repo name', () => {
    expect(deriveRepoName('/repos/AI-Insights/docs/agents/plans/2026-05-01-my-plan')).toBe('ai-insights');
  });

  it('returns the repo name from a Windows-style path', () => {
    const winPath = 'C:\\Users\\user\\ai-insights\\docs\\agents\\plans\\2026-05-01-my-plan';
    expect(deriveRepoName(winPath)).toBe('ai-insights');
  });

  it('returns the repo name from a mixed-separator Windows path', () => {
    expect(deriveRepoName('C:/Users/user/cli-menu/docs/agents/plans/2026-05-01-my-plan')).toBe('cli-menu');
  });

  it('returns "unknown" when the path is too shallow to infer a project root', () => {
    // Only 2 levels deep — walking up 4 hits the filesystem root
    expect(deriveRepoName('/plans/2026-05-01-my-plan')).toBe('unknown');
  });

  it('returns "unknown" for an empty string', () => {
    expect(deriveRepoName('')).toBe('unknown');
  });

  it('returns "unknown" when the inferred root basename contains underscores', () => {
    // Underscores are not permitted in safe slugs
    expect(deriveRepoName('/repos/my_project/docs/agents/plans/2026-05-01-my-plan')).toBe('unknown');
  });

  it('returns "unknown" when the inferred root basename contains spaces', () => {
    expect(deriveRepoName('/repos/my project/docs/agents/plans/2026-05-01-my-plan')).toBe('unknown');
  });

  it('handles a numeric-only repo name (valid safe slug)', () => {
    expect(deriveRepoName('/repos/42/docs/agents/plans/2026-05-01-my-plan')).toBe('42');
  });

  it('returns the correct repo name regardless of plan slug depth', () => {
    // Different project, same 4-level convention
    expect(deriveRepoName('/home/user/ai-persona-builder/docs/agents/plans/2026-04-23-create-comtype')).toBe('ai-persona-builder');
  });

  it('uses the provided resolvedRoot directly, bypassing inferProjectRootFromPlanPath', () => {
    // A shallow path has no docs/agents anchor → inferProjectRootFromPlanPath returns null → 'unknown'.
    // Passing an explicit resolvedRoot causes the function to use it directly.
    expect(deriveRepoName('/some/path', '/projects/my-project')).toBe('my-project');
  });

  it('returns "unknown" when resolvedRoot is explicitly null', () => {
    // null resolvedRoot skips the internal call and falls through to the null check.
    expect(deriveRepoName('/repos/ai-insights/docs/agents/plans/2026-05-01-my-plan', null)).toBe('unknown');
  });
});
