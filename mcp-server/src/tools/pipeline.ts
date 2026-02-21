import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { LedgerStore } from '../storage/ledger-store.js';
import { now } from '../utils/timestamp.js';
import type { Pipeline, HandoffNote } from '../schema/work-package.js';
import { validatePlanPathOrError } from '../utils/path-validator.js';
import {
  PIPELINE_PREREQUISITES,
  PIPELINE_AGENT_MAP,
  NEXT_AGENT_MAP,
  PipelineTypeEnum,
  type PipelineType,
} from '../utils/pipeline-maps.js';

/**
 * Build a next-step guidance string for the agent after completing a pipeline.
 *
 * On PASS: directs the agent to call ledger_get_handoff_status.
 * On FAIL: tells the agent who will rework and what to do (leave WP as
 * IN_PROGRESS so the Developer can pick it up via ledger_get_next_action).
 *
 * Returning explicit guidance at every state transition is a self-healing
 * measure — agents never have to guess what to do next.
 */
function buildCompletionGuidance(
  wpId: string,
  pipelineType: PipelineType,
  status: 'PASS' | 'FAIL',
): string {
  const currentAgent = PIPELINE_AGENT_MAP[pipelineType] ?? pipelineType;
  const nextAgent = NEXT_AGENT_MAP[pipelineType] ?? 'the next agent';

  if (status === 'PASS') {
    if (pipelineType === 'documentation') {
      return (
        `\n\n--- NEXT STEP ---\n` +
        `Pipeline PASS. As the Documentation agent, you should now mark ${wpId} as COMPLETE ` +
        `using ledger_update_work_package_status (status: "COMPLETE", agent: "Documentation"). ` +
        `Then call ledger_get_handoff_status to confirm handoff.`
      );
    }
    return (
      `\n\n--- NEXT STEP ---\n` +
      `Pipeline PASS. Call ledger_get_handoff_status (current_agent: "${currentAgent}") ` +
      `to confirm your work is done and hand off to ${nextAgent}.`
    );
  }

  // FAIL path
  if (pipelineType === 'implementation') {
    return (
      `\n\n--- NEXT STEP ---\n` +
      `Pipeline FAIL. Leave ${wpId} as IN_PROGRESS. ` +
      `The Developer will see this via ledger_get_next_action and rework. ` +
      `Call ledger_get_handoff_status to confirm handoff.`
    );
  }

  // QA or code-review FAIL → Developer needs to rework the implementation
  return (
    `\n\n--- NEXT STEP ---\n` +
    `Pipeline FAIL. Do NOT set ${wpId} to BLOCKED — leave it as IN_PROGRESS. ` +
    `The Developer will see the FAIL ${pipelineType} pipeline via ledger_get_next_action and rework the implementation. ` +
    `Call ledger_get_handoff_status to confirm handoff back to the Developer.`
  );
}

/**
 * @internal — exported for unit testing only
 */
export const _internal = {
  PIPELINE_PREREQUISITES,
  PIPELINE_AGENT_MAP,
  NEXT_AGENT_MAP,
  buildCompletionGuidance,
};

/**
 * Tool: start_pipeline
 *
 * Starts a new pipeline for a work package.
 * Validates WP is IN_PROGRESS and no duplicate in-progress pipeline exists.
 */
