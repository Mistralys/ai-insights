# MCP Server - Source (Tools)
_SOURCE: MCP tool handler implementations_
# MCP tool handler implementations
```
// Structure of documents
└── mcp-server/
    └── src/
        └── tools/
            └── begin-work.ts
            └── help-content.ts
            └── help.ts
            └── observations.ts
            └── pipeline.ts
            └── project-lifecycle.ts
            └── work-package.ts
            └── workflow-handoff.ts
            └── workflow-next-action-batch.ts
            └── workflow-next-action.ts
            └── workflow.ts

```
###  Path: `/mcp-server/src/tools/begin-work.ts`

```ts
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { LedgerStore } from '../storage/ledger-store.js';
import { now } from '../utils/timestamp.js';
import type { Pipeline } from '../schema/work-package.js';
import { resolveProjectPath } from '../utils/path-validator.js';
import {
  PIPELINE_AGENT_MAP,
  PipelineTypeEnum,
  describePipelineTypes,
  DEFAULT_PIPELINE_STAGES,
  resolvePrerequisite,
  type PipelineType,
} from '../utils/pipeline-maps.js';
import { MAX_REWORK_COUNT, checkRevalidationGuard, hasDownstreamFail } from '../utils/workflow-helpers.js';
import { canStartWorkPackage, isValidStatusTransition } from '../schema/validators.js';
import { CLAIMABLE_ROLES } from './work-package.js';

const BeginWorkSchema = z.object({
  project_path: z
    .string()
    .optional()
    .describe('Plan folder path — use only if you already have it from a previous tool response. Otherwise prefer cwd_path.'),
  cwd_path: z
    .string()
    .optional()
    .describe('Your workspace root directory — preferred. The server auto-detects the active project.'),
  work_package_id: z
    .string()
    .regex(/^WP-\d{3,}$/)
    .describe('Work package ID, format: WP-001, WP-002, etc.'),
  type: PipelineTypeEnum.describe(describePipelineTypes('Pipeline type to start:')),
  agent_role: z
    .string()
    .describe(
      'Your agent role identifier (e.g., "Developer", "QA"). Used for the claim guard and pipeline ownership validation.'
    ),
});

/**
 * beginWork: atomically claims a READY work package and starts its pipeline
 * in a single lock scope.
 *
 * If the WP is READY:
 *   - Applies CLAIMABLE_ROLES guard, assignment guard, dependency check.
 *   - Transitions the WP to IN_PROGRESS.
 *   - Starts the requested pipeline (with all ordering + rework guards).
 *   - Returns claimed: true.
 *
 * If the WP is already IN_PROGRESS and assigned to this agent:
 *   - Skips the claim phase (idempotent re-entry).
 *   - Starts the requested pipeline.
 *   - Returns claimed: false.
 *
 * All guards from both ledger_claim_work_package and ledger_start_pipeline
 * are preserved — this is a strict convenience wrapper, not a rule relaxation.
 */
async function beginWork(args: z.infer<typeof BeginWorkSchema>) {
  let projectPath: string;
  try {
    projectPath = await resolveProjectPath(args);
  } catch (err) {
    return { content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }], isError: true };
  }

  const store = new LedgerStore(projectPath);

  // Captured inside the updater callback and read after the lock releases.
  let claimed = false;

  try {
    await store.updateWorkPackageWithSync(args.work_package_id, (wp, root) => {
      // ===== CLAIM PHASE =====

      if (wp.status === 'READY') {
        // Guard 1: CLAIMABLE_ROLES — reject roles not permitted to claim WPs
        if (!CLAIMABLE_ROLES.includes(args.agent_role)) {
          throw new Error(
            `Agent role '${args.agent_role}' cannot claim work packages. ` +
              `Valid roles: ${CLAIMABLE_ROLES.filter((r) => !r.includes('Agent')).join(', ')}.`
          );
        }

        // Guard 2: Assignment guard — can only claim a WP assigned to your role
        if (wp.assigned_to && wp.assigned_to !== args.agent_role) {
          throw new Error(
            `Cannot begin work on ${args.work_package_id}: it is assigned to "${wp.assigned_to}" but you are "${args.agent_role}". ` +
              `Only claim work packages assigned to your role.`
          );
        }

        // Guard 3: Dependency check
        const depCheck = canStartWorkPackage(wp, root.work_packages);
        if (!depCheck.allowed) {
          throw new Error(
            `Cannot begin work on ${args.work_package_id}: ${depCheck.reason}`
          );
        }

        // Guard 4: Status transition validation (should always be valid here)
        if (!isValidStatusTransition(wp.status, 'IN_PROGRESS')) {
          throw new Error(`Invalid status transition: ${wp.status} -> IN_PROGRESS`);
        }

        // Apply claim
        wp.status = 'IN_PROGRESS';
        wp.status_changed_at = now();
        wp.assigned_to = args.agent_role;

        // Update root index summary
        const summary = root.work_packages.find(
          (s) => s.work_package_id === args.work_package_id
        );
        if (summary) {
          summary.status = 'IN_PROGRESS';
          summary.assigned_to = args.agent_role;
        }

        claimed = true;
      } else if (wp.status === 'IN_PROGRESS') {
        // Idempotent re-entry: skip claim if WP is already IN_PROGRESS.
        // Allow if the agent is the current assignee OR the legitimate pipeline-type owner.
        // The pipeline-start phase (below) re-validates via PIPELINE_AGENT_MAP and
        // auto-updates assigned_to on success, so this is safe and spec-compliant.
        const isPipelineOwner = PIPELINE_AGENT_MAP[args.type as PipelineType] === args.agent_role;
        if (wp.assigned_to !== args.agent_role && !isPipelineOwner) {
          throw new Error(
            `Cannot begin work on ${args.work_package_id}: it is IN_PROGRESS and assigned to "${wp.assigned_to}" but you are "${args.agent_role}". ` +
              `Only the assigned agent or the legitimate pipeline-type owner may start a pipeline on an IN_PROGRESS work package.`
          );
        }
        claimed = false;
      } else {
        throw new Error(
          `Cannot begin work on ${args.work_package_id}: work package status is ${wp.status}. ` +
            `Only READY or IN_PROGRESS work packages are supported by ledger_begin_work.`
        );
      }

      // ===== PIPELINE START PHASE =====

      // Guard 1: Agent role validation — only the correct pipeline type owner may start it.
      const expectedAgent = PIPELINE_AGENT_MAP[args.type as PipelineType];
      const isPmOverride = args.agent_role === 'Project Manager';
      if (!isPmOverride && expectedAgent !== args.agent_role) {
        throw new Error(
          `Pipeline type '${args.type}' can only be started by the ${expectedAgent} agent. You provided agent_role: '${args.agent_role}'.`
        );
      }

      // Guard 2: No duplicate in-progress pipeline of the same type.
      const existingInProgress = wp.pipelines.find(
        (p) => p.type === args.type && p.status === 'IN_PROGRESS'
      );
      if (existingInProgress) {
        throw new Error(
          `Cannot start pipeline: a pipeline of type "${args.type}" is already IN_PROGRESS for work package ${args.work_package_id}. Complete the existing pipeline before starting a new one.`
        );
      }

      // Guard 3: Pipeline ordering — prerequisite must be the most-recently PASS'd pipeline.
      const activeStages: readonly PipelineType[] =
        (wp.active_pipeline_stages as PipelineType[] | undefined) ?? DEFAULT_PIPELINE_STAGES;
      const prerequisite = resolvePrerequisite(args.type as PipelineType, activeStages);
      if (prerequisite !== null) {
        const prereqPipelines = wp.pipelines.filter((p) => p.type === prerequisite);
        const mostRecentPrereq = prereqPipelines.at(-1);
        if (!mostRecentPrereq || mostRecentPrereq.status !== 'PASS') {
          const orderedActive = (activeStages as readonly string[]).join(' → ');
          throw new Error(
            `Cannot start '${args.type}' pipeline: requires a PASS '${prerequisite}' pipeline first. Active pipeline order: ${orderedActive}.`
          );
        }

        // Guard 3b: Revalidation guard (§11.1) — reject if prerequisite PASS is stale after upstream rework.
        const revalidError = checkRevalidationGuard(
          wp.pipelines,
          args.type as PipelineType,
          prerequisite,
          activeStages,
        );
        if (revalidError !== null) {
          throw new Error(revalidError);
        }
      }

      // Guard 4: Rework count — increment if this is a rework run (§11.3).
      const effectiveSamePipelines = wp.pipelines.filter(
        (p) => p.type === args.type && !p.auto_cancelled
      );
      const isDirectRework = effectiveSamePipelines.at(-1)?.status === 'FAIL';
      const isDownstreamRework = hasDownstreamFail(wp.pipelines, args.type as PipelineType, activeStages);
      const needsRework = isDirectRework || isDownstreamRework;

      if (needsRework) {
        const current = wp.rework_counts?.[args.type] ?? 0;
        wp.rework_counts = { ...(wp.rework_counts ?? {}), [args.type]: current + 1 };
      }

      // Guard 5: Circuit breaker — reject if per-type rework count is at maximum.
      const effectiveReworkCount = wp.rework_counts?.[args.type] ?? 0;
      if (effectiveReworkCount >= MAX_REWORK_COUNT) {
        throw new Error(
          `Rework circuit breaker: ${args.work_package_id} has reached the maximum rework count (${MAX_REWORK_COUNT}). ` +
            `Consider cancelling this work package (transition to CANCELLED) or restructuring the approach.`
        );
      }

      // Append new pipeline entry.
      const newPipeline: Pipeline = {
        type: args.type as PipelineType,
        status: 'IN_PROGRESS',
        started_at: now(),
        summary: isPmOverride ? ['[PM Override]'] : [],
      };
      wp.pipelines.push(newPipeline);

      // Update assigned_to to reflect the agent now taking ownership of this WP.
      const agentName = PIPELINE_AGENT_MAP[args.type as PipelineType];
      if (agentName) {
        wp.assigned_to = agentName;
        const summary = root.work_packages.find(
          (s) => s.work_package_id === args.work_package_id
        );
        if (summary) {
          summary.assigned_to = agentName;
        }
      }

      root.last_updated = now();

      return { wp, root };
    });

    // Return updated work package with the claimed flag appended.
    const updatedWp = await store.readWorkPackage(args.work_package_id);
    const responsePayload = { ...updatedWp, claimed };
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(responsePayload, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error beginning work: ${(error as Error).message}`,
        },
      ],
      isError: true,
    };
  }
}

/**
 * @internal — exported for unit testing only
 */
export const _internal = {
  beginWork,
  BeginWorkSchema,
};

export function register(server: McpServer): void {
  server.registerTool(
    'ledger_begin_work',
    {
      description:
        'Claim a READY work package and start its pipeline in a single atomic call. ' +
        'Replaces the two-step ledger_claim_work_package + ledger_start_pipeline sequence. ' +
        'If the WP is already IN_PROGRESS and assigned to you, skips the claim phase (idempotent re-entry). ' +
        'REQUIRED params: work_package_id, type, agent_role. ' +
        'Response includes all standard WP fields plus claimed: boolean indicating whether the claim step ran. ' +
        'Use cwd_path (workspace root) for auto-detection, or project_path if already known.',
      inputSchema: BeginWorkSchema,
    },
    beginWork as any
  );
}

```
###  Path: `/mcp-server/src/tools/help-content.ts`

```ts
/**
 * Static documentation strings for all Project Ledger MCP tools.
 * Exported as TOOL_HELP and consumed by help.ts.
 */
import { PLAN_ARCHIVE_FILENAME, SYNTHESIS_ARCHIVE_FILENAME } from '../utils/constants.js';

export const TOOL_HELP: Record<string, string> = {
  overview: `
# Project Ledger MCP — Tool Reference

## Path Parameters

**Most tools accept either \`cwd_path\` or \`project_path\` — not both.** Use \`cwd_path\` (your workspace root) as the preferred option; the server auto-detects the active project. Only provide \`project_path\` if you already have it from a previous tool response. The one exception is \`ledger_initialize_project\`, which requires \`project_path\` (the plan folder is being created and cannot be detected yet).

## All Available Tools

| Tool | Required Params | Purpose |
|------|----------------|---------|
| ledger_get_project_status | cwd_path or project_path | Read project overview |
| ledger_initialize_project | project_path, plan_file | Create new project ledger |
| ledger_list_projects | None (status filter optional) | List all tracked projects with status, dates, and plan paths |
| ledger_complete_synthesis | cwd_path or project_path | Mark synthesis as generated; transitions project to COMPLETE |
| ledger_get_work_package | cwd_path or project_path, work_package_id | Read a work package's full detail |
| ledger_list_work_packages | cwd_path or project_path | List work packages (optional: status, assigned_to filters) |
| ledger_create_work_package | cwd_path or project_path, assigned_to, dependencies, acceptance_criteria, work_package_file | Create a new work package |
| ledger_claim_work_package | cwd_path or project_path, work_package_id, agent | Claim a READY WP → IN_PROGRESS |
| ledger_begin_work | cwd_path or project_path, work_package_id, type, agent_role | Claim + start pipeline in one atomic call |
| ledger_update_work_package_status | cwd_path or project_path, work_package_id, status, agent | Update WP status |
| ledger_start_pipeline | cwd_path or project_path, work_package_id, type | Start a pipeline for a work package (ordering determined by WP's active_pipeline_stages) |
| ledger_complete_pipeline | cwd_path or project_path, work_package_id, type, status, summary | Complete a pipeline |
| ledger_cancel_pipeline | cwd_path or project_path, work_package_id, type, reason | Cancel a stale IN_PROGRESS pipeline (sets to FAIL) |
| ledger_update_pipeline_progress | cwd_path or project_path, work_package_id, type, summary | Update summary of IN_PROGRESS pipeline without completing it |
| ledger_add_observation | cwd_path or project_path, work_package_id, pipeline_type, type, priority, note | Add observation to pipeline |
| ledger_add_project_comment | cwd_path or project_path, type, priority, agent, note | Add project-level comment |
| ledger_get_next_action | cwd_path or project_path, agent_role | Get next recommended action (optional: max_results for batch mode) |
| ledger_get_handoff_status | cwd_path or project_path, current_agent | Check handoff status |

## Common Mistakes

1. **Forgetting the "agent" parameter** — ledger_claim_work_package, ledger_update_work_package_status, and ledger_add_project_comment ALL require an "agent" param with your agent name.
2. **Wrong pipeline type names** — Use exactly: "implementation", "qa", "security-audit", "code-review", "release-engineering", "documentation". Only the pipeline types listed in a WP's \`active_pipeline_stages\` are valid for that WP.
3. **Trying to mark COMPLETE as the wrong terminal agent** — Only the agent owning the last active stage of the WP's pipeline can auto-finalize to COMPLETE. For the default 4-stage pipeline this is the Documentation agent. For non-standard compositions (e.g., verification-only \`["qa", "code-review"]\`), it is the agent owning the last active stage (e.g., Reviewer).
4. **Starting a pipeline before claiming the WP** — WP must be IN_PROGRESS before starting a pipeline.
5. **Not updating acceptance_criteria** — Use the acceptance_criteria_updates param in ledger_complete_pipeline to mark criteria as met before marking WP COMPLETE.
6. **Starting pipelines out of order** — Pipelines must follow the WP's active stage order (a subsequence of: implementation → qa → security-audit → code-review → release-engineering → documentation). Starting a stage requires a PASS pipeline on the immediately preceding active stage. Starting a stage not in the WP's \`active_pipeline_stages\` is also rejected.
7. **Setting WP to BLOCKED after a pipeline FAIL** — When QA or Reviewer fails a pipeline, do NOT set the WP to BLOCKED. Leave it as IN_PROGRESS so the Developer can find it via ledger_get_next_action and rework. BLOCKED should only be used for external blockers (missing APIs, pending decisions, etc.).
8. **Test-only WP references non-existent production method** — When creating a WP whose \`active_pipeline_stages\` excludes "implementation" (test-only, verification-only, or documentation-only), verify that all methods/functions referenced in the WP's scope already exist in production code. If they don't, the WP needs the "implementation" stage — otherwise the Developer will silently expand scope by adding production code inside a non-implementation WP.

## Workflow Order

1. PM creates work packages (ledger_create_work_package), optionally specifying a custom \`active_pipeline_stages\` to compose the pipeline (defaults to \`["implementation","qa","code-review","documentation"]\`)
2. Developer claims WP and starts pipeline in one call (\`ledger_begin_work\` type="implementation", agent_role="Developer"), completes pipeline (ledger_complete_pipeline). Note: starting a pipeline auto-updates assigned_to on the WP.
3. QA starts pipeline (type="qa"), completes pipeline
3a. *(Optional — only if WP's active_pipeline_stages includes "security-audit")* Security Auditor starts pipeline (type="security-audit"), completes pipeline
4. Reviewer starts pipeline (type="code-review"), completes pipeline
4a. *(Optional — only if WP's active_pipeline_stages includes "release-engineering")* Release Engineer starts pipeline (type="release-engineering"), completes pipeline
5. Documentation starts pipeline (type="documentation"), completes pipeline — if status=PASS and all acceptance criteria are met, the WP is automatically transitioned to COMPLETE (auto-finalize, no separate ledger_update_work_package_status call needed)

**Note:** The terminal agent (owner of the last active stage) triggers auto-finalize on PASS. For non-standard compositions (e.g., \`["qa","code-review"]\`), the Reviewer is the terminal agent who auto-finalizes the WP to COMPLETE.

**Important:** Every ledger_complete_pipeline response includes a "--- NEXT STEP ---" guidance block telling you exactly what to do next. Follow it.

## Rework After Pipeline FAIL

When a QA or code-review pipeline completes with FAIL:
- The agent who ran the failing pipeline should leave the WP as IN_PROGRESS (do NOT set to BLOCKED)
- Call ledger_get_handoff_status to confirm handoff
- The Developer will automatically see a REWORK action via ledger_get_next_action
- The Developer re-implements, then the pipeline chain continues from QA again

## Handoff Block Format

Every agent must end their response with the handoff block returned by ledger_get_handoff_status. The block uses three fields:

\`\`\`
CURRENT AGENT: <current_agent>
NEXT AGENT: <next_agent>
STATUS: <status>
\`\`\`

- **current_agent**: The agent that just finished working (you)
- **next_agent**: The agent that should pick up work next (derived from status)
- **status**: The workflow status (e.g., READY_FOR_QA, IN_PROGRESS, COMPLETE)

All three fields are returned by ledger_get_handoff_status — copy them verbatim.

## Action Tool max_results

- **ledger_get_next_action** (singular, default): Returns the first actionable WP for your role. Best for simple projects or when you process one WP at a time.
- **ledger_get_next_action with max_results > 1**: Returns up to N actionable WPs as an array under the "actions" key. Best for projects with many independent WPs.

## Storage Architecture

All ledger files are stored **centrally** at \`{mcp-server}/storage/ledger/{slug}/\` — not inside the plan folder.
- Plan folders remain purely human-readable markdown (no \`.ledger/\` subdirectory).
- The storage root can be overridden at server startup with \`--ledger-dir <path>\`.

### Files per project
- **\`project-ledger.json\`** — root index (WP summaries, counters, status)
- **\`WP-###.json\`** — individual work package detail files
- **\`.meta.json\`** — per-project metadata created automatically on \`ledger_initialize_project\`; contains: \`slug\`, \`plan_path\`, \`status\`, \`date_created\`, \`last_updated\`, optional \`title\`. Used by \`ledger_list_projects\` for cross-project discovery.
- **\`.lock\`** — file lock (managed automatically; do not edit)
`,

  ledger_get_project_status: `
# ledger_get_project_status

Read the project overview from the root index.

## Required Parameters
- **cwd_path** (string): Workspace root (preferred) — auto-detects the active project. *(Provide this OR project_path — not both.)*
- **project_path** (string): Plan folder path — use only if already known. *(Provide this OR cwd_path — not both.)*

## Example
\`\`\`json
{
  "project_path": "f:\\\\project\\\\docs\\\\agents\\\\plans\\\\2026-02-16-feature"
}
\`\`\`

## Returns
The full root index including work package summaries, counters, and project status.
`,

  ledger_initialize_project: `
# ledger_initialize_project

Create a new project ledger. Call this once at project start.

This also creates a \`.meta.json\` entry in the centralized ledger so the project
is immediately discoverable via \`ledger_list_projects\`.

The \`plan_file\` document is automatically archived into the ledger storage directory
at initialization, making it retrievable via the GUI plan endpoint. If the file does
not yet exist, it is silently skipped and reported in \`archive_skipped\`.

## Required Parameters
- **project_path** (string): Absolute path to the plan directory
- **plan_file** (string): Relative path to the plan file from project_path

## Response Fields
- All root index fields (plan_file, date_created, status, work_packages, etc.)
- **archived_documents** (string[]): Files successfully copied to the ledger storage directory
- **archive_skipped** (string[], optional): Files that could not be archived (source not found)

## Example
\`\`\`json
{
  "project_path": "f:\\\\project\\\\docs\\\\agents\\\\plans\\\\2026-02-16-feature",
  "plan_file": "${PLAN_ARCHIVE_FILENAME}"
}
\`\`\`
`,

  ledger_get_work_package: `
# ledger_get_work_package

Read the full detail for a specific work package.

## Required Parameters
- **cwd_path** (string): Workspace root (preferred) — auto-detects the active project. *(Provide this OR project_path — not both.)*
- **project_path** (string): Plan folder path — use only if already known. *(Provide this OR cwd_path — not both.)*
- **work_package_id** (string): Work package ID (format: WP-001, WP-002, etc.)

## Example
\`\`\`json
{
  "project_path": "f:\\\\project\\\\docs\\\\agents\\\\plans\\\\2026-02-16-feature",
  "work_package_id": "WP-001"
}
\`\`\`
`,

  ledger_list_work_packages: `
# ledger_list_work_packages

List work packages with optional filters.

## Required Parameters
- **cwd_path** (string): Workspace root (preferred) — auto-detects the active project. *(Provide this OR project_path — not both.)*
- **project_path** (string): Plan folder path — use only if already known. *(Provide this OR cwd_path — not both.)*

## Optional Parameters
- **status** (string): Filter by status — "READY", "IN_PROGRESS", "COMPLETE", or "BLOCKED"
- **assigned_to** (string): Filter by assigned agent name

## Example
\`\`\`json
{
  "project_path": "f:\\\\project\\\\docs\\\\agents\\\\plans\\\\2026-02-16-feature",
  "status": "IN_PROGRESS"
}
\`\`\`
`,

  ledger_create_work_package: `
# ledger_create_work_package

Create a new work package. WP ID is auto-generated.

## Required Parameters
- **cwd_path** (string): Workspace root (preferred) — auto-detects the active project. *(Provide this OR project_path — not both.)*
- **project_path** (string): Plan folder path — use only if already known. *(Provide this OR cwd_path — not both.)*
- **assigned_to** (string): Agent name (e.g., "Developer")
- **dependencies** (array): Array of WP IDs this depends on. Use [] for no dependencies.
- **acceptance_criteria** (array): Array of criteria strings — **must contain at least one entry** (empty array is rejected)
- **work_package_file** (string): Relative path to the WP spec file

## Optional Parameters
- **active_pipeline_stages** (array of strings): Ordered subset of pipeline stages for this WP. Omit to use the default 4-stage chain: ["implementation", "qa", "code-review", "documentation"]. Each entry must be a valid pipeline type. The array must be a contiguous subsequence of the canonical ordering and cannot be empty, contain duplicates, or be out of order. A soft warning is emitted if "implementation" is included without "qa", or if only a single stage is specified.

## Example
\`\`\`json
{
  "project_path": "f:\\\\project\\\\docs\\\\agents\\\\plans\\\\2026-02-16-feature",
  "assigned_to": "Developer",
  "dependencies": [],
  "acceptance_criteria": ["All tests pass", "No lint errors"],
  "work_package_file": "work/WP-001.md"
}
\`\`\`

## Example: custom stages (security-audit added, release-engineering skipped)
\`\`\`json
{
  "project_path": "f:\\\\project\\\\docs\\\\agents\\\\plans\\\\2026-02-16-feature",
  "assigned_to": "Developer",
  "dependencies": [],
  "acceptance_criteria": ["OWASP checks pass"],
  "work_package_file": "work/WP-002.md",
  "active_pipeline_stages": ["implementation", "qa", "security-audit", "code-review", "documentation"]
}
\`\`\`
`,

  ledger_begin_work: `
# ledger_begin_work

Claim a READY work package and start its pipeline in a single atomic call. Replaces the two-step \`ledger_claim_work_package\` + \`ledger_start_pipeline\` sequence.

If the WP is already IN_PROGRESS and assigned to you (idempotent re-entry), the claim phase is skipped and only the pipeline is started. The response includes a \`claimed: boolean\` field indicating whether the claim step ran.

## Required Parameters
- **cwd_path** (string): Workspace root (preferred) — auto-detects the active project. *(Provide this OR project_path — not both.)*
- **project_path** (string): Plan folder path — use only if already known. *(Provide this OR cwd_path — not both.)*
- **work_package_id** (string): WP ID (format: WP-001)
- **type** (string): Pipeline type — "implementation", "qa", "code-review", "documentation", "security-audit", or "release-engineering"
- **agent_role** (string): Your agent role (e.g., "Developer", "QA") — used for both the claim and pipeline ownership guards

## Guards Preserved
- CLAIMABLE_ROLES — rejects roles not permitted to claim WPs
- Assignment guard — WP must be assigned to your role (or already IN_PROGRESS and assigned to you)
- Dependency completeness — all dependencies must be COMPLETE before claiming
- Duplicate pipeline rejection — no two IN_PROGRESS pipelines of the same type
- Pipeline ordering — determined per-WP by active_pipeline_stages (defaults to implementation → qa → code-review → documentation for standard WPs)
- Rework circuit breaker — rejects if per-type rework count is at maximum
- Agent role validation — pipeline type must match the expected owner role

## Response
Same shape as \`ledger_start_pipeline\` plus a \`claimed: boolean\` field.

## Example: Claim and start implementation
\`\`\`json
{
  "project_path": "f:\\\\project\\\\docs\\\\agents\\\\plans\\\\2026-02-16-feature",
  "work_package_id": "WP-001",
  "type": "implementation",
  "agent_role": "Developer"
}
\`\`\`

## Example: Start next pipeline (WP already IN_PROGRESS)
\`\`\`json
{
  "project_path": "f:\\\\project\\\\docs\\\\agents\\\\plans\\\\2026-02-16-feature",
  "work_package_id": "WP-001",
  "type": "qa",
  "agent_role": "QA"
}
\`\`\`
`,

  ledger_claim_work_package: `
# ledger_claim_work_package

Claim a READY work package → transitions to IN_PROGRESS.

## Assignment Guard
If the work package is already assigned to a different agent, the claim will be **rejected** unless you pass \`override: true\`. This prevents agents from silently re-assigning work packages outside their remit.

## Required Parameters
- **cwd_path** (string): Workspace root (preferred) — auto-detects the active project. *(Provide this OR project_path — not both.)*
- **project_path** (string): Plan folder path — use only if already known. *(Provide this OR cwd_path — not both.)*
- **work_package_id** (string): WP ID (format: WP-001)
- **agent** (string): ⚠️ REQUIRED — Your agent name (e.g., "Developer", "QA")

## Optional Parameters
- **override** (boolean): Set to \`true\` to claim a WP assigned to a different agent. Only the **Project Manager** and the **current assignee** may use \`override: true\`. Omit or set \`false\` otherwise.

## Example
\`\`\`json
{
  "project_path": "f:\\\\project\\\\docs\\\\agents\\\\plans\\\\2026-02-16-feature",
  "work_package_id": "WP-001",
  "agent": "Developer"
}
\`\`\`

## Example: Override assignment
\`\`\`json
{
  "project_path": "f:\\\\project\\\\docs\\\\agents\\\\plans\\\\2026-02-16-feature",
  "work_package_id": "WP-007",
  "agent": "Developer",
  "override": true
}
\`\`\`
`,

  ledger_update_work_package_status: `
# ledger_update_work_package_status

Update a work package's status.

## Required Parameters
- **cwd_path** (string): Workspace root (preferred) — auto-detects the active project. *(Provide this OR project_path — not both.)*
- **project_path** (string): Plan folder path — use only if already known. *(Provide this OR cwd_path — not both.)*
- **work_package_id** (string): WP ID (format: WP-001)
- **status** (string): New status — "READY", "IN_PROGRESS", "COMPLETE", or "BLOCKED"
- **agent** (string): ⚠️ REQUIRED — Your agent name (e.g., "Developer", "Documentation")

## Optional Parameters
- **blocked_by** (object): Required ONLY when setting status to "BLOCKED"

## Rules
- Only the Documentation agent can set status to "COMPLETE"
- Only the Project Manager can set status to "CANCELLED"
- Legal transitions: READY→IN_PROGRESS, READY→BLOCKED, READY→CANCELLED, IN_PROGRESS→COMPLETE, IN_PROGRESS→BLOCKED, IN_PROGRESS→CANCELLED, BLOCKED→IN_PROGRESS, BLOCKED→READY, BLOCKED→CANCELLED, COMPLETE→IN_PROGRESS
- CANCELLED is a terminal status — no outward transitions from CANCELLED are permitted
- CANCELLED WPs satisfy dependency requirements (treated like COMPLETE for dependency checks)

## Example: Mark COMPLETE (Documentation agent only)
\`\`\`json
{
  "project_path": "f:\\\\project\\\\docs\\\\agents\\\\plans\\\\2026-02-16-feature",
  "work_package_id": "WP-001",
  "status": "COMPLETE",
  "agent": "Documentation"
}
\`\`\`

## Example: Mark BLOCKED
\`\`\`json
{
  "project_path": "f:\\\\project\\\\docs\\\\agents\\\\plans\\\\2026-02-16-feature",
  "work_package_id": "WP-001",
  "status": "BLOCKED",
  "agent": "Developer",
  "blocked_by": {
    "type": "technical",
    "description": "Missing API endpoint"
  }
}
\`\`\`
`,

  ledger_start_pipeline: `
# ledger_start_pipeline

Start a new pipeline for a work package. The WP must be IN_PROGRESS.

## Required Parameters
- **cwd_path** (string): Workspace root (preferred) — auto-detects the active project. *(Provide this OR project_path — not both.)*
- **project_path** (string): Plan folder path — use only if already known. *(Provide this OR cwd_path — not both.)*
- **work_package_id** (string): WP ID (format: WP-001)
- **type** (string): Pipeline type — "implementation", "qa", "code-review", "documentation", "security-audit", or "release-engineering"

## Example
\`\`\`json
{
  "project_path": "f:\\\\project\\\\docs\\\\agents\\\\plans\\\\2026-02-16-feature",
  "work_package_id": "WP-001",
  "type": "implementation"
}
\`\`\`

## Prerequisites
- WP must be IN_PROGRESS (use ledger_claim_work_package first if READY)
- No duplicate in-progress pipeline of the same type allowed
- **Pipeline ordering is enforced per-WP:** each stage must be preceded by a PASS on the immediately preceding active stage in the WP's active_pipeline_stages list. The default 4-stage order is implementation → qa → code-review → documentation, but WPs may define custom subsets or include security-audit and release-engineering.
- Starting a pipeline **automatically updates** the work package's \`assigned_to\` field to the responsible agent (Developer, QA, Security Auditor, Reviewer, Release Engineer, Documentation).
`,

  ledger_complete_pipeline: `
# ledger_complete_pipeline

Complete the most recent IN_PROGRESS pipeline of the specified type.

## Required Parameters
- **cwd_path** (string): Workspace root (preferred) — auto-detects the active project. *(Provide this OR project_path — not both.)*
- **project_path** (string): Plan folder path — use only if already known. *(Provide this OR cwd_path — not both.)*
- **work_package_id** (string): WP ID (format: WP-001)
- **type** (string): Pipeline type to complete
- **status** (string): "PASS" or "FAIL"
- **summary** (array): Array of summary strings

## Optional Parameters
- **acceptance_criteria_updates** (array): Mark acceptance criteria as met. Each item: { "criterion": "...", "met": true }. If the criterion text matches an existing entry, its \`met\` flag is updated. If the text is **not found**, a new criterion entry is appended to the WP's acceptance criteria list.
- **artifacts** (object): { files_modified, commit_hash, pull_request }
- **metrics** (object): { test_coverage, tests_passed, tests_failed, security_issues }
- **comments** (array): Observations from the pipeline
- **handoff_notes** (array of strings): Notes for the next agent. Creates a structured handoff note entry on the WP addressed to the next agent in the pipeline chain.

## Auto-Finalize (Terminal Pipeline Stage)

When \`status: "PASS"\` and the agent is the owner of the **last active stage** in the WP's pipeline (e.g., Documentation in the default 4-stage pipeline, or Reviewer in a verification-only \`["qa", "code-review"]\` WP), the server automatically checks whether all acceptance criteria are met **after** applying \`acceptance_criteria_updates\`:
- **All criteria met** — WP is transitioned to \`COMPLETE\` within the same lock scope. Response includes \`auto_finalized: true\`.
- **Criteria unmet** — WP stays \`IN_PROGRESS\`. Response includes \`auto_finalize_blocked: true\` and \`unmet_criteria: [...]\` listing the unmet criterion names.
- **FAIL result or non-terminal-stage agent** — auto-finalize does not fire; WP status is unchanged.

## Example
\`\`\`json
{
  "project_path": "f:\\\\project\\\\docs\\\\agents\\\\plans\\\\2026-02-16-feature",
  "work_package_id": "WP-001",
  "type": "implementation",
  "status": "PASS",
  "summary": ["Implemented feature X", "Added unit tests"],
  "acceptance_criteria_updates": [
    { "criterion": "All tests pass", "met": true }
  ],
  "handoff_notes": ["Pay attention to the auth module", "Edge case: empty input"]
}
\`\`\`
`,

  ledger_cancel_pipeline: `
# ledger_cancel_pipeline

Cancel the most recent IN_PROGRESS pipeline of the specified type by setting it to FAIL.
Use this to clean up stale or abandoned pipelines, typically after a RESUME_OR_CANCEL action from ledger_get_next_action.

## Required Parameters
- **cwd_path** (string): Workspace root (preferred) — auto-detects the active project. *(Provide this OR project_path — not both.)*
- **project_path** (string): Plan folder path — use only if already known. *(Provide this OR cwd_path — not both.)*
- **work_package_id** (string): WP ID (format: WP-001)
- **type** (string): Pipeline type — "implementation", "qa", "code-review", "documentation", "security-audit", or "release-engineering"
- **reason** (string): Human-readable reason for the cancellation

## Example
\`\`\`json
{
  "project_path": "f:\\\\project\\\\docs\\\\agents\\\\plans\\\\2026-02-16-feature",
  "work_package_id": "WP-001",
  "type": "implementation",
  "reason": "Pipeline was stale from a prior session; restarting fresh"
}
\`\`\`
`,

  ledger_update_pipeline_progress: `
# ledger_update_pipeline_progress

Update the summary array of the most recent IN_PROGRESS pipeline without completing it.
Use this for long-running pipelines where you want to record incremental progress checkpoints.

## Required Parameters
- **cwd_path** (string): Workspace root (preferred) — auto-detects the active project. *(Provide this OR project_path — not both.)*
- **project_path** (string): Plan folder path — use only if already known. *(Provide this OR cwd_path — not both.)*
- **work_package_id** (string): WP ID (format: WP-001)
- **type** (string): Pipeline type — "implementation", "qa", "code-review", "documentation", "security-audit", or "release-engineering"
- **summary** (array of strings): Progress notes to append to the pipeline summary

## Example
\`\`\`json
{
  "project_path": "f:\\\\project\\\\docs\\\\agents\\\\plans\\\\2026-02-16-feature",
  "work_package_id": "WP-001",
  "type": "implementation",
  "summary": ["Completed schema changes", "Running tests now"]
}
\`\`\`
`,

  ledger_add_observation: `
# ledger_add_observation

Add an observation/comment to the most recent pipeline of the specified type.

## Required Parameters
- **cwd_path** (string): Workspace root (preferred) — auto-detects the active project. *(Provide this OR project_path — not both.)*
- **project_path** (string): Plan folder path — use only if already known. *(Provide this OR cwd_path — not both.)*
- **work_package_id** (string): WP ID (format: WP-001)
- **pipeline_type** (string): Pipeline type to add the observation to
- **type** (string): Category — "code-smell", "refactor", "improvement", "debt", "convention"
- **priority** (string): "low", "medium", or "high"
- **note** (string): Description of the observation

## Example
\`\`\`json
{
  "project_path": "f:\\\\project\\\\docs\\\\agents\\\\plans\\\\2026-02-16-feature",
  "work_package_id": "WP-001",
  "pipeline_type": "code-review",
  "type": "code-smell",
  "priority": "medium",
  "note": "Function exceeds 50 lines, consider splitting"
}
\`\`\`
`,

  ledger_add_project_comment: `
# ledger_add_project_comment

Add a project-level comment (not tied to a specific pipeline).

## Required Parameters
- **cwd_path** (string): Workspace root (preferred) — auto-detects the active project. *(Provide this OR project_path — not both.)*
- **project_path** (string): Plan folder path — use only if already known. *(Provide this OR cwd_path — not both.)*
- **type** (string): Comment type — "incident", "note", or "decision"
- **priority** (string): "low", "medium", or "high"
- **agent** (string): ⚠️ REQUIRED — Your agent name
- **note** (string): Description

## Optional Parameters
- **context** (object): REQUIRED when type is "incident". Must include: os, tool, resolved

## Example
\`\`\`json
{
  "project_path": "f:\\\\project\\\\docs\\\\agents\\\\plans\\\\2026-02-16-feature",
  "type": "note",
  "priority": "low",
  "agent": "Developer",
  "note": "Considered alternative approach but chose current one for simplicity"
}
\`\`\`
`,

  ledger_get_next_action: `
# ledger_get_next_action

Get the next recommended action for your agent role.

When called with no max_results (or max_results: 1), returns a single action object — the first
actionable WP for your role (early-return mode, backward-compatible).

When called with max_results > 1, returns up to that many actions as an array under the "actions"
key. Useful for projects with many independent WPs where you want to process several in parallel.

## Required Parameters
- **cwd_path** (string): Workspace root (preferred) — auto-detects the active project. *(Provide this OR project_path — not both.)*
- **project_path** (string): Plan folder path — use only if already known. *(Provide this OR cwd_path — not both.)*
- **agent_role** (string): Exactly one of: "Planner", "Project Manager", "Developer", "QA", "Reviewer", "Documentation", "Synthesis"

## Optional Parameters
- **max_results** (number, integer, positive): Maximum number of actionable WPs to return. Default: 1 (single-action mode). When > 1, response format changes to { "actions": [...], "total": N }.

## Example — single action (default)
\`\`\`json
{
  "project_path": "f:\\\\project\\\\docs\\\\agents\\\\plans\\\\2026-02-16-feature",
  "agent_role": "Developer"
}
\`\`\`

## Example — batch mode
\`\`\`json
{
  "project_path": "f:\\\\project\\\\docs\\\\agents\\\\plans\\\\2026-02-16-feature",
  "agent_role": "Developer",
  "max_results": 3
}
\`\`\`

## Batch Response Format
\`\`\`json
{
  "actions": [
    { "action": "IMPLEMENT", "work_package_id": "WP-001", "reason": "..." },
    { "action": "REWORK", "work_package_id": "WP-003", "reason": "..." }
  ],
  "total": 2
}
\`\`\`

## WAIT Response Format
When all work for your role is done, the response has the following shape.
The \`handoff_status\` key is automatically embedded so you do NOT need to call
\`ledger_get_handoff_status\` separately — use \`handoff_status\` from this response directly.
If \`auto_handoff\` is present, invoke the next agent immediately. Otherwise, print the
handoff block and end your turn.
\`\`\`json
{
  "action": "WAIT",
  "reason": "...",
  "handoff_status": {
    "current_agent": "Developer",
    "next_agent": "QA",
    "status": "READY_FOR_QA",
    "details": "All work packages have PASS implementation pipelines.",
    "auto_handoff": {
      "agent_name": "4 - QA v3.5.0",
      "prompt": "..."
    }
  }
}
\`\`\`
The \`auto_handoff\` key is only present when handoff eligibility conditions are met.
If \`handoff_status_error\` appears instead of \`handoff_status\`, fall back to calling
\`ledger_get_handoff_status\` manually.
`,

  ledger_get_handoff_status: `
# ledger_get_handoff_status

Check handoff status to determine if your work is done.

## Response Format
The response JSON includes:
- **current_agent**: The agent that just finished working (you)
- **next_agent**: The agent that should pick up next (derived from status; omitted for COMPLETE)
- **status**: Workflow status (READY_FOR_DEVELOPER, READY_FOR_QA, READY_FOR_REVIEW, READY_FOR_DOCUMENTATION, READY_FOR_SYNTHESIS, READY_FOR_PM, IN_PROGRESS, BLOCKED, COMPLETE)
- **details**: Human-readable description of the current state

Copy the current_agent, next_agent, and status into your handoff block:
\`\`\`
CURRENT AGENT: <current_agent>
NEXT AGENT: <next_agent>
STATUS: <status>
\`\`\`

## Required Parameters
- **cwd_path** (string): Workspace root (preferred) — auto-detects the active project. *(Provide this OR project_path — not both.)*
- **project_path** (string): Plan folder path — use only if already known. *(Provide this OR cwd_path — not both.)*
- **current_agent** (string): Exactly one of: "Planner", "Project Manager", "Developer", "QA", "Reviewer", "Documentation", "Synthesis"

## Example
\`\`\`json
{
  "project_path": "f:\\\\project\\\\docs\\\\agents\\\\plans\\\\2026-02-16-feature",
  "current_agent": "Documentation"
}
\`\`\`
`,

  ledger_list_projects: `
# ledger_list_projects

List all projects tracked in the centralized ledger.
Operates at the ledger-root level — no \`project_path\` required.

> **Note:** Archived projects are **excluded by default**. Use \`include_archived: true\` to include them,
> or filter directly with \`status: "ARCHIVED"\`. Agents should not work on archived projects —
> archive them only after synthesis is complete.

## Optional Parameters
- **status** (string): Filter by project status — "READY", "IN_PROGRESS", "COMPLETE", "BLOCKED", or "ARCHIVED"
- **include_archived** (boolean): When \`true\`, includes ARCHIVED projects in the results. Default: \`false\`.

## Examples
\`\`\`json
{}
\`\`\`
\`\`\`json
{ "status": "IN_PROGRESS" }
\`\`\`
\`\`\`json
{ "include_archived": true }
\`\`\`
\`\`\`json
{ "status": "ARCHIVED" }
\`\`\`

## Returns
Array of \`.meta.json\` objects, each containing:
- **slug**: Directory slug (e.g., \`2026-02-20-my-feature\`)
- **plan_path**: Original project_path used during initialization
- **status**: Current project status (synced from root index on every write)
- **date_created**: ISO timestamp of project creation
- **last_updated**: ISO timestamp of last ledger write
- **title**: Optional human-readable title

## Storage
Ledger files are at \`{mcp-server}/storage/ledger/{slug}/\` by default.
Override with \`--ledger-dir <path>\` at server startup.
`,

  ledger_complete_synthesis: `
# ledger_complete_synthesis

Mark the project synthesis as generated. Sets \`synthesis_generated = true\` on the root index and transitions the project status to COMPLETE.

Call this after the Synthesis agent has finished generating its synthesis report. Subsequent calls to \`ledger_get_next_action(Synthesis)\` will return WAIT once this flag is set.

The synthesis document is automatically archived into the ledger storage directory on
completion. If the file does not exist, it is silently skipped and reported in
\`archive_skipped\`.

## Required Parameters
- **cwd_path** (string): Workspace root (preferred) — auto-detects the active project. *(Provide this OR project_path — not both.)*
- **project_path** (string): Plan folder path — use only if already known. *(Provide this OR cwd_path — not both.)*

## Optional Parameters
- **synthesis_file** (string, default: \`"${SYNTHESIS_ARCHIVE_FILENAME}"\`): Filename of the synthesis
  document relative to project_path. Defaults to \`${SYNTHESIS_ARCHIVE_FILENAME}\`; specify an alternative
  filename if your Synthesis agent writes to a different file.

## Response Fields
- **synthesis_generated** (boolean): Always \`true\`
- **project_status** (string): New project status (\`COMPLETE\` if all WPs are done)
- **message** (string): Confirmation message
- **archived_documents** (string[]): Files successfully copied to the ledger storage directory
- **archive_skipped** (string[], optional): Files that could not be archived (source not found)
- **next_steps** (string[]): Guidance for the Synthesis agent

## When to Call
- All WPs must be COMPLETE before calling this tool
- The Synthesis agent calls this at the end of its report generation
- Only the Synthesis agent should call this tool

## Example
\`\`\`json
{
  "project_path": "f:\\\\project\\\\docs\\\\agents\\\\plans\\\\2026-02-16-feature",
  "synthesis_file": "${SYNTHESIS_ARCHIVE_FILENAME}"
}
\`\`\`
`,
};


