#!/usr/bin/env node
/**
 * scripts/backfill-duration.js
 *
 * One-time backfill: populates `duration_ms` in `.meta.json` for existing
 * projects that already have `synthesis_generated_at` set on their root index
 * (`project-ledger.json`) but predate the enrichment-cache field.
 *
 * duration_ms = synthesis_generated_at - date_created (milliseconds).
 * Standalone projects with a zero-duration same-session import are nulled out,
 * matching the semantics of `LedgerStore.writeRootIndex()`.
 *
 * Usage:
 *   node scripts/backfill-duration.js [options]
 *   node scripts/cli.js backfill-duration [options]
 *
 * Options:
 *   --dry-run    Report planned changes without writing any files.
 *   --verbose    Log each project processed.
 *
 * Store discovery order:
 *   1. ~/.ai-insights/stores.json — multi-store config
 *   2. LEDGER_ROOT env var         — single-store fallback path
 *
 * Idempotent: projects whose .meta.json already has a non-null duration_ms
 * are skipped.
 */

import { readFileSync, writeFileSync, renameSync, existsSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';
import { listAllProjectDirs } from './lib/ledger-dirs.js';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const VERBOSE = args.includes('--verbose');

// ─── Store discovery ──────────────────────────────────────────────────────────

/**
 * Returns an array of absolute store root paths.
 * Precedence: stores.json → LEDGER_ROOT env var.
 * @returns {string[]}
 */
function resolveStorePaths() {
  const storesConfigPath = join(homedir(), '.ai-insights', 'stores.json');
  if (existsSync(storesConfigPath)) {
    try {
      const config = JSON.parse(readFileSync(storesConfigPath, 'utf8'));
      if (Array.isArray(config.stores) && config.stores.length > 0) {
        const paths = config.stores
          .map((s) => (typeof s.path === 'string' ? resolve(s.path.replace(/^~/, homedir())) : null))
          .filter(Boolean);
        if (paths.length > 0) {
          return paths;
        }
      }
    } catch {
      console.error(`[backfill-duration] Warning: failed to parse ${storesConfigPath} — ignoring.`);
    }
  }

  const envRoot = process.env['LEDGER_ROOT'];
  if (envRoot) {
    return [resolve(envRoot)];
  }

  return [];
}

// ─── Backfill logic ───────────────────────────────────────────────────────────

/**
 * Backfills `duration_ms` for a single project directory.
 * @param {string} projectDir
 * @returns {{ action: 'skipped-has-duration'|'skipped-no-synthesis'|'skipped-error'|'backfilled'|'dry-run', durationMs?: number|null, error?: string }}
 */
function backfillProject(projectDir) {
  const metaPath = join(projectDir, '.meta.json');
  const rootIndexPath = join(projectDir, 'project-ledger.json');

  let meta;
  try {
    meta = JSON.parse(readFileSync(metaPath, 'utf8'));
  } catch (err) {
    return { action: 'skipped-error', error: `Malformed .meta.json: ${err.message}` };
  }

  if (meta.duration_ms !== undefined && meta.duration_ms !== null) {
    return { action: 'skipped-has-duration' };
  }

  let rootIndex;
  try {
    rootIndex = JSON.parse(readFileSync(rootIndexPath, 'utf8'));
  } catch (err) {
    return { action: 'skipped-error', error: `Malformed project-ledger.json: ${err.message}` };
  }

  if (!rootIndex.synthesis_generated_at) {
    return { action: 'skipped-no-synthesis' };
  }

  // Use the root index's date_created — it is the source of truth (e.g. standalone imports
  // derive it from plan.md's filesystem birthtime, which can predate .meta.json's own
  // date_created by days). Falling back to meta.date_created would silently misreport duration.
  const created = new Date(rootIndex.date_created ?? meta.date_created).getTime();
  const synth = new Date(rootIndex.synthesis_generated_at).getTime();

  let durationMs;
  if (isNaN(created) || isNaN(synth) || synth < created) {
    durationMs = null;
  } else if (synth === created && rootIndex.runner === 'standalone') {
    durationMs = null;
  } else {
    durationMs = synth - created;
  }

  if (DRY_RUN) {
    return { action: 'dry-run', durationMs };
  }

  const updatedMeta = { ...meta, duration_ms: durationMs };
  const tmp = metaPath + '.tmp';
  writeFileSync(tmp, JSON.stringify(updatedMeta, null, 2) + '\n', 'utf8');
  renameSync(tmp, metaPath);

  return { action: 'backfilled', durationMs };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const storePaths = resolveStorePaths();

  if (storePaths.length === 0) {
    console.error(
      '[backfill-duration] Error: no store paths found.\n' +
      '  Options:\n' +
      '    ~/.ai-insights/stores.json  Configure multi-store paths.\n' +
      '    LEDGER_ROOT=<path>          Set an env var for single-store mode.'
    );
    process.exit(1);
  }

  if (DRY_RUN) {
    console.log('[backfill-duration] Dry-run mode — no files will be written.\n');
  }

  let total = 0;
  let backfilled = 0;
  let skippedHasDuration = 0;
  let skippedNoSynthesis = 0;
  let skippedError = 0;

  for (const storePath of storePaths) {
    if (!existsSync(storePath) || !statSync(storePath).isDirectory()) {
      console.log(`[backfill-duration] Store not found, skipping: ${storePath}`);
      continue;
    }

    const projectDirs = await listAllProjectDirs(storePath);
    console.log(`[backfill-duration] Store: ${storePath} (${projectDirs.length} project(s))`);

    for (const projectDir of projectDirs) {
      const result = backfillProject(projectDir);
      total++;

      switch (result.action) {
        case 'skipped-has-duration':
          skippedHasDuration++;
          if (VERBOSE) console.log(`  [skip]      ${projectDir} — already has duration_ms`);
          break;
        case 'skipped-no-synthesis':
          skippedNoSynthesis++;
          if (VERBOSE) console.log(`  [skip]      ${projectDir} — no synthesis_generated_at`);
          break;
        case 'skipped-error':
          skippedError++;
          console.log(`  [error]     ${projectDir} — ${result.error}`);
          break;
        case 'dry-run':
          backfilled++;
          console.log(`  [dry-run]   ${projectDir} — duration_ms would be ${result.durationMs}`);
          break;
        case 'backfilled':
          backfilled++;
          if (VERBOSE) console.log(`  [backfilled] ${projectDir} — duration_ms = ${result.durationMs}`);
          break;
      }
    }
  }

  console.log(
    `\n[backfill-duration] Done. ${total} project(s) processed: ` +
    `${backfilled} ${DRY_RUN ? 'would be backfilled' : 'backfilled'}, ` +
    `${skippedHasDuration} skipped (already had duration), ` +
    `${skippedNoSynthesis} skipped (no synthesis), ` +
    `${skippedError} skipped (error).`
  );
}

main().catch((err) => {
  console.error('[backfill-duration] Fatal:', err.message ?? err);
  process.exit(1);
});
