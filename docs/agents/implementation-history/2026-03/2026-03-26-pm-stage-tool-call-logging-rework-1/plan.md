# Plan — PM Stage Tool-Call Logging: Post-Synthesis Rework

## Summary

Address all actionable items identified in the synthesis report for the
`2026-03-26-pm-stage-tool-call-logging` session. Four items span three
priorities: one medium-priority integration test gap in `test_nodes.py`,
one temporary QA artefact to delete, one test-clarity improvement in
`test_logging.py`, and one documentation enhancement in `api-surface.md`.

## Architectural Context

The orchestrator's pipeline stage factory lives in
`orchestrator/src/nodes/__init__.py` → `create_stage_node()`. It applies
four defensive wrappers to MCP tools in this order:

1. `inject_project_path()` — auto-injects `project_path`
2. `restrict_to_wp()` — guards against cross-WP calls
3. `_install_begin_work_tracker()` — records `ledger_begin_work` calls
4. `log_tool_calls()` — emits `tool_call` JSONL events (outermost)

All three public wrappers live in `orchestrator/src/utils/tool_wrappers.py`
and use a sentinel-attribute pattern (`_orig_ainvoke`, `_orig_ainvoke_wp`,
`_orig_ainvoke_log`) for idempotency.

Existing tests:
- `orchestrator/tests/test_tool_wrappers.py` — 34 unit tests for
  `log_tool_calls()` in isolation.
- `orchestrator/tests/test_logging.py` — 12 tests for `tool_call` console
  rendering.
- `orchestrator/tests/test_nodes.py` — 1502 lines covering module structure,
  success paths, error handling, but **no** test verifying `log_tool_calls`
  wiring inside `create_stage_node()`.

## Approach / Architecture

Four independent tasks, no cross-dependencies:

1. **Integration test** — Add a `TestCreateStageNode` class to
   `test_nodes.py` that patches `log_tool_calls` at the module level and
   asserts `create_stage_node()` calls it with the correct `stage`,
   `wp_id`, and `logger` arguments.
2. **Housekeeping** — Delete `orchestrator/_qa_wp002_check.py`.
3. **Test clarity** — Add a variant test in `test_logging.py` where
   `wp_id` and `tool_wp_id` have different values so the assertion
   unambiguously distinguishes the stage-level WP from the tool-level WP.
4. **Documentation** — Add a "How to Write a New Wrapper" section to
   `orchestrator/docs/agents/project-manifest/api-surface.md` codifying
   the sentinel pattern.

## Rationale

- The integration test (item 1) closes the only coverage gap flagged by
  the code reviewer: nothing currently verifies that the factory actually
  wires `log_tool_calls`.
- Deleting the QA artefact (item 2) prevents a stale script from
  confusing future contributors.
- The test-clarity improvement (item 3) makes the existing assertion
  precise rather than coincidentally correct.
- The documentation enhancement (item 4) turns an implicit convention
  (the sentinel wrapper pattern) into an explicit contributor guide,
  reducing the risk of a fourth wrapper violating the pattern.

## Detailed Steps

### Step 1 — Integration test for `log_tool_calls` wiring (Medium)

1. Open `orchestrator/tests/test_nodes.py`.
2. Add a new class `TestCreateStageNodeWiring` (or append to an existing
   integration-test section).
3. Write a test that:
   - Imports `create_stage_node` from `src.nodes`.
   - Patches `src.nodes.log_tool_calls` with a `MagicMock`.
   - Patches `deepagents.create_deep_agent` and
     `deepagents.backends.LocalShellBackend` (as existing tests do).
   - Patches `src.utils.persona.load_persona`.
   - Calls the node function returned by `create_stage_node()`.
   - Asserts `log_tool_calls` was called exactly once.
   - Asserts the positional arguments were:
     `(wrapped_tools_list, stage_name, wp_id, run_logger_instance)`.
4. Add a second test variant for synthesis (empty `wp_id`) to confirm the
   wrapper still fires with `wp_id=""`.
5. Run `python3 -m pytest tests/test_nodes.py -v --tb=short` and verify
   the new tests pass.

### Step 2 — Delete temporary QA artefact (Low)

1. Delete `orchestrator/_qa_wp002_check.py`.

