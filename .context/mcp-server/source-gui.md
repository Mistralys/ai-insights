# MCP Server - Source (GUI)
<INSTRUCTION>
# MCP Server - Source: GUI Layer
TypeScript source for the GUI integration layer: run queue management, run-log event handlers, server configuration, and GUI-specific error types.

</INSTRUCTION>
------------------------------------------------------------
_SOURCE: GUI layer: queue management, run-log handlers, config, error types_
# GUI layer: queue management, run-log handlers, config, error types
```
// Structure of documents
└── mcp-server/
    └── src/
        └── gui/
            └── auto-archive.ts
            └── config.ts
            └── errors.ts
            └── handlers/
                ├── run-log-handlers.ts
            └── log-resolver.ts
            └── queue/
                └── compute-effective-status.ts
                └── format-progress-entry.ts
                └── get-queue.ts
                └── resolve-progress.ts
                └── types.ts
                └── validate-entry.ts

```
###  Path: `/mcp-server/src/gui/auto-archive.ts`

```ts
/**
 * Auto-Archive Service
 *
 * Scans for stale COMPLETE projects and archives them automatically.
 * Designed to be called on GUI server startup and on a periodic interval.
 *
 * STDIO discipline: all output goes to stderr only — this module is safe for
 * use in MCP server contexts where stdout is the protocol channel.
 */

import { LedgerStore } from '../storage/ledger-store.js';
import { withLock } from '../storage/file-lock.js';
import { getConfig } from './config.js';

// ---------------------------------------------------------------------------
// Module-level timer state
// ---------------------------------------------------------------------------

let _intervalHandle: ReturnType<typeof setInterval> | null = null;

// ---------------------------------------------------------------------------
// Core scan function
// ---------------------------------------------------------------------------

/**
 * Scans all projects and archives eligible COMPLETE ones.
 *
 * Eligibility: `status === 'COMPLETE'` AND `last_updated` is older than
 * `maxAgeDays` days.
 *
 * @param ledgerRoot  Absolute path to the ledger root directory.
 * @param maxAgeDays  Age threshold in days. Pass `0` to disable (no-op).
 * @returns           Array of slugs that were archived in this run.
 */
export async function runAutoArchive(
  ledgerRoot: string,
  maxAgeDays: number
): Promise<string[]> {
  if (maxAgeDays === 0) {
    return [];
  }

  const projects = await LedgerStore.listAllProjects(ledgerRoot);
  const archived: string[] = [];
  const now = Date.now();
  const thresholdMs = maxAgeDays * 24 * 60 * 60 * 1000;

  for (const meta of projects) {
    if (meta.status !== 'COMPLETE') {
      continue;
    }

    let lastUpdatedMs: number;
    try {
      lastUpdatedMs = new Date(meta.last_updated).getTime();
      if (isNaN(lastUpdatedMs)) {
        process.stderr.write(
          `[auto-archive] Skipping '${meta.slug}': unparseable last_updated '${meta.last_updated}'\n`
        );
        continue;
      }
    } catch {
      process.stderr.write(`[auto-archive] Skipping '${meta.slug}': failed to parse last_updated\n`);
      continue;
    }

    const ageMs = now - lastUpdatedMs;
    if (ageMs < thresholdMs) {
      continue;
    }

    const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));

    try {
      const store = new LedgerStore(meta.plan_path, ledgerRoot);
      await withLock(store.storageDir, async () => {
        const rootIndex = await store.readRootIndex();
        // Auto-archiving is administrative — preserve last_updated so the
        // project's visible activity time is not distorted.
        await store.writeRootIndex({ ...rootIndex, status: 'ARCHIVED' }, { preserveLastUpdated: true });
      });
      archived.push(meta.slug);
      process.stderr.write(
        `[auto-archive] Archived project: ${meta.slug} (inactive for ${ageDays} days)\n`
      );
    } catch (err) {
      process.stderr.write(
        `[auto-archive] Failed to archive '${meta.slug}': ${String(err)}\n`
      );
    }
  }

  return archived;
}

// ---------------------------------------------------------------------------
// Timer management
// ---------------------------------------------------------------------------

/**
 * Starts the auto-archive background timer.
 *
 * Reads `auto_archive_days` from the current GUI config. If the value is
 * greater than 0, runs `runAutoArchive` immediately and then every
 * `intervalMs` milliseconds (default: 10 minutes).
 *
 * Calling this function when a timer is already running is a no-op (the
 * existing timer is preserved). Call `stopAutoArchiveTimer()` first if you
 * need to restart with new settings.
 *
 * @param ledgerRoot  Absolute path to the ledger root directory.
 * @param intervalMs  Polling interval in milliseconds. Default: 600 000 (10 min).
 */
export function startAutoArchiveTimer(ledgerRoot: string, intervalMs = 600_000): void {
  if (_intervalHandle !== null) {
    return; // Already running
  }

  const tick = (): void => {
    const config = getConfig();
    const maxAgeDays = config.auto_archive_days;
    if (maxAgeDays === 0) {
      return; // Disabled at runtime
    }
    runAutoArchive(ledgerRoot, maxAgeDays).catch((err) => {
      process.stderr.write(`[auto-archive] Unexpected error during scan: ${String(err)}\n`);
    });
  };

  // Run once immediately on startup, then schedule the interval.
  tick();
  _intervalHandle = setInterval(tick, intervalMs);
}

/**
 * Clears the auto-archive interval timer.
 *
 * Safe to call when no timer is active.
 */
export function stopAutoArchiveTimer(): void {
  if (_intervalHandle !== null) {
    clearInterval(_intervalHandle);
    _intervalHandle = null;
  }
}

/**
 * For testing only: resets the internal timer state without clearing a
 * running interval. Call `stopAutoArchiveTimer()` first in test teardown if a
 * timer was started.
 *
 * @internal
 */
export function _resetTimerForTesting(): void {
  _intervalHandle = null;
}

```
###  Path: `/mcp-server/src/gui/config.ts`

