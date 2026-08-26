#!/usr/bin/env node
/**
 * scripts/dev-link.js
 *
 * Switch the workspace between DEV mode (sibling repos symlinked into
 * node_modules/ via `npm link`) and PROD mode (dependencies resolved from the
 * npm registry via package-lock.json).
 *
 * `npm link` only touches the gitignored node_modules/ tree — package.json and
 * package-lock.json are never modified, so the switch is fully reversible and
 * safe to commit around (the pre-commit hook blocks commits while DEV mode is
 * active, see .githooks/pre-commit).
 *
 * Usage:
 *   node scripts/dev-link.js link   [--package <name>] [--skip-build]
 *   node scripts/dev-link.js unlink [--package <name>]
 *   node scripts/dev-link.js status
 *
 * Options:
 *   --package <name>  Restrict the operation to a single package. Accepts the
 *                     short alias (persona-builder, cli-menu) or the full
 *                     scoped npm name.
 *   --skip-build      Skip `npm run build` in the sibling repo (use when its
 *                     dist/ is already fresh, e.g. under `npm run dev` watch).
 */

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '..');
const SIBLING_ROOT   = path.resolve(WORKSPACE_ROOT, '..');
const MARKER_FILE    = path.join(WORKSPACE_ROOT, '.dev-links.json');

/**
 * Linkable sibling packages. `siblingDir` is resolved relative to the parent of
 * the workspace root; `consumerDir` is the directory whose node_modules/ receives
 * the symlink.
 */
const PACKAGES = [
  {
    alias:      'persona-builder',
    name:       '@mistralys/persona-builder',
    siblingDir: path.join(SIBLING_ROOT, 'ai-persona-builder'),
    consumer:   path.join(WORKSPACE_ROOT, 'personas'),
  },
  {
    alias:      'cli-menu',
    name:       '@mistralys/cli-menu',
    siblingDir: path.join(SIBLING_ROOT, 'cli-menu'),
    consumer:   WORKSPACE_ROOT,
  },
];

const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** @param {string[]} argv */
function parseArgs(argv) {
  const subcommand = argv[0] && !argv[0].startsWith('-') ? argv[0] : 'status';
  const pkgIndex   = argv.indexOf('--package');
  const pkgFilter  = pkgIndex !== -1 ? (argv[pkgIndex + 1] ?? null) : null;
  return {
    subcommand,
    pkgFilter,
    skipBuild: argv.includes('--skip-build'),
  };
}

/**
 * Resolve the package list for this invocation.
 * @param {string|null} filter alias or full scoped name
 * @returns {typeof PACKAGES}
 */
function selectPackages(filter) {
  if (!filter) return PACKAGES;
  const matches = PACKAGES.filter((p) => p.alias === filter || p.name === filter);
  if (matches.length === 0) {
    const known = PACKAGES.map((p) => p.alias).join(', ');
    console.error(`[dev-link] Unknown package "${filter}". Known packages: ${known}`);
    process.exit(1);
  }
  return matches;
}

/**
 * Run a command, streaming its output. Returns the exit code.
 * @param {string} cmd
 * @param {string[]} args
 * @param {string} cwd
 * @returns {number}
 */
function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: false });
  if (r.error) {
    console.error(`[dev-link] Failed to spawn ${cmd}: ${r.error.message}`);
    return 1;
  }
  return r.status ?? 1;
}

/**
 * @param {string} consumerDir
 * @param {string} pkgName
 * @returns {string}
 */
function modulePath(consumerDir, pkgName) {
  return path.join(consumerDir, 'node_modules', ...pkgName.split('/'));
}

/**
 * True when the package is currently installed as a symlink.
 * @param {typeof PACKAGES[number]} pkg
 * @returns {boolean}
 */
function isLinked(pkg) {
  try {
    return fs.lstatSync(modulePath(pkg.consumer, pkg.name)).isSymbolicLink();
  } catch {
    return false;
  }
}

/** @returns {{ linked: Record<string,string>, linked_at: string }|null} */
function readMarker() {
  if (!fs.existsSync(MARKER_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(MARKER_FILE, 'utf8'));
  } catch (err) {
    console.error(`[dev-link] Warning: ${MARKER_FILE} is unreadable (${err.message}) — treating as absent.`);
    return null;
  }
}

