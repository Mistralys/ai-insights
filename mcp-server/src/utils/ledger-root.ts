import { join, dirname, posix } from 'path';
import { fileURLToPath } from 'url';
import { readdir } from 'fs/promises';
import { assertSafeSegment, planFolderBasename } from './path-validator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Package root: from src/utils/ up two levels → mcp-server/
const serverDir = join(__dirname, '..', '..');

// Workspace root: from mcp-server/ up one level → ai-insights/
const workspaceRoot = join(serverDir, '..');

/** Absolute path to the workspace root directory. */
export const WORKSPACE_ROOT = workspaceRoot;

/** Absolute path to the orchestrator's live logs directory. */
export const ORCHESTRATOR_LOGS_DIR = join(workspaceRoot, 'orchestrator', 'logs');

/**
 * Returns the absolute path to the central ledger root directory.
 *
 * Resolution order:
 * 1. `--ledger-dir <path>` CLI argument — must be followed by an explicit path
 *    value. Providing the flag with no subsequent argument is a configuration
 *    error and will throw rather than silently falling back to the default.
 * 2. Default: `{serverDir}/storage/ledger/`
 *
 * @throws {Error} When `--ledger-dir` is present but not followed by a path.
 */
export function resolveLedgerRoot(): string {
  const args = process.argv;
  const flagIndex = args.indexOf('--ledger-dir');
  if (flagIndex !== -1) {
    // Next token must exist and must not itself be a flag
    if (flagIndex + 1 >= args.length || args[flagIndex + 1]!.startsWith('--')) {
      throw new Error(
        '--ledger-dir flag requires a path argument (e.g. --ledger-dir /data/ledger)'
      );
    }
    return args[flagIndex + 1] as string;
  }
  return join(serverDir, 'storage', 'ledger');
}

/**
 * Extracts the project slug (plan folder basename) from an absolute project path.
 * Delegates to planFolderBasename() from path-validator.
 */
export function projectSlugFromPath(projectPath: string): string {
  return planFolderBasename(projectPath);
}

/**
 * Derives the project root from an absolute plan folder (or file) path by
 * traversing ancestor directory segments to find the `docs/agents` anchor.
 *
 * The established convention is:
 *   {project-root}/docs/agents/plans/{slug}[/...]
 *
 * The function locates the first occurrence of the `docs` segment that is
 * immediately followed by `agents`, then returns the path of the directory
 * immediately above `docs`. This approach is resilient to plans being nested
 * at arbitrary depths below `docs/agents/plans/` and does not rely on a
 * fixed directory-level count.
 *
 * This function is pure — it performs no filesystem access.
 *
 * @param planPath - Absolute path to the plan folder (or a file inside it).
 *   Both forward-slash and backslash separators are accepted.
 * @returns The project root path, or `null` when no `docs/agents` anchor is
 *   found in the path.
 */
export function inferProjectRootFromPlanPath(planPath: string): string | null {
  // Normalize backslashes to forward slashes for cross-platform correctness
  const normalized = planPath.replace(/\\/g, '/');
  const segments = normalized.split('/');
  for (let i = 0; i < segments.length - 1; i++) {
    if (segments[i] === 'docs' && segments[i + 1] === 'agents') {
      // Rejoin segments before 'docs' to form the project root.
      // When the root is the filesystem root (e.g. '/docs/agents/...'),
      // slice(0, 0) is [] and ''.join('/') is '', so fall back to '/'.
      const rootSegments = segments.slice(0, i);
      return rootSegments.join('/') || '/';
    }
  }
  return null;
}

/**
 * Derives a filesystem-safe repository namespace key from an absolute plan folder path.
 *
 * Reuses the same derivation as `repository_name` enrichment in `initializeProject()`:
 * the basename of the project root inferred by walking 4 levels up from the plan path.
 *
 * The result is lowercased and validated against {@link assertSafeSegment}
 * (alphanumeric + hyphens, must start with alnum). Returns `'unknown'` when
 * the inferred name is empty, `'.'`, `'..'`, or fails validation.
 *
 * This function is pure — it performs no filesystem access.
 *
 * @param projectPath - Absolute path to the plan folder
 * @param resolvedRoot - Optional pre-resolved project root. When provided (and
 *   non-undefined), skips the internal `inferProjectRootFromPlanPath()` call.
 *   Pass `null` to indicate that no root could be resolved. Leave undefined
 *   (or omit) to let the function resolve the root itself.
 * @returns Lowercase repository name (e.g. `'ai-insights'`), or `'unknown'`
 */
