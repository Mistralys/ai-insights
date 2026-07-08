# Plan

## Plan Audit Cycles
- Audits: 4 — Plan Auditor v1.5.0
- Architectural Reviews: none — Plan Architect Reviewer v2.0.0

## Prior Project Context

The repository recently completed two projects directly relevant to this plan:

- **2026-07-07-macos-path-middleware**: Extended `PathNormalizationMiddleware` to be cross-platform (active on macOS/Linux, not just Windows). The middleware is now the primary target for integration-level verification through the Deep Agent stack — it is unit-tested (41 tests) but has never been exercised through `create_deep_agent`'s actual middleware pipeline.
- **2026-07-04-path-normalization-middleware**: Original Windows-only implementation. Added 25 unit tests + 1 integration test — but the integration test uses `ScriptedLedger` stubs, not real Deep Agent invocation.

The orchestrator has 988+ fast tests using mock stubs that never invoke `create_deep_agent`. There is a gap: the four tool wrapper layers (`inject_project_path` → `restrict_to_wp` → `begin_work_tracker` → `log_tool_calls`) and the `PathNormalizationMiddleware` have never been exercised through the real Deep Agent middleware pipeline in an automated test.

## Summary

Add a new tier of deterministic integration tests that exercise the orchestrator's Deep Agent pipeline stages end-to-end — including the real `create_deep_agent` call, middleware stack, tool wrapper layers, and stream accumulation — without consuming LLM API tokens. Tests use a custom `ToolCallableFakeChatModel` (subclass of `GenericFakeChatModel`) with scripted `AIMessage` sequences that drive realistic tool-calling loops through the full Deep Agent harness. A secondary tier of `@pytest.mark.live` tests using real LLMs is expanded for manual pre-release smoke testing.

## Architectural Context

The orchestrator's stage execution pipeline flows through these layers:

