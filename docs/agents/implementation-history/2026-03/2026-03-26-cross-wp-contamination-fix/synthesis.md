# Project Status Report — Cross-WP Contamination Fix

**Plan:** 2026-03-26-cross-wp-contamination-fix  
**Date:** 2026-03-26  
**Status:** COMPLETE  
**Work Packages:** 3 / 3 COMPLETE  

---

## Executive Summary

This session fixed two root causes of cross-work-package contamination in the orchestrator pipeline:

1. **Deterministic synthesis routing bug (Root Cause 1):** The supervisor failed to clear `current_wp_id` when routing to the synthesis stage, causing `restrict_to_wp` to activate with a stale WP ID and block synthesis from operating project-wide. Fixed by adding `"current_wp_id": ""` to both synthesis routing paths in `supervisor.py`.

2. **LLM prompt scope gap (Root Cause 2):** The docs node (`docs.py`) lacked an explicit `SCOPE RESTRICTION` extra block, leaving it more vulnerable to LLM hallucination of adjacent WP IDs seen in tool responses. Fixed by adding the missing block — matching the pattern already used by `developer.py`, `qa.py`, and `reviewer.py` — and strengthening the shared `_WP_SCOPE_REMINDER` with a concrete negative example about dependency WPs.

3. **Test coverage gap (Root Cause 3):** Existing synthesis routing tests only asserted `goto == "synthesis"` but did not verify `current_wp_id` was cleared. Fixed by augmenting four existing tests and adding two new regression tests specifically targeting the stale-WP-ID clearing behaviour on both synthesis routing paths.

All three work packages completed with PASS across all pipeline stages (implementation → QA → code-review → documentation). All 11 acceptance criteria were met.

---

## Files Modified

| File | Change |
|------|--------|
| `orchestrator/src/supervisor.py` | Added `"current_wp_id": ""` to both synthesis routing `Command` update dicts (all-WPs-terminal path ~line 491; all-roles-WAIT path ~line 683) |
| `orchestrator/src/nodes/__init__.py` | Enhanced `_WP_SCOPE_REMINDER` with a concrete negative example forbidding tool calls targeting dependency WPs |
| `orchestrator/src/nodes/docs.py` | Added `SCOPE RESTRICTION` extra block to `_build_docs_prompt()`, matching `qa.py`, `reviewer.py`, and `developer.py` |
| `orchestrator/tests/test_supervisor.py` | Augmented 4 existing `TestRouteToSynthesis` tests with `current_wp_id == ""` assertions; added 2 new tests (`test_synthesis_all_terminal_clears_stale_wp_id`, `test_synthesis_all_wait_clears_stale_wp_id`) |
| `orchestrator/docs/architecture.md` | Updated WP-scoped template section (two patterns: minimal vs SCOPE RESTRICTION); updated `_WP_SCOPE_REMINDER` description; added `current_wp_id` field to WorkflowState table; added two-layer prompt scope reinforcement strategy explanation |
| `orchestrator/docs/supervisor-routing.md` | Added state-clearing notes after both synthesis routing paths; documented known test coverage gap (now resolved by WP-003) |

---

## Metrics

| Metric | Value |
|--------|-------|
| Tests passed | 577 |
| Tests failed | 9 (pre-existing, unrelated — see below) |
| Tests skipped | 1 |
| Supervisor tests passing | 99 (100% pass rate) |
| New regression tests added | 2 |
| Acceptance criteria met | 11 / 11 |
| Pipeline stages passed | 11 / 11 |
| Work packages complete | 3 / 3 |

**Pre-existing failures:** 9 failures in `test_graph.py` are caused by `ModuleNotFoundError: aiosqlite` in the development environment. These failures existed before this session and are not caused by any change made here.

---

## Strategic Recommendations (Gold Nuggets)

