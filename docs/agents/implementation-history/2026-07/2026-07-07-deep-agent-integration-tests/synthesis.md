# Synthesis Report — Deep Agent Integration Tests

**Plan:** `2026-07-07-deep-agent-integration-tests`
**Date:** 2026-07-08
**Status:** COMPLETE — 6/6 WPs, 24/24 pipeline stages PASS

---

## Executive Summary

This project built a complete integration test suite for the orchestrator's **Deep Agent execution
path** — the LangGraph + deepagents pipeline that runs each agent stage. The suite covers the full
chain from the `create_stage_node` → `create_deep_agent` entry points through the tool middleware
wrappers (`inject_project_path`, `restrict_to_wp`, `log_tool_calls`), the post-completion guard,
and the error-rollback path.

Work was organized across six sequential work packages:

| WP | Scope | Tests Added |
|----|-------|-------------|
| WP-001 | Test helpers: `ToolCallableFakeChatModel`, `make_mock_tool()`, `make_ledger_tools()`, `deepagent` pytest marker | 0 (infrastructure only) |
| WP-002 | Config fixtures: `_DeepAgentFakeConfig` in conftest, `_FakeConfig` promotion from `test_nodes.py` | 0 (infrastructure only) |
| WP-003 | Smoke tests: stage node execution + path middleware rewriting | 2 `@deepagent` |
| WP-004 | Middleware tests: `inject_project_path` injection + `restrict_to_wp` cross-WP blocking | 2 `@deepagent` |
| WP-005 | Guard + rollback tests: post-completion WAIT intercept + error rollback with `auto_cancelled=True` | 2 `@deepagent` |
| WP-006 | Live API tests: Developer-stage + PM-stage with real LLM calls | 2 `@live` |

The result is **8 new tests** in `orchestrator/tests/test_deep_agent_integration.py`, a new
`orchestrator/tests/README.md` developer reference, and updated `orchestrator/README.md` and
`orchestrator/docs/agents/project-manifest/file-tree.md` documentation.

---

## Metrics

| Metric | Value |
|--------|-------|
| WPs completed | 6 / 6 |
| Pipeline stages passed | 24 / 24 (implementation + qa + code-review + documentation each WP) |
| Tests added | 8 (6 `@pytest.mark.deepagent`, 2 `@pytest.mark.live`) |
| Total test count | 1107 (up from 1093 baseline, +14 collected) |
| Regressions introduced | 0 |
| Ruff lint violations | 0 (clean throughout) |
| Fix-Forward fixes applied | 2 (see below) |
| Deepagent suite runtime (no API keys) | 1.22 s (AC7 target: < 30 s) |
| Final regression suite | 1099 passed, 5 skipped, 0 failures |

---

## Files Produced

### New files

| File | Purpose |
|------|---------|
| `orchestrator/tests/helpers/__init__.py` | Package init with explicit re-exports for ergonomic imports |
| `orchestrator/tests/helpers/fake_chat_model.py` | `ToolCallableFakeChatModel` — scripted LLM that emits tool calls without an API key |
| `orchestrator/tests/helpers/mock_tools.py` | `make_mock_tool()`, `make_ledger_tools()`, `LEDGER_TOOL_NAMES` factory functions |
| `orchestrator/tests/test_deep_agent_integration.py` | 8 integration tests (6 deepagent + 2 live) |
| `orchestrator/tests/README.md` | Test tier guide, mock tool selection, helpers reference, marks reference, run commands |

### Modified files

| File | Change |
|------|--------|
| `orchestrator/pyproject.toml` | Added `deepagent` pytest marker entry |
| `orchestrator/tests/conftest.py` | Promoted `_FakeConfig`; added `_DeepAgentFakeConfig` |
| `orchestrator/tests/test_nodes.py` | Imports `_FakeConfig` from conftest; removed local class definition |
| `orchestrator/tests/test_tool_wrappers.py` | Added clarifying inline comments to local `_FakeConfig` stubs explaining non-consolidation |
| `orchestrator/README.md` | Updated test counts (1093→1107), added deepagent/live marker docs, LIVE_TEST_MODEL env var, test file table extended |
| `orchestrator/docs/agents/project-manifest/file-tree.md` | Added `helpers/` directory entries; updated test count; added `test_deep_agent_integration.py` row |

