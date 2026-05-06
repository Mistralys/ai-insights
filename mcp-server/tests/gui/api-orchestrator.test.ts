/**
 * Tests for orchestrator API route handlers in gui/api.ts — WP-008
 *
 * All acceptance criteria tested:
 *   AC-1: handleOrchestratorStart validates body.planPath is present and a string.
 *   AC-2: handleOrchestratorStart forwards dryRun flag correctly.
 *   AC-3: handleGetOrchestratorQueue returns an array of enriched entries.
 *   AC-4: handleOrchestratorKill returns { killed: boolean }.
 *   AC-5: handleOrchestratorDismiss returns 204 on success (void from handler).
 *   AC-6: All handlers follow the existing error handling patterns in api.ts.
 *
 * Uses vi.mock() to stub orchestrator-manager functions — the manager's own
 * behaviour is covered by orchestrator-manager.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the orchestrator-manager module before importing the handlers.
vi.mock('../../gui/orchestrator-manager.js', () => ({
  getQueue: vi.fn(),
  killQueueEntry: vi.fn(),
  dismissQueueEntry: vi.fn(),
  startOrchestrator: vi.fn(),
}));

import {
  handleOrchestratorStart,
  handleGetOrchestratorQueue,
  handleOrchestratorKill,
  handleOrchestratorDismiss,
  ApiError,
} from '../../gui/api.js';
import {
  getQueue,
  killQueueEntry,
  dismissQueueEntry,
  startOrchestrator,
} from '../../gui/orchestrator-manager.js';

const mockGetQueue        = vi.mocked(getQueue);
const mockKillQueueEntry  = vi.mocked(killQueueEntry);
const mockDismiss         = vi.mocked(dismissQueueEntry);
const mockStartOrchestrator = vi.mocked(startOrchestrator);

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// handleOrchestratorStart — AC-1, AC-2, AC-6
// ---------------------------------------------------------------------------

describe('handleOrchestratorStart', () => {
  const WORKSPACE = '/workspace';

  it('AC-1: throws VALIDATION_ERROR when body.planPath is missing', async () => {
    await expect(
      handleOrchestratorStart(WORKSPACE, {})
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(mockStartOrchestrator).not.toHaveBeenCalled();
  });

  it('AC-1: throws VALIDATION_ERROR when body.planPath is a number', async () => {
    await expect(
      handleOrchestratorStart(WORKSPACE, { planPath: 42 })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('AC-1: throws VALIDATION_ERROR when body.planPath is null', async () => {
    await expect(
      handleOrchestratorStart(WORKSPACE, { planPath: null })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('AC-1/AC-6: throws VALIDATION_ERROR when body is null (not an object)', async () => {
    await expect(
      handleOrchestratorStart(WORKSPACE, null)
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('AC-1/AC-6: throws ApiError instance on missing planPath', async () => {
    const err = await handleOrchestratorStart(WORKSPACE, {}).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
  });

  it('AC-2: forwards dryRun: true to startOrchestrator', async () => {
    const mockResult = { checks: [], started: false };
    mockStartOrchestrator.mockResolvedValueOnce(mockResult);

    const result = await handleOrchestratorStart(WORKSPACE, {
      planPath: '/workspace/docs/agents/plans/2026-05-05-feat/plan.md',
      dryRun: true,
    });

    expect(mockStartOrchestrator).toHaveBeenCalledWith(
      '/workspace/docs/agents/plans/2026-05-05-feat/plan.md',
      WORKSPACE,
      true,
    );
    expect(result).toBe(mockResult);
  });

  it('AC-2: defaults dryRun to false when not provided', async () => {
    const mockResult = { checks: [], started: true, pid: 1234 };
    mockStartOrchestrator.mockResolvedValueOnce(mockResult);

    await handleOrchestratorStart(WORKSPACE, {
      planPath: '/workspace/docs/agents/plans/2026-05-05-feat/plan.md',
    });

    expect(mockStartOrchestrator).toHaveBeenCalledWith(
      '/workspace/docs/agents/plans/2026-05-05-feat/plan.md',
      WORKSPACE,
      false,
    );
  });

  it('AC-2: forwards dryRun: false explicitly', async () => {
    const mockResult = { checks: [], started: true, pid: 5678 };
    mockStartOrchestrator.mockResolvedValueOnce(mockResult);

    await handleOrchestratorStart(WORKSPACE, {
      planPath: '/workspace/docs/agents/plans/2026-05-05-feat/plan.md',
      dryRun: false,
    });

    expect(mockStartOrchestrator).toHaveBeenCalledWith(
      '/workspace/docs/agents/plans/2026-05-05-feat/plan.md',
      WORKSPACE,
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// handleGetOrchestratorQueue — AC-3
// ---------------------------------------------------------------------------

describe('handleGetOrchestratorQueue', () => {
  it('AC-3: returns enriched entries from getQueue()', async () => {
    const entries = [
      {
        id: 'entry-1',
        pid: 123,
        planPath: '/plan.md',
        expectedSlug: '2026-05-05-feat',
        startedAt: '2026-05-05T10:00:00Z',
        status: 'pending' as const,
        effectiveStatus: 'pending' as const,
        progress: 'Run started',
      },
    ];
    mockGetQueue.mockResolvedValueOnce(entries);

    const result = await handleGetOrchestratorQueue('/logs', '/ledger');

    expect(mockGetQueue).toHaveBeenCalledWith({ logsDir: '/logs', ledgerRoot: '/ledger' });
    expect(result).toBe(entries);
  });

  it('AC-3: returns empty array when queue is empty', async () => {
    mockGetQueue.mockResolvedValueOnce([]);

    const result = await handleGetOrchestratorQueue('/logs', '/ledger');

    expect(result).toEqual([]);
  });

  it('AC-3: passes logsDir and ledgerRoot to getQueue', async () => {
    mockGetQueue.mockResolvedValueOnce([]);

    await handleGetOrchestratorQueue('/custom/logs', '/custom/ledger');

    expect(mockGetQueue).toHaveBeenCalledWith({
      logsDir: '/custom/logs',
      ledgerRoot: '/custom/ledger',
    });
  });
});

// ---------------------------------------------------------------------------
// handleOrchestratorKill — AC-4, AC-6
// ---------------------------------------------------------------------------

describe('handleOrchestratorKill', () => {
  it('AC-4: returns { killed: true } when entry found and killed', async () => {
    mockKillQueueEntry.mockResolvedValueOnce({ killed: true });

    const result = await handleOrchestratorKill('entry-1', '/logs', '/ledger');

    expect(mockKillQueueEntry).toHaveBeenCalledWith({
      id: 'entry-1',
      logsDir: '/logs',
      ledgerRoot: '/ledger',
    });
    expect(result).toEqual({ killed: true });
  });

  it('AC-4: returns { killed: false } when entry not found or not pending', async () => {
    mockKillQueueEntry.mockResolvedValueOnce({ killed: false });

    const result = await handleOrchestratorKill('unknown-id', '/logs', '/ledger');

    expect(result).toEqual({ killed: false });
  });

  it('AC-6: throws NOT_FOUND for ID containing a path separator', async () => {
    await expect(
      handleOrchestratorKill('bad/id', '/logs', '/ledger')
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(mockKillQueueEntry).not.toHaveBeenCalled();
  });

  it('AC-6: throws NOT_FOUND for path-traversal attempt in ID', async () => {
    await expect(
      handleOrchestratorKill('../escape', '/logs', '/ledger')
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('AC-6: throws NOT_FOUND for ID containing a backslash', async () => {
    await expect(
      handleOrchestratorKill('bad\\id', '/logs', '/ledger')
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(mockKillQueueEntry).not.toHaveBeenCalled();
  });

  it('AC-6: throws NOT_FOUND for empty ID', async () => {
    await expect(
      handleOrchestratorKill('', '/logs', '/ledger')
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('AC-6: thrown error is an ApiError instance', async () => {
    const err = await handleOrchestratorKill('bad/id', '/logs', '/ledger').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
  });
});

// ---------------------------------------------------------------------------
// handleOrchestratorDismiss — AC-5, AC-6
// ---------------------------------------------------------------------------

describe('handleOrchestratorDismiss', () => {
  it('AC-5: resolves (returns void) when dismissQueueEntry succeeds', async () => {
    mockDismiss.mockResolvedValueOnce(undefined);

    await expect(
      handleOrchestratorDismiss('entry-1', '/logs', '/ledger')
    ).resolves.toBeUndefined();

    expect(mockDismiss).toHaveBeenCalledWith({
      id: 'entry-1',
      logsDir: '/logs',
      ledgerRoot: '/ledger',
    });
  });

  it('AC-5: resolves even when entry is not found (graceful no-op)', async () => {
    mockDismiss.mockResolvedValueOnce(undefined);

    await expect(
      handleOrchestratorDismiss('nonexistent-id', '/logs', '/ledger')
    ).resolves.toBeUndefined();
  });

  it('AC-6: throws NOT_FOUND for ID containing a path separator', async () => {
    await expect(
      handleOrchestratorDismiss('bad/id', '/logs', '/ledger')
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(mockDismiss).not.toHaveBeenCalled();
  });

  it('AC-6: throws NOT_FOUND for empty ID', async () => {
    await expect(
      handleOrchestratorDismiss('', '/logs', '/ledger')
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('AC-6: throws NOT_FOUND for path-traversal attempt in ID', async () => {
    await expect(
      handleOrchestratorDismiss('../escape', '/logs', '/ledger')
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('AC-6: throws NOT_FOUND for ID containing a backslash', async () => {
    await expect(
      handleOrchestratorDismiss('bad\\id', '/logs', '/ledger')
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(mockDismiss).not.toHaveBeenCalled();
  });

  it('AC-6: thrown error is an ApiError instance', async () => {
    const err = await handleOrchestratorDismiss('bad/id', '/logs', '/ledger').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
  });
});

// ---------------------------------------------------------------------------
// assertSafeQueueId allowlist edge cases (WP-002 hardening)
// ---------------------------------------------------------------------------

describe('assertSafeQueueId allowlist edge cases', () => {
  it('rejects a bare dot as queue ID (kill)', async () => {
    await expect(
      handleOrchestratorKill('.', '/logs', '/ledger')
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects bare double-dot as queue ID (kill)', async () => {
    await expect(
      handleOrchestratorKill('..', '/logs', '/ledger')
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects a queue ID containing a space (kill)', async () => {
    await expect(
      handleOrchestratorKill('bad id', '/logs', '/ledger')
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects a queue ID containing @ (dismiss)', async () => {
    await expect(
      handleOrchestratorDismiss('bad@id', '/logs', '/ledger')
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects a bare dot as queue ID (dismiss)', async () => {
    await expect(
      handleOrchestratorDismiss('.', '/logs', '/ledger')
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects bare double-dot as queue ID (dismiss)', async () => {
    await expect(
      handleOrchestratorDismiss('..', '/logs', '/ledger')
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
