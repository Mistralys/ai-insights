/**
 * Tests for resolveProjectDir() — bare-slug and qualified-slug resolution.
 *
 * Covers:
 *   - AC1: Qualified {repo}/{slug} input resolves directly without filesystem access
 *   - AC2: Bare slug that exists in exactly one repo namespace resolves correctly
 *   - AC3: Bare slug that exists in two or more namespaces throws AMBIGUOUS error
 *   - AC4: Each segment of a qualified input is validated individually (repo and slug
 *           validated separately — no composite string)
 *   - NOT_FOUND: bare slug with no match throws a NOT_FOUND error
 *   - Dot-prefixed namespace directories are skipped during bare-slug scanning
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { resolveProjectDir } from '../../src/utils/ledger-root.js';

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('resolveProjectDir', () => {
  let tempLedgerRoot: string;

  beforeEach(async () => {
    tempLedgerRoot = await mkdtemp(join(tmpdir(), 'slug-res-test-'));
  });

  afterEach(async () => {
    await rm(tempLedgerRoot, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------------------
  // AC1: Qualified {repo}/{slug} input
  // ---------------------------------------------------------------------------

  it('returns join(ledgerRoot, repo, slug) for a qualified {repo}/{slug} input', async () => {
    const result = await resolveProjectDir('ai-insights/2026-05-01-my-plan', tempLedgerRoot);
    expect(result).toBe(join(tempLedgerRoot, 'ai-insights', '2026-05-01-my-plan'));
  });

  it('resolves a qualified input without requiring the directory to exist on disk', async () => {
    // ledger root is empty — qualified lookup must not touch the filesystem
    const result = await resolveProjectDir('repo-a/2026-01-01-plan', tempLedgerRoot);
    expect(result).toBe(join(tempLedgerRoot, 'repo-a', '2026-01-01-plan'));
  });

  // ---------------------------------------------------------------------------
  // AC2: Bare slug with exactly one matching namespace
  // ---------------------------------------------------------------------------

  it('returns the storage path when a bare slug exists in exactly one repo namespace', async () => {
    await mkdir(join(tempLedgerRoot, 'repo-a', '2026-05-01-my-plan'), { recursive: true });
    // A different slug in another namespace must not affect the result
    await mkdir(join(tempLedgerRoot, 'repo-b', '2026-05-01-other-plan'), { recursive: true });

    const result = await resolveProjectDir('2026-05-01-my-plan', tempLedgerRoot);
    expect(result).toBe(join(tempLedgerRoot, 'repo-a', '2026-05-01-my-plan'));
  });

  it('returns the correct path when only one namespace directory contains the slug', async () => {
    await mkdir(join(tempLedgerRoot, 'ai-insights', '2026-04-10-feature'), { recursive: true });
    await mkdir(join(tempLedgerRoot, 'other-repo'), { recursive: true }); // namespace exists but slug does not

    const result = await resolveProjectDir('2026-04-10-feature', tempLedgerRoot);
    expect(result).toBe(join(tempLedgerRoot, 'ai-insights', '2026-04-10-feature'));
  });

  // ---------------------------------------------------------------------------
  // AC3: Bare slug with two or more matching namespaces — AMBIGUOUS error
  // ---------------------------------------------------------------------------

  it('throws an AMBIGUOUS error when a bare slug exists in two repo namespaces', async () => {
    await mkdir(join(tempLedgerRoot, 'repo-a', '2026-04-23-duplicate'), { recursive: true });
    await mkdir(join(tempLedgerRoot, 'repo-b', '2026-04-23-duplicate'), { recursive: true });

    await expect(
      resolveProjectDir('2026-04-23-duplicate', tempLedgerRoot)
    ).rejects.toThrow('AMBIGUOUS');
  });

  it('includes all matching qualified paths in the AMBIGUOUS error message', async () => {
    await mkdir(join(tempLedgerRoot, 'repo-a', '2026-04-23-duplicate'), { recursive: true });
    await mkdir(join(tempLedgerRoot, 'repo-b', '2026-04-23-duplicate'), { recursive: true });

    let caughtError: Error | undefined;
    try {
      await resolveProjectDir('2026-04-23-duplicate', tempLedgerRoot);
    } catch (err) {
      caughtError = err as Error;
    }

    expect(caughtError).toBeDefined();
    expect(caughtError!.message).toContain('repo-a/2026-04-23-duplicate');
    expect(caughtError!.message).toContain('repo-b/2026-04-23-duplicate');
  });

  it('throws AMBIGUOUS even when three namespaces contain the same slug', async () => {
    await mkdir(join(tempLedgerRoot, 'repo-a', '2026-04-23-triple'), { recursive: true });
    await mkdir(join(tempLedgerRoot, 'repo-b', '2026-04-23-triple'), { recursive: true });
    await mkdir(join(tempLedgerRoot, 'repo-c', '2026-04-23-triple'), { recursive: true });

    await expect(
      resolveProjectDir('2026-04-23-triple', tempLedgerRoot)
    ).rejects.toThrow('AMBIGUOUS');
  });

  // ---------------------------------------------------------------------------
  // AC4: Each segment of a qualified input validated separately
  // ---------------------------------------------------------------------------

  it('throws when the repo segment fails validation (uppercase not allowed)', async () => {
    // 'UPPERCASE-REPO' fails SAFE_SLUG_REGEX — slug segment is valid
    await expect(
      resolveProjectDir('UPPERCASE-REPO/2026-01-01-slug', tempLedgerRoot)
    ).rejects.toThrow();
  });

  it('throws when the slug segment fails validation while the repo segment is valid', async () => {
    // repo is valid; 'INVALID-SLUG' fails SAFE_SLUG_REGEX
    await expect(
      resolveProjectDir('valid-repo/INVALID-SLUG', tempLedgerRoot)
    ).rejects.toThrow();
  });

  it('throws on path-traversal in the repo segment', async () => {
    // '..' is invalid — the function splits at the first '/', giving repo='..'
    await expect(
      resolveProjectDir('../etc/passwd', tempLedgerRoot)
    ).rejects.toThrow();
  });

  it('throws on path-traversal in the slug segment', async () => {
    await expect(
      resolveProjectDir('valid-repo/../etc/passwd', tempLedgerRoot)
    ).rejects.toThrow();
  });

  it('throws when the repo segment is empty (input starts with "/")', async () => {
    await expect(
      resolveProjectDir('/2026-01-01-slug', tempLedgerRoot)
    ).rejects.toThrow();
  });

  it('throws when the slug segment is empty (input ends with "/")', async () => {
    await expect(
      resolveProjectDir('valid-repo/', tempLedgerRoot)
    ).rejects.toThrow();
  });

  // ---------------------------------------------------------------------------
  // NOT_FOUND: bare slug with no match
  // ---------------------------------------------------------------------------

  it('throws a NOT_FOUND error when a bare slug does not exist in any namespace', async () => {
    // A namespace exists but contains a different slug
    await mkdir(join(tempLedgerRoot, 'repo-a', '2026-01-01-other'), { recursive: true });

    await expect(
      resolveProjectDir('2026-99-99-nonexistent', tempLedgerRoot)
    ).rejects.toThrow('NOT_FOUND');
  });

  it('throws NOT_FOUND when the ledger root is empty', async () => {
    await expect(
      resolveProjectDir('2026-01-01-any-slug', tempLedgerRoot)
    ).rejects.toThrow('NOT_FOUND');
  });

  it('throws on path-traversal in a bare slug (".." input rejects with Invalid path segment)', async () => {
    // '..' has no '/' so it enters the bare-slug branch; assertSafeSlug must reject it
    // before any filesystem access regardless of what directories exist under ledgerRoot
    await mkdir(join(tempLedgerRoot, 'repo-a'), { recursive: true });
    await expect(
      resolveProjectDir('..', tempLedgerRoot)
    ).rejects.toThrow('Invalid path segment');
  });

  // ---------------------------------------------------------------------------
  // Dot-prefixed namespace directories are skipped
  // ---------------------------------------------------------------------------

  it('does not match a project inside a dot-prefixed namespace directory', async () => {
    await mkdir(join(tempLedgerRoot, '.hidden-namespace', '2026-01-01-plan'), {
      recursive: true,
    });

    await expect(
      resolveProjectDir('2026-01-01-plan', tempLedgerRoot)
    ).rejects.toThrow('NOT_FOUND');
  });

  it('skips the .archive directory when scanning for bare-slug matches', async () => {
    await mkdir(join(tempLedgerRoot, '.archive', '2026-01-01-plan'), { recursive: true });
    await mkdir(join(tempLedgerRoot, 'real-repo', '2026-02-01-other'), { recursive: true });

    // .archive should be skipped; no match for this slug
    await expect(
      resolveProjectDir('2026-01-01-plan', tempLedgerRoot)
    ).rejects.toThrow('NOT_FOUND');
  });
});
