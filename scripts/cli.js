#!/usr/bin/env node

/**
 * scripts/cli.js
 *
 * Unified workspace CLI -- interactive command center and direct CLI entry point.
 *
 * Usage:
 *   node scripts/cli.js                     Interactive main menu
 *   node scripts/cli.js help                Show all commands
 *   node scripts/cli.js setup               Interactive setup wizard
 *   node scripts/cli.js setup --all         Non-interactive full setup
 *   node scripts/cli.js setup --components  Run selected components
 *   node scripts/cli.js --skip-setup-check  Skip first-run detection (for CI/automated use)
 *   node scripts/cli.js <command> [flags]   Run a command directly
 */

import {
  createMenu,
  C,
  log,
  IS_WIN,
  NPM,
  sh,
  runScript,
  runLongScript,
  checkNodeVersion,
  PreflightError,
} from '@mistralys/cli-menu';

import {
  readChangelogVersion,
  readPackageVersion,
  readPyprojectVersion,
} from '@mistralys/cli-menu/changelog';

import path from 'path';
import fs from 'fs';
import readline from 'readline';
import { spawnSync } from 'child_process';
import { getPublishLocations } from './publish-locations.js';
import { install as mcpGlobalInstall, dryRun as mcpGlobalDryRun, shimConfigExists } from './install-mcp-global.js';
import { HEALTH_CHECKS, runChecks } from './lib/health-checks.js';

// --- Constants ---

const WORKSPACE_ROOT   = path.resolve(import.meta.dirname, '..');
const SCRIPTS_DIR      = import.meta.dirname;
const MCP_SERVER_DIR   = path.join(WORKSPACE_ROOT, 'mcp-server');
const PERSONAS_DIR     = path.join(WORKSPACE_ROOT, 'personas');
const ORCHESTRATOR_DIR = path.join(WORKSPACE_ROOT, 'orchestrator');
const CHANGELOG_FILE   = path.join(WORKSPACE_ROOT, 'changelog.md');
const MCP_DIST_JSON    = path.join(WORKSPACE_ROOT, '.mcp.dist.json');
const MCP_JSON         = path.join(WORKSPACE_ROOT, '.mcp.json');

// --- Pre-flight checks ---

function checkWorkspaceRoot() {
  if (!fs.existsSync(MCP_SERVER_DIR)) {
    throw new PreflightError('Run from the workspace root (mcp-server/ not found)');
  }
}

// --- Python finder (for orchestrator setup) ---

