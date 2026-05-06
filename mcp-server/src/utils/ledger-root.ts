import { join, dirname, posix } from 'path';
import { fileURLToPath } from 'url';
import { planFolderBasename } from './path-validator.js';

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
 * Derives the project root from an absolute plan folder path by walking up
 * exactly four directory levels.
 *
 * The established convention is:
 *   {project-root}/docs/agents/plans/{slug}
 *
 * So calling dirname() four times on a normalized plan path returns the project root.
 *
 * This function is pure — it performs no filesystem access.
 *
 * @param planPath - Absolute path to the plan folder (e.g. "/home/user/project/docs/agents/plans/2026-02-01-feat")
 * @returns The project root path (e.g. "/home/user/project")
 */
export function inferProjectRootFromPlanPath(planPath: string): string {
  // Normalize backslashes to forward slashes for cross-platform correctness
  const normalized = planPath.replace(/\\/g, '/');
  // Walk up 4 levels: slug → plans → agents → docs → project-root
  let current = normalized;
  for (let i = 0; i < 4; i++) {
    current = posix.dirname(current);
  }
  return current;
}
