# Project Synthesis — Handoff Active-Stage Scoping

**Plan:** `2026-04-10-handoff-active-stage-scoping`
**Date:** 2026-04-10
**Status:** COMPLETE
**Work Packages:** 8 / 8 COMPLETE
**Total Duration:** ~54 minutes (16:40 → 17:34 UTC)

---

## Executive Summary

This session fixed a correctness bug in `mcp-server/src/tools/workflow-handoff.ts`: the five
get-handoff functions (`getDeveloperHandoff`, `getQaHandoff`, `getReviewerHandoff`,
`getDocumentationHandoff`, `getProjectManagerHandoff`) were evaluating pipeline state against
**all WPs** regardless of whether those WPs actually participate in that pipeline stage. WPs
with a custom `active_pipeline_stages` subset (e.g. a documentation-only WP, or a QA +
code-review-only WP) were therefore routed incorrectly.

The fix applies a consistent **scope-filter pattern** to each handler: a named `xyzWps` array
filters `wpDetails` to WPs whose `active_pipeline_stages` (falling back to
`DEFAULT_PIPELINE_STAGES`) includes the relevant stage. All pipeline-specific logic derives from
the scoped set; terminal/fallback checks remain unscoped. Eight WPs covered the test helper
foundation, four handler fixes, one complex handler rewrite (documentation), a PM routing
correction, end-to-end integration tests, and a final build + full-suite validation.

---

## Metrics

| Dimension | Value |
|-----------|-------|
| Tests — before | 1,743 |
| Tests — after | **1,750** (+7 new integration tests) |
| Tests failed | **0** |
| Build (`npm run build`) | **Clean** (tsc, no errors) |
| Acceptance criteria met | **21 / 21 (100%)** |
| All pipelines PASS | **8 / 8** |
| Fix-Forward applied by Reviewer | 1 (WP-006 message string) |
| Rework cycles | 0 |

---

## Work Package Summary

### WP-001 — `makeWp` helper: `active_pipeline_stages` parameter

Extended the `makeWp` test factory in `auto-handoff.test.ts` with an optional 4th param
`active_pipeline_stages?: string[]`. Guard uses `!== undefined` (not falsy), correctly allowing
`[]` as a valid distinct value. Foundational infrastructure for all mixed-composition tests.

### WP-002 — `getDeveloperHandoff` scope filter (`implWps`)

Added `implWps = wpDetails.filter(wp => (wp.active_pipeline_stages ?? DEFAULT_PIPELINE_STAGES)
.includes('implementation'))`. `activeWps` and `nonBlockedWps` now derive from `implWps`.
Terminal check and `READY_FOR_QA` fallback remain on unscoped `wpDetails`.

### WP-003 — `getQaHandoff` scope filter (`qaWps`)

Identical pattern for the `qa` stage. Full derivation chain confirmed:
`qaWps → wpsWithImpl → wpsNeedingNewQa / wpsWithQaInProgress / wpsWithQaFail`. Re-engagement
loop also scoped to `qaWps`.

### WP-004 — `getReviewerHandoff` scope filter (`reviewWps`)

`reviewWps` filter for `code-review`. The inner `reviewActiveStages` computation inside the
re-engagement loop is intentionally retained — it serves the `resolvePrerequisite` call (not
dead code). All pipeline-specific variables derive from `reviewWps`.

### WP-005 — `getDocumentationHandoff` scope filter + dynamic upstream (`docWps`)

Most complex WP. Rewrote the function with:
- `docWps` scope filter
- `hasPassedEffectiveUpstream` local helper encapsulating the **null-prerequisite rule**: when
  `resolvePrerequisite('documentation', activeStages)` returns `null` (no upstream, i.e. a
  documentation-only WP), the check is vacuously `true`
- All hardcoded `code-review` references replaced with `resolvePrerequisite`-based dynamic
  upstream lookup

### WP-006 — PM routing for unassigned READY WPs

Fixed `getProjectManagerHandoff` step 2: unassigned WPs now route via
`readyStatusForAgent(PIPELINE_AGENT_MAP[firstActiveStage(wp.active_pipeline_stages ?? null)])`
instead of the former hardcoded `READY_FOR_DEVELOPER`. A **documentation-only WP** now
correctly generates `READY_FOR_DOCUMENTATION`.

