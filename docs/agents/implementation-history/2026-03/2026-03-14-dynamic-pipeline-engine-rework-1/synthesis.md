# Synthesis Report — Dynamic Pipeline Engine Rework (Phase 1–4)

**Plan:** `2026-03-14-dynamic-pipeline-engine-rework-1`
**Date:** 2026-03-14
**Status:** COMPLETE
**Duration:** ~40 minutes (19:13 → 19:53 UTC)
**Work Packages:** 6 / 6 COMPLETE
**Pipeline Health:** 6/6 WPs with all stages PASS, 0 missing stages

---

## Executive Summary

This session resolved a set of correctness gaps and technical debt items carried forward from the previous Dynamic Pipeline Engine project. The work fell into four phases:

1. **Phase 1 — Schema correctness (WP-001, WP-002, WP-003):** Three targeted fixes ensuring the 6-type pipeline model is fully reflected in tool schema annotations, the revalidation guard, and the `ledger_reset_rework_count` schema.
2. **Phase 2 — DRY refactoring (WP-004):** Extracted a `getOrderedActiveStages` helper that replaced 5 duplicated `CANONICAL_PIPELINE_ORDERING.filter()` call sites across consumer files.
3. **Phase 3 — Test hygiene (WP-005):** Removed dead code and a canonically invalid fixture from MCP server tests, and pruned two redundant orchestrator tests subsumed by a more thorough set-equality assertion.
4. **Phase 4 — Manifest documentation (WP-006):** Verified that `api-surface.md` correctly documents both the `ledger_reset_rework_count` 6-type enum and the new `getOrderedActiveStages` helper — both updates were pre-applied by WP-003 and WP-004 documentation pipelines, leaving WP-006 as a pure verification WP.

All code changes are in `mcp-server/`. No functional regressions were introduced anywhere.

---

## Metrics

| Metric | Value |
|--------|-------|
| Total tests (MCP server) | 1273 |
| Total tests (orchestrator pytest) | 7 |
| Tests failed | 0 |
| TypeScript build errors | 0 |
| WPs with all pipelines PASS | 6 / 6 |
| Files modified (implementation) | 7 |
| Files modified (documentation) | 2 |

### Test counts by WP

| WP | MCP Tests | Pytest | Result |
|----|-----------|--------|--------|
| WP-001 | 1273 | — | PASS |
| WP-002 | 1273 | — | PASS |
| WP-003 | 1273 | — | PASS |
| WP-004 | 1273 | — | PASS |
| WP-005 | 1273 | 7 (down from 9) | PASS |
| WP-006 | 1273 | — | PASS |

---

## What Was Built

### WP-001 — Zod `.describe()` annotation cleanup

Updated all 5 flow-control Zod schema `.describe()` annotations (in `pipeline.ts`: `StartPipelineSchema`, `CompletePipelineSchema`, `CancelPipelineSchema`, `UpdatePipelineProgressSchema`; in `begin-work.ts`: `BeginWorkSchema`) to enumerate all 6 canonical pipeline types in canonical order. These annotations surface directly in MCP JSON Schema to AI clients, so the previous 4-type strings were incorrect hints to agents.

**Files:** `mcp-server/src/tools/pipeline.ts`, `mcp-server/src/tools/begin-work.ts`

### WP-002 — `checkRevalidationGuard` `activeStages` forwarding fix

Fixed a one-token bug in `workflow-helpers.ts` (~line 209): `getUpstreamTypes(pipelineType)` was called without forwarding `activeStages`, causing the revalidation guard to silently produce false negatives for custom-stage WPs (e.g., those including `security-audit` or `release-engineering`). The fix passes `activeStages ?? DEFAULT_PIPELINE_STAGES` to preserve backward compatibility for standard WPs.

A regression test in `workflow-helpers.test.ts` validates a 5-stage custom WP where `security-audit` rework correctly invalidates a prior `code-review` PASS.

**Files:** `mcp-server/src/utils/workflow-helpers.ts`, `mcp-server/tests/utils/workflow-helpers.test.ts`

### WP-003 — `ResetReworkCountSchema` `PipelineTypeEnum` migration

