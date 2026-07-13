## Synthesis

### Completion Status
- Date: 2026-07-13
- Status: COMPLETE
- Completed by: Standalone Developer Agent
- Archived in Ledger: 2026-07-13

### Outcome Summary

Added a `skip_tools` parameter (type `frozenset[str]`, default `frozenset()`) to `PathNormalizationMiddleware` that short-circuits path rewriting for named tools. In `create_stage_node`, the skip set is derived dynamically from the `mcp_tools` objects (`frozenset(t.name for t in mcp_tools)`) so every MCP tool — present and future — is automatically excluded without any manual list maintenance. This fixes the root cause of the PM stage loop observed in the `2026-07-13-improved-dialogue-render` orchestrator run, where `ledger_initialize_project` received a virtual `/docs/agents/plans/…` path instead of the absolute host path.

### Implementation Summary

- Added `skip_tools: frozenset[str] = frozenset()` keyword-only parameter to `PathNormalizationMiddleware.__init__`; stored as `self._skip_tools`.
- Added a short-circuit at the top of `awrap_tool_call`: when `request.tool_call["name"]` is in `self._skip_tools`, the request is forwarded to the handler immediately without any path rewriting.
- Updated the class and module docstrings to document the new parameter and the MCP tool exemption rationale.
- In `create_stage_node` (`orchestrator/src/nodes/__init__.py`): computed `mcp_tool_names = frozenset(t.name for t in mcp_tools)` and passed it as `skip_tools=mcp_tool_names` to the `PathNormalizationMiddleware` constructor. Updated the inline comment to explain the exclusion rationale.

### Documentation Updates

- `orchestrator/docs/agents/project-manifest/constraints.md` §26: Updated the rule to require `skip_tools=mcp_tool_names`, documented the MCP tool exemption, added the "Correct pattern" code example with `skip_tools`, and added a second anti-pattern showing construction without `skip_tools`.

### Verification Summary

- Tests run: `orchestrator/tests/test_path_middleware.py` (46 tests: 41 pre-existing + 5 new `TestSkipTools` cases)
- Static analysis run: `ruff check src/utils/path_middleware.py src/nodes/__init__.py tests/test_path_middleware.py`
- Result: 46/46 PASS — all checks passed, no ruff errors

### Code Insights

- [low] (improvement) `orchestrator/src/utils/path_middleware.py` — ~~`_skip_tools` is a `frozenset` in the signature, which is already immutable, but the guard `request.tool_call.get("name") in self._skip_tools` is called even when `_skip_tools` is empty (the default). A trivial fast-path `if self._skip_tools and …` could eliminate the set-membership check in the common case where no tools are skipped. The gain is negligible at current call volumes but worth noting if the middleware becomes hot.~~ **DONE**

### Additional Comments

- The `frozenset()` default in the `__init__` signature is a mutable-default-argument-style antipattern for mutable defaults, but `frozenset()` is immutable, so sharing the same default instance across all callers is correct and safe in Python.
- The fix naturally extends to subagents: the same `path_middleware` instance (already carrying `skip_tools`) is propagated to every subagent spec via `sub_spec.setdefault("middleware", []).append(path_middleware)` — no additional changes were required for subagent coverage.
