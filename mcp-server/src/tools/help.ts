import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { TOOL_HELP } from './help-content.js';

/**
 * Tool: ledger_help
 *
 * Returns usage documentation, examples, and workflow guidance for the
 * Project Ledger MCP tools. Designed to help agents (especially weaker models)
 * understand how to correctly call the tools.
 */


const HelpSchema = z.object({
  tool_name: z
    .string()
    .optional()
    .describe(
      'Optional. Specific tool name to get help for (e.g., "ledger_update_work_package_status"). Omit to get the full overview with all tools listed.'
    ),
});

async function help(args: z.infer<typeof HelpSchema>) {
  const toolName = args.tool_name?.trim();

  // If no tool specified, return overview
  if (!toolName) {
    return {
      content: [
        {
          type: 'text' as const,
          text: TOOL_HELP['overview'],
        },
      ],
    };
  }

  // Look up specific tool help
  const helpText = TOOL_HELP[toolName];

  if (helpText) {
    return {
      content: [
        {
          type: 'text' as const,
          text: helpText,
        },
      ],
    };
  }

  // Tool not found — return available tools list
  const availableTools = Object.keys(TOOL_HELP)
    .filter((k) => k !== 'overview')
    .join(', ');

  return {
    content: [
      {
        type: 'text' as const,
        text: `Unknown tool: "${toolName}". Available tools: ${availableTools}. Call ledger_help without tool_name for full overview.`,
      },
    ],
  };
}

/**
 * Register help tool on the MCP server
 */
export function register(server: McpServer): void {
  server.registerTool(
    'ledger_help',
    {
      description: 'Get usage documentation, examples, and required parameters for all ledger tools. Call with no arguments for a full overview, or pass tool_name to get detailed help for a specific tool (e.g., tool_name: "ledger_update_work_package_status"). START HERE if you are unsure how to use the ledger tools.',
      inputSchema: HelpSchema.passthrough(),
    },
    // TODO: remove `as any` cast once the MCP SDK exposes compatible Zod
    // passthrough types for registerTool's inputSchema parameter.
    // Tracked: https://github.com/modelcontextprotocol/typescript-sdk (MCP SDK typing issue)
    help as any
  );
}
