# MCP Server - Workflow Spec (State & Data)
<INSTRUCTION>
# MCP Server - Workflow Spec: State Machines & Data Model
Specification overview, project/WP/pipeline lifecycle state machines, and the complete ledger data model.

</INSTRUCTION>
------------------------------------------------------------
```
// Structure of documents
└── mcp-server/
    └── docs/
        └── agents/
            └── workflow-specification/
                └── README.md

```
###  Path: `/mcp-server/docs/agents/workflow-specification/README.md`

```md
# Agent Workflow Specification

> **Purpose:** This document is the **authoritative specification** of the 9-agent dynamic pipeline workflow. It defines all state machines, handoff logic, pipeline orchestration, edge cases, and invariants. Implementation code (TypeScript MCP server, Python orchestrator) and tests are **validated against this specification**. It also serves as a language-agnostic reference for porting the workflow logic to additional runtimes.

**Version:** 2.5.1
**Date:** 2026-05-30

---

## Changelog

### v2.5.1 - Mixed-Routing Forward Progress

- **Next-stage routing clarified (§13.1):** When multiple ready WPs route to different next agents (e.g., QA handoff with one WP routing to Security Auditor and another to Reviewer), the handoff returns the first ready WP's `READY_FOR_*` status rather than `WAIT`. Remaining WPs are dispatched via subsequent per-agent handoff calls — each agent's `getNextAction` is role-scoped, so dispatching the first agent never misroutes the other WPs. This eliminates false WAIT states that caused IDE stalls in mixed-stage projects.
- **Design notes added (§13.1):** Added mixed-routing design notes to the QA and Reviewer handoff pseudocode blocks documenting the first-match dispatch behavior and its safety guarantees.

### v2.5.0 - Cross-WP Dispatch from Non-PM Agents

- **`findNextReadyDispatch()` helper (§13.5):** Introduced as the shared implementation for cross-WP dispatch used by the five non-PM pipeline agent handoff functions (QA, Security Auditor, Reviewer, Release Engineer, Documentation). The helper scans all READY, non-dependency-blocked WPs and routes to `PIPELINE_AGENT_MAP[firstActiveStage(wp)]`, preventing IDE workflow stalls when a non-PM agent's role-specific work is done but other READY WPs have not yet started any pipelines. Returns `READY_FOR_SYNTHESIS` when all WPs are terminal; returns `null` when no deterministic dispatch is possible (caller falls through to WAIT).
- **Five handoff functions updated (§13.1):** QA, Security Auditor, Reviewer, Release Engineer, and Documentation handoff functions each call `findNextReadyDispatch()` as the penultimate step (immediately before their final `return WAIT`). This closes the IDE stall gap documented in §21.71.
- **Spec pseudocode updated (§13.5):** Corrected the `findNextReadyDispatch` pseudocode to match the implementation: (a) the helper does NOT consult `wp.assigned_to` — routing is always via `PIPELINE_AGENT_MAP[firstActiveStage(wp)]`; (b) the helper accepts a `currentRole` parameter used only for the diagnostic `reason` string; (c) the all-terminal branch is guarded by a non-empty `wpDetails` check to prevent false `READY_FOR_SYNTHESIS` on empty projects; (d) dependency-blocked WPs are excluded from the READY scan via `!isBlockedByDependencies(wp)`.
- **Release Engineer all-terminal asymmetry documented (§13.1):** Added a design note explaining that `getReleaseEngineerHandoff` scopes its all-terminal early-exit to `releaseWps` (not `wpDetails`), unlike the other four handoff functions. `findNextReadyDispatch()` serves as a safety net for zero-release-stage projects. Behaviour is functionally correct in all non-degenerate configurations.
- **New edge case:** §21.71 (Cross-WP Dispatch from Non-PM Agents) — documents the stall scenario, the `findNextReadyDispatch` resolution, self-routing design decision, and invariants. *(Note: §21.71 was pre-populated in the spec prior to implementation; this version marks it as the authoritative implementation record.)*

### v2.4.3 - PM Pipeline-Routing for IN_PROGRESS WPs
- **PM Handoff step 2b (§13.1):** Added a new step 2b to the Project Manager Handoff algorithm, positioned between step 2 (READY WPs) and step 3 (all terminal). Step 2b scans non-terminal, non-dependency-blocked IN_PROGRESS WPs for pipeline stage transitions and routes to `PIPELINE_AGENT_MAP[nextStage]`. This closes the auto-handoff gap where the PM returned WAIT after a pipeline stage PASSed but no READY WPs remained, leaving no agent to dispatch to.
- **PM Action priority 3d (§14.1.2):** Added `ROUTE_PIPELINE_AGENT` as priority 3d in the PM recommendation engine, positioned after `REPAIR_ORPHAN_BLOCKED` (3c) and before `CREATE_WORK_PACKAGES` (4). Applies the same stage-scanning logic as §13.1 step 2b to the recommendation path.
- **Design notes (§13.1):** Added two design notes to the PM Handoff section explaining (a) the PM's prior blindness to intra-WP pipeline transitions and how step 2b resolves it, and (b) freshly-claimed WP coverage — WPs with zero pipelines are routed immediately to their first-active-stage agent, with REVIEW_ABANDONED still covering the staleness-threshold fallback.
- **New edge case:** §21.70 (PM Pipeline-Routing for IN_PROGRESS WPs) — documents both covered scenarios (stage PASS → next stage, and zero-pipeline freshly-claimed WP), the four guards applied, and the priority ordering rationale.

### v2.4.2 - Handoff Handler Active-Stage Scoping
- **Handoff scope filters (§13.1):** Added explicit `active_pipeline_stages` scoping to Developer, QA, Reviewer, and Documentation handoff functions. Pipeline-specific conditions now include `with "<type>" in activeStages`, matching the pattern established by Security Auditor and Release Engineer handlers in v2.4.0. Without this scoping, non-default WP compositions (e.g., documentation-only) were misclassified as `IN_PROGRESS` by pipeline handlers that have no work on those WPs, suppressing auto-handoff.
- **Documentation handoff null-prerequisite (§13.1):** Defined `hasPassEffectiveUpstream` as vacuously true when `resolvePrerequisite` returns `null` (documentation is the first or only active stage), consistent with `canStartPipeline` (§8.2).
- **PM handoff dynamic routing (§13.1):** Replaced hardcoded `READY_FOR_DEVELOPER` fallback for unassigned READY WPs with `readyStatusForAgent(PIPELINE_AGENT_MAP[firstActiveStage(wp)])`, routing to the agent owning the WP's first active stage.
- **New edge case:** §21.69 (Handoff Handler Active-Stage Scoping) — documents the invariant, consequences of violation, and correct pattern.

### v2.4.1 - Spec-Implementation Sync Fixes
- **Re-validation guard fix (§11.1):** Made the upstream rework check unconditional — it now fires regardless of whether the current pipeline type has prior runs. Previously, first-run scenarios were short-circuited, allowing stage-skipping (e.g., code-review starting for the first time while a new implementation pipeline is in progress). The two-layer guard structure is preserved: layer 1 (unconditional upstream rework) fires first, layer 2 (temporal consistency for same-type re-runs) handles self-rework allowance.
- **Downstream fail active-stages fix (§11.1):** `hasDownstreamFail` in `startPipeline` rework detection now receives the WP's `activeStages`, ensuring rework is correctly detected for WPs with optional stages (security-audit, release-engineering) active.
- **Artifact soft warning persisted (§12.1):** `completePipeline` now persists the empty-artifacts soft warning as a project comment (in addition to the response text), matching the §12.1 specification.
- **Handoff depth multiplier increased (§18.2.1):** Updated formula from `total_work_packages × 20` to `total_work_packages × 30`, matching the implementation. Operational experience showed the original multiplier was insufficient for projects with complex rework patterns and wasted handoff cycles.
- **`getDownstreamTypes`/`getUpstreamTypes` default aligned (§8.4, §8.5):** Spec pseudocode updated to default to `DEFAULT_PIPELINE_STAGES` (not `CANONICAL_PIPELINE_ORDERING`) when `activeStages` is omitted, matching the implementation's backward-compatible behavior.

### v2.4.0 - PM-Composable Pipeline Stages
- **Breaking conceptual change:** Removed the mandatory/optional pipeline stage distinction. All six stages are now PM-composable — the Project Manager selects any valid subsequence of the canonical ordering per WP. The former `MANDATORY_PIPELINE_TYPES` and `OPTIONAL_PIPELINE_TYPES` constants are retired and replaced by `DEFAULT_PIPELINE_STAGES` (§4.2).
- **Generalized COMPLETE guard:** The `IN_PROGRESS → COMPLETE` transition is no longer hardcoded to the Documentation agent. The agent owning the WP's **last active stage** is now the terminal agent. Added `firstActiveStage`/`lastActiveStage` helpers (§6.2.1). Freshness check generalized from documentation-vs-implementation to lastActiveStage-vs-firstActiveStage.
- **Generalized FAIL routing:** Added `resolveFailAgent` function (§9.3.1) with fallback rule — when the standard FAIL target's stage is not active, route to the first active stage's agent.
- **Soft guardrails:** `validateActiveStages` (§9b.2) no longer rejects non-mandatory compositions. Instead, hard rejects catch structural errors (invalid types, duplicates, out-of-order, empty) while soft guardrails emit warning project comments for unusual compositions (implementation without QA, single-stage chains, non-default compositions).
- **Artifact declaration:** `completePipeline` (§12.1) now emits a soft warning when a PASS result declares no `artifacts.files_modified`.
- **New edge cases:** §21.60 (single-stage WP semantics), §21.61 (documentation-only WP), §21.62 (verification-only WP), §21.63 (FAIL routing fallback semantics), §21.64 (artifact declaration soft warning).
- **Updated edge cases:** §21.10 generalized from "Documentation-Only COMPLETE Guard" to "Generalized COMPLETE Guard". §21.55 renamed from "Optional Pipeline Stage Backward Compatibility" to "Pipeline Stage Backward Compatibility".
- **Updated appendices:** Appendix A adds `DEFAULT_PIPELINE_STAGES` and `CANONICAL_PIPELINE_ORDERING` constants. Appendix C adds soft warning conditions table.

### v2.3.0 - Synthesis Timestamp, Ledger Versioning, Cross-WP Staleness
- Added `synthesis_generated_at` timestamp to root index (§3.1, §19.1, §21.57): records when synthesis was last completed, enabling staleness detection and observability. Cleared alongside `synthesis_generated` on all reset paths (§6.2, §15.5, §21.51).
- Added `ledger_version` field to root index (§3.1, §21.58): records the specification version that created the ledger, enabling forward-compatible migrations when the spec evolves.
- Added §21.59 (Cross-WP Staleness After Dependency Reopens): documents the compounding staleness gap in transitive dependency chains after a WP reopen, and recommends a `completePipeline` dependency freshness check as a lightweight mitigation.

### v2.2.0 - Audit Fixes
- Fixed first-run stage-skipping exploit: upstream rework check is now unconditional, no longer gated by `effectiveSamePipelines` being non-empty (§11.1, §11.1.1).
- Fixed dangling `IN_PROGRESS` pipelines on `COMPLETE`: added guard rejecting the transition when any pipeline is still `IN_PROGRESS` (§10b.1).
- Removed `hasDownstreamFail` wrapper from re-validation guard: `hasUpstreamRework` alone correctly distinguishes self-rework from genuine upstream invalidation, eliminating the documented "Known limitation — WP reopen scenario" (§11.1, §11.1.1, §21.22).
- Updated §21.42 and §21.48 references to reflect the improved re-validation guard coverage.

### v2.1.0 - Agent Extension
- Additional agents in the workflow.
- Review cycle 1.

### v2.0.0 - Fully Reviewed
- Fully LLM-reviewed and solid after 20+ cycles.

### v1.0.0 - Initial Version
- As extracted from the Ledger MCP logic.

---

## Table of Contents

| # | Document | Sections |
|---|----------|----------|
| 1 | [Data Model](data-model.md) | Glossary, Entities & Data Model, Agent Roles |
| 2 | [State Machines](state-machines.md) | Project Lifecycle, Work Package State Machine, Pipeline State Machine |
| 3 | [Pipeline Routing](pipeline-routing.md) | Pipeline Ordering & Prerequisites, Pipeline Routing Maps |
| 4 | [Operations](operations.md) | Work Package Creation, Work Package Claiming, Updating Work Package Status, Starting a Pipeline, Completing a Pipeline |
| 5a | [Handoff Logic](handoff.md) | Per-Agent Handoff Functions, Evaluation Order, Dependency-Blocked WP Exclusion, Next Agent Resolution |
| 5b | [Recommendation Engine](recommendations.md) | Common Pre-checks, Role-Specific Action Logic, Helper Algorithms |
| 6 | [Dependencies & Rework](dependencies-and-rework.md) | Dependency Management, Rework & Circuit Breaker |
| 7 | [Auxiliary Systems](auxiliary-systems.md) | Self-Healing, Auto-Handoff Depth Counter, Synthesis Completion, Concurrency Model |
| 8 | [Edge Cases](edge-cases.md) | Edge Cases & Invariants |
| 9 | [Walkthrough](walkthrough.md) | Complete Workflow Walkthrough, Appendices (Constants, Action Types, Error Conditions) |

---

## Quick Section Reference

Use the original section numbers to find content across the split files:

| § | Title | File |
|---|-------|------|
| 1 | Overview | This README |
| 2 | Glossary | [data-model.md](data-model.md) |
| 3 | Entities & Data Model | [data-model.md](data-model.md) |
| 4 | Agent Roles | [data-model.md](data-model.md) |
| 5 | Project Lifecycle | [state-machines.md](state-machines.md) |
| 6 | Work Package State Machine | [state-machines.md](state-machines.md) |
| 7 | Pipeline State Machine | [state-machines.md](state-machines.md) |
| 8 | Pipeline Ordering & Prerequisites | [pipeline-routing.md](pipeline-routing.md) |
| 9 | Pipeline Routing Maps | [pipeline-routing.md](pipeline-routing.md) |
| 9b | Work Package Creation | [operations.md](operations.md) |
| 10 | Work Package Claiming | [operations.md](operations.md) |
| 10b | Updating Work Package Status | [operations.md](operations.md) |
| 11 | Starting a Pipeline | [operations.md](operations.md) |
| 12 | Completing a Pipeline | [operations.md](operations.md) |
| 13 | Handoff Logic | [handoff.md](handoff.md) |
| 14 | Next-Action Recommendation Engine | [recommendations.md](recommendations.md) |
| 15 | Dependency Management | [dependencies-and-rework.md](dependencies-and-rework.md) |
| 16 | Rework & Circuit Breaker | [dependencies-and-rework.md](dependencies-and-rework.md) |
| 17 | Self-Healing | [auxiliary-systems.md](auxiliary-systems.md) |
| 18 | Auto-Handoff Depth Counter | [auxiliary-systems.md](auxiliary-systems.md) |
| 19 | Synthesis Completion | [auxiliary-systems.md](auxiliary-systems.md) |
| 20 | Concurrency Model | [auxiliary-systems.md](auxiliary-systems.md) |
| 21 | Edge Cases & Invariants | [edge-cases.md](edge-cases.md) |
| 22 | Complete Workflow Walkthrough | [walkthrough.md](walkthrough.md) |
| A | Constant Reference | [walkthrough.md](walkthrough.md) |
| B | Action Types Reference | [walkthrough.md](walkthrough.md) |
| C | Error Conditions Summary | [walkthrough.md](walkthrough.md) |

---

## 1. Overview

The workflow orchestrates **nine specialized agent roles** to execute software development tasks. A **centralized ledger** persists project state, enabling agents to collaborate across independent sessions without losing context.

The core progression is:

```
Planner → Project Manager → [ Developer → QA → Security Auditor → Reviewer → Release Engineer → Documentation ] → Synthesis
```

All six pipeline stages are **PM-composable** — the Project Manager selects which stages are active for each work package at creation time via the `active_pipeline_stages` field. The default set (`DEFAULT_PIPELINE_STAGES`) is `["implementation", "qa", "code-review", "documentation"]`, providing backward compatibility. The PM may compose any valid subsequence of the canonical ordering, from a single stage (e.g., documentation-only) to all six stages.

Work is organized into **work packages** (WPs), each of which progresses through a configurable sequence of **pipelines**:

```
implementation → qa → security-audit → code-review → release-engineering → documentation
```

Each pipeline is owned by a single agent role. Failures route back for rework (to Developer for QA/security-audit/code-review FAILs; to self for documentation/release-engineering FAILs; with a fallback to the first active stage's agent when the standard target's stage is not active). The system enforces ordering, validates transitions, and manages handoffs automatically. Dynamic routing functions (`resolvePrerequisite`, `resolveNextAgent`, `resolveFailAgent`) adapt the pipeline chain per WP based on its active stages.

---

## Machine-Readable Vocabulary

`shared/workflow-manifest.json` is the **machine-readable encoding** of this specification's vocabulary. It captures the specification-derived constructs that must be consistent across all implementations (TypeScript MCP server, Python orchestrator, persona build system):

| Construct | Manifest field | Consumers |
|-----------|---------------|----------|
| Agent role names & IDs | `roles[].name`, `roles[].id` | `src/utils/constants.ts` → `AGENT_ROLES`, `ROLE_IDS`; `scripts/sync-personas.js` → `KNOWN_ROLES`; persona YAML `role` fields (validated by `build-personas.js`) |
| Orchestrating roles | `roles[].orchestrating` | `src/utils/constants.ts` → `ORCHESTRATING_ROLES` |
| Pipeline types & canonical order | `pipelines.canonical_order` | `src/utils/pipeline-maps.ts` → `PIPELINE_TYPES`, `CANONICAL_PIPELINE_ORDERING` |
| Default pipeline stages | `pipelines.default_stages` | `src/utils/pipeline-maps.ts` → `DEFAULT_PIPELINE_STAGES` |
| Pipeline → agent mapping | `pipelines.agent_map` | `src/utils/pipeline-maps.ts` → `PIPELINE_AGENT_MAP` |
| Specification version | `spec_version` | `src/utils/constants.ts` → `SPEC_VERSION` |
| Status enums | `statuses.*` | `src/schema/enums.ts` |

When this specification changes vocabulary (e.g., adding a role, renaming a pipeline type), update `shared/workflow-manifest.json` first — all consumers derive their constants from it at build/load time.

The manifest is validated structurally by `shared/workflow-manifest.schema.json` (JSON Schema Draft-07) and semantically by `scripts/validate-workflow-manifest.js`.

---

## Compliance Model

> **This specification is the single source of truth for all workflow logic.**

### Authority Hierarchy

| Layer | Document | Authority |
|-------|----------|-----------|
| **Specification** | This document (all sections) | Defines how the workflow **must** behave. Authoritative. |
| **Implementation** | `mcp-server/src/` (TypeScript) | Implements the specification. Must conform to it. |
| **Tests** | `mcp-server/tests/` | Validates that the implementation conforms to the specification. |
| **Project Manifest** | `mcp-server/docs/agents/project-manifest/` | Documents how the implementation currently works. Descriptive, not prescriptive for workflow logic. |
| **Orchestrator** | `orchestrator/src/` (Python) | Alternate implementation. Must also conform to this specification. |

### Rules

1. **Spec-first development.** All changes to pipeline types, routing maps, state machines, operational algorithms, edge-case behavior, and constant values MUST be made in this specification first. Implementation follows.
2. **Code ≠ truth.** When implementation code contradicts this specification, the **code is wrong** unless the specification is explicitly amended first.
3. **Tests validate the spec, not the code.** Test assertions must reflect the behavior defined in this specification. A passing test that diverges from the spec is a **false positive** and must be corrected.
4. **Spec-section traceability.** Test descriptions SHOULD reference the specification section they validate (e.g., `§8.2`, `§14.13 row 1`). This enables automated auditing of spec coverage and makes the test's authority explicit.
5. **Implementation notes within the spec.** Where the specification references implementation details (e.g., specific TypeScript exports), these are illustrative, not authoritative. If the implementation changes its internal structure, the spec's algorithmic definitions remain the authority; the implementation notes should be updated to match. *Example: if `CLAIMABLE_ROLES` is refactored into a different module, the algorithm defined in §10.1 remains authoritative — only the implementation note pointing to its location needs updating.*
6. **Manifest documents the implementation.** The project manifest (`api-surface.md`, `constraints.md`, etc.) describes the current state of the code. When the specification changes, the implementation changes, and the manifest is updated to reflect the new implementation — in that order.

```
```
// Structure of documents
└── mcp-server/
    └── docs/
        └── agents/
            └── workflow-specification/
                └── state-machines.md

```
###  Path: `/mcp-server/docs/agents/workflow-specification/state-machines.md`

