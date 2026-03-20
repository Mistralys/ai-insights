# Plan — Sync Ledger Code with Workflow Specification v2.3.0 / v2.4.0

## Summary

Bring the MCP server implementation into full compliance with workflow specification v2.3.0 (Synthesis Timestamp, Ledger Versioning, Cross-WP Staleness) and v2.4.0 (PM-Composable Pipeline Stages). The codebase is ~80% aligned — the core composable-pipeline logic from v2.4.0 is already implemented. This plan addresses the remaining gaps: two missing root-index fields (`synthesis_generated_at`, `ledger_version`), one missing WP summary field (`active_pipeline_stages`), helper function extractions for DRY compliance, and one advisory cross-WP staleness check.

## Architectural Context

**Relevant modules and patterns:**

- **Schema layer:** [mcp-server/src/schema/root-index.ts](mcp-server/src/schema/root-index.ts) — Zod schema for the project root index (`RootIndexSchema`, `WorkPackageSummarySchema`). All fields are validated here; new optional fields must be added with `.optional()`.
- **Project lifecycle:** [mcp-server/src/tools/project-lifecycle.ts](mcp-server/src/tools/project-lifecycle.ts) — `initializeProject()` (§5.1), `getProjectStatus()` / `computeHealedStatus()` (§17), `completeSynthesis()` (§19.1).
- **Work package operations:** [mcp-server/src/tools/work-package.ts](mcp-server/src/tools/work-package.ts) — `createWorkPackage()` (§9b.1), `updateWorkPackageStatus()` (§10b), `propagateDependencyReblock()` (§15.5). The `synthesis_generated` flag is currently reset in three places (COMPLETE→IN_PROGRESS at line ~928, cascade reblock at line ~1157, WP creation at line ~464) — `synthesis_generated_at` must be cleared in all three.
- **Pipeline maps:** [mcp-server/src/utils/pipeline-maps.ts](mcp-server/src/utils/pipeline-maps.ts) — `DEFAULT_PIPELINE_STAGES`, `CANONICAL_PIPELINE_ORDERING`, `resolvePrerequisite()`, `resolveNextAgent()`, `resolveFailAgent()`, `getOrderedActiveStages()`. Already implements v2.4.0 dynamic routing.
- **Pipeline operations:** [mcp-server/src/tools/pipeline.ts](mcp-server/src/tools/pipeline.ts) — `completePipeline()` (§12.1). Currently has the artifact soft warning (line ~434) and generalized auto-finalize (line ~470). Missing: cross-WP dependency freshness check (§21.59).
- **Workflow helpers:** [mcp-server/src/utils/workflow-helpers.ts](mcp-server/src/utils/workflow-helpers.ts) — Stateless utility functions shared by workflow tool modules.
- **Constants:** [mcp-server/src/utils/constants.ts](mcp-server/src/utils/constants.ts) — `AGENT_ROLES`. Currently has no `SPEC_VERSION` constant.
- **Project reset:** [mcp-server/src/utils/project-reset.ts](mcp-server/src/utils/project-reset.ts) — `applyProjectReset()` also resets `synthesis_generated` (line ~435) — needs `synthesis_generated_at` clearing too.
- **Tests:** Test suites under `mcp-server/tests/` — new fields and behaviors need coverage. Key test files: `tests/tools/`, `tests/schema/`, `tests/utils/`, `tests/integration/`.

**Key pattern:** All optional root-index fields follow the `.optional()` Zod pattern. Self-healing writes go through `computeHealedStatus()` → lock → re-read → apply → write. Schema changes are backward-compatible (new fields are optional/nullable so existing ledger files parse without error).

## Approach / Architecture

The changes are grouped into three tiers by priority:

1. **Tier 1 — New schema fields + propagation logic** (`synthesis_generated_at`, `ledger_version`, `active_pipeline_stages` on summary): Pure additions to the Zod schema plus logic wiring across all existing write paths. No behavioral changes to existing code.

2. **Tier 2 — Helper extractions** (`firstActiveStage()`, `lastActiveStage()`, `validateActiveStages()`): Extract existing inline code into reusable functions in `pipeline-maps.ts`. Replace inline usages. This is a refactor — no behavioral change.

