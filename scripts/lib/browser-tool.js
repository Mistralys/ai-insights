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
 *   parseBrowserArgs(argv)     — session, command, operands and help/version flags of an argument list
 *   resolveBrowserSession(parsed, env?) — session a command runs in (option, env, or `attach <name>`)
 *   browserOutputDir(session, tmpDir?) — per-session output directory outside the project
 *   prepareBrowserInvocation(opts) — apply the shim's guards; returns forwarded args + env, or an error
 *   absolutizeHelpOutput(output, cwd?) — make the global help's `Agent skill:` path absolute
 *   appendShimHelp(output)     — append the shim's own notes to the global help
 *   inlineSnapshotOutput(output, opts?) — replace a snapshot file link with the snapshot itself
 *   withStatusLine(output, exitCode, opts?) — put an ok / failed status first in the output
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
 * Environment variable Playwright reads as the file path rendering mode
 * ("relative" to the caller's cwd, or "absolute"). Read by the session's
 * daemon when it starts (`open` / `attach`); it overrides config files.
 */
const FILE_PATHS_ENV = 'PLAYWRIGHT_MCP_FILE_PATHS';

/** Command whose first operand also names the session (Playwright: "defaults to bound browser name"). */
const ATTACH_COMMAND = 'attach';

/**
 * Global flags of the Playwright CLI (`--help`, "Global options") that take
 * no value. Any other bare `--option` / `-o` may consume the next token as
 * its value (Playwright parses with minimist), so the token after it is not
 * taken as an operand.
 */
const VALUELESS_GLOBAL_FLAGS = Object.freeze(['--help', '--version', '--json', '--raw', '--force', '--inline-snapshot']);

/**
 * Shim-only flag (never forwarded): print an ok / failed status line first and
 * the page snapshot instead of the link to its file. The Playwright CLI writes
 * the snapshot of every action command to a file and offers no switch for it.
 */
export const INLINE_FLAG = '--inline-snapshot';

/** Environment variable that turns the inline mode on for every call (`1` or `true`). */
export const INLINE_ENV = 'AI_INSIGHTS_BROWSER_INLINE_SNAPSHOT';

/**
 * Pick the session name, command, operands and help/version flags out of an
 * argument list. Recognised session forms: `-s=NAME`, `-s NAME`,
 * `--session=NAME`, `--session NAME`. An empty name counts as no name.
 * Parsing stops at `--`.
 *
 * Operands are the positional arguments after the command. A token directly
 * after a bare option other than VALUELESS_GLOBAL_FLAGS is treated as that
 * option's value, not as an operand — erring towards "no operand" keeps the
 * session guard strict (e.g. `attach --cdp chrome` has no operand).
 * @param {string[]} argv  Arguments after the command name
 * @returns {{ session: string | null, command: string | null, operands: string[], help: boolean, version: boolean }}
 */
export function parseBrowserArgs(argv) {
  let session  = null;
  let command  = null;
  let help     = false;
  let version  = false;
  let optValue = false;
  const operands = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') break;

    const afterOption = optValue;
    optValue = false;

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
    if (arg.startsWith('-')) {
      optValue = !arg.includes('=') && !VALUELESS_GLOBAL_FLAGS.includes(arg);
      continue;
    }
    if (command === null) {
      command = arg;
      continue;
    }
    if (!afterOption) operands.push(arg);
  }

  return { session, command, operands, help, version };
}

/**
 * Session a command will run in, following Playwright's own resolution:
 * the session option, then PLAYWRIGHT_CLI_SESSION, then — for `attach` only —
 * the bound browser name given as its first operand. Null means the shared
 * "default" session.
 * @param {ReturnType<typeof parseBrowserArgs>} parsed
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string | null}
 */
