import { readFile } from 'fs/promises';
import { z } from 'zod';
import { resolveErrorCodesDir } from '../storage/store-registry.js';
import { atomicWriteJson } from '../storage/atomic-writer.js';
import { withLock } from '../storage/file-lock.js';

/**
 * The error-code allocator's core configuration file:
 * `~/.ai-insights/error-codes/config.json`.
 *
 * Read on every allocation, with no in-memory cache and no filesystem
 * watcher — allocations are rare, so the per-call read stays cheap and both
 * the MCP server process and the GUI server process always observe the
 * latest saved settings without needing to coordinate a cache invalidation.
 *
 * `providers` is a free-form bag of `{ [provider-id]: settings }`. Its
 * values are not validated by this schema (a provider's own settings shape
 * is runtime-defined — see `settings-schema.ts#buildSettingsSchema`), which
 * is also why settings saved for a provider that is not currently installed
 * round-trip untouched: this schema has no opinion about their shape.
 */
export const ErrorCodeConfigSchema = z.object({
  version: z.literal(1).default(1),
  active_provider: z.string().default('file'),
  temporary_prefix: z.string().default('777'),
  timeout_ms: z.number().int().positive().default(10000),
  retry: z
    .object({
      default_wait_ms: z.number().int().positive().default(11000),
      max_wait_ms: z.number().int().positive().default(30000),
    })
    .default({ default_wait_ms: 11000, max_wait_ms: 30000 }),
  providers: z.record(z.string(), z.record(z.string(), z.unknown())).default({}),
});

/** The error-code allocator's config shape, inferred from {@link ErrorCodeConfigSchema}. */
export type ErrorCodeConfig = z.infer<typeof ErrorCodeConfigSchema>;

/**
 * The documented defaults applied when `config.json` does not exist yet —
 * zero setup is required to start allocating through the `file` provider.
 */
function defaultConfig(): ErrorCodeConfig {
  return ErrorCodeConfigSchema.parse({});
}

/** File name for the error-code allocator's config file, nested under `resolveErrorCodesDir()`. */
const CONFIG_FILENAME = 'config.json';

/**
 * Absolute path of `~/.ai-insights/error-codes/config.json`.
 */
function resolveConfigPath(): string {
  return `${resolveErrorCodesDir()}/${CONFIG_FILENAME}`;
}

/**
 * Reads and validates the error-code allocator's config file.
 *
 * No cache, no watcher — every call re-reads the file from disk. A missing
 * file, malformed JSON, or a value that fails {@link ErrorCodeConfigSchema}
 * validation all yield the documented defaults rather than throwing, so a
 * corrupt or absent config file never blocks an allocation.
 */
export async function loadErrorCodeConfig(): Promise<ErrorCodeConfig> {
  const path = resolveConfigPath();

  let raw: string;
  try {
    raw = await readFile(path, 'utf-8');
  } catch {
    // Missing file (or any other read failure): documented defaults.
    return defaultConfig();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return defaultConfig();
  }

  const result = ErrorCodeConfigSchema.safeParse(parsed);
  if (!result.success) {
    return defaultConfig();
  }
  return result.data;
}

/**
 * Applies a read-modify-write update to the error-code allocator's config
 * file.
 *
 * Runs under `withLock(resolveErrorCodesDir(), …)` so concurrent callers in
 * the same or different processes never race a lost-update: each call reads
 * the current file (or the defaults, when absent), applies `mutator` to a
 * fresh copy, validates the result, and writes it back with
 * `atomicWriteJson(..., { mode: 0o600 })` before releasing the lock.
 *
 * `mutator` receives the config currently on disk (already validated) and
 * returns the next config to persist. It may mutate and return the same
 * object, or return a new one — both are written as given, then re-validated
 * before the write so a mutator cannot silently persist an invalid shape.
 *
 * @param mutator - Produces the next config from the current one.
 * @returns The config that was written.
 */
export async function updateErrorCodeConfig(
  mutator: (current: ErrorCodeConfig) => ErrorCodeConfig
): Promise<ErrorCodeConfig> {
  const dir = resolveErrorCodesDir();
  return withLock(dir, async () => {
    const current = await loadErrorCodeConfig();
    const next = mutator(current);
    const validated = ErrorCodeConfigSchema.parse(next);
    await atomicWriteJson(resolveConfigPath(), validated, { mode: 0o600 });
    return validated;
  });
}