3. **Tier 3 — Advisory cross-WP staleness check** (§21.59): Add a SHOULD-level dependency freshness check in `completePipeline()`. Emits a soft warning project comment; does not block pipeline completion.

## Rationale

- **Tier 1 addresses the user's primary request** — `synthesis_generated_at` and `ledger_version` are the two fields explicitly called out in the spec changelog v2.3.0 that are completely absent from the code.
- **`active_pipeline_stages` on WP summary** is a routing optimization from §3.2 of the data model — the spec explicitly says it should be in the summary for handoff/recommendation functions to filter without loading detail files. Currently missing from `WorkPackageSummarySchema` and not populated during `createWorkPackage`.
- **Tier 2 is code quality** — the spec defines `firstActiveStage`/`lastActiveStage` as named helpers (§6.2.1). The code computes them inline in multiple places, creating duplication.
- **Tier 3 is a SHOULD (advisory)** — it provides defense-in-depth against cross-WP staleness but is not required for correctness.
- The former `MANDATORY_PIPELINE_TYPES` and `OPTIONAL_PIPELINE_TYPES` constants are already removed — no action needed.

## Detailed Steps

### Tier 1: Schema Fields & Propagation

#### Step 1 — Add `synthesis_generated_at` and `ledger_version` to `RootIndexSchema`

**File:** `mcp-server/src/schema/root-index.ts`

- Add `synthesis_generated_at: z.string().nullable().optional()` to `RootIndexSchema`
- Add `ledger_version: z.string().optional()` to `RootIndexSchema`
- The `RootIndex` type will automatically include these fields via `z.infer`

#### Step 2 — Add `active_pipeline_stages` to `WorkPackageSummarySchema`

**File:** `mcp-server/src/schema/root-index.ts`

- Add `active_pipeline_stages: z.array(z.string()).nullable().optional()` to `WorkPackageSummarySchema`
- Matches the data model §3.2 definition

#### Step 3 — Set `ledger_version` on project initialization

**File:** `mcp-server/src/tools/project-lifecycle.ts`

- Add a `SPEC_VERSION` constant (e.g., `"2.4.0"`) to `mcp-server/src/utils/constants.ts`
- In `initializeProject()`, set `ledger_version: SPEC_VERSION` on the new root index object

#### Step 4 — Set `synthesis_generated_at` in `completeSynthesis()`

**File:** `mcp-server/src/tools/project-lifecycle.ts`

- After `rootIndex.synthesis_generated = true`, add `rootIndex.synthesis_generated_at = now()`
- Include `synthesis_generated_at` in the response JSON for observability

#### Step 5 — Clear `synthesis_generated_at` on COMPLETE → IN_PROGRESS

**File:** `mcp-server/src/tools/work-package.ts`

- In the `COMPLETE → IN_PROGRESS` block (around line ~928), after `root.synthesis_generated = false`, add `root.synthesis_generated_at = null`

#### Step 6 — Clear `synthesis_generated_at` on cascade reblock

**File:** `mcp-server/src/tools/work-package.ts`

- In `propagateDependencyReblock()` (around line ~1157), where `rootIndex.synthesis_generated = false`, add `rootIndex.synthesis_generated_at = null`

#### Step 7 — Clear `synthesis_generated_at` on WP creation on COMPLETE project

**File:** `mcp-server/src/tools/work-package.ts`

- In `createWorkPackage()` (around line ~464), where `rootIndex.synthesis_generated = false`, add `rootIndex.synthesis_generated_at = null`

#### Step 8 — Clear `synthesis_generated_at` in project reset

**File:** `mcp-server/src/utils/project-reset.ts`

- In `applyProjectReset()` (around line ~435), where `rootIndex.synthesis_generated = false`, add `rootIndex.synthesis_generated_at = null`

#### Step 9 — Populate `active_pipeline_stages` on WP summary at creation

**File:** `mcp-server/src/tools/work-package.ts`

- In `createWorkPackage()`, add `active_pipeline_stages: resolvedActiveStages` to the `wpSummary` object (around line ~443)

