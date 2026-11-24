/**
 * Registry-derived completeness suite for TOOL_HELP.
 *
 * The real tool registry (`TOOL_MODULES` / `registerAllTools` in
 * `src/tools/registry.ts`) is the single source of truth for which tool
 * names exist. This suite derives the registered tool-name list from that
 * registry at test time and cross-checks it against `TOOL_HELP` and the
 * overview table in `help-content.ts`, so a newly registered tool without
 * matching help content fails the build instead of waiting for a reviewer
 * to notice — which is exactly the gap that let four tools go undocumented
 * across several review cycles.
 *
 * Every registered tool is covered, `ledger_help` included.
 */
import { describe, it, expect, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAllTools, type ToolModule } from '../../src/tools/registry.js';
import { TOOL_HELP } from '../../src/tools/help-content.js';

/** Builds a mock McpServer that only needs to satisfy registerAllTools' recording shim. */
function createMockServer(): McpServer {
  return { registerTool: vi.fn(() => undefined) } as unknown as McpServer;
}

/**
 * Registered tool names that have no TOOL_HELP entry.
 */
function findMissingHelpEntries(registeredNames: string[], toolHelp: Record<string, string>): string[] {
  return registeredNames.filter((name) => !(name in toolHelp));
}

/**
 * Registered tool names with no row in the overview table.
 * A "row" is a `| <name> |` cell match against the raw overview markdown.
 */
function findMissingOverviewRows(registeredNames: string[], overviewText: string): string[] {
  return registeredNames.filter((name) => {
    const rowPattern = new RegExp(`\\|\\s*${name}\\s*\\|`);
    return !rowPattern.test(overviewText);
  });
}

/**
 * TOOL_HELP keys (other than 'overview') that name a tool not present in the
 * registered-tool list — a stale or typo'd entry that documents nothing real.
 */
function findOrphanedHelpKeys(registeredNames: string[], toolHelp: Record<string, string>): string[] {
  const registered = new Set(registeredNames);
  return Object.keys(toolHelp).filter((key) => key !== 'overview' && !registered.has(key));
}

describe('help-content-coverage — real registry cross-check', () => {
  const registeredNames = registerAllTools(createMockServer());
  const overviewText = TOOL_HELP['overview']!;

  it('every registered tool has a TOOL_HELP entry', () => {
    const missing = findMissingHelpEntries(registeredNames, TOOL_HELP);
    expect(missing, `Missing TOOL_HELP entries for: ${missing.join(', ')}`).toEqual([]);
  });

  it('every registered tool help entry contains its own "# {name}" heading', () => {
    const missing = registeredNames.filter((name) => !TOOL_HELP[name]?.includes(`# ${name}`));
    expect(missing, `TOOL_HELP entries lacking a "# {name}" heading: ${missing.join(', ')}`).toEqual([]);
  });

  it('every registered tool has an overview table row', () => {
    const missing = findMissingOverviewRows(registeredNames, overviewText);
    expect(missing, `Missing overview table rows for: ${missing.join(', ')}`).toEqual([]);
  });

  it('no TOOL_HELP key names a tool absent from the registry', () => {
    const orphaned = findOrphanedHelpKeys(registeredNames, TOOL_HELP);
    expect(orphaned, `TOOL_HELP keys with no matching registered tool: ${orphaned.join(', ')}`).toEqual([]);
  });
});

describe('help-content-coverage — synthetic fixtures prove the checks actually catch gaps', () => {
  function registerSynthetic(names: string[]): string[] {
    const modules: ToolModule[] = [
      {
        id: 'synthetic-module',
        register: (s) => {
          for (const name of names) {
            (s as unknown as { registerTool: (...a: unknown[]) => unknown }).registerTool(name, {}, () => undefined);
          }
        },
      },
    ];
    return registerAllTools(createMockServer(), modules);
  }

  it('fails (reports a miss) when a registered tool lacks a TOOL_HELP entry', () => {
    const names = registerSynthetic(['ledger_synthetic_tool']);
    const missing = findMissingHelpEntries(names, {});
    expect(missing).toEqual(['ledger_synthetic_tool']);
  });

  it('passes when the registered tool has a TOOL_HELP entry', () => {
    const names = registerSynthetic(['ledger_synthetic_tool']);
    const missing = findMissingHelpEntries(names, { ledger_synthetic_tool: '# ledger_synthetic_tool' });
    expect(missing).toEqual([]);
  });

  it('fails (reports a miss) when a registered tool lacks an overview table row', () => {
    const names = registerSynthetic(['ledger_synthetic_tool']);
    const missing = findMissingOverviewRows(names, '# Overview\n\nNo table rows here.');
    expect(missing).toEqual(['ledger_synthetic_tool']);
  });

  it('passes when the overview table has a matching row', () => {
    const names = registerSynthetic(['ledger_synthetic_tool']);
    const overview = '| Tool | Purpose |\n|------|---------|\n| ledger_synthetic_tool | does a thing |\n';
    const missing = findMissingOverviewRows(names, overview);
    expect(missing).toEqual([]);
  });

  it('fails (reports an orphan) when a TOOL_HELP key names no registered tool', () => {
    const names = registerSynthetic(['ledger_real_tool']);
    const toolHelp = { ledger_real_tool: '# ledger_real_tool', ledger_ghost_tool: '# ledger_ghost_tool' };
    const orphaned = findOrphanedHelpKeys(names, toolHelp);
    expect(orphaned).toEqual(['ledger_ghost_tool']);
  });

  it('does not flag the overview key as an orphan', () => {
    const names = registerSynthetic(['ledger_real_tool']);
    const toolHelp = { overview: '# Overview', ledger_real_tool: '# ledger_real_tool' };
    expect(findOrphanedHelpKeys(names, toolHelp)).toEqual([]);
  });
});
