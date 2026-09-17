/**
 * Project-side declaration storage (`.ledger/settings.json`).
 *
 * This module is the filesystem-facing counterpart to the pure shapes defined
 * in `src/schema/project-declaration.ts`: locating a project's declared
 * `.ledger/` root, loading and merging its settings, and resolving safe
 * output paths beneath that root.
 *
 * A plain-function module, per the `repository-registry.ts` /
 * `repository-lookup.ts` pattern — no class, no shared mutable state.
 */

import { readFile } from 'fs/promises';
import { isAbsolute, join, relative, resolve } from 'path';
import {
  DEFAULT_OUTPUT_PATHS,
  ProjectSettingsLocalSchema,
  ProjectSettingsSchema,
  type OutputId,
  type ProjectSettings,
} from '../schema/project-declaration.js';

/** Directory name that holds the declaration files, relative to a project root. */
const LEDGER_DIR_NAME = '.ledger';

/** Filename for the base declaration file. */
const SETTINGS_FILENAME = 'settings.json';

/** Filename for the machine-local override file. */
const SETTINGS_LOCAL_FILENAME = 'settings.local.json';

/** Filename for the (optional, hand-authored) readme inside `.ledger/`. */
const README_FILENAME = 'README.md';

/**
 * The three filenames reserved for the declaration folder's own files.
 * `resolveOutputPath()` rejects any output path that resolves to one of
 * these — an output must never overwrite the declaration or its readme.
 */
const RESERVED_LEDGER_FILENAMES = [SETTINGS_FILENAME, SETTINGS_LOCAL_FILENAME, README_FILENAME] as const;

/**
 * Maximum number of ancestor directories `findProjectRoot()` will walk
 * before giving up and returning `null`. Bounds the walk against
 * pathological inputs (e.g. a symlink cycle surfaced as a very deep path)
 * without relying on filesystem-root detection alone.
 */
const MAX_ANCESTOR_DEPTH = 64;

/**
 * Walks ancestor directories from `startPath` (inclusive) looking for a
 * `.ledger/settings.json` file, and returns the nearest directory that
 * contains one.
 *
 * This is the **single** root-detection contract for every consumer —
 * the identity resolver and the `ai-insights ledger` CLI verbs alike.
 * There is no plan-path fallback branch: `inferProjectRootFromPlanPath()`
 * (`utils/ledger-root.ts`) remains a separate, pure, filesystem-free helper
 * used only for the *derived* naming tier, not for locating a declared root.
 *
 * The walk is bounded by {@link MAX_ANCESTOR_DEPTH}. Reaching the
 * filesystem root (where `dirname(dir) === dir`) also stops the walk.
 *
 * @param startPath - Absolute path to start the walk from (a project root,
 *   a nested plan folder, or any directory within a project checkout).
 * @returns The nearest ancestor directory containing `.ledger/settings.json`,
 *   or `null` when no ancestor (within the depth bound) has one.
 */
export async function findProjectRoot(startPath: string): Promise<string | null> {
  let current = resolve(startPath);

  for (let depth = 0; depth < MAX_ANCESTOR_DEPTH; depth++) {
    const candidate = join(current, LEDGER_DIR_NAME, SETTINGS_FILENAME);
    if (await fileExists(candidate)) {
      return current;
    }

    const parent = resolve(current, '..');
    if (parent === current) {
      // Reached the filesystem root — nowhere further to walk.
      return null;
    }
    current = parent;
  }

  return null;
}

/**
 * Returns `true` when `path` exists and is readable as a regular file
 * (or is otherwise accessible — this does not distinguish files from
 * directories, since a `.ledger/settings.json` collision with a directory
 * of the same name will surface as a parse failure in `loadProjectDeclaration()`).
 */
async function fileExists(path: string): Promise<boolean> {
  try {
    await readFile(path, 'utf-8');
    return true;
  } catch {
    return false;
  }
}

/**
 * Result of `loadProjectDeclaration()` — a discriminated union over three
 * states, deliberately distinct from `loadRegistry()`'s lossy-fallback
 * contract (see the module doc in `repository-registry.ts`): an absent
 * registry is a normal first-run state, but a malformed hand-authored
 * declaration is always a mistake that must surface to the caller rather
 * than being silently swallowed.
 */
