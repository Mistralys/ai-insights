import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { TOOL_MODULES, registerAllTools, type ToolModule } from '../../src/tools/registry.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Paths relative to this test file (tests/startup/ → two levels up → mcp-server/)
const srcDir = join(__dirname, '..', '..', 'src');
const toolsDir = join(srcDir, 'tools');
const indexPath = join(srcDir, 'index.ts');

/**
 * Data-only modules — export no register() function and contain no
 * server.registerTool() calls. Excluded from the source scan.
 */
const EXCLUDED_TOOL_FILES = new Set(['help-content.ts', 'registry.ts']);

/**
 * Scans every file in src/tools/ for `server.registerTool('name', ...)`
 * calls and returns the full set of tool names actually registered by the
 * source — independent of TOOL_MODULES, so it can be used to detect a
 * module left out of the registry.
 */
function scanRegisteredToolNamesFromSource(): Set<string> {
  const toolFiles = readdirSync(toolsDir).filter(
    (f) => f.endsWith('.ts') && !EXCLUDED_TOOL_FILES.has(f)
  );

  const registeredTools = new Set<string>();
  for (const file of toolFiles) {
    const source = readFileSync(join(toolsDir, file), 'utf8');
    const toolPattern = /server\.registerTool\(\s*'([^']+)'/g;
    let match: RegExpExecArray | null;
    while ((match = toolPattern.exec(source)) !== null) {
      registeredTools.add(match[1]);
    }
  }
  return registeredTools;
}

/** Builds a no-op mock McpServer suitable for driving registerAllTools(). */
function createMockServer(): McpServer {
  return {
    registerTool: () => undefined,
  } as unknown as McpServer;
}

describe('Startup tool log sync — registry vs. source scan', () => {
  it('registry (TOOL_MODULES) matches the real tool set exactly', () => {
    const registeredViaRegistry = new Set(registerAllTools(createMockServer()));
    const registeredFromSource = scanRegisteredToolNamesFromSource();

    const missingFromRegistry = [...registeredFromSource]
      .filter((t) => !registeredViaRegistry.has(t))
      .sort();
    const extraInRegistry = [...registeredViaRegistry]
      .filter((t) => !registeredFromSource.has(t))
      .sort();

    expect(
      missingFromRegistry,
      `Tools registered in src/tools/ but MISSING from TOOL_MODULES:\n  ${missingFromRegistry.join('\n  ')}`
    ).toEqual([]);

    expect(
      extraInRegistry,
      `Tools reported by TOOL_MODULES but NOT found in src/tools/:\n  ${extraInRegistry.join('\n  ')}`
    ).toEqual([]);
  });

  it('fails (reports a missing tool) when a module is left out of TOOL_MODULES', () => {
    // Synthetic case: drop the 'ping' module from the list passed in, as if
    // someone forgot to add it to TOOL_MODULES after creating ping.ts.
    const modulesWithoutPing: ToolModule[] = TOOL_MODULES.filter((m) => m.id !== 'ping');

    const registeredViaRegistry = new Set(registerAllTools(createMockServer(), modulesWithoutPing));
    const registeredFromSource = scanRegisteredToolNamesFromSource();

    const missingFromRegistry = [...registeredFromSource]
      .filter((t) => !registeredViaRegistry.has(t))
      .sort();

    expect(missingFromRegistry).toEqual(['ledger_ping']);
  });

  it('fails (throws) when a returned tool name repeats', () => {
    const duplicateModules: ToolModule[] = [
      {
        id: 'module-a',
        register: (s) => {
          (s as unknown as { registerTool: (...a: unknown[]) => unknown }).registerTool(
            'ledger_duplicate',
            {},
            () => undefined
          );
        },
      },
      {
        id: 'module-b',
        register: (s) => {
          (s as unknown as { registerTool: (...a: unknown[]) => unknown }).registerTool(
            'ledger_duplicate',
            {},
            () => undefined
          );
        },
      },
    ];

    expect(() => registerAllTools(createMockServer(), duplicateModules)).toThrow(
      'Duplicate tool registration: ledger_duplicate'
    );
  });
});

describe('Startup tool log sync — index.ts wiring', () => {
  it('registers tools only through registerAllTools(, with no hand-maintained "Registered tools: ledger_" literal', () => {
    const indexSource = readFileSync(indexPath, 'utf8');

    expect(
      indexSource.includes('registerAllTools('),
      'src/index.ts must call registerAllTools( to register tools'
    ).toBe(true);

    expect(
      indexSource.includes('Registered tools: ledger_'),
      'src/index.ts must not contain a hand-maintained "Registered tools: ledger_" literal — ' +
        'the startup log must be derived from registerAllTools()\'s return value'
    ).toBe(false);
  });
});