```
###  Path: `/mcp-server/src/tools/help.ts`

```ts
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { TOOL_HELP } from './help-content.js';

/**
 * Tool: ledger_help
 *
 * Returns usage documentation, examples, and workflow guidance for the
 * Project Ledger MCP tools. Designed to help agents (especially weaker models)
 * understand how to correctly call the tools.
 */


const HelpSchema = z.object({
  tool_name: z
    .string()
    .optional()
    .describe(
      'Optional. Specific tool name to get help for (e.g., "ledger_update_work_package_status"). Omit to get the full overview with all tools listed.'
    ),
});

async function help(args: z.infer<typeof HelpSchema>) {
  const toolName = args.tool_name?.trim();

  // If no tool specified, return overview
  if (!toolName) {
    return {
      content: [
        {
          type: 'text' as const,
          text: TOOL_HELP['overview'],
        },
      ],
    };
  }

  // Look up specific tool help
  const helpText = TOOL_HELP[toolName];

  if (helpText) {
    return {
      content: [
        {
          type: 'text' as const,
          text: helpText,
        },
      ],
    };
  }

  // Tool not found — return available tools list
  const availableTools = Object.keys(TOOL_HELP)
    .filter((k) => k !== 'overview')
    .join(', ');

  return {
    content: [
      {
        type: 'text' as const,
        text: `Unknown tool: "${toolName}". Available tools: ${availableTools}. Call ledger_help without tool_name for full overview.`,
      },
    ],
  };
}

/**
 * Register help tool on the MCP server
 */
export function register(server: McpServer): void {
  server.registerTool(
    'ledger_help',
    {
      description: 'Get usage documentation, examples, and required parameters for all ledger tools. Call with no arguments for a full overview, or pass tool_name to get detailed help for a specific tool (e.g., tool_name: "ledger_update_work_package_status"). START HERE if you are unsure how to use the ledger tools.',
      inputSchema: HelpSchema.passthrough(),
    },
    // TODO: remove `as any` cast once the MCP SDK exposes compatible Zod
    // passthrough types for registerTool's inputSchema parameter.
    // Tracked: https://github.com/modelcontextprotocol/typescript-sdk (MCP SDK typing issue)
    help as any
  );
}

```
###  Path: `/mcp-server/src/tools/observations.ts`

```ts
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
  project_path: z.string().optional().describe('Plan folder path — use only if you already have it from a previous tool response. Otherwise prefer cwd_path.'),
  cwd_path: z.string().optional().describe('Your workspace root directory — preferred. The server auto-detects the active project.'),
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
  project_path: z.string().optional().describe('Plan folder path — use only if you already have it from a previous tool response. Otherwise prefer cwd_path.'),
  cwd_path: z.string().optional().describe('Your workspace root directory — preferred. The server auto-detects the active project.'),
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

```
###  Path: `/mcp-server/src/tools/pipeline.ts`

```ts
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
  describePipelineTypes,
  describePipelineAgents,
  type PipelineType,
  resolvePrerequisite,
  resolveNextAgent,
  resolveFailAgent,
  DEFAULT_PIPELINE_STAGES,
  lastActiveStage,
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
  activeStages: readonly PipelineType[] = DEFAULT_PIPELINE_STAGES,
): string {
  const currentAgent = PIPELINE_AGENT_MAP[pipelineType] ?? pipelineType;
  const nextAgent = resolveNextAgent(pipelineType, activeStages);
  const failAgent = resolveFailAgent(pipelineType, activeStages);

  // Determine if this is the terminal (last active) stage
  const isTerminalStage = pipelineType === lastActiveStage(activeStages);

  if (status === 'PASS') {
    if (isTerminalStage) {
      if (autoFinalizeResult === 'finalized') {
        return (
          `\n\n--- NEXT STEP ---\n` +
          `Pipeline PASS. WP ${wpId} was auto-finalized to COMPLETE (all acceptance criteria met). ` +
          `Call ledger_get_handoff_status (current_agent: "${currentAgent}") to confirm handoff.`
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
      // Fallback (e.g. PM override completing the terminal pipeline)
      return (
        `\n\n--- NEXT STEP ---\n` +
        `Pipeline PASS. Call ledger_get_handoff_status (current_agent: "${currentAgent}") to confirm handoff.`
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

  // Non-implementation FAIL — route to failAgent
  if (failAgent === currentAgent) {
    // Self-rework (e.g., documentation, release-engineering)
    return (
      `\n\n--- NEXT STEP ---\n` +
      `Pipeline FAIL. Leave ${wpId} as IN_PROGRESS. ` +
      `${currentAgent} self-rework: review the FAIL summary and retry. ` +
      `Call ledger_get_handoff_status to confirm.`
    );
  }

  // Downstream FAIL routes back to another agent (typically Developer)
  return (
    `\n\n--- NEXT STEP ---\n` +
    `Pipeline FAIL. Do NOT set ${wpId} to BLOCKED — leave it as IN_PROGRESS. ` +
    `${failAgent} will see the FAIL ${pipelineType} pipeline via ledger_get_next_action and rework. ` +
    `Call ledger_get_handoff_status to confirm handoff back to ${failAgent}.`
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
  type: PipelineTypeEnum.describe(describePipelineTypes('Pipeline type:')),
  agent_role: z
    .string()
    .describe(describePipelineAgents('Your agent role. Must match the pipeline type owner:')),
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
      // 0. Resolve the WP's active pipeline stages (default to legacy 4-stage)
      const activeStages: readonly PipelineType[] =
        (wp.active_pipeline_stages as PipelineType[] | undefined) ?? DEFAULT_PIPELINE_STAGES;

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

      // 2b. Validate requested pipeline type is in the WP's active stages
      if (!activeStages.includes(args.type)) {
        throw new Error(
          `Cannot start pipeline '${args.type}' for work package ${args.work_package_id}: ` +
          `this pipeline type is not in the WP's active stages. ` +
          `Active stages: ${(activeStages as readonly string[]).join(' \u2192 ')}.`
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

      // 4. Enforce pipeline ordering: compute prerequisite dynamically from active stages (§8.2)
      const prerequisite = resolvePrerequisite(args.type, activeStages);
      if (prerequisite !== null) {
        const prereqPipelines = wp.pipelines.filter((p) => p.type === prerequisite);
        const mostRecentPrereq = prereqPipelines.at(-1);
        if (!mostRecentPrereq || mostRecentPrereq.status !== 'PASS') {
          const orderedActive = (activeStages as readonly string[]).join(' \u2192 ');
          throw new Error(
            `Cannot start '${args.type}' pipeline: requires a PASS '${prerequisite}' pipeline first. ` +
            `Active pipeline order: ${orderedActive}.`
          );
        }

        // 4b. Revalidation guard: reject if a prior run exists and the prerequisite
        //     PASS is stale after upstream rework (§11.1).
        const revalidError = checkRevalidationGuard(wp.pipelines, args.type, prerequisite, activeStages);
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
      const isDownstreamRework = hasDownstreamFail(wp.pipelines, args.type, activeStages);
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
  type: PipelineTypeEnum.describe(describePipelineTypes('Pipeline type to complete:')),
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
    .describe(describePipelineAgents('Your agent role. Must match the pipeline type owner:')),
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
  // Captured from within the lock callback so buildCompletionGuidance can use it
  let activeStagesForGuidance: readonly PipelineType[] = DEFAULT_PIPELINE_STAGES;
  // Soft warning text for empty artifacts (set inside callback, appended to response)
  let artifactsWarning = '';

  // §21.59 Advisory staleness map: pre-read dep WPs to compare their last-modification
  // signal against the pipeline's started_at. Only populated when status is PASS.
  // Race-safe by design: this is advisory only — PASS is never blocked.
  const depStalenessMap = new Map<string, string | undefined>();
  if (args.status === 'PASS') {
    try {
      const preWp = await store.readWorkPackage(args.work_package_id);
      const prePipeline = preWp.pipelines
        .filter((p) => p.type === args.type && p.status === 'IN_PROGRESS')
        .at(-1);
      if (prePipeline?.started_at && preWp.dependencies.length > 0) {
        for (const depId of preWp.dependencies) {
          try {
            const depWp = await store.readWorkPackage(depId);
            if (depWp.last_updated) {
              depStalenessMap.set(depId, depWp.last_updated);
            }
          } catch {
            // dep WP not readable — skip this dep
          }
        }
      }
    } catch {
      // pre-read of current WP failed — skip staleness check
    }
  }

  try {
    await store.updateWorkPackageWithSync(args.work_package_id, (wp, root) => {
      // Resolve the WP's active pipeline stages (default to legacy 4-stage)
      const activeStages: readonly PipelineType[] =
        (wp.active_pipeline_stages as PipelineType[] | undefined) ?? DEFAULT_PIPELINE_STAGES;
      activeStagesForGuidance = activeStages;

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

      // 3b. Soft warning: emit when artifacts.files_modified is empty or absent on a PASS pipeline (§12.1).
      // Persists a project comment for PM audit trail AND appends a text note to the response.
      // Verification-only and documentation-only WPs may legitimately have no files_modified,
      // but the warning prompts agents to declare any modifications they made.
      if (args.status === 'PASS' && !isPmOverride) {
        const filesModified = args.artifacts?.files_modified;
        if (!filesModified || filesModified.length === 0) {
          // §12.1: Persist as a project comment for traceability
          root.project_comments.push({
            type: 'warning',
            priority: 'low',
            timestamp: now(),
            agent: args.agent_role,
            note: `Pipeline ${args.type} on ${args.work_package_id} completed with PASS but declared no artifacts.files_modified — consider declaring modified files for traceability`,
          });
          artifactsWarning =
            '\n\nNote: artifacts.files_modified is empty or absent. ' +
            'If you modified any files during this pipeline, declare them in artifacts.files_modified ' +
            'for a complete audit trail. This is expected for verification-only or documentation-only pipelines.';
        }
      }

      // §21.59 Advisory cross-WP dependency freshness check (SHOULD level).
      // Warns when a dependency was modified after this pipeline started.
      // Does NOT block PASS — emits project comments only.
      if (args.status === 'PASS' && pipeline.started_at && depStalenessMap.size > 0) {
        for (const [depId, depLastModified] of depStalenessMap) {
          if (depLastModified && new Date(depLastModified).getTime() > new Date(pipeline.started_at).getTime()) {
            root.project_comments.push({
              type: 'warning',
              priority: 'low',
              timestamp: now(),
              agent: args.agent_role,
              note: `Dependency ${depId} was modified after pipeline started — results may reflect stale assumptions`,
            });
          }
        }
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

      // 4b. Generalized auto-finalize (§WP-006): fires when the agent owning the LAST
      // active stage completes that stage with PASS and all acceptance criteria are met.
      // The terminal stage is computed dynamically from the WP's active_pipeline_stages.
      // PM overrides bypass auto-finalize intentionally.
      const lastStage = lastActiveStage(activeStages);
      const terminalAgent = PIPELINE_AGENT_MAP[lastStage] ?? null;
      const isTerminalPass = args.type === lastStage && args.status === 'PASS';
      const isTerminalAgent = terminalAgent !== null && args.agent_role === terminalAgent;
      if (isTerminalPass && isTerminalAgent) {
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
          ? resolveFailAgent(args.type, activeStages)
          : resolveNextAgent(args.type, activeStages);
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
      activeStagesForGuidance,
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
          text: JSON.stringify(responsePayload, null, 2) + guidance + artifactsWarning,
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
  type: PipelineTypeEnum.describe(describePipelineTypes('Pipeline type to cancel:')),
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
  type: PipelineTypeEnum.describe(describePipelineTypes('Pipeline type:')),
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
      description: `Start a new pipeline for a work package. REQUIRED params: work_package_id, type. ${describePipelineTypes('The type must be one of:')}. WP must be IN_PROGRESS (use ledger_claim_work_package first if READY). Rejects duplicate in-progress pipelines of the same type. Use cwd_path (workspace root) for auto-detection, or project_path if already known.`,
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

```
###  Path: `/mcp-server/src/tools/project-lifecycle.ts`

```ts
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { LedgerStore } from '../storage/ledger-store.js';
import { PLAN_ARCHIVE_FILENAME, SYNTHESIS_ARCHIVE_FILENAME, SPEC_VERSION, AGENT_ROLES } from '../utils/constants.js';
import { SERVER_VERSION, readPackageVersion } from '../utils/server-version.js';
import type { DetectProjectResult } from '../storage/ledger-store.js';
import { WorkPackageStatus } from '../schema/enums.js';
import { isTerminalStatus } from '../schema/validators.js';
import { now, parseTimestamp } from '../utils/timestamp.js';
import type { RootIndex } from '../schema/root-index.js';
import { access, constants } from 'fs/promises';
import { validatePlanPath, resolveProjectPath, formatCandidateList } from '../utils/path-validator.js';
import { withLock } from '../storage/file-lock.js';
import { DEFAULT_PIPELINE_STAGES } from '../utils/pipeline-maps.js';
import { getPassedStages } from '../utils/project-reset.js';
import { clearSynthesisState } from '../utils/workflow-helpers.js';
import { readProjectName } from '../utils/read-project-name.js';
import { inferProjectRootFromPlanPath } from '../utils/ledger-root.js';

/**
 * Tool: detect_project
 *
 * Identifies the active project by cross-referencing the supplied working-
 * directory path against all project roots stored in the centralized ledger.
 */
const DetectProjectSchema = z.object({
  cwd_path: z
    .string()
    .describe(
      'Absolute path to the directory the agent is currently working from (e.g. the VS Code workspace root). ' +
      'The tool will match this against all known project roots and return the unique project whose codebase ' +
      'contains this path. Must not be a file path — pass the directory only.'
    ),
});

async function detectProject(args: z.infer<typeof DetectProjectSchema>) {
  let result: DetectProjectResult;

  try {
    result = await LedgerStore.detectProjectByCwd(args.cwd_path);
  } catch (error) {
    return {
      content: [{ type: 'text' as const, text: `Error: ${(error as Error).message}` }],
      isError: true,
    };
  }

  if (result.status === 'FOUND') {
    const { plan_path, slug, title, status } = result.meta;
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({ plan_path, slug, title, status }, null, 2),
        },
      ],
    };
  }

  if (result.status === 'AMBIGUOUS') {
    const candidateList = formatCandidateList(result.best, result.unlikely);
    return {
      content: [
        {
          type: 'text' as const,
          text:
            `Error: Multiple projects match the provided path. ` +
            `Provide an explicit project_path to disambiguate.\n\nCandidates:\n${candidateList}`,
        },
      ],
      isError: true,
    };
  }

  // NOT_FOUND
  return {
    content: [
      {
        type: 'text' as const,
        text:
          `Error: No project found whose codebase contains the path "${args.cwd_path}". ` +
          `Ensure the project has been initialized with ledger_initialize_project and that ` +
          `the provided path is inside the project root.`,
      },
    ],
    isError: true,
  };
}

/**
 * Tool: get_project_status
 *
 * Reads the root index and returns project overview.
 * Includes self-healing logic that recomputes counters from actual WP data.
 */
const GetProjectStatusSchema = z.object({
  project_path: z.string().optional().describe('Plan folder path — use only if you already have it from a previous tool response. Otherwise prefer cwd_path.'),
  cwd_path: z.string().optional().describe('Your workspace root directory — preferred. The server auto-detects the active project.'),
});

/**
 * Pure function: computes the healed project status and counters from
 * the current root index data. Does NOT read or write disk.
 *
 * Implements all 16 healing rules from §17.2 of the workflow specification
 * in first-match-wins order.
 */
export function computeHealedStatus(rootIndex: RootIndex): {
  totalWps: number;
  pendingWps: number;
  healedStatus: RootIndex['status'];
  needsWrite: boolean;
  corruptionDetected: boolean;
  legacySynthesisTimestampRepair: boolean;
} {
  const totalWps = rootIndex.work_packages.length;
  const pendingWps = rootIndex.work_packages.filter(
    (wp) => !isTerminalStatus(wp.status)
  ).length;

  // Corruption mitigation (§17.2 known-gap note):
  // If synthesis_generated is true but pending WPs still exist, the flag was set
  // prematurely. Treat it as false for this computation — do NOT mutate the input.
  let synthesisGenerated = rootIndex.synthesis_generated ?? false;
  let corruptionDetected = false;
  if (synthesisGenerated && pendingWps > 0) {
    synthesisGenerated = false;
    corruptionDetected = true;
  }

  // Legacy field repair: synthesis_generated is true (legitimate) but synthesis_generated_at is absent.
  // Only fires when no corruption is present — if corruption was detected, that handler clears the flag.
  const legacySynthesisTimestampRepair =
    (rootIndex.synthesis_generated ?? false) &&
    !corruptionDetected &&
    (rootIndex.synthesis_generated_at === null || rootIndex.synthesis_generated_at === undefined);

  // Pre-compute shared predicates once.
  const hasInProgressWp = rootIndex.work_packages.some((wp) => wp.status === 'IN_PROGRESS');
  const hasReadyWp = rootIndex.work_packages.some((wp) => wp.status === 'READY');

  let healedStatus = rootIndex.status;

  if (
      // Rule 1: (IN_PROGRESS or READY) AND pending==0 AND total>0 AND synthesis_generated → COMPLETE
      (rootIndex.status === 'IN_PROGRESS' || rootIndex.status === 'READY') &&
      pendingWps === 0 && totalWps > 0 && synthesisGenerated
    ) {
      healedStatus = 'COMPLETE';
    } else if (
      // Rule 1b: READY AND pending==0 AND total>0 AND NOT synthesis_generated → IN_PROGRESS
      rootIndex.status === 'READY' &&
      pendingWps === 0 && totalWps > 0 && !synthesisGenerated
    ) {
      healedStatus = 'IN_PROGRESS';
    } else if (
      // Rule 1c: IN_PROGRESS AND pending==0 AND total>0 AND NOT synthesis_generated → preserve
      // No-op: status is correct — project is awaiting synthesis step.
      rootIndex.status === 'IN_PROGRESS' &&
      pendingWps === 0 && totalWps > 0 && !synthesisGenerated
    ) {
      healedStatus = 'IN_PROGRESS';
    } else if (
      // Rule 2: COMPLETE AND pending>0 → IN_PROGRESS
      rootIndex.status === 'COMPLETE' && pendingWps > 0
    ) {
      healedStatus = 'IN_PROGRESS';
    } else if (
      // Rule 2b: COMPLETE AND pending==0 AND total>0 AND NOT synthesis_generated → IN_PROGRESS
      rootIndex.status === 'COMPLETE' &&
      pendingWps === 0 && totalWps > 0 && !synthesisGenerated
    ) {
      healedStatus = 'IN_PROGRESS';
    } else if (
      // Rule 3: READY AND hasInProgressWp → IN_PROGRESS
      rootIndex.status === 'READY' && hasInProgressWp
    ) {
      healedStatus = 'IN_PROGRESS';
    } else if (
      // Rule 3b: READY AND pending>0 AND !hasReadyWp AND !hasInProgressWp → BLOCKED
      // (all remaining pending WPs are BLOCKED)
      rootIndex.status === 'READY' &&
      pendingWps > 0 && !hasReadyWp && !hasInProgressWp
    ) {
      healedStatus = 'BLOCKED';
    } else if (
      // Rule 3c: IN_PROGRESS AND pending>0 AND !hasReadyWp AND !hasInProgressWp → BLOCKED
      rootIndex.status === 'IN_PROGRESS' &&
      pendingWps > 0 && !hasReadyWp && !hasInProgressWp
    ) {
      healedStatus = 'BLOCKED';
    } else if (
      // Rule 4: BLOCKED AND hasInProgressWp → IN_PROGRESS
      rootIndex.status === 'BLOCKED' && hasInProgressWp
    ) {
      healedStatus = 'IN_PROGRESS';
    } else if (
      // Rule 4b: BLOCKED AND hasReadyWp AND !hasInProgressWp → READY
      rootIndex.status === 'BLOCKED' && hasReadyWp && !hasInProgressWp
    ) {
      healedStatus = 'READY';
    } else if (
      // Rule 5a: BLOCKED AND pending==0 AND total>0 AND synthesis_generated → COMPLETE
      rootIndex.status === 'BLOCKED' &&
      pendingWps === 0 && totalWps > 0 && synthesisGenerated
    ) {
      healedStatus = 'COMPLETE';
    } else if (
      // Rule 5b: BLOCKED AND pending==0 AND total>0 AND NOT synthesis_generated → IN_PROGRESS
      rootIndex.status === 'BLOCKED' &&
      pendingWps === 0 && totalWps > 0 && !synthesisGenerated
    ) {
      healedStatus = 'IN_PROGRESS';
    } else if (
      // Rule 6b: (IN_PROGRESS or BLOCKED) AND total==0 → READY
      (rootIndex.status === 'IN_PROGRESS' || rootIndex.status === 'BLOCKED') &&
      totalWps === 0
    ) {
      healedStatus = 'READY';
    } else if (
      // Rule 6c: COMPLETE AND total==0 → READY
      rootIndex.status === 'COMPLETE' && totalWps === 0
    ) {
      healedStatus = 'READY';
    }

  const needsWrite =
    rootIndex.total_work_packages !== totalWps ||
    rootIndex.pending_work_packages !== pendingWps ||
    rootIndex.status !== healedStatus ||
    corruptionDetected ||
    legacySynthesisTimestampRepair;

  return { totalWps, pendingWps, healedStatus, needsWrite, corruptionDetected, legacySynthesisTimestampRepair };
}

/**
 * Validates that pipeline `started_at` timestamps within each WP are
 * monotonically non-decreasing (§17.4).
 *
 * Returns an array of human-readable warning strings — one per ordering
 * violation. Returns an empty array when all orderings are valid.
 * Does not reorder or mutate any data.
 */
async function validatePipelineOrdering(
  rootIndex: RootIndex,
  store: LedgerStore
): Promise<string[]> {
  const warnings: string[] = [];

  for (const wpSummary of rootIndex.work_packages) {
    try {
      const wpDetail = await store.readWorkPackage(wpSummary.work_package_id);
      const pipelines = wpDetail.pipelines ?? [];

      for (let i = 1; i < pipelines.length; i++) {
        const prev = pipelines[i - 1];
        const curr = pipelines[i];

        if (prev?.started_at && curr?.started_at) {
          const prevTime = parseTimestamp(prev.started_at).getTime();
          const currTime = parseTimestamp(curr.started_at).getTime();

          if (currTime < prevTime) {
            warnings.push(
              `${wpSummary.work_package_id}: pipeline[${i}] started before pipeline[${i - 1}]` +
              ` (${curr.started_at} < ${prev.started_at})`
            );
          }
        }
      }
    } catch {
      // Skip WPs that cannot be read — ordering validation is non-fatal.
    }
  }

  return warnings;
}

/** Aggregate pipeline-stage completeness across all non-CANCELLED work packages. */
async function computePipelineHealth(
  rootIndex: RootIndex,
  store: LedgerStore
): Promise<{ wps_with_all_stages_pass: number; wps_missing_stages: number; total_stages_missing: number }> {
  let wpsWithAllStagesPass = 0;
  let wpsMissingStages = 0;
  let totalStagesMissing = 0;

  for (const wpSummary of rootIndex.work_packages) {
    if (wpSummary.status === 'CANCELLED') continue;
    try {
      const wpDetail = await store.readWorkPackage(wpSummary.work_package_id);
      const passed = getPassedStages(wpDetail);
      const activeCount =
        Array.isArray(wpDetail.active_pipeline_stages) && wpDetail.active_pipeline_stages.length > 0
          ? wpDetail.active_pipeline_stages.length
          : DEFAULT_PIPELINE_STAGES.length;
      const missing = activeCount - passed.size;
      if (missing === 0) {
        wpsWithAllStagesPass++;
      } else {
        wpsMissingStages++;
        totalStagesMissing += missing;
      }
    } catch {
      // Skip unreadable WP detail files — health computation is non-fatal.
    }
  }

  return {
    wps_with_all_stages_pass: wpsWithAllStagesPass,
    wps_missing_stages:       wpsMissingStages,
    total_stages_missing:     totalStagesMissing,
  };
}

async function getProjectStatus(
  args: z.infer<typeof GetProjectStatusSchema>,
  _ledgerRoot?: string
) {
  let projectPath: string;
  try {
    projectPath = await resolveProjectPath(args);
  } catch (err) {
    return { content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }], isError: true };
  }

  const ledgerRoot = typeof _ledgerRoot === 'string' ? _ledgerRoot : undefined;
  const store = new LedgerStore(projectPath, ledgerRoot);

  try {
    // Read the root index
    const rootIndex = await store.readRootIndex();

    // Self-healing: compute corrected counters and status (pure)
    const healed = computeHealedStatus(rootIndex);

    // Check for legacy ledger_version backfill (not tracked by computeHealedStatus)
    const needsLegacyVersionBackfill = !rootIndex.ledger_version;

    // Forward-compatibility warning: ledger_version is present and exceeds SPEC_VERSION (§21.58).
    // Deduplicated — only added once; subsequent reads skip if the comment already exists.
    let needsForwardCompatWarning = false;
    let forwardCompatWarningNote = '';
    if (rootIndex.ledger_version) {
      const [lMaj = 0, lMin = 0, lPat = 0] = rootIndex.ledger_version.split('.').map(Number);
      const [sMaj = 0, sMin = 0, sPat = 0] = SPEC_VERSION.split('.').map(Number);
      // Guard against pre-release or malformed version segments (e.g. "2.5.0-beta" → NaN)
      if ([lMaj, lMin, lPat, sMaj, sMin, sPat].every(isFinite)) {
        const isNewer =
          lMaj > sMaj ||
          (lMaj === sMaj && lMin > sMin) ||
          (lMaj === sMaj && lMin === sMin && lPat > sPat);
        if (isNewer) {
          forwardCompatWarningNote = `Ledger version ${rootIndex.ledger_version} is newer than the current server spec version ${SPEC_VERSION}. Some features may not be fully supported.`;
          needsForwardCompatWarning = !rootIndex.project_comments.some((c) => c.note === forwardCompatWarningNote);
        }
      }
    }

    // Pre-compute pipeline ordering warnings before the lock — validatePipelineOrdering
    // only reads WP detail files, not the root index, so it is safe outside the lock.
    const synthesisRepairNote = 'Self-healed: backfilled synthesis_generated_at from last_updated';
    const needsSynthesisRepairComment = healed.legacySynthesisTimestampRepair &&
      !rootIndex.project_comments.some((c) => c.note === synthesisRepairNote);
    const orderingWarnings = await validatePipelineOrdering(rootIndex, store);

    // Write to disk when corrections are needed (status/counters, legacy repairs, forward-compat warning,
    // pipeline ordering warnings, or synthesis timestamp repair comment) — single lock scope.
    if (healed.needsWrite || needsLegacyVersionBackfill || needsForwardCompatWarning || orderingWarnings.length > 0 || needsSynthesisRepairComment) {
      await withLock(store.storageDir, async () => {
        // Re-read under lock to avoid race conditions (TOCTOU)
        const fresh = await store.readRootIndex();
        const freshHealed = computeHealedStatus(fresh);
        const freshNeedsVersionBackfill = !fresh.ledger_version;
        const freshNeedsForwardCompatWarning = forwardCompatWarningNote
          ? !fresh.project_comments.some((c) => c.note === forwardCompatWarningNote)
          : false;
        // Re-check synthesis repair comment dedup under lock (same pattern as forward-compat)
        const freshNeedsSynthesisRepairComment = freshHealed.legacySynthesisTimestampRepair &&
          !fresh.project_comments.some((c) => c.note === synthesisRepairNote);

        const needsAnyWrite = freshHealed.needsWrite || freshNeedsVersionBackfill ||
          freshNeedsForwardCompatWarning || orderingWarnings.length > 0 || freshNeedsSynthesisRepairComment;

        if (needsAnyWrite) {
          // Status and counter corrections
          if (freshHealed.needsWrite) {
            fresh.total_work_packages = freshHealed.totalWps;
            fresh.pending_work_packages = freshHealed.pendingWps;
            fresh.status = freshHealed.healedStatus;
            if (freshHealed.corruptionDetected) {
              clearSynthesisState(fresh);
            }
          }
          // Legacy synthesis_generated_at repair (§21.57)
          if (freshHealed.legacySynthesisTimestampRepair) {
            fresh.synthesis_generated_at = fresh.last_updated;
          }
          // Legacy ledger_version backfill (§21.58 — silent migration)
          if (freshNeedsVersionBackfill) {
            fresh.ledger_version = SPEC_VERSION;
          }
          // Forward-compat warning comment (§21.58)
          if (freshNeedsForwardCompatWarning) {
            fresh.project_comments.push({
              type: 'warning',
              priority: 'low',
              timestamp: now(),
              agent: 'system',
              note: forwardCompatWarningNote,
            });
          }
          // Pipeline ordering warnings (§17.4)
          for (const warning of orderingWarnings) {
            fresh.project_comments.push({
              type: 'warning',
              priority: 'low',
              timestamp: now(),
              agent: 'system',
              note: warning,
            });
          }
          // Synthesis timestamp repair comment (§21.57) — deduplicated
          if (freshNeedsSynthesisRepairComment) {
            fresh.project_comments.push({
              type: 'warning',
              priority: 'low',
              timestamp: now(),
              agent: 'system',
              note: synthesisRepairNote,
            });
          }
          fresh.last_updated = now();
          await store.writeRootIndex(fresh);
        }
      });

      // Re-read to return the corrected data
      const corrected = await store.readRootIndex();
      const pipelineHealthHealed = await computePipelineHealth(corrected, store);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ ...corrected, pipeline_health: pipelineHealthHealed }, null, 2),
          },
        ],
      };
    }

    const pipelineHealth = await computePipelineHealth(rootIndex, store);
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({ ...rootIndex, pipeline_health: pipelineHealth }, null, 2),
        },
      ],
    };
  } catch (error) {
    // Handle "project not found" gracefully for pre-flight checks
    if ((error as Error).message.includes('Root index not found')) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Project not initialized at ${projectPath}. The Project Manager agent must initialize the ledger via ledger_initialize_project before other agents can proceed.`,
          },
        ],
      };
    }

    // Return other errors (validation failures, etc.) as error responses
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error: ${(error as Error).message}`,
        },
      ],
      isError: true,
    };
  }
}

