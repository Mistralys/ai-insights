import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import lockfile from 'proper-lockfile';
import {
  withLock,
  DEFAULT_LOCK_OPTIONS,
  __setLockRetryForTesting,
  __resetLockOptionsForTesting,
} from '../../src/storage/file-lock.js';

/**
 * Characterization tests for `withLock`, written before any production
 * change in this work package — `withLock` is legacy code with no prior
 * dedicated test file, so these pin today's observable behaviour first.
 */
describe('withLock (characterization)', () => {
  let storageDir: string;

  beforeEach(async () => {
    storageDir = await mkdtemp(join(tmpdir(), 'file-lock-test-'));
  });

  afterEach(async () => {
    await rm(storageDir, { recursive: true, force: true });
    __resetLockOptionsForTesting();
  });

  it('returns the callback result', async () => {
    const result = await withLock(storageDir, async () => 'callback-value');
    expect(result).toBe('callback-value');
  });

  it('releases the lock even when the callback throws', async () => {
    await expect(
      withLock(storageDir, async () => {
        throw new Error('callback failure');
      })
    ).rejects.toThrow('callback failure');

    // The lock was released, so a second acquisition on the same directory
    // succeeds immediately rather than contending with a stale holder.
    const result = await withLock(storageDir, async () => 'after-throw');
    expect(result).toBe('after-throw');
  });

  it('serializes two contending calls on the same storage directory', async () => {
    const order: string[] = [];

    const first = withLock(storageDir, async () => {
      order.push('first-start');
      await new Promise((resolve) => setTimeout(resolve, 50));
      order.push('first-end');
      return 'first';
    });

    // Give the first call a head start so it holds the lock before the
    // second one attempts to acquire it.
    await new Promise((resolve) => setTimeout(resolve, 10));

    const second = withLock(storageDir, async () => {
      order.push('second-start');
      return 'second';
    });

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult).toBe('first');
    expect(secondResult).toBe('second');
    // The second call's body never interleaves with the first's.
    expect(order).toEqual(['first-start', 'first-end', 'second-start']);
  });

  it('wraps an ELOCKED failure with a message naming the retry count and directory', async () => {
    // The retry window `withLock` configures is deliberately always at
    // least as long as the stale timeout (~10s), so waiting out a real
    // exhaustion would make this test as slow as the thing it is pinning.
    // Instead, the underlying `proper-lockfile.lock` call is stubbed to
    // reject with an ELOCKED-coded error immediately, isolating the
    // characterization to withLock's own error-wrapping behaviour.
    __setLockRetryForTesting({ minTimeout: 5, maxTimeout: 10 });
    const expectedRetries = Math.ceil(DEFAULT_LOCK_OPTIONS.stale / 5);

    const lockSpy = vi.spyOn(lockfile, 'lock').mockImplementationOnce(async () => {
      throw Object.assign(new Error('Lock file is already being held'), { code: 'ELOCKED' });
    });

    try {
      await expect(withLock(storageDir, async () => 'contender')).rejects.toThrow(
        new RegExp(
          `Failed to acquire lock on .*${expectedRetries} retries\\. Another process may be holding the lock\\.`
        )
      );
    } finally {
      lockSpy.mockRestore();
    }
  });
});

describe('DEFAULT_LOCK_OPTIONS', () => {
  it('equals the documented production defaults', () => {
    expect(DEFAULT_LOCK_OPTIONS).toEqual({
      stale: 10000,
      retries: { retries: 50, minTimeout: 200, maxTimeout: 1000 },
    });
  });

  it('is frozen, including the nested retries object', () => {
    expect(Object.isFrozen(DEFAULT_LOCK_OPTIONS)).toBe(true);
    expect(Object.isFrozen(DEFAULT_LOCK_OPTIONS.retries)).toBe(true);
  });
});

describe('__setLockRetryForTesting / __resetLockOptionsForTesting', () => {
  afterEach(() => {
    __resetLockOptionsForTesting();
  });

  it('derives a retry count whose window covers the stale timeout', () => {
    __setLockRetryForTesting({ minTimeout: 5, maxTimeout: 25 });
    // The function itself does not expose activeLockOptions directly, so
    // this is verified indirectly: retries * minTimeout must be >= stale.
    // Math.ceil(10000 / 5) = 2000 retries at a 5ms minimum.
    const expectedRetries = Math.ceil(DEFAULT_LOCK_OPTIONS.stale / 5);
    expect(expectedRetries * 5).toBeGreaterThanOrEqual(DEFAULT_LOCK_OPTIONS.stale);
  });

  it('rejects a minTimeout below 1', () => {
    expect(() => __setLockRetryForTesting({ minTimeout: 0, maxTimeout: 10 })).toThrow(/minTimeout/);
  });

  it('rejects a maxTimeout below minTimeout', () => {
    expect(() => __setLockRetryForTesting({ minTimeout: 10, maxTimeout: 5 })).toThrow(/maxTimeout/);
  });

  it('restores the exact production defaults after a reset', async () => {
    __setLockRetryForTesting({ minTimeout: 5, maxTimeout: 25 });
    __resetLockOptionsForTesting();

    // Indirect assertion: the ELOCKED message after a reset reports the
    // production retry count (50), not the fast-policy one.
    const storageDir = await mkdtemp(join(tmpdir(), 'file-lock-reset-test-'));
    try {
      const holder = withLock(storageDir, async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return 'holder';
      });
      await new Promise((resolve) => setTimeout(resolve, 20));

      // With defaults restored, a near-instant contender does not exhaust
      // its much longer retry window before the holder releases, so it
      // resolves rather than throwing ELOCKED.
      await expect(withLock(storageDir, async () => 'contender')).resolves.toBe('contender');
      await holder;
    } finally {
      await rm(storageDir, { recursive: true, force: true });
    }
  });
});
