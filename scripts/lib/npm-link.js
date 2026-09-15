/**
 * scripts/lib/npm-link.js
 *
 * Detects and performs the `npm link` global registration for the
 * `ai-insights` CLI binary (the `bin` entry declared in the workspace root
 * package.json). This is a distinct concern from Global MCP registration
 * (scripts/install-mcp-global.js): that shim registers the MCP server with
 * an IDE's config; this makes the `ai-insights` shell command itself
 * resolvable from any directory via a global npm symlink.
 *
 * Exported API:
 *   getPackageName(root?)  — reads the `name` field from the workspace root package.json
 *   isCliLinked(opts?)     — true when `npm ls -g --depth=0 <name>` resolves (exit 0)
 *   linkCli(opts?)         — runs `npm link` from the workspace root
 */

import fs   from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '..', '..');
const IS_WIN          = process.platform === 'win32';
const NPM_BIN          = IS_WIN ? 'npm.cmd' : 'npm';

/**
 * Read the `name` field from a package.json, defaulting to the workspace root.
 * @param {string} [root]
 * @returns {string}
 */
export function getPackageName(root = WORKSPACE_ROOT) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  return pkg.name;
}

/**
 * True when the workspace's `bin` package is registered as a global npm
 * link. Uses `npm ls -g --depth=0 <name>` rather than resolving the bin
 * symlink directly, since npm's own bin-shim strategy differs across
 * platforms (POSIX symlink vs. Windows .cmd wrapper) — `npm ls` abstracts
 * that away and reports linked packages the same way it reports installed
 * ones.
 * @param {{ cwd?: string }} [opts]
 * @returns {boolean}
 */
export function isCliLinked({ cwd = WORKSPACE_ROOT } = {}) {
  let name;
  try {
    name = getPackageName(cwd);
  } catch {
    return false;
  }
  const result = spawnSync(NPM_BIN, ['ls', '-g', '--depth=0', name], {
    cwd,
    encoding: 'utf8',
    shell: false,
  });
  return result.status === 0;
}

/**
 * Run `npm link` from the workspace root, registering the `ai-insights`
 * command globally.
 * @param {{ cwd?: string, log?: (msg: string) => void }} [opts]
 * @returns {{ success: boolean, output: string }}
 */
export function linkCli({ cwd = WORKSPACE_ROOT, log } = {}) {
  const result = spawnSync(NPM_BIN, ['link'], {
    cwd,
    encoding: 'utf8',
    shell: false,
  });
  const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
  if (log && output) {
    log(output);
  }
  return { success: result.status === 0, output };
}
