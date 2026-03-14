# Plan 1: Dynamic Pipeline Engine

> **Part 1 of 2** — This plan builds the composable pipeline engine (Phases 0–2). [Plan 2](../2026-03-14-9-agent-personas/plan.md) adds the new personas and PM sub-agents (Phases 3–7).

## Summary

Redesign the AI Insights ledger workflow engine from a fixed 4-stage pipeline to a dynamic 6-type composable pipeline where the PM selects active stages per work package. This involves: updating the workflow specification first (the authoritative source of truth), extending the pipeline type system with two new types (`security-audit`, `release-engineering`), making pipeline composition configurable per work package via `active_pipeline_stages`, converting hardcoded routing maps into dynamic functions, expanding `AGENT_ROLES` to 9, and updating all cross-system synchronization points (orchestrator, GUI, sync scripts).

This plan is independently shippable — existing 7 personas continue working unchanged with the 4-stage default pipeline. No persona files are modified.

> **Spec-first principle:** The [Workflow Specification](../../mcp-server/docs/agents/workflow-specification/README.md) is the primary source of truth for all workflow logic. All changes to pipeline types, routing maps, state machines, and operational algorithms MUST be made in the specification first. Implementation code and tests are validated against the specification — not the other way around.

## Architectural Context

### Current Pipeline Architecture

The system uses a **fixed 7-stage pipeline** with hardcoded routing in [mcp-server/src/utils/pipeline-maps.ts](../../mcp-server/src/utils/pipeline-maps.ts):

- **`PIPELINE_TYPES`** — `['implementation', 'qa', 'code-review', 'documentation']` (4 pipeline stages)
- **`PIPELINE_PREREQUISITES`** — Fixed chain: `implementation → qa → code-review → documentation`
- **`PIPELINE_AGENT_MAP`** — Maps pipeline type → owning agent role
- **`NEXT_AGENT_MAP`** — Maps pipeline type → next agent on PASS
- **`FAIL_ROUTING_MAP`** — Maps pipeline type → rework agent on FAIL
- **`AGENT_PIPELINE_MAP`** — Inverse of PIPELINE_AGENT_MAP

These are all `Record<PipelineType, string>` with compile-time exhaustiveness checking.

### Current Agent Roles

Defined as a const tuple in [mcp-server/src/utils/constants.ts](../../mcp-server/src/utils/constants.ts):

```typescript
AGENT_ROLES = ['Planner', 'Project Manager', 'Developer', 'QA', 'Reviewer', 'Documentation', 'Synthesis']
```

Mirrored in [scripts/sync-personas.js](../../scripts/sync-personas.js) as `KNOWN_ROLES`.

### Key Schema Files

- [mcp-server/src/schema/work-package.ts](../../mcp-server/src/schema/work-package.ts) — `WorkPackageDetailSchema` (pipelines, rework_counts, handoff_notes)
- [mcp-server/src/schema/root-index.ts](../../mcp-server/src/schema/root-index.ts) — `RootIndexSchema` (work_packages summaries, project status)
- [mcp-server/src/schema/enums.ts](../../mcp-server/src/schema/enums.ts) — `PipelineStatus`, `WorkPackageStatus`

### Orchestrator

[orchestrator/src/config.py](../../orchestrator/src/config.py) mirrors the TypeScript pipeline routing constants and maps graph stage names to persona file paths in `PERSONA_FILES`. [orchestrator/src/graph.py](../../orchestrator/src/graph.py) builds a hub-and-spoke LangGraph `StateGraph` where each stage loops back to a supervisor node.

### GUI Dashboard

[mcp-server/gui/public/views/project-detail.js](../../mcp-server/gui/public/views/project-detail.js) has a `PIPELINE_STAGES` constant that lists the 4 current pipeline types for rendering stage badges.

---

## Approach / Architecture

### New Pipeline Shape

```
1-Planner → 2-PM → 3-Developer → 4-QA → [5-Security Auditor] → 6-Reviewer → [7-Release Engineer] → 8-Documentation → 9-Synthesis
```

The PM selects which stages are active for each work package. Any subsequence of the canonical ordering is valid — there are no mandatory or optional categories. The PM has full authority over pipeline composition.

### New Pipeline Types

Extend from 4 to 6 pipeline types:

| Pipeline Type | Agent | Position |
|---|---|---|
| `implementation` | Developer | 3 |
| `qa` | QA | 4 |
| `security-audit` | Security Auditor | 5 |
| `code-review` | Reviewer | 6 |
| `release-engineering` | Release Engineer | 7 |
| `documentation` | Documentation | 8 |

All 6 stages are **PM-composable** — the PM selects any subset as a subsequence of the canonical ordering when creating a WP. There is no hard mandatory/optional distinction. The existing 4-stage default (`implementation → qa → code-review → documentation`) is preserved for backward compatibility when `active_pipeline_stages` is omitted.

