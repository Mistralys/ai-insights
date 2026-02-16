import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { LedgerStore } from '../storage/ledger-store.js';
import { now } from '../utils/timestamp.js';
import { withLock } from '../storage/file-lock.js';
import type { PipelineComment, IncidentContext } from '../schema/work-package.js';
import type { ProjectComment } from '../schema/root-index.js';
import { validatePlanPathOrError } from '../utils/path-validator.js';

/**
 * Tool: add_observation
 *
 * Adds a comment to the most recent pipeline of the specified type.
 * Comments do NOT include an agent field (agent is inferred from pipeline type).
 */
const AddObservationSchema = z.object({
  project_path: z.string().describe('Absolute path to the project directory'),
  work_package_id: z
    .string()
    .regex(/^WP-\d{3}$/)
    .describe('Work package ID (e.g., WP-001)'),
  pipeline_type: z.string().describe('Pipeline type to add the observation to'),
  type: z
    .string()
    .describe(
      'Comment type (e.g., code-smell, refactor, improvement, debt, convention)'
    ),
  priority: z.enum(['low', 'medium', 'high']).describe('Priority of the observation'),
  note: z.string().describe('Detailed description of the observation'),
});

async function addObservation(args: z.infer<typeof AddObservationSchema>) {
  const validationError = validatePlanPathOrError(args.project_path);
  if (validationError) return validationError;

  const store = new LedgerStore(args.project_path);

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
  project_path: z.string().describe('Absolute path to the project directory'),
  type: z.string().describe('Comment type (e.g., incident, note, decision)'),
  priority: z.enum(['low', 'medium', 'high']).describe('Priority of the comment'),
  agent: z.string().describe('Agent name adding this comment'),
  note: z.string().describe('Detailed description of the comment'),
  context: z
    .object({
      os: z.string(),
      tool: z.string(),
      work_package: z.string().optional(),
      resolved: z.boolean(),
      workaround: z.string().optional(),
    })
    .optional()
    .describe('Context for incident type comments (required for incident type)'),
});

async function addProjectComment(args: z.infer<typeof AddProjectCommentSchema>) {
  const validationError = validatePlanPathOrError(args.project_path);
  if (validationError) return validationError;

  const store = new LedgerStore(args.project_path);

  try {
    await withLock(args.project_path, async () => {
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
export function register(server: McpServer): void {
  server.tool(
    'ledger_add_observation',
    'Add a comment to the most recent pipeline of the specified type. Comments do not include an agent field.',
    AddObservationSchema.shape,
    addObservation
  );

  server.tool(
    'ledger_add_project_comment',
    'Add a comment to the project-level comments array. For incident type comments, context is required.',
    AddProjectCommentSchema.shape,
    addProjectComment
  );
}
