import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { LedgerStore } from '../storage/ledger-store.js';
import type { AcceptanceCriterion } from '../schema/work-package.js';
import { now } from '../utils/timestamp.js';
import { canStartWorkPackage } from '../schema/validators.js';
import { resolveProjectPath } from '../utils/project-resolver.js';
import {
  PipelineTypeEnum,
  PipelineType,
  DEFAULT_PIPELINE_STAGES,
  PIPELINE_AGENT_MAP,
  validateActiveStages,
  getOrderedActiveStages,
} from '../utils/pipeline-maps.js';
import { clearSynthesisState, MAX_REWORK_COUNT } from '../utils/workflow-helpers.js';
import { resolveMultiStoreLedgerRoot } from '../utils/store-resolution.js';
import { requirePmRole } from '../utils/pm-role-guard.js';
import { propagateDependencyReblock } from './work-package.js';

/**
 * PM-only administrative tools for work packages.
 *
 * These are escape hatches for the Project Manager role, used to correct
 * ledger state that the normal WP lifecycle (claim → pipelines → status
 * transitions, all in `work-package.ts`) has no path to fix on its own —
 * stuck rework counters, mistakenly cancelled work packages, and acceptance
 * criteria text that needs editing after the fact. None of the normal WP
 * flow touches this module.
 */

/**
 * @internal — exported for unit testing only
 */
export const _internal = {
  resetReworkCount,
  reopenCancelledWp,
  updateAcceptanceCriteria,
  updatePipelineStages,
};

// ─────────────────────────────────────────────────────────────────────────────
// Tool: reset_rework_count (§16.3b)
// ─────────────────────────────────────────────────────────────────────────────

const ResetReworkCountSchema = z.object({
  project_path: z.string().optional().describe('Absolute path to the plan folder. Use this if you already have it from a previous tool response or if it was provided in your instructions. Takes precedence over cwd_path if both are given.'),
  cwd_path: z.string().optional().describe('Your current workspace root directory. The server auto-detects the active project. Ignored if project_path is also provided.'),
  work_package_id: z
    .string()
    .regex(/^WP-\d{3,}$/)
    .describe('ID of the work package'),
  pipeline_type: PipelineTypeEnum
    .describe('Which pipeline type rework count to reset'),
  agent_role: z.string().describe('Must be "Project Manager"'),
  reason: z.string().trim().min(1).describe('Mandatory reason for the reset (audit trail)'),});