### Step 3 — Disambiguating test in `test_logging.py` (Low)

1. Open `orchestrator/tests/test_logging.py`.
2. In the `tool_call` console-line test class, add a new test method
   `test_tool_call_console_line_distinguishes_stage_wp_id_from_tool_wp_id`.
3. Construct an entry where `wp_id="WP-002"` and `tool_wp_id="WP-007"`.
4. Assert that the rendered line contains both `"WP-002"` and `"WP-007"`
   (or only the correct one depending on the rendering logic), confirming
   each value appears in the expected position.
5. Run `python3 -m pytest tests/test_logging.py -v --tb=short` to verify.

### Step 4 — Sentinel wrapper pattern documentation (Low)

1. Open `orchestrator/docs/agents/project-manifest/api-surface.md`.
2. After the existing `tool_wrappers` subsection, add a new sub-heading:
   **"Writing a New Tool Wrapper"**.
3. Document the canonical pattern:
   - Sentinel attribute naming: `_orig_ainvoke_<suffix>`.
   - Idempotency check: `if not hasattr(tool, sentinel): store original`.
   - Closure default-arg capture for loop variables.
   - `object.__setattr__` for frozen tool objects.
   - Application order: apply last = executes first (outermost).
   - Note the three-wrapper threshold: if a fourth is needed, extract a
     shared `_wrap_ainvoke(tool, sentinel_attr, async_factory)` helper.
4. Keep it concise — a code skeleton + bullet list of invariants.

## Dependencies

- None between steps; all four are independent.

## Required Components

- `orchestrator/tests/test_nodes.py` — modified (Step 1)
- `orchestrator/_qa_wp002_check.py` — deleted (Step 2)
- `orchestrator/tests/test_logging.py` — modified (Step 3)
- `orchestrator/docs/agents/project-manifest/api-surface.md` — modified (Step 4)

## Assumptions

- The `_build_stream_console_line` rendering for `tool_call` events
  includes both `wp_id` and `tool_wp_id` when they differ (to be
  verified in Step 3 by reading the implementation).
- The existing test infrastructure in `test_nodes.py` (fake config, patch
  helpers) is sufficient for the new integration test.

## Constraints

- Follow the existing test patterns in `test_nodes.py` (pytest classes,
  `@pytest.mark.parametrize` where appropriate, `AsyncMock` usage).
- Do not modify production source code — this rework is tests +
  documentation only.
- Cross-platform: no hardcoded paths in test fixtures.

## Out of Scope

- Extracting a shared `_wrap_ainvoke` helper (only warranted when a
  fourth wrapper is introduced).
- Modifying the `log_tool_calls()` implementation itself.
- Updating changelogs (no production code changes).

## Acceptance Criteria

1. `python3 -m pytest tests/test_nodes.py -v` passes, including new tests
   that verify `log_tool_calls` is called by `create_stage_node()` with
   the correct arguments.
2. `orchestrator/_qa_wp002_check.py` no longer exists.
3. `python3 -m pytest tests/test_logging.py -v` passes, including a new
   test that uses differing `wp_id` and `tool_wp_id` values.
4. `api-surface.md` contains a "Writing a New Tool Wrapper" section
   describing the sentinel pattern.

## Testing Strategy

- **Step 1:** New pytest async tests in `test_nodes.py` using `unittest.mock.patch`
  to intercept `log_tool_calls` at the module level. Verify call count and
  argument values.
- **Step 3:** New pytest test in `test_logging.py` calling
  `_build_stream_console_line` with a crafted entry dict and asserting on
  the output string.
- All tests run within the existing `python3 -m pytest` harness; no new
  dependencies.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Patching `log_tool_calls` at wrong import path** | The function is imported in `src/nodes/__init__.py` as `from src.utils.tool_wrappers import log_tool_calls` — patch at `src.nodes.log_tool_calls`. |
| **`run_logger` is `None` when `RunnableConfig` is absent** | The node function calls `get_run_logger(config)` which may return `None` in tests. The integration test should either patch `get_run_logger` to return a mock logger, or accept `None` and assert `log_tool_calls` is called with `None`. |
| **Console rendering does not include both WP IDs** | Step 3 must first read the `_build_stream_console_line` implementation to understand the actual format, then write assertions accordingly. |
