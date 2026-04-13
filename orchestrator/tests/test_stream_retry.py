"""
test_stream_retry.py — Unit tests for the retry loop in _accumulate_stream().

Tests the WP-004, WP-009, and WP-010 acceptance criteria:

AC1: Retryable errors trigger retry with exponential backoff
AC2: Fatal errors propagate immediately
AC3: Exhausted retries propagate the last error
AC4: Accumulators reset on each attempt
AC5: ChunkWriter partial files cleaned up on retry
"""

from __future__ import annotations

from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from langchain_core.messages import AIMessageChunk

from src.nodes import _accumulate_stream

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_error_with_status(status_code: int) -> Exception:
    """Return a fake API error with the given HTTP status code."""
    exc = Exception(f"HTTP {status_code}")
    exc.status_code = status_code  # type: ignore[attr-defined]
    return exc


def _make_agent_success(chunks: list[AIMessageChunk]) -> Any:
    """Return a mock agent whose astream() yields the given chunks once (success)."""

    async def _astream(*args: Any, **kwargs: Any):
        for chunk in chunks:
            yield ((), (chunk, {}))

    agent = MagicMock()
    agent.astream = _astream
    return agent


def _make_agent_fail_then_succeed(
    error: Exception,
    chunks: list[AIMessageChunk],
    fail_count: int = 1,
) -> Any:
    """Return a mock agent that raises *error* for the first *fail_count*
    attempts, then succeeds by yielding *chunks*."""
    call_count = {"n": 0}

    async def _astream(*args: Any, **kwargs: Any):
        call_count["n"] += 1
        if call_count["n"] <= fail_count:
            raise error
        for chunk in chunks:
            yield ((), (chunk, {}))

    agent = MagicMock()
    agent.astream = _astream
    return agent


def _make_agent_always_fail(error: Exception) -> Any:
    """Return a mock agent whose astream() always raises *error*."""

    async def _astream(*args: Any, **kwargs: Any):
        raise error
        yield  # make it an async generator

    agent = MagicMock()
    agent.astream = _astream
    return agent


# ---------------------------------------------------------------------------
# AC1: Retryable errors trigger retry with exponential backoff
# ---------------------------------------------------------------------------


