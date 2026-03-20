# Project Synthesis — Shared Role Manifest Rework (Phase 1)

**Plan:** `2026-03-18-shared-role-manifest-rework-1`
**Date:** 2026-03-19
**Status:** COMPLETE — All 7 WPs passed, all 28 pipelines PASS

---

## Executive Summary

This session completed all seven actionable items from the prior synthesis review of the manifest-derivation architecture. The project's goal was to close every remaining hardcoded island across the MCP server and orchestrator, extend test coverage for the two newer agent roles (Security Auditor, Release Engineer), and elevate `shared/workflow-manifest.json` to be the unambiguous single source of truth for terminal status semantics.

All seven work packages were delivered cleanly. The three sub-projects now have no hardcoded role strings, pipeline types, or terminal status sets in their runtime constant definitions. Every constant is manifest-derived at module load, with Zod validation (MCP server) or direct manifest reads (orchestrator/Python) providing startup-time failure for any schema divergence.

**Key deliverables:**

| WP | Change | Scope |
|----|--------|-------|
| WP-001 | `resolveFailAgent()` baseAgentMap fully manifest-derived | MCP server |
| WP-002 | Orchestrator routing tests extended to 6-stage canonical pipeline order | Orchestrator |
| WP-003 | Dead `VALID_STAGES` import removed; all `supervisor.py` module-level constants made manifest-derived | Orchestrator |
| WP-004 | Explanatory comment added above `_chain_roles` protecting the non-obvious Synthesis inclusion | Orchestrator |
| WP-005 | `hasDependencyBlocked` / `isBlockedByDependencies` duplicate eliminated; `@deprecated` alias established | MCP server |
| WP-006 | New `workflow-manifest-schema.ts` centralizes Zod parsing; `AgentRole` type now derived via `z.infer` | MCP server |
| WP-007 | `terminal_work_package` field added to manifest + schema + validation; `WP_TERMINAL_STATUSES` manifest-authoritative | Cross-project |

---

## Metrics

| Metric | Value |
|--------|-------|
| Work packages completed | 7 / 7 |
| Pipelines executed | 28 (implementation × 7, qa × 7, code-review × 7, documentation × 7) |
| Pipelines passed | 28 / 28 |
| Pipelines failed | 0 |
| MCP server tests (npm test) | **1,472 / 1,472** across 45 test files |
| Orchestrator tests (pytest) | **221 passed, 1 skipped, 0 failed** |
| Combined test count (WP-007 gate) | **1,694** |
| TypeScript build errors | 0 |
| New ruff warnings introduced | 0 |
| Pre-existing ruff warnings (orchestrator) | 63 (unchanged, all pre-existing) |

---

## Work Package Highlights

### WP-001 — `resolveFailAgent()` manifest derivation
The last hardcoded island in `pipeline-maps.ts` was replaced with `Object.fromEntries` over `workflowManifest.pipelines.fail_routing` using the existing `_roleById` lookup. The implementation was already correctly in place at session start; the Developer confirmed and a new `resolveFailAgent() parity — manifest fail_routing` describe block (4 tests) was added to `workflow-manifest.test.ts`. Two `'Developer'` strings survive as defensive fallbacks for degenerate states (unresolvable roleId, empty activeStages) — both correctly excluded from the normal routing path.

### WP-002 — Orchestrator 6-stage routing tests
`_derive_next_action` test helper chains `impl → qa → sa → cr → re → doc` correctly. `TestDirectActionRouting` parametrized cases for `('Security Auditor', 'RUN_SECURITY_AUDIT', 'security_auditor')` and `('Release Engineer', 'RUN_RELEASE_ENGINEERING', 'release_engineer')` added and passing. **One medium-priority latent issue found:** `elif re == 'FAIL'` in the helper routes to `Developer/REWORK` but the manifest's `fail_routing` specifies `Release Engineer` as the fail target for `release-engineering`. No test currently exercises this path (see Open Items).

