import { constants } from 'fs';
import { copyFile, readFile } from 'fs/promises';
import { basename, dirname, extname, join } from 'path';
import { hasErrorCode } from '../utils/node-errors.js';

/**
 * Shared read primitive for small JSON state files (counter file, temporary-code
 * log, error-code config).
 *
 * The rule it exists to enforce: **a missing file is not a broken file.** A
 * caller that answers every read failure with "start from defaults" will, on
 * its next write, destroy state it merely failed to read — a corrupt counter
 * file restarts a sequence, a corrupt log reissues old codes, one bad config
 * field wipes stored secrets. So this module tells the three cases apart and
 * leaves the policy for each to the calling store:
 *
 * - `missing`    — `ENOENT` only. Starting a new, empty state is correct.
 * - `parsed` / `unparsable` — the file was read; either it is JSON or it is not.
 *   Schema validation stays with the caller.
 * - any other I/O error (`EACCES`, `EISDIR`, `EIO`, …) is **rethrown
 *   unchanged**, an `ErrnoException` carrying `code`. The store can neither
 *   read nor safely overwrite such a file.
 *
 * Copy, never rename: {@link keepCorruptCopy} preserves a corrupt file by
 * copying it and leaves the original in place. The caller then replaces the
 * original with `atomicWriteJson` (temp file + rename), so the path is never
 * absent. Parallel processes of one user are routine; an unlocked reader in
 * another process (`listTemporaryCodes`, `loadErrorCodeConfig`, a provider's
 * `peek`) that met a renamed-away file would see `missing` and act on defaults.
 *
 * Nothing here writes to stdout (MCP STDIO discipline).
 */

/** Result of {@link readJsonStateFile}. */
export type JsonStateRead =
  | { status: 'missing' }
  | { status: 'parsed'; raw: string; value: unknown }
  | { status: 'unparsable'; raw: string; error: string };

/**
 * Reads and JSON-parses a state file.
 *
 * @param path - Absolute path of the state file.
 * @returns `missing` for `ENOENT`; `parsed` with the raw text and the parsed
 *   value; or `unparsable` with the raw text and the parser's message.
 * @throws {NodeJS.ErrnoException} For every read error other than `ENOENT`.
 */
export async function readJsonStateFile(path: string): Promise<JsonStateRead> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf-8');
  } catch (err) {
    if (hasErrorCode(err, 'ENOENT')) {
      return { status: 'missing' };
    }
    throw err;
  }

  try {
    return { status: 'parsed', raw, value: JSON.parse(raw) as unknown };
  } catch (err) {
    return { status: 'unparsable', raw, error: err instanceof Error ? err.message : String(err) };
  }
}

/** `YYYYMMDDTHHMMSSZ` — contains no `:`, so the resulting file name is valid on Windows. */
function formatStamp(now: Date): string {
  return now.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/[-:]/g, '');
}

/** Upper bound on collision retries; far above any realistic number of repairs in one second. */
const MAX_COPY_ATTEMPTS = 1000;

/**
 * Keeps a byte-identical copy of a corrupt state file beside it, named
 * `{name}.corrupt-{YYYYMMDDTHHMMSSZ}{ext}` (e.g. `temporary-codes.corrupt-20261120T160000Z.json`).
 *
 * The copy is exclusive (`COPYFILE_EXCL`): an existing file is never
 * overwritten, and a name collision retries with `-2`, `-3`, … appended to the
 * stamp. The original is neither renamed nor removed — see the module doc for
 * why — so the caller must replace it itself.
 *
 * @param path - Absolute path of the corrupt file.
 * @param now - Clock for the stamp; injectable for tests.
 * @returns The base name of the copy that was created.
 * @throws {Error} When the file cannot be copied, or no free name was found.
 */
export async function keepCorruptCopy(path: string, now: Date = new Date()): Promise<string> {
  const dir = dirname(path);
  const ext = extname(path);
  const stem = basename(path, ext);
  const stamp = formatStamp(now);

  for (let attempt = 1; attempt <= MAX_COPY_ATTEMPTS; attempt++) {
    const suffix = attempt === 1 ? '' : `-${attempt}`;
    const name = `${stem}.corrupt-${stamp}${suffix}${ext}`;
    try {
      await copyFile(path, join(dir, name), constants.COPYFILE_EXCL);
      return name;
    } catch (err) {
      if (hasErrorCode(err, 'EEXIST')) {
        continue;
      }
      throw err;
    }
  }

  throw new Error(`json-state-file: could not find a free name to keep a copy of ${path}`);
}