const StartPipelineSchema = z.object({
  project_path: z.string().describe('Absolute path to the plan directory (e.g., "f:\\project\\docs\\agents\\plans\\2026-02-16-feature")'),
  work_package_id: z
    .string()
    .regex(/^WP-\d{3}$/)
    .describe('Work package ID, format: WP-001, WP-002, etc.'),
  type: PipelineTypeEnum.describe('Pipeline type: "implementation", "qa", "code-review", or "documentation"'),
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

      // 3. Enforce pipeline ordering: check prerequisite
      const prerequisite = PIPELINE_PREREQUISITES[args.type];
      if (prerequisite !== undefined && prerequisite !== null) {
        const hasPassPrerequisite = wp.pipelines.some(
          (p) => p.type === prerequisite && p.status === 'PASS'
        );
        if (!hasPassPrerequisite) {
          throw new Error(
            `Cannot start '${args.type}' pipeline: requires a PASS '${prerequisite}' pipeline first. Pipeline order: implementation → qa → code-review → documentation.`
          );
        }
      }

      // 4. Create new pipeline entry
      const newPipeline: Pipeline = {
        type: args.type,
        status: 'IN_PROGRESS',
        started_at: now(),
        summary: [],
      };

      // 5. Increment rework_count if restarting a previously-failed pipeline of the same type
      const hasPreviousFail = wp.pipelines.some(
        (p) => p.type === args.type && p.status === 'FAIL'
      );
      if (hasPreviousFail) {
        wp.rework_count = (wp.rework_count ?? 0) + 1;
      }

      // 6. Append to pipelines array
      wp.pipelines.push(newPipeline);

      // 7. Update assigned_to to reflect the agent now working on this WP
      const agentName = PIPELINE_AGENT_MAP[args.type];
      if (agentName) {
        wp.assigned_to = agentName;
        const summary = root.work_packages.find(
          (s) => s.work_package_id === args.work_package_id
        );
        if (summary) {
          summary.assigned_to = agentName;
        }
      }

      // 8. Update root index timestamp
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
  project_path: z.string().describe('Absolute path to the plan directory (e.g., "f:\\\\project\\\\docs\\\\agents\\\\plans\\\\2026-02-16-feature")'),
  work_package_id: z
    .string()
    .regex(/^WP-\d{3}$/)
    .describe('Work package ID, format: WP-001, WP-002, etc.'),
  type: PipelineTypeEnum.describe('Pipeline type to complete: "implementation", "qa", "code-review", or "documentation"'),
  status: z.enum(['PASS', 'FAIL']).describe('Pipeline result: "PASS" if successful, "FAIL" if issues found'),
  summary: z.array(z.string()).describe('Array of summary strings describing what was done (e.g., ["Implemented feature X", "Added tests"])'),
  artifacts: z
    .object({
      files_modified: z.array(z.string()).optional(),
      commit_hash: z.string().optional(),
      pull_request: z.string().optional(),
    })
    .passthrough()
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
      }).passthrough()
    )
    .optional()
    .describe('Observations and comments from the pipeline. Each object: { type, priority, timestamp (ISO 8601), note }. Types for implementation: "code-smell", "refactor", "improvement", "debt", "convention". Types for QA: "bug", "regression", "edge-case", "coverage-gap". Priority: "high" (likely bugs/security), "medium" (quality/DX degradation), "low" (nice-to-have). Be specific: reference file paths and function names. If no observations, include one { type: "improvement", note: "No observations — code is clean and consistent." } entry to confirm active review.'),
  acceptance_criteria_updates: z
    .array(
      z.object({
        criterion: z.string(),
        met: z.boolean(),
      }).passthrough()
    )
    .optional()
    .describe('Updates to acceptance criteria met status. This is the PRIMARY way to mark acceptance criteria as met—you must update criteria here before marking a work package as COMPLETE.'),
  handoff_notes: z
    .array(z.string())
    .optional()
    .describe('Notes for the next agent in the pipeline. Will be attached to the WP as a structured handoff note entry.'),
});

async function completePipeline(args: z.infer<typeof CompletePipelineSchema>) {
  const validationError = validatePlanPathOrError(args.project_path);
  if (validationError) return validationError;

  const store = new LedgerStore(args.project_path);

  try {
    await store.updateWorkPackageWithSync(args.work_package_id, (wp, root) => {
      // 1. Find most recent IN_PROGRESS pipeline of given type
      const pipeline = wp.pipelines
        .filter((p) => p.type === args.type && p.status === 'IN_PROGRESS')
        .at(-1);

      if (!pipeline) {
        throw new Error(
          `Cannot complete pipeline: no IN_PROGRESS pipeline of type "${args.type}" found for work package ${args.work_package_id}.`
        );
      }

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

      // 5. Append handoff note if provided
      if (args.handoff_notes && args.handoff_notes.length > 0) {
        const fromAgent = PIPELINE_AGENT_MAP[args.type] ?? args.type;
        const toAgent = NEXT_AGENT_MAP[args.type] ?? 'Unknown';
        const note: HandoffNote = {
          from_agent: fromAgent,
          to_agent: toAgent,
          timestamp: now(),
          notes: args.handoff_notes,
        };
        if (!wp.handoff_notes) {
          wp.handoff_notes = [];
        }
        wp.handoff_notes.push(note);
      }

      // 6. Update root index timestamp
      root.last_updated = now();

      return { wp, root };
    });

    // Return updated work package with next-step guidance
    const updatedWp = await store.readWorkPackage(args.work_package_id);
    const guidance = buildCompletionGuidance(
      args.work_package_id,
      args.type,
      args.status,
    );
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(updatedWp, null, 2) + guidance,
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
 * Tool: cancel_pipeline
 *
 * Cancels the most recent IN_PROGRESS pipeline of the specified type by setting
 * its status to FAIL and recording the cancellation reason as the summary.
 */
const CancelPipelineSchema = z.object({
  project_path: z.string().describe('Absolute path to the plan directory (e.g., "f:\\\\project\\\\docs\\\\agents\\\\plans\\\\2026-02-16-feature")'),
  work_package_id: z
    .string()
    .regex(/^WP-\d{3}$/)
    .describe('Work package ID, format: WP-001, WP-002, etc.'),
  type: PipelineTypeEnum.describe('Pipeline type to cancel: "implementation", "qa", "code-review", or "documentation"'),
  reason: z.string().describe('Reason for cancelling the pipeline (stored as summary)'),
});

async function cancelPipeline(args: z.infer<typeof CancelPipelineSchema>) {
  const validationError = validatePlanPathOrError(args.project_path);
  if (validationError) return validationError;

  const store = new LedgerStore(args.project_path);

  try {
    await store.updateWorkPackageWithSync(args.work_package_id, (wp, root) => {
      // Find the most recent IN_PROGRESS pipeline of the requested type
      const pipeline = wp.pipelines
        .filter((p) => p.type === args.type && p.status === 'IN_PROGRESS')
        .at(-1);

      if (!pipeline) {
        throw new Error(
          `Cannot cancel pipeline: no IN_PROGRESS pipeline of type "${args.type}" found for work package ${args.work_package_id}.`
        );
      }

      pipeline.status = 'FAIL';
      pipeline.completed_at = now();
      pipeline.summary = [`Cancelled: ${args.reason}`];

      root.last_updated = now();
      return { wp, root };
    });

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
          text: `Error cancelling pipeline: ${(error as Error).message}`,
        },
      ],
      isError: true,
    };
  }
}

