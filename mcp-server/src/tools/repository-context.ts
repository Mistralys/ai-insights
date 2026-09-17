import { z } from 'zod';
import { readFile } from 'fs/promises';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { LedgerStore } from '../storage/ledger-store.js';
import { loadRegistry, findByFolderName } from '../storage/repository-registry.js';
import { KnowledgeStoreManager, SlugValidationError } from '../storage/knowledge-store.js';
import { resolveLedgerRoot } from '../utils/ledger-root.js';
import { resolveRepositoryIdentity, type DeclaredIdentity } from '../utils/repository-identity.js';
import { resolveOutputPath } from '../storage/project-declaration.js';
import { parseGeneratedHeader, visionHash } from '../outputs/strategic-vision.js';
import { getMultiStoreManager, getStoreRouter, isStoreContextInitialized } from '../storage/store-context.js';
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
 * Mirror status for a declared project's `strategic-vision` output — present
 * only when `cwd_path` resolves to a declared project with that output
 * enabled (see {@link buildMirrorField}). Omitted from the response
 * otherwise, so existing consumers and response tests are unaffected.
 */
interface MirrorStatus {
  /** Absolute filesystem path the mirror is (or would be) written to. */
  path: string;
  /**
   * The `generated-at` timestamp parsed from the mirror file's header, or
   * `null` when the file has not been generated yet (declared + enabled,
   * but `ai-insights ledger sync` has not run).
   */
  generated_at: string | null;
  /** Current SHA-256 hash (hex, no prefix) of the registry entry's vision. */
  vision_hash: string;
  /**
   * `true` when the on-disk mirror is missing, unmarked (hand-authored, so
   * this tool cannot trust it), or its `vision-hash` header disagrees with
   * `vision_hash` — i.e. `ai-insights ledger sync` is due.
   */
  stale: boolean;
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
  /** See {@link MirrorStatus}. Absent for an undeclared project or a disabled output. */
  mirror?: MirrorStatus;
}

/**
 * Computes the `mirror` field for a declared project whose `strategic-vision`
 * output is enabled. Read-only — never writes, removes, or otherwise touches
 * the filesystem; that is `ai-insights ledger sync`'s (and
 * `syncProjectOutputs()`'s) job alone.
 *
 * Returns `undefined` when the output is disabled, or when its resolved path
 * was rejected by `resolveOutputPath()` (an invalid override) — in both
 * cases there is nothing meaningful to report and the field stays omitted,
 * per this WP's contract that `mirror` is additive and never a source of
 * response-shape churn for a caller that only cares whether a mirror is
 * live.
 */
async function buildMirrorField(declaration: DeclaredIdentity): Promise<MirrorStatus | undefined> {
  const outputConfig = declaration.settings.outputs?.['strategic-vision'];
  if (!outputConfig?.enabled) {
    return undefined;
  }

  const resolved = resolveOutputPath(declaration.projectRoot, 'strategic-vision', declaration.settings);
  if (resolved.kind === 'rejected') {
    return undefined;
  }

  const currentHash = visionHash(declaration.entry.vision);

  let existingText: string | null;
  try {
    existingText = await readFile(resolved.path, 'utf-8');
  } catch {
    existingText = null;
  }
  const header = existingText !== null ? parseGeneratedHeader(existingText) : null;

  return {
    path: resolved.path,
    generated_at: header?.generatedAt ?? null,
    vision_hash: currentHash,
    stale: header === null || header.visionHash !== currentHash,
  };
}

// ─── Handler ──────────────────────────────────────────────────────────────