1. **`create_stage_node()`** ([orchestrator/src/nodes/__init__.py](orchestrator/src/nodes/__init__.py#L752)) — Generic factory that creates a LangGraph node function for each pipeline stage.
2. **Tool wrappers** applied inside `node_fn()` in canonical order:
   - `inject_project_path()` — auto-injects `project_path` into every MCP tool call
   - `restrict_to_wp()` — guards against cross-WP tool calls (soft-fail with 3-strike kill)
   - `_install_begin_work_tracker()` — records `ledger_begin_work` invocations
   - `_install_complete_pipeline_tracker()` — records `ledger_complete_pipeline` success
   - `_install_post_completion_guard()` — returns synthetic WAIT after completion
   - `log_tool_calls()` — outermost wrapper, emits `tool_call` JSONL events
3. **`PathNormalizationMiddleware`** ([orchestrator/src/utils/path_middleware.py](orchestrator/src/utils/path_middleware.py)) — injected via `middleware=` parameter to `create_deep_agent`, rewrites absolute host paths to virtual `/`-rooted paths.
4. **`create_deep_agent()`** (from `deepagents` SDK) — accepts `model`, `backend`, `system_prompt`, `tools`, `subagents`, `middleware`; returns a compiled `StateGraph`.
5. **`_accumulate_stream()`** — runs `agent.astream(stream_mode="messages", subgraphs=True)` and accumulates `AIMessageChunk` fragments.

Existing tests:
- **`test_nodes.py`** — patches `create_deep_agent` at import level; never exercises real middleware.
- **`test_integration.py`** — uses `ScriptedLedger` with lightweight stage-node stubs; never calls `create_deep_agent`.
- **`test_tool_wrappers.py`** — tests wrapper functions in isolation with `_SimpleTool` stubs.
- **`test_path_middleware.py`** — tests `PathNormalizationMiddleware` in isolation (41 tests).
- **`test_post_completion_guard.py`** — tests guard logic in isolation.

The gap: none of these exercise the full stack where `create_deep_agent` processes messages through Deep Agents' internal middleware pipeline (`TodoListMiddleware`, `FilesystemMiddleware`, `SubAgentMiddleware`, `SummarizationMiddleware`, `PatchToolCallsMiddleware`) alongside the orchestrator's `PathNormalizationMiddleware` and tool wrappers.

## Approach / Architecture

### Two-tier test strategy

**Tier 1 — `@pytest.mark.deepagent` (deterministic, no API key):**
Create `ToolCallableFakeChatModel`, a `GenericFakeChatModel` subclass that produces scripted `AIMessage` sequences including `tool_calls` entries. Pass mock MCP tools and `StateBackend` (in-memory). Tests exercise the full `create_deep_agent` → middleware → tool dispatch → stream accumulation path deterministically in ~1–5 seconds per test.

**Tier 2 — `@pytest.mark.live` (real LLM, manual pre-release):**
Expand the existing skeleton to 2 real-LLM smoke tests using mock MCP tools. These run only on-demand (`pytest -m live`) before releases.

### New file structure

- `orchestrator/tests/test_deep_agent_integration.py` — all Tier 1 and Tier 2 tests
- `orchestrator/tests/helpers/fake_chat_model.py` — `ToolCallableFakeChatModel` class (reusable)
- `orchestrator/tests/helpers/__init__.py` — package init

### FakeChatModel design

`ToolCallableFakeChatModel` subclasses `GenericFakeChatModel` with three overrides:

1. **`bind_tools()`** — No-op returning `self` (Deep Agents calls this during construction).
2. **`_generate()`** — Catches `StopIteration` when the scripted iterator is exhausted, returns a terminal text message instead of propagating `RuntimeError: generator raised StopIteration`.
3. **`_stream()`** — When the current message has `tool_calls`, emits a single `AIMessageChunk` with tool calls preserved (the parent's `_stream` drops `tool_calls`). For text-only messages, re-implements the parent's whitespace-splitting loop inline — do NOT call `super()._stream()`, which calls `_generate()` internally and would double-advance the scripted iterator, silently skipping one scripted message; instead split `content` with `re.split(r"(\s)", content)` and yield one `ChatGenerationChunk` per token.

This design has been empirically verified to work with `agent.astream(stream_mode="messages", subgraphs=True)` — the exact streaming path used by `_accumulate_stream`.

## Rationale

- The 988+ existing tests are fast and deterministic but never exercise the real `create_deep_agent` pathway. This leaves a blind spot where regressions in middleware wiring, tool wrapper interaction with the Deep Agent harness, or streaming format changes would go undetected.
- `ToolCallableFakeChatModel` is the minimum viable addition that closes this gap: it produces deterministic outputs, costs zero tokens, needs no API key, and completes in seconds.
- Placing the fake model in a `helpers/` module makes it reusable for future Deep Agent test scenarios.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Fake model approach | `ToolCallableFakeChatModel` (subclass `GenericFakeChatModel`) | `FakeMessagesListChatModel`, `FakeListChatModel`, recording/playback | `FakeMessagesListChatModel` lacks `bind_tools()` (raises `NotImplementedError`); recording/playback has maintenance overhead. `GenericFakeChatModel` inherits `bind_tools` from `BaseChatModel`, requiring only 3 targeted overrides. |
| Test file location | Single `test_deep_agent_integration.py` | Separate files per tier, or adding to `test_integration.py` | Separate file avoids cluttering the existing `ScriptedLedger`-based integration suite; single file keeps related tests discoverable. |
| Mock tool objects | Plain Python objects with `name` + `ainvoke` | `MagicMock`, `_SimpleTool` from `test_tool_wrappers.py` | `MagicMock` breaks sentinel logic (auto-creates attributes); plain objects with async `ainvoke` are minimal and correct. |
| FakeChatModel location | `tests/helpers/fake_chat_model.py` | Inline in test file, conftest fixture | Separate module is cleaner for a ~60-line class that may be reused; avoids conftest bloat. |

## Pattern Alignment

- **Test file naming:** Follows `test_<module>.py` convention in `orchestrator/tests/`. New file `test_deep_agent_integration.py` parallels `test_integration.py`.
- **Config stubs:** `create_stage_node`-based tests (Steps 5, 7, 8, 9, 10) use `_DeepAgentFakeConfig` — a subclass of `_FakeConfig` that overrides `resolve_model_for_stage()` to return the `ToolCallableFakeChatModel` instance instead of a model name string. This is necessary because `create_stage_node` calls `resolve_model_for_stage(stage)` and passes the result to `create_deep_agent(model=…)`; the base `_FakeConfig` returns the string `"claude-test"`, which would trigger real LLM provider resolution and fail without an API key. `_FakeConfig` itself is promoted from `test_nodes.py` to `conftest.py` (with `capture_dialogues=False` to avoid JSONL file I/O during tests — preferred over the existing `_CaptureConfig` which sets `capture_dialogues=True`). `_NoCaptureConfig` is reserved for tests that do not invoke `create_stage_node` (Step 6 only).
- **Persona loading pattern:** The existing `_patch_persona()` context manager in `test_nodes.py` is an alternative approach for bypassing `load_persona`; this plan uses `_DeepAgentFakeConfig` (which inherits `_FakeConfig`'s real `workspace_root`) instead for higher fidelity. Either approach is valid; the choice is consistent with how `test_nodes.py` itself handles persona loading.
- **Mock tool pattern:** Follows the `_SimpleTool` pattern from [orchestrator/tests/test_tool_wrappers.py](orchestrator/tests/test_tool_wrappers.py) — plain Python objects, not `MagicMock`.
- **Marker convention:** Follows the existing `@pytest.mark.integration` and `@pytest.mark.live` patterns in `pyproject.toml`.
- **Helper module (`tests/helpers/`):** New directory. Justified because the `ToolCallableFakeChatModel` is substantial (~60 lines) and reusable; inlining it in the test file or conftest would violate the single-responsibility pattern established by the clean conftest.

## Detailed Steps

### Step 1: Register `deepagent` pytest marker

Add the `deepagent` marker to `orchestrator/pyproject.toml` under `[tool.pytest.ini_options].markers`.

**File:** `orchestrator/pyproject.toml`

**Change:** Add `"deepagent: deep agent integration tests using fake LLM (no API key required)"` to the `markers` list.

### Step 2: Create the `tests/helpers/` package

Create the helper module directory with:
- `orchestrator/tests/helpers/__init__.py` — empty package init
- `orchestrator/tests/helpers/fake_chat_model.py` — `ToolCallableFakeChatModel` class

**`ToolCallableFakeChatModel` specification:**
- Subclasses `langchain_core.language_models.fake_chat_models.GenericFakeChatModel`.
- Does NOT redeclare the `messages` field — inherits `messages: Iterator[AIMessage | str]` from `GenericFakeChatModel`. Callers pass `iter([...])` of `AIMessage` objects at construction: `ToolCallableFakeChatModel(messages=iter([...]))`.
- `bind_tools(*args, **kwargs)` → returns `self` (no-op).
- `_generate(messages, stop, run_manager, **kwargs)` → calls parent `_generate` but wraps it in a try/except to catch `StopIteration` and return a terminal `AIMessage(content="[end of scripted responses]")` wrapped in a `ChatResult`.
- `_stream(messages, stop, run_manager, **kwargs)` → calls `_generate()` once to obtain the next scripted message. If the message has non-empty `tool_calls`, yields a single `AIMessageChunk` with those tool calls preserved. For text-only messages, splits `message.content` with `re.split(r"(\s)", content)` and yields one `ChatGenerationChunk` per token — mirroring the parent's behaviour without calling `super()._stream()` (which calls `_generate()` internally and would double-advance the scripted iterator).

### Step 3: Create mock MCP tool helper

In `orchestrator/tests/helpers/mock_tools.py`, create a factory function that produces mock MCP tool objects matching the tool interface expected by the orchestrator's wrapper layers.

**Specification:**
- `make_mock_tool(name: str, response: str | Callable) -> object` — returns a plain Python object with `.name` attribute and async `.ainvoke()` method.
- `make_ledger_tools(responses: dict[str, str | Callable]) -> list` — returns a list of mock tools for the common ledger tool names (`ledger_begin_work`, `ledger_complete_pipeline`, `ledger_get_next_action`, `ledger_get_project_status`, `ledger_get_work_package`, `ledger_cancel_pipeline`).
- Each mock tool records all invocations in a `.calls` list for assertion.
### Step 4: Promote `_FakeConfig` and add `_DeepAgentFakeConfig` to conftest

Promote the existing `_FakeConfig` class from `test_nodes.py` to `orchestrator/tests/conftest.py` and add a `_DeepAgentFakeConfig` subclass for Deep Agent integration tests.

**`_FakeConfig` promotion:**
- Move the `_FakeConfig` class definition from `test_nodes.py` to `conftest.py`.
- In `test_nodes.py`, remove the local `_FakeConfig` class and replace `FAKE_CONFIG = _FakeConfig()` with an import from `conftest`.
- `_FakeConfig` uses `capture_dialogues=False` to avoid JSONL file I/O during tests (preferred over the existing `_CaptureConfig` which sets `capture_dialogues=True`).

**`_DeepAgentFakeConfig` specification:**
- Subclass of `_FakeConfig`.
- Constructor accepts a `model: BaseChatModel` parameter and stores it.
- Overrides `resolve_model_for_stage(stage: str)` to return the stored model instance instead of the string `"claude-test"`.
- This is necessary because `create_stage_node` calls `resolve_model_for_stage(stage)` and passes the result to `create_deep_agent(model=…)`. The base `_FakeConfig` returns `"claude-test"`, which triggers real LLM provider resolution and fails without an API key.

**Files modified:**
- `orchestrator/tests/conftest.py` — add `_FakeConfig` and `_DeepAgentFakeConfig`
- `orchestrator/tests/test_nodes.py` — remove local `_FakeConfig`, import from `conftest`

### Step 5: Write deepagent test — stage node completes

Test: `test_stage_node_completes_with_fake_model`

**Marker:** `@pytest.mark.deepagent`

**Scenario:** Invoke a real `create_stage_node` (developer stage) with `ToolCallableFakeChatModel` via `_DeepAgentFakeConfig` that returns:
1. `AIMessage` with `tool_calls=[{name: "ledger_begin_work", args: {work_package_id: "WP-001", type: "implementation", agent_role: "Developer"}}]`
2. `AIMessage` with `tool_calls=[{name: "ledger_complete_pipeline", args: {work_package_id: "WP-001", type: "implementation", status: "PASS", summary: "Done", agent_role: "Developer"}}]`
3. `AIMessage(content="Implementation complete.")`

**Assertions:**
- Node function returns a dict with `stage_success=True`.
- The `ledger_begin_work` mock tool recorded exactly 1 call.
- The `ledger_complete_pipeline` mock tool recorded exactly 1 call.

**Implementation notes:**
- Uses `_DeepAgentFakeConfig` constructed with the `ToolCallableFakeChatModel` instance — the config's `resolve_model_for_stage()` returns the fake model object directly, allowing `create_stage_node` → `create_deep_agent(model=…)` to receive a `BaseChatModel` instead of the string `"claude-test"`.
- Constructs a minimal `WorkflowState` dict using the pattern from `test_nodes.py`'s `base_state()`.
- Does NOT patch `create_deep_agent` — this is the point: exercise the real call.

### Step 6: Write deepagent test — PathNormalizationMiddleware rewrites paths

Test: `test_path_middleware_rewrites_through_deep_agent`

**Marker:** `@pytest.mark.deepagent`

**Scenario:** Create a `create_deep_agent` directly (not via `create_stage_node`) with:
- `PathNormalizationMiddleware(root_dir="/Users/dev/project")`
- A fake model that calls a custom mock tool with argument `file_path="/Users/dev/project/src/main.py"`
- A mock tool named `write_file` that records received arguments

**Assertions:**
- The mock tool received `file_path="/src/main.py"` (rewritten by middleware).

**Implementation notes:**
- This test creates `create_deep_agent` directly (not via `create_stage_node`), so no `_DeepAgentFakeConfig` is needed — the `ToolCallableFakeChatModel` instance is passed directly as the `model` parameter.
- A `LocalShellBackend(root_dir=None)` is acceptable since the middleware under test does not interact with backend execution.
- A thread ID must be supplied in the LangGraph `RunnableConfig` for checkpoint state.

### Step 7: Write deepagent test — tool wrappers inject project_path

Test: `test_project_path_injected_through_deep_agent`

**Marker:** `@pytest.mark.deepagent`

**Scenario:** Use `create_stage_node` with mock MCP tools. The fake model calls `ledger_get_project_status` without a `project_path` argument.

**Assertions:**
- The mock tool received `project_path` matching the state's `project_path` value (injected by `inject_project_path` wrapper).

**Implementation notes:**
- Uses `_DeepAgentFakeConfig` constructed with the `ToolCallableFakeChatModel` instance — provides both the real `workspace_root` for persona resolution and the fake model for `create_deep_agent`.

### Step 8: Write deepagent test — restrict_to_wp blocks cross-WP calls

Test: `test_restrict_to_wp_blocks_cross_wp_through_deep_agent`

**Marker:** `@pytest.mark.deepagent`

**Scenario:** Create a stage node with `current_wp_id="WP-001"`. The fake model calls `ledger_begin_work` with `work_package_id="WP-999"` (a cross-WP write attempt). `ledger_begin_work` is a write tool not in `_READ_ONLY_TOOLS`, so `restrict_to_wp` installs a wrapper that intercepts the call.

**Assertions:**
- The mock tool for `ledger_begin_work` was NOT called (the wrapper intercepted it).
- The agent received a soft-fail error response indicating a cross-WP attempt.

**Implementation notes:**
- Uses `_DeepAgentFakeConfig` constructed with the `ToolCallableFakeChatModel` instance — provides both the real `workspace_root` for persona resolution and the fake model for `create_deep_agent`.
- Note: `ledger_get_work_package` is in `_READ_ONLY_TOOLS` and is unconditionally exempt from `restrict_to_wp`; always use a write tool to test this guard.

### Step 9: Write deepagent test — post-completion guard returns synthetic WAIT

Test: `test_post_completion_guard_through_deep_agent`

**Marker:** `@pytest.mark.deepagent`

**Scenario:** Fake model sequence: `ledger_begin_work` → `ledger_complete_pipeline` → `ledger_get_next_action` → final text.

**Assertions:**
- The `ledger_get_next_action` mock's original `ainvoke` was NOT called (the guard intercepted).
- The agent received a response containing `"WAIT"`.

**Implementation notes:**
- Uses `_DeepAgentFakeConfig` constructed with the `ToolCallableFakeChatModel` instance — provides both the real `workspace_root` for persona resolution and the fake model for `create_deep_agent`.

### Step 10: Write deepagent test — error rollback cancels pipeline

Test: `test_error_rollback_cancels_pipeline_through_deep_agent`

**Marker:** `@pytest.mark.deepagent`

**Scenario:** Fake model calls `ledger_begin_work`, then calls a tool that raises an exception.

**Assertions:**
- The `ledger_cancel_pipeline` mock recorded exactly 1 call with `auto_cancelled=True`.

**Implementation notes:**
- Uses `_DeepAgentFakeConfig` constructed with the `ToolCallableFakeChatModel` instance — provides both the real `workspace_root` for persona resolution and the fake model for `create_deep_agent`.

### Step 11: Expand `@pytest.mark.live` tests

In the same `test_deep_agent_integration.py` file, add 2 tests under `@pytest.mark.live`:

**Test 1: `test_developer_stage_live`**
- Uses a real LLM (model from env or `anthropic:claude-sonnet-4-6`).
- Mock MCP tools that return scripted JSON responses.
- Minimal plan with one WP.
- Asserts: at least one `ledger_begin_work` call recorded, no unhandled exception.
- Skips if no API key in environment.

**Test 2: `test_pm_stage_live`**
- Uses a real LLM with mock MCP tools.
- Asserts: at least one `ledger_create_work_package` call recorded.
- Skips if no API key in environment.

### Step 12: Verify all tests pass

Run the full test suite to confirm zero regressions:
```bash
cd orchestrator
pytest tests/ -v
pytest tests/test_deep_agent_integration.py -m deepagent -v
```

## Dependencies

- `deepagents>=0.3` — already in `pyproject.toml` dependencies.
- `langchain-core>=1.2.22` — already in `pyproject.toml` dependencies; provides `GenericFakeChatModel`, `AIMessage`, `AIMessageChunk`.
- No new dependencies required.

## Required Components

### New files:
- `orchestrator/tests/helpers/__init__.py` — empty package init
- `orchestrator/tests/helpers/fake_chat_model.py` — `ToolCallableFakeChatModel` class
- `orchestrator/tests/helpers/mock_tools.py` — mock MCP tool factory
- `orchestrator/tests/test_deep_agent_integration.py` — all deep agent integration tests

### Modified files:
- `orchestrator/pyproject.toml` — add `deepagent` marker
- `orchestrator/tests/conftest.py` — promote `_FakeConfig` (from `test_nodes.py`) as a shared fixture; add `_DeepAgentFakeConfig` subclass that overrides `resolve_model_for_stage()` to return a `ToolCallableFakeChatModel` instance
- `orchestrator/tests/test_nodes.py` — remove local `_FakeConfig` class, replace `FAKE_CONFIG = _FakeConfig()` with import from `conftest.py`

### Existing files referenced (read-only):
- `orchestrator/src/nodes/__init__.py` — `create_stage_node()`, `_accumulate_stream()`, wrapper installation
- `orchestrator/src/utils/path_middleware.py` — `PathNormalizationMiddleware`
- `orchestrator/src/utils/tool_wrappers.py` — `inject_project_path`, `restrict_to_wp`, `log_tool_calls`
- `orchestrator/tests/conftest.py` — `_NoCaptureConfig`, `_StreamCaptureConfig`
- `orchestrator/tests/test_nodes.py` — `_FakeConfig`, `base_state()` (reference pattern)

## Assumptions

- `GenericFakeChatModel` from `langchain_core.language_models.fake_chat_models` is available at `langchain-core>=1.2.22` (already a dependency).
- `create_deep_agent` from `deepagents>=0.3` accepts `BaseChatModel` instances directly (confirmed in research).
- Deep Agents' built-in tools (`write_todos`, `task`, filesystem tools) do not interfere when scripted `tool_calls` reference only explicitly provided mock tools (confirmed in research).
- `create_deep_agent` defaults to an in-memory LangGraph checkpoint backend (`MemorySaver`) when no explicit checkpointer is supplied — no disk I/O for test state. `LocalShellBackend` is the separate filesystem execution backend and does not imply disk-based LangGraph state.
- The `AIMessage.tool_calls` format (`list[dict]` with `name`, `args`, `id`, `type` keys) is stable across langchain-core versions.

## Constraints

- Tests must be cross-platform (macOS, Linux, Windows) per orchestrator constraint §8.
- No hardcoded Unix paths in test fixtures — use `tempfile.mkdtemp()` or `tmp_path` fixture.
- `@pytest.mark.deepagent` tests must not require API keys or network access.
- `@pytest.mark.live` tests must skip gracefully when no API key is available.
- Must use `Optional[RunnableConfig]` annotation, not `RunnableConfig | None`, per constraint §9.
- Must not share state between test invocations — each test creates its own Deep Agent per constraint §7.

## Out of Scope

- Recording/playback infrastructure for LLM responses (Hybrid pattern from research).
- Testing LLM prompt quality or response correctness.
- Testing MCP server subprocess lifecycle (covered by manual smoke testing).
- Modifying any production source code.
- Adding new production dependencies.
- Testing Deep Agents' internal middleware stack (TodoList, Filesystem, etc.) — only the orchestrator's `PathNormalizationMiddleware` injection point.

## Acceptance Criteria

- AC-01: `orchestrator/pyproject.toml` contains the `deepagent` marker definition.
- AC-02: `ToolCallableFakeChatModel` in `tests/helpers/fake_chat_model.py` works with `create_deep_agent` and `astream(stream_mode="messages", subgraphs=True)`.
- AC-03: Mock MCP tool factory in `tests/helpers/mock_tools.py` produces tools compatible with `inject_project_path`, `restrict_to_wp`, and `log_tool_calls` wrappers.
- AC-04: Test `test_stage_node_completes_with_fake_model` passes — exercises `create_stage_node` → `create_deep_agent` → tool-calling loop → completion.
- AC-05: Test `test_path_middleware_rewrites_through_deep_agent` passes — verifies `PathNormalizationMiddleware` rewrites absolute paths through the real middleware pipeline.
- AC-06: Test `test_project_path_injected_through_deep_agent` passes — verifies `inject_project_path` wrapper injects `project_path` when absent.
- AC-07: Test `test_restrict_to_wp_blocks_cross_wp_through_deep_agent` passes — verifies `restrict_to_wp` blocks cross-WP calls through the Deep Agent stack.
- AC-08: Test `test_post_completion_guard_through_deep_agent` passes — verifies the post-completion guard returns synthetic WAIT after `ledger_complete_pipeline`.
- AC-09: Test `test_error_rollback_cancels_pipeline_through_deep_agent` passes — verifies error-path rollback calls `ledger_cancel_pipeline` with `auto_cancelled=True`.
- AC-10: Two `@pytest.mark.live` tests exist and skip gracefully when no API key is set.
- AC-11: All existing tests continue to pass (zero regressions).
- AC-12: All `@pytest.mark.deepagent` tests run in < 30 seconds total without API keys.

## Testing Strategy

The plan itself is a testing strategy. Tests are organized in two tiers:

1. **Tier 1 (deepagent):** 6 deterministic integration tests using `ToolCallableFakeChatModel`. These exercise the full `create_deep_agent` → middleware → tool wrappers → stream accumulation path. Run automatically with `pytest` (no special flags needed). Expected runtime: 1–5 seconds per test, < 30 seconds total.

2. **Tier 2 (live):** 2 real-LLM smoke tests under `@pytest.mark.live`. Run manually before releases with `pytest -m live`. Skipped automatically when no API key is set.

Invocation patterns:
```bash
# Fast deep-agent integration tests (no API key needed)
pytest tests/test_deep_agent_integration.py -m deepagent -v

# Manual pre-release smoke (needs API key)
pytest tests/test_deep_agent_integration.py -m live -v

# Full suite including deepagent (excludes live by default)
pytest tests/ -v
```

## Test Plan

- `tests/test_deep_agent_integration.py::test_stage_node_completes_with_fake_model` — Verifies full stage node lifecycle through real `create_deep_agent` — AC-04
- `tests/test_deep_agent_integration.py::test_path_middleware_rewrites_through_deep_agent` — Verifies `PathNormalizationMiddleware` rewrites through real middleware pipeline — AC-05
- `tests/test_deep_agent_integration.py::test_project_path_injected_through_deep_agent` — Verifies `inject_project_path` wrapper through Deep Agent stack — AC-06
- `tests/test_deep_agent_integration.py::test_restrict_to_wp_blocks_cross_wp_through_deep_agent` — Verifies `restrict_to_wp` guard through Deep Agent stack — AC-07
- `tests/test_deep_agent_integration.py::test_post_completion_guard_through_deep_agent` — Verifies post-completion guard synthetic WAIT — AC-08
- `tests/test_deep_agent_integration.py::test_error_rollback_cancels_pipeline_through_deep_agent` — Verifies error-path pipeline rollback — AC-09
- `tests/test_deep_agent_integration.py::test_developer_stage_live` — Real LLM developer stage smoke test — AC-10
- `tests/test_deep_agent_integration.py::test_pm_stage_live` — Real LLM PM stage smoke test — AC-10

## Documentation Updates

- `orchestrator/docs/agents/project-manifest/file-tree.md` — Add entries for `tests/helpers/` directory, `tests/helpers/__init__.py`, `tests/helpers/fake_chat_model.py`, `tests/helpers/mock_tools.py`, and `tests/test_deep_agent_integration.py`.
- `orchestrator/docs/agents/project-manifest/constraints.md` — No changes needed (tests follow existing constraints).
- `orchestrator/docs/agents/project-manifest/README.md` — Update test count if referenced.
- `orchestrator/README.md` — (a) replace stale test counts (988 / 987) with the post-implementation count; (b) add `deepagent`-marker invocation example to the Running Tests section alongside the existing `integration` and `live` examples; (c) add `test_deep_agent_integration.py` row to the test file table.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Deep Agents SDK changes break `ToolCallableFakeChatModel`** | The fake model relies on stable LangChain interfaces (`GenericFakeChatModel`, `AIMessage.tool_calls`). Pin `deepagents>=0.3` and `langchain-core>=1.2.22`. If the SDK changes, the 3 overrides are localized and easy to update. |
| **Built-in Deep Agents tools interfere with scripted tool calls** | Research confirmed that scripted `tool_calls` only reference tools by name; built-in tools are never triggered as long as test messages only call explicitly provided mocks. |
| **`_stream()` override becomes stale if `GenericFakeChatModel` changes** | The override is a single method with clear semantics. Monitor `langchain-core` releases. The test itself serves as a regression detector. |
| **Live tests flake due to LLM non-determinism** | Live tests assert only structural properties (at least one tool call, no crash) rather than exact output. They run only on-demand, not in CI. |
| **Test runtime exceeds 30-second budget** | Each deepagent test creates a single Deep Agent with a short scripted sequence (2–4 messages). Empirically verified at 1–5 seconds per test. Budget of 30s total for 6 tests provides ample headroom. |
