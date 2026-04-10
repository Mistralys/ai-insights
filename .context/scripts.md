# AI Insights - Scripts
_SOURCE: Workspace scripts (CLI, persona sync, build, bundling, validation)_
# Workspace scripts (CLI, persona sync, build, bundling, validation)
```
// Structure of documents
└── scripts/
    └── build-personas.js
    └── bundle-docs.js
    └── check-known-roles.js
    └── check-version-sync.js
    └── cli.js
    └── extract-changelog-entry.js
    └── install-hooks.js
    └── kill-orchestrator.js
    └── normalize-ctx-paths.js
    └── package-personas.js
    └── preflight-orchestrator.js
    └── read-log.js
    └── run-gui.js
    └── run-orchestrator.js
    └── sync-personas.js
    └── validate-workflow-manifest.js

```
###  Path: `/scripts/build-personas.js`

```js
#!/usr/bin/env node
'use strict';

/**
 * build-personas.js — thin wrapper around @mistralys/persona-builder.
 * All build logic is delegated to the library via the CLI binary.
 * Usage: node scripts/build-personas.js [--check] [--strict] [--dry-run]
 */

const fs               = require('fs');
const path             = require('path');
const { execFileSync } = require('child_process');

const ROOT     = path.join(__dirname, '..');
const PERSONAS = path.join(ROOT, 'personas');
const CONFIG   = path.join(PERSONAS, 'persona-build.config.js');
const CLI      = path.join(PERSONAS, 'node_modules', '@mistralys', 'persona-builder', 'dist', 'cli.js');

// --dry-run is accepted as a convenience alias for --check (same behaviour)
const CHECK  = process.argv.includes('--check') || process.argv.includes('--dry-run');
const STRICT = process.argv.includes('--strict');

// Delegate build to the library CLI
const cliArgs = ['--config', CONFIG];
if (CHECK)  cliArgs.push('--check');
if (STRICT) cliArgs.push('--strict');

try {
  execFileSync(process.execPath, [CLI, ...cliArgs], { stdio: 'inherit' });
} catch (err) {
  process.exit(err.status ?? 1);
}

// Post-build: sync personas/package.json version from changelog (real builds only)
if (!CHECK) {
  const changelogPath = path.join(ROOT, 'personas', 'changelog.md');
  const pkgPath       = path.join(ROOT, 'personas', 'package.json');
  const changelog     = fs.readFileSync(changelogPath, 'utf8');
  const match         = changelog.match(/^## v(\d+\.\d+\.\d+)/m);

  if (!match) {
    console.warn('[WARN] Could not extract version from personas/changelog.md — skipping package.json update.');
  } else {
    const newVersion = match[1];
    const pkg        = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    if (pkg.version !== newVersion) {
      const oldVersion = pkg.version;
      pkg.version = newVersion;
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
      console.log(`Updated personas/package.json: ${oldVersion} → ${newVersion}`);
    } else {
      console.log(`personas/package.json already at v${newVersion} — no update needed.`);
    }
  }
}

// Post-build: generate personas/name-mapping.json (real builds only)
if (!CHECK) {
  const metaDir = path.join(ROOT, 'personas', 'ledger', 'src', 'meta');
  const outPath = path.join(ROOT, 'personas', 'name-mapping.json');

  // This list must stay in sync with the 9 ledger roles in shared/workflow-manifest.json.
  // When a new persona is added to the workflow, update this list accordingly.
  const PERSONA_FILES = [
    '1-planner.yaml',
    '2-project-manager.yaml',
    '3-developer.yaml',
    '4-qa.yaml',
    '5-security-auditor.yaml',
    '6-reviewer.yaml',
    '7-release-engineer.yaml',
    '8-documentation.yaml',
    '9-synthesis.yaml',
  ];

  const SCALAR_FIELDS = ['number', 'role', 'id', 'version', 'vs_file_name', 'cc_file_name', 'da_file_name'];

  /**
   * Extracts simple scalar (string/number) fields from a YAML file without
   * external dependencies. Only top-level key: value lines are parsed; nested
   * structures and lists are ignored.
   *
   * Limitation: trailing inline YAML comments are NOT stripped — a value like
   * `role: Developer # note` will be parsed as `"Developer # note"`. Persona
   * YAML files must not use trailing inline comments on scalar fields.
   */
  function parseYamlScalars(text, fields) {
    const result = {};
    for (const line of text.split('\n')) {
      const m = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.+)$/);
      if (!m) continue;
      const key = m[1];
      if (!fields.includes(key)) continue;
      let val = m[2].trim();
      // Strip surrounding single or double quotes
      if ((val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      result[key] = val;
    }
    return result;
  }

  /** Returns the filename stem (strips the last extension). */
  function stem(filename) {
    return filename.replace(/\.[^.]+$/, '');
  }

  // Read shared metadata for default_version — used as fallback when a persona YAML omits `version`.
  const sharedRaw      = fs.readFileSync(path.join(metaDir, '_shared.yaml'), 'utf8');
  const sharedData     = parseYamlScalars(sharedRaw, ['default_version']);
  const DEFAULT_VERSION = sharedData.default_version;

  const mapping = PERSONA_FILES.map(file => {
    const raw  = fs.readFileSync(path.join(metaDir, file), 'utf8');
    const data = parseYamlScalars(raw, SCALAR_FIELDS);

    const ccFileName = data.cc_file_name;
    const daFileName = data.da_file_name || ccFileName;
    const ccStem     = stem(ccFileName);
    const daStem     = stem(daFileName);
    const number     = Number(data.number);
    const version    = data.version || DEFAULT_VERSION;

    return {
      number,
      id:     data.id,
      role:   data.role,
      version,
      vscode: {
        file_name:  data.vs_file_name,
        agent_name: `${number} - ${data.role} v${version}`,
      },
      claude_code: {
        file_name:  ccFileName,
        agent_name: ccStem,
      },
      deep_agents: {
        file_name:  daFileName,
        agent_name: daStem,
      },
    };
  });

  // Sort by number (files are already ordered, but be explicit)
  mapping.sort((a, b) => a.number - b.number);

  fs.writeFileSync(outPath, JSON.stringify(mapping, null, 2) + '\n', 'utf8');
  console.log(`Generated personas/name-mapping.json with ${mapping.length} entries.`);
}

```
###  Path: `/scripts/bundle-docs.js`

```js
#!/usr/bin/env node

/**
 * scripts/bundle-docs.js
 *
 * Generates two standalone Markdown bundles into the build/ directory:
 *
 *   1. notebooklm-bundle.md     — MCP Server + Ledger Personas READMEs and
 *                                  project manifests, suitable for Google
 *                                  NotebookLM import.
 *   2. workflow-specification.md — All files from the Workflow Specification
 *                                  compiled into a single document.
 *
 * Usage:
 *   node scripts/bundle-docs.js                       # build both bundles
 *   node scripts/bundle-docs.js --only notebooklm     # build only the NotebookLM bundle
 *   node scripts/bundle-docs.js --only workflow-spec   # build only the workflow spec
 *   node scripts/bundle-docs.js --dry-run              # preview sizes, write nothing
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const ROOT = path.resolve(__dirname, '..');
const BUILD_DIR = path.join(ROOT, 'build');

// NotebookLM sources
const MCP_README            = path.join(ROOT, 'mcp-server', 'README.md');
const MCP_MANIFEST_DIR      = path.join(ROOT, 'mcp-server', 'docs', 'agents', 'project-manifest');
const PERSONAS_README       = path.join(ROOT, 'personas', 'ledger', 'README.md');
const PERSONAS_MANIFEST_DIR = path.join(ROOT, 'personas', 'docs', 'agents', 'project-manifest');

const MANIFEST_SECTIONS = [
  'README.md',
  'tech-stack.md',
  'file-tree.md',
  'api-surface.md',
  'data-flows.md',
  'constraints.md',
];

// Workflow specification sources
const SPEC_DIR = path.join(ROOT, 'mcp-server', 'docs', 'agents', 'workflow-specification');

const SPEC_SECTION_FILES = [
  'data-model.md',
  'state-machines.md',
  'pipeline-routing.md',
  'operations.md',
  'handoff.md',
  'recommendations.md',
  'dependencies-and-rework.md',
  'auxiliary-systems.md',
  'edge-cases.md',
  'walkthrough.md',
];

// ---------------------------------------------------------------------------
// ANSI helpers
// ---------------------------------------------------------------------------

const c = {
  reset:  '\x1b[0m',
  bright: '\x1b[1m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  cyan:   '\x1b[36m',
  red:    '\x1b[31m',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readRequired(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error(`${c.red}ERROR${c.reset}: Required file not found: ${filePath}`);
    process.exit(1);
  }
  return fs.readFileSync(filePath, 'utf-8').trimEnd();
}

function sizeKB(content) {
  return (Buffer.byteLength(content, 'utf-8') / 1024).toFixed(1);
}

function section(heading, body) {
  return [
    `<!-- ${'='.repeat(72)} -->`,
    `<!-- ${heading} -->`,
    `<!-- ${'='.repeat(72)} -->`,
    '',
    body,
  ].join('\n');
}

function buildManifestBlock(dir) {
  const parts = [];
  for (const file of MANIFEST_SECTIONS) {
    const filePath = path.join(dir, file);
    const content  = readRequired(filePath);
    const relPath  = path.relative(ROOT, filePath).replace(/\\/g, '/');
    parts.push(`<!-- source: ${relPath} -->\n${content}`);
  }
  return parts.join('\n\n---\n\n');
}

function writeBundle(filePath, content, dryRun) {
  const relPath = path.relative(ROOT, filePath).replace(/\\/g, '/');

  if (dryRun) {
    console.log(`  ${c.yellow}dry-run${c.reset}: ${relPath} (${sizeKB(content)} KB)`);
    return;
  }

  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, content, 'utf-8');
  console.log(`  ${c.green}\u2714${c.reset} ${c.bright}${relPath}${c.reset} (${sizeKB(content)} KB)`);
}

// ---------------------------------------------------------------------------
// Bundle builders
// ---------------------------------------------------------------------------

function buildNotebookLM() {
  console.log(`\n  ${c.cyan}NotebookLM bundle${c.reset}`);

  const parts = [];

  // Preamble
  parts.push([
    '# AI Insights \u2014 Combined Reference for NotebookLM',
    '',
    `> **Generated:** ${new Date().toISOString().slice(0, 10)}`,
    '> ',
    '> This document bundles the core documentation from two sub-projects in the',
    '> **AI Insights** workspace so that NotebookLM can reason about them in a',
    '> single source.',
    '>',
    '> **Contents:**',
    '> 1. Project Ledger MCP Server \u2014 README + Project Manifest',
    '> 2. Ledger Personas Build System \u2014 README + Project Manifest',
  ].join('\n'));

  // MCP Server README
  console.log(`    ${c.cyan}+${c.reset} MCP Server README`);
  parts.push(section('PART 1A \u2014 MCP SERVER README', readRequired(MCP_README)));

  // MCP Server Manifest
  console.log(`    ${c.cyan}+${c.reset} MCP Server Project Manifest (${MANIFEST_SECTIONS.length} files)`);
  parts.push(section('PART 1B \u2014 MCP SERVER PROJECT MANIFEST', buildManifestBlock(MCP_MANIFEST_DIR)));

  // Personas README
  console.log(`    ${c.cyan}+${c.reset} Ledger Personas README`);
  parts.push(section('PART 2A \u2014 LEDGER PERSONAS README', readRequired(PERSONAS_README)));

  // Personas Manifest
  console.log(`    ${c.cyan}+${c.reset} Ledger Personas Project Manifest (${MANIFEST_SECTIONS.length} files)`);
  parts.push(section('PART 2B \u2014 LEDGER PERSONAS PROJECT MANIFEST', buildManifestBlock(PERSONAS_MANIFEST_DIR)));

  return parts.join('\n\n---\n\n') + '\n';
}

function buildWorkflowSpec() {
  console.log(`\n  ${c.cyan}Workflow Specification bundle${c.reset}`);

  const parts = [];

  console.log(`    ${c.cyan}+${c.reset} README.md (overview)`);
  parts.push(readRequired(path.join(SPEC_DIR, 'README.md')));

  for (const file of SPEC_SECTION_FILES) {
    console.log(`    ${c.cyan}+${c.reset} ${file}`);
    parts.push(readRequired(path.join(SPEC_DIR, file)));
  }

  return parts.join('\n\n---\n\n') + '\n';
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const args      = process.argv.slice(2);
const dryRun    = args.includes('--dry-run');
const onlyIndex = args.indexOf('--only');
const only      = onlyIndex !== -1 ? args[onlyIndex + 1] : null;

if (only && !['notebooklm', 'workflow-spec'].includes(only)) {
  console.error(`${c.red}ERROR${c.reset}: --only accepts "notebooklm" or "workflow-spec".`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

console.log(`${c.bright}[bundle-docs]${c.reset} Assembling bundles...`);

const shouldNotebook = !only || only === 'notebooklm';
const shouldWorkflow = !only || only === 'workflow-spec';

if (shouldNotebook) {
  const content = buildNotebookLM();
  writeBundle(path.join(BUILD_DIR, 'notebooklm-bundle.md'), content, dryRun);
}

if (shouldWorkflow) {
  const content = buildWorkflowSpec();
  writeBundle(path.join(BUILD_DIR, 'workflow-specification.md'), content, dryRun);
}

console.log(`\n${c.green}Done.${c.reset}\n`);

```
###  Path: `/scripts/check-known-roles.js`

```js
#!/usr/bin/env node

/**
 * scripts/check-known-roles.js
 *
 * Previously: compared KNOWN_ROLES in sync-personas.js against AGENT_ROLES in
 * mcp-server/src/utils/constants.ts to detect drift.
 *
 * Now superseded: both sync-personas.js and mcp-server/src/utils/constants.ts
 * derive their role lists directly from shared/workflow-manifest.json — so the
 * JS ↔ TS drift check is no longer meaningful. This script now delegates to
 * scripts/validate-workflow-manifest.js, which performs structural and semantic
 * validation of the manifest itself (unique IDs, DAG prerequisites, fail_routing
 * cross-references, and more).
 *
 * Usage:
 *   node scripts/check-known-roles.js          # from workspace root
 *   npm run check:roles                         # from mcp-server/ directory
 */

