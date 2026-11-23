import { z } from 'zod';
import { resolveErrorCodesDir } from '../storage/store-registry.js';
import { atomicWriteJson } from '../storage/atomic-writer.js';
import { withLock } from '../storage/file-lock.js';
import { keepCorruptCopy, readJsonStateFile } from '../storage/json-state-file.js';

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
/**
 * The accepted temporary-code prefix: 1–6 digits, no leading zero.
 *
 * Non-empty keeps temporary codes distinguishable from real ones (an empty
 * prefix would yield `000001`). No leading zero keeps the code stable for a
 * consumer that parses it as a number. At most 6 digits keeps
 * `first_component_code` (prefix + 6 digits + `01`) at 14 digits, below the 16
 * digits JavaScript can hold exactly. The GUI form mirrors this pattern in
 * `gui/public/views/config-error-codes.js` (a test pins the two together).
 */
export const TEMPORARY_PREFIX_PATTERN = /^[1-9][0-9]{0,5}$/;

/** The temporary prefix used when none is configured, and the fallback for an invalid stored one. */
export const DEFAULT_TEMPORARY_PREFIX = '777';

/** Validates a temporary-code prefix; used by the persisted-config schema and the GUI's PUT body schema. */
export const TemporaryPrefixSchema = z
  .string()
  .regex(TEMPORARY_PREFIX_PATTERN, 'Temporary prefix must be 1–6 digits and must not start with 0.');

