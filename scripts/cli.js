#!/usr/bin/env node

/**
 * scripts/cli.js
 *
 * Unified workspace CLI — interactive command center and direct CLI entry point.
 * Replaces the need to remember individual `node scripts/X.js` invocations.
 *
 * Usage:
 *   node scripts/cli.js                     Interactive main menu
 *   node scripts/cli.js help                Show all commands
 *   node scripts/cli.js setup               Interactive setup wizard
 *   node scripts/cli.js setup --all         Non-interactive full setup
 *   node scripts/cli.js setup --components  Run selected components
 *   node scripts/cli.js <command> [flags]   Run a command directly
 *
 * Note: scripts/setup-orchestrator.js has been removed.
 *       Use `node scripts/cli.js setup` instead.
 */

'use strict';

const path     = require('path');
const fs       = require('fs');
const readline = require('readline');
const { spawnSync, spawn } = require('child_process');

// ─── Constants ────────────────────────────────────────────────────────────────

const WORKSPACE_ROOT   = path.resolve(__dirname, '..');
const SCRIPTS_DIR      = __dirname;
const MCP_SERVER_DIR   = path.join(WORKSPACE_ROOT, 'mcp-server');
const PERSONAS_DIR     = path.join(WORKSPACE_ROOT, 'personas');
const ORCHESTRATOR_DIR = path.join(WORKSPACE_ROOT, 'orchestrator');
const CHANGELOG_FILE   = path.join(WORKSPACE_ROOT, 'changelog.md');
const MCP_DIST_JSON    = path.join(WORKSPACE_ROOT, '.mcp.dist.json');
const MCP_JSON         = path.join(WORKSPACE_ROOT, '.mcp.json');
const IS_WIN           = process.platform === 'win32';
const NPM              = IS_WIN ? 'npm.cmd' : 'npm';

// ─── ANSI color helpers ───────────────────────────────────────────────────────

const C = {
  reset:       (s) => `\x1b[0m${s}\x1b[0m`,
  bold:        (s) => `\x1b[1m${s}\x1b[0m`,
  dim:         (s) => `\x1b[2m${s}\x1b[0m`,
  red:         (s) => `\x1b[31m${s}\x1b[0m`,
  green:       (s) => `\x1b[32m${s}\x1b[0m`,
  yellow:      (s) => `\x1b[33m${s}\x1b[0m`,
  cyan:        (s) => `\x1b[36m${s}\x1b[0m`,
  white:       (s) => `\x1b[37m${s}\x1b[0m`,
  brightWhite: (s) => `\x1b[97m${s}\x1b[0m`,
  brightCyan:  (s) => `\x1b[96m${s}\x1b[0m`,
};

// ─── Logging ──────────────────────────────────────────────────────────────────

function log(msg, color) {
  console.log(color && C[color] ? C[color](msg) : msg);
}

// ─── Pre-flight checks ────────────────────────────────────────────────────────

function checkNodeVersion() {
  const major = parseInt(process.versions.node.split('.')[0], 10);
  if (major < 18) {
    log(`✗ Node.js >= 18 required (found ${process.versions.node})`, 'red');
    process.exit(1);
  }
}

function checkWorkspaceRoot() {
  if (!fs.existsSync(MCP_SERVER_DIR)) {
    log('✗ Run from the workspace root (mcp-server/ not found)', 'red');
    process.exit(1);
  }
}

// ─── Version string helper ────────────────────────────────────────────────────

function readVersion() {
  try {
    // Matches `## v1.2.3` and `## [1.2.3]` style headings.
    // Verified against changelog.md format `## v{semver} - {title}` — 2026-03-04.
    const m = fs.readFileSync(CHANGELOG_FILE, 'utf8').match(/^##\s+(?:\[|v)?(\d+\.\d+\.\d+)/m);
    return m ? `v${m[1]}` : 'unknown';
  } catch { return 'unknown'; }
}

function readSubVersion(subDir) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(subDir, 'package.json'), 'utf8'));
    return pkg.version ? `v${pkg.version}` : 'unknown';
  } catch { return 'unknown'; }
}

// ─── Script runners ───────────────────────────────────────────────────────────

/**
 * Run a script synchronously; exit on failure.
 * Used for direct delegating commands (sync-personas, build-personas, etc.).
 */