class TestRetryableErrors:
    """AC1: Retryable errors trigger retry with exponential backoff."""

    @pytest.mark.asyncio
    async def test_retry_on_429(self) -> None:
        """HTTP 429 should trigger a retry; second attempt succeeds."""
        error_429 = _make_error_with_status(429)
        chunk = AIMessageChunk(content="Done", id="msg-1")
        agent = _make_agent_fail_then_succeed(error_429, [chunk], fail_count=1)

        with patch("src.nodes.asyncio.sleep", new_callable=AsyncMock) as mock_sleep:
            msgs, _ = await _accumulate_stream(
                agent, "prompt", None, "WP-001", "developer",
                max_retries=1, base_delay_s=1.0,
            )

        assert len(msgs) == 1
        assert msgs[0].content == "Done"
        mock_sleep.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_retry_on_529(self) -> None:
        """HTTP 529 (Anthropic overloaded) should trigger a retry."""
        error_529 = _make_error_with_status(529)
        chunk = AIMessageChunk(content="OK", id="msg-1")
        agent = _make_agent_fail_then_succeed(error_529, [chunk], fail_count=1)

        with patch("src.nodes.asyncio.sleep", new_callable=AsyncMock) as mock_sleep:
            msgs, _ = await _accumulate_stream(
                agent, "prompt", None, "WP-001", "developer",
                max_retries=2, base_delay_s=1.0,
            )

        assert msgs[0].content == "OK"
        mock_sleep.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_retry_on_500(self) -> None:
        """HTTP 500 (generic server error) should trigger a retry."""
        error_500 = _make_error_with_status(500)
        chunk = AIMessageChunk(content="Recovered", id="msg-1")
        agent = _make_agent_fail_then_succeed(error_500, [chunk], fail_count=1)

        with patch("src.nodes.asyncio.sleep", new_callable=AsyncMock) as mock_sleep:
            msgs, _ = await _accumulate_stream(
                agent, "prompt", None, "WP-001", "developer",
                max_retries=1, base_delay_s=0.0,
            )

        assert msgs[0].content == "Recovered"
        mock_sleep.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_sleep_delay_uses_base_delay(self) -> None:
        """Sleep delay on first retry (attempt=0) must be base_delay * 2^0 * jitter,
        which is within [base_delay * 0.5, base_delay * 1.0)."""
        error = _make_error_with_status(429)
        chunk = AIMessageChunk(content="Done", id="msg-1")
        agent = _make_agent_fail_then_succeed(error, [chunk], fail_count=1)

        slept: list[float] = []

        async def _capture_sleep(delay: float) -> None:
            slept.append(delay)

        with patch("src.nodes.asyncio.sleep", side_effect=_capture_sleep):
            await _accumulate_stream(
                agent, "prompt", None, "WP-001", "developer",
                max_retries=1, base_delay_s=10.0,
            )

        assert slept, "asyncio.sleep was never called"
        # attempt=0: delay = 10.0 * 2^0 * [0.5, 1.0) → [5.0, 10.0)
        assert 5.0 <= slept[0] < 10.0, f"Unexpected delay: {slept[0]}"

    @pytest.mark.asyncio
    async def test_sleep_delay_doubles_on_second_retry(self) -> None:
        """Sleep delay on second retry (attempt=1) must be 2× the first attempt range."""
        error = _make_error_with_status(429)
        chunk = AIMessageChunk(content="Done", id="msg-1")
        agent = _make_agent_fail_then_succeed(error, [chunk], fail_count=2)

        slept: list[float] = []

        async def _capture_sleep(delay: float) -> None:
            slept.append(delay)

        with patch("src.nodes.asyncio.sleep", side_effect=_capture_sleep):
            await _accumulate_stream(
                agent, "prompt", None, "WP-001", "developer",
                max_retries=2, base_delay_s=10.0,
            )

        assert len(slept) == 2, f"Expected 2 sleep calls, got {len(slept)}"
        # attempt=0: [5.0, 10.0); attempt=1: [10.0, 20.0)
        assert 5.0 <= slept[0] < 10.0, f"First delay out of range: {slept[0]}"
        assert 10.0 <= slept[1] < 20.0, f"Second delay out of range: {slept[1]}"


# ---------------------------------------------------------------------------
# AC2: Fatal errors propagate immediately
# ---------------------------------------------------------------------------


class TestFatalErrors:
    """AC2: Fatal errors propagate immediately without retrying."""

    @pytest.mark.asyncio
    async def test_401_propagates_immediately(self) -> None:
        """HTTP 401 must propagate immediately, no retry."""
        error_401 = _make_error_with_status(401)
        agent = _make_agent_always_fail(error_401)

        with patch("src.nodes.asyncio.sleep", new_callable=AsyncMock) as mock_sleep:
            with pytest.raises(Exception, match="HTTP 401"):
                await _accumulate_stream(
                    agent, "prompt", None, "WP-001", "developer",
                    max_retries=3, base_delay_s=1.0,
                )

        mock_sleep.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_403_propagates_immediately(self) -> None:
        """HTTP 403 must propagate immediately, no retry."""
        error_403 = _make_error_with_status(403)
        agent = _make_agent_always_fail(error_403)

        with patch("src.nodes.asyncio.sleep", new_callable=AsyncMock) as mock_sleep:
            with pytest.raises(Exception, match="HTTP 403"):
                await _accumulate_stream(
                    agent, "prompt", None, "WP-001", "developer",
                    max_retries=3, base_delay_s=1.0,
                )

        mock_sleep.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_plain_value_error_propagates_immediately(self) -> None:
        """A plain ValueError (non-HTTP) is not retryable and must propagate."""

        async def _astream(*a: Any, **kw: Any) -> Any:
            raise ValueError("unexpected")
            yield  # make it a generator

        agent = MagicMock()
        agent.astream = _astream

        with patch("src.nodes.asyncio.sleep", new_callable=AsyncMock) as mock_sleep:
            with pytest.raises(ValueError, match="unexpected"):
                await _accumulate_stream(
                    agent, "prompt", None, "WP-001", "developer",
                    max_retries=3, base_delay_s=1.0,
                )

        mock_sleep.assert_not_awaited()


