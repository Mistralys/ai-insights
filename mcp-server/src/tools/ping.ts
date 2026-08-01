import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SERVER_VERSION, readPackageVersion } from '../utils/server-version.js';

/**
 * Tool: ledger_ping
 *
 * Lightweight health-check tool that returns server reachability status,
 * the running server version, stale-process detection, and uptime.
 * Agents should call this instead of ledger_help for preflight connectivity
 * checks — it returns ~50 tokens vs ~2,000 tokens for the full help output.
 */

const PingSchema = z.object({});

interface PingResponseFresh {
  status: 'ok';
  server_version: string;
  stale: false;
  uptime_seconds: number;
}

interface PingResponseStale {
  status: 'warn';
  server_version: string;
  stale: true;
  uptime_seconds: number;
  instruction: string;
}

interface PingResponseUnknownStaleness {
  status: 'warn';
  server_version: string;
  stale: null;
  uptime_seconds: number;
  instruction: string;
}

type PingResponse = PingResponseFresh | PingResponseStale | PingResponseUnknownStaleness;

async function ping(): Promise<{ content: [{ type: 'text'; text: string }] }> {
  const uptimeSeconds = Math.floor(process.uptime());

  let response: PingResponse;

  try {
    const diskVersion = readPackageVersion();
    if (diskVersion !== SERVER_VERSION) {
      response = {
        status: 'warn',
        server_version: SERVER_VERSION,
        stale: true,
        uptime_seconds: uptimeSeconds,
        instruction: `STOP — The running server (v${SERVER_VERSION}) is outdated; a newer build (v${diskVersion}) is on disk. Halt this workflow, ask the user to restart the MCP server, then re-run preflight before continuing.`,
      };
    } else {
      response = {
        status: 'ok',
        server_version: SERVER_VERSION,
        stale: false,
        uptime_seconds: uptimeSeconds,
      };
    }
  } catch (err) {
    // package.json momentarily absent (e.g., during a rebuild) — report
    // staleness as unknown rather than propagating an opaque MCP error.
    response = {
      status: 'warn',
      server_version: SERVER_VERSION,
      stale: null,
      uptime_seconds: uptimeSeconds,
      instruction: `STOP — Server version freshness could not be confirmed because package.json was unreadable. Halt this workflow, ask the user to resolve the issue, then re-run preflight before continuing.`,
    };
  }

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(response),
      },
    ],
  };
}

/**
 * Register ping tool on the MCP server
 */
export function register(server: McpServer): void {
  server.registerTool(
    'ledger_ping',
    {
      description:
        'Lightweight health check — verify MCP server reachability and detect stale instances. Returns status ("ok" = fresh, "warn" = stale or unknown), server_version, stale (true/false/null), and uptime_seconds. When stale is true or null, status is "warn" and the response includes an instruction field with an explicit, persona-facing action to take. Use this for preflight connectivity checks instead of ledger_help to avoid 2,000-token overhead.',
      inputSchema: PingSchema.passthrough(),
    },
    // TODO: remove `as any` cast once the MCP SDK exposes compatible Zod
    // passthrough types for registerTool's inputSchema parameter.
    // Tracked: https://github.com/modelcontextprotocol/typescript-sdk (MCP SDK typing issue)
    ping as any
  );
}

export const _internal = { ping, PingSchema };