/**
 * Tool: initialize_project
 *
 * Creates a new project ledger with root index and ledger/ subdirectory.
 * Rejects if ledger already exists.
 */
export const InitializeProjectSchema = z.object({
  project_path: z.string().describe('Absolute path to the plan directory (e.g., "f:\\project\\docs\\agents\\plans\\2026-02-16-feature")'),
  plan_file: z
    .string()
    .refine((v) => v === PLAN_ARCHIVE_FILENAME, {
      message: `plan_file must be '${PLAN_ARCHIVE_FILENAME}' to match the GUI plan document read path`,
    })
    .describe(
      `Relative path to the plan file from project_path. Must be '${PLAN_ARCHIVE_FILENAME}' — this value is enforced to keep the GUI plan document read path consistent.`
    ),
});

async function initializeProject(
  args: z.infer<typeof InitializeProjectSchema>
) {
  // Validate that the path ends with a valid plan folder pattern
  const pathValidation = validatePlanPath(args.project_path);
  if (!pathValidation.isValid) {
    return { content: [{ type: 'text' as const, text: pathValidation.error }], isError: true };
  }

  const store = new LedgerStore(args.project_path);

  try {
    // 1. Verify project_path exists
    await access(args.project_path, constants.F_OK);
  } catch {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error: Project path does not exist: ${args.project_path}`,
        },
      ],
      isError: true,
    };
  }

  // 2. Reject if the running server is stale (package.json updated since startup)
  const diskVersion = readPackageVersion();
  if (diskVersion !== SERVER_VERSION) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error: Stale MCP server instance — running v${SERVER_VERSION} but package.json is v${diskVersion}. ` +
            'Restart the MCP server to pick up the new version before initializing a project.',
        },
      ],
      isError: true,
    };
  }

  // 3. Reject if project-ledger.json already exists
  const rootExists = await store.rootIndexExists();
  if (rootExists) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error: Project ledger already exists for ${args.project_path}. Use MCP tools to update the existing ledger.`,
        },
      ],
      isError: true,
    };
  }

  // 4. Create the root index structure
  const timestamp = now();
  const rootIndex: RootIndex = {
    plan_file: args.plan_file,
    date_created: timestamp,
    last_updated: timestamp,
    status: 'READY',
    total_work_packages: 0,
    pending_work_packages: 0,
    work_packages: [],
    project_comments: [],
    ledger_version: SPEC_VERSION,
    server_version: SERVER_VERSION,
  };

  try {
    // 5. Write root index (atomicWriteJson will create storageDir via mkdir -p)
    await store.writeRootIndex(rootIndex);

    // 6. Write initial .meta.json with enrichment cache fields (non-fatal)
    let enrichmentCached = false;
    try {
      const projectRoot = inferProjectRootFromPlanPath(args.project_path);
      const projectName = await readProjectName(projectRoot);
      const repositoryName = projectRoot
        ? (projectRoot.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? null)
        : null;
      await store.writeProjectMeta(args.plan_file, 'READY', {
        total_work_packages: 0,
        pending_work_packages: 0,
        project_name: projectName,
        repository_name: repositoryName,
      });
      enrichmentCached = true;
    } catch (enrichErr) {
      process.stderr.write(
        `[initializeProject] meta enrichment failed (project still created): ${(enrichErr as Error).message}\n`
      );
    }

    // 7. Archive the plan document into the ledger storage directory (best-effort)
    const archiveResult = await store.archiveDocuments([args.plan_file]);

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            ...rootIndex,
            enrichment_cached: enrichmentCached,
            archived_documents: archiveResult.archived,
            archive_skipped: archiveResult.skipped.length > 0 ? archiveResult.skipped : undefined,
          }, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error initializing project: ${(error as Error).message}`,
        },
      ],
      isError: true,
    };
  }
}

/**
 * Tool: list_projects
 *
 * Lists all projects tracked in the centralized ledger.
 * Optionally filters by status.
 */
const ListProjectsSchema = z.object({
  status: WorkPackageStatus.optional().describe('Optional filter: only return projects with this status'),
  include_archived: z.boolean().optional().default(false).describe('When true, includes ARCHIVED projects in results. By default, ARCHIVED projects are excluded.'),
});

async function listProjects(args: z.infer<typeof ListProjectsSchema>, _ledgerRoot?: string) {
  try {
    const projects = await LedgerStore.listAllProjects(_ledgerRoot);
    let filtered = projects;

    // Filter by explicit status first (takes precedence over include_archived)
    if (args.status) {
      filtered = filtered.filter((p) => p.status === args.status);
    } else if (!args.include_archived) {
      // Default: exclude ARCHIVED unless include_archived: true or status: 'ARCHIVED' is set
      filtered = filtered.filter((p) => p.status !== 'ARCHIVED');
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(filtered, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error listing projects: ${(error as Error).message}`,
        },
      ],
      isError: true,
    };
  }
}

/**
 * Tool: complete_synthesis
 *
 * Marks synthesis as generated on the root index. Sets `synthesis_generated = true`
 * and transitions the project to COMPLETE if all work packages are done.
 */
const CompleteSynthesisSchema = z.object({
  project_path: z
    .string()
    .optional()
    .describe('Plan folder path — use only if you already have it from a previous tool response. Otherwise prefer cwd_path.'),
  cwd_path: z
    .string()
    .optional()
    .describe('Your workspace root directory — preferred. The server auto-detects the active project.'),
  agent_role: z
    .string()
    .describe('The agent role completing synthesis (must be "Synthesis" or "Project Manager")'),
  synthesis_file: z
    .string()
    .optional()
    .default(SYNTHESIS_ARCHIVE_FILENAME)
    .describe(`Filename of the synthesis document (default: "${SYNTHESIS_ARCHIVE_FILENAME}")`),
});

async function completeSynthesis(
  args: z.infer<typeof CompleteSynthesisSchema>,
  _ledgerRoot?: string
) {
  let projectPath: string;
  try {
    projectPath = await resolveProjectPath(args);
  } catch (err) {
    return { content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }], isError: true };
  }

  const ledgerRoot = typeof _ledgerRoot === 'string' ? _ledgerRoot : undefined;
  const store = new LedgerStore(projectPath, ledgerRoot);

  try {
    let result: { content: Array<{ type: 'text'; text: string }>; isError?: boolean } | undefined;

    await withLock(store.storageDir, async () => {
      const rootIndex = await store.readRootIndex();

      // §19.1 Guard 1: Agent role validation
      const SYNTHESIS_PERMITTED_ROLES: readonly string[] = AGENT_ROLES.filter(
        (r) => r === 'Synthesis' || r === 'Project Manager'
      );
      if (!SYNTHESIS_PERMITTED_ROLES.includes(args.agent_role)) {
        result = {
          content: [
            {
              type: 'text' as const,
              text: `Error: completeSynthesis requires agent_role ${SYNTHESIS_PERMITTED_ROLES.map(r => `"${r}"`).join(' or ')}, got "${args.agent_role}"`,
            },
          ],
          isError: true,
        };
        return;
      }

      // §19.1 Guard 2: Freshly computed counters (do not trust stale pending_work_packages)
      const totalWps = rootIndex.work_packages.length;
      const pendingWps = rootIndex.work_packages.filter(
        (wp) => !isTerminalStatus(wp.status)
      ).length;

      // §19.1 Guard 3: At-least-one-WP guard
      if (totalWps === 0) {
        result = {
          content: [
            {
              type: 'text' as const,
              text: 'Error: Cannot complete synthesis: no work packages exist',
            },
          ],
          isError: true,
        };
        return;
      }

      // §19.1 Guard 4: Pending-WP guard (uses freshly computed pendingWps, not stale counter)
      if (pendingWps > 0) {
        result = {
          content: [
            {
              type: 'text' as const,
              text: `Error: Cannot complete synthesis: ${pendingWps} work package(s) are still pending`,
            },
          ],
          isError: true,
        };
        return;
      }

      rootIndex.synthesis_generated = true;
      rootIndex.synthesis_generated_at = now();
      rootIndex.auto_handoff_depth = 0; // §18.4: depth counter resets only on synthesis completion
      rootIndex.last_updated = now();

      // All WPs are terminal (pendingWps === 0 && totalWps > 0) — transition project to COMPLETE
      rootIndex.status = 'COMPLETE';

      await store.writeRootIndex(rootIndex);

      const synthesisFile = args.synthesis_file ?? SYNTHESIS_ARCHIVE_FILENAME;
      const archiveResult = await store.archiveDocuments([synthesisFile]);

      result = {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                synthesis_generated: true,
                synthesis_generated_at: rootIndex.synthesis_generated_at,
                project_status: rootIndex.status,
                message: 'Synthesis marked as generated.',
                archived_documents: archiveResult.archived,
                archive_skipped: archiveResult.skipped.length > 0 ? archiveResult.skipped : undefined,
                next_steps: [
                  'Your work is complete. Call ledger_get_handoff_status (current_agent: "Synthesis") to end the workflow.',
                ],
              },
              null,
              2
            ),
          },
        ],
      };
    });

    if (result === undefined) {
      throw new Error('Internal error: completeSynthesis — result was not set inside the lock');
    }
    return result;
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error completing synthesis: ${(error as Error).message}`,
        },
      ],
      isError: true,
    };
  }
}

/**
 * @internal — exported for unit testing only
 */
export const _internal = {
  completeSynthesis,
  initializeProject,
  getProjectStatus,
  listProjects,
};

/**
 * Register project lifecycle tools on the MCP server
 */
export function register(server: McpServer): void {
  server.registerTool(
    'ledger_detect_project',
    {
      description:
        'Detect the active project from the current workspace path when project_path is not explicitly provided. ' +
        'Accepts a working directory path (cwd_path), cross-references it against all project roots stored in the ' +
        'centralized ledger, and returns the unique project plan_path. Returns NOT_FOUND if no known project root ' +
        'is an ancestor of the given path, or AMBIGUOUS (with candidate list) if more than one project matches.',
      inputSchema: DetectProjectSchema.passthrough(),
    },
    detectProject as any
  );

  server.registerTool(
    'ledger_get_project_status',
    {
      description: 'Read project overview from the root index. Returns work package summaries, counters, and project status. Self-heals incorrect counters. Call this first to understand project state. Use cwd_path (workspace root) for auto-detection, or project_path if already known.',
      inputSchema: GetProjectStatusSchema,
    },
    getProjectStatus as any
  );

  server.registerTool(
    'ledger_initialize_project',
    {
      description: 'Create a new project ledger. REQUIRED params: project_path, plan_file. Creates root index and .ledger/ subdirectory. Rejects if ledger already exists. Call this once at project start before creating work packages.',
      inputSchema: InitializeProjectSchema.passthrough(),
    },
    initializeProject as any
  );

  server.registerTool(
    'ledger_list_projects',
    {
      description: 'List all projects tracked in the centralized ledger with their current status, dates, and plan paths. OPTIONAL params: status (filter by READY/IN_PROGRESS/COMPLETE/BLOCKED/ARCHIVED). Archived projects are excluded by default — pass include_archived: true to include them, or status: "ARCHIVED" to list only archived projects.',
      inputSchema: ListProjectsSchema.passthrough(),
    },
    listProjects as any
  );

  server.registerTool(
    'ledger_complete_synthesis',
    {
      description: 'Mark synthesis as generated. Sets synthesis_generated=true on the root index and transitions project to COMPLETE if all WPs are done. REQUIRED params: agent_role. Call this after generating the synthesis report. Use cwd_path (workspace root) for auto-detection, or project_path if already known.',
      inputSchema: CompleteSynthesisSchema,
    },
    (args) => completeSynthesis(args)
  );
}

```
###  Path: `/mcp-server/src/tools/work-package.ts`

```ts
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { LedgerStore } from '../storage/ledger-store.js';
import type {
  WorkPackageDetail,
  AcceptanceCriterion,
  Blocker,
} from '../schema/work-package.js';
import type { WorkPackageSummary } from '../schema/root-index.js';
import { formatWpId } from '../utils/wp-id.js';
import { now } from '../utils/timestamp.js';
import {
  isValidStatusTransition,
  canStartWorkPackage,
  canCompleteWorkPackage,
  isTerminalStatus,
} from '../schema/validators.js';
import type { WorkPackageStatus } from '../schema/enums.js';
import { resolveProjectPath } from '../utils/path-validator.js';
import { AGENT_ROLES, ORCHESTRATING_ROLES } from '../utils/constants.js';
import {
  DEFAULT_PIPELINE_STAGES,
  PipelineTypeEnum,
  type PipelineType,
  validateActiveStages,
} from '../utils/pipeline-maps.js';
import { clearSynthesisState } from '../utils/workflow-helpers.js';

/**
 * Extracts the ledger root string from an unknown parameter value.
 * Guards against the MCP SDK injecting a RequestHandlerExtra object as the
 * second positional argument to handler functions (see constraint 58).
 *
 * @param val - The raw value passed as `_ledgerRoot` by the MCP SDK or a test
 * @returns The string value if `val` is a string, otherwise `undefined`
 */
function extractLedgerRoot(val: unknown): string | undefined {
  return typeof val === 'string' ? val : undefined;
}

/**
 * Build a next-step guidance string after a WP status transition.
 *
 * Provides explicit routing so agents never have to guess what comes next.
 * This is a key self-healing measure: the tool response itself tells the agent
 * the correct next action, preventing silent workflow stalls.
 */
function buildStatusTransitionGuidance(
  wpId: string,
  newStatus: string,
  agent: string,
): string {
  switch (newStatus) {
    case 'BLOCKED':
      return (
        `\n\n--- NEXT STEP ---\n` +
        `${wpId} is now BLOCKED. ` +
        `Call ledger_get_handoff_status to confirm your handoff. ` +
        `The Developer will see this WP via ledger_get_next_action and rework the implementation to resolve the blocker.`
      );
    case 'COMPLETE':
      return (
        `\n\n--- NEXT STEP ---\n` +
        `${wpId} is now COMPLETE. Dependent work packages have been auto-unblocked if eligible. ` +
        `Call ledger_get_handoff_status to confirm handoff and check if more WPs need your attention.`
      );
    case 'IN_PROGRESS':
      return (
        `\n\n--- NEXT STEP ---\n` +
        `${wpId} is now IN_PROGRESS. ` +
        `Start your pipeline using ledger_start_pipeline, then complete it with ledger_complete_pipeline when done.`
      );
    default:
      return '';
  }
}

/**
 * @internal — exported for unit testing only
 */
export const _internal = {
  buildStatusTransitionGuidance,
  propagateDependencyUnblock,
  propagateDependencyReblock,
  createWorkPackage,
  updateWorkPackageStatus,
  claimWorkPackage,
  resetReworkCount,
  updateAcceptanceCriteria,
};

/**
 * Tool: get_work_package
 *
 * Reads and returns the full work package detail for a given WP ID.
 */
const GetWorkPackageSchema = z.object({
  project_path: z.string().optional().describe('Plan folder path — use only if you already have it from a previous tool response. Otherwise prefer cwd_path.'),
  cwd_path: z.string().optional().describe('Your workspace root directory — preferred. The server auto-detects the active project.'),
  work_package_id: z
    .string()
    .regex(/^WP-\d{3,}$/)
    .describe('Work package ID, format: WP-001, WP-002, etc.'),
});

async function getWorkPackage(args: z.infer<typeof GetWorkPackageSchema>) {
  let projectPath: string;
  try {
    projectPath = await resolveProjectPath(args);
  } catch (err) {
    return { content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }], isError: true };
  }

  const store = new LedgerStore(projectPath);

  try {
    const wp = await store.readWorkPackage(args.work_package_id);

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(wp, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error: ${(error as Error).message}`,
        },
      ],
      isError: true,
    };
  }
}

/**
 * Tool: list_work_packages
 *
 * Lists work package summaries from the root index.
 * Optionally filters by status and/or assigned_to.
 */
const ListWorkPackagesSchema = z.object({
  project_path: z.string().optional().describe('Plan folder path — use only if you already have it from a previous tool response. Otherwise prefer cwd_path.'),
  cwd_path: z.string().optional().describe('Your workspace root directory — preferred. The server auto-detects the active project.'),
  status: z
    .enum(['READY', 'IN_PROGRESS', 'COMPLETE', 'BLOCKED'])
    .optional()
    .describe('Optional filter by work package status'),
  assigned_to: z.string().optional().describe('Optional filter by assigned agent name'),
});

async function listWorkPackages(args: z.infer<typeof ListWorkPackagesSchema>) {
  let projectPath: string;
  try {
    projectPath = await resolveProjectPath(args);
  } catch (err) {
    return { content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }], isError: true };
  }

  const store = new LedgerStore(projectPath);

  try {
    const rootIndex = await store.readRootIndex();
    let wps = rootIndex.work_packages;

    // Apply filters
    if (args.status) {
      wps = wps.filter((wp) => wp.status === args.status);
    }

    if (args.assigned_to) {
      wps = wps.filter((wp) => wp.assigned_to === args.assigned_to);
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(wps, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error: ${(error as Error).message}`,
        },
      ],
      isError: true,
    };
  }
}

/**
 * Tool: create_work_package
 *
 * Creates a new work package with auto-generated WP ID.
 * Creates both the detail file (.ledger/WP-###.json) and root index summary atomically.
 */
const CreateWorkPackageSchema = z.object({
  project_path: z.string().optional().describe('Plan folder path — use only if you already have it from a previous tool response. Otherwise prefer cwd_path.'),
  cwd_path: z.string().optional().describe('Your workspace root directory — preferred. The server auto-detects the active project.'),
  assigned_to: z
    .string()
    .describe('Agent name assigned to this work package (e.g., "Developer")'),
  dependencies: z
    .array(z.string().regex(/^WP-\d{3,}$/))
    .describe('Array of WP IDs this depends on (e.g., ["WP-001"]). Use [] for no dependencies.'),
  acceptance_criteria: z
    .array(z.string())
    .min(1, 'At least one acceptance criterion is required')
    .describe('Array of acceptance criteria strings (e.g., ["All tests pass", "No lint errors"])'),
  work_package_file: z
    .string()
    .describe('Relative path to the work package spec file (e.g., "work/WP-001.md")'),
  active_pipeline_stages: z
    .array(z.string())
    .optional()
    .describe(
      'Optional pipeline stages for this WP. When omitted, defaults to the 4-stage legacy pipeline ' +
      '(implementation → qa → code-review → documentation). ' +
      'Must be a non-empty subsequence of the canonical ordering: ' +
      'implementation → qa → security-audit → code-review → release-engineering → documentation. ' +
      'All entries must be valid pipeline types from PIPELINE_TYPES. No duplicates allowed.'
    ),
});

/**
 * Cycle detection helper for createWorkPackage (§15.2).
 *
 * Performs a BFS over the existing WP graph to check whether adding an edge
 * from `newId` → `deps` would introduce a cycle. The new WP's own ID is
 * passed as `newId`; if it appears anywhere in the transitive dependency
 * closure of `deps` the result is `true` (cycle detected).
 */
function hasCycle(newId: string, deps: string[], allWps: WorkPackageSummary[]): boolean {
  const visited = new Set<string>();
  const queue = [...deps];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === newId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    const wp = allWps.find((w) => w.work_package_id === current);
    if (wp) queue.push(...wp.dependencies);
  }
  return false;
}

