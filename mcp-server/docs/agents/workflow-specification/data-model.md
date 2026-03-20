# Data Model

> Part of the [Agent Workflow Specification](README.md).

---

## 2. Glossary

| Term | Definition |
|------|-----------|
| **Agent** | An AI persona with a specific role in the workflow |
| **Work Package (WP)** | A discrete, trackable unit of work with acceptance criteria |
| **Pipeline** | A single pass of a specific activity (implementation, QA, security-audit, code-review, release-engineering, documentation) on a work package |
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
  synthesis_generated_at: timestamp?   // When synthesis was last completed (§19.1)
  ledger_version:         string?      // Spec version that created this ledger (§21.58)
}
```

**ProjectStatus** = `READY` | `IN_PROGRESS` | `COMPLETE` | `BLOCKED`

### 3.2 Work Package Summary

Stored in the root index for fast listing without loading detail files.

```
WorkPackageSummary {
  work_package_id:        string           // Format: "WP-###" (3+ digits)
  status:                 WorkPackageStatus
  assigned_to:            string           // Agent role name
  dependencies:           string[]         // List of WP IDs this WP depends on
  active_pipeline_stages: PipelineType[]?  // Mirrors detail field (§3.3); defaults to DEFAULT_PIPELINE_STAGES when absent
  file:                   string           // Path to detail file
}
```

> **Routing optimization:** `active_pipeline_stages` is included in the summary so that handoff and recommendation functions can filter WPs by stage membership (e.g., agents only see WPs where their owned stage is active) without loading detail files. The value is set at WP creation time and is immutable thereafter (see [§21.55](edge-cases.md#2155-pipeline-stage-backward-compatibility)).
```

### 3.3 Work Package Detail

```
WorkPackageDetail {
  work_package_id:         string
  work_package_file:       string
  status:                  WorkPackageStatus
  assigned_to:             string
  dependencies:            string[]
  blocked_by:              Blocker?
  acceptance_criteria:     AcceptanceCriterion[]  // min 1 entry
  revision:                integer                 // Incremented on COMPLETE → IN_PROGRESS
  rework_counts:           ReworkCounts?            // Per-pipeline-type rework counters
  active_pipeline_stages:  PipelineType[]?          // Optional; defaults to DEFAULT_PIPELINE_STAGES when absent
  status_changed_at:       timestamp?              // Updated on every status transition (see §14.12)
  handoff_notes:           HandoffNote[]?
  pipelines:               Pipeline[]
}
```

> **`active_pipeline_stages`** controls which pipeline types are active for this work package. When absent or `null`, it defaults to `DEFAULT_PIPELINE_STAGES` (`["implementation", "qa", "code-review", "documentation"]`) for full backward compatibility with existing ledger files. The value must always be a **subsequence** of the canonical pipeline ordering (§8.1). The Project Manager may compose any valid subsequence — there is no mandatory/optional distinction. See §9b.2 for validation rules including soft guardrails.
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

**PipelineType** = `implementation` | `qa` | `security-audit` | `code-review` | `release-engineering` | `documentation`

**PipelineStatus** = `IN_PROGRESS` | `PASS` | `FAIL`

> Note: Pipelines have no READY state. They are always created directly as IN_PROGRESS.

> **Ordering invariant:** The `pipelines` array is **append-only** and ordered by creation time. Implementations MUST NOT reorder, sort, or remove entries from this array. All algorithms in this specification that reference the "most recent" pipeline of a given type use positional lookup (`.last()` after filtering by type), not timestamp comparison. If the array is reordered, the entire state machine — including prerequisite checks, rework detection, re-validation guards, and freshness checks — will produce incorrect results.

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
  implementation:       integer?    // Default: 0
  qa:                   integer?    // Default: 0
  security-audit:       integer?    // Default: 0 (only present when stage is active)
  code-review:          integer?    // Default: 0
  release-engineering:  integer?    // Default: 0 (only present when stage is active)
  documentation:        integer?    // Default: 0
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

> **Informational fields:** `commit_hash` and `pull_request` in `Artifacts` are **pass-through metadata** — no algorithm, guard, or recommendation in this specification consumes them. They exist for external tooling integration (e.g., linking pipeline results to VCS history) and audit trail purposes. Implementations may populate or ignore them without affecting workflow correctness.

### 3.6 WP ID Format