function findPython() {
  const candidates = IS_WIN ? ['python', 'python3', 'py'] : ['python3', 'python'];
  for (const cand of candidates) {
    const a = cand === 'py' ? ['-3', '--version'] : ['--version'];
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
    log('  ✗ orchestrator/changelog.md not found');
    return;
  }
  if (!fs.existsSync(pyprojectPath)) {
    log('  ✗ orchestrator/pyproject.toml not found');
    return;
  }

  try {
    const changelog = fs.readFileSync(changelogPath, 'utf8');
    const versionMatch = changelog.match(/^##\s+(?:\[|v)?(\d+\.\d+\.\d+)/m);

    if (!versionMatch) {
      log('  ⚠ Could not find version in orchestrator/changelog.md');
      return;
    }

    const newVersion = versionMatch[1];
    let pyproject = fs.readFileSync(pyprojectPath, 'utf8');

    const versionRegex = /^version\s*=\s*"[^"]+"/m;
    if (!versionRegex.test(pyproject)) {
      log('  ⚠ Could not find "version" key in pyproject.toml');
      return;
    }

    const newContent = pyproject.replace(versionRegex, `version = "${newVersion}"`);

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

// --- .mcp.json scaffold ---

function scaffoldMcpJson(force = false) {
  if (fs.existsSync(MCP_JSON) && !force) {
    log('  .mcp.json already exists. Use --force to overwrite.', 'yellow');
    return true;
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

// --- Setup components ---

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
      const pIdx  = args.indexOf('--provider');
      const prov  = (pIdx !== -1 && args[pIdx + 1]) ? args[pIdx + 1] : 'anthropic';
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
        if (sh(pyBin, vArgs, { cwd: WORKSPACE_ROOT }) !== 0) return false;
      } else {
        log('  .venv exists — skipping creation (use --force to recreate)', 'dim');
      }

      const sitePkgsCandidates = [
        path.join(VENV, 'Lib', 'site-packages'),
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
      if (sh(venvBin('python'), ['-m', 'pip', 'install', '--quiet', '--upgrade', 'pip'], { cwd: WORKSPACE_ROOT }) !== 0) {
        return false;
      }

      const extras = [prov, 'dev', ...(ckpt ? ['checkpoint'] : [])];
      const target = `.[${extras.join(',')}]`;
      log(`  Installing ${target}…`, 'dim');
      if (sh(venvBin('pip'), ['install', '--quiet', '-e', target], { cwd: ORCHESTRATOR_DIR }) !== 0) {
        return false;
      }

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
    desc:  'Workspace-level override (for advanced use)',
    detect: () => fs.existsSync(MCP_JSON),
    run:      (args = []) => scaffoldMcpJson(args.includes('--force')),
    validate() {
      if (!fs.existsSync(MCP_JSON)) return false;
      try { JSON.parse(fs.readFileSync(MCP_JSON, 'utf8')); return true; } catch { return false; }
    },
  },
  {
    id:    'global-mcp',
    label: 'Global MCP',
    desc:  'User-level IDE registration (recommended)',
    detect: () => shimConfigExists(),
    run() {
      try {
        mcpGlobalInstall({ log: (msg) => log(msg) });
        return true;
      } catch (err) {
        log(`  \u2717 ${err.message}`, 'red');
        return false;
      }
    },
    validate: () => shimConfigExists(),
  },
  {
    id:    'git-hooks',
    label: 'Git hooks',
    desc:  'Pre-commit persona guard',
    detect() {
      const r = spawnSync('git', ['config', 'core.hooksPath'], { encoding: 'utf8' });
      return r.status === 0 && r.stdout.trim() === '.githooks';
    },
    run: () => sh('node', [path.join(SCRIPTS_DIR, 'install-hooks.js')], { cwd: WORKSPACE_ROOT }) === 0,
    validate() {
      const r = spawnSync('git', ['config', 'core.hooksPath'], { encoding: 'utf8' });
      return r.status === 0 && r.stdout.trim() === '.githooks';
    },
  },
];

// --- Delegating command functions ---

function cmdSyncPersonas(args) {
  const code = runScript('node', [path.join(SCRIPTS_DIR, 'sync-personas.js'), ...args], { cwd: WORKSPACE_ROOT });
  if (code !== 0) process.exit(code);
}

async function cmdCleanAgents(args) {
  const force = args.includes('--force');
  const allTargets = getPublishLocations();
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
    if (!trimmed) { log(C.dim('  Cancelled \u2014 no files deleted.')); return; }
    if (trimmed === 'a') {
      targets = nonEmpty;
    } else {
      const indices = trimmed.split(',')
        .map(s => parseInt(s.trim(), 10))
        .filter(n => !isNaN(n) && n >= 1 && n <= allTargets.length);
      if (indices.length === 0) {
        log('  Invalid selection \u2014 no files deleted.', 'red');
        return;
      }
      targets = indices.map(i => allTargets[i - 1]).filter(t => t.files.length > 0);
      if (targets.length === 0) {
        log('\n  Selected locations are all empty \u2014 nothing to delete.', 'green');
        return;
      }
    }
  }
  let totalFiles = 0;
  console.log('');
  for (const target of targets) {
    totalFiles += target.files.length;
    log(`  ${C.bold(target.label)} ${C.dim('\u2014 ' + target.dir)}`);
    log(`  ${target.files.length} file${target.files.length === 1 ? '' : 's'}:`);
    for (const file of target.files) {
      log(`    ${C.yellow('\u2022')} ${file}`);
    }
    console.log('');
  }
  if (!force) {
    const activeCount = targets.filter(t => t.files.length > 0).length;
    const answer = await askCleanInput(
      `  Delete all ${totalFiles} file${totalFiles === 1 ? '' : 's'} across ${activeCount} location${activeCount === 1 ? '' : 's'}? [y/N] `,
    );
    if (answer.trim().toLowerCase() !== 'y') {
      log(C.dim('  Cancelled \u2014 no files deleted.'));
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
        log(`  \u2717 Failed to delete ${file}: ${err.message}`, 'red');
      }
    }
  }
  log(`\n  ${C.green('\u2713')} Deleted ${deleted} file${deleted === 1 ? '' : 's'} across all publish locations.`);
}

