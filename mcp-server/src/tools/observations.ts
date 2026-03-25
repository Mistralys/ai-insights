import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { LedgerStore } from '../storage/ledger-store.js';
import { now } from '../utils/timestamp.js';
import { withLock } from '../storage/file-lock.js';
import type { PipelineComment, IncidentContext } from '../schema/work-package.js';
import type { ProjectComment } from '../schema/root-index.js';
import { resolveProjectPath } from '../utils/path-validator.js';
import { PipelineTypeEnum, describePipelineTypes } from '../utils/pipeline-maps.js';

/**
 * Tool: add_observation
 *
 * Adds a comment to the most recent pipeline of the specified type.
 * Comments do NOT include an agent field (agent is inferred from pipeline type).
 */
const AddObservationSchema = z.object({
  project_path: z.string().optional().describe('Absolute path to the plan folder. Use this if you already have it from a previous tool response or if it was provided in your instructions. Takes precedence over cwd_path if both are given.'),
  cwd_path: z.string().optional().describe('Your current workspace root directory. The server auto-detects the active project. Ignored if project_path is also provided.'),
  work_package_id: z
    .string()
    .regex(/^WP-\d{3,}$/)
    .describe('Work package ID, format: WP-001, WP-002, etc.'),
  pipeline_type: PipelineTypeEnum.describe(describePipelineTypes('Pipeline type to add the observation to:')),
  type: z
    .string()
    .describe(
      'Observation category (e.g., "code-smell", "refactor", "improvement", "debt", "convention")'
    ),
  priority: z.enum(['low', 'medium', 'high']).describe('Priority level: "low", "medium", or "high"'),
  note: z.string().describe('Detailed description of the observation'),
});

async function addObservation(args: z.infer<typeof AddObservationSchema>) {
  let projectPath: string;
  try {
    projectPath = await resolveProjectPath(args);
  } catch (err) {
    return { content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }], isError: true };
  }

  const store = new LedgerStore(projectPath);

  try {
    await store.updateWorkPackageWithSync(args.work_package_id, (wp, root) => {
      // 1. Find most recent pipeline of given type (any status)
      const pipelineIndex = wp.pipelines
        .map((p, idx) => ({ pipeline: p, index: idx }))
        .reverse()
        .find((p) => p.pipeline.type === args.pipeline_type);

      if (!pipelineIndex) {
        throw new Error(
          `Cannot add observation: no pipeline of type "${args.pipeline_type}" found for work package ${args.work_package_id}.`
        );
      }

      const pipeline = pipelineIndex.pipeline;

      // 2. Create comment object (no agent field)
      const comment: PipelineComment = {
        type: args.type,
        priority: args.priority,
        timestamp: now(),
        note: args.note,
      };

      // 3. Initialize comments array if needed
      if (!pipeline.comments) {
        pipeline.comments = [];
      }

      // 4. Append comment
      pipeline.comments.push(comment);

      // 5. Update root index timestamp
      root.last_updated = now();

      return { wp, root };
    });

    // Return updated work package
    const updatedWp = await store.readWorkPackage(args.work_package_id);
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(updatedWp, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error adding observation: ${(error as Error).message}`,
        },
      ],
      isError: true,
    };
  }
}

/**
 * Tool: add_project_comment
 *
 * Adds a comment to the project-level comments array in the root index.
 * For incident type comments, context is required.
 */
const AddProjectCommentSchema = z.object({
  project_path: z.string().optional().describe('Absolute path to the plan folder. Use this if you already have it from a previous tool response or if it was provided in your instructions. Takes precedence over cwd_path if both are given.'),
  cwd_path: z.string().optional().describe('Your current workspace root directory. The server auto-detects the active project. Ignored if project_path is also provided.'),
  type: z.string().describe('Comment type: "incident", "note", or "decision"'),
  priority: z.enum(['low', 'medium', 'high']).describe('Priority level: "low", "medium", or "high"'),
  agent: z.string().describe('REQUIRED. Your agent name (e.g., "Developer", "QA", "Reviewer", "Documentation")'),
  note: z.string().describe('Detailed description of the comment'),
  context: z
    .object({
      os: z.string(),
      tool: z.string(),
      work_package: z.string().optional(),
      resolved: z.boolean(),
      workaround: z.string().optional(),
    })
    .passthrough()
    .optional()
    .describe('REQUIRED when type is "incident". Provide os, tool, resolved fields at minimum.'),
});

async function addProjectComment(args: z.infer<typeof AddProjectCommentSchema>) {
  let projectPath: string;
  try {
    projectPath = await resolveProjectPath(args);
  } catch (err) {
    return { content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }], isError: true };
  }

  const store = new LedgerStore(projectPath);

  try {
    await withLock(store.storageDir, async () => {
      // 1. Validate context for incident type
      if (args.type === 'incident' && !args.context) {
        throw new Error(
          'Cannot add incident comment: context field is required for incident type comments.'
        );
      }

      // 2. Read root index
      const root = await store.readRootIndex();

      // 3. Create comment object
      const comment: ProjectComment = {
        type: args.type,
        priority: args.priority,
        timestamp: now(),
        agent: args.agent,
        note: args.note,
      };

      // 4. Add context if provided
      if (args.context) {
        comment.context = args.context as IncidentContext;
      }

      // 5. Append to project_comments
      root.project_comments.push(comment);

      // 6. Update timestamp
      root.last_updated = now();

      // 7. Write root index
      await store.writeRootIndex(root);
    });

    // Return updated root index
    const updatedRoot = await store.readRootIndex();
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(updatedRoot, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error adding project comment: ${(error as Error).message}`,
        },
      ],
      isError: true,
    };
  }
}

/**
 * Register observation tools on the MCP server
 */
/**
 * @internal — exported for unit testing only. Follows the `_internal` naming convention (§53).
 */
export const _internal = {
  AddObservationSchema,
  AddProjectCommentSchema,
};

export function register(server: McpServer): void {
  server.registerTool(
    'ledger_add_observation',
    {
      description: 'Add an observation/comment to the most recent pipeline of the specified type. REQUIRED params: work_package_id, pipeline_type, type, priority, note. The pipeline must already exist (use ledger_start_pipeline first). Use cwd_path (workspace root) for auto-detection, or project_path if already known.',
      inputSchema: AddObservationSchema,
    },
    addObservation as any
  );

  server.registerTool(
    'ledger_add_project_comment',
    {
      description: 'Add a project-level comment. REQUIRED params: type, priority, agent, note. If type is "incident", the context param is also required (with os, tool, resolved fields). Use cwd_path (workspace root) for auto-detection, or project_path if already known.',
      inputSchema: AddProjectCommentSchema,
    },
    addProjectComment as any
  );
}
