/**
 * Unit tests for gui/setup-notices.ts.
 *
 * Covers:
 *   - `detectSetupNotices()` returns the `personas-not-built` notice (with its
 *     `rebuild-personas` action) when `personas/name-mapping.json` is absent
 *   - `detectSetupNotices()` returns `[]` when the mapping is present
 *   - `handleGetSetupNotices()` wraps the same result in `{ notices }`
 *
 * `WORKSPACE_ROOT` is mocked via `../../src/utils/ledger-root.js` with a
 * getter, following the pattern already used in `tests/gui/api-models.test.ts`
 * and `tests/utils/name-mapping.test.ts`, so `resolveNameMappingPath()` — and
 * therefore `isNameMappingPresent()` — resolves against a clean temp
 * directory per test rather than the real workspace mapping.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

let tempWorkspaceRoot = '';

vi.mock('../../src/utils/ledger-root.js', () => ({
  get WORKSPACE_ROOT() {
    return tempWorkspaceRoot;
  },
  ORCHESTRATOR_LOGS_DIR: '/tmp/orchestrator-logs',
  resolveLedgerRoot: () => '/tmp/ledger',
  projectSlugFromPath: (p: string) => p,
  inferProjectRootFromPlanPath: () => null,
  deriveRepoName: () => 'unknown',
}));

// Import AFTER the mock is registered.
import { detectSetupNotices, handleGetSetupNotices } from '../../gui/setup-notices.js';
import { _resetNameMappingCache } from '../../src/utils/name-mapping.js';

function nameMappingDir(root: string): string {
  return join(root, 'personas');
}

function nameMappingFile(root: string): string {
  return join(nameMappingDir(root), 'name-mapping.json');
}

describe('gui/setup-notices.ts', () => {
  beforeEach(async () => {
    tempWorkspaceRoot = await mkdtemp(join(tmpdir(), 'setup-notices-test-'));
    _resetNameMappingCache();
  });

  afterEach(async () => {
    await rm(tempWorkspaceRoot, { recursive: true, force: true });
  });

  describe('detectSetupNotices()', () => {
    it('returns the personas-not-built notice with its rebuild-personas action when the mapping is absent', () => {
      const notices = detectSetupNotices();

      expect(notices).toEqual([
        {
          id: 'personas-not-built',
          title: expect.any(String),
          message: expect.any(String),
          action: { kind: 'rebuild-personas' },
        },
      ]);
    });

    it('returns an empty array when the mapping is present', async () => {
      await mkdir(nameMappingDir(tempWorkspaceRoot), { recursive: true });
      await writeFile(nameMappingFile(tempWorkspaceRoot), '[]', 'utf8');

      expect(detectSetupNotices()).toEqual([]);
    });
  });

  describe('handleGetSetupNotices()', () => {
    it('wraps detectSetupNotices() in { notices }', async () => {
      const result = await handleGetSetupNotices();

      expect(result.notices).toHaveLength(1);
      expect(result.notices[0]!.id).toBe('personas-not-built');
    });

    it('returns { notices: [] } once the mapping is present', async () => {
      await mkdir(nameMappingDir(tempWorkspaceRoot), { recursive: true });
      await writeFile(nameMappingFile(tempWorkspaceRoot), '[]', 'utf8');

      const result = await handleGetSetupNotices();

      expect(result).toEqual({ notices: [] });
    });
  });
});
