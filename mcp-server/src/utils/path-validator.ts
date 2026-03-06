import { basename } from 'path';
import { LedgerStore } from '../storage/ledger-store.js';
import type { ProjectMeta } from '../schema/project-meta.js';
import { formatRelativeTime } from './timestamp.js';

// Pattern: YYYY-MM-DD followed by a hyphen and at least one character
// Example: 2026-02-16-technical-debt-cleanup
const planFolderPattern = /^\d{4}-\d{2}-\d{2}-.+$/;

/**
 * Extracts the plan folder basename from the given project path and validates
 * that it matches the {YYYY-MM-DD}-{project-name} naming convention.
 *
 * @param projectPath - The absolute path to the plan folder
 * @returns The basename of the folder
 * @throws {Error} if the basename does not match the expected pattern
 */
export function planFolderBasename(projectPath: string): string {
  const normalised = projectPath.replace(/\\/g, '/');
  const folderName = basename(normalised);
  if (!planFolderPattern.test(folderName)) {
    throw new Error(
      `Invalid project path format. The path should end with a plan folder in the format "{YYYY-MM-DD}-{project-name}".\n\n` +
      `Current folder: "${folderName}"\n` +
      `Expected pattern: YYYY-MM-DD-{project-name}\n` +
      `Example: "2026-02-16-technical-debt-cleanup"\n\n` +
      `It looks like you may have provided the project root path instead of the plan-specific path.\n` +
      `The correct path should be something like:\n` +
      `{project-root}/docs/agents/plans/{YYYY-MM-DD}-{project-name}`
    );
  }
  return folderName;
}

/**
 * Validates that a project path ends with a valid plan folder pattern: {YYYY-MM-DD}-{project-name}
 * 
 * @param projectPath - The absolute path to validate
 * @returns An object with `isValid` boolean and optional `error` message
 */
export function validatePlanPath(projectPath: string): { isValid: boolean; error?: string } {
  try {
    planFolderBasename(projectPath);
    return { isValid: true };
  } catch (err) {
    return {
      isValid: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Resolves the project path from tool arguments that accept either
 * `project_path` (explicit) or `cwd_path` (auto-detect via ledger lookup).
 *
 * Resolution rules:
 * - `project_path` provided → validate format, return it (original behavior).
 * - Only `cwd_path` provided → call `LedgerStore.detectProjectByCwd`, return `meta.plan_path`.
 * - Neither provided → throw with a clear error.
 *
 * @throws {Error} on validation failure, AMBIGUOUS match, or NOT_FOUND.
 * Callers should wrap in try/catch and return the error as an MCP error response.
 */
export async function resolveProjectPath(args: {
  project_path?: string;
  cwd_path?: string;
  [key: string]: unknown;
}): Promise<string> {
  // Mutual exclusivity guard (moved from Zod .refine() — see bug report 2026-03-05)
  if (args.project_path && args.cwd_path) {
    throw new Error(MUTUAL_EXCLUSIVITY_PATH_MSG);
  }

  if (args.project_path) {
    // Validate format. planFolderBasename throws on invalid pattern.
    planFolderBasename(args.project_path);
    return args.project_path;
  }

  if (args.cwd_path) {
    const result = await LedgerStore.detectProjectByCwd(args.cwd_path);

    if (result.status === 'FOUND') {
      return result.meta.plan_path;
    }

    if (result.status === 'AMBIGUOUS') {
      const candidates = formatCandidateList(result.best, result.unlikely);
      throw new Error(
        `Multiple projects match the provided cwd_path. Pass explicit project_path to disambiguate.\n\nCandidates:\n${candidates}`
      );
    }

    // NOT_FOUND
    throw new Error(
      `No project found for cwd_path "${args.cwd_path}". ` +
      `Ensure the project has been initialized with ledger_initialize_project ` +
      `and that the provided path is inside the project root.`
    );
  }

  throw new Error('Either project_path or cwd_path is required.');
}

/**
 * Zod refinement predicate: enforces that `project_path` and `cwd_path` are mutually exclusive.
 * At most one may be provided — passing both is an error.
 *
 * Usage: `someSchema.refine(mutuallyExclusivePaths, { message: MUTUAL_EXCLUSIVITY_PATH_MSG })`
 */
export const mutuallyExclusivePaths = (args: {
  project_path?: string | null;
  cwd_path?: string | null;
}): boolean => !(args.project_path && args.cwd_path);

export const MUTUAL_EXCLUSIVITY_PATH_MSG =
  "Provide either 'project_path' or 'cwd_path', not both.";

/**
 * Formats an AMBIGUOUS candidate list into a human-readable string with
 * "Best matches" and (optionally) "Unlikely" sections.
 *
 * @param best     - Candidates within the recent activity window
 * @param unlikely - Candidates that were inactive for too long to be relevant
 * @param now      - Reference point for relative time labels; defaults to current wall clock
 */
export function formatCandidateList(
  best: ProjectMeta[],
  unlikely: ProjectMeta[],
  now: Date = new Date()
): string {
  const lines: string[] = [];
  lines.push('Best matches:');
  for (const c of best) {
    const rel = formatRelativeTime(c.last_updated, now);
    lines.push(`  - ${c.plan_path} (${c.slug}) — last active ${rel}`);
  }
  if (unlikely.length > 0) {
    lines.push('');
    lines.push('Unlikely (last active more than 6 hours before the best match):');
    for (const c of unlikely) {
      lines.push(`  - ${c.plan_path} (${c.slug})`);
    }
  }
  return lines.join('\n');
}
