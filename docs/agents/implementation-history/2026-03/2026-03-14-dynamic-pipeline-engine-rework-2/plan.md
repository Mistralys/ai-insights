# Plan

## Summary

Complete the 6-type pipeline annotation migration and eliminate the manual maintenance risk for `.describe()` strings. This plan addresses the two code-level follow-ups from the `2026-03-14-dynamic-pipeline-engine-rework-1` synthesis report: (1) fix the last remaining 4-type `.describe()` annotation in `observations.ts`, and (2) introduce a `describePipelineTypes()` helper that derives annotation strings from `PIPELINE_TYPES`, replacing all 6 hand-maintained `.describe()` call sites. A drift-detection test ensures future pipeline additions are automatically caught.

## Architectural Context

- **Source of truth:** `PIPELINE_TYPES` in `mcp-server/src/utils/pipeline-maps.ts` (line 16) — a `const` tuple of the 6 canonical pipeline types in execution order.
- **`PipelineTypeEnum`** (line 24) — a Zod enum derived from `PIPELINE_TYPES`, used by all tool schemas for the `type` / `pipeline_type` field.
- **6 `.describe()` call sites** across 3 files currently hardcode pipeline type lists as prose strings:

  | # | File | Line | Field | Current prefix |
  |---|------|------|-------|---------------|
  | 1 | `mcp-server/src/tools/observations.ts` | 24 | `pipeline_type` | `Pipeline type to add the observation to:` |
  | 2 | `mcp-server/src/tools/begin-work.ts` | 30 | `type` | `Pipeline type to start:` |
  | 3 | `mcp-server/src/tools/pipeline.ts` | 130 | `type` | `Pipeline type:` |
  | 4 | `mcp-server/src/tools/pipeline.ts` | 301 | `type` | `Pipeline type to complete:` |
  | 5 | `mcp-server/src/tools/pipeline.ts` | 592 | `type` | `Pipeline type to cancel:` |
  | 6 | `mcp-server/src/tools/pipeline.ts` | 662 | `type` | `Pipeline type:` |

- Site #1 is the **only** site still showing 4 types; sites #2–#6 were fixed by the previous plan's WP-001.
- Constraints doc is at `mcp-server/docs/agents/project-manifest/constraints.md` (highest constraint number: 67).

## Approach / Architecture

1. **Introduce `describePipelineTypes(prefix: string): string`** in `pipeline-maps.ts` — a pure function that concatenates `prefix` with a quoted, comma-separated list of all `PIPELINE_TYPES` values. This is the single place where the prose representation lives.
2. **Replace all 6 `.describe()` string literals** with calls to `describePipelineTypes(...)`, preserving each site's unique prefix text.
3. **Add a drift-detection test** in `pipeline-maps.test.ts` that asserts `describePipelineTypes` output contains every entry in `PIPELINE_TYPES` — future additions to `PIPELINE_TYPES` are automatically covered.
4. **Update manifest documentation** in `api-surface.md` (new helper) and `constraints.md` (new constraint for `.describe()` derivation).

This approach was chosen over a snapshot test because:
- A helper is **preventive** (makes drift impossible) vs. a snapshot which is **detective** (catches drift after the fact).
- The helper is trivial (~3 lines) and has zero runtime cost — Zod `.describe()` runs once at schema definition time.

## Rationale

- A one-liner fix for `observations.ts` alone would leave the systemic risk intact — the next pipeline type addition would require manual updates to 6 sites.
- The helper centralises the prose generation, so adding a 7th pipeline type requires zero changes to tool schema files.
- The drift test is a safety net for the helper itself (ensures it stays in sync with `PIPELINE_TYPES`).

## Detailed Steps

1. **Add `describePipelineTypes` helper to `pipeline-maps.ts`:**
   - Signature: `export function describePipelineTypes(prefix: string): string`
   - Implementation: returns `` `${prefix} ${PIPELINE_TYPES.map(t => `"${t}"`).join(', ')}` `` (or similar).
   - Place it after the existing `getOrderedActiveStages` export.

