import { describe, it, expect, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { TOOL_MODULES, registerAllTools, type ToolModule } from '../../src/tools/registry.js';

/** Builds a mock McpServer that records every registerTool() call. */
function createMockServer(): { server: McpServer; calls: unknown[][] } {
  const calls: unknown[][] = [];
  const server = {
    registerTool: vi.fn((...args: unknown[]) => {
      calls.push(args);
      return 'registerTool-result';
    }),
  } as unknown as McpServer;
  return { server, calls };
}

describe('registry — TOOL_MODULES invariants', () => {
  it('is frozen', () => {
    expect(Object.isFrozen(TOOL_MODULES)).toBe(true);
  });

  it('registers a module for every tool group, including error-codes and work-package-admin', () => {
    const ids = TOOL_MODULES.map((m) => m.id);
    expect(ids).toContain('error-codes');
    expect(ids).toContain('work-package-admin');
  });

  it('has unique ids', () => {
    const ids = TOOL_MODULES.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('registerAllTools — forwarding', () => {
  it('forwards every call to the real registerTool with the original arguments, and returns its result', () => {
    const { server, calls } = createMockServer();

    const config = { description: 'desc', inputSchema: {} };
    const handler = () => undefined;

    const modules: ToolModule[] = [
      {
        id: 'fake-module',
        register: (s) => {
          const result = (s as unknown as { registerTool: (...a: unknown[]) => unknown }).registerTool(
            'ledger_fake_tool',
            config,
            handler
          );
          expect(result).toBe('registerTool-result');
        },
      },
    ];

    registerAllTools(server, modules);

    expect(calls).toEqual([['ledger_fake_tool', config, handler]]);
  });
});

describe('registerAllTools — ordering', () => {
  it('returns registered tool names in registration order', () => {
    const { server } = createMockServer();

    const modules: ToolModule[] = [
      {
        id: 'module-a',
        register: (s) => {
          (s as unknown as { registerTool: (...a: unknown[]) => unknown }).registerTool('tool_a1', {}, () => undefined);
          (s as unknown as { registerTool: (...a: unknown[]) => unknown }).registerTool('tool_a2', {}, () => undefined);
        },
      },
      {
        id: 'module-b',
        register: (s) => {
          (s as unknown as { registerTool: (...a: unknown[]) => unknown }).registerTool('tool_b1', {}, () => undefined);
        },
      },
    ];

    const names = registerAllTools(server, modules);

    expect(names).toEqual(['tool_a1', 'tool_a2', 'tool_b1']);
  });
});

describe('registerAllTools — duplicate detection', () => {
  it('throws "Duplicate tool registration: <name>" when a name repeats', () => {
    const { server } = createMockServer();

    const modules: ToolModule[] = [
      {
        id: 'module-a',
        register: (s) => {
          (s as unknown as { registerTool: (...a: unknown[]) => unknown }).registerTool('tool_dup', {}, () => undefined);
        },
      },
      {
        id: 'module-b',
        register: (s) => {
          (s as unknown as { registerTool: (...a: unknown[]) => unknown }).registerTool('tool_dup', {}, () => undefined);
        },
      },
    ];

    expect(() => registerAllTools(server, modules)).toThrow(
      'Duplicate tool registration: tool_dup'
    );
  });
});

describe('registerAllTools — real TOOL_MODULES', () => {
  it('registers every real tool module without error and returns a non-empty, duplicate-free name list', () => {
    const { server } = createMockServer();

    const names = registerAllTools(server);

    expect(names.length).toBeGreaterThan(0);
    expect(new Set(names).size).toBe(names.length);
  });
});
