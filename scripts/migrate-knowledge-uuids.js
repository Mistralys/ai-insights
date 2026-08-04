#!/usr/bin/env node
/**
 * scripts/migrate-knowledge-uuids.js
 *
 * One-time batch migration: converts all knowledge store files from schema
 * v1 (numeric `id`, `next_id` counter) to v2 (UUID v4 `id`, no `next_id`).
 *
 * Run this script before deploying the WP-002–WP-006 code changes that update
 * the MCP server schema and storage layer to require UUID identifiers.
 *
 * Usage:
 *   node scripts/migrate-knowledge-uuids.js [options]
 *
 * Options:
 *   --dry-run         Report planned changes without writing any files.
 *   --verbose         Log each file and the old→new ID mappings.
 *   --store <path>    Explicit store root path. Repeatable; overrides
 *                     auto-detection. Example:
 *                       --store /path/to/ledger-storage/store \
 *                       --store /path/to/nexus-ledger-storage/store
 *
 * Store discovery order (when --store flags are absent):
 *   1. ~/.ai-insights/stores.json  — multi-store config
 *   2. LEDGER_ROOT env var          — single-store fallback path
 *
 * Idempotent: files already at version "2.0.0" are silently skipped.
 */

import { readFileSync, writeFileSync, renameSync, readdirSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';

// ─── CLI argument parsing ─────────────────────────────────────────────────────

const args = process.argv.slice(2);

const DRY_RUN = args.includes('--dry-run');
const VERBOSE = args.includes('--verbose');

/** Collect all --store <path> arguments. */
const EXPLICIT_STORES = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--store' && args[i + 1] && !args[i + 1].startsWith('--')) {
    EXPLICIT_STORES.push(resolve(args[++i]));
  }
}

// ─── Store discovery ──────────────────────────────────────────────────────────

/**
 * Returns an array of absolute store root paths.
 * Precedence: explicit --store flags → stores.json → LEDGER_ROOT env var.
 * @returns {string[]}
 */
function resolveStorePaths() {
  if (EXPLICIT_STORES.length > 0) {
    return EXPLICIT_STORES;
  }

  // Try ~/.ai-insights/stores.json
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
      console.error(`[migrate] Warning: failed to parse ${storesConfigPath} — ignoring.`);
    }
  }

  // Fall back to LEDGER_ROOT env var
  const envRoot = process.env['LEDGER_ROOT'];
  if (envRoot) {
    return [resolve(envRoot)];
  }

  return [];
}

// ─── Migration helpers ────────────────────────────────────────────────────────

/**
 * Collects all *-insights.json files inside {storePath}/.knowledge/.
 * Returns an empty array if the directory does not exist.
 * @param {string} storePath
 * @returns {string[]} Absolute file paths.
 */
function collectKnowledgeFiles(storePath) {
  const knowledgeDir = join(storePath, '.knowledge');
  if (!existsSync(knowledgeDir)) {
    return [];
  }
  return readdirSync(knowledgeDir)
    .filter((name) => name.endsWith('-insights.json'))
    .map((name) => join(knowledgeDir, name));
}

/**
 * Migrates a single knowledge store file in-place.
 * Returns a summary object describing what happened.
 * @param {string} filePath
 * @returns {{ filePath: string, action: 'skipped'|'migrated'|'dry-run', count: number, mappings: Map<number, string> }}
 */
function migrateFile(filePath) {
  const raw = readFileSync(filePath, 'utf8');
  const data = JSON.parse(raw);

  if (data.version === '2.0.0') {
    return { filePath, action: 'skipped', count: 0, mappings: new Map() };
  }

  const insights = Array.isArray(data.insights) ? data.insights : [];

  // Build numeric→UUID mapping for this file.
  /** @type {Map<number, string>} */
  const idMap = new Map();
  for (const insight of insights) {
    if (typeof insight.id === 'number') {
      idMap.set(insight.id, randomUUID());
    }
  }

  // Rewrite each insight.
  const migrated = insights.map((insight) => {
    const updated = { ...insight };

    // Replace numeric id with UUID.
    if (typeof insight.id === 'number') {
      updated.id = idMap.get(insight.id);
    }

    // Map superseded_by reference; drop if the source ID is not in this file.
    // Each knowledge store file is a self-contained scope unit with its own
    // independent ID namespace: ID 3 in global-insights.json and ID 3 in
    // repo-insights.json are different insights. Cross-file superseded_by
    // references are therefore structurally invalid, so dropping unmapped
    // references is safe and correct.
    if (typeof insight.superseded_by === 'number') {
      const mappedRef = idMap.get(insight.superseded_by);
      if (mappedRef !== undefined) {
        updated.superseded_by = mappedRef;
      } else {
        delete updated.superseded_by;
      }
    }

    return updated;
  });

  // Build the v2 store object — omit next_id entirely.
  const v2 = {
    version: '2.0.0',
    last_updated: new Date().toISOString(),
    insights: migrated,
  };

  if (!DRY_RUN) {
    const tmp = filePath + '.tmp';
    writeFileSync(tmp, JSON.stringify(v2, null, 2) + '\n', 'utf8');
    renameSync(tmp, filePath);
  }

  return {
    filePath,
    action: DRY_RUN ? 'dry-run' : 'migrated',
    count: migrated.length,
    mappings: idMap,
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const storePaths = resolveStorePaths();

  if (storePaths.length === 0) {
    console.error(
      '[migrate] Error: no store paths found.\n' +
      '  Options:\n' +
      '    --store <path>     Specify one or more store root paths.\n' +
      '    ~/.ai-insights/stores.json  Configure multi-store paths.\n' +
      '    LEDGER_ROOT=<path> Set an env var for single-store mode.'
    );
    process.exit(1);
  }

  if (DRY_RUN) {
    console.log('[migrate] Dry-run mode — no files will be written.\n');
  }

  let totalFiles = 0;
  let totalMigrated = 0;
  let totalSkipped = 0;

  for (const storePath of storePaths) {
    const files = collectKnowledgeFiles(storePath);

    if (files.length === 0) {
      console.log(`[migrate] ${storePath}/.knowledge/ — no insight files found.`);
      continue;
    }

    console.log(`[migrate] Store: ${storePath} (${files.length} file(s))`);

    for (const filePath of files) {
      const result = migrateFile(filePath);
      totalFiles++;

      if (result.action === 'skipped') {
        totalSkipped++;
        console.log(`  [skip]    ${filePath} — already at v2.0.0`);
        continue;
      }

      totalMigrated++;
      const label = result.action === 'dry-run' ? '[dry-run]' : '[migrated]';
      console.log(`  ${label} ${filePath} — ${result.count} insight(s)`);

      if (VERBOSE && result.mappings.size > 0) {
        for (const [oldId, newUuid] of result.mappings) {
          console.log(`            id ${oldId} → ${newUuid}`);
        }
      }
    }
  }

  console.log(
    `\n[migrate] Done. ${totalFiles} file(s) processed: ` +
    `${totalMigrated} ${DRY_RUN ? 'would be migrated' : 'migrated'}, ` +
    `${totalSkipped} skipped (already v2.0.0).`
  );
}

main();