#### Step 10 — Self-healing: legacy `synthesis_generated_at` repair

**File:** `mcp-server/src/tools/project-lifecycle.ts`

- In `computeHealedStatus()`, add a `legacySynthesisTimestampRepair` flag: if `synthesis_generated == true` AND `synthesis_generated_at` is null/absent, flag it for repair
- In the write path of `getProjectStatus()`, when `legacySynthesisTimestampRepair` is true, set `synthesis_generated_at = root.last_updated` as a best-effort repair (§21.57 absent/null semantics)
- Emit a soft warning project comment when this repair fires

#### Step 11 — Self-healing: legacy `ledger_version` backfill

**File:** `mcp-server/src/tools/project-lifecycle.ts`

- In the write path of `getProjectStatus()`, if `rootIndex.ledger_version` is absent, set it to `SPEC_VERSION` as a one-time migration (§21.58 absent/null semantics)
- No warning needed — this is a silent migration

#### Step 12 — Forward-compatibility warning for newer `ledger_version`

**File:** `mcp-server/src/tools/project-lifecycle.ts`

- After loading a root index (in `getProjectStatus()`), if `rootIndex.ledger_version` is present and exceeds the current `SPEC_VERSION`, emit a `"warning"` project comment (§21.58)

### Tier 2: Helper Extractions

#### Step 13 — Extract `firstActiveStage()` and `lastActiveStage()` helpers

**File:** `mcp-server/src/utils/pipeline-maps.ts`

- Add exported functions:
  ```ts
  export function firstActiveStage(wp: { active_pipeline_stages?: PipelineType[] | null }): PipelineType
  export function lastActiveStage(wp: { active_pipeline_stages?: PipelineType[] | null }): PipelineType
  ```
- Both fall back to `DEFAULT_PIPELINE_STAGES` when the field is absent/null

#### Step 14 — Replace inline computations with helpers

**Files:** `mcp-server/src/tools/pipeline.ts`, `mcp-server/src/tools/workflow-next-action.ts`

- Replace all inline `orderedActive[orderedActive.length - 1]` / `orderedActive[0]` with `lastActiveStage(wp)` / `firstActiveStage(wp)`

#### Step 15 — Extract `validateActiveStages()` function

**File:** `mcp-server/src/utils/pipeline-maps.ts`

- Move the validation logic from `createWorkPackage()` (lines ~335–395) into a standalone exported function
- Return `{ errors: string[], warnings: string[] }` 
- Update `createWorkPackage()` to call this function

### Tier 3: Cross-WP Staleness Check

#### Step 16 — Add dependency freshness check in `completePipeline()`

**File:** `mcp-server/src/tools/pipeline.ts`

- Before accepting a PASS result, iterate the WP's `dependencies` array
- For each dependency, check that its `last_updated` predates the current pipeline's `started_at`
- If a dependency was modified after the pipeline started, emit a soft warning project comment: `"Dependency {depId} was modified after pipeline started — results may reflect stale assumptions"`
- Do NOT reject the PASS — this is advisory only (§21.59 "SHOULD" level)

## Dependencies

- Steps 1–2 (schema changes) must come before all other steps
- Step 3 (`SPEC_VERSION` constant) must come before Steps 10–12 (self-healing)
- Steps 13–14 (helper extraction) are independent of Tier 1
- Step 16 (cross-WP check) is independent of all other steps

## Required Components

- `mcp-server/src/schema/root-index.ts` — schema additions
- `mcp-server/src/utils/constants.ts` — new `SPEC_VERSION` constant
- `mcp-server/src/utils/pipeline-maps.ts` — helper extractions
- `mcp-server/src/tools/project-lifecycle.ts` — initialization, synthesis, self-healing
- `mcp-server/src/tools/work-package.ts` — WP creation, status update, cascade reblock
- `mcp-server/src/tools/pipeline.ts` — dependency freshness check, inline replacement
- `mcp-server/src/utils/project-reset.ts` — synthesis_generated_at clearing
- `mcp-server/src/tools/workflow-next-action.ts` — inline replacement
- Test files (new + existing)

## Assumptions

