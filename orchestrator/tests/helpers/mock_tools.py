"""
mock_tools.py — Mock MCP tool factories for orchestrator integration tests.

Provides plain Python objects with ``.name``, async ``.ainvoke()``, and
``.calls`` — compatible with ``inject_project_path``, ``restrict_to_wp``, and
``log_tool_calls`` wrappers.

Unlike ``MagicMock``, these objects do **not** auto-create attributes on access,
so sentinel checks inside the wrapper layers (e.g. ``hasattr(tool, "_orig_ainvoke")``)
work correctly.

.. warning::
    ``_MockTool`` is **not** a ``BaseTool`` subclass.  It is compatible with the
    orchestrator's wrapper layers (``inject_project_path``, ``restrict_to_wp``,
    ``log_tool_calls``) but **not** with ``create_deep_agent``.  Deep Agents'
    ``SubAgentMiddleware`` constructs a LangGraph ``ToolNode`` that requires
    proper ``BaseTool`` instances.  For Deep Agent integration tests use
    :func:`langchain_core.tools.StructuredTool.from_function` instead.
    See ``tests/test_deep_agent_integration.py`` for examples.
    from tests.helpers.mock_tools import make_mock_tool, make_ledger_tools

    tools = make_ledger_tools()
    begin_work = next(t for t in tools if t.name == "ledger_begin_work")

    # After test execution:
    assert len(begin_work.calls) == 1
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

# Canonical set of ledger tool names covered by ``make_ledger_tools``.
LEDGER_TOOL_NAMES: list[str] = [
    "ledger_begin_work",
    "ledger_complete_pipeline",
    "ledger_get_next_action",
    "ledger_get_project_status",
    "ledger_get_work_package",
    "ledger_cancel_pipeline",
]


class _MockTool:
    """Plain Python mock tool that records all ``ainvoke`` invocations.

    Attributes
    ----------
    name:
        Tool name string used by the orchestrator wrapper layers and Deep
        Agents dispatch.
    calls:
        List of ``input`` arguments received by ``ainvoke``, in order.
    """

    def __init__(self, name: str, response: str | Callable) -> None:
        self.name = name
        self._response = response
        self.calls: list[Any] = []

    async def ainvoke(self, input: Any, *args: Any, **kwargs: Any) -> str:
        """Record the call and return the configured response."""
        self.calls.append(input)
        if callable(self._response):
            result = self._response(input)
            if hasattr(result, "__await__"):
                return await result  # type: ignore[return-value]
            return result  # type: ignore[return-value]
        return self._response  # type: ignore[return-value]


def make_mock_tool(name: str, response: str | Callable = "ok") -> _MockTool:
    """Return a mock MCP tool object with ``.name``, ``.ainvoke()``, and ``.calls``.

    Parameters
    ----------
    name:
        The tool name.  Used by the orchestrator wrapper layers
        (``inject_project_path``, ``restrict_to_wp``, ``log_tool_calls``) and
        by the Deep Agents harness to route tool-call messages.
    response:
        Static string returned on every call, or a callable with the signature
        ``(input: Any) -> str | Awaitable[str]``.  The callable receives the
        full ``input`` argument passed to ``ainvoke()`` and may return either a
        plain string or an awaitable that resolves to a string (async response
        factory).  Defaults to ``"ok"``.
    """
    return _MockTool(name=name, response=response)


def make_ledger_tools(
    responses: dict[str, str | Callable] | None = None,
) -> list[_MockTool]:
    """Return a list of mock tools covering all common ledger operations.

    The returned list contains one ``_MockTool`` for each name in
    :data:`LEDGER_TOOL_NAMES`: ``ledger_begin_work``,
    ``ledger_complete_pipeline``, ``ledger_get_next_action``,
    ``ledger_get_project_status``, ``ledger_get_work_package``, and
    ``ledger_cancel_pipeline``.

    Parameters
    ----------
    responses:
        Optional mapping of tool name → response override.  Any tool name not
        present in the mapping receives ``"ok"`` as its default response.
    """
    overrides: dict[str, str | Callable] = responses or {}
    return [
        make_mock_tool(name, overrides.get(name, "ok"))
        for name in LEDGER_TOOL_NAMES
    ]
