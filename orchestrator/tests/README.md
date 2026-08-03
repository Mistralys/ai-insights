# Orchestrator Test Suite

Reference guide for contributors writing or maintaining tests in `orchestrator/tests/`.

---

## Store Resolution Isolation

Any test that calls `_derive_slug_dir()` or `_derive_ledger_log_dir()` — or any
function that transitively calls `resolve_store_for_repo()` — **must** patch the
resolution function to prevent the developer's real `~/.ai-insights/stores.json` from
affecting test results.

Use an autouse fixture:

```python
@pytest.fixture(autouse=True)
def _isolate_store_resolution(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    default = tmp_path / "storage" / "ledger"
    default.mkdir(parents=True, exist_ok=True)
    _default = lambda *_a, **_kw: default
    monkeypatch.setattr("src.nodes.resolve_store_for_repo", _default)
    monkeypatch.setattr("src.cli.resolve_store_for_repo", _default)
```

**Rationale:** The developer's real `stores.json` may register the repository in a
non-default store. Without the fixture, tests resolve the wrong store path and fail
with incorrect assertions or unexpected ENOENT errors.

**Existing examples:** `test_slug_dir.py` (patches both `src.nodes.resolve_store_for_repo`
and `src.cli.resolve_store_for_repo`), `test_streaming_capture.py` (patches
`src.nodes.resolve_store_for_repo` only).

**Alternative:** When you need to test the actual multi-store resolution logic, pass the
`_stores_config_path` parameter directly to `_derive_slug_dir()`,
`_derive_ledger_log_dir()`, or `resolve_store_for_repo()` with a temp-dir config file.
This is the approach used in `test_store_resolution.py`.

---

## Test Tiers

The orchestrator test suite is organised into three tiers based on external dependencies:

| Tier | Marker | External deps | Speed |
|------|--------|---------------|-------|
| Unit | *(none)* | None | < 1 s total |
| Integration (ScriptedLedger) | `integration` | None | < 1 s total |
| Deep Agent integration | `deepagent` | None (fake model) | ~1–2 s each |
| Live | `live` | Built MCP server + API key | Slow — skipped by default |

---

## Mock Tool Selection Guide

The choice of mock tool type depends on which layer of the orchestrator you are testing.

### Wrapper-level tests — use `_MockTool`

`_MockTool` (from `tests/helpers/mock_tools.py`) is a plain Python object that satisfies the orchestrator's **tool wrapper contracts** (`inject_project_path`, `restrict_to_wp`, `log_tool_calls`). It is suitable for any test that exercises these wrappers but does **not** involve `create_deep_agent`.

```python
from tests.helpers.mock_tools import make_mock_tool, make_ledger_tools

tools = make_ledger_tools()
begin_work = next(t for t in tools if t.name == "ledger_begin_work")

# Run code under test, then inspect recorded calls:
assert len(begin_work.calls) == 1
```

> **Incompatibility warning:** `_MockTool` is **not** a `BaseTool` subclass. Deep Agents'
> `SubAgentMiddleware` passes the tool list to LangGraph's `ToolNode`, which requires
> `BaseTool` instances. Passing `_MockTool` objects to `create_deep_agent` raises a
> `ValueError` during agent construction. Use `StructuredTool.from_function` instead
> (see below).

### Deep Agent integration tests — use `StructuredTool.from_function`

For tests that exercise the real `create_deep_agent` call, use
[`langchain_core.tools.StructuredTool`](https://python.langchain.com/docs/how_to/custom_tools/)
to create proper `BaseTool` instances. `test_deep_agent_integration.py` provides two
ready-made helper patterns:

**Count-only assertions** (tool is called but argument values don't matter):

```python
from langchain_core.tools import StructuredTool
from pydantic import BaseModel, ConfigDict

class _AnyArgsSchema(BaseModel):
    model_config = ConfigDict(extra="allow")

calls: list = []

async def _impl(**_: object) -> str:
    calls.append({})
    return '{"result": "ok"}'

tool = StructuredTool.from_function(
    coroutine=_impl,
    name="ledger_begin_work",
    description="Ledger begin work",
    args_schema=_AnyArgsSchema,
)
```

> **Note on `_AnyArgsSchema`:** When a `StructuredTool` has no declared schema fields,
> LangChain's `_to_args_and_kwargs` short-circuits and passes `**{}` to the coroutine.
> `calls` records empty dicts but `len(calls)` still correctly reflects the invocation
> count.

**Value assertions** (argument values must be verified):

```python
calls: list = []

async def _read_file(file_path: str) -> str:
    calls.append({"file_path": file_path})
    return "file content"

tool = StructuredTool.from_function(
    coroutine=_read_file,
    name="read_file",
    description="Read a file",
)
```

Declaring the parameter explicitly (`file_path: str`) causes LangChain to infer a
one-field schema and forward the argument through correctly.

See `test_deep_agent_integration.py` for complete examples of both patterns.

---

## Helpers Reference (`tests/helpers/`)

### `mock_tools.py`

| Symbol | Purpose |
|--------|---------|
| `_MockTool` | Wrapper-tier mock: records `ainvoke` calls. Incompatible with `create_deep_agent`. |
| `make_mock_tool(name, response)` | Factory for a single `_MockTool`. |
| `make_ledger_tools()` | Returns `_MockTool` instances for all canonical ledger tool names. |
| `LEDGER_TOOL_NAMES` | Canonical list of ledger tool name strings. |

### `fake_chat_model.py`

| Symbol | Purpose |
|--------|---------|
| `ToolCallableFakeChatModel` | Scripted `BaseChatModel` that replays a pre-set iterator of `AIMessage` responses. Preserves `tool_calls` through streaming. Required for Deep Agent integration tests. |

---

## Marks Reference

| Mark | Purpose | Run with |
|------|---------|----------|
| `@pytest.mark.integration` | ScriptedLedger end-to-end graph tests | `-m integration` |
| `@pytest.mark.deepagent` | Real `create_deep_agent` pipeline tests (no API key) | `-m deepagent` |
| `@pytest.mark.live` | Real MCP server + LLM — skipped by default | `-m live` |

All three marks are registered in `pyproject.toml` under `[tool.pytest.ini_options] markers` to suppress unknown-mark warnings.

---

## Running Tests

```bash
cd orchestrator

# All unit tests
python -m pytest tests/ -v

# Deep Agent integration tests only
python -m pytest tests/test_deep_agent_integration.py -v -m deepagent

# ScriptedLedger integration tests only
python -m pytest tests/test_integration.py -m integration -v

# All tests except live
python -m pytest tests/ -m "not live" -v
```
