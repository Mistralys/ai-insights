# Agent Workflow Specification

> **Purpose:** This document is the **authoritative specification** of the 9-agent dynamic pipeline workflow. It defines all state machines, handoff logic, pipeline orchestration, edge cases, and invariants. Implementation code (TypeScript MCP server, Python orchestrator) and tests are **validated against this specification**. It also serves as a language-agnostic reference for porting the workflow logic to additional runtimes.

**Version:** 2.4.2
**Date:** 2026-04-10

---

## Changelog

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
