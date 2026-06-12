/**
 * Tests for the createNamespacedProject fixture factory.
 *
 * Verifies that the factory:
 *   AC1 — creates a properly namespaced project directory at
 *          {ledgerRoot}/{repo}/{slug}/
 *   AC2 — writes a valid project-ledger.json readable by LedgerStore
 *   AC3 — LedgerStore.repoName resolves to the supplied `repo` argument
 *   AC4 — cleanupNamespacedProject removes the temp directory
 *   AC5 — rootOverrides are applied to the written RootIndex
 */

import { describe, it, expect, afterEach } from 'vitest';
import { access } from 'fs/promises';
import { join } from 'path';
import { constants } from 'fs';
import {
  createNamespacedProject,
  cleanupNamespacedProject,
  type NamespacedProjectHandle,
} from './create-namespaced-project.js';
import { LedgerStore } from '../../../src/storage/ledger-store.js';

describe('createNamespacedProject fixture factory', () => {
  let handle: NamespacedProjectHandle | undefined;

  afterEach(async () => {
    if (handle) {
      await cleanupNamespacedProject(handle);
      handle = undefined;
    }
  });

  it('AC1: creates the {ledgerRoot}/{repo}/{slug}/ storage directory', async () => {
    handle = await createNamespacedProject('test-repo', '2026-01-15-my-feature');

    // The storage directory must exist: {ledgerRoot}/{repo}/{slug}/
    const expectedDir = join(handle.ledgerRoot, 'test-repo', '2026-01-15-my-feature');
    await expect(access(expectedDir, constants.F_OK)).resolves.toBeUndefined();
  });

  it('AC1: project-ledger.json is written at the correct path', async () => {
    handle = await createNamespacedProject('my-org', '2026-03-01-alpha');

    const ledgerFile = join(
      handle.ledgerRoot,
      'my-org',
      '2026-03-01-alpha',
      'project-ledger.json'
    );
    await expect(access(ledgerFile, constants.F_OK)).resolves.toBeUndefined();
  });

  it('AC2: LedgerStore can read back the written RootIndex', async () => {
    handle = await createNamespacedProject('acme-corp', '2026-06-01-test-slug');

    const stored = new LedgerStore(handle.planPath, handle.ledgerRoot);
    const root = await stored.readRootIndex();

    expect(root.status).toBe('IN_PROGRESS');
    expect(root.plan_file).toBe('plan.md');
    expect(root.work_packages).toEqual([]);
  });

  it('AC3: store.repoName resolves to the supplied repo argument', async () => {
    handle = await createNamespacedProject('special-repo', '2026-02-28-naming-test');

    expect(handle.store.repoName).toBe('special-repo');
    expect(handle.store.slug).toBe('2026-02-28-naming-test');
  });

  it('AC4: cleanupNamespacedProject removes the ledgerRoot directory', async () => {
    const h = await createNamespacedProject('cleanup-repo', '2026-01-01-cleanup');
    const { ledgerRoot } = h;

    await cleanupNamespacedProject(h);
    handle = undefined; // prevent double-cleanup in afterEach

    await expect(access(ledgerRoot, constants.F_OK)).rejects.toThrow();
  });

  it('AC5: rootOverrides are applied to the written RootIndex', async () => {
    handle = await createNamespacedProject(
      'override-repo',
      '2026-04-01-with-overrides',
      { status: 'COMPLETE', total_work_packages: 5, pending_work_packages: 0 }
    );

    const root = await handle.store.readRootIndex();

    expect(root.status).toBe('COMPLETE');
    expect(root.total_work_packages).toBe(5);
    expect(root.pending_work_packages).toBe(0);
  });
});
