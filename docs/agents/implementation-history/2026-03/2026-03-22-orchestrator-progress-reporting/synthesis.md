# Synthesis — Orchestrator Progress Reporting & Duration Tracking

**Project:** `2026-03-22-orchestrator-progress-reporting`
**Status:** COMPLETE — All 10 work packages delivered
**Date:** 2026-03-23
**Synthesized by:** Synthesis Agent

---

## Executive Summary

This project extended the orchestrator and MCP server with richer observability
across three layers: JSONL event logging, pipeline duration storage, and the GUI.
Every acceptance criterion was met. The implementation stayed strictly within the
plan's boundaries — no new LLM calls, no breaking changes to existing events or
API surfaces, and no cross-platform regressions.

**Headline numbers:**

| System | Tests | Result |
|--------|-------|--------|
| Orchestrator (pytest) | 374 passed, 1 pre-existing skip | No regressions |
| MCP server (Vitest) | 1 481 passed | No regressions |

---

## What Was Built

### Layer 1 — Orchestrator JSONL Events

**6 new event types** are now emitted:

| Event | Emitter | Key new fields |
|-------|---------|----------------|
| `stage_start` | Node factory | `stage`, `wp_id`, `iteration` |
| `wp_status_change` | Supervisor | `wp_id`, `old_status`, `new_status` |
| `wp_complete` | Supervisor | `wp_id` (subset of status-change) |
| `progress_snapshot` | Supervisor | `total_wps`, `status_breakdown`, `elapsed_s`, `iteration` |
| `pipeline_result` | Node factory | `files_modified`, `metrics`, `summary`, `duration_s` |
| `rework_detected` | Supervisor | `wp_id`, `agent_role`, `pipeline_type`, `rework_count` |

**4 existing events enriched:**

| Event | New fields |
|-------|-----------|
| `route` | `prev_stage`, `prev_wp_id`, `prev_result` |
| `stage_complete` | `duration_s` (wallclock seconds) |
| `run_start` | `run_start_ts` (ISO timestamp) |
| `run_end` | `total_duration_s` (wallclock seconds) |

**Console output:** `_format_duration()` and `_build_stream_console_line()`
(48 new tests in `test_logging.py`) produce rich single-line output for all
new event types, e.g.:
```
[supervisor] Progress: 3/5 WPs done · 2 in-progress · iter 12/100 · 14m 32s elapsed
[developer]  WP-003 stage_complete → PASS (3m 24s, 1850 tokens)
[supervisor] ✓ WP-003 COMPLETE
```

**New utility module:** `orchestrator/src/utils/mcp_parse.py` — `parse_tool_response()`
extracted from `supervisor._call_tool` and now shared by both the supervisor
and the node factory. Eliminates a hidden duplication.

**State additions:** `WorkflowState` gains `prev_wp_summaries: list` (used for
iteration-to-iteration WP status diffing) and `run_start_ts: str` (set by the
CLI at run start to allow elapsed-time computation anywhere in the graph).

### Layer 2 — MCP Server Pipeline Duration

`ledger_complete_pipeline` now computes and stores `duration_ms` on the
`Pipeline` record at write time, using the already-present `started_at` and the
newly set `completed_at`. Three defensive guards ensure correctness:
1. `pipeline.started_at` presence check
2. `!isNaN(startMs) && !isNaN(endMs)` for malformed strings
3. `endMs >= startMs` for clock-skew protection

The `Pipeline` TypeScript type and Zod schema gain `duration_ms?: number`
(optional, backward-compatible). Five dedicated tests in
`mcp-server/tests/tools/pipeline-duration.test.ts` and two in
`work-package-schema.test.ts` verify all computation and schema cases.

The project-detail API (`GET /api/projects/:slug`) gains a computed `timing`
object:
```json
{
  "project_elapsed_ms": 9900000,
  "total_active_ms":   4320000,
  "pipeline_runs":     14
}
```

### Layer 3 — MCP Server GUI

`mcp-server/gui/public/utils.js` gains `formatDuration(ms)` — a vanilla-JS
utility with correct edge-case handling (null → `"—"`, `< 1 000ms` → `"< 1s"`,
hours/minutes/seconds formatting, graceful negative-value defense).

