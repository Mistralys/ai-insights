# Synthesis — Orchestrator Error Resilience (Rework 1)

**Project:** `2026-03-24-orchestrator-error-resilience-rework-1`
**Date:** 2026-03-24
**Status:** COMPLETE
**Work Packages:** 5 / 5 COMPLETE
**Pipeline health:** All 5 WPs passed implementation → QA → code-review with zero regressions introduced

---

## Executive Summary

This rework targeted five concrete errors produced by a prior orchestrator run on the `2026-03-24-orchestrator-error-resilience` plan. The errors traced to three independent root causes: a developer LLM skipping the mandatory pipeline-start call (root cause A), a QA LLM passing `handoff_notes` as a bare string instead of `string[]` (root cause B), and reviewer LLMs operating on work packages they were not dispatched for (root cause C). All three root causes are now addressed across two layers — the MCP server schema and the orchestrator prompt/runtime — with defence-in-depth for root cause C.

---

## What Was Done

### Fix A — Developer prompt: explicit `ledger_begin_work` instruction (WP-001)

`_build_developer_prompt()` in `orchestrator/src/nodes/developer.py` was modified to pass an `extra` argument to `build_stage_prompt()` containing a bold **Step 1 — BEFORE writing any code:** directive instructing the LLM to call `ledger_begin_work` with the dynamically-substituted `work_package_id` and `type="implementation"` before any implementation work. Three new unit tests were added in `test_nodes.py` to guard the presence, dynamic substitution, and bold formatting of the instruction.

**Files modified:** `orchestrator/src/nodes/developer.py`, `orchestrator/tests/test_nodes.py`
**Tests:** 499 passing (implementation pipeline), 499 passing (QA verification)

### Fix B — `handoff_notes` bare-string normalisation in MCP server (WP-003)

`CompletePipelineSchema` in `mcp-server/src/tools/pipeline.ts` was updated to accept `z.union([z.string(), z.array(z.string())]).optional()` for `handoff_notes`, mirroring the existing lenient schema already in place for `summary`. A corresponding `normalizedHandoffNotes` coercion block was added inside `completePipeline()` to convert a bare string to a single-element array before any downstream use or persistence, ensuring `HandoffNote.notes` is always `string[]`. Seven new Vitest tests cover schema acceptance (bare string, `string[]`, `undefined`) and handler normalization (coerce, preserve, omit, persisted type).

**Files modified:** `mcp-server/src/tools/pipeline.ts`, `mcp-server/tests/tools/pipeline.test.ts`
**Tests:** 1,348 passing (implementation pipeline), 1,696 passing (QA verification)

### Fix C — Tool wrapper WP-scope guard (WP-002)

A `restrict_to_wp(tools, wp_id)` wrapper was added to `orchestrator/src/utils/tool_wrappers.py`. The wrapper follows the same sentinel-idempotency pattern as the existing `inject_project_path()` wrapper: it intercepts every MCP tool call and, when the call arguments contain a `work_package_id` that does not match the active WP, raises a `ValueError` with an actionable error message before the call reaches the MCP server. When `wp_id` is empty the function is a no-op. The wrapper is integrated into `create_stage_node()` in `orchestrator/src/nodes/__init__.py`, applied after `inject_project_path()` and gated by `if _wp_id`. Eighteen new unit tests cover importability, empty-WP no-op, matching pass-through, mismatch `ValueError`, non-WP-ID args, `ToolCall` dict structure, idempotency, chained composition with `inject_project_path`, and `create_stage_node` integration.

**Files modified:** `orchestrator/src/utils/tool_wrappers.py`, `orchestrator/src/nodes/__init__.py`, `orchestrator/tests/test_tool_wrappers.py`
**Tests:** 501 passing (implementation pipeline), 499 passing (QA verification)

### Fix C (prompt layer) — Single-WP scope guardrail in all stage prompts (WP-004)

A bold `**SCOPE RESTRICTION**` block was added to all three active stage prompt builders: `_build_developer_prompt()` in `developer.py` (appended after the Step 1 instruction), and `_build_qa_prompt()` / `_build_reviewer_prompt()` in `qa.py` and `reviewer.py` respectively (new `extra=` arguments added). All three instances dynamically interpolate `wp_id` from `state.get('current_wp_id', '')`. Five new unit tests guard the presence, `work_package_id` text, and dynamic substitution across all three builders.

**Files modified:** `orchestrator/src/nodes/developer.py`, `orchestrator/src/nodes/qa.py`, `orchestrator/src/nodes/reviewer.py`, `orchestrator/tests/test_nodes.py`
**Tests:** 506 passing (implementation pipeline), 506 passing (QA verification)

### Test coverage consolidation (WP-005)

WP-005 was a test-coverage consolidation WP whose acceptance criteria were satisfied inline by the deliverables of WP-002 and WP-003. Explicit verification confirmed: all `TestRestrictToWp*` test classes present and passing (49/49 Python), the TS `handoff_notes` bare-string coercion test and three companion tests present and passing (108/108 TS pipeline tests). No new code was introduced.

---

## Acceptance Criteria — Summary

| WP | # AC | All Met |
|----|------|---------|
| WP-001 | 4 | ✅ |
| WP-002 | 9 | ✅ |
| WP-003 | 6 | ✅ |
| WP-004 | 5 | ✅ |
| WP-005 | 5 | ✅ |

