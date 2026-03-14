# Plan: Dynamic 9-Agent Pipeline with PM Sub-Agents

## Summary

Redesign the AI Insights ledger workflow from a 7-agent fixed pipeline to a 9-agent dynamic pipeline where the PM selects active stages per work package. This involves: updating the workflow specification first (the authoritative source of truth for all workflow logic), then adding two new agent personas (Security Auditor and Release Engineer), making the pipeline composition configurable per work package, simplifying existing personas by offloading dedicated responsibilities to the new agents, decomposing the PM's cognitive load into sub-agents, and updating all cross-system synchronization points. The MCP server's hardcoded routing maps (`NEXT_AGENT_MAP`, `FAIL_ROUTING_MAP`, `PIPELINE_PREREQUISITES`) become dynamic lookups keyed on each work package's active pipeline configuration.

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

### Persona Build System

Source templates in `personas/ledger/src/` (meta YAML + content Markdown + partials) are assembled by [scripts/build-personas.js](../../scripts/build-personas.js) into generated files in `personas/ledger/vs-code/` and `personas/ledger/claude-code/`. Generated files must NEVER be edited directly. The build system supports:

- Per-persona YAML metadata with feature flags
- `{{> partial}}` inclusion (2-layer: `shared/partials/` base + `ledger/src/partials/` override)
- `{{#if flag}}…{{/if}}` conditionals (no nesting)
- `{{variable}}` interpolation
- Computed variables: `roster_rendered`, `mcp_tools_table`, `tools_json`

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

Stages in brackets (`[5-Security Auditor]`, `[7-Release Engineer]`) are **optional** — the PM decides per work package which are active based on WP characteristics.

### New Pipeline Types

Extend from 4 to 6 pipeline types:

| Pipeline Type | Agent | Position | Optional? |
|---|---|---|---|
| `implementation` | Developer | 3 | No (always active) |
| `qa` | QA | 4 | No (always active) |
| `security-audit` | Security Auditor | 5 | Yes |
| `code-review` | Reviewer | 6 | No (always active) |
| `release-engineering` | Release Engineer | 7 | Yes |
| `documentation` | Documentation | 8 | No (always active) |

### Dynamic Pipeline Configuration

Each work package stores its **active pipeline stages** as a property. The default is the 4 mandatory stages (backward-compatible). The PM can add optional stages when creating a WP. All routing logic (`NEXT_AGENT_MAP`, `FAIL_ROUTING_MAP`, `PIPELINE_PREREQUISITES`) becomes dynamic — consulting the WP's active stages to determine the chain.

### PM Sub-Agent Strategy

Implement sub-agents as **separate persona files** invoked via `runSubagent` (VS Code) or `Task` (Claude Code). This is the recommended approach because:

1. **Separation of concerns** — Each sub-agent has a focused mission with clear inputs/outputs
2. **Token efficiency** — Only the active sub-agent's prompt is loaded into context
3. **Reusability** — Sub-agents can be iterated independently
4. **Consistency** — Follows the existing pattern of invoking agents via `runSubagent`

The sub-agents will be **standalone personas** (not numbered ledger personas) that the PM invokes sequentially. They do NOT appear in the top-level pipeline.

---

## Rationale

1. **Dynamic over static pipeline**: Hardcoding 6 stages when only 4 are always needed wastes agent execution time and tokens. Dynamic composition lets the PM tailor the pipeline to each WP's actual needs.

2. **Two new pipeline types vs. embedding in existing stages**: Security review and release engineering are distinct disciplines with their own pass/fail criteria. Embedding them in the Reviewer or Documentation persona dilutes those agents' focus and makes it harder to route failures correctly.

3. **Per-WP configuration over project-level configuration**: Different WPs in the same project may have different needs. A data-migration WP needs Security Auditor; a README-only WP does not.

4. **Sub-agents as standalone personas**: The PM's cognitive load problem is best solved by delegation to focused helpers. Inline checklists don't reduce token pressure; separate personas loaded via `runSubagent` do.

5. **Backward compatibility**: Existing ledger files with only 4 pipeline types must continue to work. The new `active_pipeline_stages` field defaults to the 4 mandatory stages when absent.

6. **Spec-first approach**: The Workflow Specification (`mcp-server/docs/agents/workflow-specification/`) is the authoritative source for all workflow logic. Implementation and tests are validated against it. Changing the spec first ensures the design is formally reviewed before any code is written, prevents spec-implementation drift, and gives all downstream phases a stable reference to implement against.

---

## Detailed Steps

### Phase 0: Workflow Specification Update (Source of Truth)

All workflow logic changes must be defined in the specification before implementation begins. The Workflow Specification at `mcp-server/docs/agents/workflow-specification/` is the primary source of truth — implementation code and tests are validated against it.

**Step 0.1 — Update data-model.md (§3–4)**

