# Project Status Report — Orchestrator Resilience Fixes

**Plan:** `2026-03-25-orchestrator-resilience-fixes`
**Date:** 2026-03-25
**Status:** COMPLETE
**Work Packages:** 7 / 7 COMPLETE

---

## Executive Summary

This session delivered a full orchestrator resilience overhaul addressing five distinct failure
modes: orphaned pipelines from agent crashes, stale checkpoint re-entry, cross-WP tool leakage,
GUI reset leaving dangling IN_PROGRESS pipelines, and headless supervisor deadlock when all WPs
hit the circuit-breaker threshold. The work spanned both the MCP server (TypeScript) and the
orchestrator (Python), and was preceded by formal workflow specification additions that now
canonically document the new behaviors.

**Seven work packages were completed across 2 rework cycles.** One QA bounce was recorded (WP-006:
supervisor.py halted-WP cancellation logic was entirely missing from the initial implementation).
All acceptance criteria are met. No critical or high security findings were recorded.

---

## What Was Built

### WP-001 — Workflow Specification: Three New Sections

Added canonical specification for behaviors that existed only in implementation:

- **§12.5 Pipeline Cancellation** (`operations.md`) — Documents `cancelPipeline` / `ledger_cancel_pipeline`,
  including `auto_cancelled` semantics and the rework-budget exclusion filter.
- **§21.68 Orphaned Pipeline Recovery** (`edge-cases.md`) — Agent-crash scenarios, RESUME_OR_CANCEL
  detection, mandatory `auto_cancelled = true` prescription for crash-recovery paths.
- **§16.3c Circuit Breaker Escalation** (`dependencies-and-rework.md`) — Prescribes 3-step headless
  orchestrator behavior on circuit-break: log → cancel halted WPs → proceed to synthesis.

*Note: Two section number deviations from the WP plan were correct developer judgments — §21.67
was already occupied and §16 lives in `dependencies-and-rework.md`, not `auxiliary-systems.md`.*

### WP-002 — GUI Reset Clears Orphaned Pipelines (MCP Server)

Extended `applyProjectReset` in `mcp-server/src/utils/project-reset.ts` to auto-cancel all
`IN_PROGRESS` pipelines before applying the WP status/assignment reset. Sets
`status=FAIL, auto_cancelled=true, completed_at, summary=['Auto-cancelled by project reset']`.
Also extended `analyzeProjectForReset` to report `orphaned_pipeline_count` per WP and
`total_orphaned_pipelines` at project level.

### WP-003 — Cross-WP Tool Guard Hardening (Orchestrator)

Hardened `restrict_to_wp()` in `orchestrator/src/utils/tool_wrappers.py`: absent `work_package_id`
is now auto-injected with the active WP ID (previously passed through silently, allowing accidental
cross-WP tool calls). Explicit wrong WP IDs continue to raise `ValueError`. Added
`_WP_SCOPE_REMINDER` constant to `nodes/__init__.py`; `build_stage_prompt()` appends a CRITICAL
scope line for WP-scoped stages.

### WP-004 — Stale Checkpoint Detection (Orchestrator CLI)

Added three helper functions to `orchestrator/src/cli.py`:

- `_thread_id_exists_in_checkpoint` — stdlib sqlite3 collision check (no LangGraph dep)
- `_mark_run_terminal` — writes `{thread_id}.terminal` marker file after successful run
- `_is_run_terminal` — checks marker before allowing resume

New runs regenerate UUID on collision (up to 5 retries, `log.warning` per retry). Resume of a
terminal checkpoint exits `EXIT_ERROR` with actionable diagnostic message.

### WP-005 — `auto_cancelled` Parameter for `ledger_cancel_pipeline` (MCP Server)

Added optional `auto_cancelled: boolean` (default `false`) to `ledger_cancel_pipeline`. When
`true`, sets `pipeline.auto_cancelled = true` on the affected pipeline, integrating with the
pre-existing `!p.auto_cancelled` rework budget filter in `startPipeline`. Backward compatible via
Zod `.default(false)`. Reviewer applied a Fix-Forward: inline comment explaining why `false` is
intentionally never written to the optional field.

### WP-006 — Orchestrator Resilience: Pipeline Rollback + Halted WP Cancellation

Two interrelated features:

