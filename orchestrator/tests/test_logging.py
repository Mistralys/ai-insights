"""
test_logging.py — Unit tests for WorkflowLogger console formatting (WP-007).

Tests verify:
- _format_duration handles all documented edge cases.
- _build_stream_console_line produces the correct console output for each
  of the 7 new event types introduced in WP-002 and WP-003.
- Duration is included in stage_complete output.
- progress_snapshot reports completed/total WP counts and elapsed time.
- Existing event type formatting (route, run_start, etc.) is unchanged.
- No crashes on missing or unexpected fields in log entries.
"""

from __future__ import annotations

import pytest

from src.utils.logging import _build_stream_console_line, _format_duration


# ---------------------------------------------------------------------------
# _format_duration
# ---------------------------------------------------------------------------


class TestFormatDuration:
    """Verify the human-readable duration formatter."""

    def test_none_returns_empty(self):
        assert _format_duration(None) == ""

    def test_zero_returns_0s(self):
        assert _format_duration(0) == "0s"

    def test_sub_minute_whole(self):
        assert _format_duration(45) == "45s"

    def test_sub_minute_one_second(self):
        assert _format_duration(1) == "1s"

    def test_sub_minute_boundary(self):
        assert _format_duration(59) == "59s"

    def test_multi_minute_exact(self):
        # 3m 24s = 204 seconds
        assert _format_duration(204) == "3m 24s"

    def test_multi_minute_one_minute(self):
        assert _format_duration(60) == "1m 0s"

    def test_multi_minute_boundary(self):
        # 59m 59s = 3599 seconds
        assert _format_duration(3599) == "59m 59s"

    def test_multi_hour_exact(self):
        # 1h 12m = 4320 seconds
        assert _format_duration(4320) == "1h 12m"

    def test_multi_hour_one_hour(self):
        assert _format_duration(3600) == "1h 0m"

    def test_multi_hour_two_hours(self):
        assert _format_duration(7200) == "2h 0m"

    def test_rounding_up(self):
        assert _format_duration(45.6) == "46s"

    def test_rounding_down(self):
        assert _format_duration(44.4) == "44s"

    def test_float_multi_minute(self):
        # 3m 24.9s → round to 3m 25s
        assert _format_duration(204.9) == "3m 25s"


# ---------------------------------------------------------------------------
# _build_stream_console_line — new event types
# ---------------------------------------------------------------------------


class TestStageStart:
    def test_format(self):
        entry = {"stage": "developer", "wp_id": "WP-003", "action": "stage_start"}
        line = _build_stream_console_line(entry)
        assert line == "[developer] WP-003 ▶ stage_start"

    def test_no_wp_id(self):
        entry = {"stage": "developer", "wp_id": "", "action": "stage_start"}
        line = _build_stream_console_line(entry)
        assert "▶ stage_start" in line
        assert "WP-" not in line

    def test_no_stage(self):
        entry = {"stage": "", "wp_id": "WP-001", "action": "stage_start"}
        line = _build_stream_console_line(entry)
        assert "[—]" in line
        assert "▶ stage_start" in line


class TestStageComplete:
    """stage_complete is an enriched existing event (adds duration_s)."""

    def test_includes_duration_and_tokens(self):
        entry = {
            "stage": "developer",
            "wp_id": "WP-003",
            "action": "stage_complete",
            "result": "PASS",
            "duration_s": 204,
            "tokens_used": 1850,
        }
        line = _build_stream_console_line(entry)
        assert "[developer]" in line
        assert "WP-003" in line
        assert "stage_complete" in line
        assert "→ PASS" in line
        assert "3m 24s" in line
        assert "1850 tokens" in line

    def test_includes_duration_without_tokens(self):
        entry = {
            "stage": "developer",
            "wp_id": "WP-003",
            "action": "stage_complete",
            "result": "PASS",
            "duration_s": 45,
        }
        line = _build_stream_console_line(entry)
        assert "45s" in line
        assert "tokens" not in line

    def test_no_duration_field(self):
        # duration_s absent — no crash, no empty parens
        entry = {
            "stage": "developer",
            "wp_id": "WP-003",
            "action": "stage_complete",
            "result": "PASS",
            "tokens_used": 500,
        }
        line = _build_stream_console_line(entry)
        assert "stage_complete" in line
        assert "500 tokens" in line

    def test_no_result_no_tokens_no_duration(self):
        entry = {"stage": "developer", "wp_id": "WP-001", "action": "stage_complete"}
        line = _build_stream_console_line(entry)
        assert "stage_complete" in line
        assert "()" not in line  # no empty parens


