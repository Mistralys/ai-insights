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

import path from 'path';
import fs from 'fs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '..');

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
 * Returns 'UNRELEASED' if the first heading is an UNRELEASED entry.
 * @param {string} filePath - Absolute path to the changelog file.
 * @returns {string|null} The version string (without the "v" prefix), 'UNRELEASED', or null.
 */
function readChangelogVersion(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const firstHeading = content.match(/^##\s+(.+)/m);
  if (firstHeading && /unreleased/i.test(firstHeading[1])) {
    return 'UNRELEASED';
  }
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