**Pipeline rollback** (`orchestrator/src/nodes/__init__.py`) — `_install_begin_work_tracker` wraps
`ledger_begin_work.ainvoke` to set a per-invocation tracker dict. If the stage crashes after
`begin_work` was called, the error handler automatically calls `ledger_cancel_pipeline` with
`auto_cancelled=True`, emits a `pipeline_rollback` INFO run-log entry, and preserves the original
error if the cancel call itself fails.

**Halted WP cancellation** (`orchestrator/src/supervisor.py`) — After the role-dispatch loop
exhausts with all WPs at the 3-failure circuit-breaker threshold, a new cancellation loop
transitions each non-terminal halted WP to `CANCELLED` (via `ledger_update_work_package_status`,
`agent='Project Manager'`), logs a `halted_wp_cancelled` WARNING run-log entry per WP, and then
routes to synthesis. Failures are swallowed to avoid blocking synthesis dispatch. Already-cancelled
WPs are handled idempotently via `WP_TERMINAL_STATUSES` (extracted to `config.py`).

### WP-007 — Stage Node Rollback: Verification + Documentation

WP-007 was structurally identical to the nodes rollback portion of WP-006. Developer correctly
identified that WP-006's implementation satisfied all 6 WP-007 ACs. Full security audit (0
critical/high/medium) and documentation updates to `orchestrator/docs/architecture.md` (new
"Pipeline Rollback" subsection, stage node lifecycle steps 4 and 7 updated).

---

## Metrics

| Scope | Tests Before | Tests After | New Tests |
|---|---|---|---|
| MCP Server | 1,735 | 1,738 | +3 (pipeline) |
| MCP Server (reset) | 1,735 | 1,741 | +6 (project-reset) |
| Orchestrator (nodes) | 128 | 132 | +4 (TestPipelineRollback) |
| Orchestrator (supervisor) | ~521 | 526 | +5 (TestHaltedWPCancellation) |
| Orchestrator (CLI) | 34 | 46 | +12 (stale checkpoint) |
| Orchestrator (tool_wrappers) | 40 | 50 | +10 (cross-WP guard) |

**Final test counts:** MCP Server 1,738/1,738 PASS; Orchestrator 526/526 PASS (9 pre-existing
`test_graph.py` failures from missing `aiosqlite`/`langgraph.checkpoint.sqlite` deps — unchanged
and unrelated to this project).

**Security:** 0 Critical · 0 High · 1 Medium (WP-003 design edge-case — single-WP-per-tool-instance
invariant documented; not exploitable in current usage) · multiple Low/Info observations.

**Rework cycles:** 1 (WP-006 QA bounce — supervisor.py halted-WP cancellation absent from initial
implementation).

---

## Files Modified

### MCP Server

| File | Change |
|---|---|
| `mcp-server/src/tools/pipeline.ts` | `auto_cancelled` parameter on `cancelPipeline` |
| `mcp-server/src/utils/project-reset.ts` | Orphaned pipeline cleanup in reset path |
| `mcp-server/tests/tools/pipeline.test.ts` | 3 new `auto_cancelled` tests |
| `mcp-server/tests/utils/project-reset.test.ts` | 6 new reset cleanup tests |
| `mcp-server/docs/agents/project-manifest/api-surface.md` | `ledger_cancel_pipeline`, `WpResetDiagnosis`, `ProjectResetDiagnosis` updates |
| `mcp-server/docs/agents/workflow-specification/operations.md` | §12.5 `cancelPipeline` |
| `mcp-server/docs/agents/workflow-specification/edge-cases.md` | §21.68 Orphaned Pipeline Recovery |
| `mcp-server/docs/agents/workflow-specification/dependencies-and-rework.md` | §16.3c Circuit Breaker Escalation |

### Orchestrator

| File | Change |
|---|---|
| `orchestrator/src/supervisor.py` | Halted WP cancellation loop; `WP_TERMINAL_STATUSES` import |
| `orchestrator/src/nodes/__init__.py` | Pipeline rollback; `_STAGE_PIPELINE_TYPE`; `_WP_SCOPE_REMINDER` |
| `orchestrator/src/cli.py` | UUID collision guard; terminal marker; resume guard |
| `orchestrator/tests/test_supervisor.py` | `TestHaltedWPCancellation` (5 tests) |
| `orchestrator/tests/test_nodes.py` | `TestPipelineRollback` (4 tests) |
| `orchestrator/tests/test_cli.py` | 12 new stale checkpoint tests |
| `orchestrator/tests/test_tool_wrappers.py` | 10 new cross-WP guard tests |
| `orchestrator/docs/architecture.md` | Pipeline rollback subsection; JSONL table; stage lifecycle steps |
| `orchestrator/docs/jsonl-log-schema.md` | `pipeline_rollback`, `halted_wp_cancelled` action values |
| `orchestrator/docs/public-api.md` | `restrict_to_wp` utilities entry |
| `orchestrator/docs/agents/project-manifest/api-surface.md` | New event types; `restrict_to_wp` |
| `orchestrator/README.md` | Terminal checkpoint guard subsection |