---

## Strategic Recommendations (Gold Nuggets)

### 1. `_MockTool` is NOT compatible with `create_deep_agent` — always use `StructuredTool.from_function`

`SubAgentMiddleware` inside `create_deep_agent` constructs a LangGraph `ToolNode` which requires
`BaseTool` instances. Plain Python objects from `make_mock_tool()` / `_MockTool` will fail with a
`ValueError` at runtime. For integration tests that exercise the full deep-agent pipeline,
**always use `StructuredTool.from_function`**. This is now documented in `mock_tools.py` (warning
block) and in `orchestrator/tests/README.md`.

### 2. Two tool patterns for integration tests: count-only vs value-assertion

| Pattern | Mechanism | Use When |
|---------|-----------|----------|
| `_AnyArgsSchema` (no schema fields) | `_to_args_and_kwargs` short-circuits to `**{}` → coroutine receives empty dict | You only need call-count assertions |
| Explicit `param: type` in coroutine signature | LangChain infers a proper one-field schema and forwards the injected value | You need to assert on the value passed to the tool |

Mixing these up produces vacuous green tests. The `tests/README.md` documents both patterns with
examples.

### 3. Deep Agents 0.5.2 propagates `RuntimeError` uncaught from its internal `ToolNode`

The rollback test (`test_error_rollback_cancels_pipeline_through_deep_agent`) relies on a
`RuntimeError` raised by a tool propagating out of Deep Agents' `ToolNode` and reaching
`create_stage_node`'s `except` block. This behavior is **empirically confirmed but not documented**
in Deep Agents' public API. A future release adding `handle_tool_errors=True` to the internal
`ToolNode` would absorb exceptions into `ToolMessage` objects instead, causing the rollback path
to silently stop triggering. The test docstring now includes a version-dependency warning
(`Version dependencies` section).

### 4. `object.__setattr__` bypass is the correct pattern for installing capture wrappers on `StructuredTool`

`StructuredTool` is a Pydantic `BaseModel` subclass — normal attribute assignment goes through
`__setattr__` validation. To install a test capture wrapper at the innermost position in the
middleware chain (below `inject_project_path`, `restrict_to_wp`), use `object.__setattr__` to
overwrite the `ainvoke` method directly. This is consistent with the `_patch_tool` / 
`_install_tracker` patterns already in production `nodes.py`. Works because `StructuredTool` does
not use `__slots__` for `ainvoke`.

### 5. Cross-platform fix applied: `_NoCaptureConfig.workspace_root`

The Reviewer applied a Fix-Forward in WP-002: `_NoCaptureConfig.workspace_root` was a hardcoded
Unix path `Path("/tmp/no-capture-ws")` which violates the workspace Cross-Platform Policy
(AGENTS.md: no hardcoded Unix paths in test fixtures). Replaced with
`Path(tempfile.gettempdir()) / "no-capture-ws"`. This is the correct pattern for all future test
fixtures that need non-existent temporary directories.

---

## Deferred & Follow-Up Items

Items collected from all WP pipeline comments, marked as explicitly deferred or out-of-scope.

### Deferred (intentionally postponed)

