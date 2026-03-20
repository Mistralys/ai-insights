# Project Synthesis Report

**Project:** `2026-03-18-shared-role-manifest-rework-2`  
**Date:** 2026-03-19  
**Status:** COMPLETE  
**Work Packages:** 8 / 8 COMPLETE  

---

## Executive Summary

This session closed all eight technical debt items identified in the prior session's synthesis (`2026-03-18-shared-role-manifest-rework-1`). The work completed the `shared/workflow-manifest.json` adoption story across all three sub-projects — fixing a stale FAIL-routing branch in the orchestrator's test helper, migrating the last MCP server util from raw `createRequire` to the Zod singleton, relaxing an over-constraining schema guard, establishing a ruff zero-warning baseline, and adding test coverage for manifest-derived config constants.

No new architectural patterns were introduced. All eight WPs were small, isolated, atomic fixes delivered cleanly across the full pipeline (implementation → QA → code-review → documentation).

---

## Metrics

| Metric | MCP Server | Orchestrator |
|--------|-----------|-------------|
| Tests passed | **1,472** | **251** (+ 1 skipped) |
| Tests failed | 0 | 0 |
| Test files touched | 2 | 2 (+1 created) |
| Ruff warnings resolved | — | **68** (zero remaining) |
| TypeScript build errors | 0 | — |

### Pipeline Health

All 32 pipelines (8 WPs × 4 stages) returned **PASS**. No rework cycles were required.

---

## What Was Built

### WP-001 — Fix `_derive_next_action` FAIL routing for `release-engineering`

**File:** `orchestrator/tests/test_supervisor.py`

The `_derive_next_action` test helper's `elif re == 'FAIL'` branch incorrectly routed to `("Developer", "REWORK")` for all pipeline types. This contradicted `shared/workflow-manifest.json → fail_routing['release-engineering'] = 'release_engineer'`. Changed to `("Release Engineer", "REWORK")`. Docstring updated to explicitly warn that FAIL-routing branch targets must stay in sync with the manifest's `fail_routing` field — the documentation gap that allowed the bug to exist.

### WP-002 — Relax `ManifestSchema.roles` from `.length(9)` to `.nonempty()`

**File:** `mcp-server/src/schema/workflow-manifest-schema.ts`

Replaced `z.array(RoleSchema).length(9)` with `.nonempty()`. This is the only array in `ManifestSchema` that used an exact-count constraint; all five status arrays and `canonical_order` already used `.nonempty()`. The hardcoded `9` would have blocked any future role addition at schema-validation time. Element-level type safety is fully preserved via `AgentRoleEnum`; count enforcement remains at the JSON Schema layer.

### WP-003 — Create `orchestrator/tests/test_config.py`

**File:** `orchestrator/tests/test_config.py` *(new)*

29 tests across 5 classes covering `WP_TERMINAL_STATUSES`, `VALID_STAGES`, `PIPELINE_TYPES`, `ROLE_IDS`, and `PIPELINE_ROLE_NAMES`. Tests use structural assertions (type, membership, key presence) rather than exact-value locks — deliberately tolerant of future manifest additions. Key guards: orchestrating roles (`Planner`, `Synthesis`) correctly excluded from `VALID_STAGES` and `PIPELINE_ROLE_NAMES`; `release_engineer` ID normalization directly tested.

### WP-004 — Hoist `baseAgentMap` to module-level `FAIL_AGENT_MAP`

**File:** `mcp-server/src/utils/pipeline-maps.ts`

Per-call `baseAgentMap` reconstruction inside `resolveFailAgent()` replaced by an exported module-level `FAIL_AGENT_MAP` constant (line 158), following the existing `FAIL_ROUTING_MAP` / `PIPELINE_AGENT_MAP` precedent. `resolveFailAgent()` simplified to reference it directly. The export provides a useful separation: callers that only need base fail-routing can use `FAIL_AGENT_MAP` without triggering the active-stage fallback logic.

### WP-005 — Remove WP-ID coupling from `workflow-manifest.test.ts`

**File:** `mcp-server/tests/utils/workflow-manifest.test.ts`

