/**
 * Tool Registry Completeness Test
 *
 * Replaces tests/startup/tool-log-sync.test.ts, which existed only to
 * police a hand-written startup log literal in src/index.ts. The log is
 * now derived from registerAllTools()'s return value (src/index.ts), so
 * that specific drift can no longer happen — what remains to police is
 * TOOL_MODULES (src/tools/registry.ts) itself: every tool actually defined
 * in src/tools/*.ts must end up registered, every registered name must be
 * unique, and every registered name must have TOOL_HELP coverage.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { TOOL_MODULES, registerAllTools } from '../../src/tools/registry.js';
import { TOOL_HELP } from '../../src/tools/help-content.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Paths relative to this test file (tests/tools/ → one level up → mcp-server/)
const srcDir = join(__dirname, '..', '..', 'src');
const toolsDir = join(srcDir, 'tools');

/**
 * Files under src/tools/ that are not tool modules — no register() export,
 * no server.registerTool() call. Excluded from the source scan below.
 */
const EXCLUDED_TOOL_FILES = new Set(['help-content.ts', 'registry.ts']);

/** Builds a minimal mock McpServer that records every registered tool name. */
function buildMockServer(): { server: McpServer; names: string[] } {
  const names: string[] = [];
  const server = {
    registerTool: (name: string) => {
      names.push(name);
    },
  } as unknown as McpServer;
  return { server, names };
}

describe('Tool registry completeness', () => {
  it('registerAllTools registers every server.registerTool( call found under src/tools/*.ts', () => {
    // ── 1. Collect every literal tool name from a direct source scan ───────
    const toolFiles = readdirSync(toolsDir).filter(
      (f) => f.endsWith('.ts') && !EXCLUDED_TOOL_FILES.has(f)
    );

    const namesFromSource = new Set<string>();
    for (const file of toolFiles) {
      const source = readFileSync(join(toolsDir, file), 'utf8');
      const toolPattern = /server\.registerTool\(\s*'([^']+)'/g;
      let match: RegExpExecArray | null;
      while ((match = toolPattern.exec(source)) !== null) {
        namesFromSource.add(match[1]);
      }
    }

    // ── 2. Collect every name TOOL_MODULES actually registers ──────────────
    const { server, names: namesFromRegistry } = buildMockServer();
    for (const mod of TOOL_MODULES) {
      mod.register(server);
    }

    // ── 3. Diff and assert ──────────────────────────────────────────────────
    const missingFromRegistry = [...namesFromSource]
      .filter((n) => !namesFromRegistry.includes(n))
      .sort();

    expect(
      missingFromRegistry,
      `Tool(s) found in src/tools/*.ts via server.registerTool( but NOT registered by TOOL_MODULES ` +
        `(add the owning module's register() to TOOL_MODULES in src/tools/registry.ts):\n  ${missingFromRegistry.join('\n  ')}`
    ).toEqual([]);
  });

  it('registerAllTools returns a duplicate-free set of tool names', () => {
    const { server, names } = buildMockServer();
    for (const mod of TOOL_MODULES) {
      mod.register(server);
    }
    expect(new Set(names).size).toBe(names.length);
  });

  it('registerAllTools (the real implementation) registers against a real-shaped server and returns the names', () => {
    // Exercises registerAllTools itself (not just TOOL_MODULES + a local
    // mock), so the monkey-patch-and-restore mechanism inside it is covered.
    let capturedName: string | undefined;
    const server = {
      registerTool: (name: string) => {
        capturedName = name;
      },
    } as unknown as McpServer;

    const names = registerAllTools(server);
    expect(names.length).toBeGreaterThan(0);
    expect(names).toContain(capturedName); // sanity: at least the last-seen call matches
    expect(new Set(names).size).toBe(names.length);
  });

  it('restores the original registerTool method after registerAllTools returns', () => {
    const original = function registerToolStub(): void {
      /* noop */
    };
    const server = { registerTool: original } as unknown as McpServer;

    registerAllTools(server);

    expect(server.registerTool).toBe(original);
  });

  it('every tool registered by TOOL_MODULES has a TOOL_HELP entry containing "# {name}"', () => {
    const { server, names } = buildMockServer();
    for (const mod of TOOL_MODULES) {
      mod.register(server);
    }

    const missingHelp: string[] = [];
    for (const name of names) {
      const entry = TOOL_HELP[name];
      if (entry === undefined || !entry.includes(`# ${name}`)) {
        missingHelp.push(name);
      }
    }

    expect(
      missingHelp,
      `Tool(s) registered but missing a TOOL_HELP entry containing "# {name}" (src/tools/help-content.ts):\n  ${missingHelp.join('\n  ')}`
    ).toEqual([]);
  });

  it('TOOL_MODULES entries have unique ids', () => {
    const ids = TOOL_MODULES.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