function runScript(scriptName, args = []) {
  const result = spawnSync('node', [path.join(SCRIPTS_DIR, scriptName), ...args], {
    cwd: WORKSPACE_ROOT,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    log(`\n✗ ${scriptName} exited with code ${result.status}`, 'red');
    process.exit(result.status ?? 1);
  }
}

/**
 * Run a long-running script asynchronously (gui, orchestrator).
 * Forwards SIGINT to child; exits when child exits.
 */
function runLongScript(scriptName, args = []) {
  const child = spawn('node', [path.join(SCRIPTS_DIR, scriptName), ...args], {
    cwd: WORKSPACE_ROOT,
    stdio: 'inherit',
  });
  child.on('error', (err) => {
    log(`✗ Failed to launch ${scriptName}: ${err.message}`, 'red');
    process.exit(1);
  });
  process.on('SIGINT', () => child.kill('SIGINT'));
  child.on('exit', (code) => process.exit(code ?? 0));
}

/**
 * Run a command, returning the exit code.
 * Used inside setup components — does NOT exit on failure.
 *
 * On Windows, .cmd files (npm.cmd, pip.cmd) require shell:true in Node 22+
 * to avoid EINVAL from spawnSync. We default shell to IS_WIN; callers can
 * override via opts if needed.
 */
function sh(cmd, args = [], opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: WORKSPACE_ROOT, shell: IS_WIN, ...opts });
  return r.status ?? 1;
}

// ─── Python finder (for orchestrator setup) ───────────────────────────────────

function findPython() {
  const candidates = IS_WIN ? ['python', 'python3', 'py'] : ['python3', 'python'];
  for (const cand of candidates) {
    const a = cand === 'py' ? ['-3', '--version'] : ['--version'];
    // python, python3, py are .exe on Windows — no shell wrapper needed
    const r = spawnSync(cand, a, { encoding: 'utf8', shell: false });
    if (r.status !== 0) continue;
    const raw = (r.stdout || '') + (r.stderr || '');
    const m = raw.match(/Python (\d+)\.(\d+)/);
    if (!m) continue;
    if (parseInt(m[1], 10) === 3 && parseInt(m[2], 10) >= 11) return cand;
  }
  return null;
}

function syncOrchestratorVersion() {
  const changelogPath = path.join(ORCHESTRATOR_DIR, 'changelog.md');
  const pyprojectPath = path.join(ORCHESTRATOR_DIR, 'pyproject.toml');

  if (!fs.existsSync(changelogPath)) {
    log('  ✗ orchestrator/changelog.md not found', 'red');
    return;
  }
  if (!fs.existsSync(pyprojectPath)) {
    log('  ✗ orchestrator/pyproject.toml not found', 'red');
    return;
  }

  try {
    const changelog = fs.readFileSync(changelogPath, 'utf8');
    // Match ## v1.2.3 or ## [1.2.3]
    const versionMatch = changelog.match(/^##\s+(?:\[|v)?(\d+\.\d+\.\d+)/m);
    
    if (!versionMatch) {
      // It's possible the changelog hasn't been started or format differs
      log('  ⚠ Could not find version in orchestrator/changelog.md', 'yellow');
      return;
    }

    const newVersion = versionMatch[1];
    let pyproject = fs.readFileSync(pyprojectPath, 'utf8');

    // Simple regex for top-level version = "..."
    const versionRegex = /^version\s*=\s*"[^"]+"/m;
    if (!versionRegex.test(pyproject)) {
      log('  ⚠ Could not find "version" key in pyproject.toml', 'yellow');
      return;
    }

    const newContent = pyproject.replace(versionRegex, `version = "${newVersion}"`);
    
    // Only write if changed
    if (newContent !== pyproject) {
      fs.writeFileSync(pyprojectPath, newContent, 'utf8');
      log(`  ✓ Updated orchestrator/pyproject.toml to ${newVersion}`, 'green');
    } else {
      log(`  ✓ orchestrator/pyproject.toml already at ${newVersion}`, 'green');
    }
  } catch (e) {
    log(`  ✗ Failed to sync orchestrator version: ${e.message}`, 'red');
  }
}

