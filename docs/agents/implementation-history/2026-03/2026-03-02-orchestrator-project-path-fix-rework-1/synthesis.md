# Project Synthesis Report

**Plan:** `2026-03-02-orchestrator-project-path-fix-rework-1`  
**Date:** 2026-03-02  
**Status:** COMPLETE  
**Work Packages:** 4 / 4 COMPLETE  

---

## Executive Summary

This cycle addressed the four technical-debt items flagged in the prior session's synthesis (`2026-03-02-orchestrator-project-path-fix`). All changes were surgical, confined to three source files and one documentation file, with zero public-interface changes. A full regression run and a live orchestrator smoke test confirmed the orchestrator remains fully functional after the edits.

**What was built / fixed:**

| WP | Change | Files Modified |
|----|--------|----------------|
| WP-001 | Removed stale `REWORK_QA` entry from `_DISPATCH_ACTIONS` frozenset; added priority-order comment above `_ROLES`; fixed stale README reference | `orchestrator/src/supervisor.py`, `orchestrator/tests/test_supervisor.py`, `orchestrator/README.md` |
| WP-002 | Replaced `MagicMock()` tool stub with `_TrackingTool` plain class in `test_wrapped_tools_injects_project_path_into_calls` — asserting the sentinel is now genuinely load-bearing | `orchestrator/tests/test_nodes.py` |
| WP-003 | Added drift-risk docstring paragraph to `_derive_next_action` helper referencing `mcp-server/src/utils/constants.ts` as the authoritative action vocabulary source | `orchestrator/tests/test_supervisor.py` |
| WP-004 | Full regression validation + live smoke test confirming project_path injection and supervisor routing operate correctly end-to-end | — (no code changes, validation only) |

---

## Metrics

| Metric | Value |
|--------|-------|
| **Tests passed** | 215 |
| **Tests failed** | 0 |
| **Tests skipped** | 1 (`@pytest.mark.live`, pre-existing) |
| **Live smoke test** | PASS — supervisor dispatched `qa` node; `project_path` resolved to workspace root with no missing-parameter errors; MCP server started with 22 tools |
| **Acceptance criteria met** | 16 / 16 (100%) |
| **Pipelines run** | 16 (4 WPs × 4 pipeline types) |
| **Pipeline failures** | 0 |
| **Rework cycles** | 0 |
| **Files modified** | 4 (`supervisor.py`, `test_supervisor.py`, `test_nodes.py`, `README.md`) |

---

## Strategic Recommendations (Gold Nuggets)

### 1 — Forward-Compatibility Guard Is the Right Pattern (WP-001, Code Review)

The existing guard in `supervisor.py` (lines 54–55) treats any unknown `ledger_get_next_action` response as `WAIT` with a warning rather than crashing. This is the correct design for a vocabulary that evolves at the MCP server layer. Future MCP server upgrades adding new action strings will degrade gracefully — no supervisor changes required until the orchestrator team explicitly chooses to handle the new action. **Preserve this guard when refactoring `_route()`.**

### 2 — `_TrackingTool` Is the Canonical Test-Tool Stub Pattern (WP-002, Code Review)

Two sibling tests in `TestToolWrappingInNode` now both use plain-class stubs instead of `MagicMock`. This is the established pattern going forward. Any future test that needs to verify `hasattr(obj, "some_injected_attr")` should use a plain class with a real coroutine — not `MagicMock`, which auto-creates any attribute on lookup and makes such assertions vacuous.

### 3 — Drift-Risk Docstrings Are Minimum-Viable Maintenance Anchors (WP-003)

`_derive_next_action` re-implements ~100 lines of MCP routing logic in test code, creating a latent sync trap. The docstring paragraph is a minimal safeguard. This pattern should be applied to any test helper that shadows live system logic: a one-paragraph drift-risk note naming the canonical source file is enough to prevent silent divergence over time.

---

## Non-Blocking Findings (Housekeeping Backlog)

These were flagged during code review but do not affect correctness or test results. Recommended for a future housekeeping pass:

1. **`seen_inputs` / `_tracking_ainvoke` dead code** (WP-002, Code Review) — These names are defined inside `test_wrapped_tools_injects_project_path_into_calls` but never exercised or asserted. The agent mock returns without invoking any tool, leaving `seen_inputs` permanently empty. Remove them to reduce test-body noise.

2. **Test name misnomer** (WP-004, Code Review) — `test_wrapped_tools_injects_project_path_into_calls` asserts that wrapping happened (sentinel present) but does not verify injection at invocation time — that is the job of the sibling test `test_wrapped_tools_inject_project_path_on_invocation`. Consider renaming to `test_create_stage_node_wraps_tools_with_inject_sentinel` to match its actual scope.

3. **`_ROLES` hoisting** (WP-004, Code Review) — `_ROLES` is a local variable inside `_route()`, recreated on every call, while `_SKIP_ACTIONS` and `_DISPATCH_ACTIONS` are module-level frozensets. Hoisting `_ROLES` to module level would be consistent with the existing pattern (saves a tiny repeated allocation; more importantly, it groups the dispatch vocabulary together for readability).

4. **Drift-risk docstring wording** (WP-004, Code Review) — The paragraph in `_derive_next_action` references `_DISPATCH_ACTIONS` as the MCP server constant name, but the actual constant in `mcp-server/src/utils/constants.ts` is named `AGENT_ACTIONS`. A future maintainer searching `constants.ts` for `_DISPATCH_ACTIONS` will not find it. Tighten the wording: *"Keep this helper in sync with `AGENT_ACTIONS` in `mcp-server/src/utils/constants.ts` (exposed to the orchestrator as `ledger_get_next_action` responses)."*

---

## Next Steps for Planner / Manager

1. **Open housekeeping WPs** for the four non-blocking findings above whenever a maintenance window is available — none are urgent.
2. **Monitor `_DISPATCH_ACTIONS` on future MCP server upgrades** — when a new action is added to `AGENT_ACTIONS` in `mcp-server/src/utils/constants.ts`, update `supervisor.py` and the `_derive_next_action` test helper together in the same PR.
3. **Consider hoisting `_ROLES` to module level** as a low-risk one-line refactoring in a future cleanup PR.
4. **The orchestrator is stable** — no active blockers or known regressions. The live smoke test passed cleanly; the project-path injection flow is fully validated.
