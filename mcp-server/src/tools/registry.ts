import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as projectLifecycleTools from './project-lifecycle.js';
import * as workPackageTools from './work-package.js';
import * as workPackageAdminTools from './work-package-admin.js';
import * as pipelineTools from './pipeline.js';
import * as beginWorkTools from './begin-work.js';
import * as observationTools from './observations.js';
import * as workflowTools from './workflow.js';
import * as helpTools from './help.js';
import * as pingTools from './ping.js';
import * as knowledgeTools from './knowledge.js';
import * as repositoryContextTools from './repository-context.js';
import * as standaloneImportTools from './standalone-import.js';

/**
 * A tool module is any module exporting a `register(server: McpServer): void`
 * function that calls `server.registerTool(...)` one or more times to
 * install its MCP tools.
 */
export interface ToolModule {
  /** Identifier for diagnostics and duplicate-module detection. */
  id: string;
  /** Registers this module's tools against the given server. */
  register: (server: McpServer) => void;
}

/**
 * The full, ordered set of tool modules registered by the MCP server at
 * startup. This is the single source of truth for which modules contribute
 * tools: `index.ts`'s startup log, `tests/startup/tool-log-sync.test.ts`,
 * and `tests/tools/schema-integrity.test.ts` all derive their expectations
 * from this list instead of maintaining their own hand-written copies.
 *
 * Frozen via `Object.freeze` to catch accidental runtime mutation. A new
 * tool module is added here as a single line; `tool-log-sync.test.ts` fails
 * if a module that calls `server.registerTool` is left out.
 */
export const TOOL_MODULES: readonly ToolModule[] = Object.freeze([
  { id: 'project-lifecycle', register: projectLifecycleTools.register },
  { id: 'work-package', register: workPackageTools.register },
  { id: 'work-package-admin', register: workPackageAdminTools.register },
  { id: 'pipeline', register: pipelineTools.register },
  { id: 'begin-work', register: beginWorkTools.register },
  { id: 'observations', register: observationTools.register },
  { id: 'workflow', register: workflowTools.register },
  { id: 'help', register: helpTools.register },
  { id: 'ping', register: pingTools.register },
  { id: 'knowledge', register: knowledgeTools.register },
  { id: 'repository-context', register: repositoryContextTools.register },
  { id: 'standalone-import', register: standaloneImportTools.register },
]);

/**
 * Registers every tool module's tools against `server`, recording each
 * registered tool name in registration order as it forwards the call
 * through to the real `server.registerTool`.
 *
 * This uses only the public `registerTool(name, config, handler)` signature
 * — it does not depend on any MCP SDK internals, so it keeps working across
 * SDK upgrades that change how tools are stored internally.
 *
 * @param server MCP server instance to register tools on.
 * @param modules Tool modules to register, in order. Defaults to
 *   {@link TOOL_MODULES}; tests pass a synthetic subset to exercise ordering
 *   and duplicate-detection without depending on the real tool set.
 * @returns The registered tool names, in the order `registerTool` was
 *   called.
 * @throws {Error} If the same tool name is registered more than once, with
 *   the message `Duplicate tool registration: <name>`.
 */
export function registerAllTools(
  server: McpServer,
  modules: readonly ToolModule[] = TOOL_MODULES
): string[] {
  const names: string[] = [];
  const seen = new Set<string>();

  // Minimal recording shim: only `registerTool` is ever called by tool
  // modules during registration, so only it needs to be intercepted here.
  const recordingServer = {
    registerTool(name: string, config: unknown, handler: unknown): unknown {
      if (seen.has(name)) {
        throw new Error(`Duplicate tool registration: ${name}`);
      }
      seen.add(name);
      names.push(name);
      return (server.registerTool as (...args: unknown[]) => unknown)(name, config, handler);
    },
  } as unknown as McpServer;

  for (const mod of modules) {
    mod.register(recordingServer);
  }

  return names;
}
