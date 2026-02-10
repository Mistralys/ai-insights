# Project Ledger Schema Reference

## Overview

The Project Ledger is a shared JSON file that enables coordination between agents throughout the project lifecycle. All agents must read and update this ledger to maintain project state and share insights.

**File Location**: `docs/agent-plans/<project-name>.json`  
**Naming Convention**: Same base name as the plan file, with `.json` extension

---

## When to Update the Ledger

Agents **must** update the ledger:
- After completing any assigned task or pipeline stage
- When discovering insights, risks, or recommendations
- When changing work package status
- When encountering blockers

---

## Root-Level Fields

### `plan_file`
- **Type**: String (file path)
- **Purpose**: Reference to the original plan document
- **Example**: `"docs/agent-plans/2026-02-10-feature-name.md"`
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

---

## Work Package Object

### `work_package_id`
- **Type**: String
- **Purpose**: Unique identifier for the work package
- **Format**: `"WP-###"` where ### is a zero-padded number
- **Example**: `"WP-001"`, `"WP-042"`
- **Updated by**: Project Manager Agent (creation only)

### `work_package_file`
- **Type**: String (file path)
- **Purpose**: Reference to the work package document
- **Example**: `"docs/work-packages/WP-001-setup.md"`
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
  - `PASS` - Stage completed successfully
  - `FAIL` - Stage encountered errors or did not meet criteria
- **Note**: If you need `IN_PROGRESS` status, add it to the schema
- **Updated by**: Agent executing that stage

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

### `package_comments`
- **Type**: Array of comment objects
- **Purpose**: Insights, recommendations, or issues specific to this work package
- **Updated by**: Any agent that has relevant feedback

---

## Comment Object Structure

Comments appear in both `package_comments` (work package specific) and `project_comments` (project-wide).

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
1. Find the work package object with `"work_package_id": "WP-003"`
2. Add a pipeline entry:
   ```json
   {
     "type": "implementation",
     "status": "PASS",
     "summary": [
       "Created user authentication middleware",
       "Added JWT token validation",
       "Implemented rate limiting"
     ]
   }
   ```
3. Update root-level `last_updated` to current timestamp

### Example 2: QA Agent Finding Security Issue

**Scenario**: QA Agent discovers security vulnerability in WP-005

**Actions**:
1. Find work package `WP-005`
2. Add pipeline entry:
   ```json
   {
     "type": "qa",
     "status": "FAIL",
     "summary": [
       "SQL injection vulnerability found in search endpoint",
       "Missing CSRF token validation on form submission"
     ]
   }
   ```
3. Add package comment:
   ```json
   {
     "type": "security",
     "priority": "high",
     "timestamp": "2026-02-10 15:45:30",
     "agent": "QA Agent",
     "note": "Search endpoint accepts raw SQL in query parameter. Must use parameterized queries to prevent SQL injection."
   }
   ```
4. Update work package status to `"BLOCKED"`
5. Update root-level `last_updated`

### Example 3: Adding Project-Wide Recommendation

**Scenario**: Validator Agent notices pattern that affects multiple work packages

**Actions**:
1. Add to `project_comments` array:
   ```json
   {
     "type": "recommendation",
     "priority": "medium",
     "timestamp": "2026-02-10 16:20:00",
     "agent": "Validator Agent",
     "note": "Consider extracting error handling logic into a centralized middleware. Currently duplicated across WP-003, WP-007, and WP-009."
   }
   ```
2. Update root-level `last_updated`

---

## Best Practices

### For All Agents

1. **Always read before writing**: Load the current ledger state before making updates
2. **Update timestamps**: Always set `last_updated` at root level when modifying ledger
3. **Be specific**: Use clear, actionable language in summaries and comments
4. **Reference work packages**: When adding project comments that relate to specific work packages, mention their IDs
5. **Keep summaries concise**: Use bullet-point style, 1-2 lines per item
6. **Use appropriate priorities**: Reserve "high" priority for blockers and critical issues

### For Status Updates

1. **Work package status transitions**:
   - `READY` → `IN_PROGRESS` (when starting work)
   - `IN_PROGRESS` → `COMPLETE` (when all pipelines pass)
   - `IN_PROGRESS` → `BLOCKED` (when encountering issues)
   - `BLOCKED` → `IN_PROGRESS` (when blocker resolved)

2. **Update pending counter**: Decrement `pending_work_packages` when marking status as `COMPLETE`

3. **Project-level status**: Only mark project as `COMPLETE` when all work packages are complete AND final validation passes

### For Pipeline Updates

1. **Add pipelines as you execute them**: Don't pre-populate - add when actually performing the work
2. **Use consistent naming**: Stick to common pipeline names across the project
3. **Meaningful summaries**: Describe what was done, not just "completed successfully"
4. **FAIL status requires explanation**: If pipeline fails, add package comment explaining why

---

## Schema Template (for reference)

```json
{
   "plan_file": "docs/agent-plans/YYYY-MM-DD-project-name.md",
   "date_created": "YYYY-MM-DD HH:MM:SS",
   "last_updated": "YYYY-MM-DD HH:MM:SS",
   "status": "READY|IN_PROGRESS|COMPLETE|BLOCKED",
   "total_work_packages": 0,
   "pending_work_packages": 0,
   "work_packages": [
      {
         "work_package_id": "WP-###",
         "work_package_file": "docs/work-packages/WP-###-name.md",
         "status": "READY|IN_PROGRESS|COMPLETE|BLOCKED",
         "pipelines": [
            {
               "type": "string",
               "status": "PASS|FAIL",
               "summary": ["string"]
            }
         ],
         "package_comments": [
            {
               "type": "string",
               "priority": "low|medium|high",
               "timestamp": "YYYY-MM-DD HH:MM:SS",
               "agent": "string",
               "note": "string"
            }
         ]
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

---

## Questions?

If you're unsure about:
- **What to put in a field**: Be descriptive and err on the side of more detail
- **Which status to use**: Choose the most accurate representation of current state
- **Whether to add a comment**: If it's useful for another agent or future reference, add it
- **Pipeline naming**: Use clear, standard names; consistency helps all agents

