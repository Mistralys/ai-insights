import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { LedgerStore } from '../storage/ledger-store.js';
import { loadRegistry, findByFolderName } from '../storage/repository-registry.js';
import { KnowledgeStoreManager, SlugValidationError } from '../storage/knowledge-store.js';
import { resolveLedgerRoot, deriveRepoName } from '../utils/ledger-root.js';
import type { ProjectMeta } from '../schema/project-meta.js';
import type { RepositoryEntry } from '../schema/repository-registry.js';
import type { Insight } from '../schema/knowledge.js';

// ─── Input Schema ─────────────────────────────────────────────────────────

const GetRepositoryContextSchema = z.object({
  cwd_path: z
    .string()
    .optional()
    .describe(
      'Absolute path to the workspace root directory. Used to derive the repository name ' +
      'when repository_name is not provided. Ignored when repository_name is supplied.'
    ),
  repository_name: z
    .string()
    .optional()
    .describe(
      'Explicit repository name to look up in the registry. When provided, cwd_path ' +
      'is not used for name derivation. Treated as both the ledger folder name and the ' +
      'registry lookup key.'
    ),
  include_insights: z
    .boolean()
    .optional()
    .default(true)
    .describe(
      'When true (default), the response includes relevant_insights[] queried from the ' +
      'knowledge store. Set to false to return an empty relevant_insights[] array and reduce response size.'
    ),
  max_projects: z
    .number()
    .int()
    .positive()
    .optional()
    .default(5)
    .describe(
      'Maximum number of projects to return in the projects[] array, sorted by date_created ' +
      'descending (most recent first). Defaults to 5.'
    ),
});

// ─── Response Shape ───────────────────────────────────────────────────────

/**
 * A single project entry returned in the projects[] array.
 * Derived from ProjectMeta with a curated subset of fields.
 */
interface ProjectEntry {
  slug: string;
  plan_path: string;
  status: string;
  date_created: string;
  last_updated: string;
  title?: string;
  outcome_summary: string | null;
  progress_pct?: number;
}

/**
 * The full structured response from ledger_get_repository_context.
 */
interface RepositoryContextResponse {
  repository_name: string;
  repository_id: string | null;
  repository_label: string | null;
  total_projects: number;
  strategic_vision: RepositoryEntry['vision'] | null;
  projects: ProjectEntry[];
  relevant_insights: Insight[];
}

// ─── Handler ──────────────────────────────────────────────────────────────