### Dynamic Pipeline Configuration

Each work package stores its **active pipeline stages** as a property. The default is the 4 legacy stages (backward-compatible). The PM configures stages at WP creation time from any valid subsequence of the canonical ordering. All routing logic (`NEXT_AGENT_MAP`, `FAIL_ROUTING_MAP`, `PIPELINE_PREREQUISITES`) becomes dynamic — consulting the WP's active stages to determine the chain.

This enables workflow patterns that were previously impossible:

| PM configures `active_pipeline_stages` as | Resulting chain | Use case |
|---|---|---|
| `["implementation", "qa", "code-review", "documentation"]` | impl → qa → review → docs | Standard (today's default) |
| all 6 stages | impl → qa → security → review → release → docs | Security-critical release |
| `["documentation"]` | docs only | Pure documentation work |
| `["documentation", "qa", "code-review"]` | docs → qa → review | Documentation as creative work, then verified |
| `["qa", "code-review"]` | qa → review | Verification-only |
| `["implementation", "qa"]` | impl → qa | Quick prototype, no formal review |

### Soft Guardrails

`createWorkPackage` validates the pipeline composition and emits **soft warnings** (included in the result message, not rejections) for potentially risky compositions:

| Guardrail | Type | Rationale |
|---|---|---|
| At least 1 stage must be active | **Hard** (reject) | An empty chain is nonsensical |
| Must be a subsequence of canonical ordering | **Hard** (reject) | Ordering invariant is load-bearing for routing |
| No duplicates | **Hard** (reject) | Each type appears at most once |
| If `implementation` is present, `qa` should be present | **Soft** (warning) | Shipping code without QA is risky but not always wrong |
| Single-stage chain | **Soft** (warning) | Usually intentional, but worth flagging |

Hard guardrails reject invalid input. Soft guardrails inform the PM but allow the composition to proceed — the PM takes responsibility for the pipeline they chose.

### Generalized COMPLETE Guard

The COMPLETE guard is generalized: the **agent owning the last active stage** (not hardcoded to Documentation) can mark a WP as COMPLETE. The terminal stage is computed dynamically — when `resolveNextAgent` returns `Synthesis` for a given stage, that stage is terminal. This enables documentation-only WPs where Documentation is position 1, verification-only WPs where Reviewer is the terminal agent, etc.

### Generalized FAIL Routing

The `FAIL_ROUTING_MAP` is generalized with a fallback: when the standard fail target's stage isn't active in the WP, the failure routes to the **first active stage's agent** (the "creative" agent for that WP). For example, in a documentation-only WP, a QA FAIL routes to Documentation (not Developer, since Developer isn't in the chain).

### Artifact Declaration Requirement

Implementation agents MUST declare all modified files in the pipeline's `artifacts.files_modified` array, including ancillary or out-of-scope improvements. This is enforced as a process rule in agent personas (not a hard validation gate) to maintain complete audit trails. The `completePipeline` operation emits a soft warning when `artifacts.files_modified` is empty or absent for non-pass-through pipelines.

---

## Rationale

1. **PM-composable over mandatory/optional categories**: Rather than hardcoding which stages are mandatory and which are optional, the PM selects any subsequence of the canonical ordering. This enables workflow patterns (documentation-only, verification-only) that a binary mandatory/optional model cannot express, while the existing dynamic routing functions (`resolvePrerequisite`, `resolveNextAgent`) already handle arbitrary subsequences correctly.

2. **Two new pipeline types vs. embedding in existing stages**: Security review and release engineering are distinct disciplines with their own pass/fail criteria. Embedding them in the Reviewer or Documentation persona dilutes those agents' focus and makes it harder to route failures correctly.

3. **Per-WP configuration over project-level configuration**: Different WPs in the same project may have different needs. A data-migration WP needs Security Auditor; a README-only WP does not. A documentation-only WP needs Documentation as the creative stage with QA and review afterward.

4. **Guardrails over modes**: Hard pipeline modes (`wp_mode` enum) solve known patterns but require a spec amendment for every future pattern. Soft guardrails solve the general case — any subsequence is valid, routing handles it, and the PM takes responsibility for the composition. This keeps the spec simple while pushing domain-specific workflow judgment into the PM agent's persona.

5. **Backward compatibility**: Existing ledger files with only 4 pipeline types must continue to work. The new `active_pipeline_stages` field defaults to the 4 legacy stages (`DEFAULT_PIPELINE_STAGES`) when absent.

6. **Spec-first approach**: The Workflow Specification (`mcp-server/docs/agents/workflow-specification/`) is the authoritative source for all workflow logic. Implementation and tests are validated against it. Changing the spec first ensures the design is formally reviewed before any code is written, prevents spec-implementation drift, and gives all downstream phases a stable reference to implement against.

