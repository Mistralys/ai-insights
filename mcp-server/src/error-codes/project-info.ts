import { readFile, stat } from 'fs/promises';
import { dirname, basename, join, isAbsolute } from 'path';
import { readProjectName } from '../utils/read-project-name.js';
import type { RepositoryInfo } from './provider-api.js';

/**
 * Resolves the MAIN repository root for an arbitrary working directory,
 * without ever shelling out to `git`.
 *
 * `{@link RepositoryInfo}` is deliberately keyed to the MAIN checkout, not
 * to whichever worktree the caller happens to be standing in: every linked
 * worktree of one repository must resolve to the same `root_path` and
 * `folder_name`, so a provider scoping its sequence by repository (the
 * `file` provider's `scope: 'repository'`, §3 of the plan) never splits one
 * repository's sequence across its worktrees.
 *
 * Algorithm (follows git's documented repository layout, no subprocess):
 * 1. Walk upward from `cwdPath` until a directory containing `.git` is
 *    found. Returns `null` when the filesystem root is reached without one.
 * 2. When `.git` is a directory, that directory's parent is the root — this
 *    is already the main checkout.
 * 3. When `.git` is a file (a linked worktree or a submodule), its first
 *    line is `gitdir: {path}` (relative to the walked directory, or
 *    absolute). That path is the worktree's own git directory
 *    (`.git/worktrees/{name}` for a linked worktree, or the submodule's
 *    git directory for a submodule).
 *    - If that git directory contains a `commondir` file, the path it
 *      names (resolved relative to the git directory) is the shared git
 *      directory of the main checkout, and its parent is the main
 *      repository root.
 *    - Without a `commondir` (a submodule, or any read failure along the
 *      way), the walked directory is used as the root directly — there is
 *      no "more main" checkout to resolve to.
 * 4. `package_name` is resolved from the final root via
 *    {@link readProjectName}.
 *
 * @param cwdPath - Absolute path to start walking from (a directory).
 * @returns The resolved repository info, or `null` when `cwdPath` is not
 *   inside a git repository.
 */
export async function resolveRepositoryInfo(cwdPath: string): Promise<RepositoryInfo | null> {
  const walked = await findGitEntryDir(cwdPath);
  if (walked === null) {
    return null;
  }

  const { dir, gitEntryPath } = walked;
  const rootPath = await resolveRootPath(dir, gitEntryPath);
  const folderName = basename(rootPath);
  const packageName = await readProjectName(rootPath);

  return {
    root_path: rootPath,
    folder_name: folderName,
    package_name: packageName,
  };
}

/**
 * Walks upward from `startDir`, returning the first directory that contains
 * a `.git` entry (file or directory) along with that entry's path.
 */
async function findGitEntryDir(
  startDir: string
): Promise<{ dir: string; gitEntryPath: string } | null> {
  let current = startDir;

  for (;;) {
    const gitEntryPath = join(current, '.git');
    const exists = await pathExists(gitEntryPath);
    if (exists) {
      return { dir: current, gitEntryPath };
    }

    const parent = dirname(current);
    if (parent === current) {
      // Reached the filesystem root without finding `.git`.
      return null;
    }
    current = parent;
  }
}

/**
 * Resolves the main repository root for a directory `dir` whose `.git`
 * entry lives at `gitEntryPath`.
 *
 * - `.git` as a directory: `dir` itself is already the main root.
 * - `.git` as a file: follows `gitdir:` and, when present, `commondir` to
 *   the shared main checkout. Any read failure along the way falls back to
 *   `dir` without throwing.
 */
async function resolveRootPath(dir: string, gitEntryPath: string): Promise<string> {
  let entryStat;
  try {
    entryStat = await stat(gitEntryPath);
  } catch {
    return dir;
  }

  if (entryStat.isDirectory()) {
    return dir;
  }

  // `.git` is a file: a linked worktree or a submodule.
  let gitDirLine: string;
  try {
    const content = await readFile(gitEntryPath, 'utf-8');
    const match = content.match(/^gitdir:\s*(.+?)\s*$/m);
    if (match === null || match[1] === undefined) {
      return dir;
    }
    gitDirLine = match[1];
  } catch {
    return dir;
  }

  const gitDir = isAbsolute(gitDirLine) ? gitDirLine : join(dir, gitDirLine);

  // Without a `commondir` file (a submodule), the walked directory is the
  // root — there is no further "main checkout" to resolve to.
  const commonDirPath = join(gitDir, 'commondir');
  let commonDirLine: string;
  try {
    const content = await readFile(commonDirPath, 'utf-8');
    commonDirLine = content.trim();
    if (commonDirLine === '') {
      return dir;
    }
  } catch {
    return dir;
  }

  const sharedGitDir = isAbsolute(commonDirLine) ? commonDirLine : join(gitDir, commonDirLine);
  return dirname(sharedGitDir);
}

/** `true` when `path` exists (file, directory, or otherwise), `false` on any stat failure. */
async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