export function resolveBrowserSession(parsed, env = process.env) {
  if (parsed.session) return parsed.session;
  if (env[SESSION_ENV]) return env[SESSION_ENV];
  if (parsed.command === ATTACH_COMMAND && parsed.operands[0]) return parsed.operands[0];
  return null;
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
 * Apply the shim's guards and defaults to an invocation:
 *  1. A named session is required (option, PLAYWRIGHT_CLI_SESSION, or the
 *     bound browser name of `attach <name>`), except for help/version, no
 *     command, and commands that span sessions. Naming the shared session
 *     explicitly (`-s=default`) is the opt-in.
 *  2. PLAYWRIGHT_MCP_OUTPUT_DIR defaults to browserOutputDir(session); a
 *     value the caller set is kept.
 *  3. PLAYWRIGHT_MCP_FILE_PATHS defaults to "absolute", so file references
 *     in the output are absolute paths; a value the caller set is kept.
 *  4. close-all / kill-all need --force, which is stripped before forwarding.
 *  5. --inline-snapshot (or INLINE_ENV) asks for the inline mode; the flag is
 *     recognised in any position before a `--` terminator, and stripped before
 *     forwarding.
 *
 * `rewriteHelp` is true when the CLI will print help, which the shim buffers:
 * the global help's `Agent skill:` line is made absolute (absolutizeHelpOutput())
 * and, when `shimHelp` is true as well, the shim's own notes are appended
 * (appendShimHelp()).
 *
 * `inline` is null unless the inline mode applies to this call (it never does
 * for help, version or a call with no command). Otherwise it carries how to
 * render the output: `json` / `raw` follow the CLI's output flags, and
 * `snapshot` is false for `snapshot --filename`, where the caller asked for the
 * file and the link stays.
 * @param {{ argv: string[], env?: NodeJS.ProcessEnv, tmpDir?: string }} opts
 * @returns {{ ok: true, args: string[], env: NodeJS.ProcessEnv, outputDir: string, rewriteHelp: boolean,
 *             shimHelp: boolean, inline: { json: boolean, raw: boolean, snapshot: boolean } | null }
 *         | { ok: false, message: string }}
 */
export function prepareBrowserInvocation({ argv, env = process.env, tmpDir = os.tmpdir() }) {
  const parsed  = parseBrowserArgs(argv);
  const session = resolveBrowserSession(parsed, env);
  const exempt  = parsed.help || parsed.version || parsed.command === null
    || SESSIONLESS_COMMANDS.includes(parsed.command);

  // The inline flag is the shim's in any position, as `--json` and `--raw` are
  // the CLI's. The CLI rejects every operand that looks like an option
  // (`fill e3 --text` fails with "Unknown option"), so no legitimate argument
  // is lost to the strip. Like the parser, it stops at `--`.
  const terminator = argv.indexOf('--');
  const optionEnd  = terminator === -1 ? argv.length : terminator;
  let args = argv.filter((a, i) => !(a === INLINE_FLAG && i < optionEnd));
  const flagGiven = args.length !== argv.length;

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
  const filePaths = env[FILE_PATHS_ENV] || 'absolute';
  const rewriteHelp = !parsed.version && (parsed.help || parsed.command === null);

  const wantsInline = flagGiven || /^(1|true)$/i.test(env[INLINE_ENV] ?? '');
  const inline = wantsInline && !rewriteHelp && !parsed.version
    ? {
        json: args.includes('--json'),
        raw: args.includes('--raw'),
        snapshot: !(parsed.command === 'snapshot'
          && args.some((a) => a === '--filename' || a.startsWith('--filename='))),
      }
    : null;

  return {
    ok: true,
    args,
    env: { ...env, [OUTPUT_DIR_ENV]: outputDir, [FILE_PATHS_ENV]: filePaths },
    outputDir,
    rewriteHelp,
    shimHelp: rewriteHelp && !parsed.version && parsed.command === null,
    inline,
  };
}

/**
 * Make the `Agent skill: <path>` line of the CLI's global help absolute.
 * The Playwright CLI prints it (only when CLAUDECODE or COPILOT_CLI is set)
 * relative to the caller's cwd, outside the file-paths setting. Handles the
 * plain text help and the `--json` form (`{ "help": "..." }`, re-emitted in
 * Playwright's own 2-space format). Anything else is returned unchanged.
 * @param {string} output  Captured stdout of a help invocation
 * @param {string} [cwd]   Directory the CLI resolved the path against
 * @returns {string}
 */
export function absolutizeHelpOutput(output, cwd = process.cwd()) {
  return mapHelpText(output, (text) => text.replace(
    /^(Agent skill: )(.+?)(\r?)$/m,
    (_, label, file, cr) => `${label}${path.resolve(cwd, file)}${cr}`,
  ));
}

/**
 * Apply `transform` to the help text, whether the output is the plain text
 * help or the `--json` form (`{ "help": "..." }`, re-emitted in Playwright's
 * own 2-space format). Output that is neither, or that `transform` leaves
 * unchanged, is returned as it came.
 * @param {string} output
 * @param {(text: string) => string} transform
 * @returns {string}
 */
function mapHelpText(output, transform) {
  const trimmed = output.trim();
  if (trimmed.startsWith('{')) {
    try {
      const value = JSON.parse(trimmed);
      if (value && typeof value.help === 'string') {
        const help = transform(value.help);
        if (help === value.help) return output;
        return JSON.stringify({ ...value, help }, null, 2) + eolOf(output);
      }
    } catch { /* not JSON — fall through to the text form */ }
    return output;
  }
  return transform(output);
}

function eolOf(output) {
  return output.endsWith('\r\n') ? '\r\n' : '\n';
}

/**
 * Append the shim's own notes to the global help, so the options and guards
 * the Playwright CLI knows nothing about are discoverable from `--help`.
 * @param {string} output  Captured stdout of the global help invocation
 * @returns {string}
 */
export function appendShimHelp(output) {
  return mapHelpText(output, (text) => `${text.replace(/\s+$/, '')}\n\n${shimHelpNotes()}\n`);
}

function shimHelpNotes() {
  return [
    `${BROWSER_COMMAND} (shim) notes:`,
    `  Name a session on every call: -s=NAME (or set ${SESSION_ENV}=NAME); -s=${SHARED_SESSION_NAME} opts into the shared one.`,
    `  ${INLINE_FLAG}  Print "${BROWSER_COMMAND}: ok" or "${BROWSER_COMMAND}: failed (exit N)" first, and the`,
    `                     page snapshot in place of the link to its file. Set ${INLINE_ENV}=1 to`,
    '                     make it the default.',
    '  close-all / kill-all end every session on the machine and need --force.',
    `  Usage notes: ${path.join(WORKSPACE_ROOT, 'docs', 'references', 'development.md')} (section "Browser Tool for Agents")`,
  ].join('\n');
}

/**
 * Replace the link to a snapshot file with the snapshot itself, in the form
 * the Playwright CLI uses when it prints a snapshot inline: a ```yaml fence in
 * text output (no fence with `raw`), the tree as a string in `--json` output.
 * A file that cannot be read leaves its link in place and adds a warning.
 * @param {string} output  Captured stdout of a command
 * @param {{ json?: boolean, raw?: boolean, cwd?: string, readFile?: (file: string) => string }} [opts]
 * @returns {{ output: string, warnings: string[] }}
 */
export function inlineSnapshotOutput(output, {
  json = false,
  raw = false,
  cwd = process.cwd(),
  readFile = (file) => fs.readFileSync(file, 'utf8'),
} = {}) {
  const warnings = [];
  const load = (file) => {
    try {
      return readFile(path.resolve(cwd, file)).replace(/\s+$/, '');
    } catch (err) {
      warnings.push(`${BROWSER_COMMAND}: could not read snapshot file ${file}: ${err.message}`);
      return null;
    }
  };

  if (json) {
    try {
      const value = JSON.parse(output);
      const file  = value?.snapshot?.file;
      if (typeof file === 'string') {
        const tree = load(file);
        if (tree !== null) {
          return { output: JSON.stringify({ ...value, snapshot: tree }, null, 2) + eolOf(output), warnings };
        }
      }
    } catch { /* not JSON — leave the output as it is */ }
    return { output, warnings };
  }

  const replaced = output.replace(/^- \[Snapshot\]\((.+)\)(\r?)$/gm, (link, file, cr) => {
    const tree = load(file);
    if (tree === null) return link;
    return (raw ? tree : `\`\`\`yaml\n${tree}\n\`\`\``) + cr;
  });
  return { output: replaced, warnings };
}

/**
 * Put the outcome of the command first in its output, so a reader who pipes
 * it through `head` or `grep` still sees whether it worked: a line
 * `ai-insights-browser: ok` / `ai-insights-browser: failed (exit N)`, or a
 * leading `status` key in `--json` output. `--json` output that is not a JSON
 * object (a failure the CLI printed as plain text) is left as it is, so stdout
 * stays machine-readable, and the status line comes back as `notice` for the
 * caller to print on stderr.
 * @param {string} output
 * @param {number} exitCode
 * @param {{ json?: boolean }} [opts]
 * @returns {{ output: string, notice: string | null }}
 */
export function withStatusLine(output, exitCode, { json = false } = {}) {
  const status = exitCode === 0 ? 'ok' : `failed (exit ${exitCode})`;
  if (json) {
    try {
      const value = JSON.parse(output);
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        return { output: JSON.stringify({ status, ...value }, null, 2) + eolOf(output), notice: null };
      }
    } catch { /* not JSON — leave stdout alone */ }
    return { output, notice: `${BROWSER_COMMAND}: ${status}` };
  }
  return { output: `${BROWSER_COMMAND}: ${status}\n${output}`, notice: null };
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
