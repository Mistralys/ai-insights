# Synthesis Report — Plan 1: Dynamic Pipeline Engine

**Plan:** `2026-03-14-dynamic-pipeline-engine`
**Date:** 2026-03-14
**Status:** COMPLETE — All 8 Work Packages completed
**Synthesized by:** Head of Operations (Synthesis Agent)

---

## Executive Summary

Plan 1 successfully redesigned the AI Insights ledger workflow engine from a **fixed 4-stage pipeline** to a **dynamic 6-type composable pipeline** where the PM selects active stages per work package.

The plan delivered four coherent phases across 8 WPs:

| Phase | Scope | WPs | Outcome |
|---|---|---|---|
| **Phase 0** | Workflow Specification Update (spec-first) | WP-001, WP-002, WP-003 | Spec at v2.4.0 — 5 spec documents fully updated |
| **Phase 1** | TypeScript Implementation + Tests | WP-004, WP-005, WP-006 | 6 source files + 6 test files changed; 73 new tests |
| **Phase 2** | Cross-System Synchronization | WP-007 | 19 files across orchestrator, personas, GUI, scripts |
| **Phase 3** | Documentation Closure | WP-008 | 5 manifest/agent-doc files finalized |

**Net result:** A backward-compatible composable pipeline engine — existing 4-stage WPs work unchanged, and any WP can now elect a custom subset of the 6 canonical stages (`implementation`, `qa`, `security-audit`, `code-review`, `release-engineering`, `documentation`).

---

## Metrics Summary

### MCP Server (TypeScript)

| Metric | Value |
|---|---|
| Test suite (final) | **1,272 tests — 0 failures** |
| Tests added this plan | +73 (42 in WP-004, 31 in WP-006) |
| TypeScript build errors | 0 |
| Acceptance criteria met | 59 / 59 across all WPs |
| Rework cycles (WP-006) | 1 (code-review FAIL on help-content.ts — resolved in rework) |
| Rework cycles (WP-007) | 1 (QA FAIL — test_graph.py regression — resolved in rework) |
| Pipeline health (all WPs) | 8 / 8 WPs with all stages PASS |

### Orchestrator (Python)

| Metric | Value |
|---|---|
| Target tests passing | 26 / 26 |
| New test regressions | 0 (pre-existing async failures unrelated to this plan) |
| New stub nodes | 2 (`security_auditor`, `release_engineer`) |

### Personas Build

| Metric | Value |
|---|---|
| Total personas built | 18 (9 ledger × 2 IDE targets) |
| Build freshness check | All 18 up-to-date |
| KNOWN_ROLES / AGENT_ROLES parity | ✓ Verified by `check-known-roles.js` |

---

## What Was Built

### Composable Pipeline Type System (WP-004)
- `PIPELINE_TYPES` extended from 4 → **6 types** (`security-audit`, `release-engineering` added) in `pipeline-maps.ts`
- `CANONICAL_PIPELINE_ORDERING` and `DEFAULT_PIPELINE_STAGES` exported as constants
- Three new dynamic routing functions: **`resolveNextAgent()`**, **`resolveFailAgent()`**, **`resolvePrerequisite()`** — each accepts an optional `activeStages` parameter, defaulting to `DEFAULT_PIPELINE_STAGES` for backward compatibility
- `getDownstreamTypes()` / `getUpstreamTypes()` updated to respect active-stages filter
- `WorkPackageDetailSchema` and `ReworkCountsSchema` extended for the new stage fields
- Legacy static maps preserved as `Partial<Record<>>` for backward compatibility

### Dynamic Routing in Tool Handlers (WP-005)
- **`AGENT_ROLES`** expanded from 7 → **9 roles** (Security Auditor at position 5, Release Engineer at position 7)
- **`ledger_create_work_package`** accepts optional `active_pipeline_stages` with:
  - 4 hard guardrails (empty, invalid types, duplicates, out-of-canonical-order)
  - 2 soft warnings (implementation without qa, single-stage chains)
  - Default: `DEFAULT_PIPELINE_STAGES` when omitted
- **`startPipeline`** rejects pipeline types not in the WP's active stages
- **`completePipeline`** routes PASS/FAIL dynamically via the new resolve functions; auto-finalize fires for any terminal-stage agent (not just Documentation)
- All 6 agent action functions in `workflow-next-action.ts` updated to skip WPs with inactive stage types; `getSecurityAuditorAction` and `getReleaseEngineerAction` added