2. **Replace all 6 `.describe()` literals with `describePipelineTypes(...)` calls:**
   - `observations.ts` line 24: `PipelineTypeEnum.describe(describePipelineTypes('Pipeline type to add the observation to:'))`
   - `begin-work.ts` line 30: `describePipelineTypes('Pipeline type to start:')`
   - `pipeline.ts` line 130: `describePipelineTypes('Pipeline type:')`
   - `pipeline.ts` line 301: `describePipelineTypes('Pipeline type to complete:')`
   - `pipeline.ts` line 592: `describePipelineTypes('Pipeline type to cancel:')`
   - `pipeline.ts` line 662: `describePipelineTypes('Pipeline type:')`
   - Each file must add `describePipelineTypes` to its import from `../utils/pipeline-maps.js`.

3. **Add drift-detection test in `pipeline-maps.test.ts`:**
   - Assert that `describePipelineTypes('Test:')` contains every entry in `PIPELINE_TYPES`.
   - Assert the output starts with the provided prefix.
   - Assert output format is stable (quoted, comma-separated).

4. **Update `api-surface.md`:**
   - Add `describePipelineTypes` entry in the Pipeline Routing Utilities section (near `getOrderedActiveStages`).

5. **Add Constraint 68 to `constraints.md`:**
   - Rule: All `PipelineTypeEnum.describe()` annotations MUST use `describePipelineTypes()` — never hardcode pipeline type lists in `.describe()` strings.
   - Rationale: Eliminates manual maintenance risk; adding a pipeline type to `PIPELINE_TYPES` automatically propagates to all MCP JSON Schema annotations.

## Dependencies

- Step 2 depends on Step 1 (helper must exist before call sites are updated).
- Steps 3–5 are independent of each other but all depend on Steps 1–2.

## Required Components

- `mcp-server/src/utils/pipeline-maps.ts` — new export (`describePipelineTypes`)
- `mcp-server/src/tools/observations.ts` — import update + `.describe()` replacement
- `mcp-server/src/tools/begin-work.ts` — import update + `.describe()` replacement
- `mcp-server/src/tools/pipeline.ts` — import update + 4× `.describe()` replacement
- `mcp-server/tests/utils/pipeline-maps.test.ts` — new test block
- `mcp-server/docs/agents/project-manifest/api-surface.md` — new helper entry
- `mcp-server/docs/agents/project-manifest/constraints.md` — Constraint 68

## Assumptions

- `describePipelineTypes` is imported alongside `PipelineTypeEnum` in all three tool files. Verified: `observations.ts` line 9 already imports `PipelineTypeEnum` from `../utils/pipeline-maps.js`. `begin-work.ts` and `pipeline.ts` do as well.
- The `.describe()` string format (prefix + quoted comma-separated list) matches the existing style used by the 5 already-corrected sites.
- No other files outside `mcp-server/src/tools/` use `PipelineTypeEnum.describe()`.

## Constraints

- Must preserve the exact prefix text at each call site (these prefixes appear in MCP JSON Schema exposed to AI clients).
- Must not change the Zod schema shape or validation behavior — only the `.describe()` annotation string.
- Constraint 53 (No Implementation Provenance in Manifest Documents) applies to `api-surface.md` updates.

## Out of Scope

- Refactoring other non-pipeline `.describe()` strings (e.g., `status`, `priority`).
- Changing the `PIPELINE_TYPES` tuple itself.
- Orchestrator-side changes (Python code has no equivalent `.describe()` mechanism).

## Acceptance Criteria

- `observations.ts` `.describe()` string includes all 6 pipeline types.
- All 6 `.describe()` call sites use `describePipelineTypes()` — zero hardcoded pipeline type lists remain.
- `describePipelineTypes` is exported from `pipeline-maps.ts` and covered by at least one test.
- `api-surface.md` documents the new helper.
- `constraints.md` includes Constraint 68 prohibiting hardcoded `.describe()` pipeline lists.
- All existing tests pass (`npm test` in `mcp-server/`).
- TypeScript build succeeds with no errors.

## Testing Strategy

- **Unit test** for `describePipelineTypes`: verifies output contains all `PIPELINE_TYPES` values, correct prefix, and quoted/comma-separated format.
- **Existing test suite** (1273 tests): run in full to confirm no regressions from the `.describe()` string changes (these are annotation-only changes — no behavioral impact expected, but full suite confirms no side effects).

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **`.describe()` format change breaks downstream JSON Schema consumers** | The format is identical to the existing 5 corrected sites — no net change for sites #2–#6; site #1 gains the two missing types, which is the intended fix. |
| **Future developer bypasses helper and hardcodes a string** | Constraint 68 documents the rule; the drift-detection test catches inconsistencies at test time. |