function askCleanInput(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => { rl.close(); resolve(answer); });
  });
}

function cmdBuildPersonas(args) {
  const code = runScript('node', [path.join(SCRIPTS_DIR, 'build-personas.js'), ...args], { cwd: WORKSPACE_ROOT });
  if (code !== 0) process.exit(code);
}

function cmdPackagePersonas(args) {
  const code = runScript('node', [path.join(SCRIPTS_DIR, 'package-personas.js'), ...args], { cwd: WORKSPACE_ROOT });
  if (code !== 0) process.exit(code);
}

async function cmdGui(args) {
  if (!args.includes('--port')) {
    const portInput = await askCleanInput('  Port [3420]: ');
    const trimmed = portInput.trim();
    if (trimmed) {
      const p = parseInt(trimmed, 10);
      if (isNaN(p) || p <= 0) { log('  Invalid port number.', 'red'); return; }
      args = [...args, '--port', String(p)];
    }
  }
  const { child, exitCode } = runLongScript('node', [path.join(SCRIPTS_DIR, 'run-gui.js'), ...args], { cwd: WORKSPACE_ROOT });
  child.on('error', (err) => { log(`\u2717 Failed to launch run-gui.js: ${err.message}`, 'red'); process.exit(1); });
  process.once('SIGINT', () => child.kill('SIGINT'));
  return exitCode.then(code => { process.exit(code); });
}

function cmdBuildMaintain(args) {
  const syncCode = runScript('node', [path.join(MCP_SERVER_DIR, 'scripts', 'sync-version.js'), ...args], { cwd: WORKSPACE_ROOT });
  if (syncCode !== 0) process.exit(syncCode);
  syncOrchestratorVersion();
  const buildArgs = args.includes('--suite') ? args : ['--suite', 'all', ...args];
  const buildCode = runScript('node', [path.join(SCRIPTS_DIR, 'build-personas.js'), ...buildArgs], { cwd: WORKSPACE_ROOT });
  if (buildCode !== 0) process.exit(buildCode);
  const rolesCode = runScript('node', [path.join(SCRIPTS_DIR, 'check-known-roles.js')], { cwd: WORKSPACE_ROOT });
  if (rolesCode !== 0) process.exit(rolesCode);
  cmdCtxGenerate(args);
}

function cmdOrchestrator(args) {
  const { child, exitCode } = runLongScript('node', [path.join(SCRIPTS_DIR, 'run-orchestrator.js'), ...args], { cwd: WORKSPACE_ROOT });
  child.on('error', (err) => { log(`\u2717 Failed to launch run-orchestrator.js: ${err.message}`, 'red'); process.exit(1); });
  process.once('SIGINT', () => child.kill('SIGINT'));
  return exitCode.then(code => { process.exit(code); });
}

function cmdPreflight(args) {
  const code = runScript('node', [path.join(SCRIPTS_DIR, 'preflight-orchestrator.js'), ...args], { cwd: WORKSPACE_ROOT });
  if (code !== 0) process.exit(code);
}

function cmdPreviewPrompts(args) {
  const code = runScript(venvBin('python'), [path.join(SCRIPTS_DIR, 'preview-prompts.py'), ...args], { cwd: WORKSPACE_ROOT });
  if (code !== 0) process.exit(code);
}

