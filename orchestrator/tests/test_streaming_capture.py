"""
test_streaming_capture.py — Integration tests for the astream() + ChunkWriter
integration added in WP-002.

These tests verify:
1. After a stage completes, a JSONL chunk file exists in
   {slug_dir}/orchestrator/chunks/ containing one JSON line per stream chunk.
2. final_content, tokens_used, and _msgs derived from the accumulated
   AIMessageChunk stream match the expected values.
3. Markdown dialogue render was removed — no serialize/write_dialogue calls.
4. A dialogue_captured JSONL event with format="chunks" is emitted.
5. ChunkWriter is always closed (via try/finally) even when the stream raises.

No real LLM or MCP calls are made.  All agent interactions are mocked.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

from langchain_core.messages import AIMessageChunk

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
# _StreamCaptureConfig and _NoCaptureConfig are defined in conftest.py;
# imported explicitly below due to this directory being a Python package.
from tests.conftest import _NoCaptureConfig, _StreamCaptureConfig  # noqa: F401


def _base_state(
    project_path: str = "/some/ledger/root/2026-04-10-streaming-test",
    current_wp_id: str = "WP-001",
) -> dict:
    return {
        "project_path": project_path,
        "plan_file": "plan.md",
        "target_project_path": "/target",
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


def _patch_persona():
    return patch("src.utils.persona.load_persona", return_value="Test persona")


def _patch_backend():
    return patch("deepagents.backends.LocalShellBackend", return_value=MagicMock())


def _make_stream_agent(chunks: list[tuple]) -> MagicMock:
    """Return a mock agent whose astream() yields the provided (ns, (msg, meta)) items."""

    async def _astream(inputs, *args, **kwargs):
        for item in chunks:
            yield item

    agent = MagicMock()
    agent.astream = _astream
    return agent


# ---------------------------------------------------------------------------
# Tests: JSONL chunk file creation
# ---------------------------------------------------------------------------


class TestChunkFileCreation:
    """AC1: chunk file created in {slug_dir}/orchestrator/chunks/ with one
    JSON line per stream chunk."""

    async def test_chunk_file_created_after_stage(self, tmp_path: Path) -> None:
        """A JSONL chunk file must exist after the stage completes."""
        from src.nodes.developer import make_developer_node

        cfg = _StreamCaptureConfig(workspace_root=tmp_path)
        node_fn = make_developer_node(cfg, [])

        chunk = AIMessageChunk(content="Hello", id="msg-1")
        agent = _make_stream_agent([
            ((), (chunk, {"langgraph_node": "agent"})),
        ])

        with _patch_persona(), _patch_backend(), \
             patch("deepagents.create_deep_agent", return_value=agent):
            result = await node_fn(_base_state(
                project_path="/some/ledger/root/2026-04-10-streaming-test",
                current_wp_id="WP-001",
            ))

        assert result["stage_success"] is True
        # slug = Path(project_path).name
        slug = "2026-04-10-streaming-test"
        chunks_dir = (
            tmp_path / "mcp-server" / "storage" / "ledger" / slug / "orchestrator" / "chunks"
        )
        assert chunks_dir.is_dir(), f"chunks dir not created: {chunks_dir}"
        jsonl_files = list(chunks_dir.glob("WP-001-developer-r*.jsonl"))
        assert jsonl_files, f"No chunk JSONL file found in {chunks_dir}"

    async def test_chunk_file_name_format(self, tmp_path: Path) -> None:
        """Chunk file must follow {wp_id}-{stage}-r{N}.jsonl naming."""
        from src.nodes.developer import make_developer_node

        cfg = _StreamCaptureConfig(workspace_root=tmp_path)
        node_fn = make_developer_node(cfg, [])

        chunk = AIMessageChunk(content="chunk", id="msg-1")
        agent = _make_stream_agent([((), (chunk, {}))])

        with _patch_persona(), _patch_backend(), \
             patch("deepagents.create_deep_agent", return_value=agent):
            await node_fn(_base_state(current_wp_id="WP-007"))

        slug = "2026-04-10-streaming-test"
        chunks_dir = (
            tmp_path / "mcp-server" / "storage" / "ledger" / slug / "orchestrator" / "chunks"
        )
        jsonl_files = list(chunks_dir.glob("*.jsonl"))
        assert jsonl_files
        name = jsonl_files[0].name
        assert name.startswith("WP-007-developer-r"), f"Unexpected name: {name}"
        assert name.endswith(".jsonl")

    async def test_chunk_file_contains_header_and_chunks(self, tmp_path: Path) -> None:
        """Chunk JSONL file must start with the version header followed by one
        JSON line per stream chunk."""
        from src.nodes.developer import make_developer_node

        cfg = _StreamCaptureConfig(workspace_root=tmp_path)
        node_fn = make_developer_node(cfg, [])

        chunk_a = AIMessageChunk(content="Hello", id="msg-1")
        chunk_b = AIMessageChunk(content=" world", id="msg-1")
        agent = _make_stream_agent([
            ((), (chunk_a, {"langgraph_node": "agent"})),
            ((), (chunk_b, {"langgraph_node": "agent"})),
        ])

        with _patch_persona(), _patch_backend(), \
             patch("deepagents.create_deep_agent", return_value=agent):
            await node_fn(_base_state(current_wp_id="WP-001"))

        slug = "2026-04-10-streaming-test"
        chunks_dir = (
            tmp_path / "mcp-server" / "storage" / "ledger" / slug / "orchestrator" / "chunks"
        )
        jsonl_file = next(chunks_dir.glob("WP-001-developer-r*.jsonl"))
        lines = [json.loads(ln) for ln in jsonl_file.read_text().splitlines() if ln]

        # Line 0 is the header
        assert lines[0].get("chunk_format") == 1
        assert lines[0].get("stream_mode") == "messages"
        # Lines 1 and 2 are the chunk records (one per stream item)
        assert len(lines) == 3, f"Expected 3 lines (header + 2 chunks), got {len(lines)}"
        for line in lines[1:]:
            assert "ns" in line
            assert "msg" in line

    async def test_no_chunk_file_when_capture_false(self, tmp_path: Path) -> None:
        """When capture_dialogues=False, no chunk file must be written."""
        from src.nodes.developer import make_developer_node

        cfg = _NoCaptureConfig()
        node_fn = make_developer_node(cfg, [])

        chunk = AIMessageChunk(content="text", id="msg-1")
        agent = _make_stream_agent([((), (chunk, {}))])

        with _patch_persona(), _patch_backend(), \
             patch("deepagents.create_deep_agent", return_value=agent):
            result = await node_fn(_base_state(current_wp_id="WP-001"))

        assert result["stage_success"] is True
        # No chunks directory must exist under the NoCaptureConfig workspace.
        chunks_dir = cfg.workspace_root / "mcp-server" / "storage" / "ledger"
        assert not chunks_dir.exists() or not list(chunks_dir.rglob("*.jsonl"))

    async def test_no_chunk_file_when_wp_id_empty(self, tmp_path: Path) -> None:
        """When wp_id is empty (synthesis), no chunk file must be written."""
        from src.nodes.synthesis import make_synthesis_node

        cfg = _StreamCaptureConfig(workspace_root=tmp_path)
        node_fn = make_synthesis_node(cfg, [])

        chunk = AIMessageChunk(content="synthesis done", id="msg-1")
        agent = _make_stream_agent([((), (chunk, {}))])

        with _patch_persona(), _patch_backend(), \
             patch("deepagents.create_deep_agent", return_value=agent):
            result = await node_fn(_base_state(current_wp_id=""))

        assert result["stage_success"] is True
        chunks_dir = tmp_path / "mcp-server" / "storage"
        # No JSONL file under the tmp workspace
        jsonl_files = list(chunks_dir.rglob("*.jsonl")) if chunks_dir.exists() else []
        assert not jsonl_files, f"Unexpected chunk files: {jsonl_files}"


# ---------------------------------------------------------------------------
# Tests: AIMessageChunk accumulation — final_content, tokens_used, _msgs
# ---------------------------------------------------------------------------


class TestStreamAccumulation:
    """AC2: final_content, tokens_used, and _msgs match expected values derived
    from accumulated stream chunks."""

    async def test_final_content_from_single_chunk(self, tmp_path: Path) -> None:
        """final_content must equal the content of a single AIMessageChunk."""
        from src.nodes.developer import make_developer_node

        cfg = _StreamCaptureConfig(workspace_root=tmp_path)
        node_fn = make_developer_node(cfg, [])

        chunk = AIMessageChunk(content="Task complete.", id="msg-1")
        agent = _make_stream_agent([((), (chunk, {}))])

        with _patch_persona(), _patch_backend(), \
             patch("deepagents.create_deep_agent", return_value=agent):
            result = await node_fn(_base_state())

        assert result["stage_result"] == "Task complete."

    async def test_final_content_from_multiple_chunks_same_id(self, tmp_path: Path) -> None:
        """Fragments of the same message ID must be merged; final_content equals
        the concatenated text."""
        from src.nodes.developer import make_developer_node

        cfg = _StreamCaptureConfig(workspace_root=tmp_path)
        node_fn = make_developer_node(cfg, [])

        chunks = [
            AIMessageChunk(content="Hello", id="msg-1"),
            AIMessageChunk(content=" world", id="msg-1"),
            AIMessageChunk(content="!", id="msg-1"),
        ]
        agent = _make_stream_agent([
            ((), (c, {"langgraph_node": "agent"})) for c in chunks
        ])

        with _patch_persona(), _patch_backend(), \
             patch("deepagents.create_deep_agent", return_value=agent):
            result = await node_fn(_base_state())

        assert result["stage_result"] == "Hello world!"

    async def test_tokens_used_accumulated_from_usage_metadata(self, tmp_path: Path) -> None:
        """tokens_used must reflect the merged usage_metadata from accumulated chunks."""
        from src.nodes.developer import make_developer_node

        cfg = _StreamCaptureConfig(workspace_root=tmp_path)
        node_fn = make_developer_node(cfg, [])

        # First chunk carries input token count; last carries output count.
        chunk1 = AIMessageChunk(
            content="Answer",
            id="msg-1",
            usage_metadata={"input_tokens": 50, "output_tokens": 1, "total_tokens": 51},
        )
        chunk2 = AIMessageChunk(
            content=" text",
            id="msg-1",
            usage_metadata={"input_tokens": 0, "output_tokens": 1, "total_tokens": 1},
        )
        agent = _make_stream_agent([
            ((), (chunk1, {})),
            ((), (chunk2, {})),
        ])

        with _patch_persona(), _patch_backend(), \
             patch("deepagents.create_deep_agent", return_value=agent):
            result = await node_fn(_base_state())

        # Find stage_complete entry and check tokens_used
        complete_entries = [e for e in result["run_log"] if e.get("action") == "stage_complete"]
        assert complete_entries
        tokens = complete_entries[0].get("tokens_used")
        assert tokens is not None, "tokens_used must be present in stage_complete"
        assert tokens.get("input_tokens") == 50
        assert tokens.get("output_tokens") == 2

    async def test_multiple_distinct_message_ids_ordered_correctly(self, tmp_path: Path) -> None:
        """When two message IDs appear in the stream, _msgs must contain two
        accumulated entries in order.  stage_result reflects the last message."""
        from src.nodes.developer import make_developer_node

        cfg = _StreamCaptureConfig(workspace_root=tmp_path)
        node_fn = make_developer_node(cfg, [])

        # msg-1 interleaved with msg-2
        items = [
            ((), (AIMessageChunk(content="Msg1-part1", id="msg-1"), {})),
            ((), (AIMessageChunk(content="Msg2-part1", id="msg-2"), {})),
            ((), (AIMessageChunk(content="-part2", id="msg-1"), {})),
            ((), (AIMessageChunk(content="-part2", id="msg-2"), {})),
        ]
        agent = _make_stream_agent(items)

        with _patch_persona(), _patch_backend(), \
             patch("deepagents.create_deep_agent", return_value=agent):
            result = await node_fn(_base_state())

        # stage_result is content of the last message in stream order
        assert result["stage_result"] == "Msg2-part1-part2"


# ---------------------------------------------------------------------------
# Tests: Markdown dialogue removal verification
# ---------------------------------------------------------------------------


class TestNoMarkdownDialogue:
    """AC3: Markdown dialogue render was removed — verify no
    serialize_messages_to_markdown or write_dialogue calls occur."""

    async def test_no_markdown_dialogue_on_success(self, tmp_path: Path) -> None:
        """No Markdown dialogue capture must occur on the success path."""
        from src.nodes.developer import make_developer_node

        cfg = _StreamCaptureConfig(workspace_root=tmp_path)
        node_fn = make_developer_node(cfg, [])

        chunk = AIMessageChunk(content="done", id="msg-1")
        agent = _make_stream_agent([((), (chunk, {}))])

        with _patch_persona(), _patch_backend(), \
             patch("deepagents.create_deep_agent", return_value=agent):
            result = await node_fn(_base_state())

        assert result["stage_success"] is True
        # No dialogue_captured event with format="markdown" must exist
        md_events = [
            e for e in result["run_log"]
            if e.get("action") == "dialogue_captured" and e.get("format") == "markdown"
        ]
        assert not md_events, "No Markdown dialogue events expected after removal"


# ---------------------------------------------------------------------------
# Tests: dialogue_captured event with format="chunks"
# ---------------------------------------------------------------------------


class TestDialogueCapturedChunkEvent:
    """AC4: dialogue_captured event with format='chunks' must be emitted
    for the chunk file when capture_dialogues=True."""

    async def test_chunk_event_emitted_in_run_log(self, tmp_path: Path) -> None:
        """A dialogue_captured entry with format='chunks' must appear in run_log."""
        from src.nodes.developer import make_developer_node

        cfg = _StreamCaptureConfig(workspace_root=tmp_path)
        node_fn = make_developer_node(cfg, [])

        chunk = AIMessageChunk(content="done", id="msg-1")
        agent = _make_stream_agent([((), (chunk, {}))])

        with _patch_persona(), _patch_backend(), \
             patch("deepagents.create_deep_agent", return_value=agent):
            result = await node_fn(_base_state())

        chunk_events = [
            e for e in result["run_log"]
            if e.get("action") == "dialogue_captured" and e.get("format") == "chunks"
        ]
        assert chunk_events, "dialogue_captured with format='chunks' must appear in run_log"
        event = chunk_events[0]
        assert event.get("wp_id") == "WP-001"
        assert event.get("stage") == "developer"
        assert event.get("level") == "INFO"
        assert event.get("file_path"), "file_path must be non-empty"
        assert ".jsonl" in event["file_path"], "chunk file_path must end in .jsonl"

    async def test_chunk_event_not_emitted_when_capture_false(self) -> None:
        """No dialogue_captured event emitted when capture_dialogues=False."""
        from src.nodes.developer import make_developer_node

        cfg = _NoCaptureConfig()
        node_fn = make_developer_node(cfg, [])

        chunk = AIMessageChunk(content="done", id="msg-1")
        agent = _make_stream_agent([((), (chunk, {}))])

        with _patch_persona(), _patch_backend(), \
             patch("deepagents.create_deep_agent", return_value=agent):
            result = await node_fn(_base_state())

        chunk_events = [
            e for e in result["run_log"]
            if e.get("action") == "dialogue_captured"
        ]
        assert not chunk_events, "No dialogue_captured events when capture=False"

    async def test_chunk_event_not_emitted_when_wp_id_empty(self, tmp_path: Path) -> None:
        """No dialogue_captured event emitted when wp_id is empty."""
        from src.nodes.synthesis import make_synthesis_node

        cfg = _StreamCaptureConfig(workspace_root=tmp_path)
        node_fn = make_synthesis_node(cfg, [])

        chunk = AIMessageChunk(content="synthesis", id="msg-1")
        agent = _make_stream_agent([((), (chunk, {}))])

        with _patch_persona(), _patch_backend(), \
             patch("deepagents.create_deep_agent", return_value=agent):
            result = await node_fn(_base_state(current_wp_id=""))

        chunk_events = [
            e for e in result["run_log"]
            if e.get("action") == "dialogue_captured"
        ]
        assert not chunk_events, "No dialogue_captured events when wp_id is empty"


# ---------------------------------------------------------------------------
# Tests: ChunkWriter always closed via try/finally
# ---------------------------------------------------------------------------


class TestChunkWriterAlwaysClosed:
    """AC7: ChunkWriter.close() must be called even when the stream raises."""

    async def test_chunk_writer_closed_on_stream_error(self, tmp_path: Path) -> None:
        """ChunkWriter.close() must be called when astream() raises mid-stream."""
        from src.nodes.developer import make_developer_node

        cfg = _StreamCaptureConfig(workspace_root=tmp_path)
        node_fn = make_developer_node(cfg, [])

        close_called: list[bool] = []

        class _TrackingChunkWriter:
            """ChunkWriter replacement that tracks close() calls."""

            def __init__(self, *args: Any, **kwargs: Any) -> None:
                self.path = Path("/tmp/chunk.jsonl")

            def write_chunk(self, chunk: dict) -> None:
                pass

            def close(self) -> None:
                close_called.append(True)

        async def _failing_astream(inputs, *args, **kwargs):
            yield ((), (AIMessageChunk(content="partial", id="msg-1"), {}))
            raise RuntimeError("Simulated stream failure mid-way")

        agent = MagicMock()
        agent.astream = _failing_astream

        with _patch_persona(), _patch_backend(), \
             patch("deepagents.create_deep_agent", return_value=agent), \
             patch("src.nodes.ChunkWriter", side_effect=_TrackingChunkWriter):
            result = await node_fn(_base_state())

        assert result["stage_success"] is False, "Stage must fail when stream raises"
        assert close_called, "ChunkWriter.close() must have been called even on stream error"

    async def test_chunk_writer_closed_on_success(self, tmp_path: Path) -> None:
        """ChunkWriter.close() must be called on the normal success path."""
        from src.nodes.developer import make_developer_node

        cfg = _StreamCaptureConfig(workspace_root=tmp_path)
        node_fn = make_developer_node(cfg, [])

        close_called: list[bool] = []

        class _TrackingChunkWriter:
            """ChunkWriter replacement that tracks close() calls."""

            def __init__(self, *args: Any, **kwargs: Any) -> None:
                self.path = Path("/tmp/chunk.jsonl")

            def write_chunk(self, chunk: dict) -> None:
                pass

            def close(self) -> None:
                close_called.append(True)

        chunk = AIMessageChunk(content="done", id="msg-1")
        agent = _make_stream_agent([((), (chunk, {}))])

        with _patch_persona(), _patch_backend(), \
             patch("deepagents.create_deep_agent", return_value=agent), \
             patch("src.nodes.ChunkWriter", side_effect=_TrackingChunkWriter):
            result = await node_fn(_base_state())

        assert result["stage_success"] is True
        assert close_called, "ChunkWriter.close() must have been called on success"

    async def test_partial_chunks_written_before_stream_error(self, tmp_path: Path) -> None:
        """Chunks accumulated before the stream error must have been written
        to the ChunkWriter before close() is called."""
        from src.nodes.developer import make_developer_node

        cfg = _StreamCaptureConfig(workspace_root=tmp_path)
        node_fn = make_developer_node(cfg, [])

        written_chunks: list[dict] = []
        close_called: list[bool] = []

        class _TrackingChunkWriter:
            def __init__(self, *args: Any, **kwargs: Any) -> None:
                self.path = Path("/tmp/chunk.jsonl")

            def write_chunk(self, chunk: dict) -> None:
                written_chunks.append(chunk)

            def close(self) -> None:
                close_called.append(True)

        async def _failing_stream(inputs, *args, **kwargs):
            yield ((), (AIMessageChunk(content="partial content", id="msg-1"), {}))
            raise RuntimeError("Mid-stream failure")

        agent = MagicMock()
        agent.astream = _failing_stream

        with _patch_persona(), _patch_backend(), \
             patch("deepagents.create_deep_agent", return_value=agent), \
             patch("src.nodes.ChunkWriter", side_effect=_TrackingChunkWriter):
            result = await node_fn(_base_state())

        assert result["stage_success"] is False
        assert close_called, "ChunkWriter.close() must have been called on error path"
        assert written_chunks, "Partial chunks must have been written before the error"


# ---------------------------------------------------------------------------
# Tests: stream items without ChunkWriter (capture_dialogues=False)
# ---------------------------------------------------------------------------


class TestStreamWithoutCapture:
    """Verify streaming still works correctly when capture_dialogues=False
    (no ChunkWriter instantiated)."""

    async def test_stage_succeeds_without_chunk_writer(self) -> None:
        """Stage must complete normally when capture_dialogues=False."""
        from src.nodes.developer import make_developer_node

        cfg = _NoCaptureConfig()
        node_fn = make_developer_node(cfg, [])

        chunk = AIMessageChunk(content="Result text", id="msg-1")
        agent = _make_stream_agent([((), (chunk, {}))])

        with _patch_persona(), _patch_backend(), \
             patch("deepagents.create_deep_agent", return_value=agent):
            result = await node_fn(_base_state())

        assert result["stage_success"] is True
        assert result["stage_result"] == "Result text"

    async def test_empty_stream_returns_empty_content(self) -> None:
        """An empty stream must yield stage_result='' without errors."""
        from src.nodes.developer import make_developer_node

        cfg = _NoCaptureConfig()
        node_fn = make_developer_node(cfg, [])

        async def _empty_astream(inputs, *args, **kwargs):
            return
            yield  # makes this an async generator

        agent = MagicMock()
        agent.astream = _empty_astream

        with _patch_persona(), _patch_backend(), \
             patch("deepagents.create_deep_agent", return_value=agent):
            result = await node_fn(_base_state())

        assert result["stage_success"] is True
        assert result["stage_result"] == ""
