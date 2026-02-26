# Data Model

> Part of the [Agent Workflow Specification](README.md).

---

## 2. Glossary

| Term | Definition |
|------|-----------|
| **Agent** | An AI persona with a specific role in the workflow |
| **Work Package (WP)** | A discrete, trackable unit of work with acceptance criteria |
| **Pipeline** | A single pass of a specific activity (implementation, QA, code-review, documentation) on a work package |
| **Handoff** | The transition of control from one agent to another |
| **Root Index** | The project-level metadata file containing WP summaries and project status |
| **Terminal Status** | A state from which no outward transitions are normally allowed. `CANCELLED` is strictly terminal. `COMPLETE` is *normally terminal* but may be reopened (see [§6.2](state-machines.md#62-transition-table)). |
| **Rework** | Restarting a pipeline after a previous FAIL |
| **Stale Pipeline** | An IN_PROGRESS pipeline that has exceeded the staleness threshold |

---

## 3. Entities & Data Model

### 3.1 Project (Root Index)

```
Project {
  plan_file:              string       // Path to the plan document
  date_created:           timestamp    // ISO 8601 UTC
  last_updated:           timestamp    // ISO 8601 UTC
  status:                 ProjectStatus
  total_work_packages:    integer
  pending_work_packages:  integer      // WPs not in a terminal state
  work_packages:          WorkPackageSummary[]
  project_comments:       ProjectComment[]
  auto_handoff_depth:     integer?     // Loop-guard counter (default: 0)
  synthesis_generated:    boolean?     // True after synthesis completion
}
```

**ProjectStatus** = `READY` | `IN_PROGRESS` | `COMPLETE` | `BLOCKED`

### 3.2 Work Package Summary

Stored in the root index for fast listing without loading detail files.

```
WorkPackageSummary {
  work_package_id:  string    // Format: "WP-###" (3+ digits)
  status:           WorkPackageStatus
  assigned_to:      string    // Agent role name
  dependencies:     string[]  // List of WP IDs this WP depends on
  file:             string    // Path to detail file
}
```

### 3.3 Work Package Detail

```
WorkPackageDetail {
  work_package_id:     string
  work_package_file:   string
  status:              WorkPackageStatus
  assigned_to:         string
  dependencies:        string[]
  blocked_by:          Blocker?
  acceptance_criteria:  AcceptanceCriterion[]  // min 1 entry
  revision:            integer                 // Incremented on COMPLETE → IN_PROGRESS
  rework_counts:       ReworkCounts?            // Per-pipeline-type rework counters
  handoff_notes:       HandoffNote[]?
  pipelines:           Pipeline[]
}
```

**WorkPackageStatus** = `READY` | `IN_PROGRESS` | `COMPLETE` | `BLOCKED` | `CANCELLED`

### 3.4 Pipeline

```
Pipeline {
  type:            PipelineType
  status:          PipelineStatus
  started_at:      timestamp?
  completed_at:    timestamp?
  summary:         string[]
  artifacts:       Artifacts?
  metrics:         Metrics?        // Extensible key-value map
  comments:        PipelineComment[]?
  auto_cancelled:  boolean?        // True when cancelled by cascade reblock or manual → BLOCKED
}
```

**PipelineType** = `implementation` | `qa` | `code-review` | `documentation`

**PipelineStatus** = `IN_PROGRESS` | `PASS` | `FAIL`

> Note: Pipelines have no READY state. They are always created directly as IN_PROGRESS.

### 3.5 Supporting Types

```
AcceptanceCriterion {
  criterion:  string
  met:        boolean
}

Blocker {
  type:                  BlockerType
  description:           string
  blocking_work_package: string?
}

BlockerType = "dependency" | "decision" | "external" | "technical"

ReworkCounts {
  implementation:  integer?    // Default: 0
  qa:              integer?    // Default: 0
  code-review:     integer?    // Default: 0
  documentation:   integer?    // Default: 0
}

HandoffNote {
  from_agent:  string
  to_agent:    string
  timestamp:   timestamp
  notes:       string[]
}

Artifacts {
  files_modified:  string[]?
  commit_hash:     string?
  pull_request:    string?
}

ProjectComment {
  type:      string
  priority:  "low" | "medium" | "high"
  timestamp: timestamp
  agent:     string
  note:      string
  context:   IncidentContext?    // Required when type = "incident"
}

PipelineComment {
  type:      string
  priority:  "low" | "medium" | "high"
  timestamp: timestamp
  note:      string
}

IncidentContext {
  os:             string         // Operating system where incident occurred
  tool:           string         // Tool/command that triggered the incident
  resolved:       boolean        // Whether the incident has been resolved
  work_package:   string?        // Related WP ID (optional)
  workaround:     string?        // Description of workaround (optional)
}
```

### 3.6 WP ID Format

- Pattern: `WP-` followed by 3 or more digits (regex: `/^WP-\d{3,}$/`)
- Generation: scan existing WPs for highest numeric suffix, next = max + 1
- Empty project: first WP is `WP-001`
- IDs are monotonically increasing but may have gaps (deletions don't cause collisions)

---

## 4. Agent Roles

Seven roles, in workflow order:

| # | Role | Responsibility |
|---|------|---------------|
| 1 | **Planner** | Creates the implementation plan document |
| 2 | **Project Manager** | Decomposes plan into work packages, initializes ledger, manages blockers |
| 3 | **Developer** | Implements work packages (owns `implementation` pipeline) |
| 4 | **QA** | Validates implementation (owns `qa` pipeline) |
| 5 | **Reviewer** | Code quality & architecture review (owns `code-review` pipeline) |
| 6 | **Documentation** | Updates documentation, marks WP COMPLETE (owns `documentation` pipeline) |
| 7 | **Synthesis** | Generates final project report when all WPs are terminal |

The canonical role list is: `["Planner", "Project Manager", "Developer", "QA", "Reviewer", "Documentation", "Synthesis"]`

### 4.1 Pipeline Ownership

Only four of the seven roles own pipeline types:

| Pipeline Type | Owning Agent |
|--------------|-------------|
| `implementation` | Developer |
| `qa` | QA |
| `code-review` | Reviewer |
| `documentation` | Documentation |

Planner, Project Manager, and Synthesis do not own any pipeline type.