async function resetReworkCount(
  args: z.infer<typeof ResetReworkCountSchema>,
  _ledgerRoot?: string
) {
  let projectPath: string;
  try {
    projectPath = await resolveProjectPath(args);
  } catch (err) {
    return { content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }], isError: true };
  }

  const ledgerRoot = await resolveMultiStoreLedgerRoot(projectPath, _ledgerRoot);
  const store = new LedgerStore(projectPath, ledgerRoot);

  try {
    // PM-only guard
    const pmGuard = requirePmRole('ledger_reset_rework_count', args.agent_role);
    if (pmGuard) {
      return pmGuard;
    }

    // Reason guard — Zod .trim().min(1) already rejects empty/whitespace-only strings;
    // this branch remains unreachable but is kept as a belt-and-suspenders safety net.

    let noOp = false;
    let previousValue = 0;

    await store.updateWorkPackageWithSync(args.work_package_id, (wp, root) => {
      const current = wp.rework_counts?.[args.pipeline_type] ?? 0;

      if (current === 0) {
        noOp = true;
        return { wp, root };
      }

      previousValue = current;

      // Reset the specific pipeline count to 0
      if (!wp.rework_counts) {
        wp.rework_counts = {};
      }
      wp.rework_counts[args.pipeline_type] = 0;

      // Record audit comment on root index
      root.project_comments.push({
        type: 'rework_reset',
        priority: 'high',
        timestamp: now(),
        agent: 'Project Manager',
        note: `Reset rework count for ${args.pipeline_type} on ${args.work_package_id} from ${previousValue} to 0. Reason: ${args.reason}`,
      });
      root.last_updated = now();

      return { wp, root };
    });

    if (noOp) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                message: 'No-op: rework count is already 0 or absent. No changes written.',
                work_package_id: args.work_package_id,
                pipeline_type: args.pipeline_type,
              },
              null,
              2
            ),
          },
        ],
      };
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              message: `Rework count for ${args.pipeline_type} on ${args.work_package_id} reset from ${previousValue} to 0.`,
              work_package_id: args.work_package_id,
              pipeline_type: args.pipeline_type,
              previous_value: previousValue,
              reason: args.reason,
            },
            null,
            2
          ),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error resetting rework count: ${(error as Error).message}`,
        },
      ],
      isError: true,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool: reopen_cancelled_wp (§16.3d)
// ─────────────────────────────────────────────────────────────────────────────

const ReopenCancelledWpSchema = z.object({
  project_path: z.string().optional().describe('Absolute path to the plan folder. Use this if you already have it from a previous tool response or if it was provided in your instructions. Takes precedence over cwd_path if both are given.'),
  cwd_path: z.string().optional().describe('Your current workspace root directory. The server auto-detects the active project. Ignored if project_path is also provided.'),
  work_package_id: z
    .string()
    .regex(/^WP-\d{3,}$/)
    .describe('ID of the work package to reopen'),
  agent_role: z.string().describe('Must be "Project Manager"'),
  reason: z.string().trim().min(1).describe('Mandatory reason for reopening the cancelled WP (audit trail)'),
});

async function reopenCancelledWp(
  args: z.infer<typeof ReopenCancelledWpSchema>,
  _ledgerRoot?: string
) {
  // PM-only guard — reject before any disk I/O
  const pmGuard = requirePmRole('ledger_reopen_cancelled_wp', args.agent_role);
  if (pmGuard) {
    return pmGuard;
  }

  let projectPath: string;
  try {
    projectPath = await resolveProjectPath(args);
  } catch (err) {
    return { content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }], isError: true };
  }

  const ledgerRoot = await resolveMultiStoreLedgerRoot(projectPath, _ledgerRoot);
  const store = new LedgerStore(projectPath, ledgerRoot);

  try {
    let notCancelledStatus: string | null = null;
    let finalStatus: 'READY' | 'BLOCKED' = 'READY';

    await store.updateWorkPackageWithSync(args.work_package_id, (wp, root) => {
      // Precondition: WP must be CANCELLED
      if (wp.status !== 'CANCELLED') {
        notCancelledStatus = wp.status;
        return { wp, root };
      }

      const timestamp = now();

      // Dependency-aware initial status (matches createWorkPackage L306–316 semantics — single-write)
      const depCheck = canStartWorkPackage(wp, root.work_packages);
      if (depCheck.allowed) {
        wp.status = 'READY';
        delete wp.blocked_by;
        finalStatus = 'READY';
      } else {
        wp.status = 'BLOCKED';
        finalStatus = 'BLOCKED';
        const unmetDeps = wp.dependencies.filter(
          (depId) =>
            !root.work_packages.some(
              (w) => w.work_package_id === depId && w.status === 'COMPLETE'
            )
        );
        wp.blocked_by = {
          type: 'dependency',
          description: `Blocked: unmet dependencies: ${unmetDeps.join(', ')}`,
          ...(unmetDeps.length === 1 ? { blocking_work_package: unmetDeps[0] } : {}),
        };
      }

      // Standard bookkeeping for all status transitions
      wp.status_changed_at = timestamp;

      // Clear assignment and rework history
      wp.assigned_to = null;
      delete wp.rework_counts;

      // Sync root summary (mirrors updateWorkPackageStatus L873–L877 pattern)
      const summary = root.work_packages.find(
        (s) => s.work_package_id === args.work_package_id
      );
      if (summary) {
        summary.status = wp.status;
        summary.assigned_to = null;
      }

      // Increment pending counter (CANCELLED was terminal; WP is now non-terminal)
      root.pending_work_packages += 1;

      // Invalidate synthesis
      clearSynthesisState(root);

      // Audit comment
      root.project_comments.push({
        type: 'reopen_cancelled',
        priority: 'high',
        timestamp,
        agent: 'Project Manager',
        note: `Reopened CANCELLED work package ${args.work_package_id} to ${wp.status}. Reason: ${args.reason}`,
      });
      root.last_updated = timestamp;

      return { wp, root };
    });

    // Precondition violation — return error without further action
    if (notCancelledStatus !== null) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error: ledger_reopen_cancelled_wp requires a CANCELLED work package. ${args.work_package_id} is currently ${notCancelledStatus}.`,
          },
        ],
        isError: true,
      };
    }

    // Post-write: cascade reblock downstream dependents that may have been relying on
    // the CANCELLED WP being terminal (same pattern as COMPLETE → IN_PROGRESS reopen)
    await propagateDependencyReblock(projectPath, args.work_package_id, { store });

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              message: `Work package ${args.work_package_id} reopened from CANCELLED to ${finalStatus}.`,
              work_package_id: args.work_package_id,
              final_status: finalStatus,
              reason: args.reason,
            },
            null,
            2
          ),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error reopening cancelled work package: ${(error as Error).message}`,
        },
      ],
      isError: true,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool: update_acceptance_criteria (§12.3b)
// ─────────────────────────────────────────────────────────────────────────────

const UpdateAcceptanceCriteriaSchema = z.object({
  project_path: z.string().optional().describe('Absolute path to the plan folder. Use this if you already have it from a previous tool response or if it was provided in your instructions. Takes precedence over cwd_path if both are given.'),
  cwd_path: z.string().optional().describe('Your current workspace root directory. The server auto-detects the active project. Ignored if project_path is also provided.'),
  work_package_id: z
    .string()
    .regex(/^WP-\d{3,}$/)
    .describe('ID of the work package'),
  agent_role: z.string().describe('Must be "Project Manager"'),
  operations: z
    .array(
      z.discriminatedUnion('action', [
        z.object({
          action: z.literal('remove'),
          criterion: z.string().describe('Exact text of the criterion to remove'),
        }),
        z.object({
          action: z.literal('modify_text'),
          old_criterion: z.string().describe('Exact text of the existing criterion'),
          new_criterion: z.string().trim().min(1).describe('New criterion text (must be non-empty)'),        }),
      ])
    )
    .min(1)
    .describe('List of operations to apply'),
});

async function updateAcceptanceCriteria(
  args: z.infer<typeof UpdateAcceptanceCriteriaSchema>,
  _ledgerRoot?: string
) {
  let projectPath: string;
  try {
    projectPath = await resolveProjectPath(args);
  } catch (err) {
    return { content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }], isError: true };
  }

  // PM-only guard
  const pmGuard = requirePmRole('ledger_update_acceptance_criteria', args.agent_role);
  if (pmGuard) {
    return pmGuard;
  }

  const ledgerRoot = await resolveMultiStoreLedgerRoot(projectPath, _ledgerRoot);
  const store = new LedgerStore(projectPath, ledgerRoot);

  try {
    let appliedOps: string[] = [];

    await store.updateWorkPackageWithSync(args.work_package_id, (wp, root) => {
      // CANCELLED guard
      if (wp.status === 'CANCELLED') {
        throw new Error(
          `Cannot update acceptance criteria on CANCELLED work package ${args.work_package_id}.`
        );
      }

      // Clone the criteria array before any mutation
      const updatedCriteria: AcceptanceCriterion[] = wp.acceptance_criteria.map((c) => ({ ...c }));

      // Apply operations sequentially
      for (const op of args.operations) {
        if (op.action === 'remove') {
          const idx = updatedCriteria.findIndex((c) => c.criterion === op.criterion);
          if (idx === -1) {
            throw new Error(
              `Criterion not found (remove): "${op.criterion}"`
            );
          }
          updatedCriteria.splice(idx, 1);
          appliedOps.push(`removed: "${op.criterion}"`);
        } else {
          // modify_text
          const idx = updatedCriteria.findIndex((c) => c.criterion === op.old_criterion);
          if (idx === -1) {
            throw new Error(
              `Criterion not found (modify_text): "${op.old_criterion}"`
            );
          }
          updatedCriteria[idx]!.criterion = op.new_criterion;
          // modify_text intentionally preserves the existing 'met' value — only the text changes, not the progress state.
          appliedOps.push(`modified: "${op.old_criterion}" → "${op.new_criterion}"`);
        }
      }

      // Post-operations: at-least-one-criterion guard
      if (updatedCriteria.length === 0) {
        throw new Error('At least one acceptance criterion is required. Cannot remove all criteria.');
      }

      wp.acceptance_criteria = updatedCriteria;
      root.last_updated = now();

      return { wp, root };
    });

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              message: `Acceptance criteria updated on ${args.work_package_id}.`,
              applied_operations: appliedOps,
            },
            null,
            2
          ),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error updating acceptance criteria: ${(error as Error).message}`,
        },
      ],
      isError: true,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool: update_pipeline_stages
