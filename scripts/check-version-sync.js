#!/usr/bin/env node

/**
 * scripts/check-version-sync.js
 *
 * Compares each module's changelog version (source of truth) against its
 * package manifest version, and — for npm modules — against both version fields
 * in package-lock.json. Exits with code 1 on any mismatch.
 *
 * The lock check matters because `npm ci` does NOT validate the lock's root
 * version field against package.json; it only validates the dependency tree.
 * A stale lock version therefore sits latent until an unrelated `npm install`
 * silently rewrites it into someone else's commit.
 *
 * Usage:
 *   node scripts/check-version-sync.js          # from workspace root
 *
 * Modules checked:
 *   - mcp-server:    changelog.md  vs  package.json + package-lock.json
 *   - orchestrator:  changelog.md  vs  pyproject.toml
 *   - personas:      changelog.md  vs  package.json + package-lock.json
 */

import path from 'path';
import fs from 'fs';
import {
  readChangelogVersion,
  readLockVersions,
} from './lib/package-version.js';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '..');

// ─── Module definitions ──────────────────────────────────────────────────────

const MODULES = [
  {
    name:        'workspace root',
    changelog:   path.join(WORKSPACE_ROOT, 'changelog.md'),
    manifest:    path.join(WORKSPACE_ROOT, 'package.json'),
    manifestFmt: 'package.json',
    lockfile:    path.join(WORKSPACE_ROOT, 'package-lock.json'),
    readManifestVersion(filePath) {
      const pkg = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return pkg.version || null;
    },
  },
  {
    name:        'mcp-server',
    changelog:   path.join(WORKSPACE_ROOT, 'mcp-server', 'changelog.md'),
    manifest:    path.join(WORKSPACE_ROOT, 'mcp-server', 'package.json'),
    manifestFmt: 'package.json',
    lockfile:    path.join(WORKSPACE_ROOT, 'mcp-server', 'package-lock.json'),
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
    lockfile:    path.join(WORKSPACE_ROOT, 'personas', 'package-lock.json'),
    readManifestVersion(filePath) {
      const pkg = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return pkg.version || null;
    },
  },
];


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

  if (changelogVer === 'UNRELEASED') {
    console.log(`[check-version-sync] Skipping ${mod.name}: changelog has an UNRELEASED entry.`);
    continue;
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
      name:  mod.name,
      field: mod.manifestFmt,
      expected: changelogVer,
      actual:   manifestVer,
    });
  }

  if (!mod.lockfile) continue;

  let lockVers;
  try {
    lockVers = readLockVersions(mod.lockfile);
  } catch (err) {
    console.error(`[check-version-sync] ERROR: Cannot read ${mod.name}/package-lock.json: ${err.message}`);
    process.exit(1);
  }

  // A module without a lock file is a valid state, not a mismatch.
  if (!lockVers) continue;

  if (lockVers.root !== changelogVer) {
    mismatches.push({
      name:  mod.name,
      field: 'package-lock.json (version)',
      expected: changelogVer,
      actual:   lockVers.root,
    });
  }

  if (lockVers.pkg !== null && lockVers.pkg !== changelogVer) {
    mismatches.push({
      name:  mod.name,
      field: 'package-lock.json (packages[""].version)',
      expected: changelogVer,
      actual:   lockVers.pkg,
    });
  }
}

if (mismatches.length > 0) {
  console.error('[check-version-sync] Version mismatch detected:\n');
  for (const m of mismatches) {
    console.error(`  ${m.name}: changelog says v${m.expected}, ${m.field} says v${m.actual}`);
  }
  console.error('\nRun this to fix:  node scripts/cli.js build-maintain\n');
  process.exit(1);
}

console.log('[check-version-sync] All module versions are in sync.');
process.exit(0);
