/**
 * Sync choke-point: the single function that owns every write into a
 * consumer project's declared `.ledger/` outputs.
 *
 * This module is the plan's single security-relevant enforcement point for
 * the D1 consent invariant ("the ledger writes into a project only inside
 * `.ledger/` or a declared output path"). Every output id, every mode
 * (`write` / `check`), and every disabled-output cleanup decision routes
 * through {@link syncProjectOutputs}, so the write set is a testable
 * property of one function rather than a convention each new output must
 * remember (plan Rationale § "Why one sync choke-point").
 */

import { readFile, unlink, realpath, stat } from 'fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'path';
import {
  DEFAULT_OUTPUT_PATHS,
  OUTPUT_IDS,
  type OutputId,
  type ProjectSettings,
} from '../schema/project-declaration.js';
import type { RepositoryEntry } from '../schema/repository-registry.js';
import { resolveOutputPath } from '../storage/project-declaration.js';
import { atomicWriteText } from '../storage/atomic-writer.js';
import {
  parseGeneratedHeader,
  renderStrategicVision,
  renderStrategicVisionBody,
  visionHash,
} from './strategic-vision.js';

/**
 * `write` performs every I/O decision it computes (writes, removals).
 * `check` computes the identical classification but performs no I/O at
 * all — see {@link SyncOutputRecord.stale} for how callers read the result.
 */
export type SyncMode = 'write' | 'check';

/**
 * The five possible classifications for a single output's sync outcome.
 *
 * In `write` mode, `kind` names the I/O this call actually performed. In
 * `check` mode, no I/O occurs and `kind` instead names the classification
 * that a `write`-mode call would have performed — callers that need a
 * simple "does anything need to change" signal should read
 * {@link SyncOutputRecord.stale} rather than branching on `kind` directly.
 */
export type SyncOutcomeKind = 'written' | 'unchanged' | 'removed' | 'skipped' | 'blocked';

/**
 * One structured record per known output id, returned by
 * {@link syncProjectOutputs}.
 */
export interface SyncOutputRecord {
  outputId: OutputId;
  /**
   * The resolved absolute path this output was evaluated against, or `null`
   * when `resolveOutputPath()` itself rejected the declared/default path
   * (e.g. an absolute or traversal-escaping override) before any
   * allowlist or I/O decision could be made.
   */
  path: string | null;
  kind: SyncOutcomeKind;
  /**
   * `true` when this output's on-disk state does not currently match what
   * `write` mode would produce — a missing file, a stale hash/body, or a
   * hand-authored file blocking a would-be write. `false` for `unchanged`,
   * `skipped` (disabled, nothing on disk), and a disabled output's
   * `removed`/would-be-`removed` classification (disabled outputs are not
   * "stale" in the AC-12 sense; that sense only applies to enabled outputs).
   */
  stale: boolean;
  /** Present on `blocked` records; explains what stopped the write or removal. */
  reason?: string;
}

export interface SyncProjectOutputsParams {
  /** Absolute path to the project root that owns the `.ledger/` declaration. */
  projectRoot: string;
  /** The project's merged declaration settings, or `undefined` for an undeclared project (every output resolves to its default, disabled state). */
  settings: ProjectSettings | undefined;
  /** The repository registry entry whose data outputs are rendered from. */
  entry: RepositoryEntry;
  mode: SyncMode;
}

/**
 * Renders every known output id's file content for a given `entry` and
 * `generatedAt` timestamp.
 *
 * A `switch` over {@link OUTPUT_IDS}'s single current member rather than a
 * lookup table — `OUTPUT_IDS` has exactly one entry today (`v1 ships exactly
 * one member`, per the schema's doc comment) and every output renders from
 * the same `RepositoryEntry` shape, so a table would carry no more
 * information than the switch's exhaustiveness check already provides. The
 * `never` branch below fails to compile if `OUTPUT_IDS` ever grows without a
 * matching case here.
 */
function renderOutput(
  outputId: OutputId,
  entry: RepositoryEntry,
  generatedAt: string
): { hash: string; body: string; full: string } {
  switch (outputId) {
    case 'strategic-vision': {
      return {
        hash: visionHash(entry.vision),
        body: renderStrategicVisionBody(entry),
        full: renderStrategicVision(entry, generatedAt),
      };
    }
    default: {
      const exhaustive: never = outputId;
      throw new Error(`No renderer registered for output id '${String(exhaustive)}'.`);
    }
  }
}

/**
 * Reads a file's text if it exists, or returns `null` for a missing file.
 * Any other filesystem error (permissions, a directory at that path, etc.)
 * propagates — those are not the "normal, expected absence" case this
 * helper exists to collapse.
 */