function venvBin(name) {
  return IS_WIN
    ? path.join(ORCHESTRATOR_DIR, '.venv', 'Scripts', `${name}.exe`)
    : path.join(ORCHESTRATOR_DIR, '.venv', 'bin', name);
}

// ─── .mcp.json scaffold ───────────────────────────────────────────────────────

/**
 * Scaffold .mcp.json from .mcp.dist.json, replacing the placeholder path
 * with the real absolute path to mcp-server/src/index.ts.
 *
 * Returns true if the file was written or already exists (satisfied).
 * Returns false only on hard error (e.g. missing .mcp.dist.json).
 */
function scaffoldMcpJson(force = false) {
  if (fs.existsSync(MCP_JSON) && !force) {
    log('  .mcp.json already exists. Use --force to overwrite.', 'yellow');
    return true; // already satisfied
  }
  if (!fs.existsSync(MCP_DIST_JSON)) {
    log('  ✗ .mcp.dist.json not found; cannot scaffold .mcp.json', 'red');
    return false;
  }
  let template;
  try {
    template = JSON.parse(fs.readFileSync(MCP_DIST_JSON, 'utf8'));
  } catch (e) {
    log(`  ✗ Failed to parse .mcp.dist.json: ${e.message}`, 'red');
    return false;
  }

  const indexTs     = path.join(MCP_SERVER_DIR, 'src', 'index.ts');
  const PLACEHOLDER = '/Users/path/to/repo/ai-insights/mcp-server/src/index.ts';

  // Walk every string value in the parsed JSON and replace the placeholder
  function replaceInObj(obj) {
    if (typeof obj === 'string')  return obj === PLACEHOLDER ? indexTs : obj;
    if (Array.isArray(obj))       return obj.map(replaceInObj);
    if (obj && typeof obj === 'object') {
      const out = {};
      for (const k of Object.keys(obj)) out[k] = replaceInObj(obj[k]);
      return out;
    }
    return obj;
  }

  fs.writeFileSync(MCP_JSON, JSON.stringify(replaceInObj(template), null, 2) + '\n', 'utf8');
  log(`  ✓ .mcp.json written → ${indexTs}`, 'green');
  return true;
}

// ─── Setup components ─────────────────────────────────────────────────────────