```ts
/**
 * GUI Configuration Module
 *
 * Manages runtime configuration for the MCP server and GUI dashboard.
 * Uses a module-level singleton cache populated at startup via readConfigFromDisk().
 * The cache is kept fresh via an fs.watch() file watcher with a 250ms debounce.
 *
 * STDIO discipline: this module only writes to stderr, never stdout.
 */

import { readFile } from 'fs/promises';
import { watch } from 'fs';
import type { FSWatcher } from 'fs';
import { z } from 'zod';
import { atomicWriteJson } from '../storage/atomic-writer.js';

// ---------------------------------------------------------------------------
// Schema & Types
// ---------------------------------------------------------------------------

export const GuiConfigSchema = z.object({
  auto_handoff_enabled: z.boolean().default(true),
  max_handoff_depth: z.number().int().min(1).default(100),
  auto_archive_days: z.number().int().min(0).default(6),
  capture_dialogues: z.boolean().default(true),
  ledger_root: z.string().default(''),
});

export type GuiConfig = z.infer<typeof GuiConfigSchema>;

/**
 * Partial update schema for incoming config PUT bodies.
 * ledger_root is intentionally omitted — it is a server-only concern and
 * read-only from the GUI's perspective.
 * Derived from GuiConfigSchema to guarantee it always tracks additions to the full schema.
 */
export const GuiConfigPartialSchema = GuiConfigSchema.omit({ ledger_root: true }).partial();
export type GuiConfigPartial = z.infer<typeof GuiConfigPartialSchema>;

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_CONFIG: GuiConfig = {
  auto_handoff_enabled: true,
  max_handoff_depth: 100,
  auto_archive_days: 6,
  capture_dialogues: true,
  ledger_root: '',
};

// ---------------------------------------------------------------------------
// Module-level singleton cache
// ---------------------------------------------------------------------------

let _cache: GuiConfig = { ...DEFAULT_CONFIG };
let _watcher: FSWatcher | null = null;
let _debounceTimer: ReturnType<typeof setTimeout> | null = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns the current in-memory cached config synchronously.
 * Never reads disk. Must be cheap to call.
 */
export function getConfig(): GuiConfig {
  return _cache;
}

/**
 * Reads and parses gui-config.json from disk.
 *
 * - If the file is missing, writes DEFAULT_CONFIG to disk (self-healing) and
 *   returns DEFAULT_CONFIG.
 * - If the file is present but invalid, logs a warning to stderr and returns
 *   DEFAULT_CONFIG without updating disk.
 * - On success, updates the in-memory cache and returns the parsed config.
 */
export async function readConfigFromDisk(configPath: string): Promise<GuiConfig> {
  let raw: string;
  try {
    raw = await readFile(configPath, 'utf-8');
  } catch (err: unknown) {
    if (isNodeError(err) && err.code === 'ENOENT') {
      // File doesn't exist — write defaults and return them
      process.stderr.write(
        `[config] gui-config.json not found at ${configPath}, creating with defaults\n`
      );
      await atomicWriteJson(configPath, DEFAULT_CONFIG);
      _cache = { ...DEFAULT_CONFIG };
      return _cache;
    }
    // Unexpected read error
    process.stderr.write(`[config] Failed to read ${configPath}: ${String(err)}\n`);
    _cache = { ...DEFAULT_CONFIG };
    return _cache;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    process.stderr.write(
      `[config] Failed to parse ${configPath} as JSON: ${String(err)}\n`
    );
    _cache = { ...DEFAULT_CONFIG };
    return _cache;
  }

  const result = GuiConfigSchema.safeParse(parsed);
  if (!result.success) {
    process.stderr.write(
      `[config] Validation failed for ${configPath}: ${result.error.message}\n`
    );
    _cache = { ...DEFAULT_CONFIG };
    return _cache;
  }

  _cache = result.data;
  return _cache;
}

/**
 * Writes a (partial) config to disk atomically.
 *
 * Merges the provided data with the current cache, validates the full merged
 * object with Zod, writes via atomicWriteJson(), updates the in-memory cache,
 * and returns the written config.
 *
 * `ledger_root` is stripped from `data` — it is read-only and can only be set
 * by the server at startup via readConfigFromDisk().
 *
 * Throws ZodError on invalid input.
 */
export async function writeConfig(
  configPath: string,
  data: Partial<GuiConfig>
): Promise<GuiConfig> {
  // Strip ledger_root — it is read-only from the caller's perspective
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { ledger_root: _ignored, ...safeData } = data;
  const merged = { ..._cache, ...safeData };
  const validated = GuiConfigSchema.parse(merged); // throws ZodError on failure
  await atomicWriteJson(configPath, validated);
  _cache = validated;
  return _cache;
}

/**
 * Starts an fs.watch() on configPath with a 250ms debounce.
 *
 * On change: re-reads the file, re-validates, updates the cache.
 * On error or ENOENT: logs to stderr, retains last known good cache.
 *
 * Safe to call multiple times (stops existing watcher first).
 */
export function startConfigWatcher(configPath: string): void {
  // Stop any existing watcher before starting a new one
  stopConfigWatcher();

  try {
    _watcher = watch(configPath, { persistent: false }, (eventType) => {
      // Debounce: clear any pending timer and set a new one
      if (_debounceTimer !== null) {
        clearTimeout(_debounceTimer);
      }
      _debounceTimer = setTimeout(() => {
        _debounceTimer = null;
        // Re-read config from disk, update cache
        readFile(configPath, 'utf-8')
          .then((raw) => {
            let parsed: unknown;
            try {
              parsed = JSON.parse(raw);
            } catch {
              process.stderr.write(
                `[config] File watcher: failed to parse ${configPath} as JSON, retaining cache\n`
              );
              return;
            }
            const result = GuiConfigSchema.safeParse(parsed);
            if (!result.success) {
              process.stderr.write(
                `[config] File watcher: validation failed for ${configPath}, retaining cache\n`
              );
              return;
            }
            _cache = result.data;
            process.stderr.write(
              `[config] File watcher: cache updated from ${configPath}\n`
            );

            // On macOS, fs.watch stops tracking a file after an atomic rename
            // (the inode changes). Re-start the watcher so subsequent writes
            // are picked up. This is a no-op on Linux where watching the path
            // survives rename.
            if (eventType === 'rename') {
              startConfigWatcher(configPath);
            }
          })
          .catch((err: unknown) => {
            if (isNodeError(err) && err.code === 'ENOENT') {
              process.stderr.write(
                `[config] File watcher: ${configPath} deleted, retaining cache\n`
              );
            } else {
              process.stderr.write(
                `[config] File watcher: read error on ${configPath}: ${String(err)}\n`
              );
            }
          });
      }, 250);
    });

    _watcher.on('error', (err) => {
      process.stderr.write(
        `[config] File watcher error on ${configPath}: ${String(err)}\n`
      );
    });
  } catch (err) {
    // fs.watch() can throw synchronously if the path is on an unsupported fs
    process.stderr.write(
      `[config] Could not start file watcher on ${configPath}: ${String(err)}\n`
    );
  }
}

/**
 * Closes the active FSWatcher if one exists.
 * Safe to call multiple times (no-op if not watching).
 */
export function stopConfigWatcher(): void {
  if (_debounceTimer !== null) {
    clearTimeout(_debounceTimer);
    _debounceTimer = null;
  }
  if (_watcher !== null) {
    try {
      _watcher.close();
    } catch {
      // Ignore errors on close — we're shutting down
    }
    _watcher = null;
  }
}

// ---------------------------------------------------------------------------
// Test helpers (never import this in production code)
// ---------------------------------------------------------------------------

/**
 * Resets all module-level singleton state. FOR TESTING ONLY.
 * Closes any active watcher, clears debounce timer, and resets cache to defaults.
 */
export function __resetForTesting(): void {
  stopConfigWatcher();
  _cache = { ...DEFAULT_CONFIG };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}

```
###  Path: `/mcp-server/src/gui/errors.ts`

```ts
/**
 * Shared GUI error types.
 *
 * This module is the single source of truth for `ApiError`. Both `gui/api.ts`
 * and `src/gui/log-resolver.ts` import from here so that `instanceof ApiError`
 * checks in `gui/server.ts` work correctly across all route handlers.
 *
 * Error shape:  { code: string, message: string, details?: unknown }
 *   NOT_FOUND        → 404
 *   FORBIDDEN        → 403
 *   VALIDATION_ERROR → 400
 *   CONFLICT         → 409
 *   (unhandled)      → 500
 *
 * STDIO discipline: this file never writes to process.stdout.
 */

// ---------------------------------------------------------------------------
// ApiError
// ---------------------------------------------------------------------------

/** Structured error thrown by all GUI API handlers and resolvers. */
export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

```
###  Path: `/mcp-server/src/gui/handlers/run-log-handlers.ts`