class TestWpStatusChange:
    def test_format(self):
        entry = {
            "stage": "supervisor",
            "wp_id": "WP-003",
            "action": "wp_status_change",
            "old_status": "IN_PROGRESS",
            "new_status": "COMPLETE",
        }
        line = _build_stream_console_line(entry)
        assert "[supervisor]" in line
        assert "WP-003" in line
        assert "status:" in line
        assert "IN_PROGRESS" in line
        assert "COMPLETE" in line
        assert "→" in line

    def test_missing_status_fields_no_crash(self):
        entry = {"stage": "supervisor", "wp_id": "WP-001", "action": "wp_status_change"}
        line = _build_stream_console_line(entry)
        assert "status:" in line  # doesn't crash


class TestWpComplete:
    def test_format(self):
        entry = {
            "stage": "supervisor",
            "wp_id": "WP-003",
            "action": "wp_complete",
        }
        line = _build_stream_console_line(entry)
        assert "[supervisor]" in line
        assert "✓" in line
        assert "WP-003" in line
        assert "COMPLETE" in line

    def test_no_wp_id(self):
        entry = {"stage": "supervisor", "wp_id": "", "action": "wp_complete"}
        line = _build_stream_console_line(entry)
        assert "✓" in line
        assert "COMPLETE" in line


class TestProgressSnapshot:
    def test_format_full(self):
        entry = {
            "stage": "supervisor",
            "wp_id": "",
            "action": "progress_snapshot",
            "total_wps": 5,
            "status_breakdown": {"COMPLETE": 3, "IN_PROGRESS": 2},
            "iteration": 12,
            "max_iterations": 100,
            "elapsed_s": 872,  # 14m 32s
        }
        line = _build_stream_console_line(entry)
        assert "[supervisor]" in line
        assert "Progress:" in line
        assert "3/5" in line
        assert "WPs done" in line
        assert "2 in-progress" in line
        assert "iter 12/100" in line
        assert "14m 32s" in line
        assert "elapsed" in line

    def test_completed_count_reflects_breakdown(self):
        entry = {
            "stage": "supervisor",
            "wp_id": "",
            "action": "progress_snapshot",
            "total_wps": 10,
            "status_breakdown": {"COMPLETE": 7, "IN_PROGRESS": 1, "READY": 2},
            "iteration": 5,
            "max_iterations": 50,
            "elapsed_s": 300,
        }
        line = _build_stream_console_line(entry)
        assert "7/10" in line

    def test_no_elapsed_s(self):
        entry = {
            "stage": "supervisor",
            "wp_id": "",
            "action": "progress_snapshot",
            "total_wps": 3,
            "status_breakdown": {"COMPLETE": 1},
            "iteration": 2,
            "max_iterations": 100,
        }
        line = _build_stream_console_line(entry)
        assert "1/3" in line
        assert "elapsed" not in line

    def test_zero_in_progress_not_shown(self):
        entry = {
            "stage": "supervisor",
            "wp_id": "",
            "action": "progress_snapshot",
            "total_wps": 5,
            "status_breakdown": {"COMPLETE": 5},
            "iteration": 20,
            "max_iterations": 100,
            "elapsed_s": 600,
        }
        line = _build_stream_console_line(entry)
        assert "in-progress" not in line

    def test_missing_fields_no_crash(self):
        line = _build_stream_console_line({"action": "progress_snapshot"})
        assert "Progress:" in line
        assert "0/0" in line


class TestPipelineResult:
    def test_format_full(self):
        entry = {
            "stage": "developer",
            "wp_id": "WP-003",
            "action": "pipeline_result",
            "pipeline_status": "PASS",
            "files_modified": ["a.py", "b.py", "c.py", "d.py"],
            "duration_s": 204,
        }
        line = _build_stream_console_line(entry)
        assert "[developer]" in line
        assert "WP-003" in line
        assert "pipeline:" in line
        assert "PASS" in line
        assert "4 files modified" in line
        assert "3m 24s" in line

    def test_uses_result_field_as_fallback(self):
        # pipeline_status absent — falls back to result
        entry = {
            "stage": "developer",
            "wp_id": "WP-001",
            "action": "pipeline_result",
            "result": "FAIL",
            "files_modified": [],
        }
        line = _build_stream_console_line(entry)
        assert "FAIL" in line

    def test_no_files_no_duration(self):
        entry = {
            "stage": "developer",
            "wp_id": "WP-001",
            "action": "pipeline_result",
            "pipeline_status": "PASS",
        }
        line = _build_stream_console_line(entry)
        assert "pipeline: PASS" in line

    def test_missing_fields_no_crash(self):
        line = _build_stream_console_line({"action": "pipeline_result"})
        assert "pipeline" in line


