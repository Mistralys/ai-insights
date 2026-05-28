#!/usr/bin/env node

/**
 * Move Unknown Project Script
 *
 * Relocates a project that was filed under the `unknown` repo-namespace to
 * the correct namespace, and updates its `.meta.json` to reflect the real
 * repository name.
 *
 * Usage:
 *   node scripts/move-unknown-project.js --slug <slug> --repo <repo-name> [--ledger-dir <path>]
 *
 * Arguments:
 *   --slug        Required. The project slug (e.g. 2026-05-01-my-plan).
 *   --repo        Required. The target repository name (e.g. ai-insights).
 *   --ledger-dir  Optional. Absolute path to the ledger root. Defaults to
 *                 {mcp-server}/storage/ledger/.
 *
 * Exit codes:
 *   0  Success
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

/** Segments that are safe as directory names: lowercase alphanum + hyphens. */
const SAFE_SLUG_REGEX = /^[a-z0-9][a-z0-9-]*$/;

function isSafeSegment(s) {
  return typeof s === 'string' && SAFE_SLUG_REGEX.test(s);
}

/** Slugs must also look like {YYYY-MM-DD}-{name}. */
const PLAN_FOLDER_REGEX = /^\d{4}-\d{2}-\d{2}-.+$/;

function isSlug(s) {
  return typeof s === 'string' && PLAN_FOLDER_REGEX.test(s);
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
  const result = { slug: null, repo: null, ledgerDir: null };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--slug' && i + 1 < args.length) {
      result.slug = args[++i];
    } else if (args[i] === '--repo' && i + 1 < args.length) {
      result.repo = args[++i];
    } else if (args[i] === '--ledger-dir' && i + 1 < args.length) {
      result.ledgerDir = args[++i];
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
  node scripts/move-unknown-project.js --slug <slug> --repo <repo-name> [--ledger-dir <path>]

Arguments:
  --slug        Required. The project slug (e.g. 2026-05-01-my-plan).
  --repo        Required. The target repository name (e.g. ai-insights).
  --ledger-dir  Optional. Absolute path to the ledger root.
                Defaults to {mcp-server}/storage/ledger/

Example:
  node scripts/move-unknown-project.js \\
    --slug 2026-05-01-my-plan \\
    --repo ai-insights
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
  const { slug, repo, ledgerDir } = parseArgs(process.argv);

  // --- Validate inputs -------------------------------------------------------

  if (!slug || !repo) {
    console.error('Error: --slug and --repo are both required.');
    printUsage();
    process.exit(1);
  }

  if (!isSlug(slug)) {
    console.error(
      `Error: Invalid slug "${slug}". Expected format: YYYY-MM-DD-{name} (e.g. 2026-05-01-my-plan).`
    );
    process.exit(1);
  }

  if (!isSafeSegment(repo)) {
    console.error(
      `Error: Invalid repo name "${repo}". Must be lowercase alphanumeric with hyphens (e.g. ai-insights).`
    );
    process.exit(1);
  }

  const ledgerRoot = resolveLedgerRoot(ledgerDir);
  const srcDir = join(ledgerRoot, 'unknown', slug);
  const destNamespaceDir = join(ledgerRoot, repo);
  const destDir = join(destNamespaceDir, slug);
  const metaPath = join(srcDir, '.meta.json');

  console.log(`Ledger root : ${ledgerRoot}`);
  console.log(`Source      : unknown/${slug}`);
  console.log(`Destination : ${repo}/${slug}`);
  console.log('');

  // --- Validate source exists ------------------------------------------------

  if (!(await dirExists(srcDir))) {
    console.error(`Error: Source directory does not exist: ${srcDir}`);
    console.error('       Make sure the slug is correct and the project is under the "unknown" namespace.');
    process.exit(1);
  }

  // --- Guard against overwriting an existing destination ---------------------

  if (await dirExists(destDir)) {
    console.error(`Error: Destination already exists: ${destDir}`);
    console.error('       Aborting to avoid overwriting existing data.');
    process.exit(1);
  }

  // --- Read and update .meta.json --------------------------------------------

  let meta;
  try {
    const raw = await readFile(metaPath, 'utf-8');
    meta = JSON.parse(raw);
  } catch (err) {
    console.error(`Error: Could not read .meta.json from ${metaPath}: ${err.message}`);
    process.exit(2);
  }

  const previousRepo = meta.repository_name ?? '(none)';
  meta.repository_name = repo;

  try {
    await atomicWriteJson(metaPath, meta);
    console.log(`✓ Updated .meta.json: repository_name "${previousRepo}" → "${repo}"`);
  } catch (err) {
    console.error(`Error: Could not write .meta.json: ${err.message}`);
    process.exit(2);
  }

  // --- Move the directory ----------------------------------------------------

  try {
    await mkdir(destNamespaceDir, { recursive: true });
    await moveDirCrossDevice(srcDir, destDir);
    console.log(`✓ Moved ${srcDir}`);
    console.log(`       → ${destDir}`);
  } catch (err) {
    // Attempt to restore the original repository_name in .meta.json so the
    // project remains consistent in its original location.
    try {
      meta.repository_name = previousRepo === '(none)' ? null : previousRepo;
      // Write directly to the (still-in-place) source meta path if dest doesn't exist yet,
      // or to the dest meta path if the move partially succeeded.
      const restorePath = (await dirExists(destDir)) ? join(destDir, '.meta.json') : metaPath;
      await atomicWriteJson(restorePath, meta);
      console.error(`  (Reverted repository_name in .meta.json to "${previousRepo}")`);
    } catch {
      // Best-effort rollback; don't mask the original error.
    }
    console.error(`Error: Failed to move directory: ${err.message}`);
    process.exit(2);
  }

  // --- Clean up empty unknown/ dir if it is now empty -----------------------

  try {
    const remaining = await readdir(join(ledgerRoot, 'unknown'));
    if (remaining.length === 0) {
      await rm(join(ledgerRoot, 'unknown'), { recursive: true });
      console.log('✓ Removed now-empty "unknown" namespace directory');
    }
  } catch {
    // Non-fatal: the unknown/ dir may not be empty or may already be gone.
  }

  console.log('');
  console.log('Done. Restart the MCP server STDIO process to pick up the new layout.');
}

main().catch((err) => {
  console.error(`Unexpected error: ${err.message}`);
  process.exit(2);
});
