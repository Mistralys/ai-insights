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
const { getPublishLocations } = require('./publish-locations');

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

function readPyprojectVersion(subDir) {
  try {
    const content = fs.readFileSync(path.join(subDir, 'pyproject.toml'), 'utf8');
    const m = content.match(/^version\s*=\s*"([^"]+)"/m);
    return m ? `v${m[1]}` : 'unknown';
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

  const PLACEHOLDER_BASE = '/Users/path/to/repo/ai-insights/mcp-server';

  // Walk every string value in the parsed JSON and replace the placeholder
  // base path with the real MCP_SERVER_DIR
  function replaceInObj(obj) {
    if (typeof obj === 'string')  return obj.replaceAll(PLACEHOLDER_BASE, MCP_SERVER_DIR);
    if (Array.isArray(obj))       return obj.map(replaceInObj);
    if (obj && typeof obj === 'object') {
      const out = {};
      for (const k of Object.keys(obj)) out[k] = replaceInObj(obj[k]);
      return out;
    }
    return obj;
  }

  fs.writeFileSync(MCP_JSON, JSON.stringify(replaceInObj(template), null, 2) + '\n', 'utf8');
  log(`  ✓ .mcp.json written → ${MCP_SERVER_DIR}`, 'green');
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

      // Remove any partial .dist-info dirs left by interrupted pip installs.
      // pip writes them with a leading '~' and renames on success; leftover
      // tilde-prefixed entries cause "Ignoring invalid distribution" warnings.
      const sitePkgsCandidates = [
        path.join(VENV, 'Lib', 'site-packages'),                  // Windows
        ...(() => { try { return fs.readdirSync(path.join(VENV, 'lib')).map(d => path.join(VENV, 'lib', d, 'site-packages')); } catch { return []; } })(),
      ];
      for (const sp of sitePkgsCandidates) {
        if (!fs.existsSync(sp)) continue;
        for (const entry of fs.readdirSync(sp, { withFileTypes: true })) {
          if (entry.isDirectory() && entry.name.startsWith('~') && entry.name.endsWith('.dist-info')) {
            fs.rmSync(path.join(sp, entry.name), { recursive: true, force: true });
            log(`  Removed partial dist-info: ${entry.name}`, 'dim');
          }
        }
      }

      log('  Upgrading pip…', 'dim');
      if (sh(venvBin('python'), ['-m', 'pip', 'install', '--quiet', '--upgrade', 'pip']) !== 0) {
        return false;
      }

      // Always include 'dev' so ruff (used by the pre-commit hook) is available
      const extras = [prov, 'dev', ...(ckpt ? ['checkpoint'] : [])];
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

/**
 * Clean persona files from all publish locations (VS Code, Claude Code agents,
 * Claude Code skills). Lists files per target and deletes after confirmation.
 * Supports --force to skip the confirmation prompt.
 */
async function cmdCleanAgents(args) {
  const force = args.includes('--force');

  const allTargets = getPublishLocations();

  // Collect files per target
  for (const target of allTargets) {
    if (fs.existsSync(target.dir)) {
      target.files = fs.readdirSync(target.dir).filter(target.filter);
    } else {
      target.files = [];
    }
  }

  const nonEmpty = allTargets.filter(t => t.files.length > 0);

  if (nonEmpty.length === 0) {
    log('\n  No persona files found in any publish location.', 'green');
    for (const target of allTargets) {
      log(C.dim(`    ${target.label}: ${target.dir}`));
    }
    return;
  }

  // ── Location selection (interactive only) ───────────────────────────────
  let targets;
  if (force) {
    targets = nonEmpty;
  } else {
    console.log('');
    log('  Select locations to clean:\n');
    for (let i = 0; i < allTargets.length; i++) {
      const t = allTargets[i];
      const num = C.bold(`  [${i + 1}]`);
      if (t.files.length === 0) {
        log(`${num} ${C.dim(t.label + ' (empty)')}`);
      } else {
        log(`${num} ${t.label} ${C.dim(`(${t.files.length} file${t.files.length === 1 ? '' : 's'})`)}`);
      }
    }
    log(C.dim(`\n  Enter numbers separated by commas, or ${C.bold('a')} for all.`));

    const answer = await askCleanInput('  Selection: ');
    const trimmed = answer.trim().toLowerCase();

    if (!trimmed) {
      log(C.dim('  Cancelled — no files deleted.'));
      return;
    }

    if (trimmed === 'a') {
      targets = nonEmpty;
    } else {
      const indices = trimmed.split(',')
        .map(s => parseInt(s.trim(), 10))
        .filter(n => !isNaN(n) && n >= 1 && n <= allTargets.length);

      if (indices.length === 0) {
        log('  Invalid selection — no files deleted.', 'red');
        return;
      }

      targets = indices
        .map(i => allTargets[i - 1])
        .filter(t => t.files.length > 0);

      if (targets.length === 0) {
        log('\n  Selected locations are all empty — nothing to delete.', 'green');
        return;
      }
    }
  }

  // ── Display files per selected target ───────────────────────────────────
  let totalFiles = 0;
  console.log('');
  for (const target of targets) {
    totalFiles += target.files.length;
    log(`  ${C.bold(target.label)} ${C.dim('— ' + target.dir)}`);
    log(`  ${target.files.length} file${target.files.length === 1 ? '' : 's'}:`);
    for (const file of target.files) {
      log(`    ${C.yellow('•')} ${file}`);
    }
    console.log('');
  }

  if (!force) {
    const activeCount = targets.filter(t => t.files.length > 0).length;
    const answer = await askCleanInput(
      `  Delete all ${totalFiles} file${totalFiles === 1 ? '' : 's'} across ${activeCount} location${activeCount === 1 ? '' : 's'}? [y/N] `,
    );
    if (answer.trim().toLowerCase() !== 'y') {
      log(C.dim('  Cancelled — no files deleted.'));
      return;
    }
  }

  let deleted = 0;
  for (const target of targets) {
    for (const file of target.files) {
      try {
        fs.unlinkSync(path.join(target.dir, file));
        deleted++;
      } catch (err) {
        log(`  ✗ Failed to delete ${file}: ${err.message}`, 'red');
      }
    }
  }

  log(`\n  ${C.green('✓')} Deleted ${deleted} file${deleted === 1 ? '' : 's'} across all publish locations.`);
}

/**
 * Prompt the user for text input.
 * @param {string} question
 * @returns {Promise<string>}
 */
function askCleanInput(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}
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

  // 5. Regenerate CTX context documentation
  cmdCtxGenerate(args);
}
function cmdOrchestrator(args)    { runLongScript('run-orchestrator.js', args); }
function cmdPreflight(args)       { runScript('preflight-orchestrator.js', args); }
function cmdPreviewPrompts(args) {
  const result = spawnSync(venvBin('python'), [path.join(SCRIPTS_DIR, 'preview-prompts.py'), ...args], {
    cwd: WORKSPACE_ROOT,
    stdio: 'inherit',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
function cmdCheckRoles()          { runScript('check-known-roles.js'); }
function cmdCheckVersions()       { runScript('check-version-sync.js'); }
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
    shell: IS_WIN,
  });
  if (result.status !== 0) {
    log('\n\u2717 ctx generate exited with code ' + (result.status ?? 1), 'red');
    process.exit(result.status ?? 1);
  }
  // Normalize Windows backslash paths to forward slashes for cross-platform consistency
  sh('node', [path.join(SCRIPTS_DIR, 'normalize-ctx-paths.js'), ctxDir]);

  fs.writeFileSync(
    path.join(ctxDir, 'generated-at.txt'),
    new Date().toISOString() + '\n',
  );

  // Copy AGENTS.md content into CLAUDE.md so IDEs that only read CLAUDE.md
  // always get the latest agent instructions without a manual sync step.
  const agentsMd = path.join(WORKSPACE_ROOT, 'AGENTS.md');
  const claudeMd = path.join(WORKSPACE_ROOT, 'CLAUDE.md');
  if (fs.existsSync(agentsMd)) {
    const agentsContent = fs.readFileSync(agentsMd, 'utf8');
    const header = '<!-- NOTE: This file is generated automatically from AGENTS.md whenever CTX documents are updated -->\n\n';
    fs.writeFileSync(claudeMd, header + agentsContent, 'utf8');
    log('Synced AGENTS.md → CLAUDE.md', 'dim');
  } else {
    log('\u26a0 AGENTS.md not found — CLAUDE.md not updated', 'yellow');
  }
}
function cmdMcpJson(args)         { scaffoldMcpJson(args.includes('--force')); }
function cmdGitHooks()            { sh('node', [path.join(SCRIPTS_DIR, 'install-hooks.js')]); }
function cmdReadLog(args)          { runScript('read-log.js', args); }
function cmdKillOrchestrator(args) { runScript('kill-orchestrator.js', args); }

