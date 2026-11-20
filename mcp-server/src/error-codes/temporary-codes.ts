import { readFile } from 'fs/promises';
import { join } from 'path';
import { z } from 'zod';
import { atomicWriteJson } from '../storage/atomic-writer.js';
import { withLock } from '../storage/file-lock.js';

/**
 * The temporary-code log: `~/.ai-insights/error-codes/temporary-codes.json`.
 *
 * Owned entirely by the core and never visible to a provider — a provider
 * cannot influence the fallback guarantee this module exists to give. Every
 * temporary code is `{prefix}` followed by six zero-padded digits, counting
 * up from `1`; `000000` is reserved as the "MCP unavailable" placeholder
 * used elsewhere and is therefore never issued by this module.
 */

/** File name for the temporary-code log, nested under `resolveErrorCodesDir()`. */
const TEMPORARY_CODES_FILENAME = 'temporary-codes.json';

/** The highest counter value this log can issue before `issueTemporaryCode` throws. */
const MAX_COUNTER = 999999;

/** The last counter value reserved for the "MCP unavailable" placeholder; never issued. */
const RESERVED_ZERO = 0;

/** Zod schema for a single logged temporary-code entry. */
export const TemporaryCodeEntrySchema = z.object({
  code: z.string(),
  issued_at: z.string(),
  provider: z.string().nullable(),
  fallback_reason: z.string().nullable(),
  detail: z.string().nullable(),
  repository: z.string().nullable(),
  context: z.string().nullable(),
});

/** A single logged temporary-code entry, inferred from {@link TemporaryCodeEntrySchema}. */
export type TemporaryCodeEntry = z.infer<typeof TemporaryCodeEntrySchema>;

/** Fields the caller supplies to {@link issueTemporaryCode}; `code` and `issued_at` are computed by this module. */
export type TemporaryCodeEntryInput = Omit<TemporaryCodeEntry, 'code' | 'issued_at'>;

/** On-disk shape of the temporary-code log file. */
const TemporaryCodesFileSchema = z.object({
  next_counter: z.number().int().min(1).default(1),
  entries: z.array(TemporaryCodeEntrySchema).default([]),
});

type TemporaryCodesFile = z.infer<typeof TemporaryCodesFileSchema>;

function resolveFilePath(dir: string): string {
  return join(dir, TEMPORARY_CODES_FILENAME);
}

async function readFileOrDefault(dir: string): Promise<TemporaryCodesFile> {
  let raw: string;
  try {
    raw = await readFile(resolveFilePath(dir), 'utf-8');
  } catch {
    return TemporaryCodesFileSchema.parse({});
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return TemporaryCodesFileSchema.parse({});
  }

  const result = TemporaryCodesFileSchema.safeParse(parsed);
  return result.success ? result.data : TemporaryCodesFileSchema.parse({});
}

/**
 * Issues the next temporary error code, logs it, and returns the issued
 * code string.
 *
 * Runs the whole read-modify-write under `withLock(dir, …)` so concurrent
 * callers (in-process or across processes) never collide on the same
 * counter value. The returned code is `prefix + String(n).padStart(6, '0')`,
 * with `n` starting at `1` — `{prefix}000000` is reserved and never issued.
 * Once `n` would exceed `999999`, the counter is exhausted and this throws
 * rather than wrapping back to a value already issued.
 *
 * @param dir - The error-codes state directory (`resolveErrorCodesDir()`).
 * @param prefix - The configured temporary-code prefix (e.g. `"777"`).
 * @param entry - The remaining fields to log alongside the issued code.
 * @throws {Error} When the counter has reached `999999` and cannot issue a next value.
 */
export async function issueTemporaryCode(
  dir: string,
  prefix: string,
  entry: TemporaryCodeEntryInput
): Promise<string> {
  return withLock(dir, async () => {
    const file = await readFileOrDefault(dir);
    const n = file.next_counter;

    if (n > MAX_COUNTER || n <= RESERVED_ZERO) {
      throw new Error(
        `temporary-codes: counter exhausted — cannot issue a value beyond ${MAX_COUNTER}`
      );
    }

    const code = `${prefix}${String(n).padStart(6, '0')}`;
    const fullEntry: TemporaryCodeEntry = {
      ...entry,
      code,
      issued_at: new Date().toISOString(),
    };

    const next: TemporaryCodesFile = {
      next_counter: n + 1,
      entries: [...file.entries, fullEntry],
    };

    await atomicWriteJson(resolveFilePath(dir), next);
    return code;
  });
}

/**
 * Lists logged temporary-code entries, optionally filtered.
 *
 * @param dir - The error-codes state directory (`resolveErrorCodesDir()`).
 * @param filter - When supplied, only entries whose `context` or
 *   `repository` contains `filter` as a substring (case-sensitive) are
 *   returned. A `null` field never matches a non-empty filter.
 */
export async function listTemporaryCodes(
  dir: string,
  filter?: string
): Promise<TemporaryCodeEntry[]> {
  const file = await readFileOrDefault(dir);
  if (filter === undefined || filter === '') {
    return file.entries;
  }

  return file.entries.filter(
    (e) =>
      (e.context !== null && e.context.includes(filter)) ||
      (e.repository !== null && e.repository.includes(filter))
  );
}
