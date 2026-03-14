# Plan: Specification-First Governance — Embedding the Spec as the Single Source of Truth

## Summary

Establish the Workflow Specification (`mcp-server/docs/agents/workflow-specification/`) as the **unambiguous, enforceable** single source of truth for all ledger logic, pipeline routing, state machines, and operational algorithms. Currently, the spec-first principle lives only in the 9-agent plan document — the specification itself, the AGENTS.md files, and the project manifest constraints do not assert or enforce it. This plan closes every gap so that any agent entering the codebase — whether implementing features, writing tests, or reviewing code — encounters the spec-first mandate at every discovery surface.

## Architectural Context

### Current State — Spec-first is aspirational, not embedded

The plan document ([docs/agents/plans/dynamic-pipeline-9-agent/plan.md](../dynamic-pipeline-9-agent/plan.md)) articulates the spec-first principle clearly:

> *"The Workflow Specification is the primary source of truth for all workflow logic. All changes to pipeline types, routing maps, state machines, and operational algorithms MUST be made in the specification first. Implementation code and tests are validated against the specification — not the other way around."*

However, this principle is **not enforced or even referenced** at the critical discovery surfaces where agents actually learn the rules:

| Discovery Surface | References Spec? | Gap |
|---|---|---|
| **Workflow Specification README** (`mcp-server/docs/agents/workflow-specification/README.md`) | Describes itself as "a reference implementation guide" — passive phrasing, not authoritative | No compliance section; no assertion that code/tests must conform to the spec |
| **MCP Server AGENTS.md** (`mcp-server/AGENTS.md`) | No mention of the workflow specification at all | Agents entering the MCP server codebase have no path to discover the spec |
| **Root AGENTS.md** (`AGENTS.md`) | No mention of the workflow specification | Cross-project navigation table has no entry for it |
| **MCP Server constraints.md** (`mcp-server/docs/agents/project-manifest/constraints.md`) | Several constraints describe business rules (§11, §13, §19, §22) without referencing the spec that defines them | No constraint requiring spec-first development; business-rule constraints are self-contained islands with no traceability to the authoritative spec |
| **MCP Server data-flows.md** (`mcp-server/docs/agents/project-manifest/data-flows.md`) | N/A | Does not reference the spec as the upstream authority for data-flow definitions |
| **Test files** | Some tests reference spec sections (e.g., `§14.13 row 1`, `§8.2`, `§18.4`) — good practice | No standard or mandate requiring spec-section traceability in test descriptions |
| **Spec `operations.md` line 150** | References `src/tools/work-package.ts` as "Source of truth" for `CLAIMABLE_ROLES` | Contradicts spec-first — code should implement the spec, not be its source of truth |

### What "Spec-First" Means Concretely

1. **Design changes** start in the specification. Code implements the spec.
2. **Tests validate against the spec.** If a test passes but diverges from the spec, the test is wrong.
3. **When code contradicts the spec**, the code is treated as a bug (consistent with the existing project manifest philosophy: "If implementation code contradicts a manifest, the code is likely wrong").
4. **The spec is the arbiter of correctness** for workflow logic — state machines, routing maps, pipeline ordering, handoff logic, recommendation engine behavior, edge cases.
5. **The project manifest documents *how the code works*; the workflow specification documents *how the code must work*.** They serve different purposes and both are authoritative in their domains.

## Approach / Architecture

Embed the spec-first principle at **every discovery surface** an agent encounters, using targeted additions to existing documents rather than new files. The hierarchy becomes:

```
Workflow Specification (HOW IT MUST WORK — authoritative for workflow logic)
    ↓ implements
MCP Server Code (startPipeline, completePipeline, handoff, recommendations, etc.)
    ↓ validates
Tests (reference spec section numbers; pass/fail judged against spec)
    ↓ documents
Project Manifest (HOW IT CURRENTLY WORKS — documents the implementation)
```