export const ErrorCodeConfigSchema = z.object({
  version: z.literal(1).default(1),
  active_provider: z.string().default('file'),
  temporary_prefix: TemporaryPrefixSchema.default(DEFAULT_TEMPORARY_PREFIX),
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Outcome of reading `config.json`; `config` is always usable. */
type ConfigState =
  | { state: 'missing' | 'ok'; config: ErrorCodeConfig }
  /** The file parsed, but some fields were invalid; only those fields fell back to their defaults. */
  | { state: 'salvaged'; config: ErrorCodeConfig; salvaged: string[] }
  /** The file exists but is not usable JSON/shape; `config` is the defaults. */
  | { state: 'corrupt'; config: ErrorCodeConfig; reason: string }
  /** The file exists but could not be read (e.g. `EACCES`); `config` is the defaults. */
  | { state: 'unreadable'; config: ErrorCodeConfig; reason: string };

/**
 * Field-level salvage of a stored config that fails the strict schema.
 *
 * Every top-level field is parsed on its own and falls back to *its own*
 * default, so one bad field (e.g. a non-digit prefix or a string `timeout_ms`)
 * can no longer discard the others — in particular `providers`, which holds
 * stored secrets. Each `providers` entry that is not a plain object is dropped
 * individually.
 *
 * @returns The salvaged config and the paths of the fields that fell back
 *   (paths only, never values), or `null` when the value is not an object or
 *   carries a `version` other than `1` — that file is treated as corrupt.
 */
function salvageStoredConfig(value: unknown): { config: ErrorCodeConfig; salvaged: string[] } | null {
  if (!isPlainObject(value)) return null;
  if (value['version'] !== undefined && value['version'] !== 1) return null;

  const salvaged: string[] = [];
  const defaults = defaultConfig();

  const pick = <T>(path: string, schema: z.ZodType<T>, raw: unknown, fallback: T): T => {
    if (raw === undefined) return fallback;
    const parsed = schema.safeParse(raw);
    if (parsed.success) return parsed.data;
    salvaged.push(path);
    return fallback;
  };

  const positiveInt = z.number().int().positive();

  const retryRaw = value['retry'];
  let defaultWait = defaults.retry.default_wait_ms;
  let maxWait = defaults.retry.max_wait_ms;
  if (retryRaw !== undefined) {
    if (isPlainObject(retryRaw)) {
      defaultWait = pick('retry.default_wait_ms', positiveInt, retryRaw['default_wait_ms'], defaultWait);
      maxWait = pick('retry.max_wait_ms', positiveInt, retryRaw['max_wait_ms'], maxWait);
    } else {
      salvaged.push('retry');
    }
  }

  const providers: ErrorCodeConfig['providers'] = {};
  const providersRaw = value['providers'];
  if (providersRaw !== undefined) {
    if (isPlainObject(providersRaw)) {
      for (const [id, settings] of Object.entries(providersRaw)) {
        if (isPlainObject(settings)) {
          providers[id] = settings;
        } else {
          salvaged.push(`providers.${id}`);
        }
      }
    } else {
      salvaged.push('providers');
    }
  }

  const config: ErrorCodeConfig = {
    version: 1,
    active_provider: pick('active_provider', z.string(), value['active_provider'], defaults.active_provider),
    temporary_prefix: pick('temporary_prefix', TemporaryPrefixSchema, value['temporary_prefix'], defaults.temporary_prefix),
    timeout_ms: pick('timeout_ms', positiveInt, value['timeout_ms'], defaults.timeout_ms),
    retry: { default_wait_ms: defaultWait, max_wait_ms: maxWait },
    providers,
  };
  return { config, salvaged };
}

/**
 * Reads `config.json` and classifies it. Never throws. Only a *missing* file
 * is the plain defaults; the other states tell the caller how the file is
 * broken so that a read can degrade gracefully while a write can refuse to
 * destroy what it could not read.
 */
async function readConfigState(): Promise<ConfigState> {
  let state;
  try {
    state = await readJsonStateFile(resolveConfigPath());
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? 'unknown';
    return { state: 'unreadable', config: defaultConfig(), reason: `cannot be read (${code})` };
  }

  if (state.status === 'missing') {
    return { state: 'missing', config: defaultConfig() };
  }
  // The JSON parser's message is deliberately not reported: it quotes a snippet of the text, and this file holds secrets.
  if (state.status === 'unparsable') {
    return { state: 'corrupt', config: defaultConfig(), reason: 'is not valid JSON' };
  }

  const strict = ErrorCodeConfigSchema.safeParse(state.value);
  if (strict.success) {
    return { state: 'ok', config: strict.data };
  }

  const salvage = salvageStoredConfig(state.value);
  if (salvage === null) {
    return { state: 'corrupt', config: defaultConfig(), reason: 'is not a version 1 config object' };
  }
  return { state: 'salvaged', config: salvage.config, salvaged: salvage.salvaged };
}

/**
 * Reads the error-code allocator's config file and classifies what's wrong
 * with it, for a caller that can surface the problem somewhere other than
 * stderr (the GUI's Error Codes tab).
 *
 * Built on {@link readConfigState}'s classification — the same one
 * {@link loadErrorCodeConfig} uses internally — so the two never disagree
 * about what counts as usable. `config` is always usable; `warning` is only
 * present when the caller should tell a human something was wrong:
 *
 * - `missing` / `ok` → no `warning`.
 * - `salvaged` → `warning` names the field paths that fell back to their
 *   defaults (paths only, never a value).
 * - `corrupt` / `unreadable` → `warning` is the same fixed, already-sanitized
 *   reason `readConfigState()` classified the file with (never the JSON
 *   parser's message, which would quote file content, and never a stored
 *   value — this file holds secrets).
 */
export async function readErrorCodeConfig(): Promise<{ config: ErrorCodeConfig; warning?: string }> {
  const result = await readConfigState();

  if (result.state === 'salvaged') {
    return {
      config: result.config,
      warning: `${CONFIG_FILENAME} has invalid fields (${result.salvaged.join(', ') || 'none'}); using their defaults and keeping the rest`,
    };
  }
  if (result.state === 'corrupt' || result.state === 'unreadable') {
    return { config: result.config, warning: `${CONFIG_FILENAME} ${result.reason}; using the defaults` };
  }

  return { config: result.config };
}

/**
 * Reads the error-code allocator's config file.
 *
 * A thin wrapper over {@link readErrorCodeConfig}: writes its `warning` (when
 * present) to stderr with the `[error-codes]` prefix this module's other
 * stderr lines use, and returns just the `config`. No cache, no watcher —
 * every call re-reads the file from disk, and it is never locked: a writer
 * replaces the file in one atomic rename, so a reader sees either the old or
 * the new complete file. It never throws, so an absent or damaged config
 * never blocks an allocation:
 *
 * - missing file → the documented defaults;
 * - unparsable, unreadable or not-a-config file → the defaults, plus a stderr warning;
 * - a file with some invalid fields → those fields alone fall back to their
 *   defaults (the rest, `providers` and secrets included, are kept), plus a
 *   stderr warning that names the field paths and never a value.
 */
export async function loadErrorCodeConfig(): Promise<ErrorCodeConfig> {
  const { config, warning } = await readErrorCodeConfig();

  if (warning !== undefined) {
    process.stderr.write(`[error-codes] ${warning}\n`);
  }

  return config;
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
 * A save never silently overwrites stored secrets it could not read:
 *
 * - **unreadable** file (e.g. `EACCES`) → throws and writes nothing;
 * - **unparsable** or not-a-config file → a byte-identical copy is kept as
 *   `config.corrupt-{stamp}.json`, then the update proceeds from the defaults
 *   and replaces the original in one atomic rename (so a concurrent
 *   `loadErrorCodeConfig` never sees the file missing);
 * - a file with some invalid fields → the update proceeds from the salvaged
 *   config, so providers and secrets survive and the invalid fields are
 *   replaced by their defaults.
 *
 * `mutator` receives the config currently on disk (already validated) and
 * returns the next config to persist. It may mutate and return the same
 * object, or return a new one — both are written as given, then re-validated
 * before the write so a mutator cannot silently persist an invalid shape.
 *
 * @param mutator - Produces the next config from the current one.
 * @returns The config that was written.
 * @throws {Error} When `config.json` exists but cannot be read, or `mutator`
 *   returns a config that fails {@link ErrorCodeConfigSchema}.
 */
export async function updateErrorCodeConfig(
  mutator: (current: ErrorCodeConfig) => ErrorCodeConfig
): Promise<ErrorCodeConfig> {
  const dir = resolveErrorCodesDir();
  return withLock(dir, async () => {
    const read = await readConfigState();

    if (read.state === 'unreadable') {
      throw new Error(`${CONFIG_FILENAME} ${read.reason}; not overwriting it`);
    }
    if (read.state === 'corrupt') {
      const copyName = await keepCorruptCopy(resolveConfigPath());
      process.stderr.write(`[error-codes] ${CONFIG_FILENAME} ${read.reason}; a copy was kept as ${copyName} before saving\n`);
    }

    const next = mutator(read.config);
    const validated = ErrorCodeConfigSchema.parse(next);
    await atomicWriteJson(resolveConfigPath(), validated, { mode: 0o600 });
    return validated;
  });
}
