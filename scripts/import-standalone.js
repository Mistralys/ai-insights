#!/usr/bin/env node

/**
 * import-standalone.js
 *
 * Import standalone plan folder(s) into the project ledger.
 *
 * Calls the compiled `mcp-server/dist/tools/standalone-import.js` handler
 * directly — no MCP protocol overhead, no schema duplication.
 * Includes a dist-freshness check that rebuilds mcp-server when stale,
 * following the same pattern as scripts/run-orchestrator.js.
 *
 * Usage:
 *   node scripts/import-standalone.js --path <plan-folder>
 *   node scripts/import-standalone.js --batch [--base-dir <dir>] [--dry-run]
 *
 * Flags:
 *   --path <dir>      Import a single plan folder.
 *   --batch           Scan docs/agents/ (or --base-dir) for untracked plans.
 *   --base-dir <dir>  Override the default batch scan root (default: docs/agents/).
 *   --dry-run         Preview what would be imported; write nothing.
 *   --verbose         Log full error stacks on I/O failures in collectKnownSlugs().
 */

import path from 'path';
import fs from 'fs';
import readline from 'readline';
import { spawnSync } from 'child_process';
import { pathToFileURL } from 'url';
import { listAllProjectDirs } from './lib/ledger-dirs.js';

// ---------------------------------------------------------------------------
// 1. Resolve paths
// ---------------------------------------------------------------------------
const WORKSPACE_ROOT    = path.resolve(import.meta.dirname, '..');
const MCP_SRC           = path.join(WORKSPACE_ROOT, 'mcp-server', 'src');
const MCP_DIST_SENTINEL = path.join(WORKSPACE_ROOT, 'mcp-server', 'dist', 'index.js');
const MCP_DIST_TOOL     = path.join(WORKSPACE_ROOT, 'mcp-server', 'dist', 'tools', 'standalone-import.js');
const LEDGER_ROOT       = path.join(WORKSPACE_ROOT, 'mcp-server', 'storage', 'ledger');
const DEFAULT_SCAN_ROOT = path.join(WORKSPACE_ROOT, 'docs', 'agents');

/** Matches plan folder names: YYYY-MM-DD-{name} */
const PLAN_SLUG_RE = /^\d{4}-\d{2}-\d{2}-.+$/;

// ---------------------------------------------------------------------------
// 2. Dist-freshness check (same pattern as run-orchestrator.js)
// ---------------------------------------------------------------------------

/**
 * Recursively returns the largest mtime (ms) of any file under `dir`.
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

function ensureDistFresh() {
  let needBuild = false;

  if (!fs.existsSync(MCP_DIST_SENTINEL)) {
    needBuild = true;
  } else {
    const sentinelMtime = fs.statSync(MCP_DIST_SENTINEL).mtimeMs;
    if (latestMtime(MCP_SRC) > sentinelMtime) {
      needBuild = true;
    }
  }

  if (needBuild) {
    console.log('[import-standalone.js] mcp-server/dist is stale or missing — building MCP server...');
    const isWindows = process.platform === 'win32';
    const npmCmd = isWindows ? 'npm.cmd' : 'npm';
    const build = spawnSync(npmCmd, ['run', 'build'], {
      cwd: path.join(WORKSPACE_ROOT, 'mcp-server'),
      stdio: 'inherit',
      shell: isWindows,
    });
    if (build.status !== 0) {
      console.error('[import-standalone.js] MCP server build failed.');
      process.exit(build.status ?? 1);
    }
  }

  if (!fs.existsSync(MCP_DIST_TOOL)) {
    console.error(`Error: compiled tool not found at ${MCP_DIST_TOOL}`);
    console.error('Try running: cd mcp-server && npm run build');
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// 3. Ledger cross-reference — collect all known slugs
// ---------------------------------------------------------------------------

/**
 * Scans the ledger storage root and returns a Set of all known project slugs.
 * Directory discovery (legacy flat layout vs. namespaced
 * `{repoName}/{slug}/` layout) is delegated to the canonical
 * `LedgerStore.listAllProjectDirs()` via `scripts/lib/ledger-dirs.js` —
 * never re-implemented here.
 *
 * @returns {Promise<Set<string>>}
 */
