/**
 * Tests for `scripts/lib/ledger-bridge.js` (WP-002).
 *
 * Coverage:
 *   - loadDistModule() resolves a compiled `mcp-server/dist/` module and
 *     returns the requested export.
 *   - loadDistModule() caches the dynamic import — repeated calls with the
 *     same relative path resolve to the exact same module namespace object.
 *   - `scripts/lib/ledger-dirs.js` still exports `listAllProjectDirs(storeRoot)`
 *     with its original signature and contract, now delegating through the
 *     bridge.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

import { loadDistModule } from '../lib/ledger-bridge.js';
import { listAllProjectDirs } from '../lib/ledger-dirs.js';

describe('ledger-bridge', () => {
  describe('loadDistModule()', () => {
    it('resolves the requested compiled module and export', async () => {
      const mod = await loadDistModule('storage/ledger-store.js');
      expect(mod.LedgerStore).toBeDefined();
      expect(typeof mod.LedgerStore.listAllProjectDirs).toBe('function');
    });

    it('caches the dynamic import — repeated calls return the same module namespace object', async () => {
      const first = await loadDistModule('storage/ledger-store.js');
      const second = await loadDistModule('storage/ledger-store.js');
      expect(second).toBe(first);
    });
  });

  describe('ledger-dirs.js re-export', () => {
    let tempDir;

    afterEach(async () => {
      if (tempDir) await rm(tempDir, { recursive: true, force: true });
    });

    it('listAllProjectDirs(storeRoot) keeps its original signature and returns project directories', async () => {
      tempDir = await mkdtemp(join(tmpdir(), 'ledger-bridge-dirs-'));
      const projectDir = join(tempDir, 'my-project');
      await mkdir(projectDir, { recursive: true });
      await writeFile(
        join(projectDir, '.meta.json'),
        JSON.stringify({
          slug: 'my-project',
          plan_path: '/home/user/repo/docs/agents/plans/my-project',
          status: 'IN_PROGRESS',
          date_created: '2026-01-01T00:00:00Z',
          last_updated: '2026-01-01T00:00:00Z',
        })
      );

      const dirs = await listAllProjectDirs(tempDir);
      expect(dirs).toContain(projectDir);
    });

    it('returns an empty array for a store root with no projects', async () => {
      tempDir = await mkdtemp(join(tmpdir(), 'ledger-bridge-dirs-empty-'));
      const dirs = await listAllProjectDirs(tempDir);
      expect(dirs).toEqual([]);
    });
  });
});
