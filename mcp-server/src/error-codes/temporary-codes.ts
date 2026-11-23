import { join } from 'path';
import { z } from 'zod';
import { atomicWriteJson } from '../storage/atomic-writer.js';
import { withLock } from '../storage/file-lock.js';
import { keepCorruptCopy, readJsonStateFile } from '../storage/json-state-file.js';

/**
 * The temporary-code log: `~/.ai-insights/error-codes/temporary-codes.json`.
 *
 * Owned entirely by the core and never visible to a provider — a provider
 * cannot influence the fallback guarantee this module exists to give. Every
 * temporary code is `{prefix}` followed by six zero-padded digits, counting
 * up from `1`; `000000` is reserved as the "MCP unavailable" placeholder
 * used elsewhere and is therefore never issued by this module.
 *
 * Fallback guarantee: this log is the last resort, so it must keep issuing and
 * must never reissue a code or drop history. A *missing* file is a new, empty
 * log. A file that exists but is corrupt (unparsable, a failing entry, or a
 * counter at or below a code already logged) is **recovered**: under the lock,
 * a byte-identical copy is kept as `temporary-codes.corrupt-{stamp}.json`,
 * every valid entry is retained, numbering continues above every counter still
 * visible in the file, and the original is replaced with one atomic write (it
 * is copied, never renamed, so unlocked readers in other processes never see
 * the file missing). The recovery is reported as a `warning`. A file that
 * cannot be *read* at all (e.g. `EACCES`) fails closed: issuing would mean
 * overwriting state that was never seen.
 */

/** File name for the temporary-code log, nested under `resolveErrorCodesDir()`. */
const TEMPORARY_CODES_FILENAME = 'temporary-codes.json';

/**
 * File mode for the temporary-code log (owner read/write only). Entries carry
 * `context`, `repository` and provider `detail` text, so the log is as
 * sensitive as `config.json` beside it. `atomicWriteJson` applies the mode on
 * every write, so a file written earlier with wider permissions is tightened
 * on its next issuance. No effect on Windows.
 */
const TEMPORARY_CODES_FILE_MODE = 0o600;

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

/** Describes how a log that exists was found to be corrupt. */
interface LogCorruption {
  /** Short human-readable reason, e.g. `not valid JSON (...)`. */
  reason: string;
  /** Number of entries the corrupt file claimed to hold; `null` when the file could not be parsed. */
  total: number | null;
  /** Number of entries that passed validation and were kept. */
  recovered: number;
}

/** A log read from disk: always usable, with `corruption` set when it had to be salvaged. */
interface TemporaryLogRead {
  file: TemporaryCodesFile;
  corruption?: LogCorruption;
}

/** Result of {@link issueTemporaryCode}. */
export interface IssuedTemporaryCode {
  /** The issued code (`prefix` + six zero-padded digits). */
  code: string;
  /** Set when the log was corrupt and had to be recovered before issuing; names the kept copy. */
  warning?: string;
}

/** Result of {@link listTemporaryCodes}. */
export interface TemporaryCodesListing {
  entries: TemporaryCodeEntry[];
  /** Set when the log is corrupt; the entries are then the recoverable ones. */
  warning?: string;
}

/** Matches every `"code": "..."` value in raw text, including text that is not valid JSON. */
const CODE_VALUE_PATTERN = /"code"\s*:\s*"([^"]*)"/g;

/** The counter a code ends with: its trailing six digits, or `null` when it does not end in six digits. */
function counterOfCode(code: string): number | null {
  const match = /(\d{6})$/.exec(code);
  return match ? Number.parseInt(match[1] as string, 10) : null;
}