export function deriveRepoName(projectPath: string, resolvedRoot?: string | null): string {
  if (!projectPath) {
    return 'unknown';
  }
  // inferProjectRootFromPlanPath already normalises backslashes to forward slashes
  const root = resolvedRoot !== undefined ? resolvedRoot : inferProjectRootFromPlanPath(projectPath);
  if (root === null) {
    return 'unknown';
  }
  const name = posix.basename(root).toLowerCase();
  if (!name || !assertSafeSegment(name)) {
    return 'unknown';
  }
  return name;
}

// ---------------------------------------------------------------------------
// Slug resolution helper
// ---------------------------------------------------------------------------

/**
 * Guards a single path segment against path-traversal and invalid characters.
 *
 * Throws for segments that are empty or invalid (lowercase alphanumeric + hyphens,
 * must start with an alphanumeric character). This rejects `/`, `..`, uppercase
 * letters, and any other non-conforming input.
 *
 * **Layer note:** A parallel `assertSafeSlug` exists in
 * `src/gui/handlers/run-log-handlers.ts` (GUI layer). Both delegate to
 * {@link assertSafeSegment} from `path-validator.ts` but throw different error types:
 * this function throws plain `Error` (storage layer); the GUI layer version
 * throws `ApiError`. The separation is intentional — the storage layer must not
 * depend on GUI error types.
 *
 * @throws {Error} When the segment is invalid.
 */
function assertSafeSlug(segment: string): void {
  if (!assertSafeSegment(segment)) {
    throw new Error(`Invalid path segment: '${segment}'.`);
  }
}

/**
 * Resolves a project storage directory from a bare slug or a qualified
 * `{repo}/{slug}` input.
 *
 * - **Qualified** (`{repo}/{slug}`): each segment is individually validated
 *   against {@link assertSafeSlug}, then `join(ledgerRoot, repo, slug)` is
 *   returned directly — no filesystem access is performed.
 * - **Bare slug**: scans all repo-namespace subdirectories of `ledgerRoot`
 *   (skipping dot-prefixed entries and non-directories). Returns the resolved
 *   path if exactly one match is found; throws an `AMBIGUOUS` error (listing
 *   all matching qualified paths) if more than one match exists; throws a
 *   `NOT_FOUND` error if no match exists.
 *
 * @param slugOrQualified - A bare slug (`2026-05-01-my-plan`) or a qualified
 *   `{repo}/{slug}` string (`ai-insights/2026-05-01-my-plan`).
 * @param ledgerRoot - Absolute path to the central ledger root.
 * @returns Absolute path to the project storage directory.
 * @throws {Error} On invalid segment format, ambiguous bare slug, or not-found bare slug.
 */
export async function resolveProjectDir(
  slugOrQualified: string,
  ledgerRoot: string
): Promise<string> {
  if (slugOrQualified.includes('/')) {
    // Qualified input: split at the first '/'
    const slashIndex = slugOrQualified.indexOf('/');
    const repo = slugOrQualified.slice(0, slashIndex);
    const slug = slugOrQualified.slice(slashIndex + 1);
    // Validate each segment separately — never pass a composite string to the guard
    assertSafeSlug(repo);
    assertSafeSlug(slug);
    return join(ledgerRoot, repo, slug);
  }

  // Bare slug: scan all repo-namespace subdirectories of ledgerRoot
  const slug = slugOrQualified;
  assertSafeSlug(slug);
  let topDirents: import('fs').Dirent[];
  try {
    topDirents = await readdir(ledgerRoot, { withFileTypes: true });
  } catch {
    topDirents = [];
  }

  const matches: string[] = [];
  for (const dirent of topDirents) {
    if (!dirent.isDirectory()) continue;
    if (dirent.name.startsWith('.')) continue;

    // Probe whether {repoName}/{slug} exists as a directory
    const candidatePath = join(ledgerRoot, dirent.name, slug);
    try {
      await readdir(candidatePath);
      matches.push(`${dirent.name}/${slug}`);
    } catch {
      // Directory does not exist or is not accessible — skip
    }
  }

  if (matches.length === 1) {
    const qualified = matches[0]!;
    const slashIndex = qualified.indexOf('/');
    const repo = qualified.slice(0, slashIndex);
    return join(ledgerRoot, repo, slug);
  }

  if (matches.length > 1) {
    throw new Error(
      `AMBIGUOUS: slug '${slug}' exists in ${matches.length} repo namespaces. ` +
        `Use a qualified '{repo}/{slug}' identifier to disambiguate.\n\nMatches:\n` +
        matches.map((m) => `  ${m}`).join('\n')
    );
  }

  throw new Error(
    `NOT_FOUND: project slug '${slug}' was not found in any repo namespace under '${ledgerRoot}'.`
  );
}
