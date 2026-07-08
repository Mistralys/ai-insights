# Research Report

## Problem Statement

Design an integration test strategy for the AI Insights Orchestrator that
verifies Deep Agent pipeline stages work as intended end-to-end. Tests should
be separate from the regular unit/integration suite and run only before releases
to check for regressions.

## Problem Decomposition

1. **What layers need testing?** Identify which orchestrator components sit
   between the pytest harness and a real LLM call, and which of those layers
   can be exercised without consuming API tokens.
2. **How to substitute the LLM?** Determine whether `create_deep_agent` can
   accept a fake model, and what response format the fake model must produce
   to drive a realistic tool-calling loop.
3. **How to substitute the MCP server?** Determine whether mock MCP tool
   objects can stand in for the real server.
4. **What regressions matter?** Identify the failure modes that only manifest
   when the full Deep Agent harness runs (middleware, tool wrappers, backend).
5. **How to run selectively?** Determine the pytest marker and invocation
   pattern for pre-release-only tests.

## Context & Constraints

- The orchestrator already has **1 093+ fast tests** and 11 integration tests
  using `ScriptedLedger` stubs that never invoke `create_deep_agent`.
- A `@pytest.mark.live` marker exists in `pyproject.toml` but only one
  skeleton test uses it; it is permanently `@pytest.mark.skip`ped.
- `create_deep_agent()` accepts `model: str | BaseChatModel | None` — passing
  a `BaseChatModel` instance directly is confirmed to work (returns a compiled
  `StateGraph`).
- `FakeListChatModel` and `FakeMessagesListChatModel` from
  `langchain_core.language_models.fake_chat_models` produce scripted
  responses. `FakeMessagesListChatModel` accepts `AIMessage` objects with
  `tool_calls`, enabling scripted tool-calling loops.
- The orchestrator wraps MCP tools with four layers inside `create_stage_node`:
  `inject_project_path` → `restrict_to_wp` → `begin_work_tracker` →
  `log_tool_calls`. These are tested individually but never exercised through
  the real `create_deep_agent` stack.
- `PathNormalizationMiddleware` is injected via the `middleware=` parameter to
  `create_deep_agent`. It is unit-tested (41 tests) but never exercised through
  the actual middleware pipeline inside Deep Agents.
- Deep Agents adds its own middleware stack on top: `TodoListMiddleware`,
  `FilesystemMiddleware`, `SubAgentMiddleware`, `SummarizationMiddleware`,
  `PatchToolCallsMiddleware`, and provider-specific middleware.
- `StateBackend` (in-memory, no disk I/O) is the default backend and suitable
  for testing.
- Real LLM tests cost tokens and are non-deterministic; they should remain
  optional (`@pytest.mark.live`).
- Tests must be cross-platform (macOS, Linux, Windows).

## Prior Art & Known Patterns

### Pattern 1: FakeMessagesListChatModel + real create_deep_agent

- **Description:** Use `FakeMessagesListChatModel` with pre-scripted `AIMessage`
  sequences (including `tool_calls` entries) as the model. Pass mock MCP tool
  objects. Use `StateBackend` (no disk). The Deep Agent runs its full middleware
  stack, processes tool calls, and returns — all without hitting an LLM API.
- **Where used:** LangChain's own test suites use `FakeListChatModel` for
  testing agent loops. The Deep Agents SDK accepts any `BaseChatModel` instance.
- **Strengths:** Exercises the full middleware stack, tool-call dispatch, path
  middleware, and tool wrapper layers. Deterministic, fast (~1–5 s), free, no
  API key needed. Can run in CI.
- **Weaknesses:** Requires carefully crafted `AIMessage` sequences with valid
  `tool_calls` dicts. Does not exercise LLM understanding or prompt quality.
  Brittle if Deep Agents changes its internal message format expectations.
- **Fit:** Excellent for regression testing middleware, tool wrappers, and
  path normalization. This is the primary recommended pattern.

### Pattern 2: Real LLM + mock MCP tools

