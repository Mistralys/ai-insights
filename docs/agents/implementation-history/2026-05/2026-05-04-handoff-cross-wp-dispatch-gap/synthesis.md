# Synthesis Report — Handoff Cross-WP Dispatch Gap

**Project:** `2026-05-04-handoff-cross-wp-dispatch-gap`
**Date:** 2026-05-04
**Status:** COMPLETE
**Work Packages:** 5 / 5 COMPLETE
**Total Pipeline Stages Executed:** 12 (all PASS)
**Spec Version:** 2.4.x → **2.5.0**

---

## Executive Summary

This session closed a structural gap in the MCP server's handoff system where five non-PM agent handoff functions (`getQaHandoff`, `getSecurityAuditorHandoff`, `getReviewerHandoff`, `getReleaseEngineerHandoff`, `getDocumentationHandoff`) returned a bare `WAIT` after completing their role-specific work — even when other READY work packages were available to route to. In multi-WP projects, this caused IDE workflow stalls requiring manual orchestrator intervention.

The fix followed the spec-first mandated workflow in full:

1. **Spec updated first** — five handoff pseudocode blocks in `handoff.md` received the cross-WP dispatch call; Synthesis Handoff corrected from `WAIT` to `COMPLETE`; new §13.5 documenting `findNextReadyDispatch` added.
2. **Edge case documented** — new §21.71 in `edge-cases.md` covers the stall scenario, resolution, self-routing behavior, and the best-effort IDE invariant.
3. **Implementation delivered** — `findNextReadyDispatch()` helper extracted from the PM handoff pattern, inserted as the penultimate step in all five functions. 9 new regression tests added; 1 pre-existing test corrected to match new spec v2.1.0 behavior.
4. **QA validated** — all 1,912 tests pass across 62 test files. Zero regressions.
5. **Code review completed** — one Fix-Forward applied (stale comment at line 403); architecture confirmed sound.
6. **Supporting docs finalized** — Constraint 55 added to `constraints.md`; `api-surface.md` updated with `findNextReadyDispatch` signature + previously missing `getSecurityAuditorHandoff` and `getReleaseEngineerHandoff` stubs; spec README bumped to v2.5.0; `ctx generate` run.

---

## Metrics

