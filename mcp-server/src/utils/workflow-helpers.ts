/**
 * Shared workflow helpers — stateless utility functions and constants used by
 * all three workflow tool modules (workflow-next-action, workflow-handoff,
 * workflow-batch-actions).
 *
 * Nothing in this file registers MCP tools or imports from `tools/`. It only
 * imports from `schema/`, `storage/`, and sibling `utils/` modules.
 */

import type { WorkPackageDetail, Pipeline } from '../schema/work-package.js';
import type { RootIndex } from '../schema/root-index.js';
import { parseTimestamp } from './timestamp.js';
import type { PostImplPipelineType } from './pipeline-maps.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Number of hours after which an IN_PROGRESS pipeline is considered stale.
 */
export const STALE_PIPELINE_HOURS = 24;

/** Maximum number of automatic handoff chain steps to prevent infinite loops. */
export const MAX_HANDOFF_DEPTH = 10;

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

/**
 * Builds the prompt string passed to the next agent during auto-handoff.
 * Intentionally minimal — the receiving agent's persona contains full workflow instructions.
 */
export function buildHandoffPrompt(projectPath: string): string {
  return `Project path: ${projectPath}`;
}

// ---------------------------------------------------------------------------
// Display maps (used by batch-actions and next-action tools)
// ---------------------------------------------------------------------------

/** Display-name maps used by getNextActions for human-readable output.
 * These deliberately exclude 'implementation' — only post-impl stages appear
 * in batch action output. PostImplPipelineType enforces this at compile time. */
export const agentNameMap: Record<PostImplPipelineType, string> = {
  'qa': 'QA',
  'code-review': 'Reviewer',
  'documentation': 'Documentation',
};
export const actionNameMap: Record<PostImplPipelineType, string> = {
  'qa': 'RUN_QA',
  'code-review': 'RUN_REVIEW',
  'documentation': 'WRITE_DOCS',
};
export const reworkActionMap: Record<PostImplPipelineType, string> = {
  'qa': 'REWORK_QA',
  'code-review': 'REWORK_REVIEW',
  'documentation': 'REWORK_DOCS',
};

/** Agent role name used in next_steps tool-call guidance for each pipeline type. */
export const pipelineAgentRoleMap: Record<string, string> = {
  'implementation': 'Developer',
  'qa': 'QA',
  'code-review': 'Reviewer',
  'documentation': 'Documentation',
};

// ---------------------------------------------------------------------------
// Pipeline-state guards
// ---------------------------------------------------------------------------

/**
 * Helper: Returns true if the pipeline is IN_PROGRESS and was started more than
 * STALE_PIPELINE_HOURS hours ago.
 */
export function isStalePipeline(pipeline: Pipeline): boolean {
  if (pipeline.status !== 'IN_PROGRESS' || !pipeline.started_at) return false;
  const startedAt = parseTimestamp(pipeline.started_at).getTime();
  const ageHours = (Date.now() - startedAt) / (1000 * 60 * 60);
  return ageHours > STALE_PIPELINE_HOURS;
}

/**
 * Helper: Returns true only if the most recent pipeline of the given type has FAIL status.
 * A [FAIL, PASS] sequence correctly returns false — only historical FAILs preceding a PASS are ignored.
 */
export function isMostRecentPipelineFail(pipelines: Pipeline[], pipelineType: string): boolean {
  const mostRecent = pipelines.filter((p) => p.type === pipelineType).at(-1);
  return mostRecent?.status === 'FAIL';
}

/**
 * Helper: Check if a work package is blocked by dependencies.
 *
 * Uses RootIndex summaries (already in memory) rather than loading full WP
 * detail files. Called in getDeveloperAction and getNextActions where the
 * root index is available but full detail arrays are not pre-loaded for all WPs.
 *
 * See also: isBlockedByDependencies — a functionally equivalent helper that
 * takes the full WorkPackageDetail[] array, used in getHandoff* functions
 * where all WP details are loaded upfront.
 */
