import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { KnowledgeStoreManager } from '../storage/knowledge-store.js';
import { resolveLedgerRoot } from '../utils/ledger-root.js';
import { InsightScope, SLUG_REGEX } from '../schema/knowledge.js';
import { now } from '../utils/timestamp.js';
import type { Insight } from '../schema/knowledge.js';

/**
 * Formats a numeric insight ID as a human-readable KN-NNNN string.
 */
function formatInsightId(id: number): string {
  return `KN-${String(id).padStart(4, '0')}`;
}

// ─── Tool: ledger_add_insight ─────────────────────────────────────────────

const AddInsightSchema = z.object({
  scope: InsightScope.describe(
    '"global" for cross-codebase insights, "repository" for repository-scoped. repository_name is required when scope is "repository".'
  ),
  repository_name: z
    .string()
    .regex(SLUG_REGEX)
    .optional()
    .describe(
      'Required when scope is "repository". Slug of the repository (alphanumeric, hyphens, underscores only).'
    ),
  title: z.string().describe('Short title for the insight.'),
  content: z.string().describe('Full description of the insight.'),
  category: z
    .string()
    .describe('Category string (e.g., "architecture", "testing", "workflow", "security").'),
  tags: z.array(z.string()).describe('Array of tag strings for filtering and search.'),
  source: z
    .string()
    .optional()
    .describe(
      'Source reference (e.g., WP ID, discussion link, or URL). Defaults to empty string if omitted.'
    ),
  confidence: z
    .number()
    .optional()
    .describe('Confidence score 0–1 indicating reliability. Defaults to 1 if omitted.'),
  origin_plan: z
    .string()
    .regex(SLUG_REGEX)
    .optional()
    .describe(
      'Optional provenance metadata — the plan slug where this insight was first discovered. ' +
      'Distinct from source (a reference link/URL); origin_plan records the planning artefact ' +
      'that produced the insight (e.g. a plan folder slug).'
    ),
});

async function addInsight(args: z.infer<typeof AddInsightSchema>) {
  const manager = new KnowledgeStoreManager(resolveLedgerRoot());

  try {
    const insight = await manager.addInsight({
      scope: args.scope,
      repository_name: args.repository_name,
      origin_plan: args.origin_plan,
      title: args.title,
      content: args.content,
      category: args.category,
      tags: args.tags,
      source: args.source ?? '',
      confidence: args.confidence ?? 1,
      created_at: now(),
    });

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({ ...insight, formatted_id: formatInsightId(insight.id) }, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error adding insight: ${(error as Error).message}`,
        },
      ],
      isError: true,
    };
  }
}

// ─── Tool: ledger_search_insights ─────────────────────────────────────────

const SearchInsightsSchema = z.object({
  query: z
    .string()
    .describe(
      'Search string — case-insensitive substring match against title, content, and tags.'
    ),
  scope: InsightScope.optional().describe('Optional. Filter by scope: "global" or "repository".'),
  category: z.string().optional().describe('Optional. Filter by category.'),
  tags: z
    .array(z.string())
    .optional()
    .describe('Optional. Filter results to those containing ALL specified tags.'),
  repository_name: z
    .string()
    .regex(SLUG_REGEX)
    .optional()
    .describe('Optional. Restrict search to a specific repository store.'),
  limit: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Optional. Maximum number of results to return.'),
});

async function searchInsights(args: z.infer<typeof SearchInsightsSchema>) {
  const manager = new KnowledgeStoreManager(resolveLedgerRoot());

  try {
    let results = await manager.searchInsights(args.query, {
      scope: args.scope,
      category: args.category,
      repository_name: args.repository_name,
    });

    // Apply tags filter post-search (searchInsights supports scope/category/repository_name only)
    if (args.tags && args.tags.length > 0) {
      const filterTags = args.tags;
      results = results.filter((insight) =>
        filterTags.every((tag) => insight.tags.includes(tag))
      );
    }

    if (args.limit !== undefined) {
      results = results.slice(0, args.limit);
    }

    const formatted = results.map((insight) => ({
      ...insight,
      formatted_id: formatInsightId(insight.id),
    }));

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(formatted, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error searching insights: ${(error as Error).message}`,
        },
      ],
      isError: true,
    };
  }
}

// ─── Tool: ledger_list_insights ───────────────────────────────────────────

const ListInsightsSchema = z.object({
  scope: InsightScope.optional().describe('Optional. Filter by scope: "global" or "repository".'),
  category: z.string().optional().describe('Optional. Filter by category.'),
  tags: z
    .array(z.string())
    .optional()
    .describe('Optional. Filter to insights matching ALL specified tags.'),
  repository_name: z
    .string()
    .regex(SLUG_REGEX)
    .optional()
    .describe('Optional. Restrict to a specific repository store.'),
  limit: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Optional. Maximum number of results to return (for pagination).'),
  offset: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe('Optional. Number of results to skip (for pagination). Defaults to 0.'),
});

