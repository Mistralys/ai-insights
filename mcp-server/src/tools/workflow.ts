import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as nextActionModule from './workflow-next-action.js';
import * as handoffModule from './workflow-handoff.js';
import * as batchActionsModule from './workflow-batch-actions.js';

// Re-export for backward compatibility with test namespace imports.
export * from '../utils/workflow-helpers.js';
export { getDeveloperAction } from './workflow-next-action.js';
export {
  nextAgentFromStatus,
  buildHandoffResponse,
  getDeveloperHandoff,
  getProjectManagerHandoff,
  getQaHandoff,
  getReviewerHandoff,
  getDocumentationHandoff,
} from './workflow-handoff.js';

/**
 * Re-export pipeline maps for test access via namespace import.
 * @internal -- for unit testing only
 */
export { PIPELINE_AGENT_MAP, NEXT_AGENT_MAP } from '../utils/pipeline-maps.js';

/**
 * Register all workflow tools on the MCP server.
 */
export function register(server: McpServer): void {
  nextActionModule.register(server);
  handoffModule.register(server);
  batchActionsModule.register(server);
}
