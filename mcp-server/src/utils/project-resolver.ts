/**
 * Project-path resolution utilities.
 *
 * This module owns responsibility 2 of the former `path-validator.ts`:
 *
 * **Project-path resolution** (async, requires `LedgerStore`)
 *   - `resolveProjectPath()` — resolves a tool's `project_path`/`cwd_path` pair to
 *     a single absolute plan-folder path. Used by every tool handler that accepts
 *     either optional path field.
 *   - `formatCandidateList()` — formats an AMBIGUOUS candidate list for human-readable
 *     error messages; used by `resolveProjectPath()` and `detectProjectByCwd` callers.
 *
 * Pure path-segment utilities (`assertSafeSegment`, `planFolderBasename`, `validatePlanPath`)
 * remain in `path-validator.ts`, which has no storage dependencies.
 */

import { LedgerStore } from '../storage/ledger-store.js';
import type { ProjectMeta } from '../schema/project-meta.js';
import { formatRelativeTime } from './timestamp.js';
import { planFolderBasename } from './path-validator.js';

/**
 * Resolves the project path from tool arguments that accept either
 * `project_path` (explicit) or `cwd_path` (auto-detect via ledger lookup).
 *
 * Resolution rules:
 * - `project_path` provided → validate format, return it (original behavior).
 * - Only `cwd_path` provided → call `LedgerStore.detectProjectByCwd`, return `meta.plan_path`.
 * - Both provided → `project_path` wins; `cwd_path` is ignored.
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
  // Precedence rule: project_path wins over cwd_path when both are supplied.
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