| Metric | Value |
|---|---|
| Work packages completed | 5 / 5 |
| Pipeline stages executed | 12 (all PASS) |
| Tests passing (post-implementation) | **1,912 / 1,912** |
| Test files | 62 |
| New regression tests added | 9 |
| Pre-existing tests corrected | 1 |
| Regressions introduced | 0 |
| Reviewer Fix-Forwards applied | 1 |
| Documentation-forward items resolved | 2 |
| Auto-cancelled pipelines (crash recovery) | 1 (WP-005 code-review #1 — no rework counted) |
| Spec version bump | 2.4.x → 2.5.0 |
| Context files regenerated | 31 |

---

## What Was Built

### `findNextReadyDispatch()` — New Shared Helper

Extracted directly from the PM handoff's cross-WP routing pattern into a standalone, reusable function in `workflow-handoff.ts`. The algorithm:

1. **READY scan:** Finds any WP with `status === 'READY'` whose dependencies are not blocked (`!isBlockedByDependencies(wp)`).
2. **Stage routing:** Maps the WP's first active pipeline stage via `PIPELINE_AGENT_MAP[firstActiveStage(wp)]` to the owning agent's ready-status. Self-routing (same agent) is intentionally **not** filtered — the design rationale is IDE auditability and orchestrator alignment.
3. **All-terminal fallback:** If all WPs are terminal and the project is non-empty, returns `READY_FOR_SYNTHESIS`.
4. **Null return:** If no deterministic dispatch is possible (e.g., all remaining WPs are BLOCKED or IN_PROGRESS), returns `null` — caller falls through to `WAIT`.

The `currentRole` parameter is used only for the diagnostic `reason` string and is never a routing filter.

### Five Updated Handoff Functions

All five functions now call `findNextReadyDispatch()` as their penultimate step:

| Function | Location (approx. line) |
|---|---|
| `getQaHandoff` | ~859 |
| `getSecurityAuditorHandoff` | ~1011 |
| `getReviewerHandoff` | ~1169 |
| `getReleaseEngineerHandoff` | ~1251 |
| `getDocumentationHandoff` | ~1358 |

### Synthesis Handoff Spec Fix

The Synthesis Handoff pseudocode in `handoff.md` was corrected from `return WAIT` to `return COMPLETE`, matching the existing implementation (line 63 of `workflow-handoff.ts` already returned `COMPLETE`). The spec was the only divergent artifact.

### Specification Documents Updated

| File | Change |
|---|---|
| `handoff.md` | 5 pseudocode blocks updated; Synthesis COMPLETE fix; §13.5 findNextReadyDispatch algorithm added; Release Engineer asymmetry documented in §13.1 |
| `edge-cases.md` | §21.71 Cross-WP Dispatch from Non-PM Agents added |
| `constraints.md` | Constraint 55 (cross-WP dispatch requirement) added |
| `api-surface.md` | findNextReadyDispatch() signature + algorithm; 5 handoff stubs updated; getSecurityAuditorHandoff + getReleaseEngineerHandoff stubs added (were missing) |
| `README.md` | v2.5.0 changelog entry; version/date bumped |

---

## Strategic Recommendations (Gold Nuggets)

### 1. `getReleaseEngineerHandoff` All-Terminal Scope Asymmetry — Plan a Follow-Up

All four of the other handoff functions use `wpDetails.every(wp => isTerminalStatus(wp.status))` for their all-terminal early-exit. `getReleaseEngineerHandoff` uses `releaseWps.every()` — scoped only to release-stage WPs. This means a project with **zero release-engineering WPs** will not fire the early-exit from `getReleaseEngineerHandoff`, relying on `findNextReadyDispatch`'s all-terminal branch as a safety net.

The safety net works correctly today, but the architectural inconsistency is invisible to future contributors without reading the now-documented design note. **Recommended action:** Harmonize `getReleaseEngineerHandoff`'s all-terminal check to use `wpDetails.every()` in a small follow-up WP, removing reliance on the safety net.

### 2. `getSecurityAuditorHandoff` and `getReleaseEngineerHandoff` Were Missing from `api-surface.md`

These two handoff functions had zero documentation in the internals section of `api-surface.md` prior to this session. This is a documentation health signal: if two of nine handoff functions were missing from the API surface doc, other internal helpers may also be undocumented. **Recommended action:** Audit `api-surface.md` internals for any remaining gaps, especially newer helpers added in the past few specification versions.

### 3. Test Comment Precision — Minor but Worth Noting

In the new cross-WP dispatch describe block, test 3's comment states "isBlockedByDependencies returns true only when status === BLOCKED" as the explanation for why the BLOCKED WP is excluded. This is slightly misleading: `findNextReadyDispatch` filters primarily on `status === 'READY'`, so BLOCKED WPs are excluded before `isBlockedByDependencies` is ever consulted. **Recommended action:** Update the inline test comment to accurately reflect the filtering order — low priority, but important for future test maintainers.

### 4. AC7 Wording Diverges from Actual Test Implementation (WP-005)

WP-005's AC7 reads: *"Test case 9 asserts self-routing: getDocumentationHandoff returns READY_FOR_DOCUMENTATION for a WP with active_pipeline_stages: [documentation]."* The actual test uses `getQaHandoff` with `['qa', 'code-review']` → `READY_FOR_QA`. The test is **correct** per the coverage target in plan.md, but the AC wording is a source of confusion for future contributors. **Recommended action:** Update AC7 wording in `work/WP-005.md` to match the actual test.

### 5. Cross-WP Dispatch Is IDE-Only by Design — Document at the Orchestrator Layer

The `findNextReadyDispatch` mechanism is intentionally a best-effort optimization for IDE runners. The orchestrator handles WAIT via its supervisor polling loop and does not depend on this behavior. This invariant is documented in `edge-cases.md` §21.71 and Constraint 55, but is not yet surfaced in any orchestrator-layer documentation. **Recommended action:** When the orchestrator documentation is next updated, add a callout that cross-WP dispatch is a client-side optimization and orchestrators must not assume it fires.

---

## Next Steps for Planner / Manager

1. **Follow-up WP:** Harmonize `getReleaseEngineerHandoff`'s all-terminal early-exit from `releaseWps.every()` to `wpDetails.every()` (15-minute implementation, low risk).
2. **Audit `api-surface.md` internals** for any other undocumented helpers introduced since the last audit.
3. **Update AC7 wording** in `work/WP-005.md` to match the actual self-routing test (`getQaHandoff` with `['qa', 'code-review']` → `READY_FOR_QA`).
4. **Verify orchestrator documentation** does not inadvertently imply cross-WP dispatch is a guaranteed behavior (it is best-effort / IDE-only).
5. **No immediate regression risk** — all 1,912 tests pass, the implementation follows the established PM handoff pattern exactly, and all five affected functions have been independently reviewed and approved.

---

## Files Modified This Session

| File | WP |
|---|---|
| `mcp-server/docs/agents/workflow-specification/handoff.md` | WP-001, WP-003 |
| `mcp-server/docs/agents/workflow-specification/edge-cases.md` | WP-002 |
| `mcp-server/src/tools/workflow-handoff.ts` | WP-003 |
| `mcp-server/tests/tools/workflow-handoff.test.ts` | WP-003 |
| `mcp-server/docs/agents/project-manifest/constraints.md` | WP-004 |
| `mcp-server/docs/agents/project-manifest/api-surface.md` | WP-004 |
| `mcp-server/docs/agents/workflow-specification/README.md` | WP-003 |
| `.context/mcp-server/workflow-specification.md` | WP-003 |
| `.context/mcp-server/source-tools.md` | WP-003 |
