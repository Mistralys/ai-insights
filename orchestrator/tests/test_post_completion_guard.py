"""
test_post_completion_guard.py — Unit tests for the post-completion cross-WP escape fix.

Tests cover the two new wrapper functions introduced in ``src/nodes/__init__.py``:

- :func:`_install_complete_pipeline_tracker` — Wraps ``ledger_complete_pipeline``.
  Sets ``tracker["completed"] = True`` after a successful call. A raised exception
  must leave the flag ``False``.

- :func:`_install_post_completion_guard` — Wraps ``ledger_get_next_action``.
  Returns a synthetic ``{"action": "WAIT"}`` ToolMessage when
  ``completion_tracker["completed"]`` is ``True``; delegates transparently when ``False``.

AC coverage:
1. Post-completion interception — WAIT response after successful complete.
2. Pre-completion passthrough — normal delegation before completion.
3. Failed completion does not trigger interception.
4. Synthetic response shape — valid JSON with "action": "WAIT" and "reason".
5. Idempotency — multiple installs on the same tools do not stack wrappers.
6. Rollback suppression — ``_complete_pipeline_state["completed"]`` prevents
   ``ledger_cancel_pipeline`` from being invoked.

No LLM calls or MCP server required — all tests run in < 1 second.
"""

from __future__ import annotations

import json
from typing import Any

import pytest
from langchain_core.messages import ToolMessage

from src.nodes import _install_complete_pipeline_tracker, _install_post_completion_guard

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

class _SimpleTool:
    """Minimal plain-Python tool stub.

    Unlike ``MagicMock``, plain objects do **not** auto-create attributes on
    access, so sentinel checks (``hasattr``) work correctly before the first wrap.
    """

    def __init__(self, name: str, result: Any = "ok", seen: list[Any] | None = None) -> None:
        self.name = name
        _seen: list[Any] = seen if seen is not None else []
        _result = result

        async def _ainvoke(input: Any, *args: Any, **kwargs: Any) -> Any:
            _seen.append(input)
            if isinstance(_result, type) and issubclass(_result, Exception):
                raise _result("simulated failure")
            if callable(_result) and not isinstance(_result, type):
                return _result(input)
            return _result

        self.ainvoke = _ainvoke
        self._seen = _seen


def _make_cp_tool(seen: list[Any] | None = None) -> _SimpleTool:
    """Return a ``ledger_complete_pipeline`` stub."""
    return _SimpleTool("ledger_complete_pipeline", result="completed_ok", seen=seen)


def _make_cp_tool_raises(exc_type: type = RuntimeError) -> _SimpleTool:
    """Return a ``ledger_complete_pipeline`` stub that raises on invocation."""
    return _SimpleTool("ledger_complete_pipeline", result=exc_type)


def _make_gna_tool(response: Any = '{"action": "NEXT", "wp_id": "WP-002"}') -> _SimpleTool:
    """Return a ``ledger_get_next_action`` stub."""
    return _SimpleTool("ledger_get_next_action", result=response)


def _make_cancel_tool(seen: list[Any] | None = None) -> _SimpleTool:
    """Return a ``ledger_cancel_pipeline`` stub."""
    return _SimpleTool("ledger_cancel_pipeline", result="cancelled", seen=seen)


# ---------------------------------------------------------------------------
# 1. Complete-pipeline tracker: flag set after success
# ---------------------------------------------------------------------------

class TestCompletePipelineTrackerSuccess:
    async def test_flag_false_before_invocation(self):
        """Tracker starts at False before any tool call."""
        tracker: dict = {"completed": False}
        tool = _make_cp_tool()
        _install_complete_pipeline_tracker([tool], tracker)

        assert tracker["completed"] is False

    async def test_flag_true_after_successful_invocation(self):
        """Tracker is set to True after a successful ledger_complete_pipeline call."""
        tracker: dict = {"completed": False}
        tool = _make_cp_tool()
        _install_complete_pipeline_tracker([tool], tracker)

        await tool.ainvoke({"work_package_id": "WP-001", "type": "implementation"})

        assert tracker["completed"] is True

    async def test_original_ainvoke_result_preserved(self):
        """The wrapper must return the original result unchanged."""
        tracker: dict = {"completed": False}
        tool = _make_cp_tool()
        _install_complete_pipeline_tracker([tool], tracker)

        result = await tool.ainvoke({"work_package_id": "WP-001"})

        assert result == "completed_ok"

    async def test_non_cp_tool_not_wrapped(self):
        """A different tool in the list must not be wrapped."""
        tracker: dict = {"completed": False}
        other = _SimpleTool("ledger_begin_work")
        orig_ainvoke = other.ainvoke
        _install_complete_pipeline_tracker([other], tracker)

        assert other.ainvoke is orig_ainvoke