async function listInsights(args: z.infer<typeof ListInsightsSchema>) {
  const manager = new KnowledgeStoreManager(resolveLedgerRoot());

  try {
    const results = await manager.listInsights({
      scope: args.scope,
      category: args.category,
      tags: args.tags,
      repository_name: args.repository_name,
      limit: args.limit,
      offset: args.offset,
    });

    const formatted = results.map((insight) => ({
      ...insight,
      formatted_id: formatInsightId(insight.id),
    }));

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(formatted, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error listing insights: ${(error as Error).message}`,
        },
      ],
      isError: true,
    };
  }
}

// ─── Tool: ledger_update_insight ──────────────────────────────────────────

const UpdateInsightSchema = z.object({
  id: z
    .number()
    .int()
    .describe(
      'Numeric ID of the insight to update (as returned in the id field of a previous response).'
    ),
  scope: InsightScope.optional().describe(
    'Optional. Restrict the update to stores of this scope ("global" or "repository"). ' +
    'Recommended when the same numeric ID may exist in both global and repository stores — ' +
    'prevents accidental global-insight mutation.'
  ),
  repository_name: z
    .string()
    .regex(SLUG_REGEX)
    .optional()
    .describe(
      'Optional. Restrict the update to the specified repository store. ' +
      'When provided, only that repository\'s store is searched — prevents ambiguous resolution ' +
      'when the same numeric ID exists in multiple stores.'
    ),
  title: z.string().optional().describe('Optional. New title for the insight.'),
  content: z.string().optional().describe('Optional. New content for the insight.'),
  category: z.string().optional().describe('Optional. New category.'),
  tags: z.array(z.string()).optional().describe('Optional. Replace the tags array.'),
  source: z.string().optional().describe('Optional. New source reference.'),
  confidence: z.number().optional().describe('Optional. New confidence score (0–1).'),
  superseded_by: z
    .number()
    .int()
    .optional()
    .describe('Optional. Numeric ID of the insight that supersedes this one.'),
});

async function updateInsight(args: z.infer<typeof UpdateInsightSchema>) {
  const manager = new KnowledgeStoreManager(resolveLedgerRoot());

  const updates: Partial<
    Pick<
      Insight,
      'title' | 'content' | 'category' | 'tags' | 'source' | 'confidence' | 'superseded_by'
    >
  > = {};
  if (args.title !== undefined) updates.title = args.title;
  if (args.content !== undefined) updates.content = args.content;
  if (args.category !== undefined) updates.category = args.category;
  if (args.tags !== undefined) updates.tags = args.tags;
  if (args.source !== undefined) updates.source = args.source;
  if (args.confidence !== undefined) updates.confidence = args.confidence;
  if (args.superseded_by !== undefined) updates.superseded_by = args.superseded_by;

  try {
    const insight = await manager.updateInsight(args.id, updates, {
      scope: args.scope,
      repository_name: args.repository_name,
    });

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({ ...insight, formatted_id: formatInsightId(insight.id) }, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error updating insight: ${(error as Error).message}`,
        },
      ],
      isError: true,
    };
  }
}

/**
 * @internal — exported for unit testing only. Follows the `_internal` naming convention (§53).
 */
export const _internal = {
  AddInsightSchema,
  SearchInsightsSchema,
  ListInsightsSchema,
  UpdateInsightSchema,
  addInsight,
  searchInsights,
  listInsights,
  updateInsight,
};

export function register(server: McpServer): void {
  server.registerTool(
    'ledger_add_insight',
    {
      description:
        'Add a reusable insight to the knowledge base. REQUIRED params: scope, title, content, category, tags. scope is "global" or "repository" — if "repository", repository_name is also required. OPTIONAL: origin_plan (provenance plan slug — the plan where this insight was first discovered or generated).',
      inputSchema: AddInsightSchema,
    },
    addInsight as any
  );

  server.registerTool(
    'ledger_search_insights',
    {
      description:
        'Search the knowledge base for insights matching a query string. REQUIRED params: query. Optional filters: scope, category, tags, repository_name, limit.',
      inputSchema: SearchInsightsSchema,
    },
    searchInsights as any
  );

  server.registerTool(
    'ledger_list_insights',
    {
      description:
        'List all insights in the knowledge base with optional filters and pagination. All params optional: scope, category, tags, repository_name, limit, offset.',
      inputSchema: ListInsightsSchema,
    },
    listInsights as any
  );

  server.registerTool(
    'ledger_update_insight',
    {
      description:
        'Update an existing insight by numeric ID. REQUIRED params: id. Optional scope filters: scope, repository_name (recommended when the same numeric ID may exist in both global and repository stores). Optional update fields: title, content, category, tags, source, confidence, superseded_by.',
      inputSchema: UpdateInsightSchema,
    },
    updateInsight as any
  );
}