function cmdCheckRoles() {
  const code = runScript('node', [path.join(SCRIPTS_DIR, 'check-known-roles.js')], { cwd: WORKSPACE_ROOT });
  if (code !== 0) process.exit(code);
}

function cmdCheckVersions() {
  const code = runScript('node', [path.join(SCRIPTS_DIR, 'check-version-sync.js')], { cwd: WORKSPACE_ROOT });
  if (code !== 0) process.exit(code);
}

function cmdBundleDocs(args) {
  const code = runScript('node', [path.join(SCRIPTS_DIR, 'bundle-docs.js'), ...args], { cwd: WORKSPACE_ROOT });
  if (code !== 0) process.exit(code);
}

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
  sh('node', [path.join(SCRIPTS_DIR, 'normalize-ctx-paths.js'), ctxDir], { cwd: WORKSPACE_ROOT });
  fs.writeFileSync(path.join(ctxDir, 'generated-at.txt'), new Date().toISOString() + '\n');
  const agentsMd = path.join(WORKSPACE_ROOT, 'AGENTS.md');
  const claudeMd = path.join(WORKSPACE_ROOT, 'CLAUDE.md');
  if (fs.existsSync(agentsMd)) {
    const agentsContent = fs.readFileSync(agentsMd, 'utf8');
    const header = '<!-- NOTE: This file is generated automatically from AGENTS.md whenever CTX documents are updated -->\n\n';
    fs.writeFileSync(claudeMd, header + agentsContent, 'utf8');
    log('Synced AGENTS.md \u2192 CLAUDE.md', 'dim');
  } else {
    log('\u26a0 AGENTS.md not found \u2014 CLAUDE.md not updated', 'yellow');
  }
}

function cmdMcpJson(args) { scaffoldMcpJson(args.includes('--force')); }

function cmdGitHooks() {
  sh('node', [path.join(SCRIPTS_DIR, 'install-hooks.js')], { cwd: WORKSPACE_ROOT });
}

async function cmdDoctor() {
  const results = await runChecks('all');
  let anyFailed = false;
  for (const { label, passed, fix } of results) {
    if (passed) {
      log(`  ${C.green('\u2713')} ${label}`);
    } else {
      anyFailed = true;
      log(`  ${C.red('\u2717')} ${label}`);
      if (fix) {
        log(`       ${C.dim(fix)}`);
      }
    }
  }
  if (anyFailed) {
    process.exit(1);
  }
}

async function cmdInstallMcp(args) {
  if (args.includes('--dry-run')) {
    mcpGlobalDryRun();
  } else {
    try {
      mcpGlobalInstall({ log: (msg) => log(msg) });
    } catch (err) {
      log(`  \u2717 ${err.message}`, 'red');
      process.exit(1);
    }
  }
}

function cmdReadLog(args) {
  const code = runScript('node', [path.join(SCRIPTS_DIR, 'read-log.js'), ...args], { cwd: WORKSPACE_ROOT });
  if (code !== 0) process.exit(code);
}

function cmdKillOrchestrator(args) {
  const code = runScript('node', [path.join(SCRIPTS_DIR, 'kill-orchestrator.js'), ...args], { cwd: WORKSPACE_ROOT });
  if (code !== 0) process.exit(code);
}

// --- Command registry ---

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
  },
  {
    id:          'build-maintain',
    key:         'b',
    label:       'Build & Maintain',
    category:    'Validation & Utilities',
    description: 'Sync versions, build personas & CTX generate',
    run:         cmdBuildMaintain,
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
    id:           'install-mcp',
    key:          'i',
    label:        'Install MCP (Global)',
    category:     'Setup & Configuration',
    description:  'Register MCP server in VS Code user config via stable shim',
    helpVariants: [
      ['install-mcp --dry-run', 'Preview changes without writing'],
    ],
    run:          cmdInstallMcp,
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
    helpHidden:   true,
    run:          cmdKillOrchestrator,
  },
  {
    id:           'doctor',
    key:          'v',
    label:        'Doctor',
    category:     'Validation & Utilities',
    description:  'Full environment health check (all tiers)',
    helpVariants: [
      ['doctor', 'Full environment health check'],
    ],
    run:          cmdDoctor,
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
    run:         cmdCtxGenerate,
  },
  {
    id:          'check-versions',
    key:         null,
    label:       'Check version sync',
    category:    'Validation & Utilities',
    description: 'Verify changelog vs manifest versions',
    run:         cmdCheckVersions,
  },
];