### WP-003 — Dead import removal + supervisor.py manifest-derivation
`VALID_STAGES` removed from `supervisor.py` import. Implementation scope exceeded the WP description: the Developer also made all `supervisor.py` module-level constants manifest-derived (`_DEST_*` via `ROLE_IDS` dict lookups, `_ROLE_STAGE_MAP` and `_ROLES` via `PIPELINE_ROLE_NAMES`, `_TERMINAL_STATUSES` via `WP_TERMINAL_STATUSES`). This exceeded scope but was architecturally consistent and all 221 tests passed cleanly.

### WP-004 — `_chain_roles` comment guard
Pure comment addition at `config.py` lines 80–84 explaining that Synthesis is intentionally kept in `_chain_roles` despite being annotated as orchestrating, because `NEXT_STAGE_MAP` requires the `docs → synthesis` terminal link. The comment includes an explicit anti-pattern warning preventing a future "fix" from breaking the handoff chain. No functional change.

### WP-005 — Duplicate predicate consolidation
`isBlockedByDependencies` is the canonical single implementation; `hasDependencyBlocked` is now a `const` alias with `@deprecated` JSDoc. Three call-site files were confirmed correct (`workflow-next-action.ts` at 5 sites, `workflow-next-action-batch.ts` at 1 site, `workflow-handoff.ts`). The WP's artifact list omitted `workflow-next-action.ts` but this had no correctness impact.

### WP-006 — Zod manifest schema centralization
New `mcp-server/src/schema/workflow-manifest-schema.ts` provides `AgentRoleEnum`, `ManifestSchema`, and the `workflowManifest` singleton. `AgentRole` type is now `z.infer<typeof AgentRoleEnum>` — zero manual union maintenance. `ManifestSchema.parse()` throws `ZodError` on invalid manifest at module load (fail-fast). `constants.ts`, `enums.ts`, and `pipeline-maps.ts` all migrated from per-file `createRequire` to the singleton. 4 startup-validation tests added.

**Note on `AgentRoleEnum`:** This is the one construct that cannot be automatically derived — the 9 string literals must match the manifest. The `ManifestSchema.roles.length(9)` + `name: AgentRoleEnum` guards ensure any divergence causes a startup-time `ZodError`. When adding a new agent role, both `workflow-manifest.json` AND `AgentRoleEnum` + `.length(9)` must be updated atomically.

### WP-007 — `terminal_work_package` manifest field
`terminal_work_package: ["COMPLETE", "CANCELLED"]` added to `shared/workflow-manifest.json`. JSON Schema updated (property definition + `required` entry). `scripts/validate-workflow-manifest.js` extended with a subset check (`terminal_work_package ⊆ work_package`). `StatusesSchema` in `workflow-manifest-schema.ts` updated. `orchestrator/src/config.py`'s `WP_TERMINAL_STATUSES` now reads `_MANIFEST["statuses"]["terminal_work_package"]` — hardcoded set removed. Full gate: 1,694 tests pass across all three sub-projects.

---

## Open Items & Follow-on Debt

These items were identified but are outside the scope of this project. They are prioritized for the next planning cycle.

### Medium Priority

| ID | Description | Location | Found In |
|----|-------------|----------|----------|
| DEBT-1 | `_derive_next_action` helper: `elif re == 'FAIL'` routes to `Developer/REWORK` but manifest specifies `Release Engineer` as `release-engineering` fail target. Latent misleading assertion risk for future test authors. Fix: change to `"Release Engineer", "REWORK"`. | `orchestrator/tests/test_supervisor.py` ~line 119 | WP-002 Reviewer |

### Low Priority