```md
# State Machines

> Part of the [Agent Workflow Specification](README.md).

---

## 5. Project Lifecycle

### 5.1 Initialization

```
Input: project_path, plan_file
Precondition: No ledger exists for this project

Steps:
  1. Derive slug from project_path (folder basename)
  2. Create root index with:
     - status = READY
     - total_work_packages = 0
     - pending_work_packages = 0
     - work_packages = []
     - project_comments = []
  3. Create project metadata file (.meta.json) alongside root index
  4. Return root index

Error: Reject if ledger already exists
```

### 5.2 Project Status Values

| Status | Meaning |
|--------|---------|
| `READY` | No WP is `IN_PROGRESS`; at least one WP is `READY` or no WPs exist yet. Also the initial status after project initialization. May be reached after work has started (e.g., via auto-unblock §15.4 or self-healing §17.2 rule 4b/6b). |
| `IN_PROGRESS` | At least one WP is being worked on, OR all WPs are terminal but synthesis has not yet been generated (see §17.2 rules 1b/1c/5b) |
| `COMPLETE` | All WPs terminal AND synthesis generated |
| `BLOCKED` | All non-terminal WPs are `BLOCKED` (equivalently: no WP is `IN_PROGRESS` or `READY`) |

### 5.3 Automatic Project Status Transitions

Project status updates are **implicit** — they happen as side effects of WP operations:

- Project transitions to `IN_PROGRESS` when first WP is claimed (`READY → IN_PROGRESS`) by an agent
- Project transitions to `BLOCKED` when a WP transitions to `BLOCKED` AND no other WP is `IN_PROGRESS` or `READY`
- Project transitions **out of** `BLOCKED` when:
  - A previously-blocked WP is unblocked (auto or manual) AND at least one WP is now `IN_PROGRESS` → project becomes `IN_PROGRESS`
  - A previously-blocked WP is unblocked AND at least one WP is `READY` (none `IN_PROGRESS`) → project becomes `READY`
  - All WPs reach terminal status → project follows the completion path below
- Project remains (or transitions to) `IN_PROGRESS` when all WPs reach terminal status but `synthesis_generated` is still `false` — this "awaiting synthesis" sub-state means no WP is actively being worked on, but the project cannot be `COMPLETE` until the Synthesis agent runs. See self-healing rules 1b/1c/5b in [§17.2](auxiliary-systems.md#172-healing-rules-applied-in-order--first-match-wins) for the formal conditions
- Project transitions to `COMPLETE` when synthesis is marked complete AND all WPs are terminal
- Project status is also governed by self-healing rules (see [§17](auxiliary-systems.md#17-self-healing))

---

## 6. Work Package State Machine

### 6.1 States

| State | Terminal? | Description |
|-------|-----------|-------------|
| `READY` | No | Available to be claimed |
| `IN_PROGRESS` | No | Being actively worked on |
| `BLOCKED` | No | Waiting on a dependency or external factor |
| `COMPLETE` | Normally | All criteria met, documentation done. May be reopened by PM or Documentation (see §6.2). |
| `CANCELLED` | Yes | Abandoned; satisfies dependencies like COMPLETE |

### 6.2 Transition Table

```
┌───────────────┬────────────────┬──────────────────────────────────────────────────┐
│ From          │ To             │ Conditions & Guards                              │
├───────────────┼────────────────┼──────────────────────────────────────────────────┤
│ READY         → IN_PROGRESS    │ All dependencies must be COMPLETE or CANCELLED   │
│ READY         → BLOCKED        │ Must provide blocked_by object                   │
│               │                │ Preserves assigned_to                            │
│               │                │ Any agent may invoke (see §6.5 design note)      │
│ READY         → CANCELLED      │ Agent must be "Project Manager"                  │
├───────────────┼────────────────┼──────────────────────────────────────────────────┤
│ IN_PROGRESS   → COMPLETE       │ All acceptance criteria met = true               │
│               │                │ Most recent pipeline of the WP's **last active    │
│               │                │ stage** is PASS                                   │
│               │                │ That PASS must post-date the most recent          │
│               │                │ pipeline start of the WP's **first active stage** │
│               │                │ (freshness check; passes vacuously if no pipeline │
│               │                │ of the first active stage exists — see §21.10)    │
│               │                │ Agent must own the WP's **last active stage**     │
│               │                │ (i.e. PIPELINE_AGENT_MAP[lastActiveStage])        │
│ IN_PROGRESS   → READY          │ No IN_PROGRESS pipelines on the WP              │
│               │                │ Agent must be "Project Manager" or current       │
│               │                │ assignee (wp.assigned_to)                        │
│               │                │ Clears assigned_to                               │
│ IN_PROGRESS   → BLOCKED        │ Must provide blocked_by object                   │
│               │                │ All IN_PROGRESS pipelines set to FAIL            │
│               │                │ (with auto_cancelled = true; see §21.27)         │
│               │                │ Preserves assigned_to                            │
│               │                │ Any agent may invoke (see §6.5 design note)      │
│ IN_PROGRESS   → CANCELLED      │ Agent must be "Project Manager"                  │
│               │                │ All IN_PROGRESS pipelines set to FAIL            │
│               │                │ (with auto_cancelled = true; see §21.27)         │
├───────────────┼────────────────┼──────────────────────────────────────────────────┤
│ BLOCKED       → IN_PROGRESS    │ Agent must be "Project Manager", current         │
│               │                │ assignee (wp.assigned_to), or system              │
│               │                │ Clears blocked_by field                          │
│ BLOCKED       → READY          │ System-only (auto-unblock path from §15.4)       │
│               │                │ Clears blocked_by field                          │
│ BLOCKED       → CANCELLED      │ Agent must be "Project Manager"                  │
├───────────────┼────────────────┼──────────────────────────────────────────────────┤
│ COMPLETE      → IN_PROGRESS    │ Agent must be "Project Manager" or               │
│               │                │ agent owning the WP's last active stage           │
│               │                │ Increments revision counter                      │
│               │                │ Resets rework_counts to absent (see §21.44)      │
│               │                │ Resets project synthesis_generated to false       │
│               │                │ Clears synthesis_generated_at (§21.57)            │
│               │                │ Triggers cascade reblock of dependents           │
│ COMPLETE      → CANCELLED      │ Agent must be "Project Manager"                  │
│               │                │ No counter change (terminal → terminal)          │
│               │                │ No cascade reblock (CANCELLED satisfies deps)    │
├───────────────┼────────────────┼──────────────────────────────────────────────────┤
│ CANCELLED     → (none)         │ Terminal — no outward transitions                │
└───────────────┴────────────────┴──────────────────────────────────────────────────┘
```

Same-state transitions (e.g., READY → READY) are always valid (no-op) **except for transitions to guarded or terminal states**. Specifically:
- `CANCELLED → CANCELLED` is **not valid** — CANCELLED is strictly terminal with no outward transitions, including self-transitions (see [§21.32](edge-cases.md#2132-cancelled-self-transition-prohibition))
- `COMPLETE → COMPLETE` still requires the last-active-stage agent guard (agent identity check only — the full completion guards of acceptance criteria, last-active-stage pipeline PASS, and freshness check are **not** re-evaluated for same-state no-ops)
- `BLOCKED → BLOCKED` still requires a `blocked_by` object; the new blocker **replaces** the existing one
- All other same-state transitions are pure no-ops that skip validation

> **Same-state behavioral asymmetry:** `BLOCKED → BLOCKED` and `COMPLETE → COMPLETE` are both listed as same-state transitions, but they differ fundamentally in semantics. `BLOCKED → BLOCKED` is a **substantive operation** — it replaces the `blocked_by` payload, requires agent guards (PM or assignee), and enforces blocker-type transition rules (see §6.2 replacement rule). `COMPLETE → COMPLETE` is a **pure no-op** — only the agent identity is checked (must be the last-active-stage agent or PM); no data is modified. The asymmetry arises because BLOCKED carries mutable metadata (`blocked_by`) that same-state transitions can validly update, whereas COMPLETE has no analogous mutable field that a same-state call would change.

> **BLOCKED → BLOCKED agent guard:** The `BLOCKED → BLOCKED` same-state transition requires the agent to be the **Project Manager** or the **current assignee** (`wp.assigned_to`). This prevents arbitrary agents from modifying blockers on WPs they do not own, consistent with the agent guard philosophy applied to other transitions.
>
> **BLOCKED → BLOCKED replacement rule:** A `dependency` blocker **cannot** be overwritten with a non-dependency type (`decision`, `external`, `technical`) **unless the agent is the Project Manager**. This prevents auto-unblock logic (§15.4) from silently skipping a WP that was originally blocked by a dependency. The PM exception allows recording non-dependency blockers discovered after the initial dependency block; the PM accepts responsibility for managing the auto-unblock implications (the `dependency` auto-unblock will no longer fire for this WP). All other blocker-type changes are allowed (e.g., `technical` → `decision`, `external` → `dependency`).
>
> **⚠ Permission asymmetry — non-dependency → dependency re-classification:** The replacement rule is asymmetric: overwriting `dependency` with a non-dependency type requires PM, but overwriting a non-dependency type with `dependency` is allowed by any authorized agent (PM or assignee). This means an assignee can make a WP eligible for auto-unblock (§15.4) by re-classifying a PM-managed `technical` or `decision` blocker as `dependency`. If the referenced dependency has already reached terminal status, the re-classification does not trigger auto-unblock (see [§21.17](edge-cases.md#2117-blocked--blocked-blocker-replacement) for the latency issue), but a future dependency completion would auto-unblock the WP — potentially bypassing the PM's intended manual-resolution workflow. Implementations that require stricter control MAY extend the replacement rule to also require PM for non-dependency → `dependency` re-classification.

#### 6.2.1 Dynamic COMPLETE Guard Helpers

The COMPLETE guard references the WP's **first active stage** and **last active stage**. These are computed from `active_pipeline_stages`:

```
function firstActiveStage(wp):
  stages = wp.active_pipeline_stages ?? DEFAULT_PIPELINE_STAGES
  return stages[0]

