## Synthesis

### Completion Status
- Status: COMPLETE
- Completed by: Standalone Developer Agent

### Implementation Summary
- Added `_make_tool_response()` helper to `tool_wrappers.py` that conditionally wraps content strings in `ToolMessage` when a `tool_call_id` is present in the input dict (LangGraph ToolNode path), preserving plain string returns for flat dict callers (backward compatibility).
- Fixed the `inject_project_path` short-circuit for `ledger_detect_project` — now returns `ToolMessage(status="success")` when called via ToolNode.
- Fixed the `restrict_to_wp` soft-fail return — now returns `ToolMessage(status="error")` when called via ToolNode. Also captured `tool_name` in the closure's default arguments for correct `ToolMessage.name`.
- Updated the module docstring to note langchain-core >= 1.2.x / LangGraph >= 1.0.x compatibility requirement.
- Added `from langchain_core.messages import ToolMessage` import (runtime, not TYPE_CHECKING — needed at runtime for `ToolMessage` construction).

### Documentation Updates
- Updated the `tool_wrappers.py` module docstring to reference the `ToolMessage` wrapping requirement for LangGraph >= 1.0.x compatibility.
- No other documentation updates were required because the change is an internal bug fix — no public API, configuration, or operational behavior changed from the user's perspective.

### Verification Summary
- Tests run: `python3 -m pytest tests/test_tool_wrappers.py` — 125 tests
- Static analysis run: `ruff check src/utils/tool_wrappers.py tests/test_tool_wrappers.py` — 0 new violations (3 pre-existing E501 in untouched test code)
- Result: All 125 tests pass, no new lint issues

### Code Insights
- [low] (improvement) `orchestrator/tests/test_tool_wrappers.py`: Three pre-existing E501 line-too-long violations (lines 832, 1008, 1022) in test code outside the scope of this change. Consider a follow-up pass to wrap these docstrings and assertion messages. **DONE**.
- [low] (convention) `orchestrator/src/utils/tool_wrappers.py`: The `_guarded_ainvoke` closure signature has grown to 7 default-captured parameters. While functional, this pattern could benefit from a small dataclass or named tuple to group the closure state if more parameters are added in the future. **SEPARATE PLAN**.
- [low] (debt) `orchestrator/src/utils/tool_wrappers.py`: The monkeypatch-via-`object.__setattr__` approach for wrapping Pydantic model methods works but is inherently brittle. The plan notes this as out-of-scope for refactoring, but it remains a source of complexity that could be replaced by a proper wrapper class or middleware pattern in a future iteration. **SEPARATE PLAN**.

### Additional Comments
- The `log_tool_calls` wrapper was confirmed as unaffected — it always delegates to the underlying `ainvoke` and never short-circuits, so no changes were needed there.
- The `ValueError` hard-kill path (3rd+ violation in `restrict_to_wp`) was also confirmed unaffected — LangGraph's `_execute_tool_async` catches exceptions and wraps them in `ToolMessage(status="error")` itself, so no change was needed for that path.