const SETUP_COMPONENTS = [
  {
    id:    'mcp-server',
    label: 'MCP Server',
    desc:  'npm install + build',
    detect() {
      return (
        fs.existsSync(path.join(MCP_SERVER_DIR, 'node_modules')) &&
        fs.existsSync(path.join(MCP_SERVER_DIR, 'dist'))
      );
    },
    run() {
      log('  Installing MCP server dependencies…', 'dim');
      if (sh(NPM, ['install'], { cwd: MCP_SERVER_DIR }) !== 0) return false;
      log('  Building MCP server…', 'dim');
      if (sh(NPM, ['run', 'build'], { cwd: MCP_SERVER_DIR }) !== 0) return false;
      return true;
    },
    validate: () => fs.existsSync(path.join(MCP_SERVER_DIR, 'dist', 'index.js')),
  },
  {
    id:    'personas',
    label: 'Personas',
    desc:  'npm install + build + sync to IDE',
    detect: () => fs.existsSync(path.join(PERSONAS_DIR, 'node_modules')),
    run() {
      log('  Installing personas dependencies…', 'dim');
      if (sh(NPM, ['install'], { cwd: PERSONAS_DIR }) !== 0) return false;
      log('  Syncing personas to IDE…', 'dim');
      const r = spawnSync('node', [path.join(SCRIPTS_DIR, 'sync-personas.js')], {
        cwd: WORKSPACE_ROOT,
        stdio: 'inherit',
      });
      return (r.status ?? 1) === 0;
    },
    validate() {
      try {
        const dir = path.join(PERSONAS_DIR, 'ledger', 'vs-code');
        return fs.readdirSync(dir).some((f) => f.endsWith('.md'));
      } catch { return false; }
    },
  },
  {
    id:    'orchestrator',
    label: 'Orchestrator',
    desc:  'Python venv + pip install',
    detect: () => fs.existsSync(path.join(ORCHESTRATOR_DIR, '.venv')),
    run(args = []) {
      // Parse orchestrator-specific flags forwarded through args
      const pIdx  = args.indexOf('--provider');
      const prov  = (pIdx !== -1 && args[pIdx + 1]) ? args[pIdx + 1] : 'anthropic';
      const dev   = args.includes('--dev');
      const ckpt  = args.includes('--checkpoint');
      const force = args.includes('--force');
      const VENV  = path.join(ORCHESTRATOR_DIR, '.venv');

      const pyBin = findPython();
      if (!pyBin) {
        log('  ✗ Python 3.11+ not found. Install from https://python.org', 'red');
        return false;
      }

      if (fs.existsSync(VENV) && force) {
        log('  --force: removing existing .venv…', 'dim');
        fs.rmSync(VENV, { recursive: true, force: true });
      }
      if (!fs.existsSync(VENV)) {
        log('  Creating virtual environment…', 'dim');
        const vArgs = pyBin === 'py' ? ['-3', '-m', 'venv', VENV] : ['-m', 'venv', VENV];
        if (sh(pyBin, vArgs) !== 0) return false;
      } else {
        log('  .venv exists — skipping creation (use --force to recreate)', 'dim');
      }

      log('  Upgrading pip…', 'dim');
      if (sh(venvBin('python'), ['-m', 'pip', 'install', '--quiet', '--upgrade', 'pip']) !== 0) {
        return false;
      }

      const extras = [prov, ...(dev ? ['dev'] : []), ...(ckpt ? ['checkpoint'] : [])];
      const target = `.[${extras.join(',')}]`;
      log(`  Installing ${target}…`, 'dim');
      if (sh(venvBin('pip'), ['install', '--quiet', '-e', target], { cwd: ORCHESTRATOR_DIR }) !== 0) {
        return false;
      }

      // Scaffold .env if missing
      const envFile = path.join(ORCHESTRATOR_DIR, '.env');
      const envEx   = path.join(ORCHESTRATOR_DIR, '.env.example');
      if (!fs.existsSync(envFile) || force) {
        if (fs.existsSync(envEx)) {
          fs.copyFileSync(envEx, envFile);
          log('  ✓ orchestrator/.env created from .env.example', 'green');
        } else {
          fs.writeFileSync(envFile, `PROVIDER=${prov}\n`, 'utf8');
          log('  ✓ orchestrator/.env scaffolded with defaults', 'green');
        }
      } else {
        log('  orchestrator/.env already exists (use --force to overwrite)', 'dim');
      }

      return true;
    },
    validate: () => fs.existsSync(venvBin('python')),
  },
  {
    id:    'mcp-json',
    label: '.mcp.json',
    desc:  'IDE MCP server config',
    detect: () => fs.existsSync(MCP_JSON),
    run:      (args = []) => scaffoldMcpJson(args.includes('--force')),
    validate() {
      if (!fs.existsSync(MCP_JSON)) return false;
      try { JSON.parse(fs.readFileSync(MCP_JSON, 'utf8')); return true; } catch { return false; }
    },
  },
  {
    id:    'git-hooks',
    label: 'Git hooks',
    desc:  'Pre-commit persona guard',
    detect() {
      const r = spawnSync('git', ['config', 'core.hooksPath'], { encoding: 'utf8' });
      return r.status === 0 && r.stdout.trim() === '.githooks';
    },
    run: () => sh('node', [path.join(SCRIPTS_DIR, 'install-hooks.js')]) === 0,
    validate() {
      const r = spawnSync('git', ['config', 'core.hooksPath'], { encoding: 'utf8' });
      return r.status === 0 && r.stdout.trim() === '.githooks';
    },
  },
];

// ─── Delegating command functions ─────────────────────────────────────────────