- The current workflow spec version is `2.4.0` (matching the spec README header)
- Existing ledger files in production/dev will be migrated via the self-healing backfill (Steps 10–12), not a one-time migration script
- The `active_pipeline_stages` field on WP summaries will be populated only for newly created WPs — existing WPs retain the absent/null default interpretation

## Constraints

- All schema changes must be backward-compatible (`.optional()` / `.nullable()`)
- No behavioral changes to existing green-path logic — all additions are additive
- Self-healing must not break existing ledger files that lack the new fields
- `SPEC_VERSION` constant references the workflow specification version, not the npm package version
- The cross-WP staleness check (Step 16) is advisory only — it MUST NOT reject a PASS

## Out of Scope

- `MANDATORY_PIPELINE_TYPES` / `OPTIONAL_PIPELINE_TYPES` removal — already done
- Staleness guard in `completeSynthesis` comparing `synthesis_generated_at` against individual WP `last_updated` timestamps (§21.57 primary use) — this is defense-in-depth against corruption and can be added later
- Recursive cascade reblock for transitive dependents (§21.42/§21.59 alternative approach)
- GUI/dashboard consumption of the new fields
- Tests for the orchestrator (Python) — that's a separate codebase sync
- Manifest document updates (deferred to the Documentation stage)

## Acceptance Criteria

1. `RootIndexSchema` includes `synthesis_generated_at` (string, nullable, optional) and `ledger_version` (string, optional)
2. `WorkPackageSummarySchema` includes `active_pipeline_stages` (array, nullable, optional)
3. `initializeProject()` sets `ledger_version` to `SPEC_VERSION` on new ledgers
4. `completeSynthesis()` sets `synthesis_generated_at = now()` alongside `synthesis_generated = true`
5. `synthesis_generated_at` is cleared to `null` in all four reset paths: COMPLETE→IN_PROGRESS, cascade reblock, WP creation on COMPLETE project, project reset
6. Self-healing backfills `ledger_version` on existing ledgers and repairs legacy `synthesis_generated_at` nulls
7. Self-healing emits a forward-compat warning when `ledger_version` exceeds `SPEC_VERSION`
8. `firstActiveStage()` and `lastActiveStage()` are exported from `pipeline-maps.ts` and used in all call sites
9. `validateActiveStages()` is a standalone exported function in `pipeline-maps.ts`
10. `createWorkPackage()` populates `active_pipeline_stages` on the WP summary
11. `completePipeline()` emits a soft warning when a dependency's `last_updated` post-dates the pipeline's `started_at`
12. All existing tests continue to pass
13. New tests cover: new schema fields parse correctly, synthesis_generated_at lifecycle across all paths, ledger_version initialization and backfill, forward-compat warning, active_pipeline_stages on summary, cross-WP staleness warning

## Testing Strategy

- **Unit tests:** Schema validation (new fields accept/reject correctly), `firstActiveStage`/`lastActiveStage` helpers, `validateActiveStages` extraction, self-healing edge cases
- **Integration tests:** Full lifecycle: init → create WP → pipelines → complete synthesis (verify `synthesis_generated_at` set) → reopen WP (verify cleared) → re-complete
- **Backward compat tests:** Load a ledger JSON without the new fields → verify Zod parse succeeds, self-healing backfills correctly
- **Cross-WP staleness test:** Create dependency chain → complete all → reopen upstream → verify warning emitted on downstream pipeline completion

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Schema change breaks existing ledger parsing** | All new fields are `.optional()` / `.nullable()` — Zod parsing is additive. Backward compat test covers this. |
| **Self-healing write amplification** | Backfill only fires once per ledger (sets `ledger_version`, then skips on next read). Minimal overhead. |
| **`SPEC_VERSION` constant drifts from actual spec** | Document that `SPEC_VERSION` must be updated when the workflow spec version changes. Consider adding a build-time check. |
| **Cross-WP staleness false positives** | Warning is advisory only — does not block work. The condition (`dependency last_updated > pipeline started_at`) is precise. |
| **Helper extraction introduces regressions** | Replace inline code mechanically — same logic, just moved. Run full test suite to verify. |
