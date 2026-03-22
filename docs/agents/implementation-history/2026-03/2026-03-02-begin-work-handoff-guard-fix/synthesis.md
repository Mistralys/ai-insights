# Project Synthesis Report

**Plan:** 2026-03-02-begin-work-handoff-guard-fix
**Date:** 2026-03-02
**Status:** COMPLETE
**Work Packages:** 3 / 3 COMPLETE

---

## Executive Summary

This session fixed a critical cross-agent handoff bug in `ledger_begin_work`: the IN_PROGRESS guard was rejecting legitimate pipeline-type owners (e.g., the QA agent claiming a `qa` pipeline on a Developer-assigned WP), blocking the standard 7-stage workflow at every agent transition.

Three targeted fixes were applied to `mcp-server/`:

1. **Guard relaxation (begin-work.ts):** The IN_PROGRESS branch now accepts two conditions — the WP's current assignee OR the legitimate pipeline-type owner per `PIPELINE_AGENT_MAP`. The compound check is minimal, spec-compliant (§9.1/§16.5), and introduces no security regression (the pipeline-start phase's own `PIPELINE_AGENT_MAP` validation provides defence-in-depth).

2. **Performance improvement (workflow-next-action.ts):** `getProjectManagerAction` gained an optional `preloadedWpDetails` parameter with null-coalescing fallback, eliminating a redundant `Promise.all` disk fetch on every PM-role `get_next_action` call.

3. **Style consistency (workflow-next-action.ts):** `getSynthesisAction()` extracted as a named helper, matching the pattern of all other agent-role helpers in the file.

---

## Metrics

| Metric | Value |
|---|---|
| Work Packages | 3 / 3 COMPLETE |
| Pipelines | 12 / 12 PASS |
| Tests Passed | 986 |
| Tests Failed | 0 |
| New Tests Added | 3 (cross-agent handoff) + 1 (narrowed rejection test) |
| Test Files | 33 |
| TypeScript Build | Clean (`tsc` zero errors) |

### Files Modified

| File | Change |
|---|---|
| `mcp-server/src/tools/begin-work.ts` | Compound IN_PROGRESS guard (assignee OR pipeline-type owner) |
| `mcp-server/src/tools/workflow-next-action.ts` | `getProjectManagerAction` optional `preloadedWpDetails`; `getSynthesisAction()` extracted |
| `mcp-server/tests/tools/begin-work.test.ts` | 3 new cross-agent handoff tests; narrowed rejection test |
| `mcp-server/docs/agents/project-manifest/api-surface.md` | `ledger_begin_work` IN_PROGRESS guard; `getSynthesisAction`; `getProjectManagerAction` signature |
| `mcp-server/docs/agents/project-manifest/constraints.md` | New §62: `ledger_begin_work` IN_PROGRESS Guard Accepts Pipeline-Type Owners |
| `mcp-server/changelog.md` | v1.8.1 entry (Fixed, Changed, Tests) |

---

## Strategic Recommendations (Gold Nuggets)

### 1. PIPELINE_AGENT_MAP bypass is auto-extensible
The ownership-guard pattern in `begin-work.ts` is keyed off `PIPELINE_AGENT_MAP`. Adding a new pipeline type automatically inherits the cross-agent handoff guard with zero additional code. This extensibility should be documented as a constraint/design principle so future contributors don't re-engineer it.

### 2. Live meta-validation of the fix
The code-review pipeline itself was blocked by the exact bug under review, then unblocked after restarting the stale MCP server. This is the strongest possible integration test: a real agent running the fixed tool against a live ledger. Consider using this pattern proactively — exercise `ledger_begin_work` end-to-end as a post-deploy smoke test rather than relying solely on unit tests.

---

## Observations & Non-Blocking Improvements

| Priority | Observation |
|---|---|
| Low | `getSynthesisAction()` is unexported. Export it if future agents need direct access from outside `workflow-next-action.ts`. |
| Low | `workflow-next-action.ts` lives in `src/tools/`, not `src/utils/`. The QA pipeline referenced the wrong directory. Update any internal agent notes that point to `utils/`. |
| Low | Test fixture `makeRootIndex` + `makeWpDetail` are kept in sync manually. A paired atomic builder helper would reduce setup drift risk in future test additions. |
| Low | MCP server restart required after deployment — the running IDE instance serves pre-fix compiled code until killed and restarted. This is expected behavior for a compiled MCP server; no code change needed. |
| Low | `getSynthesisAction()` is missing a `// private` or `// internal` annotation in `api-surface.md`. Adding a visibility qualifier would help agents distinguish it from exported functions. |

---

## Next Steps

1. **Deploy:** Ensure the MCP server is rebuilt (`npm run build` in `mcp-server/`) and the IDE restarts the server process to pick up the fix. The old error message `"Only the assigned agent may start..."` will persist until the server is restarted.

2. **Verify end-to-end:** Run a full 7-stage workflow from Planning through Synthesis on a real project. The fix enables automatic handoffs; confirm all 6 agent transitions succeed with `ledger_begin_work`.

3. **Planner consideration:** Review whether `PIPELINE_AGENT_MAP` extensibility should be elevated to a formal constraint (constraints.md) or architectural principle (tech-stack.md) now that the pattern is proven.
