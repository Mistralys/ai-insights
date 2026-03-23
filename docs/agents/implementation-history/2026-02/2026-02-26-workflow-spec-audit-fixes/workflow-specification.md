# Agent Workflow Specification

> **Version:** 1.1.0  
> **Date:** 2026-02-26  
> **Scope:** Language-agnostic, logic-only specification of the multi-agent ledger workflow.  
> **Audience:** Anyone implementing the workflow engine in a new language or runtime.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Glossary](#2-glossary)
3. [Entity Model](#3-entity-model)
4. [Agent Roles](#4-agent-roles)
5. [Project Lifecycle](#5-project-lifecycle)
6. [Work Package State Machine](#6-work-package-state-machine)
7. [Pipeline State Machine](#7-pipeline-state-machine)
8. [Pipeline Ordering & Prerequisites](#8-pipeline-ordering--prerequisites)
9. [Pipeline Routing Maps](#9-pipeline-routing-maps)
10. [Handoff Logic](#10-handoff-logic)
11. [Supervisor Routing Algorithm](#11-supervisor-routing-algorithm)
12. [Dependency Management](#12-dependency-management)
13. [Rework & Failure Handling](#13-rework--failure-handling)
14. [Counter Self-Healing](#14-counter-self-healing)
15. [Auto-Handoff Depth Guard](#15-auto-handoff-depth-guard)
16. [Authorization & Agent Guards](#16-authorization--agent-guards)
17. [Concurrency & Atomicity](#17-concurrency--atomicity)
18. [Edge Cases & Gotchas](#18-edge-cases--gotchas)
19. [Full Workflow Walkthrough](#19-full-workflow-walkthrough)
20. [Next-Action Priority Algorithm](#20-next-action-priority-algorithm)
21. [Handoff Decision Trees](#21-handoff-decision-trees)
22. [Batch Next-Action Algorithm](#22-batch-next-action-algorithm)
23. [Storage Layout & Project Detection](#23-storage-layout--project-detection)
24. [Auto-Handoff Response Protocol](#24-auto-handoff-response-protocol)

---

## 1. Overview

The system orchestrates a **7-stage software development workflow** across specialized AI agents. A **centralized ledger** maintains all state — project metadata, work packages, pipelines, handoff notes, and comments. Agents interact with the ledger exclusively through a typed tool interface (MCP protocol in the reference implementation).

The workflow follows a **hub-and-spoke topology**:

```
START → Supervisor
            ↓ (routes to next stage)
    ┌───────────────────────────────┐
    │ PM ──────────► Supervisor     │
    │ Developer ───► Supervisor     │  ← loop stages
    │ QA ──────────► Supervisor     │
    │ Reviewer ────► Supervisor     │
    │ Docs ────────► Supervisor     │
    └───────────────────────────────┘
    Synthesis ──────► END             ← terminal stage
```

Each non-terminal stage completes and returns control to the Supervisor, which reads ledger state and deterministically routes to the next stage. No LLM calls are involved in routing.

---

## 2. Glossary

| Term | Definition |
|------|-----------|
| **Ledger** | The centralized, persistent data store holding all project and workflow state. |
| **Root Index** | The top-level ledger file for a project, containing metadata, counters, WP summaries, and project comments. |
| **Work Package (WP)** | A discrete unit of work with acceptance criteria, dependencies, and a pipeline history. Identified by `WP-###` format (3+ digits). |
| **Pipeline** | A single execution pass of a specific type (implementation, QA, code-review, documentation) within a WP. |
| **Handoff** | The structured transfer of control from one agent to the next, including notes and context. |
| **Rework** | Restarting a failed pipeline, incrementing the WP's rework counter. |
| **Terminal Status** | A status from which no outward transitions are allowed: `COMPLETE` and `CANCELLED`. |
| **Slug** | A URL-safe identifier derived from the plan folder name (e.g., `2026-02-16-feature`). |

---

## 3. Entity Model

### 3.1 Root Index (Project)

```
RootIndex {
    plan_file:              string          // path to the plan document
    date_created:           timestamp       // UTC ISO 8601
    last_updated:           timestamp       // UTC ISO 8601
    status:                 ProjectStatus   // READY | IN_PROGRESS | COMPLETE | BLOCKED
    total_work_packages:    integer
    pending_work_packages:  integer         // count of non-terminal WPs
    work_packages:          WorkPackageSummary[]
    project_comments:       ProjectComment[]
    auto_handoff_depth:     integer?        // default 0 when absent
    synthesis_generated:    boolean?        // default false when absent
}
```

### 3.2 Work Package Summary (embedded in Root Index)

```
WorkPackageSummary {
    work_package_id:    string              // WP-### format
    status:             WorkPackageStatus
    assigned_to:        string              // agent role name
    dependencies:       string[]            // array of WP IDs
    file:               string              // path to detail file
}
```

### 3.3 Work Package Detail

```
WorkPackageDetail {
    work_package_id:        string
    work_package_file:      string          // reference to the MD specification
    status:                 WorkPackageStatus
    assigned_to:            string
    dependencies:           string[]
    blocked_by:             Blocker?
    acceptance_criteria:    AcceptanceCriterion[]  // min 1 entry
    revision:               integer         // starts at 0; incremented on COMPLETE → IN_PROGRESS
    rework_count:           integer?        // absent until first rework; incremented on pipeline retry after FAIL
    handoff_notes:          HandoffNote[]?
    pipelines:              Pipeline[]
}
```

### 3.4 Pipeline

```
Pipeline {
    type:           PipelineType            // implementation | qa | code-review | documentation
    status:         PipelineStatus          // IN_PROGRESS | PASS | FAIL
    started_at:     timestamp?
    completed_at:   timestamp?
    summary:        string[]
    artifacts:      Artifacts?
    metrics:        Metrics?                // extensible key-value (passthrough)
    comments:       PipelineComment[]?
}
```

### 3.5 Supporting Types

```
AcceptanceCriterion {
    criterion:  string
    met:        boolean
}

Blocker {
    type:                   BlockerType     // dependency | decision | external | technical
    description:            string
    blocking_work_package:  string?         // WP-### format
}

HandoffNote {
    from_agent:     string
    to_agent:       string
    timestamp:      timestamp
    notes:          string[]
}

Artifacts {
    files_modified:     string[]?
    commit_hash:        string?
    pull_request:       string?
}

Metrics {
    test_coverage:      string?
    tests_passed:       integer?
    tests_failed:       integer?
    security_issues:    integer?
    [key]:              any                 // extensible
}

ProjectComment {
    type:       string                      // e.g. "incident", "note", "decision"
    priority:   Priority                    // low | medium | high
    timestamp:  timestamp
    agent:      string
    note:       string
    context:    IncidentContext?             // required when type == "incident"
}

PipelineComment {
    type:       string
    priority:   Priority
    timestamp:  timestamp
    note:       string
}

IncidentContext {
    os:             string
    tool:           string
    work_package:   string?
    resolved:       boolean
    workaround:     string?
}
```

---

## 4. Agent Roles

The system defines exactly **7 agent roles**. This list is the single source of truth.

| # | Role | Responsibility |
|---|------|---------------|
| 1 | **Planner** | Creates the high-level implementation plan from the user request. Operates before the ledger is initialized. |
| 2 | **Project Manager** | Breaks the plan into work packages, initializes the ledger, manages blockers. |
| 3 | **Developer** | Implements work packages and performs rework after QA/review failures. |
| 4 | **QA** | Validates acceptance criteria, runs tests. |
| 5 | **Reviewer** | Performs code quality, security, and architecture review. |
| 6 | **Documentation** | Updates project documentation; the sole agent authorized to mark WPs `COMPLETE`. |
| 7 | **Synthesis** | Generates the final project report once all WPs are terminal. |

**Important:** Agent role name matching MUST be case-sensitive and exact. The system also recognizes `"<Role> Agent"` suffix variants (e.g., `"Documentation Agent"`) for backward compatibility in authorization guards.

---

## 5. Project Lifecycle

### 5.1 Project Status Values

```
ProjectStatus = READY | IN_PROGRESS | COMPLETE | BLOCKED
```

### 5.2 Project Status Flow

```
               ┌──────────────────────────────────────────────────┐
               │                                                  │
  Initialize → READY → IN_PROGRESS → COMPLETE                    │
                          │    ▲         │                        │
                          │    │         │  (if WPs reopened)     │
                          │    └─────────┘                        │
                          │                                       │
                          └──────► BLOCKED ───► IN_PROGRESS ──────┘
```

### 5.3 Project Completion Rules

A project transitions to `COMPLETE` when **all** of the following are true:
1. `pending_work_packages == 0`
2. At least one work package exists
3. `synthesis_generated == true`

The `ledger_complete_synthesis` tool sets `synthesis_generated = true` and conditionally transitions the project to `COMPLETE`.

### 5.4 Empty Project Rule

An empty project (no work packages) is **never** marked `COMPLETE`, regardless of other conditions.

---

## 6. Work Package State Machine

### 6.1 Status Values

```
WorkPackageStatus = READY | IN_PROGRESS | COMPLETE | BLOCKED | CANCELLED
```

### 6.2 Legal Transitions

| From | To | Conditions |
|------|----|-----------|
| `READY` | `IN_PROGRESS` | All dependencies are `COMPLETE` or `CANCELLED` |
| `READY` | `BLOCKED` | — |
| `READY` | `CANCELLED` | Agent must be **Project Manager** |
| `IN_PROGRESS` | `COMPLETE` | All acceptance criteria `met == true`; agent must be **Documentation** |
| `IN_PROGRESS` | `BLOCKED` | `blocked_by` field must be provided |
| `IN_PROGRESS` | `CANCELLED` | Agent must be **Project Manager** |
| `BLOCKED` | `IN_PROGRESS` | — (clears `blocked_by`) |
| `BLOCKED` | `READY` | All dependencies `COMPLETE` or `CANCELLED` (clears `blocked_by`) |
| `BLOCKED` | `CANCELLED` | Agent must be **Project Manager** |
| `COMPLETE` | `IN_PROGRESS` | Agent must be **Project Manager** or **Documentation**; increments `revision` |

**Terminal statuses:** `COMPLETE` and `CANCELLED` — no outward transitions from `CANCELLED`.

> **Edge case — vacuous-true unblocking:** When a WP is blocked for a non-dependency reason (e.g., `type: "decision"`) and has no WP dependencies, the condition "all dependencies COMPLETE or CANCELLED" is vacuously true. The PM should ensure `blocked_by` is explicitly cleared via a manual status transition (`BLOCKED → IN_PROGRESS`), not rely on automatic unblocking. The `propagateDependencyUnblock` function (§12.2) skips WPs whose `blocked_by.type` is not `"dependency"`.

### 6.3 Side Effects of Status Transitions

| Transition | Side Effect |
|-----------|-------------|
| Any → `COMPLETE` | Decrement `pending_work_packages`; trigger `propagateDependencyUnblock` |
| Any → `CANCELLED` | Decrement `pending_work_packages`; trigger `propagateDependencyUnblock` (CANCELLED satisfies dependencies) |
| `COMPLETE` → `IN_PROGRESS` | Increment `revision`; increment `pending_work_packages`; trigger `propagateDependencyReblock` |
| `BLOCKED` → `IN_PROGRESS` | Clear `blocked_by` field |
| `BLOCKED` → `READY` | Clear `blocked_by` field |
| Any → `BLOCKED` | Set `blocked_by` field (required) |

### 6.4 Initial Status on Creation

When creating a work package:
- **Dependencies empty or all `COMPLETE`/`CANCELLED`:** initial status = `READY`
- **Any dependency not terminal:** initial status = `BLOCKED`

---

## 7. Pipeline State Machine

### 7.1 Status Values

```
PipelineStatus = IN_PROGRESS | PASS | FAIL
```

Pipelines are **always created** with status `IN_PROGRESS`. There is no `READY` status for pipelines.

### 7.2 Transitions

```
IN_PROGRESS → PASS
IN_PROGRESS → FAIL
```

No other transitions are valid. Once a pipeline is `PASS` or `FAIL`, it is immutable. A new pipeline instance is created for rework.

### 7.3 Cancellation

Cancelling a pipeline sets its status to `FAIL` with the cancellation reason as the summary. This is semantically equivalent to failure — it allows a new pipeline to be started.

---

## 8. Pipeline Ordering & Prerequisites

Pipelines within a work package MUST follow this strict order:

```
implementation → qa → code-review → documentation
```

### 8.1 Prerequisite Table

| Pipeline Type | Prerequisite |
|---------------|-------------|
| `implementation` | None (can always start) |
| `qa` | Most recent `implementation` pipeline must be `PASS` |
| `code-review` | Most recent `qa` pipeline must be `PASS` |
| `documentation` | Most recent `code-review` pipeline must be `PASS` |

### 8.2 Enforcement Rules

- A pipeline can only be started on a WP with status `IN_PROGRESS` (constraint 17).
- Only one pipeline of a given type can be `IN_PROGRESS` at a time per WP (constraint 18).
- The prerequisite check examines the **most recent** pipeline of the prerequisite type.

---

## 9. Pipeline Routing Maps

These maps define the deterministic routing of work between agents.

### 9.1 Pipeline Agent Map (ownership)

Maps each pipeline type to the agent responsible for executing it.

| Pipeline Type | Owner Agent |
|---------------|------------|
| `implementation` | Developer |
| `qa` | QA |
| `code-review` | Reviewer |
| `documentation` | Documentation |

**Side effect:** When a pipeline starts, the WP's `assigned_to` field is automatically updated to the owner agent.

### 9.2 Next Agent Map (PASS routing)

Maps each pipeline type to the next agent in the chain after a `PASS` result.

| Pipeline Type | Next Agent (on PASS) |
|---------------|---------------------|
| `implementation` | QA |
| `qa` | Reviewer |
| `code-review` | Documentation |
| `documentation` | Synthesis |

### 9.3 Fail Routing Map (FAIL routing)

Maps each pipeline type to the agent responsible for fixing failures.

| Pipeline Type | Rework Agent (on FAIL) |
|---------------|----------------------|
| `implementation` | Developer |
| `qa` | Developer |
| `code-review` | Developer |
| `documentation` | Documentation |

**Key insight:** Documentation is the only pipeline type with **self-rework** on failure. All other failures route back to the Developer.

### 9.4 Inverse Agent-Pipeline Map

Maps each agent to the pipeline type they own. Derived from the Pipeline Agent Map.

| Agent | Owned Pipeline |
|-------|---------------|
| Developer | `implementation` |
| QA | `qa` |
| Reviewer | `code-review` |
| Documentation | `documentation` |

---

## 10. Handoff Logic

### 10.1 Handoff Note Creation

When a pipeline is completed with `handoff_notes`, the system creates a `HandoffNote`:

```
from_agent = PIPELINE_AGENT_MAP[pipeline_type]
to_agent   = (status == FAIL) ? FAIL_ROUTING_MAP[pipeline_type] 
                               : NEXT_AGENT_MAP[pipeline_type]
```

### 10.2 Handoff Note Consumption

When an agent queries for their next action (`get_next_action` / `get_next_actions`), any handoff notes addressed to that agent are included in the response.

### 10.3 Handoff Status Computation

Each agent has specific logic to determine whether a handoff to the next stage is warranted:

| Current Agent | Handoff Status | Condition |
|--------------|---------------|-----------|
| Developer | `READY_FOR_QA` | Any WP has implementation PASS and needs QA |
| Developer | `READY_FOR_SYNTHESIS` | All WPs are terminal |
| QA | `READY_FOR_DEVELOPER` | Only FAIL QA pipelines remain |
| QA | `READY_FOR_REVIEW` | WPs with PASS QA need review (excluding dependency-blocked WPs) |
| Reviewer | `READY_FOR_DEVELOPER` | Only FAIL code-review pipelines remain |
| Reviewer | `READY_FOR_DOCUMENTATION` | WPs with PASS review need documentation (excluding dependency-blocked WPs) |
| Documentation | `READY_FOR_DEVELOPER` | Undocumented WPs exist that are not dependency-blocked |
| Documentation | `READY_FOR_SYNTHESIS` | All undocumented WPs are dependency-blocked |

**Dependency-blocked exclusion rule:** QA, Reviewer, and Documentation handoff functions treat WPs blocked by incomplete dependencies as ineligible for their stage. If all remaining WPs are dependency-blocked, the handoff routes forward (toward Synthesis) rather than backward (toward Developer).

---

## 11. Supervisor Routing Algorithm

The Supervisor is the central router. It is **deterministic** — no LLM calls, only ledger state inspection.

### 11.1 Routing Decision Tree

```
function route(state):
    iteration += 1

    IF iteration > max_iterations:
        → END (safety limit)

    read project status from ledger
    read WP summaries from ledger

    IF no WPs exist:
        → PM (create work packages)

    IF all WPs are terminal (COMPLETE or CANCELLED):
        → Synthesis

    collect actionable WPs (IN_PROGRESS first, then READY)

    IF no actionable WPs and all remaining are BLOCKED:
        → END (deadlock)

    IF no actionable WPs and mixed state:
        → Synthesis

    FOR each actionable WP:
        IF circuit_breaker(wp_id) >= 3:
            skip, log warning
            continue

        read WP detail from ledger
        destination = route_for_wp(wp_detail)

        IF destination is DONE:
            continue (WP fully processed)

        IF destination is IN_FLIGHT:
            skip (pipeline running)
            continue

        → destination (route to that stage)

    IF all actionable WPs were skipped (in-flight or circuit-broken):
        → END (halt)

    → Synthesis (all actionable WPs processed)
```

### 11.2 Per-WP Routing Decision (`route_for_wp`)

For a single work package, inspect pipeline state top-to-bottom:

```
function route_for_wp(wp_detail):
    impl = latest_pipeline_status("implementation")
    qa   = latest_pipeline_status("qa")
    cr   = latest_pipeline_status("code-review")
    doc  = latest_pipeline_status("documentation")

    IF no pipelines OR impl is null:        → Developer
    IF impl == IN_PROGRESS:                 → SKIP (in-flight)
    IF impl == FAIL:                        → Developer
    IF impl == PASS AND qa is null:         → QA
    IF qa == IN_PROGRESS:                   → SKIP (in-flight)
    IF qa == FAIL:                          → Developer
    IF qa == PASS AND cr is null:           → Reviewer
    IF cr == IN_PROGRESS:                   → SKIP (in-flight)
    IF cr == FAIL:                          → Developer
    IF cr == PASS AND doc is null:          → Documentation
    IF doc == IN_PROGRESS:                  → SKIP (in-flight)
    IF doc == FAIL:                         → Documentation (self-rework)
    IF all pipelines PASS:                  → DONE (WP complete)
```

### 11.3 Circuit Breaker

The Supervisor tracks consecutive failures per WP:
- On stage failure (`stage_success == false`): increment `consecutive_failures[wp_id]`
- On stage success: reset `consecutive_failures[wp_id]` to 0
- **Threshold: 3** — after 3 consecutive failures, the WP is halted and skipped

#### 11.3.1 Defining `stage_success`

A stage is considered successful (`stage_success = true`) if the agent node completed without raising an error AND at least one pipeline was completed with status `PASS` during the agent's turn. If the agent raised an error, produced no pipeline completions, or only produced `FAIL` pipeline completions, `stage_success = false`.

### 11.4 Safety Limit

A configurable `max_iterations` (default: 100) caps the total Supervisor routing cycles. Exceeding this limit terminates the graph with an error.

---

## 12. Dependency Management

### 12.1 Dependency Validation

- All dependency IDs must exist in the root index before a WP is created.
- A WP can only transition from `READY` to `IN_PROGRESS` if all its dependencies are `COMPLETE` or `CANCELLED`.

### 12.2 Dependency Auto-Unblocking (`propagateDependencyUnblock`)

Triggered when a WP transitions to `COMPLETE` or `CANCELLED`:

```
function propagateDependencyUnblock(completedWpId):
    acquire lock
    read root index
    FOR each BLOCKED WP that lists completedWpId as a dependency:
        read WP detail
        IF blocked_by exists AND blocked_by.type != "dependency":
            skip (non-dependency blocker; do not auto-unblock)
            continue
        IF all dependencies are COMPLETE or CANCELLED:
            transition WP from BLOCKED → READY
            clear blocked_by field
            update root index summary
            write both files
    release lock
```

> **Guard:** Only WPs whose `blocked_by.type` is `"dependency"` (or whose `blocked_by` is absent) are eligible for auto-unblocking. WPs blocked for non-dependency reasons (`decision`, `external`, `technical`) are skipped even when all their WP dependencies are satisfied.

### 12.3 Dependency Re-blocking (`propagateDependencyReblock`)

Triggered when a `COMPLETE` WP is reopened (`COMPLETE` → `IN_PROGRESS`):

```
function propagateDependencyReblock(reopenedWpId):
    acquire lock
    read root index
    FOR each non-COMPLETE, non-CANCELLED, non-BLOCKED WP that depends on reopenedWpId:
        read WP detail
        transition to BLOCKED
        set blocked_by = { type: "dependency", blocking_work_package: reopenedWpId }
        update root index
        write WP detail
    recompute pending_work_packages
    write root index
    release lock
```

### 12.4 Both Terminal Statuses Satisfy Dependencies

`COMPLETE` and `CANCELLED` both satisfy dependency requirements. A WP whose only dependency was `CANCELLED` will be unblocked to `READY`.

---

## 13. Rework & Failure Handling

### 13.1 Rework Count

The `rework_count` field on a WP tracks how many times a pipeline was restarted after a FAIL:
- **Absent** until first rework (never initialized to 0).
- Incremented when `start_pipeline` is called and the most recent pipeline of that same type has status `FAIL`.
- A history of `[FAIL, PASS]` does **not** increment on the next start — only `[..., FAIL]` triggers increment.

### 13.2 Rework Circuit Breaker

- **Threshold:** `MAX_REWORK_COUNT = 5` (configurable constant)
- After incrementing, if `rework_count >= MAX_REWORK_COUNT`, the `start_pipeline` call is **rejected**.
- The `get_next_action` tool surfaces `BLOCK_FOR_REWORK_LIMIT` as the highest-priority action for affected WPs.
- **Resolution:** The PM must cancel or restructure the WP.

### 13.3 Most-Recent Pipeline Semantics

All rework and routing decisions are based on the **most recent** pipeline of a given type:

| Pipeline History | Interpretation |
|-----------------|---------------|
| `[]` (empty) | No work done yet |
| `[FAIL]` | Rework needed |
| `[PASS]` | Stage complete |
| `[FAIL, PASS]` | Issue resolved (no rework needed) |
| `[PASS, FAIL]` | Regression — rework needed |

### 13.4 Stale Pipeline Detection

A pipeline is considered **stale** if it is `IN_PROGRESS` and was started more than `STALE_PIPELINE_HOURS` (default: 24) hours ago.

When detected:
- `get_next_action` returns `RESUME_OR_CANCEL` with the pipeline type, start time, and age in hours.
- The agent should either resume working on the pipeline or cancel it via `cancel_pipeline`.
- Cancelling sets the pipeline to `FAIL`, allowing a fresh pipeline to be started.

### 13.5 Upstream Rework Re-engagement

When a downstream agent (QA, Reviewer, Documentation) checks for work, it also checks whether a new upstream `PASS` pipeline has been completed **after** its own most recent pipeline started. If so, it re-engages with the WP.

```
function hasNewUpstreamPassSince(pipelines, upstreamType, downstreamType):
    upstreamPass = most recent PASS pipeline of upstreamType
    downstreamStart = most recent pipeline of downstreamType (any status)

    IF no upstream PASS:      return false
    IF no downstream:         return true  (first run)
    IF upstreamPass.completed_at > downstreamStart.started_at:
        return true           (rework re-engagement)
    ELSE:
        return false          (downstream is up to date)
```

Uses strict `>` comparison; same-second timestamps return `false`.

---

## 14. Counter Self-Healing

The `get_project_status` tool automatically corrects drifted counters and project status.

### 14.1 Computation (Pure Function)

```
function computeHealedStatus(rootIndex):
    totalWps = rootIndex.work_packages.length
    pendingWps = count where status NOT IN (COMPLETE, CANCELLED)

    healedStatus = rootIndex.status  // start with current

    // Rules applied in order; first match wins:
    IF status == READY AND any WP is IN_PROGRESS:
        healedStatus = IN_PROGRESS
    ELSE IF status == BLOCKED AND no WP is BLOCKED:
        healedStatus = (pendingWps > 0) ? IN_PROGRESS : READY
    ELSE IF (status == IN_PROGRESS OR status == READY) AND pendingWps == 0 AND totalWps > 0 AND synthesis_generated:
        healedStatus = COMPLETE
    ELSE IF status == COMPLETE AND pendingWps > 0:
        healedStatus = IN_PROGRESS

    needsWrite = (totalWps != rootIndex.total_work_packages
               OR pendingWps != rootIndex.pending_work_packages
               OR healedStatus != rootIndex.status)

    return { totalWps, pendingWps, healedStatus, needsWrite }
```

### 14.2 Write Protocol

If `needsWrite`:
1. Acquire lock
2. Re-read root index (fresh copy)
3. Recompute healing on fresh data
4. If still `needsWrite`: apply corrections and write
5. Release lock

This double-check prevents races between the initial read and the corrective write.

### 14.3 Invariants

- Empty project (no WPs) is **never** auto-healed to `COMPLETE`.
- `(IN_PROGRESS or READY)` with `pendingWps == 0` stays `IN_PROGRESS` / `READY` if `synthesis_generated` is absent/false (mirrors the §14.1 pseudocode condition).
- Only the first matching healing rule fires.

---

## 15. Auto-Handoff Depth Guard

Prevents infinite agent-chain loops in IDE-driven auto-handoff scenarios.

### 15.1 Storage

`auto_handoff_depth` field on the root index. Optional; absent treated as `0`.

### 15.2 Constants

- `MAX_HANDOFF_DEPTH`: default 10 (runtime-configurable via config file)

### 15.3 Increment Path (normal handoff)

On a successful handoff response where auto-handoff is eligible:
1. Read `currentDepth` from root index (default 0)
2. If `currentDepth < MAX_HANDOFF_DEPTH`: increment and write; include `auto_handoff` in response
3. If `currentDepth >= MAX_HANDOFF_DEPTH`: omit `auto_handoff` from response (chain terminated silently)

### 15.4 Reset Path

When project status reaches `COMPLETE`:
- If `auto_handoff_depth != 0`: reset to `0` and write
- Otherwise: no-op

### 15.5 Auto-Handoff Eligibility

All of the following must be true:
1. Auto-handoff is enabled in config
2. Agent registry is loaded (agent file discovery completed)
3. Next agent has a known handle in the registry
4. Handoff status is not `COMPLETE`, `BLOCKED`, `IN_PROGRESS`, or `WAIT` (i.e., only `READY_FOR_*` handoff statuses are eligible for auto-handoff)

   > **Note:** This refers to the handoff status value returned by `get_handoff_status`, NOT the `ProjectStatus` enum.

5. `auto_handoff_depth < MAX_HANDOFF_DEPTH`

---

## 16. Authorization & Agent Guards

### 16.1 COMPLETE Transition Guard

Only **Documentation** (or `"Documentation Agent"`) can set a WP to `COMPLETE`.

```
IF new_status == COMPLETE AND agent NOT IN ("Documentation", "Documentation Agent"):
    REJECT with error: "Only the Documentation agent may mark WPs COMPLETE.
    Workflow order: Developer → QA → Reviewer → Documentation → COMPLETE"
```

### 16.2 Reopening Guard

Only **Project Manager** or **Documentation** can transition `COMPLETE → IN_PROGRESS`.

```
IF old_status == COMPLETE AND new_status == IN_PROGRESS
   AND agent NOT IN ("Project Manager", "Project Manager Agent",
                      "Documentation", "Documentation Agent"):
    REJECT with error
```

### 16.3 Cancellation Guard

Only **Project Manager** can transition any status → `CANCELLED`.

```
IF new_status == CANCELLED
   AND agent NOT IN ("Project Manager", "Project Manager Agent"):
    REJECT with error
```

### 16.4 Claim Override Guard

When claiming a WP assigned to a different agent, `override: true` is required. Override authorization:
- **Project Manager**: always allowed
- **Current assignee** (`wp.assigned_to`): allowed
- **Anyone else**: rejected even with `override: true`

If `wp.assigned_to` is unset, no identity check is performed.

### 16.5 Pipeline Agent Role Validation

When starting a pipeline with an explicit `agent_role`, it must match the Pipeline Agent Map:

```
IF agent_role is provided AND agent_role != PIPELINE_AGENT_MAP[pipeline_type]:
    REJECT with error
```

If `agent_role` is omitted, no role check is performed (backward compatible).

---

## 17. Concurrency & Atomicity

### 17.1 File Locking

- Lock file location: `{storageDir}/.lock`
- Stale lock timeout: **10 seconds**
- Retry count: **50** with 200ms–1000ms exponential backoff
- Total retry window: ~10–50 seconds

### 17.2 Atomic Write Pattern

All file writes follow:
1. Write to `{file}.tmp.{pid}`
2. Atomically rename to target file
3. Ensure directory exists before writing
4. Pretty-print JSON (2-space indent, trailing newline)

### 17.3 Dual-File Update Pattern

When both root index and WP detail must be updated:
1. Acquire lock on `storageDir`
2. Read both files (with Zod/schema validation)
3. Apply update logic
4. Validate updated data
5. Write both files atomically
6. Sync `.meta.json`
7. Release lock in `finally` block

### 17.4 Dependency Propagation Lock Scope

`propagateDependencyUnblock` and `propagateDependencyReblock` run **after** the main lock is released and acquire their own separate locks. This creates a brief window of inconsistency — safe for single-user workflows.

### 17.5 Schema Validation

- **All reads** are validated against the schema before returning data.
- **All writes** are validated against the schema before writing to disk.
- Failure modes: file not found → error; malformed JSON → error; schema mismatch → error.

---

## 18. Edge Cases & Gotchas

### 18.1 WP ID Generation

IDs are generated by scanning the highest existing numeric suffix and adding 1 (max-based), not by array length. This means:
- Deleted WPs do not cause ID collisions
- IDs are monotonically increasing but may have gaps
- IDs support 3+ digits: `WP-001` through `WP-9999+`

### 18.2 Acceptance Criteria: At Least One Required

The `create_work_package` tool rejects empty `acceptance_criteria` arrays. At least one criterion must be provided.

### 18.3 Acceptance Criteria Update Merge Semantics

When completing a pipeline with `acceptance_criteria_updates`:
- **Known criterion text** → update the `met` flag
- **Unknown criterion text** → **append** as a new entry

### 18.4 Revision vs. Rework Count

| Field | Triggers | Meaning |
|-------|---------|---------|
| `revision` | `COMPLETE → IN_PROGRESS` transition | Number of times a WP was reopened after being marked complete |
| `rework_count` | Pipeline restart after most recent same-type FAIL | Number of pipeline retry cycles within a single WP lifecycle |

### 18.5 Lock File Persistence

Lock files are not automatically deleted on server exit. They persist on disk and are overwritten on the next lock acquisition. The stale-lock mechanism handles this safely.

### 18.6 Metrics Extensibility

The `metrics` object accepts additional arbitrary keys beyond the predefined schema fields.

### 18.7 Pipeline Comments Have No Agent Field

Pipeline-level comments do not include an `agent` field — the agent is inferred from the pipeline type via the Pipeline Agent Map. Only project-level comments have an explicit `agent` field.

### 18.8 Incident Comments Require Context

A `ProjectComment` with `type == "incident"` must include the `context` field with `os`, `tool`, and `resolved` at minimum.

### 18.9 Timestamp Format

All timestamps: UTC ISO 8601 with trailing `Z`: `YYYY-MM-DDTHH:MM:SSZ`

Legacy backward compatibility: parsers should also accept `YYYY-MM-DD HH:MM:SS` and `YYYY-MM-DDTHH:MM:SS` (without Z).

### 18.10 Summary Duplication Invariant

WP summaries in the root index duplicate a subset of data from the WP detail files. The invariant: summaries must always match corresponding detail files. All update operations that touch either must update both atomically.

---

## 19. Full Workflow Walkthrough

This section traces a complete project through the workflow, covering the happy path and common rework scenarios.

### 19.1 Happy Path (Single WP)

```
1. User describes a feature request
2. Planner creates plan document (no ledger interaction)
3. PM initializes ledger (creates root index with status=READY)
4. PM creates WP-001 (status=READY, no dependencies)
   └─ Root index: total=1, pending=1, status=IN_PROGRESS
5. Developer claims WP-001 (READY → IN_PROGRESS)
6. Developer starts implementation pipeline (IN_PROGRESS)
   └─ WP assigned_to = "Developer"
7. Developer completes implementation pipeline (PASS)
   └─ Handoff note: Developer → QA
8. QA starts qa pipeline (prerequisite: implementation PASS ✓)
   └─ WP assigned_to = "QA"
9. QA completes qa pipeline (PASS)
   └─ Handoff note: QA → Reviewer
10. Reviewer starts code-review pipeline (prerequisite: qa PASS ✓)
    └─ WP assigned_to = "Reviewer"
11. Reviewer completes code-review pipeline (PASS)
    └─ Handoff note: Reviewer → Documentation
12. Documentation starts documentation pipeline (prerequisite: code-review PASS ✓)
    └─ WP assigned_to = "Documentation"
13. Documentation completes documentation pipeline (PASS)
    └─ Handoff note: Documentation → Synthesis
14. Documentation updates WP-001 status (IN_PROGRESS → COMPLETE)
    └─ All acceptance criteria met ✓; Documentation agent ✓
    └─ pending_work_packages decremented to 0
15. Synthesis generates report
16. Synthesis calls complete_synthesis
    └─ synthesis_generated = true
    └─ Project status = COMPLETE (pending==0, WPs exist, synthesis done)
```

### 19.2 QA Failure & Rework

```
... steps 1-7 as above ...
8. QA starts qa pipeline
9. QA completes qa pipeline (FAIL)
   └─ Handoff note: QA → Developer (via FAIL_ROUTING_MAP)
10. Developer starts new implementation pipeline
    └─ Most recent implementation was PASS → rework_count NOT incremented
    └─ (Since the most recent implementation pipeline completed with PASS, `rework_count` is not
       incremented when the Developer starts a new implementation pipeline in response to QA failure.
       The Developer acts on the QA FAIL result directly.)
11. Developer completes implementation pipeline (PASS)
12. QA starts qa pipeline (prerequisite: implementation PASS ✓)
    └─ Most recent qa was FAIL → rework_count incremented by 1
13. QA completes qa pipeline (PASS)
    └─ Continue to Reviewer...
```

### 19.3 Multi-WP with Dependencies

```
PM creates:
  WP-001: dependencies=[]        → status=READY
  WP-002: dependencies=[WP-001]  → status=BLOCKED
  WP-003: dependencies=[]        → status=READY

Supervisor routes:
  1. WP-001 → Developer (READY, no deps)
  2. WP-003 → Developer (READY, no deps, independent)
     ↑ Can be processed in parallel if platform supports it

When WP-001 reaches COMPLETE:
  propagateDependencyUnblock triggers:
    WP-002: all deps COMPLETE? → yes → BLOCKED → READY

Supervisor routes:
  3. WP-002 → Developer (now READY)
```

### 19.4 WP Reopening Cascade

```
All WPs complete: WP-001(COMPLETE), WP-002(COMPLETE, depends on WP-001)

PM reopens WP-001 (COMPLETE → IN_PROGRESS):
  1. WP-001.revision incremented
  2. WP-001.pending_work_packages incremented
  3. propagateDependencyReblock:
     WP-002 depends on WP-001
     WP-002 is COMPLETE → not reblocked (COMPLETE is excluded from reblocking)
     ↑ Only non-COMPLETE, non-CANCELLED, non-BLOCKED WPs are reblocked

If WP-002 was IN_PROGRESS instead:
  WP-002 → BLOCKED (blocked_by: {type: "dependency", blocking_work_package: "WP-001"})
```

### 19.5 Rework Circuit Breaker

```
WP-001 fails implementation 5 times:
  Attempt 1: implementation FAIL → rework_count=1
  Attempt 2: implementation FAIL → rework_count=2
  Attempt 3: implementation FAIL → rework_count=3
  Attempt 4: implementation FAIL → rework_count=4
  Attempt 5: implementation FAIL → rework_count=5
  Attempt 6: start_pipeline REJECTED (rework_count >= MAX_REWORK_COUNT)
  
  get_next_action returns: BLOCK_FOR_REWORK_LIMIT
  PM must cancel or restructure the WP
```

---

## 20. Next-Action Priority Algorithm

The `get_next_action` tool recommends the **single highest-priority action** for a given agent role. The priority ordering is strict — the first matching condition wins.

### 20.1 Pre-Routing Checks (All Agents)

Before agent-specific logic, apply these checks in order:

```
function getNextAction(project_path, agent_role):
    validate agent_role ∈ AGENT_ROLES

    rootIndex = readRootIndex(project_path)

    IF rootIndex.work_packages is empty:
        IF agent_role == "Project Manager":
            → CREATE_WORK_PACKAGES
        ELSE:
            → WAIT (no work packages yet)

    IF all WPs are terminal (COMPLETE or CANCELLED):
        IF agent_role == "Synthesis":
            IF rootIndex.synthesis_generated:
                → WAIT (synthesis already done)
            ELSE:
                → GENERATE_SYNTHESIS
        ELSE IF agent_role == "Project Manager":
            → SIGNAL_SYNTHESIS
        ELSE:
            → WAIT (project complete)

    # Agent-specific routing follows
```

### 20.2 Project Manager Priority

```
1. RESOLVE_BLOCKERS  — Any WP with status == BLOCKED
2. WAIT              — No PM action needed
```

### 20.3 Developer Priority

The Developer has the most complex priority chain because it handles both fresh implementation and rework from downstream failures.

```
1. BLOCK_FOR_REWORK_LIMIT — Any non-terminal, non-BLOCKED WP with
                             rework_count >= MAX_REWORK_COUNT (5)
2. RESUME_OR_CANCEL       — Any WP with stale IN_PROGRESS implementation
                             pipeline (>24h old)
3. IMPLEMENT              — First READY or IN_PROGRESS WP (not dependency-blocked)
                             with NO implementation pipeline at all
4. REWORK (impl fail)     — First non-BLOCKED WP where most recent
                             implementation pipeline is FAIL
5. REWORK (downstream)    — First WP with PASS implementation but most recent
                             qa or code-review pipeline is FAIL
                             (checked: qa first, then code-review)
6. WAIT                   — No actionable work
```

**Note on downstream rework (priority 5):** When QA or a Reviewer fails a WP, the Developer must create a **new implementation pipeline**, not restart the downstream pipeline. The handoff notes from the failing agent are included.

### 20.4 QA Priority

```
1. RESUME_OR_CANCEL  — Any WP with stale IN_PROGRESS qa pipeline (>24h)
2. RUN_QA            — First non-BLOCKED WP where:
                        hasNewUpstreamPassSince("implementation", "qa") is true
                        (covers both first-run and rework re-engagement)
3. WAIT (fail)       — Any non-BLOCKED WP with FAIL qa → "Developer must rework
                        the implementation before QA can retry"
4. WAIT              — No work available
```

**Key constraint:** QA does **not** self-rework. On QA failure, the QA agent returns WAIT and the Developer picks up the rework.

### 20.5 Reviewer Priority

```
1. RESUME_OR_CANCEL  — Any WP with stale IN_PROGRESS code-review pipeline (>24h)
2. RUN_REVIEW        — First non-BLOCKED WP where:
                        hasNewUpstreamPassSince("qa", "code-review") is true
3. WAIT (fail)       — Any non-BLOCKED WP with FAIL code-review → "Developer must
                        rework before Reviewer can retry"
4. WAIT              — No work available
```

**Key constraint:** Reviewer does **not** self-rework. Same pattern as QA.

### 20.6 Documentation Priority

```
1. RESUME_OR_CANCEL  — Any WP with stale IN_PROGRESS documentation pipeline (>24h)
2. MARK_COMPLETE     — Any IN_PROGRESS WP where ALL four pipeline types have
                        at least one PASS pipeline (implementation, qa,
                        code-review, documentation) — forgotten completion
3. WRITE_DOCS        — First non-BLOCKED WP where:
                        hasNewUpstreamPassSince("code-review", "documentation")
                        is true
4. REWORK            — First non-BLOCKED WP where most recent documentation
                        pipeline is FAIL (self-rework)
5. WAIT              — No work available
```

**Key difference from QA/Reviewer:** Documentation **does** self-rework (priority 4).

**MARK_COMPLETE (priority 2):** Catches an edge case where the Documentation agent completed all pipelines but forgot to transition the WP to COMPLETE. This is the only agent that can make this transition.

### 20.7 Synthesis / Planner

```
Synthesis (when not all WPs terminal):
  → WAIT ("Not all work packages are COMPLETE")

Planner:
  → Handled by pre-routing checks (no pipeline-level logic)
```

**Planner:** The Planner agent does not participate in pipeline-level routing. If WPs exist, it returns `WAIT`. The pre-routing checks (§20.1) handle the Planner's primary scenarios.

### 20.8 Action Types Reference

| Action | Emitted By | Meaning |
|--------|-----------|---------|
| `CREATE_WORK_PACKAGES` | PM | Empty project; decompose plan into WPs |
| `RESOLVE_BLOCKERS` | PM | Investigate and resolve a BLOCKED WP |
| `SIGNAL_SYNTHESIS` | PM | All WPs terminal; signal Synthesis agent |
| `IMPLEMENT` | Developer | Claim and implement a WP |
| `REWORK` | Developer, Documentation | Fix a failed pipeline |
| `BLOCK_FOR_REWORK_LIMIT` | Developer | WP hit max rework count; needs PM intervention |
| `RUN_QA` | QA | Execute QA pipeline |
| `RUN_REVIEW` | Reviewer | Execute code-review pipeline |
| `WRITE_DOCS` | Documentation | Execute documentation pipeline |
| `MARK_COMPLETE` | Documentation | All pipelines PASS but WP still IN_PROGRESS |
| `RESUME_OR_CANCEL` | Any pipeline agent | Stale pipeline (>24h) needs attention |
| `GENERATE_SYNTHESIS` | Synthesis | All WPs terminal; generate report |
| `WAIT` | Any | No actionable work for this agent |

---

## 21. Handoff Decision Trees

The `get_handoff_status` tool computes the routing status that determines which agent should work next. Each agent has a **decision tree** evaluated after pipeline completion.

### 21.1 Handoff Status Values

| Status | Meaning | Next Agent |
|--------|---------|------------|
| `READY_FOR_PM` | Planner has produced plan; PM should create work packages | Project Manager |
| `READY_FOR_DEVELOPER` | Implementation or rework needed | Developer |
| `READY_FOR_QA` | All implementations passed; QA needed | QA |
| `READY_FOR_REVIEW` | All QA passed; code review needed | Reviewer |
| `READY_FOR_DOCUMENTATION` | All reviews passed; docs needed | Documentation |
| `READY_FOR_SYNTHESIS` | All pipelines done; synthesis needed | Synthesis |
| `IN_PROGRESS` | Current agent still has work to do | Current agent (self) |
| `BLOCKED` | All remaining WPs blocked; PM needed | Project Manager |
| `COMPLETE` | Project fully complete | None |
| `WAIT` | Agent waiting for other stages | None |

### 21.2 Pre-Routing Block Check (All Agents)

Before agent-specific logic:

```
IF any WP is BLOCKED AND no WP is READY or IN_PROGRESS:
    → status: BLOCKED
    → next_agent: "Project Manager"
```

### 21.3 Planner Handoff

> **Note:** The pre-routing block check (§21.2) is evaluated before the agent-specific logic below. If §21.2 fires (all WPs BLOCKED), it takes precedence and the checks below do not run.

```
IF no WPs exist:
    → READY_FOR_PM ("Planner has produced plan; PM should create work packages")
IF any WP is READY or IN_PROGRESS:
    → READY_FOR_DEVELOPER
ELSE:
    → WAIT
```

### 21.4 Project Manager Handoff

```
IF any READY/IN_PROGRESS WP lacks an implementation pipeline:
    → READY_FOR_DEVELOPER
ELSE:
    → IN_PROGRESS
```

### 21.5 Developer Handoff

The Developer's handoff logic uses only **non-BLOCKED WPs** to determine progress.

```
nonBlockedWps = WPs where status ≠ BLOCKED

IF all nonBlockedWps have PASS implementation:
    → READY_FOR_QA

IF any nonBlockedWP either:
   - lacks any implementation pipeline, OR
   - has any FAIL implementation pipeline (not just most recent)
THEN:
    → IN_PROGRESS ("N WP(s) still need implementation or rework")
    → next_action: "Call get_next_action to find next WP"

ELSE:
    → READY_FOR_QA
```

**Note:** Developer handoff intentionally does NOT use `isMostRecentPipelineFail`. It checks for **any** FAIL pipeline because a WP with `[FAIL, IN_PROGRESS]` should still show as IN_PROGRESS.

### 21.6 QA Handoff

```
wpsWithImpl = WPs that have at least one PASS implementation pipeline
wpsStillNeedingImpl = WPs without any PASS implementation pipeline

allQaPassed = every wpsWithImpl has a PASS qa pipeline

# --- Branch 1: All implemented WPs passed QA ---
IF allQaPassed AND wpsWithImpl is non-empty:
    IF wpsStillNeedingImpl exist:
        readyWps = wpsStillNeedingImpl not blocked by dependencies
        blockedWps = wpsStillNeedingImpl blocked by dependencies

        IF readyWps is empty AND blockedWps is non-empty:
            → READY_FOR_REVIEW (proceed; blocked WPs can't progress now)
        ELSE:
            → READY_FOR_DEVELOPER (N WPs ready for implementation)
    ELSE:
        → READY_FOR_REVIEW

# --- Branch 2: Some QA work still needed ---
wpsNeedingNewQa = wpsWithImpl, non-BLOCKED, with NO qa pipeline
wpsWithQaInProgress = wpsWithImpl, non-BLOCKED, with IN_PROGRESS qa

IF wpsNeedingNewQa or wpsWithQaInProgress exist:
    → IN_PROGRESS

# --- Branch 3: Only FAIL QA remains ---
wpsWithQaFail = wpsWithImpl, non-BLOCKED, most recent qa is FAIL

IF wpsWithQaFail is non-empty:
    → READY_FOR_DEVELOPER (Developer must rework)

# --- Branch 4: All QA done, some WPs not implemented ---
IF wpsStillNeedingImpl exist:
    apply same readyWps/blockedWps logic as Branch 1
    IF all blocked: → READY_FOR_REVIEW
    ELSE: → READY_FOR_DEVELOPER

DEFAULT: → READY_FOR_REVIEW
```

### 21.7 Reviewer Handoff

Mirrors QA handoff logic but shifted one stage forward:
- Input set: WPs with PASS qa pipeline
- Target: code-review pipelines
- Forward: READY_FOR_DOCUMENTATION
- Backward: READY_FOR_DEVELOPER

Same branching structure: all passed → forward; in-progress → self; fail → Developer; remaining blocked → forward; otherwise → Developer.

### 21.8 Documentation Handoff

Mirrors Reviewer handoff logic but shifted one stage forward:
- Input set: WPs with PASS code-review pipeline
- Target: documentation pipelines
- Forward: READY_FOR_SYNTHESIS
- Backward: READY_FOR_DEVELOPER

Same branching structure applies to PASS and dependency-blocked branches. **However, Documentation diverges from Reviewer on FAIL routing:** unlike QA and Reviewer, Documentation performs self-rework per the Fail Routing Map (§9.3). A FAIL documentation pipeline routes to `IN_PROGRESS` (self-rework), **NOT** to `READY_FOR_DEVELOPER`. The "mirrors Reviewer" description applies only to the PASS and dependency-blocked branches, NOT the FAIL branch.

Note that Documentation's **handoff** routes to Developer on unfinished work (missing doc pipelines), but its **next-action** returns self-rework on FAIL. These are complementary: handoff determines macro-routing; next-action guides micro-level work.

### 21.9 Synthesis Handoff

```
→ COMPLETE ("Synthesis complete")
→ next_action: "Call get_next_action first to check if synthesis work is pending"
```

### 21.10 Dependency-Blocked Exclusion Pattern

A recurring pattern in QA, Reviewer, and Documentation handoff functions:

```
When determining if earlier stages need work:
  1. Identify WPs not yet processed by the prerequisite stage
  2. Split into readyWps (not dependency-blocked) and blockedWps (dependency-blocked)
  3. IF all are blocked → route FORWARD (toward Synthesis)
  4. IF any are ready → route BACKWARD (toward Developer)
```

This prevents the workflow from stalling when dependency-blocked WPs exist but the current batch of WPs can proceed through downstream stages.

---

## 22. Batch Next-Action Algorithm

The `get_next_actions` (plural) tool returns **all** actionable WPs for an agent, enabling parallel processing.

### 22.1 Applicability

Batch actions are supported for pipeline-owning agents only:
- **Developer** → `implementation`
- **QA** → `qa`
- **Reviewer** → `code-review`
- **Documentation** → `documentation`

Non-pipeline agents (Planner, Project Manager, Synthesis) receive an empty action list with a descriptive reason.

### 22.2 Algorithm

```
function getNextActions(project_path, agent_role, max_results=5):
    pipelineType = AGENT_PIPELINE_MAP[agent_role]
    prerequisite = PIPELINE_PREREQUISITES[pipelineType]
    actions = []

    FOR each WP detail (until actions.length >= max_results):

        # Priority 1: Stale pipelines
        IF WP has stale IN_PROGRESS pipeline of pipelineType:
            actions.push(RESUME_OR_CANCEL)
            continue

        # Priority 2: Self-rework (Documentation only)
        IF agent owns rework for pipelineType (FAIL_ROUTING_MAP check)
           AND most recent pipeline of pipelineType is FAIL
           AND WP is non-BLOCKED:
            actions.push(REWORK)
            continue

        # Priority 3: New work
        IF prerequisite is null (implementation):
            IF WP is READY or IN_PROGRESS
               AND not dependency-blocked
               AND has no implementation pipeline:
                actions.push(IMPLEMENT)
                continue
        ELSE:
            IF most recent prerequisite pipeline is PASS
               AND WP is non-BLOCKED
               AND (no pipeline of pipelineType exists OR none is IN_PROGRESS):
                actions.push(actionNameMap[pipelineType])
                continue

        # Developer also checks downstream failures
        IF pipelineType == "implementation":
            IF WP has PASS implementation
               AND most recent qa or code-review is FAIL
               AND WP is non-BLOCKED:
                actions.push(REWORK with pipeline_that_failed)
                continue

    return actions (may be empty → WAIT)
```

### 22.3 Response Shape

```
{
    actions: [
        {
            action:           string    // action type name
            work_package_id:  string    // WP-###
            reason:           string    // human-readable explanation
            next_steps:       string[]  // step-by-step tool call guidance
            handoff_notes?:   string[]  // if relevant notes exist
            pipeline_that_failed?: string // if rework due to downstream failure
        },
        ...
    ],
    reason?: string  // only when actions is empty
}
```

---

## 23. Storage Layout & Project Detection

### 23.1 Centralized Ledger Root

All project data is stored under a single ledger root directory, **not** inside individual project folders:

```
{ledgerRoot}/
  ├── {slug-1}/
  │   ├── .meta.json            # project metadata
  │   ├── project-ledger.json   # root index
  │   ├── WP-001.json           # WP detail
  │   ├── WP-002.json
  │   └── .lock                 # lock file (transient)
  ├── {slug-2}/
  │   └── ...
  └── .archive/                 # archived projects (excluded from listings)
```

The `ledgerRoot` is resolved from environment configuration. Each project gets a subdirectory named by its **slug**.

### 23.2 Slug Derivation

The slug is the **base name** of the plan directory path:

```
plan_path = "/home/user/project/docs/agents/plans/2026-02-16-feature"
slug      = "2026-02-16-feature"
```

Slugs must be filesystem-safe (no special characters, no spaces in practice).

### 23.3 Project Meta File (`.meta.json`)

A lightweight metadata file per project for cross-project discovery:

```
ProjectMeta {
    slug:           string          // derived from plan path
    plan_path:      string          // absolute path to plan directory
    status:         ProjectStatus   // synced from root index on every write
    date_created:   timestamp
    last_updated:   timestamp
    title:          string?         // optional human-readable title
}
```

**Sync invariant:** `.meta.json` is automatically rewritten after **every** root index write. Status is always copied from the root index.

### 23.4 Project Detection (`detect_project`)

Finds a project by matching the caller's working directory against known project roots.

```
function detectProjectByCwd(cwdPath):
    projects = listAllProjects()  // reads all .meta.json files

    FOR each project in projects:
        projectRoot = inferProjectRootFromPlanPath(project.plan_path)
                      // plan_path is 4 levels deep, so go up 4 levels
        normalize both paths (forward slashes; lowercase on Windows)

        IF cwdPath == projectRoot OR cwdPath starts with projectRoot + "/":
            add to matches

    IF matches.length == 1:  → { status: "FOUND", meta }
    IF matches.length > 1:   → { status: "AMBIGUOUS", candidates }
    IF matches.length == 0:  → { status: "NOT_FOUND" }
```

**Project root inference:** The plan path follows a conventional structure: `{projectRoot}/docs/agents/plans/{slug}`. The project root is derived by walking 4 levels up from the plan directory.

### 23.5 Project Listing

`list_projects` scans all subdirectories of the ledger root:
- Skips entries starting with `.` (control directories like `.archive`)
- Skips non-directory filesystem entries
- Reads `.meta.json` from each directory
- Invalid/missing `.meta.json` → skip with warning (non-fatal)

### 23.6 File Format

All data files are JSON with:
- 2-space indentation
- Trailing newline
- UTF-8 encoding

---

## 24. Auto-Handoff Response Protocol

### 24.1 Auto-Handoff Payload

When auto-handoff is eligible (see §15.5), the handoff response includes an additional field:

```
{
    current_agent:  "Developer",
    next_agent:     "QA",
    status:         "READY_FOR_QA",
    details:        "All work packages have PASS implementation pipelines.",
    auto_handoff: {
        agent_name: "4 - QA v3.5.0",        // VS Code agent handle
        prompt:     "Project path: /path/to/plan"
    }
}
```

### 24.2 Agent Registry

The auto-handoff system depends on an **agent registry** that maps workflow role names to platform-specific agent handles.

```
function discoverAgents(agentsDir):
    FOR each *.agent.md file in agentsDir:
        parse YAML frontmatter
        extract name: and role: fields
        IF role exists AND name exists:
            agentHandleMap[role] = name
        IF role not in AGENT_ROLES:
            warn (but still add — forward-compatible)
    return agentHandleMap
```

**Frontmatter format:**
```yaml
---
name: '4 - QA v3.5.0'
role: QA
---
```

**Collision rule:** If two files share the same `role:`, the last one wins (file system ordering).

### 24.3 Depth Reset

The `auto_handoff_depth` counter is reset to `0` when the project reaches `COMPLETE` status, ensuring the next project starts with a fresh budget.

---

## Appendix A: Tool Interface Summary

| Tool | Purpose | Mutates Ledger |
|------|---------|:--------------:|
| `initialize_project` | Create new project ledger | Yes |
| `list_projects` | List all project metadata | No |
| `detect_project` | Find project by working directory | No |
| `get_project_status` | Read project overview (with self-healing) | Maybe |
| `create_work_package` | Create a new WP | Yes |
| `get_work_package` | Read WP detail | No |
| `list_work_packages` | List WP summaries with filters | No |
| `claim_work_package` | Claim a READY WP (READY → IN_PROGRESS) | Yes |
| `update_work_package_status` | Transition WP status | Yes |
| `start_pipeline` | Start a new pipeline on a WP | Yes |
| `complete_pipeline` | Complete an IN_PROGRESS pipeline | Yes |
| `cancel_pipeline` | Cancel an IN_PROGRESS pipeline (→ FAIL) | Yes |
| `update_pipeline_progress` | Append to pipeline summary | Yes |
| `add_observation` | Add comment to a pipeline | Yes |
| `add_project_comment` | Add comment to the project | Yes |
| `get_next_action` | Get single next-action recommendation | No |
| `get_next_actions` | Get batch next-action recommendations | No |
| `get_handoff_status` | Compute handoff routing | Maybe* |
| `complete_synthesis` | Mark synthesis done, maybe complete project | Yes |
| `help` | Return usage documentation | No |

\* `get_handoff_status` may increment `auto_handoff_depth` on the root index.

---

## Appendix B: Status Transition Matrix (Work Packages)

```
              │ To:
 From:        │ READY    IN_PROGRESS  COMPLETE      BLOCKED    CANCELLED
──────────────┼───────────────────────────────────────────────────────────
 READY        │   -      deps met     -             yes        PM only
 IN_PROGRESS  │   -         -         AC met +      blocked_by PM only
              │                       Docs only     required
 COMPLETE     │   -      PM/Docs      -             -          -
              │          (revision++)
 BLOCKED      │ deps met yes          -             -          PM only
              │ (clear)  (clear)
 CANCELLED    │   -         -         -             -          - (terminal)
```

---

## Appendix C: Pipeline Prerequisite Chain

```
implementation ──PASS──► qa ──PASS──► code-review ──PASS──► documentation
      │                   │                │                      │
      ▼ FAIL              ▼ FAIL           ▼ FAIL                 ▼ FAIL
   Developer           Developer        Developer            Documentation
   (self)              (rework)         (rework)             (self-rework)
```