# ---------------------------------------------------------------------------
# 2. Complete-pipeline tracker: flag NOT set on exception
# ---------------------------------------------------------------------------

class TestCompletePipelineTrackerFailure:
    async def test_flag_stays_false_on_exception(self):
        """If ledger_complete_pipeline raises, the flag must stay False."""
        tracker: dict = {"completed": False}
        tool = _make_cp_tool_raises(RuntimeError)
        _install_complete_pipeline_tracker([tool], tracker)

        with pytest.raises(RuntimeError, match="simulated failure"):
            await tool.ainvoke({"work_package_id": "WP-001"})

        assert tracker["completed"] is False

    async def test_flag_stays_false_on_value_error(self):
        """ValueError also leaves the flag False (MCP validation failure path)."""
        tracker: dict = {"completed": False}
        tool = _make_cp_tool_raises(ValueError)
        _install_complete_pipeline_tracker([tool], tracker)

        with pytest.raises(ValueError, match="simulated failure"):
            await tool.ainvoke({"work_package_id": "WP-001"})

        assert tracker["completed"] is False


# ---------------------------------------------------------------------------
# 3. Complete-pipeline tracker: idempotency
# ---------------------------------------------------------------------------

class TestCompletePipelineTrackerIdempotency:
    async def test_double_install_does_not_stack(self):
        """Installing the tracker twice on the same tool must not double-wrap."""
        tracker: dict = {"completed": False}
        seen: list[Any] = []
        tool = _make_cp_tool(seen=seen)

        _install_complete_pipeline_tracker([tool], tracker)
        _install_complete_pipeline_tracker([tool], tracker)

        await tool.ainvoke({"work_package_id": "WP-001"})

        # The original ainvoke should have been called exactly once.
        assert len(seen) == 1
        assert tracker["completed"] is True

    async def test_sentinel_set_after_install(self):
        """The sentinel attribute ``_tracking_cp`` must exist after install."""
        tracker: dict = {"completed": False}
        tool = _make_cp_tool()
        assert not hasattr(tool, "_tracking_cp")

        _install_complete_pipeline_tracker([tool], tracker)

        assert hasattr(tool, "_tracking_cp")
        assert tool._tracking_cp is True  # type: ignore[attr-defined]


# ---------------------------------------------------------------------------
# 4. Post-completion guard: passthrough before completion
# ---------------------------------------------------------------------------

class TestPostCompletionGuardPassthrough:
    async def test_delegates_when_not_completed(self):
        """Before completion, ledger_get_next_action must delegate to the original."""
        tracker: dict = {"completed": False}
        gna_seen: list[Any] = []
        gna = _SimpleTool("ledger_get_next_action", result='{"action": "NEXT"}', seen=gna_seen)

        _install_post_completion_guard([gna], tracker)

        result = await gna.ainvoke({"agent_role": "Developer"})

        assert len(gna_seen) == 1
        assert result == '{"action": "NEXT"}'

    async def test_non_gna_tool_not_wrapped(self):
        """A non ledger_get_next_action tool in the list must not be wrapped."""
        tracker: dict = {"completed": False}
        other = _SimpleTool("ledger_begin_work")
        orig_ainvoke = other.ainvoke
        _install_post_completion_guard([other], tracker)

        assert other.ainvoke is orig_ainvoke


# ---------------------------------------------------------------------------
# 5. Post-completion guard: interception after completion
# ---------------------------------------------------------------------------