```ts
/**
 * Run Log API Handlers
 *
 * Pure async handler functions for the orchestrator run log endpoints. Both
 * handlers accept `slug` (project identifier) and `repoName` (repository
 * namespace) as their first two parameters. `repoName` is validated before
 * `slug` (namespace-first fast-fail) via `assertSafeSlug()`, which rejects any
 * segment that does not satisfy the safe-slug rules before any filesystem access
 * is attempted.
 *
 * Intended route shape (server integration finalised in WP-007):
 *
 *   GET /api/projects/:repo/:slug/runs         → handleListRunLogs
 *   GET /api/projects/:repo/:slug/runs/:file   → handleGetRunLog
 *
 * Both handlers re-use the security guards in `log-resolver.ts` and surface
 * `ApiError` codes as-is (the HTTP server maps them to status codes).
 *
 * STDIO discipline: this module only writes to stderr, never stdout.
 */

import {
  ApiError,
  archiveCompletedLogs,
  findRunLogs,
  migrateOrphanedLogs,
  readLogEntries,
  resolveLogSource,
} from '../log-resolver.js';
import type { RunLogEntry } from '../log-resolver.js';
import { assertSafeSegment } from '../../utils/path-validator.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Guards a single path segment against path-traversal attacks and invalid characters.
 *
 * Throws `ApiError NOT_FOUND` for any segment that is empty or does not satisfy
 * the safe-slug rules (lowercase alphanumeric + hyphens, must start with an
 * alphanumeric character). This rejects `/`, `..`, uppercase letters, and any
 * other non-conforming input before any filesystem operations are attempted.
 *
 * Used to validate both `slug` and `repoName` parameters independently — never
 * called with a composite `{repo}/{slug}` string.
 *
 * **Layer note:** A parallel `assertSafeSlug` exists in `src/utils/ledger-root.ts`
 * (storage layer). Both delegate to {@link assertSafeSegment} from `path-validator.ts`
 * but throw different error types: this function throws `ApiError` (GUI layer); the
 * storage layer version throws plain `Error`. The separation is intentional — the GUI
 * layer must not import storage-layer error types.
 *
 * @param segment - The raw segment string (slug or repoName) extracted from the request URL.
 */
function assertSafeSlug(segment: string): void {
  if (!assertSafeSegment(segment)) {
    throw new ApiError('NOT_FOUND', `Invalid path segment: '${segment}'.`);
  }
}

// ---------------------------------------------------------------------------
// Handler: handleListRunLogs
// ---------------------------------------------------------------------------

/**
 * Returns the merged, deduplicated list of run log entries for a project slug.
 *
 * Workflow:
 *   1. Legacy migration: orphaned files from `legacyLogsDir` / `legacyLogsDir2`
 *      are copied into `logsDir` (one-time self-healing, idempotent).
 *   2. Archival: completed runs from `orchestratorLogsDir` that are not yet in
 *      `logsDir` are copied via `archiveCompletedLogs()`.
 *   3. Listing: both `logsDir` and `orchestratorLogsDir` are scanned with
 *      `findRunLogs()`. Results are merged and deduplicated by `filename`, with
 *      `logsDir` taking precedence for is_active status (it may have been
 *      self-healed on a previous request).
 *   4. Active runs from `orchestratorLogsDir` that are not yet in `logsDir`
 *      are included in the response so they appear in the UI immediately.
 *
 * Security: both `repoName` and `slug` are validated via `assertSafeSlug()` —
 * segments containing `/`, `..`, uppercase letters, or other non-conforming characters
 * throw `ApiError NOT_FOUND` before any filesystem access occurs.
 * Each segment is validated independently; no composite `{repo}/{slug}` string is
 * ever passed to the guard.
 *
 * @param slug               - Project slug (URL segment, already URL-decoded).
 * @param repoName           - Repository namespace (URL segment, already URL-decoded).
 *                             Must be a valid safe slug (lowercase alphanumeric + hyphens).
 * @param logsDir            - Absolute path to the ledger's log storage directory
 *                             (`{ledgerRoot}/{repoName}/{slug}/orchestrator/logs/`).
 * @param orchestratorLogsDir - Absolute path to the orchestrator's live logs
 *                             directory. Completed runs are archived from here
 *                             into `logsDir`; active runs are merged into the
 *                             response even if not yet archived.
 * @param legacyLogsDir      - Optional first legacy migration source directory
 *                             (the old flat `{ledgerRoot}/{slug}/` location).
 * @param legacyLogsDir2     - Optional second legacy migration source directory
 *                             (e.g. a raw `orchestrator/logs/` path from an older
 *                             build whose post-run copy step was never executed).
 * @returns Merged array of `RunLogEntry` objects, deduplicated by filename.
 */
export async function handleListRunLogs(
  slug: string,
  repoName: string,
  logsDir: string,
  orchestratorLogsDir: string,
  legacyLogsDir?: string,
  legacyLogsDir2?: string,
): Promise<RunLogEntry[]> {
  assertSafeSlug(repoName);
  assertSafeSlug(slug);

  // 1. Legacy migration (idempotent — no-op once logsDir has any slug files).
  if (legacyLogsDir) {
    await migrateOrphanedLogs(logsDir, legacyLogsDir, slug);
  }
  if (legacyLogsDir2) {
    await migrateOrphanedLogs(logsDir, legacyLogsDir2, slug);
  }

  // 2. Archive completed runs from the live orchestrator directory.
  await archiveCompletedLogs(logsDir, orchestratorLogsDir, slug);

  // 3. Scan both directories and merge results.
  const [archiveEntries, liveEntries] = await Promise.all([
    findRunLogs(logsDir, slug),
    findRunLogs(orchestratorLogsDir, slug),
  ]);

  // Build a map from filename → entry, starting with live entries so that
  // archived entries (which may have been self-healed) overwrite them.
  const byFilename = new Map<string, RunLogEntry>();
  for (const entry of liveEntries) {
    byFilename.set(entry.filename, entry);
  }
  for (const entry of archiveEntries) {
    // logsDir entries take precedence: they may have healed stale active flags.
    byFilename.set(entry.filename, entry);
  }

  // Return sorted newest-first (filenames are timestamp-prefixed).
  const merged = Array.from(byFilename.values());
  merged.sort((a, b) => b.filename.localeCompare(a.filename));
  return merged;
}

// ---------------------------------------------------------------------------
// Handler: handleGetRunLog
// ---------------------------------------------------------------------------

/**
 * Reads and returns JSONL entries from a single run log file.
 *
 * `resolveLogSource()` is called first to determine whether the canonical copy
 * resides in `logsDir` (ledger storage) or `orchestratorLogsDir` (live logs).
 * If the source is newer than the archive copy, `resolveLogSource()` refreshes
 * the archive before returning the directory to use.
 *
 * Security: both `repoName` and `slug` are validated via `assertSafeSlug()` and
 * `filename` is validated inside `readLogEntries()` (allowlist + resolved-path
 * escape check). These guards apply regardless of which source directory is
 * ultimately used. Malicious filenames throw `ApiError FORBIDDEN`; missing files
 * throw `ApiError NOT_FOUND`.
 *
 * @param slug               - Project slug (validated but not used in file resolution —
 *                             the filename carries all path information).
 * @param repoName           - Repository namespace (URL segment, already URL-decoded).
 *                             Must be a valid safe slug (lowercase alphanumeric + hyphens).
 * @param filename           - Bare filename (no directory component) to read.
 * @param logsDir            - Absolute path to the ledger's log storage directory.
 * @param orchestratorLogsDir - Absolute path to the orchestrator's live logs directory.
 * @param afterLine          - Optional zero-based line offset for incremental polling.
 * @returns `{ entries, totalLines }` as returned by `readLogEntries`.
 */
export async function handleGetRunLog(
  slug: string,
  repoName: string,
  filename: string,
  logsDir: string,
  orchestratorLogsDir: string,
  afterLine?: number
): Promise<{ entries: unknown[]; totalLines: number }> {
  assertSafeSlug(repoName);
  assertSafeSlug(slug);
  const resolvedDir = await resolveLogSource(logsDir, orchestratorLogsDir, filename);
  return readLogEntries(resolvedDir, filename, afterLine);
}

```
###  Path: `/mcp-server/src/gui/log-resolver.ts`