---

## Strategic Recommendations — Gold Nuggets

### 1. Pre-existing §21.14b Violation (Medium Priority)

The **cancel action path** in `applyProjectReset` (`project-reset.ts`) does **not** auto-cancel
`IN_PROGRESS` pipelines before setting `wp.status = 'CANCELLED'` — violating §21.14b. The reset
path now correctly handles this (WP-002), but the cancel path does not. This is reachable from the
GUI reset modal when a user overrides a suggested 'reset' to 'cancel'.

**Recommended:** Create a focused follow-up WP targeting the cancel action path in `project-reset.ts`.

### 2. WP Planning: Verify Spec Section Numbers Upfront

WP-001's plan specified §21.67 and §16.3 in `auxiliary-systems.md` — both assumptions were wrong
(§21.67 was occupied; §16 doesn't live in that file). This caused development deviations and AC
text corrections. For future spec-work WPs, the PM should grep the target file for occupancy before
assigning section numbers in the plan.

### 3. Three-Sentinel Wrapper Pattern — Approaching Complexity Limit

`orchestrator/src/nodes/__init__.py` now has three separate `object.__setattr__` sentinels
(`_orig_ainvoke`, `_orig_ainvoke_wp`, `_orig_ainvoke_bw`) for `inject_project_path`,
`restrict_to_wp`, and `_install_begin_work_tracker` respectively. This works correctly today but
will become a maintenance burden as more wrappers are added. **Recommended:** A follow-up refactor
WP to unify all tool-level wrappers under a single composable registry.

### 4. `_STAGE_PIPELINE_TYPE` Duplication

The stage→pipeline-type mapping is defined twice: once in `nodes/__init__.py`
(`_STAGE_PIPELINE_TYPE`) and once in `supervisor.py` (the `ROLE_STAGE_MAP`). Both ultimately
derive their values from `shared/workflow-manifest.json`. **Recommended:** Derive from the manifest
at load time (already the canonical source for role/pipeline pairings) to eliminate drift risk when
new roles are added.

### 5. Pre-existing `test_graph.py` Failures (9 tests)

Nine tests in `orchestrator/tests/test_graph.py` fail with `ModuleNotFoundError: aiosqlite` /
`langgraph.checkpoint.sqlite`. These are environment setup failures (missing optional deps), not
code regressions. **Recommended:** Add `aiosqlite` to `requirements.txt` or the optional
`[graph]` extras group and document the install step.

### 6. Missing Observability: Cross-WP Rejection and Rollback Failure Events

Two events currently produce only Python log records (not JSONL run-log entries):
- **Cross-WP tool rejection** — `_guarded_ainvoke` raises `ValueError` silently; no `log.warning`
  before the raise and no run-log entry.
- **Rollback failure** — when `ledger_cancel_pipeline` itself fails, a `log.warning` is emitted but
  no `rollback_fail` run-log entry is written.

Both are observable only via process logs, not the structured JSONL audit trail. **Recommended:**
Add `log.warning` + run-log entry at both sites for end-to-end observability.

### 7. WP-007 Structural Redundancy

WP-007 covered the same feature as WP-006's rollback portion. The Developer correctly identified
the overlap and treated WP-007 as a verification + documentation pass. Future PM planning should
check for feature overlap across WPs before creating separate work packages for the same
implementation target.

---

## Next Steps

1. **Follow-up WP:** Fix §21.14b violation in `applyProjectReset` cancel action path.
2. **Follow-up WP or quick PR:** Add `aiosqlite` / `langgraph.checkpoint.sqlite` to test
   dependencies; resolve the 9 pre-existing `test_graph.py` failures.
3. **Follow-up WP:** Add `log.warning` + run-log entry to cross-WP rejection path in
   `_guarded_ainvoke` (tool_wrappers.py) and rollback failure path in `nodes/__init__.py`.
4. **Future refactor WP:** Unify the three-sentinel wrapper pattern in `nodes/__init__.py` into a
   composable tool-wrapper registry.
5. **PM process improvement:** Add "verify section number availability" step to spec-work WP
   planning checklist.