function cmdSyncPersonas(args)    { runScript('sync-personas.js', args); }
function cmdBuildPersonas(args)   { runScript('build-personas.js', args); }
function cmdPackagePersonas(args) { runScript('package-personas.js', args); }
function cmdGui(args)             { runLongScript('run-gui.js', args); }
function cmdBuildMaintain(args) {
  // 1. Sync MCP server version (existing behavior)
  runScript(path.join('..', 'mcp-server', 'scripts', 'sync-version.js'), args);

  // 2. Sync Orchestrator version (new behavior)
  syncOrchestratorVersion();

  // 3. Build Personas (all suites: ledger + standalone)
  const buildArgs = args.includes('--suite') ? args : ['--suite', 'all', ...args];
  runScript('build-personas.js', buildArgs);

  // 4. Check role parity (persona ↔ MCP server roles)
  runScript('check-known-roles.js');
}
function cmdOrchestrator(args)    { runLongScript('run-orchestrator.js', args); }
function cmdCheckRoles()          { runScript('check-known-roles.js'); }
function cmdBundleDocs(args)      { runScript('bundle-docs.js', args); }
function cmdCtxGenerate(args) {
  const ctxDir = path.join(WORKSPACE_ROOT, '.context');
  if (fs.existsSync(ctxDir)) {
    fs.rmSync(ctxDir, { recursive: true, force: true });
    log('Cleaned .context/', 'dim');
  }
  const result = spawnSync('ctx', ['generate', ...args], {
    cwd: WORKSPACE_ROOT,
    stdio: 'inherit',
    shell: true,
  });
  if (result.status !== 0) {
    log('\n\u2717 ctx generate exited with code ' + (result.status ?? 1), 'red');
    process.exit(result.status ?? 1);
  }
  fs.writeFileSync(
    path.join(ctxDir, 'generated-at.txt'),
    new Date().toISOString() + '\n',
  );
}
function cmdMcpJson(args)         { scaffoldMcpJson(args.includes('--force')); }
function cmdGitHooks()            { sh('node', [path.join(SCRIPTS_DIR, 'install-hooks.js')]); }

// ─── Command registry ─────────────────────────────────────────────────────────

// forward-declares runSetup (defined below) — hoisting is fine for functions
const COMMANDS = [
  {
    id:          'setup',
    key:         's',
    label:       'First-time setup',
    category:    'Setup & Configuration',
    description: 'Full workspace setup wizard',
    run:         (args) => runSetup(args),
  },
  {
    id:          'mcp-json',
    key:         'm',
    label:       'Scaffold .mcp.json',
    category:    'Setup & Configuration',
    description: 'Generate IDE MCP config',
    run:         cmdMcpJson,
  },
  {
    id:          'git-hooks',
    key:         'o',
    label:       'Install git hooks',
    category:    'Setup & Configuration',
    description: 'Pre-commit persona guard',
    run:         cmdGitHooks,
  },
  {
    id:          'sync-personas',
    key:         'p',
    label:       'Sync personas',
    category:    'Personas',
    description: 'Deploy to VS Code & Claude Code',
    run:         cmdSyncPersonas,
  },
  {
    id:          'package-personas',
    key:         'z',
    label:       'Package personas',
    category:    'Personas',
    description: 'ZIP standalone personas',
    run:         cmdPackagePersonas,
  },
  {
    id:          'gui',
    key:         'g',
    label:       'Launch GUI dashboard',
    category:    'MCP Server',
    description: 'Open the ledger GUI in browser',
    run:         cmdGui,
  },
  {
    id:          'build-maintain',
    key:         'b',
    label:       'Build & Maintain',
    category:    'Validation & Utilities',
    description: 'Sync versions, build & validate',
    run:         cmdBuildMaintain,
  },
  {
    id:          'bundle-docs',
    key:         'd',
    label:       'Bundle docs',
    category:    'Validation & Utilities',
    description: 'Compile doc bundles',
    run:         cmdBundleDocs,
  },
  {
    id:          'ctx-generate',
    key:         'c',
    label:       'CTX generate',
    category:    'Validation & Utilities',
    description: 'Generate context documentation',
    run:         cmdCtxGenerate,
  },
];

// ─── Help ─────────────────────────────────────────────────────────────────────