// ─── Command registry ─────────────────────────────────────────────────────────

// forward-declares runSetup (defined below) — hoisting is fine for functions
//
// COMMANDS entry shape (all fields except id, key, label, category, description, run are optional):
//   helpVariants:    [commandString, description][] — sub-rows rendered in printHelp()
//                    immediately after the base command row. Never shown in the menu.
//   hidden:          boolean — omits the command from the interactive menu;
//                    command still dispatches via CLI and appears in printHelp().
//   helpHidden:      boolean — omits the command from printHelp() output;
//                    command still dispatches via CLI and appears in the menu (key required).
//                    Composable with hidden: a command can carry both flags.
//   interleaveAfter: { command: string, variant: number } — instructs printHelp() to
//                    render this command after the specified parent's helpVariant at that
//                    index. The command is excluded from its normal insertion-order position.
//                    Note: command must match an existing COMMANDS id — no runtime validation.
const COMMANDS = [
  {
    id:           'setup',
    key:          's',
    label:        'First-time setup',
    category:     'Setup & Configuration',
    description:  'Full workspace setup wizard',
    helpVariants: [
      ['setup --all',              'Non-interactive full setup'],
      ['setup --components <ids>', 'Run selected components (e.g. mcp-server,personas)'],
    ],
    run:          (args) => runSetup(args),
  },
  {
    id:             'build-maintain',
    key:            'b',
    label:          'Build & Maintain',
    category:       'Validation & Utilities',
    description:    'Sync versions, build personas & CTX generate',
    // In printHelp(), render this command after setup's first helpVariant (setup --all)
    // to reproduce the original canonical help output order.
    interleaveAfter: { command: 'setup', variant: 0 },
    run:            cmdBuildMaintain,
  },
  {
    id:           'mcp-json',
    key:          'm',
    label:        'Scaffold .mcp.json',
    category:     'Setup & Configuration',
    description:  'Generate IDE MCP server config',
    helpVariants: [
      ['mcp-json --force', 'Overwrite existing .mcp.json'],
    ],
    run:          cmdMcpJson,
  },
  {
    id:          'git-hooks',
    key:         'o',
    label:       'Install git hooks',
    category:    'Setup & Configuration',
    description: 'Install git hooks (pre-commit build & version guards)',
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
    id:           'clean-agents',
    key:          'c',
    label:        'Clean agent folder',
    category:     'Personas',
    description:  'Delete persona files from all publish locations',
    helpVariants: [
      ['clean-agents --force', 'Delete without confirmation (agent use)'],
    ],
    run:          cmdCleanAgents,
  },
  {
    id:          'gui',
    key:         'g',
    label:       'Launch GUI dashboard',
    category:    'MCP Server',
    description: 'Launch MCP GUI dashboard (long-running)',
    run:         cmdGui,
  },
  {
    id:           'preflight',
    key:          'f',
    label:        'Pre-flight checks',
    category:     'Orchestrator',
    description:  'Pre-flight checks for orchestrator readiness',
    helpVariants: [
      ['preflight --plan <path>', 'Also verify plan file exists'],
    ],
    run:          cmdPreflight,
  },
  {
    id:           'preview-prompts',
    key:          'r',
    label:        'Preview stage prompts',
    category:     'Orchestrator',
    description:  'Render prompts for reviewing',
    helpVariants: [
      ['preview-prompts --stage <name>', 'Preview a single stage only'],
      ['preview-prompts --list',         'List available stage names'],
    ],
    run:          cmdPreviewPrompts,
  },
  {
    id:          'orchestrator',
    key:         null,
    label:       'Run orchestrator',
    category:    'Orchestrator',
    description: 'Run orchestrator pipeline (requires --plan <path>)',
    hidden:      true,
    run:         cmdOrchestrator,
  },
  {
    id:           'read-log',
    key:          null,
    label:        'Read orchestrator log',
    category:     'Orchestrator',
    description:  'Query & filter JSONL run logs',
    helpVariants: [
      ['read-log --summary', 'One-line run overview with token totals'],
    ],
    hidden:       true,
    helpHidden:   true,
    run:          cmdReadLog,
  },
  {
    id:           'kill-orchestrator',
    key:          'k',
    label:        'Kill stale processes',
    category:     'Orchestrator',
    description:  'Find & terminate stale orchestrator processes',
    helpVariants: [
      ['kill-orchestrator --force', 'Kill without confirmation (agent use)'],
    ],
    // Not shown in printHelp() — was absent from original help output
    helpHidden:   true,
    run:          cmdKillOrchestrator,
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
    key:         null,
    label:       'CTX generate',
    category:    'Validation & Utilities',
    description: 'Generate context documentation (ctx generate)',
    hidden:      true,
    run:         cmdCtxGenerate,
  },
  {
    id:          'check-versions',
    key:         null,
    label:       'Check version sync',
    category:    'Validation & Utilities',
    description: 'Verify changelog vs manifest versions',
    hidden:      true,
    run:         cmdCheckVersions,
  },
];

