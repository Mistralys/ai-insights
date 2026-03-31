# Project Synthesis Report

**Project:** `2026-03-27-orchestrator-prompt-simplification`
**Date:** 2026-03-27
**Status:** COMPLETE (6/6 WPs)
**Report By:** Head of Operations (Synthesis)

---

## Executive Summary

This project removed redundant WP-scope directives, pipeline-type instructions, and
begin-work commands from the orchestrator's 6 WP-scoped stage prompt templates. The
agent personas already carry the full workflow logic, and the `restrict_to_wp` /
`inject_project_path` tool wrappers enforce scope programmatically — the duplicated
prompt-level instructions were causing an instruction conflict between the system prompt
and the user-turn prompt, and were hardcoding pipeline-type strings that belong solely
in the MCP server.

**Outcome:** All 6 WP-scoped stage templates (`developer`, `qa`, `reviewer`,
`security_auditor`, `release_engineer`, `docs`) now match the minimal pattern already
used by `synthesis.md` — providing only `project_path` and the `project-path-reminder`
partial. Three now-unused partials were deleted. The `current_wp_id` state field, all
tool wrappers, `supervisor.py`, and `__init__.py` are unchanged.

### Key Deliverables

| Deliverable | Status |
|---|---|
| 6 stage templates simplified to minimal pattern | ✅ Complete |
| 3 redundant partials deleted (`wp-scope-reminder`, `begin-work-developer`, `scope-restriction`) | ✅ Complete |
| 6 node prompt builders cleaned (`wp_id` extraction removed) | ✅ Complete |
| `VARIABLES.md` rewritten + Reviewer Fix-Forward applied | ✅ Complete |
| `scripts/preview-prompts.py` simplified (single-variant, 8 files) | ✅ Complete |
| `dist/stage-prompts/` regenerated (8 clean files, 12 stale files removed) | ✅ Complete |
| Test suite updated and passing (186/186 scoped tests) | ✅ Complete |

---

## Metrics

### Test Results

| Scope | Tests Passed | Tests Failed | Notes |
|---|---|---|---|
| `test_nodes.py` + `test_prompt_renderer.py` (WP-001/WP-005 scope) | 186 | 0 | — |
| Node + supervisor tests (WP-002 QA scope) | 225 | 0 | — |
| `scripts/preview-prompts.py` acceptance checks (WP-003) | 5 | 0 | Manual AC verification |
| Full test suite (WP-006 final integration check) | 629 | 9 | 9 failures are **pre-existing** — see open items |

### Pipeline Health

| WP | Stage | Status | Duration |
|---|---|---|---|
| WP-001 | implementation | PASS | 532s |
| WP-001 | qa | PASS | 207s |
| WP-001 | code-review | PASS | 136s |
| WP-002 | implementation | PASS | 73s |
| WP-002 | qa | PASS | 78s |
| WP-002 | code-review | PASS | 126s |
| WP-003 | implementation | PASS | 60s |
| WP-003 | qa | PASS | 61s |
| WP-003 | code-review | PASS | 71s |
| WP-004 | documentation | PASS | 54s |
| WP-005 | qa | PASS | 205s |
| WP-005 | code-review | PASS | 118s |
| WP-006 | qa | PASS | 130s |

**All 13 pipeline stages passed. Zero regressions introduced.**

### Files Modified

24 files across 5 directories:

- `orchestrator/src/nodes/templates/` — 7 files (6 stage templates rewritten + VARIABLES.md)
- `orchestrator/src/nodes/` — 6 node source files (`*.py`)
- `orchestrator/tests/` — 2 test files (`test_nodes.py`, `test_prompt_renderer.py`)
- `orchestrator/dist/stage-prompts/` — 8 files regenerated, 12 stale files removed
- `scripts/preview-prompts.py` — 1 script simplified

**Files deleted:** 3 partials (`wp-scope-reminder.md`, `begin-work-developer.md`,
`scope-restriction.md`)

---

## Strategic Recommendations ("Gold Nuggets")

### 1. WP-001 Implementation Was Exceptionally Thorough

The Developer completed WP-001 in a single pass that covered the full scope of
WP-002 and WP-003 as well. When the subsequent agents arrived at those WPs, there
was nothing left to implement — only verification. This is a strong signal that
the plan decomposition was correct and the Developer interpreted the intent
precisely. **Future plans should confirm whether dependent WPs can be collapsed
into a single implementation WP when one agent is expected to complete them
sequentially.**

### 2. Fix-Forward Pattern Worked Well

The Reviewer applied 3 Fix-Forward corrections to `VARIABLES.md` during the
WP-001 code-review pass, bringing documentation back into sync without deferring
to a separate documentation task. This prevented a meaningful documentation drift
that QA had already flagged as medium-priority bugs. The pattern of `bug → QA flags
→ Reviewer corrects in-pass` is efficient and should be encouraged.

### 3. Architectural Clarity Gained

Before this change, the same WP-scope constraint was expressed in three places: the
persona system prompt, the `wp-scope-reminder` user-turn partial, and the
`begin-work-developer` partial. Removing the user-turn duplication eliminates the
instruction conflict and establishes a cleaner division of concerns:

- **System prompt (persona file):** Workflow logic, role identity, how to call MCP tools
- **User prompt (stage template):** Contextual anchor only — "here is the project_path"
- **Tool wrappers:** Runtime enforcement of scope

This separation is now consistent across all 8 stages.

### 4. Low-Priority Cleanup Identified (Non-Blocking)

| Item | File | Priority |
|---|---|---|
| Install `aiosqlite` in test environment to restore full green suite | `orchestrator/` env | Medium |
| Clean up `_SLIM_WP_ID` / `expect_wp=True` branch in `test_nodes.py` — the constant is used in `_build_slim_state()` but the assertion branch is unreachable | `orchestrator/tests/test_nodes.py` | Low |
| Add inline comment to `_assert_slim_fields_present(expect_wp=True)` default explaining it is reserved for future stages | `orchestrator/tests/test_nodes.py` | Low |

---

## Open Items

| Item | Priority | Owner |
|---|---|---|
| `test_graph.py` 9 failures: `ModuleNotFoundError: No module named 'aiosqlite'` in Python 3.14 environment. Pre-existing on `HEAD~1` — confirmed via git stash regression check. Unrelated to this project. | Medium | Next sprint |
| `_SLIM_WP_ID` / unreachable `if expect_wp:` branch cleanup | Low | Next sprint |

---

## Next Steps for Planner / Manager

1. **No immediate follow-up work required** — the simplification is complete and
   all acceptance criteria are met.
2. **Environment fix:** Add `aiosqlite` to the orchestrator's test requirements
   (`requirements.txt` / `pyproject.toml`) to restore a fully-green test suite.
   This is a one-line change.
3. **Consider:** Whether the 6 now-identical stage templates should be consolidated
   into a single shared template (with stage name as the only variable) rather than
   maintained as 6 separate files. Currently each file is 3 lines and byte-for-byte
   identical — this is a maintenance surface risk. Evaluate as a future plan.
4. **Downstream validation:** Verify that orchestrator runs using the simplified
   prompts produce correct agent behaviour (live run against a real plan). This was
   not in scope for this project — the test suite validates prompt structure but not
   agent response quality.