class TestReworkDetected:
    def test_format_full(self):
        entry = {
            "stage": "supervisor",
            "wp_id": "WP-003",
            "action": "rework_detected",
            "rework_count": 2,
            "pipeline_type": "qa",
            "agent_role": "Developer",
        }
        line = _build_stream_console_line(entry)
        assert "[supervisor]" in line
        assert "⟳" in line
        assert "WP-003" in line
        assert "rework #2" in line
        assert "qa" in line
        assert "developer" in line

    def test_agent_role_lowercased(self):
        entry = {
            "stage": "supervisor",
            "wp_id": "WP-001",
            "action": "rework_detected",
            "rework_count": 1,
            "pipeline_type": "code-review",
            "agent_role": "Reviewer",
        }
        line = _build_stream_console_line(entry)
        assert "reviewer" in line
        assert "Reviewer" not in line

    def test_no_rework_count(self):
        entry = {
            "stage": "supervisor",
            "wp_id": "WP-001",
            "action": "rework_detected",
            "pipeline_type": "qa",
            "agent_role": "Developer",
        }
        line = _build_stream_console_line(entry)
        assert "⟳" in line
        assert "rework" in line
        assert "#" not in line

    def test_missing_fields_no_crash(self):
        line = _build_stream_console_line(
            {"stage": "supervisor", "wp_id": "WP-001", "action": "rework_detected"}
        )
        assert "⟳" in line
        assert "rework" in line


# ---------------------------------------------------------------------------
# Existing event type formatting is unchanged
# ---------------------------------------------------------------------------


class TestExistingEventTypes:
    """Verify that events not listed in WP-007 still use the legacy format."""

    def test_route_event(self):
        entry = {
            "stage": "supervisor",
            "wp_id": "WP-003",
            "action": "route",
            "result": "PASS",
            "tokens_used": 500,
        }
        line = _build_stream_console_line(entry)
        assert "[supervisor]" in line
        assert "WP-003" in line
        assert "route" in line
        assert "→ PASS" in line
        assert "500 tokens" in line

    def test_run_start_event(self):
        entry = {"stage": "cli", "wp_id": "", "action": "run_start"}
        line = _build_stream_console_line(entry)
        assert "[cli]" in line
        assert "run_start" in line

    def test_run_end_event(self):
        entry = {"stage": "cli", "wp_id": "", "action": "run_end", "result": ""}
        line = _build_stream_console_line(entry)
        assert "run_end" in line

    def test_mcp_error_event(self):
        entry = {
            "stage": "supervisor",
            "wp_id": "",
            "action": "mcp_error",
            "result": "ERROR",
        }
        line = _build_stream_console_line(entry)
        assert "mcp_error" in line
        assert "→ ERROR" in line

    def test_stage_error_event(self):
        entry = {
            "stage": "developer",
            "wp_id": "WP-001",
            "action": "stage_error",
            "result": "FAIL",
        }
        line = _build_stream_console_line(entry)
        assert "stage_error" in line
        assert "→ FAIL" in line

    def test_safety_limit_event(self):
        entry = {"stage": "supervisor", "wp_id": "", "action": "safety_limit"}
        line = _build_stream_console_line(entry)
        assert "safety_limit" in line


# ---------------------------------------------------------------------------
# Robustness — no crashes on missing/unexpected fields
# ---------------------------------------------------------------------------


class TestRobustness:
    def test_empty_entry(self):
        line = _build_stream_console_line({})
        assert isinstance(line, str)

    def test_action_only(self):
        line = _build_stream_console_line({"action": "unknown_future_event"})
        assert "unknown_future_event" in line

    def test_none_values_in_fields(self):
        entry = {
            "stage": None,
            "wp_id": None,
            "action": "stage_start",
        }
        line = _build_stream_console_line(entry)
        assert "stage_start" in line

    def test_extra_unknown_fields_ignored(self):
        entry = {
            "stage": "developer",
            "wp_id": "WP-001",
            "action": "route",
            "future_field": "future_value",
            "another_unknown": 42,
        }
        line = _build_stream_console_line(entry)
        assert "route" in line  # doesn't crash, ignores unknown fields