// ─────────────────────────────────────────────────────────────────────────────

const UpdatePipelineStagesSchema = z.object({
  project_path: z.string().optional().describe('Absolute path to the plan folder. Use this if you already have it from a previous tool response or if it was provided in your instructions. Takes precedence over cwd_path if both are given.'),
  cwd_path: z.string().optional().describe('Your current workspace root directory. The server auto-detects the active project. Ignored if project_path is also provided.'),
  work_package_id: z
    .string()
    .regex(/^WP-\d{3,}$/)
    .describe('ID of the work package'),
  agent_role: z.string().describe('Must be "Project Manager"'),
  stages: z
    .array(z.string())
    .min(1)
    .describe('The complete replacement active_pipeline_stages list — a non-empty subsequence of the canonical ordering: implementation → qa → security-audit → code-review → release-engineering → documentation. Replaces the WP\'s existing list in full; it is not an add/remove delta.'),
  reason: z.string().trim().min(1).describe('Mandatory reason for the stage-list change (audit trail)'),
});

async function updatePipelineStages(
  args: z.infer<typeof UpdatePipelineStagesSchema>,
  _ledgerRoot?: string
) {
  // Guard 1 — PM-only, rejected before any disk I/O
  const pmGuard = requirePmRole('ledger_update_pipeline_stages', args.agent_role);
  if (pmGuard) {
    return pmGuard;
  }

  // Guard 2 — structural validation of the proposed list, rejected before any disk I/O.
  // Runs ahead of project resolution and the WP read so an invalid list never reaches
  // the store regardless of the target WP's current status.
  const { errors, warnings } = validateActiveStages(args.stages);
  if (errors.length > 0) {
    return {
      content: [{ type: 'text' as const, text: `Error: ${errors[0]}` }],
      isError: true,
    };
  }

  let projectPath: string;
  try {
    projectPath = await resolveProjectPath(args);
  } catch (err) {
    return { content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }], isError: true };
  }

  const ledgerRoot = await resolveMultiStoreLedgerRoot(projectPath, _ledgerRoot);
  const store = new LedgerStore(projectPath, ledgerRoot);

  // Canonicalise once — validateActiveStages already confirmed every entry is a known,
  // non-duplicate PipelineType in canonical order, so this reorder is a no-op for an
  // already-ordered list and a safety net for callers that pass stages out of sequence
  // (validateActiveStages rejects those, so in practice this is always a stable reorder).
  const newStages = getOrderedActiveStages(args.stages as PipelineType[]);

  try {
    let previousStages: PipelineType[] = [];
    let assignedToCleared = false;

    await store.updateWorkPackageWithSync(args.work_package_id, (wp, root) => {
      // Guard 3 — CANCELLED is terminal; nothing about its pipeline chain can be revised.
      if (wp.status === 'CANCELLED') {
        throw new Error(
          `Cannot update pipeline stages on CANCELLED work package ${args.work_package_id}.`
        );
      }

      // Guard 4 — COMPLETE must be reopened via ledger_update_work_package_status first.
      // Evaluated ahead of the removal guard (6) so a COMPLETE WP always reports this
      // message, never the removal-guard message, even when the requested list also
      // removes an already-passed stage.
      if (wp.status === 'COMPLETE') {
        throw new Error(
          `Work package ${args.work_package_id} is COMPLETE. Reopen it first with ` +
          `ledger_update_work_package_status (status: "IN_PROGRESS", agent: "Project Manager"), ` +
          `then retry ledger_update_pipeline_stages.`
        );
      }

      // Guard 5 — no IN_PROGRESS pipeline may be orphaned by a stage-list change.
      const runningPipeline = wp.pipelines.find((p) => p.status === 'IN_PROGRESS');
      if (runningPipeline) {
        throw new Error(
          `Cannot update pipeline stages on ${args.work_package_id}: a "${runningPipeline.type}" ` +
          `pipeline is currently IN_PROGRESS. Complete it or use ledger_cancel_pipeline first.`
        );
      }

      previousStages = getOrderedActiveStages(
        (wp.active_pipeline_stages as PipelineType[] | undefined) ?? [...DEFAULT_PIPELINE_STAGES]
      );
      const removedStages = previousStages.filter((s) => !newStages.includes(s));

      // Guard 6 — removing a stage that already has an executed (non-auto_cancelled)
      // pipeline record would hide completed work from the stage list. Adding a stage
      // is always safe and carries no equivalent check.
      for (const removed of removedStages) {
        const executed = wp.pipelines.some((p) => p.type === removed && !p.auto_cancelled);
        if (executed) {
          throw new Error(
            `Cannot remove stage "${removed}" from ${args.work_package_id}: it has an executed pipeline ` +
            `record (a non-auto_cancelled pipeline run). Removing it would erase visible history. ` +
            `Only never-run stages may be removed.`
          );
        }
      }

      // Guard 7 — a removed never-run stage currently owned by the WP's assignee strands
      // that assignment invisibly from every role's ledger_get_next_action view. Null it
      // out in the same write, mirroring the IN_PROGRESS → READY and reopenCancelledWp
      // precedent for clearing assigned_to on a stage-invalidating mutation.
      for (const removed of removedStages) {
        const owningRole = PIPELINE_AGENT_MAP[removed];
        if (owningRole && wp.assigned_to === owningRole) {
          wp.assigned_to = null;
          assignedToCleared = true;
          break;
        }
      }

      wp.active_pipeline_stages = newStages;

      const wpSummary = root.work_packages.find(
        (s) => s.work_package_id === args.work_package_id
      );
      if (wpSummary) {
        wpSummary.active_pipeline_stages = newStages;
        if (assignedToCleared) {
          wpSummary.assigned_to = null;
        }
      }

      root.project_comments.push({
        type: 'pipeline_stages_updated',
        priority: 'high',
        timestamp: now(),
        agent: 'Project Manager',
        note: `Updated pipeline stages on ${args.work_package_id} from [${previousStages.join(', ')}] to ` +
          `[${newStages.join(', ')}]. Reason: ${args.reason}`,
      });
      root.last_updated = now();

      return { wp, root };
    });

    // Rework-limit caveat: a restaged WP's existing rework_counts are left untouched by
    // design (§ Notes), but a counter already at the limit will still refuse the next
    // start on that pipeline type — surface that here so the caller knows to pair this
    // call with ledger_reset_rework_count when relevant.
    const updatedWp = await store.readWorkPackage(args.work_package_id);
    const reworkAtLimit = Object.entries(updatedWp.rework_counts ?? {}).filter(
      ([, count]) => (count ?? 0) >= MAX_REWORK_COUNT
    );

    const nextStepParts = [`Call ledger_get_next_action to resume the workflow for ${args.work_package_id}.`];
    if (reworkAtLimit.length > 0) {
      const names = reworkAtLimit.map(([type, count]) => `${type} (${count}/${MAX_REWORK_COUNT})`).join(', ');
      nextStepParts.push(
        `Rework count(s) at or above the limit: ${names}. Call ledger_reset_rework_count for the ` +
        `affected pipeline type(s) before retrying that stage, or the next start will still be refused.`
      );
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              message: `Pipeline stages updated on ${args.work_package_id}.`,
              work_package_id: args.work_package_id,
              previous_stages: previousStages,
              new_stages: newStages,
              warnings,
              next_step: nextStepParts.join(' '),
            },
            null,
            2
          ),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error updating pipeline stages: ${(error as Error).message}`,
        },
      ],
      isError: true,
    };
  }
}

/**
 * Register PM-only administrative work package tools on the MCP server
 */
export function register(server: McpServer): void {
  server.registerTool(
    'ledger_reset_rework_count',
    {
      description: 'PM-only: resets the rework counter for a specific pipeline type on a work package back to 0. Records an audit comment. No-op if counter is already 0.',
      inputSchema: ResetReworkCountSchema,
    },
    (args) => resetReworkCount(args)
  );

  server.registerTool(
    'ledger_reopen_cancelled_wp',
    {
      description: 'PM-only administrative override: reopens an incorrectly cancelled work package back to READY (or BLOCKED if deps unsatisfied). Clears assignment, resets rework counts, adjusts pending counter, invalidates synthesis, and fires cascade reblock on downstream dependents. Requires a mandatory reason for the audit trail.',
      inputSchema: ReopenCancelledWpSchema,
    },
    (args) => reopenCancelledWp(args)
  );

  server.registerTool(
    'ledger_update_acceptance_criteria',
    {
      description: 'PM-only: remove or modify acceptance criteria text on a work package. Rejects operations that would leave zero criteria. Supported operations: remove (by exact text), modify_text (old → new).',
      inputSchema: UpdateAcceptanceCriteriaSchema,
    },
    (args) => updateAcceptanceCriteria(args)
  );

  server.registerTool(
    'ledger_update_pipeline_stages',
    {
      description: 'PM-only: replaces a work package\'s complete active_pipeline_stages list (not an add/remove delta). Rejects CANCELLED and COMPLETE work packages (COMPLETE must be reopened via ledger_update_work_package_status first), a running IN_PROGRESS pipeline, and removal of any stage with an executed pipeline record. Removing a never-run stage currently owned by the WP\'s assignee clears assigned_to. Records a pipeline_stages_updated audit comment and never touches rework_counts.',
      inputSchema: UpdatePipelineStagesSchema,
    },
    (args) => updatePipelineStages(args)
  );
}
