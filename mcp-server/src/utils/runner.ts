/**
 * Runner classification utility.
 *
 * Normalises the raw MCP `clientInfo.name` string supplied during the
 * initialization handshake into a stable {@link RunnerType} enum value so
 * that the rest of the server can filter and display projects by runner
 * without depending on the exact client-reported string (which varies across
 * versions and platforms).
 *
 * @module runner
 */

export type RunnerType = 'vscode' | 'claude-code' | 'orchestrator' | 'unknown';

export interface RunnerInfo {
  runner: RunnerType;
  runner_client: string;
  runner_version: string;
}

export interface ClientInfo {
  name: string;
  version: string;
}

/**
 * Classify an MCP client into a stable {@link RunnerType} enum value.
 *
 * Matching is **case-insensitive substring-based** and uses a fixed priority
 * order to handle ambiguous names:
 *
 * 1. **`vscode`** — name contains `"visual studio code"` or `"vscode"`
 * 2. **`claude-code`** — name contains `"claude"`
 * 3. **`orchestrator`** — name contains `"langchain"` or `"mcp-adapters"`, or is exactly `"mcp"`
 * 4. **`unknown`** — anything else, or when `clientInfo` is `undefined`
 *
 * The first matching rule wins. Raw `name` and `version` strings are preserved
 * in the returned object for diagnostics (e.g. "which exact VS Code build?").
 *
 * @param clientInfo - The `{ name, version }` object from the MCP
 *   `initialize` handshake, or `undefined` if the client did not identify
 *   itself.
 * @returns A {@link RunnerInfo} object with a normalised `runner` enum value
 *   plus the original `runner_client` and `runner_version` strings. When
 *   `clientInfo` is `undefined`, both string fields are empty (`""`).
 *
 * @example
 * classifyRunner({ name: 'Visual Studio Code', version: '1.99' })
 * // → { runner: 'vscode', runner_client: 'Visual Studio Code', runner_version: '1.99' }
 *
 * @example
 * classifyRunner({ name: 'langchain-mcp-adapters', version: '1.0' })
 * // → { runner: 'orchestrator', runner_client: 'langchain-mcp-adapters', runner_version: '1.0' }
 *
 * @example
 * classifyRunner(undefined)
 * // → { runner: 'unknown', runner_client: '', runner_version: '' }
 */
export function classifyRunner(clientInfo: ClientInfo | undefined): RunnerInfo {
  if (clientInfo === undefined) {
    return { runner: 'unknown', runner_client: '', runner_version: '' };
  }

  const name = clientInfo.name;
  const lower = name.toLowerCase();

  let runner: RunnerType;

  if (lower.includes('visual studio code') || lower.includes('vscode')) {
    runner = 'vscode';
  } else if (lower.includes('claude')) {
    runner = 'claude-code';
  } else if (lower.includes('langchain') || lower.includes('mcp-adapters') || lower === 'mcp') {
    runner = 'orchestrator';
  } else {
    runner = 'unknown';
  }

  return {
    runner,
    runner_client: name,
    runner_version: clientInfo.version,
  };
}