/** @param {Record<string,string>} linked */
function writeMarker(linked) {
  if (Object.keys(linked).length === 0) {
    removeMarker();
    return;
  }
  const payload = { linked, linked_at: new Date().toISOString() };
  fs.writeFileSync(MARKER_FILE, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function removeMarker() {
  if (fs.existsSync(MARKER_FILE)) fs.rmSync(MARKER_FILE);
}

/** @param {string} p Absolute path to relativize for display. */
function rel(p) {
  return path.relative(WORKSPACE_ROOT, p) || '.';
}

// ─── Subcommands ──────────────────────────────────────────────────────────────

/**
 * @param {typeof PACKAGES} packages
 * @param {boolean} skipBuild
 * @returns {number} exit code
 */
function cmdLink(packages, skipBuild) {
  const marker = readMarker();
  /** @type {Record<string,string>} */
  const linked = marker ? { ...marker.linked } : {};
  const skipped = [];
  let failed = false;

  for (const pkg of packages) {
    if (!fs.existsSync(pkg.siblingDir)) {
      console.warn(`[dev-link] Sibling repo not found for ${pkg.name} at ${pkg.siblingDir} — skipping.`);
      skipped.push(pkg.name);
      continue;
    }

    if (!fs.existsSync(path.join(pkg.consumer, 'package.json'))) {
      console.warn(`[dev-link] No package.json in ${rel(pkg.consumer)} — skipping ${pkg.name}.`);
      skipped.push(pkg.name);
      continue;
    }

    console.log(`\n[dev-link] Linking ${pkg.name} from ${pkg.siblingDir}`);

    if (!skipBuild) {
      if (run(NPM, ['run', 'build'], pkg.siblingDir) !== 0) {
        console.error(`[dev-link] Build failed in ${pkg.siblingDir} — skipping ${pkg.name}.`);
        failed = true;
        continue;
      }
    }

    if (run(NPM, ['link'], pkg.siblingDir) !== 0) {
      console.error(`[dev-link] 'npm link' failed in ${pkg.siblingDir} — skipping ${pkg.name}.`);
      failed = true;
      continue;
    }

    if (run(NPM, ['link', pkg.name], pkg.consumer) !== 0) {
      console.error(`[dev-link] 'npm link ${pkg.name}' failed in ${pkg.consumer}.`);
      failed = true;
      continue;
    }

    const target = modulePath(pkg.consumer, pkg.name);
    if (!isLinked(pkg)) {
      console.error(
        `[dev-link] Expected a symlink at ${rel(target)} but found none. ` +
        `Your npm version may not support 'npm link' as expected — run it manually to diagnose.`
      );
      failed = true;
      continue;
    }

    linked[pkg.name] = path.relative(WORKSPACE_ROOT, pkg.siblingDir);
    console.log(`[dev-link] ✓ ${pkg.name} → ${rel(target)}`);
  }

  writeMarker(linked);

  console.log('');
  if (Object.keys(linked).length === 0) {
    console.log('[dev-link] Nothing linked — still in PROD mode.');
  } else {
    console.log('[dev-link] DEV mode active. Linked packages:');
    for (const [name, dir] of Object.entries(linked)) {
      console.log(`  ${name} → ${dir}`);
    }
    console.log('');
    console.log('  Run `npm run dev` in the sibling repo for live rebuilds on change.');
    console.log('  Run `node scripts/cli.js dev-unlink` before committing.');
  }
  if (skipped.length > 0) {
    console.log(`\n[dev-link] Skipped (sibling repo absent): ${skipped.join(', ')}`);
  }

  return failed ? 1 : 0;
}

/**
 * @param {typeof PACKAGES} packages
 * @returns {number} exit code
 */
function cmdUnlink(packages) {
  const marker = readMarker();
  /** @type {Record<string,string>} */
  const linked = marker ? { ...marker.linked } : {};
  let failed = false;

  // Only reinstall consumers that actually have a linked package: a stray
  // `npm install` can rewrite the tracked package-lock.json version field.
  // The symlink check is the fallback for a lost or hand-deleted marker.
  // Deduplicate — one install restores every registry dependency in a directory.
  const consumers = [...new Set(
    packages.filter((p) => linked[p.name] || isLinked(p)).map((p) => p.consumer)
  )];

  for (const consumer of consumers) {
    if (!fs.existsSync(path.join(consumer, 'package.json'))) {
      console.warn(`[dev-link] No package.json in ${rel(consumer)} — skipping npm install.`);
      continue;
    }
    console.log(`\n[dev-link] Restoring registry dependencies in ${rel(consumer)}`);
    if (run(NPM, ['install'], consumer) !== 0) {
      console.error(`[dev-link] 'npm install' failed in ${consumer}.`);
      failed = true;
    }
  }

  if (consumers.length === 0) {
    console.log('[dev-link] Nothing was linked — no dependencies to restore.');
  }

  for (const pkg of packages) delete linked[pkg.name];
  writeMarker(linked);

  console.log('');
  if (Object.keys(linked).length === 0) {
    console.log('[dev-link] PROD mode — all dependencies from the npm registry.');
  } else {
    console.log('[dev-link] Still in DEV mode for:');
    for (const name of Object.keys(linked)) console.log(`  ${name}`);
  }

  return failed ? 1 : 0;
}

/** @returns {number} exit code */
function cmdStatus() {
  const marker = readMarker();
  if (!marker || Object.keys(marker.linked ?? {}).length === 0) {
    console.log('PROD mode — all dependencies from npm registry.');
    return 0;
  }
  console.log(`DEV mode — linked at ${marker.linked_at}`);
  for (const [name, dir] of Object.entries(marker.linked)) {
    console.log(`  ${name} → ${dir}`);
  }
  return 0;
}

// ─── Entry point ──────────────────────────────────────────────────────────────

function main() {
  const { subcommand, pkgFilter, skipBuild } = parseArgs(process.argv.slice(2));

  switch (subcommand) {
    case 'link':
      return cmdLink(selectPackages(pkgFilter), skipBuild);
    case 'unlink':
      return cmdUnlink(selectPackages(pkgFilter));
    case 'status':
      return cmdStatus();
    default:
      console.error(`[dev-link] Unknown subcommand "${subcommand}". Expected: link | unlink | status`);
      return 1;
  }
}

process.exit(main());
