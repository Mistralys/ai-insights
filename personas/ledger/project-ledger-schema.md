<!--
  Project Ledger Metadata
  Version: 2.0.0
  Last Updated: 2026-02-15 12:00
  Author: Sebastian Mordziol
-->

# Project Ledger Schema Reference

## Overview

The Project Ledger is a **split-file system** that enables coordination between agents throughout the project lifecycle. It consists of a lightweight **root index** (`project-ledger.json`) and individual **per-work-package files** (`ledger/WP-###.json`). This architecture keeps each file small, isolates corruption risk, and allows agents to load only the data they need.

All agents must read and update the ledger to maintain project state and share insights.

### File Structure

```
docs/agents/plans/{PROJECT_FOLDER}/
├── plan.md                    ← The original plan
├── work.md                    ← Work packages document
├── project-ledger.json                ← Root index (lightweight summary)
└── ledger/
    ├── WP-001.json            ← Full detail for WP-001
    ├── WP-002.json            ← Full detail for WP-002
    └── ...                    ← One file per work package
```

**Root Index Location**: `docs/agents/plans/{PROJECT_FOLDER}/project-ledger.json`  
**Work Package Files Location**: `docs/agents/plans/{PROJECT_FOLDER}/ledger/WP-###.json`

(Project Folder = Folder where the `plan.md` file is located).

### Reading & Writing Rules

1. **Always read the root index first** to get project status, the work package summary list, and project comments.
2. **Load only the WP files you need** — typically the one(s) you are actively working on. Do not load all WP files unless your role requires it (e.g., Synthesis Agent).
3. **When updating a work package**, write changes to **both** the individual WP file (source of truth for detail) **and** the corresponding summary entry in the root index (status, assigned_to, dependencies).
4. **When updating project-level fields** (status, pending_work_packages, last_updated, project_comments), write to the root index only.

---

## When to Update the Ledger

Agents **must** update the ledger:
- After completing any assigned task or pipeline stage
- When discovering insights, risks, or recommendations
- When changing work package status
- When encountering blockers

---

## Key Capabilities

The ledger provides comprehensive project tracking through:

### Dependency Management
- Track which work packages depend on others
- Prevent starting work on unmet dependencies
- Identify critical path and bottlenecks

### Blocker Visibility
- Explicit tracking of what's blocking progress
- Categorized blocker types (dependency, decision, external, technical)
- Clear descriptions to help others understand and resolve

### Progress Measurement
- Timestamps for pipeline start and completion
- Track work package revisions when rework needed
- Calculate time spent on each stage

### Artifact Traceability
- Link work to actual code changes (files, commits, PRs)
- Find what was modified for each work package
- Connect ledger to version control

### Quality Metrics
- Test coverage and pass/fail rates
- Security vulnerability counts
- Quantitative data for validation decisions

### Acceptance Criteria Tracking
- Binary met/not-met status for each criterion
- Prevent premature completion
- Ensure all requirements satisfied

---

## Root-Level Fields

### `plan_file`
- **Type**: String (file path)
- **Purpose**: Reference to the original plan document
- **Example**: `"docs/agents/plans/2026-02-10-feature-name/plan.md"`
- **Updated by**: Planner Agent (initial creation only)

### `date_created`
- **Type**: String (ISO 8601 datetime)
- **Purpose**: Timestamp when ledger was first created
- **Format**: `"YYYY-MM-DD HH:MM:SS"`
- **Example**: `"2026-02-10 14:42:16"`
- **Updated by**: Planner Agent (initial creation only)

### `last_updated`
- **Type**: String (ISO 8601 datetime)
- **Purpose**: Timestamp of most recent ledger modification
- **Format**: `"YYYY-MM-DD HH:MM:SS"`
- **Example**: `"2026-02-10 16:14:11"`
- **Updated by**: All agents (every time ledger is modified)

### `status`
- **Type**: String (enum)
- **Allowed Values**:
  - `READY` - Plan complete, no work packages created yet
  - `IN_PROGRESS` - Work packages exist and work is ongoing
  - `COMPLETE` - All work packages completed successfully
  - `BLOCKED` - Project cannot proceed due to dependencies or issues