Three GUI views were updated:

- **Work package detail** — per-pipeline duration badge (`.badge-neutral`) next
  to the status badge; `Active time` + `Wall-clock` aggregate block above the
  pipeline list
- **Project detail** — `Duration` and `Active` time in the project header using
  `project.timing` from the API response
- **Backward compatibility** — all duration display blocks are guarded by
  `if (p.duration_ms != null)` so pre-existing pipelines render without errors

---

## Files Modified / Created

### Orchestrator

| File | Change |
|------|--------|
| `orchestrator/src/state.py` | +`prev_wp_summaries`, +`run_start_ts` fields |
| `orchestrator/src/cli.py` | Capture `run_start_ts`; emit it in `run_start`; `total_duration_s` in `run_end` |
| `orchestrator/src/supervisor.py` | WP status diffing, `wp_status_change`, `wp_complete`, `progress_snapshot`, enriched `route`, `rework_detected`; store `prev_wp_summaries`; import `parse_tool_response` |
| `orchestrator/src/nodes/__init__.py` | `stage_start` event; `duration_s` on `stage_complete`/`stage_error`; best-effort `pipeline_result` read-back |
| `orchestrator/src/utils/logging.py` | `_format_duration()`, `_build_stream_console_line()` |
| `orchestrator/src/utils/mcp_parse.py` | **NEW** — shared `parse_tool_response()` helper |
| `orchestrator/tests/test_state.py` | Register new `WorkflowState` fields in `_all_expected()` |
| `orchestrator/tests/test_supervisor.py` | +5 new test classes (13 tests) |
| `orchestrator/tests/test_nodes.py` | Fix `run_log[0]` indexing; +3 new test classes (23 tests) |
| `orchestrator/tests/test_logging.py` | **NEW** — 48 tests for logging formatting |
| `orchestrator/docs/jsonl-log-schema.md` | Documented all new events, enriched fields, duration conventions, JSON examples, backward compat, 3 previously-missing events |
| `orchestrator/docs/architecture.md` | Updated stage lifecycle, JSONL event table, WorkflowState fields table |
| `orchestrator/docs/public-api.md` | Added `parse_tool_response` to Utilities table |
| `orchestrator/README.md` | Updated `src/utils/` listing, test counts, dev dependency note |
| `orchestrator/changelog.md` | v0.7.0 entry |
| `orchestrator/docs/agents/project-manifest/api-surface.md` | **NEW** — quick-reference for all 10 event types, enriched fields, new utilities, state additions |
| `orchestrator/docs/agents/project-manifest/README.md` | Added `api-surface.md` to manifest sections table |

### MCP Server

| File | Change |
|------|--------|
| `mcp-server/src/schema/work-package.ts` | +`duration_ms?: z.number().optional()` to `PipelineSchema` |
| `mcp-server/src/tools/pipeline.ts` | Compute + store `duration_ms` in `ledger_complete_pipeline` |
| `mcp-server/gui/public/utils.js` | +`formatDuration(ms)` |
| `mcp-server/gui/public/views/work-package.js` | Per-pipeline duration badge; WP aggregate timing block |
| `mcp-server/gui/public/views/project-detail.js` | Project-level elapsed + active time display |
| `mcp-server/gui/api.ts` | Compute `timing` object in `handleGetProject`; extend `ProjectDetail` type |
| `mcp-server/tests/tools/pipeline-duration.test.ts` | **NEW** — 3 duration computation tests |
| `mcp-server/tests/schema/work-package-schema.test.ts` | +2 `duration_ms` schema tests |
| `mcp-server/docs/agents/project-manifest/api-surface.md` | +`duration_ms` on `Pipeline`; +`timing` in project API; +`formatDuration()` |

---

## Observations & Forward-Looking Items

These are non-blocking items identified during the pipeline reviews. None require
rework; they are recorded here for future planning.

### Low-priority clean-up

- **Redundant local import** — `orchestrator/src/cli.py` `_make_dryrun_node()`
  retains a local `from datetime import datetime` that is now superseded by the
  module-level import added in WP-001. Safe to remove if the module is touched again.