'use strict';

const path      = require('path');
const { execFileSync } = require('child_process');

const WORKSPACE_ROOT     = path.resolve(__dirname, '..');
const VALIDATE_SCRIPT    = path.join(WORKSPACE_ROOT, 'scripts', 'validate-workflow-manifest.js');

console.log('[check-known-roles] Role list is now derived from shared/workflow-manifest.json.');
console.log('[check-known-roles] Delegating to validate-workflow-manifest.js...\n');

try {
  execFileSync(process.execPath, [VALIDATE_SCRIPT], {
    cwd: WORKSPACE_ROOT,
    stdio: 'inherit',
  });
} catch {
  // validate-workflow-manifest.js already printed the errors; just propagate exit code.
  process.exit(1);
}


```
###  Path: `/scripts/check-version-sync.js`

```js
#!/usr/bin/env node

/**
 * scripts/check-version-sync.js
 *
 * Compares each module's changelog version (source of truth) against its
 * package manifest version. Exits with code 1 on any mismatch.
 *
 * Usage:
 *   node scripts/check-version-sync.js          # from workspace root
 *
 * Modules checked:
 *   - mcp-server:   changelog.md  vs  package.json
 *   - orchestrator:  changelog.md  vs  pyproject.toml
 *   - personas:      changelog.md  vs  package.json
 */

'use strict';

const path = require('path');
const fs   = require('fs');

const WORKSPACE_ROOT = path.resolve(__dirname, '..');

// ─── Module definitions ──────────────────────────────────────────────────────

const MODULES = [
  {
    name:        'mcp-server',
    changelog:   path.join(WORKSPACE_ROOT, 'mcp-server', 'changelog.md'),
    manifest:    path.join(WORKSPACE_ROOT, 'mcp-server', 'package.json'),
    manifestFmt: 'package.json',
    readManifestVersion(filePath) {
      const pkg = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return pkg.version || null;
    },
  },
  {
    name:        'orchestrator',
    changelog:   path.join(WORKSPACE_ROOT, 'orchestrator', 'changelog.md'),
    manifest:    path.join(WORKSPACE_ROOT, 'orchestrator', 'pyproject.toml'),
    manifestFmt: 'pyproject.toml',
    readManifestVersion(filePath) {
      const content = fs.readFileSync(filePath, 'utf8');
      const m = content.match(/^version\s*=\s*"([^"]+)"/m);
      return m ? m[1] : null;
    },
  },
  {
    name:        'personas',
    changelog:   path.join(WORKSPACE_ROOT, 'personas', 'changelog.md'),
    manifest:    path.join(WORKSPACE_ROOT, 'personas', 'package.json'),
    manifestFmt: 'package.json',
    readManifestVersion(filePath) {
      const pkg = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return pkg.version || null;
    },
  },
];

// ─── Changelog version extractor ─────────────────────────────────────────────

/**
 * Extract the first semver version from a changelog's `## v{X.Y.Z}` heading.
 * @param {string} filePath - Absolute path to the changelog file.
 * @returns {string|null} The version string (without the "v" prefix), or null.
 */
