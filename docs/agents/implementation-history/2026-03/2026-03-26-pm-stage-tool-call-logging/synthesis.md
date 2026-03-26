# Project Status Report — PM Stage Tool-Call Logging

**Plan:** `2026-03-26-pm-stage-tool-call-logging`
**Date:** 2026-03-26
**Status:** COMPLETE
**Synthesis Agent:** Head of Operations (Synthesis v3.5.3)

---

## Executive Summary

This session delivered **tool-call activity logging** to the orchestrator's pipeline stage nodes. Every MCP tool invocation made by any agent stage now emits a `tool_call` JSONL event at `DEBUG` level, including the tool name and the work-package ID the tool targeted. The console renderer displays these as `[stage] 🔧 tool_name (WP-XXX)` lines, giving operators full visibility into which ledger operations each agent is performing in real time.

The implementation spans three layers: a new wrapper function (`log_tool_calls()`), a new console rendering branch, and a one-line wire-up in the stage node factory. All six work packages completed with PASS across every pipeline stage. The orchestrator is released as **v0.11.0**.

---

## What Was Built

| WP | Scope | Outcome |
|----|-------|---------|
| WP-001 | `log_tool_calls()` in `tool_wrappers.py` | New wrapper function — sentinel-idempotent, privacy-safe, emits `tool_call` JSONL events at DEBUG |
| WP-002 | `tool_call` in `_build_stream_console_line()` | `[stage] 🔧 tool_name (WP-XXX)` console line; parenthetical omitted when `tool_wp_id` is empty |
| WP-003 | `jsonl-log-schema.md` | Schema doc updated: new `tool_call` event type with level/privacy rationale and JSON examples |
| WP-004 | Wire-up in `create_stage_node()` | `log_tool_calls()` applied as the outermost wrapper after all existing wrappers |
| WP-005 | Integration QA + code review | Full 572-test suite validated end-to-end; clean code review pass |
| WP-006 | Release engineering | v0.10.0 → v0.11.0 minor bump; changelog entry written |

### Files Modified

- `orchestrator/src/utils/tool_wrappers.py` — `log_tool_calls()` implementation
- `orchestrator/src/utils/logging.py` — `tool_call` console rendering branch
- `orchestrator/src/nodes/__init__.py` — wire-up + corrected inline comment + docstring wrapper-layers section
- `orchestrator/docs/jsonl-log-schema.md` — new event type documentation
- `orchestrator/docs/architecture.md` — updated wrapper chain documentation
- `orchestrator/docs/public-api.md` — API surface update
- `orchestrator/docs/agents/project-manifest/api-surface.md` — tool_wrappers subsection + JSONL event types
- `orchestrator/README.md` — test coverage table update
- `orchestrator/changelog.md` — v0.11.0 entry

---

## Metrics

| Metric | Value |
|--------|-------|
| Tests passed (non-graph) | 572 |
| New tests added | +46 (34 in `test_tool_wrappers.py`, 12 in `test_logging.py`) |
| Tests failed | 0 |
| Security issues | 0 |
| Reviews applied (Fix-Forward) | 1 (WP-004: comment correction, non-behavioral) |
| Coverage gaps identified | 1 (medium — WP-004, see Next Steps) |
| Pre-existing failures | 9 (test_graph.py — `aiosqlite` not installed in env; unrelated) |

---

## Strategic Recommendations

### Gold Nuggets

1. **Sentinel pattern is the right abstraction for tool wrappers.** The `_orig_ainvoke_log` sentinel approach used in `log_tool_calls()` (consistent with `inject_project_path` and `restrict_to_wp`) makes all three wrappers idempotent and stack-safe. This pattern should be codified in the `api-surface.md` as the canonical approach for any future wrapper.

2. **Privacy constraint is architecturally enforced, not just documented.** The implementation captures only `tool.name` and the `work_package_id` from agent-controlled input — never the full argument payload. This is the right default for any observability component operating in multi-agent pipelines where tool arguments may contain sensitive context.

3. **Three wrappers is the natural limit before a shared helper is warranted.** The Reviewer noted this threshold explicitly: if a fourth wrapper is added, a `_wrap_ainvoke(tool, sentinel_attr, async_factory)` helper would eliminate boilerplate. The current three-wrapper structure is clean; the refactor trigger is well-defined.

4. **Outermost-wrapper semantics matter.** The code review on WP-004 caught and corrected a misleading inline comment: as the last-applied wrapper, `log_tool_calls` is the *outermost* wrapper and therefore executes *first* on each tool invocation — before `inject_project_path` or `restrict_to_wp` modify the arguments. This distinction is now accurately documented in the docstring and architecture.md. Future wrapper authors should reason about execution order explicitly.

5. **Canonical application order is now documented in three places.** The chain `inject_project_path → restrict_to_wp → log_tool_calls` is recorded in `api-surface.md`, `architecture.md`, and `public-api.md`. This was identified as a gap early and addressed; it prevents silent misuse by contributors applying wrappers in the wrong order.

---

## Open Items

### Medium Priority

- **Coverage gap (WP-004):** No test in `test_nodes.py` verifies that `log_tool_calls()` is actually wired into `create_stage_node()`. The unit tests cover the function in isolation; a `TestCreateStageNode` integration test asserting that the factory calls `log_tool_calls` once with the correct `stage`/`wp_id`/`logger` arguments is missing. Recommend creating a dedicated QA task targeting `test_nodes.py`.

### Low Priority

- **Housekeeping:** `orchestrator/_qa_wp002_check.py` is a temporary QA artefact from WP-002. Deletion was blocked by workspace policy during the review. Developer should delete this file before committing.
- **Test clarity (WP-005):** `test_ac2_wp_id_included_when_present` in `test_logging.py` asserts `'WP-001' in line` for a case where both `wp_id` and `tool_wp_id` equal `'WP-001'`. The assertion is correct but does not distinguish between the stage-level `wp_id` and the `tool_wp_id` parenthetical. A variant with differing values would make test intent clearer.

---

## Next Steps

| Priority | Action |
|----------|--------|
| Medium | Add `TestCreateStageNode` test to `test_nodes.py` verifying `log_tool_calls` wiring — assert called with correct `stage`, `wp_id`, `logger` |
| Low | Delete `orchestrator/_qa_wp002_check.py` before next commit |
| Low | Add `test_tool_call_console_line_distinguishes_stage_wp_id_from_tool_wp_id` variant to `test_logging.py` |
| Low | Consider a future session to codify the sentinel wrapper pattern in the contributor guide (api-surface.md already covers usage; a "how to write a new wrapper" section would complete it) |

---

## Pipeline Health

All 6 WPs completed PASS across all active pipeline stages. No FAIL pipelines. No blocked work packages. Pipeline health: 6/6 WPs with all stages passing.

```
WP-001: implementation ✓  qa ✓  security-audit ✓  code-review ✓  documentation ✓
WP-002: implementation ✓  qa ✓  code-review ✓  documentation ✓
WP-003: documentation ✓
WP-004: implementation ✓  qa ✓  code-review ✓  documentation ✓
WP-005: qa ✓  code-review ✓
WP-006: release-engineering ✓
```