async function readFileIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

/**
 * Defense-in-depth invariant check for the D1 consent allowlist.
 *
 * `resolveOutputPath()` already guarantees its return value is
 * `projectRoot`-relative, non-traversing, and not one of the reserved
 * `.ledger/` filenames — but the allowlist this function asserts
 * (`.ledger/**` plus a *declared* output path) is specifically "whatever
 * `resolveOutputPath()` computed from `settings`/`DEFAULT_OUTPUT_PATHS`",
 * so this re-derives that same expected value and throws if a resolved path
 * ever diverges from it. This should never trigger given the current
 * implementation; it exists so a future refactor that computes a path some
 * other way fails loudly here rather than silently writing outside the
 * allowlist (AC-13).
 */
function assertAllowlisted(
  projectRoot: string,
  outputId: OutputId,
  settings: ProjectSettings | undefined,
  resolvedPath: string
): void {
  const declaredPath = settings?.outputs?.[outputId]?.path ?? DEFAULT_OUTPUT_PATHS[outputId];
  const expectedPath = resolve(projectRoot, declaredPath);
  if (expectedPath !== resolvedPath) {
    throw new Error(
      `Internal error: resolved output path '${resolvedPath}' for output '${outputId}' does not match ` +
        `the declared/default allowlist entry '${expectedPath}'. Refusing to proceed.`
    );
  }
}

/**
 * Re-validates a resolved output path against the *real* (symlink-resolved)
 * filesystem location of `projectRoot`, guarding a gap `resolveOutputPath()`/
 * `assertAllowlisted()` cannot close on their own: both validate lexically
 * (`path.resolve()`/`path.relative()` on the path *string*), so a symlink
 * planted at any intermediate path segment under an allowlisted path (e.g.
 * `.ledger/escape -> /somewhere/outside`) resolves, lexically, to a path
 * that still reads as inside `projectRoot` while the actual filesystem
 * write lands outside it entirely — the exact D1 consent violation AC-13
 * exists to prevent.
 *
 * Since `targetPath` itself may not exist yet (the common "about to write"
 * case), this walks up to the deepest *existing* ancestor of `targetPath`
 * — following any symlink at that ancestor via `fs.realpath()` — and
 * confirms the real path stays within the real path of `projectRoot`. A
 * symlink anywhere along the way (including at the target itself, for an
 * already-written file) is caught by this walk, since `fs.realpath()`
 * resolves every symlink component in the path it is given.
 */