function printHelp() {
  const ver = readVersion();
  console.log(`\nAI Insights CLI — ${ver}\n`);
  console.log('Usage: node scripts/cli.js [command] [options]\n');
  console.log('Commands:');
  const rows = [
    ['setup',                    'Full workspace setup wizard'],
    ['setup --all',              'Non-interactive full setup'],
    ['build-maintain',           'Sync versions & build personas'],
    ['setup --components <ids>', 'Run selected components (e.g. mcp-server,personas)'],
    ['mcp-json',                 'Generate IDE MCP server config'],
    ['mcp-json --force',         'Overwrite existing .mcp.json'],
    ['git-hooks',                'Install git hooks (pre-commit persona guard)'],
    ['sync-personas',            'Deploy to VS Code & Claude Code'],
    ['package-personas',         'ZIP standalone personas'],
    ['gui',                      'Launch MCP GUI dashboard (long-running)'],
    // Note: orchestrator requires --plan <path>; not available in interactive menu
    ['orchestrator',             'Run orchestrator pipeline (requires --plan <path>)'],
    ['bundle-docs',              'Compile doc bundles'],    ['ctx-generate',             'Generate context documentation (ctx generate)'],    ['help',                     'Show this help'],
  ];
  for (const [cmd, desc] of rows) {
    process.stdout.write('  ' + cmd.padEnd(28) + C.dim(desc) + '\n');
  }
  console.log('\nRun without arguments for interactive mode.\n');
}

// ─── Argument parser ──────────────────────────────────────────────────────────

function parseArgs(argv) {
  const [first, ...rest] = argv;
  if (!first || first.startsWith('-')) return { command: null, flags: argv };
  return { command: first, flags: rest };
}

// ─── Setup wizard ─────────────────────────────────────────────────────────────

/**
 * Interactive checkbox menu for setup component selection.
 * Returns a Promise that resolves to an array of component IDs,
 * or null if the user quit without selecting.
 */
function runSetupMenu() {
  const items = SETUP_COMPONENTS.map((c) => ({
    id:      c.id,
    label:   c.label,
    desc:    c.desc,
    checked: true,
    done:    c.detect(),
  }));
  let cursor = 0;

  function render() {
    process.stdout.write('\x1b[2J\x1b[0;0H'); // clear screen + cursor home
    console.log(C.bold('Select components to set up:\n'));
    items.forEach((item, i) => {
      const mark  = i === cursor ? C.cyan('▶') : ' ';
      const box   = item.checked ? C.green('[x]') : '[ ]';
      const num   = `${i + 1}.`.padEnd(3);
      const label = item.label.padEnd(14);
      const desc  = C.dim(item.desc.padEnd(32));
      const done  = item.done ? C.dim(' (done)') : '';
      console.log(`  ${mark} ${box} ${num} ${label} ${desc}${done}`);
    });
    console.log('');
    console.log(C.dim('  (done) = already set up — toggle to re-run'));
    console.log('');
    console.log(
      `  ${C.bold('[a]')} Toggle all   ` +
      `${C.bold('[Enter]')} Run selected   ` +
      `${C.bold('[q]')} Back`
    );
    console.log('  ↑/↓ or j/k move   Space toggles\n');
  }

  return new Promise((resolve) => {
    readline.emitKeypressEvents(process.stdin);
    let rawSet = false;
    try { process.stdin.setRawMode(true); rawSet = true; } catch {}
    process.stdin.resume();
    render();

    function finish(result) {
      process.stdin.removeAllListeners('keypress');
      if (rawSet) try { process.stdin.setRawMode(false); } catch {}
      process.stdin.pause();
      resolve(result);
    }

    process.stdin.on('keypress', (ch, key) => {
      if (!key) return;
      // Ctrl+C
      if ((key.ctrl && key.name === 'c') || key.sequence === '\x03') {
        finish(null);
        return;
      }
      const k = key.name;
      if (k === 'up'   || ch === 'k') { cursor = Math.max(0, cursor - 1);                  render(); return; }
      if (k === 'down' || ch === 'j') { cursor = Math.min(items.length - 1, cursor + 1);   render(); return; }
      if (ch === ' ')  { items[cursor].checked = !items[cursor].checked;                   render(); return; }
      if (ch === 'a')  {
        const allOn = items.every((i) => i.checked);
        items.forEach((i) => { i.checked = !allOn; });
        render();
        return;
      }
      if (k === 'return' || k === 'enter') {
        finish(items.filter((i) => i.checked).map((i) => i.id));
        return;
      }
      if (ch === 'q') { finish(null); return; }
    });
  });
}

/**
 * Entry function for the `setup` command.
 * async so it can await the interactive checkbox menu when needed.
 */
