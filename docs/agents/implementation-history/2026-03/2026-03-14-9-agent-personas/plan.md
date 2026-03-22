# Plan 2: 9-Agent Personas & PM Sub-Agents

> **Part 2 of 2** — This plan adds the new personas and decomposes the PM (Phases 3–7). Requires [Plan 1](../2026-03-14-dynamic-pipeline-engine/plan.md) (Dynamic Pipeline Engine) to be completed first.

## Summary

Build on the composable pipeline engine delivered by Plan 1 to: add two new agent personas (Security Auditor and Release Engineer), renumber existing personas to accommodate them, simplify existing personas by offloading dedicated responsibilities to the new agents, decompose the PM's cognitive load into 4 standalone sub-agents, verify the build system handles 9 ledger + 4 standalone personas, and update all documentation to reflect the 9-agent model.

> **Prerequisite:** Plan 1 must be completed before this plan begins. Plan 1 delivers the 6-type pipeline engine, 9-role `AGENT_ROLES`, expanded roster in `_shared.yaml`, and updated workflow specification. This plan consumes those capabilities.

## Architectural Context

### State After Plan 1

Plan 1 delivers:

- **Workflow Specification v2.0.0** — 6 pipeline types, PM-composable stages, dynamic routing
- **`AGENT_ROLES`** — 9 roles: Planner, PM, Developer, QA, Security Auditor, Reviewer, Release Engineer, Documentation, Synthesis
- **`PIPELINE_TYPES`** — 6 types in canonical order: `implementation`, `qa`, `security-audit`, `code-review`, `release-engineering`, `documentation`
- **`active_pipeline_stages`** — Per-WP field on `WorkPackageDetail`, defaults to `DEFAULT_PIPELINE_STAGES`
- **Dynamic routing** — `resolveNextAgent()`, `resolvePrerequisite()`, fail-routing fallback
- **Expanded roster** — `_shared.yaml` has 9 entries
- **`KNOWN_ROLES`** — Synced to 9 roles in `sync-personas.js`

### What This Plan Adds

