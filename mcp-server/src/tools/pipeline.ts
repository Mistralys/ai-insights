import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { LedgerStore } from '../storage/ledger-store.js';
import { now } from '../utils/timestamp.js';
import type { Pipeline, HandoffNote } from '../schema/work-package.js';
import { resolveProjectPath } from '../utils/path-validator.js';
import {
  PIPELINE_PREREQUISITES,
  PIPELINE_AGENT_MAP,
  NEXT_AGENT_MAP,
  FAIL_ROUTING_MAP,
  PipelineTypeEnum,
  type PipelineType,
} from '../utils/pipeline-maps.js';
import { MAX_REWORK_COUNT, checkRevalidationGuard, hasDownstreamFail } from '../utils/workflow-helpers.js';
import { propagateDependencyUnblock } from './work-package.js';

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
  autoFinalizeResult: 'finalized' | 'blocked' | null = null,
  unmetCriteria: string[] = [],
): string {
  const currentAgent = PIPELINE_AGENT_MAP[pipelineType] ?? pipelineType;
  const nextAgent = NEXT_AGENT_MAP[pipelineType] ?? 'the next agent';

  if (status === 'PASS') {
    if (pipelineType === 'documentation') {
      if (autoFinalizeResult === 'finalized') {
        return (
          `\n\n--- NEXT STEP ---\n` +
          `Pipeline PASS. WP ${wpId} was auto-finalized to COMPLETE (all acceptance criteria met). ` +
          `Call ledger_get_handoff_status (current_agent: "Documentation") to confirm handoff.`
        );
      }
      if (autoFinalizeResult === 'blocked') {
        const criteriaList = unmetCriteria.map((c) => `  - ${c}`).join('\n');
        return (
          `\n\n--- NEXT STEP ---\n` +
          `Pipeline PASS but WP ${wpId} was NOT auto-finalized: the following acceptance criteria are still unmet:\n${criteriaList}\n\n` +
          `Update the unmet criteria via ledger_complete_pipeline (with acceptance_criteria_updates) or ask the Project Manager ` +
          `to use ledger_update_work_package_status if manual completion is needed.`
        );
      }
      // Fallback (e.g. PM override completing a doc pipeline): preserve original guidance
      return (
        `\n\n--- NEXT STEP ---\n` +
        `Pipeline PASS. Call ledger_get_handoff_status (current_agent: "Documentation") to confirm handoff.`
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
 * Intentionally placed here (after all const declarations) to avoid temporal dead zone
 * with the Zod schemas defined below.
 */

/**
 * Tool: start_pipeline
 *
 * Starts a new pipeline for a work package.
 * Validates WP is IN_PROGRESS and no duplicate in-progress pipeline exists.
 */
const StartPipelineSchema = z.object({
  project_path: z.string().optional().describe('Plan folder path — use only if you already have it from a previous tool response. Otherwise prefer cwd_path.'),
  cwd_path: z.string().optional().describe('Your workspace root directory — preferred. The server auto-detects the active project.'),
  work_package_id: z
    .string()
    .regex(/^WP-\d{3,}$/)
    .describe('Work package ID, format: WP-001, WP-002, etc.'),
  type: PipelineTypeEnum.describe('Pipeline type: "implementation", "qa", "code-review", or "documentation"'),
  agent_role: z
    .string()
    .describe('Your agent role. Must match the pipeline type owner: "Developer" for implementation, "QA" for qa, "Reviewer" for code-review, "Documentation" for documentation. "Project Manager" is always allowed (PM Override).'),
});

async function startPipeline(args: z.infer<typeof StartPipelineSchema>) {
  let projectPath: string;
  try {
    projectPath = await resolveProjectPath(args);
  } catch (err) {
    return { content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }], isError: true };
  }

  const store = new LedgerStore(projectPath);

  try {
    await store.updateWorkPackageWithSync(args.work_package_id, (wp, root) => {
      // 1. Validate agent role — PM may bypass role ownership (PM Override gate)
      const expectedAgent = PIPELINE_AGENT_MAP[args.type];
      const isPmOverride = args.agent_role === 'Project Manager';
      if (!isPmOverride && expectedAgent !== args.agent_role) {
        throw new Error(
          `Pipeline type '${args.type}' can only be started by the ${expectedAgent} agent. You provided agent_role: '${args.agent_role}'.`
        );
      }

      // 2. Validate WP is IN_PROGRESS
      if (wp.status !== 'IN_PROGRESS') {
        throw new Error(
          `Cannot start pipeline for work package ${args.work_package_id}: work package status is ${wp.status}. Only IN_PROGRESS work packages can have pipelines started.`
        );
      }

      // 3. Check for duplicate in-progress pipeline of same type
      const existingInProgress = wp.pipelines.find(
        (p) => p.type === args.type && p.status === 'IN_PROGRESS'
      );

      if (existingInProgress) {
        throw new Error(
          `Cannot start pipeline: a pipeline of type "${args.type}" is already IN_PROGRESS for work package ${args.work_package_id}. Complete the existing pipeline before starting a new one.`
        );
      }

      // 4. Enforce pipeline ordering: check prerequisite (most-recent semantics per §8.2)
      const prerequisite = PIPELINE_PREREQUISITES[args.type];
      if (prerequisite !== undefined && prerequisite !== null) {
        const prereqPipelines = wp.pipelines.filter((p) => p.type === prerequisite);
        const mostRecentPrereq = prereqPipelines.at(-1);
        if (!mostRecentPrereq || mostRecentPrereq.status !== 'PASS') {
          throw new Error(
            `Cannot start '${args.type}' pipeline: requires a PASS '${prerequisite}' pipeline first. Pipeline order: implementation → qa → code-review → documentation.`
          );
        }

        // 4b. Revalidation guard: reject if a prior run exists and the prerequisite
        //     PASS is stale after upstream rework (§11.1).
        const revalidError = checkRevalidationGuard(wp.pipelines, args.type, prerequisite);
        if (revalidError !== null) {
          throw new Error(revalidError);
        }
      }

      // 5. Create new pipeline entry
      const newPipeline: Pipeline = {
        type: args.type,
        status: 'IN_PROGRESS',
        started_at: now(),
        summary: isPmOverride ? ['[PM Override]'] : [],
      };

      // 6. Increment rework_counts per pipeline type if this is a rework run.
      //    A rework is triggered by either a direct FAIL on this pipeline type or
      //    a downstream FAIL that requires this type to re-run (§11.3).
      const effectiveSamePipelines = wp.pipelines.filter(
        (p) => p.type === args.type && !p.auto_cancelled
      );
      const isDirectRework = effectiveSamePipelines.at(-1)?.status === 'FAIL';
      const isDownstreamRework = hasDownstreamFail(wp.pipelines, args.type);
      const needsRework = isDirectRework || isDownstreamRework;

      if (needsRework) {
        const current = wp.rework_counts?.[args.type] ?? 0;
        const newCount = current + 1;
        wp.rework_counts = { ...wp.rework_counts, [args.type]: newCount };
      }

      // 6b. Circuit breaker — reject if the per-type rework count has reached the limit
      // Uses post-increment count; the throw below aborts the write, so the
      // increment is never persisted if the circuit breaker fires.
      const effectiveReworkCount = wp.rework_counts?.[args.type] ?? 0;
      if (effectiveReworkCount >= MAX_REWORK_COUNT) {
        throw new Error(
          `Rework circuit breaker: ${args.work_package_id} has reached the maximum rework count (${MAX_REWORK_COUNT}). ` +
          `Consider cancelling this work package (transition to CANCELLED) or restructuring the approach.`
        );
      }

      // 7. Append to pipelines array
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
  project_path: z.string().optional().describe('Plan folder path — use only if you already have it from a previous tool response. Otherwise prefer cwd_path.'),
  cwd_path: z.string().optional().describe('Your workspace root directory — preferred. The server auto-detects the active project.'),
  work_package_id: z
    .string()
    .regex(/^WP-\d{3,}$/)
    .describe('Work package ID, format: WP-001, WP-002, etc.'),
  type: PipelineTypeEnum.describe('Pipeline type to complete: "implementation", "qa", "code-review", or "documentation"'),
  status: z.enum(['PASS', 'FAIL']).describe('Pipeline result: "PASS" if successful, "FAIL" if issues found'),
  summary: z.union([z.string(), z.array(z.string())]).describe('Summary of what was done. Accepts a single string or an array of strings (e.g., "Implemented feature X" or ["Implemented feature X", "Added tests"]).'),
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
        timestamp: z.string().optional(),
        note: z.string(),
      }).passthrough()
    )
    .optional()
    .describe('Observations and comments from the pipeline. Each object: { type, priority, note } (timestamp is auto-filled if omitted). Types for implementation: "code-smell", "refactor", "improvement", "debt", "convention". Types for QA: "bug", "regression", "edge-case", "coverage-gap". Priority: "high" (likely bugs/security), "medium" (quality/DX degradation), "low" (nice-to-have). Be specific: reference file paths and function names. If no observations, include one { type: "improvement", note: "No observations — code is clean and consistent." } entry to confirm active review.'),
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
  agent_role: z
    .string()
    .describe('Your agent role. Must match the pipeline type owner: "Developer" for implementation, "QA" for qa, "Reviewer" for code-review, "Documentation" for documentation. "Project Manager" is always allowed (PM Override).'),
});

async function completePipeline(rawArgs: z.infer<typeof CompletePipelineSchema>) {
  // ── Normalize lenient inputs ──────────────────────────────────────────────
  // summary: coerce a bare string to a single-element array
  const normalizedSummary: string[] = typeof rawArgs.summary === 'string'
    ? [rawArgs.summary]
    : rawArgs.summary;

  // comments[].timestamp: auto-fill missing timestamps with server time
  const normalizedComments = rawArgs.comments?.map((c) => ({
    ...c,
    timestamp: c.timestamp ?? now(),
  }));

  const args = {
    ...rawArgs,
    summary: normalizedSummary,
    comments: normalizedComments,
  };
  // ────────────────────────────────────────────────────────────────────────────

  let projectPath: string;
  try {
    projectPath = await resolveProjectPath(args);
  } catch (err) {
    return { content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }], isError: true };
  }

  const store = new LedgerStore(projectPath);

  // Track auto-finalize result to embed in response (set inside updateWorkPackageWithSync callback)
  let autoFinalizeResult: 'finalized' | 'blocked' | null = null;
  let unmetCriteriaList: string[] = [];

  try {
    await store.updateWorkPackageWithSync(args.work_package_id, (wp, root) => {
      // 0. Defense-in-depth: WP must be IN_PROGRESS to complete a pipeline
      if (wp.status !== 'IN_PROGRESS') {
        throw new Error(
          `Cannot complete pipeline for WP ${args.work_package_id}: WP status is ${wp.status}. Only IN_PROGRESS work packages may have pipelines completed.`
        );
      }

      // 0b. Agent role must match the pipeline type owner (PM may override)
      const expectedAgent = PIPELINE_AGENT_MAP[args.type];
      const isPmOverride = args.agent_role === 'Project Manager';
      if (!isPmOverride && args.agent_role !== expectedAgent) {
        throw new Error(
          `Pipeline type '${args.type}' must be completed by ${expectedAgent}. You provided agent_role: '${args.agent_role}'.`
        );
      }

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
          } else {
            wp.acceptance_criteria.push({ criterion: update.criterion, met: update.met });
          }
        }
      }

      // 4b. Auto-finalize (§WP-006): fires only when Documentation agent completes a
      // documentation pipeline with PASS and all acceptance criteria are met.
      // The check occurs AFTER acceptance_criteria_updates so freshly-marked criteria
      // are evaluated. PM overrides bypass auto-finalize intentionally.
      const isDocPass = args.type === 'documentation' && args.status === 'PASS';
      const isDocAgent = args.agent_role === 'Documentation';
      if (isDocPass && isDocAgent) {
        const unmet = wp.acceptance_criteria
          .filter((ac) => !ac.met)
          .map((ac) => ac.criterion);
        if (unmet.length === 0) {
          // All criteria met — auto-finalize WP
          wp.status = 'COMPLETE';
          wp.status_changed_at = now();
          const wpSummary = root.work_packages.find(
            (s) => s.work_package_id === args.work_package_id
          );
          if (wpSummary) {
            wpSummary.status = 'COMPLETE';
          }
          // WP was IN_PROGRESS (non-terminal) → COMPLETE (terminal): decrement counter
          root.pending_work_packages -= 1;
          autoFinalizeResult = 'finalized';
        } else {
          // Criteria not met — do NOT finalize, flag blocked state
          unmetCriteriaList = unmet;
          autoFinalizeResult = 'blocked';
        }
      }

      // 5. Append handoff note if provided
      if (args.handoff_notes && args.handoff_notes.length > 0) {
        // PM override: report PM identity instead of the pipeline type's formal owner
        const fromAgent = isPmOverride
          ? 'Project Manager (PM Override)'
          : (PIPELINE_AGENT_MAP[args.type] ?? args.type);
        const toAgent = args.status === 'FAIL'
          ? (FAIL_ROUTING_MAP[args.type] ?? 'Developer')
          : (NEXT_AGENT_MAP[args.type] ?? 'Unknown');
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

    // §6.3: Any → COMPLETE must trigger propagateDependencyUnblock.
    // The auto-finalize path sets the WP to COMPLETE inside the lock scope above.
    // We call propagateDependencyUnblock AFTER the lock is released — it acquires
    // its own separate lock (§12.2, Gotcha 8). Gate on autoFinalizeResult === 'finalized'
    // so we only pay the I/O cost when a COMPLETE transition actually occurred.
    if (autoFinalizeResult === 'finalized') {
      await propagateDependencyUnblock(projectPath, args.work_package_id, { store });
    }

    // Return updated work package with next-step guidance
    const updatedWp = await store.readWorkPackage(args.work_package_id);
    const guidance = buildCompletionGuidance(
      args.work_package_id,
      args.type,
      args.status,
      autoFinalizeResult,
      unmetCriteriaList,
    );

    // Build response payload — embed auto-finalize signals if applicable
    const responsePayload: Record<string, unknown> = { ...updatedWp };
    if (autoFinalizeResult === 'finalized') {
      responsePayload.auto_finalized = true;
    } else if (autoFinalizeResult === 'blocked') {
      responsePayload.auto_finalize_blocked = true;
      responsePayload.unmet_criteria = unmetCriteriaList;
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(responsePayload, null, 2) + guidance,
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
  project_path: z.string().optional().describe('Plan folder path — use only if you already have it from a previous tool response. Otherwise prefer cwd_path.'),
  cwd_path: z.string().optional().describe('Your workspace root directory — preferred. The server auto-detects the active project.'),
  work_package_id: z
    .string()
    .regex(/^WP-\d{3,}$/)
    .describe('Work package ID, format: WP-001, WP-002, etc.'),
  type: PipelineTypeEnum.describe('Pipeline type to cancel: "implementation", "qa", "code-review", or "documentation"'),
  reason: z.string().describe('Reason for cancelling the pipeline (stored as summary)'),
});

