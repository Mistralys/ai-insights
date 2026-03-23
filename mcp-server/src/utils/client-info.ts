import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Implementation } from '@modelcontextprotocol/sdk/types.js';

/**
 * Module-level MCP server reference.
 * Set once via setMcpServer() after the McpServer is created in index.ts.
 */
let _mcpServer: McpServer | undefined;

/**
 * Stores the MCP server instance so getClientInfo() can access client identity.
 * Must be called once during server startup.
 */
export function setMcpServer(server: McpServer): void {
  _mcpServer = server;
}

/**
 * Returns the MCP client identity reported during the initialization handshake.
 *
 * Since the server uses STDIO transport (single client per process), the returned
 * value is stable for the entire session. Returns undefined before the transport
 * connects or if the client did not identify itself.
 *
 * @returns The client's { name, version } implementation object, or undefined.
 */
export function getClientInfo(): Implementation | undefined {
  return _mcpServer?.server.getClientVersion();
}
