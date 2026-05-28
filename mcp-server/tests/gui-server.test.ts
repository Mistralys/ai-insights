/**
 * Unit tests for resolveRepoName() in gui/server.ts (WP-004)
 *
 * Verifies that assertSafeSlug() guards are called as the first two statements
 * in resolveRepoName(), rejecting traversal input before any filesystem access
 * is attempted.
 *
 * The guard fires BEFORE readFile, so invalid inputs produce a distinct error
 * message ("Invalid repo or slug parameter") rather than the filesystem-failure
 * message ("Project not found") that would appear if readFile were reached.
 */

import { describe, it, expect } from 'vitest';
import { ApiError } from '../gui/api.js';
import { resolveRepoName } from '../gui/server.js';

// ---------------------------------------------------------------------------
// Helper: assert both that the error is an ApiError and that it came from
// the assertSafeSlug guard (not from a later readFile failure).
// ---------------------------------------------------------------------------

async function expectGuardError(
  repo: string,
  slug: string,
): Promise<void> {
  let thrown: unknown;
  try {
    await resolveRepoName('/ledger', repo, slug);
  } catch (err) {
    thrown = err;
  }
  expect(thrown).toBeInstanceOf(ApiError);
  const err = thrown as ApiError;
  expect(err.code).toBe('NOT_FOUND');
  // Guard message pattern — distinct from the readFile failure message.
  expect(err.message).toMatch(/Invalid repo or slug parameter/i);
}

describe('resolveRepoName() — assertSafeSlug guards', () => {
  // -------------------------------------------------------------------------
  // repoUrlParam guard
  // -------------------------------------------------------------------------

  it('throws a guard error for a traversal repoUrlParam (before filesystem access)', async () => {
    await expectGuardError('../etc', 'valid-slug');
  });

  it('throws a guard error for an empty repoUrlParam', async () => {
    await expectGuardError('', 'valid-slug');
  });

  it('throws a guard error for an uppercase repoUrlParam', async () => {
    await expectGuardError('MyRepo', 'valid-slug');
  });

  it('throws a guard error for a repoUrlParam with path separators', async () => {
    await expectGuardError('repo/with/slashes', 'valid-slug');
  });

  it('throws a guard error for a repoUrlParam starting with a hyphen', async () => {
    await expectGuardError('-bad-repo', 'valid-slug');
  });

  // -------------------------------------------------------------------------
  // slugUrlParam guard
  // -------------------------------------------------------------------------

  it('throws a guard error for a traversal slugUrlParam (before filesystem access)', async () => {
    await expectGuardError('valid-repo', '../etc');
  });

  it('throws a guard error for an empty slugUrlParam', async () => {
    await expectGuardError('valid-repo', '');
  });

  it('throws a guard error for an uppercase slugUrlParam', async () => {
    await expectGuardError('valid-repo', 'MySlug');
  });

  it('throws a guard error for a slugUrlParam starting with a hyphen', async () => {
    await expectGuardError('valid-repo', '-bad-slug');
  });

  // -------------------------------------------------------------------------
  // Valid inputs — guards pass, filesystem access IS attempted.
  // The readFile failure produces "Project not found" (not the guard message),
  // confirming the guard did not fire.
  // -------------------------------------------------------------------------

  it('reaches filesystem access (not a guard error) for valid repo and slug', async () => {
    let thrown: unknown;
    try {
      // No .meta.json exists for this path, so readFile throws ENOENT.
      await resolveRepoName('/nonexistent-ledger-root', 'my-repo', 'my-slug');
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(ApiError);
    const err = thrown as ApiError;
    expect(err.code).toBe('NOT_FOUND');
    // The readFile failure message — NOT the guard message.
    expect(err.message).toContain('my-slug');
    expect(err.message).not.toMatch(/Invalid repo or slug parameter/i);
  });
});

