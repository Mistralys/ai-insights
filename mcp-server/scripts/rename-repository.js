#!/usr/bin/env node

/**
 * Rename Repository Script
 *
 * Moves all project folders from one repository namespace to another and
 * updates each project's `.meta.json` to reflect the new repository name.
 *
 * Usage:
 *   node scripts/rename-repository.js --from <old-repo> --to <new-repo> [--ledger-dir <path>] [--dry-run]
 *
 * Arguments:
 *   --from        Required. The current repository name (e.g. ai-insights-dev).
 *   --to          Required. The new repository name (e.g. ai-insights).
 *   --ledger-dir  Optional. Absolute path to the ledger root. Defaults to
 *                 {mcp-server}/storage/ledger/.
 *   --dry-run     Optional. Print what would happen without making any changes.
 *
 * Exit codes:
 *   0  Success (or dry-run completed)
 *   1  Usage / validation error
 *   2  File-system or I/O error
 */

import { readFile, writeFile, rename, mkdir, copyFile, rm, access, readdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomBytes } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Segments that are safe as directory names: alphanum (upper or lower) + hyphens. */
const SAFE_SEGMENT_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9-]*$/;

function isSafeSegment(s) {
  return typeof s === 'string' && SAFE_SEGMENT_REGEX.test(s);
}

async function dirExists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Atomic JSON write: write to a sibling temp file, then rename onto target.
 * Mirrors the atomicWriteJson() contract from src/storage/atomic-writer.ts.
 */
async function atomicWriteJson(targetPath, data) {
  const suffix = randomBytes(4).toString('hex');
  const tmpPath = `${targetPath}.tmp.${process.pid}.${suffix}`;
  const content = JSON.stringify(data, null, 2) + '\n';
  await writeFile(tmpPath, content, 'utf-8');
  await rename(tmpPath, targetPath);
}

async function copyDirRecursive(src, dest) {
  await mkdir(dest, { recursive: true });
  const entries = await readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDirRecursive(srcPath, destPath);
    } else {
      await copyFile(srcPath, destPath);
    }
  }
}

async function verifyDirCopied(src, dest) {
  const entries = await readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    try {
      await access(join(dest, entry.name));
    } catch {
      throw new Error(
        `Cross-device copy verification failed: "${entry.name}" missing in destination "${dest}"`
      );
    }
  }
}

async function moveDirCrossDevice(src, dest) {
  try {
    await rename(src, dest);
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
    // Cross-device fallback: copy → verify → delete source.
    await copyDirRecursive(src, dest);
    await verifyDirCopied(src, dest);
    await rm(src, { recursive: true });
  }
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = argv.slice(2);
  const result = { from: null, to: null, ledgerDir: null, dryRun: false };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--from' && i + 1 < args.length) {
      result.from = args[++i];
    } else if (args[i] === '--to' && i + 1 < args.length) {
      result.to = args[++i];
    } else if (args[i] === '--ledger-dir' && i + 1 < args.length) {
      result.ledgerDir = args[++i];
    } else if (args[i] === '--dry-run') {
      result.dryRun = true;
    } else if (args[i] === '--help' || args[i] === '-h') {
      printUsage();
      process.exit(0);
    }
  }

  return result;
}

function printUsage() {
  console.log(`
Usage:
  node scripts/rename-repository.js --from <old-repo> --to <new-repo> [--ledger-dir <path>] [--dry-run]

Arguments:
  --from        Required. The current repository name (e.g. ai-insights-dev).
  --to          Required. The new repository name (e.g. ai-insights).
  --ledger-dir  Optional. Absolute path to the ledger root.
                Defaults to {mcp-server}/storage/ledger/
  --dry-run     Optional. Print what would be done without making any changes.

Example:
  node scripts/rename-repository.js \\
    --from ai-insights-dev \\
    --to ai-insights
`);
}

