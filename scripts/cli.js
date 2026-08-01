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
  waitForKey,
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
import {
  storeInit,
  storeAdd,
  storeRemove,
  storeList,
  storeSetDefault,
  storeConflicts,
  storeStatus,
  storeRepoAdd,
  storeRepoMove,
  storeRepoList,
} from './lib/store-commands.js';

// --- Constants ---

const WORKSPACE_ROOT   = path.resolve(import.meta.dirname, '..');
const SCRIPTS_DIR      = import.meta.dirname;
const MCP_SERVER_DIR   = path.join(WORKSPACE_ROOT, 'mcp-server');
const PERSONAS_DIR     = path.join(WORKSPACE_ROOT, 'personas');
const ORCHESTRATOR_DIR = path.join(WORKSPACE_ROOT, 'orchestrator');
const CHANGELOG_FILE   = path.join(WORKSPACE_ROOT, 'changelog.md');
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

// --- Setup components ---

const SETUP_COMPONENTS = [
  {
    id:    'mcp-server',
    label: 'MCP Server',
    desc:  'npm install + build',
    detect() {
      if (!fs.existsSync(path.join(MCP_SERVER_DIR, 'dist'))) return false;
      // node_modules must exist AND be in sync with package-lock.json
      const outerLock = path.join(MCP_SERVER_DIR, 'package-lock.json');
      const innerLock = path.join(MCP_SERVER_DIR, 'node_modules', '.package-lock.json');
      if (!fs.existsSync(innerLock)) return false;
      return fs.statSync(outerLock).mtimeMs <= fs.statSync(innerLock).mtimeMs;
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
    detect() {
      // node_modules must exist AND be in sync with package-lock.json
      const outerLock = path.join(PERSONAS_DIR, 'package-lock.json');
      const innerLock = path.join(PERSONAS_DIR, 'node_modules', '.package-lock.json');
      if (!fs.existsSync(innerLock)) return false;
      return fs.statSync(outerLock).mtimeMs <= fs.statSync(innerLock).mtimeMs;
    },
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

function cmdBuildSkills(args) {
  const code = runScript('node', [path.join(SCRIPTS_DIR, 'build-skills.js'), ...args], { cwd: WORKSPACE_ROOT });
  if (code !== 0) process.exit(code);
}

function cmdPublishSkills(args) {
  const buildCode = runScript('node', [path.join(SCRIPTS_DIR, 'build-skills.js'), ...args], { cwd: WORKSPACE_ROOT });
  if (buildCode !== 0) process.exit(buildCode);
  const publishArgs = args.includes('--dry-run') ? ['--dry-run'] : [];
  const publishCode = runScript('node', [path.join(SCRIPTS_DIR, 'publish-skills.js'), ...publishArgs], { cwd: WORKSPACE_ROOT });
  if (publishCode !== 0) process.exit(publishCode);
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
  const overviewCode = runScript('node', [path.join(SCRIPTS_DIR, 'generate-agents-overview.js')], { cwd: WORKSPACE_ROOT });
  if (overviewCode !== 0) process.exit(overviewCode);
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

function cmdGenerateOverview(args) {
  const code = runScript('node', [path.join(SCRIPTS_DIR, 'generate-agents-overview.js'), ...args], { cwd: WORKSPACE_ROOT });
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
  await waitForKey();
}

function cmdReadLog(args) {
  const code = runScript('node', [path.join(SCRIPTS_DIR, 'read-log.js'), ...args], { cwd: WORKSPACE_ROOT });
  if (code !== 0) process.exit(code);
}

function cmdExtractDialogue(args) {
  const code = runScript('node', [path.join(SCRIPTS_DIR, 'extract-dialogue.js'), ...args], { cwd: WORKSPACE_ROOT });
  if (code !== 0) process.exit(code);
}

function cmdImportStandalone(args) {
  const code = runScript('node', [path.join(SCRIPTS_DIR, 'import-standalone.js'), ...args], { cwd: WORKSPACE_ROOT });
  if (code !== 0) process.exit(code);
}

function cmdKillOrchestrator(args) {

  const code = runScript('node', [path.join(SCRIPTS_DIR, 'kill-orchestrator.js'), ...args], { cwd: WORKSPACE_ROOT });
  if (code !== 0) process.exit(code);
}

// ─── Store command group ──────────────────────────────────────────────────────

/**
 * Formats and prints a storeList result to the console.
 * @param {Array} stores
 * @param {string} defaultStore
 */
function printStoreList(stores, defaultStore) {
  if (stores.length === 0) {
    log('  No stores configured. Run `store init` to get started.', 'dim');
    return;
  }
  for (const s of stores) {
    const marker = s.is_default ? C.green('★ default') : C.dim('         ');
    log(`  ${marker}  ${C.bold(s.id)}  ${C.dim(s.path)}`);
    log(`           repos: ${s.repo_count}  projects: ${s.project_count}`);
  }
}

function cmdStore(args) {
  const sub  = args[0];
  const rest = args.slice(1);

  switch (sub) {

    case 'init': {
      const ledgerRoot = rest[0] ?? undefined;
      const result = storeInit({ ledgerRoot });
      if (!result.ok) {
        log(`  ${C.red('✗')} ${result.reason}`, 'red');
        process.exit(1);
      }
      log(`  ${C.green('✓')} stores.json created at ${result.configPath}`);
      log(`    Default store → ${result.config.stores[0].path}`);
      break;
    }

    case 'add': {
      const [id, storePath] = rest;
      if (!id || !storePath) {
        log('  Usage: store add <id> <path>', 'red');
        process.exit(1);
      }
      const result = storeAdd({ id, storePath });
      if (!result.ok) {
        log(`  ${C.red('✗')} ${result.reason}`, 'red');
        process.exit(1);
      }
      log(`  ${C.green('✓')} Store '${result.id}' added → ${result.path}`);
      break;
    }

    case 'remove': {
      const [id] = rest;
      if (!id) { log('  Usage: store remove <id>', 'red'); process.exit(1); }
      const result = storeRemove({ id });
      if (!result.ok) {
        log(`  ${C.red('✗')} ${result.reason}`, 'red');
        process.exit(1);
      }
      if (result.warned) {
        log(`  ${C.yellow('⚠')} Store '${id}' removed from stores.json.`, 'yellow');
        log(`    ${C.yellow('Warning:')} The store's .repositories.json contains entries. The directory was NOT deleted.`, 'yellow');
      } else {
        log(`  ${C.green('✓')} Store '${id}' removed from stores.json (directory not deleted).`);
      }
      break;
    }

    case 'list': {
      const result = storeList();
      if (!result.ok) {
        log(`  ${C.red('✗')} Failed to load stores.json.`, 'red');
        process.exit(1);
      }
      printStoreList(result.stores, result.default_store);
      break;
    }

    case 'default': {
      const [id] = rest;
      if (!id) { log('  Usage: store default <id>', 'red'); process.exit(1); }
      const result = storeSetDefault({ id });
      if (!result.ok) {
        log(`  ${C.red('✗')} ${result.reason}`, 'red');
        process.exit(1);
      }
      log(`  ${C.green('✓')} Default store set to '${result.default_store}'.`);
      break;
    }

    case 'conflicts': {
      const result = storeConflicts();
      if (!result.ok) {
        log(`  ${C.red('✗')} Failed to detect conflicts.`, 'red');
        process.exit(1);
      }
      if (result.conflicts.length === 0) {
        log(`  ${C.green('✓')} No conflicts — each repository is registered in exactly one store.`);
      } else {
        log(`  ${C.yellow('⚠')} Found ${result.conflicts.length} conflict(s):`);
        for (const c of result.conflicts) {
          log(`\n  ${C.bold(c.repo_name)}`);
          for (const e of c.entries) {
            const tag = e.store_id === c.winner_store_id
              ? C.green('  Active (winner)  ')
              : C.red('  Shadowed         ');
            log(`    ${tag}  ${C.dim('store:')} ${e.store_id}`);
          }
        }
      }
      break;
    }

    case 'status': {
      const result = storeStatus();
      if (!result.ok) {
        log(`  ${C.red('✗')} Failed to retrieve store status.`, 'red');
        process.exit(1);
      }
      if (result.statuses.length === 0) {
        log('  No stores configured.', 'dim');
      } else {
        for (const s of result.statuses) {
          if (!s.is_git) {
            log(`  ${C.dim('—')} ${C.bold(s.id)}  ${C.dim('(not a git repo)')}`);
          } else if (s.status === 'no upstream') {
            log(`  ${C.yellow('?')} ${C.bold(s.id)}  ${C.dim('(no upstream configured)')}`);
          } else {
            const ahead  = s.ahead  > 0 ? C.yellow(`↑${s.ahead}`)  : '';
            const behind = s.behind > 0 ? C.yellow(`↓${s.behind}`) : '';
            const sync   = (s.ahead === 0 && s.behind === 0)
              ? C.green('in sync')
              : [ahead, behind].filter(Boolean).join(' ');
            log(`  ${C.bold(s.id)}  ${sync}  ${C.dim(s.path)}`);
          }
        }
      }
      break;
    }

    case 'repo': {
      const repoSub = rest[0];
      const repoRest = rest.slice(1);

      switch (repoSub) {

        case 'add': {
          const [repoName, storeId] = repoRest;
          if (!repoName || !storeId) {
            log('  Usage: store repo add <repo-name> <store-id>', 'red');
            process.exit(1);
          }
          const result = storeRepoAdd({ repoName, storeId });
          if (!result.ok) {
            log(`  ${C.red('✗')} ${result.reason}`, 'red');
            process.exit(1);
          }
          log(`  ${C.green('✓')} Repository '${result.repoName}' added to store '${result.storeId}'.`);
          break;
        }

        case 'move': {
          const [repoName, targetStoreId] = repoRest;
          if (!repoName || !targetStoreId) {
            log('  Usage: store repo move <repo-name> <target-store-id>', 'red');
            process.exit(1);
          }
          const result = storeRepoMove({ repoName, targetStoreId });
          if (!result.ok) {
            log(`  ${C.red('✗')} ${result.reason}`, 'red');
            process.exit(1);
          }
          log(`  ${C.green('✓')} Repository '${result.repoName}' moved from '${result.fromStoreId}' → '${result.toStoreId}'.`);
          break;
        }

        case 'list': {
          const result = storeRepoList();
          if (!result.ok) {
            log(`  ${C.red('✗')} Failed to load repo list.`, 'red');
            process.exit(1);
          }
          if (result.repos.length === 0) {
            log('  No repositories registered in any store.', 'dim');
          } else {
            for (const r of result.repos) {
              const shadow = r.is_shadowed ? C.red(' [shadowed]') : '';
              log(`  ${C.bold(r.folder_names?.join(', ') ?? r.id)}${shadow}  ${C.dim('store:')} ${r.store_id}`);
            }
          }
          break;
        }

        default:
          log(`  Unknown repo subcommand '${repoSub ?? ''}'. Use: store repo add|move|list`, 'red');
          process.exit(1);
      }
      break;
    }

    default:
      log(`  Unknown store subcommand '${sub ?? ''}'. Use: store init|add|remove|list|default|conflicts|status|repo`, 'red');
      process.exit(1);
  }
}

async function cmdOrchestratorTests(args) {
  const pytest = venvBin('python');
  let marker = 'integration or deepagent';

  if (args.includes('--live')) {
    marker = 'integration or deepagent or live';
    args = args.filter((a) => a !== '--live');
  } else if (!args.some((a) => a === '-m' || a === '--markers')) {
    const answer = await askCleanInput('  Include live MCP tests? (requires API key) [y/N] ');
    if (answer.trim().toLowerCase() === 'y') {
      marker = 'integration or deepagent or live';
    }
  }

  // Auto-build MCP server dist when live tests are included
  if (marker.includes('live')) {
    const sentinel = path.join(MCP_SERVER_DIR, 'dist', 'index.js');
    const srcDir   = path.join(MCP_SERVER_DIR, 'src');
    let needBuild  = !fs.existsSync(sentinel);
    if (!needBuild) {
      const sentinelMtime = fs.statSync(sentinel).mtimeMs;
      needBuild = latestMtime(srcDir) > sentinelMtime;
    }
    if (needBuild) {
      log('  MCP server dist is stale — rebuilding…', 'dim');
      if (sh(NPM, ['run', 'build'], { cwd: MCP_SERVER_DIR }) !== 0) {
        log('  ✗ MCP server build failed', 'red');
        process.exit(1);
      }
    }
  }

  const testArgs = ['-m', 'pytest', 'tests/', '-v', '-m', marker, ...args];
  const code = runScript(pytest, testArgs, { cwd: ORCHESTRATOR_DIR });
  if (code !== 0) process.exit(code);
  await waitForKey();
}

/**
 * Recursively find the latest mtime (ms) of any file under `dir`.
 */
function latestMtime(dir) {
  let latest = -Infinity;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      latest = Math.max(latest, latestMtime(full));
    } else if (entry.isFile()) {
      latest = Math.max(latest, fs.statSync(full).mtimeMs);
    }
  }
  return latest;
}

// --- Command registry ---

const COMMANDS = [
  {
    id:           'setup',
    key:          's',
    label:        'Setup & Refresh',
    category:     'Setup & Configuration',
    description:  'Full workspace setup & refresh wizard',
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
    id:          'build-skills',
    key:         null,
    label:       'Build skills',
    category:    'Skills',
    description: 'Build skill output files',
    run:         cmdBuildSkills,
  },
  {
    id:          'publish-skills',
    key:         null,
    label:       'Publish skills',
    category:    'Skills',
    description: 'Build & deploy skills to VS Code and Claude Code',
    run:         cmdPublishSkills,
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
    id:           'import-standalone',
    key:          null,
    label:        'Import standalone plan',
    category:     'MCP Server',
    description:  'Import a standalone plan folder into the project ledger',
    helpVariants: [
      ['import-standalone --path <dir>',                    'Import a single plan folder'],
      ['import-standalone --batch',                         'Scan docs/agents/ and import untracked plans'],
      ['import-standalone --batch --base-dir <dir>',        'Scan a custom directory'],
      ['import-standalone --batch --dry-run',               'Preview without writing'],
    ],
    run: cmdImportStandalone,
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
    id:           'extract-dialogue',
    key:          null,
    label:        'Extract chunk dialogue',
    category:     'Orchestrator',
    description:  'Extract prose text from chunk .jsonl files into .md files',
    helpVariants: [
      ['extract-dialogue <chunk-file>',      'Extract a single .jsonl file'],
      ['extract-dialogue <directory>',        'Extract all .jsonl files in a directory'],
      ['extract-dialogue <target> --force',   'Overwrite existing .md files'],
      ['extract-dialogue <target> --dry-run', 'Preview output paths without writing'],
    ],
    helpHidden:   true,
    run:          cmdExtractDialogue,
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
    id:          'generate-overview',
    key:         null,
    label:       'Generate agents overview',
    category:    'Validation & Utilities',
    description: 'Generate docs/references/agents-overview.md from persona YAML metadata',
    run:         cmdGenerateOverview,
  },
  {
    id:          'check-versions',
    key:         null,
    label:       'Check version sync',
    category:    'Validation & Utilities',
    description: 'Verify changelog vs manifest versions',
    run:         cmdCheckVersions,
  },
  {
    id:           'orchestrator-tests',
    key:          't',
    label:        'Integration tests',
    category:     'Validation & Utilities',
    description:  'Run integration & deep-agent tests (optionally live)',
    helpVariants: [
      ['orchestrator-tests',        'Run integration + deepagent tests (prompts for live)'],
      ['orchestrator-tests --live',  'Include live MCP tests (auto-builds, needs API key)'],
    ],
    run:          cmdOrchestratorTests,
  },
  {
    id:           'store',
    key:          null,
    label:        'Store management',
    category:     'MCP Server',
    description:  'Manage multi-store ledger configuration and repositories',
    helpVariants: [
      ['store init [ledger-root]',                    'Create stores.json pointing at ledger root'],
      ['store add <id> <path>',                       'Register a new store directory'],
      ['store remove <id>',                           'Remove a store (directory not deleted)'],
      ['store list',                                  'Show all stores with repo and project counts'],
      ['store default <id>',                          'Set the default store'],
      ['store conflicts',                             'Show cross-store repository registry conflicts'],
      ['store status',                                'Show Git sync status for each store'],
      ['store repo add <repo-name> <store-id>',       'Add a repository to a store registry'],
      ['store repo move <repo-name> <target-store-id>', 'Move a repository between stores'],
      ['store repo list',                             'List all repositories across all stores'],
    ],
    helpHidden:   true,
    run:          cmdStore,
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
// Renders a single "all clear" line when every check passes; shows only
// the failing items (with fix hints) when one or more checks fail.

const STATUS_LINES = [() => {
  const failures = [];
  for (const check of HEALTH_CHECKS.filter(c => c.cost === 'instant')) {
    const result = check.detect();
    // Guard against Promise (contract violation: instant checks must be synchronous)
    if (result instanceof Promise) {
      failures.push(C.yellow(`\u26a0 ${check.label} (detect returned Promise \u2014 check must be synchronous)`));
    } else if (!result) {
      const fixHint = check.fix ? C.dim(` \u2014 ${check.fix}`) : '';
      failures.push(C.red(`\u2717 ${check.label}`) + fixHint);
    }
  }
  if (failures.length === 0) {
    return C.green('\u2713 All checks passed');
  }
  return failures.join('\n  ');
}];

// --- First-run wizard ---

const skipSetupCheck = process.argv.includes('--skip-setup-check');

/**
 * Scope-selection prompt for the first-run wizard.
 * Presents two options and returns the chosen SETUP_COMPONENT id(s).
 * Called by cli-menu in cooked mode (readline-compatible).
 * @returns {Promise<string[]>}
 */
function handleFirstRun() {
  return Promise.resolve(['global-mcp']);
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
