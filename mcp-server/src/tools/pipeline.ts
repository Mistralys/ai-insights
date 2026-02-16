import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { LedgerStore } from '../storage/ledger-store.js';
import { now } from '../utils/timestamp.js';
import type { Pipeline } from '../schema/work-package.js';
import { validatePlanPathOrError } from '../utils/path-validator.js';

/**
 * Tool: start_pipeline
 *
 * Starts a new pipeline for a work package.
 * Validates WP is IN_PROGRESS and no duplicate in-progress pipeline exists.
 */
const StartPipelineSchema = z.object({
  project_path: z.string().describe('Absolute path to the project directory'),
  work_package_id: z
    .string()
    .regex(/^WP-\d{3}$/)
    .describe('Work package ID (e.g., WP-001)'),
  type: z.string().describe('Pipeline type (e.g., implementation, qa, review)'),
});

async function startPipeline(args: z.infer<typeof StartPipelineSchema>) {
  const validationError = validatePlanPathOrError(args.project_path);
  if (validationError) return validationError;

  const store = new LedgerStore(args.project_path);

  try {
    await store.updateWorkPackageWithSync(args.work_package_id, (wp, root) => {
      // 1. Validate WP is IN_PROGRESS
      if (wp.status !== 'IN_PROGRESS') {
        throw new Error(
          `Cannot start pipeline for work package ${args.work_package_id}: work package status is ${wp.status}. Only IN_PROGRESS work packages can have pipelines started.`
        );
      }

      // 2. Check for duplicate in-progress pipeline of same type
      const existingInProgress = wp.pipelines.find(
        (p) => p.type === args.type && p.status === 'IN_PROGRESS'
      );

      if (existingInProgress) {
        throw new Error(
          `Cannot start pipeline: a pipeline of type "${args.type}" is already IN_PROGRESS for work package ${args.work_package_id}. Complete the existing pipeline before starting a new one.`
        );
      }

      // 3. Create new pipeline entry
      const newPipeline: Pipeline = {
        type: args.type,
        status: 'IN_PROGRESS',
        started_at: now(),
        summary: [],
      };

      // 4. Append to pipelines array
      wp.pipelines.push(newPipeline);

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
          text: `Error starting pipeline: ${(error as Error).message}`,
        },
      ],
      isError: true,
    };
  }
}

/**
 * Tool: complete_pipeline
 *
 * Completes the most recent IN_PROGRESS pipeline of the specified type.
 * Sets status, completion timestamp, summary, and optional fields.
 */
const CompletePipelineSchema = z.object({
  project_path: z.string().describe('Absolute path to the project directory'),
  work_package_id: z
    .string()
    .regex(/^WP-\d{3}$/)
    .describe('Work package ID (e.g., WP-001)'),
  type: z.string().describe('Pipeline type to complete'),
  status: z.enum(['PASS', 'FAIL']).describe('Pipeline completion status'),
  summary: z.array(z.string()).describe('Summary points for the pipeline'),
  artifacts: z
    .object({
      files_modified: z.array(z.string()).optional(),
      commit_hash: z.string().optional(),
      pull_request: z.string().optional(),
    })
    .optional()
    .describe('Artifacts produced by the pipeline'),
  metrics: z
    .object({
      test_coverage: z.string().optional(),
      tests_passed: z.number().optional(),
      tests_failed: z.number().optional(),
      security_issues: z.number().optional(),
    })
    .passthrough()
    .optional()
    .describe('Metrics captured during the pipeline'),
  comments: z
    .array(
      z.object({
        type: z.string(),
        priority: z.enum(['low', 'medium', 'high']),
        timestamp: z.string(),
        note: z.string(),
      })
    )
    .optional()
    .describe('Comments and observations from the pipeline'),
  acceptance_criteria_updates: z
    .array(
      z.object({
        criterion: z.string(),
        met: z.boolean(),
      })
    )
    .optional()
    .describe('Updates to acceptance criteria met status'),
});

async function completePipeline(args: z.infer<typeof CompletePipelineSchema>) {
  const validationError = validatePlanPathOrError(args.project_path);
  if (validationError) return validationError;

  const store = new LedgerStore(args.project_path);

  try {
    await store.updateWorkPackageWithSync(args.work_package_id, (wp, root) => {
      // 1. Find most recent IN_PROGRESS pipeline of given type
      const pipelineIndex = wp.pipelines
        .map((p, idx) => ({ pipeline: p, index: idx }))
        .reverse()
        .find((p) => p.pipeline.type === args.type && p.pipeline.status === 'IN_PROGRESS');

      if (!pipelineIndex) {
        throw new Error(
          `Cannot complete pipeline: no IN_PROGRESS pipeline of type "${args.type}" found for work package ${args.work_package_id}.`
        );
      }

      const pipeline = pipelineIndex.pipeline;

      // 2. Update pipeline status and completion fields
      pipeline.status = args.status;
      pipeline.completed_at = now();
      pipeline.summary = args.summary;

      // 3. Set optional fields
      if (args.artifacts) {
        pipeline.artifacts = args.artifacts;
      }

      if (args.metrics) {
        pipeline.metrics = args.metrics;
      }

      if (args.comments) {
        pipeline.comments = args.comments;
      }

      // 4. Update acceptance criteria if provided
      if (args.acceptance_criteria_updates) {
        for (const update of args.acceptance_criteria_updates) {
          const criterion = wp.acceptance_criteria.find(
            (ac) => ac.criterion === update.criterion
          );

          if (criterion) {
            criterion.met = update.met;
          }
        }
      }

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
          text: `Error completing pipeline: ${(error as Error).message}`,
        },
      ],
      isError: true,
    };
  }
}

/**
 * Register pipeline tools on the MCP server
 */
export function register(server: McpServer): void {
  server.tool(
    'ledger_start_pipeline',
    'Start a new pipeline for a work package. Validates WP is IN_PROGRESS and rejects duplicate in-progress pipelines.',
    StartPipelineSchema.shape,
    startPipeline
  );

  server.tool(
    'ledger_complete_pipeline',
    'Complete the most recent IN_PROGRESS pipeline of the specified type. Sets status, completion timestamp, summary, and optional fields.',
    CompletePipelineSchema.shape,
    completePipeline
  );
}