```ts
/**
 * Orchestrator Run Log Resolver
 *
 * Backend utility for locating and reading orchestrator run log files.
 * Log files are JSONL format (one JSON object per line) and follow the naming
 * convention: `<timestamp>-{slug}.jsonl`.
 *
 * Security: all file access is strictly confined to `logsDir` via:
 *   1. A filename allowlist regexp (no `..`, no `/`, alphanumerics + `-_.` only)
 *   2. A resolved-path escape check (path.resolve must stay within logsDir)
 *
 * STDIO discipline: this module only writes to stderr, never stdout.
 *
 * ## Known Limitations
 *
 * - `resolveOrchestratorLogsDir` and `findRunLogs` do **not** validate that the
 *   supplied path is absolute. If a relative path flows in from `gui-config.json`,
 *   `readdir()` will resolve it against the process CWD, which could list files
 *   outside the intended directory. `readLogEntries` is immune (its escape-check
 *   uses `path.resolve()`), but `findRunLogs` is not. A `path.isAbsolute()` guard
 *   should be added before this module is wired into any HTTP-facing API layer.
 *
 * ## ApiError
 *
 * This module imports `ApiError` from the shared `src/gui/errors.ts` module.
 * The shared module exists to avoid the circular-dependency that would arise
 * from importing `gui/api.ts` here (since `gui/api.ts` imports this file).
 */

import { readdir, readFile, appendFile, copyFile, mkdir, stat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { ApiError } from './errors.js';
export { ApiError };

/**
 * Allowlist for log filenames.
 * Permits alphanumerics, hyphens, underscores, and dots only.
 * Explicitly rejects `..`, `/`, backslash, and any other special characters.
 */
const SAFE_FILENAME_REGEX = /^[A-Za-z0-9._-]+$/;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * A single entry in the run log list for a project.
 * `is_active` is `true` when the run has not yet emitted a terminal action
 * (`run_end` or `run_error`), indicating the orchestrator may still be running.
 * `is_dry_run` is `true` when the first JSONL line is a `run_start` event
 * with `dry_run: true`, indicating this was a dry run.
 */
export interface RunLogEntry {
  filename: string;
  is_active: boolean;
  /**
   * `true` when the first JSONL line is a `run_start` event with `dry_run: true`.
   * Defaults to `false` on any file-read or parse error (fail-safe: unreadable
   * or malformed runs are never surfaced with a dry-run badge).
   */
  is_dry_run: boolean;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Lists `.jsonl` files in `logsDir` whose names end with `-{slug}.jsonl`.
 *
 * Returns `RunLogEntry` objects — one per matching file. Each entry includes
 * the bare `filename` and an `is_active` flag that is `true` when the log has
 * no terminal action (`run_end` / `run_error`) as its last line, meaning the
 * orchestrator run may still be in progress.
 *
 * Self-healing: runs that appear active but are not the newest file (sorted
 * by filename prefix) are considered stale. A synthetic `run_error` entry is
 * appended to each stale file so they are permanently closed on disk.
 *
 * Files that do not match the slug suffix are silently excluded. If `logsDir`
 * does not exist or cannot be read, returns an empty array.
 *
 * @param logsDir - Absolute path to the directory containing log files.
 * @param slug    - The project slug to filter by (e.g. `my-project`).
 */
export async function findRunLogs(logsDir: string, slug: string): Promise<RunLogEntry[]> {
  let dirEntries: string[];
  try {
    dirEntries = await readdir(logsDir);
  } catch {
    // Directory doesn't exist or is unreadable — treat as empty
    return [];
  }

  const suffix = `-${slug}.jsonl`;
  // Backward-compat: the orchestrator used to truncate slugs to 40 chars in log
  // filenames (via _slugify(label, max_len=40)). Match the truncated form too so
  // that logs written by older builds (or slugs longer than 40 chars) are found.
  const truncSlug = slug.length > 40 ? slug.slice(0, 40).replace(/-+$/, '') : null;
  const truncSuffix = truncSlug ? `-${truncSlug}.jsonl` : null;

  const matching = dirEntries.filter((name) => {
    if (name.endsWith(suffix) && name.length > suffix.length) return true;
    if (truncSuffix && name.endsWith(truncSuffix) && name.length > truncSuffix.length) return true;
    return false;
  });

  // Build entries with active + dry-run status, then sort newest-first by filename prefix.
  // readLogStatus reads the file once and returns both flags — avoids reading each file twice.
  const unsorted = await Promise.all(
    matching.map(async (filename) => {
      const filePath = join(logsDir, filename);
      const { is_active, is_dry_run } = await readLogStatus(filePath);
      return { filename, is_active, is_dry_run };
    })
  );
  unsorted.sort((a, b) => b.filename.localeCompare(a.filename));

  // Self-heal: every run except the newest one that still looks active is stale
  // (it was interrupted / killed without writing run_end). Append a synthetic
  // closing entry so the file is permanently marked as terminated on disk.
  await Promise.all(
    unsorted.slice(1).map(async (entry, i) => {
      if (!entry.is_active) return;
      await healStaleRun(join(logsDir, entry.filename));
      unsorted[i + 1]!.is_active = false;
    })
  );

  return unsorted;
}

/**
 * Copies orphaned run log files from a legacy directory into the canonical
 * orchestrator logs subfolder inside the project's ledger storage directory.
 *
 * This is a self-healing migration covering two scenarios:
 *   1. Logs written to the old flat `{ledgerRoot}/{slug}/` location (before the
 *      `orchestrator/logs/` subdirectory was introduced in the GUI).
 *   2. Logs still in `orchestrator/logs/` that were never copied by the
 *      post-run archival step (e.g. interrupted runs on an older build).
 *
 * After this function runs, all logs for the slug will reside in `destDir`
 * (`{ledgerRoot}/{slug}/orchestrator/logs/`). Source files are preserved —
 * `copyFile()` is used instead of `rename()` to avoid destroying files that
 * may still be open by the orchestrator.
 *
 * No-op conditions (returns 0 without touching the filesystem):
 *   - `destDir` already contains at least one `*-{slug}.jsonl` file.
 *   - `srcDir` does not exist or contains no matching files.
 *
 * Migration is best-effort: individual copy failures are swallowed so a
 * single unreadable file never blocks the others.
 *
 * @param destDir - Target directory (`{ledgerRoot}/{slug}/orchestrator/logs/`).
 * @param srcDir  - Source directory to scan for orphaned files. Callers invoke
 *                  this function twice in sequence: first with the old flat slug
 *                  directory (`{ledgerRoot}/{slug}/`), then with the raw
 *                  orchestrator logs directory (`orchestrator/logs/`).
 * @param slug    - Project slug used to match filenames (`*-{slug}.jsonl`).
 * @returns Number of files successfully copied.
 */
export async function migrateOrphanedLogs(
  destDir: string,
  srcDir: string,
  slug: string,
): Promise<number> {
  const suffix = `-${slug}.jsonl`;

  // Skip migration if destDir already has logs for this slug.
  try {
    const existing = await readdir(destDir);
    if (existing.some((name) => name.endsWith(suffix))) {
      return 0;
    }
  } catch {
    // destDir doesn't exist yet — migration may still populate it below.
  }

  // Scan srcDir for matching files.
  let srcEntries: string[];
  try {
    srcEntries = await readdir(srcDir);
  } catch {
    return 0; // srcDir absent or unreadable — nothing to migrate.
  }

  const matching = srcEntries.filter(
    (name) => name.endsWith(suffix) && name.length > suffix.length,
  );
  if (matching.length === 0) return 0;

  await mkdir(destDir, { recursive: true });

  let migrated = 0;
  for (const filename of matching) {
    try {
      await copyFile(join(srcDir, filename), join(destDir, filename));
      migrated++;
    } catch {
      // Best-effort — skip files that cannot be moved (permissions, EXDEV, etc.)
    }
  }
  return migrated;
}

/**
 * Archives completed run log files from `sourceDir` into `archiveDir`.
 *
 * For each `*-{slug}.jsonl` file in `sourceDir`:
 *   - **Skips** files where `readLogStatus()` returns `is_active: true` (run still in progress).
 *   - **Copies** the file to `archiveDir` when it is not yet present there.
 *   - **Refreshes** the archived copy when the source file's `mtime` is newer
 *     than the archived copy's `mtime` (source has been updated since last archive).
 *
 * `archiveDir` is created (recursively) if it does not already exist.
 * Individual copy failures are swallowed — archival is best-effort.
 *
 * @param archiveDir - Destination directory for archived log files.
 * @param sourceDir  - Source directory to scan (e.g. the orchestrator's live
 *                     `logs/` directory).
 * @param slug       - Project slug used to match filenames (`*-{slug}.jsonl`).
 * @returns Array of filenames that were archived or refreshed during this call.
 */
export async function archiveCompletedLogs(
  archiveDir: string,
  sourceDir: string,
  slug: string,
): Promise<string[]> {
  const suffix = `-${slug}.jsonl`;

  // Scan sourceDir for matching files.
  let srcEntries: string[];
  try {
    srcEntries = await readdir(sourceDir);
  } catch {
    return []; // sourceDir absent or unreadable — nothing to archive.
  }

  const matching = srcEntries.filter(
    (name) => name.endsWith(suffix) && name.length > suffix.length,
  );
  if (matching.length === 0) return [];

  await mkdir(archiveDir, { recursive: true });

  const archived: string[] = [];
  for (const filename of matching) {
    const srcPath = join(sourceDir, filename);
    const destPath = join(archiveDir, filename);

    // Skip files that belong to an active (still-running) orchestrator run.
    const { is_active } = await readLogStatus(srcPath);
    if (is_active) continue;

    // Determine whether a copy is needed.
    let needsCopy = true;
    try {
      const [srcStat, destStat] = await Promise.all([stat(srcPath), stat(destPath)]);
      // Archive is current when its mtime is >= source mtime.
      needsCopy = srcStat.mtimeMs > destStat.mtimeMs;
    } catch {
      // destPath doesn't exist yet — needsCopy stays true.
    }

    if (!needsCopy) continue;

    try {
      await copyFile(srcPath, destPath);
      archived.push(filename);
    } catch {
      // Best-effort — skip files that cannot be copied (permissions, etc.)
    }
  }

  return archived;
}

/**
 * Resolves which directory should be used to read a specific log file.
 *
 * Decision matrix (both `archiveDir` and `sourceDir` are considered):
 *
 * | sourceDir | archiveDir | source newer? | Result                              |
 * |-----------|------------|---------------|-------------------------------------|
 * | ✅ exists  | ❌ missing  | n/a           | returns `sourceDir`                 |
 * | ❌ missing | ✅ exists   | n/a           | returns `archiveDir`                |
 * | ✅ exists  | ✅ exists   | yes           | copies source → archive, returns `archiveDir` |
 * | ✅ exists  | ✅ exists   | no (archive current) | returns `archiveDir`         |
 *
 * When the file does not exist in either directory, returns `sourceDir` so the
 * caller's subsequent read will produce a sensible `NOT_FOUND` error.
 *
 * @param archiveDir - Ledger archive directory for this project's logs.
 * @param sourceDir  - Orchestrator live logs directory.
 * @param filename   - Bare filename (no directory component) to locate.
 * @returns The directory path from which `filename` should be read.
 */
export async function resolveLogSource(
  archiveDir: string,
  sourceDir: string,
  filename: string,
): Promise<string> {
  const srcPath = join(sourceDir, filename);
  const destPath = join(archiveDir, filename);

  let srcStat: { mtimeMs: number } | null = null;
  let destStat: { mtimeMs: number } | null = null;

  try {
    srcStat = await stat(srcPath);
  } catch {
    // File absent in sourceDir.
  }

  try {
    destStat = await stat(destPath);
  } catch {
    // File absent in archiveDir.
  }

  // Only in sourceDir.
  if (srcStat && !destStat) return sourceDir;

  // Only in archiveDir (or neither).
  if (!srcStat) return archiveDir;

  // Present in both — compare mtimes.
  if (srcStat.mtimeMs > destStat!.mtimeMs) {
    // Source is newer: refresh the archive copy before returning archiveDir.
    try {
      await mkdir(archiveDir, { recursive: true });
      await copyFile(srcPath, destPath);
    } catch {
      // Best-effort — return archiveDir even if copy fails (stale is better
      // than nothing, and sourceDir may have been removed).
    }
  }

  return archiveDir;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Reads a log file once and returns both active and dry-run status.
 *
 * - `is_active` is `true` when the last non-empty JSONL line does **not** have
 *   `action: "run_end"` or `action: "run_error"`. Empty files are considered
 *   active (run has just started writing).
 * - `is_dry_run` is `true` when the first non-empty JSONL line is a `run_start`
 *   event with `dry_run: true`.
 *
 * Fail-safe defaults on any I/O or parse error:
 *   - `is_active: false` — unreadable files are never shown with a "Running" badge.
 *   - `is_dry_run: false` — unreadable / malformed files never surface a dry-run badge.
 *
 * Replaces the former separate `isRunActive()` and `isDryRun()` helpers,
 * halving the number of `readFile()` calls per log entry in `findRunLogs()`.
 */
export async function readLogStatus(filePath: string): Promise<{ is_active: boolean; is_dry_run: boolean }> {
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf-8');
  } catch {
    return { is_active: false, is_dry_run: false };
  }

  const lines = raw.split('\n').filter((line) => line.trim().length > 0);

  // Determine is_dry_run from the first line (parsed independently so a
  // malformed first line does not affect the is_active determination).
  let is_dry_run = false;
  if (lines.length > 0) {
    try {
      const firstEntry = JSON.parse(lines[0]!);
      if (firstEntry && typeof firstEntry === 'object' && 'action' in firstEntry) {
        is_dry_run = firstEntry.action === 'run_start' && firstEntry.dry_run === true;
      }
    } catch {
      // Malformed first line — not a dry run.
    }
  }

  // Determine is_active from the last line.
  if (lines.length === 0) {
    return { is_active: true, is_dry_run }; // File just created — run has started
  }
  try {
    const lastEntry = JSON.parse(lines[lines.length - 1]!);
    if (lastEntry && typeof lastEntry === 'object' && 'action' in lastEntry) {
      const is_active = lastEntry.action !== 'run_end' && lastEntry.action !== 'run_error';
      return { is_active, is_dry_run };
    }
  } catch {
    // Malformed last line — cannot confirm completion.
  }
  return { is_active: true, is_dry_run }; // No terminal action found — treat as active
}

/**
 * Appends a synthetic `run_error` entry to a stale log file, permanently
 * closing it on disk so it is never shown as "Running" again.
 *
 * Failures are swallowed — a best-effort heal must never bubble up to callers.
 */
async function healStaleRun(filePath: string): Promise<void> {
  try {
    const entry = JSON.stringify({
      action: 'run_error',
      error: 'Run terminated without completing (healed by GUI on next page load)',
      ts: new Date().toISOString(),
    });
    await appendFile(filePath, '\n' + entry + '\n', 'utf-8');
  } catch {
    // Best-effort — ignore all errors (permissions, missing file, etc.)
  }
}

/**
 * Reads and parses a JSONL log file, supporting incremental reads.
 *
 * Security guards (throws `ApiError FORBIDDEN`):
 *   - `filename` must match the allowlist: `[A-Za-z0-9._-]+`
 *   - `filename` must not contain `..` or `/`
 *   - The resolved path must remain within `logsDir`
 *
 * Malformed JSON lines are silently skipped.
 *
 * @param logsDir   - Absolute path to the directory containing log files.
 * @param filename  - Bare filename (no directory component) to read.
 * @param afterLine - Zero-based index: skip this many lines from the start.
 *                    Pass 0 or omit to read from the beginning.
 * @returns `{ entries, totalLines }` where `totalLines` is the count of all
 *          non-empty lines in the file (before the `afterLine` offset is
 *          applied) and `entries` contains parsed JSON objects from line
 *          `afterLine + 1` onward.
 */
export async function readLogEntries(
  logsDir: string,
  filename: string,
  afterLine?: number
): Promise<{ entries: unknown[]; totalLines: number }> {
  // ── Security: filename allowlist ──────────────────────────────────────────
  if (
    !filename ||
    filename.includes('..') ||
    filename.includes('/') ||
    !SAFE_FILENAME_REGEX.test(filename)
  ) {
    throw new ApiError(
      'FORBIDDEN',
      `Filename contains disallowed characters or path components: '${filename}'`
    );
  }

  // ── Security: resolved-path escape check ─────────────────────────────────
  const resolvedLogsDir = resolve(logsDir);
  const resolvedFilePath = resolve(join(logsDir, filename));

  if (!resolvedFilePath.startsWith(resolvedLogsDir + sep) &&
      resolvedFilePath !== resolvedLogsDir) {
    throw new ApiError(
      'FORBIDDEN',
      `Resolved path escapes the logs directory: '${filename}'`
    );
  }

  // ── Read file ─────────────────────────────────────────────────────────────
  let raw: string;
  try {
    raw = await readFile(resolvedFilePath, 'utf-8');
  } catch (err: unknown) {
    if (isNodeError(err) && err.code === 'ENOENT') {
      throw new ApiError('NOT_FOUND', `Log file not found: '${filename}'`);
    }
    throw err;
  }

  // ── Parse JSONL ───────────────────────────────────────────────────────────
  const lines = raw.split('\n').filter((line) => line.trim().length > 0);
  const totalLines = lines.length;

  const skip = afterLine != null && afterLine > 0 ? afterLine : 0;
  const relevantLines = lines.slice(skip);

  const entries: unknown[] = [];
  for (const line of relevantLines) {
    try {
      entries.push(JSON.parse(line));
    } catch {
      // Malformed JSON — skip silently
    }
  }

  return { entries, totalLines };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}

```
###  Path: `/mcp-server/src/gui/queue/compute-effective-status.ts`