- **Updated by**: 
  - Planner Agent: Sets to `READY` initially
  - Project Manager Agent: Sets to `IN_PROGRESS` when work packages created
  - Any agent: Can set to `BLOCKED` when encountering blockers
  - Validator Agent: Sets to `COMPLETE` after final validation

### `total_work_packages`
- **Type**: Integer
- **Purpose**: Total number of work packages in the project
- **Example**: `6`
- **Updated by**: Project Manager Agent (when creating work packages)

### `pending_work_packages`
- **Type**: Integer
- **Purpose**: Number of work packages not yet completed
- **Example**: `4`
- **Updated by**: Any agent that changes work package status

### `work_packages`
- **Type**: Array of **Work Package Summary** objects
- **Purpose**: Lightweight overview of all work packages — enables agents to check status and dependencies without loading individual WP files
- **Updated by**: Project Manager Agent (initial creation), any agent that changes a work package's status, assignment, or dependencies

### `project_comments`
- **Type**: Array of comment objects
- **Purpose**: Project-wide insights that span multiple work packages (see [Comment Object Structure](#comment-object-structure))
- **Updated by**: Any agent

---

## Work Package Summary Object (Root Index)

Each entry in the root index's `work_packages` array is a **summary** — just enough for agents to assess status and dependencies without loading the full WP file.

### `work_package_id`
- **Type**: String
- **Format**: `"WP-###"`
- **Example**: `"WP-001"`

### `status`
- **Type**: String (enum: `READY`, `IN_PROGRESS`, `COMPLETE`, `BLOCKED`)
- **Purpose**: Mirrors the status in the individual WP file — must be kept in sync

### `assigned_to`
- **Type**: String
- **Purpose**: Which agent is responsible for this work package
- **Example**: `"Developer Agent"`

### `dependencies`
- **Type**: Array of strings (work package IDs)
- **Purpose**: Allows agents to check dependency status from the root index alone
- **Example**: `["WP-001", "WP-002"]`

### `file`
- **Type**: String (relative file path)
- **Purpose**: Path to the individual WP detail file, relative to the plan folder
- **Example**: `"ledger/WP-001.json"`
- **Updated by**: Project Manager Agent (creation only)

---

## Work Package Detail Object (Individual WP File)

Each work package has its own JSON file at `ledger/WP-###.json`. This file contains the **complete** work package data including pipelines, acceptance criteria, blockers, and artifacts.

### `work_package_id`
- **Type**: String
- **Purpose**: Unique identifier for the work package
- **Format**: `"WP-###"` where ### is a zero-padded number
- **Example**: `"WP-001"`, `"WP-042"`
- **Updated by**: Project Manager Agent (creation only)

### `work_package_file`
- **Type**: String (file path)
- **Purpose**: Reference to the work package document
- **Example**: `"docs/agents/plans/2026-02-10-feature-name/work.md"`
- **Updated by**: Project Manager Agent (creation only)

### `status`
- **Type**: String (enum)
- **Allowed Values**:
  - `READY` - Work package defined, ready to start
  - `IN_PROGRESS` - Work currently being performed
  - `COMPLETE` - All pipelines passed, work package finished
  - `BLOCKED` - Cannot proceed due to dependencies or issues
- **When to Update**:
  - Developer Agent: Sets to `IN_PROGRESS` when starting, `BLOCKED` if stuck
  - Validator Agent: Sets to `COMPLETE` after successful validation
- **Updated by**: Developer Agent, Validator Agent

### `assigned_to`
- **Type**: String
- **Purpose**: Identifies which agent is responsible for this work package
- **Example**: `"Developer Agent"`
- **When to Set**: Project Manager Agent assigns when creating work packages
- **Updated by**: Project Manager Agent (or agents can self-assign)

### `dependencies`
- **Type**: Array of strings (work package IDs)
- **Purpose**: Lists work packages that must complete before this one can start
- **Example**: `["WP-001", "WP-002"]`
- **Empty Array**: `[]` means no dependencies
- **Usage**: Agents should check dependent work packages are `COMPLETE` before starting
- **Updated by**: Project Manager Agent (initial), any agent if dependencies discovered later

### `blocked_by`
- **Type**: Object (optional - only present when status is `BLOCKED`)
- **Purpose**: Explicitly tracks what is blocking progress
- **Updated by**: Any agent encountering a blocker

#### Blocker Object Structure

##### `type`
- **Type**: String (enum)
- **Allowed Values**:
  - `dependency` - Waiting on another work package
  - `decision` - Requires decision from user or stakeholder
  - `external` - Waiting on external service, API keys, access, etc.
  - `technical` - Technical challenge or bug preventing progress
- **Purpose**: Categorize the blocker type

##### `description`
- **Type**: String
- **Purpose**: Clear explanation of what is blocking progress
- **Example**: `"Waiting for API key from external payment service"`

##### `blocking_work_package`
- **Type**: String (work package ID) - optional
- **Purpose**: If type is `dependency`, reference which work package is blocking
- **Example**: `"WP-001"`

### `acceptance_criteria`
- **Type**: Array of criteria objects
- **Purpose**: Track which acceptance criteria from the plan have been met
- **Updated by**: Validator Agent (marks as met), Developer Agent (can update status)

#### Acceptance Criterion Object Structure

##### `criterion`
- **Type**: String
- **Purpose**: Specific testable requirement
- **Example**: `"User can log in with JWT token"`

##### `met`
- **Type**: Boolean
- **Purpose**: Whether this criterion has been satisfied
- **Values**: `true` (met) or `false` (not yet met)

### `revision`
- **Type**: Integer
- **Purpose**: Tracks how many times this work package has been reworked
- **Default**: `1` for first attempt
- **Increment**: When work package moves from `COMPLETE` back to `IN_PROGRESS` due to issues
- **Updated by**: Any agent restarting work after completion

### `pipelines`
- **Type**: Array of pipeline objects
- **Purpose**: Track execution of different stages (implementation, QA, deployment, etc.)
- **Updated by**: Agent responsible for that pipeline stage

#### Pipeline Object Structure

##### `type`
- **Type**: String
- **Purpose**: Name of the pipeline stage
- **Common Values**: `"implementation"`, `"qa"`, `"deployment"`, `"testing"`, `"code-review"`
- **Custom Values**: Allowed - define as needed for your project
- **Updated by**: Agent executing that stage

##### `status`
- **Type**: String (enum)
- **Allowed Values**:
  - `READY` - Pipeline stage is ready to start but not yet begun
  - `IN_PROGRESS` - Pipeline stage is currently executing
  - `PASS` - Stage completed successfully
  - `FAIL` - Stage encountered errors or did not meet criteria
- **Updated by**: Agent executing that stage

##### `started_at`
- **Type**: String (ISO 8601 datetime) - optional
- **Format**: `"YYYY-MM-DD HH:MM:SS"`
- **Purpose**: Timestamp when this pipeline stage began execution
- **Example**: `"2026-02-10 09:00:00"`
- **Updated by**: Agent executing that stage (when starting work)

##### `completed_at`
- **Type**: String (ISO 8601 datetime) - optional
- **Format**: `"YYYY-MM-DD HH:MM:SS"`
- **Purpose**: Timestamp when this pipeline stage finished (PASS or FAIL)
- **Example**: `"2026-02-10 14:30:00"`
- **Updated by**: Agent executing that stage (when finishing work)

##### `summary`
- **Type**: Array of strings
- **Purpose**: Brief descriptions of what was accomplished or issues found
- **Example**: 
  ```json
  [
    "Created database migration script",
    "Updated API endpoints in user service",
    "Added unit tests with 95% coverage"
  ]
  ```
- **Updated by**: Agent executing that stage

##### `artifacts`
- **Type**: Object - optional
- **Purpose**: References to actual work output (files, commits, PRs)
- **Updated by**: Agent executing that stage
- **Common in**: `implementation` and `deployment` pipelines

###### Artifacts Object Structure

**`files_modified`**
- **Type**: Array of strings (file paths)
- **Purpose**: List of files changed during this pipeline stage
- **Example**: `["src/auth/middleware.ts", "src/utils/jwt.ts"]`

**`commit_hash`**
- **Type**: String
- **Purpose**: Git commit hash for this work
- **Example**: `"a3f2b89"`

**`pull_request`**
- **Type**: String
- **Purpose**: Pull request or merge request number
- **Example**: `"#42"`

##### `metrics`
- **Type**: Object - optional
- **Purpose**: Quantitative data about the pipeline execution
- **Updated by**: Agent executing that stage
- **Common in**: `qa` and `testing` pipelines

###### Metrics Object Structure (for QA/Testing)

**`test_coverage`**
- **Type**: String (percentage)
- **Purpose**: Code coverage percentage
- **Example**: `"94%"`

**`tests_passed`**
- **Type**: Integer
- **Purpose**: Number of tests that passed
- **Example**: `127`

**`tests_failed`**
- **Type**: Integer
- **Purpose**: Number of tests that failed
- **Example**: `2`

**`security_issues`**
- **Type**: Integer
- **Purpose**: Number of security vulnerabilities found
- **Example**: `0`

**Note**: Metrics structure can vary by pipeline type. For `deployment` pipelines, you might track `deployment_time`, `uptime`, etc.

##### `comments`
- **Type**: Array of comment objects
- **Purpose**: Insights, recommendations, or issues specific to this pipeline stage
- **Note**: Comments are pipeline-specific. The agent is implicit based on the pipeline type (e.g., implementation comments come from Developer Agent, qa comments from QA Agent)
- **Updated by**: Agent executing that stage

---

## Comment Object Structure

Comments appear in two locations:
- **Pipeline comments** (within `pipelines[].comments`) - Specific to a pipeline stage, agent is inferred from pipeline type
- **Project comments** (in root-level `project_comments`) - Project-wide insights that span multiple work packages

**When to use pipeline comments:**
- Issues found during that specific pipeline stage
- Recommendations related to that stage's work
- Notes about implementation details, QA findings, deployment concerns, etc.
- Any feedback directly tied to the pipeline's execution

**When to use project comments:**
- Patterns affecting multiple work packages
- Architecture-level concerns
- Cross-cutting recommendations (e.g., "all APIs should use centralized error handling")
- Strategic insights that don't belong to a single pipeline stage

### `type`
- **Type**: String
- **Purpose**: Categorize the comment
- **Common Values**: 
  - `"refactor"` - Code quality or structure improvements
  - `"security"` - Security concerns or vulnerabilities
  - `"recommendation"` - Suggested enhancements
  - `"improvement"` - Performance or optimization suggestions
  - `"blocker"` - Issue preventing progress
  - `"risk"` - Potential future problem
  - `"dependency"` - External dependency issue
- **Custom Values**: Allowed - use descriptive names

### `priority`
- **Type**: String (enum)
- **Allowed Values**:
  - `"low"` - Nice to have, non-urgent
  - `"medium"` - Should address soon
  - `"high"` - Must address before completion
- **Usage**: Help prioritize which comments require immediate attention

### `timestamp`
- **Type**: String (ISO 8601 datetime)
- **Format**: `"YYYY-MM-DD HH:MM:SS"`
- **Example**: `"2026-02-10 14:32:00"`
- **Purpose**: Track when the comment was added

### `agent`
- **Type**: String
- **Purpose**: Identify which agent added this comment
- **Format**: Full agent name
- **Examples**: `"Developer Agent"`, `"Validator Agent"`, `"Security Analyst Agent"`
- **Note**: Only used in `project_comments`. For pipeline comments, the agent is inferred from the pipeline type

### `note`
- **Type**: String
- **Purpose**: The actual comment content
- **Format**: Clear, actionable description
- **Example**: `"Database queries in user controller lack proper indexing. Consider adding compound index on (user_id, created_at) for performance."`

---

## Usage Examples

### Example 1: Developer Agent Completing Implementation

**Scenario**: Developer Agent finishes implementing WP-003

**Actions**:
1. Read root `project-ledger.json` to find the WP-003 summary entry and its `file` path
2. Load `ledger/WP-003.json`
3. In `ledger/WP-003.json`, add a pipeline entry:
   ```json
   {
     "type": "implementation",
     "status": "PASS",
     "started_at": "2026-02-10 09:00:00",
     "completed_at": "2026-02-10 14:30:00",
     "summary": [
       "Created user authentication middleware",
       "Added JWT token validation",
       "Implemented rate limiting"
     ],
     "artifacts": {
       "files_modified": [
         "src/auth/middleware.ts",
         "src/auth/jwt.ts",
         "src/middleware/rate-limit.ts"
       ],
       "commit_hash": "a3f2b89",
       "pull_request": "#42"
     },
     "comments": [
       {
         "type": "recommendation",
         "priority": "low",
         "timestamp": "2026-02-10 14:30:00",
         "note": "Consider caching JWT validation results to reduce database load on high-traffic endpoints."
       }
     ]
   }
   ```
4. In `ledger/WP-003.json`, update acceptance criteria:
   ```json
   "acceptance_criteria": [
     {"criterion": "User can authenticate with JWT token", "met": true},
     {"criterion": "Rate limiting prevents abuse", "met": true}
   ]
   ```
5. In root `project-ledger.json`, update the WP-003 summary status and `last_updated`

### Example 2: QA Agent Finding Security Issue

**Scenario**: QA Agent discovers security vulnerability in WP-005

**Actions**:
1. Read root `project-ledger.json` to find WP-005 summary and its `file` path
2. Load `ledger/WP-005.json`
3. In `ledger/WP-005.json`, add pipeline entry with comments and metrics:
   ```json
   {
     "type": "qa",
     "status": "FAIL",
     "started_at": "2026-02-10 15:00:00",
     "completed_at": "2026-02-10 15:45:30",
     "summary": [
       "SQL injection vulnerability found in search endpoint",
       "Missing CSRF token validation on form submission"
     ],
     "metrics": {
       "test_coverage": "87%",
       "tests_passed": 112,
       "tests_failed": 5,
       "security_issues": 2
     },
     "comments": [
       {
         "type": "security",
         "priority": "high",
         "timestamp": "2026-02-10 15:45:30",
         "note": "Search endpoint accepts raw SQL in query parameter. Must use parameterized queries to prevent SQL injection."
       },
       {
         "type": "security",
         "priority": "high",
         "timestamp": "2026-02-10 15:45:30",
         "note": "Form submission missing CSRF token validation. Add token generation and validation middleware."
       }
     ]
   }
   ```
4. In `ledger/WP-005.json`, update status and add blocker:
   ```json
   "status": "BLOCKED",
   "blocked_by": {
     "type": "technical",
     "description": "Critical security vulnerabilities must be fixed before proceeding"
   }
   ```
5. In `ledger/WP-005.json`, update acceptance criteria:
   ```json
   "acceptance_criteria": [
     {"criterion": "All security tests pass", "met": false},
     {"criterion": "No SQL injection vulnerabilities", "met": false}
   ]
   ```
6. In `ledger/WP-005.json`, increment revision counter: `"revision": 2`
7. In root `project-ledger.json`, update WP-005 summary status to `"BLOCKED"` and update `last_updated`

### Example 3: Developer Agent Starting Work with Dependencies

**Scenario**: Developer Agent wants to start WP-007 which depends on WP-003 and WP-005

**Actions**:
1. Read root `project-ledger.json` — check the `work_packages` summary array
2. Find WP-007 summary and check its dependencies:
   ```json
   "dependencies": ["WP-003", "WP-005"]
   ```
3. Check the status of WP-003 and WP-005 **from the root index summaries** (no need to load their detail files)
4. If dependencies are met:
   - Load `ledger/WP-007.json`
   - In `ledger/WP-007.json`, update status: `"status": "IN_PROGRESS"`, set `"assigned_to": "Developer Agent"`, and add pipeline:
     ```json
     {
       "type": "implementation",
       "status": "IN_PROGRESS",
       "started_at": "2026-02-10 16:00:00",
       "summary": []
     }
     ```
   - In root `project-ledger.json`, update the WP-007 summary: set `"status": "IN_PROGRESS"` and `"assigned_to": "Developer Agent"`, update `last_updated`
5. If dependencies NOT met (e.g., WP-005 is still `IN_PROGRESS`):
   - Load `ledger/WP-007.json` and add blocker:
     ```json
     "blocked_by": {
       "type": "dependency",
       "description": "Waiting for WP-005 to complete before starting",
       "blocking_work_package": "WP-005"
     }
     ```
   - In root `project-ledger.json`, update WP-007 summary status to `"BLOCKED"`, update `last_updated`

### Example 4: Adding Project-Wide Recommendation

**Scenario**: Validator Agent notices pattern that affects multiple work packages

**Actions**:
1. In root `project-ledger.json`, add to `project_comments` array:
   ```json
   {
     "type": "recommendation",
     "priority": "medium",
     "timestamp": "2026-02-10 16:20:00",
     "agent": "Validator Agent",
     "note": "Consider extracting error handling logic into a centralized middleware. Currently duplicated across WP-003, WP-007, and WP-009."
   }
   ```
2. Update root-level `last_updated` in `project-ledger.json`

**Note**: Project comments always go in the root `project-ledger.json`, never in individual WP files.

### Example 5: Reviewer Agent Conducting Code Review

**Scenario**: Reviewer Agent approves WP-009 with some strategic insights.

**Actions**:
1. Read root `project-ledger.json` to find WP-009 summary and its `file` path
2. Load `ledger/WP-009.json`
3. In `ledger/WP-009.json`, add pipeline entry with metrics and structured comments:
   ```json
   {
     "type": "code-review",
     "status": "PASS",
     "started_at": "2026-02-10 16:30:00",
     "completed_at": "2026-02-10 17:00:00",
     "summary": [
       "Performed deep-dive review on authentication logic",
       "Verified SOLID principles compliance"
     ],
     "metrics": {
       "implementation_score": 8,
       "critical_issues_found": 0,
       "suggestions_count": 2
     },
     "comments": [
       {
         "type": "refactor",
         "priority": "medium",
         "timestamp": "2026-02-10 16:45:00",
         "note": "Variable names in user_controller.ts could be more descriptive."
       },
       {
         "type": "strategic",
         "priority": "low",
         "timestamp": "2026-02-10 16:55:00",
         "note": "This auth pattern could be reused for the admin panel in WP-008."
       }
     ]
   }
   ```
4. In root `project-ledger.json`, update `last_updated`

---

## Best Practices

### For All Agents

1. **Always read the root index first**: Load `project-ledger.json` to get project status and work package summaries
2. **Load only what you need**: Read individual WP files only for the work packages you are actively working on
3. **Keep both files in sync**: When changing a work package's `status`, `assigned_to`, or `dependencies`, update **both** the WP detail file and the root index summary
4. **Update timestamps**: Always set `last_updated` in the root index when modifying any ledger file
5. **Be specific**: Use clear, actionable language in summaries and comments
6. **Reference work packages**: When adding project comments that relate to specific work packages, mention their IDs
7. **Keep summaries concise**: Use bullet-point style, 1-2 lines per item
8. **Use appropriate priorities**: Reserve "high" priority for blockers and critical issues

### For the Split-File Architecture

1. **Root index is the status dashboard**: Agents can check dependency status and overall progress from the root index alone — no need to load WP detail files just to check status
2. **Detail files are the source of truth**: For pipeline data, acceptance criteria, metrics, and artifacts, the individual WP file is authoritative
3. **Project comments belong in the root index**: Cross-cutting insights go in `project_comments` in `project-ledger.json`, never in individual WP files
4. **Pipeline comments belong in WP files**: Stage-specific observations go in the pipeline's `comments` array within the WP detail file
5. **Never duplicate pipeline data in the root index**: The root index summary only mirrors `status`, `assigned_to`, and `dependencies`

### For Status Updates

1. **Work package status transitions**:
   - `READY` → `IN_PROGRESS` (when starting work - check dependencies first!)
   - `IN_PROGRESS` → `COMPLETE` (when all pipelines pass and acceptance criteria met)
   - `IN_PROGRESS` → `BLOCKED` (when encountering issues)
   - `BLOCKED` → `IN_PROGRESS` (when blocker resolved - clear `blocked_by` object)

2. **Before starting work**: Always check `dependencies` array and verify all dependent work packages are `COMPLETE`

3. **When blocking**: Always populate the `blocked_by` object with clear description

4. **Update pending counter**: Decrement `pending_work_packages` when marking status as `COMPLETE`

5. **Project-level status**: Only mark project as `COMPLETE` when all work packages are complete AND final validation passes

6. **Revisions**: Increment `revision` when moving from `COMPLETE` back to `IN_PROGRESS` for rework

### For Pipeline Updates

1. **Add pipelines as you execute them**: Don't pre-populate - add when actually performing the work
2. **Set timestamps**: Always set `started_at` when beginning, `completed_at` when finishing
3. **Use consistent naming**: Stick to common pipeline names across the project
4. **Meaningful summaries**: Describe what was done, not just "completed successfully"
5. **Track artifacts**: For implementation pipelines, always populate `files_modified`, `commit_hash`, and `pull_request`
6. **Record metrics**: For QA/testing pipelines, include test coverage and pass/fail counts
7. **FAIL status requires explanation**: If pipeline fails, add comments within that pipeline explaining why
8. **Comments belong in pipelines**: Add insights and issues to the pipeline's `comments` array, not as separate package comments
9. **Status progression**: Use `READY` → `IN_PROGRESS` → `PASS`/`FAIL` for clear tracking

### For Acceptance Criteria

1. **Track as you go**: Update `met` status as each criterion is satisfied
2. **Don't complete work package**: Until all acceptance criteria show `"met": true`
3. **Be honest**: Mark as `false` if not fully satisfied - partial completion doesn't count

### For Dependencies and Blockers

1. **Check before starting**: Always verify dependencies are `COMPLETE` before changing status to `IN_PROGRESS`
2. **Be specific with blockers**: Clear descriptions help other agents understand and potentially unblock
3. **Remove blockers**: When work resumes, remove or clear the `blocked_by` object
4. **Reference work packages**: Use work package IDs when blocker is dependency-related

---

## Schema Templates (for reference)

### Root Index (`project-ledger.json`)

```json
{
   "plan_file": "docs/agents/plans/YYYY-MM-DD-project-name/plan.md",
   "date_created": "YYYY-MM-DD HH:MM:SS",
   "last_updated": "YYYY-MM-DD HH:MM:SS",
   "status": "READY|IN_PROGRESS|COMPLETE|BLOCKED",
   "total_work_packages": 0,
   "pending_work_packages": 0,
   "work_packages": [
      {
         "work_package_id": "WP-###",
         "status": "READY|IN_PROGRESS|COMPLETE|BLOCKED",
         "assigned_to": "Agent Name",
         "dependencies": ["WP-###"],
         "file": "ledger/WP-###.json"
      }
   ],
   "project_comments": [
      {
         "type": "string",
         "priority": "low|medium|high",
         "timestamp": "YYYY-MM-DD HH:MM:SS",
         "agent": "string",
         "note": "string"
      }
   ]
}
```

### Work Package Detail (`ledger/WP-###.json`)

```json
{
   "work_package_id": "WP-###",
   "work_package_file": "docs/agents/plans/YYYY-MM-DD-project-name/work.md",
   "status": "READY|IN_PROGRESS|COMPLETE|BLOCKED",
   "assigned_to": "Agent Name",
   "dependencies": ["WP-###"],
   "blocked_by": {
      "type": "dependency|decision|external|technical",
      "description": "string",
      "blocking_work_package": "WP-###"
   },
   "acceptance_criteria": [
      {
         "criterion": "string",
         "met": true
      }
   ],
   "revision": 1,
   "pipelines": [
      {
         "type": "string",
         "status": "READY|IN_PROGRESS|PASS|FAIL",
         "started_at": "YYYY-MM-DD HH:MM:SS",
         "completed_at": "YYYY-MM-DD HH:MM:SS",
         "summary": ["string"],
         "artifacts": {
            "files_modified": ["string"],
            "commit_hash": "string",
            "pull_request": "string"
         },
         "metrics": {
            "test_coverage": "string",
            "tests_passed": 0,
            "tests_failed": 0,
            "security_issues": 0
         },
         "comments": [
            {
               "type": "string",
               "priority": "low|medium|high",
               "timestamp": "YYYY-MM-DD HH:MM:SS",
               "note": "string"
            }
         ]
      }
   ]
}
```

---

## Questions?

If you're unsure about:
- **What to put in a field**: Be descriptive and err on the side of more detail
- **Which status to use**: Choose the most accurate representation of current state
- **Whether to add a comment**: If it's useful for another agent or future reference, add it
- **Pipeline naming**: Use clear, standard names; consistency helps all agents
- **Dependencies**: List all work packages that must complete before starting, even if obvious
- **When to block**: When you genuinely cannot proceed without external action or resolution
- **Artifacts to track**: Include all modified files, even if minor changes
- **Metrics to record**: Any quantitative data that validates quality or completeness

