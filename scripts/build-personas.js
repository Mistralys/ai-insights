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
