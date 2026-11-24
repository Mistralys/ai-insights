import { join } from 'path';
import { atomicWriteJson } from '../../storage/atomic-writer.js';
import { withLock } from '../../storage/file-lock.js';
import { readJsonStateFile } from '../../storage/json-state-file.js';
import type { AllocationOutcome, AllocationRequest, ErrorCodeProvider, ProviderContext } from '../provider-api.js';

/**
 * The zero-setup default error-code provider (id `file`).
 *
 * Keeps a sequence in a locked JSON counter file, scoped either globally
 * (one sequence, keyed by `counter_name`) or per repository (one sequence
 * per repository, keyed by `repository.folder_name` — every linked worktree
 * of one repository shares the same `folder_name`, so a repository-scoped
 * sequence is never split across its worktrees). `counter_file` defaults to
 * `{data_dir}/counters.json`, but can be pointed anywhere, including inside
 * the repository itself via a `{repo}` placeholder (e.g.
 * `{repo}/.error-codes.json`).
 *
 * The counter file is the authority on real codes, so it is read strictly: a
 * missing file starts a new sequence, but a file that exists and cannot be
 * read, parsed or validated makes `allocate` and `peek` return `failed` and is
 * left untouched. The core turns `failed` into a temporary code, so allocation
 * still succeeds; restarting the sequence would instead reissue codes already
 * embedded in source. Counter keys are held in a `Map`, so every string is a
 * valid key (`__proto__` and `constructor` included).
 *
 * Concurrency: allocations are serialised per user. Every process of one user
 * (the MCP servers, the GUI, parallel workflow runs) resolves the same
 * `data_dir`, so they all contend on one lock. A counter file shared between
 * different users or machines is not protected and is not supported.
 *
 * Imports only from `../provider-api.js` plus the storage primitives this
 * module needs — same rule every provider (built-in or plugin) follows, so
 * the contract stays proven sufficient by its own built-ins.
 */

/** This provider's settings shape, after `buildSettingsSchema(FILE_PROVIDER_SETTINGS).safeParse(...)`. */
interface FileProviderSettings {
  scope: 'global' | 'repository';
  counter_file: string;
  counter_name: string;
  start_value: number;
}

/** Result of {@link parseCountersFile}. */
type CountersParse = { ok: true; counters: Map<string, number> } | { ok: false; error: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validates the parsed JSON of a counter file by hand and returns its counters
 * as a `Map`. Shape: `{ "counters": { "<key>": <integer>, ... } }`, where
 * `counters` may be absent (an empty file body) and every value must be a safe
 * integer >= 0.
 *
 * A `Map` and `Object.entries` are used instead of a plain-object dictionary
 * so that no key — `__proto__`, `constructor`, `toString` — can ever resolve
 * to an inherited property; `Object.entries` also yields an own `__proto__`
 * key that `JSON.parse` created, which a Zod record would drop.
 */
function parseCountersFile(value: unknown): CountersParse {
  if (!isPlainObject(value)) {
    return { ok: false, error: 'top level is not a JSON object' };
  }

  const counters = new Map<string, number>();
  if (!Object.hasOwn(value, 'counters')) {
    return { ok: true, counters };
  }

  const raw = value['counters'];
  if (!isPlainObject(raw)) {
    return { ok: false, error: '"counters" is not a JSON object' };
  }

  for (const [key, count] of Object.entries(raw)) {
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
      return { ok: false, error: `counter "${key}" is not a non-negative integer` };
    }
    counters.set(key, count);
  }
  return { ok: true, counters };
}

/** Inverse of {@link parseCountersFile}. `Object.fromEntries` defines own data properties, so `__proto__` round-trips as a normal key. */
function serializeCountersFile(counters: Map<string, number>): { counters: Record<string, number> } {
  return { counters: Object.fromEntries(counters) };
}

/** Result of {@link readCounters}: the counters, or why the file cannot be used. */
type CountersRead = { ok: true; counters: Map<string, number> } | { ok: false; cause: string };

/**
 * Strict read of the counter file. Only a missing file yields an empty
 * sequence; an unreadable, unparsable or invalid file is reported as a
 * problem and must never be overwritten by the caller.
 */
