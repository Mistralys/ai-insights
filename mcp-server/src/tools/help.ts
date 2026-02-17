import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * Tool: ledger_help
 *
 * Returns usage documentation, examples, and workflow guidance for the
 * Project Ledger MCP tools. Designed to help agents (especially weaker models)
 * understand how to correctly call the tools.
 */

const TOOL_HELP: Record<string, string> = {
  overview: `
# Project Ledger MCP — Tool Reference

## All Available Tools

| Tool | Required Params | Purpose |
|------|----------------|---------|
| ledger_get_project_status | project_path | Read project overview |
| ledger_initialize_project | project_path, plan_file | Create new project ledger |
| ledger_get_work_package | project_path, work_package_id | Read a work package's full detail |
| ledger_list_work_packages | project_path | List work packages (optional: status, assigned_to filters) |
| ledger_create_work_package | project_path, assigned_to, dependencies, acceptance_criteria, work_package_file | Create a new work package |
| ledger_claim_work_package | project_path, work_package_id, agent | Claim a READY WP → IN_PROGRESS |
| ledger_update_work_package_status | project_path, work_package_id, status, agent | Update WP status |
| ledger_start_pipeline | project_path, work_package_id, type | Start a pipeline |
| ledger_complete_pipeline | project_path, work_package_id, type, status, summary | Complete a pipeline |
| ledger_add_observation | project_path, work_package_id, pipeline_type, type, priority, note | Add observation to pipeline |
| ledger_add_project_comment | project_path, type, priority, agent, note | Add project-level comment |
| ledger_get_next_action | project_path, agent_role | Get next recommended action |
| ledger_get_handoff_status | project_path, current_agent | Check handoff status |

## Common Mistakes

1. **Forgetting the "agent" parameter** — ledger_claim_work_package, ledger_update_work_package_status, and ledger_add_project_comment ALL require an "agent" param with your agent name.
2. **Wrong pipeline type names** — Use exactly: "implementation", "qa", "code-review", "documentation".
3. **Trying to mark COMPLETE as non-Documentation agent** — Only the Documentation agent can set status to COMPLETE.
4. **Starting a pipeline before claiming the WP** — WP must be IN_PROGRESS before starting a pipeline.
5. **Not updating acceptance_criteria** — Use the acceptance_criteria_updates param in ledger_complete_pipeline to mark criteria as met before marking WP COMPLETE.

## Workflow Order

1. PM creates work packages (ledger_create_work_package)
2. Developer claims WP (ledger_claim_work_package), starts pipeline (ledger_start_pipeline type="implementation"), completes pipeline (ledger_complete_pipeline)
3. QA starts pipeline (type="qa"), completes pipeline
4. Reviewer starts pipeline (type="code-review"), completes pipeline
5. Documentation starts pipeline (type="documentation"), completes pipeline, then marks WP COMPLETE (ledger_update_work_package_status)
`,

  ledger_get_project_status: `
# ledger_get_project_status

Read the project overview from the root index.

## Required Parameters
- **project_path** (string): Absolute path to the plan directory

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

## Required Parameters
- **project_path** (string): Absolute path to the plan directory
- **plan_file** (string): Relative path to the plan file from project_path

## Example
\`\`\`json
{
  "project_path": "f:\\\\project\\\\docs\\\\agents\\\\plans\\\\2026-02-16-feature",
  "plan_file": "plan.md"
}
\`\`\`
`,

  ledger_get_work_package: `
# ledger_get_work_package

Read the full detail for a specific work package.

## Required Parameters
- **project_path** (string): Absolute path to the plan directory
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
- **project_path** (string): Absolute path to the plan directory

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
- **project_path** (string): Absolute path to the plan directory
- **assigned_to** (string): Agent name (e.g., "Developer")
- **dependencies** (array): Array of WP IDs this depends on. Use [] for no dependencies.
- **acceptance_criteria** (array): Array of criteria strings
- **work_package_file** (string): Relative path to the WP spec file

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
`,

  ledger_claim_work_package: `
# ledger_claim_work_package

Claim a READY work package → transitions to IN_PROGRESS.

## Required Parameters
- **project_path** (string): Absolute path to the plan directory
- **work_package_id** (string): WP ID (format: WP-001)
- **agent** (string): ⚠️ REQUIRED — Your agent name (e.g., "Developer", "QA")

## Example
\`\`\`json
{
  "project_path": "f:\\\\project\\\\docs\\\\agents\\\\plans\\\\2026-02-16-feature",
  "work_package_id": "WP-001",
  "agent": "Developer"
}
\`\`\`
`,

  ledger_update_work_package_status: `
# ledger_update_work_package_status

Update a work package's status.

## Required Parameters
- **project_path** (string): Absolute path to the plan directory
- **work_package_id** (string): WP ID (format: WP-001)
- **status** (string): New status — "READY", "IN_PROGRESS", "COMPLETE", or "BLOCKED"
- **agent** (string): ⚠️ REQUIRED — Your agent name (e.g., "Developer", "Documentation")

## Optional Parameters
- **blocked_by** (object): Required ONLY when setting status to "BLOCKED"

## Rules
- Only the Documentation agent can set status to "COMPLETE"
- Legal transitions: READY→IN_PROGRESS, READY→BLOCKED, IN_PROGRESS→COMPLETE, IN_PROGRESS→BLOCKED, BLOCKED→IN_PROGRESS, COMPLETE→IN_PROGRESS

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
- **project_path** (string): Absolute path to the plan directory
- **work_package_id** (string): WP ID (format: WP-001)
- **type** (string): Pipeline type — "implementation", "qa", "code-review", or "documentation"

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
`,

  ledger_complete_pipeline: `
# ledger_complete_pipeline

Complete the most recent IN_PROGRESS pipeline of the specified type.

## Required Parameters
- **project_path** (string): Absolute path to the plan directory
- **work_package_id** (string): WP ID (format: WP-001)
- **type** (string): Pipeline type to complete
- **status** (string): "PASS" or "FAIL"
- **summary** (array): Array of summary strings

## Optional Parameters
- **acceptance_criteria_updates** (array): Mark acceptance criteria as met. Each item: { "criterion": "...", "met": true }
- **artifacts** (object): { files_modified, commit_hash, pull_request }
- **metrics** (object): { test_coverage, tests_passed, tests_failed, security_issues }
- **comments** (array): Observations from the pipeline

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
  ]
}
\`\`\`
`,

  ledger_add_observation: `
# ledger_add_observation

Add an observation/comment to the most recent pipeline of the specified type.

## Required Parameters
- **project_path** (string): Absolute path to the plan directory
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
- **project_path** (string): Absolute path to the plan directory
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

## Required Parameters
- **project_path** (string): Absolute path to the plan directory
- **agent_role** (string): Exactly one of: "Planner", "Project Manager", "Developer", "QA", "Reviewer", "Documentation", "Synthesis"

## Example
\`\`\`json
{
  "project_path": "f:\\\\project\\\\docs\\\\agents\\\\plans\\\\2026-02-16-feature",
  "agent_role": "Developer"
}
\`\`\`
`,

  ledger_get_handoff_status: `
# ledger_get_handoff_status

Check handoff status to determine if your work is done.

## Required Parameters
- **project_path** (string): Absolute path to the plan directory
- **current_agent** (string): Exactly one of: "Planner", "Project Manager", "Developer", "QA", "Reviewer", "Documentation", "Synthesis"

## Example
\`\`\`json
{
  "project_path": "f:\\\\project\\\\docs\\\\agents\\\\plans\\\\2026-02-16-feature",
  "current_agent": "Documentation"
}
\`\`\`
`,
};

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
  server.tool(
    'ledger_help',
    'Get usage documentation, examples, and required parameters for all ledger tools. Call with no arguments for a full overview, or pass tool_name to get detailed help for a specific tool (e.g., tool_name: "ledger_update_work_package_status"). START HERE if you are unsure how to use the ledger tools.',
    HelpSchema.shape,
    help
  );
}