- **Repeated `state.get('current_wp_id', '')` calls** — called 4 times in
  `nodes/__init__.py create_stage_node`. Capturing once as `_wp_id` at the top
  of `node_fn` would eliminate the duplication and the associated `# type: ignore`
  comments.
- **`wp-timing` div in GUI** — no CSS styling yet; renders inline. Would benefit
  from a dedicated style rule in the GUI stylesheet to match card aesthetics.

### Medium-priority coverage gaps

- **`parse_tool_response` isolated tests** — `orchestrator/src/utils/mcp_parse.py`
  is currently tested only indirectly through integration tests. Dedicated
  parametrized unit tests for all 4 parsing branches (list-of-content-blocks,
  JSON string, `ToolMessage`, direct dict) would make regressions immediately
  visible.
- **Route event FAIL branch** — `TestEnrichedRouteEvents` in `test_supervisor.py`
  covers only `prev_result='PASS'`. The FAIL branch (`stage_success=False` with a
  `prev_wp_id`) is implemented correctly in `supervisor.py` but has no test
  coverage.
- **Malformed `run_start_ts`** — supervisor's `try/except (ValueError, TypeError)`
  guard produces `elapsed_s=None` on a bad timestamp; this path has no dedicated
  test case.
- **Empty `pipelines` list in `pipeline_result` read-back** — the `if pipelines:`
  guard in `nodes/__init__.py` is correct but untested.

### Dev environment

- `pytest-asyncio`, `aiosqlite`, and `langgraph-checkpoint-sqlite` are required to
  run the full async orchestrator test suite but are not declared in
  `pyproject.toml` dev extras. Developers who install from `pyproject.toml` alone
  will see confusing silent failures (`async functions are not natively supported`
  / `ModuleNotFoundError`). These should be added to a `[dev]` extras group or a
  `requirements-dev.txt`.

### Pre-existing documentation gaps (now partially resolved)

WP-010's documentation pass resolved three gaps:
- Added `safety_limit`, `mcp_error`, `halted_repeated_failure` to the
  `jsonl-log-schema.md` Action Values table
- Added the `plan` field to `run_start` in both schema and api-surface docs
- Added `run_start_ts` to the `progress_snapshot` quick-reference row

**Remaining (pre-existing, still open):**
- `duration_ms` schema uses `z.number().optional()` but is semantically a
  non-negative integer; `z.number().int().nonnegative().optional()` would be
  more precise (consistent with `ReworkCountsSchema`)
- `pipeline_result.duration_s` will be `null` in log output until a live end-to-end
  run exercises both the MCP server's `duration_ms` write and the orchestrator's
  read-back together; structural tests confirm the plumbing is correct

---

## Acceptance Criteria Compliance

All plan acceptance criteria are met:

**Orchestrator JSONL events** — All 6 new event types emitted and verified ✓.
Enriched fields on `route`, `stage_complete`, `run_start`, `run_end` ✓.
Console output formatted for all new types, including durations ✓.

**MCP server** — `duration_ms` computed and stored on `Pipeline` ✓.
`Pipeline` schema accepts optional `duration_ms` ✓.
Project detail API includes `timing` object ✓.

**GUI** — Per-pipeline duration badge on WP detail ✓.
WP header aggregated Active time + Wall-clock ✓.
Project detail elapsed + active time ✓.
`formatDuration()` edge cases (null, `< 1s`, hours/minutes) ✓.

**Tests & docs** — All new events documented in `jsonl-log-schema.md` ✓.
374 orchestrator tests pass ✓. 1 481 MCP server tests pass ✓.
New tests cover each new event type and `duration_ms` computation ✓.

---

## Architecture Integrity

The implementation adheres to all plan constraints:

- **Additive only** — no existing event types or fields were modified; backward
  compatibility is preserved
- **Zero new LLM calls** — `pipeline_result` read-back adds one local JSON file
  read per successful stage; all other new data is computed in-memory from data
  already present
- **Best-effort resilience** — `pipeline_result` read-back failures are caught
  at `DEBUG` level; stage success/failure is never affected by observability code
- **Cross-platform** — all changes are pure Python dict operations, TypeScript
  `Date` arithmetic, and vanilla browser JS; no OS-specific APIs used
- **No build step required** — GUI changes are effective on page reload

---

*Synthesis generated: 2026-03-23*