async function runSetup(args) {
  const runAll   = args.includes('--all');
  const compIdx  = args.indexOf('--components');
  const compList = compIdx !== -1
    ? (args[compIdx + 1] || '').split(',').filter(Boolean)
    : null;

  let selectedIds;

  if (runAll) {
    selectedIds = SETUP_COMPONENTS.map((c) => c.id);
  } else if (compList) {
    selectedIds = compList;
  } else if (!process.stdin.isTTY) {
    log('✗ Non-interactive mode requires --all or --components <list>', 'red');
    log('  Example: node scripts/cli.js setup --all', 'dim');
    process.exit(1);
  } else {
    selectedIds = await runSetupMenu();
    if (!selectedIds || selectedIds.length === 0) {
      log('No components selected — aborted.', 'dim');
      return;
    }
  }

  const toRun = SETUP_COMPONENTS.filter((c) => selectedIds.includes(c.id));
  if (toRun.length === 0) {
    log('No matching components. Available: ' + SETUP_COMPONENTS.map((c) => c.id).join(', '), 'yellow');
    return;
  }

  console.log('');

  const results = [];
  for (const comp of toRun) {
    log(`→ ${comp.label}  ${C.dim(comp.desc)}`, 'bold');
    let ok = false;
    try {
      ok = await Promise.resolve(comp.run(args));
    } catch (e) {
      log(`  ✗ ${comp.label} threw: ${e.message}`, 'red');
    }
    if (ok) ok = comp.validate();
    results.push({ comp, ok });
  }

  // Print summary table
  const LINE = '─'.repeat(50);
  console.log('\nSetup Summary');
  console.log(LINE);
  for (const { comp, ok } of results) {
    const icon  = ok ? C.green('✓') : C.red('✗');
    const label = comp.label.padEnd(16);
    const msg   = ok ? C.dim('OK') : C.red('Failed — see output above');
    console.log(`  ${icon}  ${label} ${msg}`);
  }
  console.log(LINE);
  const passed = results.filter((r) => r.ok).length;
  const total  = results.length;
  const color  = passed === total ? 'green' : passed > 0 ? 'yellow' : 'red';
  log(`  ${passed}/${total} components succeeded`, color);
  console.log('');
  if (passed < total) process.exit(1);
}

// ─── Wait-for-key helper ──────────────────────────────────────────────────────

/**
 * Display a prompt and wait for the user to press any key.
 * Used after blocking commands so their output stays visible before the menu
 * re-renders and clears the screen.
 */
function waitForKey(prompt = '\n  Press any key to continue…') {
  return new Promise((resolve) => {
    process.stdout.write(C.dim(prompt));
    readline.emitKeypressEvents(process.stdin);
    let rawSet = false;
    try { process.stdin.setRawMode(true); rawSet = true; } catch {}
    process.stdin.resume();

    function done() {
      process.stdin.removeAllListeners('keypress');
      if (rawSet) try { process.stdin.setRawMode(false); } catch {}
      process.stdin.pause();
      console.log('');
      resolve();
    }

    process.stdin.on('keypress', (ch, key) => {
      if (key && key.ctrl && key.name === 'c') {
        done();
        process.exit(0);
      }
      done();
    });
  });
}

// ─── Interactive main menu ────────────────────────────────────────────────────

const BANNER_LINES = [
  " ",
  " █████╗ ██╗   ██╗███╗   ██╗███████╗██╗ ██████╗ ██╗  ██╗████████╗███████╗",
  "██╔══██╗██║   ██║████╗  ██║██╔════╝██║██╔════╝ ██║  ██║╚══██╔══╝██╔════╝",
  "███████║██║   ██║██╔██╗ ██║███████╗██║██║  ███╗███████║   ██║   ███████╗",
  "██╔══██║██║   ██║██║╚██╗██║╚════██║██║██║   ██║██╔══██║   ██║   ╚════██║",
  "██║  ██║██║   ██║██║ ╚████║███████║██║╚██████╔╝██║  ██║   ██║   ███████║",
  "╚═╝  ╚═╝╚═╝   ╚═╝╚═╝  ╚═══╝╚══════╝╚═╝ ╚═════╝ ╚═╝  ╚═╝   ╚═╝   ╚══════╝",
];

