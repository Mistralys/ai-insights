import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { readFile, access } from 'fs/promises';
import { constants } from 'fs';
import { join } from 'path';
import { LedgerStore } from '../storage/ledger-store.js';
import { PLAN_ARCHIVE_FILENAME, SYNTHESIS_ARCHIVE_FILENAME } from '../utils/constants.js';
import { parseOutcomeSummary } from '../utils/synthesis-parser.js';
import { planFolderBasename } from '../utils/path-validator.js';
import { now } from '../utils/timestamp.js';

// ─── Input Schema ─────────────────────────────────────────────────────────

const ImportStandaloneSchema = z.object({
  project_path: z
    .string()
    .optional()
    .describe(
      'Absolute path to the standalone plan folder to import (e.g. ' +
      '"/repo/docs/agents/plans/2026-06-30-my-feature"). ' +
      'The folder must follow the {YYYY-MM-DD}-{name} naming convention and contain ' +
      'plan.md and synthesis.md. Takes precedence over cwd_path when both are supplied.'
    ),
  cwd_path: z
    .string()
    .optional()
    .describe(
      'Absolute path to the standalone plan folder. Used as a fallback when ' +
      'project_path is not provided. Must point to the plan folder itself (not a ' +
      'parent directory) and must satisfy the {YYYY-MM-DD}-{name} naming convention.'
    ),
});

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * Extracts an ISO 8601 UTC date string from a plan folder slug (YYYY-MM-DD-...).
 * Returns `null` when the slug does not start with a recognized date prefix.
 */
function extractDateFromSlug(slug: string): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})-/.exec(slug);
  if (!match || !match[1]) {
    return null;
  }
  return `${match[1]}T00:00:00Z`;
}

// ─── Tool Handler ─────────────────────────────────────────────────────────

async function importStandalone(args: z.infer<typeof ImportStandaloneSchema>) {
  // Resolve the plan folder path — project_path wins over cwd_path.
  const planPath = args.project_path ?? args.cwd_path;
  if (!planPath) {
    return {
      content: [
        {
          type: 'text' as const,
          text: 'Error: Either project_path or cwd_path is required.',
        },
      ],
      isError: true,
    };
  }

  // Validate plan folder naming convention.
  let slug: string;
  try {
    slug = planFolderBasename(planPath);
  } catch (error) {
    return {
      content: [{ type: 'text' as const, text: `Error: ${(error as Error).message}` }],
      isError: true,
    };
  }

  // Check plan.md exists.
  const planFilePath = join(planPath, PLAN_ARCHIVE_FILENAME);
  try {
    await access(planFilePath, constants.F_OK);
  } catch {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Import failed: ${PLAN_ARCHIVE_FILENAME} not found in "${planPath}".`,
        },
      ],
      isError: true,
    };
  }

  // Check synthesis.md exists.
  const synthesisFilePath = join(planPath, SYNTHESIS_ARCHIVE_FILENAME);
  try {
    await access(synthesisFilePath, constants.F_OK);
  } catch {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Import failed: ${SYNTHESIS_ARCHIVE_FILENAME} not found in "${planPath}".`,
        },
      ],
      isError: true,
    };
  }

  // Build a LedgerStore to derive repo name, slug, and storage path —
  // deriveRepoName() is called by the constructor using the upgraded anchor-based
  // inferProjectRootFromPlanPath() algorithm (WP-001).
  const store = new LedgerStore(planPath);

  // Reject duplicate imports (same slug already exists in the ledger).
  const alreadyExists = await store.ledgerDirExists();
  if (alreadyExists) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Import failed: a project with slug "${slug}" already exists.`,
        },
      ],
      isError: true,
    };
  }

  // Read synthesis.md and parse outcome summary.
  let synthesisContent: string;
  try {
    synthesisContent = await readFile(synthesisFilePath, 'utf-8');
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Import failed: error reading ${SYNTHESIS_ARCHIVE_FILENAME}: ${(error as Error).message}`,
        },
      ],
      isError: true,
    };
  }

  const outcomeSummary = parseOutcomeSummary(synthesisContent);

  // Derive dateCreated from the YYYY-MM-DD prefix in the plan folder slug;
  // fall back to now() for folders with atypical naming.
  const dateCreated = extractDateFromSlug(slug) ?? now();

  // Delegate all storage writes to LedgerStore (Constraint 2c).
  let archiveResult: { archived: string[]; skipped: string[] };
  try {
    archiveResult = await store.importStandaloneProject({
      planFile: PLAN_ARCHIVE_FILENAME,
      synthesisFile: SYNTHESIS_ARCHIVE_FILENAME,
      dateCreated,
      outcomeSummary,
      pipelineSummary:
        outcomeSummary !== null ? [outcomeSummary] : ['Standalone plan executed.'],
    });
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Import failed: ${(error as Error).message}`,
        },
      ],
      isError: true,
    };
  }

  const response = {
    slug,
    outcome_summary: outcomeSummary,
    archived_files: archiveResult.archived,
    project_storage_path: store.storageDir,
  };

  return {
    content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }],
  };
}

// ─── Internal Export (for tests) ─────────────────────────────────────────

/**
 * @internal — exported for unit testing only. Follows the `_internal` naming convention (§53).
 */
export const _internal = { importStandalone };

// ─── Registration ─────────────────────────────────────────────────────────

export function register(server: McpServer): void {
  server.registerTool(
    'ledger_import_standalone',
    {
      description:
        'Imports a completed standalone developer plan execution into the project ledger. ' +
        'Validates that plan.md and synthesis.md exist in the plan folder, rejects duplicate slugs, ' +
        'extracts the outcome summary from synthesis.md, and creates a COMPLETE project record ' +
        '(status: COMPLETE, synthesis_generated: true, runner: standalone). ' +
        'REQUIRED: either project_path or cwd_path (plan folder path). ' +
        'The folder must follow the {YYYY-MM-DD}-{name} naming convention.',
      inputSchema: ImportStandaloneSchema,
    },
    importStandalone as any
  );
}
