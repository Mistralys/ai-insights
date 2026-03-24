"""
test_tool_wrappers.py — Unit tests for src.utils.tool_wrappers.

Tests cover every behavioural contract promised by ``inject_project_path``:

1. **Injection when absent** — both ``project_path`` and ``cwd_path`` are added
   when the tool call dict contains neither.
2. **No override when present** — an explicitly-supplied ``project_path`` is
   never overwritten (setdefault semantics), but ``cwd_path`` is always
   overwritten with the authoritative project path.
3. **cwd_path re-injection** — any caller-supplied ``cwd_path`` value is
   discarded and replaced with the authoritative project path; both
   ``project_path`` and ``cwd_path`` are always present after wrapping.
4. **Argument preservation** — other kwargs (e.g. ``work_package_id``) survive
   the wrapper untouched.
5. **Idempotency** — calling ``inject_project_path`` twice on the same list of
   tool objects does not stack closures; injection still happens once, from the
   original ``ainvoke``.
6. **Passthrough for non-dict input** — string (and other non-dict) inputs are
   forwarded as-is without modification.
7. **Returns the same list** — the function returns the same list object (mutated
   in-place) for chaining convenience.

Implementation note on test helpers
------------------------------------
MagicMock auto-creates *every* attribute on first access, so
``hasattr(magic_mock, "_orig_ainvoke")`` always returns ``True``.  That
breaks the sentinel logic inside :func:`inject_project_path`.  All test helpers
therefore use plain Python objects (``_SimpleTool``), not ``MagicMock``, to
ensure the sentinel is absent before the first wrap.

No LLM calls or MCP server required — all tests run in < 1 second.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from src.utils.tool_wrappers import inject_project_path


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

class _SimpleTool:
    """Minimal plain-Python tool stub.

    Unlike ``MagicMock``, plain objects do **not** auto-create attributes on
    access, so ``hasattr(tool, "_orig_ainvoke")`` correctly returns ``False``
    before the first :func:`inject_project_path` call.
    """

    def __init__(self, seen: list[Any] | None = None) -> None:
        _seen: list[Any] = seen if seen is not None else []
        self.name = "test_tool"

        async def _ainvoke(input: Any, *args: Any, **kwargs: Any) -> str:
            _seen.append(input)
            return "result"

        self.ainvoke = _ainvoke


def _make_tool(captured: list[Any] | None = None) -> _SimpleTool:
    """Return a ``_SimpleTool`` whose ``ainvoke`` records the *input* argument."""
    return _SimpleTool(seen=captured if captured is not None else [])


PROJECT = "/ledger/project"


# ---------------------------------------------------------------------------
# 1. Injection when project_path absent
# ---------------------------------------------------------------------------

class TestInjectsWhenAbsent:
    async def test_empty_dict_receives_project_path(self):
        """An empty call dict gets project_path injected."""
        seen: list[Any] = []
        tool = _make_tool(seen)
        inject_project_path([tool], PROJECT)

        await tool.ainvoke({})

        assert len(seen) == 1
        assert seen[0].get("project_path") == PROJECT

    async def test_dict_with_other_key_receives_project_path(self):
        """A dict with only unrelated keys still receives project_path."""
        seen: list[Any] = []
        tool = _make_tool(seen)
        inject_project_path([tool], PROJECT)

        await tool.ainvoke({"work_package_id": "WP-001"})

        assert seen[0].get("project_path") == PROJECT

    async def test_returns_correct_result(self):
        """Wrapper must pass through the return value of the original ainvoke."""
        tool = _make_tool()
        inject_project_path([tool], PROJECT)

        result = await tool.ainvoke({"some_key": "value"})

        assert result == "result"


# ---------------------------------------------------------------------------
# 2. No override when project_path already present
# ---------------------------------------------------------------------------

class TestDoesNotOverrideExplicitProjectPath:
    async def test_explicit_project_path_preserved(self):
        """An explicitly-supplied project_path must not be overwritten."""
        seen: list[Any] = []
        tool = _make_tool(seen)
        inject_project_path([tool], PROJECT)

        explicit_path = "/explicit/other"
        await tool.ainvoke({"project_path": explicit_path})

        assert seen[0]["project_path"] == explicit_path, (
            "Wrapper must use setdefault semantics, not override"
        )

    async def test_explicit_path_different_from_injected(self):
        """Sanity: the explicit path is different from the inject path."""
        seen: list[Any] = []
        tool = _make_tool(seen)
        inject_project_path([tool], PROJECT)

        await tool.ainvoke({"project_path": "/custom"})

        assert seen[0]["project_path"] == "/custom"
        assert seen[0]["project_path"] != PROJECT


# ---------------------------------------------------------------------------
# 3. cwd_path re-injection — caller value replaced with authoritative path
# ---------------------------------------------------------------------------

class TestCwdPathReplacedWithProjectPath:
    async def test_cwd_path_overwritten_and_project_path_injected(self):
        """A caller-supplied cwd_path must be replaced with the authoritative
        project path, and project_path must also be injected.

        Both parameters are always present after wrapping so that
        ``ledger_detect_project`` (which only accepts ``cwd_path``) and all
        other ledger tools (which accept ``project_path``) receive a valid
        routing key.
        """
        seen: list[Any] = []
        tool = _make_tool(seen)
        inject_project_path([tool], PROJECT)

        await tool.ainvoke({"cwd_path": "/some/workspace"})

        assert seen[0]["cwd_path"] == PROJECT, (
            "caller-supplied cwd_path must be replaced with the authoritative project path"
        )
        assert seen[0]["project_path"] == PROJECT

    async def test_explicit_project_path_preserved_cwd_path_overwritten(self):
        """When both cwd_path and project_path are supplied by the caller:
        - project_path is kept (setdefault semantics)
        - cwd_path is overwritten with the authoritative project path
        """
        seen: list[Any] = []
        tool = _make_tool(seen)
        inject_project_path([tool], PROJECT)

        await tool.ainvoke({"cwd_path": "/cwd/value", "project_path": "/explicit"})

        assert seen[0]["cwd_path"] == PROJECT, (
            "cwd_path must be overwritten with the authoritative project path"
        )
        assert seen[0]["project_path"] == "/explicit", (
            "explicit project_path must be preserved (setdefault semantics)"
        )


# ---------------------------------------------------------------------------
# 4. Argument preservation
# ---------------------------------------------------------------------------

class TestArgumentPreservation:
    async def test_other_kwargs_are_preserved(self):
        """Keys other than project_path must survive the wrapper unmodified."""
        seen: list[Any] = []
        tool = _make_tool(seen)
        inject_project_path([tool], PROJECT)

        payload = {
            "work_package_id": "WP-007",
            "agent_role": "Developer",
            "type": "implementation",
        }
        await tool.ainvoke(payload)

        assert seen[0]["work_package_id"] == "WP-007"
        assert seen[0]["agent_role"] == "Developer"
        assert seen[0]["type"] == "implementation"
        assert seen[0]["project_path"] == PROJECT  # also injected

    async def test_args_and_kwargs_forwarded(self):
        """Positional args and extra keyword args must be forwarded to original."""
        extra_args: list = []
        extra_kwargs: dict = {}

        class _TrackingTool:
            name = "tracking_tool"

            async def ainvoke(self, input: Any, *args: Any, **kwargs: Any) -> str:
                extra_args.extend(args)
                extra_kwargs.update(kwargs)
                return "ok"

        tool = _TrackingTool()
        inject_project_path([tool], PROJECT)

        await tool.ainvoke({"k": "v"}, "pos_arg", extra_kwarg="val")

        assert extra_args == ["pos_arg"]
        assert extra_kwargs.get("extra_kwarg") == "val"


# ---------------------------------------------------------------------------
# 5. Idempotency — no double-wrapping
# ---------------------------------------------------------------------------

class TestIdempotency:
    async def test_double_wrap_does_not_stack_closures(self):
        """Calling inject_project_path twice on the same tool must not cause
        the original ainvoke to be called more than once per invocation."""
        call_count = 0

        class _CountingTool:
            name = "counting_tool"

            async def ainvoke(self, input: Any, *args: Any, **kwargs: Any) -> str:
                nonlocal call_count
                call_count += 1
                return "ok"

        tool = _CountingTool()

        # First wrap
        inject_project_path([tool], PROJECT)
        # Second wrap (same instance — shallow copy scenario)
        inject_project_path([tool], PROJECT)

        await tool.ainvoke({})

        assert call_count == 1, (
            f"Original ainvoke called {call_count} times — wrapper stacking occurred"
        )

    async def test_double_wrap_still_injects_project_path(self):
        """After double-wrap, injection still occurs exactly once."""
        seen: list[Any] = []
        tool = _make_tool(seen)

        inject_project_path([tool], PROJECT)
        inject_project_path([tool], PROJECT)

        await tool.ainvoke({})

        assert len(seen) == 1
        assert seen[0]["project_path"] == PROJECT

    async def test_triple_wrap_is_also_safe(self):
        """Idempotency holds for an arbitrary number of wraps."""
        call_count = 0

        class _CountingTool:
            name = "counting_tool"

            async def ainvoke(self, input: Any, *args: Any, **kwargs: Any) -> str:
                nonlocal call_count
                call_count += 1
                return "ok"

        tool = _CountingTool()

        for _ in range(3):
            inject_project_path([tool], PROJECT)

        await tool.ainvoke({})

        assert call_count == 1


# ---------------------------------------------------------------------------
# 6. Passthrough for non-dict input
# ---------------------------------------------------------------------------

class TestNonDictPassthrough:
    async def test_string_input_forwarded_as_is(self):
        """String inputs must be forwarded unchanged — no injection attempt."""
        seen: list[Any] = []
        tool = _make_tool(seen)
        inject_project_path([tool], PROJECT)

        await tool.ainvoke("raw string input")

        assert seen[0] == "raw string input"

    async def test_none_input_forwarded_as_is(self):
        """None input must be forwarded without modification."""
        seen: list[Any] = []
        tool = _make_tool(seen)
        inject_project_path([tool], PROJECT)

        await tool.ainvoke(None)

        assert seen[0] is None


# ---------------------------------------------------------------------------
# 7. Return value — same list object
# ---------------------------------------------------------------------------

class TestReturnValue:
    def test_returns_same_list_object(self):
        """inject_project_path must return the same list object (in-place mutation)."""
        tool = _make_tool()
        tools = [tool]

        result = inject_project_path(tools, PROJECT)

        assert result is tools

    def test_returns_empty_list_unchanged(self):
        """An empty tool list is a no-op and still returns the same list."""
        tools: list = []
        result = inject_project_path(tools, PROJECT)
        assert result is tools
        assert result == []


# ---------------------------------------------------------------------------
# 8. Multiple tools in the list all get wrapped
# ---------------------------------------------------------------------------

class TestMultipleTools:
    async def test_all_tools_in_list_receive_injection(self):
        """Every tool in the list must receive the wrapper."""
        seen_a: list[Any] = []
        seen_b: list[Any] = []

        tool_a = _make_tool(seen_a)
        tool_b = _make_tool(seen_b)

        inject_project_path([tool_a, tool_b], PROJECT)

        await tool_a.ainvoke({"tool": "a"})
        await tool_b.ainvoke({"tool": "b"})

        assert seen_a[0]["project_path"] == PROJECT
        assert seen_b[0]["project_path"] == PROJECT


# ---------------------------------------------------------------------------
# 9. Pydantic model compatibility — guards against __setattr__ regression
# ---------------------------------------------------------------------------

class TestPydanticModelCompatibility:
    """Verify that inject_project_path works on Pydantic BaseModel subclasses.

    The production tool objects are ``StructuredTool`` instances, which inherit
    from Pydantic's ``BaseModel``.  Pydantic v2 rejects attribute writes to
    undeclared fields via ``BaseModel.__setattr__``.  These tests ensure the
    wrapper correctly bypasses that guard.

    See: bug-report-orchestrator.md (2026-03-20)
    """

    async def test_pydantic_basemodel_subclass_can_be_wrapped(self):
        """inject_project_path must not raise on a Pydantic BaseModel subclass."""
        from pydantic import BaseModel, ConfigDict

        seen: list[Any] = []

        class PydanticTool(BaseModel):
            model_config = ConfigDict(arbitrary_types_allowed=True)
            name: str = "pydantic_tool"

            async def ainvoke(self, input: Any, *args: Any, **kwargs: Any) -> str:
                seen.append(input)
                return "ok"

        tool = PydanticTool()
        inject_project_path([tool], PROJECT)

        await tool.ainvoke({})

        assert len(seen) == 1
        assert seen[0]["project_path"] == PROJECT

    async def test_structured_tool_can_be_wrapped(self):
        """inject_project_path must work on a real StructuredTool instance."""
        from langchain_core.tools import StructuredTool

        seen: list[Any] = []

        async def _fake_func(project_path: str = "", **kwargs: Any) -> str:
            seen.append({"project_path": project_path, **kwargs})
            return "ok"

        tool = StructuredTool.from_function(
            coroutine=_fake_func,
            name="fake_mcp_tool",
            description="A fake tool for testing.",
        )

        # This is the line that raised ValueError before the fix.
        inject_project_path([tool], PROJECT)

        await tool.ainvoke({})

        assert len(seen) == 1
        assert seen[0].get("project_path") == PROJECT

    async def test_structured_tool_idempotency(self):
        """Double-wrapping a StructuredTool must not stack closures."""
        from langchain_core.tools import StructuredTool

        call_count = 0

        async def _counting_func(project_path: str = "", **kwargs: Any) -> str:
            nonlocal call_count
            call_count += 1
            return "ok"

        tool = StructuredTool.from_function(
            coroutine=_counting_func,
            name="counting_tool",
            description="Counts calls.",
        )

        inject_project_path([tool], PROJECT)
        inject_project_path([tool], PROJECT)

        await tool.ainvoke({})

        assert call_count == 1, (
            f"Original ainvoke called {call_count} times — wrapper stacking on StructuredTool"
        )


# ---------------------------------------------------------------------------
# 10. ToolCall dict structure — LangGraph ToolNode passes nested args
# ---------------------------------------------------------------------------

class TestToolCallDictStructure:
    """Verify that injection works when ainvoke receives a ToolCall dict.

    LangGraph's ToolNode passes ``{"name": ..., "args": {...}, "id": ...,
    "type": "tool_call"}`` to ``tool.ainvoke``.  The wrapper must inject
    ``project_path`` into ``input["args"]``, not the top-level dict.
    """

    async def test_toolcall_injects_project_path_into_args(self):
        """project_path must be injected into input['args'], not top level."""
        seen: list[Any] = []
        tool = _make_tool(seen)
        inject_project_path([tool], PROJECT)

        await tool.ainvoke({
            "name": "ledger_create_work_package",
            "args": {"work_package_id": "WP-001"},
            "id": "call-1",
            "type": "tool_call",
        })

        result = seen[0]
        assert result["args"]["project_path"] == PROJECT
        assert "project_path" not in {k for k in result if k != "args"}

    async def test_toolcall_overwrites_cwd_path_in_args(self):
        """A caller-supplied cwd_path inside input['args'] must be overwritten
        with the authoritative project path; project_path must also be injected.
        """
        seen: list[Any] = []
        tool = _make_tool(seen)
        inject_project_path([tool], PROJECT)

        await tool.ainvoke({
            "name": "ledger_get_project_status",
            "args": {"cwd_path": "/"},
            "id": "call-2",
            "type": "tool_call",
        })

        result = seen[0]
        assert result["args"]["cwd_path"] == PROJECT, (
            "caller-supplied cwd_path in args must be replaced with authoritative project path"
        )
        assert result["args"]["project_path"] == PROJECT

    async def test_toolcall_preserves_explicit_project_path(self):
        """An explicit project_path in args must not be overwritten."""
        seen: list[Any] = []
        tool = _make_tool(seen)
        inject_project_path([tool], PROJECT)

        explicit = "/explicit/project"
        await tool.ainvoke({
            "name": "some_tool",
            "args": {"project_path": explicit},
            "id": "call-3",
            "type": "tool_call",
        })

        assert seen[0]["args"]["project_path"] == explicit

    async def test_toolcall_preserves_other_args(self):
        """Other args in the ToolCall must survive untouched."""
        seen: list[Any] = []
        tool = _make_tool(seen)
        inject_project_path([tool], PROJECT)

        await tool.ainvoke({
            "name": "ledger_claim_work_package",
            "args": {"work_package_id": "WP-007", "agent_role": "Developer"},
            "id": "call-4",
            "type": "tool_call",
        })

        result = seen[0]["args"]
        assert result["work_package_id"] == "WP-007"
        assert result["agent_role"] == "Developer"
        assert result["project_path"] == PROJECT


# ---------------------------------------------------------------------------
# 11. Dual injection (WP-001 acceptance criteria)
# ---------------------------------------------------------------------------

class TestDualInjection:
    """Verify that both project_path and cwd_path are always injected.

    These tests directly map to the WP-001 acceptance criteria:

    AC1 — No-argument call → both parameters set to the injected project path.
    AC2 — Explicit cwd_path supplied → value stripped, authoritative path
          re-injected as cwd_path; project_path also injected.
    AC3 — Explicit project_path supplied → preserved (setdefault); cwd_path
          still injected with authoritative path.
    AC4 — Same behaviour for both flat-dict and ToolCall nested-dict structures.
    """

    # AC1 — empty call dict receives both parameters

    async def test_ac1_empty_dict_receives_both_parameters(self):
        """AC1: no-argument call → project_path AND cwd_path both set."""
        seen: list[Any] = []
        tool = _make_tool(seen)
        inject_project_path([tool], PROJECT)

        await tool.ainvoke({})

        assert seen[0]["project_path"] == PROJECT
        assert seen[0]["cwd_path"] == PROJECT

    async def test_ac1_toolcall_empty_args_receives_both_parameters(self):
        """AC1 (ToolCall): empty args dict → project_path AND cwd_path both set."""
        seen: list[Any] = []
        tool = _make_tool(seen)
        inject_project_path([tool], PROJECT)

        await tool.ainvoke({
            "name": "ledger_get_next_action",
            "args": {},
            "id": "call-ac1",
            "type": "tool_call",
        })

        assert seen[0]["args"]["project_path"] == PROJECT
        assert seen[0]["args"]["cwd_path"] == PROJECT

    # AC2 — explicit cwd_path value replaced with authoritative path

    async def test_ac2_explicit_cwd_path_replaced_flat_dict(self):
        """AC2 (flat dict): caller-supplied cwd_path is overwritten; project_path injected."""
        seen: list[Any] = []
        tool = _make_tool(seen)
        inject_project_path([tool], PROJECT)

        await tool.ainvoke({"cwd_path": "/caller/workspace"})

        assert seen[0]["cwd_path"] == PROJECT, (
            "cwd_path must be overwritten with authoritative path, not the caller value"
        )
        assert seen[0]["project_path"] == PROJECT

    async def test_ac2_explicit_cwd_path_replaced_toolcall(self):
        """AC2 (ToolCall): caller-supplied cwd_path in args is overwritten."""
        seen: list[Any] = []
        tool = _make_tool(seen)
        inject_project_path([tool], PROJECT)

        await tool.ainvoke({
            "name": "ledger_detect_project",
            "args": {"cwd_path": "/caller/workspace"},
            "id": "call-ac2",
            "type": "tool_call",
        })

        assert seen[0]["args"]["cwd_path"] == PROJECT
        assert seen[0]["args"]["project_path"] == PROJECT

    # AC3 — explicit project_path preserved; cwd_path still injected

    async def test_ac3_explicit_project_path_preserved_flat_dict(self):
        """AC3 (flat dict): explicit project_path kept; cwd_path still injected."""
        seen: list[Any] = []
        tool = _make_tool(seen)
        inject_project_path([tool], PROJECT)

        explicit = "/custom/project"
        await tool.ainvoke({"project_path": explicit})

        assert seen[0]["project_path"] == explicit, (
            "explicit project_path must not be overwritten (setdefault semantics)"
        )
        assert seen[0]["cwd_path"] == PROJECT, (
            "cwd_path must still be injected even when project_path is explicit"
        )

    async def test_ac3_explicit_project_path_preserved_toolcall(self):
        """AC3 (ToolCall): explicit project_path in args kept; cwd_path injected."""
        seen: list[Any] = []
        tool = _make_tool(seen)
        inject_project_path([tool], PROJECT)

        explicit = "/custom/project"
        await tool.ainvoke({
            "name": "some_ledger_tool",
            "args": {"project_path": explicit},
            "id": "call-ac3",
            "type": "tool_call",
        })

        assert seen[0]["args"]["project_path"] == explicit
        assert seen[0]["args"]["cwd_path"] == PROJECT

    # AC4 — both invocation structures behave identically (covered by AC1–3
    # above, but one explicit symmetry test for clarity)

    async def test_ac4_flat_dict_and_toolcall_behave_identically(self):
        """AC4: flat-dict and ToolCall nested-dict produce the same injected values."""
        seen_flat: list[Any] = []
        seen_toolcall: list[Any] = []

        tool_flat = _make_tool(seen_flat)
        tool_toolcall = _make_tool(seen_toolcall)
        inject_project_path([tool_flat, tool_toolcall], PROJECT)

        payload_keys = {"work_package_id": "WP-001", "agent": "Developer"}

        # Flat dict
        await tool_flat.ainvoke(dict(payload_keys))

        # ToolCall nested dict (same logical payload)
        await tool_toolcall.ainvoke({
            "name": "ledger_claim_work_package",
            "args": dict(payload_keys),
            "id": "call-ac4",
            "type": "tool_call",
        })

        flat_result = seen_flat[0]
        toolcall_result = seen_toolcall[0]["args"]

        for result in (flat_result, toolcall_result):
            assert result["project_path"] == PROJECT
            assert result["cwd_path"] == PROJECT
            assert result["work_package_id"] == "WP-001"
            assert result["agent"] == "Developer"