async function collectKnownSlugs(verbose = false) {
  const slugs = new Set();

  let projectDirs;
  try {
    projectDirs = await listAllProjectDirs(LEDGER_ROOT);
  } catch (err) {
    console.warn(`  ⚠ Could not scan ${LEDGER_ROOT}: ${err.message}`);
    if (verbose) {
      console.warn(err.stack);
    }
    return slugs;
  }

  for (const dir of projectDirs) {
    const slug = path.basename(dir);
    if (PLAN_SLUG_RE.test(slug)) {
      slugs.add(slug);
    }
  }

  return slugs;
}

// ---------------------------------------------------------------------------
// 4. Plan folder scanning
// ---------------------------------------------------------------------------

/**
 * Returns true if `folderPath` is a valid importable plan folder:
 * - basename matches YYYY-MM-DD-{name}
 * - contains plan.md
 * - contains synthesis.md
 *
 * @param {string} folderPath
 * @returns {boolean}
 */
function isPlanFolder(folderPath) {
  const name = path.basename(folderPath);
  return (
    PLAN_SLUG_RE.test(name) &&
    fs.existsSync(path.join(folderPath, 'plan.md')) &&
    fs.existsSync(path.join(folderPath, 'synthesis.md'))
  );
}

/**
 * Recursively scans `scanRoot` and returns all plan folder paths that satisfy
 * `isPlanFolder`. Does not recurse into matched plan folders.
 *
 * @param {string} scanRoot
 * @returns {string[]}
 */
function scanPlanFolders(scanRoot) {
  const results = [];
  if (!fs.existsSync(scanRoot)) return results;

  function walkDir(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const full = path.join(dir, entry.name);
      if (PLAN_SLUG_RE.test(entry.name)) {
        if (isPlanFolder(full)) {
          results.push(full);
        }
        // Don't recurse into plan folders — they don't nest.
      } else {
        walkDir(full);
      }
    }
  }

  walkDir(scanRoot);
  return results;
}

// ---------------------------------------------------------------------------
// 5. Confirmation helper
// ---------------------------------------------------------------------------

/**
 * Prompts the user for a yes/no answer and resolves to `true` when they
 * confirm (answer starts with 'y').
 *
 * @param {string} prompt
 * @returns {Promise<boolean>}
 */
function askConfirm(prompt) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, answer => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'y');
    });
  });
}

// ---------------------------------------------------------------------------
// 6. Single-plan import
// ---------------------------------------------------------------------------

/**
 * @param {Function} importFn
 * @param {string} planPath  Absolute path to the plan folder.
 * @param {boolean} dryRun
 * @returns {Promise<void>}
 */
async function importSinglePlan(importFn, planPath, dryRun) {
  const slug = path.basename(planPath);
  console.log(`Importing: ${slug}`);
  console.log(`  Path: ${planPath}`);

  if (dryRun) {
    console.log('  [dry-run] No files written.');
    return;
  }

  const result = await importFn({ project_path: planPath });

  if (result.isError) {
    const msg = result.content[0]?.text ?? 'Unknown error';
    console.error(`  ✗ ${msg}`);
    process.exit(1);
  }

  const data = JSON.parse(result.content[0].text);
  console.log(`  ✓ Imported successfully`);
  console.log(`    Slug:    ${data.slug}`);
  if (data.outcome_summary) {
    console.log(`    Summary: ${data.outcome_summary}`);
  }
  console.log(`    Storage: ${data.project_storage_path}`);
  if (data.archived_files && data.archived_files.length > 0) {
    console.log(`    Archived: ${data.archived_files.join(', ')}`);
  }
}