- **§3.3 Work Package Detail** — Add `active_pipeline_stages` field to the entity definition:
  ```
  active_pipeline_stages:  PipelineType[]?  // Optional; defaults to MANDATORY_PIPELINE_TYPES when absent
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
  Add a new section on **mandatory vs. optional stages**:
  - Mandatory: `implementation`, `qa`, `code-review`, `documentation` (always active)
  - Optional: `security-audit`, `release-engineering` (PM decides per WP)
  - The active pipeline stages for a WP are always a subsequence of the canonical ordering
- **§8.1 Prerequisites Map** — Extend with dynamic prerequisite resolution:
  - `security-audit` requires most recent `qa` PASS (when active)
  - `code-review` requires most recent `qa` PASS (when `security-audit` inactive) or most recent `security-audit` PASS (when active)
  - `release-engineering` requires most recent `code-review` PASS (when active)
  - `documentation` requires most recent `code-review` PASS (when `release-engineering` inactive) or most recent `release-engineering` PASS (when active)
  - Add `resolvePrerequisite(pipelineType, activeStages)` algorithm
- **§8.2 Prerequisite Check Algorithm** — Update `canStartPipeline` to accept `activeStages` parameter
- **§8.4 Downstream Types / §8.5 Upstream Types** — Update to accept `activeStages` and filter against the canonical ordering
- **§9.1 PIPELINE_AGENT_MAP** — Add `security-audit → Security Auditor`, `release-engineering → Release Engineer`
- **§9.2 NEXT_AGENT_MAP** — Redefine as a function: `resolveNextAgent(pipelineType, activeStages)`. Document that the function finds the next active stage in the canonical ordering and returns its owning agent. Include lookup table for all combinations.
- **§9.3 FAIL_ROUTING_MAP** — Extend with new entries:
  - `security-audit` → Developer (same pattern as QA/code-review)
  - `release-engineering` → Release Engineer (self-rework, same pattern as Documentation)
- **§9.4 AGENT_PIPELINE_MAP** — Extend with inverse entries for the two new agents
- **Map consistency invariant** — Update to cover all 6 pipeline types

**Step 0.3 — Update state-machines.md (§5–7)**

- **§7 Pipeline State Machine** — No structural change (the 3-state IN_PROGRESS/PASS/FAIL model is pipeline-type-agnostic), but update any examples that enumerate pipeline types to show 6 instead of 4

**Step 0.4 — Update operations.md (§9b–12)**

- **§9b Work Package Creation** — Document the optional `active_pipeline_stages` parameter:
  - Validation: all entries must be valid `PipelineType` values; mandatory stages cannot be excluded; list must be a subsequence of the canonical ordering
  - Default: `MANDATORY_PIPELINE_TYPES` when omitted (backward compatibility)
  - Storage: persisted in `WorkPackageDetail.active_pipeline_stages`
- **§11 Starting a Pipeline** — Update algorithm to:
  - Read `wp.active_pipeline_stages` (default to mandatory types)
  - Validate the requested pipeline type is in the WP's active stages
  - Use `resolvePrerequisite()` instead of static lookup
- **§12 Completing a Pipeline** — Update routing to use `resolveNextAgent()` and extended `FAIL_ROUTING_MAP`

**Step 0.5 — Update handoff-and-recommendations.md (§13–14)**

- **§13 Handoff Logic** — Update handoff routing to respect per-WP active stages
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

- Add edge cases for optional stage scenarios:
  - WP created without optional stages, then PM wants to add them mid-flight
  - Pipeline FAIL in optional stage that was the last active stage before documentation
  - Backward compatibility: existing WPs without `active_pipeline_stages` field

**Step 0.9 — Update walkthrough.md (§22, Appendices)**

- **Appendix A (Constants)** — Update `PIPELINE_TYPES`, `CANONICAL_PIPELINE_ORDERING`, `MANDATORY_PIPELINE_TYPES`, `OPTIONAL_PIPELINE_TYPES` constants
- **Appendix B (Action Types)** — Add `RUN_SECURITY_AUDIT`, `RUN_RELEASE_ENGINEERING`
- **Appendix C (Error Conditions)** — Add error for starting a pipeline type not in WP's active stages
- Update the walkthrough example or add a second walkthrough showing optional stages in action

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
  - Define `MANDATORY_PIPELINE_TYPES` (the 4 that are always active): `['implementation', 'qa', 'code-review', 'documentation']`
  - Define `OPTIONAL_PIPELINE_TYPES`: `['security-audit', 'release-engineering']`
  - Extend `PIPELINE_AGENT_MAP` with `'security-audit': 'Security Auditor'` and `'release-engineering': 'Release Engineer'`
  - Convert `NEXT_AGENT_MAP` and `FAIL_ROUTING_MAP` from static records into functions that accept an active-stages list and compute the chain dynamically
  - Define a `DEFAULT_FAIL_ROUTING_MAP` covering all 6 types: `security-audit` FAILs route to Developer (like QA/code-review); `release-engineering` FAILs route to self (like Documentation)
  - Update `PIPELINE_PREREQUISITES` to a function that computes prerequisites from the active stages list, respecting the canonical ordering
  - Update `getDownstreamTypes()` and `getUpstreamTypes()` to accept an optional active-stages filter

- In [mcp-server/src/schema/enums.ts](../../mcp-server/src/schema/enums.ts):
  - No changes needed — `PipelineSchema.type` is already `z.string()` (not an enum), so new types are accepted

**Step 1.2 — Add active pipeline stages to WP schema**

- In [mcp-server/src/schema/work-package.ts](../../mcp-server/src/schema/work-package.ts):
  - Add `active_pipeline_stages` field to `WorkPackageDetailSchema`:
    ```typescript
    active_pipeline_stages: z.array(z.string()).optional()
    // When absent or empty, defaults to MANDATORY_PIPELINE_TYPES
    ```
  - Add optional entries to `ReworkCountsSchema` for new pipeline types:
    ```typescript
    'security-audit': z.number().int().nonnegative().optional(),
    'release-engineering': z.number().int().nonnegative().optional(),
    ```

**Step 1.3 — Update `ledger_create_work_package`**

- In [mcp-server/src/tools/work-package.ts](../../mcp-server/src/tools/work-package.ts):
  - Add optional `active_pipeline_stages` parameter to `CreateWorkPackageSchema`
  - Validate: all entries must be valid pipeline types from `PIPELINE_TYPES`; mandatory stages cannot be excluded; optional stages can be included or omitted
  - Store the resolved stages array in the WP detail file
  - Default to `MANDATORY_PIPELINE_TYPES` when parameter is omitted (backward compatibility)

**Step 1.4 — Update pipeline routing logic**

- In [mcp-server/src/tools/pipeline.ts](../../mcp-server/src/tools/pipeline.ts):
  - `startPipeline`: Read `wp.active_pipeline_stages` (or default), compute prerequisites dynamically, validate agent role against extended `PIPELINE_AGENT_MAP`
  - `completePipeline`: Compute `NEXT_AGENT_MAP` and `FAIL_ROUTING_MAP` dynamically from WP's active stages
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
- Add tests for active-stages resolution: default when omitted, validation of invalid types, mandatory stage enforcement
- Update [mcp-server/tests/tools/pipeline.test.ts](../../mcp-server/tests/tools/pipeline.test.ts) for dynamic prerequisite and routing tests
- Update existing integration tests in [mcp-server/tests/integration/full-workflow.test.ts](../../mcp-server/tests/integration/full-workflow.test.ts)
- Add new test cases for optional stage skip behavior

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

**Step 2.2 — Update persona _shared.yaml**

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

**Step 2.3 — Update orchestrator config**

- In [orchestrator/src/config.py](../../orchestrator/src/config.py):
  - Add `security-audit` and `release-engineering` to `PIPELINE_PREREQUISITES`, `PIPELINE_AGENT_MAP`
  - Add `security_auditor` and `release_engineer` to `NEXT_STAGE_MAP`, `STAGE_TO_PIPELINE`, `PERSONA_FILES`, `VALID_STAGES`
  - Update `PIPELINE_TYPES` tuple

- In [orchestrator/src/graph.py](../../orchestrator/src/graph.py):
  - Add `_STAGE_SECURITY_AUDITOR` and `_STAGE_RELEASE_ENGINEER` stage constants
  - Add these stages to `_LOOP_STAGES`
  - Register the new stage nodes in `build_graph()`

**Step 2.4 — Update GUI dashboard**

- In [mcp-server/gui/public/views/project-detail.js](../../mcp-server/gui/public/views/project-detail.js):
  - Extend `PIPELINE_STAGES` to 6:
    ```javascript
    var PIPELINE_STAGES = ['implementation', 'qa', 'security-audit', 'code-review', 'release-engineering', 'documentation'];
    ```
  - Handle optional stages gracefully in the stage badges renderer (grey badge for inactive optional stages vs. missing mandatory stages)

---

### Phase 3: New Agent Personas

**Step 3.1 — Create Security Auditor persona**

Create the following source files:

- **`personas/ledger/src/meta/5-security-auditor.yaml`** — New YAML metadata:
  ```yaml
  number: 5
  role: Security Auditor
  vs_file_name: 5-security-auditor.agent.md
  id: ledger-5-security-auditor
  cc_file_name: 5-security-auditor.md
  tools: [vscode, execute, read, edit, search, web, agent, todo, central_pm/*]
  has_mcp: true
  has_detect_project: true
  self_documenting_note: true
  has_incident_logging: true
  mcp_tools:
    - tool: ledger_get_next_action
      purpose: "Get your next task (RUN_SECURITY_AUDIT, REWORK, CLAIM_WP, or WAIT)."
    - tool: ledger_begin_work
      purpose: "Claim a READY WP and start the security-audit pipeline."
    - tool: ledger_get_work_package
      purpose: "Read WP detail including implementation and QA artifacts."
    - tool: ledger_complete_pipeline
      purpose: "Finalize with status, summary, security findings, and handoff notes."
    - tool: ledger_cancel_pipeline
      purpose: "Cancel a stale IN_PROGRESS pipeline."
    - tool: ledger_add_project_comment
      purpose: "Add project-level security comments."
    - tool: ledger_help
      note_only: true
      purpose: "Get usage documentation and examples for any ledger tool."
  ```

- **`personas/ledger/src/content/5-security-auditor.md`** — New content template covering:
  - Mission: Dedicated security review — OWASP Top 10, auth/authz, input validation, injection risks, cryptographic usage, data handling, dependency vulnerabilities
  - Review checklist (structured, not ad-hoc)
  - Pass/Fail criteria: PASS = no blocking security issues found; FAIL = blocking vulnerability found, routes to Developer
  - Integration with MCP tools and standard partials (`agent-roster`, `mcp-intro`, `role-boundaries`, `handoff-block`, etc.)

- **Create shared partial `personas/shared/partials/security-auditor-operational-protocol.md`** with the security review methodology
- **Create shared partial `personas/shared/partials/security-auditor-output-format.md`** with the output format

**Step 3.2 — Create Release Engineer persona**

Create the following source files:

- **`personas/ledger/src/meta/7-release-engineer.yaml`** — New YAML metadata:
  ```yaml
  number: 7
  role: Release Engineer
  vs_file_name: 7-release-engineer.agent.md
  id: ledger-7-release-engineer
  cc_file_name: 7-release-engineer.md
  tools: [vscode, execute, read, edit, search, web, agent, todo, central_pm/*]
  has_mcp: true
  has_detect_project: true
  self_documenting_note: true
  has_incident_logging: true
  mcp_tools:
    - tool: ledger_get_next_action
      purpose: "Get your next task (RUN_RELEASE_ENGINEERING, REWORK, CLAIM_WP, or WAIT)."
    - tool: ledger_begin_work
      purpose: "Claim a READY WP and start the release-engineering pipeline."
    - tool: ledger_get_work_package
      purpose: "Read WP detail including all prior pipeline artifacts."
    - tool: ledger_complete_pipeline
      purpose: "Finalize with changelog entries, version decisions, and handoff notes."
    - tool: ledger_cancel_pipeline
      purpose: "Cancel a stale IN_PROGRESS pipeline."
    - tool: ledger_add_project_comment
      purpose: "Add project-level release comments."
    - tool: ledger_help
      note_only: true
      purpose: "Get usage documentation and examples for any ledger tool."
  ```

- **`personas/ledger/src/content/7-release-engineer.md`** — New content template covering:
  - Mission: Changelog entry curation, version bump decisions (major/minor/patch), migration guide authoring, deployment checklist, build artifact validation
  - Pass/Fail criteria: PASS = release artifacts ready; FAIL = self-rework (like Documentation)
  - Integration with MCP tools and standard partials

- **Create shared partial `personas/shared/partials/release-engineer-operational-protocol.md`**
- **Create shared partial `personas/shared/partials/release-engineer-output-format.md`**

**Step 3.3 — Renumber existing personas**

Existing persona files need renumbering to accommodate the two new agents. This affects both YAML metadata (`number` field) and filenames:

| Current | New | Agent |
|---------|-----|-------|
| 1-planner | 1-planner | Planner (unchanged) |
| 2-project-manager | 2-project-manager | PM (unchanged) |
| 3-developer | 3-developer | Developer (unchanged) |
| 4-qa | 4-qa | QA (unchanged) |
| *(new)* | 5-security-auditor | Security Auditor |
| 5-reviewer | 6-reviewer | Reviewer (renumbered 5→6) |
| *(new)* | 7-release-engineer | Release Engineer |
| 6-documentation | 8-documentation | Documentation (renumbered 6→8) |
| 7-synthesis | 9-synthesis | Synthesis (renumbered 7→9) |

For each renumbered persona:
- Update YAML `number` field
- Rename YAML file (`personas/ledger/src/meta/N-name.yaml`)
- Rename content file (`personas/ledger/src/content/N-name.md`)
- Update `vs_file_name` (e.g., `5-reviewer.agent.md` → `6-reviewer.agent.md`)
- Update `cc_file_name` (e.g., `5-reviewer.md` → `6-reviewer.md`)
- **Keep `id` fields stable** (per constraint 25b — `id` values must never change once published). The existing `id` values (`ledger-5-reviewer`, `ledger-6-docs`, `ledger-7-synthesis`) must be preserved. This means the `id` naming convention (`ledger-{vs_file_name stem}`) will diverge for renumbered personas, which is acceptable because `id` stability takes precedence over naming convention purity.

**Critical consideration**: Renumbering has wide impact — every file that references agent numbers changes. An alternative is to **keep existing numbers and insert the new agents at positions 5 and 7** within the expanded 9-slot numbering (1, 2, 3, 4, 5-new, 6-existing-reviewer, 7-new, 8-existing-docs, 9-existing-synth). This is the recommended approach since it minimizes `id` breakage. In this approach:

- Rename `5-reviewer.*` → `6-reviewer.*` (number: 5→6, filename changes, `id: ledger-5-reviewer` stays)
- Rename `6-documentation.*` → `8-documentation.*` (number: 6→8, filename changes, `id: ledger-6-docs` stays)
- Rename `7-synthesis.*` → `9-synthesis.*` (number: 7→9, filename changes, `id: ledger-7-synthesis` stays)

---

### Phase 4: Simplify Existing Personas

**Step 4.1 — Simplify Developer persona**

- In [personas/ledger/src/content/3-developer.md](../../personas/ledger/src/content/3-developer.md):
  - Remove security annotation responsibilities (now handled by Security Auditor)
  - Remove any release consideration notes (now handled by Release Engineer)
  - Keep: implementation, tests, Code Insight Observer role

- In [personas/shared/partials/developer-strict-constraints.md](../../personas/shared/partials/developer-strict-constraints.md):
  - Remove security-specific constraints that are now the Security Auditor's domain

**Step 4.2 — Simplify Reviewer persona**

- In [personas/ledger/src/content/5-reviewer.md](../../personas/ledger/src/content/5-reviewer.md) (will be `6-reviewer.md` after renumbering):
  - Remove "Security & Performance" review bullet point (line 52 area)
  - Remove security vulnerability mentions from FAIL criteria
  - Keep: code quality, architecture, maintainability, patterns
  - Add note: "Security concerns are handled by the Security Auditor in a dedicated pipeline stage. Focus your review on code quality, architecture, and maintainability."

- In [personas/shared/partials/reviewer-operational-protocol.md](../../personas/shared/partials/reviewer-operational-protocol.md):
  - Remove security review responsibilities

**Step 4.3 — Simplify Documentation persona**

- In [personas/ledger/src/content/6-documentation.md](../../personas/ledger/src/content/6-documentation.md) (will be `8-documentation.md` after renumbering):
  - Remove changelog/release notes responsibilities (now handled by Release Engineer)
  - Remove version reference management
  - Keep: technical docs, API references, architecture guides, README curation

---

### Phase 5: PM Sub-Agent Decomposition

**Step 5.1 — Create PM sub-agent persona files**

Create 4 standalone personas in `personas/standalone/`:

1. **`personas/standalone/src/meta/wp-decomposer.yaml`** + **`personas/standalone/src/content/wp-decomposer.md`**
   - **WP Decomposition Sub-Agent**: Analyzes the plan and breaks it into atomic work packages with clear scope, acceptance criteria, and deliverables
   - Input: Plan document
   - Output: List of WP definitions with titles, descriptions, acceptance criteria, and estimated complexity

2. **`personas/standalone/src/meta/dependency-sequencer.yaml`** + **`personas/standalone/src/content/dependency-sequencer.md`**
   - **Dependency & Sequencing Sub-Agent**: Maps dependencies between WPs, identifies parallelization opportunities, determines execution ordering
   - Input: WP definitions from decomposer
   - Output: Dependency graph, execution order, parallelization opportunities

3. **`personas/standalone/src/meta/pipeline-configurator.yaml`** + **`personas/standalone/src/content/pipeline-configurator.md`**
   - **Pipeline Configurator Sub-Agent**: For each WP, determines which optional pipeline stages are needed based on WP characteristics
   - Input: WP definitions + dependency graph
   - Output: Per-WP active pipeline stage configuration
   - Decision criteria:
     - Include Security Auditor when WP touches auth, data storage, external APIs, cryptography, user input handling, or security-sensitive areas
     - Include Release Engineer when the project has release artifacts, breaking changes, or version-sensitive deliverables

4. **`personas/standalone/src/meta/ledger-bootstrapper.yaml`** + **`personas/standalone/src/content/ledger-bootstrapper.md`**
   - **Ledger Bootstrapper Sub-Agent**: Mechanical execution — creates the ledger entries, initializes WPs via MCP tools, verifies the setup
   - Input: WP definitions + dependency graph + pipeline configurations
   - Output: Initialized ledger with all WPs created
   - Has MCP tools access (`central_pm/*`)

**Step 5.2 — Update PM persona to orchestrate sub-agents**

- In [personas/ledger/src/content/2-project-manager.md](../../personas/ledger/src/content/2-project-manager.md):
  - Replace the monolithic workflow with a **sub-agent orchestration workflow**:
    1. Pre-flight (unchanged)
    2. Read the plan
    3. Invoke WP Decomposer sub-agent → receive WP definitions
    4. Invoke Dependency Sequencer sub-agent → receive dependency graph + ordering
    5. Invoke Pipeline Configurator sub-agent → receive per-WP pipeline configs
    6. Invoke Ledger Bootstrapper sub-agent → ledger initialized
    7. Verify via `ledger_get_project_status`
    8. Handoff

- In [personas/ledger/src/meta/2-project-manager.yaml](../../personas/ledger/src/meta/2-project-manager.yaml):
  - Ensure `tools` includes `agent` for sub-agent invocation (already present)

**Step 5.3 — Update PM output format partial**

- In [personas/shared/partials/pm-output-format.md](../../personas/shared/partials/pm-output-format.md):
  - Update to reflect the sub-agent orchestration pattern
  - Add guidance on passing context between sub-agents

---

### Phase 6: Persona Build System Updates

**Step 6.1 — Update build script computed variables**

- In [scripts/build-personas.js](../../scripts/build-personas.js):
  - Update `renderRoster()` to handle 9 agents instead of 7
  - Update `total` computed variable from `_shared.roster.length` (now 9)
  - No structural changes needed — the build system is already persona-count-agnostic

**Step 6.2 — Build and verify**

- Run `node scripts/build-personas.js --suite all --strict` to verify all templates resolve correctly
- Run `node scripts/build-personas.js --suite all --check` to verify output is up-to-date
- Run `node scripts/check-known-roles.js` to verify role parity

---

### Phase 7: Documentation & Manifest Updates

**Step 7.1 — Update project manifests**

- [mcp-server/docs/agents/project-manifest/api-surface.md](../../mcp-server/docs/agents/project-manifest/api-surface.md):
  - Document new `active_pipeline_stages` parameter on `ledger_create_work_package`
  - Document new pipeline types and their routing behavior
  - Update `PIPELINE_TYPES` documentation

- [mcp-server/docs/agents/project-manifest/constraints.md](../../mcp-server/docs/agents/project-manifest/constraints.md):
  - Add constraint for active pipeline stages validation
  - Document mandatory vs. optional stage behavior

- [mcp-server/docs/agents/project-manifest/data-flows.md](../../mcp-server/docs/agents/project-manifest/data-flows.md):
  - Update Flow 2 (Work Package Creation) to include active stages
  - Update Flow 4 (Starting a Pipeline) for dynamic prerequisites

- [mcp-server/docs/agents/project-manifest/file-tree.md](../../mcp-server/docs/agents/project-manifest/file-tree.md):
  - No structural changes (no new files in mcp-server/src/)

- [personas/docs/agents/project-manifest/file-tree.md](../../personas/docs/agents/project-manifest/file-tree.md):
  - Add new persona files (security-auditor, release-engineer)
  - Add new standalone sub-agent files
  - Update renumbered filenames

- [personas/docs/agents/project-manifest/api-surface.md](../../personas/docs/agents/project-manifest/api-surface.md):
  - Update roster documentation from 7 to 9

- [personas/docs/agents/project-manifest/constraints.md](../../personas/docs/agents/project-manifest/constraints.md):
  - Update naming conventions for 9-agent numbering
  - Add constraints for new personas

**Step 7.2 — Update AGENTS.md files**

- [AGENTS.md](../../AGENTS.md) (workspace root):
  - Update "7-stage workflow" references to "9-stage workflow"
  - Update cross-system dependency table

- [mcp-server/AGENTS.md](../../mcp-server/AGENTS.md):
  - Update agent role references

**Step 7.3 — Update ledger README**

- [personas/ledger/README.md](../../personas/ledger/README.md):
  - Rewrite workflow description for 9-agent dynamic pipeline
  - Document optional stages and PM decision criteria

**Step 7.4 — Update help content**

- In [mcp-server/src/tools/help-content.ts](../../mcp-server/src/tools/help-content.ts):
  - Update `TOOL_HELP` entries for `ledger_create_work_package` (new `active_pipeline_stages` parameter)
  - Add new pipeline types to help text

---

## Dependencies

- **Phase 0** (Workflow Specification) has no dependencies — must start first as the source of truth
- **Phase 1** (MCP Server Foundation) depends on Phase 0 (implements the spec changes)
- **Phase 2** (Cross-System Sync) depends on Phase 1 (needs new AGENT_ROLES)
- **Phase 3** (New Personas) depends on Phase 2 (needs updated roster in _shared.yaml)
- **Phase 4** (Simplify Existing) depends on Phase 3 (renumbering must happen first)
- **Phase 5** (PM Sub-Agents) depends on Phase 1 (needs the `active_pipeline_stages` parameter on `ledger_create_work_package`)
- **Phase 6** (Build System) depends on Phases 3-5 (needs all persona source files ready)
- **Phase 7** (Documentation) depends on all other phases

Phases 3, 4, and 5 can partially overlap since they touch different files.

## Required Components

### New Files

| File | Purpose |
|------|---------|
| `personas/ledger/src/meta/5-security-auditor.yaml` | Security Auditor persona metadata |
| `personas/ledger/src/content/5-security-auditor.md` | Security Auditor body template |
| `personas/ledger/src/meta/7-release-engineer.yaml` | Release Engineer persona metadata |
| `personas/ledger/src/content/7-release-engineer.md` | Release Engineer body template |
| `personas/shared/partials/security-auditor-operational-protocol.md` | Security Auditor methodology |
| `personas/shared/partials/security-auditor-output-format.md` | Security Auditor output format |
| `personas/shared/partials/release-engineer-operational-protocol.md` | Release Engineer methodology |
| `personas/shared/partials/release-engineer-output-format.md` | Release Engineer output format |
| `personas/standalone/src/meta/wp-decomposer.yaml` | PM sub-agent: WP decomposition |
| `personas/standalone/src/content/wp-decomposer.md` | PM sub-agent: WP decomposition body |
| `personas/standalone/src/meta/dependency-sequencer.yaml` | PM sub-agent: dependency ordering |
| `personas/standalone/src/content/dependency-sequencer.md` | PM sub-agent: dependency ordering body |
| `personas/standalone/src/meta/pipeline-configurator.yaml` | PM sub-agent: stage selection |
| `personas/standalone/src/content/pipeline-configurator.md` | PM sub-agent: stage selection body |
| `personas/standalone/src/meta/ledger-bootstrapper.yaml` | PM sub-agent: ledger creation |
| `personas/standalone/src/content/ledger-bootstrapper.md` | PM sub-agent: ledger creation body |

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
| `personas/ledger/src/meta/5-reviewer.yaml` → `6-reviewer.yaml` | Renumber |
| `personas/ledger/src/meta/6-documentation.yaml` → `8-documentation.yaml` | Renumber |
| `personas/ledger/src/meta/7-synthesis.yaml` → `9-synthesis.yaml` | Renumber |
| `personas/ledger/src/content/5-reviewer.md` → `6-reviewer.md` | Renumber + simplify |
| `personas/ledger/src/content/6-documentation.md` → `8-documentation.md` | Renumber + simplify |
| `personas/ledger/src/content/7-synthesis.md` → `9-synthesis.md` | Renumber |
| `personas/ledger/src/content/2-project-manager.md` | Sub-agent orchestration |
| `personas/ledger/src/content/3-developer.md` | Remove security duties |
| `personas/shared/partials/reviewer-operational-protocol.md` | Remove security review |
| `personas/shared/partials/pm-output-format.md` | Sub-agent pattern |
| `orchestrator/src/config.py` | Add new stages and pipeline types |
| `orchestrator/src/graph.py` | Add new stage nodes |
| Multiple test files | Update for new types and routing |
| Multiple manifest docs | Update for new architecture |

### Renamed Files (Phase 3.3)

| Current | New |
|---------|-----|
| `personas/ledger/src/meta/5-reviewer.yaml` | `personas/ledger/src/meta/6-reviewer.yaml` |
| `personas/ledger/src/meta/6-documentation.yaml` | `personas/ledger/src/meta/8-documentation.yaml` |
| `personas/ledger/src/meta/7-synthesis.yaml` | `personas/ledger/src/meta/9-synthesis.yaml` |
| `personas/ledger/src/content/5-reviewer.md` | `personas/ledger/src/content/6-reviewer.md` |
| `personas/ledger/src/content/6-documentation.md` | `personas/ledger/src/content/8-documentation.md` |
| `personas/ledger/src/content/7-synthesis.md` | `personas/ledger/src/content/9-synthesis.md` |

---

## Assumptions

1. The `id` field stability constraint (constraint 25b) takes precedence over naming convention purity — renumbered personas keep their original `id` values even though they no longer match the `ledger-{vs_file_name stem}` pattern.
2. Existing ledger files without `active_pipeline_stages` will be treated as having the 4 mandatory stages (backward compatibility via schema default).
3. The Security Auditor's failure routing goes to Developer (same pattern as QA/code-review failures).
4. The Release Engineer's failure routing is self-rework (same pattern as Documentation).
5. PM sub-agents are standalone personas, not ledger personas — they don't appear in the pipeline ordering and don't have pipeline types.
6. The `renderRoster()` function in the build script already handles variable-length rosters (it iterates `_shared.roster` dynamically).

---

## Constraints

- **STDIO discipline** (Constraint 7): No `console.log` in any new MCP server code. All logs to `stderr` via `console.error`.
- **Atomic writes** (Constraint 1): All new file I/O uses `atomicWriteJson()`.
- **File locking** (Constraint 2): Dual-file updates wrapped in `withLock(store.storageDir)`.
- **Generated files** (Persona Constraint 1): Never edit files in `vs-code/` or `claude-code/` directories directly.
- **`id` stability** (Constraint 25b): Existing `id` values must not change. New personas get new stable `id` values.
- **Template engine limitations** (Constraints 4-7): No nested `{{#if}}`, max partial depth 2, no `{{#each}}`.
- **Role parity** (Constraint 25): `AGENT_ROLES`, `KNOWN_ROLES`, and persona YAML `role` values must match.

---

## Out of Scope

- **Orchestrator deep-agents changes**: The orchestrator will need new stage nodes, but deep-agents prompt changes are out of scope.
- **GUI visual redesign**: The GUI gets updated constants but no layout/UX redesign.
- **Automated PM sub-agent invocation**: The PM persona will document the sub-agent workflow, but automating `runSubagent` chaining is not implemented server-side.
- **Migration script for existing ledgers**: Existing ledgers will work via backward compatibility (absent `active_pipeline_stages` defaults to mandatory-only). No migration tool is needed.
- **Performance pipeline type**: Not adding a dedicated performance review stage — this remains part of the Reviewer's purview.
- **Planner and Synthesis personas**: These are not modified beyond updating their `number` field (Planner stays 1, Synthesis becomes 9) and updating roster references.

---

## Acceptance Criteria

1. `AGENT_ROLES` in `constants.ts` contains exactly 9 roles in the correct order.
2. `KNOWN_ROLES` in `sync-personas.js` matches `AGENT_ROLES` — `check-known-roles.js` passes.
3. `PIPELINE_TYPES` in `pipeline-maps.ts` contains 6 pipeline types in canonical order.
4. `ledger_create_work_package` accepts an optional `active_pipeline_stages` parameter.
5. When `active_pipeline_stages` is omitted, the WP defaults to the 4 mandatory stages (backward compatibility).
6. When `active_pipeline_stages` includes `security-audit`, the pipeline chain inserts Security Auditor between QA and Reviewer.
7. When `active_pipeline_stages` includes `release-engineering`, the pipeline chain inserts Release Engineer between Reviewer and Documentation.
8. `ledger_start_pipeline` validates agent role against `PIPELINE_AGENT_MAP` for new types.
9. `ledger_complete_pipeline` routes to the correct next agent per the WP's active stages.
10. Security Auditor FAIL routes to Developer. Release Engineer FAIL routes to self.
11. All 9 persona source files exist and build without errors (`--strict --suite all` passes).
12. All 4 PM sub-agent personas exist and build without errors (`--strict --suite all` passes).
13. Existing tests pass (no regressions).
14. New tests cover: dynamic routing, optional stage skip, new pipeline type validation, backward compatibility.
15. Orchestrator `PERSONA_FILES` includes the new stage mappings.
16. GUI `PIPELINE_STAGES` displays 6 stages with graceful handling of optional stages.
17. All project manifest documents are updated to reflect the 9-agent dynamic pipeline.

---

## Testing Strategy

### Unit Tests (mcp-server)

- **Pipeline maps**: Test dynamic routing functions with various active-stages combinations (all-6, mandatory-only, security-audit-only, release-engineering-only, both optional)
- **Schema**: Validate `active_pipeline_stages` field acceptance and defaults
- **Work package creation**: Test with and without `active_pipeline_stages`, validate mandatory stages cannot be excluded
- **Pipeline start**: Test prerequisite checking with skipped optional stages
- **Pipeline complete**: Test next-agent routing with dynamic chains
- **Workflow next-action**: Test action computation respects per-WP active stages
- **Backward compatibility**: Load existing WP JSON without `active_pipeline_stages`, verify default behavior

### Integration Tests (mcp-server)

- Full workflow with all 6 stages active
- Full workflow with only mandatory stages (matches today's behavior)
- Mixed project: some WPs with optional stages, some without
- Failure routing through optional stages (Security Auditor FAIL → Developer)
- Self-rework in Release Engineer (FAIL → self)

### Build System Tests

- `--check` passes for all 9 ledger personas + 4 PM sub-agents
- `--strict` passes with no unresolved markers
- `check-known-roles.js` passes with 9 roles

### Orchestrator Tests

- Graph builds with new stage nodes
- Supervisor routes to new stages correctly

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Breaking existing ledger files** | Schema backward compatibility: `active_pipeline_stages` defaults to mandatory types when absent. All routing functions fall back to mandatory-only chain. Add explicit backward-compat tests. |
| **`id` field breakage from renumbering** | Preserve existing `id` values for renumbered personas. Document the divergence from naming convention. |
| **Wide blast radius** | Phased implementation with tests at each phase boundary. Phase 0 (spec) is reviewed before any code changes. Phase 1 (MCP server) can be deployed and tested independently before persona changes. |
| **Spec-implementation drift** | Spec-first approach: Phase 0 updates the specification before any code is written. Tests reference spec section numbers. Implementation is validated against the spec, not vice versa. |
| **Dynamic routing complexity** | Keep the canonical ordering as the source of truth. Dynamic functions just filter the canonical chain — they don't reorder it. This makes reasoning about the chain simple: it's always a subsequence of the canonical ordering. |
| **PM sub-agent cognitive overhead** | Sub-agents have focused missions with clear input/output contracts. The PM persona provides explicit orchestration steps. If sub-agents prove too granular, the Decomposer and Sequencer can be merged into a single sub-agent without affecting the architecture. |
| **Orchestrator drift** | The orchestrator's Python constants are NOT auto-synced with TypeScript. Document the manual sync requirement. Consider a future sync script. |
| **Template engine limits for 9 agents** | The `renderRoster()` function iterates dynamically — no hardcoded count. Verified assumption via build-personas.js analysis. |
| **GUI badge rendering for optional stages** | Add distinct visual treatment (grey/dashed) for inactive optional stages vs. truly missing mandatory stages. |

---

## Recommended Implementation Order

1. **Phase 0** first — the workflow specification is the source of truth; all downstream phases implement and validate against it
2. **Phase 1** immediately after — implements the spec in TypeScript
3. **Phase 2** immediately after Phase 1 — unblocks persona work
4. **Phase 3.3** (renumbering) before 3.1/3.2 — establish the numbering scheme, then create new personas in the correct slots
5. **Phases 3.1, 3.2, 4, 5** can overlap with different developers
6. **Phase 6** after all persona sources are ready
7. **Phase 7** last — documenting the final state

AGENT: Planning
STATUS: READY_FOR_PM