async function createWorkPackage(
  args: z.infer<typeof CreateWorkPackageSchema>,
  _ledgerRoot?: string
) {
  let projectPath: string;
  try {
    projectPath = await resolveProjectPath(args);
  } catch (err) {
    return { content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }], isError: true };
  }

  const ledgerRoot = extractLedgerRoot(_ledgerRoot);
  const store = new LedgerStore(projectPath, ledgerRoot);

  let createdWpId = '';
  const pipelineStageWarnings: string[] = [];

  try {
    // Use createWorkPackageWithSync to atomically create WP detail + root index
    // with guaranteed last_updated stamp, schema validation, and .meta.json sync.
    createdWpId = await store.createWorkPackageWithSync((rootIndex) => {
      // 2. Generate next WP ID using max-based approach (resilient to gaps/deletions)
      const existingNumbers = rootIndex.work_packages.map((wp) =>
        parseInt(wp.work_package_id.replace('WP-', ''), 10)
      );
      const nextWpNumber =
        existingNumbers.length > 0 ? existingNumbers.reduce((max, n) => Math.max(max, n), 0) + 1 : 1;
      const wpId = formatWpId(nextWpNumber);

      // 3. Validate dependencies exist
      for (const depId of args.dependencies) {
        const depExists = rootIndex.work_packages.some(
          (wp) => wp.work_package_id === depId
        );
        if (!depExists) {
          throw new Error(
            `Dependency ${depId} not found in project. Create dependencies before creating this work package.`
          );
        }
      }

      // 3b. Cycle detection (§15.2)
      if (hasCycle(wpId, args.dependencies, rootIndex.work_packages)) {
        throw new Error(
          `Dependency cycle detected: WP ${wpId} would create a circular dependency.`
        );
      }

      // 4. Determine initial status
      let initialStatus: 'READY' | 'BLOCKED' = 'READY';
      let unmetDeps: string[] = [];
      if (args.dependencies.length > 0) {
        const depCheck = canStartWorkPackage(
          { dependencies: args.dependencies } as WorkPackageSummary,
          rootIndex.work_packages
        );
        if (!depCheck.allowed) {
          initialStatus = 'BLOCKED';
          unmetDeps = args.dependencies.filter(
            (depId) =>
              !rootIndex.work_packages.some(
                (w) => w.work_package_id === depId && w.status === 'COMPLETE'
              )
          );
        }
      }

      // 5. Validate acceptance criteria — reject empty or whitespace-only strings
      for (let i = 0; i < args.acceptance_criteria.length; i++) {
        if (!args.acceptance_criteria[i]!.trim()) {
          throw new Error(`acceptance_criteria[${i}] is empty or whitespace-only.`);
        }
      }

      // 5.5. Validate + resolve active_pipeline_stages
      if (args.active_pipeline_stages !== undefined) {
        const { errors, warnings } = validateActiveStages(args.active_pipeline_stages);
        if (errors.length > 0) {
          throw new Error(errors[0]!);
        }
        pipelineStageWarnings.push(...warnings);
      }

      // 6. Create acceptance criteria objects
      const acceptanceCriteria: AcceptanceCriterion[] =
        args.acceptance_criteria.map((criterion) => ({
          criterion,
          met: false,
        }));

      // 7. Create work package detail
      // Note: assigned_to is initially null regardless of input (§9b.1 soft-deprecation).
      // The assigned_to input field is accepted silently but ignored at creation time.
      // The WP will be assigned when an agent claims it via ledger_claim_work_package.
      //
      // Resolve active_pipeline_stages: validated stages if provided, otherwise the
      // backward-compatible default (4-stage legacy pipeline).
      const resolvedActiveStages: PipelineType[] =
        args.active_pipeline_stages !== undefined && args.active_pipeline_stages.length > 0
          ? (args.active_pipeline_stages as PipelineType[])
          : [...DEFAULT_PIPELINE_STAGES];

      const wpDetail: WorkPackageDetail = {
        work_package_id: wpId,
        work_package_file: args.work_package_file,
        status: initialStatus,
        assigned_to: null,
        dependencies: args.dependencies,
        acceptance_criteria: acceptanceCriteria,
        active_pipeline_stages: resolvedActiveStages,
        revision: 0,
        pipelines: [],
        // Note: last_updated is intentionally omitted here — createWorkPackageWithSync
        // auto-stamps it after the callback returns, matching updateWorkPackageWithSync.
      };

      // Set blocked_by when initial status is BLOCKED (§9b.1)
      if (initialStatus === 'BLOCKED') {
        wpDetail.blocked_by = {
          type: 'dependency',
          description: 'Created BLOCKED: one or more dependencies not yet COMPLETE',
          blocking_work_package: unmetDeps[0],
        };
      }

      // 8. Create work package summary
      // assigned_to mirrors the detail: null at creation time.
      const wpSummary: WorkPackageSummary = {
        work_package_id: wpId,
        status: initialStatus,
        assigned_to: null,
        dependencies: args.dependencies,
        file: `ledger/${wpId}.json`,
        active_pipeline_stages: resolvedActiveStages,
      };

      // 9. Update root index
      rootIndex.work_packages.push(wpSummary);
      rootIndex.total_work_packages += 1;
      rootIndex.pending_work_packages += 1;
      rootIndex.last_updated = now();

      // Set project status to IN_PROGRESS if currently READY
      if (rootIndex.status === 'READY') {
        rootIndex.status = 'IN_PROGRESS';
      }

      // Reset synthesis_generated flag if a new WP is added to a COMPLETE project
      // or if the flag is stale (§9b.1 defense-in-depth). Self-healing rules also
      // correct this on read, but an inline reset prevents the window entirely.
      if (rootIndex.status === 'COMPLETE' || rootIndex.synthesis_generated) {
        clearSynthesisState(rootIndex);
      }

      return { wpId, wp: wpDetail, root: rootIndex };
    });

    // 11. Read back the created work package to return it
    const createdWp = await store.readWorkPackage(createdWpId);

    // Include soft pipeline-stage warnings in the response if any were emitted
    const warningText =
      pipelineStageWarnings.length > 0 ? '\n\n' + pipelineStageWarnings.join('\n') : '';

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(createdWp, null, 2) + warningText,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error creating work package: ${(error as Error).message}`,
        },
      ],
      isError: true,
    };
  }
}

/**
 * Tool: claim_work_package
 *
 * Claims a work package by transitioning READY -> IN_PROGRESS.
 * Validates dependencies are met before allowing the transition.
 */
const ClaimWorkPackageSchema = z.object({
  project_path: z.string().optional().describe('Plan folder path — use only if you already have it from a previous tool response. Otherwise prefer cwd_path.'),
  cwd_path: z.string().optional().describe('Your workspace root directory — preferred. The server auto-detects the active project.'),
  work_package_id: z
    .string()
    .regex(/^WP-\d{3,}$/)
    .describe('Work package ID to claim, format: WP-001, WP-002, etc.'),
  agent: z.string().describe('REQUIRED. Your agent name (e.g., "Developer", "QA", "Reviewer", "Documentation")'),
  override: z
    .boolean()
    .optional()
    .describe('Set to true to claim a WP assigned to a different agent. Without this flag, claiming a WP assigned to another agent will be rejected.'),
});

// Roles permitted to claim work packages via ledger_claim_work_package.
// Planner, Synthesis, and other orchestrating roles operate outside the
// dev-loop and must not directly claim implementation work.
export const CLAIMABLE_ROLES: string[] = [
  ...AGENT_ROLES.filter((r) => !(ORCHESTRATING_ROLES as readonly string[]).includes(r)),
  ...AGENT_ROLES
    .filter((r) => !(ORCHESTRATING_ROLES as readonly string[]).includes(r))
    .map((r) => `${r} Agent`),
];

async function claimWorkPackage(
  args: z.infer<typeof ClaimWorkPackageSchema>,
  _ledgerRoot?: string
) {
  let projectPath: string;
  try {
    projectPath = await resolveProjectPath(args);
  } catch (err) {
    return { content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }], isError: true };
  }

  const ledgerRoot = extractLedgerRoot(_ledgerRoot);
  const store = new LedgerStore(projectPath, ledgerRoot);

  try {
    await store.updateWorkPackageWithSync(args.work_package_id, (wp, root) => {
      // 1. Validate current status is READY
      if (wp.status !== 'READY') {
        throw new Error(
          `Cannot claim work package ${args.work_package_id}: current status is ${wp.status}. Only READY work packages can be claimed.`
        );
      }

      // 1b. Role guard: reject non-claimable agent roles (fires unconditionally, before assignment/override checks)
      if (!CLAIMABLE_ROLES.includes(args.agent)) {
        throw new Error(
          `Agent role '${args.agent}' cannot claim work packages. ` +
          `Valid roles: ${CLAIMABLE_ROLES.filter(r => !r.includes('Agent')).join(', ')}.`
        );
      }

      // 2. Assignment guard: reject cross-agent claims unless override is set
      if (
        wp.assigned_to &&
        wp.assigned_to !== args.agent &&
        !args.override
      ) {
        throw new Error(
          `Cannot claim work package ${args.work_package_id}: it is assigned to "${wp.assigned_to}" but you are "${args.agent}".\n\n` +
          `If you need to re-assign this WP, pass override: true. ` +
          `Otherwise, only claim work packages assigned to your role.`
        );
      }

      // 2b. Override authorization: only PM or current assignee may bypass the assignment check
      if (
        args.override &&
        wp.assigned_to &&
        args.agent !== 'Project Manager' &&
        args.agent !== wp.assigned_to
      ) {
        throw new Error(
          `Cannot override claim on work package ${args.work_package_id}: ` +
          `override is restricted to "Project Manager" or the current assignee ` +
          `("${wp.assigned_to}"). You are "${args.agent}".`
        );
      }

      // 3. Check dependencies
      const depCheck = canStartWorkPackage(wp, root.work_packages);
      if (!depCheck.allowed) {
        throw new Error(
          `Cannot claim work package ${args.work_package_id}: ${depCheck.reason}`
        );
      }

      // 4. Validate status transition (should always be valid at this point)
      if (!isValidStatusTransition(wp.status, 'IN_PROGRESS')) {
        throw new Error(
          `Invalid status transition: ${wp.status} -> IN_PROGRESS`
        );
      }

      // 5. Update work package
      wp.status = 'IN_PROGRESS';
      wp.status_changed_at = now();
      wp.assigned_to = args.agent;

      // 6. Update root index summary
      const summary = root.work_packages.find(
        (s) => s.work_package_id === args.work_package_id
      );
      if (summary) {
        summary.status = 'IN_PROGRESS';
        summary.assigned_to = args.agent;
      }

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
          text: `Error claiming work package: ${(error as Error).message}`,
        },
      ],
      isError: true,
    };
  }
}

/**
 * Tool: update_work_package_status
 *
 * Updates work package status with validation.
 * Enforces legal status transitions and special rules (COMPLETE requires all criteria met, etc.).
 */
const UpdateWorkPackageStatusSchema = z.object({
  project_path: z.string().optional().describe('Plan folder path — use only if you already have it from a previous tool response. Otherwise prefer cwd_path.'),
  cwd_path: z.string().optional().describe('Your workspace root directory — preferred. The server auto-detects the active project.'),
  work_package_id: z
    .string()
    .regex(/^WP-\d{3,}$/)
    .describe('Work package ID to update, format: WP-001, WP-002, etc.'),
  status: z
    .enum(['READY', 'IN_PROGRESS', 'COMPLETE', 'BLOCKED', 'CANCELLED'])
    .describe('New status. Legal transitions: READY→IN_PROGRESS, READY→BLOCKED, READY→CANCELLED, IN_PROGRESS→COMPLETE, IN_PROGRESS→BLOCKED, IN_PROGRESS→CANCELLED, IN_PROGRESS→READY, BLOCKED→IN_PROGRESS, BLOCKED→READY, BLOCKED→CANCELLED, COMPLETE→IN_PROGRESS, COMPLETE→CANCELLED. CANCELLED is terminal (PM-only). BLOCKED→BLOCKED is also valid and replaces the existing blocker details.'),
  agent: z
    .string()
    .describe('REQUIRED. Your agent name (e.g., "Developer", "QA", "Reviewer", "Documentation"). Note: only "Documentation" or "Documentation Agent" can set status to COMPLETE.'),
  blocked_by: z
    .object({
      type: z.enum(['dependency', 'decision', 'external', 'technical']),
      description: z.string(),
      blocking_work_package: z.string().optional(),
    })
    .passthrough()
    .optional()
    .describe('Blocker details — REQUIRED when setting status to BLOCKED, omit otherwise'),
});

/**
 * Auto-cancels all IN_PROGRESS pipelines on a work package with a given reason.
 * Used when a WP transitions to BLOCKED or CANCELLED while pipelines are running.
 */
function autoCancelActivePipelines(wp: WorkPackageDetail, reason: string): void {
  const inProgressPipelines = wp.pipelines.filter((p) => p.status === 'IN_PROGRESS');
  for (const p of inProgressPipelines) {
    p.status = 'FAIL';
    p.completed_at = now();
    p.auto_cancelled = true;
    p.summary = [reason];
  }
}

async function updateWorkPackageStatus(
  args: z.infer<typeof UpdateWorkPackageStatusSchema>,
  _ledgerRoot?: string
) {
  let projectPath: string;
  try {
    projectPath = await resolveProjectPath(args);
  } catch (err) {
    return { content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }], isError: true };
  }

  const ledgerRoot = extractLedgerRoot(_ledgerRoot);
  const store = new LedgerStore(projectPath, ledgerRoot);

  try {
    let oldStatus: WorkPackageStatus | undefined;
    await store.updateWorkPackageWithSync(args.work_package_id, (wp, root) => {
      oldStatus = wp.status;
      const newStatus = args.status;

      // 1. Validate status transition
      if (!isValidStatusTransition(oldStatus, newStatus)) {
        throw new Error(
          `Invalid status transition: ${oldStatus} -> ${newStatus}. Legal transitions from ${oldStatus}: ${getLegalTransitions(oldStatus)}`
        );
      }

      // 1a. BLOCKED → BLOCKED: blocker replacement (§21.17)
      // This is a special same-status branch that replaces the blocker metadata.
      // It returns immediately without going through the general mutation path.
      if (oldStatus === 'BLOCKED' && newStatus === 'BLOCKED') {
        const pmAgents = ['Project Manager', 'Project Manager Agent'];
        const isAllowed = pmAgents.includes(args.agent) || args.agent === wp.assigned_to;
        if (!isAllowed) {
          throw new Error(
            `Only the Project Manager or the current assignee ("${wp.assigned_to}") may replace a blocker on work package ${args.work_package_id}. You are: ${args.agent}`
          );
        }
        if (!args.blocked_by) {
          throw new Error('Cannot replace blocker: blocked_by is required when transitioning BLOCKED → BLOCKED');
        }
        // Cannot replace a dependency blocker with a non-dependency blocker.
        // Dependency blockers must be resolved by completing the blocking work package.
        if (wp.blocked_by?.type === 'dependency' && args.blocked_by.type !== 'dependency') {
          throw new Error(
            `Cannot replace a 'dependency' blocker with a '${args.blocked_by.type}' blocker. ` +
            `Dependency blockers can only be resolved by completing the blocking work package.`
          );
        }
        wp.blocked_by = args.blocked_by as Blocker;
        wp.status_changed_at = now();
        root.last_updated = now();
        return { wp, root };
      }

      // 1b. READY → IN_PROGRESS redirect (§10b.2)
      // This transition is reserved for ledger_claim_work_package which validates
      // dependencies and handles proper agent assignment.
      if (oldStatus === 'READY' && newStatus === 'IN_PROGRESS') {
        throw new Error(
          `Cannot transition ${args.work_package_id} from READY to IN_PROGRESS via ledger_update_work_package_status. ` +
          `Use ledger_claim_work_package instead — it validates dependencies and handles the assignment.`
        );
      }

      // 1c. BLOCKED → IN_PROGRESS: agent guard (§6.5, §21.21)
      // Only PM or the current assignee may manually unblock a work package.
      // The system auto-unblock path (propagateDependencyUnblock) transitions to READY
      // directly on the WP detail and does not pass through this guard.
      if (oldStatus === 'BLOCKED' && newStatus === 'IN_PROGRESS') {
        const pmAgents = ['Project Manager', 'Project Manager Agent'];
        const isAllowed =
          pmAgents.includes(args.agent) ||
          (wp.assigned_to !== null && args.agent === wp.assigned_to);
        if (!isAllowed) {
          throw new Error(
            `Only the Project Manager or the current assignee ("${wp.assigned_to ?? 'none'}") may unblock work package ${
              args.work_package_id
            } (BLOCKED → IN_PROGRESS). You are: ${args.agent}`
          );
        }
      }

      // 2. Validate agent permissions for COMPLETE status
      if (newStatus === 'COMPLETE') {
        // Only Documentation Agent can mark work packages as COMPLETE
        // This enforces the correct workflow: Developer -> QA -> Reviewer -> Documentation -> COMPLETE
        if (
          args.agent !== 'Documentation Agent' &&
          args.agent !== 'Documentation'
        ) {
          throw new Error(
            `Only the Documentation Agent can mark work packages as COMPLETE. You are: ${args.agent}\n\n` +
              `Workflow reminder:\n` +
              `  1. Developer Agent: Completes implementation pipeline, leaves WP as IN_PROGRESS\n` +
              `  2. QA Agent: Completes qa pipeline, leaves WP as IN_PROGRESS\n` +
              `  3. Reviewer Agent: Completes code-review pipeline, leaves WP as IN_PROGRESS\n` +
              `  4. Documentation Agent: Completes documentation pipeline, marks WP as COMPLETE\n\n` +
              `If you've completed your pipeline, leave the work package as IN_PROGRESS and call ledger_get_handoff_status to determine the next agent.`
          );
        }
      }

      // 2b. Validate agent permissions for CANCELLED status
      if (newStatus === 'CANCELLED') {
        const allowedCancelAgents = [
          'Project Manager',
          'Project Manager Agent',
        ];
        if (!allowedCancelAgents.includes(args.agent)) {
          throw new Error(
            `Only the Project Manager can cancel work packages. You are: ${args.agent}\n\n` +
              `If you believe this work package should be cancelled, hand off to the Project Manager.`
          );
        }
      }

      // 3. Special validation for COMPLETE: check acceptance criteria
      if (newStatus === 'COMPLETE') {
        const completeCheck = canCompleteWorkPackage(wp);
        if (!completeCheck.allowed) {
          throw new Error(
            `Cannot mark work package as COMPLETE: the following acceptance criteria are not met:\n${completeCheck.unmet?.map((c) => `  - ${c}`).join('\n')}\n\nTo update acceptance criteria:\n1. Complete your pipeline using ledger_complete_pipeline\n2. Include the acceptance_criteria_updates parameter with the criteria you've met\n3. Then mark the work package as COMPLETE`
          );
        }
      }

      // 4. Special validation for BLOCKED
      if (newStatus === 'BLOCKED' && !args.blocked_by) {
        throw new Error(
          'Cannot transition to BLOCKED status without providing blocked_by information'
        );
      }

      // 5. Agent guard for COMPLETE -> IN_PROGRESS (validated before status mutation so the
      //    WP is never partially mutated when the guard rejects the transition)
      if (oldStatus === 'COMPLETE' && newStatus === 'IN_PROGRESS') {
        const allowedReopenAgents = [
          'Project Manager',
          'Project Manager Agent',
          'Documentation',
          'Documentation Agent',
        ];
        if (!allowedReopenAgents.includes(args.agent)) {
          throw new Error(
            `Only the Project Manager or Documentation agent may reopen a COMPLETE work package (COMPLETE → IN_PROGRESS). You are: ${args.agent}\n\n` +
              `If you believe this work package needs rework, hand off to the Project Manager or Documentation agent so they can formally reopen it.`
          );
        }
      }

      // 5a. IN_PROGRESS → READY: guard (§21.13)
      if (oldStatus === 'IN_PROGRESS' && newStatus === 'READY') {
        // Reject if any pipeline is IN_PROGRESS
        const activePipeline = wp.pipelines.find((p) => p.status === 'IN_PROGRESS');
        if (activePipeline) {
          throw new Error(
            `Cannot unclaim work package ${args.work_package_id}: cancel all IN_PROGRESS pipelines before unclaiming.`
          );
        }
        // Reject if the agent is not PM or the current assignee
        const pmAgents = ['Project Manager', 'Project Manager Agent'];
        const isAllowed =
          pmAgents.includes(args.agent) ||
          (wp.assigned_to !== null && args.agent === wp.assigned_to);
        if (!isAllowed) {
          throw new Error(
            `Only the Project Manager or the current assignee ("${wp.assigned_to ?? 'none'}") may unclaim work package ${
              args.work_package_id
            } (IN_PROGRESS → READY). You are: ${args.agent}`
          );
        }
      }

      // 5b. → COMPLETE freshness check (§21.10)
      // The most recent non-auto-cancelled doc PASS must post-date the most recent
      // non-auto-cancelled implementation pipeline start. Absent timestamps are permissive.
      if (newStatus === 'COMPLETE') {
        const docPassPipeline = [...wp.pipelines]
          .reverse()
          .find((p) => p.type === 'documentation' && p.status === 'PASS' && !p.auto_cancelled);
        const implStartPipeline = [...wp.pipelines]
          .reverse()
          .find((p) => p.type === 'implementation' && !p.auto_cancelled);
        if (
          docPassPipeline?.completed_at &&
          implStartPipeline?.started_at &&
          docPassPipeline.completed_at < implStartPipeline.started_at
        ) {
          throw new Error(
            `Cannot mark work package ${args.work_package_id} as COMPLETE: ` +
            `the documentation pipeline PASS (${docPassPipeline.completed_at}) ` +
            `pre-dates the most recent implementation pipeline start (${implStartPipeline.started_at}). ` +
            `The documentation pipeline must be re-run after the latest implementation.`
          );
        }
      }

      // 6. Update work package status
      wp.status = newStatus;
      wp.status_changed_at = now();

      // 7. Handle any exit from BLOCKED (clear blocker)
      // Covers both BLOCKED -> IN_PROGRESS and BLOCKED -> READY so the field is
      // never left stale regardless of which unblock path is taken.
      if (oldStatus === 'BLOCKED' && newStatus !== 'BLOCKED') {
        delete wp.blocked_by;
      }

      // 8. Handle BLOCKED status (set blocker)
      if (newStatus === 'BLOCKED' && args.blocked_by) {
        wp.blocked_by = args.blocked_by as Blocker;
      }

      // 8a. IN_PROGRESS → BLOCKED: auto-cancel IN_PROGRESS pipelines (§10b.1, §21.27)
      if (oldStatus === 'IN_PROGRESS' && newStatus === 'BLOCKED') {
        autoCancelActivePipelines(wp, 'Auto-cancelled: WP transitioned IN_PROGRESS → BLOCKED');
      }

      // 8b. IN_PROGRESS → CANCELLED: auto-cancel IN_PROGRESS pipelines (§21.14b)
      if (oldStatus === 'IN_PROGRESS' && newStatus === 'CANCELLED') {
        autoCancelActivePipelines(wp, 'Auto-cancelled: WP transitioned IN_PROGRESS → CANCELLED');
      }

      // 8c. IN_PROGRESS → READY: clear assignment (unclaim path, §21.13)
      if (oldStatus === 'IN_PROGRESS' && newStatus === 'READY') {
        wp.assigned_to = null;
        const readySummary = root.work_packages.find(
          (s) => s.work_package_id === args.work_package_id
        );
        if (readySummary) {
          readySummary.assigned_to = null;
        }
      }

      // 9. Handle COMPLETE -> IN_PROGRESS (increment revision, reset rework budget, invalidate synthesis)
      if (oldStatus === 'COMPLETE' && newStatus === 'IN_PROGRESS') {
        wp.revision += 1;
        wp.rework_counts = undefined; // Reset per-pipeline rework budget (§21.44)
        clearSynthesisState(root); // Invalidate synthesis (§21.26)
      }

      // 10. Update root index summary
      const summary = root.work_packages.find(
        (s) => s.work_package_id === args.work_package_id
      );
      if (summary) {
        summary.status = newStatus;
      }

      // 11. Update pending_work_packages counter
      // Decrement when transitioning to COMPLETE or CANCELLED (both are terminal)
      if (!isTerminalStatus(oldStatus!) && isTerminalStatus(newStatus)) {
        root.pending_work_packages -= 1;
      }
      // Increment when transitioning from COMPLETE to a non-terminal status (reopen)
      // CANCELLED is also terminal — do not increment when COMPLETE → CANCELLED
      if (oldStatus === 'COMPLETE' && !isTerminalStatus(newStatus)) {
        root.pending_work_packages += 1;
      }

      root.last_updated = now();

      return { wp, root };
    });

    // If the WP was transitioned to COMPLETE, propagate unblocking to dependent WPs.
    //
    // DESIGN NOTE: propagateDependencyUnblock acquires its own lock separately
    // from the updateWorkPackageWithSync lock above. This is intentional:
    // - The first lock (updateWorkPackageWithSync) covers the WP status transition
    // - The second lock (inside propagateDependencyUnblock) covers the cascade unblock
    // - Keeping them as two sequential locks avoids holding a lock during the
    //   potentially slow cascade read of multiple WP detail files
    // - The gap between locks is safe because propagateDependencyUnblock is
    //   idempotent: re-running it on an already-unblocked WP is a no-op
    if (isTerminalStatus(args.status)) {
      await propagateDependencyUnblock(projectPath, args.work_package_id, { store });
    }

    // If the WP was reopened from COMPLETE, cascade-block dependents that are
    // READY or IN_PROGRESS (they may be operating on stale assumptions).
    if (oldStatus === 'COMPLETE' && args.status === 'IN_PROGRESS') {
      await propagateDependencyReblock(projectPath, args.work_package_id, { store });
    }

    // Return updated work package with next-step guidance
    const updatedWp = await store.readWorkPackage(args.work_package_id);
    const guidance = buildStatusTransitionGuidance(
      args.work_package_id,
      args.status,
      args.agent,
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
          text: `Error updating work package status: ${(error as Error).message}`,
        },
      ],
      isError: true,
    };
  }
}

/**
 * Resolve a LedgerStore from an overloaded parameter.
 *
 * Accepts either a raw project root string, a pre-constructed store object,
 * or undefined (in which case a store is created from `projectPath` alone).
 */
function resolveStore(
  projectPath: string,
  ledgerRootOrOpts?: string | { store: LedgerStore }
): LedgerStore {
  return typeof ledgerRootOrOpts === 'object' && ledgerRootOrOpts !== null
    ? ledgerRootOrOpts.store
    : new LedgerStore(projectPath, typeof ledgerRootOrOpts === 'string' ? ledgerRootOrOpts : undefined);
}

/**
 * Helper: Propagate dependency unblocking after a work package transitions to COMPLETE.
 *
 * For all BLOCKED WPs that depend on the just-completed WP, checks whether ALL of
 * their dependencies are now COMPLETE. If so, transitions them to READY and clears
 * the blocked_by field.
 */
export async function propagateDependencyUnblock(
  projectPath: string,
  completedWpId: string,
  ledgerRootOrOpts?: string | { store: LedgerStore }
): Promise<void> {
  const store = resolveStore(projectPath, ledgerRootOrOpts);

  // Pre-check: skip the lock, disk read, and meta sync entirely when there are
  // no BLOCKED WPs that depend on the completed WP. The batch method will
  // re-read inside its lock for the actual operation, so this is safe — the
  // worst case is a race where a WP becomes BLOCKED between this read and the
  // batch call, which would be caught on the next status transition.
  const preCheckRoot = await store.readRootIndex();
  const hasCandidates = preCheckRoot.work_packages.some(
    (wp) => wp.status === 'BLOCKED' && wp.dependencies.includes(completedWpId)
  );
  if (!hasCandidates) return;

  await store.batchUpdateWorkPackagesWithSync(async (rootIndex, readWp) => {
    const updatedWps = new Map<string, WorkPackageDetail>();

    // Find BLOCKED WPs whose dependency list includes the just-completed WP
    const candidates = rootIndex.work_packages.filter(
      (wp) => wp.status === 'BLOCKED' && wp.dependencies.includes(completedWpId)
    );

    for (const candidate of candidates) {
      // Read full WP detail to check all dependencies
      const wpDetail = await readWp(candidate.work_package_id);

      // Check if all dependencies are now COMPLETE
      const canStart = canStartWorkPackage(wpDetail, rootIndex.work_packages);
      if (!canStart.allowed) continue;

      // Skip WPs that are blocked for non-dependency reasons (e.g., external, decision, technical)
      if (wpDetail.blocked_by && wpDetail.blocked_by.type !== 'dependency') {
        continue;
      }

      // Transition BLOCKED -> READY and clear blocked_by
      wpDetail.status = 'READY';
      wpDetail.status_changed_at = now();
      delete wpDetail.blocked_by;

      // Update root summary
      const summary = rootIndex.work_packages.find(
        (s) => s.work_package_id === candidate.work_package_id
      );
      if (summary) {
        summary.status = 'READY';
      }

      updatedWps.set(candidate.work_package_id, wpDetail);
    }

    rootIndex.last_updated = now();
    return { updatedWps, root: rootIndex };
  });
}

/**
 * Helper: Propagate dependency re-blocking when a COMPLETE work package is reopened.
 *
 * For all non-COMPLETE WPs that depend on the reopened WP, if their status is
 * READY or IN_PROGRESS, transition them to BLOCKED with an appropriate blocked_by
 * reason. COMPLETE dependents are left unchanged — they may have been independently
 * finished and their pipelines remain valid.
 *
 * NOTE: When auto-cancelling IN_PROGRESS pipelines (Phase 1), the entire
 * `summary` array is replaced. Any partial progress notes recorded via
 * ledger_update_pipeline_progress are intentionally discarded — the work
 * is considered void and must restart on re-claim.
 */
async function propagateDependencyReblock(
  projectPath: string,
  reopenedWpId: string,
  ledgerRootOrOpts?: string | { store: LedgerStore }
): Promise<void> {
  const store = resolveStore(projectPath, ledgerRootOrOpts);

  // Pre-check: skip the lock, disk read, and meta sync entirely when there are
  // no WPs that depend on the reopened WP and would require any action — either
  // re-blocking (READY/IN_PROGRESS candidates) or a warning annotation (COMPLETE
  // dependents). BLOCKED and CANCELLED dependents are untouched by both loops, so
  // they do not qualify. The batch method will re-read inside its lock for the
  // actual operation, so this is safe — the worst case is a race where a WP
  // becomes READY/IN_PROGRESS between this read and the batch call, which would
  // be caught on the next status transition.
  const preCheckRoot = await store.readRootIndex();
  const ACTION_STATUSES = new Set(['READY', 'IN_PROGRESS', 'COMPLETE']);
  const hasCandidates = preCheckRoot.work_packages.some(
    (wp) =>
      ACTION_STATUSES.has(wp.status) && wp.dependencies.includes(reopenedWpId)
  );
  if (!hasCandidates) return;

  await store.batchUpdateWorkPackagesWithSync(async (rootIndex, readWp) => {
    const updatedWps = new Map<string, WorkPackageDetail>();

    // Find non-terminal, non-BLOCKED WPs whose dependency list includes the reopened WP
    const candidates = rootIndex.work_packages.filter(
      (wp) =>
        !isTerminalStatus(wp.status) &&
        wp.status !== 'BLOCKED' &&
        wp.dependencies.includes(reopenedWpId)
    );

    for (const candidate of candidates) {
      const wpDetail = await readWp(candidate.work_package_id);

      // Transition READY/IN_PROGRESS -> BLOCKED
      wpDetail.status = 'BLOCKED';
      wpDetail.status_changed_at = now();
      wpDetail.blocked_by = {
        type: 'dependency',
        description: `Dependency ${reopenedWpId} was reopened`,
        blocking_work_package: reopenedWpId,
      };

      // Auto-cancel any IN_PROGRESS pipelines on the re-blocked WP (§15.5)
      autoCancelActivePipelines(wpDetail, `Auto-cancelled: dependency ${reopenedWpId} was reopened`);

      // Update root summary
      const summary = rootIndex.work_packages.find(
        (s) => s.work_package_id === candidate.work_package_id
      );
      if (summary) {
        summary.status = 'BLOCKED';
      }

      updatedWps.set(candidate.work_package_id, wpDetail);
    }

    // Warn COMPLETE dependents without changing their status (§15.5)
    const completeWps = rootIndex.work_packages.filter(
      (wp) => wp.status === 'COMPLETE' && wp.dependencies.includes(reopenedWpId)
    );
    for (const candidate of completeWps) {
      const wpDetail = await readWp(candidate.work_package_id);
      const lastPipeline = wpDetail.pipelines.at(-1);
      if (lastPipeline) {
        if (!lastPipeline.comments) lastPipeline.comments = [];
        lastPipeline.comments.push({
          type: 'warning',
          priority: 'medium',
          timestamp: now(),
          note:
            `Dependency ${reopenedWpId} was reopened. Review whether ` +
            `${candidate.work_package_id} needs to be revisited.`,
        });
        updatedWps.set(candidate.work_package_id, wpDetail);
      }
    }

    // Reset synthesis_generated when at least one WP was re-blocked (§21.26 crash-recovery safety net)
    if (candidates.length > 0) {
      clearSynthesisState(rootIndex);
    }

    // Recompute pending_work_packages
    rootIndex.pending_work_packages = rootIndex.work_packages.filter(
      (wp) => !isTerminalStatus(wp.status)
    ).length;
    rootIndex.last_updated = now();
    return { updatedWps, root: rootIndex };
  });
}

/**
 * Helper function to describe legal transitions from a given status
 */
