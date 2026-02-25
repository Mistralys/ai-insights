# Synthesis Report — Orchestrator Smoke-Test Rework 1

**Plan:** 2026-02-25-orchestrator-smoke-test-rework-1  
**Date:** 2026-02-25  
**Status:** COMPLETE ✓  
**Work Packages:** 6 of 6 COMPLETE · 24 pipelines · 0 failures

---

## Executive Summary

This plan executed four phases of targeted improvements to the `orchestrator/` sub-project, acting on strategic recommendations and technical-debt items identified in the previous smoke-test synthesis. All six work packages passed implementation, QA, code-review, and documentation pipelines without regressions. The test suite held stable at **160 passed, 1 skipped** throughout every pipeline in every WP.

**What was built:**

| WP | Title | Outcome |
|----|-------|---------|
| WP-001 | Pre-flight MCP dist freshness guard (`run.sh`) | New executable entry-point added |
| WP-002 | JSONL schema consistency + event-loop cleanup | 3 surgical source changes, schema now correct |
| WP-003 | `wps_completed_this_run` delta counter | New `WorkflowState` field + supervisor accumulation + run-summary output |
| WP-004 | Integration test fixture corrections | `_initial_state()` and `make_mcp_tools()` type annotation fixed |
| WP-005 | README documentation (routing, JSONL schema, runbook) | 3 new sections + stale test names corrected + `.env.example` note |
| WP-006 | Dependency version pins + `requirements.txt` rebuild | `langchain-core>=0.3.45`, `langchain-anthropic>=0.3.10` pinned; `requirements.txt` fully rewritten |

**Files modified (12):**
`orchestrator/run.sh` (new), `orchestrator/src/nodes/__init__.py`, `orchestrator/src/cli.py`, `orchestrator/src/mcp_client.py`, `orchestrator/src/state.py`, `orchestrator/src/supervisor.py`, `orchestrator/tests/test_state.py`, `orchestrator/tests/test_integration.py`, `orchestrator/README.md`, `orchestrator/.env.example`, `orchestrator/pyproject.toml`, `orchestrator/requirements.txt`

---

## Metrics

| Metric | Value |
|--------|-------|
| Work packages completed | 6 / 6 |
| Total pipelines run | 24 (4 per WP) |
| Pipeline failures | 0 |
| Tests passing (consistent across all WPs) | 160 |
| Tests skipped (live test, requires real MCP + LLM) | 1 |
| Test failures | 0 |
| Security issues flagged | 0 |
| Acceptance criteria met | 22 / 22 |
| Blocking issues identified in code-review | 0 |

---

## Aggregate Failures / Blockers

**No blockers, failures, or security concerns were raised across any pipeline.**

All 24 pipelines returned `PASS`. Reviewer findings across all WPs were uniformly non-blocking low-priority improvement suggestions.

---

## Strategic Recommendations — Gold Nuggets

These observations were consistently surfaced by Developer, QA, and Reviewer agents and represent the highest-value follow-up actions.

### Medium Priority

1. **Silent message-empty case in `nodes/__init__.py`** *(WP-002 · developer + reviewer)*  
   `result.get('messages') or []` silently returns an empty string when the Deep Agent produces no messages. This is a quiet swallow of a potentially significant agent failure. **Action:** Add a `logging.warning()` or equivalent when `_msgs` is empty so failures surface in JSONL logs rather than producing a blank `final_content`.

2. **Pydantic V1 shim `UserWarning` on Python 3.14+** *(WP-006 · all four pipelines)*  
   `import langchain_core` triggers `UserWarning: Core Pydantic V1 functionality isn't compatible with Python 3.14 or greater` on every test run (visible in pytest warning summary). This is an upstream `langchain-core` issue; the resolution path is to wait for `langchain-core` to drop the pydantic v1 shim.  
   **Immediate mitigation:** Add `filterwarnings = ["ignore::UserWarning:pydantic.v1"]` to `[tool.pytest.ini_options]` in `orchestrator/pyproject.toml` to suppress cosmetic noise. Remove once the upstream fix lands.

3. **Open-ended `>=` dep specifiers, no upper bounds** *(WP-006 · code-review)*  
   As an application (not a library), the orchestrator is exposed to silent breakage from future `langgraph 2.0`, `langchain-core 2.0`, or `langchain-anthropic 2.0` major-version bumps. **Action:** When approaching production readiness, add compatible-release upper bounds (e.g., `langchain-core>=0.3.45,<2`) on critical runtime dependencies.