async function readCounters(filePath: string): Promise<CountersRead> {
  let state;
  try {
    state = await readJsonStateFile(filePath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return { ok: false, cause: `cannot be read${code ? ` (${code})` : ''}` };
  }

  if (state.status === 'missing') {
    return { ok: true, counters: new Map() };
  }
  if (state.status === 'unparsable') {
    return { ok: false, cause: `is not valid JSON (${state.error})` };
  }

  const parsed = parseCountersFile(state.value);
  return parsed.ok ? parsed : { ok: false, cause: `is invalid (${parsed.error})` };
}

/** The `failed` outcome for a counter file that exists but cannot be used. Non-ambiguous: nothing was issued. */
function counterFileProblem(filePath: string, cause: string): AllocationOutcome {
  return {
    ok: false,
    reason: 'failed',
    ambiguous: false,
    detail: `counter file ${filePath} ${cause}; no code was issued from it — repair or remove the file`,
  };
}

/** Result of {@link resolveCounterLocation}: either the file path and sequence key to use, or a reason allocation cannot proceed. */
type CounterLocation = { ok: true; filePath: string; key: string } | { ok: false; detail: string };

/**
 * Resolves the counter file path and the sequence key for a request, given
 * the provider's settings and the core-supplied context/repository.
 *
 * - `counter_file` left empty resolves to `{ctx.data_dir}/counters.json`.
 * - A `{repo}` placeholder in `counter_file` expands to `repository.root_path`
 *   — every occurrence, via a global replace.
 * - `scope: 'repository'`, or a `{repo}` placeholder with no repository
 *   resolved, both fail with `misconfigured`'s documented detail.
 * - The sequence key is `repository.folder_name` for repository scope,
 *   `counter_name` for global scope.
 */
function resolveCounterLocation(
  settings: FileProviderSettings,
  ctx: ProviderContext,
  repository: AllocationRequest['repository']
): CounterLocation {
  const usesRepoPlaceholder = settings.counter_file.includes('{repo}');

  if ((settings.scope === 'repository' || usesRepoPlaceholder) && repository === null) {
    return { ok: false, detail: 'no repository found for cwd_path' };
  }

  const filePath =
    settings.counter_file === ''
      ? join(ctx.data_dir, 'counters.json')
      : usesRepoPlaceholder
        ? settings.counter_file.split('{repo}').join((repository as NonNullable<typeof repository>).root_path)
        : settings.counter_file;

  const key = settings.scope === 'repository' ? (repository as NonNullable<typeof repository>).folder_name : settings.counter_name;

  return { ok: true, filePath, key };
}

/** Computes the next value for `key`, given the counters currently on disk and the configured `start_value`. */
function nextValueFor(counters: Map<string, number>, key: string, startValue: number): number {
  const current = counters.has(key) ? (counters.get(key) as number) : startValue - 1;
  return current + 1;
}

async function allocate(request: AllocationRequest, ctx: ProviderContext): Promise<AllocationOutcome> {
  const settings = ctx.settings as unknown as FileProviderSettings;
  const location = resolveCounterLocation(settings, ctx, request.repository);
  if (!location.ok) {
    return { ok: false, reason: 'misconfigured', detail: location.detail };
  }

  const { filePath, key } = location;

  // Lock `ctx.data_dir`, never the counter file's own directory.
  //
  // - `data_dir` lives under the user's home directory, so every process of
  //   this user (both MCP servers, the GUI, parallel workflow runs) resolves
  //   the same one and all of them serialise on this single lock.
  // - `withLock` creates a `.lock` directory inside whatever it locks. That
  //   directory exists only while an allocation holds the lock (it is left
  //   behind only by a hard kill, and reclaimed as stale after 10 s), but
  //   locking `data_dir` keeps even that transient entry out of a
  //   `{repo}/.error-codes.json` repository directory.
  // - A counter file shared between different users or machines is NOT
  //   protected by this lock and is not a supported configuration.
  //
  // The strict read stays inside the lock, so another process of the same
  // user can never be mid-write while the file is classified as corrupt.
  return withLock(ctx.data_dir, async () => {
    const read = await readCounters(filePath);
    if (!read.ok) {
      return counterFileProblem(filePath, read.cause);
    }

    const next = nextValueFor(read.counters, key, settings.start_value);
    read.counters.set(key, next);
    await atomicWriteJson(filePath, serializeCountersFile(read.counters));
    return { ok: true, value: next };
  });
}

async function peek(request: AllocationRequest, ctx: ProviderContext): Promise<AllocationOutcome> {
  const settings = ctx.settings as unknown as FileProviderSettings;
  const location = resolveCounterLocation(settings, ctx, request.repository);
  if (!location.ok) {
    return { ok: false, reason: 'misconfigured', detail: location.detail };
  }

  // Read-only: computes the value the next `allocate` call would return,
  // without acquiring the lock or writing anything. Safe without the lock
  // because `atomicWriteJson` renames a complete temp file into place, so a
  // reader sees either the old or the new file, never a partial one.
  const read = await readCounters(location.filePath);
  if (!read.ok) {
    return counterFileProblem(location.filePath, read.cause);
  }
  return { ok: true, value: nextValueFor(read.counters, location.key, settings.start_value) };
}

export const fileProvider: ErrorCodeProvider = {
  apiVersion: 1,
  id: 'file',
  label: 'File (built-in, zero setup)',
  description:
    'Keeps a sequence in a locked JSON file on this machine. No external service required. Supports global or per-repository scoping.',
  settings: [
    {
      key: 'scope',
      label: 'Scope',
      type: 'select',
      options: [
        { value: 'global', label: 'Global (one sequence for every repository)' },
        { value: 'repository', label: 'Per repository (one sequence per repository)' },
      ],
      default: 'global',
      description: 'Global uses one sequence named by "Counter Name". Per-repository uses one sequence per repository, keyed by its folder name — shared across every linked worktree of that repository.',
    },
    {
      key: 'counter_file',
      label: 'Counter File',
      type: 'path',
      default: '',
      placeholder: '',
      description:
        'Where the counter file is stored. Leave empty to use the default location. Supports a {repo} placeholder (e.g. "{repo}/.error-codes.json") to keep the sequence inside the repository itself. The file must not be shared between different users or machines: allocations are serialised per user only.',
    },
    {
      key: 'counter_name',
      label: 'Counter Name',
      type: 'string',
      default: 'default',
      description: 'The sequence key used in Global scope. Ignored in Per-repository scope.',
    },
    {
      key: 'start_value',
      label: 'Start Value',
      type: 'integer',
      default: 1,
      min: 1,
      description: 'The first value issued for a sequence that has not been allocated from before.',
    },
  ],
  allocate,
  peek,
};