function getLegalTransitions(status: string): string {
  switch (status) {
    case 'READY':
      return 'IN_PROGRESS, BLOCKED, CANCELLED';
    case 'IN_PROGRESS':
      return 'COMPLETE, BLOCKED, CANCELLED, READY';
    case 'BLOCKED':
      return 'IN_PROGRESS, READY, CANCELLED';
    case 'COMPLETE':
      return 'IN_PROGRESS, CANCELLED';
    case 'CANCELLED':
      return 'none (terminal)';
    default:
      return 'none';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool: reset_rework_count (§16.3b)
// ─────────────────────────────────────────────────────────────────────────────

const ResetReworkCountSchema = z.object({
  project_path: z.string().optional().describe('Plan folder path — use only if you already have it from a previous tool response. Otherwise prefer cwd_path.'),
  cwd_path: z.string().optional().describe('Your workspace root directory — preferred. The server auto-detects the active project.'),
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

  const ledgerRoot = extractLedgerRoot(_ledgerRoot);
  const store = new LedgerStore(projectPath, ledgerRoot);

  try {
    // PM-only guard
    if (args.agent_role !== 'Project Manager') {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error: ledger_reset_rework_count is a PM-only tool. You are: ${args.agent_role}`,
          },
        ],
        isError: true,
      };
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
// Tool: update_acceptance_criteria (§12.3b)
// ─────────────────────────────────────────────────────────────────────────────

const UpdateAcceptanceCriteriaSchema = z.object({
  project_path: z.string().optional().describe('Plan folder path — use only if you already have it from a previous tool response. Otherwise prefer cwd_path.'),
  cwd_path: z.string().optional().describe('Your workspace root directory — preferred. The server auto-detects the active project.'),
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
  if (args.agent_role !== 'Project Manager') {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error: ledger_update_acceptance_criteria is a PM-only tool. You are: ${args.agent_role}`,
        },
      ],
      isError: true,
    };
  }

  const ledgerRoot = extractLedgerRoot(_ledgerRoot);
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

/**
 * Register work package tools on the MCP server
 */
export function register(server: McpServer): void {
  server.registerTool(
    'ledger_get_work_package',
    {
      description: 'Read the full detail for a specific work package',
      inputSchema: GetWorkPackageSchema,
    },
    getWorkPackage as any
  );

  server.registerTool(
    'ledger_list_work_packages',
    {
      description: 'List work package summaries with optional filters',
      inputSchema: ListWorkPackagesSchema,
    },
    listWorkPackages as any
  );

  server.registerTool(
    'ledger_create_work_package',
    {
      description: 'Create a new work package with auto-generated WP ID. REQUIRED params: assigned_to, dependencies (use [] if none), acceptance_criteria, work_package_file. Creates both detail file and root index summary atomically. Use cwd_path (workspace root) for auto-detection, or project_path if already known.',
      inputSchema: CreateWorkPackageSchema,
    },
    (args) => createWorkPackage(args)
  );

  server.registerTool(
    'ledger_claim_work_package',
    {
      description: 'Claim a READY work package by transitioning to IN_PROGRESS. REQUIRED params: work_package_id, agent. Rejects claims when the WP is assigned to a different agent unless override: true is passed. Validates that all dependencies are COMPLETE before allowing the claim. Use cwd_path (workspace root) for auto-detection, or project_path if already known.',
      inputSchema: ClaimWorkPackageSchema,
    },
    (args) => claimWorkPackage(args)
  );

  server.registerTool(
    'ledger_update_work_package_status',
    {
      description: 'Update work package status. REQUIRED params: work_package_id, status, agent. The "agent" param must be your agent name (e.g., "Developer", "Documentation"). Only the Documentation agent can set status to COMPLETE. If setting status to BLOCKED, also provide blocked_by. Use cwd_path (workspace root) for auto-detection, or project_path if already known.',
      inputSchema: UpdateWorkPackageStatusSchema,
    },
    (args) => updateWorkPackageStatus(args)
  );

  server.registerTool(
    'ledger_reset_rework_count',
    {
      description: 'PM-only: resets the rework counter for a specific pipeline type on a work package back to 0. Records an audit comment. No-op if counter is already 0.',
      inputSchema: ResetReworkCountSchema,
    },
    (args) => resetReworkCount(args)
  );

  server.registerTool(
    'ledger_update_acceptance_criteria',
    {
      description: 'PM-only: remove or modify acceptance criteria text on a work package. Rejects operations that would leave zero criteria. Supported operations: remove (by exact text), modify_text (old → new).',
      inputSchema: UpdateAcceptanceCriteriaSchema,
    },
    (args) => updateAcceptanceCriteria(args)
  );
}

```
###  Path: `/mcp-server/src/tools/workflow-handoff.ts`

```ts
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { LedgerStore } from '../storage/ledger-store.js';
import type { RootIndex } from '../schema/root-index.js';
import type { WorkPackageDetail } from '../schema/work-package.js';
import { resolveProjectPath } from '../utils/path-validator.js';
import { AGENT_ROLES, READY_STATUS_FOR_ROLE, HANDOFF_STATUS_ROLE, type AgentRole } from '../utils/constants.js';
import { isRegistryLoaded, getAgentHandle, getAgentId } from '../utils/agent-registry.js';
import { now } from '../utils/timestamp.js';
import {
  resolvePrerequisite,
  DEFAULT_PIPELINE_STAGES,
  type PipelineType,
} from '../utils/pipeline-maps.js';
import {
  buildHandoffPrompt,
  isBlockedByDependencies,
  isMostRecentPipelineFail,
  effectiveMaxDepth,
  hasDownstreamReengagedSince,
  hasNewUpstreamPassSince,
} from '../utils/workflow-helpers.js';
import { getConfig } from '../gui/config.js';
import { isTerminalStatus } from '../schema/validators.js';

/** Shared return type for all per-role handoff handlers. */
type HandoffResult = { content: Array<{ type: string; text: string }>; isError?: boolean };

/** Handler signature: (wpDetails, projectPath, store) → handoff result. */
type HandoffHandler = (
  wpDetails: WorkPackageDetail[],
  projectPath?: string,
  store?: LedgerStore,
) => Promise<HandoffResult>;

/**
 * Manifest-typed dispatch map from agent role → handoff handler.
 *
 * Keyed by `AgentRole` (derived from the shared workflow manifest) so that
 * TypeScript flags any mismatch when a role is added, removed, or renamed.
 * This replaces the two former switch statements in `getHandoffStatus()` and
 * `computeHandoffStatus()` with a single source of truth.
 */
const HANDOFF_DISPATCH: Record<AgentRole, HandoffHandler> = {
  'Planner':          getPlannerHandoff,
  'Project Manager':  getProjectManagerHandoff,
  'Developer':        getDeveloperHandoff,
  'QA':               getQaHandoff,
  'Security Auditor': getSecurityAuditorHandoff,
  'Reviewer':         getReviewerHandoff,
  'Release Engineer': getReleaseEngineerHandoff,
  'Documentation':    getDocumentationHandoff,
  'Synthesis':        (_, projectPath, store) =>
    buildHandoffResponse(
      'Synthesis',
      'COMPLETE',
      'Synthesis complete.',
      'Call ledger_get_next_action first to check if synthesis work is pending before generating your report.',
      projectPath,
      store,
    ),
};

/**
 * Tool: get_handoff_status
 *
 * Reads root index and examines all WP statuses and pipelines to compute
 * the correct AGENT: and STATUS: handoff block for the current agent.
 */
const GetHandoffStatusSchema = z.object({
  project_path: z.string().optional().describe('Plan folder path — use only if you already have it from a previous tool response. Otherwise prefer cwd_path.'),
  cwd_path: z.string().optional().describe('Your workspace root directory — preferred. The server auto-detects the active project.'),
  current_agent: z
    .string()
    .describe(
      'REQUIRED. Your agent role, exactly one of: "Planner", "Project Manager", "Developer", "QA", "Security Auditor", "Reviewer", "Release Engineer", "Documentation", "Synthesis"'
    ),
});

async function getHandoffStatus(args: z.infer<typeof GetHandoffStatusSchema>) {
  let projectPath: string;
  try {
    projectPath = await resolveProjectPath(args);
  } catch (err) {
    return { content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }], isError: true };
  }

  const store = new LedgerStore(projectPath);

  try {
    // Validate agent role
    if (!AGENT_ROLES.includes(args.current_agent as AgentRole)) {
      throw new Error(
        `Unknown agent role: ${args.current_agent}. Valid roles are: ${AGENT_ROLES.join(', ')}`
      );
    }

    // Read root index
    const rootIndex = await store.readRootIndex();

    // Check for BLOCKED work packages. Report BLOCKED whenever blocked WPs exist
    // and nothing is actionable (no READY or IN_PROGRESS WPs), regardless of
    // whether some WPs are already COMPLETE. A mixed BLOCKED + COMPLETE state
    // with no forward progress indicates a genuine stall that needs PM resolution.
    const blockedWps = rootIndex.work_packages.filter(
      (wp) => wp.status === 'BLOCKED'
    );
    const readyOrInProgressWps = rootIndex.work_packages.filter(
      (wp) => wp.status === 'READY' || wp.status === 'IN_PROGRESS'
    );

    if (blockedWps.length > 0 && readyOrInProgressWps.length === 0) {
      return buildHandoffResponse(
        args.current_agent,
        'BLOCKED',
        `All work packages are BLOCKED: ${blockedWps.map((wp) => wp.work_package_id).join(', ')}. Resolution required before proceeding.`,
        undefined,
        projectPath,
        store
      );
    }

    // Load all WP details to examine pipeline states first
    // (We need this to make informed decisions about handoff status)
    const wpDetails = await Promise.all(
      rootIndex.work_packages.map((wp) =>
        store.readWorkPackage(wp.work_package_id)
      )
    );

    // Agent-specific handoff logic (dispatch map is typed by AgentRole from the manifest)
    const handler = HANDOFF_DISPATCH[args.current_agent as AgentRole];
    if (handler) {
      return handler(wpDetails, projectPath, store);
    }
    return buildHandoffResponse(args.current_agent, 'IN_PROGRESS', 'Work in progress.', undefined, projectPath, store);
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error: ${(error as Error).message}`,
        },
      ],
      isError: true,
    };
  }
}

/**
 * Derive the next agent from a handoff status.
 *
 * For READY_FOR_* statuses the next agent is the target role.
 * For IN_PROGRESS the caller continues (next === current).
 * For BLOCKED, the Project Manager triages.
 * For COMPLETE, no next agent is needed.
 */
export function nextAgentFromStatus(status: string, currentAgent: string): string | null {
  if (status === 'IN_PROGRESS') return currentAgent;
  if (isTerminalStatus(status)) return null;
  return HANDOFF_STATUS_ROLE[status] ?? null;
}

/** Build a standard handoff response payload with current_agent, next_agent, and status.
 *
 * When `projectPath` and `store` are provided, this function will also attempt to include
 * an `auto_handoff` object in the payload if all eligibility conditions are met:
 * - Registry is loaded (`isRegistryLoaded()` returns true)
 * - Next agent has a known VS Code handle
 * - Status is not COMPLETE, BLOCKED, or IN_PROGRESS
 * - `auto_handoff_depth` in the ledger is below `effectiveMaxDepth(total_work_packages)` (§18.2.1)
 *
 * The depth counter is reset to 0 only inside completeSynthesis (§18.4), not on individual WP completions.
 */
export async function buildHandoffResponse(
  currentAgent: string,
  status: string,
  details: string,
  nextAction?: string,
  projectPath?: string,
  store?: LedgerStore
) {
  const nextAgent = nextAgentFromStatus(status, currentAgent);
  const payload: Record<string, unknown> = {
    current_agent: currentAgent,
    ...(nextAgent ? { next_agent: nextAgent } : {}),
    status,
    details,
  };
  if (nextAction) payload.next_action = nextAction;

  // Auto-handoff eligibility check.
  // NOTE: `status` here is the handoff status value (e.g., READY_FOR_DEVELOPER, READY_FOR_PM),
  // NOT the ProjectStatus (e.g., IN_PROGRESS). Auto-handoff triggers only for
  // READY_FOR_* statuses — non-READY_FOR_* values (COMPLETE, BLOCKED, IN_PROGRESS, WAIT)
  // are explicitly excluded by the conditions below.
  if (
    projectPath &&
    store &&
    status !== 'COMPLETE' &&
    status !== 'BLOCKED' &&
    status !== 'IN_PROGRESS' &&
    getConfig().auto_handoff_enabled &&
    isRegistryLoaded()
  ) {
    const agentName = nextAgent ? getAgentHandle(nextAgent) : null;
    if (agentName !== null) {
      try {
        const root = await store.readRootIndex();
        const currentDepth = root.auto_handoff_depth ?? 0;
        if (currentDepth < effectiveMaxDepth(root.total_work_packages ?? 0)) {
          await store.writeRootIndex({
            ...root,
            auto_handoff_depth: currentDepth + 1,
            last_updated: now(),
          });
          const agentId = nextAgent ? getAgentId(nextAgent) : null;
          payload.auto_handoff = {
            agent_name: agentName,
            ...(agentId !== null ? { agent_id: agentId } : {}),
            prompt: buildHandoffPrompt(projectPath, agentId ?? undefined),
          };
        } else {
          // §18.5: Depth limit reached — surface reason in the response payload and emit a
          // project comment so the PM has a diagnostic breadcrumb in the ledger.
          payload.handoff_suppressed_reason = 'depth_limit_reached';
          const updated = { ...root, last_updated: now() };
          updated.project_comments = [
            ...root.project_comments,
            {
              type: 'warning',
              priority: 'high',
              timestamp: now(),
              agent: 'System',
              note: `Auto-handoff depth limit reached (depth ${currentDepth} / ceiling ${effectiveMaxDepth(root.total_work_packages ?? 0)}). Manual routing required.`,
            },
          ];
          await store.writeRootIndex(updated);
        }
      } catch (err) {
        process.stderr.write(`[buildHandoffResponse] storage error (auto-handoff depth update): ${String(err)}\n`);
      }
    }
  }

  // auto_handoff_depth is reset only in completeSynthesis (not on individual WP completions, per §18.4)

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

/**
 * Get handoff status for Planner
 *
 * Planner has completed the project plan. If work packages exist and are
 * READY/IN_PROGRESS, hand off to Developer. Otherwise return WAIT.
 */
export async function getPlannerHandoff(wpDetails: WorkPackageDetail[], projectPath?: string, store?: LedgerStore) {
  if (wpDetails.length === 0) {
    return buildHandoffResponse(
      'Planner',
      'READY_FOR_PM',
      'Planning complete. No work packages exist yet — ready for Project Manager to decompose the plan.',
      undefined,
      projectPath,
      store
    );
  }

  const readyOrInProgressWps = wpDetails.filter(
    (wp) => wp.status === 'READY' || wp.status === 'IN_PROGRESS'
  );

  if (readyOrInProgressWps.length > 0) {
    return buildHandoffResponse(
      'Planner',
      'READY_FOR_DEVELOPER',
      `Planning complete. ${readyOrInProgressWps.length} work package(s) are READY or IN_PROGRESS for implementation.`,
      undefined,
      projectPath,
      store
    );
  }

  return buildHandoffResponse(
    'Planner',
    'WAIT',
    'Planning complete. All work packages are either COMPLETE or BLOCKED. No further planner action needed.',
    undefined,
    projectPath,
    store
  );
}

/**
 * Private helper: map an `assigned_to` value to the corresponding READY_FOR_* handoff status.
 * Used by getProjectManagerHandoff to route READY work packages to the correct agent.
 */
function readyStatusForAgent(assignedTo: string | null): string {
  return READY_STATUS_FOR_ROLE[assignedTo as AgentRole] ?? 'READY_FOR_DEVELOPER';
}

/**
 * Get handoff status for Project Manager (§5.5)
 *
 * Priority-ordered algorithm:
 * 1. Non-dependency blockers (decision/external/technical) → IN_PROGRESS (PM must act)
 * 2. READY WPs → route to assigned agent via readyStatusForAgent
 * 3. All terminal → READY_FOR_SYNTHESIS
 * 4. WPs in-flight (IN_PROGRESS or dependency-BLOCKED) → WAIT
 */
export async function getProjectManagerHandoff(wpDetails: WorkPackageDetail[], projectPath?: string, store?: LedgerStore) {
  // Step 1: Non-dependency blockers — PM must resolve before work can continue.
  // Dependency-blocked WPs (blocked_by absent or blocked_by.type === 'dependency') are
  // skipped — they are gated on other WPs completing, not on PM intervention.
  for (const wp of wpDetails) {
    if (
      !isTerminalStatus(wp.status) &&
      wp.status === 'BLOCKED' &&
      wp.blocked_by != null &&
      ['decision', 'external', 'technical'].includes(wp.blocked_by.type)
    ) {
      return buildHandoffResponse(
        'Project Manager',
        'IN_PROGRESS',
        `Blocker resolution required: ${wp.work_package_id} is BLOCKED by a ${wp.blocked_by.type} issue — "${wp.blocked_by.description}". Project Manager must resolve before work can continue.`,
        undefined,
        projectPath,
        store
      );
    }
  }

  // Step 2: READY WPs → route to the agent assigned to that work package.
  for (const wp of wpDetails) {
    if (wp.status === 'READY') {
      const status = readyStatusForAgent(wp.assigned_to ?? null);
      return buildHandoffResponse(
        'Project Manager',
        status,
        `Work package ${wp.work_package_id} is READY and assigned to ${wp.assigned_to ?? 'Developer (default)'}. Routing to the appropriate agent.`,
        undefined,
        projectPath,
        store
      );
    }
  }

  // Step 3: All terminal → Synthesis.
  if (wpDetails.length > 0 && wpDetails.every((wp) => isTerminalStatus(wp.status))) {
    return buildHandoffResponse(
      'Project Manager',
      'READY_FOR_SYNTHESIS',
      'All work packages are in a terminal state. Project ready for Synthesis.',
      undefined,
      projectPath,
      store
    );
  }

  // Step 4: WPs in-flight (IN_PROGRESS or dependency-BLOCKED) — no PM action needed.
  return buildHandoffResponse(
    'Project Manager',
    'WAIT',
    'Work packages are in-flight (IN_PROGRESS or BLOCKED by dependencies). No Project Manager action needed.',
    undefined,
    projectPath,
    store
  );
}

/**
 * Get handoff status for Developer (§5.1)
 *
 * Priority-ordered algorithm:
 * 1. Temporal-guarded FAIL check — only trigger rework when downstream has ALREADY
 *    re-engaged since the most recent implementation PASS (prevents false rework loops
 *    when Developer has re-delivered but downstream has not yet started).
 * 2. All non-BLOCKED WPs have PASS impl → READY_FOR_QA.
 * 3. Non-BLOCKED WPs still need implementation or have impl FAIL → IN_PROGRESS.
 * 4. All WPs terminal → READY_FOR_SYNTHESIS.
 * Fallback → READY_FOR_QA (partial-complete case).
 */
export async function getDeveloperHandoff(wpDetails: WorkPackageDetail[], projectPath?: string, store?: LedgerStore) {
  // Early exit: all WPs terminal → READY_FOR_SYNTHESIS (§5.1 step 3).
  // Must be checked BEFORE allImplemented to avoid false positives on CANCELLED WPs
  // that have no impl pipeline.
  if (wpDetails.length > 0 && wpDetails.every((wp) => isTerminalStatus(wp.status))) {
    return buildHandoffResponse(
      'Developer',
      'READY_FOR_SYNTHESIS',
      'All work packages are in a terminal state (COMPLETE or CANCELLED).',
      undefined,
      projectPath,
      store
    );
  }

  // Step 1 of §5.1: Temporal-guarded FAIL check.
  // Fire IN_PROGRESS only when a downstream agent has ALREADY started work after our
  // most recent implementation PASS. This prevents false rework loops: if Developer
  // has re-delivered (impl-2 PASS) but QA has not yet started, hasDownstreamReengagedSince
  // returns false and we fall through to READY_FOR_QA instead of re-triggering rework.
  const activeWps = wpDetails.filter(
    (wp) => !isTerminalStatus(wp.status) && !isBlockedByDependencies(wp)
  );
  const failTypes = ['implementation', 'qa', 'code-review'] as const;
  for (const wp of activeWps) {
    for (const type of failTypes) {
      if (
        isMostRecentPipelineFail(wp.pipelines, type) &&
        hasDownstreamReengagedSince(wp.pipelines, 'implementation')
      ) {
        const wpsNeedingRework = activeWps.filter((w) =>
          failTypes.some(
            (t) =>
              isMostRecentPipelineFail(w.pipelines, t) &&
              hasDownstreamReengagedSince(w.pipelines, 'implementation')
          )
        );
        return buildHandoffResponse(
          'Developer',
          'IN_PROGRESS',
          `Implementation work in progress. ${wpsNeedingRework.length} work package(s) have downstream failures requiring rework (downstream re-engaged after last implementation PASS).`,
          `Call ledger_get_next_action with agent_role: "Developer" to find the next work package to implement or rework. Continue working until all WPs have PASS implementation pipelines.`,
          projectPath,
          store
        );
      }
    }
  }

  // Only consider non-BLOCKED WPs for the remaining implementation progress checks.
  // BLOCKED WPs have no implementation pipeline yet (they're waiting on dependencies)
  // and must not be counted as "needing work" by the Developer right now.
  const nonBlockedWps = wpDetails.filter((wp) => wp.status !== 'BLOCKED');

  // Check if all non-BLOCKED WPs have PASS implementation pipelines
  const allImplemented = nonBlockedWps.length > 0 && nonBlockedWps.every((wp) =>
    wp.pipelines.some((p) => p.type === 'implementation' && p.status === 'PASS')
  );

  if (allImplemented) {
    return buildHandoffResponse(
      'Developer',
      'READY_FOR_QA',
      'All work packages have PASS implementation pipelines.',
      undefined,
      projectPath,
      store
    );
  }

  // Check if any non-BLOCKED WP needs implementation or has FAIL pipeline.
  //
  // NOTE: isMostRecentPipelineFail is intentionally NOT used here for the needsWork
  // check. That helper only checks the most recent pipeline, which would miss a WP
  // that has an older FAIL pipeline followed by a currently IN_PROGRESS one.
  // getDeveloperHandoff needs a conservative signal: if any implementation attempt
  // has ever FAIL-ed and no PASS pipeline exists yet, the WP is still considered
  // in-progress. The temporal guard above handles the case where a downstream FAIL
  // requires Developer rework.
  //
  // BLOCKED WPs are excluded: they are gated on dependencies and cannot be
  // claimed by the Developer right now. Including them caused a false IN_PROGRESS
  // that contradicted the WAIT returned by ledger_get_next_action.
  const needsWork = nonBlockedWps.some(
    (wp) =>
      !wp.pipelines.some((p) => p.type === 'implementation') ||
      wp.pipelines.some((p) => p.type === 'implementation' && p.status === 'FAIL')
  );

  if (needsWork) {
    // Count how many non-BLOCKED work packages still need implementation
    const wpsNeedingWork = nonBlockedWps.filter(
      (wp) =>
        !wp.pipelines.some((p) => p.type === 'implementation') ||
        wp.pipelines.some((p) => p.type === 'implementation' && p.status === 'FAIL')
    );

    return buildHandoffResponse(
      'Developer',
      'IN_PROGRESS',
      `Implementation work in progress. ${wpsNeedingWork.length} work package(s) still need implementation or rework.`,
      `Call ledger_get_next_action with agent_role: "Developer" to find the next work package to implement. Continue working until all WPs have PASS implementation pipelines.`,
      projectPath,
      store
    );
  }

  return buildHandoffResponse(
    'Developer',
    'READY_FOR_QA',
    'Implementation complete.',
    undefined,
    projectPath,
    store
  );
}

/**
 * Get handoff status for QA (§5.2)
 *
 * Re-engagement step MUST precede the FAIL short-circuit (§5.2 critical note).
 * After qa-1 FAIL → impl-2 PASS, hasNewUpstreamPassSince returns true, routing
 * QA back to IN_PROGRESS rather than incorrectly sending Developer to rework.
 */
export async function getQaHandoff(wpDetails: WorkPackageDetail[], projectPath?: string, store?: LedgerStore) {
  // All-terminal early exit: if every WP is COMPLETE/CANCELLED the project is done.
  if (wpDetails.length > 0 && wpDetails.every((wp) => isTerminalStatus(wp.status))) {
    return buildHandoffResponse(
      'QA',
      'READY_FOR_SYNTHESIS',
      'All work packages are in a terminal state.',
      undefined,
      projectPath,
      store
    );
  }

  // Step 1 of §5.2: Re-engagement check — MUST precede FAIL short-circuit.
  // If QA FAIL exists AND Developer has since re-delivered a PASS implementation,
  // QA must re-engage (IN_PROGRESS) rather than routing back to READY_FOR_DEVELOPER.
  for (const wp of wpDetails) {
    if (
      !isTerminalStatus(wp.status) &&
      !isBlockedByDependencies(wp) &&
      isMostRecentPipelineFail(wp.pipelines, 'qa') &&
      hasNewUpstreamPassSince(wp.pipelines, 'implementation', 'qa')
    ) {
      return buildHandoffResponse(
        'QA',
        'IN_PROGRESS',
        `QA re-engagement required: ${wp.work_package_id} has a QA FAIL but implementation was re-delivered after the failure. QA must re-validate.`,
        `Call ledger_get_next_action with agent_role: "QA" to find the work package to re-validate.`,
        projectPath,
        store
      );
    }
  }

  // Check if all WPs with implementation pipelines have PASS QA pipelines
  const wpsWithImpl = wpDetails.filter((wp) =>
    wp.pipelines.some((p) => p.type === 'implementation' && p.status === 'PASS')
  );

  const allQaPassed = wpsWithImpl.every((wp) =>
    wp.pipelines.some((p) => p.type === 'qa' && p.status === 'PASS')
  );

  // Check if there are WPs that still need implementation (BLOCKED, READY, or IN_PROGRESS without PASS impl)
  const wpsStillNeedingImpl = wpDetails.filter(
    (wp) => !wp.pipelines.some((p) => p.type === 'implementation' && p.status === 'PASS')
  );

  if (allQaPassed && wpsWithImpl.length > 0) {
    // If there are still WPs that haven't been implemented, check if they're blocked or ready
    if (wpsStillNeedingImpl.length > 0) {
      // Check if these WPs are actually ready or blocked by dependencies
      const readyWps = wpsStillNeedingImpl.filter(
        (wp) => !isBlockedByDependencies(wp)
      );
      const blockedWps = wpsStillNeedingImpl.filter((wp) =>
        isBlockedByDependencies(wp)
      );

      // If all unimplemented WPs are blocked, proceed to Review instead of waiting
      if (readyWps.length === 0 && blockedWps.length > 0) {
        return buildHandoffResponse(
          'QA',
          'READY_FOR_REVIEW',
          `QA passed for ${wpsWithImpl.length} implemented work package(s). ${blockedWps.length} work package(s) blocked by dependencies: ${blockedWps.map((wp) => wp.work_package_id).join(', ')}. Proceed to Review to complete current WPs.`,
          undefined,
          projectPath,
          store
        );
      }

      // Some WPs are ready for implementation
      return buildHandoffResponse(
        'QA',
        'READY_FOR_DEVELOPER',
        `QA passed for ${wpsWithImpl.length} implemented work package(s). ${readyWps.length} work package(s) ready for implementation: ${readyWps.map((wp) => wp.work_package_id).join(', ')}${blockedWps.length > 0 ? `. ${blockedWps.length} blocked by dependencies.` : ''}`,
        undefined,
        projectPath,
        store
      );
    }

    return buildHandoffResponse(
      'QA',
      'READY_FOR_REVIEW',
      'All work packages have PASS QA pipelines.',
      undefined,
      projectPath,
      store
    );
  }

  // Check if any non-BLOCKED WP needs QA or has FAIL pipeline.
  // BLOCKED WPs need Developer rework before QA can retry — exclude them.
  // Distinguish between "needs new QA" / "QA IN_PROGRESS" (→ IN_PROGRESS)
  // and "only FAILs remain" (→ READY_FOR_DEVELOPER, Developer must rework first).
  const wpsNeedingNewQa = wpsWithImpl.filter(
    (wp) =>
      wp.status !== 'BLOCKED' &&
      !wp.pipelines.some((p) => p.type === 'qa')
  );
  const wpsWithQaInProgress = wpsWithImpl.filter(
    (wp) =>
      wp.status !== 'BLOCKED' &&
      wp.pipelines.some((p) => p.type === 'qa' && p.status === 'IN_PROGRESS')
  );
  const wpsWithQaFail = wpsWithImpl.filter(
    (wp) =>
      wp.status !== 'BLOCKED' &&
      isMostRecentPipelineFail(wp.pipelines, 'qa')
  );

  if (wpsNeedingNewQa.length > 0 || wpsWithQaInProgress.length > 0) {
    // QA agent still has actionable work (new QA or in-progress QA)
    const wpsNeedingWork = [...wpsNeedingNewQa, ...wpsWithQaInProgress];

    return buildHandoffResponse(
      'QA',
      'IN_PROGRESS',
      `QA work in progress. ${wpsNeedingWork.length} work package(s) still need QA.`,
      `Call ledger_get_next_action with agent_role: "QA" to find the next work package to validate. Continue working until all WPs have PASS qa pipelines.`,
      projectPath,
      store
    );
  }

  if (wpsWithQaFail.length > 0) {
    // All QA work is done but some FAILed — Developer must rework before QA can retry
    return buildHandoffResponse(
      'QA',
      'READY_FOR_DEVELOPER',
      `QA complete but ${wpsWithQaFail.length} work package(s) have FAIL QA pipelines: ${wpsWithQaFail.map((wp) => wp.work_package_id).join(', ')}. Developer must rework before QA can retry.`,
      undefined,
      projectPath,
      store
    );
  }

  // All implemented WPs have QA but some WPs still need implementation
  if (wpsStillNeedingImpl.length > 0) {
    // Check if these WPs are actually ready or blocked by dependencies
    const readyWps = wpsStillNeedingImpl.filter(
      (wp) => !isBlockedByDependencies(wp)
    );
    const blockedWps = wpsStillNeedingImpl.filter((wp) =>
      isBlockedByDependencies(wp)
    );

    // If all unimplemented WPs are blocked, proceed to Review instead of waiting
    if (readyWps.length === 0 && blockedWps.length > 0) {
      return buildHandoffResponse(
        'QA',
        'READY_FOR_REVIEW',
        `QA complete for all implemented work packages. ${blockedWps.length} work package(s) blocked by dependencies: ${blockedWps.map((wp) => wp.work_package_id).join(', ')}. Proceed to Review to complete current WPs.`,
        undefined,
        projectPath,
        store
      );
    }

    // Some WPs are ready for implementation
    return buildHandoffResponse(
      'QA',
      'READY_FOR_DEVELOPER',
      `QA complete for all implemented work packages. ${readyWps.length} work package(s) ready for implementation: ${readyWps.map((wp) => wp.work_package_id).join(', ')}${blockedWps.length > 0 ? `. ${blockedWps.length} blocked by dependencies.` : ''}`,
      undefined,
      projectPath,
      store
    );
  }

  return buildHandoffResponse(
    'QA',
    'READY_FOR_REVIEW',
    'QA complete.',
    undefined,
    projectPath,
    store
  );
}

/**
 * Get handoff status for Security Auditor (§5.2b)
 *
 * Structurally identical to QA handoff, applied to security-audit pipelines.
 * Only active for WPs that include "security-audit" in active stages.
 */
export async function getSecurityAuditorHandoff(wpDetails: WorkPackageDetail[], projectPath?: string, store?: LedgerStore) {
  // Filter only WPs that include security-audit
  const auditWps = wpDetails.filter((wp) =>
    (wp.active_pipeline_stages as PipelineType[] | undefined ?? DEFAULT_PIPELINE_STAGES).includes('security-audit')
  );

  if (auditWps.length > 0 && auditWps.every((wp) => isTerminalStatus(wp.status))) {
    return buildHandoffResponse(
      'Security Auditor',
      'READY_FOR_SYNTHESIS',
      'All security audit work packages are in a terminal state.',
      undefined,
      projectPath,
      store
    );
  }

  // Step 1: Re-engagement check
  for (const wp of auditWps) {
    if (
      !isTerminalStatus(wp.status) &&
      !isBlockedByDependencies(wp) &&
      isMostRecentPipelineFail(wp.pipelines, 'security-audit') &&
      hasNewUpstreamPassSince(wp.pipelines, 'qa', 'security-audit')
    ) {
      return buildHandoffResponse(
        'Security Auditor',
        'IN_PROGRESS',
        `Security re-engagement required: ${wp.work_package_id} has a security-audit FAIL but QA has since re-passed. Auditor must re-evaluate.`,
        `Call ledger_get_next_action with agent_role: "Security Auditor" to find the work package to re-audit.`,
        projectPath,
        store
      );
    }
  }

  // FAIL conditions: if any FAIL and no re-engagement, route to Developer
  const failWps = auditWps.filter((wp) =>
    !isTerminalStatus(wp.status) &&
    !isBlockedByDependencies(wp) &&
    isMostRecentPipelineFail(wp.pipelines, 'security-audit')
  );
  if (failWps.length > 0) {
    return buildHandoffResponse(
      'Security Auditor',
      'READY_FOR_DEVELOPER',
      `Security audit complete but ${failWps.length} work package(s) have FAIL security-audit pipelines. Developer must fix issues.`,
      undefined,
      projectPath,
      store
    );
  }

  // PASS conditions: route to Reviewer (with dependency-blocked WAIT gate per spec)
  const passedAudit = auditWps.filter((wp) =>
    !isTerminalStatus(wp.status) &&
    wp.pipelines.some((p) => p.type === 'security-audit' && p.status === 'PASS') &&
    !wp.pipelines.some((p) => p.type === 'code-review')
  );

  if (passedAudit.length > 0) {
    const readyForReview = passedAudit.filter((wp) => !isBlockedByDependencies(wp));

    if (readyForReview.length === 0) {
      return buildHandoffResponse(
        'Security Auditor',
        'WAIT',
        `${passedAudit.length} work package(s) passed security audit but are blocked by dependencies.`,
        undefined,
        projectPath,
        store
      );
    }

    return buildHandoffResponse(
      'Security Auditor',
      'READY_FOR_REVIEW',
      `${readyForReview.length} work package(s) passed security audit and are ready for review.`,
      undefined,
      projectPath,
      store
    );
  }

  // In-progress audit work
  const inProgress = auditWps.filter((wp) =>
    !isTerminalStatus(wp.status) &&
    !isBlockedByDependencies(wp) &&
    (
      !wp.pipelines.some((p) => p.type === 'security-audit') ||
      wp.pipelines.some((p) => p.type === 'security-audit' && p.status === 'IN_PROGRESS')
    )
  );

  if (inProgress.length > 0) {
    return buildHandoffResponse(
      'Security Auditor',
      'IN_PROGRESS',
      `Security audit in progress. ${inProgress.length} work package(s) still need audit.`,
      `Call ledger_get_next_action with agent_role: "Security Auditor" to find the next work package to audit.`,
      projectPath,
      store
    );
  }

  return buildHandoffResponse(
    'Security Auditor',
    'WAIT',
    'Security audit complete or awaiting prerequisite stages.',
    undefined,
    projectPath,
    store
  );
}

/**
 * Get handoff status for Reviewer (§5.3)
 *
 * Structurally identical to QA handoff, applied to code-review pipelines.
 * Re-engagement step MUST precede the FAIL short-circuit.
 */
export async function getReviewerHandoff(wpDetails: WorkPackageDetail[], projectPath?: string, store?: LedgerStore) {
  // All-terminal early exit: if every WP is COMPLETE/CANCELLED the project is done.
  if (wpDetails.length > 0 && wpDetails.every((wp) => isTerminalStatus(wp.status))) {
    return buildHandoffResponse(
      'Reviewer',
      'READY_FOR_SYNTHESIS',
      'All work packages are in a terminal state.',
      undefined,
      projectPath,
      store
    );
  }

  // Step 1 of §5.3: Re-engagement check — MUST precede FAIL short-circuit.
  // If code-review FAIL exists AND the effective upstream has since re-PASSed, Reviewer must re-engage.
  for (const wp of wpDetails) {
    const reviewActiveStages: readonly PipelineType[] =
      (wp.active_pipeline_stages as PipelineType[] | undefined) ?? DEFAULT_PIPELINE_STAGES;
    const reviewUpstream = resolvePrerequisite('code-review', reviewActiveStages);
    if (
      !isTerminalStatus(wp.status) &&
      !isBlockedByDependencies(wp) &&
      isMostRecentPipelineFail(wp.pipelines, 'code-review') &&
      reviewUpstream !== null &&
      hasNewUpstreamPassSince(wp.pipelines, reviewUpstream, 'code-review')
    ) {
      return buildHandoffResponse(
        'Reviewer',
        'IN_PROGRESS',
        `Reviewer re-engagement required: ${wp.work_package_id} has a code-review FAIL but QA has since re-passed. Reviewer must re-evaluate.`,
        `Call ledger_get_next_action with agent_role: "Reviewer" to find the work package to re-review.`,
        projectPath,
        store
      );
    }
  }

  // Check if all WPs with QA pipelines have PASS code-review pipelines
  const wpsWithQa = wpDetails.filter((wp) =>
    wp.pipelines.some((p) => p.type === 'qa' && p.status === 'PASS')
  );

  const allReviewPassed = wpsWithQa.every((wp) =>
    wp.pipelines.some((p) => p.type === 'code-review' && p.status === 'PASS')
  );

  // Check if there are WPs that haven't reached QA yet
  const wpsNotYetQaPassed = wpDetails.filter(
    (wp) => !wp.pipelines.some((p) => p.type === 'qa' && p.status === 'PASS')
  );

  if (allReviewPassed && wpsWithQa.length > 0) {
    // If there are still WPs that haven't passed QA, check if they're blocked or ready
    if (wpsNotYetQaPassed.length > 0) {
      // Check if these WPs are actually ready or blocked by dependencies
      const readyWps = wpsNotYetQaPassed.filter(
        (wp) => !isBlockedByDependencies(wp)
      );
      const blockedWps = wpsNotYetQaPassed.filter((wp) =>
        isBlockedByDependencies(wp)
      );

      // If all unimplemented WPs are blocked, proceed to Documentation instead of waiting
      if (readyWps.length === 0 && blockedWps.length > 0) {
        return buildHandoffResponse(
          'Reviewer',
          'READY_FOR_DOCUMENTATION',
          `Review passed for ${wpsWithQa.length} work package(s). ${blockedWps.length} work package(s) blocked by dependencies: ${blockedWps.map((wp) => wp.work_package_id).join(', ')}. Proceed to Documentation to complete current WPs.`,
          undefined,
          projectPath,
          store
        );
      }

      // Some WPs are ready for implementation/QA
      return buildHandoffResponse(
        'Reviewer',
        'READY_FOR_DEVELOPER',
        `Review passed for ${wpsWithQa.length} work package(s). ${readyWps.length} work package(s) ready for implementation/QA: ${readyWps.map((wp) => wp.work_package_id).join(', ')}${blockedWps.length > 0 ? `. ${blockedWps.length} blocked by dependencies.` : ''}`,
        undefined,
        projectPath,
        store
      );
    }

    return buildHandoffResponse(
      'Reviewer',
      'READY_FOR_DOCUMENTATION',
      'All work packages have PASS code-review pipelines.',
      undefined,
      projectPath,
      store
    );
  }

  // Check if any non-BLOCKED WP needs review or has FAIL pipeline.
  // BLOCKED WPs need upstream rework before Reviewer can retry — exclude them.
  // Distinguish between "needs new review" / "review IN_PROGRESS" (→ IN_PROGRESS)
  // and "only FAILs remain" (→ READY_FOR_DEVELOPER, Developer must rework first).
  const wpsNeedingNewReview = wpsWithQa.filter(
    (wp) =>
      wp.status !== 'BLOCKED' &&
      !wp.pipelines.some((p) => p.type === 'code-review')
  );
  const wpsWithReviewInProgress = wpsWithQa.filter(
    (wp) =>
      wp.status !== 'BLOCKED' &&
      wp.pipelines.some((p) => p.type === 'code-review' && p.status === 'IN_PROGRESS')
  );
  const wpsWithReviewFail = wpsWithQa.filter(
    (wp) =>
      wp.status !== 'BLOCKED' &&
      isMostRecentPipelineFail(wp.pipelines, 'code-review')
  );

  if (wpsNeedingNewReview.length > 0 || wpsWithReviewInProgress.length > 0) {
    // Reviewer still has actionable work
    const wpsNeedingWork = [...wpsNeedingNewReview, ...wpsWithReviewInProgress];

    return buildHandoffResponse(
      'Reviewer',
      'IN_PROGRESS',
      `Review work in progress. ${wpsNeedingWork.length} work package(s) still need review.`,
      `Call ledger_get_next_action with agent_role: "Reviewer" to find the next work package to review. Continue working until all WPs have PASS code-review pipelines.`,
      projectPath,
      store
    );
  }

  if (wpsWithReviewFail.length > 0) {
    // All review work is done but some FAILed — Developer must rework before Reviewer can retry
    return buildHandoffResponse(
      'Reviewer',
      'READY_FOR_DEVELOPER',
      `Review complete but ${wpsWithReviewFail.length} work package(s) have FAIL code-review pipelines: ${wpsWithReviewFail.map((wp) => wp.work_package_id).join(', ')}. Developer must rework before Reviewer can retry.`,
      undefined,
      projectPath,
      store
    );
  }

  // All reviewed WPs are done but some haven't reached QA yet
  if (wpsNotYetQaPassed.length > 0) {
    // Check if these WPs are actually ready or blocked by dependencies
    const readyWps = wpsNotYetQaPassed.filter(
      (wp) => !isBlockedByDependencies(wp)
    );
    const blockedWps = wpsNotYetQaPassed.filter((wp) =>
      isBlockedByDependencies(wp)
    );

    // If all unimplemented WPs are blocked, proceed to Documentation instead of waiting
    if (readyWps.length === 0 && blockedWps.length > 0) {
      return buildHandoffResponse(
        'Reviewer',
        'READY_FOR_DOCUMENTATION',
        `Review complete for all QA-passed work packages. ${blockedWps.length} work package(s) blocked by dependencies: ${blockedWps.map((wp) => wp.work_package_id).join(', ')}. Proceed to Documentation to complete current WPs.`,
        undefined,
        projectPath,
        store
      );
    }

    // Some WPs are ready for earlier stages
    return buildHandoffResponse(
      'Reviewer',
      'READY_FOR_DEVELOPER',
      `Review complete for all QA-passed work packages. ${readyWps.length} work package(s) ready for earlier stages: ${readyWps.map((wp) => wp.work_package_id).join(', ')}${blockedWps.length > 0 ? `. ${blockedWps.length} blocked by dependencies.` : ''}`,
      undefined,
      projectPath,
      store
    );
  }

  return buildHandoffResponse(
    'Reviewer',
    'READY_FOR_DOCUMENTATION',
    'Code review complete.',
    undefined,
    projectPath,
    store
  );
}

/**
 * Get handoff status for Release Engineer (§5.2c)
 *
 * Self-rework on FAIL. Only active for WPs that include "release-engineering".
 */
export async function getReleaseEngineerHandoff(wpDetails: WorkPackageDetail[], projectPath?: string, store?: LedgerStore) {
  const releaseWps = wpDetails.filter((wp) =>
    (wp.active_pipeline_stages as PipelineType[] | undefined ?? DEFAULT_PIPELINE_STAGES).includes('release-engineering')
  );

  if (releaseWps.length > 0 && releaseWps.every((wp) => isTerminalStatus(wp.status))) {
    return buildHandoffResponse(
      'Release Engineer',
      'READY_FOR_SYNTHESIS',
      'All release engineering work packages are in a terminal state.',
      undefined,
      projectPath,
      store
    );
  }

  // Release engineering ready (PASS code-review, no release pipeline yet or new upstream pass)
  const readyWps = releaseWps.filter((wp) => {
    if (isTerminalStatus(wp.status) || isBlockedByDependencies(wp)) return false;
    const hasPassCR = wp.pipelines.some((p) => p.type === 'code-review' && p.status === 'PASS');
    const noReleaseYet = !wp.pipelines.some((p) => p.type === 'release-engineering');
    const newUpstream = hasNewUpstreamPassSince(wp.pipelines, 'code-review', 'release-engineering');
    return hasPassCR && (noReleaseYet || newUpstream);
  });

  if (readyWps.length > 0) {
    return buildHandoffResponse(
      'Release Engineer',
      'IN_PROGRESS',
      `Release engineering in progress. ${readyWps.length} work package(s) ready for release.`,
      `Call ledger_get_next_action with agent_role: "Release Engineer" to find the next work package to release.`,
      projectPath,
      store
    );
  }

  // FAIL conditions: self-rework
  const failWps = releaseWps.filter((wp) =>
    !isTerminalStatus(wp.status) &&
    !isBlockedByDependencies(wp) &&
    isMostRecentPipelineFail(wp.pipelines, 'release-engineering')
  );
  if (failWps.length > 0) {
    return buildHandoffResponse(
      'Release Engineer',
      'IN_PROGRESS',
      `Release rework required. ${failWps.length} work package(s) have FAIL release-engineering pipelines.`,
      `Call ledger_get_next_action with agent_role: "Release Engineer" to find the work package to rework.`,
      projectPath,
      store
    );
  }

  return buildHandoffResponse(
    'Release Engineer',
    'WAIT',
    'Release engineering complete or awaiting code review.',
    undefined,
    projectPath,
    store
  );
}

/**
 * Get handoff status for Documentation (§5.4)
 *
 * Priority order per §14.5: ready-for-docs (new work or re-engagement via
 * hasNewUpstreamPassSince) comes BEFORE FAIL self-rework. This is the opposite
 * of the recommendation engine priority and is intentional for handoff routing.
 */
export async function getDocumentationHandoff(wpDetails: WorkPackageDetail[], projectPath?: string, store?: LedgerStore) {
  const wpsWithReview = wpDetails.filter((wp) =>
    wp.pipelines.some((p) => p.type === 'code-review' && p.status === 'PASS')
  );

  const wpsNotYetReviewed = wpDetails.filter(
    (wp) => !wp.pipelines.some((p) => p.type === 'code-review' && p.status === 'PASS')
  );

  // Step 1 of §5.4: Ready-for-docs check — new documentation OR re-engagement.
  // Per §14.5: this step comes BEFORE FAIL self-rework in handoff priority.
  // Uses hasNewUpstreamPassSince to detect re-engagement: a new code-review PASS
  // after the most recent documentation run means docs must be re-run.
  const readyForDocsList = wpsWithReview.filter(
    (wp) =>
      !isTerminalStatus(wp.status) &&
      !isBlockedByDependencies(wp) &&
      (
        !wp.pipelines.some((p) => p.type === 'documentation') ||
        hasNewUpstreamPassSince(wp.pipelines, 'code-review', 'documentation')
      )
  );
  if (readyForDocsList.length > 0) {
    return buildHandoffResponse(
      'Documentation',
      'IN_PROGRESS',
      `Documentation work in progress. ${readyForDocsList.length} work package(s) need documentation or re-documentation after upstream changes.`,
      `Call ledger_get_next_action with agent_role: "Documentation" to find the next work package to document. Continue working until all WPs have PASS documentation pipelines and are marked COMPLETE.`,
      projectPath,
      store
    );
  }

  // Step 2 of §5.4: FAIL → Documentation self-rework.
  // Documentation self-corrects on FAIL rather than routing back upstream.
  const wpsWithDocFail = wpsWithReview.filter(
    (wp) =>
      !isTerminalStatus(wp.status) &&
      !isBlockedByDependencies(wp) &&
      isMostRecentPipelineFail(wp.pipelines, 'documentation')
  );
  if (wpsWithDocFail.length > 0) {
    return buildHandoffResponse(
      'Documentation',
      'IN_PROGRESS',
      `Documentation rework required. ${wpsWithDocFail.length} work package(s) have FAIL documentation pipelines and need rework.`,
      `Call ledger_get_next_action with agent_role: "Documentation" to find the next work package to document. Continue working until all WPs have PASS documentation pipelines and are marked COMPLETE.`,
      projectPath,
      store
    );
  }

  // Check if all reviewed WPs have PASS documentation
  const allDocsPassed = wpsWithReview.every((wp) =>
    wp.pipelines.some((p) => p.type === 'documentation' && p.status === 'PASS')
  );

  if (allDocsPassed && wpsWithReview.length > 0) {
    // If there are still WPs that haven't been reviewed, earlier stages need to catch up
    if (wpsNotYetReviewed.length > 0) {
      // Check if these WPs are actually blocked by dependencies (not genuinely waiting)
      const readyWps = wpsNotYetReviewed.filter(
        (wp) => !isBlockedByDependencies(wp)
      );
      const blockedWps = wpsNotYetReviewed.filter((wp) =>
        isBlockedByDependencies(wp)
      );

      // If all unreviewed WPs are blocked by dependencies, proceed to Synthesis
      if (readyWps.length === 0 && blockedWps.length > 0) {
        return buildHandoffResponse(
          'Documentation',
          'READY_FOR_SYNTHESIS',
          `Documentation passed for ${wpsWithReview.length} work package(s). ${blockedWps.length} work package(s) blocked by dependencies: ${blockedWps.map((wp) => wp.work_package_id).join(', ')}. Proceed to Synthesis to complete current WPs.`,
          undefined,
          projectPath,
          store
        );
      }

      return buildHandoffResponse(
        'Documentation',
        'READY_FOR_DEVELOPER',
        `Documentation passed for ${wpsWithReview.length} work package(s), but ${wpsNotYetReviewed.length} work package(s) still need earlier stages: ${wpsNotYetReviewed.map((wp) => wp.work_package_id).join(', ')}. Hand back to Developer.`,
        undefined,
        projectPath,
        store
      );
    }

    return buildHandoffResponse(
      'Documentation',
      'READY_FOR_SYNTHESIS',
      'All work packages have PASS documentation pipelines.',
      undefined,
      projectPath,
      store
    );
  }

  // All documented WPs are done but some haven't reached review yet
  if (wpsNotYetReviewed.length > 0) {
    // Check if these WPs are actually blocked by dependencies (not genuinely waiting)
    const readyWps = wpsNotYetReviewed.filter(
      (wp) => !isBlockedByDependencies(wp)
    );
    const blockedWps = wpsNotYetReviewed.filter((wp) =>
      isBlockedByDependencies(wp)
    );

    // If all unreviewed WPs are blocked by dependencies, proceed to Synthesis
    if (readyWps.length === 0 && blockedWps.length > 0) {
      return buildHandoffResponse(
        'Documentation',
        'READY_FOR_SYNTHESIS',
        `Documentation complete for all reviewed work packages. ${blockedWps.length} work package(s) blocked by dependencies: ${blockedWps.map((wp) => wp.work_package_id).join(', ')}. Proceed to Synthesis to complete current WPs.`,
        undefined,
        projectPath,
        store
      );
    }

    return buildHandoffResponse(
      'Documentation',
      'READY_FOR_DEVELOPER',
      `Documentation complete for all reviewed work packages. ${wpsNotYetReviewed.length} work package(s) still need earlier stages: ${wpsNotYetReviewed.map((wp) => wp.work_package_id).join(', ')}. Hand back to Developer.`,
      undefined,
      projectPath,
      store
    );
  }

  return buildHandoffResponse(
    'Documentation',
    'READY_FOR_SYNTHESIS',
    'Documentation complete.',
    undefined,
    projectPath,
    store
  );
}

/**
 * Compute the handoff status payload without wrapping in an MCP response.
 *
 * Shared utility called by workflow-next-action.ts to embed `handoff_status`
 * directly in `WAIT` responses, eliminating the need for a separate
 * `ledger_get_handoff_status` call by Developer, QA, and Reviewer agents.
 *
 * When `opts.store`, `opts.rootIndex`, and `opts.wpDetails` are ALL provided, the
 * function bypasses `getHandoffStatus()` entirely — dispatching directly to the
 * per-role handoff function with the pre-loaded data. This eliminates the redundant
 * LedgerStore construction and disk reads that would otherwise occur on every
 * WAIT response in the next-action flow.
 *
 * When any of the three opts fields is absent (or opts is omitted), the function
 * falls back to calling `getHandoffStatus()` as before — preserving compatibility
 * with the standalone `ledger_get_handoff_status` tool call path.
 *
 * @throws {Error} if handoff status computation fails (invalid path, project not found, etc.)
 */
export async function computeHandoffStatus(
  projectPath: string,
  agentRole: string,
  opts?: { store?: LedgerStore; rootIndex?: RootIndex; wpDetails?: WorkPackageDetail[] },
): Promise<Record<string, unknown>> {
  // Fast path: all three pre-loaded values available — bypass getHandoffStatus()
  if (opts?.store && opts?.rootIndex && opts?.wpDetails) {
    const { store: s, rootIndex, wpDetails } = opts;
    let mcpResult: { content: Array<{ type: string; text: string }> };

    // Replicate the global BLOCKED short-circuit from getHandoffStatus
    const blockedWps = rootIndex.work_packages.filter((wp) => wp.status === 'BLOCKED');
    const readyOrInProgressWps = rootIndex.work_packages.filter(
      (wp) => wp.status === 'READY' || wp.status === 'IN_PROGRESS'
    );
    if (blockedWps.length > 0 && readyOrInProgressWps.length === 0) {
      mcpResult = await buildHandoffResponse(
        agentRole,
        'BLOCKED',
        `All work packages are BLOCKED: ${blockedWps.map((wp) => wp.work_package_id).join(', ')}. Resolution required before proceeding.`,
        undefined,
        projectPath,
        s
      );
    } else {
      // Dispatch via manifest-typed map (same map used by getHandoffStatus)
      const handler = HANDOFF_DISPATCH[agentRole as AgentRole];
      if (handler) {
        mcpResult = await handler(wpDetails, projectPath, s);
      } else {
        mcpResult = await buildHandoffResponse(agentRole, 'IN_PROGRESS', 'Work in progress.', undefined, projectPath, s);
      }
    }

    if ('isError' in mcpResult && (mcpResult as { isError?: boolean }).isError) {
      const errText = (mcpResult.content as Array<{ text: string }>)[0]?.text ?? 'Handoff status computation failed';
      throw new Error(errText);
    }
    const fastText = (mcpResult.content as Array<{ type: string; text: string }>)[0]?.text ?? '{}';
    return JSON.parse(fastText) as Record<string, unknown>;
  }

  // Fallback: original path — constructs a fresh LedgerStore via getHandoffStatus()
  const mcpResult = await getHandoffStatus({ project_path: projectPath, current_agent: agentRole });
  if ('isError' in mcpResult && mcpResult.isError) {
    const errText = (mcpResult.content as Array<{ text: string }>)[0]?.text ?? 'Handoff status computation failed';
    throw new Error(errText);
  }
  const text = (mcpResult.content as Array<{ type: string; text: string }>)[0]?.text ?? '{}';
  return JSON.parse(text) as Record<string, unknown>;
}


/**
 * Register the ledger_get_handoff_status tool on the MCP server.
 */
export function register(server: McpServer): void {
  server.registerTool(
    'ledger_get_handoff_status',
    {
      description: 'Get the handoff status to determine if your work is done and which agent should work next. REQUIRED params: current_agent. Call this after completing your pipelines to check if work should be handed to the next agent in the workflow. Use cwd_path (workspace root) for auto-detection, or project_path if already known.',
      inputSchema: GetHandoffStatusSchema,
    },
    getHandoffStatus as any
  );
}

```
###  Path: `/mcp-server/src/tools/workflow-next-action-batch.ts`

```ts
/**
 * Batch/collector logic and WAIT-embedding utility for ledger_get_next_action.
 *
 * Extracted from workflow-next-action.ts to keep the main file focused on
 * per-role single-action logic. This module owns:
 *   - embedHandoffStatusInWait  — embeds handoff_status into WAIT responses
 *   - buildBatchNextSteps       — builds next_steps arrays for batch responses
 *   - getNextActionsCollector   — collects up to N actions for a given agent role
 */

import { LedgerStore } from '../storage/ledger-store.js';
import type { RootIndex } from '../schema/root-index.js';
import type { WorkPackageDetail } from '../schema/work-package.js';
import { type AgentRole } from '../utils/constants.js';
import {
  AGENT_PIPELINE_MAP,
  PIPELINE_PREREQUISITES,
  type PostImplPipelineType,
} from '../utils/pipeline-maps.js';
import { parseTimestamp } from '../utils/timestamp.js';
import {
  isMostRecentPipelineFail,
  hasDependencyBlocked,
  getHandoffNotesForAgent,
  isStalePipeline,
  agentNameMap,
  actionNameMap,
  reworkActionMap,
} from '../utils/workflow-helpers.js';
import { PIPELINE_AGENT_MAP } from '../utils/pipeline-maps.js';
import { computeHandoffStatus } from './workflow-handoff.js';

/**
 * Post-processes a single-action MCP result: if payload.action === "WAIT",
 * computes handoff_status via computeHandoffStatus and embeds it as a top-level key.
 * Non-WAIT responses and empty projectPath values are returned unchanged.
 * On handoff computation failure, embeds handoff_status_error instead.
 *
 * When `opts.store`, `opts.rootIndex`, and `opts.wpDetails` are all provided, they
 * are forwarded to `computeHandoffStatus` to avoid redundant disk reads — the handoff
 * computation reuses the already-loaded data instead of creating a new LedgerStore.
 * @internal — exposed via _internal for unit tests
 */
export async function embedHandoffStatusInWait(
  mcpResult: { content: Array<{ type: string; text: string }> },
  projectPath: string,
  agentRole: string,
  opts?: { store?: LedgerStore; rootIndex?: RootIndex; wpDetails?: WorkPackageDetail[] },
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const text = mcpResult.content[0]?.text;
  if (!text || !projectPath) return mcpResult;

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return mcpResult;
  }

  if (payload['action'] !== 'WAIT') return mcpResult;

  try {
    payload['handoff_status'] = await computeHandoffStatus(projectPath, agentRole, opts);
  } catch (err) {
    payload['handoff_status_error'] = (err as Error).message;
  }

  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
  };
}

/**
 * Build `next_steps` guidance for a batch action entry.
 * Mirrors the step-by-step tool-call instructions from getNextAction's singular helpers,
 * but in compact array form suitable for batch responses.
 * @internal — exported for unit tests only (via _internal)
 */
export function buildBatchNextSteps(
  action: string,
  wpId: string,
  pipelineType: string,
  wpStatus?: string,
  failedPipelineType?: string,
): string[] {
  const agentRole = PIPELINE_AGENT_MAP[pipelineType as keyof typeof PIPELINE_AGENT_MAP] ?? pipelineType;

  switch (action) {
    case 'IMPLEMENT': {
      return [
        `1. Call ledger_begin_work (work_package_id: "${wpId}", type: "implementation", agent_role: "Developer")${wpStatus === 'READY' ? ' to claim and start the pipeline in one step' : ' \u2014 WP is already IN_PROGRESS, starts pipeline directly'}.`,
        '2. Read the WP spec, implement the changes, run tests.',
        `3. Call ledger_complete_pipeline (work_package_id: "${wpId}", type: "implementation", status: PASS/FAIL, summary, artifacts, comments, acceptance_criteria_updates).`,
        `4. Call ledger_get_handoff_status (current_agent: "Developer").`,
      ];
    }
    case 'REWORK': {
      // Developer rework: failedPipelineType identifies which downstream pipeline failed
      if (failedPipelineType && failedPipelineType !== 'implementation') {
        return [
          `1. Call ledger_get_work_package to review the FAIL ${failedPipelineType} pipeline comments/summary.`,
          `2. Call ledger_begin_work (work_package_id: "${wpId}", type: "implementation", agent_role: "Developer").`,
          '3. Fix the issues identified by the failed pipeline, run tests.',
          `4. Call ledger_complete_pipeline (work_package_id: "${wpId}", type: "implementation", status: PASS/FAIL, summary, artifacts, comments, acceptance_criteria_updates).`,
          `5. Call ledger_get_handoff_status (current_agent: "Developer").`,
        ];
      }
      // Documentation self-rework or Developer implementation rework
      if (pipelineType === 'documentation') {
        return [
          `1. Call ledger_get_work_package to review the previous FAIL documentation pipeline summary and comments.`,
          `2. Call ledger_begin_work (work_package_id: "${wpId}", type: "documentation", agent_role: "Documentation").`,
          '3. Fix documentation issues, update affected files.',
          `4. Call ledger_complete_pipeline (work_package_id: "${wpId}", type: "documentation", status: PASS/FAIL, summary, comments, acceptance_criteria_updates).`,
          `5. Call ledger_update_work_package_status (work_package_id: "${wpId}", status: "COMPLETE", agent: "Documentation").`,
          `6. Call ledger_get_handoff_status (current_agent: "Documentation").`,
        ];
      }
      return [
        `1. Call ledger_begin_work (work_package_id: "${wpId}", type: "implementation", agent_role: "Developer") \u2014 WP is already IN_PROGRESS, starts pipeline directly.`,
        '2. Review the previous FAIL pipeline summary, fix the issues, run tests.',
        `3. Call ledger_complete_pipeline (work_package_id: "${wpId}", type: "implementation", status: PASS/FAIL, summary, artifacts, comments, acceptance_criteria_updates).`,
        `4. Call ledger_get_handoff_status (current_agent: "Developer").`,
      ];
    }
    case 'RUN_QA':
    case 'RUN_REVIEW':
    case 'WRITE_DOCS': {
      const steps = [
        `1. Call ledger_begin_work (work_package_id: "${wpId}", type: "${pipelineType}", agent_role: "${agentRole}").`,
        `2. Call ledger_get_work_package to review prior pipeline artifacts.`,
        `3. Perform your ${pipelineType} work.`,
        `4. Call ledger_complete_pipeline (work_package_id: "${wpId}", type: "${pipelineType}", status: PASS/FAIL, summary, comments, acceptance_criteria_updates).`,
      ];
      if (pipelineType === 'documentation') {
        steps.push(`5. Call ledger_update_work_package_status (work_package_id: "${wpId}", status: "COMPLETE", agent: "Documentation").`);
        steps.push(`6. Call ledger_get_handoff_status (current_agent: "${agentRole}").`);
      } else {
        steps.push(`5. Call ledger_get_handoff_status (current_agent: "${agentRole}").`);
      }
      return steps;
    }
    case 'WAIT_FOR_REWORK':
      return [
        `WP ${wpId}: Waiting for Developer to rework implementation. QA/Reviewer does not self-rework.`,
        `Check ledger_get_next_action for Developer to confirm rework has started.`,
      ];
    case 'WAIT_FOR_DOWNSTREAM':
      return [
        `WP ${wpId}: Implementation pipeline PASS. Waiting for downstream QA/Reviewer pipeline to complete.`,
        `No action required — hand off to QA agent.`,
      ];
    case 'BLOCK_FOR_REWORK_LIMIT':
      return [
        `1. Call ledger_get_work_package (work_package_id: "${wpId}") to review the rework history.`,
        `2. Escalate to the Project Manager to resolve the rework-limit blocker.`,
        `3. Consider calling ledger_update_work_package_status (work_package_id: "${wpId}", status: "CANCELLED") and creating a replacement WP.`,
      ];
    case 'WAIT_FOR_UPSTREAM_REWORK_LIMIT':
      return [
        `WP ${wpId}: An upstream pipeline has reached the rework limit. Waiting for PM to resolve the blocker.`,
        `No action required — PM must intervene before this pipeline can proceed.`,
      ];
    case 'UNBLOCK_WP':
      return [
        `1. Call ledger_get_work_package (work_package_id: "${wpId}") to review the blocked state.`,
        `2. Resolve the blocking condition (dependency, decision, or external factor).`,
        `3. Call ledger_update_work_package_status (work_package_id: "${wpId}", status: "READY") to unblock.`,
      ];
    case 'REVIEW_ABANDONED':
      return [
        `1. Call ledger_get_work_package (work_package_id: "${wpId}") to review the abandoned pipeline.`,
        `2. Cancel the abandoned pipeline or escalate to PM.`,
        `3. Create a replacement WP if the work is still needed.`,
      ];
    case 'REPAIR_ORPHAN_BLOCKED':
      return [
        `1. Call ledger_get_work_package (work_package_id: "${wpId}") to inspect the orphan-BLOCKED state.`,
        `2. Verify all dependency WPs are COMPLETE.`,
        `3. Call ledger_update_work_package_status (work_package_id: "${wpId}", status: "READY") to repair.`,
      ];
    case 'FINALIZE_WP':
      return [
        `1. Call ledger_update_work_package_status (work_package_id: "${wpId}", status: "COMPLETE", agent: "Documentation").`,
        `2. Call ledger_get_handoff_status (current_agent: "Documentation").`,
      ];
    case 'UPDATE_CRITERIA':
      return [
        `1. Call ledger_complete_pipeline (work_package_id: "${wpId}", type: "documentation", ..., acceptance_criteria_updates: [...]) to mark all criteria as met.`,
        `2. Then call ledger_update_work_package_status (work_package_id: "${wpId}", status: "COMPLETE", agent: "Documentation").`,
        `3. Call ledger_get_handoff_status (current_agent: "Documentation").`,
      ];
    case 'CLAIM_WP':
      return [
        `1. Call ledger_begin_work (work_package_id: "${wpId}", type: "${pipelineType}", agent_role: "${agentRole}").`,
        `2. Perform your pipeline work.`,
        `3. Call ledger_complete_pipeline (work_package_id: "${wpId}", type: "${pipelineType}", status: PASS/FAIL, summary, comments, acceptance_criteria_updates).`,
      ];
    default:
      return [];
  }
}

/**
 * Collect up to `limit` actionable items for an agent role.
 * Uses the same per-WP evaluation logic as the singular getXxxAction helpers,
 * but without the early-return pattern — results are collected into an array.
 * Only used when max_results > 1 is passed to ledger_get_next_action.
 */
export async function getNextActionsCollector(
  rootIndex: RootIndex,
  store: LedgerStore,
  agentRole: AgentRole,
  limit: number
): Promise<{ content: [{ type: 'text'; text: string }] }> {
  const pipelineType = AGENT_PIPELINE_MAP[agentRole];
  if (!pipelineType) {
    // Planner, Synthesis, Project Manager — batch not meaningful
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            { actions: [], reason: `Batch actions not applicable for role: ${agentRole}` },
            null,
            2
          ),
        },
      ],
    };
  }

  const actions: object[] = [];
  // Prerequisite type for this agent's pipeline
  const prerequisite = PIPELINE_PREREQUISITES[pipelineType];

  for (const wp of rootIndex.work_packages) {
    if (actions.length >= limit) break;

    const wpDetail = await store.readWorkPackage(wp.work_package_id);

    // Skip stale pipelines (RESUME_OR_CANCEL handling)
    const stale = wpDetail.pipelines.find((p) => p.type === pipelineType && isStalePipeline(p));
    if (stale) {
      const ageHours = stale.started_at
        ? Math.floor((Date.now() - parseTimestamp(stale.started_at).getTime()) / (1000 * 60 * 60))
        : -1;
      actions.push({
        action: 'RESUME_OR_CANCEL',
        work_package_id: wpDetail.work_package_id,
        pipeline_type: pipelineType,
        started_at: stale.started_at ?? 'unknown',
        age_hours: ageHours,
        reason: `Work package ${wpDetail.work_package_id} has a stale '${pipelineType}' pipeline (~${ageHours}h). Resume or cancel.`,
      });
      continue;
    }

    // For implementation: look for READY/IN_PROGRESS WPs with no implementation pipeline yet
    if (pipelineType === 'implementation') {
      if (
        (wpDetail.status === 'READY' || wpDetail.status === 'IN_PROGRESS') &&
        !hasDependencyBlocked(wpDetail) &&
        !wpDetail.pipelines.some((p) => p.type === 'implementation')
      ) {
        const handoffNotes = wpDetail.assigned_to === 'Developer'
          ? (getHandoffNotesForAgent(wpDetail, 'Developer') ?? undefined)
          : undefined;
        actions.push({
          action: 'IMPLEMENT',
          work_package_id: wpDetail.work_package_id,
          reason: `Work package ${wpDetail.work_package_id} is ${wpDetail.status} with no implementation pipeline.`,
          next_steps: buildBatchNextSteps('IMPLEMENT', wpDetail.work_package_id, 'implementation', wpDetail.status),
          ...(handoffNotes ? { handoff_notes: handoffNotes } : {}),
        });
        continue;
      }
      // Rework: FAIL implementation pipeline
      if (isMostRecentPipelineFail(wpDetail.pipelines, 'implementation')) {
        actions.push({
          action: 'REWORK',
          work_package_id: wpDetail.work_package_id,
          reason: `Work package ${wpDetail.work_package_id} has a FAIL implementation pipeline.`,
          next_steps: buildBatchNextSteps('REWORK', wpDetail.work_package_id, 'implementation'),
        });
        continue;
      }
      // Rework: downstream pipeline (QA or code-review) failed — Developer must fix
      const hasPassImpl = wpDetail.pipelines.some(
        (p) => p.type === 'implementation' && p.status === 'PASS'
      );
      if (hasPassImpl) {
        for (const downstreamType of ['qa', 'code-review'] as const) {
          if (isMostRecentPipelineFail(wpDetail.pipelines, downstreamType)) {
            const handoffNotes = getHandoffNotesForAgent(wpDetail, 'Developer');
            actions.push({
              action: 'REWORK',
              work_package_id: wpDetail.work_package_id,
              reason: `Work package ${wpDetail.work_package_id} has a FAIL ${downstreamType} pipeline. Developer rework needed.`,
              pipeline_that_failed: downstreamType,
              next_steps: buildBatchNextSteps('REWORK', wpDetail.work_package_id, 'implementation', undefined, downstreamType),
              ...(handoffNotes ? { handoff_notes: handoffNotes } : {}),
            });
            break;
          }
        }
      }
      continue;
    }

    // For qa / code-review / documentation: check prerequisite PASS and no own pipeline yet
    const hasPassPrerequisite =
      prerequisite === null ||
      wpDetail.pipelines.some((p) => p.type === prerequisite && p.status === 'PASS');
    const hasPipelineAlready = wpDetail.pipelines.some((p) => p.type === pipelineType);

    if (hasPassPrerequisite && !hasPipelineAlready) {
      const actionName = actionNameMap[pipelineType as PostImplPipelineType];
      const handoffNotes = getHandoffNotesForAgent(wpDetail, agentNameMap[pipelineType as PostImplPipelineType]);
      actions.push({
        action: actionName,
        work_package_id: wpDetail.work_package_id,
        reason: `Work package ${wpDetail.work_package_id} is ready for ${pipelineType}.`,
        next_steps: buildBatchNextSteps(actionName, wpDetail.work_package_id, pipelineType),
        ...(handoffNotes ? { handoff_notes: handoffNotes } : {}),
      });
      continue;
    }

    // BLOCKED WPs: skip rework suggestion to avoid infinite-loop signals.
    // QA/Reviewer do NOT self-rework (WAIT) — only Documentation self-reworks.
    if (wpDetail.status !== 'BLOCKED' && isMostRecentPipelineFail(wpDetail.pipelines, pipelineType)) {
      const reworkAction = reworkActionMap[pipelineType as PostImplPipelineType];
      if (reworkAction === 'WAIT') {
        // QA/Reviewer: Developer must rework first — skip this WP in batch output
        continue;
      }
      actions.push({
        action: reworkAction,
        work_package_id: wpDetail.work_package_id,
        reason: `Work package ${wpDetail.work_package_id} has a FAIL ${pipelineType} pipeline.`,
        next_steps: buildBatchNextSteps(reworkAction, wpDetail.work_package_id, pipelineType),
      });
    }
  }

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({ actions, total: actions.length }, null, 2),
      },
    ],
  };
}

```
###  Path: `/mcp-server/src/tools/workflow-next-action.ts`

```ts
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { LedgerStore } from '../storage/ledger-store.js';
import type { RootIndex } from '../schema/root-index.js';
import type { WorkPackageDetail } from '../schema/work-package.js';
import { resolveProjectPath } from '../utils/path-validator.js';
import { isTerminalStatus, canStartWorkPackage } from '../schema/validators.js';
import { AGENT_ROLES, type AgentRole } from '../utils/constants.js';
import {
  PIPELINE_TYPES,
  type PipelineType,
  resolvePrerequisite,
  DEFAULT_PIPELINE_STAGES,
  getOrderedActiveStages,
  firstActiveStage,
} from '../utils/pipeline-maps.js';
import { parseTimestamp } from '../utils/timestamp.js';
import {
  extractStalePipelineAction,
  isMostRecentPipelineFail,
  hasDependencyBlocked,
  hasDownstreamFail,
  hasDownstreamReengagedSince,
  isActivePipeline,
  getHandoffNotesForAgent,
  hasNewUpstreamPassSince,
  makeReEngagementCheck,
  mostRecentEffectivePipeline,
  MAX_REWORK_COUNT,
  STALE_PIPELINE_HOURS,
} from '../utils/workflow-helpers.js';
import { embedHandoffStatusInWait, buildBatchNextSteps, getNextActionsCollector } from './workflow-next-action-batch.js';

/** Handler signature for per-role next-action functions. */
type NextActionHandler = (
  rootIndex: RootIndex,
  store: LedgerStore,
  wpDetails: WorkPackageDetail[],
) => Promise<{ content: Array<{ type: string; text: string }> }>;

/**
 * Manifest-typed dispatch map from agent role → next-action handler.
 *
 * Keyed by `AgentRole` (derived from the shared workflow manifest) so that
 * TypeScript flags any mismatch when a role is added, removed, or renamed.
 * Planner and the default case are handled before dispatch.
 */
const NEXT_ACTION_DISPATCH: Partial<Record<AgentRole, NextActionHandler>> = {
  'Project Manager':  (r, s, w) => getProjectManagerAction(r, s, w),
  'Developer':        (r, s, w) => getDeveloperAction(r, s, w),
  'QA':               (r, s, w) => getQaAction(r, s, w),
  'Security Auditor': (r, s, w) => getSecurityAuditorAction(r, s, w),
  'Reviewer':         (r, s, w) => getReviewerAction(r, s, w),
  'Release Engineer': (r, s, w) => getReleaseEngineerAction(r, s, w),
  'Documentation':    (r, s, w) => getDocumentationAction(r, s, w),
  'Synthesis':        () => Promise.resolve(getSynthesisAction()),
};
/**
 * Tool: get_next_action
 *
 * Reads root index and WP detail files to recommend the next action for an agent.
 * Returns actionable recommendations based on work package statuses and pipeline states.
 */
const GetNextActionSchema = z.object({
  project_path: z.string().optional().describe('Plan folder path — use only if you already have it from a previous tool response. Otherwise prefer cwd_path.'),
  cwd_path: z.string().optional().describe('Your workspace root directory — preferred. The server auto-detects the active project.'),
  agent_role: z
    .string()
    .describe(
      'REQUIRED. Your agent role, exactly one of: "Planner", "Project Manager", "Developer", "QA", "Security Auditor", "Reviewer", "Release Engineer", "Documentation", "Synthesis"'
    ),
  max_results: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Maximum number of actionable WPs to return (default: 1). When > 1, returns up to this many actions as an array under the "actions" key instead of a single action object. Useful for projects with many independent WPs.'),
});

async function getNextAction(args: z.infer<typeof GetNextActionSchema>) {
  let projectPath: string;
  try {
    projectPath = await resolveProjectPath(args);
  } catch (err) {
    return { content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }], isError: true };
  }

  const store = new LedgerStore(projectPath);

  try {
    // Validate agent role
    if (!AGENT_ROLES.includes(args.agent_role as AgentRole)) {
      throw new Error(
        `Unknown agent role: ${args.agent_role}. Valid roles are: ${AGENT_ROLES.join(', ')}`
      );
    }

    // Read root index
    const rootIndex = await store.readRootIndex();

    // Load all WP details once — reused by per-role action functions and the
    // handoff status bypass in embedHandoffStatusInWait (avoids duplicate reads).
    // Safe for zero-WP projects: Promise.all([]) resolves to [].
    const wpDetails = await Promise.all(
      rootIndex.work_packages.map((wp) => store.readWorkPackage(wp.work_package_id))
    );

    // If project has no work packages yet, recommend based on agent role
    if (rootIndex.work_packages.length === 0) {
      if (args.agent_role === 'Project Manager') {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  action: 'CREATE_WORK_PACKAGES',
                  reason:
                    'Project ledger exists but has no work packages. PM should decompose the plan into work packages.',
                },
                null,
                2
              ),
            },
          ],
        };
      } else {
        return await embedHandoffStatusInWait(
          {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(
                  {
                    action: 'WAIT',
                    reason: `No work packages exist yet. Wait for Project Manager to create work packages.`,
                  },
                  null,
                  2
                ),
              },
            ],
          },
          projectPath,
          args.agent_role,
          { store, rootIndex, wpDetails }
        );
      }
    }

    // Check if all work packages are terminal (COMPLETE or CANCELLED)
    const allComplete = rootIndex.work_packages.every(
      (wp) => isTerminalStatus(wp.status)
    );

    if (allComplete) {
      if (args.agent_role === 'Synthesis') {
        // Only offer GENERATE_SYNTHESIS once — guard with synthesis_generated flag
        if (rootIndex.synthesis_generated) {
          return await embedHandoffStatusInWait(
            {
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify(
                    {
                      action: 'WAIT',
                      reason: 'Synthesis report has already been generated. Nothing to do.',
                    },
                    null,
                    2
                  ),
                },
              ],
            },
            projectPath,
            args.agent_role,
            { store, rootIndex, wpDetails }
          );
        }
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  action: 'GENERATE_SYNTHESIS',
                  reason:
                    'All work packages are COMPLETE. Generate synthesis report.',
                },
                null,
                2
              ),
            },
          ],
        };
      } else if (args.agent_role === 'Project Manager') {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  action: 'SIGNAL_SYNTHESIS',
                  reason:
                    'All work packages are COMPLETE. Signal for Synthesis agent.',
                },
                null,
                2
              ),
            },
          ],
        };
      } else {
        return await embedHandoffStatusInWait(
          {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(
                  {
                    action: 'WAIT',
                    reason: 'All work packages are COMPLETE. Project is ready for Synthesis agent.',
                  },
                  null,
                  2
                ),
              },
            ],
          },
          projectPath,
          args.agent_role,
          { store, rootIndex, wpDetails }
        );
      }
    }

    // If max_results > 1, use batch collector mode
    if (args.max_results !== undefined && args.max_results > 1) {
      return getNextActionsCollector(rootIndex, store, args.agent_role as AgentRole, args.max_results);
    }

    // Agent-specific logic (dispatch map is typed by AgentRole from the manifest)
    const actionHandler = NEXT_ACTION_DISPATCH[args.agent_role as AgentRole];
    if (actionHandler) {
      return await embedHandoffStatusInWait(
        await actionHandler(rootIndex, store, wpDetails),
        projectPath,
        args.agent_role,
        { store, rootIndex, wpDetails }
      );
    }
    return await embedHandoffStatusInWait(
      {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                action: 'WAIT',
                reason: `No action available for agent role: ${args.agent_role}`,
              },
              null,
              2
            ),
          },
        ],
      },
      projectPath,
      args.agent_role,
      { store, rootIndex, wpDetails }
    );
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error: ${(error as Error).message}`,
        },
      ],
      isError: true,
    };
  }
}