- Pattern: `WP-` followed by 3 or more digits (regex: `/^WP-\d{3,}$/`)
- Generation: scan existing WPs for highest numeric suffix, next = max + 1
- Empty project: first WP is `WP-001`
- IDs are monotonically increasing but may have gaps (deletions don't cause collisions)

---

## 4. Agent Roles

Nine roles, in workflow order:

| # | Role | Responsibility |
|---|------|---------------|
| 1 | **Planner** | Creates the implementation plan document |
| 2 | **Project Manager** | Decomposes plan into work packages, initializes ledger, manages blockers, selects active pipeline stages per WP |
| 3 | **Developer** | Implements work packages (owns `implementation` pipeline) |
| 4 | **QA** | Validates implementation (owns `qa` pipeline) |
| 5 | **Security Auditor** | Security review & threat analysis (owns `security-audit` pipeline) |
| 6 | **Reviewer** | Code quality & architecture review (owns `code-review` pipeline) |
| 7 | **Release Engineer** | Release curation & version management (owns `release-engineering` pipeline) |
| 8 | **Documentation** | Updates documentation (owns `documentation` pipeline) |
| 9 | **Synthesis** | Generates final project report when all WPs are terminal |

The canonical role list is: `["Planner", "Project Manager", "Developer", "QA", "Security Auditor", "Reviewer", "Release Engineer", "Documentation", "Synthesis"]`

> **Composable stages:** All six pipeline stages are PM-composable — the Project Manager selects any valid subsequence of the canonical ordering for each WP at creation time. Agents are only engaged when their corresponding pipeline type is included in a WP's `active_pipeline_stages`. Inactive stages are skipped by the dynamic routing functions (`resolvePrerequisite`, `resolveNextAgent`). The "last active stage" agent — whichever stage appears last in the WP's active ordering — is the agent that can mark the WP as COMPLETE (see [§6.2](state-machines.md#62-transition-table)).

### 4.1 Pipeline Ownership

Six of the nine roles own pipeline types:

| Pipeline Type | Owning Agent |
|--------------|-------------|
| `implementation` | Developer |
| `qa` | QA |
| `security-audit` | Security Auditor |
| `code-review` | Reviewer |
| `release-engineering` | Release Engineer |
| `documentation` | Documentation |

All six stages are PM-composable — no stage is inherently mandatory or optional. The default set (`DEFAULT_PIPELINE_STAGES`) provides backward compatibility. Planner, Project Manager, and Synthesis do not own any pipeline type.

### 4.2 Pipeline Stage Constants

```
DEFAULT_PIPELINE_STAGES     = ["implementation", "qa", "code-review", "documentation"]
CANONICAL_PIPELINE_ORDERING = ["implementation", "qa", "security-audit", "code-review", "release-engineering", "documentation"]
```

`CANONICAL_PIPELINE_ORDERING` defines the fixed sequence in which pipeline types execute. A work package's `active_pipeline_stages` is always a subsequence of this ordering — any stage may be omitted, but the relative order must never change.

`DEFAULT_PIPELINE_STAGES` is the backward-compatible default applied when `active_pipeline_stages` is absent or `null`. It corresponds to the 4-stage chain used by all ledgers created before composable stages were introduced.

> **Removed constants:** The former `MANDATORY_PIPELINE_TYPES` and `OPTIONAL_PIPELINE_TYPES` constants are retired. All six stages are now PM-composable — the PM selects any valid subsequence of the canonical ordering. The validation function ([§9b.2](operations.md#9b2-active-pipeline-stages-validation)) enforces structural correctness (valid types, no duplicates, canonical order) and emits soft guardrail warnings for unusual compositions, but does not reject any particular subset.

**Common composition patterns:**

| Pattern | `active_pipeline_stages` | Use Case |
|---------|-------------------------|----------|
| Default (4 stages) | `["implementation", "qa", "code-review", "documentation"]` | Standard development WP |
| Full (6 stages) | `["implementation", "qa", "security-audit", "code-review", "release-engineering", "documentation"]` | Security-critical release |
| Documentation-only | `["documentation"]` | Pure documentation task |
| Verification-only | `["implementation", "qa", "code-review"]` | Spike/prototype; no docs needed |
| Security-focused | `["implementation", "qa", "security-audit", "code-review", "documentation"]` | Security audit without release engineering |
| Quick fix | `["implementation", "qa", "documentation"]` | Fast-track fix; skip code review |
