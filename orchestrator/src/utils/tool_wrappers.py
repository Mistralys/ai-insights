"""
tool_wrappers — MCP tool call safety-net utilities.

This module provides :func:`inject_project_path`, a defensive wrapper that
auto-injects both ``project_path`` and ``cwd_path`` into every MCP tool call.
It acts as a **Layer 2 safety net**: even if an LLM-driven agent ignores the
explicit prompt instructions that ask it to supply these arguments, this wrapper
guarantees they reach the MCP server.

Design notes
------------
- A sentinel attribute ``_orig_ainvoke`` is stored on the tool object the first
  time it is wrapped.  Subsequent calls to :func:`inject_project_path` on the
  same tool objects (e.g. because ``list(mcp_tools)`` is a shallow copy and the
  same tool instances are re-used across node invocations) always delegate to
  the *original* ``ainvoke``, making the function **idempotent** and preventing
  unbounded wrapper stacking.
- Only ``ainvoke`` is monkeypatched; all other attributes (``name``,
  ``description``, ``args_schema``, etc.) remain untouched so that tool
  discovery and schema introspection work as normal.
- ``project_path`` uses ``setdefault`` semantics: an explicitly-provided value
  is never overwritten.
- ``cwd_path`` is always set to the authoritative project path, overwriting any
  caller-supplied value.  This ensures tools that only accept ``cwd_path`` (such
  as ``ledger_detect_project``) always receive a valid path, while tools that
  only accept ``project_path`` silently ignore the extra key via schema
  unknown-key stripping.
- The wrapper handles both dict-style and plain-string input gracefully — if
  the input is not a dict no injection is attempted.

Context
-------
Tests for this module live in ``orchestrator/tests/test_tool_wrappers.py``
(WP-001, WP-003).
"""

from __future__ import annotations

from typing import Any


def inject_project_path(tools: list[Any], project_path: str) -> list[Any]:
    """Wrap each tool's ``ainvoke`` to auto-inject ``project_path`` and ``cwd_path``.

    The function is **idempotent**: calling it multiple times on the same tool
    objects (e.g. because ``list(mcp_tools)`` produces a shallow copy) will
    not stack closures.  A sentinel attribute (``_orig_ainvoke``) is set on
    each tool on the first wrap; subsequent calls reuse that sentinel as the
    original so the wrapper chain never grows beyond one level.

    Parameters
    ----------
    tools:
        A list of LangChain ``BaseTool`` instances (typically MCP-backed
        ``StructuredTool`` objects obtained from
        :class:`~src.mcp_client.MCPToolkit`).
    project_path:
        The authoritative ledger project-directory path.  Injected as
        ``project_path`` (``setdefault`` — preserves explicit caller values)
        and as ``cwd_path`` (always overwritten) so that every ledger tool
        receives a valid routing key regardless of which parameter it accepts.

    Returns
    -------
    list[Any]
        The same list with each tool's ``ainvoke`` replaced by the wrapper.
        Mutation is in-place; the original list reference is also returned for
        convenience.  Repeated calls on already-wrapped tools are idempotent.
    """
    for tool in tools:
        # Retrieve (or establish) the true original ainvoke via sentinel.
        # This prevents wrapper stacking when the same tool object is passed
        # to inject_project_path more than once (shallow-copy scenario).
        if not hasattr(tool, "_orig_ainvoke"):
            object.__setattr__(tool, "_orig_ainvoke", tool.ainvoke)
        _original_ainvoke = tool._orig_ainvoke  # type: ignore[attr-defined]

        async def _wrapped_ainvoke(
            input: Any,
            *args: Any,
            _orig: Any = _original_ainvoke,
            _proj: str = project_path,
            **kwargs: Any,
        ) -> Any:
            if isinstance(input, dict):
                # LangGraph ToolNode passes a ToolCall dict with args nested
                # inside input["args"], while direct invocations pass a flat
                # dict of tool arguments.  Handle both structures.
                if "args" in input and isinstance(input["args"], dict):
                    # ToolCall structure: {"name": ..., "args": {...}, ...}
                    target = input["args"]
                else:
                    # Flat dict of tool arguments
                    target = input

                # Inject both routing keys so every ledger tool receives a
                # valid path regardless of which parameter it accepts:
                #   - project_path: setdefault — preserves an explicit caller
                #     value (some tools receive a non-default project path).
                #   - cwd_path: always overwrite — the orchestrator knows the
                #     authoritative path; any caller-supplied value (e.g. from
                #     a persona instruction meant for interactive IDE agents)
                #     is replaced.  Tools that do not accept cwd_path ignore
                #     the extra key via Zod unknown-key stripping.
                target.setdefault("project_path", _proj)
                target["cwd_path"] = _proj
            return await _orig(input, *args, **kwargs)

        object.__setattr__(tool, "ainvoke", _wrapped_ainvoke)

    return tools