```ts
/**
 * Effective status computation for orchestrator run queue entries.
 *
 * This module is pure — it has no I/O dependencies and no side effects.
 * All transition logic lives here so it can be tested independently.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Lifecycle state computed by {@link computeEffectiveStatus}. */
export type EffectiveStatus = 'pending' | 'started' | 'dead';

// ---------------------------------------------------------------------------
// Status computation
// ---------------------------------------------------------------------------

/**
 * Computes the effective lifecycle status for a queue entry given whether its
 * process is alive, whether its project ledger entry exists, and whether the
 * JSONL log shows stage-level activity.
 *
 * Transition rules (in priority order):
 *   1. `projectExists`                    → `'started'`
 *   2. `alive && hasLogActivity`          → `'started'`  (stage work detected)
 *   3. `alive`                            → `'pending'`  (run started, no stage yet)
 *   4. (default)                          → `'dead'`     (process gone)
 *
 * `hasLogActivity` corresponds to `ProgressResolution.hasStageActivity` — it
 * is `true` when the JSONL log contains at least one non-`run_start` event.
 *
 * @param alive          - Whether the orchestrator process is still running.
 * @param projectExists  - Whether `project-ledger.json` exists for this run.
 * @param hasLogActivity - Whether the JSONL log shows stage activity beyond
 *                         `run_start`. **Defaults to `false`** so callers that
 *                         do not read the log (e.g. `killQueueEntry`,
 *                         `dismissQueueEntry`) get the conservative result.
 */
export function computeEffectiveStatus(
  alive: boolean,
  projectExists: boolean,
  hasLogActivity: boolean = false,
): EffectiveStatus {
  if (projectExists) return 'started';
  if (alive && hasLogActivity) return 'started';
  if (alive) return 'pending';
  return 'dead';
}

```
###  Path: `/mcp-server/src/gui/queue/format-progress-entry.ts`