// --- ASCII banner ---

const BANNER_LINES = [
  ' ',
  ' █████╗ ██╗   ██╗███╗   ██╗███████╗██╗ ██████╗ ██╗  ██╗████████╗███████╗',
  '██╔══██╗██║   ██║████╗  ██║██╔════╝██║██╔════╝ ██║  ██║╚══██╔══╝██╔════╝',
  '███████║██║   ██║██╔██╗ ██║███████╗██║██║  ███╗███████║   ██║   ███████╗',
  '██╔══██║██║   ██║██║╚██╗██║╚════██║██║██║   ██║██╔══██║   ██║   ╚════██║',
  '██║  ██║██║   ██║██║ ╚████║███████║██║╚██████╔╝██║  ██║   ██║   ███████║',
  '╚═╝  ╚═╝╚═╝   ╚═╝╚═╝  ╚═══╝╚══════╝╚═╝ ╚═════╝ ╚═╝  ╚═╝   ╚═╝   ╚══════╝',
];

// --- Status lines (instant-tier health checks, synchronous) ---

const STATUS_LINES = HEALTH_CHECKS
  .filter(check => check.cost === 'instant')
  .map(check => () => {
    const result = check.detect();
    // Guard against Promise (contract violation: instant checks must be synchronous)
    if (result instanceof Promise) {
      return C.yellow(`\u26a0 ${check.label} (detect returned Promise \u2014 check must be synchronous)`);
    }
    if (result) {
      return C.green(`\u2713 ${check.label}`);
    }
    const fixHint = check.fix ? C.dim(` \u2014 ${check.fix}`) : '';
    return C.red(`\u2717 ${check.label}`) + fixHint;
  });

// --- First-run wizard ---

const skipSetupCheck = process.argv.includes('--skip-setup-check');

/**
 * Scope-selection prompt for the first-run wizard.
 * Presents two options and returns the chosen SETUP_COMPONENT id(s).
 * Called by cli-menu in cooked mode (readline-compatible).
 * @returns {Promise<string[]>}
 */
function handleFirstRun() {
  return new Promise((resolve) => {
    process.stdout.write('\n  Select MCP server registration scope:\n');
    process.stdout.write('    [g] Globally (recommended)\n');
    process.stdout.write('    [w] Workspace-only\n');
    process.stdout.write('\n');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('  > ', (answer) => {
      rl.close();
      const choice = answer.trim().toLowerCase();
      resolve(choice === 'w' ? ['mcp-json'] : ['global-mcp']);
    });
  });
}

// --- Entry point ---

createMenu({
  name:            'AI Insights CLI',
  banner:          BANNER_LINES,
  version:         () => readChangelogVersion(CHANGELOG_FILE).replace(/^v/, ''),
  commands:        COMMANDS,
  workspaceRoot:   WORKSPACE_ROOT,
  setupComponents: SETUP_COMPONENTS,
  preflightChecks: [
    () => checkNodeVersion(18),
    checkWorkspaceRoot,
  ],
  categoryVersions: {
    'MCP Server':   () => readPackageVersion(MCP_SERVER_DIR).replace(/^v/, ''),
    'Personas':     () => readPackageVersion(PERSONAS_DIR).replace(/^v/, ''),
    'Orchestrator': () => readPyprojectVersion(ORCHESTRATOR_DIR).replace(/^v/, ''),
  },
  usageLine:  'node scripts/cli.js [command] [options]',
  statusLines: STATUS_LINES,
  firstRunRedirect: !skipSetupCheck,
  onFirstRun: handleFirstRun,
}).run(process.argv.slice(2)).then(code => process.exit(code));
