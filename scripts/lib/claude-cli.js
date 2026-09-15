/**
 * scripts/lib/claude-cli.js
 *
 * Shared "is the `claude` CLI on PATH" predicate. Extracted from the first
 * branch of scripts/install-mcp-global.js's private _checkClaudeCodeStatus()
 * so both install-mcp-global.js and scripts/launch-agent.js can share a
 * single source of truth for this check.
 */

import { spawnSync } from 'child_process';

const IS_WIN = process.platform === 'win32';

/**
 * True when the `claude` CLI is resolvable on PATH.
 * @returns {boolean}
 */
export function isClaudeCliAvailable() {
  const whichCmd = IS_WIN ? 'where' : 'which';
  const check = spawnSync(whichCmd, ['claude'], { encoding: 'utf8', shell: false });
  return check.status === 0;
}
