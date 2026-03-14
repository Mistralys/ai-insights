# Agent Workflow Specification

> **Purpose:** This document is the **authoritative specification** of the 9-agent dynamic pipeline workflow. It defines all state machines, handoff logic, pipeline orchestration, edge cases, and invariants. Implementation code (TypeScript MCP server, Python orchestrator) and tests are **validated against this specification**. It also serves as a language-agnostic reference for porting the workflow logic to additional runtimes.

**Version:** 2.3.0  
**Date:** 2026-03-14

---

## Changelog

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
Planner → Project Manager → Developer → QA → [Security Auditor] → Reviewer → [Release Engineer] → Documentation → Synthesis
```

Bracketed stages are **optional** — the Project Manager selects which pipeline stages are active for each work package at creation time via the `active_pipeline_stages` field. The four mandatory stages (`implementation`, `qa`, `code-review`, `documentation`) are always present.

Work is organized into **work packages** (WPs), each of which progresses through a configurable sequence of **pipelines**:

```
implementation → qa → [security-audit] → code-review → [release-engineering] → documentation
```

Each pipeline is owned by a single agent role. Failures route back for rework (to Developer for QA/security-audit/code-review FAILs; to self for documentation/release-engineering FAILs). The system enforces ordering, validates transitions, and manages handoffs automatically. Dynamic routing functions (`resolvePrerequisite`, `resolveNextAgent`) adapt the pipeline chain per WP based on its active stages.

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
5. **Implementation notes within the spec.** Where the specification references implementation details (e.g., specific TypeScript exports), these are illustrative, not authoritative. If the implementation changes its internal structure, the spec's algorithmic definitions remain the authority; the implementation notes should be updated to match.
6. **Manifest documents the implementation.** The project manifest (`api-surface.md`, `constraints.md`, etc.) describes the current state of the code. When the specification changes, the implementation changes, and the manifest is updated to reflect the new implementation — in that order.
