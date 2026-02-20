#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import os from 'os';
import * as projectLifecycleTools from './tools/project-lifecycle.js';
import * as workPackageTools from './tools/work-package.js';
import * as pipelineTools from './tools/pipeline.js';
import * as observationTools from './tools/observations.js';
import * as workflowTools from './tools/workflow.js';
import * as helpTools from './tools/help.js';
import { discoverAgents } from './utils/agent-registry.js';

// Load version from package.json
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(
  readFileSync(join(__dirname, '..', 'package.json'), 'utf-8')
);
const VERSION = packageJson.version;

/**
 * Resolves the agents directory from CLI args or platform-specific defaults.
 *
 * Precedence:
 * 1. `--agents-dir <path>` CLI argument
 * 2. Platform-specific default (VS Code User prompts folder)
 */
function resolveAgentsDir(): string {
  // Check for --agents-dir <path> in process.argv
  const argIdx = process.argv.indexOf('--agents-dir');
  if (argIdx !== -1 && process.argv[argIdx + 1]) {
    return resolve(process.argv[argIdx + 1]);
  }

  // Platform-specific defaults
  const home = os.homedir();
  switch (os.platform()) {
    case 'darwin':
      return join(home, 'Library', 'Application Support', 'Code', 'User', 'prompts');
    case 'linux':
      return join(home, '.config', 'Code', 'User', 'prompts');
    case 'win32': {
      const appData = process.env['APPDATA'] ?? join(home, 'AppData', 'Roaming');
      return join(appData, 'Code', 'User', 'prompts');
    }
    default:
      return join(home, '.config', 'Code', 'User', 'prompts');
  }
}

/**
 * Project Ledger MCP Server
 *
 * Provides MCP tools for managing project ledgers in the AI agent workflow.
 * This server eliminates dual-file desync bugs by wrapping ledger operations
 * with typed tools, enforcing consistency, validation, and atomicity.
 */

async function main(): Promise<void> {
  // Create the MCP server instance
  const server = new McpServer({
    name: 'project-ledger',
    version: VERSION,
  });

  // NOTE: The tool list printed in the startup log below must be kept in sync
  // with the tools registered here. Update the log message whenever a tool is
  // added or removed in src/tools/**. There is no auto-discovery at startup.
  // Register tools
  projectLifecycleTools.register(server);
  workPackageTools.register(server);
  pipelineTools.register(server);
  observationTools.register(server);
  workflowTools.register(server);
  helpTools.register(server);

  // Connect to STDIO transport
  // Note: stdout is reserved for MCP protocol, all logs go to stderr
  const transport = new StdioServerTransport();

  await server.connect(transport);

  // Log startup to stderr (never stdout - that's for MCP protocol)
  console.error(`[project-ledger-mcp] Server v${VERSION} started successfully`);
  console.error('[project-ledger-mcp] Transport: STDIO');
  // NOTE: This list must be kept in sync manually when tools are added or
  // removed in src/tools/**. The MCP SDK does not expose a listTools() method
  // at startup, so dynamic generation is not currently possible.
  console.error(
    '[project-ledger-mcp] Registered tools: ledger_help, ledger_get_project_status, ledger_initialize_project, ledger_get_work_package, ledger_list_work_packages, ledger_create_work_package, ledger_claim_work_package, ledger_update_work_package_status, ledger_start_pipeline, ledger_complete_pipeline, ledger_cancel_pipeline, ledger_update_pipeline_progress, ledger_add_observation, ledger_add_project_comment, ledger_get_next_action, ledger_get_next_actions, ledger_get_handoff_status'
  );

  // Initialise agent registry for auto-handoff
  const agentsDir = resolveAgentsDir();
  const agentMap = await discoverAgents(agentsDir);
  const agentCount = Object.keys(agentMap).length;
  if (agentCount > 0) {
    console.error(
      `[project-ledger-mcp] Agent registry: ${agentCount} agents discovered from ${agentsDir}`
    );
  } else {
    console.error(
      `[project-ledger-mcp] agents_dir not found: ${agentsDir}. Auto-handoff disabled.`
    );
  }
}

// Start the server
main().catch((error) => {
  console.error('[project-ledger-mcp] Fatal error:', error);
  process.exit(1);
});
