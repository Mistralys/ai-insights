#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { SERVER_VERSION } from './utils/server-version.js';
import os from 'os';
import * as projectLifecycleTools from './tools/project-lifecycle.js';
import * as workPackageTools from './tools/work-package.js';
import * as pipelineTools from './tools/pipeline.js';
import * as beginWorkTools from './tools/begin-work.js';
import * as observationTools from './tools/observations.js';
import * as workflowTools from './tools/workflow.js';
import * as helpTools from './tools/help.js';
import { discoverAgents } from './utils/agent-registry.js';
import { resolveLedgerRoot } from './utils/ledger-root.js';
import { readConfigFromDisk, startConfigWatcher } from './gui/config.js';
import { setMcpServer } from './utils/client-info.js';

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
  if (argIdx !== -1) {
    const agentsDir = process.argv[argIdx + 1];
    if (agentsDir) {
      return resolve(agentsDir);
    }
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
    version: SERVER_VERSION,
  });

  // Expose server instance for getClientInfo() accessor
  setMcpServer(server);

  // NOTE: The tool list printed in the startup log below must be kept in sync
  // with the tools registered here. Update the log message whenever a tool is
  // added or removed in src/tools/**. There is no auto-discovery at startup.
  // Register tools
  projectLifecycleTools.register(server);
  workPackageTools.register(server);
  pipelineTools.register(server);
  beginWorkTools.register(server);
  observationTools.register(server);
  workflowTools.register(server);
  helpTools.register(server);

  // Connect to STDIO transport
  // Note: stdout is reserved for MCP protocol, all logs go to stderr
  const transport = new StdioServerTransport();

  await server.connect(transport);

  // Log startup to stderr (never stdout - that's for MCP protocol)
  console.error(`[project-ledger-mcp] Server v${SERVER_VERSION} started successfully`);
  console.error('[project-ledger-mcp] Transport: STDIO');

  // Initialise centralized ledger root
  const ledgerRoot = resolveLedgerRoot();
  mkdirSync(ledgerRoot, { recursive: true });
  process.stderr.write(`[mcp-server] Ledger root: ${ledgerRoot}\n`);

  // Initialise runtime config from gui-config.json
  const configPath = join(ledgerRoot, 'gui-config.json');
  await readConfigFromDisk(configPath);
  startConfigWatcher(configPath);
  process.stderr.write(`[config] Watching ${configPath}\n`);

  // NOTE: This list must be kept in sync manually when tools are added or
  // removed in src/tools/**. The MCP SDK does not expose a listTools() method
  // at startup, so dynamic generation is not currently possible.
  console.error(
    '[project-ledger-mcp] Registered tools: ledger_help, ledger_get_project_status, ledger_initialize_project, ledger_get_work_package, ledger_list_work_packages, ledger_create_work_package, ledger_claim_work_package, ledger_update_work_package_status, ledger_reset_rework_count, ledger_update_acceptance_criteria, ledger_start_pipeline, ledger_begin_work, ledger_complete_pipeline, ledger_cancel_pipeline, ledger_update_pipeline_progress, ledger_add_observation, ledger_add_project_comment, ledger_get_next_action, ledger_get_handoff_status'
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