7. **Artifact completeness as process rule**: Undeclared artifacts impede audits. Making `files_modified` a declared expectation (with soft warnings on empty values) improves traceability without adding hard validation gates that block legitimate empty-artifact scenarios (e.g., verification-only pipelines).

---

## Detailed Steps

### Phase 0: Workflow Specification Update (Source of Truth)

All workflow logic changes must be defined in the specification before implementation begins. The Workflow Specification at `mcp-server/docs/agents/workflow-specification/` is the primary source of truth — implementation code and tests are validated against it.

**Step 0.1 — Update data-model.md (§3–4)**

- **§3.3 Work Package Detail** — Add `active_pipeline_stages` field to the entity definition:
  ```
  active_pipeline_stages:  PipelineType[]?  // Optional; defaults to DEFAULT_PIPELINE_STAGES when absent
  ```
- **§3.4 Pipeline** — Extend `PipelineType` to include the new types:
  ```
  PipelineType = "implementation" | "qa" | "security-audit" | "code-review" | "release-engineering" | "documentation"
  ```
- **§4 Agent Roles** — Expand from 7 to 9 roles:
  - Add Security Auditor (#5): "Security review & threat analysis (owns `security-audit` pipeline)"
  - Add Release Engineer (#7): "Release curation & version management (owns `release-engineering` pipeline)"
  - Renumber Reviewer (5→6), Documentation (6→8), Synthesis (7→9)
  - Update canonical role list
- **§4.1 Pipeline Ownership** — Expand from 4 to 6 pipeline types:
  - Add `security-audit` → Security Auditor
  - Add `release-engineering` → Release Engineer
  - Note that Planner, Project Manager, and Synthesis still own no pipeline type

**Step 0.2 — Update pipeline-routing.md (§8–9)**

- **§8 Pipeline Ordering** — Redefine the pipeline ordering:
  ```
  Canonical ordering: implementation → qa → security-audit → code-review → release-engineering → documentation
  ```
  Replace the mandatory/optional distinction with **PM-composable stages**:
  - All 6 stages are composable — no hard mandatory/optional categories
  - The PM selects any subsequence of the canonical ordering when creating a WP
  - `DEFAULT_PIPELINE_STAGES` = `["implementation", "qa", "code-review", "documentation"]` (backward-compatible default when field is absent)
  - The active pipeline stages for a WP are always a subsequence of the canonical ordering
  - Document common composition patterns (standard, security-critical, documentation-only, verification-only)
- **§8.1 Prerequisites Map** — Extend with dynamic prerequisite resolution:
  - `security-audit` requires most recent `qa` PASS (when active)
  - `code-review` requires most recent `qa` PASS (when `security-audit` inactive) or most recent `security-audit` PASS (when active)
  - `release-engineering` requires most recent `code-review` PASS (when active)
  - `documentation` requires most recent `code-review` PASS (when `release-engineering` inactive) or most recent `release-engineering` PASS (when active)
  - Add `resolvePrerequisite(pipelineType, activeStages)` algorithm
- **§8.2 Prerequisite Check Algorithm** — Update `canStartPipeline` to accept `activeStages` parameter
- **§8.4 Downstream Types / §8.5 Upstream Types** — Update to accept `activeStages` and filter against the canonical ordering
- **§9.1 PIPELINE_AGENT_MAP** — Add `security-audit → Security Auditor`, `release-engineering → Release Engineer`
- **§9.2 NEXT_AGENT_MAP** — Redefine as a function: `resolveNextAgent(pipelineType, activeStages)`. Document that the function finds the next active stage in the canonical ordering and returns its owning agent. When no next stage exists, return `Synthesis`. Include lookup table for common compositions.
- **§9.3 FAIL_ROUTING_MAP** — Extend with new entries and a **fallback rule**:
  - `security-audit` → Developer (same pattern as QA/code-review)
  - `release-engineering` → Release Engineer (self-rework, same pattern as Documentation)
  - **Fallback**: when the standard fail target's stage is not active in the WP, route to the first active stage's agent (the "creative" agent for that WP)
- **§9.4 AGENT_PIPELINE_MAP** — Extend with inverse entries for the two new agents
- **Map consistency invariant** — Update to cover all 6 pipeline types

**Step 0.3 — Update state-machines.md (§5–7)**

- **§6 Work Package State Machine** — Generalize the COMPLETE guard:
  - Replace the hardcoded "only Documentation agent can mark COMPLETE" rule with: "the agent owning the **last active stage** can mark COMPLETE"
  - The terminal stage is computed dynamically: when `resolveNextAgent(stage, activeStages)` returns `Synthesis`, that stage is terminal
  - The freshness check (most recent terminal pipeline PASS post-dates most recent first-stage pipeline start) is generalized from `documentation`/`implementation` to `lastActiveStage`/`firstActiveStage`
  - Document examples: in a standard WP, Documentation is terminal; in a verification-only WP (`["qa", "code-review"]`), Reviewer is terminal; in a documentation-only WP (`["documentation"]`), Documentation is both first and terminal
- **§7 Pipeline State Machine** — No structural change (the 3-state IN_PROGRESS/PASS/FAIL model is pipeline-type-agnostic), but update any examples that enumerate pipeline types to show 6 instead of 4

**Step 0.4 — Update operations.md (§9b–12)**

- **§9b Work Package Creation** — Document the optional `active_pipeline_stages` parameter:
  - Hard validation: all entries must be valid `PipelineType` values; at least 1 stage required; no duplicates; list must be a subsequence of the canonical ordering
  - Soft guardrails (warnings, not rejections): `implementation` without `qa`; single-stage chains
  - Default: `DEFAULT_PIPELINE_STAGES` when omitted (backward compatibility)
  - Storage: persisted in `WorkPackageDetail.active_pipeline_stages`
- **§9b Artifact Declaration** — Document the artifact completeness expectation:
  - `completePipeline` emits a soft warning when `artifacts.files_modified` is empty or absent
  - Agent personas include explicit guidance to declare all modified files
- **§11 Starting a Pipeline** — Update algorithm to:
  - Read `wp.active_pipeline_stages` (default to `DEFAULT_PIPELINE_STAGES`)
  - Validate the requested pipeline type is in the WP's active stages
  - Use `resolvePrerequisite()` instead of static lookup
- **§12 Completing a Pipeline** — Update routing to use `resolveNextAgent()` and extended `FAIL_ROUTING_MAP`

**Step 0.5 — Update handoff-and-recommendations.md (§13–14)**

- **§12 Completing a Pipeline** — Add artifact completeness soft warning: when `artifacts.files_modified` is empty or absent and the pipeline status is `PASS`, include a warning in the result message reminding the agent to declare all modified files
- **§13 Handoff Logic** — Update handoff routing to respect per-WP active stages; update FAIL routing to apply fallback rule
- **§14 Next-Action Recommendation Engine** — Add new action types:
  - `RUN_SECURITY_AUDIT` — Security Auditor's equivalent of `RUN_QA`, `RUN_CODE_REVIEW`
  - `RUN_RELEASE_ENGINEERING` — Release Engineer's equivalent
  - Update the action determination algorithm to consult `active_pipeline_stages`

**Step 0.6 — Update dependencies-and-rework.md (§15–16)**

- **§16 Rework & Circuit Breaker** — Extend `ReworkCounts` to include optional entries for `security-audit` and `release-engineering`

**Step 0.7 — Update auxiliary-systems.md (§17–20)**

- **§17 Self-Healing** — Update stale pipeline detection to cover 6 pipeline types
- **§19 Synthesis Completion** — No changes needed (synthesis is WP-status-driven, not pipeline-type-aware)

**Step 0.8 — Update edge-cases.md (§21)**

- Add edge cases for composable stage scenarios:
  - WP created without certain stages, then PM wants to add them mid-flight (not supported — stages immutable after creation)
  - Pipeline FAIL in a stage whose standard fail target isn't in the active chain (fallback routing rule)
  - Backward compatibility: existing WPs without `active_pipeline_stages` field
  - Single-stage WP: the stage is simultaneously first, terminal, and the COMPLETE guard target
  - Documentation-only WP: Documentation agent is both the creative agent and the COMPLETE guard agent; freshness check compares `documentation` PASS against `documentation` start
  - Verification-only WP: no implementation stage; QA validates external artifacts or prior project state
  - Artifact completeness: empty `files_modified` triggers soft warning; legitimate for verification-only or documentation-only pipelines

**Step 0.9 — Update walkthrough.md (§22, Appendices)**

- **Appendix A (Constants)** — Update `PIPELINE_TYPES`, `CANONICAL_PIPELINE_ORDERING` constants. Replace `MANDATORY_PIPELINE_TYPES` and `OPTIONAL_PIPELINE_TYPES` with `DEFAULT_PIPELINE_STAGES` (the backward-compatible default when `active_pipeline_stages` is omitted). Document that the mandatory/optional distinction no longer exists — all stages are PM-composable.
- **Appendix B (Action Types)** — Add `RUN_SECURITY_AUDIT`, `RUN_RELEASE_ENGINEERING`
- **Appendix C (Error Conditions)** — Add error for starting a pipeline type not in WP's active stages; add soft warning conditions for suspicious compositions and empty artifacts
- Update the walkthrough example or add a second walkthrough showing a non-standard composition (e.g., documentation-only WP)

**Step 0.10 — Bump specification version**

- Increment version in `README.md` from `1.3.1` to `2.0.0` (major version bump — this is a breaking change to the pipeline model)
- Update date

---

### Phase 1: MCP Server Foundation (Pipeline Type & Schema Changes)

This phase implements the specification changes from Phase 0 in TypeScript. No persona or orchestrator changes yet.

**Step 1.1 — Extend pipeline type system**

- In [mcp-server/src/utils/pipeline-maps.ts](../../mcp-server/src/utils/pipeline-maps.ts):
  - Extend `PIPELINE_TYPES` tuple to include `'security-audit'` and `'release-engineering'`
  - Define the **full canonical ordering** (the superset of all possible stages): `['implementation', 'qa', 'security-audit', 'code-review', 'release-engineering', 'documentation']`
  - Define `DEFAULT_PIPELINE_STAGES` (the backward-compatible default when `active_pipeline_stages` is omitted): `['implementation', 'qa', 'code-review', 'documentation']`
  - Extend `PIPELINE_AGENT_MAP` with `'security-audit': 'Security Auditor'` and `'release-engineering': 'Release Engineer'`
  - Convert `NEXT_AGENT_MAP` and `FAIL_ROUTING_MAP` from static records into functions that accept an active-stages list and compute the chain dynamically
  - Define a `DEFAULT_FAIL_ROUTING_MAP` covering all 6 types: `security-audit` FAILs route to Developer (like QA/code-review); `release-engineering` FAILs route to self (like Documentation). Add a **fallback rule**: when the standard fail target's stage isn't active, route to the first active stage's agent.
  - Update `PIPELINE_PREREQUISITES` to a function that computes prerequisites from the active stages list, respecting the canonical ordering
  - Update `getDownstreamTypes()` and `getUpstreamTypes()` to accept an optional active-stages filter

- In [mcp-server/src/schema/enums.ts](../../mcp-server/src/schema/enums.ts):
  - No changes needed — `PipelineSchema.type` is already `z.string()` (not an enum), so new types are accepted

**Step 1.2 — Add active pipeline stages to WP schema**

- In [mcp-server/src/schema/work-package.ts](../../mcp-server/src/schema/work-package.ts):
  - Add `active_pipeline_stages` field to `WorkPackageDetailSchema`:
    ```typescript
    active_pipeline_stages: z.array(z.string()).optional()
    // When absent or empty, defaults to DEFAULT_PIPELINE_STAGES
    ```
  - Add optional entries to `ReworkCountsSchema` for new pipeline types:
    ```typescript
    'security-audit': z.number().int().nonnegative().optional(),
    'release-engineering': z.number().int().nonnegative().optional(),
    ```

**Step 1.3 — Update `ledger_create_work_package`**

- In [mcp-server/src/tools/work-package.ts](../../mcp-server/src/tools/work-package.ts):
  - Add optional `active_pipeline_stages` parameter to `CreateWorkPackageSchema`
  - Hard validation: all entries must be valid pipeline types from `PIPELINE_TYPES`; at least 1 stage required; no duplicates; must be a subsequence of the canonical ordering
  - Soft guardrails: emit warnings (in result message) for `implementation` without `qa`, single-stage chains
  - Store the resolved stages array in the WP detail file
  - Default to `DEFAULT_PIPELINE_STAGES` when parameter is omitted (backward compatibility)

**Step 1.4 — Update pipeline routing logic**

- In [mcp-server/src/tools/pipeline.ts](../../mcp-server/src/tools/pipeline.ts):
  - `startPipeline`: Read `wp.active_pipeline_stages` (or default), compute prerequisites dynamically, validate agent role against extended `PIPELINE_AGENT_MAP`, validate the requested pipeline type is in the WP's active stages
  - `completePipeline`: Compute `NEXT_AGENT_MAP` and `FAIL_ROUTING_MAP` dynamically from WP's active stages; apply fail-routing fallback when standard target's stage isn't active; emit soft warning when `artifacts.files_modified` is empty
  - `buildCompletionGuidance`: Accept active stages and compute next agent dynamically

- In [mcp-server/src/tools/workflow-next-action.ts](../../mcp-server/src/tools/workflow-next-action.ts):
  - Update action computation to consider WP's active stages when determining what pipeline to recommend

- In [mcp-server/src/utils/workflow-helpers.ts](../../mcp-server/src/utils/workflow-helpers.ts):
  - Update `hasDownstreamFail`, `hasNewUpstreamPassSince`, `getDownstreamTypes`, etc. to respect per-WP active stages

**Step 1.5 — Update AGENT_ROLES**

- In [mcp-server/src/utils/constants.ts](../../mcp-server/src/utils/constants.ts):
  - Expand `AGENT_ROLES` to 9:
    ```typescript
    AGENT_ROLES = [
      'Planner', 'Project Manager', 'Developer', 'QA',
      'Security Auditor', 'Reviewer', 'Release Engineer',
      'Documentation', 'Synthesis'
    ] as const;
    ```

**Step 1.6 — Update tests**

- Update [mcp-server/tests/utils/pipeline-maps.test.ts](../../mcp-server/tests/utils/pipeline-maps.test.ts) for new pipeline types and dynamic routing
- Add tests for active-stages resolution: default when omitted, hard guardrail rejections (empty, duplicates, out-of-order, invalid types), soft guardrail warnings
- Update [mcp-server/tests/tools/pipeline.test.ts](../../mcp-server/tests/tools/pipeline.test.ts) for dynamic prerequisite and routing tests
- Update existing integration tests in [mcp-server/tests/integration/full-workflow.test.ts](../../mcp-server/tests/integration/full-workflow.test.ts)
- Add new test cases for arbitrary composition behavior, FAIL routing fallback, generalized COMPLETE guard, and artifact empty warning

**Step 1.7 — Update help content**

- In [mcp-server/src/tools/help-content.ts](../../mcp-server/src/tools/help-content.ts):
  - Update `TOOL_HELP` entries for `ledger_create_work_package` (new `active_pipeline_stages` parameter)
  - Add new pipeline types to help text

---

### Phase 2: Cross-System Synchronization

**Step 2.1 — Update sync scripts**

- In [scripts/sync-personas.js](../../scripts/sync-personas.js):
  - Expand `KNOWN_ROLES` to match the 9-role `AGENT_ROLES`:
    ```javascript
    const KNOWN_ROLES = [
      'Planner', 'Project Manager', 'Developer', 'QA',
      'Security Auditor', 'Reviewer', 'Release Engineer',
      'Documentation', 'Synthesis',
    ];
    ```

- In [scripts/check-known-roles.js](../../scripts/check-known-roles.js):
  - No changes needed — this script dynamically reads both arrays and compares them. It will automatically detect drift.

**Step 2.2 — Update orchestrator config**

- In [orchestrator/src/config.py](../../orchestrator/src/config.py):
  - Add `security-audit` and `release-engineering` to `PIPELINE_PREREQUISITES`, `PIPELINE_AGENT_MAP`
  - Add `security_auditor` and `release_engineer` to `NEXT_STAGE_MAP`, `STAGE_TO_PIPELINE`, `PERSONA_FILES`, `VALID_STAGES`
  - Update `PIPELINE_TYPES` tuple

- In [orchestrator/src/graph.py](../../orchestrator/src/graph.py):
  - Add `_STAGE_SECURITY_AUDITOR` and `_STAGE_RELEASE_ENGINEER` stage constants
  - Add these stages to `_LOOP_STAGES`
  - Register the new stage nodes in `build_graph()`

**Step 2.3 — Update GUI dashboard**

- In [mcp-server/gui/public/views/project-detail.js](../../mcp-server/gui/public/views/project-detail.js):
  - Extend `PIPELINE_STAGES` to 6:
    ```javascript
    var PIPELINE_STAGES = ['implementation', 'qa', 'security-audit', 'code-review', 'release-engineering', 'documentation'];
    ```
  - Handle stages gracefully in the stage badges renderer (grey badge for inactive stages in the WP's composition vs. stages that are in the composition but not yet started)

**Step 2.4 — Update persona _shared.yaml**

- In [personas/ledger/src/meta/_shared.yaml](../../personas/ledger/src/meta/_shared.yaml):
  - Expand `roster` from 7 to 9 entries:
    ```yaml
    roster:
      - number: 1
        title: Chief Product Officer
        short: Planning & Strategy
      - number: 2
        title: Technical Program Manager
        short: Task Decomposition & Project Management
      - number: 3
        title: Staff Software Engineer
        short: Implementation & Verification
      - number: 4
        title: SDET
        short: QA & Validation
      - number: 5
        title: Security Auditor
        short: Security Review & Threat Analysis
      - number: 6
        title: Principal Systems Architect
        short: Code Review & Quality Check
      - number: 7
        title: Release Engineer
        short: Release Curation & Version Management
      - number: 8
        title: Technical Writing Manager
        short: Documentation & README Curation
      - number: 9
        title: Head of Operations
        short: Synthesis & Project Reporting
    ```

---

### Phase 7a: Engine Documentation Updates

Update project manifests and AGENTS.md to reflect the engine changes. Persona-specific documentation is deferred to Plan 2.

**Step 7a.1 — Update MCP server project manifest**

- [mcp-server/docs/agents/project-manifest/api-surface.md](../../mcp-server/docs/agents/project-manifest/api-surface.md):
  - Document new `active_pipeline_stages` parameter on `ledger_create_work_package`
  - Document new pipeline types and their routing behavior
  - Update `PIPELINE_TYPES` documentation

- [mcp-server/docs/agents/project-manifest/constraints.md](../../mcp-server/docs/agents/project-manifest/constraints.md):
  - Add constraint for active pipeline stages validation (hard guardrails and soft guardrails)
  - Document PM-composable stage behavior (no mandatory/optional distinction)
  - Add constraint for artifact declaration expectation

- [mcp-server/docs/agents/project-manifest/data-flows.md](../../mcp-server/docs/agents/project-manifest/data-flows.md):
  - Update Flow 2 (Work Package Creation) to include active stages
  - Update Flow 4 (Starting a Pipeline) for dynamic prerequisites

**Step 7a.2 — Update AGENTS.md cross-system dependency table**

- [AGENTS.md](../../AGENTS.md) (workspace root):
  - Update "7-stage workflow" references to "9-stage workflow"
  - Update cross-system dependency table

- [mcp-server/AGENTS.md](../../mcp-server/AGENTS.md):
  - Update agent role references

---

## Dependencies

- **Phase 0** (Workflow Specification) has no dependencies — must start first as the source of truth
- **Phase 1** (MCP Server Foundation) depends on Phase 0 (implements the spec changes)
- **Phase 2** (Cross-System Sync) depends on Phase 1 (needs new AGENT_ROLES and pipeline types)
- **Phase 7a** (Engine Docs) depends on Phases 1–2 (documents the final state of the engine)

```
Phase 0 → Phase 1 → Phase 2 → Phase 7a
```

## Required Components

### New Files

None — this plan modifies infrastructure only. New persona files are created in Plan 2.

### Modified Files

| File | Change |
|------|--------|
| `mcp-server/src/utils/constants.ts` | Expand AGENT_ROLES to 9 |
| `mcp-server/src/utils/pipeline-maps.ts` | Extend pipeline types, make routing dynamic |
| `mcp-server/src/schema/work-package.ts` | Add `active_pipeline_stages` field |
| `mcp-server/src/tools/pipeline.ts` | Dynamic routing in start/complete |
| `mcp-server/src/tools/work-package.ts` | New parameter on create |
| `mcp-server/src/tools/workflow-next-action.ts` | Respect per-WP active stages |
| `mcp-server/src/utils/workflow-helpers.ts` | Update helpers for 6 pipeline types |
| `mcp-server/src/tools/help-content.ts` | Update help text |
| `mcp-server/gui/public/views/project-detail.js` | Extend PIPELINE_STAGES |
| `scripts/sync-personas.js` | Expand KNOWN_ROLES |
| `personas/ledger/src/meta/_shared.yaml` | Expand roster to 9 |
| `orchestrator/src/config.py` | Add new stages and pipeline types |
| `orchestrator/src/graph.py` | Add new stage nodes |
| Multiple test files | Update for new types and routing |
| Multiple manifest docs | Update for new architecture |
| Multiple workflow spec docs | New pipeline model (source of truth) |

---

## Assumptions

1. Existing ledger files without `active_pipeline_stages` will be treated as having the 4 legacy stages (`DEFAULT_PIPELINE_STAGES`) for backward compatibility.
2. The Security Auditor's failure routing goes to Developer (same pattern as QA/code-review failures).
3. The Release Engineer's failure routing is self-rework (same pattern as Documentation).
4. The `renderRoster()` function in the build script already handles variable-length rosters (it iterates `_shared.roster` dynamically).
5. PM sub-agents are standalone personas, not ledger personas — they don't appear in the pipeline ordering and don't have pipeline types. (Relevant background for Plan 2.)
6. The PM takes responsibility for pipeline compositions they choose. Soft guardrails warn about potentially risky patterns but do not block them.
7. The FAIL routing fallback (first active stage's agent) is always reachable because at least 1 stage is required.

---

## Constraints

- **STDIO discipline** (Constraint 7): No `console.log` in any new MCP server code. All logs to `stderr` via `console.error`.
- **Atomic writes** (Constraint 1): All new file I/O uses `atomicWriteJson()`.
- **File locking** (Constraint 2): Dual-file updates wrapped in `withLock(store.storageDir)`.
- **Role parity** (Constraint 25): `AGENT_ROLES`, `KNOWN_ROLES`, and persona YAML `role` values must match.

---

## Out of Scope (Deferred to Plan 2)

- **New persona files** (Security Auditor, Release Engineer) — Plan 2, Phase 3
- **Renumbering existing personas** (5→6, 6→8, 7→9) — Plan 2, Phase 3
- **Simplifying existing personas** (offloading security/release duties) — Plan 2, Phase 4
- **PM sub-agent decomposition** — Plan 2, Phase 5
- **Persona build system verification** — Plan 2, Phase 6
- **Persona-specific documentation updates** — Plan 2, Phase 7b

### Also out of scope (both plans)

- **Orchestrator deep-agents changes**: The orchestrator will need new stage nodes, but deep-agents prompt changes are out of scope.
- **GUI visual redesign**: The GUI gets updated constants but no layout/UX redesign.
- **Migration script for existing ledgers**: Existing ledgers will work via backward compatibility.
- **Performance pipeline type**: Not adding a dedicated performance review stage.

---

## Acceptance Criteria

1. `AGENT_ROLES` in `constants.ts` contains exactly 9 roles in the correct order.
2. `KNOWN_ROLES` in `sync-personas.js` matches `AGENT_ROLES` — `check-known-roles.js` passes.
3. `PIPELINE_TYPES` in `pipeline-maps.ts` contains 6 pipeline types in canonical order.
4. `ledger_create_work_package` accepts an optional `active_pipeline_stages` parameter.
5. When `active_pipeline_stages` is omitted, the WP defaults to the 4 legacy stages (`DEFAULT_PIPELINE_STAGES`) for backward compatibility.
6. Any valid subsequence of the canonical ordering is accepted — no mandatory/optional enforcement.
7. Hard guardrails reject: empty arrays, duplicates, out-of-order sequences, invalid type names.
8. Soft guardrails emit warnings for: `implementation` without `qa`, single-stage chains.
9. `ledger_start_pipeline` validates agent role against `PIPELINE_AGENT_MAP` for new types.
10. `ledger_complete_pipeline` routes to the correct next agent per the WP's active stages.
11. FAIL routing applies fallback rule when standard fail target's stage is not in the active chain.
12. The COMPLETE guard is generalized: the agent owning the last active stage can mark COMPLETE.
13. Security Auditor FAIL routes to Developer. Release Engineer FAIL routes to self.
14. `completePipeline` emits soft warning when `artifacts.files_modified` is empty or absent.
15. Existing tests pass (no regressions).
16. New tests cover: dynamic routing, arbitrary composition, FAIL routing fallback, generalized COMPLETE guard, backward compatibility.
17. Orchestrator `PERSONA_FILES` includes the new stage mappings.
18. GUI `PIPELINE_STAGES` displays 6 stages with graceful handling of per-WP compositions.
19. MCP server project manifest documents are updated.
20. Workflow specification version is `2.0.0`.

---

## Testing Strategy

### Unit Tests (mcp-server)

- **Pipeline maps**: Test dynamic routing functions with various active-stages combinations (all-6, legacy-4, documentation-only, verification-only, security-audit-only, release-engineering-only, single-stage)
- **Schema**: Validate `active_pipeline_stages` field acceptance and defaults
- **Work package creation**: Test with and without `active_pipeline_stages`; test hard guardrails (reject empty, duplicates, out-of-order); test soft guardrails (warnings for `implementation` without `qa`, single-stage)
- **Pipeline start**: Test prerequisite checking with arbitrary compositions
- **Pipeline complete**: Test next-agent routing with dynamic chains; test FAIL routing fallback when standard target's stage is absent; test artifact empty warning
- **COMPLETE guard**: Test generalized terminal-stage detection for standard, documentation-only, and verification-only WPs
- **Workflow next-action**: Test action computation respects per-WP active stages
- **Backward compatibility**: Load existing WP JSON without `active_pipeline_stages`, verify default behavior

### Integration Tests (mcp-server)

- Full workflow with all 6 stages active
- Full workflow with only legacy 4 stages (matches today's behavior)
- Documentation-only WP: `["documentation", "qa", "code-review"]` — Documentation is creative stage, QA and Reviewer verify
- Verification-only WP: `["qa", "code-review"]` — no implementation or documentation
- Mixed project: some WPs with different compositions
- Failure routing through compositions where standard fail target is absent
- Self-rework in Release Engineer (FAIL → self)
- COMPLETE guard with non-Documentation terminal agent

### Orchestrator Tests

- Graph builds with new stage nodes
- Supervisor routes to new stages correctly

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Breaking existing ledger files** | Schema backward compatibility: `active_pipeline_stages` defaults to `DEFAULT_PIPELINE_STAGES` when absent. All routing functions fall back to legacy 4-stage chain. Add explicit backward-compat tests. |
| **Wide blast radius** | Phased implementation with tests at each phase boundary. Phase 0 (spec) is reviewed before any code changes. Phase 1 (MCP server) can be deployed and tested independently before cross-system sync. |
| **Spec-implementation drift** | Spec-first approach: Phase 0 updates the specification before any code is written. Tests reference spec section numbers. Implementation is validated against the spec, not vice versa. |
| **Dynamic routing complexity** | Keep the canonical ordering as the source of truth. Dynamic functions just filter the canonical chain — they don't reorder it. This makes reasoning about the chain simple: it's always a subsequence of the canonical ordering. |
| **Orchestrator drift** | The orchestrator's Python constants are NOT auto-synced with TypeScript. Document the manual sync requirement. Consider a future sync script. |
| **GUI badge rendering for composable stages** | Add distinct visual treatment (grey/dashed) for inactive stages in the WP's composition vs. stages that are in the composition but not yet started. |

---

## Recommended Implementation Order

1. **Phase 0** first — the workflow specification is the source of truth; all downstream phases implement and validate against it
2. **Phase 1** immediately after — implements the spec in TypeScript with full test coverage
3. **Phase 2** immediately after Phase 1 — cross-system sync
4. **Phase 7a** last — documenting the engine's final state

AGENT: Planning
STATUS: READY_FOR_PM