# ---------------------------------------------------------------------------
# AC3: Exhausted retries propagate the last error
# ---------------------------------------------------------------------------


class TestExhaustedRetries:
    """AC3: When all retries are exhausted, the last error is re-raised."""

    @pytest.mark.asyncio
    async def test_last_error_raised_after_exhausted_retries(self) -> None:
        """After max_retries attempts, the transient error must propagate."""
        error = _make_error_with_status(429)
        agent = _make_agent_always_fail(error)

        with patch("src.nodes.asyncio.sleep", new_callable=AsyncMock) as mock_sleep:
            with pytest.raises(Exception, match="HTTP 429"):
                await _accumulate_stream(
                    agent, "prompt", None, "WP-001", "developer",
                    max_retries=2, base_delay_s=0.0,
                )

        # 3 attempts total (0, 1, 2) → 2 sleep calls (between attempt 0→1 and 1→2)
        assert mock_sleep.await_count == 2

    @pytest.mark.asyncio
    async def test_no_retry_when_max_retries_is_zero(self) -> None:
        """max_retries=0 means no retries; error propagates on first failure."""
        error = _make_error_with_status(429)
        agent = _make_agent_always_fail(error)

        with patch("src.nodes.asyncio.sleep", new_callable=AsyncMock) as mock_sleep:
            with pytest.raises(Exception, match="HTTP 429"):
                await _accumulate_stream(
                    agent, "prompt", None, "WP-001", "developer",
                    max_retries=0, base_delay_s=1.0,
                )

        mock_sleep.assert_not_awaited()


# ---------------------------------------------------------------------------
# AC4: Accumulators reset on each attempt
# ---------------------------------------------------------------------------


class TestAccumulatorReset:
    """AC4: Accumulators must be reset between retry attempts so no stale
    partial messages from a failed attempt appear in the final result."""

    @pytest.mark.asyncio
    async def test_partial_chunks_from_failed_attempt_discarded(self) -> None:
        """Chunks accumulated before the error must NOT appear in the result."""
        # First attempt: yields partial chunk then raises
        partial_chunk = AIMessageChunk(content="PARTIAL", id="msg-partial")
        full_chunk = AIMessageChunk(content="FULL", id="msg-full")

        call_count = {"n": 0}

        async def _astream(*args: Any, **kwargs: Any):
            call_count["n"] += 1
            if call_count["n"] == 1:
                yield ((), (partial_chunk, {}))
                raise _make_error_with_status(429)
            else:
                yield ((), (full_chunk, {}))

        agent = MagicMock()
        agent.astream = _astream

        with patch("src.nodes.asyncio.sleep", new_callable=AsyncMock):
            msgs, _ = await _accumulate_stream(
                agent, "prompt", None, "WP-001", "developer",
                max_retries=1, base_delay_s=0.0,
            )

        # Only the clean second-attempt result should be present
        assert len(msgs) == 1
        assert msgs[0].content == "FULL"
        contents = [m.content for m in msgs]
        assert "PARTIAL" not in contents

    @pytest.mark.asyncio
    async def test_multiple_retries_accumulator_clean(self) -> None:
        """After two failed attempts the final result contains only messages
        from the successful third attempt."""
        error = _make_error_with_status(529)
        good_chunk = AIMessageChunk(content="CLEAN", id="msg-clean")

        call_count = {"n": 0}

        async def _astream(*args: Any, **kwargs: Any):
            call_count["n"] += 1
            if call_count["n"] <= 2:
                stale_id = f"stale-{call_count['n']}"
                stale_content = f"STALE-{call_count['n']}"
                yield ((), (AIMessageChunk(content=stale_content, id=stale_id), {}))
                raise error
            yield ((), (good_chunk, {}))

        agent = MagicMock()
        agent.astream = _astream

        with patch("src.nodes.asyncio.sleep", new_callable=AsyncMock):
            msgs, _ = await _accumulate_stream(
                agent, "prompt", None, "WP-001", "developer",
                max_retries=2, base_delay_s=0.0,
            )

        assert len(msgs) == 1
        assert msgs[0].content == "CLEAN"


# ---------------------------------------------------------------------------
# AC5: ChunkWriter partial files cleaned up on retry
# ---------------------------------------------------------------------------