Three WP-ID references removed (file header JSDoc, `ManifestSchema` section header, `resolveFailAgent()` parity section header). Test file comments should not carry work-package coupling that becomes stale after project completion. Comment-only change; zero behavioral impact.

### WP-006 — Ruff zero-warning baseline for `orchestrator/src/`

**Files:** `orchestrator/src/cli.py`, `orchestrator/src/nodes/__init__.py`, `orchestrator/src/nodes/pm.py`, `orchestrator/src/nodes/synthesis.py`

Resolved 68 pre-existing warnings: 66 auto-fixed (`UP017`, `UP037`, `I001`, `E501`) plus 2 surfaced post-fix — `F841` (unused variable `wps_failed` in `cli.py`) and `F401` (unused `timezone` import in `nodes/__init__.py`). `ruff check orchestrator/src/` now exits 0. Ruff section added to `orchestrator/README.md`.

### WP-007 — Add `TestDirectActionRouting` parametrized case for Release Engineer REWORK

**File:** `orchestrator/tests/test_supervisor.py`

Added `('Release Engineer', 'REWORK', 'release_engineer')` parametrized test entry, placed after the existing `RUN_RELEASE_ENGINEERING` entry. Total `TestDirectActionRouting` cases: 21. Routing correctness confirmed: `_DISPATCH_ACTIONS` contains `REWORK`; `_ROLE_STAGE_MAP` maps `Release Engineer → release_engineer` via `ROLE_IDS`; manifest `fail_routing['release-engineering'] = 'release_engineer'`.

### WP-008 — Migrate `workflow-helpers.ts` to the Zod singleton

**File:** `mcp-server/src/utils/workflow-helpers.ts`

Removed `createRequire` import, `_require`, and `_manifest` local variables. Added `import { workflowManifest }` from the Zod singleton. Replaced all four `_manifest.constants.*` references (`stale_pipeline_hours`, `max_rework_count`, `max_handoff_depth`, `handoff_depth_multiplier`) with `workflowManifest.constants.*`. This was the **last** file in the MCP server codebase using raw `createRequire` for manifest access.

---

## Strategic Recommendations

### Gold Nuggets

**1. All three MCP server manifest consumers now use the Zod singleton uniformly** *(WP-008, Reviewer)*  
`workflow-helpers.ts`, `pipeline-maps.ts`, and `constants.ts` all import `workflowManifest` from `src/schema/workflow-manifest-schema.ts`. Zod parsing at module-load time provides compile-time type safety and startup-time manifest validation. The `createRequire` pattern (which returns untyped `any` and defers validation) is fully eliminated.

**2. `_derive_next_action` drift risk is documented but not eliminated** *(WP-001, Reviewer)*  
The test helper's FAIL-routing table is now correct and has an explicit docstring warning. However, it still hard-codes all 6 routing branches. Deriving this table from `workflow-manifest.json` at test time (e.g., via a fixtures module) would fully eliminate future drift risk. The docstring is an adequate interim guard.

**3. `_DISPATCH_ACTIONS` comment is misleading for REWORK** *(WP-007, Reviewer)*  
The `# Developer` comment in `supervisor.py`'s `_DISPATCH_ACTIONS` frozenset groups `REWORK` with Developer-only actions. Since `REWORK` is now confirmed to dispatch Release Engineer as well, adding a clarifying inline comment (e.g., `# also used by Release Engineer`) would prevent a future developer from incorrectly scoping this action. Low-priority, cosmetic-only.

---

## Open Items

None. All DEBT items from the prior session's synthesis are resolved. The MCP server and orchestrator are in a clean, manifest-aligned state. No new debt items were introduced.

---

## Next Steps for the Planner

1. **Consider deriving `_derive_next_action` routing from the manifest** — elevate the Reviewer's observation to a future WP if manifest additions are anticipated in the near term.
2. **Clarify `_DISPATCH_ACTIONS` comment** — one-line cosmetic fix to `supervisor.py`; low priority but worth a future housekeeping pass.
3. **Consider CI enforcement** — the ruff zero-warning baseline and 1,472 MCP server / 251 orchestrator test baselines are now well-established for CI gate configuration.
