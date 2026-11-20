import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as projectLifecycleTools from './project-lifecycle.js';
import * as workPackageTools from './work-package.js';
import * as pipelineTools from './pipeline.js';
import * as beginWorkTools from './begin-work.js';
import * as observationTools from './observations.js';
import * as workflowTools from './workflow.js';
import * as helpTools from './help.js';
import * as pingTools from './ping.js';
import * as knowledgeTools from './knowledge.js';
import * as repositoryContextTools from './repository-context.js';
import * as standaloneImportTools from './standalone-import.js';
import * as errorCodesTools from './error-codes.js';

/**
 * The single, derived source of truth for "which tool modules does this
 * server register", replacing three previously hand-maintained lists:
 * `index.ts`'s registration calls, its startup log literal, and
 * `schema-integrity.test.ts`'s import list (the latter had already drifted
 * — it omitted `ping.ts` and `standalone-import.ts`).
 *
 * `help-content.ts` is deliberately excluded: it is data-only
 * (`TOOL_HELP`) and exports no `register` function.
 *
 * `workflow.ts` is one entry covering two source files
 * (`workflow-next-action.ts`, `workflow-handoff.ts`) that each contain
 * their own `server.registerTool(` call — `workflow.ts` only delegates to
 * both. `tool-registry.test.ts` verifies completeness by scanning every
 * `src/tools/*.ts` file for `server.registerTool(` call sites directly,
 * so this delegation is transparent to that check: it does not require a
 * 1:1 file-to-registry-entry mapping, only that every tool name found in
 * source ends up registered when `registerAllTools` runs.
 */
export interface ToolModuleEntry {
  /** A short identifying label for this registry entry — not an MCP tool name. Used only for readability when debugging `TOOL_MODULES` itself. */
  id: string;
  register(server: McpServer): void;
}

export const TOOL_MODULES: readonly ToolModuleEntry[] = [
  { id: 'project-lifecycle', register: projectLifecycleTools.register },
  { id: 'work-package', register: workPackageTools.register },
  { id: 'pipeline', register: pipelineTools.register },
  { id: 'begin-work', register: beginWorkTools.register },
  { id: 'observations', register: observationTools.register },
  { id: 'workflow', register: workflowTools.register },
  { id: 'help', register: helpTools.register },
  { id: 'ping', register: pingTools.register },
  { id: 'knowledge', register: knowledgeTools.register },
  { id: 'repository-context', register: repositoryContextTools.register },
  { id: 'standalone-import', register: standaloneImportTools.register },
  { id: 'error-codes', register: errorCodesTools.register },
];

/**
 * Registers every tool module in {@link TOOL_MODULES} on `server`, and
 * returns the full, duplicate-free list of MCP tool names that were
 * registered — in registration order.
 *
 * Tool names are captured by temporarily wrapping `server.registerTool`
 * for the duration of this call, rather than requiring each tool module to
 * separately report the names it registers. `McpServer` exposes no public
 * API to list registered tools after the fact (`_registeredTools` is
 * private), so this is the only way to derive the name list without
 * changing every tool module's `register()` signature.
 */
export function registerAllTools(server: McpServer): string[] {
  const names: string[] = [];

  // `registerTool` is a plain prototype method, so shadowing it on the
  // instance for the duration of this call — then restoring the exact same
  // original function reference — is safe and leaves the server object
  // identical (by reference, not just behaviour) to how it was found.
  const original = server.registerTool;
  const capturing = ((name: string, ...rest: unknown[]): unknown => {
    names.push(name);
    return (original as (...args: unknown[]) => unknown).apply(server, [name, ...rest]);
  }) as typeof server.registerTool;

  (server as unknown as { registerTool: typeof server.registerTool }).registerTool = capturing;

  try {
    for (const mod of TOOL_MODULES) {
      mod.register(server);
    }
  } finally {
    (server as unknown as { registerTool: typeof server.registerTool }).registerTool = original;
  }

  const uniqueNames = new Set(names);
  if (uniqueNames.size !== names.length) {
    const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
    throw new Error(`registerAllTools: duplicate tool name(s) registered: ${[...new Set(duplicates)].join(', ')}`);
  }

  return names;
}