// ---------------------------------------------------------------------------
// 7. Batch import
// ---------------------------------------------------------------------------

/**
 * @param {Function} importFn
 * @param {string} scanRoot   Root directory to scan for plan folders.
 * @param {boolean} dryRun
 * @returns {Promise<void>}
 */
async function runBatch(importFn, scanRoot, dryRun, verbose = false) {
  console.log(`\nScanning: ${scanRoot}\n`);

  const candidates = scanPlanFolders(scanRoot);

  if (candidates.length === 0) {
    console.log('No plan folders found (requires plan.md and synthesis.md).');
    return;
  }

  const knownSlugs = await collectKnownSlugs(verbose);
  const toImport       = candidates.filter(p => !knownSlugs.has(path.basename(p)));
  const alreadyTracked = candidates.filter(p =>  knownSlugs.has(path.basename(p)));

  if (alreadyTracked.length > 0) {
    console.log(`Already imported (${alreadyTracked.length}):`);
    for (const p of alreadyTracked) {
      console.log(`  ✓ ${path.basename(p)}`);
    }
    console.log('');
  }

  if (toImport.length === 0) {
    console.log('All plans are already imported — nothing to do.');
    return;
  }

  console.log(`Plans to import (${toImport.length}):`);
  for (const p of toImport) {
    console.log(`  • ${path.basename(p)}`);
  }

  if (dryRun) {
    console.log('\n[dry-run] No files written.');
    return;
  }

  const confirmed = await askConfirm(`\nImport ${toImport.length} plan(s)? [y/N] `);
  if (!confirmed) {
    console.log('Aborted.');
    return;
  }

  console.log('\nImporting:');
  let imported = 0;
  let skipped  = 0;
  let failed   = 0;

  for (const planPath of toImport) {
    const slug = path.basename(planPath);
    process.stdout.write(`  → ${slug} ... `);

    const result = await importFn({ project_path: planPath });

    if (result.isError) {
      const msg = result.content[0]?.text ?? 'Unknown error';
      if (msg.includes('already exists')) {
        console.log('already imported (skipped)');
        skipped++;
      } else {
        console.log(`FAILED — ${msg}`);
        failed++;
      }
    } else {
      const data = JSON.parse(result.content[0].text);
      console.log(`imported → ${data.project_storage_path}`);
      imported++;
    }
  }

  console.log(`\nDone: ${imported} imported, ${skipped} skipped, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

// ---------------------------------------------------------------------------
// 8. Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);

  const pathIdx  = args.indexOf('--path');
  const planPath = pathIdx !== -1 ? args[pathIdx + 1] : null;

  const isBatch  = args.includes('--batch');
  const isDryRun = args.includes('--dry-run');
  const isVerbose = args.includes('--verbose');

  const baseDirIdx = args.indexOf('--base-dir');
  const baseDir    = baseDirIdx !== -1
    ? path.resolve(args[baseDirIdx + 1])
    : DEFAULT_SCAN_ROOT;

  if (!planPath && !isBatch) {
    console.error('Error: specify --path <plan-folder> or --batch');
    console.error('');
    console.error('Usage:');
    console.error('  node scripts/import-standalone.js --path <plan-folder>');
    console.error('  node scripts/import-standalone.js --batch [--base-dir <dir>] [--dry-run]');
    process.exit(1);
  }

  // Dist-freshness check — rebuild mcp-server if needed.
  ensureDistFresh();

  // Load the compiled tool handler.
  const toolModule = await import(pathToFileURL(MCP_DIST_TOOL).href);
  const { importStandalone } = toolModule._internal;

  if (planPath) {
    await importSinglePlan(importStandalone, path.resolve(planPath), isDryRun);
  } else {
    await runBatch(importStandalone, baseDir, isDryRun, isVerbose);
  }
}

main().catch(err => {
  console.error('Fatal:', err.message ?? err);
  process.exit(1);
});