### Low Priority

4. **`run.sh` — missing `orchestrate` PATH guard** *(WP-001 · QA + code-review)*  
   `exec orchestrate` in `run.sh` will emit a generic shell "not found" error on a fresh checkout without virtualenv activation. A `command -v orchestrate >/dev/null 2>&1 || { printf '[run.sh] ERROR: activate virtualenv first.\n'; exit 1; }` guard before the `exec` would give contributors a clear actionable error. The README virtualenv note partially mitigates this.

5. **`run.sh` — `find ... | head -1` SIGPIPE risk** *(WP-001 · code-review)*  
   Some `find` implementations emit SIGPIPE noise when piped to `head -1`. Non-critical today; consider `find "$MCP_SRC" -type f -newer "$MCP_DIST_SENTINEL" -print -quit` as a POSIX-safer alternative. Also consider adding `set -u` to `run.sh` alongside the existing `set -e`.

6. **`_initial_state()` dict literal in `test_integration.py`** *(WP-004 · all four pipelines)*  
   The hand-maintained dict literal must be kept manually in sync with `WorkflowState`. **Action:** Replace with a `WorkflowState(**defaults)` factory or a dataclass-based fixture so that mypy/pyright flags missing or renamed fields as type errors at development time rather than silent `KeyError` gaps at test runtime.

7. **`supervisor.py` — pre-compute `new_wps_count` (DRY)** *(WP-003 · code-review)*  
   `state.get('wps_completed_this_run', 0) + wps_done_count` is repeated at all three `Command` return points in the actionable-WP block. Hoisting it to a single `new_wps_count = …` variable before the first return eliminates the copy-paste risk.

8. **`cli.py` — single boolean for `run_end` ternaries** *(WP-002 · code-review)*  
   `result='COMPLETE' if not outside_errors else 'ERROR'` and `level='ERROR' if outside_errors else 'INFO'` are mirrored but inverted. Capturing `success = not outside_errors` once and referencing it for both kwargs improves readability.

9. **`pyproject.toml` — unversioned `langgraph-checkpoint-sqlite`** *(WP-006 · code-review)*  
   The `[checkpoint]` optional group has no version floor for `langgraph-checkpoint-sqlite`. Low risk today (rarely-used optional) but worth adding a floor pin (e.g., `>=2.0`) when the checkpoint feature is actively used.

10. **Future: generate a lock file** *(WP-006 · developer + QA)*  
    `requirements.txt` now mirrors pyproject.toml version floors (a significant improvement over the previous placeholder state). For fully reproducible production builds, generating a `requirements-lock.txt` via `pip freeze` is the logical next step.

---

## Next Steps for Planner / Project Manager

1. **Immediate (one-liner):** Add `filterwarnings = ["ignore::UserWarning:pydantic.v1"]` to `pyproject.toml` `[tool.pytest.ini_options]` — suppresses cosmetic Python 3.14 warning noise in all future test runs. (Recommendation #2)

2. **Small WP:** Add `command -v orchestrate` PATH guard to `run.sh` and add `set -u` to harden the shell entry-point. (Recommendations #4 + #5)

3. **Refactor WP:** Replace `test_integration.py`'s `_initial_state()` dict literal with a typed factory to prevent future `WorkflowState` field drift. (Recommendation #6)

4. **Medium WP:** Add `logging.warning()` in `create_stage_node` when `_msgs` is empty so agent-no-message failures surface in JSONL logs. (Recommendation #1)

5. **Monitoring task:** Track `langchain-core` upstream for the pydantic v1 shim removal. Remove `filterwarnings` entry and the README Troubleshooting entry once the upstream fix is available.

6. **Out-of-scope (separate plan):** Ledger `review_exempt` pipeline flag (flagged from prior synthesis as Recommendation #6) — requires MCP server schema changes and remains deferred per the plan's explicit scoping decision.

---

## Plan Completion

All 6 work packages reached `COMPLETE` status. The orchestrator sub-project is in a significantly improved state: the pre-flight guard eliminates stale MCP dist risk, JSONL schema is consistent and documented, the new `wps_completed_this_run` counter gives per-run observability, dependency pins are conservative and explicit, and the README is the most comprehensive it has been with routing diagrams, a full JSONL field reference, and a smoke-testing runbook.
