# Plan

## Summary

Address all strategic recommendations and gold nuggets from the Ledger Tool Simplification Rework-2 synthesis. This covers 8 items across 5 work packages: TypeScript strictness enforcement via `noUnusedLocals` + dead import cleanup (synthesis #2, gold nugget #2), store-threading for dependency propagation helpers + `_ledgerRoot` normalization extraction (synthesis #3, #4), WAIT-path `wpDetails` pre-load completion + test helper alignment (synthesis #6, #5), constraint audit and backfill using the Constraint Entry Format template (gold nugget #1), and CI/pre-commit guard for `build-personas.js --check` (synthesis #1).

## Architectural Context

The MCP server ([mcp-server/src/](mcp-server/src/)) uses a Repository Pattern backed by JSON files under `storage/ledger/{slug}/`. Key files affected by this plan:

- **[mcp-server/tsconfig.json](mcp-server/tsconfig.json)** — Currently lacks `noUnusedLocals`. Enabling it will surface dead imports at compile time.
- **[mcp-server/src/tools/workflow-next-action.ts](mcp-server/src/tools/workflow-next-action.ts)** — 1,217 lines. Contains 6 dead imports (`AGENT_PIPELINE_MAP`, `pipelineAgentRoleMap`, `agentNameMap`, `actionNameMap`, `reworkActionMap`, `isStalePipeline`) that moved to `workflow-next-action-batch.ts` but were not removed from the import list. Also contains 3 early-branch WAIT call sites (empty-project non-PM, allComplete+Synthesis-already-generated, allComplete+non-PM-non-Synthesis) that lack the `opts` parameter for `embedHandoffStatusInWait`, causing fallback to the redundant `computeHandoffStatus` I/O path.
- **[mcp-server/src/tools/work-package.ts](mcp-server/src/tools/work-package.ts)** — 1,405 lines. Contains `propagateDependencyUnblock` (exported) and `propagateDependencyReblock` (private) — both accept `projectPath` + optional `ledgerRoot` and construct a `LedgerStore` internally. Also contains 5 repetitions of the `typeof _ledgerRoot === 'string' ? _ledgerRoot : undefined` normalization pattern across `createWorkPackage`, `updateWorkPackageStatus`, `completePipeline`, and other handlers.
- **[mcp-server/src/tools/pipeline.ts](mcp-server/src/tools/pipeline.ts)** — Calls `propagateDependencyUnblock(projectPath, wpId)` (without ledgerRoot) from `completePipeline`.
- **[mcp-server/tests/tools/workflow-handoff.test.ts](mcp-server/tests/tools/workflow-handoff.test.ts)** — Uses `makeWp` helper with `assigned_to: 'Developer Agent'` instead of canonical `'Developer'` role string.
- **[mcp-server/docs/agents/project-manifest/constraints.md](mcp-server/docs/agents/project-manifest/constraints.md)** — 59 constraints. The Constraint Entry Format guide (Rule / Rationale / Anti-pattern / Correct-pattern / Forbidden-patterns) was formalized in the previous plan. Many pre-existing constraints lack anti-pattern and correct-pattern code blocks.
- **[personas/docs/agents/project-manifest/constraints.md](personas/docs/agents/project-manifest/constraints.md)** — Persona system constraints. Same backfill need applies.
- **[scripts/build-personas.js](scripts/build-personas.js)** — Has `--check` mode but no CI/pre-commit integration.

## Approach / Architecture

The plan groups the 8 items into 5 work packages, ordered by dependency and risk:

1. **WP-1: TypeScript Strictness + Dead Import Cleanup** — Enable `noUnusedLocals: true` in `tsconfig.json`, fix all resulting compilation errors (starting with the 6 known dead imports in `workflow-next-action.ts`), verify clean build. This is foundational — doing it first means subsequent WPs benefit from the stricter compiler and any new dead imports introduced by refactoring are caught immediately.

2. **WP-2: Store-Threading for Dependency Propagation + `_ledgerRoot` Helper** — Refactor `propagateDependencyUnblock` and `propagateDependencyReblock` to accept an optional `LedgerStore` instance directly, falling back to internal construction when not provided (preserving backward compatibility). Extract the `typeof _ledgerRoot === 'string' ? _ledgerRoot : undefined` pattern into a `extractLedgerRoot()` utility function. Both are code-health improvements in `work-package.ts`.

3. **WP-3: WAIT Path Completion + Test Helper Alignment** — (a) Lift `wpDetails` pre-load to cover the 3 remaining early-branch WAIT call sites in `getNextAction()` that currently use the fallback `computeHandoffStatus` path. (b) Fix `makeWp` test helper in `workflow-handoff.test.ts` to use canonical `'Developer'` role string instead of `'Developer Agent'`. Both are low-risk, mechanical corrections.

4. **WP-4: Constraint Audit & Backfill** — Audit all 59 constraints in `mcp-server/docs/agents/project-manifest/constraints.md` and the constraints in `personas/docs/agents/project-manifest/constraints.md`. Identify entries that lack anti-pattern/correct-pattern code blocks where such examples would add clarity. Backfill using the Constraint Entry Format template. This is a documentation-only work package — no code changes.

5. **WP-5: CI/Pre-commit Guard for `build-personas.js --check`** — Add `node scripts/build-personas.js --check` to either a pre-commit hook (via a `.husky/` or `lint-staged` configuration) or a CI pipeline script. Without automation, the persona guard is advisory only and provides no regression protection.

## Rationale

- **TypeScript strictness first** (WP-1) because enabling `noUnusedLocals` converts a class of structural debt into hard build failures. All subsequent WPs will benefit from this safety net — any refactoring that leaves dead imports will be caught by `tsc` immediately.
- **Store-threading before WAIT path** (WP-2 before WP-3) because WP-2 establishes the store-passing pattern that WP-3 extends. WP-3's `wpDetails` pre-load changes are simpler when the codebase already follows a consistent store-threading convention.
- **Test helper alignment in WP-3** (rather than standalone) because it's a single-line change that naturally fits with the other low-risk corrections in that WP.
- **Constraint audit as separate WP** (WP-4) because it's documentation-only, can be parallelized with code work, and has no code dependencies.
- **CI guard last** (WP-5) because it's an infrastructure change that doesn't affect code correctness. It depends on nothing and nothing depends on it, so it can run last without blocking other work.

## Detailed Steps

### WP-1: TypeScript Strictness + Dead Import Cleanup

**Assigned to:** Developer

**Description:** Enable `noUnusedLocals: true` in `mcp-server/tsconfig.json` and clean up all resulting compilation errors.

**Implementation:**
1. Add `"noUnusedLocals": true` to `compilerOptions` in `mcp-server/tsconfig.json`.
2. Run `cd mcp-server && npx tsc --noEmit` to identify all dead-import errors.
3. Remove the 6 known dead imports from `workflow-next-action.ts` (lines 12, 29–33): `AGENT_PIPELINE_MAP`, `pipelineAgentRoleMap`, `agentNameMap`, `actionNameMap`, `reworkActionMap`, `isStalePipeline`.
4. Fix any additional dead-import or dead-variable errors surfaced by the stricter compiler.
5. Run full test suite to verify no behavioral change.
6. Update `constraints.md` — add a new constraint for the `noUnusedLocals` rule.

**Dependencies:** None

**Acceptance Criteria:**
- `mcp-server/tsconfig.json` includes `"noUnusedLocals": true`.
- `npx tsc --noEmit` exits 0 with the new flag enabled.
- The 6 dead imports in `workflow-next-action.ts` are removed.
- No dead-import or dead-variable errors remain across the codebase.
- All existing tests pass (982+).
- A new constraint documents the `noUnusedLocals` rule in `constraints.md`.

---

### WP-2: Store-Threading for Dependency Propagation + `_ledgerRoot` Helper

**Assigned to:** Developer

**Description:** Refactor `propagateDependencyUnblock` and `propagateDependencyReblock` to optionally accept a `LedgerStore` instance directly, eliminating redundant store construction at call sites that already have a store. Extract the repeated `_ledgerRoot` normalization pattern into a utility function.

**Implementation:**
1. Create a small utility function `extractLedgerRoot(val: unknown): string | undefined` (in `work-package.ts` or a new utility file if preferred). This replaces the `typeof _ledgerRoot === 'string' ? _ledgerRoot : undefined` pattern used at 5 call sites in `work-package.ts`.
2. Replace all 5 occurrences of the pattern with a call to `extractLedgerRoot(_ledgerRoot)`.
3. Extend `propagateDependencyUnblock` signature to accept an optional `opts?: { store?: LedgerStore }` parameter. When `opts.store` is provided, skip internal `new LedgerStore(projectPath, ledgerRoot)` construction and use the provided store directly.
4. Apply the same pattern to `propagateDependencyReblock`.
5. Update call sites in `work-package.ts` (line ~863, ~869) and `pipeline.ts` (line ~455) to pass the existing store where available.
6. Run `npx tsc --noEmit` to verify no new dead-import errors (thanks to WP-1's `noUnusedLocals`).
7. Run full test suite.
8. Update `api-surface.md` with the new function signatures.

**Dependencies:** WP-1 (the `noUnusedLocals` flag must be active to catch any dead imports introduced by refactoring)

**Acceptance Criteria:**
- `extractLedgerRoot()` utility exists and is used at all 5 former normalization sites.
- `propagateDependencyUnblock` and `propagateDependencyReblock` accept an optional `store` parameter.
- Call sites in `work-package.ts` and `pipeline.ts` pass the existing store where available.
- `npx tsc --noEmit` exits 0.
- All existing tests pass.
- `api-surface.md` updated.

---

### WP-3: WAIT Path Completion + Test Helper Alignment

**Assigned to:** Developer

**Description:** Two low-risk corrections:

**Part A — WAIT path `wpDetails` pre-load:** Three `embedHandoffStatusInWait` call sites in `getNextAction()` (empty-project non-PM at line ~101, allComplete+Synthesis-already-generated at line ~132, allComplete+non-PM-non-Synthesis at line ~186) currently call without the `opts` parameter, forcing the fallback `computeHandoffStatus` I/O path. For the empty-project case, `wpDetails` would be `[]`. For the allComplete cases, moving the `wpDetails` pre-load before the `allComplete` check enables the bypass at both sites.

**Part B — Test helper alignment:** The `makeWp` helper in `workflow-handoff.test.ts` uses `assigned_to: 'Developer Agent'` (human-readable label). Change to `'Developer'` to match the canonical `AGENT_ROLES` constant.

**Implementation:**
1. In `getNextAction()`, move the `wpDetails` pre-load (bulk `store.readWorkPackage` loop) to just after the `rootIndex` read, before the empty-WP and `allComplete` checks.
2. For the empty-project case, the pre-load produces `wpDetails = []` if `rootIndex.work_packages` is empty, so the moved code is safe.
3. Pass `{ store, rootIndex, wpDetails }` to all 3 early-branch `embedHandoffStatusInWait` calls.
4. In `workflow-handoff.test.ts`, change `assigned_to: 'Developer Agent'` to `assigned_to: 'Developer'` in the `makeWp` helper.
5. Run full test suite.

**Dependencies:** WP-1

**Acceptance Criteria:**
- All `embedHandoffStatusInWait` call sites in `workflow-next-action.ts` pass the `opts` parameter.
- No fallback `computeHandoffStatus` I/O path is exercised from `getNextAction()`.
- `makeWp` uses `assigned_to: 'Developer'`.
- All existing tests pass.

---

### WP-4: Constraint Audit & Backfill

**Assigned to:** Developer

**Description:** Audit all constraints in both `constraints.md` files. Identify entries that lack anti-pattern/correct-pattern code blocks where such examples would materially improve clarity. Backfill using the Constraint Entry Format template (Rule / Rationale / Anti-pattern / Correct-pattern / Forbidden-patterns).

**Scope:**
- `mcp-server/docs/agents/project-manifest/constraints.md` — 59 constraints
- `personas/docs/agents/project-manifest/constraints.md` — all constraints

**Implementation:**
1. Read both constraints files end-to-end.
2. For each constraint, assess whether it would benefit from anti-pattern/correct-pattern code blocks. Skip constraints where the rule is self-evident (e.g., "Timestamps Must Use UTC ISO 8601 Format").
3. Draft anti-pattern (❌) and correct-pattern (✅) code blocks for each candidate.
4. Add Rationale sections where missing.
5. Verify the document renders correctly in Markdown preview.

**Dependencies:** None (documentation-only; can run in parallel with code WPs)

**Acceptance Criteria:**
- All non-trivial constraints in both `constraints.md` files have at minimum a Rule statement and Rationale.
- Constraints involving code patterns have anti-pattern and correct-pattern examples where applicable.
- No existing constraint text is altered in meaning — only structure/examples added.
- Document renders correctly in Markdown.

---

### WP-5: CI/Pre-commit Guard for `build-personas.js --check`

**Assigned to:** Developer

**Description:** Add `node scripts/build-personas.js --check` to a pre-commit hook or CI pipeline to convert the persona build guard from advisory to enforced.

**Implementation options (choose one):**

**Option A — npm `pretest` script** (simplest):
1. Add `"pretest": "node scripts/build-personas.js --check"` to root `package.json` scripts.
2. This runs automatically before `npm test` in CI and local development.

**Option B — Husky pre-commit hook:**
1. Install `husky` as a dev dependency: `npm install --save-dev husky`.
2. Initialize: `npx husky init`.
3. Add `node scripts/build-personas.js --check` to `.husky/pre-commit`.
4. Document in root `README.md`.

**Option C — CI-only (GitHub Actions or equivalent):**
1. Add a step in the CI workflow YAML: `run: node scripts/build-personas.js --check`.
2. Position before the test step.

**Dependencies:** None

**Acceptance Criteria:**
- `node scripts/build-personas.js --check` runs automatically in at least one of: pre-commit hook, CI pipeline, or npm lifecycle script.
- A stale persona file causes the guard to fail and block the pipeline/commit.
- The approach is documented in the root `README.md`.
