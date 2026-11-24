import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { TOOL_MODULES, registerAllTools, type ToolModule } from '../../src/tools/registry.js';

// Paths relative to this test file (tests/tools/ → two levels up → mcp-server/)
const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');
const toolsDir = join(srcDir, 'tools');
const indexPath = join(srcDir, 'index.ts');

/**
 * Files under src/tools/ that are not tool modules — no register() export,
 * no server.registerTool() call. Excluded from the source scan.
 */
const EXCLUDED_TOOL_FILES = new Set(['help-content.ts', 'registry.ts']);

/**
 * Scans every tool file for `server.registerTool('name', ...)` calls —
 * independent of TOOL_MODULES, so it detects a module left out of the registry.
 */
function scanRegisteredToolNamesFromSource(): Set<string> {
  const names = new Set<string>();
  const files = readdirSync(toolsDir).filter((f) => f.endsWith('.ts') && !EXCLUDED_TOOL_FILES.has(f));
  for (const file of files) {
    const source = readFileSync(join(toolsDir, file), 'utf8');
    for (const match of source.matchAll(/server\.registerTool\(\s*'([^']+)'/g)) {
      names.add(match[1]);
    }
  }
  return names;
}

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

describe('registry — completeness against the source tree', () => {
  it('TOOL_MODULES registers exactly the tools found via server.registerTool( under src/tools/*.ts', () => {
    const { server } = createMockServer();
    const registered = new Set(registerAllTools(server));
    const fromSource = scanRegisteredToolNamesFromSource();

    const missing = [...fromSource].filter((t) => !registered.has(t)).sort();
    const extra = [...registered].filter((t) => !fromSource.has(t)).sort();

    expect(
      missing,
      `Tools in src/tools/ but MISSING from TOOL_MODULES (add the module to src/tools/registry.ts):\n  ${missing.join('\n  ')}`
    ).toEqual([]);
    expect(extra, `Tools registered by TOOL_MODULES but NOT found in src/tools/:\n  ${extra.join('\n  ')}`).toEqual([]);
  });

  it('detects a module left out of TOOL_MODULES (synthetic: ping dropped)', () => {
    const { server } = createMockServer();
    const withoutPing = TOOL_MODULES.filter((m) => m.id !== 'ping');
    const registered = new Set(registerAllTools(server, withoutPing));

    const missing = [...scanRegisteredToolNamesFromSource()].filter((t) => !registered.has(t));
    expect(missing).toEqual(['ledger_ping']);
  });

  it('leaves the server\'s own registerTool untouched', () => {
    const original = function registerToolStub(): void {
      /* noop */
    };
    const server = { registerTool: original } as unknown as McpServer;

    registerAllTools(server);

    expect(server.registerTool).toBe(original);
  });
});

describe('registry — index.ts wiring', () => {
  it('registers tools only through registerAllTools(, with no hand-maintained "Registered tools: ledger_" literal', () => {
    const indexSource = readFileSync(indexPath, 'utf8');

    expect(indexSource.includes('registerAllTools('), 'src/index.ts must call registerAllTools(').toBe(true);
    expect(
      indexSource.includes('Registered tools: ledger_'),
      "src/index.ts must derive the startup log from registerAllTools()'s return value, not a literal"
    ).toBe(false);
  });
});
