
## Synthesis

### Completion Status
- Status: COMPLETE
- Completed by: Standalone Developer Agent

### Implementation Summary
- Added `_install_complete_pipeline_tracker` to `orchestrator/src/nodes/__init__.py`: wraps `ledger_complete_pipeline`'s `ainvoke` using the same sentinel/idempotency pattern as `_install_begin_work_tracker`. Sets `tracker["completed"] = True` only after a successful call; exceptions leave the flag `False`.
- Added `_install_post_completion_guard` to `orchestrator/src/nodes/__init__.py`: wraps `ledger_get_next_action`'s `ainvoke`. When `completion_tracker["completed"]` is `True`, returns a synthetic `{"action": "WAIT", "reason": "..."}` ToolMessage (using the existing `_make_tool_response` helper, which handles both ToolCall-dict and plain-dict inputs). Delegates transparently when `False`.
- Integrated both wrappers into `create_stage_node`'s `node_fn`: declared `_complete_pipeline_state: dict = {"completed": False}` alongside `_begin_work_state`; both new install calls placed immediately after `_install_begin_work_tracker` inside the `if _wp_id:` guard, before `log_tool_calls` (outermost).
- Suppressed spurious rollback warning: the except-block condition for `ledger_cancel_pipeline` now includes `and not _complete_pipeline_state["completed"]`, skipping cancellation when the pipeline already completed successfully.
- Added `_make_tool_response` to the import line in `nodes/__init__.py` (was not previously imported there).
- Documented constraints 15 and 16 in `orchestrator/docs/agents/project-manifest/constraints.md`: constraint 15 describes the post-completion guard as the authoritative mechanism; constraint 16 explicitly rejects user-turn prompt WP-scoping as an alternative, with rationale and anti-pattern/correct-pattern examples.
- Updated `orchestrator/changelog.md` with v0.14.0 entry.

### Documentation Updates
- `orchestrator/docs/agents/project-manifest/constraints.md`: Added constraints 15 (post-completion guard pattern) and 16 (rejected prompt WP-scoping pattern) under a new "Cross-WP Escape Prevention" section.
- `orchestrator/changelog.md`: Added v0.14.0 entry.

### Verification Summary
- Tests run: `python3 -m pytest tests/test_post_completion_guard.py -v --tb=short` — **22/22 passed**
- Full suite: `python3 -m pytest --tb=short -q` — **701 previously-passing tests still pass; 22 new tests added; 0 regressions**. The 10 pre-existing failures (9 × `ModuleNotFoundError: No module named 'aiosqlite'` in `test_graph.py`; 1 × `test_pm_prompt_has_slim_fields` in `test_nodes.py`) are unrelated to this change.
- Static analysis: No static analysis tool (ruff/mypy) is configured for the CI run on this module; code follows the established patterns in `nodes/__init__.py` exactly.

### Code Insights
- [low] (improvement) `orchestrator/src/nodes/__init__.py` → `_install_begin_work_tracker` / `_install_complete_pipeline_tracker`: Both tracker installers follow an identical sentinel/idempotency pattern with distinct attribute name prefixes (`_bw_*`, `_cp_*`). If a third tracker is needed in the future, extracting a generic `_install_tracker(tools, tool_name, prefix, on_success)` factory would eliminate the duplication. Out of scope for this plan. **DONE**.
- [low] (improvement) `orchestrator/src/nodes/__init__.py` → `_install_post_completion_guard`: The `import json as _json` is a module-level import placed inside the function body to avoid circular imports. Since `json` is stdlib and there is no circular import risk here, moving the import to the module-level import block would be marginally cleaner. Flagging for a future tidy-up pass.
- [low] (debt) `orchestrator/tests/test_graph.py`: 9 tests fail with `ModuleNotFoundError: No module named 'aiosqlite'`. This is a pre-existing environment issue unrelated to this change but worth tracking — the test environment is missing a runtime dependency that prevents graph integration tests from running at all.
- [low] (debt) `orchestrator/tests/test_nodes.py::TestSlimPromptContent::test_pm_prompt_has_slim_fields`: Pre-existing failure (assertion on `project_path` string in prompt output). Not caused by this change.

### Additional Comments
- The wrapper chain in `create_stage_node` now has 6 layers (up from 4). The order is important: `log_tool_calls` must remain the outermost so it captures the agent-supplied arguments before inner layers inject `project_path` / `work_package_id`. The two new wrappers sit inside that outermost layer, which is correct — their interceptions appear in the log as real tool calls.
- By design, both PASS and FAIL pipeline completions trigger the guard (any call to `ledger_complete_pipeline` that doesn't raise). This matches the plan's stated assumption: the supervisor decides whether to re-run the stage; the stage agent must not self-route regardless of pass/fail outcome.
