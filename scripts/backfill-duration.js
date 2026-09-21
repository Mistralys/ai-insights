#!/usr/bin/env node
/**
 * scripts/backfill-duration.js
 *
 * One-time backfill: populates `duration_ms`, `active_ms`, and `pipeline_runs`
 * in `.meta.json` for existing projects that already have `synthesis_generated_at`
 * set on their root index (`project-ledger.json`) but predate one or more of these
 * enrichment-cache fields.
 *
 * duration_ms = synthesis_generated_at - date_created (milliseconds, wall-clock).
 * Standalone projects with a zero-duration same-session import are nulled out,
 * matching the semantics of `LedgerStore.writeRootIndex()`.
 *
 * active_ms / pipeline_runs = the sum of completed-pipeline `duration_ms` (and
 * their count) across every work package, read from each `WP-###.json` detail
 * file. `active_ms` is null when no pipeline in the project carries a duration.
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
 * Idempotent: each of `duration_ms` and `active_ms`/`pipeline_runs` is skipped
 * independently once already cached, so a project with one field populated
 * still receives the other.
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
 * Computes the wall-clock `duration_ms` for a project, or `null` when it
 * cannot be determined or should be nulled (zero-duration standalone import).
 * @param {object} rootIndex
 * @param {object} meta
 * @returns {number|null}
 */
function computeWallClockDurationMs(rootIndex, meta) {
  // Use the root index's date_created — it is the source of truth (e.g. standalone imports
  // derive it from plan.md's filesystem birthtime, which can predate .meta.json's own
  // date_created by days). Falling back to meta.date_created would silently misreport duration.
  const created = new Date(rootIndex.date_created ?? meta.date_created).getTime();
  const synth = new Date(rootIndex.synthesis_generated_at).getTime();

  if (isNaN(created) || isNaN(synth) || synth < created) {
    return null;
  }
  if (synth === created && rootIndex.runner === 'standalone') {
    return null;
  }
  return synth - created;
}

/**
 * Sums `duration_ms` across every pipeline of every work package in a project,
 * reading each `WP-###.json` detail file directly under `projectDir` — the same
 * convention as `LedgerStore.wpDetailPath()` (the root index's `work_packages[].file`
 * field is not the actual on-disk path and is not used here).
 *
 * Unreadable or malformed WP detail files are skipped with a `--verbose` note
 * rather than failing the whole project.
 *
 * @param {string} projectDir
 * @param {Array<{work_package_id: string}>} workPackages
 * @returns {{ active_ms: number|null, pipeline_runs: number }}
 */
function computeActiveTime(projectDir, workPackages) {
  let activeMs = 0;
  let pipelineRuns = 0;

  for (const wp of workPackages ?? []) {
    const wpPath = join(projectDir, `${wp.work_package_id}.json`);
    let wpDetail;
    try {
      wpDetail = JSON.parse(readFileSync(wpPath, 'utf8'));
    } catch (err) {
      if (VERBOSE) {
        console.log(`  [warn]      ${projectDir} — unreadable ${wp.work_package_id}.json: ${err.message}`);
      }
      continue;
    }

    for (const pipeline of wpDetail.pipelines ?? []) {
      if (typeof pipeline.duration_ms === 'number') {
        activeMs += pipeline.duration_ms;
        pipelineRuns++;
      }
    }
  }

  return { active_ms: pipelineRuns > 0 ? activeMs : null, pipeline_runs: pipelineRuns };
}

/**
 * Backfills `duration_ms`, `active_ms`, and `pipeline_runs` for a single project
 * directory. Each field is skipped independently once already cached, so a
 * project with `duration_ms` set still receives `active_ms` / `pipeline_runs`.
 *
 * @param {string} projectDir
 * @returns {{ action: 'skipped-no-synthesis'|'skipped-error'|'skipped-up-to-date'|'backfilled'|'dry-run', durationMs?: number|null, activeMs?: number|null, pipelineRuns?: number, error?: string }}
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

  let rootIndex;
  try {
    rootIndex = JSON.parse(readFileSync(rootIndexPath, 'utf8'));
  } catch (err) {
    return { action: 'skipped-error', error: `Malformed project-ledger.json: ${err.message}` };
  }

  if (!rootIndex.synthesis_generated_at) {
    return { action: 'skipped-no-synthesis' };
  }

  const needsDuration = meta.duration_ms === undefined || meta.duration_ms === null;
  const needsActiveTime = meta.active_ms === undefined || meta.pipeline_runs === undefined;

  if (!needsDuration && !needsActiveTime) {
    return { action: 'skipped-up-to-date' };
  }

  const durationMs = needsDuration ? computeWallClockDurationMs(rootIndex, meta) : meta.duration_ms;
  const { active_ms: activeMs, pipeline_runs: pipelineRuns } = needsActiveTime
    ? computeActiveTime(projectDir, rootIndex.work_packages)
    : { active_ms: meta.active_ms, pipeline_runs: meta.pipeline_runs };

  if (DRY_RUN) {
    return { action: 'dry-run', durationMs, activeMs, pipelineRuns };
  }

  const updatedMeta = { ...meta, duration_ms: durationMs, active_ms: activeMs, pipeline_runs: pipelineRuns };
  const tmp = metaPath + '.tmp';
  writeFileSync(tmp, JSON.stringify(updatedMeta, null, 2) + '\n', 'utf8');
  renameSync(tmp, metaPath);

  return { action: 'backfilled', durationMs, activeMs, pipelineRuns };
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
  let skippedUpToDate = 0;
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
        case 'skipped-up-to-date':
          skippedUpToDate++;
          if (VERBOSE) console.log(`  [skip]      ${projectDir} — duration_ms and active_ms/pipeline_runs already cached`);
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
          console.log(`  [dry-run]   ${projectDir} — duration_ms would be ${result.durationMs}, active_ms would be ${result.activeMs}, pipeline_runs would be ${result.pipelineRuns}`);
          break;
        case 'backfilled':
          backfilled++;
          if (VERBOSE) console.log(`  [backfilled] ${projectDir} — duration_ms = ${result.durationMs}, active_ms = ${result.activeMs}, pipeline_runs = ${result.pipelineRuns}`);
          break;
      }
    }
  }

  console.log(
    `\n[backfill-duration] Done. ${total} project(s) processed: ` +
    `${backfilled} ${DRY_RUN ? 'would be backfilled' : 'backfilled'}, ` +
    `${skippedUpToDate} skipped (already up to date), ` +
    `${skippedNoSynthesis} skipped (no synthesis), ` +
    `${skippedError} skipped (error).`
  );
}

main().catch((err) => {
  console.error('[backfill-duration] Fatal:', err.message ?? err);
  process.exit(1);
});