function renderMenu(version) {
  process.stdout.write('\x1b[2J\x1b[0;0H'); // clear screen + cursor home
  console.log(C.cyan(BANNER_LINES.join('\n')));
  console.log(C.dim(`  Workspace CLI  ${version}\n`));

  const catVersions = {
    'MCP Server': readSubVersion(MCP_SERVER_DIR),
    'Personas':   readSubVersion(PERSONAS_DIR),
  };

  // Group commands by category (preserving insertion order)
  const cats = [...new Set(COMMANDS.map((c) => c.category))];
  for (const cat of cats) {
    const subVer = catVersions[cat] ? C.dim(` ${catVersions[cat]}`) : '';
    console.log(C.bold(`  ${cat}`) + subVer);
    for (const cmd of COMMANDS.filter((c) => c.category === cat)) {
      const key   = C.cyan(`${cmd.key}.`);
      const label = cmd.label.padEnd(26);
      const desc  = C.dim(cmd.description);
      console.log(`    ${key} ${label} ${desc}`);
    }
    console.log('');
  }

  console.log(`  ${C.dim('[h] Help   [q] Quit')}\n`);
  process.stdout.write('  Choose: ');
}

/**
 * Show the interactive main menu and handle keypresses.
 * Called on first launch and after each non-long-running command completes.
 */
function showInteractiveMenu() {
  const version = readVersion();
  renderMenu(version);

  readline.emitKeypressEvents(process.stdin);
  let rawSet = false;
  try {
    process.stdin.setRawMode(true);
    rawSet = true;
  } catch {
    log('\n✗ Interactive mode requires a TTY terminal.', 'red');
    log('  Use: node scripts/cli.js help', 'dim');
    process.exit(1);
  }
  process.stdin.resume();

  function restoreTerminal() {
    process.stdin.removeAllListeners('keypress');
    if (rawSet) try { process.stdin.setRawMode(false); } catch {}
    process.stdin.pause();
  }

  process.stdin.on('keypress', async (ch, key) => {
    if (!key) return;
    try {

      // Ctrl+C or 'q' → exit
      if ((key.ctrl && key.name === 'c') || key.sequence === '\x03' || ch === 'q') {
        restoreTerminal();
        console.log('');
        process.exit(0);
      }

      // 'h' → show help, pause for user, then re-render menu
      if (ch === 'h') {
        restoreTerminal();
        console.log('');
        printHelp();
        await waitForKey('\n  Press any key to return to menu…');
        setImmediate(() => showInteractiveMenu());
        return;
      }

      // Check if the keypress matches a command
      const cmd = COMMANDS.find((c) => c.key === ch);
      if (!cmd) {
        renderMenu(version); // unknown key — just re-render
        return;
      }

      // Restore terminal before running any command
      restoreTerminal();
      console.log('');

      const isLong = cmd.id === 'gui' || cmd.id === 'orchestrator';
      if (isLong) {
        // Long-running: runLongScript manages process exit when child exits
        cmd.run([]);
      } else {
        // Blocking command: run it, pause for user, then re-show menu
        try {
          const result = cmd.run([]);
          if (result && typeof result.then === 'function') await result;
        } catch { /* errors are already logged inside command implementations */ }
        await waitForKey('\n  Press any key to return to menu…');
        setImmediate(() => showInteractiveMenu());
      }

    } catch (e) {
      // Safety net: if something unexpected throws, restore terminal and re-show menu
      restoreTerminal();
      console.error('\n' + C.red(`Unexpected error: ${e.message}`));
      setImmediate(() => showInteractiveMenu());
    }
  });
}

// ─── Entry point ──────────────────────────────────────────────────────────────

async function main() {
  checkNodeVersion();
  checkWorkspaceRoot();

  const { command, flags } = parseArgs(process.argv.slice(2));

  if (command === 'help') {
    printHelp();
    process.exit(0);
  }

  if (command !== null) {
    const cmd = COMMANDS.find((c) => c.id === command);
    if (!cmd) {
      log(`\n✗ Unknown command: "${command}"`, 'red');
      log('  Run `node scripts/cli.js help` for a list of commands.', 'dim');
      process.exit(1);
    }
    const result = cmd.run(flags);
    if (result && typeof result.then === 'function') await result;
    return;
  }

  // No command provided
  if (!process.stdin.isTTY) {
    log('Usage: node scripts/cli.js [command]', 'dim');
    log('Run `node scripts/cli.js help` for a list of commands.', 'dim');
    process.exit(1);
  }

  showInteractiveMenu();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
