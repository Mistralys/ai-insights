# Plan

## Summary

Close all remaining technical debt items identified in the **2026-03-18-shared-role-manifest-rework-1** synthesis. Five strategic recommendations were made; this plan addresses all five plus the three remaining low-priority items (DEBT-5, DEBT-6, DEBT-8) from the Open Items table, for a total of eight atomic work packages.

## Architectural Context

The prior session elevated `shared/workflow-manifest.json` to the single source of truth for agent roles, pipeline types, terminal statuses, and fail routing. All three sub-projects (MCP server, orchestrator, personas) now derive their runtime constants from the manifest at load time — the MCP server via a Zod-validated singleton in `mcp-server/src/schema/workflow-manifest-schema.ts`, and the orchestrator via direct JSON reads in `orchestrator/src/config.py`.

Key modules involved in this follow-up:

| File | Role |
|------|------|
| `orchestrator/tests/test_supervisor.py` | Test helper `_derive_next_action()` + `TestDirectActionRouting` parametrized cases |
| `mcp-server/src/utils/workflow-helpers.ts` | Workflow constants (stale hours, rework limit, handoff depth) — last file using raw `createRequire` |
| `mcp-server/src/schema/workflow-manifest-schema.ts` | Zod manifest schema + `workflowManifest` singleton |
| `orchestrator/src/config.py` | Manifest-derived constants including `WP_TERMINAL_STATUSES` |
| `orchestrator/tests/test_config.py` | Does not exist yet — to be created |
| `mcp-server/src/utils/pipeline-maps.ts` | `resolveFailAgent()` with per-call `baseAgentMap` reconstruction |
| `mcp-server/tests/utils/workflow-manifest.test.ts` | Manifest structural tests with WP attribution comment at line 341 |
| `orchestrator/src/` | 63 pre-existing ruff warnings (UP017, UP037, I001, E501) |

## Approach / Architecture

Each DEBT item is a small, isolated fix. They are grouped into eight work packages ordered by priority (medium items first, then low) and by dependency (DEBT-2 depends on DEBT-3 being addressed first so the singleton remains valid after the constraint relaxation).

No new modules or architectural patterns are introduced. All changes build on the manifest-derivation architecture established in the prior session.

## Rationale

- **DEBT-1 first:** Only medium-priority item; prevents misleading test failures for future `release-engineering` FAIL scenarios.
- **DEBT-3 before DEBT-2:** Relaxing the `length(9)` guard before migrating `workflow-helpers.ts` ensures the singleton is future-proof for the last consumer migration.
- **DEBT-4 after DEBT-3:** The new `test_config.py` should validate the manifest constants after the Zod schema constraint change.
- **DEBT-7 last:** Pure lint cleanup, no logic changes, benefits from a clean baseline.

## Detailed Steps

### WP-001 — Fix `_derive_next_action` FAIL routing for `release-engineering` (DEBT-1)

**Priority: Medium**

In `orchestrator/tests/test_supervisor.py`, the `_derive_next_action` helper function has a `elif re == 'FAIL'` branch at approximately line 119 that routes to `("Developer", "REWORK")`. According to `shared/workflow-manifest.json` → `pipelines.fail_routing`, the `release-engineering` pipeline's fail target is `release_engineer` (Release Engineer), not `developer`.

**Change:** Replace line ~119:
```python
# Before
elif re == "FAIL":
    next_role, action = "Developer", "REWORK"
# After
elif re == "FAIL":
    next_role, action = "Release Engineer", "REWORK"
```

**Verification:** Run `pytest orchestrator/tests/test_supervisor.py -v` — all existing tests must continue to pass. No test currently exercises this branch, so no assertion changes are expected.

### WP-002 — Add Release Engineer REWORK case to `TestDirectActionRouting` (DEBT-5)

**Priority: Low**

`TestDirectActionRouting` in `orchestrator/tests/test_supervisor.py` (lines ~792–830) has parametrized cases for all action/stage routing. Developer has a `("Developer", "REWORK", "developer")` entry, but Release Engineer is missing its analogous REWORK case. Documentation also lacks a REWORK case but its `fail_routing` maps to `docs` (Documentation), not Release Engineer — that's a separate concern.

**Change:** Add one parametrized entry to the `@pytest.mark.parametrize` decorator:
```python
("Release Engineer", "REWORK", "release_engineer"),
```

Place it after the existing `("Release Engineer", "RUN_RELEASE_ENGINEERING", "release_engineer")` line.

**Verification:** Run `pytest orchestrator/tests/test_supervisor.py::TestDirectActionRouting -v` — new case must pass.

### WP-003 — Relax `ManifestSchema.roles.length(9)` to `.nonempty()` (DEBT-3)

**Priority: Low**

In `mcp-server/src/schema/workflow-manifest-schema.ts` at line 76, `ManifestSchema` enforces exactly 9 roles via `.length(9)`. This creates a startup-time failure if a 10th role is ever added to the manifest. The JSON Schema (`shared/workflow-manifest.schema.json`) and `scripts/validate-workflow-manifest.js` already enforce role semantics independently.

