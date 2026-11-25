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
 * Shim guard API (used by scripts/ai-insights-browser.js):
 *   SHARED_SESSION_NAME        — name of the machine-wide shared Playwright session
 *   TEARDOWN_COMMANDS          — commands that end every session on the machine
 *   parseBrowserArgs(argv)     — session, command and help/version flags of an argument list
 *   browserOutputDir(session, tmpDir?) — per-session output directory outside the project
 *   prepareBrowserInvocation(opts) — apply the shim's guards; returns forwarded args + env, or an error
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

// ---------------------------------------------------------------------------
// Shim guards
//
// The shim stays close to a pass-through: it recognises only the session
// option forms below, the first positional argument (the command), and the
// --help / --version / --force flags. Everything else is forwarded untouched.
// ---------------------------------------------------------------------------

/** Name Playwright gives the session when none is named; shared machine-wide. */
export const SHARED_SESSION_NAME = 'default';

/** Commands that end every browser session on the machine. */
export const TEARDOWN_COMMANDS = Object.freeze(['close-all', 'kill-all']);

/** Commands that do not act on a single session, so need no session name. */
const SESSIONLESS_COMMANDS = Object.freeze(['list', 'install', 'install-browser', ...TEARDOWN_COMMANDS]);

/** Environment variable Playwright reads as the default session name. */
const SESSION_ENV = 'PLAYWRIGHT_CLI_SESSION';

/** Environment variable Playwright reads as the output directory. */
const OUTPUT_DIR_ENV = 'PLAYWRIGHT_MCP_OUTPUT_DIR';

/**
 * Pick the session name, command and help/version flags out of an argument
 * list. Recognised session forms: `-s=NAME`, `-s NAME`, `--session=NAME`,
 * `--session NAME`. An empty name counts as no name. Parsing stops at `--`.
 * @param {string[]} argv  Arguments after the command name
 * @returns {{ session: string | null, command: string | null, help: boolean, version: boolean }}
 */
export function parseBrowserArgs(argv) {
  let session = null;
  let command = null;
  let help    = false;
  let version = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') break;

    const eq = /^(?:-s|--session)=(.*)$/.exec(arg);
    if (eq) {
      session = eq[1] || null;
      continue;
    }
    if (arg === '-s' || arg === '--session') {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('-')) {
        session = next;
        i++;
      }
      continue;
    }
    if (arg === '--help')    { help = true;    continue; }
    if (arg === '--version') { version = true; continue; }
    if (command === null && !arg.startsWith('-')) command = arg;
  }

  return { session, command, help, version };
}

/**
 * Directory the shim points Playwright's output (snapshot files, unnamed
 * screenshots) at: `{tmpDir}/ai-insights-browser/{session}`. Characters
 * outside `[A-Za-z0-9._-]` in the session name are replaced with `_`, so a
 * session name cannot escape the base directory.
 * @param {string} session
 * @param {string} [tmpDir]
 * @returns {string}
 */
export function browserOutputDir(session, tmpDir = os.tmpdir()) {
  let safe = String(session).replace(/[^A-Za-z0-9._-]/g, '_');
  if (/^\.*$/.test(safe)) safe = '_';
  return path.join(tmpDir, BROWSER_COMMAND, safe);
}

/**
 * Apply the shim's three guards to an invocation:
 *  1. A named session is required (option or PLAYWRIGHT_CLI_SESSION), except
 *     for help/version, no command, and commands that span sessions.
 *     Naming the shared session explicitly (`-s=default`) is the opt-in.
 *  2. PLAYWRIGHT_MCP_OUTPUT_DIR defaults to browserOutputDir(session); a
 *     value the caller set is kept.
 *  3. close-all / kill-all need --force, which is stripped before forwarding.
 * @param {{ argv: string[], env?: NodeJS.ProcessEnv, tmpDir?: string }} opts
 * @returns {{ ok: true, args: string[], env: NodeJS.ProcessEnv, outputDir: string }
 *         | { ok: false, message: string }}
 */
export function prepareBrowserInvocation({ argv, env = process.env, tmpDir = os.tmpdir() }) {
  const parsed  = parseBrowserArgs(argv);
  const session = parsed.session || env[SESSION_ENV] || null;
  const exempt  = parsed.help || parsed.version || parsed.command === null
    || SESSIONLESS_COMMANDS.includes(parsed.command);

  let args = [...argv];

  if (!parsed.help && TEARDOWN_COMMANDS.includes(parsed.command)) {
    if (!args.includes('--force')) {
      return { ok: false, message: teardownMessage(parsed.command) };
    }
    args = args.filter((a) => a !== '--force');
  }

  if (!session && !exempt) {
    return { ok: false, message: sessionMessage() };
  }

  const outputDir = env[OUTPUT_DIR_ENV] || browserOutputDir(session || SHARED_SESSION_NAME, tmpDir);
  return { ok: true, args, env: { ...env, [OUTPUT_DIR_ENV]: outputDir }, outputDir };
}

function sessionMessage() {
  return [
    `${BROWSER_COMMAND}: no session named. The unnamed "${SHARED_SESSION_NAME}" session is shared by every`,
    'agent and terminal on this machine, so another caller can navigate your page away between two commands.',
    `Fix: name a session on every call, e.g. ${BROWSER_COMMAND} -s=my-task open <url>`,
    `     (or set ${SESSION_ENV}=my-task for the whole shell).`,
    `To use the shared session on purpose, name it: ${BROWSER_COMMAND} -s=${SHARED_SESSION_NAME} <command>`,
  ].join('\n');
}

function teardownMessage(command) {
  return [
    `${BROWSER_COMMAND}: "${command}" ends every browser session on this machine, including sessions`,
    'other agents are using.',
    `To end only your own session, run: ${BROWSER_COMMAND} -s=<name> close`,
    `To end all sessions anyway, add --force: ${BROWSER_COMMAND} ${command} --force`,
  ].join('\n');
}