- **2 new ledger personas** — Security Auditor (#5), Release Engineer (#7)
- **3 renumbered ledger personas** — Reviewer (5→6), Documentation (6→8), Synthesis (7→9)
- **3 simplified ledger personas** — Developer, Reviewer, Documentation (offload duties)
- **4 standalone PM sub-agents** — WP Decomposer, Dependency Sequencer, Pipeline Configurator, Ledger Bootstrapper
- **Updated PM persona** — Sub-agent orchestration workflow
- **Build verification** — All 9 ledger + 4 standalone + existing standalone personas build clean
- **Full documentation** — All manifests, AGENTS.md files, READMEs updated

### Persona Build System

Source templates in `personas/ledger/src/` (meta YAML + content Markdown + partials) are assembled by [scripts/build-personas.js](../../scripts/build-personas.js) into generated files in `personas/ledger/vs-code/` and `personas/ledger/claude-code/`. Generated files must NEVER be edited directly. The build system supports:

- Per-persona YAML metadata with feature flags
- `{{> partial}}` inclusion (2-layer: `shared/partials/` base + `ledger/src/partials/` override)
- `{{#if flag}}…{{/if}}` conditionals (no nesting)
- `{{variable}}` interpolation
- Computed variables: `roster_rendered`, `mcp_tools_table`, `tools_json`

### PM Sub-Agent Strategy

Implement sub-agents as **separate persona files** invoked via `runSubagent` (VS Code) or `Task` (Claude Code). This is the recommended approach because:

1. **Separation of concerns** — Each sub-agent has a focused mission with clear inputs/outputs
2. **Token efficiency** — Only the active sub-agent's prompt is loaded into context
3. **Reusability** — Sub-agents can be iterated independently
4. **Consistency** — Follows the existing pattern of invoking agents via `runSubagent`

The sub-agents will be **standalone personas** (not numbered ledger personas) that the PM invokes sequentially. They do NOT appear in the top-level pipeline.

---

## Rationale

1. **Sub-agents as standalone personas**: The PM's cognitive load problem is best solved by delegation to focused helpers. Inline checklists don't reduce token pressure; separate personas loaded via `runSubagent` do.

2. **Simplify by offloading, not by adding**: Security Auditor absorbs security duties from Developer and Reviewer. Release Engineer absorbs release/changelog duties from Documentation. This makes each persona more focused and easier to maintain.

3. **Renumber by insertion, not by reindex**: Keeping existing `id` values stable (per constraint 25b) while renumbering file positions minimizes downstream breakage. The `id` naming convention divergence is acceptable because `id` stability takes precedence.

---

## Detailed Steps

### Phase 3: New Agent Personas

**Step 3.0 — Renumber existing personas**

Existing persona files need renumbering to accommodate the two new agents. This must happen before creating new personas to establish the correct numbering slots.

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

Specific renames:
- `personas/ledger/src/meta/5-reviewer.yaml` → `6-reviewer.yaml` (number: 5→6, `id: ledger-5-reviewer` stays)
- `personas/ledger/src/meta/6-documentation.yaml` → `8-documentation.yaml` (number: 6→8, `id: ledger-6-docs` stays)
- `personas/ledger/src/meta/7-synthesis.yaml` → `9-synthesis.yaml` (number: 7→9, `id: ledger-7-synthesis` stays)
- `personas/ledger/src/content/5-reviewer.md` → `6-reviewer.md`
- `personas/ledger/src/content/6-documentation.md` → `8-documentation.md`
- `personas/ledger/src/content/7-synthesis.md` → `9-synthesis.md`

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

---

### Phase 4: Simplify Existing Personas

**Step 4.1 — Simplify Developer persona**

- In [personas/ledger/src/content/3-developer.md](../../personas/ledger/src/content/3-developer.md):
  - Remove security annotation responsibilities (now handled by Security Auditor)
  - Remove any release consideration notes (now handled by Release Engineer)
  - Add explicit guidance: "Declare ALL modified files in `artifacts.files_modified` when completing a pipeline, including ancillary or out-of-scope improvements"
  - Keep: implementation, tests, Code Insight Observer role

- In [personas/shared/partials/developer-strict-constraints.md](../../personas/shared/partials/developer-strict-constraints.md):
  - Remove security-specific constraints that are now the Security Auditor's domain

**Step 4.2 — Simplify Reviewer persona**

- In `personas/ledger/src/content/6-reviewer.md` (post-renumbering):
  - Remove "Security & Performance" review bullet point (line 52 area)
  - Remove security vulnerability mentions from FAIL criteria
  - Keep: code quality, architecture, maintainability, patterns
  - Add note: "Security concerns are handled by the Security Auditor in a dedicated pipeline stage. Focus your review on code quality, architecture, and maintainability."

- In [personas/shared/partials/reviewer-operational-protocol.md](../../personas/shared/partials/reviewer-operational-protocol.md):
  - Remove security review responsibilities

**Step 4.3 — Simplify Documentation persona**

- In `personas/ledger/src/content/8-documentation.md` (post-renumbering):
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
   - **Pipeline Configurator Sub-Agent**: For each WP, determines which pipeline stages should be active based on WP characteristics
   - Input: WP definitions + dependency graph
   - Output: Per-WP active pipeline stage configuration (any valid subsequence of the canonical ordering)
   - Decision criteria:
     - Include Security Auditor when WP touches auth, data storage, external APIs, cryptography, user input handling, or security-sensitive areas
     - Include Release Engineer when the project has release artifacts, breaking changes, or version-sensitive deliverables
     - Use documentation-only chain (`["documentation", "qa", "code-review"]`) when WP is purely documentation work (no code changes)
     - Use verification-only chain (`["qa", "code-review"]`) when WP validates existing state without making changes
     - Include standard chain (`["implementation", "qa", "code-review", "documentation"]`) for typical code-change WPs
   - Applies soft guardrail awareness: flags compositions that would trigger warnings and documents rationale for the PM

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

### Phase 7b: Persona Documentation Updates

Update project manifests and documentation to reflect the 9-agent persona model. Engine-specific docs were already updated in Plan 1's Phase 7a.

**Step 7b.1 — Update persona project manifest**

- [personas/docs/agents/project-manifest/file-tree.md](../../personas/docs/agents/project-manifest/file-tree.md):
  - Add new persona files (security-auditor, release-engineer)
  - Add new standalone sub-agent files
  - Update renumbered filenames

- [personas/docs/agents/project-manifest/api-surface.md](../../personas/docs/agents/project-manifest/api-surface.md):
  - Update roster documentation from 7 to 9

- [personas/docs/agents/project-manifest/constraints.md](../../personas/docs/agents/project-manifest/constraints.md):
  - Update naming conventions for 9-agent numbering
  - Add constraints for new personas

**Step 7b.2 — Update ledger README**

- [personas/ledger/README.md](../../personas/ledger/README.md):
  - Rewrite workflow description for 9-agent dynamic pipeline
  - Document PM-composable stages and common composition patterns
  - Document artifact declaration expectation

**Step 7b.3 — Update AGENTS.md references (if not already done in Plan 1)**

- [AGENTS.md](../../AGENTS.md) (workspace root):
  - Verify "9-stage workflow" references are correct (may already be done by Plan 1)
  - Update any persona-specific references

---

## Dependencies

- **Plan 1** must be complete (prerequisite)
- **Phase 3.0** (renumbering) must happen before 3.1/3.2 — establish the numbering scheme before creating new personas
- **Phase 4** (simplify existing) depends on Phase 3.0 (renumbering must happen first)
- **Phase 5** (PM sub-agents) has no dependency on Phases 3–4 (touches different files), but requires Plan 1's `active_pipeline_stages` parameter
- **Phase 6** (build verification) depends on Phases 3–5 (needs all persona source files ready)
- **Phase 7b** (documentation) depends on all other phases

```
Plan 1 (complete)
    ↓
Phase 3.0 (renumber) → Phase 3.1 + 3.2 (new personas) → Phase 4 (simplify)
                                                                    ↓
Phase 5 (PM sub-agents) ──────────────────────────────────→ Phase 6 (build verify)
                                                                    ↓
                                                            Phase 7b (docs)
```

Phases 3–4 and Phase 5 can run in parallel since they touch different files.

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

### Renamed Files (Phase 3.0)

| Current | New |
|---------|-----|
| `personas/ledger/src/meta/5-reviewer.yaml` | `personas/ledger/src/meta/6-reviewer.yaml` |
| `personas/ledger/src/meta/6-documentation.yaml` | `personas/ledger/src/meta/8-documentation.yaml` |
| `personas/ledger/src/meta/7-synthesis.yaml` | `personas/ledger/src/meta/9-synthesis.yaml` |
| `personas/ledger/src/content/5-reviewer.md` | `personas/ledger/src/content/6-reviewer.md` |
| `personas/ledger/src/content/6-documentation.md` | `personas/ledger/src/content/8-documentation.md` |
| `personas/ledger/src/content/7-synthesis.md` | `personas/ledger/src/content/9-synthesis.md` |

### Modified Files

| File | Change |
|------|--------|
| `personas/ledger/src/content/2-project-manager.md` | Sub-agent orchestration workflow |
| `personas/ledger/src/content/3-developer.md` | Remove security/release duties, add artifact guidance |
| `personas/ledger/src/content/6-reviewer.md` (post-rename) | Remove security duties |
| `personas/ledger/src/content/8-documentation.md` (post-rename) | Remove release/changelog duties |
| `personas/ledger/src/meta/6-reviewer.yaml` (post-rename) | Update number, vs_file_name, cc_file_name |
| `personas/ledger/src/meta/8-documentation.yaml` (post-rename) | Update number, vs_file_name, cc_file_name |
| `personas/ledger/src/meta/9-synthesis.yaml` (post-rename) | Update number, vs_file_name, cc_file_name |
| `personas/shared/partials/developer-strict-constraints.md` | Remove security-specific constraints |
| `personas/shared/partials/reviewer-operational-protocol.md` | Remove security review |
| `personas/shared/partials/pm-output-format.md` | Sub-agent orchestration pattern |
| `personas/ledger/README.md` | 9-agent dynamic pipeline description |
| Multiple persona manifest docs | 9-agent numbering and new files |

---

## Assumptions

1. Plan 1 has been completed — `AGENT_ROLES` is 9, `PIPELINE_TYPES` is 6, `_shared.yaml` has 9 roster entries, `KNOWN_ROLES` is 9.
2. The `id` field stability constraint (constraint 25b) takes precedence over naming convention purity — renumbered personas keep their original `id` values even though they no longer match the `ledger-{vs_file_name stem}` pattern.
3. PM sub-agents are standalone personas, not ledger personas — they don't appear in the pipeline ordering and don't have pipeline types.
4. The `renderRoster()` function in the build script already handles variable-length rosters (it iterates `_shared.roster` dynamically).
5. If PM sub-agents prove too granular, the Decomposer and Sequencer can be merged into a single sub-agent without affecting the architecture.

---

## Constraints

- **Generated files** (Persona Constraint 1): Never edit files in `vs-code/` or `claude-code/` directories directly.
- **`id` stability** (Constraint 25b): Existing `id` values must not change. New personas get new stable `id` values.
- **Template engine limitations** (Constraints 4-7): No nested `{{#if}}`, max partial depth 2, no `{{#each}}`.
- **Role parity** (Constraint 25): `AGENT_ROLES`, `KNOWN_ROLES`, and persona YAML `role` values must match.

---

## Out of Scope

- **Pipeline engine changes** — Completed in Plan 1. No MCP server routing logic changes in this plan.
- **Orchestrator deep-agents changes**: The orchestrator has new stage nodes (from Plan 1) but deep-agents prompt changes are out of scope.
- **GUI visual redesign**: The GUI was updated in Plan 1 with new constants. No layout/UX redesign.
- **Automated PM sub-agent invocation**: The PM persona documents the sub-agent workflow, but automating `runSubagent` chaining is not implemented server-side.
- **Performance pipeline type**: Not adding a dedicated performance review stage — this remains part of the Reviewer's purview.
- **Planner and Synthesis personas**: Not modified beyond renumbering Synthesis (7→9) and updating roster references.

---

## Acceptance Criteria

1. All 9 persona source files exist with correct numbering and metadata.
2. Renumbered personas preserve their original `id` values (`ledger-5-reviewer`, `ledger-6-docs`, `ledger-7-synthesis`).
3. Security Auditor persona covers OWASP Top 10, auth/authz, injection, cryptography review.
4. Release Engineer persona covers changelog curation, version bumps, deployment readiness.
5. Developer persona no longer mentions security annotation responsibilities.
6. Reviewer persona no longer mentions security review responsibilities.
7. Documentation persona no longer mentions changelog/release duties.
8. All 4 PM sub-agent personas exist as standalone personas with clear input/output contracts.
9. PM persona orchestrates the 4 sub-agents in sequence with explicit steps.
10. `node scripts/build-personas.js --suite all --strict` passes (all templates resolve).
11. `node scripts/build-personas.js --suite all --check` passes (output is up-to-date).
12. `node scripts/check-known-roles.js` passes (role parity verified).
13. All persona manifest documents are updated to reflect 9-agent numbering.
14. `personas/ledger/README.md` describes the 9-agent dynamic pipeline with composition patterns.

---

## Testing Strategy

### Build System Tests

- `--check` passes for all 9 ledger personas + 4 PM sub-agents + existing standalone personas
- `--strict` passes with no unresolved markers
- `check-known-roles.js` passes with 9 roles

### Manual Verification

- Review each generated persona file (`vs-code/` and `claude-code/`) to verify:
  - Correct agent number and role in header
  - Correct roster rendering (9 agents)
  - Correct MCP tools table
  - Partials correctly resolved
  - No stale 7-agent references
- Verify Security Auditor persona has complete security review methodology
- Verify Release Engineer persona has complete release management workflow
- Verify Developer, Reviewer, Documentation personas no longer contain offloaded duties
- Verify PM persona documents the sub-agent orchestration workflow

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **`id` field breakage from renumbering** | Preserve existing `id` values for renumbered personas. Document the divergence from naming convention. |
| **Security Auditor persona too broad/narrow** | Start with OWASP Top 10 as the structured checklist. Iterate based on usage feedback. |
| **Release Engineer persona overlaps with Documentation** | Clear separation: Release Engineer owns changelog + versioning; Documentation owns technical docs + READMEs. |
| **PM sub-agent cognitive overhead** | Sub-agents have focused missions with clear input/output contracts. If too granular, Decomposer and Sequencer can be merged. |
| **Template engine limits for 9 agents** | The `renderRoster()` function iterates dynamically — no hardcoded count. Verified assumption via build-personas.js analysis. |
| **Stale references to 7-agent model** | Grep entire workspace for "7-stage", "7-agent", "7 agent" patterns after completion. Fix any stragglers. |

---

## Recommended Implementation Order

1. **Phase 3.0** first — renumber existing personas to free up slots 5 and 7
2. **Phases 3.1 + 3.2** — create Security Auditor and Release Engineer personas
3. **Phase 4** — simplify Developer, Reviewer, Documentation (depends on renumbering)
4. **Phase 5** — create PM sub-agents and update PM persona (can overlap with 3.1–4)
5. **Phase 6** — build and verify all personas
6. **Phase 7b** — update all documentation

AGENT: Planning
STATUS: READY_FOR_PM
