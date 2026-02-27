/**
 * Static documentation strings for all Project Ledger MCP tools.
 * Exported as TOOL_HELP and consumed by help.ts.
 */
export const TOOL_HELP: Record<string, string> = {
  overview: `
# Project Ledger MCP — Tool Reference

## All Available Tools

| Tool | Required Params | Purpose |
|------|----------------|---------|
| ledger_get_project_status | project_path | Read project overview |
| ledger_initialize_project | project_path, plan_file | Create new project ledger |
| ledger_list_projects | None (status filter optional) | List all tracked projects with status, dates, and plan paths |
| ledger_complete_synthesis | project_path | Mark synthesis as generated; transitions project to COMPLETE |
| ledger_get_work_package | project_path, work_package_id | Read a work package's full detail |
| ledger_list_work_packages | project_path | List work packages (optional: status, assigned_to filters) |
| ledger_create_work_package | project_path, assigned_to, dependencies, acceptance_criteria, work_package_file | Create a new work package |
| ledger_claim_work_package | project_path, work_package_id, agent | Claim a READY WP → IN_PROGRESS |
| ledger_update_work_package_status | project_path, work_package_id, status, agent | Update WP status |
| ledger_start_pipeline | project_path, work_package_id, type | Start a pipeline (ordered: impl → qa → code-review → docs) |
| ledger_complete_pipeline | project_path, work_package_id, type, status, summary | Complete a pipeline |
| ledger_cancel_pipeline | project_path, work_package_id, type, reason | Cancel a stale IN_PROGRESS pipeline (sets to FAIL) |
| ledger_update_pipeline_progress | project_path, work_package_id, type, summary | Update summary of IN_PROGRESS pipeline without completing it |
| ledger_add_observation | project_path, work_package_id, pipeline_type, type, priority, note | Add observation to pipeline |
| ledger_add_project_comment | project_path, type, priority, agent, note | Add project-level comment |
| ledger_get_next_action | project_path, agent_role | Get next recommended action (singular) |
| ledger_get_next_actions | project_path, agent_role | Get ALL recommended actions (batch, optional max_results) |
| ledger_get_handoff_status | project_path, current_agent | Check handoff status |

## Common Mistakes

1. **Forgetting the "agent" parameter** — ledger_claim_work_package, ledger_update_work_package_status, and ledger_add_project_comment ALL require an "agent" param with your agent name.
2. **Wrong pipeline type names** — Use exactly: "implementation", "qa", "code-review", "documentation".
3. **Trying to mark COMPLETE as non-Documentation agent** — Only the Documentation agent can set status to COMPLETE.
4. **Starting a pipeline before claiming the WP** — WP must be IN_PROGRESS before starting a pipeline.
5. **Not updating acceptance_criteria** — Use the acceptance_criteria_updates param in ledger_complete_pipeline to mark criteria as met before marking WP COMPLETE.
6. **Starting pipelines out of order** — Pipelines must follow the enforced order: implementation → qa → code-review → documentation. Starting qa requires a PASS implementation pipeline, etc.
7. **Setting WP to BLOCKED after a pipeline FAIL** — When QA or Reviewer fails a pipeline, do NOT set the WP to BLOCKED. Leave it as IN_PROGRESS so the Developer can find it via ledger_get_next_action and rework. BLOCKED should only be used for external blockers (missing APIs, pending decisions, etc.).

## Workflow Order

1. PM creates work packages (ledger_create_work_package)
2. Developer claims WP (ledger_claim_work_package), starts pipeline (ledger_start_pipeline type="implementation"), completes pipeline (ledger_complete_pipeline). Note: starting a pipeline auto-updates assigned_to on the WP.
3. QA starts pipeline (type="qa"), completes pipeline
4. Reviewer starts pipeline (type="code-review"), completes pipeline
5. Documentation starts pipeline (type="documentation"), completes pipeline, then marks WP COMPLETE (ledger_update_work_package_status)

**Important:** Every ledger_complete_pipeline and ledger_update_work_package_status response includes a "--- NEXT STEP ---" guidance block telling you exactly what to do next. Follow it.

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

## Batch vs Singular Action Tools

- **ledger_get_next_action** (singular): Returns the first actionable WP for your role. Best for simple projects or when you process one WP at a time.
- **ledger_get_next_actions** (plural): Returns ALL actionable WPs up to max_results (default 5). Best for projects with many independent WPs.

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

This also creates a \`.meta.json\` entry in the centralized ledger so the project
is immediately discoverable via \`ledger_list_projects\`.

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
- **acceptance_criteria** (array): Array of criteria strings — **must contain at least one entry** (empty array is rejected)
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

## Assignment Guard
If the work package is already assigned to a different agent, the claim will be **rejected** unless you pass \`override: true\`. This prevents agents from silently re-assigning work packages outside their remit.

## Required Parameters
- **project_path** (string): Absolute path to the plan directory
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
- **project_path** (string): Absolute path to the plan directory
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
- **Pipeline ordering is enforced:** implementation → qa → code-review → documentation
  Starting a qa pipeline requires a PASS implementation pipeline, etc.
- Starting a pipeline **automatically updates** the work package's \`assigned_to\` field to the responsible agent (Developer, QA, Reviewer, Documentation).
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
- **acceptance_criteria_updates** (array): Mark acceptance criteria as met. Each item: { "criterion": "...", "met": true }. If the criterion text matches an existing entry, its \`met\` flag is updated. If the text is **not found**, a new criterion entry is appended to the WP's acceptance criteria list.
- **artifacts** (object): { files_modified, commit_hash, pull_request }
- **metrics** (object): { test_coverage, tests_passed, tests_failed, security_issues }
- **comments** (array): Observations from the pipeline
- **handoff_notes** (array of strings): Notes for the next agent. Creates a structured handoff note entry on the WP addressed to the next agent in the pipeline chain.

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
- **project_path** (string): Absolute path to the plan directory
- **work_package_id** (string): WP ID (format: WP-001)
- **type** (string): Pipeline type — "implementation", "qa", "code-review", "documentation"
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
- **project_path** (string): Absolute path to the plan directory
- **work_package_id** (string): WP ID (format: WP-001)
- **type** (string): Pipeline type — "implementation", "qa", "code-review", "documentation"
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

Get the next recommended action for your agent role (singular — returns the first actionable WP).
For projects with many independent WPs, use ledger_get_next_actions instead.

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

  ledger_get_next_actions: `
# ledger_get_next_actions

Get ALL currently actionable work packages for your agent role (batch version of ledger_get_next_action).
Returns an array of action recommendations instead of just the first one.
Useful for projects with many independent work packages.

## Required Parameters
- **project_path** (string): Absolute path to the plan directory
- **agent_role** (string): Exactly one of: "Planner", "Project Manager", "Developer", "QA", "Reviewer", "Documentation", "Synthesis"

## Optional Parameters
- **max_results** (number): Maximum number of results to return. Defaults to 5.

## Example
\`\`\`json
{
  "project_path": "f:\\\\project\\\\docs\\\\agents\\\\plans\\\\2026-02-16-feature",
  "agent_role": "Developer",
  "max_results": 3
}
\`\`\`

## Returns
\`\`\`json
{
  "actions": [
    { "action": "IMPLEMENT", "work_package_id": "WP-001", "reason": "..." },
    { "action": "REWORK", "work_package_id": "WP-003", "reason": "..." }
  ],
  "total": 2
}
\`\`\`
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

  ledger_list_projects: `
# ledger_list_projects

List all projects tracked in the centralized ledger.
Operates at the ledger-root level — no \`project_path\` required.

## Optional Parameters
- **status** (string): Filter by project status — "READY", "IN_PROGRESS", "COMPLETE", or "BLOCKED"

## Examples
\`\`\`json
{}
\`\`\`
\`\`\`json
{ "status": "IN_PROGRESS" }
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

## Required Parameters
- **project_path** (string): Absolute path to the plan directory

## When to Call
- All WPs must be COMPLETE before calling this tool
- The Synthesis agent calls this at the end of its report generation
- Only the Synthesis agent should call this tool

## Example
\`\`\`json
{
  "project_path": "f:\\\\project\\\\docs\\\\agents\\\\plans\\\\2026-02-16-feature"
}
\`\`\`
`,
};