### 1. INCOMPLETE COVERAGE: `security_auditor.py` and `release_engineer.py` still lack per-node SCOPE RESTRICTION blocks
**Priority: Medium**  
The Reviewer identified during WP-002 that the plan's claim "docs.py was the only missing node" was incomplete. `security_auditor.py` (`_build_security_auditor_prompt`, line ~37) and `release_engineer.py` (`_build_release_engineer_prompt`, line ~37) also lack the per-node SCOPE RESTRICTION extra block. They rely only on the `_WP_SCOPE_REMINDER` baseline — which was strengthened in this session, providing partial coverage — but they do not get the node-level reinforcement. This is now documented in `architecture.md` as a known gap.  
**Recommendation:** Create a follow-up work package to add SCOPE RESTRICTION extra blocks to both nodes, fully closing the two-layer prompt coverage gap.

### 2. FRAGILE PATTERN: `base_update` in `supervisor.py` omits `current_wp_id` by default
**Priority: Low**  
`base_update` (~line 320) deliberately omits `current_wp_id`, requiring every routing branch to set the field explicitly. This is correct for the current implementation but is fragile — a future routing branch could forget to include it, reintroducing the same synthesis routing bug. Both QA and the Reviewer independently flagged this.  
**Recommendation:** Add a defensive default of `"current_wp_id": ""` to `base_update`. This would make synthesis-route branches self-correcting against future omissions, with no behaviour change for non-synthesis paths (which set `current_wp_id` to a non-empty value and override the default anyway).

### 3. MAINTAINABILITY: The two synthesis routing paths have divergent update dict structures
**Priority: Low**  
Path 1 (all-WPs-terminal) sets `current_stage` + `run_log`; Path 2 (all-roles-WAIT) also sets `errors`. As the WorkflowState schema evolves, it is easy for one path to diverge from the other unnoticed.  
**Recommendation:** Extract a shared `_build_synthesis_update()` helper or named constant dict to keep both synthesis routing paths structurally in sync. This was flagged by the Developer and confirmed by the Reviewer.

### 4. DEBT: `aiosqlite` not installed in dev environment causes 9 test failures
**Priority: Low**  
The dev environment is missing `aiosqlite`, causing 9 `test_graph.py` failures every test run. This is noise in the test output and risks masking real failures.  
**Recommendation:** Install `aiosqlite` in the dev environment or add it to `requirements.txt` to restore a clean test baseline.

### 5. CLARITY: `test_synthesis_all_wait_clears_stale_wp_id` lacks an explanatory comment
**Priority: Low**  
This test implicitly exercises the WP-cancellation exception path because `ledger_update_work_package_status` is intentionally not provided in `make_mcp_tools()`. Future maintainers may not understand why no cancellation mock is needed.  
**Recommendation:** Add a brief inline comment to the test explaining that the unmocked tool causes the `except` block to fire (gracefully proceeds to synthesis), which is itself part of what the test exercises.

---

## Architectural Insight: Two-Layer Prompt Scope Reinforcement

This session confirmed and documented the two-layer prompting strategy for WP scope enforcement in the orchestrator:

- **Layer 3a (baseline):** `_WP_SCOPE_REMINDER` via `build_stage_prompt()` applies to all six WP-scoped nodes. After WP-002, it now includes a concrete negative example forbidding dependency-WP tool calls.
- **Layer 3b (reinforcement):** Per-node `SCOPE RESTRICTION` extra blocks provide stronger, node-specific emphasis. After this session, `developer.py`, `qa.py`, `reviewer.py`, and `docs.py` all have this layer. `security_auditor.py` and `release_engineer.py` remain on Layer 3a only.

The deliberate duplication (scope stated twice for four nodes) is intentional — redundancy improves LLM instruction-following reliability.

---

## Next Steps

1. **Follow-up WP (Medium):** Add SCOPE RESTRICTION extra blocks to `security_auditor.py` and `release_engineer.py`.
2. **Maintenance (Low):** Add defensive `"current_wp_id": ""` default to `base_update` in `supervisor.py`.
3. **Maintenance (Low):** Extract shared synthesis update helper to keep both routing paths in sync.
4. **Dev environment (Low):** Install `aiosqlite` to clear the 9 pre-existing test failures.
5. **Test clarity (Low):** Add inline comment to `test_synthesis_all_wait_clears_stale_wp_id` explaining the unmocked tool path.