- **Description:** Use a real LLM (e.g. `anthropic:claude-sonnet-4-6`) with
  mock MCP tool objects that return scripted JSON responses. The LLM generates
  real tool calls; the mock tools respond with controlled data.
- **Where used:** Common in LLM application testing. The existing `@pytest.mark.live`
  skeleton in `test_integration.py` was designed for this pattern.
- **Strengths:** Tests real LLM interaction with the orchestrator's prompt
  architecture. Validates that persona prompts produce correct tool-call sequences.
  Catches prompt regressions.
- **Weaknesses:** Costs API tokens (~$0.02–0.20 per test depending on model).
  Non-deterministic — LLM output varies between runs. Requires API key in
  environment. Slower (5–30 s per test). Not suitable for CI.
- **Fit:** Valuable as a manual pre-release smoke test. Run with
  `pytest -m live`. Should cover 2–3 critical paths (happy path, error handling).

### Pattern 3: Full end-to-end (real LLM + real MCP server)

- **Description:** Launch the real MCP server subprocess, use a real LLM, and
  execute against a real (but disposable) ledger project.
- **Where used:** The smoke-testing runbook (`orchestrator/docs/smoke-testing.md`)
  describes a manual version of this using `--dry-run`.
- **Strengths:** Maximum fidelity. Tests the complete system including MCP
  subprocess lifecycle, tool serialization, and ledger state persistence.
- **Weaknesses:** Requires built MCP server (`npm run build` in `mcp-server/`),
  API key, and significant token cost. Slowest option (30–120 s). Non-deterministic.
  Complex setup and teardown. Not suitable for CI.
- **Fit:** Best reserved for manual pre-release verification. Already partially
  covered by the `--dry-run` smoke test workflow.

## Alternative & Creative Approaches

### Hybrid: FakeModel + recording/playback

- **Approach:** Run Pattern 2 once to record a real LLM's message sequence,
  then replay those messages via `FakeMessagesListChatModel` in subsequent runs.
- **Rationale:** Captures a real interaction's message flow and replays it
  deterministically. Gets the fidelity of Pattern 2 with the speed of Pattern 1.
- **Risk:** Recorded sequences become stale when prompts or tools change.
  Maintenance overhead to re-record after prompt updates.

### Focused middleware probe tests

- **Approach:** Create a minimal `create_deep_agent` with a `FakeListChatModel`
  that immediately returns (no tool calls), plus the `PathNormalizationMiddleware`.
  Assert that the middleware's `awrap_tool_call` hook was registered. Then create
  a separate test where the fake model returns a single tool call with an absolute
  path argument, and verify the argument was rewritten.
- **Rationale:** Tests the specific concern (path rewriting) through the real
  middleware pipeline without needing a full multi-tool conversation.
- **Risk:** Minimal. Small, focused, deterministic.

## Comparative Evaluation

| Criterion              | Pattern 1: FakeModel  | Pattern 2: Real LLM   | Pattern 3: Full E2E   | Hybrid Recording     |
|------------------------|-----------------------|------------------------|-----------------------|----------------------|
| **Complexity**         | Medium                | Medium                 | High                  | High                 |
| **Performance**        | Fast (1–5 s)          | Slow (5–30 s)          | Very slow (30–120 s)  | Fast (1–5 s)         |
| **Determinism**        | Deterministic         | Non-deterministic      | Non-deterministic     | Deterministic        |
| **Cost**               | Free                  | $0.02–0.20/test        | $0.05–0.50/test       | Free (after record)  |
| **Fidelity**           | High (middleware)     | Very high (prompts)    | Complete              | High                 |
| **Maintainability**    | Good                  | Good                   | Poor                  | Poor                 |
| **CI-compatible**      | Yes                   | No                     | No                    | Yes                  |
| **Time to implement**  | Low–Medium            | Low                    | Medium                | Medium–High          |
| **Regression coverage**| Middleware, wrappers  | Prompts, tool use      | Everything            | Middleware, wrappers  |

## Recommendation

Implement **Pattern 1 (FakeMessagesListChatModel)** as the primary integration
test tier, combined with a small number of **Pattern 2 (real LLM)** smoke tests
under the existing `@pytest.mark.live` marker.