**Change:** Replace `.length(9)` with `.nonempty()` on the `roles` field in `ManifestSchema`:
```typescript
// Before
roles: z.array(RoleSchema).length(9),
// After
roles: z.array(RoleSchema).nonempty(),
```

**Verification:** Run `npm test` in `mcp-server/` — all 1,472+ tests must pass. The startup-validation tests in `workflow-manifest.test.ts` that test `ManifestSchema.parse()` must still succeed.

### WP-004 — Complete Zod migration in `workflow-helpers.ts` (DEBT-2)

**Priority: Low**

`mcp-server/src/utils/workflow-helpers.ts` is the last file using `createRequire` + raw `as` type cast for manifest import (lines 11, 20–22). All other MCP server consumers have migrated to the Zod-validated `workflowManifest` singleton from `workflow-manifest-schema.ts`.

**Change:**
1. Remove `import { createRequire } from 'module';` (line 11).
2. Remove `const _require = createRequire(import.meta.url);` and the `_manifest` assignment (lines 20–22).
3. Add `import { workflowManifest } from '../schema/workflow-manifest-schema.js';` alongside the existing imports.
4. Replace all `_manifest.` references with `workflowManifest.` (4 usages: `stale_pipeline_hours`, `max_rework_count`, `max_handoff_depth`, `handoff_depth_multiplier`).

**Verification:** Run `npm test` in `mcp-server/` — all tests must pass. Run `npx tsc --noEmit` — no type errors.

### WP-005 — Add `test_config.py` snapshot test for manifest-derived constants (DEBT-4)

**Priority: Low**

`orchestrator/tests/test_config.py` does not exist. The orchestrator derives 8 constants from the manifest at import time in `config.py` (`VALID_STAGES`, `PIPELINE_TYPES`, `ROLE_IDS`, `PIPELINE_ROLE_NAMES`, `WP_TERMINAL_STATUSES`, etc.). A baseline test file would catch silent regressions if the manifest field names change or the derivation logic is accidentally broken.

**Change:** Create `orchestrator/tests/test_config.py` with:
1. A test that `WP_TERMINAL_STATUSES` is a non-empty `frozenset` containing `"COMPLETE"` and `"CANCELLED"` (matching `shared/workflow-manifest.json` → `statuses.terminal_work_package`).
2. A test that `VALID_STAGES` is a non-empty `frozenset` with expected members (e.g., `"developer"`, `"qa"`, `"reviewer"`).
3. A test that `PIPELINE_TYPES` is a non-empty tuple matching the manifest's `pipelines.canonical_order`.
4. A test that `ROLE_IDS` has entries for all non-orchestrating roles.
5. A test that `PIPELINE_ROLE_NAMES` is a non-empty list with expected length.

**Verification:** Run `pytest orchestrator/tests/test_config.py -v` — all tests pass.

### WP-006 — Hoist `baseAgentMap` to module-level constant (DEBT-6)

**Priority: Low**

In `mcp-server/src/utils/pipeline-maps.ts`, `resolveFailAgent()` (lines ~258–285) reconstructs `baseAgentMap` from `workflowManifest.pipelines.fail_routing` on every call. Since the manifest is immutable after module load, this can be computed once as a module-level constant, matching the existing `FAIL_ROUTING_MAP` and `PIPELINE_AGENT_MAP` precedent.

**Change:**
1. Hoist the `Object.fromEntries(...)` construction to a module-level `const FAIL_AGENT_MAP` near the other module-level pipeline maps.
2. Simplify `resolveFailAgent()` to reference the module-level constant instead of recomputing it.

**Verification:** Run `npm test` in `mcp-server/` — all tests pass. The `resolveFailAgent() parity` test block in `workflow-manifest.test.ts` must still pass.

### WP-007 — Neutralize WP attribution comment (DEBT-8)

**Priority: Low**

Line 341 of `mcp-server/tests/utils/workflow-manifest.test.ts` contains `// ─── resolveFailAgent() parity — WP-001 ───`. WP IDs are ephemeral project-scoped identifiers that become stale after the session ends. Replace with a neutral section header.

**Change:** Replace the comment at line 341:
```typescript
// Before
// ─── resolveFailAgent() parity — WP-001 ──────────────────────────────────────
// After
// ─── resolveFailAgent() parity ────────────────────────────────────────────────
```

Also update the file header comment at line 9 to remove the WP-006 reference if present:
```typescript
// Before
 * WP-006: Manifest Validation Test (2026-03-18-shared-role-manifest)
// After
 * Manifest validation tests for shared/workflow-manifest.json.
```

**Verification:** Run `npm test` in `mcp-server/` — all tests pass (comment-only change).

### WP-008 — Ruff cleanup sprint (DEBT-7)

**Priority: Low**

63 pre-existing ruff warnings in `orchestrator/src/` across categories UP017 (unnecessary `datetime` alias), UP037 (unnecessary quote removal), I001 (import sorting), and E501 (line length). All are auto-fixable and introduce no logic changes.