/**
 * Get next action for Synthesis agent when project is still in progress.
 */
function getSynthesisAction() {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          {
            action: 'WAIT',
            reason: 'Not all work packages are COMPLETE. Wait for all WPs to finish.',
          },
          null,
          2
        ),
      },
    ],
  };
}

/**
 * Get next action for Project Manager.
 * Implements the 5-priority algorithm from §14.1.2.
 */
export async function getProjectManagerAction(
  rootIndex: RootIndex,
  store: LedgerStore,
  preloadedWpDetails?: WorkPackageDetail[]
) {
  // Load all WP details (needed for pipeline and rework state checks; skip if pre-loaded by caller)
  const wpDetails = preloadedWpDetails ?? await Promise.all(
    rootIndex.work_packages.map((wp) => store.readWorkPackage(wp.work_package_id))
  );

  // --- Priority 1: UNBLOCK_WP ---
  // BLOCKED WPs with non-dependency blockers requiring human/PM intervention
  for (const wpDetail of wpDetails) {
    if (wpDetail.status === 'BLOCKED') {
      const blockerType = wpDetail.blocked_by?.type;
      if (blockerType === 'decision' || blockerType === 'external' || blockerType === 'technical') {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              action: 'UNBLOCK_WP',
              work_package_id: wpDetail.work_package_id,
              reason: `Work package ${wpDetail.work_package_id} is BLOCKED by a ${blockerType} blocker. Investigate and resolve.`,
            }, null, 2),
          }],
        };
      }
    }
  }

  // --- Priority 2: REVIEW_REWORK_LIMIT ---
  // IN_PROGRESS WPs where any rework_counts entry >= MAX_REWORK_COUNT
  for (const wpDetail of wpDetails) {
    if (wpDetail.status === 'IN_PROGRESS' && wpDetail.rework_counts) {
      for (const [type, count] of Object.entries(wpDetail.rework_counts)) {
        if (typeof count === 'number' && count >= MAX_REWORK_COUNT) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                action: 'REVIEW_REWORK_LIMIT',
                work_package_id: wpDetail.work_package_id,
                reason: `Rework limit reached for ${type} pipeline.`,
              }, null, 2),
            }],
          };
        }
      }
    }
  }

  // --- Priority 3: REVIEW_STALE ---
  // IN_PROGRESS WPs with any stale IN_PROGRESS pipeline
  const allPipelineTypes: readonly string[] = PIPELINE_TYPES;
  for (const wpDetail of wpDetails) {
    if (wpDetail.status === 'IN_PROGRESS') {
      for (const pipelineType of allPipelineTypes) {
        const staleAction = extractStalePipelineAction(wpDetail, pipelineType);
        if (staleAction) {
          const innerData = JSON.parse(staleAction.content[0].text) as { age_hours: number };
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                action: 'REVIEW_STALE',
                work_package_id: wpDetail.work_package_id,
                pipeline_type: pipelineType,
                age_hours: innerData.age_hours,
                reason: `Work package ${wpDetail.work_package_id} has a stale '${pipelineType}' pipeline (~${innerData.age_hours}h). Investigate and resume or cancel.`,
              }, null, 2),
            }],
          };
        }
      }
    }
  }

  // --- Priority 3b: REVIEW_ABANDONED ---
  // IN_PROGRESS WPs with no active IN_PROGRESS pipelines and last activity > STALE_PIPELINE_HOURS
  const staleThresholdMs = STALE_PIPELINE_HOURS * 60 * 60 * 1000;
  for (const wpDetail of wpDetails) {
    if (wpDetail.status === 'IN_PROGRESS') {
      const hasActivePipeline = wpDetail.pipelines.some((p) => p.status === 'IN_PROGRESS');
      if (!hasActivePipeline) {
        const now = Date.now();
        const lastEffective = mostRecentEffectivePipeline(wpDetail);
        if (lastEffective) {
          if (lastEffective.completed_at) {
            const completedAt = parseTimestamp(lastEffective.completed_at).getTime();
            if (now - completedAt > staleThresholdMs) {
              return {
                content: [{
                  type: 'text' as const,
                  text: JSON.stringify({
                    action: 'REVIEW_ABANDONED',
                    work_package_id: wpDetail.work_package_id,
                    reason: `Work package ${wpDetail.work_package_id} is IN_PROGRESS with no active pipelines. Last activity was more than ${STALE_PIPELINE_HOURS} hours ago.`,
                  }, null, 2),
                }],
              };
            }
          }
        } else {
          // No effective pipeline — use status_changed_at for grace period check
          if (wpDetail.status_changed_at) {
            const changedAt = parseTimestamp(wpDetail.status_changed_at).getTime();
            if (now - changedAt > staleThresholdMs) {
              return {
                content: [{
                  type: 'text' as const,
                  text: JSON.stringify({
                    action: 'REVIEW_ABANDONED',
                    work_package_id: wpDetail.work_package_id,
                    reason: `Work package ${wpDetail.work_package_id} is IN_PROGRESS with no pipelines and has been idle for more than ${STALE_PIPELINE_HOURS} hours.`,
                  }, null, 2),
                }],
              };
            }
            // within grace period — skip
          }
          // No status_changed_at and no pipelines — recently claimed, skip
        }
      }
    }
  }

  // --- Priority 3c: REPAIR_ORPHAN_BLOCKED ---
  // BLOCKED WPs with dependency blocker (or absent blocked_by) where all deps are now terminal
  for (const wpDetail of wpDetails) {
    if (wpDetail.status === 'BLOCKED') {
      const blockerType = wpDetail.blocked_by?.type;
      if (!blockerType || blockerType === 'dependency') {
        const canStart = canStartWorkPackage(wpDetail, rootIndex.work_packages);
        if (canStart.allowed) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                action: 'REPAIR_ORPHAN_BLOCKED',
                work_package_id: wpDetail.work_package_id,
                reason: `Work package ${wpDetail.work_package_id} is BLOCKED by a dependency that has since completed. Auto-unblock did not run. Investigate and unblock.`,
              }, null, 2),
            }],
          };
        }
      }
    }
  }

  // --- Priority 4 / Fallback: WAIT ---
  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        action: 'WAIT',
        reason: 'No actionable items found.',
      }, null, 2),
    }],
  };
}