export type ProjectDeclarationResult =
  | { kind: 'not_declared' }
  | {
      kind: 'declared';
      /** The merged settings: `settings.json` with `settings.local.json` deep-merged over it. */
      settings: ProjectSettings;
      /** Absolute paths of the files that contributed to `settings`. */
      sourcePaths: { settings: string; local: string | null };
    }
  | { kind: 'invalid'; errors: string[] };

/**
 * Loads and merges a project's declaration from `{projectRoot}/.ledger/`.
 *
 * - Missing `settings.json` → `{ kind: 'not_declared' }`.
 * - Malformed JSON, a schema failure, or an unknown `schema_version` in
 *   either file → `{ kind: 'invalid', errors }`.
 * - `settings.local.json` carrying `repository_id` → `{ kind: 'invalid' }`,
 *   with an error naming the file (local overrides may not redirect a
 *   project's declared identity — see the schema's doc comment).
 * - Otherwise → `{ kind: 'declared', settings, sourcePaths }`, where
 *   `settings.outputs` has `settings.local.json`'s `outputs` deep-merged
 *   (per output id, per field) over `settings.json`'s.
 *
 * @param projectRoot - Absolute path to the directory containing `.ledger/`
 *   (typically the return value of `findProjectRoot()`).
 */
export async function loadProjectDeclaration(projectRoot: string): Promise<ProjectDeclarationResult> {
  const settingsPath = join(projectRoot, LEDGER_DIR_NAME, SETTINGS_FILENAME);
  const localPath = join(projectRoot, LEDGER_DIR_NAME, SETTINGS_LOCAL_FILENAME);

  let baseRaw: string;
  try {
    baseRaw = await readFile(settingsPath, 'utf-8');
  } catch {
    return { kind: 'not_declared' };
  }

  let baseParsed: unknown;
  try {
    baseParsed = JSON.parse(baseRaw);
  } catch (error) {
    return { kind: 'invalid', errors: [`${settingsPath}: malformed JSON — ${(error as Error).message}`] };
  }

  const baseResult = ProjectSettingsSchema.safeParse(baseParsed);
  if (!baseResult.success) {
    return { kind: 'invalid', errors: formatZodErrors(settingsPath, baseResult.error) };
  }
  const baseSettings = baseResult.data;

  // No local override file — the base settings are the final settings.
  let localRaw: string | null = null;
  try {
    localRaw = await readFile(localPath, 'utf-8');
  } catch {
    return {
      kind: 'declared',
      settings: baseSettings,
      sourcePaths: { settings: settingsPath, local: null },
    };
  }

  let localParsed: unknown;
  try {
    localParsed = JSON.parse(localRaw);
  } catch (error) {
    return { kind: 'invalid', errors: [`${localPath}: malformed JSON — ${(error as Error).message}`] };
  }

  // Reject a local file carrying repository_id before schema validation, so
  // the error names the field explicitly rather than surfacing as a generic
  // "unrecognized key" from .strict().
  if (
    typeof localParsed === 'object' &&
    localParsed !== null &&
    !Array.isArray(localParsed) &&
    'repository_id' in localParsed
  ) {
    return {
      kind: 'invalid',
      errors: [
        `${localPath}: must not contain "repository_id" — a local override cannot redirect a project's declared identity`,
      ],
    };
  }

  const localResult = ProjectSettingsLocalSchema.safeParse(localParsed);
  if (!localResult.success) {
    return { kind: 'invalid', errors: formatZodErrors(localPath, localResult.error) };
  }
  const localSettings = localResult.data;

  const mergedOutputs = {
    ...baseSettings.outputs,
    ...Object.fromEntries(
      Object.entries(localSettings.outputs ?? {}).map(([outputId, localConfig]) => {
        const baseConfig = baseSettings.outputs?.[outputId as OutputId];
        const merged = { ...baseConfig, ...localConfig };
        // `localConfig.enabled` is `undefined` (not fabricated as `false`)
        // when settings.local.json omits the field — see the doc comment
        // on OutputConfigLocalSchema. Apply the `false` default only now,
        // to the merged result, so an omitted local `enabled` preserves
        // whatever the base declared rather than always winning the merge.
        return [outputId, { ...merged, enabled: merged.enabled ?? false }];
      })
    ),
  };

  const mergedSettings: ProjectSettings = {
    ...baseSettings,
    outputs: Object.keys(mergedOutputs).length > 0 ? mergedOutputs : undefined,
  };

  return {
    kind: 'declared',
    settings: mergedSettings,
    sourcePaths: { settings: settingsPath, local: localPath },
  };
}