function resolveLedgerRoot(ledgerDirArg) {
  if (ledgerDirArg) return ledgerDirArg;
  // mcp-server root is one level up from scripts/
  const serverDir = join(__dirname, '..');
  return join(serverDir, 'storage', 'ledger');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { from, to, ledgerDir, dryRun } = parseArgs(process.argv);

  // --- Validate inputs -------------------------------------------------------

  if (!from || !to) {
    console.error('Error: --from and --to are both required.');
    printUsage();
    process.exit(1);
  }

  if (!isSafeSegment(from)) {
    console.error(
      `Error: Invalid --from value "${from}". Must be alphanumeric with hyphens (e.g. ai-insights-STABLE).`
    );
    process.exit(1);
  }

  if (!isSafeSegment(to)) {
    console.error(
      `Error: Invalid --to value "${to}". Must be alphanumeric with hyphens (e.g. ai-insights).`
    );
    process.exit(1);
  }

  if (from === to) {
    console.error('Error: --from and --to must be different repository names.');
    process.exit(1);
  }

  const ledgerRoot = resolveLedgerRoot(ledgerDir);
  const srcNamespaceDir = join(ledgerRoot, from);
  const destNamespaceDir = join(ledgerRoot, to);

  if (dryRun) {
    console.log('[DRY RUN] No changes will be made.\n');
  }

  console.log(`Ledger root : ${ledgerRoot}`);
  console.log(`From        : ${from}`);
  console.log(`To          : ${to}`);
  console.log('');

  // --- Validate source namespace exists --------------------------------------

  if (!(await dirExists(srcNamespaceDir))) {
    console.error(`Error: Source namespace directory does not exist: ${srcNamespaceDir}`);
    process.exit(1);
  }

  // --- Enumerate project folders in the source namespace --------------------

  let entries;
  try {
    entries = await readdir(srcNamespaceDir, { withFileTypes: true });
  } catch (err) {
    console.error(`Error: Could not read source namespace directory: ${err.message}`);
    process.exit(2);
  }

  const projectDirs = entries.filter((e) => e.isDirectory());

  if (projectDirs.length === 0) {
    console.log(`No project folders found under "${from}". Nothing to do.`);
    process.exit(0);
  }

  console.log(`Found ${projectDirs.length} project(s) to move:\n`);

  // --- Guard: check for collisions in destination namespace -----------------

  const collisions = [];
  for (const entry of projectDirs) {
    const destDir = join(destNamespaceDir, entry.name);
    if (await dirExists(destDir)) {
      collisions.push(entry.name);
    }
  }

  if (collisions.length > 0) {
    console.error(
      `Error: The following project(s) already exist in the "${to}" namespace and would be overwritten:`
    );
    for (const slug of collisions) {
      console.error(`  ${slug}`);
    }
    console.error('\nAborting to avoid overwriting existing data.');
    process.exit(1);
  }

  // --- Dry-run: just print what would happen --------------------------------

  if (dryRun) {
    for (const entry of projectDirs) {
      console.log(`  ${from}/${entry.name}  →  ${to}/${entry.name}`);
    }
    console.log('');
    console.log(`Dry run complete. ${projectDirs.length} project(s) would be moved.`);
    console.log('Run without --dry-run to apply changes.');
    process.exit(0);
  }

  // --- Create destination namespace directory if needed ---------------------

  try {
    await mkdir(destNamespaceDir, { recursive: true });
  } catch (err) {
    console.error(`Error: Could not create destination namespace directory: ${err.message}`);
    process.exit(2);
  }

  // --- Move each project folder ---------------------------------------------

  let successCount = 0;
  let failureCount = 0;

  for (const entry of projectDirs) {
    const slug = entry.name;
    const srcDir = join(srcNamespaceDir, slug);
    const destDir = join(destNamespaceDir, slug);
    const metaPath = join(srcDir, '.meta.json');

    process.stdout.write(`  ${slug} ... `);

    // Read and update .meta.json
    let meta;
    let previousRepo;
    try {
      const raw = await readFile(metaPath, 'utf-8');
      meta = JSON.parse(raw);
      previousRepo = meta.repository_name ?? '(none)';
      meta.repository_name = to;
      await atomicWriteJson(metaPath, meta);
    } catch (err) {
      console.error(`FAILED (meta update: ${err.message})`);
      failureCount++;
      continue;
    }

    // Move the directory
    try {
      await moveDirCrossDevice(srcDir, destDir);
      console.log(`✓  (was: "${previousRepo}")`);
      successCount++;
    } catch (err) {
      // Best-effort rollback of .meta.json
      try {
        meta.repository_name = previousRepo === '(none)' ? null : previousRepo;
        // Write to wherever the meta file currently lives (src still present if move failed)
        const restorePath = (await dirExists(destDir))
          ? join(destDir, '.meta.json')
          : metaPath;
        await atomicWriteJson(restorePath, meta);
      } catch {
        // Best-effort rollback; don't mask the original error.
      }
      console.error(`FAILED (move: ${err.message})`);
      failureCount++;
    }
  }

  console.log('');
  console.log(
    `Moved ${successCount} of ${projectDirs.length} project(s).` +
      (failureCount > 0 ? ` ${failureCount} failed (see errors above).` : '')
  );

  // --- Clean up source namespace dir if it is now empty --------------------

  try {
    const remaining = await readdir(srcNamespaceDir);
    if (remaining.length === 0) {
      await rm(srcNamespaceDir, { recursive: true });
      console.log(`✓ Removed now-empty "${from}" namespace directory`);
    } else {
      console.log(`Note: "${from}" namespace directory still contains ${remaining.length} item(s) — not removed.`);
    }
  } catch {
    // Non-fatal.
  }

  if (successCount > 0) {
    console.log('');
    console.log('Done. Restart the MCP server STDIO process to pick up the new layout.');
  }

  process.exit(failureCount > 0 ? 2 : 0);
}

main().catch((err) => {
  console.error(`Unexpected error: ${err.message}`);
  process.exit(2);
});
