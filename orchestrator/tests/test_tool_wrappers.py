"""
test_tool_wrappers.py — Unit tests for src.utils.tool_wrappers.

Tests cover every behavioural contract promised by ``log_tool_calls`` (AC
coverage for WP-001) and ``inject_project_path``:

1. **Injection when absent** — ``project_path`` is added when the tool call
   dict does not already contain it.
2. **No override when present** — an explicitly-supplied ``project_path`` is
   never overwritten (setdefault semantics).
3. **cwd_path removal** — any caller-supplied ``cwd_path`` value is removed
   to prevent mutual-exclusivity violations in MCP tools.
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

from src.utils.tool_wrappers import inject_project_path, restrict_to_wp

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
    async def test_cwd_path_removed_and_project_path_injected(self):
        """A caller-supplied cwd_path must be removed to prevent
        mutual-exclusivity violations, and project_path must be injected.
        """
        seen: list[Any] = []
        tool = _make_tool(seen)
        inject_project_path([tool], PROJECT)

        await tool.ainvoke({"cwd_path": "/some/workspace"})

        assert "cwd_path" not in seen[0], (
            "caller-supplied cwd_path must be removed"
        )
        assert seen[0]["project_path"] == PROJECT

    async def test_explicit_project_path_preserved_cwd_path_removed(self):
        """When both cwd_path and project_path are supplied by the caller:
        - project_path is kept (setdefault semantics)
        - cwd_path is removed
        """
        seen: list[Any] = []
        tool = _make_tool(seen)
        inject_project_path([tool], PROJECT)

        await tool.ainvoke({"cwd_path": "/cwd/value", "project_path": "/explicit"})

        assert "cwd_path" not in seen[0], (
            "cwd_path must be removed"
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

    async def test_toolcall_removes_cwd_path_in_args(self):
        """A caller-supplied cwd_path inside input['args'] must be removed;
        project_path must be injected.
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
        assert "cwd_path" not in result["args"], (
            "caller-supplied cwd_path in args must be removed"
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

class TestCwdPathRemoval:
    """Verify that cwd_path is removed and only project_path is injected.

    MCP tools enforce mutual exclusivity between project_path and cwd_path.
    The orchestrator always knows the exact project_path, so cwd_path is
    unnecessary and must be stripped to prevent validation errors.

    AC1 — No-argument call → only project_path set.
    AC2 — Explicit cwd_path supplied → removed; project_path injected.
    AC3 — Explicit project_path supplied → preserved (setdefault); cwd_path
          removed if present.
    AC4 — Same behaviour for both flat-dict and ToolCall nested-dict structures.
    """

    # AC1 — empty call dict receives project_path only

    async def test_ac1_empty_dict_receives_project_path(self):
        """AC1: no-argument call → project_path set, cwd_path absent."""
        seen: list[Any] = []
        tool = _make_tool(seen)
        inject_project_path([tool], PROJECT)

        await tool.ainvoke({})

        assert seen[0]["project_path"] == PROJECT
        assert "cwd_path" not in seen[0]

    async def test_ac1_toolcall_empty_args_receives_project_path(self):
        """AC1 (ToolCall): empty args dict → project_path set, cwd_path absent."""
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
        assert "cwd_path" not in seen[0]["args"]

    # AC2 — explicit cwd_path removed, project_path injected

    async def test_ac2_explicit_cwd_path_removed_flat_dict(self):
        """AC2 (flat dict): caller-supplied cwd_path is removed; project_path injected."""
        seen: list[Any] = []
        tool = _make_tool(seen)
        inject_project_path([tool], PROJECT)

        await tool.ainvoke({"cwd_path": "/caller/workspace"})

        assert "cwd_path" not in seen[0], (
            "cwd_path must be removed, not kept or overwritten"
        )
        assert seen[0]["project_path"] == PROJECT

    async def test_ac2_explicit_cwd_path_removed_toolcall(self):
        """AC2 (ToolCall): caller-supplied cwd_path in args is removed."""
        seen: list[Any] = []
        tool = _make_tool(seen)
        inject_project_path([tool], PROJECT)

        await tool.ainvoke({
            "name": "ledger_detect_project",
            "args": {"cwd_path": "/caller/workspace"},
            "id": "call-ac2",
            "type": "tool_call",
        })

        assert "cwd_path" not in seen[0]["args"]
        assert seen[0]["args"]["project_path"] == PROJECT

    # AC3 — explicit project_path preserved; cwd_path removed

    async def test_ac3_explicit_project_path_preserved_flat_dict(self):
        """AC3 (flat dict): explicit project_path kept; cwd_path absent."""
        seen: list[Any] = []
        tool = _make_tool(seen)
        inject_project_path([tool], PROJECT)

        explicit = "/custom/project"
        await tool.ainvoke({"project_path": explicit})

        assert seen[0]["project_path"] == explicit, (
            "explicit project_path must not be overwritten (setdefault semantics)"
        )
        assert "cwd_path" not in seen[0]

    async def test_ac3_explicit_project_path_preserved_toolcall(self):
        """AC3 (ToolCall): explicit project_path in args kept; no cwd_path."""
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
        assert "cwd_path" not in seen[0]["args"]

    # AC4 — both invocation structures behave identically

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
            assert "cwd_path" not in result
            assert result["work_package_id"] == "WP-001"
            assert result["agent"] == "Developer"


# ---------------------------------------------------------------------------
# 12. restrict_to_wp — WP scope guard
# ---------------------------------------------------------------------------

ACTIVE_WP = "WP-001"


class _GuardTool:
    """Plain-class tool stub for restrict_to_wp tests.

    Avoids MagicMock so ``hasattr(tool, '_orig_ainvoke_wp')`` correctly returns
    False before the first wrap (MagicMock auto-creates every attribute).
    """

    def __init__(self, seen: list[Any] | None = None) -> None:
        _seen: list[Any] = seen if seen is not None else []
        self.name = "guard_tool"

        async def _ainvoke(input: Any, *args: Any, **kwargs: Any) -> str:
            _seen.append(input)
            return "ok"

        self.ainvoke = _ainvoke


def _make_guard_tool(captured: list[Any] | None = None) -> _GuardTool:
    return _GuardTool(seen=captured if captured is not None else [])


class TestRestrictToWpImportable:
    def test_importable(self):
        """restrict_to_wp must be importable from src.utils.tool_wrappers."""
        assert callable(restrict_to_wp)


class TestRestrictToWpEmptyWpId:
    def test_empty_wp_id_returns_tools_unchanged(self):
        """When wp_id is empty, the function must return the tools list unchanged."""
        tool = _make_guard_tool()
        original_ainvoke = tool.ainvoke
        result = restrict_to_wp([tool], "")
        assert result is not None
        assert tool.ainvoke is original_ainvoke, (
            "ainvoke must not be replaced when wp_id is empty"
        )

    def test_empty_wp_id_no_sentinel_set(self):
        """When wp_id is empty, the _orig_ainvoke_wp sentinel must not be set."""
        tool = _make_guard_tool()
        restrict_to_wp([tool], "")
        assert not hasattr(tool, "_orig_ainvoke_wp"), (
            "_orig_ainvoke_wp must not be set when wp_id is empty"
        )

    def test_empty_wp_id_returns_same_list(self):
        """restrict_to_wp with empty wp_id must return the same list object."""
        tools = [_make_guard_tool()]
        result = restrict_to_wp(tools, "")
        assert result is tools


class TestRestrictToWpMatchingWpId:
    async def test_matching_wp_id_passes_through(self):
        """A call with work_package_id matching the active WP must succeed."""
        seen: list[Any] = []
        tool = _make_guard_tool(seen)
        restrict_to_wp([tool], ACTIVE_WP)

        await tool.ainvoke({"work_package_id": ACTIVE_WP, "agent": "Developer"})

        assert len(seen) == 1
        assert seen[0]["work_package_id"] == ACTIVE_WP

    async def test_call_without_wp_id_injects_active_wp(self):
        """A call that omits work_package_id must have it auto-injected with the active WP ID."""
        seen: list[Any] = []
        tool = _make_guard_tool(seen)
        restrict_to_wp([tool], ACTIVE_WP)

        await tool.ainvoke({"agent_role": "Developer"})

        assert len(seen) == 1
        assert seen[0]["work_package_id"] == ACTIVE_WP

    async def test_non_dict_input_passes_through(self):
        """Non-dict input (e.g. a string) must be forwarded without a guard check."""
        seen: list[Any] = []
        tool = _make_guard_tool(seen)
        restrict_to_wp([tool], ACTIVE_WP)

        await tool.ainvoke("raw string")

        assert seen[0] == "raw string"

    async def test_toolcall_structure_matching_wp_id_passes(self):
        """ToolCall nested-dict with matching work_package_id must pass through."""
        seen: list[Any] = []
        tool = _make_guard_tool(seen)
        restrict_to_wp([tool], ACTIVE_WP)

        await tool.ainvoke({
            "name": "ledger_complete_pipeline",
            "args": {"work_package_id": ACTIVE_WP},
            "id": "call-1",
            "type": "tool_call",
        })

        assert len(seen) == 1

    async def test_toolcall_without_wp_id_injects_active_wp(self):
        """ToolCall nested-dict that omits work_package_id must have it auto-injected."""
        seen: list[Any] = []
        tool = _make_guard_tool(seen)
        restrict_to_wp([tool], ACTIVE_WP)

        await tool.ainvoke({
            "name": "ledger_get_next_action",
            "args": {"agent_role": "Developer"},
            "id": "call-2",
            "type": "tool_call",
        })

        assert len(seen) == 1
        assert seen[0]["args"]["work_package_id"] == ACTIVE_WP


class TestRestrictToWpMismatchRaises:
    async def test_mismatching_wp_id_raises_value_error(self):
        """Third cross-WP call (after two soft-fails) must raise ValueError."""
        tool = _make_guard_tool()
        restrict_to_wp([tool], ACTIVE_WP)

        # First two violations return error strings (soft-fail).
        result1 = await tool.ainvoke({"work_package_id": "WP-002"})
        assert isinstance(result1, str)
        result2 = await tool.ainvoke({"work_package_id": "WP-002"})
        assert isinstance(result2, str)

        # Third violation must raise ValueError.
        with pytest.raises(ValueError, match="WP-002"):
            await tool.ainvoke({"work_package_id": "WP-002"})

    async def test_value_error_message_contains_active_wp(self):
        """The ValueError message must mention the active WP ID for diagnostics."""
        tool = _make_guard_tool()
        restrict_to_wp([tool], ACTIVE_WP)

        # Exhaust soft-fail allowance first.
        for _ in range(2):
            await tool.ainvoke({"work_package_id": "WP-999"})
        with pytest.raises(ValueError, match=ACTIVE_WP):
            await tool.ainvoke({"work_package_id": "WP-999"})

    async def test_toolcall_mismatch_raises_value_error(self):
        """ToolCall structure with mismatching work_package_id
        raises ValueError on third violation."""
        tool = _make_guard_tool()
        restrict_to_wp([tool], ACTIVE_WP)

        # Exhaust soft-fail allowance.
        for _ in range(2):
            await tool.ainvoke({
                "name": "ledger_begin_work",
                "args": {"work_package_id": "WP-007"},
                "id": "call-bad",
                "type": "tool_call",
            })
        with pytest.raises(ValueError):
            await tool.ainvoke({
                "name": "ledger_begin_work",
                "args": {"work_package_id": "WP-007"},
                "id": "call-bad",
                "type": "tool_call",
            })


# ---------------------------------------------------------------------------
# 12b. Soft-fail strike counter behavior (WP-001 acceptance criteria)
# ---------------------------------------------------------------------------


class TestRestrictToWpSoftFail:
    """Full behavior of the 2-strike soft-fail counter in restrict_to_wp."""

    async def test_first_violation_returns_error_string(self):
        """First cross-WP call must return a descriptive error string, not raise."""
        tool = _make_guard_tool()
        restrict_to_wp([tool], ACTIVE_WP)

        result = await tool.ainvoke({"work_package_id": "WP-002"})

        assert isinstance(result, str), "First violation must return a string, not raise"
        assert "ERROR" in result

    async def test_first_violation_error_string_contains_both_wp_ids(self):
        """The returned error string must mention both the wrong and the expected WP ID."""
        tool = _make_guard_tool()
        restrict_to_wp([tool], ACTIVE_WP)

        result = await tool.ainvoke({"work_package_id": "WP-002"})

        assert "WP-002" in result, "Error string must mention the rejected WP ID"
        assert ACTIVE_WP in result, "Error string must mention the active WP ID"

    async def test_second_violation_returns_error_string(self):
        """Second cross-WP call must also return an error string (still within soft-fail limit)."""
        tool = _make_guard_tool()
        restrict_to_wp([tool], ACTIVE_WP)

        result1 = await tool.ainvoke({"work_package_id": "WP-002"})
        result2 = await tool.ainvoke({"work_package_id": "WP-002"})

        assert isinstance(result1, str) and "ERROR" in result1
        assert isinstance(result2, str) and "ERROR" in result2

    async def test_third_violation_raises_value_error(self):
        """Third cross-WP call must raise ValueError (hard kill)."""
        tool = _make_guard_tool()
        restrict_to_wp([tool], ACTIVE_WP)

        await tool.ainvoke({"work_package_id": "WP-002"})  # strike 1
        await tool.ainvoke({"work_package_id": "WP-002"})  # strike 2
        with pytest.raises(ValueError):
            await tool.ainvoke({"work_package_id": "WP-002"})  # strike 3 → hard kill

    async def test_strike_counter_shared_across_tools(self):
        """Violations from different tools must count toward the same shared counter."""
        tool_a = _make_guard_tool()
        tool_b = _make_guard_tool()
        tool_a.name = "tool_a"
        tool_b.name = "tool_b"
        restrict_to_wp([tool_a, tool_b], ACTIVE_WP)

        # Strike 1 from tool_a.
        result1 = await tool_a.ainvoke({"work_package_id": "WP-002"})
        assert isinstance(result1, str) and "ERROR" in result1

        # Strike 2 from tool_b.
        result2 = await tool_b.ainvoke({"work_package_id": "WP-002"})
        assert isinstance(result2, str) and "ERROR" in result2

        # Strike 3 from tool_a — shared counter is at 2, so this must hard-kill.
        with pytest.raises(ValueError):
            await tool_a.ainvoke({"work_package_id": "WP-002"})

    async def test_correct_calls_do_not_increment_counter(self):
        """Successful calls (matching WP ID) must not affect the strike counter."""
        seen: list[Any] = []
        tool = _make_guard_tool(seen)
        restrict_to_wp([tool], ACTIVE_WP)

        # Many correct calls — counter must not advance.
        for _ in range(10):
            await tool.ainvoke({"work_package_id": ACTIVE_WP})

        # After 10 correct calls, the first violation must still be a soft-fail.
        result = await tool.ainvoke({"work_package_id": "WP-002"})
        assert isinstance(result, str) and "ERROR" in result, (
            "Correct calls must not increment the strike counter"
        )
        assert len(seen) == 10, "Only correct calls must reach the underlying tool"

    async def test_toolcall_structure_first_violation_returns_tool_message(self):
        """ToolCall nested-dict structure: first violation must return ToolMessage."""
        from langchain_core.messages import ToolMessage

        tool = _make_guard_tool()
        restrict_to_wp([tool], ACTIVE_WP)

        result = await tool.ainvoke({
            "name": "ledger_begin_work",
            "args": {"work_package_id": "WP-007"},
            "id": "call-soft",
            "type": "tool_call",
        })

        assert isinstance(result, ToolMessage), (
            f"Expected ToolMessage, got {type(result).__name__}"
        )
        assert result.status == "error"
        assert "ERROR" in result.content

    async def test_counter_resets_on_new_restrict_call(self):
        """Calling restrict_to_wp again creates a fresh counter (simulating new stage)."""
        tool = _make_guard_tool()
        restrict_to_wp([tool], ACTIVE_WP)

        # Use up both soft-fail allowances.
        await tool.ainvoke({"work_package_id": "WP-002"})  # strike 1
        await tool.ainvoke({"work_package_id": "WP-002"})  # strike 2

        # Re-wrap (simulating a new stage invocation).
        restrict_to_wp([tool], ACTIVE_WP)

        # Counter should have reset — first violation is soft-fail again.
        result = await tool.ainvoke({"work_package_id": "WP-002"})
        assert isinstance(result, str) and "ERROR" in result, (
            "Counter must reset when restrict_to_wp is called again"
        )


class TestRestrictToWpIdempotency:
    async def test_double_wrap_does_not_stack_closures(self):
        """Calling restrict_to_wp twice on the same tool must not double the guard check."""
        call_count = 0

        class _CountingTool:
            name = "counting_tool"

            async def ainvoke(self, input: Any, *args: Any, **kwargs: Any) -> str:
                nonlocal call_count
                call_count += 1
                return "ok"

        tool = _CountingTool()
        restrict_to_wp([tool], ACTIVE_WP)
        restrict_to_wp([tool], ACTIVE_WP)

        await tool.ainvoke({"work_package_id": ACTIVE_WP})

        assert call_count == 1, (
            f"Original ainvoke called {call_count} times — wrapper stacking occurred"
        )

    async def test_double_wrap_still_guards(self):
        """After double-wrap, the guard must still fire: first mismatch returns an error string."""
        tool = _make_guard_tool()
        restrict_to_wp([tool], ACTIVE_WP)
        restrict_to_wp([tool], ACTIVE_WP)

        result = await tool.ainvoke({"work_package_id": "WP-bad"})
        assert isinstance(result, str), (
            "Guard must return error string on first mismatch after double-wrap"
        )
        assert "ERROR" in result

    def test_double_wrap_returns_same_list(self):
        """restrict_to_wp must return the same list object (in-place mutation)."""
        tools = [_make_guard_tool()]
        result = restrict_to_wp(tools, ACTIVE_WP)
        assert result is tools


class TestRestrictToWpReadOnlyExemption:
    """Read-only tools (e.g. ledger_get_work_package) must be exempt from
    the cross-WP guard so agents can read other work packages for context."""

    def _make_read_tool(
        self,
        seen: list[Any] | None = None,
        name: str = "ledger_get_work_package",
    ) -> _GuardTool:
        tool = _make_guard_tool(seen)
        tool.name = name
        return tool

    async def test_read_tool_with_different_wp_passes(self):
        """A read-only tool targeting a different WP must NOT raise ValueError."""
        seen: list[Any] = []
        tool = self._make_read_tool(seen)
        restrict_to_wp([tool], ACTIVE_WP)

        # WP-002 ≠ ACTIVE_WP ("WP-001") — must pass for read-only tools.
        await tool.ainvoke({"work_package_id": "WP-002"})

        assert len(seen) == 1
        assert seen[0]["work_package_id"] == "WP-002"

    async def test_read_tool_does_not_get_wp_injected(self):
        """A read-only tool that omits work_package_id must NOT have it auto-injected."""
        seen: list[Any] = []
        tool = self._make_read_tool(seen)
        restrict_to_wp([tool], ACTIVE_WP)

        await tool.ainvoke({"agent_role": "Developer"})

        assert len(seen) == 1
        assert "work_package_id" not in seen[0]

    async def test_read_tool_ainvoke_not_replaced(self):
        """A read-only tool's ainvoke must not be wrapped at all."""
        tool = self._make_read_tool()
        original = tool.ainvoke
        restrict_to_wp([tool], ACTIVE_WP)

        assert tool.ainvoke is original

    async def test_write_tool_still_guarded(self):
        """A write tool in the same call must still be guarded; read tool passes freely."""
        read_tool = self._make_read_tool()
        write_tool = _make_guard_tool()
        write_tool.name = "ledger_begin_work"

        restrict_to_wp([read_tool, write_tool], ACTIVE_WP)

        # Read tool — cross-WP passes without restriction.
        await read_tool.ainvoke({"work_package_id": "WP-002"})

        # Write tool — first cross-WP call returns error string (soft-fail guard is active).
        result = await write_tool.ainvoke({"work_package_id": "WP-002"})
        assert isinstance(result, str) and "ERROR" in result, (
            "Write tool must be guarded — first violation must return error string"
        )

    async def test_all_read_only_tools_exempt(self):
        """Every tool in _READ_ONLY_TOOLS must be exempt from the guard."""
        from src.utils.tool_wrappers import _READ_ONLY_TOOLS

        for tool_name in _READ_ONLY_TOOLS:
            tool = self._make_read_tool(name=tool_name)
            original = tool.ainvoke
            restrict_to_wp([tool], ACTIVE_WP)
            assert tool.ainvoke is original, (
                f"{tool_name} should be exempt but ainvoke was replaced"
            )

    async def test_toolcall_structure_read_tool_passes(self):
        """ToolCall nested-dict with a different WP must pass for read-only tools."""
        seen: list[Any] = []
        tool = self._make_read_tool(seen)
        restrict_to_wp([tool], ACTIVE_WP)

        await tool.ainvoke({
            "name": "ledger_get_work_package",
            "args": {"work_package_id": "WP-003"},
            "id": "call-read",
            "type": "tool_call",
        })

        assert len(seen) == 1
        assert seen[0]["args"]["work_package_id"] == "WP-003"


class TestRestrictToWpIntegrationWithInjectProjectPath:
    """Verify that restrict_to_wp composes correctly with inject_project_path."""

    async def test_chained_wrappers_matching_wp_passes(self):
        """inject_project_path followed by restrict_to_wp — matching WP passes through."""
        seen: list[Any] = []
        tool = _make_guard_tool(seen)
        inject_project_path([tool], PROJECT)
        restrict_to_wp([tool], ACTIVE_WP)

        await tool.ainvoke({"work_package_id": ACTIVE_WP})

        assert len(seen) == 1
        assert seen[0]["project_path"] == PROJECT

    async def test_chained_wrappers_mismatch_raises(self):
        """inject_project_path followed by restrict_to_wp — third mismatch raises ValueError."""
        tool = _make_guard_tool()
        inject_project_path([tool], PROJECT)
        restrict_to_wp([tool], ACTIVE_WP)

        # Exhaust soft-fail allowance.
        for _ in range(2):
            await tool.ainvoke({"work_package_id": "WP-999"})
        with pytest.raises(ValueError):
            await tool.ainvoke({"work_package_id": "WP-999"})


class TestSharedToolReWrapAcrossWPs:
    """Regression: shared tool objects re-wrapped for a different WP must
    enforce the *new* WP, not the stale one from the previous invocation.

    This reproduces the production bug where the full wrapper chain
    (inject → restrict → log) captured stale sentinel targets, causing
    the outermost wrapper to bypass the updated WP guard.
    """

    async def test_full_chain_rewrap_enforces_new_wp(self):
        """Simulate two node invocations on the same tool objects with different WPs."""
        from src.utils.tool_wrappers import log_tool_calls

        seen: list[Any] = []
        tool = _make_guard_tool(seen)

        # --- First node invocation (WP-001) ---
        inject_project_path([tool], PROJECT)
        restrict_to_wp([tool], "WP-001")
        log_tool_calls([tool], stage="developer", wp_id="WP-001", logger=_MockLogger())

        await tool.ainvoke({"work_package_id": "WP-001"})
        assert len(seen) == 1

        # --- Second node invocation (WP-002) ---
        inject_project_path([tool], PROJECT)
        restrict_to_wp([tool], "WP-002")
        log_tool_calls([tool], stage="developer", wp_id="WP-002", logger=_MockLogger())

        # Must succeed — the guard should now enforce WP-002, not WP-001.
        await tool.ainvoke({"work_package_id": "WP-002"})
        assert len(seen) == 2

    async def test_full_chain_rewrap_rejects_old_wp(self):
        """After re-wrapping for WP-002, calls targeting WP-001 must be rejected."""
        from src.utils.tool_wrappers import log_tool_calls

        tool = _make_guard_tool()

        # First invocation (WP-001)
        inject_project_path([tool], PROJECT)
        restrict_to_wp([tool], "WP-001")
        log_tool_calls([tool], stage="developer", wp_id="WP-001", logger=_MockLogger())

        # Second invocation (WP-002) — counter resets because restrict_to_wp is re-called.
        inject_project_path([tool], PROJECT)
        restrict_to_wp([tool], "WP-002")
        log_tool_calls([tool], stage="developer", wp_id="WP-002", logger=_MockLogger())

        # First WP-001 call after re-wrap is soft-fail (returns error string).
        result = await tool.ainvoke({"work_package_id": "WP-001"})
        assert isinstance(result, str) and "ERROR" in result, (
            "Cross-WP call must return error string on first violation after re-wrap"
        )


def _make_stage_node_state(*, current_wp_id: str = "WP-001") -> dict:
    """Minimal WorkflowState dict for create_stage_node integration tests."""
    return {
        "project_path": "/test/project",
        "plan_file": "plan.md",
        "target_project_path": "",
        "current_stage": "",
        "current_wp_id": current_wp_id,
        "iteration": 1,
        "max_iterations": 10,
        "stage_result": "",
        "stage_success": True,
        "project_status": "",
        "wp_summaries": [],
        "pending_wp_count": 0,
        "run_log": [],
        "errors": [],
    }


class TestRestrictToWpInCreateStageNode:
    """Verify that create_stage_node applies restrict_to_wp after inject_project_path."""

    async def test_restrict_to_wp_applied_in_node(self):
        """create_stage_node must call restrict_to_wp with the active WP ID."""
        from unittest.mock import MagicMock, patch

        from src.nodes import create_stage_node

        class _FakeConfig:
            stage_models = {
                "developer": "claude-test",
                **{s: "claude-test" for s in ("pm", "qa", "reviewer", "security_auditor",
                                               "docs", "release_engineer", "synthesis", "planner")},
            }
            workspace_root = __import__("pathlib").Path(__file__).resolve().parent.parent.parent
            capture_dialogues = False

            def resolve_model_for_stage(self, stage: str) -> str:
                return self.stage_models.get(stage, "claude-test")

        restrict_calls: list[dict] = []

        def _fake_restrict(tools: list, wp_id: str) -> list:
            restrict_calls.append({"tools": tools, "wp_id": wp_id})
            return tools

        def _fake_create_agent(**kwargs: Any) -> MagicMock:
            agent = MagicMock()
            agent.ainvoke = AsyncMock(
                return_value={"messages": [MagicMock(content="done")]}
            )
            return agent

        node_fn = create_stage_node(
            stage="developer",
            build_prompt=lambda state: "Test prompt",
            config=_FakeConfig(),
            mcp_tools=[_make_guard_tool()],
        )

        with patch("src.utils.persona.load_persona", return_value="persona"), \
             patch("src.nodes.restrict_to_wp", side_effect=_fake_restrict), \
             patch("deepagents.create_deep_agent", side_effect=_fake_create_agent), \
             patch("deepagents.backends.LocalShellBackend", return_value=MagicMock()):
            await node_fn(_make_stage_node_state(current_wp_id="WP-042"))

        assert restrict_calls, "restrict_to_wp must be called by create_stage_node"
        assert restrict_calls[0]["wp_id"] == "WP-042", (
            f"restrict_to_wp called with wrong wp_id: {restrict_calls[0]['wp_id']!r}"
        )

    async def test_restrict_to_wp_not_applied_when_wp_id_empty(self):
        """create_stage_node must not apply restrict_to_wp when wp_id is empty."""
        from unittest.mock import MagicMock, patch

        from src.nodes import create_stage_node

        class _FakeConfig:
            stage_models = {
                "developer": "claude-test",
                **{s: "claude-test" for s in ("pm", "qa", "reviewer", "security_auditor",
                                               "docs", "release_engineer", "synthesis", "planner")},
            }
            workspace_root = __import__("pathlib").Path(__file__).resolve().parent.parent.parent
            capture_dialogues = False

            def resolve_model_for_stage(self, stage: str) -> str:
                return self.stage_models.get(stage, "claude-test")

        restrict_calls: list[dict] = []

        def _fake_restrict(tools: list, wp_id: str) -> list:
            restrict_calls.append({"tools": tools, "wp_id": wp_id})
            return tools

        def _fake_create_agent(**kwargs: Any) -> MagicMock:
            agent = MagicMock()
            agent.ainvoke = AsyncMock(
                return_value={"messages": [MagicMock(content="done")]}
            )
            return agent

        node_fn = create_stage_node(
            stage="developer",
            build_prompt=lambda state: "Test prompt",
            config=_FakeConfig(),
            mcp_tools=[_make_guard_tool()],
        )

        with patch("src.utils.persona.load_persona", return_value="persona"), \
             patch("src.nodes.restrict_to_wp", side_effect=_fake_restrict), \
             patch("deepagents.create_deep_agent", side_effect=_fake_create_agent), \
             patch("deepagents.backends.LocalShellBackend", return_value=MagicMock()):
            await node_fn(_make_stage_node_state(current_wp_id=""))

        assert not restrict_calls, (
            "restrict_to_wp must NOT be called when wp_id is empty"
        )


# ===========================================================================
# log_tool_calls — WP-001 Acceptance Criteria
# ===========================================================================

from src.utils.tool_wrappers import log_tool_calls  # noqa: E402


class _LogTool:
    """Minimal plain-Python tool stub for log_tool_calls tests.

    Uses a plain class (not MagicMock) so ``hasattr(tool, '_orig_ainvoke_log')``
    correctly returns ``False`` before the first wrap.
    """

    def __init__(self, seen: list[Any] | None = None, ret: Any = "log_result") -> None:
        _seen: list[Any] = seen if seen is not None else []
        self.name = "log_tool"

        async def _ainvoke(input: Any, *args: Any, **kwargs: Any) -> Any:
            _seen.append(input)
            return ret

        self.ainvoke = _ainvoke


def _make_log_tool(
    captured: list[Any] | None = None, ret: Any = "log_result"
) -> _LogTool:
    return _LogTool(seen=captured if captured is not None else [], ret=ret)


class _MockLogger:
    """Minimal logger stub that records stream_entry calls."""

    def __init__(self) -> None:
        self.entries: list[dict] = []

    def stream_entry(self, entry: dict) -> None:
        self.entries.append(entry)


# ---------------------------------------------------------------------------
# AC1 — Function signature
# ---------------------------------------------------------------------------


class TestLogToolCallsSignature:
    def test_importable(self) -> None:
        """log_tool_calls must be importable from src.utils.tool_wrappers."""
        assert callable(log_tool_calls)

    def test_signature_matches(self) -> None:
        """Signature must accept (tools, stage, wp_id, logger) and return list."""
        import inspect

        sig = inspect.signature(log_tool_calls)
        params = list(sig.parameters.keys())
        assert params == ["tools", "stage", "wp_id", "logger"], (
            f"Unexpected parameters: {params}"
        )

    def test_returns_list(self) -> None:
        """log_tool_calls must return a list."""
        tools = [_make_log_tool()]
        result = log_tool_calls(tools, stage="pm", wp_id="WP-001", logger=None)
        assert isinstance(result, list)

    def test_returns_same_list_object(self) -> None:
        """log_tool_calls must return the same list (in-place mutation)."""
        tools = [_make_log_tool()]
        logger = _MockLogger()
        result = log_tool_calls(tools, stage="pm", wp_id="WP-001", logger=logger)
        assert result is tools


# ---------------------------------------------------------------------------
# AC2 — Emitted event fields
# ---------------------------------------------------------------------------


class TestLogToolCallsEmitsEvent:
    async def test_emits_tool_call_action(self) -> None:
        """stream_entry must be called with action='tool_call'."""
        logger = _MockLogger()
        tool = _make_log_tool()
        log_tool_calls([tool], stage="pm", wp_id="WP-001", logger=logger)

        await tool.ainvoke({})

        assert len(logger.entries) == 1
        assert logger.entries[0]["action"] == "tool_call"

    async def test_emits_tool_name(self) -> None:
        """stream_entry event must contain tool_name matching tool.name."""
        logger = _MockLogger()
        tool = _make_log_tool()
        tool.name = "ledger_get_next_action"
        log_tool_calls([tool], stage="developer", wp_id="WP-002", logger=logger)

        await tool.ainvoke({})

        assert logger.entries[0]["tool_name"] == "ledger_get_next_action"

    async def test_emits_tool_wp_id_from_flat_dict(self) -> None:
        """tool_wp_id must be extracted from flat-dict work_package_id."""
        logger = _MockLogger()
        tool = _make_log_tool()
        log_tool_calls([tool], stage="qa", wp_id="WP-001", logger=logger)

        await tool.ainvoke({"work_package_id": "WP-003", "other": "data"})

        assert logger.entries[0]["tool_wp_id"] == "WP-003"

    async def test_emits_tool_wp_id_from_toolcall_structure(self) -> None:
        """tool_wp_id must be extracted from ToolCall nested-dict args."""
        logger = _MockLogger()
        tool = _make_log_tool()
        log_tool_calls([tool], stage="developer", wp_id="WP-001", logger=logger)

        await tool.ainvoke({
            "name": "ledger_complete_pipeline",
            "args": {"work_package_id": "WP-005", "type": "implementation"},
            "id": "call-1",
            "type": "tool_call",
        })

        assert logger.entries[0]["tool_wp_id"] == "WP-005"

    async def test_emits_level_debug(self) -> None:
        """stream_entry event must have level='DEBUG'."""
        logger = _MockLogger()
        tool = _make_log_tool()
        log_tool_calls([tool], stage="pm", wp_id="", logger=logger)

        await tool.ainvoke({})

        assert logger.entries[0]["level"] == "DEBUG"

    async def test_emits_stage_field(self) -> None:
        """stream_entry event must contain the stage passed to log_tool_calls."""
        logger = _MockLogger()
        tool = _make_log_tool()
        log_tool_calls([tool], stage="security_auditor", wp_id="WP-001", logger=logger)

        await tool.ainvoke({})

        assert logger.entries[0]["stage"] == "security_auditor"

    async def test_emits_wp_id_field(self) -> None:
        """stream_entry event must carry the stage-level wp_id."""
        logger = _MockLogger()
        tool = _make_log_tool()
        log_tool_calls([tool], stage="developer", wp_id="WP-007", logger=logger)

        await tool.ainvoke({})

        assert logger.entries[0]["wp_id"] == "WP-007"

    async def test_tool_wp_id_empty_when_no_wp_arg(self) -> None:
        """tool_wp_id must be empty string when the call has no work_package_id."""
        logger = _MockLogger()
        tool = _make_log_tool()
        log_tool_calls([tool], stage="pm", wp_id="", logger=logger)

        await tool.ainvoke({"agent_role": "Developer"})

        assert logger.entries[0]["tool_wp_id"] == ""

    async def test_all_required_fields_present(self) -> None:
        """All required event fields must be present in a single call."""
        logger = _MockLogger()
        tool = _make_log_tool()
        tool.name = "ledger_begin_work"
        log_tool_calls([tool], stage="developer", wp_id="WP-001", logger=logger)

        await tool.ainvoke({"work_package_id": "WP-001"})

        entry = logger.entries[0]
        for field in ("action", "tool_name", "tool_wp_id", "level"):
            assert field in entry, f"Required field '{field}' missing from event"


# ---------------------------------------------------------------------------
# AC3 — Sentinel idempotency (no stacking)
# ---------------------------------------------------------------------------


class TestLogToolCallsIdempotency:
    async def test_double_wrap_does_not_stack_closures(self) -> None:
        """Calling log_tool_calls twice on the same tool must not cause original
        ainvoke to be called more than once per invocation."""
        call_count = 0

        class _CountingTool:
            name = "counting_tool"

            async def ainvoke(self, input: Any, *args: Any, **kwargs: Any) -> str:
                nonlocal call_count
                call_count += 1
                return "ok"

        tool = _CountingTool()
        logger = _MockLogger()

        log_tool_calls([tool], stage="pm", wp_id="", logger=logger)
        log_tool_calls([tool], stage="pm", wp_id="", logger=logger)

        await tool.ainvoke({})

        assert call_count == 1, (
            f"Original ainvoke called {call_count} times — wrapper stacking occurred"
        )

    async def test_double_wrap_emits_exactly_one_event(self) -> None:
        """Double-wrapping must still emit only one event per call."""
        logger = _MockLogger()
        tool = _make_log_tool()

        log_tool_calls([tool], stage="pm", wp_id="", logger=logger)
        log_tool_calls([tool], stage="pm", wp_id="", logger=logger)

        await tool.ainvoke({})

        assert len(logger.entries) == 1, (
            f"Expected 1 event, got {len(logger.entries)}"
        )

    async def test_sentinel_is_set_after_first_wrap(self) -> None:
        """_orig_ainvoke_log sentinel must be set on the tool after first wrap."""
        tool = _make_log_tool()
        logger = _MockLogger()
        log_tool_calls([tool], stage="pm", wp_id="", logger=logger)
        assert hasattr(tool, "_orig_ainvoke_log"), (
            "_orig_ainvoke_log sentinel must be set after first wrap"
        )

    async def test_triple_wrap_is_also_safe(self) -> None:
        """Idempotency must hold for an arbitrary number of wraps."""
        call_count = 0

        class _CountingTool:
            name = "counting_tool"

            async def ainvoke(self, input: Any, *args: Any, **kwargs: Any) -> str:
                nonlocal call_count
                call_count += 1
                return "ok"

        tool = _CountingTool()
        logger = _MockLogger()

        for _ in range(3):
            log_tool_calls([tool], stage="pm", wp_id="", logger=logger)

        await tool.ainvoke({})

        assert call_count == 1


# ---------------------------------------------------------------------------
# AC4 — None logger: no error, tools function normally
# ---------------------------------------------------------------------------


class TestLogToolCallsNoneLogger:
    def test_none_logger_returns_tools_unchanged(self) -> None:
        """When logger is None, ainvoke must not be replaced."""
        tool = _make_log_tool()
        original_ainvoke = tool.ainvoke
        log_tool_calls([tool], stage="pm", wp_id="WP-001", logger=None)
        assert tool.ainvoke is original_ainvoke, (
            "ainvoke must not be replaced when logger is None"
        )

    def test_none_logger_no_sentinel(self) -> None:
        """When logger is None, no sentinel should be set."""
        tool = _make_log_tool()
        log_tool_calls([tool], stage="pm", wp_id="WP-001", logger=None)
        assert not hasattr(tool, "_orig_ainvoke_log"), (
            "_orig_ainvoke_log must not be set when logger is None"
        )

    async def test_none_logger_tool_still_invokable(self) -> None:
        """When logger is None, the tool must still function normally."""
        seen: list[Any] = []
        tool = _make_log_tool(captured=seen, ret="original")
        log_tool_calls([tool], stage="pm", wp_id="WP-001", logger=None)

        result = await tool.ainvoke({"key": "value"})

        assert result == "original"
        assert seen[0] == {"key": "value"}

    def test_none_logger_returns_same_list(self) -> None:
        """log_tool_calls with None logger must return the same list object."""
        tools = [_make_log_tool()]
        result = log_tool_calls(tools, stage="pm", wp_id="WP-001", logger=None)
        assert result is tools


# ---------------------------------------------------------------------------
# AC5 — Argument payload excluded from emitted event (privacy)
# ---------------------------------------------------------------------------


class TestLogToolCallsPrivacyConstraint:
    async def test_arguments_not_in_event_flat_dict(self) -> None:
        """The full flat-dict argument payload must not appear in the event."""
        logger = _MockLogger()
        tool = _make_log_tool()
        log_tool_calls([tool], stage="pm", wp_id="WP-001", logger=logger)

        await tool.ainvoke({
            "work_package_id": "WP-001",
            "secret_plan_content": "deploy at midnight",
            "acceptance_criteria": ["do the thing"],
        })

        entry = logger.entries[0]
        # Only these keys should appear; no argument payload
        allowed_keys = {"stage", "wp_id", "action", "tool_name", "tool_wp_id", "level"}
        assert set(entry.keys()) == allowed_keys, (
            f"Event contains extra keys: {set(entry.keys()) - allowed_keys}"
        )

    async def test_arguments_not_in_event_toolcall_structure(self) -> None:
        """The ToolCall nested args must not appear in the event."""
        logger = _MockLogger()
        tool = _make_log_tool()
        log_tool_calls([tool], stage="developer", wp_id="WP-001", logger=logger)

        await tool.ainvoke({
            "name": "ledger_create_work_package",
            "args": {
                "work_package_id": "WP-001",
                "assigned_to": "Developer",
                "acceptance_criteria": ["criterion 1", "criterion 2"],
                "dependencies": [],
            },
            "id": "call-priv",
            "type": "tool_call",
        })

        entry = logger.entries[0]
        allowed_keys = {"stage", "wp_id", "action", "tool_name", "tool_wp_id", "level"}
        assert set(entry.keys()) == allowed_keys, (
            f"Event leaks argument data: {set(entry.keys()) - allowed_keys}"
        )

    async def test_only_wp_id_extracted_not_other_args(self) -> None:
        """Only work_package_id is extracted; other argument values must not appear."""
        logger = _MockLogger()
        tool = _make_log_tool()
        log_tool_calls([tool], stage="pm", wp_id="", logger=logger)

        await tool.ainvoke({"work_package_id": "WP-002", "payload": "confidential"})

        entry = logger.entries[0]
        assert "payload" not in entry
        assert "confidential" not in str(entry)


# ---------------------------------------------------------------------------
# AC6 — Original ainvoke return value forwarded unchanged
# ---------------------------------------------------------------------------


class TestLogToolCallsReturnValueForwarded:
    async def test_string_return_value_forwarded(self) -> None:
        """Return value of the original ainvoke must pass through unchanged."""
        logger = _MockLogger()
        tool = _make_log_tool(ret="expected_return")
        log_tool_calls([tool], stage="pm", wp_id="WP-001", logger=logger)

        result = await tool.ainvoke({})

        assert result == "expected_return"

    async def test_dict_return_value_forwarded(self) -> None:
        """Dict return value from original ainvoke must be forwarded unchanged."""
        logger = _MockLogger()
        expected = {"status": "ok", "data": [1, 2, 3]}
        tool = _make_log_tool(ret=expected)
        log_tool_calls([tool], stage="developer", wp_id="WP-001", logger=logger)

        result = await tool.ainvoke({"work_package_id": "WP-001"})

        assert result is expected

    async def test_none_return_value_forwarded(self) -> None:
        """None return value from original ainvoke must be forwarded."""
        logger = _MockLogger()
        tool = _make_log_tool(ret=None)
        log_tool_calls([tool], stage="pm", wp_id="", logger=logger)

        result = await tool.ainvoke({})

        assert result is None

    async def test_return_value_unaffected_by_event_emission(self) -> None:
        """Logging must not alter the return value in any way."""
        logger = _MockLogger()
        sentinel = object()
        tool = _make_log_tool(ret=sentinel)
        log_tool_calls([tool], stage="pm", wp_id="WP-001", logger=logger)

        result = await tool.ainvoke({})

        assert result is sentinel, "Return value identity must be preserved"


# ---------------------------------------------------------------------------
# Edge cases
# ---------------------------------------------------------------------------


class TestLogToolCallsEdgeCases:
    async def test_non_dict_input_has_empty_tool_wp_id(self) -> None:
        """Non-dict input must not raise; tool_wp_id must be empty string."""
        logger = _MockLogger()
        tool = _make_log_tool()
        log_tool_calls([tool], stage="pm", wp_id="", logger=logger)

        await tool.ainvoke("raw string input")

        assert logger.entries[0]["tool_wp_id"] == ""

    async def test_none_input_has_empty_tool_wp_id(self) -> None:
        """None input must not raise; tool_wp_id must be empty string."""
        logger = _MockLogger()
        tool = _make_log_tool()
        log_tool_calls([tool], stage="pm", wp_id="", logger=logger)

        await tool.ainvoke(None)

        assert logger.entries[0]["tool_wp_id"] == ""

    async def test_empty_tools_list_is_noop(self) -> None:
        """Empty tools list must return the same empty list without error."""
        logger = _MockLogger()
        tools: list = []
        result = log_tool_calls(tools, stage="pm", wp_id="", logger=logger)
        assert result is tools
        assert logger.entries == []

    async def test_tool_name_fallback_when_missing(self) -> None:
        """When tool.name is absent, tool_name must default to empty string."""
        logger = _MockLogger()

        class _UnnamedTool:
            async def ainvoke(self, input: Any, *args: Any, **kwargs: Any) -> str:
                return "ok"

        tool = _UnnamedTool()
        log_tool_calls([tool], stage="pm", wp_id="", logger=logger)

        await tool.ainvoke({})

        assert logger.entries[0]["tool_name"] == ""

    async def test_multiple_tools_all_emit_events(self) -> None:
        """Every tool in the list must emit an event on ainvoke."""
        logger = _MockLogger()
        tool_a = _make_log_tool()
        tool_b = _make_log_tool()
        log_tool_calls([tool_a, tool_b], stage="qa", wp_id="WP-001", logger=logger)

        await tool_a.ainvoke({})
        await tool_b.ainvoke({})

        assert len(logger.entries) == 2

    async def test_event_emitted_before_original_call(self) -> None:
        """stream_entry must be called BEFORE the original ainvoke executes."""
        order: list[str] = []

        class _OrderTracker:
            name = "order_tool"

            async def ainvoke(self, input: Any, *args: Any, **kwargs: Any) -> str:
                order.append("original")
                return "ok"

        class _OrderLogger:
            def stream_entry(self, entry: dict) -> None:
                order.append("log")

        tool = _OrderTracker()
        log_tool_calls([tool], stage="pm", wp_id="", logger=_OrderLogger())

        await tool.ainvoke({})

        assert order == ["log", "original"], (
            f"Expected log before original, got: {order}"
        )


# ===========================================================================
# 13. ledger_detect_project short-circuit
# ===========================================================================


class _DetectProjectTool:
    """Tool stub with name='ledger_detect_project' to trigger the short-circuit."""

    def __init__(self, seen: list[Any] | None = None) -> None:
        _seen: list[Any] = seen if seen is not None else []
        self.name = "ledger_detect_project"

        async def _ainvoke(input: Any, *args: Any, **kwargs: Any) -> str:
            _seen.append(input)
            return "mcp_result"

        self.ainvoke = _ainvoke


class TestDetectProjectShortCircuit:
    """Verify that ledger_detect_project calls are short-circuited by
    inject_project_path without forwarding to the MCP server.

    ledger_detect_project is an IDE-facing tool that cross-references
    cwd_path against stored project roots.  In the orchestrator
    project_path is always known, so the wrapper returns a synthetic
    JSON response immediately.
    """

    async def test_original_ainvoke_not_called(self):
        """When tool is ledger_detect_project, the original ainvoke must NOT be called."""
        seen: list[Any] = []
        tool = _DetectProjectTool(seen)
        inject_project_path([tool], PROJECT)

        await tool.ainvoke({})

        assert len(seen) == 0, (
            "Original ainvoke must not be called for ledger_detect_project"
        )

    async def test_returns_valid_json(self):
        """The short-circuit result must be valid JSON."""
        import json

        tool = _DetectProjectTool()
        inject_project_path([tool], PROJECT)

        result = await tool.ainvoke({})

        # Must not raise
        parsed = json.loads(result)
        assert isinstance(parsed, dict)

    async def test_response_contains_plan_path(self):
        """The synthetic response must contain 'plan_path' equal to project_path."""
        import json

        tool = _DetectProjectTool()
        inject_project_path([tool], PROJECT)

        result = await tool.ainvoke({})
        parsed = json.loads(result)

        assert parsed["plan_path"] == PROJECT

    async def test_response_contains_slug(self):
        """The synthetic response must contain 'slug' derived from the last path segment."""
        import json

        tool = _DetectProjectTool()
        inject_project_path([tool], "/ledger/my-project")

        result = await tool.ainvoke({})
        parsed = json.loads(result)

        assert parsed["slug"] == "my-project"

    async def test_response_contains_title(self):
        """The synthetic response must contain 'title' derived from the slug."""
        import json

        tool = _DetectProjectTool()
        inject_project_path([tool], "/ledger/my-project")

        result = await tool.ainvoke({})
        parsed = json.loads(result)

        assert parsed["title"] == "My Project"

    async def test_title_with_underscores(self):
        """Underscores in the slug must also be replaced when deriving title."""
        import json

        tool = _DetectProjectTool()
        inject_project_path([tool], "/ledger/my_project")

        result = await tool.ainvoke({})
        parsed = json.loads(result)

        assert parsed["title"] == "My Project"

    async def test_response_contains_active_status(self):
        """The synthetic response must contain 'status' equal to 'active'."""
        import json

        tool = _DetectProjectTool()
        inject_project_path([tool], PROJECT)

        result = await tool.ainvoke({})
        parsed = json.loads(result)

        assert parsed["status"] == "active"

    async def test_slug_with_trailing_slash(self):
        """A project_path with a trailing slash must still produce the correct slug."""
        import json

        tool = _DetectProjectTool()
        inject_project_path([tool], "/ledger/my-project/")

        result = await tool.ainvoke({})
        parsed = json.loads(result)

        assert parsed["slug"] == "my-project"

    async def test_toolcall_structure_also_short_circuited(self):
        """Short-circuit must also apply when input has ToolCall {'args': {...}} structure."""
        import json

        from langchain_core.messages import ToolMessage

        seen: list[Any] = []
        tool = _DetectProjectTool(seen)
        inject_project_path([tool], PROJECT)

        result = await tool.ainvoke({
            "name": "ledger_detect_project",
            "args": {"cwd_path": "/some/workspace"},
            "id": "call-detect",
            "type": "tool_call",
        })

        assert len(seen) == 0, "Original ainvoke must not be called for ToolCall input either"
        assert isinstance(result, ToolMessage), (
            f"Expected ToolMessage for ToolCall input, got {type(result).__name__}"
        )
        parsed = json.loads(result.content)
        assert parsed["plan_path"] == PROJECT

    async def test_other_tool_names_not_short_circuited(self):
        """Tools with names other than ledger_detect_project must still delegate to original."""
        seen: list[Any] = []
        tool = _make_tool(seen)  # name = "test_tool"
        inject_project_path([tool], PROJECT)

        await tool.ainvoke({"work_package_id": "WP-001"})

        assert len(seen) == 1, "Non-detect-project tools must reach the original ainvoke"
        assert seen[0]["project_path"] == PROJECT

    async def test_short_circuit_with_cwd_path_input_no_original_call(self):
        """Even when caller passes cwd_path, the short-circuit fires and original is skipped."""
        seen: list[Any] = []
        tool = _DetectProjectTool(seen)
        inject_project_path([tool], PROJECT)

        await tool.ainvoke({"cwd_path": "/workspace"})

        assert len(seen) == 0, "Short-circuit must fire regardless of what input contains"

    async def test_short_circuit_idempotent_double_wrap(self):
        """Double-wrapping a ledger_detect_project tool must not stack closures."""
        import json

        seen: list[Any] = []
        tool = _DetectProjectTool(seen)
        inject_project_path([tool], PROJECT)
        inject_project_path([tool], PROJECT)

        result = await tool.ainvoke({})

        assert len(seen) == 0
        parsed = json.loads(result)
        assert parsed["plan_path"] == PROJECT


# ===========================================================================
# _make_tool_response — helper unit tests
# ===========================================================================

from src.utils.tool_wrappers import _make_tool_response  # noqa: E402


class TestMakeToolResponse:
    """Unit tests for the _make_tool_response helper function."""

    def test_plain_dict_without_id_returns_string(self):
        """A plain dict (no 'id' key) must return the content string as-is."""
        result = _make_tool_response("some error", {"args": {}}, "my_tool")
        assert isinstance(result, str)
        assert result == "some error"

    def test_dict_with_id_returns_tool_message(self):
        """A dict with 'id' key must return a ToolMessage."""
        from langchain_core.messages import ToolMessage

        result = _make_tool_response(
            "bad input", {"id": "call-123", "args": {}}, "ledger_begin_work"
        )
        assert isinstance(result, ToolMessage)
        assert result.content == "bad input"
        assert result.tool_call_id == "call-123"
        assert result.name == "ledger_begin_work"
        assert result.status == "error"

    def test_non_dict_input_returns_string(self):
        """Non-dict input (e.g. a string) must return the content string as-is."""
        result = _make_tool_response("hello", "raw string", "tool")
        assert isinstance(result, str)
        assert result == "hello"

    def test_none_input_returns_string(self):
        """None input must return the content string as-is."""
        result = _make_tool_response("content", None, "tool")
        assert isinstance(result, str)
        assert result == "content"

    def test_status_error_default(self):
        """Default status must be 'error'."""
        from langchain_core.messages import ToolMessage

        result = _make_tool_response("err", {"id": "c1"}, "t")
        assert isinstance(result, ToolMessage)
        assert result.status == "error"

    def test_status_success_forwarded(self):
        """Explicit status='success' must be forwarded to ToolMessage."""
        from langchain_core.messages import ToolMessage

        result = _make_tool_response("ok", {"id": "c2"}, "t", status="success")
        assert isinstance(result, ToolMessage)
        assert result.status == "success"

    def test_dict_with_id_none_returns_string(self):
        """A dict with 'id' set to None must return a plain string."""
        result = _make_tool_response("msg", {"id": None}, "tool")
        assert isinstance(result, str)
        assert result == "msg"


# ===========================================================================
# ledger_detect_project short-circuit — ToolMessage wrapping tests
# ===========================================================================


class TestLedgerDetectProjectToolMessage:
    """Verify that the ledger_detect_project short-circuit returns ToolMessage
    when called with a ToolCall dict (containing 'id')."""

    async def test_toolcall_returns_tool_message(self):
        """ToolCall input with 'id' must produce a ToolMessage with status='success'."""
        import json
        
        from langchain_core.messages import ToolMessage

        tool = _DetectProjectTool()
        inject_project_path([tool], PROJECT)

        result = await tool.ainvoke({
            "name": "ledger_detect_project",
            "args": {"cwd_path": "/some/workspace"},
            "id": "call-detect-tm",
            "type": "tool_call",
        })

        assert isinstance(result, ToolMessage), (
            f"Expected ToolMessage, got {type(result).__name__}"
        )
        assert result.status == "success"
        assert result.tool_call_id == "call-detect-tm"
        assert result.name == "ledger_detect_project"

        parsed = json.loads(result.content)
        assert parsed["plan_path"] == PROJECT
        assert "slug" in parsed
        assert "title" in parsed
        assert "status" in parsed

    async def test_flat_dict_returns_string(self):
        """Flat dict input (no 'id') must still return a plain JSON string."""
        import json

        tool = _DetectProjectTool()
        inject_project_path([tool], PROJECT)

        result = await tool.ainvoke({})

        assert isinstance(result, str), (
            f"Expected str for flat dict, got {type(result).__name__}"
        )
        parsed = json.loads(result)
        assert parsed["plan_path"] == PROJECT


# ===========================================================================
# restrict_to_wp — ToolMessage wrapping tests
# ===========================================================================


class TestRestrictToWpToolMessage:
    """Verify that restrict_to_wp soft-fail returns ToolMessage when called
    with a ToolCall dict (containing 'id')."""

    async def test_toolcall_soft_fail_returns_tool_message(self):
        """First violation with ToolCall input must return ToolMessage with status='error'."""
        from langchain_core.messages import ToolMessage

        tool = _make_guard_tool()
        restrict_to_wp([tool], ACTIVE_WP)

        result = await tool.ainvoke({
            "name": "ledger_begin_work",
            "args": {"work_package_id": "WP-007"},
            "id": "call-wp-tm",
            "type": "tool_call",
        })

        assert isinstance(result, ToolMessage), (
            f"Expected ToolMessage, got {type(result).__name__}"
        )
        assert result.status == "error"
        assert result.tool_call_id == "call-wp-tm"
        assert result.name == "guard_tool"
        assert "ERROR" in result.content
        assert "WP-007" in result.content
        assert ACTIVE_WP in result.content

    async def test_toolcall_second_violation_returns_tool_message(self):
        """Second violation with ToolCall input must also return ToolMessage."""
        from langchain_core.messages import ToolMessage

        tool = _make_guard_tool()
        restrict_to_wp([tool], ACTIVE_WP)

        # First violation
        await tool.ainvoke({
            "name": "ledger_begin_work",
            "args": {"work_package_id": "WP-007"},
            "id": "call-v1",
            "type": "tool_call",
        })

        # Second violation
        result = await tool.ainvoke({
            "name": "ledger_begin_work",
            "args": {"work_package_id": "WP-007"},
            "id": "call-v2",
            "type": "tool_call",
        })

        assert isinstance(result, ToolMessage)
        assert result.status == "error"
        assert result.tool_call_id == "call-v2"

    async def test_flat_dict_soft_fail_returns_string(self):
        """Flat dict input (no 'id') must still return a plain error string."""
        tool = _make_guard_tool()
        restrict_to_wp([tool], ACTIVE_WP)

        result = await tool.ainvoke({"work_package_id": "WP-002"})

        assert isinstance(result, str), (
            f"Expected str for flat dict, got {type(result).__name__}"
        )
        assert "ERROR" in result

    async def test_toolcall_third_violation_still_raises(self):
        """Third violation with ToolCall input must still raise ValueError (hard kill)."""
        tool = _make_guard_tool()
        restrict_to_wp([tool], ACTIVE_WP)

        # Exhaust soft-fail allowance with ToolCall inputs.
        for i in range(2):
            await tool.ainvoke({
                "name": "ledger_begin_work",
                "args": {"work_package_id": "WP-007"},
                "id": f"call-exhaust-{i}",
                "type": "tool_call",
            })

        with pytest.raises(ValueError, match="WP-007"):
            await tool.ainvoke({
                "name": "ledger_begin_work",
                "args": {"work_package_id": "WP-007"},
                "id": "call-hard-kill",
                "type": "tool_call",
            })