/** Formats a `ZodError` into human-readable `{path}: {field} - {message}` strings. */
function formatZodErrors(filePath: string, error: { issues: Array<{ path: (string | number)[]; message: string }> }): string[] {
  return error.issues.map((issue) => {
    const field = issue.path.length > 0 ? issue.path.join('.') : '(root)';
    return `${filePath}: ${field} - ${issue.message}`;
  });
}

/**
 * Result of `resolveOutputPath()` — either an accepted absolute path, or a
 * rejection naming the reason. Mirrors `loadProjectDeclaration()`'s
 * discriminated-union style so callers branch on `kind` rather than on
 * thrown exceptions for an expected, user-triggerable rejection class.
 */
export type ResolvedOutputPath = { kind: 'ok'; path: string } | { kind: 'rejected'; reason: string };

/**
 * Resolves the absolute filesystem path for a declared output, applying the
 * write-consent boundary this feature is built on (see the plan's "Why a
 * declaration file rather than a registry-side path field" rationale).
 *
 * - Defaults to `DEFAULT_OUTPUT_PATHS[outputId]` when `settings` does not
 *   override the output's `path`.
 * - Rejects an absolute path (the declared path is always relative to
 *   `projectRoot`).
 * - Rejects any path that escapes `projectRoot` after normalisation
 *   (traversal via `..`, resolved against `projectRoot`).
 * - Rejects each of the three reserved `.ledger/` filenames
 *   (`settings.json`, `settings.local.json`, `README.md`) so an output can
 *   never overwrite the declaration it was configured by.
 *
 * @param projectRoot - Absolute path to the project root (declaration owner).
 * @param outputId - The output id being resolved (e.g. `'strategic-vision'`).
 * @param settings - The merged declaration settings (or `undefined` to use
 *   the default path unconditionally).
 */
export function resolveOutputPath(
  projectRoot: string,
  outputId: OutputId,
  settings: ProjectSettings | undefined
): ResolvedOutputPath {
  const declaredPath = settings?.outputs?.[outputId]?.path ?? DEFAULT_OUTPUT_PATHS[outputId];

  if (isAbsolute(declaredPath)) {
    return { kind: 'rejected', reason: `Output path '${declaredPath}' must be relative to the project root, not absolute.` };
  }

  const resolvedRoot = resolve(projectRoot);
  const resolvedPath = resolve(resolvedRoot, declaredPath);
  const relativeToRoot = relative(resolvedRoot, resolvedPath);

  if (relativeToRoot.startsWith('..') || isAbsolute(relativeToRoot)) {
    return {
      kind: 'rejected',
      reason: `Output path '${declaredPath}' escapes the project root.`,
    };
  }

  for (const reservedFilename of RESERVED_LEDGER_FILENAMES) {
    const reservedPath = resolve(resolvedRoot, LEDGER_DIR_NAME, reservedFilename);
    // Compared case-insensitively: both macOS (APFS) and Windows (NTFS) are
    // case-insensitive by default, so a differently-cased declared path
    // (e.g. '.ledger/SETTINGS.JSON') resolves to the same file on disk as
    // the reserved name and must be rejected identically.
    if (resolvedPath.toLowerCase() === reservedPath.toLowerCase()) {
      return {
        kind: 'rejected',
        reason: `Output path '${declaredPath}' resolves to the reserved declaration file '${LEDGER_DIR_NAME}/${reservedFilename}'.`,
      };
    }
  }

  return { kind: 'ok', path: resolvedPath };
}