| ID | Description | Location | Found In |
|----|-------------|----------|----------|
| DEBT-2 | `workflow-helpers.ts` still uses `createRequire` + raw cast for manifest import (lines 11, 20), bypassing the Zod-validated singleton from WP-006. Should import `{ workflowManifest }` from `../schema/workflow-manifest-schema.js`. | `mcp-server/src/utils/workflow-helpers.ts` | WP-006 Developer, QA, Reviewer |
| DEBT-3 | `ManifestSchema.roles.length(9)` is hardcoded. If a 10th role is added, startup throws. Change to `.nonempty()` — the JSON Schema and `validate-workflow-manifest.js` already enforce role semantics independently. | `mcp-server/src/schema/workflow-manifest-schema.ts` | WP-007 Reviewer |
| DEBT-4 | No dedicated test for `WP_TERMINAL_STATUSES` type/value against manifest in orchestrator test suite. A test in `tests/test_config.py` would prevent silent regressions if the field is renamed or restructured. | `orchestrator/tests/test_config.py` | WP-007 QA + Reviewer |
| DEBT-5 | `TestDirectActionRouting` is missing a `REWORK` case for Release Engineer (analogous to the existing Developer REWORK case). | `orchestrator/tests/test_supervisor.py` | WP-002 Reviewer |
| DEBT-6 | `baseAgentMap` in `resolveFailAgent()` is reconstructed on every call. Could be a module-level constant (matching the `FAIL_ROUTING_MAP` precedent) for micro-optimization. Non-blocking. | `mcp-server/src/utils/pipeline-maps.ts` | WP-001 QA + Reviewer |
| DEBT-7 | 63 pre-existing `ruff` warnings in `orchestrator/src/` (UP017, UP037, I001, E501). Zero introduced by this project. A dedicated cleanup WP would reduce lint noise. | `orchestrator/src/` | WP-003 QA |
| DEBT-8 | WP attribution comment `─── resolveFailAgent() parity — WP-001` in `workflow-manifest.test.ts` will become stale. Consider a neutral section header. | `mcp-server/tests/utils/workflow-manifest.test.ts` line 341 | WP-001 Reviewer |

---

## Strategic Recommendations

1. **Fix DEBT-1 next.** The `_derive_next_action` helper's `re == 'FAIL'` branch routes to the wrong agent. Although no test currently exercises it, the helper's own docstring warns about exactly this class of drift. It's a one-line fix that prevents a misleading test scenario for any future author adding `release-engineering` FAIL scenarios.

2. **Complete the Zod migration (DEBT-2).** `workflow-helpers.ts` is the last file using `createRequire` + raw cast. Migrating it will complete the manifest-singleton adoption across the entire MCP server codebase, giving it the same Zod-narrowed types as all other consumers. This is a straightforward two-line import change.

3. **Add a `test_config.py` snapshot test for `WP_TERMINAL_STATUSES` (DEBT-4).** This is a cheap regression guard that protects against the manifest field being renamed or the derivation path being refactored silently. Given that the orchestrator derives 8 constants from the manifest at import time, a baseline config snapshot test file would provide holistic coverage.

4. **Relax `ManifestSchema.roles.length(9)` (DEBT-3).** As the workflow matures, new roles may be added. Changing the constraint to `.nonempty()` (or a `min(1)` bound) before the manifest grows prevents a startup-time surprise. The JSON Schema and `validate-workflow-manifest.js` already provide the authoritative role-count semantics.

5. **Ruff cleanup sprint (DEBT-7).** The 63 pre-existing warnings are safe to clear in a dedicated session. They are all auto-fixable patterns (datetime alias, quote removal, import sorting, line length). Running `ruff check --fix orchestrator/src/` would clear the majority without any logic changes.

---

## Files Modified This Session

| File | WPs |
|------|-----|
| `mcp-server/src/utils/pipeline-maps.ts` | WP-001 |
| `mcp-server/tests/utils/workflow-manifest.test.ts` | WP-001 |
| `mcp-server/docs/agents/project-manifest/api-surface.md` | WP-001, WP-005, WP-006 |
| `orchestrator/tests/test_supervisor.py` | WP-002 |
| `orchestrator/README.md` | WP-002 (docs) |
| `orchestrator/src/supervisor.py` | WP-003 |
| `orchestrator/src/config.py` | WP-003, WP-004, WP-007 |
| `mcp-server/src/utils/workflow-helpers.ts` | WP-005 |
| `mcp-server/src/schema/workflow-manifest-schema.ts` | WP-006 (new), WP-007 |
| `mcp-server/src/utils/constants.ts` | WP-006 |
| `mcp-server/src/schema/enums.ts` | WP-006 |
| `mcp-server/docs/agents/project-manifest/file-tree.md` | WP-006 (docs) |
| `shared/workflow-manifest.json` | WP-007 |
| `shared/workflow-manifest.schema.json` | WP-007 |
| `scripts/validate-workflow-manifest.js` | WP-007 |
