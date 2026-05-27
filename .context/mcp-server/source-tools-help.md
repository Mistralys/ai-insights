# MCP Server - Source (Tools: Help)
```
// Structure of documents
└── mcp-server/
    └── src/
        └── tools/
            └── help.ts

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
```
// Structure of documents
└── mcp-server/
    └── src/
        └── tools/
            └── help-content.ts

```
###  Path: `/mcp-server/src/tools/help-content.ts`

```ts
/**
 * Static documentation strings for all Project Ledger MCP tools.
 * Exported as TOOL_HELP and consumed by help.ts.
 */
import { PLAN_ARCHIVE_FILENAME, SYNTHESIS_ARCHIVE_FILENAME } from '../utils/constants.js';

// Shared parameter descriptions reused across all tools that accept project resolution params.
const CWD_PATH_PARAM =
  '- **cwd_path** (string): Workspace root — auto-detects the active project. Pass this if you don\'t have project_path yet.';
const PROJECT_PATH_PARAM =
  '- **project_path** (string): Plan folder path — use if already known; takes precedence over cwd_path if both are provided.';

export const TOOL_HELP: Record<string, string> = {
  overview: `
# Project Ledger MCP — Tool Reference

## Path Parameters

**Most tools accept \`project_path\` and/or \`cwd_path\`.** If you have \`project_path\` (the plan folder), use it — it's the fastest path. If you only know your workspace directory, pass \`cwd_path\` and the server auto-detects the active project. If you pass both, \`project_path\` takes precedence and \`cwd_path\` is ignored. The one exception is \`ledger_initialize_project\`, which requires \`project_path\` (the plan folder is being created and cannot be detected yet).

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
${CWD_PATH_PARAM}
${PROJECT_PATH_PARAM}

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
${CWD_PATH_PARAM}
${PROJECT_PATH_PARAM}
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
${CWD_PATH_PARAM}
${PROJECT_PATH_PARAM}

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
${CWD_PATH_PARAM}
${PROJECT_PATH_PARAM}
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
${CWD_PATH_PARAM}
${PROJECT_PATH_PARAM}
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
${CWD_PATH_PARAM}
${PROJECT_PATH_PARAM}
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
${CWD_PATH_PARAM}
${PROJECT_PATH_PARAM}
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
${CWD_PATH_PARAM}
${PROJECT_PATH_PARAM}
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
${CWD_PATH_PARAM}
${PROJECT_PATH_PARAM}
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
${CWD_PATH_PARAM}
${PROJECT_PATH_PARAM}
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
${CWD_PATH_PARAM}
${PROJECT_PATH_PARAM}
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
${CWD_PATH_PARAM}
${PROJECT_PATH_PARAM}
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
${CWD_PATH_PARAM}
${PROJECT_PATH_PARAM}
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
${CWD_PATH_PARAM}
${PROJECT_PATH_PARAM}
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
${CWD_PATH_PARAM}
${PROJECT_PATH_PARAM}
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
${CWD_PATH_PARAM}
${PROJECT_PATH_PARAM}

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