class TestChunkWriterCleanup:
    """AC5: ChunkWriter.delete() must be called on the partial file when a
    retry occurs; the partial JSONL file must not remain on disk."""

    @pytest.mark.asyncio
    async def test_partial_chunk_file_deleted_on_retry(self, tmp_path: Path) -> None:
        """After a retryable error the partial chunk file must be deleted."""
        slug_dir = tmp_path / "mcp-server" / "storage" / "ledger" / "test-slug"
        error = _make_error_with_status(429)
        good_chunk = AIMessageChunk(content="Done", id="msg-1")
        agent = _make_agent_fail_then_succeed(error, [good_chunk], fail_count=1)

        with patch("src.nodes.asyncio.sleep", new_callable=AsyncMock):
            msgs, final_path = await _accumulate_stream(
                agent, "prompt", slug_dir, "WP-001", "developer",
                max_retries=1, base_delay_s=0.0,
            )

        assert msgs[0].content == "Done"
        chunks_dir = slug_dir / "orchestrator" / "chunks"
        # Final file exists (revision 1, from the successful attempt)
        assert final_path is not None
        assert final_path.exists()
        # Only one JSONL file should exist (the partial was deleted)
        jsonl_files = list(chunks_dir.glob("WP-001-developer-r*.jsonl"))
        assert len(jsonl_files) == 1, (
            f"Expected 1 chunk file (partial deleted), found {len(jsonl_files)}: {jsonl_files}"
        )

    @pytest.mark.asyncio
    async def test_partial_chunk_file_deleted_when_retries_exhausted(
        self, tmp_path: Path
    ) -> None:
        """When all retries are exhausted, all partial chunk files must be deleted."""
        slug_dir = tmp_path / "mcp-server" / "storage" / "ledger" / "test-slug"
        error = _make_error_with_status(429)
        agent = _make_agent_always_fail(error)

        with patch("src.nodes.asyncio.sleep", new_callable=AsyncMock):
            with pytest.raises(Exception, match="HTTP 429"):
                await _accumulate_stream(
                    agent, "prompt", slug_dir, "WP-001", "developer",
                    max_retries=1, base_delay_s=0.0,
                )

        chunks_dir = slug_dir / "orchestrator" / "chunks"
        # No partial files should remain after all retries are exhausted
        if chunks_dir.exists():
            jsonl_files = list(chunks_dir.glob("WP-001-developer-r*.jsonl"))
            assert not jsonl_files, (
                f"Partial chunk files must be deleted on final failure: {jsonl_files}"
            )

    @pytest.mark.asyncio
    async def test_no_chunk_file_deleted_on_success(self, tmp_path: Path) -> None:
        """When the stream succeeds on the first attempt, the file is kept."""
        slug_dir = tmp_path / "mcp-server" / "storage" / "ledger" / "test-slug"
        chunk = AIMessageChunk(content="Success", id="msg-1")
        agent = _make_agent_success([chunk])

        msgs, final_path = await _accumulate_stream(
            agent, "prompt", slug_dir, "WP-001", "developer",
            max_retries=1, base_delay_s=0.0,
        )

        assert msgs[0].content == "Success"
        assert final_path is not None
        assert final_path.exists(), "Chunk file must exist after a successful run"

    @pytest.mark.asyncio
    async def test_fatal_error_deletes_partial_chunk_file(self, tmp_path: Path) -> None:
        """Even on a fatal (non-retryable) error, the partial chunk file is deleted."""
        slug_dir = tmp_path / "mcp-server" / "storage" / "ledger" / "test-slug"
        error = _make_error_with_status(401)
        agent = _make_agent_always_fail(error)

        with pytest.raises(Exception, match="HTTP 401"):
            await _accumulate_stream(
                agent, "prompt", slug_dir, "WP-001", "developer",
                max_retries=2, base_delay_s=0.0,
            )

        chunks_dir = slug_dir / "orchestrator" / "chunks"
        if chunks_dir.exists():
            jsonl_files = list(chunks_dir.glob("WP-001-developer-r*.jsonl"))
            assert not jsonl_files, (
                f"Partial chunk files must be deleted on fatal error: {jsonl_files}"
            )


# ---------------------------------------------------------------------------
# WP-009: stage_retry JSONL log entry
# ---------------------------------------------------------------------------