| Item | Source | Agent | Priority | Rationale |
|------|--------|-------|----------|-----------|
| Add timeout guard to `test_developer_stage_live` and `test_pm_stage_live` — consider `pytest-timeout` or per-test `asyncio` timeout to prevent indefinite hangs if an LLM call stalls | WP-006 (multiple stages) | QA, Reviewer, Documentation | Medium | Live tests don't run in standard CI; timeout only matters in CI-adjacent usage. Non-blocking for current scope. |
| Add `virtual_mode=False` to `LocalShellBackend(root_dir=None)` in test 2 to suppress `DeprecationWarning` about default changing in deepagents 0.5.0 | WP-003 | QA | Low | Only relevant when upgrading deepagents to ≥ 0.5.0. |
| Extend `LEDGER_TOOL_NAMES` in `mock_tools.py` to include `ledger_initialize_project` and `ledger_create_work_package` | WP-006 | Developer, QA | Low | Only needed if `make_ledger_tools()` is extended for PM-stage fake tests. No current consumers. |
| Tighten `assert len(rf_calls) >= 1` to `== 1` in `test_path_middleware_rewrites_through_deep_agent` | WP-003 | Reviewer | Low | Current assertion is correct for the test's primary purpose (path rewriting). Only relevant if dispatch-count contract needs hardening. |
| Extract `_fake_model._stream()` splitting logic into a shared `_split_and_yield()` helper if more fake model variants are added | WP-001 | Developer | Low | Only worthwhile when a second `FakeChatModel` variant is added. |
| Make `_LiveConfig.workspace_root` an instance attribute (consistent with `_FakeConfig` style) | WP-006 | Developer, QA, Reviewer | Low | Cosmetic consistency only; functionally correct. |
| Run `node scripts/cli.js ctx-generate` before next release to sync `.context/` docs with README/file-tree changes | WP-004 | Documentation | Low | Pre-release hygiene; not blocking. |

### Deferred — Version sensitivity

| Item | Source | Agent | Priority | Rationale |
|------|--------|-------|----------|-----------|
| Monitor Deep Agents release notes for `handle_tool_errors` addition to internal `ToolNode` — if added, `test_error_rollback_cancels_pipeline_through_deep_agent` would silently break | WP-005 (all stages) | Developer, QA, Reviewer | Medium | `RuntimeError` propagation is empirically confirmed for 0.5.2 only. Version-dependency warning documented in test module docstring. |

### Out-of-scope (beyond this plan's boundaries)

| Item | Source | Agent | Rationale |
|------|--------|-------|-----------|
| Consolidation of local `_FakeConfig` stubs in `test_tool_wrappers.py` — these stubs expose `stage_models` as a concrete dict attribute absent from `conftest._FakeConfig`; consolidation would widen the shared interface unnecessarily | WP-002 | Reviewer | Explicitly not consolidated; clarifying inline comments added instead. |
| Resolve 176+ `DeprecationWarning` entries from `langchain_core/callbacks/manager.py` (`asyncio.iscoroutinefunction`) | WP-003 / WP-004 | Multiple | Library-level noise; requires upstream fix or langchain upgrade. |
| Add `_make_project_status_tool` + `_make_read_file_tool` generalization into a single `_make_tool_with_schema` factory | WP-004 | Developer | Minimal duplication at current scale; clarity outweighs DRY benefit. |

---

## Next Steps

1. **Run the deepagent suite** as part of pre-release verification: `pytest -m deepagent` (completes
   in < 2 s, no API key required).
2. **Run live tests** before deploying orchestrator changes that touch `create_stage_node` or model
   resolution: `pytest -m live` (requires `ANTHROPIC_API_KEY` or `GOOGLE_API_KEY`).
3. **Deep Agents version monitoring** — when upgrading deepagents past 0.5.2, check whether
   `test_error_rollback_cancels_pipeline_through_deep_agent` still passes. If `handle_tool_errors`
   is introduced, the rollback test will need a new trigger mechanism.
4. **CTX regeneration** — run `node scripts/cli.js ctx-generate` before the next tagged release to
   pick up the README and file-tree changes from WP-003 through WP-006.
5. **Live test timeouts** — when adding CI-adjacent live test runs, add `pytest-timeout` or a
   per-test `asyncio` timeout to prevent indefinite hangs.
6. **Planner note** — the test infrastructure built here (ToolCallableFakeChatModel, conftest
   config stubs, `tests/helpers/` package) provides the foundation for adding similar integration
   test coverage to other agent stages as they are added to the orchestrator.