function lastActiveStage(wp):
  stages = wp.active_pipeline_stages ?? DEFAULT_PIPELINE_STAGES
  return stages[stages.length - 1]
```

The **terminal agent** — the agent allowed to mark the WP as COMPLETE — is `PIPELINE_AGENT_MAP[lastActiveStage(wp)]`. For a default WP this is Documentation; for a documentation-only WP (`["documentation"]`), Documentation is both first and terminal; for a verification-only WP (`["qa", "code-review"]`) it is Reviewer.

The **freshness check** compares the most recent PASS of `lastActiveStage` against the most recent `started_at` of `firstActiveStage`. This generalizes the former documentation-vs-implementation comparison. When the first and last active stages are the same (single-stage WP), the freshness check passes vacuously — there is no earlier stage to compare against.

### 6.3 State Diagram

```
                     ┌─────────┐
             ┌──────►│  READY  │◄────────────────────────┐
             │       └─┬──┬──┬─┘                          │
             │         │  │  │                            │ (auto-unblock §15.4)
 (unclaim)   │         │  │  └──► BLOCKED ────────────────┤
             │         │  │         ├──► IN_PROGRESS      │
             │         │  │         │    (PM/assignee/    │
             │         │  │         │     system)         │
             │         │  │         └──► CANCELLED (PM)   │
             │         │  └────────► CANCELLED (PM only)  │
             │         ▼                                   │
        ┌────┴─────────────┐                               │
        │   IN_PROGRESS    ├──► BLOCKED ───────────────────┘
        │                  ├──► CANCELLED (PM only)
        └────────┬─────────┘
                 ▼
        ┌────────────────┐
        │    COMPLETE     ├──► IN_PROGRESS (reopen: PM or last-active-stage agent)
        │  (normally      ├──► CANCELLED (PM only; no cascade)
        │   terminal)     │
        └─────────────────┘

        CANCELLED: strictly terminal — no outward transitions
                   (including self-transitions).