async function getRepositoryContext(
  args: z.infer<typeof GetRepositoryContextSchema>
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  try {
    // 1. Resolve repository identity: explicit → declared → derived.
    const identityResult = await resolveRepositoryIdentity(args.cwd_path, args.repository_name);
    if (identityResult.kind === 'error') {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error: ${identityResult.message}`,
          },
        ],
        isError: true,
      };
    }
    const { repositoryName, declaration } = identityResult.identity;

    // Evaluate the store context once for the lifetime of this call.
    const isMultiStore = isStoreContextInitialized();

    // 2. Consult the registry for this repository.
    //    - Declared tier: the identity resolver already looked the entry up
    //      by id — reuse it directly rather than re-deriving it by folder
    //      name (a declared repository_id resolves even when the directory
    //      basename matches no folder_names entry — AC-14).
    //    - Explicit/derived tiers: fall back to the pre-existing folder-name
    //      lookup.
    //      In multi-store mode: use the merged registry (store-order priority).
    //      In single-store/legacy mode: load the single default store's registry.
    let registryEntry: RepositoryEntry | null;
    if (declaration) {
      registryEntry = declaration.entry;
    } else if (isMultiStore) {
      const mergedRegistry = await getMultiStoreManager().getMergedRegistry();
      registryEntry = mergedRegistry.find((e) => e.folder_names.includes(repositoryName)) ?? null;
    } else {
      const ledgerRoot = resolveLedgerRoot();
      const registry = await loadRegistry(ledgerRoot);
      registryEntry = findByFolderName(registry, repositoryName);
    }

    // 3. Collect folder names to scan
    //    - Registry match: scan ALL declared folder_names (cross-folder aggregation)
    //    - No registry match: scan only the single derived folder name
    const folderNamesToScan: string[] = registryEntry
      ? registryEntry.folder_names
      : [repositoryName];

    // 4. Read projects from the targeted namespace directories.
    //    In multi-store mode: scan each configured store path and deduplicate by plan_path.
    //    In single-store/legacy mode: scan only the default ledger root.
    let allProjects: ProjectMeta[];
    if (isMultiStore) {
      const allStorePaths = getStoreRouter().getAllStorePaths();
      const seen = new Set<string>();
      allProjects = [];
      for (const storePath of allStorePaths) {
        const storeProjects = await LedgerStore.listProjectsByFolderNames(folderNamesToScan, storePath);
        for (const p of storeProjects) {
          if (!seen.has(p.plan_path)) {
            seen.add(p.plan_path);
            allProjects.push(p);
          }
        }
      }
    } else {
      const ledgerRoot = resolveLedgerRoot();
      allProjects = await LedgerStore.listProjectsByFolderNames(folderNamesToScan, ledgerRoot);
    }

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

    // 8. Query knowledge store for relevant insights (optional).
    //    In multi-store mode: search across all stores via MultiStoreManager (deduplication built in).
    //    In single-store/legacy mode: use a single KnowledgeStoreManager for the default root.
    let relevantInsights: Insight[] = [];
    if (args.include_insights !== false) {
      let globalInsights: Insight[];
      let repoInsights: Insight[];

      if (isMultiStore) {
        [globalInsights, repoInsights] = await Promise.all([
          getMultiStoreManager().listKnowledge({ scope: 'global', limit: 20 }),
          safeListAllStoreRepositoryInsights(repositoryName),
        ]);
      } else {
        const ledgerRoot = resolveLedgerRoot();
        const knowledgeManager = new KnowledgeStoreManager(ledgerRoot);
        [globalInsights, repoInsights] = await Promise.all([
          knowledgeManager.listInsights({ scope: 'global', limit: 20 }),
          safeListRepositoryInsights(knowledgeManager, repositoryName),
        ]);
      }

      // Deduplicate by insight id (global insights take precedence over repo-scoped)
      const seenIds = new Set<string>();
      const deduped: Insight[] = [];
      for (const insight of [...globalInsights, ...repoInsights]) {
        if (!seenIds.has(insight.id)) {
          seenIds.add(insight.id);
          deduped.push(insight);
        }
      }
      relevantInsights = deduped;
    }

    // 9. Build the response.
    //    `mirror` is additive: only computed (and only present) for a
    //    declared project — omitted for the explicit and derived tiers, and
    //    omitted by buildMirrorField() itself when the output is disabled.
    const response: RepositoryContextResponse = {
      repository_name: repositoryName,
      repository_id: registryEntry ? registryEntry.id : null,
      repository_label: registryEntry ? registryEntry.label : null,
      total_projects: totalProjects,
      strategic_vision: registryEntry ? registryEntry.vision : null,
      projects,
      relevant_insights: relevantInsights,
    };
    if (declaration) {
      const mirror = await buildMirrorField(declaration);
      if (mirror) {
        response.mirror = mirror;
      }
    }

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

/**
 * Cross-store variant of {@link safeListRepositoryInsights} for multi-store mode.
 *
 * Delegates to {@link MultiStoreManager.listKnowledge} which aggregates insights
 * across all configured stores with deduplication by insight id. Suppresses
 * {@link SlugValidationError} for the same reasons as the single-store variant.
 */
async function safeListAllStoreRepositoryInsights(repoName: string): Promise<Insight[]> {
  try {
    return await getMultiStoreManager().listKnowledge({
      scope: 'repository',
      repository_name: repoName,
    });
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