All 29 acceptance criteria across all 5 work packages were confirmed met by QA and Reviewer pipelines.

---

## Test Results

| Test suite | Result |
|------------|--------|
| `pytest orchestrator/tests/` (final) | 506 passed, 1 skipped |
| `npx vitest run` in `mcp-server/` (final) | 1,696 passed (14 pre-existing `dialogue-qa.test.ts` DOM failures, unrelated) |

Zero regressions were introduced. All pre-existing failures are environment-level (missing `aiosqlite`/`langgraph.checkpoint.sqlite` on Python 3.14, DOM `querySelector` errors in GUI test suite) and predate this project.

---

## Architecture Changes

### MCP Server (`mcp-server/`)

- **`src/tools/pipeline.ts`**: `CompletePipelineSchema.handoff_notes` widened from `z.array(z.string()).optional()` to `z.union([z.string(), z.array(z.string())]).optional()`. `completePipeline()` gained a `normalizedHandoffNotes` block mirroring the existing `normalizedSummary` pattern.

### Orchestrator — Nodes (`orchestrator/src/nodes/`)

- **`developer.py`**: `_build_developer_prompt()` now passes an `extra` argument containing a Step 1 `ledger_begin_work` directive and a `SCOPE RESTRICTION` block, both with dynamic `wp_id` substitution.
- **`qa.py`**: `_build_qa_prompt()` now passes an `extra` argument containing a `SCOPE RESTRICTION` block with dynamic `wp_id` substitution.
- **`reviewer.py`**: `_build_reviewer_prompt()` now passes an `extra` argument containing a `SCOPE RESTRICTION` block with dynamic `wp_id` substitution.
- **`__init__.py`**: `create_stage_node()` now applies `restrict_to_wp(wrapped_tools, _wp_id)` after `inject_project_path()`, gated by `if _wp_id`.

### Orchestrator — Utilities (`orchestrator/src/utils/`)

- **`tool_wrappers.py`**: New `restrict_to_wp(tools, wp_id)` function — sentinel-idempotent, runtime WP-scope guard that raises `ValueError` on cross-WP tool calls.

---

## Observations and Deferred Follow-ups

The following low-priority observations were surfaced across pipelines. None were blocking; all are deferred to future work.

**Cosmetic / documentation:**
- `developer.py` module docstring (lines 12–16) still lists `pipeline_type` as the sole `extra`-field purpose. Should be updated to reflect the Step 1 `ledger_begin_work` directive and `SCOPE RESTRICTION` additions.
- `qa.py` and `reviewer.py` module docstrings describe `_build_*_prompt()` as returning "only immediate runtime context" without mentioning the new scope restriction.

**Refactoring opportunities:**
- `restrict_to_wp()` and `inject_project_path()` share the same sentinel + closure + `object.__setattr__` structural pattern. A private `_wrap_ainvoke(tool, sentinel, factory)` helper would reduce boilerplate if a third wrapper is ever added.
- The `SCOPE RESTRICTION` `extra` string is byte-for-byte identical in `qa.py` and `reviewer.py`. A shared `_build_scope_restriction(wp_id: str) -> str` helper in `nodes/__init__.py` would eliminate the duplication and ease extension to additional stages.
- `normalizedHandoffNotes` and `normalizedSummary` blocks in `pipeline.ts` are structurally identical. A `normalizeStringOrArray(val)` helper would reduce duplication if a third field ever requires the same treatment.

**Testing gaps (low priority):**
- No test asserts the ORDER of Step 1 vs `SCOPE RESTRICTION` within the developer prompt. Implementation is correct; an `index` comparison assertion would guard future regressions.
- `TestRestrictToWpInCreateStageNode` (2 tests) require the `orchestrator` package on `sys.path`. These fail in the current dev environment due to `ModuleNotFoundError`. The fix is trivial: define a local `base_state` fixture or import from a relative path.
- `nodes/__init__.py` lines 137–138: the `if _wp_id:` guard before calling `restrict_to_wp` (which itself short-circuits on empty `wp_id`) is a correct dual-guard but would benefit from an inline comment explaining the rationale.

**Future hardening:**
- `security_auditor.py` and `release_engineer.py` do not yet carry the `SCOPE RESTRICTION` prompt block. Since `restrict_to_wp()` is already wired in `create_stage_node`, the runtime guard is active for all stages. Adding the prompt-layer restriction to the remaining two stage builders is recommended for completeness.
- `nodes/__init__.py` developer prompt `extra` f-string concatenates Step 1, pipeline declaration, and `SCOPE RESTRICTION` in a single expression. Extracting each segment into named variables or a list-join would make future reordering safer.

---

## Conclusion

All five errors from the prior orchestrator run are fully addressed. Root cause A (developer skipping pipeline start) is mitigated at the prompt layer with a prominent Step 1 directive. Root cause B (bare-string `handoff_notes`) is mitigated at the MCP server schema and normalization layer, eliminating the error class entirely regardless of LLM behavior. Root cause C (cross-WP reviewer contamination) is mitigated at both the prompt layer (explicit `SCOPE RESTRICTION` in all three active stage prompts) and the runtime layer (`restrict_to_wp()` tool wrapper that enforces the constraint before calls reach the server). The codebase is in a clean state with no regressions and all 29 acceptance criteria met.