```ts
/**
 * Maps JSONL orchestrator log entries to human-readable progress strings.
 *
 * This module is pure — it has no I/O dependencies and no side effects.
 * All event types that do not produce a useful summary return `null`.
 */

// ---------------------------------------------------------------------------
// Formatter
// ---------------------------------------------------------------------------

/**
 * Maps a single JSONL log entry to a human-readable progress string.
 *
 * Returns `null` for event types that do not produce a useful summary
 * (e.g. `heartbeat`, unrecognised actions).
 *
 * Exported for unit testing.
 */
export function formatProgressEntry(entry: Record<string, unknown>): string | null {
  const action   = typeof entry['action']    === 'string' ? entry['action']    : undefined;
  const stage    = typeof entry['stage']     === 'string' ? entry['stage']     : undefined;
  const wpId     = typeof entry['wp_id']     === 'string' ? entry['wp_id']     : undefined;
  const toolName = typeof entry['tool_name'] === 'string' && entry['tool_name'].length > 0
    ? entry['tool_name']
    : undefined;

  switch (action) {
    case 'run_start':
      return 'Run started';

    case 'stage_start': {
      const label = stage ?? '(unknown stage)';
      return wpId ? `Starting ${label} for ${wpId}` : `Starting ${label}`;
    }

    case 'stage_complete': {
      const result = typeof entry['result'] === 'string' ? entry['result'] : undefined;
      const label  = stage ?? '(unknown stage)';
      const suffix = wpId ? ` (${wpId})` : '';
      return result
        ? `${label} complete — ${result}${suffix}`
        : `${label} complete${suffix}`;
    }

    case 'progress_snapshot': {
      const total = typeof entry['total_wps'] === 'number' ? entry['total_wps'] : undefined;
      const bd    = (entry['status_breakdown'] ?? {}) as Record<string, number>;
      const done  = bd['COMPLETE'] ?? 0;
      return total != null ? `Progress: ${done}/${total} WPs complete` : 'Progress update';
    }

    case 'tool_call':
      return toolName ? `Tool call: ${toolName}` : 'Tool call';

    case 'wp_complete':
      return wpId ? `${wpId} complete` : 'WP complete';

    case 'wp_status_change': {
      const newStatus =
        typeof entry['new_status'] === 'string' ? entry['new_status'] : undefined;
      const prefix = wpId ? `${wpId} ` : '';
      return `${prefix}${newStatus ? `→ ${newStatus}` : 'status change'}`;
    }

    case 'run_end': {
      const result = typeof entry['result'] === 'string' ? entry['result'] : undefined;
      return result ? `Run ended: ${result}` : 'Run ended';
    }

    case 'run_error':
      return 'Run error';

    case 'signal_shutdown':
      return 'Interrupted by signal';

    case 'heartbeat':
      return null;  // intentionally skipped

    default:
      return null;
  }
}

```
###  Path: `/mcp-server/src/gui/queue/get-queue.ts`