/**
 * Get next action for Developer.
 * Per-WP priority evaluation from §14.2.
 */
export async function getDeveloperAction(rootIndex: RootIndex, store: LedgerStore, preloadedWpDetails?: WorkPackageDetail[]) {
  // Load all WP details to examine pipeline states (skip if pre-loaded by caller)
  const wpDetails = preloadedWpDetails ?? await Promise.all(
    rootIndex.work_packages.map((wp) => store.readWorkPackage(wp.work_package_id))
  );

  for (const wpDetail of wpDetails) {
    // Skip terminal (COMPLETE, CANCELLED) and BLOCKED statuses
    if (isTerminalStatus(wpDetail.status) || wpDetail.status === 'BLOCKED') continue;
    // Only consider WPs where implementation is an active stage
    const activeStages: readonly PipelineType[] =
      (wpDetail.active_pipeline_stages as PipelineType[] | undefined) ?? DEFAULT_PIPELINE_STAGES;
    if (!activeStages.includes('implementation')) continue;
    // Skip dependency-blocked WPs
    if (hasDependencyBlocked(wpDetail)) continue;

    // P1: BLOCK_FOR_REWORK_LIMIT (IN_PROGRESS only)
    if (wpDetail.status === 'IN_PROGRESS') {
      const implReworkCount = wpDetail.rework_counts?.implementation ?? 0;
      if (implReworkCount >= MAX_REWORK_COUNT) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              action: 'BLOCK_FOR_REWORK_LIMIT',
              work_package_id: wpDetail.work_package_id,
              rework_count: implReworkCount,
              max_rework_count: MAX_REWORK_COUNT,
              reason: `Work package ${wpDetail.work_package_id} has reached the maximum rework count (${MAX_REWORK_COUNT}). It cannot proceed with further implementation cycles.`,
              next_steps: [
                `1. Review the rework history in ${wpDetail.work_package_id} to understand repeated failures.`,
                `2. Consider cancelling this WP via ledger_update_work_package_status (status: "CANCELLED") and creating a replacement WP with a revised approach.`,
                `3. Alternatively, restructure the work package scope to address the root cause of repeated failures.`,
                `4. Call ledger_get_handoff_status (current_agent: "Developer") to continue the workflow.`,
              ],
            }, null, 2),
          }],
        };
      }
    }

    // P2: RESUME_OR_CANCEL (stale IN_PROGRESS implementation pipeline)
    const staleAction = extractStalePipelineAction(wpDetail, 'implementation');
    if (staleAction) return staleAction;

    // P3: CONTINUE_PIPELINE (active non-stale implementation pipeline)
    if (isActivePipeline(wpDetail, 'implementation')) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'CONTINUE_PIPELINE',
            work_package_id: wpDetail.work_package_id,
            reason: `Work package ${wpDetail.work_package_id} has an active implementation pipeline in progress. Continue working on it.`,
            next_steps: [
              `1. Complete the current implementation work for ${wpDetail.work_package_id}.`,
              `2. Call ledger_complete_pipeline (work_package_id: "${wpDetail.work_package_id}", type: "implementation", status: PASS/FAIL, summary, artifacts, comments, acceptance_criteria_updates).`,
              `3. Call ledger_get_handoff_status (current_agent: "Developer").`,
            ],
          }, null, 2),
        }],
      };
    }

    // P4: REWORK (direct fail — most recent implementation pipeline is FAIL)
    if (isMostRecentPipelineFail(wpDetail.pipelines, 'implementation')) {
      const handoffNotes = getHandoffNotesForAgent(wpDetail, 'Developer');
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'REWORK',
            work_package_id: wpDetail.work_package_id,
            reason: `Work package ${wpDetail.work_package_id} has a FAIL implementation pipeline. Rework and retry.`,
            next_steps: [
              `1. Call ledger_begin_work (work_package_id: "${wpDetail.work_package_id}", type: "implementation", agent_role: "Developer") — WP is already IN_PROGRESS, starts pipeline directly.`,
              '2. Review the previous FAIL pipeline summary, fix the issues, run tests.',
              `3. Call ledger_complete_pipeline (work_package_id: "${wpDetail.work_package_id}", type: "implementation", status: PASS/FAIL, summary, artifacts, comments, acceptance_criteria_updates).`,
              `4. Call ledger_get_handoff_status (current_agent: "Developer").`,
            ],
            ...(handoffNotes ? { handoff_notes: handoffNotes } : {}),
          }, null, 2),
        }],
      };
    }

    // P5 + P5b: Downstream FAIL checks (only meaningful when implementation has PASS)
    const hasPassImpl = wpDetail.pipelines.some(
      (p) => p.type === 'implementation' && p.status === 'PASS' && !p.auto_cancelled
    );
    if (hasPassImpl && hasDownstreamFail(wpDetail.pipelines, 'implementation', activeStages)) {
      if (hasDownstreamReengagedSince(wpDetail.pipelines, 'implementation', activeStages)) {
        // P5: REWORK (downstream triggered — downstream re-ran after last impl PASS)
        const handoffNotes = getHandoffNotesForAgent(wpDetail, 'Developer');
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              action: 'REWORK',
              work_package_id: wpDetail.work_package_id,
              reason: `Work package ${wpDetail.work_package_id} has a downstream failure after implementation was accepted. Downstream re-engagement detected.`,
              next_steps: [
                `1. Call ledger_get_work_package to review the downstream FAIL pipeline comments/summary.`,
                `2. Call ledger_begin_work (work_package_id: "${wpDetail.work_package_id}", type: "implementation", agent_role: "Developer") to begin a new implementation cycle.`,
                '3. Fix the issues identified by the failed pipeline, run tests.',
                `4. Call ledger_complete_pipeline (work_package_id: "${wpDetail.work_package_id}", type: "implementation", status: PASS/FAIL, summary, artifacts, comments, acceptance_criteria_updates).`,
                `5. Call ledger_get_handoff_status (current_agent: "Developer").`,
              ],
              ...(handoffNotes ? { handoff_notes: handoffNotes } : {}),
            }, null, 2),
          }],
        };
      } else {
        // P5b: WAIT_FOR_DOWNSTREAM — fix delivered, downstream hasn't re-engaged yet
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              action: 'WAIT_FOR_DOWNSTREAM',
              work_package_id: wpDetail.work_package_id,
              reason: `Work package ${wpDetail.work_package_id}: fix delivered; awaiting downstream re-engagement.`,
            }, null, 2),
          }],
        };
      }
    }

    // P6: IMPLEMENT (IN_PROGRESS, no implementation pipeline started yet)
    if (wpDetail.status === 'IN_PROGRESS') {
      const hasImplPipeline = wpDetail.pipelines.some((p) => p.type === 'implementation');
      if (!hasImplPipeline) {
        const handoffNotes = getHandoffNotesForAgent(wpDetail, 'Developer');
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              action: 'IMPLEMENT',
              work_package_id: wpDetail.work_package_id,
              reason: `Work package ${wpDetail.work_package_id} is IN_PROGRESS with no implementation pipeline. Implement.`,
              next_steps: [
                `1. Call ledger_begin_work (work_package_id: "${wpDetail.work_package_id}", type: "implementation", agent_role: "Developer").`,
                '2. Read the WP spec, implement the changes, run tests.',
                `3. Call ledger_complete_pipeline (work_package_id: "${wpDetail.work_package_id}", type: "implementation", status: PASS/FAIL, summary, artifacts, comments, acceptance_criteria_updates).`,
                `4. Call ledger_get_handoff_status (current_agent: "Developer").`,
              ],
              ...(handoffNotes ? { handoff_notes: handoffNotes } : {}),
            }, null, 2),
          }],
        };
      }
    }

    // P7: CLAIM_WP (READY, dependencies satisfied, unassigned or assigned to Developer)
    if (wpDetail.status === 'READY' && (wpDetail.assigned_to == null || wpDetail.assigned_to === 'Developer')) {
      const handoffNotes = getHandoffNotesForAgent(wpDetail, 'Developer');
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'CLAIM_WP',
            work_package_id: wpDetail.work_package_id,
            reason: `Work package ${wpDetail.work_package_id} is READY and assigned to Developer with all dependencies satisfied.`,
            next_steps: [
              `1. Call ledger_begin_work (work_package_id: "${wpDetail.work_package_id}", type: "implementation", agent_role: "Developer") to claim and start the pipeline in one step.`,
              '2. Read the WP spec, implement the changes, run tests.',
              `3. Call ledger_complete_pipeline (work_package_id: "${wpDetail.work_package_id}", type: "implementation", status: PASS/FAIL, summary, artifacts, comments, acceptance_criteria_updates).`,
              `4. Call ledger_get_handoff_status (current_agent: "Developer").`,
            ],
            ...(handoffNotes ? { handoff_notes: handoffNotes } : {}),
          }, null, 2),
        }],
      };
    }
  }

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        action: 'WAIT',
        reason: 'No work packages ready for implementation. All WPs either have implementation pipelines or are blocked.',
      }, null, 2),
    }],
  };
}

/**
 * Get next action for QA.
 * Per-WP priority evaluation from §14.3.
 */
export async function getQaAction(rootIndex: RootIndex, store: LedgerStore, preloadedWpDetails?: WorkPackageDetail[]) {
  // Load all WP details to examine pipeline states (skip if pre-loaded by caller)
  const wpDetails = preloadedWpDetails ?? await Promise.all(
    rootIndex.work_packages.map((wp) => store.readWorkPackage(wp.work_package_id))
  );

  for (const wpDetail of wpDetails) {
    // Skip terminal and BLOCKED statuses
    if (isTerminalStatus(wpDetail.status) || wpDetail.status === 'BLOCKED') continue;
    // Only consider WPs where qa is an active stage
    const activeStages: readonly PipelineType[] =
      (wpDetail.active_pipeline_stages as PipelineType[] | undefined) ?? DEFAULT_PIPELINE_STAGES;
    if (!activeStages.includes('qa')) continue;
    // Skip dependency-blocked WPs
    if (hasDependencyBlocked(wpDetail)) continue;

    // Resolve upstream prerequisite for qa in this WP's active stages
    const qaPrerequisite = resolvePrerequisite('qa', activeStages);

    // P1: BLOCK_FOR_REWORK_LIMIT (QA's own rework at MAX, IN_PROGRESS only)
    if (wpDetail.status === 'IN_PROGRESS') {
      const qaReworkCount = wpDetail.rework_counts?.qa ?? 0;
      if (qaReworkCount >= MAX_REWORK_COUNT) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              action: 'BLOCK_FOR_REWORK_LIMIT',
              work_package_id: wpDetail.work_package_id,
              rework_count: qaReworkCount,
              max_rework_count: MAX_REWORK_COUNT,
              reason: `Work package ${wpDetail.work_package_id} QA has reached the maximum rework count (${MAX_REWORK_COUNT}). Escalate to Project Manager.`,
            }, null, 2),
          }],
        };
      }
    }

    // P1b: WAIT_FOR_UPSTREAM_REWORK_LIMIT (upstream prerequisite rework at MAX)
    if (qaPrerequisite !== null) {
      const prereqReworkCount = wpDetail.rework_counts?.[qaPrerequisite] ?? 0;
      if (prereqReworkCount >= MAX_REWORK_COUNT) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              action: 'WAIT_FOR_UPSTREAM_REWORK_LIMIT',
              work_package_id: wpDetail.work_package_id,
              reason: `Work package ${wpDetail.work_package_id} ${qaPrerequisite} has reached the maximum rework count. QA cannot proceed until the upstream limit is resolved.`,
            }, null, 2),
          }],
        };
      }
    }

    // P2: RESUME_OR_CANCEL (stale QA pipeline)
    const staleAction = extractStalePipelineAction(wpDetail, 'qa');
    if (staleAction) return staleAction;

    // P3: CONTINUE_PIPELINE (active non-stale QA pipeline)
    if (isActivePipeline(wpDetail, 'qa')) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'CONTINUE_PIPELINE',
            work_package_id: wpDetail.work_package_id,
            reason: `Work package ${wpDetail.work_package_id} has an active QA pipeline in progress. Continue QA work.`,
            next_steps: [
              `1. Complete the current QA work for ${wpDetail.work_package_id}.`,
              `2. Call ledger_complete_pipeline (work_package_id: "${wpDetail.work_package_id}", type: "qa", status: PASS/FAIL, summary, metrics, comments, acceptance_criteria_updates).`,
              `3. Call ledger_get_handoff_status (current_agent: "QA").`,
            ],
          }, null, 2),
        }],
      };
    }

    // P4: RUN_QA (re-engagement) — at least one prior QA pipeline AND new upstream PASS since then
    const priorQaPipelines = wpDetail.pipelines.filter(
      (p) => p.type === 'qa' && !p.auto_cancelled
    );
    const hasNewPrereqPassForQa = makeReEngagementCheck(wpDetail.pipelines, qaPrerequisite, 'qa');
    if (priorQaPipelines.length > 0 && hasNewPrereqPassForQa) {
      const handoffNotes = getHandoffNotesForAgent(wpDetail, 'QA');
      const prereqLabel = qaPrerequisite ?? 'prior stage';
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'RUN_QA',
            work_package_id: wpDetail.work_package_id,
            reason: `Work package ${wpDetail.work_package_id} has a new ${prereqLabel} PASS since the last QA pipeline. Re-run QA.`,
            next_steps: [
              `1. Call ledger_begin_work (work_package_id: "${wpDetail.work_package_id}", type: "qa", agent_role: "QA").`,
              `2. Call ledger_get_work_package to review implementation artifacts and acceptance criteria.`,
              '3. Execute the Verification Stack: build check, AC verification, regression tests, edge-case stress tests.',
              `4. Call ledger_complete_pipeline (work_package_id: "${wpDetail.work_package_id}", type: "qa", status: PASS/FAIL, summary, metrics, comments, acceptance_criteria_updates).`,
              `5. Call ledger_get_handoff_status (current_agent: "QA").`,
            ],
            ...(handoffNotes ? { handoff_notes: handoffNotes } : {}),
          }, null, 2),
        }],
      };
    }

    // P5: WAIT_FOR_REWORK — most recent QA is FAIL and no new upstream pass yet
    if (isMostRecentPipelineFail(wpDetail.pipelines, 'qa')) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'WAIT_FOR_REWORK',
            work_package_id: wpDetail.work_package_id,
            reason: `Work package ${wpDetail.work_package_id} has a FAIL QA pipeline. Developer must rework the implementation before QA can retry. QA does not self-rework.`,
          }, null, 2),
        }],
      };
    }

    // P6: RUN_QA (first-run) — no prior QA pipeline + prerequisite has PASS (or no prerequisite)
    const hasPrereqPass = qaPrerequisite === null
      ? true // qa is first active stage, can always start
      : wpDetail.pipelines.some(
          (p) => p.type === qaPrerequisite && p.status === 'PASS' && !p.auto_cancelled
        );
    if (hasPrereqPass && priorQaPipelines.length === 0) {
      const handoffNotes = getHandoffNotesForAgent(wpDetail, 'QA');
      const prereqLabel = qaPrerequisite ?? 'prerequisite';
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'RUN_QA',
            work_package_id: wpDetail.work_package_id,
            reason: qaPrerequisite
              ? `Work package ${wpDetail.work_package_id} has PASS ${prereqLabel} pipeline but no QA pipeline. Run QA.`
              : `Work package ${wpDetail.work_package_id} has no prior QA pipeline and qa is the first active stage. Run QA.`,
            next_steps: [
              `1. Call ledger_begin_work (work_package_id: "${wpDetail.work_package_id}", type: "qa", agent_role: "QA").`,
              `2. Call ledger_get_work_package to review implementation artifacts and acceptance criteria.`,
              '3. Execute the Verification Stack: build check, AC verification, regression tests, edge-case stress tests.',
              `4. Call ledger_complete_pipeline (work_package_id: "${wpDetail.work_package_id}", type: "qa", status: PASS/FAIL, summary, metrics, comments, acceptance_criteria_updates).`,
              `5. Call ledger_get_handoff_status (current_agent: "QA").`,
            ],
            ...(handoffNotes ? { handoff_notes: handoffNotes } : {}),
          }, null, 2),
        }],
      };
    }

    // P7: CLAIM_WP (READY WP assigned to QA)
    if (wpDetail.status === 'READY' && wpDetail.assigned_to === 'QA') {
      const handoffNotes = getHandoffNotesForAgent(wpDetail, 'QA');
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'CLAIM_WP',
            work_package_id: wpDetail.work_package_id,
            reason: `Work package ${wpDetail.work_package_id} is READY and assigned to QA with all dependencies satisfied.`,
            next_steps: [
              `1. Call ledger_claim_work_package (work_package_id: "${wpDetail.work_package_id}", agent: "QA") to transition to IN_PROGRESS.`,
              `2. Wait for implementation pipeline to complete before starting QA.`,
              `3. Call ledger_get_handoff_status (current_agent: "QA").`,
            ],
            ...(handoffNotes ? { handoff_notes: handoffNotes } : {}),
          }, null, 2),
        }],
      };
    }
  }

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        action: 'WAIT',
        reason: 'No work packages ready for QA. All WPs either lack implementation pipelines or already have QA pipelines.',
      }, null, 2),
    }],
  };
}

/**
 * Get next action for Reviewer.
 * Per-WP priority evaluation from §14.4.
 */