### Proposed test structure

Add a new marker `@pytest.mark.deepagent` for fake-LLM deep agent tests that
exercise the full middleware stack without API keys. These tests:

- Use a custom `ToolCallableFakeChatModel` (subclass of `GenericFakeChatModel`)
  with scripted `AIMessage` sequences including `tool_calls`.
- Use mock MCP tools (like the existing `ScriptedLedger.make_mcp_tools()`).
- Use `StateBackend` (default, in-memory).
- Are collected in a dedicated file: `tests/test_deep_agent_integration.py`.
- Run in ~5 seconds total, deterministically, without API keys.

Expand the existing `@pytest.mark.live` skeleton to 2–3 real-LLM tests for
manual pre-release verification.

### Test cases for `@pytest.mark.deepagent` (Pattern 1)

1. **Stage node creates a Deep Agent and completes** — Invoke a real
   `create_stage_node` (e.g. developer) with a `FakeMessagesListChatModel` that
   returns one `AIMessage` with a `ledger_begin_work` tool call, then one with
   a `ledger_complete_pipeline` tool call, then a final text-only message.
   Assert: `stage_success=True`, `run_log` contains `stage_start` and
   `stage_complete`, the begin_work tracker recorded the call.

2. **PathNormalizationMiddleware rewrites absolute paths** — Create a
   `create_deep_agent` with the middleware, a fake model that calls a custom
   tool with an absolute POSIX path (e.g. `/Users/dev/project/src/file.ts`),
   and a mock tool that records its received arguments. Assert the tool received
   `/src/file.ts` (the rewritten virtual path).

3. **Tool wrappers inject project_path through the Deep Agent stack** — Create
   a stage node with mock MCP tools, invoke it with a `FakeMessagesListChatModel`
   that calls `ledger_get_project_status` without a `project_path` argument.
   Assert the mock tool received `project_path` injected by the wrapper.

4. **restrict_to_wp blocks cross-WP tool calls** — Create a stage node with
   `current_wp_id="WP-001"`, invoke with a fake model that calls
   `ledger_get_work_package` with `work_package_id="WP-999"`. Assert the tool
   call was rejected and the error was caught gracefully.