Replaced the hardcoded 4-type `.enum(['implementation','qa','code-review','documentation'])` in `ResetReworkCountSchema.pipeline_type` with `PipelineTypeEnum`, which covers all 6 canonical types. Required adding `PipelineTypeEnum` to the `pipeline-maps` import in `work-package.ts` (the plan incorrectly assumed it was already present — see [Plan Accuracy](#plan-accuracy-observations) below).

**Files:** `mcp-server/src/tools/work-package.ts`

### WP-004 — `getOrderedActiveStages` helper extraction

Introduced `getOrderedActiveStages(activeStages: readonly PipelineType[]): PipelineType[]` in `pipeline-maps.ts`, exported after `resolveFailAgent`. Replaced all 5 external `CANONICAL_PIPELINE_ORDERING.filter()` call sites:

| File | Call site |
|------|-----------|
| `pipeline.ts` line ~46 | `buildCompletionGuidance` |
| `pipeline.ts` line ~473 | `completePipeline` handler |
| `workflow-next-action.ts` line ~871 | Reviewer action |
| `workflow-next-action.ts` line ~1241 | Release Engineer action |
| `workflow-next-action.ts` line ~1445 | Documentation action |

The 4 internal `CANONICAL_PIPELINE_ORDERING.filter()` calls inside `pipeline-maps.ts` itself were correctly preserved — replacing them would be self-referential.

**Files:** `mcp-server/src/utils/pipeline-maps.ts`, `mcp-server/src/tools/pipeline.ts`, `mcp-server/src/tools/workflow-next-action.ts`

### WP-005 — Test hygiene

Three mechanical fixes across two test suites:

1. **`pipeline.test.ts`** — Removed a dead-code first `writeWorkPackage` call (4 lines) from the `'rejects pipeline type not in WP active stages'` test.
2. **`pipeline-maps.test.ts`** — Corrected `['qa', 'implementation']` to `['implementation', 'qa']` in the `resolveFailAgent` test fixture; the previous order was canonically invalid per spec §8.1.
3. **`test_graph.py`** — Removed `test_supervisor_node_present` and `test_synthesis_node_present`; both are subsumed by `test_graph_has_nine_nodes`, which performs a set-equality assertion over all 9 node names. Pytest count: 9 → 7.

**Files:** `mcp-server/tests/tools/pipeline.test.ts`, `mcp-server/tests/utils/pipeline-maps.test.ts`, `orchestrator/tests/test_graph.py`

### WP-006 — Manifest documentation (verification)

Verified that both api-surface.md targets were pre-applied by earlier documentation pipelines:

1. `ledger_reset_rework_count` entry (line ~205): 6-type union, no TODO annotations (applied in WP-003 doc pipeline).
2. `getOrderedActiveStages` entry in Pipeline Routing Utilities section (line ~1165): correct signature and two illustrative examples (applied in WP-004 doc pipeline).

No file changes required. All 3 acceptance criteria confirmed met.

---

## Strategic Recommendations (Gold Nuggets)

### 1. `observations.ts` annotation still 4-type — create a follow-up WP

`ledger_add_observation`'s `pipeline_type` `.describe()` annotation (line ~24 in `observations.ts`) still lists only 4 pipeline types. WP-001 correctly scoped it out, but all three pipeline agents (Developer, QA, Reviewer) flagged this as the **only remaining schema annotation inconsistency** in the 6-type model. A small standalone WP to update this annotation would complete the 6-type migration uniformly.

### 2. `.describe()` strings are a manual maintenance risk

Five Zod schemas now correctly enumerate all 6 pipeline types, but these strings are maintained by hand. Every future pipeline addition requires a manual find-and-replace across those schemas. The Reviewer and QA agents independently noted this as a structural limitation. **Recommendation:** introduce a snapshot test or build-time code-gen approach that derives `.describe()` strings from `PIPELINE_TYPES` — eliminating this class of drift permanently.

### 3. Plan accuracy: `PipelineTypeEnum` import assumption

The WP-003 plan stated `PipelineTypeEnum` was "already imported/available" in `work-package.ts`. This was inaccurate — the import had to be added. Separately, WP-004 had two call-site labels incorrect (site 3 attributed to `getDeveloperAction`; site 4 to `getReviewerAction` — both were off by one). While neither impacted implementation outcomes, these inaccuracies cost the Developer diagnostic time. **Recommendation:** PM agents should verify import availability by reading the target file's import block before asserting it in the plan.

### 4. ~~WP provenance comments in code fences break `api-surface.md` style~~ — RESOLVED

The `// WP-003: PipelineTypeEnum now covers all 6 types` inline comment was placed inside a TypeScript code fence in `api-surface.md`. Surrounding entries use trailing prose paragraphs outside the fence for notes. **Recommendation:** adopt a consistent style — prose provenance notes go after the code fence, not inside it. This makes the code fences scannable as pure type signatures.

> **Resolution:** Moot — all WP provenance comments were removed from `api-surface.md` as part of the Recommendation 5 resolution. Constraint 53 prevents their reintroduction.

### 5. ~~Cross-plan WP IDs in `api-surface.md` are ambiguous long-term~~ — RESOLVED

Several entries in `api-surface.md` carry WP ID references (e.g., `WP-006`) that were introduced by earlier plans. A reader unfamiliar with the plan history cannot tell which plan a WP ID refers to. **Recommendation:** adopt a lightweight convention for provenance notes — e.g., `2026-03-14/WP-003` or a short plan-slug prefix. This would make provenance traces unambiguous as the manifest ages.

> **Resolution:** All WP provenance references were stripped from `api-surface.md` entirely. The manifest documents current state, not implementation history — provenance belongs in plan documents, synthesis reports, and changelogs. Constraint 53 ("No Implementation Provenance in Manifest Documents") was added to `constraints.md` to prevent recurrence.

### 6. Pre-applied documentation: signal intent in plan

WP-006 was pre-applied by WP-003 and WP-004 documentation pipelines, leaving it as a pure verification WP. This is efficient but creates a confusing "zero-delta implementation" WP that still requires full pipeline execution. **Recommendation:** tag such WPs in the plan as `[verify-only]` or include an explicit note: "If WP-003/WP-004 doc pipelines complete this ahead of schedule, this WP becomes a verification pass." This reduces agent confusion about why there is no implementation work to do.

---

## Next Steps for Planner / Project Manager

1. **Immediate follow-up:** Open a WP to fix `observations.ts` line ~24 `.describe()` annotation for `ledger_add_observation` — the only remaining 4-type annotation after this session.
2. **Medium-term debt item:** Design a code-gen or snapshot-test approach for `.describe()` string generation from `PIPELINE_TYPES` — eliminates the manual maintenance risk surfaced by WP-001.
3. **PM process improvement:** Add a step to verify import block contents before writing plan assumptions about existing imports.
