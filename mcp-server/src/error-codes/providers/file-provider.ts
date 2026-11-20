import { readFile } from 'fs/promises';
import { join } from 'path';
import { z } from 'zod';
import { atomicWriteJson } from '../../storage/atomic-writer.js';
import { withLock } from '../../storage/file-lock.js';
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

/** On-disk shape of a counter file: one monotonic value per key (a `counter_name` or a `repository.folder_name`). */
const CountersFileSchema = z.object({
  counters: z.record(z.string(), z.number().int()).default({}),
});

type CountersFile = z.infer<typeof CountersFileSchema>;

async function readCountersFileOrDefault(filePath: string): Promise<CountersFile> {
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf-8');
  } catch {
    return CountersFileSchema.parse({});
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return CountersFileSchema.parse({});
  }

  const result = CountersFileSchema.safeParse(parsed);
  return result.success ? result.data : CountersFileSchema.parse({});
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

/** Computes the next value for `key`, given the file currently on disk and the configured `start_value`. */
function nextValueFor(file: CountersFile, key: string, startValue: number): number {
  const current = file.counters[key] ?? startValue - 1;
  return current + 1;
}

async function allocate(request: AllocationRequest, ctx: ProviderContext): Promise<AllocationOutcome> {
  const settings = ctx.settings as unknown as FileProviderSettings;
  const location = resolveCounterLocation(settings, ctx, request.repository);
  if (!location.ok) {
    return { ok: false, reason: 'misconfigured', detail: location.detail };
  }

  const { filePath, key } = location;

  // Always lock `ctx.data_dir` — never the counter file's own directory.
  // `withLock` creates a `.lock` entry inside whatever directory it locks,
  // and a `{repo}/.error-codes.json` counter file would otherwise leave an
  // untracked `.lock` inside the user's repository.
  return withLock(ctx.data_dir, async () => {
    const file = await readCountersFileOrDefault(filePath);
    const next = nextValueFor(file, key, settings.start_value);
    file.counters[key] = next;
    await atomicWriteJson(filePath, file);
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
  // without acquiring the lock or writing anything.
  const file = await readCountersFileOrDefault(location.filePath);
  const next = nextValueFor(file, location.key, settings.start_value);
  return { ok: true, value: next };
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
        'Where the counter file is stored. Leave empty to use the default location. Supports a {repo} placeholder (e.g. "{repo}/.error-codes.json") to keep the sequence inside the repository itself.',
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