5. **Post-completion guard returns synthetic WAIT** — Create a stage node,
   invoke with a fake model sequence: `ledger_begin_work` → `ledger_complete_pipeline`
   → `ledger_get_next_action`. Assert the final `ledger_get_next_action` returns
   `{"action": "WAIT"}` (the guard's synthetic response).

6. **Error rollback cancels orphaned pipeline** — Create a stage node with a
   fake model that calls `ledger_begin_work` and then raises an error (via a
   tool that raises). Assert the `ledger_cancel_pipeline` tool was called in
   the rollback path.

### Test cases for `@pytest.mark.live` (Pattern 2)

1. **Developer stage completes a simple task with real LLM** — Use a real LLM
   with mock MCP tools. Provide a minimal plan with one WP. Assert the LLM
   produces at least one `ledger_begin_work` call and completes without error.

2. **PM stage reads plan and creates work packages** — Use a real LLM with
   mock MCP tools. Assert the LLM produces `ledger_create_work_package` calls
   based on the plan content.

### Invocation pattern

```bash
# Fast deep-agent integration tests (no API key needed)
pytest tests/test_deep_agent_integration.py -m deepagent -v

# Manual pre-release smoke (needs API key)
pytest tests/test_deep_agent_integration.py -m live -v

# Full pre-release check
pytest tests/ -v  # includes all markers except live
pytest tests/test_deep_agent_integration.py -m live -v  # then live separately
```

### pyproject.toml change

```toml
[tool.pytest.ini_options]
markers = [
    "integration: end-to-end graph execution tests (no real MCP or LLM required)",
    "live: requires a built MCP server and a real LLM API key",
    "deepagent: deep agent integration tests using fake LLM (no API key required)",
]
```

### Proof-of-Concept Outline

1. Add the `deepagent` marker to `pyproject.toml`.
2. Create `tests/test_deep_agent_integration.py` with
   `ToolCallableFakeChatModel` — a `GenericFakeChatModel` subclass that
   overrides `bind_tools` (no-op), `_generate` (StopIteration fallback),
   and `_stream` (tool_calls chunk emission).
3. Create mock tool objects matching the MCP tool interface (name, ainvoke).
4. Write test 1 (stage node completes) using a real `create_stage_node` from
   `src/nodes/developer.py`, the fake model, and mock tools.
5. Write test 2 (path middleware) using `create_deep_agent` directly with the
   `PathNormalizationMiddleware` and a recording tool — **already verified
   empirically** (rewrites `/Users/dev/myproject/src/main.py` → `/src/main.py`).
6. Verify all tests pass: `pytest tests/test_deep_agent_integration.py -m deepagent -v`.

## Open Questions (Resolved)

### Streaming compatibility — RESOLVED

**Finding:** Neither `FakeListChatModel` nor `FakeMessagesListChatModel` works
with `create_deep_agent` because Deep Agents calls `model.bind_tools()` during
agent construction, which raises `NotImplementedError` on both classes.

**Solution:** Subclass `GenericFakeChatModel` (which inherits `bind_tools` from
`BaseChatModel`) with three overrides:

1. **`bind_tools()`** — No-op that returns `self` (tools are ignored; the fake
   model returns scripted responses regardless of bound tools).
2. **`_generate()`** — Catches `StopIteration` when the scripted message
   iterator is exhausted and returns a terminal text message instead of
   propagating the exception through a generator (which causes
   `RuntimeError: generator raised StopIteration` in Python 3.7+).
3. **`_stream()`** — When the message has `tool_calls`, emits a single
   `AIMessageChunk` with the tool calls preserved (the parent class's
   `_stream` only handles `content` and `additional_kwargs`, dropping
   `tool_calls`). For text-only messages, delegates to the parent.

**Verified empirically:** The `ToolCallableFakeChatModel` subclass works with:
- `agent.astream(stream_mode="messages", subgraphs=True)` — the exact
  streaming path used by `_accumulate_stream` in the orchestrator.
- Tool-calling loops: fake model emits tool call → Deep Agents executes tool
  → fake model emits follow-up response.
- `PathNormalizationMiddleware`: confirmed that an absolute POSIX path
  (`/Users/dev/myproject/src/main.py`) is correctly rewritten to `/src/main.py`
  through the full Deep Agents middleware stack.

**Key implementation detail:** Deep Agents makes multiple model calls per turn
(initial call, after each tool result, and sometimes internally). The scripted
message iterator must provide enough entries. The `_generate` fallback returns
`"[end of scripted responses]"` when exhausted, which causes the agent to
terminate its loop gracefully.

### Built-in tool interference — Low risk

Deep Agents adds `write_todos`, `task`, filesystem tools, etc. The scripted
`tool_calls` only reference tools by name, so as long as the test messages only
call the explicitly provided mock tools, built-in tools are never triggered.

### Message format stability — Acceptable risk

`AIMessage.tool_calls` uses the standard LangChain format (`list[dict]` with
`name`, `args`, `id`, `type` keys). This format has been stable across
langchain-core versions. Tests assert on wrapper/middleware behaviour (recorded
tool arguments), not internal message structures.

## References

- Deep Agents overview: https://docs.langchain.com/oss/python/deepagents/overview
- Deep Agents customization (model, tools, middleware, backends):
  https://docs.langchain.com/oss/python/deepagents/customization
- `FakeMessagesListChatModel`: `langchain_core.language_models.fake_chat_models`
- Existing integration tests: `orchestrator/tests/test_integration.py`
- Existing node unit tests: `orchestrator/tests/test_nodes.py`
- Smoke-testing runbook: `orchestrator/docs/smoke-testing.md`
- PathNormalizationMiddleware: `orchestrator/src/utils/path_middleware.py`
- Stage node factory: `orchestrator/src/nodes/__init__.py` → `create_stage_node`