// ─── Help ─────────────────────────────────────────────────────────────────────

function printHelp() {
  const ver = readVersion();
  console.log(`\nAI Insights CLI — ${ver}\n`);
  console.log('Usage: node scripts/cli.js [command] [options]\n');
  console.log('Commands:');

  // Build a map of commands that should be interleaved inside another command's
  // helpVariants block. Key: "<parentId>:<variantIndex>" (insert AFTER that variant).
  const interleaveMap = new Map();
  const interleavedIds = new Set();
  for (const cmd of COMMANDS) {
    if (cmd.interleaveAfter) {
      const key = `${cmd.interleaveAfter.command}:${cmd.interleaveAfter.variant}`;
      if (!interleaveMap.has(key)) interleaveMap.set(key, []);
      interleaveMap.get(key).push(cmd);
      interleavedIds.add(cmd.id);
    }
  }

  for (const cmd of COMMANDS) {
    if (cmd.helpHidden) continue;         // explicitly excluded from help
    if (interleavedIds.has(cmd.id)) continue; // rendered inline via interleaveAfter

    process.stdout.write('  ' + cmd.id.padEnd(28) + C.dim(cmd.description) + '\n');
    if (cmd.helpVariants) {
      for (let i = 0; i < cmd.helpVariants.length; i++) {
        const [variant, desc] = cmd.helpVariants[i];
        process.stdout.write('  ' + variant.padEnd(28) + C.dim(desc) + '\n');
        // After each variant, inject any interleaved commands registered for this position.
        const key = `${cmd.id}:${i}`;
        if (interleaveMap.has(key)) {
          for (const other of interleaveMap.get(key)) {
            process.stdout.write('  ' + other.id.padEnd(28) + C.dim(other.description) + '\n');
            if (other.helpVariants) {
              for (const [v, d] of other.helpVariants) {
                process.stdout.write('  ' + v.padEnd(28) + C.dim(d) + '\n');
              }
            }
          }
        }
      }
    }
  }
  process.stdout.write('  ' + 'help'.padEnd(28) + C.dim('Show this help') + '\n');
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
    'MCP Server':   readSubVersion(MCP_SERVER_DIR),
    'Personas':     readSubVersion(PERSONAS_DIR),
    'Orchestrator': readPyprojectVersion(ORCHESTRATOR_DIR),
  };

  // Group commands by category (preserving insertion order)
  const cats = [...new Set(COMMANDS.map((c) => c.category))];
  for (const cat of cats) {
    const subVer = catVersions[cat] ? C.dim(` ${catVersions[cat]}`) : '';
    console.log(C.bold(`  ${cat}`) + subVer);
    for (const cmd of COMMANDS.filter((c) => c.category === cat && !c.hidden)) {
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
