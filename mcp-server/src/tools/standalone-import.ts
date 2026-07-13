import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { readFile, access } from 'fs/promises';
import { constants } from 'fs';
import { join } from 'path';
import { LedgerStore } from '../storage/ledger-store.js';
import { withLock } from '../storage/file-lock.js';
import { PLAN_ARCHIVE_FILENAME, SYNTHESIS_ARCHIVE_FILENAME } from '../utils/constants.js';
import { parseOutcomeSummary } from '../utils/synthesis-parser.js';
import { planFolderBasename } from '../utils/path-validator.js';
import { now, parseTimestamp } from '../utils/timestamp.js';

// ─── Constants ────────────────────────────────────────────────────────────

/** Maximum age in days for a standalone project to be eligible for synthesis update. */
const MAX_SYNTHESIS_UPDATE_AGE_DAYS = 90;

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

const UpdateSynthesisSchema = z.object({
  project_path: z
    .string()
    .optional()
    .describe(
      'Absolute path to the standalone plan folder whose synthesis should be updated ' +
      '(e.g. "/repo/docs/agents/plans/2026-06-30-my-feature"). ' +
      'The project must already exist in the ledger. Takes precedence over cwd_path when both are supplied.'
    ),
  cwd_path: z
    .string()
    .optional()
    .describe(
      'Absolute path to the standalone plan folder. Used as a fallback when ' +
      'project_path is not provided. Must point to the plan folder itself (not a ' +
      'parent directory).'
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
  // Note: importStandalone does not call withLock directly — LedgerStore.importStandaloneProject()
  // manages its own lock internally because the storage directory doesn't exist yet at call time.
  // This differs from updateSynthesis (which holds the lock at the handler level, following the
  // completeSynthesis pattern) because update operates on an existing directory.
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

// ─── Tool Handler: ledger_update_synthesis ───────────────────────────────

async function updateSynthesis(args: z.infer<typeof UpdateSynthesisSchema>) {
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

  const store = new LedgerStore(planPath);

  // Guard: project must already be imported.
  const exists = await store.ledgerDirExists();
  if (!exists) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Update failed: no project with slug "${slug}" found in the ledger. Import it first via ledger_import_standalone.`,
        },
      ],
      isError: true,
    };
  }

  // Read root index for pre-lock guard checks (status, runner, staleness).
  // This is intentionally read twice: once here for cheap fast-fail rejection without holding
  // the lock, and again inside the withLock scope for TOCTOU safety. This mirrors the
  // completeSynthesis pattern in project-lifecycle.ts.
  let rootIndexPreLock;
  try {
    rootIndexPreLock = await store.readRootIndex();
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Update failed: could not read project ledger: ${(error as Error).message}`,
        },
      ],
      isError: true,
    };
  }

  // Guard: project must be COMPLETE.
  if (rootIndexPreLock.status !== 'COMPLETE') {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Update failed: project "${slug}" status is "${rootIndexPreLock.status}" — only COMPLETE projects can have their synthesis updated.`,
        },
      ],
      isError: true,
    };
  }

  // Guard: project must be a standalone runner.
  if (rootIndexPreLock.runner !== 'standalone') {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Update failed: project "${slug}" runner is "${rootIndexPreLock.runner ?? 'unknown'}" — only standalone projects support this tool.`,
        },
      ],
      isError: true,
    };
  }

  // Guard: staleness — compare synthesis_generated_at (fallback to date_created) against now.
  const anchorTimestamp = rootIndexPreLock.synthesis_generated_at ?? rootIndexPreLock.date_created;
  const anchorDate = parseTimestamp(anchorTimestamp);
  const ageMs = Date.now() - anchorDate.getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  if (ageDays > MAX_SYNTHESIS_UPDATE_AGE_DAYS) {
    return {
      content: [
        {
          type: 'text' as const,
          text:
            `Update failed: project "${slug}" was imported ${Math.floor(ageDays)} days ago — ` +
            `updates are only allowed within ${MAX_SYNTHESIS_UPDATE_AGE_DAYS} days of import.`,
        },
      ],
      isError: true,
    };
  }

  // Guard: synthesis.md must exist in the plan folder.
  const synthesisFilePath = join(planPath, SYNTHESIS_ARCHIVE_FILENAME);
  try {
    await access(synthesisFilePath, constants.F_OK);
  } catch {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Update failed: ${SYNTHESIS_ARCHIVE_FILENAME} not found in "${planPath}".`,
        },
      ],
      isError: true,
    };
  }

  // Read synthesis.md from the plan folder.
  let synthesisContent: string;
  try {
    synthesisContent = await readFile(synthesisFilePath, 'utf-8');
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Update failed: error reading ${SYNTHESIS_ARCHIVE_FILENAME}: ${(error as Error).message}`,
        },
      ],
      isError: true,
    };
  }

  const outcomeSummary = parseOutcomeSummary(synthesisContent);

  // Read-modify-write under lock (TOCTOU safety).
  let result:
    | { content: Array<{ type: 'text'; text: string }>; isError?: boolean }
    | undefined;

  try {
    await withLock(store.storageDir, async () => {
      // Re-read inside lock for TOCTOU safety.
      const rootIndex = await store.readRootIndex();

      rootIndex.outcome_summary = outcomeSummary;
      rootIndex.last_updated = now();

      await store.writeRootIndex(rootIndex);

      const archiveResult = await store.archiveDocuments([SYNTHESIS_ARCHIVE_FILENAME]);

      result = {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                slug,
                outcome_summary: outcomeSummary,
                archived_files: archiveResult.archived,
                project_storage_path: store.storageDir,
              },
              null,
              2
            ),
          },
        ],
      };
    });
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Update failed: ${(error as Error).message}`,
        },
      ],
      isError: true,
    };
  }

  if (result === undefined) {
    return {
      content: [
        {
          type: 'text' as const,
          text: 'Update failed: internal error — result was not set inside the lock.',
        },
      ],
      isError: true,
    };
  }

  return result;
}

// ─── Internal Export (for tests) ─────────────────────────────────────────

/**
 * @internal — exported for unit testing only. Follows the `_internal` naming convention (§53).
 */
export const _internal = { importStandalone, updateSynthesis };

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

  server.registerTool(
    'ledger_update_synthesis',
    {
      description:
        'Updates the outcome summary and archived synthesis.md for an already-imported standalone project. ' +
        'Re-reads synthesis.md from the original plan folder, re-extracts the outcome summary, ' +
        'overwrites the archived copy in storage, and syncs outcome_summary in the root index and .meta.json. ' +
        'Use this when synthesis.md has been edited after archival (e.g. marking deferred items as done). ' +
        'Guards: project must exist in ledger, status must be COMPLETE, runner must be standalone, ' +
        'and the project must have been imported within the last 90 days. ' +
        'REQUIRED: either project_path or cwd_path (plan folder path).',
      inputSchema: UpdateSynthesisSchema,
    },
    updateSynthesis as any
  );
}