class TestStageRetryLogEntry:
    """WP-009 acceptance criteria:
    AC1: Each retry attempt emits a stage_retry JSONL entry.
    AC2: Entry contains attempt number, error message, and delay.
    AC3: Entries appear in the structured run log.
    """

    @pytest.mark.asyncio
    async def test_retry_emits_stage_retry_entry(self) -> None:
        """AC1+AC3: run_logger.stream_entry is called once per retry."""
        error = _make_error_with_status(429)
        chunk = AIMessageChunk(content="Done", id="msg-1")
        agent = _make_agent_fail_then_succeed(error, [chunk], fail_count=1)

        run_logger = MagicMock()

        with patch("src.nodes.asyncio.sleep", new_callable=AsyncMock):
            await _accumulate_stream(
                agent, "prompt", None, "WP-001", "developer",
                max_retries=1, base_delay_s=0.0, run_logger=run_logger,
            )

        run_logger.stream_entry.assert_called_once()
        entry = run_logger.stream_entry.call_args[0][0]
        assert entry["action"] == "stage_retry"

    @pytest.mark.asyncio
    async def test_retry_entry_fields(self) -> None:
        """AC2: Entry contains attempt, max_attempts, error, and delay_s."""
        error = _make_error_with_status(529)
        chunk = AIMessageChunk(content="OK", id="msg-1")
        agent = _make_agent_fail_then_succeed(error, [chunk], fail_count=1)

        run_logger = MagicMock()

        with patch("src.nodes.asyncio.sleep", new_callable=AsyncMock):
            await _accumulate_stream(
                agent, "prompt", None, "WP-007", "qa",
                max_retries=2, base_delay_s=0.0, run_logger=run_logger,
            )

        entry = run_logger.stream_entry.call_args[0][0]
        assert entry["action"] == "stage_retry"
        assert entry["stage"] == "qa"
        assert entry["wp_id"] == "WP-007"
        assert entry["attempt"] == 1
        assert entry["max_attempts"] == 3
        assert "HTTP 529" in entry["error"]
        assert "delay_s" in entry
        assert entry["level"] == "WARNING"

    @pytest.mark.asyncio
    async def test_multiple_retries_emit_one_entry_each(self) -> None:
        """AC1: Two retries produce two stage_retry entries."""
        error = _make_error_with_status(500)
        chunk = AIMessageChunk(content="Recovered", id="msg-1")
        agent = _make_agent_fail_then_succeed(error, [chunk], fail_count=2)

        run_logger = MagicMock()

        with patch("src.nodes.asyncio.sleep", new_callable=AsyncMock):
            await _accumulate_stream(
                agent, "prompt", None, "WP-001", "developer",
                max_retries=2, base_delay_s=0.0, run_logger=run_logger,
            )

        assert run_logger.stream_entry.call_count == 2
        entries = [call[0][0] for call in run_logger.stream_entry.call_args_list]
        assert entries[0]["attempt"] == 1
        assert entries[1]["attempt"] == 2

    @pytest.mark.asyncio
    async def test_no_entry_on_success_without_retry(self) -> None:
        """AC1: No stage_retry entry when the stream succeeds on first attempt."""
        chunk = AIMessageChunk(content="Done", id="msg-1")
        agent = _make_agent_success([chunk])

        run_logger = MagicMock()

        await _accumulate_stream(
            agent, "prompt", None, "WP-001", "developer",
            max_retries=2, base_delay_s=0.0, run_logger=run_logger,
        )

        run_logger.stream_entry.assert_not_called()

    @pytest.mark.asyncio
    async def test_no_entry_when_run_logger_is_none(self) -> None:
        """AC3: When run_logger is None, retry must still succeed without error."""
        error = _make_error_with_status(429)
        chunk = AIMessageChunk(content="Done", id="msg-1")
        agent = _make_agent_fail_then_succeed(error, [chunk], fail_count=1)

        with patch("src.nodes.asyncio.sleep", new_callable=AsyncMock):
            msgs, _ = await _accumulate_stream(
                agent, "prompt", None, "WP-001", "developer",
                max_retries=1, base_delay_s=0.0, run_logger=None,
            )

        assert msgs[0].content == "Done"
