/**
 * scripts/lib/browser-tool.js
 *
 * Detection and installation helpers for the workspace-local Playwright CLI
 * ("browser for agents"). The tool is installed under `tools/browser/` so it
 * is independent of any Playwright install the user already has, and is
 * exposed globally through the stable `ai-insights-browser` command — a
 * second `bin` entry of the workspace root package.json
 * (scripts/ai-insights-browser.js), registered by the same `npm link` that
 * registers `ai-insights` (scripts/lib/npm-link.js).
 *
 * Exported API:
 *   BROWSER_COMMAND            — the global shim's command name
 *   BROWSER_TOOL_DIR           — directory holding the local Playwright CLI install
 *   getBrowserCliEntry(dir?)   — absolute path of the installed Playwright CLI entry script, or null
 *   isBrowserToolInstalled()   — local install present
 *   isBrowserShimOnPath(opts?) — the global command resolves on PATH
 *   areBrowsersInstalled(opts?)— a Playwright Chromium build is present on disk
 *   installBrowserTool(opts?)  — npm install + Chromium download
 *
 * Dependency direction: this file MUST NOT import from scripts/cli.js
 * (it is imported by scripts/lib/health-checks.js).
 */

import fs   from 'fs';
import os   from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '..', '..');
const IS_WIN         = process.platform === 'win32';
const NPM_BIN        = IS_WIN ? 'npm.cmd' : 'npm';

/** Name of the stable global command agents invoke. */
export const BROWSER_COMMAND = 'ai-insights-browser';

/** Directory holding the workspace-local Playwright CLI package.json and node_modules. */
export const BROWSER_TOOL_DIR = path.join(WORKSPACE_ROOT, 'tools', 'browser');

/**
 * Resolve the installed Playwright CLI entry script from its package.json
 * `bin` field, so a renamed entry file in a later release keeps working.
 * @param {string} [dir]  Directory containing the tool's node_modules
 * @returns {string | null}
 */
export function getBrowserCliEntry(dir = BROWSER_TOOL_DIR) {
  try {
    const pkgDir = path.join(dir, 'node_modules', '@playwright', 'cli');
    const pkg    = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
    const bin    = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.['playwright-cli'];
    if (!bin) return null;
    const entry = path.join(pkgDir, bin);
    return fs.existsSync(entry) ? entry : null;
  } catch {
    return null;
  }
}

/**
 * True when the Playwright CLI is installed in the workspace-local tool dir.
 * @param {string} [dir]
 * @returns {boolean}
 */
export function isBrowserToolInstalled(dir = BROWSER_TOOL_DIR) {
  return getBrowserCliEntry(dir) !== null;
}

/**
 * True when `command` resolves to a file in one of the PATH directories.
 * On Windows each PATHEXT extension is tried (npm creates `.cmd` shims).
 * @param {{ command?: string, pathEnv?: string, pathExt?: string }} [opts]
 * @returns {boolean}
 */
export function isBrowserShimOnPath({
  command = BROWSER_COMMAND,
  pathEnv = process.env.PATH ?? process.env.Path ?? '',
  pathExt = process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD',
} = {}) {
  const exts = IS_WIN ? ['', ...pathExt.split(';').filter(Boolean)] : [''];
  for (const dir of pathEnv.split(path.delimiter).filter(Boolean)) {
    for (const ext of exts) {
      try {
        if (fs.statSync(path.join(dir, command + ext)).isFile()) return true;
      } catch { /* not in this directory */ }
    }
  }
  return false;
}

/**
 * Directory Playwright downloads browsers into, honouring
 * PLAYWRIGHT_BROWSERS_PATH (the standard override) before the OS default.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
function browsersDir(env = process.env) {
  const override = env.PLAYWRIGHT_BROWSERS_PATH;
  if (override && override !== '0') return override;
  if (IS_WIN) return path.join(env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'ms-playwright');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright');
  return path.join(env.XDG_CACHE_HOME ?? path.join(os.homedir(), '.cache'), 'ms-playwright');
}

/**
 * True when a Chromium build exists in the Playwright browsers directory.
 * Only the directory name is inspected (cheap); the revision is not matched
 * against the installed CLI, so a stale revision is not detected.
 * @param {{ env?: NodeJS.ProcessEnv }} [opts]
 * @returns {boolean}
 */
export function areBrowsersInstalled({ env = process.env } = {}) {
  try {
    return fs.readdirSync(browsersDir(env)).some((n) => /^chromium-\d+/.test(n));
  } catch {
    return false;
  }
}

/**
 * Install the Playwright CLI into the tool dir and download Chromium.
 * @param {{ dir?: string, log?: (msg: string) => void }} [opts]
 * @returns {{ success: boolean, output: string }}
 */
export function installBrowserTool({ dir = BROWSER_TOOL_DIR, log } = {}) {
  const run = (cmd, args, shell) => {
    const r = spawnSync(cmd, args, { cwd: dir, encoding: 'utf8', shell });
    const spawnError = r.error ? `${r.error.code || 'spawn error'}: ${r.error.message}\n` : '';
    const output = `${spawnError}${r.stdout || ''}${r.stderr || ''}`.trim();
    if (log && output) log(output);
    return { ok: r.status === 0, output };
  };

  // Node refuses to spawn .cmd files without a shell on Windows (EINVAL).
  const npm = run(NPM_BIN, ['install'], IS_WIN);
  if (!npm.ok) return { success: false, output: npm.output };

  const entry = getBrowserCliEntry(dir);
  if (!entry) {
    return { success: false, output: 'Playwright CLI entry script not found after npm install.' };
  }
  const browsers = run(process.execPath, [entry, 'install-browser', 'chromium'], false);
  return { success: browsers.ok, output: `${npm.output}\n${browsers.output}`.trim() };
}
