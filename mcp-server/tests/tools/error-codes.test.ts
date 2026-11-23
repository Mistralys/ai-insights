/**
 * Tests for ledger_generate_error_code and ledger_list_temporary_error_codes.
 *
 * Verifies that:
 * - ledger_generate_error_code returns a well-formed ErrorCodeResult for
 *   both the final-code and temporary-code paths, passing cwd_path through
 *   to repository resolution.
 * - ledger_list_temporary_error_codes returns the logged entries, honoring
 *   filter.
 * - An MCP error (isError: true) is returned only when the temporary-code
 *   store itself fails — never for a provider failure, which falls back
 *   instead.
 * - No sentinel secret appears in any response.
 * - Both tools are registered (TOOL_MODULES / help coverage is coverved by
 *   tests/tools/tool-registry.test.ts).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ErrorCodeConfig } from '../../src/error-codes/config-store.js';
import type { ErrorCodeProvider, AllocationOutcome, ProviderContext, AllocationRequest } from '../../src/error-codes/provider-api.js';
import type { TemporaryCodeEntry, TemporaryCodeEntryInput } from '../../src/error-codes/temporary-codes.js';

// ---------------------------------------------------------------------------
// Mocks — established before the module under test is imported.
// ---------------------------------------------------------------------------

let mockConfig: ErrorCodeConfig;
let mockProvider: ErrorCodeProvider | undefined;
let mockRepository: Awaited<ReturnType<typeof import('../../src/error-codes/project-info.js').resolveRepositoryInfo>> = null;
let mockResolveRepositoryInfo = vi.fn(async () => mockRepository);
let mockIssueTemporaryCode = vi.fn(async (_dir: string, prefix: string, _entry: TemporaryCodeEntryInput): Promise<{ code: string; warning?: string }> => ({ code: `${prefix}000001` }));
let mockListTemporaryCodes = vi.fn(async (_dir: string, _filter?: string): Promise<{ entries: TemporaryCodeEntry[]; warning?: string }> => ({ entries: [] }));

function makeConfig(overrides: Partial<ErrorCodeConfig> = {}): ErrorCodeConfig {
  return {
    version: 1,
    active_provider: 'file',
    temporary_prefix: '777',
    timeout_ms: 10000,
    retry: { default_wait_ms: 11000, max_wait_ms: 30000 },
    providers: {},
    ...overrides,
  };
}

function makeProvider(
  allocate: (request: AllocationRequest, ctx: ProviderContext) => Promise<AllocationOutcome>,
  overrides: Partial<ErrorCodeProvider> = {}
): ErrorCodeProvider {
  return {
    apiVersion: 1,
    id: 'file',
    label: 'Test Provider',
    settings: [],
    allocate,
    ...overrides,
  };
}

vi.mock('../../src/error-codes/config-store.js', () => ({
  loadErrorCodeConfig: vi.fn(async () => mockConfig),
}));

vi.mock('../../src/error-codes/provider-registry.js', () => ({
  getProvider: vi.fn((id: string) => (mockProvider?.id === id ? mockProvider : undefined)),
}));

vi.mock('../../src/error-codes/project-info.js', () => ({
  resolveRepositoryInfo: (cwdPath: string) => mockResolveRepositoryInfo(cwdPath),
}));

vi.mock('../../src/error-codes/temporary-codes.js', () => ({
  issueTemporaryCode: (dir: string, prefix: string, entry: TemporaryCodeEntryInput) =>
    mockIssueTemporaryCode(dir, prefix, entry),
  listTemporaryCodes: (dir: string, filter?: string) => mockListTemporaryCodes(dir, filter),
}));

vi.mock('../../src/storage/store-registry.js', () => ({
  resolveErrorCodesDir: vi.fn(() => '/fake/.ai-insights/error-codes'),
  resolveErrorCodeProviderDataDir: vi.fn(
    (providerId: string) => `/fake/.ai-insights/error-codes/data/${providerId}`
  ),
}));

// Import AFTER the mocks are established.
const { _internal, register } = await import('../../src/tools/error-codes.js');
const { generateErrorCode, listTemporaryErrorCodes } = _internal;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseResult(result: { content: { type: string; text: string }[]; isError?: boolean }): Record<string, unknown> {
  return JSON.parse(result.content[0]!.text) as Record<string, unknown>;
}

beforeEach(() => {
  mockConfig = makeConfig();
  mockProvider = undefined;
  mockRepository = null;
  mockResolveRepositoryInfo = vi.fn(async () => mockRepository);
  mockIssueTemporaryCode = vi.fn(async (_dir: string, prefix: string) => ({ code: `${prefix}000001` }));
  mockListTemporaryCodes = vi.fn(async () => ({ entries: [] }));
  vi.clearAllMocks();
});

describe('ledger_generate_error_code', () => {
  it('returns a well-formed ErrorCodeResult for the final-code path', async () => {
    mockConfig = makeConfig();
    mockProvider = makeProvider(async () => ({ ok: true, value: 42 }));

    const result = await generateErrorCode({});
    const parsed = parseResult(result);

    expect(result.isError).toBeUndefined();
    expect(parsed.code).toBe('42');
    expect(parsed.temporary).toBe(false);
    expect(parsed.provider).toBe('file');
    expect(parsed.first_component_code).toBe('4201');
    expect(parsed.fallback_reason).toBeUndefined();
  });

  it('returns a well-formed ErrorCodeResult for the temporary-code path (requested)', async () => {
    const result = await generateErrorCode({ temporary: true });
    const parsed = parseResult(result);

    expect(result.isError).toBeUndefined();
    expect(parsed.temporary).toBe(true);
    expect(parsed.fallback_reason).toBe('requested');
    expect(parsed.code).toBe('777000001');
    expect(parsed.first_component_code).toBe('77700000101');
  });

  it('falls back to a temporary code on a provider failure, without raising an MCP error', async () => {
    mockConfig = makeConfig();
    mockProvider = makeProvider(async () => ({ ok: false, reason: 'unavailable', ambiguous: true, detail: 'network down' }));

    const result = await generateErrorCode({});
    const parsed = parseResult(result);

    expect(result.isError).toBeUndefined();
    expect(parsed.temporary).toBe(true);
    expect(parsed.fallback_reason).toBe('unavailable');
    expect(parsed.provider).toBe('file');
  });

  it('falls back to misconfigured when the active provider is not installed', async () => {
    mockConfig = makeConfig({ active_provider: 'does-not-exist' });
    mockProvider = undefined;

    const result = await generateErrorCode({});
    const parsed = parseResult(result);

    expect(result.isError).toBeUndefined();
    expect(parsed.temporary).toBe(true);
    expect(parsed.fallback_reason).toBe('misconfigured');
    expect(parsed.provider).toBe('does-not-exist');
  });

  it('passes cwd_path through to repository resolution', async () => {
    mockConfig = makeConfig();
    mockProvider = makeProvider(async () => ({ ok: true, value: 1 }));
    mockRepository = { root_path: '/repo', folder_name: 'repo', package_name: 'my-pkg' };
    mockResolveRepositoryInfo = vi.fn(async () => mockRepository);

    const result = await generateErrorCode({ cwd_path: '/repo/sub', context: 'MyClass' });
    const parsed = parseResult(result);

    expect(mockResolveRepositoryInfo).toHaveBeenCalledWith('/repo/sub');
    expect(parsed.repository).toEqual({ root_path: '/repo', folder_name: 'repo', package_name: 'my-pkg' });
  });

  it('passes the temporary-code store warning through in the result', async () => {
    mockIssueTemporaryCode = vi.fn(async (_dir: string, prefix: string) => ({ code: `${prefix}000042`, warning: 'temporary-codes.json was corrupt' }));

    const result = await generateErrorCode({ temporary: true });
    const parsed = parseResult(result) as { code: string; warning?: string };

    expect(parsed.code).toBe('777000042');
    expect(parsed.warning).toBe('temporary-codes.json was corrupt');
  });

  it('returns an MCP error only when the temporary-code store itself fails', async () => {
    mockIssueTemporaryCode = vi.fn(async () => {
      throw new Error('temporary-codes: counter exhausted — cannot issue a value beyond 999999');
    });

    const result = await generateErrorCode({ temporary: true });

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('counter exhausted');
  });

  it('never leaks a configured secret in the response', async () => {
    mockConfig = makeConfig({ providers: { file: { api_key: 'super-secret-value' } } });
    mockProvider = makeProvider(
      async () => ({ ok: false, reason: 'failed', ambiguous: true, detail: 'request to https://x used key super-secret-value' }),
      {
        settings: [{ key: 'api_key', label: 'API Key', type: 'secret' }],
      }
    );

    const result = await generateErrorCode({});
    expect(result.content[0]!.text).not.toContain('super-secret-value');
  });
});

describe('ledger_list_temporary_error_codes', () => {
  it('includes the listing warning when there is one, and omits it otherwise', async () => {
    mockListTemporaryCodes = vi.fn(async () => ({ entries: [], warning: 'temporary-codes.json is corrupt' }));
    const withWarning = parseResult(await listTemporaryErrorCodes({})) as { entries: unknown[]; warning?: string };
    expect(withWarning.warning).toBe('temporary-codes.json is corrupt');

    mockListTemporaryCodes = vi.fn(async () => ({ entries: [] }));
    const without = parseResult(await listTemporaryErrorCodes({})) as Record<string, unknown>;
    expect('warning' in without).toBe(false);
  });

  it('returns the logged entries', async () => {
    const entries: TemporaryCodeEntry[] = [
      {
        code: '777000001',
        issued_at: '2026-11-19T10:00:00.000Z',
        provider: 'file',
        fallback_reason: 'misconfigured',
        detail: null,
        repository: null,
        context: 'ErrorCodeService',
      },
    ];
    mockListTemporaryCodes = vi.fn(async () => ({ entries }));

    const result = await listTemporaryErrorCodes({});
    const parsed = parseResult(result) as { entries: TemporaryCodeEntry[] };

    expect(result.isError).toBeUndefined();
    expect(parsed.entries).toEqual(entries);
  });

  it('honors the filter param', async () => {
    mockListTemporaryCodes = vi.fn(async () => ({ entries: [] }));

    await listTemporaryErrorCodes({ filter: 'ErrorCodeService' });

    expect(mockListTemporaryCodes).toHaveBeenCalledWith('/fake/.ai-insights/error-codes', 'ErrorCodeService');
  });

  it('returns an MCP error when the underlying store read fails', async () => {
    mockListTemporaryCodes = vi.fn(async () => {
      throw new Error('disk read failed');
    });

    const result = await listTemporaryErrorCodes({});

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('disk read failed');
  });
});

describe('register', () => {
  it('registers both ledger_generate_error_code and ledger_list_temporary_error_codes', () => {
    const names: string[] = [];
    const server = {
      registerTool: (name: string) => {
        names.push(name);
      },
    } as unknown as import('@modelcontextprotocol/sdk/server/mcp.js').McpServer;

    register(server);

    expect(names).toContain('ledger_generate_error_code');
    expect(names).toContain('ledger_list_temporary_error_codes');
  });
});
