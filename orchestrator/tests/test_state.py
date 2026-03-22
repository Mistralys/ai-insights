"""
test_state.py — Unit tests for WorkflowState schema.

Verifies:
- WorkflowState is a valid TypedDict with all required fields.
- run_log and errors use the ``operator.add`` reducer (append-only semantics).
- StateGraph(WorkflowState) accepts the schema without error (requires langgraph).
"""

from __future__ import annotations

import pytest
from typing import get_type_hints, get_args, Annotated
from operator import add

from src.state import WorkflowState


class TestWorkflowStateFields:
    """Verify all required fields exist in WorkflowState."""

    IMMUTABLE_FIELDS = {"project_path", "plan_file", "target_project_path"}
    MUTABLE_FIELDS = {"current_stage", "current_wp_id", "iteration", "max_iterations"}
    STAGE_OUTPUT_FIELDS = {"stage_result", "stage_success"}
    LEDGER_FIELDS = {"project_status", "wp_summaries", "pending_wp_count"}
    CIRCUIT_BREAKER_FIELDS = {"consecutive_failures"}
    DELTA_COUNTER_FIELDS = {"wps_completed_this_run"}
    PROGRESS_TRACKING_FIELDS = {"prev_wp_summaries", "run_start_ts"}
    APPEND_ONLY_FIELDS = {"run_log", "errors"}

    def _all_expected(self) -> set:
        return (
            self.IMMUTABLE_FIELDS
            | self.MUTABLE_FIELDS
            | self.STAGE_OUTPUT_FIELDS
            | self.LEDGER_FIELDS
            | self.CIRCUIT_BREAKER_FIELDS
            | self.DELTA_COUNTER_FIELDS
            | self.PROGRESS_TRACKING_FIELDS
            | self.APPEND_ONLY_FIELDS
        )

    def test_all_required_fields_present(self):
        hints = get_type_hints(WorkflowState, include_extras=True)
        for field in self._all_expected():
            assert field in hints, f"Missing field: {field!r}"

    def test_no_unexpected_fields(self):
        hints = get_type_hints(WorkflowState, include_extras=True)
        unexpected = set(hints) - self._all_expected()
        assert not unexpected, f"Unexpected fields: {unexpected}"


class TestAppendOnlyReducers:
    """Verify run_log and errors carry the operator.add reducer annotation."""

    def _get_reducer(self, field: str):
        hints = get_type_hints(WorkflowState, include_extras=True)
        annotation = hints[field]
        # Only Annotated types carry reducer metadata.
        if hasattr(annotation, "__metadata__"):
            args = get_args(annotation)
            # args = (base_type, reducer)
            return args[1] if len(args) >= 2 else None  # type: ignore[return-value]
        return None

    def test_run_log_uses_add_reducer(self):
        reducer = self._get_reducer("run_log")
        assert reducer is add, (
            "run_log must use operator.add as its LangGraph reducer; "
            f"got {reducer!r}"
        )

    def test_errors_uses_add_reducer(self):
        reducer = self._get_reducer("errors")
        assert reducer is add, (
            "errors must use operator.add as its LangGraph reducer; "
            f"got {reducer!r}"
        )

    def test_add_reducer_semantics(self):
        """Confirm operator.add concatenates lists (the required LangGraph behaviour)."""
        a = [1, 2]
        b = [3, 4]
        assert add(a, b) == [1, 2, 3, 4]

    def test_project_path_is_plain_str(self):
        """Immutable fields must NOT have a reducer annotation."""
        hints = get_type_hints(WorkflowState, include_extras=True)
        annotation = hints["project_path"]
        # Plain str — should not be Annotated.
        assert annotation is str, (
            "project_path should be plain str, not Annotated; "
            f"got {annotation!r}"
        )


class TestStateGraphIntegration:
    """Verify WorkflowState is accepted by LangGraph's StateGraph."""

    def test_stategraph_accepts_workflow_state(self):
        """StateGraph(WorkflowState) should not raise."""
        pytest.importorskip("langgraph", reason="langgraph not installed")
        from langgraph.graph import StateGraph
        # This is the primary acceptance criterion: no exception raised.
        graph = StateGraph(WorkflowState)
        assert graph is not None