**Change:**
1. Run `ruff check --fix orchestrator/src/` to auto-fix I001, UP017, UP037.
2. Manually address remaining E501 (line length) warnings if they cannot be auto-fixed, by wrapping long lines.
3. Run `ruff check orchestrator/src/` to confirm zero remaining warnings.

**Verification:** Run `pytest orchestrator/tests/ -v` — all 221+ tests pass. Run `ruff check orchestrator/src/` — zero warnings.

## Dependencies

- WP-003 (relax `length(9)`) should be completed before WP-004 (Zod migration) to ensure the singleton is future-proof before adding the last consumer.
- WP-001 (fix FAIL routing) should be completed before WP-002 (add REWORK test case) since WP-002 may exercise the corrected branch.
- All other WPs are independent and may be executed in any order or in parallel.

## Required Components

- `orchestrator/tests/test_supervisor.py` — existing (WP-001, WP-002)
- `mcp-server/src/schema/workflow-manifest-schema.ts` — existing (WP-003)
- `mcp-server/src/utils/workflow-helpers.ts` — existing (WP-004)
- `orchestrator/tests/test_config.py` — **new file** (WP-005)
- `mcp-server/src/utils/pipeline-maps.ts` — existing (WP-006)
- `mcp-server/tests/utils/workflow-manifest.test.ts` — existing (WP-007)
- `orchestrator/src/` — existing (WP-008)

## Assumptions

- The manifest structure (`shared/workflow-manifest.json`) will not change during this session.
- The 63 ruff warnings are all auto-fixable as stated in the prior synthesis.
- The existing test suites (1,472 MCP server + 221 orchestrator) provide sufficient regression coverage for all changes.

## Constraints

- No new runtime dependencies may be added.
- All changes must preserve manifest-derivation architecture (no reintroduction of hardcoded constants).
- Generated persona files must not be edited directly.
- The `workflowManifest` singleton in `workflow-manifest-schema.ts` must remain the canonical MCP server entry point for manifest data.

## Out of Scope

- Adding new agent roles or pipeline types.
- Modifying `shared/workflow-manifest.json` content (structure changes only in WP-003's Zod schema).
- Persona template changes.
- Documentation pipeline changes unrelated to the DEBT items.
- Extending the Zod schema with additional semantic validations beyond what already exists.

## Acceptance Criteria

- DEBT-1: `_derive_next_action` routes `release-engineering` FAIL to `Release Engineer`, matching `fail_routing` in the manifest.
- DEBT-5: `TestDirectActionRouting` has a `("Release Engineer", "REWORK", "release_engineer")` parametrized case that passes.
- DEBT-3: `ManifestSchema.roles` uses `.nonempty()` instead of `.length(9)`.
- DEBT-2: `workflow-helpers.ts` imports `workflowManifest` from the Zod singleton; no `createRequire` remains in the file.
- DEBT-4: `orchestrator/tests/test_config.py` exists with passing tests for `WP_TERMINAL_STATUSES`, `VALID_STAGES`, `PIPELINE_TYPES`, `ROLE_IDS`, and `PIPELINE_ROLE_NAMES`.
- DEBT-6: `baseAgentMap` is a module-level constant in `pipeline-maps.ts`; `resolveFailAgent()` references it without reconstruction.
- DEBT-8: No WP-ID references remain in `workflow-manifest.test.ts`.
- DEBT-7: `ruff check orchestrator/src/` reports zero warnings.
- All MCP server tests pass (`npm test` in `mcp-server/`).
- All orchestrator tests pass (`pytest orchestrator/tests/`).
- TypeScript build succeeds (`npx tsc --noEmit` in `mcp-server/`).

## Testing Strategy

Each WP has a self-contained verification gate:
- **WP-001, WP-002:** `pytest orchestrator/tests/test_supervisor.py -v`
- **WP-003, WP-004, WP-006, WP-007:** `npm test` in `mcp-server/` + `npx tsc --noEmit`
- **WP-005:** `pytest orchestrator/tests/test_config.py -v`
- **WP-008:** `ruff check orchestrator/src/` + `pytest orchestrator/tests/`

Full suite gate at session end: 1,472+ MCP server tests + 221+ orchestrator tests = 1,694+ combined tests passing.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **DEBT-1 fix causes existing test to fail** | No test currently exercises the `re == 'FAIL'` branch; the change is safe. Verify with full `test_supervisor.py` run. |
| **Relaxing `.length(9)` weakens validation** | `AgentRoleEnum` still enumerates all 9 names; `ManifestSchema.parse()` still validates each role's `name` against the enum. The JSON Schema and `validate-workflow-manifest.js` provide independent count validation. |
| **`workflow-helpers.ts` migration introduces circular import** | `workflow-manifest-schema.ts` has no imports from `utils/`; it only imports from `module` and `zod`. No circular dependency risk. |
| **Ruff auto-fix changes semantics** | All flagged rules (UP017, UP037, I001, E501) are stylistic. Full pytest run after fix confirms no behavior change. |
| **`test_config.py` becomes brittle** | Tests assert structural properties (type, non-emptiness, key membership) rather than exact values, so they tolerate future manifest additions. |