export async function getReviewerAction(rootIndex: RootIndex, store: LedgerStore, preloadedWpDetails?: WorkPackageDetail[]) {
  // Load all WP details to examine pipeline states (skip if pre-loaded by caller)
  const wpDetails = preloadedWpDetails ?? await Promise.all(
    rootIndex.work_packages.map((wp) => store.readWorkPackage(wp.work_package_id))
  );

  for (const wpDetail of wpDetails) {
    // Skip terminal and BLOCKED statuses
    if (isTerminalStatus(wpDetail.status) || wpDetail.status === 'BLOCKED') continue;
    // Only consider WPs where code-review is an active stage
    const activeStages: readonly PipelineType[] =
      (wpDetail.active_pipeline_stages as PipelineType[] | undefined) ?? DEFAULT_PIPELINE_STAGES;
    if (!activeStages.includes('code-review')) continue;
    // Skip dependency-blocked WPs
    if (hasDependencyBlocked(wpDetail)) continue;

    // Resolve upstream prerequisite for code-review in this WP's active stages
    const reviewPrerequisite = resolvePrerequisite('code-review', activeStages);

    // Compute active stages before code-review for P1b upstream limit checks
    const orderedActive = getOrderedActiveStages(activeStages);
    const crIdx = orderedActive.indexOf('code-review');
    const upstreamActiveStages = crIdx > 0 ? orderedActive.slice(0, crIdx) : [];

    // P1: BLOCK_FOR_REWORK_LIMIT (Reviewer's own rework at MAX, IN_PROGRESS only)
    if (wpDetail.status === 'IN_PROGRESS') {
      const reviewReworkCount = wpDetail.rework_counts?.['code-review'] ?? 0;
      if (reviewReworkCount >= MAX_REWORK_COUNT) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              action: 'BLOCK_FOR_REWORK_LIMIT',
              work_package_id: wpDetail.work_package_id,
              rework_count: reviewReworkCount,
              max_rework_count: MAX_REWORK_COUNT,
              reason: `Work package ${wpDetail.work_package_id} code-review has reached the maximum rework count (${MAX_REWORK_COUNT}). Escalate to Project Manager.`,
            }, null, 2),
          }],
        };
      }
    }

    // P1b: WAIT_FOR_UPSTREAM_REWORK_LIMIT (any active upstream pipeline at MAX)
    for (const upType of upstreamActiveStages) {
      if ((wpDetail.rework_counts?.[upType] ?? 0) >= MAX_REWORK_COUNT) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              action: 'WAIT_FOR_UPSTREAM_REWORK_LIMIT',
              work_package_id: wpDetail.work_package_id,
              reason: `Work package ${wpDetail.work_package_id} ${upType} has reached the maximum rework count. Reviewer cannot proceed until the upstream limit is resolved.`,
            }, null, 2),
          }],
        };
      }
    }

    // P2: RESUME_OR_CANCEL (stale code-review pipeline)
    const staleAction = extractStalePipelineAction(wpDetail, 'code-review');
    if (staleAction) return staleAction;

    // P3: CONTINUE_PIPELINE (active non-stale code-review pipeline)
    if (isActivePipeline(wpDetail, 'code-review')) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'CONTINUE_PIPELINE',
            work_package_id: wpDetail.work_package_id,
            reason: `Work package ${wpDetail.work_package_id} has an active code-review pipeline in progress. Continue review work.`,
            next_steps: [
              `1. Complete the current code review for ${wpDetail.work_package_id}.`,
              `2. Call ledger_complete_pipeline (work_package_id: "${wpDetail.work_package_id}", type: "code-review", status: PASS/FAIL, summary, comments, acceptance_criteria_updates).`,
              `3. Call ledger_get_handoff_status (current_agent: "Reviewer").`,
            ],
          }, null, 2),
        }],
      };
    }

    // P4: RUN_REVIEW (re-engagement) — at least one prior review pipeline AND new upstream PASS since then
    const priorReviewPipelines = wpDetail.pipelines.filter(
      (p) => p.type === 'code-review' && !p.auto_cancelled
    );
    const hasNewPrereqPassForReview = makeReEngagementCheck(wpDetail.pipelines, reviewPrerequisite, 'code-review');
    if (priorReviewPipelines.length > 0 && hasNewPrereqPassForReview) {
      const handoffNotes = getHandoffNotesForAgent(wpDetail, 'Reviewer');
      const prereqLabel = reviewPrerequisite ?? 'prior stage';
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'RUN_REVIEW',
            work_package_id: wpDetail.work_package_id,
            reason: `Work package ${wpDetail.work_package_id} has a new ${prereqLabel} PASS since the last code-review pipeline. Re-run review.`,
            next_steps: [
              `1. Call ledger_begin_work (work_package_id: "${wpDetail.work_package_id}", type: "code-review", agent_role: "Reviewer").`,
              `2. Call ledger_get_work_package to review implementation artifacts and QA results.`,
              '3. Perform code review: architecture, quality, security, maintainability.',
              `4. Call ledger_complete_pipeline (work_package_id: "${wpDetail.work_package_id}", type: "code-review", status: PASS/FAIL, summary, comments, acceptance_criteria_updates).`,
              `5. Call ledger_get_handoff_status (current_agent: "Reviewer").`,
            ],
            ...(handoffNotes ? { handoff_notes: handoffNotes } : {}),
          }, null, 2),
        }],
      };
    }

    // P5: WAIT_FOR_REWORK — most recent code-review is FAIL and no new upstream pass yet
    if (isMostRecentPipelineFail(wpDetail.pipelines, 'code-review')) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'WAIT_FOR_REWORK',
            work_package_id: wpDetail.work_package_id,
            reason: `Work package ${wpDetail.work_package_id} has a FAIL code-review pipeline. Developer must rework the implementation before Reviewer can retry. Reviewer does not self-rework.`,
          }, null, 2),
        }],
      };
    }

    // P6: RUN_REVIEW (first-run) — no prior review pipeline + prerequisite has PASS (or no prerequisite)
    const hasReviewPrereqPass = reviewPrerequisite === null
      ? true
      : wpDetail.pipelines.some(
          (p) => p.type === reviewPrerequisite && p.status === 'PASS' && !p.auto_cancelled
        );
    if (hasReviewPrereqPass && priorReviewPipelines.length === 0) {
      const handoffNotes = getHandoffNotesForAgent(wpDetail, 'Reviewer');
      const prereqLabel = reviewPrerequisite ?? 'prerequisite';
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'RUN_REVIEW',
            work_package_id: wpDetail.work_package_id,
            reason: reviewPrerequisite
              ? `Work package ${wpDetail.work_package_id} has PASS ${prereqLabel} pipeline but no code-review pipeline. Run review.`
              : `Work package ${wpDetail.work_package_id} has no prior code-review pipeline and code-review is the first active stage. Run review.`,
            next_steps: [
              `1. Call ledger_begin_work (work_package_id: "${wpDetail.work_package_id}", type: "code-review", agent_role: "Reviewer").`,
              `2. Call ledger_get_work_package to review implementation artifacts and QA results.`,
              '3. Perform code review: architecture, quality, security, maintainability.',
              `4. Call ledger_complete_pipeline (work_package_id: "${wpDetail.work_package_id}", type: "code-review", status: PASS/FAIL, summary, comments, acceptance_criteria_updates).`,
              `5. Call ledger_get_handoff_status (current_agent: "Reviewer").`,
            ],
            ...(handoffNotes ? { handoff_notes: handoffNotes } : {}),
          }, null, 2),
        }],
      };
    }

    // P7: CLAIM_WP (READY WP assigned to Reviewer)
    if (wpDetail.status === 'READY' && wpDetail.assigned_to === 'Reviewer') {
      const handoffNotes = getHandoffNotesForAgent(wpDetail, 'Reviewer');
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'CLAIM_WP',
            work_package_id: wpDetail.work_package_id,
            reason: `Work package ${wpDetail.work_package_id} is READY and assigned to Reviewer with all dependencies satisfied.`,
            next_steps: [
              `1. Call ledger_claim_work_package (work_package_id: "${wpDetail.work_package_id}", agent: "Reviewer") to transition to IN_PROGRESS.`,
              `2. Wait for QA pipeline to complete before starting code review.`,
              `3. Call ledger_get_handoff_status (current_agent: "Reviewer").`,
            ],
            ...(handoffNotes ? { handoff_notes: handoffNotes } : {}),
          }, null, 2),
        }],
      };
    }
  }

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        action: 'WAIT',
        reason: 'No work packages ready for review. All WPs either lack QA pipelines or already have code-review pipelines.',
      }, null, 2),
    }],
  };
}

/**
 * Get next action for Security Auditor.
 * Mirrors QA action structure — no self-rework on FAIL (bounces back to Developer).
 */
export async function getSecurityAuditorAction(rootIndex: RootIndex, store: LedgerStore, preloadedWpDetails?: WorkPackageDetail[]) {
  const wpDetails = preloadedWpDetails ?? await Promise.all(
    rootIndex.work_packages.map((wp) => store.readWorkPackage(wp.work_package_id))
  );

  for (const wpDetail of wpDetails) {
    if (isTerminalStatus(wpDetail.status) || wpDetail.status === 'BLOCKED') continue;
    const activeStages: readonly PipelineType[] =
      (wpDetail.active_pipeline_stages as PipelineType[] | undefined) ?? DEFAULT_PIPELINE_STAGES;
    if (!activeStages.includes('security-audit')) continue;
    if (hasDependencyBlocked(wpDetail)) continue;

    const auditPrerequisite = resolvePrerequisite('security-audit', activeStages);

    // P1: BLOCK_FOR_REWORK_LIMIT (own rework at MAX)
    if (wpDetail.status === 'IN_PROGRESS') {
      const auditReworkCount = wpDetail.rework_counts?.['security-audit'] ?? 0;
      if (auditReworkCount >= MAX_REWORK_COUNT) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              action: 'BLOCK_FOR_REWORK_LIMIT',
              work_package_id: wpDetail.work_package_id,
              rework_count: auditReworkCount,
              max_rework_count: MAX_REWORK_COUNT,
              reason: `Work package ${wpDetail.work_package_id} security-audit has reached the maximum rework count (${MAX_REWORK_COUNT}). Escalate to Project Manager.`,
            }, null, 2),
          }],
        };
      }
    }

    // P1b: WAIT_FOR_UPSTREAM_REWORK_LIMIT (upstream prerequisite rework at MAX)
    if (auditPrerequisite !== null) {
      const prereqReworkCount = wpDetail.rework_counts?.[auditPrerequisite] ?? 0;
      if (prereqReworkCount >= MAX_REWORK_COUNT) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              action: 'WAIT_FOR_UPSTREAM_REWORK_LIMIT',
              work_package_id: wpDetail.work_package_id,
              reason: `Work package ${wpDetail.work_package_id} ${auditPrerequisite} has reached the maximum rework count. Security Auditor cannot proceed until the upstream limit is resolved.`,
            }, null, 2),
          }],
        };
      }
    }

    // P2: RESUME_OR_CANCEL
    const staleAction = extractStalePipelineAction(wpDetail, 'security-audit');
    if (staleAction) return staleAction;

    // P3: CONTINUE_PIPELINE
    if (isActivePipeline(wpDetail, 'security-audit')) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'CONTINUE_PIPELINE',
            work_package_id: wpDetail.work_package_id,
            reason: `Work package ${wpDetail.work_package_id} has an active security-audit pipeline in progress. Continue security audit work.`,
            next_steps: [
              `1. Complete the current security audit for ${wpDetail.work_package_id}.`,
              `2. Call ledger_complete_pipeline (work_package_id: "${wpDetail.work_package_id}", type: "security-audit", status: PASS/FAIL, summary, metrics, comments, acceptance_criteria_updates).`,
              `3. Call ledger_get_handoff_status (current_agent: "Security Auditor").`,
            ],
          }, null, 2),
        }],
      };
    }

    // P4: RUN_SECURITY_AUDIT (re-engagement) — prior audit pipeline AND new upstream PASS since then
    const priorAuditPipelines = wpDetail.pipelines.filter((p) => p.type === 'security-audit' && !p.auto_cancelled);
    const hasNewPrereqPassForAudit = makeReEngagementCheck(wpDetail.pipelines, auditPrerequisite, 'security-audit');
    if (priorAuditPipelines.length > 0 && hasNewPrereqPassForAudit) {
      const handoffNotes = getHandoffNotesForAgent(wpDetail, 'Security Auditor');
      const prereqLabel = auditPrerequisite ?? 'prior stage';
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'RUN_SECURITY_AUDIT',
            work_package_id: wpDetail.work_package_id,
            reason: `Work package ${wpDetail.work_package_id} has a new ${prereqLabel} PASS since the last security-audit pipeline. Re-run security audit.`,
            next_steps: [
              `1. Call ledger_begin_work (work_package_id: "${wpDetail.work_package_id}", type: "security-audit", agent_role: "Security Auditor").`,
              `2. Call ledger_get_work_package to review implementation artifacts and acceptance criteria.`,
              '3. Run security audit: OWASP checks, dependency scan, threat model review.',
              `4. Call ledger_complete_pipeline (work_package_id: "${wpDetail.work_package_id}", type: "security-audit", status: PASS/FAIL, summary, metrics, comments, acceptance_criteria_updates).`,
              `5. Call ledger_get_handoff_status (current_agent: "Security Auditor").`,
            ],
            ...(handoffNotes ? { handoff_notes: handoffNotes } : {}),
          }, null, 2),
        }],
      };
    }

    // P5: WAIT_FOR_REWORK — most recent security-audit is FAIL, no new upstream pass
    if (isMostRecentPipelineFail(wpDetail.pipelines, 'security-audit')) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'WAIT_FOR_REWORK',
            work_package_id: wpDetail.work_package_id,
            reason: `Work package ${wpDetail.work_package_id} has a FAIL security-audit pipeline. Developer must address findings before Security Auditor can retry.`,
          }, null, 2),
        }],
      };
    }

    // P6: RUN_SECURITY_AUDIT (first-run) — no prior audit + prerequisite PASS (or no prerequisite)
    const hasAuditPrereqPass = auditPrerequisite === null
      ? true
      : wpDetail.pipelines.some((p) => p.type === auditPrerequisite && p.status === 'PASS' && !p.auto_cancelled);
    if (hasAuditPrereqPass && priorAuditPipelines.length === 0) {
      const handoffNotes = getHandoffNotesForAgent(wpDetail, 'Security Auditor');
      const prereqLabel = auditPrerequisite ?? 'prerequisite';
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'RUN_SECURITY_AUDIT',
            work_package_id: wpDetail.work_package_id,
            reason: auditPrerequisite
              ? `Work package ${wpDetail.work_package_id} has PASS ${prereqLabel} pipeline but no security-audit pipeline. Run security audit.`
              : `Work package ${wpDetail.work_package_id} has no prior security-audit pipeline and security-audit is the first active stage. Run security audit.`,
            next_steps: [
              `1. Call ledger_begin_work (work_package_id: "${wpDetail.work_package_id}", type: "security-audit", agent_role: "Security Auditor").`,
              `2. Call ledger_get_work_package to review implementation artifacts and acceptance criteria.`,
              '3. Run security audit: OWASP checks, dependency scan, threat model review.',
              `4. Call ledger_complete_pipeline (work_package_id: "${wpDetail.work_package_id}", type: "security-audit", status: PASS/FAIL, summary, metrics, comments, acceptance_criteria_updates).`,
              `5. Call ledger_get_handoff_status (current_agent: "Security Auditor").`,
            ],
            ...(handoffNotes ? { handoff_notes: handoffNotes } : {}),
          }, null, 2),
        }],
      };
    }

    // P7: CLAIM_WP
    if (wpDetail.status === 'READY' && wpDetail.assigned_to === 'Security Auditor') {
      const handoffNotes = getHandoffNotesForAgent(wpDetail, 'Security Auditor');
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'CLAIM_WP',
            work_package_id: wpDetail.work_package_id,
            reason: `Work package ${wpDetail.work_package_id} is READY and assigned to Security Auditor with all dependencies satisfied.`,
            next_steps: [
              `1. Call ledger_claim_work_package (work_package_id: "${wpDetail.work_package_id}", agent: "Security Auditor") to transition to IN_PROGRESS.`,
              `2. Wait for the prerequisite pipeline to complete before starting the security audit.`,
              `3. Call ledger_get_handoff_status (current_agent: "Security Auditor").`,
            ],
            ...(handoffNotes ? { handoff_notes: handoffNotes } : {}),
          }, null, 2),
        }],
      };
    }
  }

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        action: 'WAIT',
        reason: 'No work packages ready for security audit.',
      }, null, 2),
    }],
  };
}

/**
 * Get next action for Release Engineer.
 * Self-rework on FAIL (like Documentation). Runs after code-review in extended pipelines.
 */
export async function getReleaseEngineerAction(rootIndex: RootIndex, store: LedgerStore, preloadedWpDetails?: WorkPackageDetail[]) {
  const wpDetails = preloadedWpDetails ?? await Promise.all(
    rootIndex.work_packages.map((wp) => store.readWorkPackage(wp.work_package_id))
  );

  for (const wpDetail of wpDetails) {
    if (isTerminalStatus(wpDetail.status) || wpDetail.status === 'BLOCKED') continue;
    const activeStages: readonly PipelineType[] =
      (wpDetail.active_pipeline_stages as PipelineType[] | undefined) ?? DEFAULT_PIPELINE_STAGES;
    if (!activeStages.includes('release-engineering')) continue;
    if (hasDependencyBlocked(wpDetail)) continue;

    const releasePrerequisite = resolvePrerequisite('release-engineering', activeStages);

    // Compute active upstream stages for P1b
    const orderedActive = getOrderedActiveStages(activeStages);
    const reIdx = orderedActive.indexOf('release-engineering');
    const upstreamActiveStages = reIdx > 0 ? orderedActive.slice(0, reIdx) : [];

    // P1: BLOCK_FOR_REWORK_LIMIT (own rework at MAX)
    if (wpDetail.status === 'IN_PROGRESS') {
      const releaseReworkCount = wpDetail.rework_counts?.['release-engineering'] ?? 0;
      if (releaseReworkCount >= MAX_REWORK_COUNT) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              action: 'BLOCK_FOR_REWORK_LIMIT',
              work_package_id: wpDetail.work_package_id,
              rework_count: releaseReworkCount,
              max_rework_count: MAX_REWORK_COUNT,
              reason: `Work package ${wpDetail.work_package_id} release-engineering has reached the maximum rework count (${MAX_REWORK_COUNT}). Escalate to Project Manager.`,
            }, null, 2),
          }],
        };
      }
    }

    // P1b: WAIT_FOR_UPSTREAM_REWORK_LIMIT (any active upstream pipeline at MAX)
    for (const upType of upstreamActiveStages) {
      if ((wpDetail.rework_counts?.[upType] ?? 0) >= MAX_REWORK_COUNT) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              action: 'WAIT_FOR_UPSTREAM_REWORK_LIMIT',
              work_package_id: wpDetail.work_package_id,
              reason: `Work package ${wpDetail.work_package_id} ${upType} has reached the maximum rework count. Release Engineer cannot proceed until the upstream limit is resolved.`,
            }, null, 2),
          }],
        };
      }
    }

    // P2: RESUME_OR_CANCEL
    const staleAction = extractStalePipelineAction(wpDetail, 'release-engineering');
    if (staleAction) return staleAction;

    // P3: CONTINUE_PIPELINE
    if (isActivePipeline(wpDetail, 'release-engineering')) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'CONTINUE_PIPELINE',
            work_package_id: wpDetail.work_package_id,
            reason: `Work package ${wpDetail.work_package_id} has an active release-engineering pipeline in progress. Continue release engineering work.`,
            next_steps: [
              `1. Complete the current release engineering for ${wpDetail.work_package_id}.`,
              `2. Call ledger_complete_pipeline (work_package_id: "${wpDetail.work_package_id}", type: "release-engineering", status: PASS/FAIL, summary, artifacts, comments, acceptance_criteria_updates).`,
              `3. Call ledger_get_handoff_status (current_agent: "Release Engineer").`,
            ],
          }, null, 2),
        }],
      };
    }

    // P4: REWORK (self) — most recent release-engineering FAIL and no new upstream PASS since
    if (
      isMostRecentPipelineFail(wpDetail.pipelines, 'release-engineering') &&
      (releasePrerequisite === null || !hasNewUpstreamPassSince(wpDetail.pipelines, releasePrerequisite, 'release-engineering'))
    ) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'REWORK',
            work_package_id: wpDetail.work_package_id,
            reason: `Work package ${wpDetail.work_package_id} has a FAIL release-engineering pipeline. Investigate and retry.`,
            next_steps: [
              `1. Call ledger_get_work_package to review the previous FAIL release-engineering pipeline summary and comments.`,
              `2. Call ledger_begin_work (work_package_id: "${wpDetail.work_package_id}", type: "release-engineering", agent_role: "Release Engineer").`,
              '3. Fix release engineering issues and re-run.',
              `4. Call ledger_complete_pipeline (work_package_id: "${wpDetail.work_package_id}", type: "release-engineering", status: PASS/FAIL, summary, artifacts, comments, acceptance_criteria_updates).`,
              `5. Call ledger_get_handoff_status (current_agent: "Release Engineer").`,
            ],
          }, null, 2),
        }],
      };
    }

    // P5: RUN_RELEASE_ENGINEERING (re-engagement) — prior pipeline AND new upstream PASS since
    const priorReleasePipelines = wpDetail.pipelines.filter((p) => p.type === 'release-engineering' && !p.auto_cancelled);
    const hasNewPrereqPassForRelease = makeReEngagementCheck(wpDetail.pipelines, releasePrerequisite, 'release-engineering');
    if (priorReleasePipelines.length > 0 && hasNewPrereqPassForRelease) {
      const handoffNotes = getHandoffNotesForAgent(wpDetail, 'Release Engineer');
      const prereqLabel = releasePrerequisite ?? 'prior stage';
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'RUN_RELEASE_ENGINEERING',
            work_package_id: wpDetail.work_package_id,
            reason: `Work package ${wpDetail.work_package_id} has a new ${prereqLabel} PASS since the last release-engineering pipeline. Re-run release engineering.`,
            next_steps: [
              `1. Call ledger_begin_work (work_package_id: "${wpDetail.work_package_id}", type: "release-engineering", agent_role: "Release Engineer").`,
              `2. Call ledger_get_work_package to review artifacts and acceptance criteria.`,
              '3. Run release engineering: build artifact, package, version tagging.',
              `4. Call ledger_complete_pipeline (work_package_id: "${wpDetail.work_package_id}", type: "release-engineering", status: PASS/FAIL, summary, artifacts, comments, acceptance_criteria_updates).`,
              `5. Call ledger_get_handoff_status (current_agent: "Release Engineer").`,
            ],
            ...(handoffNotes ? { handoff_notes: handoffNotes } : {}),
          }, null, 2),
        }],
      };
    }

    // P6: RUN_RELEASE_ENGINEERING (first-run) — no prior pipeline + prerequisite PASS (or no prerequisite)
    const hasReleasePrereqPass = releasePrerequisite === null
      ? true
      : wpDetail.pipelines.some((p) => p.type === releasePrerequisite && p.status === 'PASS' && !p.auto_cancelled);
    if (hasReleasePrereqPass && priorReleasePipelines.length === 0) {
      const handoffNotes = getHandoffNotesForAgent(wpDetail, 'Release Engineer');
      const prereqLabel = releasePrerequisite ?? 'prerequisite';
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'RUN_RELEASE_ENGINEERING',
            work_package_id: wpDetail.work_package_id,
            reason: releasePrerequisite
              ? `Work package ${wpDetail.work_package_id} has PASS ${prereqLabel} pipeline but no release-engineering pipeline. Run release engineering.`
              : `Work package ${wpDetail.work_package_id} has no prior release-engineering pipeline and release-engineering is the first active stage. Run release engineering.`,
            next_steps: [
              `1. Call ledger_begin_work (work_package_id: "${wpDetail.work_package_id}", type: "release-engineering", agent_role: "Release Engineer").`,
              `2. Call ledger_get_work_package to review artifacts and acceptance criteria.`,
              '3. Run release engineering: build artifact, package, version tagging.',
              `4. Call ledger_complete_pipeline (work_package_id: "${wpDetail.work_package_id}", type: "release-engineering", status: PASS/FAIL, summary, artifacts, comments, acceptance_criteria_updates).`,
              `5. Call ledger_get_handoff_status (current_agent: "Release Engineer").`,
            ],
            ...(handoffNotes ? { handoff_notes: handoffNotes } : {}),
          }, null, 2),
        }],
      };
    }

    // P7: CLAIM_WP
    if (wpDetail.status === 'READY' && wpDetail.assigned_to === 'Release Engineer') {
      const handoffNotes = getHandoffNotesForAgent(wpDetail, 'Release Engineer');
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'CLAIM_WP',
            work_package_id: wpDetail.work_package_id,
            reason: `Work package ${wpDetail.work_package_id} is READY and assigned to Release Engineer with all dependencies satisfied.`,
            next_steps: [
              `1. Call ledger_claim_work_package (work_package_id: "${wpDetail.work_package_id}", agent: "Release Engineer") to transition to IN_PROGRESS.`,
              `2. Wait for the prerequisite pipeline to complete before starting release engineering.`,
              `3. Call ledger_get_handoff_status (current_agent: "Release Engineer").`,
            ],
            ...(handoffNotes ? { handoff_notes: handoffNotes } : {}),
          }, null, 2),
        }],
      };
    }
  }

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        action: 'WAIT',
        reason: 'No work packages ready for release engineering.',
      }, null, 2),
    }],
  };
}

/**
 * Get next action for Documentation
 */
export async function getDocumentationAction(
  rootIndex: RootIndex,
  store: LedgerStore,
  preloadedWpDetails?: WorkPackageDetail[]
) {
  // Load all WP details to examine pipeline states (skip if pre-loaded by caller)
  const wpDetails = preloadedWpDetails ?? await Promise.all(
    rootIndex.work_packages.map((wp) => store.readWorkPackage(wp.work_package_id))
  );

  for (const wpDetail of wpDetails) {
    // Skip terminal or BLOCKED WPs
    if (isTerminalStatus(wpDetail.status) || wpDetail.status === 'BLOCKED') continue;
    // Only consider WPs where documentation is an active stage
    const activeStages: readonly PipelineType[] =
      (wpDetail.active_pipeline_stages as PipelineType[] | undefined) ?? DEFAULT_PIPELINE_STAGES;
    if (!activeStages.includes('documentation')) continue;

    const reworkCounts = wpDetail.rework_counts ?? {};
    const id = wpDetail.work_package_id;

    // Resolve upstream prerequisite for documentation in this WP's active stages
    const docPrerequisite = resolvePrerequisite('documentation', activeStages);

    // Compute active stages before documentation for P1b upstream limit checks
    const orderedActive = getOrderedActiveStages(activeStages);
    const docIdx = orderedActive.indexOf('documentation');
    const upstreamActiveStages = docIdx > 0 ? orderedActive.slice(0, docIdx) : [];

    // P1: BLOCK_FOR_REWORK_LIMIT — documentation rework count at max
    if ((reworkCounts['documentation'] ?? 0) >= MAX_REWORK_COUNT) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'BLOCK_FOR_REWORK_LIMIT',
            work_package_id: id,
            reason: `Work package ${id} has reached the documentation rework limit (${MAX_REWORK_COUNT}). Escalate to PM to unblock.`,
          }, null, 2),
        }],
      };
    }

    // P1b: WAIT_FOR_UPSTREAM_REWORK_LIMIT — any active upstream pipeline at max
    for (const upType of upstreamActiveStages) {
      if ((reworkCounts[upType] ?? 0) >= MAX_REWORK_COUNT) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              action: 'WAIT_FOR_UPSTREAM_REWORK_LIMIT',
              work_package_id: id,
              reason: `Work package ${id} has upstream ${upType} rework count at the limit. Waiting for PM to resolve blocker.`,
            }, null, 2),
          }],
        };
      }
    }

    // P2: RESUME_OR_CANCEL — stale IN_PROGRESS documentation pipeline
    const staleAction = extractStalePipelineAction(wpDetail, 'documentation');
    if (staleAction) return staleAction;

    // P3: CONTINUE_PIPELINE — active non-stale documentation pipeline
    if (isActivePipeline(wpDetail, 'documentation')) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'CONTINUE_PIPELINE',
            work_package_id: id,
            reason: `Work package ${id} has an active documentation pipeline in progress. Continue working on it.`,
          }, null, 2),
        }],
      };
    }

    // P4: REWORK (self) — most recent documentation pipeline is FAIL and no new upstream PASS since
    // If a new upstream PASS has appeared after the doc failure, fall through to P6 (WRITE_DOCS) for a fresh run.
    if (
      isMostRecentPipelineFail(wpDetail.pipelines, 'documentation') &&
      (docPrerequisite === null || !hasNewUpstreamPassSince(wpDetail.pipelines, docPrerequisite, 'documentation'))
    ) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'REWORK',
            work_package_id: id,
            reason: `Work package ${id} has a FAIL documentation pipeline. Investigate and retry documentation.`,
            next_steps: [
              `1. Call ledger_get_work_package to review the previous FAIL documentation pipeline summary and comments.`,
              `2. Call ledger_begin_work (work_package_id: "${id}", type: "documentation", agent_role: "Documentation").`,
              '3. Fix documentation issues, update affected files.',
              `4. Call ledger_complete_pipeline (work_package_id: "${id}", type: "documentation", status: PASS/FAIL, summary, artifacts, comments, acceptance_criteria_updates).`,
              `5. Call ledger_get_handoff_status (current_agent: "Documentation").`,
            ],
          }, null, 2),
        }],
      };
    }

    // Freshness helpers for P5 / P5b
    // "Fresh" means: the most recent doc PASS was completed after the first active stage's last start
    const firstStagePipelines = wpDetail.pipelines.filter(
      (p) => p.type === firstActiveStage(activeStages) && !p.auto_cancelled
    );
    const latestFirstStage = firstStagePipelines.at(-1);
    const latestFirstStageStart = latestFirstStage?.started_at;

    const docPassPipelines = wpDetail.pipelines.filter(
      (p) => p.type === 'documentation' && p.status === 'PASS' && !p.auto_cancelled
    );
    const latestDocPass = docPassPipelines.at(-1);

    const isFresh =
      latestFirstStageStart &&
      latestDocPass?.completed_at &&
      parseTimestamp(latestDocPass.completed_at).getTime() >=
        parseTimestamp(latestFirstStageStart).getTime();

    if (latestDocPass && isFresh) {
      const allCriteriaMet =
        wpDetail.acceptance_criteria.length > 0 &&
        wpDetail.acceptance_criteria.every((c) => c.met === true);

      // P5: FINALIZE_WP — doc PASS, fresh, all criteria met
      if (allCriteriaMet) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              action: 'FINALIZE_WP',
              work_package_id: id,
              reason: `All criteria met; freshness passed — ready to mark COMPLETE.`,
              next_steps: [
                `1. Call ledger_update_work_package_status (work_package_id: "${id}", status: "COMPLETE", agent: "Documentation").`,
                `2. Call ledger_get_handoff_status (current_agent: "Documentation").`,
              ],
            }, null, 2),
          }],
        };
      }

      // P5b: UPDATE_CRITERIA — doc PASS, fresh, criteria not fully met
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'UPDATE_CRITERIA',
            work_package_id: id,
            reason: `Documentation passed; update acceptance criteria before marking COMPLETE.`,
            next_steps: [
              `1. Call ledger_complete_pipeline or ledger_add_observation to update acceptance_criteria_updates.`,
              `2. Once all criteria are met, call ledger_update_work_package_status to mark COMPLETE.`,
            ],
          }, null, 2),
        }],
      };
    }

    // P6: WRITE_DOCS — upstream prerequisite PASS available, no fresh doc pipeline
    const hasDocPrereqPass = docPrerequisite === null
      ? true
      : hasNewUpstreamPassSince(wpDetail.pipelines, docPrerequisite, 'documentation');
    if (hasDocPrereqPass) {
      const handoffNotes = getHandoffNotesForAgent(wpDetail, 'Documentation');
      const prereqLabel = docPrerequisite ?? 'prior stage';
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'WRITE_DOCS',
            work_package_id: id,
            reason: docPrerequisite
              ? `Work package ${id} has PASS ${prereqLabel} pipeline. Write or update documentation.`
              : `Work package ${id} has no prior documentation pipeline and documentation is the first active stage. Write documentation.`,
            next_steps: [
              `1. Call ledger_begin_work (work_package_id: "${id}", type: "documentation", agent_role: "Documentation").`,
              `2. Call ledger_get_work_package to review implementation artifacts and review comments.`,
              '3. Update documentation, README files, and inline docs as needed.',
              `4. Call ledger_complete_pipeline (work_package_id: "${id}", type: "documentation", status: PASS/FAIL, summary, artifacts, comments, acceptance_criteria_updates).`,
              `5. Call ledger_get_handoff_status (current_agent: "Documentation").`,
            ],
            ...(handoffNotes ? { handoff_notes: handoffNotes } : {}),
          }, null, 2),
        }],
      };
    }

    // P7: CLAIM_WP — READY WP assigned to Documentation with dependencies satisfied
    if (
      wpDetail.status === 'READY' &&
      wpDetail.assigned_to === 'Documentation' &&
      canStartWorkPackage(wpDetail, rootIndex.work_packages)
    ) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'CLAIM_WP',
            work_package_id: id,
            reason: `Work package ${id} is READY and assigned to Documentation. Claim it to begin work.`,
            next_steps: [
              `1. Call ledger_claim_work_package (work_package_id: "${id}", agent: "Documentation").`,
            ],
          }, null, 2),
        }],
      };
    }
  }

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          {
            action: 'WAIT',
            reason:
              'No work packages ready for documentation. All WPs either lack code-review pipelines or already have up-to-date documentation.',
          },
          null,
          2
        ),
      },
    ],
  };
}

/**
 * Register the ledger_get_next_action tool on the MCP server.
 */
/** @internal — exported for unit tests only */
export const _internal = { getNextAction, buildBatchNextSteps, getNextActionsCollector, embedHandoffStatusInWait, getSecurityAuditorAction, getReleaseEngineerAction };

export function register(server: McpServer): void {
  server.registerTool(
    'ledger_get_next_action',
    {
      description: 'Get the next recommended action for your agent role. REQUIRED params: agent_role. OPTIONAL: max_results (default: 1). When max_results is 1 (default), returns a single action object. When max_results > 1, returns an array of up to that many actions under the "actions" key. Call this to determine what to do next. Returns an action type and reason based on current work package and pipeline states. Use cwd_path (workspace root) for auto-detection, or project_path if already known.',
      inputSchema: GetNextActionSchema,
    },
    getNextAction as any
  );
}

```
###  Path: `/mcp-server/src/tools/workflow.ts`

```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as nextActionModule from './workflow-next-action.js';
import * as handoffModule from './workflow-handoff.js';

// Re-export for backward compatibility with test namespace imports.
export * from '../utils/workflow-helpers.js';
export { getDeveloperAction } from './workflow-next-action.js';
export {
  nextAgentFromStatus,
  buildHandoffResponse,
  getDeveloperHandoff,
  getProjectManagerHandoff,
  getQaHandoff,
  getReviewerHandoff,
  getDocumentationHandoff,
} from './workflow-handoff.js';

/**
 * Re-export pipeline maps for test access via namespace import.
 * @internal -- for unit testing only
 */
export { PIPELINE_AGENT_MAP, NEXT_AGENT_MAP, FAIL_ROUTING_MAP } from '../utils/pipeline-maps.js';

/**
 * Register all workflow tools on the MCP server.
 */
export function register(server: McpServer): void {
  nextActionModule.register(server);
  handoffModule.register(server);
}

```