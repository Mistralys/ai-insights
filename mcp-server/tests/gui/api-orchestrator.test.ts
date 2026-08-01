/**
 * Tests for orchestrator API route handlers in gui/api.ts — WP-008 + WP-012
 *
 * All acceptance criteria tested:
 *   WP-008 AC-1: handleOrchestratorStart validates body.planPath is present and a string.
 *   WP-008 AC-2: handleOrchestratorStart forwards dryRun flag correctly.
 *   WP-008 AC-3: handleGetOrchestratorQueue returns an array of enriched entries.
 *   WP-008 AC-4: handleOrchestratorKill returns { killed: boolean }.
 *   WP-008 AC-5: handleOrchestratorDismiss returns 204 on success (void from handler).
 *   WP-008 AC-6: All handlers follow the existing error handling patterns in api.ts.
 *   WP-012 AC-3: In multi-store mode, the orchestrator preflight rejects repos not
 *                registered in any store with a clear error before running other checks.
 *   WP-012 AC-4: In single-store mode, the orchestrator preflight does not check
 *                registration (registration is optional).
 *
 * Uses vi.mock() to stub orchestrator-manager and store-context — the managers'
 * own behaviour is covered by their respective unit tests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the orchestrator-manager module before importing the handlers.
vi.mock('../../gui/orchestrator-manager.js', () => ({
  getQueue: vi.fn(),
  killQueueEntry: vi.fn(),
  dismissQueueEntry: vi.fn(),
  startOrchestrator: vi.fn(),
}));

// Mock store-context; default: single-store mode (context not initialized).
vi.mock('../../src/storage/store-context.js', () => ({
  isStoreContextInitialized: vi.fn<[], boolean>().mockReturnValue(false),
  getStoreRouter: vi.fn(),
  getMultiStoreManager: vi.fn(),
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
import {
  isStoreContextInitialized,
  getStoreRouter,
} from '../../src/storage/store-context.js';

const mockGetQueue          = vi.mocked(getQueue);
const mockKillQueueEntry    = vi.mocked(killQueueEntry);
const mockDismiss           = vi.mocked(dismissQueueEntry);
const mockStartOrchestrator = vi.mocked(startOrchestrator);
const mockIsStoreCtxInit    = vi.mocked(isStoreContextInitialized);
const mockGetStoreRouter    = vi.mocked(getStoreRouter);

beforeEach(() => {
  vi.clearAllMocks();
  // Restore default single-store mode after each test so existing tests are unaffected.
  mockIsStoreCtxInit.mockReturnValue(false);
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
      undefined,
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
      undefined,
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
      undefined,
    );
  });
});

// ---------------------------------------------------------------------------
// handleOrchestratorStart — WP-003: resumeThreadId forwarding (AC-3, AC-4)
// ---------------------------------------------------------------------------

describe('handleOrchestratorStart — resumeThreadId (WP-003 AC-3, AC-4)', () => {
  const WORKSPACE = '/workspace';
  const PLAN_PATH = '/workspace/docs/agents/plans/2026-05-05-feat/plan.md';
  const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';

  it('AC-3: rejects resumeThreadId that is not a UUID v4 string (v1 format)', async () => {
    await expect(
      handleOrchestratorStart(WORKSPACE, {
        planPath: PLAN_PATH,
        resumeThreadId: 'not-a-uuid',
      })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(mockStartOrchestrator).not.toHaveBeenCalled();
  });

  it('AC-3: rejects resumeThreadId that is a v1-format UUID (wrong version digit)', async () => {
    // UUID v1: version digit is 1, not 4
    await expect(
      handleOrchestratorStart(WORKSPACE, {
        planPath: PLAN_PATH,
        resumeThreadId: '550e8400-e29b-11d4-a716-446655440000',
      })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('AC-3: rejects resumeThreadId that is an empty string', async () => {
    await expect(
      handleOrchestratorStart(WORKSPACE, {
        planPath: PLAN_PATH,
        resumeThreadId: '',
      })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('AC-3: rejects resumeThreadId that is a number', async () => {
    await expect(
      handleOrchestratorStart(WORKSPACE, {
        planPath: PLAN_PATH,
        resumeThreadId: 12345,
      })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('AC-3: rejected resumeThreadId error is an ApiError with VALIDATION_ERROR code', async () => {
    const err = await handleOrchestratorStart(WORKSPACE, {
      planPath: PLAN_PATH,
      resumeThreadId: 'bad-uuid',
    }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe('VALIDATION_ERROR');
  });

  it('AC-4: forwards a valid UUID v4 resumeThreadId to startOrchestrator unchanged', async () => {
    const mockResult = { checks: [], started: true, pid: 42 };
    mockStartOrchestrator.mockResolvedValueOnce(mockResult);

    await handleOrchestratorStart(WORKSPACE, {
      planPath: PLAN_PATH,
      resumeThreadId: VALID_UUID,
    });

    expect(mockStartOrchestrator).toHaveBeenCalledWith(
      PLAN_PATH,
      WORKSPACE,
      false,
      VALID_UUID,
    );
  });

  it('AC-4: UUID v4 with uppercase hex digits is accepted', async () => {
    mockStartOrchestrator.mockResolvedValueOnce({ checks: [], started: true, pid: 1 });
    const upperUuid = VALID_UUID.toUpperCase();

    await handleOrchestratorStart(WORKSPACE, {
      planPath: PLAN_PATH,
      resumeThreadId: upperUuid,
    });

    expect(mockStartOrchestrator).toHaveBeenCalledWith(
      PLAN_PATH,
      WORKSPACE,
      false,
      upperUuid,
    );
  });

  it('AC-4: valid resumeThreadId is forwarded alongside dryRun: true', async () => {
    mockStartOrchestrator.mockResolvedValueOnce({ checks: [], started: false });

    await handleOrchestratorStart(WORKSPACE, {
      planPath: PLAN_PATH,
      dryRun: true,
      resumeThreadId: VALID_UUID,
    });

    expect(mockStartOrchestrator).toHaveBeenCalledWith(
      PLAN_PATH,
      WORKSPACE,
      true,
      VALID_UUID,
    );
  });

  it('AC-4 (AC-5 regression): omitting resumeThreadId still passes undefined as 4th arg', async () => {
    mockStartOrchestrator.mockResolvedValueOnce({ checks: [], started: true, pid: 7 });

    await handleOrchestratorStart(WORKSPACE, { planPath: PLAN_PATH });

    expect(mockStartOrchestrator).toHaveBeenCalledWith(
      PLAN_PATH,
      WORKSPACE,
      false,
      undefined,
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
    mockKillQueueEntry.mockResolvedValueOnce({ killed: false, reason: 'Queue entry not found.' });

    const result = await handleOrchestratorKill('unknown-id', '/logs', '/ledger');

    expect(result).toMatchObject({ killed: false });
    expect((result as { reason?: string }).reason).toBeTruthy();
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

// ---------------------------------------------------------------------------
// handleOrchestratorStart — multi-store registration preflight (WP-012 AC-3, AC-4)
// ---------------------------------------------------------------------------

describe('handleOrchestratorStart — multi-store preflight (WP-012 AC-3, AC-4)', () => {
  // PLAN_PATH must contain '/docs/agents/' so inferProjectRootFromPlanPath() returns
  // a non-null root. The folder name extracted from '/workspace' is 'workspace'.
  const WORKSPACE  = '/workspace';
  const PLAN_PATH  = '/workspace/docs/agents/plans/2026-05-05-feat/plan.md';
  const REPO_FOLDER = 'workspace'; // basename of the inferred project root

  it('AC-3: returns store-registration fail when repo is not registered in multi-store mode', async () => {
    mockIsStoreCtxInit.mockReturnValue(true);
    mockGetStoreRouter.mockReturnValue({
      isMultiStoreMode:    () => true,
      resolveStoreForRepo: vi.fn().mockResolvedValue(null),
    });

    const result = await handleOrchestratorStart(WORKSPACE, { planPath: PLAN_PATH });

    expect(result.started).toBe(false);
    expect(result.checks).toHaveLength(1);
    expect(result.checks[0]).toMatchObject({ name: 'store-registration', pass: false });
    expect(mockStartOrchestrator).not.toHaveBeenCalled();
  });

  it('AC-3: store-registration detail message names the unregistered repository folder', async () => {
    mockIsStoreCtxInit.mockReturnValue(true);
    mockGetStoreRouter.mockReturnValue({
      isMultiStoreMode:    () => true,
      resolveStoreForRepo: vi.fn().mockResolvedValue(null),
    });

    const result = await handleOrchestratorStart(WORKSPACE, { planPath: PLAN_PATH });

    expect(result.checks[0]!.detail).toContain(REPO_FOLDER);
  });

  it('AC-3: store-registration check includes a non-empty fix hint', async () => {
    mockIsStoreCtxInit.mockReturnValue(true);
    mockGetStoreRouter.mockReturnValue({
      isMultiStoreMode:    () => true,
      resolveStoreForRepo: vi.fn().mockResolvedValue(null),
    });

    const result = await handleOrchestratorStart(WORKSPACE, { planPath: PLAN_PATH });

    expect(result.checks[0]!.fix).toBeTruthy();
  });

  it('AC-3: registered repo in multi-store mode proceeds to startOrchestrator', async () => {
    mockIsStoreCtxInit.mockReturnValue(true);
    mockGetStoreRouter.mockReturnValue({
      isMultiStoreMode:    () => true,
      resolveStoreForRepo: vi.fn().mockResolvedValue({ storePath: '/store', storeId: 'main' }),
    });
    mockStartOrchestrator.mockResolvedValueOnce({ checks: [], started: true, pid: 42 });

    const result = await handleOrchestratorStart(WORKSPACE, { planPath: PLAN_PATH });

    expect(mockStartOrchestrator).toHaveBeenCalledOnce();
    expect(result.started).toBe(true);
  });

  it('AC-4: context not initialized → proceeds to startOrchestrator without registration check', async () => {
    // mockIsStoreCtxInit already returns false (restored in global beforeEach)
    mockStartOrchestrator.mockResolvedValueOnce({ checks: [], started: true, pid: 1 });

    await handleOrchestratorStart(WORKSPACE, { planPath: PLAN_PATH });

    expect(mockStartOrchestrator).toHaveBeenCalledOnce();
    expect(mockGetStoreRouter).not.toHaveBeenCalled();
  });

  it('AC-4: isMultiStoreMode()=false → proceeds to startOrchestrator without registration check', async () => {
    const mockResolve = vi.fn();
    mockIsStoreCtxInit.mockReturnValue(true);
    mockGetStoreRouter.mockReturnValue({
      isMultiStoreMode:    () => false,
      resolveStoreForRepo: mockResolve,
    });
    mockStartOrchestrator.mockResolvedValueOnce({ checks: [], started: true, pid: 2 });

    await handleOrchestratorStart(WORKSPACE, { planPath: PLAN_PATH });

    expect(mockStartOrchestrator).toHaveBeenCalledOnce();
    expect(mockResolve).not.toHaveBeenCalled();
  });

  // WP-005: codifies behavior when inferProjectRootFromPlanPath() returns null
  it('WP-005: inferProjectRootFromPlanPath()=null (path without /docs/agents/) → skips registration check and proceeds', async () => {
    // A plan path that contains no '/docs/agents/' segment — inferProjectRootFromPlanPath returns null.
    const pathWithoutDocsAgents = '/some/path/plan.md';
    const mockResolve = vi.fn();
    mockIsStoreCtxInit.mockReturnValue(true);
    mockGetStoreRouter.mockReturnValue({
      isMultiStoreMode:    () => true,
      resolveStoreForRepo: mockResolve,
    });
    mockStartOrchestrator.mockResolvedValueOnce({ checks: [], started: true, pid: 99 });

    const result = await handleOrchestratorStart(WORKSPACE, { planPath: pathWithoutDocsAgents });

    // Registration check must be skipped — folderName is null when project root cannot be inferred
    expect(mockResolve).not.toHaveBeenCalled();
    // startOrchestrator must still be called (function proceeds normally)
    expect(mockStartOrchestrator).toHaveBeenCalledOnce();
    expect(result.started).toBe(true);
  });
});