### Test Coverage (WP-006)
- 4 hard guardrail rejection cases + 2 soft warning cases in `work-package.test.ts`
- Dynamic routing and backward compatibility in `pipeline.test.ts`
- 5 integration compositions in `full-workflow.test.ts` (all-6, legacy-4, doc-only, verify-only, FAIL-routing)
- Security Auditor and Release Engineer active-stages filtering in `workflow-next-action.test.ts`
- 8 `resolveNextAgent` composition variants + 9 `resolveFailAgent` fallback scenarios in `pipeline-maps.test.ts`
- WP-006 included one rework cycle: Reviewer FAILed the first code-review pass, citing 4 blocking mismatches in help-content.ts (stale hardcoded 4-type descriptions). All 4 were resolved in rework.

### Cross-System Synchronization (WP-007)
- `scripts/sync-personas.js` KNOWN_ROLES: 7 → 9
- `orchestrator/src/config.py`: full 6-stage / 9-role update across `PIPELINE_PREREQUISITES`, `PIPELINE_AGENT_MAP`, `NEXT_STAGE_MAP`, `STAGE_TO_PIPELINE`, `PERSONA_FILES`, `PIPELINE_TYPES`
- `orchestrator/src/graph.py`: two new stub stage nodes (`_STAGE_SECURITY_AUDITOR`, `_STAGE_RELEASE_ENGINEER`) registered
- New stub node files: `orchestrator/src/nodes/security_auditor.py` and `release_engineer.py`
- **Personas renumbered**: Reviewer (5→6), Documentation (6→8), Synthesis (7→9); new stubs at positions 5 (Security Auditor) and 7 (Release Engineer)
- **18 personas rebuilt** across both IDE targets (`vs-code/`, `claude-code/`)
- GUI `PIPELINE_STAGES` extended to 6 with three-way inactive/not-started/present badge rendering
- `project-reset.ts` updated to expose `active_pipeline_stages` in diagnosis objects with dynamic stage count

---

## Blocker and Failure Summary

### WP-006 — Code-Review FAIL (Resolved)
**Issue:** 4 blocking bugs in `help-content.ts` — `ledger_begin_work`, `ledger_start_pipeline`, and `ledger_complete_pipeline` tool descriptions still referenced the legacy 4-stage pipeline and hardcoded ordering.
**Resolution:** All 4 fixed in rework (`ledger_begin_work` type listing, `ledger_start_pipeline` Prerequisites, Guards Preserved section, and Auto-Finalize section retitled to "Terminal Pipeline Stage").

### WP-007 — QA FAIL (Resolved)
**Issue:** `tests/test_graph.py::TestGraphNodes::test_graph_has_seven_nodes` regressed — expected 7 nodes, found 9.
**Resolution:** Test renamed to `test_graph_has_nine_nodes`, `expected_nodes` updated. Coverage also extended: `security_auditor` and `release_engineer` added to `test_nodes.py` parametrize lists.

---

## Strategic Recommendations (Gold Nuggets)

### 1. Zod `.describe()` Annotation Cleanup — Follow-up WP Needed (High-Value)
`StartPipelineSchema`, `CompletePipelineSchema`, `CancelPipelineSchema`, `UpdatePipelineProgressSchema` in `pipeline.ts`, and `BeginWorkSchema` in `begin-work.ts` still describe only 4 pipeline types in their `.describe()` annotations. These annotations are surfaced to AI clients via the MCP JSON Schema. Security Auditor and Release Engineer agents will see an incomplete type list. **Recommendation:** create a dedicated cleanup micro-WP to update all 5 `.describe()` calls.

### 2. `checkRevalidationGuard` activeStages Forwarding Gap (Medium Priority)
In `workflow-helpers.ts`, `checkRevalidationGuard` Step 5 calls `getUpstreamTypes(pipelineType)` without forwarding the `activeStages` parameter. This produces a conservative false-negative for non-default stage WPs (e.g., WPs with `security-audit` or `release-engineering` in upstream positions). **Fix:** `getUpstreamTypes(pipelineType)` → `getUpstreamTypes(pipelineType, activeStages ?? DEFAULT_PIPELINE_STAGES)`. Low-risk, one-line fix.

### 3. `resolveFailAgent` Edge Case — QA Self-Rework Mislead (Medium, Design)
For WPs where implementation is not active and QA is the first active stage (e.g., `['qa','code-review']`), `resolveFailAgent('qa', activeStages)` returns QA (first-active-stage owner). This triggers self-rework guidance for QA, contradicting the documented behavior that QA does not self-rework. The routing behavior is conservative (not incorrect), but the generated guidance text is semantically misleading. **Recommendation:** add a stage-awareness guard in `resolveFailAgent` or `buildCompletionGuidance` for this edge case.