/**
 * Tool: update_pipeline_progress
 *
 * Updates the summary of the most recent IN_PROGRESS pipeline of the given type.
 * Allows agents to record progress notes without completing the pipeline.
 */
const UpdatePipelineProgressSchema = z.object({
  project_path: z.string().describe('Absolute path to the plan directory (e.g., "f:\\\\project\\\\docs\\\\agents\\\\plans\\\\2026-02-16-feature")'),
  work_package_id: z
    .string()
    .regex(/^WP-\d{3}$/)
    .describe('Work package ID, format: WP-001, WP-002, etc.'),
  type: PipelineTypeEnum.describe('Pipeline type: "implementation", "qa", "code-review", or "documentation"'),
  summary: z.array(z.string()).describe('Updated summary strings to record as partial progress'),
});

async function updatePipelineProgress(args: z.infer<typeof UpdatePipelineProgressSchema>) {
  const validationError = validatePlanPathOrError(args.project_path);
  if (validationError) return validationError;

  const store = new LedgerStore(args.project_path);

  try {
    await store.updateWorkPackageWithSync(args.work_package_id, (wp, root) => {
      // Find the most recent IN_PROGRESS pipeline of the given type
      const pipeline = wp.pipelines
        .filter((p) => p.type === args.type && p.status === 'IN_PROGRESS')
        .at(-1);

      if (!pipeline) {
        throw new Error(
          `Cannot update pipeline progress: no IN_PROGRESS pipeline of type "${args.type}" found for work package ${args.work_package_id}.`
        );
      }

      pipeline.summary = args.summary;

      root.last_updated = now();
      return { wp, root };
    });

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
          text: `Error updating pipeline progress: ${(error as Error).message}`,
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
  server.registerTool(
    'ledger_start_pipeline',
    {
      description: 'Start a new pipeline for a work package. REQUIRED params: project_path, work_package_id, type. The type must be one of: "implementation", "qa", "code-review", "documentation". WP must be IN_PROGRESS (use ledger_claim_work_package first if READY). Rejects duplicate in-progress pipelines of the same type.',
      inputSchema: StartPipelineSchema.passthrough(),
    },
    startPipeline as any
  );

  server.registerTool(
    'ledger_complete_pipeline',
    {
      description: 'Complete the most recent IN_PROGRESS pipeline of the specified type. REQUIRED params: project_path, work_package_id, type, status (PASS or FAIL), summary. OPTIONAL but important: acceptance_criteria_updates (PRIMARY way to mark AC as met before COMPLETE), artifacts (files_modified, commit_hash), metrics (test_coverage, tests_passed/failed), comments (observations — REQUIRED for implementation pipelines). Must call ledger_start_pipeline first. On completion, response includes a NEXT STEP guidance block.',
      inputSchema: CompletePipelineSchema.passthrough(),
    },
    completePipeline as any
  );

  server.registerTool(
    'ledger_cancel_pipeline',
    {
      description: 'Cancel the most recent IN_PROGRESS pipeline of a given type by setting it to FAIL with the provided reason. Use this to clean up stale pipelines detected by RESUME_OR_CANCEL from ledger_get_next_action. REQUIRED params: project_path, work_package_id, type, reason.',
      inputSchema: CancelPipelineSchema.passthrough(),
    },
    cancelPipeline as any
  );

  server.registerTool(
    'ledger_update_pipeline_progress',
    {
      description: 'Update the summary of the most recent IN_PROGRESS pipeline without completing it. Allows agents to record partial progress notes mid-work. REQUIRED params: project_path, work_package_id, type, summary.',
      inputSchema: UpdatePipelineProgressSchema.passthrough(),
    },
    updatePipelineProgress as any
  );
}