## Rationale

1. **Prevents spec drift**: Without explicit governance, agents will treat code as truth and silently diverge from the spec — the exact failure mode that rigorous specifications are meant to prevent.
2. **Minimal disruption**: No new files; only targeted insertions into existing documents that agents already read.
3. **Leverages existing patterns**: The project manifest already has a "trust the manifest over code" philosophy; extending this to the workflow specification is natural.
4. **Traceability**: Test-level spec references already exist in some files; mandating them everywhere turns an ad-hoc practice into a verifiable standard.

## Detailed Steps

### Step 1 — Add "Compliance & Governance" section to the Workflow Specification README

In `mcp-server/docs/agents/workflow-specification/README.md`, insert a new top-level section immediately **after** the "1. Overview" section (before the Table of Contents, or after §1 — placement should make it the first thing an agent reads after the overview). Content:

```markdown
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
```

### Step 2 — Fix the inverted "source of truth" reference in `operations.md`

In `mcp-server/docs/agents/workflow-specification/operations.md`, line ~150, the comment currently says:

> `// Source of truth: CLAIMABLE_ROLES export in src/tools/work-package.ts.`

This contradicts spec-first. Change it to:

> `// Derivation rule defined here (§10.1). Implementation: CLAIMABLE_ROLES export in src/tools/work-package.ts.`

This preserves the helpful implementation pointer while making it clear the spec is authoritative and the code implements it.

### Step 3 — Add Workflow Specification to the MCP Server AGENTS.md

In `mcp-server/AGENTS.md`, make three additions:

**3a.** In the "📖 Manifest Documents (Read in Order)" table, add a new row **before** row 1 (or as a prominently marked row 0):

| # | Document | Purpose | When to Consult |
|---|----------|---------|-----------------|
| 0 | [Workflow Specification](docs/agents/workflow-specification/README.md) | Authoritative specification of all workflow logic — state machines, routing, handoffs, edge cases | **Before modifying any pipeline, routing, status, handoff, or recommendation logic** |

**3b.** In the "🔍 Search Hierarchy (Mandatory Order)" table, add a row:

| What You Need | Search Here FIRST | Search Here SECOND | Read Source Code LAST |
|---|---|---|---|
| **Understand workflow behavior** | [Workflow Specification](docs/agents/workflow-specification/) | `constraints.md` | Only for implementation details |

**3c.** In the "🔐 Critical Constraints (Know Before Coding)" table, add a new constraint:

| # | Constraint | Consequence of Violation |
|---|------------|--------------------------|
| 12 | All workflow logic must implement the Workflow Specification exactly | Spec drift → behavioral divergence → test false positives → production bugs |

### Step 4 — Add Workflow Specification to the Root AGENTS.md

In the root `AGENTS.md`, make two additions:

**4a.** In the "🧭 Navigation Quick Reference" table, add:

| I Need To… | Go Here |
|---|---|
| Understand workflow logic (state machines, routing, handoffs) | [mcp-server/docs/agents/workflow-specification/README.md](mcp-server/docs/agents/workflow-specification/README.md) |

**4b.** In the "🔗 Cross-System Dependencies" table, add:

| Dependency | Source of Truth | Must Stay In Sync With |
|---|---|---|
| Workflow logic (state machines, routing maps, handoff logic, edge cases) | `mcp-server/docs/agents/workflow-specification/` | `mcp-server/src/` (TypeScript implementation), `orchestrator/src/` (Python implementation), `mcp-server/tests/` (test assertions) |

### Step 5 — Add spec-first constraint to MCP Server `constraints.md`

In `mcp-server/docs/agents/project-manifest/constraints.md`, add a new top-level section **before** the existing "File System Constraints" section:

```markdown
## Workflow Specification Governance

### 0. The Workflow Specification Is the Source of Truth for All Workflow Logic

**Rule:** The [Workflow Specification](../workflow-specification/README.md) is the authoritative definition of all workflow logic — state machines, pipeline routing, status transitions, handoff behavior, recommendation engine behavior, edge cases, and constants. Implementation code must conform to the specification. When code contradicts the specification, the code is wrong.

**Spec-first development:** Changes to workflow logic MUST be made in the specification first, then implemented in code, then validated by tests, then documented in the project manifest — in that order.

**Test traceability:** Test descriptions SHOULD reference the workflow specification section they validate (e.g., `// §14.13 row 1: returns true when QA FAIL started after impl PASS completed`). This convention is already practiced in several test files and should be followed consistently.

**Rationale:** The specification was designed to be a language-agnostic, formally reviewed reference. Treating code as the source of truth defeats this purpose and leads to silent behavioral drift between the TypeScript (MCP server) and Python (orchestrator) implementations.

**Scope:** This constraint applies to workflow logic only — file I/O, schema validation, concurrency primitives, and other infrastructure concerns are governed by their respective constraints below and the project manifest.
```

### Step 6 — Add traceability guidance to existing business-rule constraints

In `mcp-server/docs/agents/project-manifest/constraints.md`, add a brief cross-reference to the workflow specification in the following existing constraints:

- **Constraint 11 (Status Transitions):** Add note: `> Full specification: [Workflow Specification §6.2](../workflow-specification/state-machines.md#62-transition-table).`
- **Constraint 13 (Only Documentation Agent Can Set COMPLETE):** Add note: `> Full specification: [Workflow Specification §6.5, §21.10](../workflow-specification/state-machines.md#65-agent-guards).`
- **Constraint 19 (Pipeline Ordering):** Add note: `> Full specification: [Workflow Specification §8](../workflow-specification/pipeline-routing.md).`
- **Constraint 22 (Handoff Notes Routing):** Add note: `> Full specification: [Workflow Specification §9, §12](../workflow-specification/pipeline-routing.md).`

**Keep existing constraint text intact** — only add the cross-reference as a brief note at the end. This creates a traceability link without duplicating content.

### Step 7 — Update the Workflow Specification README purpose statement

The current purpose statement says:

> "This document is intended as a reference implementation guide for porting the workflow logic to any language."

Strengthen it to:

> "This document is the **authoritative specification** of the 9-agent dynamic pipeline workflow. It defines all state machines, handoff logic, pipeline orchestration, edge cases, and invariants. Implementation code (TypeScript MCP server, Python orchestrator) and tests are **validated against this specification**. It also serves as a language-agnostic reference for porting the workflow logic to additional runtimes."

### Step 8 — Add "Manifest Maintenance Rules" entry for spec changes

In the root `AGENTS.md`, in the "📝 Manifest Maintenance Rules" section under "Root-Level / Cross-Project":

| Change Made | Documents to Update |
|---|---|
| Change workflow logic (state machines, routing, handoffs, edge cases) | `mcp-server/docs/agents/workflow-specification/` **first**, then implementation code, then tests, then `mcp-server/docs/agents/project-manifest/constraints.md` |

## Dependencies

- None. All changes are additions to existing documentation files. No code changes required.
- Steps are independent and can be executed in any order, though the logical order is Steps 7 → 1 → 2 → 5 → 6 → 3 → 4 → 8.

## Required Components

### Modified Files

| File | Changes |
|------|---------|
| `mcp-server/docs/agents/workflow-specification/README.md` | Add "Compliance Model" section (Step 1); update purpose statement (Step 7) |
| `mcp-server/docs/agents/workflow-specification/operations.md` | Fix inverted "source of truth" reference (Step 2) |
| `mcp-server/AGENTS.md` | Add workflow spec to manifest table, search hierarchy, and critical constraints (Step 3) |
| `AGENTS.md` (root) | Add workflow spec to navigation reference and cross-system dependencies (Step 4) |
| `mcp-server/docs/agents/project-manifest/constraints.md` | Add Constraint 0 (Step 5); add spec cross-references to Constraints 11, 13, 19, 22 (Step 6) |

### No New Files

All changes are additions to existing documents.

## Assumptions

- The workflow specification at `mcp-server/docs/agents/workflow-specification/` has been fully updated per the 9-agent plan and is the current, reviewed specification.
- Existing test files that already reference spec sections (e.g., `§14.13`, `§8.2`) are correctly aligned with the current spec version.
- The AGENTS.md "Manifest Maintenance Rules" format is stable and accepts new table rows.

## Constraints

- **No content duplication.** The spec's rules are not restated in the constraints or AGENTS.md; only cross-references are added. The spec remains the single source.
- **No code changes.** This plan modifies only documentation. Code currently conforms to the spec; no implementation work is needed to establish governance.
- **Backward compatibility.** No existing constraint numbers change. The new constraint is numbered 0 to avoid renumbering.

## Out of Scope

- **Automated spec-compliance checking.** A CI lint that verifies tests reference spec sections, or that routing constants match the spec, would be valuable but is a separate effort.
- **Orchestrator AGENTS.md updates.** The orchestrator has its own `README.md` but no AGENTS.md; adding spec-first guidance there is deferred.
- **Re-aligning Constraint 13 and 22 routing tables with the 9-agent pipeline.** Those constraints still show the old 4-stage routing tables (no Security Auditor or Release Engineer). Updating them is part of the 9-agent implementation plan, not this governance plan.
- **Constraint renumbering.** Existing constraints keep their current numbers. New constraint is 0.

## Acceptance Criteria

- [ ] The Workflow Specification README contains a "Compliance Model" section that explicitly asserts spec-first authority.
- [ ] The Workflow Specification README purpose statement uses authoritative language ("authoritative specification"), not passive language ("reference implementation guide").
- [ ] The `operations.md` "source of truth" comment no longer defers authority to code.
- [ ] `mcp-server/AGENTS.md` references the workflow specification in the manifest table, search hierarchy, and critical constraints.
- [ ] Root `AGENTS.md` references the workflow specification in navigation and cross-system dependencies.
- [ ] `constraints.md` has a Constraint 0 establishing spec-first governance.
- [ ] Constraints 11, 13, 19, and 22 cross-reference the relevant workflow specification sections.
- [ ] Root `AGENTS.md` Manifest Maintenance Rules includes an entry for workflow logic changes.
- [ ] No existing constraint numbers are changed.
- [ ] No content from the specification is duplicated into other documents — only cross-references are added.

## Testing Strategy

This is a documentation-only change. Verification is manual:
1. Read each modified document and confirm the spec-first messaging is clear, consistent, and non-redundant.
2. Trace through the **agent ingestion path** for a hypothetical agent entering the MCP server codebase: AGENTS.md → manifest → constraints. Confirm the agent encounters the workflow specification at each stage.
3. Verify that a search for "workflow specification" in the workspace returns hits in all five modified files.
4. Confirm no existing constraint numbers shifted.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Agents ignore the new governance sections.** | Placed at high-visibility positions: top of constraints.md, in the AGENTS.md search hierarchy, in the spec README. Agents that follow the ingestion path cannot miss it. |
| **Duplication creep — governance text copied into multiple places.** | Strict rule: only cross-references in constraints/AGENTS.md; the spec is the single source. The plan's own acceptance criteria enforce non-duplication. |
| **Spec becomes a bottleneck — agents can't make small code fixes without updating the spec first.** | Constraint 0 scopes spec-first to *workflow logic only*. Infrastructure, I/O, schema, and build concerns are out of scope. Small bug fixes that don't change workflow behavior don't require spec updates. |
| **Over-engineering future constraints.** | This plan adds exactly one new constraint (0), modifies purpose/compliance text, and adds cross-references. No new processes, CI checks, or tooling. |