### 4. `ledger_reset_rework_count` Hardcoded 4-Type Enum (Technical Debt)
`src/tools/work-package.ts` still exports a hardcoded 4-type enum for `ledger_reset_rework_count`. `api-surface.md` now carries a TODO annotation. **Recommendation:** create a focused WP to migrate this to `PipelineTypeEnum` — simple change with no behavioral risk.

### 5. CANONICAL_PIPELINE_ORDERING.filter() Duplication (Refactor Candidate)
The `CANONICAL_PIPELINE_ORDERING.filter()` pattern computing `orderedActive` / `upstreamActiveStages` is duplicated in `getReviewerAction`, `getReleaseEngineerAction`, and `getDocumentationAction`. A small shared helper (e.g., `getUpstreamStages(type, activeStages)`) would eliminate 9+ lines of identical logic. Low risk, good maintainability improvement.

### 6. Orchestrator supervisor.py Not Wired for New Roles (Known Simplification — Plan 2 Blocker)
`supervisor.py` does not poll Security Auditor or Release Engineer. The graph nodes are registered but the dispatch loop does not know about them. The orchestrator's `config.py PIPELINE_PREREQUISITES` also hardcodes all-6 stages as mandatory (ignoring per-WP `active_pipeline_stages`). Both are documented as known limitations in `orchestrator/README.md` and `supervisor-routing.md`. **Plan 2 must address these before the two new roles are usable end-to-end in the orchestrator.**

### 7. Security Auditor and Release Engineer Persona Content Are Stubs (Plan 2 Scope)
`personas/ledger/src/content/5-security-auditor.md` and `7-release-engineer.md` are minimal stubs. Full persona content (operational protocol, rework handling, tool boundaries) must be authored in Plan 2 once the concrete workflows are validated. The stubs build correctly but provide no operational guidance.

### 8. pytest-asyncio Not Installed — 128 Orchestrator Tests Blocked
`test_supervisor.py` and `test_tool_wrappers.py` consistently skip/error due to missing `pytest-asyncio`. These are pre-existing infrastructure failures. **Recommendation:** add `pytest-asyncio` to `pyproject.toml` `[project.optional-dependencies]` dev group to unlock 128 tests.

### 9. Test Pattern Gold Nugget: Describe-Block + Single-Assertion for Utility Functions
The `pipeline-maps.test.ts` file — with its visual section-header comments, 8 `resolveNextAgent` composition variants, and 9 `resolveFailAgent` fallback scenarios in tight single-assertion `it()` blocks — is an excellent template. The code-review agent flagged this explicitly as a pattern to replicate for all future pipeline-utility tests.

### 10. GUI Inactive-Stage Rendering Pattern — Extensible
The GUI's three-way signal (present/missing/inactive) via `buildWpRow` using a `presentSet` and `activeSet` over `PIPELINE_STAGES` is clean and extensible. **Recommendation:** use the same pattern for any future status dashboards added to the GUI.

---

## Outstanding Technical Debt (Carry-Forward)

| Priority | Location | Description |
|---|---|---|
| Medium | `mcp-server/src/tools/pipeline.ts`, `begin-work.ts` | Zod `.describe()` annotations list only 4 types — 5 calls need updating |
| Medium | `mcp-server/src/utils/workflow-helpers.ts` | `checkRevalidationGuard` Step 5 not forwarding `activeStages` to `getUpstreamTypes` |
| Medium | `mcp-server/src/tools/work-package.ts` | `ledger_reset_rework_count` `pipeline_type` hardcoded as 4-type enum |
| Medium | `orchestrator/src/config.py` | `PIPELINE_PREREQUISITES` hardcodes all-6 mandatory chain, ignores per-WP `active_pipeline_stages` |
| Medium | `orchestrator/src/supervisor.py` | Security Auditor and Release Engineer not wired into dispatch loop |
| Low | `mcp-server/src/tools/workflow-next-action.ts` | `CANONICAL_PIPELINE_ORDERING.filter()` duplicated 3× — refactor candidate |
| Low | `orchestrator/src/graph.py` | `test_graph.py` contains two spot-check tests (`test_supervisor_node_present`, `test_synthesis_node_present`) subsumed by `test_graph_has_nine_nodes` — safe to remove |
| Low | `mcp-server/tests/tools/pipeline.test.ts` | Dead-code double-write in 'rejects pipeline type not active' test |
| Low | `mcp-server/tests/utils/pipeline-maps.test.ts` | `resolveFailAgent` test uses out-of-canonical-order `['qa','implementation']` — replace with `['implementation','qa']` |

---

## Files Modified This Plan