Reviewer applied a Fix-Forward: introduced a `targetAgent` variable to fix a misleading
description message that was hardcoding `"Developer (default)"` for unassigned WPs regardless
of their actual target stage.

### WP-007 — Integration tests (7 new) + api-surface.md update

Added a `"WP-007: Mixed-composition WPs (active_pipeline_stages scoping)"` describe block
to `tests/integration/auto-handoff.test.ts` with 7 focused test cases:

| Test | Scenario |
|------|----------|
| T1 | QA+code-review-only WP — invisible to Developer |
| T2 | Documentation-only WP — `READY_FOR_DOCUMENTATION` from PM |
| T3 | QA-only WP — `READY_FOR_QA` from PM |
| T4 | IN_PROGRESS WP — no `auto_handoff` block |
| T5 | Mixed suite (impl WP + doc-only WP) — Developer sees impl WP only |
| T6 | Full cycle regression for QA+code-review WP |
| T7 | Legacy WP (no `active_pipeline_stages`) — DEFAULT fallback confirmed |

Documentation agent also updated `mcp-server/docs/agents/project-manifest/api-surface.md` with
explicit scope-filter documentation for all five affected handlers and regenerated CTX context
files (`node scripts/cli.js ctx-generate`).

### WP-008 — Final integration validation

End-to-end build + test run: `npm run build` clean, `npm test` → 1750/1750 PASS, 58 test files,
0 regressions. Cross-cutting code review of the full implementation confirmed architectural
soundness and spec compliance.

---

## Strategic Recommendations

### 1. Document `hasPassedEffectiveUpstream` in the Workflow Specification *(medium priority)*

The Reviewer flagged this as a **documentation-forward** item: the inner `hasPassedEffectiveUpstream`
closure in `getDocumentationHandoff` implements the null-prerequisite rule (§13.1 of the
workflow spec). The design decision — inline closure vs. module-level helper, and the vacuously-
true contract for documentation-only WPs — should be documented in
`mcp-server/docs/agents/workflow-specification/` so future maintainers understand the invariant.

### 2. Clean up pre-existing duplicate-key warning in `workflow-next-action.test.ts` *(low priority)*

QA noted two `vite/esbuild` warnings about a duplicate `acceptance_criteria` key at lines 807
and 824 of `workflow-next-action.test.ts`. Pre-existing noise; does not affect test correctness,
but worth removing in a future cleanup pass.

### 3. Harmless dead code in `getProjectManagerHandoff` message string *(low priority)*

`${targetAgent ?? 'Developer'}` — `targetAgent` is always a `string` at this point; the
`?? 'Developer'` fallback can never fire. Consider removing it to avoid misleading future
readers about possible null values.

### 4. Consider extracting a shared `scopeToStage()` helper *(future consideration)*

The `xyzWps = wpDetails.filter(wp => (wp.active_pipeline_stages ?? DEFAULT_PIPELINE_STAGES)
.includes('stage'))` pattern now appears five times. A shared typed helper would reduce
duplication and is natural scope for a future refactor WP.

---

## Files Modified

| File | Change |
|------|--------|
| `mcp-server/src/tools/workflow-handoff.ts` | Scope filters for all 5 handoff functions; PM routing fix |
| `mcp-server/tests/integration/auto-handoff.test.ts` | `makeWp` param + 7 new integration tests |
| `mcp-server/docs/agents/project-manifest/api-surface.md` | Documented scope filters for 5 handlers |
| `.context/mcp-server/manifest.md` | Regenerated CTX snapshot |

---

## Next Steps

1. **Planner/PM:** The `hasPassedEffectiveUpstream` documentation-forward item is a good
   candidate for a small follow-up WP targeting the Workflow Specification agent.
2. **Developer:** Pre-existing duplicate-key warning in `workflow-next-action.test.ts` can be
   addressed opportunistically in the next maintenance pass.
3. **No blocking issues.** The implementation is spec-compliant, fully tested, and backward
   compatible. The project is ready to ship.