function readChangelogVersion(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const m = content.match(/^##\s+v(\d+\.\d+\.\d+)/m);
  return m ? m[1] : null;
}

// ─── Main ────────────────────────────────────────────────────────────────────

const mismatches = [];

for (const mod of MODULES) {
  let changelogVer, manifestVer;

  try {
    changelogVer = readChangelogVersion(mod.changelog);
  } catch (err) {
    console.error(`[check-version-sync] ERROR: Cannot read ${mod.name}/changelog.md: ${err.message}`);
    process.exit(1);
  }

  try {
    manifestVer = mod.readManifestVersion(mod.manifest);
  } catch (err) {
    console.error(`[check-version-sync] ERROR: Cannot read ${mod.name}/${mod.manifestFmt}: ${err.message}`);
    process.exit(1);
  }

  if (!changelogVer) {
    console.error(`[check-version-sync] ERROR: No version heading found in ${mod.name}/changelog.md`);
    process.exit(1);
  }

  if (!manifestVer) {
    console.error(`[check-version-sync] ERROR: No version found in ${mod.name}/${mod.manifestFmt}`);
    process.exit(1);
  }

  if (changelogVer !== manifestVer) {
    mismatches.push({
      name:         mod.name,
      changelogVer,
      manifestVer,
      manifestFmt:  mod.manifestFmt,
    });
  }
}

if (mismatches.length > 0) {
  console.error('[check-version-sync] Version mismatch detected:\n');
  for (const m of mismatches) {
    console.error(`  ${m.name}: changelog says v${m.changelogVer}, ${m.manifestFmt} says v${m.manifestVer}`);
  }
  console.error('\nRun this to fix:  node scripts/cli.js build-maintain\n');
  process.exit(1);
}

console.log('[check-version-sync] All module versions are in sync.');
process.exit(0);

```
###  Path: `/scripts/cli.js`

```js
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

```
###  Path: `/scripts/extract-changelog-entry.js`

```js
'use strict';

/**
 * extract-changelog-entry.js
 *
 * Parses changelog.md from the workspace root and extracts the topmost entry.
 *
 * Outputs:
 *   - When run locally (GITHUB_OUTPUT not set): prints JSON to stdout.
 *   - When run in GitHub Actions (GITHUB_OUTPUT is set): writes step outputs
 *     (version, title, body) in the multiline heredoc format expected by the
 *     Actions runner.
 *
 * Exit codes:
 *   0 — success
 *   1 — changelog.md not found, unreadable, or malformed (no parseable entry)
 */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Locate changelog.md (always relative to workspace root = parent of scripts/)
// ---------------------------------------------------------------------------
const WORKSPACE_ROOT = path.resolve(__dirname, '..');
const CHANGELOG_PATH = path.join(WORKSPACE_ROOT, 'changelog.md');

// ---------------------------------------------------------------------------
// Read file
// ---------------------------------------------------------------------------
let raw;
try {
  raw = fs.readFileSync(CHANGELOG_PATH, 'utf8');
} catch (err) {
  process.stderr.write(`extract-changelog-entry: cannot read changelog.md: ${err.message}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Parse: find topmost ## v* entry
// ---------------------------------------------------------------------------
// Normalise line endings so the regex anchor ($) works on Windows checkouts
const lines = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

// Header pattern: ## v{version} [-—] {title} (optional date in parens)
const HEADER_RE = /^## (v[\d.]+(?:-\w+)?)\s+[-\u2014]\s+(.+?)(?:\s*\(\d{4}-\d{2}-\d{2}\))?$/;

let version = null;
let title = null;
let bodyLines = [];
let inEntry = false;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];

  if (!inEntry) {
    const m = HEADER_RE.exec(line);
    if (m) {
      version = m[1];
      title = m[2].trim();
      inEntry = true;
    }
  } else {
    // Stop at the next ## heading
    if (line.startsWith('## ')) {
      break;
    }
    // Collect non-empty lines as body
    const trimmed = line.trim();
    if (trimmed.length > 0) {
      bodyLines.push(trimmed);
    }
  }
}

// ---------------------------------------------------------------------------
// Validate
// ---------------------------------------------------------------------------
if (!version || !title) {
  process.stderr.write(
    'extract-changelog-entry: no parseable ## v* entry found in changelog.md\n'
  );
  process.exit(1);
}

const body = bodyLines.join('\n');

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------
const githubOutput = process.env.GITHUB_OUTPUT;

if (githubOutput) {
  // GitHub Actions multiline heredoc format
  // https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/passing-information-between-jobs
  const delimiter = 'EOF_BODY';
  const outputContent =
    `version=${version}\n` +
    `title=${title}\n` +
    `body<<${delimiter}\n${body}\n${delimiter}\n`;

  try {
    fs.appendFileSync(githubOutput, outputContent, 'utf8');
  } catch (err) {
    process.stderr.write(
      `extract-changelog-entry: cannot write to GITHUB_OUTPUT file: ${err.message}\n`
    );
    process.exit(1);
  }
} else {
  // Local: pretty-print JSON for inspection
  const result = { version, title, body };
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

```
###  Path: `/scripts/install-hooks.js`

```js
#!/usr/bin/env node

/**
 * scripts/install-hooks.js
 *
 * Activates the workspace Git hooks by pointing core.hooksPath at .githooks/.
 * Run this once after cloning the repository to enable the pre-commit
 * persona freshness check.
 *
 * Usage (from workspace root):
 *   node scripts/install-hooks.js
 */

'use strict';

const { execSync } = require('child_process');

execSync('git config core.hooksPath .githooks', { stdio: 'inherit' });
console.log('Git hooks installed. Pre-commit persona guard active.');

```
###  Path: `/scripts/kill-orchestrator.js`

```js
#!/usr/bin/env node

/**
 * scripts/kill-orchestrator.js
 *
 * Detect and terminate stale orchestrator processes. Cleans up stale
 * .orchestrator.lock files after killing.
 *
 * Usage:
 *   node scripts/kill-orchestrator.js            Interactive — prompts before killing
 *   node scripts/kill-orchestrator.js --force      Kill without prompting (agent use)
 *   node scripts/kill-orchestrator.js --json       List processes as JSON; no kill
 *   node scripts/kill-orchestrator.js --depth N    Scan last N log files for lock cleanup (default: 20)
 *   node scripts/kill-orchestrator.js --help       Show this help
 *
 * Exit codes:
 *   0 — No processes found, or processes successfully killed
 *   1 — Processes found but user declined to kill (interactive mode)
 *
 * No external dependencies — stdlib only (fs, path, child_process, readline).
 */

'use strict';

const fs            = require('fs');
const path          = require('path');
const readline      = require('readline');
const { spawnSync } = require('child_process');

// ─── Paths ────────────────────────────────────────────────────────────────────

const WORKSPACE_ROOT = path.resolve(__dirname, '..');
const LOGS_DIR       = path.join(WORKSPACE_ROOT, 'orchestrator', 'logs');

// ─── Platform ─────────────────────────────────────────────────────────────────

const IS_WIN = process.platform === 'win32';

// ─── Tunable constants ────────────────────────────────────────────────────────

const SIGTERM_GRACE_MS  = 3000; // ms to wait before escalating to SIGKILL
const DEFAULT_LOG_DEPTH = 20;   // number of recent log files to scan for lock cleanup

// ─── ANSI colors ──────────────────────────────────────────────────────────────

const USE_COLOR = process.stdout.isTTY;

const C = {
  dim:    (s) => USE_COLOR ? `\x1b[2m${s}\x1b[0m` : s,
  bold:   (s) => USE_COLOR ? `\x1b[1m${s}\x1b[0m` : s,
  red:    (s) => USE_COLOR ? `\x1b[31m${s}\x1b[0m` : s,
  yellow: (s) => USE_COLOR ? `\x1b[33m${s}\x1b[0m` : s,
  green:  (s) => USE_COLOR ? `\x1b[32m${s}\x1b[0m` : s,
  cyan:   (s) => USE_COLOR ? `\x1b[36m${s}\x1b[0m` : s,
};

// ─── Help ─────────────────────────────────────────────────────────────────────

const HELP = `
Usage: node scripts/kill-orchestrator.js [options]

Detect and terminate stale orchestrator processes.
Also cleans up stale .orchestrator.lock files from recently-used plan directories.

Flags:
  (default)     List found processes and prompt for confirmation before killing
  --force       Kill all found processes without prompting (for agent/CI use)
  --json        Output process list as JSON array; does NOT kill anything
  --depth N     Scan last N log files for lock-file cleanup (default: 20); must be a positive integer
  --help, -h    Show this help

Exit codes:
  0   No processes found, or processes successfully killed
  1   Processes found but user declined (interactive mode)

Examples:
  node scripts/kill-orchestrator.js
  node scripts/kill-orchestrator.js --force
  node scripts/kill-orchestrator.js --json
  node scripts/kill-orchestrator.js --depth 5
`;

// ─── Argument parser ──────────────────────────────────────────────────────────

function parseArgs(argv) {
  const depthIdx = argv.indexOf('--depth');
  let depth = DEFAULT_LOG_DEPTH;
  if (depthIdx !== -1) {
    const raw = argv[depthIdx + 1];
    const parsed = parseInt(raw, 10);
    if (raw === undefined || isNaN(parsed) || parsed <= 0) {
      const got = raw === undefined ? 'nothing' : JSON.stringify(raw);
      console.error(`Error: --depth requires a positive integer (got ${got})`);
      process.exit(1);
    }
    depth = parsed;
  }
  return {
    force: argv.includes('--force'),
    json:  argv.includes('--json'),
    help:  argv.includes('--help') || argv.includes('-h'),
    depth,
  };
}

// ─── Process detection ────────────────────────────────────────────────────────

/**
 * Get elapsed time for a PID using `ps -o etime= <pid>`.
 *
 * @param {number} pid
 * @returns {string}  e.g. "01:23" or "2-04:05" — empty string on failure
 */
function getElapsed(pid) {
  const r = spawnSync('ps', ['-o', 'etime=', String(pid)], { encoding: 'utf8', shell: false });
  return r.status === 0 ? r.stdout.trim() : '';
}

/**
 * Detect running orchestrator processes using pgrep.
 * Filters out: this script, pgrep itself, preflight-orchestrator.
 *
 * Returns an array of { pid, cmdline, elapsed } objects.
 * Returns null when pgrep is not available (unexpected on macOS/Linux).
 *
 * @returns {Array<{pid: number, cmdline: string, elapsed: string}>|null}
 */
function detectProcesses() {
  const r = spawnSync('pgrep', ['-fl', 'orchestrate'], { encoding: 'utf8', shell: false });

  // pgrep exits 1 when no matches — that is fine (not an error)
  if (r.error) return null; // pgrep not available

  if (!r.stdout || !r.stdout.trim()) return [];

  const SELF_SCRIPT = path.basename(__filename);
  const procs = [];

  for (const line of r.stdout.trim().split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Filter out this script, pgrep, and preflight-orchestrator
    if (trimmed.includes('kill-orchestrator'))   continue;
    if (trimmed.includes('preflight-orchestrator')) continue;
    if (trimmed.includes('pgrep'))               continue;

    // pgrep -fl output: "<pid> <cmdline>"
    const spaceIdx = trimmed.indexOf(' ');
    if (spaceIdx === -1) continue;

    const pid     = parseInt(trimmed.slice(0, spaceIdx), 10);
    const cmdline = trimmed.slice(spaceIdx + 1).trim();
    if (isNaN(pid)) continue;

    const elapsed = getElapsed(pid);
    procs.push({ pid, cmdline: cmdline.slice(0, 120), elapsed });
  }

  return procs;
}

// ─── Process display ──────────────────────────────────────────────────────────

function printProcess(proc) {
  const elapsed = proc.elapsed ? C.dim(` (running ${proc.elapsed})`) : '';
  console.log(`  ${C.yellow('PID ' + proc.pid)}${elapsed}`);
  console.log(`  ${C.dim(proc.cmdline)}`);
}

// ─── Kill logic ───────────────────────────────────────────────────────────────

/**
 * Check if a process is still alive (ESRCH = not found).
 *
 * @param {number} pid
 * @returns {boolean}
 */
function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code !== 'ESRCH';
  }
}

/**
 * Kill a single process: SIGTERM first, then SIGKILL after 3s if still alive.
 *
 * @param {number} pid
 * @returns {Promise<void>}
 */
async function killProcess(pid) {
  try {
    process.kill(pid, 'SIGTERM');
  } catch (e) {
    if (e.code === 'ESRCH') return; // already gone
    throw e;
  }

  // Wait for graceful exit before escalating to SIGKILL
  await new Promise((resolve) => setTimeout(resolve, SIGTERM_GRACE_MS));

  if (isAlive(pid)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch (e) {
      if (e.code !== 'ESRCH') throw e;
    }
  }
}

// ─── Lock file cleanup ────────────────────────────────────────────────────────

/**
 * Scan recent JSONL log files for plan paths (via run_start entries).
 * Returns a set of unique plan directory paths.
 *
 * @param {number} depth  Number of recent log files to scan (default: DEFAULT_LOG_DEPTH)
 * @returns {Set<string>}
 */
function findRecentPlanDirs(depth) {
  const planDirs = new Set();
  if (!fs.existsSync(LOGS_DIR)) return planDirs;

  const logFiles = fs
    .readdirSync(LOGS_DIR)
    .filter((f) => f.endsWith('.jsonl'))
    .sort()
    .slice(-depth); // check last N log files

  for (const file of logFiles) {
    const filePath = path.join(LOGS_DIR, file);
    let content;
    try { content = fs.readFileSync(filePath, 'utf8'); } catch { continue; }

    for (const line of content.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      try {
        const entry = JSON.parse(t);
        if (entry.action === 'run_start' && entry.plan) {
          // plan is the plan FILE path; lock is in the plan's parent directory
          const planFile = entry.plan;
          const planDir  = fs.statSync(planFile).isFile()
            ? path.dirname(planFile)
            : planFile;
          // Defence-in-depth: only clean up locks within the workspace root.
          // Prevents a malicious log entry from targeting arbitrary filesystem paths.
          if (!path.resolve(planDir).startsWith(WORKSPACE_ROOT)) continue;
          planDirs.add(planDir);
        }
      } catch { /* malformed / file not found — skip */ }
    }
  }

  return planDirs;
}

/**
 * Remove stale .orchestrator.lock files from recently-used plan directories.
 *
 * @param {number} depth  Passed through to findRecentPlanDirs
 * @returns {string[]}  Paths of lock files removed
 */
function cleanupStaleLocks(depth) {
  const removed = [];
  let planDirs;
  try { planDirs = findRecentPlanDirs(depth); } catch { return removed; }

  for (const dir of planDirs) {
    const lockPath = path.join(dir, '.orchestrator.lock');
    if (fs.existsSync(lockPath)) {
      try {
        fs.rmSync(lockPath);
        removed.push(lockPath);
      } catch { /* ignore permission errors */ }
    }
  }

  return removed;
}

// ─── Interactive prompt ───────────────────────────────────────────────────────

/**
 * Prompt the user for a y/N answer.
 *
 * @param {string} question
 * @returns {Promise<boolean>}
 */
function askYesNo(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'y');
    });
  });
}

// ─── Windows advisory ─────────────────────────────────────────────────────────

function printWindowsAdvisory() {
  console.log('\nAutomatic process detection is not supported on Windows.');
  console.log('To find and stop stale orchestrator processes manually:');
  console.log('  1. Open Task Manager (Ctrl+Shift+Esc) → Details tab');
  console.log('  2. Look for python.exe processes running "orchestrate"');
  console.log('  3. Right-click → End Task');
  console.log('');
  console.log('Alternatively, use PowerShell:');
  console.log('  Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like "*orchestrate*" }');
  console.log('  Stop-Process -Id <PID>');
  console.log('');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help) {
    console.log(HELP);
    process.exit(0);
  }

  // ── Windows: advisory only ───────────────────────────────────────────────
  if (IS_WIN) {
    printWindowsAdvisory();
    process.exit(0);
  }

  // ── Detect processes ─────────────────────────────────────────────────────
  const procs = detectProcesses();

  if (procs === null) {
    console.error('pgrep not found — cannot detect orchestrator processes.');
    process.exit(1);
  }

  // ── JSON mode — just list, no kill ────────────────────────────────────────
  if (opts.json) {
    console.log(JSON.stringify(procs, null, 2));
    process.exit(0);
  }

  // ── No processes found ────────────────────────────────────────────────────
  if (procs.length === 0) {
    console.log('No orchestrator processes found.');
    process.exit(0);
  }

  // ── List found processes ──────────────────────────────────────────────────
  console.log(`\nFound ${C.bold(String(procs.length))} orchestrator process${procs.length === 1 ? '' : 'es'}:\n`);
  for (const proc of procs) {
    printProcess(proc);
    console.log('');
  }

  // ── Interactive confirmation ──────────────────────────────────────────────
  if (!opts.force) {
    const confirmed = await askYesNo(
      `Kill ${procs.length === 1 ? 'this process' : `all ${procs.length} processes`}? [y/N] `,
    );
    if (!confirmed) {
      console.log(C.dim('Cancelled — no processes killed.'));
      process.exit(1);
    }
  }

  // ── Kill ──────────────────────────────────────────────────────────────────
  console.log('');
  for (const proc of procs) {
    process.stdout.write(`Sending SIGTERM to PID ${proc.pid}…`);
    try {
      await killProcess(proc.pid);
      if (!isAlive(proc.pid)) {
        process.stdout.write(C.green(' killed\n'));
      } else {
        process.stdout.write(C.yellow(' process may still be running\n'));
      }
    } catch (e) {
      process.stdout.write(C.red(` error: ${e.message}\n`));
    }
  }

  // ── Lock file cleanup ─────────────────────────────────────────────────────
  const removed = cleanupStaleLocks(opts.depth);
  if (removed.length > 0) {
    console.log('');
    for (const p of removed) {
      const rel = path.relative(WORKSPACE_ROOT, p);
      console.log(C.dim(`Removed lock: ${rel.startsWith('..') ? p : rel}`));
    }
  }

  console.log('');
  process.exit(0);
}

main().catch((err) => {
  console.error(`Unexpected error: ${err.message}`);
  process.exit(1);
});

```
###  Path: `/scripts/normalize-ctx-paths.js`

```js
#!/usr/bin/env node
'use strict';

/**
 * normalize-ctx-paths.js
 *
 * Post-processes CTX-generated Markdown files in .context/ to normalise
 * two OS-dependent artefacts so output is stable across platforms:
 *
 *   1. **Path separators** — CTX emits OS-native separators in its
 *      "###  Path:" header lines and directory-tree drawings.  On Windows
 *      these contain backslashes; we replace them with forward slashes.
 *
 *   2. **Line endings** — On Windows the CTX binary (or Node `writeFileSync`)
 *      may produce CRLF line endings.  We normalise every file to LF so
 *      regenerating on a different OS never causes a full-file diff.
 *
 * Fenced code blocks are left untouched by rule (1) so source-code
 * content is never mangled.  Rule (2) applies unconditionally.
 *
 * Usage:
 *   node scripts/normalize-ctx-paths.js          # default: .context/
 *   node scripts/normalize-ctx-paths.js <dir>    # custom directory
 */

const fs   = require('fs');
const path = require('path');

const targetDir = process.argv[2]
  || path.join(__dirname, '..', '.context');

if (!fs.existsSync(targetDir)) {
  console.error(`Directory not found: ${targetDir}`);
  process.exit(1);
}

/** Collect all .md files recursively. */
function collectMarkdown(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectMarkdown(full));
    } else if (entry.name.endsWith('.md')) {
      results.push(full);
    }
  }
  return results;
}

// Patterns that CTX generates outside fenced code blocks where
// backslashes represent path separators (not escape sequences):
//
//   ###  Path: `\mcp-server\src\tools/begin-work.ts`
//   └── mcp-server\src\
//
// We match these specifically to avoid replacing backslashes in
// inline code or documentation text (e.g. "\n", "\d", regex escapes).

/** Regex for CTX "Path:" header lines: ###  Path: `…` */
const PATH_HEADER_RE = /^(#{1,6}\s+Path:\s*`)([^`]+)(`.*)$/;

/** Regex for CTX directory-structure lines (└──, ├──, │) with paths */
const TREE_LINE_RE = /^(\s*(?:└──|├──|│\s+(?:└──|├──))\s+)(.+)$/;

/**
 * Normalize backslash path separators in CTX structural lines only.
 * Skips all content inside fenced code blocks.
 *
 * Returns the updated content string, or null if nothing changed.
 */
function normalizePaths(content) {
  const lines   = content.split('\n');
  let inFence   = false;
  let changed   = false;

  for (let i = 0; i < lines.length; i++) {
    // Track fenced code blocks (``` or ~~~)
    if (/^(`{3,}|~{3,})/.test(lines[i])) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    let m;

    // ###  Path: `\dir\file.ts`  →  ###  Path: `/dir/file.ts`
    if ((m = lines[i].match(PATH_HEADER_RE))) {
      const normalized = m[2].replace(/\\/g, '/');
      if (normalized !== m[2]) {
        lines[i] = m[1] + normalized + m[3];
        changed = true;
      }
      continue;
    }

    // └── dir\subdir\  →  └── dir/subdir/
    if ((m = lines[i].match(TREE_LINE_RE))) {
      const normalized = m[2].replace(/\\/g, '/');
      if (normalized !== m[2]) {
        lines[i] = m[1] + normalized;
        changed = true;
      }
    }
  }

  return changed ? lines.join('\n') : null;
}

// ── Main ────────────────────────────────────────────────────────────────────────

const files = collectMarkdown(targetDir);
let pathsFixed    = 0;
let newlinesFixed = 0;

for (const file of files) {
  const raw     = fs.readFileSync(file, 'utf8');
  const content = raw.replace(/\r/g, '');       // normalise to LF
  const hadCR   = content !== raw;

  const updated = normalizePaths(content);      // path-separator pass

  if (updated !== null || hadCR) {
    fs.writeFileSync(file, updated ?? content, 'utf8');
    if (updated !== null) pathsFixed++;
    if (hadCR) newlinesFixed++;
    const rel = path.relative(process.cwd(), file).replace(/\\/g, '/');
    console.log(`  normalized: ${rel}`);
  }
}

const total = pathsFixed + newlinesFixed;
if (total > 0) {
  const parts = [];
  if (pathsFixed)    parts.push(`paths in ${pathsFixed} file(s)`);
  if (newlinesFixed) parts.push(`line endings in ${newlinesFixed} file(s)`);
  console.log(`\nNormalized ${parts.join(', ')}.`);
} else {
  console.log('All files already normalized.');
}

```
###  Path: `/scripts/package-personas.js`

```js
'use strict';

/**
 * package-personas.js
 *
 * Builds the standalone personas and packages them into ZIP archives
 * under /dist. Zero external dependencies — ZIP is written in pure Node.js
 * using the built-in zlib module, so this works identically on Windows,
 * macOS, and Linux.
 *
 * Usage (from workspace root):
 *   node scripts/package-personas.js
 *   node scripts/package-personas.js --skip-build        # zip existing output only
 *   node scripts/package-personas.js --version v1.2.3    # override version stamp
 *
 * Outputs (in dist/):
 *   ai-insights-personas-vscode-<version>.zip
 *   ai-insights-personas-claudecode-<version>.zip
 */

const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execSync } = require('child_process');

const WORKSPACE_ROOT = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------
const args             = process.argv.slice(2);
const SKIP_BUILD       = args.includes('--skip-build');
const versionArgIdx    = args.indexOf('--version');
const VERSION_OVERRIDE = versionArgIdx !== -1 ? args[versionArgIdx + 1] : null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function die(msg) {
  process.stderr.write(`package-personas: ${msg}\n`);
  process.exit(1);
}

function log(msg) {
  process.stdout.write(`${msg}\n`);
}

// ---------------------------------------------------------------------------
// Parse version from changelog.md (mirrors extract-changelog-entry.js logic)
// ---------------------------------------------------------------------------
function parseVersion() {
  if (VERSION_OVERRIDE) return VERSION_OVERRIDE;

  const changelogPath = path.join(WORKSPACE_ROOT, 'changelog.md');
  let raw;
  try {
    raw = fs.readFileSync(changelogPath, 'utf8');
  } catch (err) {
    die(`Cannot read changelog.md: ${err.message}`);
  }

  // Matches: ## v1.2.3 — Title  or  ## v1.2.3 - Title
  const HEADER_RE = /^## (v[\d.]+(?:-\w+)?)\s+[-\u2014]\s+/m;
  const m = HEADER_RE.exec(raw);
  if (!m) die('No parseable ## v* entry found in changelog.md');
  return m[1];
}

// ---------------------------------------------------------------------------
// CRC-32 (required by ZIP spec)
// ---------------------------------------------------------------------------
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------------------
// ZIP builder — pure Node.js, no external dependencies
//
// Spec references:
//   https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT
//   DEFLATE (method 8) via Node's built-in zlib.deflateRawSync
// ---------------------------------------------------------------------------

/**
 * Build a complete ZIP file buffer from an array of file entries.
 * Each entry: { name: string, data: Buffer }
 * Stores only the filename (no directory prefix), mirroring `zip -j`.
 */
function buildZip(entries) {
  const localParts  = [];  // interleaved [headerBuf, dataBuf, ...]
  const centralDirs = [];
  const offsets     = [];
  let   offset      = 0;

  // Fixed DOS date/time: 2000-01-01 00:00:00 — deterministic, no TZ issues
  const DOS_TIME = 0x0000;
  const DOS_DATE = 0x2821;

  for (const entry of entries) {
    const nameBytes  = Buffer.from(entry.name, 'utf8');
    const rawData    = entry.data;
    const crc        = crc32(rawData);
    const deflated   = zlib.deflateRawSync(rawData, { level: 6 });
    const useDeflate = deflated.length < rawData.length;
    const compData   = useDeflate ? deflated : rawData;
    const method     = useDeflate ? 8 : 0;   // 8 = DEFLATE, 0 = STORE

    // ---- Local file header (30 bytes + filename) ----
    const local = Buffer.alloc(30 + nameBytes.length);
    local.writeUInt32LE(0x04034b50, 0);          // PK\x03\x04
    local.writeUInt16LE(20, 4);                  // version needed (2.0)
    local.writeUInt16LE(0, 6);                   // flags
    local.writeUInt16LE(method, 8);              // compression method
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compData.length, 18);    // compressed size
    local.writeUInt32LE(rawData.length, 22);     // uncompressed size
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);                  // extra field length
    nameBytes.copy(local, 30);

    offsets.push(offset);
    localParts.push(local, compData);
    offset += local.length + compData.length;

    // ---- Central directory entry (46 bytes + filename) ----
    const cd = Buffer.alloc(46 + nameBytes.length);
    cd.writeUInt32LE(0x02014b50, 0);             // PK\x01\x02
    cd.writeUInt16LE(20, 4);                     // version made by
    cd.writeUInt16LE(20, 6);                     // version needed
    cd.writeUInt16LE(0, 8);                      // flags
    cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(DOS_TIME, 12);
    cd.writeUInt16LE(DOS_DATE, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(compData.length, 20);
    cd.writeUInt32LE(rawData.length, 24);
    cd.writeUInt16LE(nameBytes.length, 28);
    cd.writeUInt16LE(0, 30);                     // extra field length
    cd.writeUInt16LE(0, 32);                     // comment length
    cd.writeUInt16LE(0, 34);                     // disk number start
    cd.writeUInt16LE(0, 36);                     // internal attributes
    cd.writeUInt32LE(0, 38);                     // external attributes
    cd.writeUInt32LE(offsets[offsets.length - 1], 42); // local header offset
    nameBytes.copy(cd, 46);

    centralDirs.push(cd);
  }

  const cdOffset = offset;
  const cdSize   = centralDirs.reduce((s, b) => s + b.length, 0);

  // ---- End of central directory record (22 bytes) ----
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);             // PK\x05\x06
  eocd.writeUInt16LE(0, 4);                      // disk number
  eocd.writeUInt16LE(0, 6);                      // disk with start of CD
  eocd.writeUInt16LE(entries.length, 8);         // entries on this disk
  eocd.writeUInt16LE(entries.length, 10);        // total entries
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  eocd.writeUInt16LE(0, 20);                     // comment length

  return Buffer.concat([...localParts, ...centralDirs, eocd]);
}

// ---------------------------------------------------------------------------
// Collect .md files from a directory (sorted, filenames only — mirrors zip -j)
// ---------------------------------------------------------------------------
function collectMdFiles(dir) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch (err) {
    die(`Cannot read directory ${dir}: ${err.message}`);
  }
  return names
    .filter(f => f.endsWith('.md'))
    .sort()
    .map(f => ({
      name: f,
      data: fs.readFileSync(path.join(dir, f)),
    }));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const version = parseVersion();
log(`Version: ${version}`);

if (!SKIP_BUILD) {
  log('\nBuilding standalone personas...');
  try {
    execSync('node scripts/build-personas.js --suite standalone --target all --strict', {
      cwd: WORKSPACE_ROOT,
      stdio: 'inherit',
    });
  } catch {
    die('build-personas.js failed — aborting packaging.');
  }
} else {
  log('Skipping build (--skip-build).');
}

const distDir = path.join(WORKSPACE_ROOT, 'dist');
fs.mkdirSync(distDir, { recursive: true });
log(`\nOutput directory: dist/`);

const TARGETS = [
  { dir: 'personas/standalone/vs-code',     label: 'VS Code',     slug: 'vscode'     },
  { dir: 'personas/standalone/claude-code', label: 'Claude Code', slug: 'claudecode' },
];

for (const target of TARGETS) {
  const srcDir  = path.join(WORKSPACE_ROOT, target.dir);
  const zipName = `ai-insights-personas-${target.slug}-${version}.zip`;
  const zipPath = path.join(distDir, zipName);

  log(`\nPackaging ${target.label} personas → dist/${zipName}`);

  const files = collectMdFiles(srcDir);
  if (files.length === 0) die(`No .md files found in ${target.dir}`);
  log(`  ${files.length} file(s): ${files.map(f => f.name).join(', ')}`);

  const zipBuf = buildZip(files);
  fs.writeFileSync(zipPath, zipBuf);
  log(`  Written: ${zipBuf.length.toLocaleString()} bytes`);
}

log('\nDone.');

```
###  Path: `/scripts/preflight-orchestrator.js`

```js
#!/usr/bin/env node

/**
 * scripts/preflight-orchestrator.js
 *
 * Pre-flight validation for the AI Insights orchestrator.
 *
 * Checks that the orchestrator environment is ready to run:
 *   - Python venv exists with `orchestrate` binary
 *   - .env is configured with at least one API key
 *   - MCP server dist is up to date
 *   - No conflicting orchestrator process is already running
 *   - (Optional) Plan file exists (when --plan <path> is given)
 *
 * Usage:
 *   node scripts/preflight-orchestrator.js
 *   node scripts/preflight-orchestrator.js --plan path/to/plan.md
 *   node scripts/preflight-orchestrator.js --plan path/to/plan.md --json
 *
 * Exit codes:
 *   0 — all checks pass
 *   1 — one or more checks failed
 */

'use strict';

const path = require('path');
const fs   = require('fs');
const { spawnSync } = require('child_process');

// ─── Constants ────────────────────────────────────────────────────────────────

const WORKSPACE_ROOT   = path.resolve(__dirname, '..');
const ORCHESTRATOR_DIR = path.join(WORKSPACE_ROOT, 'orchestrator');
const MCP_SRC          = path.join(WORKSPACE_ROOT, 'mcp-server', 'src');
const MCP_DIST_SENTINEL = path.join(WORKSPACE_ROOT, 'mcp-server', 'dist', 'index.js');
const IS_WIN           = process.platform === 'win32';
const VENV_DIR         = path.join(ORCHESTRATOR_DIR, '.venv');
const ENV_FILE         = path.join(ORCHESTRATOR_DIR, '.env');

function venvBin(name) {
  return IS_WIN
    ? path.join(VENV_DIR, 'Scripts', `${name}.exe`)
    : path.join(VENV_DIR, 'bin', name);
}

// ─── ANSI helpers ─────────────────────────────────────────────────────────────

const isTTY = process.stdout.isTTY;
const C = {
  green:  (s) => isTTY ? `\x1b[32m${s}\x1b[0m` : s,
  red:    (s) => isTTY ? `\x1b[31m${s}\x1b[0m` : s,
  yellow: (s) => isTTY ? `\x1b[33m${s}\x1b[0m` : s,
  dim:    (s) => isTTY ? `\x1b[2m${s}\x1b[0m` : s,
  bold:   (s) => isTTY ? `\x1b[1m${s}\x1b[0m` : s,
};

// ─── Args ─────────────────────────────────────────────────────────────────────

function parseArgs() {
  const argv = process.argv.slice(2);
  let planPath = null;
  let jsonOutput = false;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--plan' && argv[i + 1]) {
      planPath = argv[++i];
    } else if (argv[i] === '--json') {
      jsonOutput = true;
    }
  }

  return { planPath, jsonOutput };
}

// ─── Check implementations ───────────────────────────────────────────────────

/**
 * @typedef {{ name: string, pass: boolean, detail: string, fix?: string }} CheckResult
 */

/** Check that the Python venv exists and contains the orchestrate binary. */
function checkVenv() {
  if (!fs.existsSync(VENV_DIR)) {
    return {
      name: 'venv',
      pass: false,
      detail: '.venv directory not found',
      fix: 'node scripts/cli.js setup --components orchestrator',
    };
  }

  const orchestrateBin = venvBin('orchestrate');
  if (!fs.existsSync(orchestrateBin)) {
    return {
      name: 'venv',
      pass: false,
      detail: 'orchestrate binary not found in .venv',
      fix: 'node scripts/cli.js setup --components orchestrator --force',
    };
  }

  return { name: 'venv', pass: true, detail: 'orchestrate binary found' };
}

/** Check that .env exists and contains at least one API key. */
function checkEnv() {
  if (!fs.existsSync(ENV_FILE)) {
    return {
      name: 'env',
      pass: false,
      detail: '.env file not found',
      fix: 'cp orchestrator/.env.example orchestrator/.env  # then edit it',
    };
  }

  const content = fs.readFileSync(ENV_FILE, 'utf8');
  const lines = content.split('\n');

  // Parse non-comment, non-empty KEY=VALUE lines
  const vars = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (val) vars[key] = true;
  }

  if (!vars.ANTHROPIC_API_KEY && !vars.GOOGLE_API_KEY) {
    return {
      name: 'env',
      pass: false,
      detail: 'No API key set in .env (need ANTHROPIC_API_KEY or GOOGLE_API_KEY)',
      fix: 'Set the appropriate API key in orchestrator/.env',
    };
  }

  return { name: 'env', pass: true, detail: 'API key configured' };
}

/** Check that MCP server dist is up to date. */
function checkMcpDist() {
  if (!fs.existsSync(MCP_DIST_SENTINEL)) {
    return {
      name: 'mcp-dist',
      pass: false,
      detail: 'mcp-server/dist/index.js not found',
      fix: 'cd mcp-server && npm run build',
    };
  }

  const sentinelMtime = fs.statSync(MCP_DIST_SENTINEL).mtimeMs;

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

  if (latestMtime(MCP_SRC) > sentinelMtime) {
    return {
      name: 'mcp-dist',
      pass: false,
      detail: 'mcp-server/dist is stale (source is newer)',
      fix: 'cd mcp-server && npm run build',
    };
  }

  return { name: 'mcp-dist', pass: true, detail: 'mcp-server/dist is up to date' };
}

/** Check that no other orchestrator process is running. */
function checkNoConflict() {
  if (IS_WIN) {
    // On Windows, skip ps-based check — the lock file check below is sufficient
    return { name: 'no-conflict', pass: true, detail: 'process check skipped (Windows)' };
  }

  const r = spawnSync('pgrep', ['-fl', 'orchestrate'], { encoding: 'utf8', shell: false });
  if (r.status === 0 && r.stdout.trim()) {
    // Filter out this script and grep itself
    const procs = r.stdout
      .trim()
      .split('\n')
      .filter((line) => !line.includes('preflight-orchestrator') && !line.includes('pgrep'));
    if (procs.length > 0) {
      return {
        name: 'no-conflict',
        pass: false,
        detail: `Orchestrator process already running (${procs.length} found)`,
        fix: 'Kill existing process first, or wait for it to finish',
      };
    }
  }

  return { name: 'no-conflict', pass: true, detail: 'no running orchestrator process' };
}

/** Check that the plan file exists (when --plan is given). */
function checkPlanFile(planPath) {
  const resolved = path.resolve(planPath);
  if (!fs.existsSync(resolved)) {
    return {
      name: 'plan-file',
      pass: false,
      detail: `Plan file not found: ${resolved}`,
    };
  }

  return { name: 'plan-file', pass: true, detail: path.basename(resolved) };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const { planPath, jsonOutput } = parseArgs();

  /** @type {CheckResult[]} */
  const results = [
    checkVenv(),
    checkEnv(),
    checkMcpDist(),
    checkNoConflict(),
  ];

  if (planPath) {
    results.push(checkPlanFile(planPath));
  }

  const allPass = results.every((r) => r.pass);

  // ─── JSON output ──────────────────────────────────────────────────────
  if (jsonOutput) {
    const output = { ok: allPass, checks: results };
    console.log(JSON.stringify(output, null, 2));
    process.exit(allPass ? 0 : 1);
  }

  // ─── Human-readable output ────────────────────────────────────────────
  console.log('');
  console.log(C.bold('Orchestrator Pre-Flight Checks'));
  console.log('');

  for (const r of results) {
    const icon  = r.pass ? C.green('✓') : C.red('✗');
    const label = r.name.padEnd(14);
    const detail = r.pass ? C.dim(r.detail) : C.red(r.detail);
    console.log(`  ${icon} ${label} ${detail}`);
    if (!r.pass && r.fix) {
      console.log(`               ${C.yellow('Fix:')} ${r.fix}`);
    }
  }

  console.log('');
  if (allPass) {
    console.log(C.green('All pre-flight checks passed.'));
  } else {
    const failCount = results.filter((r) => !r.pass).length;
    console.log(C.red(`${failCount} check(s) failed. Resolve the issues above before launching.`));
  }
  console.log('');

  process.exit(allPass ? 0 : 1);
}

main();

```
###  Path: `/scripts/read-log.js`

```js
#!/usr/bin/env node

/**
 * scripts/read-log.js
 *
 * Structured, cross-platform reader for orchestrator JSONL run logs.
 * Replaces ad-hoc jq/grep pipelines with simple flag-based queries.
 *
 * Usage:
 *   node scripts/read-log.js                        Last 20 entries, most recent log
 *   node scripts/read-log.js --errors               Only ERROR + WARNING entries
 *   node scripts/read-log.js --actions route        Filter by action type(s)
 *   node scripts/read-log.js --wp WP-003            Filter to a specific WP
 *   node scripts/read-log.js --summary              One-line run overview
 *   node scripts/read-log.js --slug my-project      Target latest log matching slug
 *   node scripts/read-log.js --file path/to/log     Explicit log file
 *   node scripts/read-log.js --format json          JSON array output
 *   node scripts/read-log.js --help                 Show this help
 *
 * No external dependencies — stdlib only (fs, path).
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ─── Paths ────────────────────────────────────────────────────────────────────

const WORKSPACE_ROOT = path.resolve(__dirname, '..');
const LOGS_DIR       = path.join(WORKSPACE_ROOT, 'orchestrator', 'logs');

// ─── ANSI colors (disabled when stdout is not a TTY) ─────────────────────────

const USE_COLOR = process.stdout.isTTY;

const C = {
  reset:  (s) => USE_COLOR ? `\x1b[0m${s}\x1b[0m` : s,
  dim:    (s) => USE_COLOR ? `\x1b[2m${s}\x1b[0m` : s,
  bold:   (s) => USE_COLOR ? `\x1b[1m${s}\x1b[0m` : s,
  red:    (s) => USE_COLOR ? `\x1b[31m${s}\x1b[0m` : s,
  yellow: (s) => USE_COLOR ? `\x1b[33m${s}\x1b[0m` : s,
  green:  (s) => USE_COLOR ? `\x1b[32m${s}\x1b[0m` : s,
  cyan:   (s) => USE_COLOR ? `\x1b[36m${s}\x1b[0m` : s,
};

// ─── Help ─────────────────────────────────────────────────────────────────────

const HELP = `
Usage: node scripts/read-log.js [options]

Query and filter orchestrator JSONL run logs.

Log Selection:
  (default)           Most recent .jsonl file in orchestrator/logs/
  --slug <name>       Latest log whose filename ends with -<name>.jsonl
  --file <path>       Explicit log file path (absolute or relative to workspace root)

Filtering:
  --last <n>          Show last N entries (default: 20 when no other filter is set)
  --actions <types>   Filter by action type(s), comma-separated
                      e.g. --actions route,stage_complete
  --level <levels>    Filter by log level(s), comma-separated (case-insensitive)
                      e.g. --level ERROR,WARNING
  --errors            Shorthand for --level ERROR,WARNING
  --wp <id>           Filter to a specific work package, e.g. --wp WP-003
  --summary           Print one-line run overview with token totals

Output:
  --format text       Human-readable colored output (default)
  --format json       Raw JSON array to stdout (for piping)

  --help, -h          Show this help text

Examples:
  node scripts/read-log.js
  node scripts/read-log.js --last 50
  node scripts/read-log.js --errors
  node scripts/read-log.js --actions route
  node scripts/read-log.js --actions stage_start,stage_complete
  node scripts/read-log.js --wp WP-003
  node scripts/read-log.js --summary
  node scripts/read-log.js --slug my-project-slug
  node scripts/read-log.js --errors --format json
  node scripts/read-log.js --file orchestrator/logs/20260324T142851-my-run.jsonl
`;

// ─── Argument parser ──────────────────────────────────────────────────────────

/**
 * Minimal CLI arg parser — no external dependencies.
 * Supports both `--flag value` and `--flag=value` forms.
 *
 * @param {string[]} argv  process.argv.slice(2)
 * @returns {{
 *   last: number|null,
 *   actions: string[]|null,
 *   level: string[]|null,
 *   errors: boolean,
 *   wp: string|null,
 *   summary: boolean,
 *   slug: string|null,
 *   file: string|null,
 *   format: string,
 *   help: boolean,
 * }}
 */
function parseArgs(argv) {
  const opts = {
    last:    null,
    actions: null,
    level:   null,
    errors:  false,
    wp:      null,
    summary: false,
    slug:    null,
    file:    null,
    format:  'text',
    help:    false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];

    // ── boolean flags ──
    if (a === '--help' || a === '-h') { opts.help = true; continue; }
    if (a === '--errors')    { opts.errors = true; continue; }
    if (a === '--summary')   { opts.summary = true; continue; }

    // ── value flags — support both --flag val and --flag=val ──
    const eq = a.indexOf('=');
    const key = eq === -1 ? a         : a.slice(0, eq);
    const val = eq === -1 ? argv[++i] : a.slice(eq + 1);

    switch (key) {
      case '--last':
        { const n = parseInt(val, 10); if (!isNaN(n) && n > 0) opts.last = n; break; }
      case '--actions':
        opts.actions = val.split(',').map((s) => s.trim()).filter(Boolean);
        break;
      case '--level':
        opts.level = val.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
        break;
      case '--wp':
        opts.wp = val;
        break;
      case '--slug':
        opts.slug = val;
        break;
      case '--file':
        opts.file = val;
        break;
      case '--format':
        opts.format = val.toLowerCase();
        break;
      default:
        // unknown flag — ignore silently
        if (eq === -1) i--; // undo argv[++i] that consumed the next element as val
        break;
    }
  }

  return opts;
}

// ─── Log discovery ────────────────────────────────────────────────────────────

/**
 * Return sorted list of .jsonl file paths from the logs directory.
 * Alphabetical sort = chronological (filenames start with YYYYMMDDTHHmmSS).
 *
 * @param {string} logsDir
 * @returns {string[]}
 */
function discoverLogs(logsDir) {
  if (!fs.existsSync(logsDir)) return [];
  return fs
    .readdirSync(logsDir)
    .filter((f) => f.endsWith('.jsonl'))
    .sort()
    .map((f) => path.join(logsDir, f));
}

// ─── JSONL parser ─────────────────────────────────────────────────────────────

/**
 * Parse every line of a JSONL file, silently skipping malformed lines.
 *
 * @param {string} filePath
 * @returns {object[]}
 */
function parseJsonl(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const entries = [];
  for (const line of content.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      entries.push(JSON.parse(t));
    } catch {
      // malformed line — skip silently
    }
  }
  return entries;
}

// ─── Filtering ────────────────────────────────────────────────────────────────

/**
 * Apply filter flags to an array of parsed log entries.
 * --last is applied last (tail semantics).
 *
 * @param {object[]} entries
 * @param {object} opts  parsed args
 * @returns {object[]}
 */
function applyFilters(entries, opts) {
  let result = entries;

  // --wp
  if (opts.wp) {
    result = result.filter((e) => e.wp_id === opts.wp);
  }

  // --actions
  if (opts.actions) {
    const set = new Set(opts.actions);
    result = result.filter((e) => set.has(e.action));
  }

  // --level / --errors
  const levels = opts.errors
    ? new Set(['ERROR', 'WARNING'])
    : opts.level ? new Set(opts.level) : null;
  if (levels) {
    result = result.filter((e) => levels.has((e.level || 'INFO').toUpperCase()));
  }

  // --last N (default 20 when no other filter is active)
  const noActiveFilter = !opts.wp && !opts.actions && !levels;
  const lastN = opts.last !== null
    ? opts.last
    : (noActiveFilter ? 20 : null);
  if (lastN !== null) {
    result = result.slice(-lastN);
  }

  return result;
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

/**
 * Format a duration in seconds as a human-readable string.
 * Matches orchestrator/src/utils/logging.py::_format_duration()
 *
 * @param {number|null|undefined} seconds
 * @returns {string}
 */
function formatDuration(seconds) {
  if (seconds === null || seconds === undefined) return '';
  const secs = Math.round(seconds);
  if (secs < 60) return `${secs}s`;
  const minutes = Math.floor(secs / 60);
  const remSecs  = secs % 60;
  if (minutes < 60) return `${minutes}m ${remSecs}s`;
  const hours   = Math.floor(minutes / 60);
  const remMins = minutes % 60;
  return `${hours}h ${remMins}m`;
}

/**
 * Extract HH:MM:SS from an ISO 8601 timestamp string.
 *
 * @param {string|undefined} ts
 * @returns {string}
 */
function formatTime(ts) {
  if (!ts) return '??:??:??';
  try {
    return new Date(ts).toISOString().slice(11, 19);
  } catch {
    return '??:??:??';
  }
}

/**
 * Format a number with comma-separated thousands (cross-platform).
 *
 * @param {number} n
 * @returns {string}
 */
function numFmt(n) {
  const s = String(Math.round(n));
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// ─── Text entry formatter ─────────────────────────────────────────────────────

/**
 * Format a single log entry as one human-readable line.
 *
 * Pattern:  HH:MM:SS [stage] WP-NNN action → result (duration, tokens)
 *
 * @param {object} entry
 * @returns {string}
 */
function formatEntry(entry) {
  const time   = formatTime(entry.timestamp);
  const stage  = entry.stage  || '—';
  const wpId   = entry.wp_id  || '';
  const action = entry.action || '?';
  const result = entry.result || '';
  const level  = (entry.level || 'INFO').toUpperCase();

  const stageStr = C.cyan(`[${stage}]`);
  const parts = [`${time} ${stageStr}`];

  if (wpId) parts.push(wpId);
  parts.push(action);

  if (result) {
    const arrow = result === 'PASS' ? C.green(`→ ${result}`) : C.red(`→ ${result}`);
    parts.push(arrow);
  }

  // Detail: duration + tokens
  const details = [];
  if (entry.duration_s !== null && entry.duration_s !== undefined) {
    const d = formatDuration(entry.duration_s);
    if (d) details.push(d);
  }
  if (entry.tokens_used && typeof entry.tokens_used === 'object') {
    const t = entry.tokens_used.total_tokens;
    if (t) details.push(`${numFmt(t)} tokens`);
  }
  if (details.length > 0) parts.push(`(${details.join(', ')})`);

  // Model tag for stage_start (mirrors logging.py _build_stream_console_line)
  if (action === 'stage_start' && entry.model) {
    parts.push(C.dim(`[${entry.model}]`));
  }

  let line = parts.filter(Boolean).join(' ');

  // Level-based coloring (applied to whole line)
  if (level === 'ERROR')   return C.red(line);
  if (level === 'WARNING') return C.yellow(line);
  return line;
}

// ─── Summary mode ─────────────────────────────────────────────────────────────

/**
 * Build the one-line run summary from the full entries array.
 *
 * Format: Run: <ts> | Duration: <d> | WPs: N (x complete, ...) |
 *         Result: <r> | Tokens: N (in: N / out: N) | Errors: N | Warnings: N
 *
 * @param {object[]} entries
 * @returns {string}
 */
function buildSummary(entries) {
  const runStart        = entries.find((e) => e.action === 'run_start');
  const runEnd          = entries.find((e) => e.action === 'run_end');
  const progressEntries = entries.filter((e) => e.action === 'progress_snapshot');
  const lastProgress    = progressEntries[progressEntries.length - 1];

  // Token totals from all stage_complete entries
  let tokenIn = 0, tokenOut = 0, hasTokens = false;
  for (const e of entries) {
    if (e.action === 'stage_complete' && e.tokens_used) {
      tokenIn  += e.tokens_used.input_tokens  || 0;
      tokenOut += e.tokens_used.output_tokens || 0;
      hasTokens = true;
    }
  }

  // Error / warning counts
  let errorCount = 0, warnCount = 0;
  for (const e of entries) {
    const lvl = (e.level || '').toUpperCase();
    if (lvl === 'ERROR')   errorCount++;
    else if (lvl === 'WARNING') warnCount++;
  }

  const parts = [];

  // Run timestamp
  const ts = runStart?.run_start_ts || runStart?.timestamp;
  if (ts) parts.push(`Run: ${ts}`);

  // Duration
  const totalDur = runEnd?.total_duration_s;
  if (totalDur !== undefined && totalDur !== null) {
    parts.push(`Duration: ${formatDuration(totalDur)}`);
  } else if (lastProgress?.elapsed_s !== undefined) {
    parts.push(`Elapsed: ${formatDuration(lastProgress.elapsed_s)}`);
  }

  // WP counts
  if (lastProgress) {
    const total     = lastProgress.total_wps || 0;
    const breakdown = lastProgress.status_breakdown || {};
    const complete  = breakdown.COMPLETE    || 0;
    const inProg    = breakdown.IN_PROGRESS || 0;
    const ready     = breakdown.READY       || 0;
    const detail    = [];
    if (complete) detail.push(`${complete} complete`);
    if (inProg)   detail.push(`${inProg} in-progress`);
    if (ready)    detail.push(`${ready} ready`);
    parts.push(`WPs: ${total}${detail.length ? ` (${detail.join(', ')})` : ''}`);
  }

  // Result
  const result = runEnd?.result || (runEnd ? 'COMPLETE' : 'IN_PROGRESS');
  parts.push(`Result: ${result}`);

  // Tokens
  if (hasTokens) {
    const total = tokenIn + tokenOut;
    parts.push(`Tokens: ${numFmt(total)} (in: ${numFmt(tokenIn)} / out: ${numFmt(tokenOut)})`);
  }

  parts.push(`Errors: ${errorCount}`);
  parts.push(`Warnings: ${warnCount}`);

  return parts.join(' | ');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help) {
    console.log(HELP);
    process.exit(0);
  }

  // ── Resolve log file ──
  let filePath;

  if (opts.file) {
    filePath = path.isAbsolute(opts.file)
      ? opts.file
      : path.resolve(WORKSPACE_ROOT, opts.file);
    if (!fs.existsSync(filePath)) {
      console.error(`File not found: ${filePath}`);
      process.exit(1);
    }
  } else {
    const allLogs = discoverLogs(LOGS_DIR);
    if (allLogs.length === 0) {
      console.error(`No log files found in ${LOGS_DIR}`);
      process.exit(1);
    }

    if (opts.slug) {
      const suffix = `-${opts.slug}.jsonl`;
      const matched = allLogs.filter((f) => path.basename(f).endsWith(suffix));
      if (matched.length === 0) {
        console.error(`No log files found matching slug: ${opts.slug}`);
        process.exit(1);
      }
      filePath = matched[matched.length - 1]; // latest among matches
    } else {
      filePath = allLogs[allLogs.length - 1]; // latest overall
    }
  }

  // ── Parse JSONL ──
  let entries;
  try {
    entries = parseJsonl(filePath);
  } catch (err) {
    console.error(`Failed to read log file: ${err.message}`);
    process.exit(1);
  }

  // ── Summary mode ──
  if (opts.summary) {
    console.log(buildSummary(entries));
    process.exit(0);
  }

  // ── Apply filters ──
  const filtered = applyFilters(entries, opts);

  // ── Output ──
  if (opts.format === 'json') {
    console.log(JSON.stringify(filtered, null, 2));
  } else {
    // Print a dim header showing which file is being read.
    // Use relative path when the file is inside the workspace, absolute otherwise.
    const rel = path.relative(WORKSPACE_ROOT, filePath);
    const displayPath = rel.startsWith('..') ? filePath : rel;
    console.log(C.dim(`Log: ${displayPath}\n`));

    if (filtered.length === 0) {
      console.log(C.dim('(no entries match the filter)'));
    } else {
      for (const entry of filtered) {
        console.log(formatEntry(entry));
      }
    }
  }

  process.exit(0);
}

main();

```
###  Path: `/scripts/run-gui.js`

```js
#!/usr/bin/env node

/**
 * run-gui.js
 *
 * Launches the MCP GUI server from the workspace root and opens the default
 * browser once the server is ready.
 * Delegates to `tsx gui/server.ts` inside mcp-server/.
 *
 * Usage (from workspace root):
 *   node scripts/run-gui.js
 *   node scripts/run-gui.js -- --port 3421
 *   node scripts/run-gui.js -- --port 3421 --ledger-dir "C:\path\to\ledger"
 *
 * CLI arguments after `--` are forwarded to the GUI server process.
 */

const { spawn } = require('child_process');
const { createInterface } = require('readline');
const path = require('path');

const MCP_SERVER_DIR = path.resolve(__dirname, '..', 'mcp-server');

// Collect args to forward: everything after a bare `--` separator, or all
// extra args if no separator is present.
const separatorIndex = process.argv.indexOf('--');
const forwardedArgs =
  separatorIndex !== -1 ? process.argv.slice(separatorIndex + 1) : process.argv.slice(2);

// Derive the port from forwarded args so we can open the right URL.
const portFlagIndex = forwardedArgs.indexOf('--port');
const port =
  portFlagIndex !== -1 && forwardedArgs[portFlagIndex + 1]
    ? parseInt(forwardedArgs[portFlagIndex + 1], 10)
    : 3420;
const guiUrl = `http://localhost:${port}`;

const isWindows = process.platform === 'win32';

// Open the system's default browser (cross-platform).
function openBrowser(url) {
  const isMac = process.platform === 'darwin';
  if (isWindows) {
    // Use cmd /c start so we never need to locate an executable.
    spawn('cmd', ['/c', 'start', '""', url], { shell: false, stdio: 'ignore', detached: true }).unref();
  } else {
    const cmd = isMac ? 'open' : 'xdg-open';
    spawn(cmd, [url], { stdio: 'ignore', detached: true }).unref();
  }
}

// Build the command: `npx tsx gui/server.ts [...forwardedArgs]`
// On Windows .cmd files must be run through the shell.
const child = spawn('npx', ['tsx', 'gui/server.ts', ...forwardedArgs], {
  cwd: MCP_SERVER_DIR,
  stdio: ['inherit', 'pipe', 'inherit'],
  shell: isWindows,
});

// Watch stdout for the ready message, then pass all lines through to the
// parent terminal as normal.
let browserOpened = false;
const rl = createInterface({ input: child.stdout });

rl.on('line', (line) => {
  process.stdout.write(line + '\n');
  if (!browserOpened && line.includes('GUI dashboard running at')) {
    browserOpened = true;
    console.log(`[run-gui] Opening ${guiUrl} in your default browser…`);
    openBrowser(guiUrl);
  }
});

child.on('error', (err) => {
  console.error(`[run-gui] Failed to start GUI server: ${err.message}`);
  process.exit(1);
});

child.on('close', (code) => {
  process.exit(code ?? 0);
});

```
###  Path: `/scripts/run-orchestrator.js`

```js
#!/usr/bin/env node

/**
 * run-orchestrator.js
 *
 * Pre-flight dist freshness guard + orchestrate launcher.
 *
 * Checks whether mcp-server/dist/ is up to date relative to mcp-server/src/.
 * Rebuilds via `npm run build` when any source file is newer than the compiled
 * output sentinel (dist/index.js), or when dist/ does not yet exist, then
 * delegates to the `orchestrate` CLI with all supplied arguments.
 *
 * Usage (from workspace root):
 *   node scripts/run-orchestrator.js [orchestrate options…]
 *   node scripts/run-orchestrator.js path/to/plan.md --dry-run
 *
 * Replaces orchestrator/run.sh for cross-platform (macOS, Linux, Windows)
 * compatibility.
 */

'use strict';

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

// ---------------------------------------------------------------------------
// 1. Resolve paths
// ---------------------------------------------------------------------------
const WORKSPACE_ROOT = path.resolve(__dirname, '..');
const MCP_SRC       = path.join(WORKSPACE_ROOT, 'mcp-server', 'src');
const MCP_DIST_SENTINEL = path.join(WORKSPACE_ROOT, 'mcp-server', 'dist', 'index.js');

// ---------------------------------------------------------------------------
// 2. Determine whether a rebuild is needed
//    Walk mcp-server/src/ recursively; compare each file's mtime against the
//    sentinel's mtime.  Any src file newer than the sentinel → stale build.
// ---------------------------------------------------------------------------

/**
 * Recursively collect mtimeMs of every file under `dir`.
 * Returns the largest mtime found (i.e. the most recently modified file's
 * timestamp), or -Infinity when the directory is empty.
 *
 * @param {string} dir
 * @returns {number}
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

let needBuild = false;

if (!fs.existsSync(MCP_DIST_SENTINEL)) {
  needBuild = true;
} else {
  const sentinelMtime = fs.statSync(MCP_DIST_SENTINEL).mtimeMs;
  if (latestMtime(MCP_SRC) > sentinelMtime) {
    needBuild = true;
  }
}

// ---------------------------------------------------------------------------
// 3. Rebuild when necessary
// ---------------------------------------------------------------------------
const isWindows = process.platform === 'win32';
const npmCmd    = isWindows ? 'npm.cmd' : 'npm';

if (needBuild) {
  console.log('[run-orchestrator.js] mcp-server/dist is stale or missing — building MCP server...');
  const build = spawnSync(npmCmd, ['run', 'build'], {
    cwd:   path.join(WORKSPACE_ROOT, 'mcp-server'),
    stdio: 'inherit',
    shell: isWindows, // npm.cmd requires shell:true on Windows/Node22+ to avoid EINVAL
  });
  if (build.status !== 0) {
    process.exit(build.status ?? 1);
  }
} else {
  console.log('[run-orchestrator.js] mcp-server/dist is up to date — skipping build.');
}

// ---------------------------------------------------------------------------
// 4. Launch the orchestrator, forwarding all arguments verbatim
// ---------------------------------------------------------------------------
const forwardedArgs = process.argv.slice(2);

// ---------------------------------------------------------------------------
// 5. Remind the caller about companion scripts
// ---------------------------------------------------------------------------
console.log('');
console.log('[run-orchestrator.js] Companion scripts available while the orchestrator is running:');
console.log('  Read logs  →  node scripts/read-log.js <path/to/log.jsonl>');
console.log('               (alias: node scripts/cli.js read-log <path/to/log.jsonl>)');
console.log('  Kill stale →  node scripts/kill-orchestrator.js');
console.log('               (alias: node scripts/cli.js kill-orchestrator)');
  console.log('  TIP: Prefer using read-log.js over native command line tools to read logs —');
console.log('       it understands the JSONL format.');
console.log('');

// Resolve the orchestrate binary from the local venv to avoid picking up a
// stale system-wide install via $PATH.  Python venv uses "Scripts" on Windows
// and "bin" elsewhere; the binary is "orchestrate.exe" on Windows.
const venvBin = process.platform === 'win32' ? 'Scripts' : 'bin';
const orchestrateCmd = path.join(WORKSPACE_ROOT, 'orchestrator', '.venv', venvBin, 'orchestrate');
const result = spawnSync(orchestrateCmd, forwardedArgs, {
  stdio: 'inherit',
  shell: false,
  env: { ...process.env, PYTHONUTF8: '1' },
});

process.exit(result.status ?? 1);

```
###  Path: `/scripts/sync-personas.js`

```js
#!/usr/bin/env node

/**
 * sync-personas.js
 *
 * Builds persona files from source templates and copies them to each IDE's
 * agent/prompt directory.
 *
 * Usage:
 *   node scripts/sync-personas.js
 *   node scripts/sync-personas.js --target vscode         # VS Code only
 *   node scripts/sync-personas.js --target claude-code    # Claude Code only
 *   node scripts/sync-personas.js --dry-run               # Preview without copying
 *   node scripts/sync-personas.js --custom-path "C:\Custom\Path"  # Custom VS Code prompts dir
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

// Role names are loaded from the shared workflow manifest — the single source
// of truth for all agent roles across the workspace.
const KNOWN_ROLES = require('../shared/workflow-manifest.json').roles.map(r => r.name);

// ANSI color codes for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

/**
 * Determine the VS Code User prompts directory based on the platform
 */
function getVSCodePromptsDir() {
  const platform = os.platform();
  const homeDir = os.homedir();

  switch (platform) {
    case 'win32':
      return path.join(process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming'), 'Code', 'User', 'prompts');
    case 'darwin':
      return path.join(homeDir, 'Library', 'Application Support', 'Code', 'User', 'prompts');
    case 'linux':
      return path.join(homeDir, '.config', 'Code', 'User', 'prompts');
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
}

/**
 * Determine the Claude Code agents directory based on the platform.
 * Creates the directory if it does not exist.
 * @returns {string} - Path to ~/.claude/agents/
 */
function getClaudeCodeAgentsDir() {
  return path.join(os.homedir(), '.claude', 'agents');
}

/**
 * Determine the Claude Code global skills directory.
 * @returns {string} - Path to ~/.claude/skills/
 */
function getClaudeCodeSkillsDir() {
  return path.join(os.homedir(), '.claude', 'skills');
}

/**
 * Extract the VS File Name from a persona file's YAML frontmatter (vs_file_name field).
 * @param {string} filePath - Path to the persona file
 * @returns {string|null} - The VS File Name or null if not found
 */
function extractVSFileName(filePath) {
  const fields = parseFrontmatter(filePath);
  return fields?.vs_file_name || null;
}

/**
 * Extract the Claude Code deployment filename from a CC persona file's YAML
 * frontmatter. Uses the `name` field and appends `.md`.
 * @param {string} filePath - Path to the persona file
 * @returns {string|null} - e.g. "1-planner.md" or null if not found
 */
function extractCCFileName(filePath) {
  const fields = parseFrontmatter(filePath);
  return fields?.name ? fields.name.trim() + '.md' : null;
}

/**
 * Parse YAML frontmatter fields from a persona file into a plain object.
 * Returns null if the file has no valid YAML frontmatter block.
 * @param {string} filePath
 * @returns {Object|null}
 */
function parseFrontmatter(filePath) {
  try {
    const rawContent = fs.readFileSync(filePath, 'utf8');
    const content = rawContent.startsWith('<!--') ? rawContent.slice(rawContent.indexOf('\n') + 1) : rawContent;
    if (!content.startsWith('---')) return null;
    const afterFirst = content.slice(3);
    const closingIdx = afterFirst.indexOf('\n---');
    if (closingIdx === -1) return null;
    const fields = {};
    for (const line of afterFirst.slice(0, closingIdx).split('\n')) {
      const m = line.trim().match(/^([a-zA-Z_][a-zA-Z0-9_]*):\s*(.*)$/);
      if (m) fields[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
    }
    return fields;
  } catch {
    return null;
  }
}

/**
 * Validate VS Code persona frontmatter: requires role (in KNOWN_ROLES),
 * name, vs_file_name, id, and model fields.
 * @param {string} dir - Absolute path to personas/ledger/vs-code/
 */
function validateVSCodeFrontmatter(dir) {
  if (!fs.existsSync(dir)) return;

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
  console.log(`\n${colors.bright}${colors.cyan}=== VS Code Frontmatter Validation ===${colors.reset}`);

  let warningCount = 0;

  for (const file of files) {
    const filePath = path.join(dir, file);
    const fields = parseFrontmatter(filePath);
    const relPath = path.join('ledger', 'vs-code', file);

    if (!fields) {
      console.warn(`${colors.yellow}⚠ ${relPath}: could not parse frontmatter${colors.reset}`);
      warningCount++;
      continue;
    }

    if (!fields.role) {
      console.warn(`${colors.yellow}⚠ ${relPath}: missing 'role:' field${colors.reset}`);
      warningCount++;
    } else if (!KNOWN_ROLES.includes(fields.role)) {
      console.warn(`${colors.yellow}⚠ ${relPath}: unknown role "${fields.role}". Expected: ${KNOWN_ROLES.join(', ')}${colors.reset}`);
      warningCount++;
    }

    if (!fields.name) {
      console.warn(`${colors.yellow}⚠ ${relPath}: missing 'name:' field${colors.reset}`);
      warningCount++;
    }

    if (!fields.vs_file_name) {
      console.warn(`${colors.yellow}⚠ ${relPath}: missing 'vs_file_name:' field${colors.reset}`);
      warningCount++;
    }

    if (!fields.id) {
      console.warn(`${colors.yellow}⚠ ${relPath}: missing 'id:' field${colors.reset}`);
      warningCount++;
    }

    if (!fields.model) {
      console.warn(`${colors.yellow}⚠ ${relPath}: missing 'model:' field${colors.reset}`);
      warningCount++;
    }
  }

  if (warningCount === 0) {
    console.log(`${colors.green}✓ All ${files.length} VS Code persona file(s) passed frontmatter validation${colors.reset}`);
  } else {
    console.log(`${colors.yellow}${warningCount} frontmatter warning(s) found — sync was not blocked${colors.reset}`);
  }
}

/**
 * Validate Claude Code persona frontmatter: requires name (kebab-case with
 * numeric prefix), role (in KNOWN_ROLES), permissionMode, model, and memory.
 * @param {string} dir - Absolute path to personas/ledger/claude-code/
 */
function validateCCFrontmatter(dir) {
  if (!fs.existsSync(dir)) return;

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
  console.log(`\n${colors.bright}${colors.cyan}=== Claude Code Frontmatter Validation ===${colors.reset}`);

  const CC_NAME_RE = /^\d-[a-z][a-z0-9-]*$/;
  let warningCount = 0;

  for (const file of files) {
    const filePath = path.join(dir, file);
    const fields = parseFrontmatter(filePath);
    const relPath = path.join('ledger', 'claude-code', file);

    if (!fields) {
      console.warn(`${colors.yellow}⚠ ${relPath}: could not parse frontmatter${colors.reset}`);
      warningCount++;
      continue;
    }

    // name: must be present and match N-kebab-case
    if (!fields.name) {
      console.warn(`${colors.yellow}⚠ ${relPath}: missing 'name:' field${colors.reset}`);
      warningCount++;
    } else if (!CC_NAME_RE.test(fields.name)) {
      console.warn(`${colors.yellow}⚠ ${relPath}: 'name: ${fields.name}' does not match N-kebab-case pattern (e.g. "1-planner")${colors.reset}`);
      warningCount++;
    }

    // role: must be present and in KNOWN_ROLES
    if (!fields.role) {
      console.warn(`${colors.yellow}⚠ ${relPath}: missing 'role:' field${colors.reset}`);
      warningCount++;
    } else if (!KNOWN_ROLES.includes(fields.role)) {
      console.warn(`${colors.yellow}⚠ ${relPath}: unknown role "${fields.role}". Expected: ${KNOWN_ROLES.join(', ')}${colors.reset}`);
      warningCount++;
    }

    // permissionMode, model, memory: must be present strings
    for (const requiredField of ['permissionMode', 'model', 'memory']) {
      if (!fields[requiredField]) {
        console.warn(`${colors.yellow}⚠ ${relPath}: missing '${requiredField}:' field${colors.reset}`);
        warningCount++;
      }
    }
  }

  if (warningCount === 0) {
    console.log(`${colors.green}✓ All ${files.length} Claude Code persona file(s) passed frontmatter validation${colors.reset}`);
  } else {
    console.log(`${colors.yellow}${warningCount} frontmatter warning(s) found — sync was not blocked${colors.reset}`);
  }
}

/**
 * Validate Claude Code frontmatter for standalone personas: requires name
 * (kebab-case without numeric prefix), permissionMode, model, and memory.
 * Standalone personas do not require a 'role' field.
 * @param {string} dir - Absolute path to personas/standalone/claude-code/
 */
function validateStandaloneCCFrontmatter(dir) {
  if (!fs.existsSync(dir)) return;

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
  console.log(`\n${colors.bright}${colors.cyan}=== Standalone Claude Code Frontmatter Validation ===${colors.reset}`);

  const STANDALONE_NAME_RE = /^[a-z][a-z0-9-]*$/;
  let warningCount = 0;

  for (const file of files) {
    const filePath = path.join(dir, file);
    const fields = parseFrontmatter(filePath);
    const relPath = path.join('standalone', 'claude-code', file);

    if (!fields) {
      console.warn(`${colors.yellow}⚠ ${relPath}: could not parse frontmatter${colors.reset}`);
      warningCount++;
      continue;
    }

    // name: must be present and match kebab-case (no numeric prefix)
    if (!fields.name) {
      console.warn(`${colors.yellow}⚠ ${relPath}: missing 'name:' field${colors.reset}`);
      warningCount++;
    } else if (!STANDALONE_NAME_RE.test(fields.name)) {
      console.warn(`${colors.yellow}⚠ ${relPath}: 'name: ${fields.name}' does not match kebab-case pattern (e.g. "manifest-curator")${colors.reset}`);
      warningCount++;
    }

    // permissionMode, model, memory: must be present strings
    for (const requiredField of ['permissionMode', 'model', 'memory']) {
      if (!fields[requiredField]) {
        console.warn(`${colors.yellow}⚠ ${relPath}: missing '${requiredField}:' field${colors.reset}`);
        warningCount++;
      }
    }
  }

  if (warningCount === 0) {
    console.log(`${colors.green}✓ All ${files.length} standalone Claude Code persona file(s) passed frontmatter validation${colors.reset}`);
  } else {
    console.log(`${colors.yellow}${warningCount} frontmatter warning(s) found — sync was not blocked${colors.reset}`);
  }
}

/**
 * Generic helper: copy persona files from sourceDir to targetDir using the
 * provided filename-extraction function.
 *
 * @param {string} sourceDir - Directory containing built persona .md files
 * @param {string} targetDir - Destination directory on the system
 * @param {Function} extractFileNameFn - Returns the target filename given a file path
 * @param {string} label - Human-readable label for console output (e.g. "VS Code")
 * @param {boolean} dryRun - If true, preview only; no files are written
 */
function syncFromDir(sourceDir, targetDir, extractFileNameFn, label, dryRun = false) {
  if (!fs.existsSync(sourceDir)) {
    console.error(`${colors.red}Error: Source directory not found: ${sourceDir}${colors.reset}`);
    process.exit(1);
  }

  const personaFiles = fs.readdirSync(sourceDir)
    .filter(f => f.endsWith('.md'))
    .map(f => path.join(sourceDir, f));

  console.log(`${colors.bright}${colors.cyan}=== ${label} Persona Sync ===${colors.reset}\n`);
  console.log(`${colors.blue}Source:${colors.reset} ${sourceDir}`);
  console.log(`${colors.blue}Target:${colors.reset} ${targetDir}`);
  console.log(`${colors.blue}Mode:${colors.reset} ${dryRun ? 'DRY RUN (preview only)' : 'COPY'}\n`);

  if (!dryRun && !fs.existsSync(targetDir)) {
    console.log(`${colors.yellow}Creating target directory: ${targetDir}${colors.reset}\n`);
    fs.mkdirSync(targetDir, { recursive: true });
  }

  let copiedCount = 0;
  let skippedCount = 0;

  for (const filePath of personaFiles) {
    const deployName = extractFileNameFn(filePath);
    const relSrc = path.relative(path.join(__dirname, '..'), filePath);

    if (!deployName) {
      console.log(`${colors.yellow}⊘ Skipped:${colors.reset} ${relSrc} ${colors.yellow}(no deployable filename in frontmatter)${colors.reset}`);
      skippedCount++;
      continue;
    }

    // Guard: skip stale artifact files whose own filename doesn't match the
    // declared deploy name. This prevents old plain .md files (legacy build
    // output) from overwriting the correct .agent.md files they share a
    // vs_file_name with.
    const srcBasename = path.basename(filePath);
    if (srcBasename !== deployName) {
      console.log(`${colors.yellow}⊘ Skipped:${colors.reset} ${relSrc} ${colors.yellow}(filename mismatch: source "${srcBasename}" vs deploy target "${deployName}" — stale artifact)${colors.reset}`);
      skippedCount++;
      continue;
    }

    const targetPath = path.join(targetDir, deployName);

    if (dryRun) {
      console.log(`${colors.cyan}→ Would copy:${colors.reset} ${relSrc} ${colors.cyan}→${colors.reset} ${deployName}`);
      copiedCount++;
    } else {
      try {
        fs.copyFileSync(filePath, targetPath);
        console.log(`${colors.green}✓ Copied:${colors.reset} ${relSrc} ${colors.green}→${colors.reset} ${deployName}`);
        copiedCount++;
      } catch (error) {
        console.error(`${colors.red}✗ Error copying ${relSrc}:${colors.reset}`, error.message);
        skippedCount++;
      }
    }
  }

  console.log(`\n${colors.bright}${colors.cyan}=== Summary ===${colors.reset}`);
  console.log(`${colors.green}${dryRun ? 'Would copy' : 'Copied'}:${colors.reset} ${copiedCount} file(s)`);
  console.log(`${colors.yellow}Skipped:${colors.reset} ${skippedCount} file(s)`);

  if (dryRun) {
    console.log(`\n${colors.yellow}This was a dry run. Run without --dry-run to actually copy files.${colors.reset}`);
  }
}

/**
 * Sync VS Code personas: personas/ledger/vs-code/ → VS Code prompts directory.
 * @param {boolean} dryRun
 * @param {string|null} customPath - Override the default VS Code prompts directory
 */
function syncVSCode(dryRun = false, customPath = null) {
  const sourceDir = path.join(__dirname, '..', 'personas', 'ledger', 'vs-code');
  const targetDir = customPath || getVSCodePromptsDir();
  syncFromDir(sourceDir, targetDir, extractVSFileName, 'VS Code', dryRun);
  validateVSCodeFrontmatter(sourceDir);
}

/**
 * Validate VS Code frontmatter for standalone personas: requires name and
 * vs_file_name. Standalone personas do not require a 'role' field.
 * @param {string} dir - Absolute path to personas/standalone/vs-code/
 */
function validateStandaloneVSCodeFrontmatter(dir) {
  if (!fs.existsSync(dir)) return;

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
  console.log(`\n${colors.bright}${colors.cyan}=== Standalone VS Code Frontmatter Validation ===${colors.reset}`);

  let warningCount = 0;

  for (const file of files) {
    const filePath = path.join(dir, file);
    const fields = parseFrontmatter(filePath);
    const relPath = path.join('standalone', 'vs-code', file);

    if (!fields) {
      console.warn(`${colors.yellow}⚠ ${relPath}: could not parse frontmatter${colors.reset}`);
      warningCount++;
      continue;
    }

    if (!fields.name) {
      console.warn(`${colors.yellow}⚠ ${relPath}: missing 'name:' field${colors.reset}`);
      warningCount++;
    }

    if (!fields.vs_file_name) {
      console.warn(`${colors.yellow}⚠ ${relPath}: missing 'vs_file_name:' field${colors.reset}`);
      warningCount++;
    }

    if (!fields.id) {
      console.warn(`${colors.yellow}⚠ ${relPath}: missing 'id:' field${colors.reset}`);
      warningCount++;
    }
  }

  if (warningCount === 0) {
    console.log(`${colors.green}✓ All ${files.length} standalone VS Code persona file(s) passed frontmatter validation${colors.reset}`);
  } else {
    console.log(`${colors.yellow}${warningCount} frontmatter warning(s) found — sync was not blocked${colors.reset}`);
  }
}

/**
 * Sync standalone VS Code personas: personas/standalone/vs-code/ → VS Code prompts directory.
 * @param {boolean} dryRun
 * @param {string|null} customPath - Override the default VS Code prompts directory
 */
function syncStandaloneVSCode(dryRun = false, customPath = null) {
  const sourceDir = path.join(__dirname, '..', 'personas', 'standalone', 'vs-code');
  const targetDir = customPath || getVSCodePromptsDir();
  syncFromDir(sourceDir, targetDir, extractVSFileName, 'Standalone VS Code', dryRun);
  validateStandaloneVSCodeFrontmatter(sourceDir);
}

/**
 * Sync Claude Code personas: personas/ledger/claude-code/ → ~/.claude/agents/.
 * @param {boolean} dryRun
 */
function syncClaudeCode(dryRun = false) {
  const sourceDir = path.join(__dirname, '..', 'personas', 'ledger', 'claude-code');
  const targetDir = getClaudeCodeAgentsDir();
  syncFromDir(sourceDir, targetDir, extractCCFileName, 'Claude Code', dryRun);
  validateCCFrontmatter(sourceDir);
}

/**
 * Sync standalone Claude Code personas: personas/standalone/claude-code/ → ~/.claude/agents/.
 * @param {boolean} dryRun
 */
function syncStandaloneClaudeCode(dryRun = false) {
  const sourceDir = path.join(__dirname, '..', 'personas', 'standalone', 'claude-code');
  const targetDir = getClaudeCodeAgentsDir();
  syncFromDir(sourceDir, targetDir, extractCCFileName, 'Standalone Claude Code', dryRun);
  validateStandaloneCCFrontmatter(sourceDir);
}

/**
 * Sync Claude Code skills: .claude/skills/ → ~/.claude/skills/.
 * Copies all .md files from the local project skills directory to the global
 * Claude Code skills directory, making them available in any project.
 * @param {boolean} dryRun
 */
function syncSkills(dryRun = false) {
  const sourceDir = path.join(__dirname, '..', '.claude', 'skills');
  const targetDir = getClaudeCodeSkillsDir();

  if (!fs.existsSync(sourceDir)) {
    console.log(`${colors.yellow}⊘ No local skills directory found at ${sourceDir} — skipping skill sync${colors.reset}`);
    return;
  }

  const skillFiles = fs.readdirSync(sourceDir).filter(f => f.endsWith('.md'));

  if (skillFiles.length === 0) {
    console.log(`${colors.yellow}⊘ No skill files found in ${sourceDir} — skipping skill sync${colors.reset}`);
    return;
  }

  console.log(`${colors.bright}${colors.cyan}=== Claude Code Skills Sync ===${colors.reset}\n`);
  console.log(`${colors.blue}Source:${colors.reset} ${sourceDir}`);
  console.log(`${colors.blue}Target:${colors.reset} ${targetDir}`);
  console.log(`${colors.blue}Mode:${colors.reset} ${dryRun ? 'DRY RUN (preview only)' : 'COPY'}\n`);

  if (!dryRun && !fs.existsSync(targetDir)) {
    console.log(`${colors.yellow}Creating target directory: ${targetDir}${colors.reset}\n`);
    fs.mkdirSync(targetDir, { recursive: true });
  }

  let copiedCount = 0;
  let skippedCount = 0;

  for (const file of skillFiles) {
    const srcPath = path.join(sourceDir, file);
    const relSrc = path.join('.claude', 'skills', file);

    if (dryRun) {
      console.log(`${colors.cyan}→ Would copy:${colors.reset} ${relSrc} ${colors.cyan}→${colors.reset} ${file}`);
      copiedCount++;
    } else {
      try {
        fs.copyFileSync(srcPath, path.join(targetDir, file));
        console.log(`${colors.green}✓ Copied:${colors.reset} ${relSrc} ${colors.green}→${colors.reset} ${file}`);
        copiedCount++;
      } catch (error) {
        console.error(`${colors.red}✗ Error copying ${relSrc}:${colors.reset}`, error.message);
        skippedCount++;
      }
    }
  }

  console.log(`\n${colors.bright}${colors.cyan}=== Summary ===${colors.reset}`);
  console.log(`${colors.green}${dryRun ? 'Would copy' : 'Copied'}:${colors.reset} ${copiedCount} skill file(s)`);
  if (skippedCount > 0) {
    console.log(`${colors.yellow}Skipped:${colors.reset} ${skippedCount} file(s)`);
  }

  if (dryRun) {
    console.log(`\n${colors.yellow}This was a dry run. Run without --dry-run to actually copy files.${colors.reset}`);
  }
}

// Main execution
function main() {
  const args = process.argv.slice(2);
  let dryRun = false;
  let customPath = null;
  let target = 'all'; // default: sync both targets

  const VALID_TARGETS = ['vscode', 'claude-code', 'all'];

  // Parse command-line arguments
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dry-run') {
      dryRun = true;
    } else if (args[i] === '--custom-path' && i + 1 < args.length) {
      customPath = args[i + 1];
      i++;
    } else if (args[i] === '--target' && i + 1 < args.length) {
      const val = args[i + 1];
      if (!VALID_TARGETS.includes(val)) {
        console.error(`${colors.red}Error: Invalid --target value: "${val}". Valid values: ${VALID_TARGETS.join(', ')}${colors.reset}`);
        process.exit(1);
      }
      target = val;
      i++;
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
${colors.bright}${colors.cyan}Multi-IDE Persona Sync Tool${colors.reset}

${colors.bright}Usage:${colors.reset}
  node scripts/sync-personas.js [options]

${colors.bright}Options:${colors.reset}
  --target <value>       Which IDE target to sync: vscode, claude-code, all (default: all)
  --dry-run              Preview without copying
  --custom-path <path>   Override default VS Code prompts directory (vscode target only)
  --help, -h             Show this help message

${colors.bright}Notes:${colors.reset}
  - The claude-code and all targets also sync .claude/skills/ → ~/.claude/skills/,
    making workflow skills available globally across all Claude Code projects.

${colors.bright}Examples:${colors.reset}
  node scripts/sync-personas.js
  node scripts/sync-personas.js --target vscode
  node scripts/sync-personas.js --target claude-code --dry-run
  node scripts/sync-personas.js --dry-run
  node scripts/sync-personas.js --custom-path "C:\\Custom\\Path"
`);
      process.exit(0);
    }
  }

  try {
    // Build personas from source templates, forwarding --target and --dry-run
    const buildScript = path.join(__dirname, 'build-personas.js');
    const buildArgs = ['--suite', 'ledger,standalone'];
    // NOTE: --dry-run is forwarded to build-personas.js, which previews but
    // does not regenerate output files. syncFromDir() then reads from the
    // existing output directories. On a clean checkout where output dirs
    // don't exist yet, a dry-run will report stale or empty content.
    if (dryRun) buildArgs.push('--dry-run');
    if (target !== 'all') buildArgs.push('--target', target);

    console.log(`${colors.bright}${colors.cyan}=== Building Personas ===${colors.reset}\n`);
    execFileSync(process.execPath, [buildScript, ...buildArgs], { stdio: 'inherit' });
    console.log();

    // Sync to the requested target(s)
    if (target === 'vscode' || target === 'all') {
      syncVSCode(dryRun, customPath);
      console.log();
      syncStandaloneVSCode(dryRun, customPath);
      console.log();
    }
    if (target === 'claude-code' || target === 'all') {
      syncClaudeCode(dryRun);
      console.log();
      syncStandaloneClaudeCode(dryRun);
      console.log();
      syncSkills(dryRun);
    }
  } catch (error) {
    console.error(`${colors.red}Error:${colors.reset}`, error.message);
    process.exit(1);
  }
}

main();


```
###  Path: `/scripts/validate-workflow-manifest.js`

```js
#!/usr/bin/env node
'use strict';

/**
 * scripts/validate-workflow-manifest.js
 *
 * Validates `shared/workflow-manifest.json` against `shared/workflow-manifest.schema.json`
 * and performs semantic cross-reference checks that the JSON Schema cannot express:
 *
 *   1. Unique role IDs, names, and numbers.
 *   2. Prerequisites DAG is acyclic and references only known pipeline types.
 *   3. fail_routing values reference only known (non-orchestrating) role IDs.
 *   4. default_stages is a subset of canonical_order pipeline types.
 *
 * JSON Schema structural validation is performed without any external library —
 * the script reads and checks the schema's `required` and `enum` constraints
 * manually. For full Draft-07 validation use `npx ajv-cli validate`.
 *
 * Usage:
 *   node scripts/validate-workflow-manifest.js       # from workspace root
 *
 * Exit codes:
 *   0  — manifest is valid
 *   1  — one or more validation errors
 */

const fs   = require('fs');
const path = require('path');

const WORKSPACE_ROOT  = path.resolve(__dirname, '..');
const MANIFEST_PATH   = path.join(WORKSPACE_ROOT, 'shared', 'workflow-manifest.json');
const SCHEMA_PATH     = path.join(WORKSPACE_ROOT, 'shared', 'workflow-manifest.schema.json');

// ---------------------------------------------------------------------------
// Load files
// ---------------------------------------------------------------------------

if (!fs.existsSync(MANIFEST_PATH)) {
  console.error(`[validate-manifest] ERROR: Manifest not found: ${MANIFEST_PATH}`);
  process.exit(1);
}
if (!fs.existsSync(SCHEMA_PATH)) {
  console.error(`[validate-manifest] ERROR: Schema not found: ${SCHEMA_PATH}`);
  process.exit(1);
}

/** @type {import('../shared/workflow-manifest.json')} */
const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
const schema   = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));

const errors = [];

function fail(msg) {
  errors.push(msg);
}

// ---------------------------------------------------------------------------
// 1. Top-level required properties (from JSON Schema)
// ---------------------------------------------------------------------------

const topRequired = schema.required || [];
for (const prop of topRequired) {
  if (!(prop in manifest)) {
    fail(`Missing required top-level property: "${prop}"`);
  }
}

// ---------------------------------------------------------------------------
// 2. spec_version must be a non-empty string
// ---------------------------------------------------------------------------

if (manifest.spec_version !== undefined && typeof manifest.spec_version !== 'string') {
  fail(`"spec_version" must be a string, got ${typeof manifest.spec_version}`);
}

// ---------------------------------------------------------------------------
// 3. Roles array checks
// ---------------------------------------------------------------------------

const roles = Array.isArray(manifest.roles) ? manifest.roles : [];

if (roles.length === 0) {
  fail('"roles" must be a non-empty array');
}

const seenIds      = new Set();
const seenNames    = new Set();
const seenNumbers  = new Set();
const nonOrchIds   = new Set();
const pipelineIds  = new Set();

for (const role of roles) {
  // Required fields
  for (const field of ['id', 'name', 'number', 'persona_file']) {
    if (role[field] === undefined || role[field] === null || role[field] === '') {
      fail(`Role ${JSON.stringify(role.id || '(unknown)')}: missing required field "${field}"`);
    }
  }

  // Unique id
  if (seenIds.has(role.id)) {
    fail(`Duplicate role id: "${role.id}"`);
  }
  seenIds.add(role.id);

  // Unique name
  if (seenNames.has(role.name)) {
    fail(`Duplicate role name: "${role.name}"`);
  }
  seenNames.add(role.name);

  // Unique number
  if (seenNumbers.has(role.number)) {
    fail(`Duplicate role number: ${role.number} (role id: "${role.id}")`);
  }
  seenNumbers.add(role.number);

  // orchestrating field must be boolean
  if (typeof role.orchestrating !== 'boolean') {
    fail(`Role "${role.id}": "orchestrating" must be a boolean, got ${typeof role.orchestrating}`);
  }

  // Non-orchestrating roles may not have a null id in a pipeline context
  if (!role.orchestrating) {
    nonOrchIds.add(role.id);
  }

  // Track roles that own a pipeline
  if (role.pipeline) {
    pipelineIds.add(role.pipeline);
  }
}

// ---------------------------------------------------------------------------
// 4. Pipelines section checks
// ---------------------------------------------------------------------------

const pipelines = manifest.pipelines || {};

// canonical_order
const canonicalOrder = Array.isArray(pipelines.canonical_order) ? pipelines.canonical_order : [];
if (canonicalOrder.length === 0) {
  fail('"pipelines.canonical_order" must be a non-empty array');
}

const canonicalSet = new Set(canonicalOrder);

// Every pipeline type in canonical_order must be owned by a role
for (const pType of canonicalOrder) {
  if (!pipelineIds.has(pType)) {
    fail(`Pipeline type "${pType}" in canonical_order has no owning role (no role with pipeline: "${pType}")`);
  }
}

// default_stages must be a subset of canonical_order
const defaultStages = Array.isArray(pipelines.default_stages) ? pipelines.default_stages : [];
for (const stage of defaultStages) {
  if (!canonicalSet.has(stage)) {
    fail(`"pipelines.default_stages" entry "${stage}" is not in canonical_order`);
  }
}

// prerequisites: values must be null or known pipeline types; must form a DAG
const prereqs = pipelines.prerequisites || {};
for (const [pType, prereq] of Object.entries(prereqs)) {
  if (!canonicalSet.has(pType)) {
    fail(`"pipelines.prerequisites" key "${pType}" is not a known pipeline type`);
  }
  if (prereq !== null && !canonicalSet.has(prereq)) {
    fail(`"pipelines.prerequisites.${pType}" value "${prereq}" is not a known pipeline type`);
  }
}

// Cycle detection on prerequisites (simple DFS)
function hasCycle(node, visiting, visited) {
  if (visiting.has(node)) return true;
  if (visited.has(node))  return false;
  visiting.add(node);
  const prereq = prereqs[node];
  if (prereq && hasCycle(prereq, visiting, visited)) return true;
  visiting.delete(node);
  visited.add(node);
  return false;
}

const visiting = new Set();
const visited  = new Set();
for (const pType of canonicalOrder) {
  if (hasCycle(pType, visiting, visited)) {
    fail(`Cycle detected in pipelines.prerequisites involving "${pType}"`);
  }
}

// fail_routing: values must reference known non-orchestrating role IDs
const failRouting = pipelines.fail_routing || {};
for (const [pType, destId] of Object.entries(failRouting)) {
  if (!canonicalSet.has(pType)) {
    fail(`"pipelines.fail_routing" key "${pType}" is not a known pipeline type`);
  }
  if (!nonOrchIds.has(destId)) {
    fail(`"pipelines.fail_routing.${pType}" value "${destId}" is not a known non-orchestrating role id`);
  }
}

// ---------------------------------------------------------------------------
// 5. Statuses checks
// ---------------------------------------------------------------------------

const statuses = manifest.statuses || {};
for (const key of ['project', 'work_package', 'terminal_work_package', 'pipeline', 'blocker_type']) {
  if (!Array.isArray(statuses[key]) || statuses[key].length === 0) {
    fail(`"statuses.${key}" must be a non-empty array`);
  }
}

// terminal_work_package must be a subset of work_package
if (Array.isArray(statuses.terminal_work_package) && Array.isArray(statuses.work_package)) {
  const wpSet = new Set(statuses.work_package);
  for (const s of statuses.terminal_work_package) {
    if (!wpSet.has(s)) {
      fail(`"statuses.terminal_work_package" entry "${s}" is not in statuses.work_package`);
    }
  }
}

// ---------------------------------------------------------------------------
// 6. Constants checks
// ---------------------------------------------------------------------------

const constants = manifest.constants || {};
const numericConstants = ['max_rework_count', 'stale_pipeline_hours', 'max_handoff_depth', 'handoff_depth_multiplier'];
for (const key of numericConstants) {
  if (constants[key] === undefined) {
    fail(`"constants.${key}" is required`);
  } else if (typeof constants[key] !== 'number' || constants[key] <= 0) {
    fail(`"constants.${key}" must be a positive number, got ${constants[key]}`);
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

if (errors.length === 0) {
  const roleCount     = roles.length;
  const pipelineCount = canonicalOrder.length;
  console.log(
    `[validate-manifest] OK: ${MANIFEST_PATH.replace(WORKSPACE_ROOT + '/', '')}\n` +
    `  spec_version=${manifest.spec_version}, roles=${roleCount}, pipelines=${pipelineCount}`
  );
  process.exit(0);
} else {
  console.error(`[validate-manifest] FAIL: ${errors.length} error(s) found in ${MANIFEST_PATH.replace(WORKSPACE_ROOT + '/', '')}:\n`);
  for (const err of errors) {
    console.error(`  ✗ ${err}`);
  }
  process.exit(1);
}

```