<details>
<summary>Expand full file list (41 files)</summary>

**Workflow Specification (5 files)**
- `mcp-server/docs/agents/workflow-specification/data-model.md`
- `mcp-server/docs/agents/workflow-specification/pipeline-routing.md`
- `mcp-server/docs/agents/workflow-specification/README.md`
- `mcp-server/docs/agents/workflow-specification/state-machines.md`
- `mcp-server/docs/agents/workflow-specification/operations.md`

**MCP Server Source (10 files)**
- `mcp-server/src/utils/constants.ts`
- `mcp-server/src/utils/pipeline-maps.ts`
- `mcp-server/src/schema/work-package.ts`
- `mcp-server/src/utils/project-reset.ts`
- `mcp-server/src/tools/project-lifecycle.ts`
- `mcp-server/src/tools/work-package.ts`
- `mcp-server/src/tools/pipeline.ts`
- `mcp-server/src/utils/workflow-helpers.ts`
- `mcp-server/src/tools/workflow-next-action.ts`
- `mcp-server/src/tools/help-content.ts`

**MCP Server Tests (5 files)**
- `mcp-server/tests/utils/pipeline-maps.test.ts`
- `mcp-server/tests/tools/work-package.test.ts`
- `mcp-server/tests/tools/pipeline.test.ts`
- `mcp-server/tests/integration/full-workflow.test.ts`
- `mcp-server/tests/tools/workflow-next-action.test.ts`

**MCP Server GUI (3 files)**
- `mcp-server/gui/public/views/project-detail.js`
- `mcp-server/gui/public/styles.css`

**Orchestrator (7 files)**
- `orchestrator/src/config.py`
- `orchestrator/src/graph.py`
- `orchestrator/src/nodes/security_auditor.py` *(new)*
- `orchestrator/src/nodes/release_engineer.py` *(new)*
- `orchestrator/tests/test_graph.py`
- `orchestrator/tests/test_nodes.py`

**Personas (11 files)**
- `personas/ledger/src/meta/_shared.yaml`
- `personas/ledger/src/meta/5-security-auditor.yaml` *(new)*
- `personas/ledger/src/meta/6-reviewer.yaml` *(renamed from 5)*
- `personas/ledger/src/meta/7-release-engineer.yaml` *(new)*
- `personas/ledger/src/meta/8-documentation.yaml` *(renamed from 6)*
- `personas/ledger/src/meta/9-synthesis.yaml` *(renamed from 7)*
- `personas/ledger/src/content/5-security-auditor.md` *(new stub)*
- `personas/ledger/src/content/6-reviewer.md` *(renamed)*
- `personas/ledger/src/content/7-release-engineer.md` *(new stub)*
- `personas/ledger/src/content/8-documentation.md` *(renamed)*
- `personas/ledger/src/content/9-synthesis.md` *(renamed)*

**Scripts / Root Docs (6 files)**
- `scripts/sync-personas.js`
- `AGENTS.md`
- `README.md`
- `mcp-server/AGENTS.md`
- `mcp-server/docs/agents/project-manifest/api-surface.md`
- `mcp-server/docs/agents/project-manifest/constraints.md`
- `mcp-server/docs/agents/project-manifest/data-flows.md`
- `mcp-server/docs/agents/project-manifest/README.md`
- `orchestrator/README.md`
- `orchestrator/docs/architecture.md`
- `orchestrator/docs/supervisor-routing.md`
- `personas/docs/agents/project-manifest/file-tree.md`
- `personas/docs/agents/project-manifest/api-surface.md`
- `personas/docs/agents/project-manifest/constraints.md`

</details>

---

## Next Steps for Planning Agent (Plan 2)

1. **Author Security Auditor and Release Engineer full persona content** (`5-security-auditor.md`, `7-release-engineer.md`) — the stubs are in place; content needs operational protocol, rework handling, and tool boundary sections.
2. **Wire supervisor.py** for Security Auditor and Release Engineer dispatch — add to `_ROLES`, `_ROLE_STAGE_MAP`, `_DISPATCH_ACTIONS`, `_DEST_*` constants (documented with exact steps in `supervisor-routing.md`).
3. **Address the 5 Zod `.describe()` annotation gaps** (micro-WP or bundled with Plan 2 foundational work).
4. **Fix `checkRevalidationGuard` activeStages forwarding gap** (one-line fix, can be bundled).
5. **Install `pytest-asyncio`** in `pyproject.toml` to unlock 128 blocked orchestrator async tests.
6. **Migrate `ledger_reset_rework_count` `pipeline_type`** enum from hardcoded 4-type to `PipelineTypeEnum`.