class TestPostCompletionGuardInterception:
    async def test_returns_synthetic_wait_after_completion(self):
        """After completion flag is True, the synthetic WAIT response is returned."""
        tracker: dict = {"completed": True}
        gna_seen: list[Any] = []
        gna = _SimpleTool("ledger_get_next_action", result='{"action": "NEXT"}', seen=gna_seen)

        _install_post_completion_guard([gna], tracker)

        result = await gna.ainvoke({"agent_role": "Developer"})

        # Original ainvoke must NOT have been called.
        assert len(gna_seen) == 0
        # Result is a plain string (no tool_call_id in flat dict input).
        assert isinstance(result, str)
        parsed = json.loads(result)
        assert parsed["action"] == "WAIT"
        assert "reason" in parsed

    async def test_synthetic_response_contains_reason_text(self):
        """The synthetic WAIT response must mention the orchestrator."""
        tracker: dict = {"completed": True}
        gna = _SimpleTool("ledger_get_next_action", result="irrelevant")

        _install_post_completion_guard([gna], tracker)

        result = await gna.ainvoke({})

        parsed = json.loads(result)
        assert "orchestrator" in parsed["reason"].lower()

    async def test_synthetic_response_shape_with_tool_call_id(self):
        """With a ToolCall-style input (has 'id'), the response is a ToolMessage."""
        tracker: dict = {"completed": True}
        gna = _SimpleTool("ledger_get_next_action", result="irrelevant")

        _install_post_completion_guard([gna], tracker)

        result = await gna.ainvoke({
            "name": "ledger_get_next_action",
            "args": {"agent_role": "Developer"},
            "id": "call-abc123",
            "type": "tool_call",
        })

        assert isinstance(result, ToolMessage)
        assert result.tool_call_id == "call-abc123"
        assert result.status == "success"
        parsed = json.loads(result.content)
        assert parsed["action"] == "WAIT"
        assert "reason" in parsed

    async def test_original_not_called_after_completion(self):
        """After completion, the original gna ainvoke is bypassed."""
        tracker: dict = {"completed": True}
        gna_seen: list[Any] = []
        gna = _SimpleTool("ledger_get_next_action", result="should-not-appear", seen=gna_seen)

        _install_post_completion_guard([gna], tracker)

        # Call three times to ensure interception is consistent.
        for _ in range(3):
            await gna.ainvoke({"agent_role": "Developer"})

        assert len(gna_seen) == 0


# ---------------------------------------------------------------------------
# 6. Post-completion guard: idempotency
# ---------------------------------------------------------------------------

class TestPostCompletionGuardIdempotency:
    async def test_double_install_does_not_stack(self):
        """Installing the guard twice on the same tool must not double-wrap."""
        tracker: dict = {"completed": False}
        gna_seen: list[Any] = []
        gna = _SimpleTool("ledger_get_next_action", result="normal", seen=gna_seen)

        _install_post_completion_guard([gna], tracker)
        _install_post_completion_guard([gna], tracker)

        await gna.ainvoke({})

        # Original invoked exactly once (no stacking).
        assert len(gna_seen) == 1

    async def test_sentinel_set_after_install(self):
        """The sentinel attribute ``_post_completion_guard`` must exist after install."""
        tracker: dict = {"completed": False}
        gna = _SimpleTool("ledger_get_next_action", result="normal")
        assert not hasattr(gna, "_post_completion_guard")

        _install_post_completion_guard([gna], tracker)

        assert hasattr(gna, "_post_completion_guard")
        assert gna._post_completion_guard is True  # type: ignore[attr-defined]


# ---------------------------------------------------------------------------
# 7. Combined flow: tracker + guard working together
# ---------------------------------------------------------------------------