```ts
/**
 * Queue reading internals for the orchestrator run queue (WP-B extraction).
 *
 * Reads `.run-queue.json`, enriches each raw entry with computed lifecycle
 * state and JSONL progress data, and returns the result as `QueueEntry[]`.
 *
 * This module is read-only with respect to the queue file and all other files.
 *
 * The `isRawQueueEntry` type-guard has been extracted to `validate-entry.ts`
 * for direct testability; it is imported here and re-used at the filter call site.
 *
 * Exports beyond `getQueue()`:
 *   - `readQueueFile` — used by `checkNoConflict` in `orchestrator-manager.ts`.
 *   - `isProcessAlive` — used by queue-mutation functions in `orchestrator-manager.ts`.
 *   - `getProjectLedgerStatus` — used by `killQueueEntry`/`dismissQueueEntry`
 *     in `orchestrator-manager.ts`.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { QUEUE_FILENAME, type RawQueueEntry, type QueueEntry } from './types.js';
import { isRawQueueEntry } from './validate-entry.js';
import { resolveProgress } from './resolve-progress.js';
import { computeEffectiveStatus } from './compute-effective-status.js';

// ---------------------------------------------------------------------------
// PID alive check
// ---------------------------------------------------------------------------

/**
 * Returns `true` if the process with `pid` exists on this machine.
 *
 * Uses `process.kill(pid, 0)` which is a zero-signal check — it only
 * verifies the process exists and does not actually deliver any signal.
 *
 * Exported for use by queue-mutation functions in `orchestrator-manager.ts`.
 */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Queue file reader
// ---------------------------------------------------------------------------

/**
 * Reads and parses `<logsDir>/.run-queue.json`.
 * Returns `[]` on any I/O or parse error — fail-safe.
 * Never writes to the queue file.
 *
 * Exported for use by `checkNoConflict` in `orchestrator-manager.ts`.
 */
export async function readQueueFile(logsDir: string): Promise<RawQueueEntry[]> {
  const queuePath = join(logsDir, QUEUE_FILENAME);
  let raw: string;
  try {
    raw = await readFile(queuePath, 'utf-8');
  } catch {
    return [];
  }
  try {
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data.filter(isRawQueueEntry);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Project ledger check
// ---------------------------------------------------------------------------

/**
 * Returns whether the project identified by `slug` has a ledger entry and
 * whether synthesis has been generated for it.
 *
 * Fail-safe: any I/O or parse error returns `{ exists: false, synthesisGenerated: false }`.
 *
 * Exported for use by `killQueueEntry`/`dismissQueueEntry` in `orchestrator-manager.ts`.
 *
 * @param ledgerRoot - Absolute path to the ledger root directory.
 * @param slug       - Project slug (e.g. `2026-05-05-my-feature`).
 * @returns An object with two fields:
 *   - `exists` — `true` when `<ledgerRoot>/<slug>/project-ledger.json` is present and
 *     readable; `false` on any I/O error or when the file does not exist.
 *   - `synthesisGenerated` — `true` when the ledger's `synthesis_generated` field equals
 *     `true`; `false` when the file is absent, unreadable, or the field is falsy.
 */
export async function getProjectLedgerStatus(
  ledgerRoot: string,
  slug: string,
): Promise<{ exists: boolean; synthesisGenerated: boolean }> {
  const projectLedgerPath = join(ledgerRoot, slug, 'project-ledger.json');
  let raw: string;
  try {
    raw = await readFile(projectLedgerPath, 'utf-8');
  } catch {
    return { exists: false, synthesisGenerated: false };
  }
  try {
    const data = JSON.parse(raw) as Record<string, unknown>;
    return {
      exists: true,
      synthesisGenerated: data['synthesis_generated'] === true,
    };
  } catch {
    return { exists: true, synthesisGenerated: false };
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Reads the shared orchestrator run queue and returns all active entries
 * enriched with computed lifecycle state and JSONL progress summaries.
 *
 * Entries for completed projects (`synthesis_generated === true`) are
 * automatically excluded from the result.
 *
 * This function is read-only: it never writes to the queue file or any
 * other file on disk.
 *
 * @param params.logsDir    - Absolute path to `orchestrator/logs/`.
 * @param params.ledgerRoot - Absolute path to the central ledger root.
 * @returns Enriched queue entries, excluding completed runs.
 */
export async function getQueue(params: {
  logsDir: string;
  ledgerRoot: string;
}): Promise<QueueEntry[]> {
  const { logsDir, ledgerRoot } = params;

  const rawEntries = await readQueueFile(logsDir);
  if (rawEntries.length === 0) return [];

  const enriched = await Promise.all(
    rawEntries.map(async (entry) => {
      const [projectStatus, progressResult] = await Promise.all([
        getProjectLedgerStatus(ledgerRoot, entry.expectedSlug),
        resolveProgress(logsDir, entry.expectedSlug),
      ]);

      const { exists: projectExists, synthesisGenerated } = projectStatus;
      const alive = isProcessAlive(entry.pid);

      // Compute effective status per AC-2 through AC-5.
      const effectiveStatus = computeEffectiveStatus(alive, projectExists, progressResult.hasStageActivity);

      // AC-6: exclude entries whose project has completed synthesis.
      if (effectiveStatus === 'started' && synthesisGenerated) {
        return null;
      }

      const result: QueueEntry = {
        ...entry,
        effectiveStatus,
        progress:      progressResult.summary,
        lastAction:    progressResult.lastAction,
        logFilename:   progressResult.logFilename,
        projectExists,
      };
      return result;
    }),
  );

  return enriched.filter((e): e is QueueEntry => e !== null);
}

```
###  Path: `/mcp-server/src/gui/queue/resolve-progress.ts`

```ts
/**
 * Progress resolution for orchestrator run queue entries.
 *
 * Reads the most recent JSONL log file for a given run slug and extracts
 * a structured `ProgressResolution` describing the last meaningful event.
 *
 * This module is read-only with respect to the filesystem.
 */

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { formatProgressEntry } from './format-progress-entry.js';
export { formatProgressEntry };
// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Structured result returned by {@link resolveProgress}.
 */
export interface ProgressResolution {
  /**
   * Human-readable summary of the last meaningful JSONL log event,
   * or `null` when no log file is found or no summarisable event exists.
   */
  summary: string | null;

  /**
   * The `action` field of the JSONL entry that produced `summary`,
   * or `null` when `summary` is `null`.
   */
  lastAction: string | null;

  /**
   * Basename of the JSONL log file that was read, or `null` when no
   * matching log file was found.
   */
  logFilename: string | null;

  /**
   * `true` when `lastAction` is non-null and is not `'run_start'`,
   * indicating that at least one meaningful pipeline stage has been entered.
   */
  hasStageActivity: boolean;
}

// ---------------------------------------------------------------------------
// Progress resolver
// ---------------------------------------------------------------------------

/** Sentinel value reused when the function returns early with no data. */
const EMPTY_RESOLUTION: ProgressResolution = {
  summary:         null,
  lastAction:      null,
  logFilename:     null,
  hasStageActivity: false,
};
Object.freeze(EMPTY_RESOLUTION);

/**
 * Finds the most recent JSONL log file for `slug` in `logsDir` and returns
 * a structured {@link ProgressResolution} describing the last meaningful event.
 *
 * Returns a resolution with all `null`/`false` fields when:
 *   - No matching log file exists.
 *   - The file is unreadable or empty.
 *   - All entries are non-summarisable (e.g. only heartbeats).
 *
 * `logFilename` is populated even when the file is readable but contains
 * only non-summarisable events (i.e. it can be non-null while `summary` is null).
 *
 * `hasStageActivity` is derived from `lastAction`: it is `true` when
 * `lastAction` is non-null and is not `'run_start'`, indicating that at
 * least one pipeline stage has been entered.
 */
export async function resolveProgress(
  logsDir: string,
  slug:    string,
): Promise<ProgressResolution> {
  let dirEntries: string[];
  try {
    dirEntries = await readdir(logsDir);
  } catch {
    return EMPTY_RESOLUTION;
  }

  const suffix   = `-${slug}.jsonl`;
  const matching = dirEntries
    .filter((name) => name.endsWith(suffix) && name.length > suffix.length)
    .sort()
    .reverse();  // newest-first (ISO-prefixed filenames sort lexicographically)

  if (matching.length === 0) return EMPTY_RESOLUTION;

  const logFilename = matching[0]!;
  const filePath    = join(logsDir, logFilename);
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf-8');
  } catch {
    return { ...EMPTY_RESOLUTION, logFilename };
  }

  const lines = raw.split('\n').filter((l) => l.trim().length > 0);

  // Walk backwards to find the last summarisable event.
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(lines[i]!) as Record<string, unknown>;
      const summary = formatProgressEntry(parsed);
      if (summary !== null) {
        const lastAction = typeof parsed['action'] === 'string' ? parsed['action'] : null;
        return {
          summary,
          lastAction,
          logFilename,
          hasStageActivity: lastAction !== null && lastAction !== 'run_start',
        };
      }
    } catch {
      // Malformed JSON line — skip.
    }
  }

  // File was readable but contained no summarisable events.
  return { ...EMPTY_RESOLUTION, logFilename };
}

```
###  Path: `/mcp-server/src/gui/queue/types.ts`