/** Highest counter among the codes found in `raw` by a text scan, or `0` when none. */
function highestCounterInText(raw: string): number {
  let highest = 0;
  for (const match of raw.matchAll(CODE_VALUE_PATTERN)) {
    const counter = counterOfCode(match[1] as string);
    if (counter !== null && counter > highest) highest = counter;
  }
  return highest;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Builds a usable log out of a corrupt one.
 *
 * - Every `entries` item that passes {@link TemporaryCodeEntrySchema} is kept.
 * - `next_counter` is the maximum of `1`, the stored `next_counter` when it is
 *   a safe integer >= 1, and one more than every counter found by scanning the
 *   raw text for `"code"` values. The scan also covers text that is not valid
 *   JSON and codes written with a non-digit prefix by an earlier version.
 *
 * @param raw - The file's raw text.
 * @param value - The parsed JSON, or `undefined` when the text did not parse.
 * @param reason - Why the file is considered corrupt.
 */
function salvageTemporaryLog(raw: string, value: unknown, reason: string): { file: TemporaryCodesFile; corruption: LogCorruption } {
  const entries: TemporaryCodeEntry[] = [];
  let total: number | null = null;
  let storedCounter = 1;

  if (isPlainObject(value)) {
    const rawEntries = value['entries'];
    if (Array.isArray(rawEntries)) {
      total = rawEntries.length;
      for (const item of rawEntries) {
        const parsed = TemporaryCodeEntrySchema.safeParse(item);
        if (parsed.success) entries.push(parsed.data);
      }
    }
    const counter = value['next_counter'];
    if (typeof counter === 'number' && Number.isSafeInteger(counter) && counter >= 1) {
      storedCounter = counter;
    }
  }

  const nextCounter = Math.max(1, storedCounter, highestCounterInText(raw) + 1);
  return {
    file: { next_counter: nextCounter, entries },
    corruption: { reason, total, recovered: entries.length },
  };
}

/** Test seam for the salvage rules; not part of the public API. */
export const _internal = { salvageTemporaryLog };

/**
 * Reads the log. Missing means a new log; a corrupt file is salvaged (see
 * {@link salvageTemporaryLog}) and flagged in `corruption`; a file that cannot
 * be read at all throws, because nothing can be safely written over it.
 *
 * @throws {Error} `temporary-codes: cannot read {path} ({code})` for an I/O error other than `ENOENT`.
 */
async function readTemporaryLog(dir: string): Promise<TemporaryLogRead> {
  const path = resolveFilePath(dir);

  let state;
  try {
    state = await readJsonStateFile(path);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? 'unknown';
    throw new Error(`temporary-codes: cannot read ${path} (${code})`);
  }

  if (state.status === 'missing') {
    return { file: TemporaryCodesFileSchema.parse({}) };
  }
  if (state.status === 'unparsable') {
    // The parser's message is omitted: it quotes a snippet of the file, and the whole file is kept as a copy anyway.
    return salvageTemporaryLog(state.raw, undefined, 'not valid JSON');
  }

  const result = TemporaryCodesFileSchema.safeParse(state.value);
  if (!result.success) {
    return salvageTemporaryLog(state.raw, state.value, 'a field failed validation');
  }

  // A schema-valid file can still be inconsistent: a missing `next_counter` is
  // filled in as 1 by the schema default, which would reissue every logged code.
  const floor = highestCounterInText(state.raw) + 1;
  if (result.data.next_counter < floor) {
    return salvageTemporaryLog(state.raw, state.value, 'next_counter is missing or not above every logged code');
  }

  return { file: result.data };
}

/** Warning text for a recovery performed while issuing a code. */
function issueWarning(corruption: LogCorruption, copyName: string, nextCounter: number): string {
  const recovered = corruption.total === null
    ? 'No entries could be parsed.'
    : `${corruption.recovered} of ${corruption.total} logged entries were recovered.`;
  return `${TEMPORARY_CODES_FILENAME} was corrupt (${corruption.reason}); a copy was kept as ${copyName} and numbering continues from ${nextCounter}. ${recovered} Check the copy before deleting it.`;
}

/** Warning text for a corrupt log met while only listing. */
function listWarning(corruption: LogCorruption): string {
  return `${TEMPORARY_CODES_FILENAME} is corrupt (${corruption.reason}); showing ${corruption.recovered} recoverable entries. It will be repaired the next time a temporary code is issued.`;
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
 * A corrupt log is recovered inside the lock (see the module doc): a copy is
 * kept, valid entries are retained, numbering continues above every counter
 * visible in the file, and the result carries a `warning`. Because detection,
 * copy and repair all happen under the lock, a second caller that met the same
 * corrupt log waits, re-reads the repaired file, and does not recover again.
 *
 * @param dir - The error-codes state directory (`resolveErrorCodesDir()`).
 * @param prefix - The configured temporary-code prefix (e.g. `"777"`).
 * @param entry - The remaining fields to log alongside the issued code.
 * @throws {Error} When the counter has reached `999999` and cannot issue a next value.
 * @throws {Error} When the log exists but cannot be read (`temporary-codes: cannot read {path} ({code})`), or the lock cannot be acquired.
 */
export async function issueTemporaryCode(
  dir: string,
  prefix: string,
  entry: TemporaryCodeEntryInput
): Promise<IssuedTemporaryCode> {
  return withLock(dir, async () => {
    const path = resolveFilePath(dir);
    const { file, corruption } = await readTemporaryLog(dir);
    const n = file.next_counter;

    if (n > MAX_COUNTER || n <= RESERVED_ZERO) {
      throw new Error(
        `temporary-codes: counter exhausted — cannot issue a value beyond ${MAX_COUNTER}`
      );
    }

    let warning: string | undefined;
    if (corruption) {
      const copyName = await keepCorruptCopy(path);
      warning = issueWarning(corruption, copyName, n);
      process.stderr.write(`[temporary-codes] ${warning}\n`);
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

    await atomicWriteJson(path, next, { mode: TEMPORARY_CODES_FILE_MODE });
    return warning === undefined ? { code } : { code, warning };
  });
}

/**
 * Lists logged temporary-code entries, optionally filtered.
 *
 * @param dir - The error-codes state directory (`resolveErrorCodesDir()`).
 * @param filter - When supplied, only entries whose `context` or
 *   `repository` contains `filter` as a substring (case-sensitive) are
 *   returned. A `null` field never matches a non-empty filter.
 * @returns The entries, plus a `warning` when the log is corrupt (the entries
 *   are then the recoverable ones). Read-only and unlocked: it never copies or
 *   repairs the file, and sees either the old or the new complete file.
 */
export async function listTemporaryCodes(
  dir: string,
  filter?: string
): Promise<TemporaryCodesListing> {
  const { file, corruption } = await readTemporaryLog(dir);
  const warning = corruption ? listWarning(corruption) : undefined;

  const entries =
    filter === undefined || filter === ''
      ? file.entries
      : file.entries.filter(
          (e) =>
            (e.context !== null && e.context.includes(filter)) ||
            (e.repository !== null && e.repository.includes(filter))
        );

  return warning === undefined ? { entries } : { entries, warning };
}