export function hasDependencyBlocked(
  wpDetail: WorkPackageDetail,
  rootIndex: RootIndex
): boolean {
  if (wpDetail.dependencies.length === 0) {
    return false;
  }

  // Check if any dependency is not COMPLETE
  for (const depId of wpDetail.dependencies) {
    const depSummary = rootIndex.work_packages.find(
      (wp) => wp.work_package_id === depId
    );

    if (!depSummary || depSummary.status !== 'COMPLETE') {
      return true;
    }
  }

  return false;
}

/**
 * Helper function: Check if a WP is blocked by incomplete dependencies.
 *
 * Operates on the full WorkPackageDetail[] array rather than RootIndex summaries,
 * making it suitable for getHandoff* functions where all WP details are already
 * loaded. For contexts where only the root index is available, use
 * hasDependencyBlocked instead.
 */
export function isBlockedByDependencies(
  wp: WorkPackageDetail,
  allWpDetails: WorkPackageDetail[]
): boolean {
  if (!wp.dependencies || wp.dependencies.length === 0) {
    return false;
  }

  // Check if any dependency is not COMPLETE
  return wp.dependencies.some((depId) => {
    const depWp = allWpDetails.find((w) => w.work_package_id === depId);
    return !depWp || depWp.status !== 'COMPLETE';
  });
}

// ---------------------------------------------------------------------------
// Response builders
// ---------------------------------------------------------------------------

/** Shared response shape returned by action helpers and tool handlers. */
type ToolActionResponse = { content: [{ type: 'text'; text: string }] };

/**
 * Returns a RESUME_OR_CANCEL action response when the work package has a stale
 * IN_PROGRESS pipeline of the specified type, or null if none is found.
 */
export function extractStalePipelineAction(
  wpDetail: WorkPackageDetail,
  pipelineType: string,
): ToolActionResponse | null {
  const stalePipeline = wpDetail.pipelines.find(
    (p) => p.type === pipelineType && isStalePipeline(p)
  );
  if (!stalePipeline) return null;
  const startedAt = stalePipeline.started_at ?? 'unknown';
  const ageHours = stalePipeline.started_at
    ? Math.floor((Date.now() - parseTimestamp(stalePipeline.started_at).getTime()) / (1000 * 60 * 60))
    : -1;
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          {
            action: 'RESUME_OR_CANCEL',
            work_package_id: wpDetail.work_package_id,
            pipeline_type: pipelineType,
            started_at: startedAt,
            age_hours: ageHours,
            reason: `Work package ${wpDetail.work_package_id} has a stale '${pipelineType}' pipeline that has been IN_PROGRESS for ~${ageHours} hours. Resume or cancel it using ledger_cancel_pipeline.`,
          },
          null,
          2
        ),
      },
    ],
  };
}

/**
 * Returns a rework action response when the most recent pipeline of the specified
 * type for the work package has FAIL status, or null if no rework is needed.
 */
export function extractReworkAction(
  wpDetail: WorkPackageDetail,
  pipelineType: string,
  reworkActionName: string,
  reworkReason: string,
): ToolActionResponse | null {
  // BLOCKED WPs need upstream agent intervention (e.g. Developer rework)
  // before the current pipeline agent can retry — skip rework suggestion.
  if (wpDetail.status === 'BLOCKED') return null;
  if (!isMostRecentPipelineFail(wpDetail.pipelines, pipelineType)) return null;
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          {
            action: reworkActionName,
            work_package_id: wpDetail.work_package_id,
            reason: reworkReason,
          },
          null,
          2
        ),
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// WP detail helpers
// ---------------------------------------------------------------------------

/**
 * Helper: Returns handoff notes on the given WP addressed to agentName, or undefined.
 */
export function getHandoffNotesForAgent(
  wpDetail: WorkPackageDetail,
  agentName: string
): string[] | undefined {
  if (!wpDetail.handoff_notes || wpDetail.handoff_notes.length === 0) {
    return undefined;
  }
  const relevant = wpDetail.handoff_notes.filter((n) => n.to_agent === agentName);
  if (relevant.length === 0) return undefined;
  // Flatten all notes from matching entries into a single array
  return relevant.flatMap((n) => n.notes);
}