```ts
/**
 * Shared type definitions and constants for the orchestrator run queue.
 *
 * This module is the leaf of the queue module dependency chain — it imports
 * only from `compute-effective-status.ts` and has no other intra-queue
 * dependencies.
 *
 * Dependency order (lowest to highest):
 *   types.ts ← compute-effective-status.ts ← validate-entry.ts
 *   format-progress-entry.ts  (independent leaf)
 *   resolve-progress.ts ← format-progress-entry.ts
 *   get-queue.ts ← types, validate-entry, resolve-progress, compute-effective-status
 *   orchestrator-manager.ts ← get-queue, types, resolve-progress, compute-effective-status
 */

import type { EffectiveStatus } from './compute-effective-status.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Filename of the shared run queue within the orchestrator logs directory. */
export const QUEUE_FILENAME = '.run-queue.json';

// ---------------------------------------------------------------------------
// Queue entry types
// ---------------------------------------------------------------------------

/**
 * Raw entry shape as written by the Python orchestrator to `.run-queue.json`.
 * The `status` field is always `'pending'` at write time; effective lifecycle
 * transitions are computed in-memory by `getQueue()`.
 */
export interface RawQueueEntry {
  id: string;
  pid: number;
  planPath: string;
  expectedSlug: string;
  startedAt: string;
  status: 'pending';
}

/**
 * Queue entry enriched with computed lifecycle state and an optional
 * human-readable JSONL progress summary. Returned by `getQueue()`.
 *
 * @remarks
 * The fields that extend `RawQueueEntry` are all computed in-memory by
 * `getQueue()` and are never persisted to the queue file:
 *
 * - `effectiveStatus` — derived from the PID alive-check, the presence of the
 *   project ledger, and JSONL stage activity. See `computeEffectiveStatus()`.
 * - `progress` / `lastAction` / `logFilename` — extracted from the most recent
 *   JSONL log event by `resolveProgress()`.
 * - `projectExists` — populated directly from `getProjectLedgerStatus().exists`.
 *   Use this flag (rather than inferring from `effectiveStatus`) to gate UI
 *   elements that require a valid project ledger, e.g. the "View Project" link.
 */
export interface QueueEntry extends RawQueueEntry {
  /** Lifecycle state computed in-memory — not persisted to the queue file. */
  effectiveStatus: EffectiveStatus;
  /**
   * Human-readable summary of the most recent meaningful JSONL log event,
   * or `null` when no log file is found or no summarizable event exists.
   */
  progress: string | null;
  /**
   * The `action` field of the JSONL entry that produced `progress`,
   * or `null` when `progress` is `null`.
   *
   * @remarks Callers can derive `hasStageActivity` from this field without
   * reading the `ProgressResolution` object directly:
   * `lastAction !== null && lastAction !== 'run_start'`.
   */
  lastAction: string | null;
  /**
   * Basename of the JSONL log file that was read, or `null` when no
   * matching log file was found.
   */
  logFilename: string | null;
  /**
   * `true` when the project ledger file exists on disk for this entry's
   * `expectedSlug`; `false` when it does not (e.g. the project has not been
   * initialised yet). Use this flag to gate the "View Project" link — it is
   * authoritative and avoids heuristic inference from `effectiveStatus`.
   */
  projectExists: boolean;
}

// ---------------------------------------------------------------------------
// Queue mutation types
// ---------------------------------------------------------------------------

/**
 * Result returned by {@link killQueueEntry}.
 */
export interface KillResult {
  /** `true` when the entry was found, was effectively pending, and was terminated. */
  killed: boolean;
}

// ---------------------------------------------------------------------------
// Preflight types
// ---------------------------------------------------------------------------

/**
 * Result of a single preflight check.
 */
export interface PreflightResult {
  name:    string;
  pass:    boolean;
  detail:  string;
  fix?:    string;
}

/**
 * Result returned by {@link startOrchestrator}.
 */
export interface StartResult {
  /** All preflight check results, in execution order. */
  checks:  PreflightResult[];
  /** `true` only when `dryRun` is `false` and every check passed. */
  started: boolean;
  /** PID of the spawned process. Present only when `started === true`. */
  pid?:    number;
  /**
   * Basename of the run-status tombstone file the GUI should poll for,
   * e.g. `"a3f9b1c2d4e5f6a7-run-status.json"`.
   * Present only when `started === true`.
   */
  runStatusFilename?: string;
}

// ---------------------------------------------------------------------------
// Run-status tombstone type
// ---------------------------------------------------------------------------

/**
 * Shape of the `{slug}.run-status.json` file written by the Python
 * orchestrator at the end of every run.
 *
 * The file is deleted at the *start* of a new run for the same slug and
 * written at the *end*, so its presence always reflects the most recent
 * completed run.
 */
export interface RunStatus {
  slug:        string;
  result:      'SUCCESS' | 'ERROR';
  error:       string | null;
  logFilename: string;
  durationS:   number | null;
}

```
###  Path: `/mcp-server/src/gui/queue/validate-entry.ts`

```ts
/**
 * Entry validator for the orchestrator run queue (extracted from get-queue.ts).
 *
 * Exposes `isRawQueueEntry()` as a named export so it can be unit-tested
 * directly without filesystem setup. The function is pure — it has no I/O
 * dependencies and no side effects.
 */

import type { RawQueueEntry } from './types.js';

// ---------------------------------------------------------------------------
// Type guard
// ---------------------------------------------------------------------------

/**
 * Type-guard that validates a raw JSON value as a `RawQueueEntry`.
 *
 * Returns `true` only when **all five** of the following rules pass:
 *
 * 1. **Type check** — `entry` is a non-null object.
 * 2. **String fields** — `id`, `planPath`, and `startedAt` are strings; `id` must be
 *    non-empty and non-whitespace-only.
 * 3. **PID integer** — `pid` is a finite integer (rejects floats).
 * 4. **PID positive** — `pid` is greater than zero (rejects zero and negatives).
 * 5. **Non-empty slug** — `expectedSlug` is a non-empty, non-whitespace-only string
 *    (rejects missing, empty-string, and whitespace-only slugs).
 *
 * Used by `readQueueFile` in `get-queue.ts` to filter the parsed JSON array
 * before it is returned as `RawQueueEntry[]`.
 *
 * @returns `true` when every rule passes; `false` otherwise.
 */
export function isRawQueueEntry(entry: unknown): entry is RawQueueEntry {
  if (typeof entry !== 'object' || entry === null) return false;
  const e = entry as Record<string, unknown>;
  return (
    typeof e['id'] === 'string' && (e['id'] as string).trim().length > 0 &&
    typeof e['pid'] === 'number' && Number.isInteger(e['pid']) && (e['pid'] as number) > 0 &&
    typeof e['planPath'] === 'string' &&
    typeof e['expectedSlug'] === 'string' && (e['expectedSlug'] as string).trim().length > 0 &&
    typeof e['startedAt'] === 'string'
  );
}

```