```

> **Complete transition list** (all transitions from §6.2, for verification):
> - **READY →** IN_PROGRESS (claim), BLOCKED (any agent; requires blocker), CANCELLED (PM only)
> - **IN_PROGRESS →** COMPLETE (last-active-stage agent only), READY (unclaim), BLOCKED (any agent; requires blocker; auto-cancels pipelines), CANCELLED (PM only)
> - **BLOCKED →** IN_PROGRESS (PM/assignee/system), READY (auto-unblock only), CANCELLED (PM only)
> - **COMPLETE →** IN_PROGRESS (reopen: PM or last-active-stage agent), CANCELLED (PM only; no cascade)
> - **CANCELLED →** *(none; strictly terminal)*

### 6.4 Counter Updates on Transitions

| Transition | `pending_work_packages` Change |
|------------|-------------------------------|
| Non-terminal → COMPLETE | Decrement by 1 |
| Non-terminal → CANCELLED | Decrement by 1 |
| COMPLETE → IN_PROGRESS | Increment by 1 |
| COMPLETE → COMPLETE | No change (same-state no-op; §6.2 preempts counter logic) |
| COMPLETE → CANCELLED | No change (terminal → terminal) |
| CANCELLED → CANCELLED | N/A — transition rejected (§21.32) |
| All other transitions | No change |

### 6.5 Agent Guards

| Transition | Allowed Agents |
|------------|---------------|
| READY → IN_PROGRESS (claim) | Pipeline-owning agents (Developer, QA, Security Auditor, Reviewer, Release Engineer, Documentation), "Project Manager" (see [§10.1](operations.md#101-algorithm), [§21.49](edge-cases.md#2149-agent-role-guard-on-work-package-claiming)) |
| → COMPLETE | Agent owning the WP's last active stage (computed as `PIPELINE_AGENT_MAP[lastActiveStage(wp)]`), or "Project Manager" for same-state `COMPLETE → COMPLETE` only — for same-state `COMPLETE → COMPLETE`, only the agent identity check is enforced; the full completion guards (acceptance criteria, last-active-stage pipeline PASS, freshness check) are **not** re-evaluated (see §6.2 same-state transition rules). The PM is permitted for same-state COMPLETE because it is a pure no-op (no data modification); the PM is **not** permitted for `IN_PROGRESS → COMPLETE` (that remains last-active-stage-agent-only). |
| → CANCELLED | "Project Manager" (or "Project Manager Agent") |
| BLOCKED → IN_PROGRESS | "Project Manager" (or "Project Manager Agent"), current assignee, system (auto-repair) |
| BLOCKED → READY | System only (auto-unblock via §15.4 — no manual agent guard) |
| BLOCKED → BLOCKED | "Project Manager" (or "Project Manager Agent"), current assignee |
| IN_PROGRESS → READY | "Project Manager" (or "Project Manager Agent"), current assignee |
| COMPLETE → IN_PROGRESS | "Project Manager" (or "Project Manager Agent"), agent owning the WP's last active stage |

> **Design note — no agent guard on → BLOCKED transitions:** The `READY → BLOCKED` and `IN_PROGRESS → BLOCKED` transitions intentionally have **no agent role restriction**. Any of the nine agent roles may block a WP by providing a `blocked_by` object. This is a deliberate design choice: any agent may discover a blocker during its work (e.g., a Developer encountering an external dependency, a QA agent discovering a technical issue). Restricting blocking to specific roles would force agents to complete their current pipeline with FAIL and add handoff notes requesting the PM to block — adding latency and complexity without a safety benefit. The `blocked_by` object (§21.11) is required for all → BLOCKED transitions, providing an audit trail of who blocked and why. The `BLOCKED → BLOCKED` replacement rule (§6.2) and `BLOCKED → IN_PROGRESS` agent guard (§6.5) ensure that *resolving* or *modifying* blockers remains restricted to authorized agents (PM/assignee/system).

> Implementations should accept both short-form ("Documentation") and long-form ("Documentation Agent") variants.
>
> **"System" agent identity:** Several agent guard entries reference "system" as an allowed agent (e.g., `BLOCKED → IN_PROGRESS`). "System" is not one of the nine canonical agent roles (§4) — it represents automated operations performed by the implementation itself, not by an external AI agent. System-initiated transitions occur in two contexts: (1) `propagateDependencyUnblock` (§15.4), which transitions WPs from `BLOCKED → READY`; and (2) implementation-specific auto-repair logic (e.g., `REPAIR_ORPHAN_BLOCKED` in §21.20), which may transition WPs from `BLOCKED → IN_PROGRESS`. Implementations should use a reserved agent identifier (e.g., `"system"`) for audit trail purposes when performing these automated transitions, and MUST NOT allow external callers to claim the "system" identity to bypass agent guards.

---

## 7. Pipeline State Machine

### 7.1 States

| State | Terminal? | Description |
|-------|-----------|-------------|
| `IN_PROGRESS` | No | Pipeline is active |
| `PASS` | Yes | Pipeline completed successfully |
| `FAIL` | Yes | Pipeline failed; rework needed |

### 7.2 Transitions

```
IN_PROGRESS → PASS    (pipeline completed successfully)
IN_PROGRESS → FAIL    (pipeline failed or was cancelled)
```

There is no READY state for pipelines. They are created directly as IN_PROGRESS.

PASS and FAIL are terminal — no further transitions.

### 7.3 Cancellation

A pipeline can be cancelled by setting its status to FAIL with a reason string as the summary. This is the mechanism for closing stale pipelines.

When a pipeline is cancelled by system automation (cascade reblock via [§15.5](dependencies-and-rework.md#155-cascade-reblocking-propagatedependencyreblock) or manual IN_PROGRESS → BLOCKED transition), the `auto_cancelled` flag is set to `true`. This flag excludes the pipeline from rework detection and circuit breaker calculations (see [§21.27](edge-cases.md#2127-auto-cancelled-pipelines)).

```
```
// Structure of documents
└── mcp-server/
    └── docs/
        └── agents/
            └── workflow-specification/
                └── data-model.md

```
###  Path: `/mcp-server/docs/agents/workflow-specification/data-model.md`

```md
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

```