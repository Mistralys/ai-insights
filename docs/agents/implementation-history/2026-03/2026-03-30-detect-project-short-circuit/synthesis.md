## Synthesis

### Completion Status
- Status: COMPLETE
- Completed by: Standalone Developer Agent

### Implementation Summary
- Added a short-circuit guard for `ledger_detect_project` at the top of the
  `_wrapped_ainvoke` closure inside `inject_project_path` in
  `orchestrator/src/utils/tool_wrappers.py`.
- When the wrapped tool's name is `ledger_detect_project`, the wrapper returns
  a synthetic JSON response containing `plan_path`, `slug`, and a `note` field —
  without forwarding to the MCP server.
- Added `import json` to `tool_wrappers.py` (previously absent).
- Captured `tool.name` as a default argument `_tool_name` in `_wrapped_ainvoke`,
  following the same closure-capture pattern already used for `_orig` and `_proj`.
- Added 9 new tests in `TestDetectProjectShortCircuit` covering: original ainvoke
  not called, valid JSON returned, `plan_path` correctness, slug derivation (with
  and without trailing slash), ToolCall structure input, non-short-circuited names,
  cwd_path input, and double-wrap idempotency.

### Documentation Updates
- No documentation updates were required because the change is an internal
  orchestrator optimization with no user-visible interface changes, no new
  dependencies, and no behavioral change to the public tool API surface.

### Verification Summary
- Tests run: `python3 -m pytest tests/test_tool_wrappers.py -v --tb=short`
- Static analysis run: not applicable (no linter configured for orchestrator;
  `ruff` is a dev dependency but no `ruff check` command is defined in the project)
- Result: **109 passed, 0 failed, 1 warning** (pre-existing Pydantic v1/Python 3.14
  deprecation warning unrelated to this change)

### Code Insights
- [low] (improvement) `orchestrator/src/utils/tool_wrappers.py`: The module-level
  docstring describes the `inject_project_path` design notes but does not mention
  the short-circuit behavior added here. A single sentence under the design notes
  section ("When the tool name is `ledger_detect_project`, a synthetic response is
  returned immediately without an MCP round-trip.") would keep the docstring
  accurate. **DONE** — sentence added to the design notes section.
- [low] (debt) `orchestrator/src/utils/tool_wrappers.py`: The `_READ_ONLY_TOOLS`
  frozenset already includes `ledger_detect_project`, which exempts it from the WP
  guard. The short-circuit in `inject_project_path` is additive and correct, but
  a future developer scanning the exemption list may not immediately connect the
  two places where this tool receives special treatment. A brief inline comment on
  the `_READ_ONLY_TOOLS` entry (e.g. `# also short-circuited by inject_project_path`)
  would make the connection explicit. **DONE** — inline comment added.
- (improvement) `orchestrator/src/utils/tool_wrappers.py`: The synthetic response
  format (`plan_path`, `slug`, `note`) mirrors the `FOUND` branch of the real
  `detectProject` MCP tool. If the PM agent's downstream logic ever requires the
  `title` or `status` fields from the real response, those can be added to the
  synthetic payload without any schema changes. **DONE** — `title` and `status`
  fields added to the synthetic response; tests updated accordingly.