async function assertRealPathWithinRoot(
  projectRoot: string,
  targetPath: string
): Promise<{ ok: true } | { ok: false; reason: string }> {
  let realRoot: string;
  try {
    realRoot = await realpath(resolve(projectRoot));
  } catch (error) {
    return {
      ok: false,
      reason: `Project root '${projectRoot}' could not be resolved on disk: ${(error as Error).message}`,
    };
  }

  let current = targetPath;
  for (;;) {
    let realCurrent: string;
    try {
      realCurrent = await realpath(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
      const parent = dirname(current);
      if (parent === current) {
        return {
          ok: false,
          reason: `Could not resolve any existing ancestor of '${targetPath}' against the project root.`,
        };
      }
      current = parent;
      continue;
    }

    const relativeToRoot = relative(realRoot, realCurrent);
    if (relativeToRoot === '..' || relativeToRoot.startsWith(`..${sep}`) || isAbsolute(relativeToRoot)) {
      return {
        ok: false,
        reason: `Resolved path '${targetPath}' escapes the real (symlink-resolved) project root via '${current}'.`,
      };
    }
    return { ok: true };
  }
}

/**
 * Rejects a resolved path that is (or, once ancestors are followed,
 * resolves to) an existing directory. `readFileIfExists()` only swallows
 * `ENOENT`; reading a directory as text throws `EISDIR`, and the same
 * applies to `unlink()` on the disabled-output removal path and to
 * `atomicWriteText()`'s own write/rename — none of those should ever be
 * reached for a directory-shaped output (e.g. a declared path of `'.'`,
 * which resolves to `projectRoot` itself). Checked once, up front, via
 * `fs.stat()` rather than caught piecemeal at each call site.
 */
async function directoryBlockReason(path: string): Promise<string | null> {
  try {
    const info = await stat(path);
    if (info.isDirectory()) {
      return `Resolved path '${path}' is a directory, not a file — refusing to read, write, or remove it.`;
    }
    return null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

/** Syncs a single output id and returns its record. */
async function syncOneOutput(
  projectRoot: string,
  settings: ProjectSettings | undefined,
  entry: RepositoryEntry,
  outputId: OutputId,
  mode: SyncMode
): Promise<SyncOutputRecord> {
  const resolved = resolveOutputPath(projectRoot, outputId, settings);
  if (resolved.kind === 'rejected') {
    return { outputId, path: null, kind: 'blocked', stale: false, reason: resolved.reason };
  }
  const path = resolved.path;
  assertAllowlisted(projectRoot, outputId, settings, path);

  const realPathCheck = await assertRealPathWithinRoot(projectRoot, path);
  if (!realPathCheck.ok) {
    return { outputId, path, kind: 'blocked', stale: false, reason: realPathCheck.reason };
  }

  const directoryReason = await directoryBlockReason(path);
  if (directoryReason !== null) {
    return { outputId, path, kind: 'blocked', stale: false, reason: directoryReason };
  }

  const enabled = settings?.outputs?.[outputId]?.enabled ?? false;
  const existingText = await readFileIfExists(path);
  const existingHeader = existingText !== null ? parseGeneratedHeader(existingText) : null;
  const isUnmarkedExisting = existingText !== null && existingHeader === null;

  if (!enabled) {
    if (existingText === null) {
      return { outputId, path, kind: 'skipped', stale: false };
    }
    if (isUnmarkedExisting) {
      return {
        outputId,
        path,
        kind: 'blocked',
        stale: false,
        reason: `An existing file at '${path}' carries no ai-insights ledger sync marker and was left untouched — it may be a hand-authored file.`,
      };
    }
    // Marked file, output disabled: remove it (write mode) or report the
    // pending removal without performing it (check mode).
    if (mode === 'write') {
      await unlink(path);
    }
    return { outputId, path, kind: 'removed', stale: false };
  }

  // Output enabled.
  const generatedAt = new Date().toISOString();
  const rendered = renderOutput(outputId, entry, generatedAt);

  if (existingText === null) {
    if (mode === 'write') {
      await atomicWriteText(path, rendered.full);
    }
    return { outputId, path, kind: 'written', stale: true };
  }

  if (isUnmarkedExisting) {
    return {
      outputId,
      path,
      kind: 'blocked',
      stale: true,
      reason: `An existing file at '${path}' carries no ai-insights ledger sync marker and was left untouched — it may be a hand-authored file.`,
    };
  }

  // Marked file — the idempotence check compares the parsed vision-hash
  // *and* the parsed body against what a fresh render would produce.
  // generated-at is deliberately excluded from both sides of this
  // comparison (plan step 7) so a re-sync with no vision change reports
  // `unchanged` and leaves the file byte-identical, timestamp included.
  const upToDate = existingHeader!.visionHash === rendered.hash && existingHeader!.body === rendered.body;
  if (upToDate) {
    return { outputId, path, kind: 'unchanged', stale: false };
  }

  if (mode === 'write') {
    await atomicWriteText(path, rendered.full);
  }
  return { outputId, path, kind: 'written', stale: true };
}

/**
 * Syncs every known output id for a declared project against the current
 * ledger state, per the D1 consent model: only files inside `.ledger/` or
 * at a declared output path are ever created, overwritten, or removed.
 *
 * For each of {@link OUTPUT_IDS}, this:
 * - resolves the output's path via `resolveOutputPath()` and asserts it
 *   against the allowlist ({@link assertAllowlisted}), then re-validates the
 *   real (symlink-resolved) filesystem location against `projectRoot`
 *   ({@link assertRealPathWithinRoot}) and rejects a directory-shaped
 *   resolved path ({@link directoryBlockReason}) before any I/O;
 * - when the output is enabled, renders it and compares the existing file's
 *   parsed `vision-hash` and body against a fresh render before deciding
 *   whether to write;
 * - when the output is disabled, removes an existing marker-carrying file
 *   and leaves an unmarked one untouched, reporting `blocked`;
 * - never touches a file lacking the exact {@link MARKER} header line,
 *   whether the output is enabled or disabled;
 * - in `check` mode, performs no filesystem writes or removals at all and
 *   reports the classification and staleness it would have produced.
 *
 * Every write goes through `atomicWriteText()` — no other write path exists
 * in this module.
 */
export async function syncProjectOutputs(params: SyncProjectOutputsParams): Promise<SyncOutputRecord[]> {
  const { projectRoot, settings, entry, mode } = params;
  const records: SyncOutputRecord[] = [];
  for (const outputId of OUTPUT_IDS) {
    records.push(await syncOneOutput(projectRoot, settings, entry, outputId, mode));
  }
  return records;
}