async function getRepositoryContext(
  args: z.infer<typeof GetRepositoryContextSchema>
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  try {
    const ledgerRoot = resolveLedgerRoot();

    // 1. Resolve repository name
    let repositoryName: string;
    if (args.repository_name) {
      repositoryName = args.repository_name;
    } else if (args.cwd_path) {
      // Derive from the workspace path (same logic as LedgerStore constructor)
      repositoryName = deriveRepoName(
        // deriveRepoName expects a plan folder path — construct a synthetic one
        // that places the repo root 4 levels above cwd_path (the conventional layout)
        `${args.cwd_path}/docs/agents/plans/synthetic-slug`
      );
    } else {
      return {
        content: [
          {
            type: 'text' as const,
            text: 'Error: Either cwd_path or repository_name must be provided.',
          },
        ],
        isError: true,
      };
    }

    // 2. Consult the registry for this repository
    const registry = await loadRegistry(ledgerRoot);
    const registryEntry = findByFolderName(registry, repositoryName);

    // 3. Collect folder names to scan
    //    - Registry match: scan ALL declared folder_names (cross-folder aggregation)
    //    - No registry match: scan only the single derived folder name
    const folderNamesToScan: string[] = registryEntry
      ? registryEntry.folder_names
      : [repositoryName];

    // 4. Read projects from the targeted namespace directories only
    const allProjects = await LedgerStore.listProjectsByFolderNames(
      folderNamesToScan,
      ledgerRoot
    );

    // 5. Sort by date_created descending (most recently created first)
    const sorted = [...allProjects].sort((a, b) =>
      b.date_created.localeCompare(a.date_created)
    );

    const totalProjects = sorted.length;

    // 6. Apply max_projects cap
    const maxProjects = args.max_projects ?? 5;
    const capped = sorted.slice(0, maxProjects);

    // 7. Map to ProjectEntry shape
    const projects: ProjectEntry[] = capped.map((meta: ProjectMeta) => {
      const entry: ProjectEntry = {
        slug: meta.slug,
        plan_path: meta.plan_path,
        status: meta.status,
        date_created: meta.date_created,
        last_updated: meta.last_updated,
        outcome_summary: meta.outcome_summary ?? null,
      };
      if (meta.title !== undefined) {
        entry.title = meta.title;
      }
      if (meta.progress_pct !== undefined) {
        entry.progress_pct = meta.progress_pct;
      }
      return entry;
    });

    // 8. Query knowledge store for relevant insights (optional)
    let relevantInsights: Insight[] = [];
    if (args.include_insights !== false) {
      const knowledgeManager = new KnowledgeStoreManager(ledgerRoot);
      // Query both global and repository-scoped insights
      const [globalInsights, repoInsights] = await Promise.all([
        knowledgeManager.listInsights({ scope: 'global', limit: 20 }),
        safeListRepositoryInsights(knowledgeManager, repositoryName),
      ]);
      // Deduplicate by insight id (global insights take precedence over repo-scoped)
      const seenIds = new Set<number>();
      const deduped: Insight[] = [];
      for (const insight of [...globalInsights, ...repoInsights]) {
        if (!seenIds.has(insight.id)) {
          seenIds.add(insight.id);
          deduped.push(insight);
        }
      }
      relevantInsights = deduped;
    }

    // 9. Build the response
    const response: RepositoryContextResponse = {
      repository_name: repositoryName,
      repository_id: registryEntry ? registryEntry.id : null,
      repository_label: registryEntry ? registryEntry.label : null,
      total_projects: totalProjects,
      strategic_vision: registryEntry ? registryEntry.vision : null,
      projects,
      relevant_insights: relevantInsights,
    };

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(response, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error retrieving repository context: ${(error as Error).message}`,
        },
      ],
      isError: true,
    };
  }
}

/**
 * Safely lists repository-scoped insights for the given repository name.
 * Returns an empty array when the repository name fails slug validation
 * (e.g. invalid characters, reserved name "global"), so callers do not need
 * to guard against those expected validation failures.
 *
 * @remarks
 * Only {@link SlugValidationError} instances are suppressed — thrown by
 * `_validateSlug()` and `repositoryStorePath()` in `knowledge-store.ts` when
 * the repository name fails slug validation or is a reserved name. All other
 * errors — genuine I/O failures such as EACCES or EIO — are re-thrown so that
 * the caller can surface them rather than silently returning an empty result.
 */
async function safeListRepositoryInsights(
  manager: KnowledgeStoreManager,
  repoName: string
): Promise<Insight[]> {
  try {
    return await manager.listInsights({ scope: 'repository', repository_name: repoName });
  } catch (err) {
    if (err instanceof SlugValidationError) {
      return [];
    }
    throw err;
  }
}

// ─── Internal exports for testing ────────────────────────────────────────

/**
 * @internal — exported for unit testing only. Follows the `_internal` naming convention.
 */
export const _internal = {
  GetRepositoryContextSchema,
  getRepositoryContext,
  safeListRepositoryInsights,
};

// ─── Tool Registration ────────────────────────────────────────────────────

export function register(server: McpServer): void {
  server.registerTool(
    'ledger_get_repository_context',
    {
      description:
        'Returns a compact project timeline with curated outcome summaries, relevant knowledge-base ' +
        'insights, and strategic vision for a repository. Gives the Planner agent access to prior ' +
        'project history within the same repository. OPTIONAL params: cwd_path (workspace root for ' +
        'auto-detecting the repository name), repository_name (explicit override), ' +
        'include_insights (default: true), max_projects (default: 5).',
      inputSchema: GetRepositoryContextSchema,
    },
    getRepositoryContext as any
  );
}