async function cancelPipeline(args: z.infer<typeof CancelPipelineSchema>) {
  let projectPath: string;
  try {
    projectPath = await resolveProjectPath(args);
  } catch (err) {
    return { content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }], isError: true };
  }

  const store = new LedgerStore(projectPath);

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
  project_path: z.string().optional().describe('Plan folder path — use only if you already have it from a previous tool response. Otherwise prefer cwd_path.'),
  cwd_path: z.string().optional().describe('Your workspace root directory — preferred. The server auto-detects the active project.'),
  work_package_id: z
    .string()
    .regex(/^WP-\d{3,}$/)
    .describe('Work package ID, format: WP-001, WP-002, etc.'),
  type: PipelineTypeEnum.describe('Pipeline type: "implementation", "qa", "code-review", or "documentation"'),
  summary: z.array(z.string()).describe('Updated summary strings to record as partial progress'),
});

async function updatePipelineProgress(args: z.infer<typeof UpdatePipelineProgressSchema>) {
  let projectPath: string;
  try {
    projectPath = await resolveProjectPath(args);
  } catch (err) {
    return { content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }], isError: true };
  }

  const store = new LedgerStore(projectPath);

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
      description: 'Start a new pipeline for a work package. REQUIRED params: work_package_id, type. The type must be one of: "implementation", "qa", "code-review", "documentation". WP must be IN_PROGRESS (use ledger_claim_work_package first if READY). Rejects duplicate in-progress pipelines of the same type. Use cwd_path (workspace root) for auto-detection, or project_path if already known.',
      inputSchema: StartPipelineSchema,
    },
    startPipeline as any
  );

  server.registerTool(
    'ledger_complete_pipeline',
    {
      description: 'Complete the most recent IN_PROGRESS pipeline of the specified type. REQUIRED params: work_package_id, type, agent_role ("Developer"|"QA"|"Reviewer"|"Documentation" or "Project Manager"), status (PASS or FAIL), summary (string or array). OPTIONAL: acceptance_criteria_updates (PRIMARY way to mark AC as met before COMPLETE), artifacts (files_modified, commit_hash), metrics (test_coverage, tests_passed/failed), comments (observations with auto-timestamping — timestamp is auto-filled if omitted). Must call ledger_start_pipeline first. On completion, response includes a NEXT STEP guidance block. Use cwd_path (workspace root) for auto-detection, or project_path if already known.',
      inputSchema: CompletePipelineSchema,
    },
    completePipeline as any
  );

  server.registerTool(
    'ledger_cancel_pipeline',
    {
      description: 'Cancel the most recent IN_PROGRESS pipeline of a given type by setting it to FAIL with the provided reason. Use this to clean up stale pipelines detected by RESUME_OR_CANCEL from ledger_get_next_action. REQUIRED params: work_package_id, type, reason. Use cwd_path (workspace root) for auto-detection, or project_path if already known.',
      inputSchema: CancelPipelineSchema,
    },
    cancelPipeline as any
  );

  server.registerTool(
    'ledger_update_pipeline_progress',
    {
      description: 'Update the summary of the most recent IN_PROGRESS pipeline without completing it. Allows agents to record partial progress notes mid-work. REQUIRED params: work_package_id, type, summary. Use cwd_path (workspace root) for auto-detection, or project_path if already known.',
      inputSchema: UpdatePipelineProgressSchema,
    },
    updatePipelineProgress as any
  );
}

/**
 * @internal — exported for unit testing only. All test-only exports from this module
 * are consolidated here under `_internal` (see constraint §53).
 */
export const _internal = {
  PIPELINE_PREREQUISITES,
  PIPELINE_AGENT_MAP,
  NEXT_AGENT_MAP,
  FAIL_ROUTING_MAP,
  buildCompletionGuidance,
  startPipeline,
  completePipeline,
  // Schemas (formerly _schemas — renamed to _internal per §53)
  StartPipelineSchema,
  CompletePipelineSchema,
  CancelPipelineSchema,
  UpdatePipelineProgressSchema,
};
