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

// Pre-build: clean output directories so stale/renamed files don't linger.
// Skipped in --check / --dry-run mode (read-only).
if (!CHECK) {
  const config = require(CONFIG);
  const outputDirs = [];
  for (const suite of Object.values(config.suites)) {
    if (suite.outVscode)     outputDirs.push(suite.outVscode);
    if (suite.outClaudeCode) outputDirs.push(suite.outClaudeCode);
    if (suite.outputDirs) {
      for (const dir of Object.values(suite.outputDirs)) {
        outputDirs.push(dir);
      }
    }
  }
  for (const dir of outputDirs) {
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
    for (const file of files) {
      fs.unlinkSync(path.join(dir, file));
    }
  }
}

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
