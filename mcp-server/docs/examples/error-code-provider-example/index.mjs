/**
 * Example error-code provider — a minimal, working plugin you can copy as a
 * starting point. See ../../error-code-providers.md for the full guide this
 * example accompanies.
 *
 * Keeps a single incrementing counter in a local JSON file:
 * `{ "value": <integer> }`. No dependency on the server's own internal
 * modules — a plugin only ever needs to produce an object matching the
 * `ErrorCodeProvider` contract documented in the guide (and, for anyone
 * reading the server's own TypeScript source, `src/error-codes/provider-api.ts`).
 *
 * Deliberately simplified for clarity:
 * - No file locking. The built-in `file` provider (`src/error-codes/providers/file-provider.ts`)
 *   locks its counter file so two concurrent allocation requests never read
 *   the same "current" value — a real-world plugin expecting concurrent use
 *   should add equivalent locking of its own (e.g. via a small npm
 *   dependency in this folder's own `node_modules`, since a plugin folder
 *   can carry its own dependencies).
 * - No `test` hook. `peek` alone is enough for the GUI's "Test connection"
 *   button to fall back to (see the guide's "Writing a Plugin" section).
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';

/** Reads the current counter value; only an absent file starts a new sequence. */
async function readCounterValue(filePath) {
  let raw;
  try {
    raw = await readFile(filePath, 'utf-8');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  const parsed = JSON.parse(raw);
  if (!Number.isSafeInteger(parsed?.value) || parsed.value < 0) {
    throw new Error('Counter file must contain a non-negative safe integer value.');
  }
  return parsed.value;
}

/** Writes the counter value, creating the parent directory if needed. */
async function writeCounterValue(filePath, value) {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify({ value }, null, 2)}\n`, 'utf-8');
}

/**
 * Resolves the counter file path from this provider's settings: an explicit
 * `counter_file`, or `{ctx.data_dir}/counter.json` by default — `data_dir`
 * is a scratch directory the core creates for each provider's own use, so
 * zero configuration is required to start allocating.
 */
function resolveCounterFilePath(settings, ctx) {
  return settings.counter_file && settings.counter_file.length > 0
    ? settings.counter_file
    : join(ctx.data_dir, 'counter.json');
}

async function allocate(_request, ctx) {
  const filePath = resolveCounterFilePath(ctx.settings, ctx);
  const current = await readCounterValue(filePath);
  const next = (current ?? ctx.settings.start_value - 1) + 1;
  await writeCounterValue(filePath, next);
  ctx.log.info(`example-json-counter: allocated ${next} (${filePath})`);
  return { ok: true, value: next };
}

async function peek(_request, ctx) {
  const filePath = resolveCounterFilePath(ctx.settings, ctx);
  const current = await readCounterValue(filePath);
  const next = (current ?? ctx.settings.start_value - 1) + 1;
  return { ok: true, value: next };
}

export default {
  apiVersion: 1,
  id: 'example-json-counter',
  label: 'Example JSON Counter (documentation example)',
  description:
    'A minimal example error-code provider for plugin authors to copy. Keeps a single incrementing counter in a local JSON file — see docs/error-code-providers.md.',
  settings: [
    {
      key: 'counter_file',
      label: 'Counter File',
      type: 'path',
      default: '',
      description: "Absolute path to the counter JSON file. Leave empty to use this provider's own data_dir.",
    },
    {
      key: 'start_value',
      label: 'Start Value',
      type: 'integer',
      default: 1,
      min: 1,
      description: 'The first value issued when the counter file does not exist yet.',
    },
  ],
  allocate,
  peek,
};