class TestCombinedTrackerAndGuard:
    async def test_gna_passes_through_before_complete_pipeline(self):
        """Before ledger_complete_pipeline fires, gna must delegate normally."""
        tracker: dict = {"completed": False}
        gna_seen: list[Any] = []
        cp = _make_cp_tool()
        gna = _SimpleTool("ledger_get_next_action", result='{"action": "CONTINUE"}', seen=gna_seen)

        _install_complete_pipeline_tracker([cp], tracker)
        _install_post_completion_guard([gna], tracker)

        result = await gna.ainvoke({"agent_role": "Developer"})

        assert result == '{"action": "CONTINUE"}'
        assert len(gna_seen) == 1

    async def test_gna_intercepted_after_complete_pipeline(self):
        """After ledger_complete_pipeline succeeds, gna must return WAIT."""
        tracker: dict = {"completed": False}
        gna_seen: list[Any] = []
        cp = _make_cp_tool()
        gna = _SimpleTool("ledger_get_next_action", result='{"action": "NEXT"}', seen=gna_seen)

        _install_complete_pipeline_tracker([cp], tracker)
        _install_post_completion_guard([gna], tracker)

        # Simulate pipeline completion.
        await cp.ainvoke({"work_package_id": "WP-001", "type": "implementation"})

        # Now gna should be intercepted.
        result = await gna.ainvoke({"agent_role": "Developer"})

        assert len(gna_seen) == 0
        parsed = json.loads(result)
        assert parsed["action"] == "WAIT"

    async def test_failed_complete_pipeline_does_not_intercept_gna(self):
        """If ledger_complete_pipeline raises, gna must continue to delegate normally."""
        tracker: dict = {"completed": False}
        gna_seen: list[Any] = []
        cp = _make_cp_tool_raises(RuntimeError)
        gna = _SimpleTool("ledger_get_next_action", result='{"action": "NEXT"}', seen=gna_seen)

        _install_complete_pipeline_tracker([cp], tracker)
        _install_post_completion_guard([gna], tracker)

        with pytest.raises(RuntimeError):
            await cp.ainvoke({"work_package_id": "WP-001"})

        # gna should still delegate normally.
        result = await gna.ainvoke({"agent_role": "Developer"})

        assert len(gna_seen) == 1
        assert result == '{"action": "NEXT"}'


# ---------------------------------------------------------------------------
# 8. Rollback suppression
# ---------------------------------------------------------------------------

class TestRollbackSuppression:
    async def test_cancel_not_called_when_complete_pipeline_succeeded(self):
        """When _complete_pipeline_state["completed"] is True, rollback must be skipped.

        This is a behavioural contract test: the rollback guard condition in
        create_stage_node is:
            if _begin_work_state["called"] and not _complete_pipeline_state["completed"] ...

        We verify the combined condition logic independently from the node wiring.
        """
        begin_work_state = {"called": True, "pipeline_type": "implementation"}
        complete_pipeline_state = {"completed": True}
        cancel_seen: list[Any] = []
        cancel_tool = _make_cancel_tool(seen=cancel_seen)

        # Simulate the rollback guard condition.
        should_rollback = (
            begin_work_state["called"]
            and not complete_pipeline_state["completed"]
            and bool(cancel_tool)
        )

        if should_rollback:
            await cancel_tool.ainvoke({"work_package_id": "WP-001"})

        assert len(cancel_seen) == 0, "cancel must not be called when pipeline completed"

    async def test_cancel_called_when_begin_work_without_complete(self):
        """When pipeline started but did not complete, rollback must proceed."""
        begin_work_state = {"called": True, "pipeline_type": "implementation"}
        complete_pipeline_state = {"completed": False}
        cancel_seen: list[Any] = []
        cancel_tool = _make_cancel_tool(seen=cancel_seen)
        wp_id = "WP-001"

        should_rollback = (
            begin_work_state["called"]
            and not complete_pipeline_state["completed"]
            and wp_id
            and bool(cancel_tool)
        )

        if should_rollback:
            await cancel_tool.ainvoke({"work_package_id": wp_id})

        assert len(cancel_seen) == 1, "cancel must be called when pipeline did not complete"

    async def test_cancel_not_called_when_begin_work_not_called(self):
        """When begin_work was never called, rollback must be skipped."""
        begin_work_state = {"called": False, "pipeline_type": None}
        complete_pipeline_state = {"completed": False}
        cancel_seen: list[Any] = []
        cancel_tool = _make_cancel_tool(seen=cancel_seen)
        wp_id = "WP-001"

        should_rollback = (
            begin_work_state["called"]
            and not complete_pipeline_state["completed"]
            and wp_id
            and bool(cancel_tool)
        )

        if should_rollback:  # pragma: no branch
            await cancel_tool.ainvoke({"work_package_id": wp_id})

        assert len(cancel_seen) == 0
