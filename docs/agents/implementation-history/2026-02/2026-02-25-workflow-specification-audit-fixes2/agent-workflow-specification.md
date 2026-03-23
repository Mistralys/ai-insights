# Agent Workflow Specification

**Version:** 1.0.0
**Date:** 2026-02-25
**Purpose:** Language-agnostic specification of the multi-agent ledger workflow logic, suitable for reimplementation in any language.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Glossary](#2-glossary)
3. [Entity Model](#3-entity-model)
4. [Agent Roles](#4-agent-roles)
5. [Pipeline Types & Routing Maps](#5-pipeline-types--routing-maps)
6. [Work Package Lifecycle](#6-work-package-lifecycle)
7. [Pipeline Lifecycle](#7-pipeline-lifecycle)
8. [Handoff & Next-Action Logic](#8-handoff--next-action-logic)
9. [Dependency Management](#9-dependency-management)
10. [Auto-Handoff Chain](#10-auto-handoff-chain)
11. [Self-Healing](#11-self-healing)
12. [Concurrency & Atomicity](#12-concurrency--atomicity)
13. [Complete Workflow Walkthrough](#13-complete-workflow-walkthrough)
14. [Edge Cases & Failure Modes](#14-edge-cases--failure-modes)
15. [Invariants & Assertions](#15-invariants--assertions)

---

## 1. Overview

This system coordinates a team of 7 AI agent roles executing a structured software development workflow. Agents operate sequentially through a pipeline chain on units of work called **work packages** (WPs). The entire state is persisted in a **project ledger** — a set of JSON files that serve as the single source of truth.

### Core Principles

- **State persists across sessions.** Each agent can resume from where the last agent left off.
- **Role separation is enforced.** Only specific agents may perform certain state transitions.
- **Every write is validated.** Data entering the ledger is schema-validated before persistence.
- **Dual-file updates are atomic.** When both the root index and a WP detail file change, they are written under a single lock.
- **Agents are stateless observers.** Agents query the ledger for what to do next; the ledger drives the workflow.

### High-Level Flow

```
Planner → Project Manager → [ Developer → QA → Reviewer → Documentation ]* → Synthesis
                                    ↑_______________|  (rework loop)
```

The inner loop repeats per work package. Within the loop, a pipeline failure triggers a rework cycle that sends work back to the Developer.

---

## 2. Glossary

| Term | Definition |
|------|-----------|
| **Root Index** | The project-level JSON file containing metadata, WP summaries, project comments, and counters. One per project. |
| **Work Package (WP)** | A discrete unit of work with its own detail file, acceptance criteria, pipelines, and handoff notes. |
| **Work Package Summary** | A lightweight subset of WP data stored in the root index for fast listing without loading detail files. |
| **Pipeline** | A single execution of a stage (implementation, QA, code-review, documentation) within a WP. A WP can have multiple pipelines of the same type (rework cycles). |
| **Handoff Note** | A structured message from one agent to the next, attached to a WP. |
| **Blocker** | A structured object describing why a WP is BLOCKED. |
| **Acceptance Criterion** | A boolean condition that must be `met: true` before a WP can be marked COMPLETE. |
| **Rework Count** | Incremented each time a pipeline is restarted after a FAIL. Absent until the first rework. |
| **Revision** | Incremented each time a COMPLETE WP is reopened to IN_PROGRESS. |
| **Stale Pipeline** | An IN_PROGRESS pipeline older than the stale threshold (default: 24 hours). |
| **Auto-Handoff Depth** | A counter on the root index tracking how many consecutive automatic agent invocations have occurred. |

---

## 3. Entity Model

### 3.1 Root Index

```
RootIndex {
  plan_file:              string        // Path to the plan document
  date_created:           timestamp     // When the project was initialized
  last_updated:           timestamp     // Updated on every write
  status:                 ProjectStatus // Derived from WP statuses
  total_work_packages:    integer       // Count of all WPs
  pending_work_packages:  integer       // Count of non-COMPLETE WPs
  work_packages:          WorkPackageSummary[]
  project_comments:       ProjectComment[]
  auto_handoff_depth?:    integer       // Optional, absent = 0
}
```

### 3.2 Work Package Summary (embedded in Root Index)

```
WorkPackageSummary {
  work_package_id:  string              // Format: WP-NNN (e.g., WP-001)
  status:           WorkPackageStatus
  assigned_to:      string              // Agent role name
  dependencies:     string[]            // WP IDs this WP depends on
  file:             string              // Path to the detail file
}
```

### 3.3 Work Package Detail (separate file per WP)

```
WorkPackageDetail {
  work_package_id:    string
  work_package_file:  string            // Path to the spec document
  status:             WorkPackageStatus
  assigned_to:        string
  dependencies:       string[]
  blocked_by?:        Blocker
  acceptance_criteria: AcceptanceCriterion[]
  revision:           integer           // Starts at 0, incremented on COMPLETE → IN_PROGRESS
  rework_count?:      integer           // Absent until first rework; incremented on pipeline retry after FAIL. Absent is treated as 0 in all comparisons.
  handoff_notes?:     HandoffNote[]
  pipelines:          Pipeline[]
}
```

### 3.4 Pipeline

```
Pipeline {
  type:           PipelineType          // "implementation" | "qa" | "code-review" | "documentation"
  status:         PipelineStatus        // "IN_PROGRESS" | "PASS" | "FAIL"
  started_at?:    timestamp
  completed_at?:  timestamp
  summary:        string[]
  artifacts?:     Artifacts
  metrics?:       Metrics               // Extensible key-value pairs
  comments?:      PipelineComment[]
}
```

### 3.5 Supporting Types

```
AcceptanceCriterion {
  criterion:  string
  met:        boolean
}

Blocker {
  type:                    "dependency" | "decision" | "external" | "technical"
  description:             string
  blocking_work_package?:  string          // WP ID, optional
}

HandoffNote {
  from_agent:  string
  to_agent:    string
  timestamp:   timestamp
  notes:       string[]
}

PipelineComment {
  type:       string                      // e.g., "code-smell", "refactor", "debt"
  priority:   "low" | "medium" | "high"
  timestamp:  timestamp
  note:       string
}

ProjectComment {
  type:       string                      // e.g., "incident", "note", "decision"
  priority:   "low" | "medium" | "high"
  timestamp:  timestamp
  agent:      string
  note:       string
  context?:   IncidentContext             // Required when type == "incident"
}

IncidentContext {
  os:              string
  tool:            string
  work_package?:   string
  resolved:        boolean
  workaround?:     string
}

Artifacts {
  files_modified?:  string[]
  commit_hash?:     string
  pull_request?:    string
}

Metrics {
  test_coverage?:    string
  tests_passed?:     integer
  tests_failed?:     integer
  security_issues?:  integer
  [key: string]:     any                  // Extensible
}
```

### 3.6 Enumerations

```
ProjectStatus       = "READY" | "IN_PROGRESS" | "COMPLETE" | "BLOCKED"
WorkPackageStatus   = "READY" | "IN_PROGRESS" | "COMPLETE" | "BLOCKED"
PipelineStatus      = "IN_PROGRESS" | "PASS" | "FAIL"
PipelineType        = "implementation" | "qa" | "code-review" | "documentation"
BlockerType         = "dependency" | "decision" | "external" | "technical"
CommentPriority     = "low" | "medium" | "high"
```

---

## 4. Agent Roles

Seven agent roles in execution order:

| # | Role | Responsibility | Pipeline Owned |
|---|------|---------------|----------------|
| 1 | **Planner** | Creates the high-level strategy and implementation plan document | None |
| 2 | **Project Manager** | Decomposes the plan into work packages, initializes the ledger, resolves blockers | None |
| 3 | **Developer** | Implements work packages (writes code, runs tests) | `implementation` |
| 4 | **QA** | Verifies acceptance criteria, runs validation suite | `qa` |
| 5 | **Reviewer** | Performs code quality and architecture review | `code-review` |
| 6 | **Documentation** | Updates documentation; **only agent that can set WP status to COMPLETE** | `documentation` |
| 7 | **Synthesis** | Consolidates results into a final project report | None |

### Role Constraints

| Constraint | Enforced By |
|-----------|-------------|
| Only Documentation can transition WP to COMPLETE | `update_work_package_status` |
| Only Project Manager or Documentation can reopen COMPLETE → IN_PROGRESS | `update_work_package_status` |
| Claiming a WP assigned to a different agent requires explicit override | `claim_work_package` |

---

## 5. Pipeline Types & Routing Maps

### 5.1 Pipeline Execution Order

Pipelines **must** be executed in strict sequence within each work package:

```
implementation → qa → code-review → documentation
```

A pipeline type can only start when its prerequisite has a `PASS` pipeline.

**Prerequisites Map:**

| Pipeline Type | Prerequisite (must have PASS) |
|---------------|-------------------------------|
| `implementation` | _(none — always startable)_ |
| `qa` | `implementation` |
| `code-review` | `qa` |
| `documentation` | `code-review` |

### 5.2 Pipeline → Agent Map

Defines which agent owns which pipeline. Used to auto-update `assigned_to` when a pipeline starts.

| Pipeline Type | Owning Agent |
|---------------|-------------|
| `implementation` | Developer |
| `qa` | QA |
| `code-review` | Reviewer |
| `documentation` | Documentation |

### 5.3 Next-Agent Map

Defines the next agent in the pipeline chain. Used to route handoff notes when a pipeline completes.

| Pipeline Type | Next Agent (`to_agent`) |
|---------------|------------------------|
| `implementation` | QA |
| `qa` | Reviewer |
| `code-review` | Documentation |
| `documentation` | Synthesis |

### 5.4 Agent → Pipeline Map (Inverse)

Derived automatically from Pipeline → Agent Map:

| Agent | Pipeline Type |
|-------|---------------|
| Developer | `implementation` |
| QA | `qa` |
| Reviewer | `code-review` |
| Documentation | `documentation` |

---

## 6. Work Package Lifecycle

### 6.1 Status State Machine

```
                    ┌─────────────────────────────────────────────┐
                    │                                             │
                    ▼                                             │
               ┌─────────┐     claim (deps met)     ┌────────────┴──┐
   ──create──▶ │  READY   │ ─────────────────────▶  │  IN_PROGRESS  │
               └─────────┘                          └───────────────┘
                    │  │                               │  │       ▲
                    │  │ cancel                   block │  │cancel │ unblock / reopen
                    │  │                               │  │       │
                    │  │     ┌────────────┐            │  │       │
                    │  └────▶│ CANCELLED  │◀───────────┘  │       │
                    │        └────────────┘               │       │
                    │ block        ▲                      ▼       │
                    ▼              │ cancel          ┌──────────┐ │
               ┌──────────┐       │                 │          │ │
               │          │───────┘                 │ BLOCKED  │─┘
               │ BLOCKED  │                         │          │
               │          │                         └──────────┘
               └──────────┘                                │
                    │                                      │ unblock
                    │ unblock (all deps met)               ▼
                    ▼                               ┌────────────────┐
               ┌─────────┐                         │  IN_PROGRESS   │
               │  READY   │                         └────────────────┘
               └─────────┘                                 │
                                     all AC met +          │
                                     Documentation         ▼
                                     agent only       ┌──────────┐
                                                      │ COMPLETE  │
                                                      └──────────┘
                                                           │
                                     PM or Doc agent       │ reopen
                                     + revision++          ▼
                                                    ┌────────────────┐
                                                    │  IN_PROGRESS   │
                                                    └────────────────┘
```

**Terminal statuses:** `COMPLETE` and `CANCELLED` — no outward transitions are allowed from either.

### 6.2 Legal Status Transitions

| From | To | Conditions |
|------|----|-----------|
| READY | IN_PROGRESS | All dependencies must be COMPLETE or CANCELLED |
| READY | BLOCKED | `blocked_by` object required |
| READY | CANCELLED | PM-only agent guard |
| IN_PROGRESS | COMPLETE | All acceptance criteria `met: true`; calling agent must be Documentation |
| IN_PROGRESS | BLOCKED | `blocked_by` object required |
| IN_PROGRESS | CANCELLED | PM-only agent guard |
| BLOCKED | IN_PROGRESS | Clears `blocked_by` field |
| BLOCKED | READY | Clears `blocked_by` field (used by auto-unblock) |
| BLOCKED | CANCELLED | PM-only agent guard |
| COMPLETE | IN_PROGRESS | Calling agent must be Project Manager or Documentation; increments `revision`; increments `pending_work_packages` |

**Same-status transition** (e.g., IN_PROGRESS → IN_PROGRESS): Role guards **DO apply** — the calling agent must satisfy all role-based restrictions that apply to the target status (e.g., COMPLETE still requires Documentation agent even if already COMPLETE). The write is otherwise a no-op: status and counters are unchanged.

**All other transitions are illegal** and must be rejected with an error.

### 6.3 Creation Rules

When a work package is created:

1. Generate WP ID using max-based incrementing: scan existing WP IDs for the highest numeric suffix, add 1. Format: `WP-NNN` (zero-padded to 3 digits). Empty project → `WP-001`.
2. Validate all dependencies exist in the root index.
2a. **Validate `acceptance_criteria`:** Must contain at least one criterion. An empty array is rejected with a validation error.
3. Determine initial status:
   - If `dependencies` is empty or all dependencies are COMPLETE → `READY`
   - If any dependency is not COMPLETE → `BLOCKED`
4. Create both the WP detail file and root index summary atomically.
5. Update root index counters: `total_work_packages += 1`, `pending_work_packages += 1`.
6. Set project status to `IN_PROGRESS` if it was `READY`.

### 6.4 Claiming Rules

When an agent claims a work package:

1. **Assignment guard:** If `wp.assigned_to` differs from the calling agent and `override` is not true → reject.
2. Validate current status is `READY`.
3. Validate dependencies are met (all COMPLETE) via `canStartWorkPackage()`.
4. Validate status transition `READY → IN_PROGRESS`.
5. Update `wp.status` to `IN_PROGRESS` and `wp.assigned_to` to the claiming agent.
6. Update root index summary to match.

**`override` authorization:** Setting `override: true` bypasses the assignment guard in step 1. Only the **Project Manager** (`"Project Manager"` or `"Project Manager Agent"`) and the **current assignee** (`wp.assigned_to`) are permitted to use `override: true`. Any other calling agent that passes `override: true` when the WP is assigned to a different non-PM agent should be rejected. This prevents unauthorized re-assignment of work packages.

### 6.5 Completion Rules (WP → COMPLETE)

1. Caller must be `"Documentation"` or `"Documentation Agent"`.
2. All acceptance criteria must have `met: true`.
3. Transition `IN_PROGRESS → COMPLETE` in WP detail and root index summary.
4. Decrement `pending_work_packages`.
5. Reset `auto_handoff_depth` to 0 if it was non-zero.
6. **After lock release:** run dependency auto-unblock (see §9.2).

### 6.6 Reopening Rules (COMPLETE → IN_PROGRESS)

1. Caller must be `"Project Manager"`, `"Project Manager Agent"`, `"Documentation"`, or `"Documentation Agent"`.
2. Increment `revision`.
3. Increment `pending_work_packages`.
4. Transition WP to `IN_PROGRESS`.
5. **Cascade-block dependents:** All non-COMPLETE WPs whose `dependencies` include the reopened WP and whose status is `READY` or `IN_PROGRESS` are automatically transitioned to `BLOCKED` with `blocked_by: { type: "dependency", description: "Dependency {WP-ID} was reopened", blocking_work_package: "{WP-ID}" }`. COMPLETE dependents are left unchanged. Already-BLOCKED dependents are not re-blocked.
6. Update `pending_work_packages` to reflect newly blocked WPs.

### 6.7 Cancellation Rules (→ CANCELLED)

1. `CANCELLED` is a **terminal status** — no outward transitions are allowed.
2. Only the **Project Manager** (`"Project Manager"` or `"Project Manager Agent"`) may transition a WP to CANCELLED.
3. Valid inbound transitions: `READY → CANCELLED`, `IN_PROGRESS → CANCELLED`, `BLOCKED → CANCELLED`. `COMPLETE → CANCELLED` is **not** valid (use reopen first if needed).
4. **Pending counter:** CANCELLED WPs are not counted as pending. When a WP transitions to CANCELLED from a non-terminal status, `pending_work_packages` is decremented.
5. **Dependency satisfaction:** CANCELLED WPs satisfy dependency requirements (treated like COMPLETE). Transitioning a WP to CANCELLED triggers `propagateDependencyUnblock` — any BLOCKED dependents whose dependencies are now all COMPLETE or CANCELLED are unblocked.
6. **Self-healing:** The `computeHealedStatus` function excludes CANCELLED WPs from the pending count, matching the COMPLETE exclusion.

---

## 7. Pipeline Lifecycle

### 7.1 Starting a Pipeline

**Preconditions (all must pass):**

1. WP status must be `IN_PROGRESS`.
2. No duplicate: no existing pipeline of the same type may be `IN_PROGRESS` for this WP.
3. Prerequisite pipeline must have `PASS` status (per §5.1). Exception: `implementation` has no prerequisite.
4. _(Optional)_ If `agent_role` is provided, it must match the pipeline type's owner in the Pipeline → Agent Map. Mismatch → reject.

**Actions on start:**

1. If the **most recent** pipeline of the **same type** has `FAIL` status → increment `rework_count` on the WP.
2. **Circuit breaker:** If `rework_count >= MAX_REWORK_COUNT` (default: 5) after increment → reject with error: `"Rework circuit breaker: {WP-ID} has reached the maximum rework count ({MAX_REWORK_COUNT}). Consider cancelling this work package (transition to CANCELLED) or restructuring the approach."` The `MAX_REWORK_COUNT` constant is defined in `workflow-helpers.ts`.
3. Create a new Pipeline object: `{ type, status: "IN_PROGRESS", started_at: now(), summary: [] }`.
4. Append to `wp.pipelines` array.
5. Update `wp.assigned_to` to the agent per Pipeline → Agent Map.
6. Update root index summary `assigned_to` to match.
7. Update `root.last_updated`.

### 7.2 Completing a Pipeline

1. Find the most recent `IN_PROGRESS` pipeline of the specified type.
2. If not found → error.
3. Set `pipeline.status` to `PASS` or `FAIL`.
4. Set `pipeline.completed_at` to `now()`.
5. Set `pipeline.summary`, and optionally `artifacts`, `metrics`, `comments`.
6. Update `acceptance_criteria` on the WP if `acceptance_criteria_updates` provided. Merge strategy by criterion text:
   - **Known criterion:** find by exact `criterion` string match and update its `met` flag.
   - **Unknown criterion:** criterion text not found in the existing array → append a new `AcceptanceCriterion` entry `{ criterion, met }` to the array.
7. If `handoff_notes` provided:
   - `from_agent` = Pipeline → Agent Map[type]
   - `to_agent` = Next-Agent Map[type]
   - Append `HandoffNote { from_agent, to_agent, timestamp: now(), notes }` to `wp.handoff_notes`.
8. Update `root.last_updated`.

### 7.3 Cancelling a Pipeline

1. Find the most recent `IN_PROGRESS` pipeline of the specified type.
2. If not found → error.
3. Set `pipeline.status` to `FAIL`.
4. Set `pipeline.completed_at` to `now()`.
5. Set `pipeline.summary` to `[reason]`.
6. Update `root.last_updated`.

### 7.4 Updating Pipeline Progress

1. Find the most recent `IN_PROGRESS` pipeline of the specified type.
2. If not found → error.
3. Append new summary strings to `pipeline.summary`.
4. Update `root.last_updated`.

### 7.5 Stale Pipeline Detection

A pipeline is **stale** if:
- `status == "IN_PROGRESS"`
- `started_at` is more than `STALE_THRESHOLD` hours ago (default: 24)

Stale pipelines are detected by the next-action computation and surfaced as `RESUME_OR_CANCEL` actions. They are not automatically cancelled.

### 7.6 Rework Count Semantics

| Pipeline History for Type | rework_count Change on Start |
|---------------------------|------------------------------|
| No prior pipelines | No increment |
| Most recent is PASS | No increment |
| Most recent is FAIL | +1 |

> **Key distinction:** Only the **most recent** pipeline of the same type matters. A history of `[FAIL, PASS]` does **not** trigger an increment because the most recent is `PASS`.

The field is **absent** (not `0`) until the first rework occurs.

---

## 8. Handoff & Next-Action Logic

Two complementary queries drive the workflow: **"What should I do next?"** and **"Am I done; who goes next?"**

### 8.1 Next-Action Computation

Given `(project_path, agent_role)`, return a single action recommendation.

#### Global Pre-Checks (before role-specific logic)

1. **No WPs exist:**
   - Project Manager → `CREATE_WORK_PACKAGES`
   - All others → `WAIT`

2. **All WPs COMPLETE:**
   - Synthesis → `GENERATE_SYNTHESIS` (only if `synthesis_generated` is absent or `false`; if `true` → `WAIT`)
   - Project Manager → `SIGNAL_SYNTHESIS`
   - All others → `WAIT`

#### Role-Specific Logic

**Planner:** Always `WAIT` (planning is done outside the ledger).

**Project Manager:**
1. If any WP is BLOCKED → `RESOLVE_BLOCKERS` for the first BLOCKED WP.
2. Otherwise → `WAIT`.

> **Blocker resolution mechanism (A-5):** When the Project Manager resolves a blocker, it calls `update_work_package_status` with `BLOCKED → READY` (or `BLOCKED → IN_PROGRESS` for owned WPs). This transition automatically clears the `blocked_by` field. No separate "clear blocker" tool exists; the status transition is the resolution mechanism.

> **Parallel processing (A-7):** Each agent invocation processes **one** work package at a time. Even if multiple WPs are eligible for the same action, the `ledger_get_next_action` tool returns a single recommendation. Agents must re-invoke `ledger_get_next_action` after completing each WP to pick up the next eligible WP.

**Developer:**

| Priority | Condition | Action |
|----------|-----------|--------|
| 1 | Any non-BLOCKED, non-COMPLETE, non-CANCELLED WP has `rework_count >= MAX_REWORK_COUNT` | `BLOCK_FOR_REWORK_LIMIT` |
| 2 | Any WP has a stale `implementation` pipeline (>24h IN_PROGRESS) | `RESUME_OR_CANCEL` |
| 3 | Any READY or IN_PROGRESS WP (not dependency-blocked) has no `implementation` pipeline | `IMPLEMENT` |
| 4 | Any non-BLOCKED WP has most-recent `implementation` pipeline = FAIL | `REWORK` |
| 5 | Any non-BLOCKED WP with PASS impl has most-recent `qa` or `code-review` = FAIL | `REWORK` (downstream rejection) |
| 6 | None of the above | `WAIT` |

**QA:**

| Priority | Condition | Action |
|----------|-----------|--------|
| 1 | Any WP has a stale `qa` pipeline | `RESUME_OR_CANCEL` |
| 2 | Any non-BLOCKED WP has a new upstream `implementation` PASS not yet covered by QA (temporal check) | `RUN_QA` |
| 3 | Any non-BLOCKED WP has most-recent `qa` = FAIL | `WAIT` (Developer must rework first; QA does not self-rework) |
| 4 | None of the above | `WAIT` |

**Reviewer:**

| Priority | Condition | Action |
|----------|-----------|--------|
| 1 | Any WP has a stale `code-review` pipeline | `RESUME_OR_CANCEL` |
| 2 | Any non-BLOCKED WP has a new upstream `qa` PASS not yet covered by code-review (temporal check) | `RUN_REVIEW` |
| 3 | Any non-BLOCKED WP has most-recent `code-review` = FAIL | `WAIT` (Developer must rework first; Reviewer does not self-rework) |
| 4 | None of the above | `WAIT` |

**Documentation:**

| Priority | Condition | Action |
|----------|-----------|--------|
| 1 | Any WP has a stale `documentation` pipeline | `RESUME_OR_CANCEL` |
| 2 | Any IN_PROGRESS WP has all 4 pipeline types PASS but status is still IN_PROGRESS | `MARK_COMPLETE` |
| 3 | Any non-BLOCKED WP has new upstream `code-review` PASS not yet covered by documentation (temporal check) | `WRITE_DOCS` |
| 4 | Any non-BLOCKED WP has most-recent `documentation` = FAIL | `REWORK` (Documentation retains self-rework capability) |
| 5 | None of the above | `WAIT` |

> **Documentation FAIL Routing:** When a Documentation pipeline returns FAIL, the Documentation agent handles its own rework — the Developer is **never** routed to fix documentation issues. If the documentation failure stems from a code-level defect that the Documentation agent cannot resolve independently, the Documentation agent should block the WP with a `technical` blocker (via `update_work_package_status` → BLOCKED with `blocked_by: { type: "technical", description: "..." }`), routing it to the Project Manager for resolution. See §13.2, `FAIL_ROUTING_MAP`.

**Synthesis:**
- Always `WAIT` until all WPs are COMPLETE (handled by global pre-check).
- After generating the synthesis report, calls `ledger_complete_synthesis` which sets `synthesis_generated = true` on the root index and transitions the project to COMPLETE.
- Subsequent `get_next_action(Synthesis)` returns `WAIT` (guarded by `synthesis_generated` flag).

#### Temporal Upstream Check (`hasNewUpstreamPassSince`)

This function determines if a downstream pipeline agent should (re-)engage for a WP after a rework cycle:

```
hasNewUpstreamPassSince(pipelines, upstreamType, downstreamType):
  upstreamPass = last pipeline where type == upstreamType AND status == PASS
  if upstreamPass does not exist → return false

  downstreamLatest = last pipeline where type == downstreamType
  if downstreamLatest does not exist → return true  (first run)

  if upstreamPass.completed_at is absent OR downstreamLatest.started_at is absent → return false

  return upstreamPass.completed_at > downstreamLatest.started_at  (strict >)
```

#### `isMostRecentPipelineFail` Semantics

Returns true **only** if the last (most recent) pipeline of the given type has `FAIL` status:

| Pipeline History | Result |
|-----------------|--------|
| `[]` (empty) | `false` |
| `[FAIL]` | `true` |
| `[PASS]` | `false` |
| `[FAIL, PASS]` | `false` (resolved — no rework needed) |
| `[PASS, FAIL]` | `true` (regression — rework needed) |

#### Batch Next-Action Variant

A batch version collects **all** matching actions (up to `max_results`, default 5) instead of returning only the first. Same priority logic, but iterates all WPs instead of returning on the first match.

### 8.2 Handoff Computation

Given `(project_path, current_agent)`, determine the handoff status and next agent.

#### Global Pre-Check

If any WP is BLOCKED **and** no WP is READY or IN_PROGRESS → return `BLOCKED` (next agent: Project Manager).

#### Role-Specific Handoff Logic

**Planner:**
- No WPs exist → `WAIT`
- Any WP is READY or IN_PROGRESS → `READY_FOR_DEVELOPER`
- Otherwise → `WAIT`

**Project Manager:**
- Any WP lacks implementation pipeline and is READY/IN_PROGRESS → `READY_FOR_DEVELOPER`
- Otherwise → `IN_PROGRESS`

**Developer:**
- Consider only non-BLOCKED WPs.
- All non-BLOCKED WPs have PASS `implementation` → `READY_FOR_QA`
- Some non-BLOCKED WPs still need implementation or have FAIL impl → `IN_PROGRESS`
- Otherwise → `READY_FOR_QA`

**QA:**
- Collect WPs with PASS `implementation` (`wpsWithImpl`).
- Collect WPs still needing implementation (`wpsStillNeedingImpl`).
- If all `wpsWithImpl` have PASS `qa`:
  - If `wpsStillNeedingImpl` exist:
    - Partition into `readyWps` (not dependency-blocked) and `blockedWps` (dependency-blocked).
    - All unimplemented WPs are dependency-blocked → `READY_FOR_REVIEW` (skip to next stage)
    - Some are ready → `READY_FOR_DEVELOPER` (earlier stage needs catch-up)
  - Otherwise → `READY_FOR_REVIEW`
- If some non-BLOCKED `wpsWithImpl` still need QA or have FAIL `qa` → `IN_PROGRESS`
- If all QA done but `wpsStillNeedingImpl` exist → same partition logic → `READY_FOR_REVIEW` or `READY_FOR_DEVELOPER`
- Otherwise → `READY_FOR_REVIEW`

**Reviewer:** (mirrors QA logic for the code-review stage)
- Collect WPs with PASS `qa` (`wpsWithQa`).
- Collect WPs not yet QA-passed (`wpsNotYetQaPassed`).
- If all `wpsWithQa` have PASS `code-review`:
  - If `wpsNotYetQaPassed` exist:
    - Partition: all dependency-blocked → `READY_FOR_DOCUMENTATION`; some ready → `READY_FOR_DEVELOPER`
  - Otherwise → `READY_FOR_DOCUMENTATION`
- If some non-BLOCKED `wpsWithQa` still need review or have FAIL review → `IN_PROGRESS`
- If all reviewed but earlier WPs pending → same partition logic
- Otherwise → `READY_FOR_DOCUMENTATION`

**Documentation:** (mirrors Reviewer logic for the documentation stage)
- Collect WPs with PASS `code-review` (`wpsWithReview`).
- Collect WPs not yet reviewed (`wpsNotYetReviewed`).
- If all `wpsWithReview` have PASS `documentation`:
  - If `wpsNotYetReviewed` exist:
    - Partition: all dependency-blocked → `READY_FOR_SYNTHESIS`; some ready → `READY_FOR_DEVELOPER`
  - Otherwise → `READY_FOR_SYNTHESIS`
- If some non-BLOCKED `wpsWithReview` still need docs or have FAIL docs → `IN_PROGRESS`
- If all documented but earlier WPs pending → same partition logic
- Otherwise → `READY_FOR_SYNTHESIS`

**Synthesis:** Always returns `COMPLETE`.

### 8.3 Handoff Status → Next Agent Mapping

| Handoff Status | Next Agent |
|---------------|-----------|
| `READY_FOR_DEVELOPER` | Developer |
| `READY_FOR_QA` | QA |
| `READY_FOR_REVIEW` | Reviewer |
| `READY_FOR_DOCUMENTATION` | Documentation |
| `READY_FOR_SYNTHESIS` | Synthesis |
| `BLOCKED` | Project Manager |
| `IN_PROGRESS` | Same as current agent (continue working) |
| `COMPLETE` | None |

### 8.4 Dependency-Blocked Skip Rule

**Key invariant:** When computing handoff status, WPs that are blocked by incomplete dependencies are excluded from the "work remaining" count. If all remaining WPs at a given stage are dependency-blocked, the workflow skips forward to the next stage rather than routing back to the Developer.

_Example:_ WP-001 has all pipelines PASS and is COMPLETE. WP-002 depends on WP-001 and is now READY. WP-003 depends on WP-002 and is BLOCKED. The Documentation agent completing WP-001 sees `READY_FOR_SYNTHESIS` (WP-003 is dependency-blocked, not actionable), not `READY_FOR_DEVELOPER`.

However, if WP-002 is READY (not dependency-blocked), the handoff routes to `READY_FOR_DEVELOPER` for WP-002.

---

## 9. Dependency Management

### 9.1 Dependency Rules

- Dependencies are expressed as an array of WP IDs on each work package.
- All dependency IDs must exist in the root index at creation time.
- A WP can only transition from READY to IN_PROGRESS if **all** dependencies are COMPLETE.
- Dependencies are checked by scanning root index summaries (lightweight) or full WP details (when already loaded).

**Prevention by construction:** Circular dependencies are structurally impossible in this system:

- All dependency IDs must reference WPs that already exist in the root index at creation time (rule 2 above).
- Dependencies are immutable after creation — they cannot be added or changed.
- Because a WP can only depend on *already-existing* WPs, a cycle is impossible: a new WP W can only depend on WPs created before W, none of which can reach W through their own dependency chains.

Therefore, runtime cycle detection is unnecessary and is not implemented.

### 9.2 Automatic Dependency Unblocking

When a WP transitions to `COMPLETE`:

1. **After** the primary lock is released (see §12 for why).
2. Acquire a new lock.
3. Read the root index.
4. Find all BLOCKED WPs whose dependency list includes the just-completed WP ID.
5. For each candidate:
   a. Read the full WP detail.
   b. Check if **all** dependencies are now COMPLETE.
   c. If yes: transition BLOCKED → READY, clear `blocked_by`. **Always sets READY, never IN_PROGRESS.** The agent must explicitly re-claim the WP via `ledger_claim_work_package` to move it to IN_PROGRESS.
   d. Update root index summary.
   e. Write updated WP detail.
6. Write updated root index with new `last_updated`.
7. Release lock.

**Idempotency:** Running auto-unblock on an already-READY WP is a no-op (safe to re-run).

**Gap between locks:** There is a brief window where a WP shows COMPLETE but its dependents are still BLOCKED. This is safe for single-agent workflows. In concurrent multi-agent environments, this is a known race condition.

### 9.3 Automatic Dependency Reblocking (Cascade-Block on Reopen)

When a COMPLETE WP is reopened (COMPLETE → IN_PROGRESS), dependents operating on stale assumptions must be cascade-blocked:

1. **After** the primary lock is released (same pattern as auto-unblock).
2. Acquire a new lock.
3. Read the root index.
4. Find all non-COMPLETE, non-BLOCKED WPs whose dependency list includes the reopened WP ID.
5. For each candidate (status is READY or IN_PROGRESS):
   a. Read the full WP detail.
   b. Transition to BLOCKED with `blocked_by: { type: "dependency", description: "Dependency {WP-ID} was reopened", blocking_work_package: "{WP-ID}" }`.
   c. Update root index summary.
   d. Write updated WP detail.
6. Recompute `pending_work_packages`.
7. Write updated root index with new `last_updated`.
8. Release lock.

**Scope:** Only direct dependents are cascade-blocked, not transitive dependents. If WP-A → WP-B → WP-C and WP-A is reopened, only WP-B is blocked (not WP-C, which depends on WP-B).

**Idempotency:** Running cascade-reblock on an already-BLOCKED WP is a no-op (safe to re-run).

**Pipelines:** Old pipelines on cascade-blocked WPs are NOT invalidated. The temporal `hasNewUpstreamPassSince` check guards against stale assumptions when the WP is eventually unblocked.

### 9.4 WP ID Generation

IDs are generated using max-based incrementing:
- Scan existing `work_packages` for the highest numeric suffix.
- Next ID = max + 1, formatted as `WP-NNN` (zero-padded to 3 digits).
- Empty project → `WP-001`.
- Deleting a WP does not cause ID collisions (IDs may have gaps).

---

## 10. Auto-Handoff Chain

### 10.1 Purpose

Allows consecutive agent invocations to happen automatically without human intervention, up to a configurable depth limit.

### 10.2 Data Location

`auto_handoff_depth` is stored on the root index. Absent or `undefined` is treated as `0`.

### 10.3 Eligibility Conditions (all must be true)

1. `auto_handoff_enabled` is `true` in runtime configuration.
2. The agent registry is loaded (has discovered agent handles).
3. The next agent has a known handle in the registry.
4. Handoff status is not `COMPLETE`, `BLOCKED`, or `IN_PROGRESS`.
5. `auto_handoff_depth < max_handoff_depth` (configurable, default: 10).

### 10.4 Increment Path

When all eligibility conditions pass:
1. Read `auto_handoff_depth` from root index (default 0).
2. Write `auto_handoff_depth + 1` back to root index.
3. Include `auto_handoff { agent_name, prompt }` in the response payload.

### 10.5 Reset Path

When **any** WP transitions to `COMPLETE`:
- If `auto_handoff_depth != 0`: reset to `0`.
- This reset is done inside `update_work_package_status`, not in the handoff computation.

### 10.6 Depth-Exceeded Path

When `auto_handoff_depth >= max_handoff_depth`:
- `auto_handoff` is **omitted** from the response.
- No error or warning.
- The agent chain terminates; human must manually invoke the next agent.

---

## 11. Self-Healing

### 11.1 Counter and Status Correction

Triggered when `get_project_status` is called:

1. Recompute counters from data:
   - `total_work_packages` = `work_packages.length`
   - `pending_work_packages` = count where `status != COMPLETE`

2. Auto-heal project status (first matching rule wins):

   | Current Status | Condition | Healed To |
   |---------------|-----------|-----------|
   | READY | Any WP is IN_PROGRESS | IN_PROGRESS |
   | BLOCKED | No WP is BLOCKED | IN_PROGRESS (if pending > 0) or READY (if pending == 0) |
   | IN_PROGRESS | pending == 0 AND WPs exist AND `synthesis_generated` is `true` | COMPLETE |
   | IN_PROGRESS | pending == 0 AND WPs exist AND `synthesis_generated` is absent/`false` | IN_PROGRESS (stays — wait for synthesis) |
   | COMPLETE | pending > 0 | IN_PROGRESS |

3. An empty project (no WPs) is **never** auto-healed to COMPLETE.
4. Only write back to disk if a correction was actually made.

#### Implementation: Compute/Write Separation

Self-healing is implemented as a two-phase process:

1. **Compute phase** (pure function `computeHealedStatus`): Takes the root index and returns `{ totalWps, pendingWps, healedStatus, needsWrite }`. No I/O.
2. **Write phase** (conditional, under lock): Only executes if `needsWrite` is `true`. Acquires a file lock, re-reads the root index to avoid race conditions, recomputes healing on the fresh data, and writes only if still needed.

This separation ensures:
- **No unnecessary writes**: If counters and status are correct, no disk I/O occurs.
- **Race-condition safety**: The corrective write re-reads under lock to avoid clobbering concurrent changes.
- **Testability**: `computeHealedStatus` is a pure, exported function that can be unit-tested without disk access.

---

## 12. Concurrency & Atomicity

### 12.1 Atomic Writes

All JSON file writes use the **write-to-temp-then-rename** pattern:
1. Write to `{file}.tmp.{pid}` (unique temp file).
2. Atomically rename temp to target.
3. Ensures readers never see partial writes.

### 12.2 File Locking

When both the root index and a WP detail need updating:
1. Acquire a file lock on the project's storage directory.
2. Read both files.
3. Apply mutations.
4. Validate updated data.
5. Write both files atomically.
6. Release lock in a `finally` block.

Lock parameters:
- **Stale timeout:** 10 seconds (abandoned locks are force-overridden).
- **Retry count:** 50 attempts with 200ms–1000ms exponential backoff (~10–50 seconds total retry window, ensuring coverage of the stale timeout).

### 12.3 Lock Persistence

Lock files persist on disk after process exit. The lock system handles stale locks automatically — they can be safely ignored.

### 12.4 Root Index and WP Summary Synchronization

WP summaries in the root index **duplicate** a subset of WP detail data. This invariant is maintained by always updating both within the same lock.

**Invariant:** For every WP, `root.work_packages[i].status == WP-detail.status` and `root.work_packages[i].assigned_to == WP-detail.assigned_to`.

---

## 13. Complete Workflow Walkthrough

### 13.1 Happy Path (Single WP)

```
1. INITIALIZE PROJECT
   - Planner creates plan document
   - Project Manager calls initialize_project(plan_path)
   → Root index created, status: READY

2. CREATE WORK PACKAGE
   - PM calls create_work_package(assigned_to: "Developer", dependencies: [], ...)
   → WP-001 created, status: READY
   → Root index: total=1, pending=1, status: IN_PROGRESS

3. CLAIM WORK PACKAGE
   - Developer calls claim_work_package(WP-001, agent: "Developer")
   → WP-001 status: IN_PROGRESS, assigned_to: Developer

4. IMPLEMENTATION PIPELINE
   - Developer calls start_pipeline(WP-001, type: "implementation")
   → Pipeline created: {type: implementation, status: IN_PROGRESS}
   → WP-001 assigned_to: Developer
   - Developer does work, then calls complete_pipeline(WP-001, type: "implementation", status: PASS, summary: [...], handoff_notes: [...])
   → Pipeline status: PASS, completed_at set
   → HandoffNote appended: {from: Developer, to: QA, notes: [...]}
   - Developer calls get_handoff_status(current_agent: "Developer")
   → Response: {status: READY_FOR_QA, next_agent: QA}

5. QA PIPELINE
   - QA calls get_next_action(agent_role: "QA")
   → Response: {action: RUN_QA, work_package_id: WP-001, handoff_notes: [...]}
   - QA calls start_pipeline(WP-001, type: "qa")
   → WP-001 assigned_to: QA
   - QA verifies, then calls complete_pipeline(WP-001, type: "qa", status: PASS, ...)
   - QA calls get_handoff_status(current_agent: "QA")
   → Response: {status: READY_FOR_REVIEW, next_agent: Reviewer}

6. CODE REVIEW PIPELINE
   - Reviewer calls start_pipeline(WP-001, type: "code-review")
   → WP-001 assigned_to: Reviewer
   - Reviewer reviews, then completes with PASS
   - Reviewer calls get_handoff_status
   → {status: READY_FOR_DOCUMENTATION, next_agent: Documentation}

7. DOCUMENTATION PIPELINE
   - Documentation calls start_pipeline(WP-001, type: "documentation")
   → WP-001 assigned_to: Documentation
   - Documentation updates docs, completes with PASS
   - Documentation calls update_work_package_status(WP-001, status: COMPLETE, agent: "Documentation")
   → WP-001 status: COMPLETE
   → pending_work_packages: 0
   → auto_handoff_depth reset to 0
   - Documentation calls get_handoff_status
   → {status: READY_FOR_SYNTHESIS, next_agent: Synthesis}

8. SYNTHESIS
   - Synthesis calls get_next_action(agent_role: "Synthesis")
   → {action: GENERATE_SYNTHESIS}  (synthesis_generated absent/false)
   - Synthesis generates report
   - Synthesis calls ledger_complete_synthesis(project_path)
   → synthesis_generated: true, project status: COMPLETE
   - Synthesis calls get_handoff_status
   → {status: COMPLETE}
```

### 13.2 Rework Path (QA Failure)

```
... after step 4 (implementation PASS) ...

5. QA PIPELINE (FAIL)
   - QA runs validation, finds issues
   - QA calls complete_pipeline(WP-001, type: "qa", status: FAIL, summary: ["Test X failed"], handoff_notes: ["Fix test X"])
   → Pipeline status: FAIL
   → HandoffNote: {from: QA, to: Developer, notes: [...]}  ← per FAIL_ROUTING_MAP
   - QA calls get_handoff_status(current_agent: "QA")
   → {status: READY_FOR_DEVELOPER, next_agent: Developer}
   
   NOTE: Handoff note to_agent is determined by FAIL_ROUTING_MAP (not NEXT_AGENT_MAP) on FAIL.
   QA/Reviewer/implementation FAIL routes to Developer. Documentation FAIL routes to Documentation (self-rework).
   QA does NOT self-rework — it returns WAIT via get_next_action, yielding to the Developer.

6. DEVELOPER REWORK
   - Developer calls get_next_action(agent_role: "Developer")
   → {action: REWORK, work_package_id: WP-001, pipeline_that_failed: "qa"}
   - Developer calls start_pipeline(WP-001, type: "implementation")
   → New implementation pipeline created (IN_PROGRESS)
   NOTE: rework_count only increments if the most recent pipeline of that same type has FAIL status.
         In this case the impl pipeline was PASS, so rework_count is NOT incremented.
         rework_count would increment on the qa pipeline when QA retries after developer fix.
   - Developer fixes, completes implementation with PASS
   - QA sees new upstream PASS (via hasNewUpstreamPassSince) → runs QA again

7. QA PIPELINE (PASS, second attempt)
   - QA calls start_pipeline(WP-001, type: "qa")
   → rework_count IS incremented (most recent qa pipeline was FAIL)
   - QA passes → continue to Reviewer...
```

### 13.3 Multi-WP with Dependencies

```
1. PM creates:
   - WP-001: dependencies: []      → status: READY
   - WP-002: dependencies: [WP-001] → status: BLOCKED

2. Developer implements WP-001 through full pipeline chain
   → WP-001 status: COMPLETE
   → Auto-unblock: WP-002 transitions BLOCKED → READY (all deps COMPLETE)

3. Developer picks up WP-002 (now READY)
   → Process repeats for WP-002
```

---

## 14. Edge Cases & Failure Modes

### 14.1 Stale Pipeline Recovery

**Scenario:** Agent crashes mid-pipeline, leaving a pipeline IN_PROGRESS for >24 hours.

**Detection:** Next-action computation checks `started_at` age.

**Resolution:** Agent receives `RESUME_OR_CANCEL` action. Agent must either:
- Resume the pipeline (continue working and complete it), or
- Cancel it via `cancel_pipeline(reason)` → pipeline set to FAIL → fresh pipeline can start.

### 14.2 Duplicate Pipeline Prevention

**Scenario:** Agent tries to start a pipeline type that already has an IN_PROGRESS entry.

**Result:** Error — "No duplicate IN_PROGRESS pipelines." Agent must complete or cancel the existing one first.

### 14.3 Out-of-Order Pipeline Start

**Scenario:** Agent tries to start `qa` before `implementation` has a PASS.

**Result:** Error — "Cannot start 'qa' pipeline: requires a PASS 'implementation' pipeline first."

### 14.4 Non-Documentation Agent Tries COMPLETE

**Scenario:** Developer calls `update_work_package_status(status: COMPLETE)`.

**Result:** Error with full workflow reminder explaining the correct pipeline chain.

### 14.5 Unmet Acceptance Criteria

**Scenario:** Documentation agent tries to mark WP COMPLETE but 2 of 5 criteria are not met.

**Result:** Error listing the specific unmet criteria.

### 14.6 Cross-Agent WP Claim

**Scenario:** QA agent tries to claim WP-002 which is assigned to Developer.

**Result:** Error — "Cannot claim WP-002: it is assigned to Developer but you are QA." Must pass `override: true` to force.

### 14.7 Blocking Without Blocker Details

**Scenario:** Agent transitions WP to BLOCKED without providing `blocked_by`.

**Result:** Error — "Cannot transition to BLOCKED status without providing blocked_by information."

### 14.8 Dependency on Non-Existent WP

**Scenario:** PM creates WP-003 with dependency on WP-999 which doesn't exist.

**Result:** Error at creation time — dependency validation fails.

### 14.9 Cascade Unblock Timing

**Scenario:** WP-001 completes. WP-002 (depends on WP-001) and WP-003 (depends on WP-001 and WP-002) are both BLOCKED.

**Result:**
- WP-002 is unblocked → READY (all deps — just WP-001 — are COMPLETE).
- WP-003 stays BLOCKED (WP-002 is now READY, not COMPLETE).
- WP-003 will unblock only when WP-002 reaches COMPLETE.

### 14.10 Counter Drift

**Scenario:** A bug causes `pending_work_packages` to be incorrect.

**Result:** `get_project_status` auto-corrects the counter on next read. No data loss.

### 14.11 Status Drift (Project-Level)

**Scenario:** Project status is COMPLETE but a WP was reopened.

**Result:** `get_project_status` detects `pending > 0` while status is COMPLETE → heals to IN_PROGRESS.

### 14.12 All Remaining WPs Are Dependency-Blocked

**Scenario:** QA finishes all implementable WPs. Only WPs blocked by incomplete dependencies remain.

**Result:** Handoff returns `READY_FOR_REVIEW` (not `READY_FOR_DEVELOPER`), because dependency-blocked WPs are excluded from "work remaining." The workflow progresses forward for completed WPs rather than stalling.

### 14.13 Empty Project

**Scenario:** Project initialized but no WPs created yet.

**Result:**
- PM gets `CREATE_WORK_PACKAGES` from next-action.
- All other agents get `WAIT`.
- Project is never auto-healed to COMPLETE.

### 14.14 Auto-Handoff Depth Exceeded

**Scenario:** 10 consecutive agent handoffs have occurred.

**Result:** `auto_handoff` key is silently omitted from the next response. No error. Human must manually invoke the next agent.

### 14.15 Developer Gets Rework from Downstream FAIL

**Scenario:** Developer completed implementation PASS, but QA failed, or Reviewer rejected the code.

**Result:** Developer's next-action detects the downstream FAIL (qa or code-review with most-recent FAIL) and returns `REWORK` with `pipeline_that_failed` indicating which downstream stage rejected.

### 14.16 Pipeline History: FAIL then PASS

**Scenario:** `implementation` pipeline history is `[FAIL, PASS]` (developer fixed it).

**Result:** `isMostRecentPipelineFail` returns `false` — no rework action. The PASS indicates the issue was resolved.

### 14.17 Circular Dependency Prevention

**Scenario:** An agent tries to create a WP that would form a dependency cycle (e.g., WP-A depends on WP-B which depends on WP-A).

**Result:** This scenario is impossible by construction. All dependency targets must already exist in the root index at WP creation time, and dependencies are immutable after creation. A newly created WP cannot be referenced by any of its own dependencies because it did not exist when those WPs were created. Therefore, cycles cannot form — no runtime cycle detection is required or performed. See §9.1 for full rationale.

---

## 15. Invariants & Assertions

These properties must hold at all times. Violation indicates a bug.

### Data Invariants

1. **WP ID format:** Every `work_package_id` matches `/^WP-\d{3,}$/` (3 or more digits, supporting IDs from WP-001 through WP-9999+).
2. **Summary-detail sync:** For every WP, `root.work_packages[i].status == wp_detail.status` and `root.work_packages[i].assigned_to == wp_detail.assigned_to`.
3. **Counter correctness:** `root.total_work_packages == root.work_packages.length` and `root.pending_work_packages == count(status != COMPLETE)`.
4. **Timestamp format:** All timestamps follow `YYYY-MM-DDTHH:MM:SSZ` (UTC, ISO 8601). Legacy formats (`YYYY-MM-DD HH:MM:SS` without Z) are accepted by `parseTimestamp()` for backward compatibility.
5. **No orphan WPs:** Every WP referenced in the root index has a corresponding detail file.
6. **No dangling dependencies:** Every WP ID in a `dependencies` array exists in the root index.
7. **Pipeline ordering:** A WP cannot have a PASS `qa` pipeline without a PASS `implementation` pipeline (and so on up the chain).

### Transition Invariants

8. **COMPLETE requires Documentation:** Only Documentation agent can transition WP to COMPLETE.
9. **BLOCKED requires blocker:** Every BLOCKED WP has a non-null `blocked_by`.
10. **READY has no blocker:** A READY WP has no `blocked_by` (cleared on unblock).
11. **Revision monotonic:** `revision` only increases, never decreases.
12. **Single IN_PROGRESS per type:** At most one pipeline of each type can be IN_PROGRESS at a time per WP.

### Concurrency Invariants

13. **Dual-file atomicity:** Root index and WP detail are always written within the same lock scope (except during auto-unblock, which acquires its own lock).
14. **Idempotent unblock:** Running dependency auto-unblock on an already-READY WP is a no-op.

---

_End of specification._
